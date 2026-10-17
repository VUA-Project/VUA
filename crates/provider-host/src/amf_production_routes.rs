use super::provider_host::{
    app_error_category, application_error, application_error_with_params, application_success,
    uuid_v7_identity, FrameOutcome,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use vua_orchestrator::{amf_production::*, SubmitRequest, TaskExit, TaskRuntime};

pub(crate) struct AmfProductionServices {
    pub engine: AmfProductionEngine,
    pub runtime: TaskRuntime,
    pub busy: Arc<AtomicBool>,
}
struct BusyGuard(Arc<AtomicBool>);
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub(crate) fn request(
    service: Option<Arc<AmfProductionServices>>,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(service) = service else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.amf_production.unavailable",
            "errors.amfProduction.unavailable",
            "unavailable",
        ));
    };
    let result = route(service, method, request);
    FrameOutcome::Response(match result {
        Ok(value) => application_success(request_id, value),
        Err(error) => application_error_with_params(
            request_id,
            correlation_id,
            &error.code,
            &error.message_key,
            app_error_category(error.category),
            &error
                .params
                .as_ref()
                .map(|params| {
                    params
                        .iter()
                        .map(|(k, v)| (k.as_str(), v.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        ),
    })
}
/// The run as the player sees it now. Work whose task no longer runs (VUA or its AMF process
/// ended mid-step) needs inspection, and its unfinished step reads as interrupted.
fn project_view(mut run: ProductionRun, service: &AmfProductionServices) -> ProductionRun {
    if service.busy.load(Ordering::SeqCst) {
        return run;
    }
    let active = service
        .runtime
        .snapshot(&run.task_id)
        .is_some_and(|task| !task.state.is_terminal());
    if !active {
        if ACTIVE_PHASES.contains(&run.phase.as_str()) {
            run.phase = "inspect_required".into();
        }
        if let Some(step) = run.steps.last_mut().filter(|step| step.state == "running") {
            step.state = "interrupted".into();
        }
    }
    run
}
fn wire_run(run: ProductionRun) -> Value {
    let mut value = serde_json::to_value(run).expect("run serialization");
    if let Some(sources) = value["sources"].as_array_mut() {
        for source in sources {
            source
                .as_object_mut()
                .expect("source object")
                .remove("assetPaths");
        }
    }
    value
}
/// Padded standard base64, as data URLs and MCP image content expect.
fn standard_base64(bytes: &[u8]) -> String {
    let mut text = vua_orchestrator::base64_url_encode(bytes).replace('-', "+").replace('_', "/");
    while !text.len().is_multiple_of(4) {
        text.push('=');
    }
    text
}
fn route(
    service: Arc<AmfProductionServices>,
    method: &str,
    request: &Value,
) -> Result<Value, vua_orchestrator::AppErrorV1> {
    if let Some(result) = super::amf_release_routes::route(&service, method, request) {
        return result;
    }
    let query = matches!(
        method,
        "amf.production.list" | "amf.production.get" | "amf.production.plan" | "amf.production.rollbackPlan" | "amf.production.listRecipes" | "amf.production.getRecipe" | "amf.production.recipeSharePlan" | "amf.production.previewRecipeShare" | "amf.production.recipeApplyPlan" | "amf.production.previewImage"
    );
    if request.get("kind").and_then(Value::as_str) != Some(if query { "query" } else { "command" })
    {
        return Err(production_error(
            "params_invalid",
            "Production method kind does not match its operation.",
        ));
    }
    let params = request
        .get("params")
        .and_then(Value::as_object)
        .ok_or_else(|| production_error("params_invalid", "Missing params."))?;
    let keys: &[&str] = match method {
        "amf.production.list" | "amf.production.listRecipes" => &["schemaVersion"],
        "amf.production.getRecipe" | "amf.production.recipeSharePlan" => &["schemaVersion", "recipeId"],
        "amf.production.previewRecipeShare" | "amf.production.importRecipe" => &["schemaVersion", "text"],
        "amf.production.exportRecipe" => &["schemaVersion", "recipeId", "planDigest", "sources"],
        "amf.production.saveRecipe" => &["schemaVersion", "runId", "title"],
        "amf.production.previewImage" => &["schemaVersion", "runId", "path"],
        "amf.production.prepareRecipe" => &["schemaVersion", "recipeId", "editorPath"],
        "amf.production.recipeApplyPlan" if params.contains_key("avatarGlobalObjectId") => &["schemaVersion", "runId", "recipeId", "avatarGlobalObjectId"],
        "amf.production.recipeApplyPlan" => &["schemaVersion", "runId", "recipeId"],
        "amf.production.applyRecipe" if params.contains_key("avatarGlobalObjectId") => &["schemaVersion", "runId", "recipeId", "planDigest", "choice", "avatarGlobalObjectId"],
        "amf.production.applyRecipe" => &["schemaVersion", "runId", "recipeId", "planDigest", "choice"],
        "amf.production.get" | "amf.production.reinspect" | "amf.production.open" | "amf.production.rollbackPlan" => {
            &["schemaVersion", "runId"]
        }
        "amf.production.prepare" => &["schemaVersion", "sources", "editorPath"],
        "amf.production.plan" => &["schemaVersion", "runId", "selection"],
        "amf.production.assemble" => &["schemaVersion", "runId", "planDigest", "selection"],
        "amf.production.rollback" => &["schemaVersion", "runId", "planDigest"],
        _ => {
            return Err(production_error(
                "method_invalid",
                "Unknown production method.",
            ))
        }
    };
    if params.len() != keys.len()
        || keys.iter().any(|key| !params.contains_key(*key))
        || params["schemaVersion"] != "0.1"
    {
        return Err(production_error(
            "params_invalid",
            "Unknown keys or unsupported production version.",
        ));
    }
    let string = |key: &str| -> Result<String, vua_orchestrator::AppErrorV1> {
        params
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| production_error("params_invalid", format!("Missing {key}.")))
    };
    let avatar_id = if params.contains_key("avatarGlobalObjectId") {
        let id = string("avatarGlobalObjectId")?;
        if id.len() > 256 || id.contains('\0') { return Err(production_error("params_invalid", "Invalid Avatar identity.")); }
        Some(id)
    } else { None };
    if matches!(method, "amf.production.assemble" | "amf.production.rollback" | "amf.production.applyRecipe") {
        let digest = string("planDigest")?;
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) {
            return Err(production_error("params_invalid", "A reviewed plan digest is required."));
        }
    }
    if method == "amf.production.list" {
        let runs = service.engine.list()?.into_iter().map(|run| {
            let run = project_view(run, &service);
            json!({"runId":run.run_id,"phase":run.phase,"sourceNames":run.sources.iter().map(|s| &s.item_name).take(3).collect::<Vec<_>>()})
        }).collect::<Vec<_>>();
        return Ok(
            json!({"schemaVersion":"0.1","sources":service.engine.sources()?,"editors":service.engine.editors()?,"runs":runs,"busy":service.busy.load(Ordering::SeqCst)}),
        );
    }
    if method == "amf.production.previewImage" {
        let (run_id, path) = (string("runId")?, string("path")?);
        if !is_preview_path(&path) {
            return Err(production_error("params_invalid", "A preview path names a PNG under .vua/previews."));
        }
        let bytes = service.engine.preview_image(&run_id, &path)?;
        return Ok(json!({"schemaVersion":"0.1","runId":run_id,"path":path,"mediaType":"image/png","data":standard_base64(&bytes)}));
    }
    if method == "amf.production.get" {
        let run = project_view(service.engine.get(&string("runId")?)?, &service);
        let progress = ACTIVE_PHASES
            .contains(&run.phase.as_str())
            .then(|| service.engine.progress(&run))
            .flatten();
        let mut value = wire_run(run);
        value["usualDurations"] = json!(service.engine.usual_durations());
        value["progress"] = progress.unwrap_or(Value::Null);
        return Ok(value);
    }
    if method == "amf.production.listRecipes" {
        return Ok(json!({"schemaVersion":"0.1", "recipes":service.engine.list_recipes()?}));
    }
    if method == "amf.production.getRecipe" {
        return Ok(json!({"schemaVersion":"0.1", "document":service.engine.get_recipe(&string("recipeId")?)?}));
    }
    if method == "amf.production.recipeSharePlan" {
        return Ok(json!({"schemaVersion":"0.1", "plan":service.engine.recipe_share_plan(&string("recipeId")?)?}));
    }
    if method == "amf.production.previewRecipeShare" {
        return Ok(json!({"schemaVersion":"0.1", "document":vua_orchestrator::amf_recipe_share::SharedRecipe::decode(&string("text")?)?}));
    }
    if method == "amf.production.rollbackPlan" {
        if service.busy.load(Ordering::SeqCst) {
            return Err(production_error("busy", "Production is still running."));
        }
        return service.engine.rollback_plan(&string("runId")?);
    }
    if method == "amf.production.plan" {
        if service.busy.load(Ordering::SeqCst) {
            return Err(production_error("busy", "Production is still running."));
        }
        let selection: AssemblySelection = serde_json::from_value(params["selection"].clone())
            .map_err(|e| production_error("selection_invalid", e.to_string()))?;
        let run_id = string("runId")?;
        let run = project_view(service.engine.get(&run_id)?, &service);
        if run.phase == "inspect_required" {
            return Err(production_error(
                "inspect_required",
                "Reinspect interrupted work before planning.",
            ));
        }
        return service.engine.plan(&run_id, &selection);
    }
    if method == "amf.production.recipeApplyPlan" {
        if service.busy.load(Ordering::SeqCst) {
            return Err(production_error("busy", "Production is still running."));
        }
        return Ok(json!({"schemaVersion":"0.1", "plan":service.engine.recipe_apply_plan_for(&string("runId")?, &string("recipeId")?, avatar_id.as_deref())?}));
    }
    if service
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(production_error(
            "busy",
            "Wait for the current production operation to finish.",
        ));
    }
    let guard = BusyGuard(service.busy.clone());
    if method == "amf.production.exportRecipe" {
        let sources: std::collections::BTreeMap<String,String> = serde_json::from_value(params["sources"].clone()).map_err(|_| production_error("recipe_sources_invalid", "Expected material source choices."))?;
        return Ok(json!({"schemaVersion":"0.1", "export":service.engine.export_recipe(&string("recipeId")?, &string("planDigest")?, &sources)?}));
    }
    if method == "amf.production.importRecipe" {
        return Ok(json!({"schemaVersion":"0.1", "document":service.engine.import_recipe(&string("text")?)?}));
    }
    if method == "amf.production.saveRecipe" {
        let id = format!("recipe-{}", uuid_v7_identity());
        return Ok(json!({"schemaVersion":"0.1", "document":service.engine.save_recipe(&string("runId")?, &id, &string("title")?)?}));
    }
    let run_id = if method == "amf.production.prepareRecipe" {
        let id = format!("n3-{}", uuid_v7_identity());
        service.engine.begin_recipe(&id, &string("recipeId")?, &string("editorPath")?)?;
        id
    } else if method == "amf.production.prepare" {
        let choices: Vec<SourceChoice> = serde_json::from_value(params["sources"].clone())
            .map_err(|e| production_error("sources_invalid", e.to_string()))?;
        let id = format!("n3-{}", uuid_v7_identity());
        service.engine.begin(&id, choices, &string("editorPath")?)?;
        id
    } else {
        string("runId")?
    };
    if method == "amf.production.open" {
        service.engine.precheck_open(&run_id)?;
    }
    let selection: Option<AssemblySelection> = params
        .get("selection")
        .map(|s| serde_json::from_value(s.clone()))
        .transpose()
        .map_err(|e| production_error("selection_invalid", e.to_string()))?;
    let digest = params
        .get("planDigest")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let action = method.to_owned();
    let recipe_application = if method == "amf.production.applyRecipe" {
        let choice: vua_orchestrator::amf_recipe_apply::RecipeApplyChoice = serde_json::from_value(params["choice"].clone())
            .map_err(|_| production_error("params_invalid", "Choose how to apply the reviewed Recipe."))?;
        Some((string("recipeId")?, choice))
    } else { None };
    let operation_run = run_id.clone();
    let worker = service.clone();
    let accepted = service.runtime.submit(SubmitRequest {
        correlation_id: request
            .get("correlationId")
            .and_then(Value::as_str)
            .map(str::to_owned),
        timeout: None,
        job: Box::new(move |ctx| {
            let _guard = guard;
            match action.as_str() {
                "amf.production.prepare" | "amf.production.prepareRecipe" => worker.engine.prepare(&operation_run, ctx)?,
                "amf.production.assemble" => worker.engine.assemble(
                    &operation_run,
                    selection.expect("assemble selection validated"),
                    &digest,
                    ctx,
                )?,
                "amf.production.reinspect" => worker.engine.reinspect(&operation_run, ctx)?,
                "amf.production.applyRecipe" => {
                    let (recipe, choice) = recipe_application.expect("Recipe application validated");
                    worker.engine.apply_recipe_to(&operation_run, &recipe, avatar_id.as_deref(), choice, &digest, ctx)?;
                }
                "amf.production.rollback" => worker.engine.rollback(&operation_run, &digest, ctx)?,
                "amf.production.open" => {
                    return worker.engine.open(&operation_run, ctx).map(TaskExit::Done)
                }
                _ => {
                    return Err(production_error(
                        "method_invalid",
                        "Unknown production action.",
                    ))
                }
            }
            if ctx.check_cancel() {
                return Ok(TaskExit::Cancelled);
            }
            Ok(TaskExit::Done(
                json!({"schemaVersion":"0.1","operation":"amf.production","runId":operation_run}),
            ))
        }),
    })?;
    Ok(json!({"schemaVersion":"0.1","operation":method,"runId":run_id,"taskId":accepted.task_id}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use vua_orchestrator::{NanosTaskIdGenerator, SqliteTaskStore, SystemClock};

    #[test]
    fn work_whose_task_ended_reads_interrupted_with_its_usual_durations() {
        let root = std::env::temp_dir().join(format!("vua-amf-routes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("amf/runs")).unwrap();
        let platform = crate::amf_production_adapter::NativeAmfProduction {
            bdl: Arc::new(vua_bdl_store::BdlStore::open(root.join("bdl.db")).unwrap()),
            root: root.join("amf"), editor_roots: vec![], explicit_editor: None, unity_hub: None,
        };
        let service = Arc::new(AmfProductionServices {
            engine: AmfProductionEngine::new(root.join("amf"), Arc::new(platform)),
            runtime: TaskRuntime::with_sqlite(Arc::new(SqliteTaskStore::open(root.join("tasks.db")).unwrap()),
                Arc::new(SystemClock), Arc::new(NanosTaskIdGenerator::default())).unwrap(),
            busy: Arc::new(AtomicBool::new(false)),
        });
        let step = |key: &str, state: &str, start: &str, end: Option<&str>| json!({"key":key,"name":key,"state":state,"detail":"",
            "startedAt":format!("2026-10-17T{start}.000Z"),"endedAt":end.map(|end| format!("2026-10-17T{end}.000Z"))});
        let record = json!({"schemaVersion":"0.1","runId":"n3-routes","phase":"inspecting","taskId":"task-ended",
            "editor":{"path":"Unity.exe","version":"2022.3.22f1"},"projectRoot":root.join("amf/projects/n3-routes"),
            "choices":[],"sources":[],"prefabs":[],"projectFingerprint":"","unityFingerprint":"",
            "steps":[step("inspect","succeeded","08:00:00",Some("08:06:52")), step("reinspect","running","09:00:00",None)],
            "selection":null,"confirmedDigest":null,"result":null,"error":null,"recovery":null});
        std::fs::write(root.join("amf/runs/n3-routes.json"), serde_json::to_vec(&record).unwrap()).unwrap();

        let view = route(service, "amf.production.get", &json!({"kind":"query","params":{"schemaVersion":"0.1","runId":"n3-routes"}})).unwrap();
        assert_eq!(view["phase"], "inspect_required");
        assert_eq!(view["steps"][1]["state"], "interrupted");
        assert_eq!(view["steps"][1]["endedAt"], Value::Null);
        assert_eq!(view["usualDurations"], json!({"inspect":412}));
        assert_eq!(view["progress"], Value::Null, "work that no longer runs has no live progress");
        let schema = serde_json::from_slice(&std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../schemas/amf-production-flow/v0.1/status.schema.json")).unwrap()).unwrap();
        assert!(jsonschema::validator_for(&schema).unwrap().is_valid(&view), "{view}");
        std::fs::remove_dir_all(&root).unwrap();
    }
}

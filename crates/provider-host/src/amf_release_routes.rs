//! The release room's AMF methods: release state, turntable frames, turntable baking and managed
//! upload. Commands share the production busy flag, so one Unity job runs at a time.
use super::amf_production_routes::AmfProductionServices;
use serde_json::{json, Value};
use std::sync::{atomic::Ordering, Arc};
use vua_orchestrator::{amf_production::*, AppErrorV1, SubmitRequest, TaskExit};

const QUERIES: [&str; 2] = ["amf.production.releaseState", "amf.production.turntableFrame"];
const COMMANDS: [&str; 2] = ["amf.production.bakeTurntable", "amf.production.upload"];

struct Busy(Arc<std::sync::atomic::AtomicBool>);
impl Drop for Busy {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Padded standard base64, as data URLs expect.
fn standard_base64(bytes: &[u8]) -> String {
    let mut text = vua_orchestrator::base64_url_encode(bytes).replace('-', "+").replace('_', "/");
    while !text.len().is_multiple_of(4) {
        text.push('=');
    }
    text
}

/// Handles the release methods; other methods return `None` and continue in the production route.
pub(crate) fn route(service: &Arc<AmfProductionServices>, method: &str, request: &Value) -> Option<Result<Value, AppErrorV1>> {
    let query = QUERIES.contains(&method);
    if !query && !COMMANDS.contains(&method) {
        return None;
    }
    Some(handle(service, method, request, query))
}

fn handle(service: &Arc<AmfProductionServices>, method: &str, request: &Value, query: bool) -> Result<Value, AppErrorV1> {
    if request.get("kind").and_then(Value::as_str) != Some(if query { "query" } else { "command" }) {
        return Err(production_error("params_invalid", "Production method kind does not match its operation."));
    }
    let params = request.get("params").and_then(Value::as_object).ok_or_else(|| production_error("params_invalid", "Missing params."))?;
    let keys: &[&str] = match method {
        "amf.production.turntableFrame" => &["schemaVersion", "runId", "index"],
        "amf.production.upload" => &["schemaVersion", "runId", "avatarName", "rightsConfirmed"],
        _ => &["schemaVersion", "runId"],
    };
    if params.len() != keys.len() || keys.iter().any(|key| !params.contains_key(*key)) || params["schemaVersion"] != "0.1" {
        return Err(production_error("params_invalid", "Unknown keys or unsupported production version."));
    }
    let run_id = params["runId"].as_str().filter(|id| !id.is_empty()).map(str::to_owned)
        .ok_or_else(|| production_error("params_invalid", "Missing runId."))?;
    match method {
        "amf.production.releaseState" => return service.engine.release_state(&run_id),
        "amf.production.turntableFrame" => {
            let index = params["index"].as_u64().filter(|index| *index < u64::from(TURNTABLE_FRAMES))
                .ok_or_else(|| production_error("params_invalid", "A turntable frame index is 0 to 59."))? as u32;
            let bytes = service.engine.turntable_frame(&run_id, index)?;
            return Ok(json!({"schemaVersion":"0.1", "runId":run_id, "index":index, "mediaType":"image/png", "data":standard_base64(&bytes)}));
        }
        _ => {}
    }
    let avatar_name = if method == "amf.production.upload" {
        // The player's confirmation of the content rights statement, given in VUA for this upload.
        if params["rightsConfirmed"] != Value::Bool(true) {
            return Err(production_error("rights_unconfirmed", "Confirm that you have the rights to upload this content."));
        }
        params["avatarName"].as_str().map(str::to_owned).ok_or_else(|| production_error("params_invalid", "Missing avatarName."))?
    } else {
        String::new()
    };
    if service.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err(production_error("busy", "Wait for the current production operation to finish."));
    }
    let busy = Busy(service.busy.clone());
    if method == "amf.production.upload" {
        service.engine.precheck_upload(&run_id, &avatar_name)?;
    } else {
        service.engine.precheck_turntable(&run_id)?;
    }
    let (worker, action, operation_run) = (service.clone(), method.to_owned(), run_id.clone());
    let accepted = service.runtime.submit(SubmitRequest {
        correlation_id: request.get("correlationId").and_then(Value::as_str).map(str::to_owned),
        timeout: None,
        job: Box::new(move |ctx| {
            let _busy = busy;
            if action == "amf.production.upload" {
                worker.engine.upload(&operation_run, &avatar_name, ctx)?;
            } else {
                worker.engine.bake_turntable(&operation_run, ctx)?;
            }
            if ctx.check_cancel() {
                return Ok(TaskExit::Cancelled);
            }
            Ok(TaskExit::Done(json!({"schemaVersion":"0.1", "operation":"amf.production", "runId":operation_run})))
        }),
    })?;
    Ok(json!({"schemaVersion":"0.1", "operation":method, "runId":run_id, "taskId":accepted.task_id}))
}

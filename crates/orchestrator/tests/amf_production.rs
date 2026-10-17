//! Synthetic use-case tests only; not real Unity or N3 material acceptance.
#![allow(clippy::result_large_err)]
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use vua_orchestrator::{
    amf_production::*, AppErrorV1, NanosTaskIdGenerator, SqliteTaskStore, SubmitRequest,
    SystemClock, TaskContext, TaskExit, TaskRuntime,
};

struct TestPlatform {
    fail: AtomicBool,
    fail_restore: AtomicBool,
    fail_inspect: AtomicBool,
    change_recipe_input: AtomicBool,
    /// The next Unity step reports progress and runs until the player stops it.
    wait_for_stop: AtomicBool,
    snapshots: AtomicUsize,
    root: PathBuf,
}
/// A Unity step that imports until the player asks to stop, then ends as Unity would.
fn unity_until_stopped(watch: &UnityWatch) -> AppErrorV1 {
    let started = std::time::Instant::now();
    let mut current = 0;
    while !watch.stop_requested() {
        assert!(started.elapsed() < Duration::from_secs(10), "the stop request never reached the Unity step");
        current = (current + 1).min(379);
        watch.report(UnityProgress { stage: UnityStage::Importing, current: Some(current), total: Some(379),
            last_activity_at: "2026-10-17T08:00:00.000Z".into() });
        std::thread::sleep(Duration::from_millis(10));
    }
    watch.stopped()
}
fn candidates() -> Vec<PrefabCandidate> {
    vec![
        PrefabCandidate {
            source_id: "avatar".into(),
            path: "Assets/Avatar.prefab".into(),
            name: "Avatar".into(),
            is_avatar: true,
            has_skinned_mesh: true,
            has_merge_armature: false,
            has_missing_scripts: false,
            humanoid_bones: vec!["Head".into()],
            preview: Some(".vua/previews/cmd/candidate-000.png".into()),
        },
        PrefabCandidate {
            source_id: "outfit".into(),
            path: "Assets/Outfit.prefab".into(),
            name: "Coat".into(),
            is_avatar: false,
            has_skinned_mesh: true,
            has_merge_armature: false,
            has_missing_scripts: false,
            humanoid_bones: vec![],
            preview: None,
        },
    ]
}
impl AmfProductionPlatform for TestPlatform {
    fn resolve_recipe_materials(&self, materials: &[vua_orchestrator::amf_recipe::RecipeMaterial]) -> Result<std::collections::BTreeMap<String,String>, AppErrorV1> {
        materials.iter().map(|material| {
            let source = if material.sha256 == "a".repeat(64) { "avatar" } else if material.sha256 == "b".repeat(64) { "outfit" }
                else { return Err(production_error("recipe_material_missing", "Synthetic missing original.")); };
            Ok((material.id.clone(), source.into()))
        }).collect()
    }
    fn sources(&self) -> Result<Vec<ProductionSource>, AppErrorV1> {
        Ok(["avatar", "outfit"]
            .into_iter()
            .map(|id| ProductionSource {
                source_id: id.into(),
                item_id: id.into(),
                item_name: id.into(),
                name: format!("{id}.unitypackage"),
                path: self.root.join(id),
                archive_member: None,
            })
            .collect())
    }
    fn editors(&self) -> Result<Vec<ProductionEditor>, AppErrorV1> {
        Ok(vec![self.verify_editor("synthetic-editor")?])
    }
    fn verify_editor(&self, path: &str) -> Result<ProductionEditor, AppErrorV1> {
        Ok(ProductionEditor {
            path: path.into(),
            version: "2022.3.22f1c1".into(),
        })
    }
    fn create_project(&self, run: &ProductionRun, _: &TaskContext) -> Result<(), AppErrorV1> {
        fs::create_dir_all(Path::new(&run.project_root).join("Assets")).unwrap();
        fs::write(Path::new(&run.project_root).join("Assets/state"), "before").unwrap();
        Ok(())
    }
    fn import_sources(
        &self,
        run: &ProductionRun,
        _: &TaskContext,
    ) -> Result<Vec<PreparedSource>, AppErrorV1> {
        Ok(run
            .choices
            .iter()
            .map(|s| PreparedSource {
                source_id: s.source_id.clone(),
                role: s.role,
                name: format!("{}.unitypackage", s.source_id),
                item_name: s.source_id.clone(),
                sha256: format!("sha256:{}", if s.source_id == "avatar" { "a".repeat(64) } else if self.change_recipe_input.load(Ordering::SeqCst) { "c".repeat(64) } else { "b".repeat(64) }),
                asset_paths: vec![format!("Assets/{}.prefab", s.source_id)],
            })
            .collect())
    }
    fn inspect(&self, run: &ProductionRun, watch: &UnityWatch) -> Result<ObservedProject, AppErrorV1> {
        if self.wait_for_stop.swap(false, Ordering::SeqCst) {
            return Err(unity_until_stopped(watch));
        }
        if self.fail_inspect.swap(false, Ordering::SeqCst) {
            return Err(production_error("test_inspect", "Synthetic inspection failed."));
        }
        let previews = Path::new(&run.project_root).join(".vua/previews/cmd");
        fs::create_dir_all(&previews).unwrap();
        for file in ["front.png", "candidate-000.png", "unreported.png"] {
            fs::write(previews.join(file), b"\x89PNG\r\n\x1a\nsynthetic").unwrap();
        }
        Ok(ObservedProject {
            prefabs: candidates(),
            unity_fingerprint: "scene-before".into(),
            editor_version: "2022.3.22f1c1".into(),
            result: serde_json::json!({"synthetic":true,
                "facts":{"avatarName":"Synthetic Avatar", "avatarGlobalObjectId":"synthetic-avatar", "usedSourceIds":["avatar","outfit"],
                    "previews":[{"view":"front","path":".vua/previews/cmd/front.png"}], "observedSelection":(fs::read_to_string(Path::new(&run.project_root).join("Assets/state")).unwrap() == "after").then(selection)},
                "packageVersions":{"com.vrchat.avatars":"3.10.5","nadena.dev.modular-avatar":"1.18.7"}}),
        })
    }
    fn assemble(
        &self,
        run: &ProductionRun,
        _: &AssemblySelection,
        watch: &UnityWatch,
    ) -> Result<ObservedProject, AppErrorV1> {
        fs::write(Path::new(&run.project_root).join("Assets/state"), "after").unwrap();
        if self.fail.load(Ordering::SeqCst) {
            return Err(production_error(
                "test_failure",
                "Synthetic failure after a mutation.",
            ));
        }
        self.inspect(run, watch)
    }
    fn fingerprint(&self, project: &Path) -> Result<String, AppErrorV1> {
        fs::read_to_string(project.join("Assets/state"))
            .map_err(|e| production_error("test_io", e.to_string()))
    }
    /// The v1 analog of this platform's fingerprint: the same state under the old prefix,
    /// as a record written before the cached value would carry it.
    fn fingerprint_legacy(&self, project: &Path) -> Result<String, AppErrorV1> {
        Ok(format!("sha256:{}", self.fingerprint(project)?))
    }
    fn apply_recipe(&self, run: &ProductionRun, selection: &AssemblySelection, target: &vua_orchestrator::amf_recipe_apply::RecipeApplyTarget, watch: &UnityWatch) -> Result<ObservedProject, AppErrorV1> {
        let mut observed = self.assemble(run, selection, watch)?;
        observed.result["facts"]["observedSelection"] = serde_json::to_value(selection).unwrap();
        observed.result["facts"]["avatarGlobalObjectId"] = serde_json::json!(if target.new_avatar_key.is_some() { "synthetic-new-avatar" } else { &target.avatar_global_object_id });
        Ok(observed)
    }
    fn snapshot(&self, run: &ProductionRun) -> Result<String, AppErrorV1> {
        self.snapshots.fetch_add(1, Ordering::SeqCst);
        self.fingerprint(Path::new(&run.project_root))
    }
    fn restore(&self, run: &ProductionRun, snapshot: &str) -> Result<(), AppErrorV1> {
        if run.phase == "restoring" {
            let saved: ProductionRun = serde_json::from_slice(&fs::read(self.root.join("production/runs/n3-test.json")).unwrap()).unwrap();
            assert_eq!(saved.phase, "restoring");
            assert_eq!(saved.snapshot_id, run.snapshot_id, "Current-state recovery must be durable before any restore writes");
        }
        if self.fail_restore.swap(false, Ordering::SeqCst) {
            fs::write(Path::new(&run.project_root).join("Assets/state"), "partial restore").unwrap();
            return Err(production_error("test_restore", "Synthetic partial restore."));
        }
        fs::write(Path::new(&run.project_root).join("Assets/state"), snapshot).unwrap();
        Ok(())
    }
    fn open(&self, _: &ProductionRun, _: &TaskContext) -> Result<serde_json::Value, AppErrorV1> {
        Ok(serde_json::json!({"synthetic":true}))
    }
}
fn selection() -> AssemblySelection {
    AssemblySelection {
        avatar_prefab: "Assets/Avatar.prefab".into(),
        outfits: vec![OutfitSelection {
            source_id: "outfit".into(),
            prefab_path: "Assets/Outfit.prefab".into(),
            mode: BindingMode::MergeArmature,
            bone: "".into(),
            toggle_name: "Coat".into(),
            active: true,
        }],
    }
}
struct Harness {
    root: PathBuf,
    engine: Arc<AmfProductionEngine>,
    platform: Arc<TestPlatform>,
    runtime: TaskRuntime,
}
impl Harness {
    fn new() -> Self {
        // Parallel tests can read the same clock value; the counter keeps each root unique.
        static NEXT_ROOT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "vua-n3-test-{}-{}-{}",
            std::process::id(),
            NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let platform = Arc::new(TestPlatform {
            fail: AtomicBool::new(false),
            fail_restore: AtomicBool::new(false),
            fail_inspect: AtomicBool::new(false),
            change_recipe_input: AtomicBool::new(false),
            wait_for_stop: AtomicBool::new(false),
            snapshots: AtomicUsize::new(0),
            root: root.clone(),
        });
        let engine = Arc::new(AmfProductionEngine::new(
            root.join("production"),
            platform.clone(),
        ));
        let runtime = TaskRuntime::with_sqlite(
            Arc::new(SqliteTaskStore::open(root.join("tasks.db")).unwrap()),
            Arc::new(SystemClock),
            Arc::new(NanosTaskIdGenerator::default()),
        )
        .unwrap();
        Self {
            root,
            engine,
            platform,
            runtime,
        }
    }
    fn job(
        &self,
        action: impl FnOnce(&AmfProductionEngine, &TaskContext) -> Result<(), AppErrorV1>
            + Send
            + 'static,
    ) -> bool {
        let engine = self.engine.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        self.runtime
            .submit(SubmitRequest {
                correlation_id: None,
                timeout: None,
                job: Box::new(move |ctx| {
                    let result = action(&engine, ctx);
                    tx.send(result.is_ok()).unwrap();
                    result.map(|()| TaskExit::Done(serde_json::json!({"synthetic":true})))
                }),
            })
            .unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap()
    }
    fn prepared(&self) {
        self.engine
            .begin(
                "n3-test",
                vec![
                    SourceChoice {
                        source_id: "avatar".into(),
                        role: SourceRole::Auto,
                    },
                    SourceChoice {
                        source_id: "outfit".into(),
                        role: SourceRole::Auto,
                    },
                ],
                "synthetic-editor",
            )
            .unwrap();
        assert!(self.job(|engine, ctx| engine.prepare("n3-test", ctx)));
    }
}
impl Drop for Harness {
    fn drop(&mut self) {
        assert!(
            self.root.starts_with(std::env::temp_dir())
                && self
                    .root
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("vua-n3-test-")
        );
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn confirmation_binds_source_target_editor_and_reinspection_revision() {
    let h = Harness::new();
    h.prepared();
    let run = h.engine.get("n3-test").unwrap();
    let digest = plan_digest(&run, &selection()).unwrap();
    let mut changed = run.clone();
    changed.editor.version = "2022.3.22f1".into();
    assert_ne!(digest, plan_digest(&changed, &selection()).unwrap());
    changed = run.clone();
    changed.sources[0].sha256 = "b".repeat(64);
    assert_ne!(digest, plan_digest(&changed, &selection()).unwrap());
    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    assert_ne!(
        digest,
        plan_digest(&h.engine.get("n3-test").unwrap(), &selection()).unwrap()
    );
}
#[test]
fn only_previews_the_run_reports_are_read() {
    let h = Harness::new();
    h.prepared();
    let front = h.engine.preview_image("n3-test", ".vua/previews/cmd/front.png").unwrap();
    assert!(front.starts_with(b"\x89PNG"));
    assert!(h.engine.preview_image("n3-test", ".vua/previews/cmd/candidate-000.png").is_ok());
    for unreported in [".vua/previews/cmd/unreported.png", ".vua/previews/cmd/../cmd/front.png", "Assets/state"] {
        assert_eq!(h.engine.preview_image("n3-test", unreported).unwrap_err().code, "vua.amf_production.preview_unknown");
    }
    let run = h.engine.get("n3-test").unwrap();
    fs::write(Path::new(&run.project_root).join(".vua/previews/cmd/front.png"), b"not an image").unwrap();
    assert_eq!(h.engine.preview_image("n3-test", ".vua/previews/cmd/front.png").unwrap_err().code, "vua.amf_production.preview_invalid");
}
#[test]
fn project_drift_refuses_before_snapshot_or_mutation() {
    let h = Harness::new();
    h.prepared();
    let run = h.engine.get("n3-test").unwrap();
    let digest = plan_digest(&run, &selection()).unwrap();
    fs::write(
        Path::new(&run.project_root).join("Assets/state"),
        "player-change",
    )
    .unwrap();
    assert!(!h.job(move |engine, ctx| engine.assemble("n3-test", selection(), &digest, ctx)));
    assert_eq!(
        fs::read_to_string(Path::new(&run.project_root).join("Assets/state")).unwrap(),
        "player-change"
    );
}
#[test]
fn a_reinspected_finished_avatar_stays_finished_until_its_scene_changes() {
    let h = Harness::new();
    let run = assembled(&h);
    assert_eq!(h.engine.get("n3-test").unwrap().phase, "succeeded");
    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    let checked = h.engine.get("n3-test").unwrap();
    assert_eq!(checked.phase, "succeeded", "Unity still observes the assembled Avatar");
    assert!(checked.confirmed_digest.is_none());
    fs::write(Path::new(&run.project_root).join("Assets/state"), "player-change").unwrap();
    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    assert_eq!(h.engine.get("n3-test").unwrap().phase, "ready", "a changed scene goes back to planning");
}
#[test]
fn failure_restores_and_requires_explicit_reinspection() {
    let h = Harness::new();
    h.prepared();
    let run = h.engine.get("n3-test").unwrap();
    let digest = plan_digest(&run, &selection()).unwrap();
    h.platform.fail.store(true, Ordering::SeqCst);
    assert!(!h.job(move |engine, ctx| engine.assemble("n3-test", selection(), &digest, ctx)));
    let failed = h.engine.get("n3-test").unwrap();
    assert_eq!(failed.phase, "failed");
    assert_eq!(failed.recovery.as_deref(), Some("restored"));
    assert_eq!(
        fs::read_to_string(Path::new(&run.project_root).join("Assets/state")).unwrap(),
        "before"
    );
    assert!(h.engine.plan("n3-test", &selection()).is_err());
    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    assert_eq!(h.engine.get("n3-test").unwrap().phase, "ready");
}
#[test]
fn targets_cannot_be_substituted_by_an_unobserved_prefab_or_an_avatar_as_clothing() {
    let h = Harness::new();
    h.prepared();
    let run = h.engine.get("n3-test").unwrap();
    let mut invalid = selection();
    invalid.outfits[0].prefab_path = "Assets/Avatar.prefab".into();
    assert!(validate_selection(&run, &invalid).is_err());
    invalid = selection();
    invalid.avatar_prefab = "Assets/Unobserved.prefab".into();
    assert!(validate_selection(&run, &invalid).is_err());
    invalid = selection();
    invalid.outfits[0].mode = BindingMode::AttachToBone;
    invalid.outfits[0].bone = "Head".into();
    assert!(validate_selection(&run, &invalid).is_err());
}
#[test]
fn terminal_record_does_not_keep_an_inflight_step() {
    let h = Harness::new();
    h.prepared();
    let digest = plan_digest(&h.engine.get("n3-test").unwrap(), &selection()).unwrap();
    assert!(h.job(move |engine, ctx| engine.assemble("n3-test", selection(), &digest, ctx)));
    let records = fs::read_dir(h.root.join("production/records"))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(records.len(), 1);
    let record: ProductionRun =
        serde_json::from_slice(&fs::read(records[0].path()).unwrap()).unwrap();
    assert_eq!(record.phase, "succeeded");
    assert!(record.steps.iter().all(|s| s.state == "succeeded"));
}
#[test]
fn traversal_and_duplicate_inputs_never_create_work_projects() {
    let h = Harness::new();
    assert!(h.engine.get("../outside").is_err());
    assert!(validate_choices(&[
        SourceChoice {
            source_id: "same".into(),
            role: SourceRole::Auto
        },
        SourceChoice {
            source_id: "same".into(),
            role: SourceRole::Auto
        }
    ])
    .is_err());
}

fn assembled(h: &Harness) -> ProductionRun {
    h.prepared();
    let digest = plan_digest(&h.engine.get("n3-test").unwrap(), &selection()).unwrap();
    assert!(h.job(move |engine, ctx| engine.assemble("n3-test", selection(), &digest, ctx)));
    h.engine.get("n3-test").unwrap()
}

fn restore_reviewed(h: &Harness) -> bool {
    let plan = h.engine.rollback_plan("n3-test").unwrap();
    let digest = plan["planDigest"].as_str().unwrap().to_owned();
    h.job(move |engine, ctx| engine.rollback("n3-test", &digest, ctx))
}

#[test]
fn user_restore_retains_current_edits_and_can_itself_be_undone() {
    let h = Harness::new();
    let run = assembled(&h);
    let state = Path::new(&run.project_root).join("Assets/state");
    fs::write(&state, "player-adjustments-after-assembly").unwrap();
    assert_eq!(h.engine.rollback_plan("n3-test").unwrap()["currentChanged"], true);
    assert!(restore_reviewed(&h));
    let restored = h.engine.get("n3-test").unwrap();
    assert_eq!(fs::read_to_string(&state).unwrap(), "before");
    assert_eq!(restored.phase, "ready");
    assert_eq!(restored.snapshot_id.as_deref(), Some("player-adjustments-after-assembly"));
    assert_eq!(restored.selection, None);
    assert_eq!(restored.snapshot_selection, Some(selection()));
    assert!(restored.confirmed_digest.is_none());
    assert!(restored.revision > run.revision);
    // A new reviewed restore returns to the actual edited state, not merely
    // the last VUA-produced result. The original materials remain unrelated.
    assert!(restore_reviewed(&h));
    assert_eq!(fs::read_to_string(&state).unwrap(), "player-adjustments-after-assembly");
    assert_eq!(h.engine.get("n3-test").unwrap().selection, Some(selection()));
}

#[test]
fn restore_rejects_drift_and_old_confirmations_before_snapshot_or_mutation() {
    let h = Harness::new();
    let run = assembled(&h);
    let plan = h.engine.rollback_plan("n3-test").unwrap();
    let digest = plan["planDigest"].as_str().unwrap().to_owned();
    let count = h.platform.snapshots.load(Ordering::SeqCst);
    let state = Path::new(&run.project_root).join("Assets/state");
    fs::write(&state, "newer-unreviewed-change").unwrap();
    assert!(!h.job(move |engine, ctx| engine.rollback("n3-test", &digest, ctx)));
    assert_eq!(h.platform.snapshots.load(Ordering::SeqCst), count);
    assert_eq!(fs::read_to_string(&state).unwrap(), "newer-unreviewed-change");
    let digest = h.engine.rollback_plan("n3-test").unwrap()["planDigest"].as_str().unwrap().to_owned();
    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    assert!(!h.job(move |engine, ctx| engine.rollback("n3-test", &digest, ctx)));
    assert_eq!(h.platform.snapshots.load(Ordering::SeqCst), count);
}

#[test]
fn partial_restore_and_failed_verification_recover_the_protected_current_state() {
    for fail_inspection in [false, true] {
        let h = Harness::new();
        let run = assembled(&h);
        let state = Path::new(&run.project_root).join("Assets/state");
        fs::write(&state, "latest-player-work").unwrap();
        h.platform.fail_inspect.store(fail_inspection, Ordering::SeqCst);
        h.platform.fail_restore.store(!fail_inspection, Ordering::SeqCst);
        assert!(!restore_reviewed(&h));
        let failed = h.engine.get("n3-test").unwrap();
        assert_eq!(fs::read_to_string(&state).unwrap(), "latest-player-work");
        assert_eq!(failed.phase, "failed");
        assert_eq!(failed.recovery.as_deref(), Some("restored"));
        assert_eq!(failed.snapshot_id.as_deref(), Some("latest-player-work"));
        assert!(failed.result.is_null());
        assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    }
}

#[test]
fn preparation_without_a_snapshot_does_not_offer_a_restore() {
    let h = Harness::new();
    h.prepared();
    assert!(h.engine.rollback_plan("n3-test").is_err());
}

#[test]
fn recipes_require_current_observations_and_reopen_with_pinned_inputs() {
    let h = Harness::new(); h.prepared();
    assert!(h.engine.save_recipe("n3-test", "recipe-test", "My Avatar").is_err());
    let plan = h.engine.plan("n3-test", &selection()).unwrap(); let digest = plan["planDigest"].as_str().unwrap().to_owned();
    assert!(h.job(move |engine, ctx| engine.assemble("n3-test", selection(), &digest, ctx)));
    let saved = h.engine.save_recipe("n3-test", "recipe-test", "My Avatar").unwrap();
    assert_eq!(h.engine.get_recipe("recipe-test").unwrap(), saved);
    assert_eq!(saved.recipe["materials"][0]["sha256"].as_str().unwrap().len(), 64);
    assert!(!saved.recipe.to_string().contains(&h.root.to_string_lossy().to_string()));
    h.engine.begin_recipe("n3-recipe", "recipe-test", "synthetic-editor").unwrap();
    assert!(h.job(|engine, ctx| engine.prepare("n3-recipe", ctx)));
    let reproduced = h.engine.get("n3-recipe").unwrap();
    assert_eq!(reproduced.phase, "ready"); assert_eq!(reproduced.selection, Some(selection()));
    assert_eq!(reproduced.package_pins["nadena.dev.modular-avatar"], "1.18.7");
    h.engine.begin_recipe("n3-recipe-drift", "recipe-test", "synthetic-editor").unwrap();
    h.platform.change_recipe_input.store(true, Ordering::SeqCst);
    assert!(!h.job(|engine, ctx| engine.prepare("n3-recipe-drift", ctx)));
    let drift = h.engine.get("n3-recipe-drift").unwrap();
    assert!(drift.error.unwrap().contains("recipe_material_changed"));
    assert!(!drift.steps.iter().any(|step| step.key == "inspect"), "Changed Recipe originals must be refused before Unity inspection");
    fs::write(h.root.join("production/projects/n3-test/Assets/state"), "external edit").unwrap();
    assert_eq!(h.engine.save_recipe("n3-test", "recipe-stale", "Stale").unwrap_err().code, "vua.amf_production.inspect_required");
    let restarted = AmfProductionEngine::new(h.root.join("production"), h.platform.clone());
    assert_eq!(restarted.get_recipe("recipe-test").unwrap(), saved);
}

#[test]
fn sharing_supplements_only_referenced_inputs_and_remembers_confirmed_choices() {
    use std::collections::BTreeMap;
    use vua_orchestrator::amf_recipe_share::SharedRecipe;
    let h = Harness::new(); assembled(&h);
    h.engine.save_recipe("n3-test", "recipe-share", "A shareable Avatar").unwrap();
    let plan = h.engine.recipe_share_plan("recipe-share").unwrap();
    assert_eq!(plan.materials.len(), 2); assert!(plan.materials.iter().all(|m| m.selected_product_id.is_none()));
    assert!(h.engine.export_recipe("recipe-share", &plan.plan_digest, &BTreeMap::new()).is_err());
    let choices = plan.materials.iter().map(|m| (m.material_id.clone(), "1000001".into())).collect::<BTreeMap<_,_>>();
    let mut foreign = choices.clone(); foreign.insert(format!("m-{}", "c".repeat(64)), "1000002".into());
    assert!(h.engine.export_recipe("recipe-share", &plan.plan_digest, &foreign).is_err());
    assert!(h.engine.recipe_share_plan("recipe-share").unwrap().materials.iter().all(|m| m.selected_product_id.is_none()));
    let export = h.engine.export_recipe("recipe-share", &plan.plan_digest, &choices).unwrap();
    assert_eq!(SharedRecipe::decode(&export.share_code).unwrap(), SharedRecipe::decode(&export.file_text).unwrap());
    assert!(!export.file_text.contains(&h.root.to_string_lossy().to_string()));
    assert!(!export.file_text.contains("GlobalObjectId")); assert!(!export.file_text.contains("sourceId"));
    let restarted = AmfProductionEngine::new(h.root.join("production"), h.platform.clone());
    let remembered = restarted.recipe_share_plan("recipe-share").unwrap();
    assert!(remembered.materials.iter().all(|m| m.selected_product_id.as_deref() == Some("1000001")));
    assert!(restarted.export_recipe("recipe-share", &plan.plan_digest, &BTreeMap::new()).is_err(), "An obsolete source review cannot be replayed");
    restarted.export_recipe("recipe-share", &remembered.plan_digest, &BTreeMap::new()).unwrap();
    restarted.save_recipe("n3-test", "recipe-another", "Another combination").unwrap();
    assert!(restarted.recipe_share_plan("recipe-another").unwrap().materials.iter().all(|m| m.selected_product_id.is_some()));
    let recipient = Harness::new();
    let imported = recipient.engine.import_recipe(&export.share_code).unwrap();
    assert_eq!(recipient.engine.import_recipe(&export.file_text).unwrap(), imported);
    assert!(recipient.engine.list().unwrap().is_empty(), "Importing a declaration never prepares or edits a Unity project");
    assert_eq!(imported.recipe["outfits"], export.document.recipe.outfits.into_iter().map(|o| serde_json::to_value(o).unwrap()).collect::<serde_json::Value>());
    let id = imported.recipe["recipeId"].as_str().unwrap();
    recipient.engine.begin_recipe("n3-imported", id, "synthetic-editor").unwrap();
    assert!(recipient.job(|engine, ctx| engine.prepare("n3-imported", ctx)));
    assert_eq!(recipient.engine.get("n3-imported").unwrap().selection, Some(selection()));
}

#[test]
fn recipe_application_binds_current_facts_and_recovers_failed_mutations() {
    use vua_orchestrator::amf_recipe_apply::RecipeApplyChoice;
    let h=Harness::new();h.prepared();
    let digest=plan_digest(&h.engine.get("n3-test").unwrap(),&selection()).unwrap();
    assert!(h.job(move |engine,ctx| engine.assemble("n3-test",selection(),&digest,ctx)));
    h.engine.save_recipe("n3-test","recipe-apply","Retained recipe").unwrap();
    let plan=h.engine.recipe_apply_plan("n3-test","recipe-apply").unwrap();
    let snapshots=h.platform.snapshots.load(Ordering::SeqCst);
    assert_eq!(h.engine.get("n3-test").unwrap().phase,"succeeded","Review does not mutate the run");
    assert!(h.job(|engine,ctx|engine.reinspect("n3-test",ctx)));
    assert!(!h.job(move|engine,ctx|engine.apply_recipe("n3-test","recipe-apply",RecipeApplyChoice::RecipeWins,&plan.plan_digest,ctx)));
    assert_eq!(h.platform.snapshots.load(Ordering::SeqCst),snapshots,"Stale comparisons fail before a snapshot or any write");
    let plan=h.engine.recipe_apply_plan("n3-test","recipe-apply").unwrap();
    assert!(h.job(move|engine,ctx|engine.apply_recipe("n3-test","recipe-apply",RecipeApplyChoice::AvatarWins,&plan.plan_digest,ctx)));
    assert_eq!(h.engine.get("n3-test").unwrap().result["facts"]["avatarGlobalObjectId"],"synthetic-avatar");
    let plan=h.engine.recipe_apply_plan("n3-test","recipe-apply").unwrap();
    h.platform.fail.store(true,Ordering::SeqCst);
    assert!(!h.job(move|engine,ctx|engine.apply_recipe("n3-test","recipe-apply",RecipeApplyChoice::NewAvatar,&plan.plan_digest,ctx)));
    let run=h.engine.get("n3-test").unwrap();assert_eq!(run.recovery.as_deref(),Some("restored"));
    assert_eq!(h.platform.fingerprint(Path::new(&run.project_root)).unwrap(),"after");
}

fn flow_schema(name: &str) -> jsonschema::Validator {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/amf-production-flow/v0.1").join(name);
    jsonschema::validator_for(&serde_json::from_slice(&fs::read(path).unwrap()).unwrap()).unwrap()
}

#[test]
fn progress_and_status_vectors_accept_stage_facts_and_refuse_log_text() {
    for (schema, folder) in [("progress.schema.json", "progress-examples"), ("status.schema.json", "status-examples")] {
        let validator = flow_schema(schema);
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/amf-production-flow/v0.1").join(folder);
        for entry in fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            let valid = path.file_name().unwrap().to_string_lossy().contains(".valid.");
            assert_eq!(validator.is_valid(&value), valid, "{}", path.display());
        }
    }
}

/// Starts a job and returns its task identity and a receiver for its outcome.
fn started(
    h: &Harness,
    action: impl FnOnce(&AmfProductionEngine, &TaskContext) -> Result<(), AppErrorV1> + Send + 'static,
) -> (String, std::sync::mpsc::Receiver<Result<(), AppErrorV1>>) {
    let engine = h.engine.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let accepted = h.runtime.submit(SubmitRequest {
        correlation_id: None,
        timeout: None,
        job: Box::new(move |ctx| {
            let result = action(&engine, ctx);
            tx.send(result.clone()).unwrap();
            result.map(|()| TaskExit::Done(serde_json::json!({"synthetic":true})))
        }),
    }).unwrap();
    (accepted.task_id, rx)
}

/// Waits for the job's first Unity progress event and returns its payload.
fn unity_event(events: &std::sync::mpsc::Receiver<vua_orchestrator::TaskEventV1>) -> serde_json::Value {
    loop {
        let event = events.recv_timeout(Duration::from_secs(5)).expect("Unity progress");
        if event.kind == vua_orchestrator::TaskEventKind::Progress && event.payload.get("unity").is_some() {
            return event.payload;
        }
    }
}

#[test]
fn a_stopped_unity_step_keeps_the_project_and_continue_reinspects_it() {
    let h = Harness::new();
    h.prepared();
    let prepared = h.engine.get("n3-test").unwrap();
    let state = Path::new(&prepared.project_root).join("Assets/state");
    let events = h.runtime.subscribe();
    h.platform.wait_for_stop.store(true, Ordering::SeqCst);
    let (task, outcome) = started(&h, |engine, ctx| engine.reinspect("n3-test", ctx));

    let payload = unity_event(&events);
    assert!(flow_schema("progress.schema.json").is_valid(&payload), "{payload}");
    assert_eq!((payload["step"].as_str(), payload["unity"]["stage"].as_str()), (Some("reinspect"), Some("importing")));
    let running = h.engine.get("n3-test").unwrap();
    assert_eq!(running.phase, "inspecting");
    let progress = h.engine.progress(&running).expect("the running step's progress");
    assert_eq!(progress["step"], "reinspect");
    assert_eq!(progress["unity"]["total"], 379);
    assert!(progress["elapsedSeconds"].as_u64().is_some());
    assert!(progress["usualSeconds"].is_null(), "no earlier reinspection finished on this computer");

    h.runtime.cancel(&task).unwrap();
    let error = outcome.recv_timeout(Duration::from_secs(5)).unwrap().unwrap_err();
    assert_eq!(error.code, "vua.task.cancelled");
    let stopped = h.engine.get("n3-test").unwrap();
    assert_eq!(stopped.phase, "stopped");
    assert_eq!(stopped.error, None);
    let step = stopped.steps.last().unwrap();
    assert_eq!((step.key.as_str(), step.state.as_str()), ("reinspect", "stopped"));
    assert!(step.ended_at.is_some());
    assert!(h.engine.progress(&stopped).is_none(), "a stopped run has no running step");
    assert_eq!(fs::read_to_string(&state).unwrap(), "before", "the work project stays");
    assert_eq!(stopped.sources.len(), 2, "the imported materials stay");
    assert!(h.engine.rollback_plan("n3-test").is_err(), "preparation alone has no restore point");

    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)), "continue reinspects the retained project");
    let continued = h.engine.get("n3-test").unwrap();
    assert_eq!(continued.phase, "ready");
    assert_eq!(continued.steps.last().unwrap().state, "succeeded");
    assert!(h.engine.plan("n3-test", &selection()).is_ok());
}

#[test]
fn stopping_assembly_restores_the_protected_project() {
    let h = Harness::new();
    h.prepared();
    let run = h.engine.get("n3-test").unwrap();
    let digest = plan_digest(&run, &selection()).unwrap();
    let events = h.runtime.subscribe();
    h.platform.wait_for_stop.store(true, Ordering::SeqCst);
    let (task, outcome) = started(&h, move |engine, ctx| engine.assemble("n3-test", selection(), &digest, ctx));
    assert_eq!(unity_event(&events)["step"], "assembly");
    h.runtime.cancel(&task).unwrap();
    assert!(outcome.recv_timeout(Duration::from_secs(5)).unwrap().is_err());
    let stopped = h.engine.get("n3-test").unwrap();
    assert_eq!(stopped.phase, "stopped");
    assert_eq!(stopped.recovery.as_deref(), Some("restored"));
    assert_eq!(fs::read_to_string(Path::new(&run.project_root).join("Assets/state")).unwrap(), "before");
    assert!(h.engine.plan("n3-test", &selection()).is_err(), "a stopped assembly needs reinspection before a new plan");
    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    assert_eq!(h.engine.get("n3-test").unwrap().phase, "ready");
}

#[test]
fn steps_record_their_times_and_usual_durations_take_the_median_of_finished_steps() {
    let h = Harness::new();
    h.prepared();
    let run = h.engine.get("n3-test").unwrap();
    assert_eq!(run.steps.iter().map(|s| s.key.as_str()).collect::<Vec<_>>(), ["project", "materials", "inspect"]);
    let millis = |text: &Option<String>| text.as_deref().and_then(vua_orchestrator::rfc3339_millis).unwrap();
    for step in &run.steps {
        assert!(millis(&step.started_at) <= millis(&step.ended_at));
    }
    let mut view = serde_json::to_value(&run).unwrap();
    view["usualDurations"] = serde_json::to_value(h.engine.usual_durations()).unwrap();
    view["progress"] = serde_json::Value::Null;
    assert!(flow_schema("status.schema.json").is_valid(&view), "{view}");
    let usual = h.engine.usual_durations();
    assert_eq!(usual.keys().map(String::as_str).collect::<Vec<_>>(), ["inspect", "materials", "project"]);

    // Earlier runs on this computer: inspections of 60, 300 and 120 seconds, and steps that do
    // not count — a failed one, a stopped one and one recorded before step times existed.
    let record = |id: &str, steps: serde_json::Value| {
        let mut other = serde_json::to_value(&run).unwrap();
        other["runId"] = id.into();
        other["projectRoot"] = h.root.join("production/projects").join(id).to_string_lossy().into_owned().into();
        other["steps"] = steps;
        fs::write(h.root.join("production/runs").join(format!("{id}.json")), serde_json::to_vec(&other).unwrap()).unwrap();
    };
    let step = |state: &str, start: &str, end: &str| serde_json::json!({"key":"inspect","name":"Inspect","state":state,"detail":"",
        "startedAt":format!("2026-10-17T{start}.000Z"),"endedAt":format!("2026-10-17T{end}.000Z")});
    record("n3-earlier-1", serde_json::json!([step("succeeded", "08:00:00", "08:01:00"), step("failed", "09:00:00", "10:00:00")]));
    record("n3-earlier-2", serde_json::json!([step("succeeded", "08:00:00", "08:05:00"), step("stopped", "09:00:00", "09:30:00")]));
    record("n3-earlier-3", serde_json::json!([step("succeeded", "08:00:00", "08:02:00"), {"key":"inspect","name":"Inspect","state":"succeeded","detail":""}]));
    // This run's own inspection took well under a minute, so it is the shortest of four.
    assert_eq!(h.engine.usual_durations()["inspect"], 90, "the median of four finished inspections");
    record("n3-earlier-4", serde_json::json!([step("succeeded", "08:00:00", "08:10:00")]));
    assert_eq!(h.engine.usual_durations()["inspect"], 120, "a new record replaces the cached medians");
    assert!(h.engine.get("n3-earlier-3").unwrap().steps[1].started_at.is_none(), "records without step times still read");
}

#[test]
fn every_step_the_engine_records_is_in_the_published_status_schema() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let schema: serde_json::Value = serde_json::from_str(&fs::read_to_string(root.join("../../schemas/amf-production-flow/v0.1/status.schema.json")).unwrap()).unwrap();
    let text = schema.to_string();
    let mut sources = vec![root.join("src/amf_production.rs")];
    sources.extend(fs::read_dir(root.join("src/amf_production")).unwrap().map(|entry| entry.unwrap().path()));
    let marker = "self.step(&mut run, ctx, \"";
    let mut keys = Vec::new();
    for source in sources {
        let code = fs::read_to_string(source).unwrap();
        for part in code.split(marker).skip(1) {
            keys.push(part.split('"').next().unwrap().to_owned());
        }
    }
    assert!(keys.len() >= 8, "found the engine's steps: {keys:?}");
    for key in keys {
        assert!(text.contains(&format!("\"{key}\"")), "status.schema.json lists the step key {key}");
    }
}

#[test]
fn a_v1_record_compares_by_computing_v1_once_and_then_carries_the_current_value() {
    let h = Harness::new();
    h.prepared();
    let record = h.root.join("production/runs/n3-test.json");
    let carry = |value: &str| {
        let mut run: serde_json::Value = serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
        run["projectFingerprint"] = value.into();
        run["snapshotId"] = "n3-snap".into();
        fs::write(&record, serde_json::to_vec_pretty(&run).unwrap()).unwrap();
    };
    // A record from before the cached fingerprint, on a project nobody touched.
    carry("sha256:before");
    let plan = h.engine.rollback_plan("n3-test").unwrap();
    assert_eq!(plan["currentChanged"], false, "a new algorithm must not read as a changed project");
    // The gate passes and upgrades the record; this synthetic run has not been assembled,
    // so building the Recipe itself declines for its own reason.
    let refused = h.engine.save_recipe("n3-test", "recipe-migrated", "Migrated").unwrap_err();
    assert_ne!(refused.code, "vua.amf_production.inspect_required", "the fingerprint gate accepted the legacy value");
    assert_eq!(h.engine.get("n3-test").unwrap().project_fingerprint, "before", "the record carries the current value after the match");
    // A record whose project really changed still reports the change, in either algorithm.
    carry("sha256:before");
    fs::write(h.root.join("production/projects/n3-test/Assets/state"), "external edit").unwrap();
    assert_eq!(h.engine.rollback_plan("n3-test").unwrap()["currentChanged"], true);
    assert_eq!(h.engine.save_recipe("n3-test", "recipe-stale", "Stale").unwrap_err().code, "vua.amf_production.inspect_required");
}

#[test]
fn the_after_unity_project_check_shows_as_its_own_stage() {
    let h = Harness::new();
    h.prepared();
    let events = h.runtime.subscribe();
    assert!(h.job(|engine, ctx| engine.reinspect("n3-test", ctx)));
    let mut stages = Vec::new();
    while let Ok(event) = events.try_recv() {
        if event.kind == vua_orchestrator::TaskEventKind::Progress
            && event.payload.get("unity").is_some()
        {
            stages.push(event.payload["unity"]["stage"].clone());
        }
    }
    assert_eq!(stages, vec![serde_json::json!("fingerprint")], "the check is a named stage, and the only Unity stage of a synthetic reinspection");
}

//! Synthetic release tests: turntable records and managed uploads. No Unity, SDK or VRChat call.
#![allow(clippy::result_large_err)]
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use vua_orchestrator::{
    amf_production::*, AppErrorV1, NanosTaskIdGenerator, SqliteTaskStore, SubmitRequest,
    SystemClock, TaskContext, TaskExit, TaskRuntime,
};

const RUN: &str = "n3-release";
const AVATAR_ID: &str = "avtr_0d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6";

struct ReleasePlatform {
    editor_open: AtomicBool,
    turntable_scene: Mutex<String>,
    turntable_folder: Mutex<String>,
    receipt: Mutex<Option<UploadReceipt>>,
    requests: Mutex<Vec<UploadRequest>>,
}
impl ReleasePlatform {
    fn new() -> Self {
        Self {
            editor_open: AtomicBool::new(false),
            turntable_scene: Mutex::new("scene-1".into()),
            turntable_folder: Mutex::new(".vua/turntables/cmd-2".into()),
            receipt: Mutex::new(None),
            requests: Mutex::new(Vec::new()),
        }
    }
}
fn unused<T>() -> Result<T, AppErrorV1> {
    Err(production_error("test_unused", "Not part of release tests."))
}
impl AmfProductionPlatform for ReleasePlatform {
    fn sources(&self) -> Result<Vec<ProductionSource>, AppErrorV1> { Ok(Vec::new()) }
    fn editors(&self) -> Result<Vec<ProductionEditor>, AppErrorV1> { Ok(vec![self.verify_editor("synthetic-editor")?]) }
    fn verify_editor(&self, path: &str) -> Result<ProductionEditor, AppErrorV1> {
        Ok(ProductionEditor { path: path.into(), version: "2022.3.22f1c1".into() })
    }
    fn create_project(&self, _: &ProductionRun, _: &TaskContext) -> Result<(), AppErrorV1> { unused() }
    fn import_sources(&self, _: &ProductionRun, _: &TaskContext) -> Result<Vec<PreparedSource>, AppErrorV1> { unused() }
    fn inspect(&self, _: &ProductionRun, _: &UnityWatch) -> Result<ObservedProject, AppErrorV1> { unused() }
    fn assemble(&self, _: &ProductionRun, _: &AssemblySelection, _: &UnityWatch) -> Result<ObservedProject, AppErrorV1> { unused() }
    fn fingerprint(&self, project: &Path) -> Result<String, AppErrorV1> {
        fs::read_to_string(project.join("Assets/state")).map_err(|e| production_error("test_io", e.to_string()))
    }
    fn fingerprint_legacy(&self, project: &Path) -> Result<String, AppErrorV1> {
        self.fingerprint(project)
    }
    fn snapshot(&self, _: &ProductionRun) -> Result<String, AppErrorV1> { unused() }
    fn restore(&self, _: &ProductionRun, _: &str) -> Result<(), AppErrorV1> { unused() }
    fn open(&self, _: &ProductionRun, _: &TaskContext) -> Result<serde_json::Value, AppErrorV1> { unused() }
    fn turntable(&self, run: &ProductionRun, _: &UnityWatch) -> Result<ObservedProject, AppErrorV1> {
        let folder = self.turntable_folder.lock().unwrap().clone();
        let target = Path::new(&run.project_root).join(&folder);
        if fs::create_dir_all(&target).is_ok() {
            for index in 0..TURNTABLE_FRAMES {
                fs::write(target.join(format!("frame-{index:02}.png")), b"\x89PNG\r\n\x1a\nframe").unwrap();
            }
        }
        Ok(ObservedProject {
            prefabs: Vec::new(),
            unity_fingerprint: self.turntable_scene.lock().unwrap().clone(),
            editor_version: "2022.3.22f1c1".into(),
            result: json!({"facts":{"turntable":{"folder":folder,"frames":60,"size":512},"previews":[]}}),
        })
    }
    fn upload(&self, _: &ProductionRun, request: &UploadRequest, _: &TaskContext, progress: &mut dyn FnMut(UploadProgress)) -> Result<UploadReceipt, AppErrorV1> {
        self.requests.lock().unwrap().push(request.clone());
        for (stage, share) in [("sdk_panel", None), ("building", None), ("uploading", Some(0.5)), ("uploading", Some(0.5)), ("unknown_stage", None)] {
            progress(UploadProgress { stage: stage.into(), progress: share, status: "Synthetic\u{0007} status".into() });
        }
        self.receipt.lock().unwrap().clone().ok_or_else(|| production_error("upload_timeout", "Unity did not answer."))
    }
    fn editor_open(&self, _: &Path) -> bool { self.editor_open.load(Ordering::SeqCst) }
}

struct Harness {
    root: PathBuf,
    engine: Arc<AmfProductionEngine>,
    platform: Arc<ReleasePlatform>,
    runtime: TaskRuntime,
}
impl Harness {
    fn new() -> Self {
        static NEXT_ROOT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!("vua-release-test-{}-{}-{}", std::process::id(), NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap();
        let platform = Arc::new(ReleasePlatform::new());
        let engine = Arc::new(AmfProductionEngine::new(root.join("production"), platform.clone()));
        let runtime = TaskRuntime::with_sqlite(Arc::new(SqliteTaskStore::open(root.join("tasks.db")).unwrap()),
            Arc::new(SystemClock), Arc::new(NanosTaskIdGenerator::default())).unwrap();
        let harness = Self { root, engine, platform, runtime };
        harness.finished_run("succeeded");
        harness
    }
    fn project(&self) -> PathBuf { self.root.join("production/projects").join(RUN) }
    /// A finished run as assembly leaves it: scene "scene-1", project state "assembled".
    fn finished_run(&self, phase: &str) {
        let project = self.project();
        fs::create_dir_all(project.join("Assets")).unwrap();
        fs::create_dir_all(project.join(".vua/previews/cmd-0")).unwrap();
        fs::write(project.join("Assets/state"), "assembled").unwrap();
        fs::write(project.join(".vua/previews/cmd-0/front.png"), b"\x89PNG\r\n\x1a\nfront").unwrap();
        let run = json!({"schemaVersion":"0.1", "runId":RUN, "phase":phase, "taskId":"task-0",
            "editor":{"path":"synthetic-editor","version":"2022.3.22f1c1"}, "projectRoot":project.to_string_lossy(),
            "choices":[], "sources":[], "prefabs":[], "projectFingerprint":"assembled", "unityFingerprint":"scene-1",
            "steps":[], "selection":null, "confirmedDigest":null, "error":null, "recovery":null,
            "result":{"facts":{"avatarGlobalObjectId":"GlobalObjectId_V1-avatar", "previews":[{"view":"front","path":".vua/previews/cmd-0/front.png"}]}}});
        fs::create_dir_all(self.root.join("production/runs")).unwrap();
        fs::write(self.root.join("production/runs").join(format!("{RUN}.json")), serde_json::to_vec(&run).unwrap()).unwrap();
    }
    fn job(&self, action: impl FnOnce(&AmfProductionEngine, &TaskContext) -> Result<(), AppErrorV1> + Send + 'static) -> Result<(), String> {
        let engine = self.engine.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        self.runtime.submit(SubmitRequest { correlation_id: None, timeout: None, job: Box::new(move |ctx| {
            let result = action(&engine, ctx);
            tx.send(result.as_ref().map(|_| ()).map_err(|error| error.code.clone())).unwrap();
            result.map(|()| TaskExit::Done(json!({"synthetic":true})))
        }) }).unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap()
    }
    fn bake(&self) -> Result<(), String> { self.job(|engine, ctx| engine.bake_turntable(RUN, ctx)) }
    fn upload(&self, name: &'static str) -> Result<(), String> { self.job(move |engine, ctx| engine.upload(RUN, name, ctx)) }
    fn receipt(&self, outcome: &str, blueprint: Option<&str>, reason: Option<&str>) {
        *self.platform.receipt.lock().unwrap() = Some(UploadReceipt { outcome: outcome.into(), blueprint_id: blueprint.map(str::to_owned),
            first_upload: true, reason: reason.map(str::to_owned), detail: "SDK said\u{0000} so".into(), errors: vec!["Too many materials".into()],
            sdk_sign_in: Some("panel".into()) });
    }
}
impl Drop for Harness {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); }
}

#[test]
fn a_baked_turntable_is_recorded_and_its_frames_are_read_from_its_folder() {
    let h = Harness::new();
    fs::create_dir_all(h.project().join(".vua/turntables/cmd-1")).unwrap();
    assert_eq!(h.bake(), Ok(()));
    let state = h.engine.release_state(RUN).unwrap();
    assert_eq!(state["turntable"]["frames"], 60);
    assert_eq!(state["turntable"]["size"], 512);
    assert_eq!(state["turntable"]["current"], true);
    assert!(!h.project().join(".vua/turntables/cmd-1").exists(), "earlier turntables are removed");
    assert!(h.engine.turntable_frame(RUN, 0).unwrap().starts_with(b"\x89PNG"));
    assert!(h.engine.turntable_frame(RUN, 59).is_ok());
    assert_eq!(h.engine.turntable_frame(RUN, 60).unwrap_err().code, "vua.amf_production.turntable_invalid");
    fs::write(h.project().join(".vua/turntables/cmd-2/frame-03.png"), b"not an image").unwrap();
    assert_eq!(h.engine.turntable_frame(RUN, 3).unwrap_err().code, "vua.amf_production.turntable_invalid");
    let run = h.engine.get(RUN).unwrap();
    assert_eq!(run.phase, "succeeded");
    assert_eq!((run.steps.last().unwrap().key.as_str(), run.steps.last().unwrap().state.as_str()), ("turntable", "succeeded"));
}

#[test]
fn a_turntable_waits_for_a_closed_unchanged_project_and_a_finished_avatar() {
    let h = Harness::new();
    h.platform.editor_open.store(true, Ordering::SeqCst);
    assert_eq!(h.engine.precheck_turntable(RUN).unwrap_err().code, "vua.amf_production.project_open");
    h.platform.editor_open.store(false, Ordering::SeqCst);
    fs::write(h.project().join("Assets/state"), "edited in Unity").unwrap();
    assert_eq!(h.engine.precheck_turntable(RUN).unwrap_err().code, "vua.amf_production.project_drift");
    h.finished_run("ready");
    assert_eq!(h.engine.precheck_turntable(RUN).unwrap_err().code, "vua.amf_production.result_not_ready");
}

#[test]
fn a_turntable_of_another_scene_or_outside_its_folder_is_not_recorded() {
    let h = Harness::new();
    *h.platform.turntable_scene.lock().unwrap() = "scene-2".into();
    assert_eq!(h.bake(), Err("vua.amf_production.project_drift".into()));
    assert!(h.engine.release_state(RUN).unwrap()["turntable"].is_null());
    let run = h.engine.get(RUN).unwrap();
    assert_eq!(run.phase, "succeeded", "a failed bake leaves the finished Avatar as it is");
    assert_eq!(run.steps.last().unwrap().state, "failed");

    *h.platform.turntable_scene.lock().unwrap() = "scene-1".into();
    for folder in [".vua/turntables/../previews", ".vua/previews/cmd-9", ".vua/turntables/a/b", ".vua/turntables/"] {
        *h.platform.turntable_folder.lock().unwrap() = folder.into();
        assert_eq!(h.bake(), Err("vua.amf_production.receipt_invalid".into()), "{folder}");
    }
    let project = h.project();
    let facts = json!({"folder":".vua/turntables/cmd-3","frames":60,"size":512});
    fs::create_dir_all(project.join(".vua/turntables/cmd-3")).unwrap();
    for index in 0..59 {
        fs::write(project.join(format!(".vua/turntables/cmd-3/frame-{index:02}.png")), b"\x89PNG\r\n\x1a\n").unwrap();
    }
    assert_eq!(turntable_from_facts(&facts, &project, "scene-1", "now").unwrap_err().code, "vua.amf_production.receipt_invalid", "a missing frame");
    fs::write(project.join(".vua/turntables/cmd-3/frame-59.png"), b"\x89PNG\r\n\x1a\n").unwrap();
    assert!(turntable_from_facts(&facts, &project, "scene-1", "now").is_ok());
    assert!(turntable_from_facts(&json!({"folder":".vua/turntables/cmd-3","frames":30,"size":512}), &project, "scene-1", "now").is_err());
    assert!(turntable_from_facts(&json!({"folder":".vua/turntables/cmd-3","frames":60,"size":1024}), &project, "scene-1", "now").is_err());
    assert_eq!(turntable_file(&project, "../cmd-3", 0).unwrap_err().code, "vua.amf_production.turntable_invalid");
}

#[test]
fn an_upload_records_the_sdk_receipt_and_keeps_the_finished_avatar() {
    let h = Harness::new();
    h.receipt("succeeded", Some(AVATAR_ID), None);
    assert_eq!(h.upload("Meiyun T-shirt"), Ok(()));
    let request = h.platform.requests.lock().unwrap()[0].clone();
    assert_eq!(request.avatar_name, "Meiyun T-shirt");
    assert_eq!(request.thumbnail.as_deref(), Some(".vua/previews/cmd-0/front.png"));
    let state = h.engine.release_state(RUN).unwrap();
    let upload = &state["uploads"][0];
    assert_eq!(upload["state"], "succeeded");
    assert_eq!(upload["blueprintId"], AVATAR_ID);
    assert_eq!(upload["firstUpload"], true);
    assert_eq!(upload["avatarName"], "Meiyun T-shirt");
    assert_eq!(upload["detail"], "SDK said so", "control characters are left out");
    let run = h.engine.get(RUN).unwrap();
    assert_eq!(run.phase, "succeeded");
    assert_eq!((run.steps.last().unwrap().key.as_str(), run.steps.last().unwrap().state.as_str()), ("upload", "succeeded"));
}

#[test]
fn a_failed_upload_names_its_reason_and_success_needs_an_avatar_id() {
    let h = Harness::new();
    h.receipt("failed", None, Some("validation"));
    assert_eq!(h.upload("Meiyun"), Err("vua.amf_production.upload_failed".into()));
    let state = h.engine.release_state(RUN).unwrap();
    assert_eq!(state["uploads"][0]["state"], "failed");
    assert_eq!(state["uploads"][0]["reason"], "validation");
    assert_eq!(state["uploads"][0]["errors"], json!(["Too many materials"]));
    assert_eq!(h.engine.get(RUN).unwrap().phase, "succeeded");

    h.receipt("failed", None, Some("invented_reason"));
    assert!(h.upload("Meiyun").is_err());
    assert_eq!(h.engine.release_state(RUN).unwrap()["uploads"][0]["reason"], "unknown");

    h.receipt("succeeded", Some("avtr_not-an-id"), None);
    assert_eq!(h.upload("Meiyun"), Err("vua.amf_production.receipt_invalid".into()));
    assert_eq!(h.engine.release_state(RUN).unwrap()["uploads"][0]["state"], "failed");

    *h.platform.receipt.lock().unwrap() = None;
    assert_eq!(h.upload("Meiyun"), Err("vua.amf_production.upload_timeout".into()));
    let state = h.engine.release_state(RUN).unwrap();
    assert_eq!(state["uploads"][0]["reason"], "timeout");
    assert_eq!(state["uploads"].as_array().unwrap().len(), 4, "newest first, each upload kept");
}

#[test]
fn an_upload_needs_a_name_and_the_checked_project_unless_unity_holds_it() {
    let h = Harness::new();
    let long = "x".repeat(65);
    for name in ["", " Meiyun", "Meiyun\n", long.as_str()] {
        assert_eq!(h.engine.precheck_upload(RUN, name).unwrap_err().code, "vua.amf_production.avatar_name_invalid", "{name:?}");
    }
    assert!(h.engine.precheck_upload(RUN, &"名".repeat(64)).is_ok());
    fs::write(h.project().join("Assets/state"), "edited in Unity").unwrap();
    assert_eq!(h.engine.precheck_upload(RUN, "Meiyun").unwrap_err().code, "vua.amf_production.project_drift");
    h.platform.editor_open.store(true, Ordering::SeqCst);
    assert!(h.engine.precheck_upload(RUN, "Meiyun").is_ok(), "the SDK uploads the scene open in Unity");
    assert_eq!(h.engine.release_state(RUN).unwrap()["editorOpen"], true);
    h.finished_run("failed");
    assert_eq!(h.engine.precheck_upload(RUN, "Meiyun").unwrap_err().code, "vua.amf_production.result_not_ready");
}

#[test]
fn progress_is_recorded_once_per_change_and_an_unfinished_upload_reads_interrupted() {
    let h = Harness::new();
    let mut record = h.engine.release_record(RUN).unwrap();
    record.uploads.push(serde_json::from_value(json!({"uploadId":"upload-old","avatarName":"Meiyun","startedAt":"2026-10-17T00:00:00Z",
        "state":"running","stage":"building"})).unwrap());
    fs::create_dir_all(h.root.join("production/releases")).unwrap();
    fs::write(h.root.join(format!("production/releases/{RUN}.json")), serde_json::to_vec(&record).unwrap()).unwrap();
    h.receipt("succeeded", Some(AVATAR_ID), None);
    assert_eq!(h.upload("Meiyun"), Ok(()));
    let state = h.engine.release_state(RUN).unwrap();
    assert_eq!(state["uploads"][1]["state"], "failed");
    assert_eq!(state["uploads"][1]["reason"], "interrupted");
    // The last reported stage before the receipt stays readable.
    assert_eq!(state["uploads"][0]["status"], "Synthetic status");
}

#[test]
fn avatar_ids_and_names_have_a_fixed_shape() {
    assert!(is_blueprint_id(AVATAR_ID));
    assert!(is_blueprint_id("avtr_0D1E2F3A-4B5C-4D6E-8F90-A1B2C3D4E5F6"));
    for id in ["", "avtr_", "wrld_0d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6", "avtr_0d1e2f3a4b5c4d6e8f90a1b2c3d4e5f6", "avtr_0d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5fg"] {
        assert!(!is_blueprint_id(id), "{id}");
    }
    assert_eq!(bounded_text("a\u{0001}b\nc", 3), "ab\n");
}

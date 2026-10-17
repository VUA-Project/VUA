//! Managed upload through the open Editor. The VRChat SDK's builder exists only while its control
//! panel is open and signed in, so VUA hands the upload to the Editor: it writes one request beside
//! the Bridge files, the Editor's VUA observer drives the official builder and answers with
//! progress lines and one receipt. The player's rights confirmation precedes the request.
use super::*;
use std::time::{Duration, Instant};

const REQUEST: &str = "amf-upload.json";
const PROGRESS: &str = "amf-upload.progress.json";
const RECEIPT: &str = "amf-upload.result.json";
const CANCEL: &str = "amf-upload.cancel";
/// Unity starting and opening the SDK panel on a slow computer.
const PICKUP_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Signing in, checking, building and uploading together.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(90 * 60);
/// Time the Editor has to end the SDK's work after a stop.
const CANCEL_GRACE: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(250);
const MAX_FILE: u64 = 256 * 1024;

pub(super) fn upload(
    platform: &NativeAmfProduction,
    run: &ProductionRun,
    request: &UploadRequest,
    ctx: &TaskContext,
    progress: &mut dyn FnMut(UploadProgress),
) -> Result<UploadReceipt, AppErrorV1> {
    platform.verify_editor(&run.editor.path)?;
    let avatar = run.result["facts"]["avatarGlobalObjectId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| err("result_invalid", "Result has no Avatar identity."))?;
    let project = Path::new(&run.project_root);
    let open = editor_holds_project(project);
    if !open {
        refresh_bridge_package(project)?;
    }
    let folder = project.join(".vua/bridge");
    fs::create_dir_all(&folder).map_err(|e| err("upload_failed", e))?;
    for name in [RECEIPT, PROGRESS, CANCEL] {
        remove(&folder.join(name))?;
    }
    write_atomic(&folder.join(REQUEST), &request_json(run, request, avatar))?;
    if !open {
        platform.start_unity_hub();
        if std::env::var("VUA_AMF_HANDOFF_FROM_DESKTOP").as_deref() != Ok("1") {
            open_editor(run)?;
        }
    }
    wait(&folder, run, request, ctx, progress)
}

fn remove(path: &Path) -> Result<(), AppErrorV1> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(err("upload_failed", error)),
        _ => Ok(()),
    }
}

fn write_atomic(path: &Path, value: &serde_json::Value) -> Result<(), AppErrorV1> {
    let pending = path.with_extension("pending");
    fs::write(&pending, serde_json::to_vec_pretty(value).map_err(|e| err("upload_failed", e))?).map_err(|e| err("upload_failed", e))?;
    fs::rename(&pending, path).map_err(|e| err("upload_failed", e))
}

/// The request the Editor's observer reads. `rightsConfirmed` records that the player confirmed
/// the content rights statement in VUA for this upload.
fn request_json(run: &ProductionRun, request: &UploadRequest, avatar: &str) -> serde_json::Value {
    serde_json::json!({"schemaVersion":"0.1", "runId":run.run_id, "uploadId":request.upload_id,
        "avatarGlobalObjectId":avatar, "avatarName":request.avatar_name,
        "thumbnail":request.thumbnail.clone().unwrap_or_default(), "rightsConfirmed":true})
}

/// A bounded JSON file that names this run and upload; anything else is an earlier answer.
fn read_bound(path: &Path, run: &ProductionRun, request: &UploadRequest) -> Option<serde_json::Value> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (value["schemaVersion"] == "0.1" && value["runId"] == run.run_id.as_str() && value["uploadId"] == request.upload_id.as_str()).then_some(value)
}

fn read_progress(path: &Path, run: &ProductionRun, request: &UploadRequest) -> Option<UploadProgress> {
    let value = read_bound(path, run, request)?;
    let stage = value["stage"].as_str().filter(|stage| UPLOAD_STAGES.contains(stage))?;
    Some(UploadProgress {
        stage: stage.into(),
        progress: value["progress"].as_f64().filter(|share| (0.0..=1.0).contains(share)),
        status: bounded_text(value["status"].as_str().unwrap_or(""), 200),
    })
}

fn read_receipt(path: &Path, run: &ProductionRun, request: &UploadRequest) -> Result<Option<UploadReceipt>, AppErrorV1> {
    let Some(value) = read_bound(path, run, request) else { return Ok(None); };
    let outcome = value["outcome"].as_str().filter(|outcome| ["succeeded", "failed", "cancelled"].contains(outcome))
        .ok_or_else(|| err("receipt_invalid", "The Editor reported an unknown upload outcome."))?;
    let text = |key: &str| value[key].as_str().filter(|text| !text.is_empty()).map(str::to_owned);
    Ok(Some(UploadReceipt {
        outcome: outcome.into(),
        blueprint_id: text("blueprintId"),
        first_upload: value["firstUpload"].as_bool().unwrap_or(false),
        reason: text("reason"),
        detail: text("detail").unwrap_or_default(),
        errors: value["errors"].as_array().into_iter().flatten().filter_map(|error| error.as_str().map(str::to_owned)).take(32).collect(),
        sdk_sign_in: text("sdkSignIn").filter(|source| source == "vua_session" || source == "panel"),
    }))
}

fn wait(
    folder: &Path,
    run: &ProductionRun,
    request: &UploadRequest,
    ctx: &TaskContext,
    progress: &mut dyn FnMut(UploadProgress),
) -> Result<UploadReceipt, AppErrorV1> {
    let start = Instant::now();
    let mut picked_up = false;
    let mut stopping: Option<(Instant, AppErrorV1)> = None;
    loop {
        if let Some(receipt) = read_receipt(&folder.join(RECEIPT), run, request)? {
            let _ = remove(&folder.join(REQUEST));
            return Ok(receipt);
        }
        if let Some(line) = read_progress(&folder.join(PROGRESS), run, request) {
            picked_up = true;
            progress(line);
        }
        if stopping.is_none() {
            if let Some(error) = ctx.cancellation_error("amf-production") {
                if !picked_up {
                    remove(&folder.join(REQUEST))?;
                    return Err(error);
                }
                write_atomic(&folder.join(CANCEL), &serde_json::json!({"schemaVersion":"0.1", "runId":run.run_id, "uploadId":request.upload_id}))?;
                stopping = Some((Instant::now(), error));
            }
        }
        if let Some((since, error)) = &stopping {
            if since.elapsed() > CANCEL_GRACE {
                let _ = remove(&folder.join(REQUEST));
                return Err(error.clone());
            }
        }
        if !picked_up && start.elapsed() > PICKUP_TIMEOUT {
            remove(&folder.join(REQUEST))?;
            return Err(err("editor_unavailable", "Unity did not open the VRChat SDK for this upload. Open the project in Unity, then upload again."));
        }
        if start.elapsed() > UPLOAD_TIMEOUT {
            let _ = write_atomic(&folder.join(CANCEL), &serde_json::json!({"schemaVersion":"0.1", "runId":run.run_id, "uploadId":request.upload_id}));
            let _ = remove(&folder.join(REQUEST));
            return Err(err("upload_timeout", "The VRChat SDK did not finish the upload within 90 minutes."));
        }
        std::thread::sleep(POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(project: &Path) -> ProductionRun {
        serde_json::from_value(serde_json::json!({"schemaVersion":"0.1", "runId":"n3-upload", "phase":"succeeded", "taskId":"task",
            "editor":{"path":"Unity.exe","version":"2022.3.22f1"}, "projectRoot":project.to_string_lossy(), "choices":[], "sources":[],
            "prefabs":[], "projectFingerprint":"p", "unityFingerprint":"u", "steps":[], "selection":null, "confirmedDigest":null,
            "result":{"facts":{"avatarGlobalObjectId":"GlobalObjectId_V1-avatar"}}, "error":null, "recovery":null})).unwrap()
    }
    fn request(thumbnail: Option<&str>) -> UploadRequest {
        UploadRequest { upload_id: "upload-1".into(), avatar_name: "Meiyun".into(), thumbnail: thumbnail.map(str::to_owned) }
    }
    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("vua-upload-handoff-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn the_request_carries_the_players_confirmation_and_the_new_avatar_thumbnail() {
        let project = folder("request");
        let value = request_json(&run(&project), &request(Some(".vua/previews/cmd/front.png")), "GlobalObjectId_V1-avatar");
        assert_eq!(value["rightsConfirmed"], true);
        assert_eq!(value["uploadId"], "upload-1");
        assert_eq!(value["avatarName"], "Meiyun");
        assert_eq!(value["thumbnail"], ".vua/previews/cmd/front.png");
        assert_eq!(request_json(&run(&project), &request(None), "id")["thumbnail"], "");
        fs::remove_dir_all(project).unwrap();
    }

    #[test]
    fn only_answers_for_this_upload_are_read() {
        let project = folder("answers");
        let (run, request) = (run(&project), request(None));
        let receipt = project.join(RECEIPT);
        fs::write(&receipt, br#"{"schemaVersion":"0.1","runId":"n3-upload","uploadId":"upload-0","outcome":"succeeded"}"#).unwrap();
        assert_eq!(read_receipt(&receipt, &run, &request).unwrap(), None, "an earlier upload's receipt");
        fs::write(&receipt, br#"{"schemaVersion":"0.1","runId":"n3-upload","uploadId":"upload-1","outcome":"done"}"#).unwrap();
        assert_eq!(read_receipt(&receipt, &run, &request).unwrap_err().code, "vua.amf_production.receipt_invalid");
        fs::write(&receipt, br#"{"schemaVersion":"0.1","runId":"n3-upload","uploadId":"upload-1","outcome":"failed","blueprintId":"","reason":"validation",
            "detail":"Avatar validation failed","errors":["Too many materials", 7],"firstUpload":true,"sceneSaved":false,"sdkSignIn":"vua_session"}"#).unwrap();
        let read = read_receipt(&receipt, &run, &request).unwrap().unwrap();
        assert_eq!((read.outcome.as_str(), read.reason.as_deref(), read.blueprint_id), ("failed", Some("validation"), None));
        assert_eq!(read.errors, vec!["Too many materials".to_owned()]);
        assert!(read.first_upload);
        assert_eq!(read.sdk_sign_in.as_deref(), Some("vua_session"));
        fs::write(&receipt, br#"{"schemaVersion":"0.1","runId":"n3-upload","uploadId":"upload-1","outcome":"succeeded","blueprintId":"avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a",
            "sdkSignIn":"somewhere_else"}"#).unwrap();
        let read = read_receipt(&receipt, &run, &request).unwrap().unwrap();
        assert_eq!(read.sdk_sign_in, None, "an unknown sign-in source stays unsaid");
        fs::write(&receipt, vec![b' '; MAX_FILE as usize + 1]).unwrap();
        assert_eq!(read_receipt(&receipt, &run, &request).unwrap(), None, "an oversized file is no answer");

        let line = project.join(PROGRESS);
        fs::write(&line, br#"{"schemaVersion":"0.1","runId":"n3-upload","uploadId":"upload-1","stage":"uploading","progress":0.25,"status":"Uploading bundle"}"#).unwrap();
        assert_eq!(read_progress(&line, &run, &request), Some(UploadProgress { stage: "uploading".into(), progress: Some(0.25), status: "Uploading bundle".into() }));
        fs::write(&line, br#"{"schemaVersion":"0.1","runId":"n3-upload","uploadId":"upload-1","stage":"building","progress":-1,"status":""}"#).unwrap();
        assert_eq!(read_progress(&line, &run, &request).unwrap().progress, None);
        fs::write(&line, br#"{"schemaVersion":"0.1","runId":"n3-upload","uploadId":"upload-1","stage":"dancing"}"#).unwrap();
        assert_eq!(read_progress(&line, &run, &request), None);
        fs::remove_dir_all(project).unwrap();
    }
}

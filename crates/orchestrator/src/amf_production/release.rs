//! Release: finished Avatars leave the factory. The Bridge bakes a 60-frame turntable of the
//! assembled Avatar into the work project, and the official VRChat SDK builds and uploads it from
//! the open Editor after the player confirms the content rights in VUA. The record of both lives
//! beside the run in `releases/<runId>.json`.

use super::*;

/// Turntable frames live in this work-project folder, one subfolder per Bridge command.
pub const TURNTABLE_ROOT: &str = ".vua/turntables";
pub const TURNTABLE_FRAMES: u32 = 60;
pub const TURNTABLE_SIZE: u32 = 512;
pub const MAX_AVATAR_NAME_CHARS: usize = 64;
/// Upload records kept per run, oldest first.
const KEPT_UPLOADS: usize = 20;
const MAX_DETAIL_CHARS: usize = 2000;
const MAX_ERRORS: usize = 32;

/// Where the player is in one upload, in the order they happen.
pub const UPLOAD_STAGES: [&str; 7] = ["starting", "sdk_panel", "sign_in", "checking", "building", "uploading", "finishing"];
/// Why an upload ended without success, in plain categories the release room explains.
pub const UPLOAD_REASONS: [&str; 16] = [
    "sign_in_required", "no_publish_permission", "validation", "ownership", "agreement_declined", "build", "build_blocked",
    "upload", "thumbnail_missing", "avatar_missing", "scene_not_saved", "interrupted", "editor_unavailable", "timeout",
    "cancelled", "unknown",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Turntable {
    pub command_id: String,
    pub frames: u32,
    pub size: u32,
    pub baked_at: String,
    /// The Unity scene the frames show; a later change to the scene makes the turntable earlier work.
    pub unity_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UploadRecord {
    pub upload_id: String,
    pub avatar_name: String,
    pub started_at: String,
    #[serde(default)]
    pub ended_at: Option<String>,
    /// `running`, `succeeded`, `failed` or `cancelled`.
    pub state: String,
    /// One of [`UPLOAD_STAGES`]: the last stage the upload reached.
    pub stage: String,
    /// Upload share from 0 to 1 while the SDK sends the bundle.
    #[serde(default)]
    pub progress: Option<f64>,
    /// The SDK's own short status line.
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub blueprint_id: Option<String>,
    #[serde(default)]
    pub first_upload: Option<bool>,
    /// One of [`UPLOAD_REASONS`] when the upload did not succeed.
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub errors: Vec<String>,
    /// How the SDK panel signed in: `vua_session` (handed over from VUA) or `panel`. Older
    /// records carry nothing.
    #[serde(default)]
    pub sdk_sign_in: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRecord {
    pub schema_version: String,
    pub run_id: String,
    #[serde(default)]
    pub turntable: Option<Turntable>,
    #[serde(default)]
    pub uploads: Vec<UploadRecord>,
}

/// One build-and-upload handed to the Editor. The rights confirmation is the player's own, given
/// in VUA before this request exists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadRequest {
    pub upload_id: String,
    /// The name VRChat gives a new Avatar record; an Avatar already on VRChat keeps its name.
    pub avatar_name: String,
    /// The front preview, used as the thumbnail when VRChat creates a new Avatar record.
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UploadProgress {
    pub stage: String,
    pub progress: Option<f64>,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct UploadReceipt {
    /// `succeeded`, `failed` or `cancelled`.
    pub outcome: String,
    pub blueprint_id: Option<String>,
    pub first_upload: bool,
    pub reason: Option<String>,
    pub detail: String,
    pub errors: Vec<String>,
    /// `vua_session` or `panel`; how the SDK panel reached its sign-in.
    pub sdk_sign_in: Option<String>,
}

/// VRChat Avatar IDs: `avtr_` and a lowercase or uppercase hexadecimal UUID.
pub fn is_blueprint_id(value: &str) -> bool {
    let Some(uuid) = value.strip_prefix("avtr_") else { return false; };
    let groups = uuid.split('-').collect::<Vec<_>>();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, length)| group.len() == length && group.bytes().all(|b| b.is_ascii_hexdigit()))
}

/// A name VRChat can show: trimmed, 1 to 64 characters, without control characters.
pub fn validate_avatar_name(name: &str) -> Result<(), AppErrorV1> {
    let count = name.chars().count();
    if name.trim() != name || count == 0 || count > MAX_AVATAR_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(production_error("avatar_name_invalid", "Give the Avatar a name of 1 to 64 characters."));
    }
    Ok(())
}

/// Bounded plain text from the SDK: no control characters except line breaks.
pub fn bounded_text(value: &str, limit: usize) -> String {
    value.chars().filter(|c| *c == '\n' || !c.is_control()).take(limit).collect()
}

fn plain_name(part: &str) -> bool {
    part.len() <= 160
        && part.bytes().next().is_some_and(|b| b.is_ascii_alphanumeric())
        && part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

/// `.vua/turntables/<command>/frame-NN.png`, relative to the work project.
pub fn turntable_frame_path(command_id: &str, index: u32) -> String {
    format!("{TURNTABLE_ROOT}/{command_id}/frame-{index:02}.png")
}

/// Resolves one turntable frame to its PNG file inside the work project.
pub fn turntable_file(project_root: &Path, command_id: &str, index: u32) -> Result<PathBuf, AppErrorV1> {
    let relative = turntable_frame_path(command_id, index);
    let invalid = || production_error("turntable_invalid", format!("A turntable frame is outside the work project's turntable folder: {relative}"));
    if !plain_name(command_id) || index >= TURNTABLE_FRAMES {
        return Err(invalid());
    }
    let root = fs::canonicalize(project_root).map_err(|e| production_error("project_missing", e.to_string()))?;
    let file = relative.split('/').fold(project_root.to_path_buf(), |path, part| path.join(part));
    let metadata = fs::symlink_metadata(&file).map_err(|e| production_error("turntable_missing", format!("{relative}: {e}")))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_PREVIEW_BYTES {
        return Err(production_error("turntable_unusable", format!("A turntable frame is not a bounded image file: {relative}")));
    }
    let actual = fs::canonicalize(&file).map_err(|e| production_error("turntable_missing", format!("{relative}: {e}")))?;
    if !actual.starts_with(&root) {
        return Err(invalid());
    }
    Ok(actual)
}

/// Accepts the Bridge's turntable facts when they name the fixed frame set and every frame is a
/// bounded file inside the work project.
pub fn turntable_from_facts(facts: &serde_json::Value, project_root: &Path, unity_fingerprint: &str, baked_at: &str) -> Result<Turntable, AppErrorV1> {
    let invalid = |detail: &str| production_error("receipt_invalid", detail.to_owned());
    let folder = facts["folder"].as_str().ok_or_else(|| invalid("The Bridge reported no turntable."))?;
    let command_id = folder
        .strip_prefix(TURNTABLE_ROOT)
        .and_then(|rest| rest.strip_prefix('/'))
        .filter(|name| plain_name(name))
        .ok_or_else(|| invalid("The turntable folder is outside the work project's turntable folder."))?;
    if facts["frames"].as_u64() != Some(TURNTABLE_FRAMES.into()) || facts["size"].as_u64() != Some(TURNTABLE_SIZE.into()) {
        return Err(invalid("The turntable has another frame count or size."));
    }
    for index in 0..TURNTABLE_FRAMES {
        turntable_file(project_root, command_id, index).map_err(|error| invalid(&format!("Frame {index}: {}", error.code)))?;
    }
    Ok(Turntable {
        command_id: command_id.into(),
        frames: TURNTABLE_FRAMES,
        size: TURNTABLE_SIZE,
        baked_at: baked_at.into(),
        unity_fingerprint: unity_fingerprint.into(),
    })
}

/// Removes turntable folders other than the kept one. Links and junctions stay as they are.
pub fn prune_turntables(project_root: &Path, kept: Option<&str>) {
    let Ok(entries) = fs::read_dir(project_root.join(TURNTABLE_ROOT)) else { return; };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if entry.file_type().is_ok_and(|kind| kind.is_dir() && !kind.is_symlink()) && Some(name.to_string_lossy().as_ref()) != kept {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

/// The reason an error from the platform stands for when an upload did not reach a receipt.
fn reason_of(error: &AppErrorV1) -> &'static str {
    match error.code.as_str() {
        _ if error.category == ErrorCategory::Cancelled => "cancelled",
        "vua.amf_production.upload_timeout" => "timeout",
        "vua.amf_production.editor_unavailable" | "vua.amf_production.open_failed" => "editor_unavailable",
        _ => "unknown",
    }
}

fn error_detail(error: &AppErrorV1) -> String {
    error.params.as_ref().and_then(|params| params.get("detail")).and_then(|value| match value {
        ParamValue::Text(text) => Some(text.clone()),
        _ => None,
    }).unwrap_or_else(|| error.code.clone())
}

impl AmfProductionEngine {
    fn release_file(&self, run_id: &str) -> Result<PathBuf, AppErrorV1> {
        self.run_file(run_id)?;
        Ok(self.root.join("releases").join(format!("{run_id}.json")))
    }
    pub fn release_record(&self, run_id: &str) -> Result<ReleaseRecord, AppErrorV1> {
        let path = self.release_file(run_id)?;
        match fs::read(&path) {
            Ok(bytes) => {
                let record: ReleaseRecord = serde_json::from_slice(&bytes).map_err(io_error)?;
                if record.schema_version != "0.1" || record.run_id != run_id {
                    return Err(production_error("release_invalid", "The release record belongs to another run."));
                }
                Ok(record)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(ReleaseRecord { schema_version: "0.1".into(), run_id: run_id.into(), ..Default::default() })
            }
            Err(error) => Err(io_error(error)),
        }
    }
    fn save_release(&self, record: &ReleaseRecord) -> Result<(), AppErrorV1> {
        let path = self.release_file(&record.run_id)?;
        fs::create_dir_all(path.parent().expect("release parent")).map_err(io_error)?;
        let pending = path.with_extension("pending");
        fs::write(&pending, serde_json::to_vec_pretty(record).map_err(io_error)?).map_err(io_error)?;
        fs::rename(&pending, path).map_err(io_error)
    }
    fn finished(&self, run_id: &str) -> Result<ProductionRun, AppErrorV1> {
        let run = self.get(run_id)?;
        if run.phase != "succeeded" {
            return Err(production_error("result_not_ready", "Assemble the Avatar before releasing it."));
        }
        if run.result["facts"]["avatarGlobalObjectId"].as_str().is_none_or(str::is_empty) {
            return Err(production_error("result_invalid", "The result has no Avatar identity. Check it again."));
        }
        Ok(run)
    }
    /// The run's step that is still marked running ends with this state and detail.
    fn end_step(run: &mut ProductionRun, state: &str, detail: String) {
        if let Some(step) = run.steps.last_mut().filter(|step| step.state == "running") {
            step.state = state.into();
            step.detail = detail;
        }
    }

    /// The release room's view of one run: its turntable and its uploads, newest first.
    pub fn release_state(&self, run_id: &str) -> Result<serde_json::Value, AppErrorV1> {
        let run = self.get(run_id)?;
        let record = self.release_record(run_id)?;
        let turntable = record.turntable.as_ref().map(|turntable| serde_json::json!({
            "frames": turntable.frames, "size": turntable.size, "bakedAt": turntable.baked_at,
            "current": turntable.unity_fingerprint == run.unity_fingerprint,
        }));
        let uploads = record.uploads.iter().rev().take(10).collect::<Vec<_>>();
        Ok(serde_json::json!({"schemaVersion":"0.1", "runId":run_id, "turntable":turntable, "uploads":uploads,
            "editorOpen":self.platform.editor_open(Path::new(&run.project_root))}))
    }

    /// Reads one frame of the run's turntable.
    pub fn turntable_frame(&self, run_id: &str, index: u32) -> Result<Vec<u8>, AppErrorV1> {
        let run = self.get(run_id)?;
        let turntable = self.release_record(run_id)?.turntable
            .ok_or_else(|| production_error("turntable_missing", "This Avatar has no turntable yet."))?;
        if index >= turntable.frames {
            return Err(production_error("turntable_invalid", "The turntable has fewer frames."));
        }
        let bytes = fs::read(turntable_file(Path::new(&run.project_root), &turntable.command_id, index)?)
            .map_err(|e| production_error("turntable_missing", e.to_string()))?;
        if bytes.len() as u64 > MAX_PREVIEW_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err(production_error("turntable_invalid", "The turntable frame is not a bounded PNG image."));
        }
        Ok(bytes)
    }

    /// A turntable shows the finished Avatar as the run last observed it, so the project must be
    /// closed in Unity and unchanged since that observation.
    pub fn precheck_turntable(&self, run_id: &str) -> Result<(), AppErrorV1> {
        let run = self.finished(run_id)?;
        let project = Path::new(&run.project_root);
        if self.platform.editor_open(project) {
            return Err(production_error("project_open", "Close Unity for this work project, then bake the turntable."));
        }
        if !self.project_state(&run)?.0 {
            return Err(production_error("project_drift", "The work project changed since its last check. Check it again, then bake the turntable."));
        }
        Ok(())
    }

    pub fn bake_turntable(&self, run_id: &str, ctx: &TaskContext) -> Result<(), AppErrorV1> {
        self.precheck_turntable(run_id)?;
        let mut run = self.get(run_id)?;
        run.task_id = ctx.task_id().into();
        self.step(&mut run, ctx, "turntable", "Bake the 60-frame turntable")?;
        let project = PathBuf::from(&run.project_root);
        let result = (|| {
            let observed = self.platform.turntable(&run, &self.watch(&run, ctx))?;
            if let Some(error) = ctx.cancellation_error("amf-production") {
                return Err(error);
            }
            if observed.editor_version != run.editor.version {
                return Err(production_error("editor_drift", "The actual Editor version changed."));
            }
            if observed.unity_fingerprint != run.unity_fingerprint {
                return Err(production_error("project_drift", "The Avatar changed in Unity since its last check. Check it again, then bake the turntable."));
            }
            let turntable = turntable_from_facts(&observed.result["facts"]["turntable"], &project, &run.unity_fingerprint, &SystemClock.now_rfc3339())?;
            let mut record = self.release_record(run_id)?;
            record.turntable = Some(turntable);
            self.save_release(&record)?;
            // Unity opened the project; its settings files are the run's state from here on.
            let _check = FingerprintCheck::begin(self, &run, ctx);
            run.project_fingerprint = self.platform.fingerprint(&project)?;
            Ok(())
        })();
        let kept = self.release_record(run_id).ok().and_then(|record| record.turntable).map(|turntable| turntable.command_id);
        prune_turntables(&project, kept.as_deref());
        match &result {
            Ok(()) => Self::end_step(&mut run, "succeeded", String::new()),
            Err(error) => Self::end_step(&mut run, "failed", format!("{} — {}", error.code, error_detail(error))),
        }
        self.save(&run)?;
        result
    }

    /// The SDK uploads what the work scene holds. With Unity closed, the project must be unchanged
    /// since the run's last check; with Unity open, the scene as it is in Unity is what uploads.
    pub fn precheck_upload(&self, run_id: &str, avatar_name: &str) -> Result<(), AppErrorV1> {
        let run = self.finished(run_id)?;
        validate_avatar_name(avatar_name)?;
        let editor = self.platform.verify_editor(&run.editor.path)?;
        if editor.version != run.editor.version {
            return Err(production_error("editor_drift", "The selected Editor identity changed."));
        }
        let project = Path::new(&run.project_root);
        if !self.platform.editor_open(project) && !self.project_state(&run)?.0 {
            return Err(production_error("project_drift", "The work project changed since its last check. Check it again before uploading."));
        }
        Ok(())
    }

    /// Runs one managed upload. It starts only from the player's confirmation in VUA; the VRChat
    /// sign-in and the SDK's own ownership agreement stay inside the SDK.
    pub fn upload(&self, run_id: &str, avatar_name: &str, ctx: &TaskContext) -> Result<(), AppErrorV1> {
        self.precheck_upload(run_id, avatar_name)?;
        let mut run = self.get(run_id)?;
        let mut record = self.release_record(run_id)?;
        let now = SystemClock.now_rfc3339();
        // Production work runs one at a time, so an upload still marked running ended with VUA.
        for stale in record.uploads.iter_mut().filter(|upload| upload.state == "running") {
            stale.state = "failed".into();
            stale.reason = Some("interrupted".into());
            stale.ended_at = Some(now.clone());
        }
        let upload_id = format!("upload-{}", ctx.task_id().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(80).collect::<String>());
        let thumbnail = run.result["facts"]["previews"].as_array().into_iter().flatten()
            .find(|view| view["view"] == "front")
            .and_then(|view| view["path"].as_str())
            .filter(|path| is_preview_path(path))
            .map(str::to_owned);
        record.uploads.push(UploadRecord {
            upload_id: upload_id.clone(), avatar_name: avatar_name.into(), started_at: now, ended_at: None,
            state: "running".into(), stage: "starting".into(), progress: None, status: String::new(),
            blueprint_id: None, first_upload: None, reason: None, detail: String::new(), errors: Vec::new(),
            sdk_sign_in: None,
        });
        while record.uploads.len() > KEPT_UPLOADS {
            record.uploads.remove(0);
        }
        self.save_release(&record)?;
        run.task_id = ctx.task_id().into();
        self.step(&mut run, ctx, "upload", "Build and upload with the VRChat SDK")?;

        let request = UploadRequest { upload_id: upload_id.clone(), avatar_name: avatar_name.into(), thumbnail };
        let mut last: Option<UploadProgress> = None;
        let mut report = |progress: UploadProgress| {
            if !UPLOAD_STAGES.contains(&progress.stage.as_str()) || last.as_ref() == Some(&progress) {
                return;
            }
            if let Ok(mut current) = self.release_record(run_id) {
                if let Some(upload) = current.uploads.iter_mut().rev().find(|upload| upload.upload_id == upload_id) {
                    upload.stage = progress.stage.clone();
                    upload.progress = progress.progress.filter(|share| (0.0..=1.0).contains(share));
                    upload.status = bounded_text(&progress.status, 200);
                    let _ = self.save_release(&current);
                }
            }
            ctx.emit_progress(serde_json::json!({"operation":"amf.production", "runId":run_id, "stage":"upload",
                "name":"Build and upload with the VRChat SDK", "upload":{"stage":progress.stage, "progress":progress.progress}}));
            last = Some(progress);
        };
        let outcome = self.platform.upload(&run, &request, ctx, &mut report);

        let mut record = self.release_record(run_id)?;
        let entry = record.uploads.iter_mut().rev().find(|upload| upload.upload_id == upload_id)
            .ok_or_else(|| production_error("release_invalid", "The upload record is missing."))?;
        entry.ended_at = Some(SystemClock.now_rfc3339());
        let result = match outcome {
            Ok(receipt) => {
                let reason = receipt.reason.filter(|reason| UPLOAD_REASONS.contains(&reason.as_str()));
                entry.detail = bounded_text(&receipt.detail, MAX_DETAIL_CHARS);
                entry.errors = receipt.errors.iter().take(MAX_ERRORS).map(|error| bounded_text(error, 500)).collect();
                entry.first_upload = Some(receipt.first_upload);
                entry.sdk_sign_in = receipt.sdk_sign_in.filter(|source| source == "vua_session" || source == "panel");
                match receipt.outcome.as_str() {
                    "succeeded" => match receipt.blueprint_id.filter(|id| is_blueprint_id(id)) {
                        Some(id) => {
                            entry.state = "succeeded".into();
                            entry.blueprint_id = Some(id);
                            entry.stage = "finishing".into();
                            entry.progress = Some(1.0);
                            Ok(())
                        }
                        None => {
                            entry.state = "failed".into();
                            entry.reason = Some("unknown".into());
                            Err(production_error("receipt_invalid", "The SDK reported success without a VRChat Avatar ID."))
                        }
                    },
                    "cancelled" => {
                        entry.state = "cancelled".into();
                        entry.reason = Some("cancelled".into());
                        Err(ctx.cancellation_error("amf-production").unwrap_or_else(|| production_error("upload_cancelled", "The upload was stopped.")))
                    }
                    _ => {
                        entry.state = "failed".into();
                        entry.reason = Some(reason.unwrap_or_else(|| "unknown".into()));
                        Err(production_error("upload_failed", format!("{}: {}", entry.reason.as_deref().unwrap_or("unknown"), entry.detail)))
                    }
                }
            }
            Err(error) => {
                let reason = reason_of(&error);
                entry.state = if reason == "cancelled" { "cancelled" } else { "failed" }.into();
                entry.reason = Some(reason.into());
                entry.detail = bounded_text(&error_detail(&error), MAX_DETAIL_CHARS);
                Err(error)
            }
        };
        self.save_release(&record)?;
        match &result {
            Ok(()) => Self::end_step(&mut run, "succeeded", String::new()),
            Err(error) => Self::end_step(&mut run, "failed", format!("{} — {}", error.code, error_detail(error))),
        }
        self.save(&run)?;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upload_records_from_before_the_sdk_sign_in_source_still_read() {
        let record: ReleaseRecord = serde_json::from_str(r#"{"schemaVersion":"0.1","runId":"n3-old","uploads":[
            {"uploadId":"upload-1","avatarName":"Meiyun","startedAt":"2026-10-17T00:00:00Z","state":"succeeded","stage":"finishing"}]}"#).unwrap();
        let upload = &record.uploads[0];
        assert_eq!(upload.sdk_sign_in, None);
        let with_source: ReleaseRecord = serde_json::from_str(r#"{"schemaVersion":"0.1","runId":"n3-new","uploads":[
            {"uploadId":"upload-2","avatarName":"Meiyun","startedAt":"2026-10-18T00:00:00Z","state":"succeeded","stage":"finishing",
             "blueprintId":"avtr_7ce0e209-6069-40c2-8b23-4e6c2dad389a","sdkSignIn":"vua_session"}]}"#).unwrap();
        assert_eq!(with_source.uploads[0].sdk_sign_in.as_deref(), Some("vua_session"));
    }
}

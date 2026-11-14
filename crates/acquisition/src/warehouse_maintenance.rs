//! Warehouse entry maintenance — the delete-originals flow (B4-7 artifact-
//! mode slice, adjudicated 2026-09-06).
//!
//! Deleting the originals of an entry is the audited destructive half of the
//! "use VPM package" mode (warehouse-layout ruling 5). The task runs ONLY
//! under the adjudicated guards:
//!
//! - **(c) effective mode**: the entry's resolved mode must be
//!   `generate_vpm` — otherwise `vua.warehouse.invalid_state`; a "mode says
//!   original, originals deleted" split state must never be creatable;
//! - **(a)/(b) generated artifact present and verified**: the entry holds at
//!   least one `generated_vpm` copy whose physical file exists and whose
//!   content digest matches its recorded identity — otherwise
//!   `vua.warehouse.generated_artifact_missing`;
//!
//! and the deletion itself is per-copy consistent: each physical file is
//! removed before its row, so an interrupted run leaves rows and files in
//! agreement and a retry resumes with the remaining originals. Generated VPM
//! copies and all content-keyed inspection facts survive. Every deletion is
//! reported in the task result — the audit trail the adjudication requires.

use crate::artifact_inspection::{hex_lower, sha256_file};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use vua_bdl_store::bdl_store::{ArtifactMode, BdlStore, BdlStoreError, CopyRole, NewLocalArtifact};
use vua_orchestrator::{Clock, SubmitRequest, SystemClock, TaskExit, TaskJob, TaskRuntime};
use vua_orchestrator::{ErrorCategory, ParamValue};
use vua_unity_bridge::{MaterialCancelToken, MaterialExecutor};

#[derive(Debug)]
pub enum MaintenanceError {
    Store(BdlStoreError),
    Io(std::io::Error),
    UnknownEntry(String),
    /// Guard (c): the entry's effective mode is not generate_vpm.
    InvalidState {
        entry_id: String,
        effective_mode: ArtifactMode,
    },
    /// Guards (a)/(b): no generated VPM copy, or one whose file is missing
    /// or whose content no longer matches its recorded identity.
    GeneratedArtifactMissing {
        entry_id: String,
        reason: String,
    },
    /// Generate guard: the entry holds no original material to generate from.
    NoOriginalMaterial {
        entry_id: String,
    },
    /// Generate guard: a generated VPM artifact already exists — never
    /// silently replaced (delete the entry's VPM copy to regenerate).
    AlreadyGenerated {
        entry_id: String,
    },
    /// Generation failed inside the staging chain (staging/bridge/archive),
    /// carrying the stable intake-style code.
    GenerationFailed {
        code: String,
        message: String,
    },
}

impl From<BdlStoreError> for MaintenanceError {
    fn from(error: BdlStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<std::io::Error> for MaintenanceError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for MaintenanceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Io(error) => write!(formatter, "warehouse maintenance failed: {error}"),
            Self::UnknownEntry(entry_id) => {
                write!(formatter, "unknown warehouse entry {entry_id}")
            }
            Self::InvalidState {
                entry_id,
                effective_mode,
            } => write!(
                formatter,
                "entry {entry_id} is in mode {}; originals may only be deleted in mode generate_vpm",
                effective_mode.name()
            ),
            Self::GeneratedArtifactMissing { entry_id, reason } => {
                write!(
                    formatter,
                    "entry {entry_id}: the generated VPM artifact failed verification: {reason}"
                )
            }
            Self::NoOriginalMaterial { entry_id } => {
                write!(formatter, "entry {entry_id} holds no original material to generate from")
            }
            Self::AlreadyGenerated { entry_id } => {
                write!(formatter, "entry {entry_id} already has a generated VPM artifact")
            }
            Self::GenerationFailed { code, message } => {
                write!(formatter, "generation failed ({code}): {message}")
            }
        }
    }
}

impl std::error::Error for MaintenanceError {}

/// One delete-originals task binding. The shell-level global mode default
/// rides along for guard (c)'s dynamic resolution.
#[derive(Debug, Clone)]
pub struct DeleteOriginalsTaskSpec {
    pub correlation_id: String,
    pub warehouse_item_id: String,
    pub global_default: ArtifactMode,
}

/// Audit payload (Done exit): what was deleted, what was kept.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOriginalsResult {
    pub correlation_id: String,
    pub warehouse_item_id: String,
    pub deleted_count: u64,
    pub deleted_relative_paths: Vec<String>,
    pub kept_generated_sha256: Option<String>,
}

fn maintenance_error_to_app(
    error: MaintenanceError,
    correlation_id: &str,
) -> vua_orchestrator::AppErrorV1 {
    let (code, category, params): (String, ErrorCategory, Vec<(String, String)>) = match &error {
        MaintenanceError::Store(_) => (
            "vua.warehouse.storeFailed".to_owned().to_owned(),
            ErrorCategory::Internal,
            Vec::new(),
        ),
        MaintenanceError::Io(_) => (
            "vua.warehouse.maintenanceIoFailed".to_owned(),
            ErrorCategory::ExternalFailure,
            Vec::new(),
        ),
        MaintenanceError::UnknownEntry(entry_id) => (
            "vua.warehouse.entry_not_found".to_owned(),
            ErrorCategory::Validation,
            vec![("warehouseItemId".to_owned(), entry_id.clone())],
        ),
        MaintenanceError::InvalidState {
            entry_id,
            effective_mode,
        } => (
            "vua.warehouse.invalid_state".to_owned(),
            ErrorCategory::Conflict,
            vec![
                ("warehouseItemId".to_owned(), entry_id.clone()),
                (
                    "effectiveMode".to_owned(),
                    effective_mode.name().to_string(),
                ),
            ],
        ),
        MaintenanceError::GeneratedArtifactMissing { entry_id, reason } => (
            "vua.warehouse.generated_artifact_missing".to_owned(),
            ErrorCategory::Conflict,
            vec![
                ("warehouseItemId".to_owned(), entry_id.clone()),
                ("reason".to_owned(), reason.clone()),
            ],
        ),
        MaintenanceError::NoOriginalMaterial { entry_id } => (
            "vua.warehouse.no_original_material".to_owned(),
            ErrorCategory::Conflict,
            vec![("warehouseItemId".to_owned(), entry_id.clone())],
        ),
        MaintenanceError::AlreadyGenerated { entry_id } => (
            "vua.warehouse.already_generated".to_owned(),
            ErrorCategory::Conflict,
            vec![("warehouseItemId".to_owned(), entry_id.clone())],
        ),
        MaintenanceError::GenerationFailed { code, message } => (
            "vua.warehouse.generation_failed".to_owned().to_owned(),
            ErrorCategory::ExternalFailure,
            vec![
                ("code".to_owned(), code.clone()),
                ("reason".to_owned(), message.clone()),
            ],
        ),
    };
    let mut app = vua_orchestrator::AppErrorV1::new(
        &code,
        category,
        "errors.warehouse.maintenanceFailed",
        correlation_id,
    )
    .with_recoverable(true);
    for (name, value) in params {
        app = app.with_param(name.as_str(), ParamValue::Text(value));
    }
    app
}

/// Guards (a)/(b): the entry holds generated VPM copies and every one of
/// them physically exists with content matching its recorded identity.
fn verify_generated_copies(
    copies: &[vua_bdl_store::bdl_store::StoredArtifactCopy],
    entry_id: &str,
) -> Result<Option<String>, MaintenanceError> {
    let generated: Vec<&vua_bdl_store::bdl_store::StoredArtifactCopy> = copies
        .iter()
        .filter(|copy| copy.role == CopyRole::GeneratedVpm)
        .collect();
    let Some(first) = generated.first() else {
        return Err(MaintenanceError::GeneratedArtifactMissing {
            entry_id: entry_id.to_string(),
            reason: "the entry holds no generated VPM artifact".into(),
        });
    };
    for copy in &generated {
        let path = PathBuf::from(&copy.stored_path);
        let digest =
            sha256_file(&path).map_err(|error| MaintenanceError::GeneratedArtifactMissing {
                entry_id: entry_id.to_string(),
                reason: format!("{} is unreadable: {}", copy.stored_path, error),
            })?;
        let identity = format!("sha256:{}", hex_lower(&digest));
        if identity != copy.artifact_sha256 {
            return Err(MaintenanceError::GeneratedArtifactMissing {
                entry_id: entry_id.to_string(),
                reason: format!(
                    "{} hashes to {}, the generation receipt recorded {}",
                    copy.stored_path, identity, copy.artifact_sha256
                ),
            });
        }
    }
    Ok(Some(first.artifact_sha256.clone()))
}

fn run_delete_originals(
    store: &BdlStore,
    spec: &DeleteOriginalsTaskSpec,
    ctx: &vua_orchestrator::TaskContext,
) -> Result<TaskExit, MaintenanceError> {
    let detail = store
        .warehouse_entry_detail(&spec.warehouse_item_id, spec.global_default)?
        .ok_or_else(|| MaintenanceError::UnknownEntry(spec.warehouse_item_id.clone()))?;

    // Guard (c): only the generate_vpm mode may lose its originals.
    if detail.effective_artifact_mode != ArtifactMode::GenerateVpm {
        return Err(MaintenanceError::InvalidState {
            entry_id: spec.warehouse_item_id.clone(),
            effective_mode: detail.effective_artifact_mode,
        });
    }

    let copies = store.entry_copies(&spec.warehouse_item_id)?;
    let kept_generated = verify_generated_copies(&copies, &spec.warehouse_item_id)?;

    let originals: Vec<&vua_bdl_store::bdl_store::StoredArtifactCopy> = copies
        .iter()
        .filter(|copy| copy.role == CopyRole::Original)
        .collect();
    let mut deleted_paths = Vec::new();
    for copy in originals {
        if ctx.check_cancel() {
            ctx.emit_progress(serde_json::json!({
                "kind": "warehouse.deleteOriginals.cancelled",
                "deletedCount": deleted_paths.len(),
            }));
            return Ok(TaskExit::Cancelled);
        }
        // A vanished file is drift, and deleting the row is the repair; any
        // other removal failure fails the task with the row kept for retry.
        match std::fs::remove_file(&copy.stored_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(MaintenanceError::Io(error)),
        }
        store.delete_artifact_copy(&copy.copy_id)?;
        deleted_paths.push(copy.relative_path.clone());
        ctx.emit_progress(serde_json::json!({
            "kind": "warehouse.deleteOriginals.originalDeleted",
            "relativePath": copy.relative_path,
            "deletedCount": deleted_paths.len(),
        }));
    }

    let result = DeleteOriginalsResult {
        correlation_id: spec.correlation_id.clone(),
        warehouse_item_id: spec.warehouse_item_id.clone(),
        deleted_count: deleted_paths.len() as u64,
        kept_generated_sha256: kept_generated,
        deleted_relative_paths: deleted_paths,
    };
    // Invariant (BG-12): DeleteOriginalsResult contains only strings,
    // counters and nested serializable structs — serde cannot fail on it;
    // a serialization error would be an invariant break, surfaced as a
    // panic instead of a silently null Done payload.
    let payload = serde_json::to_value(&result)
        .expect("task result serializes infallibly (plain data shapes only)");
    Ok(TaskExit::Done(payload))
}

/// Assemble the delete-originals task closure. Cancellation is checked at
/// per-copy boundaries; each completed copy is already consistent on disk
/// and in BDL, so a cancelled or failed run resumes with the remaining
/// originals.
pub fn delete_originals_job(store: Arc<BdlStore>, spec: Arc<DeleteOriginalsTaskSpec>) -> TaskJob {
    Box::new(move |ctx| match run_delete_originals(&store, &spec, ctx) {
        Ok(exit) => Ok(exit),
        Err(error) => Err(maintenance_error_to_app(error, &spec.correlation_id)),
    })
}

/// Convenience submission: the correlation id binds the audited deletion.
pub fn submit_delete_originals(
    runtime: &TaskRuntime,
    store: Arc<BdlStore>,
    spec: DeleteOriginalsTaskSpec,
    timeout: Option<Duration>,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    let correlation_id = spec.correlation_id.clone();
    runtime.submit(SubmitRequest {
        correlation_id: Some(correlation_id),
        timeout,
        job: delete_originals_job(store, Arc::new(spec)),
    })
}

// --- B4 artifact-mode: the generate-VPM task ---

/// One generate-VPM task binding. The effective mode guard (generate_vpm)
/// is enforced inside the job against `global_default`.
#[derive(Debug, Clone)]
pub struct GenerateVpmTaskSpec {
    pub correlation_id: String,
    pub warehouse_item_id: String,
    pub warehouse_root: PathBuf,
    pub global_default: ArtifactMode,
    /// Present only when the generation was orchestrated by a batch import
    /// (proposal 010 commitment 6): the audit-chain link back to the source
    /// import task. A manually initiated generation leaves it None — the
    /// wire field (bdl-commands v0.3) is optional for the same reason.
    pub import_correlation_id: Option<String>,
}

/// Audit payload (Done exit).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateVpmResult {
    pub correlation_id: String,
    pub warehouse_item_id: String,
    pub package_id: String,
    pub archive_relative_path: String,
    pub archive_sha256: String,
    /// Present only for import-orchestrated generations (the audit chain
    /// back to the source import task); absent for manual generations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_correlation_id: Option<String>,
}

fn generate_error_to_app(
    error: MaintenanceError,
    correlation_id: &str,
) -> vua_orchestrator::AppErrorV1 {
    let (code, category, params): (String, ErrorCategory, Vec<(String, String)>) = match &error {
        MaintenanceError::Store(_) => (
            "vua.warehouse.storeFailed".to_owned(),
            ErrorCategory::Internal,
            Vec::new(),
        ),
        MaintenanceError::Io(_) => (
            "vua.warehouse.maintenanceIoFailed".to_owned(),
            ErrorCategory::ExternalFailure,
            Vec::new(),
        ),
        MaintenanceError::UnknownEntry(entry_id) => (
            "vua.warehouse.entry_not_found".to_owned(),
            ErrorCategory::Validation,
            vec![("warehouseItemId".to_owned(), entry_id.clone())],
        ),
        MaintenanceError::InvalidState {
            entry_id,
            effective_mode,
        } => (
            "vua.warehouse.invalid_state".to_owned(),
            ErrorCategory::Conflict,
            vec![
                ("warehouseItemId".to_owned(), entry_id.clone()),
                ("effectiveMode".to_owned(), effective_mode.name().to_owned()),
            ],
        ),
        MaintenanceError::GeneratedArtifactMissing { entry_id, reason } => (
            "vua.warehouse.generated_artifact_missing".to_owned(),
            ErrorCategory::Conflict,
            vec![
                ("warehouseItemId".to_owned(), entry_id.clone()),
                ("reason".to_owned(), reason.clone()),
            ],
        ),
        MaintenanceError::NoOriginalMaterial { entry_id } => (
            "vua.warehouse.no_original_material".to_owned(),
            ErrorCategory::Conflict,
            vec![("warehouseItemId".to_owned(), entry_id.clone())],
        ),
        MaintenanceError::AlreadyGenerated { entry_id } => (
            "vua.warehouse.already_generated".to_owned(),
            ErrorCategory::Conflict,
            vec![("warehouseItemId".to_owned(), entry_id.clone())],
        ),
        MaintenanceError::GenerationFailed { code, message } => (
            "vua.warehouse.generation_failed".to_owned(),
            ErrorCategory::ExternalFailure,
            vec![
                ("code".to_owned(), code.clone()),
                ("reason".to_owned(), message.clone()),
            ],
        ),
    };
    let mut app = vua_orchestrator::AppErrorV1::new(
        &code,
        category,
        "errors.warehouse.maintenanceFailed",
        correlation_id,
    )
    .with_recoverable(true);
    for (name, value) in &params {
        app = app.with_param(name.as_str(), ParamValue::Text(value.clone()));
    }
    app
}

fn run_generate_vpm(
    store: &BdlStore,
    executor: &MaterialExecutor,
    spec: &GenerateVpmTaskSpec,
    ctx: &vua_orchestrator::TaskContext,
) -> Result<TaskExit, MaintenanceError> {
    let detail = store
        .warehouse_entry_detail(&spec.warehouse_item_id, spec.global_default)?
        .ok_or_else(|| MaintenanceError::UnknownEntry(spec.warehouse_item_id.clone()))?;

    // Guard: generation runs only in the generate_vpm mode.
    if detail.effective_artifact_mode != ArtifactMode::GenerateVpm {
        return Err(MaintenanceError::InvalidState {
            entry_id: spec.warehouse_item_id.clone(),
            effective_mode: detail.effective_artifact_mode,
        });
    }

    let copies = store.entry_copies(&spec.warehouse_item_id)?;
    let originals: Vec<&vua_bdl_store::bdl_store::StoredArtifactCopy> = copies
        .iter()
        .filter(|copy| copy.role == CopyRole::Original)
        .collect();
    if originals.is_empty() {
        return Err(MaintenanceError::NoOriginalMaterial {
            entry_id: spec.warehouse_item_id.clone(),
        });
    }
    if copies
        .iter()
        .any(|copy| copy.role == CopyRole::GeneratedVpm)
    {
        return Err(MaintenanceError::AlreadyGenerated {
            entry_id: spec.warehouse_item_id.clone(),
        });
    }

    let sources: Vec<vua_unity_bridge::GenerateSourcePackage> = originals
        .iter()
        .map(|copy| vua_unity_bridge::GenerateSourcePackage {
            archive_path: PathBuf::from(&copy.stored_path),
            sha256: copy.artifact_sha256.clone(),
        })
        .collect();

    // Board #7 hardening: same-tick timestamp reuse (item id + nanos alone)
    // could alias two concurrent generate_vpm jobs onto one publish root;
    // the pid + process-unique serial makes the name collision-free.
    static GENPUB_SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let genpub_serial = GENPUB_SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let genpub_nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let publish_root = std::env::temp_dir().join(format!(
        "vua-genpub-{}-pid{}-t{genpub_nanos:016x}-{genpub_serial}",
        spec.warehouse_item_id,
        std::process::id()
    ));
    struct TempPublishGuard(PathBuf);
    impl Drop for TempPublishGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let _publish_cleanup = TempPublishGuard(publish_root.clone());

    let token = MaterialCancelToken::new();
    let generated = executor
        .generate_vpm_only(
            &sources,
            &detail.display_name,
            &spec.warehouse_root.join(&detail.folder_name),
            &publish_root,
            &spec.correlation_id,
            &token,
        )
        .map_err(|(code, status)| {
            if status == vua_unity_bridge::MaterialExecutionStatus::Cancelled {
                MaintenanceError::GenerationFailed {
                    code: "vua.warehouse.generation_cancelled".into(),
                    message: "cancelled at a package boundary".into(),
                }
            } else {
                MaintenanceError::GenerationFailed {
                    code,
                    message: "the staging chain refused the generation".into(),
                }
            }
        })?;

    // Copy the published archive into the entry as a generated_vpm copy.
    let relative_path = format!(
        "vpm/{}",
        generated
            .artifact
            .archive_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
    );
    let destination =
        entry_folder_path(&spec.warehouse_root, &detail.folder_name).join(&relative_path);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&generated.artifact.archive_path, &destination)?;
    let archive_sha256 = sha256_file(&destination)?;
    let archive_sha = format!("sha256:{}", hex_lower(&archive_sha256));
    if archive_sha != generated.artifact.archive_sha256 {
        return Err(MaintenanceError::GenerationFailed {
            code: "vua.warehouse.copy_drift".into(),
            message: format!(
                "the copied archive {archive_sha} != published {}",
                generated.artifact.archive_sha256
            ),
        });
    }

    // The generated archive enters BDL like any other sighting first: copy
    // rows reference registered artifacts, so an unregistered sha would make
    // the recording below fail (the regression this registration closes).
    // first_seen_at/created_at are REAL clock readings: a fabricated
    // constant would write false observation facts into the persistence
    // surface (honesty discipline — the store's timestamps are evidence).
    let now = SystemClock.now_rfc3339();
    store.record_untrusted_artifact(&NewLocalArtifact {
        artifact_sha256: archive_sha.clone(),
        size_bytes: fs::metadata(&destination)?.len(),
        suggested_file_name: generated
            .artifact
            .archive_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned()),
        download_id: None,
        first_seen_at: now.clone(),
    })?;

    store.record_artifact_copy(
        &spec.warehouse_item_id,
        &archive_sha,
        &relative_path,
        &destination.to_string_lossy(),
        CopyRole::GeneratedVpm,
        &now,
    )?;

    let result = GenerateVpmResult {
        correlation_id: spec.correlation_id.clone(),
        warehouse_item_id: spec.warehouse_item_id.clone(),
        package_id: generated.package_id.clone(),
        archive_relative_path: relative_path,
        archive_sha256: archive_sha,
        import_correlation_id: spec.import_correlation_id.clone(),
    };
    // Invariant (BG-12): GenerateVpmResult contains only plain data shapes —
    // serde cannot fail on it; a serialization error would be an invariant
    // break, surfaced as a panic instead of a silently null Done payload.
    let payload = serde_json::to_value(&result)
        .expect("task result serializes infallibly (plain data shapes only)");
    ctx.emit_progress(payload.clone());
    Ok(TaskExit::Done(payload))
}

fn entry_folder_path(warehouse_root: &Path, folder_name: &str) -> PathBuf {
    warehouse_root.join(folder_name)
}

pub fn generate_vpm_job(
    store: Arc<BdlStore>,
    executor: Arc<MaterialExecutor>,
    spec: Arc<GenerateVpmTaskSpec>,
) -> vua_orchestrator::TaskJob {
    Box::new(
        move |ctx| match run_generate_vpm(&store, executor.as_ref(), &spec, ctx) {
            Ok(exit) => Ok(exit),
            Err(error) => Err(generate_error_to_app(error, &spec.correlation_id)),
        },
    )
}

pub fn submit_generate_vpm(
    runtime: &TaskRuntime,
    store: Arc<BdlStore>,
    executor: Arc<MaterialExecutor>,
    spec: GenerateVpmTaskSpec,
    timeout: Option<Duration>,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    let correlation_id = spec.correlation_id.clone();
    runtime.submit(SubmitRequest {
        correlation_id: Some(correlation_id),
        timeout,
        job: generate_vpm_job(store, executor, Arc::new(spec)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::unique_dir;
    use crate::warehouse_import::{
        submit_warehouse_import, submit_warehouse_import_auto, AutoGenerateSpec,
        WarehouseImportTaskSpec,
    };
    use std::path::Path;
    use std::time::{Duration, Instant};
    use vua_bdl_store::bdl_store::{CopyRole, NewLocalArtifact};
    use vua_orchestrator::TaskSnapshot;
    use vua_orchestrator::TaskState;
    use vua_orchestrator::{FixedIdGenerator, SystemClock};

    fn runtime() -> TaskRuntime {
        TaskRuntime::new(
            Arc::new(vua_orchestrator::MemoryJournal::default()),
            Arc::new(SystemClock),
            Arc::new(FixedIdGenerator::default()),
        )
    }

    fn wait_for_terminal(rt: &TaskRuntime, task_id: &str) -> TaskSnapshot {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let snapshot = rt.snapshot(task_id).expect("task must exist");
            if snapshot.state.is_terminal() {
                return snapshot;
            }
            assert!(Instant::now() < deadline, "task did not finish");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Builds an entry with one original and (optionally) one generated VPM
    /// copy whose physical files and content identities are consistent.
    struct World {
        store: Arc<BdlStore>,
        entry_id: String,
        original_path: PathBuf,
        generated_path: PathBuf,
    }

    fn make_world(parent: &Path, with_generated: bool) -> World {
        let store = Arc::new(BdlStore::open_in_memory().unwrap());
        let entry_folder = parent.join("entry");
        std::fs::create_dir_all(entry_folder.join("original")).unwrap();
        std::fs::create_dir_all(entry_folder.join("vpm")).unwrap();
        let entry_id = store
            .create_warehouse_item(
                "Fixture Pack",
                "imported_material",
                "2026-09-06T09:00:00.000Z",
            )
            .unwrap()
            .warehouse_item_id;

        let original_path = entry_folder.join("original").join("pack.unitypackage");
        std::fs::write(&original_path, b"PK original fixture").unwrap();
        let original_sha = format!(
            "sha256:{}",
            hex_lower(&sha256_file(&original_path).unwrap())
        );
        store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: original_sha.clone(),
                size_bytes: std::fs::metadata(&original_path).unwrap().len(),
                suggested_file_name: Some("pack.unitypackage".into()),
                download_id: None,
                first_seen_at: "2026-09-06T09:00:00.000Z".into(),
            })
            .unwrap();
        store
            .record_artifact_copy(
                &entry_id,
                &original_sha,
                "original/pack.unitypackage",
                &original_path.to_string_lossy(),
                CopyRole::Original,
                "2026-09-06T09:00:00.000Z",
            )
            .unwrap();

        let generated_path = entry_folder.join("vpm").join("pack.vpack");
        if with_generated {
            std::fs::write(&generated_path, b"PK generated vpm fixture").unwrap();
            let generated_sha = format!(
                "sha256:{}",
                hex_lower(&sha256_file(&generated_path).unwrap())
            );
            store
                .record_untrusted_artifact(&NewLocalArtifact {
                    artifact_sha256: generated_sha.clone(),
                    size_bytes: std::fs::metadata(&generated_path).unwrap().len(),
                    suggested_file_name: Some("pack.vpack".into()),
                    download_id: None,
                    first_seen_at: "2026-09-06T09:00:00.000Z".into(),
                })
                .unwrap();
            store
                .record_artifact_copy(
                    &entry_id,
                    &generated_sha,
                    "vpm/pack.vpack",
                    &generated_path.to_string_lossy(),
                    CopyRole::GeneratedVpm,
                    "2026-09-06T09:00:01.000Z",
                )
                .unwrap();
        }

        World {
            store,
            entry_id,
            original_path,
            generated_path,
        }
    }

    fn run_and_wait(world: &World) -> TaskSnapshot {
        let rt = runtime();
        let accepted = submit_delete_originals(
            &rt,
            world.store.clone(),
            DeleteOriginalsTaskSpec {
                correlation_id: "corr-delete".into(),
                warehouse_item_id: world.entry_id.clone(),
                global_default: ArtifactMode::UseOriginalUnitypackage,
            },
            None,
        )
        .unwrap();
        wait_for_terminal(&rt, &accepted.task_id)
    }

    #[test]
    fn delete_originals_removes_only_originals_under_all_guards() {
        let parent = unique_dir("vua-maint", "happy");
        let world = make_world(&parent, true);
        world
            .store
            .set_artifact_mode(&world.entry_id, Some(ArtifactMode::GenerateVpm))
            .unwrap();

        let snapshot = run_and_wait(&world);
        assert_eq!(snapshot.state, TaskState::Succeeded);
        assert!(!world.original_path.exists(), "originals are gone on disk");
        assert!(world.generated_path.exists(), "the generated VPM survives");
        let copies = world.store.entry_copies(&world.entry_id).unwrap();
        assert_eq!(copies.len(), 1);
        assert_eq!(copies[0].role, CopyRole::GeneratedVpm);
        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn guard_c_refuses_deletion_outside_the_generate_vpm_mode() {
        let parent = unique_dir("vua-maint", "guardc");
        let world = make_world(&parent, true);
        // No override, global default = use_original_unitypackage.

        let snapshot = run_and_wait(&world);
        assert_eq!(snapshot.state, TaskState::Failed);
        assert!(
            world.original_path.exists(),
            "originals survive a refused deletion"
        );
        assert_eq!(world.store.entry_copies(&world.entry_id).unwrap().len(), 2);
        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn guards_a_and_b_refuse_deletion_without_a_verified_generated_artifact() {
        // No generated copy at all.
        let parent = unique_dir("vua-maint", "guardab1");
        let world = make_world(&parent, false);
        world
            .store
            .set_artifact_mode(&world.entry_id, Some(ArtifactMode::GenerateVpm))
            .unwrap();
        let snapshot = run_and_wait(&world);
        assert_eq!(snapshot.state, TaskState::Failed);
        assert_eq!(world.store.entry_copies(&world.entry_id).unwrap().len(), 1);
        std::fs::remove_dir_all(&parent).ok();

        // A generated copy whose content no longer matches its recorded
        // identity is tampering, not a deletable state.
        let parent = unique_dir("vua-maint", "guardab2");
        let world = make_world(&parent, true);
        std::fs::write(&world.generated_path, b"tampered content").unwrap();
        world
            .store
            .set_artifact_mode(&world.entry_id, Some(ArtifactMode::GenerateVpm))
            .unwrap();
        let snapshot = run_and_wait(&world);
        assert_eq!(snapshot.state, TaskState::Failed);
        assert!(world.original_path.exists());
        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn unknown_entries_are_rejected_not_deleted_blindly() {
        let store = Arc::new(BdlStore::open_in_memory().unwrap());
        let rt = runtime();
        let accepted = submit_delete_originals(
            &rt,
            store.clone(),
            DeleteOriginalsTaskSpec {
                correlation_id: "corr-x".into(),
                warehouse_item_id: "whi-nope".into(),
                global_default: ArtifactMode::GenerateVpm,
            },
            None,
        )
        .unwrap();
        let snapshot = wait_for_terminal(&rt, &accepted.task_id);
        assert_eq!(snapshot.state, TaskState::Failed);
    }

    // --- generate-VPM task coverage (proposal 003) ---

    use std::sync::Mutex;
    use vua_orchestrator::{
        AppErrorV1, BridgeError, BuildRecordStore, FileSystemSnapshotStore, FixedClock,
        JournalEntryKind, JournalPayload, MemoryJournal, ProjectRef, ResultStatus, UnityBridge,
        UnityCommand, UnityOperation, UnityResult, VpmBackend, VpmCapabilities,
    };
    use vua_unity_bridge::LocalPackageIdentityStore;

    /// Synthetic tar.gz stand-in for a downloaded `.unitypackage`: structure
    /// only, fixed fixture bytes — never real product content.
    fn write_synthetic_archive(path: &Path, entries: &[&str]) {
        use flate2::write::GzEncoder;
        use tar::{Builder, Header};
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let file = fs::File::create(path).unwrap();
        let mut builder = Builder::new(GzEncoder::new(file, flate2::Compression::default()));
        for entry in entries {
            let mut header = Header::new_gnu();
            header.set_size(b"fixture".len() as u64);
            header.set_cksum();
            builder
                .append_data(&mut header, entry, b"fixture".as_slice())
                .unwrap();
        }
        builder.finish().unwrap();
    }

    /// A generate-VPM world: one entry whose single original is a synthetic
    /// tar.gz archive (the staging chain really unpacks it) and no generated
    /// copy yet. Everything on disk and in BDL is consistent.
    fn make_generate_world(parent: &Path) -> World {
        let store = Arc::new(BdlStore::open_in_memory().unwrap());
        let entry_folder = parent.join("entry");
        fs::create_dir_all(entry_folder.join("original")).unwrap();
        fs::create_dir_all(entry_folder.join("vpm")).unwrap();
        let entry_id = store
            .create_warehouse_item(
                "Fixture Pack",
                "imported_material",
                "2026-09-06T09:00:00.000Z",
            )
            .unwrap()
            .warehouse_item_id;

        let original_path = entry_folder.join("original").join("pack.unitypackage");
        write_synthetic_archive(&original_path, &["Assets/fixture/asset.txt"]);
        let original_sha = format!(
            "sha256:{}",
            hex_lower(&sha256_file(&original_path).unwrap())
        );
        store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: original_sha.clone(),
                size_bytes: std::fs::metadata(&original_path).unwrap().len(),
                suggested_file_name: Some("pack.unitypackage".into()),
                download_id: None,
                first_seen_at: "2026-09-06T09:00:00.000Z".into(),
            })
            .unwrap();
        store
            .record_artifact_copy(
                &entry_id,
                &original_sha,
                "original/pack.unitypackage",
                &original_path.to_string_lossy(),
                CopyRole::Original,
                "2026-09-06T09:00:00.000Z",
            )
            .unwrap();

        // The identity store canonicalizes the entry folder (the identity
        // source), so the folder the generate flow resolves must exist.
        let detail = store
            .warehouse_entry_detail(&entry_id, ArtifactMode::UseOriginalUnitypackage)
            .unwrap()
            .expect("the fixture entry exists");
        fs::create_dir_all(parent.join(&detail.folder_name)).unwrap();

        World {
            store,
            entry_id,
            original_path,
            generated_path: entry_folder.join("vpm"),
        }
    }

    /// Test double for the Unity side of the staging chain: every command
    /// succeeds, and `CreateLocalVpmPackage` really materializes a minimal
    /// `package.json` in the staging project so the deterministic publish
    /// step has something to copy out. This is a simulation — it never
    /// claims a real Unity editor ran.
    struct GeneratingBridge {
        commands: Mutex<Vec<UnityCommand>>,
    }

    impl GeneratingBridge {
        fn new() -> Self {
            Self {
                commands: Mutex::new(Vec::new()),
            }
        }
    }

    impl UnityBridge for GeneratingBridge {
        fn execute(
            &self,
            project: &ProjectRef,
            command: &UnityCommand,
        ) -> Result<UnityResult, BridgeError> {
            let mut commands = self.commands.lock().unwrap();
            commands.push(command.clone());
            if command.operation == UnityOperation::CreateLocalVpmPackage {
                let package_id = command.payload.package_id.clone().unwrap_or_default();
                let package_root = project.root.join("Packages").join(&package_id);
                fs::create_dir_all(&package_root).unwrap();
                fs::write(
                    package_root.join("package.json"),
                    format!(r#"{{"name":"{package_id}","version":"0.1.0"}}"#),
                )
                .unwrap();
            }
            Ok(UnityResult {
                schema_version: 1,
                command_id: command.command_id.clone(),
                status: ResultStatus::Succeeded,
                changed_paths: vec![],
                diagnostics: vec![],
                data: serde_json::json!({
                    "projectFingerprint": format!("fp-{}", commands.len())
                }),
                steps: Vec::new(),
                replayed: None,
                snapshot_id: None,
                restored_from: None,
                project_fingerprint_before: None,
            })
        }
    }

    /// The generate-only chain never touches VPM projects; any call is a
    /// test failure, not a silent success.
    struct NoVpmBackend;

    impl VpmBackend for NoVpmBackend {
        fn name(&self) -> &'static str {
            "none"
        }
        fn capabilities(&self) -> VpmCapabilities {
            VpmCapabilities {
                create_project: false,
                preview_install: false,
                list_packages: false,
                remove_packages: false,
                project_registry: false,
                resolve_project: false,
            }
        }
        fn preview_install(
            &self,
            _: &ProjectRef,
            _: &[vua_orchestrator::PackageRequestV1],
        ) -> Result<vua_orchestrator::ChangePreviewV1, AppErrorV1> {
            panic!("generate-vpm never previews")
        }
        fn apply_install(
            &self,
            _: &ProjectRef,
            _: &[vua_orchestrator::PackageRequestV1],
            _: &str,
        ) -> Result<serde_json::Value, AppErrorV1> {
            panic!("generate-vpm never installs")
        }
        fn create_project(
            &self,
            _: &Path,
            _: &str,
            _: Option<&str>,
        ) -> Result<ProjectRef, AppErrorV1> {
            panic!("generate-vpm never creates projects")
        }
    }

    fn make_generate_setup(parent: &Path) -> (World, Arc<MaterialExecutor>, Arc<GeneratingBridge>) {
        let world = make_generate_world(parent);
        let bridge = Arc::new(GeneratingBridge::new());
        let executor = Arc::new(MaterialExecutor::new(
            bridge.clone(),
            FileSystemSnapshotStore,
            Arc::new(NoVpmBackend),
            BuildRecordStore::new(parent.join("records")),
            Arc::new(FixedClock::new(&["2026-09-07T00:00:00Z"])),
            parent.join("executor-temp"),
            "2022.3.22f1",
            LocalPackageIdentityStore::new(parent.join("identities.json")),
        ));
        (world, executor, bridge)
    }

    fn generate_runtime() -> (TaskRuntime, Arc<MemoryJournal>) {
        let journal = Arc::new(MemoryJournal::default());
        let rt = TaskRuntime::new(
            journal.clone(),
            Arc::new(SystemClock),
            Arc::new(FixedIdGenerator::default()),
        );
        (rt, journal)
    }

    fn completed_payload(journal: &MemoryJournal, task_id: &str) -> JournalPayload {
        journal
            .snapshot()
            .into_iter()
            .find(|entry| entry.task_id == task_id && entry.kind == JournalEntryKind::Completed)
            .map(|entry| entry.payload)
            .expect("the journal records exactly one completion per task")
    }

    fn expect_failed_error(journal: &MemoryJournal, task_id: &str) -> AppErrorV1 {
        match completed_payload(journal, task_id) {
            JournalPayload::Completed {
                error: Some(error), ..
            } => error,
            other => panic!("expected a failed completion, got {other:?}"),
        }
    }

    #[test]
    fn generate_vpm_happy_path_publishes_and_records_a_generated_copy() {
        let parent = unique_dir("vua-maint", "gen-happy");
        let (world, executor, bridge) = make_generate_setup(&parent);
        world
            .store
            .set_artifact_mode(&world.entry_id, Some(ArtifactMode::GenerateVpm))
            .unwrap();

        // Fixed-width UTC readings: lexicographic order is chronological.
        let before = SystemClock.now_rfc3339();

        let (rt, journal) = generate_runtime();
        let accepted = submit_generate_vpm(
            &rt,
            world.store.clone(),
            executor,
            GenerateVpmTaskSpec {
                correlation_id: "corr-gen".into(),
                warehouse_item_id: world.entry_id.clone(),
                warehouse_root: parent.clone(),
                global_default: ArtifactMode::UseOriginalUnitypackage,
                import_correlation_id: None,
            },
            Some(Duration::from_secs(120)),
        )
        .unwrap();

        let snapshot = wait_for_terminal(&rt, &accepted.task_id);
        assert_eq!(
            snapshot.state,
            TaskState::Succeeded,
            "generation must succeed, else: {:?}",
            expect_failed_error(&journal, &accepted.task_id)
        );
        assert_eq!(
            snapshot.correlation_id, "corr-gen",
            "the audit binding rides the task row"
        );

        // Task-row lifecycle: accepted first, completed without error.
        let entries = journal.snapshot();
        assert!(
            entries.iter().any(|entry| entry.task_id == accepted.task_id
                && entry.kind == JournalEntryKind::Accepted),
            "acceptance is journaled before the job runs"
        );
        match completed_payload(&journal, &accepted.task_id) {
            JournalPayload::Completed {
                state,
                error,
                result,
            } => {
                assert_eq!(state, TaskState::Succeeded);
                assert!(error.is_none(), "a done generation carries no error");
                let result = result.expect("a done generation carries its audit payload");
                assert_eq!(result["correlationId"], "corr-gen");
                assert_eq!(result["warehouseItemId"], world.entry_id.as_str());
                assert!(
                    result["archiveRelativePath"]
                        .as_str()
                        .unwrap()
                        .starts_with("vpm/"),
                    "the copy lives under the entry's vpm/ folder"
                );
                assert!(
                    result["archiveSha256"]
                        .as_str()
                        .unwrap()
                        .starts_with("sha256:"),
                    "the receipt carries a content identity"
                );
                assert!(
                    !result["packageId"].as_str().unwrap().is_empty(),
                    "the stable package identity is reported"
                );
            }
            other => panic!("expected a successful completion, got {other:?}"),
        }

        // BDL: exactly one generated copy, physically consistent with its
        // recorded identity.
        let copies = world.store.entry_copies(&world.entry_id).unwrap();
        let generated: Vec<_> = copies
            .iter()
            .filter(|copy| copy.role == CopyRole::GeneratedVpm)
            .collect();
        assert_eq!(generated.len(), 1, "generation is recorded exactly once");
        let digest = sha256_file(Path::new(&generated[0].stored_path)).unwrap();
        assert_eq!(
            format!("sha256:{}", hex_lower(&digest)),
            generated[0].artifact_sha256,
            "the recorded identity matches the physical file"
        );
        // Persisted times are REAL clock readings, never a fabricated
        // constant (honesty discipline: observation times are evidence).
        assert_ne!(
            generated[0].created_at, "2026-09-06T00:00:00.000Z",
            "created_at is a real reading, not the retired fabricated constant"
        );
        assert!(
            generated[0].created_at.as_str() >= before.as_str(),
            "created_at was read at generation time ({before} ..= {})",
            generated[0].created_at
        );
        let generated_artifact = world
            .store
            .artifact(&generated[0].artifact_sha256)
            .unwrap()
            .unwrap();
        assert_ne!(
            generated_artifact.first_seen_at, "2026-09-06T00:00:00.000Z",
            "first_seen_at is a real reading, not the retired fabricated constant"
        );
        assert!(
            world.original_path.exists(),
            "generation keeps the originals"
        );

        // The staging chain really drove the simulated Unity side.
        let commands = bridge.commands.lock().unwrap();
        assert!(
            commands
                .iter()
                .any(|command| command.operation == UnityOperation::MaterializeExtractedPackage),
            "the original was staged for materialization"
        );
        assert!(
            commands
                .iter()
                .any(|command| command.operation == UnityOperation::CreateLocalVpmPackage),
            "the package was created before publish"
        );
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn generate_vpm_refuses_outside_the_generate_vpm_mode_with_the_conflict_code() {
        let parent = unique_dir("vua-maint", "gen-guard");
        let (world, executor, _bridge) = make_generate_setup(&parent);
        // No override: the global default (use_original_unitypackage) rules.

        let (rt, journal) = generate_runtime();
        let accepted = submit_generate_vpm(
            &rt,
            world.store.clone(),
            executor,
            GenerateVpmTaskSpec {
                correlation_id: "corr-gen-guard".into(),
                warehouse_item_id: world.entry_id.clone(),
                warehouse_root: parent.clone(),
                global_default: ArtifactMode::UseOriginalUnitypackage,
                import_correlation_id: None,
            },
            None,
        )
        .unwrap();
        let snapshot = wait_for_terminal(&rt, &accepted.task_id);
        assert_eq!(snapshot.state, TaskState::Failed);

        let app = expect_failed_error(&journal, &accepted.task_id);
        assert_eq!(app.code, "vua.warehouse.invalid_state");
        assert_eq!(app.category, vua_orchestrator::ErrorCategory::Conflict);
        assert!(app.recoverable);
        let params = app.params.expect("the conflict names its context");
        assert_eq!(
            params.get("warehouseItemId"),
            Some(&ParamValue::Text(world.entry_id.clone()))
        );
        assert_eq!(
            params.get("effectiveMode"),
            Some(&ParamValue::Text("use_original_unitypackage".into()))
        );
        assert!(
            world.original_path.exists(),
            "a refused generation leaves the original untouched"
        );
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn generate_vpm_refuses_an_entry_without_original_material() {
        let parent = unique_dir("vua-maint", "gen-noorig");
        let store = Arc::new(BdlStore::open_in_memory().unwrap());
        let entry_id = store
            .create_warehouse_item(
                "Empty Pack",
                "imported_material",
                "2026-09-06T09:00:00.000Z",
            )
            .unwrap()
            .warehouse_item_id;
        store
            .set_artifact_mode(&entry_id, Some(ArtifactMode::GenerateVpm))
            .unwrap();

        let (rt, journal) = generate_runtime();
        let accepted = submit_generate_vpm(
            &rt,
            store,
            Arc::new(MaterialExecutor::new(
                Arc::new(GeneratingBridge::new()),
                FileSystemSnapshotStore,
                Arc::new(NoVpmBackend),
                BuildRecordStore::new(parent.join("records")),
                Arc::new(FixedClock::new(&["2026-09-07T00:00:00Z"])),
                parent.join("executor-temp"),
                "2022.3.22f1",
                LocalPackageIdentityStore::new(parent.join("identities.json")),
            )),
            GenerateVpmTaskSpec {
                correlation_id: "corr-gen-empty".into(),
                warehouse_item_id: entry_id.clone(),
                warehouse_root: parent.clone(),
                global_default: ArtifactMode::UseOriginalUnitypackage,
                import_correlation_id: None,
            },
            None,
        )
        .unwrap();
        assert_eq!(
            wait_for_terminal(&rt, &accepted.task_id).state,
            TaskState::Failed
        );
        assert_eq!(
            expect_failed_error(&journal, &accepted.task_id).code,
            "vua.warehouse.no_original_material"
        );
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn generate_vpm_never_silently_replaces_an_existing_artifact() {
        let parent = unique_dir("vua-maint", "gen-twice");
        let (world, executor, _bridge) = make_generate_setup(&parent);
        world
            .store
            .set_artifact_mode(&world.entry_id, Some(ArtifactMode::GenerateVpm))
            .unwrap();

        let (rt, journal) = generate_runtime();
        let spec = |correlation_id: &str| GenerateVpmTaskSpec {
            correlation_id: correlation_id.into(),
            warehouse_item_id: world.entry_id.clone(),
            warehouse_root: parent.clone(),
            global_default: ArtifactMode::UseOriginalUnitypackage,
            import_correlation_id: None,
        };
        let first = submit_generate_vpm(
            &rt,
            world.store.clone(),
            executor.clone(),
            spec("corr-gen-1"),
            None,
        )
        .unwrap();
        assert_eq!(
            wait_for_terminal(&rt, &first.task_id).state,
            TaskState::Succeeded
        );

        let second =
            submit_generate_vpm(&rt, world.store.clone(), executor, spec("corr-gen-2"), None)
                .unwrap();
        assert_eq!(
            wait_for_terminal(&rt, &second.task_id).state,
            TaskState::Failed
        );
        assert_eq!(
            expect_failed_error(&journal, &second.task_id).code,
            "vua.warehouse.already_generated",
            "the existing artifact is never silently replaced"
        );
        let generated_count = world
            .store
            .entry_copies(&world.entry_id)
            .unwrap()
            .iter()
            .filter(|copy| copy.role == CopyRole::GeneratedVpm)
            .count();
        assert_eq!(generated_count, 1, "the second run recorded nothing");
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn generate_vpm_unknown_entry_maps_to_entry_not_found() {
        let parent = unique_dir("vua-maint", "gen-unknown");
        let store = Arc::new(BdlStore::open_in_memory().unwrap());
        let (rt, journal) = generate_runtime();
        let accepted = submit_generate_vpm(
            &rt,
            store,
            Arc::new(MaterialExecutor::new(
                Arc::new(GeneratingBridge::new()),
                FileSystemSnapshotStore,
                Arc::new(NoVpmBackend),
                BuildRecordStore::new(parent.join("records")),
                Arc::new(FixedClock::new(&["2026-09-07T00:00:00Z"])),
                parent.join("executor-temp"),
                "2022.3.22f1",
                LocalPackageIdentityStore::new(parent.join("identities.json")),
            )),
            GenerateVpmTaskSpec {
                correlation_id: "corr-gen-x".into(),
                warehouse_item_id: "whi-nope".into(),
                warehouse_root: parent.clone(),
                global_default: ArtifactMode::GenerateVpm,
                import_correlation_id: None,
            },
            None,
        )
        .unwrap();
        assert_eq!(
            wait_for_terminal(&rt, &accepted.task_id).state,
            TaskState::Failed
        );
        let app = expect_failed_error(&journal, &accepted.task_id);
        assert_eq!(app.code, "vua.warehouse.entry_not_found");
        assert_eq!(app.category, vua_orchestrator::ErrorCategory::Validation);
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn delete_originals_invalid_state_surfaces_the_conflict_code() {
        let parent = unique_dir("vua-maint", "del-code");
        let world = make_world(&parent, true);
        // No override: guard (c) must refuse with the stable conflict code.

        let (rt, journal) = generate_runtime();
        let accepted = submit_delete_originals(
            &rt,
            world.store.clone(),
            DeleteOriginalsTaskSpec {
                correlation_id: "corr-del-code".into(),
                warehouse_item_id: world.entry_id.clone(),
                global_default: ArtifactMode::UseOriginalUnitypackage,
            },
            None,
        )
        .unwrap();
        assert_eq!(
            wait_for_terminal(&rt, &accepted.task_id).state,
            TaskState::Failed
        );
        let app = expect_failed_error(&journal, &accepted.task_id);
        assert_eq!(app.code, "vua.warehouse.invalid_state");
        assert_eq!(app.category, vua_orchestrator::ErrorCategory::Conflict);
        assert!(app.recoverable);
        let params = app.params.expect("the conflict names its context");
        assert_eq!(
            params.get("effectiveMode"),
            Some(&ParamValue::Text("use_original_unitypackage".into()))
        );
        fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn maintenance_error_mapping_is_stable_across_both_tables() {
        let samples: Vec<Box<dyn Fn() -> MaintenanceError>> = vec![
            Box::new(|| {
                MaintenanceError::Store(BdlStoreError::UnknownWarehouseItem("whi-x".into()))
            }),
            Box::new(|| MaintenanceError::Io(std::io::Error::other("disk gone"))),
            Box::new(|| MaintenanceError::UnknownEntry("whi-x".into())),
            Box::new(|| MaintenanceError::InvalidState {
                entry_id: "whi-x".into(),
                effective_mode: ArtifactMode::UseOriginalUnitypackage,
            }),
            Box::new(|| MaintenanceError::GeneratedArtifactMissing {
                entry_id: "whi-x".into(),
                reason: "tampered".into(),
            }),
            Box::new(|| MaintenanceError::NoOriginalMaterial {
                entry_id: "whi-x".into(),
            }),
            Box::new(|| MaintenanceError::AlreadyGenerated {
                entry_id: "whi-x".into(),
            }),
            Box::new(|| MaintenanceError::GenerationFailed {
                code: "vua.material.staging_failed".into(),
                message: "the staging chain refused".into(),
            }),
        ];
        let expected: &[(&str, vua_orchestrator::ErrorCategory)] = &[
            (
                "vua.warehouse.storeFailed",
                vua_orchestrator::ErrorCategory::Internal,
            ),
            (
                "vua.warehouse.maintenanceIoFailed",
                vua_orchestrator::ErrorCategory::ExternalFailure,
            ),
            (
                "vua.warehouse.entry_not_found",
                vua_orchestrator::ErrorCategory::Validation,
            ),
            (
                "vua.warehouse.invalid_state",
                vua_orchestrator::ErrorCategory::Conflict,
            ),
            (
                "vua.warehouse.generated_artifact_missing",
                vua_orchestrator::ErrorCategory::Conflict,
            ),
            (
                "vua.warehouse.no_original_material",
                vua_orchestrator::ErrorCategory::Conflict,
            ),
            (
                "vua.warehouse.already_generated",
                vua_orchestrator::ErrorCategory::Conflict,
            ),
            (
                "vua.warehouse.generation_failed",
                vua_orchestrator::ErrorCategory::ExternalFailure,
            ),
        ];
        for (make_error, (code, category)) in samples.into_iter().zip(expected) {
            let via_delete = maintenance_error_to_app(make_error(), "corr-map");
            let via_generate = generate_error_to_app(make_error(), "corr-map");
            assert_eq!(via_delete.code, *code, "delete table maps {code}");
            assert_eq!(via_delete.category, *category, "delete table maps {code}");
            assert!(
                via_delete.recoverable,
                "maintenance failures stay recoverable"
            );
            assert_eq!(via_generate.code, *code, "generate table maps {code}");
            assert_eq!(
                via_generate.category, *category,
                "generate table maps {code}"
            );
            assert!(
                via_generate.recoverable,
                "maintenance failures stay recoverable"
            );
            assert_eq!(via_generate.correlation_id, "corr-map");
        }
    }

    #[test]
    fn invalid_state_mapping_carries_the_effective_mode_param() {
        let app = generate_error_to_app(
            MaintenanceError::InvalidState {
                entry_id: "whi-x".into(),
                effective_mode: ArtifactMode::UseOriginalUnitypackage,
            },
            "corr-guard",
        );
        let params = app.params.expect("the conflict carries params");
        assert_eq!(
            params.get("warehouseItemId"),
            Some(&ParamValue::Text("whi-x".into()))
        );
        assert_eq!(
            params.get("effectiveMode"),
            Some(&ParamValue::Text("use_original_unitypackage".into()))
        );
    }

    /// The import-orchestrated auto-generation hook (proposal 010 path A,
    /// implemented in `warehouse_import`): a real batch import with the
    /// hook on lands the entry, submits the generation with the audit
    /// chain, and the generation runs to success on the fixture bridge.
    #[test]
    fn import_hook_submits_generation_with_the_audit_chain() {
        let parent = unique_dir("vua-maint", "hook-on");
        let (world, executor, _bridge) = make_generate_setup(&parent);
        // The persisted global default rules the hook (read per landing).
        world
            .store
            .set_global_default_mode(ArtifactMode::GenerateVpm)
            .unwrap();

        let source = parent.join("incoming");
        fs::create_dir_all(&source).unwrap();
        write_synthetic_archive(
            &source.join("pack.unitypackage"),
            &["Assets/hook/asset.txt"],
        );

        let (rt, journal) = generate_runtime();
        let auto = AutoGenerateSpec {
            env_initial: ArtifactMode::UseOriginalUnitypackage,
            executor,
        };
        let accepted = submit_warehouse_import_auto(
            rt.clone(),
            world.store.clone(),
            Arc::new(FixedClock::new(&["2026-09-08T07:00:00Z"])),
            WarehouseImportTaskSpec {
                correlation_id: "corr-import-1".into(),
                source_folders: vec![source],
                warehouse_root: parent.join("wh-hook"),
                auto_generate: Some(auto.clone()),
            },
            Some(auto),
            None,
        )
        .unwrap();

        // The orchestrated generation appears with the derived correlation
        // and runs to a terminal state on the fixture bridge.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let generation_correlation = loop {
            let snapshots = rt.snapshot_all();
            if let Some(live) = snapshots
                .iter()
                .find(|snapshot| snapshot.correlation_id.starts_with("corr-import-1-auto-"))
            {
                if live.state.is_terminal() {
                    break live.correlation_id.clone();
                }
            }
            assert!(
                std::time::Instant::now() < deadline,
                "generation did not finish"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        };

        // The audit chain: the generation's journal completion carries the
        // importCorrelationId back to this import task.
        let snapshots = rt.snapshot_all();
        let generation_task = snapshots
            .iter()
            .find(|snapshot| snapshot.correlation_id == generation_correlation)
            .expect("the orchestrated generation is registered");
        let payload = completed_payload(&journal, &generation_task.task_id);
        match payload {
            JournalPayload::Completed {
                result: Some(done),
                error: None,
                ..
            } => {
                assert_eq!(
                    done["importCorrelationId"],
                    serde_json::json!("corr-import-1")
                );
            }
            other => panic!("expected a successful generation completion, got {other:?}"),
        }

        // The generated VPM package copy is real: the imported entry (not
        // the fixture entry) carries it after the orchestrated generation.
        let import_done = completed_payload(&journal, &accepted.task_id);
        let imported_entry_id = match import_done {
            JournalPayload::Completed {
                result: Some(done),
                error: None,
                ..
            } => done["reports"][0]["entry"]["warehouseItemId"]
                .as_str()
                .expect("the import report carries the created entry id")
                .to_owned(),
            other => panic!("expected a successful import completion, got {other:?}"),
        };
        let detail = world
            .store
            .warehouse_entry_detail(&imported_entry_id, ArtifactMode::GenerateVpm)
            .unwrap()
            .expect("the imported entry exists");
        assert_eq!(detail.warehouse_item_id, imported_entry_id);
        assert!(
            detail
                .artifacts
                .iter()
                .any(|artifact| artifact.role == CopyRole::GeneratedVpm),
            "the orchestrated generation produced the VPM package copy"
        );
    }

    /// The manual import face never orchestrates: same fixture, hook off.
    #[test]
    fn manual_import_face_never_submits_generation() {
        let parent = unique_dir("vua-maint", "hook-off");
        let (world, _executor, _bridge) = make_generate_setup(&parent);
        world
            .store
            .set_global_default_mode(ArtifactMode::GenerateVpm)
            .unwrap();

        let source = parent.join("incoming");
        fs::create_dir_all(&source).unwrap();
        write_synthetic_archive(
            &source.join("pack.unitypackage"),
            &["Assets/hook/asset.txt"],
        );

        let (rt, _journal) = generate_runtime();
        submit_warehouse_import(
            &rt,
            world.store.clone(),
            Arc::new(FixedClock::new(&["2026-09-08T07:00:00Z"])),
            WarehouseImportTaskSpec {
                correlation_id: "corr-import-2".into(),
                source_folders: vec![source],
                warehouse_root: parent.join("wh-manual"),
                auto_generate: None,
            },
            None,
        )
        .unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let snapshots = rt.snapshot_all();
            if snapshots
                .iter()
                .all(|snapshot| snapshot.state.is_terminal())
            {
                assert!(
                    snapshots
                        .iter()
                        .all(|snapshot| !snapshot.correlation_id.contains("-auto-")),
                    "the manual face must not orchestrate a generation"
                );
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "import did not finish"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }

    /// The persisted global default rules the hook even when it disagrees
    /// with the injected initial (read-time evaluation, W14 semantics).
    #[test]
    fn persisted_original_rules_the_hook_over_the_injected_initial() {
        let parent = unique_dir("vua-maint", "hook-persisted");
        let (world, executor, _bridge) = make_generate_setup(&parent);
        world
            .store
            .set_global_default_mode(ArtifactMode::UseOriginalUnitypackage)
            .unwrap();

        let source = parent.join("incoming");
        fs::create_dir_all(&source).unwrap();
        write_synthetic_archive(
            &source.join("pack.unitypackage"),
            &["Assets/hook/asset.txt"],
        );

        let (rt, _journal) = generate_runtime();
        submit_warehouse_import_auto(
            rt.clone(),
            world.store.clone(),
            Arc::new(FixedClock::new(&["2026-09-08T07:00:00Z"])),
            WarehouseImportTaskSpec {
                correlation_id: "corr-import-3".into(),
                source_folders: vec![source],
                warehouse_root: parent.join("wh-persisted"),
                auto_generate: Some(AutoGenerateSpec {
                    env_initial: ArtifactMode::GenerateVpm,
                    executor: executor.clone(),
                }),
            },
            Some(AutoGenerateSpec {
                env_initial: ArtifactMode::GenerateVpm,
                executor,
            }),
            None,
        )
        .unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let snapshots = rt.snapshot_all();
            if snapshots
                .iter()
                .all(|snapshot| snapshot.state.is_terminal())
            {
                assert!(
                    snapshots
                        .iter()
                        .all(|snapshot| !snapshot.correlation_id.contains("-auto-")),
                    "composed=original must not orchestrate a generation"
                );
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "import did not finish"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}

//! Managed library acquisition. Task checkpoints own batch intent/results;
//! BDL owns delivery and copy evidence; the host only dispatches/publicizes.

use crate::artifact_inspection::{
    hex_lower, sha256_file, ArtifactInspector, DownloadInspectionOutcome, DownloadInspectionRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use vua_bdl_store::{
    ArtifactInspectionState, BdlStore, BdlStoreError, CopyRole, DownloadEventConsumer,
    DownloadPhase, StoredArtifactCopy,
};
use vua_orchestrator::{
    AppErrorV1, Clock, ErrorCategory, NewTask, SqliteStoreError, SqliteTaskStore, StoredTaskEvent,
    SubmitRequest, SystemClock, TaskContext, TaskExit, TaskMutation, TaskRuntime, TaskState,
};

#[derive(Debug)]
pub struct LibraryDownloadError(pub &'static str);
impl From<SqliteStoreError> for LibraryDownloadError {
    fn from(_: SqliteStoreError) -> Self {
        Self("store_failed")
    }
}
impl From<BdlStoreError> for LibraryDownloadError {
    fn from(_: BdlStoreError) -> Self {
        Self("store_failed")
    }
}
impl From<serde_json::Error> for LibraryDownloadError {
    fn from(_: serde_json::Error) -> Self {
        Self("invalid_params")
    }
}
impl From<std::io::Error> for LibraryDownloadError {
    fn from(_: std::io::Error) -> Self {
        Self("file_io_failed")
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilePhase {
    Queued,
    Downloading,
    Downloaded,
    Inspecting,
    Stored,
    Failed,
    Cancelled,
    Unconfirmed,
}
impl FilePhase {
    fn terminal(&self) -> bool {
        matches!(
            self,
            Self::Stored | Self::Failed | Self::Cancelled | Self::Unconfirmed
        )
    }
    fn transferring(&self) -> bool {
        matches!(self, Self::Queued | Self::Downloading)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct File {
    downloadable_id: i64,
    file_name: String,
    phase: FilePhase,
    download_id: Option<String>,
    error_code: Option<String>,
    entry_id: Option<String>,
    copy_id: Option<String>,
    expected_sha256: Option<String>,
    artifact_sha256: Option<String>,
    replaced: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Checkpoint {
    schema_version: String,
    operation: String,
    batch_id: String,
    product_id: String,
    files: Vec<File>,
    adoption_task_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Begin {
    schema_version: String,
    batch_id: String,
    product_id: String,
    downloadable_ids: Vec<i64>,
    #[serde(default)]
    replacement_targets: Vec<Target>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Target {
    downloadable_id: i64,
    copy_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Observe {
    schema_version: String,
    batch_id: String,
    downloadable_id: i64,
    outcome: Observation,
    download_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Observation {
    Started,
    Settled,
    InitiationFailed,
    Cancelled,
    Unconfirmed,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Status {
    schema_version: String,
    batch_id: String,
}

fn identity(version: &str, batch_id: &str) -> Result<(), LibraryDownloadError> {
    let suffix = batch_id
        .strip_prefix("library-download-")
        .ok_or(LibraryDownloadError("invalid_params"))?;
    if version != "0.1"
        || suffix.is_empty()
        || suffix.len() > 100
        || !suffix
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
    {
        return Err(LibraryDownloadError("invalid_params"));
    }
    Ok(())
}

pub struct LibraryDownloadService {
    store: Arc<SqliteTaskStore>,
    bdl: Arc<BdlStore>,
    runtime: TaskRuntime,
    warehouse_root: PathBuf,
    staging_root: PathBuf,
    recovered: HashSet<String>,
    mutations: Mutex<()>,
    copy_writes: Arc<Mutex<()>>,
    pub(crate) library_content_checks: Arc<Mutex<crate::library_reconcile::ContentChecks>>,
}
impl LibraryDownloadService {
    pub fn new(
        store: Arc<SqliteTaskStore>,
        bdl: Arc<BdlStore>,
        runtime: TaskRuntime,
        warehouse_root: PathBuf,
        staging_root: PathBuf,
    ) -> Result<Self, SqliteStoreError> {
        let recovered = store
            .tasks()?
            .into_iter()
            .filter(|task| {
                task.task_id.starts_with("library-download-") && !task.state.is_terminal()
            })
            .map(|task| task.task_id)
            .collect();
        let library_content_checks = crate::library_reconcile::ContentChecks::restore(&store)?;
        Ok(Self {
            store,
            bdl,
            runtime,
            warehouse_root,
            staging_root,
            recovered,
            mutations: Mutex::new(()),
            copy_writes: Arc::new(Mutex::new(())),
            library_content_checks: Arc::new(Mutex::new(library_content_checks)),
        })
    }

    pub(crate) fn copy_write_lock(&self) -> Arc<Mutex<()>> {
        self.copy_writes.clone()
    }

    /// An acquisition continuation, accepted before hashing. Listing queries
    /// consume its proofs and never perform long file reads themselves.
    pub fn reconcile_library_sources(
        &self,
        trigger_id: &str,
    ) -> Result<Option<String>, LibraryDownloadError> {
        let _admission = self.mutations.lock().expect("library mutations poisoned");
        let operation = crate::library_reconcile::OPERATION;
        if let Some(prior) = self
            .store
            .idempotent_tasks(operation)?
            .into_iter()
            .find(|t| t.idempotency_key == trigger_id)
        {
            return Ok(Some(prior.task_id));
        }
        let removed = self.bdl.removed_local_entries()?;
        let copies: Vec<_> = self.bdl.library_copy_evidence()?.into_iter().filter(|copy| !removed.contains(&copy.copy.warehouse_item_id)).collect();
        let reference_hashes: HashSet<_> = copies
            .iter()
            .filter(|copy| (copy.downloadable_id.is_some() || copy.archive_downloadable_id.is_some() && copy.archive_current) && copy.copy.role == CopyRole::Original)
            .map(|copy| copy.copy.artifact_sha256.as_str())
            .collect();
        let candidate_ids: HashSet<_> = copies
            .iter()
            .filter(|copy| {
                copy.downloadable_id.is_none()
                    && copy.archive_downloadable_id.is_none()
                    && copy.copy.role == CopyRole::Original
                    && reference_hashes.contains(copy.copy.artifact_sha256.as_str())
            })
            .map(|copy| copy.copy.copy_id.clone())
            .collect();
        let candidates: Vec<_> = copies
            .into_iter()
            .filter(|copy| candidate_ids.contains(&copy.copy.copy_id))
            .collect();
        if candidates.is_empty() {
            return Ok(None);
        }
        let fingerprint = serde_json::to_string(
            &candidates
                .iter()
                .map(|c| (&c.copy.copy_id, &c.copy.artifact_sha256))
                .collect::<Vec<_>>(),
        )?;
        let accepted = self
            .runtime
            .submit_idempotent(
                SubmitRequest {
                    correlation_id: Some(format!("library-reconcile:{trigger_id}")),
                    timeout: None,
                    job: crate::library_reconcile::verification_job(
                        candidates,
                        self.warehouse_root.clone(),
                        self.bdl.clone(),
                        self.copy_writes.clone(),
                        self.library_content_checks.clone(),
                        trigger_id.to_owned(),
                    ),
                },
                operation,
                trigger_id,
                &fingerprint,
            )
            .map_err(|_| LibraryDownloadError("store_failed"))?;
        Ok(Some(accepted.task_id))
    }

    pub(crate) fn has_active_download(
        &self,
        copy_ids: &[String],
        product_ids: &[String],
    ) -> Result<bool, LibraryDownloadError> {
        for task in self.store.tasks()?.into_iter().filter(|task| {
            task.task_id.starts_with("library-download-") && !task.state.is_terminal()
        }) {
            let current = self.load(&task.task_id)?;
            if product_ids.contains(&current.product_id)
                || current.files.iter().any(|file| {
                    file.copy_id
                        .as_ref()
                        .is_some_and(|id| copy_ids.contains(id))
                })
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn library_snapshots(&self) -> Result<Vec<Value>, LibraryDownloadError> {
        let mut tasks = self.store.tasks()?;
        tasks.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.task_id.cmp(&a.task_id))
        });
        tasks
            .into_iter()
            .filter(|task| task.task_id.starts_with("library-download-"))
            .map(|task| self.snapshot(&self.load(&task.task_id)?))
            .collect()
    }

    fn load(&self, batch_id: &str) -> Result<Checkpoint, LibraryDownloadError> {
        let events = self.store.events_after(batch_id, 0)?;
        let payload = events
            .iter()
            .rev()
            .find(|event| event.payload["operation"] == "library.download")
            .ok_or(LibraryDownloadError("batch_not_found"))?
            .payload
            .clone();
        serde_json::from_value(payload).map_err(|_| LibraryDownloadError("store_failed"))
    }
    fn mutate(
        &self,
        current: &Checkpoint,
        mutation: TaskMutation,
        emit: &mut impl FnMut(StoredTaskEvent),
    ) -> Result<(), LibraryDownloadError> {
        let task = self
            .store
            .task(&current.batch_id)?
            .ok_or(LibraryDownloadError("batch_not_found"))?;
        if let Some(event) = self.store.mutate_task(
            &current.batch_id,
            task.revision,
            &SystemClock.now_rfc3339(),
            mutation,
        )? {
            emit(event);
        }
        Ok(())
    }
    fn save(
        &self,
        current: &Checkpoint,
        emit: &mut impl FnMut(StoredTaskEvent),
    ) -> Result<(), LibraryDownloadError> {
        self.mutate(
            current,
            TaskMutation::Progress {
                payload: serde_json::to_value(current)?,
            },
            emit,
        )
    }
    fn snapshot(&self, current: &Checkpoint) -> Result<Value, LibraryDownloadError> {
        let task = self
            .store
            .task(&current.batch_id)?
            .ok_or(LibraryDownloadError("batch_not_found"))?;
        let files = current.files.iter().map(|file| json!({
            "downloadableId": file.downloadable_id, "fileName": file.file_name, "phase": file.phase,
            "downloadId": file.download_id, "errorCode": file.error_code, "entryId": file.entry_id,
            "copyId": file.copy_id, "artifactSha256": file.artifact_sha256, "replaced": file.replaced,
        })).collect::<Vec<_>>();
        Ok(
            json!({ "schemaVersion": "0.1", "batchId": current.batch_id, "taskId": current.batch_id,
                "productId": current.product_id, "revision": task.revision, "state": task.state,
                "cancellationRequested": task.cancel_requested,
                "recoveryDisposition": if self.recovered.contains(&current.batch_id) || current.files.iter().any(|file| file.phase == FilePhase::Unconfirmed || file.error_code.as_deref() == Some("vua.library.staging_cleanup_failed")) { "inspect_required" } else { "none" },
                "files": files,
            }),
        )
    }

    pub fn apply(
        &self,
        method: &str,
        params: Value,
        mut emit: impl FnMut(StoredTaskEvent),
    ) -> Result<Value, LibraryDownloadError> {
        let _guard = self
            .mutations
            .lock()
            .expect("library download mutations poisoned");
        match method {
            "library.beginDownload" => {
                let _copy_guard = self.copy_writes.lock().expect("copy writes poisoned");
                let request: Begin = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.batch_id)?;
                if !request
                    .product_id
                    .strip_prefix("booth:")
                    .is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()))
                    || request.downloadable_ids.is_empty()
                    || request.downloadable_ids.len() > 200
                    || request
                        .downloadable_ids
                        .iter()
                        .any(|id| *id <= 0 || *id > 9_007_199_254_740_991)
                    || request
                        .downloadable_ids
                        .iter()
                        .collect::<HashSet<_>>()
                        .len()
                        != request.downloadable_ids.len()
                    || request.replacement_targets.iter().any(|target| {
                        !request.downloadable_ids.contains(&target.downloadable_id)
                            || target.copy_id.is_empty()
                    })
                    || request
                        .replacement_targets
                        .iter()
                        .map(|target| target.downloadable_id)
                        .collect::<HashSet<_>>()
                        .len()
                        != request.replacement_targets.len()
                {
                    return Err(LibraryDownloadError("invalid_params"));
                }
                if self.store.task(&request.batch_id)?.is_some() {
                    let current = self.load(&request.batch_id)?;
                    if current.product_id != request.product_id
                        || current
                            .files
                            .iter()
                            .map(|file| file.downloadable_id)
                            .collect::<Vec<_>>()
                            != request.downloadable_ids
                        || request.replacement_targets.iter().any(|target| {
                            current
                                .files
                                .iter()
                                .find(|file| file.downloadable_id == target.downloadable_id)
                                .and_then(|file| file.copy_id.as_deref())
                                != Some(&target.copy_id)
                        })
                    {
                        return Err(LibraryDownloadError("batch_conflict"));
                    }
                    return self.snapshot(&current);
                }
                for task in self.store.tasks()?.iter().filter(|task| {
                    task.task_id.starts_with("library-download-") && !task.state.is_terminal()
                }) {
                    if self
                        .load(&task.task_id)?
                        .files
                        .iter()
                        .any(|file| request.downloadable_ids.contains(&file.downloadable_id))
                    {
                        return Err(LibraryDownloadError("file_busy"));
                    }
                }
                let captured = self.bdl.downloadables_for_product(&request.product_id)?;
                let mut files = Vec::new();
                for id in &request.downloadable_ids {
                    let label = captured
                        .iter()
                        .find(|(found, _)| found == id)
                        .ok_or(LibraryDownloadError("file_not_captured"))?
                        .1
                        .clone();
                    let managed = self.bdl.managed_library_file(*id)?;
                    let candidates = if managed.is_none() {
                        self.bdl.legacy_download_copies(*id)?
                    } else {
                        Vec::new()
                    };
                    let selected = request
                        .replacement_targets
                        .iter()
                        .find(|target| target.downloadable_id == *id);
                    let target = if let Some(managed) = managed {
                        if selected.is_some_and(|target| target.copy_id != managed.copy_id) {
                            return Err(LibraryDownloadError("replacement_target_conflict"));
                        }
                        Some((
                            managed.copy_id,
                            managed.warehouse_item_id,
                            managed.artifact_sha256,
                        ))
                    } else if let Some(selected) = selected {
                        let target = candidates
                            .iter()
                            .find(|copy| copy.copy_id == selected.copy_id)
                            .ok_or(LibraryDownloadError("replacement_target_conflict"))?;
                        Some((
                            target.copy_id.clone(),
                            target.warehouse_item_id.clone(),
                            target.artifact_sha256.clone(),
                        ))
                    } else if candidates.len() == 1 {
                        let target = &candidates[0];
                        Some((
                            target.copy_id.clone(),
                            target.warehouse_item_id.clone(),
                            target.artifact_sha256.clone(),
                        ))
                    } else if candidates.len() > 1 {
                        return Err(LibraryDownloadError("replacement_ambiguous"));
                    } else {
                        None
                    };
                    files.push(File {
                        downloadable_id: *id,
                        file_name: label,
                        phase: FilePhase::Queued,
                        download_id: None,
                        error_code: None,
                        entry_id: target.as_ref().map(|target| target.1.clone()),
                        copy_id: target.as_ref().map(|target| target.0.clone()),
                        expected_sha256: target.map(|target| target.2),
                        artifact_sha256: None,
                        replaced: false,
                    });
                }
                for removal in self.store.idempotent_tasks("library.removeFiles")? {
                    if self
                        .store
                        .task(&removal.task_id)?
                        .is_some_and(|task| !task.state.is_terminal())
                    {
                        let target_copies: Vec<_> = files
                            .iter()
                            .filter_map(|file| file.copy_id.clone())
                            .collect();
                        if crate::library_maintenance::removal_conflicts_with_download(
                            &removal.request_fingerprint,
                            &target_copies,
                            &request.product_id,
                            &self.bdl,
                        )? {
                            return Err(LibraryDownloadError("file_busy"));
                        }
                    }
                }
                let current = Checkpoint {
                    schema_version: "0.1".into(),
                    operation: "library.download".into(),
                    batch_id: request.batch_id,
                    product_id: request.product_id,
                    files,
                    adoption_task_id: None,
                };
                let (_, event) = self.store.accept_task(&NewTask {
                    task_id: current.batch_id.clone(),
                    correlation_id: current.batch_id.clone(),
                    occurred_at: SystemClock.now_rfc3339(),
                })?;
                emit(event);
                for state in [TaskState::Preparing, TaskState::Running] {
                    self.mutate(
                        &current,
                        TaskMutation::Transition {
                            state,
                            payload: serde_json::to_value(&current)?,
                        },
                        &mut emit,
                    )?;
                }
                self.snapshot(&current)
            }
            "library.observeDownload" => {
                if params.get("downloadId").is_some_and(Value::is_null) {
                    return Err(LibraryDownloadError("invalid_params"));
                }
                let request: Observe = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.batch_id)?;
                if matches!(request.outcome, Observation::Started | Observation::Settled)
                    != request.download_id.is_some()
                    || request
                        .download_id
                        .as_ref()
                        .is_some_and(|id| id.is_empty() || id.len() > 200)
                {
                    return Err(LibraryDownloadError("invalid_params"));
                }
                let mut current = self.load(&request.batch_id)?;
                if self.recovered.contains(&request.batch_id) {
                    return Err(LibraryDownloadError("inspect_required"));
                }
                let task = self
                    .store
                    .task(&request.batch_id)?
                    .ok_or(LibraryDownloadError("batch_not_found"))?;
                let file = current
                    .files
                    .iter_mut()
                    .find(|file| file.downloadable_id == request.downloadable_id)
                    .ok_or(LibraryDownloadError("file_not_selected"))?;
                if file.download_id.is_some()
                    && file.download_id != request.download_id
                    && request.download_id.is_some()
                {
                    return Err(LibraryDownloadError("delivery_conflict"));
                }
                if file.phase.terminal()
                    || file.phase == FilePhase::Inspecting
                    || file.phase == FilePhase::Downloaded
                {
                    self.advance(&mut current, &mut emit)?;
                    return self.snapshot(&current);
                }
                if task.state.is_terminal() {
                    return Err(LibraryDownloadError("batch_terminal"));
                }
                match request.outcome {
                    Observation::Started | Observation::Settled => {
                        let download_id = request.download_id.as_deref().unwrap();
                        let exact =
                            format!("https://booth.pm/downloadables/{}", file.downloadable_id);
                        let history = self.bdl.download_events(download_id)?;
                        if history.is_empty()
                            || !history.iter().any(|event| {
                                event.source_url == exact
                                    || event
                                        .url_chain
                                        .as_ref()
                                        .is_some_and(|urls| urls.contains(&exact))
                            })
                        {
                            return Err(LibraryDownloadError("delivery_not_persisted"));
                        }
                        let lifecycle = DownloadEventConsumer::new(&self.bdl)
                            .lifecycle(download_id)
                            .map_err(|_| LibraryDownloadError("delivery_not_persisted"))?
                            .ok_or(LibraryDownloadError("delivery_not_persisted"))?;
                        file.download_id = request.download_id;
                        file.phase = match lifecycle.phase {
                            DownloadPhase::Downloading | DownloadPhase::Interrupted
                                if matches!(request.outcome, Observation::Started) =>
                            {
                                FilePhase::Downloading
                            }
                            DownloadPhase::TransferDone => {
                                if task.cancel_requested {
                                    FilePhase::Cancelled
                                } else {
                                    FilePhase::Downloaded
                                }
                            }
                            DownloadPhase::Failed => {
                                file.error_code = Some("vua.library.transfer_failed".into());
                                FilePhase::Failed
                            }
                            DownloadPhase::Cancelled => FilePhase::Cancelled,
                            _ => return Err(LibraryDownloadError("delivery_not_settled")),
                        };
                    }
                    Observation::InitiationFailed => {
                        file.phase = FilePhase::Failed;
                        file.error_code = Some("vua.library.initiation_failed".into());
                    }
                    Observation::Cancelled => {
                        if file.phase != FilePhase::Queued {
                            return Err(LibraryDownloadError("delivery_not_settled"));
                        }
                        file.phase = FilePhase::Cancelled;
                    }
                    Observation::Unconfirmed => {
                        file.phase = FilePhase::Unconfirmed;
                        file.error_code = Some("vua.library.delivery_unconfirmed".into());
                    }
                }
                self.save(&current, &mut emit)?;
                self.advance(&mut current, &mut emit)?;
                self.snapshot(&current)
            }
            "library.downloadStatus" => {
                let request: Status = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.batch_id)?;
                let mut current = self.load(&request.batch_id)?;
                if !self.recovered.contains(&request.batch_id) {
                    self.advance(&mut current, &mut emit)?;
                }
                self.snapshot(&current)
            }
            _ => Err(LibraryDownloadError("invalid_params")),
        }
    }

    /// Worker events update the parent through the same serialized authority.
    pub fn reconcile(
        &self,
        batch_id: &str,
        mut emit: impl FnMut(StoredTaskEvent),
    ) -> Result<(), LibraryDownloadError> {
        if !batch_id.starts_with("library-download-") || self.recovered.contains(batch_id) {
            return Ok(());
        }
        let _guard = self
            .mutations
            .lock()
            .expect("library download mutations poisoned");
        let mut current = self.load(batch_id)?;
        self.advance(&mut current, &mut emit)
    }
    pub fn cancel_child(
        &self,
        batch_id: &str,
        mut emit: impl FnMut(StoredTaskEvent),
    ) -> Result<(), LibraryDownloadError> {
        if !batch_id.starts_with("library-download-") {
            return Ok(());
        }
        let _guard = self
            .mutations
            .lock()
            .expect("library download mutations poisoned");
        let mut current = self.load(batch_id)?;
        if self.recovered.contains(batch_id) {
            // Explicit user cancellation may close abandoned intent. No transport
            // or worker is resumed, and uncertain replacement residue stays visible.
            let task = self
                .store
                .task(batch_id)?
                .ok_or(LibraryDownloadError("batch_not_found"))?;
            if !task.state.is_terminal() && task.cancel_requested {
                for file in &mut current.files {
                    if !file.phase.terminal() {
                        file.phase = if current.adoption_task_id.is_some() {
                            FilePhase::Unconfirmed
                        } else {
                            FilePhase::Cancelled
                        };
                        if file.phase == FilePhase::Unconfirmed {
                            file.error_code = Some("vua.library.inspection_unconfirmed".into());
                        }
                    }
                }
                self.save(&current, &mut emit)?;
                self.mutate(
                    &current,
                    TaskMutation::Complete {
                        state: TaskState::Cancelled,
                        error: None,
                        result: None,
                    },
                    &mut emit,
                )?;
            }
        } else {
            if let Some(child) = current.adoption_task_id {
                let _ = self.runtime.cancel(&child);
            }
        }
        Ok(())
    }

    fn advance(
        &self,
        current: &mut Checkpoint,
        emit: &mut impl FnMut(StoredTaskEvent),
    ) -> Result<(), LibraryDownloadError> {
        let parent = self
            .store
            .task(&current.batch_id)?
            .ok_or(LibraryDownloadError("batch_not_found"))?;
        if parent.state.is_terminal() {
            return Ok(());
        }
        if let Some(child_id) = &current.adoption_task_id {
            let child = self
                .store
                .task(child_id)?
                .ok_or(LibraryDownloadError("store_failed"))?;
            let before = current.files.clone();
            for event in self.store.events_after(child_id, 0)? {
                if let Some(value) = event.payload.get("libraryFile") {
                    let result: File = serde_json::from_value(value.clone())
                        .map_err(|_| LibraryDownloadError("store_failed"))?;
                    if let Some(file) = current
                        .files
                        .iter_mut()
                        .find(|file| file.downloadable_id == result.downloadable_id)
                    {
                        *file = result;
                    }
                }
            }
            if child.state.is_terminal() {
                for file in &mut current.files {
                    if !file.phase.terminal() {
                        file.phase = if child.state == TaskState::Cancelled {
                            FilePhase::Cancelled
                        } else {
                            FilePhase::Unconfirmed
                        };
                        file.error_code = if file.phase == FilePhase::Unconfirmed {
                            Some("vua.library.inspection_unconfirmed".into())
                        } else {
                            None
                        };
                    }
                }
            }
            if before != current.files {
                self.save(current, emit)?;
            }
        } else if !current.files.iter().any(|file| file.phase.transferring())
            && current
                .files
                .iter()
                .any(|file| file.phase == FilePhase::Downloaded)
        {
            if parent.cancel_requested {
                for file in &mut current.files {
                    if file.phase == FilePhase::Downloaded {
                        file.phase = FilePhase::Cancelled;
                    }
                }
                self.save(current, emit)?;
            } else {
                let spec = current.clone();
                let bdl = self.bdl.clone();
                let root = self.warehouse_root.clone();
                let staging = self.staging_root.clone();
                let copy_writes = self.copy_writes.clone();
                let fingerprint = serde_json::to_string(&spec)?;
                let accepted = self
                    .runtime
                    .submit_idempotent(
                        SubmitRequest {
                            correlation_id: Some(current.batch_id.clone()),
                            timeout: None,
                            job: Box::new(move |ctx| {
                                let mut reports = Vec::new();
                                for mut file in spec.files {
                                    if file.phase != FilePhase::Downloaded {
                                        continue;
                                    }
                                    if ctx.check_cancel() {
                                        file.phase = FilePhase::Cancelled;
                                    } else {
                                        let _copy_guard =
                                            copy_writes.lock().expect("copy writes poisoned");
                                        file.phase = FilePhase::Inspecting;
                                        ctx.emit_progress(json!({ "libraryFile": file }));
                                        match store_file(
                                            &bdl,
                                            &root,
                                            &staging,
                                            &spec.batch_id,
                                            &spec.product_id,
                                            &file,
                                            ctx,
                                        ) {
                                            Ok(delivery) => {
                                                let copy = delivery.copy;
                                                file.phase = FilePhase::Stored;
                                                file.error_code =
                                                    delivery.cleanup_error.map(str::to_owned);
                                                if crate::zip_intake::is_zip(&copy.relative_path) {
                                                    let expansion = crate::zip_intake::expand(
                                                        &bdl, &root, &copy, &SystemClock.now_rfc3339(),
                                                        &|| ctx.check_cancel(),
                                                        &|files, bytes| ctx.emit_progress(json!({"operation":"library.expandArchive","downloadableId":file.downloadable_id,"files":files,"bytes":bytes})),
                                                    );
                                                    if expansion.error_code.is_some() { file.error_code = expansion.error_code.clone(); }
                                                    ctx.emit_progress(json!({"operation":"library.archiveExpanded","downloadableId":file.downloadable_id,"expansion":expansion}));
                                                }
                                                file.entry_id = Some(copy.warehouse_item_id);
                                                file.replaced = file.copy_id.is_some();
                                                file.copy_id = Some(copy.copy_id);
                                                file.artifact_sha256 = Some(copy.artifact_sha256);
                                            }
                                            Err(error) => {
                                                file.phase = if error.0 == "cancelled" {
                                                    FilePhase::Cancelled
                                                } else if error.0 == "replacement_recovery_required"
                                                {
                                                    FilePhase::Unconfirmed
                                                } else {
                                                    FilePhase::Failed
                                                };
                                                file.error_code =
                                                    Some(format!("vua.library.{}", error.0));
                                            }
                                        }
                                    }
                                    if file.phase != FilePhase::Stored || file.error_code.is_some()
                                    {
                                        ctx.warn();
                                    }
                                    ctx.emit_progress(json!({ "libraryFile": file }));
                                    reports.push(file);
                                }
                                Ok(TaskExit::Done(json!({ "files": reports })))
                            }),
                        },
                        "library.adoptBatch",
                        &current.batch_id,
                        &fingerprint,
                    )
                    .map_err(|_| LibraryDownloadError("store_failed"))?;
                current.adoption_task_id = Some(accepted.task_id);
                self.save(current, emit)?;
            }
        }
        if current.files.iter().all(|file| file.phase.terminal()) {
            let stored = current
                .files
                .iter()
                .filter(|file| file.phase == FilePhase::Stored)
                .count();
            let state = if parent.cancel_requested
                || current
                    .files
                    .iter()
                    .all(|file| file.phase == FilePhase::Cancelled)
            {
                TaskState::Cancelled
            } else if stored == current.files.len()
                && current.files.iter().all(|file| file.error_code.is_none())
            {
                TaskState::Succeeded
            } else if stored > 0 {
                TaskState::SucceededWithWarnings
            } else {
                TaskState::Failed
            };
            let error = if state == TaskState::Failed {
                Some(AppErrorV1::new(
                    "vua.library.download_failed",
                    ErrorCategory::ExternalFailure,
                    "errors.library.downloadFailed",
                    &current.batch_id,
                ))
            } else {
                None
            };
            let mut result = self.snapshot(current)?;
            result["state"] = json!(state);
            result["revision"] = json!(
                result["revision"]
                    .as_u64()
                    .ok_or(LibraryDownloadError("store_failed"))?
                    + 1
            );
            self.mutate(
                current,
                TaskMutation::Complete {
                    state,
                    error,
                    result: Some(result),
                },
                emit,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "library_download_tests.rs"]
mod tests;

fn storage_name(name: Option<&str>, id: i64) -> String {
    let normalized = name.unwrap_or("").replace('\\', "/");
    let leaf = normalized.rsplit('/').next().unwrap_or("");
    let stem = leaf.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&stem.as_str());
    if leaf.is_empty()
        || leaf.len() > 180
        || leaf.ends_with(['.', ' '])
        || leaf.to_ascii_lowercase().starts_with(".vua-")
        || reserved
        || leaf
            .chars()
            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
    {
        format!("file-{id}.bin")
    } else {
        leaf.into()
    }
}

fn target_copy(
    bdl: &BdlStore,
    file: &File,
) -> Result<Option<StoredArtifactCopy>, LibraryDownloadError> {
    let Some(copy_id) = &file.copy_id else {
        return Ok(None);
    };
    let entry = file
        .entry_id
        .as_deref()
        .ok_or(LibraryDownloadError("replacement_target_conflict"))?;
    let copy = bdl
        .entry_copies(entry)?
        .into_iter()
        .find(|copy| {
            &copy.copy_id == copy_id
                && copy.role == CopyRole::Original
                && Some(&copy.artifact_sha256) == file.expected_sha256.as_ref()
        })
        .ok_or(LibraryDownloadError("replacement_target_conflict"))?;
    Ok(Some(copy))
}

struct ReplacementFiles {
    prepared: PathBuf,
    backup: PathBuf,
    folder: PathBuf,
    owns_prepared: bool,
    owns_backup: bool,
    owns_folder: bool,
    keep_backup: bool,
}
struct StoredDelivery {
    copy: StoredArtifactCopy,
    cleanup_error: Option<&'static str>,
}

fn consume_staging(root: &Path, path: &Path, owned_copy: &Path, expected_sha: &str) -> bool {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if !meta.file_type().is_file() {
        return false;
    }
    let contained = std::fs::canonicalize(root)
        .ok()
        .zip(std::fs::canonicalize(path).ok())
        .zip(std::fs::canonicalize(owned_copy).ok())
        .is_some_and(|((root, path), owned)| path.starts_with(root) && path != owned);
    if !contained
        || sha256_file(path)
            .map(|sha| format!("sha256:{}", hex_lower(&sha)) != expected_sha)
            .unwrap_or(true)
    {
        return false;
    }
    std::fs::remove_file(path).is_ok()
}
impl Drop for ReplacementFiles {
    fn drop(&mut self) {
        if self.owns_prepared {
            let _ = std::fs::remove_file(&self.prepared);
        }
        if self.owns_backup && !self.keep_backup {
            let _ = std::fs::remove_file(&self.backup);
        }
        // Remove only an empty directory created by this invocation.
        if self.owns_folder {
            let _ = std::fs::remove_dir(&self.folder);
        }
    }
}

fn store_file(
    bdl: &BdlStore,
    root: &Path,
    staging_root: &Path,
    batch_id: &str,
    product_id: &str,
    file: &File,
    ctx: &TaskContext,
) -> Result<StoredDelivery, LibraryDownloadError> {
    if bdl
        .product_of_downloadable(file.downloadable_id)?
        .as_deref()
        != Some(product_id)
    {
        return Err(LibraryDownloadError("source_changed"));
    }
    let download_id = file
        .download_id
        .as_deref()
        .ok_or(LibraryDownloadError("delivery_not_persisted"))?;
    let completion = DownloadEventConsumer::new(bdl)
        .staging_completion(download_id)
        .map_err(|_| LibraryDownloadError("delivery_not_persisted"))?
        .ok_or(LibraryDownloadError("delivery_not_persisted"))?;
    let inspected = ArtifactInspector::new(bdl, &SystemClock)
        .inspect_download_for_storage(&DownloadInspectionRequest {
            staging_token: &completion.staging_token,
            download_id,
            expected_staging_root: staging_root,
        })
        .map_err(|_| LibraryDownloadError("inspection_failed"))?;
    let DownloadInspectionOutcome::Inspected(artifact) = inspected else {
        return Err(LibraryDownloadError("inspection_rejected"));
    };
    if artifact.inspection_state == ArtifactInspectionState::Rejected {
        return Err(LibraryDownloadError("inspection_rejected"));
    }
    if ctx.check_cancel() {
        return Err(LibraryDownloadError("cancelled"));
    }
    std::fs::create_dir_all(root)?;
    let canonical_root = std::fs::canonicalize(root)?;
    let prior = target_copy(bdl, file)?;
    let item_id = prior
        .as_ref()
        .map(|copy| copy.warehouse_item_id.clone())
        .unwrap_or_else(|| {
            format!(
                "whi-{:016x}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            )
        });
    let file_name = prior
        .as_ref()
        .map(|copy| copy.relative_path.clone())
        .unwrap_or_else(|| {
            storage_name(
                completion.suggested_file_name.as_deref(),
                file.downloadable_id,
            )
        });
    let destination = prior
        .as_ref()
        .map(|copy| PathBuf::from(&copy.stored_path))
        .unwrap_or_else(|| root.join(&item_id).join(&file_name));
    let folder = destination
        .parent()
        .ok_or(LibraryDownloadError("replacement_target_conflict"))?;
    if prior.is_none() {
        std::fs::create_dir(folder)?;
    }
    let prepared = folder.join(format!(".vua-new-{batch_id}-{}", file.downloadable_id));
    let backup = folder.join(format!(".vua-old-{batch_id}-{}", file.downloadable_id));
    let mut residue = ReplacementFiles {
        prepared: prepared.clone(),
        backup: backup.clone(),
        folder: folder.to_owned(),
        owns_prepared: false,
        owns_backup: false,
        owns_folder: prior.is_none(),
        keep_backup: false,
    };
    if prepared
        .to_string_lossy()
        .eq_ignore_ascii_case(&destination.to_string_lossy())
        || backup
            .to_string_lossy()
            .eq_ignore_ascii_case(&destination.to_string_lossy())
    {
        return Err(LibraryDownloadError("replacement_reserved_name"));
    }
    if !std::fs::canonicalize(folder)?.starts_with(&canonical_root) {
        return Err(LibraryDownloadError("replacement_path_escape"));
    }
    if let Ok(meta) = std::fs::symlink_metadata(&destination) {
        if !meta.file_type().is_file() {
            return Err(LibraryDownloadError("replacement_not_regular"));
        }
    }
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&prepared)?;
    residue.owns_prepared = true;
    let mut input = std::fs::File::open(&completion.stored_path)?;
    let copied = std::io::copy(&mut input, &mut output)?;
    drop(input);
    output.sync_all()?;
    drop(output);
    if copied != artifact.size_bytes
        || format!("sha256:{}", hex_lower(&sha256_file(&prepared)?)) != artifact.artifact_sha256
    {
        return Err(LibraryDownloadError("copy_check_failed"));
    }
    if ctx.check_cancel() {
        return Err(LibraryDownloadError("cancelled"));
    }
    let had_original = destination.is_file();
    if let Some(copy) = &prior {
        if had_original
            && format!("sha256:{}", hex_lower(&sha256_file(&destination)?)) != copy.artifact_sha256
        {
            return Err(LibraryDownloadError("replacement_file_changed"));
        }
        if had_original {
            let mut saved = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&backup)?;
            residue.owns_backup = true;
            std::io::copy(&mut std::fs::File::open(&destination)?, &mut saved)?;
            saved.sync_all()?;
        }
    }
    // This journal checkpoint identifies deterministic recovery files before replace.
    ctx.emit_progress(json!({ "operation": "library.replacePrepared", "batchId": batch_id, "downloadableId": file.downloadable_id, "entryId": item_id, "copyId": file.copy_id, "previousSha256": file.expected_sha256, "newSha256": artifact.artifact_sha256 }));
    if ctx.check_cancel() {
        return Err(LibraryDownloadError("cancelled"));
    }
    if let Err(error) = std::fs::rename(&prepared, &destination) {
        return Err(error.into());
    }
    let now = SystemClock.now_rfc3339();
    let committed = if let Some(copy) = &prior {
        bdl.bind_managed_library_file(
            file.downloadable_id,
            copy,
            &artifact.artifact_sha256,
            download_id,
            &now,
        )
        .map(|_| StoredArtifactCopy {
            artifact_sha256: artifact.artifact_sha256.clone(),
            ..copy.clone()
        })
    } else {
        bdl.record_managed_library_delivery(&vua_bdl_store::ManagedLibraryDelivery {
            downloadable_id: file.downloadable_id,
            item_id: &item_id,
            display_name: &file_name,
            file_name: &file_name,
            stored_path: &destination.to_string_lossy(),
            sha: &artifact.artifact_sha256,
            download_id,
            now: &now,
        })
    };
    match committed {
        Ok(copy) => {
            let mut cleaned = consume_staging(
                staging_root,
                Path::new(&completion.stored_path),
                &destination,
                &artifact.artifact_sha256,
            );
            if residue.owns_backup {
                if std::fs::remove_file(&backup).is_ok() {
                    residue.owns_backup = false;
                } else {
                    residue.keep_backup = true;
                    cleaned = false;
                }
            }
            Ok(StoredDelivery {
                copy,
                cleanup_error: if cleaned {
                    None
                } else {
                    Some("vua.library.staging_cleanup_failed")
                },
            })
        }
        Err(_) => {
            let rollback = if had_original {
                std::fs::rename(&backup, &destination)
            } else {
                std::fs::remove_file(&destination)
            };
            if rollback.is_err() {
                residue.keep_backup = true;
                return Err(LibraryDownloadError("replacement_recovery_required"));
            }
            if prior.is_none() {
                let _ = std::fs::remove_dir(folder);
            }
            Err(LibraryDownloadError("store_failed"))
        }
    }
}

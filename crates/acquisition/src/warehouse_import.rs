//! Warehouse batch import — copy-in import per the warehouse-layout ruling
//! (accepted 2026-09-06): each selected folder becomes one material-package
//! entry, originals are never touched, and there is no deduplication —
//! importing the same content twice creates two entries and one content-
//! keyed inspection fact.
//!
//! The source is user-selected and Kernel-resolved, so unlike the download
//! staging boundary there is no manifest to verify; the trust anchor is the
//! copy AMF itself performs. Per file: mechanical checks (policy size bound,
//! extension allowlist) run against the source metadata BEFORE any copy, so
//! refused files are reported and left in place; accepted files are copied
//! into the entry folder, size-verified against the source, hashed, and
//! recorded as content-keyed artifacts with their physical copy rows. The
//! entry's folder name is its VUA-generated identity, never the display
//! name.

use crate::artifact_inspection::{hex_lower, mechanical_rejection, sha256_file, InspectionPolicy};
use crate::warehouse_maintenance::{submit_generate_vpm, GenerateVpmTaskSpec};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vua_bdl_store::bdl_store::{
    ArtifactInspectionState, ArtifactMode, ArtifactRecordingOutcome, BdlStore, BdlStoreError,
    CopyRole, NewLocalArtifact, WarehouseEntryDetail,
};
use vua_orchestrator::Clock;
use vua_unity_bridge::MaterialExecutor;

/// Entry kind for batch-imported folders. The full entry-kind vocabulary
/// (imported vs generated-VPM siblings) belongs to the artifact-mode slice.
pub const IMPORT_ENTRY_KIND: &str = "imported_material";

#[derive(Debug)]
pub enum ImportError {
    Store(BdlStoreError),
    Io(std::io::Error),
    /// The source path has no final component to name the entry after.
    UnnamedSource(PathBuf),
    /// Importing a folder that already lives inside the warehouse would
    /// nest entries into themselves.
    SourceInsideWarehouse(PathBuf),
    CopySizeMismatch {
        relative_path: String,
        expected: u64,
        actual: u64,
    },
    /// A migration group's name cannot become an entry folder.
    InvalidGroupName(String),
    /// A migration group's file path is outside its root or unsafe to store.
    InvalidGroupPath(String),
    Cancelled,
}

impl From<BdlStoreError> for ImportError {
    fn from(error: BdlStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<std::io::Error> for ImportError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Cancelled => write!(formatter, "import cancelled"),
            Self::Io(error) => write!(formatter, "warehouse import failed: {error}"),
            Self::UnnamedSource(path) => {
                write!(
                    formatter,
                    "source folder {} has no name for the entry",
                    path.display()
                )
            }
            Self::SourceInsideWarehouse(path) => write!(
                formatter,
                "source folder {} is inside the warehouse root",
                path.display()
            ),
            Self::CopySizeMismatch {
                relative_path,
                expected,
                actual,
            } => write!(
                formatter,
                "copied {relative_path} is {actual} bytes, source reported {expected}"
            ),
            Self::InvalidGroupName(name) => write!(formatter, "{name:?} cannot be an entry name"),
            Self::InvalidGroupPath(path) => {
                write!(formatter, "{path:?} is not a path inside its reviewed root")
            }
        }
    }
}

impl std::error::Error for ImportError {}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedArtifact {
    pub relative_path: String,
    pub artifact_sha256: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedSourceFile {
    pub relative_path: String,
    pub size_bytes: Option<u64>,
    pub reason: String,
}

/// Per-folder import outcome: the created entry plus an honest per-file
/// accounting (this report is the audit trail the acquisition/import task
/// result persists).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseImportReport {
    pub entry: WarehouseEntryDetail,
    pub imported: Vec<ImportedArtifact>,
    pub skipped: Vec<SkippedSourceFile>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub expansions: Vec<crate::zip_intake::ExpansionReport>,
}

pub struct WarehouseImporter<'a> {
    store: &'a BdlStore,
    clock: &'a dyn Clock,
    warehouse_root: PathBuf,
    policy: InspectionPolicy,
}

/// One named migration material (freeze row F4 / slice 46): the entry's name, the reviewed
/// root, and the explicit files under it as (path relative to the root, absolute source).
/// The relative paths are recorded exactly as given, so the material keeps the reviewed
/// layout; nothing outside the list is copied.
#[derive(Debug, Clone)]
pub struct MigrationGroupSource {
    pub name: String,
    pub root: PathBuf,
    pub files: Vec<(String, PathBuf)>,
}

/// Grouped migration bounds; the wire contract carries the same numbers.
pub const MIGRATION_GROUPS_LIMIT: usize = 200;
pub const MIGRATION_FILES_LIMIT: usize = 20_000;

fn is_windows_reserved_device_segment(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    })
}

/// A group's name becomes an entry folder name: no separators, reserved characters or edge
/// spaces, and not empty after trimming.
pub fn migration_group_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= 80
        && name.trim() == name
        && !name.chars().any(|c| {
            c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        })
        && !name.ends_with('.')
        && !is_windows_reserved_device_segment(name)
}

/// A recorded group path must stay inside its root and be representable in the warehouse.
pub fn migration_group_relative_valid(relative: &str) -> bool {
    !relative.is_empty()
        && relative.len() <= 512
        && !relative.starts_with('/')
        && !relative.contains('\\')
        && !relative.contains(':')
        && relative.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part.len() <= 255
                && !part.ends_with(['.', ' '])
                && !part
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
                && !is_windows_reserved_device_segment(part)
        })
}

impl<'a> WarehouseImporter<'a> {
    pub fn new(
        store: &'a BdlStore,
        clock: &'a dyn Clock,
        warehouse_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            store,
            clock,
            warehouse_root: warehouse_root.into(),
            policy: InspectionPolicy::default(),
        }
    }

    pub fn with_policy(
        store: &'a BdlStore,
        clock: &'a dyn Clock,
        warehouse_root: impl Into<PathBuf>,
        policy: InspectionPolicy,
    ) -> Self {
        Self {
            store,
            clock,
            warehouse_root: warehouse_root.into(),
            policy,
        }
    }

    /// Import one selected folder: create the entry, copy every mechanically
    /// acceptable file in at its relative path, inspect the copies, and
    /// record the physical copy rows. Originals stay untouched.
    pub fn import_folder(
        &self,
        source_folder: &Path,
    ) -> Result<WarehouseImportReport, ImportError> {
        self.import_folder_inner(source_folder, false, false, &|| false, &|_, _| {})
    }

    pub fn import_folder_all(
        &self,
        source_folder: &Path,
        cancelled: &dyn Fn() -> bool,
        progress: &dyn Fn(usize, u64),
    ) -> Result<WarehouseImportReport, ImportError> {
        self.import_folder_inner(source_folder, true, false, cancelled, progress)
    }

    /// A file makes one entry containing that file only; a folder keeps its tree.
    pub fn import_path_all(
        &self,
        source: &Path,
        cancelled: &dyn Fn() -> bool,
        progress: &dyn Fn(usize, u64),
    ) -> Result<WarehouseImportReport, ImportError> {
        self.import_folder_inner(source, true, true, cancelled, progress)
    }

    fn import_folder_inner(
        &self,
        source_folder: &Path,
        retain_all: bool,
        allow_file: bool,
        cancelled: &dyn Fn() -> bool,
        progress: &dyn Fn(usize, u64),
    ) -> Result<WarehouseImportReport, ImportError> {
        if cancelled() {
            return Err(ImportError::Cancelled);
        }
        let source_is_file = if allow_file {
            let metadata = std::fs::symlink_metadata(source_folder)?;
            if crate::zip_intake::is_reparse(&metadata)
                || (!metadata.is_file() && !metadata.is_dir())
            {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "intake requires an ordinary file or folder",
                )
                .into());
            }
            metadata.is_file()
        } else {
            false
        };
        let display_name = source_folder
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
            .ok_or_else(|| ImportError::UnnamedSource(source_folder.to_path_buf()))?;
        let canonical_source = std::fs::canonicalize(source_folder)?;
        std::fs::create_dir_all(&self.warehouse_root)?;
        let canonical_root = std::fs::canonicalize(&self.warehouse_root)?;
        if canonical_source.starts_with(&canonical_root)
            || (allow_file && !source_is_file && canonical_root.starts_with(&canonical_source))
        {
            return Err(ImportError::SourceInsideWarehouse(
                source_folder.to_path_buf(),
            ));
        }

        let mut sources = Vec::new();
        let mut skipped = Vec::new();
        if source_is_file {
            sources.push((display_name.clone(), source_folder.to_path_buf()));
        } else {
            collect_files(
                source_folder,
                source_folder,
                &mut sources,
                &mut skipped,
                cancelled,
            )?;
        }
        self.import_entry(
            &display_name,
            sources,
            skipped,
            retain_all,
            cancelled,
            progress,
        )
    }

    /// A migration group becomes one entry: the copy, verification, ZIP expansion and
    /// artifact recording are the folder import's own, driven by an explicit file list
    /// instead of a directory walk.
    pub fn import_migration_group(
        &self,
        group: &MigrationGroupSource,
        cancelled: &dyn Fn() -> bool,
        progress: &dyn Fn(usize, u64),
    ) -> Result<WarehouseImportReport, ImportError> {
        if cancelled() {
            return Err(ImportError::Cancelled);
        }
        if !migration_group_name_valid(&group.name) {
            return Err(ImportError::InvalidGroupName(group.name.clone()));
        }
        std::fs::create_dir_all(&self.warehouse_root)?;
        let canonical_root = std::fs::canonicalize(&self.warehouse_root)?;
        let mut sources = Vec::with_capacity(group.files.len());
        let mut seen_lower = std::collections::HashSet::with_capacity(group.files.len());
        for (relative, _) in &group.files {
            if !migration_group_relative_valid(relative)
                || !seen_lower.insert(relative.to_lowercase())
            {
                return Err(ImportError::InvalidGroupPath(relative.clone()));
            }
        }
        // Reject file-vs-parent-directory collisions inside the same group regardless of order.
        for (relative, _) in &group.files {
            let parts: Vec<_> = relative.split('/').collect();
            let mut prefix = String::new();
            for part in &parts[..parts.len() - 1] {
                if !prefix.is_empty() {
                    prefix.push('/');
                }
                prefix.push_str(part);
                if seen_lower.contains(&prefix.to_lowercase()) {
                    return Err(ImportError::InvalidGroupPath(relative.clone()));
                }
            }
        }
        for (relative, source) in &group.files {
            let metadata = std::fs::symlink_metadata(source)?;
            if crate::zip_intake::is_reparse(&metadata) || !metadata.is_file() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "migration source is not an ordinary file: {}",
                        source.to_string_lossy()
                    ),
                )
                .into());
            }
            let canonical = std::fs::canonicalize(source)?;
            if canonical.starts_with(&canonical_root) {
                return Err(ImportError::SourceInsideWarehouse(source.clone()));
            }
            // The warehouse records native separators; the reviewed document uses `/`.
            sources.push((
                relative.replace('/', std::path::MAIN_SEPARATOR_STR),
                canonical,
            ));
        }
        self.import_entry(&group.name, sources, Vec::new(), true, cancelled, progress)
    }

    fn import_entry(
        &self,
        display_name: &str,
        mut sources: Vec<(String, PathBuf)>,
        mut skipped: Vec<SkippedSourceFile>,
        retain_all: bool,
        cancelled: &dyn Fn() -> bool,
        progress: &dyn Fn(usize, u64),
    ) -> Result<WarehouseImportReport, ImportError> {
        let now = self.clock.now_rfc3339();
        std::fs::create_dir_all(&self.warehouse_root)?;
        let item = self
            .store
            .create_warehouse_item(display_name, IMPORT_ENTRY_KIND, &now)?;
        let entry_folder = self.warehouse_root.join(&item.folder_name);
        std::fs::create_dir_all(&entry_folder)?;
        sources.sort_by(|a, b| a.0.cmp(&b.0));

        let mut imported = Vec::new();
        let mut expansions = Vec::new();
        for (relative_path, source_path) in sources {
            if cancelled() {
                return Err(ImportError::Cancelled);
            }
            let size_bytes = std::fs::metadata(&source_path)?.len();
            let suggested_file_name = source_path
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string);
            if let Some(reason) = if retain_all {
                (size_bytes > self.policy.max_bytes).then(|| {
                    format!(
                        "size {size_bytes} exceeds the allowed maximum {}",
                        self.policy.max_bytes
                    )
                })
            } else {
                mechanical_rejection(
                    &self.policy,
                    suggested_file_name.as_deref(),
                    &source_path,
                    size_bytes,
                )
            } {
                skipped.push(SkippedSourceFile {
                    relative_path,
                    size_bytes: Some(size_bytes),
                    reason,
                });
                continue;
            }

            let destination = entry_folder.join(&relative_path);
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let identity = if retain_all {
                static IMPORT_SEQ: std::sync::atomic::AtomicU64 =
                    std::sync::atomic::AtomicU64::new(0);
                let mut input = std::fs::File::open(&source_path)?;
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                let seq = IMPORT_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let prepared = destination
                    .parent()
                    .expect("destination parent")
                    .join(format!(".vua-import-{stamp:x}-{seq:x}"));
                let result = (|| -> Result<String, ImportError> {
                    let mut output = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&prepared)?;
                    let mut hash = Sha256::new();
                    let mut buffer = vec![0; 1024 * 1024];
                    let mut copied = 0u64;
                    loop {
                        if cancelled() {
                            return Err(ImportError::Cancelled);
                        }
                        let count = input.read(&mut buffer)?;
                        if count == 0 {
                            break;
                        }
                        copied += count as u64;
                        if copied > size_bytes {
                            return Err(ImportError::CopySizeMismatch {
                                relative_path: relative_path.clone(),
                                expected: size_bytes,
                                actual: copied,
                            });
                        }
                        output.write_all(&buffer[..count])?;
                        hash.update(&buffer[..count]);
                        if copied / (16 * 1024 * 1024)
                            != (copied - count as u64) / (16 * 1024 * 1024)
                        {
                            progress(imported.len(), copied);
                        }
                    }
                    output.sync_all()?;
                    drop(output);
                    if copied != size_bytes {
                        return Err(ImportError::CopySizeMismatch {
                            relative_path: relative_path.clone(),
                            expected: size_bytes,
                            actual: copied,
                        });
                    }
                    std::fs::rename(&prepared, &destination)?;
                    Ok(format!("sha256:{}", hex_lower(&hash.finalize())))
                })();
                if result.is_err() {
                    let _ = std::fs::remove_file(&prepared);
                }
                result?
            } else {
                std::fs::copy(&source_path, &destination)?;
                format!("sha256:{}", hex_lower(&sha256_file(&destination)?))
            };
            let copied_size = std::fs::metadata(&destination)?.len();
            if copied_size != size_bytes {
                return Err(ImportError::CopySizeMismatch {
                    relative_path,
                    expected: size_bytes,
                    actual: copied_size,
                });
            }

            let recording = self.store.record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: identity.clone(),
                size_bytes,
                suggested_file_name: suggested_file_name.clone(),
                download_id: None,
                first_seen_at: now.clone(),
            })?;
            if recording.outcome == ArtifactRecordingOutcome::Created {
                self.store.transition_artifact(
                    &identity,
                    ArtifactInspectionState::Inspected,
                    &now,
                    None,
                )?;
            }
            let copy = self.store.record_artifact_copy(
                &item.warehouse_item_id,
                &identity,
                &relative_path,
                &destination.to_string_lossy(),
                CopyRole::Original,
                &now,
            )?;
            if retain_all && crate::zip_intake::is_zip(&relative_path) {
                expansions.push(crate::zip_intake::expand(
                    self.store,
                    &self.warehouse_root,
                    &copy,
                    &now,
                    cancelled,
                    progress,
                ));
            }
            imported.push(ImportedArtifact {
                relative_path,
                artifact_sha256: identity,
                size_bytes,
            });
            progress(imported.len(), size_bytes);
        }

        let entry = self
            .store
            .warehouse_entry_detail(
                &item.warehouse_item_id,
                ArtifactMode::UseOriginalUnitypackage,
            )?
            .expect("the entry was created in this import");
        Ok(WarehouseImportReport {
            entry,
            imported,
            skipped,
            expansions,
        })
    }
}

/// Depth-first collection of regular files as (relative path, full path).
fn collect_files(
    root: &Path,
    dir: &Path,
    out: &mut Vec<(String, PathBuf)>,
    skipped: &mut Vec<SkippedSourceFile>,
    cancelled: &dyn Fn() -> bool,
) -> Result<(), ImportError> {
    for entry in std::fs::read_dir(dir)? {
        if cancelled() {
            return Err(ImportError::Cancelled);
        }
        let entry = entry?;
        let path = entry.path();
        let meta = std::fs::symlink_metadata(&path)?;
        if crate::zip_intake::is_reparse(&meta) {
            skipped.push(SkippedSourceFile {
                relative_path: path
                    .strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .into_owned(),
                size_bytes: None,
                reason: "links/reparse points are not copied".into(),
            });
        } else if meta.is_dir() {
            collect_files(root, &path, out, skipped, cancelled)?;
        } else if meta.is_file() {
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            out.push((relative, path));
        }
    }
    Ok(())
}

// ============================ Task layer ============================
//
// The batch import as a TaskRuntime task type (v0.4.2 frozen runtime):
// nine states, revisioned events, commandId idempotency live in the
// runtime; this layer only binds the Kernel-resolved folders and the
// warehouse root into a one-shot closure and maps outcomes. Folder
// boundaries are the safe cancellation boundaries — a folder already
// imported stays imported (entries are durable in BDL), and the job checks
// the task cancel flag before starting each folder.

use std::time::Duration;
use vua_orchestrator::{ErrorCategory, ParamValue};
use vua_orchestrator::{SubmitRequest, TaskExit, TaskJob, TaskRuntime};

/// One batch-import task binding. All folders are Kernel-resolved; the
/// display-name rule (source folder's final component) and the entry
/// identity rule are the importer's.
#[derive(Debug, Clone)]
pub struct WarehouseImportTaskSpec {
    pub correlation_id: String,
    pub source_folders: Vec<PathBuf>,
    pub warehouse_root: PathBuf,
    /// Import-orchestrated auto-generation (proposal 010 path A): when
    /// `Some`, every successfully landed entry triggers an orchestrated
    /// generation task whenever the composed global default (persisted ??
    /// `env_initial`, read per landing) is `generate_vpm`. `None` = the
    /// manual import face: import only, no orchestration.
    pub auto_generate: Option<AutoGenerateSpec>,
}

/// The orchestration context injected by the provider when the wire caller
/// opted into import-time generation (proposal 010 path A): the composed
/// global fallback (the provider's environment-injected initial default)
/// and the Unity generation capability the orchestrated tasks run with.
#[derive(Clone)]
pub struct AutoGenerateSpec {
    pub env_initial: ArtifactMode,
    pub executor: Arc<MaterialExecutor>,
}

impl std::fmt::Debug for AutoGenerateSpec {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AutoGenerateSpec")
            .field("env_initial", &self.env_initial)
            .finish_non_exhaustive()
    }
}

/// Task-layer result payload (Done exit): per-folder reports in submission
/// order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseImportTaskResult {
    pub correlation_id: String,
    pub folders_requested: usize,
    pub folders_imported: usize,
    pub reports: Vec<WarehouseImportReport>,
}

/// One migration batch of named material groups. Groups are independent: a group that fails
/// is reported and the rest still import, so completed and unfinished work stay separable.
#[derive(Debug, Clone)]
pub struct MigrationImportTaskSpec {
    pub correlation_id: String,
    pub groups: Vec<MigrationGroupSource>,
    pub warehouse_root: PathBuf,
    pub auto_generate: Option<AutoGenerateSpec>,
}

/// A group that did not import, with the same typed code the single-folder face reports.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationGroupFailure {
    pub name: String,
    pub code: String,
    pub message: String,
}

/// Task-layer result payload for grouped intake (Done exit): landing entries and failures in
/// submission order. `groupsImported + failures.len() == groupsRequested` holds unless the
/// task was cancelled, which reports neither.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationImportTaskResult {
    pub correlation_id: String,
    pub groups_requested: usize,
    pub groups_imported: usize,
    pub reports: Vec<WarehouseImportReport>,
    pub failures: Vec<MigrationGroupFailure>,
}

fn migration_import_job(
    runtime: TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: MigrationImportTaskSpec,
) -> TaskJob {
    let auto_generate = spec.auto_generate.clone();
    Box::new(move |ctx| {
        let mut reports = Vec::new();
        let mut failures = Vec::new();
        for group in &spec.groups {
            if ctx.check_cancel() {
                ctx.emit_progress(serde_json::json!({
                    "kind": "warehouse.migration.cancelled",
                    "cancelledBeforeGroup": group.name,
                    "groupsImported": reports.len(),
                }));
                return Ok(TaskExit::Cancelled);
            }
            let importer = WarehouseImporter::new(&store, &*clock, spec.warehouse_root.clone());
            match importer.import_migration_group(group, &|| ctx.check_cancel(), &|files, bytes| {
                ctx.emit_progress(serde_json::json!({
                    "operation": "library.importGroups",
                    "group": group.name,
                    "files": files,
                    "bytes": bytes,
                }))
            }) {
                Ok(report) => {
                    if !report.skipped.is_empty()
                        || report.expansions.iter().any(|e| e.state != "expanded")
                    {
                        ctx.warn();
                    }
                    // The entry has landed: the import-orchestrated generation hook (proposal
                    // 010 path A) evaluates the composed default per landing, exactly as the
                    // folder faces do.
                    if let Some(auto) = &auto_generate {
                        if let Ok(composed) = store.global_default_mode() {
                            if composed.unwrap_or(auto.env_initial) == ArtifactMode::GenerateVpm {
                                let generation_correlation = format!(
                                    "{}-auto-{}",
                                    spec.correlation_id, report.entry.warehouse_item_id
                                );
                                if let Err(error) = submit_generate_vpm(
                                    &runtime,
                                    store.clone(),
                                    auto.executor.clone(),
                                    GenerateVpmTaskSpec {
                                        correlation_id: generation_correlation,
                                        warehouse_item_id: report.entry.warehouse_item_id.clone(),
                                        warehouse_root: spec.warehouse_root.clone(),
                                        global_default: composed.unwrap_or(auto.env_initial),
                                        import_correlation_id: Some(spec.correlation_id.clone()),
                                    },
                                    None,
                                ) {
                                    ctx.emit_progress(serde_json::json!({
                                        "kind": "warehouse.import.generationSubmitFailed",
                                        "warehouseItemId": report.entry.warehouse_item_id,
                                        "reason": error.code,
                                    }));
                                }
                            }
                        }
                    }
                    ctx.emit_progress(serde_json::json!({
                        "kind": "warehouse.migration.groupImported",
                        "group": group.name,
                        "entryId": report.entry.warehouse_item_id,
                        "groupsImported": reports.len() + 1,
                    }));
                    reports.push(report);
                }
                Err(error) => {
                    if matches!(error, ImportError::Cancelled) {
                        return Ok(TaskExit::Cancelled);
                    }
                    let message = error.to_string();
                    let app = import_error_to_app(error, &spec.correlation_id, &group.root);
                    failures.push(MigrationGroupFailure {
                        name: group.name.clone(),
                        code: app.code.clone(),
                        message,
                    });
                }
            }
        }
        let result = MigrationImportTaskResult {
            correlation_id: spec.correlation_id.clone(),
            groups_requested: spec.groups.len(),
            groups_imported: reports.len(),
            reports,
            failures,
        };
        let payload = serde_json::to_value(&result)
            .expect("task result serializes infallibly (plain data shapes only)");
        if ctx.check_cancel() {
            Ok(TaskExit::Cancelled)
        } else {
            Ok(TaskExit::Done(payload))
        }
    })
}

/// Grouped intake has its own idempotency namespace: a replayed command returns the same task,
/// and the fingerprint binds the group names and files it was submitted with.
pub fn submit_library_import_groups(
    runtime: TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: MigrationImportTaskSpec,
    command_id: &str,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    let fingerprint =
        serde_json::json!({"groups": spec.groups.iter().map(|group| serde_json::json!({
        "name": group.name,
        "root": group.root.to_string_lossy(),
        "files": group.files.iter().map(|(relative, _)| relative).collect::<Vec<_>>(),
    })).collect::<Vec<_>>(), "autoGenerate": spec.auto_generate.is_some()})
        .to_string();
    let correlation_id = spec.correlation_id.clone();
    let job = migration_import_job(runtime.clone(), store, clock, spec);
    runtime.submit_idempotent(
        SubmitRequest {
            correlation_id: Some(correlation_id),
            timeout: None,
            job,
        },
        "library.importGroups",
        command_id,
        &fingerprint,
    )
}

fn import_error_to_app(
    error: ImportError,
    correlation_id: &str,
    folder: &Path,
) -> vua_orchestrator::AppErrorV1 {
    let (code, category) = match &error {
        ImportError::Store(_) => ("vua.warehouse.storeFailed", ErrorCategory::Internal),
        ImportError::Io(_) => (
            "vua.warehouse.importIoFailed",
            ErrorCategory::ExternalFailure,
        ),
        ImportError::UnnamedSource(_)
        | ImportError::SourceInsideWarehouse(_)
        | ImportError::InvalidGroupName(_)
        | ImportError::InvalidGroupPath(_) => {
            ("vua.warehouse.invalidSource", ErrorCategory::Validation)
        }
        ImportError::CopySizeMismatch { .. } => (
            "vua.warehouse.copySizeMismatch",
            ErrorCategory::ExternalFailure,
        ),
        ImportError::Cancelled => (
            "vua.warehouse.importCancelled",
            ErrorCategory::ExternalFailure,
        ),
    };
    vua_orchestrator::AppErrorV1::new(
        code,
        category,
        "errors.warehouse.importFailed",
        correlation_id,
    )
    .with_param(
        "folder",
        ParamValue::Text(folder.to_string_lossy().into_owned()),
    )
    .with_param("reason", ParamValue::Text(error.to_string()))
    .with_recoverable(true)
}

/// Assemble the task closure: folders import in submission order with a
/// progress event after each; a cancel request stops the batch at the next
/// folder boundary (Cancelled exit, no payload — the durable partial state
/// is queryable through `warehouse.listEntries`).
pub fn warehouse_import_job(
    runtime: TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseImportTaskSpec,
    auto_generate: Option<AutoGenerateSpec>,
) -> TaskJob {
    import_job(runtime, store, clock, spec, auto_generate, false, false)
}

fn import_job(
    runtime: TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseImportTaskSpec,
    auto_generate: Option<AutoGenerateSpec>,
    retain_all: bool,
    allow_files: bool,
) -> TaskJob {
    Box::new(move |ctx| {
        let mut reports = Vec::new();
        for folder in &spec.source_folders {
            if ctx.check_cancel() {
                ctx.emit_progress(serde_json::json!({
                    "kind": "warehouse.import.cancelled",
                    "cancelledBeforeFolder": folder.to_string_lossy(),
                    "foldersImported": reports.len(),
                }));
                return Ok(TaskExit::Cancelled);
            }
            let importer = WarehouseImporter::new(&store, &*clock, spec.warehouse_root.clone());
            let result = if allow_files {
                importer.import_path_all(folder, &|| ctx.check_cancel(), &|files, bytes| ctx.emit_progress(serde_json::json!({"operation":"library.importPaths","files":files,"bytes":bytes})))
            } else if retain_all {
                importer.import_folder_all(folder, &|| ctx.check_cancel(), &|files, bytes| ctx.emit_progress(serde_json::json!({"operation":"library.importFolders","files":files,"bytes":bytes})))
            } else {
                importer.import_folder(folder)
            };
            match result {
                Ok(report) => {
                    if !report.skipped.is_empty()
                        || report.expansions.iter().any(|e| e.state != "expanded")
                    {
                        ctx.warn();
                    }
                    // The hook (proposal 010 path A): the entry has just
                    // landed — this is the landing instant. The composed
                    // global default is evaluated here, per landing.
                    if let Some(auto) = &auto_generate {
                        let composed = match store.global_default_mode() {
                            Ok(persisted) => persisted.unwrap_or(auto.env_initial),
                            Err(error) => {
                                // Commitment 1: an orchestration-side failure
                                // never fails the import — typed note, manual
                                // submission remains available.
                                ctx.emit_progress(serde_json::json!({
                                    "kind": "warehouse.import.generationSubmitFailed",
                                    "warehouseItemId": report.entry.warehouse_item_id,
                                    "reason": error.to_string(),
                                }));
                                reports.push(report);
                                continue;
                            }
                        };
                        if composed == ArtifactMode::GenerateVpm {
                            // A deterministic, unique-per-entry correlation
                            // derived from the import: the audit chain stays
                            // traceable and a replayed import never collides.
                            let generation_correlation = format!(
                                "{}-auto-{}",
                                spec.correlation_id, report.entry.warehouse_item_id
                            );
                            let submitted = submit_generate_vpm(
                                &runtime,
                                store.clone(),
                                auto.executor.clone(),
                                GenerateVpmTaskSpec {
                                    correlation_id: generation_correlation,
                                    warehouse_item_id: report.entry.warehouse_item_id.clone(),
                                    warehouse_root: spec.warehouse_root.clone(),
                                    global_default: composed,
                                    import_correlation_id: Some(spec.correlation_id.clone()),
                                },
                                None,
                            );
                            if let Err(error) = submitted {
                                // Commitment 1: the generation submission
                                // failing never fails the import — a typed
                                // note rides the progress stream, retriable
                                // by manual submission.
                                ctx.emit_progress(serde_json::json!({
                                    "kind": "warehouse.import.generationSubmitFailed",
                                    "warehouseItemId": report.entry.warehouse_item_id,
                                    "reason": error.code,
                                }));
                            } else {
                                ctx.emit_progress(serde_json::json!({
                                    "kind": "warehouse.import.generationSubmitted",
                                    "warehouseItemId": report.entry.warehouse_item_id,
                                    "importCorrelationId": spec.correlation_id,
                                }));
                            }
                        }
                    }
                    ctx.emit_progress(serde_json::json!({
                        "kind": "warehouse.import.folderImported",
                        "folder": folder.to_string_lossy(),
                        "entryId": report.entry.warehouse_item_id,
                        "foldersImported": reports.len() + 1,
                    }));
                    reports.push(report);
                }
                Err(error) => {
                    if matches!(error, ImportError::Cancelled) {
                        return Ok(TaskExit::Cancelled);
                    }
                    return Err(import_error_to_app(error, &spec.correlation_id, folder));
                }
            }
        }
        let result = WarehouseImportTaskResult {
            correlation_id: spec.correlation_id.clone(),
            folders_requested: spec.source_folders.len(),
            folders_imported: reports.len(),
            reports,
        };
        // Invariant (BG-12): WarehouseImportTaskResult contains only plain
        // data shapes — serde cannot fail on it; a serialization error
        // would be an invariant break, surfaced as a panic instead of a
        // silently null Done payload presented as success.
        let payload = serde_json::to_value(&result)
            .expect("task result serializes infallibly (plain data shapes only)");
        if ctx.check_cancel() {
            Ok(TaskExit::Cancelled)
        } else {
            Ok(TaskExit::Done(payload))
        }
    })
}

/// Successor intake: all ordinary files plus ZIP expansion. The old frozen
/// warehouse command keeps its format filter and submission behavior.
pub fn submit_library_import(
    runtime: TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseImportTaskSpec,
    auto_generate: Option<AutoGenerateSpec>,
    command_id: &str,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    let fingerprint = serde_json::json!({"sourceFolders":spec.source_folders,"autoGenerate":auto_generate.is_some()}).to_string();
    let correlation_id = spec.correlation_id.clone();
    let job = import_job(
        runtime.clone(),
        store,
        clock,
        spec,
        auto_generate,
        true,
        false,
    );
    runtime.submit_idempotent(
        SubmitRequest {
            correlation_id: Some(correlation_id),
            timeout: None,
            job,
        },
        "library.importFolders",
        command_id,
        &fingerprint,
    )
}

/// Mixed v0.2 intake has a separate idempotency namespace from folder-only v0.1.
pub fn submit_library_import_paths(
    runtime: TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseImportTaskSpec,
    auto_generate: Option<AutoGenerateSpec>,
    command_id: &str,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    let fingerprint = serde_json::json!({"sourcePaths":spec.source_folders,"autoGenerate":auto_generate.is_some()}).to_string();
    let correlation_id = spec.correlation_id.clone();
    let job = import_job(
        runtime.clone(),
        store,
        clock,
        spec,
        auto_generate,
        true,
        true,
    );
    runtime.submit_idempotent(
        SubmitRequest {
            correlation_id: Some(correlation_id),
            timeout: None,
            job,
        },
        "library.importPaths",
        command_id,
        &fingerprint,
    )
}

/// Convenience submission: the correlation id binds the whole batch.
/// Manual-import face — no orchestration (auto_generate is None).
pub fn submit_warehouse_import(
    runtime: &TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseImportTaskSpec,
    timeout: Option<Duration>,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    submit_warehouse_import_auto(runtime.clone(), store, clock, spec, None, timeout)
}

/// Submission with the import-orchestrated auto-generation context. The
/// runtime is taken by value (cheap clone) so the job closure is self
/// sufficient: the generation hook submits into the same runtime at the
/// entry-landing instant (proposal 010 path A).
pub fn submit_warehouse_import_auto(
    runtime: TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseImportTaskSpec,
    auto_generate: Option<AutoGenerateSpec>,
    timeout: Option<Duration>,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    let correlation_id = spec.correlation_id.clone();
    let job = warehouse_import_job(runtime.clone(), store, clock, spec, auto_generate);
    runtime.submit(SubmitRequest {
        correlation_id: Some(correlation_id),
        timeout,
        job,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::unique_dir;
    use vua_bdl_store::bdl_queries::ArtifactInspectionVerdict;
    use vua_orchestrator::FixedClock;

    #[test]
    fn library_intake_keeps_ordinary_files_and_expands_zip_without_changing_sources() {
        let store = BdlStore::open_in_memory().unwrap();
        let root = unique_dir("vua-import-all", "warehouse");
        let source = unique_dir("vua-import-all", "source");
        for name in [
            "texture.psd",
            "preview.png",
            "guide.jpg",
            "model.fbx",
            "README",
            "unknown.dat",
        ] {
            std::fs::write(source.join(name), name.as_bytes()).unwrap();
        }
        let archive_path = source.join("package.zip");
        let mut archive = zip::ZipWriter::new(std::fs::File::create(&archive_path).unwrap());
        archive
            .start_file(
                "avatar/sub/Avatar.unitypackage",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        archive.write_all(b"synthetic package bytes").unwrap();
        archive
            .start_file("avatar/notes.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"notes").unwrap();
        archive.finish().unwrap();
        let original = std::fs::read(&archive_path).unwrap();
        let clock = FixedClock::new(&["2026-10-09T09:00:00.000Z"]);
        let report = WarehouseImporter::new(&store, &clock, &root)
            .import_folder_all(&source, &|| false, &|_, _| {})
            .unwrap();
        assert_eq!(report.imported.len(), 7);
        assert!(report.skipped.is_empty());
        assert_eq!(report.expansions[0].state, "expanded");
        assert_eq!(report.expansions[0].unitypackage_candidates, 1);
        assert_eq!(store.library_copy_evidence().unwrap().len(), 9);
        assert_eq!(std::fs::read(archive_path).unwrap(), original);
        assert!(store.library_copy_evidence().unwrap().iter().any(|c| c
            .copy
            .relative_path
            .ends_with("avatar/sub/Avatar.unitypackage")));
    }

    #[test]
    fn a_migration_group_becomes_one_entry_with_the_reviewed_layout() {
        let store = BdlStore::open_in_memory().unwrap();
        let warehouse_root = unique_dir("vua-migration", "wh");
        let clock = FixedClock::new(&["2026-10-30T09:00:00.000Z"]);
        let importer = WarehouseImporter::new(&store, &clock, &warehouse_root);
        let root = unique_dir("vua-migration", "collection");
        std::fs::create_dir_all(root.join("Outfit").join("Textures")).unwrap();
        std::fs::create_dir_all(root.join("Shared")).unwrap();
        std::fs::write(
            root.join("Outfit").join("Outfit.unitypackage"),
            b"PK outfit",
        )
        .unwrap();
        std::fs::write(
            root.join("Outfit").join("Textures").join("body.png"),
            b"png",
        )
        .unwrap();
        std::fs::write(root.join("Shared").join("README.txt"), b"readme").unwrap();
        // A loose sibling file joins the group: the reviewed selection, not a folder walk.
        std::fs::write(root.join("LICENSE.txt"), b"license").unwrap();
        let group = MigrationGroupSource {
            name: "Meiyun coat".into(),
            root: root.clone(),
            files: vec![
                (
                    "Outfit/Outfit.unitypackage".into(),
                    root.join("Outfit").join("Outfit.unitypackage"),
                ),
                (
                    "Outfit/Textures/body.png".into(),
                    root.join("Outfit").join("Textures").join("body.png"),
                ),
                ("LICENSE.txt".into(), root.join("LICENSE.txt")),
            ],
        };
        let report = importer
            .import_migration_group(&group, &|| false, &|_, _| {})
            .unwrap();
        assert_eq!(report.entry.display_name, "Meiyun coat");
        assert_eq!(report.entry.kind, "imported_material");
        let mut imported = report
            .imported
            .iter()
            .map(|file| file.relative_path.replace('\\', "/"))
            .collect::<Vec<_>>();
        imported.sort();
        assert_eq!(
            imported,
            vec![
                "LICENSE.txt",
                "Outfit/Outfit.unitypackage",
                "Outfit/Textures/body.png"
            ]
        );
        assert!(report
            .imported
            .iter()
            .all(|file| file.artifact_sha256.starts_with("sha256:")));
        // The files outside the reviewed selection stay out, and every original is unchanged.
        assert!(!report
            .imported
            .iter()
            .any(|file| file.relative_path.contains("README")));
        assert_eq!(
            std::fs::read(root.join("Shared").join("README.txt")).unwrap(),
            b"readme"
        );
        assert_eq!(std::fs::read(root.join("LICENSE.txt")).unwrap(), b"license");
    }

    #[test]
    fn a_migration_group_refuses_unsafe_names_paths_and_links() {
        let store = BdlStore::open_in_memory().unwrap();
        let warehouse_root = unique_dir("vua-migration-refuse", "wh");
        let clock = FixedClock::new(&["2026-10-30T09:00:00.000Z"]);
        let importer = WarehouseImporter::new(&store, &clock, &warehouse_root);
        let root = unique_dir("vua-migration-refuse", "collection");
        std::fs::write(root.join("a.unitypackage"), b"a").unwrap();
        let file = root.join("a.unitypackage");
        let refuse = |name: &str, relative: &str| {
            let group = MigrationGroupSource {
                name: name.into(),
                root: root.clone(),
                files: vec![(relative.into(), file.clone())],
            };
            importer
                .import_migration_group(&group, &|| false, &|_, _| {})
                .unwrap_err()
        };
        assert!(matches!(
            refuse("bad/name", "a.unitypackage"),
            ImportError::InvalidGroupName(_)
        ));
        assert!(matches!(
            refuse("Coat.", "a.unitypackage"),
            ImportError::InvalidGroupName(_)
        ));
        assert!(matches!(
            refuse("Coat", "../escape.unitypackage"),
            ImportError::InvalidGroupPath(_)
        ));
        assert!(matches!(
            refuse("Coat", "C:/absolute.unitypackage"),
            ImportError::InvalidGroupPath(_)
        ));
        // A file inside the warehouse would copy the destination into itself.
        let inside = warehouse_root.join("already-there.txt");
        std::fs::create_dir_all(&warehouse_root).unwrap();
        std::fs::write(&inside, b"x").unwrap();
        let group = MigrationGroupSource {
            name: "Coat".into(),
            root: root.clone(),
            files: vec![("already.txt".into(), inside)],
        };
        assert!(matches!(
            importer
                .import_migration_group(&group, &|| false, &|_, _| {})
                .unwrap_err(),
            ImportError::SourceInsideWarehouse(_)
        ));
        // A missing source fails before an entry claims to hold it.
        let group = MigrationGroupSource {
            name: "Coat".into(),
            root: root.clone(),
            files: vec![("gone.unitypackage".into(), root.join("gone.unitypackage"))],
        };
        assert!(importer
            .import_migration_group(&group, &|| false, &|_, _| {})
            .is_err());
    }

    #[test]
    fn import_copies_a_folder_into_an_entry_without_touching_originals() {
        let store = BdlStore::open_in_memory().unwrap();
        let warehouse_root = unique_dir("vua-import", "wh");
        let clock = FixedClock::new(&["2026-09-06T09:00:00.000Z"]);
        let importer = WarehouseImporter::new(&store, &clock, &warehouse_root);
        let parent = unique_dir("vua-import", "parent");
        let source = parent.join("src");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("material-pack.unitypackage"),
            b"PK unity fixture",
        )
        .unwrap();
        std::fs::create_dir_all(source.join("extras")).unwrap();
        std::fs::write(source.join("extras").join("extra.zip"), b"PK zip fixture").unwrap();

        let report = importer.import_folder(&source).unwrap();
        assert_eq!(report.entry.display_name, "src");
        assert_eq!(report.entry.kind, "imported_material");
        assert_eq!(report.imported.len(), 2);
        assert!(report.skipped.is_empty());
        assert_eq!(report.entry.artifacts.len(), 2);
        assert!(report
            .imported
            .iter()
            .all(|file| file.artifact_sha256.starts_with("sha256:")));

        // Originals are untouched.
        assert_eq!(
            std::fs::read(source.join("material-pack.unitypackage")).unwrap(),
            b"PK unity fixture"
        );
        // The entry folder holds the copies at their relative paths.
        let entry_folder = warehouse_root.join(&report.entry.folder_name);
        assert!(entry_folder.join("material-pack.unitypackage").is_file());
        assert!(entry_folder.join("extras").join("extra.zip").is_file());

        // The read face reflects mechanical inspection (inspected → pending).
        for artifact in &report.entry.artifacts {
            assert_eq!(artifact.state, ArtifactInspectionVerdict::Pending);
            assert!(!artifact.source_correlated);
        }
        std::fs::remove_dir_all(&warehouse_root).ok();
        std::fs::remove_dir_all(&parent).ok();
    }

    #[test]
    fn mechanical_skips_are_reported_and_never_copied() {
        let store = BdlStore::open_in_memory().unwrap();
        let warehouse_root = unique_dir("vua-import", "wh");
        let policy = InspectionPolicy {
            max_bytes: 4,
            ..InspectionPolicy::default()
        };
        let clock = FixedClock::new(&["2026-09-06T09:00:00.000Z"]);
        let importer = WarehouseImporter::with_policy(&store, &clock, &warehouse_root, policy);
        let source = unique_dir("vua-import", "src");
        std::fs::write(source.join("README"), b"doc").unwrap();
        std::fs::write(source.join("big.zip"), b"0123456789").unwrap();
        std::fs::write(source.join("setup.exe"), b"tiny").unwrap();
        std::fs::write(source.join("pack.unitypackage"), b"ok").unwrap();

        let report = importer.import_folder(&source).unwrap();
        assert_eq!(report.imported.len(), 1);
        assert_eq!(report.skipped.len(), 3);
        assert!(report
            .skipped
            .iter()
            .any(|file| file.relative_path == "README"
                && file.reason == "file name carries no extension to allow-list"));
        assert!(report
            .skipped
            .iter()
            .any(|file| file.reason.starts_with("size 10 exceeds")));
        assert!(report
            .skipped
            .iter()
            .any(|file| file.reason == "extension \".exe\" is not in the allowed list"));

        let entry_folder = warehouse_root.join(&report.entry.folder_name);
        let leftover: Vec<_> = std::fs::read_dir(&entry_folder)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(
            leftover.len(),
            1,
            "only the acceptable artifact is copied into the entry"
        );
        std::fs::remove_dir_all(&warehouse_root).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn re_importing_content_duplicates_entries_never_inspection_facts() {
        let store = BdlStore::open_in_memory().unwrap();
        let warehouse_root = unique_dir("vua-import", "wh");
        let clock = FixedClock::new(&["2026-09-06T09:00:00.000Z"]);
        let importer = WarehouseImporter::new(&store, &clock, &warehouse_root);
        let source = unique_dir("vua-import", "src");
        std::fs::write(source.join("pack.unitypackage"), b"PK identical content").unwrap();

        let first = importer.import_folder(&source).unwrap();
        let second = importer.import_folder(&source).unwrap();
        assert_ne!(
            first.entry.warehouse_item_id, second.entry.warehouse_item_id,
            "no deduplication: the user wanted two copies"
        );
        assert_eq!(
            first.imported[0].artifact_sha256, second.imported[0].artifact_sha256,
            "inspection facts stay idempotent per content"
        );
        assert_eq!(
            store
                .artifact(&first.imported[0].artifact_sha256)
                .unwrap()
                .unwrap()
                .download_id,
            None
        );
        let cards = store
            .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
            .unwrap();
        assert_eq!(cards.len(), 2);
        std::fs::remove_dir_all(&warehouse_root).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn an_empty_folder_still_becomes_an_honest_empty_entry() {
        let store = BdlStore::open_in_memory().unwrap();
        let warehouse_root = unique_dir("vua-import", "wh");
        let clock = FixedClock::new(&["2026-09-06T09:00:00.000Z"]);
        let importer = WarehouseImporter::new(&store, &clock, &warehouse_root);
        let source = unique_dir("vua-import", "empty-src");

        let report = importer.import_folder(&source).unwrap();
        assert!(report.imported.is_empty());
        assert!(report.entry.artifacts.is_empty());
        let cards = store
            .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
            .unwrap();
        assert_eq!(cards.len(), 1);
        std::fs::remove_dir_all(&warehouse_root).ok();
        std::fs::remove_dir_all(&source).ok();
    }

    #[test]
    fn a_source_inside_the_warehouse_is_refused() {
        let store = BdlStore::open_in_memory().unwrap();
        let warehouse_root = unique_dir("vua-import", "wh");
        let clock = FixedClock::new(&["2026-09-06T09:00:00.000Z"]);
        let importer = WarehouseImporter::new(&store, &clock, &warehouse_root);
        let nested = warehouse_root.join("whi-nested-source");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("pack.unitypackage"), b"PK").unwrap();

        assert!(matches!(
            importer.import_folder(&nested),
            Err(ImportError::SourceInsideWarehouse(_))
        ));
        std::fs::remove_dir_all(&warehouse_root).ok();
    }

    // ============================ task layer ============================

    mod task {
        use super::*;
        use std::time::{Duration, Instant};
        use vua_orchestrator::TaskRuntime;
        use vua_orchestrator::{AppErrorV1, TaskState};
        use vua_orchestrator::{FixedIdGenerator, SystemClock};

        fn runtime() -> TaskRuntime {
            TaskRuntime::new(
                Arc::new(vua_orchestrator::MemoryJournal::default()),
                Arc::new(SystemClock),
                Arc::new(FixedIdGenerator::default()),
            )
        }

        fn wait_for_terminal(rt: &TaskRuntime, task_id: &str) -> vua_orchestrator::TaskSnapshot {
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

        fn make_folder(parent: &Path, name: &str, contents: &[u8]) -> PathBuf {
            let folder = parent.join(name);
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(folder.join("pack.unitypackage"), contents).unwrap();
            folder
        }

        #[test]
        fn import_task_runs_folders_in_order_and_reports_each() {
            let store = Arc::new(BdlStore::open_in_memory().unwrap());
            let warehouse_root = unique_dir("vua-import", "wh");
            let clock: Arc<dyn Clock> = Arc::new(FixedClock::new(&["2026-09-06T09:00:00.000Z"]));
            let parent = unique_dir("vua-import", "parent");
            let folders = vec![
                make_folder(&parent, "alpha", b"PK alpha"),
                make_folder(&parent, "beta", b"PK beta"),
            ];
            let rt = runtime();
            let events = rt.subscribe();
            let accepted = submit_warehouse_import(
                &rt,
                store.clone(),
                clock,
                WarehouseImportTaskSpec {
                    correlation_id: "corr-import-1".into(),
                    source_folders: folders,
                    warehouse_root: warehouse_root.clone(),
                    auto_generate: None,
                },
                None,
            )
            .unwrap();

            let snapshot = wait_for_terminal(&rt, &accepted.task_id);
            assert_eq!(snapshot.state, TaskState::Succeeded);
            let mut completed_payload = None;
            while let Ok(event) = events.try_recv() {
                if event.kind == vua_orchestrator::TaskEventKind::Completed {
                    completed_payload = Some(event.payload);
                }
            }
            let payload = completed_payload.expect("a completed event with the batch result");
            assert_eq!(payload["foldersRequested"], 2);
            assert_eq!(payload["foldersImported"], 2);
            assert_eq!(payload["reports"][0]["entry"]["displayName"], "alpha");
            assert_eq!(payload["reports"][1]["entry"]["displayName"], "beta");
            // The durable read face shows both entries.
            assert_eq!(
                store
                    .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
                    .unwrap()
                    .len(),
                2
            );
            std::fs::remove_dir_all(&warehouse_root).ok();
            std::fs::remove_dir_all(&parent).ok();
        }

        #[test]
        fn import_task_fails_fast_and_keeps_already_imported_entries() {
            let store = Arc::new(BdlStore::open_in_memory().unwrap());
            let warehouse_root = unique_dir("vua-import", "wh");
            let clock: Arc<dyn Clock> = Arc::new(FixedClock::new(&["2026-09-06T09:00:00.000Z"]));
            let parent = unique_dir("vua-import", "parent");
            let good = make_folder(&parent, "good", b"PK good");
            // The second folder lives inside the warehouse root: invalid.
            let nested = warehouse_root.join("nested-source");
            std::fs::create_dir_all(&nested).unwrap();
            std::fs::write(nested.join("pack.unitypackage"), b"PK").unwrap();
            let rt = runtime();
            let accepted = submit_warehouse_import(
                &rt,
                store.clone(),
                clock,
                WarehouseImportTaskSpec {
                    correlation_id: "corr-import-2".into(),
                    source_folders: vec![good, nested],
                    warehouse_root: warehouse_root.clone(),
                    auto_generate: None,
                },
                None,
            )
            .unwrap();

            let snapshot = wait_for_terminal(&rt, &accepted.task_id);
            assert_eq!(snapshot.state, TaskState::Failed);
            // Fail-fast keeps the durable partial state queryable.
            let cards = store
                .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
                .unwrap();
            assert_eq!(cards.len(), 1);
            assert_eq!(cards[0].display_name, "good");
            std::fs::remove_dir_all(&warehouse_root).ok();
            std::fs::remove_dir_all(&parent).ok();
        }

        #[test]
        fn cancellation_takes_effect_at_folder_boundaries() {
            let store = Arc::new(BdlStore::open_in_memory().unwrap());
            let warehouse_root = unique_dir("vua-import", "wh");
            let clock: Arc<dyn Clock> = Arc::new(FixedClock::new(&["2026-09-06T09:00:00.000Z"]));
            let parent = unique_dir("vua-import", "parent");
            let folders: Vec<PathBuf> = (0..40)
                .map(|index| make_folder(&parent, &format!("f{index:03}"), b"PK"))
                .collect();
            let rt = runtime();
            let events = rt.subscribe();
            let accepted = submit_warehouse_import(
                &rt,
                store.clone(),
                clock,
                WarehouseImportTaskSpec {
                    correlation_id: "corr-import-3".into(),
                    source_folders: folders,
                    warehouse_root: warehouse_root.clone(),
                    auto_generate: None,
                },
                None,
            )
            .unwrap();

            // Cancel as soon as the first folder's progress is observable;
            // the job stops at the next folder boundary.
            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                if let Ok(event) = events.try_recv() {
                    if event.payload["kind"] == "warehouse.import.folderImported" {
                        rt.cancel(&accepted.task_id).unwrap();
                        break;
                    }
                }
                assert!(Instant::now() < deadline, "no folder progress observed");
                std::thread::sleep(Duration::from_millis(1));
            }
            let snapshot = wait_for_terminal(&rt, &accepted.task_id);
            assert_eq!(snapshot.state, TaskState::Cancelled);
            let imported = store
                .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
                .unwrap()
                .len();
            assert!(
                imported < 40,
                "cancellation must stop the batch at a folder boundary (imported {imported})"
            );
            assert!(imported >= 1, "the in-flight folder completed");
            std::fs::remove_dir_all(&warehouse_root).ok();
            std::fs::remove_dir_all(&parent).ok();
        }

        #[test]
        fn error_shape_carries_folder_and_reason_params() {
            let error = import_error_to_app(
                ImportError::SourceInsideWarehouse(PathBuf::from("C:\\wh\\nested")),
                "corr-x",
                Path::new("C:\\wh\\nested"),
            );
            let AppErrorV1 { code, params, .. } = error;
            assert_eq!(code, "vua.warehouse.invalidSource");
            assert_eq!(
                params.as_ref().unwrap()["folder"],
                ParamValue::Text("C:\\wh\\nested".into())
            );
        }
    }
}

//! Warehouse download adoption — the M6 download-adoption task (IMP-3,
//! proposal path: user ruling U7-③, `warehouse.importDownloads`, bdl-commands
//! v0.4). One command = one adoption task over completed downloads recorded
//! in BDL's own download-event log: per download the task resolves the
//! staging path, reported size and suggested file name from the persisted
//! event fold (`DownloadEventConsumer::staging_completion`) — the request
//! carries identities only, never paths or client assertions about the
//! download (the v0.3 guard rule: guards are server-side facts).
//!
//! Adoption is copy-in: the staging file is copied into a
//! `downloaded_material` entry (the kind the frozen BDL v0.1 vocabulary
//! reserves) and left untouched — staging cleanup is not this command's
//! semantics. Content identity is AMF-computed (SHA-256 over the copy, the
//! same pipeline as the batch import); the transport correlation closes via
//! `local_artifacts.download_id`. The content→product source mapping
//! (`artifact_mappings`, boundary IN-4) stays an AMF source-resolution
//! decision and is deliberately not part of this command: a request that
//! asserted a product would be a client assertion over an AMF fact.
//!
//! Fail-fast per task: the first un-adoptable download fails the task with a
//! stable error code; entries already landed stay durable in BDL and are
//! queryable through the warehouse read face. Cancellation is observed at
//! download boundaries. Auto-generation orchestration (proposal 010 pattern)
//! is deliberately absent: whether a download adoption triggers the same
//! import-time hook is undecided and is NOT frozen by v0.4.

use crate::artifact_inspection::{hex_lower, sha256_file};
use vua_bdl_store::download_events::DownloadEventConsumer;
use vua_bdl_store::bdl_store::{
    ArtifactInspectionState, ArtifactMode, ArtifactRecordingOutcome, BdlStore, BdlStoreError,
    CopyRole, NewLocalArtifact, WarehouseEntryDetail,
};
use vua_orchestrator::Clock;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Entry kind for adopted downloads — the frozen BDL v0.1 vocabulary
/// (`warehouse_items.kind`) already reserves this value.
pub const DOWNLOADED_ENTRY_KIND: &str = "downloaded_material";

#[derive(Debug)]
pub enum DownloadAdoptError {
    Store(BdlStoreError),
    Io(std::io::Error),
    /// The download id has no event history in BDL at all.
    DownloadNotFound(String),
    /// The BDL event fold is not a completed delivery (still in flight,
    /// interrupted, cancelled or failed).
    DownloadNotCompleted { download_id: String, phase: String },
    /// The completed delivery's staging file is physically absent (already
    /// cleaned up or moved outside AMF).
    StagingFileMissing { download_id: String, stored_path: String },
    /// The staging file's size disagrees with the completed delivery's own
    /// receipt, or the copy disagrees with the staging file.
    CopySizeMismatch {
        download_id: String,
        expected: u64,
        actual: u64,
    },
    /// The persisted download-event history failed to fold. Histories are
    /// ingest-gated, so this means stored corruption, never a live port
    /// misbehaviour — surfaced, never silently skipped.
    EventFold(String),
}

impl From<BdlStoreError> for DownloadAdoptError {
    fn from(error: BdlStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<vua_bdl_store::download_events::ConsumerError> for DownloadAdoptError {
    fn from(error: vua_bdl_store::download_events::ConsumerError) -> Self {
        match error {
            vua_bdl_store::download_events::ConsumerError::Store(store_error) => {
                Self::Store(store_error)
            }
            other => Self::EventFold(other.to_string()),
        }
    }
}

impl From<std::io::Error> for DownloadAdoptError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for DownloadAdoptError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Io(error) => write!(formatter, "download adoption failed: {error}"),
            Self::DownloadNotFound(download_id) => {
                write!(formatter, "download {download_id} has no event history in BDL")
            }
            Self::DownloadNotCompleted { download_id, phase } => write!(
                formatter,
                "download {download_id} is not a completed delivery (phase {phase})"
            ),
            Self::StagingFileMissing { download_id, stored_path } => write!(
                formatter,
                "download {download_id}: staging file {stored_path} is gone"
            ),
            Self::CopySizeMismatch { download_id, expected, actual } => write!(
                formatter,
                "download {download_id}: file is {actual} bytes, the completed delivery reported {expected}"
            ),
            Self::EventFold(reason) => {
                write!(formatter, "download event history failed to fold: {reason}")
            }
        }
    }
}

impl DownloadAdoptError {
    /// The download lifecycle phase as an honest string for the error
    /// payload (the phase names are internal, the string is the audit).
    fn phase_name(phase: &vua_bdl_store::download_events::DownloadPhase) -> String {
        use vua_bdl_store::download_events::DownloadPhase::*;
        match phase {
            Queued => "queued".into(),
            Downloading => "downloading".into(),
            Interrupted => "interrupted".into(),
            TransferDone => "transfer_done".into(),
            Cancelled => "cancelled".into(),
            Failed => "failed".into(),
        }
    }
}

/// One adopted download: the created entry plus the copied file's content
/// identity and size (this report rides the task's Done payload).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptedDownload {
    pub download_id: String,
    pub entry: WarehouseEntryDetail,
    pub file_name: String,
    pub artifact_sha256: String,
    pub size_bytes: u64,
}

/// Per-task result payload (Done exit): per-download reports in submission
/// order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseDownloadAdoptTaskResult {
    pub correlation_id: String,
    pub downloads_requested: usize,
    pub downloads_adopted: usize,
    pub adopted: Vec<AdoptedDownload>,
}

/// The on-disk file name for an adopted copy: the FINAL path component of
/// the delivery's name facts. `suggested_file_name` is server-controlled
/// Content-Disposition content riding the port event; joining it verbatim
/// would let an absolute or `..`-bearing name escape the entry folder (the
/// #43 path-shape family: externally controllable names never ride into a
/// path join unguarded). The port itself takes only the final component
/// when reserving staging names — the same discipline applies at adoption.
fn adoptable_file_component(name: &str) -> Option<String> {
    let normalized = name.replace('\\', "/");
    let component = normalized.rsplit('/').next()?.trim();
    let usable = !component.is_empty() && component != "." && component != "..";
    usable.then(|| component.to_string())
}

pub struct DownloadAdopter<'a> {
    store: &'a BdlStore,
    clock: &'a dyn Clock,
    warehouse_root: PathBuf,
}

impl<'a> DownloadAdopter<'a> {
    pub fn new(
        store: &'a BdlStore,
        clock: &'a dyn Clock,
        warehouse_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            store,
            clock,
            warehouse_root: warehouse_root.into(),
        }
    }

    /// Adopt one completed download: resolve the delivery facts from BDL's
    /// event log, copy the staging file into a fresh `downloaded_material`
    /// entry, and record content identity with the transport correlation.
    /// The staging file itself is never modified or deleted.
    pub fn adopt_download(&self, download_id: &str) -> Result<AdoptedDownload, DownloadAdoptError> {
        let consumer = DownloadEventConsumer::new(self.store);
        let completion = consumer.staging_completion(download_id)?;
        let completion = match completion {
            Some(completion) => completion,
            None => {
                return match consumer.lifecycle(download_id)? {
                    // No events at all: the id never existed on this store.
                    None => Err(DownloadAdoptError::DownloadNotFound(download_id.to_string())),
                    Some(lifecycle) => Err(DownloadAdoptError::DownloadNotCompleted {
                        download_id: download_id.to_string(),
                        phase: DownloadAdoptError::phase_name(&lifecycle.phase),
                    }),
                };
            }
        };

        let staging_path = PathBuf::from(&completion.stored_path);
        let staging_size = std::fs::metadata(&staging_path)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::NotFound => DownloadAdoptError::StagingFileMissing {
                    download_id: download_id.to_string(),
                    stored_path: completion.stored_path.clone(),
                },
                _ => DownloadAdoptError::Io(error),
            })?
            .len();
        if staging_size != completion.reported_size_bytes {
            return Err(DownloadAdoptError::CopySizeMismatch {
                download_id: download_id.to_string(),
                expected: completion.reported_size_bytes,
                actual: staging_size,
            });
        }

        // Display name: the delivery's suggested file name stem, else the
        // staging file name stem, else the download id. The entry identity
        // stays VUA-generated, never derived from the display name. The
        // on-disk name is the FINAL path component only — the verbatim
        // suggested name is server-controlled and never joins a path.
        let file_name = completion
            .suggested_file_name
            .as_deref()
            .and_then(adoptable_file_component)
            .or_else(|| {
                staging_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .and_then(adoptable_file_component)
            })
            .ok_or_else(|| DownloadAdoptError::DownloadNotFound(download_id.to_string()))?;
        let display_name = Path::new(&file_name)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .filter(|stem| !stem.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| download_id.to_string());

        let now = self.clock.now_rfc3339();
        let item = self.store.create_warehouse_item(
            &display_name,
            DOWNLOADED_ENTRY_KIND,
            &now,
        )?;
        let entry_folder = self.warehouse_root.join(&item.folder_name);
        std::fs::create_dir_all(&entry_folder)?;

        let destination = entry_folder.join(&file_name);
        std::fs::copy(&staging_path, &destination)?;
        let copied_size = std::fs::metadata(&destination)?.len();
        if copied_size != staging_size {
            return Err(DownloadAdoptError::CopySizeMismatch {
                download_id: download_id.to_string(),
                expected: staging_size,
                actual: copied_size,
            });
        }

        let identity = format!("sha256:{}", hex_lower(&sha256_file(&destination)?));
        let recording = self.store.record_untrusted_artifact(&NewLocalArtifact {
            artifact_sha256: identity.clone(),
            size_bytes: copied_size,
            suggested_file_name: Some(file_name.clone()),
            // The transport correlation closes here: this content entered by
            // download, not by folder import.
            download_id: Some(download_id.to_string()),
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
        self.store.record_artifact_copy(
            &item.warehouse_item_id,
            &identity,
            &file_name,
            &destination.to_string_lossy(),
            CopyRole::Original,
            &now,
        )?;

        // N5 D2 opportunistic catalog correlation. Candidate URLs: the
        // sourceUrl (browser-initiated downloads genuinely carry a
        // booth.pm/items/ direct link) plus the redirect chain — a silent
        // download 302s from booth.pm/downloadables/{id} to a signed CDN
        // address, so the original link only survives as the chain head.
        // Association priority: an /items/ id anywhere; else a
        // /downloadables/{id} resolved through BDL's OWN captured
        // product_downloadables table — server-side facts only, never a
        // client assertion over an AMF fact (the IN-4 boundary stands).
        // Best-effort by design: an unknown product (not yet synced) or a
        // foreign URL leaves the artifact uncorrelated — never a failed
        // adoption.
        let mut association_urls: Vec<&str> = vec![&completion.source_url];
        association_urls.extend(completion.source_url_chain.iter().map(String::as_str));
        let product_id = association_urls
            .iter()
            .find_map(|url| booth_item_id_from_url(url))
            .map(|native| format!("booth:{native}"))
            .or_else(|| {
                association_urls
                    .iter()
                    .find_map(|url| downloadable_id_from_url(url))
                    .and_then(|id| self.store.product_of_downloadable(id).ok().flatten())
            });
        if let Some(product_id) = product_id {
            let _ = self.store.record_artifact_mapping(
                &identity,
                &product_id,
                None,
                Some("download_adoption"),
                &now,
            );
        }

        // Invariant (BG-12): the entry was created by this same adoption a
        // few lines above — the detail read can only be absent on store
        // corruption, which is a panic-worthy break, never a silent skip.
        let entry = self
            .store
            .warehouse_entry_detail(&item.warehouse_item_id, ArtifactMode::UseOriginalUnitypackage)?
            .expect("the entry was created in this adoption");
        Ok(AdoptedDownload {
            download_id: download_id.to_string(),
            entry,
            file_name,
            artifact_sha256: identity,
            size_bytes: copied_size,
        })
    }
}

// ============================ Task layer ============================
//
// Same task binding shape as the batch import (v0.4.2 frozen runtime):
// download boundaries are the safe cancellation boundaries — a download
// already adopted stays adopted (entries are durable in BDL), and the job
// checks the task cancel flag before starting each download.

use vua_orchestrator::{ErrorCategory, ParamValue};
use vua_orchestrator::{SubmitRequest, TaskExit, TaskJob, TaskRuntime};
use std::time::Duration;

/// One download-adoption task binding. Identities only — every delivery
/// fact is resolved server-side from BDL's event log.
#[derive(Debug, Clone)]
pub struct WarehouseDownloadAdoptTaskSpec {
    pub correlation_id: String,
    pub download_ids: Vec<String>,
    pub warehouse_root: PathBuf,
}

fn adopt_error_to_app(
    error: DownloadAdoptError,
    correlation_id: &str,
    download_id: &str,
) -> vua_orchestrator::AppErrorV1 {
    let (code, category) = match &error {
        DownloadAdoptError::Store(_) => ("vua.warehouse.storeFailed", ErrorCategory::Internal),
        DownloadAdoptError::Io(_) => {
            ("vua.warehouse.adoptIoFailed", ErrorCategory::ExternalFailure)
        }
        DownloadAdoptError::DownloadNotFound(_)
        | DownloadAdoptError::DownloadNotCompleted { .. } => {
            ("vua.warehouse.downloadNotCompleted", ErrorCategory::Validation)
        }
        DownloadAdoptError::StagingFileMissing { .. } => {
            ("vua.warehouse.stagingFileMissing", ErrorCategory::ExternalFailure)
        }
        DownloadAdoptError::CopySizeMismatch { .. } => {
            ("vua.warehouse.copySizeMismatch", ErrorCategory::ExternalFailure)
        }
        // Stored corruption of the ingest-gated event log: a store-surface
        // internal failure, surfaced honestly rather than skipped.
        DownloadAdoptError::EventFold(_) => {
            ("vua.warehouse.storeFailed", ErrorCategory::Internal)
        }
    };
    vua_orchestrator::AppErrorV1::new(code, category, "errors.warehouse.adoptFailed", correlation_id)
        .with_param(
            "downloadId",
            ParamValue::Text(download_id.to_string()),
        )
        .with_param("reason", ParamValue::Text(error.to_string()))
        .with_recoverable(true)
}

/// Assemble the task closure: downloads are adopted in submission order with
/// a progress event after each; a cancel request stops the task at the next
/// download boundary (Cancelled exit, no payload — the durable partial state
/// is queryable through `warehouse.listEntries`).
pub fn warehouse_download_adopt_job(
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseDownloadAdoptTaskSpec,
) -> TaskJob {
    Box::new(move |ctx| {
        let mut adopted = Vec::new();
        for download_id in &spec.download_ids {
            if ctx.check_cancel() {
                ctx.emit_progress(serde_json::json!({
                    "kind": "warehouse.importDownloads.cancelled",
                    "cancelledBeforeDownloadId": download_id,
                    "downloadsAdopted": adopted.len(),
                }));
                return Ok(TaskExit::Cancelled);
            }
            let adopter = DownloadAdopter::new(&store, &*clock, spec.warehouse_root.clone());
            match adopter.adopt_download(download_id) {
                Ok(report) => {
                    ctx.emit_progress(serde_json::json!({
                        "kind": "warehouse.importDownloads.downloadAdopted",
                        "downloadId": report.download_id,
                        "entryId": report.entry.warehouse_item_id,
                        "downloadsAdopted": adopted.len() + 1,
                    }));
                    adopted.push(report);
                }
                Err(error) => {
                    return Err(adopt_error_to_app(error, &spec.correlation_id, download_id))
                }
            }
        }
        let result = WarehouseDownloadAdoptTaskResult {
            correlation_id: spec.correlation_id.clone(),
            downloads_requested: spec.download_ids.len(),
            downloads_adopted: adopted.len(),
            adopted,
        };
        // Invariant (BG-12): WarehouseDownloadAdoptTaskResult contains only
        // strings, counters and nested serializable structs — serde cannot
        // fail on it; a serialization error would be an invariant break,
        // surfaced as a panic instead of a silently null Done payload.
        let payload = serde_json::to_value(&result)
            .expect("task result serializes infallibly (plain data shapes only)");
        Ok(TaskExit::Done(payload))
    })
}

/// Submission: the correlation id binds the whole adoption batch.
pub fn submit_warehouse_import_downloads(
    runtime: &TaskRuntime,
    store: Arc<BdlStore>,
    clock: Arc<dyn Clock>,
    spec: WarehouseDownloadAdoptTaskSpec,
    timeout: Option<Duration>,
) -> Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1> {
    let correlation_id = spec.correlation_id.clone();
    let job = warehouse_download_adopt_job(store, clock, spec);
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
    use vua_bdl_store::download_events::DownloadEventV01;
    use vua_orchestrator::FixedClock;

    fn event(kind: vua_bdl_store::download_events::DownloadEventKind, download_id: &str, stored_path: Option<String>, received: Option<u64>) -> DownloadEventV01 {
        DownloadEventV01 {
            schema_version: "0.1".into(),
            kind,
            download_id: download_id.into(),
            attempt: 1,
            source_url: "https://booth.example.com/download/1000001/fixture".into(),
            initiated_from_page_url: None,
            url_chain: None,
            suggested_file_name: Some("material-pack.zip".into()),
            stored_path,
            expected_bytes: received,
            received_bytes: received,
            resumable: false,
            failure_kind: None,
            occurred_at: "2026-09-09T12:00:00.000Z".into(),
        }
    }

    #[test]
    fn adoption_copies_a_completed_download_without_touching_staging() {
        let store = BdlStore::open_in_memory().unwrap();
        let staging_dir = unique_dir("vua-adopt", "staging");
        let staging = staging_dir.join("material-pack.zip");
        std::fs::write(&staging, b"PK download fixture").unwrap();
        let consumer = DownloadEventConsumer::new(&store);
        consumer
            .ingest(&event(
                vua_bdl_store::download_events::DownloadEventKind::Started,
                "dl-1",
                Some(staging.to_string_lossy().into_owned()),
                Some(19),
            ))
            .unwrap();
        consumer
            .ingest(&event(
                vua_bdl_store::download_events::DownloadEventKind::Completed,
                "dl-1",
                Some(staging.to_string_lossy().into_owned()),
                Some(19),
            ))
            .unwrap();

        let warehouse_root = unique_dir("vua-adopt", "wh");
        let clock = FixedClock::new(&["2026-09-09T13:00:00.000Z"]);
        let adopter = DownloadAdopter::new(&store, &clock, &warehouse_root);
        let adopted = adopter.adopt_download("dl-1").unwrap();

        assert_eq!(adopted.download_id, "dl-1");
        assert_eq!(adopted.entry.kind, DOWNLOADED_ENTRY_KIND);
        let copied = warehouse_root
            .join(&adopted.entry.folder_name)
            .join(&adopted.file_name);
        assert_eq!(std::fs::read(&copied).unwrap(), b"PK download fixture");
        // Copy-in: the staging file survives untouched.
        assert_eq!(std::fs::read(&staging).unwrap(), b"PK download fixture");
        // The transport correlation closed onto the content row.
        let artifact = store.artifact(&adopted.artifact_sha256).unwrap().unwrap();
        assert_eq!(artifact.download_id.as_deref(), Some("dl-1"));
    }

    #[test]
    fn adoption_refuses_a_download_that_never_completed() {
        let store = BdlStore::open_in_memory().unwrap();
        let consumer = DownloadEventConsumer::new(&store);
        consumer
            .ingest(&event(
                vua_bdl_store::download_events::DownloadEventKind::Started,
                "dl-2",
                None,
                None,
            ))
            .unwrap();
        let adopter = DownloadAdopter::new(&store, &vua_orchestrator::SystemClock, unique_dir("vua-adopt", "wh"));
        match adopter.adopt_download("dl-2") {
            Err(DownloadAdoptError::DownloadNotCompleted { download_id, phase }) => {
                assert_eq!(download_id, "dl-2");
                assert_eq!(phase, "downloading");
            }
            other => panic!("expected DownloadNotCompleted, got {other:?}"),
        }
        // An id with no history at all is a distinct, honest refusal.
        match adopter.adopt_download("dl-unknown") {
            Err(DownloadAdoptError::DownloadNotFound(download_id)) => {
                assert_eq!(download_id, "dl-unknown");
            }
            other => panic!("expected DownloadNotFound, got {other:?}"),
        }
    }

    #[test]
    fn a_path_like_suggested_name_never_escapes_the_entry_folder() {
        let store = BdlStore::open_in_memory().unwrap();
        let staging_dir = unique_dir("vua-adopt", "staging");
        let staging = staging_dir.join("material-pack.zip");
        std::fs::write(&staging, b"PK hostile name fixture").unwrap();
        let size = b"PK hostile name fixture".len() as u64;
        let consumer = DownloadEventConsumer::new(&store);
        for (kind, occurred) in [
            (vua_bdl_store::download_events::DownloadEventKind::Started, "2026-09-09T12:00:00.000Z"),
            (vua_bdl_store::download_events::DownloadEventKind::Completed, "2026-09-09T12:00:01.000Z"),
        ] {
            let mut delivery = event(kind, "dl-hostile", Some(staging.to_string_lossy().into_owned()), Some(size));
            // Server-controlled Content-Disposition content pointing two
            // levels above the entry folder.
            delivery.suggested_file_name = Some("..\\..\\evil.zip".into());
            delivery.occurred_at = occurred.into();
            consumer.ingest(&delivery).unwrap();
        }

        let warehouse_root = unique_dir("vua-adopt", "wh");
        let clock = FixedClock::new(&["2026-09-09T13:00:00.000Z"]);
        let adopter = DownloadAdopter::new(&store, &clock, &warehouse_root);
        let adopted = adopter.adopt_download("dl-hostile").unwrap();

        // The copy landed INSIDE the entry folder under its final
        // component — never at the hostile path.
        assert_eq!(adopted.file_name, "evil.zip");
        let entry_folder = warehouse_root.join(&adopted.entry.folder_name);
        assert!(entry_folder.join("evil.zip").is_file());
        assert!(
            !warehouse_root
                .parent()
                .unwrap()
                .join("evil.zip")
                .exists(),
            "the hostile relative escape target must not exist"
        );
        // The copy rows carry the guarded component as the relative path.
        let copies = store.entry_copies(&adopted.entry.warehouse_item_id).unwrap();
        assert_eq!(copies[0].relative_path, "evil.zip");
        std::fs::remove_dir_all(&warehouse_root).ok();
        std::fs::remove_dir_all(&staging_dir).ok();
    }
}


/// `/items/{digits}` in a booth.pm URL (any locale path) — the only URL
/// shape eligible for catalog correlation. Non-booth or item-less URLs
/// return None (uncorrelated, not an error).
/// `/downloadables/{digits}` → the digits (BDL capture-table key; the
/// adoption-side reverse lookup into product_downloadables).
fn downloadable_id_from_url(url: &str) -> Option<i64> {
    let start = url.find("/downloadables/")? + "/downloadables/".len();
    let tail = &url[start..];
    let end = tail
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(tail.len());
    if end == 0 {
        None
    } else {
        tail[..end].parse::<i64>().ok()
    }
}

fn booth_item_id_from_url(url: &str) -> Option<&str> {
    let start = url.find("/items/")? + "/items/".len();
    let tail = &url[start..];
    let end = tail
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(tail.len());
    if end == 0 {
        None
    } else {
        Some(&tail[..end])
    }
}

#[cfg(test)]
mod correlation_tests {
    use super::booth_item_id_from_url;

    #[test]
    fn extracts_item_ids_from_booth_urls() {
        assert_eq!(
            booth_item_id_from_url("https://booth.pm/ja/items/3087170"),
            Some("3087170")
        );
        assert_eq!(
            booth_item_id_from_url("https://accounts.booth.pm/download/123/x?item=/items/99"),
            Some("99")
        );
        assert_eq!(booth_item_id_from_url("https://booth.pm/library"), None);
        assert_eq!(booth_item_id_from_url("https://example.com/items/abc"), None);
        assert_eq!(booth_item_id_from_url("not a url"), None);
    }
}

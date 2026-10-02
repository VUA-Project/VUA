//! Download-events protocol v0.1 wire vocabulary (frozen 2026-09-06).
//!
//! Rust mirror of `schemas/download-events/v0.1/event.schema.json`. The F4
//! download port reports transport facts only: content identity (SHA-256),
//! inspection verdicts, source correlation and Warehouse decisions are AMF's.
//! Events never carry cookies, download tokens or credentials, and
//! `stored_path` is the only path field. Any vocabulary change must bump the
//! schema version — never rewrite in place.

use crate::bdl_store::{BdlStore, BdlStoreError};
use serde::{Deserialize, Serialize};

pub const DOWNLOAD_EVENT_SCHEMA_VERSION: &str = "0.1";

/// Bounded attempts per `downloadId` (protocol: at most 3, exponential
/// backoff; cancellation takes effect at attempt boundaries).
pub const MAX_DOWNLOAD_ATTEMPTS: u32 = 3;

/// Closed six-event vocabulary (`download.*`). Interrupted is the resumable
/// candidate; cancelled and failed are terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DownloadEventKind {
    #[serde(rename = "download.started")]
    Started,
    #[serde(rename = "download.progress")]
    Progress,
    #[serde(rename = "download.interrupted")]
    Interrupted,
    #[serde(rename = "download.completed")]
    Completed,
    #[serde(rename = "download.cancelled")]
    Cancelled,
    #[serde(rename = "download.failed")]
    Failed,
}

/// Failure attribution, failed events only. The port cannot honestly
/// distinguish network, disk or server causes on the Electron event surface,
/// so `unknown` is the honest default; `policy` is the port's own
/// allowlist denial at `will-download`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadFailureKind {
    Policy,
    Unknown,
}

/// One normalized transport event. Serde shape matches the JSON Schema
/// document field for field, including `deny_unknown_fields` — a port that
/// smuggles extra fields (e.g. a user-chosen path) fails the contract here
/// first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadEventV01 {
    pub schema_version: String,
    pub kind: DownloadEventKind,
    pub download_id: String,
    pub attempt: u32,
    pub source_url: String,
    pub initiated_from_page_url: Option<String>,
    pub url_chain: Option<Vec<String>>,
    pub suggested_file_name: Option<String>,
    pub stored_path: Option<String>,
    pub expected_bytes: Option<u64>,
    pub received_bytes: Option<u64>,
    pub resumable: bool,
    pub failure_kind: Option<DownloadFailureKind>,
    pub occurred_at: String,
}

impl DownloadEventV01 {
    pub fn schema_version_valid(&self) -> bool {
        self.schema_version == DOWNLOAD_EVENT_SCHEMA_VERSION
    }
}

/// Port-visible download lifecycle, derived by folding persisted events.
/// `verifying / inspected / admitted` are artifact-side states
/// (local_artifacts), not download phases — completed ≠ admitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadPhase {
    /// No events yet; the port is between `will-download` and `started`.
    Queued,
    Downloading,
    /// Network break before a terminal state; a resume candidate. Progress
    /// with the same attempt number returns the download to `Downloading`.
    Interrupted,
    /// Byte transfer finished — untrusted until AMF verification concludes.
    TransferDone,
    Cancelled,
    Failed,
}

impl DownloadPhase {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Cancelled | Self::Failed)
    }
}

/// Folded state of one download across all its attempts.
#[derive(Debug, Clone, PartialEq)]
pub struct DownloadLifecycle {
    pub download_id: String,
    pub attempt: u32,
    pub phase: DownloadPhase,
    /// False when the history holds no `started` — a download that was
    /// denied at `will-download` (failed/policy) or cancelled while queued.
    pub started: bool,
    pub resumable: bool,
    pub stored_path: Option<String>,
    pub expected_bytes: Option<u64>,
    pub received_bytes: Option<u64>,
}

impl DownloadLifecycle {
    pub fn is_terminal(&self) -> bool {
        self.phase.is_terminal()
    }
}

/// Exponential backoff for starting attempt N+1 (2s, 4s, capped at 8s).
/// The rhythm is policy, not contract; the attempt bound is the contract.
pub fn backoff_for_attempt(next_attempt: u32) -> std::time::Duration {
    std::time::Duration::from_secs(2u64.saturating_pow(next_attempt.saturating_sub(1))).min(std::time::Duration::from_secs(8))
}

/// AMF-side retry policy for a non-terminal lifecycle snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDecision {
    /// Port mechanism: resume() continues the SAME attempt.
    Resume,
    /// AMF abandons the partial file and restarts from zero as a fresh
    /// attempt after the backoff elapses.
    StartNextAttempt { attempt: u32 },
    /// Attempt bound reached, or the download left the retryable phases.
    GiveUp,
}

pub fn retry_decision(lifecycle: &DownloadLifecycle) -> RetryDecision {
    match lifecycle.phase {
        // Resume continues the SAME attempt over the live connection.
        DownloadPhase::Interrupted
            if lifecycle.attempt < MAX_DOWNLOAD_ATTEMPTS && lifecycle.resumable =>
        {
            RetryDecision::Resume
        }
        // A fresh attempt restarts from zero (interrupted non-resumable, or
        // the port reported a hard failure inside the attempt bound) — the
        // B3 discipline: a new attempt record, never a blind second run.
        DownloadPhase::Interrupted | DownloadPhase::Failed
            if lifecycle.attempt < MAX_DOWNLOAD_ATTEMPTS =>
        {
            RetryDecision::StartNextAttempt {
                attempt: lifecycle.attempt + 1,
            }
        }
        // The frozen bound wins, and downloads that are in flight, already
        // transferred, or user-cancelled have nothing to retry.
        _ => RetryDecision::GiveUp,
    }
}

#[derive(Debug)]
pub enum ConsumerError {
    SchemaVersion(String),
    Store(BdlStoreError),
    AlreadyTerminal {
        download_id: String,
        phase: DownloadPhase,
    },
    IllegalSequence {
        download_id: String,
        kind: DownloadEventKind,
        reason: &'static str,
    },
}

impl From<BdlStoreError> for ConsumerError {
    fn from(error: BdlStoreError) -> Self {
        Self::Store(error)
    }
}

impl std::fmt::Display for ConsumerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SchemaVersion(version) => {
                write!(formatter, "unsupported download event schema version {version}")
            }
            Self::Store(error) => write!(formatter, "{error}"),
            Self::AlreadyTerminal {
                download_id,
                phase,
            } => write!(
                formatter,
                "download {download_id} is already terminal ({phase:?}); no event may extend it"
            ),
            Self::IllegalSequence {
                download_id,
                kind,
                reason,
            } => write!(
                formatter,
                "download {download_id}: {kind:?} event is illegal here: {reason}"
            ),
        }
    }
}

impl std::error::Error for ConsumerError {}

/// Folds a persisted event history into lifecycle state. Histories are
/// ingest-gated, so a violation here means stored corruption, never a live
/// port misbehaviour.
pub fn fold_lifecycle(
    download_id: &str,
    events: &[crate::bdl_store::StoredDownloadEvent],
) -> Result<DownloadLifecycle, ConsumerError> {
    let mut lifecycle = DownloadLifecycle {
        download_id: download_id.to_string(),
        attempt: 0,
        phase: DownloadPhase::Queued,
        started: false,
        resumable: false,
        stored_path: None,
        expected_bytes: None,
        received_bytes: None,
    };
    for event in events {
        // The frozen wire schema's per-kind field law for the completion
        // event (storedPath/receivedBytes required), enforced here because
        // the Rust mirror type carries them as plain Options: a completed
        // event without them would fold to TransferDone and then panic
        // every later completion-manifest read. Stored histories that hold
        // such a row are corruption, surfaced as an error — never folded
        // into a lie.
        if event.kind == DownloadEventKind::Completed
            && (event.stored_path.as_deref().map(str::trim).unwrap_or("").is_empty()
                || event.received_bytes.is_none())
        {
            return Err(ConsumerError::IllegalSequence {
                download_id: download_id.to_string(),
                kind: event.kind,
                reason:
                    "the frozen schema requires storedPath and receivedBytes on download.completed",
            });
        }
        // A user-cancelled download is final; a hard failure inside the
        // attempt bound may be followed by an AMF-adjudicated fresh attempt
        // (the B3 attempt discipline — new attempt, new record).
        let adjudicated_retry_start = lifecycle.phase == DownloadPhase::Failed
            && lifecycle.started
            && event.kind == DownloadEventKind::Started
            && event.attempt == lifecycle.attempt + 1
            && event.attempt <= MAX_DOWNLOAD_ATTEMPTS;
        if lifecycle.phase.is_terminal() && !adjudicated_retry_start {
            return Err(ConsumerError::IllegalSequence {
                download_id: download_id.to_string(),
                kind: event.kind,
                reason: "history holds events after a terminal fact",
            });
        }
        if lifecycle.started
            && !adjudicated_retry_start
            && event.kind != DownloadEventKind::Started
            && event.attempt != lifecycle.attempt
        {
            return Err(ConsumerError::IllegalSequence {
                download_id: download_id.to_string(),
                kind: event.kind,
                reason: "event attempt does not match the running attempt",
            });
        }
        match event.kind {
            DownloadEventKind::Started => {
                if !lifecycle.started {
                    if event.attempt != 1 {
                        return Err(ConsumerError::IllegalSequence {
                            download_id: download_id.to_string(),
                            kind: event.kind,
                            reason: "the first attempt must be 1",
                        });
                    }
                } else {
                    let retry_start = (lifecycle.phase == DownloadPhase::Interrupted
                        || lifecycle.phase == DownloadPhase::Failed)
                        && event.attempt == lifecycle.attempt + 1
                        && event.attempt <= MAX_DOWNLOAD_ATTEMPTS;
                    if !retry_start {
                        return Err(ConsumerError::IllegalSequence {
                            download_id: download_id.to_string(),
                            kind: event.kind,
                            reason: "a fresh attempt only follows an interruption or a failure inside the attempt bound",
                        });
                    }
                }
                lifecycle.started = true;
                lifecycle.phase = DownloadPhase::Downloading;
                lifecycle.attempt = event.attempt;
                lifecycle.resumable = event.resumable;
                lifecycle.stored_path = event.stored_path.clone();
                lifecycle.expected_bytes = event.expected_bytes;
                lifecycle.received_bytes = event.received_bytes;
            }
            DownloadEventKind::Progress => {
                if !lifecycle.started {
                    return Err(ConsumerError::IllegalSequence {
                        download_id: download_id.to_string(),
                        kind: event.kind,
                        reason: "progress without a started event",
                    });
                }
                // Interrupted → Downloading with the same attempt counter:
                // progress proves the resumed transfer is running again.
                lifecycle.phase = DownloadPhase::Downloading;
                lifecycle.received_bytes = event.received_bytes;
                lifecycle.resumable = event.resumable;
            }
            DownloadEventKind::Interrupted => {
                if !lifecycle.started || lifecycle.phase != DownloadPhase::Downloading {
                    return Err(ConsumerError::IllegalSequence {
                        download_id: download_id.to_string(),
                        kind: event.kind,
                        reason: "interruption only interrupts an active transfer",
                    });
                }
                lifecycle.phase = DownloadPhase::Interrupted;
                lifecycle.received_bytes = event.received_bytes;
                lifecycle.resumable = event.resumable;
            }
            DownloadEventKind::Completed => {
                if !lifecycle.started
                    || !matches!(
                        lifecycle.phase,
                        DownloadPhase::Downloading | DownloadPhase::Interrupted
                    )
                {
                    return Err(ConsumerError::IllegalSequence {
                        download_id: download_id.to_string(),
                        kind: event.kind,
                        reason: "completion only concludes an active or resumed transfer",
                    });
                }
                lifecycle.phase = DownloadPhase::TransferDone;
                lifecycle.received_bytes = event.received_bytes;
                lifecycle.resumable = event.resumable;
            }
            DownloadEventKind::Cancelled | DownloadEventKind::Failed => {
                lifecycle.phase = if event.kind == DownloadEventKind::Cancelled {
                    DownloadPhase::Cancelled
                } else {
                    DownloadPhase::Failed
                };
                lifecycle.resumable = event.resumable;
                if lifecycle.started {
                    lifecycle.received_bytes = event.received_bytes;
                }
            }
        }
        if let Some(path) = &event.stored_path {
            lifecycle.stored_path = Some(path.clone());
        }
        if let Some(expected) = event.expected_bytes {
            lifecycle.expected_bytes = Some(expected);
        }
    }
    Ok(lifecycle)
}

fn check_sequence(
    prior: &DownloadLifecycle,
    event: &DownloadEventV01,
) -> Result<(), ConsumerError> {
    let reject = |reason| ConsumerError::IllegalSequence {
        download_id: prior.download_id.clone(),
        kind: event.kind,
        reason,
    };
    // The frozen wire schema's per-kind field law for the completion event
    // (storedPath/receivedBytes required) — the ingest gate enforces it so
    // a schema-violating delivery never reaches the fact log (the Rust
    // mirror type carries these fields as plain Options).
    if event.kind == DownloadEventKind::Completed
        && (event.stored_path.as_deref().map(str::trim).unwrap_or("").is_empty()
            || event.received_bytes.is_none())
    {
        return Err(reject(
            "the frozen schema requires storedPath and receivedBytes on download.completed",
        ));
    }
    let adjudicated_retry_start = prior.phase == DownloadPhase::Failed
        && prior.started
        && event.kind == DownloadEventKind::Started
        && event.attempt == prior.attempt + 1
        && event.attempt <= MAX_DOWNLOAD_ATTEMPTS;
    if prior.started
        && !adjudicated_retry_start
        && event.kind != DownloadEventKind::Started
        && event.attempt != prior.attempt
    {
        return Err(reject("event attempt does not match the running attempt"));
    }
    match event.kind {
        DownloadEventKind::Started => {
            if !prior.started {
                if event.attempt != 1 {
                    return Err(reject("the first attempt must be 1"));
                }
            } else {
                let retry_start = (prior.phase == DownloadPhase::Interrupted
                    || prior.phase == DownloadPhase::Failed)
                    && event.attempt == prior.attempt + 1
                    && event.attempt <= MAX_DOWNLOAD_ATTEMPTS;
                if !retry_start {
                    return Err(reject(
                        "a fresh attempt only follows an interruption or failure within the attempt bound",
                    ));
                }
            }
        }
        DownloadEventKind::Progress => {
            if !prior.started {
                return Err(reject("progress without a started event"));
            }
            if !matches!(
                prior.phase,
                DownloadPhase::Downloading | DownloadPhase::Interrupted
            ) {
                return Err(reject("progress after the transfer concluded"));
            }
        }
        DownloadEventKind::Interrupted => {
            if !prior.started || prior.phase != DownloadPhase::Downloading {
                return Err(reject("interruption only interrupts an active transfer"));
            }
        }
        DownloadEventKind::Completed => {
            if !prior.started
                || !matches!(
                    prior.phase,
                    DownloadPhase::Downloading | DownloadPhase::Interrupted
                )
            {
                return Err(reject("completion only concludes an active or resumed transfer"));
            }
        }
        // Cancel and failure terminate from anywhere non-terminal — including
        // a queued download denied at `will-download` (no started yet).
        DownloadEventKind::Cancelled | DownloadEventKind::Failed => {}
    }
    Ok(())
}

/// AMF-side consumer of the narrowed download port: appends each normalized
/// event to BDL (deduped) and gates the sequence against the frozen protocol
/// state machine. Invalid sequences never reach the fact log.
pub struct DownloadEventConsumer<'a> {
    store: &'a BdlStore,
}

#[derive(Debug, Clone, PartialEq)]
pub enum IngestOutcome {
    Recorded { lifecycle: DownloadLifecycle },
    Duplicate { lifecycle: DownloadLifecycle },
}

impl<'a> DownloadEventConsumer<'a> {
    pub fn new(store: &'a BdlStore) -> Self {
        Self { store }
    }

    pub fn ingest(&self, event: &DownloadEventV01) -> Result<IngestOutcome, ConsumerError> {
        if !event.schema_version_valid() {
            return Err(ConsumerError::SchemaVersion(event.schema_version.clone()));
        }
        let mut history = self.store.download_events(&event.download_id)?;
        if history
            .iter()
            .any(|stored| {
                stored.attempt == event.attempt
                    && stored.kind == event.kind
                    && stored.occurred_at == event.occurred_at
            })
        {
            // Redelivery: no new fact, return the folded state.
            let lifecycle = fold_lifecycle(&event.download_id, &history)?;
            return Ok(IngestOutcome::Duplicate { lifecycle });
        }
        let prior = fold_lifecycle(&event.download_id, &history)?;
        if prior.is_terminal() {
            // One exception: an AMF-adjudicated fresh attempt after a hard
            // failure (new attempt record inside the bound). Everything else
            // after a terminal fact is refused at the gate.
            let adjudicated_retry_start = prior.phase == DownloadPhase::Failed
                && prior.started
                && event.kind == DownloadEventKind::Started
                && event.attempt == prior.attempt + 1
                && event.attempt <= MAX_DOWNLOAD_ATTEMPTS;
            if !adjudicated_retry_start {
                return Err(ConsumerError::AlreadyTerminal {
                    download_id: event.download_id.clone(),
                    phase: prior.phase,
                });
            }
        }
        check_sequence(&prior, event)?;
        self.store.append_download_event(event)?;
        history.push(crate::bdl_store::StoredDownloadEvent {
            event_id: 0,
            download_id: event.download_id.clone(),
            attempt: event.attempt,
            kind: event.kind,
            source_url: event.source_url.clone(),
            initiated_from_page_url: event.initiated_from_page_url.clone(),
            url_chain: event.url_chain.clone(),
            suggested_file_name: event.suggested_file_name.clone(),
            stored_path: event.stored_path.clone(),
            expected_bytes: event.expected_bytes,
            received_bytes: event.received_bytes,
            resumable: event.resumable,
            failure_kind: event.failure_kind,
            occurred_at: event.occurred_at.clone(),
        });
        let lifecycle = fold_lifecycle(&event.download_id, &history)?;
        Ok(IngestOutcome::Recorded { lifecycle })
    }

    pub fn lifecycle(
        &self,
        download_id: &str,
    ) -> Result<Option<DownloadLifecycle>, ConsumerError> {
        let history = self.store.download_events(download_id)?;
        if history.is_empty() {
            return Ok(None);
        }
        fold_lifecycle(download_id, &history).map(Some)
    }

    /// Crash recovery enumeration: downloads whose fold is non-terminal —
    /// the protocol's `orphaned` candidates (inspect the partial file, never
    /// silently resume).
    pub fn non_terminal_downloads(&self) -> Result<Vec<DownloadLifecycle>, ConsumerError> {
        let mut lifecycles = Vec::new();
        for download_id in self.store.download_ids()? {
            if let Some(lifecycle) = self.lifecycle(&download_id)? {
                if !lifecycle.is_terminal() {
                    lifecycles.push(lifecycle);
                }
            }
        }
        Ok(lifecycles)
    }

    /// The completion-manifest entry for one download: derived from the
    /// persisted event log, present only while the fold sits at
    /// `TransferDone` (a terminal download has no grant; an unfinished one
    /// has nothing to inspect). The token is a consistency binding over the
    /// completed delivery — AMF-internal, never part of the event
    /// vocabulary — so an inspector call proves it is acting on THIS
    /// completed event rather than an arbitrary path a caller produced.
    pub fn staging_completion(
        &self,
        download_id: &str,
    ) -> Result<Option<StagingCompletion>, ConsumerError> {
        let history = self.store.download_events(download_id)?;
        let lifecycle = fold_lifecycle(download_id, &history)?;
        if lifecycle.phase != DownloadPhase::TransferDone || !lifecycle.started {
            return Ok(None);
        }
        let completed = history
            .iter()
            .rev()
            .find(|event| event.kind == DownloadEventKind::Completed)
            .expect("a TransferDone fold has a completed event");
        // The fold gate enforces the frozen per-kind law (storedPath and
        // receivedBytes required on download.completed); this mapping is
        // the defensive backstop — stored corruption surfaces as a typed
        // error, never a panic.
        let stored_path = completed.stored_path.clone().ok_or_else(|| {
            ConsumerError::Store(BdlStoreError::CorruptValue {
                field: "download completed event",
                value: download_id.to_string(),
            })
        })?;
        let reported_size_bytes = completed.received_bytes.ok_or_else(|| {
            ConsumerError::Store(BdlStoreError::CorruptValue {
                field: "download completed event",
                value: download_id.to_string(),
            })
        })?;
        // started 事件的 source_url 是采纳关联的唯一来源(N5 D2:机缘
        // 关联,不做任何爬取)
        let source_url = history
            .first()
            .map(|event| event.source_url.clone())
            .unwrap_or_default();
        Ok(Some(StagingCompletion {
            staging_token: staging_token_for(download_id, &completed.occurred_at),
            download_id: download_id.to_string(),
            stored_path,
            reported_size_bytes,
            suggested_file_name: completed.suggested_file_name.clone(),
            source_url,
        }))
    }
}

/// Completion-manifest handle: the binding between a completed delivery and
/// the staged file AMF is willing to inspect.
#[derive(Debug, Clone, PartialEq)]
pub struct StagingCompletion {
    pub staging_token: String,
    pub download_id: String,
    pub stored_path: String,
    pub reported_size_bytes: u64,
    pub suggested_file_name: Option<String>,
    /// The delivery's origin URL (from the started event) — the adopter's
    /// only basis for opportunistic catalog correlation (booth item id).
    pub source_url: String,
}

fn staging_token_for(download_id: &str, occurred_at: &str) -> String {
    format!("stg1:{download_id}:{occurred_at}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn examples_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/download-events/v0.1/examples")
    }

    fn read_example(name: &str) -> DownloadEventV01 {
        let bytes = std::fs::read(examples_dir().join(format!("{name}.json"))).expect("example must exist");
        serde_json::from_slice(&bytes).expect("example must deserialize")
    }

    #[test]
    fn every_frozen_example_deserializes_and_roundtrips() {
        for name in [
            "started",
            "progress",
            "interrupted",
            "completed",
            "cancelled",
            "failed-policy",
            "failed-unknown",
        ] {
            let event = read_example(name);
            assert!(event.schema_version_valid(), "{name}: schema version");
            let roundtrip: DownloadEventV01 =
                serde_json::from_value(serde_json::to_value(&event).unwrap()).unwrap();
            assert_eq!(event, roundtrip, "{name}: serde roundtrip");
        }
    }

    #[test]
    fn policy_failure_carries_no_stored_path_and_unknown_does() {
        let policy = read_example("failed-policy");
        assert_eq!(policy.failure_kind, Some(DownloadFailureKind::Policy));
        assert_eq!(policy.stored_path, None, "policy denial happens before any file exists");
        let unknown = read_example("failed-unknown");
        assert_eq!(unknown.failure_kind, Some(DownloadFailureKind::Unknown));
        assert!(unknown.stored_path.is_some(), "partial file stays reportable");
    }

    #[test]
    fn network_attribution_is_rejected_and_extra_fields_never_ride_along() {
        let bytes = std::fs::read(examples_dir().join("invalid-failed-network.json")).unwrap();
        assert!(
            serde_json::from_slice::<DownloadEventV01>(&bytes).is_err(),
            "the port cannot honestly report network/disk/server attribution"
        );
        let bytes = std::fs::read(examples_dir().join("invalid-user-chosen-path.json")).unwrap();
        assert!(
            serde_json::from_slice::<DownloadEventV01>(&bytes).is_err(),
            "stored_path is the only path field; port-invented fields are rejected"
        );
    }

    mod consumer {
        use super::*;
        use crate::bdl_store::StoredDownloadEvent;

        fn store() -> BdlStore {
            BdlStore::open_in_memory().unwrap()
        }

        fn event(
            kind: DownloadEventKind,
            download_id: &str,
            attempt: u32,
            occurred_at: &str,
        ) -> DownloadEventV01 {
            DownloadEventV01 {
                schema_version: DOWNLOAD_EVENT_SCHEMA_VERSION.into(),
                kind,
                download_id: download_id.into(),
                attempt,
                source_url: "https://booth.example.com/download/1000001/fixture".into(),
                initiated_from_page_url: Some("https://booth.example.com/items/1000001".into()),
                url_chain: None,
                suggested_file_name: Some("pack.zip".into()),
                stored_path: Some(format!("C:\\staging\\{download_id}-{attempt}-pack.zip")),
                expected_bytes: Some(1024),
                received_bytes: Some(0),
                resumable: true,
                failure_kind: None,
                occurred_at: occurred_at.into(),
            }
        }

        fn with_received(mut event: DownloadEventV01, received: u64) -> DownloadEventV01 {
            event.received_bytes = Some(received);
            event
        }

        fn ingest_all(consumer: &DownloadEventConsumer<'_>, events: &[DownloadEventV01]) {
            for event in events {
                consumer
                    .ingest(event)
                    .unwrap_or_else(|error| panic!("ingest {event:?}: {error}"));
            }
        }

        #[test]
        fn full_lifecycle_folds_to_transfer_done_and_never_to_admitted() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            let id = "dl-full";
            ingest_all(
                &consumer,
                &[
                    event(DownloadEventKind::Started, id, 1, "2026-09-06T08:15:00.000Z"),
                    with_received(event(DownloadEventKind::Progress, id, 1, "2026-09-06T08:15:10.000Z"), 512),
                    with_received(event(DownloadEventKind::Completed, id, 1, "2026-09-06T08:16:00.000Z"), 1024),
                ],
            );
            let lifecycle = consumer.lifecycle(id).unwrap().unwrap();
            assert_eq!(lifecycle.phase, DownloadPhase::TransferDone);
            assert!(!lifecycle.is_terminal(), "completed ≠ admitted");
            assert_eq!(lifecycle.attempt, 1);
            assert_eq!(lifecycle.received_bytes, Some(1024));
        }

        #[test]
        fn interrupted_returns_to_downloading_on_same_attempt_progress() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            let id = "dl-resume";
            ingest_all(
                &consumer,
                &[
                    event(DownloadEventKind::Started, id, 1, "2026-09-06T08:15:00.000Z"),
                    event(DownloadEventKind::Interrupted, id, 1, "2026-09-06T08:15:30.000Z"),
                ],
            );
            let interrupted = consumer.lifecycle(id).unwrap().unwrap();
            assert_eq!(interrupted.phase, DownloadPhase::Interrupted);
            assert_eq!(retry_decision(&interrupted), RetryDecision::Resume);

            ingest_all(
                &consumer,
                &[event(DownloadEventKind::Progress, id, 1, "2026-09-06T08:16:00.000Z")],
            );
            let resumed = consumer.lifecycle(id).unwrap().unwrap();
            assert_eq!(resumed.phase, DownloadPhase::Downloading);
            assert_eq!(resumed.attempt, 1, "resume continuation keeps the attempt counter");
        }

        #[test]
        fn retries_increment_attempts_inside_the_bound_then_give_up() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            let id = "dl-retry";
            ingest_all(
                &consumer,
                &[
                    event(DownloadEventKind::Started, id, 1, "2026-09-06T08:15:00.000Z"),
                    event(DownloadEventKind::Interrupted, id, 1, "2026-09-06T08:15:30.000Z"),
                ],
            );
            // Non-resumable interruption: a fresh attempt is the only way.
            let mut non_resumable =
                event(DownloadEventKind::Interrupted, id, 1, "2026-09-06T08:15:31.000Z");
            non_resumable.resumable = false;
            assert!(
                matches!(
                    consumer.ingest(&non_resumable),
                    Err(ConsumerError::IllegalSequence { .. })
                ),
                "double interruption without progress is a port violation"
            );

            ingest_all(
                &consumer,
                &[
                    event(DownloadEventKind::Started, id, 2, "2026-09-06T08:16:00.000Z"),
                    event(DownloadEventKind::Interrupted, id, 2, "2026-09-06T08:16:30.000Z"),
                    event(DownloadEventKind::Started, id, 3, "2026-09-06T08:17:00.000Z"),
                    event(DownloadEventKind::Interrupted, id, 3, "2026-09-06T08:17:30.000Z"),
                ],
            );
            let at_bound = consumer.lifecycle(id).unwrap().unwrap();
            assert_eq!(
                retry_decision(&at_bound),
                RetryDecision::GiveUp,
                "the frozen three-attempt bound makes the policy give up"
            );
            assert!(matches!(
                consumer.ingest(&event(DownloadEventKind::Started, id, 4, "2026-09-06T08:18:00.000Z")),
                Err(ConsumerError::IllegalSequence { .. })
            ));
            assert_eq!(
                backoff_for_attempt(2),
                std::time::Duration::from_secs(2),
                "exponential backoff: 2s, 4s, capped at 8s"
            );
        }

        #[test]
        fn redelivery_returns_the_folded_state_without_a_second_fact() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            let id = "dl-dup";
            let first = event(DownloadEventKind::Started, id, 1, "2026-09-06T08:15:00.000Z");
            assert!(matches!(
                consumer.ingest(&first).unwrap(),
                IngestOutcome::Recorded { .. }
            ));
            let replay = consumer.ingest(&first).unwrap();
            assert!(matches!(replay, IngestOutcome::Duplicate { .. }));
            assert_eq!(store.download_events(id).unwrap().len(), 1);
        }

        #[test]
        fn terminal_downloads_reject_every_further_event_without_appending() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            let id = "dl-terminal";
            let mut failure = event(DownloadEventKind::Failed, id, 1, "2026-09-06T08:16:00.000Z");
            failure.failure_kind = Some(DownloadFailureKind::Unknown);
            ingest_all(
                &consumer,
                &[
                    event(DownloadEventKind::Started, id, 1, "2026-09-06T08:15:00.000Z"),
                    failure,
                ],
            );
            let lifecycle = consumer.lifecycle(id).unwrap().unwrap();
            assert_eq!(lifecycle.phase, DownloadPhase::Failed);
            assert!(matches!(
                consumer.ingest(&event(DownloadEventKind::Progress, id, 1, "2026-09-06T08:17:00.000Z")),
                Err(ConsumerError::AlreadyTerminal { .. })
            ));
            assert_eq!(
                store.download_events(id).unwrap().len(),
                2,
                "rejected sequences never reach the fact log"
            );
        }

        #[test]
        fn a_queued_policy_denial_is_legal_without_a_started_event() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            let id = "dl-policy";
            let mut denial = event(DownloadEventKind::Failed, id, 1, "2026-09-06T08:15:00.000Z");
            denial.failure_kind = Some(DownloadFailureKind::Policy);
            denial.stored_path = None;
            let outcome = consumer.ingest(&denial).unwrap();
            assert!(matches!(outcome, IngestOutcome::Recorded { .. }));
            let lifecycle = consumer.lifecycle(id).unwrap().unwrap();
            assert_eq!(lifecycle.phase, DownloadPhase::Failed);
            assert!(!lifecycle.started);
            assert_eq!(lifecycle.stored_path, None);
        }

        #[test]
        fn crash_recovery_enumerates_non_terminal_downloads_only() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            ingest_all(
                &consumer,
                &[
                    event(DownloadEventKind::Started, "dl-orphan", 1, "2026-09-06T08:15:00.000Z"),
                    event(DownloadEventKind::Progress, "dl-orphan", 1, "2026-09-06T08:15:10.000Z"),
                ],
            );
            ingest_all(
                &consumer,
                &[
                    event(DownloadEventKind::Started, "dl-finished", 1, "2026-09-06T08:59:00.000Z"),
                    event(DownloadEventKind::Completed, "dl-finished", 1, "2026-09-06T09:00:00.000Z"),
                ],
            );
            consumer
                .ingest(&event(DownloadEventKind::Cancelled, "dl-cancelled", 1, "2026-09-06T09:05:00.000Z"))
                .unwrap();

            let orphans = consumer.non_terminal_downloads().unwrap();
            let ids: Vec<_> = orphans.iter().map(|lifecycle| lifecycle.download_id.as_str()).collect();
            assert_eq!(
                ids,
                vec!["dl-finished", "dl-orphan"],
                "every non-terminal download is an orphan candidate: TransferDone still owes AMF verification, Downloading owes the partial-file decision"
            );
            assert_eq!(orphans[1].stored_path.as_deref(), Some("C:\\staging\\dl-orphan-1-pack.zip"));
        }

        #[test]
        fn a_failed_attempt_inside_the_bound_retries_as_a_fresh_attempt() {
            let lifecycle = DownloadLifecycle {
                download_id: "dl-f".into(),
                attempt: 1,
                phase: DownloadPhase::Failed,
                started: true,
                resumable: false,
                stored_path: None,
                expected_bytes: None,
                received_bytes: None,
            };
            assert_eq!(
                retry_decision(&lifecycle),
                RetryDecision::StartNextAttempt { attempt: 2 },
                "a hard failure inside the bound is retried from zero, not abandoned"
            );
        }

        #[test]
        fn wrong_attempt_numbers_and_started_less_progress_are_rejected() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            consumer
                .ingest(&event(DownloadEventKind::Started, "dl-x", 1, "2026-09-06T08:15:00.000Z"))
                .unwrap();
            assert!(matches!(
                consumer.ingest(&event(DownloadEventKind::Progress, "dl-x", 2, "2026-09-06T08:15:10.000Z")),
                Err(ConsumerError::IllegalSequence { .. })
            ));
            assert!(matches!(
                consumer.ingest(&event(DownloadEventKind::Progress, "dl-y", 1, "2026-09-06T08:15:11.000Z")),
                Err(ConsumerError::IllegalSequence { .. })
            ));
            assert!(matches!(
                consumer.ingest(&event(DownloadEventKind::Started, "dl-z", 2, "2026-09-06T08:15:12.000Z")),
                Err(ConsumerError::IllegalSequence { .. })
            ));
        }

        #[test]
        fn stored_histories_that_could_not_occur_through_ingest_fold_to_errors() {
            let corrupted = vec![StoredDownloadEvent {
                event_id: 2,
                download_id: "dl-bad".into(),
                attempt: 1,
                kind: DownloadEventKind::Progress,
                source_url: String::new(),
                initiated_from_page_url: None,
                url_chain: None,
                suggested_file_name: None,
                stored_path: None,
                expected_bytes: None,
                received_bytes: Some(1),
                resumable: false,
                failure_kind: None,
                occurred_at: "2026-09-06T08:15:00.000Z".into(),
            }];
            assert!(matches!(
                fold_lifecycle("dl-bad", &corrupted),
                Err(ConsumerError::IllegalSequence { .. })
            ));
        }

        #[test]
        fn a_completed_delivery_without_its_schema_facts_is_refused_at_the_gate() {
            let store = store();
            let consumer = DownloadEventConsumer::new(&store);
            let id = "dl-nofacts";
            ingest_all(
                &consumer,
                &[event(DownloadEventKind::Started, id, 1, "2026-09-06T08:15:00.000Z")],
            );
            // A completed event without storedPath: the sequence would be
            // legal, but the frozen wire schema requires the delivery facts.
            let mut no_path = event(DownloadEventKind::Completed, id, 1, "2026-09-06T08:16:00.000Z");
            no_path.stored_path = None;
            assert!(matches!(
                consumer.ingest(&no_path),
                Err(ConsumerError::IllegalSequence { .. })
            ));
            // A completed event without receivedBytes is refused too.
            let mut no_size = event(DownloadEventKind::Completed, id, 1, "2026-09-06T08:16:01.000Z");
            no_size.received_bytes = None;
            assert!(matches!(
                consumer.ingest(&no_size),
                Err(ConsumerError::IllegalSequence { .. })
            ));
            assert_eq!(
                store.download_events(id).unwrap().len(),
                1,
                "schema-violating completions never reach the fact log"
            );
            // The well-formed completion still lands exactly as before.
            ingest_all(
                &consumer,
                &[with_received(
                    event(DownloadEventKind::Completed, id, 1, "2026-09-06T08:16:02.000Z"),
                    1024,
                )],
            );
            let lifecycle = consumer.lifecycle(id).unwrap().unwrap();
            assert_eq!(lifecycle.phase, DownloadPhase::TransferDone);
        }

        #[test]
        fn a_stored_completed_event_missing_its_facts_folds_to_a_typed_error() {
            let store = store();
            // Raw store appends carry no per-kind law (the consumer is the
            // gate) — this is exactly the shape a gate-hole row would have.
            let started = event(DownloadEventKind::Started, "dl-corrupt", 1, "2026-09-06T08:15:00.000Z");
            store.append_download_event(&started).unwrap();
            let mut completed = event(DownloadEventKind::Completed, "dl-corrupt", 1, "2026-09-06T08:16:00.000Z");
            completed.stored_path = None;
            store.append_download_event(&completed).unwrap();

            let consumer = DownloadEventConsumer::new(&store);
            // The manifest read folds to a typed error — never the old
            // panic on the schema-required fields.
            assert!(matches!(
                consumer.staging_completion("dl-corrupt"),
                Err(ConsumerError::IllegalSequence { .. })
            ));
            assert!(matches!(
                consumer.lifecycle("dl-corrupt"),
                Err(ConsumerError::IllegalSequence { .. })
            ));
        }
    }
}

//! LocalArtifact inspection — the AMF gate between transfer completion and
//! trusted content (download-events protocol v0.1: completed ≠ admitted).
//!
//! Hardened staging boundary (B4-b): the inspector never trusts a caller
//! supplied path. A download is inspected only through its completion-
//! manifest entry (`DownloadEventConsumer::staging_completion`) — the
//! request carries the manifest token plus the injected staging root, and
//! the stored path, reported size and suggested name all come from the
//! completed event. The pipeline then verifies, in order: canonicalized
//! root containment (junctions and redirected symlinks resolve away and
//! fail the check), a regular final component (symlinks rejected outright),
//! reported-size agreement, the policy size bound and the extension
//! allowlist — and only then streams the SHA-256, so an oversized file
//! never costs a full read. Mechanical rejections therefore never produce a
//! content-keyed row (there is no digest to key it); they surface as
//! `Rejected` outcomes for the acquisition task result, and the
//! content-keyed lifecycle starts at the digest. Verdicts stay idempotent
//! per content: re-inspecting an already-concluded artifact returns the
//! stored verdict instead of erroring.

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use vua_bdl_store::bdl_store::{
    ArtifactInspectionState, ArtifactRecordingOutcome, BdlStore, BdlStoreError, NewLocalArtifact,
    StoredArtifact,
};
use vua_bdl_store::download_events::{ConsumerError, DownloadEventConsumer};
use vua_orchestrator::Clock;

/// Inspection thresholds. The defaults map to the two material-intake v0.1
/// channels: direct `.unitypackage` and `.zip`-carried local VPM work.
#[derive(Debug, Clone)]
pub struct InspectionPolicy {
    pub max_bytes: u64,
    /// Lowercase extensions without the leading dot.
    pub allowed_extensions: Vec<String>,
}

impl Default for InspectionPolicy {
    fn default() -> Self {
        Self {
            max_bytes: 8 * 1024 * 1024 * 1024,
            allowed_extensions: ["unitypackage", "zip"]
                .iter()
                .map(|extension| extension.to_string())
                .collect(),
        }
    }
}

#[derive(Debug)]
pub enum InspectionError {
    Consumer(ConsumerError),
    Store(BdlStoreError),
    Io(std::io::Error),
    /// No completion-manifest entry: the download never completed, is still
    /// in flight, or already reached a terminal state.
    UnknownStagingCompletion(String),
    StagingTokenMismatch {
        download_id: String,
    },
    StagingRootMissing(PathBuf),
    StagingFileVanished(String),
    /// The staged final component is a symlink/reparse point; staging files
    /// are port-created regular files, so any link is tampering.
    StagingPathNotRegular {
        download_id: String,
        path: String,
    },
    /// Canonicalized path leaves the injected staging root.
    StagingPathEscape {
        download_id: String,
        path: String,
        root: PathBuf,
    },
    /// The staged file's real size disagrees with the completed delivery.
    ReportedSizeMismatch {
        download_id: String,
        reported: u64,
        actual: u64,
    },
}

impl From<std::io::Error> for InspectionError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<BdlStoreError> for InspectionError {
    fn from(error: BdlStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<ConsumerError> for InspectionError {
    fn from(error: ConsumerError) -> Self {
        Self::Consumer(error)
    }
}

impl std::fmt::Display for InspectionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Consumer(error) => write!(formatter, "{error}"),
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Io(error) => write!(formatter, "staging file failed: {error}"),
            Self::UnknownStagingCompletion(download_id) => {
                write!(
                    formatter,
                    "download {download_id} has no inspectable completion"
                )
            }
            Self::StagingTokenMismatch { download_id } => {
                write!(
                    formatter,
                    "download {download_id}: staging token does not match the completion manifest"
                )
            }
            Self::StagingRootMissing(root) => {
                write!(
                    formatter,
                    "expected staging root {} does not exist",
                    root.display()
                )
            }
            Self::StagingFileVanished(path) => {
                write!(formatter, "staged file {path} vanished before inspection")
            }
            Self::StagingPathNotRegular { download_id, path } => {
                write!(
                    formatter,
                    "download {download_id}: staged path {path} is a link, not a regular file"
                )
            }
            Self::StagingPathEscape {
                download_id,
                path,
                root,
            } => {
                write!(
                    formatter,
                    "download {download_id}: staged path {path} escapes the staging root {}",
                    root.display()
                )
            }
            Self::ReportedSizeMismatch {
                download_id,
                reported,
                actual,
            } => {
                write!(
                    formatter,
                    "download {download_id}: staged file is {actual} bytes, the completed delivery reported {reported}"
                )
            }
        }
    }
}

impl std::error::Error for InspectionError {}

/// The hardened inspection request: identity by manifest binding, never by
/// a caller-produced path.
pub struct DownloadInspectionRequest<'a> {
    pub staging_token: &'a str,
    pub download_id: &'a str,
    /// The VUA-managed staging directory injected into the port — the only
    /// place a completed download may live.
    pub expected_staging_root: &'a Path,
}

pub struct ArtifactInspector<'a> {
    store: &'a BdlStore,
    clock: &'a dyn Clock,
    policy: InspectionPolicy,
}

/// A mechanical (pre-digest) rejection: no artifact row exists, the staged
/// file should be discarded by the caller, and the reason belongs in the
/// acquisition task result.
#[derive(Debug, Clone, PartialEq)]
pub struct StagingRejection {
    pub download_id: String,
    pub size_bytes: u64,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DownloadInspectionOutcome {
    /// Mechanical checks passed and the content-keyed row was created and
    /// moved to `inspected` (or an earlier verdict for the same content was
    /// returned — inspection is idempotent per content).
    Inspected(StoredArtifact),
    Rejected(StagingRejection),
}

impl<'a> ArtifactInspector<'a> {
    pub fn new(store: &'a BdlStore, clock: &'a dyn Clock) -> Self {
        Self {
            store,
            clock,
            policy: InspectionPolicy::default(),
        }
    }

    pub fn with_policy(
        store: &'a BdlStore,
        clock: &'a dyn Clock,
        policy: InspectionPolicy,
    ) -> Self {
        Self {
            store,
            clock,
            policy,
        }
    }

    /// Inspect one completed download through its completion manifest.
    pub fn inspect_download(
        &self,
        request: &DownloadInspectionRequest<'_>,
    ) -> Result<DownloadInspectionOutcome, InspectionError> {
        self.inspect_delivery(request, true)
    }

    /// Library storage retains all formats. Passing this mechanical boundary
    /// is not admission to a production channel; format inspection is separate.
    pub fn inspect_download_for_storage(
        &self,
        request: &DownloadInspectionRequest<'_>,
    ) -> Result<DownloadInspectionOutcome, InspectionError> {
        self.inspect_delivery(request, false)
    }

    fn inspect_delivery(
        &self,
        request: &DownloadInspectionRequest<'_>,
        require_production_extension: bool,
    ) -> Result<DownloadInspectionOutcome, InspectionError> {
        let consumer = DownloadEventConsumer::new(self.store);
        let completion = consumer
            .staging_completion(request.download_id)?
            .ok_or_else(|| {
                InspectionError::UnknownStagingCompletion(request.download_id.to_string())
            })?;
        if completion.staging_token != request.staging_token {
            return Err(InspectionError::StagingTokenMismatch {
                download_id: request.download_id.to_string(),
            });
        }

        let canonical_root =
            std::fs::canonicalize(request.expected_staging_root).map_err(|error| {
                match error.kind() {
                    std::io::ErrorKind::NotFound => InspectionError::StagingRootMissing(
                        request.expected_staging_root.to_path_buf(),
                    ),
                    _ => InspectionError::Io(error),
                }
            })?;
        let staged = PathBuf::from(&completion.stored_path);
        let staged_link =
            std::fs::symlink_metadata(&staged).map_err(|error| match error.kind() {
                std::io::ErrorKind::NotFound => {
                    InspectionError::StagingFileVanished(completion.stored_path.clone())
                }
                _ => InspectionError::Io(error),
            })?;
        if staged_link.file_type().is_symlink() {
            return Err(InspectionError::StagingPathNotRegular {
                download_id: request.download_id.to_string(),
                path: completion.stored_path.clone(),
            });
        }
        let canonical_file =
            std::fs::canonicalize(&staged).map_err(|error| match error.kind() {
                std::io::ErrorKind::NotFound => {
                    InspectionError::StagingFileVanished(completion.stored_path.clone())
                }
                _ => InspectionError::Io(error),
            })?;
        if !canonical_file.starts_with(&canonical_root) {
            return Err(InspectionError::StagingPathEscape {
                download_id: request.download_id.to_string(),
                path: completion.stored_path.clone(),
                root: canonical_root,
            });
        }

        // Size from metadata first: verdict before a single content byte is
        // read, so an oversized file never costs a full streaming hash.
        let actual_size = staged_link.len();
        if actual_size != completion.reported_size_bytes {
            return Err(InspectionError::ReportedSizeMismatch {
                download_id: request.download_id.to_string(),
                reported: completion.reported_size_bytes,
                actual: actual_size,
            });
        }
        let rejection = if require_production_extension {
            mechanical_rejection(
                &self.policy,
                completion.suggested_file_name.as_deref(),
                &staged,
                actual_size,
            )
        } else if actual_size > self.policy.max_bytes {
            Some(format!(
                "size {actual_size} exceeds the allowed maximum {}",
                self.policy.max_bytes
            ))
        } else {
            None
        };
        if let Some(reason) = rejection {
            return Ok(DownloadInspectionOutcome::Rejected(StagingRejection {
                download_id: request.download_id.to_string(),
                size_bytes: actual_size,
                reason,
            }));
        }

        // All mechanical checks passed: digest, then the content-keyed
        // lifecycle (idempotent per content across re-downloads).
        let identity = format!("sha256:{}", hex_lower(&sha256_file(&staged)?));
        let now = self.clock.now_rfc3339();
        let recording = self.store.record_untrusted_artifact(&NewLocalArtifact {
            artifact_sha256: identity.clone(),
            size_bytes: actual_size,
            suggested_file_name: completion.suggested_file_name.clone(),
            download_id: Some(request.download_id.to_string()),
            first_seen_at: now.clone(),
        })?;
        if recording.outcome == ArtifactRecordingOutcome::Existing
            && recording.artifact.inspection_state != ArtifactInspectionState::Untrusted
        {
            return Ok(DownloadInspectionOutcome::Inspected(recording.artifact));
        }
        let artifact = self.store.transition_artifact(
            &identity,
            ArtifactInspectionState::Inspected,
            &now,
            None,
        )?;
        Ok(DownloadInspectionOutcome::Inspected(artifact))
    }

    /// AMF's admission decision after its own source and page-context
    /// cross-check. Keeps the original `inspected_at` verdict time.
    pub fn admit(&self, artifact_sha256: &str) -> Result<StoredArtifact, InspectionError> {
        Ok(self.store.transition_artifact(
            artifact_sha256,
            ArtifactInspectionState::Admitted,
            &self.clock.now_rfc3339(),
            None,
        )?)
    }
}

/// The shared mechanical (pre-digest) verdict behind the download staging
/// boundary and warehouse batch import: policy size bound first, then the
/// extension allowlist over the suggested name (falling back to the final
/// path component). A `Some` reason means the content is refused before any
/// byte is read or any row is keyed.
pub(crate) fn mechanical_rejection(
    policy: &InspectionPolicy,
    suggested_file_name: Option<&str>,
    fallback_path: &Path,
    size_bytes: u64,
) -> Option<String> {
    if size_bytes > policy.max_bytes {
        return Some(format!(
            "size {size_bytes} exceeds the allowed maximum {}",
            policy.max_bytes
        ));
    }
    let name = suggested_file_name
        .map(PathBuf::from)
        .or_else(|| Some(fallback_path.to_path_buf()));
    let extension = name
        .as_deref()
        .and_then(|path| path.extension())
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase());
    match extension {
        None => Some("file name carries no extension to allow-list".into()),
        Some(extension) if !policy.allowed_extensions.contains(&extension) => Some(format!(
            "extension \".{extension}\" is not in the allowed list"
        )),
        Some(_) => None,
    }
}

pub(crate) fn sha256_file(path: &Path) -> std::io::Result<[u8; 32]> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

pub(crate) fn hex_lower(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(char::from_digit(u32::from(byte >> 4), 16).expect("nibble"));
        output.push(char::from_digit(u32::from(byte & 0x0f), 16).expect("nibble"));
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::unique_dir;
    use vua_bdl_store::bdl_store::ArtifactInspectionState as StorageState;
    use vua_bdl_store::download_events::{
        DownloadEventKind, DownloadEventV01, DOWNLOAD_EVENT_SCHEMA_VERSION,
    };
    use vua_orchestrator::FixedClock;

    fn clock(readings: &[&str]) -> FixedClock {
        FixedClock::new(readings)
    }

    fn complete_download(
        consumer: &DownloadEventConsumer<'_>,
        download_id: &str,
        attempt: u32,
        stored_path: &Path,
        size: u64,
    ) {
        let occurred = format!("2026-09-06T08:15:0{attempt}.000Z");
        let suggested_file_name = stored_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        let started = DownloadEventV01 {
            schema_version: DOWNLOAD_EVENT_SCHEMA_VERSION.into(),
            kind: DownloadEventKind::Started,
            download_id: download_id.into(),
            attempt: 1,
            source_url: "https://booth.example.com/download/1000001/fixture".into(),
            initiated_from_page_url: None,
            url_chain: None,
            suggested_file_name,
            stored_path: Some(stored_path.to_string_lossy().into_owned()),
            expected_bytes: Some(size),
            received_bytes: Some(0),
            resumable: true,
            failure_kind: None,
            occurred_at: occurred.clone(),
        };
        let completed = DownloadEventV01 {
            kind: DownloadEventKind::Completed,
            attempt,
            received_bytes: Some(size),
            occurred_at: format!("2026-09-06T08:16:0{attempt}.000Z"),
            ..started.clone()
        };
        consumer.ingest(&started).unwrap();
        consumer.ingest(&completed).unwrap();
    }

    fn request<'a>(
        token: &'a str,
        download_id: &'a str,
        root: &'a Path,
    ) -> DownloadInspectionRequest<'a> {
        DownloadInspectionRequest {
            staging_token: token,
            download_id,
            expected_staging_root: root,
        }
    }

    #[test]
    fn passing_inspection_verifies_the_manifest_before_reading_content() {
        let store = BdlStore::open_in_memory().unwrap();
        let clock = clock(&["2026-09-06T08:16:30.000Z"]);
        let inspector = ArtifactInspector::new(&store, &clock);
        let consumer = DownloadEventConsumer::new(&store);
        let root = unique_dir("vua-inspect", "pass");
        let contents = b"PK\x03\x04 synthetic material fixture, not real product content";
        let staged = root.join("dl-1-1-material-pack.zip");
        std::fs::write(&staged, contents).unwrap();
        complete_download(&consumer, "dl-1", 1, &staged, contents.len() as u64);

        let grant = consumer.staging_completion("dl-1").unwrap().unwrap();
        let outcome = inspector
            .inspect_download(&request(&grant.staging_token, "dl-1", &root))
            .unwrap();
        let DownloadInspectionOutcome::Inspected(artifact) = outcome else {
            panic!("expected an inspected artifact");
        };
        let mut hasher = Sha256::new();
        hasher.update(contents);
        assert_eq!(
            artifact.artifact_sha256,
            format!("sha256:{}", hex_lower(&hasher.finalize()))
        );
        assert_eq!(artifact.size_bytes, contents.len() as u64);
        assert_eq!(artifact.inspection_state, StorageState::Inspected);
        assert_eq!(artifact.download_id.as_deref(), Some("dl-1"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn mechanical_rejections_happen_before_any_content_is_keyed() {
        let store = BdlStore::open_in_memory().unwrap();
        let clock = clock(&["2026-09-06T08:16:30.000Z"]);
        let policy = InspectionPolicy {
            max_bytes: 4,
            ..InspectionPolicy::default()
        };
        let inspector = ArtifactInspector::with_policy(&store, &clock, policy);
        let consumer = DownloadEventConsumer::new(&store);
        let root = unique_dir("vua-inspect", "reject");
        let staged = root.join("dl-1-1-material-pack.zip");
        std::fs::write(&staged, b"0123456789").unwrap();
        complete_download(&consumer, "dl-1", 1, &staged, 10);

        let grant = consumer.staging_completion("dl-1").unwrap().unwrap();
        let outcome = inspector
            .inspect_download(&request(&grant.staging_token, "dl-1", &root))
            .unwrap();
        let DownloadInspectionOutcome::Rejected(rejection) = outcome else {
            panic!("expected a size rejection");
        };
        assert!(
            rejection.reason.starts_with("size 10 exceeds"),
            "{}",
            rejection.reason
        );
        assert!(
            store
                .artifact(&format!(
                    "sha256:{}",
                    hex_lower(&{
                        let mut hasher = Sha256::new();
                        hasher.update(b"0123456789");
                        hasher.finalize()
                    })
                ))
                .unwrap()
                .is_none(),
            "a pre-digest rejection never creates a content-keyed row"
        );

        // Extension failures are mechanical too.
        let staged_exe = root.join("dl-2-1-pack.exe");
        std::fs::write(&staged_exe, b"tiny").unwrap();
        complete_download(&consumer, "dl-2", 1, &staged_exe, 4);
        let grant = consumer.staging_completion("dl-2").unwrap().unwrap();
        let outcome = inspector
            .inspect_download(&request(&grant.staging_token, "dl-2", &root))
            .unwrap();
        let DownloadInspectionOutcome::Rejected(rejection) = outcome else {
            panic!("expected an extension rejection");
        };
        assert_eq!(
            rejection.reason,
            "extension \".exe\" is not in the allowed list"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_staging_boundary_refuses_paths_that_are_not_the_manifests() {
        let store = BdlStore::open_in_memory().unwrap();
        let clock = clock(&["2026-09-06T08:16:30.000Z"]);
        let inspector = ArtifactInspector::new(&store, &clock);
        let consumer = DownloadEventConsumer::new(&store);
        let root = unique_dir("vua-inspect", "boundary");
        let inside = root.join("dl-1-1-material-pack.zip");
        std::fs::write(&inside, b"PK\x03\x04").unwrap();
        complete_download(&consumer, "dl-1", 1, &inside, 4);

        // A wrong token does not unlock the manifest entry.
        assert!(matches!(
            inspector.inspect_download(&request("stg1:forged", "dl-1", &root)),
            Err(InspectionError::StagingTokenMismatch { .. })
        ));

        // An unfinished download has no grant at all.
        assert!(matches!(
            inspector.inspect_download(&request("stg1:dl-x:1", "dl-x", &root)),
            Err(InspectionError::UnknownStagingCompletion(_))
        ));

        // A completed event pointing outside the injected root is refused
        // even though the file exists there.
        let outside_dir = unique_dir("vua-inspect", "outside");
        let outside = outside_dir.join("smuggled.zip");
        std::fs::write(&outside, b"PK\x03\x04").unwrap();
        complete_download(&consumer, "dl-2", 1, &outside, 4);
        let outside_grant = consumer.staging_completion("dl-2").unwrap().unwrap();
        assert!(matches!(
            inspector.inspect_download(&request(&outside_grant.staging_token, "dl-2", &root)),
            Err(InspectionError::StagingPathEscape { .. })
        ));

        // A reported size that disagrees with the real file is integrity
        // failure, not a verdict.
        let lying = root.join("dl-3-1-material-pack.zip");
        std::fs::write(&lying, b"PK").unwrap();
        complete_download(&consumer, "dl-3", 1, &lying, 400);
        let lying_grant = consumer.staging_completion("dl-3").unwrap().unwrap();
        assert!(matches!(
            inspector.inspect_download(&request(&lying_grant.staging_token, "dl-3", &root)),
            Err(InspectionError::ReportedSizeMismatch { .. })
        ));

        // A symlinked staging file is tampering, whatever it points to.
        #[cfg(windows)]
        {
            let link = root.join("dl-4-1-material-pack.zip");
            match std::os::windows::fs::symlink_file(&outside, &link) {
                Ok(()) => {
                    complete_download(&consumer, "dl-4", 1, &link, 4);
                    let link_grant = consumer.staging_completion("dl-4").unwrap().unwrap();
                    assert!(matches!(
                        inspector.inspect_download(&request(
                            &link_grant.staging_token,
                            "dl-4",
                            &root
                        )),
                        Err(InspectionError::StagingPathNotRegular { .. })
                    ));
                }
                Err(error)
                    if error.kind() == std::io::ErrorKind::PermissionDenied
                        || error.raw_os_error() == Some(1314) =>
                {
                    // 1314 = ERROR_PRIVILEGE_NOT_HELD: symlink creation needs
                    // a developer-mode/admin token this environment lacks.
                    eprintln!("skipping symlink case: {error}");
                }
                Err(error) => panic!("unexpected symlink error: {error}"),
            }
        }
        std::fs::remove_dir_all(&root).ok();
        std::fs::remove_dir_all(&outside_dir).ok();
    }

    #[test]
    fn inspection_is_idempotent_per_content_across_downloads() {
        let store = BdlStore::open_in_memory().unwrap();
        let clock = clock(&["2026-09-06T08:16:30.000Z"]);
        let inspector = ArtifactInspector::new(&store, &clock);
        let consumer = DownloadEventConsumer::new(&store);
        let root = unique_dir("vua-inspect", "idempotent");
        let contents = b"PK\x03\x04 identical content, second download";
        let first = root.join("dl-1-1-first.zip");
        let second = root.join("dl-2-1-second.zip");
        std::fs::write(&first, contents).unwrap();
        std::fs::write(&second, contents).unwrap();
        complete_download(&consumer, "dl-1", 1, &first, contents.len() as u64);
        complete_download(&consumer, "dl-2", 1, &second, contents.len() as u64);

        let first_grant = consumer.staging_completion("dl-1").unwrap().unwrap();
        let second_grant = consumer.staging_completion("dl-2").unwrap().unwrap();
        let DownloadInspectionOutcome::Inspected(first_artifact) = inspector
            .inspect_download(&request(&first_grant.staging_token, "dl-1", &root))
            .unwrap()
        else {
            panic!("expected the first inspection to pass");
        };
        let DownloadInspectionOutcome::Inspected(second_artifact) = inspector
            .inspect_download(&request(&second_grant.staging_token, "dl-2", &root))
            .unwrap()
        else {
            panic!("expected the re-download inspection to pass");
        };
        assert_eq!(
            first_artifact.artifact_sha256,
            second_artifact.artifact_sha256
        );
        assert_eq!(
            second_artifact.download_id.as_deref(),
            Some("dl-1"),
            "the original sighting row stays"
        );

        let admitted = inspector.admit(&first_artifact.artifact_sha256).unwrap();
        assert_eq!(admitted.inspection_state, StorageState::Admitted);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_missing_staging_file_or_root_is_an_error_not_a_verdict() {
        let store = BdlStore::open_in_memory().unwrap();
        let clock = clock(&["2026-09-06T08:16:30.000Z"]);
        let inspector = ArtifactInspector::new(&store, &clock);
        let consumer = DownloadEventConsumer::new(&store);
        let root = unique_dir("vua-inspect", "vanished");
        let staged = root.join("dl-1-1-material-pack.zip");
        std::fs::write(&staged, b"PK\x03\x04").unwrap();
        complete_download(&consumer, "dl-1", 1, &staged, 4);
        std::fs::remove_file(&staged).unwrap();
        let grant = consumer.staging_completion("dl-1").unwrap().unwrap();
        assert!(matches!(
            inspector.inspect_download(&request(&grant.staging_token, "dl-1", &root)),
            Err(InspectionError::StagingFileVanished(_))
        ));
        std::fs::remove_dir_all(&root).ok();

        let root2 = unique_dir("vua-inspect", "rootless");
        std::fs::write(root2.join("dl-2-1-material-pack.zip"), b"PK\x03\x04").unwrap();
        complete_download(
            &consumer,
            "dl-2",
            1,
            &root2.join("dl-2-1-material-pack.zip"),
            4,
        );
        let grant = consumer.staging_completion("dl-2").unwrap().unwrap();
        let gone = root2.join("no-such-root");
        assert!(matches!(
            inspector.inspect_download(&request(&grant.staging_token, "dl-2", &gone)),
            Err(InspectionError::StagingRootMissing(_))
        ));
        std::fs::remove_dir_all(&root2).ok();
    }
}

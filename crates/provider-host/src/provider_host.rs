//! Transport adapter for the supervised Orchestrator Provider process.

use vua_unity_bridge::{
    MaterialCancelToken, MaterialExecutionStatus, MaterialExecutor, RollbackOutcome,
};
use vua_orchestrator::{
    MaterialEntryMode, RecipeDocumentStore, RiskDecisionChoice, SourceFolderInspectionV01,
};
use vua_unity_bridge::{
    MaterialIntakeConfirmationV01, MaterialIntakeEngine, MaterialIntakePlanV01, RiskDecisionV01,
};
use vua_unity_bridge::MaterialTaskResult;
use vua_orchestrator::{
    DependenciesListByProductParams, DependenciesLookupParams, DependenciesParamsError,
    ProjectRef, PackageRequestV1, VpmBackend,
};
use vua_project_manager::{
    acquire_project_lock, apply_import_copy, begin_mutation, collect_environment_managers_snapshot,
    collect_project_inspections, plan_import_copy, read_pending_mutation, set_note,
    verify_editor_path_system, EditorPathRefusal, EditorPathVerdict, ImportCopyRequest, LockHolder,
    ManagerRoots,
    MutationMarkerGuard, PendingMutation, ProjectInspectionV01, ProjectLockError, ProjectLockGuard,
    SetNoteError, MARKER_FILE_NAME,
    PROJECT_INSPECTION_SCHEMA_VERSION as PROJECT_INSPECTION_FAMILY_VERSION,
};
use vua_bdl_store::download_events::{
    fold_lifecycle, retry_decision, ConsumerError, DownloadEventConsumer, DownloadEventV01,
    IngestOutcome, RetryDecision,
};
use vua_orchestrator::{
    AppErrorV1, BuildRecordStore, EnvironmentEngine, EnvironmentRoots, ErrorCategory,
    IdempotentCancellation,
    IdempotentTaskAcceptance, NanosTaskIdGenerator, NewTask, OverlayReadModel, ProjectIdentity,
    SqliteStoreError,
    SqliteTaskStore, StoredTask, StoredTaskEvent, StoreOverlayReadModel, SystemClock,
    TaskEventKind, TaskMutation,
    TaskRuntime, TaskState,
};
use vua_bdl_store::{
    ArtifactMode, BdlStore, BdlStoreError, CatalogListParams, CatalogParamsError,
    BDL_QUERIES_SCHEMA_VERSION,
};
use vua_orchestrator::ParamValue;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const PROVIDER_FRAME_VERSION: &str = "0.1";
const APPLICATION_CONTRACT_VERSION: &str = "0.1";
const MAX_FRAME_BYTES: u64 = 1024 * 1024;

#[derive(Debug)]
pub enum ProviderHostError {
    Io(std::io::Error),
    Store(SqliteStoreError),
    Encode(serde_json::Error),
    OversizedFrame,
    AlreadyRunning,
}

impl std::fmt::Display for ProviderHostError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "Provider I/O failed: {error}"),
            Self::Store(error) => write!(formatter, "Provider store failed: {error}"),
            Self::Encode(error) => write!(formatter, "Provider frame encoding failed: {error}"),
            Self::OversizedFrame => formatter.write_str("Provider frame exceeded one MiB"),
            Self::AlreadyRunning => formatter.write_str("another Provider already owns this store"),
        }
    }
}

impl std::error::Error for ProviderHostError {}

impl From<std::io::Error> for ProviderHostError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<SqliteStoreError> for ProviderHostError {
    fn from(error: SqliteStoreError) -> Self {
        Self::Store(error)
    }
}

impl From<serde_json::Error> for ProviderHostError {
    fn from(error: serde_json::Error) -> Self {
        Self::Encode(error)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InboundFrame {
    frame_version: String,
    frame_id: String,
    kind: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutboundFrame<'a> {
    frame_version: &'static str,
    frame_id: &'a str,
    kind: &'a str,
    payload: Value,
}

struct HostState {
    store: Arc<SqliteTaskStore>,
    provider_instance_id: String,
    recovered_nonterminal_tasks: HashSet<String>,
    production: Option<Arc<ProductionServices>>,
    downloads: Option<Arc<DownloadServices>>,
    warehouse: Option<Arc<WarehouseServices>>,
    use_cases: Option<Arc<ProductionUseCaseServices>>,
    project_ops: Option<Arc<ProjectOpsServices>>,
    environment: Option<Arc<EnvironmentServices>>,
    /// In-session events published by the driven task runtimes (warehouse /
    /// project-ops) awaiting wire emission. Drained by the frame loop; the
    /// same store-backed events also persist, this channel only adds the
    /// notification frame so Gateway consumers re-query authoritative
    /// snapshots (contract "revision 与事件"). It is also the ONLY carrier of
    /// `PersistenceFailed`, which by definition never persists.
    runtime_events: Arc<Mutex<Vec<StoredTaskEvent>>>,
    /// The VPM engine face (proposal 024 P1, `packages.listInstalled`).
    /// Absent wiring answers a typed `vua.packages.unavailable` — honest
    /// absence, never a fabricated or padded listing.
    vpm: Option<Arc<dyn VpmBackend>>,
    /// The `environment.verifyEditor` verification face (proposal 021
    /// routing batch). Not an Option: the primitive is a stateless direct
    /// call with no service dependency, so the route is always wired —
    /// there is no honest absence path and the absence code stays
    /// reserved (see ENVIRONMENT_VERIFY_UNAVAILABLE).
    editor_verify: EditorPathVerifier,
}

/// B4/F4-4 download acquisition wiring. When absent, every `download.*`
/// method answers a typed `unavailable` error — honest absence, never a
/// silent success (same discipline as production.*).
pub struct DownloadConfig {
    /// The BDL local database the download consumer folds events into.
    pub bdl: Arc<BdlStore>,
}

/// B4 warehouse maintenance wiring (proposal 005): roots and the global
/// default mode are provider-side runtime configuration and never travel the
/// wire; the wire params carry only the warehouse item id and (for
/// setArtifactMode) the per-entry override.
#[derive(Clone)]
pub struct WarehouseConfig {
    /// The BDL local database the warehouse commands operate on.
    pub bdl: Arc<BdlStore>,
    /// The warehouse root the generate-VPM staging/publish flow writes under.
    pub warehouse_root: PathBuf,
    /// The shell-level default artifact mode (override resolution stays
    /// dynamic: per-entry override ?? this default).
    pub global_default: ArtifactMode,
    /// The real Unity conversion executor for `warehouse.generateVpm`
    /// (same source as the production wiring). When absent, generation
    /// answers a typed unavailable error while the other two commands and
    /// the read face keep working — honest absence, never a silent success.
    pub executor: Option<Arc<MaterialExecutor>>,
    /// The bdl-queries v0.5 dependencies read face (proposal 030 §5.7
    /// case A; the core `DependenciesQueriesPort` trait). Absent = both
    /// `dependencies.*` methods answer the family's typed honest absence —
    /// never a fabricated match or observation. The REAL query executor
    /// (reading the BDL library) is a later data/production-domain
    /// implementation ring: until an adapter overrides the defaulted
    /// `dependencies_capabilities` accessor (declared-none default, the
    /// 025 `catalog_capabilities` law) the served row and both routes stay
    /// honestly unavailable even when a port object is wired.
    pub dependencies_queries: Option<Arc<dyn vua_orchestrator::DependenciesQueriesPort>>,
}

struct WarehouseServices {
    bdl: Arc<BdlStore>,
    warehouse_root: PathBuf,
    global_default: ArtifactMode,
    executor: Option<Arc<MaterialExecutor>>,
    /// The bdl-queries v0.5 dependencies read face (the core
    /// `DependenciesQueriesPort` trait). Absent, or present with the
    /// defaulted declared-none capability, = both `dependencies.*` routes
    /// answer the family's honest absence — never a fabricated match.
    dependencies_queries: Option<Arc<dyn vua_orchestrator::DependenciesQueriesPort>>,
    /// The tasked commands (generateVpm / deleteOriginals) run on the SQLite
    /// task authority: existing nonterminal tasks register for explicit
    /// Inspect/recovery and are never resumed implicitly.
    runtime: TaskRuntime,
}

/// Project-domain write-command wiring (proposal 014, `project.import-copy`):
/// the server-side guards read VCC/ALCOM registration facts through the
/// environment-manager readers, the copy plan/apply run inside the
/// project-manager library, and the tasked execution rides the shared SQLite
/// task authority. Absent wiring answers a typed `vua.project.unavailable` —
/// honest absence, never a silent success.
/// Environment detection wiring (BG-16): the read-only
/// `environment.getSnapshot` consumes `EnvironmentEngine::inspect_all()`
/// through this configuration. `None` (the legacy entry) keeps the honest
/// empty-items snapshot — "the detection face is not wired" is itself the
/// honest empty, never a ready verdict.
#[derive(Clone)]
pub struct EnvironmentConfig {
    /// Unity Hub editors root and the rest of the probe targets
    /// (`EnvironmentRoots::default()` is the production shape).
    pub roots: EnvironmentRoots,
    /// VCC `settings.json` candidates the managers snapshot reads.
    pub vcc_settings_candidates: Vec<std::path::PathBuf>,
}

struct EnvironmentServices {
    deployment: vua_orchestrator::deployment::DeploymentService,
    engine: EnvironmentEngine,
}

#[derive(Clone)]
pub struct ProjectOpsConfig {
    /// VCC `settings.json` candidates in priority order (the
    /// registered-project guard reads the association facts from these).
    pub vcc_settings_candidates: Vec<PathBuf>,
    /// Manager roots (ALCOM settings candidates) for the same guard face.
    pub manager_roots: ManagerRoots,
    /// Unity Hub editor roots the environment-managers snapshot observes.
    pub editor_roots: Vec<PathBuf>,
}

struct ProjectOpsServices {
    vcc_settings_candidates: Arc<Vec<PathBuf>>,
    manager_roots: ManagerRoots,
    editor_roots: Arc<Vec<PathBuf>>,
    runtime: TaskRuntime,
}

/// project-inspection v0.1 is the frozen command face the project query
/// word list travels as (the snapshot family itself is v0.2 per the core
/// routing stance — the query envelope version and the snapshot family
/// version are independent).
const PROJECT_INSPECTION_SCHEMA_VERSION: &str = "0.1";

/// inspection-queries v0.1 word-list-row family version (proposal 016 data
/// review 2026-09-13): every reply of the family (get/list/requestRun) cites
/// its own row version, never the evidence-body version it reads nor the
/// bdl-commands family the tasked-command reply shape is borrowed from.
const INSPECTION_QUERIES_SCHEMA_VERSION: &str = "0.1";

/// editor-verify v0.1 word-list-row family version (proposal 021 core
/// ruling 2026-09-13, nail 3): the `environment.verifyEditor` reply cites
/// its own row version as the envelope const — never the primitive's crate
/// version, never another family's version (the c914cf2 lesson, now a
/// standing rule: every wire row carries a version constant of its own).
/// Published so wire consumers key on the core-owned constant, never a
/// private literal.
pub const EDITOR_VERIFY_SCHEMA_VERSION: &str = "0.1";

/// The honest absence code reserved by ruling point 5 for an unwired route
/// / unreachable primitive ONLY. The verifyEditor route calls a stateless
/// direct primitive, so this route has no absence path today; the code
/// stays a protocol-face registration — published so consumers key on the
/// core-owned constant instead of a private literal — and is never reused
/// as a verification refusal (refusals travel the result state, nail 1).
pub const ENVIRONMENT_VERIFY_UNAVAILABLE: &str = "vua.environment.verify_unavailable";

/// The release-handoff family version constant — a re-export of the
/// core-owned constant (v0.2: the U19 record-state gate + the independent
/// `release.openForInspection` entry, 2026-09-21; v0.1 was the single
/// `release.openForHandoff` row frozen 2026-09-16). One source of truth:
/// route responses key on the core constant, never a private literal.
pub use vua_orchestrator::RELEASE_HANDOFF_SCHEMA_VERSION;

/// The two typed rejection codes the U19 record-state gate answers with
/// (v0.2). `record_state_blocked` carries the record's original state as
/// the `state` param; `record_state_unknown` answers a missing or
/// unparseable status. Published as constants so tests and consumers key
/// on named facts, never inline literals.
pub const RELEASE_HANDOFF_RECORD_STATE_BLOCKED: &str = "vua.release_handoff.record_state_blocked";
pub const RELEASE_HANDOFF_RECORD_STATE_UNKNOWN: &str = "vua.release_handoff.record_state_unknown";

/// The honest absence code for the `release.openForHandoff` route while the
/// production-domain process/window port and the core use case are unwired
/// (a later slice). Unlike verifyEditor this route has a REAL absence path
/// today: params are validated first (a closed-set violation answers
/// `vua.release_handoff.invalid_params` — a shape violation never masquerades
/// as an absence), then the unwired capability answers this code. It never
/// folds into a fabricated acceptance, task snapshot, or handoff fact (the
/// upload happens in the official SDK and is never a VUA fact to guess at).
pub const RELEASE_HANDOFF_UNAVAILABLE: &str = "vua.release_handoff.unavailable";

/// The `packages.query` word-list-row family version constant (proposal 024
/// P1 freeze batch 2026-09-17; the c914cf2 standing rule — every wire row
/// carries a version constant of its own). Published so wire consumers key
/// on the core-owned constant, never a private literal.
pub const PACKAGES_QUERY_SCHEMA_VERSION: &str = "0.1";

/// The honest absence code for the `packages.*` routes while no `VpmBackend`
/// is assembled (proposal 024 P1). It never folds into a fabricated or
/// padded listing — an empty array is a real backend fact only.
pub const PACKAGES_UNAVAILABLE: &str = "vua.packages.unavailable";

/// The `packages-installed` v0.1 result family constant (proposal 024 P1
/// freeze batch 2026-09-17; the c914cf2 standing rule — every wire row
/// carries a version constant of its own, independent of the envelope
/// const). The route stamps it at envelope assembly, never the backend.
/// Named at the F3 wiring batch (2026-09-20) when the route grew the
/// dual-version negotiation arms — extracting the P1-era inline literal
/// changes no word-face byte (the same string the frozen v0.1 result
/// schema locks), it only gives the frozen v0.1 generation its own
/// core-owned constant beside the v0.2 one.
pub const PACKAGES_INSTALLED_SCHEMA_VERSION_V01: &str = "vua.packages-installed/v0.1";

/// The `packages-installed` v0.2 result family constant (proposal 027 F3
/// freeze batch 2026-09-20: the installed-set update-awareness increment,
/// new family version — the frozen v0.1 word face is never revised in
/// place). The route serves this family exactly when the backend declares
/// `query_v02` (additive dual-version negotiation, ORC-DEV-004: the
/// `catalog_v02` precedent — backends that have not adopted v0.2 keep
/// answering the frozen v0.1 family above). The envelope stays on the
/// shared `packages` word-list-row `0.1` const (the frozen v0.2 command
/// schema locks the ENVELOPE schemaVersion to "0.1" — the catalog v0.2
/// increment precedent); the result carries this family const — two
/// independent versions (the c914cf2 standing rule). The route stamps it
/// at envelope assembly, never the backend.
pub const PACKAGES_INSTALLED_SCHEMA_VERSION_V02: &str = "vua.packages-installed/v0.2";

/// The `packages-repos` v0.1 result family constant (proposal 025 P2 freeze
/// batch 2026-09-17; the c914cf2 standing rule — every wire row carries a
/// version constant of its own, independent of the envelope const). The
/// route stamps it at envelope assembly, never the backend.
pub const PACKAGES_REPOS_SCHEMA_VERSION: &str = "vua.packages-repos/v0.1";

/// The `packages-catalog` v0.1 result family constant (proposal 025 P2
/// freeze batch 2026-09-17; the c914cf2 standing rule). The route stamps it
/// at envelope assembly, never the backend.
pub const PACKAGES_CATALOG_SCHEMA_VERSION: &str = "vua.packages-catalog/v0.1";

/// The `packages-catalog` v0.2 result family constant (proposal 025 inline
/// ruling 2026-09-17: the cacheSourced disclosure increment, new family
/// version — the frozen v0.1 word face is never revised in place). The
/// route serves this family exactly when the backend declares `catalog_v02`
/// (additive dual-version negotiation: backends that have not adopted v0.2
/// keep answering the frozen v0.1 family below).
pub const PACKAGES_CATALOG_SCHEMA_VERSION_V02: &str = "vua.packages-catalog/v0.2";

/// The `packages-repo-catalog` v0.1 result family constant (proposal 027 F2
/// freeze batch 2026-09-20; the c914cf2 standing rule — every wire row
/// carries a version constant of its own, independent of the envelope
/// const). The route stamps it at envelope assembly, never the backend.
pub const PACKAGES_REPO_CATALOG_SCHEMA_VERSION_V01: &str = "vua.packages-repo-catalog/v0.1";

/// The `packages` envelope const of the repo-catalog v0.1 word-face row
/// (named at this wiring batch per the A3/A4/A5 precedent: the frozen v0.1
/// command schema locks the ENVELOPE schemaVersion to "0.1" — the same
/// word-list-row generation as the P1/P2 read faces' shared const, carried
/// as its OWN named constant so wire consumers key on the core-owned
/// constant, never a private literal; the c914cf2 standing rule).
pub const PACKAGES_REPO_CATALOG_ENVELOPE_SCHEMA_VERSION_V01: &str = "0.1";

/// The `packages-templates` v0.1 result family constant (proposal 027 F5
/// freeze batch 2026-09-20, named at this wiring batch per the
/// A3/A4/A5/F2/F3 precedent; the c914cf2 standing rule — every wire row
/// carries a version constant of its own, independent of the envelope
/// const). The route stamps it at envelope assembly, never the backend.
pub const PACKAGES_TEMPLATES_SCHEMA_VERSION_V01: &str = "vua.packages-templates/v0.1";

/// The `packages` envelope const of the templates v0.1 word-face row
/// (named at this wiring batch per the A3/A4/A5/F2 precedent: the frozen
/// v0.1 command schema locks the ENVELOPE schemaVersion to "0.1" — the same
/// word-list-row generation as the P1/P2 read faces' shared const, carried
/// as its OWN named constant so wire consumers key on the core-owned
/// constant, never a private literal; the c914cf2 standing rule).
pub const PACKAGES_TEMPLATES_ENVELOPE_SCHEMA_VERSION_V01: &str = "0.1";

/// The `packages-ops` v0.1 result family constant (proposal 026 A1 freeze
/// batch 2026-09-19; the c914cf2 standing rule — every wire row carries a
/// version constant of its own, independent of the envelope const). The
/// route stamps it at envelope assembly, never the backend; the envelope
/// itself stays on the shared `packages` word-list-row `0.1` const.
pub const PACKAGES_OPS_SCHEMA_VERSION: &str = "vua.packages-ops/v0.1";

/// The `packages-ops` v0.2 result family constant (proposal 026 A2 freeze
/// batch 2026-09-19; same standing rule — the install/upgrade row carries
/// its own version constant, and the frozen v0.1 A1 removal row keeps
/// serving through `PACKAGES_OPS_SCHEMA_VERSION` untouched: two separate
/// word-face generations served side by side).
pub const PACKAGES_OPS_SCHEMA_VERSION_V02: &str = "vua.packages-ops/v0.2";

/// The `packages` envelope const of the v0.2 word-face row (the frozen v0.2
/// result schema locks the ENVELOPE schemaVersion to "0.2" — unlike the
/// catalog v0.2 increment, the packages-ops v0.2 row directory carries its
/// own envelope generation; the v0.1 A1 envelope stays on "0.1").
pub const PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V02: &str = "0.2";

/// The `packages-ops` v0.3 result family constant (proposal 026 A3 freeze
/// batch 2026-09-19; same standing rule — the local-package registration
/// row carries its own version constant, and the frozen v0.1 A1 removal
/// row and v0.2 A2 install row keep serving through their own consts
/// untouched: three separate word-face generations served side by side).
pub const PACKAGES_OPS_SCHEMA_VERSION_V03: &str = "vua.packages-ops/v0.3";

/// The `packages` envelope const of the v0.3 word-face row (the frozen
/// v0.3 result schema locks the ENVELOPE schemaVersion to "0.3"; the v0.1
/// and v0.2 envelopes stay on their own consts — the c914cf2 standing
/// rule: every wire row carries a version constant of its own, independent
/// of the envelope const).
pub const PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V03: &str = "0.3";

/// The `packages-ops` v0.4 result family constant (proposal 026 A4 freeze
/// batch 2026-09-19; same standing rule — the repository add/remove row
/// carries its own version constant, and the frozen v0.1 A1 removal row,
/// v0.2 A2 install row and v0.3 A3 registration row keep serving through
/// their own consts untouched: four separate word-face generations served
/// side by side).
pub const PACKAGES_OPS_SCHEMA_VERSION_V04: &str = "vua.packages-ops/v0.4";

/// The `packages` envelope const of the v0.4 word-face row (the frozen
/// v0.4 result schema locks the ENVELOPE schemaVersion to "0.4"; the v0.1,
/// v0.2 and v0.3 envelopes stay on their own consts — the c914cf2 standing
/// rule: every wire row carries a version constant of its own, independent
/// of the envelope const).
pub const PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V04: &str = "0.4";

/// The `packages-ops` v0.5 result family constant (proposal 026 A5 freeze
/// batch 2026-09-19, wiring named it per the A3/A4 precedent; same standing
/// rule — the project-creation row carries its own version constant, and
/// the frozen v0.1 A1 removal row, v0.2 A2 install row, v0.3 A3
/// registration row and v0.4 A4 repository add/remove row keep serving
/// through their own consts untouched: five separate word-face generations
/// served side by side).
pub const PACKAGES_OPS_SCHEMA_VERSION_V05: &str = "vua.packages-ops/v0.5";

/// The `packages` envelope const of the v0.5 word-face row (the frozen
/// v0.5 result schema locks the ENVELOPE schemaVersion to "0.5"; the v0.1
/// through v0.4 envelopes stay on their own consts — the c914cf2 standing
/// rule: every wire row carries a version constant of its own, independent
/// of the envelope const).
pub const PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V05: &str = "0.5";

/// The `packages-ops` v0.6 result family constant (proposal 027 F4 freeze
/// batch 2026-09-20, wiring named it per the A3/A4/A5 precedent; same
/// standing rule — the repository-lifecycle row carries its own version
/// constant, and the frozen v0.1 A1 removal row, v0.2 A2 install row,
/// v0.3 A3 registration row, v0.4 A4 repository add/remove row and v0.5
/// A5 project-creation row keep serving through their own consts
/// untouched: six separate word-face generations served side by side).
pub const PACKAGES_OPS_SCHEMA_VERSION_V06: &str = "vua.packages-ops/v0.6";

/// The `packages` envelope const of the v0.6 word-face row (the frozen
/// v0.6 result schema locks the ENVELOPE schemaVersion to "0.6"; the v0.1
/// through v0.5 envelopes stay on their own consts — the c914cf2 standing
/// rule: every wire row carries a version constant of its own, independent
/// of the envelope const).
pub const PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V06: &str = "0.6";

/// The `packages-repos` v0.2 result family constant (proposal 027 F4 freeze
/// batch 2026-09-20, wiring named it per the installed/catalog v0.2
/// precedent): the subscription-list increment rows carry the REQUIRED
/// VUA-owned `enabled` state bit (ruling (c) — VCC carries no enable
/// counterpart, so the bit projects VUA-owned storage, never a
/// settings.json key). The COMMAND face stays byte-for-byte the frozen
/// v0.1 face and the ENVELOPE stays on the shared `packages` word-list-row
/// `"0.1"` const — the v0.2 family const is a RESULT-document fact only
/// (the F3 installed-increment law: two independent versions, the stamped
/// const tells the consumer which word face answered, never a guess).
pub const PACKAGES_REPOS_SCHEMA_VERSION_V02: &str = "vua.packages-repos/v0.2";

/// The recipe-export v0.1 ENVELOPE version constant (proposal 029 B-face
/// wiring loop 2, core batch 2026-09-22; the F5 templates wiring precedent):
/// the frozen `schemas/recipe-export/v0.1/command.schema.json` locks this
/// envelope generation — carried as its OWN named constant so consumers key
/// on the core-owned constant, never a private literal. Independent of the
/// family const below (the c914cf2 standing rule: every wire row carries a
/// version constant of its own).
pub const RECIPE_EXPORT_ENVELOPE_SCHEMA_VERSION_V01: &str = "0.1";

/// The recipe-export v0.1 RESULT family constant: the draft document carries
/// `vua.recipe-export/v0.1` as its own family const — the route stamps it at
/// envelope assembly (the repoCatalog P1 discipline: the route stamps the
/// consts, the port facts stay verbatim), and the word face is ZERO byte
/// change: the constant locks exactly the string the frozen result schema
/// carries.
pub const RECIPE_EXPORT_SCHEMA_VERSION_V01: &str = "vua.recipe-export/v0.1";

/// Injectable verification face for the `environment.verifyEditor` route:
/// the production composition defaults to the primitive's system wiring
/// (`verify_editor_path_system`, whose non-Windows behavior is the
/// `unsupported_platform` refusal); wire tests inject a deterministic
/// identity source so the verified branch is testable without a real PE
/// version resource. The route itself carries zero verification logic —
/// it maps the verdict onto the frozen two-state result, nothing else.
pub type EditorPathVerifier = Arc<dyn Fn(&Path) -> EditorPathVerdict + Send + Sync>;

struct DownloadServices {
    bdl: Arc<BdlStore>,
    /// Per-download monotonic intent sequence (AMF-issued, Main-side dedup
    /// key). In-memory only: intents concern live downloads, and a provider
    /// restart leaves no live downloads behind (orphan discipline).
    intent_seqs: Mutex<std::collections::HashMap<String, u64>>,
    /// Outbound Provider -> Main intent notifications, drained by the frame
    /// loop as ordinary event frames (the same ordering channel as events).
    pending_intents: Mutex<Vec<serde_json::Value>>,
}

impl DownloadServices {
    fn next_intent(&self, download_id: &str, intent: &str) -> serde_json::Value {
        let mut intents = self.intent_seqs.lock().expect("download intents poisoned");
        let seq = intents.entry(download_id.to_owned()).or_insert(0);
        *seq += 1;
        serde_json::json!({
            "kind": "download.intent",
            "downloadId": download_id,
            "intent": intent,
            "intentSeq": *seq,
        })
    }

    fn queue_intent(&self, download_id: &str, intent: &str) -> u64 {
        let payload = self.next_intent(download_id, intent);
        let seq = payload["intentSeq"].as_u64().unwrap_or(0);
        self.pending_intents
            .lock()
            .expect("pending intents poisoned")
            .push(payload);
        seq
    }
}

/// W20 production-use-case v0.2 wiring (recipe/plan/job/record command
/// face): when absent, every `recipe.*` method answers a typed
/// `unavailable` error — honest absence, never a silent success. The
/// recipe document store is the AMF production-domain document store
/// (011 convergence decision 1; never BDL).
#[derive(Clone)]
pub struct ProductionUseCaseConfig {
    pub recipes: Arc<RecipeDocumentStore>,
    pub plans: Arc<vua_orchestrator::PlanDocumentStore>,
    pub evidence: Arc<vua_orchestrator::EvidenceStore>,
    pub records: Arc<vua_orchestrator::RecipeRecordStore>,
    /// M7 inspection slice (proposal 016, hard precondition 2): the AMF
    /// production-domain store for inspection-evidence documents (never
    /// BDL) and the editor version the configured Bridge executable
    /// declares (path-observed, "unknown" when the path carries none — the
    /// evidence states what ran, it never invents).
    pub inspections: Arc<vua_orchestrator::InspectionEvidenceStore>,
    pub editor_version: String,
    /// The Bridge the orchestrated jobs execute through (the M5 smoke
    /// target project is provider configuration, not wire state).
    pub bridge: Arc<dyn vua_orchestrator::UnityBridge>,
    /// The Unity project root the approved plan executes against.
    pub project_root: PathBuf,
    /// The assembly-face editor selection (U10 slice, proposal 021 stance
    /// 2 + 4): what this provider will ACTUALLY use. The explicit
    /// injection releases execution; the auto-selected production target
    /// is presentation + precheck observation only until the desktop
    /// gate-3 first-use confirmation exists. The job.execute environment
    /// precheck consumes this decision instead of re-enumerating the Hub
    /// root — the Hub enumeration stays the environment-snapshot fact
    /// source (009 stance 4 ② semantics preserved through the selection).
    pub editor_selection: vua_orchestrator::EditorSelection,
    /// The production-domain process/window port for the official-SDK
    /// upload handoff (proposal 023 follow-up slice 1's contract, frozen
    /// as the core `ReleaseHandoffPort` trait). Since the 023 assembly
    /// slice the default provider assembly wires the REAL adapter
    /// (`EditorHandoffAdapter`: probe/launch/handshake-wait/focus over the
    /// production-domain `EditorHandoffPort`), so `vua.release_handoff.
    /// unavailable` converges to the explicitly port-less assembly's
    /// exception path. Absent = the route answers the frozen honest
    /// absence — nothing here fabricates an acceptance receipt, a task
    /// snapshot, or a handoff fact.
    pub handoff: Option<Arc<dyn vua_orchestrator::ReleaseHandoffPort>>,
    /// The recipe-export v0.1 port face (proposal 029 B-face wiring loop 2,
    /// the core `ProjectDraftExportPort` trait): the synchronous read-only
    /// `recipe.exportProjectDraft` Query derives a Recipe project DRAFT
    /// from one registered Unity project. Absent = the route answers the
    /// frozen honest absence `vua.recipe_export.unavailable` — never a
    /// fabricated draft (ruling 2: the draft is its own type; promotion is
    /// only ever the user-confirmed recipe.save chain). The REAL export
    /// executor is the NEXT loop's implementation slice: until an adapter
    /// overrides the defaulted `export_capabilities` accessor (declared-
    /// none default, the 025 `catalog_capabilities` law) the served row and
    /// the route stay honestly unavailable even when a port object is
    /// wired.
    pub draft_exporter: Option<Arc<dyn vua_orchestrator::ProjectDraftExportPort>>,
}

struct ProductionUseCaseServices {
    recipes: Arc<RecipeDocumentStore>,
    plans: Arc<vua_orchestrator::PlanDocumentStore>,
    records: Arc<vua_orchestrator::RecipeRecordStore>,
    inspections: Arc<vua_orchestrator::InspectionEvidenceStore>,
    editor_version: String,
    bridge: Arc<dyn vua_orchestrator::UnityBridge>,
    project_root: PathBuf,
    editor_selection: vua_orchestrator::EditorSelection,
    /// Proposal 023 follow-up slice 1's contract (the core
    /// `ReleaseHandoffPort` trait). Absent = the route answers the frozen
    /// honest absence — never a fabricated handoff. The default assembly
    /// (provider binary) wires the real `EditorHandoffAdapter` since the
    /// 023 assembly slice.
    handoff: Option<Arc<dyn vua_orchestrator::ReleaseHandoffPort>>,
    /// Proposal 029 B-face wiring loop 2 (the core
    /// `ProjectDraftExportPort` trait): the `recipe.exportProjectDraft`
    /// synchronous read-only Query. Absent, or present with the defaulted
    /// declared-none capability, = the route answers the frozen honest
    /// absence `vua.recipe_export.unavailable` — never a fabricated draft.
    draft_exporter: Option<Arc<dyn vua_orchestrator::ProjectDraftExportPort>>,
    /// W23 production-evidence store — consumed by the Local Resolution
    /// executor (next cut).
    #[allow(dead_code)]
    evidence: Arc<vua_orchestrator::EvidenceStore>,
    /// The shared SQLite task authority and BDL come with the warehouse
    /// wiring; the tasked half (recipe.resolve / job.execute) answers a
    /// typed unavailable without them, while the document faces (save/get/
    /// list/approve) work standalone. Consumed from the next cut on.
    #[allow(dead_code)]
    runtime: Option<TaskRuntime>,
    #[allow(dead_code)]
    bdl: Option<Arc<BdlStore>>,
    #[allow(dead_code)]
    env_initial: Option<ArtifactMode>,
}

/// Production use-case wiring (production-use-case v0.1): when absent, every
/// `production.*` method answers a typed `unavailable` error — honest
/// absence, never a silent success.
pub struct ProductionConfig {
    pub executor: Arc<MaterialExecutor>,
    pub records: Arc<BuildRecordStore>,
}

struct ProductionServices {
    executor: Arc<MaterialExecutor>,
    records: Arc<BuildRecordStore>,
    engine: MaterialIntakeEngine,
    running: Mutex<HashMap<String, MaterialCancelToken>>,
    completed_events: Mutex<Vec<StoredTaskEvent>>,
}

struct ProviderInstanceLock {
    _file: File,
}

impl ProviderInstanceLock {
    fn acquire(database_path: &Path) -> Result<Self, ProviderHostError> {
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut lock_name = database_path.as_os_str().to_os_string();
        lock_name.push(".provider.lock");
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(PathBuf::from(lock_name))?;
        if let Err(error) = file.try_lock() {
            return Err(match error {
                std::fs::TryLockError::WouldBlock => ProviderHostError::AlreadyRunning,
                std::fs::TryLockError::Error(error) => ProviderHostError::Io(error),
            });
        }
        Ok(Self { _file: file })
    }
}

/// Runs the bounded JSONL protocol until stdin closes or shutdown commits.
/// Stdout is protocol-only; diagnostics belong on stderr in the binary shell.
pub fn run_provider_host(
    input: impl BufRead + Send + 'static,
    output: impl Write,
    database_path: impl AsRef<Path>,
) -> Result<(), ProviderHostError> {
    run_provider_host_with(input, output, database_path, None)
}

/// Same protocol with the production use-case surface wired to concrete
/// services (material intake executor + build record store).
pub fn run_provider_host_with(
    input: impl BufRead + Send + 'static,
    output: impl Write,
    database_path: impl AsRef<Path>,
    production: Option<ProductionConfig>,
) -> Result<(), ProviderHostError> {
    run_provider_host_with_downloads(input, output, database_path, production, None)
}

/// The download-capable entry: when `downloads` is configured, the host
/// serves `download.ingest` / `download.retry` and emits download intents
/// over the event channel.
pub fn run_provider_host_with_downloads(
    input: impl BufRead + Send + 'static,
    output: impl Write,
    database_path: impl AsRef<Path>,
    production: Option<ProductionConfig>,
    downloads: Option<DownloadConfig>,
) -> Result<(), ProviderHostError> {
    run_provider_host_with_services(input, output, database_path, production, downloads, None, None)
}

/// The full entry: additionally wires the B4 warehouse command trio
/// (proposal 005, `warehouse.setArtifactMode` / `warehouse.generateVpm` /
/// `warehouse.deleteOriginals`). When `warehouse` is configured the tasked
/// commands run on the SQLite task authority over the same store.
pub fn run_provider_host_with_services(
    input: impl BufRead + Send + 'static,
    output: impl Write,
    database_path: impl AsRef<Path>,
    production: Option<ProductionConfig>,
    downloads: Option<DownloadConfig>,
    warehouse: Option<WarehouseConfig>,
    use_cases: Option<ProductionUseCaseConfig>,
) -> Result<(), ProviderHostError> {
    run_provider_host_full(
        input,
        output,
        database_path,
        production,
        downloads,
        warehouse,
        use_cases,
        None,
        None,
        None,
        None,
    )
}

/// The full entry: additionally wires the project-domain write command face
/// (proposal 014, `project.import-copy`). When `project_ops` is absent the
/// `project.*` methods answer a typed `vua.project.unavailable`. When
/// `editor_verifier` is absent the `environment.verifyEditor` route uses the
/// primitive's system wiring (`verify_editor_path_system`). When `vpm` is
/// absent the `packages.*` methods answer a typed `vua.packages.unavailable`
/// (proposal 024 P1) — honest absence, never a fabricated listing.
#[allow(clippy::too_many_arguments)]
pub fn run_provider_host_full(
    input: impl BufRead + Send + 'static,
    mut output: impl Write,
    database_path: impl AsRef<Path>,
    production: Option<ProductionConfig>,
    downloads: Option<DownloadConfig>,
    warehouse: Option<WarehouseConfig>,
    use_cases: Option<ProductionUseCaseConfig>,
    project_ops: Option<ProjectOpsConfig>,
    environment: Option<EnvironmentConfig>,
    editor_verifier: Option<EditorPathVerifier>,
    vpm: Option<Arc<dyn VpmBackend>>,
) -> Result<(), ProviderHostError> {
    let database_path = database_path.as_ref();
    let _instance_lock = ProviderInstanceLock::acquire(database_path)?;
    let store = Arc::new(SqliteTaskStore::open(database_path)?);
    let provider_instance_id = provider_instance_id();
    let recovered_nonterminal_tasks: HashSet<String> = store
        .tasks()?
        .into_iter()
        .filter(|task| !task.state.is_terminal())
        .map(|task| task.task_id)
        .collect();
    store.mark_other_owners_interrupted(&provider_instance_id, &now_rfc3339())?;

    // A previous process may have died with tasks mid-flight. They are
    // failed as interrupted (recoverable) — never silently resumed; per
    // the recovery discipline the next mutation must Inspect first. The
    // sweep covers every tasked face the host runs (production tasks and
    // the demo task face alike — BOARD #20: a DEV-only face is not exempt
    // from honest state presentation; a dead process's task must never
    // keep reading as running).
    for task in store.tasks()? {
        if (task.task_id.starts_with("prod-") || task.task_id.starts_with("demo-"))
            && !task.state.is_terminal()
            && recovered_nonterminal_tasks.contains(&task.task_id)
        {
            let error = AppErrorV1::new(
                "vua.task.interrupted",
                ErrorCategory::ExternalFailure,
                "errors.task.interrupted",
                &task.correlation_id,
            )
            .with_recoverable(true);
            let _ = advance_production_task(
                &store,
                &task.task_id,
                TaskMutation::Complete {
                    state: if matches!(task.state, TaskState::Queued | TaskState::Preparing) {
                        TaskState::Cancelled
                    } else {
                        TaskState::Failed
                    },
                    error: if matches!(task.state, TaskState::Queued | TaskState::Preparing) {
                        None
                    } else {
                        Some(error)
                    },
                    result: None,
                },
            );
        }
    }

    let production = production.map(|config| {
        Arc::new(ProductionServices {
            executor: config.executor,
            records: config.records,
            engine: MaterialIntakeEngine,
            running: Mutex::new(HashMap::new()),
            completed_events: Mutex::new(Vec::new()),
        })
    });
    let downloads = downloads.map(|config| {
        Arc::new(DownloadServices {
            bdl: config.bdl,
            intent_seqs: Mutex::new(std::collections::HashMap::new()),
            pending_intents: Mutex::new(Vec::new()),
        })
    });
    let warehouse = warehouse
        .map(|config| {
            TaskRuntime::with_sqlite(
                store.clone(),
                Arc::new(SystemClock),
                Arc::new(NanosTaskIdGenerator::default()),
            )
            .map(|runtime| {
                Arc::new(WarehouseServices {
                    bdl: config.bdl,
                    warehouse_root: config.warehouse_root,
                    global_default: config.global_default,
                    executor: config.executor,
                    dependencies_queries: config.dependencies_queries,
                    runtime,
                })
            })
        })
        .transpose()?;
    // The use-case face reuses the warehouse task authority and BDL (Local
    // Resolution reads warehouse facts) — both are required together.
    let use_cases = use_cases.map(|config| {
        let (bdl, runtime, env_initial) = warehouse
            .as_ref()
            .map(|warehouse| {
                (
                    Some(warehouse.bdl.clone()),
                    Some(warehouse.runtime.clone()),
                    Some(warehouse.global_default),
                )
            })
            .unwrap_or((None, None, None));
        Arc::new(ProductionUseCaseServices {
            recipes: config.recipes,
            plans: config.plans,
            records: config.records,
            inspections: config.inspections,
            editor_version: config.editor_version,
            evidence: config.evidence,
            bridge: config.bridge,
            project_root: config.project_root,
            editor_selection: config.editor_selection,
            handoff: config.handoff,
            draft_exporter: config.draft_exporter,
            bdl,
            runtime,
            env_initial,
        })
    });
    let project_ops = project_ops
        .map(|config| {
            TaskRuntime::with_sqlite(
                store.clone(),
                Arc::new(SystemClock),
                Arc::new(NanosTaskIdGenerator::default()),
            )
            .map(|runtime| {
                Arc::new(ProjectOpsServices {
                    vcc_settings_candidates: Arc::new(config.vcc_settings_candidates),
                    manager_roots: config.manager_roots,
                    editor_roots: Arc::new(config.editor_roots),
                    runtime,
                })
            })
        })
        .transpose()?;
    let environment = environment.map(|config| -> Result<_, SqliteStoreError> {
        Ok(Arc::new(EnvironmentServices {
            deployment: vua_orchestrator::deployment::DeploymentService::new(
                Arc::new(vua_project_manager::deployment_adapter::WindowsDeploymentAdapter::new(config.roots.clone())),
                TaskRuntime::with_sqlite(store.clone(), Arc::new(SystemClock), Arc::new(NanosTaskIdGenerator::default()))?),
            engine: EnvironmentEngine::new(
                Arc::new(vua_orchestrator::StdProcessRunner),
                Arc::new(SystemClock),
                config.roots,
                Arc::new(vua_project_manager::VccSettingsFileReader),
            ),
        }))
    }).transpose()?;
    // Proposal 021 routing batch: the default verification face is the
    // primitive's own system wiring — the route adds the wire mapping
    // only, never verification logic of its own.
    let editor_verify: EditorPathVerifier = editor_verifier.unwrap_or_else(|| {
        Arc::new(|input: &Path| verify_editor_path_system(input))
    });
    let mut state = HostState {
        store,
        provider_instance_id,
        use_cases,
        recovered_nonterminal_tasks,
        production,
        downloads,
        warehouse,
        project_ops,
        environment,
        editor_verify,
        vpm,
        runtime_events: Arc::new(Mutex::new(Vec::new())),
    };

    // Runtime event forwarding (poisoned visibility + warehouse/project-ops
    // task notifications): one reader thread per driven runtime pushes
    // published events into the shared queue; the frame loop drains it within
    // its 100ms wake tick. The threads end with the process; the queue is
    // bounded in practice by the runtimes' low-frequency event discipline.
    {
        let sink = state.runtime_events.clone();
        let mut driven_runtimes: Vec<vua_orchestrator::TaskRuntime> = Vec::new();
        if let Some(warehouse) = &state.warehouse {
            driven_runtimes.push(warehouse.runtime.clone());
        }
        if let Some(project_ops) = &state.project_ops {
            driven_runtimes.push(project_ops.runtime.clone());
        }
        if let Some(environment) = &state.environment { driven_runtimes.push(environment.deployment.runtime.clone()); }
        for runtime in driven_runtimes {
            let sink = sink.clone();
            // Register before dispatch starts: even a short deployment/manual handoff must
            // publish acceptance and progress without a subscriber-thread startup race.
            let receiver = runtime.subscribe();
            std::thread::spawn(move || {
                for event in receiver {
                    let stored = StoredTaskEvent {
                        task_id: event.task_id,
                        revision: event.revision,
                        kind: event.kind,
                        state: event.state,
                        occurred_at: event.occurred_at,
                        correlation_id: event.correlation_id,
                        payload: event.payload,
                    };
                    sink.lock()
                        .expect("runtime events poisoned")
                        .push(stored);
                }
            });
        }
    }

    // The reader runs on its own thread so the host can wake up between
    // frames: worker completion events reach an idle Gateway without it
    // having to send another request first.
    let (line_sender, line_receiver) = std::sync::mpsc::channel::<std::io::Result<Vec<u8>>>();
    std::thread::spawn(move || {
        let mut input = input;
        loop {
            let mut line = Vec::new();
            // The frame budget is re-established for EVERY frame: a
            // single cumulative Take would treat ~1 MiB of total session
            // traffic as EOF and silently end the protocol.
            let read = {
                let mut limited =
                    std::io::Read::take(input.by_ref(), MAX_FRAME_BYTES + 1);
                std::io::BufRead::read_until(&mut limited, b'\n', &mut line)
            };
            match read {
                Ok(0) => break,
                Ok(_) => {
                    if line_sender.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(error) => {
                    let _ = line_sender.send(Err(error));
                    break;
                }
            }
        }
    });

    loop {
        write_pending_events(&mut state, &mut output)?;
        let mut line = match line_receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(line)) => line,
            Ok(Err(error)) => return Err(ProviderHostError::Io(error)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                write_pending_events(&mut state, &mut output)?;
                // Intents queued by the LAST frame still go out before the
                // host exits — ordering never strands a port intent.
                if let Some(downloads) = &state.downloads {
                    let mut intents = downloads
                        .pending_intents
                        .lock()
                        .expect("pending intents poisoned");
                    for payload in intents.drain(..) {
                        let frame_id = format!(
                            "download-intent-{}-{}",
                            payload["downloadId"].as_str().unwrap_or("?"),
                            payload["intentSeq"].as_u64().unwrap_or(0)
                        );
                        write_frame(&mut output, &frame_id, "event", payload)?;
                    }
                }
                break;
            }
        };
        if line.len() as u64 > MAX_FRAME_BYTES {
            return Err(ProviderHostError::OversizedFrame);
        }
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        // demo.task deterministic progression: one stage per received frame,
        // holding at running awaiting cancellation; events are written before
        // this frame's response (notifications of fact, queries stay authoritative)
        let mut pending_events = advance_demo_tasks(&mut state)?;
        // production workers finish in their own threads; their persisted
        // events drain here and go out as ordinary event frames.
        if let Some(services) = &state.production {
            let mut guard = services
                .completed_events
                .lock()
                .expect("completed events poisoned");
            pending_events.extend(guard.drain(..));
            drop(guard);
        }
        pending_events.extend(drain_runtime_events(&state));
        for event in pending_events {
            let event_id = format!("sqlite-{}-{}", event.task_id, event.revision);
            write_frame(&mut output, &event_id, "event", task_event(&event_id, &event))?;
        }
        if let Some(downloads) = &state.downloads {
            let mut intents = downloads
                .pending_intents
                .lock()
                .expect("pending intents poisoned");
            for payload in intents.drain(..) {
                let frame_id = format!(
                    "download-intent-{}-{}",
                    payload["downloadId"].as_str().unwrap_or("?"),
                    payload["intentSeq"].as_u64().unwrap_or(0)
                );
                write_frame(&mut output, &frame_id, "event", payload)?;
            }
        }
        let frame = match serde_json::from_slice::<InboundFrame>(&line) {
            Ok(frame) => frame,
            Err(_) => {
                write_frame(
                    &mut output,
                    "invalid",
                    "protocol_error",
                    json!({"code": "vua.provider.invalid_frame"}),
                )?;
                continue;
            }
        };
        if frame.frame_version != PROVIDER_FRAME_VERSION || frame.frame_id.is_empty() {
            write_frame(
                &mut output,
                &frame.frame_id,
                "protocol_error",
                json!({"code": "vua.provider.unsupported_frame_version"}),
            )?;
            continue;
        }

        let outcome = handle_frame(&mut state, &frame)?;
        match outcome {
            FrameOutcome::Response(payload) => {
                write_frame(&mut output, &frame.frame_id, "response", payload)?;
            }
            FrameOutcome::ProtocolError(payload) => {
                write_frame(&mut output, &frame.frame_id, "protocol_error", payload)?;
            }
            FrameOutcome::ResponseAndEvent { response, event } => {
                write_frame(&mut output, &frame.frame_id, "response", response)?;
                write_frame(&mut output, &event.0, "event", event.1)?;
            }
            FrameOutcome::Exit(payload) => {
                state.store.checkpoint()?;
                write_frame(&mut output, &frame.frame_id, "response", payload)?;
                break;
            }
        }
    }
    Ok(())
}

pub(crate) enum FrameOutcome {
    Response(Value),
    ProtocolError(Value),
    ResponseAndEvent {
        response: Value,
        event: (String, Value),
    },
    Exit(Value),
}

fn handle_frame(
    state: &mut HostState,
    frame: &InboundFrame,
) -> Result<FrameOutcome, ProviderHostError> {
    Ok(match frame.kind.as_str() {
        // Handshake wire shape is frozen by schemas/orchestrator/provider-frame-v0.1
        // (proposal 001): the request payload must be null; anything else is an
        // illegal frame and is answered with protocol_error, never a handshake.
        "handshake" if frame.payload.is_null() => FrameOutcome::Response(json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "supportedContractVersions": [APPLICATION_CONTRACT_VERSION],
            "providerBuildId": env!("CARGO_PKG_VERSION"),
            "providerInstanceId": state.provider_instance_id,
            "downloadIngest": state.downloads.is_some(),
        })),
        "handshake" => FrameOutcome::ProtocolError(json!({
            "code": "vua.provider.invalid_handshake",
        })),
        "request" => handle_application_request(state, &frame.payload),
        "prepare_shutdown" => wait_for_safe_boundary(state, shutdown_timeout(&frame.payload)),
        "continue_shutdown" => continue_shutdown(state, &frame.payload)?,
        _ => FrameOutcome::Response(json!({
            "code": "vua.provider.unknown_frame_kind",
        })),
    })
}

fn continue_shutdown(
    state: &mut HostState,
    payload: &Value,
) -> Result<FrameOutcome, ProviderHostError> {
    match payload.get("decision").and_then(Value::as_str) {
        Some("wait") => Ok(wait_for_safe_boundary(state, shutdown_timeout(payload))),
        Some("force") => {
            let user_decision_id = payload
                .get("userDecisionId")
                .and_then(Value::as_str)
                .unwrap_or("");
            if user_decision_id.trim().is_empty() {
                return Ok(FrameOutcome::Response(json!({
                    "code": "vua.provider.force_requires_user_decision",
                })));
            }
            let interrupted_tasks = blocking_tasks(state)?;
            state
                .store
                .mark_owner_interrupted(&state.provider_instance_id, &now_rfc3339())?;
            Ok(FrameOutcome::Exit(json!({
                "contractVersion": APPLICATION_CONTRACT_VERSION,
                "outcome": "forced",
                "userDecisionId": user_decision_id,
                "interruptedTasks": interrupted_tasks,
            })))
        }
        _ => Ok(FrameOutcome::Response(json!({
            "code": "vua.provider.invalid_shutdown_decision",
        }))),
    }
}

fn shutdown_timeout(payload: &Value) -> Duration {
    Duration::from_millis(
        payload
            .get("timeoutMs")
            .and_then(Value::as_u64)
            .filter(|timeout| *timeout > 0)
            .unwrap_or(1),
    )
}

fn wait_for_safe_boundary(state: &HostState, timeout: Duration) -> FrameOutcome {
    let started = Instant::now();
    loop {
        match blocking_tasks(state) {
            Ok(blocking_tasks) if blocking_tasks.is_empty() => {
                return FrameOutcome::Exit(json!({
                    "contractVersion": APPLICATION_CONTRACT_VERSION,
                    "outcome": "safe_to_stop",
                    "blockingTasks": [],
                }));
            }
            Ok(blocking_tasks) if started.elapsed() >= timeout => {
                return FrameOutcome::Response(json!({
                    "contractVersion": APPLICATION_CONTRACT_VERSION,
                    "outcome": "needs_user_choice",
                    "blockingTasks": blocking_tasks,
                }));
            }
            Err(_) => {
                return FrameOutcome::Response(json!({
                    "code": "vua.provider.persistence_failed",
                }));
            }
            _ => {
                let remaining = timeout.saturating_sub(started.elapsed());
                std::thread::sleep(remaining.min(Duration::from_millis(25)));
            }
        }
    }
}

fn blocking_tasks(state: &HostState) -> Result<Vec<Value>, SqliteStoreError> {
    let mut tasks = Vec::new();
    // A queued deployment already owns future machine side effects. Only this runtime's
    // live jobs block shutdown; recovered jobs are inspect-required and never resume.
    if let Some(environment) = &state.environment {
        for task in environment.deployment.runtime.snapshot_all() {
            if !task.state.is_terminal() && task.recovery_disposition == vua_orchestrator::TaskRecoveryDisposition::None {
                tasks.push(json!({"taskId": task.task_id, "revision": task.revision, "state": state_name(task.state)}));
            }
        }
    }
    // A registered production task blocks shutdown even BEFORE its
    // worker acquired the lease (the spawn window) — a safe_to_stop
    // verdict must never race a mutation that is about to start.
    if let Some(services) = &state.production {
        let running = services.running.lock().expect("running poisoned");
        for task_id in running.keys() {
            if let Some(task) = state.store.task(task_id)? {
                if !task.state.is_terminal() {
                    tasks.push(json!({
                        "taskId": task.task_id,
                        "revision": task.revision,
                        "state": state_name(task.state),
                    }));
                }
            }
        }
    }
    for lease in state.store.project_leases()? {
        if lease.owner_instance_id != state.provider_instance_id || lease.recovery_required {
            continue;
        }
        if let Some(task) = state.store.task(&lease.task_id)? {
            if !task.state.is_terminal() {
                tasks.push(json!({
                    "taskId": task.task_id,
                    "revision": task.revision,
                    "state": state_name(task.state),
                }));
            }
        }
    }
    Ok(tasks)
}

fn handle_application_request(state: &mut HostState, request: &Value) -> FrameOutcome {
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("invalid");
    let correlation_id = request
        .get("correlationId")
        .and_then(Value::as_str)
        .unwrap_or("invalid");
    if request.get("contractVersion").and_then(Value::as_str) != Some(APPLICATION_CONTRACT_VERSION)
    {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unsupported_contract",
            "errors.provider.unsupportedContract",
            "validation",
        ));
    }
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    if method.starts_with("production.") {
        return production_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("download.") {
        return download_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("catalog.") {
        return catalog_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("dependencies.") {
        // bdl-queries v0.5 (proposal 030 §5.7 case A): its own method
        // prefix inside the bdl-queries family — the route arms reuse the
        // family's existing codes, zero new registrations.
        return dependencies_query_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("downloads.") {
        return downloads_query_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("recipe.") {
        // Proposal 029 B-face loop 2: the export face is its own word-row
        // family (recipe-export, ruling 3) with its OWN honest-absence code
        // `vua.recipe_export.unavailable` — it must not fold into the
        // `vua.recipe.unavailable` document-face absence, so it dispatches
        // BEFORE the use-case document-face fold.
        if method == "recipe.exportProjectDraft" {
            return recipe_export_request(state, request, request_id, correlation_id);
        }
        return recipe_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("plan.") {
        let Some(use_cases) = state.use_cases.clone() else {
            return plan_unavailable(request_id, correlation_id);
        };
        return plan_request(use_cases, method, request, request_id, correlation_id);
    }
    if method.starts_with("job.") {
        let Some(use_cases) = state.use_cases.clone() else {
            return job_unavailable(state, request_id, correlation_id);
        };
        return match method {
            "job.execute" => job_execute(use_cases, request, request_id, correlation_id),
            _ => job_unavailable(state, request_id, correlation_id),
        };
    }
    if method.starts_with("record.") {
        let Some(use_cases) = state.use_cases.clone() else {
            return record_unavailable(request_id, correlation_id);
        };
        return record_request(use_cases, method, request, request_id, correlation_id);
    }
    if method.starts_with("inspection.") {
        let Some(use_cases) = state.use_cases.clone() else {
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.inspection.unavailable",
                "errors.inspection.unavailable",
                "unavailable",
            ));
        };
        return inspection_request(use_cases, method, request, request_id, correlation_id);
    }
    if method.starts_with("warehouse.") {
        return warehouse_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("project.") {
        return project_request(state, method, request, request_id, correlation_id);
    }
    if method.starts_with("packages.") {
        return packages_request(state, method, request, request_id, correlation_id);
    }
    if matches!(method, "environment.planDeployment" | "environment.executeDeployment") {
        return crate::deployment_routes::request(state.environment.as_ref().map(|s| &s.deployment), method, request, request_id, correlation_id);
    }
    let outcome = (|| -> Result<FrameOutcome, SqliteStoreError> {
        match method {
            "application.getSnapshot" => Ok(FrameOutcome::Response(application_success(
                request_id,
                json!({
                    "contractVersion": APPLICATION_CONTRACT_VERSION,
                    "revision": state.store.application_revision()?,
                    "capabilities": {"revision": 0, "operations": served_capabilities(state)},
                }),
            ))),
            "task.list" => {
                let tasks = state
                    .store
                    .tasks()?
                    .iter()
                    .map(|task| task_snapshot(state, task))
                    .collect::<Vec<_>>();
                Ok(FrameOutcome::Response(application_success(
                    request_id,
                    json!({
                        "contractVersion": APPLICATION_CONTRACT_VERSION,
                        "revision": state.store.application_revision()?,
                        "tasks": tasks,
                    }),
                )))
            }
            "task.get" => {
                let task_id = request
                    .pointer("/params/taskId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                match state.store.task(task_id)? {
                    Some(task) => Ok(FrameOutcome::Response(application_success(
                        request_id,
                        task_snapshot(state, &task),
                    ))),
                    None => Ok(FrameOutcome::Response(application_error(
                        request_id,
                        correlation_id,
                        "vua.task.not_found",
                        "errors.task.notFound",
                        "validation",
                    ))),
                }
            }
            "task.requestCancellation" => handle_cancellation(state, request, request_id),
            "environment.getSnapshot" => environment_get_snapshot(state, request_id),
            "environment.verifyEditor" => {
                environment_verify_editor(state, request, request_id, correlation_id)
            }
            "task.startDemo" => Ok(handle_start_demo(state, request, request_id, correlation_id)),
            "overlay.getSnapshot" => overlay_get_snapshot(state, request, request_id, correlation_id),
            "release.openForHandoff" => {
                release_open_for_handoff(state, request, request_id, correlation_id)
            }
            "release.openForInspection" => {
                release_open_for_inspection(state, request, request_id, correlation_id)
            }
            _ => Ok(FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.provider.unknown_method",
                "errors.provider.unknownMethod",
                "validation",
            ))),
        }
    })();
    outcome.unwrap_or_else(|error: SqliteStoreError| {
        FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            store_error_code(&error),
            "errors.provider.persistence",
            store_error_category(&error),
        ))
    })
}

/// Kernel-side derivation source for the Gateway boolean capabilities and the
/// entry visibility (contract operation-level Capability). demo.task leaves the
/// production capability table once the F3 real use-case command lands.
fn deployment_capability(state: &HostState, operation: &str) -> Value {
    if state.environment.is_some() {
        json!({"operationId": operation, "availability": "available"})
    } else {
        json!({"operationId": operation, "availability": "unavailable", "reason":
            application_error("capability", "corr-capability-deployment", "vua.deployment.unavailable",
                "errors.deployment.failed", "unavailable")["error"]})
    }
}

fn served_capabilities(state: &HostState) -> Value {
    let production_availability = if state.production.is_some() {
        "available"
    } else {
        "unavailable"
    };
    let recipe_availability = if state.use_cases.is_some() {
        "available"
    } else {
        "unavailable"
    };
    let project_ops_availability = if state.project_ops.is_some() {
        "available"
    } else {
        "unavailable"
    };
    // Proposal 024 P1: the packages read face rides the VpmBackend wiring —
    // honest absence when the assembly injects no engine.
    let packages_availability = if state.vpm.is_some() {
        "available"
    } else {
        "unavailable"
    };
    // Proposal 025 P2: the catalog read faces ride the SAME VpmBackend
    // wiring but the SEPARATE catalog capability declaration (default
    // declared-none) — an engine wired without the P2 implementation keeps
    // both rows honestly unavailable until its backend overrides
    // `catalog_capabilities` (the environment implementation slice).
    let packages_catalog_availability = match state.vpm.as_ref() {
        Some(vpm) if vpm.catalog_capabilities().catalog => "available",
        _ => "unavailable",
    };
    // Proposal 026 A1: the removal write face rides the SAME VpmBackend
    // wiring, gated on the port's `remove_packages` capability bit (the
    // frozen command schema's serving gate). One row serves both methods
    // (previewRemove/applyRemove share the gate); a wired engine whose
    // backend declares no removal capability keeps the row honestly
    // unavailable.
    let packages_ops_availability = match state.vpm.as_ref() {
        Some(vpm) if vpm.capabilities().remove_packages => "available",
        _ => "unavailable",
    };
    // Proposal 026 A2: the install/upgrade write face rides the SAME
    // VpmBackend wiring, gated on the port's `preview_install` capability
    // bit (the frozen v0.2 command schema's serving gate; the removeOps
    // one-row-serves-both-methods precedent — previewInstall/applyInstall
    // share this gate).
    let packages_install_ops_availability = match state.vpm.as_ref() {
        Some(vpm) if vpm.capabilities().preview_install => "available",
        _ => "unavailable",
    };
    // Proposal 026 A3: the local-package registration write face rides the
    // SAME VpmBackend wiring, gated on the NEW defaulted accessor
    // `register_capabilities` (the frozen v0.3 command schema's serving
    // gate; the removeOps/installOps one-row precedent — the single
    // registerLocalPackage method answers through this row). Default
    // declared-none keeps the row honestly unavailable until the
    // environment implementation-verification slice flips it with the
    // VrcGetLib override.
    let packages_register_ops_availability = match state.vpm.as_ref() {
        Some(vpm) if vpm.register_capabilities().register_local_package => "available",
        _ => "unavailable",
    };
    // Proposal 026 A4: the repository add/remove write face rides the SAME
    // VpmBackend wiring, gated on the NEW defaulted accessor
    // `repo_write_capabilities` — one row serving the THREE methods
    // (removeOps/installOps/registerOps one-row precedent), but the honest
    // gate stays PER METHOD: the row answers available when the backend
    // declares ANY of the three independent bits (a partially-overriding
    // backend must not have its served methods hidden behind a face-level
    // row), while each route independently answers the generic
    // capability-missing arm for its own bit BEFORE submit. Default
    // declared-none keeps the row honestly unavailable until the
    // environment implementation-verification slice flips it with the
    // VrcGetLib override.
    let packages_repo_ops_availability = match state.vpm.as_ref() {
        Some(vpm) if {
            let repo = vpm.repo_write_capabilities();
            repo.add_remote_repo || repo.add_local_repo || repo.remove_repo
        } =>
        {
            "available"
        }
        _ => "unavailable",
    };
    // Proposal 026 A5: the project-creation write face rides the SAME
    // VpmBackend wiring, gated on the EXISTING five-bit
    // `capabilities().create_project` member — one row serving the ONE
    // method (the removeOps/installOps/registerOps/repoOps one-row
    // precedent). A5 freezes NO new accessor, unlike A3/A4: the bit
    // predates the freeze batch and both in-repo backends already declare
    // it honestly, so unlike the A4 row there is no declared-none default
    // waiting for an environment override — a wired backend with the bit
    // true answers available as of this wiring batch.
    let packages_create_ops_availability = match state.vpm.as_ref() {
        Some(vpm) if vpm.capabilities().create_project => "available",
        _ => "unavailable",
    };
    // Proposal 027 F2: the repo-catalog read face rides the SAME VpmBackend
    // wiring, gated on the NEW defaulted accessor `repo_catalog_capabilities`
    // (the frozen v0.1 command schema's serving gate; the A4 accessor law —
    // default declared-none keeps the row honestly unavailable until the
    // environment implementation-verification slice flips it with the
    // VrcGetLib override; the CLI backend has no repo-scale listing and
    // stays honestly false). One row serving the ONE method
    // (removeOps/installOps/registerOps/repoOps/createOps one-row
    // precedent).
    let packages_repo_catalog_availability = match state.vpm.as_ref() {
        Some(vpm) if vpm.repo_catalog_capabilities().repo_catalog => "available",
        _ => "unavailable",
    };
    // Proposal 027 F5 (wired at this batch): the template-enumeration read
    // face rides the SAME VpmBackend wiring, gated on the NEW defaulted
    // accessor `template_capabilities` (the frozen v0.1 command schema's
    // serving gate; the F2 repo-catalog accessor law — default declared-none
    // keeps the row honestly unavailable until the environment
    // implementation-verification slice flips it with the VrcGetLib
    // override; the CLI backend has no directory-root scan face and stays
    // honestly false). One row serving the ONE method
    // (removeOps/installOps/registerOps/repoOps/createOps/repoCatalogOps
    // one-row precedent).
    let packages_templates_availability = match state.vpm.as_ref() {
        Some(vpm) if vpm.template_capabilities().list_templates => "available",
        _ => "unavailable",
    };
    // Proposal 027 F4 (wired at this batch): the repository-lifecycle write
    // face rides the SAME VpmBackend wiring, gated on the NEW defaulted
    // accessor `repo_lifecycle_capabilities` — one row serving the THREE
    // methods (enableRepo/disableRepo/refreshRepo; the repoOps
    // one-row-serves-three-methods precedent), but the honest gate stays
    // PER METHOD: the row answers available when the backend declares ANY
    // of the three independent bits (a partially-overriding backend must
    // not have its served methods hidden behind a face-level row), while
    // each route independently answers the generic capability-missing arm
    // for its own bit BEFORE submit. Default declared-none keeps the row
    // honestly unavailable until the environment implementation-verification
    // slice flips it with the VrcGetLib override; the CLI backend has no
    // lifecycle face and stays honestly false.
    let packages_repo_lifecycle_ops_availability = match state.vpm.as_ref() {
        Some(vpm) if {
            let lifecycle = vpm.repo_lifecycle_capabilities();
            lifecycle.enable_repo || lifecycle.disable_repo || lifecycle.refresh_repo
        } =>
        {
            "available"
        }
        _ => "unavailable",
    };
    let overlay_availability = recipe_availability;
    // Proposal 029 B-face wiring loop 2 (core batch 2026-09-22): the
    // project-draft export read face rides the use-case wiring AND the
    // port's OWN defaulted capability accessor `export_capabilities`
    // (default declared-none — the F2/F5 accessor law; ORC-DEV-004: no
    // implementation, no reservation). One row serving the ONE method
    // (the removeOps/installOps/registerOps/repoOps/createOps/
    // repoCatalogOps/templatesOps/repoLifecycleOps one-row precedent): the
    // declared-none default keeps the row honestly unavailable until the
    // export-executor implementation slice flips it with the real
    // adapter's override.
    let recipe_export_availability = match state.use_cases.as_ref() {
        Some(use_cases) => match use_cases.draft_exporter.as_ref() {
            Some(exporter) if exporter.export_capabilities().export_project_draft => "available",
            _ => "unavailable",
        },
        None => "unavailable",
    };
    // bdl-queries v0.5 wiring (core batch 2026-09-22, proposal 030 §5.7
    // case A): the dependencies read face rides the warehouse/BDL wiring
    // AND the port's OWN defaulted capability accessor
    // `dependencies_capabilities` (default declared-none — the F2/F5
    // accessor law; ORC-DEV-004: no implementation, no reservation). One
    // row serving BOTH methods (the repoOps/repoLifecycleOps one-row
    // precedent; the frozen v0.5 face is one design unit — the
    // clues-not-conclusions law needs the two-face contrast to hold): the
    // declared-none default keeps the row honestly unavailable until the
    // real query-executor implementation slice flips it with the
    // implementing adapter's override.
    let dependencies_queries_availability = match state.warehouse.as_ref() {
        Some(warehouse) => match warehouse.dependencies_queries.as_ref() {
            Some(queries) if queries.dependencies_capabilities().dependencies_queries => {
                "available"
            }
            _ => "unavailable",
        },
        None => "unavailable",
    };
    // M7 inspection slice: the query face rides the use-case wiring; the
    // tasked run face additionally requires the shared task authority.
    let inspection_queries_availability = recipe_availability;
    let inspection_run_availability = match state.use_cases.as_ref() {
        Some(use_cases) if use_cases.runtime.is_some() => "available",
        _ => "unavailable",
    };
    json!([
        {"operationId": "task.list", "availability": "available"},
        {"operationId": "environment.getSnapshot", "availability": "available"},
        deployment_capability(state, "environment.planDeployment"),
        deployment_capability(state, "environment.executeDeployment"),
        {"operationId": "environment.verifyEditor", "availability": "available"},
        {"operationId": "demo.task", "availability": "available"},
        {"operationId": "overlay.snapshot", "availability": overlay_availability},
        {"operationId": "inspection.queries", "availability": inspection_queries_availability},
        {"operationId": "inspection.requestRun", "availability": inspection_run_availability},
        {"operationId": "production.useCase", "availability": production_availability},
        {"operationId": "production.recipes", "availability": recipe_availability},
        {
            "operationId": "recipe.exportProjectDraft",
            "availability": recipe_export_availability,
        },
        {
            "operationId": "dependencies.queries",
            "availability": dependencies_queries_availability,
        },
        {
            "operationId": "catalog.ingestLibraryPage",
            "availability": if state.warehouse.is_some() {
                "available"
            } else {
                "unavailable"
            },
        },
        {"operationId": "project.import-copy", "availability": project_ops_availability},
        {"operationId": "project.setNote", "availability": project_ops_availability},
        {"operationId": "packages.query", "availability": packages_availability},
        {"operationId": "packages.listRepos", "availability": packages_catalog_availability},
        {"operationId": "packages.packageCatalog", "availability": packages_catalog_availability},
        {"operationId": "packages.removeOps", "availability": packages_ops_availability},
        {
            "operationId": "packages.installOps",
            "availability": packages_install_ops_availability,
        },
        {
            "operationId": "packages.registerOps",
            "availability": packages_register_ops_availability,
        },
        {
            "operationId": "packages.repoOps",
            "availability": packages_repo_ops_availability,
        },
        {
            "operationId": "packages.createOps",
            "availability": packages_create_ops_availability,
        },
        {
            "operationId": "packages.repoCatalogOps",
            "availability": packages_repo_catalog_availability,
        },
        {
            "operationId": "packages.templatesOps",
            "availability": packages_templates_availability,
        },
        {
            "operationId": "packages.repoLifecycleOps",
            "availability": packages_repo_lifecycle_ops_availability,
        },
    ])
}

/// demo commandId -> deterministic task id: a repeated command hits the same
/// task, with the persistence-layer idempotent accept as the second line of defense.
fn demo_task_id(command_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(command_id.as_bytes());
    let digest = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("demo-{}", &digest[..12])
}

fn handle_start_demo(
    state: &mut HostState,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let command_id = request
        .get("commandId")
        .and_then(Value::as_str)
        .unwrap_or("");
    if command_id.is_empty() {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.demo.invalid_command",
            "errors.demo.invalidCommand",
            "validation",
        ));
    }
    let task_id = demo_task_id(command_id);
    if let Ok(Some(task)) = state.store.task(&task_id) {
        // idempotent replay: the same commandId returns the existing task
        // snapshot without creating a new task or emitting new events
        return FrameOutcome::Response(application_success(
            request_id,
            json!({
                "contractVersion": APPLICATION_CONTRACT_VERSION,
                "task": task_snapshot(state, &task),
            }),
        ));
    }

    let new_task = NewTask {
        task_id: task_id.clone(),
        correlation_id: correlation_id.to_string(),
        occurred_at: now_rfc3339(),
    };
    let fingerprint_input = json!({"kind": "task.startDemo", "commandId": command_id});
    let result = state.store.accept_idempotent_task(
        "task.startDemo",
        command_id,
        &request_fingerprint(&fingerprint_input),
        &new_task,
        &json!({"demo": true}),
    );
    match result {
        Ok(IdempotentTaskAcceptance::Accepted { task, event }) => {
            let response = application_success(
                request_id,
                json!({
                    "contractVersion": APPLICATION_CONTRACT_VERSION,
                    "task": task_snapshot(state, &task),
                }),
            );
            let event_id = format!("sqlite-{}-{}", event.task_id, event.revision);
            FrameOutcome::ResponseAndEvent {
                response,
                event: (event_id.clone(), task_event(&event_id, &event)),
            }
        }
        Ok(IdempotentTaskAcceptance::Replayed { response, .. }) => {
            FrameOutcome::Response(application_success(request_id, response))
        }
        Err(error) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            store_error_code(&error),
            "errors.provider.persistence",
            store_error_category(&error),
        )),
    }
}

/// Demo task deterministic progression: queued -> preparing -> running, holding
/// at running awaiting cancellation; cancellation then completes as cancelled.
/// Progression is driven by received frames (deterministic, no timers).
fn advance_demo_tasks(
    state: &mut HostState,
) -> Result<Vec<StoredTaskEvent>, SqliteStoreError> {
    let mut events = Vec::new();
    for task in state.store.tasks()? {
        if !task.task_id.starts_with("demo-") || task.state.is_terminal() {
            continue;
        }
        // 取消不阻塞前进:演示任务照常推进到 running,取消请求把
        // running 的下一步转为 cancelled 终态(修复:取消在 queued/preparing
        // 到达时任务曾永久卡在 preparing,旧假绿掩盖了它)
        let target = match task.state {
            TaskState::Queued => Some(TaskState::Preparing),
            TaskState::Preparing => Some(TaskState::Running),
            TaskState::Running if task.cancel_requested => Some(TaskState::Cancelled),
            _ => None,
        };
        let Some(target) = target else { continue };
        let mutation = if target.is_terminal() {
            // A cancelled demo task hands back no result document (BOARD #22
            // frozen invariant: cancelled snapshots never carry a result —
            // the pre-reflux Some({"demo":true}) here was dead data from the
            // era when result had no read face).
            TaskMutation::Complete {
                state: target,
                error: None,
                result: None,
            }
        } else {
            TaskMutation::Transition {
                state: target,
                payload: json!({}),
            }
        };
        if let Some(event) = state
            .store
            .mutate_task(&task.task_id, task.revision, &now_rfc3339(), mutation)?
        {
            events.push(event);
        }
    }
    Ok(events)
}

fn handle_cancellation(
    state: &mut HostState,
    request: &Value,
    request_id: &str,
) -> Result<FrameOutcome, SqliteStoreError> {
    let command_id = request
        .get("commandId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let task_id = request
        .pointer("/params/taskId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let observed_revision = request
        .pointer("/params/observedRevision")
        .and_then(Value::as_u64);
    let fingerprint = request_fingerprint(&method_and_task(request));
    let occurred_at = now_rfc3339();
    let cancellation = state.store.request_cancellation_idempotent(
        command_id,
        &fingerprint,
        task_id,
        observed_revision,
        &occurred_at,
    )?;
    // The worker token is cancelled ONLY after the authoritative store has
    // accepted the request — a request rejected by idempotency or revision
    // validation must not cancel anything as a side effect.
    if matches!(cancellation, IdempotentCancellation::Applied { .. }) {
        if let Some(services) = &state.production {
            if let Some(token) =
                services.running.lock().expect("running poisoned").get(task_id)
            {
                token.cancel();
            }
        }
        // Download tasks: the user's cancellation folds to an abandon intent
        // for the port (discard the partial file). The download task id is
        // `dl-<downloadId>-a<attempt>`; the intent carries the downloadId.
        if task_id.starts_with("dl-") {
            if let Some(downloads) = &state.downloads {
                if let Ok(Some(task)) = state.store.task(task_id) {
                    downloads.queue_intent(&task.correlation_id, "abandon");
                }
            }
        }
    }
    match cancellation {
        IdempotentCancellation::Replayed(result) => {
            Ok(FrameOutcome::Response(application_success(
                request_id,
                serde_json::to_value(result).expect("serializable"),
            )))
        }
        IdempotentCancellation::Applied { result, event } => {
            let response = application_success(
                request_id,
                serde_json::to_value(result).expect("serializable"),
            );
            match event {
                Some(event) => {
                    let event_id = format!("sqlite-{}-{}", event.task_id, event.revision);
                    Ok(FrameOutcome::ResponseAndEvent {
                        response,
                        event: (event_id.clone(), task_event(&event_id, &event)),
                    })
                }
                None => Ok(FrameOutcome::Response(response)),
            }
        }
    }
}

/// True when a driven task runtime holds this task frozen by a persistence
/// failure (honesty discipline #2): the store row is stuck at its last
/// persisted state, so the served snapshot must not read as still
/// progressing. The use-case runtime reuses the warehouse instance and needs
/// no separate check.
fn runtime_poisoned(state: &HostState, task_id: &str) -> bool {
    let poisoned = |runtime: &TaskRuntime| {
        runtime
            .snapshot(task_id)
            .map(|snapshot| snapshot.poisoned)
            .unwrap_or(false)
    };
    state
        .warehouse
        .as_ref()
        .map(|services| poisoned(&services.runtime))
        .unwrap_or(false)
        || state
            .project_ops
            .as_ref()
            .map(|services| poisoned(&services.runtime))
            .unwrap_or(false)
}

fn task_snapshot(state: &HostState, task: &StoredTask) -> Value {
    let recovery = if state.recovered_nonterminal_tasks.contains(&task.task_id)
        || runtime_poisoned(state, &task.task_id)
    {
        "inspect_required"
    } else {
        "none"
    };
    let mut snapshot = json!({
        "contractVersion": APPLICATION_CONTRACT_VERSION,
        "taskId": task.task_id,
        "revision": task.revision,
        "correlationId": task.correlation_id,
        "state": state_name(task.state),
        "cancellationRequested": task.cancel_requested,
        "recoveryDisposition": recovery,
        "updatedAt": task.updated_at,
    });
    if let Some(error) = &task.error {
        snapshot
            .as_object_mut()
            .expect("snapshot is an object")
            .insert(
                "error".into(),
                serde_json::to_value(error).expect("error serializes"),
            );
    }
    // Result reflux (BOARD #22): the task face carries the Done payload on
    // the snapshot channel with the same value the task.completed event
    // publishes (both project the single StoredTask.result). The frozen
    // invariant is state-scoped: only an honestly completed task refluxes a
    // result — failed/cancelled/non-terminal snapshots never carry one (the
    // failure fact travels the error field, the completed-event payload is
    // the serialized error on that face), and a null result is an honest
    // absence, not a value (BG-12 absence-projection precedent). This also
    // covers recovery-observation payloads persisted on failed tasks
    // (job.execute rollback receipts): they stay storage-face facts for the
    // recovery flow, which reads the store directly, and never surface as a
    // snapshot "result". The payload's internal shape is owned by the word
    // list of the operation that produced it (project-ops payloads
    // self-describe via schemaVersion/operation); the snapshot face makes no
    // structural promise.
    let completed = matches!(
        task.state,
        TaskState::Succeeded | TaskState::SucceededWithWarnings
    );
    if completed {
        if let Some(result) = &task.result {
            if !result.is_null() {
                snapshot
                    .as_object_mut()
                    .expect("snapshot is an object")
                    .insert("result".into(), result.clone());
            }
        }
    }
    snapshot
}

fn task_event(event_id: &str, event: &StoredTaskEvent) -> Value {
    json!({
        "contractVersion": APPLICATION_CONTRACT_VERSION,
        "eventId": event_id,
        "taskId": event.task_id,
        "revision": event.revision,
        "occurredAt": event.occurred_at,
        "correlationId": event.correlation_id,
        "kind": match event.kind {
            TaskEventKind::Accepted => "task.accepted",
            TaskEventKind::StateChanged => "task.stateChanged",
            TaskEventKind::Progress => "task.progressed",
            TaskEventKind::CancelRequested => "task.cancellationRequested",
            TaskEventKind::Completed => "task.completed",
            // In-session freeze notification: published by the runtime at the
            // persistence failure and forwarded here; it is never stored.
            TaskEventKind::PersistenceFailed => "task.persistenceFailed",
        },
        "state": state_name(event.state),
        "payload": event.payload,
    })
}

pub(crate) fn application_success(request_id: &str, value: Value) -> Value {
    json!({
        "contractVersion": APPLICATION_CONTRACT_VERSION,
        "requestId": request_id,
        "ok": true,
        "value": value,
    })
}

/// B4/F4-4: the download acquisition surface. `download.ingest` folds port
/// events into BDL (at-least-once; the BDL unique key dedups) and drives the
/// per-attempt nine-state task; `download.retry` adjudicates a user retry
/// through the frozen retry policy and emits the port intent.
/// B4 warehouse maintenance surface (proposal 005, bdl-commands v0.2) plus
/// the bdl-queries v0.3 warehouse read face.
/// `warehouse.setArtifactMode` / `warehouse.setGlobalDefaultMode` apply
/// synchronously and report the stored fact read back from BDL — the entry's
/// resulting effective mode / the persisted global default, never an echo of
/// the request. `warehouse.generateVpm` / `warehouse.deleteOriginals`
/// submit audited maintenance tasks and return a task acceptance — their Done
/// payloads travel the application-contract task surface. Guards are
/// server-side facts evaluated inside the tasks, never at admission.
/// All FOUR command acceptances (the proposal-005 trio plus
/// `setGlobalDefaultMode`) are bdl-commands v0.2 documents (v0.1 is
/// superseded; the trio's shapes are unchanged, only the envelope version
/// moved). `warehouse.listEntries` / `warehouse.entryDetail` are the frozen
/// read queries: bdl-queries v0.3 documents over the same assembly the
/// catalog face wraps.
fn warehouse_request(
    state: &mut HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(warehouse) = state.warehouse.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.warehouse.unavailable",
            "errors.warehouse.unavailable",
            "unavailable",
        ));
    };
    match method {
        "warehouse.setArtifactMode" => {
            warehouse_set_artifact_mode(warehouse, request, request_id, correlation_id)
        }
        "warehouse.setGlobalDefaultMode" => {
            warehouse_set_global_default_mode(warehouse, request, request_id, correlation_id)
        }
        "warehouse.generateVpm" | "warehouse.deleteOriginals" => {
            warehouse_submit_task(warehouse, method, request, request_id, correlation_id)
        }
        "warehouse.import" => {
            warehouse_import_submit(warehouse, request, request_id, correlation_id)
        }
        "warehouse.importDownloads" => {
            warehouse_import_downloads_submit(warehouse, request, request_id, correlation_id)
        }
        "warehouse.listEntries" => {
            warehouse_list_entries(warehouse, request, request_id, correlation_id)
        }
        "warehouse.entryDetail" => {
            warehouse_entry_detail_query(warehouse, request, request_id, correlation_id)
        }
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

fn warehouse_invalid_params(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.warehouse.invalid_params",
        "errors.warehouse.invalidParams",
        "validation",
    ))
}

/// `warehouse.listEntries` (bdl-queries v0.3 read face): every entry card,
/// effective modes resolved against the composed global default. The closed
/// set is `{}` — any key at all is a contract error.
fn warehouse_list_entries(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    if !matches!(request.get("params"), Some(Value::Object(params)) if params.is_empty()) {
        return warehouse_invalid_params(request_id, correlation_id);
    }
    let global_default = match composed_global_default(&warehouse.bdl, warehouse.global_default) {
        Ok(global_default) => global_default,
        Err(_) => return warehouse_store_failed(request_id, correlation_id),
    };
    match warehouse.bdl.warehouse_entry_cards(global_default) {
        Ok(entries) => match serde_json::to_value(&entries) {
            Ok(entries) => bdl_query_success(
                request_id,
                "warehouse.listEntries",
                json!({ "entries": entries }),
            ),
            Err(_) => warehouse_store_failed(request_id, correlation_id),
        },
        Err(_) => warehouse_store_failed(request_id, correlation_id),
    }
}

/// `warehouse.entryDetail` (bdl-queries v0.3 read face): per-artifact
/// inspection facts for one entry. The closed set is `{ warehouseItemId }`;
/// a miss is the frozen application-face entry_not_found.
fn warehouse_entry_detail_query(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let warehouse_item_id = match request.get("params") {
        Some(Value::Object(params)) if params.keys().all(|key| key == "warehouseItemId") => {
            params
                .get("warehouseItemId")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .filter(|id| !id.is_empty())
        }
        _ => None,
    };
    let Some(warehouse_item_id) = warehouse_item_id else {
        return warehouse_invalid_params(request_id, correlation_id);
    };
    let global_default = match composed_global_default(&warehouse.bdl, warehouse.global_default) {
        Ok(global_default) => global_default,
        Err(_) => return warehouse_store_failed(request_id, correlation_id),
    };
    match warehouse
        .bdl
        .warehouse_entry_detail(&warehouse_item_id, global_default)
    {
        Ok(Some(detail)) => match serde_json::to_value(&detail) {
            Ok(entry) => {
                bdl_query_success(request_id, "warehouse.entryDetail", json!({ "entry": entry }))
            }
            Err(_) => warehouse_store_failed(request_id, correlation_id),
        },
        Ok(None) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.warehouse.entry_not_found",
            "errors.warehouse.entryNotFound",
            "validation",
        )),
        Err(_) => warehouse_store_failed(request_id, correlation_id),
    }
}

fn warehouse_item_id_param(request: &Value) -> Option<String> {
    request
        .pointer("/params/warehouseItemId")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .filter(|id| !id.is_empty())
}

/// The composed global default (U8 two-level options, global level): the
/// persisted bdl_meta value once one exists, otherwise the provider's
/// environment-injected initial default. Read per request — never a wiring
/// time snapshot, so a setGlobalDefaultMode rules every later resolution.
fn composed_global_default(
    bdl: &BdlStore,
    initial: ArtifactMode,
) -> Result<ArtifactMode, BdlStoreError> {
    Ok(bdl.global_default_mode()?.unwrap_or(initial))
}

fn warehouse_store_failed(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.warehouse.storeFailed",
        "errors.warehouse.storeFailed",
        "internal",
    ))
}

/// The entry's resulting effective mode, read back from the store:
/// `override ?? composed global default`. A miss after a successful write
/// is an internal failure, never an empty mode.
fn warehouse_entry_effective_mode(
    warehouse: &WarehouseServices,
    warehouse_item_id: &str,
) -> Result<String, BdlStoreError> {
    let global = composed_global_default(&warehouse.bdl, warehouse.global_default)?;
    let detail = warehouse
        .bdl
        .warehouse_entry_detail(warehouse_item_id, global)?
        .ok_or_else(|| BdlStoreError::UnknownWarehouseItem(warehouse_item_id.to_owned()))?;
    Ok(detail.effective_artifact_mode.name().to_owned())
}

fn warehouse_set_artifact_mode(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(warehouse_item_id) = warehouse_item_id_param(request) else {
        return warehouse_invalid_params(request_id, correlation_id);
    };
    let mode = match request.pointer("/params/mode") {
        // The override follows the frozen closed vocabulary; null clears it
        // so the entry follows the global default again. A missing mode is a
        // params violation, not a clear.
        Some(Value::Null) => None,
        Some(Value::String(raw)) => match ArtifactMode::parse(raw) {
            Ok(mode) => Some(mode),
            Err(_) => return warehouse_invalid_params(request_id, correlation_id),
        },
        Some(_) | None => return warehouse_invalid_params(request_id, correlation_id),
    };
    match warehouse.bdl.set_artifact_mode(&warehouse_item_id, mode) {
        Ok(()) => {}
        Err(BdlStoreError::UnknownWarehouseItem(_)) => {
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.warehouse.entry_not_found",
                "errors.warehouse.entryNotFound",
                "validation",
            ));
        }
        Err(_) => return warehouse_store_failed(request_id, correlation_id),
    }
    // The effective mode is read back from the store (override ?? composed
    // global default), never echoed from the request. A read-back failure is
    // an internal failure whose retry is safe — never an empty mode.
    let effective = match warehouse_entry_effective_mode(&warehouse, &warehouse_item_id) {
        Ok(effective) => effective,
        Err(_) => return warehouse_store_failed(request_id, correlation_id),
    };
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": BDL_COMMANDS_SCHEMA_VERSION,
            "operation": "warehouse.setArtifactMode",
            "warehouseItemId": warehouse_item_id,
            "effectiveMode": effective,
        }),
    ))
}

/// bdl-commands v0.4 is the frozen command face all warehouse command
/// acceptances travel as (v0.1/v0.2/v0.3 superseded; the trio, the global
/// default and the M5 batch import keep their shapes; v0.4 adds
/// `warehouse.importDownloads` — the M6 download-adoption task, IMP-3 /
/// user ruling U7-3).
const BDL_COMMANDS_SCHEMA_VERSION: &str = "0.4";

/// project-ops v0.2 is the frozen write-command face `project.import-copy`
/// and `project.setNote` travel as (proposal 014, arbitrated 2026-09-09;
/// v0.2 adds the setNote note task per the D-6 desktop confirmation,
/// proposal 013 inline thread). v0.1 stays archived as the superseded
/// import-copy-only face.
const PROJECT_OPS_SCHEMA_VERSION: &str = "0.2";

/// `warehouse.setGlobalDefaultMode` (bdl-commands v0.2, U8 ruling): the
/// synchronous write of the two-level options' GLOBAL level. The global
/// default always has a value — a persisted fact once written, the
/// environment-injected initial default before — so the params carry no
/// null: a missing/null mode is a params violation, not a no-op. The
/// acceptance reports the persisted fact read back from BDL, never the
/// echoed request.
fn warehouse_set_global_default_mode(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let mode = match request.pointer("/params/mode") {
        Some(Value::String(raw)) => match ArtifactMode::parse(raw) {
            Ok(mode) => mode,
            Err(_) => return warehouse_invalid_params(request_id, correlation_id),
        },
        _ => return warehouse_invalid_params(request_id, correlation_id),
    };
    if warehouse.bdl.set_global_default_mode(mode).is_err() {
        return warehouse_store_failed(request_id, correlation_id);
    }
    // Read back the stored fact through the ordinary read path; a write
    // that cannot be read back is an internal failure whose retry is safe
    // (the write is idempotent).
    let persisted = match warehouse.bdl.global_default_mode() {
        Ok(Some(persisted)) => persisted,
        _ => return warehouse_store_failed(request_id, correlation_id),
    };
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": BDL_COMMANDS_SCHEMA_VERSION,
            "operation": "warehouse.setGlobalDefaultMode",
            "globalDefaultMode": persisted.name(),
        }),
    ))
}

fn warehouse_submit_task(
    warehouse: Arc<WarehouseServices>,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(warehouse_item_id) = warehouse_item_id_param(request) else {
        return warehouse_invalid_params(request_id, correlation_id);
    };
    // The composed global default at submission time (persisted ?? env
    // initial): the guards fire inside the tasks and resolve overrides
    // against this value.
    let global_default =
        match composed_global_default(&warehouse.bdl, warehouse.global_default) {
            Ok(global_default) => global_default,
            Err(_) => return warehouse_store_failed(request_id, correlation_id),
        };
    let accepted = match method {
        "warehouse.generateVpm" => {
            let Some(executor) = warehouse.executor.clone() else {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.warehouse.unavailable",
                    "errors.warehouse.unavailable",
                    "unavailable",
                ));
            };
            vua_acquisition::warehouse_maintenance::submit_generate_vpm(
                &warehouse.runtime,
                warehouse.bdl.clone(),
                executor,
                vua_acquisition::warehouse_maintenance::GenerateVpmTaskSpec {
                    correlation_id: correlation_id.to_owned(),
                    warehouse_item_id,
                    warehouse_root: warehouse.warehouse_root.clone(),
                    global_default,
                    // Manual wire initiation never carries the audit chain;
                    // import orchestration fills it in acquisition (010).
                    import_correlation_id: None,
                },
                None,
            )
        }
        "warehouse.deleteOriginals" => {
            vua_acquisition::warehouse_maintenance::submit_delete_originals(
                &warehouse.runtime,
                warehouse.bdl.clone(),
                vua_acquisition::warehouse_maintenance::DeleteOriginalsTaskSpec {
                    correlation_id: correlation_id.to_owned(),
                    warehouse_item_id,
                    global_default,
                },
                None,
            )
        }
        _ => unreachable!("warehouse_request dispatches only the tasked pair"),
    };
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": BDL_COMMANDS_SCHEMA_VERSION,
                "operation": method,
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task authority
        // (the guards themselves fire inside the task, not at admission).
        Err(_) => warehouse_store_failed(request_id, correlation_id),
    }
}

/// Generates a uuid-v7-shaped identity (unix-ts-ms ordering + in-process
/// counter randomness; single-process uniqueness is what the stores need).
/// The version nibble is `7` and the variant bits are `10xx` so every
/// identity satisfies the frozen `uuidV7` pattern shared by the recipe
/// v0.3 suite and the production-use-case v0.2 word list.
fn uuid_v7_identity() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id() as u64;
    let unix_ts_ms = ms & 0x0000_ffff_ffff_ffff;
    let ver_rand_a = 0x7000u32 | (((counter << 1) as u32) & 0x0fff);
    let var_hi = 0x8000u16 | (((pid << 4) as u16) & 0x3fff);
    let var_lo = (counter & 0xffff_ffff) | 0x0000_0001_0000_0000;
    format!(
        "{:08x}-{:04x}-7{:03x}-{:04x}-{:012x}",
        (unix_ts_ms >> 16) as u32,
        (unix_ts_ms & 0xffff) as u16,
        ver_rand_a & 0x0fff,
        var_hi,
        var_lo & 0xffff_ffff_ffff,
    )
}

/// Canonical plan-hash: SHA-256 over the serialization of the plan document
/// with the `status` field removed (the lifecycle is not part of the
/// authorized content) and `planHash` itself absent (it names this hash).
fn plan_document_hash(document: &Value) -> String {
    let mut canonical = document.clone();
    if let Some(object) = canonical.as_object_mut() {
        object.remove("status");
        object.remove("planHash");
    }
    let serialized = serde_json::to_string(&canonical).unwrap_or_default();
    let digest = sha2::Sha256::digest(serialized.as_bytes());
    format!(
        "sha256:{}",
        digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    )
}

/// The typed failure for a BDL store read/write that breaks a tasked
/// use case (the task-level twin of the frame-layer `warehouse_store_failed`
/// arm): same warehouse word-face key the desktop already holds, internal
/// category, the store error carried honestly in the detail param.
fn bdl_store_failed(correlation_id: &str, error: impl std::fmt::Display) -> AppErrorV1 {
    AppErrorV1::new(
        "vua.warehouse.store_failed",
        ErrorCategory::Internal,
        "errors.warehouse.storeFailed",
        correlation_id,
    )
    .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
}

/// Local Resolution over a Recipe v0.3 document (011 section 5, minimal
/// honest semantics): warehouse-sourced assets resolve through the frozen
/// entry detail query against the composed global default; provider-sourced
/// assets have no import record on this machine and are honest
/// missing-asset evidence. Every missing asset publishes its evidence
/// (identity referenced, body in the W23 store); skipped relations are
/// reported in the Done payload - the draft plan only carries executable
/// jobs.
fn run_local_resolution(
    store: &BdlStore,
    recipes: &RecipeDocumentStore,
    plans: &vua_orchestrator::PlanDocumentStore,
    evidence: &vua_orchestrator::EvidenceStore,
    env_initial: ArtifactMode,
    recipe_id: &str,
    correlation_id: &str,
) -> Result<Value, AppErrorV1> {
    use vua_bdl_store::ArtifactInspectionVerdict;

    let stored = recipes
        .get(recipe_id)
        .map_err(|error| {
            AppErrorV1::new(
                "vua.recipe.store_failed",
                ErrorCategory::Internal,
                "errors.recipe.storeFailed",
                correlation_id,
            )
            .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
        })?
        .ok_or_else(|| {
            AppErrorV1::new(
                "vua.recipe.not_found",
                ErrorCategory::Validation,
                "errors.recipe.notFound",
                correlation_id,
            )
        })?;
    let recipe = &stored.recipe;
    // The composed global default (U8 two-level options): a persisted value
    // rules every later resolution. A failed read must surface as a typed
    // failure — silently demoting it to the environment initial presented a
    // broken store as "no default was set" and silently switched the
    // artifact-mode decision for every asset in the resolution (BG-12
    // family member, wt-2 batch 178 reverse-audit; the frame-layer twin
    // `composed_global_default` propagates the same error).
    let composed = match store.global_default_mode() {
        Ok(persisted) => persisted.unwrap_or(env_initial),
        Err(error) => return Err(bdl_store_failed(correlation_id, &error)),
    };

    let local_resolution_id = uuid_v7_identity();
    let mut resolved_assets: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();
    let mut missing_count: usize = 0;
    let mut evidence_ids: Vec<String> = Vec::new();
    let mut skipped_job_ids: Vec<String> = Vec::new();

    // resolve_one_asset: returns the resolvedSource value or None after
    // publishing the honest missing evidence. A failed entry-detail READ is
    // neither of those: it is a store failure and surfaces as the typed
    // failure — treating Err like "no entry" would publish missing-asset
    // evidence (a false statement about world state) and silently skip the
    // relation's jobs (BG-12 family member, wt-2 batch 178 reverse-audit;
    // only Ok(None) — a true absence — earns the missing arm).
    let resolve_one_asset = |asset: &Value,
                             evidence_ids: &mut Vec<String>,
                             missing_count: &mut usize,
                             local_resolution_id: &str|
     -> Result<Option<Value>, AppErrorV1> {
        let source_ref = match asset.get("sourceRef") {
            Some(source_ref) => source_ref,
            None => return Ok(None),
        };
        if let Some(warehouse_item_id) =
            source_ref.get("warehouseItemId").and_then(Value::as_str)
        {
            let requested_role =
                source_ref.get("role").and_then(Value::as_str).unwrap_or("original");
            let detail = match store.warehouse_entry_detail(warehouse_item_id, composed) {
                Ok(detail) => detail,
                Err(error) => return Err(bdl_store_failed(correlation_id, &error)),
            };
            if let Some(detail) = detail {
                // Source selection follows the entry's effective artifact
                // mode (override ?? composed global, W14): generate_vpm
                // prefers a CLEAN generated_vpm copy, anything else falls
                // back to the original copy - the fallback is honest
                // (fallbackUsed on the plan), never invented.
                let original = detail.artifacts.iter().find(|fact| fact.role.name() == "original");
                let clean_vpm = detail.artifacts.iter().find(|fact| {
                    fact.role.name() == "generated_vpm"
                        && matches!(fact.state, ArtifactInspectionVerdict::Clean)
                });
                let chosen = match detail.effective_artifact_mode {
                    vua_bdl_store::ArtifactMode::GenerateVpm => clean_vpm
                        .map(|fact| (fact, false))
                        .or(original.map(|fact| (fact, true))),
                    _ => original.map(|fact| (fact, false)),
                };
                if let Some((fact, fallback_used)) = chosen {
                    return Ok(Some(serde_json::json!({
                        "sourceKind": fact.role.name(),
                        "artifactSha256": fact.artifact_sha256,
                        "warehouseItemId": warehouse_item_id,
                        "fallbackUsed": fallback_used,
                    })));
                }
            }
            let evidence_id = uuid_v7_identity();
            let document = vua_orchestrator::ProductionEvidenceV01::new_unresolved(
                evidence_id.clone(),
                vua_orchestrator::EvidenceKind::MissingAsset,
                vua_orchestrator::EvidenceSubject {
                    ref_: format!("warehouse:{warehouse_item_id}"),
                    label: None,
                },
                now_rfc3339(),
                "Local Resolution found no entry or no clean artifact for this asset",
                vua_orchestrator::EvidenceSourceRef::from_local_resolution(local_resolution_id),
            );
            if evidence.publish(&document).is_ok() {
                evidence_ids.push(evidence_id.clone());
                *missing_count += 1;
            }
            Ok(Some(serde_json::json!({
                "sourceKind": requested_role,
                "artifactSha256": Value::Null,
                "warehouseItemId": warehouse_item_id,
                "fallbackUsed": false,
                "missing": true,
                "evidenceId": evidence_id,
            })))
        } else {
            // Provider-sourced asset: no import record exists on this
            // machine - honest missing evidence (never invented paths).
            let provider =
                source_ref.get("provider").and_then(Value::as_str).unwrap_or("unknown");
            let product =
                source_ref.get("productId").and_then(Value::as_str).unwrap_or("unknown");
            let evidence_id = uuid_v7_identity();
            let document = vua_orchestrator::ProductionEvidenceV01::new_unresolved(
                evidence_id.clone(),
                vua_orchestrator::EvidenceKind::MissingAsset,
                vua_orchestrator::EvidenceSubject {
                    ref_: format!("provider:{provider}:{product}"),
                    label: None,
                },
                now_rfc3339(),
                "provider-sourced asset has no import record on this machine",
                vua_orchestrator::EvidenceSourceRef::from_local_resolution(local_resolution_id),
            );
            if evidence.publish(&document).is_ok() {
                evidence_ids.push(evidence_id.clone());
                *missing_count += 1;
            }
            Ok(Some(serde_json::json!({
                "sourceKind": "original",
                "artifactSha256": Value::Null,
                "warehouseItemId": Value::Null,
                "fallbackUsed": false,
                "missing": true,
                "evidenceId": evidence_id,
            })))
        }
    };

    // Assets resolve first (instances reference them by assetId).
    if let Some(assets) = recipe.get("assets").and_then(Value::as_array) {
        for asset in assets {
            let asset_id = asset.get("id").and_then(Value::as_str).unwrap_or_default();
            if let Some(resolved_source) =
                resolve_one_asset(asset, &mut evidence_ids, &mut missing_count, &local_resolution_id)?
            {
                resolved_assets.insert(asset_id.to_owned(), resolved_source);
            }
        }
    }

    // Relations project to jobs (only jobs whose resolved source exists).
    let mut jobs: Vec<Value> = Vec::new();
    if let Some(relations) = recipe.get("relations").and_then(Value::as_array) {
        for relation in relations {
            let kind = relation.get("kind").and_then(Value::as_str).unwrap_or_default();
            let relation_id =
                relation.get("id").and_then(Value::as_str).unwrap_or_default();
            let asset_instance_id = relation
                .get("assetInstanceId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let instance = recipe
                .get("instances")
                .and_then(Value::as_array)
                .and_then(|instances| {
                    instances.iter().find(|instance| {
                        instance.get("id").and_then(Value::as_str)
                            == Some(asset_instance_id)
                    })
                });
            let asset_id = instance
                .and_then(|instance| instance.get("assetId"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(resolved_source) = resolved_assets.get(asset_id) else {
                skipped_job_ids.push(relation_id.to_owned());
                continue;
            };
            if resolved_source.get("missing").and_then(Value::as_bool) == Some(true) {
                skipped_job_ids.push(relation_id.to_owned());
                continue;
            }
            let mut inputs = serde_json::json!({
                "assetId": asset_id,
                "resolvedSource": resolved_source,
            });
            if kind == "attach_to_bone" {
                if let Some(bone) = relation.get("bone") {
                    inputs["bone"] = bone.clone();
                }
                if let Some(transform) = relation.get("localTransform") {
                    inputs["localTransform"] = transform.clone();
                }
                if let Some(selector_id) = instance
                    .and_then(|instance| instance.get("entrypoint"))
                    .and_then(|entrypoint| entrypoint.get("selectorId"))
                {
                    inputs["selectorId"] = selector_id.clone();
                }
            } else if kind == "exclude_object" || kind == "set_object_active" {
                if let Some(selector) = relation.get("selector") {
                    inputs["selector"] = selector.clone();
                }
                if let Some(active) = relation.get("active") {
                    inputs["active"] = active.clone();
                }
                if let Some(target) = relation.get("targetInstanceId") {
                    inputs["targetInstanceId"] = target.clone();
                }
            }
            jobs.push(serde_json::json!({
                "jobId": uuid_v7_identity(),
                "kind": kind,
                "inputs": inputs,
            }));
        }
    }

    let target_resolved = recipe
        .get("target")
        .and_then(|target| target.get("avatarInstanceId"))
        .and_then(Value::as_str)
        .and_then(|avatar_instance_id| {
            recipe
                .get("instances")
                .and_then(Value::as_array)
                .and_then(|instances| {
                    instances.iter().find(|instance| {
                        instance.get("id").and_then(Value::as_str)
                            == Some(avatar_instance_id)
                    })
                })
        })
        .and_then(|instance| instance.get("assetId"))
        .and_then(Value::as_str)
        .and_then(|asset_id| resolved_assets.get(asset_id))
        .cloned();

    let created_at = now_rfc3339();
    let plan_id = uuid_v7_identity();
    let mut plan = serde_json::json!({
        "schemaVersion": "0.3",
        "planId": plan_id,
        "recipeId": recipe.get("recipeId").cloned().unwrap_or(serde_json::json!(recipe_id)),
        // The version-lock value is the store's optimistic-concurrency
        // revision (the authority on "the document changed"), not the
        // author-facing revision field inside the document body: job.execute
        // rejects the plan when the store revision has moved past what this
        // resolution was run against.
        "recipeRevision": serde_json::json!(stored.revision),
        "localResolutionId": local_resolution_id,
        "environmentId": uuid_v7_identity(),
        "createdAt": created_at,
        "approvedAt": created_at,
        "fingerprint": {"expectedProjectFingerprint": "not_verified_at_resolution"},
        "target": {
            "avatarInstanceId": recipe
                .get("target")
                .and_then(|target| target.get("avatarInstanceId"))
                .cloned()
                .unwrap_or(Value::Null),
            "resolvedSource": target_resolved,
        },
        "jobs": jobs,
        "status": "draft",
    });
    let plan_hash = plan_document_hash(&plan);
    plan["planHash"] = serde_json::json!(plan_hash);
    plans.publish_draft(&plan_id, &plan).map_err(|error| {
        AppErrorV1::new(
            "vua.plan.store_failed",
            ErrorCategory::Internal,
            "errors.plan.storeFailed",
            correlation_id,
        )
        .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
    })?;

    Ok(serde_json::json!({
        "planId": plan_id,
        "planStatus": "draft",
        "localResolutionId": local_resolution_id,
        "missingCount": missing_count,
        "evidenceIds": evidence_ids,
        "skippedJobIds": skipped_job_ids,
    }))
}

/// W20 production-use-case v0.2 command face (first cut): the recipe
/// document face (save with baseRevision optimistic concurrency / get /
/// list) over the AMF production-domain recipe document store. Absent
/// wiring answers a typed unavailable; unknown params and stale bases are
/// typed contract errors (011 section 7 convergence decisions, data stance).
fn recipe_request(
    state: &HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(use_cases) = state.use_cases.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.recipe.unavailable",
            "errors.recipe.unavailable",
            "unavailable",
        ));
    };
    match method {
        "recipe.save" => recipe_save(use_cases, request, request_id, correlation_id),
        "recipe.get" => recipe_get(use_cases, request, request_id, correlation_id),
        "recipe.list" => recipe_list(use_cases, request, request_id, correlation_id),
        "recipe.resolve" => recipe_resolve(use_cases, request, request_id, correlation_id),
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

/// `recipe.exportProjectDraft` (proposal 029 B-face freeze loop 1 word row,
/// wired by this loop-2 batch): the synchronous read-only Query that derives
/// a RECIPE PROJECT DRAFT (never a Recipe — ruling 2: the draft is its own
/// type; promotion is only ever the user-confirmed recipe.save chain) from
/// one registered Unity project. Route arm order (the packageCatalog
/// isomorph): (1) the export PORT wiring answers first — absent use-case
/// services or an absent `draft_exporter` is the frozen honest absence
/// `vua.recipe_export.unavailable`, never a fabricated draft (the face's
/// OWN family code: the router dispatches here BEFORE the document-face
/// fold so the absence never masquerades as `vua.recipe.unavailable`);
/// (2) the closed single-key params set {projectPath, non-empty} answers
/// `vua.recipe_export.invalid_params` at the route layer, a pure shape
/// verdict BEFORE the gate (any extra key is a shape violation, never a
/// default); (3) the registration calibration rides the SAME 013 inspection
/// aggregate `project.inspectProject` uses (same fact, same code:
/// `vua.project.project_not_found` — the 024 packages-query reuse ruling;
/// an off-aggregate path never reaches the port; absent project-ops wiring
/// means the calibration does not exist, so the whole face stays honestly
/// absent); (4) the capability gate reads the NEW defaulted port accessor
/// `export_capabilities` (default declared-none — the F5
/// `template_capabilities` accessor law; ORC-DEV-004) BEFORE the port call,
/// answering the same honest-absence code the face's closed set reserves
/// for it; (5) the port's typed refusals travel VERBATIM (the read-face
/// pass-through discipline — no read-face fold exists), and an OK
/// projection is the port's `ProjectDraftDocumentV01` facts through serde,
/// stamped with the family const at envelope assembly (the P1 discipline:
/// the route stamps the consts, the port facts stay verbatim — the
/// packageId-ascending order and the missing-list closed set are PRODUCER
/// contracts of the frozen word face, pinned by the wire tests, never route
/// rewrites). An honest empty dependencies array and a null
/// unityVersionConstraint plus its environmentUnityVersion marker ride as
/// SUCCESS facts (observation failure sets no error code — honesty rules
/// 1/2). No tasked face exists here (ruling 3: local read-only scan —
/// nothing to cancel, nothing to recover, no nine-state task).
fn recipe_export_request(
    state: &HostState,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(exporter) = state
        .use_cases
        .as_ref()
        .and_then(|use_cases| use_cases.draft_exporter.clone())
    else {
        return recipe_export_unavailable(request_id, correlation_id);
    };
    let Some(params) = request.get("params").and_then(Value::as_object) else {
        return recipe_export_invalid_params(request_id, correlation_id);
    };
    // The closed single-key set: exactly projectPath, a non-empty string.
    if params.len() != 1 {
        return recipe_export_invalid_params(request_id, correlation_id);
    }
    let Some(project_path) = params.get("projectPath").and_then(Value::as_str) else {
        return recipe_export_invalid_params(request_id, correlation_id);
    };
    if project_path.is_empty() {
        return recipe_export_invalid_params(request_id, correlation_id);
    }
    // The registration calibration (the packageCatalog same-face
    // discipline): without the 013 aggregate the not-found calibration does
    // not exist, so the whole face stays honestly absent.
    let Some(project_ops) = state.project_ops.clone() else {
        return recipe_export_unavailable(request_id, correlation_id);
    };
    let snapshot = collect_project_inspections(
        &project_ops.vcc_settings_candidates,
        &project_ops.manager_roots,
        &SystemClock,
    );
    let registered = snapshot
        .projects
        .iter()
        .any(|project| project.path == project_path);
    if !registered {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    }
    // The capability gate (declared-none default) BEFORE the port call.
    if !exporter.export_capabilities().export_project_draft {
        return recipe_export_unavailable(request_id, correlation_id);
    }
    match exporter.export_project_draft(project_path) {
        Ok(draft) => {
            let mut result = serde_json::to_value(&draft).unwrap_or_else(|_| json!({}));
            result["schemaVersion"] = json!(RECIPE_EXPORT_SCHEMA_VERSION_V01);
            FrameOutcome::Response(application_success(
                request_id,
                json!({
                    "schemaVersion": RECIPE_EXPORT_ENVELOPE_SCHEMA_VERSION_V01,
                    "operation": "recipe.exportProjectDraft",
                    "result": result,
                }),
            ))
        }
        Err(error) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            &error.code,
            &error.message_key,
            app_error_category(error.category),
        )),
    }
}

/// The recipe-export face's honest absence: the port is not wired, the
/// capability accessor answers declared-none, or the registration
/// calibration face is absent — the route answers the family's own code,
/// never a fabricated draft.
fn recipe_export_unavailable(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.recipe_export.unavailable",
        "errors.recipeExport.unavailable",
        "unavailable",
    ))
}

/// The recipe-export face's params shape verdict: the closed single-key
/// {projectPath} set is violated — a validation failure, never a default,
/// and never a masquerade for honest absence.
fn recipe_export_invalid_params(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.recipe_export.invalid_params",
        "errors.recipeExport.invalidParams",
        "validation",
    ))
}

/// The plan approval/read face (011 section 4): draft -> approved is the
/// user's explicit authorization act and is idempotent; approved plans are
/// the only ones job.execute will accept.
fn plan_request(
    use_cases: Arc<ProductionUseCaseServices>,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    match method {
        "plan.approve" => plan_approve(use_cases, request, request_id, correlation_id),
        "plan.get" => plan_get(use_cases, request, request_id, correlation_id),
        "plan.list" => plan_list(use_cases, request, request_id, correlation_id),
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

/// Canonical SHA-256 over a document's serde serialization (the same
/// serialization rule the planHash anchor uses — insertion order, compact).
/// This is the `recipeDigest` production rule: the whole stored document.
fn document_sha256(document: &Value) -> String {
    let serialized = serde_json::to_string(document).unwrap_or_default();
    let digest = sha2::Sha256::digest(serialized.as_bytes());
    format!(
        "sha256:{}",
        digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    )
}

/// The `localResolutionDigest` production rule (declared here because no
/// frozen schema pins the computation): SHA-256 over the canonical
/// serialization of the resolution conclusions the approved plan carries —
/// `{"jobs": [jobs[].inputs...], "target": target.resolvedSource}`. The
/// plan's resolution face is the materialized Local Resolution fact of this
/// implementation (011 section 5 minimal honest semantics), so hashing that
/// face anchors the facts independently of the lifecycle fields.
fn local_resolution_digest(plan: &Value) -> String {
    let inputs: Vec<Value> = plan
        .get("jobs")
        .and_then(Value::as_array)
        .map(|jobs| {
            jobs.iter()
                .map(|job| job.get("inputs").cloned().unwrap_or(Value::Null))
                .collect()
        })
        .unwrap_or_default();
    let projection = json!({
        "jobs": inputs,
        "target": plan.get("target")
            .and_then(|target| target.get("resolvedSource"))
            .cloned()
            .unwrap_or(Value::Null),
    });
    document_sha256(&projection)
}

/// One approved-plan execution: re-verify the plan hash and lifecycle, run
/// the receipt-side prechecks (version lock first, per 009 stance 4 as the
/// v0.2 protocol restates it), write the plan file into the job directory,
/// assemble the Bridge v2 command (fingerprint optimistic lock), execute it
/// through the Bridge, and transpose the receipt into a Build Record v0.3
/// document: jobs[] is the receipt-bearing ordered prefix of the plan's
/// jobs, planDeviations carries the typed plan-vs-actual deviations
/// (source_fallback / guard_skip / partial_completion), recoveryPoints
/// register the receipt snapshot, and evidenceSummary references the
/// evidence the resolution run published. Returns the Done payload
/// (buildId + receipt summary).
/// Exact version equality for the environment precheck (009 stance 4 ②):
/// major/minor/patch/release kind/number plus the China distribution
/// suffix — a suffixed install never matches the plain version (the
/// unsupported-environment policy).
fn editor_version_matches(
    observed: &vua_orchestrator::ParsedEditorVersion,
    required: &vua_orchestrator::ParsedEditorVersion,
) -> bool {
    observed.major == required.major
        && observed.minor == required.minor
        && observed.patch == required.patch
        && observed.release_kind == required.release_kind
        && observed.release_number == required.release_number
        && observed.china_suffix == required.china_suffix
}

#[allow(clippy::too_many_arguments)]
fn run_approved_plan_job(
    recipes: &RecipeDocumentStore,
    plans: &vua_orchestrator::PlanDocumentStore,
    records: &vua_orchestrator::RecipeRecordStore,
    evidence: &vua_orchestrator::EvidenceStore,
    bridge: &Arc<dyn vua_orchestrator::UnityBridge>,
    project_root: &Path,
    editor_selection: &vua_orchestrator::EditorSelection,
    plan_id: &str,
    correlation_id: &str,
) -> Result<Value, AppErrorV1> {
    // Load + lifecycle gate: only approved plans execute.
    let plan = plans
        .get(plan_id)
        .map_err(|error| {
            AppErrorV1::new(
                "vua.plan.store_failed",
                ErrorCategory::Internal,
                "errors.plan.storeFailed",
                correlation_id,
            )
            .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
        })?
        .ok_or_else(|| {
            AppErrorV1::new(
                "vua.plan.not_found",
                ErrorCategory::Validation,
                "errors.plan.notFound",
                correlation_id,
            )
        })?;
    if plan.get("status").and_then(Value::as_str) != Some("approved") {
        return Err(AppErrorV1::new(
            "vua.plan.not_approved",
            ErrorCategory::Conflict,
            "errors.plan.notApproved",
            correlation_id,
        )
        .with_param(
            "status",
            vua_orchestrator::ParamValue::Text(
                plan.get("status").and_then(Value::as_str).unwrap_or("unknown").to_owned(),
            ),
        ));
    }
    // Integrity gate: the stored document must still hash to its planHash
    // (canonical form without status/planHash - the authorization content).
    let plan_hash = plan_document_hash(&plan);
    if plan.get("planHash").and_then(Value::as_str) != Some(plan_hash.as_str()) {
        return Err(AppErrorV1::new(
            "vua.plan.hash_mismatch",
            ErrorCategory::Conflict,
            "errors.plan.hashMismatch",
            correlation_id,
        ));
    }
    // Version lock precheck (009 stance 4, first in the precheck order): the
    // recipe the plan was resolved from must still be at the planned
    // revision. The optimistic-concurrency save guarantees that an unchanged
    // revision means an unchanged document, so the digest computed here is
    // the digest the approval was made against.
    let recipe_id = plan
        .get("recipeId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let planned_revision = plan
        .get("recipeRevision")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    let stored_recipe = recipes
        .get(&recipe_id)
        .map_err(|error| {
            AppErrorV1::new(
                "vua.recipe.store_failed",
                ErrorCategory::Internal,
                "errors.recipe.storeFailed",
                correlation_id,
            )
            .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
        })?
        .ok_or_else(|| {
            AppErrorV1::new(
                "vua.recipe.not_found",
                ErrorCategory::Validation,
                "errors.recipe.notFound",
                correlation_id,
            )
        })?;
    let current_revision = stored_recipe.revision;
    if current_revision != planned_revision {
        return Err(AppErrorV1::new(
            "vua.recipe.revision_conflict",
            ErrorCategory::Conflict,
            "errors.recipe.revisionConflict",
            correlation_id,
        )
        .with_param("currentRevision", vua_orchestrator::ParamValue::Number(current_revision as f64))
        .with_param("expectedRevision", vua_orchestrator::ParamValue::Number(planned_revision as f64)));
    }
    // Environment precheck (009 stance 4 ②, second in the precheck order):
    // when the recipe declares a machine-parseable Unity version constraint,
    // the editor this job will ACTUALLY use — the assembly-face selection
    // (U10 slice, proposal 021 stance 4) — must satisfy it. Sources weigh
    // the same (a confirmed manual pick or the detected production target):
    // the version must match exactly (major/minor/patch/release
    // kind/number — a China distribution suffix never matches the plain
    // version, mirroring the unsupported-environment policy); an
    // off-target or version-unobservable editor refuses with guidance and
    // never silently executes. An auto-selected candidate is presentation
    // only until the gate-3 first-use confirmation exists (desktop
    // settings face), so it cannot carry a job yet. A recipe without a
    // constraint, or with a constraint that is not a parseable version
    // string, skips this precheck honestly — the plan never invents a
    // compatibility verdict.
    if let Some(constraint) = stored_recipe
        .recipe
        .get("environment")
        .and_then(|environment| environment.get("unityVersionConstraint"))
        .and_then(Value::as_str)
    {
        if let Some(required) = vua_orchestrator::parse_editor_version(constraint) {
            let unmet = |detail: String| {
                AppErrorV1::new(
                    "vua.job.environment_unmet",
                    ErrorCategory::Validation,
                    "errors.job.environmentUnmet",
                    correlation_id,
                )
                .with_param(
                    "requiredVersion",
                    vua_orchestrator::ParamValue::Text(required.display.clone()),
                )
                .with_param("detail", vua_orchestrator::ParamValue::Text(detail))
            };
            match editor_selection {
                vua_orchestrator::EditorSelection::Explicit { path } => {
                    // The confirmed editor this job will execute through:
                    // observe the version its path declares. No parseable
                    // version means the precheck cannot verify the
                    // constraint — refuse rather than guess (the manual
                    // path keeps the Hub layout so verification can run).
                    let observed = vua_orchestrator::editor_version_from_path(path)
                        .and_then(|display| vua_orchestrator::parse_editor_version(&display));
                    match observed {
                        Some(version) if editor_version_matches(&version, &required) => {}
                        Some(version) => {
                            return Err(unmet(format!(
                                "the confirmed editor carries version {}, but the recipe requires {}",
                                version.display, required.display
                            )));
                        }
                        None => {
                            return Err(unmet(
                                "the confirmed editor path carries no parseable Unity \
                                 version; the constraint cannot be verified and the \
                                 editor is never silently used"
                                    .into(),
                            ));
                        }
                    }
                }
                vua_orchestrator::EditorSelection::AutoSelected { editor } => {
                    // The selection layer resolved a production-target
                    // candidate, but the gate-3 first-use confirmation
                    // (desktop settings face) has not released it: no
                    // editor is confirmed for production work yet.
                    return Err(unmet(format!(
                        "the detected production-target editor ({}) awaits the \
                         first-use confirmation in setup; production execution \
                         stays unavailable",
                        editor.parsed.display
                    )));
                }
                vua_orchestrator::EditorSelection::Unavailable { reason } => match reason {
                    vua_orchestrator::EditorSelectionGap::NotDetected => {
                        return Err(unmet(
                            "no Unity editor installation detected on this machine".into(),
                        ));
                    }
                    vua_orchestrator::EditorSelectionGap::NoProductionTarget {
                        observed_versions,
                    } => {
                        return Err(unmet(format!(
                            "the detected editors are off target: {}; install the \
                             production target or confirm a verified editor in setup",
                            observed_versions.join(", ")
                        )));
                    }
                    vua_orchestrator::EditorSelectionGap::DetectionFailed { reason } => {
                        // The observation itself failed: an external
                        // failure, not a config verdict — retryable, never
                        // dressed as "unmet".
                        return Err(AppErrorV1::new(
                            "vua.job.environment_check_failed",
                            ErrorCategory::ExternalFailure,
                            "errors.job.environmentCheckFailed",
                            correlation_id,
                        )
                        .with_recoverable(true)
                        .with_param(
                            "detail",
                            vua_orchestrator::ParamValue::Text(reason.clone()),
                        ));
                    }
                },
            }
        }
        // A free-text constraint (parse_editor_version returning None) or a
        // recipe without a constraint carries no machine-checkable
        // semantics: the precheck skips it rather than guessing a verdict.
    }
    let recipe_digest = document_sha256(&stored_recipe.recipe);
    let local_resolution = local_resolution_digest(&plan);
    let plan_schema_version = plan
        .get("schemaVersion")
        .and_then(Value::as_str)
        .unwrap_or("0.3")
        .to_owned();
    let command_id = format!("job-{}", uuid_v7_identity());
    let started_at = now_rfc3339();

    // Plan file into the job directory (the Bridge reads the file and
    // verifies its local hash against payload.planHash).
    let plan_bytes = serde_json::to_vec_pretty(&plan).map_err(|error| {
        AppErrorV1::new(
            "vua.plan.store_failed",
            ErrorCategory::Internal,
            "errors.plan.storeFailed",
            correlation_id,
        )
        .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
    })?;
    let plan_file = vua_unity_bridge::write_plan_file(
        project_root,
        &command_id,
        &String::from_utf8(plan_bytes).expect("plan bytes are UTF-8"),
    )
    .map_err(|error| {
        AppErrorV1::new(
            "vua.job.plan_file_failed",
            ErrorCategory::Internal,
            "errors.job.planFileFailed",
            correlation_id,
        )
        .with_param("detail", vua_orchestrator::ParamValue::Text(error.0))
    })?;

    // Assemble the Bridge v3 command (the unity-bridge production face
    // migrated 2→3; the production fields are byte-identical).
    // payload.planHash carries the
    // authorization hash (canonical, status-independent - the idempotency
    // key); the file hash travels with the file for the Bridge's local
    // verification.
    let project = vua_orchestrator::ProjectRef {
        id: recipe_id.clone(),
        root: project_root.to_path_buf(),
    };
    let expected_fingerprint = plan
        .get("fingerprint")
        .and_then(|fingerprint| fingerprint.get("expectedProjectFingerprint"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let mut command = vua_unity_bridge::production_job::build_job_command(
        &command_id,
        project.id.as_str(),
        false,
        expected_fingerprint.as_deref(),
        &plan_file,
        &plan_schema_version,
    )
    .map_err(|error| {
        AppErrorV1::new(
            "vua.job.command_failed",
            ErrorCategory::Internal,
            "errors.job.commandFailed",
            correlation_id,
        )
        .with_param("detail", vua_orchestrator::ParamValue::Text(error.0))
    })?;
    command.payload.plan_hash = Some(plan_hash.clone());

    // Execute through the Bridge.
    let result = bridge.execute(&project, &command).map_err(|error| {
        AppErrorV1::new(
            "vua.job.bridge_failed",
            ErrorCategory::ExternalFailure,
            "errors.job.bridgeFailed",
            correlation_id,
        )
        .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
    })?;

    // Top-level record status: succeeded (with/without warnings) or failed.
    let status = match result.status {
        vua_orchestrator::ResultStatus::Succeeded => {
            if result.diagnostics.iter().any(|diagnostic| {
                matches!(
                    diagnostic.severity,
                    vua_orchestrator::DiagnosticSeverity::Warning
                )
            }) {
                "succeeded_with_warnings"
            } else {
                "succeeded"
            }
        }
        vua_orchestrator::ResultStatus::Failed | vua_orchestrator::ResultStatus::Rejected => {
            "failed"
        }
    };
    // The receipt diagnostics travel at the result level (v2 shape); the
    // record transposes them verbatim instead of inventing per-step
    // attribution.
    let result_diagnostics = serde_json::to_value(&result.diagnostics)
        .unwrap_or_else(|_| json!([]));
    let first_error_code = result
        .diagnostics
        .iter()
        .find(|diagnostic| {
            matches!(
                diagnostic.severity,
                vua_orchestrator::DiagnosticSeverity::Error
            )
        })
        .map(|diagnostic| diagnostic.code.clone());

    // Receipt transposition. jobs[] is the receipt-bearing ordered prefix of
    // the plan's jobs (1:1 with resolvedSource); typed deviations record
    // every plan-vs-actual difference the prefix exposes.
    let steps = result
        .data
        .get("steps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let plan_jobs = plan
        .get("jobs")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut record_jobs: Vec<Value> = Vec::new();
    let mut deviations: Vec<Value> = Vec::new();
    let mut failure_seen = false;
    for (index, step) in steps.iter().enumerate() {
        let Some(plan_job) = plan_jobs.get(index) else {
            // The receipt outgrew the plan: no planned identity exists for
            // the surplus steps, so they cannot be transposed into jobs[]
            // (jobId/kind come from the plan vocabulary). The surplus is
            // recorded as a partial-completion deviation detail instead of
            // being silently dropped.
            deviations.push(json!({
                "jobId": plan_jobs.last().and_then(|job| job.get("jobId")).cloned()
                    .unwrap_or(json!(uuid_v7_identity())),
                "deviationKind": "partial_completion",
                "detail": format!(
                    "bridge returned {} steps but the plan declares {} jobs; surplus steps have no planned identity",
                    steps.len(), plan_jobs.len()
                ),
            }));
            break;
        };
        let step_status = step.get("status").and_then(Value::as_str).unwrap_or("");
        if matches!(step_status, "skipped" | "pending") {
            if failure_seen {
                // After a fail-fast these steps are interruption debris, not
                // guard decisions - they stay out of jobs[] and out of the
                // guard_skip vocabulary; the partial_completion deviation
                // below carries the truncation.
                continue;
            }
            // A guard skipped this job before execution: no receipt exists,
            // so the job stays out of jobs[] and the skip is recorded as the
            // typed guard_skip deviation (012 section 3).
            deviations.push(json!({
                "jobId": plan_job.get("jobId").cloned().unwrap_or(Value::Null),
                "deviationKind": "guard_skip",
                "detail": step
                    .get("warning")
                    .and_then(Value::as_str)
                    .filter(|warning| !warning.is_empty())
                    .unwrap_or("bridge skipped this job before execution"),
            }));
            continue;
        }
        let receipt_status = match step_status {
            "executed" => "succeeded",
            "failed" => {
                failure_seen = true;
                "failed"
            }
            _ => continue,
        };
        // resolvedSourceUsed: the receipt is authoritative; when the
        // receipt's source differs from the plan's declaration the
        // difference MUST appear as a source_fallback deviation (double
        // -record cross-evidence, 012 section 3-3). Without a receipt source
        // the plan declaration stands (nothing was observed to differ).
        let planned_source = plan_job
            .get("inputs")
            .and_then(|inputs| inputs.get("resolvedSource"))
            .cloned();
        let mut resolved_source_used = planned_source.clone().unwrap_or(json!({
            "sourceKind": "original",
            "artifactSha256": Value::Null
        }));
        resolved_source_used
            .as_object_mut()
            .map(|source| source.remove("fallbackUsed"));
        if let Some(receipt_source) = step.get("resolvedSource").filter(|value| !value.is_null())
        {
            let differs = match (&planned_source, receipt_source) {
                (Some(planned), receipt) => {
                    planned.get("sourceKind") != receipt.get("sourceKind")
                        || planned.get("artifactSha256") != receipt.get("artifactSha256")
                }
                (None, _) => true,
            };
            if differs {
                deviations.push(json!({
                    "jobId": plan_job.get("jobId").cloned().unwrap_or(Value::Null),
                    "deviationKind": "source_fallback",
                    "detail": format!(
                        "receipt consumed sourceKind={} artifactSha256={} but the plan declares {}",
                        receipt_source.get("sourceKind").and_then(Value::as_str).unwrap_or("unknown"),
                        receipt_source.get("artifactSha256").and_then(Value::as_str).unwrap_or("null"),
                        planned_source.as_ref()
                            .and_then(|source| source.get("sourceKind"))
                            .and_then(Value::as_str)
                            .unwrap_or("no declared source"),
                    ),
                }));
            }
            resolved_source_used = json!({
                "sourceKind": receipt_source.get("sourceKind").cloned().unwrap_or(Value::Null),
                "artifactSha256": receipt_source.get("artifactSha256").cloned().unwrap_or(Value::Null),
                "warehouseItemId": receipt_source.get("warehouseItemId").cloned().unwrap_or(Value::Null),
            });
        }
        let mut job = json!({
            "jobId": plan_job.get("jobId").cloned().unwrap_or(Value::Null),
            "kind": plan_job.get("kind").cloned().unwrap_or(Value::Null),
            "commandId": command_id,
            "planHash": plan_hash,
            "dryRun": false,
            "replayed": result.replayed.unwrap_or(false),
            "status": receipt_status,
            "resolvedSourceUsed": resolved_source_used,
            "changedPaths": result.changed_paths,
            "diagnostics": if receipt_status == "failed" {
                result_diagnostics.clone()
            } else {
                json!([])
            },
        });
        if receipt_status == "failed" {
            job["rejectReason"] = json!(
                first_error_code.clone().unwrap_or_else(|| "unknown".to_owned())
            );
        }
        record_jobs.push(job);
    }
    // A receipt prefix shorter than the plan means the batch partially
    // completed (fail-fast) - the interruption is carried by the top-level
    // status AND by one typed partial_completion deviation pointing at the
    // first unexecuted plan job.
    if record_jobs.len() < plan_jobs.len() {
        if let Some(next_plan_job) = plan_jobs.get(record_jobs.len()) {
            deviations.push(json!({
                "jobId": next_plan_job.get("jobId").cloned().unwrap_or(Value::Null),
                "deviationKind": "partial_completion",
                "detail": format!(
                    "receipt prefix covers {} of {} planned jobs (top-level status: {})",
                    record_jobs.len(), plan_jobs.len(), status
                ),
            }));
        }
    }

    // Recovery points: the receipt's snapshot identity is registered as the
    // pre-job recovery point (009 cross-review point 5). A rejected receipt
    // carries no snapshot - nothing is invented.
    let recovery_points = match &result.snapshot_id {
        Some(snapshot_id) => json!([{
            "snapshotId": snapshot_id,
            "phase": "pre_job",
            "createdAt": now_rfc3339(),
        }]),
        None => json!([]),
    };

    // Evidence summary: the evidence facts the resolution run published,
    // found through their localResolutionId back-reference (identity
    // references - the bodies stay in the evidence store).
    let local_resolution_id = plan
        .get("localResolutionId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let evidence_ids = evidence
        .list_by_local_resolution(&local_resolution_id)
        .map_err(|error| {
            AppErrorV1::new(
                "vua.record.store_failed",
                ErrorCategory::Internal,
                "errors.record.storeFailed",
                correlation_id,
            )
            .with_param("detail", vua_orchestrator::ParamValue::Text(
                format!("evidence listing failed: {error}"),
            ))
        })?;

    let finished_at = now_rfc3339();
    let build_id = uuid_v7_identity();
    let record = json!({
        "schemaVersion": "0.3",
        "buildId": build_id,
        "recipeId": plan.get("recipeId").cloned().unwrap_or(Value::Null),
        "recipeRevision": plan.get("recipeRevision").cloned().unwrap_or(json!(1)),
        "planId": plan_id,
        "planHash": plan_hash,
        "planSchemaVersion": plan_schema_version,
        "environmentId": plan.get("environmentId").cloned().unwrap_or(Value::Null),
        "startedAt": started_at,
        "finishedAt": finished_at,
        "status": status,
        "inputs": {
            "recipeDigest": recipe_digest,
            "localResolutionDigest": local_resolution,
            "planHash": plan_hash,
        },
        "jobs": record_jobs,
        "planDeviations": deviations,
        "recoveryPoints": recovery_points,
        "evidenceSummary": { "evidenceIds": evidence_ids },
    });
    records
        .publish(&build_id, &record)
        .map_err(|error| {
            AppErrorV1::new(
                "vua.record.store_failed",
                ErrorCategory::Internal,
                "errors.record.storeFailed",
                correlation_id,
            )
            .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
        })?;

    Ok(json!({
        "buildId": build_id,
        "status": status,
        "jobsRecorded": record["jobs"].as_array().map(Vec::len).unwrap_or(0),
        "deviationsRecorded": record["planDeviations"].as_array().map(Vec::len).unwrap_or(0),
    }))
}

/// `job.execute`: submits the APPROVED plan for orchestration. The tasked
/// job re-verifies the plan hash and status, writes the plan file into the
/// job directory, assembles the Bridge v3 `execute_production_job` command
/// (fingerprint/lock prechecks per 009 stance 4), executes it through the
/// Bridge, and transposes the receipt into a Build Record v0.3 document
/// (jobs are the receipt-bearing ordered prefix of the plan's jobs).
fn job_execute(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // The tasked half requires the shared task authority and BDL.
    let (Some(runtime), _) = (use_cases.runtime.clone(), use_cases.bdl.clone()) else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.job.unavailable",
            "errors.job.unavailable",
            "unavailable",
        ));
    };
    let Some(plan_id) = request
        .get("params")
        .and_then(|params| params.get("planId"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
    else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.invalid_params",
            "errors.plan.invalidParams",
            "validation",
        ));
    };
    let plans = use_cases.plans.clone();
    let records = use_cases.records.clone();
    let recipes = use_cases.recipes.clone();
    let evidence = use_cases.evidence.clone();
    let bridge = use_cases.bridge.clone();
    let project_root = use_cases.project_root.clone();
    let editor_selection = use_cases.editor_selection.clone();
    let job_correlation = correlation_id.to_owned();
    let accepted = runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let payload = run_approved_plan_job(
                &recipes,
                &plans,
                &records,
                &evidence,
                &bridge,
                &project_root,
                &editor_selection,
                &plan_id,
                &job_correlation,
            )?;
            Ok(vua_orchestrator::TaskExit::Done(payload))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": BDL_COMMANDS_SCHEMA_VERSION,
                "operation": "job.execute",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.store_failed",
            "errors.plan.storeFailed",
            "internal",
        )),
    }
}

fn record_request(
    use_cases: Arc<ProductionUseCaseServices>,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let params = request.get("params").cloned().unwrap_or(json!({}));
    let params_object = params.as_object().ok_or(());
    let _ = params_object;
    match method {
        "record.get" => {
            let Some(build_id) = params
                .get("buildId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            else {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.record.invalid_params",
                    "errors.record.invalidParams",
                    "validation",
                ));
            };
            match use_cases.records.get(build_id) {
                Ok(Some(record)) => FrameOutcome::Response(application_success(
                    request_id,
                    json!({ "buildId": build_id, "recordDocument": record }),
                )),
                Ok(None) => FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.record.not_found",
                    "errors.record.notFound",
                    "validation",
                )),
                Err(_) => FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.record.store_failed",
                    "errors.record.storeFailed",
                    "internal",
                )),
            }
        }
        "record.list" => {
            let allowed = ["recipeId", "status", "text", "limit", "offset"];
            let empty = serde_json::Map::new();
            let params = request
                .get("params")
                .and_then(Value::as_object)
                .unwrap_or(&empty);
            if params.keys().any(|key| !allowed.contains(&key.as_str())) {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.record.invalid_params",
                    "errors.record.invalidParams",
                    "validation",
                ));
            }
            let limit = params
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .clamp(1, 200) as usize;
            let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let text_filter = params
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let recipe_filter = params.get("recipeId").and_then(Value::as_str);
            let status_filter = params.get("status").and_then(Value::as_str);
            let mut documents = match use_cases.records.list_documents() {
                Ok(documents) => documents,
                Err(_) => {
                    return FrameOutcome::Response(application_error(
                        request_id,
                        correlation_id,
                        "vua.record.store_failed",
                        "errors.record.storeFailed",
                        "internal",
                    ))
                }
            };
            documents.sort_by_key(|document| {
                document.get("buildId").and_then(Value::as_str).unwrap_or("").to_owned()
            });
            let filtered: Vec<&Value> = documents
                .iter()
                .filter(|document| {
                    let recipe_match = recipe_filter.is_none_or(|filter| {
                        document.get("recipeId").and_then(Value::as_str) == Some(filter)
                    });
                    let status_match = status_filter.is_none_or(|filter| {
                        document.get("status").and_then(Value::as_str) == Some(filter)
                    });
                    let text_match = text_filter.is_empty();
                    recipe_match && status_match && text_match
                })
                .collect();
            let total = filtered.len();
            let entries: Vec<Value> = filtered
                .iter()
                .skip(offset)
                .take(limit)
                .map(|document| {
                    json!({
                        "buildId": document.get("buildId").cloned().unwrap_or(Value::Null),
                        "planId": document.get("planId").cloned().unwrap_or(Value::Null),
                        "status": document.get("status").cloned().unwrap_or(Value::Null),
                        "finishedAt": document.get("finishedAt").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect();
            FrameOutcome::Response(application_success(
                request_id,
                json!({ "total": total, "entries": entries }),
            ))
        }
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.record.unavailable",
            "errors.record.unavailable",
            "unavailable",
        )),
    }
}

/// M7 inspection slice (proposal 016, hard precondition 2): the
/// `inspection.*` word-list face. Read half = `inspection.get` /
/// `inspection.list` over the inspection-evidence store (data-role v0.1
/// draft shapes; newest-first by performedAt, identity summary rows — the
/// honest detail stays in the evidence body). Write half =
/// `inspection.requestRun`, the tasked command that drives the Bridge
/// producing operations and publishes the evidence bundle. Unwired faces
/// answer typed `vua.inspection.unavailable` — honest absence.
fn inspection_request(
    use_cases: Arc<ProductionUseCaseServices>,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    match method {
        "inspection.get" => {
            let empty = serde_json::Map::new();
            let params = request
                .get("params")
                .and_then(Value::as_object)
                .unwrap_or(&empty);
            let allowed = ["inspectionId"];
            if params.keys().any(|key| !allowed.contains(&key.as_str())) {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.inspection.invalid_params",
                    "errors.inspection.invalidParams",
                    "validation",
                ));
            }
            let Some(inspection_id) = params
                .get("inspectionId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            else {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.inspection.invalid_params",
                    "errors.inspection.invalidParams",
                    "validation",
                ));
            };
            match use_cases.inspections.get(inspection_id) {
                Ok(Some(document)) => FrameOutcome::Response(application_success(
                    request_id,
                    json!({
                        "inspectionId": inspection_id,
                        "inspectionDocument": document,
                        "schemaVersion": INSPECTION_QUERIES_SCHEMA_VERSION,
                    }),
                )),
                Ok(None) => FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.inspection.not_found",
                    "errors.inspection.notFound",
                    "validation",
                )),
                Err(_) => FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.inspection.store_failed",
                    "errors.inspection.storeFailed",
                    "internal",
                )),
            }
        }
        "inspection.list" => {
            let allowed = ["avatarRef", "overallStatus", "limit", "offset"];
            let empty = serde_json::Map::new();
            let params = request
                .get("params")
                .and_then(Value::as_object)
                .unwrap_or(&empty);
            if params.keys().any(|key| !allowed.contains(&key.as_str())) {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.inspection.invalid_params",
                    "errors.inspection.invalidParams",
                    "validation",
                ));
            }
            if let Some(status) = params.get("overallStatus").and_then(Value::as_str) {
                if !matches!(status, "pass" | "warn" | "fail") {
                    return FrameOutcome::Response(application_error(
                        request_id,
                        correlation_id,
                        "vua.inspection.invalid_params",
                        "errors.inspection.invalidParams",
                        "validation",
                    ));
                }
            }
            if params
                .get("avatarRef")
                .is_some_and(|value| !value.is_string())
            {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.inspection.invalid_params",
                    "errors.inspection.invalidParams",
                    "validation",
                ));
            }
            let limit = params
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .clamp(1, 200) as usize;
            let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let avatar_filter = params.get("avatarRef").and_then(Value::as_str);
            let status_filter = params.get("overallStatus").and_then(Value::as_str);
            let mut documents = match use_cases.inspections.list_documents() {
                Ok(documents) => documents,
                Err(_) => {
                    return FrameOutcome::Response(application_error(
                        request_id,
                        correlation_id,
                        "vua.inspection.store_failed",
                        "errors.inspection.storeFailed",
                        "internal",
                    ))
                }
            };
            // Newest first: performedAt is an RFC 3339 UTC string, so
            // lexicographic order IS chronological order (same declared
            // face as the production_card newest-first semantics).
            documents.sort_by(|left, right| {
                let left_key = left.get("performedAt").and_then(Value::as_str).unwrap_or("");
                let right_key = right.get("performedAt").and_then(Value::as_str).unwrap_or("");
                right_key.cmp(left_key).then_with(|| {
                    // Stable tie-break on identity so equal timestamps stay
                    // deterministically ordered.
                    let left_id = left.get("inspectionId").and_then(Value::as_str).unwrap_or("");
                    let right_id = right.get("inspectionId").and_then(Value::as_str).unwrap_or("");
                    right_id.cmp(left_id)
                })
            });
            let filtered: Vec<&Value> = documents
                .iter()
                .filter(|document| {
                    let avatar_match = avatar_filter.is_none_or(|filter| {
                        document
                            .pointer("/avatarRef/ref")
                            .and_then(Value::as_str)
                            == Some(filter)
                    });
                    let status_match = status_filter.is_none_or(|filter| {
                        document.get("overallStatus").and_then(Value::as_str) == Some(filter)
                    });
                    avatar_match && status_match
                })
                .collect();
            let total = filtered.len();
            let entries: Vec<Value> = filtered
                .iter()
                .skip(offset)
                .take(limit)
                .map(|document| {
                    json!({
                        "inspectionId": document.get("inspectionId").cloned().unwrap_or(Value::Null),
                        "avatarRef": document.get("avatarRef").cloned().unwrap_or(Value::Null),
                        "overallStatus": document.get("overallStatus").cloned().unwrap_or(Value::Null),
                        "performedAt": document.get("performedAt").cloned().unwrap_or(Value::Null),
                    })
                })
                .collect();
            FrameOutcome::Response(application_success(
                request_id,
                json!({
                    "total": total,
                    "entries": entries,
                    "schemaVersion": INSPECTION_QUERIES_SCHEMA_VERSION,
                }),
            ))
        }
        "inspection.requestRun" => inspection_request_run(
            use_cases,
            request,
            request_id,
            correlation_id,
        ),
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.inspection.unavailable",
            "errors.inspection.unavailable",
            "unavailable",
        )),
    }
}

/// `inspection.requestRun`: accepts an inspection task idempotently-free
/// (each run is a new observation with a fresh uuid-v7 identity, exactly
/// like job.execute) and drives the Bridge producing operations on the
/// shared task authority. Unwired task authority answers a typed
/// unavailable — honest absence, never a silent success.
fn inspection_request_run(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(runtime) = use_cases.runtime.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.inspection.unavailable",
            "errors.inspection.unavailable",
            "unavailable",
        ));
    };
    let Some(params) = request.get("params") else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.inspection.invalid_params",
            "errors.inspection.invalidParams",
            "validation",
        ));
    };
    let allowed = ["avatarRef", "avatarGlobalObjectId"];
    let unknown_param = params
        .as_object()
        .is_some_and(|object| object.keys().any(|key| !allowed.contains(&key.as_str())));
    let avatar_global_object_id = params
        .pointer("/avatarGlobalObjectId")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    let avatar_ref = params.get("avatarRef");
    let avatar_ref_valid = avatar_ref
        .map(|reference| {
            reference.is_object()
                && reference
                    .pointer("/ref")
                    .and_then(Value::as_str)
                    .is_some_and(|reference_value| !reference_value.is_empty())
                && reference
                    .pointer("/label")
                    .map(|label| label.is_string() || label.is_null())
                    .unwrap_or(true)
        })
        .unwrap_or(false);
    if unknown_param || avatar_global_object_id.is_none() || !avatar_ref_valid {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.inspection.invalid_params",
            "errors.inspection.invalidParams",
            "validation",
        ));
    }
    let inspections = use_cases.inspections.clone();
    let bridge = use_cases.bridge.clone();
    let project_root = use_cases.project_root.clone();
    let editor_version = use_cases.editor_version.clone();
    let avatar_ref = avatar_ref.cloned().unwrap_or(Value::Null);
    let avatar_global_object_id = avatar_global_object_id.unwrap_or_default();
    let run_correlation = correlation_id.to_owned();
    let accepted = runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let payload = run_inspection_job(
                &inspections,
                &bridge,
                &project_root,
                &editor_version,
                &avatar_ref,
                &avatar_global_object_id,
                &run_correlation,
            )?;
            Ok(vua_orchestrator::TaskExit::Done(payload))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": INSPECTION_QUERIES_SCHEMA_VERSION,
                "operation": "inspection.requestRun",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.inspection.store_failed",
            "errors.inspection.storeFailed",
            "internal",
        )),
    }
}

/// The inspection run executor (task job): drives the five producing
/// operations (two v1 typed checks, three v3 read-only inspection
/// operations — the v3 operations are the accepted Bridge v3 superset face;
/// the production job face stays on v2 untouched), transcribes each receipt
/// into its dimension (转抄不解释), aggregates the declared rule, and
/// publishes the evidence bundle exactly once. A run in which the Bridge
/// produced no receipt at all fails with a typed error and publishes
/// nothing — an evidence bundle with zero observed operations would be a
/// fabricated document.
#[allow(clippy::too_many_arguments)]
fn run_inspection_job(
    inspections: &vua_orchestrator::InspectionEvidenceStore,
    bridge: &Arc<dyn vua_orchestrator::UnityBridge>,
    project_root: &std::path::Path,
    editor_version: &str,
    avatar_ref: &Value,
    avatar_global_object_id: &str,
    correlation_id: &str,
) -> Result<Value, AppErrorV1> {
    let inspection_id = uuid_v7_identity();
    let project = vua_orchestrator::ProjectRef {
        // Run-scope correlation identity (the production job precedent
        // passes the driving workflow's id, not a filesystem-derived one).
        id: format!("inspection-{inspection_id}"),
        root: project_root.to_path_buf(),
    };
    let producing = vua_orchestrator::producing_operations();
    let mut operations: Vec<Value> = Vec::new();
    let mut dimensions: Vec<Value> = Vec::new();
    let mut unavailable: Vec<&'static str> = Vec::new();
    for (index, (dimension, operation, schema_version, basis)) in producing.iter().enumerate() {
        let command_id = format!("{inspection_id}-{index:02}");
        let command = vua_orchestrator::build_inspection_command(
            &command_id,
            &project.id,
            *operation,
            avatar_global_object_id,
        );
        debug_assert_eq!(command.schema_version, *schema_version);
        match bridge.execute(&project, &command) {
            Ok(result) => {
                operations.push(json!({
                    "operation": serde_json::to_value(operation).unwrap_or(Value::Null),
                    "commandId": result.command_id,
                    "status": vua_orchestrator::operation_status(result.status),
                }));
                let receipt = serde_json::to_value(&result).unwrap_or(Value::Null);
                dimensions.push(vua_orchestrator::transcribe_dimension(
                    *dimension,
                    basis,
                    Some(&receipt),
                ));
            }
            Err(_) => {
                // No receipt exists: the dimension is honestly absent. The
                // operation contributes no evidence-operations entry.
                unavailable.push(dimension.kind());
                dimensions.push(vua_orchestrator::transcribe_dimension(
                    *dimension,
                    basis,
                    None,
                ));
            }
        }
    }
    if operations.is_empty() {
        return Err(AppErrorV1::new(
            "vua.inspection.bridge_failed",
            ErrorCategory::ExternalFailure,
            "errors.inspection.bridgeFailed",
            correlation_id,
        ));
    }
    let overall_status = vua_orchestrator::aggregate_overall_status(&dimensions);
    let mut notes = "性能维 basis=bridge_local_estimate 为本地结构估算，不是 VRChat 官方性能等级。".to_owned();
    if !unavailable.is_empty() {
        notes.push_str(&format!(
            "本次未观测维度（{}）以 unavailable 如实缺席。",
            unavailable.join("、")
        ));
    }
    let document = json!({
        "schemaVersion": vua_orchestrator::INSPECTION_EVIDENCE_SCHEMA_VERSION,
        "inspectionId": inspection_id,
        "avatarRef": avatar_ref,
        "performedAt": now_rfc3339(),
        "bridge": {
            "editorVersion": editor_version,
            "bridgeSchemaVersion": 3,
            "operations": operations,
        },
        "dimensions": dimensions,
        "overallStatus": overall_status,
        "notes": notes,
    });
    inspections
        .publish(&inspection_id, &document)
        .map_err(|error| {
            AppErrorV1::new(
                "vua.inspection.store_failed",
                ErrorCategory::Internal,
                "errors.inspection.storeFailed",
                correlation_id,
            )
            .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
        })?;
    Ok(json!({
        "kind": "inspection.requestRun",
        "inspectionId": inspection_id,
        "overallStatus": overall_status,
    }))
}

/// plan.list: identity listing over stored plans. Closed param set
/// (catalog.list precedent): recipeId/status/text/limit/offset; unknown
/// keys are contract errors. Sorted by planId (identity-derived).
#[allow(clippy::needless_option_as_deref)]
fn plan_list(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let allowed = ["recipeId", "status", "text", "limit", "offset"];
    let empty = serde_json::Map::new();
    let params = request
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    if params.keys().any(|key| !allowed.contains(&key.as_str())) {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.invalid_params",
            "errors.plan.invalidParams",
            "validation",
        ));
    }
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 200) as usize;
    let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let text_filter = params
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let recipe_filter = params.get("recipeId").and_then(Value::as_str);
    let status_filter = params.get("status").and_then(Value::as_str);

    let mut documents = match use_cases.plans.list_documents() {
        Ok(documents) => documents,
        Err(_) => {
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.plan.store_failed",
                "errors.plan.storeFailed",
                "internal",
            ))
        }
    };
    documents.sort_by_key(|document| {
        document.get("planId").and_then(Value::as_str).unwrap_or("").to_owned()
    });
    let filtered: Vec<&Value> = documents
        .iter()
        .filter(|document| {
            let recipe_match = recipe_filter.is_none_or(|filter| {
                document.get("recipeId").and_then(Value::as_str) == Some(filter)
            });
            let status_match = status_filter.is_none_or(|filter| {
                document.get("status").and_then(Value::as_str) == Some(filter)
            });
            let text_match = text_filter.is_empty()
                || document
                    .get("title")
                    .and_then(Value::as_str)
                    .map(|title| title.to_lowercase().contains(&text_filter))
                    .unwrap_or(false);
            recipe_match && status_match && text_match
        })
        .collect();
    let total = filtered.len();
    let entries: Vec<Value> = filtered
        .iter()
        .skip(offset)
        .take(limit)
        .map(|document| {
            json!({
                "planId": document.get("planId").cloned().unwrap_or(Value::Null),
                "recipeId": document.get("recipeId").cloned().unwrap_or(Value::Null),
                "status": document.get("status").cloned().unwrap_or(Value::Null),
                "approvedAt": document.get("approvedAt").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    FrameOutcome::Response(application_success(
        request_id,
        json!({ "total": total, "entries": entries }),
    ))
}

fn plan_approve(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // Closed set: { planId }.
    let Some(plan_id) = request
        .get("params")
        .and_then(|params| params.get("planId"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.invalid_params",
            "errors.plan.invalidParams",
            "validation",
        ));
    };
    match use_cases.plans.approve(plan_id) {
        Ok(vua_orchestrator::ApproveOutcome::Approved) => {
            FrameOutcome::Response(application_success(
                request_id,
                json!({ "planId": plan_id, "planStatus": "approved" }),
            ))
        }
        Ok(vua_orchestrator::ApproveOutcome::AlreadyApproved) => {
            FrameOutcome::Response(application_success(
                request_id,
                json!({ "planId": plan_id, "planStatus": "approved" }),
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => {
            FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.plan.not_approvable",
                "errors.plan.notApprovable",
                "conflict",
            ))
        }
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.store_failed",
            "errors.plan.storeFailed",
            "internal",
        )),
    }
}

fn plan_get(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(plan_id) = request
        .get("params")
        .and_then(|params| params.get("planId"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.invalid_params",
            "errors.plan.invalidParams",
            "validation",
        ));
    };
    match use_cases.plans.get(plan_id) {
        Ok(Some(document)) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "planId": plan_id,
                "planStatus": document.get("status").cloned().unwrap_or(Value::Null),
                "planDocument": document,
            }),
        )),
        Ok(None) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.not_found",
            "errors.plan.notFound",
            "validation",
        )),
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.plan.store_failed",
            "errors.plan.storeFailed",
            "internal",
        )),
    }
}

/// Honest absence helpers: the Local Resolution executor (recipe.resolve),
/// the job orchestration (job.execute) and the Build Record read face
/// (record.*) arrive in the next cut — the frozen vocabulary answers a
/// typed unavailable, never a silent stub.
fn plan_unavailable(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.plan.unavailable",
        "errors.plan.unavailable",
        "unavailable",
    ))
}

fn job_unavailable(_state: &HostState, request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.job.unavailable",
        "errors.job.unavailable",
        "unavailable",
    ))
}

fn record_unavailable(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.record.unavailable",
        "errors.record.unavailable",
        "unavailable",
    ))
}

/// `recipe.resolve`: submits the Local Resolution executor as a tasked
/// operation (011 §7 — may be heavy). The Done payload carries the draft
/// plan id, the missing-asset count and the evidence identities; the draft
/// plan itself is read back through plan.get.
fn recipe_resolve(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // Closed set: { recipeId }.
    let Some(recipe_id) = request
        .get("params")
        .and_then(|params| params.get("recipeId"))
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
    else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.recipe.invalid_params",
            "errors.recipe.invalidParams",
            "validation",
        ));
    };
    // The tasked half requires the shared task authority and BDL (warehouse
    // wiring). Without them: typed unavailable, never a silent stub.
    let (Some(runtime), Some(bdl)) = (use_cases.runtime.clone(), use_cases.bdl.clone()) else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.recipe.resolve_unavailable",
            "errors.recipe.resolveUnavailable",
            "unavailable",
        ));
    };
    let recipes = use_cases.recipes.clone();
    let plans = use_cases.plans.clone();
    let evidence = use_cases.evidence.clone();
    let env_initial = use_cases.env_initial.unwrap_or(ArtifactMode::UseOriginalUnitypackage);
    let job_correlation = correlation_id.to_owned();
    let accepted = runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let payload = run_local_resolution(
                &bdl,
                &recipes,
                &plans,
                &evidence,
                env_initial,
                &recipe_id,
                &job_correlation,
            )?;
            Ok(vua_orchestrator::TaskExit::Done(payload))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": BDL_COMMANDS_SCHEMA_VERSION,
                "operation": "recipe.resolve",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.recipe.store_failed",
            "errors.recipe.storeFailed",
            "internal",
        )),
    }
}

fn recipe_invalid_params(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.recipe.invalid_params",
        "errors.recipe.invalidParams",
        "validation",
    ))
}

fn recipe_store_failed(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.recipe.store_failed",
        "errors.recipe.storeFailed",
        "internal",
    ))
}

fn recipe_not_found(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.recipe.not_found",
        "errors.recipe.notFound",
        "validation",
    ))
}

fn recipe_save(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // Closed set: { recipeDocument, baseRevision }.
    let params = match request.get("params").and_then(Value::as_object) {
        Some(params) => params,
        None => return recipe_invalid_params(request_id, correlation_id),
    };
    if params.keys().any(|key| key != "recipeDocument" && key != "baseRevision") {
        return recipe_invalid_params(request_id, correlation_id);
    }
    let Some(recipe_document) = params.get("recipeDocument").filter(|value| value.is_object()) else {
        return recipe_invalid_params(request_id, correlation_id);
    };
    let Some(base_revision) = params.get("baseRevision").and_then(Value::as_u64) else {
        return recipe_invalid_params(request_id, correlation_id);
    };
    // The document identity must come from the body (single source of identity).
    let Some(recipe_id) =
        recipe_document.get("recipeId").and_then(Value::as_str).map(str::to_owned)
    else {
        return recipe_invalid_params(request_id, correlation_id);
    };
    match use_cases.recipes.save(&recipe_id, recipe_document, base_revision) {
        Ok(stored) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "recipeId": recipe_id,
                "revision": stored.revision,
                "updatedAt": stored.updated_at,
            }),
        )),
        Err(vua_orchestrator::RecipeSaveError::RevisionConflict { current_revision }) => {
            let mut envelope = application_error(
                request_id,
                correlation_id,
                "vua.recipe.revision_conflict",
                "errors.recipe.revisionConflict",
                "conflict",
            );
            if let Some(error_object) = envelope.get_mut("error") {
                error_object["currentRevision"] = json!(current_revision);
            }
            FrameOutcome::Response(envelope)
        }
        Err(_) => recipe_store_failed(request_id, correlation_id),
    }
}

fn recipe_get(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let params = request.get("params").cloned().unwrap_or(json!({}));
    if !params.as_object().map(|object| object.len()).map(|len| len == 1).unwrap_or(false) {
        return recipe_invalid_params(request_id, correlation_id);
    }
    let Some(recipe_id) = params.get("recipeId").and_then(Value::as_str) else {
        return recipe_invalid_params(request_id, correlation_id);
    };
    if recipe_id.is_empty() {
        return recipe_invalid_params(request_id, correlation_id);
    }
    match use_cases.recipes.get(recipe_id) {
        Ok(Some(stored)) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "recipeId": recipe_id,
                "revision": stored.revision,
                "updatedAt": stored.updated_at,
                "recipeDocument": stored.recipe,
            }),
        )),
        Ok(None) => recipe_not_found(request_id, correlation_id),
        Err(_) => recipe_store_failed(request_id, correlation_id),
    }
}

fn recipe_list(
    use_cases: Arc<ProductionUseCaseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // Closed set (catalog.list precedent): text/limit/offset; unknown keys
    // are contract errors (012 data stance).
    if let Some(Value::Object(params)) = request.get("params") {
        let allowed = ["text", "limit", "offset"];
        if params.keys().any(|key| !allowed.contains(&key.as_str())) {
            return recipe_invalid_params(request_id, correlation_id);
        }
    }
    let all = match use_cases.recipes.list() {
        Ok(all) => all,
        Err(_) => return recipe_store_failed(request_id, correlation_id),
    };
    let text_filter = request
        .get("params")
        .and_then(|params| params.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let limit = request
        .get("params")
        .and_then(|params| params.get("limit"))
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .clamp(1, 200) as usize;
    let offset = request
        .get("params")
        .and_then(|params| params.get("offset"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let filtered: Vec<_> = all
        .into_iter()
        .filter(|entry| {
            text_filter.is_empty() || entry.title.to_lowercase().contains(&text_filter)
        })
        .collect();
    let total = filtered.len();
    let page: Vec<Value> = filtered
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|entry| {
            json!({
                "recipeId": entry.recipe_id,
                "revision": entry.revision,
                "title": entry.title,
                "updatedAt": entry.updated_at,
            })
        })
        .collect();
    FrameOutcome::Response(application_success(
        request_id,
        json!({ "total": total, "entries": page }),
    ))
}

/// W12 closeout: the catalog read face (bdl-queries v0.3) — the three
/// cloud-catalog queries over the same BDL the warehouse surface serves.
/// The assembly (bdl-store) produces the result payload; this face wraps it
/// into the frozen `{ schemaVersion, operation, result }` document. Params
/// closed-set violations are contract errors, never silently empty answers;
/// a detail miss (tombstones included — they are observation-side data and
/// never catalog cards) is the application-face product_not_found.
/// `environment.getSnapshot` (BG-16 wiring): with the environment
/// configuration present the handler consumes
/// `EnvironmentEngine::inspect_all()` verbatim — the items ARE the
/// frozen check vocabulary (checkId/zone/presence/errorCode/facts), and
/// `capturedAt` travels with them. Without the configuration the
/// detection face is not wired: an empty items list is the honest empty
/// (frozen by the B6 spike — an empty list is never a ready verdict),
/// not a fabricated probe result.
fn environment_get_snapshot(state: &mut HostState, request_id: &str) -> Result<FrameOutcome, SqliteStoreError> {
    let revision = state.store.application_revision()?;
    let snapshot = match state.environment.as_ref() {
        Some(services) => services.engine.inspect_all(),
        None => vua_orchestrator::EnvironmentSnapshotV1 {
            schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
            items: vec![],
            captured_at: now_rfc3339(),
        },
    };
    let items = serde_json::to_value(&snapshot.items)
        .expect("EnvironmentCheckItemV01 serialization cannot fail");
    Ok(FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "revision": revision,
            "capturedAt": snapshot.captured_at,
            "items": items,
        }),
    )))
}

/// The `environment.verifyEditor` query face (proposal 021 vocabulary row,
/// core ruling 2026-09-13 seven points): verifies ONE user-picked Unity
/// editor path through the detection-domain primitive of record
/// (`verify_editor_path_system`, project-manager) and maps the verdict onto
/// the frozen two-state result — the route carries the wire mapping only,
/// zero verification logic of its own.
///
/// The three implementation nails (ruling point 4):
/// - **Nail 1**: a refusal NEVER surfaces as an application error envelope —
///   refused is a normal in-result finding (`verdict:"refused"`), because a
///   refusal is a finding, not a failure. The envelope error face stays
///   reserved for transport / request-shape violations.
/// - **Nail 2**: the refusal `detail` carries the primitive's raw resource
///   text verbatim — the wire layer re-interprets nothing.
/// - **Nail 3**: the envelope `schemaVersion` is this row's own
///   [`EDITOR_VERIFY_SCHEMA_VERSION`] const, never a borrowed family
///   version.
///
/// Params are the closed single-key set `{path}` (ruling point 3): the
/// user-picked path travels verbatim in all three accepted layouts — the
/// route normalizes nothing (normalization is the primitive's job) and
/// sets no maxLength on purpose. Request-shape violations answer a typed
/// validation error; they are never verification refusals.
fn environment_verify_editor(
    state: &HostState,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> Result<FrameOutcome, SqliteStoreError> {
    let invalid_params = || {
        FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.environment.invalid_params",
            "errors.environment.invalidParams",
            "validation",
        ))
    };
    let Some(params) = request.get("params").and_then(Value::as_object) else {
        return Ok(invalid_params());
    };
    if params.len() != 1 {
        return Ok(invalid_params());
    }
    let Some(path) = params.get("path").and_then(Value::as_str) else {
        return Ok(invalid_params());
    };
    if path.is_empty() {
        return Ok(invalid_params());
    }
    let result = match (state.editor_verify)(Path::new(path)) {
        EditorPathVerdict::Verified(identity) => json!({
            "verdict": "verified",
            "editorRoot": identity.editor_root,
            "exePath": identity.exe_path,
            "version": identity.version,
            "classification": identity.classification,
            "guidanceCode": identity.guidance_code,
            "chinaDistribution": identity.china_distribution,
            "schemaVersion": EDITOR_VERIFY_SCHEMA_VERSION,
        }),
        EditorPathVerdict::Refused(refusal) => json!({
            "verdict": "refused",
            "exePath": refusal.exe_path,
            "code": refusal.code,
            "detail": refusal.detail,
            "schemaVersion": EDITOR_VERIFY_SCHEMA_VERSION,
        }),
    };
    Ok(FrameOutcome::Response(application_success(request_id, result)))
}

/// The overlay read face (proposal 017 batch 1, `overlay.getSnapshot`):
/// one polling query serving the overlay's one-glance surface — the task
/// cards plus the production-status card, both pure projections of the
/// authorities (017 §2: querying never changes what is observed, so the
/// payload carries no query instant and no aggregate revision — an
/// invented one would be a cross-source fact and would break the
/// pure-function discipline the polling overlay depends on; the desktop
/// stances 1–2 are honored by construction: the overlay polls on demand
/// over the same provider connection and carries no overlay session
/// identity — the query face is indistinguishable from the main line's).
///
/// Availability follows the production use-case wiring (the very stores
/// the plan/record faces serve): when absent, the method answers a typed
/// `vua.overlay.unavailable` — honest absence, never a silent success
/// (the same discipline as `production.*` / `record.*`). Params are a
/// closed empty set; unknown keys are contract errors.
fn overlay_get_snapshot(
    state: &HostState,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> Result<FrameOutcome, SqliteStoreError> {
    let params_is_open = request
        .get("params")
        .and_then(Value::as_object)
        .map(|params| !params.is_empty())
        .unwrap_or(false);
    if params_is_open {
        return Ok(FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.overlay.invalid_params",
            "errors.overlay.invalidParams",
            "validation",
        )));
    }
    let Some(use_cases) = state.use_cases.clone() else {
        return Ok(FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.overlay.unavailable",
            "errors.overlay.unavailable",
            "unavailable",
        )));
    };
    let model = StoreOverlayReadModel::new(
        state.store.clone(),
        use_cases.plans.clone(),
        use_cases.records.clone(),
    );
    // A task-store read failure propagates as the store error (the same
    // face task.list answers through); a production document-store read
    // failure is its own typed contract error — never folded into an
    // empty card (failures are presented as failures).
    let tasks = model.task_cards()?;
    let downloads = model.download_card()?;
    let production = match model.production_card() {
        Ok(card) => card,
        Err(_) => {
            return Ok(FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.overlay.store_failed",
                "errors.overlay.storeFailed",
                "internal",
            )))
        }
    };
    Ok(FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "tasks": serde_json::to_value(&tasks)
                .expect("OverlayTaskCard serialization cannot fail"),
            "productionCard": serde_json::to_value(&production)
                .expect("OverlayProductionCard serialization cannot fail"),
            "downloadCard": serde_json::to_value(&downloads)
                .expect("OverlayDownloadCard serialization cannot fail"),
        }),
    )))
}

/// The `release.openForHandoff` route (proposal 023 freeze batch,
/// 2026-09-16; implementation wiring = follow-up slice 2; v0.2 = the U19
/// record-state gate, 2026-09-21). The tasked command that hands the user
/// to the START of the official SDK upload flow. Handoff semantics per the
/// product boundary: the upload itself never enters VUA; the succeeded task
/// snapshot's result carries the handoff fact document — a shape with no
/// upload-status field at all, so honesty rules 1/2 hold by construction
/// (the negative vector pins it).
///
/// Admission flow (validation ordering preserved): the params closed set
/// `{buildId}` is checked FIRST — a closed-set violation answers
/// `vua.release_handoff.invalid_params` (a shape violation never
/// masquerades as an absence). Then the unwired faces answer the honest
/// absence: no task runtime, or an explicitly port-less assembly (since
/// the 023 assembly slice the DEFAULT assembly wires the real
/// process/window adapter `EditorHandoffAdapter`, so the port-less
/// `unavailable` answer is the exception path of assemblies that choose
/// absence, not the production default). With the port wired, admission
/// validates the
/// build-record identity: an unknown buildId answers
/// `vua.release_handoff.build_unknown` (admission-time validation — no
/// task is accepted for a record that does not exist), a record-store
/// read failure answers `unavailable` (the existence could not be
/// determined — retryable, never dressed as "unknown"), and an
/// unresolvable editor identity answers
/// `vua.release_handoff.editor_unresolved` (ruling 5; diagnosis reuses
/// the verifyEditor semantics).
///
/// v0.2 record-state gate (U19 user ruling, BOARD row = normative source):
/// between the record read and the identity resolution, the record's
/// `status` is classified backend-authoritatively against the ruling
/// whitelist — `succeeded` / `succeeded_with_warnings` pass (the warning
/// presentation stays a desktop concern; the record is never rewritten),
/// `failed` / `cancelled` / `rolled_back` / `recovered` answer
/// `vua.release_handoff.record_state_blocked` (typed rejection carrying
/// the record's original state value as the `state` param — the desktop
/// words its diagnostic / recovery / re-production entry around it), and a
/// missing / non-string / out-of-enum status answers
/// `vua.release_handoff.record_state_unknown` (the record cannot be
/// confirmed). The gate is a policy check, never a state rewrite:
/// `recovered` blocks like the other terminal states because a completed
/// inspection does not turn a failed history record into a success
/// (ruling correction b), and a whitelisted state is no guarantee the
/// project still matches the record (correction c — this gate prevents
/// obviously wrong handoffs, nothing more). Only then is the task
/// accepted — the task nine states carry ONLY the long-running part
/// (launch + handshake wait), never the admission checks.
fn release_open_for_handoff(
    state: &HostState,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> Result<FrameOutcome, SqliteStoreError> {
    let admission = match admit_editor_open(state, request, request_id, correlation_id, true) {
        Ok(admission) => admission,
        Err(response) => return Ok(FrameOutcome::Response(response)),
    };
    submit_editor_open_task(
        admission,
        request_id,
        correlation_id,
        "release.openForHandoff",
        vua_orchestrator::build_handoff_fact,
    )
}

/// The `release.openForInspection` route (U19 v0.2, 2026-09-21): the
/// explicit independent "open in Unity to inspect/fix" path. The ruling
/// keeps this path OPEN regardless of the build record's state — opening
/// the editor is neither recovery-execution nor upload permission, so a
/// user may always open the project to look at it and fix it. Admission is
/// the handoff admission MINUS the state gate: params closed set, wired
/// faces, record existence (`build_unknown`), project identity and editor
/// resolution only. The completion fact is `build_inspection_fact` — its
/// explicit `operation: "release.openForInspection"` key means the
/// wording can never be read as a handoff completion (never "交接完成").
fn release_open_for_inspection(
    state: &HostState,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> Result<FrameOutcome, SqliteStoreError> {
    let admission = match admit_editor_open(state, request, request_id, correlation_id, false) {
        Ok(admission) => admission,
        Err(response) => return Ok(FrameOutcome::Response(response)),
    };
    submit_editor_open_task(
        admission,
        request_id,
        correlation_id,
        vua_orchestrator::OPEN_FOR_INSPECTION_OPERATION,
        vua_orchestrator::build_inspection_fact,
    )
}

/// Everything the shared admission sequence established for one
/// editor-open entry (handoff or inspection): the record anchor, the
/// project identity resolved from the record, the editor identity
/// resolved per ruling 5, and the checked wiring (runtime + port +
/// trusted-side project root) so the acceptance re-fetches nothing.
struct EditorOpenAdmission {
    build_id: String,
    project_id: String,
    resolved: vua_orchestrator::HandoffEditorCandidate,
    runtime: TaskRuntime,
    port: std::sync::Arc<dyn vua_orchestrator::ReleaseHandoffPort>,
    project_root: PathBuf,
}

/// The shared admission sequence of the two editor-open entries (U19 v0.2):
/// `release.openForHandoff` and `release.openForInspection` differ in
/// exactly two points — the record-state gate (`enforce_state_gate`) and
/// the completion fact wording. Everything here is backend-authoritative:
/// no UI decision can admit a handoff the gate refuses, and no UI refusal
/// is needed for a handoff the gate admits. `Ok` carries the admission,
/// `Err` carries the ready error response payload.
fn admit_editor_open(
    state: &HostState,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
    enforce_state_gate: bool,
) -> Result<EditorOpenAdmission, Value> {
    let params_ok = request
        .get("params")
        .and_then(Value::as_object)
        .map(|params| {
            params.len() == 1
                && params
                    .get("buildId")
                    .and_then(Value::as_str)
                    .map(|build_id| !build_id.is_empty())
                    .unwrap_or(false)
        })
        .unwrap_or(false);
    if !params_ok {
        return Err(application_error(
            request_id,
            correlation_id,
            "vua.release_handoff.invalid_params",
            "errors.releaseHandoff.invalidParams",
            "validation",
        ));
    }
    let Some(use_cases) = state.use_cases.clone() else {
        return Err(application_error(
            request_id,
            correlation_id,
            RELEASE_HANDOFF_UNAVAILABLE,
            "errors.releaseHandoff.unavailable",
            "unavailable",
        ));
    };
    let Some(runtime) = use_cases.runtime.clone() else {
        return Err(application_error(
            request_id,
            correlation_id,
            RELEASE_HANDOFF_UNAVAILABLE,
            "errors.releaseHandoff.unavailable",
            "unavailable",
        ));
    };
    let Some(port) = use_cases.handoff.clone() else {
        // The production-domain process/window adapter is not wired:
        // honest absence (category unavailable, recoverable) — never a
        // silent success, never a guessed handoff fact.
        return Err(application_error(
            request_id,
            correlation_id,
            RELEASE_HANDOFF_UNAVAILABLE,
            "errors.releaseHandoff.unavailable",
            "unavailable",
        ));
    };
    let build_id = request
        .pointer("/params/buildId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    // Admission-time record validation: the build record is the
    // authoritative project identity (ruling 4) and the editor-identity
    // source (ruling 5 tier 2). A read failure means the existence could
    // not be determined — unavailable, retryable, never "unknown".
    let record = match use_cases.records.get(&build_id) {
        Ok(Some(record)) => record,
        Ok(None) => {
            return Err(application_error(
                request_id,
                correlation_id,
                "vua.release_handoff.build_unknown",
                "errors.releaseHandoff.buildUnknown",
                "validation",
            ));
        }
        Err(_) => {
            return Err(application_error(
                request_id,
                correlation_id,
                RELEASE_HANDOFF_UNAVAILABLE,
                "errors.releaseHandoff.unavailable",
                "unavailable",
            ));
        }
    };
    if enforce_state_gate {
        // U19 record-state gate (v0.2): the whitelist is a product-policy
        // decision (ruling correction a), applied here — before any task
        // exists, never in a UI. Blocked carries the state verbatim as
        // the wire param; unknown refuses a record it cannot confirm.
        match vua_orchestrator::classify_handoff_record_state(&record) {
            vua_orchestrator::HandoffRecordAdmission::Allowed => {}
            vua_orchestrator::HandoffRecordAdmission::Blocked { state: record_state } => {
                return Err(application_error_with_params(
                    request_id,
                    correlation_id,
                    RELEASE_HANDOFF_RECORD_STATE_BLOCKED,
                    "errors.releaseHandoff.stateBlocked",
                    "permission",
                    &[(
                        "state",
                        vua_orchestrator::ParamValue::Text(record_state),
                    )],
                ));
            }
            vua_orchestrator::HandoffRecordAdmission::Unknown => {
                return Err(application_error(
                    request_id,
                    correlation_id,
                    RELEASE_HANDOFF_RECORD_STATE_UNKNOWN,
                    "errors.releaseHandoff.stateUnknown",
                    "validation",
                ));
            }
        }
    }
    // A schema-valid v0.3 record always carries both identities; a record
    // missing them cannot establish the handoff identity, so the route
    // answers the same typed unresolved (the closed set has no separate
    // "incomplete record" code — this IS an identity-resolution failure).
    let record_version = vua_orchestrator::record_editor_version(&record).unwrap_or_default();
    let Some(record_project_id) = vua_orchestrator::record_project_id(&record) else {
        return Err(application_error(
            request_id,
            correlation_id,
            "vua.release_handoff.editor_unresolved",
            "errors.releaseHandoff.editorUnresolved",
            "dependency",
        ));
    };
    // Editor-identity resolution (ruling 5): explicit injection > the
    // record's carried version matched against observed candidates >
    // typed unresolved. Candidates come from the 021 selection decision
    // this provider was assembled with — the explicit injection passes
    // through the editor-verify face (identity from the executable, never
    // the directory name); a refusal there short-circuits into the same
    // typed unresolved (the explicit injection is the authority — it is
    // never silently downgraded to the record tier). The error envelope
    // carries no diagnostic params (the frozen error shape); the
    // resolution reason stays a core-side fact.
    let candidates = match handoff_editor_candidates(state) {
        Ok(candidates) => candidates,
        Err(_) => {
            return Err(application_error(
                request_id,
                correlation_id,
                "vua.release_handoff.editor_unresolved",
                "errors.releaseHandoff.editorUnresolved",
                "dependency",
            ));
        }
    };
    let resolved = match vua_orchestrator::resolve_handoff_editor(&candidates, record_version) {
        Ok(resolved) => resolved,
        Err(_) => {
            return Err(application_error(
                request_id,
                correlation_id,
                "vua.release_handoff.editor_unresolved",
                "errors.releaseHandoff.editorUnresolved",
                "dependency",
            ));
        }
    };
    Ok(EditorOpenAdmission {
        build_id,
        project_id: record_project_id.to_owned(),
        resolved,
        runtime,
        port,
        project_root: use_cases.project_root.clone(),
    })
}

/// Accepts the long-running part of one editor-open entry (the shared task
/// face of handoff and inspection): the nine states carry ONLY the
/// long-running part. Completion = Bridge handshake arrival (ruling 3) —
/// the port owns the wait; "process started" never completes the task; OS
/// focus enters neither the judgment nor the fact. The `fact_builder`
/// picks the wording: `build_handoff_fact` (handoff) vs
/// `build_inspection_fact` (inspection — its `operation` key never reads
/// as a handoff completion). The wiring (runtime/port/project root)
/// arrives checked with the admission — nothing is re-fetched, so the
/// acceptance cannot diverge from what admission validated.
fn submit_editor_open_task(
    admission: EditorOpenAdmission,
    request_id: &str,
    correlation_id: &str,
    operation: &str,
    fact_builder: fn(&str, &str, &str, &str, &str) -> Value,
) -> Result<FrameOutcome, SqliteStoreError> {
    let launch = vua_orchestrator::HandoffLaunch {
        build_id: admission.build_id.clone(),
        project_id: admission.project_id.clone(),
        project_root: admission.project_root.clone(),
        editor_exe: admission.resolved.exe_path.clone(),
        editor_version: admission.resolved.version.clone(),
    };
    let port = admission.port;
    let run_correlation = correlation_id.to_owned();
    let accepted = admission.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |context| {
            if context.check_cancel() {
                return Ok(vua_orchestrator::TaskExit::Cancelled);
            }
            match port.open_for_handoff(&launch) {
                Ok(vua_orchestrator::HandoffOutcome::HandshakeArrived) => {
                    Ok(vua_orchestrator::TaskExit::Done(fact_builder(
                        &launch.build_id,
                        &launch.project_id,
                        &launch.editor_exe.to_string_lossy(),
                        &launch.editor_version,
                        &now_rfc3339(),
                    )))
                }
                Ok(vua_orchestrator::HandoffOutcome::HandshakeTimeout) => {
                    // The wait ran and no handshake arrived: an honest
                    // failure (ruling 3 — never a guessed success), and
                    // retryable (the editor may simply still be loading).
                    Err(AppErrorV1::new(
                        "vua.task.timeout",
                        ErrorCategory::ExternalFailure,
                        "errors.releaseHandoff.handshakeTimeout",
                        &run_correlation,
                    )
                    .with_recoverable(true))
                }
                Err(error) => Err(AppErrorV1::new(
                    "vua.job.handoff_launch_failed",
                    ErrorCategory::ExternalFailure,
                    "errors.releaseHandoff.launchFailed",
                    &run_correlation,
                )
                .with_recoverable(true)
                .with_param(
                    "detail",
                    vua_orchestrator::ParamValue::Text(error.detail),
                )),
            }
        }),
    });
    match accepted {
        Ok(accepted) => Ok(FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": RELEASE_HANDOFF_SCHEMA_VERSION,
                "operation": operation,
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        ))),
        Err(_) => Ok(FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            RELEASE_HANDOFF_UNAVAILABLE,
            "errors.releaseHandoff.unavailable",
            "unavailable",
        ))),
    }
}

/// Assembles the editor-identity candidates for handoff resolution from
/// the assembly-face selection this provider was configured with (021):
/// the explicit injection becomes a candidate only when the editor-verify
/// face can establish its identity right now; a refusal there is
/// `Err` — the explicit injection is the resolution authority (ruling 5
/// tier 1), so it short-circuits into the typed unresolved instead of
/// being silently downgraded to the record tier. The auto-selected
/// production target enters as an observed candidate; an unavailable
/// selection yields no candidates (an honest unresolved).
fn handoff_editor_candidates(
    state: &HostState,
) -> Result<Vec<vua_orchestrator::HandoffEditorCandidate>, EditorPathRefusal> {
    let Some(use_cases) = state.use_cases.as_ref() else {
        return Ok(Vec::new());
    };
    match &use_cases.editor_selection {
        vua_orchestrator::EditorSelection::Explicit { path } => {
            match (state.editor_verify)(path) {
                EditorPathVerdict::Verified(identity) => {
                    Ok(vec![vua_orchestrator::HandoffEditorCandidate {
                        source: vua_orchestrator::HandoffEditorSource::ExplicitInjection,
                        exe_path: PathBuf::from(&identity.exe_path),
                        version: identity.version.clone(),
                    }])
                }
                EditorPathVerdict::Refused(refusal) => Err(refusal),
            }
        }
        vua_orchestrator::EditorSelection::AutoSelected { editor } => {
            Ok(vec![vua_orchestrator::HandoffEditorCandidate {
                source: vua_orchestrator::HandoffEditorSource::ProductionTarget,
                exe_path: editor.path.clone(),
                version: editor.parsed.display.clone(),
            }])
        }
        vua_orchestrator::EditorSelection::Unavailable { .. } => Ok(Vec::new()),
    }
}

fn catalog_request(
    state: &HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(warehouse) = state.warehouse.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.catalog.unavailable",
            "errors.catalog.unavailable",
            "unavailable",
        ));
    };
    match method {
        "catalog.ingestLibraryPage" => {
            catalog_ingest_library_page(warehouse, request, request_id, correlation_id)
        }
        "catalog.list" => catalog_list(warehouse, request, request_id, correlation_id),
        "catalog.detail" => catalog_detail(warehouse, request, request_id, correlation_id),
        "catalog.status" => catalog_status(warehouse, request, request_id, correlation_id),
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

/// The bdl-queries v0.3 envelope all read queries travel as: the frozen
/// `{ schemaVersion, operation, result }` document wrapped in the
/// application-contract success value.
fn bdl_query_success(request_id: &str, operation: &str, result: Value) -> FrameOutcome {
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": BDL_QUERIES_SCHEMA_VERSION,
            "operation": operation,
            "result": result,
        }),
    ))
}

/// The `downloads.*` read face (bdl-queries v0.4): the adoptable
/// completed-delivery listing. Absent wiring answers a typed unavailable —
/// the frozen word list is never silently stubbed.
fn downloads_query_request(
    state: &HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(warehouse) = state.warehouse.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.downloads.unavailable",
            "errors.downloads.unavailable",
            "unavailable",
        ));
    };
    match method {
        "downloads.listCompleted" => {
            downloads_list_completed(warehouse, request, request_id, correlation_id)
        }
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

/// `downloads.listCompleted` (bdl-queries v0.4, proposal 015 section-7):
/// the adoptable completed deliveries — the SAME server-side fact the
/// adoption guard consumes (event fold at a completed delivery, staging
/// file present at the reported size), so the list is the guard's mirror.
/// No params; paths never appear in the rows.
fn downloads_list_completed(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    if let Some(params) = request.get("params") {
        let empty = params.as_object().map(|object| object.is_empty()).unwrap_or(false);
        if !empty {
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.downloads.invalid_params",
                "errors.downloads.invalidParams",
                "validation",
            ));
        }
    }
    match warehouse.bdl.list_adoptable_downloads() {
        Ok(rows) => {
            let downloads = serde_json::to_value(&rows).unwrap_or_else(|_| json!([]));
            bdl_query_success(
                request_id,
                "downloads.listCompleted",
                json!({ "downloads": downloads }),
            )
        }
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.warehouse.store_failed",
            "errors.warehouse.storeFailed",
            "internal",
        )),
    }
}

/// The `dependencies.*` read face (bdl-queries v0.5, proposal 030 §5.7
/// case A): the dependency reverse-lookup suggestion face plus the
/// per-product observation clue face, served through the core
/// `DependenciesQueriesPort`. Route-arm order (the catalog.request
/// isomorph): (1) the warehouse/BDL wiring answers first — absent wiring
/// is the family's typed honest absence, never a fabricated match; (2)
/// the port slot answers — absent slot = the same honest absence (the
/// real query executor reading the BDL library is a later
/// data/production-domain implementation ring); (3) the closed params
/// parse answers `vua.catalog.invalid_params` BEFORE the gate (unknown
/// keys and out-of-vocabulary values are contract errors, never silently
/// filtered answers); (4) the capability gate reads the defaulted port
/// accessor `dependencies_capabilities` (declared-none default — the
/// `export_capabilities` accessor law) BEFORE the port call, answering
/// the same honest-absence code; (5) the port's typed refusals travel
/// VERBATIM (the read-face pass-through discipline — no read-face fold
/// exists) and an OK projection is the port's typed facts through serde,
/// stamped with the shared family envelope const at the single envelope
/// assembly point (`bdl_query_success` — the P1 discipline: the route
/// stamps the consts, the port facts stay verbatim). Zero new error
/// codes: the arms reuse the bdl-queries family's existing
/// unavailable/invalid_params/product_not_found registrations.
fn dependencies_query_request(
    state: &HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(warehouse) = state.warehouse.clone() else {
        return dependencies_unavailable(request_id, correlation_id);
    };
    let Some(queries) = warehouse.dependencies_queries.clone() else {
        return dependencies_unavailable(request_id, correlation_id);
    };
    // The capability gate (declared-none default) BEFORE the port call.
    if !queries.dependencies_capabilities().dependencies_queries {
        return dependencies_unavailable(request_id, correlation_id);
    }
    match method {
        "dependencies.lookup" => {
            let params = match request.get("params") {
                Some(params) => match DependenciesLookupParams::from_value(params) {
                    Ok(params) => params,
                    Err(
                        DependenciesParamsError::UnknownKey(_)
                        | DependenciesParamsError::InvalidValue { .. },
                    ) => return dependencies_invalid_params(request_id, correlation_id),
                },
                None => return dependencies_invalid_params(request_id, correlation_id),
            };
            match queries.dependencies_lookup(&params) {
                Ok(result) => match serde_json::to_value(&result) {
                    Ok(result) => bdl_query_success(request_id, "dependencies.lookup", result),
                    Err(_) => catalog_store_failed(request_id, correlation_id),
                },
                Err(error) => FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                )),
            }
        }
        "dependencies.listByProduct" => {
            let params = match request.get("params") {
                Some(params) => match DependenciesListByProductParams::from_value(params) {
                    Ok(params) => params,
                    Err(
                        DependenciesParamsError::UnknownKey(_)
                        | DependenciesParamsError::InvalidValue { .. },
                    ) => return dependencies_invalid_params(request_id, correlation_id),
                },
                None => return dependencies_invalid_params(request_id, correlation_id),
            };
            match queries.dependencies_list_by_product(&params.product_id) {
                // A miss (an unknown productId) is the application-face
                // not-found under the catalog.detail absence semantics —
                // never a fabricated empty answer.
                Ok(None) => FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    "vua.catalog.product_not_found",
                    "errors.catalog.productNotFound",
                    "validation",
                )),
                Ok(Some(result)) => match serde_json::to_value(&result) {
                    Ok(result) => {
                        bdl_query_success(request_id, "dependencies.listByProduct", result)
                    }
                    Err(_) => catalog_store_failed(request_id, correlation_id),
                },
                Err(error) => FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                )),
            }
        }
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

/// The dependencies face's honest absence: the warehouse/BDL wiring, the
/// port slot, or the capability accessor answers unavailable — the route
/// answers the bdl-queries family's own registered absence code (zero new
/// codes), never a fabricated match or observation.
fn dependencies_unavailable(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.catalog.unavailable",
        "errors.catalog.unavailable",
        "unavailable",
    ))
}

/// The dependencies face's params shape verdict: a closed-set violation —
/// a validation failure, never a default, and never a masquerade for
/// honest absence (the family's registered code, zero new codes).
fn dependencies_invalid_params(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.catalog.invalid_params",
        "errors.catalog.invalidParams",
        "validation",
    ))
}

fn project_single_path_param(request: &Value) -> Option<std::collections::HashMap<&str, &str>> {
    // Single-path queries carry exactly `{ projectPath }` (frozen v0.1).
    let params = request.get("params")?.as_object()?;
    if params.len() != 1 {
        return None;
    }
    let value = params.get("projectPath")?.as_str()?;
    if value.is_empty() {
        return None;
    }
    let mut map = std::collections::HashMap::new();
    map.insert("projectPath", value);
    Some(map)
}

fn project_single_query_result(
    request_id: &str,
    operation: &str,
    result: Value,
) -> FrameOutcome {
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": PROJECT_INSPECTION_SCHEMA_VERSION,
            "operation": operation,
            "result": result,
        }),
    ))
}

/// `project.listProjects` (proposal 013 read face): the inspection
/// aggregate over exactly the paths the managers registered — the
/// v0.2 snapshot family (vuaIdentity tri-state included).
fn project_list_projects(
    project_ops: Arc<ProjectOpsServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    if let Some(params) = request.get("params") {
        let empty = params.as_object().map(|object| object.is_empty()).unwrap_or(false);
        if !empty {
            return project_invalid_params(request_id, correlation_id);
        }
    }
    let snapshot = collect_project_inspections(
        &project_ops.vcc_settings_candidates,
        &project_ops.manager_roots,
        &SystemClock,
    );
    let result = serde_json::to_value(&snapshot).unwrap_or_else(|_| json!({
        "schemaVersion": PROJECT_INSPECTION_FAMILY_VERSION,
    }));
    project_single_query_result(request_id, "project.listProjects", result)
}

/// `project.inspectProject` (proposal 013 read face): the single-project
/// face of the inspection aggregate — only paths some manager registers
/// are inspectable (the detection face's registry is its world); an
/// unregistered path answers the typed not-found.
fn project_inspect_project(
    project_ops: Arc<ProjectOpsServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(params) = project_single_path_param(request) else {
        return project_invalid_params(request_id, correlation_id);
    };
    let project_path = params["projectPath"];
    let snapshot = collect_project_inspections(
        &project_ops.vcc_settings_candidates,
        &project_ops.manager_roots,
        &SystemClock,
    );
    let found: Option<&ProjectInspectionV01> = snapshot
        .projects
        .iter()
        .find(|project| project.path == project_path);
    let Some(project) = found else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    };
    let mut result = serde_json::to_value(project).unwrap_or_else(|_| json!({}));
    // The frozen single-project def carries the family version itself.
    result["schemaVersion"] = json!(PROJECT_INSPECTION_FAMILY_VERSION);
    project_single_query_result(request_id, "project.inspectProject", result)
}

/// `project.lockStatus` (proposal 013 read face): the read-only
/// pending-mutation observation for one project path — never acquires the
/// lock (an inspection never writes).
fn project_lock_status(
    project_ops: Arc<ProjectOpsServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let _ = &project_ops;
    let Some(params) = project_single_path_param(request) else {
        return project_invalid_params(request_id, correlation_id);
    };
    let project_path = params["projectPath"];
    let mutation_status =
        match vua_project_manager::read_pending_mutation(std::path::Path::new(project_path)) {
            vua_project_manager::PendingMutation::None => "none",
            vua_project_manager::PendingMutation::Leftover(_) => "leftover",
            vua_project_manager::PendingMutation::Unreadable => "unreadable",
        };
    project_single_query_result(
        request_id,
        "project.lockStatus",
        json!({
            "schemaVersion": PROJECT_INSPECTION_FAMILY_VERSION,
            "projectPath": project_path,
            "mutationStatus": mutation_status,
        }),
    )
}

fn catalog_invalid_params(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.catalog.invalid_params",
        "errors.catalog.invalidParams",
        "validation",
    ))
}

fn catalog_store_failed(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.catalog.store_failed",
        "errors.catalog.storeFailed",
        "internal",
    ))
}

/// Catalog-sync v0.1 (N5 S1): one archived account-library page, shipped by
/// the Electron partition-session reader, parsed and folded into the BDL
/// products table through the W17 observation write face. Upsert semantics
/// make page replays safe (same-content overwrite, never a second row);
/// per-item write-face violations are reported as rejected items, never
/// silently dropped. Task orchestration (nine-state sync task, cancellation)
/// rides with the Electron reader slice; this face is the ledger's ingest.
fn catalog_ingest_library_page(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    const CATALOG_SYNC_SCHEMA_VERSION: &str = "0.1";
    if request.pointer("/params/schemaVersion").and_then(Value::as_str)
        != Some(CATALOG_SYNC_SCHEMA_VERSION)
    {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.catalog.unsupported_schema",
            "errors.catalog.unsupportedSchema",
            "validation",
        ));
    }
    let non_empty = |pointer: &str| {
        request
            .pointer(pointer)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
    };
    let (Some(html), Some(source_url), Some(fetched_at)) = (
        non_empty("/params/html"),
        non_empty("/params/sourceUrl"),
        non_empty("/params/fetchedAt"),
    ) else {
        return catalog_invalid_params(request_id, correlation_id);
    };
    let run_id = non_empty("/params/runId");

    let page = match vua_acquisition::library_page::extract_library_page(html) {
        Ok(page) => page,
        Err(_) => {
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.catalog.not_a_library_page",
                "errors.catalog.notALibraryPage",
                "validation",
            ));
        }
    };

    let page_hash = vua_acquisition::library_page::page_content_hash(html);
    let mut upserted = 0u64;
    let mut rejected = Vec::new();
    for (index, item) in page.items.iter().enumerate() {
        let observation = vua_acquisition::library_page::library_item_to_observation(
            item,
            &page_hash,
            fetched_at,
            run_id,
        );
        match warehouse.bdl.record_product_observation(&observation) {
            Ok(_) => upserted += 1,
            Err(error) => rejected.push(json!({
                "index": index,
                "code": "vua.catalog.invalid_observation",
                "reason": error.to_string(),
            })),
        }
    }

    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": CATALOG_SYNC_SCHEMA_VERSION,
            "sourceUrl": source_url,
            "parsedCount": page.items.len(),
            "upsertedCount": upserted,
            "rejectedItems": rejected,
            "nextPageUrl": page.next_page_url,
        }),
    ))
}

fn catalog_list(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // The closed-set parse is the data side's frozen one (reused, not
    // reimplemented): keys outside { text, availabilityStatus, limit,
    // offset } and out-of-vocabulary values are contract errors, never a
    // silently filtered answer.
    let params = match request.get("params") {
        Some(params) => match CatalogListParams::from_value(params) {
            Ok(params) => params,
            Err(CatalogParamsError::UnknownKey(_))
            | Err(CatalogParamsError::InvalidValue { .. }) => {
                return catalog_invalid_params(request_id, correlation_id);
            }
        },
        None => return catalog_invalid_params(request_id, correlation_id),
    };
    match warehouse.bdl.catalog_list(&params) {
        Ok(result) => match serde_json::to_value(&result) {
            Ok(result) => bdl_query_success(request_id, "catalog.list", result),
            Err(_) => catalog_store_failed(request_id, correlation_id),
        },
        Err(_) => catalog_store_failed(request_id, correlation_id),
    }
}

fn catalog_detail(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // The detail closed set is { productId }: a non-empty string. Any other
    // key, an explicit null, or an empty string is a contract error.
    let product_id = match request.get("params") {
        Some(Value::Object(params)) if params.keys().all(|key| key == "productId") => {
            params
                .get("productId")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .filter(|id| !id.is_empty())
        }
        _ => None,
    };
    let Some(product_id) = product_id else {
        return catalog_invalid_params(request_id, correlation_id);
    };
    match warehouse.bdl.catalog_detail(&product_id) {
        Ok(Some(result)) => match serde_json::to_value(&result) {
            Ok(result) => bdl_query_success(request_id, "catalog.detail", result),
            Err(_) => catalog_store_failed(request_id, correlation_id),
        },
        // A miss (including a tombstone, which the assembly never serves as
        // a card) is the application-face not-found, never a fabricated
        // empty product.
        Ok(None) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.catalog.product_not_found",
            "errors.catalog.productNotFound",
            "validation",
        )),
        Err(_) => catalog_store_failed(request_id, correlation_id),
    }
}

fn catalog_status(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // The status closed set is {} — the health/revision snapshot takes no
    // filter; any key at all is a contract error.
    if !matches!(request.get("params"), Some(Value::Object(params)) if params.is_empty()) {
        return catalog_invalid_params(request_id, correlation_id);
    }
    match warehouse.bdl.catalog_status() {
        Ok(result) => match serde_json::to_value(&result) {
            Ok(result) => bdl_query_success(request_id, "catalog.status", result),
            Err(_) => catalog_store_failed(request_id, correlation_id),
        },
        Err(_) => catalog_store_failed(request_id, correlation_id),
    }
}

/// `warehouse.import` (bdl-commands v0.3, proposal 010/012): submits ONE
/// batch-import task over the given source folders (per-folder progress;
/// entry creation, guards and the audit trail stay inside the task). The
/// closed param set is `{ sourceFolders }` — kernel-resolved absolute
/// paths, non-empty. The acceptance is the frozen v0.3 task document. The
/// import-time generation hook (010 path A) lives inside the import task
/// itself (acquisition, data-domain slice) and needs no wire surface here.
fn warehouse_import_submit(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let source_folders = match request.get("params") {
        Some(Value::Object(params)) if params.keys().all(|key| key == "sourceFolders") => {
            match params.get("sourceFolders") {
                Some(Value::Array(folders)) if !folders.is_empty() => folders
                    .iter()
                    .map(|value| {
                        value
                            .as_str()
                            .filter(|raw| !raw.is_empty())
                            .map(PathBuf::from)
                    })
                    .collect::<Option<Vec<PathBuf>>>(),
                _ => None,
            }
        }
        _ => None,
    };
    let Some(source_folders) = source_folders else {
        return warehouse_invalid_params(request_id, correlation_id);
    };
    let accepted = vua_acquisition::submit_warehouse_import(
        &warehouse.runtime,
        warehouse.bdl.clone(),
        Arc::new(SystemClock),
        vua_acquisition::WarehouseImportTaskSpec {
            correlation_id: correlation_id.to_owned(),
            source_folders,
            warehouse_root: warehouse.warehouse_root.clone(),
            // The wire import face imports only; the auto-generation
            // injection lands with the core orchestration follow-up (010).
            auto_generate: None,
        },
        None,
    );
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": BDL_COMMANDS_SCHEMA_VERSION,
                "operation": "warehouse.import",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task authority.
        Err(_) => warehouse_store_failed(request_id, correlation_id),
    }
}

/// The `vua.project.*` word list (proposal 013/014; the write face is
/// `project.import-copy` plus `project.setNote` since project-ops v0.2).
/// Absent wiring answers a typed unavailable — the frozen word list is
/// never silently stubbed.
fn project_request(
    state: &mut HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.unavailable",
            "errors.project.unavailable",
            "unavailable",
        ));
    };
    match method {
        "project.import-copy" => {
            project_import_copy(project_ops, request, request_id, correlation_id)
        }
        "project.setNote" => project_set_note(project_ops, request, request_id, correlation_id),
        // The frozen read face (proposal 013). Word-list entries that are
        // not yet wired answer a typed unavailable — the frozen word list
        // is never silently stubbed.
        "project.environmentManagers" => {
            project_environment_managers(project_ops, request, request_id, correlation_id)
        }
        "project.listProjects" => {
            project_list_projects(project_ops, request, request_id, correlation_id)
        }
        "project.inspectProject" => {
            project_inspect_project(project_ops, request, request_id, correlation_id)
        }
        "project.lockStatus" => {
            project_lock_status(project_ops, request, request_id, correlation_id)
        }
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

/// The `vua.packages.*` word list (proposal 024 P1, packages-query v0.1):
/// one read method over the wired `VpmBackend`. Absent wiring answers a
/// typed `vua.packages.unavailable` — the frozen word list is never
/// silently stubbed, and absence never folds into a fabricated listing.
fn packages_request(
    state: &HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(vpm) = state.vpm.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    match method {
        "packages.listInstalled" => {
            packages_list_installed(state, vpm, request, request_id, correlation_id)
        }
        "packages.listRepos" => packages_list_repos(vpm, request, request_id, correlation_id),
        "packages.packageCatalog" => {
            packages_package_catalog(state, vpm, request, request_id, correlation_id)
        }
        "packages.previewRemove" => {
            packages_preview_remove(state, vpm, request, request_id, correlation_id)
        }
        "packages.applyRemove" => {
            packages_apply_remove(state, vpm, request, request_id, correlation_id)
        }
        "packages.previewInstall" => {
            packages_preview_install(state, vpm, request, request_id, correlation_id)
        }
        "packages.applyInstall" => {
            packages_apply_install(state, vpm, request, request_id, correlation_id)
        }
        "packages.registerLocalPackage" => {
            packages_register_local_package(state, vpm, request, request_id, correlation_id)
        }
        "packages.addRemoteRepo" => {
            packages_add_remote_repo(state, vpm, request, request_id, correlation_id)
        }
        "packages.addLocalRepo" => {
            packages_add_local_repo(state, vpm, request, request_id, correlation_id)
        }
        "packages.removeRepo" => {
            packages_remove_repo(state, vpm, request, request_id, correlation_id)
        }
        "packages.createProject" => {
            packages_create_project(state, vpm, request, request_id, correlation_id)
        }
        "packages.repoCatalog" => packages_repo_catalog(vpm, request, request_id, correlation_id),
        "packages.listTemplates" => {
            packages_list_templates(vpm, request, request_id, correlation_id)
        }
        "packages.enableRepo" => {
            packages_enable_repo(state, vpm, request, request_id, correlation_id)
        }
        "packages.disableRepo" => {
            packages_disable_repo(state, vpm, request, request_id, correlation_id)
        }
        "packages.refreshRepo" => {
            packages_refresh_repo(state, vpm, request, request_id, correlation_id)
        }
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

fn packages_invalid_params(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.packages.invalid_params",
        "errors.packages.invalidParams",
        "validation",
    ))
}

/// `packages.listInstalled` (proposal 024 P1; result family negotiated at
/// v0.2 by the proposal 027 F3 wiring batch): the installed package set of
/// ONE registered project. Registration is validated against the SAME 013
/// inspection aggregate `project.inspectProject` uses (same fact, same
/// code: `vua.project.project_not_found` — the frozen reuse ruling); an
/// off-aggregate path never reaches the backend. The listing itself is the
/// backend's manifest+lock projection; an empty lock is an honest empty
/// array, and a load failure is the backend's typed error — never an empty
/// masquerade. The RESULT family is negotiated additively (proposal 027 F3
/// freeze batch, the `catalog_v02` law): a backend declaring `query_v02`
/// answers `vua.packages-installed/v0.2` (rows carry the REQUIRED judgment
/// pair; the listing carries the REQUIRED cacheSourced disclosure); every
/// other backend keeps answering the frozen `vua.packages-installed/v0.1`
/// family — the stamped family const tells the consumer which word face
/// answered, never a guess. The face-level capability gate
/// (`capabilities().list_packages`) precedes the negotiation: without the
/// face there is no word face at all, whatever its generation. Both family
/// consts are envelope-assembly facts (P1 discipline): the route stamps
/// them, the backend facts stay verbatim.
fn packages_list_installed(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        // The registration-validation face is unwired: without the 013
        // aggregate the not-found calibration does not exist, so the whole
        // face stays honestly absent (never "everything is registered").
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some(params) = project_single_path_param(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    let project_path = params["projectPath"];
    let snapshot = collect_project_inspections(
        &project_ops.vcc_settings_candidates,
        &project_ops.manager_roots,
        &SystemClock,
    );
    let registered = snapshot
        .projects
        .iter()
        .any(|project| project.path == project_path);
    if !registered {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    }
    if !vpm.capabilities().list_packages {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    // Additive dual-version negotiation (proposal 027 F3 freeze batch, the
    // `catalog_v02` law): a backend that declares `query_v02` answers the
    // v0.2 result family (rows carry the latestVersion/updateAvailable
    // judgment pair; the listing carries the REQUIRED cacheSourced
    // disclosure); every other backend keeps answering the frozen v0.1
    // family. The family const is an envelope-assembly fact (P1
    // discipline): the route stamps it, the backend facts stay verbatim —
    // the consumer reads the const, never guesses the word face.
    let project = ProjectRef {
        id: project_path.to_string(),
        root: PathBuf::from(project_path),
    };
    let (mut result, family_const) = if vpm.query_v02() {
        match vpm.list_packages_v02(&project) {
            Ok(listing) => {
                // The backend projects its own facts (rows + cacheSourced);
                // projectPath is the ROUTE's envelope-assembly fact — the
                // route stamps it, the backend facts stay verbatim (the P1
                // discipline; the frozen v0.2 result schema requires it).
                let mut value = serde_json::to_value(&listing).unwrap_or_else(|_| json!({}));
                value["projectPath"] = json!(project_path);
                (value, PACKAGES_INSTALLED_SCHEMA_VERSION_V02)
            }
            Err(error) => {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                ));
            }
        }
    } else {
        match vpm.list_packages(&project) {
            Ok(packages) => {
                let rows = serde_json::to_value(&packages).unwrap_or_else(|_| json!([]));
                (json!({ "projectPath": project_path, "packages": rows }), PACKAGES_INSTALLED_SCHEMA_VERSION_V01)
            }
            Err(error) => {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                ));
            }
        }
    };
    result["schemaVersion"] = json!(family_const);
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": PACKAGES_QUERY_SCHEMA_VERSION,
            "operation": "packages.listInstalled",
            "result": result,
        }),
    ))
}

/// `packages.listRepos` (proposal 025 P2 freeze batch): the repository
/// subscription list — the subscription face is the world (the user's
/// configuration fact). A GLOBAL configuration face: no 013 registration
/// binding and no project context, and the frozen command schema admits an
/// EMPTY params object only — any key (or an absent params) is a shape
/// violation, never a default. The backend capability is the separate
/// catalog declaration (`catalog_capabilities`, default declared-none): an
/// engine wired without the P2 implementation answers
/// `vua.vpm.capability_missing`, never a fabricated or padded list. Rows
/// project the backend's facts verbatim (serde camelCase, nulls preserved
/// as honest absences); row order is the backend's subscription-face
/// order — the route invents no sort key.
///
/// The RESULT family is negotiated additively (proposal 027 F4 freeze
/// batch, the `repos_v02` law — the `catalog_v02`/`query_v02` precedent):
/// a backend that declares `repos_v02` answers the v0.2 result family
/// (rows carry the REQUIRED VUA-owned `enabled` state bit — ruling (c):
/// VCC carries no enable counterpart, so the bit projects VUA-owned
/// storage, never a settings.json key; an id-absent row projects
/// `enabled: true` ALWAYS — it is outside the toggle faces' reach); every
/// other backend keeps answering the frozen `vua.packages-repos/v0.1`
/// family. The COMMAND face stays byte-for-byte the frozen v0.1 face: the
/// envelope const stays `"0.1"` and the v0.2 increment is a
/// result-document fact only (the stamped family const tells the consumer
/// which word face answered, never a guess — the P1 discipline: the route
/// stamps the const, the backend facts stay verbatim).
fn packages_list_repos(
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let empty_params = request
        .get("params")
        .and_then(Value::as_object)
        .is_some_and(|object| object.is_empty());
    if !empty_params {
        return packages_invalid_params(request_id, correlation_id);
    }
    if !vpm.catalog_capabilities().catalog {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let (result, family_const) = if vpm.repos_v02() {
        match vpm.list_repos_v02() {
            Ok(repos) => {
                let rows = serde_json::to_value(&repos).unwrap_or_else(|_| json!([]));
                (json!({ "repos": rows }), PACKAGES_REPOS_SCHEMA_VERSION_V02)
            }
            Err(error) => {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                ));
            }
        }
    } else {
        match vpm.list_repos() {
            Ok(repos) => {
                let rows = serde_json::to_value(&repos).unwrap_or_else(|_| json!([]));
                (json!({ "repos": rows }), PACKAGES_REPOS_SCHEMA_VERSION)
            }
            Err(error) => {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                ));
            }
        }
    };
    let mut result = result;
    result["schemaVersion"] = json!(family_const);
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": PACKAGES_QUERY_SCHEMA_VERSION,
            "operation": "packages.listRepos",
            "result": result,
        }),
    ))
}

/// `packages.listTemplates` (proposal 027 F5 freeze batch, wired by this
/// batch): the template entries available to project creation, enumerated by
/// the backend's LOCAL DIRECTORY SCAN over the two pinned directory roots of
/// the library-path default resolution leg (`<environment_root>/VRCTemplates`
/// first, then `<environment_root>/Templates` — the create_from_template
/// resolution order; vrc-get-vpm 0.0.16 ships no template enumeration API, so
/// the scan IS the enumeration). One method, ZERO parameters (the
/// `packages.listRepos` zero-parameter precedent — the template face is
/// environment-level configuration, not per-project): any key, or a
/// missing/non-object params, answers `vua.packages.invalid_params` at the
/// route layer, never a default. The capability gate reads the NEW defaulted
/// accessor `template_capabilities` (default declared-none) BEFORE the port
/// call — absence answers the generic `vua.vpm.capability_missing` and never
/// reaches a backend method (the F2 same structural law: the port method HAS
/// a default body, so a declared-but-unimplemented backend CAN exist at the
/// type level, and BOTH layers answer `capability_missing`, the route gate
/// first). The port's typed errors travel verbatim (the read-face
/// pass-through discipline — no read-face fold exists); an EMPTY templates
/// array is the honest zero-templates answer (a missing root is a fact, never
/// an error — the R4 precedent). The result document is the port's
/// `TemplateEntryV01` rows projected through serde, stamped with the family
/// const at envelope assembly (P1 discipline: the route stamps the const, the
/// backend facts stay verbatim — id-ascending and the name===id same-value
/// projection are PRODUCER contracts of the frozen word face, not route
/// rewrites; the wire tests pin them over the real frame loop).
fn packages_list_templates(
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // The closed EMPTY params set (the packages.listRepos zero-parameter
    // precedent): any key is a shape violation, never a default.
    let empty_params = request
        .get("params")
        .and_then(Value::as_object)
        .is_some_and(|object| object.is_empty());
    if !empty_params {
        return packages_invalid_params(request_id, correlation_id);
    }
    if !vpm.template_capabilities().list_templates {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    match vpm.list_templates() {
        Ok(templates) => {
            let rows = serde_json::to_value(&templates).unwrap_or_else(|_| json!([]));
            FrameOutcome::Response(application_success(
                request_id,
                json!({
                    "schemaVersion": PACKAGES_TEMPLATES_ENVELOPE_SCHEMA_VERSION_V01,
                    "operation": "packages.listTemplates",
                    "result": {
                        "schemaVersion": PACKAGES_TEMPLATES_SCHEMA_VERSION_V01,
                        "templates": rows,
                    },
                }),
            ))
        }
        Err(error) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            &error.code,
            &error.message_key,
            app_error_category(error.category),
        )),
    }
}

/// `packages.repoCatalog` (proposal 027 F2 freeze batch, wired by this
/// batch): the per-repository installable-package inventory over the wired
/// backend's collection — one row per repository (identity, the REQUIRED
/// `cached` cache-hit fact, that repository's own package rows), a GLOBAL
/// face needing no registration binding (no projectPath exists on the
/// frozen v0.1 word face). Params are the frozen two-key REQUIRED-nullable
/// closed set {repoId, packageIds}: BOTH keys must be present — `repoId`
/// null = every repository of the collection world, a non-empty string
/// scopes the answer to that one repository row (an unknown id is the
/// PORT's `vua.vpm.repo_not_found` refusal, the A4 removeRepo same-fact
/// precedent, traveling verbatim per the read-face pass-through
/// discipline); `packageIds` null = browse-all, a non-null array is the
/// batch requirement-set filter (unique non-empty ids — the Recipe
/// automation shape, user ruling 4; an EMPTY array is a shape violation,
/// not an empty filter). Any other shape answers
/// `vua.packages.invalid_params` at the route layer. The capability gate
/// reads the NEW defaulted accessor `repo_catalog_capabilities` (default
/// declared-none) BEFORE the port call — absence answers the generic
/// `vua.vpm.capability_missing` and never reaches a backend method; unlike
/// the A5 face the port method HAS a default body, so the honest
/// structural difference holds: a declared-but-unimplemented backend CAN
/// exist at the type level, and BOTH layers answer `capability_missing`
/// (the route gate first). The port's typed errors travel verbatim (the
/// P2 read-face precedent — no read-face fold exists); the result document
/// is the port's `RepoCatalogV01` projected through serde, stamped with
/// the family const at envelope assembly (P1 discipline: the route stamps
/// the const, the backend facts stay verbatim).
fn packages_repo_catalog(
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(params) = request.get("params").and_then(Value::as_object) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    // The closed two-key set: exactly repoId + packageIds, both present.
    if params.len() != 2 || !params.contains_key("repoId") || !params.contains_key("packageIds") {
        return packages_invalid_params(request_id, correlation_id);
    }
    let repo_id = match params.get("repoId") {
        Some(Value::Null) => None,
        Some(Value::String(id)) if !id.is_empty() => Some(id.clone()),
        _ => return packages_invalid_params(request_id, correlation_id),
    };
    let package_ids: Option<Vec<String>> = match params.get("packageIds") {
        Some(Value::Null) => None,
        Some(Value::Array(items)) => {
            let mut ids = Vec::with_capacity(items.len());
            for item in items {
                match item.as_str() {
                    Some(id) if !id.is_empty() => ids.push(id.to_owned()),
                    _ => return packages_invalid_params(request_id, correlation_id),
                }
            }
            // An empty array is a shape violation, not a third state next
            // to null; so is a duplicate id (the frozen schema's
            // uniqueItems law).
            if ids.is_empty() || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len() {
                return packages_invalid_params(request_id, correlation_id);
            }
            Some(ids)
        }
        _ => return packages_invalid_params(request_id, correlation_id),
    };
    if !vpm.repo_catalog_capabilities().repo_catalog {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let catalog = vpm.repo_catalog(repo_id.as_deref(), package_ids.as_deref().unwrap_or(&[]));
    match catalog {
        Ok(catalog) => {
            let mut result = serde_json::to_value(&catalog).unwrap_or_else(|_| json!({}));
            result["schemaVersion"] = json!(PACKAGES_REPO_CATALOG_SCHEMA_VERSION_V01);
            FrameOutcome::Response(application_success(
                request_id,
                json!({
                    "schemaVersion": PACKAGES_REPO_CATALOG_ENVELOPE_SCHEMA_VERSION_V01,
                    "operation": "packages.repoCatalog",
                    "result": result,
                }),
            ))
        }
        Err(error) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            &error.code,
            &error.message_key,
            app_error_category(error.category),
        )),
    }
}

/// `packages.packageCatalog` (proposal 025 P2 freeze batch): the on-demand
/// per-package catalog facts for ONE package in ONE registered project's
/// context. projectPath is validated against the SAME 013 inspection
/// aggregate the P1 face uses (same fact, same code:
/// `vua.project.project_not_found` — an off-aggregate path never reaches
/// the backend); params are the frozen two-key closed set {projectPath,
/// packageId}, both non-empty strings — an extra key, a missing key, or an
/// empty value is a shape violation, never a default. The catalog
/// capability is the separate declaration (`catalog_capabilities`); the
/// backend's typed errors (`vua.vpm.no_matching_package` among them)
/// travel verbatim — an unknown package is its own honest answer, never an
/// empty masquerade. The RESULT family is negotiated additively (proposal
/// 025 inline ruling): a backend declaring `catalog_v02` answers
/// `vua.packages-catalog/v0.2` (result carries the REQUIRED cacheSourced
/// disclosure); any other backend keeps answering the frozen
/// `vua.packages-catalog/v0.1` family — the stamped const tells the
/// consumer which word face answered, never a guess.
fn packages_package_catalog(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        // The registration-validation face is unwired: without the 013
        // aggregate the not-found calibration does not exist, so the whole
        // face stays honestly absent (the P1 same-face discipline).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some(params) = request.get("params").and_then(Value::as_object) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    let path_value = params.get("projectPath").and_then(Value::as_str);
    let id_value = params.get("packageId").and_then(Value::as_str);
    let (project_path, package_id) = match (path_value, id_value) {
        (Some(path), Some(id)) if !path.is_empty() && !id.is_empty() && params.len() == 2 => {
            (path, id)
        }
        _ => return packages_invalid_params(request_id, correlation_id),
    };
    let snapshot = collect_project_inspections(
        &project_ops.vcc_settings_candidates,
        &project_ops.manager_roots,
        &SystemClock,
    );
    let registered = snapshot
        .projects
        .iter()
        .any(|project| project.path == project_path);
    if !registered {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    }
    if !vpm.catalog_capabilities().catalog {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    // Additive dual-version negotiation (proposal 025 inline ruling): a
    // backend that declares `catalog_v02` answers the v0.2 result family
    // (with the REQUIRED cacheSourced disclosure fact); every other backend
    // keeps answering the frozen v0.1 family. The family const is an
    // envelope-assembly fact (P1 discipline): the route stamps it, the
    // backend facts stay verbatim — the consumer reads the const, never
    // guesses the word face.
    let (result_value, family_const) = if vpm.catalog_v02() {
        let catalog = vpm.package_catalog_v02(
            &ProjectRef {
                id: project_path.to_string(),
                root: PathBuf::from(project_path),
            },
            package_id,
        );
        match catalog {
            Ok(catalog) => (serde_json::to_value(&catalog).unwrap_or_else(|_| json!({})), PACKAGES_CATALOG_SCHEMA_VERSION_V02),
            Err(error) => {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                ));
            }
        }
    } else {
        let catalog = vpm.package_catalog(
            &ProjectRef {
                id: project_path.to_string(),
                root: PathBuf::from(project_path),
            },
            package_id,
        );
        match catalog {
            Ok(catalog) => (serde_json::to_value(&catalog).unwrap_or_else(|_| json!({})), PACKAGES_CATALOG_SCHEMA_VERSION),
            Err(error) => {
                return FrameOutcome::Response(application_error(
                    request_id,
                    correlation_id,
                    &error.code,
                    &error.message_key,
                    app_error_category(error.category),
                ));
            }
        }
    };
    let mut result = result_value;
    result["schemaVersion"] = json!(family_const);
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": PACKAGES_QUERY_SCHEMA_VERSION,
            "operation": "packages.packageCatalog",
            "result": result,
        }),
    ))
}

/// The A1 removal word face's synchronous-face error projection (proposal
/// 026 A1 wiring, 2026-09-19). The port-level `vua.vpm.*` family keeps
/// existing as implementation-layer fact; the frozen wire closed set is
/// `vua.packages.*` (first freeze batch, guard value = code suffix). The
/// one known port fact with a closed-set slot (`package_not_installed` →
/// `vua.packages.package_not_found`) projects; UNKNOWN port codes pass
/// through verbatim (the P1 read-face precedent — implementation-layer
/// facts travel as they are; the full projection mapping declaration
/// rides the environment implementation-verification slice).
fn packages_ops_envelope_error(
    request_id: &str,
    correlation_id: &str,
    error: &AppErrorV1,
) -> FrameOutcome {
    let (code, message_key): (String, String) = match error.code.as_str() {
        "vua.vpm.package_not_installed" => (
            "vua.packages.package_not_found".to_owned(),
            "errors.packages.packageNotFound".to_owned(),
        ),
        _ => (error.code.clone(), error.message_key.clone()),
    };
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        &code,
        &message_key,
        app_error_category(error.category),
    ))
}

/// The typed guard refusal document (frozen rejected arm: guard
/// three-value closed set + `vua.packages.*` code + free-text detail).
/// The family const is the CALLER's word-face generation: the v0.1 A1
/// removal row stamps v0.1, the v0.2 A2 install row stamps v0.2 — the
/// word face that answered is never a guess.
fn packages_ops_rejected(
    schema_version: &'static str,
    guard: &str,
    code: &str,
    detail: String,
) -> Value {
    json!({
        "schemaVersion": schema_version,
        "kind": "rejected",
        "guard": guard,
        "code": code,
        "detail": detail,
    })
}

/// Port error → rejected-arm projection INSIDE the apply task: known port
/// codes map onto the frozen closed set; unknown ones fold into
/// `execution_failed` with the original port code inside `detail` (honest
/// provenance — never a fabricated fourth guard; the guard set is frozen
/// closed, and the rejected arm's schema pattern locks the code to
/// `^vua\.packages\.`, so port codes can never travel verbatim there).
fn packages_ops_port_rejection(error: &AppErrorV1) -> Value {
    let (guard, code) = match error.code.as_str() {
        "vua.vpm.preview_drift" => ("preview_drift", "vua.packages.preview_drift"),
        "vua.vpm.package_not_installed" => {
            ("package_not_found", "vua.packages.package_not_found")
        }
        _ => ("execution_failed", "vua.packages.execution_failed"),
    };
    packages_ops_rejected(
        PACKAGES_OPS_SCHEMA_VERSION,
        guard,
        code,
        format!("port code {}: {}", error.code, error.message_key),
    )
}

/// Closed param set of the A1 removal pair: `{ projectPath, packageIds }`,
/// plus `confirmedDigest` on the apply command only. `packageIds` is an
/// explicit non-empty closed list (no wildcard, no "remove everything"
/// shorthand, unique entries); a preview request carrying a digest is a
/// shape violation by the frozen command schema (the digest is the
/// preview's product). Violations answer `vua.packages.invalid_params` at
/// the route layer — never absence, never a fabricated plan.
fn packages_ops_remove_params(
    request: &Value,
    require_digest: bool,
) -> Option<(String, Vec<String>, String)> {
    let params = request.get("params")?.as_object()?;
    let allowed = ["projectPath", "packageIds", "confirmedDigest"];
    if params.keys().any(|key| !allowed.contains(&key.as_str())) {
        return None;
    }
    if params.contains_key("confirmedDigest") != require_digest {
        return None;
    }
    let project_path = params.get("projectPath")?.as_str()?;
    if project_path.is_empty() {
        return None;
    }
    let entries = params.get("packageIds")?.as_array()?;
    if entries.is_empty() {
        return None;
    }
    let mut package_ids = Vec::with_capacity(entries.len());
    for entry in entries {
        let id = entry.as_str()?;
        if id.is_empty() {
            return None;
        }
        package_ids.push(id.to_owned());
    }
    let unique: std::collections::HashSet<&String> = package_ids.iter().collect();
    if unique.len() != package_ids.len() {
        return None;
    }
    let confirmed_digest = if require_digest {
        let digest = params.get("confirmedDigest")?.as_str()?;
        if digest.is_empty() {
            return None;
        }
        digest.to_owned()
    } else {
        String::new()
    };
    Some((project_path.to_owned(), package_ids, confirmed_digest))
}

/// The A1 removal pair validates registration against the SAME 013
/// inspection aggregate `project.inspectProject` uses (same fact, same
/// code: `vua.project.project_not_found` — the frozen reuse ruling). On
/// the apply command this check stays at the route layer: the rejected
/// arm's code schema locks `^vua\.packages\.`, so a reused 013 code can
/// never travel inside a rejected document — the refusal travels as the
/// typed envelope error instead.
fn packages_ops_registered_project(project_ops: &ProjectOpsServices, project_path: &str) -> bool {
    let snapshot = collect_project_inspections(
        &project_ops.vcc_settings_candidates,
        &project_ops.manager_roots,
        &SystemClock,
    );
    snapshot
        .projects
        .iter()
        .any(|project| project.path == project_path)
}

/// `packages.previewRemove` (proposal 026 A1 wiring): the SYNCHRONOUS
/// read-only change preview — it never mutates any state, and its
/// failures travel as wire-envelope errors, never result arms (the
/// operation/kind lock: this method answers kind=plan exactly). The plan
/// document is the port's `ChangePreviewV1` serde projection (camelCase
/// frozen by the consumer test) stamped with the family const, the kind
/// and the requested projectPath.
fn packages_preview_remove(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        // Without the 013 aggregate the not-found calibration does not
        // exist, so the whole face stays honestly absent (P1 precedent).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some((project_path, package_ids, _)) = packages_ops_remove_params(request, false) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !packages_ops_registered_project(&project_ops, &project_path) {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    }
    if !vpm.capabilities().remove_packages {
        // The frozen command schema's serving gate: a wired engine whose
        // backend declares no removal capability answers the generic
        // capability-missing arm (P1 same face).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let preview = vpm.preview_remove(
        &ProjectRef {
            id: project_path.clone(),
            root: PathBuf::from(&project_path),
        },
        &package_ids,
    );
    let preview = match preview {
        Ok(preview) => preview,
        Err(error) => {
            return packages_ops_envelope_error(request_id, correlation_id, &error);
        }
    };
    // Invariant: ChangePreviewV1 is a plain serde struct — serialization
    // cannot fail; a silent fallback would fabricate a plan.
    let mut plan = serde_json::to_value(&preview).expect("ChangePreviewV1 serialization cannot fail");
    plan["schemaVersion"] = json!(PACKAGES_OPS_SCHEMA_VERSION);
    plan["kind"] = json!("plan");
    plan["projectPath"] = json!(project_path);
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": PACKAGES_QUERY_SCHEMA_VERSION,
            "operation": "packages.previewRemove",
            "result": plan,
        }),
    ))
}

/// `packages.applyRemove` (proposal 026 A1 wiring): the NINE-STATE
/// task-driven write command (import-copy same shape — the task accepts,
/// the terminal reflux carries the frozen result document). The
/// double-digest discipline is enforced HERE, at the wire layer: the
/// preview is re-computed before execution and any drift refuses as the
/// typed `preview_drift` guard — the authoritative verdict lives
/// server-side (014 arbitration point 2), never delegated to backend
/// goodwill; the backend's own second digest check stays as defense in
/// depth. A typed guard refusal is a Done payload carrying the frozen
/// `rejected` result document (the task honestly completed; the removal
/// was refused), never a transport error; the digest drift is a
/// RECOVERABLE conflict (re-preview and re-confirm — never a silent
/// overwrite, never an implicit resumption, honesty rule 3).
fn packages_apply_remove(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some((project_path, package_ids, confirmed_digest)) =
        packages_ops_remove_params(request, true)
    else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !packages_ops_registered_project(&project_ops, &project_path) {
        // Route-layer refusal: the reused 013 code cannot travel inside a
        // rejected document (rejected.code locks `^vua\.packages\.`).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    }
    if !vpm.capabilities().remove_packages {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let project = ProjectRef {
                id: project_path.clone(),
                root: PathBuf::from(&project_path),
            };
            // Server-side re-computation BEFORE execution (ORC-WF-003/004):
            // drift refuses before the backend is ever asked to apply.
            let result: Value = match vpm.preview_remove(&project, &package_ids) {
                Err(error) => packages_ops_port_rejection(&error),
                Ok(fresh) => {
                    if fresh.digest != confirmed_digest {
                        packages_ops_rejected(
                            PACKAGES_OPS_SCHEMA_VERSION,
                            "preview_drift",
                            "vua.packages.preview_drift",
                            format!(
                                "confirmed digest {confirmed_digest} does not match the \
                                 re-computed preview digest {}",
                                fresh.digest
                            ),
                        )
                    } else {
                        match vpm.apply_remove(&project, &package_ids, &confirmed_digest) {
                            Ok(applied) => {
                                // The audit receipt: the confirmed digest echo +
                                // the request list + the backend's actually
                                // removed items (port `{removed: items}`
                                // verbatim). A backend result without the item
                                // array is a port-contract violation: it
                                // refuses honestly instead of fabricating a
                                // receipt.
                                match applied.get("removed").filter(|v| v.is_array()).cloned() {
                                    Some(removed_items) => json!({
                                        "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION,
                                        "kind": "receipt",
                                        "projectPath": project_path,
                                        "confirmedDigest": confirmed_digest,
                                        "requestedPackageIds": package_ids,
                                        "removedItems": removed_items,
                                    }),
                                    None => packages_ops_rejected(
                                        PACKAGES_OPS_SCHEMA_VERSION,
                                        "execution_failed",
                                        "vua.packages.execution_failed",
                                        "the backend result carried no `removed` item array \
                                         (port contract: {\"removed\": items})"
                                            .to_owned(),
                                    ),
                                }
                            }
                            Err(error) => packages_ops_port_rejection(&error),
                        }
                    }
                }
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_QUERY_SCHEMA_VERSION,
                "operation": "packages.applyRemove",
                "result": result,
            })))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": PACKAGES_QUERY_SCHEMA_VERSION,
                "operation": "packages.applyRemove",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task
        // authority (import-copy same face, provider-layer code — the
        // failure is the task authority's, not the packages domain's).
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.persistence_failed",
            "errors.provider.persistence",
            "internal",
        )),
    }
}

/// Closed param set of the A2 install pair: `{ projectPath, packages }`,
/// plus `confirmedDigest` on the apply command only. Each packages row is
/// `{ packageId, version }` with version REQUIRED and nullable (the
/// version-selection semantics frozen with the A2 batch: null = the
/// resolver picks the latest stable, a string = pin exactly that version —
/// upgrade and downgrade share the pin syntax). A repeated packageId
/// across rows is a word-face violation even when the versions differ; a
/// preview request carrying a digest is a shape violation (the digest is
/// the preview's product). Violations answer `vua.packages.invalid_params`
/// at the route layer — never absence, never a fabricated plan.
fn packages_ops_install_params(
    request: &Value,
    require_digest: bool,
) -> Option<(String, Vec<PackageRequestV1>, String)> {
    let params = request.get("params")?.as_object()?;
    let allowed = ["projectPath", "packages", "confirmedDigest"];
    if params.keys().any(|key| !allowed.contains(&key.as_str())) {
        return None;
    }
    if params.contains_key("confirmedDigest") != require_digest {
        return None;
    }
    let project_path = params.get("projectPath")?.as_str()?;
    if project_path.is_empty() {
        return None;
    }
    let rows = params.get("packages")?.as_array()?;
    if rows.is_empty() {
        return None;
    }
    let mut requests = Vec::with_capacity(rows.len());
    for row in rows {
        let row = row.as_object()?;
        if row.len() != 2 || !row.contains_key("packageId") || !row.contains_key("version") {
            return None;
        }
        let package_id = row.get("packageId")?.as_str()?;
        if package_id.is_empty() {
            return None;
        }
        let version = match row.get("version") {
            Some(Value::Null) => None,
            Some(Value::String(version)) if !version.is_empty() => Some(version.to_owned()),
            _ => return None,
        };
        requests.push(PackageRequestV1 {
            package_id: package_id.to_owned(),
            version,
        });
    }
    let mut seen = std::collections::HashSet::new();
    if !requests.iter().all(|request| seen.insert(&request.package_id)) {
        return None;
    }
    let confirmed_digest = if require_digest {
        let digest = params.get("confirmedDigest")?.as_str()?;
        if digest.is_empty() {
            return None;
        }
        digest.to_owned()
    } else {
        String::new()
    };
    Some((project_path.to_owned(), requests, confirmed_digest))
}

/// Port error → envelope-error projection for the A2 install preview face.
/// The frozen A2 mapping: `no_matching_package` (a pinned version the
/// resolver cannot satisfy) answers the closed-set
/// `vua.packages.package_not_found`; the preview-phase failure code folds
/// into the one new envelope-face code `vua.packages.preview_failed`;
/// word-out port codes pass through verbatim (the P1 discipline — the
/// closed set is never stretched at runtime).
fn packages_ops_install_envelope_error(
    request_id: &str,
    correlation_id: &str,
    error: &AppErrorV1,
) -> FrameOutcome {
    let (code, message_key): (String, String) = match error.code.as_str() {
        "vua.vpm.no_matching_package" => (
            "vua.packages.package_not_found".to_owned(),
            "errors.packages.packageNotFound".to_owned(),
        ),
        "vua.vpm.preview_failed" => (
            "vua.packages.preview_failed".to_owned(),
            "errors.packages.previewFailed".to_owned(),
        ),
        _ => (error.code.clone(), error.message_key.clone()),
    };
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        &code,
        &message_key,
        app_error_category(error.category),
    ))
}

/// Port error → rejected-arm projection INSIDE the A2 apply task: the
/// frozen mapping projects `preview_drift` and `no_matching_package` onto
/// their closed-set words; `apply_failed` and every word-out port code
/// fold into `execution_failed` carrying the original port code in
/// `detail` (honest provenance — the guard set is frozen closed and the
/// rejected arm's schema pattern locks the code to `^vua\.packages\.`).
fn packages_ops_install_port_rejection(error: &AppErrorV1) -> Value {
    let (guard, code) = match error.code.as_str() {
        "vua.vpm.preview_drift" => ("preview_drift", "vua.packages.preview_drift"),
        "vua.vpm.no_matching_package" => {
            ("package_not_found", "vua.packages.package_not_found")
        }
        "vua.vpm.apply_failed" => ("execution_failed", "vua.packages.execution_failed"),
        _ => ("execution_failed", "vua.packages.execution_failed"),
    };
    packages_ops_rejected(
        PACKAGES_OPS_SCHEMA_VERSION_V02,
        guard,
        code,
        format!("port code {}: {}", error.code, error.message_key),
    )
}

/// Closed param set of the A3 registration command: `{ packageRoot }` —
/// the single key, nothing else. A carried `confirmedDigest` is a shape
/// violation (no digest, no confirmation chain: the user's explicit
/// submission IS the confirmation); a carried `projectPath` likewise
/// (registration never touches a project and never mutates the user's
/// VCC/ALCOM settings). Violations answer `vua.packages.invalid_params`
/// at the route layer — never absence, never a fabricated receipt.
fn packages_ops_register_params(request: &Value) -> Option<String> {
    let params = request.get("params")?.as_object()?;
    if params.len() != 1 {
        return None;
    }
    let package_root = params.get("packageRoot")?.as_str()?;
    if package_root.is_empty() {
        return None;
    }
    Some(package_root.to_owned())
}

/// Port error → rejected-arm projection INSIDE the A3 registration task:
/// the guard closed set stands at the A1/A2 three values and A3 adds NO
/// guard — registration has no preview to drift and no resolver to miss,
/// so every port refusal (`local_package_invalid` /
/// `local_package_register_failed`, the trait default's
/// `capability_missing` for an unimplemented backend, and every word-out
/// code) folds into `execution_failed` carrying the original port code
/// inside `detail` (honest provenance — the rejected arm's schema pattern
/// locks the code to `^vua\.packages\.`, so port codes can never travel
/// verbatim there).
fn packages_ops_register_port_rejection(error: &AppErrorV1) -> Value {
    packages_ops_rejected(
        PACKAGES_OPS_SCHEMA_VERSION_V03,
        "execution_failed",
        "vua.packages.execution_failed",
        format!("port code {}: {}", error.code, error.message_key),
    )
}

/// Closed param set of the A4 `packages.addRemoteRepo` command:
/// `{ url, name }` — the two keys, nothing else. A carried
/// `confirmedDigest` is a shape violation (the user's explicit submission
/// IS the confirmation — ADR-0006's destructive path does not exist:
/// adding one subscription row deletes nothing); a carried `projectPath`
/// likewise (the subscription face writes the backend's ISOLATED
/// environment only). Both keys are non-empty strings. Violations answer
/// `vua.packages.invalid_params` at the route layer — never absence,
/// never a fabricated receipt.
fn packages_ops_add_remote_params(request: &Value) -> Option<(String, String)> {
    let params = request.get("params")?.as_object()?;
    if params.len() != 2 {
        return None;
    }
    let url = params.get("url")?.as_str()?;
    let name = params.get("name")?.as_str()?;
    if url.is_empty() || name.is_empty() {
        return None;
    }
    Some((url.to_owned(), name.to_owned()))
}

/// Closed param set of the A4 `packages.addLocalRepo` command:
/// `{ path, name }` — the two keys, nothing else, same shape law as
/// `addRemoteRepo` (no network segment on this method, but the closed-set
/// and no-projectPath disciplines are face-wide).
fn packages_ops_add_local_params(request: &Value) -> Option<(String, String)> {
    let params = request.get("params")?.as_object()?;
    if params.len() != 2 {
        return None;
    }
    let path = params.get("path")?.as_str()?;
    let name = params.get("name")?.as_str()?;
    if path.is_empty() || name.is_empty() {
        return None;
    }
    Some((path.to_owned(), name.to_owned()))
}

/// Closed param set of the A4 `packages.removeRepo` command:
/// `{ repoId }` — the single key, nothing else (the stable row handle;
/// index addressing is NOT frozen). Violations answer
/// `vua.packages.invalid_params` at the route layer.
fn packages_ops_remove_repo_params(request: &Value) -> Option<String> {
    let params = request.get("params")?.as_object()?;
    if params.len() != 1 {
        return None;
    }
    let repo_id = params.get("repoId")?.as_str()?;
    if repo_id.is_empty() {
        return None;
    }
    Some(repo_id.to_owned())
}

/// Port error → rejected-arm projection INSIDE the A4 repo-write tasks:
/// the guard closed set stands at the A1/A2/A3 three values and A4 adds
/// NO guard — the face has no preview to drift and no resolver to miss,
/// so every port refusal (`repo_invalid` / `repo_not_found` /
/// `repo_fetch_failed` / `repo_write_failed`, the trait default's
/// `capability_missing` for an unimplemented backend, and every word-out
/// code) folds into `execution_failed` carrying the original port code
/// inside `detail` (honest provenance — the rejected arm's schema pattern
/// locks the code to `^vua\.packages\.`, so port codes can never travel
/// verbatim there). The add face claims NO idempotence: where the backend
/// refuses a duplicate, the wire answers the refusal honestly — no
/// idempotent success is invented. The family const travels with the
/// caller's word-face row: the A4 add/remove routes stamp the frozen v0.4
/// family, the F4 lifecycle routes stamp the frozen v0.6 family — the
/// same fold law per row, never a cross-row stamp.
fn packages_ops_repo_port_rejection(schema_version: &'static str, error: &AppErrorV1) -> Value {
    packages_ops_rejected(
        schema_version,
        "execution_failed",
        "vua.packages.execution_failed",
        format!("port code {}: {}", error.code, error.message_key),
    )
}

/// `packages.previewInstall` (proposal 026 A2 wiring): the SYNCHRONOUS
/// read-only change preview — it resolves dependencies against the
/// registered repositories and MAY hit the network (the online refresh
/// degrades to the package cache on failure INSIDE the backend, per the
/// ORC-ADP-006 isomorphic precedent; the wire face carries no disclosure
/// field — the frozen A2 honesty boundary, the double-digest guard stays
/// the safety net). It never mutates any state, and its failures travel
/// as wire-envelope errors, never result arms (the operation/kind lock:
/// this method answers kind=plan exactly). The plan document is the
/// port's `ChangePreviewV1` serde projection (camelCase frozen by the
/// consumer test) stamped with the v0.2 family const, the kind and the
/// requested projectPath. An install plan carries conflict-triggered
/// REMOVE rows verbatim (ORC-WF-002: the plan must cover every change the
/// backend will make).
fn packages_preview_install(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        // Without the 013 aggregate the not-found calibration does not
        // exist, so the whole face stays honestly absent (P1 precedent).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some((project_path, packages, _)) = packages_ops_install_params(request, false) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !packages_ops_registered_project(&project_ops, &project_path) {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    }
    if !vpm.capabilities().preview_install {
        // The frozen v0.2 command schema's serving gate: a wired engine
        // whose backend declares no install capability answers the generic
        // capability-missing arm (P1 same face).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let preview = vpm.preview_install(
        &ProjectRef {
            id: project_path.clone(),
            root: PathBuf::from(&project_path),
        },
        &packages,
    );
    let preview = match preview {
        Ok(preview) => preview,
        Err(error) => return packages_ops_install_envelope_error(request_id, correlation_id, &error),
    };
    // Invariant: ChangePreviewV1 is a plain serde struct — serialization
    // cannot fail; a silent fallback would fabricate a plan.
    let mut plan = serde_json::to_value(&preview).expect("ChangePreviewV1 serialization cannot fail");
    plan["schemaVersion"] = json!(PACKAGES_OPS_SCHEMA_VERSION_V02);
    plan["kind"] = json!("plan");
    plan["projectPath"] = json!(project_path);
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V02,
            "operation": "packages.previewInstall",
            "result": plan,
        }),
    ))
}

/// `packages.applyInstall` (proposal 026 A2 wiring): the NINE-STATE
/// task-driven write command (the A1 applyRemove same shape — the task
/// accepts, the terminal reflux carries the frozen v0.2 result document).
/// The double-digest discipline is enforced HERE, at the wire layer: the
/// preview is re-computed before execution and any drift refuses as the
/// typed `preview_drift` guard — the authoritative verdict lives
/// server-side (014 arbitration point 2), never delegated to backend
/// goodwill; the backend's own second digest check stays as defense in
/// depth. A typed guard refusal is a Done payload carrying the frozen
/// `rejected` result document (the task honestly completed; the install
/// was refused), never a transport error; the digest drift is a
/// RECOVERABLE conflict (re-preview and re-confirm — never a silent
/// overwrite, never an implicit resumption, honesty rule 3). The apply
/// phase's repository load does NOT degrade — an online load failure
/// fails the task honestly.
fn packages_apply_install(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some((project_path, packages, confirmed_digest)) =
        packages_ops_install_params(request, true)
    else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !packages_ops_registered_project(&project_ops, &project_path) {
        // Route-layer refusal: the reused 013 code cannot travel inside a
        // rejected document (rejected.code locks `^vua\.packages\.`).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.project_not_found",
            "errors.project.projectNotFound",
            "validation",
        ));
    }
    if !vpm.capabilities().preview_install {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let project = ProjectRef {
                id: project_path.clone(),
                root: PathBuf::from(&project_path),
            };
            // Server-side re-computation BEFORE execution (ORC-WF-003/004):
            // drift refuses before the backend is ever asked to apply.
            let result: Value = match vpm.preview_install(&project, &packages) {
                Err(error) => packages_ops_install_port_rejection(&error),
                Ok(fresh) => {
                    if fresh.digest != confirmed_digest {
                        packages_ops_rejected(
                            PACKAGES_OPS_SCHEMA_VERSION_V02,
                            "preview_drift",
                            "vua.packages.preview_drift",
                            format!(
                                "confirmed digest {confirmed_digest} does not match the \
                                 re-computed preview digest {}",
                                fresh.digest
                            ),
                        )
                    } else {
                        match vpm.apply_install(&project, &packages, &confirmed_digest) {
                            Ok(applied) => {
                                // The audit receipt: the confirmed digest echo +
                                // the request rows verbatim (version-selection
                                // semantics included) + the backend's actually
                                // applied items (port `{"applied": items}`
                                // verbatim). A backend result without the item
                                // array is a port-contract violation: it
                                // refuses honestly instead of fabricating a
                                // receipt.
                                match applied.get("applied").filter(|v| v.is_array()).cloned() {
                                    Some(applied_items) => json!({
                                        "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V02,
                                        "kind": "receipt",
                                        "projectPath": project_path,
                                        "confirmedDigest": confirmed_digest,
                                        "requestedPackages": serde_json::to_value(&packages)
                                            .expect("PackageRequestV1 serialization cannot fail"),
                                        "appliedItems": applied_items,
                                    }),
                                    None => packages_ops_rejected(
                                        PACKAGES_OPS_SCHEMA_VERSION_V02,
                                        "execution_failed",
                                        "vua.packages.execution_failed",
                                        "the backend result carried no `applied` item array \
                                         (port contract: {\"applied\": items})"
                                            .to_owned(),
                                    ),
                                }
                            }
                            Err(error) => packages_ops_install_port_rejection(&error),
                        }
                    }
                }
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V02,
                "operation": "packages.applyInstall",
                "result": result,
            })))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V02,
                "operation": "packages.applyInstall",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task
        // authority (import-copy same face, provider-layer code — the
        // failure is the task authority's, not the packages domain's).
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.persistence_failed",
            "errors.provider.persistence",
            "internal",
        )),
    }
}

/// `packages.registerLocalPackage` (proposal 026 A3 wiring): the
/// NINE-STATE task-driven write command (the applyRemove/applyInstall
/// same shape — the task accepts, the terminal reflux carries the frozen
/// v0.3 result document). The family's ONLY face without a preview arm:
/// registration is an IDEMPOTENT set-add into the backend's ISOLATED
/// environment (the library's AlreadyAdded answers success exactly like
/// Success — first and repeat registration collapse into ONE success
/// fact), it is non-destructive, and there is no pre-existing state to
/// drift — no digest, no confirmation chain, no double-digest guard (the
/// user's explicit submission IS the confirmation; a carried
/// confirmedDigest is a shape violation). Params are the closed single
/// key {packageRoot}; NO projectPath is taken — registration never
/// touches a project and never mutates the user's VCC/ALCOM settings, so
/// there is no registered-project check either. The capability gate reads
/// the NEW defaulted accessor BEFORE submit — capability absence never
/// reaches a task. Every port refusal folds into the frozen
/// `execution_failed` guard carrying the original port code inside
/// detail (no invented fourth guard, honesty rule 3 intact: recovery
/// maps non-terminal residue to inspect_required and never resumes
/// implicitly).
fn packages_register_local_package(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        // The task surface requires the shared task authority; without it
        // the write face stays honestly absent (A1/A2 same face).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some(package_root) = packages_ops_register_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.register_capabilities().register_local_package {
        // The frozen v0.3 command schema's serving gate: a wired engine
        // whose backend declares no registration capability answers the
        // generic capability-missing arm BEFORE submit — capability
        // absence never reaches a task (the P1 same face).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.register_local_package(&PathBuf::from(&package_root)) {
                Ok(()) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V03,
                    "kind": "registered",
                    "packageRoot": package_root,
                }),
                Err(error) => packages_ops_register_port_rejection(&error),
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V03,
                "operation": "packages.registerLocalPackage",
                "result": result,
            })))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V03,
                "operation": "packages.registerLocalPackage",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task
        // authority (import-copy same face, provider-layer code — the
        // failure is the task authority's, not the packages domain's).
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.persistence_failed",
            "errors.provider.persistence",
            "internal",
        )),
    }
}

/// `packages.addRemoteRepo` (proposal 026 A4 wiring): the NINE-STATE
/// task-driven write command subscribing one REMOTE repository in the
/// backend's ISOLATED environment. The face deliberately breaks the
/// preview/apply pair shape (the A3 law): the manifest fetch is INHERENT
/// to execution (a preview arm would be a second network round-trip
/// pretending to be a safer first one), and there is no pre-existing
/// state digest to bind (the subscription list may drift — the honest
/// failure mode is the port answering at execution time). The user's
/// explicit submission IS the confirmation (adding one subscription row
/// deletes no package file and no project content). Params are the closed
/// two-key set {url, name}; NO projectPath is taken — the 013
/// project_not_found reuse does not apply to this face. The capability
/// gate reads the backend's OWN independent bit on the NEW defaulted
/// accessor BEFORE submit — capability absence never reaches a task (the
/// gate is per method, never per face: a backend may serve a subset).
/// Every port refusal folds into the frozen `execution_failed` guard
/// carrying the original port code inside detail; the success reflux
/// carries the minimal honest `repoReceipt` (remote variant: the request
/// echo and NOTHING else — the port answers unit, no payload invented;
/// NO idempotence claimed where the backend refuses duplicates). Recovery
/// maps non-terminal residue to inspect_required and never resumes
/// implicitly (honesty rule 3).
fn packages_add_remote_repo(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        // The task surface requires the shared task authority; without it
        // the write face stays honestly absent (A1/A2/A3 same face).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some((url, name)) = packages_ops_add_remote_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.repo_write_capabilities().add_remote_repo {
        // The frozen v0.4 command schema's serving gate, read BEFORE
        // submit on the method's OWN independent bit — capability absence
        // never reaches a task (the P1/A2/A3 same face).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.add_remote_repo(&url, &name) {
                Ok(()) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V04,
                    "kind": "repoReceipt",
                    "repoType": "remote",
                    "url": url,
                    "name": name,
                }),
                Err(error) => packages_ops_repo_port_rejection(PACKAGES_OPS_SCHEMA_VERSION_V04, &error),
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V04,
                "operation": "packages.addRemoteRepo",
                "result": result,
            })))
        }),
    });
    finish_repo_write_acceptance(
        accepted,
        "packages.addRemoteRepo",
        PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V04,
        request_id,
        correlation_id,
    )
}

/// `packages.addLocalRepo` (proposal 026 A4 wiring): the same task-driven
/// shape as `packages.addRemoteRepo` minus the network segment — the
/// closed two-key set {path, name}, the per-method capability gate on the
/// accessor's own `add_local_repo` bit BEFORE submit, and the minimal
/// honest `repoReceipt` (local variant: {schemaVersion, kind, repoType,
/// path, name} — the request echo and nothing else).
fn packages_add_local_repo(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some((path, name)) = packages_ops_add_local_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.repo_write_capabilities().add_local_repo {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.add_local_repo(std::path::Path::new(&path), &name) {
                Ok(()) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V04,
                    "kind": "repoReceipt",
                    "repoType": "local",
                    "path": path,
                    "name": name,
                }),
                Err(error) => packages_ops_repo_port_rejection(PACKAGES_OPS_SCHEMA_VERSION_V04, &error),
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V04,
                "operation": "packages.addLocalRepo",
                "result": result,
            })))
        }),
    });
    finish_repo_write_acceptance(
        accepted,
        "packages.addLocalRepo",
        PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V04,
        request_id,
        correlation_id,
    )
}

/// `packages.removeRepo` (proposal 026 A4 wiring): the same task-driven
/// shape, id-addressed on purpose (an index drifts under concurrent
/// writers; the id is the row's stable handle). The closed single-key set
/// {repoId}, the per-method gate on the accessor's own `remove_repo` bit
/// BEFORE submit, and the minimal honest `removed` receipt
/// ({schemaVersion, kind, repoId} — the echo IS the audit link, no
/// removed-row snapshot invented). An unknown repoId answers
/// `vua.vpm.repo_not_found` at execution time and folds into the frozen
/// `execution_failed` guard like every other refusal.
fn packages_remove_repo(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some(repo_id) = packages_ops_remove_repo_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.repo_write_capabilities().remove_repo {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.remove_repo(&repo_id) {
                Ok(()) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V04,
                    "kind": "removed",
                    "repoId": repo_id,
                }),
                Err(error) => packages_ops_repo_port_rejection(PACKAGES_OPS_SCHEMA_VERSION_V04, &error),
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V04,
                "operation": "packages.removeRepo",
                "result": result,
            })))
        }),
    });
    finish_repo_write_acceptance(
        accepted,
        "packages.removeRepo",
        PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V04,
        request_id,
        correlation_id,
    )
}

/// Closed param set of the F4 `packages.enableRepo` / `packages.disableRepo`
/// / `packages.refreshRepo` commands (proposal 027 F4 wiring):
/// `{ repoId }` — the single key, nothing else (the stable row handle, the
/// A4 `removeRepo` same handle; index addressing is NOT frozen). NO
/// `confirmedDigest` slot exists on any of the three (a state toggle diffs
/// no pre-existing summary and refresh IS the network act — a carried
/// digest is a shape violation) and NO `projectPath` is taken (the
/// lifecycle face addresses SUBSCRIPTION rows only). Violations answer
/// `vua.packages.invalid_params` at the route layer.
fn packages_ops_repo_lifecycle_params(request: &Value) -> Option<String> {
    let params = request.get("params")?.as_object()?;
    if params.len() != 1 {
        return None;
    }
    let repo_id = params.get("repoId")?.as_str()?;
    if repo_id.is_empty() {
        return None;
    }
    Some(repo_id.to_owned())
}

/// `packages.enableRepo` (proposal 027 F4 wiring, 2026-09-21): the A4
/// `packages.removeRepo` task-driven isomorph over the frozen
/// `schemas/packages-ops/v0.6/` word list. Re-activating one disabled
/// subscription row — VUA-owned semantics (the W25 evidence record ruling
/// (c): VCC carries NO enable/disable state anywhere). The per-method gate
/// reads ITS OWN bit off the defaulted `repo_lifecycle_capabilities`
/// accessor BEFORE submit (capability absence never reaches a task); the
/// receipt echoes the repoId and nothing else (the port answers
/// `Result<(), _>` — the echo IS the audit link; the new state itself is
/// read back on the packages-repos v0.2 subscription face, never
/// duplicated into the receipt). Every port refusal folds into the frozen
/// `execution_failed` guard carrying the original port code inside
/// `detail` (the reused `vua.vpm.*` codes never travel in the rejected
/// `code` key).
fn packages_enable_repo(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some(repo_id) = packages_ops_repo_lifecycle_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.repo_lifecycle_capabilities().enable_repo {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.enable_repo(&repo_id) {
                Ok(()) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V06,
                    "kind": "enabled",
                    "repoId": repo_id,
                }),
                Err(error) => {
                    packages_ops_repo_port_rejection(PACKAGES_OPS_SCHEMA_VERSION_V06, &error)
                }
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V06,
                "operation": "packages.enableRepo",
                "result": result,
            })))
        }),
    });
    finish_repo_write_acceptance(
        accepted,
        "packages.enableRepo",
        PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V06,
        request_id,
        correlation_id,
    )
}

/// `packages.disableRepo` (proposal 027 F4 wiring): excluding one
/// subscription row from the package-collection world (subscribed and
/// listed, never resolved). The disable set lives in VUA-OWNED STORAGE
/// under the environment root (the `.vua/vpm-repo-state.json` ruling word
/// face) — the wire face never touches the shared settings.json. Same
/// task-driven shape and fold law as `packages.enableRepo`.
fn packages_disable_repo(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some(repo_id) = packages_ops_repo_lifecycle_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.repo_lifecycle_capabilities().disable_repo {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.disable_repo(&repo_id) {
                Ok(()) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V06,
                    "kind": "disabled",
                    "repoId": repo_id,
                }),
                Err(error) => {
                    packages_ops_repo_port_rejection(PACKAGES_OPS_SCHEMA_VERSION_V06, &error)
                }
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V06,
                "operation": "packages.disableRepo",
                "result": result,
            })))
        }),
    });
    finish_repo_write_acceptance(
        accepted,
        "packages.disableRepo",
        PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V06,
        request_id,
        correlation_id,
    )
}

/// `packages.refreshRepo` (proposal 027 F4 wiring): the etag-conditional
/// cache refresh of one subscription row's OWN cache file (the network
/// segment is inherent to the face — the task is cancellable and the
/// nine-state machinery is substantive, the A4 task-driven isomorph). The
/// receipt REQUIRES `cacheUpdated` (the `RepoRefreshOutcomeV01` carrier):
/// true = the fetch wrote a new cache; false = etag unchanged, "already up
/// to date" — an honest SUCCESS either way. Same fold law as the two
/// toggle arms.
fn packages_refresh_repo(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some(repo_id) = packages_ops_repo_lifecycle_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.repo_lifecycle_capabilities().refresh_repo {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.refresh_repo(&repo_id) {
                Ok(outcome) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V06,
                    "kind": "refreshed",
                    "repoId": repo_id,
                    "cacheUpdated": outcome.cache_updated,
                }),
                Err(error) => {
                    packages_ops_repo_port_rejection(PACKAGES_OPS_SCHEMA_VERSION_V06, &error)
                }
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V06,
                "operation": "packages.refreshRepo",
                "result": result,
            })))
        }),
    });
    finish_repo_write_acceptance(
        accepted,
        "packages.refreshRepo",
        PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V06,
        request_id,
        correlation_id,
    )
}

/// Shared acceptance tail of the repo-write routes (the three A4
/// add/remove routes and the three F4 lifecycle routes): the acceptance
/// answer and the Done payload both stamp the CALLER's envelope const
/// ("0.4" for the A4 row, "0.6" for the F4 row — the result document
/// inside carries its own family const); submission rejection stays the
/// persistence failure of the task authority (import-copy same face,
/// provider-layer code — the failure is the task authority's, not the
/// packages domain's).
fn finish_repo_write_acceptance(
    accepted: Result<vua_orchestrator::CommandAcceptedV1, vua_orchestrator::AppErrorV1>,
    operation: &str,
    envelope_schema_version: &'static str,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": envelope_schema_version,
                "operation": operation,
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.persistence_failed",
            "errors.provider.persistence",
            "internal",
        )),
    }
}

/// Closed param set of the A5 `packages.createProject` command:
/// `{ parent, name, template }` — the three-key closed set, nothing else.
/// `parent` and `name` are non-empty string facts (the backend's own name
/// validation is the execution-time authority — the wire face does not
/// re-litigate upstream name grammar). `template` is REQUIRED-nullable per
/// the frozen v0.5 word face: the KEY must be present (a missing key is a
/// violation), `null` = the backend's default template resolution (the
/// port `Option None` fact), a non-empty string = that template name/path
/// passed verbatim, an empty string is a violation. NO `projectPath` is
/// taken — creation addresses no registered project (the 013
/// `project_not_found` reuse does not apply, the `parent` is a path fact
/// never a project identity); no digest, no confirmation chain — a carried
/// `confirmedDigest` is a shape violation (the user's explicit form
/// submission IS the confirmation). Violations answer
/// `vua.packages.invalid_params` at the route layer — never absence, never
/// a fabricated receipt.
fn packages_ops_create_params(request: &Value) -> Option<(String, String, Option<String>)> {
    let params = request.get("params")?.as_object()?;
    if params.len() != 3 {
        return None;
    }
    let parent = params.get("parent")?.as_str()?;
    let name = params.get("name")?.as_str()?;
    if parent.is_empty() || name.is_empty() {
        return None;
    }
    let template = match params.get("template")? {
        Value::Null => None,
        Value::String(template) if !template.is_empty() => Some(template.clone()),
        _ => return None,
    };
    Some((parent.to_owned(), name.to_owned(), template))
}

/// Port error → rejected-arm projection INSIDE the A5 creation task:
/// the guard closed set stands at the A1–A4 three values and A5 adds NO
/// guard — every port refusal (the library path's `template_missing`
/// carrying all four i18n message keys, the CLI path's `apply_failed` /
/// `backend_unavailable`, the required method's absence via the gate, and
/// every word-out code) folds into `execution_failed` carrying the
/// original port code inside `detail` (honest provenance — the rejected
/// arm's schema pattern locks the code to `^vua\.packages\.`, so the
/// reused `vua.vpm.*` codes can never travel verbatim there). The two
/// backends' refusal shapes honestly diverge and the wire face folds both
/// without inventing a unified shape. The creation face claims NO
/// idempotence: where the backend refuses an existing target, the wire
/// answers the refusal honestly — no idempotent success is invented.
fn packages_ops_create_port_rejection(error: &AppErrorV1) -> Value {
    packages_ops_rejected(
        PACKAGES_OPS_SCHEMA_VERSION_V05,
        "execution_failed",
        "vua.packages.execution_failed",
        format!("port code {}: {}", error.code, error.message_key),
    )
}

/// `packages.createProject` (proposal 026 A5 wiring): the NINE-STATE
/// task-driven write command creating one new project from a template,
/// mapped one-to-one onto the port method
/// `create_project(parent, name, template) -> Result<ProjectRef, _>`. The
/// second no-preview-pair member (the A3/A4 law, rooted in the port
/// itself): the port has exactly ONE creation method and NO
/// create-preview counterpart, a brand-new directory has no pre-existing
/// state to diff — the user's explicit form submission IS the
/// confirmation, and a carried `confirmedDigest` is a shape violation.
/// NO registered-project check runs at the route (creation addresses no
/// registered project; the 013 reuse does not apply — the backend's own
/// target-existence guard refuses at execution). The capability gate reads
/// the EXISTING five-bit `capabilities().create_project` member BEFORE
/// submit — capability absence never reaches a task (A5 freezes no new
/// accessor, unlike A3/A4). The success reflux carries the ONE
/// packages-ops receipt with an actual-result payload: the `created`
/// document projecting the port's `ProjectRef` — `projectId` = the
/// `ProjectRef.id` echo (an informational backend-minted fact, NOT the
/// 013 project identity key) and `projectPath` = the `ProjectRef.root`
/// echo (the new project's registered-path identity — the
/// registers-in-store side effect is the frozen port fact: creation
/// success = registration success). Every port refusal folds into the
/// frozen `execution_failed` guard carrying the original port code inside
/// detail. Recovery maps non-terminal residue to `inspect_required` and
/// never resumes implicitly (honesty rule 3).
fn packages_create_project(
    state: &HostState,
    vpm: Arc<dyn VpmBackend>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(project_ops) = state.project_ops.clone() else {
        // The task surface requires the shared task authority; without it
        // the write face stays honestly absent (A1–A4 same face).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            PACKAGES_UNAVAILABLE,
            "errors.packages.unavailable",
            "unavailable",
        ));
    };
    let Some((parent, name, template)) = packages_ops_create_params(request) else {
        return packages_invalid_params(request_id, correlation_id);
    };
    if !vpm.capabilities().create_project {
        // The frozen v0.5 command schema's serving gate, read BEFORE
        // submit on the EXISTING five-bit member — capability absence
        // never reaches a task (the P1/A2/A3/A4 same face; no new
        // accessor exists on this face to read instead).
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.vpm.capability_missing",
            "errors.vpm.capabilityMissing",
            "unavailable",
        ));
    }
    let accepted = project_ops.runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let result: Value = match vpm.create_project(
                std::path::Path::new(&parent),
                &name,
                template.as_deref(),
            ) {
                Ok(project_ref) => json!({
                    "schemaVersion": PACKAGES_OPS_SCHEMA_VERSION_V05,
                    "kind": "created",
                    "projectId": project_ref.id,
                    "projectPath": project_ref.root.to_string_lossy(),
                }),
                Err(error) => packages_ops_create_port_rejection(&error),
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V05,
                "operation": "packages.createProject",
                "result": result,
            })))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": PACKAGES_OPS_ENVELOPE_SCHEMA_VERSION_V05,
                "operation": "packages.createProject",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task
        // authority (import-copy same face, provider-layer code — the
        // failure is the task authority's, not the packages domain's).
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.persistence_failed",
            "errors.provider.persistence",
            "internal",
        )),
    }
}

fn app_error_category(category: ErrorCategory) -> &'static str {
    match category {
        ErrorCategory::Validation => "validation",
        ErrorCategory::Conflict => "conflict",
        ErrorCategory::Permission => "permission",
        ErrorCategory::Dependency => "dependency",
        ErrorCategory::Unavailable => "unavailable",
        ErrorCategory::Timeout => "timeout",
        ErrorCategory::Cancelled => "cancelled",
        ErrorCategory::ExternalFailure => "external_failure",
        ErrorCategory::Internal => "internal",
    }
}

/// `project.environmentManagers` (proposal 013, the read face): the
/// read-only VCC/ALCOM/editors snapshot — every finding is deterministic
/// for a given tree; paths to settings files travel as facts, the
/// user's projects are represented by their registrations.
fn project_environment_managers(
    project_ops: Arc<ProjectOpsServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    if let Some(params) = request.get("params") {
        let empty = params.as_object().map(|object| object.is_empty()).unwrap_or(false);
        if !empty {
            return project_invalid_params(request_id, correlation_id);
        }
    }
    let snapshot = collect_environment_managers_snapshot(
        &project_ops.vcc_settings_candidates,
        &project_ops.manager_roots,
        &project_ops.editor_roots,
        &SystemClock,
    );
    let result = serde_json::to_value(&snapshot)
        .unwrap_or_else(|_| json!({"schemaVersion": "vua.environment-managers-snapshot/v0.1"}));
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "schemaVersion": PROJECT_INSPECTION_SCHEMA_VERSION,
            "operation": "project.environmentManagers",
            "result": result,
        }),
    ))
}

fn project_invalid_params(request_id: &str, correlation_id: &str) -> FrameOutcome {
    FrameOutcome::Response(application_error(
        request_id,
        correlation_id,
        "vua.project.invalid_params",
        "errors.project.invalidParams",
        "validation",
    ))
}

/// `project.import-copy` (proposal 014, arbitrated): both phases run inside
/// the nine-state task — plan is the read-only confirmation face, apply
/// re-verifies the plan digest and executes the copy. A typed guard refusal
/// is a Done payload carrying the frozen `rejected` result document (the
/// task completed; the import was refused — the same discipline as the
/// warehouse generation guards), never a transport error.
fn project_import_copy(
    project_ops: Arc<ProjectOpsServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // Closed param set (frozen project-ops v0.1 command schema).
    let Some(params) = request.get("params").and_then(Value::as_object) else {
        return project_invalid_params(request_id, correlation_id);
    };
    let allowed = ["phase", "sourcePath", "targetParentDirectory", "targetProjectName", "confirmedPlanDigest"];
    if params.keys().any(|key| !allowed.contains(&key.as_str())) {
        return project_invalid_params(request_id, correlation_id);
    }
    let text_param = |key: &str| {
        params
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    let (Some(phase), Some(source_path), Some(target_parent), Some(name)) = (
        params.get("phase").and_then(Value::as_str),
        text_param("sourcePath"),
        text_param("targetParentDirectory"),
        text_param("targetProjectName"),
    ) else {
        return project_invalid_params(request_id, correlation_id);
    };
    if phase != "plan" && phase != "apply" {
        return project_invalid_params(request_id, correlation_id);
    }
    // apply must confirm the plan digest it executes; plan must not carry one.
    let confirmed_plan_digest = text_param("confirmedPlanDigest");
    if (phase == "apply" && confirmed_plan_digest.is_none())
        || (phase == "plan" && confirmed_plan_digest.is_some())
    {
        return project_invalid_params(request_id, correlation_id);
    }

    let job_correlation = correlation_id.to_owned();
    let is_apply = phase == "apply";
    let runtime = project_ops.runtime.clone();
    let accepted = runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            let import_request = ImportCopyRequest {
                source: Path::new(&source_path),
                target_parent: Path::new(&target_parent),
                name: &name,
                vcc_settings_candidates: &project_ops.vcc_settings_candidates,
                roots: &project_ops.manager_roots,
            };
            // A guard refusal is a result document, not an error: the task
            // honestly completed and its verdict is the frozen `rejected`
            // face. Only an unexpected internal failure fails the task.
            let result: Value = if is_apply {
                match apply_import_copy(
                    &import_request,
                    &confirmed_plan_digest.expect("apply requires the digest (checked above)"),
                    &job_correlation,
                    &SystemClock,
                ) {
                    // Invariant: ImportReceiptV01/ImportRejected are plain
                    // serde structs — serialization cannot fail; the old
                    // fallback fabricated a fake "rejected" document, which
                    // would have been a dishonest result.
                    Ok(receipt) => serde_json::to_value(receipt)
                        .expect("ImportReceiptV01 serialization cannot fail"),
                    Err(rejected) => serde_json::to_value(rejected)
                        .expect("ImportRejected serialization cannot fail"),
                }
            } else {
                match plan_import_copy(&import_request) {
                    // Invariant: ImportPlanV01 is a plain serde struct —
                    // serialization cannot fail.
                    Ok(plan) => serde_json::to_value(plan)
                        .expect("ImportPlanV01 serialization cannot fail"),
                    Err(rejected) => serde_json::to_value(rejected)
                        .expect("ImportRejected serialization cannot fail"),
                }
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PROJECT_OPS_SCHEMA_VERSION,
                "operation": "project.import-copy",
                "result": result,
            })))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": PROJECT_OPS_SCHEMA_VERSION,
                "operation": "project.import-copy",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task authority.
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.store_failed",
            "errors.project.storeFailed",
            "internal",
        )),
    }
}

/// `project.setNote` (project-ops v0.2, the D-6 desktop confirmation):
/// sets (or clears, with a null note) the user note of one VUA-native
/// project inside the nine-state task. Guards are server-side facts
/// evaluated inside the task and travel as the frozen `rejected` result
/// document — the task honestly completed and its verdict is the refusal
/// (the same discipline as import-copy): project_not_found when no
/// registered manager lists the path (the detection face's registry is
/// its world — the same set inspectProject answers over), not_vua_native
/// when no identity file exists (the note presupposes the VUA-native
/// declaration), identity_unreadable when the identity evidence cannot
/// be parsed (unreadable evidence is never overwritten by a blind
/// rewrite), execution_failed on the identity write itself. Only an
/// unexpected internal failure fails the task.
fn project_set_note(
    project_ops: Arc<ProjectOpsServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    // Closed param set (frozen project-ops v0.2 command schema).
    let Some(params) = request.get("params").and_then(Value::as_object) else {
        return project_invalid_params(request_id, correlation_id);
    };
    let allowed = ["projectPath", "note"];
    if params.keys().any(|key| !allowed.contains(&key.as_str())) {
        return project_invalid_params(request_id, correlation_id);
    }
    let Some(project_path) = params
        .get("projectPath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
    else {
        return project_invalid_params(request_id, correlation_id);
    };
    // null clears; a note is non-empty single-line plain text within the
    // frozen bound (characters, matching the JSON Schema maxLength).
    let note: Option<String> = match params.get("note") {
        Some(Value::Null) => None,
        Some(Value::String(text))
            if !text.is_empty()
                && text.chars().count() <= 2000
                && !text.contains('\n')
                && !text.contains('\r') =>
        {
            Some(text.clone())
        }
        _ => return project_invalid_params(request_id, correlation_id),
    };

    let runtime = project_ops.runtime.clone();
    let accepted = runtime.submit(vua_orchestrator::SubmitRequest {
        correlation_id: Some(correlation_id.to_owned()),
        timeout: None,
        job: Box::new(move |_| {
            // Guard 1 — registration: the detection face's registry is the
            // setNote world (the same aggregate inspectProject answers over).
            let snapshot = collect_project_inspections(
                &project_ops.vcc_settings_candidates,
                &project_ops.manager_roots,
                &SystemClock,
            );
            let registered = snapshot
                .projects
                .iter()
                .any(|project| project.path == project_path);
            // Invariant: the result documents below are plain serde shapes
            // (json object / flat struct) — serialization cannot fail; a
            // fabricated fallback would be a dishonest result.
            let result: Value = if !registered {
                note_rejected(
                    "project_not_found",
                    "no registered manager lists this path; the detection registry is the writable world",
                )
            } else {
                match set_note(Path::new(&project_path), note.as_deref()) {
                    Ok(identity) => serde_json::to_value(NoteStoredV01 {
                        kind: "note",
                        project_path: project_path.clone(),
                        marked_at: identity.marked_at,
                        note: identity.note,
                    })
                    .expect("NoteStoredV01 serialization cannot fail"),
                    Err(error) => match error {
                        SetNoteError::NotVuaNative => note_rejected(
                            "not_vua_native",
                            "project has no VUA identity file; notes attach to VUA-native projects only",
                        ),
                        SetNoteError::Unreadable => note_rejected(
                            "identity_unreadable",
                            "VUA identity file is unreadable; resolve it before editing the note",
                        ),
                        SetNoteError::Io(io_error) => note_rejected(
                            "execution_failed",
                            format!("identity write failed: {io_error}"),
                        ),
                    },
                }
            };
            Ok(vua_orchestrator::TaskExit::Done(json!({
                "schemaVersion": PROJECT_OPS_SCHEMA_VERSION,
                "operation": "project.setNote",
                "result": result,
            })))
        }),
    });
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": PROJECT_OPS_SCHEMA_VERSION,
                "operation": "project.setNote",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task authority.
        Err(_) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.project.store_failed",
            "errors.project.storeFailed",
            "internal",
        )),
    }
}

/// The frozen setNote `rejected` result document: guard value = code
/// suffix (the v0.1 `vua.project.*` mapping kept).
fn note_rejected(guard: &'static str, detail: impl Into<String>) -> Value {
    json!({
        "kind": "rejected",
        "guard": guard,
        "code": format!("vua.project.{guard}"),
        "detail": detail.into(),
    })
}

/// The setNote completion face: the stored note state of the VUA-native
/// identity, projected with the same markedAt/note field names the
/// project-inspection v0.2 vuaIdentity present face uses.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteStoredV01 {
    kind: &'static str,
    project_path: String,
    marked_at: String,
    note: Option<String>,
}

/// `warehouse.importDownloads` (bdl-commands v0.4, IMP-3): submits one
/// download-adoption task over the given download ids. Identity only — the
/// staging path, size and file name are server-side facts read from BDL's
/// download-event log; a client-supplied path is a params violation by the
/// frozen closed set. The acceptance envelope matches the frozen v0.4
/// result vector shape.
fn warehouse_import_downloads_submit(
    warehouse: Arc<WarehouseServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let download_ids = match request.get("params") {
        Some(Value::Object(params)) if params.keys().all(|key| key == "downloadIds") => {
            match params.get("downloadIds") {
                Some(Value::Array(ids)) if !ids.is_empty() => ids
                    .iter()
                    .map(|value| {
                        value
                            .as_str()
                            .filter(|raw| !raw.is_empty())
                            .map(str::to_owned)
                    })
                    .collect::<Option<Vec<String>>>(),
                _ => None,
            }
        }
        _ => None,
    };
    let Some(download_ids) = download_ids else {
        return warehouse_invalid_params(request_id, correlation_id);
    };
    let accepted = vua_acquisition::submit_warehouse_import_downloads(
        &warehouse.runtime,
        warehouse.bdl.clone(),
        Arc::new(SystemClock),
        vua_acquisition::WarehouseDownloadAdoptTaskSpec {
            correlation_id: correlation_id.to_owned(),
            download_ids,
            warehouse_root: warehouse.warehouse_root.clone(),
        },
        None,
    );
    match accepted {
        Ok(accepted) => FrameOutcome::Response(application_success(
            request_id,
            json!({
                "schemaVersion": BDL_COMMANDS_SCHEMA_VERSION,
                "operation": "warehouse.importDownloads",
                "taskId": accepted.task_id,
                "correlationId": correlation_id,
            }),
        )),
        // Submission rejection is a persistence failure of the task authority.
        Err(_) => warehouse_store_failed(request_id, correlation_id),
    }
}

fn download_request(
    state: &mut HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(downloads) = state.downloads.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.download.unavailable",
            "errors.download.unavailable",
            "unavailable",
        ));
    };
    match method {
        "download.ingest" => {
            download_ingest(state, downloads, request, request_id, correlation_id)
        }
        "download.retry" => {
            download_retry(state, downloads, request, request_id, correlation_id)
        }
        _ => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        )),
    }
}

fn download_ingest(
    state: &mut HostState,
    downloads: Arc<DownloadServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    if request.pointer("/params/schemaVersion").and_then(Value::as_str)
        != Some(vua_bdl_store::download_events::DOWNLOAD_EVENT_SCHEMA_VERSION)
    {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.download.unsupported_schema",
            "errors.download.unsupportedSchema",
            "validation",
        ));
    }
    let empty = Vec::new();
    let events = request
        .pointer("/params/events")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let consumer = DownloadEventConsumer::new(&downloads.bdl);
    let mut folded = 0u64;
    let mut duplicates = 0u64;
    let mut rejected: Vec<Value> = Vec::new();
    for (index, value) in events.iter().enumerate() {
        let event: DownloadEventV01 = match serde_json::from_value(value.clone()) {
            Ok(event) => event,
            Err(error) => {
                rejected.push(json!({
                    "index": index,
                    "code": "vua.download.invalid_event",
                    "reason": error.to_string(),
                }));
                continue;
            }
        };
        match consumer.ingest(&event) {
            Ok(IngestOutcome::Recorded { .. }) => {
                folded += 1;
                if let Err(error) = fold_download_task(state, &event) {
                    rejected.push(json!({
                        "index": index,
                        "code": "vua.download.store_failed",
                        "reason": error.to_string(),
                    }));
                }
            }
            Ok(IngestOutcome::Duplicate { .. }) => duplicates += 1,
            Err(error) => rejected.push(json!({
                "index": index,
                "code": consumer_error_code(&error),
                "reason": error.to_string(),
            })),
        }
    }
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "folded": folded,
            "duplicates": duplicates,
            "rejected": rejected,
        }),
    ))
}

/// The download task exists per ATTEMPT (`dl-<downloadId>-a<attempt>`): the
/// nine-state task records one run, and a fresh retry attempt is a new
/// record — the B3 attempt discipline. Folding is idempotent: a redelivered
/// event never advances a task twice.
fn fold_download_task(
    state: &HostState,
    event: &DownloadEventV01,
) -> Result<(), SqliteStoreError> {
    let task_id = format!("dl-{}-a{}", event.download_id, event.attempt);
    let occurred_at = event.occurred_at.as_str();
    match event.kind {
        vua_bdl_store::download_events::DownloadEventKind::Started => {
            if state.store.task(&task_id)?.is_none() {
                state.store.accept_task(&NewTask {
                    task_id: task_id.clone(),
                    correlation_id: event.download_id.clone(),
                    occurred_at: occurred_at.to_owned(),
                })?;
            }
            // The nine-state machine walks Queued -> Preparing -> Running;
            // a started download is already transferring, so it walks both
            // steps immediately (idempotently for redeliveries).
            let payload = || {
                json!({
                    "receivedBytes": event.received_bytes,
                    "expectedBytes": event.expected_bytes,
                })
            };
            if let Some(task) = state.store.task(&task_id)? {
                if task.state == TaskState::Queued {
                    state.store.mutate_task(
                        &task_id,
                        task.revision,
                        occurred_at,
                        TaskMutation::Transition {
                            state: TaskState::Preparing,
                            payload: payload(),
                        },
                    )?;
                }
            }
            if let Some(task) = state.store.task(&task_id)? {
                if task.state == TaskState::Preparing {
                    state.store.mutate_task(
                        &task_id,
                        task.revision,
                        occurred_at,
                        TaskMutation::Transition {
                            state: TaskState::Running,
                            payload: payload(),
                        },
                    )?;
                }
            }
        }
        vua_bdl_store::download_events::DownloadEventKind::Progress => {
            if let Some(task) = state.store.task(&task_id)? {
                if task.state == TaskState::Running {
                    state.store.mutate_task(
                        &task_id,
                        task.revision,
                        occurred_at,
                        TaskMutation::Progress {
                            payload: json!({
                                "receivedBytes": event.received_bytes,
                                "expectedBytes": event.expected_bytes,
                            }),
                        },
                    )?;
                }
            }
        }
        // interrupted returns to downloading: no task-side transition (the
        // same-attempt progress proves the resume).
        vua_bdl_store::download_events::DownloadEventKind::Interrupted => {}
        vua_bdl_store::download_events::DownloadEventKind::Completed => {
            complete_download_task(
                state,
                &task_id,
                occurred_at,
                TaskState::Succeeded,
                None,
            )?;
        }
        vua_bdl_store::download_events::DownloadEventKind::Cancelled => {
            complete_download_task(
                state,
                &task_id,
                occurred_at,
                TaskState::Cancelled,
                None,
            )?;
        }
        vua_bdl_store::download_events::DownloadEventKind::Failed => {
            let failure_kind = event
                .failure_kind
                .map(|kind| match kind {
                    vua_bdl_store::download_events::DownloadFailureKind::Policy => "policy",
                    vua_bdl_store::download_events::DownloadFailureKind::Unknown => "unknown",
                })
                .unwrap_or("unknown");
            let error = AppErrorV1::new(
                "vua.download.failed",
                ErrorCategory::ExternalFailure,
                "errors.download.failed",
                &event.download_id,
            )
            .with_param("failureKind", ParamValue::Text(failure_kind.to_owned()));
            complete_download_task(
                state,
                &task_id,
                occurred_at,
                TaskState::Failed,
                Some(error),
            )?;
        }
    }
    Ok(())
}

fn complete_download_task(
    state: &HostState,
    task_id: &str,
    occurred_at: &str,
    state_to: TaskState,
    error: Option<AppErrorV1>,
) -> Result<(), SqliteStoreError> {
    if let Some(task) = state.store.task(task_id)? {
        if !task.state.is_terminal() {
            state.store.mutate_task(
                task_id,
                task.revision,
                occurred_at,
                TaskMutation::Complete {
                    state: state_to,
                    error,
                    result: None,
                },
            )?;
        }
    }
    Ok(())
}

fn consumer_error_code(error: &ConsumerError) -> &'static str {
    match error {
        ConsumerError::SchemaVersion(_) => "vua.download.unsupported_schema",
        ConsumerError::AlreadyTerminal { .. } => "vua.download.already_terminal",
        ConsumerError::IllegalSequence { .. } => "vua.download.illegal_sequence",
        ConsumerError::Store(_) => "vua.download.store_failed",
    }
}

fn download_retry(
    state: &mut HostState,
    downloads: Arc<DownloadServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let task_id = request
        .pointer("/params/taskId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let task = match state.store.task(task_id) {
        Ok(Some(task)) => task,
        Ok(None) => {
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.task.not_found",
                "errors.task.notFound",
                "validation",
            ))
        }
        Err(error) => {
            let _ = error;
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.download.store_failed",
                "errors.download.storeFailed",
                "internal",
            ));
        }
    };
    let download_id = task.correlation_id.clone();
    let history = match downloads.bdl.download_events(&download_id) {
        Ok(history) => history,
        Err(error) => {
            let _ = error;
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.download.store_failed",
                "errors.download.storeFailed",
                "internal",
            ));
        }
    };
    let lifecycle = match fold_lifecycle(&download_id, &history) {
        Ok(lifecycle) => lifecycle,
        Err(error) => {
            let _ = error;
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.download.not_retryable",
                "errors.download.notRetryable",
                "conflict",
            ));
        }
    };
    let decision = retry_decision(&lifecycle);
    let intent = match decision {
        RetryDecision::Resume => "resume",
        RetryDecision::StartNextAttempt { .. } => "retry",
        RetryDecision::GiveUp => {
            return FrameOutcome::Response(application_error(
                request_id,
                correlation_id,
                "vua.download.not_retryable",
                "errors.download.notRetryable",
                "conflict",
            ))
        }
    };
    let intent_seq = downloads.queue_intent(&download_id, intent);
    FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "taskId": task_id,
            "decision": intent,
            "intentSeq": intent_seq,
        }),
    ))
}

pub(crate) fn application_error(
    request_id: &str,
    correlation_id: &str,
    code: &str,
    message_key: &str,
    category: &str,
) -> Value {
    application_error_with_params(
        request_id,
        correlation_id,
        code,
        message_key,
        category,
        &[],
    )
}

/// The error envelope with localized params (ORC-ERR-001 shape: user-facing
/// text goes through messageKey + params). The params object is emitted
/// ONLY when non-empty, so every pre-existing error keeps its exact wire
/// shape (no empty-params field appears). The U19 record-state blocked
/// rejection is the first admission-time emitter: it carries the record's
/// original `state` value so the localized wording can name it.
fn application_error_with_params(
    request_id: &str,
    correlation_id: &str,
    code: &str,
    message_key: &str,
    category: &str,
    params: &[(&str, vua_orchestrator::ParamValue)],
) -> Value {
    let mut error = json!({
        "contractVersion": APPLICATION_CONTRACT_VERSION,
        "code": code,
        "category": category,
        "messageKey": message_key,
        "recoverable": true,
        "retryable": false,
        "correlationId": correlation_id,
    });
    if !params.is_empty() {
        let object = error
            .as_object_mut()
            .expect("the error envelope is an object");
        object.insert(
            "params".to_owned(),
            json!(params
                .iter()
                .map(|(key, value)| (key.to_string(), serde_json::to_value(value)
                    .expect("ParamValue always serializes")))
                .collect::<serde_json::Map<String, Value>>()),
        );
    }
    json!({
        "contractVersion": APPLICATION_CONTRACT_VERSION,
        "requestId": request_id,
        "ok": false,
        "error": error,
    })
}

fn store_error_code(error: &SqliteStoreError) -> &'static str {
    match error {
        SqliteStoreError::UnknownTask(_) => "vua.task.not_found",
        SqliteStoreError::IdempotencyConflict { .. } => "vua.command.id_conflict",
        SqliteStoreError::LeaseInspectionRequired(_) => "vua.project.inspect_required",
        SqliteStoreError::LeaseFenceMismatch { .. } => "vua.project.lease_conflict",
        SqliteStoreError::RevisionConflict { .. } => "vua.task.revision_conflict",
        _ => "vua.provider.persistence_failed",
    }
}

fn store_error_category(error: &SqliteStoreError) -> &'static str {
    match error {
        SqliteStoreError::UnknownTask(_) => "validation",
        SqliteStoreError::IdempotencyConflict { .. }
        | SqliteStoreError::RevisionConflict { .. } => "conflict",
        _ => "internal",
    }
}

fn request_fingerprint(request: &Value) -> String {
    let bytes = serde_json::to_vec(request).expect("JSON value serializes");
    let digest = Sha256::digest(bytes);
    let mut text = String::from("sha256:");
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut text, "{byte:02x}").expect("writing to String");
    }
    text
}

fn method_and_task(request: &Value) -> Value {
    json!({
        "method": request.get("method").and_then(Value::as_str).unwrap_or(""),
        "taskId": request.pointer("/params/taskId").and_then(Value::as_str).unwrap_or(""),
    })
}

fn state_name(state: TaskState) -> &'static str {
    match state {
        TaskState::Queued => "queued",
        TaskState::Preparing => "preparing",
        TaskState::Running => "running",
        TaskState::WaitingForInput => "waiting_for_input",
        TaskState::Paused => "paused",
        TaskState::Succeeded => "succeeded",
        TaskState::SucceededWithWarnings => "succeeded_with_warnings",
        TaskState::Failed => "failed",
        TaskState::Cancelled => "cancelled",
    }
}

fn provider_instance_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("provider-{}-{nanos}", std::process::id())
}

fn now_rfc3339() -> String {
    use vua_orchestrator::Clock as _;
    vua_orchestrator::SystemClock.now_rfc3339()
}

// ==== production.* surface (production-use-case v0.1) ====
//
// Commands other than queries create persisted tasks; commandId idempotency
// is the store's `command_idempotency` table. Fast, non-Unity stages
// (Inspect, Plan) drive inline to a terminal state; confirmPlan/recover run
// the material intake executor on a worker thread and complete through the
// same store, so a host restart never loses an authoritative state.

/// Builds the production services from the provider process environment:
/// `VUA_UNITY_EDITOR` — absolute path to the pinned Unity editor executable,
/// `VUA_PROVIDER_DATA` — absolute root for the build records, package
/// identities, temp roots and the vrc-get environment. Both must be set and
/// absolute; anything else leaves production honestly unavailable.
pub fn production_config_from_env() -> Option<ProductionConfig> {
    let unity = std::env::var_os("VUA_UNITY_EDITOR")?;
    let data = std::env::var_os("VUA_PROVIDER_DATA")?;
    let (unity, data) = (PathBuf::from(unity), PathBuf::from(data));
    if !unity.is_absolute() || !data.is_absolute() {
        eprintln!(
            "VUA provider: VUA_UNITY_EDITOR/VUA_PROVIDER_DATA must be absolute paths; production stays unavailable"
        );
        return None;
    }
    let vpm = match vua_project_manager::VrcGetLibBackend::with_environment_root(data.join("vpm-env"), false) {
        Ok(vpm) => Arc::new(vpm) as Arc<dyn vua_orchestrator::VpmBackend>,
        Err(_) => {
            eprintln!("VUA provider: vrc-get backend init failed; production stays unavailable");
            return None;
        }
    };
    let executor = Arc::new(MaterialExecutor::new(
        Arc::new(vua_unity_bridge::UnityBatchBridge::new(unity)),
        vua_orchestrator::FileSystemSnapshotStore,
        vpm,
        BuildRecordStore::new(data.join("records")),
        Arc::new(vua_orchestrator::SystemClock),
        data.join("temp"),
        "2022.3.22f1",
        vua_unity_bridge::LocalPackageIdentityStore::new(data.join("identities.json")),
    ));
    Some(ProductionConfig {
        executor,
        records: Arc::new(BuildRecordStore::new(data.join("records"))),
    })
}

fn production_task_id(command_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(command_id.as_bytes());
    let digest = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    format!("prod-{}", &digest[..12])
}

/// Applies a mutation at the task's CURRENT revision (workers and the host
/// loop share the store; revisions race through cancellation).
fn advance_production_task(
    store: &SqliteTaskStore,
    task_id: &str,
    mutation: TaskMutation,
) -> Result<Option<StoredTaskEvent>, SqliteStoreError> {
    let revision = store
        .task(task_id)?
        .ok_or_else(|| SqliteStoreError::UnknownTask(task_id.to_owned()))?
        .revision;
    store.mutate_task(task_id, revision, &now_rfc3339(), mutation)
}

fn param_str<'a>(request: &'a Value, pointer: &str) -> &'a str {
    request
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn production_request(
    state: &mut HostState,
    method: &str,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
) -> FrameOutcome {
    let Some(services) = state.production.clone() else {
        return FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.production.unavailable",
            "errors.production.unavailable",
            "unavailable",
        ));
    };
    let command_id = request.get("commandId").and_then(Value::as_str).unwrap_or("");
    let outcome: Result<FrameOutcome, ProductionError> = match method {
        "production.startInspection" => {
            start_inspection(state, &services, request, request_id, correlation_id, command_id)
        }
        "production.getInspection" => get_domain_document(
            state,
            request,
            request_id,
            "inspection",
            "inspectionId",
        ),
        "production.requestPlan" => {
            request_plan(state, &services, request, request_id, correlation_id, command_id)
        }
        "production.getPlan" => get_domain_document(
            state,
            request,
            request_id,
            "plan",
            "planId",
        ),
        "production.confirmPlan" => {
            confirm_plan(state, &services, request, request_id, correlation_id, command_id, false)
        }
        "production.recover" => {
            confirm_plan(state, &services, request, request_id, correlation_id, command_id, true)
        }
        "production.getBuildRecord" => get_build_record(state, request, request_id),
        _ => Ok(FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            "vua.provider.unknown_method",
            "errors.provider.unknownMethod",
            "validation",
        ))),
    };
    match outcome {
        Ok(outcome) => outcome,
        Err(error) => FrameOutcome::Response(application_error(
            request_id,
            correlation_id,
            error.code,
            error.message_key,
            error.category,
        )),
    }
}

struct ProductionError {
    code: &'static str,
    message_key: &'static str,
    category: &'static str,
}

impl From<SqliteStoreError> for ProductionError {
    fn from(error: SqliteStoreError) -> Self {
        Self {
            code: store_error_code(&error),
            message_key: "errors.provider.persistence",
            category: store_error_category(&error),
        }
    }
}

fn not_recoverable_error() -> ProductionError {
    validation_error(
        "vua.production.not_recoverable",
        "errors.production.notRecoverable",
    )
}

fn validation_error(code: &'static str, message_key: &'static str) -> ProductionError {
    ProductionError { code, message_key, category: "validation" }
}

/// Accepts a production task idempotently and drives the staged
/// Queued → Preparing → Running transitions shared by every command.
fn accept_production_task(
    state: &HostState,
    command_kind: &str,
    command_id: &str,
    fingerprint_input: &Value,
    request_id: &str,
    correlation_id: &str,
) -> Result<(String, Option<FrameOutcome>), ProductionError> {
    if command_id.is_empty() {
        return Err(validation_error(
            "vua.production.invalid_command",
            "errors.production.invalidCommand",
        ));
    }
    let task_id = production_task_id(command_id);
    let new_task = NewTask {
        task_id: task_id.clone(),
        correlation_id: correlation_id.to_owned(),
        occurred_at: now_rfc3339(),
    };
    let acceptance = state.store.accept_idempotent_task(
        command_kind,
        command_id,
        &request_fingerprint(fingerprint_input),
        &new_task,
        &json!({"kind": command_kind}),
    )?;
    match acceptance {
        // A replayed commandId answers with the task's CURRENT snapshot, so
        // re-polling a command never shows a stale acceptance-time stub.
        IdempotentTaskAcceptance::Replayed { .. } => {
            let task = state
                .store
                .task(&task_id)?
                .ok_or_else(|| SqliteStoreError::UnknownTask(task_id.clone()))?;
            Ok((
                task_id,
                Some(FrameOutcome::Response(application_success(
                    request_id,
                    json!({
                        "contractVersion": APPLICATION_CONTRACT_VERSION,
                        "task": task_snapshot(state, &task),
                    }),
                ))),
            ))
        }
        IdempotentTaskAcceptance::Accepted { .. } => {
            advance_production_task(
                &state.store,
                &task_id,
                TaskMutation::Transition { state: TaskState::Preparing, payload: json!({}) },
            )?;
            advance_production_task(
                &state.store,
                &task_id,
                TaskMutation::Transition { state: TaskState::Running, payload: json!({}) },
            )?;
            Ok((task_id, None))
        }
    }
}

fn start_inspection(
    state: &HostState,
    services: &Arc<ProductionServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
    command_id: &str,
) -> Result<FrameOutcome, ProductionError> {
    // v0.2: Kernel hands over the four-tuple ONCE — source and project paths
    // are bound here and never re-submitted by the renderer (M3/T1 ruling).
    let source_folder = param_str(request, "/params/sourceFolder").to_owned();
    let project_root = param_str(request, "/params/projectRoot").to_owned();
    let artifact_output_root = param_str(request, "/params/artifactOutputRoot").to_owned();
    let project_id = param_str(request, "/params/projectId").to_owned();
    if source_folder.is_empty()
        || project_root.is_empty()
        || artifact_output_root.is_empty()
        || project_id.is_empty()
    {
        return Err(validation_error(
            "vua.production.invalid_params",
            "errors.production.invalidParams",
        ));
    }
    let (task_id, replayed) = accept_production_task(
        state,
        "production.startInspection",
        command_id,
        &json!({
            "kind": "production.startInspection", "commandId": command_id,
            "sourceFolder": source_folder, "projectRoot": project_root,
            "artifactOutputRoot": artifact_output_root, "projectId": project_id
        }),
        request_id,
        correlation_id,
    )?;
    if let Some(outcome) = replayed {
        return Ok(outcome);
    }

    let inspection = services
        .engine
        .inspect_folder(Path::new(&source_folder), correlation_id)
        .map_err(|error| persist_task_error(&state.store, &task_id, error))?;
    let result = serde_json::to_value(&inspection)
        .map_err(|_| SqliteStoreError::CorruptValue { field: "inspection", value: "json".into() })?;

    // Issue the stable domain identity and bind the one-time Kernel handover.
    let inspection_id = issue_domain_id("insp");
    let binding = json!({
        "sourceFolder": source_folder,
        "projectRoot": project_root,
        "artifactOutputRoot": artifact_output_root,
        "projectId": project_id,
        "createdAt": now_rfc3339(),
    });
    state.store.put_domain_record(
        &inspection_id,
        "inspection",
        &task_id,
        &result.to_string(),
        &binding.to_string(),
        &now_rfc3339(),
    )?;

    advance_production_task(
        &state.store,
        &task_id,
        TaskMutation::Complete {
            state: TaskState::Succeeded,
            error: None,
            result: Some(json!({ "inspectionId": inspection_id })),
        },
    )?;
    Ok(FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "task": task_snapshot(state, &state.store.task(&task_id)?.expect("task exists")),
            "inspectionId": inspection_id,
        }),
    )))
}

fn request_plan(
    state: &HostState,
    services: &Arc<ProductionServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
    command_id: &str,
) -> Result<FrameOutcome, ProductionError> {
    // v0.2: {inspectionId, mode} — the project identity and every path come
    // from the inspection binding (mode is the only genuine user decision).
    let inspection_id = param_str(request, "/params/inspectionId").to_owned();
    let mode_raw = param_str(request, "/params/mode").to_owned();
    if inspection_id.is_empty() || mode_raw.is_empty() {
        return Err(validation_error(
            "vua.production.invalid_params",
            "errors.production.invalidParams",
        ));
    }
    let mode: MaterialEntryMode = serde_json::from_value(Value::String(mode_raw.clone()))
        .map_err(|_| {
            validation_error(
                "vua.production.invalid_params",
                "errors.production.invalidParams",
            )
        })?;

    let (_record_kind, _inspection_task_id, inspection_value, inspection_binding) =
        domain_record_checked(state, &inspection_id, "inspection")?;
    let source_folder = string_field(&inspection_binding, "sourceFolder");
    let project_root = string_field(&inspection_binding, "projectRoot");
    let project_id = string_field(&inspection_binding, "projectId");
    if source_folder.is_empty() || project_root.is_empty() || project_id.is_empty() {
        return Err(validation_error(
            "vua.production.record_invalid",
            "errors.production.recordInvalid",
        ));
    }
    // The fingerprint is computed at plan time from the bound project root —
    // drift between inspection and plan is therefore still detected.
    let project_fingerprint = vua_orchestrator::project_tree_fingerprint(
        Path::new(&project_root),
        &["Assets", "Packages", "ProjectSettings"],
    )
    .map_err(|error| {
        SqliteStoreError::CorruptValue { field: "project fingerprint", value: error.to_string() }
    })?
    .unwrap_or_default();

    let inspection: SourceFolderInspectionV01 = serde_json::from_value(inspection_value.clone())
        .map_err(|_| {
            validation_error(
                "vua.production.inspection_mismatch",
                "errors.production.inspectionMismatch",
            )
        })?;

    let (task_id, replayed) = accept_production_task(
        state,
        "production.requestPlan",
        command_id,
        &json!({
            "commandId": command_id,
            "inspectionId": inspection_id,
            "mode": mode_raw,
        }),
        request_id,
        correlation_id,
    )?;
    if let Some(outcome) = replayed {
        return Ok(outcome);
    }

    let plan = services
        .engine
        // The bound project root drives the CONDITIONAL provision step
        // (plan v0.2, W25 real-machine finding): an unprovisioned target
        // plans the explicit user-confirmed project-creation step — same
        // honest model as the assembly plan.
        .plan(
            mode,
            project_id,
            project_fingerprint,
            inspection,
            Path::new(&project_root),
            correlation_id,
        )
        .map_err(|error| persist_task_error(&state.store, &task_id, error))?;
    let result = serde_json::to_value(&plan)
        .map_err(|_| SqliteStoreError::CorruptValue { field: "plan", value: "json".into() })?;
    advance_production_task(
        &state.store,
        &task_id,
        TaskMutation::Complete { state: TaskState::Succeeded, error: None, result: Some(result.clone()) },
    )?;

    // Issue the plan domain identity, bound to the inspection and the plan
    // task's post-completion revision (the value confirmPlan validates).
    let plan_id = issue_domain_id("plan");
    let plan_revision = state.store.task(&task_id)?.expect("plan task exists").revision;
    let binding = json!({
        "inspectionId": inspection_id,
        "revision": plan_revision,
    });
    state.store.put_domain_record(
        &plan_id,
        "plan",
        &task_id,
        &result.to_string(),
        &binding.to_string(),
        &now_rfc3339(),
    )?;
    // Alias under the ENGINE plan id: build-record receipts reference the
    // engine id, and the recovery chain resolves receipts through it back
    // to this same plan record.
    let mut alias_binding = binding.clone();
    alias_binding["domainPlanId"] = json!(plan_id);
    state.store.put_domain_record(
        &plan.plan_id,
        "plan",
        &task_id,
        &result.to_string(),
        &alias_binding.to_string(),
        &now_rfc3339(),
    )?;

    Ok(FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "task": task_snapshot(state, &state.store.task(&task_id)?.expect("task exists")),
            "planId": plan_id,
            "revision": plan_revision,
        }),
    )))
}

fn confirm_plan(
    state: &HostState,
    services: &Arc<ProductionServices>,
    request: &Value,
    request_id: &str,
    correlation_id: &str,
    command_id: &str,
    recovery: bool,
) -> Result<FrameOutcome, ProductionError> {
    // --- v0.2 sourcing: domain references + registry bindings (M3/T1) ---
    // Confirm face: {planId, observedRevision, riskChoice, rememberForSession?}
    // Recovery face: {taskId, decision, decisionId} — the registry chain
    // taskId -> receipt -> planId -> plan binding -> inspection binding
    // resolves every path; the renderer never re-submits one.
    let decision = if recovery {
        let decision = param_str(request, "/params/decision").to_owned();
        if !matches!(decision.as_str(), "continue" | "rollback") {
            return Err(validation_error(
                "vua.production.invalid_params",
                "errors.production.invalidParams",
            ));
        }
        decision
    } else {
        "execute".to_owned()
    };
    // decisionId is issued by the Kernel at acceptance, bound to
    // taskId + revision + decision, and persisted with the recovery run.
    let decision_id = param_str(request, "/params/decisionId").to_owned();
    if recovery && decision_id.trim().is_empty() {
        return Err(validation_error(
            "vua.production.decision_id_required",
            "errors.production.decisionIdRequired",
        ));
    }
    let observed_revision = request
        .pointer("/params/observedRevision")
        .and_then(Value::as_u64);

    let (plan_id, original_task_id, user_decision_id, risk_choice, remember_for_session) =
        if recovery {
            let original_task_id = param_str(request, "/params/taskId").to_owned();
            if original_task_id.is_empty() {
                return Err(validation_error(
                    "vua.production.invalid_params",
                    "errors.production.invalidParams",
                ));
            }
            // Recovery binds the ORIGINAL failed run: only a terminal failed
            // or cancelled production task is a recovery source. The receipt
            // is required — an original without one is not recoverable
            // through this path (the Inspect-first discipline governs the
            // next fresh run instead).
            let original = state
                .store
                .task(&original_task_id)?
                .ok_or_else(|| validation_error("vua.task.not_found", "errors.task.notFound"))?;
            if !matches!(original.state, TaskState::Failed | TaskState::Cancelled) {
                return Err(not_recoverable_error());
            }
            // Plan linkage: the receipt's engine plan id resolves through
            // the registry alias when a receipt exists; a `continue` without
            // a receipt (refused before any mutation) carries the planId the
            // renderer held from the plan response. A rollback without a
            // receipt is refused — no run means no snapshot.
            let record_id = original
                .result
                .as_ref()
                .and_then(|result| result.get("buildRecordId"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            let plan_link = match record_id {
                Some(record_id) => {
                    let record = services.records.read(&record_id).map_err(|_| {
                        validation_error(
                            "vua.production.not_recoverable",
                            "errors.production.notRecoverable",
                        )
                    })?;
                    record.plan_id
                }
                None if decision == "rollback" => return Err(not_recoverable_error()),
                None => param_str(request, "/params/planId").to_owned(),
            };
            if plan_link.is_empty() {
                return Err(not_recoverable_error());
            }
            (
                plan_link,
                original_task_id,
                decision_id.clone(),
                "not_required".to_owned(),
                false,
            )
        } else {
            let plan_id = param_str(request, "/params/planId").to_owned();
            if plan_id.is_empty() {
                return Err(validation_error(
                    "vua.production.invalid_params",
                    "errors.production.invalidParams",
                ));
            }
            let risk_choice = param_str(request, "/params/riskChoice").to_owned();
            if risk_choice.is_empty() {
                return Err(validation_error(
                    "vua.production.invalid_params",
                    "errors.production.invalidParams",
                ));
            }
            let remember_for_session = request
                .pointer("/params/rememberForSession")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            (plan_id, String::new(), String::new(), risk_choice, remember_for_session)
        };

    // Registry chain: plan record -> its plan task and its inspection
    // binding (paths + project identity were handed over once at
    // startInspection).
    let (plan_task_id, plan_binding) =
        match state.store.domain_record(&plan_id)? {
            Some((kind, task_id, _document, binding)) if kind == "plan" => {
                (task_id, binding)
            }
            _ => {
                return Err(validation_error(
                    "vua.production.record_not_found",
                    "errors.production.recordNotFound",
                ))
            }
        };
    let inspection_id = string_field(&plan_binding, "inspectionId");
    if recovery {
        // The plan revision binds the confirmation: a recovery started from
        // a plan whose revision drifted is refused.
        if let Some(expected) = observed_revision {
            let plan_revision = plan_binding["revision"].as_u64().unwrap_or(0);
            if plan_revision != expected {
                return Err(validation_error(
                    "vua.production.plan_mismatch",
                    "errors.production.planMismatch",
                ));
            }
        }
    } else {
        let plan_revision = plan_binding["revision"].as_u64().unwrap_or(0);
        if observed_revision != Some(plan_revision) {
            return Err(validation_error(
                "vua.production.plan_mismatch",
                "errors.production.planMismatch",
            ));
        }
    }
    let (_kind, _inspection_task_id, _inspection_document, inspection_binding) =
        domain_record_checked(state, &inspection_id, "inspection")?;
    let source_folder = string_field(&inspection_binding, "sourceFolder");
    let project_root = string_field(&inspection_binding, "projectRoot");
    let artifact_output_root = string_field(&inspection_binding, "artifactOutputRoot");
    let confirmed_at = String::new();
    // Inspect-first applies to the WHOLE recovery: every recovery run
    // captures a project inspection before its mutation, whatever the
    // original failure was. ("No receipt" alone would prove nothing — a
    // crash after Unity mutated but before the record was written also has
    // no receipt — so the inspection, not the receipt, governs here.)
    let require_project_inspection = recovery;

    // What the worker will do. Built BEFORE accepting so a malformed plan
    // or an unreadable receipt is a validation error, never a half-created
    // task.
    enum Run {
        Execute(Box<MaterialIntakeConfirmationV01>),
        Rollback {
            snapshot_id: String,
            original_record: Box<vua_orchestrator::BuildRecordV01>,
        },
    }
    let run = if decision == "rollback" {
        // The failed attempt's receipt names its recovery snapshot.
        let original = state
            .store
            .task(&original_task_id)?
            .ok_or_else(|| validation_error("vua.task.not_found", "errors.task.notFound"))?;
        let record_id = original
            .result
            .as_ref()
            .and_then(|result| result.get("buildRecordId"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                validation_error(
                    "vua.production.not_recoverable",
                    "errors.production.notRecoverable",
                )
            })?
            .to_owned();
        let record = services.records.read(&record_id).map_err(|_| {
            validation_error(
                "vua.production.not_recoverable",
                "errors.production.notRecoverable",
            )
        })?;
        // Three-way ownership binding, sides 1+2: the failed run's receipt
        // must name the very project the caller points at (side 3 — the
        // snapshot manifest — is enforced inside restore). Records written
        // before identity binding existed carry none and are not
        // recoverable through this path.
        let request_identity = ProjectIdentity::from_existing_path(&project_root)
            .map_err(|_| {
                validation_error(
                    "vua.project.identity_invalid",
                    "errors.project.identityInvalid",
                )
            })?;
        if record.project_identity.as_deref() != Some(request_identity.as_str()) {
            return Err(not_recoverable_error());
        }
        let snapshot_id = record
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.snapshot_id.clone())
            .ok_or_else(not_recoverable_error)?;
        // The record payload is deserialized data: an older record written
        // before validation existed at every write site, or a hand-edited
        // one, can carry an id that creation-time checks never saw. This id
        // is interpolated into the ownership probe, the SnapshotRef path and
        // the stale-quarantine rename below — all BEFORE restore_verified's
        // containment checks run — so the same grammar gate as snapshot
        // creation applies here, at the boundary where the id re-enters the
        // filesystem (wt-2 batch 178 reverse-audit, #43-family member).
        vua_orchestrator::FileSystemSnapshotStore::validate_snapshot_id(&snapshot_id)
            .map_err(|_| not_recoverable_error())?;
        // The requested project must actually own this snapshot: a
        // recovery can never restore a snapshot directory from ANOTHER
        // project root the caller supplies.
        if !PathBuf::from(&project_root)
            .join(".vua/snapshots")
            .join(&snapshot_id)
            .is_dir()
        {
            return Err(not_recoverable_error());
        }
        Run::Rollback { snapshot_id, original_record: Box::new(record) }
    } else {
        let plan_task = state
            .store
            .task(&plan_task_id)?
            .ok_or_else(|| validation_error("vua.task.not_found", "errors.task.notFound"))?;
        let plan: MaterialIntakePlanV01 =
            serde_json::from_value(plan_task.result.clone().unwrap_or(Value::Null)).map_err(
                |_| {
                    validation_error(
                        "vua.production.plan_mismatch",
                        "errors.production.planMismatch",
                    )
                },
            )?;
        let choice: RiskDecisionChoice = serde_json::from_value(Value::String(risk_choice.clone()))
            .map_err(|_| {
                validation_error(
                    "vua.production.invalid_params",
                    "errors.production.invalidParams",
                )
            })?;
        Run::Execute(Box::new(MaterialIntakeConfirmationV01 {
            plan: plan.clone(),
            risk_decision: RiskDecisionV01 {
                choice,
                source_fingerprint: plan.source.source_fingerprint.clone(),
                risk_fingerprint: plan.source.risk_fingerprint.clone(),
                remember_for_session,
            },
            confirmed_at: if confirmed_at.is_empty() { now_rfc3339() } else { confirmed_at.clone() },
            correlation_id: correlation_id.to_owned(),
        }))
    };

    // A recovery `continue` binds the ORIGINAL failed run: its receipt
    // must belong to the same plan and the same project as this
    // request, otherwise the two are unrelated and not recoverable.
    if recovery && decision == "continue" {
        let original = state
            .store
            .task(&original_task_id)?
            .ok_or_else(not_recoverable_error)?;
        let original_record_id = original
            .result
            .as_ref()
            .and_then(|result| result.get("buildRecordId"))
            .and_then(Value::as_str);
        let plan_for_binding = match &run {
            Run::Execute(confirmation) => &confirmation.plan,
            Run::Rollback { .. } => unreachable!(),
        };
        if let Some(original_record_id) = original_record_id {
            let original_record = services
                .records
                .read(original_record_id)
                .map_err(|_| not_recoverable_error())?;
            if original_record.plan_id != plan_for_binding.plan_id
                || original_record.project_id != plan_for_binding.project_id
            {
                return Err(not_recoverable_error());
            }
        }
        // An original WITHOUT a receipt was refused before any mutation
        // (e.g. at the mutation gate): nothing to bind, recovery proceeds
        // fresh.
    }

    // The idempotency fingerprint binds the FULL parameter set: the same
    // commandId with a different plan, source, project, risk decision or
    // recovery decision is a conflict (vua.command.id_conflict), never a
    // silent replay.
    let fingerprint_input = json!({
        "commandId": command_id,
        "planId": plan_id,
        "planTaskId": plan_task_id,
        "observedRevision": observed_revision,
        "riskChoice": risk_choice,
        "rememberForSession": remember_for_session,
        "originalTaskId": original_task_id,
        "decision": decision,
        "decisionId": decision_id,
    });
    let (task_id, replayed) = accept_production_task(
        state,
        if recovery { "production.recover" } else { "production.confirmPlan" },
        command_id,
        &fingerprint_input,
        request_id,
        correlation_id,
    )?;
    if let Some(outcome) = replayed {
        return Ok(outcome);
    }

    let token = MaterialCancelToken::new();
    services
        .running
        .lock()
        .expect("running poisoned")
        .insert(task_id.clone(), token.clone());

    let store = Arc::clone(&state.store);
    let executor = Arc::clone(&services.executor);
    let services_for_worker = Arc::clone(services);
    let owner_instance_id = state.provider_instance_id.clone();
    let worker_task_id = task_id.clone();
    let worker_correlation = correlation_id.to_owned();
    // userDecisionId stays an AUTHORIZATION record (task result + recovery
    // receipt); the lease takeover credential is a PROJECT INSPECTION.
    let recovery_decision_id = user_decision_id.clone();
    let recovery_started_at = now_rfc3339();
    let inspect: Option<ProjectInspectFn> = if recovery {
        let executor_for_inspect = Arc::clone(&executor);
        let correlation_for_inspect = worker_correlation.clone();
        Some(Arc::new(move |project: &ProjectRef| {
            executor_for_inspect.inspect_project(project, &correlation_for_inspect)
        }))
    } else {
        None
    };
    std::thread::spawn(move || {
        let project_id = match &run {
            Run::Execute(confirmation) => confirmation.plan.project_id.clone(),
            Run::Rollback { original_record, .. } => original_record.project_id.clone(),
        };
        let project =
            ProjectRef { id: project_id, root: PathBuf::from(&project_root) };

        // The mutation gate: SQLite lease → cross-profile project lock →
        // pending-mutation marker, held for the whole mutating run. A crash
        // leaves the marker behind (inspect-first evidence) and the OS lock
        // releases itself; prepare_shutdown sees the lease as blocking.
        let (gate, inspection_evidence) = match MutationGate::acquire(
            &store,
            &project_root,
            &owner_instance_id,
            &worker_task_id,
            &worker_correlation,
            inspect.as_ref(),
            require_project_inspection,
        ) {
            Ok(gate) => gate,
            Err(error) => {
                if let Ok(Some(event)) = advance_production_task(
                    &store,
                    &worker_task_id,
                    TaskMutation::Complete {
                        state: TaskState::Failed,
                        error: Some(error),
                        result: None,
                    },
                ) {
                    services_for_worker
                        .completed_events
                        .lock()
                        .expect("completed events poisoned")
                        .push(event);
                }
                services_for_worker
                    .running
                    .lock()
                    .expect("running poisoned")
                    .remove(&worker_task_id);
                return;
            }
        };

        let (state_final, error, result_value) = match &run {
            Run::Execute(confirmation) => {
                let report = executor.execute(
                    confirmation,
                    Path::new(&source_folder),
                    &project,
                    Path::new(&artifact_output_root),
                    &token,
                );
                let result = MaterialTaskResult {
                    plan_id: report.plan_id.clone(),
                    status: match report.status {
                        MaterialExecutionStatus::Succeeded => "succeeded".to_owned(),
                        MaterialExecutionStatus::Cancelled => "cancelled".to_owned(),
                        MaterialExecutionStatus::Failed => "failed".to_owned(),
                    },
                    error_code: report.error_code.clone(),
                    rollback: match report.rollback {
                        RollbackOutcome::NotNeeded => "not_needed".to_owned(),
                        RollbackOutcome::Restored => "restored".to_owned(),
                        RollbackOutcome::Failed => "failed".to_owned(),
                    },
                    build_record_id: report.build_record_id.clone(),
                    replayed: report.replayed,
                };
                let result_value = serde_json::to_value(&result).ok();
                match report.status {
                    MaterialExecutionStatus::Succeeded => {
                        (TaskState::Succeeded, None, result_value)
                    }
                    MaterialExecutionStatus::Cancelled => {
                        (TaskState::Cancelled, None, result_value)
                    }
                    MaterialExecutionStatus::Failed => (
                        TaskState::Failed,
                        Some(
                            AppErrorV1::new(
                                report
                                    .error_code
                                    .clone()
                                    .unwrap_or_else(|| "vua.material.failed".to_owned()),
                                ErrorCategory::ExternalFailure,
                                // 第 150 批：与 material_task 同一律——供给段
                                // 失败命中预留 provisionFailed，其余维持
                                // executionFailed（分类助手单一来源）。
                                vua_unity_bridge::material_exec::failure_message_key(
                                    report.error_code.as_deref(),
                                ),
                                &confirmation.correlation_id,
                            )
                            .with_param(
                                "planId",
                                vua_orchestrator::ParamValue::Text(report.plan_id.clone()),
                            )
                            .with_recoverable(true),
                        ),
                        result_value,
                    ),
                }
            }
            Run::Rollback { snapshot_id, original_record } => {
                let reference = vua_orchestrator::SnapshotRef {
                    id: snapshot_id.clone(),
                    path: project.root.join(".vua/snapshots").join(snapshot_id),
                };
                // The failed attempt's restore left a quarantine for this
                // same snapshot. The user's explicit rollback supersedes
                // it, but the quarantine holds the pre-restore project
                // state — it is VERSIONED aside, never deleted before the
                // new restore has succeeded.
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis())
                    .unwrap_or(0);
                let stale_quarantine =
                    project.root.join(".vua/recovery").join(snapshot_id);
                if stale_quarantine.exists() {
                    let archived = project
                        .root
                        .join(".vua/recovery")
                        .join(format!("{snapshot_id}.superseded-{stamp}"));
                    let _ = std::fs::rename(&stale_quarantine, &archived);
                }
                match vua_orchestrator::FileSystemSnapshotStore.restore_verified(&project, &reference) {
                    Ok(()) => {
                        // The recovery itself gets an immutable receipt
                        // with status `recovered`, bound to THIS recovery
                        // task and decision, referencing the failed run's
                        // record it supersedes.
                        let recovered_id = format!(
                            "{}-recover-{stamp}",
                            original_record.record_id
                        );
                        let mut recovered = original_record.clone();
                        recovered.record_id = recovered_id.clone();
                        recovered.status = vua_orchestrator::BuildRecordStatus::Recovered;
                        recovered.task_id = worker_task_id.clone();
                        recovered.correlation_id = worker_correlation.clone();
                        recovered.started_at = recovery_started_at.clone();
                        recovered.completed_at = now_rfc3339();
                        recovered.recovered_from_record_id =
                            Some(original_record.record_id.clone());
                        recovered.recovery_decision_id =
                            Some(recovery_decision_id.clone());
                        recovered.snapshot = Some(vua_orchestrator::BuildSnapshotEvidenceV01 {
                            snapshot_id: snapshot_id.clone(),
                            verified: true,
                            restore_attempted: true,
                            restore_succeeded: Some(true),
                        });
                        recovered.bridge_jobs = Vec::new();
                        recovered.validation = None;
                        recovered.local_vpm = None;
                        recovered.result_code = "vua.material.recovered".to_owned();
                        // The project restore HAS happened; a receipt
                        // publish failure is nevertheless a typed failure
                        // (authoritative receipts are not optional) whose
                        // retry is safe: the restore repeats and the record
                        // is written under the same id.
                        match services_for_worker.records.publish(&recovered) {
                            Ok(_) => (
                                TaskState::Succeeded,
                                None,
                                Some(json!({
                                    "recovered": "rollback",
                                    "restored": true,
                                    "snapshotId": snapshot_id,
                                    "buildRecordId": recovered_id,
                                    "recoveryDecisionId": recovery_decision_id,
                                })),
                            ),
                            Err(publish_error) => (
                                TaskState::Failed,
                                Some(
                                    AppErrorV1::new(
                                        "vua.material.record_failed",
                                        ErrorCategory::ExternalFailure,
                                        "errors.material.recordFailed",
                                        &worker_correlation,
                                    )
                                    .with_recoverable(true),
                                ),
                                Some(json!({
                                    "recovered": "rollback",
                                    "restored": true,
                                    "recordPersisted": false,
                                    "detail": publish_error.to_string(),
                                })),
                            ),
                        }
                    }
                    Err(restore_error) => (
                        TaskState::Failed,
                        Some(
                            AppErrorV1::new(
                                "vua.material.rollback_failed",
                                ErrorCategory::ExternalFailure,
                                "errors.material.executionFailed",
                                &worker_correlation,
                            )
                            .with_recoverable(true),
                        ),
                        Some(json!({
                            "recovered": "rollback",
                            "restored": false,
                            "detail": restore_error.to_string(),
                        })),
                    ),
                }
            }
        };

        // The captured project inspection rides along in the task result:
        // it ties the recovery to an observed project state, not just to a
        // user decision.
        let result_value = result_value.map(|mut value| {
            if let Some(inspection) = inspection_evidence.as_ref() {
                if let Some(object) = value.as_object_mut() {
                    if let Ok(evidence) = serde_json::to_value(inspection) {
                        object.insert("projectInspection".into(), evidence);
                    }
                }
            }
            value
        });

        // Persist the authoritative terminal state BEFORE releasing the
        // gate: between the two, a safe_to_stop verdict could otherwise
        // miss both the lease and the unfinished task.
        if let Ok(Some(event)) = advance_production_task(
            &store,
            &worker_task_id,
            TaskMutation::Complete { state: state_final, error, result: result_value },
        ) {
            services_for_worker
                .completed_events
                .lock()
                .expect("completed events poisoned")
                .push(event);
        }
        gate.release();
        services_for_worker
            .running
            .lock()
            .expect("running poisoned")
            .remove(&worker_task_id);
    });

    Ok(FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "task": task_snapshot(state, &state.store.task(&task_id)?.expect("task exists")),
        }),
    )))
}

/// The read-only project inspection closure a recovery run carries: it
/// produces the fingerprint the takeover credential binds.
type ProjectInspectFn =
    Arc<dyn Fn(&ProjectRef) -> Result<String, vua_orchestrator::AppErrorV1> + Send + Sync>;

/// A captured project inspection: the credential that authorizes a lease
/// takeover and the supersession of crash evidence. `inspection_id` binds
/// the normalized project identity, the observed fingerprint and the lease
/// generation at inspection time.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInspectionEvidence {
    pub inspection_id: String,
    pub project_fingerprint: String,
    pub observed_at: String,
    pub lease_generation: u64,
}

/// Builds the project ref an inspection command addresses. The id is a
/// task-scoped label — the binding power lives in the identity digest,
/// not in this label.
fn rootless_project_ref(project_root: &str, task_id: &str) -> ProjectRef {
    ProjectRef {
        id: format!("{task_id}-project-inspect"),
        root: PathBuf::from(project_root),
    }
}

/// Runs the read-only project inspection through the recover closure and
/// derives the inspection id from identity + fingerprint + generation.
fn run_project_inspection(
    inspect: Option<&ProjectInspectFn>,
    identity: &ProjectIdentity,
    project: &ProjectRef,
    lease_generation: u64,
    correlation_id: &str,
) -> Result<ProjectInspectionEvidence, AppErrorV1> {
    let inspect = inspect.ok_or_else(|| {
        AppErrorV1::new(
            "vua.project.inspect_required",
            ErrorCategory::Conflict,
            "errors.project.inspectRequired",
            correlation_id,
        )
        .with_recoverable(true)
    })?;
    let project_fingerprint = inspect(project).map_err(|error| {
        AppErrorV1::new(
            "vua.project.inspect_failed",
            ErrorCategory::ExternalFailure,
            "errors.project.inspectFailed",
            correlation_id,
        )
        .with_recoverable(true)
        .with_param("detail", vua_orchestrator::ParamValue::Text(format!("{error:?}")))
    })?;
    let observed_at = now_rfc3339();
    let mut hasher = Sha256::new();
    hasher.update(identity.as_str().as_bytes());
    hasher.update(project_fingerprint.as_bytes());
    hasher.update(lease_generation.to_le_bytes());
    hasher.update(observed_at.as_bytes());
    let digest = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    Ok(ProjectInspectionEvidence {
        inspection_id: format!("pins-{}", &digest[..16]),
        project_fingerprint,
        observed_at,
        lease_generation,
    })
}

/// The full cross-profile mutation gate, acquired in order (SQLite lease →
/// project lock → pending-mutation marker) and released in reverse. Any
/// acquisition failure fails the task with a typed error — never a silent
/// mutate-without-lock.
struct MutationGate {
    store: Arc<SqliteTaskStore>,
    identity: ProjectIdentity,
    owner_instance_id: String,
    generation: u64,
    marker: Option<MutationMarkerGuard>,
    lock: Option<ProjectLockGuard>,
}

impl MutationGate {
    fn acquire(
        store: &Arc<SqliteTaskStore>,
        project_root: &str,
        owner_instance_id: &str,
        task_id: &str,
        correlation_id: &str,
        inspect: Option<&ProjectInspectFn>,
        require_project_inspection: bool,
    ) -> Result<(Self, Option<ProjectInspectionEvidence>), AppErrorV1> {
        let identity = ProjectIdentity::from_existing_path(project_root).map_err(|error| {
            AppErrorV1::new(
                "vua.project.identity_invalid",
                ErrorCategory::Validation,
                "errors.project.identityInvalid",
                correlation_id,
            )
            .with_recoverable(false)
            .with_param("detail", vua_orchestrator::ParamValue::Text(error.to_string()))
        })?;

        let mut inspection_evidence: Option<ProjectInspectionEvidence> = None;
        let lease =
            match store.acquire_project_lease(
                &identity,
                owner_instance_id,
                task_id,
                &now_rfc3339(),
            ) {
                Ok(lease) => {
                if require_project_inspection {
                    let inspection = run_project_inspection(
                        inspect,
                        &identity,
                        &rootless_project_ref(project_root, task_id),
                        lease.generation,
                        correlation_id,
                    )?;
                    inspection_evidence = Some(inspection);
                }
                lease
            }
                Err(SqliteStoreError::LeaseHeld { .. }) => {
                    let existing = store
                        .project_lease(&identity)
                        .map_err(|error| {
                            AppErrorV1::new(
                                "vua.project.lease_unavailable",
                                ErrorCategory::Unavailable,
                                "errors.project.leaseUnavailable",
                                correlation_id,
                            )
                            .with_recoverable(true)
                            .with_param(
                                "detail",
                                vua_orchestrator::ParamValue::Text(error.to_string()),
                            )
                        })?
                        .ok_or_else(|| {
                            AppErrorV1::new(
                                "vua.project.lease_unavailable",
                                ErrorCategory::Unavailable,
                                "errors.project.leaseUnavailable",
                                correlation_id,
                            )
                            .with_recoverable(true)
                        })?;
                    if !existing.recovery_required {
                        // A live owner holds the lease: refuse, never steal.
                        return Err(AppErrorV1::new(
                            "vua.project.lease_unavailable",
                            ErrorCategory::Unavailable,
                            "errors.project.leaseUnavailable",
                            correlation_id,
                        )
                        .with_recoverable(true)
                        .with_param(
                            "holder",
                            vua_orchestrator::ParamValue::Text(
                                existing.owner_instance_id.clone(),
                            ),
                        ));
                    }
                    // A stale lease from an interrupted owner recovers ONLY
                    // through a PROJECT INSPECTION: the read-only Bridge
                    // inspection produces the credential (identity +
                    // fingerprint + lease generation) that the takeover
                    // binds. A user decision alone never supersedes it.
                    let inspection = run_project_inspection(
                        inspect,
                        &identity,
                        &rootless_project_ref(project_root, task_id),
                        existing.generation,
                        correlation_id,
                    )?;
                    let inspection_id = inspection.inspection_id.clone();
                    inspection_evidence = Some(inspection);
                    store
                        .takeover_project_lease_after_inspect(
                            &identity,
                            existing.generation,
                            owner_instance_id,
                            task_id,
                            inspection_id.as_str(),
                            &now_rfc3339(),
                        )
                        .map_err(|error| {
                            AppErrorV1::new(
                                "vua.project.lease_unavailable",
                                ErrorCategory::Unavailable,
                                "errors.project.leaseUnavailable",
                                correlation_id,
                            )
                            .with_recoverable(true)
                            .with_param(
                                "detail",
                                vua_orchestrator::ParamValue::Text(error.to_string()),
                            )
                        })?
                }
                Err(error) => {
                    return Err(AppErrorV1::new(
                        "vua.project.lease_unavailable",
                        ErrorCategory::Unavailable,
                        "errors.project.leaseUnavailable",
                        correlation_id,
                    )
                    .with_recoverable(true)
                    .with_param(
                        "detail",
                        vua_orchestrator::ParamValue::Text(error.to_string()),
                    ))
                }
            };

        let holder = LockHolder {
            channel: "provider".to_owned(),
            profile: "default".to_owned(),
            pid: std::process::id(),
            instance_id: owner_instance_id.to_owned(),
            acquired_at: now_rfc3339(),
        };
        let root = PathBuf::from(project_root);
        let lock = match acquire_project_lock(&root, holder.clone()) {
            Ok(lock) => Some(lock),
            Err(ProjectLockError::Held { previous }) => {
                let _ = store.release_project_lease(
                    &identity,
                    owner_instance_id,
                    lease.generation,
                );
                return Err(AppErrorV1::new(
                    "vua.project.lock_held",
                    ErrorCategory::Conflict,
                    "errors.project.lockHeld",
                    correlation_id,
                )
                .with_recoverable(true)
                .with_param(
                    "holder",
                    vua_orchestrator::ParamValue::Text(
                        previous
                            .map(|holder| holder.instance_id)
                            .unwrap_or_else(|| "unknown".to_owned()),
                    ),
                ));
            }
            Err(ProjectLockError::Io(lock_error)) => {
                let _ = store.release_project_lease(
                    &identity,
                    owner_instance_id,
                    lease.generation,
                );
                return Err(AppErrorV1::new(
                    "vua.project.lock_failed",
                    ErrorCategory::ExternalFailure,
                    "errors.project.lockFailed",
                    correlation_id,
                )
                .with_recoverable(true)
                .with_param(
                    "detail",
                    vua_orchestrator::ParamValue::Text(lock_error.to_string()),
                ));
            }
        };

        // Inspect-first discipline (ADR decision 7): a leftover marker
        // from any profile is never silently overwritten. Plain confirms
        // are refused until a recovery decision supersedes it — and that
        // path ARCHIVES the old marker instead of destroying it.
        match read_pending_mutation(&root) {
            PendingMutation::None => {}
            finding @ (PendingMutation::Leftover(_) | PendingMutation::Unreadable) => {
                // Superseding requires a CAPTURED project inspection — a
                // user decision alone never archives crash evidence.
                if inspection_evidence.is_none() {
                    drop(lock);
                    let _ = store.release_project_lease(
                        &identity,
                        owner_instance_id,
                        lease.generation,
                    );
                    return Err(AppErrorV1::new(
                        "vua.project.inspect_required",
                        ErrorCategory::Conflict,
                        "errors.project.inspectRequired",
                        correlation_id,
                    )
                    .with_recoverable(true)
                    .with_param(
                        "finding",
                        vua_orchestrator::ParamValue::Text(match finding {
                            PendingMutation::Leftover(marker) => marker.mutation_kind,
                            _ => "unreadable".to_owned(),
                        }),
                    ));
                }
                let stamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis())
                    .unwrap_or(0);
                let _ = std::fs::rename(
                    root.join(".vua").join(MARKER_FILE_NAME),
                    root.join(".vua").join(format!("{MARKER_FILE_NAME}.superseded-{stamp}")),
                );
            }
        }

        let marker = match begin_mutation(&root, "material_intake", &holder) {
            Ok(marker) => Some(marker),
            Err(marker_error) => {
                drop(lock);
                let _ = store.release_project_lease(
                    &identity,
                    owner_instance_id,
                    lease.generation,
                );
                return Err(AppErrorV1::new(
                    "vua.project.marker_failed",
                    ErrorCategory::ExternalFailure,
                    "errors.project.markerFailed",
                    correlation_id,
                )
                .with_recoverable(true)
                .with_param(
                    "detail",
                    vua_orchestrator::ParamValue::Text(marker_error.to_string()),
                ));
            }
        };

        Ok((
            Self {
                store: Arc::clone(store),
                identity,
                owner_instance_id: owner_instance_id.to_owned(),
                generation: lease.generation,
                marker,
                lock,
            },
            inspection_evidence,
        ))
    }

    /// Releases in reverse order: marker → lock → SQLite lease.
    fn release(self) {
        if let Some(marker) = self.marker {
            let _ = marker.release();
        }
        if let Some(lock) = self.lock {
            let _ = lock.release();
        }
        let _ = self.store.release_project_lease(
            &self.identity,
            &self.owner_instance_id,
            self.generation,
        );
    }
}

fn get_domain_document(
    state: &HostState,
    request: &Value,
    request_id: &str,
    kind: &str,
    param_name: &str,
) -> Result<FrameOutcome, ProductionError> {
    let domain_id = param_str(request, &format!("/params/{param_name}")).to_owned();
    if domain_id.is_empty() {
        return Err(validation_error(
            "vua.production.invalid_params",
            "errors.production.invalidParams",
        ));
    }
    let (record_kind, task_id, document, binding) =
        domain_record_checked(state, &domain_id, kind)?;
    let _ = record_kind;
    let task = state.store.task(&task_id)?;
    let document_value = if kind == "inspection" {
        let inspection: SourceFolderInspectionV01 = serde_json::from_value(document)
            .map_err(|_| {
                validation_error(
                    "vua.production.record_invalid",
                    "errors.production.recordInvalid",
                )
            })?;
        let inspected_at = string_field(&binding, "createdAt");
        serde_json::to_value(vua_unity_bridge::build_inspection_document(
            &domain_id,
            &inspected_at,
            &inspection,
        ))
        .map_err(|_| {
            validation_error(
                "vua.production.record_invalid",
                "errors.production.recordInvalid",
            )
        })?
    } else {
        let inspection_id = string_field(&binding, "inspectionId");
        let revision = binding["revision"].as_u64().unwrap_or(0);
        let plan: MaterialIntakePlanV01 = serde_json::from_value(document).map_err(|_| {
            validation_error(
                "vua.production.record_invalid",
                "errors.production.recordInvalid",
            )
        })?;
        let mut plan_document =
            vua_unity_bridge::build_plan_document(&inspection_id, revision, &plan);
        // The plan document's identity is the DOMAIN planId (the registry
        // id); the engine's internal plan id stays at the diagnostics
        // boundary.
        plan_document.plan_id = domain_id.clone();
        serde_json::to_value(&plan_document)
        .map_err(|_| {
            validation_error(
                "vua.production.record_invalid",
                "errors.production.recordInvalid",
            )
        })?
    };
    let mut payload = json!({
        "contractVersion": APPLICATION_CONTRACT_VERSION,
        "taskId": task_id,
        "state": task.map(|task| state_name(task.state)).unwrap_or("unknown"),
    });
    // The document rides under the record kind ("inspection" / "plan") —
    // inserted as a dynamic key, not a literal.
    payload
        .as_object_mut()
        .expect("payload object")
        .insert(kind.to_owned(), document_value);
    Ok(FrameOutcome::Response(application_success(
        request_id,
        payload,
    )))
}

/// Registry lookup that also enforces the expected record kind.
fn domain_record_checked(
    state: &HostState,
    domain_id: &str,
    expected_kind: &str,
) -> Result<(String, String, Value, Value), ProductionError> {
    match state.store.domain_record(domain_id)? {
        Some((kind, task_id, document, binding)) if kind == expected_kind => {
            Ok((kind, task_id, document, binding))
        }
        _ => Err(validation_error(
            "vua.production.record_not_found",
            "errors.production.recordNotFound",
        )),
    }
}

fn string_field(binding: &Value, key: &str) -> String {
    binding
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

/// Stable domain identities: a kind prefix plus nanos — unique per provider
/// process, stable across retries and recoveries.
fn issue_domain_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos:016x}")
}

fn get_build_record(
    state: &HostState,
    request: &Value,
    request_id: &str,
) -> Result<FrameOutcome, ProductionError> {
    let services = state.production.as_ref().expect("checked by production_request");
    // v0.2: {buildRecordId} — the wire shape is the presentation-safe
    // projection (status, stages, evidenceSummary, restore fields); the raw
    // evidence sections stay in the stored record at the diagnostics
    // boundary.
    let record_id = param_str(request, "/params/buildRecordId").to_owned();
    if record_id.is_empty() {
        return Err(validation_error(
            "vua.production.invalid_params",
            "errors.production.invalidParams",
        ));
    }
    let record = services
        .records
        .read(&record_id)
        .map_err(|_| validation_error("vua.production.record_not_found", "errors.production.recordNotFound"))?;
    let build_record = serde_json::to_value(vua_orchestrator::wire_v02(&record)).map_err(|_| {
        validation_error("vua.production.record_invalid", "errors.production.recordInvalid")
    })?;
    Ok(FrameOutcome::Response(application_success(
        request_id,
        json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "buildRecord": build_record,
        }),
    )))
}

/// Fails a task with the given application error; used when an inline stage
/// (Inspect/Plan) fails so the authoritative terminal state is persisted.
fn persist_task_error(
    store: &SqliteTaskStore,
    task_id: &str,
    error: AppErrorV1,
) -> ProductionError {
    let _ = advance_production_task(
        store,
        task_id,
        TaskMutation::Complete {
            state: TaskState::Failed,
            error: Some(error),
            result: None,
        },
    );
    ProductionError {
        code: "vua.production.stage_failed",
        message_key: "errors.production.stageFailed",
        category: "external_failure",
    }
}



/// Emits every finished production task's terminal event — including when
/// the host is otherwise idle waiting for input.
fn write_pending_events(
    state: &mut HostState,
    output: &mut impl Write,
) -> Result<(), ProviderHostError> {
    let mut pending_events = Vec::new();
    if let Some(services) = &state.production {
        let mut guard = services
            .completed_events
            .lock()
            .expect("completed events poisoned");
        pending_events.extend(guard.drain(..));
        drop(guard);
    }
    pending_events.extend(drain_runtime_events(state));
    for event in pending_events {
        let event_id = format!("sqlite-{}-{}", event.task_id, event.revision);
        write_frame(output, &event_id, "event", task_event(&event_id, &event))?;
    }
    Ok(())
}

/// Takes the runtime-published events queued by the forwarding threads.
/// Called with `&mut HostState` (frame-loop ownership) — the Arc'd queue is
/// only borrowed here, matching the other drains.
fn drain_runtime_events(state: &HostState) -> Vec<StoredTaskEvent> {
    let mut guard = state
        .runtime_events
        .lock()
        .expect("runtime events poisoned");
    std::mem::take(&mut *guard)
}

fn write_frame(
    output: &mut impl Write,
    frame_id: &str,
    kind: &str,
    payload: Value,
) -> Result<(), ProviderHostError> {
    serde_json::to_writer(
        &mut *output,
        &OutboundFrame {
            frame_version: PROVIDER_FRAME_VERSION,
            frame_id,
            kind,
            payload,
        },
    )?;
    output.write_all(b"\n")?;
    output.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use vua_orchestrator::{NewTask, ProjectIdentity};
    use std::io::Cursor;

    fn database_path(label: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("vua-provider-{label}-{nanos}.db"))
    }

    fn frame(id: &str, kind: &str, payload: Value) -> String {
        json!({
            "frameVersion": PROVIDER_FRAME_VERSION,
            "frameId": id,
            "kind": kind,
            "payload": payload,
        })
        .to_string()
    }

    fn request(id: &str, method: &str, extra: Value) -> Value {
        let mut value = json!({
            "contractVersion": APPLICATION_CONTRACT_VERSION,
            "requestId": id,
            "correlationId": "corr-host-test",
            "kind": if method == "task.requestCancellation" { "command" } else { "query" },
            "method": method,
            "params": {},
        });
        for (key, value_to_add) in extra.as_object().expect("test extra object") {
            value
                .as_object_mut()
                .expect("test request object")
                .insert(key.clone(), value_to_add.clone());
        }
        value
    }

    fn parse_frames(bytes: Vec<u8>) -> Vec<Value> {
        String::from_utf8(bytes)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn supervised_protocol_queries_cancels_emits_and_replays_after_restart() {
        let path = database_path("roundtrip");
        {
            let store = SqliteTaskStore::open(&path).unwrap();
            store
                .accept_task(&NewTask {
                    task_id: "task-host".into(),
                    correlation_id: "corr-task-host".into(),
                    occurred_at: "2026-09-02T00:00:00.000Z".into(),
                })
                .unwrap();
            store.checkpoint().unwrap();
        }

        let cancel = request(
            "request-cancel-1",
            "task.requestCancellation",
            json!({
                "commandId": "command-cancel-1",
                "params": {"taskId": "task-host", "observedRevision": 1},
            }),
        );
        let input = [
            frame("frame-handshake", "handshake", Value::Null),
            frame(
                "frame-get",
                "request",
                request(
                    "request-get-1",
                    "task.get",
                    json!({"params": {"taskId": "task-host"}}),
                ),
            ),
            frame("frame-cancel", "request", cancel),
            frame("frame-stop", "prepare_shutdown", json!({"timeoutMs": 1000})),
        ]
        .join("\n")
            + "\n";
        let mut output = Vec::new();
        run_provider_host(Cursor::new(input), &mut output, &path).unwrap();
        let frames = parse_frames(output);
        assert_eq!(frames.len(), 5);
        assert_eq!(frames[0]["payload"]["contractVersion"], "0.1");
        assert_eq!(
            frames[1]["payload"]["value"]["recoveryDisposition"],
            "inspect_required"
        );
        assert_eq!(frames[2]["payload"]["value"]["outcome"], "requested");
        assert_eq!(frames[3]["kind"], "event");
        assert_eq!(frames[3]["payload"]["kind"], "task.cancellationRequested");
        assert_eq!(frames[4]["payload"]["outcome"], "safe_to_stop");

        // A new request envelope with the same commandId replays the durable
        // result rather than emitting another event.
        let replay = request(
            "request-cancel-2",
            "task.requestCancellation",
            json!({
                "commandId": "command-cancel-1",
                "params": {"taskId": "task-host", "observedRevision": 99},
            }),
        );
        let input = [
            frame("frame-cancel-replay", "request", replay),
            frame(
                "frame-stop-2",
                "prepare_shutdown",
                json!({"timeoutMs": 1000}),
            ),
        ]
        .join("\n")
            + "\n";
        let mut output = Vec::new();
        run_provider_host(Cursor::new(input), &mut output, &path).unwrap();
        let frames = parse_frames(output);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["payload"]["value"]["outcome"], "requested");
        assert_eq!(frames[0]["payload"]["value"]["revision"], 2);

        let store = SqliteTaskStore::open(&path).unwrap();
        assert_eq!(
            store
                .events_after("task-host", 0)
                .unwrap()
                .iter()
                .filter(|event| event.kind == TaskEventKind::CancelRequested)
                .count(),
            1
        );
        store.checkpoint().unwrap();
        drop(store);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn protocol_rejects_an_oversized_frame() {
        let path = database_path("oversized");
        let input = vec![b'x'; (MAX_FRAME_BYTES + 1) as usize];
        let error = run_provider_host(Cursor::new(input), Vec::new(), &path).unwrap_err();
        assert!(matches!(error, ProviderHostError::OversizedFrame));
        let store = SqliteTaskStore::open(&path).unwrap();
        store.checkpoint().unwrap();
        drop(store);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn provider_store_lock_allows_exactly_one_supervisor() {
        let path = database_path("exclusive");
        let first = ProviderInstanceLock::acquire(&path).unwrap();
        assert!(matches!(
            ProviderInstanceLock::acquire(&path),
            Err(ProviderHostError::AlreadyRunning)
        ));
        drop(first);
        ProviderInstanceLock::acquire(&path).unwrap();
    }

    #[test]
    fn restart_marks_old_provider_leases_for_inspection() {
        let path = database_path("old-owner");
        let identity = ProjectIdentity::from_test_label("old-owner-project");
        {
            let store = SqliteTaskStore::open(&path).unwrap();
            store
                .accept_task(&NewTask {
                    task_id: "task-old-owner".into(),
                    correlation_id: "corr-old-owner".into(),
                    occurred_at: "2026-09-02T00:00:00.000Z".into(),
                })
                .unwrap();
            store
                .acquire_project_lease(
                    &identity,
                    "provider-old",
                    "task-old-owner",
                    "2026-09-02T00:00:00.000Z",
                )
                .unwrap();
        }
        let input = frame("frame-stop", "prepare_shutdown", json!({"timeoutMs": 1})) + "\n";
        run_provider_host(Cursor::new(input), Vec::new(), &path).unwrap();

        let store = SqliteTaskStore::open(&path).unwrap();
        let lease = store.project_lease(&identity).unwrap().unwrap();
        assert!(lease.recovery_required);
        assert_eq!(lease.owner_instance_id, "provider-old");
    }

    #[test]
    fn active_mutation_requires_choice_and_force_freezes_lease_for_inspect() {
        let store = SqliteTaskStore::open_in_memory().unwrap();
        store
            .accept_task(&NewTask {
                task_id: "task-mutating".into(),
                correlation_id: "corr-mutating".into(),
                occurred_at: "2026-09-02T00:00:00.000Z".into(),
            })
            .unwrap();
        let identity = ProjectIdentity::from_test_label("project-a");
        store
            .acquire_project_lease(
                &identity,
                "provider-test",
                "task-mutating",
                "2026-09-02T00:00:00.000Z",
            )
            .unwrap();
        let mut state = HostState {
            store: Arc::new(store),
            provider_instance_id: "provider-test".into(),
            recovered_nonterminal_tasks: HashSet::new(),
            production: None,
            downloads: None,
            warehouse: None,
            use_cases: None,
            project_ops: None,
            environment: None,
            editor_verify: Arc::new(verify_editor_path_system),
            vpm: None,
            runtime_events: Arc::new(Mutex::new(Vec::new())),
        };

        let prepare = InboundFrame {
            frame_version: PROVIDER_FRAME_VERSION.into(),
            frame_id: "prepare".into(),
            kind: "prepare_shutdown".into(),
            payload: json!({"timeoutMs": 1}),
        };
        let FrameOutcome::Response(result) = handle_frame(&mut state, &prepare).unwrap() else {
            panic!("an active mutation must keep the Provider alive");
        };
        assert_eq!(result["outcome"], "needs_user_choice");
        assert_eq!(result["blockingTasks"][0]["taskId"], "task-mutating");

        let force = InboundFrame {
            frame_version: PROVIDER_FRAME_VERSION.into(),
            frame_id: "force".into(),
            kind: "continue_shutdown".into(),
            payload: json!({"decision": "force", "userDecisionId": "decision-test"}),
        };
        let FrameOutcome::Exit(result) = handle_frame(&mut state, &force).unwrap() else {
            panic!("a recorded force decision must stop the Provider");
        };
        assert_eq!(result["outcome"], "forced");
        assert_eq!(result["interruptedTasks"][0]["taskId"], "task-mutating");
        assert!(
            state
                .store
                .project_lease(&identity)
                .unwrap()
                .unwrap()
                .recovery_required
        );
    }

    #[test]
    fn demo_task_walks_lifecycle_and_is_swept_on_restart_per_board_20() {
        let path = database_path("demo-lifecycle");

        // run 1: start -> accepted queued (event), deterministic taskId.
        let start = request(
            "request-demo-1",
            "task.startDemo",
            json!({"commandId": "command-demo-1", "kind": "command"}),
        );
        let input = [frame("frame-1", "request", start)].join("
") + "
";
        let mut output = Vec::new();
        run_provider_host(Cursor::new(input), &mut output, &path).unwrap();
        let frames = parse_frames(output);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["kind"], "response");
        let task_id = frames[0]["payload"]["value"]["task"]["taskId"]
            .as_str()
            .expect("demo task id")
            .to_string();
        assert!(task_id.starts_with("demo-"));
        assert_eq!(frames[0]["payload"]["value"]["task"]["state"], "queued");
        assert_eq!(frames[1]["kind"], "event");
        assert_eq!(frames[1]["payload"]["kind"], "task.accepted");

        // run 2: BOARD #20 — a restart sweeps the non-terminal demo task to
        // the interrupted semantics (queued -> cancelled, no error) instead
        // of letting a dead process's task keep reading as live. The
        // idempotent replay returns the swept snapshot: a replay never
        // resurrects a swept task.
        let replay = request(
            "request-demo-2",
            "task.startDemo",
            json!({"commandId": "command-demo-1", "kind": "command"}),
        );
        let snapshot = request(
            "request-snap",
            "application.getSnapshot",
            json!({}),
        );
        let input = [
            frame("frame-2", "request", replay),
            frame("frame-3", "request", snapshot),
        ]
        .join("
")
            + "
";
        let mut output = Vec::new();
        run_provider_host(Cursor::new(input), &mut output, &path).unwrap();
        let frames = parse_frames(output);
        let replayed_state = &frames[0]["payload"]["value"]["task"]["state"];
        assert_eq!(replayed_state, "cancelled", "BOARD #20: the queued demo task is swept to cancelled on restart");
        // The sweep produces no event frame for a queued task (cancelled
        // quietly, no error) — the responses are replay + snapshot.
        assert_eq!(frames.len(), 2, "{frames:?}");
        let operations = &frames[1]["payload"]["value"]["capabilities"]["operations"];
        assert!(operations
            .as_array()
            .unwrap()
            .iter()
            .any(|operation| operation["operationId"] == "demo.task"));

        // run 3: a fresh command id accepts a NEW demo task (the sweep is
        // per-task, not a lockout), which is again queued — and swept by
        // the next restart the same way.
        let start_again = request(
            "request-demo-3",
            "task.startDemo",
            json!({"commandId": "command-demo-2", "kind": "command"}),
        );
        let input = [frame("frame-4", "request", start_again)].join("
") + "
";
        let mut output = Vec::new();
        run_provider_host(Cursor::new(input), &mut output, &path).unwrap();
        let frames = parse_frames(output);
        assert_eq!(frames[0]["payload"]["value"]["task"]["state"], "queued");
        let new_task_id = frames[0]["payload"]["value"]["task"]["taskId"]
            .as_str()
            .expect("new demo task id");
        assert_ne!(new_task_id, task_id, "a fresh command id accepts a new task");
    }

    #[test]
    fn persistence_failed_events_map_to_their_wire_kind() {
        let event = StoredTaskEvent {
            task_id: "task-poison".into(),
            revision: 4,
            kind: TaskEventKind::PersistenceFailed,
            state: TaskState::Running,
            occurred_at: "2026-09-18T00:00:00.000Z".into(),
            correlation_id: "corr-poison".into(),
            payload: json!({"code": "vua.task.journal_write_failed"}),
        };
        let wire = task_event("runtime-task-poison-4", &event);
        assert_eq!(wire["kind"], "task.persistenceFailed");
        assert_eq!(wire["taskId"], "task-poison");
        assert_eq!(wire["revision"], 4);
    }

    #[test]
    fn runtime_event_queue_drains_completely() {
        let state = HostState {
            store: Arc::new(SqliteTaskStore::open_in_memory().unwrap()),
            provider_instance_id: "provider-test".into(),
            recovered_nonterminal_tasks: HashSet::new(),
            production: None,
            downloads: None,
            warehouse: None,
            use_cases: None,
            project_ops: None,
            environment: None,
            editor_verify: Arc::new(verify_editor_path_system),
            vpm: None,
            runtime_events: Arc::new(Mutex::new(vec![StoredTaskEvent {
                task_id: "task-x".into(),
                revision: 2,
                kind: TaskEventKind::StateChanged,
                state: TaskState::Running,
                occurred_at: "2026-09-18T00:00:00.000Z".into(),
                correlation_id: "corr-x".into(),
                payload: Value::Null,
            }])),
        };
        let drained = drain_runtime_events(&state);
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].task_id, "task-x");
        assert!(
            state
                .runtime_events
                .lock()
                .expect("runtime events poisoned")
                .is_empty(),
            "drain must take the queue"
        );
        assert!(!runtime_poisoned(&state, "task-x"), "no runtime holds task-x");
    }
}


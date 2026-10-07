//! Local-first VUA application core for Recipe-first AMF workflows.

// AppErrorV1 is a deliberately fat value type: it carries the localization
// key, params and redacted context through IPC, events and the journal. Boxed
// errors would leak through serde shapes for no wire benefit.
#![allow(clippy::result_large_err)]

mod assembly;
mod bdl_dependency_queries;
mod booth_extraction;
mod build_record;
mod dependencies_queries;
mod inspection_evidence;
mod plan_documents;
mod production_evidence;
mod recipe_documents;
mod recipe_records;
mod capability;
mod contracts;
mod editor_targets;
mod editor_selection;
mod environment;
pub mod network;
mod filesystem;
mod journal;
mod material_types;
mod model;
mod overlay_surface;
mod process;
mod project_identity;
mod provision;
mod recipe;
mod recipe_export;
mod release_handoff;
mod runtime;
mod sqlite_task_store;
mod state_file;
mod time;
mod tools;
mod vpm;
mod vpm_backend;
mod win_registry;
mod workflow;

pub use assembly::{
    error_codes as assembly_error_codes, AssemblyConfirmation, AssemblyEngine, AssemblyOperation,
    AssemblyPlanV1, AssemblyStepV1, BridgeError, UnityBridge,
};
pub use booth_extraction::{
    extract_product_page, ExtractedProduct, ExtractedSubproduct, ExtractionError,
};
pub use plan_documents::{ApproveOutcome, PlanDocumentStore, APPROVED_PLAN_SCHEMA_VERSION};
pub use inspection_evidence::{
    aggregate_overall_status, build_inspection_command, operation_status, producing_operations,
    transcribe_dimension, InspectionDimension, InspectionEvidenceStore,
    INSPECTION_EVIDENCE_SCHEMA_VERSION,
};
pub use recipe_records::RecipeRecordStore;
pub use release_handoff::{
    build_handoff_fact, build_inspection_fact, classify_handoff_record_state,
    record_editor_version, record_project_id, resolve_handoff_editor, HandoffEditorCandidate,
    HandoffEditorSource, HandoffEditorUnresolved, HandoffLaunch, HandoffOutcome, HandoffPortError,
    HandoffRecordAdmission, ReleaseHandoffPort, OPEN_FOR_INSPECTION_OPERATION,
    RELEASE_HANDOFF_SCHEMA_VERSION,
};
pub use recipe_documents::{RecipeDocumentStore, RecipeListEntry, RecipeSaveError, StoredRecipeDocument};
pub use production_evidence::{
    EvidenceKind, EvidenceResolution, EvidenceSourceRef, EvidenceStore, EvidenceSubject,
    ProductionEvidenceV01, PRODUCTION_EVIDENCE_SCHEMA_VERSION,
};
pub use build_record::{
    wire_v02, BridgeJobEvidenceV01, BridgeSummary, BuildRecordStatus, BuildRecordStore,
    BuildRecordV01, BuildRecordWireV02, BuildSnapshotEvidenceV01, BuildValidationEvidenceV01,
    EvidenceSummary, LocalVpmEvidenceV01, LocalVpmSummary, SnapshotSummary, ValidationSummary,
    BUILD_RECORD_SCHEMA_VERSION, PRODUCTION_STAGES,
};
pub use capability::{
    CapabilityRegistry, CapabilityReport, CapabilitySource, CapabilityState, UnavailableSource,
};
pub use contracts::{
    AppErrorV1, CommandAcceptedV1, ErrorCategory, ParamValue, TaskEventKind, TaskEventV1,
    TaskState, ENVELOPE_SCHEMA_VERSION,
};
pub use dependencies_queries::{
    AdvisoryConfidence, DependenciesListByProductParams, DependenciesListByProductResultV05,
    DependenciesLookupParams, DependenciesLookupResultV05, DependenciesParamsError,
    DependenciesQueriesCapabilities, DependenciesQueriesPort, DependencyKind, DependencyMatchV05,
    DependencyObservationV05, DependencyProductStatus, ExtractionMethod, InstallAdvisoryV05,
    InstallSource, ResolutionEvidenceV05, ResolutionV05, SourceSpan,
};
pub use bdl_dependency_queries::BdlDependencyQueries;
pub use editor_targets::{
    classify_editor, classify_version_string, codes as editor_target_codes, editor_version_from_path,
    parse_editor_version, EditorClass, ParsedEditorVersion, MIGRATION_SOURCES, PRODUCTION_TARGET,
};
pub use editor_selection::{select_editor, EditorSelection, EditorSelectionGap};
pub use environment::{
    codes as env_managers_codes, error_codes as env_error_codes, installed_unity_editors,
    EditorInstallObservation, InstalledUnityEditor, EnvironmentCheckItemV1, EnvironmentEngine,
    EnvironmentPresence, EnvironmentRoots, EnvironmentSnapshotV1, FindingSeverity,
    ManagerDiagnostic, ManagerPresence, VccCapability, VccSettingsReader, VrRuntimeRoots, Zone,
    EMBEDDED_VRC_GET_VPM_VERSION,
};
pub use filesystem::{
    project_tree_fingerprint, FileSystemProjectStore, FileSystemSnapshotStore,
    SnapshotManifestEntry, SnapshotManifestV1, VerifiedSnapshot,
};
pub use journal::{
    recover_from_journal, JournalEntryKind, JournalEntryV1, JournalError, JournalPayload,
    JournalSink, JournalWriter, MemoryJournal, RecoveredDisposition, RecoveredTask, RecoveryReport,
    JOURNAL_SCHEMA_VERSION,
};
pub use material_types::{
    DeclaredDependencyV01, ExecutableRiskEvidence, ExecutableRiskKind, MaterialEntryMode,
    RiskDecisionChoice, SourceFolderInspectionV01, SourcePackageEvidenceV01,
};
pub use model::*;
pub use overlay_surface::{
    OverlayPlanSummary, OverlayProductionCard, OverlayReadModel, OverlayRecordSummary,
    OverlayTaskCard, StoreOverlayReadModel,
};
pub use process::{
    outcome_with_exit, FakeProcessRunner, ProcessError, ProcessOutcome, ProcessRunner, ProcessSpec,
    StdProcessRunner, CREDENTIAL_ENV_REMOVALS,
};
pub use project_identity::{ProjectIdentity, ProjectIdentityError};
pub use provision::{ProjectProvisionError, VpmProjectProvisioner};
pub use recipe::*;
pub use recipe_export::{
    DraftDependencyV01, DraftEnvironmentV01, DraftOriginV01, MissingDimensionV01,
    OnDiskProjectDraftExporter, ProjectDraftDocumentV01, ProjectDraftExportCapabilities,
    ProjectDraftExportPort, VuaIdentityStatusV01,
};
pub use runtime::{
    recovery_dispositions, SubmitRequest, TaskContext, TaskExit, TaskJob, TaskRecoveryDisposition,
    TaskRuntime, TaskSnapshot,
};
pub use sqlite_task_store::{
    IdempotentCancellation, IdempotentTaskAcceptance, NewTask, ProjectMutationLease,
    SqliteStoreError, SqliteTaskStore, StoredCancellationOutcome, StoredCancellationResult,
    StoredTask, StoredTaskEvent, TaskMutation,
};
pub use state_file::{
    StateFile, StateFileError, StateLoad, StateRecoveryReason, STATE_FILE_SCHEMA_VERSION,
};
pub use time::{
    Clock, FixedClock, FixedIdGenerator, NanosTaskIdGenerator, SystemClock, TaskIdGenerator,
};
pub use tools::{
    registry_ids, ProbeRoot, ToolCardV1, ToolProbe, ToolRegistration, ToolsEngine, ToolsRoots,
    TOOL_REGISTRY,
};
pub use vpm::{fnv1a_hex, InstallConfirmation, InstallPlanV1, InstallRequest, PlanStepV1, VpmEngine};
pub use vpm_backend::{
    error_codes as vpm_backend_error_codes, CatalogCapabilities, CatalogVersionV01, ChangeItemV1,
    ChangeKindV1, ChangePreviewV1, InstalledListingV02, InstalledPackageV1, InstalledPackageV02,
    PackageCatalogV01, PackageCatalogV02, PackageRequestV1, PackageSourceV01, RegisteredProjectV1,
    RegisterCapabilities, RepoCatalogCapabilities, RepoCatalogPackageV01, RepoCatalogRepoV01,
    RepoCatalogV01, RepoInfoV01, RepoInfoV02, RepoLifecycleCapabilities, RepoRefreshOutcomeV01,
    RepoWriteCapabilities, ResolveFailureV01, ResolveReceiptV01, ResolvedPackageV01,
    RESOLVE_RECEIPT_SCHEMA_VERSION, TemplateCapabilities, TemplateEntryV01, VpmBackend,
    VpmCapabilities,
};
pub use workflow::{AvatarSetupWorkflow, WorkflowError};
pub use win_registry::{FakeRegistrySource, RegistryHive, RegistrySource, WindowsRegistrySource};

/// N1 deployment decisions and adapter port; independent of vendor/process types.
pub mod deployment;

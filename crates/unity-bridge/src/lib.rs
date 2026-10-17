//! Unity Bridge adapter and the material production pipeline: intake,
//! staging, execution and production documents. Lives on the same lifecycle
//! as the C# Unity package and the versioned Bridge schema.

// AppErrorV1-carrying results are deliberately fat value types shared with
// the core contract; boxed errors would not change the wire surface.
#![allow(clippy::result_large_err)]

pub mod bridge;
pub mod handoff;
pub mod local_vpm_artifact;
pub mod material_exec;
pub mod material_identity;
pub mod material_intake;
pub mod material_staging;
pub mod material_task;
pub mod production_documents;
pub mod production_job;
pub mod staging_scaffold;
pub mod unity_log;

pub use bridge::UnityBatchBridge;
pub use unity_log::{UnityLogReader, UnityLogTail};
pub use handoff::{
    handshake_path, DefaultEditorHandoff, DefaultProcessLiveness, DetachedEditorSpawner,
    EditorHandoffPort, EditorHandshake, EditorLaunched, EditorOpenState, FocusOutcome,
    HandoffError, HandoffWait, OsWindowFocus, ProcessLiveness, SystemWait, WindowFocus,
    EditorSpawner, DEFAULT_HANDSHAKE_BUDGET, HANDSHAKE_POLL_INTERVAL, HANDSHAKE_SCHEMA_VERSION,
};
pub use local_vpm_artifact::{publish_local_vpm_artifact, PublishedLocalVpmArtifact};
pub use material_exec::{
    error_codes as material_exec_error_codes, GenerateSourcePackage, MaterialCancelToken,
    MaterialExecutionReport, MaterialExecutionStatus, MaterialExecutor, RollbackOutcome,
};
pub use material_identity::{LocalPackageIdentity, LocalPackageIdentityStore};
pub use material_intake::{
    error_codes as material_intake_error_codes, MaterialIntakeConfirmationV01,
    MaterialIntakeEngine, MaterialIntakePlanV01, MaterialIntakeStepKind, MaterialIntakeStepV01,
    RiskDecisionV01,
};
pub use material_staging::{
    staging_root, StagingProject, STAGING_MANIFEST_JSON, STAGING_PROJECT_VERSION_TXT,
    STAGING_TEMPLATE_VERSION, STAGING_UNITY_VERSION,
};
pub use material_task::{
    material_intake_job, submit_material_intake, MaterialIntakeTaskSpec, MaterialTaskResult,
};
pub use production_documents::{
    build_inspection_document, build_plan_document, InspectionDocument, InspectionFinding,
    InspectionFindingKind, PlanDocument, Plannability,
};
pub use production_job::{
    read_plan_file, write_plan_file, PlanFile, PlanFileError, ProductionJobReceipt,
    ProductionJobReceiptData, ProductionJobStep, ProductionResolvedSource,
    SUPPORTED_PLAN_SCHEMA_VERSIONS,
};
pub use staging_scaffold::{
    MA_STUB_ASMDEF, MA_STUB_COMPONENTS_CS, MA_STUB_PACKAGE_ID, MA_STUB_PACKAGE_JSON,
};

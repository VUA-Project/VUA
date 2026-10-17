use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStage {
    Inspect,
    Plan,
    AwaitConfirmation,
    Snapshot,
    Execute,
    Validate,
    Completed,
    Recover,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub id: String,
    pub root: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarSetupRequest {
    pub workflow_id: String,
    pub project: ProjectRef,
    pub avatar_global_object_id: String,
    pub avatar_armature_global_object_id: String,
    pub outfit_global_object_id: String,
    pub outfit_armature_global_object_id: String,
    pub toggle_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnityOperation {
    InspectProject,
    ImportUnityPackage,
    MaterializeExtractedPackage,
    CreateLocalVpmPackage,
    ValidateAssetPaths,
    IdentifyAssets,
    InstallOutfit,
    CreateToggle,
    ValidateAvatar,
    AnalyzePerformance,
    /// M5 production job: execute an approved plan (Bridge v2; proposal 009).
    ExecuteProductionJob,
    /// M5 production recovery: restore the project to a registered recovery
    /// point (Bridge v2; proposal 009 cross-review point 5).
    RestoreProject,
    /// M7 inspection slice: Avatar asset reference integrity — the producing
    /// layer of the dependencies dimension (Bridge v3; proposal 016
    /// operation-shape proposal, dependencies single-layer ruling). Read-only.
    InspectAvatarReferences,
    /// M7 inspection slice: active-scene lighting facts (realtime lights,
    /// bake state, reflection probes) — the producing layer of the lighting
    /// dimension (Bridge v3). Read-only; observes facts, never an official
    /// lighting rating.
    InspectLighting,
    /// M7 inspection slice: SDK upload-preparation observations (descriptor
    /// presence, SDK component reflection, build target facts) — the
    /// producing layer of the upload_readiness dimension (Bridge v3).
    /// Read-only; never an official SDK verdict.
    InspectUploadReadiness,
    /// Release bake-preview turntable (Bridge v4; slice/production-nav-
    /// bake-preview, user ruling 2026-09-20): renders an isolated preview-
    /// scene copy of the Avatar into `.vua/bridge/preview/<commandId>/`
    /// (60 frames 1024x1024 PNG + cover.png + manifest v1). Classified
    /// mutating because artifacts are written into the project directory:
    /// a real run requires expectedProjectFingerprint, dryRun=true reports
    /// structure statistics only and produces no images. The user scene is
    /// never modified (preview-scene isolation; the mutating pipeline skips
    /// the scene-save step for this operation).
    BuildPreview,
    /// Candidate v5, separate AMF entry point; frozen v1-v4 are unchanged.
    AmfPrepare,
    AmfInspect,
    AmfAssemble,
    /// Bakes the 60-frame turntable of the assembled AMF Avatar into the work project (v5).
    AmfTurntable,
}

impl UnityOperation {
    pub fn is_mutating(self) -> bool {
        matches!(
            self,
            Self::ImportUnityPackage
                | Self::MaterializeExtractedPackage
                | Self::CreateLocalVpmPackage
                | Self::InstallOutfit
                | Self::CreateToggle
                | Self::ExecuteProductionJob
                | Self::RestoreProject
                | Self::BuildPreview
                | Self::AmfPrepare
                | Self::AmfAssemble
                | Self::AmfTurntable
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnityPackageDependency {
    pub package_id: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnityPayload {
    pub avatar_global_object_id: String,
    pub avatar_armature_global_object_id: String,
    pub outfit_global_object_id: String,
    pub outfit_armature_global_object_id: String,
    pub toggle_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_package_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_package_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub package_version: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub package_dependencies: Vec<UnityPackageDependency>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub staging_token: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub expected_asset_paths: Vec<String>,
    // --- Unity Bridge v2 fields (schemas/unity-bridge/v2; proposals 009/012) ---
    /// Hash of the approved plan document (integrity and idempotency anchor).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_hash: Option<String>,
    /// The approved-plan schema version this job consumes (compatibility gate).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_schema_version: Option<String>,
    /// Job-directory file reference to the plan document (provider-written
    /// projection; the Bridge verifies its local hash against planHash).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// The pre-job snapshot taken before the first job executes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnityCommand {
    pub schema_version: u8,
    pub command_id: String,
    pub operation: UnityOperation,
    pub project_id: String,
    pub dry_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_project_fingerprint: Option<String>,
    pub payload: UnityPayload,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    Succeeded,
    Failed,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub severity: DiagnosticSeverity,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnityResult {
    pub schema_version: u8,
    pub command_id: String,
    pub status: ResultStatus,
    pub changed_paths: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
    #[serde(default)]
    pub data: serde_json::Value,
    // --- Unity Bridge v2 receipt fields (schemas/unity-bridge/v2) ---
    /// Per-plan-job receipts, transposed verbatim from the v2 receipt steps
    /// (kind/status/warning/resolvedSource — the auditable "which copy was
    /// actually used" record).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<UnityStepReceipt>,
    /// True when this receipt is an idempotent replay, not a first run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replayed: Option<bool>,
    /// The pre-job snapshot taken for this job (recovery-point identity).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
    /// The recovery point this restore rolled back to (restore_project).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restored_from: Option<String>,
    /// The project fingerprint observed before any change (rejected
    /// admissions carry none; succeeded/failed carry the pre-state).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_fingerprint_before: Option<String>,
}

/// One plan job's receipt line, transposed from the Unity Bridge v2
/// `data.steps[]` items (schemas/unity-bridge/v2/result.schema.json).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnityStepReceipt {
    pub kind: String,
    pub status: UnityStepStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_source: Option<UnityResolvedSource>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnityStepStatus {
    Pending,
    Executed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnityResolvedSource {
    pub source_kind: UnitySourceKind,
    pub artifact_sha256: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warehouse_item_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnitySourceKind {
    Original,
    GeneratedVpm,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub operation: UnityOperation,
    pub label: String,
    pub mutates_project: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPlan {
    pub workflow_id: String,
    pub project: ProjectRef,
    pub steps: Vec<PlanStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowReport {
    pub workflow_id: String,
    pub stage: WorkflowStage,
    pub completed_operations: Vec<UnityOperation>,
    pub diagnostics: Vec<Diagnostic>,
    pub performance: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRef {
    pub id: String,
    pub path: PathBuf,
}

pub trait SnapshotStore {
    type Error;

    fn create(&self, project: &ProjectRef, snapshot_id: &str) -> Result<SnapshotRef, Self::Error>;
    fn restore(&self, project: &ProjectRef, snapshot: &SnapshotRef) -> Result<(), Self::Error>;
}

impl std::fmt::Display for UnityOperation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let name = serde_json::to_value(self)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "unknown".into());
        formatter.write_str(&name)
    }
}

//! B3 material intake executor: drives a confirmed plan's steps against the
//! real ports — the versioned Bridge, the verified snapshot store, the
//! `vrc-get` backend, and the build-record store.
//!
//! Contract highlights (material-intake v0.1):
//! - Source digests are recomputed before anything mutates; drift fails the
//!   run with `vua.material.source_drift` before the first write.
//! - Every mutating run carries a minimum recovery snapshot; a failure after
//!   the snapshot triggers a restore attempt whose outcome is recorded.
//! - A published build record is the receipt: re-running the same plan
//!   replays idempotently as success without touching Unity again.
//! - Cancellation is checked before each step; a cancelled run reports
//!   `cancelled` with the steps completed so far — facts only, no severity.
//! - Mutating Bridge commands carry `expected_project_fingerprint` and the
//!   fingerprint CHAINS: each success returns the project's new fingerprint
//!   (result.data.projectFingerprint), which the next command must expect.
//! - Unity's `ImportPackage` is a silent no-op in batchmode, so archives are
//!   extracted under `.vua/imports/<command_id>/` (inside the snapshot-
//!   protected project) and the Bridge materializes that layout instead.
//!
//! Tests cover the state machine on fake ports; real-Unity calibration
//! (timeout budget, real rejection payloads, rollback equivalence) is the
//! separate local matrix per the M3 gate.

use vua_orchestrator::{
    BridgeJobEvidenceV01, BuildRecordStatus, BuildRecordStore, BuildRecordV01,
    BuildSnapshotEvidenceV01, BuildValidationEvidenceV01,
};
use vua_orchestrator::{FileSystemSnapshotStore, VerifiedSnapshot};
use crate::material_intake::{
    error_codes as intake_codes, MaterialIntakeConfirmationV01, MaterialIntakeEngine,
    MaterialIntakeStepKind,
};
use vua_orchestrator::MaterialEntryMode;
use crate::material_identity::LocalPackageIdentityStore;
use crate::material_staging::StagingProject;
use vua_orchestrator::{
    ProjectRef, ResultStatus, UnityCommand, UnityOperation, UnityPayload, UnityResult,
};
use vua_orchestrator::Clock;
use vua_orchestrator::{PackageRequestV1, VpmBackend};
use vua_orchestrator::UnityBridge;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub mod error_codes {
    pub const BRIDGE_FAILED: &str = "vua.material.bridge_failed";
    pub const BRIDGE_TIMEOUT: &str = "vua.material.bridge_timeout";
    pub const BRIDGE_REJECTED: &str = "vua.material.bridge_rejected";
    pub const SNAPSHOT_FAILED: &str = "vua.material.snapshot_failed";
    pub const ROLLBACK_FAILED: &str = "vua.material.rollback_failed";
    pub const STAGING_FAILED: &str = "vua.material.staging_failed";
    /// plan v0.2 (W25 real-machine finding): creating the not-yet-provisioned
    /// target through the VPM backend port failed. The backend's original
    /// code and reason travel inside the message (the vua.vpm.* codes never
    /// replace the vua.material.* family code — the family law).
    pub const PROVISION_FAILED: &str = "vua.material.provision_failed";
}

/// The task-layer failure word-face law (batch 150): a provision-segment
/// failure — `run_provision`'s create/resolve arms, every one of which packs
/// its report under the `PROVISION_FAILED` prefix — hits the desktop's long
/// reserved `errors.material.provisionFailed` row; every other failure keeps
/// the standing `errors.material.executionFailed`. Before batch 150 both
/// faces emitted the coarse executionFailed regardless of code, so the
/// reserved provision row could never hit (desktop batch-148 evidence). This
/// is payload-data refinement only: the AppErrorV1 envelope and its field
/// closed set are untouched, the code still carries the original detail
/// (the desktop presents the localized face AND the raw code side by side,
/// batch-148 dual-fact law).
pub fn failure_message_key(error_code: Option<&str>) -> &'static str {
    match error_code {
        Some(code) if code.starts_with(error_codes::PROVISION_FAILED) => {
            "errors.material.provisionFailed"
        }
        _ => "errors.material.executionFailed",
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MaterialExecutionStatus {
    Succeeded,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RollbackOutcome {
    NotNeeded,
    Restored,
    Failed,
}

/// The run report: facts about what happened, in presence-contract spirit.
/// `error_code` is set only when `status` is `Failed`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialExecutionReport {
    pub plan_id: String,
    pub correlation_id: String,
    pub status: MaterialExecutionStatus,
    pub completed_steps: Vec<MaterialIntakeStepKind>,
    pub error_code: Option<String>,
    pub rollback: RollbackOutcome,
    pub build_record_id: Option<String>,
    /// True when a published receipt existed and Unity was not touched.
    pub replayed: bool,
}

/// One step's mutation outcome: continue with the run, or stop with a code.
/// One warehouse original offered to [`MaterialExecutor::generate_vpm_only`].
#[derive(Debug, Clone)]
pub struct GenerateSourcePackage {
    pub archive_path: PathBuf,
    pub sha256: String,
}

/// The outcome of a successful generate-only run: the published VPM
/// artifact (package tree + archive) in the caller's output root.
#[derive(Debug, Clone)]
pub struct GeneratedVpm {
    pub package_id: String,
    pub artifact: crate::local_vpm_artifact::PublishedLocalVpmArtifact,
}

pub type StepFailure = (String, MaterialExecutionStatus);

/// Per-execution cancellation flag. Ownership lives at the submission layer
/// (task spec), never in the executor: a shared executor must not let one
/// run's cancellation leak into later or concurrent runs, and a cancelled
/// token is never reset — it is simply not reused.
#[derive(Clone, Default, Debug)]
pub struct MaterialCancelToken(Arc<AtomicBool>);

impl MaterialCancelToken {
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    /// Requests cancellation; observed at the executor's step boundaries.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub struct MaterialExecutor {
    bridge: Arc<dyn UnityBridge>,
    snapshots: FileSystemSnapshotStore,
    vpm: Arc<dyn VpmBackend>,
    records: BuildRecordStore,
    clock: Arc<dyn Clock>,
    temp_root: PathBuf,
    unity_editor_version: String,
    identity_store: LocalPackageIdentityStore,
    staging_template_override: Option<PathBuf>,
}

impl MaterialExecutor {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        bridge: Arc<dyn UnityBridge>,
        snapshots: FileSystemSnapshotStore,
        vpm: Arc<dyn VpmBackend>,
        records: BuildRecordStore,
        clock: Arc<dyn Clock>,
        temp_root: impl Into<PathBuf>,
        unity_editor_version: impl Into<String>,
        identity_store: LocalPackageIdentityStore,
    ) -> Self {
        Self {
            bridge,
            snapshots,
            vpm,
            records,
            clock,
            temp_root: temp_root.into(),
            unity_editor_version: unity_editor_version.into(),
            identity_store,
            staging_template_override: None,
        }
    }

    /// 本地真机 Harness 接缝:以指定目录作为暂存项目骨架(含 Bridge 包与
    /// 编译脚手架)。生产路径不设置,使用捆绑模板。
    pub fn with_staging_template_override(mut self, dir: impl Into<PathBuf>) -> Self {
        self.staging_template_override = Some(dir.into());
        self
    }

    /// Read-only project inspection — the recovery credential source. The
    /// returned fingerprint, bound to the project's normalized identity and
    /// the lease generation, is what authorizes a lease takeover; nothing
    /// is mutated.
    pub fn inspect_project(
        &self,
        project: &ProjectRef,
        correlation_id: &str,
    ) -> Result<String, vua_orchestrator::AppErrorV1> {
        let command = UnityCommand {
            schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
            command_id: format!("project-inspect-{}", self.clock.now_rfc3339()),
            operation: UnityOperation::InspectProject,
            project_id: project.id.clone(),
            dry_run: true,
            expected_project_fingerprint: None,
            payload: UnityPayload::default(),
        };
        let mut jobs = Vec::new();
        let result = self
            .dispatch(project, &command, &mut jobs)
            .map_err(|(code, _)| {
                vua_orchestrator::AppErrorV1::new(
                    code,
                    vua_orchestrator::ErrorCategory::ExternalFailure,
                    "errors.material.executionFailed",
                    correlation_id,
                )
                .with_recoverable(true)
            })?;
        fingerprint_of(&result).ok_or_else(|| {
            vua_orchestrator::AppErrorV1::new(
                error_codes::BRIDGE_FAILED.to_owned(),
                vua_orchestrator::ErrorCategory::ExternalFailure,
                "errors.material.executionFailed",
                correlation_id,
            )
            .with_recoverable(true)
        })
    }

    /// Drives the confirmed plan. Always returns a report — failures live in
    /// the report, not the error channel, so the task runtime can persist
    /// them uniformly. Cancellation is observed from `token` at each step
    /// boundary; the token is the caller's, one per execution.
    pub fn execute(
        &self,
        confirmation: &MaterialIntakeConfirmationV01,
        source_folder: &Path,
        project: &ProjectRef,
        artifact_output_root: &Path,
        token: &MaterialCancelToken,
    ) -> MaterialExecutionReport {
        let plan = &confirmation.plan;
        // The receipt is the replay guard — but only a SUCCEEDED receipt for
        // the same plan hash, project, and source identity replays as
        // success. Failed and cancelled receipts do not get to lie: a retry
        // runs fresh and publishes under the next free attempt id, leaving
        // the prior receipt untouched as audit history.
        let mut record_id = format!("material-{}", plan.plan_id);
        let mut attempt: u32 = 1;
        loop {
            match self.records.read(&record_id) {
                Err(_) => break,
                Ok(prior) => {
                    let same_identity = prior.plan_hash == plan.plan_hash
                        && prior.project_id == project.id
                        && prior.source.source_fingerprint == plan.source.source_fingerprint
                        && prior.source.risk_fingerprint == plan.source.risk_fingerprint;
                    if prior.status == vua_orchestrator::BuildRecordStatus::Succeeded
                        && same_identity
                    {
                        return MaterialExecutionReport {
                            plan_id: plan.plan_id.clone(),
                            correlation_id: confirmation.correlation_id.clone(),
                            status: MaterialExecutionStatus::Succeeded,
                            completed_steps: Vec::new(),
                            error_code: None,
                            rollback: RollbackOutcome::NotNeeded,
                            build_record_id: Some(record_id),
                            replayed: true,
                        };
                    }
                    attempt += 1;
                    record_id = format!("material-{}-attempt{}", plan.plan_id, attempt);
                }
            }
        }

        let mut report = MaterialExecutionReport {
            plan_id: plan.plan_id.clone(),
            correlation_id: confirmation.correlation_id.clone(),
            status: MaterialExecutionStatus::Succeeded,
            completed_steps: Vec::new(),
            error_code: None,
            rollback: RollbackOutcome::NotNeeded,
            build_record_id: None,
            replayed: false,
        };
        // 第 148 批真机风险修复（重试撞号）：Bridge 对 mutating 命令按
        // commandId 把成功回执持久化在 `<project>/.vua/bridge/completed/`
        // （快照作用域之外——回滚不清除它），同 commandId 同内容即回放既有
        // 成功收据而**不重执行**。plan_id 由计划内容派生（跨 attempt 相同）、
        // bridge_jobs.len() 每次 execute 从零起算——失败的 attempt 重试会
        // 与上一 attempt 撞出同 id：已完成包命中幽灵回放（文件已被回滚清掉
        // 但收据宣称成功），指纹链随即在新包上 stale_project 拒绝，重试
        // 永久卡死。修复：attempt > 1 时给命令 id 注入运行盐（首 attempt
        // 的 id 逐字节保持既有形态，既有行为零变化）；schema 对 commandId
        // 仅约束非空，C# 侧语法 `^[A-Za-z0-9_-]{1,128}$` 同样容纳。
        let run_tag = if attempt > 1 { format!("-r{attempt}") } else { String::new() };
        let mut bridge_jobs: Vec<BridgeJobEvidenceV01> = Vec::new();
        let started_at = self.clock.now_rfc3339();

        if token.is_cancelled() {
            report.status = MaterialExecutionStatus::Cancelled;
            report.error_code = Some(intake_codes::CANCELLED.to_owned());
            return report;
        }

        // VerifySource: recompute both digests before the first mutation.
        if let Err(error) = MaterialIntakeEngine
            .verify_source_unchanged(source_folder, &plan.source, &confirmation.correlation_id)
        {
            report.status = MaterialExecutionStatus::Failed;
            report.error_code = Some(error.code);
            return report;
        }
        report.completed_steps.push(MaterialIntakeStepKind::VerifySource);

        if token.is_cancelled() {
            report.status = MaterialExecutionStatus::Cancelled;
            report.error_code = Some(intake_codes::CANCELLED.to_owned());
            return report;
        }

        // CreateSnapshot: the minimum recovery point every mutating run owes
        // the user; the scope extends with the risk decision.
        // Attempt-unique: a prior failed attempt's recovery point must
        // stay on disk as its own audit trail.
        let snapshot_id = format!("{record_id}-recovery");
        let verified: VerifiedSnapshot = match self.snapshots.create_verified(
            project,
            &snapshot_id,
            &confirmation.snapshot_scopes(),
        ) {
            Ok(verified) => verified,
            Err(error) => {
                report.status = MaterialExecutionStatus::Failed;
                report.error_code = Some(format!("{}: {error}", error_codes::SNAPSHOT_FAILED));
                return report;
            }
        };
        let mut snapshot_evidence = BuildSnapshotEvidenceV01 {
            snapshot_id,
            verified: true,
            restore_attempted: false,
            restore_succeeded: None,
        };
        report.completed_steps.push(MaterialIntakeStepKind::CreateSnapshot);

        // Mutating body plus read-only validation. The Bridge fingerprint
        // CHAINS across mutating commands: every success returns the
        // project's next fingerprint, which the following command must
        // expect. Any failure routes through the rollback branch below.
        let mut current_fingerprint = plan.project_fingerprint.clone();
        let mut validation_expectations: Vec<String> = Vec::new();
        let mut final_fingerprint: Option<String> = None;
        let mut validation: Option<BuildValidationEvidenceV01> = None;
        let mut local_vpm: Option<vua_orchestrator::LocalVpmEvidenceV01> = None;

        // ProvisionProject (plan v0.2, conditional step): a target the plan
        // found unprovisioned is created through the VPM backend port AFTER
        // the recovery snapshot and BEFORE the first project mutation. The
        // executor re-checks the condition (the assembly run-step law): if
        // the project appeared between plan review and execution, creation
        // skips and the plan-time fingerprint chain continues unchanged.
        let failure: Option<StepFailure> =
            if plan
                .steps
                .iter()
                .any(|step| step.kind == MaterialIntakeStepKind::ProvisionProject)
            {
                match self.run_provision(
                    plan,
                    project,
                    token,
                    &mut current_fingerprint,
                    &mut bridge_jobs,
                ) {
                    Ok(()) => {
                        report.completed_steps.push(MaterialIntakeStepKind::ProvisionProject);
                        None
                    }
                    Err(failure) => Some(failure),
                }
            } else {
                None
            };

        let failure = if failure.is_some() {
            failure
        } else {
            match plan.mode {
            MaterialEntryMode::DirectUnityPackage => {
                match self.run_direct_imports(
                    plan,
                    source_folder,
                    project,
                    token,
                    &run_tag,
                    &mut current_fingerprint,
                    &mut bridge_jobs,
                    &mut final_fingerprint,
                    &mut validation_expectations,
                ) {
                    Ok(()) => {
                        report.completed_steps.push(MaterialIntakeStepKind::ImportUnityPackages);
                        None
                    }
                    Err(failure) => Some(failure),
                }
            }
            MaterialEntryMode::LocalReusableVpm => {
                match self.run_local_reusable(
                    confirmation,
                    source_folder,
                    project,
                    artifact_output_root,
                    token,
                    &mut bridge_jobs,
                    &mut local_vpm,
                    &mut validation_expectations,
                ) {
                    Ok(()) => {
                        report.completed_steps.extend([
                            MaterialIntakeStepKind::ImportUnityPackages,
                            MaterialIntakeStepKind::CreateLocalVpmPackage,
                            MaterialIntakeStepKind::PreviewVpmInstall,
                            MaterialIntakeStepKind::ApplyVpmInstall,
                        ]);
                        None
                    }
                    Err(failure) => Some(failure),
                }
            }
            }
        };

        let failure = match failure {
            Some(failure) => Some(failure),
            None => {
                if token.is_cancelled() {
                    Some((intake_codes::CANCELLED.to_owned(), MaterialExecutionStatus::Cancelled))
                } else {
                    match self.run_minimum_structure_validation(
                        project,
                        &validation_expectations,
                        &format!("{}-validate", plan.plan_id),
                        &mut bridge_jobs,
                    ) {
                        Ok(evidence) => {
                            report
                                .completed_steps
                                .push(MaterialIntakeStepKind::ValidateMinimumStructure);
                            validation = Some(evidence);
                            None
                        }
                        Err(code) => Some((code, MaterialExecutionStatus::Failed)),
                    }
                }
            }
        };

        // Failure rolls the verified snapshot back before anything else is
        // recorded; a failed restore is the worst outcome and STILL gets a
        // receipt — it must never bypass WriteBuildRecord.
        let failure = match failure {
            None => None,
            Some((code, run_status)) => {
                snapshot_evidence.restore_attempted = true;
                match self.snapshots.restore_verified(project, &verified.reference) {
                    Ok(()) => {
                        snapshot_evidence.restore_succeeded = Some(true);
                        report.rollback = RollbackOutcome::Restored;
                        Some((code, run_status))
                    }
                    Err(error) => {
                        snapshot_evidence.restore_succeeded = Some(false);
                        report.rollback = RollbackOutcome::Failed;
                        Some((
                            format!("{}: restore failed: {error}", error_codes::ROLLBACK_FAILED),
                            MaterialExecutionStatus::Failed,
                        ))
                    }
                }
            }
        };
        let (status, error_code) = match failure {
            None => (MaterialExecutionStatus::Succeeded, None),
            Some((code, run_status)) => (run_status, Some(code)),
        };
        report.status = status;
        report.error_code = error_code;

        // WriteBuildRecord: the receipt, published for success, cancellation
        // and failure alike — the record is what makes a later re-run a
        // replay instead of a blind second mutation.
        let record = BuildRecordV01 {
            schema_version: vua_orchestrator::BUILD_RECORD_SCHEMA_VERSION.to_owned(),
            record_id: record_id.clone(),
            task_id: confirmation.correlation_id.clone(),
            correlation_id: confirmation.correlation_id.clone(),
            plan_id: plan.plan_id.clone(),
            plan_hash: plan.plan_hash.clone(),
            mode: plan.mode,
            status: match report.status {
                MaterialExecutionStatus::Succeeded => BuildRecordStatus::Succeeded,
                MaterialExecutionStatus::Cancelled => BuildRecordStatus::Cancelled,
                MaterialExecutionStatus::Failed => BuildRecordStatus::Failed,
            },
            started_at,
            completed_at: self.clock.now_rfc3339(),
            source: plan.source.clone(),
            risk_choice: confirmation.risk_decision.choice,
            project_id: project.id.clone(),
            project_identity: vua_orchestrator::ProjectIdentity::from_existing_path(&project.root)
                .ok()
                .map(|identity| identity.as_str().to_owned()),
            recovered_from_record_id: None,
            recovery_decision_id: None,
            initial_project_fingerprint: plan.project_fingerprint.clone(),
            final_project_fingerprint: final_fingerprint,
            unity_editor_version: self.unity_editor_version.clone(),
            snapshot: Some(snapshot_evidence),
            bridge_jobs,
            local_vpm,
            validation,
            result_code: match report.status {
                MaterialExecutionStatus::Succeeded => "vua.material.succeeded".to_owned(),
                MaterialExecutionStatus::Cancelled => "vua.material.cancelled".to_owned(),
                MaterialExecutionStatus::Failed => "vua.material.failed".to_owned(),
            },
        };
        match self.records.publish(&record) {
            Ok(_) => {
                report.completed_steps.push(MaterialIntakeStepKind::WriteBuildRecord);
                report.build_record_id = Some(record_id);
            }
            Err(error) => {
                report.status = MaterialExecutionStatus::Failed;
                report.error_code = Some(format!("vua.material.record_failed: {error}"));
                report.build_record_id = None;
            }
        }
        report
    }

    // --- provision_project (plan v0.2) ---

    /// Creates the not-yet-provisioned target through the VPM backend port
    /// (E-VPM-DUAL: vrc-get lib template copy, or VCC `vpm new` — the
    /// vrc-get CLI has NO creation command, provision.rs Fix 4), then
    /// RESOLVES the SDK dependencies the fresh project declares (batch 146,
    /// user ruling 2026-09-21: SDK import before real-machine acceptance —
    /// the template's `Packages/vpm-manifest.json` declares
    /// `com.vrchat.base` / `com.vrchat.avatars`, but the pure template copy
    /// does not vendor the package bodies; without the resolve leg the first
    /// Unity launch sees a project missing its declared SDK). Three laws
    /// beyond the port calls:
    ///
    /// - Idempotent re-check (the assembly run-step law): a project that
    ///   appeared between plan review and execution skips creation AND skips
    ///   resolve — the plan-time fingerprint chain continues unchanged and
    ///   the already-provisioned path runs ZERO resolve calls (minimal blast
    ///   radius: the standing provisioning behavior on that path is exactly
    ///   what shipped before batch 146).
    /// - Resolve ordering: the resolve runs AFTER create_project succeeds
    ///   and BEFORE the baseline re-read, so the Unity-side fingerprint the
    ///   first mutating command binds covers the FINAL on-disk state (the
    ///   resolved package set included), never a pre-resolve snapshot.
    /// - Honest failure faces: a backend Err folds into the standing
    ///   `vua.material.provision_failed` arm carrying the backend's original
    ///   code in the message (the vua.vpm.* codes never replace the
    ///   vua.material.* family code); a receipt whose `failed` set is
    ///   non-empty is the resolve face's honest INCOMPLETE answer and fails
    ///   the same arm carrying the first dependency's reason code. Either
    ///   way the compensation is the empty-state snapshot taken before this
    ///   step: the restore moves the half-provisioned content into the
    ///   `.vua/recovery` quarantine (the assembly "delete the
    ///   half-initialized project and replan" semantics, through the same
    ///   verified-snapshot rollback every mutating run owes).
    fn run_provision(
        &self,
        plan: &crate::material_intake::MaterialIntakePlanV01,
        project: &ProjectRef,
        token: &MaterialCancelToken,
        current_fingerprint: &mut String,
        bridge_jobs: &mut Vec<BridgeJobEvidenceV01>,
    ) -> Result<(), StepFailure> {
        if project
            .root
            .join("ProjectSettings")
            .join("ProjectVersion.txt")
            .is_file()
        {
            return Ok(());
        }
        let parent = project.root.parent().ok_or_else(|| {
            (
                format!("{}: target has no parent directory", error_codes::PROVISION_FAILED),
                MaterialExecutionStatus::Failed,
            )
        })?;
        std::fs::create_dir_all(parent).map_err(|error| {
            (
                format!("{}: {error}", error_codes::PROVISION_FAILED),
                MaterialExecutionStatus::Failed,
            )
        })?;
        let name = project
            .root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "VUA-Project".to_owned());
        self.vpm
            .create_project(parent, &name, None)
            .map_err(|error| {
                let detail = error.params.as_ref().and_then(|params| params.get("reason").cloned());
                (
                    format!(
                        "{}: {}{}",
                        error_codes::PROVISION_FAILED,
                        error.code,
                        detail
                            .map(|value| match value {
                                vua_orchestrator::ParamValue::Text(reason) =>
                                    format!(": {reason}"),
                                other => format!(": {other:?}"),
                            })
                            .unwrap_or_default()
                    ),
                    MaterialExecutionStatus::Failed,
                )
            })?;
        // Cancellation observation between create and resolve (design
        // registration 2026-09-23-port-cancellation-points, slice S2): the
        // resolve leg is the material chain's only genuinely unbounded
        // operation, and the port face carries no token by design (frozen
        // word face; the lib backend is a physical non-cooperator anyway).
        // The executor closes the window instead: a cancellation decided
        // during create short-circuits here, BEFORE the network leg starts,
        // and rides the standing compensation — the Err joins the normal
        // failure arm, the pre-provision verified snapshot rolls the
        // half-provisioned content into the `.vua/recovery` quarantine, and
        // the Cancelled receipt publishes like any other exit.
        if token.is_cancelled() {
            return Err((intake_codes::CANCELLED.to_owned(), MaterialExecutionStatus::Cancelled));
        }
        // Resolve the declared SDK dependencies (batch 146): the network
        // segment is inherent to the face, and a backend without the face
        // answers the capability_missing family here — reported as a failed
        // provision, never papered over. The receipt's failed set is the
        // honest incomplete face: any entry fails the run.
        let receipt = self.vpm.resolve_project(&project.root).map_err(|error| {
            (
                format!("{}: {}", error_codes::PROVISION_FAILED, error.code),
                MaterialExecutionStatus::Failed,
            )
        })?;
        if let Some(first) = receipt.failed.first() {
            return Err((
                format!(
                    "{}: {}: {}",
                    error_codes::PROVISION_FAILED,
                    first.reason_code,
                    first.id
                ),
                MaterialExecutionStatus::Failed,
            ));
        }
        // Re-baseline: Unity's own view of the freshly created project. The
        // inspect is read-only (dry-run) and carries no expected fingerprint.
        // It stays AFTER the resolve: the baseline must cover the resolved
        // final state.
        let inspect = self.inspect(
            project,
            &format!("{}-provision-inspect", plan.plan_id),
            bridge_jobs,
        )?;
        let baseline = fingerprint_of(&inspect).ok_or_else(|| {
            (
                format!(
                    "{}: provisioned project reported no fingerprint",
                    error_codes::BRIDGE_FAILED
                ),
                MaterialExecutionStatus::Failed,
            )
        })?;
        *current_fingerprint = baseline;
        Ok(())
    }

    // --- direct_unity_package ---

    #[allow(clippy::too_many_arguments)]
    fn run_direct_imports(
        &self,
        plan: &crate::material_intake::MaterialIntakePlanV01,
        source_folder: &Path,
        project: &ProjectRef,
        token: &MaterialCancelToken,
        run_tag: &str,
        current_fingerprint: &mut String,
        bridge_jobs: &mut Vec<BridgeJobEvidenceV01>,
        final_fingerprint: &mut Option<String>,
        validation_expectations: &mut Vec<String>,
    ) -> Result<(), StepFailure> {
        // 第 158 批残留清理策略（BOARD #45(4)）：链开始前清走早前运行（进程
        // 死亡等无从接线者）留下的解包残留；本运行自己的解包根在每个错误/
        // 取消出口由 cleanup_import_extractions 接线回收——快照回滚只恢复
        // 作用域面，管不到 .vua/imports。
        sweep_stale_import_extractions(&project.root);
        let mut extracted_roots: Vec<PathBuf> = Vec::new();
        for package in &plan.source.packages {
            if token.is_cancelled() {
                cleanup_import_extractions(&mut extracted_roots);
                return Err((intake_codes::CANCELLED.to_owned(), MaterialExecutionStatus::Cancelled));
            }
            let command_id = format!("{}{}-import-{}", plan.plan_id, run_tag, bridge_jobs.len());
            // Unity's ImportPackage is a silent no-op in batchmode, so the
            // Bridge consumes an EXTRACTED layout instead: the archive is
            // unpacked under .vua/imports/<command_id>/ (inside the
            // snapshot-protected project) and the Bridge materializes it
            // into Assets/.
            let archive_path = source_folder.join(&package.relative_path);
            let archive_digest = match sha256_file(&archive_path) {
                Ok(digest) => digest,
                Err(error) => {
                    cleanup_import_extractions(&mut extracted_roots);
                    return Err((
                        format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                        MaterialExecutionStatus::Failed,
                    ));
                }
            };
            if archive_digest != package.sha256 {
                cleanup_import_extractions(&mut extracted_roots);
                return Err((intake_codes::SOURCE_DRIFT.to_owned(), MaterialExecutionStatus::Failed));
            }
            let extracted_root = project.root.join(".vua/imports").join(&command_id);
            let logical_paths = match extract_package_into_dir(&archive_path, &extracted_root) {
                Ok(paths) => paths,
                Err(error) => {
                    cleanup_import_extractions(&mut extracted_roots);
                    return Err((
                        format!(
                            "{}: {}: {error}",
                            intake_codes::ARCHIVE_INVALID,
                            archive_path.display()
                        ),
                        MaterialExecutionStatus::Failed,
                    ));
                }
            };
            extracted_roots.push(extracted_root.clone());
            validation_expectations.extend(logical_paths);
            // Bind the manifest's OWN digest into the command: the manifest
            // lives in the same editable directory as the files it describes,
            // so without this a files+manifest swap survives verification.
            let manifest_digest = match sha256_file(&extracted_root.join("manifest.sha256")) {
                Ok(digest) => digest,
                Err(error) => {
                    cleanup_import_extractions(&mut extracted_roots);
                    return Err((
                        format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                        MaterialExecutionStatus::Failed,
                    ));
                }
            };
            let command = UnityCommand {
                schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
                command_id,
                operation: UnityOperation::MaterializeExtractedPackage,
                project_id: project.id.clone(),
                dry_run: false,
                expected_project_fingerprint: Some(current_fingerprint.clone()),
                payload: UnityPayload {
                    source_package_path: Some(extracted_root.to_string_lossy().into_owned()),
                    source_package_sha256: Some(package.sha256.clone()),
                    manifest_sha256: Some(manifest_digest),
                    ..UnityPayload::default()
                },
            };
            let result = match self.dispatch(project, &command, bridge_jobs) {
                Ok(result) => result,
                Err(failure) => {
                    cleanup_import_extractions(&mut extracted_roots);
                    return Err(failure);
                }
            };
            let _ = fs::remove_dir_all(&extracted_root);
            extracted_roots.retain(|root| root != &extracted_root);
            // Chain: the next mutation must expect the post-import state. A
            // successful mutating command with NO fingerprint is receipt
            // shape drift (第 148 批诚实化): chaining the stale value would
            // either fail the next command with a confusing reject or — on
            // the last package — publish a FALSE final fingerprint in the
            // receipt. Fail here, honestly, and let the rollback restore.
            match fingerprint_of(&result) {
                Some(fingerprint) if !fingerprint.is_empty() => {
                    *current_fingerprint = fingerprint;
                }
                _ => {
                    cleanup_import_extractions(&mut extracted_roots);
                    return Err((
                        format!(
                            "{}: materialize reported no project fingerprint",
                            error_codes::BRIDGE_FAILED
                        ),
                        MaterialExecutionStatus::Failed,
                    ))
                }
            }
            *final_fingerprint = Some(current_fingerprint.clone());
        }
        validation_expectations.sort();
        validation_expectations.dedup();
        Ok(())
    }

    // --- local_reusable_vpm ---

    #[allow(clippy::too_many_arguments)]
    fn run_local_reusable(
        &self,
        confirmation: &MaterialIntakeConfirmationV01,
        source_folder: &Path,
        project: &ProjectRef,
        artifact_output_root: &Path,
        token: &MaterialCancelToken,
        bridge_jobs: &mut Vec<BridgeJobEvidenceV01>,
        local_vpm: &mut Option<vua_orchestrator::LocalVpmEvidenceV01>,
        validation_expectations: &mut Vec<String>,
    ) -> Result<(), StepFailure> {
        let plan = &confirmation.plan;
        // The staging project serves exactly one atomic task; the guard
        // destroys it on every path out of this scope. The staging token
        // binds the Bridge's create_local_vpm_package to THIS task.
        // 暂存项目骨架:生产默认用捆绑模板;本地真机 Harness 可通过
        // with_staging_template_override 注入含 Bridge 包与编译脚手架的
        // 覆盖模板。staging token 始终绑定本任务。
        let staging = match &self.staging_template_override {
            Some(template) => StagingProject::create_from_template(
                template,
                &self.temp_root,
                &confirmation.correlation_id,
                &confirmation.correlation_id,
            ),
            None => StagingProject::create(
                &self.temp_root,
                &confirmation.correlation_id,
                &confirmation.correlation_id,
            ),
        }
        .map_err(|error| {
            (format!("{}: {error}", error_codes::STAGING_FAILED), MaterialExecutionStatus::Failed)
        })?;
        let staging_project = ProjectRef {
            id: format!("{}-staging", plan.project_id),
            root: staging.root().to_path_buf(),
        };
        // 用户裁定：包机器 ID 走持久身份库（同目录稳定、同名文件夹自动
        // `名称 (2)`），而不是从显示名重新 slug。
        let identity = self
            .identity_store
            .resolve(source_folder, &plan.source.display_name)
            .map_err(|error| {
                (
                    format!("{}: {error}", error_codes::STAGING_FAILED),
                    MaterialExecutionStatus::Failed,
                )
            })?;
        let package_id = identity.package_id;

        // The fresh staging project needs its own fingerprint for its first
        // mutating command.
        let inspect =
            self.inspect(&staging_project, &format!("{}-stage-inspect", plan.plan_id), bridge_jobs)?;
        let mut staging_fingerprint = fingerprint_of(&inspect).ok_or_else(|| {
            (error_codes::BRIDGE_FAILED.to_owned(), MaterialExecutionStatus::Failed)
        })?;

        // Import the whole batch into staging (chained fingerprints).
        for package in &plan.source.packages {
            if token.is_cancelled() {
                return Err((intake_codes::CANCELLED.to_owned(), MaterialExecutionStatus::Cancelled));
            }
            let command_id = format!("{}-stage-import-{}", plan.plan_id, bridge_jobs.len());
            let archive_path = source_folder.join(&package.relative_path);
            let archive_digest = sha256_file(&archive_path).map_err(|error| {
                (
                    format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                    MaterialExecutionStatus::Failed,
                )
            })?;
            if archive_digest != package.sha256 {
                return Err((intake_codes::SOURCE_DRIFT.to_owned(), MaterialExecutionStatus::Failed));
            }
            let extracted_root = staging.root().join(".vua/imports").join(&command_id);
            extract_package_into_dir(&source_folder.join(&package.relative_path), &extracted_root)
                .map_err(|error| {
                    (
                        format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                        MaterialExecutionStatus::Failed,
                    )
                })?;
            let manifest_digest =
                sha256_file(&extracted_root.join("manifest.sha256")).map_err(|error| {
                    (
                        format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                        MaterialExecutionStatus::Failed,
                    )
                })?;
            let command = UnityCommand {
                schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
                command_id,
                operation: UnityOperation::MaterializeExtractedPackage,
                project_id: staging_project.id.clone(),
                dry_run: false,
                expected_project_fingerprint: Some(staging_fingerprint.clone()),
                payload: UnityPayload {
                    source_package_path: Some(extracted_root.to_string_lossy().into_owned()),
                    source_package_sha256: Some(package.sha256.clone()),
                    manifest_sha256: Some(manifest_digest),
                    ..UnityPayload::default()
                },
            };
            let result = self.dispatch(&staging_project, &command, bridge_jobs)?;
            // Same honesty law as the direct path (第 148 批): a successful
            // mutating command MUST name the project's new fingerprint — a
            // missing or empty one is receipt shape drift, never silently
            // chained over.
            match fingerprint_of(&result) {
                Some(fingerprint) if !fingerprint.is_empty() => {
                    staging_fingerprint = fingerprint;
                }
                _ => {
                    return Err((
                        format!(
                            "{}: stage materialize reported no project fingerprint",
                            error_codes::BRIDGE_FAILED
                        ),
                        MaterialExecutionStatus::Failed,
                    ))
                }
            }
        }

        // Produce the local-reusable package layout + manifest.
        let command_id = format!("{}-stage-vpm", plan.plan_id);
        let command = UnityCommand {
            schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
            command_id,
            operation: UnityOperation::CreateLocalVpmPackage,
            project_id: staging_project.id.clone(),
            dry_run: false,
            expected_project_fingerprint: Some(staging_fingerprint.clone()),
            payload: UnityPayload {
                package_id: Some(package_id.clone()),
                package_display_name: Some(identity.display_name.clone()),
                package_version: Some("0.1.0".to_owned()),
                staging_token: Some(confirmation.correlation_id.clone()),
                // Declarations flow verbatim from the plan's source
                // (vua-dependencies.json); the Bridge never guesses and the
                // executor never invents a dependency.
                package_dependencies: plan
                    .source
                    .declared_dependencies
                    .iter()
                    .map(|dependency| vua_orchestrator::UnityPackageDependency {
                        package_id: dependency.package_id.clone(),
                        version: dependency.version_range.clone(),
                    })
                    .collect(),
                ..UnityPayload::default()
            },
        };
        self.dispatch(&staging_project, &command, bridge_jobs)?;
        // The Bridge's changedPaths are TOP-LEVEL entries (Runtime/<name>,
        // Editor, package.json); a directory existing proves nothing about
        // the files inside it. The validation list below is therefore built
        // per-file from the published package tree instead.

        // Publish the produced package deterministically, then register and
        // install it into the target through the same backend.
        let artifact = crate::local_vpm_artifact::publish_local_vpm_artifact(
            &staging.root().join("Packages").join(&package_id),
            artifact_output_root,
            &package_id,
            "0.1.0",
        )
        .map_err(|error| {
            (format!("{}: {error}", error_codes::STAGING_FAILED), MaterialExecutionStatus::Failed)
        })?;

        // Every file the produced package carries must load in the target
        // after install — nested prefabs, materials, textures included.
        collect_package_files(&artifact.package_root, &package_id, validation_expectations)
            .map_err(|error| {
                (format!("{}: {error}", error_codes::STAGING_FAILED), MaterialExecutionStatus::Failed)
            })?;
        validation_expectations.sort();
        validation_expectations.dedup();

        // Cancellation observations in the register/preview/apply tail
        // (design registration 2026-09-23-port-cancellation-points, slice
        // S2, frozen discretion: the "skip the install" option). A cancel
        // request arriving during staging short-circuits BEFORE the target
        // is touched: registration, preview and install are all skipped and
        // the standing compensation runs. One honest fact both tail options
        // share: the published artifact lives OUTSIDE the project (the
        // output root), so the snapshot rollback cannot reach it — the
        // published files stay and the receipt says Cancelled, never
        // pretending the tail never ran.
        if token.is_cancelled() {
            return Err((intake_codes::CANCELLED.to_owned(), MaterialExecutionStatus::Cancelled));
        }
        self.vpm
            .register_local_package(&artifact.package_root)
            .map_err(|error| (error.code, MaterialExecutionStatus::Failed))?;
        let request = PackageRequestV1 {
            package_id: package_id.clone(),
            version: None,
        };
        let preview = self
            .vpm
            .preview_install(project, std::slice::from_ref(&request))
            .map_err(|error| (error.code, MaterialExecutionStatus::Failed))?;
        // Second tail observation: between preview and apply. The preview is
        // read-only; skipping the apply keeps the target free of an install
        // it would only have to be rolled back.
        if token.is_cancelled() {
            return Err((intake_codes::CANCELLED.to_owned(), MaterialExecutionStatus::Cancelled));
        }
        self.vpm
            .apply_install(project, std::slice::from_ref(&request), &preview.digest)
            .map_err(|error| (error.code, MaterialExecutionStatus::Failed))?;

        *local_vpm = Some(vua_orchestrator::LocalVpmEvidenceV01 {
            package_id,
            display_name: identity.display_name.clone(),
            version: "0.1.0".to_owned(),
            manifest_sha256: artifact.manifest_sha256,
            tree_sha256: artifact.tree_sha256,
            archive_sha256: artifact.archive_sha256,
            installed_version: "0.1.0".to_owned(),
        });
        Ok(())
    }

    // --- validate_minimum_structure ---

    fn run_minimum_structure_validation(
        &self,
        project: &ProjectRef,
        expected_asset_paths: &[String],
        command_id: &str,
        bridge_jobs: &mut Vec<BridgeJobEvidenceV01>,
    ) -> Result<BuildValidationEvidenceV01, String> {
        let command = UnityCommand {
            schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
            command_id: command_id.to_owned(),
            operation: UnityOperation::ValidateAssetPaths,
            project_id: project.id.clone(),
            dry_run: true,
            expected_project_fingerprint: None,
            payload: UnityPayload {
                expected_asset_paths: expected_asset_paths.to_vec(),
                ..UnityPayload::default()
            },
        };
        let result = self.dispatch(project, &command, bridge_jobs).map_err(|(code, _)| code)?;
        for diagnostic in &result.diagnostics {
            if diagnostic.severity == vua_orchestrator::DiagnosticSeverity::Error {
                return Err(format!("{}: {}", error_codes::BRIDGE_FAILED, diagnostic.code));
            }
        }
        // The validate op reports the loaded list through
        // data.loadedAssetPaths, not through changedPaths. The C# handler
        // (BridgeCommandProcessor::ValidateAssetPaths) stamps that list on
        // every Succeeded receipt, so a success without the field — or with
        // a non-string entry — is a receipt-shape breach. 第 158 批（BOARD
        // #45(2) 证据面收口）：the old `unwrap_or_default` fabricated an
        // empty list the Bridge never reported, recording "validated, zero
        // assets loaded" for a receipt that said nothing — an evidence face
        // lying by omission. The honest surface is a typed bridge_failed
        // that flows through the normal failure path (snapshot restore +
        // Failed receipt; the record's validation section stays None =
        // never claimed).
        let expected_assets_loaded = match loaded_asset_paths_evidence(&result.data) {
            Some(paths) => paths,
            None => {
                return Err(format!(
                    "{}: validate success carries no usable loadedAssetPaths evidence",
                    error_codes::BRIDGE_FAILED
                ));
            }
        };
        Ok(BuildValidationEvidenceV01 {
            level: "minimum_structure".to_owned(),
            unity_validated: true,
            expected_assets_loaded,
            diagnostic_codes: result
                .diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code.clone())
                .collect(),
        })
    }

    // --- B4 artifact-mode: generate-only VPM production ---

    /// Generates a local VPM package from a warehouse entry's original
    /// `.unitypackage` copies — the same staging → materialize → create →
    /// publish chain as `run_local_reusable`, minus the target install and
    /// validation (there is no target project: the warehouse entry IS the
    /// destination). Staging serves one atomic call (the guard destroys it
    /// on exit); the published artifact is deterministic and survives
    /// staging teardown. Cancellation is observed at package boundaries.
    pub fn generate_vpm_only(
        &self,
        originals: &[GenerateSourcePackage],
        display_name: &str,
        entry_folder: &Path,
        artifact_output_root: &Path,
        correlation_id: &str,
        token: &MaterialCancelToken,
    ) -> Result<GeneratedVpm, StepFailure> {
        let staging = StagingProject::create(&self.temp_root, correlation_id, correlation_id)
            .map_err(|error| {
                (format!("{}: {error}", error_codes::STAGING_FAILED), MaterialExecutionStatus::Failed)
            })?;
        let staging_project = ProjectRef {
            id: format!("{correlation_id}-staging"),
            root: staging.root().to_path_buf(),
        };
        // 用户裁定:包机器 ID 走持久身份库——入口文件夹即身份来源,同条目
        // 稳定、同名自动去重。
        let identity = self
            .identity_store
            .resolve(entry_folder, display_name)
            .map_err(|error| {
                (format!("{}: {error}", error_codes::STAGING_FAILED), MaterialExecutionStatus::Failed)
            })?;
        let package_id = identity.package_id;

        // The fresh staging project needs its own fingerprint for its first
        // mutating command (same chained-fingerprint discipline as intake).
        let inspect = self.inspect(
            &staging_project,
            &format!("{correlation_id}-stage-inspect"),
            &mut Vec::new(),
        )?;
        let mut staging_fingerprint = fingerprint_of(&inspect).ok_or_else(|| {
            (error_codes::BRIDGE_FAILED.to_owned(), MaterialExecutionStatus::Failed)
        })?;

        for (index, package) in originals.iter().enumerate() {
            if token.is_cancelled() {
                return Err((intake_codes::CANCELLED.to_owned(), MaterialExecutionStatus::Cancelled));
            }
            // Drift check against the copy row's recorded identity: the
            // warehouse original must be byte-identical to what BDL inspected.
            let archive_digest = sha256_file(&package.archive_path).map_err(|error| {
                (
                    format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                    MaterialExecutionStatus::Failed,
                )
            })?;
            if archive_digest != package.sha256 {
                return Err((intake_codes::SOURCE_DRIFT.to_owned(), MaterialExecutionStatus::Failed));
            }
            let command_id = format!("{correlation_id}-stage-import-{index}");
            let extracted_root = staging.root().join(".vua/imports").join(&command_id);
            extract_package_into_dir(&package.archive_path, &extracted_root).map_err(|error| {
                (
                    format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                    MaterialExecutionStatus::Failed,
                )
            })?;
            let manifest_digest =
                sha256_file(&extracted_root.join("manifest.sha256")).map_err(|error| {
                    (
                        format!("{}: {error}", intake_codes::ARCHIVE_INVALID),
                        MaterialExecutionStatus::Failed,
                    )
                })?;
            let command = UnityCommand {
                schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
                command_id,
                operation: UnityOperation::MaterializeExtractedPackage,
                project_id: staging_project.id.clone(),
                dry_run: false,
                expected_project_fingerprint: Some(staging_fingerprint.clone()),
                payload: UnityPayload {
                    source_package_path: Some(extracted_root.to_string_lossy().into_owned()),
                    source_package_sha256: Some(package.sha256.clone()),
                    manifest_sha256: Some(manifest_digest),
                    ..UnityPayload::default()
                },
            };
            let result = self.dispatch(&staging_project, &command, &mut Vec::new())?;
            // Same honesty law as the direct path (第 148 批): never chain a
            // missing fingerprint silently.
            match fingerprint_of(&result) {
                Some(fingerprint) if !fingerprint.is_empty() => {
                    staging_fingerprint = fingerprint;
                }
                _ => {
                    return Err((
                        format!(
                            "{}: stage materialize reported no project fingerprint",
                            error_codes::BRIDGE_FAILED
                        ),
                        MaterialExecutionStatus::Failed,
                    ))
                }
            }
        }

        // Produce the local-reusable package layout + manifest.
        let command_id = format!("{correlation_id}-stage-vpm");
        let command = UnityCommand {
            schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
            command_id,
            operation: UnityOperation::CreateLocalVpmPackage,
            project_id: staging_project.id.clone(),
            dry_run: false,
            expected_project_fingerprint: Some(staging_fingerprint.clone()),
            payload: UnityPayload {
                package_id: Some(package_id.clone()),
                package_display_name: Some(display_name.to_owned()),
                package_version: Some("0.1.0".to_owned()),
                staging_token: Some(correlation_id.to_owned()),
                ..UnityPayload::default()
            },
        };
        self.dispatch(&staging_project, &command, &mut Vec::new())?;

        // Publish deterministically into the caller's output root; the
        // artifact survives staging teardown (publish copies the tree out).
        let artifact = crate::local_vpm_artifact::publish_local_vpm_artifact(
            &staging.root().join("Packages").join(&package_id),
            artifact_output_root,
            &package_id,
            "0.1.0",
        )
        .map_err(|error| {
            (format!("{}: {error}", error_codes::STAGING_FAILED), MaterialExecutionStatus::Failed)
        })?;

        Ok(GeneratedVpm { package_id, artifact })
    }

    // --- port helpers ---

    fn inspect(
        &self,
        project: &ProjectRef,
        command_id: &str,
        bridge_jobs: &mut Vec<BridgeJobEvidenceV01>,
    ) -> Result<UnityResult, StepFailure> {
        let command = UnityCommand {
            schema_version: vua_orchestrator::ENVELOPE_SCHEMA_VERSION,
            command_id: command_id.to_owned(),
            operation: UnityOperation::InspectProject,
            project_id: project.id.clone(),
            dry_run: true,
            expected_project_fingerprint: None,
            payload: UnityPayload::default(),
        };
        self.dispatch(project, &command, bridge_jobs)
    }

    /// Dispatches one Bridge command and records its evidence. A non-success
    /// result becomes a failure carrying the stable code.
    fn dispatch(
        &self,
        project: &ProjectRef,
        command: &UnityCommand,
        bridge_jobs: &mut Vec<BridgeJobEvidenceV01>,
    ) -> Result<UnityResult, StepFailure> {
        match self.bridge.execute(project, command) {
            Ok(result) => {
                let failure = match result.status {
                    ResultStatus::Succeeded => None,
                    ResultStatus::Rejected => Some(error_codes::BRIDGE_REJECTED.to_owned()),
                    ResultStatus::Failed => Some(error_codes::BRIDGE_FAILED.to_owned()),
                };
                bridge_jobs.push(BridgeJobEvidenceV01 {
                    command_id: command.command_id.clone(),
                    operation: format!("{:?}", command.operation),
                    status: format!("{:?}", result.status),
                    changed_paths: result.changed_paths.clone(),
                    diagnostics: result.diagnostics.clone(),
                });
                match failure {
                    Some(code) => Err((code, MaterialExecutionStatus::Failed)),
                    None => Ok(result),
                }
            }
            Err(vua_orchestrator::BridgeError::TimedOut) => Err((
                error_codes::BRIDGE_TIMEOUT.to_owned(),
                MaterialExecutionStatus::Failed,
            )),
            Err(error) => Err((
                format!("{}: {error}", error_codes::BRIDGE_FAILED),
                MaterialExecutionStatus::Failed,
            )),
        }
    }
}

/// Unpacks a `.unitypackage` (tar.gz of `<guid>` folders carrying `asset`,
/// `asset.meta`, and `pathname`) verbatim into `extracted_root` and returns
/// the logical asset paths (`Assets/…`) recorded by the pathname entries.
/// Untrusted pathnames are skipped, not followed. An archive whose pathname
/// entries target `Packages/` is refused outright before anything lands on
/// disk — the material direct channel never writes the VPM channel's
/// territory (batch 150, operator ruling).
pub(crate) fn extract_package_into_dir(
    archive_path: &Path,
    extracted_root: &Path,
) -> std::io::Result<Vec<String>> {
        use flate2::read::GzDecoder;
        use std::fs::File;
        use std::io::Read;
        use tar::Archive;

    // Pass 1: map each guid folder to its logical asset path.
    let mut folders: Vec<(String, String)> = Vec::new();
    {
        let file = File::open(archive_path)?;
        let mut archive = Archive::new(GzDecoder::new(file));
        for entry in archive.entries()? {
            let mut entry = entry?;
            let entry_path = entry.path()?.to_string_lossy().replace('\\', "/");
            if let Some(guid) = entry_path.strip_suffix("/pathname") {
                let mut logical = String::new();
                entry.read_to_string(&mut logical)?;
                let logical = logical.trim().replace('\\', "/");
                // 第 150 批通道边界（操作者裁定）：素材直导通道不得静默写
                // 入 `Packages/`——那是 VPM 通道的领地，绕过 vpm-manifest
                // 追踪的写入违背单通道写模型。含 `Packages/` 条目的归档在
                // 解包第一遍即整体拒绝（先于任何落盘，零残留、零部分物
                // 化），错误按既有 `archive_invalid` 族上浮，零新码。
                // 第 158 批校准（#45 B 案先行注记，操作者裁决）：C# 物化面
                // MaterializeExtractedPackage 的条目跳过条件对 `Assets/` 与
                // `Packages/` 双前缀都接受——并非 Assets/-only；本臂与检查
                // 面预检双闸持守下，其 `Packages/` 接受子句链上不可达（休
                // 眠面，非 VPM 通道许可）。第 150 批终结的是分歧经链物化，
                // 不是 C# 面字母收窄；守卫句：移除任一闸口前必须先收窄
                // C# 面（协议本 material-intake 0.2.1 第 158 批注记同源）。
                // Ordinal 前缀与 C# 面 MaterializeExtractedPackage 条目跳
                // 过条件的判定逐字节同形。
                if logical.starts_with("Packages/") {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!(
                            "archive entry targets Packages/ (VPM channel boundary): {logical}"
                        ),
                    ));
                }
                if logical.starts_with("Assets/")
                    && !logical.split('/').any(|part| part.is_empty() || part == "..")
                {
                    folders.push((guid.to_owned(), logical));
                }
            }
        }
    }

    // Pass 2: dump the archive verbatim under extracted_root so the Bridge
    // can materialize each guid folder at its logical path.
    fs::create_dir_all(extracted_root)?;
    let mut manifest_lines: Vec<String> = Vec::new();
    {
        let file = File::open(archive_path)?;
        let mut archive = Archive::new(GzDecoder::new(file));
        for entry in archive.entries()? {
            let mut entry = entry?;
            let entry_path = entry.path()?.to_string_lossy().replace('\\', "/");
            // 第 148 批真机风险修复（zip-slip 的 tar 形态，Windows 变体）：
            // 条目名是**不可信数据**。除既有的 `..`／前导 `/` 跳过外，还必须
            // 拒绝任何带盘符前缀或根锚的路径——`Path::join` 对绝对路径是
            // **替换**语义，一个名为 `C:/Users/.../x` 的 tar 条目会原样写出
            // extracted_root 之外。判定按路径组件而非子串：Prefix／RootDir／
            // ParentDir 一律跳过（与"Untrusted pathnames are skipped, not
            // followed"的既有语义一致——跳过，不是失败；被跳过条目也不进
            // manifest，Bridge 端 VerifyAgainstManifest 因此天然拒绝它们
            // 参与物化）。
            if entry_path.contains("..")
                || entry_path.starts_with('/')
                || Path::new(&entry_path)
                    .components()
                    .any(|component| {
                        !matches!(
                            component,
                            std::path::Component::Normal(_) | std::path::Component::CurDir
                        )
                    })
            {
                continue;
            }
            let target = extracted_root.join(&entry_path);
            if entry.header().entry_type().is_dir() {
                fs::create_dir_all(target)?;
                continue;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let mut digest = String::new();
            for byte in hasher.finalize() {
                use std::fmt::Write as _;
                write!(&mut digest, "{byte:02x}").expect("writing to String");
            }
            manifest_lines.push(format!("sha256:{digest}  {entry_path}"));
            fs::write(target, &bytes)?;
        }
    }

    fs::write(
        extracted_root.join("manifest.sha256"),
        manifest_lines.join("
") + "
",
    )?;

    Ok(folders.into_iter().map(|(_, logical)| logical).collect())
}

/// SHA-256 of a file on disk — binds the extracted layout to the
/// digest-verified archive before any content reaches the Bridge.
/// Collects every file under the produced package as a project-relative
/// validation expectation (`Packages/<id>/<relative path>`), so the target
/// project's minimum-structure validation proves the INSTALLED TREE, not
/// just its top-level directories.
fn collect_package_files(
    package_root: &Path,
    package_id: &str,
    out: &mut Vec<String>,
) -> std::io::Result<()> {
    fn walk(dir: &Path, relative: &str, package_id: &str, out: &mut Vec<String>) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            let relative = if relative.is_empty() { name } else { format!("{relative}/{name}") };
            if path.is_dir() {
                walk(&path, &relative, package_id, out)?;
            } else if !relative.ends_with(".meta") {
                // .meta sidecars are not loadable assets — their integrity is
                // covered by the publish-time archive/tree digests, while
                // this list proves AssetDatabase loadability (F6 review: a
                // per-file list including .meta would always fail).
                out.push(format!("Packages/{package_id}/{relative}"));
            }
        }
        Ok(())
    }
    walk(package_root, "", package_id, out)
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(crate::material_intake::sha256_text(hasher.finalize().as_ref()))
}

fn fingerprint_of(result: &UnityResult) -> Option<String> {
    result
        .data
        .get("projectFingerprint")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

/// The `data.loadedAssetPaths` evidence face of a Succeeded ValidateAssetPaths
/// receipt: a JSON array of strings, or nothing usable. 第 158 批 honesty
/// pin: a missing field, a non-array value, or a single non-string entry all
/// return `None` so the caller fails honestly instead of recording a
/// fabricated empty loaded list.
fn loaded_asset_paths_evidence(data: &serde_json::Value) -> Option<Vec<String>> {
    let items = data.get("loadedAssetPaths")?.as_array()?;
    let mut loaded = Vec::with_capacity(items.len());
    for item in items {
        loaded.push(item.as_str()?.to_owned());
    }
    Some(loaded)
}

/// 第 158 批残留清理策略（BOARD #45(4)）：remove every stale extraction
/// under `<project>/.vua/imports` — the residue of runs that died between
/// extraction and cleanup, the one path no running code can ever clean.
/// Called at direct-chain start while the mutation gate (SQLite lease →
/// cross-profile project lock → pending-mutation marker) is held, so no
/// concurrent chain on the same project root can own entries here.
/// Deletion is honest, not evidence destruction: an extraction is
/// executor-owned temporary INPUT, byte-derivable from the plan's
/// sha256-pinned source archive; no build record and no snapshot manifest
/// references it (`.vua` sits outside the snapshot scopes); the mutation
/// OUTPUT it fed (Assets/Packages content) is what snapshots and the
/// recovery quarantine protect.
fn sweep_stale_import_extractions(project_root: &Path) {
    let imports_root = project_root.join(".vua").join("imports");
    let Ok(entries) = fs::read_dir(&imports_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let _ = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
    }
}

/// Best-effort removal of THIS run's extracted roots on a failure or
/// cancellation exit. The rollback branch restores only the manifest scopes
/// (Assets/Packages/ProjectSettings/vpm-manifest.json, plus UserSettings by
/// risk decision) — `.vua/imports` is outside every scope, so without this
/// wiring a failed run's extractions survive the otherwise-successful
/// restore as disk residue (第 158 批，BOARD #45(4) 回滚分支接线).
fn cleanup_import_extractions(extracted_roots: &mut Vec<PathBuf>) {
    for root in extracted_roots.drain(..) {
        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod probe {
    #[test]
    #[ignore = "manual probe: needs VUA_PROBE_ARCHIVE / VUA_PROBE_OUT"]
    fn probe_extract_real_archive() {
        let archive = std::path::PathBuf::from(std::env::var("VUA_PROBE_ARCHIVE").unwrap());
        let out = std::path::PathBuf::from(std::env::var("VUA_PROBE_OUT").unwrap());
        match super::extract_package_into_dir(&archive, &out) {
            Ok(paths) => println!("OK {} logical paths, first: {:?}", paths.len(), paths.first()),
            Err(e) => println!("ERR io={e} raw_os_error={:?}", e.raw_os_error()),
        }
    }
}

#[cfg(test)]
mod batch148_extraction_guard {
    //! 第 148 批真机风险修复的守卫钉：tar 条目名是不可信数据，任何
    //! 盘符前缀／根锚／`..` 组件都不得把解包写引出 extracted_root
    //! （`Path::join` 对绝对路径是替换语义——Windows 变体的 zip-slip）。

    use flate2::write::GzEncoder;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 手工拼 ustar 头写入任意条目名——tar-rs 的构造 API（append_data／
    /// set_path）强制相对路径，而被测的解包面要防的正是真实恶意归档里的
    /// 绝对路径条目，守卫测试必须能构造它们。
    fn raw_entry(tar: &mut Vec<u8>, path: &str, bytes: &[u8]) {
        let name = path.as_bytes();
        assert!(name.len() <= 100, "test entries stay in the ustar name field");
        let mut header = [0_u8; 512];
        header[..name.len()].copy_from_slice(name);
        header[100..108].copy_from_slice(b"0000644\0");
        header[108..116].copy_from_slice(b"0000000\0");
        header[116..124].copy_from_slice(b"0000000\0");
        header[124..136].copy_from_slice(format!("{:011o}\0", bytes.len()).as_bytes());
        header[136..148].copy_from_slice(b"00000000000\0");
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        for byte in &mut header[148..156] {
            *byte = b' ';
        }
        let sum: u32 = header.iter().map(|byte| u32::from(*byte)).sum();
        header[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        tar.extend_from_slice(&header);
        tar.extend_from_slice(bytes);
        let padding = (512 - bytes.len() % 512) % 512;
        tar.extend(std::iter::repeat_n(0_u8, padding));
    }

    fn write_gztar(path: &std::path::Path, entries: &[(&str, &[u8])]) {
        let mut tar = Vec::new();
        for (entry_path, bytes) in entries {
            raw_entry(&mut tar, entry_path, bytes);
        }
        tar.extend(std::iter::repeat_n(0_u8, 1024));
        let file = fs::File::create(path).unwrap();
        let mut encoder = GzEncoder::new(file, flate2::Compression::default());
        std::io::Write::write_all(&mut encoder, &tar).unwrap();
        encoder.finish().unwrap();
    }

    #[test]
    fn untrusted_absolute_entry_paths_never_escape_the_extraction_root() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!("vua-148-escape-{nanos}"));
        let extracted_root = base.join("extracted");
        fs::create_dir_all(&extracted_root).unwrap();

        // The escape canary: an ABSOLUTE target outside extracted_root, built
        // from the real temp dir so the "C:/..." join-replaces-base case is
        // exercised hermetically. The unique suffix is kept short so the
        // whole name stays inside the ustar name field.
        let escape_dir = std::env::temp_dir().join(format!(
            "vua148c{:08x}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos() as u32
        ));
        let escape_entry = format!(
            "{}/evil.txt",
            escape_dir.to_string_lossy().replace('\\', "/")
        );

        let guid = "0123456789abcdef0123456789abcdef";
        let archive_path = base.join("hostile.unitypackage");
        write_gztar(
            &archive_path,
            &[
                (&format!("{guid}/pathname"), b"Assets/OK.prefab\n".as_slice()),
                (&format!("{guid}/asset"), b"synthetic".as_slice()),
                (&format!("{guid}/asset.meta"), b"meta".as_slice()),
                (escape_entry.as_str(), b"escaped".as_slice()),
                ("../outside.txt", b"escaped".as_slice()),
                ("/root-anchored.txt", b"escaped".as_slice()),
            ],
        );

        let logical =
            super::extract_package_into_dir(&archive_path, &extracted_root).expect("extracts");

        // The valid layout lands; logical paths come from pathname files only.
        assert_eq!(logical, vec!["Assets/OK.prefab".to_owned()]);
        assert!(extracted_root.join(guid).join("asset").is_file());

        // Every hostile entry is skipped: never written, never manifested.
        assert!(!escape_dir.exists(), "drive-absolute entry escaped the root");
        assert!(!base.join("outside.txt").exists(), "`..` entry escaped the root");
        let manifest = fs::read_to_string(extracted_root.join("manifest.sha256")).unwrap();
        assert_eq!(manifest.lines().count(), 3, "only the guid entries manifest");
        assert!(!manifest.contains("evil.txt"));
        assert!(!manifest.contains("outside.txt"));
        assert!(!manifest.contains("root-anchored.txt"));

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&escape_dir);
    }
}

#[cfg(test)]
mod batch150_channel_boundary {
    //! 第 150 批通道边界钉（操作者裁定）：含 `Packages/` 条目的归档在解包
    //! 第一遍即**整体**拒绝——先于任何落盘（零残留、零部分物化），错误按
    //! 既有 `archive_invalid` 族上浮、零新码。素材直导通道不得静默写入
    //! VPM 包域。第 158 批校准（#45 B 案先行注记）：C# 物化面在代码里对
    //! `Assets/`/`Packages/` 双前缀都接受（BridgeCommandProcessor 的
    //! MaterializeExtractedPackage 条目跳过条件），并非 Assets/-only——
    //! 本钉与检查面预检共同持有边界后，其 `Packages/` 接受子句链上不可
    //! 达（休眠面）；本钉即该不可达性的仓内检验载体，删除本钉或任一闸
    //! 口前必须先收窄 C# 面（守卫句，同协议本 0.2.1 第 158 批注记）。

    use flate2::write::GzEncoder;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn guid_archive(path: &std::path::Path, folders: &[(&str, &str)]) {
        let file = fs::File::create(path).unwrap();
        let mut builder = tar::Builder::new(GzEncoder::new(file, flate2::Compression::default()));
        for (guid, logical) in folders {
            for (suffix, bytes) in [
                ("pathname", format!("{logical}\n").into_bytes()),
                ("asset", b"synthetic".to_vec()),
                ("asset.meta", b"meta".to_vec()),
            ] {
                let mut header = tar::Header::new_gnu();
                header.set_size(bytes.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder
                    .append_data(&mut header, format!("{guid}/{suffix}"), &bytes[..])
                    .unwrap();
            }
        }
        builder.finish().unwrap();
    }

    fn fresh_base(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("vua-150-boundary-{label}-{nanos}"))
    }

    #[test]
    fn packages_prefixed_archive_is_refused_before_anything_lands() {
        let base = fresh_base("pure-packages");
        let extracted_root = base.join("extracted");
        let archive = base.join("pack.unitypackage");
        fs::create_dir_all(&base).unwrap();
        guid_archive(&archive, &[("0123456789abcdef0123456789abcdef", "Packages/com.evil/thing.asset")]);

        let error = super::extract_package_into_dir(&archive, &extracted_root)
            .expect_err("a Packages/-targeting archive is refused at the channel boundary");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(
            error.to_string().contains("Packages/"),
            "the refusal names the boundary: {error}"
        );
        // Pass 1 fails BEFORE pass 2: nothing is created, nothing extracted.
        assert!(
            !extracted_root.exists(),
            "no extraction residue may exist for a refused archive"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn mixed_assets_and_packages_archive_is_refused_whole_never_partially() {
        let base = fresh_base("mixed");
        let extracted_root = base.join("extracted");
        let archive = base.join("pack.unitypackage");
        fs::create_dir_all(&base).unwrap();
        guid_archive(
            &archive,
            &[
                ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Assets/OK.prefab"),
                ("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Packages/com.x/y.png"),
            ],
        );

        let error = super::extract_package_into_dir(&archive, &extracted_root)
            .expect_err("one Packages/ entry refuses the WHOLE archive — no silent partial import");
        assert!(error.to_string().contains("Packages/com.x/y.png"));
        assert!(
            !extracted_root.exists(),
            "the Assets/ sibling must not materialize either"
        );

        let _ = fs::remove_dir_all(&base);
    }
}

//! Assembly engine (E-ASSEMBLE smoke, O6/O7 minimal): one Avatar + one outfit
//! end to end — Recipe v0.2 → assembly plan → hash-bound confirmation →
//! verified snapshot → provisioning + package install → Unity Bridge
//! batchmode steps → domain validate → completion marker.
//!
//! Scope guards (agile plan): only `install_modular_asset` relations and
//! wardrobe toggles are plannable here; other v0.2 relation kinds produce a
//! blocking `recipe.relation_unsupported` issue instead of being silently
//! skipped. The completion marker (`.vua/assembly/<planId>.done.json`) is
//! an internal idempotency record, not the Build Record format (D-BR).
//!
//! # 中文逐段讲解（E-ASSEMB 审阅）
//!
//! 装配引擎是前四个切片的总装台：E-RECIPE 的派生结果在这里变成计划，
//! E-PKG 的 ProcessRunner/快照/VpmEngine 在这里干活，E-S0 的任务运行时
//! 在外面驱动它。整个流程八步一条线：
//!
//! 派生计划——`derive_plan` 按配方生成有序步骤：项目不存在就先
//! `ProvisionProject`（条件化：已存在则跳过，计划内容因此不同、哈希不同），
//! 然后 `InstallPackages`，六个 Bridge 步骤（检查/识别/MA 安装/菜单开关/
//! 验证/性能），每步带变更标志、超时预算、补偿方式。范围外的关系
//! （挂骨骼、排除对象等）显式产出阻断 issue——宁可不支持也不静默跳过。
//!
//! 确认——`confirm` 与 VpmEngine 同款：从计划内容重算哈希，防篡改
//! （ORC-WF-003）。
//!
//! 执行前的三道门——`execute` 依次核对：摘要绑定（传入的 recipe 文档
//! 哈希必须与计划时一致，配方被改过即漂移）、受控项目树指纹（Assets、
//! Packages、ProjectSettings 与 VPM manifest 必须与计划时一致）、完成
//! marker（同一计划已成功过 → 显式 noop，
//! 零调用）。然后对已存在项目做验证过的范围快照——新项目没有可保护
//! 的东西，跳过快照直接创建。
//!
//! 步骤执行——`run_steps` 按序推进：provision 走选定的项目创建后端；
//! 所有包交给 vrc-get 库一次联合计算并应用（VCC 可只承担创建/登记）；
//! 用户确认的是联合变更摘要。装包完成后取新的
//! Unity 返回的语义场景指纹作为下一条 Bridge 命令的
//! `expectedProjectFingerprint`——Unity 侧据此校验"我看到的场景和上一
//! 步成功结果一致"；Bridge 步骤构造
//! `UnityCommand`（command_id = 计划哈希+序号，dry_run=不变更步骤），
//! 经 `UnityBridge` 端口执行，回包必须 commandId 匹配且状态 succeeded，
//! 否则按失败处理（ORC-WF-008/009）。
//!
//! 失败恢复——任何一步失败：既有项目从验证快照自动恢复
//! （`restore_verified`）；本轮新建的项目安全删除。恢复结果以 progress
//! 事件上报；恢复本身失败返回独立的
//! `rollback_failed` 并携带原始错误码——恢复失败永远不伪装成原任务
//! 失败（ORC-WF-010）。成功则原子写入完成 marker（临时文件+rename），
//! 同一计划重复执行时在第一道门直接 noop 返回（ORC-WF-011）。
//!
//! 诚实边界：payload 里的对象名来自实例的 label/nameHint，缺失时回退
//! 实例 ID——精确的 Unity 对象绑定要等 Local Resolution；Unity 侧的
//! 幂等（不重复创建 MA 组件）由 Unity 包负责，引擎用 marker 保证
//! 整计划级不重跑。

use crate::contracts::{AppErrorV1, ErrorCategory, ParamValue};
use crate::filesystem::{project_tree_fingerprint, FileSystemSnapshotStore};
use crate::recipe::{
    derive_project_spec, document_digest, DerivedProjectSpecV1, IssueAction, IssueActionKind,
    IssueSeverity, IssueSubject, RecipeIssue, RecipeV02, RelationV02,
};
use crate::time::Clock;
use crate::vpm_backend::{PackageRequestV1, VpmBackend};
use crate::{
    ProjectRef, SnapshotRef, TaskContext, UnityCommand, UnityOperation, UnityPayload, UnityResult,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Stable assembly error codes (ORC-ERR-001). Owned by this module.
pub mod error_codes {
    pub const DRIFT: &str = "vua.assembly.drift";
    pub const PLAN_HASH_MISMATCH: &str = "vua.assembly.plan_hash_mismatch";
    pub const SNAPSHOT_FAILED: &str = "vua.assembly.snapshot_failed";
    pub const PROVISION_FAILED: &str = "vua.assembly.provision_failed";
    pub const PACKAGES_FAILED: &str = "vua.assembly.packages_failed";
    pub const UNITY_FAILED: &str = "vua.assembly.unity_failed";
    pub const UNITY_TIMEOUT: &str = "vua.assembly.unity_timeout";
    pub const VALIDATE_FAILED: &str = "vua.assembly.validate_failed";
    pub const ROLLBACK_FAILED: &str = "vua.assembly.rollback_failed";
    pub const MARKER_FAILED: &str = "vua.assembly.marker_failed";
}

#[derive(Debug)]
pub enum BridgeError {
    Io(io::Error),
    UnityFailed(Option<i32>),
    /// The Unity process hit its wall-clock budget and was killed.
    TimedOut,
    /// The caller asked to stop, and the Unity process tree was ended.
    Cancelled,
    MissingResult,
    InvalidResult(serde_json::Error),
}

impl Display for BridgeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(_) => write!(formatter, "bridge file operation failed"),
            Self::UnityFailed(code) => write!(formatter, "Unity exited unsuccessfully ({code:?})"),
            Self::TimedOut => write!(formatter, "Unity did not finish within the budget"),
            Self::Cancelled => write!(formatter, "Unity was stopped on request"),
            Self::MissingResult => write!(formatter, "Unity did not write a bridge result"),
            Self::InvalidResult(_) => write!(formatter, "Unity wrote an invalid bridge result"),
        }
    }
}

impl std::error::Error for BridgeError {}

impl From<io::Error> for BridgeError {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}

/// The Unity execution port; fakes implement this for consumer tests
/// (ORC-DEV-003), the batchmode bridge implements it in production.
pub trait UnityBridge: Send + Sync {
    fn execute(
        &self,
        project: &ProjectRef,
        command: &UnityCommand,
    ) -> Result<UnityResult, BridgeError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssemblyOperation {
    ProvisionProject,
    InstallPackages,
    BridgeInspect,
    BridgeIdentifyAssets,
    BridgeInstallModularAsset,
    BridgeCreateToggle,
    BridgeValidateAvatar,
    BridgeAnalyzePerformance,
}

impl AssemblyOperation {
    fn unity_operation(self) -> Option<UnityOperation> {
        match self {
            Self::BridgeInspect => Some(UnityOperation::InspectProject),
            Self::BridgeIdentifyAssets => Some(UnityOperation::IdentifyAssets),
            Self::BridgeInstallModularAsset => Some(UnityOperation::InstallOutfit),
            Self::BridgeCreateToggle => Some(UnityOperation::CreateToggle),
            Self::BridgeValidateAvatar => Some(UnityOperation::ValidateAvatar),
            Self::BridgeAnalyzePerformance => Some(UnityOperation::AnalyzePerformance),
            Self::ProvisionProject | Self::InstallPackages => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssemblyStepV1 {
    pub operation: AssemblyOperation,
    pub description: String,
    pub mutates_project: bool,
    pub timeout_secs: u64,
    pub compensation: String,
}

/// The complete assembly plan (O5 minimal content).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssemblyPlanV1 {
    pub plan_id: String,
    pub plan_hash: String,
    pub recipe_id: String,
    pub recipe_revision: u64,
    pub document_digest: String,
    pub project_id: String,
    pub project_root: String,
    /// Fingerprint of `vpm-manifest.json` at plan time; `None` plans a fresh
    /// project. Execution refuses drift in either direction (ORC-WF-004).
    pub project_fingerprint: Option<String>,
    pub required_capabilities: Vec<String>,
    pub steps: Vec<AssemblyStepV1>,
    /// 所有直接请求包在同一基线上计算出的完整变更预览。一个摘要覆盖
    /// 包之间的依赖、升级、移除与冲突交互，避免逐包预览遗漏组合效应。
    pub package_preview: Option<PackagePreviewV1>,
}

/// 固化进计划的包变更预览（摘要 + 完整条目）。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePreviewV1 {
    pub requests: Vec<PackageRequestV1>,
    pub digest: String,
    pub items: Vec<crate::vpm_backend::ChangeItemV1>,
    pub conflicts: Vec<String>,
    pub remove_legacy_files: Vec<String>,
    pub remove_legacy_folders: Vec<String>,
    pub destructive: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AssemblyConfirmation {
    pub plan: AssemblyPlanV1,
    pub confirmed_at: String,
    pub correlation_id: String,
}

const SNAPSHOT_SCOPES: [&str; 4] = ["Assets", "Packages", "ProjectSettings", "vpm-manifest.json"];

pub struct AssemblyEngine {
    bridge: Arc<dyn UnityBridge>,
    project_backend: Arc<dyn VpmBackend>,
    package_backend: Arc<dyn VpmBackend>,
    snapshots: FileSystemSnapshotStore,
    clock: Arc<dyn Clock>,
    project_id: String,
    project_root: PathBuf,
}

impl AssemblyEngine {
    pub fn new(
        bridge: Arc<dyn UnityBridge>,
        backend: Arc<dyn VpmBackend>,
        clock: Arc<dyn Clock>,
        project_id: impl Into<String>,
        project_root: impl Into<PathBuf>,
    ) -> Self {
        Self::with_backends(
            bridge,
            backend.clone(),
            backend,
            clock,
            project_id,
            project_root,
        )
    }

    /// Uses independent capability providers: VCC may create/register the
    /// project while the vrc-get library owns preview-bound package changes.
    pub fn with_backends(
        bridge: Arc<dyn UnityBridge>,
        project_backend: Arc<dyn VpmBackend>,
        package_backend: Arc<dyn VpmBackend>,
        clock: Arc<dyn Clock>,
        project_id: impl Into<String>,
        project_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            bridge,
            project_backend,
            package_backend,
            snapshots: FileSystemSnapshotStore,
            clock,
            project_id: project_id.into(),
            project_root: project_root.into(),
        }
    }

    /// Pure plan derivation (ORC-WF-001/002): ordered steps with mutation
    /// flags and compensation notes, content-hashed for confirm binding.
    pub fn derive_plan(
        &self,
        spec: &DerivedProjectSpecV1,
        recipe: &RecipeV02,
    ) -> Result<AssemblyPlanV1, Vec<RecipeIssue>> {
        let mut install_relations: Vec<String> = Vec::new();
        for relation in &recipe.relations {
            match relation {
                RelationV02::InstallModularAsset {
                    id,
                    asset_instance_id,
                    ..
                } => {
                    install_relations.push(asset_instance_id.clone());
                    let _ = id;
                }
                RelationV02::AttachToBone { id, .. }
                | RelationV02::ExcludeObject { id, .. }
                | RelationV02::SetObjectActive { id, .. } => {
                    return Err(vec![blocking_issue(
                        id,
                        "recipe.relation_unsupported",
                        "errors.recipe.relationUnsupported",
                        vec![],
                    )]);
                }
            }
        }

        let mut steps: Vec<AssemblyStepV1> = Vec::new();
        let provisioned = self
            .project_root
            .join("ProjectSettings/ProjectVersion.txt")
            .is_file();
        if !provisioned {
            steps.push(AssemblyStepV1 {
                operation: AssemblyOperation::ProvisionProject,
                description: format!(
                    "通过 vrc-get 创建项目 {}（已存在则跳过）",
                    self.project_root.display()
                ),
                mutates_project: true,
                timeout_secs: 600,
                compensation: "删除半初始化项目目录后重新计划".to_owned(),
            });
        }
        steps.push(AssemblyStepV1 {
            operation: AssemblyOperation::InstallPackages,
            description: format!("安装 {} 个 VPM 包", spec.packages.len()),
            mutates_project: true,
            timeout_secs: 600,
            compensation: "恢复项目快照并重新计划".to_owned(),
        });
        steps.push(AssemblyStepV1 {
            operation: AssemblyOperation::BridgeInspect,
            description: "检查 Unity 项目状态".to_owned(),
            mutates_project: false,
            timeout_secs: 1200,
            compensation: "人工诊断".to_owned(),
        });
        steps.push(AssemblyStepV1 {
            operation: AssemblyOperation::BridgeIdentifyAssets,
            description: "确认 Avatar 与衣装入口".to_owned(),
            mutates_project: false,
            timeout_secs: 1200,
            compensation: "人工诊断".to_owned(),
        });
        for asset_instance_id in &install_relations {
            steps.push(AssemblyStepV1 {
                operation: AssemblyOperation::BridgeInstallModularAsset,
                description: format!("用 Modular Avatar 安装衣装入口 {asset_instance_id}"),
                mutates_project: true,
                timeout_secs: 1200,
                compensation: "恢复项目快照".to_owned(),
            });
        }
        for group in &recipe.wardrobe_groups {
            steps.push(AssemblyStepV1 {
                operation: AssemblyOperation::BridgeCreateToggle,
                description: format!("创建衣装切换菜单 {}", group.label),
                mutates_project: true,
                timeout_secs: 1200,
                compensation: "恢复项目快照".to_owned(),
            });
        }
        steps.push(AssemblyStepV1 {
            operation: AssemblyOperation::BridgeValidateAvatar,
            description: "验证组装结果".to_owned(),
            mutates_project: false,
            timeout_secs: 1200,
            compensation: "人工诊断".to_owned(),
        });
        steps.push(AssemblyStepV1 {
            operation: AssemblyOperation::BridgeAnalyzePerformance,
            description: "生成性能报告".to_owned(),
            mutates_project: false,
            timeout_secs: 1200,
            compensation: "人工诊断".to_owned(),
        });

        // R2-1/P1-A: every requested package is resolved in one operation so
        // the plan covers cross-package interactions. For a fresh target the
        // package backend previews against an isolated copy of the same
        // Avatar template that project creation will use.
        let requests: Vec<PackageRequestV1> = spec
            .packages
            .iter()
            .map(|package| PackageRequestV1 {
                package_id: package.package_id.clone(),
                version: package.locked_version.clone(),
            })
            .collect();
        let package_preview = if requests.is_empty() {
            None
        } else {
            let preview = self
                .package_backend
                .preview_install_for_plan(
                    &crate::ProjectRef {
                        id: spec.recipe_id.clone(),
                        root: self.project_root.clone(),
                    },
                    &requests,
                    None,
                )
                .map_err(|error| {
                    vec![blocking_issue(
                        "packages",
                        "recipe.package_preview_failed",
                        "errors.recipe.packagePreviewFailed",
                        vec![("reason", error.code.clone())],
                    )]
                })?;
            Some(PackagePreviewV1 {
                requests,
                digest: preview.digest,
                items: preview.items,
                conflicts: preview.conflicts,
                remove_legacy_files: preview.remove_legacy_files,
                remove_legacy_folders: preview.remove_legacy_folders,
                destructive: preview.destructive,
            })
        };

        let plan = AssemblyPlanV1 {
            plan_id: String::new(),
            plan_hash: String::new(),
            recipe_id: spec.recipe_id.clone(),
            recipe_revision: spec.recipe_revision,
            document_digest: spec.document_digest.clone(),
            project_id: self.project_id.clone(),
            project_root: self.project_root.to_string_lossy().into_owned(),
            project_fingerprint: project_fingerprint(&self.project_root).map_err(|error| {
                vec![blocking_issue(
                    "project",
                    "recipe.project_fingerprint_failed",
                    "errors.recipe.projectFingerprintFailed",
                    vec![("reason", error.to_string())],
                )]
            })?,
            required_capabilities: spec.required_capabilities.clone(),
            steps,
            package_preview,
        };
        let bytes = serde_json::to_vec(&plan_content(&plan)).map_err(|error| {
            vec![blocking_issue(
                "plan",
                "recipe.plan_serialize_failed",
                "errors.recipe.serializeFailed",
                vec![("reason", error.to_string())],
            )]
        })?;
        let plan_hash = crate::vpm::fnv1a_hex(&bytes);
        Ok(AssemblyPlanV1 {
            plan_id: format!("plan-{plan_hash}"),
            plan_hash,
            ..plan
        })
    }

    /// Confirms the exact plan hash; the hash is recomputed from content so
    /// tampered plans are rejected even with the recorded hash (ORC-WF-003).
    pub fn confirm(
        &self,
        plan: &AssemblyPlanV1,
        presented_hash: &str,
    ) -> Result<AssemblyConfirmation, AppErrorV1> {
        let correlation = format!("corr-{}", plan.plan_id);
        let bytes = serde_json::to_vec(&plan_content(plan))
            .map_err(|error| internal_error(&correlation, &error))?;
        let recomputed = crate::vpm::fnv1a_hex(&bytes);
        if presented_hash != recomputed || plan.plan_hash != recomputed {
            return Err(AppErrorV1::new(
                error_codes::PLAN_HASH_MISMATCH,
                ErrorCategory::Conflict,
                "errors.assembly.planHashMismatch",
                correlation,
            ));
        }
        Ok(AssemblyConfirmation {
            plan: plan.clone(),
            confirmed_at: self.clock.now_rfc3339(),
            correlation_id: correlation,
        })
    }

    /// Executes a confirmed plan. Steps run in order on the task worker
    /// thread; every failure rolls the verified snapshot back before the
    /// typed error leaves the engine (ORC-WF-005, ORC-WF-010). The recipe
    /// reference is bound by digest: a recipe that no longer matches the
    /// confirmed plan is drift.
    pub fn execute(
        &self,
        confirmation: &AssemblyConfirmation,
        recipe: &RecipeV02,
        context: Option<&TaskContext>,
    ) -> Result<Value, AppErrorV1> {
        let plan = &confirmation.plan;
        let correlation = confirmation.correlation_id.clone();

        // Recipe binding: the live document digest must equal the planned one.
        let live_digest = document_digest(recipe)?;
        if live_digest != plan.document_digest || recipe.revision != plan.recipe_revision {
            return Err(AppErrorV1::new(
                error_codes::DRIFT,
                ErrorCategory::Conflict,
                "errors.assembly.drift",
                correlation.clone(),
            )
            .with_recoverable(true));
        }
        let spec = derive_project_spec(recipe, &plan.document_digest)
            .map_err(|issues| drift_from_issues(&correlation, &issues))?;

        // Idempotency: a completed plan replays as an explicit no-op
        // only while the current project still matches the post-build
        // fingerprint recorded by that marker (ORC-WF-011 / R2-4).
        let marker = self.marker_path(&plan.plan_id);
        if self.marker_matches_current_project(&marker, plan, &correlation)? {
            return Ok(json!({
                "noop": true,
                "planId": plan.plan_id,
                "recipeId": plan.recipe_id,
                "recipeRevision": plan.recipe_revision,
            }));
        }

        // Drift gate: live manifest fingerprint must equal the plan's.
        let live = project_fingerprint(&self.project_root)
            .map_err(|error| project_fingerprint_error(&correlation, &error))?;
        if live != plan.project_fingerprint {
            return Err(AppErrorV1::new(
                error_codes::DRIFT,
                ErrorCategory::Conflict,
                "errors.assembly.drift",
                correlation.clone(),
            )
            .with_recoverable(true));
        }

        // Verified snapshot only protects a project that already exists;
        // provisioning a fresh directory has nothing to destroy (ORC-WF-005).
        // 快照 ID 带尝试唯一后缀（Fix 6）：失败重试同一计划时不得与上次
        // 遗留的快照目录撞车（AlreadyExists 会让计划永久无法重跑）。
        let attempt = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos() % 1_000_000_000)
            .unwrap_or(0);
        let project_existed_before = self.project_root.exists();
        let snapshot: Option<SnapshotRef> = if project_existed_before {
            Some(
                self.snapshots
                    .create_verified(
                        &ProjectRef {
                            id: plan.project_id.clone(),
                            root: self.project_root.clone(),
                        },
                        &format!("{}-snap-{}", plan.plan_id, attempt),
                        &SNAPSHOT_SCOPES,
                    )
                    .map_err(|error| {
                        AppErrorV1::new(
                            error_codes::SNAPSHOT_FAILED,
                            ErrorCategory::ExternalFailure,
                            "errors.assembly.snapshotFailed",
                            correlation.clone(),
                        )
                        .with_param("reason", ParamValue::Text(error.to_string()))
                    })?
                    .reference,
            )
        } else {
            None
        };
        if let Some(context) = context {
            context.emit_progress(json!({
                "step": "snapshot",
                "snapshotId": snapshot.as_ref().map(|snapshot| snapshot.id.clone()),
            }));
        }

        let result = self
            .run_steps(plan, &spec, recipe, &correlation, context)
            .and_then(|payload| {
                self.write_marker(&marker, plan, &payload)?;
                Ok(payload)
            });
        match result {
            Ok(payload) => Ok(payload),
            Err(error) => {
                // Recover on failure: the snapshot is the compensation
                // boundary; a failed recovery surfaces as its own error and
                // never masquerades as the original failure (ORC-WF-010).
                if let Some(snapshot) = &snapshot {
                    let restored = self.snapshots.restore_verified(
                        &ProjectRef {
                            id: plan.project_id.clone(),
                            root: self.project_root.clone(),
                        },
                        snapshot,
                    );
                    if let Some(context) = context {
                        context.emit_progress(json!({
                            "step": "rollback",
                            "snapshotId": snapshot.id,
                            "restored": restored.is_ok(),
                        }));
                    }
                    if let Err(rollback) = restored {
                        return Err(AppErrorV1::new(
                            error_codes::ROLLBACK_FAILED,
                            ErrorCategory::ExternalFailure,
                            "errors.assembly.rollbackFailed",
                            correlation,
                        )
                        .with_param("originalCode", ParamValue::Text(error.code.clone()))
                        .with_param("reason", ParamValue::Text(rollback.to_string())));
                    }
                } else if !project_existed_before && self.project_root.exists() {
                    let removed = remove_fresh_project(&self.project_root);
                    if let Some(context) = context {
                        context.emit_progress(json!({
                            "step": "rollback",
                            "freshProjectRemoved": removed.is_ok(),
                        }));
                    }
                    if let Err(rollback) = removed {
                        return Err(AppErrorV1::new(
                            error_codes::ROLLBACK_FAILED,
                            ErrorCategory::ExternalFailure,
                            "errors.assembly.rollbackFailed",
                            correlation,
                        )
                        .with_param("originalCode", ParamValue::Text(error.code.clone()))
                        .with_param("reason", ParamValue::Text(rollback.to_string())));
                    }
                }
                Err(error)
            }
        }
    }

    fn run_steps(
        &self,
        plan: &AssemblyPlanV1,
        spec: &DerivedProjectSpecV1,
        recipe: &RecipeV02,
        correlation: &str,
        context: Option<&TaskContext>,
    ) -> Result<Value, AppErrorV1> {
        let project = ProjectRef {
            id: plan.project_id.clone(),
            root: self.project_root.clone(),
        };
        let avatar_name = recipe
            .instances
            .iter()
            .find(|instance| instance.id == recipe.target.avatar_instance_id)
            .map(instance_display_name)
            .unwrap_or_else(|| "Avatar".to_owned());
        let install_names: Vec<String> = recipe
            .relations
            .iter()
            .filter_map(|relation| match relation {
                RelationV02::InstallModularAsset {
                    asset_instance_id, ..
                } => recipe
                    .instances
                    .iter()
                    .find(|instance| &instance.id == asset_instance_id)
                    .map(instance_display_name),
                _ => None,
            })
            .collect();

        let mut install_index = 0usize;
        let mut toggle_index = 0usize;
        let mut completed = 0usize;
        // Unity owns the semantic scene fingerprint. The first inspect has no
        // premise; every result supplies the fingerprint bound into the next
        // command, including across separate batchmode processes.
        let mut unity_fingerprint: Option<String> = None;

        for step in &plan.steps {
            if let Some(context) = context {
                if let Some(error) = context.cancellation_error(correlation) {
                    return Err(error);
                }
                context.emit_progress(json!({
                    "step": format!("{:?}", step.operation).to_lowercase(),
                    "index": completed,
                    "total": plan.steps.len(),
                }));
            }
            match step.operation {
                AssemblyOperation::ProvisionProject => {
                    if !self
                        .project_root
                        .join("ProjectSettings/ProjectVersion.txt")
                        .is_file()
                    {
                        // E-VPM-DUAL: creation goes through the backend port
                        // (vrc-get lib template copy, or VCC `vpm new`).
                        self.backend_create_project(correlation)?;
                    }
                }
                AssemblyOperation::InstallPackages => {
                    self.install_packages(plan, spec, &project, correlation, context)?;
                }
                AssemblyOperation::BridgeInspect
                | AssemblyOperation::BridgeIdentifyAssets
                | AssemblyOperation::BridgeValidateAvatar
                | AssemblyOperation::BridgeAnalyzePerformance => {
                    unity_fingerprint = Some(self.run_bridge_step(
                        plan,
                        step,
                        &project,
                        completed,
                        &avatar_name,
                        None,
                        None,
                        unity_fingerprint.as_deref(),
                        correlation,
                    )?);
                }
                AssemblyOperation::BridgeInstallModularAsset => {
                    let outfit_name = install_names
                        .get(install_index)
                        .cloned()
                        .unwrap_or_else(|| format!("Outfit{install_index}"));
                    install_index += 1;
                    unity_fingerprint = Some(self.run_bridge_step(
                        plan,
                        step,
                        &project,
                        completed,
                        &avatar_name,
                        Some(&outfit_name),
                        None,
                        unity_fingerprint.as_deref(),
                        correlation,
                    )?);
                }
                AssemblyOperation::BridgeCreateToggle => {
                    let toggle_name = recipe
                        .wardrobe_groups
                        .get(toggle_index)
                        .map(|group| group.label.clone())
                        .unwrap_or_else(|| "Toggle".to_owned());
                    toggle_index += 1;
                    unity_fingerprint = Some(self.run_bridge_step(
                        plan,
                        step,
                        &project,
                        completed,
                        &avatar_name,
                        None,
                        Some(&toggle_name),
                        unity_fingerprint.as_deref(),
                        correlation,
                    )?);
                }
            }
            // A cancel can arrive while a package or Unity operation is in
            // flight. Observe it again before treating even the final step as
            // committed, so execute() enters its normal rollback path.
            if let Some(context) = context {
                if let Some(error) = context.cancellation_error(correlation) {
                    return Err(error);
                }
            }
            completed += 1;
        }

        if unity_fingerprint.is_none() {
            return Err(AppErrorV1::new(
                error_codes::VALIDATE_FAILED,
                ErrorCategory::ExternalFailure,
                "errors.assembly.validateFailed",
                correlation.to_owned(),
            )
            .with_recoverable(true));
        }

        Ok(json!({
            "noop": false,
            "planId": plan.plan_id,
            "recipeId": plan.recipe_id,
            "recipeRevision": plan.recipe_revision,
            "stepsCompleted": completed,
        }))
    }

    /// Creates the project through the VPM backend port (E-VPM-DUAL):
    /// vrc-get lib template copy, or VCC `vpm new`, depending on the
    /// configured backend. A backend without the capability surfaces an
    /// honest guidance error (ADR-0006).
    fn backend_create_project(&self, correlation: &str) -> Result<(), AppErrorV1> {
        if let Some(parent) = self.project_root.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AppErrorV1::new(
                    error_codes::PROVISION_FAILED,
                    ErrorCategory::ExternalFailure,
                    "errors.assembly.provisionFailed",
                    correlation.to_owned(),
                )
                .with_param("reason", ParamValue::Text(error.to_string()))
            })?;
        }
        let name = self
            .project_root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "VUA-Project".to_owned());
        self.project_backend
            .create_project(
                self.project_root.parent().expect("parent created above"),
                &name,
                None,
            )
            .map(|_| ())
            .map_err(|error| {
                let detail = error
                    .params
                    .as_ref()
                    .and_then(|params| params.get("reason").cloned())
                    .map(|value| match value {
                        ParamValue::Text(reason) => reason,
                        other => format!("{other:?}"),
                    })
                    .unwrap_or_default();
                AppErrorV1::new(
                    error_codes::PROVISION_FAILED,
                    ErrorCategory::ExternalFailure,
                    "errors.assembly.provisionFailed",
                    correlation.to_owned(),
                )
                .with_param("reason", ParamValue::Text(error.code.clone()))
                .with_param("detail", ParamValue::Text(detail))
            })?;
        Ok(())
    }

    /// Installs the complete package request set through one preview ->
    /// confirmed digest -> apply transaction. Preview items are plan content
    /// (transitive deps, removals, conflicts included), including interactions
    /// between direct requests (ADR-0006).
    fn install_packages(
        &self,
        plan: &AssemblyPlanV1,
        spec: &crate::recipe::DerivedProjectSpecV1,
        project: &ProjectRef,
        correlation: &str,
        context: Option<&TaskContext>,
    ) -> Result<(), AppErrorV1> {
        if spec.packages.is_empty() {
            return Ok(());
        }
        let baked = plan.package_preview.as_ref().ok_or_else(|| {
            AppErrorV1::new(
                error_codes::DRIFT,
                ErrorCategory::Conflict,
                "errors.assembly.drift",
                correlation.to_owned(),
            )
        })?;
        let expected_requests: Vec<PackageRequestV1> = spec
            .packages
            .iter()
            .map(|package| PackageRequestV1 {
                package_id: package.package_id.clone(),
                version: package.locked_version.clone(),
            })
            .collect();
        if baked.requests != expected_requests {
            return Err(AppErrorV1::new(
                error_codes::DRIFT,
                ErrorCategory::Conflict,
                "errors.assembly.packageDrift",
                correlation.to_owned(),
            )
            .with_recoverable(true));
        }
        let current = self
            .package_backend
            .preview_install(project, &expected_requests)?;
        if current.digest != baked.digest {
            return Err(AppErrorV1::new(
                error_codes::DRIFT,
                ErrorCategory::Conflict,
                "errors.assembly.packageDrift",
                correlation.to_owned(),
            )
            .with_recoverable(true));
        }
        if let Some(context) = context {
            context.emit_progress(json!({
                "step": "package_apply",
                "packages": expected_requests,
                "items": baked.items,
                "destructive": baked.destructive,
            }));
        }
        // Destructive content is allowed here because the complete preview is
        // already part of the user-confirmed assembly plan hash.
        self.package_backend
            .apply_install(project, &expected_requests, &baked.digest)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn run_bridge_step(
        &self,
        plan: &AssemblyPlanV1,
        step: &AssemblyStepV1,
        project: &ProjectRef,
        index: usize,
        avatar_name: &str,
        outfit_name: Option<&str>,
        toggle_name: Option<&str>,
        bound_fingerprint: Option<&str>,
        correlation: &str,
    ) -> Result<String, AppErrorV1> {
        let Some(operation) = step.operation.unity_operation() else {
            return Err(AppErrorV1::new(
                error_codes::UNITY_FAILED,
                ErrorCategory::Internal,
                "errors.assembly.unityFailed",
                correlation.to_owned(),
            ));
        };
        let outfit = outfit_name.unwrap_or(avatar_name);
        let command = UnityCommand {
            schema_version: 1,
            command_id: format!("{}-{:02}", plan.plan_id, index + 1),
            operation,
            project_id: plan.project_id.clone(),
            dry_run: !step.mutates_project,
            expected_project_fingerprint: bound_fingerprint.map(str::to_owned),
            payload: UnityPayload {
                avatar_global_object_id: avatar_name.to_owned(),
                avatar_armature_global_object_id: format!("{avatar_name}_Armature"),
                outfit_global_object_id: outfit.to_owned(),
                outfit_armature_global_object_id: format!("{outfit}_Armature"),
                toggle_name: toggle_name.unwrap_or(avatar_name).to_owned(),
                ..UnityPayload::default()
            },
        };
        let result = self
            .bridge
            .execute(project, &command)
            .map_err(|error| match error {
                BridgeError::TimedOut => AppErrorV1::new(
                    error_codes::UNITY_TIMEOUT,
                    ErrorCategory::Timeout,
                    "errors.assembly.unityTimeout",
                    correlation.to_owned(),
                )
                .with_recoverable(true)
                .with_retryable(true),
                other => AppErrorV1::new(
                    error_codes::UNITY_FAILED,
                    ErrorCategory::ExternalFailure,
                    "errors.assembly.unityFailed",
                    correlation.to_owned(),
                )
                .with_recoverable(true)
                .with_param("reason", ParamValue::Text(other.to_string())),
            })?;
        // Result binding (ORC-WF-008): command id must match the request.
        if result.command_id != command.command_id {
            return Err(AppErrorV1::new(
                error_codes::UNITY_FAILED,
                ErrorCategory::ExternalFailure,
                "errors.assembly.unityFailed",
                correlation.to_owned(),
            )
            .with_recoverable(true)
            .with_param(
                "reason",
                ParamValue::Text("mismatched command id".to_owned()),
            ));
        }
        if result.status != crate::ResultStatus::Succeeded {
            let message = result
                .diagnostics
                .first()
                .map(|diagnostic| diagnostic.message.clone())
                .unwrap_or_else(|| "Unity rejected the operation".to_owned());
            return Err(AppErrorV1::new(
                error_codes::UNITY_FAILED,
                ErrorCategory::ExternalFailure,
                "errors.assembly.unityFailed",
                correlation.to_owned(),
            )
            .with_recoverable(true)
            .with_param("reason", ParamValue::Text(message)));
        }
        result
            .data
            .get("projectFingerprint")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| {
                AppErrorV1::new(
                    error_codes::VALIDATE_FAILED,
                    ErrorCategory::ExternalFailure,
                    "errors.assembly.validateFailed",
                    correlation.to_owned(),
                )
                .with_param(
                    "reason",
                    ParamValue::Text("Unity result omitted projectFingerprint".to_owned()),
                )
            })
    }

    fn marker_path(&self, plan_id: &str) -> PathBuf {
        self.project_root
            .join(".vua/assembly")
            .join(format!("{plan_id}.done.json"))
    }

    fn marker_matches_current_project(
        &self,
        path: &Path,
        plan: &AssemblyPlanV1,
        correlation: &str,
    ) -> Result<bool, AppErrorV1> {
        if !path.is_file() {
            return Ok(false);
        }
        let bytes = std::fs::read(path).map_err(|error| marker_error(correlation, &error))?;
        let document: Value =
            serde_json::from_slice(&bytes).map_err(|error| marker_io(correlation, error))?;
        let identity_matches = document.get("schemaVersion") == Some(&json!(1))
            && document.get("planId") == Some(&json!(plan.plan_id))
            && document.get("planHash") == Some(&json!(plan.plan_hash))
            && document.get("documentDigest") == Some(&json!(plan.document_digest));
        let Some(stored_fingerprint) = document.get("finalFingerprint") else {
            return Err(marker_drift(correlation));
        };
        let stored_fingerprint: Option<String> = serde_json::from_value(stored_fingerprint.clone())
            .map_err(|_| marker_drift(correlation))?;
        let live = project_fingerprint(&self.project_root)
            .map_err(|error| project_fingerprint_error(correlation, &error))?;
        if !identity_matches || live != stored_fingerprint {
            return Err(marker_drift(correlation));
        }
        Ok(true)
    }

    fn write_marker(
        &self,
        path: &Path,
        plan: &AssemblyPlanV1,
        payload: &Value,
    ) -> Result<(), AppErrorV1> {
        let correlation = format!("corr-{}", plan.plan_id);
        let document = json!({
            "schemaVersion": 1,
            "planId": plan.plan_id,
            "planHash": plan.plan_hash,
            "recipeId": plan.recipe_id,
            "recipeRevision": plan.recipe_revision,
            "documentDigest": plan.document_digest,
            "finalFingerprint": project_fingerprint(&self.project_root)
                .map_err(|error| project_fingerprint_error(&correlation, &error))?,
            "completedAt": self.clock.now_rfc3339(),
            "result": payload,
        });
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| marker_error(&correlation, &error))?;
        }
        let bytes =
            serde_json::to_vec_pretty(&document).map_err(|error| marker_io(&correlation, error))?;
        // Atomic write: same-directory temp file, then rename (ORC-STO-003).
        let temp = path.with_extension("tmp");
        std::fs::write(&temp, bytes).map_err(|error| marker_error(&correlation, &error))?;
        std::fs::rename(&temp, path).map_err(|error| marker_error(&correlation, &error))?;
        Ok(())
    }
}

// --- helpers ---

fn instance_display_name(instance: &crate::recipe::InstanceV02) -> String {
    instance
        .label
        .clone()
        .or_else(|| instance.entrypoint.name_hint.clone())
        .unwrap_or_else(|| instance.id.clone())
}

fn project_fingerprint(project_root: &Path) -> io::Result<Option<String>> {
    project_tree_fingerprint(project_root, &SNAPSHOT_SCOPES)
}

fn remove_fresh_project(project_root: &Path) -> io::Result<()> {
    if project_root.parent().is_none() || project_root.file_name().is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to remove an unsafe project root",
        ));
    }
    std::fs::remove_dir_all(project_root)
}

fn plan_content(plan: &AssemblyPlanV1) -> Value {
    json!({
        "recipeId": plan.recipe_id,
        "recipeRevision": plan.recipe_revision,
        "documentDigest": plan.document_digest,
        "projectId": plan.project_id,
        "projectRoot": plan.project_root,
        "projectFingerprint": plan.project_fingerprint,
        "requiredCapabilities": plan.required_capabilities,
        "packagePreview": plan.package_preview.as_ref().map(|preview| json!({
            "requests": preview.requests,
            "digest": preview.digest,
            "items": preview.items,
            "conflicts": preview.conflicts,
            "removeLegacyFiles": preview.remove_legacy_files,
            "removeLegacyFolders": preview.remove_legacy_folders,
            "destructive": preview.destructive,
        })),
        "steps": plan.steps.iter().map(|step| json!({
            "operation": step.operation,
            "description": step.description,
            "mutatesProject": step.mutates_project,
            "timeoutSecs": step.timeout_secs,
            "compensation": step.compensation,
        })).collect::<Vec<_>>(),
    })
}

fn blocking_issue(
    id: &str,
    code: &str,
    message_key: &str,
    parameters: Vec<(&str, String)>,
) -> RecipeIssue {
    let mut params = BTreeMap::new();
    for (key, value) in parameters {
        params.insert(key.to_owned(), value);
    }
    RecipeIssue {
        issue_id: format!("iss-plan-{code}"),
        code: code.to_owned(),
        severity: IssueSeverity::Blocking,
        subject: IssueSubject::Relation { id: id.to_owned() },
        message_key: message_key.to_owned(),
        parameters: params,
        actions: vec![IssueAction {
            action_id: format!("act-plan-{code}"),
            kind: IssueActionKind::EditRecipe,
            label_key: "actions.recipe.edit_recipe".to_owned(),
        }],
    }
}

fn drift_from_issues(correlation: &str, issues: &[RecipeIssue]) -> AppErrorV1 {
    let codes: Vec<String> = issues.iter().map(|issue| issue.code.clone()).collect();
    AppErrorV1::new(
        error_codes::DRIFT,
        ErrorCategory::Conflict,
        "errors.assembly.drift",
        correlation.to_owned(),
    )
    .with_recoverable(true)
    .with_param("issues", ParamValue::Text(codes.join(",")))
}

fn internal_error(correlation: &str, error: &serde_json::Error) -> AppErrorV1 {
    AppErrorV1::new(
        "vua.assembly.internal",
        ErrorCategory::Internal,
        "errors.assembly.internal",
        correlation.to_owned(),
    )
    .with_param("reason", ParamValue::Text(error.to_string()))
}

fn marker_io(correlation: &str, error: serde_json::Error) -> AppErrorV1 {
    marker_error(correlation, &io::Error::other(error))
}

fn project_fingerprint_error(correlation: &str, error: &io::Error) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::VALIDATE_FAILED,
        ErrorCategory::ExternalFailure,
        "errors.assembly.projectFingerprintFailed",
        correlation.to_owned(),
    )
    .with_recoverable(true)
    .with_param("reason", ParamValue::Text(error.to_string()))
}

fn marker_drift(correlation: &str) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::DRIFT,
        ErrorCategory::Conflict,
        "errors.assembly.markerDrift",
        correlation.to_owned(),
    )
    .with_recoverable(true)
}

fn marker_error(correlation: &str, error: &io::Error) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::MARKER_FAILED,
        ErrorCategory::Internal,
        "errors.assembly.markerFailed",
        correlation.to_owned(),
    )
    .with_param("reason", ParamValue::Text(error.to_string()))
}

impl std::fmt::Display for AssemblyOperation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&format!("{self:?}"))
    }
}

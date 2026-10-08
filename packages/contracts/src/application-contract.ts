import { isDeploymentCommandId, isDeploymentParams, type DeploymentPlanParams, type DeploymentExecuteParams, type DeploymentPlanResult, type DeploymentAccepted } from "./environment-deployment.js";
import { isNetworkParams, type NetworkIntent, type NetworkResult } from "./environment-network.js";
import { isWebsiteTestParams, type WebsiteTestParams, type WebsiteTestResult } from "./website-test.js";
import { isDownloadEventV01 } from "./download-events.js";
import { isCatalogSyncPageRequestV01, type CatalogSyncPageRequestV01 } from "./catalog-sync.js";
import { isCatalogSyncParamsV03, type CatalogSyncBeginV03, type CatalogSyncPageV03, type CatalogSyncFinishV03, type CatalogSyncStatusV03 } from "./catalog-sync-v03.js";
import { isLibraryDownloadParamsV01, type LibraryDownloadBeginV01, type LibraryDownloadObservationV01, type LibraryDownloadStatusV01 } from "./library-download-v01.js";
import { isLibraryViewParamsV01, type LibraryListParamsV01, type LibraryProductFilesParamsV01, type LibraryListV01, type LibraryProductFilesV01 } from "./library-view-v01.js";
import { isRecipeDraftParamsV01, type RecipeDraftListParamsV01, type RecipeDraftGetParamsV01, type RecipeDraftSaveParamsV01, type RecipeDraftAddParamsV01, type RecipeDraftListV01, type RecipeDraftReadV01 } from "./recipe-selection-draft-v01.js";
import { isLibraryMaintenanceParamsV01, type LibraryRemovalPreviewParamsV01, type LibraryRemoveFilesParamsV01, type LibraryRemovalStatusParamsV01, type LibraryRemovalPreviewV01, type LibraryRemovalSnapshotV01 } from "./library-maintenance-v01.js";
import type { RecipeDraftSelectionStatusV01 } from "./recipe-selection-draft-v01.js";

export const APPLICATION_CONTRACT_VERSION = "0.1" as const;

export type ApplicationContractVersion = typeof APPLICATION_CONTRACT_VERSION;

export type ApplicationErrorCategoryV01 =
  | "validation"
  | "conflict"
  | "permission"
  | "dependency"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "external_failure"
  | "internal";

export type ApplicationParamValueV01 = string | number | boolean;

export interface AppErrorV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly code: string;
  readonly category: ApplicationErrorCategoryV01;
  readonly messageKey: string;
  readonly params?: Readonly<Record<string, ApplicationParamValueV01>>;
  readonly recoverable: boolean;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly fieldPath?: string;
  readonly redactedContext?: Readonly<Record<string, ApplicationParamValueV01>>;
}

export type TaskStateV01 =
  | "queued"
  | "preparing"
  | "running"
  | "waiting_for_input"
  | "paused"
  | "succeeded"
  | "succeeded_with_warnings"
  | "failed"
  | "cancelled";

export const TERMINAL_TASK_STATES_V01 = [
  "succeeded",
  "succeeded_with_warnings",
  "failed",
  "cancelled",
] as const satisfies readonly TaskStateV01[];

export function isTerminalTaskStateV01(state: TaskStateV01): boolean {
  return (TERMINAL_TASK_STATES_V01 as readonly string[]).includes(state);
}

export type TaskRecoveryDispositionV01 = "none" | "inspect_required";

export type CapabilityOperationV01 =
  | {
      readonly operationId: string;
      readonly availability: "available";
    }
  | {
      readonly operationId: string;
      readonly availability: "unavailable";
      readonly reason: AppErrorV01;
    };

export interface CapabilitySnapshotV01 {
  readonly revision: number;
  readonly operations: readonly CapabilityOperationV01[];
}

export interface ApplicationSnapshotV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly revision: number;
  readonly capabilities: CapabilitySnapshotV01;
}

/**
 * 任务终态结果载荷（BOARD #22 result 回流增量，2026-09-12）：任务正常完成
 * （succeeded / succeeded_with_warnings）时任务实际交回的 Done payload 原样。
 * 快照面对其内部形状零承诺——形状由产出该任务的操作词表定义并随其演进
 * （project-ops 族载荷自描述 schemaVersion/operation；production 族载荷形状
 * 归 production-use-case 词表），快照面演进与操作词表演进解耦。
 * 与 `task.completed` 事件的 `payload` 同源同值（同一任务存储投影）；
 * failed / cancelled / 非终态 / inspect_required 快照恒不带本字段，
 * 失败事实走既有 `error` 字段。
 */
export interface TaskDonePayloadV01 {
  readonly [key: string]: unknown;
}

export interface TaskSnapshotV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly taskId: string;
  readonly revision: number;
  readonly correlationId: string;
  readonly state: TaskStateV01;
  readonly cancellationRequested: boolean;
  readonly recoveryDisposition: TaskRecoveryDispositionV01;
  readonly updatedAt: string;
  readonly error?: AppErrorV01;
  readonly result?: TaskDonePayloadV01;
}

interface ApplicationRequestBaseV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface ApplicationSnapshotQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "application.getSnapshot";
  readonly params: Readonly<Record<string, never>>;
}

export interface TaskListQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "task.list";
  readonly params: Readonly<Record<string, never>>;
}

export interface TaskGetQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "task.get";
  readonly params: {
    readonly taskId: string;
  };
}

export interface TaskCancellationCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "task.requestCancellation";
  readonly commandId: string;
  readonly params: {
    readonly taskId: string;
    readonly observedRevision?: number;
  };
}

// ---- production.*(amf-production v0.2 登记面:七方法参数/响应/文档面与
// schemas/amf-production/v0.2/methods 七份 Schema 逐字段一致,与 Rust
// provider_host 及固定向量三处同批;路径与项目身份由 Kernel 经
// startInspection 一次性转交,此后不再出现在请求面) ----

/** 风险决策四枚举($defs.riskChoice;B 侧 RiskDecisionChoice 为权威词表) */
export type ProductionRiskChoiceV02 =
  | "snapshot_and_continue"
  | "continue"
  | "cancel"
  | "not_required";

/** 双素材模式($defs.mode;与素材 intake 词表一致,requestPlan 携带) */
export type ProductionModeV02 = "direct_unity_package" | "local_reusable_vpm";

/** 恢复决定($defs.decision) */
export type ProductionDecisionV02 = "continue" | "rollback";

/** 工作流阶段($defs.workflowStage;unity-bridge 词表) */
export type ProductionWorkflowStageV02 =
  | "inspect"
  | "snapshot"
  | "execute"
  | "validate"
  | "completed";

/** 检查发现与计划风险共用形状(kind 闭集 + recoverable/retryable 标注) */
export interface ProductionFindingV02 {
  readonly kind: "compat" | "missing" | "conflict";
  readonly summary: string;
  readonly recoverable: boolean;
  readonly retryable: boolean;
}

/** 可计划性结论(由应用层给出,前端不推断) */
export type ProductionPlannabilityV02 = "plannable" | "needs_attention" | "not_plannable";

/** 检查文档(C1 文档面:get-inspectionResult.inspection) */
export interface InspectionDocumentV02 {
  readonly inspectionId: string;
  readonly inspectedAt: string;
  readonly displayName: string;
  readonly sourceFingerprint: string;
  readonly riskFingerprint: string;
  readonly packages: readonly {
    readonly relativePath: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  }[];
  readonly findings: readonly ProductionFindingV02[];
  readonly plannability: ProductionPlannabilityV02;
}

/** 计划文档(C1 文档面:get-planResult.plan;diffs 条目 Schema 留开) */
export interface PlanDocumentV02 {
  readonly planId: string;
  readonly revision: number;
  readonly inspectionId: string;
  readonly mode: ProductionModeV02;
  readonly projectId: string;
  readonly projectFingerprint: string;
  readonly stages: readonly ProductionWorkflowStageV02[];
  readonly riskDecisionRequired: boolean;
  readonly risks: readonly ProductionFindingV02[];
  readonly diffs: readonly Record<string, unknown>[];
  readonly estimatedDurationMs: number | null;
}

/** 构建记录权威状态五态(build_record v0.2) */
export type BuildRecordStatusV02 =
  | "succeeded"
  | "succeeded_with_warnings"
  | "failed"
  | "cancelled"
  | "recovered";

/** evidenceSummary 四节(快照 / Bridge 作业 / 本地 VPM / 验证;未尝试节 null 锚) */
export interface BuildRecordEvidenceSummaryV02 {
  readonly snapshot: { readonly attempted: boolean; readonly succeeded: boolean | null };
  readonly bridge: {
    readonly jobsRun: number;
    readonly allSucceeded: boolean | null;
    readonly lastOperation: string | null;
  };
  readonly localVpm: {
    readonly attempted: boolean;
    readonly published: boolean | null;
    readonly packageId: string | null;
  };
  readonly validation: { readonly status: "passed" | "failed" | "skipped" };
}

/** 构建记录 v0.2 文档(get-build-recordResult.buildRecord;表现安全投影) */
export interface BuildRecordDocumentV02 {
  readonly recordId: string;
  readonly taskId: string;
  readonly planId: string;
  readonly mode: ProductionModeV02;
  readonly status: BuildRecordStatusV02;
  readonly stages: readonly ProductionWorkflowStageV02[];
  readonly evidenceSummary: BuildRecordEvidenceSummaryV02;
  readonly restoreAttempted: boolean;
  readonly restoreSucceeded: boolean | null;
  readonly startedAt: string;
  readonly finishedAt: string;
}

/** 命令受理回执(与 provider_host 同形:{ contractVersion, task }) */
export interface ProductionTaskStartedV02 {
  readonly contractVersion: ApplicationContractVersion;
  readonly task: TaskSnapshotV01;
}

export interface ProductionStartInspectionCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "production.startInspection";
  readonly commandId: string;
  readonly params: {
    readonly sourceFolder: string;
    readonly projectRoot: string;
    readonly artifactOutputRoot: string;
    readonly projectId: string;
  };
}

/** startInspection 成功值:任务 + 签发的检查域身份(insp- 前缀) */
export interface ProductionInspectionStartedV02 extends ProductionTaskStartedV02 {
  readonly inspectionId: string;
}

export interface ProductionGetInspectionQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "production.getInspection";
  readonly params: { readonly inspectionId: string };
}

/** 文档查询成功值:任务事实 + 内嵌文档 */
export interface ProductionInspectionViewV02 {
  readonly contractVersion: ApplicationContractVersion;
  readonly taskId: string;
  readonly state: string;
  readonly inspection: InspectionDocumentV02;
}

export interface ProductionRequestPlanCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "production.requestPlan";
  readonly commandId: string;
  readonly params: {
    readonly inspectionId: string;
    readonly mode: ProductionModeV02;
  };
}

/** requestPlan 成功值:任务 + 计划域身份(plan- 前缀)+ 确认绑定 revision */
export interface ProductionPlanIssuedV02 extends ProductionTaskStartedV02 {
  readonly planId: string;
  readonly revision: number;
}

export interface ProductionGetPlanQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "production.getPlan";
  readonly params: { readonly planId: string };
}

export interface ProductionPlanViewV02 {
  readonly contractVersion: ApplicationContractVersion;
  readonly taskId: string;
  readonly state: string;
  readonly plan: PlanDocumentV02;
}

export interface ProductionConfirmPlanCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "production.confirmPlan";
  readonly commandId: string;
  readonly params: {
    readonly planId: string;
    readonly observedRevision: number;
    readonly riskChoice: ProductionRiskChoiceV02;
    readonly rememberForSession?: boolean;
  };
}

export interface ProductionRecoverCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "production.recover";
  readonly commandId: string;
  readonly params: {
    readonly taskId: string;
    readonly decision: ProductionDecisionV02;
    readonly decisionId: string;
    readonly planId?: string;
  };
}

export interface ProductionGetBuildRecordQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "production.getBuildRecord";
  readonly params: { readonly buildRecordId: string };
}

export interface ProductionBuildRecordViewV02 {
  readonly contractVersion: ApplicationContractVersion;
  readonly buildRecord: BuildRecordDocumentV02;
}

// ---- catalog.* / warehouse.*(bdl-queries v0.3 冻结面:AMF 从本地 BDL 出的
// 五个只读查询。传输信封归本契约;本节冻结操作词表、查询闭集、字段面与结果
// 形状。渲染层永不直接触达 BDL;协议变更须升版,不得原地改写。2026-09-18
// 结果面对齐:六个只读结果类型照 021 先例登记 bdl-queries 冻结 wire 三键
// 信封 {schemaVersion, operation, result}(BOARD #36 mock 信封回正的桌面
// TS 登记面跟随,零协议变更——内层 result 才是各方法结果本体,renderer 经
// 信封窄化取用)。2026-09-22 核心 v0.5 接线批随版:信封常量 0.4→0.5(additive
// 八方法升版,六方法词面零变化,schemas/bdl-queries/v0.5/result.schema.json;
// dependencies.* 两新成员的 TS 面归桌面接线批) ----

/** v0.2 availability 稳定枚举:由 AMF/BDL 处理器按协议版本化规则表从观测
 *  原词派生;渲染层只消费该枚举(徽标与筛选),原词证据走 availabilityRaw */
export type CatalogAvailabilityStatusV03 = "available" | "unavailable" | "unknown";

export interface CatalogListQueryV03 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "catalog.list";
  readonly params: {
    /** 标题与 productId 的不区分大小写子串匹配;缺省或 null 不过滤 */
    readonly text?: string | null;
    /** 对派生稳定枚举精确匹配;缺省或 null 不过滤 */
    readonly availabilityStatus?: CatalogAvailabilityStatusV03 | null;
    /** bdl-queries v0.6/BDL v0.3:按账号库类型精确匹配;缺省或 null 不过滤 */
    readonly libraryType?: "bought" | "gifts" | "free_downloads" | null;
    /** 1–200,默认 50 */
    readonly limit?: number;
    /** ≥ 0,默认 0 */
    readonly offset?: number;
  };
}

export interface CatalogDetailQueryV03 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "catalog.detail";
  readonly params: { readonly productId: string };
}

export interface CatalogStatusQueryV03 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "catalog.status";
  readonly params: Readonly<Record<string, never>>;
}

export interface WarehouseListEntriesQueryV03 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "warehouse.listEntries";
  readonly params: Readonly<Record<string, never>>;
}

/** downloads.listCompleted 查询(bdl-queries v0.4,015 §10 仲裁 A 形态):
 *  可采纳的已完成交付(折叠于 TransferDone＋暂存文件在场且尺寸相符),
 *  与 warehouse.importDownloads 采纳守卫同源同函数——行在列即可采纳 */
export interface DownloadsListCompletedQueryV04 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "downloads.listCompleted";
  readonly params: Readonly<Record<string, never>>;
}

/** project.environmentManagers 查询(013 读面第一翼,核心 e720544):只读
 *  VCC/ALCOM/编辑器检测快照(T-B 消费)。快照本体是文档型数据——照
 *  production-use-case 先例以 envelope 强度承载(Record),UI 按需窄化,
 *  契约面不复制快照 Schema(project-inspection v0.2 信封＋
 *  environment-managers v0.1 本体);剩余三查询(listProjects/inspectProject/
 *  lockStatus)待核心接线刀随批登记 */
export interface ProjectEnvironmentManagersQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "project.environmentManagers";
  readonly params: Readonly<Record<string, never>>;
}

/** environmentManagers 结果信封(021 桌面接线批对齐 wire 实际形态,零协议
 *  变更):外层 = project-inspection 查询信封(schemaVersion "0.1" +
 *  operation),内层 result 才是 environment-managers v0.1 快照本体——
 *  envelope 强度透传(字段语义归快照 Schema,UI 按需窄化;桌面此前误读
 *  信封顶层致 editors 呈现恒 '—',021 收敛点 1 如实修正) */
export interface ProjectEnvironmentManagersResultV01 {
  readonly schemaVersion: "0.1";
  readonly operation: "project.environmentManagers";
  readonly result: Record<string, unknown>;
}

/* ---- environment.verifyEditor(021 词表行,核心七点裁决 2026-09-13,
 *    schemas/editor-verify/v0.1,DRAFT 漂移由向量对表测试把守) ----
 * 分型 query(裁决②):带参只读验证,零状态变更、零任务化、同步请求-响应。
 * params 单字段闭集 {path}(裁决③):用户手选路径三形态(exe 文件本身 /
 * 版本化根 / Editor 目录)verbatim 透传,明示不设 maxLength;归一化是
 * 原语(editor_verify)职责,桌面层零本地归一化。 */

/** 信封 schemaVersion(钉子三:const "0.1",照 inspection-get 先例;核心域
 *  自有常量 EDITOR_VERIFY_SCHEMA_VERSION 的 TS 对应面,消费守卫以此钉死) */
export type EditorVerifySchemaVersionV01 = "0.1";

/** 分类四值闭集(核心 EditorClass serde snake_case,与 environment-managers
 *  v0.1 冻结 editorClass 枚举逐字同构,零新发明) */
export type EditorClassV01 =
  | "production_target"
  | "migration_source"
  | "other_unity_version"
  | "tuanjie_family";

/** 拒绝码闭集五码(vua.editor_verify.* 族,原语 codes 模块逐字)。拒绝 =
 *  正常发现,走 result 内态,绝不上浮应用错误信封(钉子一) */
export type EditorVerifyRefusalCodeV01 =
  | "vua.editor_verify.target_missing"
  | "vua.editor_verify.exe_missing"
  | "vua.editor_verify.identity_unreadable"
  | "vua.editor_verify.not_an_editor"
  | "vua.editor_verify.unsupported_platform";

/** 拒绝码闭集运行时面(渲染层收窄与消费测试按此数组对表,不自持字面量) */
export const EDITOR_REFUSAL_CODES_V01: readonly EditorVerifyRefusalCodeV01[] = [
  "vua.editor_verify.target_missing",
  "vua.editor_verify.exe_missing",
  "vua.editor_verify.identity_unreadable",
  "vua.editor_verify.not_an_editor",
  "vua.editor_verify.unsupported_platform",
];

/** 诚实缺席码(裁决⑤):仅路由未接线/原语不可达,绝不复用为验证拒绝。
 *  锚定核心域 pub 常量 ENVIRONMENT_VERIFY_UNAVAILABLE(provider-host 导出),
 *  TS 面以同名常量消费,不自持第二语义 */
export const ENVIRONMENT_VERIFY_UNAVAILABLE = "vua.environment.verify_unavailable";

export interface EnvironmentVerifyEditorQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "environment.verifyEditor";
  readonly params: { readonly path: string };
}

/** verdict:"verified" 分支(与原语 EditorPathIdentity 逐字同构 camelCase):
 *  身份来自可执行文件自身版本资源(门①:绝不信任路径名),editorRoot 仅为
 *  信息性记录 */
export interface EditorVerifyVerifiedV01 {
  readonly verdict: "verified";
  readonly editorRoot: string;
  readonly exePath: string;
  readonly version: string;
  readonly classification: EditorClassV01;
  readonly guidanceCode: string;
  readonly chinaDistribution: boolean;
  readonly schemaVersion: EditorVerifySchemaVersionV01;
}

/** verdict:"refused" 分支(与原语 EditorPathRefusal 逐字同构):detail 资源
 *  原文透传不解释(钉子二:wire 与桌面层均零加工,呈现原语发现) */
export interface EditorVerifyRefusedV01 {
  readonly verdict: "refused";
  readonly exePath: string | null;
  readonly code: EditorVerifyRefusalCodeV01;
  readonly detail: string;
  readonly schemaVersion: EditorVerifySchemaVersionV01;
}

/** 两态 tagged union(verdict 判别,裁决④) */
export type EnvironmentVerifyEditorResultV01 =
  | EditorVerifyVerifiedV01
  | EditorVerifyRefusedV01;

/* ---- 013 读面三查询(核心 5b65550 四查询全 live;envelope 强度承载——
 * projects/associations 本体是文档型数组,UI 按需窄化,契约面不复制
 * 快照 Schema;vuaIdentity 三态随行) ---- */

/** project.listProjects:管理器注册路径全量(缺席语义=诚实空数组) */
export interface ProjectListProjectsQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "project.listProjects";
  readonly params: Readonly<Record<string, never>>;
}

export interface ProjectListProjectsResultV01 {
  readonly schemaVersion: "vua.project-inspection/v0.2";
  readonly projects: readonly unknown[];
  readonly diagnostics: readonly unknown[];
}

/** project.inspectProject:仅对管理器注册路径可查;未注册=
 *  vua.project.project_not_found(messageKey errors.project.projectNotFound) */
export interface ProjectInspectProjectQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "project.inspectProject";
  readonly params: { readonly projectPath: string };
}

export interface ProjectInspectProjectResultV01 {
  readonly schemaVersion: "vua.project-inspection/v0.2";
  readonly path: string;
  readonly associations: readonly unknown[];
}

/** project.lockStatus:锁残留三态纯观察(永不取锁) */
export interface ProjectLockStatusQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "project.lockStatus";
  readonly params: { readonly projectPath: string };
}

export type ProjectLockMutationStatusV01 = "none" | "leftover" | "unreadable";

export interface ProjectLockStatusResultV01 {
  readonly schemaVersion: "vua.project-inspection/v0.2";
  readonly projectPath: string;
  readonly mutationStatus: ProjectLockMutationStatusV01;
}

/* ---- 029 B 面 recipe-export v0.1(核心冻结批 2026-09-22;桌面环 4 消费批
 * TS 面登记)。单方法同步只读 Query:recipe.exportProjectDraft——从已注册
 * Unity 工程导出「配方草稿」(draft;永不是 Recipe,转正唯一通道 = 用户显式
 * 确认后的既有 recipe.save 版本链):读 013 检查聚合零新工程读面,params 单键
 * projectPath 复用注册身份,未注册 = 复用 vua.project.project_not_found
 * (024 判例);盘上观察失败不设码——manifest 缺席 = 诚实空依赖数组、版本
 * 不可读 = null + missing 标记(诚实律 1/2,绝不虚构行)。草稿文档闭集
 * (additionalProperties:false = 虚假断言防线,草稿携带 assets/title/
 * recipeId 即形状违反):draftId(草稿实例身份,非 recipeId)+ exportedAt +
 * origin(projectPath 回显/projectName 可空/vuaIdentity 三态,缺席非门)+
 * environment.unityVersionConstraint(盘上观察 verbatim 可空)+ dependencies
 * (声明集 verbatim,packageId 升序冻结呈现,lockedVersion 同 id 精确钉定
 * 可缺;locked-only 系传递解析事实不产行)+ missing(缺失维度十值闭集:
 * 关系面五维 + 语义四维恒在〔裁决一:案 B 零桥接骨架,关系面零扫描〕,
 * environmentUnityVersion ⟺ constraint null 双向 iff)。TS 面照冻结 Schema
 * 镜像,不复制正负例向量(消费测试骑 schemas/recipe-export/v0.1)。 */

/** recipe.exportProjectDraft:已注册工程的配方草稿导出(同步只读,无任务化
 *  命令面——纯读无物可恢复,packages-ops preview 先例) */
export interface RecipeExportProjectDraftQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "recipe.exportProjectDraft";
  readonly params: { readonly projectPath: string };
}

/** 草稿缺失维度十值闭集:九维恒在(关系面五维 assets/instances/relations/
 *  wardrobeGroups/targetAvatar + 语义四维 assetRoles/assetLabels/sourceRefs/
 *  titleSemantics)+ environmentUnityVersion 条件第十值 */
export type RecipeExportMissingDimensionV01 =
  | "assets"
  | "instances"
  | "relations"
  | "wardrobeGroups"
  | "targetAvatar"
  | "assetRoles"
  | "assetLabels"
  | "sourceRefs"
  | "titleSemantics"
  | "environmentUnityVersion";

/** VUA 原生身份三态(`.vua/project.json`,013 聚合观察 verbatim;适用边界
 *  注记,永不是 v0.1 的门——未决项 2 保持开放候用户) */
export type VuaIdentityStatusV01 = "absent" | "present" | "unreadable";

export interface RecipeExportDraftOriginV01 {
  readonly projectPath: string;
  /** 013 聚合观察到的工程名 verbatim;null = 无名可读。仅是来源事实——
   *  草稿没有 title 字段,确认流是否用它预填标题属桌面呈现决策 */
  readonly projectName: string | null;
  readonly vuaIdentityStatus: VuaIdentityStatusV01;
}

export interface RecipeExportDraftEnvironmentV01 {
  /** 盘上观察到的编辑器版本 verbatim(照提案边界 2 不迁移);null = 不可读,
   *  此时 missing 必带 environmentUnityVersion(双向 iff 钉死) */
  readonly unityVersionConstraint: string | null;
}

export interface RecipeExportDraftDependencyV01 {
  readonly packageId: string;
  /** 声明约束 verbatim(如 3.7.x 区间) */
  readonly versionConstraint: string;
  /** locked map 同 id 精确钉定;声明无锁定 = 缺席。locked-only 不产行 */
  readonly lockedVersion?: string;
}

export interface RecipeExportProjectDraftResultV01 {
  readonly schemaVersion: "vua.recipe-export/v0.1";
  /** 草稿实例身份(逐导出铸造的 uuidv7);NOT recipeId——配方身份只在
   *  用户显式确认保存后由 recipe.save 链铸造 */
  readonly draftId: string;
  readonly exportedAt: string;
  readonly origin: RecipeExportDraftOriginV01;
  readonly environment: RecipeExportDraftEnvironmentV01;
  /** packageId 升序(冻结确定性呈现事实);空数组 = 诚实应答 */
  readonly dependencies: readonly RecipeExportDraftDependencyV01[];
  /** uniqueItems;九维恒在,minItems 9 maxItems 10 */
  readonly missing: readonly RecipeExportMissingDimensionV01[];
}

/* ---- 024 P1 读面(packages-query v0.1,核心冻结批 2026-09-17;三域表态
 *  收敛:桌面 ab02215／环境 62b4989／集成第 70 批)。单方法只读:
 *  packages.listInstalled——已注册项目的已装包集合(VPM manifest＋lock
 *  投影)。projectPath 复用 013 注册身份,未注册 = 复用
 *  vua.project.project_not_found(同事实同码);P1 词面按三域表态刻意
 *  不带 P2 事实字段(source/versions/updateAvailable/latestVersion/
 *  changelogUrl/displayName),降级投影细则归桌面消费批 */

/** packages.listInstalled:单项目已装包清单(诚实空数组=零已装包) */
export interface PackagesListInstalledQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "packages.listInstalled";
  readonly params: { readonly projectPath: string };
}

/** 已装包行:仅 P1 事实源四字段中的三个(id/版本/直接依赖);字段闭集
 *  = 虚假断言防线(updateAvailable 等发明字段在 schema 即非法) */
export interface PackagesInstalledItemV01 {
  readonly packageId: string;
  readonly version: string;
  readonly dependencies: readonly string[];
}

export interface PackagesListInstalledResultV01 {
  readonly schemaVersion: "vua.packages-installed/v0.1";
  readonly projectPath: string;
  /** packageId 升序(冻结的确定性呈现事实);空数组 = 诚实空清单 */
  readonly packages: readonly PackagesInstalledItemV01[];
}

/* ---- 027 F3 增量(packages-query v0.2,核心冻结批 2026-09-20;已装表
 *  更新感知:027 核心表态 3＋环境考证 s2 两语义边界＋桌面 IA 表态 3,
 *  面序 F2→F3 三域收敛)。command 面与 v0.1 逐字节同形
 *  (PackagesListInstalledQueryV01 不变,请求联合零新增);v0.2 = 冻结
 *  v0.1 result 恰加三事实——行级判定对 latestVersion/updateAvailable
 *  (必带可空)＋文档级 cacheSourced(必带);冻结 v0.1 词面绝不原地
 *  修订——backend 未声明 query_v02 前继续应答 v0.1 族,盖戳族常量告知
 *  消费端应答的是哪个词面,永不猜测(catalog v0.2 双版本协商先例)。
 *  虚假断言防线(024 表态②,用户裁定 2026-09-20):updateAvailable=null
 *  = 判定未执行,消费端对 null 渲染诚实空态,绝不渲染「已最新」,
 *  绝不以默认 false 填充 */
/** 已装包行 v0.2:v0.1 三键(零变动)＋判定对两键(必带可空) */
export interface PackagesInstalledItemV02 {
  readonly packageId: string;
  readonly version: string;
  readonly dependencies: readonly string[];
  /** 判定跨集合全仓合并取最高(跨仓 max——刻意非 F2 分仓视图,两视图
   *  分立不混同);null = 当前设置下无合资格版本(本地包无缓存位或全
   *  部候选被 yanked/设置排除)——缺席不是「无更新」 */
  readonly latestVersion: string | null;
  /** 冻结判定结论(存在严格更新的、符合当前过滤条件的版本);null =
   *  判定未执行(无合资格最新版或工程 Unity 版本未知)——null 绝不是
   *  「已最新」;已装版自身是 prerelease 且设置关时,合资格最新取稳定
   *  集,false 精确语义 =「当前过滤条件下不存在严格更新版本」,非泛化
   *  「无更新」 */
  readonly updateAvailable: boolean | null;
}

export interface PackagesListInstalledResultV02 {
  readonly schemaVersion: "vua.packages-installed/v0.2";
  readonly projectPath: string;
  /** packageId 升序(冻结的确定性呈现事实,零变动);空数组 = 诚实空清单 */
  readonly packages: readonly PackagesInstalledItemV02[];
  /** 必带信息性降级披露事实(catalog v0.2 先例):true = 本次清单判定经
   *  缓存降级路径(offline→load_cache,或在线 load 失败降级);false =
   *  在线刷新 load 所得;信息性非失败,消费端呈现「缓存数据」标注,
   *  绝不渲染为失败,也绝不为无此字段的 v0.1 应答虚构标注 */
  readonly cacheSourced: boolean;
}

/* ---- 025 P2 读面(packages-repos＋packages-catalog v0.1,核心冻结批
 *  2026-09-17;表态程序收敛:环境提案 64bfe58／集成 7a50ce9／桌面
 *  0031004／核心裁决 bf78368)。两方法只读,按需查询粒度,零分页语义;
 *  全部错误码复用既有闭集,词面零新码。健康面 = P2 非目标(库面无事
 *  实载体);写面(启停/增删/刷新)归 013 R5 逐面独立提案不在此族 */

/** packages.listRepos:仓库订阅清单读面(订阅面为世界 = 用户配置事实,
 *  settings userRepos 数组顺序照实投影)。params 空闭集(全局配置面,
 *  非 per-project) */
export interface PackagesListReposQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "packages.listRepos";
  readonly params: Record<string, never>;
}

/** 订阅行:四标识/定位事实为可空字符串(null = 库面 Option 如实投影,
 *  本地目录仓库 url=null);cached 必带 = 逐仓库缓存命中事实(false =
 *  已订阅未刷新,其自身诚实状态,不隐藏不伪造成空目录)。行闭集 =
 *  虚假断言防线(health/status/lastRefreshed 等发明字段在 schema 即
 *  非法——健康面 P2 非目标) */
export interface PackagesRepoInfoV01 {
  readonly repoId: string | null;
  readonly name: string | null;
  readonly url: string | null;
  readonly localPath: string | null;
  readonly cached: boolean;
}

export interface PackagesListReposResultV01 {
  readonly schemaVersion: "vua.packages-repos/v0.1";
  /** 订阅面自身顺序 = 冻结的确定性呈现事实;空数组 = 诚实零订阅 */
  readonly repos: readonly PackagesRepoInfoV01[];
}

/* ---- 027 F4 增量(packages-repos v0.2,核心冻结批 2026-09-20)。
 *  v0.2 = 冻结 v0.1 result 恰加一个必带行级事实 enabled,其余零变动;
 *  冻结的 v0.1 词面绝不原地修订——backend 未采纳 v0.2 前继续应答 v0.1
 *  族,盖戳族常量告知消费端应答的是哪个词面,永不猜测(command 面与
 *  v0.1 逐字节同形,PackagesListReposQueryV01 不变;catalog/query v0.2
 *  增量先例)。enabled = VUA 自有启停状态位(packages-ops v0.6
 *  enableRepo/disableRepo 写面读回):true=该行在包集合世界中活跃;
 *  false=已禁用——仍在订阅且在列,但其包被枚举与解析排除。W25 只读
 *  证据记录裁决 (c):VCC 无任何启停状态——该位投影 VUA 自有存储,绝不
 *  是 settings.json 键。repoId 为 null 的行 enabled 恒为 true: id 缺席
 *  行在启停面可达范围之外(removeRepo 同边界),true 是其诚实的恒久
 *  事实。虚假断言防线:health/status/lastRefreshed/disabledAt 等无端口
 *  载体事实在 schema 即非法 */
export interface PackagesRepoInfoV02 {
  readonly repoId: string | null;
  readonly name: string | null;
  readonly url: string | null;
  readonly localPath: string | null;
  readonly cached: boolean;
  readonly enabled: boolean;
}

export interface PackagesListReposResultV02 {
  readonly schemaVersion: "vua.packages-repos/v0.2";
  /** 订阅面自身顺序 = 冻结的确定性呈现事实;空数组 = 诚实零订阅 */
  readonly repos: readonly PackagesRepoInfoV02[];
}

/** packages.packageCatalog:单包目录事实按需查询(选中工程上下文绑定;
 *  无全量目录投影、无分页语义)。packageId 词表外包 = 复用
 *  vua.vpm.no_matching_package(消费端呈现为独立空态非错误页) */
export interface PackagesPackageCatalogQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "packages.packageCatalog";
  readonly params: { readonly projectPath: string; readonly packageId: string };
}

/** 目录版本行:yanked = 仓库缓存携带事实(compatible = 按选中工程
 *  Unity 版本判定,null = 工程版本未知——null 不是不兼容) */
export interface PackagesCatalogVersionV01 {
  readonly version: string;
  readonly yanked: boolean;
  readonly compatible: boolean | null;
}

export interface PackagesPackageCatalogResultV01 {
  readonly schemaVersion: "vua.packages-catalog/v0.1";
  readonly projectPath: string;
  readonly packageId: string;
  /** null 呈现 = packageId 兼任显示名(P1 裁决 3),不冒充字段事实 */
  readonly displayName: string | null;
  /** 二态来源事实;桌面「已装」第三态 = 与 installed 组合,词面不合
   *  并来源与安装两事实 */
  readonly source: "repo" | "local";
  readonly installed: boolean;
  /** 冻结判定结论(存在严格更新的兼容版本);null = 判定未执行(本工
   *  程未安装或工程 Unity 版本未知)——缺席不是「无更新」,null 时消
   *  费端维持 P1 防线(更新 UI 不渲染,不以默认值填充) */
  readonly updateAvailable: boolean | null;
  /** 仓库缓存版本升序;local 来源 = 空数组(诚实空,非错误) */
  readonly versions: readonly PackagesCatalogVersionV01[];
}

/* ---- 025 v0.2 增量(内联裁决 2026-09-17:stale/cacheSourced 披露增
 *  量;收敛面 = 环境形状提案 A＋桌面表态第 5 条披露枝＋核心方向裁决 6)。
 *  v0.2 = 冻结 v0.1 result 恰加一个必带键 cacheSourced,其余零变动;冻
 *  结的 v0.1 词面绝不原地修订——backend 未采纳 v0.2 前继续应答 v0.1 族,
 *  盖戳族常量告知消费端应答的是哪个词面,永不猜测。command 面与 v0.1
 *  逐字节同形(PackagesPackageCatalogQueryV01 不变)。repos 族刻意无此
 *  字段:list_repos 零网络面,该事实恒为常量——恒常量信息字段不是事实,
 *  不设 wire 键 */
export interface PackagesPackageCatalogResultV02 {
  readonly schemaVersion: "vua.packages-catalog/v0.2";
  readonly projectPath: string;
  readonly packageId: string;
  /** null 呈现 = packageId 兼任显示名(P1 裁决 3),不冒充字段事实 */
  readonly displayName: string | null;
  /** 二态来源事实;桌面「已装」第三态 = 与 installed 组合 */
  readonly source: "repo" | "local";
  readonly installed: boolean;
  /** 冻结判定结论;null = 判定未执行——缺席不是「无更新」 */
  readonly updateAvailable: boolean | null;
  /** 仓库缓存版本升序;local 来源 = 空数组(诚实空,非错误) */
  readonly versions: readonly PackagesCatalogVersionV01[];
  /** 必带信息性降级披露事实:true = 本次结果经缓存降级路径(offline→
   *  load_cache,或在线 load 失败降级);false = 在线刷新 load 所得。
   *  信息性非失败:消费端呈现「缓存数据」标注,绝不渲染为失败,也绝不
   *  为无此字段的 v0.1 应答虚构标注 */
  readonly cacheSourced: boolean;
}

/* ---- 027 F2 读面(packages-repo-catalog v0.1,核心冻结批 2026-09-20;
 *  表态程序收敛:核心裁决 58d1a0c／环境考证 3bd4f12／桌面表态 75f0dac,
 *  三域收敛第 121 批登记)。仓库级可装包清单读面 = 缓存清单投影——
 *  packages-catalog 族冻结词面刻意排除的仓库级投影归此新族,订阅面
 *  (packages-repos 族)仍是配置事实面,两视图分立不混同;跨仓合并判定
 *  仍是 packages-catalog 族事实,本面逐仓分组绝不跨仓合并。设计约束
 *  (用户裁决④):packageIds 批量过滤键 = Recipe 自动化第一消费者形状,
 *  手动浏览 UI 是同一查询的次要呈现。author 刻意缺席:库面 manifest
 *  反序列化闭集无 author 字段(环境考证 §1(b)),v0.1 裁如实缺席〔选项
 *  (iii)〕不立第二解析面;compatible 刻意不存在:无工程上下文判定不可
 *  执行,恒 null 非事实(逐版本 compatible 仍是 packages-catalog 面的
 *  工程绑定冻结事实)。零新码:未知 repoId 复用 vua.vpm.repo_not_found
 *  (A4 removeRepo 同事实先例) */
export interface PackagesRepoCatalogQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "packages.repoCatalog";
  readonly params: {
    /** null = 全部仓库逐仓分组;非空 = 只答该仓库行;词表外 id =
     *  复用 vua.vpm.repo_not_found */
    readonly repoId: string | null;
    /** null = 不过滤浏览;非空 = Recipe 需求集合批量过滤(唯一非空
     *  id,空数组是形状违反非空过滤) */
    readonly packageIds: readonly string[] | null;
  };
}

/** 仓库清单包行:库面实际上限闭集(无 author 无 compatible——两者
 *  缺席均系裁决非遗漏,发明即 schema 非法);latestVersion = 本仓内
 *  非-yanked 且未被用户 prerelease 设置排除的最新版判定(无工程
 *  Unity 约束),null = 当前设置下无合资格版本——缺席不是「无包」 */
export interface PackagesRepoCatalogPackageV01 {
  readonly packageId: string;
  /** null 呈现 = packageId 兼任显示名(P1 裁决 3),不冒充字段事实 */
  readonly displayName: string | null;
  /** null = manifest 未携带(诚实缺席,不补齐) */
  readonly description: string | null;
  readonly latestVersion: string | null;
  /** 仓库缓存自身清单计数(yanked 计入)——缓存事实非可用性承诺 */
  readonly versionCount: number;
}

/** 仓库行:cached 必带 = 逐仓库缓存命中事实(false = 已订阅未刷新,
 *  以空 packages 数组如实呈现,不隐藏不伪造);行序 = 集合自身枚举
 *  顺序照实投影,不发明排序键 */
export interface PackagesRepoCatalogRepoV01 {
  readonly repoId: string | null;
  readonly name: string | null;
  readonly cached: boolean;
  readonly packages: readonly PackagesRepoCatalogPackageV01[];
}

export interface PackagesRepoCatalogResultV01 {
  readonly schemaVersion: "vua.packages-repo-catalog/v0.1";
  /** 空数组 = 诚实零仓库缓存应答 */
  readonly repos: readonly PackagesRepoCatalogRepoV01[];
  /** 必带信息性降级披露事实(降生即带,catalog v0.2 先例):true =
   *  缓存降级路径所得;false = 在线刷新所得;信息性非失败 */
  readonly cacheSourced: boolean;
}

/* ---- 027 F5 读面(packages-templates v0.1,核心冻结批 2026-09-20)。
 *  模板枚举纯读面:枚举事实源 = 库路径默认解析腿已钉两目录根
 *  (VRCTemplates 先、Templates 后——create_from_template 解析序;
 *  vrc-get-vpm 0.0.16 无模板枚举 API,目录扫描即枚举——环境考证 §4
 *  枚举形态裁决:目录扫描枚举 vs 列非目标,裁决前者,立案权威 U14
 *  裁决 (3) + 027 核心表态 5,零网络面无 cacheSourced——恒常量信息
 *  字段不是事实,repos v0.1 同律)。create 三候选解析的显式路径腿是
 *  逐次参数形态非目录根,不入枚举世界;同名模板两根都在 = 枚举一次,
 *  落在创建解析序会选的根——枚举绝不偏离 create 实际复制之物 */
/** packages.listTemplates:模板条目枚举读面(params 空闭集 = 环境级
 *  配置面,非 per-project;packages.listRepos 零参数先例) */
export interface PackagesListTemplatesQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "packages.listTemplates";
  readonly params: Record<string, never>;
}

/** 模板条目行:id = 模板目录名(传给 packages.createProject template
 *  参数的机器标识);name = id 的冻结同值显示投影(v0.1 无独立显示名
 *  事实源,投影逐字声明同一事实,消费端绝不虚构更友好的标签;同值
 *  锁由核心消费测试钉——JSON Schema draft-07 无法跨键表达)。
 *  description/sourceRoot 刻意缺席:前者无 v0.1 生产者(模板目录元
 *  数据文件形态未考证——W25 真机顺带项,ORC-DEV-004 无实现不预留,
 *  P1 displayName 先例),后者无消费需求(哪根服务某 id 是 create 的
 *  冻结解析序非逐行事实)——发明即 schema 非法,负例向量钉死 */
export interface PackagesTemplateItemV01 {
  readonly id: string;
  readonly name: string;
}

export interface PackagesListTemplatesResultV01 {
  readonly schemaVersion: "vua.packages-templates/v0.1";
  /** id 升序 = 冻结呈现事实(裸目录扫描序跨平台不稳定,呈现事实保
   *  桌面下拉确定性消费——F3 packageId 升序先例);空数组 = 诚实零
   *  模板应答(目录根缺失是事实非错误,R4 先例) */
  readonly templates: readonly PackagesTemplateItemV01[];
}


/* ---- 026 A1 写面(packages-ops v0.1,核心冻结批 2026-09-19;表态程序
 *  收敛:核心裁决 82a39c4 五点／环境库面考证 4a0f02f 实现零缺口／桌面
 *  表态 93752d5)。移除面双方法二段动词:packages.previewRemove = 同步
 *  只读 query(变更预览＋摘要指纹;无网络无依赖解析,写面族风险最小立
 *  程序样板),packages.applyRemove = 九态任务化写命令(携确认指纹,服
 *  务端复算漂移即拒——ORC-WF-003/004 纪律;桌面只做 UX 提示,权威判
 *  定在服务端,014 仲裁第 2 点)。九态任务语义(commandId 幂等/可取消/
 *  事件＋revision/恢复复检 inspect_required 绝不隐式续传——诚实纪律
 *  3)走应用契约任务面,不在本词表。审计收据(receipt)照 014 导入收据
 *  先例:确认指纹回显＋请求清单＋实际移除行;任务关联走任务面
 *  (taskId/revision),回流文档非持久链接。错误码族 vua.packages.*
 *  首面闭集一次立全(preview_drift/package_not_found/execution_failed
 *  ,guard 值 = code 后缀);projectPath 未注册复用
 *  vua.project.project_not_found(013/024 同事实同码);引擎未接线诚实
 *  缺席 vua.packages.unavailable(024 已立)维持。wire 路由候核心接线
 *  切片;served 能力位 = VpmCapabilities.remove_packages 门控 */

export type PackagesChangeKindV01 = "install" | "remove";

/** 变更行(端口 ChangeItemV1 投影):version/reason 可空(移除行 =
 *  null,null 是端口事实如实投影,非省略) */
export interface PackagesChangeItemV01 {
  readonly kind: PackagesChangeKindV01;
  readonly packageId: string;
  readonly version: string | null;
  readonly reason: string | null;
}

/** packages.previewRemove:同步只读变更预览(query;params 双键闭集,
 *  packageIds 显式非空闭列——无通配,无「移除全部」速记) */
export interface PackagesPreviewRemoveQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "packages.previewRemove";
  readonly params: {
    readonly projectPath: string;
    readonly packageIds: readonly string[];
  };
}

/** packages.applyRemove:任务化移除写命令(command;必携
 *  confirmedDigest = previewRemove 结果的 digest,服务端复算漂移即拒
 *  ,拒绝 = recoverable 冲突——重预览重确认,绝不静默覆盖) */
export interface PackagesApplyRemoveCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.applyRemove";
  readonly commandId: string;
  readonly params: {
    readonly projectPath: string;
    readonly packageIds: readonly string[];
    readonly confirmedDigest: string;
  };
}

/** kind=plan:确认面投影(items/conflicts/removeLegacyFiles/
 *  removeLegacyFolders/destructive/digest);destructive=true 时确认
 *  UI 必须警示(ADR-0006),权威判定仍在服务端。行闭集 = 虚假断言
 *  防线(无端口载体的发明字段在 schema 即非法,非「不鼓励」) */
export interface PackagesRemovePlanV01 {
  readonly schemaVersion: "vua.packages-ops/v0.1";
  readonly kind: "plan";
  readonly projectPath: string;
  readonly items: readonly PackagesChangeItemV01[];
  readonly conflicts: readonly string[];
  readonly removeLegacyFiles: readonly string[];
  readonly removeLegacyFolders: readonly string[];
  readonly destructive: boolean;
  /** FNV-1a(规范条目列表);applyRemove 的 confirmedDigest 绑定恰此值 */
  readonly digest: string;
}

/** kind=receipt:审计收据(变更清单＋实际结果,014 导入收据先例随
 *  A1 命令 Schema 冻结定形) */
export interface PackagesRemoveReceiptV01 {
  readonly schemaVersion: "vua.packages-ops/v0.1";
  readonly kind: "receipt";
  readonly projectPath: string;
  /** 用户确认的指纹回显——确认面与执行结果的审计关联 */
  readonly confirmedDigest: string;
  /** 请求清单照实回显(审计「变更清单」半面) */
  readonly requestedPackageIds: readonly string[];
  /** 后端实际移除的变更行(审计「实际结果」半面) */
  readonly removedItems: readonly PackagesChangeItemV01[];
}

/** kind=rejected:类型化守卫拒绝(guard 值 = code 后缀;A1 首面闭集
 *  一次立全,族 vua.packages.*) */
export type PackagesRemoveGuardV01 =
  | "preview_drift"
  | "package_not_found"
  | "execution_failed";

export interface PackagesRemoveRejectedV01 {
  readonly schemaVersion: "vua.packages-ops/v0.1";
  readonly kind: "rejected";
  readonly guard: PackagesRemoveGuardV01;
  /** vua.packages.* 稳定码(三值闭集,冻结 Schema pattern) */
  readonly code: string;
  readonly detail: string;
}

export type PackagesRemoveResultV01 =
  | PackagesRemovePlanV01
  | PackagesRemoveReceiptV01
  | PackagesRemoveRejectedV01;

/* ---- 026 A2 写面(packages-ops v0.2,核心冻结批 2026-09-19)。安装/升级
 *  面双方法二段动词,照提案面序「升级 = 安装同族,版本选择语义随 A2 冻结
 *  批落死」:packages.previewInstall = 同步只读 query(依赖解析可达仓库,
 *  在线刷新失败降级缓存〔ORC-ADP-006 同构〕;词面零披露字段——端口
 *  ChangePreviewV1 无载体,诚实边界见协议本),packages.applyInstall =
 *  九态任务化写命令(携确认指纹,服务端复算漂移即拒——ORC-WF-003/004;
 *  后端第二道比对〔Fix R2-7 legacy folders 计入摘要〕留作纵深防御)。
 *  版本选择语义:version=null = 解析器选最新稳定版;string = 钉死精确
 *  版本(升级/降级同语法,不立 upgrade 动词——端口 ChangeKindV1 闭集
 *  install|remove,v0.1 changeItem 行已全闭集)。安装预览的 plan 可含
 *  remove 行(冲突触发的移除是端口事实如实投影)。审计收据双变体:
 *  removeReceipt(v0.1 形状)与 installReceipt(requestedPackages 携版本
 *  选择语义 verbatim + appliedItems = 端口 {applied: items} verbatim,
 *  键集互斥)。guard 三值闭集维持不扩(preview 失败走信封错误
 *  vua.packages.preview_failed,不入 rejected 文档;任务内非 drift 非
 *  not_found 统一折 execution_failed 携原码——A1 纪律)。v0.1/v0.2 plan
 *  同键集:窄化按 schemaVersion 字面量,不按键集。served 能力位 =
 *  VpmCapabilities.preview_install 门控(packages.installOps 行,
 *  removeOps 先例);wire 路由候核心接线切片 */

/** 安装请求行(端口 PackageRequestV1 投影):version 必填可空,null =
 *  解析器选最新稳定版,string = 钉死精确版本 */
export interface PackagesPackageRequestV02 {
  readonly packageId: string;
  readonly version: string | null;
}

/** packages.previewInstall:同步只读安装/升级预览(query;params 双键
 *  闭集,packages 显式非空闭列且同 packageId 不得重复——负例钉死) */
export interface PackagesPreviewInstallQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "packages.previewInstall";
  readonly params: {
    readonly projectPath: string;
    readonly packages: readonly PackagesPackageRequestV02[];
  };
}

/** packages.applyInstall:任务化安装写命令(command;必携
 *  confirmedDigest = previewInstall 结果的 digest,服务端复算漂移即拒
 *  ,拒绝 = recoverable 冲突——重预览重确认,绝不静默覆盖) */
export interface PackagesApplyInstallCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.applyInstall";
  readonly commandId: string;
  readonly params: {
    readonly projectPath: string;
    readonly packages: readonly PackagesPackageRequestV02[];
    readonly confirmedDigest: string;
  };
}

/** kind=plan(v0.2,双 preview 方法共用):与 v0.1 removePlan 同形状,
 *  items 可含 install 与 remove 行;同键集窄化按 schemaVersion 字面量 */
export interface PackagesInstallPlanV02 {
  readonly schemaVersion: "vua.packages-ops/v0.2";
  readonly kind: "plan";
  readonly projectPath: string;
  readonly items: readonly PackagesChangeItemV01[];
  readonly conflicts: readonly string[];
  readonly removeLegacyFiles: readonly string[];
  readonly removeLegacyFolders: readonly string[];
  readonly destructive: boolean;
  /** FNV-1a(规范条目列表);applyInstall 的 confirmedDigest 绑定恰此值 */
  readonly digest: string;
}

/** kind=receipt(A2 安装变体):请求行 verbatim(携版本选择语义)＋
 *  后端实际应用行 verbatim */
export interface PackagesInstallReceiptV02 {
  readonly schemaVersion: "vua.packages-ops/v0.2";
  readonly kind: "receipt";
  readonly projectPath: string;
  /** 用户确认的指纹回显——确认面与执行结果的审计关联 */
  readonly confirmedDigest: string;
  /** 请求行照实回显(审计「变更清单」半面;version null = 解析器选) */
  readonly requestedPackages: readonly PackagesPackageRequestV02[];
  /** 后端实际应用的变更行(端口 {applied: items} verbatim) */
  readonly appliedItems: readonly PackagesChangeItemV01[];
}

/** guard 三值闭集维持 A1 冻结(A2 零新成员;preview 失败走信封错误面
 *  vua.packages.preview_failed,不入 rejected 文档) */
export type PackagesGuardV02 = PackagesRemoveGuardV01;

export interface PackagesOpsRejectedV02 {
  readonly schemaVersion: "vua.packages-ops/v0.2";
  readonly kind: "rejected";
  readonly guard: PackagesGuardV02;
  /** vua.packages.* 稳定码(三值闭集,冻结 Schema pattern) */
  readonly code: string;
  readonly detail: string;
}

export type PackagesInstallResultV02 =
  | PackagesInstallPlanV02
  | PackagesInstallReceiptV02
  | PackagesOpsRejectedV02;

/* ---- 026 A3 写面(packages-ops v0.3,核心冻结批 2026-09-19)。本地包
 *  注册面单方法,族中唯一无 preview 对偶的写面:端口无 preview 方法
 *  (实现注释明示「注册与 preview/apply 刻意分离——常规摘要绑定安装
 *  路径独占一切项目变更」),注册是幂等集合添加(库面 AlreadyAdded 答
 *  成功,不区分首次/重复),非破坏性(只加一行用户包条目,不删不改)。
 *  九态任务化写命令(写命令族一致形状——applyRemove/applyInstall/
 *  project.setNote 同构):无 confirmedDigest(无既有状态可漂移,用户
 *  显式提交即确认——A5 create_project 表态同向;ADR-0006 破坏性警示
 *  路径不适用,本面不发明破坏性事实)。rejected 臂 guard 闭集零新增
 *  (照 A2 折叠纪律——全部后端守卫折 execution_failed 携原码 detail
 *  溯源;复用码 vua.vpm.* 永不入 rejected code 键)。served 能力位 =
 *  新 default accessor register_capabilities() 门控(default
 *  declared-none,025 catalog_capabilities 同律;packages.registerOps
 *  行,一行一方法,removeOps/installOps 先例;VrcGetLib 覆写随环境
 *  实现核对切片);wire 路由候核心接线切片 */

/** packages.registerLocalPackage:任务化本地包注册写命令(command;
 *  params 单键闭集 {packageRoot} = 本地包根目录(含 package.json),
 *  端口 package_root verbatim camelCase 投影;无 projectPath——注册
 *  只动后端隔离环境,不触项目、不触用户 VCC/ALCOM 设置) */
export interface PackagesRegisterCommandV03 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.registerLocalPackage";
  readonly commandId: string;
  readonly params: {
    readonly packageRoot: string;
  };
}

/** kind=registered(A3 注册收据):最小诚实审计形状——端口答
 *  Result<(), _> 无载荷,收据只携请求回显(packageRoot),别无他物;
 *  AlreadyAdded 幂等折叠 = 无首次/重复事实,additionalProperties:false
 *  禁止发明(负例 invalid-register-invented-field 钉死) */
export interface PackagesRegisterReceiptV03 {
  readonly schemaVersion: "vua.packages-ops/v0.3";
  readonly kind: "registered";
  /** 请求的 packageRoot 回显——本面唯一的审计事实 */
  readonly packageRoot: string;
}

export interface PackagesRegisterRejectedV03 {
  readonly schemaVersion: "vua.packages-ops/v0.3";
  readonly kind: "rejected";
  readonly guard: PackagesGuardV02;
  /** vua.packages.* 稳定码(三值闭集,冻结 Schema pattern);原端口码
   *  (vua.vpm.local_package_invalid / vua.vpm.local_package_register_
   *  failed)在 detail 原词溯源,不入 code 键 */
  readonly code: string;
  readonly detail: string;
}

export type PackagesRegisterResultV03 =
  | PackagesRegisterReceiptV03
  | PackagesRegisterRejectedV03;

/* ---- 026 A4 写面(packages-ops v0.4,核心冻结批 2026-09-19)。仓库
 *  订阅增删面三方法:packages.addRemoteRepo / packages.addLocalRepo /
 *  packages.removeRepo,各一一映射端口方法(add_remote_repo /
 *  add_local_repo / remove_repo)。照 A3 同律破 preview/apply 对偶——
 *  本面无 preview 臂:远端订阅天然含清单拉取网络段(预览无法在不做同
 *  样网络工作的前提下验证可达性),且无既有状态摘要可绑定(订阅列表
 *  可漂移,诚实失败模式=执行时端口答 repo_not_found,绝非摘要仪式);
 *  九态任务化写命令(写命令族一致形状;远端网络段使可取消性成为实质)。
 *  订阅面只写后端隔离环境(A3 同事实:绝不触用户 VCC/ALCOM 设置、
 *  不触项目)——三方法均不收 projectPath,013 project_not_found 复用
 *  对本面不适用。用户显式提交即确认(A3/A5 同向;删除订阅行不删任何
 *  包文件与项目内容,ADR-0006 破坏性警示路径不适用;携 confirmedDigest
 *  =形状违反,负例钉死)。rejected 臂 guard 闭集零新增(照 A1/A2/A3
 *  折叠纪律——全部端口拒绝折 execution_failed 携原码 detail 溯源:
 *  vua.vpm.repo_invalid / repo_not_found / repo_fetch_failed /
 *  repo_write_failed;复用码永不入 rejected code 键)。served 能力位 =
 *  新 default accessor repo_write_capabilities() 三独立位门控(default
 *  declared-none,025 catalog_capabilities 同律;packages.repoOps 一行
 *  服务三方法,removeOps/installOps/registerOps 一行先例;VrcGetLib
 *  覆写随环境实现核对切片);wire 路由候核心接线切片。首期词面不收
 *  HTTP 头/凭据传输(未来收凭据的面需另立安全裁决);启停(enable/
 *  disable)不在任何已冻结词面内,候 W25 VCC 禁用列表键名真机核实;
 *  重排不在本面(增删先行裁决词面) */

/** packages.addRemoteRepo:任务化远端仓库订阅写命令(command;
 *  params 双键闭集 {url, name}=仓库 URL＋必填显示名;无 projectPath、
 *  无 digest 位;首期词面不收 HTTP 头/凭据) */
export interface PackagesAddRemoteRepoCommandV04 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.addRemoteRepo";
  readonly commandId: string;
  readonly params: {
    readonly url: string;
    readonly name: string;
  };
}

/** packages.addLocalRepo:任务化本地目录仓库订阅写命令(command;
 *  params 双键闭集 {path, name};无网络段) */
export interface PackagesAddLocalRepoCommandV04 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.addLocalRepo";
  readonly commandId: string;
  readonly params: {
    readonly path: string;
    readonly name: string;
  };
}

/** packages.removeRepo:任务化订阅移除写命令(command;
 *  params 单键闭集 {repoId}=仓库 id(稳定行柄;索引寻址不冻结——索引
 *  在并发写下漂移);未知 repoId=执行时端口答 repo_not_found;id 缺席
 *  行在本词面移除可达范围之外(协议本载明的诚实边界)) */
export interface PackagesRemoveRepoCommandV04 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.removeRepo";
  readonly commandId: string;
  readonly params: {
    readonly repoId: string;
  };
}

/** kind=repoReceipt(A4 添加收据)remote 变体:最小诚实审计形状——端口
 *  答 Result<(), _> 无载荷,收据只携请求回显(url＋name);键集与
 *  local 变体互斥,与一切前代收据臂互斥;additionalProperties:false
 *  禁止发明时间戳/行位/清单内容 */
export interface PackagesRemoteRepoAddedV04 {
  readonly schemaVersion: "vua.packages-ops/v0.4";
  readonly kind: "repoReceipt";
  readonly repoType: "remote";
  readonly url: string;
  readonly name: string;
}

/** kind=repoReceipt(A4 添加收据)local 变体:path＋name 回显;键集与
 *  remote 变体互斥 */
export interface PackagesLocalRepoAddedV04 {
  readonly schemaVersion: "vua.packages-ops/v0.4";
  readonly kind: "repoReceipt";
  readonly repoType: "local";
  readonly path: string;
  readonly name: string;
}

/** kind=removed(A4 移除收据):被删行 repoId 回显——本面唯一事实(端口
 *  答 unit;回显即审计链;不发明被删行快照——行可携本面从不过手的
 *  id 缺席事实);键集与一切收据臂互斥 */
export interface PackagesRepoRemovedV04 {
  readonly schemaVersion: "vua.packages-ops/v0.4";
  readonly kind: "removed";
  readonly repoId: string;
}

export interface PackagesRepoRejectedV04 {
  readonly schemaVersion: "vua.packages-ops/v0.4";
  readonly kind: "rejected";
  readonly guard: PackagesGuardV02;
  /** vua.packages.* 稳定码(三值闭集,冻结 Schema pattern);原端口码
   *  (vua.vpm.repo_invalid / repo_not_found / repo_fetch_failed /
   *  repo_write_failed)在 detail 原词溯源,不入 code 键 */
  readonly code: string;
  readonly detail: string;
}

export type PackagesAddRemoteRepoResultV04 =
  | PackagesRemoteRepoAddedV04
  | PackagesRepoRejectedV04;

export type PackagesAddLocalRepoResultV04 =
  | PackagesLocalRepoAddedV04
  | PackagesRepoRejectedV04;

export type PackagesRemoveRepoResultV04 =
  | PackagesRepoRemovedV04
  | PackagesRepoRejectedV04;

/* ---- 026 A5 写面(packages-ops v0.5,核心冻结批 2026-09-19)。项目创建
 *  单方法:packages.createProject,一一映射端口方法 create_project
 *  (parent, name, template)。无 preview 对偶第二员(A3/A4 同律,此面
 *  根在端口:端口恰一个创建方法、无 create-preview 对应——预览臂会
 *  在 wire 面立端口后不存在的 方法;全新项目目录无既有状态可
 *  diff,无摘要可绑定,026 A5 核心表态与桌面入口需求表态同向)。用
 *  户显式表单提交即确认(桌面 A5 第 2 点:表单提交本身即显式确认,
 *  不进双摘要确认链——创建新目录不触任何在册项目、包文件、他项目
 *  内容,ADR-0006 破坏性警示路径无可警示;携 confirmedDigest=形状
 *  违反正例钉死)。不收 projectPath(创建不寻址任何在册项目,013
 *  project_not_found 复用不适用;携即形状违反负例钉死)。九态任务化
 *  写命令(写命令族一致形状;模板目录复制可长时且 copy_tree 段无进
 *  度回调——可观察/可恢复骑既有任务权威;恢复非终态 inspect_
 *  required 绝不隐式续传,诚实纪律 3)。模板参数 REQUIRED-nullable
 *  照 A2 版本选择同构:null=后端默认模板解析(库路径默认 Avatar 三
 *  级解析序——冻结词面事实,非选择器:首面零新读面,templates.*
 *  枚举不存在,桌面如实呈现所用模板不虚构下拉,诚实纪律 1);非空
 *  串=该模板名/路径 verbatim 透传。收据事实:成功答端口 ProjectRef
 *  {id, root}——packages-ops 族唯一有实际载荷的收据;kind=created
 *  携 projectId+projectPath 回显。创建即在册副作用=冻结端口事实
 *  (双后端成功路径尾调 FileSystemProjectStore::initialize):创建成
 *  功即在册,在册列表刷新即见;词面绝不虚构「仅建目录不登记」形状。
 *  能力门=既有 VpmCapabilities.create_project 五位居(A5 零新
 *  accessor,与 A3/A4 不同:位先于本批存在且双在库后端已诚实声明),
 *  wire 门 submit 前读位,假位答通用 capability_missing 绝不进任务;
 *  桌面消费侧能力呈现须新立(不可复用 blocks.changes——语义=变更预
 *  览可用性,与「可新建项目」不同构)。双后端拒绝形状不同构如实载
 *  明(库路径四 i18n 键共享 vua.vpm.template_missing 一码——i18n 消
 *  息键与端口错误码系两层;CLI 路径 vua.vpm.apply_failed 携 exitCode
 *  ＋vua.vpm.backend_unavailable),不虚构统一形状。wire 路由候核心
 *  接线切片;零端到端宣称维持 */

/** packages.createProject:任务化项目创建写命令(command;
 *  params 三键闭集 {parent, name, template},template REQUIRED-
 *  nullable(null=后端默认解析);无 projectPath、无 digest 位) */
export interface PackagesCreateProjectCommandV05 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.createProject";
  readonly commandId: string;
  readonly params: {
    /** 新项目目录的父目录(端口 parent verbatim;路径事实,非在册项目
     *  身份——创建不寻址任何在册项目) */
    readonly parent: string;
    /** 新项目名(端口 name verbatim;后端名称校验为执行时权威,本词表
     *  不重审上游名称语法;表单前置校验镜像后端规则仅作 UI 引导) */
    readonly name: string;
    /** 模板选择:null=后端默认模板解析(库路径默认 Avatar 三级解析序
     *  ——冻结词面事实,非选择器,首面零新读面);非空串=该模板名/路
     *  径 verbatim 透传 */
    readonly template: string | null;
  };
}

/** kind=created(A5 创建收据):端口 ProjectRef {id, root} 投影——
 *  packages-ops 族唯一有实际结果载荷的收据(不同于答 unit 的 A3/A4
 *  面)。projectId=ProjectRef.id 回显(后端铸造的创建事实,信息性标
 *  识;非 013 项目身份键——项目身份仍是路径);projectPath=ProjectRef
 *  .root 回显(新项目根目录=注册路径身份:创建即在册副作用=冻结端
 *  口事实——双后端成功路径尾调 FileSystemProjectStore::initialize,
 *  创建成功即在册、在册列表刷新即见;不虚构「仅建目录不登记」形状)。
 *  additionalProperties:false 禁止发明创建时间戳/复制统计/包清单;
 *  键集与一切前代收据臂互斥 */
export interface PackagesProjectCreatedV05 {
  readonly schemaVersion: "vua.packages-ops/v0.5";
  readonly kind: "created";
  readonly projectId: string;
  readonly projectPath: string;
}

export interface PackagesCreateRejectedV05 {
  readonly schemaVersion: "vua.packages-ops/v0.5";
  readonly kind: "rejected";
  readonly guard: PackagesGuardV02;
  /** vua.packages.* 稳定码(三值闭集,冻结 Schema pattern);原端口码
   *  (vua.vpm.template_missing——库路径四 i18n 键共享载体 /
   *  vua.vpm.apply_failed——CLI 超时/非零退出携 exitCode 与登记腿 /
   *  vua.vpm.backend_unavailable——CLI runner 故障)在 detail 原词溯
   *  源,不入 code 键 */
  readonly code: string;
  readonly detail: string;
}

export type PackagesCreateProjectResultV05 =
  | PackagesProjectCreatedV05
  | PackagesCreateRejectedV05;

/* ---- 027 F4 写面(packages-ops v0.6,核心冻结批 2026-09-20)。仓库生命周期
 *  面三方法:packages.enableRepo / packages.disableRepo /
 *  packages.refreshRepo,各一一映射端口方法(enable_repo / disable_repo /
 *  refresh_repo)。A4 v0.4 词面之外节预告的启停面就此解冻——W25 只读取证
 *  记录(027 提案 s6)结论裁决 (c):VCC 2.4.5 全文/liteDb 两集合/Repos 缓存
 *  形态均无任何启停状态,启停系 VUA 自有语义,无可共享 counterpart;存储
 *  裁决=VUA 自有存储(环境根下 .vua 惯例文件),绝不入 userRepos[i] 元素
 *  (vrc-get 自身 save 剥未知元素键——源码事实 4 对 VUA 自身同样成立)、
 *  绝不立 settings.json 顶层新键(VCC/ALCOM 写方对未知顶层键的容忍未经
 *  真机核实——共享文件只载共享事实,F1 如实口径方向)。三方法均无 preview
 *  臂(A3/A4 同律):启停为单行原子状态翻转(无既有状态摘要可 diff,
 *  ADR-0006 破坏性警示路径无可警示),刷新即网络行为本体(A4 远端订阅同
 *  律——预览无法不做同样网络工作而验证可达性);携 confirmedDigest 或
 *  projectPath=形状违反,负例钉死。禁用语义=该行离开包集合世界(枚举与
 *  解析面〔repo-catalog 列表/latest 判定/安装解析器〕不再见其包),但订阅
 *  面继续列出行与本批冻结的 packages-repos v0.2 enabled 位读回——禁用对
 *  配置视图零隐藏;新添加订阅行恒为 enabled(添加面重置同 id 残留状态),
 *  移除行不留状态残留。刷新语义=该行自身缓存文件(userRepos[i].localPath)
 *  的 etag 条件刷新(vrc-get 自身刷新同源同写;official/curated 预定义缓
 *  存在订阅世界无 repoId,本面不可达);refreshed 收据必携 cacheUpdated
 *  (库面 update_cache 两臂事实:写新缓存/etag 未变「已是最新」——两臂皆
 *  成功,「无新数据」是刷新结果绝非错误)。九态任务化写命令(写命令族一
 *  致形状;刷新网络段使可取消性成为实质);恢复=非终态残留映射
 *  inspect_required 绝不隐式续传(诚实纪律 3)。rejected 臂 guard 三值闭
 *  集零新增(A1/A2 折叠纪律——端口拒绝折 execution_failed 携原码 detail:
 *  vua.vpm.repo_not_found〔未知 repoId,A4 removeRepo 同事实〕/
 *  repo_write_failed〔启停状态文件或刷新缓存写回失败〕/repo_fetch_failed
 *  〔刷新网络段〕;三码全系 A4 批既有零新立,复用码永不入 code 键)。
 *  served 能力位=新 default accessor repo_lifecycle_capabilities() 三独立
 *  位门控(后端可只服务子集,门按方法绝不按面;default declared-none,
 *  025 catalog_capabilities 同律 ORC-DEV-004;packages.repoLifecycleOps 一
 *  行服务三方法,repoOps 一行先例;VrcGetLib 覆写随环境实现核对切片;CLI
 *  后端无生命周期面如实假);wire 路由候核心接线切片。零端到端宣称——
 *  本面已冻结未接线未消费,真机走查归 W25(O-2) */

/** packages.enableRepo:任务化订阅行启用写命令(command;params 单键闭集
 *  {repoId}=仓库 id 稳定行柄;未知 repoId=执行时端口答 repo_not_found;
 *  id 缺席行在本词面可达范围之外〔协议本载明诚实边界〕;无 digest 位——
 *  用户显式提交即确认) */
export interface PackagesEnableRepoCommandV06 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.enableRepo";
  readonly commandId: string;
  readonly params: {
    readonly repoId: string;
  };
}

/** packages.disableRepo:任务化订阅行禁用写命令(command;单键闭集
 *  {repoId};禁用行离开包集合世界但保留在订阅面+v0.2 enabled 位) */
export interface PackagesDisableRepoCommandV06 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.disableRepo";
  readonly commandId: string;
  readonly params: {
    readonly repoId: string;
  };
}

/** packages.refreshRepo:任务化订阅行缓存刷新写命令(command;单键闭集
 *  {repoId};网络段为执行本体,无 preview 臂) */
export interface PackagesRefreshRepoCommandV06 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "packages.refreshRepo";
  readonly commandId: string;
  readonly params: {
    readonly repoId: string;
  };
}

/** kind=enabled(A4 removed 臂同构最小审计形状):端口答 Result<(), _>
 *  无载荷,收据只携 repoId 回显;新状态本身经 packages-repos v0.2 订阅面
 *  读回,收据绝不重复——additionalProperties:false 禁止发明切换时间戳/
 *  前状态回显;与 removed/enabled/disabled 臂以 kind 常量判别,绝不按键集 */
export interface PackagesRepoEnabledV06 {
  readonly schemaVersion: "vua.packages-ops/v0.6";
  readonly kind: "enabled";
  readonly repoId: string;
}

/** kind=disabled:repoId 回显;禁用行离开包集合世界但保留订阅面 */
export interface PackagesRepoDisabledV06 {
  readonly schemaVersion: "vua.packages-ops/v0.6";
  readonly kind: "disabled";
  readonly repoId: string;
}

/** kind=refreshed(A4 收据族唯一新增事实):cacheUpdated 必带=库面
 *  update_cache 两臂结果(true=etag 条件抓取写入新缓存;false=etag 未变
 *  「已是最新」)——两臂皆成功;无字节计数/包清单发明(键集即非法) */
export interface PackagesRepoRefreshedV06 {
  readonly schemaVersion: "vua.packages-ops/v0.6";
  readonly kind: "refreshed";
  readonly repoId: string;
  readonly cacheUpdated: boolean;
}

export interface PackagesRepoRejectedV06 {
  readonly schemaVersion: "vua.packages-ops/v0.6";
  readonly kind: "rejected";
  readonly guard: PackagesGuardV02;
  /** vua.packages.* 稳定码(三值闭集,冻结 Schema pattern);原端口码
   *  (vua.vpm.repo_not_found / repo_write_failed / repo_fetch_failed,
   *  A4 批既有零新立)在 detail 原词溯源,不入 code 键 */
  readonly code: string;
  readonly detail: string;
}

export type PackagesEnableRepoResultV06 =
  | PackagesRepoEnabledV06
  | PackagesRepoRejectedV06;

export type PackagesDisableRepoResultV06 =
  | PackagesRepoDisabledV06
  | PackagesRepoRejectedV06;

export type PackagesRefreshRepoResultV06 =
  | PackagesRepoRefreshedV06
  | PackagesRepoRejectedV06;


/** 单条可采纳下载(bdl-queries v0.4 冻结面镜像):仅传输事实＋采纳关联,
 *  路径永不过 wire;renderer 从不由此推导产品身份 */
export interface DownloadsListCompletedItemV04 {
  readonly downloadId: string;
  readonly sourceUrl: string;
  /** 服务端建议/派生文件名;端口未报告时 null */
  readonly suggestedFileName: string | null;
  readonly receivedBytes: number;
  readonly completedAt: string;
  /** 内容关联本下载的仓储条目(空 = 尚未采纳;写面不阻止重复采纳,呈现
   *  层以此标注已采纳) */
  readonly adoptedWarehouseItemIds: readonly string[];
}

/** bdl-queries v0.4 冻结 wire 信封(021 先例对齐,桌面 TS 登记面 2026-09-18):
 *  外层三键闭集 + result 本体(downloadsListCompletedResult 冻结行六键闭集);
 *  平铺消费即类型错误,renderer 经 narrowCompletedDownloads 信封窄化取行 */
export interface DownloadsListCompletedResultV04 {
  readonly schemaVersion: "0.5";
  readonly operation: "downloads.listCompleted";
  readonly result: {
    readonly downloads: readonly DownloadsListCompletedItemV04[];
  };
}

// ---- dependencies.*(bdl-queries v0.5 additive 两成员,030 §5.7 案 A,数据席
//      第 168 批 FROZEN;桌面 TS 登记面 2026-09-22。词面骑 BDL v0.2 冻结闭集
//      (schemas/bdl/v0.2,先于本词表);两方法只读,零写词。「线索非结论」律:
//      lookup 是建议面——resolvedProductId 仅人工确认消解出线、advisory 非空
//      当且仅当版面刻意声明＋安装源可证;listByProduct 是未过滤观察面——
//      未确认消解以 confirmed:false 如实出线为带标注线索。镜像纪律:全部
//      闭集(depKind 四值/sourceSpan 五值/extractionMethod 六值/installSource
//      四值/confidence 两档/productStatus 两值/params 键集/回执键集)照冻结
//      Schema 逐字镜像,零臆造零增删) ----

/** BDL v0.2 dep_kind 四值冻结闭集(schema 的 additionalProperties 词面:无第五
 *  成员——引擎/SDK 钉行存为 other,钉值在 versionHint;词表外 depKind =
 *  契约错误,负例向量钉死 v0.2 N1 同一裁决面) */
export type DependencyKindV05 = "shader" | "tool_package" | "avatar_base" | "other";

/** BDL v0.2 source_span 五值冻结闭集(逐字引文取自页面位置) */
export type DependencySourceSpanV05 =
  | "body"
  | "subproduct_name"
  | "image"
  | "title"
  | "description_link";

/** BDL v0.2 extraction_method 六值冻结闭集(版面形态;advisory confidence 两档
 *  只骑此维度——explicit_heading/one_line=strong,bullet=weak,prose/title/
 *  link 低于建议线) */
export type DependencyExtractionMethodV05 =
  | "explicit_heading"
  | "bullet"
  | "one_line"
  | "prose"
  | "title"
  | "link";

/** proposal 030 §3.2 冻结四值闭集:规则 v1 只从确认消解目标的 source 主机
 *  派生 booth_page/external_page 并发射;vpm/unknown 留在闭集内供规则升版,
 *  v1 绝不发射(库内无 VPM 仓库事实,凭空宣称即猜测) */
export type DependencyInstallSourceV05 = "vpm" | "booth_page" | "external_page" | "unknown";

/** advisory confidence 两档(只骑版面维度;映射本体 = 协议版本化 advisory
 *  规则表 v1,规则变更升本协议版本,绝不原地改写) */
export type DependencyAdvisoryConfidenceV05 = "strong" | "weak";

/** BDL v0.2 resolution_evidence 元素四键形状逐字复用(store 层硬律:resolution
 *  在场 ⇒ evidence 非空,骑冻结 CHECK) */
export interface DependencyResolutionEvidenceV05 {
  readonly linkText: string;
  readonly linkUrl: string;
  readonly span: DependencySourceSpanV05;
  readonly note: string | null;
}

/** 带确认状态的消解:confirmed:false = 带标注线索(030 §1 样例 3 错链实证
 *  落点;身份消解默认未确认),confirmed:true = 在案人工结论(翻 1 是建库
 *  切片写动作,本只读族绝不发生) */
export interface DependencyResolutionV05 {
  readonly productId: string;
  readonly confirmed: boolean;
  readonly evidence: readonly DependencyResolutionEvidenceV05[];
}

/** 观察行(listByProduct 线索面):全证据体含提取身份与观察时刻(确认工作流
 *  消费);无 advisory——建议推导是 lookup 的职责,本面如实列观察 */
export interface DependencyObservationV05 {
  readonly depKind: DependencyKindV05;
  /** 页面原文名义,零归一化 */
  readonly depName: string;
  /** 原文版本串('2.3.2~');null = 页面未钉版本(诚实缺席),承载全部版本约束 */
  readonly versionHint: string | null;
  /** 页面逐字引文(证据体,零语义改写) */
  readonly rawQuote: string;
  readonly sourceSpan: DependencySourceSpanV05;
  readonly extractionMethod: DependencyExtractionMethodV05;
  /** 提取者身份('human' 首落;开放词面——BDL v0.2 置信维度 2,不与
   *  extractionMethod 合并) */
  readonly extractedBy: string;
  /** 管线观察时刻,绝非 BOOTH 发布时刻 */
  readonly observedAt: string;
  /** null = 页面无可消解链接线索 */
  readonly resolution: DependencyResolutionV05 | null;
}

/** 建议载体(advisory;永不是事实断言):null = 该观察不出建议(版面低于
 *  建议线/消解未确认/安装源不可证——行仍有效在库) */
export interface DependencyInstallAdvisoryV05 {
  readonly installSource: DependencyInstallSourceV05;
  readonly confidence: DependencyAdvisoryConfidenceV05;
}

/** 建议面单行(lookup):证据键逐字;resolvedProductId 仅人工确认消解出线
 *  (null = 无消解或未确认,不区分不泄露);刻意缺席(admission 律):
 *  extractedBy/observedAt 不上 lookup 线面,路径零出现 */
export interface DependencyMatchV05 {
  /** 声明依赖的商品身份 */
  readonly productId: string;
  /** 声明商品标题;null = 诚实缺席 */
  readonly productTitle: string | null;
  /** 声明商品逐字可得性原词(双字段律证据面) */
  readonly availabilityRaw: string | null;
  /** 派生稳定枚举;UI 唯一消费 */
  readonly availabilityStatus: CatalogAvailabilityStatusV03;
  readonly depKind: DependencyKindV05;
  readonly depName: string;
  readonly versionHint: string | null;
  readonly rawQuote: string;
  readonly sourceSpan: DependencySourceSpanV05;
  readonly extractionMethod: DependencyExtractionMethodV05;
  readonly resolvedProductId: string | null;
  readonly advisory: DependencyInstallAdvisoryV05 | null;
}

export interface DependenciesLookupQueryV05 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "dependencies.lookup";
  readonly params: {
    /** 依赖名义(调用方所持原文);匹配规则 v1 = dep_name 大小写不敏感精确
     *  (ASCII 折叠),零子串/模糊/等价 */
    readonly name: string;
    /** 可选过滤骑 BDL v0.2 四值闭集;null/缺席 = 不过滤 */
    readonly depKind?: DependencyKindV05 | null;
    /** 1–200,默认 50 */
    readonly limit?: number;
    /** ≥ 0,默认 0 */
    readonly offset?: number;
  };
}

export interface DependenciesListByProductQueryV05 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "dependencies.listByProduct";
  readonly params: {
    /** 命名空间身份(同 catalog.detail pattern);未知 = 应用面 not-found,
     *  绝不伪造空答;无 name/过滤键——客户端过滤 = 契约错误 */
    readonly productId: string;
  };
}

/** bdl-queries v0.7(N5 静默下载):单商品已捕获文件清单查询。数据来自
 *  BDL v0.4 product_downloadables(库页同步时的稳定直链捕获);已知商品
 *  零捕获 = 诚实空集(下载流再补抓),未知商品 = not-found 事实 */
export interface CatalogProductDownloadablesQueryV07 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "catalog.productDownloadables";
  readonly params: {
    readonly productId: string;
  };
}

/** v0.7 wire 信封(同 021 先例):外层 const "0.7" + operation 字面量 */
export interface CatalogProductDownloadablesResultV07 {
  readonly schemaVersion: "0.7";
  readonly operation: "catalog.productDownloadables";
  readonly result: {
    readonly productId: string;
    /** 行序 = (first_seen_at, downloadable_id) 升序(捕获序,确定性) */
    readonly items: readonly {
      /** BOOTH 稳定逐文件 id(downloadables/{id} 数字) */
      readonly downloadableId: number;
      /** 库页原样文件名;空串 = 页面未示名(诚实缺席) */
      readonly fileName: string;
    }[];
  };
}

/** bdl-queries v0.5 冻结 wire 信封(021 先例对齐):外层三键闭集(schemaVersion
 *  const "0.5" + operation 字面量),内层 result 才是结果本体;平铺消费即类型
 *  错误。total:0 + matches:[] = 「无匹配名义」(按当前规则表),绝不渲染成
 *  「不存在该依赖」——低于建议门的观察留在库内,listByProduct 是未过滤面 */
export interface DependenciesLookupResultV05 {
  readonly schemaVersion: "0.5";
  readonly operation: "dependencies.lookup";
  readonly result: {
    /** 匹配观察总数(limit/offset 截取前计算) */
    readonly total: number;
    /** 行序 = productId 升序后观察身份升序(身份派生,确定性分页) */
    readonly matches: readonly DependencyMatchV05[];
  };
}

/** tombstone 诚实面:missing = 来源页已死(404/410 留存不删),观察列照常
 *  可读——确认工作流必须仍能看到死页的声明与线索 */
export type DependencyProductStatusV05 = "complete" | "missing";

export interface DependenciesListByProductResultV05 {
  readonly schemaVersion: "0.5";
  readonly operation: "dependencies.listByProduct";
  readonly result: {
    readonly productId: string;
    readonly productStatus: DependencyProductStatusV05;
    /** 行序 = 观察身份升序(插入序,确定性);两面同库同源,对照呈现即
     *  「线索非结论」律的落点 */
    readonly observations: readonly DependencyObservationV05[];
  };
}

export interface WarehouseEntryDetailQueryV03 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "warehouse.entryDetail";
  readonly params: { readonly warehouseItemId: string };
}

export interface CatalogPriceV03 {
  /** 字符串金额 + 币种(禁用 JS number 表示货币);仅单价商品有值 */
  readonly amount: string;
  readonly currency: string;
}

/** v0.2 双字段:raw = 观测原词(证据,可为裸词或完整 schema.org URL,永不
 *  归一化);status = 处理器按版本化规则表派生的稳定枚举 */
export interface CatalogAvailabilityPairV03 {
  readonly raw: string | null;
  readonly status: CatalogAvailabilityStatusV03;
}

export interface CatalogProductSummaryV03 {
  /** booth:<数字> 命名空间身份 */
  readonly productId: string;
  readonly title: string | null;
  readonly price: CatalogPriceV03 | null;
  /** 恒等于 imageUrls[0] 或 null;经 vuaimg 缓存协议承载 */
  readonly imageUrl: string | null;
  readonly imageUrls: readonly string[];
  readonly availabilityRaw: string | null;
  readonly availabilityStatus: CatalogAvailabilityStatusV03;
  /** v0.2 诚实空槽:实体存储属 BDL v2 */
  readonly entityCount: 0;
  readonly entityTypes: readonly [];
}

/** bdl-queries 冻结 wire 信封(021 先例对齐,桌面 TS 登记面 2026-09-18;
 *  2026-09-22 核心 v0.5 接线批信封常量随版 0.4→0.5,词面零变化):
 *  外层三键闭集(schemaVersion const "0.5" + operation 字面量),内层 result
 *  才是 catalog.list 结果本体(冻结字段面原样内联);平铺消费即类型错误 */
export interface CatalogListResultV03 {
  readonly schemaVersion: "0.5";
  readonly operation: "catalog.list";
  readonly result: {
    /** 分页总数(limit/offset 截取前计算) */
    readonly total: number;
    readonly entries: readonly CatalogProductSummaryV03[];
  };
}

export interface CatalogSubproductV03 {
  readonly variationId: string | null;
  readonly name: string | null;
  readonly price: CatalogPriceV03 | null;
  readonly availabilityRaw: string | null;
  readonly availabilityStatus: CatalogAvailabilityStatusV03;
}

export interface CatalogProductDetailV03 {
  readonly productId: string;
  readonly title: string | null;
  readonly price: CatalogPriceV03 | null;
  readonly imageUrl: string | null;
  readonly imageUrls: readonly string[];
  readonly availabilityRaw: string | null;
  readonly availabilityStatus: CatalogAvailabilityStatusV03;
  readonly entityCount: 0;
  readonly entityTypes: readonly [];
  readonly description: string | null;
  readonly shopName: string | null;
  readonly shopUrl: string | null;
  /** BOOTH 年龄限制原词(null = 无标注;与 bdl-queries v0.3 schema required 对齐) */
  readonly ageRestriction: string | null;
  /** 仅显式 BOOTH Adult 徽标为真 */
  readonly adult: boolean;
  readonly videoUrls: readonly string[];
  /** BOOTH 展示分类,无推断 */
  readonly sourceCategory: string | null;
  readonly subproducts: readonly CatalogSubproductV03[];
}

/** 信封形态同 CatalogListResultV03(021 先例,2026-09-18 对齐):result 本体
 *  携 detail 未命中前仅成功面的 product 文档 */
export interface CatalogDetailResultV03 {
  readonly schemaVersion: "0.5";
  readonly operation: "catalog.detail";
  readonly result: {
    readonly product: CatalogProductDetailV03;
  };
}

export type CatalogHealthV03 = "unknown" | "ok" | "incompatible";

export interface CatalogRevisionV03 {
  /** 观察管线簿记计数器落地前恒 null */
  readonly catalogUpdatedSeq: number | null;
  /** v0.2 = BDL format_version */
  readonly datasetRevision: string;
}

/** 信封形态同 CatalogListResultV03(021 先例,2026-09-18 对齐);mock 未知
 *  健康语义经 result.health 承载不变 */
export interface CatalogStatusResultV03 {
  readonly schemaVersion: "0.5";
  readonly operation: "catalog.status";
  readonly result: {
    readonly health: CatalogHealthV03;
    readonly revision: CatalogRevisionV03;
  };
}

export type WarehouseArtifactStateV03 = "pending" | "clean" | "quarantined";

export type WarehouseArtifactRoleV03 = "original" | "generated_vpm";

export interface WarehouseArtifactRefV03 {
  readonly relativePath: string;
  /** sha256:<64 位小写十六进制> */
  readonly artifactSha256: string;
  readonly state: WarehouseArtifactStateV03;
  readonly sizeBytes: number;
  /** 副本角色(v0.3):原始包 / 生成 VPM 包 */
  readonly role: WarehouseArtifactRoleV03;
}

/** 条目 kind 闭集(v0.3 收敛);生成 VPM 属 local_vpm 工件族,不新增 kind */
export type WarehouseEntryKindV03 = "imported_material" | "downloaded_material";

export type WarehouseArtifactModeV03 = "use_original_unitypackage" | "generate_vpm";

export interface WarehouseEntryCardV03 {
  /** VUA 生成身份,稳定且不从显示名派生 */
  readonly warehouseItemId: string;
  readonly folderName: string;
  readonly displayName: string;
  readonly kind: WarehouseEntryKindV03;
  readonly createdAt: string;
  readonly artifacts: readonly WarehouseArtifactRefV03[];
  /** 每条目消费偏好覆盖;null = 跟随全局默认 */
  readonly artifactMode: WarehouseArtifactModeV03 | null;
  /** 读取时动态解析:覆盖 ?? 全局默认;只是偏好,不代表 VPM 已存在 */
  readonly effectiveArtifactMode: WarehouseArtifactModeV03;
}

/** 信封形态同 CatalogListResultV03(021 先例,2026-09-18 对齐);诚实空集经
 *  result.entries 承载不变 */
export interface WarehouseListEntriesResultV03 {
  readonly schemaVersion: "0.5";
  readonly operation: "warehouse.listEntries";
  readonly result: {
    readonly entries: readonly WarehouseEntryCardV03[];
  };
}

export interface WarehouseArtifactFactV03 extends WarehouseArtifactRefV03 {
  readonly suggestedFileName: string | null;
  /** 机械判定时刻;pending 时 null */
  readonly inspectedAt: string | null;
  /** 诚实判定文本;仅 quarantined 非空 */
  readonly rejectionReason: string | null;
  readonly sourceCorrelated: boolean;
  readonly mappedProductIds: readonly string[];
}

/** 信封形态同 CatalogListResultV03(021 先例,2026-09-18 对齐);工件事实族
 *  (含 suggestedFileName/检查时刻/诚实判定)随 result.entry 承载不变 */
export interface WarehouseEntryDetailResultV03 {
  readonly schemaVersion: "0.5";
  readonly operation: "warehouse.entryDetail";
  readonly result: {
    readonly entry: Omit<WarehouseEntryCardV03, "artifacts"> & {
      readonly artifacts: readonly WarehouseArtifactFactV03[];
    };
  };
}

// ---- download.*(下载域命令与意图事件;词表见 download-events v0.1 冻结面
// 与 b-reply-to-f4-download-task-requirements 的形状裁定) ----

/** Main → AMF 批量投递下载事件(at-least-once:重发 + BDL 唯一键去重);
 *  回执为批量级 high-water——收到任一回执即可裁剪整批缓冲 */
export interface DownloadIngestCommandV03 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "download.ingest";
  readonly commandId: string;
  readonly params: {
    readonly schemaVersion: "0.1";
    readonly events: readonly import("./download-events.js").DownloadEventV01[];
  };
}

/** 批量折叠回执:folded = 新折叠数;duplicates = 去重数;rejected = 单条
 *  非法事件(不毒化整批,Main 决定重投或死信) */
export interface DownloadIngestReceiptV03 {
  readonly folded: number;
  readonly duplicates: number;
  readonly rejected: readonly { readonly index: number; readonly code: string; readonly reason: string }[];
}

/** 渲染层"重试"入口(任务级动作):AMF 以冻结重试策略裁决,不可重试时
 *  `vua.download.not_retryable` 拒绝 */
export interface DownloadRetryCommandV03 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "download.retry";
  readonly commandId: string;
  readonly params: { readonly taskId: string };
}

export interface DownloadRetryResultV03 {
  readonly taskId: string;
  readonly decision: "resume" | "retry";
  readonly intentSeq: number;
}

/** AMF → Main 的端口意图事件(经既有 event 帧):Main 按 downloadId 丢弃
 *  intentSeq ≤ lastApplied 的意图,到达序经 applyIntent 串行解释 */
export interface DownloadIntentEventV03 {
  readonly contractVersion: ApplicationContractVersion;
  readonly eventId: string;
  readonly revision: number;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly kind: "download.intent";
  readonly payload: {
    readonly downloadId: string;
    readonly intent: "abandon" | "resume" | "retry";
    readonly intentSeq: number;
  };
}

// ---- catalog-sync(账号库同步页投递;词表见 catalog-sync v0.1 冻结面) ----

/** Main → AMF 单页归档投递(账号库同步读取器,N5 S1):HTML 原样进、逐项
 *  观察落账出;请求零 Cookie/凭据(会话留在 Electron 分区会话内) */
export interface CatalogIngestLibraryPageCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "catalog.ingestLibraryPage";
  readonly commandId: string;
  readonly params: CatalogSyncPageRequestV01 | CatalogSyncPageV03;
}

export type CatalogSyncControlCommandV03 = ApplicationRequestBaseV01 & { readonly kind: "command"; readonly commandId: string } & (
  | { readonly method: "catalog.beginLibrarySync"; readonly params: CatalogSyncBeginV03 }
  | { readonly method: "catalog.finishLibrarySync"; readonly params: CatalogSyncFinishV03 }
);

export interface CatalogSyncStatusQueryV03 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "catalog.librarySyncStatus";
  readonly params: CatalogSyncStatusV03;
}
export type LibraryDownloadCommandV01 = ApplicationRequestBaseV01 & { readonly kind: "command"; readonly commandId: string } & (
  | { readonly method: "library.beginDownload"; readonly params: LibraryDownloadBeginV01 }
  | { readonly method: "library.observeDownload"; readonly params: LibraryDownloadObservationV01 }
);
export interface LibraryDownloadQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query"; readonly method: "library.downloadStatus"; readonly params: LibraryDownloadStatusV01;
}
export type LibraryViewQueryV01 = ApplicationRequestBaseV01 & { readonly kind: "query" } & (
  | { readonly method: "library.list"; readonly params: LibraryListParamsV01 }
  | { readonly method: "library.productFiles"; readonly params: LibraryProductFilesParamsV01 }
);
export type RecipeDraftQueryV01 = ApplicationRequestBaseV01 & { readonly kind: "query" } & (
  | { readonly method: "recipeDraft.list"; readonly params: RecipeDraftListParamsV01 }
  | { readonly method: "recipeDraft.get" | "recipeDraft.selectionStatus"; readonly params: RecipeDraftGetParamsV01 }
);
export type LibraryMaintenanceQueryV01 = ApplicationRequestBaseV01 & { readonly kind: "query" } & (
  | { readonly method: "library.removalPreview"; readonly params: LibraryRemovalPreviewParamsV01 }
  | { readonly method: "library.removalStatus"; readonly params: LibraryRemovalStatusParamsV01 }
);
export interface LibraryMaintenanceCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command"; readonly method: "library.removeFiles"; readonly commandId: string; readonly params: LibraryRemoveFilesParamsV01;
}
export type RecipeDraftCommandV01 = ApplicationRequestBaseV01 & { readonly kind: "command"; readonly commandId: string } & (
  | { readonly method: "recipeDraft.save"; readonly params: RecipeDraftSaveParamsV01 }
  | { readonly method: "recipeDraft.addSelection"; readonly params: RecipeDraftAddParamsV01 }
);

// ---- warehouse 写命令(bdl-commands v0.1 冻结业务词表的 TS 面,proposal 005;
//      wire 信封 schemaVersion/operation 由应用契约 response 层承载,镜像按
//      既有惯例剥除;稳定错误码词表见 docs/protocols/bdl-commands-v0.1.md) ----

/** setArtifactMode 的受理载荷即结果:条目级覆盖设置/清除后的查询期生效模式 */
export interface WarehouseSetArtifactModeResultV01 {
  readonly warehouseItemId: string;
  readonly effectiveMode: WarehouseArtifactModeV03;
}
/** setGlobalDefaultMode 的受理载荷即结果(bdl-commands v0.2 全局层,W14):
 *  从 BDL 读回的持久事实,非回显 */
export interface WarehouseSetGlobalDefaultModeResultV02 {
  readonly globalDefaultMode: WarehouseArtifactModeV03;
}
/** warehouse.import 的受理载荷(bdl-commands v0.3,W19):folder 批导入任务
 *  受理;逐 folder 进度与条目落成经任务面/读面,受理即任务身份 */
export interface WarehouseImportAcceptedV03 {
  readonly taskId: string;
  readonly correlationId: string;
}

/** warehouse.importDownloads 的受理载荷(bdl-commands v0.4,IMP-3):下载
 *  采纳任务受理;逐下载进度与 downloaded_material 条目身份经任务面/读面 */
export interface WarehouseImportDownloadsAcceptedV04 {
  readonly taskId: string;
  readonly correlationId: string;
}

/** 任务化维护命令的受理载荷(generateVpm / deleteOriginals 共用) */
export interface WarehouseMaintenanceAcceptedV01 {
  readonly taskId: string;
  readonly correlationId: string;
}

/** generateVpm 完成载荷(经任务面投递;任务面通道由核心 provider-host 登记时接线) */
export interface WarehouseGenerateVpmCompletionV01 {
  readonly correlationId: string;
  readonly warehouseItemId: string;
  readonly packageId: string;
  readonly archiveRelativePath: string;
  /** 发布档案内容身份(sha256:…) */
  readonly archiveSha256: string;
}

/** deleteOriginals 完成载荷(审计性破坏操作;经任务面投递,通道同上) */
export interface WarehouseDeleteOriginalsCompletionV01 {
  readonly correlationId: string;
  readonly warehouseItemId: string;
  readonly deletedCount: number;
  readonly deletedRelativePaths: readonly string[];
  /** 保留的生成副本内容身份(sha256:…),删除守卫依赖它校验后才执行 */
  readonly keptGeneratedSha256: string;
}

export interface WarehouseSetArtifactModeCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "warehouse.setArtifactMode";
  readonly commandId: string;
  readonly params: {
    readonly warehouseItemId: string;
    /** null = 清除条目级覆盖,回落「覆盖 ?? 全局默认」动态解析 */
    readonly mode: WarehouseArtifactModeV03 | null;
  };
}

export interface WarehouseGenerateVpmCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "warehouse.generateVpm";
  readonly commandId: string;
  readonly params: {
    readonly warehouseItemId: string;
    /** v0.3 词表镜像(proposal 010 承诺 6):仅导入编排的自动生成携带;手动
     *  发起恒不携带——渲染层面从不设置该字段,守卫接受 1~2 键 */
    readonly importCorrelationId?: string;
  };
}

export interface WarehouseDeleteOriginalsCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "warehouse.deleteOriginals";
  readonly commandId: string;
  readonly params: { readonly warehouseItemId: string };
}

export interface WarehouseDeleteByProductCommandV05 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "warehouse.deleteOriginalsByProduct";
  readonly commandId: string;
  readonly params: { readonly productId: string };
}
/** 全局默认产物模式写命令(bdl-commands v0.2 全局层,W14/W15):同步写 BDL
 *  bdl_meta;无 null——全局默认恒有值,缺/null/词表外 = 参数违反 */
export interface WarehouseSetGlobalDefaultModeCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "warehouse.setGlobalDefaultMode";
  readonly commandId: string;
  readonly params: { readonly mode: WarehouseArtifactModeV03 };
}
/** warehouse.import 批量导入命令(bdl-commands v0.3,W19):folder 批一次提交;
 *  非空数组、绝对路径语义由服务端裁决;导入编排内的自动生成挂点在任务内
 *  (010 路径 A) */
export interface WarehouseImportCommandV03 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "warehouse.import";
  readonly commandId: string;
  readonly params: {
    readonly sourceFolders: readonly string[];
    /** N5 实验选项:导入完成后自动制成 VPM 包再入库(设置-实验性门控) */
    readonly autoGenerate?: boolean;
  };
}

/** warehouse.importDownloads 下载采纳命令(bdl-commands v0.4,IMP-3):只携
 *  带端口下载身份——暂存路径/大小/文件名是 BDL 下载事件日志的服务端事实,
 *  永不是请求字段或客户端断言;采纳=复制落库为 downloaded_material 条目,
 *  非空数组;一次命令=一个采纳任务(逐下载进度) */
export interface WarehouseImportDownloadsCommandV04 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "warehouse.importDownloads";
  readonly commandId: string;
  readonly params: { readonly downloadIds: readonly string[] };
}


// ---- production-use-case v0.2(W20 十方法冻结件,核心 4849958;W24 工作台消费) ----
// 命令/读面词表按冻结 Schema 镜像;文档本体(recipe/plan/record)在 TS 面以
// Record<string, unknown> 承载(UI 内按需窄化,契约面不复制文档 Schema)。

/** production 任务九态(v0.2 冻结枚举) */
export type ProductionTaskStateV02 =
  | "queued"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "inspect_required"
  | "blocked"
  | "rejected";

export type PlanStatusV02 = "draft" | "approved" | "superseded";

/** 分页/过滤闭集(011 section 7 收敛决议:catalog.list 先例;词表外 = invalid_params) */
export interface ProductionListQueryV02 {
  readonly text?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface RecipeSaveCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "recipe.save";
  readonly commandId: string;
  readonly params: {
    /** 整文档提交(011 桌面表态);baseRevision 乐观并发,stale = typed conflict */
    readonly recipeDocument: Record<string, unknown>;
    readonly baseRevision: number;
  };
}

export interface RecipeSaveResultV02 {
  readonly recipeId: string;
  readonly revision: number;
}

export interface RecipeGetQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "recipe.get";
  readonly params: { readonly recipeId: string };
}

export interface RecipeGetResultV02 {
  readonly recipeId: string;
  readonly revision: number;
  readonly recipeDocument: Record<string, unknown>;
  readonly updatedAt: string;
}

export interface RecipeListQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "recipe.list";
  readonly params: ProductionListQueryV02;
}

export interface RecipeListEntryV02 {
  readonly recipeId: string;
  readonly revision: number;
  readonly title: string;
  readonly updatedAt: string;
}

export interface RecipeListResultV02 {
  readonly total: number;
  readonly entries: readonly RecipeListEntryV02[];
}

export interface RecipeResolveCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "recipe.resolve";
  readonly commandId: string;
  readonly params: { readonly recipeId: string; readonly revision?: number };
}

export interface ProductionTaskAcceptedV02 {
  readonly taskId: string;
  readonly correlationId: string;
  readonly state: ProductionTaskStateV02;
}

export interface PlanApproveCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "plan.approve";
  readonly commandId: string;
  readonly params: { readonly planId: string };
}

export interface PlanApproveResultV02 {
  readonly planId: string;
  readonly planStatus: PlanStatusV02;
}

export interface PlanGetQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "plan.get";
  readonly params: { readonly planId: string };
}

export interface PlanGetResultV02 {
  readonly planId: string;
  readonly planStatus: PlanStatusV02;
  readonly planDocument: Record<string, unknown>;
}

export interface PlanListQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "plan.list";
  readonly params: ProductionListQueryV02 & { readonly recipeId?: string };
}

export interface PlanListEntryV02 {
  readonly planId: string;
  readonly recipeId: string;
  readonly status: PlanStatusV02;
  readonly approvedAt: string;
}

export interface PlanListResultV02 {
  readonly total: number;
  readonly entries: readonly PlanListEntryV02[];
}

export interface JobExecuteCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "job.execute";
  readonly commandId: string;
  readonly params: { readonly planId: string };
}

export interface JobExecuteResultV02 {
  readonly taskId: string;
  readonly correlationId: string;
  readonly state: ProductionTaskStateV02;
}

export interface RecordGetQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "record.get";
  readonly params: { readonly buildId: string };
}

export interface RecordGetResultV02 {
  readonly buildId: string;
  readonly recordDocument: Record<string, unknown>;
}

export interface RecordListQueryV02 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "record.list";
  readonly params: ProductionListQueryV02 & { readonly recipeId?: string };
}

export interface RecordListEntryV02 {
  readonly buildId: string;
  readonly planId: string;
  readonly status: string;
  readonly finishedAt: string;
}

export interface RecordListResultV02 {
  readonly total: number;
  readonly entries: readonly RecordListEntryV02[];
}


// ---- release.openForHandoff ＋ release.openForInspection(release-handoff
// v0.2 词表行,核心 U19 批 36bab970 经合并 09a4423f 入库,桌面 TS 面按所有权
// 登记对齐;族版本 0.1→0.2 单源推进照核心 provider-host 再导出先例——wire
// 只说 0.2,v0.1 机器面字节冻结于 schemas/release-handoff/v0.1,本面描述
// 当前 wire。v0.2 变更=U19 用户裁决 2026-09-21(BOARD 行规范源):①准入序
// 增记录状态闸(后端权威,绝不在 UI)——白名单两态放行且警告呈现保留;四终
// 态拦截=record_state_blocked(category=permission,params.state 携记录状态
// 原值逐字——政策拒绝类,裁决修正 a);缺失/非字符串/枚举外=record_state_
// unknown(category=validation,记录无法确认);recovered 同被拦(检视完成
// 绝不改写失败史——修正 b,与任务面 inspect_required 两套状态不混用)。
// 白名单态不保证工程仍为当时结果(修正 c,范围诚实)。②独立检视入口
// release.openForInspection=同准入减状态闸:打开工程排错不得被禁——打开
// 编辑器既不是恢复执行也不是上传许可;完成事实=六键闭集(五身份键＋显式
// operation 键),词面由形状钉死永不误读为交接完成,无上传状态字段。
// 交接语义=把用户送到官方 SDK 流程起点——上传本身永不进 VUA(产品边界);
// 任务化=统一 task 九态单形态,完成判定=Bridge handshake 到达(001 链),
// 聚焦不进契约事实。机器可读面 schemas/release-handoff/v0.2,漂移由向量
// 对表测试把守) ----

/** 词表行信封 schemaVersion(族自有常量,照 editor-verify/inspection-queries
 *  先例;绝不借外族版本;0.1→0.2 随核心单源推进,v0.1 词面冻结于机器面) */
export type ReleaseHandoffSchemaVersionV02 = "0.2";

/** 类型化错误码闭集六码(vua.release_handoff.* 族,v0.2;交棒路由可答全部
 *  六码):unavailable=路由/产线进程窗口 port 未接线(诚实缺席,绝不折叠成
 *  伪造受理);invalid_params=params 闭集违反(形状违反绝不冒充缺席);
 *  build_unknown=buildId 无对应构建记录(受理期校验);record_state_blocked=
 *  记录状态在交棒白名单外(failed/cancelled/rolled_back/recovered)——政策
 *  拦截,params.state 携原值;record_state_unknown=记录状态缺失/非字符串/
 *  枚举外——记录无法确认;editor_unresolved=编辑器身份解析失败(诊断复用
 *  environment.verifyEditor 语义,不另造词)。任务运行期失败(handshake
 *  超时等)走任务面九态,不进本闭集 */
export type ReleaseHandoffErrorCodeV02 =
  | "vua.release_handoff.unavailable"
  | "vua.release_handoff.invalid_params"
  | "vua.release_handoff.build_unknown"
  | "vua.release_handoff.record_state_blocked"
  | "vua.release_handoff.record_state_unknown"
  | "vua.release_handoff.editor_unresolved";

/** 错误码闭集运行时面(渲染层收窄与消费测试按此数组对表,不自持字面量) */
export const RELEASE_HANDOFF_ERROR_CODES_V02: readonly ReleaseHandoffErrorCodeV02[] = [
  "vua.release_handoff.unavailable",
  "vua.release_handoff.invalid_params",
  "vua.release_handoff.build_unknown",
  "vua.release_handoff.record_state_blocked",
  "vua.release_handoff.record_state_unknown",
  "vua.release_handoff.editor_unresolved",
];

/** 检视路由错误码闭集四码:两状态码(record_state_blocked/record_state_
 *  unknown)对检视路由刻意缺席——该路由绝不分类记录状态(裁决①检视/修复
 *  路径不按记录状态闸);类型面以闭集差集表达,词面逐字由测试钉死 */
export type ReleaseInspectionErrorCodeV02 = Exclude<
  ReleaseHandoffErrorCodeV02,
  "vua.release_handoff.record_state_blocked" | "vua.release_handoff.record_state_unknown"
>;

/** 检视路由错误码闭集运行时面(四码逐字;消费测试对表) */
export const RELEASE_INSPECTION_ERROR_CODES_V02: readonly ReleaseInspectionErrorCodeV02[] = [
  "vua.release_handoff.unavailable",
  "vua.release_handoff.invalid_params",
  "vua.release_handoff.build_unknown",
  "vua.release_handoff.editor_unresolved",
];

/** record_state_blocked 的信封 params 面(冻结单键闭集):state=构建记录
 *  状态原值逐字,永不规范化(messageKey=errors.releaseHandoff.stateBlocked
 *  围绕它组诊断/恢复/重新生产词面;record_state_unknown 对应
 *  errors.releaseHandoff.stateUnknown,无 params)。信封 params 仅在有参时
 *  出现(ORC-ERR-001 形状,既有码线形状逐字节不变) */
export interface ReleaseHandoffRecordStateParamsV02 {
  readonly state: string;
}

/** 检视入口操作词面(受理回执 operation 键＋完成事实 operation 键共用;
 *  照核心 OPEN_FOR_INSPECTION_OPERATION 单源) */
export const RELEASE_OPEN_FOR_INSPECTION_OPERATION = "release.openForInspection" as const;

/** params 单字段闭集 {buildId}(核心冻结裁决,修订 023 §3 草案「buildId＋
 *  工程身份」:工程身份权威在 build-record 面——projectId 已随冻结记录
 *  携带,params 重复携带=双源对账零增益。异议随 023 线程重议) */
export interface ReleaseOpenForHandoffCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "release.openForHandoff";
  readonly commandId: string;
  readonly params: { readonly buildId: string };
}

/** 受理回执(tasked 命令 inspection.requestRun 回执形状先例):按 taskId
 *  轮询应用任务面,不再轮询本方法;succeeded 快照 result 携带交接事实
 *  文档(#22/020 result 回流通道) */
export interface ReleaseHandoffAcceptedV02 {
  readonly schemaVersion: ReleaseHandoffSchemaVersionV02;
  readonly operation: "release.openForHandoff";
  readonly taskId: string;
  readonly correlationId: string;
}

/** release.openForInspection 命令(params 闭集与交棒同律单键 {buildId};
 *  路由准入=交棒准入减状态闸,检视路由绝不答两状态码) */
export interface ReleaseOpenForInspectionCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "release.openForInspection";
  readonly commandId: string;
  readonly params: { readonly buildId: string };
}

/** 检视受理回执(同 tasked 形状;operation 词面钉检视操作) */
export interface ReleaseInspectionAcceptedV02 {
  readonly schemaVersion: ReleaseHandoffSchemaVersionV02;
  readonly operation: typeof RELEASE_OPEN_FOR_INSPECTION_OPERATION;
  readonly taskId: string;
  readonly correlationId: string;
}

/** 编辑器身份事实(exePath 属 editor-verify v0.1 冻结事实族——身份而非
 *  存储路径;storedPath 纪律:产物物理路径永不出现) */
export interface ReleaseHandoffEditorFactV02 {
  readonly exePath: string;
  readonly version: string;
}

/** 交接事实文档(succeeded 快照 result payload):VUA 侧终态事实,闭集五键。
 *  additionalProperties false 由形状钉死诚实纪律 1/2——无上传状态字段,
 *  上传在官方 SDK 中完成,绝非 VUA 可猜事实(负例向量钉死) */
export interface ReleaseHandoffFactV02 {
  readonly schemaVersion: ReleaseHandoffSchemaVersionV02;
  readonly buildId: string;
  readonly projectId: string;
  readonly editor: ReleaseHandoffEditorFactV02;
  readonly occurredAt: string;
}

/** 检视事实文档(succeeded 快照 result payload):闭集六键=交接事实五键＋
 *  显式 operation 键(const 检视操作词面)——词面由形状钉死,本事实永不被
 *  误读或呈现为交接完成(检视入口不是交接;既不授予恢复执行也不授予上传
 *  许可);同样无上传状态字段(additionalProperties false,U19 专属负例钉) */
export interface ReleaseInspectionFactV02 {
  readonly schemaVersion: ReleaseHandoffSchemaVersionV02;
  readonly operation: typeof RELEASE_OPEN_FOR_INSPECTION_OPERATION;
  readonly buildId: string;
  readonly projectId: string;
  readonly editor: ReleaseHandoffEditorFactV02;
  readonly occurredAt: string;
}

// ---- overlay.*(017 overlay 表面批 1–2,核心冻结批:任务卡＋生产状态卡＋
// 下载卡的按需轮询读面。一次查询返回 overlay 一屏所需只读投影——对权威面的
// 字段裁剪,不跨源推导;载荷不带查询时刻与聚合 revision——两次查询无变更则
// 观察相同(纯函数纪律)。词表(任务态/plan 态/record 态/下载尝试态)从其属主
// 冻结面原样透传,本面刻意不重列。零 overlay 会话身份:查询面与主线不可区分,
// 语义动作走既有命令面(017 §3)。生产读面未接线 = vua.overlay.unavailable
// 诚实缺席,绝不以空快照伪装) ----

/** 任务卡(常驻主卡):任务存储投影,最旧优先;state 为任务面九态原词 */
export interface OverlayTaskCardV01 {
  readonly taskId: string;
  readonly state: string;
  readonly correlationId: string;
}

/** 当前 plan 摘要(createdAt 最新者;planId/planStatus/createdAt/recipeId
 *  裁剪自 plan 文档,原样透传) */
export interface OverlayPlanSummaryV01 {
  readonly planId: string;
  readonly planStatus: string;
  readonly createdAt: string;
  readonly recipeId: string;
}

/** 最近 Build Record 摘要(finishedAt 最新者;四字段与 record.list 冻结
 *  条目同形) */
export interface OverlayRecordSummaryV01 {
  readonly buildId: string;
  readonly planId: string;
  readonly status: string;
  readonly finishedAt: string;
}

/** 生产状态卡:两半独立可空——权威面无该事实即 null(空态即终态),
 *  绝不合成行 */
export interface OverlayProductionCardV01 {
  readonly currentPlan: OverlayPlanSummaryV01 | null;
  readonly latestRecord: OverlayRecordSummaryV01 | null;
}

/** 进行中下载行(017 批 2):dl- 前缀非终态尝试的字段裁剪投影——
 *  downloadId 即任务面 correlationId(port 分配身份),state 为任务九态
 *  原词,updatedAt 为任务行自身时间戳;无字节进度(进度在任务事件通道,
 *  快照不发明,主线 TaskSnapshot 同基准) */
export interface OverlayDownloadProgressV01 {
  readonly downloadId: string;
  readonly state: string;
  readonly updatedAt: string;
}

/** 下载/导入进度卡(017 批 2,向后兼容可选增量):仅承载进行中下载尝试
 *  (呈现策略=有进行中项时呈现,017 表态 3);完成交付保留其权威消费面
 *  downloads.listCompleted(导入页),不进 overlay 一眼面 */
export interface OverlayDownloadCardV01 {
  readonly activeDownloads: readonly OverlayDownloadProgressV01[];
}

export interface OverlayGetSnapshotQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "overlay.getSnapshot";
  readonly params: Readonly<Record<string, never>>;
}

export interface OverlaySnapshotResultV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly tasks: readonly OverlayTaskCardV01[];
  readonly productionCard: OverlayProductionCardV01;
  /** 017 批 2 增量:批 1 世代的快照无此字段仍有效(向后兼容) */
  readonly downloadCard?: OverlayDownloadCardV01;
}

// ---- inspection-queries v0.1（M7 检查切片；016 仲裁第 2 点独立词表行；
//      数据域草案面＋核心存储/路由实现批——草案态，冻结随实现批验收办理） ----
// 读面 get/list 照 record 先例：get 携 inspectionId 身份寻址、返回证据束
// 文档本体原样透传（细节在文档内，引用不复制）；list 为身份摘要行
// （performedAt 降序＝最新在前，条目绝不内联 dimensions/checks）。
// 写面 requestRun 为任务化驱动命令（回执照 job.execute 形态，taskId 轮询
// 任务面）。聚合规则（fail > warn[含 unavailable] > pass）在
// schemas/inspection-evidence/v0.1 草案内声明。

export type InspectionDimensionKindV01 =
  | "functional"
  | "performance"
  | "dependencies"
  | "lighting"
  | "upload_readiness";

export type InspectionDimensionStatusV01 = "pass" | "warn" | "fail" | "unavailable";

export type InspectionBasisV01 =
  | "bridge_typed_checks"
  | "bridge_local_estimate"
  | "official_sdk_rating"
  | "static_analysis"
  | "none";

export type InspectionCheckSeverityV01 = "error" | "warning" | "info";

/** 单条发现：code 点分命名空间（同 Bridge diagnostics 惯例）；metrics 为
 *  转抄数值（如本地估算四指标），绝不推导 */
export interface InspectionCheckV01 {
  readonly code: string;
  readonly severity: InspectionCheckSeverityV01;
  readonly message: string;
  readonly metrics?: Readonly<Record<string, number | string | boolean | null>>;
}

export interface InspectionDimensionV01 {
  readonly kind: InspectionDimensionKindV01;
  readonly status: InspectionDimensionStatusV01;
  readonly basis: InspectionBasisV01;
  readonly checks: readonly InspectionCheckV01[];
}

export interface InspectionBridgeOperationV01 {
  readonly operation: string;
  readonly commandId: string;
  readonly status: "succeeded" | "failed" | "rejected";
}

export interface InspectionBridgeContextV01 {
  readonly editorVersion: string;
  readonly bridgeSchemaVersion: number;
  readonly operations: readonly InspectionBridgeOperationV01[];
}

/** 检查证据束文档本体（schemas/inspection-evidence/v0.1 草案；读面原样
 *  透传，转抄不解释） */
export interface InspectionEvidenceDocumentV01 {
  readonly schemaVersion: "0.1";
  readonly inspectionId: string;
  readonly avatarRef: { readonly ref: string; readonly label?: string | null };
  readonly performedAt: string;
  readonly bridge: InspectionBridgeContextV01;
  readonly dimensions: readonly InspectionDimensionV01[];
  readonly overallStatus: "pass" | "warn" | "fail";
  readonly notes?: string;
}

export interface InspectionGetQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "inspection.get";
  readonly params: {
    readonly inspectionId: string;
  };
}

export interface InspectionGetResultV01 {
  readonly inspectionId: string;
  readonly inspectionDocument: InspectionEvidenceDocumentV01;
  readonly schemaVersion: "0.1";
}

export interface InspectionListQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "inspection.list";
  readonly params: {
    readonly avatarRef?: string;
    readonly overallStatus?: "pass" | "warn" | "fail";
    readonly limit?: number;
    readonly offset?: number;
  };
}

/** 身份摘要行：刻意窄——无 dimensions、无 checks，细节经 inspection.get
 *  到证据本体（引用不复制，012 evidenceIds 纪律） */
export interface InspectionListEntryV01 {
  readonly inspectionId: string;
  readonly avatarRef: { readonly ref: string; readonly label?: string | null };
  readonly overallStatus: "pass" | "warn" | "fail";
  readonly performedAt: string;
}

export interface InspectionListResultV01 {
  readonly total: number;
  readonly entries: readonly InspectionListEntryV01[];
  readonly schemaVersion: "0.1";
}

/** 检查运行写命令面：驱动 Bridge 五维产出操作（v1 双检查＋v3 三只读检查
 *  操作）并发布证据束；每次运行＝新 uuid-v7 inspectionId＝新观察事实 */
export interface InspectionRunCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "inspection.requestRun";
  readonly params: {
    readonly avatarGlobalObjectId: string;
    readonly avatarRef: { readonly ref: string; readonly label?: string | null };
  };
}

export interface InspectionRunAcceptedV01 {
  readonly schemaVersion: string;
  readonly operation: "inspection.requestRun";
  readonly taskId: string;
  readonly correlationId: string;
}

// ---- project-ops v0.1(014 语义冻结,环境实现;F6 副本导入确认链消费) ----
// project.import-copy 是 VUA 对 ALCOM/VCC 管理的原项目的唯一写路径(1.2.0 U3):
// plan/apply 两段一闭集命令;守卫(七项闭集)在服务端任务内评估;九态任务语义
// 走应用契约任务面,不在本词表。

export type ImportCopyPhaseV01 = "plan" | "apply";

export type ImportCopyGuardV01 =
  | "target_exists"
  | "target_inside_source"
  | "source_not_registered"
  | "source_invalid"
  | "insufficient_disk_space"
  | "plan_drift"
  | "execution_failed";

export type UnityClassificationV01 =
  | "production_target"
  | "migration_source"
  | "other_unity_version"
  | "tuanjie_family";

export type ProjectAssociationV01 = "vcc_registered" | "alcom_registered";

export interface ImportCopyCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "project.import-copy";
  readonly commandId: string;
  readonly params: {
    readonly phase: ImportCopyPhaseV01;
    readonly sourcePath: string;
    readonly targetParentDirectory: string;
    readonly targetProjectName: string;
    /** apply 段必填:plan 段回执的 planDigest,漂移即拒绝(plan_drift) */
    readonly confirmedPlanDigest?: string;
  };
}

export interface ImportCopyPlanV01 {
  readonly kind: "plan";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly targetProjectName: string;
  readonly estimatedBytes: number;
  readonly excludedEntries: readonly string[];
  readonly sourceTopLevels: readonly string[];
  readonly planDigest: string;
}

export interface ImportCopySourceLinkV01 {
  readonly sourcePath: string;
  readonly sourceAssociations: readonly ProjectAssociationV01[];
  readonly importedAt: string;
  readonly taskCorrelation: string;
}

export interface ImportCopyReInspectionV01 {
  readonly unityVersion: string | null;
  readonly unityClassification: UnityClassificationV01 | null;
  readonly manifestPresent: boolean;
  readonly manifestSchemaOk: boolean;
}

export interface ImportCopyReceiptV01 {
  readonly kind: "receipt";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly targetProjectName: string;
  readonly copiedTopLevels: readonly string[];
  readonly excludedEntries: readonly string[];
  readonly bytesCopied: number;
  readonly sourceLink: ImportCopySourceLinkV01;
  readonly reInspection: ImportCopyReInspectionV01;
}

export interface ImportCopyRejectedV01 {
  readonly kind: "rejected";
  readonly guard: ImportCopyGuardV01;
  /** vua.project.* 稳定码(七项闭集,冻结 Schema pattern) */
  readonly code: string;
  readonly detail: string;
}

export type ProjectImportCopyResultV01 =
  | ImportCopyPlanV01
  | ImportCopyReceiptV01
  | ImportCopyRejectedV01;

// ---- project-ops v0.2(增量族升版,核心冻结批 0889a1b;D-6 桌面接线消费) ----
// project.setNote:为单个 VUA 原生项目设置(或以 null 清除)用户备注(用户
// 裁决 12:只在项目列表显示;D-6 裁定 A 增加列表行内编辑写路径)。参数身份
// = projectPath(与 013 读面 inspectProject/lockStatus 同一注册路径身份,
// 草案 projectId 在冻结时修正——本词表族无独立项目 id)。守卫闭集十项:
// v0.1 七项 + setNote 三项(project_not_found/not_vua_native/identity_
// unreadable);守卫为服务端任务内事实,拒绝以冻结 rejected 文档承载
// (任务诚实完成,判定即拒绝)。命令为任务化受理:wire 回执携带 taskId/
// correlationId,结果文档随任务 Done payload 走应用契约任务面。

export type ProjectOpsGuardV02 =
  | ImportCopyGuardV01
  | "project_not_found"
  | "not_vua_native"
  | "identity_unreadable";

export interface ProjectSetNoteCommandV02 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "project.setNote";
  readonly commandId: string;
  readonly params: {
    readonly projectPath: string;
    /** null 清除既有备注;非空单行纯文本(冻结 Schema:1..2000 字符,无换行) */
    readonly note: string | null;
  };
}

/** 任务化受理回执 TS 镜像(wire 回执 value 形状;结果文档随 Done payload) */
export interface ProjectTaskAcceptedV02 {
  readonly taskId: string;
  readonly correlationId: string;
}

/** kind=note 完成面:VUA 原生身份的存储后备注态(markedAt/note 字段名与
 *  project-inspection v0.2 vuaIdentity present 投影一致;写备注永不改
 *  markedAt) */
export interface ProjectNoteStoredV02 {
  readonly kind: "note";
  readonly projectPath: string;
  readonly markedAt: string;
  readonly note: string | null;
}

/** kind=rejected 类型化守卫拒绝:guard 值 = code 后缀(v0.1 vua.project.*
 *  映射保持) */
export interface ProjectOpsRejectedV02 {
  readonly kind: "rejected";
  readonly guard: ProjectOpsGuardV02;
  readonly code: string;
  readonly detail: string;
}

export type ProjectSetNoteResultV02 = ProjectNoteStoredV02 | ProjectOpsRejectedV02;

export interface ProjectImportCopyCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "project.import-copy";
  readonly commandId: string;
  readonly params: {
    readonly phase: ImportCopyPhaseV01;
    readonly sourcePath: string;
    readonly targetParentDirectory: string;
    readonly targetProjectName: string;
    readonly confirmedPlanDigest?: string;
  };
}

export interface DeploymentPlanQuery extends ApplicationRequestBaseV01 { readonly kind: "query"; readonly method: "environment.planDeployment"; readonly params: DeploymentPlanParams }
export interface DeploymentExecuteCommand extends ApplicationRequestBaseV01 { readonly kind: "command"; readonly method: "environment.executeDeployment"; readonly commandId: string; readonly params: DeploymentExecuteParams }

export type ApplicationRequestV01 =
  | (ApplicationRequestBaseV01 & { readonly kind: "query"; readonly method: "environment.checkNetwork"; readonly params: { readonly intent: NetworkIntent } })
  | (ApplicationRequestBaseV01 & { readonly kind: "query"; readonly method: "environment.testWebsites"; readonly params: WebsiteTestParams })
  | DeploymentPlanQuery
  | DeploymentExecuteCommand
  | ApplicationSnapshotQueryV01
  | TaskListQueryV01
  | TaskGetQueryV01
  | TaskCancellationCommandV01
  | EnvironmentSnapshotQueryV01
  | DemoTaskStartCommandV01
  | ProductionStartInspectionCommandV02
  | ProductionGetInspectionQueryV02
  | ProductionRequestPlanCommandV02
  | ProductionGetPlanQueryV02
  | ProductionConfirmPlanCommandV02
  | ProductionRecoverCommandV02
  | ProductionGetBuildRecordQueryV02
  | CatalogListQueryV03
  | CatalogDetailQueryV03
  | CatalogStatusQueryV03
  | CatalogIngestLibraryPageCommandV01
  | CatalogSyncControlCommandV03
  | CatalogSyncStatusQueryV03
  | LibraryDownloadCommandV01
  | LibraryDownloadQueryV01
  | LibraryViewQueryV01
  | LibraryMaintenanceQueryV01 | LibraryMaintenanceCommandV01
  | RecipeDraftQueryV01 | RecipeDraftCommandV01
  | WarehouseListEntriesQueryV03
  | WarehouseEntryDetailQueryV03
  | DownloadsListCompletedQueryV04
  | EnvironmentVerifyEditorQueryV01
  | ProjectEnvironmentManagersQueryV01
  | ProjectListProjectsQueryV01
  | ProjectInspectProjectQueryV01
  | ProjectLockStatusQueryV01
  | PackagesListInstalledQueryV01
  | PackagesListReposQueryV01
  | PackagesPackageCatalogQueryV01
  | PackagesRepoCatalogQueryV01
  | PackagesListTemplatesQueryV01
  | PackagesPreviewRemoveQueryV01
  | PackagesApplyRemoveCommandV01
  | PackagesPreviewInstallQueryV02
  | PackagesApplyInstallCommandV02
  | PackagesRegisterCommandV03
  | PackagesAddRemoteRepoCommandV04
  | PackagesAddLocalRepoCommandV04
  | PackagesRemoveRepoCommandV04
  | PackagesCreateProjectCommandV05
  | PackagesEnableRepoCommandV06
  | PackagesDisableRepoCommandV06
  | PackagesRefreshRepoCommandV06
  | OverlayGetSnapshotQueryV01
  | InspectionGetQueryV01
  | InspectionListQueryV01
  | InspectionRunCommandV01
  | RecipeGetQueryV02
  | RecipeListQueryV02
  | PlanGetQueryV02
  | PlanListQueryV02
  | RecordGetQueryV02
  | RecordListQueryV02
  | DownloadIngestCommandV03
  | DownloadRetryCommandV03
  | WarehouseSetArtifactModeCommandV01
  | WarehouseSetGlobalDefaultModeCommandV02
  | WarehouseImportCommandV03
  | WarehouseImportDownloadsCommandV04
  | RecipeSaveCommandV02
  | ProjectImportCopyCommandV01
  | ProjectSetNoteCommandV02
  | RecipeResolveCommandV02
  | PlanApproveCommandV02
  | JobExecuteCommandV02
  | WarehouseGenerateVpmCommandV01
  | WarehouseDeleteOriginalsCommandV01
  | WarehouseDeleteByProductCommandV05
  | ReleaseOpenForHandoffCommandV02
  | ReleaseOpenForInspectionCommandV02
  | RecipeExportProjectDraftQueryV01
  | DependenciesLookupQueryV05
  | DependenciesListByProductQueryV05
  | CatalogProductDownloadablesQueryV07;

export interface TaskListSnapshotV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly revision: number;
  readonly tasks: readonly TaskSnapshotV01[];
}

export type CancellationOutcomeV01 = "requested" | "already_requested" | "already_terminal";

export interface TaskCancellationResultV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly taskId: string;
  readonly revision: number;
  readonly state: TaskStateV01;
  readonly outcome: CancellationOutcomeV01;
}

/** 环境检测辖区，与 B6 检测 spike 的 Zone 一致 */
export type EnvironmentZoneV01 = "play" | "create";

/**
 * 在场事实，不做严重度裁决：组件缺失是正常发现，不是错误。
 * 缺失是否构成问题、以何种严重度呈现，由消费侧决定。
 */
export type EnvironmentPresenceV01 = "detected" | "not_detected" | "detection_failed";

export interface EnvironmentCheckItemV01 {
  /**
   * 条目级 schema 版本，live wire 逐条携带（引擎 serde u8；操作者 CDP
   * 键集实证 2026-09-17：schemaVersion+checkId+zone+presence+errorCode+facts）。
   * BOARD #36 第二处分歧（逐条 schemaVersion 未声明）由核心账本判定加性
   * 无害（2026-09-18）；桌面投影暂不消费，声明为可选——live 形状测试可
   * 钉死此键，既有 mock/fixture 构造零破坏。
   */
  readonly schemaVersion?: number;
  /** 稳定检查 id（如 `steam`、`unity_editors`）；修复计划与表现层按它取键。
   *  BOARD #36 权威定名（2026-09-18 核心裁决）：wire 面即本键，偏差方为
   *  引擎序列化面（引擎侧 serde rename 已修，wt-2 c9d3d83）。 */
  readonly checkId: string;
  readonly zone: EnvironmentZoneV01;
  readonly presence: EnvironmentPresenceV01;
  /** 仅在 presence === "detection_failed" 时设置；live wire 上缺席时为 null */
  readonly errorCode?: string;
  /** 工程事实（路径、版本、字节数等原始观测）；对契约不透明 */
  readonly facts: Readonly<Record<string, unknown>>;
}

export interface EnvironmentSnapshotV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly revision: number;
  readonly capturedAt: string;
  readonly items: readonly EnvironmentCheckItemV01[];
}

export interface EnvironmentSnapshotQueryV01 extends ApplicationRequestBaseV01 {
  readonly kind: "query";
  readonly method: "environment.getSnapshot";
  readonly params: Readonly<Record<string, never>>;
}

/**
 * 演示任务命令（F2）：任务体验的端到端演示通道（提交 → 观察 → 取消）。
 * 由操作级 capability（`demo.task`）门控；首个真实用例命令落地后降级为测试夹具。
 * 创建的任务与真实任务走完全相同的九态、事件与取消语义，不携带用户数据。
 */
export interface DemoTaskStartCommandV01 extends ApplicationRequestBaseV01 {
  readonly kind: "command";
  readonly method: "task.startDemo";
  readonly commandId: string;
  readonly params: Readonly<Record<string, never>>;
}

export interface DemoTaskStartedV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly task: TaskSnapshotV01;
}

export type ApplicationSuccessValueV01 =
  | NetworkResult
  | WebsiteTestResult
  | LibraryListV01 | LibraryProductFilesV01
  | RecipeDraftListV01 | RecipeDraftReadV01
  | LibraryRemovalPreviewV01 | LibraryRemovalSnapshotV01 | RecipeDraftSelectionStatusV01
  | DeploymentPlanResult
  | DeploymentAccepted
  | ApplicationSnapshotV01
  | TaskListSnapshotV01
  | TaskSnapshotV01
  | TaskCancellationResultV01
  | EnvironmentSnapshotV01
  | DemoTaskStartedV01
  | ProductionInspectionStartedV02
  | ProductionInspectionViewV02
  | ProductionPlanIssuedV02
  | ProductionPlanViewV02
  | ProductionBuildRecordViewV02
  | CatalogListResultV03
  | CatalogDetailResultV03
  | CatalogStatusResultV03
  | WarehouseListEntriesResultV03
  | WarehouseEntryDetailResultV03
  | DownloadsListCompletedResultV04
  | DependenciesLookupResultV05
  | DependenciesListByProductResultV05
  | EnvironmentVerifyEditorResultV01
  | ProjectEnvironmentManagersResultV01
  | ProjectListProjectsResultV01
  | ProjectInspectProjectResultV01
  | ProjectLockStatusResultV01
  | OverlaySnapshotResultV01
  | WarehouseSetArtifactModeResultV01
  | WarehouseSetGlobalDefaultModeResultV02
  | WarehouseImportAcceptedV03
  | RecipeSaveResultV02
  | RecipeGetResultV02
  | RecipeListResultV02
  | ProductionTaskAcceptedV02
  | PlanApproveResultV02
  | PlanGetResultV02
  | PlanListResultV02
  | JobExecuteResultV02
  | RecordGetResultV02
  | RecordListResultV02
  | ProjectImportCopyResultV01
  | PackagesRemoveResultV01
  | PackagesInstallResultV02
  | PackagesRegisterResultV03
  | PackagesAddRemoteRepoResultV04
  | PackagesAddLocalRepoResultV04
  | PackagesRemoveRepoResultV04
  | PackagesCreateProjectResultV05
  | WarehouseMaintenanceAcceptedV01
  | ReleaseHandoffAcceptedV02
  | ReleaseInspectionAcceptedV02
  | RecipeExportProjectDraftResultV01;

export type ApplicationResponseV01 =
  | {
      readonly contractVersion: ApplicationContractVersion;
      readonly requestId: string;
      readonly ok: true;
      readonly value: ApplicationSuccessValueV01;
    }
  | {
      readonly contractVersion: ApplicationContractVersion;
      readonly requestId: string;
      readonly ok: false;
      readonly error: AppErrorV01;
    };

interface TaskEventBaseV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly eventId: string;
  readonly taskId: string;
  readonly revision: number;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly state: TaskStateV01;
}

export type TaskEventV01 =
  | (TaskEventBaseV01 & {
      readonly kind: "task.accepted" | "task.stateChanged";
      readonly payload: Readonly<Record<string, never>>;
    })
  | (TaskEventBaseV01 & {
      readonly kind: "task.progressed";
      readonly payload: {
        readonly completed: number;
        readonly total?: number;
        readonly messageKey: string;
        readonly params?: Readonly<Record<string, ApplicationParamValueV01>>;
      };
    })
  | (TaskEventBaseV01 & {
      readonly kind: "task.cancellationRequested";
      readonly payload: {
        readonly commandId: string;
        readonly observedRevision?: number;
      };
    })
  | (TaskEventBaseV01 & {
      readonly kind: "task.completed";
      readonly payload: {
        readonly error?: AppErrorV01;
      };
    })
  | (TaskEventBaseV01 & {
      /**
       * In-session persistence failure (honesty discipline #2): the task is
       * frozen at its last persisted state and awaits inspection; it reads
       * `recoveryDisposition: "inspect_required"` on the next snapshot
       * re-query. Never persisted by the runtime — this event is the only
       * in-session notification, so consumers must re-query the task face
       * rather than infer a terminal state.
       */
      readonly kind: "task.persistenceFailed";
      readonly payload: {
        readonly error?: AppErrorV01;
      };
    });

export interface CapabilityChangedEventV01 {
  readonly contractVersion: ApplicationContractVersion;
  readonly eventId: string;
  readonly revision: number;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly kind: "capability.changed";
  readonly payload: CapabilitySnapshotV01;
}

export type ApplicationEventV01 = TaskEventV01 | CapabilityChangedEventV01 | DownloadIntentEventV03;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Schema minLength: 1 的自由文本(路径、项目 id、decisionId 等) */
function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1;
}

/** 域引用身份($defs):前缀 + 16 位小写十六进制 */
const INSPECTION_ID_PATTERN = /^insp-[0-9a-f]{16}$/;
const PLAN_ID_PATTERN = /^plan-[0-9a-f]{16}$/;

function isInspectionId(value: unknown): value is string {
  return typeof value === "string" && INSPECTION_ID_PATTERN.test(value);
}

function isPlanId(value: unknown): value is string {
  return typeof value === "string" && PLAN_ID_PATTERN.test(value);
}

const PRODUCTION_MODES_V02: readonly string[] = ["direct_unity_package", "local_reusable_vpm"];
const PRODUCTION_RISK_CHOICES_V02: readonly string[] = [
  "snapshot_and_continue",
  "continue",
  "cancel",
  "not_required",
];

function isProductionMode(value: unknown): boolean {
  return typeof value === "string" && PRODUCTION_MODES_V02.includes(value);
}

function isProductionRiskChoice(value: unknown): boolean {
  return typeof value === "string" && PRODUCTION_RISK_CHOICES_V02.includes(value);
}

export function isApplicationRequestV01(value: unknown): value is ApplicationRequestV01 {
  if (!isRecord(value) || value.contractVersion !== APPLICATION_CONTRACT_VERSION) return false;
  if (!isIdentifier(value.requestId) || !isIdentifier(value.correlationId) || !isRecord(value.params)) return false;

  if (value.kind === "query" && value.method === "application.getSnapshot") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  if (value.kind === "query" && value.method === "task.list") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  if (value.kind === "query" && value.method === "task.get") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["taskId"])
      && isIdentifier(value.params.taskId);
  }
  if (value.kind === "command" && value.method === "task.requestCancellation") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])) {
      return false;
    }
    if (!isIdentifier(value.commandId) || !isIdentifier(value.params.taskId)) return false;
    const keys = Object.keys(value.params);
    if (!keys.every((key) => key === "taskId" || key === "observedRevision") || !keys.includes("taskId")) return false;
    return value.params.observedRevision === undefined || isNonNegativeInteger(value.params.observedRevision);
  }
  if (value.method === "environment.checkNetwork") {
    return value.kind === "query" && hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && isNetworkParams(value.params);
  }
  if (value.method === "environment.testWebsites") {
    return value.kind === "query" && hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && isWebsiteTestParams(value.params);
  }
  if (value.method === "environment.planDeployment" || value.method === "environment.executeDeployment") {
    const execute = value.method === "environment.executeDeployment";
    return value.kind === (execute ? "command" : "query")
      && hasExactKeys(value, execute ? ["contractVersion", "requestId", "correlationId", "kind", "method", "params", "commandId"] : ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && (!execute || isDeploymentCommandId(value.commandId)) && isDeploymentParams(value.params, execute);
  }
  if (value.kind === "query" && value.method === "environment.getSnapshot") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  // 021 词表行(核心七点裁决):单字段闭集 {path},minLength 1,词表外键拒绝
  if (value.kind === "query" && value.method === "environment.verifyEditor") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["path"])
      && isNonEmptyText(value.params.path);
  }
  if (value.kind === "command" && value.method === "task.startDemo") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, []);
  }
  if (value.kind === "command" && value.method === "production.startInspection") {
    // v0.2 四元组:路径与项目身份由 Kernel 一次性转交,Schema 只要求非空字符串
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["sourceFolder", "projectRoot", "artifactOutputRoot", "projectId"])
      && isNonEmptyText(value.params.sourceFolder)
      && isNonEmptyText(value.params.projectRoot)
      && isNonEmptyText(value.params.artifactOutputRoot)
      && isNonEmptyText(value.params.projectId);
  }
  if (value.kind === "query" && value.method === "production.getInspection") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["inspectionId"])
      && isInspectionId(value.params.inspectionId);
  }
  if (value.kind === "command" && value.method === "production.requestPlan") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["inspectionId", "mode"])
      && isInspectionId(value.params.inspectionId)
      && isProductionMode(value.params.mode);
  }
  if (value.kind === "query" && value.method === "production.getPlan") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["planId"])
      && isPlanId(value.params.planId);
  }
  if (value.kind === "command" && value.method === "production.confirmPlan") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)) {
      return false;
    }
    // v0.2:observedRevision 与 riskChoice 必填(确认纪律 + 风险决策 UI 义务),
    // rememberForSession 可选;词表外参数拒绝
    const confirmKeys = Object.keys(value.params).sort();
    const confirmExpected = ["observedRevision", "planId", "rememberForSession", "riskChoice"];
    if (confirmKeys.length !== 3 && confirmKeys.length !== 4) return false;
    if (!confirmKeys.every((key) => confirmExpected.includes(key))) return false;
    if (!isPlanId(value.params.planId)) return false;
    if (typeof value.params.observedRevision !== "number"
      || !Number.isSafeInteger(value.params.observedRevision)
      || value.params.observedRevision < 1) return false;
    if (!isProductionRiskChoice(value.params.riskChoice)) return false;
    return value.params.rememberForSession === undefined
      || typeof value.params.rememberForSession === "boolean";
  }
  if (value.kind === "command" && value.method === "production.recover") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)) {
      return false;
    }
    const recoverKeys = Object.keys(value.params).sort();
    const recoverExpected = ["decision", "decisionId", "planId", "taskId"];
    if (recoverKeys.length !== 3 && recoverKeys.length !== 4) return false;
    if (!recoverKeys.every((key) => recoverExpected.includes(key))) return false;
    if (!isIdentifier(value.params.taskId) || !isNonEmptyText(value.params.decisionId)) return false;
    if (value.params.decision !== "continue" && value.params.decision !== "rollback") return false;
    return value.params.planId === undefined || isPlanId(value.params.planId);
  }
  if (value.kind === "query" && value.method === "production.getBuildRecord") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["buildRecordId"])
      && typeof value.params.buildRecordId === "string"
      && /^[A-Za-z0-9_-]{1,128}$/.test(value.params.buildRecordId);
  }
  if (value.kind === "query" && value.method === "catalog.list") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])) return false;
    const listParams = value.params as CatalogListQueryV03["params"];
    if (!Object.keys(listParams).every((key) => key === "text" || key === "availabilityStatus" || key === "libraryType" || key === "limit" || key === "offset")) {
      return false;
    }
    if (listParams.text !== undefined && listParams.text !== null
      && (typeof listParams.text !== "string" || listParams.text.length < 1)) return false;
    if (listParams.libraryType !== undefined && listParams.libraryType !== null
      && !(["bought", "gifts", "free_downloads"] as readonly string[]).includes(listParams.libraryType)) {
      return false;
    }
    if (listParams.availabilityStatus !== undefined && listParams.availabilityStatus !== null
      && !(["available", "unavailable", "unknown"] as readonly string[]).includes(listParams.availabilityStatus)) {
      return false;
    }
    if (listParams.limit !== undefined
      && (typeof listParams.limit !== "number" || !Number.isSafeInteger(listParams.limit) || listParams.limit < 1 || listParams.limit > 200)) {
      return false;
    }
    if (listParams.offset !== undefined
      && (typeof listParams.offset !== "number" || !Number.isSafeInteger(listParams.offset) || listParams.offset < 0)) {
      return false;
    }
    return true;
  }
  if (value.kind === "query" && value.method === "catalog.detail") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["productId"])
      && typeof value.params.productId === "string"
      && /^booth:[0-9]+$/.test(value.params.productId);
  }
  if (value.kind === "query" && value.method === "catalog.status") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  if (value.kind === "query" && value.method === "warehouse.listEntries") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  // bdl-queries v0.4(015 §10):可采纳已完成交付列表,params 闭集 = 空
  if (value.kind === "query" && value.method === "downloads.listCompleted") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  // bdl-queries v0.5(030 §5.7 案 A,数据席第 168 批 FROZEN;桌面 TS 登记面):
  // lookup params 闭集 {name, depKind?, limit?, offset?}——name 必填非空,
  // depKind 骑 BDL v0.2 四值闭集(null/缺席 = 不过滤),分页 1–200/≥0;
  // 词外键(含 fuzzy 等价开关)拒绝 = 契约错误,绝不静默空答(负例向量同形)
  if (value.kind === "query" && value.method === "dependencies.lookup") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])) return false;
    const lookupParams = value.params as DependenciesLookupQueryV05["params"];
    const keys = Object.keys(lookupParams);
    if (!keys.includes("name") || keys.some((key) => key !== "name" && key !== "depKind" && key !== "limit" && key !== "offset")) {
      return false;
    }
    if (typeof lookupParams.name !== "string" || lookupParams.name.length < 1) return false;
    if (lookupParams.depKind !== undefined && lookupParams.depKind !== null
      && !(["shader", "tool_package", "avatar_base", "other"] as readonly string[]).includes(lookupParams.depKind)) {
      return false;
    }
    if (lookupParams.limit !== undefined
      && (typeof lookupParams.limit !== "number" || !Number.isSafeInteger(lookupParams.limit) || lookupParams.limit < 1 || lookupParams.limit > 200)) {
      return false;
    }
    if (lookupParams.offset !== undefined
      && (typeof lookupParams.offset !== "number" || !Number.isSafeInteger(lookupParams.offset) || lookupParams.offset < 0)) {
      return false;
    }
    return true;
  }
  // listByProduct params 单键闭集 {productId}(catalog.detail 同 pattern);
  // 无 name/过滤键——客户端过滤 = 契约错误(负例向量钉死),绝不静默空答
  if (value.kind === "query" && value.method === "dependencies.listByProduct") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["productId"])
      && typeof value.params.productId === "string"
      && /^booth:[0-9]+$/.test(value.params.productId);
  }
  // bdl-queries v0.7(N5 静默下载):params 闭集 = {productId}(booth 身份
  // 形态,同 listByProduct;无过滤键)
  if (value.kind === "query" && value.method === "catalog.productDownloadables") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["productId"])
      && typeof value.params.productId === "string"
      && /^booth:[0-9]+$/.test(value.params.productId);
  }
  // 013 读面(核心 e720544/5b65550 四查询全 live):params 闭集照冻结面
  if (value.kind === "query" && value.method === "project.environmentManagers") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  if (value.kind === "query" && value.method === "project.listProjects") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  if (value.kind === "query" && value.method === "project.inspectProject") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["projectPath"])
      && isIdentifier(value.params.projectPath);
  }
  if (value.kind === "query" && value.method === "project.lockStatus") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["projectPath"])
      && isIdentifier(value.params.projectPath);
  }
  // 024 P1 读面(核心冻结批 2026-09-17):params 闭集 = 单键 projectPath
  if (value.kind === "query" && value.method === "packages.listInstalled") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["projectPath"])
      && isIdentifier(value.params.projectPath);
  }
  // 025 P2 读面(核心冻结批 2026-09-17):listRepos = 空闭集(全局配置
  // 面);packageCatalog = 双键闭集(projectPath 013 身份 + packageId)
  if (value.kind === "query" && value.method === "packages.listRepos") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  if (value.kind === "query" && value.method === "packages.packageCatalog") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["projectPath", "packageId"])
      && isIdentifier(value.params.projectPath)
      && isIdentifier(value.params.packageId);
  }
  // 027 F2 读面(核心冻结批 2026-09-20):repoCatalog = 双键必带可空
  // 闭集(repoId 仓库范围 null=全部;packageIds Recipe 需求集合批量
  // 过滤 null=不过滤,非空数组须唯一非空 id,空数组是形状违反)
  if (value.kind === "query" && value.method === "packages.repoCatalog") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      || !hasExactKeys(value.params, ["repoId", "packageIds"])) {
      return false;
    }
    const { repoId, packageIds } = value.params;
    if (repoId !== null && (typeof repoId !== "string" || repoId.length === 0)) return false;
    if (packageIds === null) return true;
    if (!Array.isArray(packageIds) || packageIds.length === 0) return false;
    return packageIds.every((id) => typeof id === "string" && id.length > 0)
      && new Set(packageIds).size === packageIds.length;
  }
  // 027 F5 读面(核心冻结批 2026-09-20):listTemplates = 空闭集(环境
  // 级配置面,任何键 = 词表外形状违反)
  if (value.kind === "query" && value.method === "packages.listTemplates") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  // 026 A1 写面(核心冻结批 2026-09-19):previewRemove = 双键闭集
  // (projectPath 013 身份 + packageIds 显式非空闭列,无通配);
  // applyRemove = 三键闭集(加 confirmedDigest,commandId 幂等)
  if (value.kind === "query" && value.method === "packages.previewRemove") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      || !hasExactKeys(value.params, ["projectPath", "packageIds"])) {
      return false;
    }
    if (!isIdentifier(value.params.projectPath)) return false;
    const packageIds = value.params.packageIds;
    if (!Array.isArray(packageIds) || packageIds.length === 0) return false;
    return packageIds.every((id) => typeof id === "string" && id.length > 0);
  }
  if (value.kind === "command" && value.method === "packages.applyRemove") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["projectPath", "packageIds", "confirmedDigest"])) {
      return false;
    }
    if (!isIdentifier(value.params.projectPath)) return false;
    if (typeof value.params.confirmedDigest !== "string" || value.params.confirmedDigest.length === 0) return false;
    const packageIds = value.params.packageIds;
    if (!Array.isArray(packageIds) || packageIds.length === 0) return false;
    return packageIds.every((id) => typeof id === "string" && id.length > 0);
  }
  // 026 A2 写面(核心冻结批 2026-09-19):previewInstall = 双键闭集
  // (projectPath 013 身份 + packages 请求行闭列〔packageId+version 必填
  // 可空〕,同 packageId 重复 = 词面违反);applyInstall = 三键闭集(加
  // confirmedDigest,commandId 幂等)
  if (value.kind === "query" && value.method === "packages.previewInstall") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      || !hasExactKeys(value.params, ["projectPath", "packages"])) {
      return false;
    }
    if (!isIdentifier(value.params.projectPath)) return false;
    const packages = value.params.packages;
    if (!Array.isArray(packages) || packages.length === 0) return false;
    // 同 packageId 重复 = 词面违反(版本不同亦然)。Schema uniqueItems 只
    // 钉完全重复行;行间 id 唯一在此闭集窄化内钉死——026 A2 形状核可钉
    // 法缺口申报(wt-3 2026-09-19)的 TS 层闭合。
    const seenIds = new Set<string>();
    return packages.every((row) => {
      if (typeof row !== "object" || row === null) return false;
      if (!hasExactKeys(row, ["packageId", "version"])) return false;
      if (typeof row.packageId !== "string" || row.packageId.length === 0) return false;
      if (seenIds.has(row.packageId)) return false;
      seenIds.add(row.packageId);
      return row.version === null || (typeof row.version === "string" && row.version.length > 0);
    });
  }
  if (value.kind === "command" && value.method === "packages.applyInstall") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["projectPath", "packages", "confirmedDigest"])) {
      return false;
    }
    if (!isIdentifier(value.params.projectPath)) return false;
    if (typeof value.params.confirmedDigest !== "string" || value.params.confirmedDigest.length === 0) return false;
    const packages = value.params.packages;
    if (!Array.isArray(packages) || packages.length === 0) return false;
    // 同 packageId 重复 = 词面违反(版本不同亦然)——与 previewInstall 同
    // 一闭列规则,TS 层闭合(026 A2 形状核可钉法缺口申报)。
    const seenIds = new Set<string>();
    return packages.every((row) => {
      if (typeof row !== "object" || row === null) return false;
      if (!hasExactKeys(row, ["packageId", "version"])) return false;
      if (typeof row.packageId !== "string" || row.packageId.length === 0) return false;
      if (seenIds.has(row.packageId)) return false;
      seenIds.add(row.packageId);
      return row.version === null || (typeof row.version === "string" && row.version.length > 0);
    });
  }
  // 026 A3 写面(核心冻结批 2026-09-19):registerLocalPackage = 单键
  // 闭集 {packageRoot}(本地包根目录,非空;无 projectPath——注册只动
  // 后端隔离环境;无 digest 位——携即形状违反,本面无 preview 可漂移,
  // 用户显式提交即确认)
  if (value.kind === "command" && value.method === "packages.registerLocalPackage") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["packageRoot"])) {
      return false;
    }
    return typeof value.params.packageRoot === "string" && value.params.packageRoot.length > 0;
  }
  // 026 A4 写面(核心冻结批 2026-09-19):仓库订阅增删面三命令。
  // addRemoteRepo = 双键闭集 {url, name}(均非空;无 projectPath——订阅
  // 面只写后端隔离环境;无 digest 位——携即形状违反;首期词面不收
  // HTTP 头/凭据);addLocalRepo = 双键闭集 {path, name}(无网络段);
  // removeRepo = 单键闭集 {repoId}(稳定行柄,非空;索引寻址不冻结)
  if (value.kind === "command" && value.method === "packages.addRemoteRepo") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["url", "name"])) {
      return false;
    }
    return typeof value.params.url === "string" && value.params.url.length > 0
      && typeof value.params.name === "string" && value.params.name.length > 0;
  }
  if (value.kind === "command" && value.method === "packages.addLocalRepo") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["path", "name"])) {
      return false;
    }
    return typeof value.params.path === "string" && value.params.path.length > 0
      && typeof value.params.name === "string" && value.params.name.length > 0;
  }
  if (value.kind === "command" && value.method === "packages.removeRepo") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["repoId"])) {
      return false;
    }
    return typeof value.params.repoId === "string" && value.params.repoId.length > 0;
  }
  // 026 A5 写面(核心冻结批 2026-09-19):createProject = 三键闭集
  // {parent, name, template}(前两者非空;template REQUIRED-nullable——
  // null=后端默认模板解析〔库路径默认 Avatar 三级解析序,冻结词面事实
  // 非选择器,首面零新读面〕,非空串=该模板名/路径 verbatim 透传;无
  // projectPath——创建不寻址任何在册项目;无 digest 位——携即形状违反,
  // 用户显式表单提交即确认)
  if (value.kind === "command" && value.method === "packages.createProject") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["parent", "name", "template"])) {
      return false;
    }
    return typeof value.params.parent === "string" && value.params.parent.length > 0
      && typeof value.params.name === "string" && value.params.name.length > 0
      && (value.params.template === null
        || (typeof value.params.template === "string" && value.params.template.length > 0));
  }
  // 027 F4 写面(核心冻结批 2026-09-20):仓库生命周期面三命令。
  // enableRepo / disableRepo / refreshRepo 各单键闭集 {repoId}(稳定行
  // 柄,非空;无 digest 位——携即形状违反,用户显式提交即确认;无
  // projectPath——生命周期面只寻址订阅行)。禁用语义=该行离开包集合世
  // 界但保留订阅面(v0.2 enabled 位读回);刷新=etag 条件刷新该行自身
  // 缓存,cacheUpdated 两臂皆成功
  if (value.kind === "command" && value.method === "packages.enableRepo") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["repoId"])) {
      return false;
    }
    return typeof value.params.repoId === "string" && value.params.repoId.length > 0;
  }
  if (value.kind === "command" && value.method === "packages.disableRepo") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["repoId"])) {
      return false;
    }
    return typeof value.params.repoId === "string" && value.params.repoId.length > 0;
  }
  if (value.kind === "command" && value.method === "packages.refreshRepo") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !hasExactKeys(value.params, ["repoId"])) {
      return false;
    }
    return typeof value.params.repoId === "string" && value.params.repoId.length > 0;
  }
  // 017 overlay 读面批 1:params 闭集 = 空
  if (value.kind === "query" && value.method === "overlay.getSnapshot") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, []);
  }
  // M7 检查切片:inspection.get(身份寻址,闭集单键)/inspection.list
  // (闭集可选键:avatarRef 精确匹配、overallStatus 三值闭集、有界分页)/
  // inspection.requestRun(任务化驱动写命令)
  if (value.kind === "query" && value.method === "inspection.get") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["inspectionId"])
      && isIdentifier(value.params.inspectionId);
  }
  if (value.kind === "query" && value.method === "inspection.list") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])) return false;
    for (const key of Object.keys(value.params)) {
      switch (key) {
        case "avatarRef":
          if (typeof value.params[key] !== "string" || (value.params[key] as string).length === 0) return false;
          break;
        case "overallStatus":
          if (value.params[key] !== "pass" && value.params[key] !== "warn" && value.params[key] !== "fail") return false;
          break;
        case "limit":
        case "offset":
          if (typeof value.params[key] !== "number" || !Number.isInteger(value.params[key])) return false;
          break;
        default:
          return false;
      }
    }
    return true;
  }
  if (value.kind === "command" && value.method === "inspection.requestRun") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      || !hasExactKeys(value.params, ["avatarGlobalObjectId", "avatarRef"])) {
      return false;
    }
    if (!isIdentifier(value.params.avatarGlobalObjectId)) return false;
    const avatarRef = value.params.avatarRef as { ref?: unknown; label?: unknown };
    if (!isRecord(avatarRef) || typeof avatarRef.ref !== "string" || avatarRef.ref.length === 0) return false;
    return avatarRef.label === undefined || avatarRef.label === null || typeof avatarRef.label === "string";
  }
  if (value.kind === "query" && value.method === "warehouse.entryDetail") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["warehouseItemId"])
      && isIdentifier(value.params.warehouseItemId);
  }
  if (value.kind === "command" && value.method === "download.ingest") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)) {
      return false;
    }
    const ingestParams = value.params as { schemaVersion?: unknown; events?: unknown };
    if (ingestParams.schemaVersion !== "0.1" || !Array.isArray(ingestParams.events)) return false;
    return ingestParams.events.every((event) => isDownloadEventV01(event));
  }
  if (value.kind === "command" && value.method === "catalog.ingestLibraryPage") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)) {
      return false;
    }
    const ingestPageParams = value.params as Record<string, unknown>;
    if (ingestPageParams.schemaVersion === "0.3") return isCatalogSyncParamsV03(value.method, value.params);
    const ingestPageKeys = ["schemaVersion", "sourceUrl", "html", "fetchedAt"];
    if (ingestPageParams.pageNumber !== undefined) ingestPageKeys.push("pageNumber");
    if (ingestPageParams.runId !== undefined) ingestPageKeys.push("runId");
    if (ingestPageParams.libraryType !== undefined) ingestPageKeys.push("libraryType");
    return hasExactKeys(ingestPageParams, ingestPageKeys) && isCatalogSyncPageRequestV01(value.params);
  }
  if (value.kind === "command" && (value.method === "catalog.beginLibrarySync" || value.method === "catalog.finishLibrarySync")) {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId) && isCatalogSyncParamsV03(value.method, value.params);
  }
  if (typeof value.method === "string" && value.method.startsWith("recipeDraft.")) {
    const query = value.method === "recipeDraft.list" || value.method === "recipeDraft.get" || value.method === "recipeDraft.selectionStatus";
    return value.kind === (query ? "query" : "command") && hasExactKeys(value, query ? ["contractVersion", "requestId", "correlationId", "kind", "method", "params"] : ["contractVersion", "requestId", "correlationId", "kind", "method", "params", "commandId"])
      && (query || isIdentifier(value.commandId)) && isRecipeDraftParamsV01(value.method, value.params);
  }
  if (value.method === "library.removalPreview" || value.method === "library.removeFiles" || value.method === "library.removalStatus") {
    const query = value.method !== "library.removeFiles";
    return value.kind === (query ? "query" : "command") && hasExactKeys(value, query ? ["contractVersion", "requestId", "correlationId", "kind", "method", "params"] : ["contractVersion", "requestId", "correlationId", "kind", "method", "params", "commandId"])
      && (query || isIdentifier(value.commandId)) && isLibraryMaintenanceParamsV01(value.method, value.params);
  }
  if (value.method === "library.list" || value.method === "library.productFiles") {
    return value.kind === "query" && hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && isLibraryViewParamsV01(value.method, value.params);
  }
  if (value.method === "library.beginDownload" || value.method === "library.observeDownload" || value.method === "library.downloadStatus") {
    const query = value.method === "library.downloadStatus";
    return value.kind === (query ? "query" : "command")
      && hasExactKeys(value, query ? ["contractVersion", "requestId", "correlationId", "kind", "method", "params"] : ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && (query || isIdentifier(value.commandId)) && isLibraryDownloadParamsV01(value.method, value.params);
  }
  if (value.kind === "query" && value.method === "catalog.librarySyncStatus") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && isCatalogSyncParamsV03(value.method, value.params);
  }
  if (value.kind === "command" && value.method === "download.retry") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["taskId"])
      && isIdentifier(value.params.taskId);
  }
  // bdl-commands v0.1 写命令(proposal 005):params 闭集 + 模式词表闭集
  if (value.kind === "command" && value.method === "warehouse.setArtifactMode") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["warehouseItemId", "mode"])
      && isIdentifier(value.params.warehouseItemId)
      && (value.params.mode === null
        || value.params.mode === "use_original_unitypackage"
        || value.params.mode === "generate_vpm");
  }
  if (value.kind === "command" && value.method === "warehouse.deleteOriginalsByProduct") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["productId"])
      && isIdentifier(value.params.productId);
  }
  if (value.kind === "command" && value.method === "warehouse.deleteOriginals") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["warehouseItemId"])
      && isIdentifier(value.params.warehouseItemId);
  }
  // generateVpm:v0.3 词表可选携带 importCorrelationId(导入编排自动生成;
  // 手动发起恒不携带)——params 闭集 = warehouseItemId ± importCorrelationId
  if (value.kind === "command" && value.method === "warehouse.generateVpm") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)
      || !isIdentifier(value.params.warehouseItemId)) return false;
    const keys = Object.keys(value.params).sort();
    return keys.length === 1
      || (keys.length === 2
        && keys.includes("importCorrelationId")
        && typeof value.params.importCorrelationId === "string"
        && value.params.importCorrelationId.length > 0);
  }
  // bdl-commands v0.2 全局层(W14):params 闭集 = mode,词表闭集无 null
  if (value.kind === "command" && value.method === "warehouse.setGlobalDefaultMode") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["mode"])
      && (value.params.mode === "use_original_unitypackage"
        || value.params.mode === "generate_vpm");
  }
  // bdl-commands v0.3 导入(W19)+ v0.5 可选 autoGenerate(N5 实验选项):
  // params 闭集 = sourceFolders ± autoGenerate(boolean),非空字符串数组
  if (value.kind === "command" && value.method === "warehouse.import") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      || !isIdentifier(value.commandId)) return false;
    const keys = Object.keys(value.params).sort();
    return (keys.length === 1 || (keys.length === 2 && keys.includes("autoGenerate")))
      && keys.includes("sourceFolders")
      && (value.params.autoGenerate === undefined || typeof value.params.autoGenerate === "boolean")
      && Array.isArray(value.params.sourceFolders)
      && value.params.sourceFolders.length > 0
      && value.params.sourceFolders.every(
        (folder: unknown) => typeof folder === "string" && folder.length > 0);
  }
  // bdl-commands v0.4 下载采纳(IMP-3):params 闭集 = downloadIds,非空字符串
  // 数组(仅身份——路径/大小/文件名是服务端事实,词表外字段即契约违反)
  if (value.kind === "command" && value.method === "warehouse.importDownloads") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["downloadIds"])
      && Array.isArray(value.params.downloadIds)
      && value.params.downloadIds.length > 0
      && value.params.downloadIds.every(
        (downloadId: unknown) => typeof downloadId === "string" && downloadId.length > 0);
  }
  // production-use-case v0.2(W20 ten-method freeze): required-key closed sets
  if (value.kind === "command" && value.method === "recipe.save") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["recipeDocument", "baseRevision"])
      && typeof value.params.baseRevision === "number"
      && typeof value.params.recipeDocument === "object"
      && value.params.recipeDocument !== null;
  }
  if (value.kind === "command" && value.method === "recipe.resolve") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])) return false;
      if (!isIdentifier(value.commandId)) return false;
    const keys = Object.keys(value.params).sort();
    if (keys.length !== 1 && keys.length !== 2) return false;
    if (!keys.includes("recipeId") || typeof value.params.recipeId !== "string") return false;
    if (keys.length === 2 && (keys[1] !== "revision" || typeof value.params.revision !== "number")) return false;
    return true;
  }
  if (value.kind === "command" && (value.method === "plan.approve" || value.method === "job.execute")) {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["planId"])
      && typeof value.params.planId === "string";
  }
  if (value.kind === "query" && (value.method === "recipe.get" || value.method === "plan.get")) {
    const idKey = value.method === "recipe.get" ? "recipeId" : "planId";
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, [idKey])
      && typeof (value.params as Record<string, unknown>)[idKey] === "string";
  }
  // project-ops v0.1(014):plan/apply 两段闭集;apply 必带 confirmedPlanDigest
  if (value.kind === "command" && value.method === "project.import-copy") {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])) return false;
      if (!isIdentifier(value.commandId)) return false;
    const p = value.params as Record<string, unknown>;
    const keys = Object.keys(p).sort();
    if (!keys.includes("phase") || !keys.includes("sourcePath") || !keys.includes("targetParentDirectory") || !keys.includes("targetProjectName")) return false;
    if (p.phase !== "plan" && p.phase !== "apply") return false;
    if (typeof p.sourcePath !== "string" || p.sourcePath.length === 0) return false;
    if (typeof p.targetParentDirectory !== "string" || p.targetParentDirectory.length === 0) return false;
    if (typeof p.targetProjectName !== "string" || p.targetProjectName.length === 0) return false;
    if (p.phase === "apply") {
      if (keys.length !== 5 || !keys.includes("confirmedPlanDigest")) return false;
      if (typeof p.confirmedPlanDigest !== "string" || p.confirmedPlanDigest.length === 0) return false;
    } else if (keys.length !== 4) return false;
    return true;
  }
  // production-use-case v0.2 读面闭集(011 section 7:catalog.list 先例)
  if (value.kind === "query" && (value.method === "record.get")) {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["buildId"])
      && typeof value.params.buildId === "string";
  }
  if (value.kind === "query" && (value.method === "recipe.list" || value.method === "plan.list" || value.method === "record.list")) {
    if (!hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])) return false;
    const keys = Object.keys(value.params).sort();
    const allowed = value.method === "recipe.list"
      ? ["limit", "offset", "text"]
      : ["limit", "offset", "recipeId", "text"];
    for (const key of keys) {
      if (!allowed.includes(key)) return false;
      if ((key === "limit" || key === "offset") && typeof value.params[key] !== "number") return false;
      if (key !== "limit" && key !== "offset" && typeof value.params[key] !== "string") return false;
    }
    return true;
  }
  // 023 词表行(核心冻结批 2026-09-16)＋v0.2 检视入口(核心 U19 批入库,
  // 桌面 TS 面登记):params 单字段闭集 {buildId},词表外键拒绝(形状违反
  // =invalid_params,绝不冒充缺席);两 editor-open 入口同律
  if (value.kind === "command" && value.method === "release.openForHandoff") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["buildId"])
      && isNonEmptyText(value.params.buildId);
  }
  if (value.kind === "command" && value.method === "release.openForInspection") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "commandId", "params"])
      && isIdentifier(value.commandId)
      && hasExactKeys(value.params, ["buildId"])
      && isNonEmptyText(value.params.buildId);
  }
  // 029 B 面 recipe-export v0.1(桌面环 4 TS 面登记):同步只读 Query,params
  // 单键闭集 {projectPath}(013 注册身份),词表外键拒绝(形状违反 =
  // invalid_params,绝不冒充缺席);未注册路径由 Provider 回复用码
  if (value.kind === "query" && value.method === "recipe.exportProjectDraft") {
    return hasExactKeys(value, ["contractVersion", "requestId", "correlationId", "kind", "method", "params"])
      && hasExactKeys(value.params, ["projectPath"])
      && isNonEmptyText(value.params.projectPath);
  }
  return false;
}

/** 交接事实文档运行时守卫(023 冻结批,v0.2 版本戳):形状即诚实纪律——
 *  闭集键外任何字段(尤其上传状态类)拒绝;消费测试负例钉死 */
export function isReleaseHandoffFactV02(value: unknown): value is ReleaseHandoffFactV02 {
  if (!isRecord(value)) return false;
  if (!hasExactKeys(value, ["schemaVersion", "buildId", "projectId", "editor", "occurredAt"])) return false;
  if (value.schemaVersion !== "0.2") return false;
  if (!isNonEmptyText(value.buildId) || !isNonEmptyText(value.projectId) || !isNonEmptyText(value.occurredAt)) {
    return false;
  }
  if (!isRecord(value.editor)) return false;
  return hasExactKeys(value.editor, ["exePath", "version"])
    && isNonEmptyText(value.editor.exePath)
    && isNonEmptyText(value.editor.version);
}

/** 检视事实文档运行时守卫(U19 v0.2):六键闭集＋显式 operation 词面——
 *  携任何其他 operation 值的事实由构造即非法(负例向量钉);无上传状态
 *  字段(形状钉);词面纪律=本事实永不误读为交接完成 */
export function isReleaseInspectionFactV02(value: unknown): value is ReleaseInspectionFactV02 {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "operation",
      "buildId",
      "projectId",
      "editor",
      "occurredAt",
    ])
  ) {
    return false;
  }
  if (value.schemaVersion !== "0.2") return false;
  if (value.operation !== RELEASE_OPEN_FOR_INSPECTION_OPERATION) return false;
  if (!isNonEmptyText(value.buildId) || !isNonEmptyText(value.projectId) || !isNonEmptyText(value.occurredAt)) {
    return false;
  }
  if (!isRecord(value.editor)) return false;
  return hasExactKeys(value.editor, ["exePath", "version"])
    && isNonEmptyText(value.editor.exePath)
    && isNonEmptyText(value.editor.version);
}

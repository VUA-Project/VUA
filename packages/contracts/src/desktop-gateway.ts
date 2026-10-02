import { isDeploymentCommandId, isDeploymentParams, type DeploymentPlanParams, type DeploymentExecuteParams } from "./environment-deployment.js";
import type {
  AppErrorV01,
  ApplicationEventV01,
  ApplicationSuccessValueV01,
  CapabilityOperationV01,
  CatalogAvailabilityStatusV03,
  ProductionModeV02,
  ProductionRiskChoiceV02,
  WarehouseArtifactModeV03,
  ImportCopyPhaseV01,
} from "./application-contract.js";

export const DESKTOP_GATEWAY_VERSION = 1 as const;
export const DESKTOP_GATEWAY_MAX_REQUEST_BYTES = 64 * 1024;

/**
 * app.snapshot 桌面信封(BOARD #36 缺陷①修复批,2026-09-18):capabilities
 * 并入 provider 能力行 `operations`(ApplicationSnapshotV01.capabilities.
 * operations 原样透传,Kernel 不解释不增删)。此前信封只保留旧三布尔,致
 * 所有读 capabilities.operations 的页面 gate 恒空(#22 live/fixture 形状
 * 分裂教训:消费切片 mock 带行、live 信封没有)。remoteBrowser 值＝壳能力
 * 自报同源(#36 缺陷4′ 对齐,2026-09-19):§11 仲裁 (a) 内嵌浏览能力归壳
 * (preload capabilities)自报,provider 不报告也不转述;信封与壳自报引用
 * 同一事实源(electron/shell-capabilities),不再硬编码。能力面开放属
 * 功能决策,另行走登记。
 */
export interface AppSnapshotV1 {
  readonly schemaVersion: 1;
  readonly productVersion: string;
  readonly runtime: "electron";
  readonly platform: "win32" | "darwin" | "linux";
  readonly capabilities: {
    readonly gateway: true;
    readonly tasks: boolean;
    readonly remoteBrowser: boolean;
    readonly operations: readonly CapabilityOperationV01[];
  };
}

/**
 * Gateway 方法表(v1):Renderer 可见的显式方法面。
 * 每个方法映射到 application-contract v0.1 的对应 Query/Command(见
 * docs/protocols/application-contract-v0.1);映射关系由 Kernel(gateway-router)
 * 持有,Renderer 不接触 Provider 词汇以外的语义。
 * 未知方法在守卫处明确拒绝;新增方法在此登记并同步更新守卫与测试。
 */
export interface AppSnapshotRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "app.snapshot";
  readonly params: Record<string, never>;
}

export interface GatewayTaskListRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "task.list";
  readonly params: Record<string, never>;
}

export interface GatewayTaskGetRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "task.get";
  readonly params: {
    readonly taskId: string;
  };
}

export interface GatewayTaskCancellationRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "task.requestCancellation";
  readonly params: {
    readonly taskId: string;
    readonly commandId: string;
    readonly observedRevision?: number;
  };
}

export interface GatewayEnvironmentSnapshotRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "environment.getSnapshot";
  readonly params: Record<string, never>;
}

// ---- environment.verifyEditor(021 词表行,核心七点裁决 2026-09-13:分型
// query,params 单字段闭集 {path} minLength 1 三形态 verbatim 透传;词表
// 已由信封守卫验证,原样映射 Kernel) ----

export interface GatewayEnvironmentVerifyEditorRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "environment.verifyEditor";
  readonly params: {
    readonly path: string;
  };
}

// ---- overlay.getSnapshot(017 表面批 1 消费接线:桌面 Gateway 词表行随冻结
// 应用契约面登记;params 闭集为空,查询语义 verbatim 透传 Kernel) ----

export interface GatewayOverlaySnapshotRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "overlay.getSnapshot";
  readonly params: Record<string, never>;
}

export interface GatewayDemoTaskRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "task.startDemo";
  readonly params: {
    readonly commandId: string;
  };
}

// ---- production.*(amf-production v0.2 登记面:渲染层面不变的部分保持原样;
// requestPlan 增 mode、confirmPlan 增 riskChoice/rememberForSession、recover
// 瘦身为语义选择——路径与项目身份由 Kernel 经 startInspection 一次性转交,
// decisionId 由 Kernel 受理时生成,渲染层均不可见) ----

export interface ProductionStartInspectionRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "production.startInspection";
  readonly params: {
    readonly materialRefId: string;
    readonly commandId: string;
  };
}

export interface ProductionGetInspectionRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "production.getInspection";
  readonly params: { readonly inspectionId: string };
}

export interface ProductionRequestPlanRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "production.requestPlan";
  readonly params: {
    readonly inspectionId: string;
    readonly commandId: string;
    /** 双素材入口的真实用户决策(渲染层从已选素材的 intake 透传) */
    readonly mode: ProductionModeV02;
  };
}

export interface ProductionGetPlanRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "production.getPlan";
  readonly params: { readonly planId: string };
}

export interface ProductionConfirmPlanRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "production.confirmPlan";
  readonly params: {
    readonly planId: string;
    readonly commandId: string;
    readonly observedRevision: number;
    /** 风险决策(v0.2 必填:计划审阅的风险决策控件) */
    readonly riskChoice: ProductionRiskChoiceV02;
    readonly rememberForSession?: boolean;
  };
}

export interface ProductionRecoverRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "production.recover";
  readonly params: {
    /** 原始失败任务(恢复绑定对象) */
    readonly taskId: string;
    /** 只携带语义选择;decisionId 由 Kernel 受理时生成并绑定 */
    readonly decision: "continue" | "rollback";
    readonly commandId: string;
  };
}

export interface ProductionGetBuildRecordRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "production.getBuildRecord";
  readonly params: { readonly buildRecordId: string };
}

// ---- catalog.* / warehouse.*(bdl-queries v0.2 冻结面:AMF 从本地 BDL 出的
// 五个只读查询;查询闭集与字段面见 docs/protocols/bdl-queries-v0.2,
// 守卫与操作词表一一对应,协议变更须升版) ----

export interface CatalogListRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "catalog.list";
  readonly params: {
    readonly text?: string | null;
    readonly availabilityStatus?: CatalogAvailabilityStatusV03 | null;
    readonly limit?: number;
    readonly offset?: number;
  };
}

export interface CatalogDetailRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "catalog.detail";
  readonly params: { readonly productId: string };
}

export interface CatalogStatusRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "catalog.status";
  readonly params: Record<string, never>;
}

export interface WarehouseListEntriesRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.listEntries";
  readonly params: Record<string, never>;
}

export interface WarehouseEntryDetailRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.entryDetail";
  readonly params: { readonly warehouseItemId: string };
}

/** 渲染层"重试"入口(任务级动作):AMF 以冻结重试策略裁决 */
export interface DownloadRetryRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "download.retry";
  readonly params: { readonly taskId: string; readonly commandId: string };
}

// ---- dependencies.lookup / dependencies.listByProduct(bdl-queries v0.5
// additive 两成员,030 §5.7 案 A,数据席第 168 批 FROZEN;桌面 TS 登记面
// 2026-09-22。只读查询,词面骑 BDL v0.2 冻结闭集;守卫与冻结 Schema
// additionalProperties:false 同形,词表外键(含 fuzzy 等价开关)拒绝 = 契约
// 错误,绝不静默空答。核心接线批升信封常量与路由臂前,实现域未接线 =
// provider 答类型化 unknown_method 诚实缺席,本路由原样透传不折叠) ----

/** dependencies.lookup 依赖名义反查(建议面):匹配规则 v1 = dep_name 大小写
 *  不敏感精确(ASCII 折叠),零子串/模糊/等价;包名形态输入不逐字出现 =
 *  诚实空集(total:0 = 无匹配名义,绝不渲染成「不存在该依赖」) */
export interface DependenciesLookupRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "dependencies.lookup";
  readonly params: {
    /** 依赖名义原文(必填非空;输入绝不归一化入存储) */
    readonly name: string;
    /** 可选过滤骑 BDL v0.2 dep_kind 四值闭集;null/缺席 = 不过滤 */
    readonly depKind?: "shader" | "tool_package" | "avatar_base" | "other" | null;
    /** 1–200,默认 50 */
    readonly limit?: number;
    /** ≥ 0,默认 0 */
    readonly offset?: number;
  };
}

/** dependencies.listByProduct 单商品依赖观察全列(未过滤线索面):params
 *  单键闭集 {productId}(catalog.detail 同 pattern,booth: 身份);无
 *  name/过滤键——客户端给过滤 = 契约错误(负例向量钉死)。tombstone 商品
 *  不拒答,以 productStatus:'missing' 如实出线;未知 productId = 应用面
 *  not-found,绝不伪造空答 */
export interface DependenciesListByProductRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "dependencies.listByProduct";
  readonly params: { readonly productId: string };
}

/** 产物模式三命令入口(bdl-commands v0.1,proposal 005):任务级动作经 AMF */
export interface WarehouseSetArtifactModeRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.setArtifactMode";
  readonly params: {
    readonly warehouseItemId: string;
    /** null = 清除条目级覆盖,回落「覆盖 ?? 全局默认」动态解析 */
    readonly mode: WarehouseArtifactModeV03 | null;
    readonly commandId: string;
  };
}

export interface WarehouseGenerateVpmRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.generateVpm";
  readonly params: { readonly warehouseItemId: string; readonly commandId: string };
}

export interface WarehouseDeleteOriginalsRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.deleteOriginals";
  readonly params: { readonly warehouseItemId: string; readonly commandId: string };
}
/** 全局默认产物模式写入口(bdl-commands v0.2 全局层,W14/W15) */
export interface WarehouseSetGlobalDefaultModeRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.setGlobalDefaultMode";
  readonly params: { readonly mode: WarehouseArtifactModeV03; readonly commandId: string };
}
// ---- production-use-case v0.2 (W20 ten-method freeze, W24 workbench; document
// bodies carried as Record<string, unknown>, contract face does not duplicate
// document schemas) ----
export interface RecipeSaveRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "recipe.save";
  readonly params: { readonly recipeDocument: Record<string, unknown>; readonly baseRevision: number };
}

export interface RecipeGetRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "recipe.get";
  readonly params: { readonly recipeId: string };
}

export interface RecipeListRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "recipe.list";
  readonly params: ProductionListParamsV1;
}

export interface RecipeResolveRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "recipe.resolve";
  readonly params: { readonly recipeId: string; readonly revision?: number };
}

/** 029 B 面 recipe-export v0.1(桌面环 4 消费批):已注册工程的配方草稿导出
 *  ——同步只读 Query,params 单键闭集 {projectPath}(013 注册身份;入口限定
 *  VUA 已注册工程集,不开放任意路径输入);未注册 = Provider 复用
 *  vua.project.project_not_found(024 判例) */
export interface RecipeExportProjectDraftRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "recipe.exportProjectDraft";
  readonly params: { readonly projectPath: string };
}

export interface PlanApproveRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "plan.approve";
  readonly params: { readonly planId: string };
}

export interface PlanGetRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "plan.get";
  readonly params: { readonly planId: string };
}

export interface PlanListRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "plan.list";
  readonly params: ProductionListParamsV1 & { readonly recipeId?: string };
}

export interface JobExecuteRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "job.execute";
  readonly params: { readonly planId: string };
}

export interface RecordGetRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "record.get";
  readonly params: { readonly buildId: string };
}

export interface RecordListRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "record.list";
  readonly params: ProductionListParamsV1 & { readonly recipeId?: string };
}
/** project.import-copy 副本导入入口(014 语义冻结;F6 确认链;plan/apply 两段) */
export interface ProjectImportCopyRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "project.import-copy";
  readonly params: {
    readonly phase: ImportCopyPhaseV01;
    readonly sourcePath: string;
    readonly targetParentDirectory: string;
    readonly targetProjectName: string;
    readonly confirmedPlanDigest?: string;
  };
}
/** project.setNote 备注写入口(project-ops v0.2,D-6 桌面接线;任务化受理:
 *  wire 回执携带 taskId,结果文档随应用契约任务面) */
export interface ProjectSetNoteRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "project.setNote";
  readonly params: {
    readonly projectPath: string;
    /** null 清除;非空单行纯文本(冻结 Schema:1..2000 字符,无换行) */
    readonly note: string | null;
  };
}
/** warehouse.import 批量导入入口(bdl-commands v0.3,W19) */
/** production-use-case v0.2 read-face pagination/filter closed set (011 section 7) */
export interface ProductionListParamsV1 {
  readonly text?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly recipeId?: string;
}
export interface WarehouseImportRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.import";
  readonly params: { readonly sourceFolders: readonly string[]; readonly commandId: string };
}

/** warehouse.importDownloads 下载采纳入口(bdl-commands v0.4,IMP-3):仅身份 */
export interface WarehouseImportDownloadsRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "warehouse.importDownloads";
  readonly params: { readonly downloadIds: readonly string[]; readonly commandId: string };
}

/** downloads.listCompleted 可采纳下载列表查询(bdl-queries v0.4,IMP-2 批 B) */
export interface DownloadsListCompletedRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "downloads.listCompleted";
  readonly params: Readonly<Record<string, never>>;
}

/** project.environmentManagers 查询入口(013 读面第一翼,核心 e720544);
 *  快照本体以 envelope 强度透传(UI 按需窄化) */
export interface ProjectEnvironmentManagersRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "project.environmentManagers";
  readonly params: Readonly<Record<string, never>>;
}

export interface ProjectListProjectsRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "project.listProjects";
  readonly params: Readonly<Record<string, never>>;
}

export interface ProjectInspectProjectRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "project.inspectProject";
  readonly params: { readonly projectPath: string };
}

export interface ProjectLockStatusRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "project.lockStatus";
  readonly params: { readonly projectPath: string };
}

// ---- inspection.get / inspection.list(inspection-queries v0.1,M7 检查切片,
// 016 仲裁独立词表行;数据草案面＋核心实现批已入 main。读面消费:检查页
// 证据链。requestRun 任务化写命令不入桌面词表——avatarGlobalObjectId 无
// 桌面事实源(Unity 场景内对象身份),登记而不消费即悬空面,候对象选择面
// 事实源提案后随真实消费批办理) ----

/** inspection.get 身份寻址查询:返回证据束文档本体原样(细节在文档内,
 * 引用不复制,012 evidenceIds 纪律) */
export interface InspectionGetRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "inspection.get";
  readonly params: { readonly inspectionId: string };
}

/** inspection.list 身份摘要行列表(performedAt 降序最新在前;可选闭集过滤:
 * avatarRef 精确匹配/overallStatus 聚合闭集 pass|warn|fail[unavailable 是
 * 维状态非聚合输出]/limit 1..200/offset≥0;摘要行绝不内联 dimensions/checks) */
export interface InspectionListRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "inspection.list";
  readonly params: {
    readonly avatarRef?: string;
    readonly overallStatus?: "pass" | "warn" | "fail";
    readonly limit?: number;
    readonly offset?: number;
  };
}

// ---- release.openForHandoff(release-handoff v0.1,023 词表行,核心冻结批
// 2026-09-16 经第 53 波入库;M7 消费切片桌面登记。tasked 交接命令:受理回执
// 按 taskId 轮询任务面;实现域未接线=路由恒答 vua.release_handoff.unavailable
// 诚实缺席。params 闭集单键 {buildId},词表外键拒绝〔核心裁决④〕) ----

/** release.openForHandoff 交接命令:按已验证编辑器身份请求打开/聚焦目标
 * Unity 编辑器至目标工程;受理回执照 inspection.requestRun 形状
 * (ReleaseHandoffAcceptedV02)。缺席语义由 wire 测试钉死:缺席绝不携带
 * 受理形状 */
export interface ReleaseOpenForHandoffRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "release.openForHandoff";
  readonly params: { readonly buildId: string };
}

// ---- release.openForInspection(release-handoff v0.2,U19 独立检视入口,
// 核心 U19 批 36bab970 经合并 09a4423f 入库;桌面 TS 面登记对齐。tasked
// 检视命令:同准入减状态闸——不按记录状态闸,打开工程排错不得被禁,打开
// 编辑器既不是恢复执行也不是上传许可;受理回执照 tasked 形状
// (ReleaseInspectionAcceptedV02);完成事实=六键闭集携显式 operation 词面
// (ReleaseInspectionFactV02),永不误读为交接完成。实现域未接线=路由恒答
// vua.release_handoff.unavailable 诚实缺席。params 闭集单键 {buildId},
// 词表外键拒绝) ----

/** release.openForInspection 检视命令:按已验证编辑器身份请求打开/聚焦
 * 目标 Unity 编辑器至目标工程供人工检查/修复(与交棒显式分离;路由绝不
 * 答两状态码——检视路由错误闭集四码,见 RELEASE_INSPECTION_ERROR_CODES_V02) */
export interface ReleaseOpenForInspectionRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "release.openForInspection";
  readonly params: { readonly buildId: string };
}

// ---- packages.listInstalled(packages-query v0.1,024 P1 冻结批 2026-09-17
// 经第 72 波入库;P1 中间诚实态消费批桌面登记。只读单方法:已注册项目的
// 已装包集合;projectPath 复用 013 注册身份,未注册 = 复用
// vua.project.project_not_found(同事实同码);实现域未接线 = 路由答
// vua.packages.unavailable 诚实缺席。params 闭集单键 {projectPath}
// minLength 1(词表外键拒绝,与 schema additionalProperties:false 同形)) ----

/** packages.listInstalled 只读查询:单个已注册项目的已装包清单;成功值
 * 为 wire 帧 { schemaVersion:"0.1", operation, result } 包裹(result 本体
 * 见 schemas/packages-query/v0.1/result.schema.json),桌面守卫按三键
 * 组合窄化,零字段猜测 */
export interface PackagesListInstalledRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.listInstalled";
  readonly params: { readonly projectPath: string };
}

// ---- 025 P2 读面(packages-repos＋packages-catalog v0.1,核心冻结批
// 9ab1b11 经 987b3cc 入库;wire 接线切片 4631a0f 经 4bad84e 入库;桌面
// P2 消费批登记。只读两方法:仓库订阅清单(订阅面为世界,params 空闭集
// ——全局配置面,任何键或缺席 = vua.packages.invalid_params 形状违反)
// 与单包目录事实(按需查询,双键闭集 {projectPath, packageId};同一 013
// 聚合注册校验,未注册 = 复用 vua.project.project_not_found;词表外无
// 此包 = 复用 vua.vpm.no_matching_package,消费端呈现独立空态非错误
// 页)。能力未声明 = vua.vpm.capability_missing;served_capabilities 两
// 行(packages.listRepos/packages.packageCatalog)为区块标注权威事实源 ----

/** packages.listRepos 只读查询:仓库订阅清单(订阅面为世界 = 用户配置
 * 事实);params 空闭集(全局配置面,非 per-project) */
export interface PackagesListReposRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.listRepos";
  readonly params: Record<string, never>;
}

/** packages.packageCatalog 只读查询:单包目录事实按需查询(选中工程上
 * 下文绑定;无全量目录投影、无分页语义) */
export interface PackagesPackageCatalogRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.packageCatalog";
  readonly params: { readonly projectPath: string; readonly packageId: string };
}

// ---- 027 F2 读面(packages-repo-catalog v0.1,核心冻结批 c46545f 经
// 第 122 批入库;wire 接线批 629699e 经第 123 批入库;桌面形状核可
// 2026-09-20 05:1x 落节,桌面 F2 消费批登记。只读单方法:仓库级可装包
// 清单逐仓分组,双键必带可空 params {repoId, packageIds}(026 A5 同款
// REQUIRED-nullable idiom):repoId null = 全部仓库逐仓分组、非空串 =
// 只答该仓库行(词表外 id = 复用 vua.vpm.repo_not_found,端口拒绝逐字
// 透传——P2 读面零折叠);packageIds null = 不过滤浏览、非空 = Recipe
// 需求集合批量过滤(唯一非空 id 闭列;空数组 = 形状违反非空过滤,不立
// 第三态)。刻意无 projectPath(缓存维度非工程维度)。served 行
// packages.repoCatalogOps(default declared-none 访问器门控,环境覆写
// 置真前如实 unavailable)为区块标注权威事实源 ----

/** packages.repoCatalog 只读查询:仓库级可装包清单(逐仓分组缓存投影,
 *  绝不跨仓合并;用户裁决④ Recipe 自动化为第一消费者,浏览 UI 是同一
 *  查询的次要呈现) */
export interface PackagesRepoCatalogRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.repoCatalog";
  readonly params: {
    /** null = 全部仓库逐仓分组;非空 = 只答该仓库行 */
    readonly repoId: string | null;
    /** null = 不过滤浏览;非空 = 批量需求集合过滤(唯一非空 id;
     *  空数组 = 形状违反,UI 不构造) */
    readonly packageIds: readonly string[] | null;
  };
}

// ---- 027 F5 读面(packages-templates v0.1,核心冻结批 640b365 经第 132
// 批入库;wire 接线批 8677607 经第 136 批入库;桌面形状核可 d41f3a7 经第
// 137 批入库,桌面 F5 消费批登记 2026-09-20。只读单方法:模板条目枚举
// 纯读面,params 空闭集 = 环境级配置面非 per-project(listRepos 空闭集
// 先例);零网络无 cacheSourced,空数组 = 诚实零模板应答(目录根缺失是
// 事实非错误)。id = 模板目录名(packages.createProject template 参数
// 机器标识),name = id 冻结同值显示投影(消费端逐字显示绝不虚构更友好
// 标签)。served 行 packages.templatesOps(default declared-none 访问器
// 门控,环境覆写置真前如实 unavailable)为区块标注权威事实源 ----

/** packages.listTemplates 只读查询:模板条目枚举(环境级配置面,
 *  空闭集 params——任何键 = 词表外形状违反) */
export interface PackagesListTemplatesRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.listTemplates";
  readonly params: Record<string, never>;
}

// ---- 027 F4 写面(packages-ops v0.6,核心冻结批 47d4185 经第 139 批
// 入库;wire 接线批 7361213 经第 141 批入库;桌面形状核可随消费批登记
// 2026-09-21。仓库生命周期:启停二方法＋刷新一方法,照 A3/A4 同律无
// preview 对偶——启停 diff 无既有摘要、刷新即网络本体,携 confirmedDigest
// 或 projectPath = 形状违反;params 单键闭集 {repoId} = A4 removeRepo 同
// 稳定行柄;id 缺席(repoId null)行在本词面可达范围之外,UI 不构造入口)。
// 三方法任务化 command(Kernel 生成 commandId),收据随任务终态 Done
// payload 回流:enabled/disabled 恰三键回显(端口答 Result<(),_>,回显即
// 审计链,新状态经 packages-repos v0.2 订阅面读回,收据绝不重复状态);
// refreshed 四键必带 cacheUpdated(库面 update_cache 两臂皆成功——false =
// etag 未变「已是最新」,结果非错误);rejected guard+code+detail 三键,code
// 族锁 vua.packages.*,原端口码(vua.vpm.repo_not_found/repo_write_failed/
// repo_fetch_failed,A4 批既有零新立)在 detail 原词溯源。词面权威 =
// schemas/packages-ops/v0.6 + application-contract.ts F4 段 ----

/** packages.enableRepo 写命令:任务化订阅行启用(VUA 自有语义,W25 只读
 *  证据裁决 (c)——VCC 无任何启停状态,启停位投影 VUA 自有存储绝不写共享
 *  settings.json) */
export interface PackagesEnableRepoRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.enableRepo";
  readonly params: { readonly repoId: string };
}

/** packages.disableRepo 写命令:任务化订阅行禁用(禁用行离开包集合世界
 *  但保留在订阅面在列——呈现层禁用在列不隐藏) */
export interface PackagesDisableRepoRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.disableRepo";
  readonly params: { readonly repoId: string };
}

/** packages.refreshRepo 写命令:任务化订阅行缓存刷新(该行自身 localPath
 *  缓存 etag 条件抓取;cacheUpdated=false =「已是最新」诚实两臂结果) */
export interface PackagesRefreshRepoRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.refreshRepo";
  readonly params: { readonly repoId: string };
}

// ---- packages-ops v0.1 写面 A1 移除(026 冻结批 d7f6a57 经第 99 批入库;
// wire 接线批 41503a4 候验收;桌面 A1 消费批登记 2026-09-19。previewRemove
// = 同步只读变更预览 query(双键闭集,packageIds 显式非空闭列 minItems 1 +
// uniqueItems,无通配无「移除全部」速记;preview 参数无 digest 位——digest
// 是 preview 的产物,携即形状违反);applyRemove = 九态任务化移除写命令
// (三键闭集必携 confirmedDigest = previewRemove 结果 digest,服务端复算
// 漂移即拒 preview_drift recoverable 冲突——ORC-WF-003/004 双摘要纪律,
// 权威判定在服务端)。成功值为 wire 帧 { schemaVersion:"0.1", operation,
// result } 包裹:previewRemove 恒答 kind=plan;applyRemove 受理回执
// { taskId, correlationId }(import-copy 同构),审计收据 receipt / 类型化
// 拒绝 rejected 随任务终态 Done payload 回流。词面权威 =
// schemas/packages-ops/v0.1 + application-contract.ts A1 段 ----

/** packages.previewRemove 只读查询:移除将造成的全部变更预览(含传递
 *  依赖移除 ORC-WF-002)与摘要指纹;永不变更任何状态,失败走 wire 信封
 *  错误(非 result 臂) */
export interface PackagesPreviewRemoveRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.previewRemove";
  readonly params: { readonly projectPath: string; readonly packageIds: readonly string[] };
}

/** packages.applyRemove 写命令:任务化受理(import-copy 同构);commandId
 *  由 Kernel 生成(照 project.import-copy 先例,渲染层不传),幂等/可取消
 *  /事件＋revision 语义归应用契约任务面 */
export interface PackagesApplyRemoveRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.applyRemove";
  readonly params: {
    readonly projectPath: string;
    readonly packageIds: readonly string[];
    readonly confirmedDigest: string;
  };
}

// ---- packages-ops v0.2 写面 A2 安装/升级(026 冻结批 8552d2c 经第 101 批
// 入库;wire 接线批 61da51a 经第 102 批入库;钉法缺口收口 beb7d34 经第 104
// 批入库;桌面 A2 消费批登记 2026-09-19。previewInstall = 同步只读安装/
// 升级预览 query(双键闭集,packages 请求行闭列 {packageId, version string
// |null}——version 必填可空,null = 解析器选最新稳定版,string = 钉死精确
// 版本,升级/降级同语法不立 upgrade 动词;同 packageId 重复 = 词面违反,
// 版本不同亦然〔seenIds 行间 id 唯一,与 A2 守卫同形〕;preview 参数无
// digest 位);applyInstall = 九态任务化安装写命令(三键闭集必携
// confirmedDigest = previewInstall 结果 digest,服务端复算漂移即拒
// preview_drift recoverable 冲突——ORC-WF-003/004 双摘要纪律,权威判定在
// 服务端)。成功值为 wire 帧 { schemaVersion:"0.2", operation, result }
// 包裹:previewInstall 恒答 kind=plan(schemaVersion 族常量
// vua.packages-ops/v0.2,与 v0.1 plan 同键集,消费窄化按字面量);applyInstall
// 受理回执 { taskId, correlationId }(import-copy 同构),审计收据 receipt
// (installReceipt 变体:requestedPackages 携版本选择语义 + appliedItems) /
// 类型化拒绝 rejected 随任务终态 Done payload 回流。词面权威 =
// schemas/packages-ops/v0.2 + application-contract.ts A2 段 ----

/** packages.previewInstall 只读查询:安装/升级将造成的全部变更预览(依赖
 *  解析可达仓库,在线刷新失败降级缓存〔ORC-ADP-006 同构〕;plan 可含
 *  remove 行——冲突触发的移除是端口事实 ORC-WF-002);永不变更任何状态,
 *  失败走 wire 信封错误(vua.packages.preview_failed,非 result 臂) */
export interface PackagesPreviewInstallRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.previewInstall";
  readonly params: {
    readonly projectPath: string;
    readonly packages: readonly {
      readonly packageId: string;
      readonly version: string | null;
    }[];
  };
}

/** packages.applyInstall 写命令:任务化受理(import-copy 同构);commandId
 *  由 Kernel 生成(照 project.import-copy 先例,渲染层不传),幂等/可取消
 *  /事件＋revision 语义归应用契约任务面 */
export interface PackagesApplyInstallRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.applyInstall";
  readonly params: {
    readonly projectPath: string;
    readonly packages: readonly {
      readonly packageId: string;
      readonly version: string | null;
    }[];
    readonly confirmedDigest: string;
  };
}

// ---- packages-ops v0.3 写面 A3 本地包注册(026 冻结批 0282a66 经第 105 批
// 入库;wire 接线批 45ec57c 经第 107 批入库;桌面 A3 消费批登记 2026-09-19。
// 族中唯一无 preview 对偶的写面——端口无 preview 方法,不发明:注册是幂
// 等集合添加(库面 AlreadyAdded 答成功,不区分首次/重复),非破坏性(只加
// 一行用户包条目),无既有状态可漂移——无 confirmedDigest 位(携即形状违
// 反,用户显式提交即确认);params 单键闭集 {packageRoot} = 本地包根目录
// (含 package.json),无 projectPath——注册只动后端隔离环境,不触项目、
// 不触用户 VCC/ALCOM 设置。任务化写命令:受理回执 { taskId, correlationId }
// (import-copy/A1/A2 同构),审计收据 registered(最小诚实三键回显) /
// 类型化拒绝 rejected 随任务终态 Done payload 回流。词面权威 =
// schemas/packages-ops/v0.3 + application-contract.ts A3 段 ----

/** packages.registerLocalPackage 写命令:任务化受理(import-copy 同构);
 *  commandId 由 Kernel 生成(渲染层不传,project.import-copy 先例);无
 *  digest 无确认链——用户显式提交即确认 */
export interface PackagesRegisterLocalPackageRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.registerLocalPackage";
  readonly params: {
    readonly packageRoot: string;
  };
}

// ---- packages-ops v0.4 写面 A4 仓库订阅增删(026 冻结批 28c63fa 经第 108 批
// 入库;wire 接线批 3d4b667 经第 109 批入库;桌面 A4 消费批登记 2026-09-19。
// 三命令闭集 addRemoteRepo/addLocalRepo/removeRepo 一一映射端口方法
// add_remote_repo/add_local_repo/remove_repo。照 A3 同律破 preview/apply
// 对偶——本面无 preview 臂:远端订阅天然含清单拉取网络段(preview 只会是
// 伪装成更安全首跳的第二跳网络往返),且无既有状态摘要可绑定(订阅列表
// 可漂移,诚实失败 = 执行时端口答 repo_not_found)——无 confirmedDigest
// 位(携即形状违反,用户显式提交即确认);三方法均无 projectPath(订阅面
// 只写后端隔离环境,013 project_not_found 复用对本面不适用);首期词面不
// 收 HTTP 头/凭据传输。任务化写命令:受理回执 { taskId, correlationId }
// (import-copy/A1/A2/A3 同构),审计收据 repoReceipt(remote/local 双互斥
// 变体,五键最小诚实回显)/removed(三键 repoId 回显——回显即审计链,不
// 发明被删行快照)/类型化拒绝 rejected 随任务终态 Done payload 回流。
// served 行 packages.repoOps 一行服务三方法(repo_write_capabilities 三独
// 立位门控,任一位声明即 available;wire 门按方法绝不按面)。词面权威 =
// schemas/packages-ops/v0.4 + application-contract.ts A4 段 ----

/** packages.addRemoteRepo 写命令:任务化受理(import-copy 同构);
 *  commandId 由 Kernel 生成(渲染层不传,project.import-copy 先例);
 *  params 双键闭集 {url, name} 非空 = 仓库 URL＋必填显示名;无
 *  projectPath、无 digest 位、无 HTTP 头/凭据传输 */
export interface PackagesAddRemoteRepoRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.addRemoteRepo";
  readonly params: {
    readonly url: string;
    readonly name: string;
  };
}

/** packages.addLocalRepo 写命令:任务化受理;params 双键闭集
 *  {path, name} 非空 = 本地目录仓库路径＋必填显示名(无网络段) */
export interface PackagesAddLocalRepoRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.addLocalRepo";
  readonly params: {
    readonly path: string;
    readonly name: string;
  };
}

/** packages.removeRepo 写命令:任务化受理;params 单键闭集
 *  {repoId} 非空 = 仓库 id(稳定行柄,索引寻址不冻结);id 缺席行在本
 *  词面移除可达范围之外(协议本载明的诚实边界) */
export interface PackagesRemoveRepoRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.removeRepo";
  readonly params: {
    readonly repoId: string;
  };
}

// ---- packages-ops v0.5 写面 A5 项目创建(026 冻结批 0c77273 经第 112 批
// 入库;wire 接线批 8abb638 经第 113 批入库;桌面 A5 消费批登记 2026-09-19。
// 单命令 packages.createProject 一一映射端口方法 create_project(parent,
// name, template)。照 A3/A4 同律破 preview/apply 对偶且根在端口:端口恰
// 一个创建方法、无 create-preview 对应(预览臂会在 wire 面立端口后不存在
// 的方法);全新项目目录无既有状态可 diff,无摘要可绑定——无
// confirmedDigest 位(携即形状违反,用户显式表单提交即确认;创建新目录
// 不触任何在册项目、包文件、他项目内容,ADR-0006 破坏性警示路径无可警
// 示)。不收 projectPath(创建不寻址任何在册项目,013 project_not_found
// 复用不适用)。任务化写命令:受理回执 { taskId, correlationId }(
// import-copy/A1–A4 同构),created 收据 = 端口 ProjectRef {id, root} 投
// 影四键闭集(packages-ops 族唯一有实际载荷的收据;projectId 信息性标识
// 非 013 身份键,projectPath = 注册路径身份——创建即在册冻结端口事实:
// 双后端成功路径尾调 FileSystemProjectStore::initialize,创建成功即在
// 册、在册列表刷新即见,词面不虚构「仅建目录不登记」形状),类型化拒绝
// rejected(guard 三值闭集复用 A1–A4 零新增;原端口码
// vua.vpm.template_missing/apply_failed/backend_unavailable 在 detail
// 原词溯源,不入 code 键;创建不幂等——重复目录执行时拒绝如实上呈)随
// 任务终态 Done payload 回流。served 行 packages.createOps 一行服务本方
// 法(行可用性 = 既有 VpmCapabilities.create_project 五联位——A5 零新
// accessor,位先于批在库双后端已声明;wire 门 submit 前读位,假位答通用
// capability_missing 绝不进任务)。词面权威 = schemas/packages-ops/v0.5 +
// application-contract.ts A5 段 ----

/** packages.createProject 写命令:任务化受理(import-copy/A1–A4 同构);
 *  commandId 由 Kernel 生成(渲染层不传);params 三键闭集 {parent,
 *  name, template}——parent/name 非空串 verbatim 透传(parent = 新项目
 *  目录的父目录,路径事实非在册项目身份;name 后端名称校验为执行时权
 *  威,表单前置校验仅作 UI 引导不重审上游语法),template REQUIRED-
 *  nullable(null = 后端默认模板解析〔库路径默认 Avatar 三级解析序,冻
 *  结词面事实非选择器,首面零新读面 templates.* 不立〕;非空串 = 该模板
 *  名/路径 verbatim 透传;空串 = 形状违反);无 projectPath、无 digest
 *  位 */
export interface PackagesCreateProjectRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "packages.createProject";
  readonly params: {
    readonly parent: string;
    readonly name: string;
    readonly template: string | null;
  };
}

export interface GatewayDeploymentPlanRequest { readonly schemaVersion: 1; readonly requestId: string; readonly method: "environment.planDeployment"; readonly params: DeploymentPlanParams }
export interface GatewayDeploymentExecuteRequest { readonly schemaVersion: 1; readonly requestId: string; readonly method: "environment.executeDeployment"; readonly params: DeploymentExecuteParams & { readonly commandId: string } }

export type DesktopGatewayRequestV1 =
  | GatewayDeploymentPlanRequest
  | GatewayDeploymentExecuteRequest
  | AppSnapshotRequestV1
  | GatewayTaskListRequestV1
  | GatewayTaskGetRequestV1
  | GatewayTaskCancellationRequestV1
  | GatewayEnvironmentSnapshotRequestV1
  | GatewayEnvironmentVerifyEditorRequestV1
  | GatewayOverlaySnapshotRequestV1
  | GatewayDemoTaskRequestV1
  | ProductionStartInspectionRequestV1
  | ProductionGetInspectionRequestV1
  | ProductionRequestPlanRequestV1
  | ProductionGetPlanRequestV1
  | ProductionConfirmPlanRequestV1
  | ProductionRecoverRequestV1
  | ProductionGetBuildRecordRequestV1
  | CatalogListRequestV1
  | CatalogDetailRequestV1
  | CatalogStatusRequestV1
  | WarehouseListEntriesRequestV1
  | WarehouseEntryDetailRequestV1
  | DownloadRetryRequestV1
  | DependenciesLookupRequestV1
  | DependenciesListByProductRequestV1
  | WarehouseSetArtifactModeRequestV1
  | WarehouseGenerateVpmRequestV1
  | WarehouseDeleteOriginalsRequestV1
  | WarehouseSetGlobalDefaultModeRequestV1
  | WarehouseImportRequestV1
  | WarehouseImportDownloadsRequestV1
  | DownloadsListCompletedRequestV1
  | ProjectEnvironmentManagersRequestV1
  | ProjectListProjectsRequestV1
  | ProjectInspectProjectRequestV1
  | ProjectLockStatusRequestV1
  | RecipeSaveRequestV1
  | RecipeGetRequestV1
  | RecipeListRequestV1
  | RecipeResolveRequestV1
  | RecipeExportProjectDraftRequestV1
  | PlanApproveRequestV1
  | PlanGetRequestV1
  | PlanListRequestV1
  | JobExecuteRequestV1
  | RecordGetRequestV1
  | RecordListRequestV1
  | ProjectImportCopyRequestV1
  | ProjectSetNoteRequestV1
  | InspectionGetRequestV1
  | InspectionListRequestV1
  | ReleaseOpenForHandoffRequestV1
  | ReleaseOpenForInspectionRequestV1
  | PackagesListInstalledRequestV1
  | PackagesListReposRequestV1
  | PackagesPackageCatalogRequestV1
  | PackagesRepoCatalogRequestV1
  | PackagesListTemplatesRequestV1
  | PackagesPreviewRemoveRequestV1
  | PackagesApplyRemoveRequestV1
  | PackagesPreviewInstallRequestV1
  | PackagesApplyInstallRequestV1
  | PackagesRegisterLocalPackageRequestV1
  | PackagesAddRemoteRepoRequestV1
  | PackagesAddLocalRepoRequestV1
  | PackagesRemoveRepoRequestV1
  | PackagesCreateProjectRequestV1
  | PackagesEnableRepoRequestV1
  | PackagesDisableRepoRequestV1
  | PackagesRefreshRepoRequestV1;

/** 方法 → 应用语义:Kernel 路由用;未知方法返回 undefined */
export const DESKTOP_GATEWAY_METHOD_KINDS = {
  "app.snapshot": "query",
  "task.list": "query",
  "task.get": "query",
  "task.requestCancellation": "command",
  "environment.getSnapshot": "query",
  "environment.planDeployment": "query",
  "environment.executeDeployment": "command",
  "environment.verifyEditor": "query",
  "overlay.getSnapshot": "query",
  "task.startDemo": "command",
  "production.startInspection": "command",
  "production.getInspection": "query",
  "production.requestPlan": "command",
  "production.getPlan": "query",
  "production.confirmPlan": "command",
  "production.recover": "command",
  "production.getBuildRecord": "query",
  "catalog.list": "query",
  "catalog.detail": "query",
  "catalog.status": "query",
  "warehouse.listEntries": "query",
  "warehouse.entryDetail": "query",
  "downloads.listCompleted": "query",
  // bdl-queries v0.5(桌面 TS 登记面 2026-09-22):两方法只读同族
  "dependencies.lookup": "query",
  "dependencies.listByProduct": "query",
  "project.environmentManagers": "query",
  "project.listProjects": "query",
  "project.inspectProject": "query",
  "project.lockStatus": "query",
  "download.retry": "command",
  "warehouse.setArtifactMode": "command",
  "warehouse.generateVpm": "command",
  "warehouse.deleteOriginals": "command",
  "warehouse.setGlobalDefaultMode": "command",
  "warehouse.import": "command",
  "warehouse.importDownloads": "command",
  "recipe.save": "command",
  "recipe.resolve": "command",
  // 029 B 面(桌面环 4 消费批):recipe-export v0.1 单方法同步只读 Query
  "recipe.exportProjectDraft": "query",
  "plan.approve": "command",
  "job.execute": "command",
  "recipe.get": "query",
  "recipe.list": "query",
  "plan.get": "query",
  "plan.list": "query",
  "record.get": "query",
  "record.list": "query",
  "project.import-copy": "command",
  "project.setNote": "command",
  "inspection.get": "query",
  "inspection.list": "query",
  "release.openForHandoff": "command",
  // release-handoff v0.2(U19 桌面对齐批):独立检视入口同族命令
  "release.openForInspection": "command",
  "packages.listInstalled": "query",
  // 025 P2 读面(桌面 P2 消费批):两方法只读同族
  "packages.listRepos": "query",
  "packages.packageCatalog": "query",
  // 027 F2 读面(桌面 F2 消费批):仓库级可装包清单只读同族
  "packages.repoCatalog": "query",
  // 027 F5 读面(桌面 F5 消费批):模板条目枚举只读同族
  "packages.listTemplates": "query",
  // packages-ops v0.1 写面 A1 移除(026;桌面 A1 消费批):preview 同步
  // query,apply 任务化 command(Kernel 生成 commandId)
  "packages.previewRemove": "query",
  "packages.applyRemove": "command",
  // packages-ops v0.2 写面 A2 安装/升级(026;桌面 A2 消费批):preview 同步
  // query,apply 任务化 command(Kernel 生成 commandId)
  "packages.previewInstall": "query",
  "packages.applyInstall": "command",
  // packages-ops v0.3 写面 A3 本地包注册(026;桌面 A3 消费批):族中唯一
  // 无 preview 对偶——单方法任务化 command(Kernel 生成 commandId)
  "packages.registerLocalPackage": "command",
  // packages-ops v0.4 写面 A4 仓库订阅增删(026;桌面 A4 消费批):照 A3
  // 同律无 preview 对偶——三方法任务化 command(Kernel 生成 commandId)
  "packages.addRemoteRepo": "command",
  "packages.addLocalRepo": "command",
  "packages.removeRepo": "command",
  // packages-ops v0.5 写面 A5 项目创建(026;桌面 A5 消费批):照 A3/A4
  // 同律无 preview 对偶且根在端口——单方法任务化 command(Kernel 生成
  // commandId)
  "packages.createProject": "command",
  // packages-ops v0.6 写面 F4 仓库生命周期(027;桌面 F4 消费批):照 A3/
  // A4/A5 同律无 preview 对偶——三方法任务化 command(Kernel 生成
  // commandId;params 单键闭集 {repoId})
  "packages.enableRepo": "command",
  "packages.disableRepo": "command",
  "packages.refreshRepo": "command",
} as const satisfies Readonly<Record<string, "query" | "command">>;

export type DesktopGatewayMethodV1 = keyof typeof DESKTOP_GATEWAY_METHOD_KINDS;

/**
 * 各方法的成功返回值:应用契约值原样透传,外加 Kernel 派生的 app.snapshot。
 */
export type DesktopGatewaySuccessValueV1 = AppSnapshotV1 | ApplicationSuccessValueV01;

/**
 * Gateway 错误:Kernel 自身的三种失败用 code + messageKey;Provider 的应用
 * 错误原样透传(code = "application"),本地化与重试判定引用 AppErrorV01 原值。
 */
export type DesktopGatewayErrorV1 =
  | {
      readonly code: "invalid_request" | "unsupported_method" | "internal";
      readonly messageKey: string;
    }
  | {
      readonly code: "application";
      readonly application: AppErrorV01;
    };

export type DesktopGatewayResponseV1 =
  | {
      readonly schemaVersion: 1;
      readonly requestId: string;
      readonly ok: true;
      readonly value: DesktopGatewaySuccessValueV1;
    }
  | {
      readonly schemaVersion: 1;
      readonly requestId: string;
      readonly ok: false;
      readonly error: DesktopGatewayErrorV1;
    };

/** 事件订阅面:Provider 的类型化应用事件经 Kernel 广播到全部本地来源窗口 */
export interface DesktopGatewayEventsApiV1 {
  subscribe(listener: (event: ApplicationEventV01) => void): () => void;
}

export interface DesktopGatewayApiV1 {
  readonly version: 1;
  invoke(request: DesktopGatewayRequestV1): Promise<DesktopGatewayResponseV1>;
}

/**
 * Overlay 壳窗口动作回执(proposal 017 §4 表态 1:桌面 overlay = 同一 Electron
 * 进程内的独立 BrowserWindow,与主窗口共用同一 VuaDesktopApiV1 preload 面;
 * 动作只切换窗口显隐,不携带任何 wire 方法词表——overlay 读面随核心冻结批接入)。
 */
export interface OverlayWindowVisibilityV1 {
  /** 动作后 overlay 窗口的可见性(true=显示/创建并显示,false=隐藏) */
  readonly visible: boolean;
}

/** Overlay 窗口视图词面(2026-09-26 additive 裁决:覆盖层窗口成为引导宿主):
 *  guide = 引导内容(原游戏引导五主题 + VUA 使用教程),status = 任务/下载
 *  状态面(017 表面批形态,内容不变)。词表闭集二值。 */
export type OverlayViewV1 = "guide" | "status";

/**
 * showOverlay 动作回执(additive):动作后的可见性与当前视图。
 * 语义:窗口缺席 = 创建并显示请求视图(首视图经加载查询投递);
 * 隐藏 = 显示并切到请求视图;可见 = 仅切视图(绝不隐藏)。
 */
export interface OverlayWindowShowResultV1 {
  readonly visible: boolean;
  readonly view: OverlayViewV1;
}

export interface DesktopWindowApiV1 {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  /** Overlay 置顶窗开关(proposal 017 实现面备注,桌面域内切片):无窗口=
   * 创建并显示;隐藏=显示;可见=隐藏。回执携带切换后的可见性 */
  toggleOverlay(): Promise<OverlayWindowVisibilityV1>;
  /** 打开(或聚焦)覆盖层窗口并切到请求视图(2026-09-26 additive):
   *  无窗口 = 创建并显示该视图(缺省 guide;首视图经加载查询
   *  ?surface=overlay-desktop&view= 投递);隐藏 = 显示并切视图;
   *  可见 = 仅切视图(不隐藏)——已开窗的切换经 vua:overlay:set-view
   *  事件投递,渲染层经 overlayViewEvents 订阅 */
  showOverlay(view?: OverlayViewV1): Promise<OverlayWindowShowResultV1>;
  /** 覆盖层视图事件(Main → 本地渲染层;additive):已开窗时的视图切换
   *  通知(载荷即 OverlayViewV1 词面);只投递给覆盖层窗口本身 */
  overlayViewEvents: {
    subscribe(listener: (view: OverlayViewV1) => void): () => void;
  };
}

/**
 * 素材来源选取对话框(生产用例契约草案"双素材入口":文件选择经 Kernel 的
 * 显式对话框动作完成,Renderer 不持文件系统句柄)。Kernel 保存选取结果并
 * 只回发不透明 refId 与展示名;路径在 Kernel 侧解析后随应用请求交给 Provider。
 */
export type MaterialSourceIntakeV1 = "direct_unity_package" | "local_reusable_vpm";

export interface PickedMaterialSourceV1 {
  /** 不透明引用:Kernel 侧映射到真实路径;Renderer 只透传 */
  readonly refId: string;
  readonly displayName: string;
}

export interface DesktopDialogApiV1 {
  /** 用户取消或无宿主时返回 null */
  pickMaterialSource(intake: MaterialSourceIntakeV1): Promise<PickedMaterialSourceV1 | null>;
  /** 仓储导入文件夹多选(W18,bdl-commands v0.3 warehouse.import 的本地拾取面):
   *  openDirectory + multiSelections;用户取消或空选返回 null;本进程不做任何
   *  文件操作,路径交渲染层经 warehouse.import 提交 */
  pickWarehouseFolders(): Promise<readonly string[] | null>;
  /** U10 手选编辑器路径(021 收敛点 4:单一「浏览」入口 openFile +
   *  openDirectory 双态):pickEditorExecutable 选 exe 文件本身,
   *  pickEditorDirectory 选版本化根/Editor 目录;取消返回 null。路径原样
   *  交渲染层经 environment.verifyEditor 透传验证,本进程不做归一化 */
  pickEditorExecutable(): Promise<string | null>;
  pickEditorDirectory(): Promise<string | null>;
}

// ---- 远程内容窄面(F4 隔离浏览):Renderer 只发语义动作,不持任何 Electron
// 对象;远程页面本身无 preload、无 Node、无本地 Gateway(隔离红线见
// docs/architecture/desktop_ZH:Main 持有 Session/WebContentsView,Cookie 与
// 下载令牌永不进渲染层) ----

/** 远程内容视图状态(动作返回值;地址栏/前进后退 UI 的输入) */
export interface RemoteContentViewStateV1 {
  readonly viewId: string;
  readonly url: string;
  readonly visible: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** 远程内容事件(Main → 本地渲染层;违规透明上报,不静默吞掉) */
export type RemoteContentEventV1 =
  | { readonly kind: "view-opened"; readonly viewId: string; readonly url: string }
  | {
      readonly kind: "navigated";
      readonly viewId: string;
      readonly url: string;
      readonly canGoBack: boolean;
      readonly canGoForward: boolean;
    }
  | { readonly kind: "view-closed"; readonly viewId: string }
  | {
      readonly kind: "blocked";
      readonly viewId: string;
      readonly url: string;
      readonly reason:
        | "origin_not_allowed"
        | "download_denied"
        | "popup_denied"
        | "permission_denied";
    };

export interface RemoteContentApiV1 {
  /** 打开远程视图并加载 URL;来源不在允许清单时以错误拒绝 */
  open(request: { readonly url: string }): Promise<RemoteContentViewStateV1>;
  navigate(viewId: string, url: string): Promise<RemoteContentViewStateV1>;
  /** 视图内导航历史动作(内嵌固定导航条;未知视图以错误拒绝):后退/前进
   *  仅在历史可走时移动,刷新重载当前地址。历史成员在此前导航时已经过
   *  Main 侧导航策略,本面不做二次来源裁决 */
  goBack(viewId: string): Promise<RemoteContentViewStateV1>;
  goForward(viewId: string): Promise<RemoteContentViewStateV1>;
  reload(viewId: string): Promise<RemoteContentViewStateV1>;
  close(viewId: string): Promise<void>;
  setVisible(viewId: string, visible: boolean): Promise<RemoteContentViewStateV1>;
  /** BOOTH 登录态线索(只读探测;W25 走查缺陷③b 最小实现):检查本机分区
   *  Session 中账户域(accounts.booth.pm)是否存在已存 Cookie——Cookie 值
   *  永不过本面(只返回三态线索,不读取、不传输内容)。"stored" = 账户域有
   *  存储痕迹(大概率登录过,首导主页);"none" = 无痕迹(引导登录页);
   *  "unknown" = 探测失败(诚实未知,回落主页,不冒充已检测)。会话 cookie
   *  名无公开文档,不作具体键名猜测;本线索非登录判定,登录与否以站点
   *  实际呈现为准。 */
  signInHint(): Promise<"stored" | "none" | "unknown">;
  events: { subscribe(listener: (event: RemoteContentEventV1) => void): () => void };
}

/** 账号库同步触发结果(N5 S1):触发面只启动/中止运行,进度与终态走
 * provider 九态任务面(通知中心),本面不返回运行过程。 */
export type CatalogSyncStartOutcomeV1 =
  | { readonly status: "started"; readonly runId: string }
  | { readonly status: "already_running"; readonly runId: string }
  | { readonly status: "blocked"; readonly reason: "sign-in-required" };

/** 账号库同步窄面(N5 S1):渲染层显式触发/中止一次 BOOTH 账号库同步。
 * 会话与凭据留在 Main 侧分区会话内,本面不携带任何 Cookie/令牌;未登录
 * (登录线索 "none")返回 blocked 引导登录,不空跑。 */
export interface CatalogSyncApiV1 {
  /** libraryType 可选:同步哪个账号库(缺省已购);Main 按类型派生入口,
   *  来源守卫在 fetchWithSession 的允许清单 */
  start(request?: {
    readonly libraryType?: "bought" | "gifts" | "free_downloads";
  }): Promise<CatalogSyncStartOutcomeV1>;
  /** 请求中止当前运行(无运行时为 no-op);中止如实记为 aborted,已完成
   * 页的目录更新保留。 */
  stop(): Promise<void>;
}

/** 壳能力自报(桌面壳静态声明;proposal 015 §11 仲裁方案 a):能力拥有者
 *  (Electron 壳)自报,不经 provider 转述——远程 web 内容隔离于桌面壳内,
 *  其能力报告不属于 provider capability 面。 */
export interface DesktopCapabilitiesV1 {
  /** Main 基座(remote-content + U9 四分法导航策略)在位;内嵌浏览呈现
   *  两态判据据此驱动(端到端可用才翻转呈现,desktop 架构 1.1.0) */
  readonly remoteBrowser: boolean;
}

/** 导航确认缘由(U9 四分法):清单外 http/https 页(提示后放行转内嵌视图)
 *  与外部协议(确认后交系统打开)——确认层唯一两个进入点 */
export type NavConfirmReasonV1 = "origin_not_allowed" | "external_protocol";

/** 导航确认请求(Main → 渲染层;U9(1)/(3) 确认前在,015 §12 对接设计):
 *  confirmId 由 Main 生成,渲染层只能回应已发出的确认 */
export interface NavigationConfirmRequestV1 {
  readonly confirmId: string;
  readonly url: string;
  readonly reason: NavConfirmReasonV1;
}

export interface DesktopNavigationConfirmApiV1 {
  /** 对已发出的确认作答;未知 confirmId 与重复作答被 Main 忽略 */
  respond(confirmId: string, approved: boolean): Promise<void>;
  events: {
    subscribe(listener: (request: NavigationConfirmRequestV1) => void): () => void;
  };
}

// ---- 壳编辑器设置(U10 门③留痕,021 仲裁:信任呈现＋首次确认 UI＋留痕 =
// 桌面设置面承载;手选值物理持久化归桌面机器级 settings,核心经
// VUA_UNITY_EDITOR 注入消费,核心不另建机器设置文档库) ----

/** 已确认手选编辑器(一次选择一条留痕;选择变更 = 新选择,首次确认重新起算) */
export interface ConfirmedEditorV1 {
  readonly path: string;
  /** 验证到的完整版本串(来自 environment.verifyEditor verified 分支) */
  readonly version: string;
  /** 门③确认时刻(RFC 3339,壳写入时的机器事实) */
  readonly confirmedAt: string;
}

export interface EditorSettingsV1 {
  readonly schemaVersion: 1;
  /** null = 无已确认手选(诚实缺席;探测候选不进此留痕) */
  readonly confirmedEditor: ConfirmedEditorV1 | null;
}

export interface DesktopEditorSettingsApiV1 {
  read(): Promise<EditorSettingsV1>;
  /** 全量覆写保存(渲染层持完整状态);形状非法时 Main 侧拒绝并回当前落盘值 */
  save(settings: EditorSettingsV1): Promise<EditorSettingsV1>;
}

// ---- 版本检测(2026-09-19 用户裁决:默认开启、设置可关;仅只读探测,
// 下载/应用更新 = Phase C 单独立提案,本面不承载) ----

/** 三态闭集:newer-available = 远端发布高于当前;up-to-date = 已最新或无法
 * 证明更高;check-failed = 网络/解析失败(如实呈现,绝不猜态) */
export type UpdateCheckStateV1 = "newer-available" | "up-to-date" | "check-failed";

export interface UpdateCheckResultV1 {
  readonly schemaVersion: 1;
  readonly state: UpdateCheckStateV1;
  /** 发起检测时的当前应用版本(app.getVersion()) */
  readonly currentVersion: string;
  /** 远端最新发布版本;check-failed 或缺 tag_name 时为 null(诚实缺席) */
  readonly latestVersion: string | null;
  /** 远端发布页 URL;无发布或失败时为 null */
  readonly releaseUrl: string | null;
  /** 检测完成时刻(RFC 3339,Main 侧落戳) */
  readonly checkedAt: string;
}

export interface DesktopSystemApiV1 {
  /** 只读版本探测:比对 GitHub latest release;永不抛——失败恒落 check-failed */
  checkUpdate(): Promise<UpdateCheckResultV1>;
  /** 系统资源占用快照(2026-09-25 用户裁决:顶栏占用查看器):
   * RAM 恒在场(os 直接读);VRAM 尽力采集(Windows GPU 性能计数器),
   * 不可用/非 Windows 平台恒 null,渲染层如实呈现「不可用」不猜值 */
  readResourceUsage(): Promise<SystemResourceUsageV1>;
}

// ---- 本地文件系统窄面(2026-09-25 用户裁决:素材导入应用内文件夹选择器;
// 只读列表 + 单层新建,渲染层经此面做目录浏览,不持任何文件句柄;
// 所有失败内收于结果信封,本面永不抛) ----

/** 目录列表条目(仅子目录;文件不进词表——素材包以文件夹为单位导入) */
export interface DesktopFsEntryV1 {
  readonly name: string;
  readonly path: string;
  /** Windows 隐藏属性经 Node fs 不可得,仅以点前缀为启发式判据(诚实
   *  注释:dot-prefix heuristic only;属性级检测不可用时如实呈现启发式
   *  结果,不冒充精确判定) */
  readonly hidden: boolean;
}

export interface DesktopFsListV1 {
  /** 实际列出的目录(请求 null = 用户主目录时回落地解析结果) */
  readonly path: string;
  /** 上一级;根目录/无法再上时 null */
  readonly parent: string | null;
  readonly entries: readonly DesktopFsEntryV1[];
}

export type DesktopFsErrorV1 =
  | "not_found"
  | "not_a_directory"
  | "access_denied"
  | "invalid_name"
  | "already_exists"
  | "failed";

/** 文件系统面结果信封:失败是值不是异常——渲染层按 error 词表如实呈现 */
export type DesktopFsResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DesktopFsErrorV1 };

export interface DesktopFsApiV1 {
  /** 列目录(仅子目录):path null = 用户主目录;showHidden 缺省 false——
   * 隐藏目录以点前缀启发式判定,见 DesktopFsEntryV1.hidden */
  listDirectory(
    path: string | null,
    options?: { readonly showHidden?: boolean },
  ): Promise<DesktopFsResultV1<DesktopFsListV1>>;
  /** 在 parentPath 下新建单层目录:名字非法(空/含分隔符或控制字符/
   * "." ".."/超长)= invalid_name;已存在 = already_exists(不 recursive,
   * 不猜测不覆盖) */
  createDirectory(
    parentPath: string,
    name: string,
  ): Promise<DesktopFsResultV1<{ readonly path: string }>>;
}

/** 系统资源占用快照(瞬时读数,不持久化;schemaVersion 随形状演进) */
export interface SystemResourceUsageV1 {
  readonly schemaVersion: 1;
  readonly ramUsedBytes: number;
  readonly ramTotalBytes: number;
  /** 显存已用(主导适配器口径):采集不可用为 null */
  readonly vramUsedBytes: number | null;
  /** 显存总量(主导适配器口径):采集不可用为 null */
  readonly vramTotalBytes: number | null;
  /** 采样完成时刻(RFC 3339,Main 侧落戳) */
  readonly sampledAt: string;
}

export interface VuaDesktopApiV1 {
  readonly gateway: DesktopGatewayApiV1;
  readonly events: DesktopGatewayEventsApiV1;
  readonly dialog: DesktopDialogApiV1;
  readonly window: DesktopWindowApiV1;
  readonly remoteContent: RemoteContentApiV1;
  readonly catalogSync: CatalogSyncApiV1;
  readonly capabilities: DesktopCapabilitiesV1;
  readonly navigationConfirm: DesktopNavigationConfirmApiV1;
  readonly editorSettings: DesktopEditorSettingsApiV1;
  readonly system: DesktopSystemApiV1;
  readonly fs: DesktopFsApiV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** production-use-case v0.2 列表参数闭集(011 §7:可选键 text/limit/offset/
 *  recipeId;词表外键或类型不符 = invalid_params 同源判定) */
function isProductionListParamsV1(params: Record<string, unknown>): boolean {
  for (const key of Object.keys(params)) {
    if (key === "text") {
      if (typeof params.text !== "string") return false;
    } else if (key === "limit" || key === "offset") {
      if (typeof params[key] !== "number") return false;
    } else if (key === "recipeId") {
      if (typeof params.recipeId !== "string" || params.recipeId.length < 1) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** inspection.list 可选参数闭集(inspection-queries v0.1 数据草案面:可选键
 * avatarRef/overallStatus/limit/offset;overallStatus 聚合闭集 pass|warn|fail
 * ——unavailable 是维状态非聚合输出;limit 1..200/offset≥0 有界分页;
 * 词表外键或类型不符 = 同源判定拒绝) */
function isInspectionListParams(params: Record<string, unknown>): boolean {
  for (const key of Object.keys(params)) {
    if (key === "avatarRef") {
      if (typeof params.avatarRef !== "string" || params.avatarRef.length < 1) return false;
    } else if (key === "overallStatus") {
      if (!(["pass", "warn", "fail"] as readonly string[]).includes(params.overallStatus as string)) {
        return false;
      }
    } else if (key === "limit") {
      if (typeof params.limit !== "number" || !Number.isSafeInteger(params.limit) || params.limit < 1 || params.limit > 200) {
        return false;
      }
    } else if (key === "offset") {
      if (typeof params.offset !== "number" || !Number.isSafeInteger(params.offset) || params.offset < 0) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

/** packages-ops A1 冻结口径:packageIds 显式非空闭列(minItems 1 +
 * uniqueItems,词表外键/重复项/空项均形状违反) */
function isArrayNonEmptyUniqueIdentifiers(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => isIdentifier(item))
    && new Set(value).size === value.length;
}

/** packages-ops A2 冻结口径(桌面 A2 消费批):安装请求行闭列(minItems 1,
 * 每行 {packageId, version} 二键闭集——version 必填可空,null = 解析器选
 * 最新稳定版,string = 钉死精确版本〔minLength 1〕;同 packageId 重复 =
 * 词面违反,版本不同亦然——行间 id 唯一 seenIds 在此钉死,与 026 A2 守卫
 * 窄化同形〔Schema uniqueItems 只能钉完全重复行,跨行 id 比较由 TS 层
 * 承担,026 形状核可钉法缺口申报的收口口径〕) */
function isInstallRequestRows(value: unknown): value is readonly { packageId: string; version: string | null }[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const seenIds = new Set<string>();
  return value.every((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return false;
    const record = row as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== "packageId" || keys[1] !== "version") return false;
    if (typeof record.packageId !== "string" || record.packageId.length === 0) return false;
    if (seenIds.has(record.packageId)) return false;
    seenIds.add(record.packageId);
    return record.version === null
      || (typeof record.version === "string" && record.version.length > 0);
  });
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const PRODUCTION_MODES_V02: readonly string[] = ["direct_unity_package", "local_reusable_vpm"];
const PRODUCTION_RISK_CHOICES_V02: readonly string[] = [
  "snapshot_and_continue",
  "continue",
  "cancel",
  "not_required",
];

function isProductionModeV02(value: unknown): boolean {
  return typeof value === "string" && PRODUCTION_MODES_V02.includes(value);
}

function isProductionRiskChoiceV02(value: unknown): boolean {
  return typeof value === "string" && PRODUCTION_RISK_CHOICES_V02.includes(value);
}

const REQUEST_KEYS = ["schemaVersion", "requestId", "method", "params"] as const;

export function isDesktopGatewayRequestV1(value: unknown): value is DesktopGatewayRequestV1 {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== DESKTOP_GATEWAY_VERSION) return false;
  if (typeof value.requestId !== "string" || value.requestId.length < 1 || value.requestId.length > 128) {
    return false;
  }
  if (!isRecord(value.params)) return false;

  switch (value.method) {
    case "app.snapshot":
    case "task.list":
    case "environment.getSnapshot":
    case "overlay.getSnapshot":
      return hasExactKeys(value, REQUEST_KEYS) && hasExactKeys(value.params, []);
    case "environment.planDeployment":
      return hasExactKeys(value, REQUEST_KEYS) && isDeploymentParams(value.params, false);
    case "environment.executeDeployment": {
      if (!hasExactKeys(value, REQUEST_KEYS) || !hasExactKeys(value.params, ["intent", "confirmedDigest", "commandId"]) || !isDeploymentCommandId(value.params.commandId)) return false;
      return isDeploymentParams({ intent: value.params.intent, confirmedDigest: value.params.confirmedDigest }, true);
    }
    case "environment.verifyEditor":
      // 021 词表行:params 单字段闭集 {path} minLength 1(裁决③ verbatim
      // 纪律,不设 maxLength);词表外键拒绝
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["path"])
        && typeof value.params.path === "string"
        && value.params.path.length >= 1;
    case "task.get":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["taskId"])
        && isIdentifier(value.params.taskId);
    case "task.requestCancellation":
      if (!hasExactKeys(value, REQUEST_KEYS)) return false;
      if (!hasExactKeys(value.params, ["taskId", "commandId"])) {
        // observedRevision 可选:允许 { taskId, commandId, observedRevision }
        const keys = Object.keys(value.params).sort();
        if (
          keys.length !== 3
          || keys[0] !== "commandId"
          || keys[1] !== "observedRevision"
          || keys[2] !== "taskId"
        ) {
          return false;
        }
      }
      return isIdentifier(value.params.taskId)
        && isIdentifier(value.params.commandId)
        && (value.params.observedRevision === undefined || isNonNegativeInteger(value.params.observedRevision));
    case "task.startDemo":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["commandId"])
        && isIdentifier(value.params.commandId);
    case "production.startInspection":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["materialRefId", "commandId"])
        && isIdentifier(value.params.materialRefId)
        && isIdentifier(value.params.commandId);
    case "production.getInspection":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["inspectionId"])
        && isIdentifier(value.params.inspectionId);
    case "production.requestPlan":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["inspectionId", "commandId", "mode"])
        && isIdentifier(value.params.inspectionId)
        && isIdentifier(value.params.commandId)
        && isProductionModeV02(value.params.mode);
    case "production.getPlan":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["planId"])
        && isIdentifier(value.params.planId);
    case "production.confirmPlan": {
      if (!hasExactKeys(value, REQUEST_KEYS)) return false;
      const confirmParams = value.params as Record<string, unknown>;
      const confirmKeys = Object.keys(confirmParams).sort();
      const confirmExpected = ["commandId", "observedRevision", "planId", "rememberForSession", "riskChoice"];
      if (confirmKeys.length !== 4 && confirmKeys.length !== 5) return false;
      if (!confirmKeys.every((key) => confirmExpected.includes(key))) return false;
      if (!isIdentifier(confirmParams.planId) || !isIdentifier(confirmParams.commandId)) return false;
      if (typeof confirmParams.observedRevision !== "number"
        || !Number.isSafeInteger(confirmParams.observedRevision)
        || confirmParams.observedRevision < 1) {
        return false;
      }
      if (!isProductionRiskChoiceV02(confirmParams.riskChoice)) return false;
      return confirmParams.rememberForSession === undefined
        || typeof confirmParams.rememberForSession === "boolean";
    }
    case "production.recover":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["taskId", "decision", "commandId"])
        && isIdentifier(value.params.taskId)
        && isIdentifier(value.params.commandId)
        && (value.params.decision === "continue" || value.params.decision === "rollback");
    case "production.getBuildRecord":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["buildRecordId"])
        && isIdentifier(value.params.buildRecordId);
    case "catalog.list": {
      if (!hasExactKeys(value, REQUEST_KEYS)) return false;
      const listParams = value.params as CatalogListRequestV1["params"];
      if (!Object.keys(listParams).every((key) => key === "text" || key === "availabilityStatus" || key === "limit" || key === "offset")) {
        return false;
      }
      if (listParams.text !== undefined && listParams.text !== null
        && (typeof listParams.text !== "string" || listParams.text.length < 1)) return false;
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
    case "catalog.detail":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["productId"])
        && typeof value.params.productId === "string"
        && /^booth:[0-9]+$/.test(value.params.productId);
    case "catalog.status":
    case "warehouse.listEntries":
    case "downloads.listCompleted":
    case "project.environmentManagers":
      return hasExactKeys(value, REQUEST_KEYS) && hasExactKeys(value.params, []);
    // bdl-queries v0.5(桌面 TS 登记面 2026-09-22):lookup params 闭集
    // {name, depKind?, limit?, offset?} 与冻结 Schema additionalProperties:
    // false 同形——name 必填非空,depKind 骑 BDL v0.2 四值闭集(null/缺席 =
    // 不过滤),分页 1–200/≥0;词外键(含 fuzzy 等价开关)拒绝 = 契约错误
    case "dependencies.lookup": {
      if (!hasExactKeys(value, REQUEST_KEYS)) return false;
      const lookupParams = value.params as DependenciesLookupRequestV1["params"];
      const lookupKeys = Object.keys(lookupParams);
      if (!lookupKeys.includes("name")
        || lookupKeys.some((key) => key !== "name" && key !== "depKind" && key !== "limit" && key !== "offset")) {
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
    // listByProduct params 单键闭集 {productId}(catalog.detail 同 pattern,
    // booth: 命名空间身份);无 name/过滤键——客户端过滤 = 契约错误(负例
    // 向量钉死),绝不静默空答
    case "dependencies.listByProduct":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["productId"])
        && typeof value.params.productId === "string"
        && /^booth:[0-9]+$/.test(value.params.productId);
    case "project.listProjects":
      return hasExactKeys(value, REQUEST_KEYS) && hasExactKeys(value.params, []);
    case "project.inspectProject":
    case "project.lockStatus":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath"])
        && isIdentifier(value.params.projectPath);
    // inspection-queries v0.1(M7 检查切片):get 身份寻址单参必填;list
    // 可选闭集过滤
    case "inspection.get":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["inspectionId"])
        && isIdentifier(value.params.inspectionId);
    case "inspection.list":
      return hasExactKeys(value, REQUEST_KEYS) && isInspectionListParams(value.params);
    // release-handoff v0.1(023 消费切片)＋v0.2 检视入口(U19 桌面对齐
    // 批):params 闭集单键 {buildId} minLength 1(词表外键拒绝,与 schema
    // additionalProperties:false 同形;两 editor-open 入口同律)
    case "release.openForHandoff":
    case "release.openForInspection":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["buildId"])
        && typeof value.params.buildId === "string"
        && value.params.buildId.length >= 1;
    // packages-query v0.1(024 P1 消费批):params 闭集单键 {projectPath}
    // minLength 1(冻结 Schema 口径,不发明长度上限;词表外键拒绝)
    case "packages.listInstalled":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath"])
        && typeof value.params.projectPath === "string"
        && value.params.projectPath.length >= 1;
    // 025 P2 读面(桌面 P2 消费批):listRepos 空闭集(全局配置面,任何
    // 键 = 词表外形状违反);packageCatalog 双键闭集(projectPath 013 身
    // 份 + packageId,均 minLength 1 与 Schema 同形)
    case "packages.listRepos":
      return hasExactKeys(value, REQUEST_KEYS) && hasExactKeys(value.params, []);
    case "packages.packageCatalog":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath", "packageId"])
        && typeof value.params.projectPath === "string"
        && value.params.projectPath.length >= 1
        && typeof value.params.packageId === "string"
        && value.params.packageId.length >= 1;
    // 027 F2 读面(桌面 F2 消费批):repoCatalog 双键必带可空闭集——
    // repoId null 或非空串(minLength 1);packageIds null = 不过滤,
    // 非空 = 唯一非空 id 闭列(空数组 = 形状违反非空过滤,与冻结词面
    // 同形;词表外键拒绝)
    case "packages.repoCatalog": {
      if (!hasExactKeys(value, REQUEST_KEYS) || !hasExactKeys(value.params, ["repoId", "packageIds"])) {
        return false;
      }
      const repoCatalogParams = value.params as PackagesRepoCatalogRequestV1["params"];
      if (repoCatalogParams.repoId !== null
        && (typeof repoCatalogParams.repoId !== "string" || repoCatalogParams.repoId.length < 1)) {
        return false;
      }
      if (repoCatalogParams.packageIds === null) return true;
      if (!Array.isArray(repoCatalogParams.packageIds) || repoCatalogParams.packageIds.length === 0) return false;
      return repoCatalogParams.packageIds.every((id) => typeof id === "string" && id.length >= 1)
        && new Set(repoCatalogParams.packageIds).size === repoCatalogParams.packageIds.length;
    }
    // 027 F5 读面(桌面 F5 消费批):listTemplates 空闭集(环境级配置
    // 面,任何键 = 词表外形状违反;listRepos 空闭集同款)
    case "packages.listTemplates":
      return hasExactKeys(value, REQUEST_KEYS) && hasExactKeys(value.params, []);
    // packages-ops v0.1 写面 A1 移除(026;桌面 A1 消费批):packageIds =
    // 显式非空闭列(minItems 1 + uniqueItems,冻结 Schema 口径,词表外
    // 键拒绝);applyRemove 三键闭集必携 confirmedDigest(minLength 1),
    // preview 参数无 digest 位;commandId 由 Kernel 生成不在 params
    case "packages.previewRemove":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath", "packageIds"])
        && typeof value.params.projectPath === "string"
        && value.params.projectPath.length >= 1
        && isArrayNonEmptyUniqueIdentifiers(value.params.packageIds);
    case "packages.applyRemove":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath", "packageIds", "confirmedDigest"])
        && typeof value.params.projectPath === "string"
        && value.params.projectPath.length >= 1
        && isArrayNonEmptyUniqueIdentifiers(value.params.packageIds)
        && typeof value.params.confirmedDigest === "string"
        && value.params.confirmedDigest.length >= 1;
    // packages-ops v0.2 写面 A2 安装/升级(026;桌面 A2 消费批):packages =
    // 请求行闭列({packageId, version string|null} 二键闭集行,minItems 1,
    // 行间 id 唯一含异版本——同 packageId 重复 = 词面违反,seenIds 钉死与
    // A2 守卫窄化同形);applyInstall 三键闭集必携 confirmedDigest
    // (minLength 1),preview 参数无 digest 位;commandId 由 Kernel 生成
    // 不在 params
    case "packages.previewInstall":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath", "packages"])
        && typeof value.params.projectPath === "string"
        && value.params.projectPath.length >= 1
        && isInstallRequestRows(value.params.packages);
    case "packages.applyInstall":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath", "packages", "confirmedDigest"])
        && typeof value.params.projectPath === "string"
        && value.params.projectPath.length >= 1
        && isInstallRequestRows(value.params.packages)
        && typeof value.params.confirmedDigest === "string"
        && value.params.confirmedDigest.length >= 1;
    // packages-ops v0.3 写面 A3 本地包注册(026;桌面 A3 消费批):params
    // 单键闭集 {packageRoot}(本地包根目录,非空;无 projectPath——注册
    // 只动后端隔离环境;无 digest 位——携即形状违反,本面无 preview 可
    // 漂移,用户显式提交即确认);commandId 由 Kernel 生成不在 params
    case "packages.registerLocalPackage":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["packageRoot"])
        && typeof value.params.packageRoot === "string"
        && value.params.packageRoot.length >= 1;
    // packages-ops v0.4 写面 A4 仓库订阅增删(026;桌面 A4 消费批):
    // params 精确键集闭集(双键 {url,name}/{path,name} 与单键 {repoId},
    // 全非空串;无 projectPath——订阅面只写后端隔离环境;无 digest 位——
    // 本面无 preview 可漂移,携即形状违反;commandId 由 Kernel 生成不在
    // params)
    case "packages.addRemoteRepo":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["name", "url"])
        && typeof value.params.url === "string"
        && value.params.url.length >= 1
        && typeof value.params.name === "string"
        && value.params.name.length >= 1;
    case "packages.addLocalRepo":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["name", "path"])
        && typeof value.params.path === "string"
        && value.params.path.length >= 1
        && typeof value.params.name === "string"
        && value.params.name.length >= 1;
    case "packages.removeRepo":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["repoId"])
        && typeof value.params.repoId === "string"
        && value.params.repoId.length >= 1;
    // packages-ops v0.5 写面 A5 项目创建(026;桌面 A5 消费批):params
    // 三键闭集 {parent, name, template}(parent/name 非空串;template
    // REQUIRED-nullable——键必须在位:缺键 = 违例,null = 后端默认解析,
    // 非空串 = verbatim 透传,空串/非串 = 违例;无 projectPath——创建不
    // 寻址任何在册项目;无 digest 位——本面无 preview 可漂移,携即形状
    // 违反,用户显式表单提交即确认;commandId 由 Kernel 生成不在 params)
    case "packages.createProject":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["parent", "name", "template"])
        && typeof value.params.parent === "string"
        && value.params.parent.length >= 1
        && typeof value.params.name === "string"
        && value.params.name.length >= 1
        && (value.params.template === null
          || (typeof value.params.template === "string"
            && value.params.template.length >= 1));
    // 027 F4 写面(桌面 F4 消费批):三方法单键闭集 {repoId} verbatim——
    // 任何额外键(含 confirmedDigest/projectPath)= 词表外形状违反(无
    // preview 臂可漂移,冻结负例向量钉死);repoId 非空串(空串 = 形状
    // 违反,冻结词面 minLength 1)
    case "packages.enableRepo":
    case "packages.disableRepo":
    case "packages.refreshRepo":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["repoId"])
        && typeof value.params.repoId === "string"
        && value.params.repoId.length >= 1;
    case "warehouse.entryDetail":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["warehouseItemId"])
        && isIdentifier(value.params.warehouseItemId);
    case "download.retry":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["taskId", "commandId"])
        && isIdentifier(value.params.taskId)
        && isIdentifier(value.params.commandId);
    case "warehouse.setArtifactMode":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["warehouseItemId", "mode", "commandId"])
        && isIdentifier(value.params.warehouseItemId)
        && (value.params.mode === null
          || value.params.mode === "use_original_unitypackage"
          || value.params.mode === "generate_vpm")
        && isIdentifier(value.params.commandId);
    case "warehouse.generateVpm":
    case "warehouse.deleteOriginals":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["warehouseItemId", "commandId"])
        && isIdentifier(value.params.warehouseItemId)
        && isIdentifier(value.params.commandId);
    // bdl-commands v0.2 全局层(W14):同步写面,回执为 BDL 读回事实
    case "warehouse.setGlobalDefaultMode":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["mode", "commandId"])
        && (value.params.mode === "use_original_unitypackage"
          || value.params.mode === "generate_vpm")
        && isIdentifier(value.params.commandId);
    // bdl-commands v0.3 导入(W19):非空字符串数组
    case "warehouse.import":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["sourceFolders", "commandId"])
        && Array.isArray(value.params.sourceFolders)
        && value.params.sourceFolders.length > 0
        && value.params.sourceFolders.every(
          (folder: unknown) => typeof folder === "string" && folder.length > 0)
        && isIdentifier(value.params.commandId);
    // bdl-commands v0.4 下载采纳(IMP-3):仅身份,非空字符串数组
    case "warehouse.importDownloads":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["downloadIds", "commandId"])
        && Array.isArray(value.params.downloadIds)
        && value.params.downloadIds.length > 0
        && value.params.downloadIds.every(
          (downloadId: unknown) => typeof downloadId === "string" && downloadId.length > 0)
        && isIdentifier(value.params.commandId);
    // production-use-case v0.2(W20 十方法冻结件):文档本体以 object 承载,
    // 词表闭集照冻结面
    case "recipe.save":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["recipeDocument", "baseRevision"])
        && typeof value.params.recipeDocument === "object"
        && value.params.recipeDocument !== null
        && typeof value.params.baseRevision === "number";
    case "recipe.get":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["recipeId"])
        && isIdentifier(value.params.recipeId);
    case "recipe.list":
    case "plan.list":
    case "record.list":
      return hasExactKeys(value, REQUEST_KEYS) && isProductionListParamsV1(value.params);
    case "recipe.resolve":
      if (!hasExactKeys(value, REQUEST_KEYS)) return false;
      if (!hasExactKeys(value.params, ["recipeId"])) {
        const keys = Object.keys(value.params).sort();
        if (keys.length !== 2 || keys[1] !== "revision") return false;
      }
      return isIdentifier(value.params.recipeId)
        && (value.params.revision === undefined || typeof value.params.revision === "number");
    // 029 B 面 recipe-export v0.1(桌面环 4):params 单键闭集 {projectPath}
    // 非空(未注册路径由 Provider 回复用码,信封只钉键形与空值形态)
    case "recipe.exportProjectDraft":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath"])
        && isIdentifier(value.params.projectPath);
    case "plan.approve":
    case "plan.get":
    case "job.execute":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["planId"])
        && isIdentifier(value.params.planId);
    case "record.get":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["buildId"])
        && isIdentifier(value.params.buildId);
    // 014 副本导入(F6 确认链;plan/apply 两段;apply 强制 confirmedPlanDigest)
    case "project.import-copy":
      if (!hasExactKeys(value, REQUEST_KEYS)) return false;
      if (!hasExactKeys(value.params, ["phase", "sourcePath", "targetParentDirectory", "targetProjectName"])) {
        const keys = Object.keys(value.params).sort();
        if (keys.length !== 5 || keys[0] !== "confirmedPlanDigest") return false;
      }
      return (value.params.phase === "plan" || value.params.phase === "apply")
        && isIdentifier(value.params.sourcePath)
        && isIdentifier(value.params.targetParentDirectory)
        && isIdentifier(value.params.targetProjectName)
        && (value.params.confirmedPlanDigest === undefined
          || isIdentifier(value.params.confirmedPlanDigest));
    // project-ops v0.2 setNote(D-6 接线):projectPath 身份 + note 单行
    // 非空或 null(冻结 Schema:1..2000 字符无换行;长度上限由服务端任务内
    // 校验,信封守卫钉键形与空值形态)
    case "project.setNote":
      return hasExactKeys(value, REQUEST_KEYS)
        && hasExactKeys(value.params, ["projectPath", "note"])
        && isIdentifier(value.params.projectPath)
        && (value.params.note === null
          || (typeof value.params.note === "string"
            && value.params.note.length > 0
            && !/[\r\n]/.test(value.params.note)));
    default:
      return false;
  }
}

export function requestByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

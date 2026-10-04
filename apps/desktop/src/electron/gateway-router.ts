import {
  APPLICATION_CONTRACT_VERSION,
  DESKTOP_GATEWAY_MAX_REQUEST_BYTES,
  DESKTOP_GATEWAY_VERSION,
  isDesktopGatewayRequestV1,
  requestByteLength,
  type ApplicationRequestV01,
  type ApplicationSnapshotV01,
  type DesktopGatewayRequestV1,
  type DesktopGatewayResponseV1,
} from "@vua/contracts";
import type { OrchestratorProviderV01 } from "@vua/orchestrator-provider";
import { isAllowedLocalSender } from "./security.js";
import { SHELL_CAPABILITIES } from "./shell-capabilities.js";

const TASK_LIST_CAPABILITY = "task.list";

/** 生产上下文四元组(amf-production v0.2:startInspection 一次性转交) */
export interface ProductionContextV02 {
  readonly sourceFolder: string;
  readonly projectRoot: string;
  readonly artifactOutputRoot: string;
  readonly projectId: string;
}

export interface DesktopGatewayRouteContext {
  readonly provider: OrchestratorProviderV01;
  readonly productVersion: string;
  readonly platform: "win32" | "darwin" | "linux";
  readonly rendererUrl: string | undefined;
  /** 生产上下文解析(M3):refId → 四元组。sourceFolder 来自用户显式选取,
   *  projectRoot/artifactOutputRoot/projectId 是 VUA 管辖配置,渲染层不可见;
   *  未知引用返回 undefined。四元组随 startInspection 一次性转交,此后路径
   *  不再出现在任何请求面 */
  readonly resolveMaterialSource: (refId: string) => ProductionContextV02 | undefined;
}

function requestIdFrom(value: unknown): string {
  return value !== null
    && typeof value === "object"
    && typeof (value as { requestId?: unknown }).requestId === "string"
      ? (value as { requestId: string }).requestId
      : "invalid";
}

function failure(
  requestId: string,
  code: "invalid_request" | "unsupported_method" | "internal",
  messageKey: string,
): DesktopGatewayResponseV1 {
  return {
    schemaVersion: DESKTOP_GATEWAY_VERSION,
    requestId,
    ok: false,
    error: { code, messageKey },
  };
}

function isApplicationSnapshot(value: unknown): value is ApplicationSnapshotV01 {
  return value !== null
    && typeof value === "object"
    && "capabilities" in value
    && (value as { capabilities?: unknown }).capabilities !== null
    && typeof (value as { capabilities?: unknown }).capabilities === "object";
}

function capabilityAvailable(snapshot: ApplicationSnapshotV01, operationId: string): boolean {
  return snapshot.capabilities.operations.some(
    (operation) => operation.operationId === operationId && operation.availability === "available",
  );
}

/** Gateway 方法 → 应用契约请求;方法表穷尽,新增方法在此同步登记 */
function toApplicationRequest(
  request: DesktopGatewayRequestV1,
  resolveMaterialSource: DesktopGatewayRouteContext["resolveMaterialSource"],
): ApplicationRequestV01 {
  const base = {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    requestId: request.requestId,
    correlationId: request.requestId,
  };
  switch (request.method) {
    case "app.snapshot":
      return { ...base, kind: "query", method: "application.getSnapshot", params: {} };
    case "task.list":
      return { ...base, kind: "query", method: "task.list", params: {} };
    case "task.get":
      return { ...base, kind: "query", method: "task.get", params: { taskId: request.params.taskId } };
    case "task.requestCancellation":
      return {
        ...base,
        kind: "command",
        method: "task.requestCancellation",
        commandId: request.params.commandId,
        params: {
          taskId: request.params.taskId,
          ...(request.params.observedRevision === undefined
            ? {}
            : { observedRevision: request.params.observedRevision }),
        },
      };
    case "environment.planDeployment":
      return { ...base, kind: "query", method: request.method, params: request.params };
    case "environment.executeDeployment":
      return { ...base, kind: "command", method: request.method, commandId: request.params.commandId, params: { intent: request.params.intent, confirmedDigest: request.params.confirmedDigest } };
    case "environment.getSnapshot":
      return { ...base, kind: "query", method: "environment.getSnapshot", params: {} };
    // 021 词表行(核心七点裁决):手选路径三形态 verbatim 透传,桌面零本地
    // 归一化(归一化是原语职责);拒绝走 result 内态,信封错误只留给
    // transport/未接线缺席,本路由原样透传
    case "environment.verifyEditor":
      return { ...base, kind: "query", method: "environment.verifyEditor", params: { path: request.params.path } };
    // 017 overlay 表面批 1 消费接线:按需轮询读面,空参数 verbatim(桌面
    // 表态 1/2:按需轮询＋零会话身份;生产读面未接线=provider 回类型化
    // vua.overlay.unavailable,本路由原样透传)
    case "overlay.getSnapshot":
      return { ...base, kind: "query", method: "overlay.getSnapshot", params: {} };
    case "task.startDemo":
      return {
        ...base,
        kind: "command",
        method: "task.startDemo",
        commandId: request.params.commandId,
        params: {},
      };
    case "production.startInspection": {
      // v0.2:四元组在此一次性转交;渲染层仍只持 materialRefId + commandId
      const context = resolveMaterialSource(request.params.materialRefId);
      if (context === undefined) {
        throw new UnknownMaterialSourceError(request.params.materialRefId);
      }
      return {
        ...base,
        kind: "command",
        method: "production.startInspection",
        commandId: request.params.commandId,
        params: {
          sourceFolder: context.sourceFolder,
          projectRoot: context.projectRoot,
          artifactOutputRoot: context.artifactOutputRoot,
          projectId: context.projectId,
        },
      };
    }
    case "production.getInspection":
      return { ...base, kind: "query", method: "production.getInspection", params: { inspectionId: request.params.inspectionId } };
    case "production.requestPlan":
      return {
        ...base,
        kind: "command",
        method: "production.requestPlan",
        commandId: request.params.commandId,
        params: {
          inspectionId: request.params.inspectionId,
          // 双素材入口的真实用户决策,渲染层从已选素材的 intake 透传
          mode: request.params.mode,
        },
      };
    case "production.getPlan":
      return { ...base, kind: "query", method: "production.getPlan", params: { planId: request.params.planId } };
    case "production.confirmPlan":
      return {
        ...base,
        kind: "command",
        method: "production.confirmPlan",
        commandId: request.params.commandId,
        params: {
          planId: request.params.planId,
          observedRevision: request.params.observedRevision,
          riskChoice: request.params.riskChoice,
          ...(request.params.rememberForSession === undefined
            ? {}
            : { rememberForSession: request.params.rememberForSession }),
        },
      };
    case "production.getBuildRecord":
      return { ...base, kind: "query", method: "production.getBuildRecord", params: { buildRecordId: request.params.buildRecordId } };
    case "production.recover": {
      // v0.2:用户决定 ID 由 Kernel 生成并绑定(taskId + revision + decision),
      // 渲染层不传入,防伪造授权;路径已在登记绑定中,不再由请求携带
      const decisionId = `udid-${crypto.randomUUID()}`;
      return {
        ...base,
        kind: "command",
        method: "production.recover",
        commandId: request.params.commandId,
        params: {
          taskId: request.params.taskId,
          decision: request.params.decision,
          decisionId,
        },
      };
    }
    // bdl-queries v0.2 只读查询面:查询闭集已由信封守卫验证,参数原样透传
    case "catalog.list":
      return { ...base, kind: "query", method: "catalog.list", params: request.params };
    case "catalog.detail":
      return { ...base, kind: "query", method: "catalog.detail", params: request.params };
    case "catalog.status":
      return { ...base, kind: "query", method: "catalog.status", params: {} };
    case "warehouse.listEntries":
      return { ...base, kind: "query", method: "warehouse.listEntries", params: {} };
    // bdl-queries v0.4(015 §10):可采纳下载列表,空参数 verbatim
    case "downloads.listCompleted":
      return { ...base, kind: "query", method: "downloads.listCompleted", params: {} };
    // bdl-queries v0.5(030 §5.7 案 A,数据席第 168 批 FROZEN;桌面 TS 登记
    // 面 2026-09-22):两方法只读 verbatim 透传,零折叠。查询闭集已由信封
    // 守卫验证(词外键含 fuzzy 等价开关在词表层拒绝);核心接线批升信封常
    // 量与 provider 路由臂前,实现域未接线 = provider 答类型化
    // vua.provider.unknown_method 诚实缺席,本路由原样透传(缺席语义不折
    // 叠,recipe.exportProjectDraft 先例同律)
    case "dependencies.lookup":
      return {
        ...base,
        kind: "query",
        method: "dependencies.lookup",
        params: {
          name: request.params.name,
          ...(request.params.depKind === undefined ? {} : { depKind: request.params.depKind }),
          ...(request.params.limit === undefined ? {} : { limit: request.params.limit }),
          ...(request.params.offset === undefined ? {} : { offset: request.params.offset }),
        },
      };
    case "dependencies.listByProduct":
      return { ...base, kind: "query", method: "dependencies.listByProduct", params: { productId: request.params.productId } };
    // 013 读面第一翼(核心 e720544):environmentManagers 快照,空参数 verbatim
    case "project.environmentManagers":
      return { ...base, kind: "query", method: "project.environmentManagers", params: {} };
    case "project.listProjects":
      return { ...base, kind: "query", method: "project.listProjects", params: {} };
    case "project.inspectProject":
      return { ...base, kind: "query", method: "project.inspectProject", params: { projectPath: request.params.projectPath } };
    case "project.lockStatus":
      return { ...base, kind: "query", method: "project.lockStatus", params: { projectPath: request.params.projectPath } };
    // packages-query v0.1(024 P1 冻结批,P1 中间诚实态消费批):只读单方法
    // verbatim 透传;实现域未接线 = provider 答 vua.packages.unavailable
    // 诚实缺席,未注册路径 = 复用 vua.project.project_not_found 原样透传
    case "packages.listInstalled":
      return { ...base, kind: "query", method: "packages.listInstalled", params: { projectPath: request.params.projectPath } };
    // 025 P2 读面(桌面 P2 消费批):两方法只读 verbatim 透传——listRepos
    // 空闭集(全局配置面);packageCatalog 双键(projectPath 013 身份 +
    // packageId)。实现域未接线 = provider 答 vua.packages.unavailable
    // 诚实缺席;未注册路径 = 复用 vua.project.project_not_found;词表外
    // 无此包 = vua.vpm.no_matching_package(独立空态非错误页)——全部
    // 原样透传不折叠
    case "packages.listRepos":
      return { ...base, kind: "query", method: "packages.listRepos", params: {} };
    case "packages.packageCatalog":
      return {
        ...base,
        kind: "query",
        method: "packages.packageCatalog",
        params: { projectPath: request.params.projectPath, packageId: request.params.packageId },
      };
    // 027 F2 读面(桌面 F2 消费批):仓库级可装包清单只读 verbatim 透传
    // ——双键必带可空(repoId/packageIds null 原样上 wire,packageIds 非
    // 空逐项拷贝);路由层闭集校验已由信封守卫完成。实现域未接线 =
    // provider 答 vua.packages.unavailable 诚实缺席;词表外 repoId =
    // 复用 vua.vpm.repo_not_found 逐字透传不折叠(P2 读面零折叠);
    // 形状违例 = vua.packages.invalid_params;能力缺席(declared-none
    // 访问器,环境覆写置真前)= vua.vpm.capability_missing
    case "packages.repoCatalog":
      return {
        ...base,
        kind: "query",
        method: "packages.repoCatalog",
        params: {
          repoId: request.params.repoId,
          packageIds:
            request.params.packageIds === null ? null : [...request.params.packageIds],
        },
      };
    // 027 F5 读面(桌面 F5 消费批):模板条目枚举只读 verbatim 透传——
    // 空闭集(环境级配置面,listRepos 空闭集先例)。实现域未接线 =
    // provider 答 vua.packages.unavailable 诚实缺席;能力缺席(declared-
    // none 访问器,环境覆写置真前)= vua.vpm.capability_missing;形状
    // 违例 = vua.packages.invalid_params——全部原样透传不折叠;空数组 =
    // 诚实零模板应答(目录根缺失是事实非错误,桌面回落手填绝不渲染成
    // 错误、绝不虚构模板清单)
    case "packages.listTemplates":
      return { ...base, kind: "query", method: "packages.listTemplates", params: {} };
    // packages-ops v0.1 写面 A1 移除(026 冻结批;桌面 A1 消费批):preview
    // = 同步只读 query verbatim 透传(失败走信封错误:引擎缺席 =
    // vua.packages.unavailable,未注册 = 复用 vua.project.project_not_found,
    // 能力缺席 = vua.vpm.capability_missing——全部原样透传不折叠);
    // apply = 任务化写 command(import-copy 同构,commandId 由 Kernel 生成
    // 照 project.import-copy 先例;服务端复算摘要漂移即拒 preview_drift,
    // 权威判定在服务端——桌面只做 UX 提示)
    case "packages.previewRemove":
      return {
        ...base,
        kind: "query",
        method: "packages.previewRemove",
        params: { projectPath: request.params.projectPath, packageIds: [...request.params.packageIds] },
      };
    case "packages.applyRemove":
      return {
        ...base,
        kind: "command",
        method: "packages.applyRemove",
        commandId: `rmv-${crypto.randomUUID()}`,
        params: {
          projectPath: request.params.projectPath,
          packageIds: [...request.params.packageIds],
          confirmedDigest: request.params.confirmedDigest,
        },
      };
    // packages-ops v0.2 写面 A2 安装/升级(026 冻结批;桌面 A2 消费批):
    // preview = 同步只读 query verbatim 透传(请求行闭列 {packageId,
    // version string|null} 逐行拷贝;失败走信封错误:引擎缺席 =
    // vua.packages.unavailable,未注册 = 复用 vua.project.project_not_found,
    // 能力缺席 = vua.vpm.capability_missing,预览段失败 =
    // vua.packages.preview_failed——全部原样透传不折叠);apply = 任务化
    // 写 command(import-copy 同构,commandId 由 Kernel 生成照
    // packages.applyRemove 先例;服务端复算摘要漂移即拒 preview_drift,
    // 权威判定在服务端——桌面只做 UX 提示)
    case "packages.previewInstall":
      return {
        ...base,
        kind: "query",
        method: "packages.previewInstall",
        params: {
          projectPath: request.params.projectPath,
          packages: request.params.packages.map((row) => ({ ...row })),
        },
      };
    case "packages.applyInstall":
      return {
        ...base,
        kind: "command",
        method: "packages.applyInstall",
        commandId: `inst-${crypto.randomUUID()}`,
        params: {
          projectPath: request.params.projectPath,
          packages: request.params.packages.map((row) => ({ ...row })),
          confirmedDigest: request.params.confirmedDigest,
        },
      };
    // packages-ops v0.3 写面 A3 本地包注册(026 冻结批;桌面 A3 消费批):
    // 族中唯一无 preview 对偶——单方法任务化 command(import-copy/A1/A2
    // 同构,commandId 由 Kernel 生成照 applyRemove/applyInstall 先例);
    // params 单键闭集 {packageRoot} verbatim 透传(注册只动后端隔离环境,
    // 不触项目;无 digest 无确认链——用户显式提交即确认)
    case "packages.registerLocalPackage":
      return {
        ...base,
        kind: "command",
        method: "packages.registerLocalPackage",
        commandId: `reg-${crypto.randomUUID()}`,
        params: {
          packageRoot: request.params.packageRoot,
        },
      };
    // packages-ops v0.4 写面 A4 仓库订阅增删(026 冻结批;桌面 A4 消费批):
    // 照 A3 同律无 preview 对偶——三方法任务化 command(import-copy/A1/A2/
    // A3 同构,commandId 由 Kernel 生成照 applyRemove/applyInstall/
    // registerLocalPackage 先例);params 精确键集闭集 verbatim 透传(订阅
    // 面只写后端隔离环境,不触项目;无 digest 无确认链——用户显式提交即
    // 确认;移除行柄 = repoId 稳定 id,索引寻址不冻结)
    case "packages.addRemoteRepo":
      return {
        ...base,
        kind: "command",
        method: "packages.addRemoteRepo",
        commandId: `repo-${crypto.randomUUID()}`,
        params: {
          url: request.params.url,
          name: request.params.name,
        },
      };
    case "packages.addLocalRepo":
      return {
        ...base,
        kind: "command",
        method: "packages.addLocalRepo",
        commandId: `repo-${crypto.randomUUID()}`,
        params: {
          path: request.params.path,
          name: request.params.name,
        },
      };
    case "packages.removeRepo":
      return {
        ...base,
        kind: "command",
        method: "packages.removeRepo",
        commandId: `repo-${crypto.randomUUID()}`,
        params: {
          repoId: request.params.repoId,
        },
      };
    // packages-ops v0.6 写面 F4 仓库生命周期(027 冻结批;桌面 F4 消费批):
    // 照 A3/A4 同律无 preview 对偶——三方法任务化 command(Kernel 生成
    // commandId 照先例,lifecycle- 前缀);params 单键闭集 {repoId}
    // verbatim 透传(携 confirmedDigest/projectPath = 形状违反,信封守卫
    // 已在词表验证层拒绝;id 缺席行不在本词面可达范围,UI 不构造入口)
    case "packages.enableRepo":
      return {
        ...base,
        kind: "command",
        method: "packages.enableRepo",
        commandId: `lifecycle-${crypto.randomUUID()}`,
        params: {
          repoId: request.params.repoId,
        },
      };
    case "packages.disableRepo":
      return {
        ...base,
        kind: "command",
        method: "packages.disableRepo",
        commandId: `lifecycle-${crypto.randomUUID()}`,
        params: {
          repoId: request.params.repoId,
        },
      };
    case "packages.refreshRepo":
      return {
        ...base,
        kind: "command",
        method: "packages.refreshRepo",
        commandId: `lifecycle-${crypto.randomUUID()}`,
        params: {
          repoId: request.params.repoId,
        },
      };
    // packages-ops v0.5 写面 A5 项目创建(026 冻结批;桌面 A5 消费批):
    // 照 A3/A4 同律无 preview 对偶且根在端口——单方法任务化 command(
    // import-copy/A1–A4 同构,commandId 由 Kernel 生成照先例,create- 前
    // 缀);params 三键闭集 verbatim 透传(template REQUIRED-nullable:
    // null = 后端默认解析,非空串 = verbatim;无 digest 无确认链——用户
    // 显式表单提交即确认;无 projectPath——创建不寻址任何在册项目)
    case "packages.createProject":
      return {
        ...base,
        kind: "command",
        method: "packages.createProject",
        commandId: `create-${crypto.randomUUID()}`,
        params: {
          parent: request.params.parent,
          name: request.params.name,
          template: request.params.template,
        },
      };
    case "warehouse.entryDetail":
      return { ...base, kind: "query", method: "warehouse.entryDetail", params: { warehouseItemId: request.params.warehouseItemId } };
    case "download.retry":
      return { ...base, kind: "command", method: "download.retry", commandId: request.params.commandId, params: { taskId: request.params.taskId } };
    // bdl-commands v0.1 写命令(proposal 005):词表已由信封守卫验证,原样映射
    case "warehouse.setArtifactMode":
      return { ...base, kind: "command", method: "warehouse.setArtifactMode", commandId: request.params.commandId, params: { warehouseItemId: request.params.warehouseItemId, mode: request.params.mode } };
    case "warehouse.generateVpm":
      return { ...base, kind: "command", method: "warehouse.generateVpm", commandId: request.params.commandId, params: { warehouseItemId: request.params.warehouseItemId } };
    case "warehouse.deleteOriginals":
      return { ...base, kind: "command", method: "warehouse.deleteOriginals", commandId: request.params.commandId, params: { warehouseItemId: request.params.warehouseItemId } };
    // N5 收口:按商品删除本地原件(卡片右键),params 闭集 {productId}
    case "warehouse.deleteOriginalsByProduct":
      return { ...base, kind: "command", method: "warehouse.deleteOriginalsByProduct", commandId: request.params.commandId, params: { productId: request.params.productId } };
    case "warehouse.setGlobalDefaultMode":
      return { ...base, kind: "command", method: "warehouse.setGlobalDefaultMode", commandId: request.params.commandId, params: { mode: request.params.mode } };
    case "warehouse.import":
      // v0.5 实验选项原样转发:缺席即不发送(可选键闭集纪律)
      return {
        ...base,
        kind: "command",
        method: "warehouse.import",
        commandId: request.params.commandId,
        params: {
          sourceFolders: [...request.params.sourceFolders],
          ...(request.params.autoGenerate === undefined
            ? {}
            : { autoGenerate: request.params.autoGenerate }),
        },
      };
    // bdl-commands v0.4 下载采纳(IMP-3):仅身份请求原样映射
    case "warehouse.importDownloads":
      return { ...base, kind: "command", method: "warehouse.importDownloads", commandId: request.params.commandId, params: { downloadIds: [...request.params.downloadIds] } };

    // production-use-case v0.2(W20 ten-method, W24 workbench): verbatim pass-through
    case "recipe.save":
      return {
        ...base,
        kind: "command",
        method: "recipe.save",
        commandId: `rec-${crypto.randomUUID()}`,
        params: request.params,
      };
    case "recipe.resolve":
      return {
        ...base,
        kind: "command",
        method: "recipe.resolve",
        commandId: `res-${crypto.randomUUID()}`,
        params: request.params,
      };
    case "plan.approve":
      return {
        ...base,
        kind: "command",
        method: "plan.approve",
        commandId: `apv-${crypto.randomUUID()}`,
        params: request.params,
      };
    case "job.execute":
      return {
        ...base,
        kind: "command",
        method: "job.execute",
        commandId: `job-${crypto.randomUUID()}`,
        params: request.params,
      };
    case "recipe.get":
      return { ...base, kind: "query", method: "recipe.get", params: { recipeId: request.params.recipeId } };
    case "recipe.list":
      return { ...base, kind: "query", method: "recipe.list", params: request.params };
    // 029 B 面(桌面环 4 消费批):recipe-export v0.1 同步只读 Query verbatim
    // 透传;实现域未接线 = vua.recipe_export.unavailable 诚实缺席,未注册路径
    // = vua.project.project_not_found 原样透传(024 判例,缺席语义不折叠)
    case "recipe.exportProjectDraft":
      return { ...base, kind: "query", method: "recipe.exportProjectDraft", params: { projectPath: request.params.projectPath } };
    case "plan.get":
      return { ...base, kind: "query", method: "plan.get", params: { planId: request.params.planId } };
    case "plan.list":
      return { ...base, kind: "query", method: "plan.list", params: request.params };
    case "record.get":
      return { ...base, kind: "query", method: "record.get", params: { buildId: request.params.buildId } };
    case "record.list":
      return { ...base, kind: "query", method: "record.list", params: request.params };
    case "project.import-copy":
      return {
        ...base,
        kind: "command",
        method: "project.import-copy",
        commandId: `imp-${crypto.randomUUID()}`,
        params: request.params,
      };
    // project-ops v0.2 setNote(D-6 接线):任务化受理,回执携带 taskId
    case "project.setNote":
      return {
        ...base,
        kind: "command",
        method: "project.setNote",
        commandId: `note-${crypto.randomUUID()}`,
        params: request.params,
      };
    // M7 检查切片消费批(inspection-queries v0.1):读面参数 verbatim 透传;
    // provider 未接线=vua.inspection.unavailable 类型化缺席,原样透传
    case "inspection.get":
      return {
        ...base,
        kind: "query",
        method: "inspection.get",
        params: { inspectionId: request.params.inspectionId },
      };
    case "inspection.list":
      return { ...base, kind: "query", method: "inspection.list", params: request.params };
    // 023 消费切片:交接命令 verbatim 透传(params 闭集单键 buildId,信封
    // 校验已在 isDesktopGatewayRequestV1);实现域未接线=Provider 回类型化
    // vua.release_handoff.unavailable,本路由原样透传(缺席语义不折叠)
    case "release.openForHandoff":
      return { ...base, kind: "command", method: "release.openForHandoff", commandId: request.requestId, params: request.params };
    // release-handoff v0.2(U19 桌面对齐批):独立检视入口同律 verbatim
    // 透传——路由准入(减状态闸)与错误闭集权威全在 Provider,本路由零折叠;
    // 实现域未接线=Provider 回 vua.release_handoff.unavailable 诚实缺席
    case "release.openForInspection":
      return { ...base, kind: "command", method: "release.openForInspection", commandId: request.requestId, params: request.params };
  }
}

/** 未知素材引用的 Kernel 侧应用错误(渲染层呈现可发现失败) */
class UnknownMaterialSourceError extends Error {
  readonly refId: string;
  constructor(refId: string) {
    super(`unknown material source: ${refId}`);
    this.refId = refId;
  }
}

export async function routeDesktopGatewayInvoke(
  context: DesktopGatewayRouteContext,
  senderUrl: string,
  request: unknown,
): Promise<DesktopGatewayResponseV1> {
  if (!isAllowedLocalSender(senderUrl, context.rendererUrl)) throw new Error("untrusted renderer origin");

  const requestId = requestIdFrom(request);
  if (requestByteLength(request) > DESKTOP_GATEWAY_MAX_REQUEST_BYTES || !isDesktopGatewayRequestV1(request)) {
    return failure(requestId, "invalid_request", "errors.gateway.invalidRequest");
  }

  try {
    let applicationRequest: ApplicationRequestV01;
    try {
      applicationRequest = toApplicationRequest(request, context.resolveMaterialSource);
    } catch (error) {
      if (error instanceof UnknownMaterialSourceError) {
        // 未知素材引用:Kernel 侧应用错误(诚实失败,渲染层可发现)
        return {
          schemaVersion: DESKTOP_GATEWAY_VERSION,
          requestId: request.requestId,
          ok: false,
          error: {
            code: "application",
            application: {
              contractVersion: APPLICATION_CONTRACT_VERSION,
              code: "vua.material.source_unknown",
              category: "validation",
              messageKey: "errors.material.sourceUnknown",
              recoverable: false,
              retryable: false,
              correlationId: request.requestId,
            },
          },
        };
      }
      throw error;
    }
    const providerResponse = await context.provider.invoke(applicationRequest);
    if (!providerResponse.ok) {
      // 应用错误原样透传:本地化键、可重试与可恢复判定引用契约原值
      return {
        schemaVersion: DESKTOP_GATEWAY_VERSION,
        requestId: request.requestId,
        ok: false,
        error: { code: "application", application: providerResponse.error },
      };
    }
    if (request.method === "app.snapshot") {
      if (!isApplicationSnapshot(providerResponse.value)) {
        return failure(request.requestId, "internal", "errors.gateway.invalidProviderResponse");
      }
      return {
        schemaVersion: DESKTOP_GATEWAY_VERSION,
        requestId: request.requestId,
        ok: true,
        value: {
          schemaVersion: 1,
          productVersion: context.productVersion,
          runtime: "electron",
          platform: context.platform,
          capabilities: {
            gateway: true,
            tasks: capabilityAvailable(providerResponse.value, TASK_LIST_CAPABILITY),
            // BOARD #36 缺陷①修复(2026-09-18):provider 能力行原样透传,
            // 不再整段丢弃——此前信封只保留旧三布尔,读 capabilities.
            // operations 的页面(包管理器等)served_capabilities gate 恒空
            // (#22 live/fixture 形状分裂教训:消费切片 mock 带行,live
            // 信封没有,测试全绿真机不通)。
            operations: providerResponse.value.capabilities.operations,
            // §11 仲裁 (a):内嵌浏览能力归壳自报(preload capabilities),
            // provider 不报告也不转述。信封值与壳自报同源引用单一事实源
            // (shell-capabilities;#36 缺陷4′ 对齐——硬编码 false 与壳自报
            // true 是同一能力的两个矛盾桌面声明,已消灭)。能力面开放属
            // 功能决策,另行走登记(壳侧呈现随 preload 自报翻转)
            remoteBrowser: SHELL_CAPABILITIES.remoteBrowser,
          },
        },
      };
    }
    // 其余方法:应用契约值原样作为 Gateway 返回值(方法表已保证形状)
    return {
      schemaVersion: DESKTOP_GATEWAY_VERSION,
      requestId: request.requestId,
      ok: true,
      value: providerResponse.value,
    };
  } catch (error) {
    // #27 诊断留痕(诚实失败可查):调用链异常(Provider 不可达/帧协议错误/
    // 路由失败)先落诊断通道再返回统一 unavailable——主进程控制台
    // (dev 链 stdio inherit)直接可见具体断点,不再静默吞错
    process.stderr.write(
      `${JSON.stringify({
        channel: "gateway-invoke",
        method: request.method,
        requestId: request.requestId,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      })}\n`,
    );
    return failure(request.requestId, "internal", "errors.gateway.providerUnavailable");
  }
}

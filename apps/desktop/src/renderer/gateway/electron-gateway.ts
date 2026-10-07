import { createLiveDeploymentPort } from "./live-deployment-port.ts";
import { createLiveNetworkPort } from "./live-network-port.ts";
import type { ApplicationEventV01, TaskEventV01 } from "@vua/contracts";
import type { StoredGoalsV1 } from "../app/onboarding-model.ts";
import { projectEnvironmentSnapshot, projectTaskItem } from "./contract-projection.ts";
import { emptyGateway } from "./empty-gateway.ts";
import { createGatewayClient, type DesktopGatewayHost, type GatewayClient } from "./gateway-client.ts";
import type { EnvironmentPort, EnvironmentView, FixPlanResult } from "./environment-port.ts";
import type { VuaGateway } from "./gateway.ts";
import { createLiveAcquire } from "./live-acquire-port.ts";
import { createWarehouseCommands } from "./warehouse-commands-live.ts";
import { createLiveProjectOps } from "./project-ops-port.ts";
import { createLiveModelProduction } from "./live-production-port.ts";
import { createLiveProductionChainPort } from "./production-chain-port.ts";
import { createLiveRecipeExportPort } from "./recipe-export-port.ts";
import { createLiveDependenciesPort } from "./dependencies-port.ts";
import { createLivePackages } from "./packages-live.ts";
import { createLiveInspectionPort } from "../features/inspection/inspection-port-live.ts";
import { createLiveReleaseHandoffPort } from "../features/release/release-handoff-port-live.ts";
import { createLiveReleaseProjectOpenPort } from "../features/release/release-project-open-port-live.ts";
import type { TaskCenterView, TaskPort } from "./task-port.ts";
import type { CapabilityReport, DataSource } from "./types.ts";

/**
 * Electron live Gateway(F2/F-3):任务中心、环境快照与生产纵向七方法经
 * Kernel 直达应用层;其余领域仍为 not-run 诚实空态,随所属纵向切片逐个
 * 接入(页面零重写)。
 * 断连语义:首帧取数失败向上抛出(GatewayProvider 呈现诚实失败 + 重试);
 * 订阅期间取数失败保留上一视图,恢复由下一次事件或用户重试驱动。
 */

function isTaskEvent(event: ApplicationEventV01): event is TaskEventV01 {
  return event.kind !== "capability.changed";
}

function createLiveTaskPort(client: GatewayClient): TaskPort {
  const fetchView = async (): Promise<TaskCenterView> => {
    const result = await client.invoke({
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      method: "task.list",
      params: {},
    });
    // overlay.getSnapshot 入联合后(017 批 1)tasks 键不再唯一:task.list
    // 回执带聚合 revision,overlay 读面纯函数纪律不带——以双键分派定位,
    // 不做字段猜测
    if (!result.ok || !("revision" in result.value) || !("tasks" in result.value)) {
      throw new Error("task_list_unavailable");
    }
    return { schemaVersion: 1, tasks: result.value.tasks.map(projectTaskItem) };
  };
  const refreshBestEffort = async (): Promise<TaskCenterView> => {
    try {
      return await fetchView();
    } catch {
      return { schemaVersion: 1, tasks: [] };
    }
  };
  return {
    snapshot: fetchView,
    subscribe(callback) {
      // 事件只是事实通知;权威状态一律经 task.list 重取(契约"revision 与事件")
      return client.subscribe((event) => {
        if (!isTaskEvent(event)) return;
        void fetchView().then(callback, () => {
          /* 断连期间保留上一视图 */
        });
      });
    },
    async cancel(taskId) {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "task.requestCancellation",
        params: { taskId, commandId: crypto.randomUUID() },
      });
      if (result.ok) return { kind: "ok", view: await refreshBestEffort() };
      if (result.error.kind === "application") {
        return {
          kind: "rejected",
          reason: result.error.error.code === "vua.task.not_found" ? "unknown_task" : "not_cancellable",
          view: await refreshBestEffort(),
        };
      }
      return { kind: "rejected", reason: "unavailable", view: await refreshBestEffort() };
    },
    async retry(taskId) {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "download.retry",
        params: { taskId, commandId: crypto.randomUUID() },
      });
      if (result.ok && "decision" in result.value) {
        return {
          kind: "ok",
          decision: result.value.decision as "resume" | "retry",
        };
      }
      if (!result.ok && result.error.kind === "application") {
        const code = result.error.error.code;
        return {
          kind: "rejected",
          reason: code === "vua.task.not_found"
            ? "unknown_task"
            : code === "vua.download.not_retryable" ? "not_retryable" : "unavailable",
        };
      }
      return { kind: "rejected", reason: "unavailable" };
    },
    async capability() {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "app.snapshot",
        params: {},
      });
      if (!result.ok || !("capabilities" in result.value) || !("tasks" in result.value.capabilities)) {
        return { state: "unavailable", detailKey: "taskEngineMissing" };
      }
      return result.value.capabilities.tasks
        ? { state: "ready" }
        : { state: "unavailable", detailKey: "taskEngineMissing" };
    },
  };
}

function createLiveEnvironmentPort(client: GatewayClient): EnvironmentPort {
  const fetchView = async (): Promise<EnvironmentView> => {
    const result = await client.invoke({
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      method: "environment.getSnapshot",
      params: {},
    });
    // capturedAt 是环境快照在 ApplicationSuccessValueV01 union 中的唯一
    // 顶层键(026 A1 冻结批 packages-ops plan 臂也带 items,"items" in 守卫
    // 不再唯一收窄——A1 TS 面落地连带修复,桌面域,2026-09-19)
    if (!result.ok || !("capturedAt" in result.value)) throw new Error("environment_snapshot_unavailable");
    return projectEnvironmentSnapshot(result.value);
  };
  return {
    deployment: createLiveDeploymentPort(client),
    network: createLiveNetworkPort(client),
    snapshot: fetchView,
    subscribe(callback) {
      // 契约 v0.1 尚无环境事件;capability.changed 时重取快照保持新鲜
      return client.subscribe((event) => {
        if (event.kind !== "capability.changed") return;
        void fetchView().then(callback, () => {
          /* 断连期间保留上一视图 */
        });
      });
    },
    // 检测执行命令属 F6/B6;能力不可用时入口不出现。live 数据源=真实检测
    // 快照(E3 切片):runCheck=触发刷新(重取快照;C-ENV 状态机语义保留,
    // 只换数据源——fixture 的模拟 running→results 迁移不在 live 复制)
    runCheck: () =>
      fetchView(),
    async planFix(): Promise<FixPlanResult> {
      return { kind: "unavailable" };
    },
    async capability(): Promise<CapabilityReport> {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "environment.getSnapshot",
        params: {},
      });
      return result.ok
        ? { state: "ready" }
        : { state: "unavailable", detailKey: "detectorsMissing" };
    },
  };
}

/** Kernel 宿主完整面:gateway/events 供 client,dialog 供素材来源选取与仓储导入拾取 */
export interface DesktopKernelHost extends DesktopGatewayHost {
  dialog?: {
    pickMaterialSource(
      intake: "direct_unity_package" | "local_reusable_vpm",
    ): Promise<{ refId: string; displayName: string } | null>;
    /** 仓储导入文件夹多选(W18):取消或空选 null */
    pickWarehouseFolders?(): Promise<readonly string[] | null>;
  };
}

export function createElectronGateway(
  host: DesktopKernelHost | undefined,
  initialGoals: StoredGoalsV1 | null,
): VuaGateway {
  const client = createGatewayClient(host);
  const notRun = emptyGateway(initialGoals);
  // F3(F-3):生产纵向七方法经 live 端口走 Kernel 路由(运行视图由任务
  // 生命周期推导,文档按引用查询);图谱/分享码/卡片墙仍走 notRun 退路,
  // 随所属切片接入(只换实现,视图与端口形状不动)
  const liveModelProduction = createLiveModelProduction(client, host, notRun.modelProduction);
  // F4-6:本地轨条目面(warehouse.listEntries/entryDetail)经 live 端口走
  // Kernel 路由;查询失败回落诚实 not-connected,不阻断启动
  const liveAcquire = createLiveAcquire(client);
  // F4-9:warehouse 写命令面(bdl-commands v0.1)经 live 端口走 Kernel 路由
  const liveWarehouseCommands = createWarehouseCommands(client);
  return {
    environment: createLiveEnvironmentPort(client),
    task: createLiveTaskPort(client),
    tutorial: notRun.tutorial,
    modelProduction: liveModelProduction,
    toolCatalog: notRun.toolCatalog,
    settings: notRun.settings,
    acquire: liveAcquire,
    warehouseCommands: liveWarehouseCommands,
    projectOps: createLiveProjectOps(client),
    // 019 批 C:生产链七方法 live 消费(解析/计划/任务/记录;两套 UI 共用)
    productionChain: createLiveProductionChainPort(host),
    // 029 B 面环 4:配方导出 live 消费(recipe.exportProjectDraft 同步只读;
    // 实现域未接线 = vua.recipe_export.unavailable 诚实缺席)
    recipeExport: createLiveRecipeExportPort(client),
    // bdl-queries v0.5 消费准备切片:依赖反查/观察列 live 消费(两方法只读;
    // 核心接线批升信封常量与路由臂前,provider 答类型化 unknown_method →
    // 缺席臂诚实缺席,控制不渲染,零伪造线索/建议)
    dependencies: createLiveDependenciesPort(client),
    // M7 检查切片消费批:inspection.get/list 读面经 Kernel 直达 provider;
    // 未接线=vua.inspection.unavailable 诚实缺席
    inspection: createLiveInspectionPort(client),
    // 023 消费切片:release.openForHandoff 经 Kernel 直达 provider;实现域
    // 未接线=路由恒答 vua.release_handoff.unavailable 诚实缺席
    releaseHandoff: createLiveReleaseHandoffPort(client),
    // U19 第二交付:「在 Unity 中打开以检查/修复」独立路径经 Kernel 直达
    // provider——核心 open 检查入口(路由/合同面)已入库(release-handoff
    // v0.2,合并 09a4423f),本装配点按冻结回执形状换 live 实现(第 156 批
    // 对表接线);实现域未接线=路由恒答 vua.release_handoff.unavailable
    // 诚实缺席
    releaseProjectOpen: createLiveReleaseProjectOpenPort(client),
    // 024 P1 中间诚实态消费批:packages.listInstalled 经 Kernel 直达
    // provider;引擎未装配/实现域未接线 = vua.packages.unavailable 诚实
    // 缺席(notRun 空态维持),repos/变更面 P1 无词表维持不可渲染
    packages: createLivePackages(client),
    dataSource: (): DataSource => "live",
  };
}

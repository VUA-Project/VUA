import { createInactiveTutorialPort } from "./tutorial-port.ts";
import { createAmfModulePort } from "./amf-module-port.ts";
import { createMemorySettingsPort } from "./settings-port.ts";
import type { AcquireEntryDetailView, AcquirePort, AcquireView } from "./acquire-port.ts";
import type { WarehouseCommandsPort } from "./warehouse-commands-port.ts";
import { createEmptyProjectOps } from "./project-ops-port.ts";
import { createUnavailableProductionChainPort } from "./production-chain-port.ts";
import { createUnavailableRecipeExportPort } from "./recipe-export-port.ts";
import { createUnavailableDependenciesPort } from "./dependencies-port.ts";
import type { InspectionPort } from "../features/inspection/inspection-port.ts";
import type { ReleaseHandoffPort } from "../features/release/release-handoff-port.ts";
import { createAbsentReleaseProjectOpenPort } from "../features/release/release-project-open-port.ts";
import type {
  CatalogBrowserPort,
  CatalogDetailView,
  CatalogListView,
} from "./catalog-browser-port.ts";
import type { CatalogStatus } from "./catalog.ts";
import type { EnvironmentPort, EnvironmentView } from "./environment-port.ts";
import { neverChecked } from "../features/deployer/deployer-model.ts";
import type { ModelProductionPort, ModelProductionView } from "./model-production-port.ts";
import type { PackagesPort, PackagesView } from "./packages-port.ts";
import type { TaskPort } from "./task-port.ts";
import type { ToolCatalogPort, ToolCatalogView } from "./tool-catalog-port.ts";
import type { VuaGateway } from "./gateway.ts";
import type { CapabilityReport, DataSource } from "./types.ts";
import type { StoredGoalsV1 } from "../app/onboarding-model.ts";

/**
 * not-run 诚实实现(G3):任何构建模式下都安全的默认 Gateway。
 * 所有领域返回空态,页面据此呈现"尚未检测/尚未接入"(原则①);
 * capability 一律 unavailable,由入口显隐表达,不渲染虚构按钮。
 * 生产构建的唯一实现;DEV 下显式 ?scenario=not-run 也走这里。
 */

const unavailable: CapabilityReport = { state: "unavailable", detailKey: "detectorsMissing" };

const environmentView: EnvironmentView = {
  schemaVersion: 1,
  deployer: neverChecked(),
  // 版本源未接入:空数组,表现层整块不渲染(§2.6 不出现,而非虚构数据)
  versions: { play: [], create: [] },
};

const modelProductionView: ModelProductionView = {
  schemaVersion: 1,
  workshop: { kind: "idle" },
  // F3 生产纵向流程:未接入,诚实 not-connected
  productionRun: { schemaVersion: 1, kind: "not-connected" },
};

/** F3 生产命令依赖任务引擎;未接入时以 taskEngineMissing 说明 */
const productionUnavailable: CapabilityReport = {
  state: "unavailable",
  detailKey: "taskEngineMissing",
};

const toolCatalogView: ToolCatalogView = { schemaVersion: 1, kind: "not-connected" };

const acquireView: AcquireView = { schemaVersion: 1, kind: "not-connected" };
const acquireEntryNotConnected: AcquireEntryDetailView = { schemaVersion: 1, kind: "not-connected" };

function createEmptyAcquire(): AcquirePort {
  return {
    snapshot: () => Promise.resolve(acquireView),
    entryDetail: () => Promise.resolve(acquireEntryNotConnected),
    subscribe: () => () => {},
    capability: () => Promise.resolve(unavailable),
  };
}

/** F4-9 写命令面:not-run 时写命令诚实 unavailable(错误词表同 live) */
function createEmptyWarehouseCommands(): WarehouseCommandsPort {
  const unavailableOutcome = {
    ok: false as const,
    error: {
      kind: "application" as const,
      code: "vua.warehouse.unavailable",
      messageKey: "errors.warehouse.unavailable",
      recoverable: true,
      retryable: false,
    },
  };
  return {
    setArtifactMode: () => Promise.resolve(unavailableOutcome),
    generateVpm: () => Promise.resolve(unavailableOutcome),
    deleteOriginals: () => Promise.resolve(unavailableOutcome),
    deleteOriginalsByProduct: () => Promise.resolve(unavailableOutcome),
    setGlobalDefaultMode: () => Promise.resolve(unavailableOutcome),
    importFolders: () => Promise.resolve(unavailableOutcome),
    importDownloads: () => Promise.resolve(unavailableOutcome),
    capability: () => Promise.resolve(unavailable),
  };
}

const packagesView: PackagesView = { schemaVersion: 1, kind: "not-connected" };

function createEmptyPackages(): PackagesPort {
  return {
    snapshot: () => Promise.resolve(packagesView),
    subscribe: () => () => {},
    selectProject: () => Promise.resolve(packagesView),
    listInstalled: () => Promise.resolve({ kind: "unavailable" }),
    packageCatalog: () => Promise.resolve({ kind: "unavailable" }),
    // F2 读面(027):同读面缺席纪律——恒缺席,不伪造仓库级包目录
    repoCatalog: () => Promise.resolve({ kind: "unavailable" }),
    // F5 读面(027):同读面缺席纪律——恒缺席,不伪造模板枚举
    listTemplates: () => Promise.resolve({ kind: "unavailable" }),
    // A1 写面(026):模拟/空退路面永不模拟 wire 写回执——恒缺席臂
    previewRemove: () => Promise.resolve({ kind: "unavailable" }),
    applyRemove: () => Promise.resolve({ kind: "unavailable" }),
    // A2 写面(026 v0.2):同 A1 纪律——恒缺席臂
    previewInstall: () => Promise.resolve({ kind: "unavailable" }),
    applyInstall: () => Promise.resolve({ kind: "unavailable" }),
    // A3 写面(026 v0.3):同 A1 纪律——恒缺席臂
    registerLocalPackage: () => Promise.resolve({ kind: "unavailable" }),
    // A4 写面(026 v0.4 仓库订阅增删):同 A1 纪律——恒缺席臂
    addRemoteRepo: () => Promise.resolve({ kind: "unavailable" }),
    addLocalRepo: () => Promise.resolve({ kind: "unavailable" }),
    removeRepo: () => Promise.resolve({ kind: "unavailable" }),
    // A5 写面(026 v0.5 项目创建):同 A1 纪律——恒缺席臂
    createProject: () => Promise.resolve({ kind: "unavailable" }),
    // F4 写面(027 v0.6 仓库生命周期):同 A1 纪律——恒缺席臂;原
    // setRepoEnabled 本地假翻转退役,本地状态绝不冒充 wire 写面
    enableRepo: () => Promise.resolve({ kind: "unavailable" }),
    disableRepo: () => Promise.resolve({ kind: "unavailable" }),
    refreshRepo: () => Promise.resolve({ kind: "unavailable" }),
    addProject: () => Promise.resolve({ kind: "unavailable" }),
    importLocalPackage: () => Promise.resolve({ kind: "unavailable" }),
    previewChanges: () => Promise.resolve({ kind: "unavailable" }),
    applyChanges: () => Promise.resolve({ kind: "unavailable" }),
    capability: () =>
      Promise.resolve<CapabilityReport>({
        state: "unavailable",
        detailKey: "packagesEngineMissing",
      }),
  };
}

function createEmptyEnvironment(): EnvironmentPort {
  return {
    snapshot: () => Promise.resolve(environmentView),
    subscribe: () => () => {},
    runCheck: () => Promise.resolve(environmentView),
    planFix: () => Promise.resolve({ kind: "unavailable" }),
    capability: () => Promise.resolve(unavailable),
  };
}

function createEmptyModelProduction(): ModelProductionPort {
  return {
    snapshot: () => Promise.resolve(modelProductionView),
    subscribe: () => () => {},
    recipeGraph: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    importShareCode: () => Promise.resolve({ kind: "unavailable" }),
    exportShareCode: () => Promise.resolve({ kind: "unavailable" }),
    releaseWall: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    // F3:Kernel 文件对话框与 production.* 均未接入,入口由 capability 显隐
    pickMaterial: () => Promise.resolve(null),
    startInspection: () => Promise.resolve({ kind: "unavailable" }),
    getInspection: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    requestPlan: () => Promise.resolve({ kind: "unavailable" }),
    getPlan: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    confirmPlan: () => Promise.resolve({ kind: "unavailable" }),
    recover: () => Promise.resolve({ kind: "unavailable" }),
    getBuildRecord: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    capability: () =>
      Promise.resolve({ overall: unavailable, production: productionUnavailable }),
  };
}

function createEmptyToolCatalog(): ToolCatalogPort {
  return {
    snapshot: () => Promise.resolve(toolCatalogView),
    subscribe: () => () => {},
    capability: () => Promise.resolve(unavailable),
  };
}

function createEmptyTask(): TaskPort {
  const view = { schemaVersion: 1, tasks: [] } as const;
  return {
    snapshot: () => Promise.resolve(view),
    subscribe: () => () => {},
    cancel: () => Promise.resolve({ kind: "rejected", reason: "unknown_task", view }),
    // 下载域未接入:重试意图诚实不可用
    retry: () => Promise.resolve({ kind: "rejected", reason: "unavailable" }),
    capability: () => Promise.resolve({ state: "unavailable", detailKey: "taskEngineMissing" }),
  };
}

/** M7 消费批:not-run 时检查读面诚实缺席(not-connected),不伪装空证据。
 *  fixture 场景同用此实现——检查证据是观察事实,DEV 演示不制造合成证据束
 *  (productionChain「无模拟替代」纪律同构) */
export function createEmptyInspection(): InspectionPort {
  return {
    list: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    get: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
  };
}

/** M7 消费切片:not-run 时交接命令诚实缺席(缺席语义,绝不伪造受理)。
 *  fixture 场景同用此实现——交接是观察事实命令,DEV 演示不制造合成受理
 *  (productionChain「无模拟替代」纪律同构) */
export function createAbsentReleaseHandoffPort(): ReleaseHandoffPort {
  return {
    openForHandoff: () => Promise.resolve({ kind: "absent" }),
    taskSnapshot: () => Promise.resolve(null),
  };
}

const catalogListView: CatalogListView = { schemaVersion: 1, kind: "not-connected" };
const catalogDetailView: CatalogDetailView = { schemaVersion: 1, kind: "not-connected" };

/**
 * 目录浏览 not-connected 实现(G8):生产构建的默认——目录能力未接入时
 * Warehouse 呈现诚实空态("尚未接入"),不返回猜测商品(§2.6 禁止)。
 */
export function createEmptyCatalogBrowser(): CatalogBrowserPort {
  return {
    list: () => Promise.resolve(catalogListView),
    detail: () => Promise.resolve(catalogDetailView),
    status: () => Promise.resolve<CatalogStatus>({ health: "unknown" }),
    // v0.7 文件清单:not-connected 恒 absent(诚实缺席,不伪造空清单)
    productDownloadables: () => Promise.resolve({ kind: "absent" }),
    capability: () =>
      Promise.resolve<CapabilityReport>({ state: "unavailable", detailKey: "catalogMissing" }),
  };
}

/** dataSource 恒为 "none":不携带任何 fixture 负载,生产安全 */
export function emptyGateway(initialGoals: StoredGoalsV1 | null = null): VuaGateway {
  const source: DataSource = "none";
  return {
    amfModule: createAmfModulePort(),
    environment: createEmptyEnvironment(),
    tutorial: createInactiveTutorialPort(),
    modelProduction: createEmptyModelProduction(),
    toolCatalog: createEmptyToolCatalog(),
    acquire: createEmptyAcquire(),
    warehouseCommands: createEmptyWarehouseCommands(),
    projectOps: createEmptyProjectOps(),
    // 019 批 C:not-run 时生产链诚实不可用(不渲染虚构推进入口)
    productionChain: createUnavailableProductionChainPort(),
    // 029 B 面环 4:配方导出 not-run 诚实缺席(不伪造草稿)
    recipeExport: createUnavailableRecipeExportPort(),
  recipe: {
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    save: () => Promise.reject(new Error("not connected")),
  },
    // bdl-queries v0.5 消费准备切片:依赖反查/观察列 not-run 诚实缺席
    // (不伪造线索/建议;缺席臂 = 能力缺席控制不渲染先例)
    dependencies: createUnavailableDependenciesPort(),
    inspection: createEmptyInspection(),
    // 023 消费切片:交接命令诚实缺席(不伪造受理/任务快照)
    releaseHandoff: createAbsentReleaseHandoffPort(),
    // U19 第二交付:open 检查入口 not-run 诚实缺席——路由已入库(v0.2),
    // 此处缺席语义=无宿主/未接入,非结构缺席;不伪造受理/任务快照
    releaseProjectOpen: createAbsentReleaseProjectOpenPort(),
    packages: createEmptyPackages(),
    task: createEmptyTask(),
    settings: createMemorySettingsPort(initialGoals),
    dataSource: () => source,
  };
}

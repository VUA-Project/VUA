import { format, strings, termLabel } from "../i18n/index.ts";
import { fixtureStrings } from "../i18n/strings.fixtures.zh-CN.ts";
import type { CheckItem, CheckZone, VersionTrack, ZoneCheckResult, ZonePhase } from "../features/deployer/deployer-model.ts";
import type { LogEntry, StageNode } from "../features/workshop/track-model.ts";
import type { FixtureName } from "../app/resolve-scenario.ts";
import type { StoredGoalsV1 } from "../app/onboarding-model.ts";
import { createInactiveTutorialPort } from "./tutorial-port.ts";
import { createMemorySettingsPort } from "./settings-port.ts";
import { fixtureRecipeGraph } from "./fixture-recipes.ts";
import { fixtureReleaseWall } from "./fixture-release.ts";
import { fixtureWorkshopReplay } from "./fixture-workshop.ts";
import { createAcquireFixtureStore } from "./fixture-acquire.ts";
import { createFixtureProjectOps } from "./fixture-project-ops.ts";
import { createFixturePackages } from "./fixture-packages.ts";
import { createFixtureWarehouseCommands } from "./fixture-warehouse-commands.ts";
import { createSignal } from "./fixture-signal.ts";
import { createFixtureProduction, type ProductionTaskLink } from "./fixture-production.ts";
import type { EnvironmentPort, EnvironmentView, FixPlanResult } from "./environment-port.ts";
import type { FixPlanV1 } from "../features/deployer/fix-plan-model.ts";
import type { ModelProductionPort, ModelProductionView } from "./model-production-port.ts";
import { createUnavailableProductionChainPort } from "./production-chain-port.ts";
import { createUnavailableRecipeExportPort } from "./recipe-export-port.ts";
import { createUnavailableDependenciesPort } from "./dependencies-port.ts";
import type { PackagesPort, PackagesView } from "./packages-port.ts";
import type { TaskItem, TaskPort } from "./task-port.ts";
import type { TaskCenterView } from "./task-port.ts";
import type { ToolCard, ToolCatalogPort, ToolCatalogView, ToolCategory } from "./tool-catalog-port.ts";
import type { VuaGateway } from "./gateway.ts";
import type { CapabilityReport, DataSource } from "./types.ts";
import { createEmptyInspection } from "./empty-gateway.ts";
import { createAbsentReleaseHandoffPort } from "./empty-gateway.ts";
import { createAbsentReleaseProjectOpenPort } from "../features/release/release-project-open-port.ts";

/**
 * fixture 实现(G3,仅 DEV 构建可达——见 App.tsx 的 DEV 硬防线,
 * 生产构建中本模块被 Rollup 剔除,check:leak 验证)。
 * 数据模拟真实数据源负载:不代表真实环境状态,界面必须以"演示数据"
 * 徽标明确标识,禁止在任何安全相关结论中引用(原则①)。
 * 文案纪律:负载文案集中在 i18n/strings.fixtures.zh-CN.ts。
 */

/* ---- 演示负载(自 scenario-fixtures 迁移) ---- */

const checks = fixtureStrings.checks;

const mixedChecks: CheckItem[] = [
  {
    id: "vrchat",
    zone: "play",
    title: checks.vrchat.title,
    status: "ok",
    description: checks.vrchat.okDescription,
  },
  {
    // Unity 行携带引擎词表 checkId(CREATE_GATE_IDS 消费引擎 id 闭集):
    // fixture 模拟真实数据源负载,id 词表与引擎 inspect_zone 对齐
    id: "unity_editors",
    zone: "create",
    title: checks.unity.title,
    status: "ok",
    description: checks.unity.okDescription,
  },
  {
    id: "vpm",
    zone: "create",
    title: checks.vpm.title,
    status: "error",
    description: checks.vpm.errorDescription,
    fixLabel: checks.vpm.fixLabel,
  },
  {
    id: "vr-runtime",
    zone: "play",
    title: checks.vrRuntime.title,
    status: "warning",
    description: checks.vrRuntime.warningDescription,
    fixLabel: checks.vrRuntime.fixLabel,
  },
  {
    id: "disk",
    zone: "create",
    title: checks.disk.title,
    status: "ok",
    description: checks.disk.okDescription,
  },
  {
    id: "network",
    zone: "play",
    title: checks.network.title,
    status: "ok",
    description: checks.network.okDescription,
  },
];

const allGreenChecks: CheckItem[] = mixedChecks.map(
  // exactOptionalPropertyTypes:从原项剥离 fixLabel 键而不是写 undefined
  ({ fixLabel: _omitted, ...rest }: CheckItem): CheckItem => ({
    ...rest,
    status: "ok",
    description:
      rest.id === "vpm"
        ? checks.vpm.okDescription
        : rest.id === "vr-runtime"
          ? checks.vrRuntime.okDescription
          : rest.description,
  }),
);

const runningStages: StageNode[] = [
  { id: "warehouse", label: termLabel("warehouse"), state: "completed" },
  { id: "recipe", label: termLabel("recipe"), state: "completed" },
  { id: "assembly", label: termLabel("assembly"), state: "completed" },
  { id: "production", label: termLabel("production"), state: "current" },
  { id: "inspection", label: termLabel("inspection"), state: "pending" },
  { id: "release", label: termLabel("release"), state: "pending" },
];

const runningLogTimes = ["10:24:31", "10:24:40", "10:25:02", "10:25:10"] as const;

const runningLog: LogEntry[] = fixtureStrings.workshop.logs.map((text, index) => ({
  time: runningLogTimes[index] ?? "10:25:10",
  text,
}));

const runningWorkshop = {
  kind: "running",
  headline: format(fixtureStrings.workshop.headline, { stage: termLabel("production") }),
  stages: runningStages,
  log: runningLog,
} as const;

/* ---- 修复计划演示负载(C-ENV):版本化 FixPlanV1,checkId 对应检测项 ---- */

const fixtureFixPlans: Record<string, FixPlanV1> = {
  vpm: {
    schemaVersion: 1,
    planId: "fixture-fix-vpm",
    checkId: "vpm",
    title: fixtureStrings.fixPlans.vpm.title,
    impact: fixtureStrings.fixPlans.vpm.impact,
    steps: [
      {
        kind: "confirm-candidate",
        id: "identify",
        title: fixtureStrings.fixPlans.vpm.identify,
        description: "",
        candidates: [...fixtureStrings.fixPlans.vpm.identifyCandidates],
      },
      {
        kind: "external-link",
        id: "download",
        title: fixtureStrings.fixPlans.vpm.openDownload,
        description: fixtureStrings.fixPlans.vpm.openDownloadDescription,
        url: "https://vrchat.com/home/download",
      },
      {
        kind: "manual",
        id: "install",
        title: fixtureStrings.fixPlans.vpm.runInstaller,
        description: fixtureStrings.fixPlans.vpm.runInstallerDescription,
      },
      {
        kind: "recheck",
        id: "recheck",
        title: fixtureStrings.fixPlans.vpm.recheck,
        description: fixtureStrings.fixPlans.vpm.recheckDescription,
      },
    ],
  },
  "vr-runtime": {
    schemaVersion: 1,
    planId: "fixture-fix-vr-runtime",
    checkId: "vr-runtime",
    title: fixtureStrings.fixPlans.vrRuntime.title,
    impact: fixtureStrings.fixPlans.vrRuntime.impact,
    steps: [
      {
        kind: "external-link",
        id: "guide",
        title: fixtureStrings.fixPlans.vrRuntime.openGuide,
        description: fixtureStrings.fixPlans.vrRuntime.openGuideDescription,
        url: "https://help.steampowered.com/zh-cn/faqs/view/0E2C-406B-9135-38A4",
      },
      {
        kind: "manual",
        id: "follow",
        title: fixtureStrings.fixPlans.vrRuntime.followGuide,
        description: fixtureStrings.fixPlans.vrRuntime.followGuideDescription,
      },
      {
        kind: "recheck",
        id: "recheck",
        title: fixtureStrings.fixPlans.vrRuntime.recheck,
        description: fixtureStrings.fixPlans.vrRuntime.recheckDescription,
      },
    ],
  },
};

/* ---- 任务演示负载(demo-tasks) ---- */

// 走查#4 四语化:任务标题/说明改按当前语言动词模板组合,实体名保持原文
const titleCopy = strings.taskTitles;
const demoName = { assembly: "Summer_Uniform", downloadActive: "Summer_Uniform_ADDONS ver2.0", downloadInterrupted: "Miko_Dress_fix ver1.1", downloadCancelled: "Stage_Props_pack ver0.9", downloadPolicyRefused: "tool_installer.exe" };

const demoTasks: TaskItem[] = [
  {
    id: "task-assembly",
    title: format(titleCopy.assembly, { name: demoName.assembly }),
    status: "running",
    progress: { done: 42, total: 100 },
    originPage: "workshop",
    cancellable: true,
  },
  {
    id: "task-envcheck",
    title: titleCopy.envCheck,
    status: "completedWithWarnings",
    originPage: "env-create",
    cancellable: false,
    errorText: titleCopy.envCheckWarning,
  },
  {
    id: "task-scan",
    title: titleCopy.warehouseScan,
    status: "completed",
    originPage: "warehouse",
    cancellable: false,
  },
  /* F4-7 下载任务链走查载体:下载生命周期五态(下载中/中断/重试/取消/失败)
   * 经任务中心统一九态呈现(任务中心零特判,F4-4 裁定)。中断 = failed +
   * 可续传说明(重试入口的呈现条件),策略拒绝 = failed + 拒绝说明
   * (不可重试),均由任务级动作交 AMF 裁决,fixture 端口镜像同一语义。 */
  {
    id: "task-download-active",
    title: format(titleCopy.download, { name: demoName.downloadActive }),
    status: "running",
    progress: { done: 34, total: 100 },
    originPage: "warehouse",
    cancellable: true,
  },
  {
    id: "task-download-interrupted",
    title: format(titleCopy.download, { name: demoName.downloadInterrupted }),
    status: "failed",
    originPage: "warehouse",
    cancellable: false,
    errorText: titleCopy.downloadInterruptedNote,
  },
  {
    id: "task-download-cancelled",
    title: format(titleCopy.download, { name: demoName.downloadCancelled }),
    status: "cancelled",
    originPage: "warehouse",
    cancellable: false,
  },
  {
    id: "task-download-policy",
    title: format(titleCopy.download, { name: demoName.downloadPolicyRefused }),
    status: "failed",
    originPage: "warehouse",
    cancellable: false,
    errorText: titleCopy.downloadPolicyRefusedNote,
  },
];

/* ---- 版本轨道演示负载(S-XV)---- */

const versionCopy = fixtureStrings.versions;

/** 版本事实为演示负载(界面随页面挂"演示数据"徽标),不代表真实环境;
 *  state 结论由数据源给出(词法比较不做语义猜测),与真实端口同一契约 */
const fixtureVersions: Record<CheckZone, VersionTrack[]> = {
  play: [
    {
      id: "vrchat",
      title: versionCopy.vrchat,
      installed: "2025.3.1",
      latest: "2025.3.2",
      checkedAt: "2026-08-28T09:40:00+08:00",
      state: "update-available",
    },
    {
      id: "steamvr",
      title: versionCopy.steamvr,
      installed: "2.12.4",
      latest: "2.12.4",
      checkedAt: "2026-08-28T09:40:00+08:00",
      state: "up-to-date",
    },
  ],
  create: [
    {
      id: "unity",
      title: versionCopy.unity,
      installed: "2022.3.22f1",
      latest: "2022.3.22f1",
      checkedAt: "2026-08-28T09:40:00+08:00",
      state: "up-to-date",
    },
    {
      id: "vrcsdk",
      title: versionCopy.vrcsdk,
      installed: "3.7.2",
      latest: "3.8.1",
      checkedAt: "2026-08-27T21:15:00+08:00",
      state: "update-available",
    },
  ],
};

/* ---- 领域端口 fixture 实现 ---- */

function createFixtureEnvironment(
  items: CheckItem[],
  options: { startFresh?: boolean; failZones?: readonly CheckZone[]; settleMs?: number } = {},
): EnvironmentPort {
  const { startFresh = false, failZones = [], settleMs = 1200 } = options;
  const resultsFor = (zone: CheckZone, checkedAt: string): ZoneCheckResult => ({
    items: items.filter((item) => item.zone === zone),
    checkedAt,
  });
  const lastOf = (phase: ZonePhase): ZoneCheckResult | null => {
    if (phase.kind === "results") return { items: phase.items, checkedAt: phase.checkedAt };
    if (phase.kind === "running" || phase.kind === "failed") return phase.last;
    return null;
  };
  const zones: Record<CheckZone, ZonePhase> = startFresh
    ? { play: { kind: "not-run" }, create: { kind: "not-run" } }
    : {
        play: { kind: "results", ...resultsFor("play", "2026-08-25T10:20:00+08:00") },
        create: { kind: "results", ...resultsFor("create", "2026-08-25T10:20:00+08:00") },
      };
  const signal = createSignal<EnvironmentView>({
    schemaVersion: 1,
    deployer: { zones },
    versions: fixtureVersions,
  });
  return {
    snapshot: () => Promise.resolve(signal.get()),
    subscribe: signal.subscribe,
    // fixture 驱动完整状态机供走查(C-ENV):runCheck → running →(settleMs)→
    // results / failed。数据仍是演示负载(界面挂"演示数据"徽标),不代表真实
    // 环境(原则①);capability 为 ready 以便走查入口出现,与 empty 实现区分。
    runCheck: (zone) => {
      const current = signal.get().deployer.zones;
      const running: ZonePhase = {
        kind: "running",
        startedAt: new Date().toISOString(),
        last: lastOf(current[zone]),
      };
      signal.set({
        schemaVersion: 1,
        deployer: { zones: { ...current, [zone]: running } },
        versions: fixtureVersions,
      });
      setTimeout(() => {
        const zonesNow = signal.get().deployer.zones;
        const next: ZonePhase = failZones.includes(zone)
          ? { kind: "failed", last: lastOf(zonesNow[zone]) }
          : { kind: "results", ...resultsFor(zone, new Date().toISOString()) };
        signal.set({
          schemaVersion: 1,
          deployer: { zones: { ...zonesNow, [zone]: next } },
          versions: fixtureVersions,
        });
      }, settleMs);
      return Promise.resolve(signal.get());
    },
    planFix: (checkId): Promise<FixPlanResult> => {
      const plan = fixtureFixPlans[checkId];
      return Promise.resolve(plan ? { kind: "ok", plan } : { kind: "unknown-check" });
    },
    capability: () => Promise.resolve<CapabilityReport>({ state: "ready" }),
  };
}

function createFixtureModelProduction(workshop: ModelProductionView["workshop"]): ModelProductionPort {
  const view: ModelProductionView = {
    schemaVersion: 1,
    workshop,
    // F3 生产纵向流程:非 production-* 场景不接入(fixture 功能场景门控,
    // 同 demo-packages 先例),production 能力 unavailable,入口不出现
    productionRun: { schemaVersion: 1, kind: "not-connected" },
  };
  return {
    snapshot: () => Promise.resolve(view),
    subscribe: () => () => {},
    // Recipe 图谱(C-RECIPE):fixture 适配 derive 自内嵌文档副本
    // (fixture-recipes-data.ts);"current" → rich 场景,未知 id 诚实 not-connected
    recipeGraph: (recipeId) => Promise.resolve(fixtureRecipeGraph(recipeId)),
    importShareCode: () => Promise.resolve({ kind: "unavailable" }),
    exportShareCode: () => Promise.resolve({ kind: "unavailable" }),
    // Release 卡片墙(C-RECIPE-3):fixture 演示项目,覆盖健康/漂移/缺依赖
    releaseWall: () => Promise.resolve(fixtureReleaseWall()),
    pickMaterial: () => Promise.resolve(null),
    startInspection: () => Promise.resolve({ kind: "unavailable" }),
    getInspection: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    requestPlan: () => Promise.resolve({ kind: "unavailable" }),
    getPlan: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    confirmPlan: () => Promise.resolve({ kind: "unavailable" }),
    recover: () => Promise.resolve({ kind: "unavailable" }),
    getBuildRecord: () => Promise.resolve({ schemaVersion: 1, kind: "not-connected" }),
    capability: () =>
      Promise.resolve({
        overall: { state: "ready" },
        production: { state: "unavailable", detailKey: "taskEngineMissing" },
      }),
  };
}

function createFixtureToolCatalog(): ToolCatalogPort {
  // C-TOOLS:演示目录五件,覆盖三用途分组与已装/未装组合;
  // 名称/用途/数据去向/维护者负载集中在 strings.fixtures.zh-CN.ts,
  // 分组键即 category(词表不进入字符串值,避免 check-leak 指纹误报)
  const tools: ToolCard[] = (
    Object.entries(fixtureStrings.tools) as Array<[ToolCategory, readonly unknown[]]>
  ).flatMap(([category, items]) =>
    items.map((item) => ({ ...(item as Omit<ToolCard, "category">), category })),
  );
  const view: ToolCatalogView = { schemaVersion: 1, kind: "catalog", tools };
  return {
    snapshot: () => Promise.resolve(view),
    subscribe: () => () => {},
    capability: () => Promise.resolve<CapabilityReport>({ state: "ready" }),
  };
}

/**
 * fixture 获取端口(C-ACQUIRE,F4-6 条目模型):
 * demo-acquire-empty 走查"空仓库"的诚实空态;其余场景给四条目混合负载
 * (两 kind / 三检查状态 / 两副本角色 / 模式覆盖与跟随全局)。
 */
/** fixture 任务端口:较 TaskPort 多出 DEV 演示回放(仅 demo-tasks 场景提供) */
export interface FixtureTaskPort extends TaskPort {
  /** 按时间序列驱动装配任务状态迁移,演示订阅链路;任务不存在时无操作 */
  replayDemoEvents?: () => void;
}

interface FixtureTaskHandle {
  port: FixtureTaskPort;
  /** F3 生产 fixture 的任务联动(命令创建/迁移/取消回调) */
  link: ProductionTaskLink;
}

function createFixtureTask(withTasks: boolean): FixtureTaskHandle {
  const initial: TaskCenterView = { schemaVersion: 1, tasks: withTasks ? demoTasks : [] };
  const signal = createSignal<TaskCenterView>(initial);

  const updateTask = (taskId: string, patch: Partial<TaskItem>) => {
    const view = signal.get();
    if (!view.tasks.some((task) => task.id === taskId)) return;
    signal.set({
      schemaVersion: 1,
      tasks: view.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    });
  };

  const upsertTask = (task: TaskItem) => {
    const view = signal.get();
    signal.set({
      schemaVersion: 1,
      tasks: view.tasks.some((item) => item.id === task.id)
        ? view.tasks.map((item) => (item.id === task.id ? task : item))
        : [...view.tasks, task],
    });
  };

  let cancelHandler: ((taskId: string) => void) | null = null;

  const port: FixtureTaskPort = {
    snapshot: () => Promise.resolve(signal.get()),
    subscribe: signal.subscribe,
    // F4-7:镜像 AMF 重试裁决(download.retry 冻结语义)——仅中断可续传的
    // 下载任务放行(resume = 同一 attempt 延续,回到 running 且可取消);
    // 策略拒绝与其余任务如实 not_retryable,未知任务 unknown_task
    retry: (taskId) => {
      const view = signal.get();
      if (!view.tasks.some((item) => item.id === taskId)) {
        return Promise.resolve({ kind: "rejected" as const, reason: "unknown_task" as const });
      }
      if (taskId !== "task-download-interrupted") {
        return Promise.resolve({ kind: "rejected" as const, reason: "not_retryable" as const });
      }
      updateTask(taskId, { status: "running", cancellable: true });
      return Promise.resolve({ kind: "ok" as const, decision: "resume" as const });
    },
    cancel: (taskId) => {
      const view = signal.get();
      const task = view.tasks.find((item) => item.id === taskId);
      if (!task) return Promise.resolve({ kind: "rejected" as const, reason: "unknown_task" as const, view });
      if (!task.cancellable) {
        return Promise.resolve({ kind: "rejected" as const, reason: "not_cancellable" as const, view });
      }
      updateTask(taskId, { status: "cancelled", cancellable: false });
      // F3:通知生产 fixture 联动(当前运行标记已取消);未注入时无操作
      cancelHandler?.(taskId);
      return Promise.resolve({ kind: "ok" as const, view: signal.get() });
    },
    capability: () => Promise.resolve<CapabilityReport>({ state: "ready" }),
  };

  if (withTasks) {
    port.replayDemoEvents = () => {
      // F4-7:装配任务与下载任务各走一遍 queued→…→completed 迁移,
      // 演示任务中心的订阅链路与下载生命周期推进(下载半拍错开)
      const steps: Array<Partial<TaskItem>> = [
        { status: "queued", cancellable: true },
        { status: "preparing" },
        { status: "running", progress: { done: 0, total: 100 } },
        { status: "running", progress: { done: 50, total: 100 } },
        { status: "completed", progress: { done: 100, total: 100 }, cancellable: false },
      ];
      steps.forEach((patch, index) => {
        setTimeout(() => updateTask("task-assembly", patch), index * 900);
        setTimeout(() => updateTask("task-download-active", patch), index * 900 + 450);
      });
    };
  }
  return {
    port,
    link: {
      upsertTask,
      patchTask: updateTask,
      setCancelHandler: (handler) => {
        cancelHandler = handler;
      },
    },
  };
}

/* ---- 包管理(S-XVI):占位端口,fixture 本体随后续切片(fixture-packages)接入 ---- */

const stubPackagesView: PackagesView = { schemaVersion: 1, kind: "not-connected" };

function createStubPackages(): PackagesPort {
  return {
    snapshot: () => Promise.resolve(stubPackagesView),
    subscribe: () => () => {},
    selectProject: () => Promise.resolve(stubPackagesView),
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

/* ---- 场景装配 ---- */

/**
 * fixture Gateway 装配(仅 DEV)。dataSource 恒为 "fixture",
 * 界面据此挂"演示数据"徽标。
 */
export function fixtureGateway(
  name: FixtureName,
  initialGoals: StoredGoalsV1 | null = null,
  envOptions: { settleMs?: number; failZones?: readonly CheckZone[] } = {},
  productionOptions: { settleMs?: number } = {},
): VuaGateway & { task: FixtureTaskPort } {
  const green =
    name === "demo-all-green" || name.startsWith("demo-workshop") || name.startsWith("production-");
  // 车间(C-WORKSHOP):四盘回放带覆盖成功/警告/阻断/恢复;空态由
  // demo-all-green 承载;其余场景保留原静态 running 演示
  const workshop =
    name === "demo-all-green"
      ? ({ kind: "idle" } as const)
      : (fixtureWorkshopReplay(name) ?? runningWorkshop);
  const source: DataSource = "fixture";
  // 环境辖区场景(C-ENV):fresh = 两辖区从未检测,走查完整状态机;
  // fail = 检测必定失败,走查 failed 态与旧证据保留;其余场景直接出结果
  const envFresh = name === "demo-env-fresh" || name === "demo-env-fail";
  const envFailZones: readonly CheckZone[] =
    envOptions.failZones ?? (name === "demo-env-fail" ? ["play", "create"] : []);
  const taskHandle = createFixtureTask(name === "demo-tasks");
  // F3 生产纵向流程(production-* 场景):脚本化时间线驱动 run 视图并联动任务端口;
  // 其余场景回落基础 fixture(production 能力 unavailable,入口不出现)
  const production = createFixtureProduction(name, taskHandle.link, productionOptions);
  // F4-9:条目演示数据升级为共享 store(命令走查联动);写命令演示守卫语义
  // 并联动任务中心,任务联动仅在 demo-tasks 场景接线(同任务演示门控)
  const acquireStore = createAcquireFixtureStore(name === "demo-acquire-empty");
  const warehouseCommands = createFixtureWarehouseCommands(acquireStore, {
    ...(name === "demo-tasks" ? { taskLink: taskHandle.link } : {}),
  });
  return {
    environment: createFixtureEnvironment(green ? allGreenChecks : mixedChecks, {
      startFresh: envFresh,
      failZones: envFailZones,
      // exactOptionalPropertyTypes:未配置时不写 settleMs 键
      ...(envOptions.settleMs !== undefined ? { settleMs: envOptions.settleMs } : {}),
    }),
    tutorial: createInactiveTutorialPort(),
    modelProduction: production ?? createFixtureModelProduction(workshop),
    toolCatalog: createFixtureToolCatalog(),
    acquire: acquireStore.port,
    warehouseCommands,
    projectOps: createFixtureProjectOps(),
    // 019 批 C:fixture 不模拟生产链(验收标准——无模拟替代未完成接口);
    // 任何场景下生产链端口都诚实不可用,DEV 切档不产生演示生产数据
    productionChain: createUnavailableProductionChainPort(),
    // 029 B 面环 4:配方导出 fixture 臂诚实缺席(mock/fixture 不出 DEV;
    // 演示工程登记不含导出词表,不伪造草稿)
    recipeExport: createUnavailableRecipeExportPort(),
  recipe: {
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    save: () => Promise.reject(new Error("fixture gateway")),
  },
    // bdl-queries v0.5 消费准备切片:依赖反查/观察列 fixture 臂诚实缺席
    // (mock/fixture 不出 DEV;库内无演示依赖观察事实,不伪造线索/建议)
    dependencies: createUnavailableDependenciesPort(),
    // M7 消费批:fixture 不制造合成检查证据束(观察事实纪律同构)——
    // inspection 端口任何场景下诚实缺席,检查页呈现 not-connected 空态
    inspection: createEmptyInspection(),
    // 023 消费切片:交接命令诚实缺席(观察事实命令,DEV 演示不制造合成受理)
    releaseHandoff: createAbsentReleaseHandoffPort(),
    // U19 第二交付:open 检查入口诚实缺席(观察事实命令——路由已入库
    // v0.2,DEV 演示仍不制造合成打开受理/合成检视事实;live 基线消费)
    releaseProjectOpen: createAbsentReleaseProjectOpenPort(),
    // 包管理(S-XVI):demo-packages 场景接完整 fixture;其余场景保持
    // not-connected 占位(同 demo-tasks 的功能场景门控先例)
    packages: name === "demo-packages" ? createFixturePackages() : createStubPackages(),
    task: taskHandle.port,
    settings: createMemorySettingsPort(initialGoals),
    dataSource: () => source,
  };
}

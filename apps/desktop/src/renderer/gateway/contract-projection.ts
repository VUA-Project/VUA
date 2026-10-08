import { format } from "../i18n/index.ts";
import {
  isTerminalTaskStateV01,
  type EnvironmentCheckItemV01,
  type EnvironmentPresenceV01,
  type EnvironmentSnapshotV01,
  type TaskSnapshotV01,
  type TaskStateV01,
} from "@vua/contracts";
import type { TaskStatus } from "../app/task-status.ts";
import {
  CHECK_GROUPS,
  type CheckItem,
  type CheckStatus,
  type CheckZone,
  type DeployerView,
} from "../features/deployer/deployer-model.ts";
import type { EnvironmentView } from "./environment-port.ts";
import type { WorkflowRunState } from "./workflow.ts";
import type { TaskItem } from "./task-port.ts";
import { taskIdentityOf } from "./task-identity.ts";
import { strings } from "../i18n/index.ts";

/**
 * 契约 → 表现层投影(契约"与表现层的衔接"一节):
 * 投射必须穷尽——契约新增状态而本表未覆盖时编译失败,而不是静默落默认分支。
 * 投射不改变契约事实:缓存与诊断一律引用契约原值。
 */

/** 任务九态 → 表现层九态;`satisfies` 保证契约每个状态都有唯一投射 */
const TASK_STATE_PROJECTION = {
  queued: "queued",
  preparing: "preparing",
  running: "running",
  waiting_for_input: "waitingInput",
  paused: "paused",
  succeeded: "completed",
  succeeded_with_warnings: "completedWithWarnings",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Readonly<Record<TaskStateV01, TaskStatus>>;

export function projectTaskState(state: TaskStateV01): TaskStatus {
  return TASK_STATE_PROJECTION[state];
}

/**
 * TaskSnapshotV01 → 任务中心条目。
 * - title:契约 v0.1 尚无标题负载(F3 首个真实用例引入),不发明 wire 字段;
 *   渲染层发起操作的命令受理已登记身份的任务用登记标题,演示任务给本地化
 *   标签,其余任务如实给类型词「后台任务」——W25 走查 D1 修复:裸 taskId
 *   不再充当标题(投影不到的事实不编造描述,宁可显示类型词);
 * - originPage:登记身份携带真实来源页,未登记回落 warehouse(生产着陆;
 *   原回落 home 随指挥台页退役改置,2026-09-25 用户裁决);
 * - cancellable:由应用层事实派生(未请求取消且非终态),前端不自行猜测;
 * - errorText:契约错误码(工程事实);显示层另加本地化说明，原码保留。
 */
export function projectTaskItem(task: TaskSnapshotV01): TaskItem {
  const identity = taskIdentityOf(task.taskId);
  return {
    id: task.taskId,
    title:
      identity?.title ??
      (task.taskId.startsWith("demo-") ? strings.taskCenter.demoTaskTitle : strings.taskCenter.unlabeledTask),
    status: projectTaskState(task.state),
    originPage: identity?.originPage ?? "warehouse",
    cancellable: !task.cancellationRequested && !isTerminalTaskStateV01(task.state),
    ...(identity?.notifyOnComplete === true ? { notifyOnComplete: true } : {}),
    ...(task.error === undefined ? {} : { errorText: task.error.code }),
    // 重启恢复(M2):遗留非终态任务如实标注,前端不得当作仍在执行。
    // 处置只对非终态有意义——终态(含被重同步取代的 cancelled)按其终态
    // 呈现,不再盖"请先检查中断的任务"文案(真机 2026-10-02:取消后的
    // 孤儿任务仍显示检查提示,通知永不清除的观感由此而来)
    ...(task.recoveryDisposition === "inspect_required" &&
      !isTerminalTaskStateV01(task.state)
      ? { errorText: "inspect_required" }
      : {}),
  };
}

/**
 * 在场事实 → 部署器严重度的消费侧缺省裁决(契约明确严重度由消费侧决定):
 * detected → ok,not_detected → warning,detection_failed → error。
 * 替代组(CHECK_GROUPS)成员在投影后由 applyCheckGroups 按组满意度二次裁决。
 * F6 环境切片引入检查项文案注册表后,此缺省由注册表替换。
 */
const PRESENCE_SEVERITY: Readonly<Record<EnvironmentPresenceV01, CheckStatus>> = {
  detected: "ok",
  not_detected: "warning",
  detection_failed: "error",
};

/** checkId → 替代组 id(注册表派生;未注册的检查项不属于任何组) */
const CHECK_GROUP_OF: ReadonlyMap<string, string> = new Map(
  CHECK_GROUPS.flatMap((group) => group.memberIds.map((memberId) => [memberId, group.id] as const)),
);

function projectCheckItem(item: EnvironmentCheckItemV01): CheckItem {
  const groupId = CHECK_GROUP_OF.get(item.checkId);
  return {
    id: item.checkId,
    zone: item.zone,
    title: checkTitle(item.checkId),
    status: PRESENCE_SEVERITY[item.presence],
    // 状态词本地化(用户实测缺口 #31 修复 2026-09-16):presence 投影为
    // 四语状态词;error_code 仅 DetectionFailed 携带(引擎契约),属工程
    // 事实码保留，并附本地化观测状态；词表外原因不猜测。
    description: item.errorCode == null ? presenceText(item.presence) : format(strings.diagnostics.statusWithCode, { status: presenceText(item.presence), code: item.errorCode }),
    // exactOptionalPropertyTypes:无组项不写 groupId 键
    ...(groupId === undefined ? {} : { groupId }),
  };
}

/**
 * 替代组二次裁决(消费侧,组内任一项可用即满足整组):
 * 组已被满足时,其余未检测到成员由 warning 降为 info 中性项
 * (未安装的可选项,不是待办);detection_failed 成员保持 error
 * 原样呈现——观测失败是事实,不因组满足而隐藏(诚实纪律)。
 * 组未满足时成员维持 warning,由汇总层把整组计为一项待办。
 */
function applyCheckGroups(items: CheckItem[]): CheckItem[] {
  const satisfied: ReadonlySet<string> = new Set(
    CHECK_GROUPS.filter((group) =>
      items.some((item) => item.groupId === group.id && item.status === "ok"),
    ).map((group) => group.id as string),
  );
  return items.map((item) => {
    if (item.groupId === undefined || !satisfied.has(item.groupId)) return item;
    if (item.status !== "warning") return item;
    return { ...item, status: "info", description: strings.deployer.presence.optional };
  });
}

/** presence 三词闭集 → 四语状态词(strings.deployer.presence.*) */
function presenceText(presence: EnvironmentPresenceV01): string {
  const copy = strings.deployer.presence;
  switch (presence) {
    case "detected": return copy.detected;
    case "not_detected": return copy.notDetected;
    case "detection_failed": return copy.detectionFailed;
  }
}

/* ---- 检查项卡片标题(用户实测缺口修复 2026-09-12,环境侧 wt-6 留言:
 *  disk_space 双区呈现后卡片 title 原为 checkId 透传;2026-09-16 #31 补齐
 *  引擎 id 闭集其余 6 项——brand runtime 五项＋gpu;2026-09-18 品牌面扩展
 *  再增 psvr2/bigscreen_beyond/pimax_runtime/varjo_runtime/hp_omnicept
 *  五项)。消费侧文案注册表:
 *  键覆盖引擎当前 id 闭集(engine environment.rs inspect_zone,disk_space
 *  双区同 id);引擎新增 id 而本表未收录时如实透传 checkId——不猜测、
 *  不伪造标题。 ---- */

/** 检查 id → 四语文案键(strings.deployer.checks.*);导出供键一致性
 *  机器检查消费(查表被 as unknown as 断言绕过类型检查,缺键会静默
 *  透传裸 id,#31 家族,2026-09-28 组卡先例)。 */
export const CHECK_TITLE_KEYS: Readonly<Record<string, string>> = {
  steam: "steam",
  vrchat: "vrchat",
  steamvr: "steamvr",
  openxr_runtime: "openxrRuntime",
  oculus_runtime: "oculusRuntime",
  pico_runtime: "picoRuntime",
  vive_runtime: "viveRuntime",
  virtual_desktop: "virtualDesktop",
  alvr: "alvr",
  psvr2: "psvr2",
  pimax_runtime: "pimaxRuntime",
  varjo_runtime: "varjoRuntime",
  bigscreen_beyond: "bigscreenBeyond",
  hp_omnicept: "hpOmnicept",
  gpu: "gpu",
  network: "network",
  windows: "windows",
  disk_space: "diskSpace",
  unity_hub: "unityHub",
  unity_editors: "unityEditors",
  vpm: "vpm",
  vcc: "vcc",
};

function checkTitle(checkId: string): string {
  const key = CHECK_TITLE_KEYS[checkId];
  const checks = strings.deployer.checks as unknown as Readonly<Record<string, string>>;
  const localized = key === undefined ? undefined : checks[key];
  return localized ?? checkId;
}

/**
 * 环境快照 → 部署器视图:两个辖区各自独立呈现;辖区无检查项时仍给出
 * "results + 空列表"(检测确实执行过),由 summarizeHealth 呈现诚实空态。
 * 版本轨道未接入(版本源属 F6/B6),整块为空数组,表现层不渲染。
 */
export function projectEnvironmentSnapshot(snapshot: EnvironmentSnapshotV01): EnvironmentView & { deployer: DeployerView } {
  const byZone = (zone: CheckZone) =>
    applyCheckGroups(snapshot.items.filter((item) => item.zone === zone).map(projectCheckItem));
  return {
    schemaVersion: 1,
    deployer: {
      zones: {
        play: { kind: "results", items: byZone("play"), checkedAt: snapshot.capturedAt },
        create: { kind: "results", items: byZone("create"), checkedAt: snapshot.capturedAt },
      },
    },
    versions: { play: [], create: [] },
  };
}

/* ---- 生产运行状态投影(F3 live;production-use-case v0.1〔M3 冻结〕生命周期-任务映射) ----
 * 任务九态是唯一权威事实:运行视图的阶段由"命令角色 × 任务九态"推导,
 * 不由前端虚构细粒度阶段(原则①)。快照/导入/验证同属 execute 命令的
 * 执行链,九态不区分链内阶段——运行态停在链的粗粒度表达上,任务中心的
 * 进度与事件仍是细粒度事实的唯一来源。 */

/** 当前生产命令在运行视图中的角色(命令 → 工作流阶段锚点) */
export type ProductionTaskRole = "inspect" | "plan" | "execute" | "recover";

/**
 * 角色 × 任务九态 → WorkflowRunState;两维都必须穷尽(satisfies 编译锁定)。
 * - cancelled 九态不在此表表达终态:取消是任务事实,运行视图经 run.cancelled
 *   呈现,runState 保留取消发生的最后阶段(角色基准态);
 * - failed 九态经 projectWorkflowRunState 按 recoveryDisposition 细分
 *   failed / failed_recoverable;
 * - waiting_for_input 是运行级"等待用户"事实:plan/recover 角色对应
 *   工作流的用户等待点(待确认 / 恢复决定),inspect/execute 角色无
 *   用户等待点,回落角色基准态。
 */
const WORKFLOW_RUN_STATE_PROJECTION: Readonly<
  Record<ProductionTaskRole, Readonly<Record<TaskStateV01, WorkflowRunState>>>
> = {
  inspect: {
    queued: "inspect",
    preparing: "inspect",
    running: "inspect",
    waiting_for_input: "inspect",
    paused: "inspect",
    succeeded: "inspect",
    succeeded_with_warnings: "inspect",
    failed: "failed",
    cancelled: "inspect",
  },
  plan: {
    queued: "plan",
    preparing: "plan",
    running: "plan",
    waiting_for_input: "await_confirmation",
    paused: "plan",
    succeeded: "await_confirmation",
    succeeded_with_warnings: "await_confirmation",
    failed: "failed",
    cancelled: "plan",
  },
  execute: {
    queued: "snapshot",
    preparing: "snapshot",
    running: "execute",
    waiting_for_input: "execute",
    paused: "execute",
    succeeded: "completed",
    succeeded_with_warnings: "completed",
    failed: "failed",
    cancelled: "execute",
  },
  recover: {
    queued: "recover",
    preparing: "recover",
    running: "recover",
    waiting_for_input: "failed_recoverable",
    paused: "recover",
    succeeded: "completed",
    succeeded_with_warnings: "completed",
    failed: "failed",
    cancelled: "recover",
  },
};

/** 任务快照 → 运行阶段(inspect_required = 需用户恢复决定 → failed_recoverable) */
export function projectWorkflowRunState(role: ProductionTaskRole, task: TaskSnapshotV01): WorkflowRunState {
  if (task.state === "failed" && task.recoveryDisposition === "inspect_required") {
    return "failed_recoverable";
  }
  return WORKFLOW_RUN_STATE_PROJECTION[role][task.state];
}

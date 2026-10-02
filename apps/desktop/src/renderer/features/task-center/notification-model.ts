/**
 * 通知中心呈现模型(proposal 007 路径 B,核心两条件下):
 * - 任务权威(SQLite 九态)与快照面不动;通知 = 终态任务的呈现层投影;
 * - 默认只显示活动任务(核心条件二前半:重启后终态任务默认不再作为通知);
 * - 「显示已完成」开启时,未被用户清除的终态任务作为通知显示,并逐条提供清除;
 * - 已清除集合(localStorage 持久化)只影响呈现——任务权威事实仍可经任务
 *   列表/详情面查询(核心条件一:清除的是通知,不是事实)。
 */
import { storageKeys } from "../../app/storage-keys.ts";
import type { TaskStatus } from "../../app/task-status.ts";
import type { TaskItem } from "../../gateway/index.ts";

const TERMINAL: readonly TaskStatus[] = [
  "completed",
  "completedWithWarnings",
  "failed",
  "cancelled",
];

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.includes(status);
}

/** 通知列表投影:活动任务恒显;终态任务需「显示已完成」开启且未被清除 */
export function visibleNotifications(
  tasks: readonly TaskItem[],
  dismissed: ReadonlySet<string>,
  showCompleted: boolean,
): readonly TaskItem[] {
  // notifyOnComplete(用户裁决 2026-10-02):短任务的完成通知保留到手动
  // 清除——默认"终态不显示"对秒级完成的任务是零反馈。同族只保留最新
  // 一条:一次会话多次短任务(如反复库同步)不该堆出完成通知山;旧任务
  // 事实仍可经任务列表/详情面查询(清除的是通知,不是事实)。
  const persistent = tasks
    .filter((task) => task.notifyOnComplete === true && !dismissed.has(task.id))
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  const latestPersistentId = persistent[0]?.id ?? null;
  return tasks.filter((task) => {
    if (dismissed.has(task.id)) return false;
    if (task.notifyOnComplete === true) return task.id === latestPersistentId;
    return showCompleted || !isTerminalStatus(task.status);
  });
}

/** 清除动作的合法性:仅终态通知可清除(活动任务不可清除,取消走任务取消) */
export function canDismiss(task: TaskItem): boolean {
  return isTerminalStatus(task.status);
}

const ACTIVE: readonly TaskStatus[] = ["queued", "preparing", "running"];

export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE.includes(status);
}

/** 进行中任务计数:通知铃铛徽标与折叠条摘要共用同一口径 */
export function activeTaskCount(tasks: readonly TaskItem[]): number {
  return tasks.filter((task) => isActiveStatus(task.status)).length;
}

/**
 * 行打开语义(W25 走查 D2 修复):行主区点击 = 回到来源页——任务上下文与
 * 结果所在的页面。活动/终态两态共用同一行为(单一函数,无状态分支),
 * 不做静默无响应;任务详情面未建成前,来源页即任务事实的可达面
 * (design-standard §6.2:清除通知后任务事实仍可经任务面查询)。
 */
export function taskRowOpenTarget(task: TaskItem): TaskItem["originPage"] {
  return task.originPage;
}

/**
 * 滚动关闭判定(W25 真机实测第四批修复):滚动关闭手势只对面板外滚动成立。
 * 用户实测在通知面板内滚动列表会关闭整个通知中心——根因是 window 捕获阶段
 * 的 scroll 关闭监听把面板内列表滚动一并算作关闭手势。钉死语义:
 * 面板内滚动(滚轮/滚动条/键盘)→ 保持打开;面板外滚动/目标不可判定 →
 * 照 §8.9 原纪律关闭。DOM 归属判定(instanceof/contains)留在组件薄壳,
 * 判定语义在此纯函数,供 node 环境测试钉住。
 */
export function scrollClosesPanel(targetInsidePanel: boolean): boolean {
  return !targetInsidePanel;
}

/* ---- 已清除集合的持久化(localStorage;存储不可用则仅本次会话生效) ---- */

export function loadDismissedIds(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(storageKeys.notificationDismissed);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function saveDismissedId(taskId: string): ReadonlySet<string> {
  const next = new Set(loadDismissedIds());
  next.add(taskId);
  try {
    window.localStorage.setItem(storageKeys.notificationDismissed, JSON.stringify([...next]));
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
  return next;
}

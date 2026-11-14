/**
 * 通知中心呈现模型(proposal 007 路径 B,核心两条件下):
 * - 任务权威(SQLite 九态)与快照面不动;通知 = 终态任务的呈现层投影;
 * - 默认只显示活动任务(核心条件二前半:重启后终态任务默认不再作为通知);
 * - 「显示已完成」设置随 F2 移除(从未生效:会话终态集从未接入 hook),
 *   终态任务仅 notifyOnComplete 保留的最新一条可见,并逐条提供清除;
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

/** 通知列表投影:活动任务恒显;终态任务按 notifyFamily 各族保留最新一条未清除通知 */
export function visibleNotifications(
  tasks: readonly TaskItem[],
  dismissed: ReadonlySet<string>,
): readonly TaskItem[] {
  // notifyOnComplete(用户裁决 2026-10-02 + Slice 40 多族保留):短任务的完成
  // 通知保留到手动清除;按 notifyFamily(缺省 "default")分族各保留最新一条,
  // 避免库同步覆盖构建/许可证/上传回执,同时同族反复操作不堆出通知山。
  const byFamily = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    if (task.notifyOnComplete !== true || !isTerminalStatus(task.status) || dismissed.has(task.id)) continue;
    const family = task.notifyFamily ?? "default";
    const list = byFamily.get(family);
    if (list) list.push(task);
    else byFamily.set(family, [task]);
  }
  const latestPersistentIds = new Set<string>();
  for (const list of byFamily.values()) {
    list.sort((a, b) => (a.id < b.id ? 1 : -1));
    if (list[0]) latestPersistentIds.add(list[0].id);
  }
  return tasks.filter((task) => {
    if (dismissed.has(task.id)) return false;
    if (task.notifyOnComplete === true) return !isTerminalStatus(task.status) || latestPersistentIds.has(task.id);
    if (isTerminalStatus(task.status)) {
      // 终态即不显示(F2 移除「显示已完成」);任务事实仍可经任务列表查询
      return false;
    }
    return true;
  });
}

export type NotificationBellAlert = "failed" | "unseen" | null;

/** Computes bell attention state for unseen terminal task receipts or pending AI approvals. */
export function notificationBellAlert(
  notifications: readonly TaskItem[],
  pendingAiCount: number,
  seenTerminalIds: ReadonlySet<string>,
): NotificationBellAlert {
  let hasUnseenTerminal = false;
  for (const task of notifications) {
    if (!isTerminalStatus(task.status) || seenTerminalIds.has(task.id)) continue;
    if (task.status === "failed") return "failed";
    hasUnseenTerminal = true;
  }
  if (pendingAiCount > 0 || hasUnseenTerminal) return "unseen";
  return null;
}

export const MAX_DISMISSED_IDS = 512;

/**
 * Evicts only the oldest dismissed IDs when exceeding `maxEntries`.
 * Never prunes by `task.list` snapshot membership, because partial snapshots
 * during AMF startup, restart, or timeout omit AMF tasks and would otherwise
 * resurrect dismissed AMF notifications (including failed red alerts) once AMF recovers.
 */
export function pruneDismissedIds(
  dismissed: ReadonlySet<string>,
  maxEntries: number = MAX_DISMISSED_IDS,
): ReadonlySet<string> {
  const cap = Math.max(1, Math.trunc(maxEntries));
  if (dismissed.size <= cap) return dismissed;
  const items = [...dismissed];
  return new Set(items.slice(items.length - cap));
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
    const loaded = new Set(parsed.filter((id): id is string => typeof id === "string"));
    const pruned = pruneDismissedIds(loaded);
    if (pruned !== loaded) persistDismissedSet(pruned);
    return pruned;
  } catch {
    return new Set();
  }
}

export function saveDismissedId(taskId: string): ReadonlySet<string> {
  const next = new Set(loadDismissedIds());
  next.delete(taskId);
  next.add(taskId);
  const pruned = pruneDismissedIds(next);
  persistDismissedSet(pruned);
  return pruned;
}

export function persistDismissedSet(ids: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(storageKeys.notificationDismissed, JSON.stringify([...ids]));
  } catch {
    /* 存储不可用时仅本次会话生效 */
  }
}

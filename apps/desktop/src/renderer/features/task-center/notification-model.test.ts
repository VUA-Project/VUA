import assert from "node:assert/strict";
import { test } from "vitest";
import {
  activeTaskCount,
  canDismiss,
  isTerminalStatus,
  notificationBellAlert,
  pruneDismissedIds,
  scrollClosesPanel,
  taskRowOpenTarget,
  visibleNotifications,
} from "./notification-model.ts";
import type { TaskItem } from "../../gateway/index.ts";

function taskOf(id: string, status: TaskItem["status"]): TaskItem {
  return {
    id,
    title: `任务 ${id}`,
    status,
    originPage: "warehouse",
    cancellable: false,
  };
}

const tasks = [
  taskOf("t-running", "running"),
  taskOf("t-done", "completed"),
  taskOf("t-failed", "failed"),
  taskOf("t-cancelled", "cancelled"),
];

test("通知投影:默认只显示活动任务,终态不作为通知(核心条件二前半)", () => {
  const visible = visibleNotifications(tasks, new Set());
  assert.deepEqual(
    visible.map((task) => task.id),
    ["t-running"],
  );
});

test("通知投影:终态任务一律不显示(F2 移除「显示已完成」)", () => {
  // 旧语义(2026-10-06:开启显示已完成时本会话终态可见)随 F2 一并移除:
  // 终态任务只经任务列表查询,通知面板只承载活动任务与 notifyOnComplete 保留项
  const visible = visibleNotifications(tasks, new Set());
  assert.deepEqual(
    visible.map((task) => task.id),
    ["t-running"],
  );
});

test("通知投影:已清除集合只隐藏通知呈现(核心条件一)", () => {
  const dismissed = new Set(["t-failed"]);
  assert.deepEqual(
    visibleNotifications(tasks, dismissed).map((task) => task.id),
    ["t-running"],
  );
});

test("通知清除合法性:仅终态可清除,活动任务不可", () => {
  assert.equal(canDismiss(taskOf("a", "running")), false);
  assert.equal(canDismiss(taskOf("b", "preparing")), false);
  assert.equal(canDismiss(taskOf("c", "completed")), true);
  assert.equal(canDismiss(taskOf("d", "failed")), true);
  assert.equal(canDismiss(taskOf("e", "cancelled")), true);
  assert.equal(isTerminalStatus("completedWithWarnings"), true);
});

test("进行中计数:queued/preparing/running 计入,终态与等待/暂停不计", () => {
  const mixed = [
    ...tasks,
    taskOf("t-queued", "queued"),
    taskOf("t-preparing", "preparing"),
    taskOf("t-waiting", "waitingInput"),
    taskOf("t-paused", "paused"),
  ];
  assert.equal(activeTaskCount(mixed), 3);
  assert.equal(activeTaskCount([]), 0);
});

test("行打开语义(D2 回归钉):九态全列两态一致回来源页,无状态分支、无静默无响应", () => {
  const statuses: TaskItem["status"][] = [
    "queued",
    "preparing",
    "running",
    "waitingInput",
    "paused",
    "completed",
    "completedWithWarnings",
    "failed",
    "cancelled",
  ];
  for (const status of statuses) {
    // 活动态与终态走同一打开行为:行主区点击 = 回到来源页(任务上下文/结果面)
    assert.equal(taskRowOpenTarget(taskOf("t-any", status)), "warehouse");
  }
  // 目标恒为任务自身携带的来源页事实,不由状态推断改写;素材导入任务
  // 自 2026-09-20 导航重构起来源页为仓储页(导入收敛为仓储页内弹窗)
  const importTask: TaskItem = { ...taskOf("t-import", "completed"), originPage: "warehouse" };
  assert.equal(taskRowOpenTarget(importTask), "warehouse");
});

test("滚动关闭判定(W25 真机第四批回归钉):面板内滚动保持打开,面板外滚动照常关闭", () => {
  // 用户实测缺陷:在通知面板内滚动列表会关闭整个通知中心——滚动关闭
  // 手势只对面板外滚动成立;面板内滚动(滚轮/滚动条/键盘)保持打开
  assert.equal(scrollClosesPanel(true), false);
  // 面板外滚动/目标不可判定(照 §8.9 原纪律)照常关闭
  assert.equal(scrollClosesPanel(false), true);
});

test("notifyOnComplete: 终态通知保留到手动清除(用户裁决 2026-10-02)", () => {
  const done = { id: "catalog-sync-1", status: "completed" as const, title: "库同步", originPage: "warehouse" as const, cancellable: false, notifyOnComplete: true };
  // notifyOnComplete 保留项在终态后依然可见
  assert.equal(visibleNotifications([done], new Set()).length, 1);
  // 手动清除后消失
  assert.equal(visibleNotifications([done], new Set(["catalog-sync-1"])).length, 0);
  // 未声明标志的终态任务维持默认纪律
  const plain = { id: "other-1", status: "completed" as const, title: "x", originPage: "warehouse" as const, cancellable: false };
  assert.equal(visibleNotifications([plain], new Set()).length, 0);
});


test("notifyOnComplete 同族只显示最新一条(反复同步不堆通知山)", () => {
  const mk = (id: string, statusOverride?: "completed" | "running") => ({
    id,
    status: statusOverride ?? ("completed" as const),
    title: "库同步",
    originPage: "warehouse" as const,
    cancellable: false,
    notifyOnComplete: true,
  });
  const a = mk("catalog-sync-1", "completed");
  const b = mk("catalog-sync-2", "completed");
  const c = mk("catalog-sync-3", "completed");
  const visible = visibleNotifications([a, b, c], new Set());
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, "catalog-sync-3");
  // 最新一条被手动清除后,次新的一条顶上(不是整族消失)
  const afterDismiss = visibleNotifications([a, b, c], new Set(["catalog-sync-3"]));
  assert.equal(afterDismiss.length, 1);
  assert.equal(afterDismiss[0]?.id, "catalog-sync-2");
  // 运行中的任务不受此规则影响(恒显)
  const running = mk("catalog-sync-4", "running");
  const withRunning = visibleNotifications([a, b, running], new Set());
  assert.equal(withRunning.filter((t) => t.id === "catalog-sync-4").length, 1);
});

test("all active bulk downloads remain visible, regardless of completion retention", () => {
  const make = (id: string): TaskItem => ({ id, title: "Synthetic download", status: "running", originPage: "warehouse", cancellable: true, notifyOnComplete: true });
  assert.deepEqual(visibleNotifications([make("batch-a"), make("batch-z"), make("batch-b")], new Set()).map(task => task.id), ["batch-a", "batch-z", "batch-b"]);
});

test("terminal tasks never show after the Show-completed setting was removed (F2)", () => {
  const stale: TaskItem = {
    id: "t-old", title: "old", status: "completed",
    originPage: "warehouse", cancellable: false,
  };
  const visible = visibleNotifications([stale], new Set());
  assert.equal(visible.length, 0);
});

test("tasks reaching terminal during the session no longer show (F2)", () => {
  const active: TaskItem = {
    id: "t-run", title: "run", status: "running",
    originPage: "warehouse", cancellable: true,
  };
  assert.equal(visibleNotifications([active], new Set()).length, 1);
  const finished: TaskItem = { ...active, status: "failed" };
  assert.equal(visibleNotifications([finished], new Set()).length, 0);
  // notifyOnComplete 保留规则不受影响:同族终态最新一条仍可见且可清除
  const persistent: TaskItem = { ...finished, notifyOnComplete: true };
  assert.equal(visibleNotifications([persistent], new Set()).length, 1);
  assert.equal(visibleNotifications([persistent], new Set(["t-run"])).length, 0);
});

test("multi-family retention preserves the latest terminal receipt per notifyFamily, prunes stale dismissed IDs, and computes bell alerts", () => {
  const syncOld: TaskItem = { id: "sync-1", title: "Sync", status: "completed", originPage: "warehouse", cancellable: false, notifyOnComplete: true, notifyFamily: "library:sync" };
  const syncNew: TaskItem = { id: "sync-2", title: "Sync", status: "completed", originPage: "warehouse", cancellable: false, notifyOnComplete: true, notifyFamily: "library:sync" };
  const uploadFail: TaskItem = { id: "upload-1", title: "Upload", status: "failed", originPage: "release", cancellable: false, notifyOnComplete: true, notifyFamily: "amf:upload" };
  const visible = visibleNotifications([syncOld, syncNew, uploadFail], new Set());
  assert.deepEqual(visible.map((t) => t.id), ["sync-2", "upload-1"]);

  assert.equal(notificationBellAlert(visible, 0, new Set()), "failed");
  assert.equal(notificationBellAlert(visible, 0, new Set(["upload-1"])), "unseen");
  assert.equal(notificationBellAlert(visible, 0, new Set(["upload-1", "sync-2"])), null);
  assert.equal(notificationBellAlert(visible, 1, new Set(["upload-1", "sync-2"])), "unseen");

  const pruned = pruneDismissedIds(new Set(["id-1", "id-2", "id-3", "id-4"]), 2);
  assert.deepEqual([...pruned], ["id-3", "id-4"]);
  const untouched = pruneDismissedIds(new Set(["id-1", "id-2"]), 2);
  assert.equal(untouched.size, 2);
  assert.deepEqual([...untouched], ["id-1", "id-2"]);
});

test("AMF partial snapshot during startup/restart never resurrects dismissed failed AMF notifications", () => {
  const hostSync: TaskItem = {
    id: "host-sync-1",
    title: "Library sync",
    status: "completed",
    originPage: "warehouse",
    cancellable: false,
    notifyOnComplete: true,
    notifyFamily: "library:sync",
  };
  const amfFailed: TaskItem = {
    id: "amf-assemble-9",
    title: "Assemble Avatar",
    status: "failed",
    originPage: "workshop",
    cancellable: false,
    notifyOnComplete: true,
    notifyFamily: "amf:production",
  };

  // Player dismisses both terminal receipts while full snapshot is present.
  let dismissed = pruneDismissedIds(new Set(["host-sync-1", "amf-assemble-9"]));
  assert.equal(visibleNotifications([hostSync, amfFailed], dismissed).length, 0);

  // AMF restarts or times out: task.list temporarily returns only host tasks.
  dismissed = pruneDismissedIds(dismissed);
  assert.equal(dismissed.has("amf-assemble-9"), true);
  assert.equal(visibleNotifications([hostSync], dismissed).length, 0);

  // AMF recovers and returns amf-assemble-9 again: must stay dismissed and bell stays quiet.
  const recoveredVisible = visibleNotifications([hostSync, amfFailed], dismissed);
  assert.deepEqual(recoveredVisible, []);
  assert.equal(notificationBellAlert(recoveredVisible, 0, new Set()), null);
});

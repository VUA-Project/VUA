import assert from "node:assert/strict";
import { test } from "vitest";
import {
  activeTaskCount,
  canDismiss,
  isTerminalStatus,
  scrollClosesPanel,
  taskRowOpenTarget,
  visibleNotifications,
  advanceTerminalSessionSet,
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
  const visible = visibleNotifications(tasks, new Set(), false);
  assert.deepEqual(
    visible.map((task) => task.id),
    ["t-running"],
  );
});

test("通知投影:显示已完成开启时,本会话终态任务作为通知出现(2026-10-06 语义)", () => {
  // 会话集 = 这些任务在本会话内到达终态;不在集的终态(启动残留)不显示
  const terminal = new Set(["t-done", "t-failed", "t-cancelled"]);
  const visible = visibleNotifications(tasks, new Set(), true, terminal);
  assert.deepEqual(
    visible.map((task) => task.id),
    ["t-running", "t-done", "t-failed", "t-cancelled"],
  );
  // 不传会话集(启动残留形态):终态一律不显示
  const staleOnly = visibleNotifications(tasks, new Set(), true);
  assert.deepEqual(staleOnly.map((task) => task.id), ["t-running"]);
});

test("通知投影:已清除集合只隐藏通知呈现(核心条件一)", () => {
  const dismissed = new Set(["t-failed"]);
  const terminal = new Set(["t-done", "t-failed", "t-cancelled"]);
  const visible = visibleNotifications(tasks, dismissed, true, terminal);
  assert.deepEqual(
    visible.map((task) => task.id),
    ["t-running", "t-done", "t-cancelled"],
  );
  // 默认视图下同样被隐藏,且活动任务不受清除影响
  assert.deepEqual(
    visibleNotifications(tasks, dismissed, false).map((task) => task.id),
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
  // 默认(不显示已完成)下依然可见
  assert.equal(visibleNotifications([done], new Set(), false).length, 1);
  // 手动清除后消失
  assert.equal(visibleNotifications([done], new Set(["catalog-sync-1"]), false).length, 0);
  // 未声明标志的终态任务维持默认纪律
  const plain = { id: "other-1", status: "completed" as const, title: "x", originPage: "warehouse" as const, cancellable: false };
  assert.equal(visibleNotifications([plain], new Set(), false).length, 0);
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
  const visible = visibleNotifications([a, b, c], new Set(), false);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.id, "catalog-sync-3");
  // 最新一条被手动清除后,次新的一条顶上(不是整族消失)
  const afterDismiss = visibleNotifications([a, b, c], new Set(["catalog-sync-3"]), false);
  assert.equal(afterDismiss.length, 1);
  assert.equal(afterDismiss[0]?.id, "catalog-sync-2");
  // 运行中的任务不受此规则影响(恒显)
  const running = mk("catalog-sync-4", "running");
  const withRunning = visibleNotifications([a, b, running], new Set(), false);
  assert.equal(withRunning.filter((t) => t.id === "catalog-sync-4").length, 1);
});

test("startup-terminal tasks never show even with show-completed on (2026-10-06)", () => {
  const stale: TaskItem = {
    id: "t-old", title: "old", status: "completed",
    originPage: "warehouse", cancellable: false,
  };
  const terminal = advanceTerminalSessionSet(new Map(), [stale]);
  assert.equal(terminal.has("t-old"), false);
  const visible = visibleNotifications([stale], new Set(), true, terminal);
  assert.equal(visible.length, 0);
});

test("tasks reaching terminal during the session stay visible until dismissed", () => {
  const active: TaskItem = {
    id: "t-run", title: "run", status: "running",
    originPage: "warehouse", cancellable: true,
  };
  const first = advanceTerminalSessionSet(new Map(), [active]);
  assert.equal(first.size, 0);
  const finished: TaskItem = { ...active, status: "failed" };
  const terminal = advanceTerminalSessionSet(
    new Map([["t-run", "running" as const]]),
    [finished],
  );
  assert.equal(terminal.has("t-run"), true);
  const visible = visibleNotifications([finished], new Set(), true, terminal);
  assert.equal(visible.length, 1);
  const dismissed = visibleNotifications([finished], new Set(["t-run"]), true, terminal);
  assert.equal(dismissed.length, 0);
});

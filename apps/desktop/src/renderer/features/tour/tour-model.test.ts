/**
 * 应用导览模型回归(三类引导架构 §2:小型类型化步表 + 独立进度状态)。
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  TOUR_STEPS,
  normalizeStep,
  parseTourProgress,
  serializeTourProgress,
} from "./tour-model.ts";

test("步表结构:每步有唯一 id、合法页面与非空锚点选择器", () => {
  const ids = new Set(TOUR_STEPS.map((s) => s.id));
  assert.equal(ids.size, TOUR_STEPS.length);
  assert.ok(TOUR_STEPS.length >= 5, "首玩路线至少覆盖五处入口");
  for (const step of TOUR_STEPS) {
    assert.ok(step.page.length > 0, `${step.id} 页面缺失`);
    assert.ok(step.anchor.startsWith(".") || step.anchor.startsWith("["), `${step.id} 锚点须是类名/属性选择器`);
  }
});

test("首玩路线覆盖:路线选择/网络/检查/计划/任务/引导入口按序出现", () => {
  assert.deepEqual(
    TOUR_STEPS.map((s) => s.id),
    ["route", "network", "checks", "plan", "tasks", "guide"],
  );
});

test("normalizeStep:越界/非数钳回合法区间", () => {
  assert.equal(normalizeStep(0, 6), 0);
  assert.equal(normalizeStep(5, 6), 5);
  assert.equal(normalizeStep(-1, 6), 0);
  assert.equal(normalizeStep(99, 6), 5);
  assert.equal(normalizeStep(Number.NaN, 6), 0);
  assert.equal(normalizeStep(2.9, 6), 2);
  assert.equal(normalizeStep(0, 0), 0);
});

test("进度解析:合法载荷原样;形状垃圾/词表外/版本不符 → null", () => {
  assert.deepEqual(parseTourProgress('{"v":1,"status":"active","step":2}'), {
    v: 1,
    status: "active",
    step: 2,
  });
  assert.deepEqual(parseTourProgress('{"v":1,"status":"completed","step":0}'), {
    v: 1,
    status: "completed",
    step: 0,
  });
  assert.equal(parseTourProgress(null), null);
  assert.equal(parseTourProgress(undefined), null);
  assert.equal(parseTourProgress(""), null);
  assert.equal(parseTourProgress("not-json"), null);
  assert.equal(parseTourProgress('{"v":2,"status":"active","step":0}'), null);
  assert.equal(parseTourProgress('{"v":1,"status":"running","step":0}'), null);
  assert.equal(parseTourProgress('{"v":1,"status":"active","step":"2"}'), null);
  assert.equal(parseTourProgress('{"v":1,"status":"active"}'), null);
  assert.equal(parseTourProgress("[1,2]"), null);
  assert.equal(parseTourProgress("42"), null);
});

test("序列化与解析对偶;终态步号归零(不留陈旧步号)", () => {
  const active = { v: 1 as const, status: "active" as const, step: 3 };
  assert.deepEqual(parseTourProgress(serializeTourProgress(active)), active);
  const skipped = { v: 1 as const, status: "skipped" as const, step: 3 };
  assert.deepEqual(parseTourProgress(serializeTourProgress(skipped)), {
    v: 1,
    status: "skipped",
    step: 0,
  });
  const completed = { v: 1 as const, status: "completed" as const, step: 0 };
  assert.deepEqual(parseTourProgress(serializeTourProgress(completed)), completed);
});

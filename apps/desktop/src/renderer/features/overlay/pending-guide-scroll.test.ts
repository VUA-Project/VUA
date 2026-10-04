/**
 * 待滚动调度的回归(首玩 B 切片评审 P2):
 * - StrictMode 双调用:清理(取消首帧)不清标记,二次调度照常滚动;
 * - 布局未长开时滚动被钳制:执行方回 false,下一帧重试直到到位;
 * - 始终不到位:有界放弃(清标记,不死循环);
 * - 空标记不滚动。
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  classifyGuideScroll,
  guideAnchorVisible,
  guideSectionArrival,
  schedulePendingGuideScroll,
  scrollCancelsPendingGuide,
  type PendingGuideScrollDriver,
} from "./pending-guide-scroll.ts";

interface FakeDriver extends PendingGuideScrollDriver {
  calls: string[];
  marker: string | null;
  failuresLeft: number;
}

function fakeDriver(initial: string | null, failuresBeforeSuccess = 0): FakeDriver {
  const driver: FakeDriver = {
    calls: [],
    marker: initial,
    failuresLeft: failuresBeforeSuccess,
    read() {
      return this.marker;
    },
    clear() {
      this.marker = null;
    },
    scrollBodyTo(top) {
      this.calls.push(`top:${top}`);
      if (this.failuresLeft > 0) {
        this.failuresLeft -= 1;
        return false;
      }
      return true;
    },
    scrollToSection(section) {
      this.calls.push(`section:${section}`);
      if (this.failuresLeft > 0) {
        this.failuresLeft -= 1;
        return false;
      }
      return true;
    },
  };
  return driver;
}

function fakeRaf() {
  const queue = new Map<number, () => void>();
  let seq = 0;
  return {
    raf: (cb: () => void) => {
      seq += 1;
      queue.set(seq, cb);
      return seq;
    },
    cancel: (id: number) => {
      queue.delete(id);
    },
    /** 执行一帧(取队首);返回剩余帧数 */
    step: () => {
      const first = [...queue.entries()][0];
      if (!first) return 0;
      queue.delete(first[0]);
      first[1]();
      return queue.size;
    },
    flush: () => {
      for (const [, cb] of [...queue]) cb();
      queue.clear();
    },
  };
}

test("StrictMode 双调用:首次调度被取消不清标记,二次调度完成滚动", () => {
  const driver = fakeDriver("install-vrchat");
  const { raf, cancel, flush } = fakeRaf();
  const cleanup = schedulePendingGuideScroll(driver, raf, cancel);
  cleanup();
  schedulePendingGuideScroll(driver, raf, cancel);
  flush();
  assert.deepEqual(driver.calls, ["section:install-vrchat"]);
  assert.equal(driver.marker, null);
});

test("布局未长开:滚动被钳制(false)时逐帧重试直到到位", () => {
  const driver = fakeDriver("install-vrchat", 2);
  const { raf, cancel, step } = fakeRaf();
  schedulePendingGuideScroll(driver, raf, cancel);
  step(); // 第 1 帧:失败,重排
  step(); // 第 2 帧:失败,重排
  step(); // 第 3 帧:到位
  assert.deepEqual(driver.calls, [
    "section:install-vrchat",
    "section:install-vrchat",
    "section:install-vrchat",
  ]);
  assert.equal(driver.marker, null);
});

test("始终不到位:有界放弃(maxAttempts 次后清标记,不死循环)", () => {
  const driver = fakeDriver("install-vrchat", Number.POSITIVE_INFINITY);
  const { raf, cancel, step } = fakeRaf();
  schedulePendingGuideScroll(driver, raf, cancel, 3);
  step();
  step();
  step();
  assert.equal(driver.calls.length, 3);
  assert.equal(driver.marker, null);
});

test("常规单跑:执行一次滚动并清除标记;top 目标滚到页首", () => {
  const driver = fakeDriver("top");
  const { raf, cancel, flush } = fakeRaf();
  schedulePendingGuideScroll(driver, raf, cancel);
  flush();
  assert.deepEqual(driver.calls, ["top:0"]);
  assert.equal(driver.marker, null);
});

test("空标记:执行后无滚动", () => {
  const driver = fakeDriver(null);
  const { raf, cancel, flush } = fakeRaf();
  schedulePendingGuideScroll(driver, raf, cancel);
  flush();
  assert.deepEqual(driver.calls, []);
});

/* ---- 评审 P2 第二轮:页底定位与用户滚动 ---- */

test("到达判定(分节进入视口):页底钳制后锚点可见 = 到位;锚点还在视口外 = 继续重试", () => {
  // 460×640 窗口(body 高 487):锚点落在视口内(顶下 87px)→ 到位
  assert.equal(guideAnchorVisible(87, 0, 487), true);
  // 布局未长开:锚点还在视口下方(669 > 487)→ 未到位
  assert.equal(guideAnchorVisible(669, 0, 487), false);
  // 容差与边界:恰好贴顶/贴底各留余量
  assert.equal(guideAnchorVisible(-1, 0, 487), true);
  assert.equal(guideAnchorVisible(487 - 24, 0, 487), true);
  assert.equal(guideAnchorVisible(487 - 20, 0, 487), false);
});

test("滚动来源分类:程序滚动值一致 = 程序;不同/无在途 = 用户", () => {
  assert.equal(classifyGuideScroll(582, 582), "programmatic");
  assert.equal(classifyGuideScroll(583.5, 582), "programmatic");
  assert.equal(classifyGuideScroll(462, 582), "user");
  assert.equal(classifyGuideScroll(462, null), "user");
});

/* ---- 首帧前滚动取消定位(交付计划挂账的 B 修复回归)---- */

test("取消判定:首帧前用户先滚取消待执行定位;程序在途时沿用来源分类", () => {
  // 首个程序滚动帧尚未执行(无在途程序滚动)但定位待执行:任何滚动都
  // 是用户接管 → 取消(原外层守卫在此窗口跳过分类,缺陷即此)
  assert.equal(scrollCancelsPendingGuide(120, null, "install-vrchat"), true);
  assert.equal(scrollCancelsPendingGuide(120, null, "top"), true);
  // 重试间隙(程序滚动事件已消费,在途引用已清):用户再滚同样取消
  assert.equal(scrollCancelsPendingGuide(64, null, "install-vrchat"), true);
  // 程序滚动在途:位置一致 = 定位自身,不取消;位置不符 = 用户接管,取消
  assert.equal(scrollCancelsPendingGuide(582, 582, "install-vrchat"), false);
  assert.equal(scrollCancelsPendingGuide(462, 582, "install-vrchat"), true);
  // 无待执行定位的纯阅读跟踪:一律不取消
  assert.equal(scrollCancelsPendingGuide(462, null, null), false);
});

test("首帧前取消后,已调度的滚动帧按空标记空跑(不执行、不重试)", () => {
  const driver = fakeDriver("install-vrchat");
  const { raf, cancel, step } = fakeRaf();
  schedulePendingGuideScroll(driver, raf, cancel);
  // 首帧执行前用户先滚:视图层按 scrollCancelsPendingGuide 清空标记
  driver.marker = null;
  step();
  assert.deepEqual(driver.calls, []);
  assert.equal(driver.marker, null);
});

/* ---- 到位判定:布局稳定半边(阅读窗冒烟 2026-10-06 的宽窗误到位回归)---- */

test("到位判定:滚动真正落地即到位;锚点缺席或未落地不算", () => {
  // 正常路径:布局稳定 + 滚动贴齐期望偏移
  assert.equal(guideSectionArrival(true, true, true, false), true);
  // 锚点不在视口(布局未长开,目标还在下方)→ 继续重试
  assert.equal(guideSectionArrival(false, true, true, false), false);
  // 布局未稳定(字体/插图仍在载入)→ 即使几何上可见也不算到位
  assert.equal(guideSectionArrival(true, false, true, false), false);
});

test("到位判定:钳在页底需布局稳定——宽窗布局未熟时的可见锚点是误到位", () => {
  // 真页底:内容超出视口,锚点可见,布局两帧稳定 → 到位
  assert.equal(guideSectionArrival(true, true, false, true), true);
  // 布局未长开(scrollHeight 尚未稳定):即使锚点已落进视口也继续重试,
  // 等字体/插图载入后按实时布局重算——阅读窗冒烟的静默失效即此回归
  assert.equal(guideSectionArrival(true, false, false, true), false);
  // 布局稳定但滚动没落地也没钳底(异常钳制)→ 继续重试
  assert.equal(guideSectionArrival(true, true, false, false), false);
});

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
  schedulePendingGuideScroll,
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

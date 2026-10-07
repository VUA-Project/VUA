import { describe, expect, it } from "vitest";
import {
  READER_SURFACE_PARAM,
  READER_WINDOW_HEIGHT,
  READER_WINDOW_MIN_HEIGHT,
  READER_WINDOW_MIN_WIDTH,
  READER_WINDOW_WIDTH,
  decideReaderWindowAction,
  readerVisibilityAfterDecision,
} from "./reader-window.js";

describe("reader 窗口决策(三类引导裁决:普通阅读窗口,桌面域内切片)", () => {
  it("无窗口 → 创建(create);在位(可见或最小化)→ 显示(show)", () => {
    expect(decideReaderWindowAction({ exists: false })).toBe("create");
    expect(decideReaderWindowAction({ exists: true })).toBe("show");
  });

  it("回执可见性:create/show 恒 true——阅读器没有 hide 决策,消失路径只有系统窗框关闭", () => {
    expect(readerVisibilityAfterDecision("create")).toBe(true);
    expect(readerVisibilityAfterDecision("show")).toBe(true);
  });

  it("形态参数钉在 guidance 架构 §3(普通不透明可缩放窗,表面参数不漂移)", () => {
    expect(READER_WINDOW_WIDTH).toBe(760);
    expect(READER_WINDOW_HEIGHT).toBe(840);
    expect(READER_WINDOW_MIN_WIDTH).toBe(520);
    expect(READER_WINDOW_MIN_HEIGHT).toBe(480);
    expect(READER_SURFACE_PARAM).toBe("reader");
  });
});

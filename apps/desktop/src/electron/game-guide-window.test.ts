import { describe, expect, it } from "vitest";
import {
  GAME_GUIDE_SURFACE_PARAM,
  GAME_GUIDE_WINDOW_HEIGHT,
  GAME_GUIDE_WINDOW_LEVEL,
  GAME_GUIDE_WINDOW_MIN_HEIGHT,
  GAME_GUIDE_WINDOW_MIN_WIDTH,
  GAME_GUIDE_WINDOW_WIDTH,
  decideGameGuideWindowAction,
  gameGuideVisibilityAfterDecision,
} from "./game-guide-window.js";

describe("game-guide 窗口决策(三类引导 §4 手动版,桌面域内切片)", () => {
  it("无窗口 → 创建(create);在位(可见或隐藏)→ 显示(show)", () => {
    expect(decideGameGuideWindowAction({ exists: false })).toBe("create");
    expect(decideGameGuideWindowAction({ exists: true })).toBe("show");
  });

  it("回执可见性:create/show 恒 true——隐藏由渲染面显式发起,不是窗口决策", () => {
    expect(gameGuideVisibilityAfterDecision("create")).toBe(true);
    expect(gameGuideVisibilityAfterDecision("show")).toBe(true);
  });

  it("形态参数钉在 guidance §4(小型透明置顶窗,表面参数与层级不漂移)", () => {
    expect(GAME_GUIDE_WINDOW_WIDTH).toBe(360);
    expect(GAME_GUIDE_WINDOW_HEIGHT).toBe(560);
    expect(GAME_GUIDE_WINDOW_MIN_WIDTH).toBe(280);
    expect(GAME_GUIDE_WINDOW_MIN_HEIGHT).toBe(400);
    expect(GAME_GUIDE_WINDOW_LEVEL).toBe("screen-saver");
    expect(GAME_GUIDE_SURFACE_PARAM).toBe("game-guide");
  });
});

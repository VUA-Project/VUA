import { describe, expect, it } from "vitest";
import {
  OVERLAY_WINDOW_HEIGHT,
  OVERLAY_WINDOW_LEVEL,
  OVERLAY_WINDOW_WIDTH,
  OVERLAY_SURFACE_PARAM,
  decideOverlayWindowAction,
  guideTargetQuery,
  overlayVisibilityAfterDecision,
  parseGuideTargetPayload,
} from "./overlay-window.js";

describe("overlay 窗口决策(proposal 017 实现面备注,桌面域内切片)", () => {
  it("无窗口 → 创建(create)", () => {
    expect(decideOverlayWindowAction({ exists: false, visible: false })).toBe("create");
  });

  it("在位不可见 → 显示(show)", () => {
    expect(decideOverlayWindowAction({ exists: true, visible: false })).toBe("show");
  });

  it("在位可见 → 隐藏(hide)", () => {
    expect(decideOverlayWindowAction({ exists: true, visible: true })).toBe("hide");
  });

  it("动作后可见性回执:create/show=true,hide=false", () => {
    expect(overlayVisibilityAfterDecision("create")).toBe(true);
    expect(overlayVisibilityAfterDecision("show")).toBe(true);
    expect(overlayVisibilityAfterDecision("hide")).toBe(false);
  });

  it("形态参数钉在 F7a spike 验证结论(460×640,screen-saver 级,表面参数不漂移)", () => {
    expect(OVERLAY_WINDOW_WIDTH).toBe(460);
    expect(OVERLAY_WINDOW_HEIGHT).toBe(640);
    expect(OVERLAY_WINDOW_LEVEL).toBe("screen-saver");
    expect(OVERLAY_SURFACE_PARAM).toBe("overlay-desktop");
  });
});

describe("指南定位载荷(首玩 B 切片 additive):形状收窄与查询编码", () => {
  it("null/undefined → null(仅打开引导视图)", () => {
    expect(parseGuideTargetPayload(null)).toBeNull();
    expect(parseGuideTargetPayload(undefined)).toBeNull();
  });

  it("合法形状:topic 必填非空字符串,section 可选", () => {
    expect(parseGuideTargetPayload({ topic: "guide-devices" })).toEqual({ topic: "guide-devices" });
    expect(parseGuideTargetPayload({ topic: "guide-devices", section: "pico-usb" })).toEqual({
      topic: "guide-devices",
      section: "pico-usb",
    });
  });

  it("形状垃圾一律 throw(与 invalid overlay view 同纪律)", () => {
    expect(() => parseGuideTargetPayload("guide-devices")).toThrow("invalid guide target");
    expect(() => parseGuideTargetPayload(42)).toThrow("invalid guide target");
    expect(() => parseGuideTargetPayload({ topic: "" })).toThrow("invalid guide target");
    expect(() => parseGuideTargetPayload({ topic: 7 })).toThrow("invalid guide target");
    expect(() => parseGuideTargetPayload({ topic: "guide-devices", section: 3 })).toThrow(
      "invalid guide target",
    );
    expect(() => parseGuideTargetPayload({ topic: "x".repeat(65) })).toThrow(
      "invalid guide target",
    );
    expect(() =>
      parseGuideTargetPayload({ topic: "guide-devices", section: "y".repeat(65) }),
    ).toThrow("invalid guide target");
  });

  it("查询编码:null → 空串;词面经 encodeURIComponent", () => {
    expect(guideTargetQuery(null)).toBe("");
    expect(guideTargetQuery({ topic: "guide-start" })).toBe("&guideTopic=guide-start");
    expect(guideTargetQuery({ topic: "guide-devices", section: "pico-usb" })).toBe(
      "&guideTopic=guide-devices&guideSection=pico-usb",
    );
    expect(guideTargetQuery({ topic: "a b/c", section: "d?e" })).toBe(
      "&guideTopic=a%20b%2Fc&guideSection=d%3Fe",
    );
  });
});

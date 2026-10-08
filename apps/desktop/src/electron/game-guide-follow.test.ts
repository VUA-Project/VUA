import { describe, expect, it } from "vitest";
import {
  GAME_WINDOW_OBSERVE_SCHEMA_VERSION,
  type GameWindowObservationV1,
  type GameWindowRectPhysicalV1,
} from "@vua/contracts";
import {
  applyFollowToggle,
  applyManualHide,
  applyManualShow,
  computeGuidePlacement,
  decideFollowTick,
  initialGameGuideFollowState,
  recordUnknownTick,
  type DipRect,
  type GameGuideFollowState,
} from "./game-guide-follow.js";

const GUIDE_SIZE = { width: 360, height: 560 } as const;
/** 测试接缝:物理坐标恒等映射(缩放换算属 main.ts 的 Electron 接缝) */
const identityDip = (rect: GameWindowRectPhysicalV1): DipRect => ({ ...rect });

function observation(
  state: "absent" | "waiting" | "ready",
  window?: Partial<NonNullable<GameWindowObservationV1["window"]>>,
): GameWindowObservationV1 {
  return {
    schemaVersion: GAME_WINDOW_OBSERVE_SCHEMA_VERSION,
    capturedAt: "2026-10-08T04:30:00.000Z",
    state,
    window:
      state === "ready"
        ? {
            sessionId: "vrchat-1",
            rectPhysical: { x: 100, y: 50, width: 1920, height: 1080 },
            minimized: false,
            foreground: true,
            ...window,
          }
        : null,
  };
}

function followState(partial: Partial<GameGuideFollowState> = {}): GameGuideFollowState {
  return { ...initialGameGuideFollowState, ...partial };
}

describe("computeGuidePlacement(落位:游戏可用区内右侧、垂直居中,两轴钳回)", () => {
  it("常规:右侧留 12 间距,垂直居中,全部整数", () => {
    expect(computeGuidePlacement({ x: 100, y: 50, width: 1920, height: 1080 }, GUIDE_SIZE)).toEqual({
      x: 100 + 1920 - 360 - 12,
      y: 50 + (1080 - 560) / 2,
      width: 360,
      height: 560,
    });
  });

  it("钳制:游戏太窄钉到 game.x,太矮钉到 game.y(永不压出游戏可用区)", () => {
    expect(computeGuidePlacement({ x: 300, y: 200, width: 200, height: 300 }, GUIDE_SIZE)).toEqual({
      x: 300,
      y: 200,
      width: 360,
      height: 560,
    });
  });

  it("钳制:贴近右/下边界的小窗口不外溢", () => {
    expect(computeGuidePlacement({ x: -20, y: 10, width: 500, height: 600 }, GUIDE_SIZE)).toEqual({
      x: -20 + 500 - 360 - 12,
      y: 10 + (600 - 560) / 2,
      width: 360,
      height: 560,
    });
  });
});

describe("decideFollowTick(跟随 tick 状态机)", () => {
  it("跟随关闭:已绑定且可见 → hide + 解绑;其余不动(手动打开保持纯手动)", () => {
    const bound = followState({ followEnabled: false, boundSession: "vrchat-1", lastPlacementKey: "k" });
    const hidden = decideFollowTick(bound, observation("ready"), { visible: true, focused: false }, GUIDE_SIZE, identityDip);
    expect(hidden.action).toEqual({ kind: "hide" });
    expect(hidden.next.boundSession).toBeNull();
    expect(hidden.next.lastPlacementKey).toBeNull();
    const manualOpen = decideFollowTick(
      followState({ followEnabled: false }),
      observation("ready"),
      { visible: true, focused: false },
      GUIDE_SIZE,
      identityDip,
    );
    expect(manualOpen.action).toBeNull();
    expect(manualOpen.next.boundSession).toBeNull();
  });

  it("absent:会话结束——解绑、清手动隐藏记录;曾绑定且可见才 hide", () => {
    const state = followState({ boundSession: "vrchat-1", manualHiddenSession: "vrchat-1", lastPlacementKey: "k" });
    const result = decideFollowTick(state, observation("absent"), { visible: true, focused: false }, GUIDE_SIZE, identityDip);
    expect(result.action).toEqual({ kind: "hide" });
    expect(result.next.boundSession).toBeNull();
    expect(result.next.manualHiddenSession).toBeNull();
    expect(result.next.lastPlacementKey).toBeNull();
    expect(result.next.lastObservation).toBe("absent");
  });

  it("absent:从未绑定的手动打开窗口保持原样(无游戏时的预览不被动)", () => {
    const result = decideFollowTick(
      followState(),
      observation("absent"),
      { visible: true, focused: false },
      GUIDE_SIZE,
      identityDip,
    );
    expect(result.action).toBeNull();
    expect(result.next.boundSession).toBeNull();
  });

  it("waiting:保留手动隐藏记录(会话未知);已绑定则解绑并按可见性收起", () => {
    const bound = followState({ boundSession: "vrchat-1", manualHiddenSession: "vrchat-0", lastPlacementKey: "k" });
    const result = decideFollowTick(bound, observation("waiting"), { visible: true, focused: false }, GUIDE_SIZE, identityDip);
    expect(result.action).toEqual({ kind: "hide" });
    expect(result.next.boundSession).toBeNull();
    expect(result.next.manualHiddenSession).toBe("vrchat-0");
    const unbound = decideFollowTick(followState(), observation("waiting"), { visible: true, focused: false }, GUIDE_SIZE, identityDip);
    expect(unbound.action).toBeNull();
    expect(unbound.next.boundSession).toBeNull();
  });

  it("ready + 本会话手动隐藏命中:无动作,绝不带回;保持解绑", () => {
    const state = followState({ manualHiddenSession: "vrchat-1", boundSession: "vrchat-1", lastPlacementKey: "k" });
    const result = decideFollowTick(state, observation("ready"), { visible: false, focused: false }, GUIDE_SIZE, identityDip);
    expect(result.action).toBeNull();
    expect(result.next.boundSession).toBeNull();
    expect(result.next.lastPlacementKey).toBeNull();
    expect(result.next.manualHiddenSession).toBe("vrchat-1");
  });

  it("ready + 最小化:绑定会话;可见才 hide 并失效落位键", () => {
    const visible = decideFollowTick(
      followState({ lastPlacementKey: "k" }),
      observation("ready", { minimized: true, foreground: false }),
      { visible: true, focused: false },
      GUIDE_SIZE,
      identityDip,
    );
    expect(visible.action).toEqual({ kind: "hide" });
    expect(visible.next.boundSession).toBe("vrchat-1");
    expect(visible.next.lastPlacementKey).toBeNull();
    const hidden = decideFollowTick(
      followState(),
      observation("ready", { minimized: true, foreground: false }),
      { visible: false, focused: false },
      GUIDE_SIZE,
      identityDip,
    );
    expect(hidden.action).toBeNull();
    expect(hidden.next.boundSession).toBe("vrchat-1");
  });

  it("ready + 切到别的应用:hide;点击引导自身(聚焦)不算切走", () => {
    const switched = decideFollowTick(
      followState(),
      observation("ready", { foreground: false }),
      { visible: true, focused: false },
      GUIDE_SIZE,
      identityDip,
    );
    expect(switched.action).toEqual({ kind: "hide" });
    expect(switched.next.boundSession).toBe("vrchat-1");
    // 引导聚焦 = 引导上下文:按活跃处理(不可见则补显示)
    const onGuide = decideFollowTick(
      followState(),
      observation("ready", { foreground: false }),
      { visible: false, focused: true },
      GUIDE_SIZE,
      identityDip,
    );
    expect(onGuide.action?.kind).toBe("show");
  });

  it("ready + 游戏上下文活跃:不可见 → show(携带落位);可见且落位未变 → 无动作", () => {
    const shown = decideFollowTick(followState(), observation("ready"), { visible: false, focused: false }, GUIDE_SIZE, identityDip);
    expect(shown.action?.kind).toBe("show");
    expect(shown.action && "placement" in shown.action ? shown.action.placement : null).toEqual(
      computeGuidePlacement({ x: 100, y: 50, width: 1920, height: 1080 }, GUIDE_SIZE),
    );
    const key = shown.next.lastPlacementKey;
    expect(key).not.toBeNull();
    const steady = decideFollowTick(shown.next, observation("ready"), { visible: true, focused: false }, GUIDE_SIZE, identityDip);
    expect(steady.action).toBeNull();
    expect(steady.next.lastPlacementKey).toBe(key);
  });

  it("ready + 落位变化:可见才 move(去重键更新)", () => {
    const shown = decideFollowTick(followState(), observation("ready"), { visible: false, focused: false }, GUIDE_SIZE, identityDip);
    const moved = decideFollowTick(
      shown.next,
      observation("ready", { rectPhysical: { x: 0, y: 0, width: 1600, height: 900 } }),
      { visible: true, focused: false },
      GUIDE_SIZE,
      identityDip,
    );
    expect(moved.action?.kind).toBe("move");
    expect(moved.action && "placement" in moved.action ? moved.action.placement : null).toEqual(
      computeGuidePlacement({ x: 0, y: 0, width: 1600, height: 900 }, GUIDE_SIZE),
    );
    expect(moved.next.lastPlacementKey).not.toBe(shown.next.lastPlacementKey);
  });

  it("观察记录任何分支都更新(lastObservation/lastGameForeground)", () => {
    const result = decideFollowTick(
      followState(),
      observation("ready", { foreground: false }),
      { visible: false, focused: true },
      GUIDE_SIZE,
      identityDip,
    );
    expect(result.next.lastObservation).toBe("ready");
    expect(result.next.lastGameForeground).toBe(false);
  });
});

describe("事件 reducer(手动显隐与跟随开关)", () => {
  it("显式打开:清除手动隐藏记录(恢复跟随)", () => {
    const state = followState({ manualHiddenSession: "vrchat-1" });
    expect(applyManualShow(state).manualHiddenSession).toBeNull();
  });

  it("显式隐藏:记录当前绑定会话;解绑并失效落位键", () => {
    const state = followState({ boundSession: "vrchat-1", lastPlacementKey: "k" });
    const next = applyManualHide(state);
    expect(next.manualHiddenSession).toBe("vrchat-1");
    expect(next.boundSession).toBeNull();
    expect(next.lastPlacementKey).toBeNull();
    // 未绑定时的手动隐藏不伪造会话记录
    expect(applyManualHide(followState()).manualHiddenSession).toBeNull();
  });

  it("跟随开关:关闭解绑;已绑定且可见 → hideNow;开启只翻开关", () => {
    const boundVisible = applyFollowToggle(followState({ boundSession: "vrchat-1", lastPlacementKey: "k" }), false, true);
    expect(boundVisible.hideNow).toBe(true);
    expect(boundVisible.next.followEnabled).toBe(false);
    expect(boundVisible.next.boundSession).toBeNull();
    expect(boundVisible.next.lastPlacementKey).toBeNull();
    const boundHidden = applyFollowToggle(followState({ boundSession: "vrchat-1" }), false, false);
    expect(boundHidden.hideNow).toBe(false);
    const manualOpen = applyFollowToggle(followState(), false, true);
    expect(manualOpen.hideNow).toBe(false, "从未绑定的手动打开窗口保持纯手动");
    const enabled = applyFollowToggle(followState({ followEnabled: false }), true, false);
    expect(enabled.hideNow).toBe(false);
    expect(enabled.next.followEnabled).toBe(true);
  });
});

describe("recordUnknownTick(观察通道缺席的诚实记录)", () => {
  it("只落 unknown 记录:绑定与手动隐藏原样保留(通道打嗝 ≠ 游戏缺席)", () => {
    const state = followState({ boundSession: "vrchat-1", manualHiddenSession: "vrchat-0", lastObservation: "ready", lastGameForeground: true });
    const next = recordUnknownTick(state);
    expect(next.lastObservation).toBe("unknown");
    expect(next.lastGameForeground).toBe(false);
    expect(next.boundSession).toBe("vrchat-1");
    expect(next.manualHiddenSession).toBe("vrchat-0");
  });
});

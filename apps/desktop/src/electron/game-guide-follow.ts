/**
 * 游戏引导跟随决策面(三类引导架构 §4 自动跟随;桌面域内切片)。
 *
 * 职责切分同 game-guide-window.ts / overlay-window.ts:本模块只承载可测纯
 * 逻辑——跟随状态机与落位计算;定时器、provider 查询(environment.
 * observeGameWindow)、BrowserWindow 动作(setBounds/showInactive/hide)
 * 与物理→DIP 换算接缝全部在 main.ts。
 *
 * 纪律(guidance §4 窗口跟随段):
 * - 自动显示永不夺焦点:本模块只产出 show/move/hide 意图,接缝侧唯一的
 *   显示路径是 showInactive;
 * - 引导落位在游戏可用区内右侧、垂直居中,永不铺满游戏;游戏比引导
 *   还小时钳到游戏左上角;
 * - 游戏最小化/退出/切走自动隐藏;点击引导自身属引导上下文(接缝侧以
 *   guide.focused 输入),不切走;
 * - 本会话内手动隐藏优先:manualHiddenSession 命中当前游戏会话时窗口
 *   变化绝不把它带回,显式重开(applyManualShow)才恢复跟随;
 * - 跟随开关关闭即停一切自动显隐/移动:已绑定且可见的引导必须收起,
 *   不留全局置顶窗压在无关应用上;从未绑定的手动打开窗口保持纯手动,
 *   自动化绝不触碰;
 * - 观察通道缺席(provider 未就绪/查询失败)是 "unknown" 诚实缺席
 *   (recordUnknownTick),绝不当作游戏缺席,也绝不伪造 ready。
 */
import type {
  GameWindowObservationV1,
  GameWindowRectPhysicalV1,
} from "@vua/contracts";

/** DIP 矩形(接缝侧 setBounds 的坐标系) */
export interface DipRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** User placement within the available travel, independent of monitor/DPI. */
export interface GuideRelativePlacement { readonly x: number; readonly y: number }

/** 跟随状态(全量不可变;事件 reducer 与 tick 各返新值) */
export interface GameGuideFollowState {
  /** 跟随开关(缺省 true,用户裁决;持久化在渲染层,Main 强制执行) */
  readonly followEnabled: boolean;
  /** 引导当前绑定的游戏会话;null = 未绑定 */
  readonly boundSession: string | null;
  /** 本会话内被手动隐藏的游戏会话(会话结束=absent 时清除) */
  readonly manualHiddenSession: string | null;
  /** 最近一次已应用落位的 JSON(setBounds 去重键) */
  readonly lastPlacementKey: string | null;
  /** 最近一次观察三态原样透传;"unknown" = 观察通道缺席的诚实记录 */
  readonly lastObservation: "absent" | "waiting" | "ready" | "unknown";
  /** 最近一次观察中游戏窗口是否前台(未观察到时为 false) */
  readonly lastGameForeground: boolean;
  readonly lastGameRect: DipRect | null;
  /** Only a player drag changes this preference; automatic moves never learn it. */
  readonly relativePlacement: GuideRelativePlacement | null;
}

export const initialGameGuideFollowState: GameGuideFollowState = {
  followEnabled: true,
  boundSession: null,
  manualHiddenSession: null,
  lastPlacementKey: null,
  lastObservation: "unknown",
  lastGameForeground: false,
  lastGameRect: null,
  relativePlacement: null,
};

/** 跟随动作意图:show/move 携带落位;hide 不带(接缝侧幂等) */
export type FollowAction =
  | { readonly kind: "show" | "move"; readonly placement: DipRect }
  | { readonly kind: "hide" };

/** 引导与游戏右边界的间距(DIP) */
export const GAME_GUIDE_FOLLOW_MARGIN = 12;

/**
 * 落位计算(纯函数):游戏可用区内右侧、垂直居中——
 * x = game.x + game.width - guide.width - 12,y 垂直居中;
 * 两轴都钳回游戏矩形(游戏比引导小时钉到 game.x/game.y),全部取整。
 */
export function computeGuidePlacement(
  game: DipRect,
  guide: { readonly width: number; readonly height: number },
  relative: GuideRelativePlacement | null = null,
): DipRect {
  const width = Math.trunc(guide.width);
  const height = Math.trunc(guide.height);
  const maxX = game.x + Math.max(0, game.width - width);
  const maxY = game.y + Math.max(0, game.height - height);
  const desiredX = relative ? game.x + (maxX - game.x) * relative.x : game.x + game.width - width - GAME_GUIDE_FOLLOW_MARGIN;
  const desiredY = relative ? game.y + (maxY - game.y) * relative.y : game.y + (game.height - height) / 2;
  const x = Math.round(Math.min(Math.max(desiredX, game.x), maxX));
  const y = Math.round(Math.min(Math.max(desiredY, game.y), maxY));
  return { x, y, width, height };
}

/** Called only by Electron's user-only will-move event, never by setBounds. */
export function recordGuideDrag(state: GameGuideFollowState, guide: DipRect): GameGuideFollowState {
  const game = state.lastGameRect;
  if (!state.followEnabled || state.boundSession === null || state.lastObservation !== "ready" || game === null) return state;
  const travelX = Math.max(0, game.width - guide.width);
  const travelY = Math.max(0, game.height - guide.height);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return { ...state, relativePlacement: {
    x: travelX ? clamp((guide.x - game.x) / travelX) : state.relativePlacement?.x ?? 1,
    y: travelY ? clamp((guide.y - game.y) / travelY) : state.relativePlacement?.y ?? 0.5,
  }, lastPlacementKey: JSON.stringify(guide) };
}

/**
 * 跟随 tick 决策(纯函数):观察 + 引导可见/聚焦 → 动作意图与下一状态。
 * 观察记录(lastObservation/lastGameForeground)任何分支都更新。
 * observation 形状已由接缝侧的 isGameWindowObservationResult 收窄
 * (ready ⇔ 窗口事实在场);ready 携 null 的退化形态按 waiting 同等处理
 * (解绑并按可见性隐藏),绝不当作游戏上下文活跃。
 */
export function decideFollowTick(
  state: GameGuideFollowState,
  observation: GameWindowObservationV1,
  guide: { readonly visible: boolean; readonly focused: boolean },
  guideSize: { readonly width: number; readonly height: number },
  toDip: (rect: GameWindowRectPhysicalV1) => DipRect,
): { readonly action: FollowAction | null; readonly next: GameGuideFollowState } {
  const observed: GameGuideFollowState = {
    ...state,
    lastObservation: observation.state,
    lastGameForeground: observation.window?.foreground ?? false,
  };

  // 跟随关闭:自动化只剩「收起残留绑定」——已绑定且可见才 hide 并解绑;
  // 其余一律不动(从未绑定的手动打开窗口保持纯手动)
  if (!state.followEnabled) {
    if (state.boundSession !== null && guide.visible) {
      return {
        action: { kind: "hide" },
        next: { ...observed, boundSession: null, lastPlacementKey: null },
      };
    }
    return { action: null, next: observed };
  }

  if (observation.state === "absent") {
    // 会话结束:解绑并清除手动隐藏记录;仅「曾绑定且可见」才收起——
    // 从未绑定的手动打开窗口(无游戏时的预览)保持原样
    const wasBound = state.boundSession !== null;
    return {
      action: wasBound && guide.visible ? { kind: "hide" } : null,
      next: { ...observed, boundSession: null, manualHiddenSession: null, lastPlacementKey: null, lastGameRect: null },
    };
  }

  const game = observation.state === "ready" ? observation.window : null;
  if (game === null) {
    // waiting(及 ready 携 null 的退化形态):会话未知,保留手动隐藏记录;
    // 已绑定 = 窗口暂不可用,解绑并按可见性收起
    if (state.boundSession !== null) {
      return {
        action: guide.visible ? { kind: "hide" } : null,
        next: { ...observed, boundSession: null, lastPlacementKey: null },
      };
    }
    return { action: null, next: observed };
  }

  // 本会话内手动隐藏优先:窗口变化绝不把它带回(直至会话结束或显式重开)
  if (state.manualHiddenSession === game.sessionId) {
    return {
      action: null,
      next: { ...observed, boundSession: null, lastPlacementKey: null },
    };
  }

  if (game.minimized || (!game.foreground && !guide.focused)) {
    // 游戏最小化,或玩家切到别的应用(点击引导自身不算切走):
    // 绑定会话;可见才收起(落位键随隐藏失效)
    if (guide.visible) {
      return {
        action: { kind: "hide" },
        next: { ...observed, boundSession: game.sessionId, lastPlacementKey: null },
      };
    }
    return { action: null, next: { ...observed, boundSession: game.sessionId } };
  }

  // 游戏上下文活跃:落位在游戏可用区内右侧;显示/移动都去重
  const gameRect = toDip(game.rectPhysical);
  const placement = computeGuidePlacement(gameRect, guideSize, state.relativePlacement);
  const placementKey = JSON.stringify(placement);
  const bound: GameGuideFollowState = { ...observed, boundSession: game.sessionId, lastGameRect: gameRect };
  if (!guide.visible) {
    return { action: { kind: "show", placement }, next: { ...bound, lastPlacementKey: placementKey } };
  }
  if (placementKey !== state.lastPlacementKey) {
    return { action: { kind: "move", placement }, next: { ...bound, lastPlacementKey: placementKey } };
  }
  return { action: null, next: bound };
}

/** 显式打开(渲染面 show IPC):清除手动隐藏记录,恢复跟随 */
export function applyManualShow(state: GameGuideFollowState): GameGuideFollowState {
  return { ...state, manualHiddenSession: null };
}

/** 显式隐藏(窗内按钮/Esc):本会话内手动隐藏优先;解绑并失效落位键 */
export function applyManualHide(state: GameGuideFollowState): GameGuideFollowState {
  return {
    ...state,
    manualHiddenSession: state.boundSession ?? state.manualHiddenSession,
    boundSession: null,
    lastPlacementKey: null,
  };
}

/**
 * 跟随开关(渲染层持久化、Main 强制执行):关闭即解绑;已绑定且可见的
 * 引导必须立即收起(hideNow),不留全局置顶窗压在无关应用上。开启只
 * 翻转开关,显隐恢复等下一个 tick 按观察决定。
 */
export function applyFollowToggle(
  state: GameGuideFollowState,
  enabled: boolean,
  guideVisible: boolean,
): { readonly next: GameGuideFollowState; readonly hideNow: boolean } {
  if (enabled) {
    return { next: { ...state, followEnabled: true }, hideNow: false };
  }
  return {
    next: { ...state, followEnabled: false, boundSession: null, lastPlacementKey: null },
    hideNow: state.boundSession !== null && guideVisible,
  };
}

/**
 * 观察通道缺席(provider 未就绪/查询失败/响应形状违反)的诚实记录:
 * 本 tick 无动作、绑定与手动隐藏记录原样保留——通道打嗝 ≠ 游戏缺席。
 */
export function recordUnknownTick(state: GameGuideFollowState): GameGuideFollowState {
  return { ...state, lastObservation: "unknown", lastGameForeground: false };
}

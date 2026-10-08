/**
 * 游戏引导窗决策面(三类引导架构 §4;桌面域内切片)。
 *
 * 职责切分同 overlay-window.ts / reader-window.ts:本模块只承载可测纯逻辑
 * ——窗口形态参数与显隐决策;BrowserWindow 的创建/加载/显隐接缝在 main.ts。
 *
 * 形态依据(guidance §4):小型透明置顶窗;跟随开启时由 game-guide-follow.ts
 * 决策按游戏窗口观察自动落位/显隐,跟随关闭或游戏缺席时玩家仍可手动
 * 打开并拖到游戏画面上。打开永远 showInactive(不夺游戏焦点);隐藏 =
 * 隐藏不销毁(保留位置与进度呈现),显式重开恢复。透明度默认 50%、由
 * 渲染面就地调节(内容透明度,本地偏好),不占 Main 面。
 */

/** 渲染表面分流参数(main.tsx 表面路由的既有词表) */
export const GAME_GUIDE_SURFACE_PARAM = "game-guide" as const;

/** 形态参数:单步指引小窗,窄条不遮游戏主体 */
export const GAME_GUIDE_WINDOW_WIDTH = 360;
export const GAME_GUIDE_WINDOW_HEIGHT = 560;
export const GAME_GUIDE_WINDOW_MIN_WIDTH = 280;
export const GAME_GUIDE_WINDOW_MIN_HEIGHT = 400;

/** 置顶层级(Electron 层级词表):与覆盖层同级,高于全屏游戏窗口 */
export const GAME_GUIDE_WINDOW_LEVEL = "screen-saver" as const;

/** 游戏引导窗口状态观测(接缝侧提供,决策输入;隐藏态也按在位处理) */
export interface GameGuideWindowState {
  /** 窗口对象是否在位(closed/未创建 = false) */
  readonly exists: boolean;
}

/**
 * 显隐动作决策(纯函数):无窗口 → "create"(创建后 showInactive,首帧
 * show:false 防白窗闪烁);在位(可见或隐藏)→ "show"(接缝侧
 * showInactive 恢复,绝不夺焦点)。游戏引导没有 hide 决策——隐藏是渲染
 * 面经窗口动作显式发起,消失路径只有窗内「隐藏」与 Esc。
 */
export type GameGuideWindowDecision = "create" | "show";

export function decideGameGuideWindowAction(
  state: GameGuideWindowState,
): GameGuideWindowDecision {
  return state.exists ? "show" : "create";
}

/** 动作后回执可见性(契约面 GameGuideWindowShowResultV1.visible 的取值) */
export function gameGuideVisibilityAfterDecision(
  decision: GameGuideWindowDecision,
): boolean {
  return decision === "create" || decision === "show";
}

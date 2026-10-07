/**
 * 准备阅读器窗决策面(三类引导架构 2026-10-05:普通阅读窗口;桌面域内切片)。
 *
 * 职责切分同 overlay-window.ts:本模块只承载可测纯逻辑——窗口形态参数与
 * 显隐决策;BrowserWindow 的创建/加载/聚焦接缝在 main.ts(Electron 运行时
 * 依赖不过测试边界)。
 *
 * 形态依据(guidance 架构 §3):普通不透明可缩放窗口——系统窗框承担
 * 最小化/还原/关闭,有任务栏条目;不请求置顶/透明/无框。打开允许夺焦点
 * (用户明确动作);后台任务事件不抬起窗口(接缝侧不订阅任何广播)。
 * 关闭即销毁:阅读位置经渲染层 localStorage 恢复,不依赖窗口存活;
 * 主窗口关闭 = 应用退出语义,阅读器不拖住 window-all-closed。
 */

/** 渲染表面分流参数(main.tsx 表面路由的既有词表) */
export const READER_SURFACE_PARAM = "reader" as const;

/** 形态参数:长文阅读窗,默认即完整可读;可缩放下限保证窄窗不破版 */
export const READER_WINDOW_WIDTH = 760;
export const READER_WINDOW_HEIGHT = 840;
export const READER_WINDOW_MIN_WIDTH = 520;
export const READER_WINDOW_MIN_HEIGHT = 480;

/** 阅读器窗口状态观测(接缝侧提供,决策输入;最小化也按在位处理) */
export interface ReaderWindowState {
  /** 窗口对象是否在位(closed/未创建 = false) */
  readonly exists: boolean;
}

/**
 * 显隐动作决策(纯函数):无窗口 → "create"(创建并显示;首帧 show:false,
 * 加载完成后由接缝侧 show,普通窗口允许夺焦点);在位(可见或最小化)→
 * "show"(接缝侧最小化先还原,再 show + focus)。阅读器没有 hide 决策——
 * 隐藏语义只属于覆盖层;阅读器的消失路径是用户经系统窗框关闭(销毁)。
 */
export type ReaderWindowDecision = "create" | "show";

export function decideReaderWindowAction(state: ReaderWindowState): ReaderWindowDecision {
  return state.exists ? "show" : "create";
}

/** 动作后回执可见性(契约面 ReaderWindowShowResultV1.visible 的取值) */
export function readerVisibilityAfterDecision(decision: ReaderWindowDecision): boolean {
  return decision === "create" || decision === "show";
}

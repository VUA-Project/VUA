/**
 * Overlay 置顶窗决策面(proposal 017 §4 表态「实现面备注」,桌面域内切片;
 * M7 桌面行「桌面 Overlay 收尾」的先行部分)。
 *
 * 职责切分:本模块只承载可测纯逻辑——动作→窗口操作的决策、动作后的可见性
 * 回执、窗口形态参数;BrowserWindow 的创建/加载/置顶接缝在 main.ts(Electron
 * 运行时依赖不过测试边界,同 security/gateway-router 模式)。
 *
 * 形态依据(切片五 F7a spike-overlay.mjs 验证结论,preview-overlay.mjs 同参):
 * 460×640、transparent + frameless + skipTaskbar + hasShadow:false、
 * alwaysOnTop("screen-saver" 级)。渲染面 ?surface=overlay-desktop(应用初始
 * 化最早阶段分流,main.tsx 表面路由既有面)。
 *
 * 诚实边界:本切片不接 overlay 读面 wire 词表(候选核心批 1 冻结批,017 内联
 * 领取声明)——渲染面生产路径恒为诚实 inactive 空态(overlay-port.ts 未接入
 * 占位);本模块不含任何快照/事件语义,窗口层只管创建/置顶/显隐。
 */

/** 形态参数(F7a spike 结论):悬浮卡尺寸 */
export const OVERLAY_WINDOW_WIDTH = 460;
export const OVERLAY_WINDOW_HEIGHT = 640;

/** 置顶层级(Electron 层级词表):screen-saver 级,高于全屏游戏窗口 */
export const OVERLAY_WINDOW_LEVEL = "screen-saver" as const;

/** 渲染表面分流参数(main.tsx 表面路由的既有词表) */
export const OVERLAY_SURFACE_PARAM = "overlay-desktop" as const;

/** Overlay 窗口状态观测(接缝侧提供,决策输入) */
export interface OverlayWindowState {
  /** 窗口对象是否在位(closed/未创建 = false) */
  readonly exists: boolean;
  /** 在位窗口当前是否可见 */
  readonly visible: boolean;
}

/**
 * 显隐动作决策(纯函数):
 * - 无窗口 → "create"(创建并显示;首帧 show:false,加载完成后由接缝侧
 *   showInactive,避免白窗闪烁——与主窗口 ready-to-show 同纪律);
 * - 在位不可见 → "show"(重新显示;接缝侧 showInactive 不夺焦点);
 * - 在位可见 → "hide"(隐藏不销毁,保留窗口与滚动/输入状态;显隐切换
 *   是低频用户动作,常驻不占产品承诺——窗口销毁只随主窗口生命周期)。
 */
export type OverlayWindowDecision = "create" | "show" | "hide";

export function decideOverlayWindowAction(state: OverlayWindowState): OverlayWindowDecision {
  if (!state.exists) return "create";
  return state.visible ? "hide" : "show";
}

/** 动作后回执可见性(契约面 OverlayWindowVisibilityV1.visible 的取值) */
export function overlayVisibilityAfterDecision(decision: OverlayWindowDecision): boolean {
  return decision !== "hide";
}

/* ---- 指南定位(首玩 B 切片 additive)---- */

/** 定位词面长度上限(形状收窄的一部分,防异常载荷) */
export const GUIDE_TARGET_MAX_LENGTH = 64;

/**
 * 指南定位载荷的形状收窄(纯函数,可测):
 * - null/undefined → null(仅打开引导视图,渲染层恢复上次阅读位置);
 * - 对象且 topic 为非空字符串、section 缺席或为字符串(均不超长)→ 词面载荷;
 * - 其余一律 throw(与 "invalid overlay view" 同纪律:形状垃圾是调用方
 *   缺陷,响亮失败;主题/分节词表回退不在此层——词表归渲染层引导模型)。
 */
export function parseGuideTargetPayload(
  value: unknown,
): { readonly topic: string; readonly section?: string } | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid guide target");
  const record = value as Record<string, unknown>;
  const topic = record.topic;
  const section = record.section;
  if (
    typeof topic !== "string" ||
    topic.length === 0 ||
    topic.length > GUIDE_TARGET_MAX_LENGTH ||
    (section !== undefined && (typeof section !== "string" || section.length > GUIDE_TARGET_MAX_LENGTH))
  ) {
    throw new Error("invalid guide target");
  }
  return section === undefined ? { topic } : { topic, section };
}

/** 定位 → 加载查询段(新建窗口的首帧投递;两个词面均经 encodeURIComponent) */
export function guideTargetQuery(
  target: { readonly topic: string; readonly section?: string } | null,
): string {
  if (target === null) return "";
  const topic = `&guideTopic=${encodeURIComponent(target.topic)}`;
  return target.section === undefined
    ? topic
    : `${topic}&guideSection=${encodeURIComponent(target.section)}`;
}

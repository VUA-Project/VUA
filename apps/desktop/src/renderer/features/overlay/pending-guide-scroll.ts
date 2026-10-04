/**
 * 待滚动调度(首玩 B 切片评审 P2 修复):
 * - 动画帧实际执行时才清除待滚动标记——StrictMode 双调用下,首次调度被
 *   清理取消但标记仍在,第二次调度照常完成;
 * - 滚动有界重试:首帧时布局可能尚未长开(实测 dev 形态字体载入重排前
 *   scrollHeight == clientHeight,scrollTop 被钳回 0),执行方回传是否
 *   到位,未到位下一帧按实时布局重算重试;默认约 1.5s(90 帧)后清除
 *   标记诚实降级,不死循环。
 */

export interface PendingGuideScrollDriver {
  /** 当前待滚动目标("top" = 主题开头;分节 id;null = 无) */
  read(): string | null;
  clear(): void;
  /** 返回滚动是否实际到位(被布局钳制/锚点缺席 = false,等待重试) */
  scrollBodyTo(top: number): boolean;
  scrollToSection(section: string): boolean;
}

/** 调度待滚动,返回清理函数(只取消动画帧,不清除标记) */
export function schedulePendingGuideScroll(
  driver: PendingGuideScrollDriver,
  raf: (callback: () => void) => number,
  cancelRaf: (id: number) => void,
  maxAttempts = 90,
): () => void {
  let attempts = 0;
  let frameId: number | null = null;
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    const target = driver.read();
    if (target === null) return;
    attempts += 1;
    const reached = target === "top" ? driver.scrollBodyTo(0) : driver.scrollToSection(target);
    if (reached || attempts >= maxAttempts) {
      driver.clear();
      return;
    }
    frameId = raf(run);
  };
  frameId = raf(run);
  return () => {
    cancelled = true;
    if (frameId !== null) cancelRaf(frameId);
  };
}

/* ---- 评审 P2(页底定位/用户滚动)纯判定 ---- */

/** 分节是否已进入视口(到达判定的可见性半边):页底目标会被钳到最大滚动,
 *  锚点不可能贴到期望偏移——以"锚点在视口内"为准 */
export function guideAnchorVisible(
  anchorTop: number,
  bodyTop: number,
  bodyHeight: number,
): boolean {
  return anchorTop >= bodyTop - 2 && anchorTop <= bodyTop + bodyHeight - 24;
}

/**
 * 分节定位到达判定(阅读窗冒烟发现的误到位回归,2026-10-06):
 * 到位需要三件事同时成立——锚点可见、布局连续两帧稳定(scrollHeight 不再
 * 变化)、且滚动真正落地(贴齐期望偏移)或钳在页底。
 * 单看"锚点可见"会把宽版阅读窗的布局未成熟误判为到位:字体/插图载入前
 * 内容偏短,目标分节提前落进视口,有界重试被过早放弃,定位静默失效
 * (窄版覆盖窗内容够高,同一时序从不显现);布局稳定这一半边把两种
 * "暂时钳在页底"区分开——真页底两帧即达,未长开的布局继续按实时布局重试。 */
export function guideSectionArrival(
  anchorSeen: boolean,
  layoutSettled: boolean,
  landedAtDesired: boolean,
  clampedAtEnd: boolean,
): boolean {
  return anchorSeen && layoutSettled && (landedAtDesired || clampedAtEnd);
}

/** 滚动来源分类:与上次程序滚动值一致(±2px)= 程序自身;否则用户主动滚动。
 *  lastProgrammatic 为 null(无程序滚动在途)时一律视为用户滚动 */
export type GuideScrollOrigin = "programmatic" | "user";

export function classifyGuideScroll(
  scrollTop: number,
  lastProgrammatic: number | null,
): GuideScrollOrigin {
  if (lastProgrammatic === null) return "user";
  return Math.abs(scrollTop - lastProgrammatic) <= 2 ? "programmatic" : "user";
}

/** 滚动事件是否取消待执行定位(纯函数,可测;交付计划挂账的 B 修复):
 * - 有程序滚动在途:位置与程序落点不符 = 用户接管 → 取消(评审 P2 第二轮);
 * - 无程序滚动在途但有待执行定位(首个程序滚动帧尚未执行,或处于重试
 *   间隙)→ 该滚动来自用户而非定位自身 → 取消。原视图外层守卫在此窗口
 *   直接跳过分类,用户先滚后定位仍会执行并抢回滚动位置;
 * - 其余(无程序滚动也无待执行定位的纯阅读跟踪)不取消。 */
export function scrollCancelsPendingGuide(
  scrollTop: number,
  lastProgrammatic: number | null,
  pending: string | null,
): boolean {
  if (lastProgrammatic !== null) {
    return classifyGuideScroll(scrollTop, lastProgrammatic) === "user";
  }
  return pending !== null;
}

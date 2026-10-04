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

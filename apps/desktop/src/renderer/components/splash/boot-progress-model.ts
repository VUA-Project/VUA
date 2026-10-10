/**
 * 启动里程碑模型(Phase A2,纯函数＋可注入枢纽):
 * 开屏退出由真实启动链驱动,不再是纯计时——里程碑序列固定四段:
 *   renderer  渲染层 bundle 已加载(枢纽创建即到达)
 *   gateway   Gateway 装配完成(App 创建 createGatewayState)
 *   provider  首个 capability 探针应答(fixture/live 任一应答均计;
 *             测的是网关链活性,不是 live provider 专属)
 *   paint     AppShell 首帧提交
 * 预算内未齐 → 保持加载圆圈;硬上限兜底必退出,
 * 主界面自身的诚实缺席呈现接管后续。
 */

export const BOOT_MILESTONES = ["renderer", "gateway", "provider", "paint"] as const;
export type BootMilestone = (typeof BOOT_MILESTONES)[number];

/** 等待态硬上限:超过即无条件退出开屏(主界面有诚实缺席态接管) */
export const BOOT_PROGRESS_CAP_MS = 8000;

export function allMilestonesReached(reached: ReadonlySet<BootMilestone>): boolean {
  return BOOT_MILESTONES.every((m) => reached.has(m));
}

/** 进度分数(0..1):已到达里程碑占比,呈现层可如实引用 */
export function bootFraction(reached: ReadonlySet<BootMilestone>): number {
  const count = BOOT_MILESTONES.filter((m) => reached.has(m)).length;
  return count / BOOT_MILESTONES.length;
}

/** 当前等待中的首个里程碑(全齐时为 null) */
export function pendingMilestone(
  reached: ReadonlySet<BootMilestone>,
): BootMilestone | null {
  return BOOT_MILESTONES.find((m) => !reached.has(m)) ?? null;
}

/**
 * 开屏退出裁决:
 * - 压平态(reduced-motion/特效关):驻留结束即退,不等里程碑;
 * - 非压平:预算播完且里程碑齐 → 退;预算播完未齐 → 等待;硬上限到 → 必退。
 */
export function splashShouldExit({
  elapsedMs,
  budgetMs,
  flattened,
  allReached,
  capMs = BOOT_PROGRESS_CAP_MS,
}: {
  elapsedMs: number;
  budgetMs: number;
  flattened: boolean;
  allReached: boolean;
  capMs?: number;
}): boolean {
  if (elapsedMs >= capMs) return true;
  if (elapsedMs < budgetMs) return false;
  if (flattened) return true;
  return allReached;
}

/* ---- 事件枢纽(工厂可注入,测试用工厂、应用用单例) ---- */

export interface BootProgressHub {
  report(milestone: BootMilestone): void;
  reached(): ReadonlySet<BootMilestone>;
  allReached(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createBootProgress(): BootProgressHub {
  const reached = new Set<BootMilestone>(["renderer"]);
  const listeners = new Set<() => void>();
  return {
    report(milestone) {
      if (reached.has(milestone)) return;
      reached.add(milestone);
      for (const listener of listeners) listener();
    },
    reached: () => new Set(reached),
    allReached: () => allMilestonesReached(reached),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

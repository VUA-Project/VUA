/**
 * 应用导览模型(三类引导架构 2026-10-05 §2:主窗口内的有序高亮导览)。
 *
 * 纪律(guidance §2 / 首玩交付计划 §2.B):
 * - 小型类型化步表 + 显式页面/控件锚点——锚点是渲染层稳定类名或
 *   data-tour-anchor 词面,页面切换跟随步表(经 App 的 navigate);
 * - 只覆盖首玩可用控件;步表不得
 *   指向不存在或不相关位置(缺席由渲染层诚实说明,不伪造指向);
 * - 进度状态独立于阅读器阅读位置与安装任务状态(storageKeys.tourProgress,
 *   本地 UI 偏好):active(含步号)/completed/skipped 三态;缺席 = 从未
 *   运行,新档案先自动播放,已有档案从帮助重播;中途退出应用按 active 步号恢复;
 * - 不依赖教程端口(tutorial-port 为诚实 inactive,本导览不触碰)与
 *   AMF 工作流;应用事实仍来自正常 Gateway/任务状态。
 */
import type { PageId } from "../../app/nav-model.ts";

/** 导览状态词面(active = 进行中,步号有效;completed/skipped = 终态) */
export type TourStatus = "active" | "completed" | "skipped";

/** 持久化进度(版本化;损坏/词表外 → null = 从未运行,诚实回落未运行) */
export interface TourProgressV2 {
  readonly v: 2;
  readonly status: TourStatus;
  /** active 态的当前步(0 起);终态忽略该值 */
  readonly step: number;
}

/** 导览步定义:显式页面 + 控件锚点(稳定类名或 data-tour-anchor 词面) */
export interface TourStepDef {
  readonly id: string;
  /** 步骤所在页(进入该步时由壳导航) */
  readonly page: PageId;
  /** 控件锚点选择器(渲染层稳定类名 / data-tour-anchor) */
  readonly anchor: string | null;
}

/**
 * Welcome and a short introduction to delivered host pages. This presentation
 * navigates and highlights controls; it never installs, launches or enables AMF.
 */
export const TOUR_STEPS: readonly TourStepDef[] = [
  { id: "welcome", page: "home", anchor: null },
  { id: "route", page: "home", anchor: '[data-nav-id="logo-home"]' },
  { id: "network", page: "env-play", anchor: ".vua-network-tile" },
  { id: "checks", page: "env-play", anchor: '[data-tour-anchor="play-environments"]' },
  { id: "plan", page: "env-play", anchor: '[data-nav-id="route-desktop-action"]' },
  { id: "tools", page: "tools-discover", anchor: '[data-nav-id="nav-tools-discover"]' },
  { id: "creator", page: "env-create", anchor: '[data-nav-id="nav-env-create"]' },
  { id: "tasks", page: "home", anchor: '[data-nav-id="home-tasks"]' },
  { id: "guide", page: "help", anchor: '[data-nav-id="help-encyclopedia"]' },
  { id: "settings", page: "settings-theme", anchor: '[data-nav-id="settings-language-select"]' },
];

/** 词表外/越界步号钳回合法区间(存储损坏时诚实回落,不抛异常) */
export function normalizeStep(step: number, count: number): number {
  if (!Number.isFinite(step) || count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(step), 0), count - 1);
}

/**
 * 存储载荷解析:形状完好且步号合法(整数)→ 进度;其余 → null(从未运行)。
 * 词表外 status / 非对象 / 版本不符一律 null,不猜测。
 */
export function parseTourProgress(raw: string | null | undefined): TourProgressV2 | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1 && record.v !== 2) return null;
    if (record.status !== "active" && record.status !== "completed" && record.status !== "skipped") {
      return null;
    }
    const step = record.step;
    if (typeof step !== "number" || !Number.isInteger(step)) return null;
    const legacyIds = ["route", "network", "checks", "plan", "tasks", "guide"];
    const migrated = record.v === 1
      ? TOUR_STEPS.findIndex(item => item.id === legacyIds[normalizeStep(step, legacyIds.length)])
      : normalizeStep(step, TOUR_STEPS.length);
    return { v: 2, status: record.status, step: record.status === "active" ? migrated : 0 };
  } catch {
    return null;
  }
}

/** 序列化(与 parse 对偶;调用方负责 try/catch 存储不可用) */
export function serializeTourProgress(progress: TourProgressV2): string {
  return JSON.stringify({
    v: 2,
    status: progress.status,
    step: progress.status === "active" ? progress.step : 0,
  });
}

/** Automatic first-use tour never overwrites completed/skipped or onboarded profiles. */
export function firstTourRequired(onboarded: boolean, rawProgress: string | null): boolean {
  if (onboarded) return false;
  const progress = parseTourProgress(rawProgress);
  return progress === null || progress.status === "active";
}

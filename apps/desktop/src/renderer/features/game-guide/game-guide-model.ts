/**
 * 游戏引导模型(三类引导架构 §4 手动版:单步指引 + 确认/跳过进度)。
 *
 * 纪律:
 * - 步表小型类型化(controls/audio/personalSpace/untrustedUrls/worlds),
 *   文案在 i18n strings.gameGuide.steps——内容只复述已核对的引导事实
 *   (与阅读器 guide-basics/guide-safety 同源),不发明新结论;
 * - 教程世界步诚实降级:按语言核对过的世界清单需作者实测,清单缺席时
 *   给游戏内搜索路线,绝不虚构世界编号(guidance §4);
 * - 进度与呈现是两个独立本地状态(storageKeys 分键):进度只记录玩家
 *   自己确认/跳过过哪些步骤,不是对游戏设置的检测或修改(guidance §4:
 *   "确认/跳过记录引导进度,不主张 VUA 检查或更改了游戏设置");
 * - 透明度是呈现偏好,默认 50%(用户裁决),范围钳 0.2–1,损坏/越界
 *   诚实回落默认,不猜。
 */
import { storageKeys } from "../../app/storage-keys.ts";

/** 游戏引导步骤词表(顺序即呈现顺序;文案键同名) */
export const GAME_GUIDE_STEPS = [
  "controls",
  "audio",
  "personalSpace",
  "untrustedUrls",
  "worlds",
] as const;

export type GameGuideStepId = (typeof GAME_GUIDE_STEPS)[number];

/** 步骤决定词表 */
export type GameGuideDecision = "confirmed" | "skipped";

/** 持久化进度:current = 当前步(0 起);decided = 已决定步骤 */
export interface GameGuideProgressV1 {
  readonly v: 1;
  readonly current: number;
  readonly decided: Readonly<Partial<Record<GameGuideStepId, GameGuideDecision>>>;
}

/** 持久化呈现偏好:透明度(0.2–1;缺席 = 0.5 用户裁决缺省) */
export interface GameGuidePresentationV1 {
  readonly v: 1;
  readonly opacity: number;
}

export const GAME_GUIDE_DEFAULT_OPACITY = 0.5;
export const GAME_GUIDE_MIN_OPACITY = 0.2;

/** 步号钳回合法区间 */
export function normalizeGameGuideStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(Math.max(Math.trunc(step), 0), GAME_GUIDE_STEPS.length - 1);
}

/** 透明度钳回 0.2–1;非数/越界回落缺省(呈现偏好不猜测) */
export function normalizeGameGuideOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return GAME_GUIDE_DEFAULT_OPACITY;
  return Math.min(1, Math.max(GAME_GUIDE_MIN_OPACITY, opacity));
}

/**
 * 进度解析:形状完好(决定词表内、键集合法)→ 进度;其余 → null
 * (从未运行,诚实回落第一步)。词表外步骤 id / 非法决定值一律 null,
 * 不裁剪不猜测。
 */
export function parseGameGuideProgress(raw: string | null | undefined): GameGuideProgressV1 | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) return null;
    if (typeof record.current !== "number" || !Number.isInteger(record.current)) return null;
    if (typeof record.decided !== "object" || record.decided === null || Array.isArray(record.decided)) return null;
    const decided: Partial<Record<GameGuideStepId, GameGuideDecision>> = {};
    for (const [id, decision] of Object.entries(record.decided)) {
      if (!(GAME_GUIDE_STEPS as readonly string[]).includes(id)) return null;
      if (decision !== "confirmed" && decision !== "skipped") return null;
      decided[id as GameGuideStepId] = decision;
    }
    return { v: 1, current: normalizeGameGuideStep(record.current), decided };
  } catch {
    return null;
  }
}

export function serializeGameGuideProgress(progress: GameGuideProgressV1): string {
  return JSON.stringify({ v: 1, current: progress.current, decided: progress.decided });
}

/** 决定当前步并推进到下一个未决定步;全部决定后停在最后一步(完成态) */
export function decideGameGuideStep(
  progress: GameGuideProgressV1,
  decision: GameGuideDecision,
): GameGuideProgressV1 {
  const stepId = GAME_GUIDE_STEPS[normalizeGameGuideStep(progress.current)]!;
  const decided = { ...progress.decided, [stepId]: decision };
  let next = normalizeGameGuideStep(progress.current + 1);
  // 回看后的再决定不推进:仅当决定的正是当前步才前进
  if (progress.current !== normalizeGameGuideStep(progress.current)) next = progress.current;
  return { v: 1, current: next, decided };
}

/** 重开:清空决定,回到第一步(进度是玩家自己的记录,重开即弃) */
export function restartGameGuide(): GameGuideProgressV1 {
  return { v: 1, current: 0, decided: {} };
}

/** 是否全部步骤已决定(完成态呈现) */
export function gameGuideComplete(progress: GameGuideProgressV1): boolean {
  return GAME_GUIDE_STEPS.every((id) => progress.decided[id] !== undefined);
}

/** 呈现偏好解析:形状完好 → 偏好;其余 → null(调用方回落缺省) */
export function parseGameGuidePresentation(
  raw: string | null | undefined,
): GameGuidePresentationV1 | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) return null;
    if (typeof record.opacity !== "number") return null;
    return { v: 1, opacity: normalizeGameGuideOpacity(record.opacity) };
  } catch {
    return null;
  }
}

export function serializeGameGuidePresentation(presentation: GameGuidePresentationV1): string {
  return JSON.stringify({ v: 1, opacity: presentation.opacity });
}

/** 读取进度(localStorage 不可用/损坏 → null,调用方回落) */
export function loadGameGuideProgress(): GameGuideProgressV1 | null {
  try {
    return parseGameGuideProgress(localStorage.getItem(storageKeys.gameGuideProgress));
  } catch {
    return null;
  }
}

export function saveGameGuideProgress(progress: GameGuideProgressV1): void {
  try {
    localStorage.setItem(storageKeys.gameGuideProgress, serializeGameGuideProgress(progress));
  } catch {
    /* 存储不可用:进度仅本次会话生效 */
  }
}

export function loadGameGuideOpacity(): number {
  try {
    const parsed = parseGameGuidePresentation(localStorage.getItem(storageKeys.gameGuidePresentation));
    return parsed?.opacity ?? GAME_GUIDE_DEFAULT_OPACITY;
  } catch {
    return GAME_GUIDE_DEFAULT_OPACITY;
  }
}

export function saveGameGuideOpacity(opacity: number): void {
  try {
    localStorage.setItem(
      storageKeys.gameGuidePresentation,
      serializeGameGuidePresentation({ v: 1, opacity: normalizeGameGuideOpacity(opacity) }),
    );
  } catch {
    /* 存储不可用:透明度仅本次会话生效 */
  }
}

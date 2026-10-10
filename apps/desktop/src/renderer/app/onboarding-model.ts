import { defaultPage, isPageId, type BusinessModuleId, type PageId } from "./nav-model.ts";
import { storageKeys } from "./storage-keys.ts";

/**
 * 首次目标引导的持久化模型(美术方案 v0.3.3 §2.2)。
 * 纯函数、无 IO:localStorage 读写由 App 壳负责,这里只做解析/清洗/决策。
 *
 * 版本化结构(从第一天起):未知版本、非法 JSON、缺字段一律视为"未完成引导",
 * 不允许旧数据静默生效;勾选环境部署后又取消时,environments 必须清空,
 * 旧子目标不得继续生效。
 */

/** 目标 id 与业务模块一一对应(§2.1 两类用户目标) */
export type GoalId = BusinessModuleId;

/** 环境细化目标:play = 游玩环境,create = 生产环境(与 deployer-model.CheckZone 一致) */
export type EnvGoalId = "play" | "create";

export interface StoredGoalsV1 {
  version: 1;
  onboarding: "completed" | "skipped";
  goals: GoalId[];
  /** 仅当 goals 含 "env" 时生效;否则必须为空 */
  environments: EnvGoalId[];
}

export const goalsStorageKey = storageKeys.goals;

// 2026-09-26 用户裁决:工具合集并入环境部署、游戏引导迁至覆盖层窗口——
// 两者的引导目标随之退役;旧存储里的 "tools"/"guide" 目标由 sanitizeGoals
// 当未知 id 丢弃(与既往漂移同纪律)
const goalIds: readonly GoalId[] = ["env", "production"];
const envGoalIds: readonly EnvGoalId[] = ["play", "create"];

function isGoalId(value: unknown): value is GoalId {
  return typeof value === "string" && (goalIds as readonly string[]).includes(value);
}

function isEnvGoalId(value: unknown): value is EnvGoalId {
  return typeof value === "string" && (envGoalIds as readonly string[]).includes(value);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** 清洗目标选择:过滤非法值、去重;未选环境部署时强制清空环境子目标 */
export function sanitizeGoals(
  goals: readonly unknown[],
  environments: readonly unknown[],
): { goals: GoalId[]; environments: EnvGoalId[] } {
  const cleanGoals = unique(goals.filter(isGoalId));
  const cleanEnvs = cleanGoals.includes("env") ? unique(environments.filter(isEnvGoalId)) : [];
  return { goals: cleanGoals, environments: cleanEnvs };
}

/**
 * 解析持久化目标:非法 JSON、未知版本、缺字段、非法 onboarding 值
 * 一律返回 null(视为未完成引导),不抛出、不静默修复。
 */
export function parseStoredGoals(raw: string | null): StoredGoalsV1 | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (record.onboarding !== "completed" && record.onboarding !== "skipped") return null;
  if (!Array.isArray(record.goals) || !Array.isArray(record.environments)) return null;
  const { goals, environments } = sanitizeGoals(record.goals, record.environments);
  return { version: 1, onboarding: record.onboarding, goals, environments };
}

/** 序列化目标选择(写前同样清洗,保证落盘数据永远合法) */
export function serializeGoals(
  onboarding: "completed" | "skipped",
  goals: readonly GoalId[],
  environments: readonly EnvGoalId[],
): string {
  const clean = sanitizeGoals(goals, environments);
  return JSON.stringify({ version: 1, onboarding, ...clean } satisfies StoredGoalsV1);
}

/** 某业务目标是否已选择(未完成引导时一律 false) */
export function goalEnabled(stored: StoredGoalsV1 | null, goal: GoalId): boolean {
  return stored !== null && stored.goals.includes(goal);
}

/** 某环境辖区是否纳入检查目标(需同时选中环境部署与该辖区) */
export function envGoalEnabled(stored: StoredGoalsV1 | null, zone: EnvGoalId): boolean {
  return goalEnabled(stored, "env") && stored !== null && stored.environments.includes(zone);
}

/** 旧版页 id 迁移(v0.3.1 → v0.3.2);未知名称原样返回,交由 isPageId 判否 */
export function migratePageId(id: string): string {
  if (id === "settings-goals") return "help-wizard";
  if (id === "settings-version" || id === "settings-donate") return "settings-about";
  if (id === "settings-language") return "settings-theme";
  if (id === "software") return "env-play";
  if (id === "deployer-play") return "env-play";
  if (id === "deployer-create") return "env-create";
  return id;
}

export interface EntryDecision {
  showOnboarding: boolean;
  page: PageId;
}

/**
 * 启动入口决策:
 * - 引导未完成(含数据损坏)→ 必须进引导,vua-last-page 不能绕过;
 * - 已完成/已跳过 → 优先恢复合法的上次页面(旧 id 先迁移),否则回退默认落点。
 */
export function resolveEntry(
  stored: StoredGoalsV1 | null,
  lastPage: string | null,
): EntryDecision {
  if (stored === null) return { showOnboarding: true, page: defaultPage };
  const migrated = lastPage === null ? null : migratePageId(lastPage);
  return { showOnboarding: false, page: isPageId(migrated) ? migrated : defaultPage };
}

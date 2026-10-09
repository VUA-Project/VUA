/**
 * 主题偏好(2026-10-09 用户裁决:默认深色):偏好三值 dark|light|system,
 * 生效主题 = 偏好经系统深浅色解析后的值;pref=system 时由 App 壳订阅
 * prefers-color-scheme 变化实时重解析。本模块只持纯逻辑(解析、翻转、
 * 存储读写形状守卫);matchMedia/localStorage 接缝在 App 壳,存储键沿用
 * vua-theme——旧版写入的 dark|light 是合法子集,仍然可读。
 */
import { storageKeys } from "./storage-keys.ts";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const themePreferenceStorageKey = storageKeys.theme;

const THEME_PREFERENCES: readonly ThemePreference[] = ["dark", "light", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** 解析生效主题:system = 按系统深浅色解析;dark/light 原样 */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/**
 * 切换后的下一偏好(palette 切换命令语义):
 * - pref=system:落到当前生效主题的反面(此后不再跟随系统);
 * - pref=dark/light:生效主题即偏好本身,同样取反面。
 * 两种情形同式,故只入生效主题。
 */
export function toggledPreference(resolved: ResolvedTheme): ThemePreference {
  return resolved === "dark" ? "light" : "dark";
}

/**
 * 存储读取(形状守卫):旧版 dark|light 仍然合法;无值/非法值回落缺省
 * dark(2026-10-09 裁决:全新安装的默认偏好)。读取异常按"存储不可用"
 * 处理,仅本次会话生效。
 */
export function loadThemePreference(read: (key: string) => string | null): ThemePreference {
  try {
    const stored = read(themePreferenceStorageKey);
    if (isThemePreference(stored)) return stored;
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
  return "dark";
}

/** 存储写入:偏好三值原样落盘;写入异常静默(同读取纪律) */
export function saveThemePreference(
  write: (key: string, value: string) => void,
  pref: ThemePreference,
): void {
  try {
    write(themePreferenceStorageKey, pref);
  } catch {
    /* localStorage 不可用时仅本次会话生效 */
  }
}

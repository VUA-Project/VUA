/**
 * 主题偏好纯逻辑校验(2026-10-09 默认深色裁决):
 * - resolveTheme:system 按系统深浅色解析,dark/light 原样;
 * - loadThemePreference:已有三值偏好仍合法,非法/缺失回落 dark;
 * - toggledPreference:取当前生效主题的反面;
 * - saveThemePreference:写入偏好,存储异常静默。
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  isThemePreference,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  themePreferenceStorageKey,
  toggledPreference,
} from "./theme-preference.ts";

test("resolveTheme: system follows the system dark flag, dark/light pass through", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("dark", true), "dark");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("light", false), "light");
});

test("isThemePreference guards the three-value closed set", () => {
  assert.equal(isThemePreference("dark"), true);
  assert.equal(isThemePreference("light"), true);
  assert.equal(isThemePreference("system"), true);
  assert.equal(isThemePreference("auto"), false);
  assert.equal(isThemePreference(""), false);
  assert.equal(isThemePreference(null), false);
  assert.equal(isThemePreference(undefined), false);
});

test("loadThemePreference: saved preferences stay valid, missing or invalid falls back to dark", () => {
  // 旧版写入的 dark|light 是合法子集(存储键不变,vua-theme)
  assert.equal(loadThemePreference(() => "dark"), "dark");
  assert.equal(loadThemePreference(() => "light"), "light");
  assert.equal(loadThemePreference(() => "system"), "system");
  assert.equal(loadThemePreference(() => null), "dark");
  assert.equal(loadThemePreference(() => "bogus"), "dark");
  assert.equal(loadThemePreference(() => ""), "dark");
});

test("loadThemePreference: a throwing reader degrades to the session default", () => {
  assert.equal(
    loadThemePreference(() => {
      throw new Error("storage unavailable");
    }),
    "dark",
  );
});

test("saveThemePreference writes the preference verbatim under the legacy key", () => {
  const writes: Array<{ key: string; value: string }> = [];
  saveThemePreference((key, value) => writes.push({ key, value }), "system");
  saveThemePreference((key, value) => writes.push({ key, value }), "dark");
  assert.deepEqual(writes, [
    { key: themePreferenceStorageKey, value: "system" },
    { key: themePreferenceStorageKey, value: "dark" },
  ]);
});

test("saveThemePreference: a throwing writer is swallowed (session-only effect)", () => {
  assert.doesNotThrow(() =>
    saveThemePreference(() => {
      throw new Error("storage unavailable");
    }, "light"),
  );
});

test("toggledPreference lands on the opposite of the current resolved theme", () => {
  assert.equal(toggledPreference("dark"), "light");
  assert.equal(toggledPreference("light"), "dark");
});

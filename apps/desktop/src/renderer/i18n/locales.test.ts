import assert from "node:assert/strict";
import { test } from "vitest";
import { defaultLocale, localeRegistry, matchLocale, resolveInitialLocale } from "./locales.ts";

test("matchLocale: BCP 47 前缀映射,大小写不敏感", () => {
  assert.equal(matchLocale("zh-CN"), "zh-CN");
  assert.equal(matchLocale("zh-Hans-CN"), "zh-CN");
  assert.equal(matchLocale("EN-us"), "en");
  assert.equal(matchLocale("ja-JP"), "ja");
  assert.equal(matchLocale("ko"), "ko");
  assert.equal(matchLocale("fr-FR"), null);
  assert.equal(matchLocale(""), null);
});

test("注册表:en 为源语言默认且恒可用", () => {
  assert.equal(defaultLocale, "en");
  const source = localeRegistry.find((entry) => entry.id === "en");
  assert.ok(source?.available);
});

test("fallback 链:存储的显式可用选择优先", () => {
  assert.equal(resolveInitialLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(resolveInitialLocale("ko", ["zh-CN"]), "ko");
});

test("fallback 链:存储值不可用或未知时落到系统探测", () => {
  assert.equal(resolveInitialLocale("fr", ["zh-Hans-CN"]), "zh-CN");
  assert.equal(resolveInitialLocale(null, ["zh-TW", "en-US"]), "zh-CN");
});

test("fallback 链:系统语言全不识别时回退默认源语言 en", () => {
  assert.equal(resolveInitialLocale(null, ["fr-FR", "de-DE"]), "en");
  assert.equal(resolveInitialLocale(null, []), "en");
});

test("all four delivered languages match a fresh profile's OS preferences", () => {
  assert.equal(resolveInitialLocale(null, ["zh-Hans-CN"]), "zh-CN");
  assert.equal(resolveInitialLocale(null, ["en-GB"]), "en");
  assert.equal(resolveInitialLocale(null, ["ja-JP"]), "ja");
  assert.equal(resolveInitialLocale(null, ["ko-KR"]), "ko");
  assert.equal(resolveInitialLocale(null, ["fr-FR", "ja-JP"]), "ja");
});

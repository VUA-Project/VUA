import { defaultLocale, resolveInitialLocale, type LocaleId } from "./locales.ts";
import { strings as en, type Strings } from "./strings.en.ts";
import { storageKeys } from "../app/storage-keys.ts";
import { systemLanguages } from "./system-languages.ts";

/**
 * 当前语言表(C-I18N):应用启动时按 fallback 链选表一次;
 * 语言切换经设置页写入存储后整页重载生效(桌面工具纪律,
 * 与场景切换同模式,免去全应用响应式换表的复杂度)。
 *
 * 源语言 en 静态引入保底;非 en 已交付语言表按需动态导入,
 * 冷启动只拉取当前生效语言包,未登记或加载异常回落源语言 en。
 */

const loaders: Partial<Record<Exclude<LocaleId, "en">, () => Promise<{ readonly strings: Strings }>>> = {
  "zh-CN": () => import("./strings.zh-CN.ts"),
  "zh-TW": () => import("./strings.zh-TW.ts"),
  ja: () => import("./strings.ja.ts"),
  ko: () => import("./strings.ko.ts"),
};

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(storageKeys.locale);
  } catch {
    return null;
  }
}

const requestedLocale: LocaleId = (() => {
  const resolved = resolveInitialLocale(readStoredLocale(), systemLanguages());
  return resolved === "en" || loaders[resolved] !== undefined ? resolved : defaultLocale;
})();

const loadedStrings: Strings | null = await (async (): Promise<Strings | null> => {
  if (requestedLocale === "en") return en;
  const load = loaders[requestedLocale];
  if (!load) return null;
  try {
    return (await load()).strings;
  } catch {
    return null;
  }
})();

export const currentLocale: LocaleId = loadedStrings !== null ? requestedLocale : defaultLocale;

export const currentStrings: Strings = loadedStrings ?? en;

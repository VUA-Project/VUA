import { defaultLocale, resolveInitialLocale, type LocaleId } from "./locales.ts";
import { strings as zhCN } from "./strings.zh-CN.ts";
import { strings as en, type Strings } from "./strings.en.ts";
import { strings as ja } from "./strings.ja.ts";
import { strings as ko } from "./strings.ko.ts";
import { storageKeys } from "../app/storage-keys.ts";
import { systemLanguages } from "./system-languages.ts";

/**
 * 当前语言表(C-I18N):应用启动时按 fallback 链选表一次;
 * 语言切换经设置页写入存储后整页重载生效(桌面工具纪律,
 * 与场景切换同模式,免去全应用响应式换表的复杂度)。
 *
 * 已交付语言表在此登记(与 locales.ts 注册表 available 同步);
 * 未登记的 locale 解析结果回落源语言 en,绝不返回残缺表。
 */

const tables: Partial<Record<LocaleId, Strings>> = { "zh-CN": zhCN, en, ja, ko };

function readStoredLocale(): string | null {
  try {
    return localStorage.getItem(storageKeys.locale);
  } catch {
    return null;
  }
}

export const currentLocale: LocaleId = (() => {
  const resolved = resolveInitialLocale(readStoredLocale(), systemLanguages());
  return tables[resolved] !== undefined ? resolved : defaultLocale;
})();

export const currentStrings: Strings = tables[currentLocale] ?? en;

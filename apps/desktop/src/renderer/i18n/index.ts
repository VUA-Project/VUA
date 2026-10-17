/**
 * i18n 统一入口:业务代码只从本模块取字符串与术语,不直接引用具体语言表。
 *
 * C-I18N:strings 指向 current-table 按 fallback 链选出的当前语言表
 * (en 为源语言;新语言表交付后在 current-table.ts 登记);
 * 术语注释(terms.ts)同步按当前表取。语言切换经设置页写存储后
 * 整页重载生效,业务代码不感知换表。
 *
 * 注意:terms.ts 内部引用 current-table.ts 取术语注释,属模块内
 * 实现细节;演示数据负载文案(strings.fixtures.zh-CN.ts)为 DEV 专用,
 * 不经过本入口。
 */
export { currentLocale, currentStrings as strings } from "./current-table.ts";
export type { Strings } from "./strings.en.ts";
export {
  defaultLocale,
  localeRegistry,
  matchLocale,
  resolveInitialLocale,
  type LocaleId,
  type LocaleMeta,
} from "./locales.ts";
export { format } from "./format.ts";
export { TERMS, termLabel, termNote, termSequence, type TermId } from "./terms.ts";

export { formatDateTime, formatShortDateTime } from "./date-time.ts";

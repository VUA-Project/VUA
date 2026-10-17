import { currentLocale } from "./current-table.ts";
import type { LocaleId } from "./locales.ts";

/** A short local month, day and time for telling same-named items apart. */
export function formatShortDateTime(date: Date, locale: LocaleId = currentLocale): string {
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Preserve invalid upstream values instead of inventing a timestamp; keep the user's timezone. */
export function formatDateTime(value: string, locale: LocaleId = currentLocale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

import { isCatalogTimestampV01 } from "./catalog-enrichment-v01.js";

/** Manual Avatar-scoped BOOTH free-asset discovery v0.1; no background polling or BDL writes. */
export const FREE_ASSET_CATEGORY_IDS_V01 = [
  "209",
  "230",
  "231",
  "217",
  "214",
  "215",
  "216",
  "127",
] as const;

export const FREE_ASSET_DEFAULT_CATEGORY_IDS_V01 = [
  "209",
  "230",
  "231",
  "217",
  "214",
] as const;

export const FREE_ASSET_MAX_STORED_KEYWORDS_V01 = 20;
export const FREE_ASSET_MAX_ENABLED_KEYWORDS_V01 = 5;
export const FREE_ASSET_COOLDOWN_MS_V01 = 300_000;

export type FreeAssetCategoryIdV01 = typeof FREE_ASSET_CATEGORY_IDS_V01[number];

export interface FreeAssetWatchedKeywordV01 {
  readonly keyword: string;
  readonly enabled: boolean;
}

export interface FreeAssetItemV01 {
  readonly productId: string;
  readonly title: string;
  readonly shopName: string | null;
  readonly categoryId: FreeAssetCategoryIdV01 | null;
  readonly categoryLabel: string | null;
  readonly thumbnailUrl: string | null;
  readonly matchedKeywords: readonly string[];
  readonly isSample: boolean;
  readonly hasDateCue: boolean;
  readonly owned: boolean;
}

export interface FreeAssetsStateV01 {
  readonly schemaVersion: "0.1";
  readonly watchedKeywords: readonly FreeAssetWatchedKeywordV01[];
  readonly suggestedKeywords: readonly string[];
  readonly enabledCategories: readonly FreeAssetCategoryIdV01[];
  readonly hideOwned: boolean;
  readonly showSamples: boolean;
  readonly dismissedProductIds: readonly string[];
  readonly lastQueriedAt: string | null;
  readonly items: readonly FreeAssetItemV01[];
}

export interface FreeAssetsStateParamsV01 {
  readonly schemaVersion: "0.1";
}

export interface FreeAssetsUpdatePreferencesParamsV01 {
  readonly schemaVersion: "0.1";
  readonly watchedKeywords?: readonly FreeAssetWatchedKeywordV01[];
  readonly enabledCategories?: readonly FreeAssetCategoryIdV01[];
  readonly hideOwned?: boolean;
  readonly showSamples?: boolean;
  readonly dismissProductId?: string;
  readonly clearDismissed?: boolean;
}

export interface FreeAssetsIngestSearchPageParamsV01 {
  readonly schemaVersion: "0.1";
  readonly keyword: string;
  readonly sourceUrl: string;
  readonly html: string;
  readonly fetchedAt: string;
  readonly resetCache: boolean;
}

export type FreeAssetsDesktopErrorV01 =
  | "busy"
  | "cooldown"
  | "no_keywords"
  | "sign_in_required"
  | "rate_limited"
  | "network_failed"
  | "parse_failed";

export interface FreeAssetsDesktopStatusV01 {
  readonly schemaVersion: "0.1";
  readonly running: boolean;
  readonly currentKeyword: string | null;
  readonly completedKeywords: number;
  readonly totalKeywords: number;
  readonly cooldownUntilMs: number | null;
  readonly lastError: FreeAssetsDesktopErrorV01 | null;
}

export type FreeAssetsQueryTargetV01 = string | readonly string[] | null | undefined;

export interface FreeAssetsDesktopApiV01 {
  status(): Promise<FreeAssetsDesktopStatusV01>;
  query(target?: FreeAssetsQueryTargetV01): Promise<FreeAssetsDesktopStatusV01>;
  cancel(): Promise<void>;
  subscribe(listener: (status: FreeAssetsDesktopStatusV01) => void): () => void;
}

/** Normalizes an optional desktop query target into `null` (use watched keywords),
 * a deduplicated 1..5 keyword array, or `"invalid"`. */
export function normalizeFreeAssetsQueryTargetV01(
  target: unknown,
): readonly string[] | null | "invalid" {
  if (target === undefined || target === null) return null;
  if (typeof target === "string") {
    const trimmed = target.trim();
    return isFreeAssetKeywordV01(trimmed) ? [trimmed] : "invalid";
  }
  if (Array.isArray(target)) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of target) {
      if (typeof item !== "string") return "invalid";
      const trimmed = item.trim();
      if (!isFreeAssetKeywordV01(trimmed)) return "invalid";
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
    if (out.length < 1 || out.length > FREE_ASSET_MAX_ENABLED_KEYWORDS_V01) return "invalid";
    return out;
  }
  return "invalid";
}

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).sort().join() === [...keys].sort().join();
const scalarLength = (s: string) => Array.from(s).length;

export function boothFreeAssetsBrowseUrl(keyword: string): string {
  return `https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?q=${encodeURIComponent(keyword)}&max_price=0&sort=new&in_stock=true`;
}

export const isFreeAssetProductIdV01 = (v: unknown): v is string =>
  typeof v === "string" && /^booth:[1-9][0-9]{0,19}$/.test(v);

export const isFreeAssetCategoryIdV01 = (v: unknown): v is FreeAssetCategoryIdV01 =>
  typeof v === "string" && (FREE_ASSET_CATEGORY_IDS_V01 as readonly string[]).includes(v);

export function isFreeAssetKeywordV01(v: unknown): v is string {
  return (
    typeof v === "string"
    && v.trim() === v
    && scalarLength(v) >= 1
    && scalarLength(v) <= 80
    && !/[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u.test(v)
  );
}

export function isFreeAssetThumbnailUrlV01(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== "string" || !/^https:\/\/booth\.pximg\.net\/[^\s"'<>#]+$/u.test(v)) return false;
  try {
    const parsed = new URL(v);
    return (
      parsed.protocol === "https:"
      && parsed.hostname === "booth.pximg.net"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.hash === ""
    );
  } catch {
    return false;
  }
}

function isWatchedKeywordList(v: unknown): v is readonly FreeAssetWatchedKeywordV01[] {
  if (!Array.isArray(v) || v.length > FREE_ASSET_MAX_STORED_KEYWORDS_V01) return false;
  const seen = new Set<string>();
  let enabledCount = 0;
  for (const row of v) {
    if (!record(row) || !exact(row, ["keyword", "enabled"])) return false;
    if (!isFreeAssetKeywordV01(row.keyword) || typeof row.enabled !== "boolean") return false;
    if (seen.has(row.keyword)) return false;
    seen.add(row.keyword);
    if (row.enabled) enabledCount += 1;
  }
  return enabledCount <= FREE_ASSET_MAX_ENABLED_KEYWORDS_V01;
}

function isEnabledCategoryList(v: unknown): v is readonly FreeAssetCategoryIdV01[] {
  return (
    Array.isArray(v)
    && v.length <= FREE_ASSET_CATEGORY_IDS_V01.length
    && v.every(isFreeAssetCategoryIdV01)
    && new Set(v).size === v.length
  );
}

const PREF_KEYS = new Set([
  "schemaVersion",
  "watchedKeywords",
  "enabledCategories",
  "hideOwned",
  "showSamples",
  "dismissProductId",
  "clearDismissed",
]);

export function isFreeAssetsParamsV01(method: string, v: unknown): boolean {
  if (!record(v) || v.schemaVersion !== "0.1") return false;
  if (method === "freeAssets.state") {
    return exact(v, ["schemaVersion"]);
  }
  if (method === "freeAssets.updatePreferences") {
    const keys = Object.keys(v);
    if (keys.length < 2 || keys.some(k => !PREF_KEYS.has(k))) return false;
    if (v.watchedKeywords !== undefined && !isWatchedKeywordList(v.watchedKeywords)) return false;
    if (v.enabledCategories !== undefined && !isEnabledCategoryList(v.enabledCategories)) return false;
    if (v.hideOwned !== undefined && typeof v.hideOwned !== "boolean") return false;
    if (v.showSamples !== undefined && typeof v.showSamples !== "boolean") return false;
    if (v.dismissProductId !== undefined && !isFreeAssetProductIdV01(v.dismissProductId)) return false;
    if (v.clearDismissed !== undefined && typeof v.clearDismissed !== "boolean") return false;
    return true;
  }
  if (method === "freeAssets.ingestSearchPage") {
    if (!exact(v, ["schemaVersion", "keyword", "sourceUrl", "html", "fetchedAt", "resetCache"])) return false;
    return (
      isFreeAssetKeywordV01(v.keyword)
      && v.sourceUrl === boothFreeAssetsBrowseUrl(v.keyword)
      && typeof v.html === "string"
      && v.html.length >= 1
      && new TextEncoder().encode(v.html).length <= 5_000_000
      && isCatalogTimestampV01(v.fetchedAt)
      && typeof v.resetCache === "boolean"
    );
  }
  return false;
}

export function isFreeAssetsStateV01(v: unknown): v is FreeAssetsStateV01 {
  if (!record(v) || v.schemaVersion !== "0.1") return false;
  if (
    !exact(v, [
      "schemaVersion",
      "watchedKeywords",
      "suggestedKeywords",
      "enabledCategories",
      "hideOwned",
      "showSamples",
      "dismissedProductIds",
      "lastQueriedAt",
      "items",
    ])
  ) {
    return false;
  }
  if (!isWatchedKeywordList(v.watchedKeywords) || !isEnabledCategoryList(v.enabledCategories)) return false;
  if (
    !Array.isArray(v.suggestedKeywords)
    || v.suggestedKeywords.length > FREE_ASSET_MAX_STORED_KEYWORDS_V01
    || !v.suggestedKeywords.every(isFreeAssetKeywordV01)
    || new Set(v.suggestedKeywords).size !== v.suggestedKeywords.length
  ) {
    return false;
  }
  if (typeof v.hideOwned !== "boolean" || typeof v.showSamples !== "boolean") return false;
  if (
    !Array.isArray(v.dismissedProductIds)
    || v.dismissedProductIds.length > 2000
    || !v.dismissedProductIds.every(isFreeAssetProductIdV01)
    || new Set(v.dismissedProductIds).size !== v.dismissedProductIds.length
  ) {
    return false;
  }
  if (v.lastQueriedAt !== null && !isCatalogTimestampV01(v.lastQueriedAt)) return false;
  if (!Array.isArray(v.items) || v.items.length > 300) return false;
  const seenProducts = new Set<string>();
  for (const raw of v.items) {
    if (!record(raw)) return false;
    if (
      !exact(raw, [
        "productId",
        "title",
        "shopName",
        "categoryId",
        "categoryLabel",
        "thumbnailUrl",
        "matchedKeywords",
        "isSample",
        "hasDateCue",
        "owned",
      ])
    ) {
      return false;
    }
    if (!isFreeAssetProductIdV01(raw.productId) || seenProducts.has(raw.productId)) return false;
    seenProducts.add(raw.productId);
    if (typeof raw.title !== "string" || scalarLength(raw.title) < 1 || scalarLength(raw.title) > 1000) return false;
    if (
      raw.shopName !== null
      && (typeof raw.shopName !== "string" || scalarLength(raw.shopName) < 1 || scalarLength(raw.shopName) > 500)
    ) {
      return false;
    }
    if (raw.categoryId !== null && !isFreeAssetCategoryIdV01(raw.categoryId)) return false;
    if (
      raw.categoryLabel !== null
      && (typeof raw.categoryLabel !== "string" || scalarLength(raw.categoryLabel) < 1 || scalarLength(raw.categoryLabel) > 120)
    ) {
      return false;
    }
    if (!isFreeAssetThumbnailUrlV01(raw.thumbnailUrl)) return false;
    if (
      !Array.isArray(raw.matchedKeywords)
      || raw.matchedKeywords.length < 1
      || raw.matchedKeywords.length > FREE_ASSET_MAX_ENABLED_KEYWORDS_V01
      || !raw.matchedKeywords.every(isFreeAssetKeywordV01)
      || new Set(raw.matchedKeywords).size !== raw.matchedKeywords.length
    ) {
      return false;
    }
    if (
      typeof raw.isSample !== "boolean"
      || typeof raw.hasDateCue !== "boolean"
      || typeof raw.owned !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

const DESKTOP_ERRORS = new Set<string>([
  "busy",
  "cooldown",
  "no_keywords",
  "sign_in_required",
  "rate_limited",
  "network_failed",
  "parse_failed",
]);

export function isFreeAssetsDesktopStatusV01(v: unknown): v is FreeAssetsDesktopStatusV01 {
  if (!record(v) || v.schemaVersion !== "0.1") return false;
  if (
    !exact(v, [
      "schemaVersion",
      "running",
      "currentKeyword",
      "completedKeywords",
      "totalKeywords",
      "cooldownUntilMs",
      "lastError",
    ])
  ) {
    return false;
  }
  return (
    typeof v.running === "boolean"
    && (v.currentKeyword === null || isFreeAssetKeywordV01(v.currentKeyword))
    && Number.isInteger(v.completedKeywords)
    && Number(v.completedKeywords) >= 0
    && Number.isInteger(v.totalKeywords)
    && Number(v.totalKeywords) >= 0
    && Number(v.totalKeywords) <= FREE_ASSET_MAX_ENABLED_KEYWORDS_V01
    && (v.cooldownUntilMs === null || (typeof v.cooldownUntilMs === "number" && Number.isFinite(v.cooldownUntilMs) && v.cooldownUntilMs >= 0))
    && (v.lastError === null || (typeof v.lastError === "string" && DESKTOP_ERRORS.has(v.lastError)))
  );
}

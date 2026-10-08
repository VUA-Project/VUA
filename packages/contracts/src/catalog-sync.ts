// ---- catalog-sync v0.2 wire vocabulary (v0.1 frozen 2026-10-02; v0.2 adds libraryType 2026-10-02) ----
// TS mirror of `schemas/catalog-sync/v0.2/{request,response}.schema.json` (v0.1 requests also accepted)
// and the Rust route `catalog.ingestLibraryPage` (field-for-field,
// deny-unknown-fields). The Electron partition-session reader reports one
// archived BOOTH account-library page per request; requests never carry
// cookies, session tokens or credentials. Any vocabulary change must bump
// the schema version — never rewrite in place.

export const CATALOG_SYNC_SCHEMA_VERSION = "0.2" as const;

/** One archived library page, Electron reader → provider. */
export interface CatalogSyncPageRequestV01 {
  readonly schemaVersion: typeof CATALOG_SYNC_SCHEMA_VERSION;
  /** The page URL the HTML was fetched from (library pagination URL). */
  readonly sourceUrl: string;
  /** The archived page body verbatim. */
  readonly html: string;
  /** RFC 3339 observation time of the fetch (never a BOOTH publish time). */
  readonly fetchedAt: string;
  /** Page ordinal for correlation; the provider derives no behavior from it. */
  readonly pageNumber?: number;
  /** Sync-run identity stamped into every observation this run writes. */
  readonly runId?: string;
  /** v0.2: which account library the page lists (BDL v0.3 column). */
  readonly libraryType?: "bought" | "gifts" | "free_downloads";
}

/** A per-item closed-set violation reported by the fold, never dropped. */
export interface CatalogSyncRejectedItemV01 {
  readonly index: number;
  readonly code: string;
  readonly reason: string;
}

/** Success value of `catalog.ingestLibraryPage` (application value body). */
export interface CatalogSyncPageResultV01 {
  readonly schemaVersion: typeof CATALOG_SYNC_SCHEMA_VERSION;
  readonly sourceUrl: string;
  readonly parsedCount: number;
  readonly upsertedCount: number;
  readonly rejectedItems: readonly CatalogSyncRejectedItemV01[];
  /** Observed pagination continuation; null on the last page. */
  readonly nextPageUrl: string | null;
}

export function isCatalogSyncPageRequestV01(value: unknown): value is CatalogSyncPageRequestV01 {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Partial<CatalogSyncPageRequestV01>;
  return (
    request.schemaVersion === CATALOG_SYNC_SCHEMA_VERSION &&
    typeof request.sourceUrl === "string" &&
    request.sourceUrl.length > 0 &&
    typeof request.html === "string" &&
    request.html.length > 0 &&
    typeof request.fetchedAt === "string" &&
    request.fetchedAt.length > 0 &&
    (request.pageNumber === undefined || (typeof request.pageNumber === "number" && request.pageNumber >= 1)) &&
    (request.runId === undefined || (typeof request.runId === "string" && request.runId.length > 0)) &&
    (request.libraryType === undefined ||
      request.libraryType === "bought" ||
      request.libraryType === "gifts" ||
      request.libraryType === "free_downloads")
  );
}

export function isCatalogSyncPageResultV01(value: unknown): value is CatalogSyncPageResultV01 {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<CatalogSyncPageResultV01>;
  return (
    result.schemaVersion === CATALOG_SYNC_SCHEMA_VERSION &&
    typeof result.sourceUrl === "string" &&
    result.sourceUrl.length > 0 &&
    typeof result.parsedCount === "number" &&
    result.parsedCount >= 0 &&
    typeof result.upsertedCount === "number" &&
    result.upsertedCount >= 0 &&
    Array.isArray(result.rejectedItems) &&
    result.rejectedItems.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CatalogSyncRejectedItemV01).index === "number" &&
        typeof (item as CatalogSyncRejectedItemV01).code === "string" &&
        typeof (item as CatalogSyncRejectedItemV01).reason === "string",
    ) &&
    (result.nextPageUrl === null || (typeof result.nextPageUrl === "string" && result.nextPageUrl.length > 0))
  );
}

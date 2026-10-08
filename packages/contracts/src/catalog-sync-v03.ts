/** Whole-run catalog sync. Frozen page faces v0.1/v0.2 remain separate. */
export const CATALOG_SYNC_RUN_SCHEMA_VERSION = "0.3" as const;
export type CatalogLibraryType = "bought" | "gifts" | "free_downloads";

export interface CatalogSyncBeginV03 {
  readonly schemaVersion: "0.3";
  readonly runId: string;
  readonly libraryTypes: readonly CatalogLibraryType[];
}

export interface CatalogSyncPageV03 {
  readonly schemaVersion: "0.3";
  readonly runId: string;
  readonly libraryType: CatalogLibraryType;
  readonly pageNumber: number;
  readonly sourceUrl: string;
  readonly html: string;
  readonly fetchedAt: string;
}

export interface CatalogSyncFinishV03 {
  readonly schemaVersion: "0.3";
  readonly runId: string;
  readonly outcome: "completed" | "failed" | "cancelled" | "page_limit_reached";
  readonly errorCode?: string;
}

export interface CatalogSyncStatusV03 {
  readonly schemaVersion: "0.3";
  readonly runId: string;
}

export interface CatalogSyncPageResultV03 {
  readonly schemaVersion: "0.3";
  readonly sourceUrl: string;
  readonly parsedCount: number;
  readonly upsertedCount: number;
  readonly rejectedItems: readonly { readonly index: number; readonly code: string; readonly reason: string }[];
  readonly nextPageUrl: string | null;
  readonly cancellationRequested: boolean;
}

export interface CatalogSyncSnapshotV03 {
  readonly schemaVersion: "0.3";
  readonly runId: string;
  readonly taskId: string;
  readonly revision: number;
  readonly state: "running" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled";
  readonly cancellationRequested: boolean;
  readonly recoveryDisposition: "none" | "inspect_required";
  readonly libraryTypes: readonly CatalogLibraryType[];
  readonly completedLibraryTypes: readonly CatalogLibraryType[];
  readonly pages: number;
  readonly parsedCount: number;
  readonly upsertedCount: number;
  readonly rejectedCount: number;
  readonly nextPageUrl: string | null;
  readonly errorCode: string | null;
}

const libraries: readonly unknown[] = ["bought", "gifts", "free_downloads"];
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const runId = (value: unknown): value is string => typeof value === "string" && /^catalog-sync-[A-Za-z0-9_.:-]{1,115}$/.test(value);

export function isCatalogSyncParamsV03(method: string, value: unknown): boolean {
  if (!record(value) || value.schemaVersion !== "0.3" || !runId(value.runId)) return false;
  if (method === "catalog.beginLibrarySync") {
    return exact(value, ["schemaVersion", "runId", "libraryTypes"])
      && Array.isArray(value.libraryTypes) && value.libraryTypes.length > 0 && value.libraryTypes.length <= 3
      && value.libraryTypes.every((type) => libraries.includes(type))
      && new Set(value.libraryTypes).size === value.libraryTypes.length;
  }
  if (method === "catalog.ingestLibraryPage") {
    return exact(value, ["schemaVersion", "runId", "libraryType", "pageNumber", "sourceUrl", "html", "fetchedAt"])
      && libraries.includes(value.libraryType) && count(value.pageNumber) && value.pageNumber > 0 && value.pageNumber <= 50
      && typeof value.sourceUrl === "string" && value.sourceUrl.length > 0
      && typeof value.html === "string" && value.html.length > 0
      && typeof value.fetchedAt === "string" && Number.isFinite(Date.parse(value.fetchedAt));
  }
  if (method === "catalog.finishLibrarySync") {
    const hasError = Object.hasOwn(value, "errorCode");
    return exact(value, hasError ? ["schemaVersion", "runId", "outcome", "errorCode"] : ["schemaVersion", "runId", "outcome"])
      && ["completed", "failed", "cancelled", "page_limit_reached"].includes(value.outcome as string)
      && (hasError ? typeof value.errorCode === "string" && /^[a-z0-9_.]{1,128}$/.test(value.errorCode) && value.outcome !== "completed" : value.outcome !== "failed");
  }
  return method === "catalog.librarySyncStatus" && exact(value, ["schemaVersion", "runId"]);
}

export function isCatalogSyncPageResultV03(value: unknown): value is CatalogSyncPageResultV03 {
  return record(value) && exact(value, ["schemaVersion", "sourceUrl", "parsedCount", "upsertedCount", "rejectedItems", "nextPageUrl", "cancellationRequested"])
    && value.schemaVersion === "0.3" && typeof value.sourceUrl === "string" && value.sourceUrl.length > 0
    && count(value.parsedCount) && count(value.upsertedCount) && value.upsertedCount <= value.parsedCount
    && Array.isArray(value.rejectedItems) && value.rejectedItems.every((item) => record(item) && exact(item, ["index", "code", "reason"]) && count(item.index) && typeof item.code === "string" && typeof item.reason === "string")
    && (value.nextPageUrl === null || typeof value.nextPageUrl === "string" && value.nextPageUrl.length > 0)
    && typeof value.cancellationRequested === "boolean";
}

export function isCatalogSyncSnapshotV03(value: unknown): value is CatalogSyncSnapshotV03 {
  return record(value) && exact(value, ["schemaVersion", "runId", "taskId", "revision", "state", "cancellationRequested", "recoveryDisposition", "libraryTypes", "completedLibraryTypes", "pages", "parsedCount", "upsertedCount", "rejectedCount", "nextPageUrl", "errorCode"])
    && value.schemaVersion === "0.3" && runId(value.runId) && value.taskId === value.runId && count(value.revision) && value.revision > 0
    && ["running", "succeeded", "succeeded_with_warnings", "failed", "cancelled"].includes(value.state as string)
    && typeof value.cancellationRequested === "boolean" && ["none", "inspect_required"].includes(value.recoveryDisposition as string)
    && Array.isArray(value.libraryTypes) && value.libraryTypes.length > 0 && value.libraryTypes.every((type) => libraries.includes(type))
    && Array.isArray(value.completedLibraryTypes) && value.completedLibraryTypes.every((type) => (value.libraryTypes as unknown[]).includes(type))
    && count(value.pages) && count(value.parsedCount) && count(value.upsertedCount) && count(value.rejectedCount)
    && (value.nextPageUrl === null || typeof value.nextPageUrl === "string") && (value.errorCode === null || typeof value.errorCode === "string");
}

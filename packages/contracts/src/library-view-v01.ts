import type { CatalogPriceV03, WarehouseEntryCardV03 } from "./application-contract.js";
import { isLibraryDownloadSnapshotV01, type LibraryDownloadSnapshotV01 } from "./library-download-v01.js";

export interface LibraryListParamsV01 {
  readonly schemaVersion: "0.1";
  readonly source?: "all" | "local" | "bought" | "gifts" | "free_downloads";
  readonly state?: "all" | "downloaded" | "cloud_only" | "missing" | "in_progress" | "attention";
  readonly text?: string; readonly availabilityStatus?: "available" | "unavailable" | "unknown";
  readonly limit?: number; readonly offset?: number;
}
export interface LibraryProductFilesParamsV01 { readonly schemaVersion: "0.1"; readonly productId: string }
export interface LibraryStorageV01 {
  readonly state: "cloud_only" | "present" | "partial" | "missing" | "changed" | "unreadable";
  readonly storedCopies: number; readonly presentCopies: number; readonly missingCopies: number;
  readonly changedCopies: number; readonly unreadableCopies: number;
  readonly supersededGeneratedCopies: number; readonly currentGeneratedCopies: number;
  readonly productionQualification: "not_evaluated";
}
export interface LibraryProductV01 {
  readonly productId: string; readonly title: string | null; readonly libraryType: "bought" | "gifts" | "free_downloads" | null;
  readonly importedArtifacts: number; readonly shopName: string | null; readonly variantName: string | null;
  readonly price: CatalogPriceV03 | null; readonly imageUrl: string | null; readonly imageUrls: readonly string[];
  readonly availabilityRaw: string | null; readonly availabilityStatus: "available" | "unavailable" | "unknown";
  readonly entityCount: 0; readonly entityTypes: readonly [];
}
export type LibraryRowV01 =
  | { readonly kind: "product"; readonly product: LibraryProductV01; readonly sources: readonly ("bought" | "gifts" | "free_downloads")[];
      readonly storage: LibraryStorageV01; readonly operation: LibraryDownloadSnapshotV01 | null }
  | { readonly kind: "local"; readonly entry: WarehouseEntryCardV03; readonly storage: LibraryStorageV01 };
export interface LibraryListV01 {
  readonly schemaVersion: "0.1"; readonly total: number; readonly offset: number; readonly limit: number; readonly items: readonly LibraryRowV01[];
}
export interface LibraryProductFilesV01 {
  readonly schemaVersion: "0.1"; readonly productId: string;
  readonly items: readonly {
    readonly downloadableId: number; readonly fileName: string; readonly managedCopyId: string | null;
    readonly copies: readonly { readonly copyId: string; readonly entryId: string; readonly fileName: string;
      readonly artifactSha256: string; readonly presence: "present" | "missing" | "changed" | "unreadable" }[];
  }[];
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean => required.every((key) => key in v) && Object.keys(v).every((key) => required.includes(key) || optional.includes(key));
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const nullable = (v: unknown): boolean => v === null || typeof v === "string";
const product = (v: unknown): boolean => typeof v === "string" && /^booth:[0-9]+$/.test(v);
const sha = (v: unknown): boolean => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const source = (v: unknown): boolean => ["bought", "gifts", "free_downloads"].includes(String(v));
const words = (v: unknown, values: readonly string[]): boolean => typeof v === "string" && values.includes(v);
export function isLibraryViewParamsV01(method: string, v: unknown): boolean {
  if (!record(v) || v.schemaVersion !== "0.1") return false;
  if (method === "library.productFiles") return exact(v, ["schemaVersion", "productId"]) && product(v.productId);
  return method === "library.list" && exact(v, ["schemaVersion"], ["source", "state", "text", "availabilityStatus", "limit", "offset"])
    && (v.source === undefined || words(v.source, ["all", "local", "bought", "gifts", "free_downloads"]))
    && (v.state === undefined || words(v.state, ["all", "downloaded", "cloud_only", "missing", "in_progress", "attention"]))
    && (v.text === undefined || typeof v.text === "string" && Array.from(v.text).length <= 1000)
    && (v.availabilityStatus === undefined || words(v.availabilityStatus, ["available", "unavailable", "unknown"]))
    && (v.limit === undefined || integer(v.limit) && v.limit > 0 && v.limit <= 200)
    && (v.offset === undefined || integer(v.offset));
}
export function isLibraryStorageV01(v: unknown): v is LibraryStorageV01 {
  if (!record(v) || !exact(v, ["state", "storedCopies", "presentCopies", "missingCopies", "changedCopies", "unreadableCopies", "supersededGeneratedCopies", "currentGeneratedCopies", "productionQualification"])
    || !words(v.state, ["cloud_only", "present", "partial", "missing", "changed", "unreadable"]) || v.productionQualification !== "not_evaluated"
    || ![v.storedCopies, v.presentCopies, v.missingCopies, v.changedCopies, v.unreadableCopies, v.supersededGeneratedCopies, v.currentGeneratedCopies].every(integer)
    || Number(v.supersededGeneratedCopies) + Number(v.currentGeneratedCopies) > Number(v.storedCopies) || Number(v.currentGeneratedCopies) > Number(v.presentCopies)) return false;
  const expected = v.storedCopies === 0 ? "cloud_only" : Number(v.unreadableCopies) > 0 ? "unreadable"
    : Number(v.changedCopies) > 0 ? "changed" : v.presentCopies === v.storedCopies ? "present" : v.presentCopies === 0 ? "missing" : "partial";
  return v.state === expected && v.storedCopies === Number(v.presentCopies) + Number(v.missingCopies) + Number(v.changedCopies) + Number(v.unreadableCopies);
}
function isProduct(v: unknown): v is LibraryProductV01 {
  if (!record(v) || !exact(v, ["productId", "title", "libraryType", "importedArtifacts", "shopName", "variantName", "price", "imageUrl", "imageUrls", "availabilityRaw", "availabilityStatus", "entityCount", "entityTypes"])
    || !product(v.productId) || ![v.title, v.shopName, v.variantName, v.imageUrl, v.availabilityRaw].every(nullable)
    || !(v.libraryType === null || source(v.libraryType)) || !integer(v.importedArtifacts)
    || !Array.isArray(v.imageUrls) || !v.imageUrls.every(text) || !words(v.availabilityStatus, ["available", "unavailable", "unknown"])
    || v.entityCount !== 0 || !Array.isArray(v.entityTypes) || v.entityTypes.length !== 0) return false;
  if (v.price === null) return true;
  return record(v.price) && exact(v.price, ["amount", "currency"], ["high"]) && text(v.price.amount) && text(v.price.currency) && (v.price.high === undefined || text(v.price.high));
}
function isEntry(v: unknown): v is WarehouseEntryCardV03 {
  return record(v) && exact(v, ["warehouseItemId", "folderName", "displayName", "kind", "createdAt", "artifactMode", "effectiveArtifactMode", "artifacts"])
    && [v.warehouseItemId, v.folderName, v.displayName, v.createdAt].every(text) && words(v.kind, ["imported_material", "downloaded_material"])
    && (v.artifactMode === null || words(v.artifactMode, ["use_original_unitypackage", "generate_vpm"])) && words(v.effectiveArtifactMode, ["use_original_unitypackage", "generate_vpm"])
    && Array.isArray(v.artifacts) && v.artifacts.every((a) => record(a) && exact(a, ["relativePath", "artifactSha256", "state", "sizeBytes", "role"])
      && text(a.relativePath) && sha(a.artifactSha256) && words(a.state, ["pending", "clean", "quarantined"]) && integer(a.sizeBytes) && words(a.role, ["original", "generated_vpm"]));
}
export function isLibraryListV01(v: unknown): v is LibraryListV01 {
  return record(v) && exact(v, ["schemaVersion", "total", "offset", "limit", "items"]) && v.schemaVersion === "0.1" && integer(v.total) && integer(v.offset)
    && integer(v.limit) && v.limit > 0 && v.limit <= 200 && Array.isArray(v.items) && v.items.length <= v.limit
    && v.items.every((row) => {
      if (!record(row) || !isLibraryStorageV01(row.storage)) return false;
      if (row.kind === "local") return exact(row, ["kind", "entry", "storage"]) && isEntry(row.entry);
      return row.kind === "product" && exact(row, ["kind", "product", "sources", "storage", "operation"]) && isProduct(row.product)
        && row.product.importedArtifacts === row.storage.presentCopies && Array.isArray(row.sources) && row.sources.every(source) && new Set(row.sources).size === row.sources.length
        && (row.operation === null || isLibraryDownloadSnapshotV01(row.operation) && row.operation.productId === row.product.productId);
    });
}
export function isLibraryProductFilesV01(v: unknown): v is LibraryProductFilesV01 {
  return record(v) && exact(v, ["schemaVersion", "productId", "items"]) && v.schemaVersion === "0.1" && product(v.productId) && Array.isArray(v.items)
    && v.items.every((file) => record(file) && exact(file, ["downloadableId", "fileName", "managedCopyId", "copies"])
      && integer(file.downloadableId) && file.downloadableId > 0 && typeof file.fileName === "string" && (file.managedCopyId === null || text(file.managedCopyId))
      && Array.isArray(file.copies) && file.copies.every((copy) => record(copy) && exact(copy, ["copyId", "entryId", "fileName", "artifactSha256", "presence"])
        && [copy.copyId, copy.entryId, copy.fileName].every(text) && sha(copy.artifactSha256) && words(copy.presence, ["present", "missing", "changed", "unreadable"]))
      && new Set(file.copies.map((copy: Record<string, unknown>) => copy.copyId)).size === file.copies.length
      && (file.managedCopyId === null || file.copies.some((copy: Record<string, unknown>) => copy.copyId === file.managedCopyId)))
    && new Set(v.items.map((file: Record<string, unknown>) => file.downloadableId)).size === v.items.length;
}

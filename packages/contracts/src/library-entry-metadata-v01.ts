export interface LibraryEntryMetadataQueryV01 { readonly schemaVersion: "0.1"; readonly entryId: string }
export interface LibraryEntryMetadataV01 extends LibraryEntryMetadataQueryV01 {
  readonly revision: number; readonly displayName: string; readonly productId: string | null; readonly thumbnailRef: string | null;
}
export interface LibraryEntryMetadataUpdateV01 extends LibraryEntryMetadataQueryV01 {
  readonly expectedRevision: number; readonly displayName: string; readonly productId: string | null; readonly thumbnailRef: string | null;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every((key) => key in v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const revision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const name = (v: unknown) => typeof v === "string" && v.trim().length > 0 && Array.from(v).length <= 500 && !/[\u0000-\u001f\u007f-\u009f]/.test(v);
const source = (v: unknown) => v === null || typeof v === "string" && /^booth:[0-9]+$/.test(v);
export const isLocalThumbnailRefV01 = (v: unknown): v is string => typeof v === "string" && /^vua-img:\/\/local\/[a-f0-9]{64}$/.test(v);
const thumbnail = (v: unknown) => v === null || isLocalThumbnailRefV01(v);
export function isLibraryEntryMetadataParamsV01(method: string, v: unknown): boolean {
  if (!record(v) || v.schemaVersion !== "0.1" || !id(v.entryId)) return false;
  if (method === "library.entryMetadata") return exact(v, ["schemaVersion", "entryId"]);
  return method === "library.updateEntryMetadata" && exact(v, ["schemaVersion", "entryId", "expectedRevision", "displayName", "productId", "thumbnailRef"])
    && revision(v.expectedRevision) && v.expectedRevision < Number.MAX_SAFE_INTEGER && name(v.displayName) && source(v.productId) && thumbnail(v.thumbnailRef);
}
export function isLibraryEntryMetadataV01(v: unknown): v is LibraryEntryMetadataV01 {
  return record(v) && exact(v, ["schemaVersion", "entryId", "revision", "displayName", "productId", "thumbnailRef"])
    && v.schemaVersion === "0.1" && id(v.entryId) && revision(v.revision) && name(v.displayName) && source(v.productId) && thumbnail(v.thumbnailRef);
}

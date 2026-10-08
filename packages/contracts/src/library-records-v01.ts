export interface LibraryRemoveLocalEntriesV01 { readonly schemaVersion: "0.1"; readonly entryIds: readonly string[] }
export type LibraryRemovedLocalEntriesV01 = LibraryRemoveLocalEntriesV01;
export function isLibraryRemoveLocalEntriesV01(v: unknown): v is LibraryRemoveLocalEntriesV01 {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return Object.keys(p).length === 2 && p.schemaVersion === "0.1" && Array.isArray(p.entryIds)
    && p.entryIds.length > 0 && p.entryIds.length <= 200 && new Set(p.entryIds).size === p.entryIds.length
    && p.entryIds.every((id: unknown) => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(id));
}

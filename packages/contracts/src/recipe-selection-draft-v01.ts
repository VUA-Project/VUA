export interface RecipeSelectionV01 {
  readonly identity: string; readonly displayName: string; readonly source: "cloud" | "local";
  readonly variantName?: string | null; readonly shopName?: string | null; readonly warehouseItemId?: string | null;
}
export interface RecipeDraftListParamsV01 { readonly schemaVersion: "0.1" }
export interface RecipeDraftGetParamsV01 { readonly schemaVersion: "0.1"; readonly draftId: string }
export interface RecipeDraftSaveParamsV01 extends RecipeDraftGetParamsV01 {
  readonly title: string; readonly baseRevision: number; readonly selections: readonly RecipeSelectionV01[];
}
export interface RecipeDraftAddParamsV01 extends RecipeDraftGetParamsV01 {
  readonly baseRevision: number; readonly selections: readonly RecipeSelectionV01[];
}
export interface RecipeSelectionDraftV01 {
  readonly schemaVersion: "0.1"; readonly kind: "selection_draft"; readonly draftId: string;
  readonly title: string; readonly createdAt: string; readonly selections: readonly RecipeSelectionV01[];
}
export interface RecipeDraftReadV01 {
  readonly schemaVersion: "0.1"; readonly document: RecipeSelectionDraftV01; readonly revision: number; readonly updatedAt: string;
  readonly addedCount?: number; readonly existingCount?: number;
}
export interface RecipeDraftListV01 {
  readonly schemaVersion: "0.1"; readonly entries: readonly { readonly draftId: string; readonly title: string;
    readonly revision: number; readonly updatedAt: string; readonly selectionCount: number }[];
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[], optional: readonly string[] = []): boolean => keys.every((key) => key in v) && Object.keys(v).every((key) => keys.includes(key) || optional.includes(key));
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const bounded = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && Array.from(v).length <= max;
const stamp = (v: unknown): boolean => typeof v === "string" && Number.isFinite(Date.parse(v));
export const isRecipeSelectionDraftId = (v: unknown): v is string => typeof v === "string" && /^recipe-draft-[A-Za-z0-9_-]{1,100}$/.test(v);
export function isRecipeSelectionV01(v: unknown): v is RecipeSelectionV01 {
  if (!record(v) || !exact(v, ["identity", "displayName", "source"], ["variantName", "shopName", "warehouseItemId"]) || !bounded(v.displayName, 512)
    || typeof v.identity !== "string" || ![v.variantName, v.shopName].every((v) => v === undefined || v === null || typeof v === "string" && Array.from(v).length <= 512)
    || !(v.warehouseItemId === undefined || v.warehouseItemId === null || typeof v.warehouseItemId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v.warehouseItemId))) return false;
  return v.source === "cloud" ? /^booth:[0-9]+$/.test(v.identity) && (v.warehouseItemId === undefined || v.warehouseItemId === null)
    : v.source === "local" && /^sha256:[a-f0-9]{64}$/.test(v.identity);
}
export function isRecipeDraftParamsV01(method: string, v: unknown): boolean {
  if (!record(v) || v.schemaVersion !== "0.1") return false;
  if (method === "recipeDraft.list") return exact(v, ["schemaVersion"]);
  if (!isRecipeSelectionDraftId(v.draftId)) return false;
  if (method === "recipeDraft.get" || method === "recipeDraft.selectionStatus") return exact(v, ["schemaVersion", "draftId"]);
  if (!integer(v.baseRevision) || v.baseRevision >= Number.MAX_SAFE_INTEGER || !Array.isArray(v.selections) || v.selections.length > 512 || !v.selections.every(isRecipeSelectionV01)) return false;
  if (method === "recipeDraft.addSelection") return exact(v, ["schemaVersion", "draftId", "baseRevision", "selections"]);
  return method === "recipeDraft.save" && exact(v, ["schemaVersion", "draftId", "title", "baseRevision", "selections"]) && bounded(v.title, 120);
}
export function isRecipeDraftReadV01(v: unknown): v is RecipeDraftReadV01 {
  if (!record(v) || !exact(v, ["schemaVersion", "document", "revision", "updatedAt"], ["addedCount", "existingCount"]) || v.schemaVersion !== "0.1"
    || !integer(v.revision) || v.revision === 0 || !stamp(v.updatedAt) || !record(v.document)) return false;
  const d = v.document;
  return exact(d, ["schemaVersion", "kind", "draftId", "title", "createdAt", "selections"]) && d.schemaVersion === "0.1" && d.kind === "selection_draft"
    && isRecipeSelectionDraftId(d.draftId) && bounded(d.title, 120) && stamp(d.createdAt) && Array.isArray(d.selections) && d.selections.length <= 512 && d.selections.every(isRecipeSelectionV01)
    && (v.addedCount === undefined && v.existingCount === undefined || integer(v.addedCount) && integer(v.existingCount) && v.addedCount + v.existingCount <= 512 && v.addedCount <= d.selections.length);
}
export function isRecipeDraftListV01(v: unknown): v is RecipeDraftListV01 {
  return record(v) && exact(v, ["schemaVersion", "entries"]) && v.schemaVersion === "0.1" && Array.isArray(v.entries)
    && v.entries.every((entry) => record(entry) && exact(entry, ["draftId", "title", "revision", "updatedAt", "selectionCount"])
      && isRecipeSelectionDraftId(entry.draftId) && bounded(entry.title, 120) && integer(entry.revision) && entry.revision > 0 && stamp(entry.updatedAt) && integer(entry.selectionCount) && entry.selectionCount <= 512);
}
export interface RecipeDraftSelectionStatusV01 {
  readonly schemaVersion: "0.1"; readonly draftId: string; readonly revision: number;
  readonly items: readonly { readonly index: number; readonly storedCopies: number; readonly presentCopies: number; readonly state: "present" | "missing" | "not_stored" }[];
}
export function isRecipeDraftSelectionStatusV01(v: unknown): v is RecipeDraftSelectionStatusV01 {
  return record(v) && exact(v, ["schemaVersion", "draftId", "revision", "items"]) && v.schemaVersion === "0.1" && isRecipeSelectionDraftId(v.draftId)
    && integer(v.revision) && v.revision > 0 && Array.isArray(v.items) && v.items.length <= 512 && v.items.every((item, index) => record(item)
      && exact(item, ["index", "storedCopies", "presentCopies", "state"]) && item.index === index && integer(item.storedCopies) && integer(item.presentCopies)
      && item.presentCopies <= item.storedCopies && item.state === (item.presentCopies > 0 ? "present" : item.storedCopies === 0 ? "not_stored" : "missing"));
}

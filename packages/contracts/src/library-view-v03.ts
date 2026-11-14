import { isLibraryViewParamsV01, isLibraryListV01, type LibraryListParamsV01, type LibraryListV01, type LibraryRowV01 } from "./library-view-v01.js";

/** How the library is ordered; each direction a player would ask for is its own word. */
export const LIBRARY_SORTS = ["added_desc", "added_asc", "title_asc", "title_desc", "shop_asc", "price_asc", "price_desc", "published_desc", "size_desc", "size_asc"] as const;
export type LibrarySort = typeof LIBRARY_SORTS[number];
/** Observed file format families derived from captured BOOTH downloadables and local warehouse copies without disk reads. */
export const LIBRARY_FORMATS = ["unitypackage", "vrm", "glb", "gltf"] as const;
export type LibraryFormatV03 = typeof LIBRARY_FORMATS[number];
export const LIBRARY_FORMAT_FILTERS = ["vrm_or_glb", "unitypackage"] as const;
export type LibraryFormatFilterV03 = typeof LIBRARY_FORMAT_FILTERS[number];
/** VN3 items a filter can require. X is the creator's free text, so it has no value to compare. */
export const LIBRARY_VN3_ITEMS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W"] as const;
export type LibraryVn3Item = typeof LIBRARY_VN3_ITEMS[number];
export const LIBRARY_VN3_STATES = ["readable", "no_vn3", "unread", "unreadable"] as const;
export type LibraryVn3State = typeof LIBRARY_VN3_STATES[number];
export interface LibraryVn3FilterV03 { readonly state?: LibraryVn3State; readonly items?: readonly LibraryVn3Item[]; readonly includeContact?: boolean }
export type LibraryListParamsV03 = Omit<LibraryListParamsV01, "schemaVersion"> & { readonly schemaVersion: "0.3"; readonly sort?: LibrarySort; readonly format?: LibraryFormatFilterV03; readonly vn3?: LibraryVn3FilterV03 };
export interface LibraryVn3RowV03 { readonly state: LibraryVn3State; readonly match: "allowed" | "conditional" | "contact" | null; readonly hasSpecialNote: boolean }
export type LibraryRowV03 = LibraryRowV01 & { readonly addedAt: string | null; readonly purchasedAt?: string | null; readonly publishedAt: string | null; readonly sizeBytes: number; readonly formats?: readonly LibraryFormatV03[]; readonly vn3?: LibraryVn3RowV03 };
export interface LibraryVn3CountsV03 { readonly readable: number; readonly noVn3: number; readonly unread: number; readonly unreadable: number; readonly items: Readonly<Record<LibraryVn3Item, number>> }
export type LibraryListV03 = Omit<LibraryListV01, "schemaVersion" | "items"> & { readonly schemaVersion: "0.3"; readonly items: readonly LibraryRowV03[]; readonly vn3Counts?: LibraryVn3CountsV03 };

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const includes = (values: readonly unknown[], value: unknown) => values.includes(value);
function isVn3Filter(value: unknown): value is LibraryVn3FilterV03 {
  if (!record(value) || Object.keys(value).some(key => !["state", "items", "includeContact"].includes(key))) return false;
  if (Object.hasOwn(value, "state") && !includes(LIBRARY_VN3_STATES, value.state)) return false;
  if (Object.hasOwn(value, "includeContact") && typeof value.includeContact !== "boolean") return false;
  if (!Object.hasOwn(value, "items")) return true;
  return Array.isArray(value.items) && value.items.every(item => includes(LIBRARY_VN3_ITEMS, item)) && new Set(value.items).size === value.items.length;
}
function isFormatsRow(value: unknown): value is readonly LibraryFormatV03[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= LIBRARY_FORMATS.length
    && value.every(item => includes(LIBRARY_FORMATS, item)) && new Set(value).size === value.length;
}
export function isLibraryListParamsV03(value: unknown): value is LibraryListParamsV03 {
  if (!record(value) || value.schemaVersion !== "0.3") return false;
  const { sort, format, vn3, ...previous } = value;
  return isLibraryViewParamsV01("library.list", { ...previous, schemaVersion: "0.1" })
    && (!Object.hasOwn(value, "sort") || includes(LIBRARY_SORTS, sort))
    && (!Object.hasOwn(value, "format") || includes(LIBRARY_FORMAT_FILTERS, format))
    && (!Object.hasOwn(value, "vn3") || isVn3Filter(vn3));
}
function isVn3Row(value: unknown): value is LibraryVn3RowV03 {
  return record(value) && Object.keys(value).length === 3 && includes(LIBRARY_VN3_STATES, value.state)
    && (value.match === null || includes(["allowed", "conditional", "contact"], value.match)) && typeof value.hasSpecialNote === "boolean";
}
function isVn3Counts(value: unknown): value is LibraryVn3CountsV03 {
  return record(value) && Object.keys(value).length === 5 && [value.readable, value.noVn3, value.unread, value.unreadable].every(count)
    && record(value.items) && Object.keys(value.items).length === LIBRARY_VN3_ITEMS.length && LIBRARY_VN3_ITEMS.every(item => count((value.items as Record<string, unknown>)[item]));
}
const date = (value: unknown) => value === null || typeof value === "string" && value.length > 0;
export function isLibraryListV03(value: unknown): value is LibraryListV03 {
  if (!record(value) || value.schemaVersion !== "0.3" || !Array.isArray(value.items)) return false;
  const { vn3Counts, ...list } = value;
  if (Object.hasOwn(value, "vn3Counts") && !isVn3Counts(vn3Counts)) return false;
  const items: unknown[] = [];
  for (const row of value.items) {
    if (!record(row) || !date(row.addedAt) || (Object.hasOwn(row, "purchasedAt") && !date(row.purchasedAt)) || !date(row.publishedAt) || !count(row.sizeBytes)
      || (Object.hasOwn(row, "formats") && !isFormatsRow(row.formats))
      || (Object.hasOwn(row, "vn3") && !isVn3Row(row.vn3))) return false;
    const { addedAt: _added, purchasedAt: _purchased, publishedAt: _published, sizeBytes: _size, formats: _formats, vn3: _vn3, ...previous } = row;
    items.push(previous);
  }
  return isLibraryListV01({ ...list, schemaVersion: "0.1", items });
}

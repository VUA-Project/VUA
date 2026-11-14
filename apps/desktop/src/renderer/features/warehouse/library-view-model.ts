/** What the Materials page remembers and asks for: its order, view, VN3 filter and place in the wall. */
import { LIBRARY_SORTS, type LibraryFormatFilterV03, type LibrarySort, type LibraryVn3FilterV03, type LibraryVn3Item, type LibraryVn3State } from "@vua/contracts";
import { storageKeys } from "../../app/storage-keys.ts";

export type LibraryViewMode = "cards" | "list";

/** The material a history entry shows. Opening one adds an entry, so the back and forward side buttons leave and
 * re-enter it; stepping to a neighbour stays on the same entry. */
export interface LibraryDetailEntry { readonly product?: string | undefined; readonly local?: string | undefined }
export function historyDetail(): LibraryDetailEntry | null {
  return (window.history.state as { vuaLibraryDetail?: LibraryDetailEntry } | null)?.vuaLibraryDetail ?? null;
}
export function syncHistoryDetail(wanted: LibraryDetailEntry | null): void {
  const shown = historyDetail();
  if (wanted?.product === shown?.product && wanted?.local === shown?.local) return;
  if (wanted === null) { window.history.back(); return; }
  const state = { ...window.history.state, vuaLibraryDetail: wanted };
  if (shown === null) window.history.pushState(state, "");
  else window.history.replaceState(state, "");
}

const comparable = (text: string): string => text.trim().replace(/\s+/gu, " ").toLowerCase();
/** The purchased variation, unless BOOTH's row only repeats the product's name. */
export function shownVariant(title: string | null | undefined, variant: string | null | undefined): string | null {
  if (!variant) return null;
  return title && comparable(title) === comparable(variant) ? null : variant;
}
export const DEFAULT_LIBRARY_SORT: LibrarySort = "added_desc";

export function storedLibrarySort(): LibrarySort {
  try {
    const value = localStorage.getItem(storageKeys.librarySort);
    return (LIBRARY_SORTS as readonly (string | null)[]).includes(value) ? value as LibrarySort : DEFAULT_LIBRARY_SORT;
  } catch { return DEFAULT_LIBRARY_SORT; }
}
export function rememberLibrarySort(sort: LibrarySort): void {
  try { localStorage.setItem(storageKeys.librarySort, sort); } catch { /* The order applies to this visit. */ }
}
export function storedLibraryView(): LibraryViewMode {
  try { return localStorage.getItem(storageKeys.libraryView) === "list" ? "list" : "cards"; } catch { return "cards"; }
}
export function rememberLibraryView(view: LibraryViewMode): void {
  try { localStorage.setItem(storageKeys.libraryView, view); } catch { /* The view applies to this visit. */ }
}

export interface LibraryVn3Choice { readonly state: LibraryVn3State | null; readonly items: readonly LibraryVn3Item[]; readonly includeContact: boolean }
export const NO_VN3_CHOICE: LibraryVn3Choice = { state: null, items: [], includeContact: false };
export const vn3ChoiceActive = (choice: LibraryVn3Choice): boolean => choice.state !== null || choice.items.length > 0;
/** Letters stay in VN3 order, so one choice always reads as one query. */
export function toggleVn3Item(choice: LibraryVn3Choice, item: LibraryVn3Item): LibraryVn3Choice {
  const items = choice.items.includes(item) ? choice.items.filter(other => other !== item) : [...choice.items, item].sort();
  return { ...choice, items };
}
export function vn3FilterWire(choice: LibraryVn3Choice): LibraryVn3FilterV03 {
  return { ...(choice.state === null ? {} : { state: choice.state }), ...(choice.items.length === 0 ? {} : { items: choice.items }), ...(choice.includeContact ? { includeContact: true } : {}) };
}

/** The filter panel's order. Related uses sit together; W, the transfer of rights, is left to the details. */
export const VN3_FILTER_GROUPS: readonly { readonly id: "use" | "upload" | "expression" | "modify" | "distribute" | "media" | "derivative" | "credit"; readonly items: readonly LibraryVn3Item[] }[] = [
  { id: "use", items: ["A", "B"] },
  { id: "upload", items: ["C", "D", "E"] },
  { id: "modify", items: ["I", "J", "K", "L"] },
  { id: "expression", items: ["F", "G", "H"] },
  { id: "media", items: ["O", "P", "Q", "R"] },
  { id: "distribute", items: ["M", "N"] },
  { id: "derivative", items: ["S", "T", "U"] },
  { id: "credit", items: ["V"] },
];

/** Which fact a card shows so a non-default order explains itself. */
export type LibrarySortFact = "size" | "price" | "published" | "added" | null;
export function sortFactOf(sort: LibrarySort): LibrarySortFact {
  switch (sort) {
    case "size_desc": case "size_asc": return "size";
    case "price_asc": case "price_desc": return "price";
    case "published_desc": return "published";
    case "added_asc": return "added";
    default: return null;
  }
}

/** The list's column headers sort by their own column; a second click reverses where that makes sense. */
/** BOOTH's publish date arrives with some product pages only, so that choice appears once a row has one. */
export function offeredLibrarySorts(current: LibrarySort, rows: Iterable<{ readonly publishedAt?: string | null | undefined }>): readonly LibrarySort[] {
  const dated = [...rows].some(row => row.publishedAt);
  return LIBRARY_SORTS.filter(option => option !== "published_desc" || dated || current === option);
}

export type LibraryHeaderColumn = "title" | "shop" | "size" | "added";
export function nextHeaderSort(column: LibraryHeaderColumn, current: LibrarySort): LibrarySort {
  switch (column) {
    case "shop": return "shop_asc";
    case "title": return current === "title_asc" ? "title_desc" : "title_asc";
    case "size": return current === "size_desc" ? "size_asc" : "size_desc";
    case "added": return current === "added_desc" ? "added_asc" : "added_desc";
  }
}
export function headerSortState(column: LibraryHeaderColumn, sort: LibrarySort): "ascending" | "descending" | "none" {
  switch (column) {
    case "shop": return sort === "shop_asc" ? "ascending" : "none";
    case "title": return sort === "title_asc" ? "ascending" : sort === "title_desc" ? "descending" : "none";
    case "size": return sort === "size_asc" ? "ascending" : sort === "size_desc" ? "descending" : "none";
    case "added": return sort === "added_asc" ? "ascending" : sort === "added_desc" ? "descending" : "none";
  }
}

const DEFAULT_COLUMNS: readonly number[] = [3.6, 1.5, 1, 0.8, 1];
/** Widths survive a damaged or older record by falling back to the defaults. */
export function readLibraryColumns(): readonly number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKeys.libraryColumns) ?? "null");
    return Array.isArray(value) && value.length === DEFAULT_COLUMNS.length && value.every(width => typeof width === "number" && Number.isFinite(width) && width > 0) ? value as number[] : DEFAULT_COLUMNS;
  } catch { return DEFAULT_COLUMNS; }
}
export function rememberLibraryColumns(widths: readonly number[]): void {
  try { localStorage.setItem(storageKeys.libraryColumns, JSON.stringify(widths.map(width => Math.round(width)))); } catch { /* The widths apply to this visit. */ }
}

export interface LibraryNeighbours<T> { readonly index: number; readonly total: number; readonly previous: T | null; readonly next: T | null }
export function neighboursOf<T>(order: readonly T[], matches: (item: T) => boolean): LibraryNeighbours<T> {
  const index = order.findIndex(matches);
  return { index, total: order.length, previous: index > 0 ? order[index - 1]! : null, next: index >= 0 && index + 1 < order.length ? order[index + 1]! : null };
}

/** Filters and place survive a visit to another page within one session of the app. */
export interface LibrarySession {
  readonly text: string; readonly source: "all" | "bought" | "gifts" | "free" | "local";
  readonly downloadState: "all" | "downloaded" | "not-downloaded" | "missing" | "in_progress" | "attention";
  readonly sourceCategory: string; readonly format: "all" | LibraryFormatFilterV03; readonly vn3: LibraryVn3Choice; readonly wanted: number; readonly scrollTop: number;
}
export const EMPTY_LIBRARY_SESSION: LibrarySession = { text: "", source: "all", downloadState: "all", sourceCategory: "all", format: "all", vn3: NO_VN3_CHOICE, wanted: 100, scrollTop: 0 };
let session = EMPTY_LIBRARY_SESSION;
export const readLibrarySession = (): LibrarySession => session;
export const saveLibrarySession = (next: LibrarySession): void => { session = next; };
export const libraryFiltersActive = (value: Pick<LibrarySession, "text" | "source" | "downloadState" | "sourceCategory" | "format" | "vn3">): boolean =>
  value.text.trim() !== "" || value.source !== "all" || value.downloadState !== "all" || value.sourceCategory !== "all" || value.format !== "all" || vn3ChoiceActive(value.vn3);

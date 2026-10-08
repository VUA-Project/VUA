export interface LibraryImportParamsV01 {
  readonly schemaVersion: "0.1";
  readonly sourceFolders: readonly string[];
  readonly autoGenerate?: boolean;
}
export interface LibraryImportAcceptedV01 {
  readonly schemaVersion: "0.1";
  readonly operation: "library.importFolders";
  readonly taskId: string;
  readonly correlationId: string;
}
export function isLibraryImportParamsV01(v: unknown): v is LibraryImportParamsV01 {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return p.schemaVersion === "0.1" && Object.keys(p).every((key) => ["schemaVersion", "sourceFolders", "autoGenerate"].includes(key))
    && (!('autoGenerate' in p) || typeof p.autoGenerate === "boolean")
    && Array.isArray(p.sourceFolders) && p.sourceFolders.length > 0 && p.sourceFolders.length <= 200
    && p.sourceFolders.every((s) => typeof s === "string" && s.length > 0 && !s.includes("\0") && /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/.test(s))
    && new Set(p.sourceFolders.map((s: string) => s.replaceAll("\\", "/").toLowerCase())).size === p.sourceFolders.length;
}
export function isLibraryImportAcceptedV01(v: unknown): v is LibraryImportAcceptedV01 {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const p = v as Record<string, unknown>;
  return p.schemaVersion === "0.1" && p.operation === "library.importFolders"
    && Object.keys(p).length === 4 && typeof p.taskId === "string" && p.taskId.length > 0
    && typeof p.correlationId === "string" && p.correlationId.length > 0;
}

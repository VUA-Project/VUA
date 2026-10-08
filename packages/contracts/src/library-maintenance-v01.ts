export interface LibraryTargetV01 { readonly kind: "product" | "entry"; readonly id: string }
export interface LibraryRemovalPreviewParamsV01 { readonly schemaVersion: "0.1"; readonly target: LibraryTargetV01; readonly copyIds?: readonly string[] }
export interface LibraryRemoveFilesParamsV01 { readonly schemaVersion: "0.1"; readonly removalId: string; readonly target: LibraryTargetV01; readonly copyIds: readonly string[]; readonly previewHash: string }
export interface LibraryRemovalStatusParamsV01 { readonly schemaVersion: "0.1"; readonly removalId: string }
export interface LibraryPendingRemovalsParamsV01 { readonly schemaVersion: "0.1"; readonly target: LibraryTargetV01 }
export interface LibraryResolveRemovalParamsV01 extends LibraryRemovalStatusParamsV01 { readonly observedRevision: number }
export interface LibraryPendingRemovalsV01 extends LibraryPendingRemovalsParamsV01 { readonly items: readonly LibraryRemovalSnapshotV01[] }
export interface LibraryRemovalPreviewV01 {
  readonly schemaVersion: "0.1"; readonly target: LibraryTargetV01; readonly previewHash: string;
  readonly referenceCoverage: "drafts_only" | "drafts_and_recipes";
  readonly unresolvedRecipeAssets: number;
  readonly files: readonly { readonly copyId: string; readonly entryId: string; readonly fileName: string;
    readonly role: "original" | "generated_vpm"; readonly artifactSha256: string; readonly sizeBytes: number;
    readonly presence: "present" | "missing" | "changed" | "unreadable"; readonly superseded: boolean }[];
  readonly references: readonly { readonly kind: "draft" | "recipe"; readonly id: string; readonly title: string;
    readonly revision: number; readonly copyIds: readonly string[]; readonly missingAfterRemoval: boolean }[];
}
export interface LibraryRemovalSnapshotV01 {
  readonly schemaVersion: "0.1"; readonly removalId: string; readonly target: LibraryTargetV01; readonly taskId: string;
  readonly taskState: "queued" | "preparing" | "running" | "waiting_for_input" | "paused" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled";
  readonly revision: number; readonly cancelRequested: boolean; readonly recoveryDisposition: "none" | "inspect_required";
  readonly state: "running" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled" | "unconfirmed";
  readonly inspectionResolved?: true;
  readonly files: readonly { readonly copyId: string; readonly entryId: string; readonly fileName: string;
    readonly phase: "pending" | "removed" | "already_missing" | "failed" | "kept" | "missing_after_inspection"; readonly errorCode: string | null }[];
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean => required.every((key) => key in v) && Object.keys(v).every((key) => required.includes(key) || optional.includes(key));
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const hash = (v: unknown): v is string => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
const word = (v: unknown, values: readonly string[]): boolean => typeof v === "string" && values.includes(v);
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= 200 && v.every(id) && new Set(v).size === v.length;
export const isLibraryRemovalIdV01 = (v: unknown): v is string => typeof v === "string" && /^library-removal-[A-Za-z0-9_.:-]{1,100}$/.test(v);
export function isLibraryTargetV01(v: unknown): v is LibraryTargetV01 {
  return record(v) && exact(v, ["kind", "id"]) && (v.kind === "product" ? typeof v.id === "string" && /^booth:[0-9]+$/.test(v.id) : v.kind === "entry" && id(v.id));
}
export function isLibraryMaintenanceParamsV01(method: string, v: unknown): boolean {
  if (!record(v) || v.schemaVersion !== "0.1") return false;
  if (method === "library.removalStatus") return exact(v, ["schemaVersion", "removalId"]) && isLibraryRemovalIdV01(v.removalId);
  if (method === "library.resolveRemoval") return exact(v, ["schemaVersion", "removalId", "observedRevision"]) && isLibraryRemovalIdV01(v.removalId) && integer(v.observedRevision) && v.observedRevision > 0;
  if (!isLibraryTargetV01(v.target)) return false;
  if (method === "library.removalPreview") return exact(v, ["schemaVersion", "target"], ["copyIds"]) && (!('copyIds' in v) || ids(v.copyIds));
  if (method === "library.pendingRemovals") return exact(v, ["schemaVersion", "target"]);
  return method === "library.removeFiles" && exact(v, ["schemaVersion", "removalId", "target", "copyIds", "previewHash"]) && isLibraryRemovalIdV01(v.removalId) && ids(v.copyIds) && hash(v.previewHash);
}
export function isLibraryRemovalPreviewV01(v: unknown): v is LibraryRemovalPreviewV01 {
  return record(v) && exact(v, ["schemaVersion", "target", "previewHash", "files", "references", "referenceCoverage", "unresolvedRecipeAssets"]) && v.schemaVersion === "0.1" && isLibraryTargetV01(v.target) && hash(v.previewHash) && integer(v.unresolvedRecipeAssets)
    && (v.referenceCoverage !== "drafts_only" || v.unresolvedRecipeAssets === 0)
    && word(v.referenceCoverage, ["drafts_only", "drafts_and_recipes"]) && Array.isArray(v.files) && v.files.length <= 200
    && v.files.every((f) => record(f) && exact(f, ["copyId", "entryId", "fileName", "role", "artifactSha256", "sizeBytes", "presence", "superseded"])
      && id(f.copyId) && id(f.entryId) && text(f.fileName) && word(f.role, ["original", "generated_vpm"]) && hash(f.artifactSha256) && integer(f.sizeBytes)
      && word(f.presence, ["present", "missing", "changed", "unreadable"]) && typeof f.superseded === "boolean" && (!f.superseded || f.role === "generated_vpm"))
    && new Set(v.files.map((f) => f.copyId)).size === v.files.length && Array.isArray(v.references)
    && v.references.every((r) => record(r) && exact(r, ["kind", "id", "title", "revision", "copyIds", "missingAfterRemoval"]) && word(r.kind, ["draft", "recipe"])
      && id(r.id) && typeof r.title === "string" && integer(r.revision) && r.revision > 0 && Array.isArray(r.copyIds) && r.copyIds.length > 0 && r.copyIds.every(id) && new Set(r.copyIds).size === r.copyIds.length && typeof r.missingAfterRemoval === "boolean");
}
export function isLibraryRemovalSnapshotV01(v: unknown): v is LibraryRemovalSnapshotV01 {
  if (!record(v) || !exact(v, ["schemaVersion", "removalId", "target", "taskId", "taskState", "revision", "cancelRequested", "recoveryDisposition", "state", "files"], ["inspectionResolved"])
    || v.schemaVersion !== "0.1" || !isLibraryRemovalIdV01(v.removalId) || !isLibraryTargetV01(v.target) || !id(v.taskId) || !integer(v.revision) || v.revision === 0
    || typeof v.cancelRequested !== "boolean" || !word(v.recoveryDisposition, ["none", "inspect_required"]) || !Array.isArray(v.files) || v.files.length === 0 || v.files.length > 200) return false;
  if ("inspectionResolved" in v && (v.inspectionResolved !== true || v.state !== "cancelled" || v.recoveryDisposition !== "none")) return false;
  const terminal: Record<string, string> = { succeeded: "succeeded", succeeded_with_warnings: "succeeded_with_warnings", failed: "failed", cancelled: "cancelled" };
  if (typeof v.taskState === "string" && Object.hasOwn(terminal, v.taskState)) { if (v.state !== terminal[v.taskState]) return false; }
  else if (!word(v.taskState, ["queued", "preparing", "running", "waiting_for_input", "paused"]) || v.state !== (v.recoveryDisposition === "inspect_required" ? "unconfirmed" : "running")) return false;
  if (!v.files.every((f) => record(f) && exact(f, ["copyId", "entryId", "fileName", "phase", "errorCode"]) && id(f.copyId) && id(f.entryId) && text(f.fileName)
    && word(f.phase, ["pending", "removed", "already_missing", "failed", "kept", "missing_after_inspection"]) && (f.phase === "failed" ? text(f.errorCode) : f.errorCode === null))) return false;
  if (new Set(v.files.map((f) => f.copyId)).size !== v.files.length) return false;
  const phases = v.files.map((f) => f.phase);
  if (v.inspectionResolved === true && phases.includes("pending") || v.inspectionResolved !== true && phases.some((p) => p === "kept" || p === "missing_after_inspection")) return false;
  return v.state !== "succeeded" || phases.every((p) => p === "removed" || p === "already_missing");
}
export function isLibraryPendingRemovalsV01(v: unknown): v is LibraryPendingRemovalsV01 {
  return record(v) && exact(v, ["schemaVersion", "target", "items"]) && v.schemaVersion === "0.1" && isLibraryTargetV01(v.target)
    && Array.isArray(v.items) && v.items.every((item) => isLibraryRemovalSnapshotV01(item) && item.state === "unconfirmed")
    && new Set(v.items.map((item) => item.removalId)).size === v.items.length;
}

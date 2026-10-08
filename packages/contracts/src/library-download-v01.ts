export type LibraryFilePhaseV01 = "queued" | "downloading" | "downloaded" | "inspecting" | "stored" | "failed" | "cancelled" | "unconfirmed";
export interface LibraryDownloadBeginV01 {
  readonly schemaVersion: "0.1"; readonly batchId: string; readonly productId: string;
  readonly downloadableIds: readonly number[];
  readonly replacementTargets?: readonly { readonly downloadableId: number; readonly copyId: string }[];
}
export interface LibraryDownloadObservationV01 {
  readonly schemaVersion: "0.1"; readonly batchId: string; readonly downloadableId: number;
  readonly outcome: "started" | "settled" | "initiation_failed" | "cancelled" | "unconfirmed";
  readonly downloadId?: string;
}
export interface LibraryDownloadStatusV01 { readonly schemaVersion: "0.1"; readonly batchId: string }
export interface LibraryDownloadFileV01 {
  readonly downloadableId: number; readonly fileName: string; readonly phase: LibraryFilePhaseV01;
  readonly downloadId: string | null; readonly errorCode: string | null; readonly entryId: string | null;
  readonly copyId: string | null; readonly artifactSha256: string | null; readonly replaced: boolean;
}
export interface LibraryDownloadSnapshotV01 {
  readonly schemaVersion: "0.1"; readonly batchId: string; readonly taskId: string;
  readonly productId: string; readonly revision: number;
  readonly state: "running" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled";
  readonly cancellationRequested: boolean; readonly recoveryDisposition: "none" | "inspect_required";
  readonly files: readonly LibraryDownloadFileV01[];
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[], optional: readonly string[] = []): boolean => keys.every((key) => key in v) && Object.keys(v).every((key) => keys.includes(key) || optional.includes(key));
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const positive = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const nullable = (v: unknown): boolean => v === null || text(v);
export const isLibraryDownloadBatchId = (v: unknown): v is string => typeof v === "string" && /^library-download-[A-Za-z0-9_.:-]{1,100}$/.test(v);
export function isLibraryDownloadParamsV01(method: string, v: unknown): boolean {
  if (!record(v) || v.schemaVersion !== "0.1" || !isLibraryDownloadBatchId(v.batchId)) return false;
  switch (method) {
    case "library.beginDownload":
      return exact(v, ["schemaVersion", "batchId", "productId", "downloadableIds"], ["replacementTargets"])
        && typeof v.productId === "string" && /^booth:[0-9]+$/.test(v.productId)
        && Array.isArray(v.downloadableIds) && v.downloadableIds.length > 0 && v.downloadableIds.length <= 200
        && v.downloadableIds.every(positive) && new Set(v.downloadableIds).size === v.downloadableIds.length
        && (v.replacementTargets === undefined || Array.isArray(v.replacementTargets)
          && v.replacementTargets.every((item) => record(item) && exact(item, ["downloadableId", "copyId"]) && positive(item.downloadableId) && (v.downloadableIds as number[]).includes(item.downloadableId) && text(item.copyId))
          && new Set(v.replacementTargets.map((item) => (item as Record<string, unknown>).downloadableId)).size === v.replacementTargets.length);
    case "library.observeDownload": {
      if (!exact(v, ["schemaVersion", "batchId", "downloadableId", "outcome"], ["downloadId"]) || !positive(v.downloadableId)) return false;
      if (v.outcome === "started" || v.outcome === "settled") return text(v.downloadId) && v.downloadId.length <= 200;
      return ["initiation_failed", "cancelled", "unconfirmed"].includes(String(v.outcome)) && !("downloadId" in v);
    }
    case "library.downloadStatus": return exact(v, ["schemaVersion", "batchId"]);
    default: return false;
  }
}
export function isLibraryDownloadSnapshotV01(v: unknown): v is LibraryDownloadSnapshotV01 {
  if (!record(v) || !exact(v, ["schemaVersion", "batchId", "taskId", "productId", "revision", "state", "cancellationRequested", "recoveryDisposition", "files"])
    || v.schemaVersion !== "0.1" || !isLibraryDownloadBatchId(v.batchId) || v.taskId !== v.batchId
    || typeof v.productId !== "string" || !/^booth:[0-9]+$/.test(v.productId) || !positive(v.revision)
    || !["running", "succeeded", "succeeded_with_warnings", "failed", "cancelled"].includes(String(v.state))
    || typeof v.cancellationRequested !== "boolean" || !["none", "inspect_required"].includes(String(v.recoveryDisposition))
    || !Array.isArray(v.files) || v.files.length === 0 || v.files.length > 200) return false;
  const ids = new Set<number>();
  return v.files.every((file) => {
    if (!record(file) || !exact(file, ["downloadableId", "fileName", "phase", "downloadId", "errorCode", "entryId", "copyId", "artifactSha256", "replaced"])
      || !positive(file.downloadableId) || ids.has(file.downloadableId) || typeof file.fileName !== "string"
      || !["queued", "downloading", "downloaded", "inspecting", "stored", "failed", "cancelled", "unconfirmed"].includes(String(file.phase))
      || ![file.downloadId, file.errorCode, file.entryId, file.copyId, file.artifactSha256].every(nullable) || typeof file.replaced !== "boolean"
      || file.artifactSha256 !== null && (typeof file.artifactSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(file.artifactSha256))
      || file.phase === "stored" && (!text(file.entryId) || !text(file.copyId) || !text(file.artifactSha256) || !/^sha256:[a-f0-9]{64}$/.test(file.artifactSha256))) return false;
    ids.add(file.downloadableId); return true;
  });
}

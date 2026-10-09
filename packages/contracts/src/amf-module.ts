/** Optional first-party AMF lifecycle. Host-owned; never stored in BDL.
 * This separate Candidate face does not change the frozen provider frames. */
export interface AmfModuleSnapshotV01 {
  readonly schemaVersion: "0.1";
  readonly moduleId: "amf";
  readonly installed: boolean;
  readonly state: "absent" | "starting" | "ready" | "failed" | "stopping";
}

export type AmfModuleChangeResultV01 = {
  readonly outcome: "updated" | "busy" | "failed";
  readonly snapshot: AmfModuleSnapshotV01;
};

export interface AmfModuleApiV01 {
  snapshot(): Promise<AmfModuleSnapshotV01>;
  setEnabled(enabled: boolean): Promise<AmfModuleChangeResultV01>;
  subscribe(listener: (snapshot: AmfModuleSnapshotV01) => void): () => void;
}

export function isAmfModuleSnapshotV01(value: unknown): value is AmfModuleSnapshotV01 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 4 && row.schemaVersion === "0.1" && row.moduleId === "amf"
    && typeof row.installed === "boolean"
    && (row.installed ? ["starting", "ready", "failed", "stopping"].includes(row.state as string) : row.state === "absent");
}

export function isAmfModuleChangeResultV01(value: unknown): value is AmfModuleChangeResultV01 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 2 && ["updated", "busy", "failed"].includes(row.outcome as string)
    && isAmfModuleSnapshotV01(row.snapshot);
}

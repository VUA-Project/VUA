import { isLibraryRemovalPreviewV01, isLibraryRemovalSnapshotV01, isLibraryPendingRemovalsV01, type DesktopGatewayRequestV1, type LibraryTargetV01, type LibraryRemovalPreviewV01, type LibraryRemovalSnapshotV01 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
export class LibraryMaintenanceError extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface LibraryMaintenancePort {
  preview(target: LibraryTargetV01, copyIds?: readonly string[]): Promise<LibraryRemovalPreviewV01>;
  remove(removalId: string, preview: LibraryRemovalPreviewV01): Promise<LibraryRemovalSnapshotV01>;
  status(removalId: string): Promise<LibraryRemovalSnapshotV01>;
  pending(target: LibraryTargetV01): Promise<readonly LibraryRemovalSnapshotV01[]>;
  resolve(removalId: string, observedRevision: number): Promise<LibraryRemovalSnapshotV01>;
  cancel(taskId: string, revision: number): Promise<void>;
}
export function createLibraryMaintenancePort(client: GatewayClient): LibraryMaintenancePort {
  const call = async (request: DesktopGatewayRequestV1) => {
    const response = await client.invoke(request);
    if (!response.ok) throw new LibraryMaintenanceError(response.error.kind === "application" ? response.error.error.code : "read_failed");
    return response.value;
  };
  return {
    async preview(target, copyIds) {
      const value = await call({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.removalPreview", params: { schemaVersion: "0.1", target, ...(copyIds === undefined ? {} : { copyIds }) } });
      if (!isLibraryRemovalPreviewV01(value) || value.target.kind !== target.kind || value.target.id !== target.id
        || copyIds !== undefined && (value.files.length !== copyIds.length || value.files.some((file) => !copyIds.includes(file.copyId)))) throw new LibraryMaintenanceError("read_failed");
      return value;
    },
    async remove(removalId, preview) {
      const value = await call({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.removeFiles", params: { schemaVersion: "0.1", removalId, target: preview.target, copyIds: preview.files.map((file) => file.copyId), previewHash: preview.previewHash } });
      if (!isLibraryRemovalSnapshotV01(value) || value.removalId !== removalId || value.target.kind !== preview.target.kind || value.target.id !== preview.target.id
        || value.files.length !== preview.files.length || value.files.some((file) => !preview.files.some((selected) => selected.copyId === file.copyId))) throw new LibraryMaintenanceError("read_failed");
      return value;
    },
    async status(removalId) {
      const value = await call({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.removalStatus", params: { schemaVersion: "0.1", removalId } });
      if (!isLibraryRemovalSnapshotV01(value) || value.removalId !== removalId) throw new LibraryMaintenanceError("read_failed");
      return value;
    },
    async cancel(taskId, observedRevision) {
      const result = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "task.requestCancellation", params: { commandId: crypto.randomUUID(), taskId, observedRevision } });
      if (!result.ok) throw new LibraryMaintenanceError("cancel_failed");
    },
    async pending(target) {
      const value = await call({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.pendingRemovals", params: { schemaVersion: "0.1", target } });
      if (!isLibraryPendingRemovalsV01(value) || value.target.kind !== target.kind || value.target.id !== target.id) throw new LibraryMaintenanceError("read_failed");
      return value.items;
    },
    async resolve(removalId, observedRevision) {
      const value = await call({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.resolveRemoval", params: { schemaVersion: "0.1", removalId, observedRevision } });
      if (!isLibraryRemovalSnapshotV01(value) || value.removalId !== removalId || value.inspectionResolved !== true) throw new LibraryMaintenanceError("read_failed");
      return value;
    },
  };
}

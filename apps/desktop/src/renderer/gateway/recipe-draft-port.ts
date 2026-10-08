import { isRecipeDraftListV01, isRecipeDraftReadV01, isRecipeDraftSelectionStatusV01, type RecipeDraftSelectionStatusV01 } from "@vua/contracts";
import type { GatewayClient, GatewayResult } from "./gateway-client.ts";
import type { RecipeAssetRef } from "./recipe-port.ts";
export interface RecipeDraftSummary { readonly draftId: string; readonly title: string; readonly revision: number; readonly updatedAt: string; readonly selectionCount: number }
export interface RecipeDraftDocument {
  readonly draftId: string; readonly title: string; readonly createdAt: string; readonly selections: readonly RecipeAssetRef[];
}
export interface RecipeDraftRead { readonly document: RecipeDraftDocument; readonly revision: number; readonly updatedAt: string; readonly addedCount: number; readonly existingCount: number }
export interface RecipeDraftPort {
  list(): Promise<readonly RecipeDraftSummary[]>;
  get(draftId: string): Promise<RecipeDraftRead>;
  selectionStatus(draftId: string): Promise<RecipeDraftSelectionStatusV01>;
  save(draftId: string, title: string, selections: readonly RecipeAssetRef[], baseRevision: number): Promise<RecipeDraftRead>;
  add(draftId: string, selections: readonly RecipeAssetRef[], baseRevision: number): Promise<RecipeDraftRead>;
}
export class RecipeDraftError extends Error {
  constructor(readonly code: "revision_conflict" | "read_failed") { super(code); }
}
function read(response: GatewayResult<unknown>, draftId: string, submitted?: number): RecipeDraftRead {
  if (!response.ok || !isRecipeDraftReadV01(response.value) || response.value.document.draftId !== draftId) {
    throw new RecipeDraftError(!response.ok && response.error.kind === "application" && response.error.error.code === "vua.recipe_draft.revision_conflict" ? "revision_conflict" : "read_failed");
  }
  const value = response.value;
  if (submitted !== undefined && (value.addedCount === undefined || value.existingCount === undefined || value.addedCount + value.existingCount !== submitted)) {
    throw new RecipeDraftError("read_failed");
  }
  return { document: { draftId, title: value.document.title, createdAt: value.document.createdAt, selections: value.document.selections.map((ref) => ({ ...ref })) },
    revision: value.revision, updatedAt: value.updatedAt, addedCount: value.addedCount ?? 0, existingCount: value.existingCount ?? 0 };
}
export function createRecipeDraftPort(client: GatewayClient): RecipeDraftPort {
  return {
    async list() {
      const result = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "recipeDraft.list", params: { schemaVersion: "0.1" } });
      if (!result.ok || !isRecipeDraftListV01(result.value)) throw new RecipeDraftError("read_failed");
      return result.value.entries.map((entry) => ({ ...entry }));
    },
    async get(draftId) { return read(await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "recipeDraft.get", params: { schemaVersion: "0.1", draftId } }), draftId); },
    async selectionStatus(draftId) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "recipeDraft.selectionStatus", params: { schemaVersion: "0.1", draftId } });
      if (!response.ok || !isRecipeDraftSelectionStatusV01(response.value) || response.value.draftId !== draftId) throw new RecipeDraftError("read_failed");
      return response.value;
    },
    async save(draftId, title, selections, baseRevision) { return read(await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "recipeDraft.save", params: { schemaVersion: "0.1", draftId, title, selections, baseRevision } }), draftId); },
    async add(draftId, selections, baseRevision) {
      const submitted = new Set(selections.map((ref) => JSON.stringify([ref.source, ref.identity, ref.variantName ?? null, ref.warehouseItemId ?? null]))).size;
      return read(await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "recipeDraft.addSelection", params: { schemaVersion: "0.1", draftId, selections, baseRevision } }), draftId, submitted);
    },
  };
}

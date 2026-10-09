import { isLibraryListV01, isLibraryProductFilesV01, type LibraryListParamsV01 } from "@vua/contracts";
import type { LibraryEntryMetadataV01 } from "@vua/contracts";
import type { WarehouseEntry } from "./acquire-port.ts";
import type { CatalogListView, CatalogProductSummary } from "./catalog-browser-port.ts";
import { projectSummary } from "./catalog-browser-live.ts";
import { projectEntry } from "./live-acquire-port.ts";
import { createGatewayClient, type GatewayClient } from "./gateway-client.ts";

export interface LibraryStorageFacts {
  readonly state: "cloud_only" | "present" | "partial" | "missing" | "changed" | "unreadable";
  readonly storedCopies: number; readonly presentCopies: number; readonly missingCopies: number;
  readonly changedCopies: number; readonly unreadableCopies: number;
  readonly supersededGeneratedCopies: number; readonly currentGeneratedCopies: number;
  readonly productionQualification: "not_evaluated";
  readonly unexpandedArchives?: number;
}
export interface LibraryCardFacts {
  readonly storage: LibraryStorageFacts;
  readonly sources: readonly ("bought" | "gifts" | "free_downloads")[];
  readonly operation: { readonly taskId: string; readonly state: string; readonly inspectRequired: boolean } | null;
  readonly copyIds?: readonly string[];
  readonly localEntries?: readonly { readonly entryId: string; readonly displayName: string }[];
  readonly metadata?: LibraryEntryMetadataV01;
  readonly sourceMatch?: { readonly product: CatalogProductSummary; readonly basis: "mapping" | "product_id" | "name"; readonly content: "unverified" | "different" };
}
export interface LibraryPageView {
  readonly catalog: CatalogListView;
  readonly localEntries: readonly WarehouseEntry[];
  readonly facts: ReadonlyMap<string, LibraryCardFacts>;
  readonly total: number; readonly offset: number; readonly limit: number;
}
export interface LibraryFileInventory {
  readonly productId: string;
  readonly items: readonly { readonly downloadableId: number; readonly fileName: string; readonly managedCopyId: string | null;
    readonly copies: readonly { readonly copyId: string; readonly entryId: string; readonly fileName: string;
      readonly artifactSha256: string; readonly presence: "present" | "missing" | "changed" | "unreadable" }[] }[];
}
export interface LibraryBrowserPort {
  list(query: LibraryListParamsV01): Promise<LibraryPageView>;
  productFiles(productId: string): Promise<LibraryFileInventory>;
}
export function createLiveLibraryBrowserPort(client: GatewayClient): LibraryBrowserPort {
  return {
    async list(query) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.list", params: query });
      if (!response.ok || !isLibraryListV01(response.value)) throw new Error("library_read_failed");
      const items = []; const localEntries: WarehouseEntry[] = []; const facts = new Map<string, LibraryCardFacts>();
      for (const row of response.value.items) {
        if (row.kind === "product") {
          const product = projectSummary(row.product);
          if (product === null) throw new Error("library_product_invalid");
          items.push(product);
          facts.set(product.productId, { storage: row.storage, sources: row.sources, ...(row.copyIds === undefined ? {} : { copyIds: row.copyIds }), operation: row.operation === null ? null : {
            taskId: row.operation.taskId, state: row.operation.state, inspectRequired: row.operation.recoveryDisposition === "inspect_required",
          }, ...(row.localEntries === undefined ? {} : { localEntries: row.localEntries }) });
        } else {
          const entry = projectEntry(row.entry);
          if (entry === null) throw new Error("library_entry_invalid");
          const sourceProduct = row.sourceMatch === undefined ? undefined : projectSummary(row.sourceMatch.product);
          if (sourceProduct === null) throw new Error("library_source_invalid");
          localEntries.push(entry); facts.set(entry.warehouseItemId, { storage: row.storage, sources: row.sourceMatch?.sources ?? [], operation: null,
            ...(row.metadata === undefined ? {} : { metadata: row.metadata }),
            ...(row.copyIds === undefined ? {} : { copyIds: row.copyIds }),
            ...(row.sourceMatch === undefined || sourceProduct === undefined ? {} : { sourceMatch: { product: sourceProduct, basis: row.sourceMatch.basis, content: row.sourceMatch.content } }),
          });
        }
      }
      return { catalog: { schemaVersion: 1, kind: "results", items, total: response.value.total,
        vocabulary: { availabilities: ["available", "unavailable", "unknown"], entityTypes: [], relationKinds: [] } },
      localEntries, facts, total: response.value.total, offset: response.value.offset, limit: response.value.limit };
    },
    async productFiles(productId) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.productFiles", params: { schemaVersion: "0.1", productId } });
      if (!response.ok || !isLibraryProductFilesV01(response.value) || response.value.productId !== productId) throw new Error("library_files_read_failed");
      return { productId, items: response.value.items };
    },
  };
}
export function createLibraryBrowser(): LibraryBrowserPort {
  return createLiveLibraryBrowserPort(createGatewayClient(typeof window === "undefined" ? undefined : window.vua));
}

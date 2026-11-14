import { isLibraryListV02, isLibraryListV03, type LibraryFormatV03, type LibraryListParamsV02, type LibraryListParamsV03, type LibraryUseV02, type LibraryVn3CountsV03, type LibraryVn3RowV03 } from "@vua/contracts";
import { isGlbInspectionResultV01, isLibraryListV01, isLibraryProductFilesV01, type GlbInspectionResultV01, type LibraryListParamsV01 } from "@vua/contracts";
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
  readonly use?: LibraryUseV02;
  readonly vn3?: LibraryVn3RowV03;
  readonly addedAt?: string | null;
  readonly purchasedAt?: string | null;
  readonly publishedAt?: string | null;
  readonly sizeBytes?: number;
  readonly formats?: readonly LibraryFormatV03[];
  readonly variantCount?: number;
  readonly sourceCategory?: string | null;
  readonly storage: LibraryStorageFacts;
  readonly sources: readonly ("bought" | "gifts" | "free_downloads")[];
  readonly operation: { readonly taskId: string; readonly state: string; readonly inspectRequired: boolean } | null;
  readonly copyIds?: readonly string[];
  readonly localEntries?: readonly { readonly entryId: string; readonly displayName: string }[];
  readonly metadata?: LibraryEntryMetadataV01;
  readonly sourceMatch?: { readonly product: CatalogProductSummary; readonly basis: "mapping" | "product_id" | "name"; readonly content: "unverified" | "different" };
}
export interface LibraryPageView {
  readonly sourceCategories?: readonly string[];
  readonly vn3Counts?: LibraryVn3CountsV03;
  /** An older AMF module answered in its own order, without VN3 facts. */
  readonly older?: boolean;
  readonly catalog: CatalogListView;
  readonly localEntries: readonly WarehouseEntry[];
  readonly facts: ReadonlyMap<string, LibraryCardFacts>;
  readonly total: number; readonly offset: number; readonly limit: number;
  /** Every row in the library's order: `product:<id>` or `entry:<id>`. */
  readonly order?: readonly string[];
}

/** A saved association is provenance, not proof of identical bytes or ownership.
 * Name/ID hints must never become an implicit material selection. */
export function confirmedLibraryProductId(facts: Pick<LibraryCardFacts, "metadata" | "sourceMatch"> | undefined): string | null {
  return facts?.metadata?.productId
    ?? (facts?.sourceMatch?.basis === "mapping" ? facts.sourceMatch.product.productId : null);
}
export interface LibraryFileInventory {
  readonly productId: string;
  readonly items: readonly { readonly downloadableId: number; readonly fileName: string; readonly managedCopyId: string | null;
    readonly copies: readonly { readonly copyId: string; readonly entryId: string; readonly fileName: string;
      readonly artifactSha256: string; readonly presence: "present" | "missing" | "changed" | "unreadable" }[] }[];
}
export interface LibraryBrowserPort {
  list(query: LibraryListParamsV01 | LibraryListParamsV02 | LibraryListParamsV03): Promise<LibraryPageView>;
  productFiles(productId: string): Promise<LibraryFileInventory>;
  inspectGlb?(target: { readonly productId: string } | { readonly entryId: string }): Promise<GlbInspectionResultV01>;
}
/** Facts the current face adds to a row, absent on earlier faces. */
function currentFacts(row: object): Pick<LibraryCardFacts, "vn3" | "addedAt" | "purchasedAt" | "publishedAt" | "sizeBytes" | "formats"> {
  if (!("sizeBytes" in row)) return {};
  const current = row as { readonly addedAt: string | null; readonly purchasedAt?: string | null; readonly publishedAt: string | null; readonly sizeBytes: number; readonly formats?: readonly LibraryFormatV03[]; readonly vn3?: LibraryVn3RowV03 };
  return { addedAt: current.addedAt, purchasedAt: current.purchasedAt ?? null, publishedAt: current.publishedAt, sizeBytes: current.sizeBytes, ...(current.formats ? { formats: current.formats } : {}), ...(current.vn3 ? { vn3: current.vn3 } : {}) };
}
export function createLiveLibraryBrowserPort(client: GatewayClient): LibraryBrowserPort {
  return {
    async list(query) {
      const read = (params: LibraryListParamsV01 | LibraryListParamsV02 | LibraryListParamsV03) => client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.list", params });
      let response = await read(query);
      let older = false;
      // An AMF module that predates this face rejects it; the library stays usable in that module's order.
      if (!response.ok && query.schemaVersion === "0.3" && response.error.kind === "application" && response.error.error.code === "vua.library.invalid_params") {
        const { sort: _sort, format: _format, vn3: _vn3, schemaVersion: _version, ...ordinary } = query;
        response = await read({ ...ordinary, schemaVersion: "0.1" });
        older = true;
      }
      if (!response.ok || !(isLibraryListV01(response.value) || isLibraryListV02(response.value) || isLibraryListV03(response.value))) throw new Error("library_read_failed");
      if (query.schemaVersion === "0.3" && response.value.schemaVersion === "0.3" && query.vn3 !== undefined && response.value.items.some(row => !row.vn3 || ((query.vn3!.items?.length ?? 0) > 0 && row.vn3.match === null))) throw new Error("library_vn3_invalid");
      if (query.schemaVersion === "0.2" && query.use !== undefined && (response.value.schemaVersion !== "0.2" || response.value.items.some(row => !row.use || row.use.presetId !== query.use || query.useMode !== "all" && !["allowed","conditional"].includes(row.use.status)))) throw new Error("library_use_invalid");
      const items = []; const localEntries: WarehouseEntry[] = []; const facts = new Map<string, LibraryCardFacts>(); const order: string[] = [];
      for (const row of response.value.items) {
        if (row.kind === "product") {
          const product = projectSummary(row.product);
          if (product === null) throw new Error("library_product_invalid");
          items.push(product); order.push(`product:${product.productId}`);
          facts.set(product.productId, { ...("use" in row && row.use ? {use:row.use} : {}), ...currentFacts(row), variantCount: row.variantCount ?? 0, sourceCategory: row.sourceCategory ?? null, storage: row.storage, sources: row.sources, ...(row.copyIds === undefined ? {} : { copyIds: row.copyIds }), operation: row.operation === null ? null : {
            taskId: row.operation.taskId, state: row.operation.state, inspectRequired: row.operation.recoveryDisposition === "inspect_required",
          }, ...(row.localEntries === undefined ? {} : { localEntries: row.localEntries }) });
        } else {
          const entry = projectEntry(row.entry);
          if (entry === null) throw new Error("library_entry_invalid");
          const sourceProduct = row.sourceMatch === undefined ? undefined : projectSummary(row.sourceMatch.product);
          if (sourceProduct === null) throw new Error("library_source_invalid");
          localEntries.push(entry); order.push(`entry:${entry.warehouseItemId}`); facts.set(entry.warehouseItemId, { ...("use" in row && row.use ? {use:row.use} : {}), ...currentFacts(row), variantCount: row.variantCount ?? 0, sourceCategory: row.sourceCategory ?? null, storage: row.storage, sources: row.sourceMatch?.sources ?? [], operation: null,
            ...(row.metadata === undefined ? {} : { metadata: row.metadata }),
            ...(row.copyIds === undefined ? {} : { copyIds: row.copyIds }),
            ...(row.sourceMatch === undefined || sourceProduct === undefined ? {} : { sourceMatch: { product: sourceProduct, basis: row.sourceMatch.basis, content: row.sourceMatch.content } }),
          });
        }
      }
      return { catalog: { schemaVersion: 1, kind: "results", items, total: response.value.total,
        vocabulary: { availabilities: ["available", "unavailable", "unknown"], entityTypes: [], relationKinds: [] } },
      localEntries, facts, order, sourceCategories: response.value.sourceCategories ?? [], total: response.value.total, offset: response.value.offset, limit: response.value.limit,
      ...("vn3Counts" in response.value && response.value.vn3Counts ? { vn3Counts: response.value.vn3Counts } : {}), ...(older ? { older } : {}) };
    },
    async productFiles(productId) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.productFiles", params: { schemaVersion: "0.1", productId } });
      if (!response.ok || !isLibraryProductFilesV01(response.value) || response.value.productId !== productId) throw new Error("library_files_read_failed");
      return { productId, items: response.value.items };
    },
    async inspectGlb(target) {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "library.inspectGlb",
        params: { schemaVersion: "0.1", ...target },
      });
      if (!response.ok || !isGlbInspectionResultV01(response.value)) {
        throw new Error("library_glb_inspect_failed");
      }
      return response.value;
    },
  };
}
export function createLibraryBrowser(): LibraryBrowserPort {
  return createLiveLibraryBrowserPort(createGatewayClient(typeof window === "undefined" ? undefined : window.vua));
}

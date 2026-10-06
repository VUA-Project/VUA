import { describe, expect, it } from "vitest";
import { entryPreviewProductIds, readEntryPreview } from "./entry-preview.ts";
import type {
  WarehouseArtifactFact,
  WarehouseEntryDetail,
} from "./acquire-port.ts";
import type {
  CatalogBrowserPort,
  CatalogDetailView,
  CatalogProductDetail,
} from "./catalog-browser-port.ts";

/**
 * D-6 条目详情预览组合读(019 批 D,核心裁决方案 c 零新契约):
 * warehouse.entryDetail 的 artifacts[].mappedProductIds → catalog.detail
 * 按 productId 精确查询取媒体。用例锚定诚实语义(AC-12 同规):无关联是
 * 关联事实(no-association);有关联但无一可显示(媒体空/目录 miss/单品
 * 查询失败)归并为 no-images,不猜测、不编造;相册只携带真实返回的图。
 */

let artifactCounter = 0;

function fact(mappedProductIds: readonly string[]): WarehouseArtifactFact {
  artifactCounter += 1;
  return {
    artifactSha256: `sha256:${String(artifactCounter).padStart(64, "0")}`,
    relativePath: `pkg-${artifactCounter}.unitypackage`,
    state: "clean",
    role: "original",
    sizeBytes: 1024,
    suggestedFileName: null,
    inspectedAt: null,
    rejectionReason: null,
    sourceCorrelated: mappedProductIds.length > 0,
    mappedProductIds,
  };
}

function entryDetail(
  artifacts: readonly WarehouseArtifactFact[],
): WarehouseEntryDetail {
  return {
    warehouseItemId: "wh-item-1",
    folderName: "pkg-1",
    displayName: "Package 1",
    kind: "imported_material",
    createdAt: "2026-09-14T00:00:00.000Z",
    artifactMode: null,
    effectiveArtifactMode: "use_original_unitypackage",
    artifacts,
  };
}

function detailProduct(
  overrides: Partial<CatalogProductDetail> & { productId: string },
): CatalogProductDetail {
  return {
    libraryType: null,
    variantName: null,
    sourcePublishedAt: null,
    variations: [],
    title: null,
    price: null,
    imageUrl: null,
    availability: "available",
    availabilityRaw: null,
    sourceUrl: null,
    sourceLocale: null,
    description: null,
    attribution: null,
    adult: false,
    ageRestriction: null,
    sourceCategory: null,
    media: { imageUrls: [], videoUrls: [] },
    terms: [],
    subproducts: [],
    entities: [],
    ...overrides,
  };
}

/** 目录端口桩:未注册的 productId 一律 not-found;failing 内的身份抛传输错 */
function stubCatalog(
  details: Readonly<Record<string, CatalogDetailView>>,
  failing: readonly string[] = [],
): CatalogBrowserPort & { readonly calledIds: readonly string[] } {
  const calledIds: string[] = [];
  return {
    get calledIds() {
      return calledIds;
    },
    async list() {
      throw new Error("list is not part of the entry-preview composed read");
    },
    async productDownloadables() {
      return { kind: "absent" as const };
    },
    async detail(productId: string): Promise<CatalogDetailView> {
      calledIds.push(productId);
      if (failing.includes(productId)) throw new Error("transport failure");
      return details[productId] ?? { schemaVersion: 1, kind: "not-found" };
    },
    async status() {
      throw new Error("status is not part of the entry-preview composed read");
    },
    async capability() {
      throw new Error("capability is not part of the entry-preview composed read");
    },
  };
}

describe("entryPreviewProductIds (pure association facts)", () => {
  it("returns an empty list when no artifact carries mapped product ids", () => {
    const entry = entryDetail([fact([]), fact([])]);
    expect(entryPreviewProductIds(entry)).toEqual([]);
  });

  it("deduplicates shared ids and preserves first-appearance order", () => {
    const entry = entryDetail([
      fact(["booth:2", "booth:1"]),
      fact(["booth:1", "booth:3"]),
    ]);
    expect(entryPreviewProductIds(entry)).toEqual(["booth:2", "booth:1", "booth:3"]);
  });
});

describe("readEntryPreview (composed read, option c)", () => {
  it("reports no-association and never queries the catalog when nothing is mapped", async () => {
    const catalog = stubCatalog({});
    const view = await readEntryPreview(catalog, entryDetail([fact([])]));
    expect(view).toEqual({ kind: "no-association" });
    expect(catalog.calledIds).toEqual([]);
  });

  it("loads an album from the catalog media array with the product title", async () => {
    const catalog = stubCatalog({
      "booth:1": {
        schemaVersion: 1,
        kind: "detail",
        product: detailProduct({
          productId: "booth:1",
          title: "Some Asset",
          media: { imageUrls: ["https://example/a.png", "https://example/b.png"], videoUrls: [] },
        }),
      },
    });
    const view = await readEntryPreview(catalog, entryDetail([fact(["booth:1"])]));
    expect(view).toEqual({
      kind: "loaded",
      albums: [
        {
          productId: "booth:1",
          title: "Some Asset",
          imageUrls: ["https://example/a.png", "https://example/b.png"],
        },
      ],
    });
    expect(catalog.calledIds).toEqual(["booth:1"]);
  });

  it("falls back to the primary image when the media array is empty", async () => {
    const catalog = stubCatalog({
      "booth:7": {
        schemaVersion: 1,
        kind: "detail",
        product: detailProduct({ productId: "booth:7", imageUrl: "https://example/main.png" }),
      },
    });
    const view = await readEntryPreview(catalog, entryDetail([fact(["booth:7"])]));
    expect(view).toEqual({
      kind: "loaded",
      albums: [
        { productId: "booth:7", title: "booth:7", imageUrls: ["https://example/main.png"] },
      ],
    });
  });

  it("falls back the album title to the productId when the observation is untitled", async () => {
    const catalog = stubCatalog({
      "booth:9": {
        schemaVersion: 1,
        kind: "detail",
        product: detailProduct({
          productId: "booth:9",
          media: { imageUrls: ["https://example/x.png"], videoUrls: [] },
        }),
      },
    });
    const view = await readEntryPreview(catalog, entryDetail([fact(["booth:9"])]));
    expect(view.kind === "loaded" && view.albums[0]?.title === "booth:9").toBe(true);
  });

  it("reports no-images when the linked product carries no renderable media", async () => {
    const catalog = stubCatalog({
      "booth:1": {
        schemaVersion: 1,
        kind: "detail",
        product: detailProduct({ productId: "booth:1" }),
      },
    });
    const view = await readEntryPreview(catalog, entryDetail([fact(["booth:1"])]));
    expect(view).toEqual({ kind: "no-images" });
  });

  it("treats a catalog miss (not-found) as the same honest empty state", async () => {
    const catalog = stubCatalog({});
    const view = await readEntryPreview(catalog, entryDetail([fact(["booth:404"])]));
    expect(view).toEqual({ kind: "no-images" });
    expect(catalog.calledIds).toEqual(["booth:404"]);
  });

  it("keeps only the sources that actually returned images in a mixed mapping", async () => {
    const catalog = stubCatalog({
      "booth:1": {
        schemaVersion: 1,
        kind: "detail",
        product: detailProduct({
          productId: "booth:1",
          media: { imageUrls: ["https://example/1.png"], videoUrls: [] },
        }),
      },
    });
    const view = await readEntryPreview(
      catalog,
      entryDetail([fact(["booth:1"]), fact(["booth:2"])]),
    );
    expect(catalog.calledIds).toEqual(["booth:1", "booth:2"]);
    expect(view.kind === "loaded" && view.albums.length === 1).toBe(true);
    expect(view.kind === "loaded" && view.albums[0]?.productId === "booth:1").toBe(true);
  });

  it("queries each distinct id once when artifacts share a mapping", async () => {
    const catalog = stubCatalog({
      "booth:5": {
        schemaVersion: 1,
        kind: "detail",
        product: detailProduct({
          productId: "booth:5",
          media: { imageUrls: ["https://example/5.png"], videoUrls: [] },
        }),
      },
    });
    const view = await readEntryPreview(
      catalog,
      entryDetail([fact(["booth:5"]), fact(["booth:5"])]),
    );
    expect(catalog.calledIds).toEqual(["booth:5"]);
    expect(view.kind === "loaded" && view.albums.length === 1).toBe(true);
  });

  it("stacks multiple source albums in first-appearance order", async () => {
    const album = (productId: string, url: string): CatalogDetailView => ({
      schemaVersion: 1,
      kind: "detail",
      product: detailProduct({
        productId,
        media: { imageUrls: [url], videoUrls: [] },
      }),
    });
    const catalog = stubCatalog({
      "booth:2": album("booth:2", "https://example/2.png"),
      "booth:1": album("booth:1", "https://example/1.png"),
    });
    const view = await readEntryPreview(
      catalog,
      entryDetail([fact(["booth:2"]), fact(["booth:1", "booth:2"])]),
    );
    expect(view.kind === "loaded" && view.albums.map((album0) => album0.productId)).toEqual([
      "booth:2",
      "booth:1",
    ]);
  });

  it("absorbs a per-product transport failure as that source having no images", async () => {
    const catalog = stubCatalog({}, ["booth:9"]);
    const view = await readEntryPreview(catalog, entryDetail([fact(["booth:9"])]));
    expect(view).toEqual({ kind: "no-images" });
    expect(catalog.calledIds).toEqual(["booth:9"]);
  });

  it("treats a not-connected catalog face as the same honest empty state", async () => {
    const catalog = stubCatalog({
      "booth:1": { schemaVersion: 1, kind: "not-connected" },
    });
    const view = await readEntryPreview(catalog, entryDetail([fact(["booth:1"])]));
    expect(view).toEqual({ kind: "no-images" });
  });
});

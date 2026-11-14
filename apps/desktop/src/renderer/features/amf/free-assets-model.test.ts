import { describe, expect, it } from "vitest";
import {
  FREE_ASSET_DEFAULT_CATEGORY_IDS_V01,
  type FreeAssetItemV01,
  type FreeAssetsStateV01,
} from "@vua/contracts";
import {
  addWatchedKeyword,
  browserDownloadBannerReducer,
  formatCooldownRemaining,
  INITIAL_BROWSER_DOWNLOAD_BANNER,
  projectFreeAssetsView,
  removeWatchedKeyword,
  selectBatchKeywords,
  selectHeroQuickKeywords,
  toggleEnabledCategory,
  toggleWatchedKeyword,
} from "./free-assets-model.ts";

function makeItem(overrides: Partial<FreeAssetItemV01> & { productId: string }): FreeAssetItemV01 {
  return {
    title: "Synthetic Free Ribbon",
    shopName: "Synthetic Workshop",
    categoryId: "209",
    categoryLabel: "3D Clothing",
    thumbnailUrl: "https://booth.pximg.net/c/300x300/users/1/items/2.jpg",
    matchedKeywords: ["SyntheticBaseA"],
    isSample: false,
    hasDateCue: false,
    owned: false,
    ...overrides,
  };
}

const baseState: FreeAssetsStateV01 = {
  schemaVersion: "0.1",
  watchedKeywords: [{ keyword: "SyntheticBaseA", enabled: true }],
  suggestedKeywords: ["SyntheticBaseA", "SyntheticBaseB"],
  enabledCategories: [...FREE_ASSET_DEFAULT_CATEGORY_IDS_V01],
  hideOwned: false,
  showSamples: false,
  dismissedProductIds: ["booth:999"],
  lastQueriedAt: "2026-11-14T08:00:00.000Z",
  items: [
    makeItem({ productId: "booth:101", categoryId: "209" }),
    makeItem({ productId: "booth:102", categoryId: "209", isSample: true }),
    makeItem({ productId: "booth:103", categoryId: "215" }),
    makeItem({ productId: "booth:104", categoryId: "230", owned: true }),
    makeItem({ productId: "booth:999", categoryId: "209" }),
  ],
};

describe("free-assets-model", () => {
  it("filters dismissed, disabled categories, samples, and owned items accurately", () => {
    const first = projectFreeAssetsView(baseState);
    expect(first.visibleItems.map(item => item.productId)).toEqual(["booth:101", "booth:104"]);
    expect(first.sampleCount).toBe(1);
    expect(first.dismissedCount).toBe(1);
    expect(first.availableSuggestions).toEqual(["SyntheticBaseB"]);

    const withSamplesAndHideOwned = projectFreeAssetsView({
      ...baseState,
      hideOwned: true,
      showSamples: true,
    });
    expect(withSamplesAndHideOwned.visibleItems.map(item => item.productId)).toEqual([
      "booth:101",
      "booth:102",
    ]);
  });

  it("enforces max 5 enabled keywords and max 20 stored keywords", () => {
    const five = ["A1", "A2", "A3", "A4", "A5"].map(keyword => ({ keyword, enabled: true }));
    const sixth = addWatchedKeyword(five, "  A6  ");
    expect(sixth).toEqual({
      kind: "updated",
      watchedKeywords: [...five, { keyword: "A6", enabled: false }],
      addedPaused: true,
    });
    if (sixth.kind !== "updated") throw new Error("expected updated");
    expect(toggleWatchedKeyword(sixth.watchedKeywords, "A6")).toEqual({ kind: "enabled_limit" });

    const pausedOne = toggleWatchedKeyword(sixth.watchedKeywords, "A1");
    expect(pausedOne.kind).toBe("updated");
    if (pausedOne.kind !== "updated") throw new Error("expected updated");
    const enabledSixth = toggleWatchedKeyword(pausedOne.watchedKeywords, "A6");
    expect(enabledSixth.kind).toBe("updated");

    const twenty = Array.from({ length: 20 }, (_, i) => ({ keyword: `K${i + 1}`, enabled: i < 5 }));
    expect(addWatchedKeyword(twenty, "K21")).toEqual({ kind: "limit_reached" });
    expect(addWatchedKeyword(five, "   ")).toEqual({ kind: "invalid" });
    expect(removeWatchedKeyword(five, "A3").map(row => row.keyword)).toEqual(["A1", "A2", "A4", "A5"]);
  });

  it("preserves canonical category ordering and formats cooldown timers", () => {
    const updated = toggleEnabledCategory(["230", "209"], "215");
    expect(updated).toEqual(["209", "230", "215"]);
    expect(toggleEnabledCategory(updated, "230")).toEqual(["209", "215"]);

    expect(formatCooldownRemaining(null, 1000)).toBeNull();
    expect(formatCooldownRemaining(1000, 1000)).toBeNull();
    expect(formatCooldownRemaining(300_000, 1000)).toBe("4:59");
    expect(formatCooldownRemaining(6_200, 1000)).toBe("0:06");
  });

  it("tracks pending browser downloads and adoption completion", () => {
    let banner = browserDownloadBannerReducer(INITIAL_BROWSER_DOWNLOAD_BANNER, {
      type: "download-completed",
      downloadId: "dl-1",
      suggestedFileName: "free-hair.zip",
    });
    banner = browserDownloadBannerReducer(banner, {
      type: "download-completed",
      downloadId: "dl-1",
      suggestedFileName: "free-hair.zip",
    });
    expect(banner.pending).toHaveLength(1);
    banner = browserDownloadBannerReducer(banner, { type: "adopt-started", taskId: "task-adopt-1" });
    expect(banner.adoptingTaskId).toBe("task-adopt-1");
    banner = browserDownloadBannerReducer(banner, { type: "adopt-failed" });
    expect(banner.adoptingTaskId).toBeNull();
    expect(banner.pending).toHaveLength(1);
    banner = browserDownloadBannerReducer(banner, { type: "adopt-succeeded" });
    expect(banner).toEqual({ pending: [], adoptingTaskId: null, completedNotice: true });
    expect(browserDownloadBannerReducer(banner, { type: "dismiss" })).toEqual(INITIAL_BROWSER_DOWNLOAD_BANNER);
  });

  it("selects batch and hero quick keywords from pinned and owned Avatar suggestions", () => {
    expect(selectBatchKeywords(baseState)).toEqual(["SyntheticBaseA"]);
    expect(selectBatchKeywords({ ...baseState, watchedKeywords: [] })).toEqual([
      "SyntheticBaseA",
      "SyntheticBaseB",
    ]);
    expect(selectHeroQuickKeywords(baseState)).toEqual(["SyntheticBaseA", "SyntheticBaseB"]);
    expect(selectHeroQuickKeywords(null)).toEqual([]);
  });
});

import {
  FREE_ASSET_CATEGORY_IDS_V01,
  FREE_ASSET_MAX_ENABLED_KEYWORDS_V01,
  FREE_ASSET_MAX_STORED_KEYWORDS_V01,
  isFreeAssetKeywordV01,
  type FreeAssetCategoryIdV01,
  type FreeAssetItemV01,
  type FreeAssetWatchedKeywordV01,
  type FreeAssetsStateV01,
} from "@vua/contracts";

export interface FreeAssetsViewProjection {
  readonly visibleItems: readonly FreeAssetItemV01[];
  readonly sampleCount: number;
  readonly dismissedCount: number;
  readonly enabledKeywordCount: number;
  readonly availableSuggestions: readonly string[];
}

export function projectFreeAssetsView(state: FreeAssetsStateV01): FreeAssetsViewProjection {
  const dismissed = new Set(state.dismissedProductIds);
  const enabledCategories = new Set(state.enabledCategories);
  const watchedSet = new Set(state.watchedKeywords.map(entry => entry.keyword));

  const baseMatched = state.items.filter(item => {
    if (dismissed.has(item.productId)) return false;
    if (state.enabledCategories.length === 0) return false;
    if (item.categoryId !== null && !enabledCategories.has(item.categoryId)) return false;
    if (state.hideOwned && item.owned) return false;
    return true;
  });

  const sampleCount = baseMatched.filter(item => item.isSample).length;
  const visibleItems = state.showSamples ? baseMatched : baseMatched.filter(item => !item.isSample);
  const enabledKeywordCount = state.watchedKeywords.filter(entry => entry.enabled).length;
  const availableSuggestions = state.suggestedKeywords.filter(keyword => !watchedSet.has(keyword));

  return {
    visibleItems,
    sampleCount,
    dismissedCount: state.dismissedProductIds.length,
    enabledKeywordCount,
    availableSuggestions,
  };
}

/** Up to 5 Avatar keywords for one-click multi-Avatar batch search: enabled pinned
 * keywords first, falling back to owned Avatar suggestions from the library. */
export function selectBatchKeywords(state: FreeAssetsStateV01): readonly string[] {
  const enabledPinned = state.watchedKeywords
    .filter(entry => entry.enabled)
    .map(entry => entry.keyword)
    .slice(0, FREE_ASSET_MAX_ENABLED_KEYWORDS_V01);
  if (enabledPinned.length > 0) return enabledPinned;
  return state.suggestedKeywords.slice(0, FREE_ASSET_MAX_ENABLED_KEYWORDS_V01);
}

/** Deduplicated quick-chip Avatar keywords for the Browser Homepage hero card. */
export function selectHeroQuickKeywords(state: FreeAssetsStateV01 | null, limit = 8): readonly string[] {
  if (!state) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of state.watchedKeywords) {
    if (seen.has(entry.keyword)) continue;
    seen.add(entry.keyword);
    result.push(entry.keyword);
    if (result.length >= limit) return result;
  }
  for (const keyword of state.suggestedKeywords) {
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    result.push(keyword);
    if (result.length >= limit) return result;
  }
  return result;
}

export type AddKeywordOutcome =
  | {
      readonly kind: "updated";
      readonly watchedKeywords: readonly FreeAssetWatchedKeywordV01[];
      readonly addedPaused: boolean;
    }
  | { readonly kind: "noop" }
  | { readonly kind: "invalid" }
  | { readonly kind: "limit_reached" };

export function addWatchedKeyword(
  current: readonly FreeAssetWatchedKeywordV01[],
  rawInput: string,
): AddKeywordOutcome {
  const trimmed = rawInput.trim();
  if (!isFreeAssetKeywordV01(trimmed)) return { kind: "invalid" };

  const enabledCount = current.filter(entry => entry.enabled).length;
  const existing = current.find(entry => entry.keyword === trimmed);
  if (existing !== undefined) {
    if (!existing.enabled && enabledCount < FREE_ASSET_MAX_ENABLED_KEYWORDS_V01) {
      return {
        kind: "updated",
        watchedKeywords: current.map(entry =>
          entry.keyword === trimmed ? { ...entry, enabled: true } : entry,
        ),
        addedPaused: false,
      };
    }
    return { kind: "noop" };
  }

  if (current.length >= FREE_ASSET_MAX_STORED_KEYWORDS_V01) {
    return { kind: "limit_reached" };
  }

  const canEnable = enabledCount < FREE_ASSET_MAX_ENABLED_KEYWORDS_V01;
  return {
    kind: "updated",
    watchedKeywords: [...current, { keyword: trimmed, enabled: canEnable }],
    addedPaused: !canEnable,
  };
}

export type ToggleKeywordOutcome =
  | {
      readonly kind: "updated";
      readonly watchedKeywords: readonly FreeAssetWatchedKeywordV01[];
    }
  | { readonly kind: "enabled_limit" }
  | { readonly kind: "noop" };

export function toggleWatchedKeyword(
  current: readonly FreeAssetWatchedKeywordV01[],
  keyword: string,
): ToggleKeywordOutcome {
  const target = current.find(entry => entry.keyword === keyword);
  if (target === undefined) return { kind: "noop" };
  if (!target.enabled) {
    const enabledCount = current.filter(entry => entry.enabled).length;
    if (enabledCount >= FREE_ASSET_MAX_ENABLED_KEYWORDS_V01) {
      return { kind: "enabled_limit" };
    }
  }
  return {
    kind: "updated",
    watchedKeywords: current.map(entry =>
      entry.keyword === keyword ? { ...entry, enabled: !entry.enabled } : entry,
    ),
  };
}

export function removeWatchedKeyword(
  current: readonly FreeAssetWatchedKeywordV01[],
  keyword: string,
): readonly FreeAssetWatchedKeywordV01[] {
  return current.filter(entry => entry.keyword !== keyword);
}

export function toggleEnabledCategory(
  current: readonly FreeAssetCategoryIdV01[],
  categoryId: FreeAssetCategoryIdV01,
): readonly FreeAssetCategoryIdV01[] {
  const selected = new Set(current);
  if (selected.has(categoryId)) selected.delete(categoryId);
  else selected.add(categoryId);
  return FREE_ASSET_CATEGORY_IDS_V01.filter(id => selected.has(id));
}

export function formatCooldownRemaining(cooldownUntilMs: number | null, nowMs: number): string | null {
  if (cooldownUntilMs === null || cooldownUntilMs <= nowMs) return null;
  const totalSeconds = Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface PendingBrowserDownload {
  readonly downloadId: string;
  readonly suggestedFileName: string | null;
}

export interface BrowserDownloadBannerState {
  readonly pending: readonly PendingBrowserDownload[];
  readonly adoptingTaskId: string | null;
  readonly completedNotice: boolean;
}

export const INITIAL_BROWSER_DOWNLOAD_BANNER: BrowserDownloadBannerState = {
  pending: [],
  adoptingTaskId: null,
  completedNotice: false,
};

export type BrowserDownloadBannerAction =
  | { readonly type: "download-completed"; readonly downloadId: string; readonly suggestedFileName: string | null }
  | { readonly type: "adopt-started"; readonly taskId: string }
  | { readonly type: "adopt-succeeded" }
  | { readonly type: "adopt-failed" }
  | { readonly type: "dismiss" };

export function browserDownloadBannerReducer(
  state: BrowserDownloadBannerState,
  action: BrowserDownloadBannerAction,
): BrowserDownloadBannerState {
  switch (action.type) {
    case "download-completed": {
      if (state.pending.some(entry => entry.downloadId === action.downloadId)) return state;
      return {
        pending: [...state.pending, { downloadId: action.downloadId, suggestedFileName: action.suggestedFileName }],
        adoptingTaskId: state.adoptingTaskId,
        completedNotice: false,
      };
    }
    case "adopt-started":
      return { ...state, adoptingTaskId: action.taskId, completedNotice: false };
    case "adopt-succeeded":
      return { pending: [], adoptingTaskId: null, completedNotice: true };
    case "adopt-failed":
      return { ...state, adoptingTaskId: null };
    case "dismiss":
      return INITIAL_BROWSER_DOWNLOAD_BANNER;
  }
}

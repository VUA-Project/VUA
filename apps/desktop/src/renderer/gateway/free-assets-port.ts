import {
  isFreeAssetsDesktopStatusV01,
  isFreeAssetsStateV01,
  type FreeAssetCategoryIdV01,
  type FreeAssetWatchedKeywordV01,
  type FreeAssetsDesktopApiV01,
  type FreeAssetsDesktopStatusV01,
  type FreeAssetsQueryTargetV01,
  type FreeAssetsStateV01,
  type FreeAssetsUpdatePreferencesParamsV01,
} from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import type { Unsubscribe } from "./types.ts";

export interface FreeAssetsPreferencePatch {
  readonly watchedKeywords?: readonly FreeAssetWatchedKeywordV01[] | undefined;
  readonly enabledCategories?: readonly FreeAssetCategoryIdV01[] | undefined;
  readonly hideOwned?: boolean | undefined;
  readonly showSamples?: boolean | undefined;
  readonly dismissProductId?: string | undefined;
  readonly clearDismissed?: boolean | undefined;
}

export interface FreeAssetsPort {
  state(): Promise<FreeAssetsStateV01 | null>;
  updatePreferences(patch: FreeAssetsPreferencePatch): Promise<FreeAssetsStateV01 | null>;
  status(): Promise<FreeAssetsDesktopStatusV01>;
  query(target?: FreeAssetsQueryTargetV01): Promise<FreeAssetsDesktopStatusV01>;
  cancel(): Promise<void>;
  subscribeStatus(listener: (status: FreeAssetsDesktopStatusV01) => void): Unsubscribe;
}

export const IDLE_FREE_ASSETS_STATUS: FreeAssetsDesktopStatusV01 = {
  schemaVersion: "0.1",
  running: false,
  currentKeyword: null,
  completedKeywords: 0,
  totalKeywords: 0,
  cooldownUntilMs: null,
  lastError: null,
};

function toUpdateParams(patch: FreeAssetsPreferencePatch): FreeAssetsUpdatePreferencesParamsV01 {
  return {
    schemaVersion: "0.1",
    ...(patch.watchedKeywords !== undefined ? { watchedKeywords: patch.watchedKeywords } : {}),
    ...(patch.enabledCategories !== undefined ? { enabledCategories: patch.enabledCategories } : {}),
    ...(patch.hideOwned !== undefined ? { hideOwned: patch.hideOwned } : {}),
    ...(patch.showSamples !== undefined ? { showSamples: patch.showSamples } : {}),
    ...(patch.dismissProductId !== undefined ? { dismissProductId: patch.dismissProductId } : {}),
    ...(patch.clearDismissed !== undefined ? { clearDismissed: patch.clearDismissed } : {}),
  };
}

export function createFreeAssetsPort(
  client: GatewayClient,
  desktopApi?: FreeAssetsDesktopApiV01,
): FreeAssetsPort {
  return {
    async state() {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "freeAssets.state",
        params: { schemaVersion: "0.1" },
      });
      return response.ok && isFreeAssetsStateV01(response.value) ? response.value : null;
    },
    async updatePreferences(patch) {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "freeAssets.updatePreferences",
        params: toUpdateParams(patch),
      });
      return response.ok && isFreeAssetsStateV01(response.value) ? response.value : null;
    },
    async status() {
      if (!desktopApi) return IDLE_FREE_ASSETS_STATUS;
      try {
        const value = await desktopApi.status();
        return isFreeAssetsDesktopStatusV01(value) ? value : IDLE_FREE_ASSETS_STATUS;
      } catch {
        return IDLE_FREE_ASSETS_STATUS;
      }
    },
    async query(target) {
      if (!desktopApi) return IDLE_FREE_ASSETS_STATUS;
      try {
        const value = await desktopApi.query(target);
        return isFreeAssetsDesktopStatusV01(value) ? value : IDLE_FREE_ASSETS_STATUS;
      } catch {
        return IDLE_FREE_ASSETS_STATUS;
      }
    },
    async cancel() {
      try {
        await desktopApi?.cancel();
      } catch {
        // Cancellation is best-effort when the window or module is shutting down.
      }
    },
    subscribeStatus(listener) {
      if (!desktopApi) return () => {};
      return desktopApi.subscribe(payload => {
        if (isFreeAssetsDesktopStatusV01(payload)) listener(payload);
      });
    },
  };
}

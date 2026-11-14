import { describe, expect, it, vi } from "vitest";
import {
  FREE_ASSET_DEFAULT_CATEGORY_IDS_V01,
  type FreeAssetsDesktopApiV01,
  type FreeAssetsDesktopStatusV01,
  type FreeAssetsStateV01,
} from "@vua/contracts";
import { createFreeAssetsPort, IDLE_FREE_ASSETS_STATUS } from "./free-assets-port.ts";
import type { GatewayClient } from "./gateway-client.ts";

const sampleState: FreeAssetsStateV01 = {
  schemaVersion: "0.1",
  watchedKeywords: [{ keyword: "SyntheticBaseA", enabled: true }],
  suggestedKeywords: ["SyntheticBaseB"],
  enabledCategories: [...FREE_ASSET_DEFAULT_CATEGORY_IDS_V01],
  hideOwned: false,
  showSamples: false,
  dismissedProductIds: [],
  lastQueriedAt: null,
  items: [],
};

describe("FreeAssetsPort", () => {
  it("narrows state and preference updates and omits undefined optional keys", async () => {
    const invoke = vi.fn(async () => ({ ok: true as const, value: sampleState }));
    const client: GatewayClient = { invoke, subscribe: () => () => {} };
    let statusListener: ((status: FreeAssetsDesktopStatusV01) => void) | null = null;
    const runningStatus: FreeAssetsDesktopStatusV01 = {
      schemaVersion: "0.1",
      running: true,
      currentKeyword: "SyntheticBaseA",
      completedKeywords: 0,
      totalKeywords: 1,
      cooldownUntilMs: null,
      lastError: null,
    };
    const desktopApi: FreeAssetsDesktopApiV01 = {
      status: vi.fn(async () => IDLE_FREE_ASSETS_STATUS),
      query: vi.fn(async () => runningStatus),
      cancel: vi.fn(async () => {}),
      subscribe: listener => {
        statusListener = listener;
        return () => { statusListener = null; };
      },
    };
    const port = createFreeAssetsPort(client, desktopApi);
    expect(await port.state()).toEqual(sampleState);
    expect(await port.updatePreferences({ hideOwned: true, showSamples: undefined })).toEqual(sampleState);
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "freeAssets.updatePreferences",
        params: { schemaVersion: "0.1", hideOwned: true },
      }),
    );
    expect(await port.query()).toEqual(runningStatus);
    expect(desktopApi.query).toHaveBeenNthCalledWith(1, undefined);
    expect(await port.query("SyntheticBaseA")).toEqual(runningStatus);
    expect(desktopApi.query).toHaveBeenNthCalledWith(2, "SyntheticBaseA");
    const received: FreeAssetsDesktopStatusV01[] = [];
    const off = port.subscribeStatus(next => received.push(next));
    statusListener!(runningStatus);
    statusListener!({ ...runningStatus, schemaVersion: "9.9" as "0.1" });
    expect(received).toEqual([runningStatus]);
    off();
    await port.cancel();
    expect(desktopApi.cancel).toHaveBeenCalledTimes(1);
  });

  it("returns null on malformed or unavailable Gateway responses", async () => {
    const client: GatewayClient = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ ok: false, error: { kind: "unavailable" } })
        .mockResolvedValueOnce({ ok: true, value: { schemaVersion: "0.1" } as unknown as FreeAssetsStateV01 }),
      subscribe: () => () => {},
    };
    const port = createFreeAssetsPort(client);
    expect(await port.state()).toBeNull();
    expect(await port.state()).toBeNull();
    expect(await port.status()).toEqual(IDLE_FREE_ASSETS_STATUS);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  boothFreeAssetsBrowseUrl,
  isFreeAssetsDesktopStatusV01,
  type FreeAssetsDesktopStatusV01,
  type FreeAssetsStateV01,
} from "@vua/contracts";
import {
  createBoothReadGate,
  createFreeAssetsRunner,
  FREE_ASSETS_SEARCH_INTERVAL_MS,
} from "./booth-read-gate.js";
import { createCatalogEnricher } from "./catalog-enrich.js";

function syntheticState(keywords: readonly { keyword: string; enabled: boolean }[]): FreeAssetsStateV01 {
  return {
    schemaVersion: "0.1",
    watchedKeywords: keywords,
    suggestedKeywords: [],
    enabledCategories: ["209", "230", "231", "217", "214"],
    hideOwned: true,
    showSamples: false,
    dismissedProductIds: [],
    lastQueriedAt: null,
    items: [],
  };
}

describe("BoothReadGate", () => {
  it("serializes concurrent foreground and background BOOTH reads at >= 5,000 ms spacing", async () => {
    let clock = 0;
    const gate = createBoothReadGate({
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const observedAt: Array<{ caller: string; at: number }> = [];

    const enricher = createCatalogEnricher({
      readGate: gate,
      canRun: () => !gate.hasForegroundActivity(),
      queue: async () => ["booth:900001", "booth:900002"],
      claim: async () => true,
      read: async (id, signal, beforeRead) => {
        await beforeRead();
        signal.throwIfAborted();
        observedAt.push({ caller: `enrich:${id}`, at: clock });
        return "updated";
      },
      refreshed: () => undefined,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    await gate.acquire(undefined, { foreground: true });
    observedAt.push({ caller: "search", at: clock });
    await gate.acquire(undefined, { foreground: true });
    observedAt.push({ caller: "freeAssets", at: clock });
    await enricher.afterSync();
    enricher.dispose();

    expect(observedAt).toEqual([
      { caller: "search", at: 0 },
      { caller: "freeAssets", at: 5_000 },
      { caller: "enrich:booth:900001", at: 10_000 },
      { caller: "enrich:booth:900002", at: 15_000 },
    ]);
  });

  it("releases aborted waiters immediately without consuming a slot or blocking later callers", async () => {
    let clock = 0;
    const gate = createBoothReadGate({
      now: () => clock,
      sleep: (ms, signal) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(new Error("aborted"));
            return;
          }
          clock += ms;
          resolve();
        }),
    });

    await gate.acquire();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(gate.acquire(cancelled.signal)).rejects.toThrow();

    await gate.acquire();
    expect(clock).toBe(5_000);
  });
});

describe("FreeAssetsRunner", () => {
  it("streams per-keyword results at 1.5s search spacing without imposing a manual lockout and supports ad-hoc keyword queries", async () => {
    let perfMs = 0;
    let wallMs = Date.parse("2026-11-14T08:00:00.000Z");
    const gate = createBoothReadGate({
      now: () => perfMs,
      sleep: async (ms) => {
        perfMs += ms;
        wallMs += ms;
      },
    });
    const fetchTimes: number[] = [];
    const fetchedUrls: string[] = [];
    const resetFlags: boolean[] = [];
    const events: FreeAssetsDesktopStatusV01[] = [];

    const runner = createFreeAssetsRunner({
      gate,
      canRun: () => true,
      nowMs: () => wallMs,
      readState: async () =>
        syntheticState([
          { keyword: "SyntheticBaseA", enabled: true },
          { keyword: "SyntheticBaseB", enabled: true },
          { keyword: "SyntheticDisabled", enabled: false },
        ]),
      fetch: async (url) => {
        fetchTimes.push(perfMs);
        fetchedUrls.push(url);
        return {
          status: 200,
          body: "<ul class='market-items'></ul>",
          finalUrl: url,
        };
      },
      ingestPage: async (params) => {
        resetFlags.push(params.resetCache);
        return { ok: true, value: syntheticState([]) };
      },
    });
    runner.subscribe((status) => {
      expect(isFreeAssetsDesktopStatusV01(status)).toBe(true);
      events.push(status);
    });

    expect(fetchTimes).toHaveLength(0);
    const completed = await runner.query();
    expect(fetchTimes).toEqual([0, FREE_ASSETS_SEARCH_INTERVAL_MS]);
    expect(resetFlags).toEqual([true, false]);
    expect(completed.running).toBe(false);
    expect(completed.completedKeywords).toBe(2);
    expect(completed.totalKeywords).toBe(2);
    expect(completed.lastError).toBeNull();
    expect(completed.cooldownUntilMs).toBeNull();
    expect(events.some((e) => e.running && e.completedKeywords === 1)).toBe(true);

    // Immediate ad-hoc single-keyword search works freely without lockout.
    const adHoc = await runner.query("SyntheticFreeQuery");
    expect(adHoc.lastError).toBeNull();
    expect(adHoc.completedKeywords).toBe(1);
    expect(adHoc.totalKeywords).toBe(1);
    expect(fetchedUrls.at(-1)).toBe(boothFreeAssetsBrowseUrl("SyntheticFreeQuery"));
    expect(fetchTimes).toEqual([0, FREE_ASSETS_SEARCH_INTERVAL_MS, FREE_ASSETS_SEARCH_INTERVAL_MS * 2]);
    runner.dispose();
  });

  it("supports immediate cancellation without imposing cooldown and preserves cache on first-keyword failure", async () => {
    let perfMs = 0;
    const gate = createBoothReadGate({
      now: () => perfMs,
      sleep: (ms, signal) =>
        new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          if (!signal.aborted) {
            perfMs += ms;
            resolve();
          }
        }),
    });

    let notifyFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    const ingestSpy = vi.fn(async () => ({ ok: true as const, value: syntheticState([]) }));

    const runner = createFreeAssetsRunner({
      gate,
      canRun: () => true,
      readState: async () => syntheticState([{ keyword: "SyntheticBaseA", enabled: true }]),
      fetch: (_url, signal) =>
        new Promise((_resolve, reject) => {
          notifyFetchStarted();
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
      ingestPage: ingestSpy,
    });

    const pending = runner.query();
    await fetchStarted;
    runner.cancel();
    const cancelled = await pending;
    expect(cancelled.running).toBe(false);
    expect(cancelled.cooldownUntilMs).toBeNull();
    expect(cancelled.lastError).toBeNull();
    expect(ingestSpy).not.toHaveBeenCalled();
    runner.dispose();

    // Sign-in redirect and 429 halt immediately without calling ingestPage(resetCache: true).
    for (const [response, expectedError] of [
      [{ status: 200, body: "login", finalUrl: "https://accounts.booth.pm/users/sign_in" }, "sign_in_required"],
      [{ status: 429, body: "rate limit", finalUrl: boothFreeAssetsBrowseUrl("SyntheticBaseA") }, "rate_limited"],
    ] as const) {
      const r = createFreeAssetsRunner({
        gate: createBoothReadGate({ sleep: async () => undefined }),
        canRun: () => true,
        readState: async () => syntheticState([{ keyword: "SyntheticBaseA", enabled: true }]),
        fetch: async () => response,
        ingestPage: ingestSpy,
      });
      const res = await r.query();
      expect(res.lastError).toBe(expectedError);
      expect(ingestSpy).not.toHaveBeenCalled();
      r.dispose();
    }
  });
});

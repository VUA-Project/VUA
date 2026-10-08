import { describe, expect, it, vi } from "vitest";
import type { CatalogSyncPageV03, CatalogSyncPageResultV03, CatalogSyncSnapshotV03 } from "@vua/contracts";
import { CATALOG_SYNC_DEFAULT_START_URL as BOUGHT, isSignInPage, startCatalogSync, type CatalogSyncRunnerOptions } from "./catalog-sync.js";

const GIFTS = "https://accounts.booth.pm/library/gifts?page=1";
const FREE = "https://accounts.booth.pm/library/free_downloads?page=1";
const segments = [{ startUrl: BOUGHT, libraryType: "bought" }, { startUrl: GIFTS, libraryType: "gifts" }, { startUrl: FREE, libraryType: "free_downloads" }] as const;

/** Synthetic provider receipts. These tests exercise transport, never a real session. */
function harness(page: (request: CatalogSyncPageV03) => unknown = (request) => receipt(request)) {
  const calls: string[] = [];
  const state: CatalogSyncSnapshotV03 = { schemaVersion: "0.3", runId: "catalog-sync-test", taskId: "catalog-sync-test", revision: 3,
    state: "running", cancellationRequested: false, recoveryDisposition: "none", libraryTypes: ["bought"], completedLibraryTypes: [],
    pages: 0, parsedCount: 0, upsertedCount: 0, rejectedCount: 0, nextPageUrl: null, errorCode: null };
  let current = state;
  const options: CatalogSyncRunnerOptions = {
    pageDelayMs: 0,
    begin: async (request) => {
      calls.push("begin");
      current = { ...current, runId: request.runId, taskId: request.runId, libraryTypes: request.libraryTypes };
      return { ok: true, value: current };
    },
    fetch: async (url) => { calls.push(`fetch:${url}`); return { status: 200, body: "<synthetic-library/>", finalUrl: url }; },
    invoke: async (request) => {
      calls.push(`page:${request.libraryType}:${request.pageNumber}`);
      const value = page(request) as CatalogSyncPageResultV03;
      if (value.nextPageUrl !== undefined && value.parsedCount !== undefined) {
        current = { ...current, pages: current.pages + 1, parsedCount: current.parsedCount + value.parsedCount,
          upsertedCount: current.upsertedCount + value.upsertedCount, rejectedCount: current.rejectedCount + value.rejectedItems.length,
          completedLibraryTypes: value.nextPageUrl === null ? [...current.completedLibraryTypes, request.libraryType] : current.completedLibraryTypes,
          nextPageUrl: value.nextPageUrl };
      }
      return { ok: true, value };
    },
    finish: async (request) => {
      calls.push(`finish:${request.outcome}:${request.errorCode ?? ""}`);
      current = { ...current, revision: current.revision + 1,
        state: request.outcome === "cancelled" ? "cancelled" : request.outcome === "completed" ? (current.rejectedCount > 0 ? "succeeded_with_warnings" : "succeeded") : "failed" };
      return { ok: true, value: current };
    },
  };
  return { calls, options };
}
function receipt(request: CatalogSyncPageV03, extra: Partial<CatalogSyncPageResultV03> = {}): CatalogSyncPageResultV03 {
  return { schemaVersion: "0.3", sourceUrl: request.sourceUrl, parsedCount: 2, upsertedCount: 2, rejectedItems: [], nextPageUrl: null, cancellationRequested: false, ...extra };
}

describe("catalog sync v0.3 transport", () => {
  it("registers the task before any fetch and finalizes once after all three libraries", async () => {
    const h = harness((request) => receipt(request, { nextPageUrl: request.pageNumber === 1 ? "/library?page=2" : null }));
    const result = await startCatalogSync(h.options, { segments }).result;
    expect(result).toMatchObject({ status: "completed", pages: 4, upsertedCount: 8 });
    expect(h.calls[0]).toBe("begin");
    expect(h.calls.filter((call) => call.startsWith("page:"))).toEqual(["page:bought:1", "page:bought:2", "page:gifts:3", "page:free_downloads:4"]);
    expect(h.calls.filter((call) => call.startsWith("finish:"))).toEqual(["finish:completed:"]);
  });
  it("never fetches when task registration fails", async () => {
    const h = harness();
    const result = await startCatalogSync({ ...h.options, begin: async () => ({ ok: false, error: { code: "vua.catalog.store_failed" } }) }).result;
    expect(result).toMatchObject({ status: "failed", pages: 0 });
    expect(h.calls).toEqual([]);
  });
  it("records first-fetch failure, including zero completed pages", async () => {
    const h = harness();
    const result = await startCatalogSync({ ...h.options, fetch: async () => { throw new Error("synthetic network failure"); } }).result;
    expect(result).toMatchObject({ status: "failed", pages: 0, error: { code: "fetch_error" } });
    expect(h.calls).toEqual(["begin", "finish:failed:fetch_error"]);
  });
  it("keeps completed-page counts when a later library fails", async () => {
    const h = harness();
    const result = await startCatalogSync({ ...h.options, fetch: async (url, signal) => url === GIFTS ? { status: 503, body: "", finalUrl: url } : h.options.fetch(url, signal) }, { segments }).result;
    expect(result).toMatchObject({ status: "failed", pages: 1, upsertedCount: 2 });
    expect(h.calls.at(-1)).toBe("finish:failed:http_status");
    expect(h.calls.some((call) => call.includes(FREE))).toBe(false);
  });
  it("reports an expired sign-in session without ingesting its login page", async () => {
    const h = harness();
    const result = await startCatalogSync({ ...h.options, fetch: async (url) => ({ status: 200, body: '<form action="/users/auth/pixiv"></form>', finalUrl: url }) }).result;
    expect(result.error?.code).toBe("sign_in_redirect");
    expect(h.calls).toEqual(["begin", "finish:failed:sign_in_redirect"]);
  });
  it("rejects a malformed page receipt instead of treating missing nextPageUrl as success", async () => {
    const h = harness(() => ({ schemaVersion: "0.3" }));
    expect(await startCatalogSync(h.options).result).toMatchObject({ status: "failed", error: { code: "invalid_receipt" } });
    expect(h.calls.at(-1)).toBe("finish:failed:invalid_receipt");
  });
  it("stops a pagination loop before requesting the same URL again", async () => {
    const h = harness((request) => receipt(request, { nextPageUrl: BOUGHT }));
    expect(await startCatalogSync(h.options).result).toMatchObject({ status: "failed", pages: 1, error: { code: "pagination_loop" } });
    expect(h.calls.filter((call) => call.startsWith("fetch:"))).toHaveLength(1);
  });
  it.each(["https://example.invalid/library?page=2", GIFTS, "https://accounts.booth.pm/library?page=2#fragment", "//example.invalid/library?page=2"])("rejects continuation outside the selected library: %s", async (next) => {
    const h = harness((request) => receipt(request, { nextPageUrl: next }));
    expect(await startCatalogSync(h.options).result).toMatchObject({ status: "failed", pages: 1, error: { code: "next_page_url_not_allowed" } });
  });
  it("records the page limit as incomplete", async () => {
    const h = harness((request) => receipt(request, { nextPageUrl: "/library?page=2" }));
    expect(await startCatalogSync({ ...h.options, maxPages: 1 }).result).toMatchObject({ status: "page_limit_reached", pages: 1 });
    expect(h.calls.at(-1)).toBe("finish:page_limit_reached:page_limit_reached");
  });
  it("aborts an in-flight fetch and records confirmed cancellation", async () => {
    const h = harness();
    let started = false;
    const run = startCatalogSync({ ...h.options, fetch: (_url, signal) => new Promise((_resolve, reject) => {
      started = true; signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) });
    await vi.waitFor(() => expect(started).toBe(true));
    run.stop();
    expect(await run.result).toMatchObject({ status: "aborted", pages: 0 });
    expect(h.calls.at(-1)).toBe("finish:cancelled:");
  });
  it("cancels during the pacing interval without fetching the next page", async () => {
    const h = harness((request) => receipt(request, { nextPageUrl: "/library?page=2" }));
    const run = startCatalogSync({ ...h.options, pageDelayMs: 10_000 });
    await vi.waitFor(() => expect(h.calls).toContain("page:bought:1"));
    run.stop();
    expect(await run.result).toMatchObject({ status: "aborted", pages: 1 });
    expect(h.calls.filter((call) => call.startsWith("fetch:"))).toHaveLength(1);
  });
  it("honors cancellation reported by the task authority", async () => {
    const h = harness((request) => receipt(request, { cancellationRequested: true }));
    expect(await startCatalogSync(h.options).result).toMatchObject({ status: "aborted", pages: 1 });
  });
  it("does not claim success when final-result persistence fails", async () => {
    const h = harness();
    expect(await startCatalogSync({ ...h.options, finish: async () => ({ ok: false, error: { code: "vua.catalog.store_failed" } }) }).result)
      .toMatchObject({ status: "failed", pages: 1, error: { code: "vua.catalog.store_failed" } });
  });
  it("keeps rejection counts from an early page after later pages succeed", async () => {
    const h = harness((request) => receipt(request, { upsertedCount: request.pageNumber === 1 ? 1 : 2,
      rejectedItems: request.pageNumber === 1 ? [{ index: 0, code: "synthetic_rejection", reason: "synthetic rejection" }] : [] }));
    expect(await startCatalogSync(h.options, { segments }).result).toMatchObject({ status: "completed", pages: 3, upsertedCount: 5, rejectedCount: 1 });
  });
});

describe("sign-in detection", () => {
  it("uses login-page structure rather than translated copy", () => {
    expect(isSignInPage('<form action="/users/auth/pixiv"></form>')).toBe(true);
    expect(isSignInPage('<a href="/users/sign_in_by_password">help</a>')).toBe(true);
    expect(isSignInPage('<a href="https://synthetic.booth.pm/items/901">Synthetic</a>')).toBe(false);
  });
});

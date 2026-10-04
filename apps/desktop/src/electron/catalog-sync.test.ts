import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_SYNC_DEFAULT_START_URL,
  isSignInRedirect,
  startCatalogSync,
  type CatalogSyncFetch,
  type CatalogSyncInvoke,
  type CatalogSyncPageResultV01,
} from "./catalog-sync.js";

function pageResult(overrides: Partial<CatalogSyncPageResultV01>): CatalogSyncPageResultV01 {
  return {
    schemaVersion: "0.1",
    sourceUrl: CATALOG_SYNC_DEFAULT_START_URL,
    parsedCount: 2,
    upsertedCount: 2,
    rejectedItems: [],
    nextPageUrl: null,
    ...overrides,
  };
}

function makeFetch(pages: Record<string, { status?: number; body?: string }>): {
  fetch: CatalogSyncFetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetch: CatalogSyncFetch = async (url) => {
    urls.push(url);
    const page = pages[url];
    if (page === undefined) throw new Error(`unexpected fetch ${url}`);
    return {
      status: page.status ?? 200,
      body: page.body ?? "<html></html>",
      finalUrl: url,
    };
  };
  return { fetch, urls };
}

function okInvoke(result: CatalogSyncPageResultV01): CatalogSyncInvoke {
  return async () => ({ ok: true, value: result });
}

const noDelay = { pageDelayMs: 0, sleep: async () => {} };

describe("isSignInRedirect", () => {
  it("recognizes exactly the accounts sign-in destination", () => {
    expect(isSignInRedirect("https://accounts.booth.pm/users/sign_in")).toBe(true);
    expect(isSignInRedirect("https://accounts.booth.pm/users/sign_in?return_to=%2Flibrary")).toBe(true);
    expect(isSignInRedirect("https://booth.pm/users/sign_in")).toBe(false);
    expect(isSignInRedirect("https://accounts.booth.pm/library?page=1")).toBe(false);
    expect(isSignInRedirect("https://accounts.booth.pm/users/sign_in/other")).toBe(false);
    expect(isSignInRedirect("not a url")).toBe(false);
  });
});

describe("startCatalogSync", () => {
  it("stops with sign_in_redirect before ingest when the session is half-logged-in", async () => {
    // 真机 2026-10-05:cookie 在、登录未完成的会话访问库页,HTTP 200 但
    // finalUrl 落在登录页——不投递解析(not_a_library_page 会掩盖成因),
    // 以专码停跑,渲染层据此收口“已开始”提示
    const fetch: CatalogSyncFetch = async () => ({
      status: 200,
      body: "<html>sign-in form</html>",
      finalUrl: "https://accounts.booth.pm/users/sign_in",
    });
    const invoke: CatalogSyncInvoke = async () => {
      throw new Error("ingest must not be called for a sign-in redirect");
    };
    const run = startCatalogSync({ fetch, invoke, ...noDelay });
    const result = await run.result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("sign_in_redirect");
    expect(result.pages).toBe(0);
  });

  it("walks pages until the observed last page and accumulates counts", async () => {
    const { fetch, urls } = makeFetch({
      [CATALOG_SYNC_DEFAULT_START_URL]: { body: "<page1/>" },
      "https://accounts.booth.pm/library?page=2": { body: "<page2/>" },
    });
    let call = 0;
    const results = [
      pageResult({ sourceUrl: CATALOG_SYNC_DEFAULT_START_URL, nextPageUrl: "https://accounts.booth.pm/library?page=2" }),
      pageResult({ sourceUrl: "https://accounts.booth.pm/library?page=2", parsedCount: 3, upsertedCount: 1, nextPageUrl: null }),
    ];
    const invoke: CatalogSyncInvoke = async (params) => {
      call += 1;
      expect(params.schemaVersion).toBe("0.2");
      expect(params.html).toBe(call === 1 ? "<page1/>" : "<page2/>");
      expect(params.pageNumber).toBe(call);
      expect(params.runId).toMatch(/^catalog-sync-/);
      expect(params.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      return { ok: true, value: results[call - 1] };
    };

    const run = startCatalogSync({ fetch, invoke, ...noDelay });
    const result = await run.result;

    expect(result.status).toBe("completed");
    expect(result.pages).toBe(2);
    expect(result.parsedCount).toBe(5);
    expect(result.upsertedCount).toBe(3);
    expect(result.nextPageUrl).toBeNull();
    expect(urls).toEqual([
      CATALOG_SYNC_DEFAULT_START_URL,
      "https://accounts.booth.pm/library?page=2",
    ]);
  });

  it("respects the injected start url and run id", async () => {
    const { fetch } = makeFetch({ "https://booth.pm/ja/library?page=3": {} });
    const invoke = okInvoke(pageResult({ nextPageUrl: null }));
    const run = startCatalogSync(
      { fetch, invoke, ...noDelay },
      { runId: "sync-42", startUrl: "https://booth.pm/ja/library?page=3" },
    );
    const seen: string[] = [];
    const spyingInvoke: CatalogSyncInvoke = async (params) => {
      seen.push(params.runId ?? "");
      return invoke(params);
    };
    await startCatalogSync(
      { fetch, invoke: spyingInvoke, ...noDelay },
      { runId: "sync-42", startUrl: "https://booth.pm/ja/library?page=3" },
    ).result;
    expect(seen).toEqual(["sync-42"]);
    expect(await run.result.then((r) => r.runId)).toBe("sync-42");
  });

  it("stops with page_limit_reached at the cap and reports the unfetched next page", async () => {
    const { fetch } = makeFetch({
      [CATALOG_SYNC_DEFAULT_START_URL]: {},
      "https://accounts.booth.pm/library?page=2": {},
    });
    const invoke = okInvoke(pageResult({ nextPageUrl: "https://accounts.booth.pm/library?page=2" }));
    const result = await startCatalogSync({ fetch, invoke, maxPages: 2, ...noDelay }).result;
    expect(result.status).toBe("page_limit_reached");
    expect(result.pages).toBe(2);
    expect(result.nextPageUrl).toBe("https://accounts.booth.pm/library?page=2");
  });

  it("fails honestly on a non-200 page", async () => {
    const { fetch } = makeFetch({ [CATALOG_SYNC_DEFAULT_START_URL]: { status: 404 } });
    const invoke = okInvoke(pageResult({}));
    const result = await startCatalogSync({ fetch, invoke, ...noDelay }).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("http_status");
    expect(result.pages).toBe(0);
  });

  it("fails honestly when the provider rejects the page", async () => {
    const { fetch } = makeFetch({ [CATALOG_SYNC_DEFAULT_START_URL]: {} });
    const invoke: CatalogSyncInvoke = async () => ({
      ok: false,
      error: { code: "vua.catalog.not_a_library_page" },
    });
    const result = await startCatalogSync({ fetch, invoke, ...noDelay }).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("vua.catalog.not_a_library_page");
  });

  it("fails honestly when fetch throws", async () => {
    const fetch: CatalogSyncFetch = async () => {
      throw new Error("network down");
    };
    const invoke = okInvoke(pageResult({}));
    const result = await startCatalogSync({ fetch, invoke, ...noDelay }).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("fetch_error");
  });

  it("treats a receipt without nextPageUrl as the last page (no guessing)", async () => {
    const { fetch } = makeFetch({ [CATALOG_SYNC_DEFAULT_START_URL]: {} });
    const invoke: CatalogSyncInvoke = async () => ({ ok: true, value: { schemaVersion: "0.1" } });
    const result = await startCatalogSync({ fetch, invoke, ...noDelay }).result;
    expect(result.status).toBe("completed");
    expect(result.pages).toBe(1);
    expect(result.nextPageUrl).toBeNull();
  });

  it("aborts between pages on stop() and reports aborted with partial counts", async () => {
    const { fetch } = makeFetch({
      [CATALOG_SYNC_DEFAULT_START_URL]: {},
      "https://accounts.booth.pm/library?page=2": {},
    });
    const invoke = okInvoke(pageResult({ nextPageUrl: "https://accounts.booth.pm/library?page=2" }));
    let gate: (() => void) | null = null;
    const sleep = () =>
      new Promise<void>((resolve) => {
        gate = resolve;
      });
    const run = startCatalogSync({ fetch, invoke, pageDelayMs: 0, sleep });
    const settled = run.result.then((result) => result);
    // 等第一页完成进入页间等待后停止
    await vi.waitFor(() => expect(gate).not.toBeNull());
    run.stop();
    gate?.();
    const result = await settled;
    expect(result.status).toBe("aborted");
    expect(result.pages).toBe(1);
    expect(result.parsedCount).toBe(2);
  });

  it("paces pages with the configured delay", async () => {
    const { fetch } = makeFetch({
      [CATALOG_SYNC_DEFAULT_START_URL]: {},
      "https://accounts.booth.pm/library?page=2": {},
    });
    const invoke = okInvoke(pageResult({ nextPageUrl: "https://accounts.booth.pm/library?page=2" }));
    const sleeps: number[] = [];
    await startCatalogSync({
      fetch,
      invoke,
      pageDelayMs: 25,
      maxPages: 2,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }).result;
    expect(sleeps).toEqual([25]);
  });

  it("defaults to the canonical library start url", async () => {
    const { fetch, urls } = makeFetch({ [CATALOG_SYNC_DEFAULT_START_URL]: {} });
    const invoke = okInvoke(pageResult({}));
    await startCatalogSync({ fetch, invoke, ...noDelay }).result;
    expect(urls).toEqual([CATALOG_SYNC_DEFAULT_START_URL]);
  });
});

describe("relative next-page continuation (real library grammar)", () => {
  it("resolves a relative rel=next href against the current page before fetching", async () => {
    const { fetch, urls } = makeFetch({
      "https://accounts.booth.pm/library?page=1": { body: "<page1/>" },
      "https://accounts.booth.pm/library?page=2": { body: "<page2/>" },
    });
    let call = 0;
    const results = [
      pageResult({ nextPageUrl: "/library?page=2" }),
      pageResult({ nextPageUrl: null }),
    ];
    const invoke: CatalogSyncInvoke = async () => ({ ok: true, value: results[call++] });
    const result = await startCatalogSync({ fetch, invoke, ...noDelay }).result;
    expect(result.status).toBe("completed");
    expect(result.pages).toBe(2);
    expect(urls).toEqual([
      "https://accounts.booth.pm/library?page=1",
      "https://accounts.booth.pm/library?page=2",
    ]);
  });

  it("fails honestly when the next href cannot be resolved", async () => {
    const { fetch } = makeFetch({ "https://accounts.booth.pm/library?page=1": {} });
    const invoke = okInvoke(pageResult({ nextPageUrl: "http://[invalid" }));
    const result = await startCatalogSync({ fetch, invoke, ...noDelay }).result;
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("next_page_url_unresolvable");
  });
});

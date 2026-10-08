import { randomUUID } from "node:crypto";
import {
  isCatalogSyncPageResultV03, isCatalogSyncSnapshotV03,
  type CatalogLibraryType, type CatalogSyncBeginV03, type CatalogSyncFinishV03,
  type CatalogSyncPageV03, type CatalogSyncSnapshotV03,
} from "@vua/contracts";

export const CATALOG_SYNC_DEFAULT_START_URL = "https://accounts.booth.pm/library?page=1";
export interface CatalogSyncFetchOutcome { readonly status: number; readonly body: string; readonly finalUrl: string }
export type CatalogSyncFetch = (url: string, signal: AbortSignal) => Promise<CatalogSyncFetchOutcome>;
export interface CatalogSyncInvokeResult { readonly ok: boolean; readonly value?: unknown; readonly error?: { readonly code?: string } }
export type CatalogSyncInvoke = (params: CatalogSyncPageV03) => Promise<CatalogSyncInvokeResult>;
export interface CatalogSyncRunnerOptions {
  readonly fetch: CatalogSyncFetch;
  readonly begin: (params: CatalogSyncBeginV03) => Promise<CatalogSyncInvokeResult>;
  readonly invoke: CatalogSyncInvoke;
  readonly finish: (params: CatalogSyncFinishV03) => Promise<CatalogSyncInvokeResult>;
  readonly pageDelayMs?: number;
  readonly maxPages?: number;
  readonly now?: () => Date;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}
export type CatalogSyncRunStatus = "completed" | "failed" | "aborted" | "page_limit_reached";
export interface CatalogSyncRunResult {
  readonly status: CatalogSyncRunStatus; readonly runId: string; readonly pages: number;
  readonly parsedCount: number; readonly upsertedCount: number; readonly rejectedCount: number;
  readonly nextPageUrl: string | null; readonly error?: { readonly code: string };
}
export interface CatalogSyncRun {
  readonly runId: string;
  /** Durable registration precedes the first fetch and the desktop's started receipt. */
  readonly ready: Promise<CatalogSyncSnapshotV03>;
  readonly result: Promise<CatalogSyncRunResult>;
  stop(): void;
}
export interface CatalogSyncSegment { readonly startUrl: string; readonly libraryType: CatalogLibraryType }

export function isSignInPage(html: string): boolean {
  return html.includes('action="/users/auth/pixiv"') || html.includes("users/sign_in_by_password");
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function nextLibraryUrl(raw: string, current: string, kind: CatalogLibraryType): string | null {
  try {
    const url = new URL(raw, current);
    const path = kind === "bought" ? "/library" : `/library/${kind}`;
    return url.origin === "https://accounts.booth.pm" && url.pathname === path
      && url.username === "" && url.password === "" && url.hash === ""
      && /^\?page=[1-9][0-9]*$/.test(url.search) ? url.href : null;
  } catch { return null; }
}

/** Electron owns session transport; acquisition owns counts and terminal task state. */
export function startCatalogSync(options: CatalogSyncRunnerOptions, start?: {
  readonly runId?: string; readonly startUrl?: string; readonly libraryType?: CatalogLibraryType;
  readonly segments?: readonly CatalogSyncSegment[];
}): CatalogSyncRun {
  const runId = start?.runId ?? `catalog-sync-${randomUUID()}`;
  const segments = start?.segments ?? [{ startUrl: start?.startUrl ?? CATALOG_SYNC_DEFAULT_START_URL, libraryType: start?.libraryType ?? "bought" }];
  const abort = new AbortController();
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? delay;
  const maxPages = Math.min(options.maxPages ?? 50, 50);
  let pages = 0, parsedCount = 0, upsertedCount = 0, rejectedCount = 0;
  let nextPageUrl: string | null = null;
  const facts = (): Omit<CatalogSyncRunResult, "status"> => ({ runId, pages, parsedCount, upsertedCount, rejectedCount, nextPageUrl });
  const failure = (code: string): CatalogSyncRunResult => ({ ...facts(), status: "failed", error: { code } });
  const ready = (async () => {
    const response = await options.begin({ schemaVersion: "0.3", runId, libraryTypes: segments.map((segment) => segment.libraryType) });
    if (!response.ok) throw new Error(response.error?.code ?? "begin_error");
    if (!isCatalogSyncSnapshotV03(response.value) || response.value.runId !== runId
      || response.value.state !== "running" || response.value.pages !== 0 || response.value.recoveryDisposition !== "none"
      || response.value.libraryTypes.length !== segments.length || response.value.libraryTypes.some((kind, index) => kind !== segments[index]?.libraryType)) throw new Error("invalid_begin_receipt");
    return response.value;
  })();

  const result = (async (): Promise<CatalogSyncRunResult> => {
    try { await ready; } catch (error) { return failure(error instanceof Error ? error.message : "begin_error"); }
    let transport: CatalogSyncRunResult;
    try { transport = await readPages(); } catch { transport = abort.signal.aborted ? { ...facts(), status: "aborted" } : failure("fetch_error"); }
    try {
      const response = await options.finish({
        schemaVersion: "0.3", runId,
        outcome: transport.status === "aborted" ? "cancelled" : transport.status,
        ...(transport.error === undefined ? {} : { errorCode: transport.error.code }),
      });
      if (!response.ok) return failure(response.error?.code ?? "finish_error");
      if (!isCatalogSyncSnapshotV03(response.value) || response.value.runId !== runId || response.value.state === "running") return failure("invalid_finish_receipt");
      const final = response.value;
      return { ...transport, pages: final.pages, parsedCount: final.parsedCount, upsertedCount: final.upsertedCount,
        rejectedCount: final.rejectedCount, nextPageUrl: final.nextPageUrl,
        status: final.state === "cancelled" ? "aborted" : final.state === "failed" ? (transport.status === "page_limit_reached" ? "page_limit_reached" : "failed") : "completed" };
    } catch { return failure("finish_error"); }
  })();

  async function readPages(): Promise<CatalogSyncRunResult> {
    const seen = new Set<string>();
    for (const segment of segments) {
      let url: string | null = segment.startUrl;
      while (url !== null) {
        nextPageUrl = url;
        if (abort.signal.aborted) return { ...facts(), status: "aborted" };
        if (pages >= maxPages) return { ...facts(), status: "page_limit_reached", error: { code: "page_limit_reached" } };
        if (seen.has(url)) return failure("pagination_loop");
        if (nextLibraryUrl(url, url, segment.libraryType) === null) return failure("next_page_url_not_allowed");
        if (pages > 0) await sleep(options.pageDelayMs ?? 1_500, abort.signal);
        if (abort.signal.aborted) return { ...facts(), status: "aborted" };
        seen.add(url);
        let fetched: CatalogSyncFetchOutcome;
        try { fetched = await options.fetch(url, AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)])); }
        catch { return abort.signal.aborted ? { ...facts(), status: "aborted" } : failure("fetch_error"); }
        if (abort.signal.aborted) return { ...facts(), status: "aborted" };
        if (fetched.status !== 200) return failure("http_status");
        if (isSignInPage(fetched.body)) return failure("sign_in_redirect");
        let response: CatalogSyncInvokeResult;
        try { response = await options.invoke({ schemaVersion: "0.3", runId, libraryType: segment.libraryType,
          pageNumber: pages + 1, sourceUrl: url, html: fetched.body, fetchedAt: now().toISOString() }); }
        catch { return failure("invoke_error"); }
        if (!response.ok) return response.error?.code === "vua.catalog.cancelled" ? { ...facts(), status: "aborted" } : failure(response.error?.code ?? "ingest_error");
        if (!isCatalogSyncPageResultV03(response.value) || response.value.sourceUrl !== url) return failure("invalid_receipt");
        const page = response.value;
        pages += 1; parsedCount += page.parsedCount; upsertedCount += page.upsertedCount; rejectedCount += page.rejectedItems.length;
        if (page.cancellationRequested || abort.signal.aborted) return { ...facts(), status: "aborted" };
        if (page.nextPageUrl === null) url = null;
        else {
          const next = nextLibraryUrl(page.nextPageUrl, url, segment.libraryType);
          if (next === null) return failure("next_page_url_not_allowed");
          url = next;
        }
      }
    }
    nextPageUrl = null;
    return { ...facts(), status: "completed" };
  }

  return { runId, ready, result, stop: () => abort.abort() };
}

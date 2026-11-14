import {
  isCatalogProductIdV01, isCatalogProductObservationResultV01,
  type CatalogProductObservationV01,
} from "@vua/contracts";
import type { BoothReadGate } from "./booth-read-gate.js";

export type CatalogProductReadOutcome = "updated" | "missing" | "stop";
export interface CatalogProductReader {
  readonly fetch: (url: string, signal: AbortSignal) => Promise<{ readonly status: number; readonly body: string; readonly finalUrl: string }>;
  readonly observe: (params: CatalogProductObservationV01) => Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: { readonly code: string } }>;
  readonly observeLegacyHtml?: (params: CatalogProductObservationV01) => Promise<boolean>;
  readonly now?: () => number;
}

function sameProduct(url: string, productId: string, format: "json" | "html"): boolean {
  try {
    const parsed = new URL(url);
    const match = /^\/(?:ja\/|en\/|ko\/|zh-cn\/|zh-tw\/)?items\/([0-9]{1,20})(\.json)?\/?$/.exec(parsed.pathname);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port
      && (parsed.hostname === "booth.pm" || parsed.hostname.endsWith(".booth.pm"))
      && !!match && `booth:${match[1]}` === productId && !!match[2] === (format === "json");
  } catch { return false; }
}

/** One explicit product only. Credentials stay in the supplied local session reader. */
export async function readCatalogProduct(
  productId: string, options: CatalogProductReader, signal: AbortSignal,
  beforeRead: () => Promise<void> = async () => {},
): Promise<CatalogProductReadOutcome> {
  if (!isCatalogProductIdV01(productId)) return "missing";
  for (const format of ["json", "html"] as const) {
    signal.throwIfAborted();
    await beforeRead();
    signal.throwIfAborted();
    const sourceUrl = `https://booth.pm/zh-cn/items/${productId.slice(6)}${format === "json" ? ".json" : ""}`;
    try {
      const response = await options.fetch(sourceUrl, AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
      signal.throwIfAborted();
      if (response.status === 403 || response.status === 429 || response.status >= 500) return "stop";
      if (response.status !== 200) { if (format === "json") continue; return "missing"; }
      if (!sameProduct(response.finalUrl, productId, format)) return "stop";
      if (Buffer.byteLength(response.body, "utf8") > 5_000_000) return "stop";
      const params: CatalogProductObservationV01 = { schemaVersion: "0.1", productId, format, sourceUrl,
        body: response.body, fetchedAt: new Date((options.now ?? Date.now)()).toISOString() };
      const receipt = await options.observe(params);
      signal.throwIfAborted();
      if (receipt.ok) return isCatalogProductObservationResultV01(receipt.value) && receipt.value.productId === productId ? "updated" : "stop";
      if (receipt.error.code === "vua.provider.unknown_method") {
        if (format === "json") continue;
        const updated = await options.observeLegacyHtml?.(params);
        signal.throwIfAborted();
        return updated === true ? "updated" : "stop";
      }
      if (format === "json" && receipt.error.code === "vua.catalog.invalid_product") continue;
      return "stop";
    } catch (error) {
      if (signal.aborted) throw error;
      return "stop";
    }
  }
  return "missing";
}

export interface CatalogEnrichmentOptions {
  readonly canRun: () => boolean;
  readonly queue: (limit: number) => Promise<readonly string[]>;
  readonly claim: (productId: string) => Promise<boolean>;
  readonly read: (productId: string, signal: AbortSignal, beforeRead: () => Promise<void>) => Promise<CatalogProductReadOutcome>;
  readonly refreshed: (updated: number) => void;
  readonly readGate?: BoothReadGate;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}
export interface CatalogEnricher {
  scheduleIdle(): void;
  afterSync(): Promise<void>;
  noteRead(): void;
  pause(): void;
  dispose(): void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("catalog_read_aborted")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** Keep this instance for the whole application launch, including AMF remounts. */
export function createCatalogEnricher(options: CatalogEnrichmentOptions): CatalogEnricher {
  const now = options.now ?? (() => performance.now());
  const wait = options.sleep ?? sleep;
  let attempted = 0;
  let lastReadAt: number | null = null;
  let stopped = false;
  let disposed = false;
  let controller: AbortController | null = null;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const scheduleIdle = () => {
    clearTimer();
    if (disposed || stopped || attempted >= 60) return;
    timer = setTimeout(() => { timer = null; void run(); }, 60_000);
    timer.unref?.();
  };
  const run = (): Promise<void> => {
    clearTimer();
    if (running !== null) return running;
    if (disposed || stopped || attempted >= 60) return Promise.resolve();
    if (!options.canRun()) { scheduleIdle(); return Promise.resolve(); }
    const abort = new AbortController(); controller = abort;
    let updated = 0;
    const check = () => {
      if (!options.canRun()) abort.abort();
      abort.signal.throwIfAborted();
    };
    const waitForSlot = async () => {
      check();
      if (options.readGate !== undefined) {
        await options.readGate.waitUntilReady(abort.signal);
        check();
        return;
      }
      if (lastReadAt !== null) {
        // A backwards wall clock never permits a burst or an unbounded delay.
        const delay = Math.min(5_000, Math.max(0, 5_000 - (now() - lastReadAt)));
        if (delay > 0) await wait(delay, abort.signal);
      }
      check();
    };
    const beforeRead = async () => {
      if (options.readGate !== undefined) {
        check();
        await options.readGate.acquire(abort.signal, { foreground: false });
        check();
        return;
      }
      await waitForSlot();
      lastReadAt = now();
    };
    running = (async () => {
      try {
        const ids = await options.queue(60 - attempted);
        check();
        if (ids.length > 60 - attempted || ids.some(id => !isCatalogProductIdV01(id)) || new Set(ids).size !== ids.length) { stopped = true; return; }
        for (const productId of ids) {
          await waitForSlot();
          if (!await options.claim(productId)) continue;
          attempted += 1; check();
          const outcome = await options.read(productId, abort.signal, beforeRead);
          check();
          if (outcome === "stop") { stopped = true; break; }
          if (outcome === "updated") updated += 1;
        }
      } catch {
        if (!abort.signal.aborted) stopped = true;
      } finally {
        controller = null;
        if (updated > 0 && !disposed) {
          try { options.refreshed(updated); } catch { /* Persisted facts survive a closed view. */ }
        }
        if (abort.signal.aborted && !disposed) scheduleIdle();
      }
    })().finally(() => { running = null; });
    return running;
  };
  return {
    scheduleIdle,
    afterSync: run,
    noteRead() {
      if (options.readGate !== undefined) options.readGate.noteRead();
      else lastReadAt = now();
    },
    pause() { clearTimer(); controller?.abort(); scheduleIdle(); },
    dispose() { disposed = true; clearTimer(); controller?.abort(); },
  };
}

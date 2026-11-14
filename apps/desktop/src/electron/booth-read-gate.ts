import {
  boothFreeAssetsBrowseUrl,
  FREE_ASSET_MAX_ENABLED_KEYWORDS_V01,
  normalizeFreeAssetsQueryTargetV01,
  type FreeAssetsDesktopErrorV01,
  type FreeAssetsDesktopStatusV01,
  type FreeAssetsIngestSearchPageParamsV01,
  type FreeAssetsQueryTargetV01,
  type FreeAssetsStateV01,
} from "@vua/contracts";

export const BOOTH_READ_INTERVAL_MS = 5_000;
export const FREE_ASSETS_SEARCH_INTERVAL_MS = 1_500;

export interface BoothReadGateOptions {
  readonly minIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface BoothReadGate {
  /** Waits until the spacing window is open without consuming a slot. */
  waitUntilReady(signal?: AbortSignal, intervalOverrideMs?: number): Promise<void>;
  /** Acquires the next FIFO BOOTH read slot and stamps the read timestamp. */
  acquire(
    signal?: AbortSignal,
    options?: { readonly foreground?: boolean; readonly minIntervalMs?: number },
  ): Promise<void>;
  /** Records an external BOOTH session read (such as a library sync page). */
  noteRead(): void;
  /** Marks an active foreground BOOTH operation so background enrichment yields. */
  beginForeground(): () => void;
  hasForegroundActivity(): boolean;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error("booth_read_aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function waitPromiseWithAbort(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("booth_read_aborted"));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("booth_read_aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export function createBoothReadGate(options: BoothReadGateOptions = {}): BoothReadGate {
  const minIntervalMs = options.minIntervalMs ?? BOOTH_READ_INTERVAL_MS;
  const now = options.now ?? (() => performance.now());
  const wait = options.sleep ?? abortableSleep;

  let lastReadAt: number | null = null;
  let foregroundScopes = 0;
  let foregroundWaiters = 0;
  let tail: Promise<void> = Promise.resolve();

  const waitUntilReady = async (
    signal?: AbortSignal,
    intervalOverrideMs?: number,
  ): Promise<void> => {
    const effectiveInterval = intervalOverrideMs ?? minIntervalMs;
    const effectiveSignal = signal ?? new AbortController().signal;
    effectiveSignal.throwIfAborted();
    while (lastReadAt !== null) {
      const delay = Math.min(
        effectiveInterval,
        Math.max(0, effectiveInterval - (now() - lastReadAt)),
      );
      if (delay <= 0) break;
      await wait(delay, effectiveSignal);
      effectiveSignal.throwIfAborted();
    }
  };

  return {
    waitUntilReady,
    async acquire(
      signal?: AbortSignal,
      acquireOptions?: { readonly foreground?: boolean; readonly minIntervalMs?: number },
    ): Promise<void> {
      signal?.throwIfAborted();
      const isForeground = acquireOptions?.foreground === true;
      if (isForeground) foregroundWaiters += 1;
      const previous = tail;
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tail = previous.then(() => current, () => current);

      let released = false;
      const finishTurn = () => {
        if (!released) {
          released = true;
          release();
        }
      };

      try {
        try {
          await waitPromiseWithAbort(previous, signal);
        } catch (error) {
          void previous.finally(finishTurn);
          throw error;
        }
        await waitUntilReady(signal, acquireOptions?.minIntervalMs);
        lastReadAt = now();
        finishTurn();
      } catch (error) {
        if (signal?.aborted !== true) finishTurn();
        else if (released === false) {
          // Aborted during waitUntilReady after `previous` already settled.
          finishTurn();
        }
        throw error;
      } finally {
        if (isForeground) foregroundWaiters -= 1;
      }
    },
    noteRead(): void {
      lastReadAt = now();
    },
    beginForeground(): () => void {
      foregroundScopes += 1;
      let ended = false;
      return () => {
        if (!ended) {
          ended = true;
          foregroundScopes -= 1;
        }
      };
    },
    hasForegroundActivity(): boolean {
      return foregroundScopes > 0 || foregroundWaiters > 0;
    },
  };
}

export interface FreeAssetsRunnerOptions {
  readonly gate: BoothReadGate;
  readonly canRun: () => boolean;
  readonly readState: () => Promise<FreeAssetsStateV01 | null>;
  readonly ingestPage: (
    params: FreeAssetsIngestSearchPageParamsV01,
  ) => Promise<
    | { readonly ok: true; readonly value: FreeAssetsStateV01 }
    | { readonly ok: false; readonly code: string }
  >;
  readonly fetch: (
    url: string,
    signal: AbortSignal,
  ) => Promise<{ readonly status: number; readonly body: string; readonly finalUrl: string }>;
  readonly onPauseBackground?: () => void;
  readonly onResumeBackground?: () => void;
  readonly nowMs?: () => number;
}

export interface FreeAssetsRunner {
  status(): FreeAssetsDesktopStatusV01;
  isRunning(): boolean;
  query(target?: FreeAssetsQueryTargetV01): Promise<FreeAssetsDesktopStatusV01>;
  cancel(): void;
  subscribe(listener: (status: FreeAssetsDesktopStatusV01) => void): () => void;
  dispose(): void;
}

function isSignInRedirectUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === "accounts.booth.pm"
      || parsed.hostname === "accounts.pixiv.net"
      || parsed.hostname.endsWith(".pixiv.net")
      || parsed.pathname.includes("/users/sign_in")
    );
  } catch {
    return false;
  }
}

function isExpectedBrowseFinalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol !== "https:"
      || parsed.hostname !== "booth.pm"
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.port !== ""
    ) {
      return false;
    }
    return decodeURIComponent(parsed.pathname) === "/ja/browse/3Dモデル";
  } catch {
    return false;
  }
}

export function createFreeAssetsRunner(options: FreeAssetsRunnerOptions): FreeAssetsRunner {
  const nowMs = options.nowMs ?? Date.now;
  const listeners = new Set<(status: FreeAssetsDesktopStatusV01) => void>();

  let running = false;
  let currentKeyword: string | null = null;
  let completedKeywords = 0;
  let totalKeywords = 0;
  let lastError: FreeAssetsDesktopErrorV01 | null = null;
  let controller: AbortController | null = null;
  let activePromise: Promise<FreeAssetsDesktopStatusV01> | null = null;
  let disposed = false;

  const currentStatus = (): FreeAssetsDesktopStatusV01 => ({
    schemaVersion: "0.1",
    running,
    currentKeyword,
    completedKeywords,
    totalKeywords,
    cooldownUntilMs: null,
    lastError,
  });

  const publish = (): FreeAssetsDesktopStatusV01 => {
    const snapshot = currentStatus();
    if (!disposed) {
      for (const listener of listeners) {
        try {
          listener(snapshot);
        } catch {
          /* Subscriber errors never break runner state transitions. */
        }
      }
    }
    return snapshot;
  };

  return {
    status: currentStatus,
    isRunning: () => running,
    async query(target?: FreeAssetsQueryTargetV01): Promise<FreeAssetsDesktopStatusV01> {
      if (disposed) return currentStatus();
      const normalized = normalizeFreeAssetsQueryTargetV01(target);
      if (normalized === "invalid") {
        lastError = "no_keywords";
        return publish();
      }
      if (activePromise !== null) {
        controller?.abort();
        await activePromise.catch(() => undefined);
        if (disposed) return currentStatus();
      }
      if (!options.canRun()) {
        lastError = "busy";
        return publish();
      }

      let keywords: readonly string[];
      if (normalized !== null) {
        keywords = normalized;
      } else {
        const state = await options.readState();
        if (disposed) return currentStatus();
        if (activePromise !== null) return currentStatus();
        if (state === null || !options.canRun()) {
          lastError = "busy";
          return publish();
        }
        keywords = state.watchedKeywords
          .filter((row) => row.enabled)
          .map((row) => row.keyword)
          .slice(0, FREE_ASSET_MAX_ENABLED_KEYWORDS_V01);
        if (keywords.length === 0) {
          lastError = "no_keywords";
          return publish();
        }
      }

      const abort = new AbortController();
      controller = abort;
      running = true;
      completedKeywords = 0;
      totalKeywords = keywords.length;
      currentKeyword = keywords[0] ?? null;
      lastError = null;
      const endForeground = options.gate.beginForeground();
      options.onPauseBackground?.();
      publish();

      let runPromise: Promise<FreeAssetsDesktopStatusV01> | null = null;
      runPromise = (async (): Promise<FreeAssetsDesktopStatusV01> => {
        try {
          for (let index = 0; index < keywords.length; index += 1) {
            const keyword = keywords[index]!;
            currentKeyword = keyword;
            publish();

            await options.gate.acquire(abort.signal, {
              foreground: true,
              minIntervalMs: FREE_ASSETS_SEARCH_INTERVAL_MS,
            });
            abort.signal.throwIfAborted();
            if (!options.canRun()) {
              lastError = "busy";
              break;
            }

            const sourceUrl = boothFreeAssetsBrowseUrl(keyword);
            let response: { readonly status: number; readonly body: string; readonly finalUrl: string };
            try {
              response = await options.fetch(
                sourceUrl,
                AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
              );
            } catch (error) {
              if (abort.signal.aborted) throw error;
              lastError = "network_failed";
              break;
            }
            abort.signal.throwIfAborted();

            if (isSignInRedirectUrl(response.finalUrl)) {
              lastError = "sign_in_required";
              break;
            }
            if (response.status === 429) {
              lastError = "rate_limited";
              break;
            }
            if (response.status !== 200 || !isExpectedBrowseFinalUrl(response.finalUrl)) {
              lastError = "network_failed";
              break;
            }
            if (response.body.length === 0 || Buffer.byteLength(response.body, "utf8") > 5_000_000) {
              lastError = "parse_failed";
              break;
            }

            const ingested = await options.ingestPage({
              schemaVersion: "0.1",
              keyword,
              sourceUrl,
              html: response.body,
              fetchedAt: new Date(nowMs()).toISOString(),
              resetCache: index === 0,
            });
            abort.signal.throwIfAborted();
            if (!ingested.ok) {
              lastError = ingested.code === "vua.free_assets.invalid_page" ? "parse_failed" : "network_failed";
              break;
            }

            completedKeywords = index + 1;
            currentKeyword = keywords[index + 1] ?? null;
            publish();
          }
        } catch {
          if (!abort.signal.aborted && lastError === null) {
            lastError = "network_failed";
          }
        } finally {
          running = false;
          currentKeyword = null;
          if (controller === abort) controller = null;
          if (activePromise === runPromise) activePromise = null;
          endForeground();
          if (!disposed) options.onResumeBackground?.();
        }
        return publish();
      })();

      activePromise = runPromise;
      return runPromise;
    },
    cancel(): void {
      if (controller !== null) {
        lastError = null;
        controller.abort();
      }
    },
    subscribe(listener: (status: FreeAssetsDesktopStatusV01) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      disposed = true;
      controller?.abort();
      listeners.clear();
    },
  };
}

import type { Session } from "electron";
import type { DownloadEventV01, LibraryDownloadObservationV01 } from "@vua/contracts";

export interface SilentDownloadBatch {
  readonly batchId: string; readonly productId: string; readonly downloadableIds: readonly number[];
}
export interface SilentDownloadQueueOptions {
  readonly partitionSession: Pick<Session, "downloadURL">;
  readonly observe: (observation: LibraryDownloadObservationV01) => Promise<void>;
  readonly abandon: (downloadId: string) => void;
  readonly setPaused?: (downloadId: string, paused: boolean) => boolean;
  readonly minIntervalMs?: number;
  readonly initiationTimeoutMs?: number;
  readonly log?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}
export interface SilentDownloadQueue {
  enqueue(batch: SilentDownloadBatch): number;
  pending(): number;
  /** Admission for one native binding of an already initiated selected file. */
  isAwaitingNative(originalUrl: string): boolean;
  /** Native binding only, never evidence that a delivery has been persisted. */
  notifyTransport(event: DownloadEventV01): void;
  notifyPersisted(event: DownloadEventV01): boolean;
  notifyUnconfirmed(event: DownloadEventV01): void;
  cancel(batchId: string): void;
  setPaused(batchId: string, paused: boolean): { readonly ok: boolean; readonly paused: boolean };
  transfers(): readonly { readonly batchId: string; readonly productId: string; readonly paused: boolean }[];
  dispose(): void;
}

/** Transport pacing and correlation only. Acquisition owns file verification,
 * replacement, batch finality and all durable results. */
export function createSilentDownloadQueue(options: SilentDownloadQueueOptions): SilentDownloadQueue {
  const minIntervalMs = options.minIntervalMs ?? 6_000;
  const initiationTimeoutMs = options.initiationTimeoutMs ?? 30_000;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  interface Entry {
    readonly batchId: string; readonly downloadableId: number;
    initiated: boolean; settled: boolean; downloadId: string | null;
    nativeTerminal: boolean;
    cancellationRequested: boolean; timer: ReturnType<typeof setTimeout> | null;
  }
  const entries: Entry[] = [];
  const batches = new Map<string, readonly Entry[]>();
  const controls = new Map<string, { productId: string; paused: boolean }>();
  const inFlight = new Map<string, Entry>();
  const reports: LibraryDownloadObservationV01[] = [];
  let disposed = false; let draining = false; let reporting = false;
  let lastInitiatedAt: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const urlOf = (entry: Entry): string => `https://booth.pm/downloadables/${entry.downloadableId}`;

  const sendReports = async (): Promise<void> => {
    if (reporting || disposed) return;
    reporting = true;
    try {
      while (reports.length > 0 && !disposed) {
        try {
          await options.observe(reports[0]!);
          reports.shift(); failures = 0;
        } catch {
          failures += 1;
          const delay = Math.min(1_000 * 2 ** Math.min(failures - 1, 5), 30_000);
          log(JSON.stringify({ channel: "silent-download", receiptUnconfirmed: true, batchId: reports[0]!.batchId }));
          retryTimer = setTimeout(() => { retryTimer = null; void sendReports(); }, delay);
          return;
        }
      }
      for (const [batchId, group] of batches) {
        if (group.every((entry) => entry.settled) && !reports.some((report) => report.batchId === batchId)) { batches.delete(batchId); controls.delete(batchId); }
      }
    } finally { reporting = false; }
  };
  const report = (entry: Entry, outcome: LibraryDownloadObservationV01["outcome"], downloadId?: string): void => {
    reports.push({ schemaVersion: "0.1", batchId: entry.batchId, downloadableId: entry.downloadableId, outcome, ...(downloadId === undefined ? {} : { downloadId }) });
    if (retryTimer === null) void sendReports();
  };
  const clearTimer = (entry: Entry): void => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  };
  const settle = (entry: Entry, outcome: LibraryDownloadObservationV01["outcome"], downloadId?: string): void => {
    if (entry.settled) return;
    entry.settled = true; clearTimer(entry);
    if (inFlight.get(urlOf(entry)) === entry) inFlight.delete(urlOf(entry));
    report(entry, outcome, downloadId);
  };
  const matching = (event: DownloadEventV01): Entry | undefined => {
    for (const url of [event.sourceUrl, ...(event.urlChain ?? [])]) {
      const entry = inFlight.get(url);
      if (entry !== undefined && (entry.downloadId === null || entry.downloadId === event.downloadId)) return entry;
    }
    return undefined;
  };
  const terminal = (event: DownloadEventV01): boolean => ["download.completed", "download.failed", "download.cancelled"].includes(event.kind);

  const drain = async (): Promise<void> => {
    if (draining || disposed) return;
    draining = true;
    try {
      while (entries.length > 0 && !disposed) {
        const index = entries.findIndex(entry => !entry.settled && !controls.get(entry.batchId)?.paused);
        if (index < 0) break;
        const entry = entries.splice(index, 1)[0]!;
        if (entry.settled) continue;
        if (lastInitiatedAt !== null) {
          const wait = minIntervalMs - (now() - lastInitiatedAt);
          if (wait > 0) await sleep(wait);
        }
        if (disposed || entry.settled) continue;
        if (controls.get(entry.batchId)?.paused) { entries.unshift(entry); continue; }
        const url = urlOf(entry);
        // Server admission prevents concurrent acquisition of the same file;
        // refuse local collisions too, rather than overwriting correlation.
        if (inFlight.has(url)) { settle(entry, "initiation_failed"); continue; }
        lastInitiatedAt = now(); entry.initiated = true; inFlight.set(url, entry);
        entry.timer = setTimeout(() => settle(entry, entry.cancellationRequested ? "cancelled" : "initiation_failed"), initiationTimeoutMs);
        try { options.partitionSession.downloadURL(url); }
        catch { settle(entry, "initiation_failed"); }
      }
    } finally { draining = false; }
  };

  return {
    enqueue(batch) {
      if (disposed || batches.has(batch.batchId) || batch.downloadableIds.length === 0
        || new Set(batch.downloadableIds).size !== batch.downloadableIds.length
        || batch.downloadableIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return 0;
      // Register ALL selected files before the first downloadURL call.
      const group = batch.downloadableIds.map((downloadableId): Entry => ({ batchId: batch.batchId, downloadableId, initiated: false, settled: false, nativeTerminal: false, downloadId: null, cancellationRequested: false, timer: null }));
      batches.set(batch.batchId, group); controls.set(batch.batchId, { productId: batch.productId, paused: false }); entries.push(...group); void drain(); return group.length;
    },
    pending: () => entries.filter((entry) => !entry.settled).length,
    isAwaitingNative(originalUrl) {
      const entry = inFlight.get(originalUrl);
      return !disposed && entry !== undefined && !entry.settled
        && !entry.cancellationRequested && entry.downloadId === null;
    },
    notifyTransport(event) {
      const entry = matching(event); if (entry === undefined) return;
      if (event.kind === "download.started" || terminal(event)) {
        entry.nativeTerminal = terminal(event);
        clearTimer(entry); entry.downloadId = event.downloadId;
        if (entry.cancellationRequested && !terminal(event)) options.abandon(event.downloadId);
        else if (!terminal(event) && controls.get(entry.batchId)?.paused && options.setPaused?.(event.downloadId, true) !== true) {
          controls.get(entry.batchId)!.paused = false;
          for (const bound of batches.get(entry.batchId) ?? []) if (!bound.nativeTerminal && bound.downloadId !== null) options.setPaused?.(bound.downloadId, false);
          void drain();
        }
      }
    },
    notifyPersisted(event) {
      const entry = matching(event); if (entry === undefined) return false;
      if (terminal(event)) settle(entry, "settled", event.downloadId);
      else if (event.kind === "download.started") report(entry, "started", event.downloadId);
      return true;
    },
    notifyUnconfirmed(event) {
      const entry = matching(event); if (entry !== undefined && (terminal(event) || event.kind === "download.started")) settle(entry, "unconfirmed");
    },
    cancel(batchId) {
      for (const entry of batches.get(batchId) ?? []) {
        if (entry.settled) continue;
        entry.cancellationRequested = true;
        if (!entry.initiated) settle(entry, "cancelled");
        else if (entry.downloadId !== null) options.abandon(entry.downloadId);
      }
    },
    setPaused(batchId, paused) {
      const control = controls.get(batchId);
      const group = batches.get(batchId);
      if (disposed || control === undefined || group === undefined || !group.some(e => !e.settled && !e.cancellationRequested)) return { ok: false, paused: false };
      const previous = control.paused;
      control.paused = paused;
      const applied: string[] = [];
      for (const entry of group) {
        if (entry.settled || entry.nativeTerminal || entry.cancellationRequested || entry.downloadId === null) continue;
        if (options.setPaused?.(entry.downloadId, paused) !== true) {
          for (const id of applied) options.setPaused?.(id, previous);
          control.paused = previous;
          return { ok: false, paused: previous };
        }
        applied.push(entry.downloadId);
      }
      if (!paused) void drain();
      return { ok: true, paused };
    },
    transfers: () => [...controls].filter(([id]) => batches.get(id)?.some(e => !e.settled && !e.cancellationRequested)).map(([batchId, control]) => ({ batchId, ...control })),
    dispose() {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      for (const group of batches.values()) for (const entry of group) clearTimer(entry);
      entries.length = 0; reports.length = 0; batches.clear(); controls.clear(); inFlight.clear();
    },
  };
}

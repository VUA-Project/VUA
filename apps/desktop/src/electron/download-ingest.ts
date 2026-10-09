import type { DownloadEventV01, DownloadIngestReceiptV03 } from "@vua/contracts";

/**
 * 下载事件 → provider `download.ingest` 的投递泵（F4-3/F4-4，自 main.ts
 * 抽出以便测试）。投递语义 at-least-once：
 * - 批量冲刷：到达 `flushThreshold`(默认 20)条立即冲，否则 `flushIntervalMs`
 *   (默认 1s)定时冲；缓冲上限 `bufferCap`(默认 1000)超限丢最旧（回执裁剪
 *   ＋BDL 唯一键去重兜底，与原 main.ts 行为一致）；
 * - 失败重灌＋**自主重试驱动**：投递失败（invoke 抛错或 ok:false）整批回灌，
 *   并按指数退避（1s 起、×2、上限 `maxBackoffMs` 默认 30s）自主排定下一次
 *   冲刷——不依赖后续新事件到达（修复：provider 短暂不可达＋之后无新下载
 *   时，缓冲事件曾无限期滞留，BDL 永远收不到该批事实）；成功一次即归零
 *   退避；
 * - 单条非法事件死信（receipt.rejected）：诊断通道留痕，不毒化整批。
 * 全部依赖注入（invoke/log/时间参数），模块不 import Electron。
 */

export interface DownloadIngestInvokeResult {
  readonly ok: boolean;
  readonly value?: unknown;
}

export type DownloadIngestInvoke = (params: {
  readonly schemaVersion: "0.1";
  readonly events: readonly DownloadEventV01[];
}) => Promise<DownloadIngestInvokeResult>;

export interface DownloadEventSinkOptions {
  readonly invoke: DownloadIngestInvoke;
  /** Only acknowledged records may drive adoption or batch settlement. */
  readonly onPersisted?: (event: DownloadEventV01) => void;
  readonly onRejected?: (event: DownloadEventV01, code: string) => void;
  readonly onDropped?: (event: DownloadEventV01) => void;
  /** 定时冲刷间隔（默认 1000ms） */
  readonly flushIntervalMs?: number;
  /** 立即冲刷阈值（默认 20 条） */
  readonly flushThreshold?: number;
  /** 缓冲上限，超限丢最旧（默认 1000 条） */
  readonly bufferCap?: number;
  /** 失败重试退避上限（默认 30_000ms；序列 1s→2s→4s→…→cap） */
  readonly maxBackoffMs?: number;
  /** 诊断通道（默认 stderr 单行 JSON；测试注入捕获） */
  readonly log?: (line: string) => void;
}

export interface DownloadEventSink {
  emit(event: DownloadEventV01): void;
  pending(): boolean;
  /** 丢弃待冲刷缓冲并取消定时器（窗口关闭路径） */
  dispose(): void;
}

interface QueuedEvent {
  readonly event: DownloadEventV01;
}

function validReceipt(value: unknown, batchLength: number): value is DownloadIngestReceiptV03 {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!count(receipt.folded) || !count(receipt.duplicates) || !Array.isArray(receipt.rejected)) return false;
  const indexes = new Set<number>();
  for (const value of receipt.rejected) {
    if (typeof value !== "object" || value === null) return false;
    const item = value as Record<string, unknown>;
    if (!count(item.index) || item.index >= batchLength || indexes.has(item.index)
      || typeof item.code !== "string" || item.code.length === 0 || typeof item.reason !== "string") return false;
    indexes.add(item.index);
  }
  // The frozen receipt counts ledger writes even when task folding is rejected.
  const acknowledged = receipt.folded + receipt.duplicates;
  return acknowledged <= batchLength && acknowledged >= batchLength - indexes.size;
}

export function createDownloadEventSink(options: DownloadEventSinkOptions): DownloadEventSink {
  const flushIntervalMs = options.flushIntervalMs ?? 1_000;
  const flushThreshold = options.flushThreshold ?? 20;
  const bufferCap = options.bufferCap ?? 1_000;
  const maxBackoffMs = options.maxBackoffMs ?? 30_000;
  const log =
    options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const buffer: QueuedEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;
  let disposed = false;
  let flushing = false;

  const trimBuffer = (): void => {
    if (buffer.length <= bufferCap) return;
    const dropped = buffer.splice(0, buffer.length - bufferCap);
    for (const item of dropped) options.onDropped?.(item.event);
  };

  const flushIngest = async (): Promise<void> => {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer.splice(0, buffer.length);
    try {
      const result = await options.invoke({
        schemaVersion: "0.1",
        events: batch.map((queued) => queued.event),
      });
      if (!result.ok) {
        throw new Error("download.ingest returned an application error");
      }
      if (!validReceipt(result.value, batch.length)) throw new Error("download.ingest returned an invalid receipt");
      const rejectedIndexes = new Set(result.value.rejected.map((item) => item.index));
      const retry: QueuedEvent[] = [];
      for (const rejected of result.value.rejected) {
        const item = batch[rejected.index]!;
        if (rejected.code === "vua.download.store_failed") retry.push(item);
        else {
          // Diagnostic codes only: reasons can contain private paths or URLs.
          log(JSON.stringify({ channel: "download-events", deadLetter: rejected.code, downloadId: item.event.downloadId }));
          options.onRejected?.(item.event, rejected.code);
        }
      }
      for (const [index, item] of batch.entries()) {
        if (!rejectedIndexes.has(index) && !disposed) options.onPersisted?.(item.event);
      }
      buffer.unshift(...retry);
      trimBuffer();
      consecutiveFailures = 0;
      if (retry.length > 0) scheduleFlush(flushIntervalMs);
    } catch (error) {
      // 投递失败:整批回灌,排定退避重试——不等新事件(at-least-once 自驱)
      buffer.unshift(...batch);
      trimBuffer();
      consecutiveFailures += 1;
      const backoff = Math.min(flushIntervalMs * 2 ** (consecutiveFailures - 1), maxBackoffMs);
      log(
        JSON.stringify({
          channel: "download-events",
          ingestRetry: "receipt_unconfirmed",
          attempt: consecutiveFailures,
          nextRetryMs: backoff,
        }),
      );
      scheduleFlush(backoff);
    } finally {
      flushing = false;
      // Events arriving while an invoke is pending still need a driver.
      scheduleFlush(flushIntervalMs);
    }
  };

  const scheduleFlush = (delayMs: number): void => {
    if (flushTimer !== null || buffer.length === 0 || disposed) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushIngest();
    }, delayMs);
  };

  return {
    pending: () => buffer.length > 0 || flushing,
    emit(event: DownloadEventV01): void {
      if (disposed) return;
      buffer.push({ event });
      trimBuffer();
      if (buffer.length >= flushThreshold) {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        void flushIngest();
      } else {
        scheduleFlush(flushIntervalMs);
      }
    },
    dispose(): void {
      disposed = true;
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      buffer.splice(0, buffer.length);
    },
  };
}

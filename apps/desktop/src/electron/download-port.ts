import fs from "node:fs";
import path from "node:path";
import type { DownloadItem, Session, WebContents } from "electron";
import {
  DOWNLOAD_EVENT_SCHEMA_VERSION,
  type DownloadEventV01,
  type DownloadFailureKindV01,
} from "@vua/contracts";
import { isAllowedRemoteOrigin } from "./security.js";

/**
 * 下载端口(F4-3):`will-download` 接管与 download-events v0.1 冻结词表的
 * 事件规范化。端口只报传输事实——内容身份(SHA-256)、检查结论、来源关联
 * 与 Warehouse 决策全部归 AMF;事件永不携带 Cookie/下载令牌/凭据,
 * `storedPath` 是唯一路径字段。
 *
 * - `downloadId` 由端口分配,同一 `DownloadItem`(含 resume)跨重试稳定;
 * - attempt 纪律:resume() 延续同一 attempt;弃件从零重启(经
 *   `session.downloadURL` 重发起的新 item 重绑定原 downloadId)才递增;
 * - `failureKind` 词表闭合 `policy | unknown`:只有允许清单拒绝是端口可
 *   自证归因(policy,发生在文件创建前,storedPath 为空),其余如实 unknown;
 * - 重试策略归 AMF,机制归端口:`applyIntent` 是 AMF 意图命令的唯一入口,
 *   同一下载按到达序串行解释;AMF→Main 的投递腿随 M3 双向契约切片接线,
 *   本模块只依赖注入的意图入口与事件汇;
 * - progress 节流归端口(协议:AMF 不依赖其频率)。
 */

export interface DownloadEventSink {
  /** 投递保证与去重由通道组合:发送方重发未折叠事件 + BDL 唯一键去重 */
  emit(event: DownloadEventV01): void;
}

export interface DownloadPortOptions {
  /** VUA 管控的下载暂存目录(注入;端口不自选路径策略) */
  readonly stagingRoot: string;
  /** 分区 Session(retry 全新 attempt 时经 downloadURL 重发起) */
  readonly partitionSession: Session;
  readonly allowedOrigins: readonly string[];
  /** Private library composition: an admitted BOOTH request awaiting native binding. */
  readonly isAwaitingLibraryRequest?: (originalUrl: string) => boolean;
  readonly sink: DownloadEventSink;
  readonly now?: () => string;
  /** progress 节流间隔(默认 250ms;冒烟可调小) */
  readonly progressIntervalMs?: number;
}

/**
 * AMF 意图词汇(冻结裁定):`resume` = 可续传中断的同一 attempt 续传;
 * `retry` = 弃件后全新 attempt(经 downloadURL 重发起,重绑原 downloadId);
 * `abandon` = 放弃(取消并弃除部分文件,终态)。
 */
export type DownloadIntent = "abandon" | "resume" | "retry";

interface DownloadRecord {
  readonly downloadId: string;
  readonly sourceUrl: string;
  readonly initiatedFromPageUrl: string | null;
  readonly urlChain: readonly string[] | null;
  readonly selectedLibraryUrl: string | null;
  readonly suggestedFileName: string | null;
  readonly item: DownloadItem;
  attempt: number;
  /** 已弃件:等待经 downloadURL 重发起的下一个 item 重绑定(downloadId 不变) */
  abandoned: boolean;
  lastProgressAt: number;
  lastProgressBytes: number;
}

export class DownloadPort {
  readonly #options: DownloadPortOptions;
  readonly #records = new Map<string, DownloadRecord>();
  /** 弃件后等待重绑定的下载:按 sourceUrl 键(重发起的 item 以同 URL 到来) */
  readonly #pendingRestarts = new Map<string, { downloadId: string; attempt: number; selectedLibraryUrl: string | null }>();
  #sequence = 0;

  constructor(options: DownloadPortOptions) {
    this.#options = options;
    fs.mkdirSync(options.stagingRoot, { recursive: true });
  }

  /**
   * `will-download` 接管入口(security 层接缝委托)。允许清单外的下载在
   * 文件创建前拒绝:preventDefault + failed/policy(storedPath 为空)。
   */
  handleWillDownload(event: { readonly preventDefault: () => void }, item: DownloadItem, webContents: WebContents): void {
    const sourceUrl = item.getURL();
    const urlChain = this.#urlChainOf(item);
    const selectedLibraryUrl = this.#selectedLibraryUrlOf(sourceUrl, urlChain);
    if (!isAllowedRemoteOrigin(sourceUrl, this.#options.allowedOrigins) && selectedLibraryUrl === null) {
      event.preventDefault();
      this.#emit({
        kind: "download.failed",
        downloadId: this.#nextId(),
        attempt: 1,
        sourceUrl,
        initiatedFromPageUrl: this.#pageUrlOf(webContents),
        urlChain,
        suggestedFileName: this.#suggestedNameOf(item),
        storedPath: null,
        expectedBytes: this.#expectedBytesOf(item),
        receivedBytes: null,
        resumable: false,
        failureKind: "policy",
      });
      return;
    }

    // 弃件重发起:同 URL 的新 item 重绑定原 downloadId,attempt 递增
    const requestUrl = selectedLibraryUrl ?? sourceUrl;
    const restart = this.#pendingRestarts.get(requestUrl);
    this.#sequence += 1;
    const downloadId = restart?.downloadId ?? `dl-${this.#sequence}-${crypto.randomUUID()}`;
    const attempt = restart ? restart.attempt + 1 : 1;
    if (restart !== undefined) this.#pendingRestarts.delete(requestUrl);

    const storedPath = this.#reserveStagingPath(downloadId, item.getFilename());
    item.setSavePath(storedPath);
    const record: DownloadRecord = {
      downloadId,
      sourceUrl,
      initiatedFromPageUrl: this.#pageUrlOf(webContents),
      urlChain,
      selectedLibraryUrl,
      suggestedFileName: this.#suggestedNameOf(item),
      item,
      attempt,
      abandoned: false,
      lastProgressAt: 0,
      lastProgressBytes: -1,
    };
    this.#records.set(downloadId, record);

    item.on("updated", (_event, state) => {
      if (record.abandoned) return;
      if (state === "progressing" && !item.isPaused()) this.#emitProgressThrottled(record);
    });
    item.on("done", (_event, state) => {
      if (record.abandoned) return;
      if (state === "completed") {
        this.#emit({
          kind: "download.completed",
          downloadId,
          attempt,
          sourceUrl: record.sourceUrl,
          initiatedFromPageUrl: record.initiatedFromPageUrl,
          urlChain: record.urlChain,
          suggestedFileName: record.suggestedFileName,
          storedPath: item.getSavePath() || record.item.getSavePath() || null,
          expectedBytes: this.#expectedBytesOf(item),
          receivedBytes: this.#receivedBytesOf(item.getReceivedBytes()),
          resumable: false,
          failureKind: null,
        });
      } else if (state === "cancelled") {
        this.#emit({
          kind: "download.cancelled",
          downloadId,
          attempt,
          sourceUrl: record.sourceUrl,
          initiatedFromPageUrl: record.initiatedFromPageUrl,
          urlChain: record.urlChain,
          suggestedFileName: record.suggestedFileName,
          storedPath: item.getSavePath() || null,
          expectedBytes: this.#expectedBytesOf(item),
          receivedBytes: this.#receivedBytesOf(item.getReceivedBytes()),
          resumable: false,
          failureKind: null,
        });
      } else {
        // interrupted:canResume() 是端口唯一的可续传判定;不可续传即
        // 终态失败,归因如实 unknown
        const resumable = item.canResume();
        this.#emit({
          kind: resumable ? "download.interrupted" : "download.failed",
          downloadId,
          attempt,
          sourceUrl: record.sourceUrl,
          initiatedFromPageUrl: record.initiatedFromPageUrl,
          urlChain: record.urlChain,
          suggestedFileName: record.suggestedFileName,
          storedPath: item.getSavePath() || null,
          expectedBytes: this.#expectedBytesOf(item),
          receivedBytes: this.#receivedBytesOf(item.getReceivedBytes()),
          resumable,
          failureKind: resumable ? null : "unknown",
        });
      }
    });

    this.#emit({
      kind: "download.started",
      downloadId,
      attempt,
      sourceUrl,
      initiatedFromPageUrl: record.initiatedFromPageUrl,
      urlChain: record.urlChain,
      suggestedFileName: record.suggestedFileName,
      storedPath,
      expectedBytes: this.#expectedBytesOf(item),
      receivedBytes: this.#receivedBytesOf(item.getReceivedBytes()),
      resumable: false,
      failureKind: null,
    });
  }

  /**
   * AMF 意图命令唯一入口(同一下载按到达序串行解释;策略归 AMF,机制归
   * 端口):`retry` = 弃件并经 downloadURL 重发起,新 item 重绑原
   * downloadId 且 attempt 递增(冻结裁定:放弃部分文件从零重启才递增);
   * `abandon` = 终局放弃(取消并弃除部分文件,不重绑——其后同 URL 重发起
   * 是用户新授权,全新 downloadId、attempt 从 1)。
   * 未知 downloadId 静默忽略(命令与下载生命周期的竞态由 AMF 层权威裁决)。
   */
  applyIntent(downloadId: string, intent: DownloadIntent): void {
    const record = this.#records.get(downloadId);
    if (record === undefined || record.abandoned) return;
    const item = record.item;
    if (intent === "resume") {
      // 同一 attempt 续传:canResume() 是唯一判据
      if (item.canResume()) item.resume();
      return;
    }
    // abandon / retry(全新 attempt):取消 + 弃除部分文件;retry 经
    // downloadURL 重发起,新 item 在 will-download 重绑原 downloadId
    // (attempt + 1);abandon 到此为止(AMF 已放弃)
    record.abandoned = true;
    const partialPath = item.getSavePath();
    item.cancel();
    this.#records.delete(downloadId);
    if (partialPath && fs.existsSync(partialPath)) {
      try {
        fs.rmSync(partialPath, { force: true });
      } catch {
        /* 部分文件已不存在:弃除语义已达成 */
      }
    }
    if (intent === "retry") {
      // 全新 attempt:重发起的新 item 将在 will-download 重绑原 downloadId
      const requestUrl = record.selectedLibraryUrl ?? record.sourceUrl;
      this.#pendingRestarts.set(requestUrl, { downloadId, attempt: record.attempt, selectedLibraryUrl: record.selectedLibraryUrl });
      this.#options.partitionSession.downloadURL(requestUrl);
    }
  }

  #emitProgressThrottled(record: DownloadRecord): void {
    const now = Date.now();
    const received = record.item.getReceivedBytes();
    if (received === record.lastProgressBytes) return;
    if (now - record.lastProgressAt < (this.#options.progressIntervalMs ?? 250)) return;
    record.lastProgressAt = now;
    record.lastProgressBytes = received;
    this.#emit({
      kind: "download.progress",
      downloadId: record.downloadId,
      attempt: record.attempt,
      sourceUrl: record.sourceUrl,
      initiatedFromPageUrl: record.initiatedFromPageUrl,
      urlChain: record.urlChain,
      suggestedFileName: record.suggestedFileName,
      storedPath: record.item.getSavePath() || null,
      expectedBytes: this.#expectedBytesOf(record.item),
      receivedBytes: received > 0 ? received : 0,
      resumable: record.item.canResume(),
      failureKind: null,
    });
  }

  #emit(fields: Omit<DownloadEventV01, "schemaVersion" | "occurredAt">): void {
    const now = this.#options.now ?? (() => new Date().toISOString());
    this.#options.sink.emit({
      schemaVersion: DOWNLOAD_EVENT_SCHEMA_VERSION,
      occurredAt: now(),
      ...fields,
    });
  }

  #nextId(): string {
    this.#sequence += 1;
    return `dl-${this.#sequence}-${crypto.randomUUID()}`;
  }

  #pageUrlOf(webContents: WebContents): string | null {
    try {
      return webContents.getURL() || null;
    } catch {
      return null;
    }
  }

  #urlChainOf(item: DownloadItem): readonly string[] | null {
    try {
      const chain = item.getURLChain();
      return chain.length > 0 ? [...chain] : null;
    } catch {
      return null;
    }
  }

  #selectedLibraryUrlOf(sourceUrl: string, chain: readonly string[] | null): string | null {
    if (chain === null) return null;
    const original = chain[0];
    if (original === undefined || chain.at(-1) !== sourceUrl
      || !/^https:\/\/booth\.pm\/downloadables\/[1-9][0-9]*$/u.test(original)
      || !isAllowedRemoteOrigin(original, this.#options.allowedOrigins)) return null;
    try {
      for (const hop of chain) {
        const url = new URL(hop);
        if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") return null;
      }
    } catch { return null; }
    if (this.#pendingRestarts.get(original)?.selectedLibraryUrl === original
      || this.#options.isAwaitingLibraryRequest?.(original) === true) return original;
    return null;
  }

  #suggestedNameOf(item: DownloadItem): string | null {
    try {
      const name = item.getFilename();
      return name.length > 0 ? name : null;
    } catch {
      return null;
    }
  }

  #expectedBytesOf(item: DownloadItem): number | null {
    try {
      const total = item.getTotalBytes();
      // 未知名时为 0——报 null,不得以 0 注水(冻结纪律)
      return total > 0 ? total : null;
    } catch {
      return null;
    }
  }

  /** receivedBytes 是真实事实(0 = 尚未收到字节):progress/completed 事件
   *  要求整数字段,不做 0→null 映射 */
  #receivedBytesOf(received: number): number {
    return received > 0 ? received : 0;
  }

  /** Never reuse a consumed delivery path: old manifests still refer to it. */
  #reserveStagingPath(downloadId: string, suggestedName: string | null): string {
    const rawName = (suggestedName ?? "download.bin").replaceAll("\\", "/").split("/").at(-1) ?? "download.bin";
    const sanitized = rawName.replace(/[<>:"|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/u, "");
    let leaf = (sanitized || "download.bin").slice(-128);
    if (/^[\uDC00-\uDFFF]/u.test(leaf)) leaf = leaf.slice(1);
    const stem = `${downloadId}-${leaf}`;
    const candidatePath = path.join(this.#options.stagingRoot, stem);
    if (!fs.existsSync(candidatePath)) return candidatePath;
    let counter = 2;
    for (;;) {
      const candidatePath = path.join(this.#options.stagingRoot, `${downloadId}-${counter}-${leaf}`);
      if (!fs.existsSync(candidatePath)) return candidatePath;
      counter += 1;
    }
  }
}

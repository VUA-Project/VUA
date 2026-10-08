import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadPort, type DownloadEventSink } from "./download-port.js";
import { createSilentDownloadQueue } from "./silent-download.js";
import { isDownloadEventV01, type DownloadEventV01 } from "@vua/contracts";

/**
 * 下载端口单元测试(F4-3):假 DownloadItem 驱动事件规范化状态机——
 * 策略拒绝、started/progress/completed 形状、interrupted→canResume 派生、
 * attempt 纪律(resume 同 attempt、弃件重绑递增)、同名消歧。
 * 每个发射事件都过 isDownloadEventV01 守卫(镜像 Rust deny_unknown_fields)。
 */

class FakeDownloadItem extends EventEmitter {
  readonly url: string;
  readonly chain: string[];
  readonly filename: string;
  total: number | null;
  received = 0;
  savePath = "";
  resumable = false;
  cancelled = false;
  resumed = false;

  constructor(url: string, options: { filename?: string; total?: number | null; chain?: string[] } = {}) {
    super();
    this.url = url;
    this.chain = options.chain ?? [url];
    this.filename = options.filename ?? "closet.unitypackage";
    this.total = "total" in options ? options.total! : 1024;
  }

  getURL(): string {
    return this.url;
  }
  getURLChain(): string[] {
    return this.chain;
  }
  getWebContents(): { getURL: () => string } {
    return { getURL: () => "https://booth.pm/items/1" };
  }
  getFilename(): string {
    return this.filename;
  }
  getTotalBytes(): number {
    return this.total ?? 0;
  }
  getReceivedBytes(): number {
    return this.received;
  }
  setSavePath(savePath: string): void {
    this.savePath = savePath;
  }
  getSavePath(): string {
    return this.savePath;
  }
  canResume(): boolean {
    return this.resumable;
  }
  isPaused(): boolean {
    return false;
  }
  cancel(): void {
    this.cancelled = true;
    this.emit("done", {}, "cancelled");
  }
  resume(): void {
    this.resumed = true;
  }
  tick(bytes: number): void {
    this.received = bytes;
    this.emit("updated", {}, "progressing");
  }
  finish(state: "completed" | "cancelled" | "interrupted"): void {
    this.emit("done", {}, state);
  }
}

describe("download port (F4-3)", () => {
  let stagingRoot: string;
  let events: DownloadEventV01[];
  let downloadURLs: string[];

  function createPort(overrides: { allowedOrigins?: readonly string[]; progressIntervalMs?: number; isAwaitingLibraryRequest?: (url: string) => boolean } = {}): DownloadPort {
    const sink: DownloadEventSink = {
      emit: (event) => {
        expect(isDownloadEventV01(event)).toBe(true);
        events.push(event);
      },
    };
    return new DownloadPort({
      stagingRoot,
      partitionSession: { downloadURL: (url: string) => downloadURLs.push(url) } as never,
      allowedOrigins: overrides.allowedOrigins ?? ["https://booth.pm"],
      sink,
      now: () => "2026-09-06T00:00:00.000Z",
      ...(overrides.progressIntervalMs === undefined ? {} : { progressIntervalMs: overrides.progressIntervalMs }),
      ...(overrides.isAwaitingLibraryRequest === undefined ? {} : { isAwaitingLibraryRequest: overrides.isAwaitingLibraryRequest }),
    });
  }

  beforeEach(() => {
    stagingRoot = mkdtempSync(path.join(tmpdir(), "vua-download-port-"));
    events = [];
    downloadURLs = [];
  });

  afterEach(() => {
    rmSync(stagingRoot, { recursive: true, force: true });
  });

  it("rejects off-allowlist downloads before file creation with failed/policy", () => {
    const port = createPort();
    const preventDefault = vi.fn();
    const item = new FakeDownloadItem("https://example.test/file.zip", { filename: "file.zip" });

    port.handleWillDownload({ preventDefault }, item as never, item.getWebContents() as never);

    expect(preventDefault).toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "download.failed",
      failureKind: "policy",
      storedPath: null,
      resumable: false,
    });
    // preventDefault 即拒绝;端口从未指定保存路径
    expect(item.savePath).toBe("");
  });

  it("normalizes the happy path: started with staging path, throttled progress, completed", () => {
    const port = createPort({ progressIntervalMs: 0 });
    const item = new FakeDownloadItem("https://booth.pm/download/1");

    port.handleWillDownload({ preventDefault: vi.fn() }, item as never, item.getWebContents() as never);
    const started = events.find((event) => event.kind === "download.started")!;
    expect(started).toMatchObject({
      attempt: 1,
      sourceUrl: "https://booth.pm/download/1",
      initiatedFromPageUrl: "https://booth.pm/items/1",
      suggestedFileName: "closet.unitypackage",
      expectedBytes: 1024,
      receivedBytes: 0,
      failureKind: null,
    });
    expect(started.storedPath).toContain(stagingRoot);
    expect(started.storedPath!.endsWith("closet.unitypackage")).toBe(true);
    expect(item.savePath).toBe(started.storedPath);

    item.tick(300);
    item.tick(600);
    const progressEvents = events.filter((event) => event.kind === "download.progress");
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[1]).toMatchObject({ receivedBytes: 600, storedPath: started.storedPath });

    item.finish("completed");
    const completed = events.at(-1)!;
    expect(completed).toMatchObject({
      kind: "download.completed",
      downloadId: started.downloadId,
      receivedBytes: 600,
      failureKind: null,
    });
  });

  it("admits a selected native redirect once and retries through the original BOOTH request", () => {
    const original = "https://booth.pm/downloadables/901";
    const final = "https://files.example.test/synthetic.zip";
    const partitionSession = { downloadURL: (url: string) => downloadURLs.push(url) };
    const queue = createSilentDownloadQueue({
      partitionSession, observe: async () => undefined, abandon: () => undefined, minIntervalMs: 0,
    });
    const port = new DownloadPort({
      stagingRoot, partitionSession: partitionSession as never, allowedOrigins: ["https://booth.pm"],
      isAwaitingLibraryRequest: (url) => queue.isAwaitingNative(url),
      sink: { emit: (event) => { expect(isDownloadEventV01(event)).toBe(true); events.push(event); queue.notifyTransport(event); } },
    });
    try {
      queue.enqueue({ batchId: "library-download-native", productId: "booth:90", downloadableIds: [901] });
      const first = new FakeDownloadItem(final, { chain: [original, final] });
      const preventDefault = vi.fn();
      port.handleWillDownload({ preventDefault }, first as never, first.getWebContents() as never);
      expect(preventDefault).not.toHaveBeenCalled();
      const started = events[0]!;
      expect(started).toMatchObject({ kind: "download.started", sourceUrl: final, urlChain: [original, final] });
      expect(queue.isAwaitingNative(original)).toBe(false);

      const unrelated = new FakeDownloadItem(final, { chain: [original, final] });
      port.handleWillDownload({ preventDefault }, unrelated as never, unrelated.getWebContents() as never);
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(unrelated.savePath).toBe("");

      port.applyIntent(started.downloadId, "retry");
      expect(downloadURLs).toEqual([original, original]);
      const retriedFinal = "https://files.example.test/new-signed-delivery.zip";
      const retried = new FakeDownloadItem(retriedFinal, { chain: [original, retriedFinal] });
      port.handleWillDownload({ preventDefault: vi.fn() }, retried as never, retried.getWebContents() as never);
      expect(events.at(-1)).toMatchObject({ kind: "download.started", downloadId: started.downloadId, attempt: 2, sourceUrl: retriedFinal });
    } finally { queue.dispose(); }
  });

  it.each([
    ["unselected", ["https://booth.pm/downloadables/902", "https://files.example.test/file"], false],
    ["original appears only in the middle", ["https://other.example.test/start", "https://booth.pm/downloadables/901", "https://files.example.test/file"], true],
    ["wrong chain end", ["https://booth.pm/downloadables/901", "https://files.example.test/other"], true],
    ["insecure hop", ["https://booth.pm/downloadables/901", "http://files.example.test/intermediate", "https://files.example.test/file"], true],
    ["user information", ["https://booth.pm/downloadables/901", "https://user:password@files.example.test/file", "https://files.example.test/file"], true],
    ["fragment", ["https://booth.pm/downloadables/901", "https://files.example.test/file#fragment", "https://files.example.test/file"], true],
    ["altered original", ["https://booth.pm/downloadables/901?extra=1", "https://files.example.test/file"], true],
  ] as const)("refuses a library redirect with %s", (_label, chain, admitted) => {
    const port = createPort({ isAwaitingLibraryRequest: () => admitted });
    const item = new FakeDownloadItem("https://files.example.test/file", { chain: [...chain] });
    const preventDefault = vi.fn();
    port.handleWillDownload({ preventDefault }, item as never, item.getWebContents() as never);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(item.savePath).toBe("");
    expect(events[0]).toMatchObject({ kind: "download.failed", failureKind: "policy", storedPath: null });
  });

  it("reports unknown size as null, never inflated to 0", () => {
    const port = createPort();
    const item = new FakeDownloadItem("https://booth.pm/download/2", { total: null });

    port.handleWillDownload({ preventDefault: vi.fn() }, item as never, item.getWebContents() as never);
    expect(events.find((event) => event.kind === "download.started")!.expectedBytes).toBeNull();
  });

  it("derives interrupted from canResume and resumes within the same attempt", () => {
    const port = createPort();
    const item = new FakeDownloadItem("https://booth.pm/download/3");
    item.tick(400);
    port.handleWillDownload({ preventDefault: vi.fn() }, item as never, item.getWebContents() as never);
    const downloadId = events.find((event) => event.kind === "download.started")!.downloadId;

    item.resumable = true;
    item.finish("interrupted");
    const interrupted = events.at(-1)!;
    expect(interrupted).toMatchObject({
      kind: "download.interrupted",
      downloadId,
      attempt: 1,
      resumable: true,
      failureKind: null,
    });

    port.applyIntent(downloadId, "resume");
    expect(item.resumed).toBe(true);
  });

  it("reports non-resumable interruptions as terminal failed/unknown", () => {
    const port = createPort();
    const item = new FakeDownloadItem("https://booth.pm/download/4");
    port.handleWillDownload({ preventDefault: vi.fn() }, item as never, item.getWebContents() as never);
    const downloadId = events.find((event) => event.kind === "download.started")!.downloadId;

    item.resumable = false;
    item.finish("interrupted");
    expect(events.at(-1)).toMatchObject({
      kind: "download.failed",
      downloadId,
      failureKind: "unknown",
      resumable: false,
    });
    // 不可续传时 retry 意图无事发生(端口无权改写 AMF 的重试策略)
    port.applyIntent(downloadId, "retry");
    expect(item.resumed).toBe(false);
  });

  it("abandons the partial file and rebinds the next same-url item with attempt+1", () => {
    const port = createPort();
    const item = new FakeDownloadItem("https://booth.pm/download/5");
    port.handleWillDownload({ preventDefault: vi.fn() }, item as never, item.getWebContents() as never);
    const started = events.find((event) => event.kind === "download.started")!;
    writeFileSync(started.storedPath!, "partial bytes");

    // retry 全新 attempt:弃件 + 经 downloadURL 重发起(session 桩捕获)
    port.applyIntent(started.downloadId, "retry");
    expect(item.cancelled).toBe(true);
    expect(existsSync(started.storedPath!)).toBe(false);
    expect(downloadURLs).toEqual(["https://booth.pm/download/5"]);

    // 同 URL 重发起:新 item 重绑原 downloadId,attempt 递增
    const second = new FakeDownloadItem("https://booth.pm/download/5");
    port.handleWillDownload({ preventDefault: vi.fn() }, second as never, second.getWebContents() as never);
    const restarted = events.filter((event) => event.kind === "download.started").at(-1)!;
    expect(restarted.downloadId).toBe(started.downloadId);
    expect(restarted.attempt).toBe(2);
  });

  it("disambiguates same-name staging files per download", () => {
    const port = createPort();
    const first = new FakeDownloadItem("https://booth.pm/download/6");
    port.handleWillDownload({ preventDefault: vi.fn() }, first as never, first.getWebContents() as never);
    const firstPath = events.find((event) => event.kind === "download.started")!.storedPath!;
    // Electron 在落盘时立即创建部分文件——模拟之,第二个同名下载才需要消歧
    writeFileSync(firstPath!, "partial bytes");

    const second = new FakeDownloadItem("https://booth.pm/download/7");
    port.handleWillDownload({ preventDefault: vi.fn() }, second as never, second.getWebContents() as never);
    const secondPath = events.filter((event) => event.kind === "download.started").at(-1)!.storedPath!;

    expect(firstPath).not.toBe(secondPath);
    expect(firstPath.endsWith("closet.unitypackage")).toBe(true);
    expect(secondPath.endsWith("closet.unitypackage")).toBe(true);
    expect(secondPath).not.toBe(firstPath);
  });

  it("does not reuse a completed delivery path after library consumption", () => {
    const port = createPort();
    const first = new FakeDownloadItem("https://booth.pm/download/6");
    port.handleWillDownload({ preventDefault: vi.fn() }, first as never, first.getWebContents() as never);
    const oldPath = first.savePath;
    writeFileSync(oldPath, "consumed delivery");
    rmSync(oldPath);
    const next = new FakeDownloadItem("https://booth.pm/download/7");
    port.handleWillDownload({ preventDefault: vi.fn() }, next as never, next.getWebContents() as never);
    expect(next.savePath).not.toBe(oldPath);
    expect(existsSync(oldPath)).toBe(false);
  });

  it("throttles progress events by interval", () => {
    vi.useFakeTimers();
    try {
      const port = createPort();
      const item = new FakeDownloadItem("https://booth.pm/download/8");
      port.handleWillDownload({ preventDefault: vi.fn() }, item as never, item.getWebContents() as never);
      item.tick(100);
      item.tick(200);
      expect(events.filter((event) => event.kind === "download.progress")).toHaveLength(1);
      vi.advanceTimersByTime(300);
      item.tick(300);
      expect(events.filter((event) => event.kind === "download.progress")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDownloadEventSink, type DownloadIngestInvoke } from "./download-ingest.js";
import type { DownloadEventV01 } from "@vua/contracts";

function event(downloadId: string): DownloadEventV01 {
  return {
    schemaVersion: "0.1", kind: "download.completed", downloadId, attempt: 1,
    occurredAt: "2026-10-07T00:00:00.000Z", sourceUrl: "https://booth.pm/downloadables/901",
    initiatedFromPageUrl: null, urlChain: null, suggestedFileName: "synthetic.zip",
    storedPath: "C:/synthetic/staging.zip", expectedBytes: 10, receivedBytes: 10,
    resumable: false, failureKind: null,
  };
}

const accept: DownloadIngestInvoke = async ({ events }) => ({
  ok: true, value: { contractVersion: "0.1", folded: events.length, duplicates: 0, rejected: [] },
});

describe("download event persistence receipts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("acknowledges an interval batch only after the provider reply", async () => {
    let reply!: (value: Awaited<ReturnType<DownloadIngestInvoke>>) => void;
    const invoke = vi.fn<DownloadIngestInvoke>(() => new Promise((resolve) => { reply = resolve; }));
    const persisted = vi.fn();
    const sink = createDownloadEventSink({ invoke, onPersisted: persisted });
    expect(sink.pending()).toBe(false);
    sink.emit(event("dl-1")); sink.emit(event("dl-2"));
    expect(sink.pending()).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invoke.mock.calls[0]![0]).toEqual({ schemaVersion: "0.1", events: [event("dl-1"), event("dl-2")] });
    expect(persisted).not.toHaveBeenCalled();
    expect(sink.pending()).toBe(true);
    reply({ ok: true, value: { folded: 2, duplicates: 0, rejected: [] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(persisted.mock.calls.map((call) => call[0].downloadId)).toEqual(["dl-1", "dl-2"]);
    expect(sink.pending()).toBe(false);
    sink.dispose();
  });

  it("flushes on the threshold and drives events arriving during that invoke", async () => {
    let reply!: (value: Awaited<ReturnType<DownloadIngestInvoke>>) => void;
    const invoke = vi.fn<DownloadIngestInvoke>(accept)
      .mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    const sink = createDownloadEventSink({ invoke, flushThreshold: 1 });
    sink.emit(event("dl-first")); sink.emit(event("dl-second"));
    expect(invoke).toHaveBeenCalledTimes(1);
    reply({ ok: true, value: { folded: 1, duplicates: 0, rejected: [] } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]![0].events[0]!.downloadId).toBe("dl-second");
    sink.dispose();
  });

  it("retries delivery without later events and resets exponential backoff", async () => {
    const invoke = vi.fn<DownloadIngestInvoke>(accept)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const persisted = vi.fn();
    const sink = createDownloadEventSink({ invoke, onPersisted: persisted, log: () => undefined });
    sink.emit(event("dl-retry"));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(persisted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persisted).toHaveBeenCalledTimes(1);
    invoke.mockRejectedValueOnce(new Error("provider unavailable"));
    sink.emit(event("dl-again"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(invoke).toHaveBeenCalledTimes(6);
    sink.dispose();
  });

  it("caps retry delay", async () => {
    const invoke = vi.fn<DownloadIngestInvoke>().mockRejectedValue(new Error("provider unavailable"));
    const sink = createDownloadEventSink({ invoke, flushThreshold: 1, maxBackoffMs: 3_000, log: () => undefined });
    sink.emit(event("dl-cap"));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(invoke).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(invoke).toHaveBeenCalledTimes(5);
    sink.dispose();
  });

  it.each([undefined, {}, { rejected: [] }, { folded: 0, duplicates: 0, rejected: [] },
    { folded: 1, duplicates: 0, rejected: [{ index: 2, code: "invalid", reason: "invalid" }] },
    { folded: 0, duplicates: 0, rejected: [{ index: 0, code: "invalid", reason: "invalid" }, { index: 0, code: "invalid", reason: "invalid" }] },
  ])("does not claim persistence from malformed receipt %j", async (value) => {
    const invoke = vi.fn<DownloadIngestInvoke>(accept).mockResolvedValueOnce({ ok: true, value });
    const persisted = vi.fn();
    const sink = createDownloadEventSink({ invoke, onPersisted: persisted, log: () => undefined });
    sink.emit(event("dl-malformed"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted).toHaveBeenCalledOnce();
    sink.dispose();
  });

  it("settles acknowledged indexes, rejects invalid ones and retries store failures", async () => {
    const invoke = vi.fn<DownloadIngestInvoke>(accept).mockResolvedValueOnce({ ok: true, value: {
      folded: 2, duplicates: 0, rejected: [
        { index: 1, code: "vua.download.invalid_event", reason: "shape" },
        { index: 2, code: "vua.download.store_failed", reason: "private diagnostics" },
      ],
    } });
    const persisted = vi.fn(); const rejected = vi.fn(); const logs: string[] = [];
    const sink = createDownloadEventSink({ invoke, onPersisted: persisted, onRejected: rejected, log: (line) => logs.push(line) });
    sink.emit(event("dl-good")); sink.emit(event("dl-bad")); sink.emit(event("dl-store"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted.mock.calls.map((call) => call[0].downloadId)).toEqual(["dl-good"]);
    expect(rejected.mock.calls[0]).toEqual([event("dl-bad"), "vua.download.invalid_event"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(invoke.mock.calls[1]![0].events).toEqual([event("dl-store")]);
    expect(persisted.mock.calls.map((call) => call[0].downloadId)).toEqual(["dl-good", "dl-store"]);
    expect(logs.join()).not.toContain("private diagnostics");
    sink.dispose();
  });

  it("acknowledges an idempotent duplicate receipt", async () => {
    const invoke = vi.fn<DownloadIngestInvoke>().mockResolvedValue({ ok: true, value: { folded: 0, duplicates: 1, rejected: [] } });
    const persisted = vi.fn();
    const sink = createDownloadEventSink({ invoke, onPersisted: persisted });
    sink.emit(event("dl-duplicate"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persisted).toHaveBeenCalledOnce(); sink.dispose();
  });

  it("reports evicted facts and disposes buffered work", async () => {
    const invoke = vi.fn<DownloadIngestInvoke>(accept); const dropped = vi.fn();
    const sink = createDownloadEventSink({ invoke, bufferCap: 2, onDropped: dropped });
    sink.emit(event("dl-evicted")); sink.emit(event("dl-2")); sink.emit(event("dl-3"));
    expect(dropped).toHaveBeenCalledWith(event("dl-evicted"));
    sink.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(invoke).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEventV01, LibraryDownloadObservationV01 } from "@vua/contracts";
import { createSilentDownloadQueue } from "./silent-download.js";

const batch = (ids: readonly number[] = [901, 902], batchId = "library-download-synthetic") => ({ batchId, productId: "booth:90", downloadableIds: ids });
function event(kind: "download.started" | "download.completed" | "download.failed" | "download.cancelled", id = 901, redirected = false): DownloadEventV01 {
  return { schemaVersion: "0.1", kind, downloadId: `dl-synthetic-${id}`, attempt: 1,
    sourceUrl: redirected ? "https://synthetic.booth.pm/files/delivery" : `https://booth.pm/downloadables/${id}`,
    urlChain: redirected ? [`https://booth.pm/downloadables/${id}`, "https://synthetic.booth.pm/files/delivery"] : null,
    initiatedFromPageUrl: null, suggestedFileName: "synthetic.zip", occurredAt: "2026-10-08T00:00:00Z",
    expectedBytes: 10, receivedBytes: kind === "download.completed" ? 10 : null,
    storedPath: kind === "download.completed" ? "C:/synthetic/staging.zip" : null,
    resumable: false, failureKind: kind === "download.failed" ? "unknown" : null,
  };
}
function setup(extra: Partial<Parameters<typeof createSilentDownloadQueue>[0]> = {}) {
  const downloadURL = vi.fn(); const observe = vi.fn< (value: LibraryDownloadObservationV01) => Promise<void> >().mockResolvedValue();
  const abandon = vi.fn();
  const queue = createSilentDownloadQueue({ partitionSession: { downloadURL }, observe, abandon, minIntervalMs: 0, log: () => undefined, ...extra });
  return { queue, downloadURL, observe, abandon };
}
describe("silent library transport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps all selected files registered when the first completes during pacing", async () => {
    let release!: () => void;
    const { queue, downloadURL, observe } = setup({ minIntervalMs: 6_000, sleep: () => new Promise((resolve) => { release = resolve; }) });
    expect(queue.enqueue(batch())).toBe(2);
    queue.notifyTransport(event("download.completed")); queue.notifyPersisted(event("download.completed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(downloadURL).toHaveBeenCalledTimes(1); expect(queue.pending()).toBe(0);
    expect(observe.mock.calls.map((call) => call[0].downloadableId)).toEqual([901]);
    // The paced second entry has left the pending queue but belongs to the batch.
    queue.cancel(batch().batchId); release(); await vi.advanceTimersByTimeAsync(0);
    expect(downloadURL).toHaveBeenCalledTimes(1);
    expect(observe.mock.calls.map((call) => [call[0].downloadableId, call[0].outcome])).toEqual([[901, "settled"], [902, "cancelled"]]);
    queue.dispose();
  });

  it("native completion alone cannot report settlement", async () => {
    const { queue, observe } = setup(); queue.enqueue(batch([901]));
    queue.notifyTransport(event("download.started")); queue.notifyTransport(event("download.completed"));
    await vi.advanceTimersByTimeAsync(35_000);
    expect(observe).not.toHaveBeenCalled();
    queue.notifyPersisted(event("download.completed")); await vi.advanceTimersByTimeAsync(0);
    expect(observe.mock.calls[0]![0]).toMatchObject({ outcome: "settled", downloadId: "dl-synthetic-901" }); queue.dispose();
  });

  it("correlates redirected terminal delivery through the exact original URL", async () => {
    const { queue, observe } = setup(); queue.enqueue(batch([901]));
    queue.notifyTransport(event("download.completed", 901, true));
    queue.notifyPersisted(event("download.completed", 901, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(observe.mock.calls[0]![0]).toEqual({ schemaVersion: "0.1", batchId: batch().batchId, downloadableId: 901, outcome: "settled", downloadId: "dl-synthetic-901" }); queue.dispose();
  });

  it("records each native kickoff exception and continues the remaining files", async () => {
    const downloadURL = vi.fn().mockImplementationOnce(() => { throw new Error("destroyed session"); });
    const { queue, observe } = setup({ partitionSession: { downloadURL } }); queue.enqueue(batch());
    queue.notifyTransport(event("download.completed", 902)); queue.notifyPersisted(event("download.completed", 902));
    await vi.advanceTimersByTimeAsync(0);
    expect(downloadURL).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls.map((call) => [call[0].downloadableId, call[0].outcome])).toEqual([[901, "initiation_failed"], [902, "settled"]]); queue.dispose();
  });

  it("times out a request which never produces a native download", async () => {
    const { queue, observe } = setup({ initiationTimeoutMs: 100 }); queue.enqueue(batch([901]));
    await vi.advanceTimersByTimeAsync(100);
    expect(observe.mock.calls[0]![0].outcome).toBe("initiation_failed"); queue.dispose();
  });

  it("limits native redirect admission to a currently waiting, uncancelled selection", async () => {
    const original = "https://booth.pm/downloadables/901";
    const { queue } = setup({ initiationTimeoutMs: 100 });
    expect(queue.isAwaitingNative(original)).toBe(false);
    queue.enqueue(batch([901]));
    expect(queue.isAwaitingNative(original)).toBe(true);
    expect(queue.isAwaitingNative("https://booth.pm/downloadables/902")).toBe(false);
    queue.cancel(batch().batchId);
    expect(queue.isAwaitingNative(original)).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(queue.isAwaitingNative(original)).toBe(false);
    queue.enqueue(batch([901], "library-download-again"));
    expect(queue.isAwaitingNative(original)).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(queue.isAwaitingNative(original)).toBe(false);
    queue.enqueue(batch([901], "library-download-final"));
    queue.dispose();
    expect(queue.isAwaitingNative(original)).toBe(false);
  });

  it("preserves report identity through provider unavailability", async () => {
    const observe = vi.fn<(value: LibraryDownloadObservationV01) => Promise<void>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue();
    const { queue, downloadURL } = setup({ observe }); queue.enqueue(batch([901]));
    queue.notifyTransport(event("download.completed")); queue.notifyPersisted(event("download.completed"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(observe).toHaveBeenCalledTimes(2); expect(observe.mock.calls[0]).toEqual(observe.mock.calls[1]);
    expect(downloadURL).toHaveBeenCalledOnce(); queue.dispose();
  });

  it("rejects duplicate file selections and never replaces an in-flight URL binding", async () => {
    const { queue, downloadURL, observe } = setup();
    expect(queue.enqueue(batch([901, 901]))).toBe(0);
    queue.enqueue(batch([901])); queue.enqueue(batch([901], "library-download-other"));
    queue.notifyTransport(event("download.completed")); queue.notifyPersisted(event("download.completed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(downloadURL).toHaveBeenCalledOnce();
    expect(observe.mock.calls.map((call) => [call[0].batchId, call[0].outcome])).toEqual([["library-download-other", "initiation_failed"], [batch().batchId, "settled"]]); queue.dispose();
  });

  it("cancels bound downloads and waits for their persisted terminal event", async () => {
    const { queue, observe, abandon } = setup(); queue.enqueue(batch([901])); queue.notifyTransport(event("download.started"));
    queue.cancel(batch().batchId); expect(abandon).toHaveBeenCalledWith("dl-synthetic-901"); expect(observe).not.toHaveBeenCalled();
    queue.notifyTransport(event("download.cancelled")); queue.notifyPersisted(event("download.cancelled"));
    await vi.advanceTimersByTimeAsync(0); expect(observe.mock.calls[0]![0].outcome).toBe("settled"); queue.dispose();
  });

  it("handles cancellation requested before native binding", async () => {
    const { queue, abandon } = setup(); queue.enqueue(batch([901])); queue.cancel(batch().batchId);
    queue.notifyTransport(event("download.started")); expect(abandon).toHaveBeenCalledWith("dl-synthetic-901"); queue.dispose();
  });

  it("reports unconfirmed evidence without pretending the file was stored", async () => {
    const { queue, observe } = setup(); queue.enqueue(batch([901]));
    queue.notifyTransport(event("download.completed")); queue.notifyUnconfirmed(event("download.completed"));
    queue.notifyPersisted(event("download.completed")); await vi.advanceTimersByTimeAsync(0);
    expect(observe).toHaveBeenCalledOnce(); expect(observe.mock.calls[0]![0].outcome).toBe("unconfirmed"); queue.dispose();
  });
});

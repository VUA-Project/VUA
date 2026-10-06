import { describe, expect, it, vi } from "vitest";
import { createSilentDownloadQueue } from "./silent-download.js";
import type { Session } from "electron";

/** downloadURL 桩:记录发起与可注入的抛错 */
function fakeSession(failUrls: ReadonlySet<string> = new Set()) {
  const initiated: string[] = [];
  const session = {
    downloadURL(url: string) {
      if (failUrls.has(url)) throw new Error("session gone");
      initiated.push(url);
    },
  } as unknown as Session;
  return { session, initiated };
}

const noWait = { sleep: async () => {}, now: () => 0 };

describe("createSilentDownloadQueue", () => {
  it("initiates each file once, serially, through downloadURL", async () => {
    const { session, initiated } = fakeSession();
    const queue = createSilentDownloadQueue({ partitionSession: session, ...noWait });
    const accepted = queue.enqueue("booth:6190761", [5330963, 5330987, 5330988]);
    expect(accepted).toBe(3);
    await vi.waitFor(() => expect(initiated).toHaveLength(3));
    expect(initiated).toEqual([
      "https://booth.pm/downloadables/5330963",
      "https://booth.pm/downloadables/5330987",
      "https://booth.pm/downloadables/5330988",
    ]);
    expect(queue.pending()).toBe(0);
  });

  it("paces initiations by the BOOTH-crawler interval after the first", async () => {
    const { session, initiated } = fakeSession();
    const sleeps: number[] = [];
    let clock = 1_000;
    const queue = createSilentDownloadQueue({
      partitionSession: session,
      minIntervalMs: 6_000,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    queue.enqueue("booth:1", [11, 22]);
    await vi.waitFor(() => expect(initiated).toHaveLength(2));
    // 首发不等;第二发等待剩余间隔(clock 已推进 minIntervalMs 以内)
    expect(sleeps.length).toBeLessThanOrEqual(1);
    expect(sleeps[0] ?? 0).toBeGreaterThan(0);
    expect(sleeps[0] ?? 0).toBeLessThanOrEqual(6_000);
  });

  it("drops invalid ids honestly and survives a downloadURL throw", async () => {
    const { session, initiated } = fakeSession(new Set(["https://booth.pm/downloadables/7"]));
    const logs: string[] = [];
    const queue = createSilentDownloadQueue({
      partitionSession: session,
      log: (line) => logs.push(line),
      ...noWait,
    });
    const accepted = queue.enqueue("booth:2", [7, 0, -3, 8.5]);
    expect(accepted).toBe(1);
    await vi.waitFor(() => expect(initiated).toHaveLength(0));
    expect(logs.some((line) => line.includes("\"error\""))).toBe(true);
    expect(queue.pending()).toBe(0);
  });
});

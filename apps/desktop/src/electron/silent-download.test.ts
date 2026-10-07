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

describe("product settle tracking (auto-adoption hook)", () => {
  it("fires onProductSettled with the completed download ids once all files settle", async () => {
    const { session, initiated } = fakeSession();
    const settled: Array<{ productId: string; ids: string[] }> = [];
    const queue = createSilentDownloadQueue({
      partitionSession: session,
      onProductSettled: (productId, ids) => settled.push({ productId, ids: [...ids] }),
      ...noWait,
    });
    queue.enqueue("booth:6190761", [11, 22]);
    // 等两个文件都经 downloadURL 发起(inFlight 登记完成)再喂终态
    await vi.waitFor(() => expect(initiated).toHaveLength(2));
    // 两个文件先后落定:11 成功,22 失败 → 只在最后一个落定时回调一次,携带成功批
    queue.notifySettled(["https://booth.pm/downloadables/11"], "dl-1", "completed");
    queue.notifySettled(["https://booth.pm/downloadables/22"], "dl-2", "failed");
    expect(settled).toEqual([{ productId: "booth:6190761", ids: ["dl-1"] }]);
  });

  it("ignores settle events for urls it never initiated", () => {
    const { session } = fakeSession();
    const settled: string[] = [];
    const queue = createSilentDownloadQueue({
      partitionSession: session,
      onProductSettled: (productId) => settled.push(productId),
      ...noWait,
    });
    queue.notifySettled(["https://booth.pm/downloadables/999"], "dl-x", "completed");
    expect(settled).toHaveLength(0);
  });

  it("matches the ORIGINAL downloadables url through the redirect chain (2026-10-07)", async () => {
    const { session, initiated } = fakeSession();
    const settled: Array<{ productId: string; ids: string[] }> = [];
    const queue = createSilentDownloadQueue({
      partitionSession: session,
      onProductSettled: (productId, ids) => settled.push({ productId, ids: [...ids] }),
      ...noWait,
    });
    queue.enqueue("booth:4353376", [2934996]);
    await vi.waitFor(() => expect(initiated).toHaveLength(1));
    // 事件面只带重定向后的签名地址 + urlChain;命中链首直链才落定
    queue.notifySettled(
      [
        "https://s6.booth.pm/3f709dc5/f/4353376/2934996/Charm_Crocs_ver1.00.zip?X-Amz-Expires=180",
        "https://booth.pm/downloadables/2934996",
      ],
      "dl-9",
      "completed",
    );
    expect(settled).toEqual([{ productId: "booth:4353376", ids: ["dl-9"] }]);
  });
});

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseResourceSample, selectResourceGpu, SystemUsageCollector, RESOURCE_STALE_AFTER_MS, RESOURCE_RESPAWN_DELAY_MS, type GpuSample } from "./system-usage.js";

const gpu = (id: string, usagePercent: number | null, kind: GpuSample["kind"] = "discrete", used = 4, total = 8): GpuSample =>
  ({ id, name: id, kind, usagePercent, dedicatedUsedBytes: used, dedicatedTotalBytes: total });
afterEach(() => vi.useRealTimers());
describe("physical GPU selection", () => {
  it("excludes busy integrated graphics when a discrete adapter is available", () => {
    expect(selectResourceGpu([gpu("iGPU", 99, "integrated"), gpu("dGPU", 40)])?.id).toBe("dGPU");
  });
  it("chooses the busy discrete adapter without borrowing an idle card's capacity", () => {
    expect(selectResourceGpu([gpu("idle-24GB", 0, "discrete", 1, 24), gpu("busy-8GB", 80, "discrete", 6, 8)])).toEqual(gpu("busy-8GB", 80, "discrete", 6, 8));
  });
  it("uses memory pressure for equal utilization and keeps missing readings distinct", () => {
    expect(selectResourceGpu([gpu("a", 20, "discrete", 1, 24), gpu("b", 20, "discrete", 6, 8)])?.id).toBe("b");
    expect(selectResourceGpu([gpu("unknown", null), gpu("measured-idle", 0)])?.id).toBe("measured-idle");
  });
  it("permits an integrated-only system and handles absent graphics", () => {
    expect(selectResourceGpu([gpu("iGPU", 20, "integrated")])?.kind).toBe("integrated");
    expect(selectResourceGpu([])).toBeNull();
  });
});
describe("native frames", () => {
  it("rejects malformed, duplicate or out-of-range readings", () => {
    for (const value of [null, {}, { cpuUsagePercent: 101, gpus: [] },
      { cpuUsagePercent: 10, gpus: [gpu("duplicate", 1), gpu("duplicate", 2)] },
      { cpuUsagePercent: 10, gpus: [gpu("bad", -1)] }]) expect(parseResourceSample(JSON.stringify(value))).toBeNull();
    expect(parseResourceSample("broken")).toBeNull();
    expect(parseResourceSample('{"cpuUsagePercent":null,"gpus":[]}')).toEqual({ cpuUsagePercent: null, gpus: [] });
  });
});
function nativeChild() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  return child;
}
describe("collector freshness and lifecycle", () => {
  it("combines split frames, expires readings, invalidates failures and retains the V1 shape", () => {
    let now = 1_000;
    const child = nativeChild();
    const spawnImpl = vi.fn(() => child);
    const collector = new SystemUsageCollector({ platform: "win32", spawnImpl: spawnImpl as unknown as typeof spawn, now: () => now });
    collector.start("bundled-provider.exe");
    collector.start("bundled-provider.exe");
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl).toHaveBeenCalledWith("bundled-provider.exe", ["--observe-system-resources"], { windowsHide: true });
    expect(collector.snapshotV2().gpuUsagePercent).toBeNull();
    const frame = JSON.stringify({ cpuUsagePercent: 25, gpus: [gpu("iGPU", 90, "integrated"), gpu("game", 80, "discrete", 6, 8)] }) + "\n";
    child.stdout.write(frame.slice(0, 20));
    expect(collector.snapshotV2().cpuUsagePercent).toBeNull();
    child.stdout.write(frame.slice(20));
    expect(collector.snapshotV2()).toMatchObject({ cpuUsagePercent: 25, gpuUsagePercent: 80, gpuName: "game", vramUsedBytes: 6, vramTotalBytes: 8 });
    expect(Object.keys(collector.snapshot()).sort()).toEqual(["ramTotalBytes", "ramUsedBytes", "sampledAt", "schemaVersion", "vramTotalBytes", "vramUsedBytes"].sort());
    now += RESOURCE_STALE_AFTER_MS + 1;
    expect(collector.snapshotV2()).toMatchObject({ cpuUsagePercent: null, gpuUsagePercent: null, vramUsedBytes: null });
    child.stdout.write(frame);
    child.stdout.write("broken\n");
    expect(collector.snapshotV2().gpuUsagePercent).toBeNull();
    collector.stop();
    child.stdout.write(frame);
    expect(collector.snapshotV2().gpuName).toBeNull();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
  it("restarts a failed sampler once and stops its delayed retry", () => {
    vi.useFakeTimers();
    const spawnImpl = vi.fn(() => nativeChild());
    const collector = new SystemUsageCollector({ platform: "win32", spawnImpl: spawnImpl as unknown as typeof spawn });
    collector.start("bundled-provider.exe");
    const first = spawnImpl.mock.results[0]!.value;
    first.emit("error", new Error("unavailable"));
    first.emit("close");
    vi.advanceTimersByTime(RESOURCE_RESPAWN_DELAY_MS);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    spawnImpl.mock.results[1]!.value.emit("close");
    collector.stop();
    vi.advanceTimersByTime(RESOURCE_RESPAWN_DELAY_MS);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
  });
  it("never treats shared UMA memory as separate VRAM", () => {
    const child = nativeChild();
    const collector = new SystemUsageCollector({ platform: "win32", spawnImpl: (() => child) as unknown as typeof spawn });
    collector.start("provider.exe");
    child.stdout.write(JSON.stringify({ cpuUsagePercent: 10, gpus: [gpu("iGPU", 30, "integrated")] }) + "\n");
    expect(collector.snapshotV2()).toMatchObject({ gpuUsagePercent: 30, gpuKind: "integrated", vramUsedBytes: null, vramTotalBytes: null });
    collector.stop();
  });
  it("keeps unsupported sensors unavailable off Windows", () => {
    const spawnImpl = vi.fn();
    const collector = new SystemUsageCollector({ platform: "linux", spawnImpl: spawnImpl as unknown as typeof spawn });
    collector.start("unused");
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(collector.snapshotV2()).toMatchObject({ schemaVersion: 2, cpuUsagePercent: null, gpuUsagePercent: null });
    expect(collector.snapshot().schemaVersion).toBe(1);
    expect(collector.snapshotV2().ramTotalBytes).toBeGreaterThan(0);
    collector.stop();
  });
});

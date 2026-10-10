import { describe, expect, it } from "vitest";
import type { SystemResourceUsageV2 } from "@vua/contracts";
import { formatGigabytes, percentOf, usagePercents } from "./resource-monitor-model.ts";
const snapshot = (patch: Partial<SystemResourceUsageV2> = {}): SystemResourceUsageV2 => ({
  schemaVersion: 2, ramUsedBytes: 30, ramTotalBytes: 100, vramUsedBytes: 60, vramTotalBytes: 100,
  cpuUsagePercent: 10, gpuUsagePercent: 20, gpuName: "Synthetic GPU", gpuKind: "discrete", sampledAt: "2026-10-10T00:00:00Z", ...patch });
describe("resource headroom", () => {
  it("uses the four available readings, not the old dominant RAM/VRAM percent", () => {
    expect(usagePercents(snapshot())).toMatchObject({ measuredCount: 4, headroomPct: 70, constrained: null });
  });
  it("keeps saturation visible even if the mean indicates considerable headroom", () => {
    expect(usagePercents(snapshot({ cpuUsagePercent: 100, gpuUsagePercent: 0, ramUsedBytes: 0, vramUsedBytes: 0 })))
      .toMatchObject({ headroomPct: 75, constrained: "cpu", constrainedPct: 100 });
    expect(usagePercents(snapshot({ vramUsedBytes: 98 }))).toMatchObject({ constrained: "vram", constrainedPct: 98 });
  });
  it("excludes missing or zero-capacity readings rather than inflating the mean", () => {
    expect(usagePercents(snapshot({ cpuUsagePercent: null, gpuUsagePercent: null, vramTotalBytes: null })))
      .toMatchObject({ measuredCount: 1, headroomPct: 70, vramPct: null });
    expect(usagePercents(snapshot({ vramTotalBytes: 0 }))).toMatchObject({ measuredCount: 3, headroomPct: 80 });
  });
  it("does not guess unknown sensor readings and clamps valid percentages", () => {
    expect(usagePercents(snapshot({ cpuUsagePercent: NaN, gpuUsagePercent: 200 }))).toMatchObject({ cpuPct: null, gpuPct: 100, measuredCount: 3 });
    expect(percentOf(1, 0)).toBe(0);
    expect(percentOf(Infinity, 100)).toBe(0);
    expect(percentOf(200, 100)).toBe(100);
  });
  it("formats observed capacities in GiB", () => {
    expect(formatGigabytes(12.34 * 1024 ** 3)).toBe("12.3");
  });
});

import { describe, expect, it } from "vitest";
import type { SystemResourceUsageV2 } from "@vua/contracts";
import { amfCapacityGuidance, formatGigabytes, loadStateOf, percentOf, sparklinePoints, usagePercents } from "./resource-monitor-model.ts";
const snapshot = (patch: Partial<SystemResourceUsageV2> = {}): SystemResourceUsageV2 => ({
  schemaVersion: 2, ramUsedBytes: 30, ramTotalBytes: 100, vramUsedBytes: 60, vramTotalBytes: 100,
  cpuUsagePercent: 10, gpuUsagePercent: 20, gpuName: "Synthetic GPU", gpuKind: "discrete", sampledAt: "2026-10-10T00:00:00Z", ...patch });
describe("tightest resource (F6)", () => {
  it("names the highest reading across the four available dimensions", () => {
    expect(usagePercents(snapshot())).toMatchObject({ measuredCount: 4, tightest: "vram", tightestPct: 60, loadState: "plenty" });
  });
  it("keeps saturation visible even if the other readings are low", () => {
    expect(usagePercents(snapshot({ cpuUsagePercent: 100, gpuUsagePercent: 0, ramUsedBytes: 0, vramUsedBytes: 0 })))
      .toMatchObject({ tightest: "cpu", tightestPct: 100, loadState: "tight" });
    expect(usagePercents(snapshot({ vramUsedBytes: 98 }))).toMatchObject({ tightest: "vram", tightestPct: 98, loadState: "tight" });
  });
  it("reads 70% as getting tight and keeps the boundary stable", () => {
    expect(loadStateOf(69)).toBe("plenty");
    expect(loadStateOf(70)).toBe("gettingTight");
    expect(usagePercents(snapshot({ cpuUsagePercent: 80, gpuUsagePercent: 0, ramUsedBytes: 0, vramUsedBytes: 0 })))
      .toMatchObject({ tightest: "cpu", tightestPct: 80, loadState: "gettingTight" });
    expect(loadStateOf(89)).toBe("gettingTight");
    expect(loadStateOf(90)).toBe("tight");
    expect(loadStateOf(null)).toBe("plenty");
  });
  it("excludes missing or zero-capacity readings rather than distorting the tightest", () => {
    expect(usagePercents(snapshot({ cpuUsagePercent: null, gpuUsagePercent: null, vramTotalBytes: null })))
      .toMatchObject({ measuredCount: 1, tightest: "ram", tightestPct: 30, vramPct: null });
    expect(usagePercents(snapshot({ vramTotalBytes: 0 }))).toMatchObject({ measuredCount: 3, tightest: "ram", tightestPct: 30 });
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
  it("derives grounded Avatar build capacity guidance from observed free RAM", () => {
    const gib = 1024 ** 3;
    expect(amfCapacityGuidance(snapshot({ ramUsedBytes: 16 * gib, ramTotalBytes: 32 * gib }))).toEqual({
      tier: "comfortable",
      availableRamGiB: "16.0",
    });
    expect(amfCapacityGuidance(snapshot({ ramUsedBytes: 24 * gib, ramTotalBytes: 32 * gib }))).toEqual({
      tier: "single",
      availableRamGiB: "8.0",
    });
    expect(amfCapacityGuidance(snapshot({ ramUsedBytes: 13 * gib, ramTotalBytes: 16 * gib }))).toEqual({
      tier: "tight",
      availableRamGiB: "3.0",
    });
    expect(amfCapacityGuidance(snapshot({ ramTotalBytes: 0 }))).toBeNull();
  });
  it("computes bounded SVG sparkline coordinates across the 60s window", () => {
    expect(sparklinePoints([])).toBe("");
    expect(sparklinePoints([50])).toBe("");
    expect(sparklinePoints([0, 50, 100], 100, 24)).toBe("0.0,22.0 50.0,12.0 100.0,2.0");
  });
});

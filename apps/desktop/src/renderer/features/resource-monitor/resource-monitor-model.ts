import type { SystemResourceUsageV2 } from "@vua/contracts";

export type ResourceKey = "cpu" | "gpu" | "ram" | "vram";
export interface ResourceUsagePercents {
  readonly cpuPct: number | null;
  readonly gpuPct: number | null;
  readonly ramPct: number;
  readonly vramPct: number | null;
  /** Only known dimensions participate; never count unavailable sensors as 0. */
  readonly measuredCount: number;
  readonly headroomPct: number;
  /** A nearly full dimension remains visible even when the mean looks healthy. */
  readonly constrained: ResourceKey | null;
  readonly constrainedPct: number | null;
}

export function percentOf(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}
const utilization = (value: number | null) =>
  value === null || !Number.isFinite(value) || value < 0 ? null : Math.min(100, Math.round(value));

export function usagePercents(snapshot: SystemResourceUsageV2): ResourceUsagePercents {
  const cpuPct = utilization(snapshot.cpuUsagePercent);
  const gpuPct = utilization(snapshot.gpuUsagePercent);
  const ramPct = percentOf(snapshot.ramUsedBytes, snapshot.ramTotalBytes);
  const vramPct = snapshot.vramUsedBytes !== null && snapshot.vramTotalBytes !== null && snapshot.vramTotalBytes > 0
    ? percentOf(snapshot.vramUsedBytes, snapshot.vramTotalBytes) : null;
  const known = ([["cpu", cpuPct], ["gpu", gpuPct], ["ram", ramPct], ["vram", vramPct]] as const)
    .filter((entry): entry is readonly [ResourceKey, number] => entry[1] !== null);
  const worst = [...known].sort((a, b) => b[1] - a[1])[0];
  return { cpuPct, gpuPct, ramPct, vramPct, measuredCount: known.length,
    headroomPct: Math.round(100 - known.reduce((sum, [, value]) => sum + value, 0) / known.length),
    constrained: worst && worst[1] >= 90 ? worst[0] : null,
    constrainedPct: worst && worst[1] >= 90 ? worst[1] : null };
}
export function formatGigabytes(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

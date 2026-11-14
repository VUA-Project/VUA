import type { SystemResourceUsageV2 } from "@vua/contracts";

export type ResourceKey = "cpu" | "gpu" | "ram" | "vram";
/** F6: 标题栏不再显示均值余量,而是点名最高读数的维度并给出三档状态。 */
export type ResourceLoadState = "plenty" | "gettingTight" | "tight";
/** getting tight 与沿用既有"紧张"警戒线(90%)对齐;70% 起读作趋紧。 */
export const GETTING_TIGHT_PCT = 70;
export const TIGHT_PCT = 90;
export interface ResourceUsagePercents {
  readonly cpuPct: number | null;
  readonly gpuPct: number | null;
  readonly ramPct: number;
  readonly vramPct: number | null;
  /** Only known dimensions participate; never count unavailable sensors as 0. */
  readonly measuredCount: number;
  /** The dimension with the highest reading; null only when nothing is measurable. */
  readonly tightest: ResourceKey | null;
  readonly tightestPct: number | null;
  readonly loadState: ResourceLoadState;
}

export function percentOf(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}
const utilization = (value: number | null) =>
  value === null || !Number.isFinite(value) || value < 0 ? null : Math.min(100, Math.round(value));

export function loadStateOf(tightestPct: number | null): ResourceLoadState {
  if (tightestPct === null) return "plenty";
  if (tightestPct >= TIGHT_PCT) return "tight";
  if (tightestPct >= GETTING_TIGHT_PCT) return "gettingTight";
  return "plenty";
}

export function usagePercents(snapshot: SystemResourceUsageV2): ResourceUsagePercents {
  const cpuPct = utilization(snapshot.cpuUsagePercent);
  const gpuPct = utilization(snapshot.gpuUsagePercent);
  const ramPct = percentOf(snapshot.ramUsedBytes, snapshot.ramTotalBytes);
  const vramPct = snapshot.vramUsedBytes !== null && snapshot.vramTotalBytes !== null && snapshot.vramTotalBytes > 0
    ? percentOf(snapshot.vramUsedBytes, snapshot.vramTotalBytes) : null;
  const known = ([["cpu", cpuPct], ["gpu", gpuPct], ["ram", ramPct], ["vram", vramPct]] as const)
    .filter((entry): entry is readonly [ResourceKey, number] => entry[1] !== null);
  const worst = [...known].sort((a, b) => b[1] - a[1])[0];
  const tightestPct = worst ? worst[1] : null;
  return { cpuPct, gpuPct, ramPct, vramPct, measuredCount: known.length,
    tightest: worst ? worst[0] : null,
    tightestPct,
    loadState: loadStateOf(tightestPct) };
}
export function formatGigabytes(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

export type AmfCapacityTier = "comfortable" | "single" | "tight";

export interface AmfCapacityGuidance {
  readonly tier: AmfCapacityTier;
  readonly availableRamGiB: string;
}

const GIB = 1024 ** 3;
const COMFORTABLE_FREE_RAM_GIB = 12;
const SINGLE_BUILD_FREE_RAM_GIB = 6;

/** Grounded capacity hint from observed free system RAM for headless Unity Avatar builds. */
export function amfCapacityGuidance(snapshot: SystemResourceUsageV2): AmfCapacityGuidance | null {
  if (
    !Number.isFinite(snapshot.ramUsedBytes) ||
    !Number.isFinite(snapshot.ramTotalBytes) ||
    snapshot.ramTotalBytes <= 0
  ) {
    return null;
  }
  const availableBytes = Math.max(0, snapshot.ramTotalBytes - snapshot.ramUsedBytes);
  const freeGiB = availableBytes / GIB;
  const tier: AmfCapacityTier =
    freeGiB >= COMFORTABLE_FREE_RAM_GIB
      ? "comfortable"
      : freeGiB >= SINGLE_BUILD_FREE_RAM_GIB
        ? "single"
        : "tight";
  return { tier, availableRamGiB: freeGiB.toFixed(1) };
}

/** Maps bounded 0..100 utilization samples into SVG polyline coordinates. */
export function sparklinePoints(values: readonly number[], width = 120, height = 24): string {
  if (values.length < 2 || width <= 0 || height <= 4) return "";
  const pad = 2;
  const innerHeight = height - pad * 2;
  const stepX = width / (values.length - 1);
  return values
    .map((raw, index) => {
      const clamped = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
      const x = (index * stepX).toFixed(1);
      const y = (pad + innerHeight * (1 - clamped / 100)).toFixed(1);
      return `${x},${y}`;
    })
    .join(" ");
}

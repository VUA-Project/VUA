import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import type { SystemResourceUsageV1, SystemResourceUsageV2 } from "@vua/contracts";

export const RESOURCE_STALE_AFTER_MS = 6_000;
export const RESOURCE_RESPAWN_DELAY_MS = 30_000;

export interface GpuSample {
  readonly id: string;
  readonly name: string;
  readonly kind: "discrete" | "integrated" | "unknown";
  readonly usagePercent: number | null;
  readonly dedicatedUsedBytes: number | null;
  readonly dedicatedTotalBytes: number | null;
}
interface NativeSample { readonly cpuUsagePercent: number | null; readonly gpus: readonly GpuSample[] }

const finiteOrNull = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max);

export function parseResourceSample(line: string): NativeSample | null {
  try {
    const value = JSON.parse(line) as NativeSample;
    if (!value || !finiteOrNull(value.cpuUsagePercent, 100) || !Array.isArray(value.gpus) || value.gpus.length > 64) return null;
    const ids = new Set<string>();
    for (const gpu of value.gpus) {
      if (!gpu || typeof gpu.id !== "string" || !gpu.id.length || gpu.id.length > 256 || ids.has(gpu.id)
        || typeof gpu.name !== "string" || !gpu.name.length || gpu.name.length > 256
        || !["discrete", "integrated", "unknown"].includes(gpu.kind)
        || !finiteOrNull(gpu.usagePercent, 100) || !finiteOrNull(gpu.dedicatedUsedBytes)
        || !finiteOrNull(gpu.dedicatedTotalBytes)) return null;
      ids.add(gpu.id);
    }
    return value;
  } catch { return null; }
}

/** Never average adapters or pair memory from different cards. Discrete cards
 * take precedence over UMA. Among them, use the busiest measured card, then
 * highest VRAM pressure. Missing utilization never stands in for measured zero. */
export function selectResourceGpu(gpus: readonly GpuSample[]): GpuSample | null {
  const discrete = gpus.filter(gpu => gpu.kind === "discrete");
  const candidates = discrete.length ? discrete : gpus;
  const memoryPressure = (gpu: GpuSample) => gpu.dedicatedUsedBytes !== null && gpu.dedicatedTotalBytes !== null && gpu.dedicatedTotalBytes > 0
    ? gpu.dedicatedUsedBytes / gpu.dedicatedTotalBytes : -1;
  return [...candidates].sort((a, b) => (b.usagePercent ?? -1) - (a.usagePercent ?? -1)
    || memoryPressure(b) - memoryPressure(a) || a.id.localeCompare(b.id))[0] ?? null;
}

export interface SystemUsageCollectorOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawnImpl?: typeof spawn;
  readonly now?: () => number;
}

/** One read-only native helper using the bundled host binary. PDH/DXGI stay
 * behind the native adapter. No shell, task DB or AMF dependency. Expired or
 * failed readings become null rather than remaining visible as current facts. */
export class SystemUsageCollector {
  private sample: NativeSample | null = null;
  private sampledAt = 0;
  private child: ChildProcessWithoutNullStreams | null = null;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private executable: string | null = null;
  private readonly platform: NodeJS.Platform;
  private readonly spawnImpl: typeof spawn;
  private readonly now: () => number;

  constructor(options: SystemUsageCollectorOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.now = options.now ?? Date.now;
  }
  start(executable?: string): void {
    if (this.platform !== "win32" || !executable || this.child || this.stopped) return;
    this.executable = executable;
    this.spawnSampler();
  }
  snapshotV2(): SystemResourceUsageV2 {
    const fresh = this.sample !== null && this.now() - this.sampledAt <= RESOURCE_STALE_AFTER_MS ? this.sample : null;
    const gpu = fresh ? selectResourceGpu(fresh.gpus) : null;
    const ramTotal = os.totalmem();
    return { schemaVersion: 2, ramUsedBytes: ramTotal - os.freemem(), ramTotalBytes: ramTotal,
      cpuUsagePercent: fresh?.cpuUsagePercent ?? null, gpuUsagePercent: gpu?.usagePercent ?? null,
      gpuName: gpu?.name ?? null, gpuKind: gpu?.kind ?? null,
      vramUsedBytes: gpu?.kind === "discrete" ? gpu.dedicatedUsedBytes : null,
      vramTotalBytes: gpu?.kind === "discrete" ? gpu.dedicatedTotalBytes : null,
      sampledAt: new Date(this.now()).toISOString() };
  }
  snapshot(): SystemResourceUsageV1 {
    const value = this.snapshotV2();
    return { schemaVersion: 1, ramUsedBytes: value.ramUsedBytes, ramTotalBytes: value.ramTotalBytes,
      vramUsedBytes: value.vramUsedBytes, vramTotalBytes: value.vramTotalBytes, sampledAt: value.sampledAt };
  }
  stop(): void {
    this.stopped = true;
    this.sample = null;
    if (this.respawnTimer !== null) { clearTimeout(this.respawnTimer); this.respawnTimer = null; }
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
  }
  private spawnSampler(): void {
    if (this.stopped || !this.executable) return;
    let child: ChildProcessWithoutNullStreams;
    try { child = this.spawnImpl(this.executable, ["--observe-system-resources"], { windowsHide: true }) as ChildProcessWithoutNullStreams; }
    catch { this.scheduleRespawn(); return; }
    this.child = child;
    let buffered = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      if (this.stopped || this.child !== child) return;
      buffered += String(chunk);
      if (buffered.length > 65_536) { this.sample = null; buffered = ""; return; }
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        this.sample = parseResourceSample(line);
        this.sampledAt = this.now();
      }
    });
    child.stderr.resume();
    child.on("error", () => { this.sample = null; child.kill(); });
    child.on("close", () => {
      if (this.child !== child) return;
      this.child = null;
      this.sample = null;
      this.scheduleRespawn();
    });
  }
  private scheduleRespawn(): void {
    if (this.stopped || this.respawnTimer !== null) return;
    this.respawnTimer = setTimeout(() => { this.respawnTimer = null; this.spawnSampler(); }, RESOURCE_RESPAWN_DELAY_MS);
    this.respawnTimer.unref();
  }
}

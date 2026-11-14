import { useEffect, useState } from "react";
import type { SystemResourceUsageV2 } from "@vua/contracts";
import { usagePercents } from "./resource-monitor-model.ts";

const POLL_INTERVAL_MS = 2_000;
const MAX_HISTORY_SAMPLES = 30;

export interface ResourceUsageView {
  readonly snapshot: SystemResourceUsageV2 | null;
  readonly history: readonly number[];
}

type Listener = (view: ResourceUsageView) => void;

let currentView: ResourceUsageView = { snapshot: null, history: [] };
let timer: number | null = null;
let generation = 0;
const listeners = new Set<Listener>();

function emit(next: ResourceUsageView): void {
  currentView = next;
  for (const listener of listeners) listener(next);
}

function pollOnce(expectedGen: number): void {
  const system = window.vua?.system;
  if (system === undefined) return;
  const read = system.readResourceUsageV2
    ? system.readResourceUsageV2()
    : system.readResourceUsage().then((value) => ({
        ...value,
        schemaVersion: 2 as const,
        cpuUsagePercent: null,
        gpuUsagePercent: null,
        gpuName: null,
        gpuKind: null,
        steamVrRunning: null,
      }));
  read
    .then((next) => {
      if (expectedGen !== generation || listeners.size === 0) return;
      const pct = usagePercents(next).tightestPct;
      const history =
        pct === null
          ? currentView.history
          : [...currentView.history.slice(-(MAX_HISTORY_SAMPLES - 1)), pct];
      emit({ snapshot: next, history });
    })
    .catch(() => {
      if (expectedGen !== generation || listeners.size === 0) return;
      emit({ snapshot: null, history: [] });
    });
}

function ensurePolling(): void {
  if (timer !== null || window.vua?.system === undefined || listeners.size === 0) return;
  const activeGen = ++generation;
  pollOnce(activeGen);
  timer = window.setInterval(() => pollOnce(activeGen), POLL_INTERVAL_MS);
}

function stopPolling(): void {
  generation += 1;
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
  currentView = { snapshot: null, history: [] };
}

export function useResourceUsage(): ResourceUsageView {
  const [view, setView] = useState<ResourceUsageView>(() => currentView);
  useEffect(() => {
    listeners.add(setView);
    if (timer === null) {
      ensurePolling();
    } else {
      setView(currentView);
    }
    return () => {
      listeners.delete(setView);
      if (listeners.size === 0) stopPolling();
    };
  }, []);
  return view;
}

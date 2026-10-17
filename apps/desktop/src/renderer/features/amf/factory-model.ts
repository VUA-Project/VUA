/** Production lines in the AMF workshop: stations, line status and the automation level. */
import type { AmfRunPhase } from "../../gateway/index.ts";

export const STATIONS = ["prepare", "inspect", "plan", "assemble", "check"] as const;
export type StationKey = typeof STATIONS[number];
export type StationState = "todo" | "running" | "waiting" | "done" | "failed" | "stopped";
export type LineStatus = "running" | "waiting" | "attention" | "finished" | "stopped" | "idle";
export type AutomationLevel = "auto" | "semi" | "manual";
export const AUTOMATION_LEVELS: readonly AutomationLevel[] = ["auto", "semi", "manual"];

interface Step { readonly key: string; readonly state: string }
export interface LineFacts { readonly phase: AmfRunPhase; readonly steps: readonly Step[] }

const BUSY: readonly AmfRunPhase[] = ["preparing", "inspecting", "assembling", "restoring"];
const stationOf: Record<string, StationKey> = {
  project: "prepare", materials: "prepare",
  inspect: "inspect", reinspect: "inspect",
  snapshot: "assemble", assembly: "assemble", protect_current: "assemble", restore: "assemble",
};

/** A line is working while its phase is busy or any step still runs; a reinspection keeps the old phase. */
export function lineBusy(line: LineFacts): boolean {
  return BUSY.includes(line.phase) || line.steps.some(step => step.state === "running");
}

/** Status from the phase alone, for list rows that carry no steps. */
export function phaseStatus(phase: AmfRunPhase): LineStatus {
  if (BUSY.includes(phase)) return "running";
  if (phase === "ready") return "waiting";
  if (phase === "succeeded") return "finished";
  if (phase === "cancelled" || phase === "stopped") return "stopped";
  return "attention";
}

export function lineStatus(line: LineFacts): LineStatus {
  return lineBusy(line) ? "running" : phaseStatus(line.phase);
}

/** Each station's state. The latest step of a station decides it; later stations follow the phase. */
export function lineStations(line: LineFacts): Record<StationKey, StationState> {
  const states: Record<StationKey, StationState> = { prepare: "todo", inspect: "todo", plan: "todo", assemble: "todo", check: "todo" };
  for (const step of line.steps) {
    const station = stationOf[step.key];
    if (!station) continue;
    states[station] = step.state === "running" ? "running" : step.state === "failed" ? "failed" : step.state === "succeeded" ? "done"
      : step.state === "stopped" || step.state === "interrupted" ? "stopped" : states[station];
  }
  const busy = lineBusy(line);
  if (line.phase === "ready" && !busy) states.plan = "waiting";
  if (line.phase === "assembling" || states.assemble !== "todo" || line.phase === "succeeded") states.plan = "done";
  if (line.phase === "succeeded" && !busy) { states.assemble = "done"; states.check = "done"; }
  if (line.phase === "cancelled" || line.phase === "stopped") for (const key of STATIONS) if (states[key] === "running") states[key] = "stopped";
  return states;
}

/** The station the line is at: the first one running, waiting or failed, else the last one done. */
export function currentStation(states: Record<StationKey, StationState>): StationKey {
  const active = STATIONS.find(key => ["running", "waiting", "failed", "stopped"].includes(states[key]));
  if (active) return active;
  return [...STATIONS].reverse().find(key => states[key] === "done") ?? "prepare";
}

/** Where the line stops for the player at each automation level. */
export function stopsAt(level: AutomationLevel): ReadonlySet<StationKey> {
  return new Set<StationKey>(level === "auto" ? ["plan"] : level === "semi" ? ["plan", "check"] : STATIONS);
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60); const seconds = total % 60;
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const levelKey = "vua-amf-automation-level-v01";
export function storedAutomationLevel(): AutomationLevel | null {
  try { const value = localStorage.getItem(levelKey); return AUTOMATION_LEVELS.includes(value as AutomationLevel) ? value as AutomationLevel : null; } catch { return null; }
}
export function rememberAutomationLevel(level: AutomationLevel): void {
  try { localStorage.setItem(levelKey, level); } catch { /* The level applies to this session. */ }
}

/** When a run started: AMF run IDs are `n3-` plus a UUIDv7, whose first 48 bits are milliseconds since 1970. */
export function runStartedAt(runId: string): Date | null {
  const hex = runId.replace(/^n3-/u, "").replace(/-/gu, "").slice(0, 12);
  if (!/^[0-9a-f]{12}$/iu.test(hex)) return null;
  const date = new Date(Number.parseInt(hex, 16));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A line's name and, when other lines share it, what tells them apart: the start time, plus a number within the same minute. */
export function lineLabels(runs: readonly { runId: string; sourceNames: readonly string[] }[], time: (date: Date) => string): Map<string, { name: string; extra: string | null }> {
  const nameOf = (names: readonly string[]) => [...new Set(names.map(name => name.replace(/\.zip$/iu, "")))].join(" + ");
  const named = runs.map(run => ({ run, name: nameOf(run.sourceNames) || run.runId }));
  const labels = new Map<string, { name: string; extra: string | null }>();
  for (const { run, name } of named) {
    const twins = named.filter(other => other.name === name);
    if (twins.length < 2) { labels.set(run.runId, { name, extra: null }); continue; }
    const started = runStartedAt(run.runId);
    const stamp = started ? time(started) : run.runId.slice(-6);
    const sameStamp = twins.filter(other => { const at = runStartedAt(other.run.runId); return (at ? time(at) : other.run.runId.slice(-6)) === stamp; })
      .sort((a, b) => a.run.runId.localeCompare(b.run.runId));
    labels.set(run.runId, { name, extra: sameStamp.length > 1 ? `${stamp} · #${sameStamp.findIndex(other => other.run.runId === run.runId) + 1}` : stamp });
  }
  return labels;
}

/** Candidate play-session v0.2. Closed routes, observed files/processes, card-scoped close. */
export const PLAY_SESSION_SCHEMA = "vua.play-session/v0.2" as const;
export const PLAY_ROUTES = ["desktop_play", "pico_pcvr"] as const;
export type PlayRoute = typeof PLAY_ROUTES[number];
export const PLAY_COMPONENTS = ["steam", "pico_runtime", "steamvr", "vrchat"] as const;
export type PlayComponent = typeof PLAY_COMPONENTS[number];
export const PLAY_ISSUES = ["not_installed", "other_route_active", "start_failed", "start_timeout", "close_failed", "close_timeout", "close_pending"] as const;
export type PlayIssue = typeof PLAY_ISSUES[number];
export interface PlaySoftwareFact {
  readonly component: PlayComponent;
  readonly presence: "verified" | "missing" | "unusable" | "unknown";
  readonly running: boolean;
  readonly owned: boolean;
}
export interface PlaySession {
  readonly schemaVersion: typeof PLAY_SESSION_SCHEMA;
  readonly capturedAt: string;
  readonly route: PlayRoute;
  readonly state: "idle" | "starting" | "running" | "finished" | "stopping" | "attention";
  /** True only for a current provider-owned session, including a pending start. */
  readonly canStop: boolean;
  readonly issue: PlayIssue | null;
  readonly software: readonly PlaySoftwareFact[];
}
export interface PlaySessionResult { readonly playSession: PlaySession }
export function isPlayRoute(value: unknown): value is PlayRoute {
  return value === "desktop_play" || value === "pico_pcvr";
}
export function isPlayCommandId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
export function isPlayParams(value: unknown): value is { route: PlayRoute } {
  return keys(value, ["route"]) && isPlayRoute(value.route);
}
export function isPlaySessionResult(value: unknown): value is PlaySessionResult {
  if (!keys(value, ["playSession"]) || !keys(value.playSession, ["schemaVersion", "capturedAt", "route", "state", "canStop", "issue", "software"])) return false;
  const s = value.playSession;
  if (s.schemaVersion !== PLAY_SESSION_SCHEMA || typeof s.capturedAt !== "string" || !s.capturedAt.length || !isPlayRoute(s.route)
    || typeof s.state !== "string" || !["idle", "starting", "running", "finished", "stopping", "attention"].includes(s.state) || typeof s.canStop !== "boolean"
    || (s.issue !== null && !PLAY_ISSUES.includes(s.issue as PlayIssue)) || !Array.isArray(s.software)) return false;
  const required = s.route === "desktop_play" ? ["steam", "vrchat"] : [...PLAY_COMPONENTS];
  return s.software.length === required.length && new Set(s.software.map(f => record(f) ? f.component : null)).size === required.length
    && s.software.every(f => keys(f, ["component", "presence", "running", "owned"]) && typeof f.component === "string" && required.includes(f.component)
      && typeof f.presence === "string" && ["verified", "missing", "unusable", "unknown"].includes(f.presence) && typeof f.running === "boolean" && typeof f.owned === "boolean"
      && (!f.owned || (f.running && s.canStop)))
    && ((s.state !== "starting" && s.state !== "running" && s.state !== "finished" && s.state !== "stopping") || s.canStop)
    && (s.state !== "finished" || s.issue === null)
    && (s.state !== "running" || (s.issue === null && s.software.every(f => f.running && f.presence === "verified")))
    && (s.state !== "idle" || (!s.canStop && s.issue === null));
}

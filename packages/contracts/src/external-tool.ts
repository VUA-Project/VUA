/** Candidate N2 v0.1: fixed official Steam connection; hardware/modules stay upstream. */
export type ExternalToolId = "vrcft";
export const EXTERNAL_TOOL_ACTIONS = ["install", "start", "stop", "cancel"] as const;
export type ExternalToolAction = typeof EXTERNAL_TOOL_ACTIONS[number];
export interface ExternalToolSnapshot {
  readonly schemaVersion: "vua.external-tool/v0.1";
  readonly toolId: ExternalToolId;
  readonly capturedAt: string;
  readonly presence: "installed" | "missing" | "incomplete" | "unknown";
  readonly steamReady: boolean;
  readonly buildId: string | null;
  readonly running: boolean;
  readonly canStop: boolean;
  readonly activity: "idle" | "install_requested" | "starting" | "stopping";
  readonly issue: "steam_missing" | "not_installed" | "handoff_failed" | "start_timeout" | "close_failed" | "close_timeout" | null;
}
export interface ExternalToolResult { readonly toolConnection: ExternalToolSnapshot }
function keys(v: unknown, names: readonly string[]): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(key => Object.hasOwn(v, key)); }
export function isExternalToolParams(value: unknown, command: boolean): boolean {
  return keys(value, command ? ["toolId", "action"] : ["toolId"]) && value.toolId === "vrcft"
    && (!command || EXTERNAL_TOOL_ACTIONS.includes(value.action as ExternalToolAction));
}
export function isExternalToolResult(value: unknown): value is ExternalToolResult {
  if (!keys(value, ["toolConnection"]) || !keys(value.toolConnection, ["schemaVersion", "toolId", "capturedAt", "presence", "steamReady", "buildId", "running", "canStop", "activity", "issue"])) return false;
  const v = value.toolConnection;
  return v.schemaVersion === "vua.external-tool/v0.1" && v.toolId === "vrcft" && typeof v.capturedAt === "string" && v.capturedAt.length > 0
    && ["installed", "missing", "incomplete", "unknown"].includes(v.presence as string) && typeof v.steamReady === "boolean"
    && (v.buildId === null || (typeof v.buildId === "string" && /^\d{1,32}$/.test(v.buildId)))
    && typeof v.running === "boolean" && typeof v.canStop === "boolean" && (!v.canStop || v.running)
    && ["idle", "install_requested", "starting", "stopping"].includes(v.activity as string)
    && (v.issue === null || ["steam_missing", "not_installed", "handoff_failed", "start_timeout", "close_failed", "close_timeout"].includes(v.issue as string))
    && (v.activity !== "stopping" || v.canStop) && (v.activity !== "starting" || !v.running);
}

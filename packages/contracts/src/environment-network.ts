/** First-play HTTPS observations, independent of the frozen legacy TCP snapshot. */
export const NETWORK_SCHEMA = "0.1" as const;
export const NETWORK_TARGETS = ["steam_store", "steam_community", "steam_download", "vrchat_web", "pico_connect"] as const;
export type NetworkTarget = typeof NETWORK_TARGETS[number];
export type NetworkRegion = "china_mainland" | "other" | "unknown";
export interface NetworkIntent {
  readonly route: "desktop_play" | "pico_pcvr";
  readonly region: "auto" | "china_mainland" | "other";
}
export type NetworkStatus = "reachable" | "http_error" | "redirected" | "timeout" | "connection_failed" | "probe_error";
export interface NetworkObservation {
  readonly target: NetworkTarget;
  readonly status: NetworkStatus;
  readonly elapsedMs: number;
  readonly httpStatus: number | null;
}
export interface NetworkReport {
  readonly schemaVersion: typeof NETWORK_SCHEMA;
  readonly intent: NetworkIntent;
  readonly detectedRegion: NetworkRegion;
  readonly effectiveRegion: NetworkRegion;
  readonly capturedAt: string;
  readonly durationMs: number;
  readonly results: readonly NetworkObservation[];
}
export interface NetworkResult { readonly networkReport: NetworkReport }

/** Navigation uses fixed destinations, never a URL supplied in a probe response. */
export const NETWORK_LINKS: Record<NetworkTarget, string> = {
  steam_store: "https://store.steampowered.com/join/",
  steam_community: "https://steamcommunity.com/",
  steam_download: "https://store.steampowered.com/about/",
  vrchat_web: "https://vrchat.com/home",
  pico_connect: "https://www.picoxr.com/global/software/pico-connect",
};
export const NETEASE_UU_URL = "https://uu.163.com/";

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function milliseconds(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function region(value: unknown): value is NetworkRegion { return value === "china_mainland" || value === "other" || value === "unknown"; }
export function isNetworkIntent(value: unknown): value is NetworkIntent {
  return closed(value, ["route", "region"]) && (value.route === "desktop_play" || value.route === "pico_pcvr")
    && (value.region === "auto" || value.region === "china_mainland" || value.region === "other");
}
export function isNetworkParams(value: unknown): value is { intent: NetworkIntent } {
  return closed(value, ["intent"]) && isNetworkIntent(value.intent);
}
export function isNetworkResult(value: unknown): value is NetworkResult {
  if (!closed(value, ["networkReport"])) return false;
  const r = value.networkReport;
  if (!closed(r, ["schemaVersion", "intent", "detectedRegion", "effectiveRegion", "capturedAt", "durationMs", "results"])
    || r.schemaVersion !== NETWORK_SCHEMA || !isNetworkIntent(r.intent) || !region(r.detectedRegion) || !region(r.effectiveRegion)
    || typeof r.capturedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(r.capturedAt)
    || !Number.isFinite(Date.parse(r.capturedAt)) || !milliseconds(r.durationMs) || !Array.isArray(r.results)) return false;
  if (r.effectiveRegion !== (r.intent.region === "auto" ? r.detectedRegion : r.intent.region)
    || (r.intent.region !== "auto" && r.detectedRegion !== "unknown")) return false;
  const targets = r.intent.route === "pico_pcvr" ? NETWORK_TARGETS : NETWORK_TARGETS.slice(0, 4);
  return r.results.length === targets.length && r.results.every((row: unknown, index: number) => {
    if (!closed(row, ["target", "status", "elapsedMs", "httpStatus"]) || row.target !== targets[index] || !milliseconds(row.elapsedMs)) return false;
    const code = row.httpStatus;
    if (row.status === "reachable") return Number.isInteger(code) && Number(code) >= 200 && Number(code) < 300;
    if (row.status === "redirected") return Number.isInteger(code) && Number(code) >= 300 && Number(code) < 400;
    if (row.status === "http_error") return Number.isInteger(code) && Number(code) >= 400 && Number(code) < 600;
    return ["timeout", "connection_failed", "probe_error"].includes(String(row.status)) && code === null;
  });
}

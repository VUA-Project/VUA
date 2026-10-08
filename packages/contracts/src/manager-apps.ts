export interface ManagerAppsResult {
  readonly managerApps: { readonly schemaVersion: "vua.manager-apps/v0.1"; readonly capturedAt: string;
    readonly apps: readonly { readonly component: "unity_hub" | "vcc" | "alcom"; readonly presence: "found" | "not_found" | "unknown"; readonly path: string | null }[] };
}
export function isManagerAppsResult(v: unknown): v is ManagerAppsResult {
  const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
  if (!record(v) || Object.keys(v).length !== 1 || !record(v.managerApps)) return false;
  const s = v.managerApps;
  return Object.keys(s).length === 3 && s.schemaVersion === "vua.manager-apps/v0.1" && typeof s.capturedAt === "string" && s.capturedAt.length > 0
    && Array.isArray(s.apps) && s.apps.length === 3 && new Set(s.apps.map(a => record(a) ? a.component : null)).size === 3
    && s.apps.every(a => record(a) && Object.keys(a).length === 3 && typeof a.component === "string" && ["unity_hub", "vcc", "alcom"].includes(a.component)
      && typeof a.presence === "string" && ["found", "not_found", "unknown"].includes(a.presence) && (a.path === null || (typeof a.path === "string" && a.path.length > 0))
      && (a.presence !== "found" || a.path !== null));
}

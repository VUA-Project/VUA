export const MANAGER_APP_IDS = ["unity_hub", "vcc", "alcom"] as const;
export type ManagerAppId = (typeof MANAGER_APP_IDS)[number];
export const MANAGER_APP_NAMES: Readonly<Record<ManagerAppId, string>> = {
  unity_hub: "Unity Hub",
  vcc: "Creator Companion (VCC)",
  alcom: "ALCOM",
};

export interface ManagerAppsResult {
  readonly managerApps: {
    readonly schemaVersion: "vua.manager-apps/v0.1";
    readonly capturedAt: string;
    readonly apps: readonly {
      readonly component: ManagerAppId;
      readonly presence: "found" | "not_found" | "unknown";
      readonly path: string | null;
    }[];
  };
}

export interface OpenManagerAppParamsV02 {
  readonly managerId: ManagerAppId;
}

export interface ManagerAppLaunchResultV02 {
  readonly managerAppLaunch: {
    readonly schemaVersion: "vua.manager-apps/v0.2";
    readonly managerId: ManagerAppId;
    readonly launchedAt: string;
  };
}

const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);

export function isManagerAppId(v: unknown): v is ManagerAppId {
  return typeof v === "string" && (MANAGER_APP_IDS as readonly string[]).includes(v);
}

export function isOpenManagerAppParamsV02(v: unknown): v is OpenManagerAppParamsV02 {
  return record(v) && Object.keys(v).length === 1 && isManagerAppId(v.managerId);
}

export function isManagerAppLaunchResultV02(v: unknown): v is ManagerAppLaunchResultV02 {
  if (!record(v) || Object.keys(v).length !== 1 || !record(v.managerAppLaunch)) return false;
  const s = v.managerAppLaunch;
  return (
    Object.keys(s).length === 3
    && s.schemaVersion === "vua.manager-apps/v0.2"
    && isManagerAppId(s.managerId)
    && typeof s.launchedAt === "string"
    && s.launchedAt.length > 0
  );
}

export function isManagerAppsResult(v: unknown): v is ManagerAppsResult {
  if (!record(v) || Object.keys(v).length !== 1 || !record(v.managerApps)) return false;
  const s = v.managerApps;
  return (
    Object.keys(s).length === 3
    && s.schemaVersion === "vua.manager-apps/v0.1"
    && typeof s.capturedAt === "string"
    && s.capturedAt.length > 0
    && Array.isArray(s.apps)
    && s.apps.length === 3
    && new Set(s.apps.map(a => (record(a) ? a.component : null))).size === 3
    && s.apps.every(
      a =>
        record(a)
        && Object.keys(a).length === 3
        && isManagerAppId(a.component)
        && typeof a.presence === "string"
        && ["found", "not_found", "unknown"].includes(a.presence)
        && (a.path === null || (typeof a.path === "string" && a.path.length > 0))
        && (a.presence !== "found" || a.path !== null),
    )
  );
}

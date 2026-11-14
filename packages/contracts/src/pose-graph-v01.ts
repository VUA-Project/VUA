/** Candidate pose-graph v0.1 (0.1.0): Host-owned local OpenXR, SteamVR external-driver
 * & Safe Mode block, multi-driver FBT conflict risk, and companion pose-tool observation. */
export const POSE_GRAPH_SCHEMA = "vua.pose-graph/v0.1" as const;

export const POSE_SOURCE_IDS = [
  "headset_6dof",
  "slimevr",
  "pico_motion",
  "lighthouse",
  "space_calibrator",
  "mocopi",
  "haritorax",
  "rebocap",
  "eye_face_osc",
] as const;
export type PoseSourceIdV01 = typeof POSE_SOURCE_IDS[number];

export const POSE_SOURCE_STATES = [
  "active",
  "ready",
  "installed",
  "not_detected",
] as const;
export type PoseSourceStateV01 = typeof POSE_SOURCE_STATES[number];

export const STEAMVR_POSE_DRIVERS = [
  "space_calibrator",
  "slimevr",
  "alvr",
  "virtual_desktop",
  "lighthouse",
  "mocopi",
  "haritorax",
  "rebocap",
] as const;
export type SteamVrPoseDriverIdV01 = typeof STEAMVR_POSE_DRIVERS[number];

export interface OpenXrRuntimeObservationV01 {
  readonly presence: "found" | "missing" | "unreadable";
  readonly runtimeName: string | null;
}

export interface PoseSourceObservationV01 {
  readonly sourceId: PoseSourceIdV01;
  readonly state: PoseSourceStateV01;
  readonly detailCode: string | null;
}

export const FBT_DRIVER_CONFLICT_RISKS = [
  "none",
  "multiple_openvr_fbt_drivers",
] as const;
export type FbtDriverConflictRiskV01 = typeof FBT_DRIVER_CONFLICT_RISKS[number];

export interface PoseGraphSnapshotV01 {
  readonly schemaVersion: typeof POSE_GRAPH_SCHEMA;
  readonly capturedAt: string;
  readonly openxr: OpenXrRuntimeObservationV01;
  readonly steamvrDrivers: readonly SteamVrPoseDriverIdV01[];
  readonly blockedSteamvrDrivers: readonly SteamVrPoseDriverIdV01[];
  readonly fbtDriverConflictRisk: FbtDriverConflictRiskV01;
  readonly lastHeadsetHint: string | null;
  readonly poseSources: readonly PoseSourceObservationV01[];
}

export interface ObservePoseGraphParamsV01 {
  readonly schemaVersion: "0.1";
}

export interface PoseGraphResultV01 {
  readonly poseGraph: PoseGraphSnapshotV01;
}

export interface PoseGraphGatewayRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "environment.observePoseGraph";
  readonly params: ObservePoseGraphParamsV01;
}

function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function exactKeys(v: unknown, expected: readonly string[]): v is Record<string, unknown> {
  return record(v) && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
}

function safeLabel(v: unknown, max = 80): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= max && !/[\\/:]/u.test(v);
}

function validDriverList(v: unknown): v is readonly SteamVrPoseDriverIdV01[] {
  if (!Array.isArray(v) || v.length > 16) return false;
  if (new Set(v).size !== v.length) return false;
  return v.every(d => STEAMVR_POSE_DRIVERS.includes(d as SteamVrPoseDriverIdV01));
}

export function isObservePoseGraphParamsV01(v: unknown): v is ObservePoseGraphParamsV01 {
  return exactKeys(v, ["schemaVersion"]) && v.schemaVersion === "0.1";
}

export function isPoseGraphSnapshotV01(v: unknown): v is PoseGraphSnapshotV01 {
  if (!exactKeys(v, [
    "schemaVersion",
    "capturedAt",
    "openxr",
    "steamvrDrivers",
    "blockedSteamvrDrivers",
    "fbtDriverConflictRisk",
    "lastHeadsetHint",
    "poseSources",
  ])) return false;
  if (v.schemaVersion !== POSE_GRAPH_SCHEMA) return false;
  if (typeof v.capturedAt !== "string" || v.capturedAt.length < 1 || v.capturedAt.length > 64) return false;

  if (!exactKeys(v.openxr, ["presence", "runtimeName"])) return false;
  if (!["found", "missing", "unreadable"].includes(String(v.openxr.presence))) return false;
  if (v.openxr.runtimeName !== null && !safeLabel(v.openxr.runtimeName, 80)) return false;

  if (!validDriverList(v.steamvrDrivers) || !validDriverList(v.blockedSteamvrDrivers)) return false;
  if (!FBT_DRIVER_CONFLICT_RISKS.includes(v.fbtDriverConflictRisk as FbtDriverConflictRiskV01)) return false;

  if (v.lastHeadsetHint !== null && !safeLabel(v.lastHeadsetHint, 80)) return false;

  if (!Array.isArray(v.poseSources) || v.poseSources.length !== POSE_SOURCE_IDS.length) return false;
  for (let i = 0; i < POSE_SOURCE_IDS.length; i += 1) {
    const item = v.poseSources[i];
    if (!exactKeys(item, ["sourceId", "state", "detailCode"])) return false;
    if (item.sourceId !== POSE_SOURCE_IDS[i]) return false;
    if (!POSE_SOURCE_STATES.includes(item.state as PoseSourceStateV01)) return false;
    if (item.detailCode !== null && (typeof item.detailCode !== "string" || !/^[a-z0-9_]{1,64}$/u.test(item.detailCode))) {
      return false;
    }
  }

  return true;
}

export function isPoseGraphResultV01(v: unknown): v is PoseGraphResultV01 {
  return exactKeys(v, ["poseGraph"]) && isPoseGraphSnapshotV01(v.poseGraph);
}

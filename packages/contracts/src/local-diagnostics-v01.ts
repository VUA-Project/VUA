import { isPlayCommandId } from "./play-session.js";

/** Candidate local-diagnostics v0.1: Host-owned multi-layer local observation,
 * deterministic symptom-to-SOP diagnosis, and guarded offline OSC/config helpers. */
export const LOCAL_DIAGNOSTICS_SCHEMA = "vua.local-diagnostics/v0.1" as const;

export const SYMPTOM_IDS_V01 = [
  "audio_silent_or_wrong_mic",
  "osc_or_face_tracking_not_responding",
  "low_fps_or_vram_pressure",
  "disk_cache_full",
  "crash_or_eac_block",
  "avatar_hidden_or_grey_robot",
  "cannot_upload_avatar",
  "streaming_blurry_or_compression",
  "playspace_drag_or_height_offset",
  "fbt_drift_or_calibration",
] as const;
export type SymptomIdV01 = typeof SYMPTOM_IDS_V01[number];

export const DIAGNOSTIC_LAYERS_V01 = [
  "hardware_os",
  "steamvr_openxr",
  "companion_osc",
  "client_config_cache",
  "avatar_sdk",
] as const;
export type DiagnosticLayerV01 = typeof DIAGNOSTIC_LAYERS_V01[number];

export const CLIENT_LOG_CLASSIFICATIONS_V01 = [
  "no_logs",
  "clean_or_inconclusive",
  "eac_launch_violation",
  "disk_full_write_error",
  "d3d11_device_lost_or_oom",
  "osc_socket_conflict",
  "openvr_init_failed",
  "read_failed",
] as const;
export type ClientLogClassificationV01 = typeof CLIENT_LOG_CLASSIFICATIONS_V01[number];

export const DIAGNOSTIC_FINDING_CODES_V01 = [
  "audio_virtual_mic_hijack_detected",
  "audio_communications_default_mismatch",
  "osc_port_9000_unbound_while_client_running",
  "osc_port_9000_conflict",
  "oscquery_port_mismatch",
  "osc_port_9001_unbound",
  "osc_avatar_cache_present",
  "steamvr_driver_blocked_by_safe_mode",
  "steamvr_high_supersampling",
  "steamvr_app_overscaled",
  "streaming_high_bitrate_or_encode_width",
  "streaming_low_bitrate_or_sharpening_off",
  "windows_hags_enabled_vr_stutter_risk",
  "windows_power_saver_active",
  "ovr_advanced_settings_installed_offset_check",
  "client_cache_near_limit",
  "drive_free_space_low",
  "client_config_malformed",
  "log_eac_violation_detected",
  "log_disk_full_detected",
  "log_d3d11_crash_detected",
  "log_osc_conflict_detected",
  "log_openvr_init_failed",
] as const;
export type DiagnosticFindingCodeV01 = typeof DIAGNOSTIC_FINDING_CODES_V01[number];

export const DIAGNOSTIC_HELPERS_V01 = [
  "none",
  "clear_osc_avatar_cache",
  "update_client_config",
] as const;
export type DiagnosticSuggestedHelperV01 = typeof DIAGNOSTIC_HELPERS_V01[number];

export interface UdpPortObservationV01 {
  readonly state: "unbound" | "bound" | "probe_unavailable";
  readonly ownerPid: number | null;
  readonly ownerProcess: string | null;
}

export interface ClientConfigObservationV01 {
  readonly presence: "found" | "missing" | "malformed" | "read_failed";
  readonly cacheDirectoryCustom: boolean;
  readonly cacheSizeGb: number | null;
  readonly cacheExpiryDelayDays: number | null;
  readonly cameraResWidth: number | null;
  readonly cameraResHeight: number | null;
  readonly screenshotResWidth: number | null;
  readonly screenshotResHeight: number | null;
  readonly fpvSteadycamFov: number | null;
}

export interface ClientCacheObservationV01 {
  readonly presence: "found" | "missing" | "read_failed";
  readonly totalBytes: number | null;
  readonly truncated: boolean;
  readonly driveFreeBytes: number | null;
  readonly driveTotalBytes: number | null;
}

export interface OscQueryLoopbackObservationV01 {
  readonly state: "found" | "not_detected" | "probe_unavailable";
  readonly httpPort: number | null;
  readonly advertisedOscPort: number | null;
  readonly ownerProcess: string | null;
}

export interface OscLocalObservationV01 {
  readonly avatarCachePresence: "found" | "missing" | "read_failed";
  readonly avatarConfigCount: number;
  readonly avatarCacheBytes: number;
  readonly newestModifiedAt: string | null;
  readonly udp9000: UdpPortObservationV01;
  readonly udp9001: UdpPortObservationV01;
  readonly oscQuery: OscQueryLoopbackObservationV01;
}

export interface SteamVrSettingsObservationV01 {
  readonly presence: "found" | "missing" | "malformed" | "read_failed";
  readonly renderTargetMultiplier: number | null;
  readonly motionSmoothing: boolean | null;
  readonly vrchatResolutionScale: number | null;
  readonly safeModeEnabled: boolean | null;
  readonly blockedDrivers: readonly string[];
}

export interface AudioEndpointObservationV01 {
  readonly state: "observed" | "probe_unavailable";
  readonly defaultCaptureRole: "vr_virtual" | "physical_or_usb" | "virtual_cable" | "none" | "unknown";
  readonly virtualMicHijack: "none" | "oculus_virtual" | "steam_streaming" | "pico_streaming" | "virtual_desktop";
  readonly communicationsMismatch: boolean;
}

export interface QuestLinkSettingsObservationV01 {
  readonly presence: "found" | "missing";
  readonly encodeResolutionWidth: number | null;
  readonly encodeBitrateMbps: number | null;
  readonly dynamicBitrate: boolean | null;
  readonly linkSharpening: number | null;
}

export interface PicoConnectSettingsObservationV01 {
  readonly presence: "found" | "missing" | "malformed" | "read_failed";
  readonly preset: string | null;
  readonly bitrateMbps: number | null;
}

export interface StreamingSettingsObservationV01 {
  readonly questLink: QuestLinkSettingsObservationV01;
  readonly picoConnect: PicoConnectSettingsObservationV01;
}

export const POWER_PLAN_ROLES_V01 = [
  "power_saver",
  "balanced",
  "high_or_ultimate",
  "custom",
  "unknown",
] as const;
export type PowerPlanRoleV01 = typeof POWER_PLAN_ROLES_V01[number];

export interface SystemTuningObservationV01 {
  readonly hardwareGpuScheduling: boolean | null;
  readonly powerPlanRole: PowerPlanRoleV01;
  readonly ovrAdvancedSettingsInstalled: boolean;
}

export interface RecentClientLogObservationV01 {
  readonly classification: ClientLogClassificationV01;
  readonly newestModifiedAt: string | null;
}

export interface LocalDiagnosticsSnapshotV01 {
  readonly schemaVersion: typeof LOCAL_DIAGNOSTICS_SCHEMA;
  readonly capturedAt: string;
  readonly clientRunning: boolean | null;
  readonly clientConfig: ClientConfigObservationV01;
  readonly clientCache: ClientCacheObservationV01;
  readonly osc: OscLocalObservationV01;
  readonly steamvrSettings: SteamVrSettingsObservationV01;
  readonly audioEndpoints: AudioEndpointObservationV01;
  readonly streamingSettings: StreamingSettingsObservationV01;
  readonly systemTuning: SystemTuningObservationV01;
  readonly recentClientLog: RecentClientLogObservationV01;
}

export interface LocalDiagnosticsResultV01 {
  readonly localDiagnostics: LocalDiagnosticsSnapshotV01;
}

export interface SymptomFindingV01 {
  readonly code: DiagnosticFindingCodeV01;
  readonly severity: "info" | "warning" | "attention";
  readonly layer: DiagnosticLayerV01;
}

export interface DiagnosticSopStepV01 {
  readonly stepId: string;
  readonly layer: DiagnosticLayerV01;
  readonly title: string;
  readonly instruction: string;
}

export interface SymptomDiagnosisV01 {
  readonly schemaVersion: typeof LOCAL_DIAGNOSTICS_SCHEMA;
  readonly symptom: SymptomIdV01;
  readonly capturedAt: string;
  readonly snapshot: LocalDiagnosticsSnapshotV01;
  readonly findings: readonly SymptomFindingV01[];
  readonly sopSteps: readonly DiagnosticSopStepV01[];
  readonly suggestedHelper: DiagnosticSuggestedHelperV01;
}

export interface SymptomDiagnosisResultV01 {
  readonly symptomDiagnosis: SymptomDiagnosisV01;
}

export interface OscCacheClearReceiptV01 {
  readonly schemaVersion: typeof LOCAL_DIAGNOSTICS_SCHEMA;
  readonly clearedAt: string;
  readonly removedFileCount: number;
  readonly freedBytes: number;
}

export interface OscCacheClearReceiptResultV01 {
  readonly oscCacheClearReceipt: OscCacheClearReceiptV01;
}

export interface ClientConfigUpdateParamsV01 {
  readonly schemaVersion: "0.1";
  readonly cacheSizeGb?: number;
  readonly cacheExpiryDelayDays?: number;
}

export interface ClientConfigUpdateReceiptV01 {
  readonly schemaVersion: typeof LOCAL_DIAGNOSTICS_SCHEMA;
  readonly updatedAt: string;
  readonly backupWritten: boolean;
  readonly cacheSizeGb: number | null;
  readonly cacheExpiryDelayDays: number | null;
}

export interface ClientConfigUpdateReceiptResultV01 {
  readonly clientConfigReceipt: ClientConfigUpdateReceiptV01;
}

export type LocalDiagnosticsGatewayRequestV1 =
  | { readonly schemaVersion: 1; readonly requestId: string; readonly method: "diagnostics.observeLocal"; readonly params: { readonly schemaVersion: "0.1" } }
  | { readonly schemaVersion: 1; readonly requestId: string; readonly method: "diagnostics.diagnoseSymptom"; readonly params: { readonly schemaVersion: "0.1"; readonly symptom: SymptomIdV01 } }
  | { readonly schemaVersion: 1; readonly requestId: string; readonly method: "diagnostics.clearOscAvatarCache"; readonly params: { readonly schemaVersion: "0.1"; readonly commandId: string } }
  | { readonly schemaVersion: 1; readonly requestId: string; readonly method: "diagnostics.updateClientConfig"; readonly params: ClientConfigUpdateParamsV01 & { readonly commandId: string } };

function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function exactKeys(v: unknown, expected: readonly string[]): v is Record<string, unknown> {
  return record(v) && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
}

function nonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function nullableNonNegInt(v: unknown): v is number | null {
  return v === null || nonNegInt(v);
}

function nullableNumber(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v));
}

function nonEmptyString(v: unknown, max = 256): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

export function isLocalDiagnosticsParams(method: string, params: unknown, gatewayIpc = false): boolean {
  if (!record(params) || params.schemaVersion !== "0.1") return false;
  switch (method) {
    case "diagnostics.observeLocal":
      return exactKeys(params, ["schemaVersion"]);
    case "diagnostics.diagnoseSymptom":
      return exactKeys(params, ["schemaVersion", "symptom"])
        && SYMPTOM_IDS_V01.includes(params.symptom as SymptomIdV01);
    case "diagnostics.clearOscAvatarCache":
      return gatewayIpc
        ? exactKeys(params, ["schemaVersion", "commandId"]) && isPlayCommandId(params.commandId)
        : exactKeys(params, ["schemaVersion"]);
    case "diagnostics.updateClientConfig": {
      const allowed = gatewayIpc
        ? ["schemaVersion", "commandId", "cacheSizeGb", "cacheExpiryDelayDays"]
        : ["schemaVersion", "cacheSizeGb", "cacheExpiryDelayDays"];
      const keys = Object.keys(params);
      if (keys.some(k => !allowed.includes(k))) return false;
      if (gatewayIpc && !isPlayCommandId(params.commandId)) return false;
      const hasSize = Object.hasOwn(params, "cacheSizeGb");
      const hasExpiry = Object.hasOwn(params, "cacheExpiryDelayDays");
      if (!hasSize && !hasExpiry) return false;
      if (hasSize && (!nonNegInt(params.cacheSizeGb) || params.cacheSizeGb < 30 || params.cacheSizeGb > 200)) return false;
      if (hasExpiry && (!nonNegInt(params.cacheExpiryDelayDays) || params.cacheExpiryDelayDays < 30 || params.cacheExpiryDelayDays > 365)) return false;
      return true;
    }
    default:
      return false;
  }
}

function isUdpPortObservation(v: unknown): v is UdpPortObservationV01 {
  if (!exactKeys(v, ["state", "ownerPid", "ownerProcess"])) return false;
  if (!["unbound", "bound", "probe_unavailable"].includes(String(v.state))) return false;
  if (v.state === "bound") {
    if (!nonNegInt(v.ownerPid)) return false;
    if (v.ownerProcess !== null && (!nonEmptyString(v.ownerProcess, 128) || /[\\/:]/u.test(v.ownerProcess))) return false;
    return true;
  }
  return v.ownerPid === null && v.ownerProcess === null;
}

function isPortNumber(v: unknown): v is number {
  return nonNegInt(v) && v >= 1 && v <= 65535;
}

function isOscQueryObservation(v: unknown): v is OscQueryLoopbackObservationV01 {
  if (!exactKeys(v, ["state", "httpPort", "advertisedOscPort", "ownerProcess"])) return false;
  if (!["found", "not_detected", "probe_unavailable"].includes(String(v.state))) return false;
  if (v.state === "found") {
    if (!isPortNumber(v.httpPort)) return false;
    if (v.advertisedOscPort !== null && !isPortNumber(v.advertisedOscPort)) return false;
    if (v.ownerProcess !== null && (!nonEmptyString(v.ownerProcess, 128) || /[\\/:]/u.test(v.ownerProcess))) return false;
    return true;
  }
  return v.httpPort === null && v.advertisedOscPort === null && v.ownerProcess === null;
}

export function isLocalDiagnosticsSnapshotV01(v: unknown): v is LocalDiagnosticsSnapshotV01 {
  if (!exactKeys(v, [
    "schemaVersion", "capturedAt", "clientRunning", "clientConfig",
    "clientCache", "osc", "steamvrSettings", "audioEndpoints", "streamingSettings", "systemTuning", "recentClientLog",
  ])) return false;
  if (v.schemaVersion !== LOCAL_DIAGNOSTICS_SCHEMA || !nonEmptyString(v.capturedAt, 64)) return false;
  if (v.clientRunning !== null && typeof v.clientRunning !== "boolean") return false;
  if (!exactKeys(v.clientConfig, [
    "presence", "cacheDirectoryCustom", "cacheSizeGb", "cacheExpiryDelayDays",
    "cameraResWidth", "cameraResHeight", "screenshotResWidth", "screenshotResHeight", "fpvSteadycamFov",
  ])) return false;
  const cfg = v.clientConfig;
  if (!["found", "missing", "malformed", "read_failed"].includes(String(cfg.presence))
    || typeof cfg.cacheDirectoryCustom !== "boolean"
    || !nullableNonNegInt(cfg.cacheSizeGb) || !nullableNonNegInt(cfg.cacheExpiryDelayDays)
    || !nullableNonNegInt(cfg.cameraResWidth) || !nullableNonNegInt(cfg.cameraResHeight)
    || !nullableNonNegInt(cfg.screenshotResWidth) || !nullableNonNegInt(cfg.screenshotResHeight)
    || !nullableNumber(cfg.fpvSteadycamFov)) return false;

  if (!exactKeys(v.clientCache, ["presence", "totalBytes", "truncated", "driveFreeBytes", "driveTotalBytes"])) return false;
  const cache = v.clientCache;
  if (!["found", "missing", "read_failed"].includes(String(cache.presence))
    || !nullableNonNegInt(cache.totalBytes) || typeof cache.truncated !== "boolean"
    || !nullableNonNegInt(cache.driveFreeBytes) || !nullableNonNegInt(cache.driveTotalBytes)) return false;

  if (!exactKeys(v.osc, ["avatarCachePresence", "avatarConfigCount", "avatarCacheBytes", "newestModifiedAt", "udp9000", "udp9001", "oscQuery"])) return false;
  const osc = v.osc;
  if (!["found", "missing", "read_failed"].includes(String(osc.avatarCachePresence))
    || !nonNegInt(osc.avatarConfigCount) || !nonNegInt(osc.avatarCacheBytes)
    || (osc.newestModifiedAt !== null && !nonEmptyString(osc.newestModifiedAt, 64))
    || !isUdpPortObservation(osc.udp9000) || !isUdpPortObservation(osc.udp9001)
    || !isOscQueryObservation(osc.oscQuery)) return false;

  if (!exactKeys(v.steamvrSettings, ["presence", "renderTargetMultiplier", "motionSmoothing", "vrchatResolutionScale", "safeModeEnabled", "blockedDrivers"])) return false;
  const svr = v.steamvrSettings;
  if (!["found", "missing", "malformed", "read_failed"].includes(String(svr.presence))
    || !nullableNumber(svr.renderTargetMultiplier)
    || (svr.motionSmoothing !== null && typeof svr.motionSmoothing !== "boolean")
    || !nullableNumber(svr.vrchatResolutionScale)
    || (svr.safeModeEnabled !== null && typeof svr.safeModeEnabled !== "boolean")
    || !Array.isArray(svr.blockedDrivers) || svr.blockedDrivers.length > 32
    || new Set(svr.blockedDrivers).size !== svr.blockedDrivers.length
    || !svr.blockedDrivers.every(d => nonEmptyString(d, 80) && !/[\\/:]/u.test(d))) return false;

  if (!exactKeys(v.audioEndpoints, ["state", "defaultCaptureRole", "virtualMicHijack", "communicationsMismatch"])) return false;
  const audio = v.audioEndpoints;
  if (!["observed", "probe_unavailable"].includes(String(audio.state))
    || !["vr_virtual", "physical_or_usb", "virtual_cable", "none", "unknown"].includes(String(audio.defaultCaptureRole))
    || !["none", "oculus_virtual", "steam_streaming", "pico_streaming", "virtual_desktop"].includes(String(audio.virtualMicHijack))
    || typeof audio.communicationsMismatch !== "boolean") return false;

  if (!exactKeys(v.streamingSettings, ["questLink", "picoConnect"])) return false;
  const ql = v.streamingSettings.questLink;
  const pico = v.streamingSettings.picoConnect;
  if (!exactKeys(ql, ["presence", "encodeResolutionWidth", "encodeBitrateMbps", "dynamicBitrate", "linkSharpening"])
    || !["found", "missing"].includes(String(ql.presence))
    || (ql.encodeResolutionWidth !== null && (!nonNegInt(ql.encodeResolutionWidth) || ql.encodeResolutionWidth < 1 || ql.encodeResolutionWidth > 16384))
    || (ql.encodeBitrateMbps !== null && (!nonNegInt(ql.encodeBitrateMbps) || ql.encodeBitrateMbps < 1 || ql.encodeBitrateMbps > 2000))
    || (ql.dynamicBitrate !== null && typeof ql.dynamicBitrate !== "boolean")
    || (ql.linkSharpening !== null && (!nonNegInt(ql.linkSharpening) || ql.linkSharpening > 10))) return false;
  if (!exactKeys(pico, ["presence", "preset", "bitrateMbps"])
    || !["found", "missing", "malformed", "read_failed"].includes(String(pico.presence))
    || (pico.preset !== null && !nonEmptyString(pico.preset, 32))
    || (pico.bitrateMbps !== null && (!nonNegInt(pico.bitrateMbps) || pico.bitrateMbps < 1 || pico.bitrateMbps > 2000))) return false;

  if (!exactKeys(v.systemTuning, ["hardwareGpuScheduling", "powerPlanRole", "ovrAdvancedSettingsInstalled"])) return false;
  const tuning = v.systemTuning;
  if ((tuning.hardwareGpuScheduling !== null && typeof tuning.hardwareGpuScheduling !== "boolean")
    || !POWER_PLAN_ROLES_V01.includes(tuning.powerPlanRole as PowerPlanRoleV01)
    || typeof tuning.ovrAdvancedSettingsInstalled !== "boolean") return false;

  if (!exactKeys(v.recentClientLog, ["classification", "newestModifiedAt"])) return false;
  const log = v.recentClientLog;
  return CLIENT_LOG_CLASSIFICATIONS_V01.includes(log.classification as ClientLogClassificationV01)
    && (log.newestModifiedAt === null || nonEmptyString(log.newestModifiedAt, 64));
}

export function isLocalDiagnosticsResultV01(v: unknown): v is LocalDiagnosticsResultV01 {
  return exactKeys(v, ["localDiagnostics"]) && isLocalDiagnosticsSnapshotV01(v.localDiagnostics);
}

export function isSymptomDiagnosisResultV01(v: unknown): v is SymptomDiagnosisResultV01 {
  if (!exactKeys(v, ["symptomDiagnosis"]) || !exactKeys(v.symptomDiagnosis, [
    "schemaVersion", "symptom", "capturedAt", "snapshot", "findings", "sopSteps", "suggestedHelper",
  ])) return false;
  const d = v.symptomDiagnosis;
  if (d.schemaVersion !== LOCAL_DIAGNOSTICS_SCHEMA
    || !SYMPTOM_IDS_V01.includes(d.symptom as SymptomIdV01)
    || !nonEmptyString(d.capturedAt, 64)
    || !isLocalDiagnosticsSnapshotV01(d.snapshot)
    || !DIAGNOSTIC_HELPERS_V01.includes(d.suggestedHelper as DiagnosticSuggestedHelperV01)
    || !Array.isArray(d.findings) || d.findings.length > 16
    || !Array.isArray(d.sopSteps) || d.sopSteps.length < 1 || d.sopSteps.length > 12) return false;
  return d.findings.every(f => exactKeys(f, ["code", "severity", "layer"])
      && DIAGNOSTIC_FINDING_CODES_V01.includes(f.code as DiagnosticFindingCodeV01)
      && ["info", "warning", "attention"].includes(String(f.severity))
      && DIAGNOSTIC_LAYERS_V01.includes(f.layer as DiagnosticLayerV01))
    && d.sopSteps.every(s => exactKeys(s, ["stepId", "layer", "title", "instruction"])
      && nonEmptyString(s.stepId, 80)
      && DIAGNOSTIC_LAYERS_V01.includes(s.layer as DiagnosticLayerV01)
      && nonEmptyString(s.title, 240)
      && nonEmptyString(s.instruction, 1000));
}

export function isOscCacheClearReceiptResultV01(v: unknown): v is OscCacheClearReceiptResultV01 {
  if (!exactKeys(v, ["oscCacheClearReceipt"]) || !exactKeys(v.oscCacheClearReceipt, [
    "schemaVersion", "clearedAt", "removedFileCount", "freedBytes",
  ])) return false;
  const r = v.oscCacheClearReceipt;
  return r.schemaVersion === LOCAL_DIAGNOSTICS_SCHEMA
    && nonEmptyString(r.clearedAt, 64)
    && nonNegInt(r.removedFileCount)
    && nonNegInt(r.freedBytes);
}

export function isClientConfigUpdateReceiptResultV01(v: unknown): v is ClientConfigUpdateReceiptResultV01 {
  if (!exactKeys(v, ["clientConfigReceipt"]) || !exactKeys(v.clientConfigReceipt, [
    "schemaVersion", "updatedAt", "backupWritten", "cacheSizeGb", "cacheExpiryDelayDays",
  ])) return false;
  const r = v.clientConfigReceipt;
  return r.schemaVersion === LOCAL_DIAGNOSTICS_SCHEMA
    && nonEmptyString(r.updatedAt, 64)
    && typeof r.backupWritten === "boolean"
    && (r.cacheSizeGb === null || (nonNegInt(r.cacheSizeGb) && r.cacheSizeGb >= 30 && r.cacheSizeGb <= 200))
    && (r.cacheExpiryDelayDays === null || (nonNegInt(r.cacheExpiryDelayDays) && r.cacheExpiryDelayDays >= 30 && r.cacheExpiryDelayDays <= 365));
}

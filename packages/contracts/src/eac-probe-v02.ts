/** Candidate EAC status detection and occupation recovery contract family v0.2. */
export const EAC_METHODS_SCHEMA = "0.2" as const;
export const EAC_PROBE_SCHEMA_V02 = "vua.eac-probe/v0.2" as const;
export const EAC_TERMINATE_SCHEMA_V01 = "vua.eac-terminate/v0.1" as const;
export const EAC_REPAIR_SCHEMA_V02 = "vua.eac-repair/v0.2" as const;

export const EAC_PROCESS_KINDS_V02 = [
  "eac_loader",
  "eac_service",
  "vrchat_game",
  "vrchat_launcher",
  "vrchat_overlay",
] as const;
export type EacProcessKindV02 = typeof EAC_PROCESS_KINDS_V02[number];

export const EAC_SERVICE_NAMES_V02 = ["EasyAntiCheat_EOS", "EasyAntiCheat_EOSSys"] as const;
export type EacServiceNameV02 = typeof EAC_SERVICE_NAMES_V02[number];

export const EAC_SERVICE_STATES_V02 = [
  "stopped",
  "start_pending",
  "stop_pending",
  "running",
  "other",
  "unreadable",
] as const;
export type EacServiceStateV02 = typeof EAC_SERVICE_STATES_V02[number];

export const EAC_FOLDER_STATES_V02 = ["present", "missing", "unknown"] as const;
export type EacFolderStateV02 = typeof EAC_FOLDER_STATES_V02[number];

export const EAC_BINARY_STATES_V02 = ["verified", "unverified", "missing", "unknown"] as const;
export type EacBinaryStateV02 = typeof EAC_BINARY_STATES_V02[number];

export const EAC_LOG_FINDING_CODES_V02 = [
  "launch_error_30005",
  "not_installed",
  "start_service_1275",
  "untrusted_system_file",
  "connection_lost",
] as const;
export type EacLogFindingCodeV02 = typeof EAC_LOG_FINDING_CODES_V02[number];

export const EAC_CONCLUSIONS_V02 = [
  "ready",
  "session_active",
  "unloading",
  "residual_process",
  "steam_stale",
  "not_installed",
  "install_damaged",
  "unknown",
] as const;
export type EacConclusionV02 = typeof EAC_CONCLUSIONS_V02[number];

export const EAC_RECOVERY_STEPS_V02 = [
  "wait_unload",
  "stop_vrchat",
  "quit_steam",
  "terminate_residual",
  "official_repair",
  "restart_pc",
] as const;
export type EacRecoveryStepIdV02 = typeof EAC_RECOVERY_STEPS_V02[number];

export const EAC_TERMINATION_STATES_V02 = ["unavailable", "disabled", "available"] as const;
export type EacTerminationStateV02 = typeof EAC_TERMINATION_STATES_V02[number];

export const EAC_TERMINATION_REASONS_V02 = [
  "allowlist_empty_no_machine_evidence",
  "no_allowlisted_candidate",
  "active_vrchat_session",
  "experimental_switch_disabled",
  "candidate_verified",
] as const;
export type EacTerminationReasonV02 = typeof EAC_TERMINATION_REASONS_V02[number];

export const EAC_REPAIR_OUTCOMES_V02 = [
  "launched",
  "already_running",
  "completed",
  "elevation_declined",
  "reparse_point_refused",
  "verification_failed",
  "active_session_refused",
  "not_found",
  "launch_failed",
  "timed_out",
] as const;
export type EacRepairOutcomeV02 = typeof EAC_REPAIR_OUTCOMES_V02[number];

export interface EacProcessFindingV02 {
  readonly name: string;
  readonly pid: number;
  readonly created: string | null;
  readonly kind: EacProcessKindV02;
  readonly path: string | null;
  readonly hasVisibleWindow: boolean;
}

export interface EacServiceFindingV02 {
  readonly name: EacServiceNameV02;
  readonly present: boolean;
  readonly state: EacServiceStateV02;
  readonly firstObservedAt: string | null;
}

export interface EacSteamStateV02 {
  readonly runningFlag: 0 | 1 | null;
}

export interface EacInstallStateV02 {
  readonly eacFolder: EacFolderStateV02;
  readonly setupSignature: EacBinaryStateV02;
  readonly serviceBinary: EacBinaryStateV02;
}

export interface EacLogFindingV02 {
  readonly code: EacLogFindingCodeV02;
  readonly observedAt: string | null;
}

export interface EacTerminationCandidateV02 {
  readonly name: string;
  readonly pid: number;
  readonly created: string;
  readonly path: string;
  readonly publisherEvidence: string;
  readonly allowlistReason: string;
}

export interface EacTerminationCapabilityV02 {
  readonly state: EacTerminationStateV02;
  readonly reason: EacTerminationReasonV02;
  readonly candidate: EacTerminationCandidateV02 | null;
}

export interface EacDiagnosticV02 {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly detail: string;
}

export interface EacLastRepairV02 {
  readonly outcome: EacRepairOutcomeV02;
  readonly exitCode: number | null;
  readonly updatedAt: string;
}

export interface EacProbeSnapshotV02 {
  readonly schemaVersion: typeof EAC_PROBE_SCHEMA_V02;
  readonly capturedAt: string;
  readonly processes: readonly EacProcessFindingV02[];
  readonly services: readonly [EacServiceFindingV02, EacServiceFindingV02];
  readonly steam: EacSteamStateV02;
  readonly install: EacInstallStateV02;
  readonly logFindings: readonly EacLogFindingV02[];
  readonly conclusion: EacConclusionV02;
  readonly guidanceCode: string;
  readonly plan: readonly EacRecoveryStepIdV02[];
  readonly terminationCapability: EacTerminationCapabilityV02;
  readonly lastRepair?: EacLastRepairV02 | null;
  readonly diagnostics: readonly EacDiagnosticV02[];
}

export interface EacInspectParamsV02 {
  readonly schemaVersion: typeof EAC_METHODS_SCHEMA;
}

export interface EacInspectResultV02 {
  readonly eacSnapshot: EacProbeSnapshotV02;
}

export interface EacTerminateParamsV02 {
  readonly schemaVersion: typeof EAC_METHODS_SCHEMA;
  readonly pid: number;
  readonly created: string;
  readonly path: string;
  readonly confirmed: true;
}

interface EacTerminationReceiptBaseV01 {
  readonly schemaVersion: typeof EAC_TERMINATE_SCHEMA_V01;
  readonly pid: number;
  readonly processName: string;
  readonly taskCorrelation: string;
  readonly verified: boolean;
  readonly preCheck: {
    readonly vrchatSessionActive: boolean;
    readonly eacPresent: boolean;
  };
}

export type EacTerminationReceiptV01 =
  | (EacTerminationReceiptBaseV01 & {
      readonly kind: "terminated";
      readonly terminatedAt: string;
      readonly exitConfirmed: boolean;
      readonly postCheck: { readonly pidGone: boolean };
    })
  | (EacTerminationReceiptBaseV01 & {
      readonly kind: "refused";
      readonly guard: "verification_not_verified" | "active_vrchat_session" | "process_unopenable";
      readonly detail: string;
    })
  | (EacTerminationReceiptBaseV01 & {
      readonly kind: "failed";
      readonly guard: "open_failed" | "terminate_failed" | "exit_timeout" | "postcheck_failed";
      readonly detail: string;
      readonly inspectRequired: true;
    });

export interface EacTerminateResultV02 {
  readonly termination: EacTerminationReceiptV01;
  readonly eacSnapshot: EacProbeSnapshotV02;
}

export interface EacRepairParamsV02 {
  readonly schemaVersion: typeof EAC_METHODS_SCHEMA;
  readonly confirmed: true;
}

export interface EacRepairReceiptV02 {
  readonly schemaVersion: typeof EAC_REPAIR_SCHEMA_V02;
  readonly outcome: EacRepairOutcomeV02;
  readonly exitCode: number | null;
}

export interface EacRepairResultV02 {
  readonly repair: EacRepairReceiptV02;
  readonly eacSnapshot: EacProbeSnapshotV02;
}

export interface EacExperimentalConfigResultV02 {
  readonly enabled: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function closed(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validPid(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 4294967295;
}

function validCreatedTicks(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,20}$/.test(value);
}

function validTimestamp(value: unknown): value is string {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function isEacCommandId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

export function isEacInspectParams(value: unknown): value is EacInspectParamsV02 {
  return closed(value, ["schemaVersion"]) && value.schemaVersion === EAC_METHODS_SCHEMA;
}

export function isEacTerminateParams(value: unknown): value is EacTerminateParamsV02 {
  return (
    closed(value, ["schemaVersion", "pid", "created", "path", "confirmed"]) &&
    value.schemaVersion === EAC_METHODS_SCHEMA &&
    validPid(value.pid) &&
    validCreatedTicks(value.created) &&
    nonEmptyString(value.path) &&
    value.confirmed === true
  );
}

export function isEacRepairParams(value: unknown): value is EacRepairParamsV02 {
  return (
    closed(value, ["schemaVersion", "confirmed"]) &&
    value.schemaVersion === EAC_METHODS_SCHEMA &&
    value.confirmed === true
  );
}

function isProcessFinding(value: unknown): value is EacProcessFindingV02 {
  return (
    closed(value, ["name", "pid", "created", "kind", "path", "hasVisibleWindow"]) &&
    nonEmptyString(value.name) &&
    validPid(value.pid) &&
    (value.created === null || validCreatedTicks(value.created)) &&
    typeof value.kind === "string" &&
    (EAC_PROCESS_KINDS_V02 as readonly string[]).includes(value.kind) &&
    (value.path === null || nonEmptyString(value.path)) &&
    typeof value.hasVisibleWindow === "boolean"
  );
}

function isServiceFinding(
  value: unknown,
  expectedName: EacServiceNameV02,
): value is EacServiceFindingV02 {
  if (
    !closed(value, ["name", "present", "state", "firstObservedAt"]) ||
    value.name !== expectedName ||
    typeof value.present !== "boolean" ||
    typeof value.state !== "string" ||
    !(EAC_SERVICE_STATES_V02 as readonly string[]).includes(value.state) ||
    (value.firstObservedAt !== null && !validTimestamp(value.firstObservedAt))
  ) {
    return false;
  }
  if (!value.present && value.firstObservedAt !== null) {
    return false;
  }
  return true;
}

function isTerminationCandidate(value: unknown): value is EacTerminationCandidateV02 {
  return (
    closed(value, ["name", "pid", "created", "path", "publisherEvidence", "allowlistReason"]) &&
    nonEmptyString(value.name) &&
    validPid(value.pid) &&
    validCreatedTicks(value.created) &&
    nonEmptyString(value.path) &&
    nonEmptyString(value.publisherEvidence) &&
    nonEmptyString(value.allowlistReason)
  );
}

function isTerminationCapability(value: unknown): value is EacTerminationCapabilityV02 {
  if (
    !closed(value, ["state", "reason", "candidate"]) ||
    typeof value.state !== "string" ||
    !(EAC_TERMINATION_STATES_V02 as readonly string[]).includes(value.state) ||
    typeof value.reason !== "string" ||
    !(EAC_TERMINATION_REASONS_V02 as readonly string[]).includes(value.reason)
  ) {
    return false;
  }
  if (value.state === "available") {
    return value.reason === "candidate_verified" && isTerminationCandidate(value.candidate);
  }
  if (value.state === "disabled") {
    return (
      value.reason === "experimental_switch_disabled" &&
      (value.candidate === null || isTerminationCandidate(value.candidate))
    );
  }
  return (
    value.candidate === null &&
    value.reason !== "candidate_verified" &&
    value.reason !== "experimental_switch_disabled"
  );
}

function validExitCodeInt32(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647;
}

function validRepairOutcomeAndExitCode(
  outcome: unknown,
  exitCode: unknown,
): outcome is EacRepairOutcomeV02 {
  if (typeof outcome !== "string" || !(EAC_REPAIR_OUTCOMES_V02 as readonly string[]).includes(outcome)) {
    return false;
  }
  return outcome === "completed" ? validExitCodeInt32(exitCode) : exitCode === null;
}

function isLastRepair(value: unknown): value is EacLastRepairV02 {
  return (
    closed(value, ["outcome", "exitCode", "updatedAt"]) &&
    validRepairOutcomeAndExitCode(value.outcome, value.exitCode) &&
    validTimestamp(value.updatedAt)
  );
}

const SNAPSHOT_BASE_KEYS = [
  "schemaVersion",
  "capturedAt",
  "processes",
  "services",
  "steam",
  "install",
  "logFindings",
  "conclusion",
  "guidanceCode",
  "plan",
  "terminationCapability",
  "diagnostics",
] as const;

export function isEacProbeSnapshotV02(value: unknown): value is EacProbeSnapshotV02 {
  const hasLastRepair = record(value) && Object.hasOwn(value, "lastRepair");
  if (!closed(value, hasLastRepair ? [...SNAPSHOT_BASE_KEYS, "lastRepair"] : SNAPSHOT_BASE_KEYS)) {
    return false;
  }
  if (hasLastRepair && value.lastRepair !== null && !isLastRepair(value.lastRepair)) {
    return false;
  }
  if (
    value.schemaVersion !== EAC_PROBE_SCHEMA_V02 ||
    !validTimestamp(value.capturedAt) ||
    !Array.isArray(value.processes) ||
    !value.processes.every(isProcessFinding) ||
    !Array.isArray(value.services) ||
    value.services.length !== 2 ||
    !isServiceFinding(value.services[0], "EasyAntiCheat_EOS") ||
    !isServiceFinding(value.services[1], "EasyAntiCheat_EOSSys") ||
    !closed(value.steam, ["runningFlag"]) ||
    (value.steam.runningFlag !== 0 &&
      value.steam.runningFlag !== 1 &&
      value.steam.runningFlag !== null) ||
    !closed(value.install, ["eacFolder", "setupSignature", "serviceBinary"]) ||
    !(EAC_FOLDER_STATES_V02 as readonly string[]).includes(String(value.install.eacFolder)) ||
    !(EAC_BINARY_STATES_V02 as readonly string[]).includes(String(value.install.setupSignature)) ||
    !(EAC_BINARY_STATES_V02 as readonly string[]).includes(String(value.install.serviceBinary)) ||
    !Array.isArray(value.logFindings) ||
    !value.logFindings.every(
      (item) =>
        closed(item, ["code", "observedAt"]) &&
        typeof item.code === "string" &&
        (EAC_LOG_FINDING_CODES_V02 as readonly string[]).includes(item.code) &&
        (item.observedAt === null || nonEmptyString(item.observedAt)),
    ) ||
    typeof value.conclusion !== "string" ||
    !(EAC_CONCLUSIONS_V02 as readonly string[]).includes(value.conclusion) ||
    typeof value.guidanceCode !== "string" ||
    !/^vua\.eac_probe\.[a-z0-9_]+$/.test(value.guidanceCode) ||
    !Array.isArray(value.plan) ||
    new Set(value.plan).size !== value.plan.length ||
    !value.plan.every(
      (step) => typeof step === "string" && (EAC_RECOVERY_STEPS_V02 as readonly string[]).includes(step),
    ) ||
    !isTerminationCapability(value.terminationCapability) ||
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every(
      (diag) =>
        closed(diag, ["code", "severity", "detail"]) &&
        typeof diag.code === "string" &&
        /^vua\.eac_probe\.[a-z0-9_]+$/.test(diag.code) &&
        (diag.severity === "info" || diag.severity === "warning" || diag.severity === "error") &&
        typeof diag.detail === "string",
    )
  ) {
    return false;
  }
  if (
    (value.conclusion === "ready" ||
      value.conclusion === "session_active" ||
      value.conclusion === "unknown") &&
    value.plan.length !== 0
  ) {
    return false;
  }
  if (value.conclusion === "session_active" && value.terminationCapability.state === "available") {
    return false;
  }
  if (
    value.plan.includes("terminate_residual") &&
    value.terminationCapability.state !== "available"
  ) {
    return false;
  }
  return true;
}

export function isEacInspectResult(value: unknown): value is EacInspectResultV02 {
  return closed(value, ["eacSnapshot"]) && isEacProbeSnapshotV02(value.eacSnapshot);
}

export function isEacTerminationReceiptV01(value: unknown): value is EacTerminationReceiptV01 {
  if (!record(value) || value.schemaVersion !== EAC_TERMINATE_SCHEMA_V01) {
    return false;
  }
  if (
    !validPid(value.pid) ||
    !nonEmptyString(value.processName) ||
    !nonEmptyString(value.taskCorrelation) ||
    typeof value.verified !== "boolean" ||
    !closed(value.preCheck, ["vrchatSessionActive", "eacPresent"]) ||
    typeof value.preCheck.vrchatSessionActive !== "boolean" ||
    typeof value.preCheck.eacPresent !== "boolean"
  ) {
    return false;
  }
  const baseKeys = ["schemaVersion", "kind", "pid", "processName", "taskCorrelation", "verified", "preCheck"];
  if (value.kind === "terminated") {
    return (
      closed(value, [...baseKeys, "terminatedAt", "exitConfirmed", "postCheck"]) &&
      nonEmptyString(value.terminatedAt) &&
      typeof value.exitConfirmed === "boolean" &&
      closed(value.postCheck, ["pidGone"]) &&
      typeof value.postCheck.pidGone === "boolean"
    );
  }
  if (value.kind === "refused") {
    return (
      closed(value, [...baseKeys, "guard", "detail"]) &&
      (value.guard === "verification_not_verified" ||
        value.guard === "active_vrchat_session" ||
        value.guard === "process_unopenable") &&
      nonEmptyString(value.detail)
    );
  }
  if (value.kind === "failed") {
    return (
      closed(value, [...baseKeys, "guard", "detail", "inspectRequired"]) &&
      (value.guard === "open_failed" ||
        value.guard === "terminate_failed" ||
        value.guard === "exit_timeout" ||
        value.guard === "postcheck_failed") &&
      nonEmptyString(value.detail) &&
      value.inspectRequired === true
    );
  }
  return false;
}

export function isEacTerminateResult(value: unknown): value is EacTerminateResultV02 {
  return (
    closed(value, ["termination", "eacSnapshot"]) &&
    isEacTerminationReceiptV01(value.termination) &&
    isEacProbeSnapshotV02(value.eacSnapshot)
  );
}

export function isEacRepairReceiptV02(value: unknown): value is EacRepairReceiptV02 {
  return (
    closed(value, ["schemaVersion", "outcome", "exitCode"]) &&
    value.schemaVersion === EAC_REPAIR_SCHEMA_V02 &&
    validRepairOutcomeAndExitCode(value.outcome, value.exitCode)
  );
}

export function isEacRepairResult(value: unknown): value is EacRepairResultV02 {
  return (
    closed(value, ["repair", "eacSnapshot"]) &&
    isEacRepairReceiptV02(value.repair) &&
    isEacProbeSnapshotV02(value.eacSnapshot)
  );
}

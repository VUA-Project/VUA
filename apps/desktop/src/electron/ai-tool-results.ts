/** MCP projections over existing Gateway facts. Full AMF records remain Resources. */
import { isAmfEditorCloseResult } from "@vua/contracts";
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const MCP_TASK_STATES = ["queued", "preparing", "running", "waiting_for_input", "paused", "succeeded", "succeeded_with_warnings", "failed", "cancelled"] as const;
export const isRunId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9-]{1,100}$/u.test(value);
export interface AiBuildIdentity { version: string; commit: string; dirty: boolean; builtAt: string }

/** Same arguments can succeed after contention or a temporary connection failure clears. */
export const MCP_RETRYABLE_CODES: Readonly<Record<string, boolean>> = {
  gateway_unavailable: true,
  too_many_requests: true,
  "vua.amf.unavailable": true,
  "vua.provider.not_accepting": true,
  "vua.amf_production.busy": true,
  connection_disabled: false,
  unsupported_tool_or_parameters: false,
  approval_not_found: false,
  approval_not_waiting: false,
  review_pending_requests_first: false,
  installation_plan_changed: false,
  assembly_plan_changed: false,
  texture_plan_changed: false,
  lighting_plan_changed: false,
  outfit_removal_plan_changed: false,
  material_or_editor_no_longer_available: false,
  recommendation_needs_player: false,
  result_too_large: false,
  request_failed: false,
  internal: false,
  invalid_request: false,
  unsupported_method: false,
};
const MESSAGES: Readonly<Record<string, string>> = {
  gateway_unavailable: "VUA's local Gateway is temporarily unavailable.",
  too_many_requests: "Four MCP reads are already in progress.",
  connection_disabled: "The external AI connection is disabled in VUA.",
  unsupported_tool_or_parameters: "The tool or its parameters do not match this VUA version's tool schema.",
  approval_not_found: "VUA has no retained approval with that ID.",
  approval_not_waiting: "This approval is no longer waiting for the player.",
  review_pending_requests_first: "Four requests are already waiting or dispatching in VUA.",
  installation_plan_changed: "The installation plan changed. Read a fresh plan before requesting approval.",
  assembly_plan_changed: "The assembly plan changed. Read a fresh plan before requesting approval.",
  texture_plan_changed: "The texture memory plan changed. Read a fresh texture plan before requesting approval.",
  lighting_plan_changed: "The lighting alignment plan changed. Read a fresh lighting plan before requesting approval.",
  outfit_removal_plan_changed: "The outfit removal plan changed. Read a fresh outfit removal plan before requesting approval.",
  material_or_editor_no_longer_available: "A selected material or Editor is no longer available.",
  recommendation_needs_player: "Several candidates need the player's choice before VUA can plan.",
  result_too_large: "The selected result exceeds the MCP response limit.",
};
export class AiToolFailure extends Error {
  constructor(readonly code: string, readonly publicMessage?: string, readonly retryable?: boolean) { super(code); }
}
/** Error details are prose only: remove local paths, URLs and credential-shaped values. */
export function safeErrorMessage(value: string, secrets: readonly string[] = []): string {
  let text = value;
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, "[credential]");
  text = text.replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/giu, "[credential]")
    .replace(/["']?\b(?:authorization|cookie|set-cookie)\b["']?\s*[:=][^\r\n]*/giu, "[credential]")
    .replace(/["']?\b(?:[\w-]*(?:token|password|passwd|secret|credential)|api[_-]?key)\b["']?\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, "[credential]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,})\b/gu, "[credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[credential]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/giu, "[url]")
    .replace(/(["'])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\r\n]*?\1/gu, "[path]")
    .replace(/(?:\b[A-Za-z]:[\\/]|\\\\)[^\r\n<>"']*/gu, "[path]")
    .replace(/(^|[\s(=])\/[^\r\n<>"']*/gu, "$1[path]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  return [...text].slice(0, 512).join("");
}
export function errorFields(error: unknown, secrets: readonly string[] = []) {
  const candidate = error instanceof AiToolFailure ? error.code : error instanceof Error ? error.message : "request_failed";
  const code = /^[a-z][a-z0-9_.-]{0,127}$/u.test(candidate) ? candidate : "request_failed";
  const detail = error instanceof AiToolFailure ? error.publicMessage : undefined;
  const fallback = typeof MESSAGES[code] === "string" ? MESSAGES[code] : "VUA could not complete this request. Read its current facts and recovery action.";
  const retryable = MCP_RETRYABLE_CODES[code] === true && (!(error instanceof AiToolFailure) || error.retryable !== false);
  return { error: code, message: safeErrorMessage(detail ?? fallback, secrets),
    ...(code === "vua.amf_production.project_open" ? {suggestedAction:"amf.production.closeEditor"} : {}),
    nextAction: code === "vua.amf_production.project_open" ? "Request vua_request_amf_close_editor and wait for player approval, then inspect its task before retrying production."
      : code === "vua.amf.unavailable" && !retryable ? "Ask the player to enable or repair the AMF module in VUA Settings → Modules, then retry."
      : code.includes("license") ? "Open VUA Settings → Accounts → Unity, activate a valid license in Hub, then reinspect retained AMF work."
      : code === "review_pending_requests_first" ? "Ask the player to decide waiting requests in VUA, or withdraw one with vua_withdraw_request."
      : retryable ? "Wait for the current work or connection to settle, then retry the same read or approval request."
      : "Read current capabilities and facts, then correct the request or follow the recovery shown in VUA.",
    mutationStarted: false, retryable };
}
const pick = (value: Record<string, unknown>, keys: readonly string[]) => Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]]));
const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(isRecord) : [];
const count = (value: unknown): number | null => Array.isArray(value) ? value.length : null;
const RUN_SUMMARY_REVISIONS = 5;
const prefabs = (value: unknown) => rows(value).map(prefab => ({ ...pick(prefab, ["path", "name", "isAvatar"]), humanoidBoneCount: count(prefab.humanoidBones) }));

export function runSummary(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const result = isRecord(value.result) ? value.result : null;
  const facts = result && isRecord(result.facts) ? result.facts : null;
  const sdk = facts && isRecord(facts.sdkReview) ? facts.sdkReview : null;
  const ft = facts && isRecord(facts.faceTracking) ? facts.faceTracking : null;
  const issues = sdk ? rows(sdk.issues) : [];
  // A line keeps up to 50 revisions; the summary names the newest and the Resource holds them all.
  return { ...pick(value, ["schemaVersion", "runId", "revision", "phase", "taskId", "createdAt", "completedAt", "selection", "optimizer", "error", "recovery", "progress", "usualDurations"]),
    ...(isAmfEditorCloseResult(value.editorClose) ? {editorClose:{...value.editorClose,detail:safeErrorMessage(value.editorClose.detail)}} : {}),
    ...(Array.isArray(value.revisions) ? { revisionCount: value.revisions.length, revisions: value.revisions.slice(0, RUN_SUMMARY_REVISIONS) } : {}),
    sources: rows(value.sources).map(source => pick(source, ["sourceId", "role", "itemName"])),
    stepCount: count(value.steps), steps: rows(value.steps).slice(-20).map(step => pick(step, ["key", "name", "state", "startedAt", "endedAt"])),
    prefabs: prefabs(value.prefabs),
    result: result ? { ...pick(result, ["officialSdkChecks", "visualReview", "packageVersions", "parameterBudget"]), diagnosticCount: count(result.diagnostics),
      facts: facts ? { ...pick(facts, ["avatarGlobalObjectId", "avatarName", "projectFingerprint", "observedSelection", "parameterBudget"]),
        prefabCount: count(facts.prefabs), previewCount: count(facts.previews),
        ...pick(facts, ["missingReferences", "hasMissingScripts", "sdkDescriptorRecognized", "sdkSignedIn", "officialSdkChecks", "visualReview"]),
        ...(ft ? { faceTracking: { ...pick(ft, ["state", "truncated"]), menuCount: count(ft.menus) } } : {}),
        instanceCount: count(facts.instances), missingShaderMaterialCount: count(facts.missingShaderMaterials),
        sdkReview: sdk ? { ...pick(sdk, ["state", "platform", "overall"]), issueCount: count(sdk.issues),
          issuesByLevel: Object.fromEntries([...new Set(issues.map(issue => String(issue.level)))].map(level => [level, issues.filter(issue => issue.level === level).length])),
          stats: rows(sdk.stats).map(stat => pick(stat, ["category", "rating"])) } : null } : null } : value.result };
}
export function releaseSummary(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return { ...pick(value, ["schemaVersion", "runId", "turntable", "editorOpen", "uploadEligibility"]), uploadCount: count(value.uploads),
    localTestCount: count(value.localTests), localTests: rows(value.localTests).slice(0, 3).map(test => pick(test, ["testId", "stage", "state", "startedAt", "endedAt", "reason", "sdkSignIn"])),
    uploads: rows(value.uploads).slice(0, 3).map(upload => pick(upload, ["uploadId", "stage", "state", "progress", "blueprintId", "avatarName", "startedAt", "endedAt", "reason", "firstUpload", "sdkSignIn"])) };
}
export function librarySummary(value: unknown, includeImages: boolean): unknown {
  if (!isRecord(value) || includeImages) return value;
  const product = (value: unknown) => isRecord(value) ? { ...value, imageUrls: Array.isArray(value.imageUrls) ? value.imageUrls.slice(0, 1) : value.imageUrls } : value;
  return { ...value, items: rows(value.items).map(item => ({ ...item, ...(item.kind === "product" ? { product: product(item.product) } : {}),
    ...(isRecord(item.sourceMatch) ? { sourceMatch: { ...item.sourceMatch, product: product(item.sourceMatch.product) } } : {}) })) };
}
export function managerAppsSummary(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.managerApps)) return value;
  const managerApps = value.managerApps;
  return {
    managerApps: {
      ...pick(managerApps, ["schemaVersion", "capturedAt"]),
      apps: rows(managerApps.apps).map(app => pick(app, ["component", "presence"])),
    },
  };
}
export function taskPage(value: unknown, limit = 20, states?: readonly unknown[]): Record<string, unknown> {
  const snapshot = isRecord(value) ? value : {};
  const time = (task: Record<string, unknown>) => Date.parse(String(task.updatedAt)) || 0;
  const tasks = rows(snapshot.tasks).filter(task => !states?.length || states.includes(task.state))
    .sort((a, b) => time(b) - time(a) || String(a.taskId).localeCompare(String(b.taskId)));
  return { ...pick(snapshot, ["contractVersion", "revision"]), tasks: tasks.slice(0, limit), total: tasks.length, hasMore: tasks.length > limit };
}
export function taskSummary(task: Record<string, unknown>) {
  const close = isAmfEditorCloseResult(task.result) || (isRecord(task.result) && task.result.schemaVersion === "0.1"
    && isRunId(task.result.runId) && task.result.outcome === "already_closed" && task.result.editorClosed === true);
  return { ...pick(task, ["contractVersion", "taskId", "revision", "state", "cancellationRequested", "recoveryDisposition", "updatedAt"]),
    ...(isRecord(task.error) ? { error: { code: task.error.code } } : {}),
    ...(isRecord(task.result) ? { result: pick(task.result, close
      ? ["schemaVersion", "runId", "outcome", "scenesSaved", "assetsSaved", "editorClosed", "reason"]
      : ["schemaVersion", "operation", "runId"]) } : {}) };
}
export interface TaskChange {
  started: boolean | null;
  committed: boolean | null;
  checked: boolean | null;
  recovery: "none" | "restored" | "restore_failed" | null;
  retrySafe: boolean | null;
}
/** A current run only witnesses its own last task. Later work cannot prove an older task's recovery. */
export function taskChange(task: Record<string, unknown>, run: Record<string, unknown> | null, queued = false): TaskChange {
  const success = task.state === "succeeded" || task.state === "succeeded_with_warnings";
  const failed = task.state === "failed";
  const knownState = MCP_TASK_STATES.includes(task.state as typeof MCP_TASK_STATES[number]);
  const current = run !== null && typeof task.taskId === "string" && run.taskId === task.taskId;
  const started = task.state === "queued" || queued ? false : ["preparing", "running", "waiting_for_input", "paused", "succeeded", "succeeded_with_warnings"].includes(String(task.state)) || current ? true : null;
  const recovery = current ? run.recovery === null ? "none" : run.recovery === "restored" ? "restored"
    : typeof run.recovery === "string" && run.recovery.startsWith("restore_failed:") ? "restore_failed" : null : null;
  const lastStep = current ? rows(run.steps).at(-1) : undefined;
  return { started, committed: success ? true : knownState ? false : null,
    checked: success && lastStep ? ["inspect", "reinspect"].includes(String(lastStep.key)) && lastStep.state === "succeeded" : null,
    recovery, retrySafe: failed ? started === false || recovery === "restored" ? true : started === true && recovery !== null ? false : null : knownState ? false : null };
}

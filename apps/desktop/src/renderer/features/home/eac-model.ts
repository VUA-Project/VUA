import type {
  EacProbeSnapshotV02,
  EacRecoveryStepIdV02,
  EacRepairOutcomeV02,
  GuideTargetV1,
} from "@vua/contracts";
import { toast } from "../../components/primitives/toast-store.ts";
import { format, type Strings } from "../../i18n/index.ts";

export const EAC_UNLOADING_LONG_MS = 5 * 60_000;
export const EAC_DIALOG_POLL_MS = 5_000;
const MAX_UNLOAD_REMINDER_TICKS = 180;

export interface EacInspectPort {
  inspect(): Promise<EacProbeSnapshotV02>;
}

let reminderTimer: ReturnType<typeof setInterval> | null = null;
let reminderTicks = 0;
let reminderInFlight = false;
const reminderStateListeners = new Set<() => void>();
const reminderSnapshotListeners = new Set<(snapshot: EacProbeSnapshotV02) => void>();

function emitReminderState(): void {
  for (const listener of reminderStateListeners) listener();
}

export function isUnloadReminderArmed(): boolean {
  return reminderTimer !== null;
}

export function disarmUnloadReminder(): void {
  if (reminderTimer === null) return;
  clearInterval(reminderTimer);
  reminderTimer = null;
  reminderTicks = 0;
  reminderInFlight = false;
  emitReminderState();
}

export function completeUnloadReminderWithToast(getReadyMessage: () => string): boolean {
  if (reminderTimer === null) return false;
  disarmUnloadReminder();
  toast(getReadyMessage(), "success");
  return true;
}

export function subscribeUnloadReminder(
  onStateChange: () => void,
  onSnapshot?: (snapshot: EacProbeSnapshotV02) => void,
): () => void {
  reminderStateListeners.add(onStateChange);
  if (onSnapshot) reminderSnapshotListeners.add(onSnapshot);
  return () => {
    reminderStateListeners.delete(onStateChange);
    if (onSnapshot) reminderSnapshotListeners.delete(onSnapshot);
  };
}

/**
 * Arms a lightweight 5-second background watcher that survives closing EacDialog and fires
 * a Tier-2 toast as soon as EAC finishes unloading (`conclusion === "ready"`).
 */
export function armUnloadReminder(
  port: EacInspectPort,
  getReadyMessage: () => string,
): void {
  if (reminderTimer !== null) return;
  reminderTicks = 0;
  reminderInFlight = false;
  reminderTimer = setInterval(() => {
    if (reminderInFlight) return;
    reminderTicks += 1;
    if (reminderTicks > MAX_UNLOAD_REMINDER_TICKS) {
      disarmUnloadReminder();
      return;
    }
    reminderInFlight = true;
    void port
      .inspect()
      .then((snap) => {
        for (const listener of reminderSnapshotListeners) listener(snap);
        if (snap.conclusion === "ready") {
          completeUnloadReminderWithToast(getReadyMessage);
        } else if (snap.conclusion !== "unloading") {
          disarmUnloadReminder();
        }
      })
      .catch(() => {
        /* Keep polling across transient read failures while armed. */
      })
      .finally(() => {
        reminderInFlight = false;
      });
  }, EAC_DIALOG_POLL_MS);
  emitReminderState();
}

export type EacGuideSectionId =
  | "eac-30005-occupied"
  | "eac-not-installed"
  | "eac-1275-driver-blocked"
  | "eac-untrusted-system-file"
  | "eac-connection-lost"
  | "eac-sdk-multi-instance";

export function unloadingElapsedMs(snapshot: EacProbeSnapshotV02, nowMs: number): number {
  let earliest: number | null = null;
  for (const service of snapshot.services) {
    if (service.firstObservedAt === null) continue;
    const parsed = Date.parse(service.firstObservedAt);
    if (!Number.isFinite(parsed)) continue;
    if (earliest === null || parsed < earliest) {
      earliest = parsed;
    }
  }
  if (earliest === null) return 0;
  return Math.max(0, nowMs - earliest);
}

export function isUnloadingLong(snapshot: EacProbeSnapshotV02, nowMs: number): boolean {
  return snapshot.conclusion === "unloading" && unloadingElapsedMs(snapshot, nowMs) >= EAC_UNLOADING_LONG_MS;
}

export function unloadingDisplayMinutes(snapshot: EacProbeSnapshotV02, nowMs: number): number {
  return Math.max(1, Math.floor(unloadingElapsedMs(snapshot, nowMs) / 60_000));
}

export function shouldShowInlineEacRow(snapshot: EacProbeSnapshotV02 | null): boolean {
  return (
    snapshot !== null
    && snapshot.conclusion !== "ready"
    && snapshot.conclusion !== "session_active"
  );
}

/**
 * Only actionable blocking EAC conclusions intercept Play launch with the "Launch anyway" prompt.
 * `ready`, `session_active`, and `unknown` (for example when SCM DACLs block binary path queries)
 * proceed without pre-launch modal interception.
 */
export function shouldPromptBeforeLaunch(snapshot: EacProbeSnapshotV02): boolean {
  switch (snapshot.conclusion) {
    case "unloading":
    case "residual_process":
    case "steam_stale":
    case "not_installed":
    case "install_damaged":
      return true;
    case "ready":
    case "session_active":
    case "unknown":
      return false;
  }
}

export function formatRepairOutcome(
  repair: { readonly outcome: EacRepairOutcomeV02; readonly exitCode: number | null },
  copy: Strings["eac"],
): string {
  switch (repair.outcome) {
    case "launched":
      return copy.repairConfirm.launched;
    case "already_running":
      return copy.repairConfirm.alreadyRunning;
    case "completed": {
      const code = repair.exitCode ?? 0;
      return code === 0
        ? format(copy.repairConfirm.completed, { code })
        : format(copy.repairConfirm.completedNonZero, { code });
    }
    case "elevation_declined":
      return copy.repairConfirm.declined;
    case "reparse_point_refused":
      return copy.repairConfirm.reparseRefused;
    case "active_session_refused":
      return copy.repairConfirm.activeRefused;
    default:
      return format(copy.repairConfirm.failed, { outcome: repair.outcome });
  }
}

export function eacConclusionHeadline(
  snapshot: EacProbeSnapshotV02,
  copy: Strings["eac"],
  nowMs: number,
  readyAfterWait = false,
): string {
  if (readyAfterWait && snapshot.conclusion === "ready") {
    return copy.conclusions.ready_after_wait;
  }
  if (snapshot.conclusion === "unloading") {
    if (isUnloadingLong(snapshot, nowMs)) {
      return copy.conclusions.unloading_long;
    }
    return format(copy.conclusions.unloading, {
      minutes: unloadingDisplayMinutes(snapshot, nowMs),
    });
  }
  return copy.conclusions[snapshot.conclusion];
}

export function eacEncyclopediaSection(snapshot: EacProbeSnapshotV02): EacGuideSectionId {
  for (const finding of snapshot.logFindings) {
    if (finding.code === "start_service_1275") return "eac-1275-driver-blocked";
    if (finding.code === "untrusted_system_file") return "eac-untrusted-system-file";
    if (finding.code === "connection_lost") return "eac-connection-lost";
  }
  switch (snapshot.conclusion) {
    case "not_installed":
    case "install_damaged":
      return "eac-not-installed";
    case "session_active":
      return "eac-sdk-multi-instance";
    case "unloading":
    case "residual_process":
    case "steam_stale":
      return "eac-30005-occupied";
    case "ready":
    case "unknown":
      return snapshot.logFindings.some((item) => item.code === "not_installed")
        ? "eac-not-installed"
        : "eac-30005-occupied";
  }
}

export function eacGuideTarget(snapshot: EacProbeSnapshotV02): GuideTargetV1 {
  return {
    topic: "guide-start",
    section: eacEncyclopediaSection(snapshot),
  };
}

export interface SelectedLadderStep {
  readonly current: EacRecoveryStepIdV02 | null;
  readonly index: number;
  readonly hasNext: boolean;
}

export function selectLadderStep(
  snapshot: EacProbeSnapshotV02,
  stepOffset: number,
  nowMs: number,
): SelectedLadderStep {
  const { plan } = snapshot;
  if (plan.length === 0) {
    return { current: null, index: 0, hasNext: false };
  }
  const baseIndex =
    stepOffset === 0 && isUnloadingLong(snapshot, nowMs)
      ? Math.max(0, plan.indexOf("restart_pc"))
      : stepOffset;
  const clamped = Math.min(Math.max(0, baseIndex), plan.length - 1);
  return {
    current: plan[clamped] ?? null,
    index: clamped,
    hasNext: clamped + 1 < plan.length,
  };
}

export function formatEvidenceTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

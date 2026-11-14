import { afterEach, describe, expect, it, vi } from "vitest";
import type { EacProbeSnapshotV02 } from "@vua/contracts";
import { dismissToast, toastSnapshot } from "../../components/primitives/toast-store.ts";
import { eacCopy } from "../../i18n/eac-copy.ts";
import {
  EAC_DIALOG_POLL_MS,
  armUnloadReminder,
  disarmUnloadReminder,
  eacConclusionHeadline,
  eacEncyclopediaSection,
  formatRepairOutcome,
  isUnloadReminderArmed,
  isUnloadingLong,
  selectLadderStep,
  shouldPromptBeforeLaunch,
  shouldShowInlineEacRow,
} from "./eac-model.ts";

afterEach(() => {
  disarmUnloadReminder();
  for (const item of toastSnapshot()) {
    dismissToast(item.id);
  }
  vi.useRealTimers();
});

const baseSnapshot: EacProbeSnapshotV02 = {
  schemaVersion: "vua.eac-probe/v0.2",
  capturedAt: "2026-11-14T10:02:00.000Z",
  processes: [],
  services: [
    { name: "EasyAntiCheat_EOS", present: true, state: "stopped", firstObservedAt: null },
    { name: "EasyAntiCheat_EOSSys", present: true, state: "stop_pending", firstObservedAt: "2026-11-14T10:00:00.000Z" },
  ],
  steam: { runningFlag: 0 },
  install: { eacFolder: "present", setupSignature: "verified", serviceBinary: "verified" },
  logFindings: [],
  conclusion: "unloading",
  guidanceCode: "vua.eac_probe.driver_unloading",
  plan: ["wait_unload", "restart_pc"],
  terminationCapability: {
    state: "unavailable",
    reason: "no_allowlisted_candidate",
    candidate: null,
  },
  diagnostics: [],
};

describe("eac-model view rules", () => {
  it("hides inline status when ready or session_active and shows it for actionable states", () => {
    expect(shouldShowInlineEacRow(null)).toBe(false);
    expect(shouldShowInlineEacRow({ ...baseSnapshot, conclusion: "ready", plan: [] })).toBe(false);
    expect(shouldShowInlineEacRow({ ...baseSnapshot, conclusion: "session_active", plan: [] })).toBe(false);
    expect(shouldShowInlineEacRow(baseSnapshot)).toBe(true);
    expect(shouldShowInlineEacRow({ ...baseSnapshot, conclusion: "not_installed", plan: ["official_repair"] })).toBe(true);
  });

  it("prompts before launch only on actionable blocking conclusions and skips unknown or session_active", () => {
    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "ready", plan: [] })).toBe(false);
    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "session_active", plan: [] })).toBe(false);
    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "unknown", plan: [] })).toBe(false);

    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "unloading" })).toBe(true);
    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "residual_process" })).toBe(true);
    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "steam_stale" })).toBe(true);
    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "not_installed" })).toBe(true);
    expect(shouldPromptBeforeLaunch({ ...baseSnapshot, conclusion: "install_damaged" })).toBe(true);
  });

  it("formats background repair outcomes including non-zero exit codes and reparse-point refusals", () => {
    expect(formatRepairOutcome({ outcome: "completed", exitCode: 0 }, eacCopy.en)).toBe(
      "Official EAC repair finished (exit code 0).",
    );
    expect(formatRepairOutcome({ outcome: "completed", exitCode: 1 }, eacCopy.en)).toContain(
      "exited with code 1",
    );
    expect(formatRepairOutcome({ outcome: "elevation_declined", exitCode: null }, eacCopy.en)).toBe(
      eacCopy.en.repairConfirm.declined,
    );
    expect(formatRepairOutcome({ outcome: "reparse_point_refused", exitCode: null }, eacCopy.en)).toBe(
      eacCopy.en.repairConfirm.reparseRefused,
    );
  });

  it("switches unloading headline and ladder focus to restart_pc after five minutes", () => {
    const twoMinNow = Date.parse("2026-11-14T10:02:15.000Z");
    expect(isUnloadingLong(baseSnapshot, twoMinNow)).toBe(false);
    expect(eacConclusionHeadline(baseSnapshot, eacCopy.en, twoMinNow)).toContain("2 min so far");
    expect(selectLadderStep(baseSnapshot, 0, twoMinNow)).toEqual({
      current: "wait_unload",
      index: 0,
      hasNext: true,
    });
    expect(selectLadderStep(baseSnapshot, 1, twoMinNow)).toEqual({
      current: "restart_pc",
      index: 1,
      hasNext: false,
    });

    const sixMinNow = Date.parse("2026-11-14T10:06:05.000Z");
    expect(isUnloadingLong(baseSnapshot, sixMinNow)).toBe(true);
    expect(eacConclusionHeadline(baseSnapshot, eacCopy.en, sixMinNow)).toBe(
      eacCopy.en.conclusions.unloading_long,
    );
    expect(selectLadderStep(baseSnapshot, 0, sixMinNow)).toEqual({
      current: "restart_pc",
      index: 1,
      hasNext: false,
    });
  });

  it("maps conclusions and log codes to the six guide-start encyclopedia sections", () => {
    expect(eacEncyclopediaSection(baseSnapshot)).toBe("eac-30005-occupied");
    expect(eacEncyclopediaSection({ ...baseSnapshot, conclusion: "not_installed" })).toBe("eac-not-installed");
    expect(eacEncyclopediaSection({ ...baseSnapshot, conclusion: "session_active" })).toBe("eac-sdk-multi-instance");
    expect(
      eacEncyclopediaSection({
        ...baseSnapshot,
        conclusion: "ready",
        logFindings: [{ code: "start_service_1275", observedAt: null }],
      }),
    ).toBe("eac-1275-driver-blocked");
    expect(
      eacEncyclopediaSection({
        ...baseSnapshot,
        conclusion: "ready",
        logFindings: [{ code: "untrusted_system_file", observedAt: null }],
      }),
    ).toBe("eac-untrusted-system-file");
    expect(
      eacEncyclopediaSection({
        ...baseSnapshot,
        conclusion: "ready",
        logFindings: [{ code: "connection_lost", observedAt: null }],
      }),
    ).toBe("eac-connection-lost");
  });

  it("keeps unload reminder polling without dialog open and fires ready toast on completion", async () => {
    vi.useFakeTimers();
    let pollCount = 0;
    const inspect = vi.fn(async (): Promise<EacProbeSnapshotV02> => {
      pollCount += 1;
      if (pollCount === 1) {
        return baseSnapshot;
      }
      return {
        ...baseSnapshot,
        conclusion: "ready",
        guidanceCode: "vua.eac_probe.ready",
        plan: [],
      };
    });

    expect(isUnloadReminderArmed()).toBe(false);
    armUnloadReminder({ inspect }, () => eacCopy.en.conclusions.ready_after_wait);
    expect(isUnloadReminderArmed()).toBe(true);

    // First 5s tick: still unloading -> stays armed, no toast yet.
    await vi.advanceTimersByTimeAsync(EAC_DIALOG_POLL_MS);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(isUnloadReminderArmed()).toBe(true);
    expect(toastSnapshot()).toEqual([]);

    // Second 5s tick: transitions to ready -> disarms and emits Tier-2 success toast.
    await vi.advanceTimersByTimeAsync(EAC_DIALOG_POLL_MS);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(isUnloadReminderArmed()).toBe(false);
    expect(toastSnapshot()).toEqual([
      expect.objectContaining({
        text: eacCopy.en.conclusions.ready_after_wait,
        tone: "success",
      }),
    ]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import {
  isClientConfigUpdateReceiptResultV01,
  isLocalDiagnosticsResultV01,
  isOscCacheClearReceiptResultV01,
  isSymptomDiagnosisResultV01,
  LOCAL_DIAGNOSTICS_SCHEMA,
  SYMPTOM_IDS_V01,
} from "./local-diagnostics-v01.js";

const vectors = JSON.parse(
  readFileSync(new URL("../../../schemas/local-diagnostics/v0.1/vectors.json", import.meta.url), "utf8"),
) as Record<"requests" | "snapshots", { name: string; valid: boolean; value: Record<string, unknown> }[]>;

describe("local-diagnostics v0.1 Candidate wire", () => {
  it("pins closed application requests and privacy-safe snapshots to shared vectors", () => {
    for (const v of vectors.requests) expect(isApplicationRequestV01(v.value), v.name).toBe(v.valid);
    for (const v of vectors.snapshots) expect(isLocalDiagnosticsResultV01(v.value), v.name).toBe(v.valid);
  });

  it("validates Desktop Gateway IPC requests and result envelopes", () => {
    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "r-1",
      method: "diagnostics.observeLocal",
      params: { schemaVersion: "0.1" },
    })).toBe(true);

    for (const symptom of SYMPTOM_IDS_V01) {
      expect(isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "r-2",
        method: "diagnostics.diagnoseSymptom",
        params: { schemaVersion: "0.1", symptom },
      })).toBe(true);
    }

    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "r-3",
      method: "diagnostics.clearOscAvatarCache",
      params: { schemaVersion: "0.1", commandId: "cmd-clear-1" },
    })).toBe(true);

    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "r-4",
      method: "diagnostics.updateClientConfig",
      params: { schemaVersion: "0.1", cacheSizeGb: 30, commandId: "cmd-cfg-1" },
    })).toBe(true);

    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "r-bad",
      method: "diagnostics.updateClientConfig",
      params: { schemaVersion: "0.1", commandId: "cmd-cfg-2" },
    })).toBe(false);

    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "r-below-min-size",
      method: "diagnostics.updateClientConfig",
      params: { schemaVersion: "0.1", cacheSizeGb: 10, commandId: "cmd-cfg-3" },
    })).toBe(false);

    expect(isDesktopGatewayRequestV1({
      schemaVersion: 1,
      requestId: "r-below-min-days",
      method: "diagnostics.updateClientConfig",
      params: { schemaVersion: "0.1", cacheExpiryDelayDays: 7, commandId: "cmd-cfg-4" },
    })).toBe(false);

    const validSnapshot = vectors.snapshots[0]!.value.localDiagnostics;
    expect(isSymptomDiagnosisResultV01({
      symptomDiagnosis: {
        schemaVersion: LOCAL_DIAGNOSTICS_SCHEMA,
        symptom: "osc_or_face_tracking_not_responding",
        capturedAt: "2026-11-14T00:00:00Z",
        snapshot: validSnapshot,
        findings: [{ code: "osc_avatar_cache_present", severity: "info", layer: "companion_osc" }],
        sopSteps: [{
          stepId: "check_osc_toggle",
          layer: "companion_osc",
          title: "Verify Action Menu OSC toggle",
          instruction: "Open the Radial Menu -> Options -> OSC -> Enabled.",
        }],
        suggestedHelper: "clear_osc_avatar_cache",
      },
    })).toBe(true);

    expect(isOscCacheClearReceiptResultV01({
      oscCacheClearReceipt: {
        schemaVersion: LOCAL_DIAGNOSTICS_SCHEMA,
        clearedAt: "2026-11-14T00:00:00Z",
        removedFileCount: 5,
        freedBytes: 20480,
      },
    })).toBe(true);

    expect(isClientConfigUpdateReceiptResultV01({
      clientConfigReceipt: {
        schemaVersion: LOCAL_DIAGNOSTICS_SCHEMA,
        updatedAt: "2026-11-14T00:00:00Z",
        backupWritten: true,
        cacheSizeGb: 30,
        cacheExpiryDelayDays: 60,
      },
    })).toBe(true);
  });
});

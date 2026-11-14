import { describe, expect, it, vi } from "vitest";
import { LOCAL_DIAGNOSTICS_SCHEMA, type LocalDiagnosticsSnapshotV01 } from "@vua/contracts";
import { createLiveLocalDiagnosticsPort } from "./local-diagnostics-port.ts";
import type { GatewayClient } from "./gateway-client.ts";

const sampleSnapshot: LocalDiagnosticsSnapshotV01 = {
  schemaVersion: LOCAL_DIAGNOSTICS_SCHEMA,
  capturedAt: "2026-11-14T02:00:00.000Z",
  clientRunning: false,
  clientConfig: {
    presence: "found",
    cacheDirectoryCustom: false,
    cacheSizeGb: 30,
    cacheExpiryDelayDays: 30,
    cameraResWidth: null,
    cameraResHeight: null,
    screenshotResWidth: null,
    screenshotResHeight: null,
    fpvSteadycamFov: null,
  },
  clientCache: {
    presence: "found",
    totalBytes: 1024,
    truncated: false,
    capturedAt: "2026-11-14T02:00:00.000Z",
    driveFreeBytes: 50_000_000_000,
    driveTotalBytes: 200_000_000_000,
  },
  osc: {
    avatarCachePresence: "found",
    avatarConfigCount: 3,
    avatarCacheBytes: 4096,
    newestModifiedAt: "2026-11-14T01:55:00.000Z",
    udp9000: { state: "unbound", ownerPid: null, ownerProcess: null },
    udp9001: { state: "unbound", ownerPid: null, ownerProcess: null },
    oscQuery: { state: "not_detected", httpPort: null, advertisedOscPort: null, ownerProcess: null },
  },
  steamvrSettings: {
    presence: "missing",
    renderTargetMultiplier: null,
    motionSmoothing: null,
    vrchatResolutionScale: null,
    safeModeEnabled: null,
    blockedDrivers: [],
  },
  audioEndpoints: {
    state: "observed",
    defaultCaptureRole: "physical_or_usb",
    virtualMicHijack: "none",
    communicationsMismatch: false,
  },
  streamingSettings: {
    questLink: {
      presence: "missing",
      encodeResolutionWidth: null,
      encodeBitrateMbps: null,
      dynamicBitrate: null,
      linkSharpening: null,
    },
    picoConnect: {
      presence: "missing",
      preset: null,
      bitrateMbps: null,
    },
  },
  systemTuning: {
    hardwareGpuScheduling: false,
    powerPlanRole: "balanced",
    ovrAdvancedSettingsInstalled: false,
  },
  recentClientLog: {
    classification: "clean_or_inconclusive",
    newestModifiedAt: null,
  },
};

describe("createLiveLocalDiagnosticsPort", () => {
  it("invokes observe, diagnose, clearOscAvatarCache and updateClientConfig with validated shapes", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { localDiagnostics: sampleSnapshot } })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          symptomDiagnosis: {
            schemaVersion: LOCAL_DIAGNOSTICS_SCHEMA,
            symptom: "osc_or_face_tracking_not_responding",
            capturedAt: sampleSnapshot.capturedAt,
            snapshot: sampleSnapshot,
            findings: [{ code: "osc_avatar_cache_present", severity: "info", layer: "companion_osc" }],
            sopSteps: [{ stepId: "osc-1", layer: "companion_osc", title: "Enable OSC", instruction: "Open Action Menu." }],
            suggestedHelper: "clear_osc_avatar_cache",
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          oscCacheClearReceipt: {
            schemaVersion: LOCAL_DIAGNOSTICS_SCHEMA,
            clearedAt: "2026-11-14T02:01:00.000Z",
            removedFileCount: 3,
            freedBytes: 4096,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          clientConfigReceipt: {
            schemaVersion: LOCAL_DIAGNOSTICS_SCHEMA,
            updatedAt: "2026-11-14T02:02:00.000Z",
            backupWritten: true,
            backupRelativePath: "LocalLow/VRChat/VRChat/config.json.vua.bak",
            cacheSizeGb: 45,
            cacheExpiryDelayDays: 60,
          },
        },
      });
    const client: GatewayClient = { invoke, subscribe: () => () => {} };
    const port = createLiveLocalDiagnosticsPort(client);

    const observed = await port.observe();
    expect(observed.osc.avatarConfigCount).toBe(3);

    const diag = await port.diagnose("osc_or_face_tracking_not_responding");
    expect(diag.suggestedHelper).toBe("clear_osc_avatar_cache");

    const cleared = await port.clearOscAvatarCache("cmd-osc-1");
    expect(cleared.removedFileCount).toBe(3);

    const updated = await port.updateClientConfig({ cacheSizeGb: 45, cacheExpiryDelayDays: 60 }, "cmd-cfg-1");
    expect(updated.cacheSizeGb).toBe(45);

    expect(invoke).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: "diagnostics.clearOscAvatarCache",
      params: { schemaVersion: "0.1", commandId: "cmd-osc-1" },
    }));
    expect(invoke).toHaveBeenNthCalledWith(4, expect.objectContaining({
      method: "diagnostics.updateClientConfig",
      params: { schemaVersion: "0.1", commandId: "cmd-cfg-1", cacheSizeGb: 45, cacheExpiryDelayDays: 60 },
    }));
  });

  it("propagates typed application error codes when VRChat is running", async () => {
    const client: GatewayClient = {
      invoke: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          kind: "application",
          error: {
            code: "vua.diagnostics.client_running",
            category: "conflict",
            messageKey: "errors.diagnostics.failed",
            params: {},
            retryable: false,
          },
        },
      }),
      subscribe: () => () => {},
    };
    const port = createLiveLocalDiagnosticsPort(client);
    await expect(port.clearOscAvatarCache("cmd-blocked")).rejects.toThrow("vua.diagnostics.client_running");
  });
});

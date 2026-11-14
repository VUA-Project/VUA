import { describe, expect, it } from "vitest";
import type { DesktopGatewaySuccessValueV1, EacProbeSnapshotV02 } from "@vua/contracts";
import { createLiveEacPort } from "./live-eac-port.ts";
import type { GatewayClient } from "./gateway-client.ts";

const readySnapshot: EacProbeSnapshotV02 = {
  schemaVersion: "vua.eac-probe/v0.2",
  capturedAt: "2026-11-14T10:00:00.000Z",
  processes: [],
  services: [
    { name: "EasyAntiCheat_EOS", present: true, state: "stopped", firstObservedAt: null },
    { name: "EasyAntiCheat_EOSSys", present: false, state: "stopped", firstObservedAt: null },
  ],
  steam: { runningFlag: 0 },
  install: { eacFolder: "present", setupSignature: "verified", serviceBinary: "verified" },
  logFindings: [],
  conclusion: "ready",
  guidanceCode: "vua.eac_probe.ready",
  plan: [],
  terminationCapability: {
    state: "unavailable",
    reason: "no_allowlisted_candidate",
    candidate: null,
  },
  diagnostics: [],
};

function makeClient(response: () => unknown, requests: unknown[] = []): GatewayClient {
  return {
    async invoke(request) {
      requests.push(request);
      return { ok: true, value: response() as DesktopGatewaySuccessValueV1 };
    },
    subscribe() {
      return () => {};
    },
  };
}

describe("live EAC port", () => {
  it("invokes environment.inspectEac with closed v0.2 parameters and validates the response", async () => {
    const requests: unknown[] = [];
    const port = createLiveEacPort(makeClient(() => ({ eacSnapshot: readySnapshot }), requests));
    const snapshot = await port.inspect();
    expect(snapshot.conclusion).toBe("ready");
    expect(requests[0]).toMatchObject({
      method: "environment.inspectEac",
      params: { schemaVersion: "0.2" },
    });
  });

  it("rejects malformed inspect responses instead of inventing a clean state", async () => {
    const port = createLiveEacPort(makeClient(() => ({ eacSnapshot: { conclusion: "ready" } })));
    await expect(port.inspect()).rejects.toThrow("eac_inspect_unavailable");
  });

  it("delegates openRepairFolder and experimental switch persistence to the Main host bridge", async () => {
    let stored = false;
    const port = createLiveEacPort(makeClient(() => ({ eacSnapshot: readySnapshot })), {
      eac: {
        openRepairFolder: () => Promise.resolve({ opened: true }),
        getExperimentalTermination: () => Promise.resolve({ enabled: stored }),
        setExperimentalTermination: (enabled: boolean) => {
          stored = enabled;
          return Promise.resolve({ enabled: stored });
        },
      },
    });
    expect(await port.openRepairFolder()).toEqual({ opened: true });
    expect(await port.getExperimentalTermination()).toEqual({ enabled: false });
    expect(await port.setExperimentalTermination(true)).toEqual({ enabled: true });
  });
});

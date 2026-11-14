import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EAC_CONCLUSIONS_V02,
  isEacInspectParams,
  isEacInspectResult,
  isEacProbeSnapshotV02,
  isEacRepairParams,
  isEacRepairReceiptV02,
  isEacRepairResult,
  isEacTerminateParams,
  isEacTerminateResult,
  isEacTerminationReceiptV01,
} from "./eac-probe-v02.js";
import { isApplicationRequestV01 } from "./application-contract.js";
import { DESKTOP_GATEWAY_METHOD_KINDS, isDesktopGatewayRequestV1 } from "./desktop-gateway.js";

const SCHEMA_ROOT = path.resolve(__dirname, "../../../schemas/eac-probe/v0.2");
const TERMINATE_FIXTURES_ROOT = path.resolve(
  __dirname,
  "../../../schemas/eac-terminate/v0.1/fixtures",
);

interface VectorEntry {
  readonly name: string;
  readonly kind: "inspectParams" | "terminateParams" | "repairParams" | "repairReceipt" | "snapshot";
  readonly valid: boolean;
  readonly value: unknown;
}

describe("eac-probe v0.2 contract fixtures and guards", () => {
  it("validates all eight conclusion snapshot fixtures", () => {
    const fixturesDir = path.join(SCHEMA_ROOT, "fixtures");
    const files = fs.readdirSync(fixturesDir).filter((file) => file.endsWith(".json"));
    expect(files.length).toBe(EAC_CONCLUSIONS_V02.length);

    const seenConclusions = new Set<string>();
    for (const file of files) {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"));
      expect(isEacProbeSnapshotV02(parsed), `fixture ${file} must pass guard`).toBe(true);
      expect(isEacInspectResult({ eacSnapshot: parsed })).toBe(true);
      if (isEacProbeSnapshotV02(parsed)) {
        seenConclusions.add(parsed.conclusion);
      }
    }
    expect([...seenConclusions].sort()).toEqual([...EAC_CONCLUSIONS_V02].sort());
  });

  it("matches every positive and negative vector in schemas/eac-probe/v0.2/vectors.json", () => {
    const vectors = JSON.parse(
      fs.readFileSync(path.join(SCHEMA_ROOT, "vectors.json"), "utf8"),
    ) as readonly VectorEntry[];
    expect(vectors.length).toBeGreaterThan(0);

    for (const vector of vectors) {
      const actual =
        vector.kind === "inspectParams"
          ? isEacInspectParams(vector.value)
          : vector.kind === "terminateParams"
            ? isEacTerminateParams(vector.value)
            : vector.kind === "repairParams"
              ? isEacRepairParams(vector.value)
              : vector.kind === "repairReceipt"
                ? isEacRepairReceiptV02(vector.value)
                : isEacProbeSnapshotV02(vector.value);
      expect(actual, vector.name).toBe(vector.valid);
    }
  });

  it("validates frozen v0.1 termination receipt fixtures alongside v0.2 snapshots", () => {
    const readySnapshot: unknown = JSON.parse(
      fs.readFileSync(path.join(SCHEMA_ROOT, "fixtures/snapshot.ready.json"), "utf8"),
    );
    for (const file of ["termination.terminated.json", "termination.refused.json"]) {
      const receipt: unknown = JSON.parse(
        fs.readFileSync(path.join(TERMINATE_FIXTURES_ROOT, file), "utf8"),
      );
      expect(isEacTerminationReceiptV01(receipt), file).toBe(true);
      expect(isEacTerminateResult({ termination: receipt, eacSnapshot: readySnapshot })).toBe(true);
    }
    expect(
      isEacRepairResult({
        repair: { schemaVersion: "vua.eac-repair/v0.2", outcome: "completed", exitCode: 0 },
        eacSnapshot: readySnapshot,
      }),
    ).toBe(true);
    expect(
      isEacRepairResult({
        repair: { schemaVersion: "vua.eac-repair/v0.2", outcome: "launched", exitCode: null },
        eacSnapshot: readySnapshot,
      }),
    ).toBe(true);
    expect(
      isEacRepairResult({
        repair: { schemaVersion: "vua.eac-repair/v0.2", outcome: "already_running", exitCode: null },
        eacSnapshot: readySnapshot,
      }),
    ).toBe(true);
  });

  it("rejects terminate_residual in plan when capability is disabled or unavailable", () => {
    const residualSnapshot = JSON.parse(
      fs.readFileSync(path.join(SCHEMA_ROOT, "fixtures/snapshot.residual-process.json"), "utf8"),
    ) as Record<string, unknown>;
    const mismatched = {
      ...residualSnapshot,
      terminationCapability: {
        state: "disabled",
        reason: "experimental_switch_disabled",
        candidate: null,
      },
    };
    expect(isEacProbeSnapshotV02(mismatched)).toBe(false);
  });

  it("registers Gateway and Application envelopes while keeping experimental sync host-only", () => {
    expect(DESKTOP_GATEWAY_METHOD_KINDS["environment.inspectEac"]).toBe("query");
    expect(DESKTOP_GATEWAY_METHOD_KINDS["environment.terminateEacResidual"]).toBe("command");
    expect(DESKTOP_GATEWAY_METHOD_KINDS["environment.launchEacRepair"]).toBe("command");

    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-eac-1",
        method: "environment.inspectEac",
        params: { schemaVersion: "0.2" },
      }),
    ).toBe(true);
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-eac-1",
        method: "environment.inspectEac",
        params: { schemaVersion: "0.2", experimentalTerminationEnabled: true },
      }),
    ).toBe(false);
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-eac-term",
        method: "environment.terminateEacResidual",
        params: {
          schemaVersion: "0.2",
          pid: 14200,
          created: "134075820000000000",
          path: "D:\\SteamLibrary\\steamapps\\common\\VRChat\\start_protected_game.exe",
          confirmed: true,
          commandId: "cmd-eac-1",
        },
      }),
    ).toBe(true);
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-eac-repair",
        method: "environment.launchEacRepair",
        params: {
          schemaVersion: "0.2",
          confirmed: true,
          commandId: "cmd-eac-repair-1",
        },
      }),
    ).toBe(true);

    // Host-only internal command: valid in ApplicationRequestV01, rejected in DesktopGatewayRequestV1.
    expect(
      isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-eac-sync",
        method: "environment.configureEacExperimental",
        params: { enabled: true, commandId: "cmd-sync-1" },
      }),
    ).toBe(false);
    expect(
      isApplicationRequestV01({
        contractVersion: "0.1",
        requestId: "req-eac-sync",
        correlationId: "req-eac-sync",
        kind: "command",
        commandId: "cmd-sync-1",
        method: "environment.configureEacExperimental",
        params: { enabled: true },
      }),
    ).toBe(true);
  });
});

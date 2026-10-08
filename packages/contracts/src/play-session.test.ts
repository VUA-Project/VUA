import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isPlaySessionResult } from "./play-session.js";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isManagerAppsResult } from "./manager-apps.js";
const vectors = JSON.parse(readFileSync(new URL("../../../schemas/play-session/v0.1/vectors.json", import.meta.url), "utf8")) as Record<"requests" | "results", { valid: boolean; value: Record<string, unknown> }[]>;
describe("closed play-session wire", () => {
  it("pins application requests to the shared schema vectors", () => { for (const vector of vectors.requests) expect(isApplicationRequestV01(vector.value)).toBe(vector.valid); });
  it("pins observed results to the same vectors", () => { for (const vector of vectors.results) expect(isPlaySessionResult(vector.value)).toBe(vector.valid); });
  it("accepts only route IDs at the renderer boundary", () => {
    const request = { schemaVersion: 1, requestId: "play", method: "environment.startPlay", params: { route: "pico_pcvr", commandId: "start-1" } };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    for (const extra of [{ exe: "cmd.exe" }, { args: ["/c"] }, { route: "quest" }, { commandId: "bad command" }]) expect(isDesktopGatewayRequestV1({ ...request, params: { ...request.params, ...extra } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, method: "environment.observePlay" })).toBe(false);
    const application = { contractVersion: "0.1", requestId: "play", correlationId: "play", kind: "command", method: ["environment.startPlay"], commandId: "start-1", params: { route: "pico_pcvr" } };
    expect(isApplicationRequestV01(application)).toBe(false);
  });
  it("rejects coercible state/IDs and unobserved ownership", () => {
    const value = structuredClone(vectors.results[0]!.value) as { playSession: Record<string, unknown> };
    expect(isPlaySessionResult({ playSession: { ...value.playSession, state: ["idle"] } })).toBe(false);
    const software = value.playSession.software as Record<string, unknown>[];
    software[0] = { ...software[0], component: ["steam"] }; expect(isPlaySessionResult(value)).toBe(false);
  });
  it("requires one actual finding for every manager application", () => {
    const managerApps = { schemaVersion: "vua.manager-apps/v0.1", capturedAt: "2026-10-09", apps: ["unity_hub", "vcc", "alcom"].map(component => ({ component, presence: "not_found", path: null })) };
    expect(isManagerAppsResult({ managerApps })).toBe(true);
    expect(isManagerAppsResult({ managerApps: { ...managerApps, apps: managerApps.apps.map(a => ({ ...a, presence: "found" })) } })).toBe(false);
    expect(isManagerAppsResult({ managerApps: { ...managerApps, apps: [managerApps.apps[0], managerApps.apps[0], managerApps.apps[2]] } })).toBe(false);
    expect(isManagerAppsResult({ managerApps: { ...managerApps, apps: managerApps.apps.map(a => ({ ...a, presence: ["not_found"] })) } })).toBe(false);
  });
});

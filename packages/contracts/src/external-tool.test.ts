import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isExternalToolResult } from "./external-tool.js";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
const vectors = JSON.parse(readFileSync(new URL("../../../schemas/external-tool/v0.1/vectors.json", import.meta.url), "utf8")) as Record<"requests" | "results", { name: string; valid: boolean; value: Record<string, unknown> }[]>;
describe("external-tool Candidate wire", () => {
  it("pins closed application requests and observed facts to shared vectors", () => {
    for (const v of vectors.requests) expect(isApplicationRequestV01(v.value), v.name).toBe(v.valid);
    for (const v of vectors.results) expect(isExternalToolResult(v.value), v.name).toBe(v.valid);
  });
  it("allows a fixed tool/action at IPC, rejecting arbitrary executable or app IDs", () => {
    const request = { schemaVersion: 1, requestId: "tool", method: "tools.actConnection", params: { toolId: "vrcft", action: "start", commandId: "one-click" } };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    for (const extra of [{ executable: "cmd.exe" }, { appId: "1" }, { action: "kill" }, { toolId: "custom" }, { commandId: "bad command" }]) expect(isDesktopGatewayRequestV1({ ...request, params: { ...request.params, ...extra } })).toBe(false);
    expect(isDesktopGatewayRequestV1({ ...request, method: "tools.observeConnection" })).toBe(false);
  });
});

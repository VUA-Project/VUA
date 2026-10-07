import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isNetworkIntent, isNetworkResult } from "./environment-network.js";

const vectors = JSON.parse(readFileSync(new URL("../../../schemas/environment-network/v0.1/vectors.json", import.meta.url), "utf8")) as { name: string; kind: string; valid: boolean; value: unknown }[];
describe("network v0.1 boundary", () => {
  for (const vector of vectors) it(vector.name, () => {
    expect(vector.kind === "intent" ? isNetworkIntent(vector.value) : isNetworkResult({ networkReport: vector.value })).toBe(vector.valid);
    if (vector.kind !== "intent") return;
    const request = { requestId: "network-check", method: "environment.checkNetwork", params: { intent: vector.value } };
    expect(isDesktopGatewayRequestV1({ ...request, schemaVersion: 1 })).toBe(vector.valid);
    expect(isApplicationRequestV01({ ...request, contractVersion: "0.1", kind: "query", correlationId: "network-check" })).toBe(vector.valid);
  });
  it("rejects a command or an extra outer parameter", () => {
    const base = { contractVersion: "0.1", requestId: "n", correlationId: "n", method: "environment.checkNetwork", params: { intent: { route: "desktop_play", region: "auto" } } };
    expect(isApplicationRequestV01({ ...base, kind: "command", commandId: "n" })).toBe(false);
    expect(isApplicationRequestV01({ ...base, kind: "query", params: { ...base.params, cookie: "private" } })).toBe(false);
  });
});

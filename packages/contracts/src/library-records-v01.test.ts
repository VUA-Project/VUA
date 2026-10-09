import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isLibraryRemoveLocalEntriesV01 } from "./library-records-v01.js";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
describe("local import record removal", () => {
  it("accepts the published command across both Gateway faces", () => {
    const v = JSON.parse(readFileSync(new URL("../../../schemas/library-records/v0.1/examples/remove.request.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(isApplicationRequestV01(v)).toBe(true);
    expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "remove-local", method: v.method, params: { ...(v.params as object), commandId: v.commandId } })).toBe(true);
  });
  it("rejects empty, duplicate, foreign or open record shapes", () => {
    for (const entryIds of [[], ["whi-a", "whi-a"], ["../outside"], ["whi-a", null]]) expect(isLibraryRemoveLocalEntriesV01({ schemaVersion: "0.1", entryIds })).toBe(false);
    expect(isLibraryRemoveLocalEntriesV01({ schemaVersion: "0.1", entryIds: ["whi-a"], removeFiles: true })).toBe(false);
  });
});

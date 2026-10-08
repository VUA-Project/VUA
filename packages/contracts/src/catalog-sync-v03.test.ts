import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isCatalogSyncParamsV03, isCatalogSyncPageResultV03, isCatalogSyncSnapshotV03 } from "./catalog-sync-v03.js";

const vector = (name: string) => JSON.parse(readFileSync(resolve(__dirname, "../../../schemas/catalog-sync/v0.3/examples", name), "utf8"));
describe("catalog sync v0.3 vocabulary", () => {
  it.each(["begin.request.json", "page.request.json", "finish.request.json", "failed.request.json", "status.request.json"])("accepts %s through the application envelope", (name) => {
    const request = vector(name);
    const base = { contractVersion: "0.1", requestId: "synthetic-request", correlationId: "synthetic-correlation", ...request };
    expect(isCatalogSyncParamsV03(request.method, request.params)).toBe(true);
    expect(isApplicationRequestV01(request.method === "catalog.librarySyncStatus" ? { ...base, kind: "query" } : { ...base, kind: "command", commandId: "synthetic-command" })).toBe(true);
  });
  it.each(["invalid-session.request.json", "invalid-page.request.json", "invalid-finish.request.json"])("rejects %s", (name) => {
    const request = vector(name);
    expect(isCatalogSyncParamsV03(request.method, request.params)).toBe(false);
  });
  it("requires complete, integer-valued page receipts", () => {
    expect(isCatalogSyncPageResultV03(vector("page.response.json"))).toBe(true);
    expect(isCatalogSyncPageResultV03(vector("invalid-page.response.json"))).toBe(false);
    expect(isCatalogSyncPageResultV03({ ...vector("page.response.json"), parsedCount: 0.5 })).toBe(false);
  });
  it("accepts persisted progress on the narrow desktop query and rejects session-shaped fields", () => {
    expect(isCatalogSyncSnapshotV03(vector("snapshot.response.json"))).toBe(true);
    const request = { schemaVersion: 1, requestId: "synthetic-status", ...vector("status.request.json") };
    expect(isDesktopGatewayRequestV1(request)).toBe(true);
    expect(isDesktopGatewayRequestV1({ ...request, params: { ...request.params, cookies: "synthetic" } })).toBe(false);
  });
});

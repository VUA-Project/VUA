import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isLibraryDownloadParamsV01, isLibraryDownloadSnapshotV01 } from "./library-download-v01.js";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
const vector = (name: string): any => JSON.parse(fs.readFileSync(path.join(__dirname, "../../../schemas/library-download/v0.1/examples", name), "utf8"));
describe("library-download v0.1 consumers", () => {
  it.each(["begin.request.json", "settled.request.json", "initiation-failed.request.json", "status.request.json"])("accepts shared vector %s", (name) => {
    const v = vector(name); expect(isLibraryDownloadParamsV01(v.method, v.params)).toBe(true);
    const query = v.method === "library.downloadStatus";
    expect(isApplicationRequestV01({ contractVersion: "0.1", requestId: "request", correlationId: "correlation", kind: query ? "query" : "command", ...(query ? {} : { commandId: "command" }), ...v })).toBe(true);
  });
  it.each(["invalid-session.request.json", "invalid-duplicate.request.json", "invalid-unbound.request.json"])("refuses shared vector %s", (name) => { const v = vector(name); expect(isLibraryDownloadParamsV01(v.method, v.params)).toBe(false); });
  it("checks snapshot and stored copy evidence", () => { expect(isLibraryDownloadSnapshotV01(vector("snapshot.response.json"))).toBe(true); expect(isLibraryDownloadSnapshotV01(vector("invalid-stored.response.json"))).toBe(false); });
  it("exposes the query through the typed gateway and refuses private fields", () => {
    const v = vector("status.request.json"); expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "request", ...v })).toBe(true);
    expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "request", ...v, params: { ...v.params, stagingPath: "synthetic" } })).toBe(false);
  });
  it("refuses foreign or duplicate replacement targets", () => {
    const v = vector("begin.request.json");
    for (const targets of [[{ downloadableId: 999, copyId: "copy" }], [{ downloadableId: 901, copyId: "a" }, { downloadableId: 901, copyId: "b" }]]) expect(isLibraryDownloadParamsV01(v.method, { ...v.params, replacementTargets: targets })).toBe(false);
  });
});

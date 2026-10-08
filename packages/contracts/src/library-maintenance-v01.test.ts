import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1, DESKTOP_GATEWAY_METHOD_KINDS } from "./desktop-gateway.js";
import { isLibraryMaintenanceParamsV01, isLibraryRemovalPreviewV01, isLibraryRemovalSnapshotV01 } from "./library-maintenance-v01.js";
const vector = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`../../../schemas/library-maintenance/v0.1/examples/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
describe("library maintenance consumers", () => {
  for (const name of ["preview.request", "remove.request", "status.request", "invalid-null.request", "invalid-empty.request", "invalid-duplicate.request", "invalid-path.request"]) {
    it(name, () => {
      const request = vector(name); const valid = !name.startsWith("invalid"); const kind = request.method === "library.removeFiles" ? "command" : "query";
      expect(isLibraryMaintenanceParamsV01(String(request.method), request.params)).toBe(valid);
      expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "synthetic", ...request })).toBe(valid);
      expect(isApplicationRequestV01({ contractVersion: "0.1", requestId: "synthetic", correlationId: "synthetic", kind, ...(kind === "command" ? { commandId: "synthetic" } : {}), ...request })).toBe(valid);
      expect(DESKTOP_GATEWAY_METHOD_KINDS[request.method as "library.removeFiles"]).toBe(kind);
    });
  }
  it("validates reference preview, partial finality and inspect-required recovery", () => {
    expect(isLibraryRemovalPreviewV01(vector("preview.response"))).toBe(true);
    expect(isLibraryRemovalSnapshotV01(vector("status.response"))).toBe(true);
    expect(isLibraryRemovalSnapshotV01(vector("recovered.response"))).toBe(true);
    expect(isLibraryRemovalPreviewV01(vector("invalid-path.response"))).toBe(false);
    expect(isLibraryRemovalSnapshotV01(vector("invalid-finality.response"))).toBe(false);
    expect(isLibraryRemovalSnapshotV01(vector("invalid-result.response"))).toBe(false);
    const duplicate = vector("preview.response"); (duplicate.files as unknown[]).push((duplicate.files as unknown[])[0]);
    expect(isLibraryRemovalPreviewV01(duplicate)).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1, DESKTOP_GATEWAY_METHOD_KINDS } from "./desktop-gateway.js";
import { isLibraryListV01, isLibraryProductFilesV01, isLibraryViewParamsV01 } from "./library-view-v01.js";
const vector = (name: string): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../schemas/library-view/v0.1/examples/${name}.json`, import.meta.url)), "utf8")) as Record<string, unknown>;
describe("library-view v0.1 consumers", () => {
  for (const name of ["list.request", "files.request", "invalid-session.request", "invalid-limit.request"]) {
    it(name, () => {
      const request = vector(name); const valid = !name.startsWith("invalid");
      expect(isLibraryViewParamsV01(String(request.method), request.params)).toBe(valid);
      expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "request-synthetic", ...request })).toBe(valid);
      expect(isApplicationRequestV01({ contractVersion: "0.1", requestId: "request-synthetic", correlationId: "synthetic", kind: "query", ...request })).toBe(valid);
      expect(DESKTOP_GATEWAY_METHOD_KINDS[String(request.method) as "library.list" | "library.productFiles"]).toBe("query");
    });
  }
  it("accepts actual multi-source and physical-copy evidence without paths", () => {
    expect(isLibraryListV01(vector("list.response"))).toBe(true);
    expect(isLibraryProductFilesV01(vector("files.response"))).toBe(true);
    expect(isLibraryProductFilesV01(vector("invalid-path.response"))).toBe(false);
  });
  it("rejects inflated counts and unbound managed targets", () => {
    const list = vector("list.response"); const rows = list.items as Record<string, unknown>[];
    (rows[0]?.storage as Record<string, unknown>).presentCopies = 2;
    expect(isLibraryListV01(list)).toBe(false);
    const misleading = vector("list.response");
    ((misleading.items as Record<string, unknown>[])[0]?.storage as Record<string, unknown>).state = "missing";
    expect(isLibraryListV01(misleading)).toBe(false);
    const files = vector("files.response"); (files.items as Record<string, unknown>[])[0]!.managedCopyId = "cpy-not-listed";
    expect(isLibraryProductFilesV01(files)).toBe(false);
  });
});

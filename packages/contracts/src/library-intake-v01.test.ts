import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isLibraryImportAcceptedV01, isLibraryImportParamsV01 } from "./library-intake-v01.js";
const vector = (name: string) => JSON.parse(readFileSync(new URL(`../../../schemas/library-intake/v0.1/examples/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
describe("ordinary library intake contract", () => {
  it("accepts the published command and receipt across both Gateway faces", () => {
    const request = vector("import.request");
    expect(isApplicationRequestV01(request)).toBe(true);
    expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "import-1", method: request.method,
      params: { ...(request.params as object), commandId: "import-1" } })).toBe(true);
    expect(isLibraryImportAcceptedV01(vector("import.response"))).toBe(true);
  });
  it("rejects empty, relative, duplicate, null and unknown intake parameters", () => {
    for (const params of [
      { schemaVersion: "0.1", sourceFolders: [] }, { schemaVersion: "0.1", sourceFolders: ["relative"] },
      { schemaVersion: "0.1", sourceFolders: ["C:/A", "c:\\A"] },
      { schemaVersion: "0.1", sourceFolders: ["C:/A"], autoGenerate: null },
      { schemaVersion: "0.1", sourceFolders: ["C:/A"], unpackUnsafe: true },
    ]) expect(isLibraryImportParamsV01(params)).toBe(false);
    expect(isLibraryImportAcceptedV01({ ...vector("import.response"), operation: "warehouse.import" })).toBe(false);
  });
});

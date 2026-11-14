import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { DESKTOP_GATEWAY_METHOD_KINDS, isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isGlbInspectionResultV01, isInspectGlbParamsV01 } from "./glb-inspection-v01.js";

describe("glb-inspection v0.1 contract", () => {
  const vectors = JSON.parse(
    readFileSync(new URL("../../../schemas/glb-inspection/v0.1/vectors.json", import.meta.url), "utf8"),
  ) as {
    validRequests: unknown[];
    invalidRequests: unknown[];
    validResults: unknown[];
    invalidResults: unknown[];
  };

  it("enforces productId XOR entryId at both Application Contract and Desktop Gateway boundaries", () => {
    expect(DESKTOP_GATEWAY_METHOD_KINDS["library.inspectGlb"]).toBe("query");
    for (const params of vectors.validRequests) {
      expect(isInspectGlbParamsV01(params)).toBe(true);
      expect(isApplicationRequestV01({
        contractVersion: "0.1",
        requestId: "req-glb",
        correlationId: "req-glb",
        kind: "query",
        method: "library.inspectGlb",
        params,
      })).toBe(true);
      expect(isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-glb",
        method: "library.inspectGlb",
        params,
      })).toBe(true);
    }
    for (const params of vectors.invalidRequests) {
      expect(isInspectGlbParamsV01(params)).toBe(false);
      expect(isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-glb",
        method: "library.inspectGlb",
        params,
      })).toBe(false);
    }
  });

  it("validates result vectors and refuses host path leaks in fileName", () => {
    for (const result of vectors.validResults) {
      expect(isGlbInspectionResultV01(result)).toBe(true);
    }
    for (const result of vectors.invalidResults) {
      expect(isGlbInspectionResultV01(result)).toBe(false);
    }
  });
});

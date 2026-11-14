import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { DESKTOP_GATEWAY_METHOD_KINDS, isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isObservePoseGraphParamsV01, isPoseGraphResultV01 } from "./pose-graph-v01.js";

describe("pose-graph v0.1 contract", () => {
  const vectors = JSON.parse(
    readFileSync(new URL("../../../schemas/pose-graph/v0.1/vectors.json", import.meta.url), "utf8"),
  ) as {
    validRequests: unknown[];
    invalidRequests: unknown[];
    validResults: unknown[];
    invalidResults: unknown[];
  };

  it("validates request vectors at both Application Contract and Desktop Gateway boundaries", () => {
    expect(DESKTOP_GATEWAY_METHOD_KINDS["environment.observePoseGraph"]).toBe("query");
    for (const params of vectors.validRequests) {
      expect(isObservePoseGraphParamsV01(params)).toBe(true);
      expect(isApplicationRequestV01({
        contractVersion: "0.1",
        requestId: "req-pose",
        correlationId: "req-pose",
        kind: "query",
        method: "environment.observePoseGraph",
        params,
      })).toBe(true);
      expect(isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-pose",
        method: "environment.observePoseGraph",
        params,
      })).toBe(true);
    }
    for (const params of vectors.invalidRequests) {
      expect(isObservePoseGraphParamsV01(params)).toBe(false);
      expect(isDesktopGatewayRequestV1({
        schemaVersion: 1,
        requestId: "req-pose",
        method: "environment.observePoseGraph",
        params,
      })).toBe(false);
    }
  });

  it("validates snapshot vectors and refuses path leaks, out-of-order poseSources, or unknown conflict risks", () => {
    for (const result of vectors.validResults) {
      expect(isPoseGraphResultV01(result)).toBe(true);
    }
    for (const result of vectors.invalidResults) {
      expect(isPoseGraphResultV01(result)).toBe(false);
    }

    const outOfOrder = structuredClone(vectors.validResults[0]) as {
      poseGraph: {
        poseSources: { sourceId: string; state: string; detailCode: string | null }[];
      };
    };
    outOfOrder.poseGraph.poseSources.reverse();
    expect(isPoseGraphResultV01(outOfOrder)).toBe(false);

    const invalidRisk = structuredClone(vectors.validResults[0]) as {
      poseGraph: { fbtDriverConflictRisk: string };
    };
    invalidRisk.poseGraph.fbtDriverConflictRisk = "unknown_risk";
    expect(isPoseGraphResultV01(invalidRisk)).toBe(false);
  });
});

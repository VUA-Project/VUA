import { describe, it, expect } from "vitest";
import { REGIONAL_REFERENCES, referenceElapsed } from "./regional-reference.ts";
import type { WebsiteObservation } from "@vua/contracts";
describe("regional reference timing", () => {
  it("accepts the expected anonymous 404 response without claiming API success", () => {
    const reference = REGIONAL_REFERENCES[0];
    expect(referenceElapsed(reference, { url: reference.url, status: "http_error", httpStatus: 404, elapsedMs: 210 })).toBe(210);
  });
  it("never turns timeout, redirect, rate limit or another destination into latency", () => {
    const reference = REGIONAL_REFERENCES[0];
    for (const [status, httpStatus] of [["timeout", null], ["connection_failed", null], ["probe_error", null], ["redirected", 302], ["http_error", 429], ["http_error", 503]] as const) {
      expect(referenceElapsed(reference, { url: reference.url, status, httpStatus, elapsedMs: 6000 })).toBeNull();
    }
    expect(referenceElapsed(reference, { url: REGIONAL_REFERENCES[1].url, status: "reachable", httpStatus: 200, elapsedMs: 100 } as WebsiteObservation)).toBeNull();
    expect(referenceElapsed(reference)).toBeNull();
  });
});

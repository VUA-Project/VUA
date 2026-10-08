import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { DESKTOP_GATEWAY_METHOD_KINDS, isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isRecipeDraftListV01, isRecipeDraftParamsV01, isRecipeDraftReadV01, isRecipeDraftSelectionStatusV01 } from "./recipe-selection-draft-v01.js";
const vector = (name: string): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../schemas/recipe-selection-draft/v0.1/examples/${name}.json`, import.meta.url)), "utf8")) as Record<string, unknown>;
describe("selection drafts stay separate from production Recipe", () => {
  for (const name of ["list.request", "get.request", "status.request", "save.request", "add.request", "invalid-formal.request", "invalid-path.request", "invalid-revision.request"]) {
    it(name, () => {
      const request = vector(name); const valid = !name.startsWith("invalid");
      const kind = ["recipeDraft.list", "recipeDraft.get", "recipeDraft.selectionStatus"].includes(String(request.method)) ? "query" : "command";
      expect(isRecipeDraftParamsV01(String(request.method), request.params)).toBe(valid);
      expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "synthetic", ...request })).toBe(valid);
      expect(isApplicationRequestV01({ contractVersion: "0.1", requestId: "synthetic", correlationId: "synthetic", kind, ...(kind === "command" ? { commandId: "synthetic" } : {}), ...request })).toBe(valid);
      expect(DESKTOP_GATEWAY_METHOD_KINDS[request.method as "recipeDraft.save"]).toBe(kind);
    });
  }
  it("validates complete reads and refuses misleading append receipts", () => {
    expect(isRecipeDraftListV01(vector("list.response"))).toBe(true);
    expect(isRecipeDraftReadV01(vector("read.response"))).toBe(true);
    expect(isRecipeDraftReadV01(vector("add.response"))).toBe(true);
    expect(isRecipeDraftReadV01(vector("invalid-kind.response"))).toBe(false);
    const broken = vector("add.response"); broken.addedCount = 10;
    expect(isRecipeDraftReadV01(broken)).toBe(false);
    delete broken.existingCount;
    expect(isRecipeDraftReadV01(broken)).toBe(false);
  });
  it("binds missing-file facts to sequential selections without inventing presence", () => {
    const status = vector("status.response"); expect(isRecipeDraftSelectionStatusV01(status)).toBe(true);
    const row = (status.items as Record<string, unknown>[])[0]!;
    row.state = "present"; expect(isRecipeDraftSelectionStatusV01(status)).toBe(false);
    row.state = "missing"; row.index = 2; expect(isRecipeDraftSelectionStatusV01(status)).toBe(false);
  });
});

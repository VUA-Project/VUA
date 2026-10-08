import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createRecipeDraftPort } from "./recipe-draft-port.ts";
const vector = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`../../../../../schemas/recipe-selection-draft/v0.1/examples/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const client = (value: unknown): GatewayClient => ({ invoke: async () => ({ ok: true, value: value as DesktopGatewaySuccessValueV1 }), subscribe: () => () => {} });
describe("selection draft receipts", () => {
  it("reads missing-file status for the requested draft and rejects foreign status", async () => {
    const port = createRecipeDraftPort(client(vector("status.response")));
    expect((await port.selectionStatus("recipe-draft-synthetic")).items[0]?.state).toBe("missing");
    await expect(port.selectionStatus("recipe-draft-other")).rejects.toThrow("read_failed");
  });
  it("keeps query failure distinct from an empty draft library", async () => {
    const unavailable: GatewayClient = { invoke: async () => ({ ok: false, error: { kind: "unavailable" } }), subscribe: () => () => {} };
    await expect(createRecipeDraftPort(unavailable).list()).rejects.toThrow("read_failed");
    expect(await createRecipeDraftPort(client({ schemaVersion: "0.1", entries: [] })).list()).toEqual([]);
  });
  it("refuses a receipt for another draft and refuses absent append counts", async () => {
    const read = vector("read.response");
    await expect(createRecipeDraftPort(client(read)).get("recipe-draft-other")).rejects.toThrow("read_failed");
    await expect(createRecipeDraftPort(client(read)).add("recipe-draft-synthetic", [], 1)).rejects.toThrow("read_failed");
  });
  it("checks append totals against unique submitted identities", async () => {
    const saved = vector("add.response"); const port = createRecipeDraftPort(client(saved));
    const selections = (await port.get("recipe-draft-synthetic")).document.selections;
    const receipt = await port.add("recipe-draft-synthetic", [...selections, ...selections], 1);
    expect(receipt.addedCount).toBe(0); expect(receipt.existingCount).toBe(2);
    await expect(port.add("recipe-draft-synthetic", [selections[0]!], 1)).rejects.toThrow("read_failed");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLiveLibraryBrowserPort } from "./library-browser-port.ts";
const vector = (): Record<string, unknown> => JSON.parse(readFileSync(new URL("../../../../../schemas/library-view/v0.1/examples/local-source.response.json", import.meta.url), "utf8")) as Record<string, unknown>;
const client = (value: unknown): GatewayClient => ({ invoke: async () => ({ ok: true, value: value as DesktopGatewaySuccessValueV1 }), subscribe: () => () => {} });
describe("library source reconciliation projection", () => {
  it("preserves separate identities, candidate metadata and per-card deletion scopes", async () => {
    const page = await createLiveLibraryBrowserPort(client(vector())).list({ schemaVersion: "0.1" });
    expect(page.catalog.kind).toBe("results");
    expect(page.localEntries[0]?.warehouseItemId).toBe("wh-imported");
    expect(page.facts.get("booth:90")?.copyIds).toEqual([]);
    expect(page.facts.get("wh-imported")).toMatchObject({ copyIds: ["cpy-imported"], sources: ["bought"], sourceMatch: { product: { productId: "booth:90", title: "Synthetic item" }, basis: "name", content: "unverified" } });
    expect(page.total).toBe(2);
  });
  it("rejects contradictory content claims and expanded file scopes", async () => {
    const value = vector(); const rows = value.items as Record<string, unknown>[];
    rows[1]!.copyIds = ["cpy-imported", "cpy-another-card"];
    await expect(createLiveLibraryBrowserPort(client(value)).list({ schemaVersion: "0.1" })).rejects.toThrow("library_read_failed");
  });
});

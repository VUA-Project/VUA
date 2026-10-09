import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DesktopGatewayRequestV1, DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLibraryMaintenancePort } from "./library-maintenance-port.ts";
const vector = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`../../../../../schemas/library-maintenance/v0.1/examples/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const client = (value: unknown, calls: DesktopGatewayRequestV1[] = []): GatewayClient => ({ invoke: async (request) => { calls.push(request); return { ok: true, value: value as DesktopGatewaySuccessValueV1 }; }, subscribe: () => () => {} });
describe("library maintenance Gateway port", () => {
  it("validates interrupted discovery and explicit resolution without claiming successful deletion", async () => {
    const target = { kind: "product", id: "booth:90" } as const;
    expect((await createLibraryMaintenancePort(client(vector("pending.response"))).pending(target)).length).toBe(1);
    await expect(createLibraryMaintenancePort(client(vector("pending.response"))).pending({ kind: "product", id: "booth:91" })).rejects.toThrow("read_failed");
    const resolved = vector("resolved.response");
    expect((await createLibraryMaintenancePort(client(resolved)).resolve("library-removal-synthetic", 2)).inspectionResolved).toBe(true);
    await expect(createLibraryMaintenancePort(client(vector("recovered.response"))).resolve("library-removal-synthetic", 2)).rejects.toThrow("read_failed");
  });
  it("keeps failed preview distinct from no managed files", async () => {
    const unavailable: GatewayClient = { invoke: async () => ({ ok: false, error: { kind: "unavailable" } }), subscribe: () => () => {} };
    await expect(createLibraryMaintenancePort(unavailable).preview({ kind: "product", id: "booth:90" })).rejects.toThrow("read_failed");
    const empty = { ...vector("preview.response"), files: [], references: [] };
    expect((await createLibraryMaintenancePort(client(empty)).preview({ kind: "product", id: "booth:90" })).files).toEqual([]);
  });
  it("refuses another target or an expanded selected-file preview", async () => {
    const port = createLibraryMaintenancePort(client(vector("preview.response")));
    await expect(port.preview({ kind: "product", id: "booth:91" })).rejects.toThrow("read_failed");
    await expect(port.preview({ kind: "product", id: "booth:90" }, ["cpy-original"])).rejects.toThrow("read_failed");
  });
  it("binds durable identity to selected copies and refuses foreign receipts", async () => {
    const calls: DesktopGatewayRequestV1[] = [];
    const preview = await createLibraryMaintenancePort(client(vector("preview.response"))).preview({ kind: "product", id: "booth:90" });
    const port = createLibraryMaintenancePort(client(vector("status.response"), calls));
    const value = await port.remove("library-removal-synthetic", preview);
    expect(calls[0]).toMatchObject({ method: "library.removeFiles", params: { removalId: "library-removal-synthetic", copyIds: ["cpy-original", "cpy-old-vpm"], previewHash: preview.previewHash } });
    expect(value.state).toBe("succeeded_with_warnings");
    await expect(port.status("library-removal-other")).rejects.toThrow("read_failed");
    await expect(createLibraryMaintenancePort(client(vector("invalid-finality.response"))).status("library-removal-synthetic")).rejects.toThrow("read_failed");
  });
});

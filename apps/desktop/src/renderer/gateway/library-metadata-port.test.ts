import { describe, expect, it } from "vitest";
import type { DesktopGatewayRequestV1, DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLibraryMetadataPort } from "./library-metadata-port.ts";
const reply = { schemaVersion: "0.1", entryId: "whi-local", revision: 1, displayName: "Texture", productId: null, thumbnailRef: null };
const client = (value: unknown, calls: DesktopGatewayRequestV1[] = []): GatewayClient => ({ invoke: async (request) => { calls.push(request); return { ok: true, value: value as DesktopGatewaySuccessValueV1 }; }, subscribe: () => () => {} });
describe("library metadata port", () => {
  it("binds a local-record receipt to exactly the requested entries", async () => {
    await expect(createLibraryMetadataPort(client({ schemaVersion: "0.1", entryIds: ["whi-other"] })).removeEntries(["whi-local"], "remove")).rejects.toThrow("write_failed");
    const calls: DesktopGatewayRequestV1[] = [];
    await createLibraryMetadataPort(client({ schemaVersion: "0.1", entryIds: ["whi-local"] }, calls)).removeEntries(["whi-local"], "remove");
    expect(calls[0]).toMatchObject({ method: "library.removeLocalEntries", params: { commandId: "remove", entryIds: ["whi-local"] } });
  });
  it("refuses another entry or a receipt for another revision", async () => {
    await expect(createLibraryMetadataPort(client(reply)).read("whi-other")).rejects.toThrow("read_failed");
    await expect(createLibraryMetadataPort(client(reply)).update({ schemaVersion: "0.1", entryId: "whi-local", expectedRevision: 1, displayName: "Texture", productId: null, thumbnailRef: null }, "edit-one")).rejects.toThrow("write_failed");
  });
  it("carries the chosen source and stable command identity", async () => {
    const calls: DesktopGatewayRequestV1[] = [];
    const value = { ...reply, productId: "booth:123", thumbnailRef: `vua-img://local/${"a".repeat(64)}` };
    expect(await createLibraryMetadataPort(client(value, calls)).update({ schemaVersion: "0.1", entryId: "whi-local", expectedRevision: 0, displayName: "Texture", productId: value.productId, thumbnailRef: value.thumbnailRef }, "edit-one")).toEqual(value);
    expect(calls[0]).toMatchObject({ method: "library.updateEntryMetadata", params: { commandId: "edit-one", productId: "booth:123" } });
  });
});

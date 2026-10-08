import { describe, expect, it } from "vitest";
import type { DesktopGatewayRequestV1, DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLibraryMetadataPort } from "./library-metadata-port.ts";
const reply = { schemaVersion: "0.1", entryId: "whi-local", revision: 1, displayName: "Texture", productId: null, thumbnailRef: null };
const client = (value: unknown, calls: DesktopGatewayRequestV1[] = []): GatewayClient => ({ invoke: async (request) => { calls.push(request); return { ok: true, value: value as DesktopGatewaySuccessValueV1 }; }, subscribe: () => () => {} });
describe("library metadata port", () => {
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

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isApplicationRequestV01 } from "./application-contract.js";
import { isDesktopGatewayRequestV1 } from "./desktop-gateway.js";
import { isLibraryEntryMetadataParamsV01, isLibraryEntryMetadataV01 } from "./library-entry-metadata-v01.js";
const vector = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`../../../schemas/library-entry-metadata/v0.1/examples/${name}.json`, import.meta.url), "utf8")) as Record<string, unknown>;
describe("local library metadata", () => {
  it("accepts the query and idempotent write across both Gateway faces", () => {
    for (const name of ["read.request", "update.request"]) {
      const v = vector(name);
      expect(isApplicationRequestV01(v)).toBe(true);
      expect(isDesktopGatewayRequestV1({ schemaVersion: 1, requestId: "read", method: v.method, params: { ...(v.params as object), ...(v.commandId ? { commandId: v.commandId } : {}) } })).toBe(true);
    }
    expect(isLibraryEntryMetadataV01(vector("update.response"))).toBe(true);
  });
  it("rejects control characters, paths, missing nullable fields and stale-shape parameters", () => {
    const good = vector("update.request").params as Record<string, unknown>;
    for (const changed of [{ displayName: " " }, { displayName: "bad\nname" }, { displayName: "🙂".repeat(501) },
      { entryId: "../outside" }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { expectedRevision: -1 },
      { productId: "https://booth.pm/items/123" }, { thumbnailRef: "file:///C:/private.png" }, { thumbnailRef: "https://booth.pximg.net/example.png" },
      { unknown: true }]) expect(isLibraryEntryMetadataParamsV01("library.updateEntryMetadata", { ...good, ...changed })).toBe(false);
    const { productId: _source, ...missing } = good;
    expect(isLibraryEntryMetadataParamsV01("library.updateEntryMetadata", missing)).toBe(false);
    expect(isLibraryEntryMetadataParamsV01("library.updateEntryMetadata", { ...good, displayName: "🙂".repeat(500), productId: "booth:123", thumbnailRef: `vua-img://local/${"a".repeat(64)}` })).toBe(true);
  });
});

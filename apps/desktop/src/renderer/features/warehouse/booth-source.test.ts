import { describe, expect, it } from "vitest";
import { boothSourceId } from "./booth-source.ts";
describe("BOOTH source input", () => {
  it("normalizes a product ID and official shop or localized links", () => {
    for (const input of ["123456", " booth:123456 ", "https://booth.pm/ja/items/123456?x=1#part", "https://sample.booth.pm/items/123456/", "http://booth.pm/en/items/123456"]) expect(boothSourceId(input)).toBe("booth:123456");
  });
  it("rejects unrelated hosts, credentials, download IDs and arbitrary files", () => {
    for (const input of ["", "https://booth.pm.evil.test/items/123456", "https://notbooth.pm/items/123456", "https://user:pass@booth.pm/items/123456", "file:///C:/private.png", "https://booth.pm/downloadables/123456", "https://booth.pm/items/123456/other"]) expect(boothSourceId(input)).toBeNull();
  });
});

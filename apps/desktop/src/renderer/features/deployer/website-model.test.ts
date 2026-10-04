import { describe, expect, it } from "vitest";
import { DEFAULT_TEST_WEBSITES, normalizeWebsiteUrl, parseTestWebsites } from "./website-model.ts";

describe("website card preferences", () => {
  it("starts with the author's three sites and recovers broken saved preferences", () => {
    expect(DEFAULT_TEST_WEBSITES.map(s => s.name)).toEqual(["VRChat", "Steam", "GitHub"]);
    expect(parseTestWebsites("broken")).toEqual(DEFAULT_TEST_WEBSITES);
    expect(parseTestWebsites(JSON.stringify([{ name: "Bad", url: "javascript:alert(1)" }]))).toEqual(DEFAULT_TEST_WEBSITES);
  });
  it("preserves custom names, removals and an intentionally empty list", () => {
    const sites = [{ name: "My site", url: "https://example.com/" }];
    expect(parseTestWebsites(JSON.stringify(sites))).toEqual(sites);
    expect(parseTestWebsites("[]")).toEqual([]);
    expect(parseTestWebsites(JSON.stringify([...sites, ...sites]))).toEqual(DEFAULT_TEST_WEBSITES);
  });
  it("adds HTTPS to plain hostnames but never silently upgrades invalid schemes or credentials", () => {
    expect(normalizeWebsiteUrl(" github.com ")).toBe("https://github.com/");
    for (const url of ["http://example.com", "https://u:p@example.com", "https://example.com/#secret", ""]) {
      expect(normalizeWebsiteUrl(url)).toBeNull();
    }
  });
});

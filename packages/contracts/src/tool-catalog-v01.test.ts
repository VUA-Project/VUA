import { describe, expect, it } from "vitest";
import {
  TOOL_CATALOG_BY_ID_V01,
  TOOL_CATALOG_V01,
  TOOL_GOAL_IDS_V01,
  filterToolCatalogV01,
} from "./tool-catalog-v01.js";

describe("tool-catalog v0.1", () => {
  it("lists all 14 companion tools with consistent free/paid and goal metadata", () => {
    expect(TOOL_CATALOG_V01).toHaveLength(14);
    expect(new Set(TOOL_CATALOG_V01.map(item => item.id)).size).toBe(14);
    for (const item of TOOL_CATALOG_V01) {
      expect(TOOL_GOAL_IDS_V01).toContain(item.goal);
      expect(item.free).toBe(item.priceTier === "free");
      expect(item.officialUrl.startsWith("https://")).toBe(true);
      expect(TOOL_CATALOG_BY_ID_V01[item.id]).toBe(item);
    }
    expect(TOOL_CATALOG_BY_ID_V01.liv.officialUrl).toBe("https://store.steampowered.com/app/755540/");
  });

  it("filters by player goal and free-only constraint", () => {
    const freeUtilities = filterToolCatalogV01({ goal: "utilities", freeOnly: true });
    expect(freeUtilities.map(item => item.id)).toEqual(["oyasumi", "desktopplus"]);
    const allTracking = filterToolCatalogV01({ goal: "tracking", freeOnly: false });
    expect(allTracking.map(item => item.id)).toEqual(["vrcft", "space", "slimevr"]);
  });
});

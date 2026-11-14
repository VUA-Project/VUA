import { describe, expect, it } from "vitest";
import type { AmfProductionRun, AmfProductionSource } from "../../../gateway/index.ts";
import { buildCreatorCreditItems, formatCreatorCreditsText, type CreatorProductFact } from "./CreatorCredits.tsx";

const used = (sourceId: string, role: "avatar" | "outfit" | "dependency", itemName: string) => ({
  sourceId,
  role,
  itemName,
  name: `${itemName}.unitypackage`,
  sha256: "b".repeat(64),
});

const listed = (sourceId: string, productIds?: string[]): AmfProductionSource => ({
  sourceId,
  itemId: sourceId,
  itemName: sourceId,
  name: sourceId,
  ...(productIds ? { productIds } : {}),
});

describe("CreatorCredits attribution derivation", () => {
  it("resolves linked BOOTH titles and shops, excludes dependencies, and never fabricates unknown shops", () => {
    const run = {
      sources: [
        used("base", "avatar", "Shinano_v1.zip"),
        used("coat", "outfit", "WinterCoat.zip"),
        used("glasses", "outfit", "Glasses.zip"),
        used("localHat", "outfit", "CustomHat"),
        used("shader", "dependency", "lilToon"),
      ],
    } as unknown as AmfProductionRun;
    const sources = [
      listed("base", ["booth:5000001"]),
      listed("coat", ["booth:6000002", "booth:5000001"]),
      listed("glasses", ["booth:7000003"]),
      listed("localHat"),
      listed("shader", ["booth:2329085"]),
    ];
    const facts = new Map<string, CreatorProductFact>([
      ["booth:5000001", { title: "Original 3D Model Shinano", shopName: "Atelier Example" }],
      ["booth:6000002", { title: "Winter Coat Set", shopName: null }],
    ]);

    const items = buildCreatorCreditItems(run, sources, facts);
    expect(items).toEqual([
      {
        key: "booth:5000001",
        role: "avatar",
        title: "Original 3D Model Shinano",
        shopName: "Atelier Example",
        productId: "booth:5000001",
        boothUrl: "https://booth.pm/items/5000001",
      },
      {
        key: "booth:6000002",
        role: "outfit",
        title: "Winter Coat Set",
        shopName: null,
        productId: "booth:6000002",
        boothUrl: "https://booth.pm/items/6000002",
      },
      {
        key: "booth:7000003",
        role: "outfit",
        title: "Glasses.zip",
        shopName: null,
        productId: "booth:7000003",
        boothUrl: "https://booth.pm/items/7000003",
      },
      {
        key: "local:localHat",
        role: "outfit",
        title: "CustomHat",
        shopName: null,
        productId: null,
        boothUrl: null,
      },
    ]);

    const formatted = formatCreatorCreditsText(items, { avatarRole: "Base Avatar", outfitRole: "Outfit" });
    expect(formatted).toBe([
      "Base Avatar: Original 3D Model Shinano — Atelier Example (https://booth.pm/items/5000001)",
      "Outfit: Winter Coat Set (https://booth.pm/items/6000002)",
      "Outfit: Glasses.zip (https://booth.pm/items/7000003)",
      "Outfit: CustomHat",
    ].join("\n"));
  });
});

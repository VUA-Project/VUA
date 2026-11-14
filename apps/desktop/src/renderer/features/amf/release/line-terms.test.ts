import { describe, expect, it } from "vitest";
import type { AmfProductionRun, AmfProductionSource } from "../../../gateway/index.ts";
import { lineProducts } from "./LineTerms.tsx";

const used = (sourceId: string, role: "avatar" | "outfit" | "dependency", itemName: string) => ({ sourceId, role, itemName, name: `${itemName}.unitypackage`, sha256: "a".repeat(64) });
const listed = (sourceId: string, productIds?: string[]): AmfProductionSource =>
  ({ sourceId, itemId: sourceId, itemName: sourceId, name: sourceId, ...(productIds ? { productIds } : {}) });

describe("the products a finished line's terms check covers", () => {
  it("takes the Avatar and outfits, skips dependencies and counts materials without a product", () => {
    const run = { sources: [used("avatar", "avatar", "Meiyun.zip"), used("outfit", "outfit", "Tshirt.zip"), used("shader", "dependency", "lilToon.zip"), used("hat", "outfit", "Hat.zip")] } as unknown as AmfProductionRun;
    const { products, unlinked } = lineProducts(run, [
      listed("avatar", ["booth:1"]), listed("outfit", ["booth:2", "booth:1", "local:9"]), listed("shader", ["booth:3"]), listed("hat"),
    ]);
    expect([...products]).toEqual([["booth:1", "Meiyun.zip"], ["booth:2", "Tshirt.zip"]]);
    expect(unlinked).toBe(1);
  });
});

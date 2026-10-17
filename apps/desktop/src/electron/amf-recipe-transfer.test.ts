import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { recipeTransferText } from "./amf-recipe-transfer.ts";
import { decodeAmfRecipeShare, sameAmfRecipeShare } from "@vua/contracts";
it("native file and clipboard transfer preserve only the validated declaration", () => {
  const document = JSON.parse(readFileSync(new URL("../../../../schemas/amf-recipe/v0.4/share-examples/share.valid.json",import.meta.url),"utf8"));
  const transfer = recipeTransferText(document);
  const code = decodeAmfRecipeShare(transfer.shareCode); expect(code).not.toBeNull();
  expect(sameAmfRecipeShare(code!,JSON.parse(transfer.fileText))).toBe(true);
  expect(() => recipeTransferText({...document,paidAsset:"hidden bytes"})).toThrow("invalid");
  expect(() => recipeTransferText({...document,recipe:{...document.recipe,avatar:{...document.recipe.avatar,prefabPath:"C:/private/avatar.prefab"}}})).toThrow("invalid");
});

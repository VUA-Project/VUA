import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { isAmfRecipeDocument, isAmfSharedRecipe, decodeAmfRecipeShare, sameAmfRecipeShare } from "./amf-recipe-v04.js";

describe("actual-production Recipe v0.4", () => {
  it("consumes the same closed declarations as Rust", () => {
    const root = new URL("../../../schemas/amf-recipe/v0.4/examples/", import.meta.url);
    for (const name of readdirSync(root)) expect(isAmfRecipeDocument(JSON.parse(readFileSync(new URL(name,root),"utf8"))),name).toBe(name.includes(".valid."));
  });
  it("rejects missing referenced materials and duplicate identities", () => {
    const valid = JSON.parse(readFileSync(new URL("../../../schemas/amf-recipe/v0.4/examples/recipe.valid.json",import.meta.url),"utf8"));
    expect(isAmfRecipeDocument({...valid,materials:[valid.materials[0]]})).toBe(false);
    expect(isAmfRecipeDocument({...valid,materials:[...valid.materials,valid.materials[0]]})).toBe(false);
  });
});

it("shares only closed BOOTH declarations in either representation", () => {
  const root = new URL("../../../schemas/amf-recipe/v0.4/share-examples/", import.meta.url);
  for (const name of readdirSync(root)) {
    const text = readFileSync(new URL(name,root),"utf8"); const valid = name.includes(".valid.");
    expect(isAmfSharedRecipe(JSON.parse(text)),name).toBe(valid);
    expect(decodeAmfRecipeShare(text) !== null,name).toBe(valid);
    const code = "vuar0.4." + Buffer.from(text,"utf8").toString("base64url");
    const decoded = decodeAmfRecipeShare(code); expect(decoded !== null,name).toBe(valid);
    if (decoded) expect(sameAmfRecipeShare(decoded,JSON.parse(text))).toBe(true);
  }
  expect(decodeAmfRecipeShare("x".repeat(350000))).toBe(null);
  expect(decodeAmfRecipeShare("vuar0.2.aaaa")).toBe(null);
  const value = JSON.parse(readFileSync(new URL("share.valid.json",root),"utf8"));
  delete value.sources[value.recipe.materials[0].id]; expect(isAmfSharedRecipe(value)).toBe(false);
});

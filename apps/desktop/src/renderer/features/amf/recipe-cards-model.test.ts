import type { AmfRecipeDocument, AmfRecipeMaterialResolution } from "@vua/contracts";
import { describe, expect, it } from "vitest";
import {
  fastDocumentReadiness,
  filterRecipeSummaries,
  newestFirst,
  recipeMaterialRows,
  recipeProductIds,
  recipeReadiness,
} from "./recipe-cards-model.ts";
import { requestProductionRecipe, takeRequestedProductionRecipe } from "./production-recipe-navigation.ts";

const resolution = (materialId: string, status: AmfRecipeMaterialResolution["status"], boothProductId: string | null = null): AmfRecipeMaterialResolution =>
  ({ materialId, packageName: `${materialId}.unitypackage`, boothProductId, status, resolved: null, candidates: [], downloadNames: [] });
const recipe = {
  formatVersion: "0.5", recipeId: "r", title: "R", editorVersion: "2022.3.22f1",
  materials: [
    { id: "shader", packageName: "shader.unitypackage", sha256: "a".repeat(64) },
    { id: "coat", packageName: "coat.unitypackage", sha256: "b".repeat(64), boothProductId: "20" },
    { id: "body", packageName: "body.unitypackage", sha256: "c".repeat(64), boothProductId: "10" },
  ],
  avatar: { materialId: "body", prefabPath: "Assets/Body.prefab" },
  outfits: [{ materialId: "coat", prefabPath: "Assets/Coat.prefab", mode: "merge_armature", bone: "", toggleName: "Coat", active: true }],
  packages: { "com.vrchat.avatars": "3.7.4", "nadena.dev.modular-avatar": "1.10.3" },
} as AmfRecipeDocument;

describe("a Recipe's readiness", () => {
  it("names what stops a new line first", () => {
    expect(recipeReadiness({ ready: true, materials: [resolution("a", "ready")] })).toEqual({ kind: "ready" });
    expect(recipeReadiness({ ready: false, materials: [resolution("a", "material_choice_required"), resolution("b", "ready")] })).toEqual({ kind: "choose", count: 1 });
    expect(recipeReadiness({ ready: false, materials: [resolution("a", "material_choice_required"), resolution("b", "material_not_downloaded"), resolution("c", "material_not_owned"), resolution("d", "material_missing")] })).toEqual({ kind: "missing", count: 3 });
  });
});

describe("a Recipe's material rows", () => {
  it("lists the Avatar first, then outfits, then the rest", () => {
    expect(recipeMaterialRows(recipe).map(row => [row.materialId, row.role])).toEqual([["body", "avatar"], ["coat", "outfit"], ["shader", "other"]]);
  });

  it("takes the BOOTH product from the Recipe, else from what the plan resolved", () => {
    const rows = recipeMaterialRows(recipe, { materials: [resolution("shader", "material_not_owned", "30")] });
    expect(rows.map(row => row.productId)).toEqual(["booth:10", "booth:20", "booth:30"]);
    expect(rows.find(row => row.materialId === "shader")!.status).toBe("material_not_owned");
    expect(rows.find(row => row.materialId === "body")!.status).toBeNull();
  });

  it("finds the product through the production list when the Recipe saved no BOOTH id", () => {
    const plain = { ...recipe, materials: recipe.materials.map(({ boothProductId: _id, ...material }) => material) };
    const sources = [{ sourceId: "s1", itemId: "i1", name: "other.unitypackage", productIds: ["booth:40"] }, { sourceId: "s2", itemId: "i2", name: "coat.unitypackage", productIds: ["booth:50"] }];
    const byName = recipeMaterialRows(plain, null, sources);
    expect(byName.find(row => row.materialId === "coat")!.productId).toBe("booth:50");
    expect(byName.find(row => row.materialId === "body")!.productId).toBeNull();
    const planned = { ...resolution("body", "ready"), resolved: { sourceId: "s1", packageName: "body.unitypackage", sha256: "x" } };
    expect(recipeMaterialRows(plain, { materials: [planned] }, sources).find(row => row.materialId === "body")!.productId).toBe("booth:40");
  });

  it("collects each product once across Recipes", () => {
    const rows = recipeMaterialRows(recipe);
    expect(recipeProductIds([rows, rows])).toEqual(["booth:10", "booth:20"]);
  });
});

it("orders Recipes by their last save", () => {
  expect(newestFirst([{ updatedAt: "2026-01-01" }, { updatedAt: "2026-03-01" }]).map(item => item.updatedAt)).toEqual(["2026-03-01", "2026-01-01"]);
});

describe("fastDocumentReadiness and production recipe handoff", () => {
  it("evaluates Recipe readiness from in-memory production sources when all digests match and defers otherwise", () => {
    const allReady = [
      { sourceId: "s1", itemId: "i1", name: "shader.unitypackage", sha256: "a".repeat(64) },
      { sourceId: "s2", itemId: "i2", name: "coat.unitypackage", sha256: "b".repeat(64) },
      { sourceId: "s3", itemId: "i3", name: "body.unitypackage", sha256: "c".repeat(64) },
    ];
    expect(fastDocumentReadiness(recipe, allReady)).toEqual({ kind: "ready" });
    expect(fastDocumentReadiness(recipe, allReady.slice(0, 2))).toBeNull();
    expect(fastDocumentReadiness(recipe, [{ sourceId: "s1", itemId: "i1", name: "shader.unitypackage" }])).toBeNull();
  });

  it("round-trips a requested production recipe ID once", () => {
    requestProductionRecipe("recipe-alpha");
    expect(takeRequestedProductionRecipe()).toBe("recipe-alpha");
    expect(takeRequestedProductionRecipe()).toBeNull();
  });

  it("filters Recipe summaries across title, outfit/package names, BOOTH titles, and readiness", () => {
    const items = [
      { recipeId: "r", title: "Summer Stage", avatarName: "Meiyun" },
      { recipeId: "r2", title: "Winter Casual", avatarName: "Shinano", boothProductIds: ["99"] },
    ];
    const recipes = new Map([["r", recipe]]);
    const plans = new Map([
      ["r", { ready: true, materials: [resolution("body", "ready")] }],
      ["r2", { ready: false, materials: [resolution("coat", "material_missing")] }],
    ]);
    const pictures = new Map([["booth:99", { title: "Fluffy Scarf" }]]);

    expect(filterRecipeSummaries(items, { query: "meiyun coat", readiness: "all", recipes }).map(i => i.recipeId)).toEqual(["r"]);
    expect(filterRecipeSummaries(items, { query: "modular-avatar", readiness: "all", recipes }).map(i => i.recipeId)).toEqual(["r"]);
    expect(filterRecipeSummaries(items, { query: "scarf", readiness: "all", pictures }).map(i => i.recipeId)).toEqual(["r2"]);
    expect(filterRecipeSummaries(items, { query: "", readiness: "ready", plans }).map(i => i.recipeId)).toEqual(["r"]);
    expect(filterRecipeSummaries(items, { query: "", readiness: "attention", plans }).map(i => i.recipeId)).toEqual(["r2"]);
  });
});

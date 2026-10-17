import { describe, expect, it } from "vitest";
import type { AmfRecipeDocument } from "@vua/contracts";
import { adjacency, buildRecipeGraph, graphCaption, materialLabel, materialNodeId, packageLabel, packageNodeId, pinnedVersions, prefabLabel, recipeNodeId, recipeParts, sharedParts } from "./control-graph-model.ts";

const sha = (c: string) => c.repeat(64);
const material = (c: string, packageName: string) => ({ id: `m-${sha(c)}`, packageName, sha256: sha(c) });
const avatar = material("a", "Meiyun_v2.1.0.unitypackage");
const shirt = material("b", "TshirtShorts_Meiyun_v1.00.unitypackage");
const costume = material("c", "Meiyun_Costume4.unitypackage");
const shader = material("d", "lilToon_1.8.5.unitypackage");
const recipe = (recipeId: string, title: string, outfits: readonly typeof shirt[], extra: readonly typeof shirt[] = [], packages: Record<string, string> = {}): AmfRecipeDocument => ({
  formatVersion: "0.4", recipeId, title, editorVersion: "2022.3.22f1",
  materials: [avatar, ...outfits, ...extra], avatar: { materialId: avatar.id, prefabPath: "Assets/Meiyun/Meiyun.prefab" },
  outfits: outfits.map(outfit => ({ materialId: outfit.id, prefabPath: `Assets/${outfit.packageName}/Outfit.prefab`, mode: "merge_armature" as const, bone: "", toggleName: outfit.packageName, active: true })),
  packages: { "com.vrchat.avatars": "3.7.4", "nadena.dev.modular-avatar": "1.10.3", ...packages },
});

describe("Recipe graph", () => {
  const summer = recipe("summer", "Summer Meiyun", [shirt], [shader]);
  const stage = recipe("stage", "Stage Meiyun", [costume], [shader], { "nadena.dev.modular-avatar": "1.11.0" });
  const names = new Map([["nadena.dev.modular-avatar", "Modular Avatar"], ["com.vrchat.avatars", "VRChat SDK - Avatars"]]);
  const graph = buildRecipeGraph([summer, stage], names);

  it("builds one node per Recipe and per shared material or package", () => {
    expect(graph.nodes.filter(node => node.kind === "recipe").map(node => node.label)).toEqual(["Stage Meiyun", "Summer Meiyun"]);
    expect(graph.nodes.map(node => node.id)).toEqual([
      recipeNodeId("stage"), recipeNodeId("summer"),
      materialNodeId(avatar.id), materialNodeId(costume.id), materialNodeId(shader.id),
      packageNodeId("com.vrchat.avatars"), packageNodeId("nadena.dev.modular-avatar"), materialNodeId(shirt.id),
    ]);
    const kinds = Object.fromEntries(graph.nodes.map(node => [node.id, node.kind]));
    expect(kinds[materialNodeId(avatar.id)]).toBe("avatar");
    expect(kinds[materialNodeId(shirt.id)]).toBe("outfit");
    expect(kinds[materialNodeId(shader.id)]).toBe("material");
    expect(kinds[packageNodeId("com.vrchat.avatars")]).toBe("package");
  });

  it("draws a uses edge from each Recipe to each of its parts", () => {
    const fromSummer = graph.edges.filter(edge => edge.from === recipeNodeId("summer"));
    expect(fromSummer.map(edge => [edge.to, edge.kind])).toEqual([
      [materialNodeId(avatar.id), "avatar"], [materialNodeId(shirt.id), "outfit"], [materialNodeId(shader.id), "material"],
      [packageNodeId("com.vrchat.avatars"), "package"], [packageNodeId("nadena.dev.modular-avatar"), "package"],
    ]);
    expect(new Set(graph.edges.map(edge => edge.id)).size).toBe(graph.edges.length);
  });

  it("connects Recipes through shared materials and packages", () => {
    const shared = sharedParts(graph);
    expect(shared.map(node => node.id)).toEqual([materialNodeId(avatar.id), materialNodeId(shader.id), packageNodeId("nadena.dev.modular-avatar"), packageNodeId("com.vrchat.avatars")]);
    expect(shared[0]!.recipeIds).toEqual(["stage", "summer"]);
    const near = adjacency(graph);
    expect([...near.get(materialNodeId(avatar.id))!]).toEqual([recipeNodeId("stage"), recipeNodeId("summer")]);
    expect(near.get(materialNodeId(shirt.id))!.has(recipeNodeId("stage"))).toBe(false);
  });

  it("keeps each Recipe's pinned version on the package node and its edge", () => {
    const ma = graph.nodes.find(node => node.id === packageNodeId("nadena.dev.modular-avatar"))!;
    expect(ma.versions).toEqual({ stage: "1.11.0", summer: "1.10.3" });
    expect(pinnedVersions(ma)).toEqual(["1.11.0", "1.10.3"]);
    expect(graph.edges.find(edge => edge.from === recipeNodeId("stage") && edge.to === ma.id)?.version).toBe("1.11.0");
    expect(ma.label).toBe("Modular Avatar");
    expect(graphCaption(ma)).toBe("Modular Avatar 1.11.0 / 1.10.3");
    expect(graphCaption(graph.nodes.find(node => node.id === packageNodeId("com.vrchat.avatars"))!)).toBe("VRChat SDK - Avatars 3.7.4");
    expect(graphCaption(graph.nodes[0]!)).toBe("Stage Meiyun");
  });

  it("gives a material its strongest role and keeps the role per Recipe on the edge", () => {
    const outfitHere = recipe("a", "A", [shirt]);
    const dependencyThere = recipe("b", "B", [costume], [shirt]);
    const mixed = buildRecipeGraph([dependencyThere, outfitHere]);
    expect(mixed.nodes.find(node => node.id === materialNodeId(shirt.id))?.kind).toBe("outfit");
    expect(mixed.edges.find(edge => edge.from === recipeNodeId("b") && edge.to === materialNodeId(shirt.id))?.kind).toBe("material");
  });

  it("collects the prefabs Recipes use from a material", () => {
    const other = { ...summer, recipeId: "quest", title: "Quest", avatar: { materialId: avatar.id, prefabPath: "Assets/Meiyun/Meiyun_Quest.prefab" } };
    const node = buildRecipeGraph([summer, other]).nodes.find(item => item.id === materialNodeId(avatar.id))!;
    expect(node.prefabs).toEqual(["Assets/Meiyun/Meiyun_Quest.prefab", "Assets/Meiyun/Meiyun.prefab"]);
  });

  it("groups one Recipe's parts by role", () => {
    const parts = recipeParts(graph, "stage");
    expect(parts.avatar.map(node => node.label)).toEqual(["Meiyun"]);
    expect(parts.outfit.map(node => node.label)).toEqual(["Meiyun_Costume4"]);
    expect(parts.material.map(node => node.label)).toEqual(["lilToon"]);
    expect(parts.package.map(node => node.packageId)).toEqual(["com.vrchat.avatars", "nadena.dev.modular-avatar"]);
  });

  it("is empty without Recipes and ignores a repeated Recipe", () => {
    expect(buildRecipeGraph([])).toEqual({ nodes: [], edges: [] });
    expect(buildRecipeGraph([summer, summer]).nodes.filter(node => node.kind === "recipe")).toHaveLength(1);
  });
});

describe("labels", () => {
  it("reads material, package and prefab names", () => {
    expect(materialLabel("Meiyun_v2.1.0.unitypackage")).toBe("Meiyun");
    expect(materialLabel("TshirtShorts_Meiyun_v1.00.unitypackage")).toBe("TshirtShorts_Meiyun");
    expect(materialLabel("Meiyun_Costume4.unitypackage")).toBe("Meiyun_Costume4");
    expect(materialLabel("1.0.0.unitypackage")).toBe("1.0.0");
    expect(packageLabel("com.vrchat.avatars", new Map([["com.vrchat.avatars", "VRChat SDK - Avatars"]]))).toBe("VRChat SDK - Avatars");
    expect(packageLabel("com.example.tool")).toBe("com.example.tool");
    expect(prefabLabel("Assets/Meiyun/Meiyu_改変.prefab")).toBe("Meiyu_改変");
  });
});

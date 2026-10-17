/** Control center Recipe graph: each Recipe connects to its Avatar, outfits, other materials and pinned packages. */
import type { AmfRecipeDocument } from "@vua/contracts";

export type GraphNodeKind = "recipe" | "avatar" | "outfit" | "material" | "package";
export type GraphEdgeKind = Exclude<GraphNodeKind, "recipe">;
export const NODE_KINDS: readonly GraphNodeKind[] = ["recipe", "avatar", "outfit", "material", "package"];

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  /** Recipes that use this node, in graph order; a Recipe node lists itself. */
  readonly recipeIds: readonly string[];
  /** Material package file name (Avatar, outfit and material nodes). */
  readonly packageName?: string;
  /** Prefabs the Recipes use from this material, package-relative. */
  readonly prefabs?: readonly string[];
  /** VPM package id (package nodes). */
  readonly packageId?: string;
  /** Pinned version per Recipe id (package nodes). */
  readonly versions?: Readonly<Record<string, string>>;
}
export interface GraphEdge { readonly id: string; readonly from: string; readonly to: string; readonly kind: GraphEdgeKind; readonly version?: string }
export interface RecipeGraph { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] }

const ROLE_RANK: Record<"avatar" | "outfit" | "material", number> = { avatar: 3, outfit: 2, material: 1 };

export const recipeNodeId = (recipeId: string) => `recipe:${recipeId}`;
export const materialNodeId = (materialId: string) => `material:${materialId}`;
export const packageNodeId = (packageId: string) => `package:${packageId}`;

/** A readable name for a material package: the file name without its extension and trailing version. */
export function materialLabel(packageName: string): string {
  const base = packageName.replace(/\.unitypackage$/iu, "");
  const trimmed = base.replace(/[\s_-]*v?\d+(?:[._]\d+)+[a-z0-9]*$/iu, "");
  return trimmed.length > 0 ? trimmed : base;
}

/** A package's display name from the repositories VUA knows, else its id. */
export function packageLabel(packageId: string, names?: ReadonlyMap<string, string>): string {
  return names?.get(packageId) ?? packageId;
}

/** The name a player knows a prefab by: its file name without the folder and extension. */
export function prefabLabel(prefabPath: string): string {
  return prefabPath.slice(prefabPath.lastIndexOf("/") + 1).replace(/\.prefab$/iu, "");
}

/** Nodes and "uses" edges for saved Recipes. Materials are shared by content identity, packages by id. */
export function buildRecipeGraph(recipes: readonly AmfRecipeDocument[], packageNames?: ReadonlyMap<string, string>): RecipeGraph {
  const ordered = [...recipes].sort((a, b) => a.title.localeCompare(b.title) || a.recipeId.localeCompare(b.recipeId));
  interface Part { kind: GraphNodeKind; rank: number; label: string; recipeIds: string[]; packageName?: string; prefabs?: string[]; packageId?: string; versions?: Record<string, string> }
  const parts = new Map<string, Part>();
  const edges: GraphEdge[] = [];
  const recipeNodes: GraphNode[] = [];
  const use = (id: string, recipeId: string, make: () => Part) => {
    const part = parts.get(id) ?? make();
    parts.set(id, part);
    if (!part.recipeIds.includes(recipeId)) part.recipeIds.push(recipeId);
    return part;
  };
  for (const recipe of ordered) {
    const from = recipeNodeId(recipe.recipeId);
    if (recipeNodes.some(node => node.id === from)) continue;
    recipeNodes.push({ id: from, kind: "recipe", label: recipe.title, recipeIds: [recipe.recipeId] });
    const outfitPrefabs = new Map(recipe.outfits.map(outfit => [outfit.materialId, outfit.prefabPath] as const));
    for (const material of recipe.materials) {
      const role = material.id === recipe.avatar.materialId ? "avatar" : outfitPrefabs.has(material.id) ? "outfit" : "material";
      const id = materialNodeId(material.id);
      const part = use(id, recipe.recipeId, () => ({ kind: role, rank: 0, label: materialLabel(material.packageName), recipeIds: [], packageName: material.packageName, prefabs: [] }));
      if (ROLE_RANK[role] > part.rank) { part.kind = role; part.rank = ROLE_RANK[role]; }
      const prefab = role === "avatar" ? recipe.avatar.prefabPath : outfitPrefabs.get(material.id);
      if (prefab !== undefined && !part.prefabs!.includes(prefab)) part.prefabs!.push(prefab);
      edges.push({ id: `${from}>${id}`, from, to: id, kind: role });
    }
    for (const [packageId, version] of Object.entries(recipe.packages).sort(([a], [b]) => a.localeCompare(b))) {
      const id = packageNodeId(packageId);
      const part = use(id, recipe.recipeId, () => ({ kind: "package", rank: 0, label: packageLabel(packageId, packageNames), recipeIds: [], packageId, versions: {} }));
      part.versions![recipe.recipeId] = version;
      edges.push({ id: `${from}>${id}`, from, to: id, kind: "package", version });
    }
  }
  const partNodes = [...parts].map(([id, part]): GraphNode => ({
    id, kind: part.kind, label: part.label, recipeIds: part.recipeIds,
    ...(part.packageName !== undefined ? { packageName: part.packageName, prefabs: part.prefabs ?? [] } : {}),
    ...(part.packageId !== undefined ? { packageId: part.packageId, versions: part.versions ?? {} } : {}),
  }));
  // A node takes its strongest role across Recipes; each edge keeps the role it has in its own Recipe.
  return { nodes: [...recipeNodes, ...partNodes], edges };
}

export function adjacency(graph: RecipeGraph): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>(graph.nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of graph.edges) { map.get(edge.from)?.add(edge.to); map.get(edge.to)?.add(edge.from); }
  return map;
}

/** Parts that connect two or more Recipes, most shared first. */
export function sharedParts(graph: RecipeGraph): readonly GraphNode[] {
  return graph.nodes.filter(node => node.kind !== "recipe" && node.recipeIds.length > 1)
    .sort((a, b) => b.recipeIds.length - a.recipeIds.length || NODE_KINDS.indexOf(a.kind) - NODE_KINDS.indexOf(b.kind) || a.label.localeCompare(b.label));
}

/** The distinct versions Recipes pin for a package node, in first-seen order. */
export function pinnedVersions(node: GraphNode): readonly string[] {
  return [...new Set(Object.values(node.versions ?? {}))];
}

/** The text under a node in the graph: packages carry their pinned versions, so a package and a material of the same name read apart. */
export function graphCaption(node: GraphNode): string {
  if (node.kind !== "package") return node.label;
  const versions = pinnedVersions(node);
  return versions.length === 0 ? node.label : `${node.label} ${versions.slice(0, 2).join(" / ")}${versions.length > 2 ? " …" : ""}`;
}

/** A Recipe's parts grouped by kind, in the order the Recipe lists them. */
export function recipeParts(graph: RecipeGraph, recipeId: string): Record<GraphEdgeKind, readonly GraphNode[]> {
  const byId = new Map(graph.nodes.map(node => [node.id, node] as const));
  const from = recipeNodeId(recipeId);
  const groups: Record<GraphEdgeKind, GraphNode[]> = { avatar: [], outfit: [], material: [], package: [] };
  for (const edge of graph.edges) if (edge.from === from) { const node = byId.get(edge.to); if (node) groups[edge.kind].push(node); }
  return groups;
}

/** What a Recipe card and its details say: which materials it needs, and whether this PC has them. */
import type { AmfRecipeDocument, AmfRecipeMaterialPlan, AmfRecipeMaterialResolution } from "@vua/contracts";

export type RecipeReadiness =
  | { readonly kind: "ready" }
  | { readonly kind: "choose"; readonly count: number }
  | { readonly kind: "missing"; readonly count: number };

/** One sentence for a whole Recipe: missing materials come first, since they stop a new line. */
export function recipeReadiness(plan: Pick<AmfRecipeMaterialPlan, "materials" | "ready">): RecipeReadiness {
  const missing = plan.materials.filter(material => material.status === "material_not_downloaded" || material.status === "material_not_owned" || material.status === "material_missing").length;
  if (missing > 0) return { kind: "missing", count: missing };
  const choose = plan.materials.filter(material => material.status === "material_choice_required").length;
  if (choose > 0) return { kind: "choose", count: choose };
  return { kind: "ready" };
}

export type RecipeMaterialRole = "avatar" | "outfit" | "other";
/** A file the production list knows, with the BOOTH products it came from and its recorded digest. */
export interface RecipeMaterialSource {
  readonly sourceId: string;
  readonly itemId: string;
  readonly name: string;
  readonly productIds?: readonly string[];
  readonly sha256?: string;
}

/** Fast in-memory readiness when every Recipe material matches a local source's recorded SHA-256 digest. */
export function fastDocumentReadiness(recipe: AmfRecipeDocument, sources: readonly RecipeMaterialSource[]): RecipeReadiness | null {
  if (recipe.materials.length === 0 || !sources.some(source => Boolean(source.sha256))) return null;
  const knownDigests = new Set(sources.flatMap(source => (source.sha256 ? [source.sha256.toLowerCase()] : [])));
  return recipe.materials.every(material => knownDigests.has(material.sha256.toLowerCase())) ? { kind: "ready" } : null;
}
export interface RecipeMaterialRow {
  readonly materialId: string;
  readonly packageName: string;
  readonly role: RecipeMaterialRole;
  readonly productId: string | null;
  readonly status: AmfRecipeMaterialResolution["status"] | null;
  readonly source: RecipeMaterialSource | null;
}

/** The Avatar first, then outfits in the Recipe's order, then whatever else it uses. */
export function recipeMaterialRows(recipe: AmfRecipeDocument, plan?: Pick<AmfRecipeMaterialPlan, "materials"> | null, sources: readonly RecipeMaterialSource[] = []): readonly RecipeMaterialRow[] {
  const outfits = recipe.outfits.map(outfit => outfit.materialId);
  const rank = (id: string) => id === recipe.avatar.materialId ? -1 : outfits.includes(id) ? outfits.indexOf(id) : outfits.length;
  return [...recipe.materials].sort((a, b) => rank(a.id) - rank(b.id)).map(material => {
    const resolved = plan?.materials.find(item => item.materialId === material.id);
    const native = material.boothProductId ?? resolved?.boothProductId ?? null;
    // The plan names the exact file; until it arrives the file name is enough for a picture.
    const named = sources.filter(source => source.name === material.packageName);
    const source = sources.find(item => item.sourceId === resolved?.resolved?.sourceId) ?? named.find(item => (item.productIds?.length ?? 0) > 0) ?? named[0] ?? null;
    return {
      materialId: material.id, packageName: material.packageName,
      role: material.id === recipe.avatar.materialId ? "avatar" : outfits.includes(material.id) ? "outfit" : "other",
      productId: native === null ? source?.productIds?.[0] ?? null : `booth:${native}`,
      status: resolved?.status ?? null,
      source,
    };
  });
}

/** Distinct BOOTH products across Recipes, whose pictures the cards show. */
export function recipeProductIds(rows: readonly (readonly RecipeMaterialRow[])[]): readonly string[] {
  return [...new Set(rows.flatMap(list => list.flatMap(row => row.productId === null ? [] : [row.productId])))];
}

/** The summary a card shows, newest save first. */
export function newestFirst<T extends { readonly updatedAt: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type RecipeReadinessFilter = "all" | "ready" | "attention";

export interface RecipeSummaryFilterShape {
  readonly recipeId: string;
  readonly title: string;
  readonly avatarName?: string | undefined;
  readonly boothProductIds?: readonly string[] | undefined;
}

export interface RecipeFilterContext {
  readonly query: string;
  readonly readiness: RecipeReadinessFilter;
  readonly recipes?: ReadonlyMap<string, AmfRecipeDocument> | undefined;
  readonly rows?: ReadonlyMap<string, readonly RecipeMaterialRow[]> | undefined;
  readonly plans?: ReadonlyMap<string, Pick<AmfRecipeMaterialPlan, "materials" | "ready">> | undefined;
  readonly sources?: readonly RecipeMaterialSource[] | undefined;
  readonly pictures?: ReadonlyMap<string, { readonly title: string | null }> | undefined;
}

/** Filters Recipe summaries by multi-token NFKC query (title, avatar, outfits, packages, BOOTH titles) and material readiness. */
export function filterRecipeSummaries<T extends RecipeSummaryFilterShape>(
  summaries: readonly T[],
  context: RecipeFilterContext,
): readonly T[] {
  const tokens = context.query
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0 && context.readiness === "all") return summaries;

  const sources = context.sources ?? [];
  return summaries.filter(summary => {
    const doc = context.recipes?.get(summary.recipeId);
    const plan = context.plans?.get(summary.recipeId);
    if (context.readiness !== "all") {
      const state = plan !== undefined ? recipeReadiness(plan) : doc ? fastDocumentReadiness(doc, sources) : null;
      if (context.readiness === "ready" && state?.kind !== "ready") return false;
      if (context.readiness === "attention" && (state === null || state.kind === "ready")) return false;
    }
    if (tokens.length === 0) return true;

    const rows = context.rows?.get(summary.recipeId) ?? [];
    const productIds = [
      ...(summary.boothProductIds ?? []).map(id => (id.startsWith("booth:") ? id : `booth:${id}`)),
      ...rows.flatMap(row => (row.productId ? [row.productId] : [])),
    ];
    const pictureTitles = productIds.flatMap(id => {
      const title = context.pictures?.get(id)?.title;
      return title ? [title] : [];
    });
    const docParts = doc
      ? [
          doc.avatar.prefabPath,
          ...doc.materials.map(item => item.packageName),
          ...doc.outfits.flatMap(outfit => [outfit.toggleName, outfit.prefabPath]),
          ...Object.keys(doc.packages),
        ]
      : [];
    const haystack = [summary.title, summary.avatarName ?? "", ...pictureTitles, ...docParts]
      .join(" ")
      .normalize("NFKC")
      .toLowerCase();
    return tokens.every(token => haystack.includes(token));
  });
}

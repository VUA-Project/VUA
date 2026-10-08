import type { GatewayClient } from "./gateway-client.ts";

/** Legacy Recipe adapter retained in Gateway composition. Library selections
 * use RecipeDraftPort; this permissive legacy shape is not a production schema. */

export interface RecipeListItem {
  readonly recipeId: string;
  readonly revision: number;
  readonly title: string;
  readonly updatedAt: string;
}

export interface RecipeDocument {
  readonly recipeId: string;
  readonly title: string;
  readonly assets: readonly RecipeAssetRef[];
  readonly relations?: readonly Record<string, unknown>[];
  [key: string]: unknown;
}

export interface RecipeAssetRef {
  /** 素材身份:云端商品引用 "booth:ID" 或本地工件引用 "sha256:..." */
  readonly identity: string;
  /** 人类可读名(卡片标题) */
  readonly displayName: string;
  /** 来源:cloud(目录卡) | local(仓库条目) */
  readonly source: "cloud" | "local";
  /** 可选变体标记 */
  readonly variantName?: string | null;
  /** 可选商店名 */
  readonly shopName?: string | null;
  /** Local selection identity; production conversion is still required. */
  readonly warehouseItemId?: string | null;
}

export interface RecipeSaveResult {
  readonly recipeId: string;
  readonly revision: number;
}

/** get 的完整读回:文档 + 当前修订号(写回的乐观并发基线) */
export interface RecipeRead {
  readonly document: RecipeDocument;
  readonly revision: number;
}

export interface RecipePort {
  list(): Promise<readonly RecipeListItem[]>;
  get(recipeId: string): Promise<RecipeRead | null>;
  save(recipeId: string, document: RecipeDocument, baseRevision: number): Promise<RecipeSaveResult>;
}

export function createLiveRecipePort(client: GatewayClient): RecipePort {
  return {
    async list() {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "recipe.list",
        params: {},
      });
      if (!result.ok) return [];
      const value = result.value as { entries?: unknown } | undefined;
      const entries = value?.entries;
      if (!Array.isArray(entries)) return [];
      return entries.filter(
        (entry): entry is RecipeListItem =>
          typeof entry === "object" && entry !== null && "recipeId" in entry && "title" in entry,
      );
    },
    async get(recipeId) {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "recipe.get",
        params: { recipeId },
      });
      if (!result.ok) return null;
      const value = result.value as
        | { recipeDocument?: unknown; revision?: unknown }
        | undefined;
      if (
        value?.recipeDocument === undefined
        || typeof value.recipeDocument !== "object"
        || typeof value.revision !== "number"
      ) {
        return null;
      }
      return { document: value.recipeDocument as RecipeDocument, revision: value.revision };
    },
    async save(recipeId, document, baseRevision) {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "recipe.save",
        params: {
          recipeDocument: { ...document, recipeId },
          baseRevision,
        },
      });
      if (!result.ok) throw new Error("recipe.save rejected");
      const value = result.value as { recipeId?: string; revision?: number } | undefined;
      return {
        recipeId: value?.recipeId ?? recipeId,
        revision: value?.revision ?? baseRevision,
      };
    },
  };
}

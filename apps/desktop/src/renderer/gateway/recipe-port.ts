import type { GatewayClient } from "./gateway-client.ts";

/**
 * Recipe 读/写端口(012 数据立场,2026-10-04 接通):
 * - list: 获取现有 Recipe 列表(供"加入 Recipe"小窗)
 * - get: 读取完整 Recipe 文档(含 assets 数组)
 * - save: 整文档提交 + baseRevision 乐观并发
 * - createFromSelection: 从选中的卡片墙条目新建 Recipe
 *
 * Recipe 文档是 AMF 生产域的声明式意图:assets 引用素材身份(云端商品
 * 引用 booth:ID 或本地工件引用 sha256),不含素材本体。写路径走既有
 * recipe.save 版本链,零新 wire 面。
 */

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
}

export interface RecipeSaveResult {
  readonly recipeId: string;
  readonly revision: number;
}

export interface RecipePort {
  list(): Promise<readonly RecipeListItem[]>;
  get(recipeId: string): Promise<RecipeDocument | null>;
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
      const value = result.value as { recipeDocument?: unknown } | undefined;
      if (value?.recipeDocument === undefined || typeof value.recipeDocument !== "object") {
        return null;
      }
      return value.recipeDocument as RecipeDocument;
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

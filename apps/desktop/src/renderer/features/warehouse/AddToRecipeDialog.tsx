import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { useGateway } from "../../gateway/GatewayProvider.tsx";
import type { RecipeAssetRef, RecipeDocument, RecipeListItem } from "../../gateway/recipe-port.ts";
import { format, strings } from "../../i18n/index.ts";

const copy = strings.warehouse.recipeDialog;

/**
 * 加入 Recipe 小窗(用户裁决 2026-10-04):
 * - 列表显示现有 Recipe + 每个的"已含 N 件"计数(精确身份幂等提示)
 * - 底部"从当前选择新建 Recipe"行 + 名称输入
 * - 点击 Recipe → 读取文档 → 幂等添加选中条目 → recipe.save 回写
 * - 云端卡 = 商品引用(booth:ID);本地条目 = 工件引用(sha256);
 *   同身份已存在 = 跳过并计入"已有"回执,不同变体 = 各自保留
 */
export function AddToRecipeDialog({
  open,
  onClose,
  selections,
}: {
  open: boolean;
  onClose: () => void;
  /** 选中条目(卡片墙多选或右键单选)→ 转好的 Recipe 素材引用 */
  selections: readonly RecipeAssetRef[];
}) {
  const gateway = useGateway();
  const [recipes, setRecipes] = useState<readonly RecipeListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  useEffect(() => {
    if (!open) return;
    setRecipes(null);
    setFeedback(null);
    setLoading(true);
    void gateway.recipe
      .list()
      .then((list) => setRecipes(list))
      .catch(() => setRecipes([]))
      .finally(() => setLoading(false));
  }, [open, gateway]);

  const addToRecipe = async (recipeId: string) => {
    setLoading(true);
    setFeedback(null);
    try {
      const read = await gateway.recipe.get(recipeId);
      const doc = read?.document;
      const baseRevision = read?.revision ?? 0;
      const existingAssets = (doc?.assets ?? []) as readonly RecipeAssetRef[];
      const existingIds = new Set(existingAssets.map((a) => a.identity));
      const fresh = selections.filter((s) => !existingIds.has(s.identity));
      const skipped = selections.length - fresh.length;
      const updatedDoc: RecipeDocument = {
        ...(doc ?? { recipeId, title: recipeId, assets: [] }),
        assets: [...existingAssets, ...fresh],
      };
      // 乐观并发基线 = 读回的修订号(人审 C13 修复 2026-10-06:此前硬编码
      // 0,对已存在配方的任何添加必然冲突被拒)
      await gateway.recipe.save(recipeId, updatedDoc, baseRevision);
      const parts: string[] = [];
      if (fresh.length > 0) parts.push(fresh.map((f) => f.displayName).join("、"));
      // 重复加入的反馈带配方现状(人审 2026-10-07:恒"已含 1 件"不表达
      // 「你要加的早已在库里」);i18n 化随文案批,这里先走 format
      if (skipped > 0) {
        parts.push(
          format(strings.warehouse.recipeDialog.alreadyInRecipe, {
            count: existingAssets.length,
          }),
        );
      }
      setFeedback(parts.length > 0 ? parts.join(" / ") : "全部已存在");
    } catch {
      setFeedback(strings.warehouse.states.loadFailedDescription);
    } finally {
      setLoading(false);
    }
  };

  const createNew = async () => {
    const title = newTitle.trim();
    if (title === "") return;
    setLoading(true);
    setFeedback(null);
    try {
      const recipeId = `recipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const doc: RecipeDocument = {
        recipeId,
        title,
        assets: [...selections],
      };
      await gateway.recipe.save(recipeId, doc, 0);
      setFeedback(`已创建「${title}」并加入 ${selections.length} 件`);
      setNewTitle("");
      void gateway.recipe.list().then(setRecipes);
    } catch {
      setFeedback(strings.warehouse.states.loadFailedDescription);
    } finally {
      setLoading(false);
    }
  };

  const selectionPreview = useMemo(
    () =>
      selections.length <= 3
        ? selections.map((s) => s.displayName).join("、")
        : `${selections.slice(0, 3).map((s) => s.displayName).join("、")}… 等 ${selections.length} 件`,
    [selections],
  );

  return (
    <ContentDialog
      open={open}
      title={copy.title}
      closeLabel={strings.common.dialogClose}
      onClose={onClose}
    >
      <div className="vua-add-to-recipe">
        <p className="vua-caption vua-text-secondary">{copy.selectionLabel}: {selectionPreview}</p>
        {loading && recipes === null ? (
          <div>
            <Skeleton width="100%" height={36} />
            <Skeleton width="100%" height={36} />
          </div>
        ) : recipes !== null && recipes.length > 0 ? (
          <ul className="vua-add-to-recipe__list" role="list">
            {recipes.map((r) => (
              <li key={r.recipeId}>
                <button
                  type="button"
                  className="vua-add-to-recipe__row"
                  disabled={loading}
                  onClick={() => void addToRecipe(r.recipeId)}
                >
                  <span className="vua-add-to-recipe__name">{r.title}</span>
                  <span className="vua-caption vua-text-secondary">{r.recipeId}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="vua-caption vua-text-secondary">{copy.noRecipes}</p>
        )}
        <div className="vua-add-to-recipe__new">
          <input
            type="text"
            className="vua-warehouse__search"
            placeholder={copy.newRecipePlaceholder}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createNew();
            }}
          />
          <Button variant="primary" disabled={loading || newTitle.trim() === ""} onClick={() => void createNew()}>
            {copy.newRecipeCta}
          </Button>
        </div>
        {feedback !== null ? (
          <p className="vua-caption" role="status">{feedback}</p>
        ) : null}
      </div>
    </ContentDialog>
  );
}

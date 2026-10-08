import { useEffect, useState } from "react";
import { recipeDrafts } from "../../app/recipe-draft-instance.ts";
import { recipePersisted } from "../../app/recipe-library-revision.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { RecipeDraftError, type RecipeAssetRef, type RecipeDraftSummary } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";
const copy = strings.warehouse.recipeDialog;

/** Collect references in selection drafts; production Recipe design remains separate. */
export function AddToRecipeDialog({ open, onClose, selections }: {
  open: boolean; onClose: () => void; selections: readonly RecipeAssetRef[];
}) {
  const [drafts, setDrafts] = useState<readonly RecipeDraftSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setDrafts(null); setFeedback(null); setFailed(false); setLoading(true);
    void recipeDrafts.list().then((list) => { if (active) setDrafts(list); }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, refresh]);
  const showFailure = (error: unknown) => setFeedback(error instanceof RecipeDraftError && error.code === "revision_conflict" ? copy.conflict : copy.loadFailed);
  const refreshList = async () => {
    try { setDrafts(await recipeDrafts.list()); setFailed(false); }
    catch { setFailed(true); }
  };
  const add = async (draftId: string) => {
    if (loading) return;
    setLoading(true); setFeedback(null);
    try {
      const current = await recipeDrafts.get(draftId);
      const saved = await recipeDrafts.add(draftId, selections, current.revision);
      recipePersisted();
      setFeedback(saved.addedCount === 0 ? format(copy.alreadyInRecipe, { count: saved.document.selections.length }) : format(copy.addedToDraft, { count: saved.addedCount }));
      await refreshList();
    } catch (error) { showFailure(error); } finally { setLoading(false); }
  };
  const create = async () => {
    const title = newTitle.trim(); if (title === "" || loading || selections.length === 0) return;
    setLoading(true); setFeedback(null);
    try {
      const id = `recipe-draft-${crypto.randomUUID()}`;
      const saved = await recipeDrafts.save(id, title, selections, 0);
      recipePersisted();
      setFeedback(format(copy.createdDraft, { title: saved.document.title, count: saved.document.selections.length }));
      setNewTitle(""); await refreshList();
    } catch (error) { showFailure(error); } finally { setLoading(false); }
  };
  const names = selections.slice(0, 3).map((selection) => selection.displayName).join(", ");
  const preview = selections.length > 3 ? format(copy.selectionMore, { names, count: selections.length }) : names;
  return <ContentDialog open={open} title={copy.title} closeLabel={strings.common.dialogClose} onClose={onClose}>
    <div className="vua-add-to-recipe">
      <p className="vua-caption vua-text-secondary">{copy.selectionLabel}: {preview}</p>
      <p className="vua-caption vua-text-secondary">{copy.draftNote}</p>
      {loading && drafts === null ? <><Skeleton width="100%" height={36} /><Skeleton width="100%" height={36} /></>
        : failed ? <div role="alert"><p>{copy.loadFailed}</p><Button variant="default" onClick={() => setRefresh((value) => value + 1)}>{strings.warehouse.detail.retry}</Button></div>
        : drafts !== null && drafts.length > 0 ? <ul className="vua-add-to-recipe__list" role="list">{drafts.map((draft) => <li key={draft.draftId}>
          <button type="button" className="vua-add-to-recipe__row" disabled={loading} onClick={() => void add(draft.draftId)}>
            <span className="vua-add-to-recipe__name">{draft.title}</span><span className="vua-caption vua-text-secondary">{format(copy.selectionCount, { count: draft.selectionCount })}</span>
          </button></li>)}</ul> : <p className="vua-caption vua-text-secondary">{copy.noRecipes}</p>}
      <div className="vua-add-to-recipe__new">
        <input type="text" maxLength={120} className="vua-warehouse__search" placeholder={copy.newRecipePlaceholder} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} />
        <Button variant="primary" disabled={loading || newTitle.trim() === "" || selections.length === 0} onClick={() => void create()}>{copy.newRecipeCta}</Button>
      </div>
      {feedback !== null ? <p className="vua-caption" role="status">{feedback}</p> : null}
    </div>
  </ContentDialog>;
}

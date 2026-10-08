import { useEffect, useState } from "react";
import type { RecipeDraftSelectionStatusV01 } from "@vua/contracts";
import { recipeDrafts } from "../../app/recipe-draft-instance.ts";
import { recipePersisted, useRecipeLibraryRevision } from "../../app/recipe-library-revision.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { RecipeDraftError, type RecipeAssetRef, type RecipeDraftRead, type RecipeDraftSummary } from "../../gateway/index.ts";
import { format, formatDateTime, strings } from "../../i18n/index.ts";

const copy = strings.warehouse.recipeDialog;

function DraftEditor({ draftId, onClose }: { draftId: string; onClose: () => void }) {
  const [current, setCurrent] = useState<RecipeDraftRead | null>(null);
  const [title, setTitle] = useState("");
  const [selections, setSelections] = useState<readonly RecipeAssetRef[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [fileStatus, setFileStatus] = useState<RecipeDraftSelectionStatusV01 | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [statusRefresh, setStatusRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true); setFeedback(null); setCurrent(null);
    void recipeDrafts.get(draftId).then((read) => {
      if (!active) return;
      setCurrent(read); setTitle(read.document.title); setSelections(read.document.selections); setDirty(false);
    }).catch(() => { if (active) setFeedback(copy.loadFailed); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [draftId, refresh]);
  useEffect(() => {
    if (current === null) return;
    let active = true; setFileStatus(null); setStatusFailed(false);
    void recipeDrafts.selectionStatus(draftId).then((status) => {
      if (!active) return;
      if (status.revision !== current.revision || status.items.length !== current.document.selections.length) { setStatusFailed(true); return; }
      setFileStatus(status);
    }).catch(() => { if (active) setStatusFailed(true); });
    return () => { active = false; };
  }, [draftId, current?.revision, refresh, statusRefresh]);
  useEffect(() => {
    const observe = () => setStatusRefresh((value) => value + 1);
    window.addEventListener("focus", observe);
    return () => window.removeEventListener("focus", observe);
  }, []);
  const selectionKey = (s: RecipeAssetRef) => JSON.stringify([s.source, s.identity, s.variantName ?? null, s.warehouseItemId ?? null]);
  const presenceText = (selection: RecipeAssetRef) => {
    if (statusFailed) return strings.warehouse.removeFiles.draftStatusFailed;
    const index = current?.document.selections.findIndex((saved) => selectionKey(saved) === selectionKey(selection));
    const fact = index === undefined || index < 0 ? undefined : fileStatus?.items[index];
    if (fact === undefined) return null;
    return fact.state === "present" ? strings.warehouse.removeFiles.draftPresent : fact.state === "missing" ? strings.warehouse.removeFiles.draftMissing : strings.warehouse.removeFiles.draftNotStored;
  };
  const save = async () => {
    if (current === null || busy || !dirty || title.trim() === "") return;
    setBusy(true); setFeedback(null);
    try {
      const saved = await recipeDrafts.save(draftId, title.trim(), selections, current.revision);
      setCurrent(saved); setTitle(saved.document.title); setSelections(saved.document.selections); setDirty(false);
      recipePersisted(); setFeedback(copy.savedDraft);
    } catch (error) {
      setFeedback(error instanceof RecipeDraftError && error.code === "revision_conflict" ? copy.conflict : copy.loadFailed);
    } finally { setBusy(false); }
  };
  return <ContentDialog open title={copy.libraryTitle} closeLabel={strings.common.dialogClose} onClose={() => { if (!busy) onClose(); }}>
    <div className="vua-page__stack">
      <p className="vua-caption vua-text-secondary">{copy.draftNote}</p>
      {busy && current === null ? <Skeleton width="100%" height={72} /> : null}
      {current !== null ? <>
        <label>{copy.nameLabel}<input type="text" className="vua-warehouse__search" maxLength={120} disabled={busy} value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} /></label>
        <p className="vua-caption">{format(copy.selectionCount, { count: selections.length })}</p>
        {selections.length === 0 ? <p className="vua-caption vua-text-secondary">{copy.emptyDraft}</p> : <ul className="vua-add-to-recipe__list">
          {selections.map((selection, index) => <li key={JSON.stringify([selection.source, selection.identity, selection.variantName, selection.warehouseItemId])} className="vua-page__actions">
            <span>{selection.displayName}{selection.variantName ? ` · ${selection.variantName}` : ""}<small className="vua-caption vua-text-secondary">{presenceText(selection)}</small></span>
            <Button variant="default" disabled={busy} onClick={() => { setSelections((refs) => refs.filter((_, position) => position !== index)); setDirty(true); }}>{copy.removeSelection}</Button>
          </li>)}
        </ul>}
        <Button variant="primary" disabled={busy || !dirty || title.trim() === ""} onClick={() => void save()}>{copy.saveDraft}</Button>
      </> : null}
      {feedback !== null ? <p role="status">{feedback}</p> : null}
      <Button variant="default" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>{copy.refreshDraft}</Button>
    </div>
  </ContentDialog>;
}

/** Selection drafts have their own read face and never select a production Recipe. */
export function RecipeDraftLibrary() {
  const revision = useRecipeLibraryRevision();
  const [drafts, setDrafts] = useState<readonly RecipeDraftSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setFailed(false); setDrafts(null);
    void recipeDrafts.list().then((entries) => { if (active) setDrafts(entries); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [revision, refresh]);
  return <Card><div className="vua-page__stack">
    <h2 className="vua-subtitle">{copy.libraryTitle}</h2>
    <p className="vua-caption vua-text-secondary">{copy.draftNote}</p>
    {failed ? <div role="alert"><p>{copy.loadFailed}</p><Button variant="default" onClick={() => setRefresh((value) => value + 1)}>{strings.warehouse.detail.retry}</Button></div>
      : drafts === null ? <Skeleton width="100%" height={40} />
      : drafts.length === 0 ? <p className="vua-caption vua-text-secondary">{copy.noRecipes}</p>
      : <ul className="vua-add-to-recipe__list">{drafts.map((draft) => <li key={draft.draftId} className="vua-page__actions">
        <span>{draft.title} · {format(copy.selectionCount, { count: draft.selectionCount })} · {formatDateTime(draft.updatedAt)}</span>
        <Button variant="default" onClick={() => setSelectedId(draft.draftId)}>{copy.openDraft}</Button>
      </li>)}</ul>}
    {selectedId !== null ? <DraftEditor key={selectedId} draftId={selectedId} onClose={() => setSelectedId(null)} /> : null}
  </div></Card>;
}

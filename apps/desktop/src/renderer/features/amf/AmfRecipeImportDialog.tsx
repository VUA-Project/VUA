import { RecipeContents } from "./RecipeContents.tsx";
import { RecipeUseCheck } from "./RecipeUseCheck.tsx";
import { useEffect, useState } from "react";
import type { AmfSharedRecipe, PendingRecipeShare, ReceivedRecipeLink } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { strings, format, recipeShareCopy, recipeShareError } from "../../i18n/index.ts";
import { recipeSharing } from "./recipe-sharing.ts";

const copy = strings.amfProduction;
export function AmfRecipeImportDialog({ onClose, onImported, onOpen, initial }: {
  onClose: () => void; onImported: () => void; onOpen: (recipeId: string) => void; initial?: PendingRecipeShare | null;
}) {
  const port = useGateway().amfProduction, sharing = recipeSharing();
  const [image, setImage] = useState<string | null>(null);
  const [contentRevision, setContentRevision] = useState(0);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<AmfSharedRecipe | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(recipeShareError(e));
  const change = (value: string) => {
    setText(value); setImage(null); setPreview(null); setSavedId(null); setError(null);
  };
  const receive = (value: ReceivedRecipeLink) => { setText(value.text); setPreview(value.document); setImage(value.preview); setError(null); setSavedId(null); };
  useEffect(() => {
    let alive = true;
    if (!initial) return;
    if ("received" in initial) receive(initial.received);
    else if ("error" in initial) fail(initial.error);
    else if (sharing) {
      setBusy(true);
      void sharing.readInput(initial.input).then(value => { if (alive) receive(value); }).catch(e => { if (alive) fail(e); }).finally(() => { if (alive) setBusy(false); });
    } else change(initial.input);
    return () => { alive = false; };
  }, [initial, sharing]);
  const readFiles = (files: readonly File[]) => {
    if (!sharing || busy || files.length !== 1) return;
    setBusy(true); setError(null);
    void sharing.readImage(files).then(receive).catch(fail).finally(() => setBusy(false));
  };
  return (
    <ContentDialog open title={copy.importRecipe} closeLabel={strings.common.dialogClose} onClose={() => { if (!busy) onClose(); }}>
      <div className="vua-recipe-transfer" data-share-drop onDragOver={event => { if (sharing && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); } }} onDrop={event => {
        const files = [...event.dataTransfer.files]; if (files.some(file => /\.(png|jpe?g|gif|webp)$/iu.test(file.name))) { event.preventDefault(); event.stopPropagation(); readFiles(files); }
      }}>
        {error && <p role="alert">{error}</p>}
        {savedId ? <>
          <p role="status">{copy.importDone}</p>
          <div className="vua-n3__actions">
            <Button variant="subtle" onClick={onClose}>{strings.common.dialogClose}</Button>
            <Button variant="primary" onClick={() => { onClose(); onOpen(savedId); }}>{copy.recipeOpen}</Button>
          </div>
        </> : preview ? <>
          {image && <img className="vua-share-photo" src={image} alt={preview.recipe.title}/>}
          <section className="vua-recipe-transfer__preview">
            <h3>{preview.recipe.title}</h3>
            <p>{format(copy.recipeSummary, { materials: preview.recipe.materials.length, outfits: preview.recipe.outfits.length })}</p>
            <RecipeContents recipe={preview.recipe} sources={preview.sources} revision={contentRevision}/>
            <RecipeUseCheck document={preview} onUpdated={() => setContentRevision(value => value + 1)}/>
          </section>
          <p className="vua-caption vua-text-secondary">{copy.shareStatement}</p>
          <div className="vua-n3__actions vua-recipe-transfer__footer">
            <Button disabled={busy} onClick={() => { setPreview(null); setError(null); }}>{copy.importEdit}</Button>
            <Button variant="primary" disabled={busy} onClick={() => {
              if (!port || busy) return;
              setBusy(true); setError(null);
              void port.importRecipe(text)
                .then(value => { setSavedId(value.recipe.recipeId); onImported(); })
                .catch(fail).finally(() => setBusy(false));
            }}>{copy.importSave}</Button>
          </div>
        </> : <>
          <p>{sharing ? recipeShareCopy.input : copy.importHint}</p>
          <label className="vua-n3__field">{copy.importPaste}
            <textarea rows={5} value={text} maxLength={349557} disabled={busy} onChange={event => change(event.target.value)}/>
          </label>
          <label className="vua-n3__field">{copy.importFile}
            <input type="file" accept=".json,.vuarecipe,.txt" disabled={busy} onChange={event => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (file.size > 262144) { setError(copy.shareFileLarge); return; }
              setBusy(true);
              void file.text().then(change).catch(fail).finally(() => setBusy(false));
            }}/>
          </label>
          {sharing && <label className="vua-n3__field">{recipeShareCopy.image}<input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" disabled={busy} onChange={e => readFiles([...e.target.files ?? []])}/></label>}
          <div className="vua-n3__actions">
            <Button variant="subtle" onClick={onClose}>{strings.common.dialogClose}</Button>
            <Button variant="primary" disabled={busy || !text.trim()} onClick={() => {
              if (!port || busy) return;
              setBusy(true); setError(null);
              const result = sharing ? sharing.readInput(text).then(receive) : port.previewRecipeShare(text).then(setPreview);
              void result.catch(fail).finally(() => setBusy(false));
            }}>{copy.importPreview}</Button>
          </div>
        </>}
      </div>
    </ContentDialog>
  );
}

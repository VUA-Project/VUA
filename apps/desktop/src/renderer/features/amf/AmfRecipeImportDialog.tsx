import { useState } from "react";
import type { AmfSharedRecipe } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { strings, format } from "../../i18n/index.ts";

const copy = strings.amfProduction;
export function AmfRecipeImportDialog({ onClose, onImported, onOpen }: {
  onClose: () => void; onImported: () => void; onOpen: (recipeId: string) => void;
}) {
  const port = useGateway().amfProduction;
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<AmfSharedRecipe | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : copy.taskFailed);
  const change = (value: string) => {
    setText(value); setPreview(null); setSavedId(null); setError(null);
  };
  return (
    <ContentDialog open title={copy.importRecipe} closeLabel={strings.common.dialogClose} onClose={onClose}>
      <div className="vua-recipe-transfer">
        {error && <p role="alert">{error}</p>}
        {savedId ? <>
          <p role="status">{copy.importDone}</p>
          <div className="vua-n3__actions">
            <Button variant="subtle" onClick={onClose}>{strings.common.dialogClose}</Button>
            <Button variant="primary" onClick={() => { onClose(); onOpen(savedId); }}>{copy.recipeOpen}</Button>
          </div>
        </> : preview ? <>
          <section className="vua-recipe-transfer__preview">
            <h3>{preview.recipe.title}</h3>
            <p>{format(copy.recipeSummary, { materials: preview.recipe.materials.length, outfits: preview.recipe.outfits.length })}</p>
            <ul>{preview.recipe.materials.map(material => (
              <li key={material.id}><span>{material.packageName}</span><small>{"BOOTH · " + preview.sources[material.id]}</small></li>
            ))}</ul>
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
          <p>{copy.importHint}</p>
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
          <div className="vua-n3__actions">
            <Button variant="subtle" onClick={onClose}>{strings.common.dialogClose}</Button>
            <Button variant="primary" disabled={busy || !text.trim()} onClick={() => {
              if (!port || busy) return;
              setBusy(true); setError(null);
              void port.previewRecipeShare(text).then(setPreview).catch(fail).finally(() => setBusy(false));
            }}>{copy.importPreview}</Button>
          </div>
        </>}
      </div>
    </ContentDialog>
  );
}

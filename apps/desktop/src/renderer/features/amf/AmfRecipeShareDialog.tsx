import { useEffect, useState } from "react";
import { useGateway, type AmfRecipeSharePlan, type AmfRecipeShareExport } from "../../gateway/index.ts";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { strings, format } from "../../i18n/index.ts";
import { boothSourceId } from "../warehouse/booth-source.ts";

const copy = strings.amfProduction;
type Product = { productId: string; title: string | null };
export function AmfRecipeShareDialog({ recipeId, onClose }: { recipeId: string; onClose: () => void }) {
  const port = useGateway().amfProduction;
  const [plan, setPlan] = useState<AmfRecipeSharePlan | null>(null);
  const [choices, setChoices] = useState<Record<string,string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [lookupMode, setLookupMode] = useState<"library" | "public" | "link">("library");
  const [products, setProducts] = useState<readonly Product[]>([]);
  const [output, setOutput] = useState<AmfRecipeShareExport | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!port) return;
    let alive = true; setBusy(true); setError(null);
    void port.recipeSharePlan(recipeId).then(value => {
      if (!alive) return;
      setPlan(value); setChoices({}); setOutput(null); setSelected(value.materials.filter(m => m.selectedProductId === null).map(m => m.materialId));
    }).catch(e => { if (alive) setError(e instanceof Error ? e.message : copy.taskFailed); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [port, recipeId, retry]);
  useEffect(() => {
    if (selected.length === 0 || lookupMode !== "library") return;
    let alive = true;
    const timer = setTimeout(() => { void catalogBrowser.list({ text: query.trim(), limit: 50 }).then(value => {
      if (alive) setProducts(value.kind === "results" ? value.items : []);
    }).catch(() => { if (alive) setProducts([]); }); }, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, selected.length, lookupMode]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : copy.taskFailed);
  const source = (material: AmfRecipeSharePlan["materials"][number]) => choices[material.materialId] ?? material.selectedProductId;
  const ready = plan?.materials.filter(material => source(material) !== null).length ?? 0;
  const lookup = async (fromLink: boolean) => {
    if (lookupBusy || busy) return;
    setLookupMode(fromLink ? "link" : "public"); setLookupBusy(true); setError(null);
    try {
      if (fromLink) {
        const id = boothSourceId(link);
        if (!id || !/^booth:[1-9][0-9]{0,19}$/u.test(id)) throw new Error(strings.warehouse.editSource.invalidId);
        const result = await window.vua?.catalogSync?.fetchProduct(id);
        if (!result?.ok) throw new Error(strings.warehouse.editSource.officialFailed);
        const detail = await catalogBrowser.detail(id);
        if (detail.kind !== "detail") throw new Error(strings.warehouse.editSource.officialFailed);
        setProducts([{productId: id, title: detail.product.title}]);
      } else {
        const result = await window.vua?.catalogSync?.searchProducts(query.trim());
        if (!result) throw new Error(strings.warehouse.sourceSearch.failed);
        setProducts(result.items);
      }
    } catch (e) { fail(e); }
    finally { setLookupBusy(false); }
  };
  const assign = (productId: string) => {
    const id = productId.replace(/^booth:/u, "");
    if (!/^[1-9][0-9]{0,19}$/u.test(id)) return;
    setChoices(value => ({...value, ...Object.fromEntries(selected.map(material => [material,id]))}));
    setSelected([]); setOutput(null); setNotice(null);
  };
  return <ContentDialog open title={copy.shareRecipe} closeLabel={strings.common.dialogClose} onClose={onClose}>
    <div className="vua-recipe-transfer">
      <p>{copy.shareHint}</p>
      {error && <div role="alert"><p>{error}</p><Button disabled={busy} onClick={() => setRetry(value => value + 1)}>{copy.retry}</Button></div>}
      {!plan ? <p role="status">{busy ? copy.loading : copy.shareSources}</p> : output ? <>
        <label className="vua-n3__field">{copy.shareOutput}<textarea readOnly value={output.shareCode} rows={5} onFocus={e => e.target.select()}/></label>
        <div className="vua-n3__actions">
          <Button disabled={busy || !window.vua?.dialog.copyRecipeShare} onClick={() => {
            if (busy) return; setBusy(true); setError(null);
            void window.vua?.dialog.copyRecipeShare?.(output.document).then(() => setNotice(copy.shareCopied)).catch(fail).finally(() => setBusy(false));
          }}>{copy.shareCopy}</Button>
          <Button disabled={busy || !window.vua?.dialog.saveRecipeShare} onClick={() => {
            if (busy) return; setBusy(true); setError(null);
            void window.vua?.dialog.saveRecipeShare?.(output.document).then(saved => { if (saved) setNotice(copy.shareFileSaved); }).catch(fail).finally(() => setBusy(false));
          }}>{copy.shareDownload}</Button>
        </div>
        {notice && <p role="status">{notice}</p>}
      </> : <>
        <h3>{copy.shareSources}</h3><p className="vua-caption vua-text-secondary">{copy.shareSourcesHint}</p>
        <div className="vua-n3__actions"><span>{format(copy.sourceDone,{count:ready})}</span><Button variant="subtle" disabled={busy} onClick={() => setShowAll(value => !value)}>{copy.allSources}</Button></div>
        <ul className="vua-recipe-transfer__materials" aria-label={copy.sourceSelect}>{plan.materials.filter(material => showAll || source(material) === null || selected.includes(material.materialId)).map(material =>
          <li key={material.materialId}><label><input type="checkbox" checked={selected.includes(material.materialId)} disabled={busy || lookupBusy} onChange={event => setSelected(value => event.target.checked ? [...value,material.materialId] : value.filter(id => id !== material.materialId))}/>
            <span><strong>{material.packageName}</strong><small>{source(material) ? "BOOTH · " + source(material) : copy.sourceMissing}</small></span></label>
            {material.candidates.length > 1 && <select aria-label={copy.sourceMissing + " · " + material.packageName} value={source(material) ?? ""} disabled={busy} onChange={event => {
              if (event.target.value) { setChoices(value => ({...value,[material.materialId]:event.target.value})); setSelected(value => value.filter(id => id !== material.materialId)); }
            }}><option value="">{copy.sourceMissing}</option>{material.candidates.map(id => <option key={id} value={id}>{"BOOTH · " + id}</option>)}</select>}
          </li>)}</ul>
        {selected.length > 0 && <section className="vua-recipe-transfer__picker">
          <h3>{copy.sourceChoose}</h3>
          <div className="vua-n3__actions"><input type="search" value={query} maxLength={200} placeholder={copy.sourceSearch} aria-label={copy.sourceSearch} disabled={busy || lookupBusy} onChange={event => { setQuery(event.target.value); setLookupMode("library"); }}/>
            <Button disabled={busy || lookupBusy || !query.trim()} onClick={() => { void lookup(false); }}>{copy.sourceSearchOnline}</Button></div>
          <ul className="vua-recipe-transfer__products">{products.map(product => <li key={product.productId}><span><strong>{product.title ?? product.productId}</strong><small>{product.productId}</small></span>
            <Button disabled={busy || lookupBusy} onClick={() => assign(product.productId)}>{copy.sourceUse}</Button></li>)}</ul>
          {products.length === 0 && <p className="vua-caption">{lookupBusy ? copy.loading : copy.sourceEmpty}</p>}
          <details><summary>{copy.sourceLink}</summary><label className="vua-n3__field">{copy.sourceLinkLabel}<input value={link} maxLength={500} disabled={busy || lookupBusy} onChange={event => setLink(event.target.value)}/></label>
            <Button disabled={busy || lookupBusy || !link.trim()} onClick={() => { void lookup(true); }}>{copy.sourceRead}</Button></details>
        </section>}
        <div className="vua-n3__actions">{ready !== plan.materials.length ? <Button variant="subtle" disabled={busy} onClick={() => setSelected(plan.materials.filter(m => source(m) === null).map(m => m.materialId))}>{copy.sourceAll}</Button> : <span/>}
          <Button variant="primary" disabled={busy || lookupBusy || ready !== plan.materials.length} onClick={() => {
            if (!port || busy) return; setBusy(true); setError(null);
            void port.exportRecipe(recipeId,plan.planDigest,choices).then(setOutput).catch(fail).finally(() => setBusy(false));
          }}>{copy.shareExport}</Button></div>
      </>}
      <p className="vua-caption vua-text-secondary">{copy.shareStatement}</p>
    </div>
  </ContentDialog>;
}

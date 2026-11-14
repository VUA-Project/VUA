/** The release room's terms check: a finished line's materials together against one use. */
import { useEffect, useMemo, useState } from "react";
import { isTermsProductId, TERMS_PRESET_IDS, type TermsBlockingItem, type TermsPresetId, type TermsUseCheckV01 } from "@vua/contracts";
import { useGateway, type AmfProductionRun, type AmfProductionSource } from "../../../gateway/index.ts";
import { format, strings } from "../../../i18n/index.ts";

const copy = strings.useTerms;
const line = copy.line;

/** The BOOTH products of the line's Avatar and outfits, each with the material name it came from. Dependencies such
 * as shaders carry their own licenses rather than VN3 terms. */
export function lineProducts(run: AmfProductionRun, sources: readonly AmfProductionSource[]): { products: ReadonlyMap<string, string>; unlinked: number } {
  const products = new Map<string, string>();
  let unlinked = 0;
  for (const used of run.sources.filter(source => source.role !== "dependency")) {
    const ids = (sources.find(source => source.sourceId === used.sourceId)?.productIds ?? []).filter(isTermsProductId);
    if (ids.length === 0) { unlinked += 1; continue; }
    for (const id of ids) if (!products.has(id)) products.set(id, used.itemName);
  }
  return { products, unlinked };
}

/** One blocking item in words: the item's name when it has one, then why it blocks. */
function blockerText(blocker: TermsBlockingItem): string {
  const reason = line.reasons[blocker.reason as keyof typeof line.reasons] ?? blocker.reason;
  return blocker.item ? `${blocker.item} ${copy.names[blocker.item as keyof typeof copy.names]}: ${reason}` : reason;
}

export function LineTerms({ run, sources, onOpenMaterials }: { run: AmfProductionRun; sources: readonly AmfProductionSource[]; onOpenMaterials: () => void }) {
  const port = useGateway().terms;
  const [presetId, setPresetId] = useState<TermsPresetId>("vrchat_personal");
  const [check, setCheck] = useState<TermsUseCheckV01 | null>(null);
  const { products, unlinked } = useMemo(() => lineProducts(run, sources), [run, sources]);
  // The album reads its list again while work runs; the check follows the products, not the list object.
  const key = [...products.keys()].join(" ");
  useEffect(() => {
    setCheck(null);
    if (!port || key === "") return;
    let alive = true;
    void port.checkUse(presetId, key.split(" ")).then(next => { if (alive) setCheck(next); }, () => {});
    return () => { alive = false; };
  }, [port, presetId, key]);
  if (!port) return null;
  const openMaterials = <button type="button" className="vua-release-upload__link" onClick={onOpenMaterials}>{line.library}</button>;
  if (key === "") return <section className="vua-album__block vua-line-terms">
    <h3>{line.title}</h3><p className="vua-caption vua-text-secondary">{line.none}</p>{openMaterials}
  </section>;
  const advisories = [...new Set(check?.combination.advisories.map(advisory => advisory.reason) ?? [])];
  return <section className="vua-album__block vua-line-terms">
    <h3>{line.title}</h3>
    <label className="vua-line-terms__use"><span>{line.use}</span>
      <select value={presetId} onChange={event => setPresetId(event.target.value as TermsPresetId)}>
        {TERMS_PRESET_IDS.map(id => <option key={id} value={id}>{copy.presets[id]}</option>)}
      </select>
    </label>
    {check && <>
      <p className="vua-line-terms__overall" data-decision={check.combination.decision}>{copy.decisions[check.combination.decision]}</p>
      <ul className="vua-line-terms__products">{check.products.map(product => <li key={product.productId} data-decision={product.decision}>
        <span>{products.get(product.productId) ?? product.productId}</span>
        <strong>{copy.decisions[product.decision]}</strong>
        {(product.blockingItems.length > 0 || product.conditions.length > 0) && <small>{[
          ...product.blockingItems.map(blockerText),
          ...product.conditions.map(condition => `${condition.item} ${copy.conditions[condition.condition]}`),
        ].join(" · ")}</small>}
      </li>)}</ul>
      {advisories.map(reason => <p key={reason} className="vua-caption vua-text-secondary">{line.advisories[reason as keyof typeof line.advisories] ?? reason}</p>)}
      {check.combination.hasSpecialNote && <p className="vua-caption">{line.special}</p>}
    </>}
    {unlinked > 0 && <p className="vua-caption vua-text-secondary">{format(line.unlinked, { count: String(unlinked) })}</p>}
    {openMaterials}
  </section>;
}

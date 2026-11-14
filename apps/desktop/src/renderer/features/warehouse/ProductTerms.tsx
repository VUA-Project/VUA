/** A product's VN3 terms in the library drawer: what each use allows, the creator's special note and every item. */
import { useCallback, useEffect, useRef, useState } from "react";
import { isTermsProductId, TERMS_PRESET_IDS, type ProductTermsV01, type TermItem, type TermsPresetId, type TermsUseDecision } from "@vua/contracts";
import { Button } from "../../components/primitives/Button.tsx";
import { useGateway, type TermsPort } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";
import { formatDateMinute } from "../../i18n/date-time.ts";
import { openExternalUrl } from "../../app/open-external.ts";

const copy = strings.useTerms;
const ENDED = ["completed", "completedWithWarnings", "failed", "cancelled"];
type Uses = Readonly<Partial<Record<TermsPresetId, TermsUseDecision>>>;

/** The value of one item in words, with its condition when it has one. */
export function itemValue(item: TermItem): string {
  const value = copy.values[item.value];
  return item.condition === null ? value : `${value} · ${copy.conditions[item.condition]}`;
}

/** Each use's decision for this product, read from recorded terms only. */
function useDecisions(port: TermsPort, productId: string, terms: ProductTermsV01 | null): Uses {
  const [uses, setUses] = useState<Uses>({});
  useEffect(() => {
    setUses({});
    if (terms === null || (terms.state !== "parsed" && terms.state !== "partial")) return;
    let alive = true;
    const requests = TERMS_PRESET_IDS.map(presetId => port.checkUse(presetId, [productId]).then(check => [presetId, check.combination] as const, () => null));
    void Promise.all(requests)
      .then(read => { if (alive) setUses(Object.fromEntries(read.filter(entry => entry !== null))); });
    return () => { alive = false; };
  }, [port, productId, terms]);
  return uses;
}

export function ProductTerms({ productId, title, onUpdated }: { productId: string; title: string; onUpdated?: () => void }) {
  const gateway = useGateway();
  const port = gateway.terms;
  const updated = useRef(onUpdated); updated.current = onUpdated;
  const [terms, setTerms] = useState<ProductTermsV01 | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!port || !isTermsProductId(productId)) return;
    try { setTerms(await port.product(productId)); } catch { setTerms(null); }
  }, [port, productId]);
  useEffect(() => { setTerms(null); setFailed(null); setReading(null); void load(); }, [load]);
  // A started reading is followed until its task ends, then the drawer reads the terms again.
  useEffect(() => {
    if (reading === null) return;
    const timer = setInterval(() => {
      void gateway.task.snapshot().then(view => {
        const task = view.tasks.find(item => item.id === reading);
        if (task !== undefined && !ENDED.includes(task.status)) return;
        setReading(null); void load().then(() => updated.current?.());
      }, () => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [gateway, reading, load]);
  const uses = useDecisions(port ?? NO_PORT, productId, port ? terms : null);
  if (!port || !isTermsProductId(productId) || terms === null) return null;
  const read = async () => {
    setFailed(null);
    try { setReading((await port.refreshProduct(productId, format(copy.readTask, { title }))).taskId); }
    catch (error) { setFailed(format(copy.readFailed, { reason: error instanceof Error ? error.message : "" })); }
  };
  const readable = terms.state === "parsed" || terms.state === "partial";
  const documentSource = terms.sources.find(source => source.document !== null && source.status === "parsed") ?? terms.sources.find(source => source.status !== "link_only") ?? null;
  const document = documentSource?.document ?? null;
  const links = terms.state === "link_only" ? terms.sources.filter(source => source.status === "link_only") : [];
  return <section className="vua-terms vua-warehouse-detail__section" aria-label={copy.title}>
    <div className="vua-warehouse-detail__section-head">
      <h3>{copy.title}</h3>
      <span className="vua-warehouse-detail__section-actions">
        {documentSource && <Button variant="subtle" onClick={() => { void openExternalUrl(documentSource.sourceUrl); }}>{copy.open}</Button>}
        <Button variant={terms.state === "not_observed" ? "default" : "subtle"} disabled={reading !== null} data-nav-id="warehouse-terms-read" onClick={() => { void read(); }}>
          {reading !== null ? copy.reading : terms.state === "not_observed" ? copy.read : copy.readAgain}</Button>
      </span>
    </div>
    {terms.state !== "parsed" && terms.state !== "not_observed" && <p className="vua-caption vua-text-secondary">{copy.state[terms.state]}</p>}
    {links.map(source => <button key={source.sourceId} type="button" className="vua-terms__link" onClick={() => { void openExternalUrl(source.sourceUrl); }}>{source.sourceUrl}</button>)}
    {readable && <>
      <ul className="vua-terms__uses" aria-label={copy.uses}>{TERMS_PRESET_IDS.map(presetId => {
        const use = uses[presetId];
        return <li key={presetId} data-decision={use?.decision ?? "pending"}>
          <span>{copy.presets[presetId]}</span>
          <strong>{use ? copy.decisions[use.decision] : "…"}</strong>
          {use && use.conditions.length > 0 && <small>{[...new Set(use.conditions.map(condition => copy.conditions[condition.condition]))].join(" · ")}</small>}
        </li>;
      })}</ul>
      {terms.specialNotes.map(note => <div key={note.sourceId} className="vua-terms__note"><p>{copy.special}</p><blockquote lang={note.language ?? undefined}>{note.text}</blockquote></div>)}
      <details className="vua-terms__items" open>
        <summary>{copy.items}</summary>
        <dl>{terms.effectiveItems.filter(item => item.item !== "X").map(item => <div key={item.item} data-value={item.value}>
          <dt><span aria-hidden="true">{item.item}</span> {copy.names[item.item as keyof typeof copy.names]}</dt>
          <dd>{itemValue(item)}</dd>
        </div>)}</dl>
      </details>
    </>}
    {documentSource && document?.vn3Version && documentSource.fetchedAt && <p className="vua-caption vua-text-secondary">
      {format(document.licensor ? copy.sourceBy : copy.source, { licensor: document.licensor ?? "", version: document.vn3Version, date: formatDateMinute(documentSource.fetchedAt) })}{readable ? ` · ${copy.final}` : ""}</p>}
    {failed && <p role="alert" className="vua-caption">{failed}</p>}
  </section>;
}

const NO_PORT: TermsPort = { product: () => Promise.reject(new Error("terms_unavailable")), checkUse: () => Promise.reject(new Error("terms_unavailable")),
  refreshProduct: () => Promise.reject(new Error("terms_unavailable")) };

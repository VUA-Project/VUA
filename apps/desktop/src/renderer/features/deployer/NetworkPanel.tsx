/** Compact website tests. Preferences belong to the renderer; observations come
 * only from the typed Gateway. Individual cards never clear unrelated results. */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@vua/design-system";
import { NETEASE_UU_URL, WEBSITE_TEST_LIMIT, type NetworkIntent, type NetworkRegion, type WebsiteObservation } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
import { format, strings } from "../../i18n/index.ts";
import { storageKeys } from "../../app/storage-keys.ts";
import { Card } from "../../components/primitives/Card.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { DEFAULT_TEST_WEBSITES, normalizeWebsiteUrl, parseTestWebsites, type TestWebsite } from "./website-model.ts";
import { brandGlyphPath } from "./website-glyphs.ts";
import "./website-tests.css";

const copy = strings.websiteTests;
type CardState = { readonly busy: true } | { readonly busy: false; readonly result?: WebsiteObservation };

/** 品牌站用 Simple Icons 官方字形(Simple Icons CC0),其余回落中性 globe;
 *  全部内联,不发远程 favicon 请求(测试前不暴露浏览行踪)。 */
function WebsiteGlyph({ url }: { url: string }) {
  const host = new URL(url).hostname;
  const brand = brandGlyphPath(host);
  return brand ? (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={brand} /></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.75" ry="8.5" />
      <path d="M3.5 12h17" />
    </svg>
  );
}

export function NetworkPanel({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const port = useGateway().environment.network;
  const [ready, setReady] = useState<boolean | null>(null);
  const [sites, setSites] = useState<readonly TestWebsite[]>(() => {
    try { return parseTestWebsites(localStorage.getItem(storageKeys.testWebsites)); } catch { return DEFAULT_TEST_WEBSITES; }
  });
  const [states, setStates] = useState<Record<string, CardState>>({});
  const pending = useRef(new Set<string>());
  const generation = useRef(0);
  const [editor, setEditor] = useState<{ original: string | null; name: string; url: string } | null>(null);
  const [formError, setFormError] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [region, setRegion] = useState<NetworkIntent["region"]>("auto");
  const [detected, setDetected] = useState<NetworkRegion>("unknown");
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    const ticket = ++generation.current;
    pending.current.clear(); setStates({}); setReady(null); setDetecting(false);
    if (port) void port.websiteCapability().then(c => { if (generation.current === ticket) setReady(c.state === "ready"); }, () => { if (generation.current === ticket) setReady(false); });
    else setReady(false);
    return () => { generation.current++; };
  }, [port]);

  const saveSites = (next: readonly TestWebsite[]) => {
    setSites(next);
    try { localStorage.setItem(storageKeys.testWebsites, JSON.stringify(next)); setStorageFailed(false); }
    catch { setStorageFailed(true); }
  };
  const test = async (selected: readonly TestWebsite[]) => {
    if (!port || !ready) return;
    const urls = selected.map(s => s.url).filter(url => !pending.current.has(url));
    if (!urls.length) return;
    const ticket = generation.current;
    urls.forEach(url => pending.current.add(url));
    setStates(previous => ({ ...previous, ...Object.fromEntries(urls.map(url => [url, { busy: true }])) }));
    try {
      const results = await port.testWebsites(urls);
      if (ticket === generation.current) setStates(previous => ({ ...previous,
        ...Object.fromEntries(results.map(result => [result.url, { busy: false, result }])) }));
    } catch {
      if (ticket === generation.current) setStates(previous => ({ ...previous,
        ...Object.fromEntries(urls.map(url => [url, { busy: false }])) }));
    } finally { if (ticket === generation.current) urls.forEach(url => pending.current.delete(url)); }
  };
  const saveEditor = (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    const url = normalizeWebsiteUrl(editor.url);
    const name = editor.name.trim();
    if (!url || !name || name.length > 40 || sites.some(s => s.url !== editor.original && s.url === url)) { setFormError(true); return; }
    const next = { name, url };
    saveSites(editor.original ? sites.map(s => s.url === editor.original ? next : s) : [...sites, next]);
    setStates(previous => { const next = { ...previous }; if (editor.original) delete next[editor.original]; return next; });
    setEditor(null);
  };
  // Region advice is secondary and opt-in. Opening this page sends no probes.
  const detectRegion = async () => {
    if (!port || detecting) return;
    const ticket = generation.current;
    setDetecting(true);
    try { const report = await port.check({ route: "desktop_play", region: "auto" });
      if (ticket === generation.current) setDetected(report.detectedRegion);
    } catch { if (ticket === generation.current) setDetected("unknown"); }
    finally { if (ticket === generation.current) setDetecting(false); }
  };

  if (!port && !compact) return null;
  const busy = Object.values(states).some(state => state.busy);
  return <>
    {compact ? <article className="vua-environment-card vua-network-tile">
      <button type="button" className="vua-environment-card__details" data-nav-id="play-network-details" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span className="vua-route-tile__icon" aria-hidden="true"><Icon name="gauge" size={24} /></span><strong>{strings.environmentCards.network}</strong>
        <span className="vua-network-tile__results">{sites.slice(0, 3).map(site => { const state = states[site.url]; return <span key={site.url}>{site.name}<span>{state?.busy ? copy.testing : state?.result ? copy.statuses[state.result.status] : "—"}</span></span>; })}</span>
      </button>
      <button type="button" className="vua-environment-card__action" data-nav-id="play-network-test" disabled={!ready || busy || !sites.length} aria-label={copy.testAll} aria-busy={busy} onClick={() => void test(sites)}>
        <span className={busy ? "vua-environment-card__spin" : undefined} aria-hidden="true"><Icon name="refresh" size={24} /></span><span role="status">{busy ? copy.testing : ready === false ? copy.unavailable : copy.testAll}</span>
      </button>
    </article> : null}
    <Card className="vua-network" hidden={compact && !expanded}>
    <header className="vua-network__header">
      {/* 仪表盘字形:本面板测的是到站耗时(ms),不是信号有无 */}
      <span className="vua-network__heading-icon"><Icon name="gauge" size={24} /></span><h2>{copy.title}</h2>
      <div className="vua-network__toolbar">
        <button type="button" className="vua-network__icon-button" title={copy.testAll} aria-label={copy.testAll}
          disabled={!ready || busy || !sites.length} onClick={() => { void test(sites); }}><Icon name="refresh" size={20} /></button>
        <button type="button" className="vua-network__icon-button" title={copy.add} aria-label={copy.add}
          disabled={sites.length >= WEBSITE_TEST_LIMIT} onClick={() => { setFormError(false); setEditor({ original: null, name: "", url: "" }); }}><Icon name="add" size={20} /></button>
      </div>
    </header>
    <ul className="vua-network__cards">{sites.map(site => {
      const state = states[site.url];
      const result = state && !state.busy ? state.result : undefined;
      const label = state?.busy ? copy.testing : result ? result.status === "reachable"
        ? format(copy.milliseconds, { ms: result.elapsedMs })
        : result.httpStatus !== null ? format(copy.httpStatus, { code: result.httpStatus }) : copy.statuses[result.status]
        : state ? copy.statuses.probe_error : copy.test;
      return <li className="vua-network__site" key={site.url}>
        <button type="button" className="vua-network__edit" title={copy.edit} aria-label={format(copy.editSite, { name: site.name })}
          disabled={state?.busy} onClick={() => { setFormError(false); setEditor({ original: site.url, ...site }); }}>⋯</button>
        <span className="vua-network__site-icon"><WebsiteGlyph url={site.url} /></span><strong title={site.url}>{site.name}</strong>
        <button type="button" className="vua-network__test" disabled={!ready || state?.busy} data-result={result?.status}
          aria-label={format(copy.testSite, { name: site.name })}
          title={result ? format(copy.resultDetail, { status: strings.network.statuses[result.status], ms: result.elapsedMs }) : site.url}
          onClick={() => { void test([site]); }}><span role="status">{label}</span></button>
      </li>;
    })}</ul>
    {!sites.length ? <p className="vua-network__note">{copy.empty}</p> : null}
    {ready === false ? <p className="vua-network__note" role="status">{copy.unavailable}</p> : null}
    {storageFailed ? <p className="vua-network__note" role="status">{copy.storageFailed}</p> : null}
    <details className="vua-network__help"><summary>{copy.help}</summary><p>{copy.scope}</p>
      <label>{strings.network.regionUse}<select value={region} onChange={e => setRegion(e.target.value as NetworkIntent["region"])}>
        <option value="auto">{strings.network.autoRegion}</option><option value="china_mainland">{strings.network.regions.china_mainland}</option><option value="other">{strings.network.regions.other}</option>
      </select></label>
      {region === "auto" ? <><Button variant="subtle" disabled={detecting} onClick={() => { void detectRegion(); }}>{detecting ? copy.testing : copy.detectRegion}</Button><p>{strings.network.regions[detected]}</p><p>{strings.network.privacy}</p></> : null}
      {(region === "china_mainland" || region === "auto" && detected === "china_mainland") ? <aside>
        <h3>{strings.network.uuTitle}</h3><p>{strings.network.uuSteps}</p><p>{strings.network.uuAffiliation}</p>
        <a href={NETEASE_UU_URL} target="_blank" rel="noopener noreferrer">{strings.network.openUu}</a>
      </aside> : null}
      <p>{strings.network.lagRegion}</p><p>{strings.network.lagPerformance}</p>
    </details>
  </Card><ContentDialog open={editor !== null} title={editor?.original ? copy.edit : copy.add} closeLabel={copy.cancel} onClose={() => setEditor(null)}>
      {editor ? <form className="vua-network__form" onSubmit={saveEditor}>
        <label>{copy.name}<input autoFocus required maxLength={40} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label>
        <label>{copy.url}<input required maxLength={2048} placeholder="https://" value={editor.url} onChange={e => setEditor({ ...editor, url: e.target.value })} /></label>
        {formError ? <p role="alert">{copy.invalid}</p> : null}
        <div className="vua-network__form-actions">
          {editor.original ? <Button variant="subtle" onClick={() => { saveSites(sites.filter(s => s.url !== editor.original)); setEditor(null); }}>{copy.remove}</Button> : null}
          <Button variant="subtle" onClick={() => setEditor(null)}>{copy.cancel}</Button><Button variant="primary" type="submit">{copy.save}</Button>
        </div>
      </form> : null}
    </ContentDialog>
  </>;
}

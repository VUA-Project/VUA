import { useEffect, useRef, useState } from "react";
import { Icon } from "@vua/design-system";
import { DESKTOP_BROWSER_SITES_V1, type DesktopBrowserSiteIdV1, type RemoteContentViewStateV1 } from "@vua/contracts";
import { strings } from "../i18n/index.ts";
import { displayUrl } from "../features/import/import-model.ts";
import { Button } from "./primitives/Button.tsx";
import { BrowserFrame } from "./BrowserFrame.tsx";
import "../features/import/import-page.css";

export function SiteBrowser({ purpose, onClose }: { purpose: "assets" | "knowledge"; onClose: () => void }) {
  const initial: DesktopBrowserSiteIdV1 = purpose === "assets" ? "booth" : "vrchat-wiki";
  const [site, setSite] = useState<DesktopBrowserSiteIdV1 | null>(initial);
  const [view, setView] = useState<RemoteContentViewStateV1 | null>(null);
  const viewRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<number | "unavailable" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failedPage, setFailedPage] = useState(false);
  const copy = strings.browser;
  const nav = strings.importPage;
  useEffect(() => {
    const browser = window.vua?.desktopBrowser;
    if (!browser) { setFailure("unavailable"); setLoading(false); return; }
    let disposed = false;
    let opened: string | null = null;
    const unsubscribe = browser.events.subscribe(event => {
      if (event.viewId !== viewRef.current) return;
      if (event.kind === "navigated") {
        setView(current => current && ({ ...current, url: event.url, canGoBack: event.canGoBack, canGoForward: event.canGoForward }));
        const host = event.url ? new URL(event.url).hostname : "";
        setSite(DESKTOP_BROWSER_SITES_V1.find(entry => {
          const expected = new URL(entry.url).hostname;
          return host === expected || host.endsWith(`.${expected}`);
        })?.id ?? null);
      }
      else if (event.kind === "loading") { setLoading(event.loading); if (event.loading) { setFailure(null); setFailedPage(false); } }
      else if (event.kind === "load-failed") { setFailure(event.code); setFailedPage(true); setLoading(false); }
      else if (event.kind === "view-closed") { viewRef.current = null; setView(null); setFailure("unavailable"); setLoading(false); }
    });
    setFailure(null); setLoading(true); setFailedPage(false);
    void browser.open(initial).then(state => {
      if (disposed) { void browser.close(state.viewId); return; }
      opened = state.viewId; viewRef.current = state.viewId; setView({ ...state, url: state.url || DESKTOP_BROWSER_SITES_V1.find(entry => entry.id === initial)!.url });
    }).catch(() => { if (!disposed) { setFailure("unavailable"); setLoading(false); } });
    return () => { disposed = true; unsubscribe(); if (opened) void browser.close(opened).catch(() => {}); viewRef.current = null; };
  }, [initial, attempt]);

  const action = (command: "goBack" | "goForward" | "reload") => {
    const current = viewRef.current;
    if (!current) { setAttempt(value => value + 1); return; }
    setFailure(null); setFailedPage(false); setLoading(true);
    void window.vua?.desktopBrowser?.[command](current).catch(() => { setFailure("unavailable"); setLoading(false); });
  };
  const selectSite = (id: DesktopBrowserSiteIdV1) => {
    if (!view) return;
    setSite(id); setLoading(true); setFailure(null); setFailedPage(false);
    void window.vua?.desktopBrowser?.navigate(view.viewId, id).catch(() => { setFailure("unavailable"); setLoading(false); });
  };
  const error = <div className="vua-browser-frame__error" role="status"><p>{failure === "unavailable" ? copy.unavailable : copy.failed}</p>
    <Button onClick={() => action("reload")}>{copy.retry}</Button><Button variant="subtle" onClick={onClose}>{nav.navClose}</Button></div>;
  if (!view) return failure !== null ? error : <p role="status">{copy.loading}</p>;
  return <BrowserFrame viewId={view.viewId} hideContent={failedPage} status={failedPage ? error : undefined}>
    <div className="vua-browser-frame__bar" role="toolbar" aria-label={nav.navBarAria}>
      {(["goBack", "goForward", "reload"] as const).map((command, index) => <button key={command} type="button" className="vua-import__browse-button"
        aria-label={[nav.navBack, nav.navForward, nav.navReload][index]} title={[nav.navBack, nav.navForward, nav.navReload][index]}
        disabled={command === "goBack" ? !view.canGoBack : command === "goForward" ? !view.canGoForward : false} onClick={() => action(command)}>
        <Icon name={command === "goBack" ? "arrow-left" : command === "goForward" ? "arrow-right" : "refresh"} size={16} />
      </button>)}
      <span className="vua-import__browse-url" title={view.url}>{displayUrl(view.url)}</span>
      {loading ? <span className="vua-browser-frame__status" role="status">{copy.loading}</span> : null}
      <button type="button" className="vua-import__browse-button" aria-label={nav.navClose} title={nav.navClose} onClick={onClose}><Icon name="close" size={16} /></button>
    </div>
    {purpose === "assets" ? <nav className="vua-browser-frame__shortcuts" aria-label={copy.shortcuts}>
      {DESKTOP_BROWSER_SITES_V1.filter(entry => entry.purpose === "assets").map(entry => <button type="button" key={entry.id} data-browser-site={entry.id}
        aria-current={site === entry.id ? "true" : undefined} title={entry.url} onClick={() => selectSite(entry.id)}>{entry.name}</button>)}
    </nav> : null}
    {failure !== null ? <div className="vua-browser-frame__status" role="status">{copy.failed} <Button variant="subtle" onClick={() => action("reload")}>{copy.retry}</Button></div> : null}
  </BrowserFrame>;
}

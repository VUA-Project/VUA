import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "@vua/design-system";
import { DESKTOP_BROWSER_SITES_V1, DESKTOP_BROWSER_TAB_LIMIT } from "@vua/contracts";
import { format, strings } from "../i18n/index.ts";
import { displayUrl } from "../features/import/import-model.ts";
import { Button } from "./primitives/Button.tsx";
import { BrowserFrame } from "./BrowserFrame.tsx";
import { siteBrowserSession, type BrowserPurpose, type BrowserTab } from "./site-browser-session.ts";
import "../features/import/import-page.css";

const ASSET_SITES = DESKTOP_BROWSER_SITES_V1.filter(entry => entry.purpose === "assets");

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function SiteBrowser({
  purpose,
  onClose,
  barExtra,
  homeHero,
  freeAssetsView,
  freeAssetsTitle,
  banner,
}: {
  purpose: BrowserPurpose;
  onClose: () => void;
  barExtra?: ReactNode;
  homeHero?: ReactNode;
  freeAssetsView?: ReactNode;
  freeAssetsTitle?: string;
  banner?: ReactNode;
}) {
  const session = useMemo(() => siteBrowserSession(window.vua?.desktopBrowser, purpose), [purpose]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    session.ensureInitial();
  }, [session]);

  const copy = strings.browser;
  const nav = strings.importPage;
  const tab = state.tabs.find(entry => entry.id === state.activeId);

  const label = (entry: BrowserTab) => {
    if (entry.kind === "home") return copy.homeTab;
    if (entry.kind === "free-assets") return freeAssetsTitle ?? copy.newTab;
    return (
      entry.title ||
      DESKTOP_BROWSER_SITES_V1.find(site => site.id === entry.site)?.name ||
      (entry.view?.url ? displayUrl(entry.view.url) : copy.newTab)
    );
  };

  const closeTab = (id: string) => {
    const closingSoleKnowledge = purpose === "knowledge" && state.tabs.length === 1;
    session.close(id);
    if (closingSoleKnowledge) onClose();
  };

  if (!tab) {
    return (
      <Button
        variant="primary"
        data-browser-reopen
        onClick={() => (purpose === "assets" ? session.openHome() : session.open())}
      >
        {purpose === "assets" ? copy.reopen : copy.wiki}
      </Button>
    );
  }

  const isLocalTab = tab.kind === "home" || tab.kind === "free-assets";
  const soleHomeTab = purpose === "assets" && state.tabs.length === 1 && tab.kind === "home";

  const error = (
    <div className="vua-browser-frame__error" role="status">
      <p>{tab.failure === "unavailable" ? copy.unavailable : copy.failed}</p>
      <div className="vua-browser-frame__error-actions">
        <Button disabled={tab.loading} onClick={() => session.action(tab.id, "reload")}>
          {copy.retry}
        </Button>
        {purpose === "assets" ? (
          <Button variant="subtle" data-browser-error-home onClick={() => session.goHome(tab.id)}>
            {copy.homeButton}
          </Button>
        ) : null}
        <Button variant="subtle" onClick={() => closeTab(tab.id)}>
          {nav.navClose}
        </Button>
      </div>
    </div>
  );

  const status = isLocalTab
    ? undefined
    : !tab.view
      ? tab.failure !== null
        ? error
        : <p role="status">{copy.loading}</p>
      : tab.failedPage
        ? error
        : undefined;

  const addressText =
    tab.kind === "home"
      ? copy.addressHome
      : tab.kind === "free-assets"
        ? copy.addressFreeAssets
        : tab.view
          ? displayUrl(tab.view.url)
          : DESKTOP_BROWSER_SITES_V1.find(site => site.id === tab.site)?.url ?? "";

  const localContent =
    purpose === "assets" ? (
      <>
        <div className="vua-browser-home" data-browser-home hidden={tab.kind !== "home"}>
          {homeHero}
          <section className="vua-browser-home__section" aria-label={copy.shortcuts}>
            <h2 className="vua-browser-home__heading">{copy.homeSitesHeading}</h2>
            <div className="vua-browser-home__grid">
              {ASSET_SITES.map(entry => (
                <button
                  type="button"
                  key={entry.id}
                  className="vua-browser-home__site"
                  data-browser-site={entry.id}
                  title={entry.url}
                  onClick={event => {
                    if (event.ctrlKey || event.metaKey) session.open(entry.id);
                    else session.openSiteOnTab(tab.id, entry.id);
                  }}
                  onAuxClick={event => {
                    if (event.button === 1) {
                      event.preventDefault();
                      session.open(entry.id);
                    }
                  }}
                >
                  <span className="vua-browser-home__site-head">
                    <span className="vua-browser-home__site-mark" aria-hidden="true">
                      {entry.name.slice(0, 1)}
                    </span>
                    <span className="vua-browser-home__site-meta">
                      <strong className="vua-browser-home__site-name">{entry.name}</strong>
                      <small className="vua-browser-home__site-host">{hostnameOf(entry.url)}</small>
                    </span>
                  </span>
                  <span className="vua-browser-home__site-desc">{copy.siteDescriptions[entry.id]}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
        {freeAssetsView}
      </>
    ) : undefined;

  return (
    <BrowserFrame
      viewId={isLocalTab ? null : (tab.view?.viewId ?? null)}
      hideContent={!isLocalTab && (tab.failedPage || !tab.view)}
      showLocalContent={isLocalTab}
      localContent={localContent}
      status={status}
    >
      <div className="vua-browser-frame__tabs" role="tablist" aria-label={copy.tabs}>
        {state.tabs.map(entry => {
          const entrySoleHome = purpose === "assets" && state.tabs.length === 1 && entry.kind === "home";
          return (
            <div
              key={entry.id}
              className="vua-browser-frame__tab"
              data-active={entry.id === state.activeId ? "true" : undefined}
              data-tab-kind={entry.kind}
            >
              <button
                type="button"
                role="tab"
                aria-selected={entry.id === state.activeId}
                data-browser-tab={entry.id}
                title={label(entry)}
                onClick={() => session.activate(entry.id)}
              >
                {entry.kind === "home" ? (
                  <Icon name="home" size={16} />
                ) : entry.kind === "free-assets" ? (
                  <Icon name="search" size={16} />
                ) : null}
                <span>{label(entry)}</span>
                {entry.loading ? <Icon name="refresh" size={16} /> : null}
              </button>
              {!entrySoleHome ? (
                <button
                  type="button"
                  data-browser-close-tab={entry.id}
                  className="vua-browser-frame__tab-close"
                  aria-label={format(copy.closeTab, { title: label(entry) })}
                  title={nav.navClose}
                  onClick={() => closeTab(entry.id)}
                >
                  <Icon name="close" size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="vua-browser-frame__new-tab"
          data-browser-new-tab
          aria-label={copy.newTab}
          title={copy.newTab}
          disabled={state.tabs.length >= DESKTOP_BROWSER_TAB_LIMIT}
          onClick={() => (purpose === "assets" ? session.openHome() : session.open())}
        >
          <Icon name="add" size={16} />
        </button>
      </div>

      <div className="vua-browser-frame__bar" role="toolbar" aria-label={nav.navBarAria}>
        {(["goBack", "goForward", "reload"] as const).map((command, index) => (
          <button
            key={command}
            type="button"
            className="vua-import__browse-button"
            aria-label={[nav.navBack, nav.navForward, nav.navReload][index]}
            title={[nav.navBack, nav.navForward, nav.navReload][index]}
            disabled={
              command === "goBack"
                ? !tab.view?.canGoBack
                : command === "goForward"
                  ? !tab.view?.canGoForward
                  : tab.kind !== "web" || tab.loading
            }
            onClick={() => session.action(tab.id, command)}
          >
            <Icon name={command === "goBack" ? "arrow-left" : command === "goForward" ? "arrow-right" : "refresh"} size={16} />
          </button>
        ))}
        {purpose === "assets" ? (
          <button
            type="button"
            className="vua-import__browse-button"
            data-browser-home-btn
            aria-label={copy.homeButton}
            title={copy.homeButton}
            aria-current={tab.kind === "home" ? "true" : undefined}
            onClick={() => session.goHome(tab.id)}
          >
            <Icon name="home" size={16} />
          </button>
        ) : null}
        <div className="vua-browser-frame__address" data-kind={tab.kind}>
          <span className="vua-import__browse-url" title={tab.view?.url}>
            {addressText}
          </span>
          {tab.loading ? (
            <span className="vua-browser-frame__loading" role="status">
              {copy.loading}
            </span>
          ) : null}
        </div>
        {barExtra}
        <button
          type="button"
          className="vua-import__browse-button vua-import__browse-button--close"
          aria-label={nav.navClose}
          title={nav.navClose}
          disabled={soleHomeTab}
          onClick={() => closeTab(tab.id)}
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {banner}
      {state.limitReached ? (
        <p className="vua-browser-frame__status" role="status">
          {copy.tabLimit}
        </p>
      ) : null}
      {tab.view && tab.failure !== null ? (
        <div className="vua-browser-frame__status" role="status">
          {copy.failed}{" "}
          <Button variant="subtle" disabled={tab.loading} onClick={() => session.action(tab.id, "reload")}>
            {copy.retry}
          </Button>
        </div>
      ) : null}
    </BrowserFrame>
  );
}

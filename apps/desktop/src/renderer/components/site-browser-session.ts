import {
  DESKTOP_BROWSER_SITES_V1,
  DESKTOP_BROWSER_TAB_LIMIT,
  desktopBrowserBoothItemUrl,
  type DesktopBrowserApiV1,
  type DesktopBrowserEventV1,
  type DesktopBrowserSiteIdV1,
  type RemoteContentViewStateV1,
} from "@vua/contracts";

export type BrowserPurpose = "assets" | "knowledge";
export type BrowserTabKind = "home" | "free-assets" | "web";

export interface BrowserTab {
  readonly id: string;
  readonly kind: BrowserTabKind;
  readonly view: RemoteContentViewStateV1 | null;
  readonly site: DesktopBrowserSiteIdV1 | null;
  readonly pendingItemId?: string | undefined;
  readonly title: string;
  readonly loading: boolean;
  readonly failure: number | "unavailable" | null;
  readonly failedPage: boolean;
}

export interface BrowserSessionState {
  readonly tabs: readonly BrowserTab[];
  readonly activeId: string | null;
  readonly initialized: boolean;
  readonly limitReached: boolean;
}

function siteForUrl(value: string): DesktopBrowserSiteIdV1 | null {
  try {
    const host = new URL(value).hostname;
    return DESKTOP_BROWSER_SITES_V1.find(entry => {
      const expected = new URL(entry.url).hostname;
      return host === expected || host.endsWith(`.${expected}`);
    })?.id ?? null;
  } catch {
    return null;
  }
}

function boothItemIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (url.hostname !== "booth.pm" && !url.hostname.endsWith(".booth.pm"))) return null;
    const match = /^(?:\/(?:ja|en|ko|zh-cn|zh-tw))?\/items\/([1-9][0-9]{0,19})\/?$/iu.exec(url.pathname);
    return match ? `booth:${match[1]}` : null;
  } catch {
    return null;
  }
}

function createLocalTab(kind: "home" | "free-assets"): BrowserTab {
  return {
    id: crypto.randomUUID(),
    kind,
    view: null,
    site: null,
    title: "",
    loading: false,
    failure: null,
    failedPage: false,
  };
}

/** Presentation state lives for this renderer session. Native pages/history/scroll
 * remain in Main. No URLs, titles or browser history are written to storage. */
export class SiteBrowserSession {
  readonly purpose: BrowserPurpose;
  readonly initial: DesktopBrowserSiteIdV1;
  readonly #api: DesktopBrowserApiV1 | undefined;
  readonly #listeners = new Set<() => void>();
  readonly #early = new Map<string, DesktopBrowserEventV1[]>();
  #state: BrowserSessionState = { tabs: [], activeId: null, initialized: false, limitReached: false };

  constructor(api: DesktopBrowserApiV1 | undefined, purpose: BrowserPurpose) {
    this.#api = api;
    this.purpose = purpose;
    this.initial = purpose === "assets" ? "booth" : "vrchat-wiki";
    api?.events.subscribe(event => this.#event(event));
  }

  getSnapshot = (): BrowserSessionState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #write(state: BrowserSessionState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  #patch(id: string, patch: Partial<BrowserTab>): void {
    if (!this.#state.tabs.some(tab => tab.id === id)) return;
    this.#write({
      ...this.#state,
      tabs: this.#state.tabs.map(tab => (tab.id === id ? { ...tab, ...patch } : tab)),
    });
  }

  ensureInitial = (): void => {
    if (this.#state.initialized) return;
    if (this.purpose === "assets") {
      const home = createLocalTab("home");
      this.#write({ tabs: [home], activeId: home.id, initialized: true, limitReached: false });
      return;
    }
    this.open(this.initial);
  };

  openHome = (): void => {
    if (this.#state.tabs.length >= DESKTOP_BROWSER_TAB_LIMIT) {
      this.#write({ ...this.#state, limitReached: true });
      return;
    }
    const home = createLocalTab("home");
    this.#write({
      tabs: [...this.#state.tabs, home],
      activeId: home.id,
      initialized: true,
      limitReached: false,
    });
  };

  goHome = (id: string): void => {
    const tab = this.#state.tabs.find(entry => entry.id === id);
    if (!tab || tab.kind === "home") return;
    const previousView = tab.view;
    this.#write({
      ...this.#state,
      tabs: this.#state.tabs.map(entry =>
        entry.id === id
          ? {
              id,
              kind: "home",
              view: null,
              site: null,
              pendingItemId: undefined,
              title: "",
              loading: false,
              failure: null,
              failedPage: false,
            }
          : entry,
      ),
      limitReached: false,
    });
    if (previousView) void this.#api?.close(previousView.viewId).catch(() => {});
  };

  openFreeAssets = (): void => {
    const existing = this.#state.tabs.find(tab => tab.kind === "free-assets");
    if (existing) {
      this.activate(existing.id);
      return;
    }
    const active = this.#state.tabs.find(tab => tab.id === this.#state.activeId);
    if (active?.kind === "home") {
      this.#write({
        ...this.#state,
        tabs: this.#state.tabs.map(entry =>
          entry.id === active.id
            ? {
                ...entry,
                kind: "free-assets",
                view: null,
                site: null,
                pendingItemId: undefined,
                title: "",
                loading: false,
                failure: null,
                failedPage: false,
              }
            : entry,
        ),
        activeId: active.id,
        initialized: true,
        limitReached: false,
      });
      return;
    }
    if (this.#state.tabs.length >= DESKTOP_BROWSER_TAB_LIMIT) {
      const spareHome = this.#state.tabs.find(tab => tab.kind === "home");
      if (spareHome) {
        this.#write({
          ...this.#state,
          tabs: this.#state.tabs.map(entry =>
            entry.id === spareHome.id
              ? {
                  ...entry,
                  kind: "free-assets",
                  view: null,
                  site: null,
                  pendingItemId: undefined,
                  title: "",
                  loading: false,
                  failure: null,
                  failedPage: false,
                }
              : entry,
          ),
          activeId: spareHome.id,
          limitReached: false,
        });
        return;
      }
      this.#write({ ...this.#state, limitReached: true });
      return;
    }
    const freeTab = createLocalTab("free-assets");
    this.#write({
      tabs: [...this.#state.tabs, freeTab],
      activeId: freeTab.id,
      initialized: true,
      limitReached: false,
    });
  };

  openSiteOnTab = (id: string, site: DesktopBrowserSiteIdV1): void => {
    const tab = this.#state.tabs.find(entry => entry.id === id);
    if (!tab) {
      this.open(site);
      return;
    }
    if (tab.view !== null) {
      this.navigate(id, site);
      return;
    }
    if (tab.kind === "web" && tab.loading) return;
    this.#write({
      ...this.#state,
      tabs: this.#state.tabs.map(entry =>
        entry.id === id
          ? {
              id,
              kind: "web",
              view: null,
              site,
              pendingItemId: undefined,
              title: "",
              loading: true,
              failure: null,
              failedPage: false,
            }
          : entry,
      ),
      limitReached: false,
    });
    this.#openView(id, site);
  };

  open = (site: DesktopBrowserSiteIdV1 = this.initial): void => {
    if (this.#state.tabs.length >= DESKTOP_BROWSER_TAB_LIMIT) {
      this.#write({ ...this.#state, limitReached: true });
      return;
    }
    const id = crypto.randomUUID();
    this.#write({
      tabs: [
        ...this.#state.tabs,
        { id, kind: "web", view: null, site, title: "", loading: true, failure: null, failedPage: false },
      ],
      activeId: id,
      initialized: true,
      limitReached: false,
    });
    this.#openView(id, site);
  };

  openBoothItem = (productId: string): void => {
    const itemUrl = desktopBrowserBoothItemUrl(productId);
    if (itemUrl === null) return;
    const existing = this.#state.tabs.find(
      tab => tab.pendingItemId === productId || (tab.view !== null && boothItemIdFromUrl(tab.view.url) === productId),
    );
    if (existing) {
      this.activate(existing.id);
      return;
    }
    if (this.#state.tabs.length >= DESKTOP_BROWSER_TAB_LIMIT) {
      const spareHome = this.#state.tabs.find(tab => tab.kind === "home" && tab.id !== this.#state.activeId);
      if (spareHome) {
        this.#write({
          ...this.#state,
          tabs: this.#state.tabs.map(entry =>
            entry.id === spareHome.id
              ? {
                  id: spareHome.id,
                  kind: "web",
                  view: null,
                  site: "booth",
                  pendingItemId: productId,
                  title: "",
                  loading: true,
                  failure: null,
                  failedPage: false,
                }
              : entry,
          ),
          activeId: spareHome.id,
          limitReached: false,
        });
        this.#openItemView(spareHome.id, productId);
        return;
      }
      this.#write({ ...this.#state, limitReached: true });
      return;
    }
    const id = crypto.randomUUID();
    this.#write({
      tabs: [
        ...this.#state.tabs,
        {
          id,
          kind: "web",
          view: null,
          site: "booth",
          pendingItemId: productId,
          title: "",
          loading: true,
          failure: null,
          failedPage: false,
        },
      ],
      activeId: id,
      initialized: true,
      limitReached: false,
    });
    this.#openItemView(id, productId);
  };

  #openView(id: string, site: DesktopBrowserSiteIdV1): void {
    if (!this.#api) {
      this.#patch(id, { failure: "unavailable", loading: false });
      return;
    }
    void this.#api.open(site).then(view => {
      const current = this.#state.tabs.find(tab => tab.id === id);
      if (!current || current.kind !== "web") {
        void this.#api!.close(view.viewId).catch(() => {});
        return;
      }
      this.#patch(id, {
        view: { ...view, url: view.url || DESKTOP_BROWSER_SITES_V1.find(entry => entry.id === site)!.url },
      });
      const events = this.#early.get(view.viewId) ?? [];
      this.#early.delete(view.viewId);
      if (!this.#state.tabs.some(tab => tab.loading && !tab.view)) this.#early.clear();
      for (const event of events) this.#event(event);
    }).catch(() => this.#patch(id, { failure: "unavailable", loading: false }));
  }

  #openItemView(id: string, productId: string): void {
    const itemUrl = desktopBrowserBoothItemUrl(productId);
    if (!itemUrl || !this.#api?.openBoothItem) {
      this.#patch(id, { failure: "unavailable", loading: false });
      return;
    }
    void this.#api.openBoothItem(productId).then(view => {
      const current = this.#state.tabs.find(tab => tab.id === id);
      if (!current || current.kind !== "web") {
        void this.#api!.close(view.viewId).catch(() => {});
        return;
      }
      this.#patch(id, { view: { ...view, url: view.url || itemUrl }, pendingItemId: undefined });
      const events = this.#early.get(view.viewId) ?? [];
      this.#early.delete(view.viewId);
      if (!this.#state.tabs.some(tab => tab.loading && !tab.view)) this.#early.clear();
      for (const event of events) this.#event(event);
    }).catch(() => this.#patch(id, { failure: "unavailable", loading: false }));
  }

  activate = (id: string): void => {
    if (this.#state.tabs.some(tab => tab.id === id)) {
      this.#write({ ...this.#state, activeId: id, limitReached: false });
    }
  };

  close = (id: string): void => {
    const index = this.#state.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const removed = this.#state.tabs[index]!;
    const remaining = this.#state.tabs.filter(tab => tab.id !== id);
    if (remaining.length === 0 && this.purpose === "assets") {
      if (removed.kind === "home") return;
      const home = createLocalTab("home");
      this.#write({ ...this.#state, tabs: [home], activeId: home.id, initialized: true, limitReached: false });
    } else {
      const activeId =
        this.#state.activeId === id
          ? remaining[Math.min(index, remaining.length - 1)]?.id ?? null
          : this.#state.activeId;
      this.#write({ ...this.#state, tabs: remaining, activeId, limitReached: false });
    }
    if (removed.view) void this.#api?.close(removed.view.viewId).catch(() => {});
  };

  navigate = (id: string, site: DesktopBrowserSiteIdV1): void => {
    const tab = this.#state.tabs.find(entry => entry.id === id);
    if (!tab?.view || !this.#api) return;
    this.#patch(id, { loading: true, failure: null, failedPage: false });
    void this.#api.navigate(tab.view.viewId, site).catch(() =>
      this.#patch(id, { failure: "unavailable", loading: false }),
    );
  };

  action = (id: string, command: "goBack" | "goForward" | "reload"): void => {
    const tab = this.#state.tabs.find(entry => entry.id === id);
    if (!tab || tab.kind !== "web" || (!tab.view && tab.loading)) return;
    this.#patch(id, { loading: true, failure: null, failedPage: false });
    if (!tab.view) {
      if (tab.pendingItemId) this.#openItemView(id, tab.pendingItemId);
      else this.#openView(id, tab.site ?? this.initial);
      return;
    }
    void this.#api?.[command](tab.view.viewId).catch(() =>
      this.#patch(id, { failure: "unavailable", loading: false }),
    );
  };

  #event(event: DesktopBrowserEventV1): void {
    if (event.kind === "download-completed") return;
    if (event.kind === "tab-opened") {
      const parent = this.#state.tabs.find(tab => tab.view?.viewId === event.parentViewId);
      if (!parent) return;
      if (this.#state.tabs.length >= DESKTOP_BROWSER_TAB_LIMIT) {
        void this.#api?.close(event.viewId).catch(() => {});
        this.#write({ ...this.#state, limitReached: true });
        return;
      }
      const id = crypto.randomUUID();
      this.#write({
        ...this.#state,
        tabs: [
          ...this.#state.tabs,
          {
            id,
            kind: "web",
            site: siteForUrl(event.url),
            title: "",
            loading: true,
            failure: null,
            failedPage: false,
            view: { viewId: event.viewId, url: event.url, canGoBack: false, canGoForward: false, visible: false },
          },
        ],
        activeId: id,
        limitReached: false,
      });
      return;
    }
    const tab = this.#state.tabs.find(entry => entry.view?.viewId === event.viewId);
    if (!tab) {
      // Native loading/title events can arrive before the open IPC receipt.
      if (this.#state.tabs.some(entry => entry.loading && !entry.view) && this.#early.size < 16) {
        const events = this.#early.get(event.viewId) ?? [];
        this.#early.set(event.viewId, [...events.slice(-15), event]);
      }
      return;
    }
    if (event.kind === "navigated") {
      this.#patch(tab.id, {
        view: { ...tab.view!, url: event.url, canGoBack: event.canGoBack, canGoForward: event.canGoForward },
        site: siteForUrl(event.url),
        title: "",
      });
    } else if (event.kind === "loading") {
      this.#patch(tab.id, {
        loading: event.loading,
        ...(event.loading ? { failure: null, failedPage: false } : {}),
      });
    } else if (event.kind === "load-failed") {
      this.#patch(tab.id, { failure: event.code, failedPage: true, loading: false });
    } else if (event.kind === "title-updated") {
      this.#patch(tab.id, { title: event.title });
    } else if (event.kind === "view-closed") {
      const index = this.#state.tabs.indexOf(tab);
      const tabs = this.#state.tabs.filter(entry => entry.id !== tab.id);
      this.#write({
        ...this.#state,
        tabs,
        activeId:
          this.#state.activeId === tab.id ? tabs[Math.min(index, tabs.length - 1)]?.id ?? null : this.#state.activeId,
        limitReached: false,
      });
    } else if (event.kind === "tab-limit") {
      this.#write({ ...this.#state, limitReached: true });
    }
  }
}

const sessions = new WeakMap<DesktopBrowserApiV1, Partial<Record<BrowserPurpose, SiteBrowserSession>>>();
export function siteBrowserSession(api: DesktopBrowserApiV1 | undefined, purpose: BrowserPurpose): SiteBrowserSession {
  if (!api) return new SiteBrowserSession(undefined, purpose);
  let owned = sessions.get(api);
  if (!owned) {
    owned = {};
    sessions.set(api, owned);
  }
  return (owned[purpose] ??= new SiteBrowserSession(api, purpose));
}

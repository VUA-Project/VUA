import { useEffect, useMemo, useReducer, useState, useSyncExternalStore, type FormEvent } from "react";
import { Icon } from "@vua/design-system";
import { isFreeAssetKeywordV01, type FreeAssetsStateV01 } from "@vua/contracts";
import { SiteBrowser } from "../../components/SiteBrowser.tsx";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { format, strings } from "../../i18n/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import { siteBrowserSession } from "../../components/site-browser-session.ts";
import { useAmfModule, useGateway, useTaskCenter } from "../../gateway/index.ts";
import { boothSourceId } from "../warehouse/booth-source.ts";
import { FreeAssetsView, type RequestedFreeAssetSearch } from "./FreeAssetsView.tsx";
import {
  browserDownloadBannerReducer,
  INITIAL_BROWSER_DOWNLOAD_BANNER,
  selectHeroQuickKeywords,
} from "./free-assets-model.ts";
import { MaterialsStartDialog } from "./MaterialsStartDialog.tsx";
import "./free-assets.css";

/** Top-level embedded asset browser: opens on a zero-network Browser Homepage with
 * community site shortcuts and BOOTH Free instant Avatar-scoped ¥0 discovery. */
export function AssetBrowserPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [heroInput, setHeroInput] = useState("");
  const [freeAssetsSnapshot, setFreeAssetsSnapshot] = useState<FreeAssetsStateV01 | null>(null);
  const [requestedSearch, setRequestedSearch] = useState<RequestedFreeAssetSearch | null>(null);
  const [downloadBanner, dispatchDownloadBanner] = useReducer(
    browserDownloadBannerReducer,
    INITIAL_BROWSER_DOWNLOAD_BANNER,
  );

  const freeCopy = strings.freeAssets;
  const start = strings.factory.materialsStart;
  const amf = useAmfModule();
  const gateway = useGateway();
  const taskCenter = useTaskCenter();
  const amfReady = amf.state === "ready" && gateway.amfProduction !== undefined;
  const session = useMemo(() => siteBrowserSession(window.vua?.desktopBrowser, "assets"), []);
  const browserState = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    session.ensureInitial();
  }, [session]);

  useEffect(() => {
    let alive = true;
    if (!gateway.freeAssets) return undefined;
    void gateway.freeAssets.state().then(next => {
      if (alive && next !== null) setFreeAssetsSnapshot(next);
    });
    return () => {
      alive = false;
    };
  }, [gateway.freeAssets, refreshToken]);

  useEffect(() => {
    const browser = window.vua?.desktopBrowser;
    if (!browser) return undefined;
    return browser.events.subscribe(event => {
      if (event.kind === "download-completed") {
        dispatchDownloadBanner({
          type: "download-completed",
          downloadId: event.downloadId,
          suggestedFileName: event.suggestedFileName,
        });
      }
    });
  }, []);

  useEffect(() => {
    const taskId = downloadBanner.adoptingTaskId;
    if (taskId === null) return;
    const task = taskCenter.tasks.find(entry => entry.id === taskId);
    if (!task) return;
    if (task.status === "completed" || task.status === "completedWithWarnings") {
      dispatchDownloadBanner({ type: "adopt-succeeded" });
      setRefreshToken(value => value + 1);
    } else if (task.status === "failed" || task.status === "cancelled") {
      dispatchDownloadBanner({ type: "adopt-failed" });
    }
  }, [downloadBanner.adoptingTaskId, taskCenter.tasks]);

  const activeTab = browserState.tabs.find(tab => tab.id === browserState.activeId);
  const hasFreeAssetsTab = browserState.tabs.some(tab => tab.kind === "free-assets");
  const activeUrl = activeTab?.view?.url ?? null;
  const productId = activeUrl === null ? null : boothSourceId(activeUrl);
  const [offer, setOffer] = useState<{ productId: string; title: string | null; imageUrl: string | null } | null>(null);
  const [startOpen, setStartOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setOffer(null);
    if (productId === null || !amfReady) return undefined;
    const face = window.vua?.catalogSync;
    // Observe title/images first; a failed observation falls back to stored facts.
    void (face?.fetchProduct(productId) ?? Promise.resolve({ ok: false }))
      .then(() => catalogBrowser.detail(productId))
      .then(view => {
        if (!alive || view.kind !== "detail") return;
        setOffer({ productId, title: view.product.title, imageUrl: view.product.imageUrl });
      })
      .catch(() => {
        /* No observed product, no offer. */
      });
    return () => {
      alive = false;
    };
  }, [productId, amfReady]);

  const openFreeAssetsTab = () => {
    setRefreshToken(value => value + 1);
    session.openFreeAssets();
  };

  const triggerHeroSearch = (keyword: string) => {
    const trimmed = keyword.trim();
    if (!isFreeAssetKeywordV01(trimmed)) {
      openFreeAssetsTab();
      return;
    }
    setRequestedSearch(previous => ({ id: (previous?.id ?? 0) + 1, keyword: trimmed }));
    session.openFreeAssets();
  };

  const handleHeroSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitted = heroInput.trim();
    setHeroInput("");
    triggerHeroSearch(submitted);
  };

  const handleAdoptDownloads = async () => {
    if (downloadBanner.pending.length === 0 || downloadBanner.adoptingTaskId !== null) return;
    const ids = downloadBanner.pending.map(entry => entry.downloadId);
    const outcome = await gateway.warehouseCommands.importDownloads(ids);
    if (outcome.ok && "accepted" in outcome) {
      dispatchDownloadBanner({ type: "adopt-started", taskId: outcome.accepted.taskId });
    } else {
      dispatchDownloadBanner({ type: "adopt-failed" });
    }
  };

  const latestDownloadName =
    downloadBanner.pending.at(-1)?.suggestedFileName ?? freeCopy.downloadFallbackName;

  const offerBannerNode =
    offer !== null && !startOpen && activeTab?.kind === "web" ? (
      <div className="vua-start__browse vua-start__browse--bar">
        <span title={offer.title ?? offer.productId}>{offer.title ?? offer.productId}</span>
        <Button variant="primary" onClick={() => setStartOpen(true)}>
          {start.startCta}
        </Button>
      </div>
    ) : null;

  const adoptBannerNode =
    downloadBanner.pending.length > 0 || downloadBanner.completedNotice ? (
      <div className="vua-download-adopt-bar" role="status" data-download-adopt-bar>
        <span className="vua-download-adopt-bar__text">
          <Icon name={downloadBanner.completedNotice ? "check" : "download"} size={16} />
          <span>
            {downloadBanner.completedNotice
              ? freeCopy.adoptedDone
              : downloadBanner.adoptingTaskId !== null
                ? freeCopy.adoptingStatus
                : downloadBanner.pending.length === 1
                  ? format(freeCopy.downloadReadyOne, { name: latestDownloadName })
                  : format(freeCopy.downloadReadyMany, {
                      count: downloadBanner.pending.length,
                      name: latestDownloadName,
                    })}
          </span>
        </span>
        <span className="vua-download-adopt-bar__actions">
          {downloadBanner.pending.length > 0 ? (
            <Button
              variant="primary"
              data-download-adopt-action
              disabled={downloadBanner.adoptingTaskId !== null}
              onClick={() => void handleAdoptDownloads()}
            >
              {downloadBanner.adoptingTaskId !== null ? freeCopy.adoptingStatus : freeCopy.adoptAction}
            </Button>
          ) : null}
          <Button
            variant="subtle"
            aria-label={freeCopy.dismissDownload}
            title={freeCopy.dismissDownload}
            onClick={() => dispatchDownloadBanner({ type: "dismiss" })}
          >
            <Icon name="close" size={16} />
          </Button>
        </span>
      </div>
    ) : null;

  const heroQuickKeywords = useMemo(
    () => selectHeroQuickKeywords(freeAssetsSnapshot),
    [freeAssetsSnapshot],
  );

  const homeHeroNode = (
    <section className="vua-free-assets-hero" data-free-assets-hero aria-label={freeCopy.title}>
      <div className="vua-free-assets-hero__head">
        <div className="vua-free-assets-hero__title-group">
          <div className="vua-free-assets-hero__title-row">
            <Badge tone="brand">{freeCopy.freeBadge}</Badge>
            <h1 className="vua-free-assets-hero__title">{freeCopy.title}</h1>
          </div>
          <p className="vua-free-assets-hero__subtitle">{freeCopy.heroSubtitle}</p>
        </div>
        <Button variant="subtle" data-free-assets-hero-open onClick={openFreeAssetsTab}>
          <span>{freeCopy.openBoothFree}</span>
          <Icon name="arrow-right" size={16} />
        </Button>
      </div>

      <form className="vua-free-assets__form" data-free-assets-hero-form onSubmit={handleHeroSubmit}>
        <div className="vua-free-assets__search-box">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="vua-free-assets__input"
            maxLength={80}
            value={heroInput}
            placeholder={freeCopy.searchPlaceholder}
            aria-label={freeCopy.searchPlaceholder}
            onChange={event => setHeroInput(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" data-free-assets-hero-submit>
          <Icon name="search" size={16} />
          <span>{freeCopy.searchAction}</span>
        </Button>
      </form>

      {heroQuickKeywords.length > 0 ? (
        <div className="vua-free-assets__chips">
          <span className="vua-free-assets__meta">{freeCopy.suggestedLabel}</span>
          {heroQuickKeywords.map(keyword => (
            <button
              key={keyword}
              type="button"
              className="vua-free-assets__pill"
              data-free-assets-hero-chip={keyword}
              onClick={() => triggerHeroSearch(keyword)}
            >
              <Icon name="avatar" size={16} />
              <span>{keyword}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );

  return (
    <div className="vua-page" data-focus-scope>
      <SiteBrowser
        purpose="assets"
        onClose={() => {}}
        freeAssetsTitle={freeCopy.title}
        barExtra={
          <button
            type="button"
            className="vua-browser-frame__mode-switch"
            data-free-assets-open
            aria-pressed={activeTab?.kind === "free-assets"}
            onClick={openFreeAssetsTab}
          >
            <Icon name="search" size={16} />
            <span>{freeCopy.title}</span>
          </button>
        }
        homeHero={homeHeroNode}
        freeAssetsView={
          hasFreeAssetsTab ? (
            <FreeAssetsView
              port={gateway.freeAssets}
              refreshToken={refreshToken}
              hidden={activeTab?.kind !== "free-assets"}
              requestedSearch={requestedSearch}
              onStateLoaded={setFreeAssetsSnapshot}
              onBrowseSites={() => {
                if (activeTab) session.goHome(activeTab.id);
              }}
              onOpenBoothItem={targetProductId => {
                session.openBoothItem(targetProductId);
              }}
            />
          ) : null
        }
        banner={
          offerBannerNode !== null || adoptBannerNode !== null ? (
            <>
              {offerBannerNode}
              {adoptBannerNode}
            </>
          ) : null
        }
      />
      {startOpen && offer !== null ? (
        <MaterialsStartDialog avatar={offer} onNavigate={onNavigate} onClose={() => setStartOpen(false)} />
      ) : null}
    </div>
  );
}

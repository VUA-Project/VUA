import type { LibraryFormatFilterV03, LibrarySort } from "@vua/contracts";
import { LibraryDetailBar, LibraryDetailLoading, ProductDetail } from "./LibraryDetail.tsx";
import { LibraryVn3Filter } from "./LibraryVn3Filter.tsx";
import { libraryViewCopy } from "../../i18n/library-view-copy.ts";
import { priceLabel, sortFactLabel } from "./library-text.ts";
import {
  DEFAULT_LIBRARY_SORT, libraryFiltersActive, neighboursOf, nextHeaderSort, NO_VN3_CHOICE, offeredLibrarySorts, readLibrarySession, rememberLibrarySort, rememberLibraryView, saveLibrarySession, sortFactOf,
  storedLibrarySort, storedLibraryView, vn3ChoiceActive, vn3FilterWire, type LibraryVn3Choice, type LibraryViewMode,
  shownVariant,
  historyDetail,
  type LibraryDetailEntry,
  syncHistoryDetail,
} from "./library-view-model.ts";
import { SegmentBar } from "../../components/SegmentBar.tsx";
import { useEscapeClose } from "../../components/use-escape-close.ts";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { isCatalogSyncSnapshotV03, isLibraryDownloadSnapshotV01, type CatalogSyncSnapshotV03, type BoothSearchResultV01 } from "@vua/contracts";
import { catalogSyncNotice, startSignedInCatalogSync, type CatalogAccountState, type CatalogSyncNotice } from "./catalog-sync-model.ts";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import { libraryBrowser } from "../../app/library-browser-instance.ts";
import { browseWindowSupported, openBrowseWindow } from "../../app/browse-window.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import {
  ContextMenu,
  type ContextMenuState,
} from "../../components/primitives/ContextMenu.tsx";
import { Icon } from "@vua/design-system";
import {
  useAcquireView,
  useGateway,
  useTaskCenter,
  useDataSource,
  type LibraryPageView,
  type LibraryCardFacts,
  type CatalogDetailView,
  type CatalogErrorKey,
  type CatalogListView,
  type CatalogProductSummary,
  createLibraryMetadataPort,
} from "../../gateway/index.ts";
import { currentLocale, format, strings } from "../../i18n/index.ts";
import { structureCopy } from "../../i18n/structure-copy.ts";
import type { PageId } from "../../app/nav-model.ts";
import { MaterialsStartDialog } from "../amf/MaterialsStartDialog.tsx";
import type { MaterialsStartAvatar } from "../amf/materials-start-model.ts";
import { useAmfModule } from "../../gateway/index.ts";
import { useCardSpotlight } from "./use-card-spotlight.ts";
import type { RecipeAssetRef } from "../../gateway/index.ts";
import { AddToRecipeDialog } from "./AddToRecipeDialog.tsx";
import { LibraryListRow, libraryListSource, useLibraryColumns } from "./LibraryList.tsx";
import { LIBRARY_BATCH, LIBRARY_READ_MAX, moreRowsExist, readLibraryRange, refreshLibraryHead, rowsLoaded, wallRows } from "./library-pages.ts";
import { boothCategoryLabel } from "../../i18n/booth-category-copy.ts";
import { registerTaskIdentity } from "../../gateway/index.ts";
import { CardAlbumMedia } from "./WarehouseAlbum.tsx";
import { MaterialEntryCard, EntryDetail } from "./WarehouseAcquire.tsx";
import { EditSourceDialog } from "./EditSourceDialog.tsx";
import { RemoveCardsDialog, type RemovalCard } from "./RemoveCardsDialog.tsx";
import { entryCardMatches, entryCards, inferGlobalDefaultMode } from "./acquire-model.ts";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { ImportPage } from "../import/ImportPage.tsx";
import { LocalImportButton } from "../import/LocalImportButton.tsx";
import { LibraryMigrationPreview } from "../import/LibraryMigrationPreview.tsx";
import {
  catalogEmptyCard,
  emptyWarehouseQuery,
  toPortQuery,
  type WarehouseQueryState,
} from "./warehouse-model.ts";
import { BOOTH_SIGN_IN_URL } from "../import/import-model.ts";
import { openLoginBrowser, useLoginBrowserRequest } from "../../app/login-browser-store.ts";
import { useDownloadChecklist } from "../../app/download-checklist-flag.ts";
import { DownloadChecklistDialog } from "./DownloadChecklistDialog.tsx";
import { RemoveFilesDialog, type RemovalDialogTarget } from "./RemoveFilesDialog.tsx";
import { BulkDownloadDialog } from "./BulkDownloadDialog.tsx";
import { BulkRemoveFilesDialog } from "./BulkRemoveFilesDialog.tsx";
import { removalScopes, type BulkProduct, type BulkDownloadMode } from "./bulk-file-model.ts";
import { boothProductUrl } from "./booth-source.ts";
import { LibraryCorner } from "./LibraryCorner.tsx";
import { libraryCornerState, type LibraryCornerState, type LocalSourceSearchState } from "./library-corner-model.ts";
import { DelayedStatus } from "../../components/primitives/DelayedStatus.tsx";
import { boothSearchKeyword, exactBoothMatch } from "./booth-match-model.ts";
import { BoothMatchDialog } from "./BoothMatchDialog.tsx";
import { ProductTerms } from "./ProductTerms.tsx";
import { Alert } from "../../components/primitives/Alert.tsx";
import { toast } from "../../components/primitives/toast-store.ts";

/** Sync notices shown as a toast; the others need the player and stay as an alert. */
const TOAST_SYNC_NOTICES: ReadonlySet<string> = new Set(["started", "already", "done"]);
import "./warehouse.css";
import { clipSelectionRect, scrollSelectionRect } from "./marquee-model.ts";

const copy = strings.warehouse;
const structure = structureCopy[currentLocale].library;
const view = libraryViewCopy;
const vn3Copy = libraryViewCopy.vn3;

/** W17 透传呈现:CatalogErrorKey 白名单 → strings.errors.catalog 文案(类型安全) */
function catalogErrorText(messageKey: CatalogErrorKey): string {
  const table: Record<CatalogErrorKey, string> = {
    "errors.catalog.invalidParams": strings.errors.catalog.invalidParams,
    "errors.catalog.unavailable": strings.errors.catalog.unavailable,
    "errors.catalog.storeFailed": strings.errors.catalog.storeFailed,
    "errors.catalog.fallback": strings.errors.catalog.fallback,
  };
  return table[messageKey];
}

/**
 * Warehouse 目录浏览(G8):云端目录轨的卡片墙。
 *
 * 数据来源与诚实纪律:
 * - dataSource "none"(纯浏览器 / not-run 场景)→ 诚实空态,不发起查询;
 * - dataSource "live"(桌面壳)→ catalog.* 走 Kernel→AMF/BDL 真实链路;
 *   BDL 未落观测数据时 = 空目录 + health unknown,空态即终态(F4-5);
 * - 骨架屏只出现在真实加载期间(首次拉取);筛选变更保留旧结果,
 *   不用骨架屏闪烁(ui-ux §2.8);
 * - 色彩纪律(v0.3.3 §6.1):橙仅用于选中描边;徽标一律中性灰,
 *   已购买用 success 芯片;不使用轨道语汇。
 */

type ListState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; view: CatalogListView };

type DetailState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; view: CatalogDetailView };

/* ---- 商品卡片 ---- */

function LibraryBadges({ facts, compact = false }: { facts: LibraryCardFacts | undefined; compact?: boolean }) {
  if (facts === undefined) return null;
  return <>
    {facts.formats?.includes("vrm") ? <Badge tone="neutral">{view.format.vrmBadge}</Badge> : null}
    {facts.formats?.some(fmt => fmt === "glb" || fmt === "gltf") ? <Badge tone="neutral">{view.format.glbBadge}</Badge> : null}
    {facts.vn3?.match === "conditional" ? <Badge tone="neutral">{vn3Copy.conditional}</Badge> : facts.vn3?.match === "contact" ? <Badge tone="warning">{vn3Copy.contact}</Badge> : null}
    {facts.vn3?.hasSpecialNote ? <Badge tone="warning">{vn3Copy.special}</Badge> : null}
    {compact ? null : <Badge tone={facts.storage.state === "present" || facts.storage.state === "cloud_only" ? "neutral" : "warning"}>
      {copy.libraryState[facts.storage.state]}
    </Badge>}
    {facts.sourceMatch === undefined ? null : <>
      {facts.sourceMatch.basis !== "mapping" ? <Badge tone="neutral">{copy.libraryState.sourceSuggested}</Badge> : null}
      <Badge tone="neutral">{facts.sourceMatch.content === "different" ? copy.libraryState.contentDifferent : copy.libraryState.contentUnverified}</Badge>
    </>}
    {facts.storage.supersededGeneratedCopies > 0 ? <Badge tone="neutral">{copy.removeFiles.oldVersion}</Badge> : null}
    {(facts.storage.unexpandedArchives ?? 0) > 0 ? <Badge tone="warning">{copy.libraryState.unexpandedArchives}</Badge> : null}
    {facts.storage.supersededGeneratedCopies > 0 && facts.storage.currentGeneratedCopies === 0 ? <Badge tone="warning">{copy.removeFiles.regenerate}</Badge> : null}
    {compact ? null : facts.operation?.inspectRequired ? <Badge tone="warning">{copy.libraryState.inspectRequired}</Badge>
      : facts.operation?.state === "running" ? <Badge tone="neutral">{copy.libraryState.downloading}</Badge>
      : facts.operation?.state === "failed" ? <Badge tone="warning">{copy.libraryState.downloadFailed}</Badge>
      : facts.operation?.state === "succeeded_with_warnings" ? <Badge tone="warning">{copy.libraryState.downloadPartial}</Badge> : null}
  </>;
}

/** 卡/行交互基座(Explorer 语义,用户裁决 2026-10-05):单击 = 选中该卡,
 * 双击/Enter = 打开详情,右键 = 交页面菜单(按选区约定裁决作用域)。
 * data-product-id 既是选区归属标记,也是框选命中测试的锚点。 */
function MaterialEntryView(props: Parameters<typeof MaterialEntryCard>[0] & { viewMode: LibraryViewMode; columnStyle: CSSProperties; facts?: LibraryCardFacts | undefined }) {
  if (props.viewMode === "cards") return <MaterialEntryCard {...props} />;
  const { card, source, metadata, facts } = props;
  return <LibraryListRow id={card.key} title={metadata?.displayName ?? source?.title ?? card.entry.displayName}
    shop={source?.shopName} variant={source?.variantName} variantCount={facts?.variantCount} source={libraryListSource(facts, card.entry.kind)} sizeBytes={facts?.sizeBytes} addedAt={facts?.addedAt}
    selected={props.selected} style={props.columnStyle} onSelect={props.onSelect} onOpen={props.onOpen} onMenu={props.onMenu} />;
}

/** Handlers stay the same across renders and read the page's current state, so choosing one card redraws one card. */
const WarehouseCard = memo(function WarehouseCard({
  item,
  facts,
  selected,
  onSelect,
  onOpen,
  onMenu,
  cornerState,
  cornerBusy,
  cornerActs,
  onCorner,
  fact,
}: {
  item: CatalogProductSummary;
  facts?: LibraryCardFacts | undefined;
  selected: boolean;
  onSelect: (item: CatalogProductSummary, event: ReactMouseEvent<HTMLElement>) => void;
  onOpen: (item: CatalogProductSummary) => void;
  /** 素材卡右键菜单(S-XII):由页面组装真实动作项 */
  onMenu: (event: ReactMouseEvent<HTMLElement>, item: CatalogProductSummary) => void;
  cornerState: LibraryCornerState;
  cornerBusy: boolean;
  cornerActs: boolean;
  onCorner: (item: CatalogProductSummary) => void;
  /** The value a non-default order goes by. */
  fact?: string | null;
}) {
  return (
    <article
      className="vua-warehouse-card"
      data-selected={selected || undefined}
      data-product-id={item.productId}
      data-selection-id={item.productId}
      onClick={event => onSelect(item, event)}
      onDoubleClick={() => onOpen(item)}
      onContextMenu={event => onMenu(event, item)}
      // 键盘可达:Enter/Space 打开详情(用户反馈 #5;购买标记由其他功能模块承担)
      role="listitem"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <div className="vua-warehouse-card__media">
        <LibraryCorner state={cornerState} busy={cornerBusy} onAction={cornerActs ? () => onCorner(item) : undefined} />
        {item.imageUrls.length > 0 ? (
          // 多图卡:悬停 2s 进相册(光标横向位置翻页);单图退化为普通媒体槽
          <CardAlbumMedia imageUrls={item.imageUrls} title={item.title ?? item.productId} />
        ) : (
          <div className="vua-warehouse-card__no-image">
            <span className="vua-caption vua-text-secondary">{copy.card.noImage}</span>
          </div>
        )}
        <Button className="vua-warehouse-card__menu" variant="subtle" aria-label={copy.removeFiles.actions} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); onMenu(event, item); }}><Icon name="more" size={16} /></Button>
        <div className="vua-warehouse-card__badges">
          {/* 未知 = 诚实缺席不渲染(人审 2026-10-07);仅停售等明确事实出徽标 */}
          {item.availability !== "available" && item.availability !== "unknown" ? <Badge tone="neutral">{copy.availability[item.availability]}</Badge> : null}
          {facts !== undefined ? <LibraryBadges facts={facts} compact /> : item.importedArtifacts > 0 ? <Badge tone="neutral">{copy.importedBadge}</Badge> : null}
        </div>
        {fact ? <span className="vua-warehouse-card__fact">{fact}</span> : null}
      </div>
      <div className="vua-warehouse-card__body">
        {/* 两行截断;hover 经 title 属性显示全称;无题观测回落 productId */}
        <p className="vua-warehouse-card__title" title={item.title ?? item.productId}>
          {item.title ?? item.productId}
        </p>
        <p className="vua-caption vua-text-secondary vua-warehouse-card__shop" title={item.shopName ?? undefined}>
          {item.shopName}
        </p>
        <p className="vua-warehouse-card__variant" title={shownVariant(item.title, item.variantName) ?? undefined}>
          {shownVariant(item.title, item.variantName)}
        </p>
      </div>
    </article>
  );
});

/* ---- 页面 ---- */

let lastAccountAnswer: CatalogAccountState | null = null;

export function WarehousePage({
  onNavigate,
}: {
  /** 「开始制作」面板的跨页动作(进车间/去浏览页);与页面导航同一原语 */
  onNavigate?: ((target: PageId) => void) | undefined;
}) {
  const dataSource = useDataSource();
  const connected = dataSource !== "none";
  // 单库页(用户方向 2026-10-02):云端三来源 + 本地,来源只作筛选
  // 视图模式(用户裁决 2026-03):卡片墙(带图)↔ 纯文字标题列表
  const [remembered] = useState(readLibrarySession);
  const [viewMode, setViewModeState] = useState<LibraryViewMode>(storedLibraryView);
  const setViewMode = (mode: LibraryViewMode) => { setViewModeState(mode); rememberLibraryView(mode); };
  const [sort, setSortState] = useState<LibrarySort>(storedLibrarySort);
  const chooseSort = (next: LibrarySort) => { setSortState(next); rememberLibrarySort(next); setWanted(LIBRARY_BATCH); setSelectedIds(new Set()); wallEl?.scrollTo({ top: 0 }); };
  const columns = useLibraryColumns(sort, column => chooseSort(nextHeaderSort(column, sort)));
  // 选区(Explorer 语义,用户裁决 2026-10-05):单击选卡/框选/右键拖选,
  // 无独立"选择模式"开关;Esc、空白单击、重新框选即清空
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectedIdsRef = useRef<ReadonlySet<string>>(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [contextSelection, setContextSelection] = useState<readonly RecipeAssetRef[]>([]);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [removalTarget, setRemovalTarget] = useState<RemovalDialogTarget | null>(null);
  const [bulkRemovalTargets, setBulkRemovalTargets] = useState<readonly RemovalDialogTarget[] | null>(null);
  const [bulkDownload, setBulkDownload] = useState<{ readonly products: readonly BulkProduct[]; readonly mode: BulkDownloadMode; readonly skippedLocal: number } | null>(null);
  const [metadataEntries, setMetadataEntries] = useState<readonly { readonly entryId: string; readonly displayName: string }[] | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<readonly { batchId: string; productId: string; paused: boolean }[]>([]);
  const [cornerBusy, setCornerBusy] = useState<ReadonlySet<string>>(new Set());
  const busyCorners = useRef(new Set<string>());
  const [sourceSearch, setSourceSearch] = useState<ReadonlyMap<string, LocalSourceSearchState>>(new Map());
  const [matchDialog, setMatchDialog] = useState<{ entryId: string; name: string; result: BoothSearchResultV01 | null } | null>(null);
  const [matchNotice, setMatchNotice] = useState<string | null>(null);
  const lifetime = useRef(0);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; }; }, []);
  const sourceWrites = useRef(new Map<string, { productId: string; params: import("@vua/contracts").LibraryEntryMetadataUpdateV01; commandId: string }>());
  const setSourceState = (entryId: string, state: LocalSourceSearchState) => setSourceSearch(prev => new Map(prev).set(entryId, state));
  const openBooth = async (productId: string) => {
    const url = boothProductUrl(productId);
    if (url === null) return;
    try {
      const face = window.vua?.library;
      const opened = typeof face?.openBoothProduct === "function" ? (await face.openBoothProduct(productId)).opened
        : window.open(url, "_blank") !== null;
      if (!opened) setDownloadNotice(copy.sourceSearch.openFailed);
    } catch { setDownloadNotice(copy.sourceSearch.openFailed); }
  };
  const saveBoothSource = async (entryId: string, productId: string) => {
    const outcome = await window.vua?.catalogSync?.fetchProduct(productId);
    if (outcome?.ok !== true) throw new Error("official_source_unavailable");
    const detail = await catalogBrowser.detail(productId);
    if (detail.kind !== "detail" || detail.product.productId !== productId) throw new Error("official_source_unavailable");
    const port = createLibraryMetadataPort();
    const previous = sourceWrites.current.get(entryId);
    const record = await port.read(entryId);
    if (record.productId !== productId) {
      const pending = previous?.productId === productId ? previous : {
        productId, commandId: crypto.randomUUID(),
        params: { schemaVersion: "0.1" as const, entryId, expectedRevision: record.revision, productId, displayName: record.displayName, thumbnailRef: record.thumbnailRef },
      };
      sourceWrites.current.set(entryId, pending);
      try { await port.update(pending.params, pending.commandId); }
      catch (error) {
        if (error instanceof Error && error.message === "vua.library.metadata_conflict") sourceWrites.current.delete(entryId);
        throw error;
      }
    }
    sourceWrites.current.delete(entryId);
  };
  const searchBoothSource = async (entryId: string, name: string, query = boothSearchKeyword(name), automatic = true) => {
    if (busyCorners.current.has(entryId)) return;
    const generation = lifetime.current;
    busyCorners.current.add(entryId); setCornerBusy(new Set(busyCorners.current)); setSourceState(entryId, "searching"); setMatchNotice(null);
    try {
      const result = await window.vua?.catalogSync?.searchProducts(query);
      if (generation !== lifetime.current) return;
      if (result === undefined) throw new Error("search_unavailable");
      const exact = automatic ? exactBoothMatch(result, query) : null;
      if (exact !== null) {
        await saveBoothSource(entryId, exact.productId);
        if (generation !== lifetime.current) return;
        setSourceState(entryId, "matched"); setReloadKey(key => key + 1);
      } else {
        setSourceState(entryId, "uncertain"); setMatchDialog({ entryId, name, result });
      }
    } catch {
      if (generation === lifetime.current) { setSourceState(entryId, "uncertain"); setMatchDialog({ entryId, name, result: null }); setMatchNotice(copy.sourceSearch.failed); }
    } finally { busyCorners.current.delete(entryId); if (generation === lifetime.current) setCornerBusy(new Set(busyCorners.current)); }
  };
  const confirmBoothSource = async (entryId: string, productId: string) => {
    if (busyCorners.current.has(entryId)) return;
    const generation = lifetime.current;
    busyCorners.current.add(entryId); setCornerBusy(new Set(busyCorners.current)); setMatchNotice(null); setSourceState(entryId, "searching");
    try {
      await saveBoothSource(entryId, productId);
      if (generation !== lifetime.current) return;
      setSourceState(entryId, "matched"); setMatchDialog(null); setReloadKey(key => key + 1);
    } catch { if (generation === lifetime.current) { setSourceState(entryId, "uncertain"); setMatchNotice(copy.sourceSearch.saveFailed); } }
    finally { busyCorners.current.delete(entryId); if (generation === lifetime.current) setCornerBusy(new Set(busyCorners.current)); }
  };
  const [openingFolder, setOpeningFolder] = useState(false);
  const [folderOpenFailed, setFolderOpenFailed] = useState(false);
  const [folderChoices, setFolderChoices] = useState<readonly { entryId: string; displayName: string }[] | null>(null);
  const openEntryFolder = async (entryId: string) => {
    const library = window.vua?.library;
    if (typeof library?.openEntryFolder !== "function" || openingFolder) return;
    setOpeningFolder(true);
    setFolderOpenFailed(false);
    try { const result = await library.openEntryFolder(entryId); setFolderOpenFailed(!result.opened); if (result.opened) setFolderChoices(null); }
    catch { setFolderOpenFailed(true); }
    finally { setOpeningFolder(false); }
  };
  const openProductFolder = async (productId: string) => {
    if (openingFolder || typeof window.vua?.library?.openEntryFolder !== "function") return;
    setOpeningFolder(true); setFolderOpenFailed(false);
    try {
      const entries = new Map((libraryPage?.facts.get(productId)?.localEntries ?? []).map(entry => [entry.entryId, entry]));
      const files = await libraryBrowser.productFiles(productId);
      for (const file of files.items) for (const copy of file.copies) {
        if (!entries.has(copy.entryId)) entries.set(copy.entryId, { entryId: copy.entryId, displayName: file.fileName });
      }
      const choices = [...entries.values()];
      if (choices.length === 1) setFolderOpenFailed(!(await window.vua.library.openEntryFolder(choices[0]!.entryId)).opened);
      else if (choices.length > 1) setFolderChoices(choices);
      else setFolderOpenFailed(true);
    } catch { setFolderOpenFailed(true); }
    finally { setOpeningFolder(false); }
  };
  // 静默下载观察(人审 E18 修复):受理后记住商品,下载任务静默 + 目录里
  // 该商品已入库(自动采纳完成写 mappings)即刷新卡片墙并提示——用户看
  // 得到"下到哪了"。不按采纳任务 id 判定:main 发起的采纳任务是时间戳
  // id,渲染层无登记身份可认
  const [downloadWatchBatch, setDownloadWatchBatch] = useState<string | null>(null);
  // 静默下载(N5):清单对话的打开意图 + 受理回执提示
  const [checklistProduct, setChecklistProduct] = useState<{
    productId: string;
    title: string;
  } | null>(null);
  const [checklistOn] = useDownloadChecklist();
  const clearSelection = () => {
    setSelectedIds(new Set());
  };
  const [source, setSource] = useState<
    "all" | "bought" | "gifts" | "free" | "local"
  >(remembered.source);
  const [downloadState, setDownloadState] = useState<"all" | "downloaded" | "not-downloaded" | "missing" | "in_progress" | "attention">(remembered.downloadState);
  const [sourceCategory, setSourceCategory] = useState(remembered.sourceCategory);
  const [formatFilter, setFormatFilter] = useState<"all" | LibraryFormatFilterV03>(remembered.format);
  const [vn3, setVn3] = useState<LibraryVn3Choice>(remembered.vn3);
  const [vn3Open, setVn3Open] = useState(false);
  const [libraryPage, setLibraryPage] = useState<LibraryPageView | null>(null);
  const latestLibraryPage = useRef(libraryPage); latestLibraryPage.current = libraryPage;
  useEffect(() => {
    const face = window.vua?.silentDownload;
    if (typeof face?.transfers !== "function") return;
    let active = true, reading = false, previous = "";
    const poll = async () => {
      if (reading) return;
      reading = true;
      try {
        const value = await face.transfers();
        if (!active) return;
        const key = JSON.stringify(value);
        // Reconcile even an unchanged native snapshot: an optimistic start can finish
        // between two empty queue reads. Comparing only poll snapshots leaves it stuck.
        setTransfers(current => JSON.stringify(current) === key ? current : value);
        if (key !== previous) { const initial = previous === ""; previous = key; if (!initial) setReloadKey(k => k + 1); }
        else if ([...(latestLibraryPage.current?.facts.values() ?? [])].some(f => f.operation?.state === "running" && !f.operation.inspectRequired)) setReloadKey(k => k + 1);
      } catch { /* Durable provider facts remain visible if native control is unavailable. */ }
      finally { reading = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const [wanted, setWanted] = useState(remembered.wanted);
  const [moreFailed, setMoreFailed] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const loadedCountRef = useRef(0);
  const loaded = useRef<{ readonly key: string; readonly page: LibraryPageView } | null>(null);
  const lastReload = useRef(0);

  const [query, setQuery] = useState<WarehouseQueryState>({ ...emptyWarehouseQuery, text: remembered.text });
  const [listState, setListState] = useState<ListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  // Drops can start outside this page, without the old import dialog's close
  // callback. Refresh durable cards when their normal warehouse tasks finish.
  const terminalTasks = useTaskCenter().tasks.filter(task => task.originPage === "warehouse"
    && ["completed", "completedWithWarnings", "failed", "cancelled"].includes(task.status)).map(task => `${task.id}:${task.status}`).sort().join("|");
  const previousTerminalTasks = useRef(terminalTasks);
  useEffect(() => {
    if (previousTerminalTasks.current === terminalTasks) return;
    previousTerminalTasks.current = terminalTasks;
    setReloadKey(key => key + 1);
  }, [terminalTasks]);
  const [selectedId, setSelectedId] = useState<string | null>(() => historyDetail()?.product ?? null);
  const currentDetailId = useRef(selectedId); currentDetailId.current = selectedId;
  const [detailState, setDetailState] = useState<DetailState>({ kind: "loading" });
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const refreshEnrichedDetail = (productId: string) => {
    setReloadKey(key => key + 1);
    // Keep the opened detail mounted: a loading remount would fetch again for products
    // whose official page genuinely has no recorded category/description.
    void catalogBrowser.detail(productId).then(view => {
      if (currentDetailId.current === productId) setDetailState({ kind: "loaded", view });
    }, () => {});
  };
  /** 素材卡右键菜单(S-XII):null 即关闭;动作全部映射真实能力 */
  const [cardMenu, setCardMenu] = useState<ContextMenuState | null>(null);
  // 素材导入弹窗(2026-09-20 导航重构):原独立页收敛为仓储页内弹窗,
  // 弹窗关闭即卸载 ImportPage——其「卸载即在途关闭内嵌视图」生命周期语义原样生效
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [migrationPreviewOpen, setMigrationPreviewOpen] = useState(false);
  // 定向首开地址(右键「下载到本地」):null = 常规入口(本地/云端选择步)
  const [importInitialUrl, setImportInitialUrl] = useState<string | null>(null);

  /** Account-library authentication precedes the sync affordance. Session data
   * stays in Main; the renderer receives only the existing authentication result. */
  const remoteBrowser = window.vua?.capabilities?.remoteBrowser === true;
  const [accountState, setAccountState] = useState<CatalogAccountState>("checking");
  const [accountProbeKey, setAccountProbeKey] = useState(0);
  const [syncStarting, setSyncStarting] = useState(false);
  const syncRequest = useRef(false);
  const [syncNotice, setSyncNotice] = useState<CatalogSyncNotice | null>(null);
  // Starting, joining and finishing a sync are brief feedback; the rest stay as an alert until dismissed.
  useEffect(() => {
    if (syncNotice === "started") toast(copy.catalogSync.startedHint);
    else if (syncNotice === "already") toast(copy.catalogSync.alreadyRunning);
    else if (syncNotice === "done") toast(copy.catalogSync.completedHint, "success");
  }, [syncNotice]);
  const [syncProgress, setSyncProgress] = useState<CatalogSyncSnapshotV03 | null>(null);
  const [syncReadFailed, setSyncReadFailed] = useState(false);
  const [syncRunId, setSyncRunId] = useState<string | null>(null);
  /** 统一卡片墙:选中的本地条目(云端商品用 selectedId,两者互斥呈现) */
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(() => historyDetail()?.local ?? null);
  const loginBrowserOpen = useLoginBrowserRequest() !== null;
  // One probe per entry/closed browser, with stale replies ignored. Visiting a
  // login page can leave cookies without completing login, so do not use hints.
  // A click during the short account check is kept and carried out when the answer arrives.
  const syncClicked = useRef(false);
  const syncAction = useRef<() => void>(() => {});
  const answerClick = () => { if (syncClicked.current) { syncClicked.current = false; window.setTimeout(() => syncAction.current(), 0); } };
  useEffect(() => {
    if (loginBrowserOpen || importDialogOpen || !remoteBrowser) return;
    let active = true;
    setAccountState("checking");
    const remote = window.vua?.remoteContent;
    if (remote === undefined) setAccountState("unknown");
    else void remote.authProbe().then(
      probe => { lastAccountAnswer = probe.authOk ? "signed-in" : "sign-in"; if (active) { setAccountState(lastAccountAnswer); answerClick(); } },
      () => { lastAccountAnswer = "unknown"; if (active) { setAccountState("unknown"); answerClick(); } },
    );
    return () => { active = false; };
  }, [loginBrowserOpen, importDialogOpen, remoteBrowser, accountProbeKey]);
  // The button keeps the last answer's word during a check, so reopening the page shows no flash of text.
  const accountWord = accountState === "checking" ? lastAccountAnswer ?? "checking" : accountState;
  syncAction.current = () => { void startCatalogSync(); };
  const startCatalogSync = async (): Promise<void> => {
    const catalogSync = window.vua?.catalogSync;
    const remote = window.vua?.remoteContent;
    if (catalogSync === undefined || remote === undefined || syncRequest.current || loginBrowserOpen) return;
    if (accountState === "sign-in") { openLoginBrowser(BOOTH_SIGN_IN_URL); return; }
    if (accountState !== "signed-in") { setAccountProbeKey(key => key + 1); return; }
    const libraryType =
      source === "gifts"
        ? "gifts"
        : source === "free"
          ? "free_downloads"
          : source === "all"
            ? "all"
            : "bought";
    // 显式携带类型(含 bought):wire 请求不带 libraryType 会让观察 upsert
    // 把该列覆盖为 NULL(真机 2026-10-03:14 条已购行被清空的根因)
    setSyncProgress(null);
    setSyncReadFailed(false);
    let outcome;
    syncRequest.current = true;
    setSyncStarting(true);
    try { outcome = await startSignedInCatalogSync(remote, catalogSync, { libraryType }, () => openLoginBrowser(BOOTH_SIGN_IN_URL)); }
    catch { setAccountState("unknown"); setSyncNotice("failed"); return; }
    finally { syncRequest.current = false; setSyncStarting(false); }
    if (outcome.status === "blocked") {
      setAccountState("sign-in");
      setSyncNotice("blocked");
      return;
    }
    if (outcome.status === "started") {
      // 任务身份登记:标题 + 来源页 + 完成通知保留(用户裁决 2026-10-02,
      // 秒级任务的完成也应有通知;运行窗口太短,默认纪律下用户打开通知
      // 中心时终态通知已消失)
      registerTaskIdentity(outcome.runId, {
        title: copy.catalogSync.taskTitle,
        originPage: "warehouse",
        notifyOnComplete: true,
        notifyFamily: "library:sync",
      });
      setSyncRunId(outcome.runId);
      setSyncNotice("started");
    } else {
      setSyncNotice("already");
      setSyncRunId(outcome.runId);
    }
  };

  // 同步运行终态轮询(N5 S1):到终态后刷新目录并把提示行翻到完成/失败
  // ——终态任务按通知中心纪律默认不再显示,完成反馈必须发生在用户正看
  // 着的地方(按钮旁),页面同时刷新让卡片立即可见
  const gateway = useGateway();
  // The player chooses a material's Avatar role; missing catalog classification
  // is not a capability gate. Preparation still checks actual admitted sources.
  const amfModule = useAmfModule();
  const amfStartReady = amfModule.state === "ready" && gateway.amfProduction !== undefined;
  const [startAvatar, setStartAvatar] = useState<MaterialsStartAvatar | null>(null);
  // 统一卡片墙数据源:本地条目(经 acquire 快照,与云端卡同一墙渲染)
  const acquireView = useAcquireView();
  const localEntries = dataSource === "fixture"
    ? acquireView !== null && acquireView.kind === "entries" ? acquireView.entries : []
    : libraryPage?.localEntries ?? [];
  const localCards = entryCards(localEntries).filter((card) =>
    dataSource !== "fixture" || entryCardMatches(card, query.text.trim()),
  );
  const selectedLocalEntry =
    selectedLocalId === null
      ? null
      : (localEntries.find((entry) => entry.warehouseItemId === selectedLocalId) ?? null);
  useEffect(() => {
    if ((syncNotice !== "started" && syncNotice !== "already") || syncRunId === null) return;
    let active = true;
    let busy = false;
    const poll = async () => {
      if (busy || !active) return;
      busy = true;
      try {
        const result = await window.vua?.gateway.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(),
          method: "catalog.librarySyncStatus", params: { schemaVersion: "0.3", runId: syncRunId } });
        if (!active) return;
        if (!result?.ok || !isCatalogSyncSnapshotV03(result.value) || result.value.runId !== syncRunId) throw new Error("sync_status_unavailable");
        const snapshot = result.value;
        setSyncReadFailed(false);
        setSyncProgress(snapshot);
        const notice = catalogSyncNotice(snapshot);
        if (notice !== "started") {
          setSyncNotice(notice);
          setSyncRunId(null);
          if (notice === "blocked") {
            setAccountState("sign-in");
            openLoginBrowser(BOOTH_SIGN_IN_URL);
          }
          setReloadKey((key) => key + 1);
        } else {
          // An undelivered final receipt cannot turn the durable task into success/failure.
          const transport = await window.vua?.catalogSync?.probe();
          if (active && transport?.status === "idle" && transport.runId === syncRunId && transport.lastFailureCode !== null) {
            setSyncNotice("unconfirmed");
            setSyncRunId(null);
            setReloadKey((key) => key + 1);
          }
        }
      } catch { if (active) setSyncReadFailed(true); }
      finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [syncNotice, syncRunId]);

  useEffect(() => {
    if (downloadWatchBatch === null) return;
    let active = true; let busy = false;
    let lastRevision: number | null = null;
    const poll = async (): Promise<void> => {
      if (!active || busy) return;
      busy = true;
      try {
        const response = await window.vua?.gateway.invoke({
          schemaVersion: 1, requestId: crypto.randomUUID(), method: "library.downloadStatus",
          params: { schemaVersion: "0.1", batchId: downloadWatchBatch },
        });
        if (!active) return;
        if (response === undefined || !response.ok || !isLibraryDownloadSnapshotV01(response.value) || response.value.batchId !== downloadWatchBatch) {
          setDownloadNotice(copy.cardMenu.downloadReadFailedHint); return;
        }
        const snapshot = response.value;
        if (snapshot.revision !== lastRevision) {
          lastRevision = snapshot.revision;
          setReloadKey((key) => key + 1);
        }
        const counts = {
          stored: snapshot.files.filter((file) => file.phase === "stored").length,
          failed: snapshot.files.filter((file) => file.phase === "failed" || file.phase === "unconfirmed").length,
          cancelled: snapshot.files.filter((file) => file.phase === "cancelled").length,
          total: snapshot.files.length,
        };
        if (snapshot.recoveryDisposition === "inspect_required") {
          setTransfers(current => current.filter(transfer => transfer.batchId !== snapshot.batchId));
          setDownloadNotice(copy.cardMenu.downloadInspectHint); setDownloadWatchBatch(null);
        } else if (snapshot.state !== "running") {
          setTransfers(current => current.filter(transfer => transfer.batchId !== snapshot.batchId));
          setDownloadNotice(format(copy.cardMenu.downloadTerminalHint, counts));
          setDownloadWatchBatch(null); setReloadKey((key) => key + 1);
        } else setDownloadNotice(format(copy.cardMenu.downloadProgressHint, counts));
      } catch { if (active) setDownloadNotice(copy.cardMenu.downloadReadFailedHint); }
      finally { busy = false; }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [downloadWatchBatch]);

  // Esc 清空选区(菜单打开时先关菜单,选区保留——Esc 一次只收一层)
  useEffect(() => {
    if (cardMenu !== null || selectedId !== null || selectedLocalId !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardMenu, selectedId, selectedLocalId]);

  // 指针聚光 + 微倾斜:回调 ref 追踪 wall-scroll 元素(视图切换会重建它),
  // hook 内部按场景模式决定是否挂载监听(非 animated 模式零开销)
  const [wallEl, setWallEl] = useState<HTMLDivElement | null>(null);
  useCardSpotlight(wallEl);

  /* ---- 框选(Explorer marquee,用户裁决 2026-10-05) ----
   * 墙内任意位置(卡上/空白)按住左或右键拖动即框选;位移超过阈值前按
   * 单击处理(手抖不误入);右键拖动结束时在松开点打开选区菜单。监听挂
   * window(不持 pointer capture),拖出容器仍可跟踪,click 语义不受影响。 */
  const MARQUEE_THRESHOLD_PX = 4;
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const selectionMenuRef = useRef<(x: number, y: number) => void>(() => {});
  useEffect(() => () => marqueeCleanup.current?.(), [wallEl]);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    button: number;
    becameMarquee: boolean;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  // 拖动结束后的 click/contextmenu 抑制:框选落定不回落为单击/原生菜单
  const suppressNextClickRef = useRef(false);
  const suppressNextContextMenuRef = useRef(false);

  const selectByRect = (rect: { left: number; top: number; width: number; height: number }) => {
    const el = wallEl;
    if (el === null) return;
    const ids = new Set<string>();
    const hit = (r: DOMRect) =>
      r.left < rect.left + rect.width && r.right > rect.left
      && r.top < rect.top + rect.height && r.bottom > rect.top;
    for (const card of el.querySelectorAll<HTMLElement>("[data-selection-id]")) {
      if (hit(card.getBoundingClientRect())) ids.add(card.dataset.selectionId ?? "");
    }
    selectedIdsRef.current = ids;
    setSelectedIds(ids);
  };

  const onWallPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, select, input, a, textarea") !== null) return;
    const wall = event.currentTarget;
    const bounds = wall.getBoundingClientRect();
    const anchor = { x: event.clientX - bounds.left + wall.scrollLeft, y: event.clientY - bounds.top + wall.scrollTop };
    let pointer = { x: event.clientX, y: event.clientY };
    marqueeCleanup.current?.();
    const start = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      becameMarquee: false,
    };
    dragStartRef.current = start;
    const update = () => {
      if (!start.becameMarquee) return;
      const viewport = wall.getBoundingClientRect();
      const rect = scrollSelectionRect(anchor, pointer, { x: viewport.left, y: viewport.top }, { x: wall.scrollLeft, y: wall.scrollTop });
      setMarqueeRect(clipSelectionRect(rect, viewport));
      selectByRect(rect);
    };
    const onMove = (moveEvent: PointerEvent) => {
      pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
      if (
        !start.becameMarquee
        && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y)
          <= MARQUEE_THRESHOLD_PX
      ) {
        return;
      }
      start.becameMarquee = true;
      update();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", abandon);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      dragStartRef.current = null;
      setMarqueeRect(null);
      marqueeCleanup.current = null;
    };
    const abandon = () => cleanup();
    const finish = (upEvent: PointerEvent) => {
      update();
      cleanup();
      if (!start.becameMarquee) return;
      suppressNextClickRef.current = true;
      if (start.button === 2 && upEvent.type === "pointerup") {
        suppressNextContextMenuRef.current = true;
        selectionMenuRef.current(upEvent.clientX, upEvent.clientY);
      }
    };
    marqueeCleanup.current = cleanup;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", abandon);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { capture: true, passive: true });
  };

  // 空白单击清空选区(卡/行自己的单击=选中;抑制标记吞掉框选落定的尾随 click)
  const onWallClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("[data-selection-id], button, a, select, input, textarea") === null) {
      clearSelection();
    }
  };

  // Arrow keys move through the wall and select, as in Explorer; Enter opens the card.
  const onWallKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || !(event.target instanceof HTMLElement) || !event.target.matches("[data-selection-id]")) return;
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-selection-id]")];
    const index = cards.indexOf(event.target);
    const columns = Math.max(1, cards.filter(card => card.offsetTop === cards[0]!.offsetTop).length);
    const next = cards[index + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns)];
    if (next === undefined) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest" });
    const id = next.dataset.selectionId!;
    selectionAnchor.current = id;
    setSelectedIds(new Set([id]));
  };

  const onWallContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextContextMenuRef.current) {
      suppressNextContextMenuRef.current = false;
      event.preventDefault();
      return;
    }
    // The wall also offers page-scoped selection without a card under the pointer.
    const target = event.target as HTMLElement;
    if (target.closest("[data-selection-id], input, textarea, select, [contenteditable='true']") === null) {
      event.preventDefault();
      openSelectionMenu(event.clientX, event.clientY);
    }
  };

  // A plain click replaces the selection, Ctrl adds or removes one card and Shift extends from the last
  // click, as in Explorer. The click that ends a marquee is swallowed so it cannot collapse the selection.
  const selectionAnchor = useRef<string | null>(null);
  const selectSingle = (id: string, event?: ReactMouseEvent<HTMLElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (event?.shiftKey && selectionAnchor.current !== null) {
      const order = rows.map(row => row.kind === "product" ? row.item.productId : row.card.key);
      const from = order.indexOf(selectionAnchor.current), to = order.indexOf(id);
      if (from >= 0 && to >= 0) { setSelectedIds(new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1))); return; }
    }
    selectionAnchor.current = id;
    if (event?.ctrlKey || event?.metaKey) {
      setSelectedIds(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
      return;
    }
    setSelectedIds(new Set([id]));
  };

  const [adaptation, setAdaptation] = useState<{ productId: string; title: string; previous: {
    query: WarehouseQueryState; source: typeof source; downloadState: typeof downloadState; sourceCategory: string; formatFilter: typeof formatFilter; vn3: LibraryVn3Choice; wanted: number;
    viewMode: typeof viewMode; selectedIds: ReadonlySet<string>; selectedId: string | null; selectedLocalId: string | null; scrollTop: number; scrollLeft: number;
  } } | null>(null);
  const restoreScroll = useRef<{ top: number; left: number } | null>(remembered.scrollTop > 0 ? { top: remembered.scrollTop, left: 0 } : null);
  const changeFilters = (change: () => void) => { change(); setWanted(LIBRARY_BATCH); setSelectedIds(new Set()); wallEl?.scrollTo({ top: 0 }); };
  const showAdaptations = (product: { productId: string; title: string | null }) => {
    setAdaptation({ productId: product.productId, title: product.title ?? product.productId, previous: adaptation?.previous ?? {
      query, source, downloadState, sourceCategory, formatFilter, vn3, wanted, viewMode, selectedIds: new Set(selectedIdsRef.current), selectedId, selectedLocalId,
      scrollTop: wallEl?.scrollTop ?? 0, scrollLeft: wallEl?.scrollLeft ?? 0,
    } });
    restoreScroll.current = null; setQuery(emptyWarehouseQuery); setSource("all"); setDownloadState("all"); setSourceCategory("all"); setFormatFilter("all"); setVn3(NO_VN3_CHOICE);
    setWanted(LIBRARY_BATCH); setSelectedIds(new Set()); setSelectedId(null); setSelectedLocalId(null); loaded.current = null; setLibraryPage(null); setListState({ kind: "loading" });
    if (wallEl) { wallEl.scrollTop = 0; wallEl.scrollLeft = 0; }
  };
  const cancelAdaptations = () => {
    if (!adaptation) return;
    const previous = adaptation.previous;
    setQuery(previous.query); setSource(previous.source); setDownloadState(previous.downloadState); setSourceCategory(previous.sourceCategory); setFormatFilter(previous.formatFilter); setVn3(previous.vn3);
    setWanted(previous.wanted); setViewMode(previous.viewMode); setSelectedIds(previous.selectedIds); setSelectedId(previous.selectedId); setSelectedLocalId(previous.selectedLocalId);
    restoreScroll.current = { top: previous.scrollTop, left: previous.scrollLeft };
    setAdaptation(null); loaded.current = null; setLibraryPage(null); setListState({ kind: "loading" });
  };
  useLayoutEffect(() => {
    const scroll = restoreScroll.current;
    if (scroll === null || adaptation !== null || libraryPage === null || listState.kind !== "loaded") return;
    const wall = pageRef.current?.querySelector(".vua-warehouse__wall-scroll");
    if (wall) { wall.scrollTop = scroll.top; wall.scrollLeft = scroll.left; restoreScroll.current = null; }
  }, [libraryPage, listState, adaptation]);

  const listKey = JSON.stringify([dataSource, query.text.trim(), source, downloadState, sourceCategory, formatFilter, vn3, vn3Open, sort, adaptation?.productId ?? null]);
  // Ordinary filter changes retain old results. Entering/leaving link filtering
  // clears them so a previous page never poses as a reverse-link result.
  useEffect(() => {
    if (!connected) return;
    let active = true;
    setListState((prev) => (prev.kind === "loaded" ? prev : { kind: "loading" }));
    const list = (offset: number, limit: number) => libraryBrowser.list({ schemaVersion: "0.3", sort, ...(formatFilter === "all" ? {} : { format: formatFilter }), ...(vn3ChoiceActive(vn3) || vn3Open ? { vn3: vn3FilterWire(vn3) } : {}), source: source === "local" ? "imported" : source === "free" ? "free_downloads" : source,
        state: downloadState === "not-downloaded" ? "cloud_only" : downloadState, text: query.text.trim(),
        ...(sourceCategory === "all" ? {} : { sourceCategory: sourceCategory === "unknown" ? null : sourceCategory.slice(9) }),
        ...(adaptation === null ? {} : { descriptionLinksTo: adaptation.productId }),
        limit, offset });
    const shown = loaded.current?.key === listKey ? loaded.current.page : null;
    const refreshing = lastReload.current !== reloadKey;
    lastReload.current = reloadKey;
    // More rows of the same list come after the ones shown. A refresh of a long list reads its top;
    // anything else reads the list from the start.
    const read: Promise<LibraryPageView> | null = dataSource === "fixture"
      ? catalogBrowser.list(toPortQuery(query)).then((catalog) => ({ catalog, localEntries: [], facts: new Map(), total: catalog.kind === "results" ? catalog.total : 0, offset: 0, limit: 50 }))
      : shown === null ? readLibraryRange(list, 0, wanted, null)
      : refreshing ? wanted > LIBRARY_READ_MAX ? list(0, LIBRARY_READ_MAX).then(head => refreshLibraryHead(shown, head)) : readLibraryRange(list, 0, wanted, null)
      : moreRowsExist(shown) && rowsLoaded(shown) < wanted ? readLibraryRange(list, rowsLoaded(shown), wanted, shown)
      : null;
    if (read === null) return;
    setMoreFailed(false);
    read.then(
      (page) => {
        if (!active) return;
        loaded.current = { key: listKey, page };
        setLibraryPage(page); setListState({ kind: "loaded", view: page.catalog });
      },
      () => {
        if (!active) return;
        if (shown !== null) setMoreFailed(true); else { loaded.current = null; setListState({ kind: "failed" }); }
      },
    );
    return () => {
      active = false;
    };
  }, [listKey, query, connected, reloadKey, source, downloadState, sourceCategory, formatFilter, vn3, vn3Open, sort, wanted, dataSource, adaptation]);
  // Rows come in as the end of the wall nears, and a new batch can follow while it is still in reach.
  const loadedCount = libraryPage === null ? 0 : rowsLoaded(libraryPage);
  loadedCountRef.current = loadedCount;
  const hasMore = moreRowsExist(libraryPage);
  const requestMore = useCallback(() => setWanted(current => Math.max(current, loadedCountRef.current + LIBRARY_BATCH)), []);
  useEffect(() => {
    const node = moreRef.current;
    if (node === null || wallEl === null || !hasMore || moreFailed) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) requestMore(); }, { root: wallEl, rootMargin: "0px 0px 800px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [wallEl, hasMore, moreFailed, loadedCount, viewMode, requestMore]);
  useEffect(() => {
    const refresh = () => setReloadKey((key) => key + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => window.vua?.events.subscribe((event) => {
    if ("taskId" in event && typeof event.payload === "object" && event.payload !== null && "operation" in event.payload && event.payload.operation === "library.reconcileSources") {
      registerTaskIdentity(event.taskId, { title: copy.libraryState.reconciliationTitle, originPage: "warehouse", notifyOnComplete: true, notifyFamily: "library:reconcile" });
    }
    if (event.kind === "task.completed" || event.kind === "task.persistenceFailed") {
      setReloadKey((key) => key + 1); setDetailReloadKey((key) => key + 1);
    }
  }), []);
  useEffect(() => window.vua?.catalogSync?.subscribeEnrichment?.(() => {
    setReloadKey((key) => key + 1);
    setDetailReloadKey((key) => key + 1);
  }), []);

  // 详情查询
  useEffect(() => {
    if (selectedId === null) return;
    let active = true;
    // Moving between cards keeps the page until the next one arrives, so it does not flash.
    setDetailState(current => current.kind === "loaded" ? current : { kind: "loading" });
    catalogBrowser.detail(selectedId).then(
      (view) => {
        if (active) setDetailState({ kind: "loaded", view });
      },
      () => {
        if (active) setDetailState({ kind: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [selectedId, detailReloadKey]);

  const resultsView =
    listState.kind === "loaded" && listState.view.kind === "results" ? listState.view : null;

  const visibleLocalCards = dataSource === "live" || source !== "gifts" && source !== "bought" && source !== "free" ? localCards : [];
  const rows = wallRows(libraryPage?.order, resultsView?.items ?? [], visibleLocalCards);
  const allRowIds = () => rows.map(row => row.kind === "product" ? row.item.productId : row.card.key);
  const selectAllPending = useRef(false);
  const selectAll = () => {
    setSelectedIds(new Set(allRowIds()));
    if (hasMore && libraryPage !== null) { selectAllPending.current = true; setWanted(libraryPage.total); }
  };
  useEffect(() => {
    if (!selectAllPending.current || hasMore) return;
    selectAllPending.current = false;
    setSelectedIds(new Set(allRowIds()));
  }, [hasMore, libraryPage]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectAllMenuItem = {
    id: "selectAll", label: copy.selectBar.selectAll, shortcut: "Ctrl+A",
    disabled: (resultsView?.items.length ?? 0) + visibleLocalCards.length === 0,
    onSelect: selectAll,
  };
  // Select the displayed page, retaining normal text and dialog shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.key.toLowerCase() !== "a") return;
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='dialog'], .vua-warehouse-detail")
        || document.querySelector('[aria-modal="true"], .vua-warehouse-detail')) return;
      if (target !== document.body && target !== document.documentElement && !pageRef.current?.contains(target)
        && !(cardMenu !== null && target?.closest(".vua-context-menu"))) return;
      event.preventDefault();
      selectAll();
      setCardMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resultsView, visibleLocalCards, cardMenu]);

  const filtersActive = libraryFiltersActive({ text: query.text, source, downloadState, sourceCategory, format: formatFilter, vn3 });
  const clearFilters = () => changeFilters(() => { setQuery(emptyWarehouseQuery); setSource("all"); setDownloadState("all"); setSourceCategory("all"); setFormatFilter("all"); setVn3(NO_VN3_CHOICE); });
  /** Search/filter emptiness remains distinct from an empty account library. */
  const emptyCard = catalogEmptyCard({
    remoteBrowser,
    accountState,
    filtered: filtersActive,
    catalogEmpty: resultsView !== null && resultsView.items.length === 0 && localCards.length === 0,
  });

  /** 静默下载发起:ids = null 表示「全部已捕获文件」;受理后任务进度走
   *  通知中心,本页只给受理回执(动作无可见响应等同于坏) */
  const startSilentDownload = async (productId: string, ids: readonly number[] | null, targets?: readonly { downloadableId: number; copyId: string }[]): Promise<void> => {
    const face = window.vua?.silentDownload;
    if (face === undefined) return;
    let resolved = ids;
    if (resolved === null) {
      const view = await libraryBrowser.productFiles(productId).catch(() => null);
      if (view === null || view.items.length === 0) {
        setDownloadNotice(copy.cardMenu.downloadNoCapture);
        return;
      }
      if (view.items.some((file) => file.managedCopyId === null && file.copies.length > 1)) {
        setChecklistProduct({ productId, title: resultsView?.items.find((item) => item.productId === productId)?.title ?? productId });
        return;
      }
      resolved = view.items.map((file) => file.downloadableId);
    }
    try {
      const outcome = await face.start(productId, resolved, targets);
      if ("blocked" in outcome) {
        setDownloadNotice(copy.cardMenu.downloadSessionExpired);
        return;
      }
      if ("errorCode" in outcome) {
        setDownloadNotice(outcome.errorCode === "vua.library.file_busy" ? copy.cardMenu.downloadBusyHint : outcome.errorCode === "vua.library.replacement_ambiguous" ? copy.cardMenu.downloadAmbiguousHint : copy.cardMenu.downloadFailedHint);
        return;
      }
      toast(format(copy.cardMenu.downloadQueuedHint, { count: outcome.accepted }), "success");
      registerTaskIdentity(outcome.taskId, { title: `${copy.cardMenu.download} · ${resultsView?.items.find((item) => item.productId === productId)?.title ?? productId}`, originPage: "warehouse", notifyOnComplete: true, notifyFamily: "library:download" });
      setDownloadWatchBatch(outcome.batchId);
      setTransfers(prev => [...prev.filter(t => t.batchId !== outcome.batchId), { batchId: outcome.batchId, productId, paused: false }]);
      setReloadKey((key) => key + 1);
    } catch {
      setDownloadNotice(copy.cardMenu.downloadFailedHint);
    }
  };

  /** Selected visible cards only; local content retains its own entry identity. */
  const actOnProductCorner = async (item: CatalogProductSummary) => {
    if (busyCorners.current.has(item.productId)) return;
    busyCorners.current.add(item.productId); setCornerBusy(new Set(busyCorners.current));
    try {
      const active = transfers.filter(t => t.productId === item.productId);
      if (active.length > 0) {
        const paused = !active.every(t => t.paused);
        for (const transfer of active) {
          const receipt = await window.vua?.silentDownload.control(transfer.batchId, paused);
          if (receipt?.ok !== true) { setDownloadNotice(copy.sourceSearch.controlFailed); break; }
        }
        setTransfers(await window.vua?.silentDownload.transfers() ?? []);
      } else if (checklistOn) setChecklistProduct({ productId: item.productId, title: item.title ?? item.productId });
      else await startSilentDownload(item.productId, null);
    } catch { setDownloadNotice(copy.sourceSearch.controlFailed); }
    finally { busyCorners.current.delete(item.productId); setCornerBusy(new Set(busyCorners.current)); }
  };
  const productCornerFacts = (item: CatalogProductSummary) => {
    const active = transfers.filter(t => t.productId === item.productId);
    const state = libraryCornerState(libraryPage?.facts.get(item.productId), "product", { active: active.length > 0, paused: active.length > 0 && active.every(t => t.paused) });
    return { state, acts: state === "cloud" || state === "error" || active.length > 0 };
  };
  const knownLocalProduct = (entryId: string) => {
    const facts = libraryPage?.facts.get(entryId);
    return facts?.metadata?.productId ?? (facts?.sourceMatch?.basis !== "name" ? facts?.sourceMatch?.product.productId : undefined);
  };
  const boothMenuItem = (productId: string | undefined | null) => ({ id: "openBooth", label: copy.sourceSearch.openBooth,
    disabled: boothProductUrl(productId) === null, onSelect: () => { if (productId) void openBooth(productId); } });
  /** Other ways to open a product's page, offered from its details. */
  const sourcePageMenuItems = (url: string, title: string) => [
    ...(browseWindowSupported() ? [{ id: "openInApp", label: view.detail.inApp, onSelect: () => { void openBrowseWindow(url, title).then(ok => { if (!ok) setDownloadNotice(copy.detail.openInAppFailed); }); } }] : []),
    { id: "openSystem", label: view.detail.systemBrowser, onSelect: () => { void openExternalUrl(url).then(ok => { if (!ok) setDownloadNotice(copy.detail.openSourceFailed); }); } },
  ];

  const recipeRefsOfSelection = (ids: ReadonlySet<string> = selectedIds): RecipeAssetRef[] =>
    [...(resultsView?.items ?? [])
      .filter((selected) => ids.has(selected.productId))
      .map((selected) => ({
        identity: selected.productId,
        displayName: selected.title ?? selected.productId,
        source: "cloud" as const,
        variantName: selected.variantName,
        shopName: selected.shopName,
      })), ...visibleLocalCards.filter(card => ids.has(card.key)).flatMap(card => card.entry.artifacts.map(file => ({
        identity: file.artifactSha256,
        displayName: `${card.entry.displayName} / ${file.relativePath}`,
        source: "local" as const,
        warehouseItemId: card.entry.warehouseItemId,
      })))];

  const [removedCards, setRemovedCards] = useState<readonly RemovalCard[] | null>(null);
  const selectedRemovalCards = (ids: ReadonlySet<string> = selectedIds): RemovalCard[] => [
    ...(resultsView?.items ?? []).filter(item => ids.has(item.productId)).map(item => ({ target: { kind: "product" as const, id: item.productId }, title: item.title ?? item.productId })),
    ...[...new Map(visibleLocalCards.filter(card => ids.has(card.key)).map(card => [card.entry.warehouseItemId, card.entry])).values()].map(entry => ({ target: { kind: "entry" as const, id: entry.warehouseItemId }, title: entry.displayName })),
  ];
  const selectedRecipeRefs = recipeRefsOfSelection();

  const compatibilityMenuItem = (product: { productId: string; title: string | null }) => ({
    id: "showCompatible", label: copy.cardMenu.showCompatible,
    disabled: dataSource !== "live", onSelect: () => showAdaptations(product),
  });

  /** Bulk actions retain the selection; product clues apply to the clicked card. */
  const openSelectionMenu = (x: number, y: number, product?: { productId: string; title: string | null }) => {
    const selection = selectedIdsRef.current;
    const refs = recipeRefsOfSelection(selection);
    const products = new Map<string, BulkProduct>();
    const removals: RemovalDialogTarget[] = [];
    const localEntries = new Set<string>();
    let skippedLocal = 0;
    for (const selected of resultsView?.items ?? []) {
      if (!selection.has(selected.productId)) continue;
      products.set(selected.productId, { productId: selected.productId, title: selected.title ?? selected.productId });
      const copyIds = libraryPage?.facts.get(selected.productId)?.copyIds;
      if (copyIds?.length) removals.push({ target: { kind: "product", id: selected.productId }, title: selected.title ?? selected.productId, copyIds });
    }
    for (const selected of visibleLocalCards) {
      if (!selection.has(selected.key) || localEntries.has(selected.entry.warehouseItemId)) continue;
      localEntries.add(selected.entry.warehouseItemId);
      const facts = libraryPage?.facts.get(selected.entry.warehouseItemId);
      const source = facts?.sourceMatch;
      if (source !== undefined && source.basis !== "name") products.set(source.product.productId, { productId: source.product.productId, title: source.product.title ?? source.product.productId });
      else skippedLocal += 1;
      if (facts?.copyIds?.length) removals.push({ target: { kind: "entry", id: selected.entry.warehouseItemId }, title: selected.entry.displayName, copyIds: facts.copyIds });
    }
    const scopes = removalScopes(removals);
    const downloadAvailable = dataSource === "live" && window.vua?.silentDownload !== undefined && (products.size > 0 || skippedLocal > 0);
    setCardMenu({
      x,
      y,
      items: [
        selectAllMenuItem,
        { id: "bulkDownload", label: copy.cardMenu.download, disabled: !downloadAvailable, onSelect: () => setBulkDownload({ products: [...products.values()], mode: "download", skippedLocal }) },
        { id: "bulkReDownload", label: copy.cardMenu.reDownload, disabled: !downloadAvailable, onSelect: () => setBulkDownload({ products: [...products.values()], mode: "redownload", skippedLocal }) },
        { id: "bulkDeleteLocal", label: copy.cardMenu.deleteLocal, disabled: dataSource !== "live" || scopes.length === 0, onSelect: () => setBulkRemovalTargets(scopes) },
        { id: "removeCards", label: copy.removeCards.title, disabled: dataSource !== "live" || selection.size === 0 || selection.size > 200, onSelect: () => setRemovedCards(selectedRemovalCards(selection)) },
        ...(product ? [boothMenuItem(product.productId), compatibilityMenuItem(product)] : []),
        ...(refs.length > 0
          ? [{
              id: "addToRecipe",
              label: format(copy.selectBar.addToRecipe, { count: refs.length }),
              disabled: refs.length > 512,
              onSelect: () => {
                setContextSelection(refs);
                setRecipeDialogOpen(true);
              },
            }]
          : []),
        {
          id: "clearSelection",
          label: copy.selectBar.clearSelection,
          onSelect: () => setSelectedIds(new Set()),
        },
      ],
    });
  };

  selectionMenuRef.current = openSelectionMenu;

  /** 素材卡右键菜单(S-XII):仅真实动作——查看详情/已购标记。
   *  sourceUrl 只在详情负载上,打开来源/复制链接归详情抽屉,卡片菜单不猜 URL。
   *  Explorer 约定(2026-10-05):右键在多选选区内 = 菜单作用于整组;
   *  在选区外 = 先选中该卡再出单项菜单 */
  const openCardMenu = (event: ReactMouseEvent<HTMLElement>, item: CatalogProductSummary) => {
    event.preventDefault();
    if (selectedIds.has(item.productId) && selectedIds.size > 1) {
      openSelectionMenu(event.clientX, event.clientY, item);
      return;
    }
    setSelectedIds(new Set([item.productId]));
    const menuItems: ContextMenuState["items"] = [
      ...(selectedId === null ? [{ id: "open", label: copy.card.detailsCta, onSelect: () => setSelectedId(item.productId) }] : []),
      boothMenuItem(item.productId),
      ...(selectedId !== null && detailState.kind === "loaded" && detailState.view.kind === "detail" && detailState.view.product.sourceUrl !== null ? sourcePageMenuItems(detailState.view.product.sourceUrl, detailState.view.product.title ?? item.productId) : []),
      { id: "openFolder", label: copy.cardMenu.openFolder,
        disabled: dataSource !== "live" || typeof window.vua?.library?.openEntryFolder !== "function" || openingFolder
          || (libraryPage?.facts.get(item.productId)?.storage.storedCopies ?? item.importedArtifacts) === 0,
        onSelect: () => void openProductFolder(item.productId) },
      selectAllMenuItem,
      { id: "removeCard", label: copy.removeCards.title, disabled: dataSource !== "live", onSelect: () => setRemovedCards([{ target: { kind: "product", id: item.productId }, title: item.title ?? item.productId }]) },
      ...(dataSource === "live" && (libraryPage?.facts.get(item.productId)?.localEntries?.length ?? 0) > 0 ? [{
        id: "editLocalSource", label: copy.editSource.title,
        onSelect: () => setMetadataEntries(libraryPage!.facts.get(item.productId)!.localEntries!),
      }] : []),
        {
          id: "download",
          label: (libraryPage?.facts.get(item.productId)?.storage.storedCopies ?? item.importedArtifacts) > 0 ? copy.cardMenu.reDownload : copy.cardMenu.download,
          onSelect: () => {
            // 静默下载(用户裁决 2026-10-05,Steam 式:不打开页面):按设置
            // 决定直下全部或先弹文件清单;文件 id 来自 BDL 捕获(v0.7 查询),
            // 入队后进度走下载任务面(通知中心)
            if (checklistOn) {
              setChecklistProduct({ productId: item.productId, title: item.title ?? item.productId });
              return;
            }
            void startSilentDownload(item.productId, null);
          },
        },
        {
          id: "addToRecipe",
          label: copy.recipeDialog.title,
          onSelect: () => {
            const refs: RecipeAssetRef[] = [{
              identity: item.productId,
              displayName: item.title ?? item.productId,
              source: "cloud",
              variantName: item.variantName,
              shopName: item.shopName,
            }];
            setContextSelection(refs);
            setRecipeDialogOpen(true);
          },
        },
        ...((libraryPage?.facts.get(item.productId)?.storage.storedCopies ?? item.importedArtifacts) > 0 && dataSource === "live"
          ? [{
              id: "deleteLocal",
              label: copy.cardMenu.deleteLocal,
              onSelect: () => {
                setRemovalTarget({ target: { kind: "product", id: item.productId }, title: item.title ?? item.productId,
                  ...(libraryPage?.facts.get(item.productId)?.copyIds === undefined ? {} : { copyIds: libraryPage.facts.get(item.productId)!.copyIds! }) });
              },
            }]
          : []),
        compatibilityMenuItem(item),
    ];
    const anchor = event.currentTarget.getBoundingClientRect();
    setCardMenu({ x: event.detail === 0 ? anchor.left : event.clientX, y: event.detail === 0 ? anchor.bottom : event.clientY, items: menuItems });
  };

  const openLocalMenu = (event: ReactMouseEvent<HTMLElement>, card: (typeof visibleLocalCards)[number]) => {
    event.preventDefault();
    const sourceProduct = libraryPage?.facts.get(card.entry.warehouseItemId)?.sourceMatch?.product;
                            if (selectedIds.has(card.key) && selectedIds.size > 1) {
                              openSelectionMenu(event.clientX, event.clientY, sourceProduct);
                              return;
                            }
                            setSelectedIds(new Set([card.key]));
                            const anchor = event.currentTarget.getBoundingClientRect();
                            setCardMenu({
                              x: event.detail === 0 ? anchor.left : event.clientX,
                              y: event.detail === 0 ? anchor.bottom : event.clientY,
                              items: [
                                selectAllMenuItem,
                                { id: "removeCard", label: copy.removeCards.title, disabled: dataSource !== "live", onSelect: () => setRemovedCards([{ target: { kind: "entry", id: card.entry.warehouseItemId }, title: card.entry.displayName }]) },
                                boothMenuItem(knownLocalProduct(card.entry.warehouseItemId)),
                                { id: "openFolder", label: copy.cardMenu.openFolder,
                                  disabled: dataSource !== "live" || typeof window.vua?.library?.openEntryFolder !== "function" || openingFolder,
                                  onSelect: () => void openEntryFolder(card.entry.warehouseItemId) },
                                { id: "searchBooth", label: copy.sourceSearch.title, disabled: dataSource !== "live" || cornerBusy.has(card.entry.warehouseItemId),
                                  onSelect: () => void searchBoothSource(card.entry.warehouseItemId, card.entry.displayName) },
                                ...(sourceProduct ? [compatibilityMenuItem(sourceProduct)] : []),
                                ...(selectedLocalId === null ? [{
                                  id: "open",
                                  label: copy.card.detailsCta,
                                  onSelect: () => {
                                    setSelectedId(null);
                                    setSelectedLocalId(card.entry.warehouseItemId);
                                  },
                                }] : []),
                                {
                                  id: "addToDraft",
                                  label: copy.recipeDialog.title,
                                  disabled: card.entry.artifacts.length === 0 || card.entry.artifacts.length > 512,
                                  onSelect: () => {
                                    setContextSelection(card.entry.artifacts.map(file => ({
                                      identity: file.artifactSha256,
                                      displayName: `${card.entry.displayName} / ${file.relativePath}`,
                                      source: "local",
                                      warehouseItemId: card.entry.warehouseItemId,
                                    })));
                                    setRecipeDialogOpen(true);
                                  },
                                },
                                ...(dataSource === "live" && card.entry.kind === "imported_material" ? [{ id: "editSource", label: copy.editSource.title,
                                  onSelect: () => setMetadataEntries([{ entryId: card.entry.warehouseItemId, displayName: card.entry.displayName }]),
                                }] : []),
                                ...(dataSource === "live" ? [{ id: "removeFiles", label: copy.cardMenu.deleteLocal,
                                  onSelect: () => setRemovalTarget({ target: { kind: "entry", id: card.entry.warehouseItemId }, title: card.entry.displayName,
                                    ...(libraryPage?.facts.get(card.entry.warehouseItemId)?.copyIds === undefined ? {} : { copyIds: libraryPage.facts.get(card.entry.warehouseItemId)!.copyIds! }) }),
                                }] : []),
                              ],
                            });
  };

  // The one selected card's next steps, whichever kind of card it is.
  const soleId = selectedIds.size === 1 ? [...selectedIds][0]! : null;
  const soleProduct = soleId === null ? undefined : resultsView?.items.find(item => item.productId === soleId);
  const soleLocal = soleId === null ? undefined : visibleLocalCards.find(card => card.key === soleId);
  const soleFacts = soleLocal === undefined ? undefined : libraryPage?.facts.get(soleLocal.entry.warehouseItemId);
  const soleTitle = soleProduct !== undefined ? soleProduct.title ?? soleProduct.productId
    : soleLocal !== undefined ? soleFacts?.metadata?.displayName ?? soleLocal.entry.displayName : null;
  const soleAvatar: MaterialsStartAvatar | null = soleProduct !== undefined ? { productId: soleProduct.productId, title: soleProduct.title, imageUrl: soleProduct.imageUrl }
    : soleLocal !== undefined ? { entryId: soleLocal.entry.warehouseItemId, title: soleTitle, imageUrl: soleFacts?.metadata?.thumbnailRef ?? soleFacts?.sourceMatch?.product.imageUrl ?? null }
    : null;
  const soleOpen = soleProduct !== undefined ? () => { setSelectedLocalId(null); setSelectedId(soleProduct.productId); }
    : soleLocal !== undefined ? () => { setSelectedId(null); setSelectedLocalId(soleLocal.entry.warehouseItemId); }
    : null;

  const detailOpen = selectedId !== null || selectedLocalEntry !== null;
  const detailOrder: readonly { readonly product?: string; readonly local?: string }[] = rows.map(row => row.kind === "product" ? { product: row.item.productId } : { local: row.card.entry.warehouseItemId });
  const neighbours = neighboursOf(detailOrder, item => selectedId !== null ? item.product === selectedId : item.local === selectedLocalId);
  // Stepping through details near the end of what is loaded brings in the next rows.
  useEffect(() => {
    if (detailOpen && hasMore && neighbours.index >= 0 && neighbours.index >= neighbours.total - 3) requestMore();
  }, [detailOpen, hasMore, neighbours.index, neighbours.total, requestMore]);
  const openDetail = (target: LibraryDetailEntry) => {
    setSelectedId(target.product ?? null); setSelectedLocalId(target.local ?? null);
    const key = target.product ?? visibleLocalCards.find(card => card.entry.warehouseItemId === target.local)?.key;
    if (key !== undefined) { setSelectedIds(new Set([key])); selectionAnchor.current = key; }
  };
  const closeDetail = () => {
    const key = selectedId ?? visibleLocalCards.find(card => card.entry.warehouseItemId === selectedLocalId)?.key;
    setSelectedId(null); setSelectedLocalId(null); setDetailState({ kind: "loading" });
    // The wall comes back with this card in view and focused, so the keyboard keeps its place.
    if (key !== undefined) requestAnimationFrame(() => {
      const target = [...(wallEl?.querySelectorAll<HTMLElement>("[data-selection-id]") ?? [])].find(node => node.dataset.selectionId === key);
      target?.scrollIntoView({ block: "nearest" }); target?.focus({ preventScroll: true });
    });
  };
  useEscapeClose(detailOpen, closeDetail);
  // The side buttons walk the same history as the page's own back button.
  useEffect(() => {
    syncHistoryDetail(selectedId !== null ? { product: selectedId } : selectedLocalId !== null ? { local: selectedLocalId } : null);
  }, [selectedId, selectedLocalId]);
  const detailMoves = useRef({ detailOpen, openDetail, closeDetail });
  detailMoves.current = { detailOpen, openDetail, closeDetail };
  useEffect(() => {
    const onHistory = () => {
      const entry = historyDetail();
      if (entry !== null) detailMoves.current.openDetail(entry);
      else if (detailMoves.current.detailOpen) detailMoves.current.closeDetail();
    };
    window.addEventListener("popstate", onHistory);
    return () => window.removeEventListener("popstate", onHistory);
  }, []);
  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']") || document.querySelector('[aria-modal="true"]')) return;
      const next = event.key === "ArrowLeft" ? neighbours.previous : neighbours.next;
      if (next !== null) { event.preventDefault(); openDetail(next); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // Filters and place outlive a visit to another page in this session.
  const sessionRef = useRef({ text: query.text, source, downloadState, sourceCategory, format: formatFilter, vn3, wanted });
  sessionRef.current = { text: query.text, source, downloadState, sourceCategory, format: formatFilter, vn3, wanted };
  const wallRef = useRef(wallEl); wallRef.current = wallEl;
  useEffect(() => () => { saveLibrarySession({ ...sessionRef.current, scrollTop: wallRef.current?.scrollTop ?? 0 }); }, []);

  const sortFact = sortFactOf(sort);
  const cancelFilter = adaptation !== null ? <Button variant="default" onClick={cancelAdaptations}>{copy.adaptation.cancel}</Button> : null;
  const cardHandlers = useRef({ selectSingle, openCardMenu, actOnProductCorner });
  cardHandlers.current = { selectSingle, openCardMenu, actOnProductCorner };
  const onProductSelect = useCallback((item: CatalogProductSummary, event: ReactMouseEvent<HTMLElement>) => cardHandlers.current.selectSingle(item.productId, event), []);
  const onProductOpen = useCallback((item: CatalogProductSummary) => { setSelectedLocalId(null); setSelectedId(item.productId); }, []);
  const onProductMenu = useCallback((event: ReactMouseEvent<HTMLElement>, item: CatalogProductSummary) => cardHandlers.current.openCardMenu(event, item), []);
  const onProductCorner = useCallback((item: CatalogProductSummary) => { void cardHandlers.current.actOnProductCorner(item); }, []);
  // A card not yet drawn reserves the height of one that has been, so the scrollbar stays put.
  useLayoutEffect(() => {
    const first = wallEl?.querySelector<HTMLElement>(".vua-warehouse-card");
    if (first && first.offsetHeight > 0) wallEl!.style.setProperty("--vua-card-estimate", `${first.offsetHeight}px`);
  }, [wallEl, loadedCount, viewMode]);

  return (
    <div ref={pageRef} className="vua-page vua-warehouse" data-scroll-frame data-detail={detailOpen || undefined}>
      {detailOpen ? <LibraryDetailBar title={strings.factory.rooms.materials.name} index={neighbours.index} total={libraryPage?.total ?? neighbours.total} onBack={closeDetail}
        onPrevious={neighbours.previous === null ? null : () => openDetail(neighbours.previous!)} onNext={neighbours.next === null ? null : () => openDetail(neighbours.next!)} /> : null}
      <section className="vua-page__hero" hidden={detailOpen}>
        <div className="vua-warehouse__heading">
        <h1 className="vua-title">{strings.factory.rooms.materials.name}</h1>
        {/* 本地导入直接打开文件夹选择器；账号库同步保留独立入口。 */}
        <div className="vua-page__actions">
          <LocalImportButton
            onSingle={() => {
              setImportInitialUrl(null);
              setImportDialogOpen(true);
            }}
            onMigration={() => setMigrationPreviewOpen(true)}
          />
          {source !== "local" && remoteBrowser ? (
            <Button variant="default" data-nav-id="warehouse-sync" disabled={syncStarting || loginBrowserOpen || importDialogOpen} onClick={() => { if (accountState === "checking") syncClicked.current = true; else void startCatalogSync(); }}>
              {syncStarting || accountWord === "checking" ? copy.catalogSync.checking : accountWord === "sign-in" ? copy.catalogSync.signInAction : accountWord === "unknown" ? copy.catalogSync.retryCheck : copy.catalogSync.action}
            </Button>
          ) : null}
          {folderOpenFailed && folderChoices === null ? <span className="vua-caption vua-text-secondary" role="status">{copy.openFolderFailed}</span> : null}
          {syncProgress !== null ? (
            <span className="vua-caption vua-text-secondary" role="status">
              {format(copy.catalogSync.progressHint, { pages: syncProgress.pages, count: syncProgress.upsertedCount, rejected: syncProgress.rejectedCount })}
            </span>
          ) : null}
        </div>
        </div>
      </section>

      <div className="vua-warehouse__notices">
        {syncNotice !== null && !TOAST_SYNC_NOTICES.has(syncNotice) ? (
          <Alert tone={syncNotice === "failed" ? "error" : "warning"} onDismiss={() => setSyncNotice(null)} dismissLabel={strings.common.dialogClose}>
            {syncNotice === "blocked" ? copy.catalogSync.signInRequired
              : syncNotice === "warning" ? copy.catalogSync.warningHint
              : syncNotice === "cancelled" ? copy.catalogSync.cancelledHint
              : syncNotice === "inspect" ? copy.catalogSync.inspectHint
              : syncNotice === "unconfirmed" ? copy.catalogSync.unconfirmedHint
              : copy.catalogSync.failedHint}
          </Alert>
        ) : null}
        {syncReadFailed ? <Alert tone="warning">{copy.catalogSync.readFailedHint}</Alert> : null}
        {downloadNotice !== null ? <Alert tone="info" onDismiss={() => setDownloadNotice(null)} dismissLabel={strings.common.dialogClose}>{downloadNotice}</Alert> : null}
        {dataSource === "fixture" ? (
          <div>
            <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
          </div>
        ) : null}
      </div>
      <div className="vua-warehouse__browse" hidden={detailOpen}>
      <div className="vua-warehouse__filters" role="search" aria-label={copy.searchAria}>
        <label className="vua-warehouse__searchbox">
          <Icon name="search" size={16} />
          <input
            type="search"
            className="vua-warehouse__search"
            aria-label={copy.searchAria}
            placeholder={view.search}
            value={query.text}
            onChange={event => changeFilters(() => setQuery({ text: event.target.value }))}
            onKeyDown={event => {
              if (event.key === "Escape" && query.text !== "") {
                event.preventDefault();
                event.stopPropagation();
                changeFilters(() => setQuery({ text: "" }));
              }
            }}
          />
        </label>
        <div className="vua-warehouse__select">
          <select className="vua-warehouse__filter" aria-label={copy.filters.source} value={source} onChange={event => changeFilters(() => setSource(event.target.value as typeof source))}>
            <option value="all">{copy.filters.sourceAll}</option>
            <option value="bought">{copy.filters.sourceBought}</option>
            <option value="gifts">{copy.filters.sourceGifts}</option>
            <option value="free">{copy.filters.sourceFree}</option>
            <option value="local">{copy.filters.sourceLocal}</option>
          </select>
        </div>
        <div className="vua-warehouse__select">
          <select className="vua-warehouse__filter" aria-label={copy.filters.downloadState} value={downloadState} onChange={event => changeFilters(() => setDownloadState(event.target.value as typeof downloadState))}>
            <option value="all">{copy.filters.downloadAll}</option>
            <option value="downloaded">{copy.filters.downloaded}</option>
            <option value="not-downloaded">{copy.filters.notDownloaded}</option>
            <option value="missing">{copy.libraryState.missing}</option>
            <option value="in_progress">{copy.libraryState.downloading}</option>
            <option value="attention">{copy.libraryState.attention}</option>
          </select>
        </div>
        <div className="vua-warehouse__select">
          <select className="vua-warehouse__filter" aria-label={copy.filters.category} value={sourceCategory} onChange={event => changeFilters(() => setSourceCategory(event.target.value))} disabled={dataSource !== "live"}>
            <option value="all">{copy.filters.categoryAll}</option>
            <option value="unknown">{copy.filters.categoryUnknown}</option>
            {[...new Set([...(libraryPage?.sourceCategories ?? []), ...(sourceCategory.startsWith("category:") ? [sourceCategory.slice(9)] : [])])].sort((a, b) => boothCategoryLabel(a).localeCompare(boothCategoryLabel(b), currentLocale)).map(category => <option key={category} value={`category:${category}`}>{boothCategoryLabel(category)}</option>)}
          </select>
        </div>
        <div className="vua-warehouse__select">
          <select className="vua-warehouse__filter" aria-label={view.format.label} data-nav-id="warehouse-format" value={formatFilter} disabled={dataSource !== "live" || libraryPage?.older === true} onChange={event => changeFilters(() => setFormatFilter(event.target.value as "all" | LibraryFormatFilterV03))}>
            <option value="all">{view.format.all}</option>
            <option value="vrm_or_glb">{view.format.vrm_or_glb}</option>
            <option value="unitypackage">{view.format.unitypackage}</option>
          </select>
        </div>
        <LibraryVn3Filter value={vn3} counts={libraryPage?.vn3Counts} disabled={dataSource !== "live" || libraryPage?.older === true} open={vn3Open} onOpenChange={setVn3Open}
          onChange={next => changeFilters(() => setVn3(next))} onUpdated={() => setReloadKey(key => key + 1)} />
        <div className="vua-warehouse__select">
          <select className="vua-warehouse__filter" aria-label={view.sort.label} data-nav-id="warehouse-sort" value={sort} disabled={dataSource !== "live" || libraryPage?.older === true} onChange={event => chooseSort(event.target.value as LibrarySort)}>
            {offeredLibrarySorts(sort, libraryPage?.facts.values() ?? []).map(option => <option key={option} value={option}>{view.sort[option]}</option>)}
          </select>
        </div>
        <span className="vua-warehouse__views vua-segments" role="group" aria-label={view.view.label}>
          <SegmentBar selected={viewMode} />
          <button type="button" aria-pressed={viewMode === "cards"} aria-label={view.view.cards} title={view.view.cards} data-nav-id="warehouse-view-cards" onClick={() => setViewMode("cards")}><Icon name="modules" size={16} /></button>
          <button type="button" aria-pressed={viewMode === "list"} aria-label={view.view.list} title={view.view.list} data-nav-id="warehouse-view-list" onClick={() => setViewMode("list")}><Icon name="list" size={16} /></button>
        </span>
      </div>

      {true ? (
        <>
          {!connected ||
      (listState.kind === "loaded" && listState.view.kind === "not-connected") ? (
        <EmptyState title={copy.states.notConnectedTitle} />
      ) : listState.kind === "loaded" && listState.view.kind === "error" ? (
        /* W17 透传呈现:服务端 application 错误按冻结码映射文案,不与断连混淆 */
        <>{cancelFilter}<EmptyState
          title={copy.states.loadFailedTitle}
          description={catalogErrorText(listState.view.messageKey)}
          action={
            <Button variant="default" onClick={() => setReloadKey((key) => key + 1)}>
              {copy.states.retry}
            </Button>
          }
        /></>
      ) : listState.kind === "failed" ? (
        <>{cancelFilter}<EmptyState
          title={copy.states.loadFailedTitle}
          action={
            <Button variant="default" onClick={() => setReloadKey((key) => key + 1)}>
              {copy.states.retry}
            </Button>
          }
        /></>
      ) : (
        <div className="vua-warehouse__content">
          <div className="vua-warehouse__main">
            <div className="vua-warehouse__toolbar">
              {resultsView !== null ? <span className="vua-caption vua-text-secondary" data-library-count>{format(view.count, { count: resultsView.total })}</span> : null}
              {filtersActive ? <Button variant="subtle" data-nav-id="warehouse-clear-filters" onClick={clearFilters}>{view.clear}</Button> : null}
              <span className="vua-warehouse__toolbar-gap" />
              {adaptation !== null ? <span className="vua-caption vua-text-secondary" title={copy.adaptation.boundary}>{format(copy.adaptation.active, { name: adaptation.title })}</span> : null}
              {cancelFilter}
            </div>

            {/* 滚动限定在本容器:工具栏/hero 不随图片墙滚动(用户反馈 #2) */}
            <div
              className="vua-warehouse__wall-scroll"
              data-scroll-frame
              ref={setWallEl}
              onPointerDown={onWallPointerDown}
              onClick={onWallClick}
              onContextMenu={onWallContextMenu}
              onKeyDown={onWallKeyDown}
            >
              {/* 框选矩形经 portal 挂 document.body(人审 B5/B6 修复
                  2026-10-06):fixed 定位会被带 transform/backdrop-filter 的
                  祖先劫持成包含块,矩形画在容器内即与鼠标错位;portal 脱离
                  后 clientX/Y 恢复视口语义(#38 导航条同类先例)。命中测试
                  用 getBoundingClientRect(恒为视口真值)不受影响 */}
              {marqueeRect !== null
                ? createPortal(
                    <div
                      className="vua-warehouse__marquee"
                      style={{
                        left: `${marqueeRect.left}px`,
                        top: `${marqueeRect.top}px`,
                        width: `${marqueeRect.width}px`,
                        height: `${marqueeRect.height}px`,
                      }}
                    />,
                    document.body,
                  )
                : null}
              {listState.kind === "loading" ? (
                /* 真实加载期间:与卡片墙同形的骨架(ui-ux §2.8) */
                <div className="vua-warehouse__wall" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, index) => (
                    <div className="vua-warehouse-card" key={index}>
                      <Skeleton width="100%" height="auto" className="vua-warehouse-card__skeleton-media" />
                      <div className="vua-warehouse-card__body">
                        <Skeleton width="90%" height={14} />
                        <Skeleton width="60%" height={12} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : resultsView !== null && resultsView.items.length === 0 && localCards.length === 0 ? (
                adaptation !== null ? <EmptyState title={copy.adaptation.emptyTitle} /> : emptyCard.kind === "checking" || emptyCard.kind === "unknown" ? (
                  <EmptyState
                    title={emptyCard.kind === "checking" ? copy.catalogSync.checking : copy.catalogSync.checkFailed}
                    {...(emptyCard.kind === "unknown" ? { action: <Button onClick={() => setAccountProbeKey(key => key + 1)}>{copy.catalogSync.retryCheck}</Button> } : {})}
                  />
                ) : emptyCard.kind === "sign-in" ? (
                  <EmptyState
                    title={copy.catalogSync.signInTitle}
                    action={
                      <Button
                        variant="default"
                        onClick={() => {
                          // 窗口级登录浏览器(2026-10-05 用户裁决):登录不再
                          // 借用素材导入弹窗(已废弃的过渡形态);导航条直挂
                          // 窗口,登录成功 6 秒倒计时自动关闭
                          openLoginBrowser(BOOTH_SIGN_IN_URL);
                        }}
                      >
                        {copy.catalogSync.signInAction}
                      </Button>
                    }
                  />
                ) : emptyCard.kind === "sync-available" ? (
                  <EmptyState
                    title={copy.catalogSync.syncTitle}
                    action={
                      <Button variant="primary" disabled={syncStarting || loginBrowserOpen || importDialogOpen} onClick={() => void startCatalogSync()}>
                        {syncStarting ? copy.catalogSync.checking : copy.catalogSync.action}
                      </Button>
                    }
                  />
                ) : (
                  /* 搜索/筛选无结果 ≠ 目录未接入 */
                  <EmptyState title={filtersActive ? view.emptyFiltered : copy.states.emptyResultTitle} {...(filtersActive ? { action: <Button onClick={clearFilters}>{view.clear}</Button> } : {})} />
                )
              ) : resultsView !== null || localCards.length > 0 ? (
                <div
                  className={
                    viewMode === "cards"
                      ? "vua-warehouse__wall"
                      : "vua-warehouse__list"
                  }
                  role={viewMode === "cards" ? "list" : "table"}
                >
                  {viewMode === "list" ? columns.header : null}
                  {rows.map((row) => {
                      if (row.kind === "local") {
                        const card = row.card;
                        return <MaterialEntryView
                          viewMode={viewMode} columnStyle={columns.style} facts={libraryPage?.facts.get(card.entry.warehouseItemId)}
                          key={card.key}
                          card={card}
                          source={libraryPage?.facts.get(card.entry.warehouseItemId)?.sourceMatch?.product}
                          metadata={libraryPage?.facts.get(card.entry.warehouseItemId)?.metadata}
                          badges={<LibraryBadges facts={libraryPage?.facts.get(card.entry.warehouseItemId)} compact />}
                          corner={<LibraryCorner state={libraryCornerState(libraryPage?.facts.get(card.entry.warehouseItemId), "local", { sourceSearch: sourceSearch.get(card.entry.warehouseItemId) })}
                            busy={cornerBusy.has(card.entry.warehouseItemId)} onAction={knownLocalProduct(card.entry.warehouseItemId) == null ? () => void searchBoothSource(card.entry.warehouseItemId, card.entry.displayName) : undefined} />}
                          fact={sortFactLabel(sortFact, libraryPage?.facts.get(card.entry.warehouseItemId), libraryPage?.facts.get(card.entry.warehouseItemId)?.sourceMatch?.product.price)}
                          selected={selectedIds.has(card.key)}
                          onSelect={(event) => selectSingle(card.key, event)}
                          onOpen={() => {
                            setSelectedId(null);
                            setSelectedLocalId(card.entry.warehouseItemId);
                          }}
                          onMenu={(event) => openLocalMenu(event, card)}
                        />;
                      }
                      const item = row.item;
                      const corner = productCornerFacts(item);
                      return viewMode === "cards" ? (
                          <WarehouseCard
                            key={item.productId}
                            item={item}
                            facts={libraryPage?.facts.get(item.productId)}
                            cornerState={corner.state} cornerBusy={cornerBusy.has(item.productId)} cornerActs={corner.acts} onCorner={onProductCorner}
                            fact={sortFactLabel(sortFact, libraryPage?.facts.get(item.productId), item.price)}
                            selected={selectedIds.has(item.productId)}
                            onSelect={onProductSelect}
                            onOpen={onProductOpen}
                            onMenu={onProductMenu}
                          />
                        ) : (
                          <LibraryListRow
                            key={item.productId}
                            id={item.productId} productId={item.productId} title={item.title ?? item.productId} shop={item.shopName} variant={item.variantName}
                            variantCount={libraryPage?.facts.get(item.productId)?.variantCount} sizeBytes={libraryPage?.facts.get(item.productId)?.sizeBytes} addedAt={libraryPage?.facts.get(item.productId)?.addedAt} style={columns.style}
                            source={libraryListSource(libraryPage?.facts.get(item.productId), "product", {
                              active: transfers.some(transfer => transfer.productId === item.productId),
                              paused: transfers.filter(transfer => transfer.productId === item.productId).every(transfer => transfer.paused),
                            })}
                            selected={selectedIds.has(item.productId)}
                            onSelect={(event) => selectSingle(item.productId, event)}
                            onOpen={() => {
                              setSelectedLocalId(null);
                              setSelectedId(item.productId);
                            }}
                            onMenu={(event) => openCardMenu(event, item)}
                          />
                        );
                    })}
                </div>
              ) : null}
              {hasMore || moreFailed ? <div ref={moreRef} className="vua-warehouse__more">
                {moreFailed ? <Button variant="subtle" data-nav-id="warehouse-load-more" onClick={() => { setMoreFailed(false); setWanted(loadedCount + LIBRARY_BATCH + 1); }}>{strings.warehouse.states.retry}</Button>
                  : <DelayedStatus>{view.loadingMore}</DelayedStatus>}
              </div> : null}
            </div>
            {/* The way to start a line: select a card, and its next step appears here. Single click selects
                (Explorer semantics, 2026-10-05), so a card's own click cannot be the action. */}
            {!detailOpen && selectedIds.size > 0 ? <div className="vua-warehouse__selection" role="region" aria-label={format(structure.selected, { count: selectedIds.size })} data-nav-id="warehouse-selection">
                <span className="vua-warehouse__selection-name">
                  <strong>{format(structure.selected, { count: selectedIds.size })}</strong>
                  {soleTitle !== null ? <span title={soleTitle}>{soleTitle}</span> : null}
                </span>
                <span className="vua-warehouse__selection-actions">
                  {amfStartReady && soleAvatar !== null ? <Button variant="primary" data-nav-id="warehouse-start-line" onClick={() => setStartAvatar(soleAvatar)}>{strings.factory.materialsStart.startCta}</Button> : null}
                  {soleOpen !== null ? <Button data-nav-id="warehouse-open-details" onClick={soleOpen}>{structure.openDetails}</Button> : null}
                  <Button variant="subtle" disabled={selectedRecipeRefs.length === 0 || selectedRecipeRefs.length > 512} onClick={() => {
                    setContextSelection(selectedRecipeRefs); setRecipeDialogOpen(true);
                  }}>{format(copy.selectBar.addToRecipe, { count: selectedRecipeRefs.length })}</Button>
                  <Button variant="subtle" onClick={() => setSelectedIds(new Set())}>{copy.selectBar.clearSelection}</Button>
                </span>
            </div> : null}
          </div>

        </div>
        )}
        </>
      ) : null}
      </div>
      {selectedId !== null ? (
        detailState.kind === "loading" ? <LibraryDetailLoading title={resultsView?.items.find(item => item.productId === selectedId)?.title ?? selectedId} />
        : detailState.kind === "failed" ? <div className="vua-warehouse-detail__notice">
            <p className="vua-text-secondary">{copy.detail.loadFailed}</p>
            <div><Button variant="default" onClick={() => setDetailReloadKey((key) => key + 1)}>{copy.detail.retry}</Button></div>
          </div>
        : detailState.view.kind === "detail" ? (() => {
            const product = detailState.view.product;
            const title = product.title ?? product.productId;
            const summary = resultsView?.items.find(item => item.productId === selectedId);
            return <ProductDetail key={product.productId} product={product} facts={libraryPage?.facts.get(selectedId)} title={title} filesRevision={reloadKey}
              badges={<LibraryBadges facts={libraryPage?.facts.get(selectedId)} />}
              onManageFiles={() => setChecklistProduct({ productId: selectedId, title })}
              onTermsUpdated={() => setReloadKey(key => key + 1)}
              onEnriched={() => refreshEnrichedDetail(selectedId)}
              actions={<>
                {amfStartReady ? <Button variant="primary" className="vua-warehouse-detail__start" onClick={() => setStartAvatar({ productId: selectedId, title: product.title, imageUrl: product.imageUrl })}>{strings.factory.materialsStart.startCta}</Button> : null}
                <Button onClick={() => void openBooth(selectedId)}>{copy.sourceSearch.openBooth}</Button>
                {summary !== undefined ? <Button variant="subtle" className="vua-warehouse-detail__menu" aria-label={view.detail.more} title={view.detail.more} aria-haspopup="menu" data-nav-id="warehouse-detail-more" onClick={event => openCardMenu(event, summary)}><Icon name="more" size={16} /></Button> : null}
              </>} />;
          })()
        : detailState.view.kind === "error" ? <div className="vua-warehouse-detail__notice">
            <p className="vua-text-secondary">{catalogErrorText(detailState.view.messageKey)}</p>
            <div><Button variant="default" onClick={() => setDetailReloadKey((key) => key + 1)}>{copy.detail.retry}</Button></div>
          </div>
        : <div className="vua-warehouse-detail__notice"><p className="vua-text-secondary">{copy.detail.notFound}</p></div>
      ) : null}
      {selectedLocalEntry !== null ? (() => {
        const entryFacts = libraryPage?.facts.get(selectedLocalEntry.warehouseItemId);
        const localCard = visibleLocalCards.find(card => card.entry.warehouseItemId === selectedLocalEntry.warehouseItemId);
        const title = entryFacts?.metadata?.displayName ?? selectedLocalEntry.displayName;
        return <EntryDetail key={selectedLocalEntry.warehouseItemId} entryId={selectedLocalEntry.warehouseItemId} globalDefault={inferGlobalDefaultMode(localEntries)} facts={entryFacts} title={title}
          badges={<LibraryBadges facts={entryFacts} />} onTermsUpdated={() => setReloadKey(key => key + 1)}
          actions={<>
            {amfStartReady ? <Button variant="primary" className="vua-warehouse-detail__start" onClick={() => setStartAvatar({ entryId: selectedLocalEntry.warehouseItemId, title, imageUrl: entryFacts?.metadata?.thumbnailRef ?? entryFacts?.sourceMatch?.product.imageUrl ?? null })}>{strings.factory.materialsStart.startCta}</Button> : null}
            {knownLocalProduct(selectedLocalEntry.warehouseItemId) != null ? <Button onClick={() => { const id = knownLocalProduct(selectedLocalEntry.warehouseItemId); if (id) void openBooth(id); }}>{copy.sourceSearch.openBooth}</Button>
              : <Button disabled={cornerBusy.has(selectedLocalEntry.warehouseItemId)} onClick={() => void searchBoothSource(selectedLocalEntry.warehouseItemId, selectedLocalEntry.displayName)}>{copy.sourceSearch.title}</Button>}
            {localCard !== undefined ? <Button variant="subtle" className="vua-warehouse-detail__menu" aria-label={view.detail.more} title={view.detail.more} aria-haspopup="menu" data-nav-id="warehouse-detail-more" onClick={event => openLocalMenu(event, localCard)}><Icon name="more" size={16} /></Button> : null}
          </>} />;
      })() : null}
      {/* Local entries and observed products share the same preparation confirmation. */}
      {startAvatar !== null ? (
        <MaterialsStartDialog
          avatar={startAvatar}
          onNavigate={(target) => onNavigate?.(target)}
          onClose={() => setStartAvatar(null)}
        />
      ) : null}
      {cardMenu !== null ? (
        <ContextMenu menu={cardMenu} onClose={() => setCardMenu(null)} />
      ) : null}
      <ContentDialog open={folderChoices !== null} title={copy.cardMenu.openFolder} closeLabel={strings.common.dialogClose} onClose={() => { if (!openingFolder) { setFolderChoices(null); setFolderOpenFailed(false); } }}>
        <div className="vua-page__stack">
          <p>{copy.cardMenu.chooseFolder}</p>
          {folderChoices?.map(entry => <Button key={entry.entryId} disabled={openingFolder} onClick={() => void openEntryFolder(entry.entryId)}><Icon name="folder" size={16} />{entry.displayName}</Button>)}
          {folderOpenFailed ? <p role="status">{copy.openFolderFailed}</p> : null}
        </div>
      </ContentDialog>
      <ContentDialog
        open={importDialogOpen}
        title={strings.importPage.localTitle}
        closeLabel={strings.common.dialogClose}
        onClose={() => {
          setImportDialogOpen(false);
          setImportInitialUrl(null);
        }}
      >
        {/* onRequestClose(W25 走查缺陷③根因修复):受理态自动关闭与失败态
            醒目「关闭」按钮的关闭请求线——受理后 ~1.5s 弹窗自动收口,任务
            进度归任务中心;模态滞留被用户视作整屏卡死的行为终止。 */}
        <ImportPage
          onRequestClose={() => {
            setImportDialogOpen(false);
            setImportInitialUrl(null);
          }}
          initialUrl={importInitialUrl ?? undefined}
        />
      </ContentDialog>
      {matchDialog === null ? null : <BoothMatchDialog key={matchDialog.entryId} name={matchDialog.name} result={matchDialog.result} busy={cornerBusy.has(matchDialog.entryId)} notice={matchNotice}
        onClose={() => setMatchDialog(null)} onSearch={query => void searchBoothSource(matchDialog.entryId, matchDialog.name, query, false)}
        onConfirm={id => void confirmBoothSource(matchDialog.entryId, id)} onOpen={id => void openBooth(id)} />}
      <AddToRecipeDialog
        open={recipeDialogOpen}
        onClose={() => setRecipeDialogOpen(false)}
        selections={contextSelection}
      />
      {bulkDownload !== null ? <BulkDownloadDialog {...bulkDownload} onClose={() => setBulkDownload(null)} onChanged={() => setReloadKey(key => key + 1)} /> : null}
      {bulkRemovalTargets !== null ? <BulkRemoveFilesDialog items={bulkRemovalTargets} onClose={() => setBulkRemovalTargets(null)} onChanged={() => setReloadKey(key => key + 1)} onInspect={item => { setBulkRemovalTargets(null); setRemovalTarget(item); }} /> : null}
      {removalTarget !== null ? <RemoveFilesDialog key={`${removalTarget.target.kind}:${removalTarget.target.id}`} item={removalTarget}
        onClose={() => setRemovalTarget(null)} onChanged={() => { setReloadKey((key) => key + 1); setDetailReloadKey((key) => key + 1); }} /> : null}
      {metadataEntries !== null ? <EditSourceDialog key={metadataEntries.map((entry) => entry.entryId).join(",")} entries={metadataEntries}
        onClose={() => setMetadataEntries(null)} onChanged={() => { setReloadKey((key) => key + 1); setDetailReloadKey((key) => key + 1); }} /> : null}
      <DownloadChecklistDialog
        product={checklistProduct}
        onClose={() => setChecklistProduct(null)}
        onStart={(productId, downloadableIds, targets) => {
          setChecklistProduct(null);
          void startSilentDownload(productId, downloadableIds, targets);
        }}
      />
      {migrationPreviewOpen ? <LibraryMigrationPreview onClose={() => setMigrationPreviewOpen(false)} /> : null}
      {removedCards !== null ? <RemoveCardsDialog key={removedCards.map(card => `${card.target.kind}:${card.target.id}`).join(",")} cards={removedCards} onClose={() => setRemovedCards(null)} onChanged={() => {
        setSelectedIds(new Set()); setSelectedId(null); setSelectedLocalId(null); setReloadKey(key => key + 1); setDetailReloadKey(key => key + 1);
      }} /> : null}
    </div>
  );
}

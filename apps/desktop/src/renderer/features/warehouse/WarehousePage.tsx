import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { isCatalogSyncSnapshotV03, isLibraryDownloadSnapshotV01, type CatalogSyncSnapshotV03 } from "@vua/contracts";
import { catalogSyncNotice, type CatalogSyncNotice } from "./catalog-sync-model.ts";
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
  useDataSource,
  type LibraryPageView,
  type LibraryCardFacts,
  type CatalogAvailabilityStatus,
  type CatalogDetailView,
  type CatalogErrorKey,
  type CatalogListView,
  type CatalogProductDetail,
  type CatalogProductSummary,
  type CatalogRelationKind,
} from "../../gateway/index.ts";
import { format, strings, termLabel } from "../../i18n/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { ProductionFlowSectionHost } from "../workshop/ProductionFlowSectionHost.tsx";
import { useDebugMode } from "../../app/debug-mode.ts";
import { useCardSpotlight } from "./use-card-spotlight.ts";
import type { RecipeAssetRef } from "../../gateway/index.ts";
import { AddToRecipeDialog } from "./AddToRecipeDialog.tsx";
import { CompatibleItemsDialog } from "./CompatibleItemsDialog.tsx";
import { registerTaskIdentity } from "../../gateway/index.ts";
import { CardAlbumMedia, DetailAlbum } from "./WarehouseAlbum.tsx";
import { ArtifactCard, EntryDetail } from "./WarehouseAcquire.tsx";
import { EditSourceDialog } from "./EditSourceDialog.tsx";
import { artifactCardMatches, artifactCards, inferGlobalDefaultMode } from "./acquire-model.ts";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { ImportPage } from "../import/ImportPage.tsx";
import {
  catalogEmptyCard,
  emptyWarehouseQuery,
  hasActiveFilter,
  priceKind,
  toPortQuery,
  type WarehouseQueryState,
} from "./warehouse-model.ts";
import { BOOTH_SIGN_IN_URL } from "../import/import-model.ts";
import { openLoginBrowser, useLoginBrowserRequest } from "../../app/login-browser-store.ts";
import { useDownloadChecklist } from "../../app/download-checklist-flag.ts";
import { DownloadChecklistDialog } from "./DownloadChecklistDialog.tsx";
import { RemoveFilesDialog, type RemovalDialogTarget } from "./RemoveFilesDialog.tsx";
import "./warehouse.css";

const copy = strings.warehouse;

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

/** 实体类型显示名:已知类型走 i18n;词表外新类型回落原文(词表随数据,不崩溃) */
function entityTypeLabel(value: string): string {
  return (copy.entityType as Record<string, string>)[value] ?? value;
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
 *   已购买用 success 芯片;不使用轨道语汇;吉祥物只出现在空态组件内。
 */

type ListState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; view: CatalogListView };

type DetailState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; view: CatalogDetailView };

function priceText(product: {
  price: CatalogProductSummary["price"];
  priceHigh?: string | null | undefined;
}): string | null {
  switch (priceKind(product.price)) {
    case "free":
      return copy.card.free;
    case "none":
      // 未知价格不渲染价格行(2026-10-03 用户裁决):库行未富化前
      // "无价格信息"占位是噪音;富化后价格自然出现
      return null;
    case "priced":
      // 价格纪律:字符串金额原样展示,绝不经 JS number 转换;
      // 多变体价区间(1400~2400)在 high 存在且不同时以区间展示
      return format(
        product.priceHigh !== null && product.priceHigh !== undefined && product.priceHigh !== product.price?.amount
          ? copy.card.priceRange
          : copy.card.price,
        {
          currency: product.price?.currency ?? "",
          amount: product.price?.amount ?? "",
          high: product.priceHigh ?? "",
        },
      );
  }
}

/* ---- 商品卡片 ---- */

function LibraryBadges({ facts }: { facts: LibraryCardFacts | undefined }) {
  if (facts === undefined) return null;
  return <>
    <Badge tone={facts.storage.state === "present" || facts.storage.state === "cloud_only" ? "neutral" : "warning"}>
      {copy.libraryState[facts.storage.state]}
    </Badge>
    {facts.sourceMatch === undefined ? null : <>
      {facts.sourceMatch.basis !== "mapping" ? <Badge tone="neutral">{copy.libraryState.sourceSuggested}</Badge> : null}
      <Badge tone="neutral">{facts.sourceMatch.content === "different" ? copy.libraryState.contentDifferent : copy.libraryState.contentUnverified}</Badge>
    </>}
    {facts.storage.supersededGeneratedCopies > 0 ? <Badge tone="neutral">{copy.removeFiles.oldVersion}</Badge> : null}
    {(facts.storage.unexpandedArchives ?? 0) > 0 ? <Badge tone="warning">{copy.libraryState.unexpandedArchives}</Badge> : null}
    {facts.storage.supersededGeneratedCopies > 0 && facts.storage.currentGeneratedCopies === 0 ? <Badge tone="warning">{copy.removeFiles.regenerate}</Badge> : null}
    {facts.operation?.inspectRequired ? <Badge tone="warning">{copy.libraryState.inspectRequired}</Badge>
      : facts.operation?.state === "running" ? <Badge tone="neutral">{copy.libraryState.downloading}</Badge>
      : facts.operation?.state === "failed" ? <Badge tone="warning">{copy.libraryState.downloadFailed}</Badge>
      : facts.operation?.state === "succeeded_with_warnings" ? <Badge tone="warning">{copy.libraryState.downloadPartial}</Badge> : null}
  </>;
}

/** 卡/行交互基座(Explorer 语义,用户裁决 2026-10-05):单击 = 选中该卡,
 * 双击/Enter = 打开详情,右键 = 交页面菜单(按选区约定裁决作用域)。
 * data-product-id 既是选区归属标记,也是框选命中测试的锚点。 */
function WarehouseListRow({
  item,
  facts,
  selected,
  onSelect,
  onOpen,
  onMenu,
}: {
  item: CatalogProductSummary;
  facts?: LibraryCardFacts | undefined;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className="vua-warehouse-list-row"
      data-selected={selected || undefined}
      data-product-id={item.productId}
      role="listitem"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="vua-warehouse-list-row__title">{item.title ?? item.productId}</span>
      {item.variantName !== null ? (
        <span className="vua-warehouse-list-row__variant">{item.variantName}</span>
      ) : null}
      <span className="vua-warehouse-list-row__shop">{item.shopName ?? copy.card.unknownShop}</span>
      {facts !== undefined ? <LibraryBadges facts={facts} /> : item.importedArtifacts > 0 ? (
        <span className="vua-caption">{copy.importedBadge}</span>
      ) : null}
      <Button variant="subtle" aria-label={copy.removeFiles.actions} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); onMenu(event); }}>⋯</Button>
    </div>
  );
}

function WarehouseCard({
  item,
  facts,
  selected,
  onSelect,
  onOpen,
  onMenu,
}: {
  item: CatalogProductSummary;
  facts?: LibraryCardFacts | undefined;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  /** 素材卡右键菜单(S-XII):由页面组装真实动作项 */
  onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <article
      className="vua-warehouse-card"
      data-selected={selected || undefined}
      data-product-id={item.productId}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      // 键盘可达:Enter/Space 打开详情(用户反馈 #5;购买标记由其他功能模块承担)
      role="listitem"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="vua-warehouse-card__media">
        {item.imageUrls.length > 0 ? (
          // 多图卡:悬停 2s 进相册(光标横向位置翻页);单图退化为普通媒体槽
          <CardAlbumMedia imageUrls={item.imageUrls} title={item.title ?? item.productId} />
        ) : (
          <div className="vua-warehouse-card__no-image">
            <span className="vua-caption vua-text-secondary">{copy.card.noImage}</span>
          </div>
        )}
      </div>
      <div className="vua-warehouse-card__body">
        {/* 两行截断;hover 经 title 属性显示全称;无题观测回落 productId */}
        <p className="vua-warehouse-card__title" title={item.title ?? item.productId}>
          {item.title ?? item.productId}
        </p>
        {item.variantName !== null ? (
          <p className="vua-warehouse-card__variant" title={item.variantName}>
            {item.variantName}
          </p>
        ) : null}
        {item.shopName !== null ? (
          <p className="vua-caption vua-text-secondary vua-warehouse-card__shop">
            {item.shopName}
          </p>
        ) : null}
        <div className="vua-warehouse-card__badges">
          {/* 在售是默认态不贴标;停售/未知/墓碑以中性灰文字徽标表达(§6.1) */}
          {/* 未知 = 诚实缺席不渲染(人审 2026-10-07);仅停售等明确事实出徽标 */}
          {item.availability !== "available" && item.availability !== "unknown" ? (
            <Badge tone="neutral">{copy.availability[item.availability]}</Badge>
          ) : null}
        {facts !== undefined ? <LibraryBadges facts={facts} /> : item.importedArtifacts > 0 ? (
          <Badge tone="neutral">{copy.importedBadge}</Badge>
        ) : null}
        </div>
        <Button variant="subtle" aria-label={copy.removeFiles.actions} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); onMenu(event); }}>⋯</Button>
      </div>
    </article>
  );
}

/* ---- 详情抽屉 ---- */

function DetailContent({
  product,
  onEnriched,
}: {
  product: CatalogProductDetail;
  onEnriched?: () => void;
}) {
  // 调试模式(设置·版本页开关):显示解析后的完整领域 JSON(含实体 UUID),
  // 供排查"数据问题还是解析问题";仅影响展示,与页面渲染同源
  const debugMode = useDebugMode();
  // 来源跳转失败(系统浏览器调用被拒/出错)时显式提示,不静默吞掉
  const [openSourceFailed, setOpenSourceFailed] = useState(false);
  // 视频链接跳转失败:同样显式提示(v0.3 增量字段 videoUrls)
  const [openVideoFailed, setOpenVideoFailed] = useState(false);
  // 应用内窗口打开失败(S-IX-3):同样显式提示,引导改用系统浏览器
  const [openInAppFailed, setOpenInAppFailed] = useState(false);
  // 懒加载富化(N5 D2,2026-10-03):库行观察只有标题/缩略/店铺;
  // 缺描述且缺变体 = 未富化 → 经分区会话抓商品页,provider 全量观察后
  // 上层重取详情即得画廊/描述/变体/上架日期。失败静默保留现状
  // (详情仍可用,只是未增强)。
  const [enriching, setEnriching] = useState(false);
  // onEnriched 固定到 ref:内联箭头每次渲染产生新引用,旧实现的 effect
  // 依赖数组含它 → 父组件渲染即重跑 effect → 清理函数置 active=false →
  // 在途 fetch 的回调被丢弃 → 首开抽屉收不到重取通知(真机 2026-10-03
  // 确诊的"要点走再点回来"根因)
  const onEnrichedRef = useRef(onEnriched);
  onEnrichedRef.current = onEnriched;
  useEffect(() => {
    const unenriched = product.description === null && product.variations.length === 0;
    if (!unenriched || enriching) return;
    const face = window.vua?.catalogSync;
    if (face === undefined || !("fetchProduct" in face)) return;
    setEnriching(true);
    void face
      .fetchProduct(product.productId)
      .then((result) => {
        if (result.ok) onEnrichedRef.current?.();
      })
      .catch(() => {})
      .finally(() => setEnriching(false));
  }, [product.productId, product.description, product.variations.length, enriching]);
  return (
    <div className="vua-warehouse-detail__content">
      {/* 相册:详情媒体数组;详情缺媒体时回落主图单张(列表兜底场景) */}
      <DetailAlbum
        imageUrls={
          product.media.imageUrls.length > 0
            ? product.media.imageUrls
            : product.imageUrl !== null
              ? [product.imageUrl]
              : []
        }
        title={product.title ?? product.productId}
      />
      {/* 3D 预览占位(S-VFX-4):VRM 实时预览落地前的诚实槽位,
       * 平面槽与已有 media-slot 风格一致,不做假渲染 */}
      <section>
        <h3 className="vua-warehouse-detail__section-title">{copy.detail.preview3dTitle}</h3>
        <div className="vua-warehouse-detail__preview3d">
          <span className="vua-caption vua-text-secondary">{copy.detail.preview3dNote}</span>
        </div>
      </section>
      <div className="vua-warehouse-detail__badges">
        {/* 未知 = 诚实缺席不渲染(人审 2026-10-07);仅明确事实出徽标 */}
        {product.availability !== "available" && product.availability !== "unknown" ? (
          <Badge tone="neutral">{copy.availability[product.availability]}</Badge>
        ) : null}
        {/* Adult 徽标位必须显式(v0.3 仅显式 BOOTH Adult 徽标为真) */}
        {product.adult ? <Badge tone="neutral">{copy.detail.adultBadge}</Badge> : null}
        {/* BOOTH 展示分类原文:徽标呈现,不做翻译或推断 */}
        {product.sourceCategory !== null ? (
          <Badge tone="neutral">{product.sourceCategory}</Badge>
        ) : null}
        {product.entities.map((entity) => (
          <Badge key={entity.entityId} tone="neutral">
            {entityTypeLabel(entity.entityType)}
          </Badge>
        ))}
      </div>
      {product.availability === "deleted" ? (
        <p className="vua-caption vua-text-secondary">{copy.detail.tombstoneNote}</p>
      ) : null}
      {/* 观测原词证据:只在详情展示,永不参与徽标与筛选 */}
      {product.availabilityRaw !== null ? (
        <p className="vua-caption vua-text-secondary">
          {format(copy.detail.availabilityEvidence, { raw: product.availabilityRaw })}
        </p>
      ) : null}
      {product.ageRestriction !== null ? (
        <p className="vua-caption vua-text-secondary">
          {format(copy.detail.ageRestrictionNote, { value: product.ageRestriction })}
        </p>
      ) : null}
      <p className="vua-warehouse-detail__price">{priceText({ price: product.price, priceHigh: product.price?.high })}</p>

      <section>
        <h3 className="vua-warehouse-detail__section-title">{copy.detail.entitiesTitle}</h3>
        {product.entities.length === 0 ? (
          <p className="vua-caption vua-text-secondary">{copy.detail.entitiesEmpty}</p>
        ) : (
          <ul className="vua-warehouse-detail__entities">
            {product.entities.map((entity) => (
              <li key={entity.entityId}>
                <span>{entity.canonicalName ?? entity.entityId}</span>
                {entity.relations.length > 0 ? (
                  <span className="vua-warehouse-detail__relations">
                    {entity.relations.map((relation) => (
                      <Badge
                        key={`${relation.kind}:${relation.objectEntityId}`}
                        tone="neutral"
                        title={relation.objectEntityId}
                      >
                        {/* 关系对象名经实体档案补齐;库外实体回落只显示关系种类 */}
                        {relation.objectName !== null
                          ? `${copy.relationKind[relation.kind]}: ${relation.objectName}`
                          : copy.relationKind[relation.kind]}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {product.attribution !== null ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">{copy.detail.attributionTitle}</h3>
          <p className="vua-caption vua-text-secondary">
            {[product.attribution.shopName, product.attribution.creatorName]
              .filter((value): value is string => value !== null)
              .join(" / ")}
          </p>
        </section>
      ) : null}

      {/* 多版本商品的变体价(v0.3 subproducts):单价商品为空,区块自然消失 */}
      {product.subproducts.length > 0 ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">{copy.detail.subproductsTitle}</h3>
          <ul className="vua-warehouse-detail__subproducts">
            {product.subproducts.map((subproduct, index) => (
              <li key={subproduct.variationId ?? index}>
                <span>
                  {/* 无名变体继承商品标题(人审 2026-10-07:显示 BoothID 是
                      泄内部身份,不是用户语义) */}
                  {subproduct.name
                    ?? product.title
                    ?? copy.detail.subproductUnnamed}
                </span>
                <span className="vua-caption vua-text-secondary">{priceText(subproduct)}</span>
                {/* 变体购买事实(人审 2026-10-07):库同步携带的已购变体名
                    与本行名一致 = 已购买;availability 未知不渲染(诚实缺席) */}
                {product.variantName !== null
                  && subproduct.name !== null
                  && subproduct.name === product.variantName ? (
                  <Badge tone="success">{copy.detail.variantPurchasedBadge}</Badge>
                ) : null}
                {subproduct.availability !== "available" && subproduct.availability !== "unknown" ? (
                  <Badge tone="neutral">{copy.availability[subproduct.availability]}</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 视频媒体(v0.3 videoUrls):外跳系统浏览器,失败诚实提示 */}
      {product.media.videoUrls.length > 0 ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">{copy.detail.videosTitle}</h3>
          <ul className="vua-warehouse-detail__videos">
            {product.media.videoUrls.map((url) => (
              <li key={url}>
                <Button
                  variant="default"
                  onClick={() => {
                    setOpenVideoFailed(false);
                    void openExternalUrl(url).then((ok) => {
                      if (!ok) setOpenVideoFailed(true);
                    });
                  }}
                >
                  {url}
                </Button>
              </li>
            ))}
          </ul>
          {openVideoFailed ? (
            <p className="vua-caption vua-text-secondary">{copy.detail.openVideoFailed}</p>
          ) : null}
        </section>
      ) : null}

      {product.terms.length > 0 ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">{copy.detail.termsTitle}</h3>
          <div className="vua-warehouse-detail__badges">
            {product.terms.map((term) => (
              <Badge key={term.termKey} tone="neutral">
                {term.label ?? term.termKey}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {product.description !== null ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">{copy.detail.descriptionTitle}</h3>
          <p className="vua-caption vua-text-secondary vua-warehouse-detail__description">
            {product.description}
          </p>
        </section>
      ) : null}

      {product.sourceUrl !== null ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">{copy.detail.sourceTitle}</h3>
          <p className="vua-caption vua-text-secondary vua-warehouse-detail__source-url">
            {product.sourceUrl}
          </p>
          <div className="vua-warehouse-detail__source-actions">
            {/* 应用内窗口(S-IX-3):仅桌面壳内渲染入口;失败诚实提示 */}
            {browseWindowSupported() ? (
              <Button
                variant="default"
                onClick={() => {
                  setOpenInAppFailed(false);
                  const url = product.sourceUrl;
                  if (url === null) return;
                  void openBrowseWindow(url, product.title ?? product.productId).then((ok) => {
                    if (!ok) setOpenInAppFailed(true);
                  });
                }}
              >
                {copy.detail.openInApp}
              </Button>
            ) : null}
            <Button
              variant="default"
              onClick={() => {
                setOpenSourceFailed(false);
                const url = product.sourceUrl;
                if (url === null) return;
                void openExternalUrl(url).then((ok) => {
                  if (!ok) setOpenSourceFailed(true);
                });
              }}
            >
              {copy.detail.openSource}
            </Button>
          </div>
          {openInAppFailed ? (
            <p className="vua-caption vua-text-secondary">{copy.detail.openInAppFailed}</p>
          ) : null}
          {openSourceFailed ? (
            <p className="vua-caption vua-text-secondary">{copy.detail.openSourceFailed}</p>
          ) : null}
          <p className="vua-caption vua-text-secondary">
            {format(copy.detail.sourceUrlNote, { warehouse: termLabel("warehouse") })}
          </p>
        </section>
      ) : null}

      {debugMode ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">{copy.detail.debugTitle}</h3>
          <pre className="vua-warehouse-detail__debug">{JSON.stringify(product, null, 2)}</pre>
        </section>
      ) : null}
    </div>
  );
}

/* ---- 页面 ---- */

export function WarehousePage({
  onNavigate,
}: {
  /** 素材直产链记录卡「去出厂」链钮透传(029 A6 迁入);与流水线同一导航原语 */
  onNavigate?: ((target: PageId) => void) | undefined;
}) {
  const dataSource = useDataSource();
  const connected = dataSource !== "none";
  // 单库页(用户方向 2026-10-02):云端三来源 + 本地,来源只作筛选
  // 视图模式(用户裁决 2026-03):卡片墙(带图)↔ 纯文字标题列表
  const [viewMode, setViewMode] = useState<"cards" | "list">("cards");
  // 选区(Explorer 语义,用户裁决 2026-10-05):单击选卡/框选/右键拖选,
  // 无独立"选择模式"开关;Esc、空白单击、重新框选即清空
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [contextSelection, setContextSelection] = useState<readonly RecipeAssetRef[]>([]);
  // 适配依赖小窗(N5):query 即打开意图,null = 关闭
  const [compatibleQuery, setCompatibleQuery] = useState<{
    productId: string;
    title: string;
  } | null>(null);
  const [removalTarget, setRemovalTarget] = useState<RemovalDialogTarget | null>(null);
  const [metadataEntries, setMetadataEntries] = useState<readonly { readonly entryId: string; readonly displayName: string }[] | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
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
  >("all");
  const [downloadState, setDownloadState] = useState<"all" | "downloaded" | "not-downloaded" | "missing" | "in_progress" | "attention">("all");
  const [libraryPage, setLibraryPage] = useState<LibraryPageView | null>(null);
  const [pageOffset, setPageOffset] = useState(0);

  const [query, setQuery] = useState<WarehouseQueryState>(emptyWarehouseQuery);
  const [listState, setListState] = useState<ListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ kind: "loading" });
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  /** 素材卡右键菜单(S-XII):null 即关闭;动作全部映射真实能力 */
  const [cardMenu, setCardMenu] = useState<ContextMenuState | null>(null);
  // 素材导入弹窗(2026-09-20 导航重构):原独立页收敛为仓储页内弹窗,
  // 弹窗关闭即卸载 ImportPage——其「卸载即在途关闭内嵌视图」生命周期语义原样生效
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  // 定向首开地址(右键「下载到本地」):null = 常规入口(本地/云端选择步)
  const [importInitialUrl, setImportInitialUrl] = useState<string | null>(null);

  /** 账号库同步(N5 S1):登录线索只读探测 + 触发反馈;进度与终态走九态
   * 任务面(通知中心),本页只回触发结果,不伪造运行过程 */
  const remoteBrowser = window.vua?.capabilities?.remoteBrowser === true;
  const [signInHint, setSignInHint] = useState<"stored" | "none" | "unknown" | null>(null);
  const [syncNotice, setSyncNotice] = useState<CatalogSyncNotice | null>(null);
  const [syncProgress, setSyncProgress] = useState<CatalogSyncSnapshotV03 | null>(null);
  const [syncReadFailed, setSyncReadFailed] = useState(false);
  const [syncRunId, setSyncRunId] = useState<string | null>(null);
  /** 统一卡片墙:选中的本地条目(云端商品用 selectedId,两者互斥呈现) */
  const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
  useEffect(() => {
    if (!remoteBrowser) return;
    let active = true;
    void window.vua?.remoteContent?.signInHint().then((hint) => {
      if (active) setSignInHint(hint);
    });
    return () => {
      active = false;
    };
  }, [remoteBrowser]);
  // 登录在导入弹窗内嵌面板完成(修 2026-10-05):弹窗关闭即重探登录线索,
  // 空态卡从登录引导翻为同步引导,无需切页重进
  useEffect(() => {
    if (importDialogOpen || !remoteBrowser) return;
    let active = true;
    void window.vua?.remoteContent?.signInHint().then((hint) => {
      if (active) setSignInHint(hint);
    });
    return () => {
      active = false;
    };
  }, [importDialogOpen, remoteBrowser]);
  // 登录浏览器(2026-10-05)关闭回执:同上重探——登录成功自动关闭(或用户
  // ×)后空态卡立即翻为同步引导
  const loginBrowserOpen = useLoginBrowserRequest() !== null;
  useEffect(() => {
    if (loginBrowserOpen || !remoteBrowser) return;
    let active = true;
    void window.vua?.remoteContent?.signInHint().then((hint) => {
      if (active) setSignInHint(hint);
    });
    return () => {
      active = false;
    };
  }, [loginBrowserOpen, remoteBrowser]);
  const startCatalogSync = async (): Promise<void> => {
    const catalogSync = window.vua?.catalogSync;
    if (catalogSync === undefined) return;
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
    try { outcome = await catalogSync.start({ libraryType }); }
    catch { setSyncNotice("failed"); return; }
    if (outcome.status === "blocked") {
      // 登录引导:门已升级为真实预检(2026-10-05)——「访问过登录页」的
      // 半登录会话(cookie 在、登录未完成)也会被拦截;空态卡翻为登录
      // 形态,同时给可见反馈(动作无可见响应等同于坏)
      setSignInHint("none");
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
  // 统一卡片墙数据源:本地条目(经 acquire 快照,与云端卡同一墙渲染)
  const acquireView = useAcquireView();
  const localEntries = dataSource === "fixture"
    ? acquireView !== null && acquireView.kind === "entries" ? acquireView.entries : []
    : libraryPage?.localEntries ?? [];
  const localCards = artifactCards(localEntries).filter((card) =>
    dataSource !== "fixture" || artifactCardMatches(card, query.text.trim()),
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
          if (notice === "blocked") setSignInHint("none");
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
          setDownloadNotice(copy.cardMenu.downloadInspectHint); setDownloadWatchBatch(null);
        } else if (snapshot.state !== "running") {
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
    if (cardMenu !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardMenu]);

  // 指针聚光 + 微倾斜:回调 ref 追踪 wall-scroll 元素(视图切换会重建它),
  // hook 内部按场景模式决定是否挂载监听(非 animated 模式零开销)
  const [wallEl, setWallEl] = useState<HTMLDivElement | null>(null);
  useCardSpotlight(wallEl);

  /* ---- 框选(Explorer marquee,用户裁决 2026-10-05) ----
   * 墙内任意位置(卡上/空白)按住左或右键拖动即框选;位移超过阈值前按
   * 单击处理(手抖不误入);右键拖动结束时在松开点打开选区菜单。监听挂
   * window(不持 pointer capture),拖出容器仍可跟踪,click 语义不受影响。 */
  const MARQUEE_THRESHOLD_PX = 4;
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

  const marqueeRectOf = (x0: number, y0: number, x1: number, y1: number) => ({
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  });

  const selectByRect = (rect: { left: number; top: number; width: number; height: number }) => {
    const el = wallEl;
    if (el === null) return;
    const ids = new Set<string>();
    const hit = (r: DOMRect) =>
      r.left < rect.left + rect.width && r.right > rect.left
      && r.top < rect.top + rect.height && r.bottom > rect.top;
    for (const card of el.querySelectorAll<HTMLElement>("[data-product-id]")) {
      if (hit(card.getBoundingClientRect())) ids.add(card.dataset.productId ?? "");
    }
    setSelectedIds(ids);
  };

  const onWallPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, select, input, a, textarea") !== null) return;
    const start = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      becameMarquee: false,
    };
    dragStartRef.current = start;
    const onMove = (moveEvent: PointerEvent) => {
      if (
        !start.becameMarquee
        && Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y)
          <= MARQUEE_THRESHOLD_PX
      ) {
        return;
      }
      start.becameMarquee = true;
      const rect = marqueeRectOf(start.x, start.y, moveEvent.clientX, moveEvent.clientY);
      setMarqueeRect(rect);
      selectByRect(rect);
    };
    const finish = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      dragStartRef.current = null;
      setMarqueeRect(null);
      if (!start.becameMarquee) return;
      suppressNextClickRef.current = true;
      if (start.button === 2) {
        suppressNextContextMenuRef.current = true;
        openSelectionMenu(upEvent.clientX, upEvent.clientY);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  // 空白单击清空选区(卡/行自己的单击=选中;抑制标记吞掉框选落定的尾随 click)
  const onWallClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("[data-product-id], button, a, select, input, textarea") === null) {
      clearSelection();
    }
  };

  const onWallContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextContextMenuRef.current) {
      suppressNextContextMenuRef.current = false;
      event.preventDefault();
      return;
    }
    // 空白右键无菜单:抑制原生菜单;卡/行上的右键由其 onContextMenu 处理
    const target = event.target as HTMLElement;
    if (target.closest("[data-product-id]") === null) event.preventDefault();
  };

  // 单击选中(替换选区)——框选落定后的尾随单击经抑制标记吞掉,不塌缩选区
  const selectSingle = (id: string) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    setSelectedIds(new Set([id]));
  };

  // 列表查询:筛选变更保留旧结果(stale-while-revalidate),骨架屏只留给首次加载
  useEffect(() => {
    if (!connected) return;
    let active = true;
    setListState((prev) => (prev.kind === "loaded" ? prev : { kind: "loading" }));
    const read = dataSource === "fixture"
      ? catalogBrowser.list(toPortQuery(query)).then((catalog) => ({ catalog, localEntries: [], facts: new Map(), total: catalog.kind === "results" ? catalog.total : 0, offset: 0, limit: 50 }))
      : libraryBrowser.list({ schemaVersion: "0.1", source: source === "free" ? "free_downloads" : source,
        state: downloadState === "not-downloaded" ? "cloud_only" : downloadState, text: query.text.trim(),
        ...(query.availabilityStatus === "" ? {} : { availabilityStatus: query.availabilityStatus }), limit: 50, offset: pageOffset });
    read.then(
      (page) => {
        if (!active) return;
        if (pageOffset > 0 && pageOffset >= page.total) {
          setPageOffset(Math.max(0, Math.floor((page.total - 1) / 50) * 50));
          return;
        }
        setLibraryPage(page); setListState({ kind: "loaded", view: page.catalog });
      },
      () => {
        if (active) setListState({ kind: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [query, connected, reloadKey, source, downloadState, pageOffset, dataSource]);

  useEffect(() => { setPageOffset(0); setSelectedIds(new Set()); }, [query, source, downloadState]);
  useEffect(() => { setSelectedIds(new Set()); }, [pageOffset]);
  useEffect(() => {
    const refresh = () => setReloadKey((key) => key + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => window.vua?.events.subscribe((event) => {
    if ("taskId" in event && typeof event.payload === "object" && event.payload !== null && "operation" in event.payload && event.payload.operation === "library.reconcileSources") {
      registerTaskIdentity(event.taskId, { title: copy.libraryState.reconciliationTitle, originPage: "warehouse", notifyOnComplete: true });
    }
    if (event.kind === "task.completed" || event.kind === "task.persistenceFailed") {
      setReloadKey((key) => key + 1); setDetailReloadKey((key) => key + 1);
    }
  }), []);

  // 详情查询
  useEffect(() => {
    if (selectedId === null) return;
    let active = true;
    setDetailState({ kind: "loading" });
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

  /** 目录空态卡(N5 S1):未登录→登录引导;已登录/未知→同步引导;筛选中
   *  或非空保持原通用空态(搜索无结果 ≠ 目录未接入) */
  const emptyCard = catalogEmptyCard({
    remoteBrowser,
    signInHint,
    filtered: hasActiveFilter(query) || source !== "all" || downloadState !== "all",
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
      setDownloadNotice(format(copy.cardMenu.downloadQueuedHint, { count: outcome.accepted }));
      registerTaskIdentity(outcome.taskId, { title: copy.cardMenu.download, originPage: "warehouse", notifyOnComplete: true });
      setDownloadWatchBatch(outcome.batchId);
      setReloadKey((key) => key + 1);
    } catch {
      setDownloadNotice(copy.cardMenu.downloadFailedHint);
    }
  };

  /** 选区 → Recipe 引用(云端卡;本地条目不进选区模型) */
  const recipeRefsOfSelection = (): RecipeAssetRef[] =>
    (resultsView?.items ?? [])
      .filter((selected) => selectedIds.has(selected.productId))
      .map((selected) => ({
        identity: selected.productId,
        displayName: selected.title ?? selected.productId,
        source: "cloud" as const,
        variantName: selected.variantName,
        shopName: selected.shopName,
      }));

  /** 选区菜单(框选右键落点/多选右键):作用于整个选区 */
  const openSelectionMenu = (x: number, y: number) => {
    const refs = recipeRefsOfSelection();
    setCardMenu({
      x,
      y,
      items: [
        ...(refs.length > 0
          ? [{
              id: "addToRecipe",
              label: format(copy.selectBar.addToRecipe, { count: refs.length }),
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

  /** 素材卡右键菜单(S-XII):仅真实动作——查看详情/已购标记。
   *  sourceUrl 只在详情负载上,打开来源/复制链接归详情抽屉,卡片菜单不猜 URL。
   *  Explorer 约定(2026-10-05):右键在多选选区内 = 菜单作用于整组;
   *  在选区外 = 先选中该卡再出单项菜单 */
  const openCardMenu = (event: ReactMouseEvent<HTMLElement>, item: CatalogProductSummary) => {
    event.preventDefault();
    if (selectedIds.has(item.productId) && selectedIds.size > 1) {
      openSelectionMenu(event.clientX, event.clientY);
      return;
    }
    setSelectedIds(new Set([item.productId]));
    const menuItems: ContextMenuState["items"] = [
      { id: "open", label: copy.card.detailsCta, onSelect: () => setSelectedId(item.productId) },
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
        {
          id: "showCompatible",
          label: copy.cardMenu.showCompatible,
          onSelect: () => {
            setCompatibleQuery({ productId: item.productId, title: item.title ?? item.productId });
          },
        },
    ];
    const anchor = event.currentTarget.getBoundingClientRect();
    setCardMenu({ x: event.detail === 0 ? anchor.left : event.clientX, y: event.detail === 0 ? anchor.bottom : event.clientY, items: menuItems });
  };

  return (
    <div className="vua-page vua-warehouse">
      <section className="vua-page__hero">
        <h1 className="vua-title">{termLabel("warehouse")}</h1>
        {/* 选区动作位(Explorer 语义,2026-10-05):选区存在才出现;选区本身
            由单击/框选建立,无独立"选择模式"开关 */}
        {selectedIds.size > 0 ? (
          <button
            type="button"
            className="vua-warehouse__filter"
            onClick={() => {
              setContextSelection(recipeRefsOfSelection());
              setRecipeDialogOpen(true);
            }}
          >
            {format(copy.selectBar.addToRecipe, { count: selectedIds.size })}
          </button>
        ) : null}
        {/* 视图切换:卡片墙 / 纯文字列表;两态都保留商店名(用户裁决 2026-10-03) */}
        <button
          type="button"
          className="vua-warehouse__filter"
          aria-label={copy.viewToggleAria}
          title={viewMode === "cards" ? copy.viewList : copy.viewCards}
          onClick={() => setViewMode((mode) => (mode === "cards" ? "list" : "cards"))}
        >
          {viewMode === "cards" ? copy.viewList : copy.viewCards}
        </button>
        {/* 来源筛选(用户方向 2026-10-02):云端/本地合并为单库页,来源只作筛选 */}
        <select
          className="vua-warehouse__filter"
          aria-label={copy.filters.source}
          value={source}
          onChange={(event) => setSource(event.target.value as typeof source)}
        >
          <option value="all">{copy.filters.sourceAll}</option>
          <option value="bought">{copy.filters.sourceBought}</option>
          <option value="gifts">{copy.filters.sourceGifts}</option>
          <option value="free">{copy.filters.sourceFree}</option>
          <option value="local">{copy.filters.sourceLocal}</option>
        </select>
        {/* 下载状态筛选(人审 2026-10-06):静默下载自动采纳后,"已下载"
            = importedArtifacts > 0(与卡片"已导入"徽标同一事实);客户端
            过滤——列表数据已在手,该事实随快照到达 */}
        <select
          className="vua-warehouse__filter"
          aria-label={copy.filters.downloadState}
          value={downloadState}
          onChange={(event) => setDownloadState(event.target.value as typeof downloadState)}
        >
          <option value="all">{copy.filters.downloadAll}</option>
          <option value="downloaded">{copy.filters.downloaded}</option>
          <option value="not-downloaded">{copy.filters.notDownloaded}</option>
          <option value="missing">{copy.libraryState.missing}</option>
          <option value="in_progress">{copy.libraryState.downloading}</option>
          <option value="attention">{copy.libraryState.attention}</option>
        </select>
        <p className="vua-text-secondary">{copy.subtitle}</p>
        {/* 素材导入入口(2026-09-20 导航重构):原独立页(设计标准 §8.3)收敛为
            本页内弹窗——连续素材获取路径(云端内嵌浏览/已完成下载采纳/本地
            文件夹导入)仍在,只是不再占一个侧栏页位 */}
        <div className="vua-page__actions">
          <Button
            variant="primary"
            onClick={() => {
              setImportInitialUrl(null);
              setImportDialogOpen(true);
            }}
          >
            {strings.importPage.title}
          </Button>
          {source !== "local" && remoteBrowser ? (
            <Button variant="default" onClick={() => void startCatalogSync()}>
              {copy.catalogSync.action}
            </Button>
          ) : null}
          {syncNotice !== null ? (
            <span className="vua-caption vua-text-secondary" role="status">
              {syncNotice === "started"
                ? copy.catalogSync.startedHint
                : syncNotice === "already"
                  ? copy.catalogSync.alreadyRunning
                  : syncNotice === "blocked"
                    ? copy.catalogSync.signInRequired
                    : syncNotice === "done"
                      ? copy.catalogSync.completedHint
                      : syncNotice === "warning"
                        ? copy.catalogSync.warningHint
                        : syncNotice === "cancelled"
                          ? copy.catalogSync.cancelledHint
                          : syncNotice === "inspect"
                            ? copy.catalogSync.inspectHint
                            : syncNotice === "unconfirmed"
                              ? copy.catalogSync.unconfirmedHint
                      : copy.catalogSync.failedHint}
            </span>
          ) : null}
          {syncProgress !== null ? (
            <span className="vua-caption vua-text-secondary" role="status">
              {format(copy.catalogSync.progressHint, { pages: syncProgress.pages, count: syncProgress.upsertedCount, rejected: syncProgress.rejectedCount })}
            </span>
          ) : null}
          {syncReadFailed ? <span className="vua-caption vua-text-secondary" role="status">{copy.catalogSync.readFailedHint}</span> : null}
          {downloadNotice !== null ? (
            <span className="vua-caption vua-text-secondary" role="status">{downloadNotice}</span>
          ) : null}
        </div>
        {dataSource === "fixture" ? (
          <div>
            <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
          </div>
        ) : null}
      </section>

      {true ? (
        <>
          {!connected ||
      (listState.kind === "loaded" && listState.view.kind === "not-connected") ? (
        <EmptyState
          title={copy.states.notConnectedTitle}
          description={copy.states.notConnectedDescription}
        />
      ) : listState.kind === "loaded" && listState.view.kind === "error" ? (
        /* W17 透传呈现:服务端 application 错误按冻结码映射文案,不与断连混淆 */
        <EmptyState
          title={copy.states.loadFailedTitle}
          description={catalogErrorText(listState.view.messageKey)}
          action={
            <Button variant="default" onClick={() => setReloadKey((key) => key + 1)}>
              {copy.states.retry}
            </Button>
          }
        />
      ) : listState.kind === "failed" ? (
        <EmptyState
          title={copy.states.loadFailedTitle}
          description={copy.states.loadFailedDescription}
          action={
            <Button variant="default" onClick={() => setReloadKey((key) => key + 1)}>
              {copy.states.retry}
            </Button>
          }
        />
      ) : (
        <div className="vua-warehouse__content" data-drawer-open={selectedId !== null || undefined}>
          <div className="vua-warehouse__main">
            {/* 工具栏:词表随数据(vocabulary),不硬编码 */}
            <div className="vua-warehouse__toolbar" role="search">
              <input
                type="search"
                className="vua-warehouse__search"
                placeholder={copy.searchPlaceholder}
                aria-label={copy.searchAria}
                value={query.text}
                onChange={(event) =>
                  setQuery((prev) => ({ ...prev, text: event.target.value }))
                }
              />
              <select
                className="vua-warehouse__filter"
                aria-label={copy.filters.availability}
                value={query.availabilityStatus}
                onChange={(event) =>
                  setQuery((prev) => ({
                    ...prev,
                    availabilityStatus: event.target.value as CatalogAvailabilityStatus | "",
                  }))
                }
              >
                <option value="">{copy.filters.allAvailability}</option>
                {(resultsView?.vocabulary.availabilities ?? []).map((value) => (
                  <option key={value} value={value}>
                    {copy.availability[value]}
                  </option>
                ))}
              </select>
              <select
                className="vua-warehouse__filter"
                aria-label={copy.filters.entityType}
                value={query.entityType}
                onChange={(event) =>
                  setQuery((prev) => ({ ...prev, entityType: event.target.value }))
                }
              >
                <option value="">{copy.filters.allEntityTypes}</option>
                {(resultsView?.vocabulary.entityTypes ?? []).map((value) => (
                  <option key={value} value={value}>
                    {entityTypeLabel(value)}
                  </option>
                ))}
              </select>
              <select
                className="vua-warehouse__filter"
                aria-label={copy.filters.relationKind}
                value={query.relationKind}
                onChange={(event) =>
                  setQuery((prev) => ({
                    ...prev,
                    relationKind: event.target.value as CatalogRelationKind | "",
                  }))
                }
              >
                <option value="">{copy.filters.allRelationKinds}</option>
                {(resultsView?.vocabulary.relationKinds ?? []).map((value) => (
                  <option key={value} value={value}>
                    {copy.relationKind[value]}
                  </option>
                ))}
              </select>
              {resultsView !== null ? (
                <span className="vua-caption vua-text-secondary">
                  {hasActiveFilter(query)
                    ? format(copy.resultCount, {
                        shown: resultsView.items.length + localEntries.length,
                        total: resultsView.total,
                      })
                    : format(copy.resultCountAll, { total: resultsView.total })}
                </span>
              ) : null}
              {libraryPage !== null ? <div className="vua-library-pagination">
                <Button variant="subtle" disabled={pageOffset === 0} onClick={() => setPageOffset((offset) => Math.max(0, offset - 50))}>{copy.libraryState.previousPage}</Button>
                <span className="vua-caption">{format(copy.libraryState.page, { page: Math.floor(pageOffset / 50) + 1, total: Math.max(1, Math.ceil(libraryPage.total / 50)) })}</span>
                <Button variant="subtle" disabled={pageOffset + 50 >= libraryPage.total} onClick={() => setPageOffset((offset) => offset + 50)}>{copy.libraryState.nextPage}</Button>
              </div> : null}
            </div>

            {/* 滚动限定在本容器:工具栏/hero 不随图片墙滚动(用户反馈 #2) */}
            <div
              className="vua-warehouse__wall-scroll"
              ref={setWallEl}
              onPointerDown={onWallPointerDown}
              onClick={onWallClick}
              onContextMenu={onWallContextMenu}
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
                /* 目录空态(N5 S1):登录引导卡/同步引导卡/通用空态三态 */
                emptyCard.kind === "sign-in" ? (
                  <EmptyState
                    title={copy.catalogSync.signInTitle}
                    description={copy.catalogSync.signInDescription}
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
                    description={copy.catalogSync.syncDescription}
                    action={
                      <Button variant="primary" onClick={() => void startCatalogSync()}>
                        {copy.catalogSync.action}
                      </Button>
                    }
                  />
                ) : (
                  /* 搜索/筛选无结果 ≠ 目录未接入 */
                  <EmptyState
                    title={copy.states.emptyResultTitle}
                    description={copy.states.emptyResultDescription}
                  />
                )
              ) : resultsView !== null || localCards.length > 0 ? (
                <div
                  className={
                    viewMode === "cards"
                      ? "vua-warehouse__wall"
                      : "vua-warehouse__list"
                  }
                  role="list"
                >
                  {resultsView?.items
                      .map((item) =>
                        viewMode === "cards" ? (
                          <WarehouseCard
                            key={item.productId}
                            item={item}
                            facts={libraryPage?.facts.get(item.productId)}
                            selected={selectedIds.has(item.productId)}
                            onSelect={() => selectSingle(item.productId)}
                            onOpen={() => {
                              setSelectedLocalId(null);
                              setSelectedId(item.productId);
                            }}
                            onMenu={(event) => openCardMenu(event, item)}
                          />
                        ) : (
                          <WarehouseListRow
                            key={item.productId}
                            item={item}
                            facts={libraryPage?.facts.get(item.productId)}
                            selected={selectedIds.has(item.productId)}
                            onSelect={() => selectSingle(item.productId)}
                            onOpen={() => {
                              setSelectedLocalId(null);
                              setSelectedId(item.productId);
                            }}
                            onMenu={(event) => openCardMenu(event, item)}
                          />
                        )
                      )
                  }
                  {dataSource === "live" || source !== "gifts" && source !== "bought" && source !== "free"
                    ? localCards.map((card) => (
                        <div key={card.key}>
                        <LibraryBadges facts={libraryPage?.facts.get(card.entry.warehouseItemId)} />
                        <ArtifactCard
                          key={card.key}
                          card={card}
                          source={libraryPage?.facts.get(card.entry.warehouseItemId)?.sourceMatch?.product}
                          metadata={libraryPage?.facts.get(card.entry.warehouseItemId)?.metadata}
                          selected={selectedLocalId === card.entry.warehouseItemId}
                          onOpen={() => {
                            setSelectedId(null);
                            setSelectedLocalId(card.entry.warehouseItemId);
                          }}
                          onMenu={(event) => {
                            event.preventDefault();
                            const anchor = event.currentTarget.getBoundingClientRect();
                            setCardMenu({
                              x: event.detail === 0 ? anchor.left : event.clientX,
                              y: event.detail === 0 ? anchor.bottom : event.clientY,
                              items: [
                                {
                                  id: "open",
                                  label: copy.card.detailsCta,
                                  onSelect: () => {
                                    setSelectedId(null);
                                    setSelectedLocalId(card.entry.warehouseItemId);
                                  },
                                },
                                {
                                  id: "addToDraft",
                                  label: copy.recipeDialog.title,
                                  onSelect: () => {
                                    setContextSelection([{
                                      identity: card.artifact.artifactSha256,
                                      displayName: `${card.entry.displayName} / ${card.artifact.relativePath}`,
                                      source: "local",
                                      warehouseItemId: card.entry.warehouseItemId,
                                    }]);
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
                          }}
                        /></div>
                      ))
                    : null}
                </div>
              ) : null}
            </div>
          </div>

          {selectedId !== null ? (
            <aside
              className="vua-warehouse__drawer"
              aria-label={copy.detail.panelAria}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSelectedId(null);
              }}
            >
              <div className="vua-warehouse__drawer-header">
                {detailState.kind === "loaded" && detailState.view.kind === "detail" ? (
                  <h2
                    className="vua-warehouse-detail__title"
                    title={detailState.view.product.title ?? detailState.view.product.productId}
                  >
                    {detailState.view.product.title ?? detailState.view.product.productId}
                  </h2>
                ) : (
                  <Skeleton width="70%" height={18} />
                )}
                <Button
                  variant="subtle"
                  aria-label={copy.detail.closeAria}
                  onClick={() => setSelectedId(null)}
                >
                  {copy.detail.close}
                </Button>
              </div>
              {detailState.kind === "loading" ? (
                <div className="vua-warehouse-detail__content">
                  <Skeleton width="100%" height="auto" className="vua-warehouse-card__skeleton-media" />
                  <Skeleton width="50%" height={14} />
                  <Skeleton width="100%" height={60} />
                </div>
              ) : detailState.kind === "failed" ? (
                <div className="vua-warehouse-detail__content">
                  <p className="vua-text-secondary">{copy.detail.loadFailed}</p>
                  <div>
                    <Button
                      variant="default"
                      onClick={() => setDetailReloadKey((key) => key + 1)}
                    >
                      {copy.detail.retry}
                    </Button>
                  </div>
                </div>
              ) : detailState.view.kind === "detail" ? (
                /* key=productId:切换商品时重置组件内状态(如来源跳转失败标记) */
                <><div className="vua-warehouse-detail__content">
                  <LibraryBadges facts={libraryPage?.facts.get(selectedId)} />
                  <p className="vua-caption vua-text-secondary">{copy.libraryState.productionUnchecked}</p>
                  <Button variant="default" onClick={() => setChecklistProduct({ productId: selectedId, title: detailState.view.kind === "detail" ? detailState.view.product.title ?? selectedId : selectedId })}>{copy.libraryState.manageFiles}</Button>
                </div><DetailContent
                  key={detailState.view.product.productId}
                  product={detailState.view.product}
                  onEnriched={() => setDetailReloadKey((key) => key + 1)}
                /></>
              ) : detailState.view.kind === "error" ? (
                /* W17 透传呈现:application 错误文案 + 重试;与 not-found/断连区分 */
                <div className="vua-warehouse-detail__content">
                  <p className="vua-text-secondary">{catalogErrorText(detailState.view.messageKey)}</p>
                  <div>
                    <Button
                      variant="default"
                      onClick={() => setDetailReloadKey((key) => key + 1)}
                    >
                      {copy.detail.retry}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="vua-warehouse-detail__content">
                  <p className="vua-text-secondary">{copy.detail.notFound}</p>
                </div>
              )}
            </aside>
          ) : null}
        </div>
        )}

        {selectedLocalEntry !== null ? (
          <aside
            className="vua-warehouse__drawer"
            aria-label={copy.detail.panelAria}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSelectedLocalId(null);
            }}
          >
            <div className="vua-warehouse__drawer-header">
              <h2 className="vua-warehouse-detail__title" title={selectedLocalEntry.displayName}>
                {selectedLocalEntry.displayName}
              </h2>
              <Button
                variant="subtle"
                aria-label={copy.detail.closeAria}
                onClick={() => setSelectedLocalId(null)}
              >
                {copy.detail.close}
              </Button>
            </div>
            <EntryDetail
              key={selectedLocalEntry.warehouseItemId}
              entryId={selectedLocalEntry.warehouseItemId}
              globalDefault={inferGlobalDefaultMode(localEntries)}
            />
          </aside>
        ) : null}
        </>
      ) : null}
      {/* 素材直产链发起位(029 A6/未决项 1 桌面落形,用户裁决 2026-09-22 操作者
          第 162 批):原寄宿车间页,现落位本页动作位——素材直产链的语义起点是
          素材(pickMaterial),与连续素材获取路径(§8.3)同页承接;v0.1 用例面
          与组件行为零改动。production capability 未就绪时整段诚实隐藏(live
          默认不可用,由宿主 hidden 态保证),不占视觉位 */}
      <ProductionFlowSectionHost onNavigate={onNavigate} />
      {cardMenu !== null ? (
        <ContextMenu menu={cardMenu} onClose={() => setCardMenu(null)} />
      ) : null}
      <ContentDialog
        open={importDialogOpen}
        title={strings.importPage.title}
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
      <AddToRecipeDialog
        open={recipeDialogOpen}
        onClose={() => setRecipeDialogOpen(false)}
        selections={contextSelection}
      />
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
      <CompatibleItemsDialog
        query={compatibleQuery}
        onClose={() => setCompatibleQuery(null)}
        onSelectProduct={(productId) => {
          setCompatibleQuery(null);
          setSelectedId(productId);
        }}
      />
    </div>
  );
}

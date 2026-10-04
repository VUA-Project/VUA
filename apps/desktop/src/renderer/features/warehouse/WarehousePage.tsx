import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
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
import {
  lifecycleOf,
  loadLifecycle,
  saveLifecycle,
  setPurchaseMark,
  type StoredLifecycleV1,
} from "./asset-lifecycle.ts";
import { useDebugMode } from "../../app/debug-mode.ts";
import { useCardSpotlight } from "./use-card-spotlight.ts";
import type { RecipeAssetRef } from "../../gateway/recipe-port.ts";
import { AddToRecipeDialog } from "./AddToRecipeDialog.tsx";
import { CompatibleItemsDialog } from "./CompatibleItemsDialog.tsx";
import { registerTaskIdentity } from "../../gateway/task-identity.ts";
import { CardAlbumMedia, DetailAlbum } from "./WarehouseAlbum.tsx";
import { ArtifactCard, EntryDetail } from "./WarehouseAcquire.tsx";
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

function WarehouseListRow({
  item,
  selected,
  onOpen,
}: {
  item: CatalogProductSummary;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      className="vua-warehouse-list-row"
      data-selected={selected || undefined}
      role="listitem"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
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
      {item.importedArtifacts > 0 ? (
        <span className="vua-caption">{copy.importedBadge}</span>
      ) : null}
    </div>
  );
}

function WarehouseCard({
  item,
  purchased,
  selected,
  onOpen,
  onMenu,
}: {
  item: CatalogProductSummary;
  purchased: boolean;
  selected: boolean;
  onOpen: () => void;
  /** 素材卡右键菜单(S-XII):由页面组装真实动作项 */
  onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <article
      className="vua-warehouse-card"
      data-selected={selected || undefined}
      onClick={onOpen}
      onContextMenu={onMenu}
      // 卡片本体即"查看详情"入口(浮层已随相册交互移除):键盘可达,
      // Enter/Space 打开详情(用户反馈 #5;购买标记由其他功能模块承担)
      role="listitem"
      tabIndex={0}
      onKeyDown={(event) => {
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
          {item.availability !== "available" ? (
            <Badge tone="neutral">{copy.availability[item.availability]}</Badge>
          ) : null}
          {/* 徽标只渲染非 unknown 事实:purchase 唯一来源是用户标记 */}
          {purchased ? <Badge tone="success">{copy.card.purchasedBadge}</Badge> : null}
        {item.importedArtifacts > 0 ? (
          <Badge tone="neutral">{copy.importedBadge}</Badge>
        ) : null}
        </div>
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
        <Badge tone="neutral">{copy.availability[product.availability]}</Badge>
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
                  {subproduct.name ?? subproduct.variationId ?? copy.detail.subproductUnnamed}
                </span>
                <span className="vua-caption vua-text-secondary">{priceText(subproduct)}</span>
                {subproduct.availability !== "available" ? (
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
  // 多选模式(用户裁决 2026-10-04):卡片墙选材 → 加入 Recipe
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [contextSelection, setContextSelection] = useState<readonly RecipeAssetRef[]>([]);
  // 适配依赖小窗(N5):query 即打开意图,null = 关闭
  const [compatibleQuery, setCompatibleQuery] = useState<{
    productId: string;
    title: string;
  } | null>(null);
  // 按商品删除受理回执(诚实短提示;各条目任务进度在通知中心呈现)
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };
  const [source, setSource] = useState<
    "all" | "bought" | "gifts" | "free" | "local"
  >("all");

  const [query, setQuery] = useState<WarehouseQueryState>(emptyWarehouseQuery);
  const [listState, setListState] = useState<ListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState>({ kind: "loading" });
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [lifecycle, setLifecycle] = useState<StoredLifecycleV1>(loadLifecycle);
  /** 素材卡右键菜单(S-XII):null 即关闭;动作全部映射真实能力 */
  const [cardMenu, setCardMenu] = useState<ContextMenuState | null>(null);
  // 素材导入弹窗(2026-09-20 导航重构):原独立页收敛为仓储页内弹窗,
  // 弹窗关闭即卸载 ImportPage——其「卸载即在途关闭内嵌视图」生命周期语义原样生效
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  /** 账号库同步(N5 S1):登录线索只读探测 + 触发反馈;进度与终态走九态
   * 任务面(通知中心),本页只回触发结果,不伪造运行过程 */
  const remoteBrowser = window.vua?.capabilities?.remoteBrowser === true;
  const [signInHint, setSignInHint] = useState<"stored" | "none" | "unknown" | null>(null);
  const [syncNotice, setSyncNotice] = useState<
    "started" | "already" | "blocked" | "done" | "failed" | null
  >(null);
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
  const startCatalogSync = async (): Promise<void> => {
    const catalogSync = window.vua?.catalogSync;
    if (catalogSync === undefined) return;
    const libraryType =
      source === "gifts" ? "gifts" : source === "free" ? "free_downloads" : "bought";
    // 显式携带类型(含 bought):wire 请求不带 libraryType 会让观察 upsert
    // 把该列覆盖为 NULL(真机 2026-10-03:14 条已购行被清空的根因)
    const outcome = await catalogSync.start({ libraryType });
    if (outcome.status === "blocked") {
      // 登录引导:空态卡翻为登录形态(主进程门控已确认无账户 Cookie);
      // 同时给可见反馈——用户动作无可见响应等同于坏(设计标准反馈纪律)
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
    }
  };

  // 同步运行终态轮询(N5 S1):到终态后刷新目录并把提示行翻到完成/失败
  // ——终态任务按通知中心纪律默认不再显示,完成反馈必须发生在用户正看
  // 着的地方(按钮旁),页面同时刷新让卡片立即可见
  const gateway = useGateway();
  // 统一卡片墙数据源:本地条目(经 acquire 快照,与云端卡同一墙渲染)
  const acquireView = useAcquireView();
  const localEntries = acquireView !== null && acquireView.kind === "entries" ? acquireView.entries : [];
  const localCards = artifactCards(localEntries).filter((card) =>
    artifactCardMatches(card, query.text.trim()),
  );
  const selectedLocalEntry =
    selectedLocalId === null
      ? null
      : (localEntries.find((entry) => entry.warehouseItemId === selectedLocalId) ?? null);
  useEffect(() => {
    if (syncNotice !== "started" || syncRunId === null) return;
    let active = true;
    const timer = window.setInterval(() => {
      void gateway.task
        .snapshot()
        .then((view) => {
          if (!active) return;
          const run = view.tasks.find((task) => task.id === syncRunId);
          if (run === undefined) return;
          if (run.status === "completed" || run.status === "completedWithWarnings") {
            setSyncNotice("done");
            setSyncRunId(null);
            setReloadKey((key) => key + 1);
          } else if (run.status === "failed" || run.status === "cancelled") {
            setSyncNotice("failed");
            setSyncRunId(null);
            setReloadKey((key) => key + 1);
          }
        })
        .catch(() => {});
    }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [syncNotice, syncRunId, gateway]);

  // Esc 清空多选(用户裁决 ①:加入后选区保留,Esc 清空)
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectMode]);

  // 指针聚光 + 微倾斜:回调 ref 追踪 wall-scroll 元素(视图切换会重建它),
  // hook 内部按场景模式决定是否挂载监听(非 animated 模式零开销)
  const [wallEl, setWallEl] = useState<HTMLDivElement | null>(null);
  useCardSpotlight(wallEl);

  // 列表查询:筛选变更保留旧结果(stale-while-revalidate),骨架屏只留给首次加载
  useEffect(() => {
    if (!connected) return;
    let active = true;
    setListState((prev) => (prev.kind === "loaded" ? prev : { kind: "loading" }));
    catalogBrowser
      .list(
        source === "bought" || source === "gifts" || source === "free"
          ? { ...toPortQuery(query), libraryType: source === "free" ? "free_downloads" : source }
          : toPortQuery(query),
      )
      .then(
      (view) => {
        if (active) setListState({ kind: "loaded", view });
      },
      () => {
        if (active) setListState({ kind: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [query, connected, reloadKey, source]);

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
    filtered: hasActiveFilter(query),
    catalogEmpty: resultsView !== null && resultsView.items.length === 0,
  });

  /** 素材卡右键菜单(S-XII):仅真实动作——查看详情/已购标记。
   *  sourceUrl 只在详情负载上,打开来源/复制链接归详情抽屉,卡片菜单不猜 URL */
  const openCardMenu = (event: ReactMouseEvent<HTMLElement>, item: CatalogProductSummary) => {
    event.preventDefault();
    const marked = lifecycleOf(lifecycle, item.productId).purchase === "user_confirmed";
    const menuItems: ContextMenuState["items"] = [
      { id: "open", label: copy.card.detailsCta, onSelect: () => setSelectedId(item.productId) },
        {
          id: "download",
          label: copy.cardMenu.download,
          onSelect: () => {
            void window.vua?.catalogSync?.downloadProduct(item.productId);
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
        ...(item.importedArtifacts > 0
          ? [{
              id: "deleteLocal",
              label: copy.cardMenu.deleteLocal,
              onSelect: () => {
                if (!window.confirm(copy.cardMenu.deleteConfirm)) return;
                void gateway.warehouseCommands
                  .deleteOriginalsByProduct(item.productId)
                  .then((outcome) => {
                    setDeleteNotice(
                      outcome.ok && "deleted" in outcome
                        ? format(copy.cardMenu.deleteSubmittedHint, { count: outcome.deleted.deletedItemCount })
                        : copy.cardMenu.deleteFailedHint,
                    );
                  })
                  .catch(() => setDeleteNotice(copy.cardMenu.deleteFailedHint));
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
      {
        id: "togglePurchased",
        label: marked ? copy.card.unmarkPurchased : copy.card.markPurchased,
        onSelect: () =>
          setLifecycle((prev) => {
            const next = setPurchaseMark(prev, item.productId, !marked);
            saveLifecycle(next);
            return next;
          }),
      },
    ];
    setCardMenu({ x: event.clientX, y: event.clientY, items: menuItems });
  };

  return (
    <div className="vua-page vua-warehouse">
      <section className="vua-page__hero">
        <h1 className="vua-title">{termLabel("warehouse")}</h1>
        {/* 多选模式入口(用户裁决 2026-10-04):启用后卡片可多选加入 Recipe */}
        <button
          type="button"
          className="vua-warehouse__filter"
          aria-pressed={selectMode}
          onClick={() => {
            if (selectMode) clearSelection();
            else setSelectMode(true);
          }}
        >
          {selectMode
            ? format(copy.selectBar.cancel, { count: selectedIds.size })
            : copy.selectBar.enter}
        </button>
        {selectMode && selectedIds.size > 0 ? (
          <button
            type="button"
            className="vua-warehouse__filter"
            onClick={() => setRecipeDialogOpen(true)}
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
        <p className="vua-text-secondary">{copy.subtitle}</p>
        {/* 素材导入入口(2026-09-20 导航重构):原独立页(设计标准 §8.3)收敛为
            本页内弹窗——连续素材获取路径(云端内嵌浏览/已完成下载采纳/本地
            文件夹导入)仍在,只是不再占一个侧栏页位 */}
        <div className="vua-page__actions">
          <Button variant="primary" onClick={() => setImportDialogOpen(true)}>
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
                      : copy.catalogSync.failedHint}
            </span>
          ) : null}
          {deleteNotice !== null ? (
            <span className="vua-caption vua-text-secondary" role="status">{deleteNotice}</span>
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
                        shown: resultsView.items.length,
                        total: resultsView.total,
                      })
                    : format(copy.resultCountAll, { total: resultsView.total })}
                </span>
              ) : null}
            </div>

            {/* 滚动限定在本容器:工具栏/hero 不随图片墙滚动(用户反馈 #2) */}
            <div className="vua-warehouse__wall-scroll" ref={setWallEl}>
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
              ) : resultsView !== null && resultsView.items.length === 0 ? (
                /* 目录空态(N5 S1):登录引导卡/同步引导卡/通用空态三态 */
                emptyCard.kind === "sign-in" ? (
                  <EmptyState
                    title={copy.catalogSync.signInTitle}
                    description={copy.catalogSync.signInDescription}
                    action={
                      <Button
                        variant="default"
                        onClick={() =>
                          void window.vua?.remoteContent?.open({ url: BOOTH_SIGN_IN_URL })
                        }
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
                  {source !== "local"
                    ? resultsView?.items.map((item) =>
                        viewMode === "cards" ? (
                          <WarehouseCard
                            key={item.productId}
                            item={item}
                            purchased={lifecycleOf(lifecycle, item.productId).purchase === "user_confirmed"}
                            selected={selectMode ? selectedIds.has(item.productId) : selectedId === item.productId}
                            onOpen={() => {
                              if (selectMode) {
                                toggleSelect(item.productId);
                                return;
                              }
                              setSelectedLocalId(null);
                              setSelectedId(item.productId);
                            }}
                            onMenu={(event) => openCardMenu(event, item)}
                          />
                        ) : (
                          <WarehouseListRow
                            key={item.productId}
                            item={item}
                            selected={selectedId === item.productId}
                            onOpen={() => {
                              setSelectedLocalId(null);
                              setSelectedId(item.productId);
                            }}
                          />
                        )
                    )
                    : null}
                  {source !== "gifts" && source !== "bought" && source !== "free"
                    ? localCards.map((card) => (
                        <ArtifactCard
                          key={card.key}
                          card={card}
                          selected={selectedLocalId === card.entry.warehouseItemId}
                          onOpen={() => {
                            setSelectedId(null);
                            setSelectedLocalId(card.entry.warehouseItemId);
                          }}
                          onMenu={(event) => {
                            event.preventDefault();
                            setCardMenu({
                              x: event.clientX,
                              y: event.clientY,
                              items: [
                                {
                                  id: "open",
                                  label: copy.card.detailsCta,
                                  onSelect: () => {
                                    setSelectedId(null);
                                    setSelectedLocalId(card.entry.warehouseItemId);
                                  },
                                },
                              ],
                            });
                          }}
                        />
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
                <DetailContent
                  key={detailState.view.product.productId}
                  product={detailState.view.product}
                  onEnriched={() => setDetailReloadKey((key) => key + 1)}
                />
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
        onClose={() => setImportDialogOpen(false)}
      >
        {/* onRequestClose(W25 走查缺陷③根因修复):受理态自动关闭与失败态
            醒目「关闭」按钮的关闭请求线——受理后 ~1.5s 弹窗自动收口,任务
            进度归任务中心;模态滞留被用户视作整屏卡死的行为终止。 */}
        <ImportPage onRequestClose={() => setImportDialogOpen(false)} />
      </ContentDialog>
      <AddToRecipeDialog
        open={recipeDialogOpen}
        onClose={() => setRecipeDialogOpen(false)}
        selections={contextSelection}
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

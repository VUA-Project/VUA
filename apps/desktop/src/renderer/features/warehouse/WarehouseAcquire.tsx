import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { LibraryEntryMetadataV01 } from "@vua/contracts";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { shownVariant } from "./library-view-model.ts";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import {
  ContextMenu,
  type ContextMenuState,
} from "../../components/primitives/ContextMenu.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import {
  readEntryPreview,
  registerTaskIdentity,
  useAcquireView,
  useGateway,
  type AcquireEntryDetailView,
  type EntryPreviewView,
  type WarehouseArtifact,
  type WarehouseArtifactMode,
  type WarehouseArtifactState,
  type WarehouseCommandOutcome,
  type WarehouseEntryDetail,
  type CatalogProductSummary,
  type LibraryCardFacts,
} from "../../gateway/index.ts";
import { format, formatDateTime, strings, termLabel } from "../../i18n/index.ts";
import {
  artifactCardMatches,
  artifactCards,
  commandErrorText,
  entryActions,
  entryModeLine,
  entrySurfacesVisible,
  inferGlobalDefaultMode,
  sizeText,
  type AcquireArtifactCard,
  type AcquireEntryCard,
  type GlobalDefaultInference,
} from "./acquire-model.ts";
import { useCardSpotlight } from "./use-card-spotlight.ts";
import { DetailAlbum } from "./WarehouseAlbum.tsx";
import { LibraryDetailLayout, LibraryDetailLoading, sharedFacts } from "./LibraryDetail.tsx";
import { ProductTerms } from "./ProductTerms.tsx";
import { GlbInspectionSection } from "./GlbInspectionSection.tsx";
import { confirmedLibraryProductId } from "../../gateway/index.ts";
import { libraryViewCopy } from "../../i18n/library-view-copy.ts";
import { Icon } from "@vua/design-system";

const copy = strings.warehouse.acquire;
const cloudCopy = strings.warehouse;

/** Files remain in EntryDetail, including empty or missing imports. */
export function MaterialEntryCard({ card, selected, onSelect, onOpen, onMenu, source, metadata, corner, badges, fact }: {
  card: AcquireEntryCard; selected: boolean; onSelect: (event: ReactMouseEvent<HTMLElement>) => void; onOpen: () => void; onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  source?: CatalogProductSummary | undefined; metadata?: LibraryEntryMetadataV01 | undefined; corner?: ReactNode; badges?: ReactNode; fact?: string | null | undefined;
}) {
  const entry = card.entry; const title = metadata?.displayName ?? source?.title ?? entry.displayName;
  const image = metadata?.thumbnailRef ?? source?.imageUrl;
  const size = sizeText(entry.artifacts.reduce((sum, file) => sum + file.sizeBytes, 0));
  return <article className="vua-warehouse-card" role="listitem" tabIndex={0} data-selection-id={card.key} data-selected={selected || undefined}
    onClick={onSelect} onDoubleClick={onOpen} onContextMenu={onMenu} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } }}>
    <div className="vua-warehouse-card__media">{corner}{image ? <img src={image} alt={title} loading="lazy" /> : <div className="vua-warehouse-card__no-image"><span className="vua-caption vua-text-secondary">{copy.previewEmpty}</span></div>}
      <Button className="vua-warehouse-card__menu" variant="subtle" aria-label={cloudCopy.removeFiles.actions} aria-haspopup="menu" onClick={event => { event.stopPropagation(); onMenu(event); }}><Icon name="more" size={16} /></Button>
      <div className="vua-warehouse-card__badges">{badges}</div>
      {fact ? <span className="vua-warehouse-card__fact">{fact}</span> : null}
    </div>
    <div className="vua-warehouse-card__body">
      <p className="vua-warehouse-card__title" title={title}>{title}</p>
      <p className="vua-caption vua-text-secondary vua-warehouse-card__shop" title={source?.shopName ?? undefined}>{source?.shopName ?? copy.kind[entry.kind]}</p>
      <p className="vua-warehouse-card__variant">{shownVariant(title, source?.variantName) ?? `${format(copy.fileCount, { count: entry.artifacts.length })} · ${format(copy[size.unitKey], { amount: size.amount })}`}</p>
    </div>
  </article>;
}

/**
 * Warehouse 本地轨图册(C-ACQUIRE,F4-6 条目模型):
 * - 数据来源:仓库素材包条目(WarehouseEntry × WarehouseArtifact);先检查
 *   再使用,检出可执行内容即隔离(红色左边线),绝不提供任何"运行"入口;
 * - 卡片墙/详情抽屉复用云端浏览的组件与色彩纪律(徽标中性灰,橙仅选中描边):
 *   卡片 = 条目 × 工件展开,带状态与副本角色徽标;列表卡面无关联身份
 *   (warehouseArtifactRef,裁决边界),媒体区渲染诚实空槽,不伪造缩略图;
 * - 详情抽屉 = 条目详情(entryDetail 读取面):模式行(覆盖 or 跟随全局,
 *   F4-9 的编辑展示位)+ 工件清单;quarantined 的诚实拒绝理由在此呈现;
 *   预览区 = D-6 目录来源组合读(mappedProductIds → catalog.detail,核心
 *   裁决方案 c),无关联/关联无图按 AC-12 同规诚实空态;
 * - 搜索为显示名/文件夹名/相对路径客户端过滤(fixture 规模);真实实现
 *   移交端口查询时 UI 不重写。
 */

function artifactSize(artifact: WarehouseArtifact): string {
  const size = sizeText(artifact.sizeBytes);
  return format(copy[size.unitKey], { amount: size.amount });
}

function stateTone(state: WarehouseArtifactState) {
  // 色彩纪律(§6.1):隔离是安全异常,用红;待检查中性;未见可执行内容用 success
  switch (state) {
    case "quarantined":
      return "error" as const;
    case "clean":
      return "success" as const;
    default:
      return "neutral" as const;
  }
}

/* ---- 条目详情抽屉(entryDetail 读取面) ---- */

type DetailState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "loaded"; view: AcquireEntryDetailView };

type ModeDraft = "follow" | WarehouseArtifactMode;

/** D-6 预览面:条目事实到达前的 loading 与组合读完成后的三态视图 */
type PreviewState =
  | { kind: "loading" }
  | { kind: "done"; view: EntryPreviewView };

/* 走查 3c 裁决(2026-09-07)+演进(2026-09-09):模式编辑与生成动作的入口
 * 可见性=条目事实镜像(生效模式与工件条件),并受「生成 VPM 包替代」全局
 * 开关呈现总闸门控(U8⑤ 分支 a 呈现层屏蔽:总闸关=无产物模式编辑、无条目
 * 动作;W14 词表零变更,服务端守卫不变)。「删除原始素材」手动入口按用户
 * 裁定移除(删除只由导入链按偏好触发;协议动作保留供自动链消费);入口挂
 * 实验性标注;全局行为由设置页「生成 VPM 替代」开关写已冻结的
 * warehouse.setGlobalDefaultMode(v0.2 全局层)。命令错误文案映射为与设置页
 * 共用的 acquire-model 纯函数。 */

function commandErrorTextFor(error: {
  kind: "unavailable" | "request_rejected" | "application";
  code?: string;
}): string {
  return commandErrorText(error, copy.commandErrors as Record<string, string>);
}

export function EntryDetail({
  entryId,
  globalDefault,
  facts,
  title,
  badges,
  actions,
  onTermsUpdated,
}: {
  entryId: string;
  globalDefault: GlobalDefaultInference;
  facts?: LibraryCardFacts | undefined;
  title: string;
  badges?: ReactNode;
  actions?: ReactNode;
  onTermsUpdated?: () => void;
}) {
  const gateway = useGateway();
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [modeDraft, setModeDraft] = useState<ModeDraft>("follow");
  const [preview, setPreview] = useState<PreviewState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    gateway.acquire.entryDetail(entryId).then(
      (view) => {
        if (active) setState({ kind: "loaded", view });
      },
      () => {
        if (active) setState({ kind: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [gateway, entryId, reloadKey]);

  // Artifact facts remain independent of the library's current source association.
  const loadedEntry: WarehouseEntryDetail | null =
    state.kind === "loaded" && state.view.kind === "detail" ? state.view.entry : null;

  // 重载/切换条目后草稿跟随服务端事实(覆盖值;null = 跟随全局)
  useEffect(() => {
    if (loadedEntry !== null) setModeDraft(loadedEntry.artifactMode ?? "follow");
  }, [loadedEntry]);

  // Refresh media when either artifact facts or the saved source association changes.
  // Individual catalog failures are represented by readEntryPreview's empty states.
  useEffect(() => {
    if (loadedEntry === null) {
      setPreview({ kind: "loading" });
      return;
    }
    let active = true;
    setPreview({ kind: "loading" });
    void readEntryPreview(catalogBrowser, loadedEntry, facts).then((view) => {
      if (active) setPreview({ kind: "done", view });
    });
    return () => {
      active = false;
    };
  }, [loadedEntry, facts]);

  async function runCommand(run: () => Promise<WarehouseCommandOutcome>): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const outcome = await run();
    setBusy(false);
    if (outcome.ok) {
      setFeedback(copy.acceptedNote);
      setReloadKey((key) => key + 1);
    } else {
      setFeedback(commandErrorTextFor(outcome.error));
    }
  }

  if (state.kind === "loading") return <LibraryDetailLoading title={title} />;
  if (state.kind === "failed" || state.view.kind === "not-connected") {
    return (
      <LibraryDetailLayout itemKey="failed" title={title} media={<DetailAlbum imageUrls={[]} title={title} />}>
        <p className="vua-text-secondary">{copy.detailLoadFailed}</p>
        <div>
          <Button variant="default" onClick={() => setReloadKey((key) => key + 1)}>
            {cloudCopy.detail.retry}
          </Button>
        </div>
      </LibraryDetailLayout>
    );
  }
  if (state.view.kind === "not-found") {
    return (
      <LibraryDetailLayout itemKey="missing" title={title} media={<DetailAlbum imageUrls={[]} title={title} />}>
        <p className="vua-text-secondary">{copy.detailNotFound}</p>
      </LibraryDetailLayout>
    );
  }

  const entry = state.view.entry;
  const mode = entryModeLine(entry);
  const previewAlbums = preview.kind === "done" && preview.view.kind === "loaded"
    ? preview.view.albums
    : null;
  const multipleSources = previewAlbums !== null && previewAlbums.length > 1;
  const surfaces = entrySurfacesVisible(globalDefault);
  const source = facts?.sourceMatch?.product;
  const productId = confirmedLibraryProductId(facts);
  const media = preview.kind === "loading" ? <Skeleton width="100%" height="auto" className="vua-warehouse-card__skeleton-media" />
    : previewAlbums === null ? <DetailAlbum imageUrls={[]} title={title} emptyText={preview.view.kind === "no-association" ? copy.previewNoAssociation : copy.previewNoImages} />
    : previewAlbums.map(album => <div key={album.productId}>
      {multipleSources ? <p className="vua-caption vua-text-secondary">{album.title}</p> : null}
      <DetailAlbum imageUrls={album.imageUrls} title={album.title} />
    </div>);
  return (
    <LibraryDetailLayout itemKey={entry.warehouseItemId} title={title} media={media} actions={actions}
      meta={[source?.shopName, shownVariant(title, source?.variantName)].filter(Boolean).join(" · ") || null}
      facts={[[libraryViewCopy.detail.source, entry.kind === "imported_material" ? libraryViewCopy.detail.sources.imported : copy.kind[entry.kind]], ...sharedFacts(facts).filter(([name]) => name !== libraryViewCopy.detail.source), [libraryViewCopy.detail.imported, facts?.addedAt ? formatDateTime(facts.addedAt) : null]]}
      badges={<>
        {badges}
        {surfaces ? <><Badge tone="neutral">{copy.mode[mode.effective]}</Badge><Badge tone="neutral">{mode.overridden ? copy.modeOverride : copy.modeFollowGlobal}</Badge></> : null}
      </>}>
      {productId !== null ? <ProductTerms productId={productId} title={title} {...(onTermsUpdated ? { onUpdated: onTermsUpdated } : {})} /> : null}
      <GlbInspectionSection target={{ entryId: entry.warehouseItemId }} revision={reloadKey} />
      <section className="vua-warehouse-detail__section">
        <h3>{libraryViewCopy.detail.files}</h3>
        <ul className="vua-warehouse-detail__files">{entry.artifacts.map(artifact => <li key={artifact.artifactSha256 + artifact.relativePath} data-state={artifact.state}>
          <Icon name="file" size={16} /><span title={artifact.relativePath}>{artifact.relativePath}</span>
          <small>{artifactSize(artifact)}</small>
          {artifact.state !== "clean" ? <Badge tone={stateTone(artifact.state)}>{copy.verdict[artifact.state]}</Badge> : null}
          {artifact.role !== "original" ? <Badge tone="neutral">{copy.role[artifact.role]}</Badge> : null}
        </li>)}</ul>
      </section>

      {/* F4-9 产物模式编辑(U8⑤ 总闸门控:总闸关=整组不呈现,分支 a 呈现层;
          跟随全局 = 清除覆盖(写 null),生效模式以服务端读回为准) */}
      {entrySurfacesVisible(globalDefault) ? (
        <section className="vua-warehouse-detail__section">
          <h3>
            {copy.modeEditTitle} <Badge tone="neutral">{strings.settings.experimental.badge}</Badge>
          </h3>
          <div role="radiogroup" aria-label={copy.modeEditTitle}>
            <label>
              <input
                type="radio"
                name={`mode-${entry.warehouseItemId}`}
                checked={modeDraft === "follow"}
                onChange={() => setModeDraft("follow")}
              />{" "}
              {copy.modeFollowGlobalOption}
            </label>{" "}
            <label>
              <input
                type="radio"
                name={`mode-${entry.warehouseItemId}`}
                checked={modeDraft === "use_original_unitypackage"}
                onChange={() => setModeDraft("use_original_unitypackage")}
              />{" "}
              {copy.mode.use_original_unitypackage}
            </label>{" "}
            <label>
              <input
                type="radio"
                name={`mode-${entry.warehouseItemId}`}
                checked={modeDraft === "generate_vpm"}
                onChange={() => setModeDraft("generate_vpm")}
              />{" "}
              {copy.mode.generate_vpm}
            </label>
          </div>
          <Button
            variant="subtle"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFeedback(null);
              void gateway.warehouseCommands
                .setArtifactMode(entry.warehouseItemId, modeDraft === "follow" ? null : modeDraft)
                .then((outcome) => {
                  setBusy(false);
                  if (outcome.ok) {
                    setReloadKey((key) => key + 1);
                  } else {
                    setFeedback(commandErrorTextFor(outcome.error));
                  }
                });
            }}
          >
            {busy ? copy.modeApplying : copy.modeApply}
          </Button>
        </section>
      ) : null}

      {/* 条目动作(U8⑤ 总闸门控;可见性镜像服务端守卫)。「删除原始素材」
          手动入口已按用户裁定移除——删除只由导入链按「生成后删除原始素材
          文件」偏好触发(app 层 delete-originals-auto),协议动作保留 */}
      {entryActions(entry, globalDefault).length > 0 ? (
        <section className="vua-warehouse-detail__section">
          <h3>
            {copy.actionsTitle} <Badge tone="neutral">{strings.settings.experimental.badge}</Badge>
          </h3>
          {entryActions(entry, globalDefault).includes("generateVpm") ? (
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFeedback(null);
                void gateway.warehouseCommands
                  .generateVpm(entry.warehouseItemId)
                  .then((outcome) => {
                    setBusy(false);
                    if (outcome.ok && "accepted" in outcome) {
                      // 受理即登记任务身份(W25 走查 D1):通知中心标题绑定
                      // 操作条目实体(走查 3a 先例:实体名 verbatim),来源页
                      // 回仓库页
                      registerTaskIdentity(outcome.accepted.taskId, {
                        title: format(strings.taskTitles.generateVpm, { name: entry.displayName }),
                        originPage: "warehouse",
                      });
                      setFeedback(copy.acceptedNote);
                      setReloadKey((key) => key + 1);
                    } else if (!outcome.ok) {
                      setFeedback(commandErrorTextFor(outcome.error));
                    }
                  });
              }}
            >
              {copy.actionGenerateVpm}
            </Button>
          ) : null}
        </section>
      ) : null}
      {feedback !== null ? (
        <p className="vua-caption vua-text-secondary" role="status">
          {feedback}
        </p>
      ) : null}

      {entry.artifacts.some((artifact) => artifact.state === "quarantined") ? (
        <p className="vua-caption vua-text-secondary">
          {format(copy.neverRunNote, { recipe: termLabel("recipe") })}
        </p>
      ) : null}
      {entry.artifacts.some((artifact) => artifact.state === "pending") ? (
        <p className="vua-caption vua-text-secondary">
          {format(copy.pendingNote, { recipe: termLabel("recipe") })}
        </p>
      ) : null}
    </LibraryDetailLayout>
  );
}

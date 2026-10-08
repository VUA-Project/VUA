import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { catalogBrowser } from "../../app/catalog-browser-instance.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
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
} from "../../gateway/index.ts";
import { format, strings, termLabel } from "../../i18n/index.ts";
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
  type GlobalDefaultInference,
} from "./acquire-model.ts";
import { useCardSpotlight } from "./use-card-spotlight.ts";
import { DetailAlbum } from "./WarehouseAlbum.tsx";

const copy = strings.warehouse.acquire;
const cloudCopy = strings.warehouse;

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

/* ---- 工件卡片(与云端目录卡同形同交互;卡片 = 条目 × 工件) ---- */

export function ArtifactCard({
  card,
  selected,
  onOpen,
  onMenu,
}: {
  card: AcquireArtifactCard;
  selected: boolean;
  onOpen: () => void;
  onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { entry, artifact } = card;
  return (
    <article
      className="vua-warehouse-card"
      data-selected={selected || undefined}
      data-verdict={artifact.state}
      onClick={onOpen}
      onContextMenu={onMenu}
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
        {/* 预览提取未接入(F4-6 裁决):诚实空槽,升版随检查钩子切片回归 */}
        <div className="vua-warehouse-card__no-image">
          <span className="vua-caption vua-text-secondary">{copy.previewEmpty}</span>
        </div>
      </div>
      <div className="vua-warehouse-card__body">
        <p className="vua-warehouse-card__title" title={entry.displayName}>
          {entry.displayName}
        </p>
        <div className="vua-warehouse-card__meta">
          <span>{artifactSize(artifact)}</span>
          <span className="vua-caption vua-text-secondary">{copy.kind[entry.kind]}</span>
        </div>
        <div className="vua-warehouse-card__badges">
          <Badge tone={stateTone(artifact.state)}>{copy.verdict[artifact.state]}</Badge>
          <Badge tone="neutral">{copy.role[artifact.role]}</Badge>
        </div>
        <Button variant="subtle" aria-label={cloudCopy.removeFiles.actions} aria-haspopup="menu" onClick={(event) => { event.stopPropagation(); onMenu(event); }}>⋯</Button>
      </div>
    </article>
  );
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
}: {
  entryId: string;
  globalDefault: GlobalDefaultInference;
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

  // 事实层类型(entryDetail 读取面):D-6 预览组合读消费 artifacts[].mappedProductIds
  const loadedEntry: WarehouseEntryDetail | null =
    state.kind === "loaded" && state.view.kind === "detail" ? state.view.entry : null;

  // 重载/切换条目后草稿跟随服务端事实(覆盖值;null = 跟随全局)
  useEffect(() => {
    if (loadedEntry !== null) setModeDraft(loadedEntry.artifactMode ?? "follow");
  }, [loadedEntry]);

  // D-6 预览组合读:条目事实到达后按 mappedProductIds 定向查目录(方案 c);
  // 重载(reloadKey → entryDetail 重取 → loadedEntry 换引用)即随事实重查。
  // readEntryPreview 永不 reject,失败已按裁决归并为诚实空态视图。
  useEffect(() => {
    if (loadedEntry === null) {
      setPreview({ kind: "loading" });
      return;
    }
    let active = true;
    setPreview({ kind: "loading" });
    void readEntryPreview(catalogBrowser, loadedEntry).then((view) => {
      if (active) setPreview({ kind: "done", view });
    });
    return () => {
      active = false;
    };
  }, [loadedEntry]);

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

  if (state.kind === "loading") {
    return (
      <div className="vua-warehouse-detail__content">
        <Skeleton width="100%" height="auto" className="vua-warehouse-card__skeleton-media" />
        <Skeleton width="50%" height={14} />
        <Skeleton width="100%" height={60} />
      </div>
    );
  }
  if (state.kind === "failed" || state.view.kind === "not-connected") {
    return (
      <div className="vua-warehouse-detail__content">
        <p className="vua-text-secondary">{copy.detailLoadFailed}</p>
        <div>
          <Button variant="default" onClick={() => setReloadKey((key) => key + 1)}>
            {cloudCopy.detail.retry}
          </Button>
        </div>
      </div>
    );
  }
  if (state.view.kind === "not-found") {
    return (
      <div className="vua-warehouse-detail__content">
        <p className="vua-text-secondary">{copy.detailNotFound}</p>
      </div>
    );
  }

  const entry = state.view.entry;
  const mode = entryModeLine(entry);
  const previewAlbums = preview.kind === "done" && preview.view.kind === "loaded"
    ? preview.view.albums
    : null;
  const multipleSources = previewAlbums !== null && previewAlbums.length > 1;
  return (
    <div className="vua-warehouse-detail__content">
      {/* D-6 条目详情预览(核心裁决方案 c 组合读):目录来源相册经
          catalogImageUrl/DetailAlbum 同线渲染;取数中呈现骨架;无关联/
          关联无图(媒体空/目录 miss)按 AC-12 同规诚实空态,不猜测 */}
      {preview.kind === "loading" ? (
        <div className="vua-warehouse-detail__preview3d">
          <Skeleton width="100%" height={96} />
        </div>
      ) : previewAlbums === null ? (
        <div className="vua-warehouse-detail__preview3d">
          <span className="vua-caption vua-text-secondary">
            {preview.view.kind === "no-association"
              ? copy.previewNoAssociation
              : copy.previewNoImages}
          </span>
        </div>
      ) : (
        previewAlbums.map((album) => (
          <div key={album.productId}>
            {/* 多来源时标注各相册归属(Gateway 返回的标题/身份事实) */}
            {multipleSources ? (
              <p className="vua-caption vua-text-secondary">{album.title}</p>
            ) : null}
            <DetailAlbum imageUrls={album.imageUrls} title={album.title} />
          </div>
        ))
      )}
      <div className="vua-warehouse-detail__badges">
        <Badge tone="neutral">{copy.kind[entry.kind]}</Badge>
        {/* 模式行(F4-9):生效模式 + 覆盖 or 跟随全局;编辑区见下方产物模式组 */}
        <Badge tone="neutral">{copy.mode[mode.effective]}</Badge>
        <Badge tone="neutral">
          {mode.overridden ? copy.modeOverride : copy.modeFollowGlobal}
        </Badge>
      </div>
      <p className="vua-caption vua-text-secondary" title={entry.folderName}>
        {entry.folderName}
      </p>

      {/* F4-9 产物模式编辑(U8⑤ 总闸门控:总闸关=整组不呈现,分支 a 呈现层;
          跟随全局 = 清除覆盖(写 null),生效模式以服务端读回为准) */}
      {entrySurfacesVisible(globalDefault) ? (
        <section>
          <h3 className="vua-warehouse-detail__section-title">
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
        <section>
          <h3 className="vua-warehouse-detail__section-title">
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
    </div>
  );
}

/* ---- 页面 ---- */

export function WarehouseAcquire() {
  const view = useAcquireView();
  const [text, setText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 工件卡右键菜单(S-XII):仅真实动作——查看详情(条目) */
  const [cardMenu, setCardMenu] = useState<ContextMenuState | null>(null);

  // IMP-4 收口(2026-09-10):W18 导入流整体迁入素材导入页(本地段,verbatim);
  // 本页收敛为纯条目管理(design-standard 0.7.0 §8.3),导入入口不再重复。

  // 指针聚光 + 微倾斜,与云端墙一致(非 animated 模式零开销)
  const [wallEl, setWallEl] = useState<HTMLDivElement | null>(null);
  useCardSpotlight(wallEl);

  if (view.kind === "not-connected") {
    return (
      <EmptyState
        title={copy.states.notConnectedTitle}
        description={copy.states.notConnectedDescription}
      />
    );
  }

  const cards = artifactCards(view.entries);
  // U8⑤ 总闸门控的读面推断:无覆盖条目的生效模式即 composed 全局默认
  // (与设置页全局开关同一推断源;unknown=不屏蔽,不猜测总闸状态)
  const globalDefault = inferGlobalDefaultMode(view.entries);
  const selectedEntry =
    selectedId === null
      ? null
      : (view.entries.find((entry) => entry.warehouseItemId === selectedId) ?? null);

  const shown = cards.filter((card) => artifactCardMatches(card, text));

  const openCardMenu = (event: ReactMouseEvent<HTMLElement>, card: AcquireArtifactCard) => {
    event.preventDefault();
    setCardMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          id: "open",
          label: cloudCopy.card.detailsCta,
          onSelect: () => setSelectedId(card.entry.warehouseItemId),
        },
      ],
    });
  };

  return (
    <div className="vua-warehouse__content" data-drawer-open={selectedEntry !== null || undefined}>
      <div className="vua-warehouse__main">
        <div className="vua-warehouse__toolbar" role="search">
          <input
            type="search"
            className="vua-warehouse__search"
            placeholder={cloudCopy.searchPlaceholder}
            aria-label={cloudCopy.searchAria}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="vua-caption vua-text-secondary">
            {format(copy.entryCount, { count: view.entries.length })}
          </span>
        </div>

        <div className="vua-warehouse__wall-scroll" ref={setWallEl}>
          {view.entries.length === 0 ? (
            <EmptyState title={copy.entriesTitle} description={copy.entriesEmpty} />
          ) : shown.length === 0 ? (
            <EmptyState
              title={cloudCopy.states.emptyResultTitle}
              description={cloudCopy.states.emptyResultDescription}
            />
          ) : (
            <div className="vua-warehouse__wall" role="list">
              {shown.map((card) => (
                <ArtifactCard
                  key={card.key}
                  card={card}
                  selected={card.entry.warehouseItemId === selectedId}
                  onOpen={() => setSelectedId(card.entry.warehouseItemId)}
                  onMenu={(event) => openCardMenu(event, card)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedEntry !== null ? (
        <aside
          className="vua-warehouse__drawer"
          aria-label={cloudCopy.detail.panelAria}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSelectedId(null);
          }}
        >
          <div className="vua-warehouse__drawer-header">
            <h2 className="vua-warehouse-detail__title" title={selectedEntry.displayName}>
              {selectedEntry.displayName}
            </h2>
            <Button
              variant="subtle"
              aria-label={cloudCopy.detail.closeAria}
              onClick={() => setSelectedId(null)}
            >
              {cloudCopy.detail.close}
            </Button>
          </div>
          {/* key=warehouseItemId:切换条目时重置详情取数与组件内状态 */}
          <EntryDetail
            key={selectedEntry.warehouseItemId}
            entryId={selectedEntry.warehouseItemId}
            globalDefault={globalDefault}
          />
        </aside>
      ) : null}
      {cardMenu !== null ? (
        <ContextMenu menu={cardMenu} onClose={() => setCardMenu(null)} />
      ) : null}
    </div>
  );
}

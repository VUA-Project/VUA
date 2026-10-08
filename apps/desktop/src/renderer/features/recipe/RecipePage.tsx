import { useRecipeLibraryRevision } from "../../app/recipe-library-revision.ts";
import { formatDateTime } from "../../i18n/index.ts";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Icon, type IconName } from "@vua/design-system";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import {
  ContextMenu,
  type ContextMenuState,
} from "../../components/primitives/ContextMenu.tsx";
import { format, strings, termLabel } from "../../i18n/index.ts";
import {
  CURRENT_RECIPE_ID,
  useDataSource,
  useGateway,
  type RecipeGraphNode,
  type RecipeGraphView,
} from "../../gateway/index.ts";
import {
  narrowRecipeDocumentFacts,
  narrowRecipeDocumentStructure,
  narrowRecipeDocumentReceipt,
  recipeDocumentToGraphView,
  narrowRecipeLibraryEntries,
  selectLibraryRecipe,
  type RecipeDocumentReceipt,
  type RecipeDocumentFacts,
  type RecipeLibraryEntryNarrowed,
} from "./recipe-model.ts";
import {
  basePoints,
  layoutFromPoints,
  recipeLayerOrder,
  type GraphLayout,
  type GraphPoint,
  type RecipeGraph,
  type RecipeLayer,
} from "./recipe-model.ts";
import {
  isCustomized,
  loadRecipeLayouts,
  mergePoints,
  nudgePoint,
  pinAt,
  saveRecipeLayouts,
  writeRecipeLayout,
  type StoredRecipeLayoutsV2,
} from "./recipe-layout-model.ts";
import {
  appendVersion,
  loadRecipeVersions,
  pointsMatchSnapshot,
  removeVersion,
  saveRecipeVersions,
  type RecipeVersionEntry,
  type StoredRecipeVersionsV2,
} from "./recipe-versions.ts";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { ComposePage } from "../compose/ComposePage.tsx";
import { ProductionChainSection } from "../compose/ProductionChainSection.tsx";
import { RecipeDocumentEditSection } from "./RecipeDocumentEditSection.tsx";
import { RecipeDraftLibrary } from "./RecipeDraftLibrary.tsx";
import { RecipeProjectDraftExport } from "./RecipeProjectDraftExport.tsx";
import { productionChainRecipeSelectedAction } from "../../app/production-chain-store.ts";
import {
  recipeDocumentAdditionIds,
  recipeDocumentAssetIds,
} from "./recipe-document-edit-model.ts";
import {
  recipeDocumentEditAddItemAction,
  recipeDocumentEditClearedAction,
  recipeDocumentEditSelectedAction,
  useRecipeDocumentEdit,
} from "../../app/recipe-document-edit-store.ts";
import { WarehouseEntrySelector } from "../warehouse/WarehouseEntrySelector.tsx";
import "./recipe.css";

const copy = strings.recipe;

/** 版本 id:时间戳 + 会话内序号,可读且避免同毫秒碰撞 */
let versionSeq = 0;
function nextVersionId(): string {
  versionSeq += 1;
  return `v-${Date.now().toString(36)}-${versionSeq}`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDateTime(iso);
}

/**
 * Recipe 图谱页(C-RECIPE,S-XI Obsidian 风力导图):
 * - 力导自动布局:主轴 Avatar 钉在中心,素材经斥力/弹簧/语义层径向带
 *   有机展开(确定性:黄金角螺旋初始化 + 固定迭代,无随机源);
 * - 节点=圆点 + 侧标:中性灰,冲突/缺失红,unresolved 空心,Avatar 加大;
 *   悬停节点高亮邻居、弱化其余(Obsidian 交互语言);
 * - 图谱/列表/爆炸三视图常驻,列表不是降级方案(ui-ux §6.2);
 * - 位置调整三入口同语义:拖拽钉住自由点、键盘方向键、详情卡方向按钮;
 *   布局按 recipeId 版本化存本机(v2 自由点),可一键恢复力导布局;
 * - 画布:拖空白平移、滚轮朝指针缩放、右下角复位视图。
 *
 * 取数:gateway.modelProduction.recipeGraph(CURRENT_RECIPE_ID);
 * 未接入/失败/加载均诚实呈现;演示数据徽标由 dataSource 驱动。
 */

function nodeLabel(node: RecipeGraphNode): string {
  return node.asset?.displayFallback ?? node.id;
}

function nodeSubline(node: RecipeGraphNode): string | null {
  if (node.sourceRef) return `${node.sourceRef.provider} · ${node.sourceRef.productId}`;
  return null;
}

/** 冲突/缺失才用红(§6.1);unresolved 是中性事实,不是异常 */
function stateBadgeTone(state: RecipeGraphNode["state"]): "neutral" | "error" {
  return state === "conflict" || state === "missing" ? "error" : "neutral";
}

function layerOfNode(node: RecipeGraphNode): RecipeLayer {
  switch (node.role) {
    case "avatar_base":
      return "body";
    case "outfit":
    case "hair":
    case "accessory":
    case "prop":
      return "outfit";
    case "expression_pack":
    case "animation_pack":
      return "animation";
    default:
      return "tech";
  }
}

/** 详情卡角色图标(图谱节点本体是圆点,图标只在详情卡辅助识别) */
function roleIcon(node: RecipeGraphNode): IconName {
  switch (node.role) {
    case "avatar_base":
      return "avatar";
    case "outfit":
    case "hair":
    case "accessory":
    case "prop":
      return "outfit";
    case "expression_pack":
    case "animation_pack":
      return "anim";
    case "shader":
    case "texture_pack":
    case "material_pack":
      return "shader";
    case "tool_dependency":
      return "flask";
    default:
      return "folder";
  }
}

const DRAG_THRESHOLD_PX = 5;
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.4;
/** 键盘/按钮微调节距(世界 px) */
const NUDGE_PX = 16;

interface CanvasView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** 自适应取景:世界超出视口时缩小纳入(不低于 ZOOM_MIN),并居中 */
function fitCanvasView(vpW: number, vpH: number, worldW: number, worldH: number): CanvasView {
  const zoom = Math.min(
    1,
    Math.max(ZOOM_MIN, Math.min(vpW / (worldW + 96), vpH / (worldH + 96))),
  );
  return { zoom, x: (vpW - worldW * zoom) / 2, y: (vpH - worldH * zoom) / 2 };
}

interface DragState {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
}

function GraphCanvas({
  graph,
  layout,
  selectedId,
  exploded = false,
  onSelect,
  onPlace,
  onMove,
  onNodeMenu,
}: {
  graph: RecipeGraph;
  layout: GraphLayout;
  selectedId: string | null;
  /** S-IX-5 爆炸视图:节点按语义层 translateZ 拉开;倾斜下像素拖拽失真,仅保留点击与键盘 */
  exploded?: boolean;
  onSelect: (id: string | null) => void;
  /** 拖拽钉住:落点为世界坐标自由点(节点中心) */
  onPlace: (id: string, point: GraphPoint) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  /** 节点右键菜单(S-XII):由页面组装动作项 */
  onNodeMenu: (id: string, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
    moved: boolean;
  } | null>(null);
  /** 拖拽落提交后抑制紧随的 click(否则选中态会被误切换) */
  const suppressClickRef = useRef(false);
  /* 平移/缩放:世界层 transform;滚轮必须走原生监听(passive:false 才能 preventDefault) */
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  /** 用户平移/缩放后即不再跟随布局自适应;复位视图时清除 */
  const interactedRef = useRef(false);
  const panRef = useRef<{
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  /** 悬停节点:高亮邻居,弱化其余(Obsidian 图谱交互语言) */
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const cancelDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  // 初始(或复位后未交互)时:世界自适应纳入视口并居中
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || interactedRef.current) return;
    setView(fitCanvasView(viewport.clientWidth, viewport.clientHeight, layout.width, layout.height));
  }, [layout.width, layout.height]);

  // 滚轮缩放(朝指针位置):React 合成 wheel 无法 preventDefault,必须原生监听
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      interactedRef.current = true;
      const rect = viewport.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((current) => {
        const zoom = Math.min(
          ZOOM_MAX,
          Math.max(ZOOM_MIN, current.zoom * Math.exp(-event.deltaY * 0.0012)),
        );
        const scale = zoom / current.zoom;
        return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
      });
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, []);

  const resetView = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    interactedRef.current = false;
    setView(fitCanvasView(viewport.clientWidth, viewport.clientHeight, layout.width, layout.height));
  };

  const neighbors = useMemo(() => {
    if (hoveredId === null) return null;
    const set = new Set<string>([hoveredId]);
    for (const edge of graph.edges) {
      if (edge.from === hoveredId) set.add(edge.to);
      if (edge.to === hoveredId) set.add(edge.from);
    }
    return set;
  }, [hoveredId, graph.edges]);

  return (
    <div
      ref={viewportRef}
      className="vua-recipe-canvas"
      data-exploded={exploded || undefined}
      data-panning={panning || undefined}
      role="group"
      aria-label={termLabel("recipe")}
      onKeyDown={(event) => {
        if (event.key === "Escape" && dragRef.current) {
          cancelDrag();
          return;
        }
        if (!selectedId) return;
        const dir: readonly [number, number] | null =
          event.key === "ArrowUp"
            ? [0, -1]
            : event.key === "ArrowDown"
              ? [0, 1]
              : event.key === "ArrowLeft"
                ? [-1, 0]
                : event.key === "ArrowRight"
                  ? [1, 0]
                  : null;
        if (dir) {
          event.preventDefault();
          onMove(selectedId, dir[0] * NUDGE_PX, dir[1] * NUDGE_PX);
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // 节点自带拖拽(钉住自由点),空白处才是平移
        if ((event.target as Element).closest(".vua-recipe-graph__node")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        panRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          baseX: viewRef.current.x,
          baseY: viewRef.current.y,
          moved: false,
        };
        setPanning(true);
      }}
      onPointerMove={(event) => {
        const pan = panRef.current;
        if (!pan) return;
        const dx = event.clientX - pan.startX;
        const dy = event.clientY - pan.startY;
        if (!pan.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        pan.moved = true;
        interactedRef.current = true;
        setView((current) => ({ ...current, x: pan.baseX + dx, y: pan.baseY + dy }));
      }}
      onPointerUp={() => {
        const pan = panRef.current;
        panRef.current = null;
        setPanning(false);
        // 点击空白(未拖动):取消选中
        if (pan && !pan.moved) onSelect(null);
      }}
      onPointerCancel={() => {
        panRef.current = null;
        setPanning(false);
      }}
    >
      <div
        className="vua-recipe-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <div className="vua-recipe-graph" style={{ width: layout.width, height: layout.height }}>
          <svg
            className="vua-recipe-graph__edges"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {graph.edges.map((edge) => {
              const from = layout.positions.get(edge.from);
              const to = layout.positions.get(edge.to);
              if (!from || !to) return null;
              const dimmed =
                hoveredId !== null && edge.from !== hoveredId && edge.to !== hoveredId;
              return (
                <path
                  key={`${edge.from}->${edge.to}:${edge.kind}`}
                  data-kind={edge.kind}
                  data-dim={dimmed || undefined}
                  className="vua-recipe-graph__edge"
                  d={`M ${from.x} ${from.y} L ${to.x} ${to.y}`}
                />
              );
            })}
          </svg>
          {graph.nodes.map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            const dragging = drag?.id === node.id;
            return (
              <button
                key={node.id}
                type="button"
                className="vua-recipe-graph__node"
                data-state={node.state}
                data-avatar={node.role === "avatar_base" || undefined}
                data-selected={selectedId === node.id || undefined}
                data-dragging={dragging || undefined}
                data-dim={(neighbors !== null && !neighbors.has(node.id)) || undefined}
                style={
                  {
                    left: position.x + (dragging ? drag.dx : 0),
                    top: position.y + (dragging ? drag.dy : 0),
                    "--layer-depth": recipeLayerOrder.indexOf(layerOfNode(node)),
                  } as CSSProperties
                }
                onPointerEnter={() => setHoveredId(node.id)}
                onPointerLeave={() => setHoveredId(null)}
                onContextMenu={(event) => onNodeMenu(node.id, event)}
                onPointerDown={(event) => {
                  if (event.button !== 0 || exploded) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragRef.current = {
                    id: node.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    dx: 0,
                    dy: 0,
                    moved: false,
                  };
                }}
                onPointerMove={(event) => {
                  const active = dragRef.current;
                  if (!active || active.id !== node.id) return;
                  // 屏幕位移 ÷ 缩放 = 世界位移
                  const zoom = viewRef.current.zoom;
                  const dx = (event.clientX - active.startX) / zoom;
                  const dy = (event.clientY - active.startY) / zoom;
                  if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX / zoom) return;
                  active.moved = true;
                  active.dx = dx;
                  active.dy = dy;
                  setDrag({ id: node.id, dx, dy });
                }}
                onPointerUp={() => {
                  const active = dragRef.current;
                  dragRef.current = null;
                  setDrag(null);
                  if (!active || !active.moved) return;
                  suppressClickRef.current = true;
                  // positions 为节点中心(含半宽偏移);落点换回世界坐标钉住
                  onPlace(node.id, {
                    x: Math.round(position.x + active.dx - layout.width / 2),
                    y: Math.round(position.y + active.dy - layout.height / 2),
                  });
                }}
                onPointerCancel={cancelDrag}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  onSelect(selectedId === node.id ? null : node.id);
                }}
              >
                <span className="vua-recipe-graph__dot" aria-hidden="true" />
                <span className="vua-recipe-graph__node-label">{nodeLabel(node)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button type="button" className="vua-recipe-canvas__reset" onClick={resetView}>
        {copy.resetView}
      </button>
    </div>
  );
}

function GraphLegend() {
  return (
    <p className="vua-caption vua-text-secondary vua-recipe-legend" aria-label={copy.legendAria}>
      <span className="vua-recipe-legend__sample" data-kind="composition" />
      {copy.edgeKinds.composition}
      {" · "}
      <span className="vua-recipe-legend__sample" data-kind="wardrobe" />
      {copy.edgeKinds.wardrobe}
      {" · "}
      <span className="vua-recipe-legend__sample" data-kind="dependency" />
      {copy.edgeKinds.dependency}
    </p>
  );
}

/** 列表视图:与图谱共用同一语义分层,常驻可用,不是降级方案(ui-ux §6.2) */
function LayerList({
  graph,
  selectedId,
  onSelect,
  onMenu,
}: {
  graph: RecipeGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** 行右键菜单(S-XII):与图谱节点同一动作集 */
  onMenu: (id: string, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <div className="vua-page__stack">
      {recipeLayerOrder.map((layer) => {
        const nodes = graph.nodes.filter((node) => layerOfNode(node) === layer);
        if (nodes.length === 0) return null;
        return (
          <Card key={layer}>
            <div className="vua-page__stack">
              <h2 className="vua-caption vua-text-secondary">{copy.layers[layer]}</h2>
              <ul className="vua-recipe-list">
                {nodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="vua-recipe-list__row"
                      data-state={node.state}
                      data-selected={selectedId === node.id || undefined}
                      onClick={() => onSelect(selectedId === node.id ? null : node.id)}
                      onContextMenu={(event) => onMenu(node.id, event)}
                    >
                      <span className="vua-recipe-list__label">{nodeLabel(node)}</span>
                      {nodeSubline(node) !== null ? (
                        <span className="vua-caption vua-text-secondary">
                          {nodeSubline(node)}
                        </span>
                      ) : null}
                      <Badge tone={stateBadgeTone(node.state)}>
                        {copy.nodeStates[node.state]}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---- BG-1(W24 读面预备):recipe 文档库列表(production-use-case v0.2
 * recipe.list 读面;三视图共享选择骨架——选中态提升至页面顶层,后续文档
 * →视图映射接入时三视图同源消费;映射未接线=诚实标注,条目事实原样) ---- */

function RecipeLibrarySection({
  selectedId,
  onSelectDocument,
  onSelectId,
  refreshKey,
}: {
  selectedId: string | null;
  /** 文档回执上抛(029 A4):narrowRecipeDocumentReceipt 收窄后的回执(文档
   *  身份＋文档本体);null = 回执不可解释/读取失败(诚实失败路径) */
  onSelectDocument: (receipt: RecipeDocumentReceipt | null) => void;
  onSelectId: (id: string) => void;
  refreshKey: number;
}) {
  const [state, setState] = useState<
    | { readonly kind: "loading" }
    | { readonly kind: "unavailable" }
    | { readonly kind: "loaded"; readonly entries: readonly RecipeLibraryEntryNarrowed[] }
  >({ kind: "loading" });
  const persistedRevision = useRecipeLibraryRevision();
  const [facts, setFacts] = useState<RecipeDocumentFacts | null>(null);
  const [structure, setStructure] = useState<ReturnType<typeof narrowRecipeDocumentStructure>>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setFacts(null);
    void Promise.resolve(window.vua?.gateway.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "recipe.list",
        params: {},
      }))
      .then((result) => {
        if (!alive) return;
        if (!result?.ok) {
          setState({ kind: "unavailable" });
          return;
        }
        const entries = narrowRecipeLibraryEntries(
          (result.value as { entries?: unknown }).entries,
        );
        setState({ kind: "loaded", entries });
      })
      .catch(() => { if (alive) setState({ kind: "unavailable" }); });
    return () => {
      alive = false;
    };
  }, [reloadNonce, persistedRevision, refreshKey]);

  useEffect(() => {
    if (selectedId === null) {
      setFacts(null);
      setStructure(null);
      return;
    }
    let alive = true;
    setFacts(null);
    setStructure(null);
    void Promise.resolve(window.vua?.gateway.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "recipe.get",
        params: { recipeId: selectedId },
      }))
      .then((result) => {
        if (!alive) return;
        if (!result?.ok) {
          setFacts(null);
          setStructure(null);
          onSelectDocument(null);
          return;
        }
        // 冻结 wire 面 recipe-get.result v0.2:文档本体在 recipeDocument 键
        // (链身份只取回执文档身份,029 A4);收窄失败 = 诚实失败路径
        const receipt = narrowRecipeDocumentReceipt(result.value);
        setFacts(receipt === null ? null : narrowRecipeDocumentFacts(receipt.document));
        setStructure(receipt === null ? null : narrowRecipeDocumentStructure(receipt.document));
        onSelectDocument(receipt);
      })
      .catch(() => { if (alive) onSelectDocument(null); });
    return () => {
      alive = false;
    };
  }, [selectedId, reloadNonce, persistedRevision, refreshKey, onSelectDocument]);

  return (
    <div className="vua-recipe-library">
      <div className="vua-project-compat__row">
        <Button variant="subtle" onClick={() => setReloadNonce((key) => key + 1)}>
          {copy.libraryReload}
        </Button>
      </div>
      {state.kind === "loading" ? (
        <p className="vua-caption vua-text-secondary">{copy.libraryReload}…</p>
      ) : null}
      {state.kind === "unavailable" ? (
        <p className="vua-caption vua-text-secondary" role="alert">
          {copy.libraryUnavailable}
        </p>
      ) : null}
      {state.kind === "loaded" && state.entries.length === 0 ? (
        <EmptyState title={copy.libraryTitle} description={copy.libraryEmpty} />
      ) : null}
      {state.kind === "loaded" && state.entries.length > 0 ? (
        <ul className="vua-project-compat__specs" role="listbox" aria-label={copy.libraryTitle}>
          {state.entries.map((entry) => (
            <li key={entry.recipeId}>
              <button
                type="button"
                onClick={() => setQueueSelect(entry)}
                style={{ all: "unset", cursor: "pointer" }}
              >
                <strong>{entry.title}</strong>{' '}
                <span className="vua-caption vua-text-secondary">
                  rev {entry.revision} · {formatDateTime(entry.updatedAt)}
                </span>{' '}
                {selectedId === entry.recipeId ? (
                  <Badge tone="success">{copy.librarySelected}</Badge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selectedId !== null ? (
        <div role="note">
          <p className="vua-caption vua-text-secondary">{copy.libraryMappingNote}</p>
          {structure !== null && structure.assets.length > 0 ? (
            <ul className="vua-project-compat__specs">
              {structure.assets.map((asset) => (
                <li key={asset.id}>
                  <strong>{asset.label ?? asset.id}</strong>{' '}
                  <span className="vua-caption vua-text-secondary">
                    {asset.role}
                    {asset.hasSourceRef ? ' · ' + copy.structureHasSource : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
                    {facts !== null ? (
            <ul className="vua-project-compat__specs">
              <li>
                {format(copy.factsLine, {
                  revision: String(facts.revision),
                  assets: String(facts.assetCount),
                  instances: String(facts.instanceCount),
                  relations: String(facts.relationCount),
                })}
              </li>
              <li>{facts.locked === true ? copy.factsLocked : copy.factsUnlocked}</li>
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  function setQueueSelect(entry: RecipeLibraryEntryNarrowed): void {
    const next = selectLibraryRecipe(selectedId, entry.recipeId);
    if (next !== null) onSelectId(next);
  }
}

export function RecipePage() {
  const gateway = useGateway();
  const isFixture = useDataSource() === "fixture";
  const [graph, setGraph] = useState<RecipeGraphView | null>(null);
  const [points, setPoints] = useState<ReadonlyMap<string, GraphPoint> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [viewMode, setViewMode] = useState<"graph" | "list" | "exploded">("graph");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** S-IX-4 版本管理器:快照即时入 state,localStorage 只是落盘层 */
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<StoredRecipeVersionsV2>(() => loadRecipeVersions());
  const [versionNote, setVersionNote] = useState("");
  const layoutsRef = useRef<StoredRecipeLayoutsV2 | null>(null);
  // 搭配草稿弹窗(2026-09-20 导航重构):原独立页(019 批 B)收敛为配方页内
  // 弹窗;草稿状态在容器层(compose-draft-store/compose-save-chain),弹窗
  // 开关不影响其存续
  const [selectedLibraryRecipeId, setSelectedLibraryRecipeId] = useState<string | null>(null);
  const [documentMode, setDocumentMode] = useState(false);
  const [composeDialogOpen, setComposeDialogOpen] = useState(false);
  /** B 面环 4(029):从工程导出配方草稿弹窗(recipe-export v0.1 消费) */
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  /** 素材选择器弹窗(029 A3 本地段):仓储读面投影,供选中态「添加素材」 */
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  /** 文档编辑态(029 A2):底稿素材 ∪ 待保存新增 = 选择器「已在本配方」集 */
  const edit = useRecipeDocumentEdit();
  const addedIds = useMemo(() => {
    if (edit === null) return new Set<string>();
    return new Set<string>([
      ...recipeDocumentAssetIds(edit.document),
      ...recipeDocumentAdditionIds(edit.additions),
    ]);
  }, [edit]);

  useEffect(() => {
    if (documentMode) return;
    let alive = true;
    setLoadFailed(false);
    void gateway.modelProduction
      .recipeGraph(CURRENT_RECIPE_ID)
      .then((view) => {
        if (!alive) return;
        setGraph(view);
        if (view.kind === "graph") {
          const stored = loadRecipeLayouts();
          layoutsRef.current = stored;
          const bucket = stored.byRecipe[view.recipeId];
          setPoints(
            mergePoints(
              basePoints(view),
              bucket ? new Map(Object.entries(bucket)) : new Map<string, GraphPoint>(),
            ),
          );
        } else {
          setPoints(null);
        }
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [gateway, reloadNonce, documentMode]);

  const base = graph?.kind === "graph" ? basePoints(graph) : null;
  const layout = points !== null ? layoutFromPoints(points) : null;
  const customized = base !== null && points !== null && isCustomized(base, points);
  const selectedNode =
    graph?.kind === "graph"
      ? (graph.nodes.find((node) => node.id === selectedId) ?? null)
      : null;

  /** 三入口共用的提交点:更新画布 + 版本化持久化(按 recipeId 分桶) */
  const commitPoints = (next: ReadonlyMap<string, GraphPoint>) => {
    setPoints(next);
    if (graph?.kind !== "graph") return;
    const stored = writeRecipeLayout(layoutsRef.current ?? loadRecipeLayouts(), graph.recipeId, next);
    layoutsRef.current = stored;
    saveRecipeLayouts(stored);
  };

  const resetLayout = () => {
    if (graph?.kind !== "graph" || base === null) return;
    setPoints(new Map(base));
    const stored = writeRecipeLayout(
      layoutsRef.current ?? loadRecipeLayouts(),
      graph.recipeId,
      null,
    );
    layoutsRef.current = stored;
    saveRecipeLayouts(stored);
  };

  const moveSelected = (dx: number, dy: number) => {
    if (selectedId === null || points === null) return;
    commitPoints(nudgePoint(points, selectedId, dx * NUDGE_PX, dy * NUDGE_PX));
  };

  const versionList =
    graph?.kind === "graph" ? (versions.byRecipe[graph.recipeId] ?? []) : [];

  /** 打开面板;演示数据下若该配方无快照,播种两条基线/自定义示例 */
  const toggleVersions = () => {
    const opening = !versionsOpen;
    setVersionsOpen(opening);
    if (!opening || !isFixture || graph?.kind !== "graph" || points === null) return;
    if ((versions.byRecipe[graph.recipeId] ?? []).length > 0) return;
    const base = basePoints(graph);
    const moveTarget =
      graph.nodes.find((node) => node.role !== "avatar_base")?.id ?? graph.nodes[0]?.id;
    const seedBase: RecipeVersionEntry = {
      id: nextVersionId(),
      savedAt: new Date(Date.now() - 86_400_000).toISOString(),
      note: copy.versions.seedNoteBase,
      nodeCount: graph.nodes.length,
      missingCount: graph.missing.length,
      points: Object.fromEntries(base),
    };
    const seedCustom: RecipeVersionEntry = {
      ...seedBase,
      id: nextVersionId(),
      savedAt: new Date().toISOString(),
      note: copy.versions.seedNoteCustom,
      points: Object.fromEntries(
        moveTarget ? nudgePoint(base, moveTarget, 120, 64) : base,
      ),
    };
    const next = appendVersion(appendVersion(versions, graph.recipeId, seedBase), graph.recipeId, seedCustom);
    setVersions(next);
    saveRecipeVersions(next);
  };

  const saveVersion = () => {
    if (graph?.kind !== "graph" || points === null) return;
    const entry: RecipeVersionEntry = {
      id: nextVersionId(),
      savedAt: new Date().toISOString(),
      note: versionNote.trim() === "" ? null : versionNote.trim(),
      nodeCount: graph.nodes.length,
      missingCount: graph.missing.length,
      points: Object.fromEntries(points),
    };
    const next = appendVersion(versions, graph.recipeId, entry);
    setVersions(next);
    saveRecipeVersions(next);
    setVersionNote("");
  };

  /** 恢复快照:merge 进当前基线,吸收图谱漂移,走与拖拽相同的持久化路径 */
  const restoreVersion = (entry: RecipeVersionEntry) => {
    if (graph?.kind !== "graph") return;
    commitPoints(mergePoints(basePoints(graph), new Map(Object.entries(entry.points))));
  };

  const removeVersionEntry = (versionId: string) => {
    if (graph?.kind !== "graph") return;
    const next = removeVersion(versions, graph.recipeId, versionId);
    setVersions(next);
    saveRecipeVersions(next);
  };

  /** 节点/版本条目右键菜单(S-XII):单一菜单状态,打开时现组装真实动作项 */
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const openNodeMenu = (nodeId: string, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    if (graph?.kind !== "graph" || points === null || base === null) return;
    const basePoint = base.get(nodeId);
    const currentPoint = points.get(nodeId);
    const atBase =
      basePoint === undefined ||
      currentPoint === undefined ||
      (basePoint.x === currentPoint.x && basePoint.y === currentPoint.y);
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        selectedId === nodeId
          ? {
              id: "deselect",
              label: copy.contextMenu.deselect,
              onSelect: () => setSelectedId(null),
            }
          : {
              id: "viewDetails",
              label: copy.contextMenu.viewDetails,
              onSelect: () => setSelectedId(nodeId),
            },
        {
          id: "resetPosition",
          label: copy.contextMenu.resetPosition,
          disabled: atBase,
          onSelect: () => {
            if (basePoint !== undefined) commitPoints(pinAt(points, nodeId, basePoint));
          },
        },
      ],
    });
  };

  const openVersionMenu = (entry: RecipeVersionEntry, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: "restore", label: copy.versions.restore, onSelect: () => restoreVersion(entry) },
        { id: "remove", label: copy.versions.remove, onSelect: () => removeVersionEntry(entry.id) },
      ],
    });
  };

  // BG-1(W24 读面预备,A 路径已确认):文档库共享选择骨架——选中库文档即
  // 经映射(recipeDocumentToGraphView)装载三视图,state=expected 期望态
  // 词表(语义标注随视图呈现);清除选择回合成纵向(reloadNonce 重取)
  // 029 A4:选择同时是链的事实源动作——productionChainRecipeSelectedAction
  // 只吃 recipe.get 回执文档身份(收窄自 narrowRecipeDocumentReceipt),
  // 链身份即对象身份,不取列表标签不取本地猜测。

  const handleLibraryDocument = useCallback((receipt: RecipeDocumentReceipt | null) => {
    if (receipt === null) { setLoadFailed(true); return; }
    productionChainRecipeSelectedAction(receipt.recipeId, receipt.revision);
    // 029 A2:编辑态随选中事实源对齐(身份相同保留待保存新增,身份变更即
    // 新编辑会话;文档本体为保存合并的透明底稿)
    recipeDocumentEditSelectedAction(receipt.recipeId, receipt.revision, receipt.document);
    const view = recipeDocumentToGraphView(receipt.document);
    if (view === null || view.kind !== "graph") { setLoadFailed(true); return; }
    setLoadFailed(false);
    setDocumentMode(true);
    setGraph(view);
    const stored = loadRecipeLayouts();
    layoutsRef.current = stored;
    const bucket = stored.byRecipe[view.recipeId];
    setPoints(
      mergePoints(
        basePoints(view),
        bucket ? new Map(Object.entries(bucket)) : new Map<string, GraphPoint>(),
      ),
    );
  }, []);

  const exitDocumentMode = () => {
    setSelectedLibraryRecipeId(null);
    setDocumentMode(false);
    setMaterialPickerOpen(false);
    // 029 A2:退出选中态即清除编辑会话(待保存新增随选中清除,不跨配方携带)
    recipeDocumentEditClearedAction();
    setReloadNonce((nonce) => nonce + 1);
  };

  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">
          {termLabel("recipe")}
          {isFixture ? (
            <>
              {" "}
              <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
            </>
          ) : null}
        </h1>
        <div className="vua-page__actions" role="group" aria-label={copy.viewSwitchAria}>
          <Button
            variant={viewMode === "graph" ? "primary" : "default"}
            onClick={() => setViewMode("graph")}
          >
            {copy.viewGraph}
          </Button>
          <Button
            variant={viewMode === "list" ? "primary" : "default"}
            onClick={() => setViewMode("list")}
          >
            {copy.viewList}
          </Button>
          <Button
            variant={viewMode === "exploded" ? "primary" : "default"}
            onClick={() => setViewMode("exploded")}
          >
            {copy.viewExploded}
          </Button>
          {viewMode !== "list" && layout !== null ? (
            <Button variant="default" disabled={!customized} onClick={resetLayout}>
              {copy.resetLayout}
            </Button>
          ) : null}
          {graph?.kind === "graph" ? (
            <Button
              variant={versionsOpen ? "primary" : "default"}
              onClick={toggleVersions}
            >
              {copy.versions.toggle}
            </Button>
          ) : null}
        </div>
        {/* 创建入口(029 A1 升格):配方页主路径「创建」(U16 裁决原文词面,
            不与「添加素材/组装」混用)打开搭配草稿弹窗——草稿弹窗保留为创建
            起点之一,两 UI 一保存链纪律不破(019 批 D);创建产物入配方库并可
            被选择(保存回执已接库失效重取) */}
        <div className="vua-page__actions">
          <Button variant="primary" onClick={() => setComposeDialogOpen(true)}>
            {copy.createCta}
          </Button>
          <Button variant="default" onClick={() => setComposeDialogOpen(true)}>
            {strings.nav.pages.composePage}
          </Button>
          {/* B 面环 4(029):反向入口——从已有 VUA 管理工程导出配方草稿;入口
              限定已注册工程集,转正走既有保存链(草稿绝不静默转正) */}
          <Button variant="default" onClick={() => setExportDialogOpen(true)}>
            {copy.exportCta}
          </Button>
        </div>
      </section>

      <RecipeDraftLibrary />

      <Card>
        <RecipeLibrarySection
          refreshKey={reloadNonce}
          selectedId={selectedLibraryRecipeId}
          onSelectId={(id) => {
            if (id === selectedLibraryRecipeId) return;
            setSelectedLibraryRecipeId(id);
            setDocumentMode(true);
            setGraph(null);
            setPoints(null);
            setLoadFailed(false);
          }}
          onSelectDocument={handleLibraryDocument}
        />
      </Card>

      {documentMode ? (
        <Card>
          <div className="vua-page__stack">
            <p className="vua-caption vua-text-secondary" role="note">
              {copy.documentModeNote}
            </p>
            {/* 029 A2(选中态添加素材动作):选择器只是仓储读面投影(A3 本地
                段);挑选进入待保存新增,保存走 recipe.save 版本链(同一保存
                链形状、同一守卫集)——本地新增绝不冒充已保存 */}
            <div className="vua-page__actions">
              <Button variant="default" onClick={() => setMaterialPickerOpen(true)}>
                {copy.addMaterialCta}
              </Button>
              <Button variant="default" onClick={exitDocumentMode}>
                {copy.documentModeExit}
              </Button>
            </div>
            <RecipeDocumentEditSection />
          </div>
        </Card>
      ) : null}

      {/* 029 A5(选中态组装发起面):生产链段双挂载消费同一容器层 store 与
          Gateway 端口(019 批 C 两 UI 同 store 先例)——选择驱动链身份就绪后
          在选中态直接发起组装(解析→计划→批准→执行);无链身份时链段自行
          不渲染,车间页消费归切片二(A6) */}
      {documentMode ? <ProductionChainSection /> : null}

      {loadFailed ? (
        <Card>
          <EmptyState
            title={copy.loadFailed}
            description={copy.loadFailedDescription}
            action={
              <Button variant="primary" onClick={() => setReloadNonce((nonce) => nonce + 1)}>
                {copy.retry}
              </Button>
            }
          />
        </Card>
      ) : graph === null || (graph.kind === "graph" && layout === null) ? (
        <Card>
          <div className="vua-page__stack">
            <Skeleton width="40%" />
            <Skeleton width="80%" />
            <Skeleton width="60%" />
          </div>
        </Card>
      ) : graph.kind === "not-connected" ? (
        <Card>
          <EmptyState title={copy.notConnectedTitle} description={copy.notConnectedDescription} />
        </Card>
      ) : (
        <>
          {graph.conflicts.length > 0 ? (
            <Card>
              <div className="vua-page__stack">
                <h2 className="vua-caption">{copy.conflictsTitle}</h2>
                {graph.conflicts.map((conflict) => (
                  <p key={conflict.nodeIds.join(",")} className="vua-text-secondary">
                    {conflict.description}
                  </p>
                ))}
              </div>
            </Card>
          ) : null}
          {graph.missing.length > 0 ? (
            <Card>
              <div className="vua-page__stack">
                <h2 className="vua-caption">{copy.missingTitle}</h2>
                <p className="vua-text-secondary">
                  {graph.missing
                    .map((id) => {
                      const node = graph.nodes.find((item) => item.id === id);
                      return node ? nodeLabel(node) : id;
                    })
                    .join(" / ")}
                </p>
              </div>
            </Card>
          ) : null}

          {viewMode !== "list" && layout !== null && points !== null ? (
            <Card className="vua-recipe-canvas-card">
              {viewMode === "graph" ? <GraphLegend /> : null}
              <GraphCanvas
                graph={graph}
                layout={layout}
                selectedId={selectedId}
                exploded={viewMode === "exploded"}
                onSelect={setSelectedId}
                onPlace={(id, point) => commitPoints(pinAt(points, id, point))}
                onMove={(id, dx, dy) => commitPoints(nudgePoint(points, id, dx, dy))}
                onNodeMenu={openNodeMenu}
              />
              <p className="vua-caption vua-text-secondary">
                {viewMode === "exploded" ? copy.explodedHint : copy.moveHint}
              </p>
            </Card>
          ) : viewMode === "list" ? (
            <LayerList
              graph={graph}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onMenu={openNodeMenu}
            />
          ) : null}

          {versionsOpen && points !== null ? (
            <Card className="vua-recipe-versions">
              <div className="vua-page__stack">
                <h2 className="vua-caption vua-text-secondary">{copy.versions.title}</h2>
                <div className="vua-recipe-versions__save">
                  <input
                    type="text"
                    className="vua-recipe-versions__note"
                    value={versionNote}
                    placeholder={copy.versions.notePlaceholder}
                    aria-label={copy.versions.noteAria}
                    onChange={(event) => setVersionNote(event.target.value)}
                  />
                  <Button variant="primary" onClick={saveVersion}>
                    {copy.versions.saveCta}
                  </Button>
                </div>
                {versionList.length === 0 ? (
                  <p className="vua-caption vua-text-secondary">{copy.versions.empty}</p>
                ) : (
                  <ul className="vua-recipe-versions__list">
                    {[...versionList].reverse().map((entry) => (
                      <li
                        key={entry.id}
                        className="vua-recipe-versions__entry"
                        onContextMenu={(event) => openVersionMenu(entry, event)}
                      >
                        <div className="vua-recipe-versions__entry-head">
                          <span>{formatTime(entry.savedAt)}</span>
                          {pointsMatchSnapshot(points, entry.points) ? (
                            <Badge tone="success">{copy.versions.currentBadge}</Badge>
                          ) : null}
                        </div>
                        {entry.note !== null ? (
                          <p className="vua-recipe-versions__entry-note">{entry.note}</p>
                        ) : null}
                        <p className="vua-caption vua-text-secondary">
                          {format(copy.versions.metaLine, {
                            nodes: entry.nodeCount,
                            missing: entry.missingCount,
                          })}
                        </p>
                        <div className="vua-page__actions">
                          <Button variant="default" onClick={() => restoreVersion(entry)}>
                            {copy.versions.restore}
                          </Button>
                          <Button variant="default" onClick={() => removeVersionEntry(entry.id)}>
                            {copy.versions.remove}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="vua-caption vua-text-secondary">{copy.versions.scopeNote}</p>
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="vua-page__stack">
              <h2 className="vua-caption vua-text-secondary">{copy.detailTitle}</h2>
              {selectedNode === null ? (
                <p className="vua-caption vua-text-secondary">{copy.detailEmpty}</p>
              ) : (
                <>
                  <p className="vua-text-secondary">
                    <Icon name={roleIcon(selectedNode)} size={16} /> {nodeLabel(selectedNode)}
                  </p>
                  <div className="vua-page__actions">
                    <Badge tone={stateBadgeTone(selectedNode.state)}>
                      {copy.nodeStates[selectedNode.state]}
                    </Badge>
                    {selectedNode.role ? <Badge tone="neutral">{selectedNode.role}</Badge> : null}
                  </div>
                  {nodeSubline(selectedNode) !== null ? (
                    <p className="vua-caption vua-text-secondary">
                      {nodeSubline(selectedNode)}
                    </p>
                  ) : null}
                  {viewMode !== "list" ? (
                    <div className="vua-page__actions" role="group" aria-label={copy.moveGroupAria}>
                      <Button variant="default" onClick={() => moveSelected(0, -1)}>
                        {copy.moveUp}
                      </Button>
                      <Button variant="default" onClick={() => moveSelected(0, 1)}>
                        {copy.moveDown}
                      </Button>
                      <Button variant="default" onClick={() => moveSelected(-1, 0)}>
                        {copy.moveLeft}
                      </Button>
                      <Button variant="default" onClick={() => moveSelected(1, 0)}>
                        {copy.moveRight}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </Card>
        </>
      )}
      {menu !== null ? <ContextMenu menu={menu} onClose={() => setMenu(null)} /> : null}
      <ContentDialog
        open={composeDialogOpen}
        title={strings.nav.pages.composePage}
        closeLabel={strings.common.dialogClose}
        onClose={() => setComposeDialogOpen(false)}
      >
        <ComposePage />
      </ContentDialog>
      {/* B 面环 4(029):从工程导出配方草稿——拾取段限定 VUA 已注册工程集;
          确认段六事实键如实呈现(缺失维度清单照单),转正走既有 recipe.save
          保存链,草稿绝不静默转正 */}
      <ContentDialog
        open={exportDialogOpen}
        title={copy.exportDialogTitle}
        closeLabel={strings.common.dialogClose}
        onClose={() => setExportDialogOpen(false)}
      >
        <RecipeProjectDraftExport />
      </ContentDialog>
      {/* 素材选择器(029 A3 本地段):仓储读面(acquire entries)投影——只
          呈现本地条目事实,云端素材接入(未决项 3 = #46)裁决前诚实缺席;
          素材入库仍走素材导入页既有两路径,本弹窗不立第三导入入口 */}
      <ContentDialog
        open={materialPickerOpen}
        title={copy.materialPickerTitle}
        closeLabel={strings.common.dialogClose}
        onClose={() => setMaterialPickerOpen(false)}
      >
        <WarehouseEntrySelector
          addedIds={addedIds}
          onPick={(entry) =>
            recipeDocumentEditAddItemAction({
              warehouseItemId: entry.warehouseItemId,
              title: entry.displayName,
              role: null,
              nameHint: null,
            })
          }
        />
      </ContentDialog>
    </div>
  );
}

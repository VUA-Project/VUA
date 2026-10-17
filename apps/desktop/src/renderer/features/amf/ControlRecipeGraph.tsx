/** The Recipe graph: an SVG drawing driven by the force simulation; the frame loop writes positions straight to the DOM. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { Icon, type IconName } from "@vua/design-system";
import { adjacency, graphCaption, type GraphNode, type GraphNodeKind, type RecipeGraph } from "./control-graph-model.ts";
import { bounds, createSimulation, hold, isSettled, nearestInDirection, place, reheat, release, settle, tick, type Simulation } from "./control-physics.ts";
import { GRAPH_CONFIG } from "./control-graph-config.ts";
import { useEffectsOn } from "./RoomCanvas.tsx";

const { nodeRadius: NODE_RADIUS, linkLength: LINK_LENGTH, view: VIEW, label: LABEL } = GRAPH_CONFIG;
export const NODE_ICONS: Record<GraphNodeKind, IconName> = { recipe: "file", avatar: "avatar", outfit: "outfit", material: "shader", package: "download" };
const STEP_MS = 1000 / VIEW.stepsPerSecond;

/** The graph moves while effects are on and the system asks for full motion; otherwise it draws its settled layout. */
export type GraphMotion = "animated" | "static";
const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReduced(change: () => void): () => void {
  const query = window.matchMedia?.(REDUCED);
  query?.addEventListener("change", change);
  return () => query?.removeEventListener("change", change);
}
const reducedSnapshot = () => window.matchMedia?.(REDUCED).matches ?? false;
export function useGraphMotion(): GraphMotion {
  const effectsOn = useEffectsOn();
  const reduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, () => true);
  return effectsOn && !reduced ? "animated" : "static";
}

/** Each kind has its own outline, so the graph reads without colour too. */
export function NodeShape({ kind }: { kind: GraphNodeKind }) {
  const r = NODE_RADIUS[kind];
  if (kind === "recipe") return <path className="vua-graph__shape" d={`M${-r},${-r}H${r - 9}L${r},${-r + 9}V${r}H${-r + 9}L${-r},${r - 9}Z`}/>;
  if (kind === "package") return <path className="vua-graph__shape" d={`M0,${-r - 3}L${r + 3},0L0,${r + 3}L${-r - 3},0Z`}/>;
  if (kind === "material") return <rect className="vua-graph__shape" x={-r} y={-r} width={r * 2} height={r * 2}/>;
  return <circle className="vua-graph__shape" r={r}/>;
}
function shortLabel(label: string): string { return [...label].length > LABEL.maxChars ? `${[...label].slice(0, LABEL.maxChars - 1).join("")}…` : label; }
/** Room a node keeps around itself: its outline, and its caption below it when the caption shows by default. */
function collideRoom(node: GraphNode, labelled: boolean): { radius: number; offset: number } {
  const r = NODE_RADIUS[node.kind] + 4;
  if (!labelled) return { radius: r, offset: 0 };
  const latin = node.kind === "recipe" ? LABEL.recipeLatin : LABEL.latin; const wide = node.kind === "recipe" ? LABEL.recipeWide : LABEL.wide;
  const width = [...shortLabel(graphCaption(node))].reduce((sum, char) => sum + (char.codePointAt(0)! > 0x2e80 ? wide : latin), 0);
  return { radius: Math.min(LABEL.roomMax, Math.max(r + 8, width / 2 + 4)), offset: LABEL.roomOffset };
}
const labelledByDefault = (node: GraphNode, count: number) => count <= LABEL.allUpTo || node.kind === "recipe" || node.kind === "avatar";

interface Camera { scale: number; x: number; y: number; auto: boolean }
interface GraphControls { move: () => void; drop: (index: number, x: number, y: number) => void }
const idleControls: GraphControls = { move: () => {}, drop: () => {} };
interface Gesture { pointer: number; index: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean }

export function RecipeGraphCanvas({ graph, selectedId, onSelect, resetKey, label, hint, describe }: {
  graph: RecipeGraph; selectedId: string | null; onSelect: (id: string | null) => void; resetKey: number;
  label: string; hint: string; describe: (node: GraphNode) => string;
}) {
  const motion = useGraphMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const nodeRefs = useRef<(SVGGElement | null)[]>([]);
  const edgeRefs = useRef<(SVGLineElement | null)[]>([]);
  const remembered = useRef(new Map<string, { x: number; y: number }>());
  const camera = useRef<Camera>({ scale: 1, x: 0, y: 0, auto: true });
  const gesture = useRef<Gesture | null>(null);
  const controls = useRef<GraphControls>(idleControls);
  const [size, setSize] = useState({ width: 800, height: 520 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [lastReset, setLastReset] = useState(resetKey);

  const indexOf = useMemo(() => new Map(graph.nodes.map((node, i) => [node.id, i] as const)), [graph]);
  const near = useMemo(() => adjacency(graph), [graph]);
  const edgeEnds = useMemo(() => graph.edges.map(edge => [indexOf.get(edge.from) ?? -1, indexOf.get(edge.to) ?? -1] as const), [graph, indexOf]);
  if (resetKey !== lastReset) { setLastReset(resetKey); remembered.current.clear(); camera.current.auto = true; }
  const sim: Simulation = useMemo(() => {
    const start = graph.nodes.map(node => remembered.current.get(node.id));
    const rooms = graph.nodes.map(node => collideRoom(node, labelledByDefault(node, graph.nodes.length)));
    return createSimulation(rooms.map(room => room.radius), graph.edges.map((edge, i) => ({ source: edgeEnds[i]![0], target: edgeEnds[i]![1], length: LINK_LENGTH[edge.kind] })), start, rooms.map(room => room.offset));
    // resetKey starts a fresh layout from the deterministic start positions.
  }, [graph, edgeEnds, lastReset]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize(current => (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height }));
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0; let running = false; let last = 0; let carry = 0;
    // The layout leans a little further than the view's own shape, so a wide view fills out.
    const aspect = Math.min(VIEW.aspectMax, Math.max(VIEW.aspectMin, Math.pow(size.width / Math.max(1, size.height), VIEW.aspectLean)));
    if (Math.abs(aspect - sim.aspect) > 0.05) { sim.aspect = aspect; reheat(sim, 0.3); }
    const fitTarget = () => {
      const box = bounds(sim);
      const pad = VIEW.fitPadding;
      const scale = Math.min(VIEW.maxFitScale, Math.max(VIEW.minScale, Math.min(size.width / (box.maxX - box.minX + pad * 2), size.height / (box.maxY - box.minY + pad * 2))));
      return { scale, x: size.width / 2 - ((box.minX + box.maxX) / 2) * scale, y: size.height / 2 - ((box.minY + box.maxY) / 2) * scale };
    };
    /** Writes positions and eases the camera towards the fitted view; returns whether the camera still moves. */
    const draw = (ease: number): boolean => {
      const cam = camera.current;
      let moving = false;
      if (cam.auto && gesture.current === null) {
        const target = fitTarget();
        moving = Math.abs(target.x - cam.x) > 0.5 || Math.abs(target.y - cam.y) > 0.5 || Math.abs(target.scale - cam.scale) > 0.002;
        cam.scale += (target.scale - cam.scale) * ease; cam.x += (target.x - cam.x) * ease; cam.y += (target.y - cam.y) * ease;
      }
      sceneRef.current?.setAttribute("transform", `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.scale.toFixed(4)})`);
      for (let i = 0; i < sim.x.length; i += 1) nodeRefs.current[i]?.setAttribute("transform", `translate(${sim.x[i]!.toFixed(1)} ${sim.y[i]!.toFixed(1)})`);
      edgeEnds.forEach(([a, b], i) => {
        const line = edgeRefs.current[i];
        if (!line || a < 0 || b < 0) return;
        line.setAttribute("x1", sim.x[a]!.toFixed(1)); line.setAttribute("y1", sim.y[a]!.toFixed(1));
        line.setAttribute("x2", sim.x[b]!.toFixed(1)); line.setAttribute("y2", sim.y[b]!.toFixed(1));
      });
      return moving && ease < 1;
    };
    const remember = () => { graph.nodes.forEach((node, i) => remembered.current.set(node.id, { x: sim.x[i]!, y: sim.y[i]! })); };
    if (motion === "static") {
      // One finished frame: the layout settles at once and a drop re-settles around the dropped node.
      settle(sim); remember(); draw(1);
      controls.current = {
        move: () => { draw(1); },
        drop: (index, x, y) => { hold(sim, index, x, y); place(sim, index, x, y); for (let i = 0; i < VIEW.staticDropTicks; i += 1) tick(sim); release(sim); settle(sim); remember(); draw(1); },
      };
      return () => { controls.current = idleControls; };
    }
    const loop = (now: number) => {
      carry += Math.min(100, now - last); last = now;
      let steps = 0;
      while (carry >= STEP_MS && steps < VIEW.maxStepsPerFrame) { tick(sim); carry -= STEP_MS; steps += 1; }
      if (steps === VIEW.maxStepsPerFrame) carry = 0;
      const cameraMoving = draw(VIEW.cameraEase);
      if (isSettled(sim) && !cameraMoving) { running = false; remember(); return; }
      frame = requestAnimationFrame(loop);
    };
    const start = () => { if (running) return; running = true; last = performance.now(); carry = STEP_MS; frame = requestAnimationFrame(loop); };
    controls.current = { move: start, drop: () => { release(sim); reheat(sim, GRAPH_CONFIG.physics.releaseAlpha); start(); } };
    draw(1);
    start();
    return () => { cancelAnimationFrame(frame); running = false; remember(); controls.current = idleControls; };
  }, [sim, motion, size, graph, edgeEnds]);

  // Wheel zoom around the pointer; the listener is not passive so the page does not scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const cam = camera.current; cam.auto = false;
      const px = event.clientX - rect.left; const py = event.clientY - rect.top;
      const next = Math.min(VIEW.maxScale, Math.max(VIEW.minScale, cam.scale * Math.exp(-event.deltaY * VIEW.wheelZoom)));
      cam.x = px - ((px - cam.x) / cam.scale) * next; cam.y = py - ((py - cam.y) / cam.scale) * next; cam.scale = next;
      sceneRef.current?.setAttribute("transform", `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.scale.toFixed(4)})`);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const world = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect(); const cam = camera.current;
    return { x: (clientX - rect.left - cam.x) / cam.scale, y: (clientY - rect.top - cam.y) / cam.scale };
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = (event.target as Element).closest("[data-node-index]");
    const index = target ? Number(target.getAttribute("data-node-index")) : -1;
    svgRef.current?.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, index, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    if (!g.moved && Math.hypot(event.clientX - g.startX, event.clientY - g.startY) > VIEW.dragThreshold) g.moved = true;
    if (!g.moved) return;
    if (g.index >= 0) {
      const point = world(event.clientX, event.clientY);
      if (motion === "static") place(sim, g.index, point.x, point.y); else hold(sim, g.index, point.x, point.y);
      controls.current.move();
    } else {
      const cam = camera.current; cam.auto = false;
      cam.x += event.clientX - g.lastX; cam.y += event.clientY - g.lastY;
      sceneRef.current?.setAttribute("transform", `translate(${cam.x.toFixed(2)} ${cam.y.toFixed(2)}) scale(${cam.scale.toFixed(4)})`);
    }
    g.lastX = event.clientX; g.lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    gesture.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    if (g.index >= 0 && g.moved) { const point = world(event.clientX, event.clientY); controls.current.drop(g.index, point.x, point.y); return; }
    if (!g.moved) onSelect(g.index >= 0 ? graph.nodes[g.index]!.id : null);
  };
  const onPointerCancel = () => {
    const g = gesture.current; gesture.current = null;
    if (g && g.index >= 0 && g.moved) controls.current.drop(g.index, sim.x[g.index]!, sim.y[g.index]!);
  };

  const firstRecipe = graph.nodes.find(node => node.kind === "recipe")?.id ?? graph.nodes[0]?.id ?? null;
  const active = focused ?? selectedId ?? firstRecipe;
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const from = active === null ? -1 : indexOf.get(active) ?? -1;
    const direction = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[event.key as "ArrowLeft"];
    if (direction && from >= 0) {
      event.preventDefault();
      const next = nearestInDirection(sim, from, direction);
      if (next >= 0) { setFocused(graph.nodes[next]!.id); nodeRefs.current[next]?.focus(); }
    } else if ((event.key === "Enter" || event.key === " ") && active !== null) {
      event.preventDefault(); onSelect(active);
    } else if (event.key === "Escape" && selectedId !== null) {
      event.preventDefault(); onSelect(null);
    }
  };

  const spotlight = hovered ?? focused ?? selectedId;
  const lit = spotlight === null ? null : new Set([spotlight, ...(near.get(spotlight) ?? [])]);
  return <svg ref={svgRef} className="vua-graph" role="group" aria-label={label} aria-roledescription="graph"
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onKeyDown={onKeyDown}>
    <desc>{hint}</desc>
    <g ref={sceneRef}>
      <g className="vua-graph__edges">
        {graph.edges.map((edge, i) => <line key={edge.id} ref={element => { edgeRefs.current[i] = element; }} data-kind={edge.kind}
          data-lit={edge.from === spotlight || edge.to === spotlight || undefined}
          data-dim={spotlight !== null && edge.from !== spotlight && edge.to !== spotlight || undefined}/>)}
      </g>
      {graph.nodes.map((node, i) => {
        const isLit = lit?.has(node.id) ?? false;
        return <g key={node.id} ref={element => { nodeRefs.current[i] = element; }} className="vua-graph__node" data-node-index={i} data-kind={node.kind}
          data-shared={node.kind !== "recipe" && node.recipeIds.length > 1 || undefined} data-selected={node.id === selectedId || undefined}
          data-dim={lit !== null && !isLit || undefined} data-label={labelledByDefault(node, graph.nodes.length) || isLit || undefined}
          role="button" tabIndex={node.id === active ? 0 : -1} aria-pressed={node.id === selectedId} aria-label={describe(node)}
          onPointerEnter={() => setHovered(node.id)} onPointerLeave={() => setHovered(current => (current === node.id ? null : current))}
          onFocus={() => setFocused(node.id)} onBlur={() => setFocused(current => (current === node.id ? null : current))}>
          <circle className="vua-graph__halo" r={NODE_RADIUS[node.kind] + 7}/>
          <NodeShape kind={node.kind}/>
          <g className="vua-graph__icon" transform="translate(-8 -8)"><Icon name={NODE_ICONS[node.kind]} size={16}/></g>
          {node.kind !== "recipe" && node.recipeIds.length > 1 && <g className="vua-graph__count" transform={`translate(${NODE_RADIUS[node.kind] * 0.78} ${-NODE_RADIUS[node.kind] * 0.78})`}>
            <circle r={9}/><text dy="0.35em">{node.recipeIds.length}</text></g>}
          <text className="vua-graph__label" y={NODE_RADIUS[node.kind] + LABEL.gap}>{shortLabel(graphCaption(node))}</text>
        </g>;
      })}
    </g>
  </svg>;
}

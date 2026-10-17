/**
 * A small force-directed simulation for the Recipe graph: repulsion between all nodes, springs along
 * edges, a gentle pull to the centre and soft collision. It cools from `alpha` 1 towards 0 and settles;
 * dragging warms it and pulls the held node towards the pointer on a spring. Positions are
 * deterministic for the same input, so the reduced-motion view settles the same layout at once.
 * The forces live in GRAPH_CONFIG.physics.
 */
import { GRAPH_CONFIG } from "./control-graph-config.ts";

export interface SimLink { readonly source: number; readonly target: number; readonly length: number; readonly strength?: number }
export interface Simulation {
  readonly x: Float64Array; readonly y: Float64Array; readonly vx: Float64Array; readonly vy: Float64Array;
  readonly radius: Float64Array;
  /** How far below its centre a node's room sits, so a caption under the node keeps its space. */
  readonly offsetY: Float64Array;
  readonly links: readonly SimLink[];
  /** Per-link pull split between the two ends, from their degrees. */
  readonly bias: Float64Array;
  /** Default link strength from the degrees: hubs hold less tightly to each neighbour. */
  readonly linkStrength: Float64Array;
  alpha: number;
  alphaTarget: number;
  /** Width over height of the view: the pull to the centre is gentler sideways on a wide view, so the layout takes its shape. */
  aspect: number;
  /** The node held by the pointer and where the pointer is, or -1. */
  held: number; heldX: number; heldY: number;
}

const PHYSICS = GRAPH_CONFIG.physics;

/** Phyllotaxis start positions: the same input always starts, and so settles, the same way. */
export function initialPosition(index: number): { x: number; y: number } {
  const r = PHYSICS.startSpacing * Math.sqrt(0.5 + index);
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
}

export function createSimulation(radii: readonly number[], links: readonly SimLink[], start?: readonly ({ x: number; y: number } | undefined)[], offsets?: readonly number[]): Simulation {
  const n = radii.length;
  const x = new Float64Array(n); const y = new Float64Array(n);
  for (let i = 0; i < n; i += 1) { const p = start?.[i] ?? initialPosition(i); x[i] = p.x; y[i] = p.y; }
  const degree = new Float64Array(n);
  const valid = links.filter(link => link.source >= 0 && link.target >= 0 && link.source < n && link.target < n && link.source !== link.target);
  for (const link of valid) { degree[link.source]! += 1; degree[link.target]! += 1; }
  const bias = new Float64Array(valid.length); const linkStrength = new Float64Array(valid.length);
  valid.forEach((link, i) => {
    const a = degree[link.source]!; const b = degree[link.target]!;
    bias[i] = a / (a + b);
    linkStrength[i] = link.strength ?? 1 / Math.min(a, b);
  });
  return { x, y, vx: new Float64Array(n), vy: new Float64Array(n), radius: Float64Array.from(radii), offsetY: Float64Array.from(radii, (_, i) => offsets?.[i] ?? 0), links: valid, bias, linkStrength,
    alpha: start?.some(Boolean) ? 0.3 : 1, alphaTarget: 0, aspect: 1, held: -1, heldX: 0, heldY: 0 };
}

export function isSettled(sim: Simulation): boolean {
  return sim.held < 0 && sim.alphaTarget === 0 && sim.alpha < PHYSICS.alphaMin;
}

/** Advance one fixed step (1/60 s). */
export function tick(sim: Simulation): void {
  const { x, y, vx, vy, radius, offsetY } = sim;
  const n = x.length;
  sim.alpha += (sim.alphaTarget - sim.alpha) * PHYSICS.alphaDecay;
  const alpha = sim.alpha;
  // Springs along edges.
  sim.links.forEach((link, i) => {
    const s = link.source; const t = link.target;
    let dx = x[t]! + vx[t]! - x[s]! - vx[s]!; let dy = y[t]! + vy[t]! - y[s]! - vy[s]!;
    if (dx === 0 && dy === 0) { dx = 1e-3 * (t - s); dy = 1e-3; }
    const d = Math.hypot(dx, dy);
    const k = ((d - link.length) / d) * alpha * sim.linkStrength[i]!;
    const b = sim.bias[i]!;
    vx[t]! -= dx * k * b; vy[t]! -= dy * k * b;
    vx[s]! += dx * k * (1 - b); vy[s]! += dy * k * (1 - b);
  });
  // Repulsion and soft collision; all pairs fit the 100-node budget.
  const max2 = PHYSICS.chargeDistanceMax * PHYSICS.chargeDistanceMax;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let dx = x[j]! - x[i]!; let dy = y[j]! - y[i]!;
      if (dx === 0 && dy === 0) { dx = 0.31 * (j - i); dy = 0.17 * (i - j); }
      let d2 = dx * dx + dy * dy;
      if (d2 < max2) {
        if (d2 < 36) d2 = Math.sqrt(36 * d2);
        const f = (PHYSICS.charge * alpha) / d2;
        vx[i]! += dx * f; vy[i]! += dy * f;
        vx[j]! -= dx * f; vy[j]! -= dy * f;
      }
      const reach = radius[i]! + radius[j]! + PHYSICS.collidePadding;
      const cy = dy + offsetY[j]! - offsetY[i]!;
      const d = Math.sqrt(dx * dx + cy * cy) || 1e-3;
      if (d < reach) {
        const push = ((reach - d) / d) * PHYSICS.collideStrength;
        const ri = radius[j]! * radius[j]!; const rj = radius[i]! * radius[i]!;
        const share = ri / (ri + rj);
        vx[i]! -= dx * push * share; vy[i]! -= cy * push * share;
        vx[j]! += dx * push * (1 - share); vy[j]! += cy * push * (1 - share);
      }
    }
  }
  for (let i = 0; i < n; i += 1) {
    vx[i]! -= x[i]! * (PHYSICS.gravity / sim.aspect) * alpha;
    vy[i]! -= y[i]! * PHYSICS.gravity * sim.aspect * alpha;
  }
  for (let i = 0; i < n; i += 1) {
    if (i === sim.held) {
      // The held node eases towards the pointer and carries that motion when let go; its neighbours follow on their springs.
      vx[i] = (sim.heldX - x[i]!) * PHYSICS.dragSpring; vy[i] = (sim.heldY - y[i]!) * PHYSICS.dragSpring;
      x[i]! += vx[i]!; y[i]! += vy[i]!;
      continue;
    }
    let sx = vx[i]! * (1 - PHYSICS.velocityDecay); let sy = vy[i]! * (1 - PHYSICS.velocityDecay);
    const speed = Math.hypot(sx, sy);
    if (speed > PHYSICS.maxSpeed) { sx *= PHYSICS.maxSpeed / speed; sy *= PHYSICS.maxSpeed / speed; }
    vx[i] = sx; vy[i] = sy;
    x[i]! += sx; y[i]! += sy;
  }
}

/** Run until the layout settles or `maxTicks` pass; returns the ticks run. */
export function settle(sim: Simulation, maxTicks = 900): number {
  let ticks = 0;
  while (!isSettled(sim) && ticks < maxTicks) { tick(sim); ticks += 1; }
  return ticks;
}

export function reheat(sim: Simulation, alpha = 0.6): void { sim.alpha = Math.max(sim.alpha, alpha); }

export function hold(sim: Simulation, index: number, px: number, py: number): void {
  sim.held = index; sim.heldX = px; sim.heldY = py;
  sim.alphaTarget = PHYSICS.dragAlpha; reheat(sim, PHYSICS.dragAlpha);
}

/** Let go: the node keeps its momentum and the graph cools down again. */
export function release(sim: Simulation): void { sim.held = -1; sim.alphaTarget = 0; }

/** Place a node directly, for the reduced-motion drag. */
export function place(sim: Simulation, index: number, px: number, py: number): void {
  sim.x[index] = px; sim.y[index] = py; sim.vx[index] = 0; sim.vy[index] = 0;
}

export function bounds(sim: Simulation): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < sim.x.length; i += 1) {
    const r = sim.radius[i]!; const cy = sim.y[i]! + sim.offsetY[i]!;
    minX = Math.min(minX, sim.x[i]! - r); maxX = Math.max(maxX, sim.x[i]! + r);
    minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r);
  }
  return sim.x.length === 0 ? { minX: -1, minY: -1, maxX: 1, maxY: 1 } : { minX, minY, maxX, maxY };
}

/** The nearest node from `from` in an arrow-key direction, for keyboard travel across the graph. */
export function nearestInDirection(sim: Simulation, from: number, direction: "left" | "right" | "up" | "down"): number {
  const ax = direction === "left" ? -1 : direction === "right" ? 1 : 0;
  const ay = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  let best = -1; let bestScore = Infinity;
  for (let i = 0; i < sim.x.length; i += 1) {
    if (i === from) continue;
    const dx = sim.x[i]! - sim.x[from]!; const dy = sim.y[i]! - sim.y[from]!;
    const along = dx * ax + dy * ay;
    if (along <= 0) continue;
    const across = Math.abs(dx * ay - dy * ax);
    const score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

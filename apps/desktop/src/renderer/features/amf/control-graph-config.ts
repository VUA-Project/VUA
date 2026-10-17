/**
 * Every tunable number of the Recipe graph in one place: the simulation's forces, how the view
 * steps and frames it, node sizes and caption room. A skin can adjust the graph's feel here; the
 * graph's colors come from the `--vua-graph-*` custom properties in control-center.css.
 */
import type { GraphEdgeKind, GraphNodeKind } from "./control-graph-model.ts";

export const GRAPH_CONFIG = {
  physics: {
    alphaMin: 0.002,
    alphaDecay: 1 - Math.pow(0.002, 1 / 320),
    velocityDecay: 0.32,
    charge: -380,
    chargeDistanceMax: 720,
    gravity: 0.05,
    collidePadding: 6,
    collideStrength: 0.35,
    dragSpring: 0.3,
    dragAlpha: 0.28,
    releaseAlpha: 0.12,
    maxSpeed: 48,
    /** Start positions: phyllotaxis spacing. */
    startSpacing: 18,
  },
  view: {
    stepsPerSecond: 60,
    maxStepsPerFrame: 4,
    cameraEase: 0.16,
    fitPadding: 40,
    maxFitScale: 1.25,
    minScale: 0.2,
    maxScale: 3,
    wheelZoom: 0.0015,
    dragThreshold: 4,
    /** Ticks a reduced-motion drop runs before the layout settles around the dropped node. */
    staticDropTicks: 240,
    /** The layout leans further than the view's own shape (width/height to this power), so wide views fill out. */
    aspectLean: 1.5,
    aspectMin: 0.5,
    aspectMax: 3,
  },
  nodeRadius: { recipe: 24, avatar: 20, outfit: 13, material: 11, package: 14 } satisfies Record<GraphNodeKind, number>,
  linkLength: { avatar: 120, outfit: 92, material: 110, package: 170 } satisfies Record<GraphEdgeKind, number>,
  label: {
    maxChars: 30,
    /** Graphs up to this size show every caption; larger ones show Recipes and Avatars and the lit neighbourhood. */
    allUpTo: 30,
    gap: 16,
    /** Estimated caption widths per character, for the room a caption keeps. */
    latin: 6.6, wide: 12, recipeLatin: 7.4, recipeWide: 13.5,
    roomMax: 84,
    roomOffset: 12,
  },
} as const;

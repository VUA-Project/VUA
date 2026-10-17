import { describe, expect, it } from "vitest";
import { bounds, createSimulation, hold, initialPosition, isSettled, nearestInDirection, place, release, settle, tick, type SimLink } from "./control-physics.ts";

/** A hub with leaves plus a second hub sharing two of them: the shape of two Recipes sharing parts. */
function twoRecipes() {
  const radii = [24, 24, 18, 12, 12, 12, 14, 14];
  const links: SimLink[] = [
    { source: 0, target: 2, length: 110 }, { source: 0, target: 3, length: 80 }, { source: 0, target: 6, length: 150 }, { source: 0, target: 7, length: 150 },
    { source: 1, target: 2, length: 110 }, { source: 1, target: 4, length: 80 }, { source: 1, target: 5, length: 80 }, { source: 1, target: 6, length: 150 },
  ];
  return { radii, links };
}
const distance = (sim: ReturnType<typeof createSimulation>, a: number, b: number) => Math.hypot(sim.x[a]! - sim.x[b]!, sim.y[a]! - sim.y[b]!);

describe("Recipe graph physics", () => {
  it("settles to the same layout every time", () => {
    const { radii, links } = twoRecipes();
    const a = createSimulation(radii, links); const b = createSimulation(radii, links);
    const ticks = settle(a); settle(b);
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(900);
    expect(isSettled(a)).toBe(true);
    expect([...a.x]).toEqual([...b.x]);
    expect([...a.y]).toEqual([...b.y]);
  });

  it("keeps nodes apart and linked nodes close", () => {
    const { radii, links } = twoRecipes();
    const sim = createSimulation(radii, links); settle(sim);
    for (let i = 0; i < radii.length; i += 1) for (let j = i + 1; j < radii.length; j += 1) expect(distance(sim, i, j)).toBeGreaterThan(radii[i]! + radii[j]!);
    // The shared Avatar sits between both Recipes; a leaf of one Recipe stays near it, away from the other.
    expect(distance(sim, 0, 3)).toBeLessThan(distance(sim, 1, 3));
    expect(distance(sim, 1, 4)).toBeLessThan(distance(sim, 0, 4));
  });

  it("spreads the layout sideways on a wide view", () => {
    // Six Recipes with two parts each, sharing four packages.
    const radii = [...Array.from({ length: 6 }, () => 24), ...Array.from({ length: 16 }, () => 12)];
    const links: SimLink[] = [];
    for (let r = 0; r < 6; r += 1) {
      links.push({ source: r, target: 6 + r * 2, length: 90 }, { source: r, target: 7 + r * 2, length: 90 });
      for (let p = 0; p < 4; p += 1) links.push({ source: r, target: 18 + p, length: 150 });
    }
    const shape = (aspect: number) => { const sim = createSimulation(radii, links); sim.aspect = aspect; settle(sim); const box = bounds(sim); return (box.maxX - box.minX) / (box.maxY - box.minY); };
    expect(shape(1.6)).toBeGreaterThan(shape(1) * 1.15);
  });

  it("separates nodes that start on top of each other", () => {
    const sim = createSimulation([20, 20, 20], [], [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
    settle(sim);
    expect(distance(sim, 0, 1)).toBeGreaterThan(40);
    expect(distance(sim, 1, 2)).toBeGreaterThan(40);
  });

  it("pulls a held node towards the pointer on a spring and settles after release", () => {
    const { radii, links } = twoRecipes();
    const sim = createSimulation(radii, links); settle(sim);
    const target = { x: sim.x[3]! + 300, y: sim.y[3]! - 200 };
    hold(sim, 3, target.x, target.y);
    expect(isSettled(sim)).toBe(false);
    tick(sim);
    const first = Math.hypot(sim.x[3]! - target.x, sim.y[3]! - target.y);
    expect(first).toBeLessThan(Math.hypot(300, 200));
    expect(first).toBeGreaterThan(30);
    for (let i = 0; i < 120; i += 1) tick(sim);
    expect(Math.hypot(sim.x[3]! - target.x, sim.y[3]! - target.y)).toBeLessThan(60);
    release(sim);
    settle(sim);
    expect(isSettled(sim)).toBe(true);
  });

  it("keeps previous positions and starts warm when given them", () => {
    const sim = createSimulation([10, 10], [{ source: 0, target: 1, length: 100 }], [{ x: -50, y: 0 }, undefined]);
    expect(sim.x[0]).toBe(-50);
    expect(sim.x[1]).toBe(initialPosition(1).x);
    expect(sim.alpha).toBeLessThan(1);
  });

  it("ignores links that point outside the graph or at themselves", () => {
    const sim = createSimulation([10, 10], [{ source: 0, target: 5, length: 10 }, { source: 1, target: 1, length: 10 }, { source: 0, target: 1, length: 10 }]);
    expect(sim.links).toHaveLength(1);
  });

  it("finds the next node in an arrow-key direction", () => {
    const sim = createSimulation([5, 5, 5, 5], [], [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: -100, y: 0 }, { x: 0, y: 100 }]);
    expect(nearestInDirection(sim, 0, "right")).toBe(1);
    expect(nearestInDirection(sim, 0, "left")).toBe(2);
    expect(nearestInDirection(sim, 0, "down")).toBe(3);
    expect(nearestInDirection(sim, 0, "up")).toBe(-1);
    place(sim, 3, 0, -100);
    expect(nearestInDirection(sim, 0, "up")).toBe(3);
  });

  it("runs a 100-node graph well inside a 60 fps frame", () => {
    const radii = Array.from({ length: 100 }, (_, i) => (i < 20 ? 24 : 12));
    const links: SimLink[] = [];
    for (let r = 0; r < 20; r += 1) for (let k = 0; k < 6; k += 1) links.push({ source: r, target: 20 + ((r * 4 + k) % 80), length: 100 });
    const sim = createSimulation(radii, links);
    const started = performance.now();
    for (let i = 0; i < 120; i += 1) tick(sim);
    expect((performance.now() - started) / 120).toBeLessThan(4);
  });
});

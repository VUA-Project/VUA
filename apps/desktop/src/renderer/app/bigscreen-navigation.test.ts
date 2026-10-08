import { expect, test } from "vitest";
import { directionalTarget } from "./bigscreen-navigation.ts";
test("directional focus stays in the requested half-plane and prefers a row", () => {
  const rects = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 110, y: 300 }, { x: 100, y: 20 }];
  expect(directionalTarget(rects, 0, "ArrowRight")).toBe(1);
  expect(directionalTarget(rects, 0, "ArrowDown")).toBe(2);
  expect(directionalTarget(rects, 0, "ArrowUp")).toBe(3);
  expect(directionalTarget(rects, 0, "ArrowLeft")).toBeNull();
  expect(directionalTarget([], -1, "ArrowRight")).toBeNull();
  expect(directionalTarget(rects, -1, "ArrowRight")).toBe(0);
});

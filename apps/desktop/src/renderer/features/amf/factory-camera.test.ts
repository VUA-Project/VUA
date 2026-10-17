import { describe, expect, it } from "vitest";
import { between, cameraOn, neighbors, OVERVIEW } from "./factory-camera.ts";

describe("factory camera", () => {
  it("centers a room and leaves room for its neighbors", () => {
    const camera = cameraOn({ left: 100, top: 50, width: 400, height: 200 }, { width: 1000, height: 500 }, 0.8);
    expect(camera.scale).toBeCloseTo(2);
    expect(100 * camera.scale + camera.x + 400 * camera.scale / 2).toBeCloseTo(500);
    expect(50 * camera.scale + camera.y + 200 * camera.scale / 2).toBeCloseTo(250);
  });

  it("eases from the overview to a room without overshooting", () => {
    const target = { x: -300, y: -100, scale: 2 };
    expect(between(OVERVIEW, target, 0)).toEqual(OVERVIEW);
    expect(between(OVERVIEW, target, 1)).toEqual(target);
    const middle = between(OVERVIEW, target, 0.5);
    expect(middle.scale).toBeGreaterThan(1); expect(middle.scale).toBeLessThan(2);
    expect(middle.x).toBeCloseTo(-150);
  });

  it("finds rooms beside, above and below", () => {
    const floors = [["control", "materials"], ["release", "workshop"]] as const;
    expect(neighbors(floors, "control")).toEqual({ right: "materials", down: "release" });
    expect(neighbors(floors, "workshop")).toEqual({ left: "release", up: "materials" });
  });
});

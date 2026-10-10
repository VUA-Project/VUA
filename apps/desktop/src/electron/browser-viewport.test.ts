import { describe, expect, it } from "vitest";
import { browserViewportBounds } from "./browser-viewport.js";
describe("native browser viewport", () => {
  it("keeps shell space and converts CSS page zoom to native DIP without applying monitor DPI twice", () => {
    expect(browserViewportBounds({ x: 176, y: 130, width: 824, height: 570 }, 1, { width: 1000, height: 700 })).toEqual({ x: 176, y: 130, width: 824, height: 570 });
    expect(browserViewportBounds({ x: 176, y: 130, width: 824, height: 570 }, 1.25, { width: 1250, height: 875 })).toEqual({ x: 220, y: 163, width: 1030, height: 712 });
  });
  it("clamps a stale resize receipt to the current content and never creates negative area", () => {
    expect(browserViewportBounds({ x: 176, y: 130, width: 1920, height: 1080 }, 1, { width: 640, height: 480 })).toEqual({ x: 176, y: 130, width: 464, height: 350 });
    expect(browserViewportBounds({ x: 900, y: 700, width: 10, height: 10 }, 1, { width: 640, height: 480 })).toEqual({ x: 640, y: 480, width: 0, height: 0 });
  });
});

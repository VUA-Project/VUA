/** A factory room's animated interior. It draws at 30 frames per second while visible and holds a
 * still frame in resource-saving mode. */
import { useEffect, useRef, useState } from "react";
import { SCENE_HEIGHT, SCENE_WIDTH, SCENES, type Palette, type SceneFacts } from "./factory-scenes.ts";

/** Reads a token from the document root, so skins set scene timing and colors in one place. */
export function token(name: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** True while resource-saving mode is off (it sets data-effects="off" on the document). */
export function useEffectsOn(): boolean {
  const read = () => document.documentElement.dataset.effects !== "off";
  const [on, setOn] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setOn(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-effects"] });
    return () => observer.disconnect();
  }, []);
  return on;
}

function palette(element: Element): Palette {
  const style = getComputedStyle(element);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    room: v("--room", "#ff7a45"), panel: v("--vua-bg-panel", "#16141f"), elevated: v("--vua-bg-elevated", "#1f1c2b"),
    border: v("--vua-border-strong", "#3a3550"), strong: v("--vua-text-strong", "#f3f2f8"), text: v("--vua-text-secondary", "#a9a6b8"),
    muted: v("--vua-border", "#2a2638"), success: v("--vua-success", "#4ade80"), warning: v("--vua-warning", "#facc15"),
    error: v("--vua-error", "#f87171"), accent: v("--vua-accent", "#ff7a45"), skin: v("--vua-scene-skin", "#f4cdb0"), hair: v("--vua-text-strong", "#f3f2f8"),
  };
}

export function RoomCanvas({ room, facts, zoom = 1 }: { room: keyof typeof SCENES; facts: SceneFacts; zoom?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const animated = useEffectsOn();
  const latest = useRef(facts); latest.current = facts;
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = canvas.current?.parentElement; if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current; if (!element || size.width === 0 || size.height === 0) return;
    // The backing store follows the camera zoom so a magnified room stays sharp.
    const density = Math.min(3, (window.devicePixelRatio || 1) * Math.max(1, zoom));
    element.width = Math.round(size.width * density); element.height = Math.round(size.height * density);
    const ctx = element.getContext("2d"); if (!ctx) return;
    let colors = palette(element); let colorsAt = performance.now();
    const fit = Math.min(size.width / SCENE_WIDTH, size.height / SCENE_HEIGHT);
    const offsetX = (size.width - SCENE_WIDTH * fit) / 2; const offsetY = size.height - SCENE_HEIGHT * fit;
    const draw = (now: number) => {
      if (now - colorsAt > 1000) { colors = palette(element); colorsAt = now; }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, element.width, element.height);
      ctx.setTransform(density * fit, 0, 0, density * fit, density * offsetX, density * offsetY);
      SCENES[room](ctx, colors, latest.current, now / 1000, -offsetY / fit);
    };
    if (!animated) { draw(0); return; }
    const frameMs = 1000 / token("--vua-scene-fps", 30);
    let frame = 0; let last = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden || now - last < frameMs) return;
      last = now; draw(now);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [room, size, zoom, animated]);

  // A still frame redraws when the facts change.
  useEffect(() => {
    if (animated) return;
    const element = canvas.current; const ctx = element?.getContext("2d"); if (!element || !ctx || size.width === 0) return;
    const density = element.width / size.width; const fit = Math.min(size.width / SCENE_WIDTH, size.height / SCENE_HEIGHT);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, element.width, element.height);
    ctx.setTransform(density * fit, 0, 0, density * fit, density * (size.width - SCENE_WIDTH * fit) / 2, density * (size.height - SCENE_HEIGHT * fit));
    SCENES[room](ctx, palette(element), facts, 0, -(size.height - SCENE_HEIGHT * fit) / fit);
  }, [animated, facts, room, size]);

  return <canvas ref={canvas} className="vua-factory__canvas" aria-hidden="true" style={{ width: "100%", height: "100%" }}/>;
}

export type Direction = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
export interface FocusRect { x: number; y: number }
/** Nearest target in the requested half-plane, with a preference for the same row/column. */
export function directionalTarget(rects: readonly FocusRect[], current: number, direction: Direction): number | null {
  const origin = rects[current];
  if (!origin) return rects.length ? 0 : null;
  let best: number | null = null;
  let score = Infinity;
  rects.forEach((r, index) => {
    if (index === current) return;
    const dx = r.x - origin.x, dy = r.y - origin.y;
    const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
    const along = (horizontal ? dx : dy) * (direction === "ArrowLeft" || direction === "ArrowUp" ? -1 : 1);
    const across = Math.abs(horizontal ? dy : dx);
    if (along <= 1) return;
    const value = along + across * 3;
    if (value < score) { score = value; best = index; }
  });
  return best;
}
export function visibleControls(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], summary, input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']"))
    .filter(el => !el.closest("[hidden], [inert], [aria-hidden='true']") && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
}

import type { DesktopBrowserViewportV1 } from "@vua/contracts";

/** Native content bounds are DIP; DOM layout is CSS pixels at the current page zoom. */
export function browserViewportBounds(viewport: DesktopBrowserViewportV1, zoom: number, window: { width: number; height: number }) {
  const x = Math.min(window.width, Math.max(0, Math.round(viewport.x * zoom)));
  const y = Math.min(window.height, Math.max(0, Math.round(viewport.y * zoom)));
  return { x, y, width: Math.max(0, Math.min(window.width - x, Math.round(viewport.width * zoom))),
    height: Math.max(0, Math.min(window.height - y, Math.round(viewport.height * zoom))) };
}

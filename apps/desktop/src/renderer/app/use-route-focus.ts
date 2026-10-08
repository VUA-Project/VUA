import { useEffect, useRef, type MouseEvent } from "react";
import { visibleControls } from "./bigscreen-navigation.ts";
/** Restore the source tile on Back. Desktop pointer use keeps the browser's normal focus. */
export function useRouteFocus(view: string) {
  const root = useRef<HTMLDivElement | null>(null);
  const memory = useRef(new Map<string, string>());
  const remember = (event: MouseEvent<HTMLElement>) => {
    const id = (event.target as HTMLElement).closest("[data-nav-id]")?.getAttribute("data-nav-id");
    if (id) memory.current.set(view, id);
  };
  useEffect(() => {
    if (!root.current?.closest("[data-display-mode='bigscreen']")) return;
    const frame = requestAnimationFrame(() => {
      if (!root.current || root.current.closest("[hidden]")) return;
      const controls = visibleControls(root.current);
      const preferred = memory.current.get(view);
      (controls.find(el => el.dataset.navId === preferred) ?? controls[0])?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);
  return { root, remember };
}

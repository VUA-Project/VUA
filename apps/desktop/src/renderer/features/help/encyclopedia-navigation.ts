import type { GuideTargetV1 } from "@vua/contracts";

/** Local renderer fallback also makes the ordinary browser preview navigable. */
export const ENCYCLOPEDIA_EVENT = "vua:open-encyclopedia";
export function openEncyclopedia(target: GuideTargetV1 | null = null): void {
  if (window.vua) void window.vua.window.showEncyclopedia(target);
  else window.dispatchEvent(new CustomEvent(ENCYCLOPEDIA_EVENT, { detail: target }));
}

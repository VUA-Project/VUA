import type { GuideTargetV1 } from "@vua/contracts";
import { parseGuideTargetFromSearch, type GuideTarget } from "../guide/guide-target.ts";

export function readEncyclopediaHash(hash: string): GuideTarget | null {
  const [page, query] = hash.replace(/^#\/?/, "").split("?");
  return page === "help-encyclopedia" && query ? parseGuideTargetFromSearch(`?${query}`) : null;
}
export function recordEncyclopediaTarget(target: GuideTarget, replace = false): void {
  const query = new URLSearchParams({ guideTopic: target.topic, ...(target.section ? { guideSection: target.section } : {}) });
  const hash = `#help-encyclopedia?${query}`;
  if (window.location.hash === hash) return;
  if (replace) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hash}`);
  else window.location.hash = hash;
}

/** Local renderer fallback also makes the ordinary browser preview navigable. */
export const ENCYCLOPEDIA_EVENT = "vua:open-encyclopedia";
export function openEncyclopedia(target: GuideTargetV1 | null = null): void {
  if (window.vua) void window.vua.window.showEncyclopedia(target);
  else window.dispatchEvent(new CustomEvent(ENCYCLOPEDIA_EVENT, { detail: target }));
}

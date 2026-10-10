/** Contextual static help opens the main-window encyclopedia. Targets are consumed
 * once; opening without one restores the reading bookmark. A missing mapping hides
 * the entry. Reading neither requires a detection capability nor proves completion.
 * The browser preview uses the same page navigation through a local UI event. */
import { Button } from "../../components/primitives/Button.tsx";
import type { GuideTarget } from "./guide-target.ts";
import { openEncyclopedia } from "../help/encyclopedia-navigation.ts";

export function GuideEntryButton({
  target,
  label,
}: {
  target: GuideTarget | null;
  label: string;
}) {
  if (target === null) return null;
  return (
    <Button
      variant="subtle"
      data-guide-entry={target.section ?? target.topic}
      onClick={() => openEncyclopedia(target)}
    >
      {label}
    </Button>
  );
}

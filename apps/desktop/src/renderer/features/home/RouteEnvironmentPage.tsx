import { useState } from "react";
import { strings } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { GUIDE_TARGETS } from "../guide/guide-target.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { PlayPage } from "./PlayPage.tsx";
import { CreatorPage } from "./CreatorPage.tsx";
const copy = strings.journey;
export function PlayLaunch({ onAccounts }: { onAccounts: () => void }) {
  const [opened, setOpened] = useState(false);
  return <section className="vua-journey-actions">
    <h2>{copy.launch}</h2><p>{copy.launchHint}</p>
    <Button variant="primary" onClick={() => { void openExternalUrl("steam://nav/games/details/438100"); setOpened(true); }}>{copy.openSteam}</Button>
    {opened ? <p role="status">{copy.manualLaunch}</p> : null}
    <Button onClick={onAccounts} data-nav-id="play-accounts">{copy.accounts}</Button>
    <GuideEntryButton target={GUIDE_TARGETS.vrchatFirstLaunch} label={copy.guide} />
    <Button onClick={() => void window.vua?.window.showGameGuide()}>{copy.gameGuide}</Button>
  </section>;
}
/** Fixed feature routes are independent of wizard choices. */
export function RouteEnvironmentPage({ zone, onAccounts, onOpenAmf }: { zone: "play" | "create"; onAccounts: () => void; onOpenAmf: () => void }) {
  return zone === "play" ? <PlayPage onAccounts={onAccounts} /> : <CreatorPage onOpenAmf={onOpenAmf} />;
}

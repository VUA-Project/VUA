import { useState } from "react";
import type { DeploymentPurpose } from "@vua/contracts";
import { strings } from "../../i18n/index.ts";
import { RouteTile } from "../../components/RouteTile.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { DeploymentPanel } from "../deployer/DeploymentPanel.tsx";
import { NetworkPanel } from "../deployer/NetworkPanel.tsx";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { GUIDE_TARGETS } from "../guide/guide-target.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { useRouteFocus } from "../../app/use-route-focus.ts";
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
/** Fixed feature route. Its selection and facts never depend on the wizard. */
export function RouteEnvironmentPage({ zone, onAccounts }: { zone: "play" | "create"; onAccounts: () => void }) {
  const [purpose, setPurpose] = useState<DeploymentPurpose | null>(null);
  const [stage, setStage] = useState<"pick" | "prepare" | "connect" | "launch">("pick");
  const [ready, setReady] = useState(false);
  const focus = useRouteFocus(stage);
  const choose = (p: DeploymentPurpose) => { setPurpose(p); setReady(false); setStage("prepare"); };
  const back = () => {
    if (stage === "launch" && purpose === "pico_pcvr") setStage("connect");
    else if (stage === "launch" || stage === "connect") { setReady(false); setStage("prepare"); }
    else { setStage("pick"); setPurpose(null); setReady(false); }
  };
  return <div className="vua-page vua-route-page" data-route-stage={stage} ref={focus.root} onClickCapture={focus.remember}>
    <header className="vua-page__hero"><h1 className="vua-title">{zone === "play" ? copy.play : copy.create}</h1></header>
    {stage === "pick" ? <div className="vua-route-grid vua-route-grid--devices">
      {zone === "play" ? <>
        <RouteTile title={copy.desktop} kind="screen" onClick={() => choose("desktop_play")} id="route-desktop" />
        <RouteTile title="PICO" kind="headset" onClick={() => choose("pico_pcvr")} id="route-pico" />
        {["Meta Quest", "HTC VIVE", "Valve Index"].map(title => <RouteTile title={title} key={title} kind="headset" disabled />)}
      </> : <>
        <RouteTile title={copy.unity2022} kind="unity" onClick={() => choose("pc_avatar")} id="route-unity2022" />
        <RouteTile title={copy.unity6} kind="unity" disabled />
      </>}
    </div> : <>
      <Button variant="subtle" data-back onClick={back}>{copy.back}</Button>
      {purpose ? <>
        {stage === "prepare" ? <>
          {zone === "play" ? <details className="vua-route-network"><summary>{copy.network}</summary><NetworkPanel /></details> : <div className="vua-route-platform"><Button aria-pressed={purpose === "pc_avatar"} onClick={() => choose("pc_avatar")}>{copy.pcAvatar}</Button><Button aria-pressed={purpose === "quest_avatar"} onClick={() => choose("quest_avatar")}>{copy.questAvatar}</Button></div>}
          <DeploymentPanel key={purpose} zone={zone} purpose={purpose} onReadyChange={setReady} />
          {ready ? <><p>{zone === "play" ? copy.softwareReady : copy.creatorReady}</p>{zone === "play" ? <Button variant="primary" onClick={() => setStage(purpose === "pico_pcvr" ? "connect" : "launch")}>{copy.preparedNext}</Button> : null}</> : null}
        </> : null}
        {stage === "connect" ? <section className="vua-journey-actions"><h2>{copy.connection}</h2>
          <GuideEntryButton target={GUIDE_TARGETS.picoUsb} label={copy.usb} /><GuideEntryButton target={GUIDE_TARGETS.picoWifi} label={copy.wifi} />
          <p>{copy.declared}</p><Button variant="primary" onClick={() => setStage("launch")}>{copy.connectionConfirm}</Button>
        </section> : null}
        {stage === "launch" ? <PlayLaunch onAccounts={onAccounts} /> : null}
      </> : null}
    </>}
  </div>;
}

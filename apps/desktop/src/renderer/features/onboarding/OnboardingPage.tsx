import { useAmfModule } from "../../gateway/index.ts";
import { ModulesPage } from "../modules/ModulesPage.tsx";
import { useEffect, useState } from "react";
import type { DeploymentPurpose } from "@vua/contracts";
import type { EnvGoalId, GoalId } from "../../app/onboarding-model.ts";
import type { PageId } from "../../app/nav-model.ts";
import { storageKeys } from "../../app/storage-keys.ts";
import { useRouteFocus } from "../../app/use-route-focus.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { RouteTile } from "../../components/RouteTile.tsx";
import { strings } from "../../i18n/index.ts";
import { DeploymentPanel } from "../deployer/DeploymentPanel.tsx";
import { NetworkPanel } from "../deployer/NetworkPanel.tsx";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { GUIDE_TARGETS } from "../guide/guide-target.ts";
import { PlayLaunch } from "../home/RouteEnvironmentPage.tsx";
import { initialJourney, journeyBack, parseJourney, type JourneyStep } from "./journey-model.ts";
import "./onboarding.css";
const copy = strings.journey;
export interface OnboardingResult {
  status: "completed" | "skipped"; goals: GoalId[]; environments: EnvGoalId[]; page?: PageId;
}
export function OnboardingPage({ onComplete, onAccounts }: {
  onComplete: (result: OnboardingResult) => void; onAccounts: () => void;
}) {
  const amf = useAmfModule();
  const [state, setState] = useState(() => { try { return parseJourney(localStorage.getItem(storageKeys.firstRunJourney)); } catch { return initialJourney; } });
  const [ready, setReady] = useState(false);
  const focus = useRouteFocus(state.step);
  useEffect(() => { try { localStorage.setItem(storageKeys.firstRunJourney, JSON.stringify(state)); } catch { /* Session progress remains usable. */ } }, [state]);
  const move = (step: JourneyStep, purpose = state.purpose) => {
    setReady(false);
    setState(s => ({ ...s, step, purpose, connection: purpose === "pico_pcvr" ? s.connection : null }));
  };
  const done = (page?: PageId) => {
    try { localStorage.setItem(storageKeys.firstRunJourney, JSON.stringify(initialJourney)); } catch { /* Completion remains usable without storage. */ }
    setState(initialJourney);
    onComplete({ status: "completed", goals: ["env", "production"], environments: ["play", "create"], ...(page ? { page } : {}) });
  };
  const choose = (title: string, description: string, step: JourneyStep, purpose?: DeploymentPurpose, kind?: "screen" | "headset" | "unity") =>
    <RouteTile title={title} description={description} {...(kind ? { kind } : {})} onClick={() => move(step, purpose ?? null)} id={`wizard-${step}-${purpose ?? title}`} />;
  const steps = copy.steps;
  const phase = ["network", "prepare"].includes(state.step) ? 1 : ["connection", "launch", "creator-done", "library"].includes(state.step) ? 2 : 0;
  const title = ({ goal: copy.goal, "play-mode": copy.playMode, headset: copy.headset, "creator-start": amf.state === "ready" ? copy.creatorStart : strings.amfModule.choose,
    target: copy.target, editor: copy.editor, network: copy.network, prepare: copy.prepare, connection: copy.connection,
    launch: copy.launch, library: copy.assetsGoal, "creator-done": copy.creatorReady })[state.step];
  const hints: Partial<Record<JourneyStep, string>> = { goal: copy.goalHint, editor: copy.editorHint, network: copy.networkHint, prepare: copy.prepareHint, library: copy.assetsHint };
  return <div className="vua-onboarding" data-wizard-step={state.step}>
    <div className="vua-onboarding__panel">
      <div className="vua-journey-top"><span>{copy.wizard}</span><Button variant="subtle" onClick={() => onComplete({ status: "skipped", goals: [], environments: [] })}>{copy.exit}</Button></div>
      <nav aria-label={copy.wizard}><ol className="vua-journey-phases">{steps.map((label, index) => <li key={label} aria-current={phase === index ? "step" : undefined}><span>{index + 1}</span>{label}</li>)}</ol></nav>
      <header className="vua-onboarding__header"><h1 className="vua-display">{title}</h1>{hints[state.step] ? <p className="vua-text-secondary">{hints[state.step]}</p> : null}</header>
      <div key={state.step} ref={focus.root} onClickCapture={focus.remember} className="vua-journey-content vua-page-enter" data-focus-scope>
        {state.step === "goal" ? <div className="vua-route-grid">
          {choose(copy.playGoal, copy.playHint, "play-mode", undefined, "screen")}
          {choose(copy.createGoal, copy.createHint, "creator-start", undefined, "unity")}
        </div> : null}
        {state.step === "play-mode" ? <div className="vua-route-grid">
          {choose(copy.desktop, copy.desktopHint, "network", "desktop_play", "screen")}
          {choose(copy.vr, copy.vrHint, "headset", undefined, "headset")}
        </div> : null}
        {state.step === "headset" ? <HeadsetChoices onPico={() => move("network", "pico_pcvr")} /> : null}
        {state.step === "creator-start" && amf.state !== "ready" ? <ModulesPage embedded onOpen={() => move("library")} /> : null}
        {state.step === "creator-start" && amf.state === "ready" ? <div className="vua-route-grid">
          {choose(copy.assetsGoal, copy.assetsHint, "library")}{choose(copy.environmentGoal, copy.environmentHint, "target", undefined, "unity")}
        </div> : null}
        {state.step === "target" ? <div className="vua-route-grid">
          {choose(copy.pcAvatar, copy.pcHint, "editor", "pc_avatar", "screen")}{choose(copy.questAvatar, copy.questHint, "editor", "quest_avatar", "headset")}
        </div> : null}
        {state.step === "editor" ? <div className="vua-route-grid">
          <RouteTile title={copy.unity2022} kind="unity" onClick={() => move("prepare")} id="wizard-unity2022" />
          <RouteTile title={copy.unity6} kind="unity" disabled />
        </div> : null}
        {state.step === "network" ? <><NetworkPanel /><Button variant="primary" onClick={() => move("prepare")}>{copy.networkContinue}</Button></> : null}
        {state.step === "prepare" && state.purpose ? <>
          <DeploymentPanel key={state.purpose} zone={state.purpose.includes("avatar") ? "create" : "play"} purpose={state.purpose} onReadyChange={setReady} />
          {ready ? <Button variant="primary" onClick={() => move(state.purpose === "pico_pcvr" ? "connection" : state.purpose === "desktop_play" ? "launch" : "creator-done")}>{copy.preparedNext}</Button> : null}
        </> : null}
        {state.step === "connection" ? <><div className="vua-route-grid">
          <RouteTile title={copy.usb} description={copy.usbHint} kind="headset" selected={state.connection === "usb"} id="wizard-usb" onClick={() => setState(s => ({ ...s, connection: "usb" }))} />
          <RouteTile title={copy.wifi} description={copy.wifiHint} icon="cloud" selected={state.connection === "wifi"} id="wizard-wifi" onClick={() => setState(s => ({ ...s, connection: "wifi" }))} />
        </div>{state.connection ? <div className="vua-journey-actions">
          <GuideEntryButton target={state.connection === "usb" ? GUIDE_TARGETS.picoUsb : GUIDE_TARGETS.picoWifi} label={copy.guide} />
          <p>{copy.declared}</p><Button variant="primary" onClick={() => move("launch")}>{copy.connectionConfirm}</Button>
        </div> : null}</> : null}
        {state.step === "launch" ? <><PlayLaunch onAccounts={onAccounts} /><Button variant="subtle" onClick={() => done("home")}>{copy.finish}</Button></> : null}
        {state.step === "library" && amf.state !== "ready" ? <ModulesPage embedded onOpen={() => done("warehouse")} /> : null}
        {state.step === "library" && amf.state === "ready" ? <Button variant="primary" onClick={() => done("warehouse")}>{copy.openLibrary}</Button> : null}
        {state.step === "creator-done" ? <Button variant="primary" onClick={() => done("home")}>{copy.finish}</Button> : null}
      </div>
      <footer className="vua-onboarding__footer">
        {state.step !== "goal" ? <Button variant="subtle" data-back onClick={() => move(journeyBack(state))}>{copy.back}</Button> : <span />}
        {state.step !== "goal" ? <Button variant="subtle" onClick={() => { setReady(false); setState(initialJourney); }}>{copy.restart}</Button> : null}
      </footer>
    </div>
  </div>;
}
export function HeadsetChoices({ onPico }: { onPico: () => void }) {
  return <div className="vua-route-grid vua-route-grid--devices">
    <RouteTile title="PICO" brand="pico" onClick={onPico} id="headset-pico" />
    <RouteTile title="Meta Quest" brand="meta" disabled />
    <RouteTile title="HTC VIVE" brand="htcvive" disabled />
    <RouteTile title="Valve Index" brand="valve" disabled />
  </div>;
}

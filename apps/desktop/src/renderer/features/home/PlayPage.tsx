/** Launch: what to play and how, then the next step. The chosen combination is one card; its left half opens the
 * choices and the steps, its right half is the one button. A player who has chosen sees just the card. */
import { useCallback, useEffect, useRef, useState } from "react";
import { PLAY_ROUTES, type PlayRoute } from "@vua/contracts";
import { currentLocale, strings } from "../../i18n/index.ts";
import { playFlowCopy } from "../../i18n/play-flow-copy.ts";
import { plannedRoutesCopy } from "../../i18n/planned-routes-copy.ts";
import { playSetupCopy } from "../../i18n/play-setup-copy.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { SegmentBar } from "../../components/SegmentBar.tsx";
import { SlideDrawer } from "../../components/SlideDrawer.tsx";
import { RouteGlyph } from "../../components/RouteTile.tsx";
import { useEnvironmentView, useGateway, type EnvironmentView } from "../../gateway/index.ts";
import { CHECK_GROUPS } from "../deployer/deployer-model.ts";
import { EnvironmentCard, type EnvironmentAction } from "./EnvironmentCard.tsx";
import { takeRequestedPlayRoute } from "./play-route-request.ts";
import { usePlaySessions } from "./use-play-sessions.ts";
import { PlayRouteFlow, type PlayFlowStep } from "./PlayRouteFlow.tsx";
import { GuidedFlow, HeadsetFlow } from "./PlaySetupFlow.tsx";
import { useEscapeClose } from "../../components/use-escape-close.ts";
import { connectionsFor, detectedSetup, devicesFor, normalizeSetup, PC_SETUP, PLATFORM_NAMES, PLATFORMS, PLAY_CONNECTIONS, playDevice, readPlaySetup, recommendedConnection, rememberPlaySetup, setupEngine, setupForRoute, type PlayDevice, type PlaySetup } from "./play-setup-model.ts";
import { connectionName, connectionWords, deviceHint, deviceName, setupTitle } from "./play-setup-text.ts";
import type { PlayFlowPhase } from "./play-flow-model.ts";
import "./play-flow.css";

const copy = strings.environmentCards;
/** The card's glyph for a step; the other steps name themselves with an icon. */
const stepAction = (phase: PlayFlowPhase | undefined): EnvironmentAction =>
  phase === "launch" ? "start" : phase === "stop" ? "stop" : phase === "unavailable" ? "unknown" : phase === "check" || phase === "confirm" || phase === "execute" || phase === "handoff" || phase === "retry" ? "prepare" : "busy";
/** Steps the player takes next stand out; a running session's Close and work in progress stay quiet. */
const stepIsPrimary = (step: PlayFlowStep | undefined) => step !== undefined && !step.spinning && step.phase !== "stop" && step.phase !== "unavailable";

const cardId = (setup: PlaySetup) => { const engine = setupEngine(setup); return engine.kind === "route" ? engine.route === "desktop_play" ? "route-desktop" : "route-pico" : `route-${setup.device}`; };

/** The device scan runs once per app session when the page first opens; the refresh button runs it again. */
let devicesScanned = false;
function useDeviceScan() {
  const gateway = useGateway(), view = useEnvironmentView();
  const [fresh, setFresh] = useState<EnvironmentView | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try { setFresh(await gateway.environment.runCheck("play")); } catch { /* The last observed devices stay shown. */ }
    finally { setBusy(false); }
  }, [gateway]);
  useEffect(() => { if (!devicesScanned) { devicesScanned = true; void run(); } }, [run]);
  const phase = (fresh ?? view).deployer.zones.play;
  const evidence = phase.kind === "results" ? phase : phase.kind === "not-run" ? null : phase.last;
  const members: readonly string[] = CHECK_GROUPS[0].memberIds;
  const devices = evidence?.items.filter(item => members.includes(item.id) && item.status === "ok") ?? [];
  return { run, busy: busy || phase.kind === "running", scanned: evidence !== null, devices };
}

function SetupChoices({ setup, detected, onChoose }: { setup: PlaySetup; detected: readonly string[]; onChoose: (next: Partial<PlaySetup>) => void }) {
  const words = playSetupCopy[currentLocale];
  const planned = plannedRoutesCopy[currentLocale];
  const devices = devicesFor(setup.platform);
  const current = playDevice(setup.device);
  const [showOther, setShowOther] = useState(current.other === true);
  useEffect(() => { if (current.other) setShowOther(true); }, [current.other]);
  const connections = connectionsFor(setup.platform, setup.device);
  const found = (device: PlayDevice) => device.connections.some(id => { const component = PLAY_CONNECTIONS[id].component; return component !== null && component !== "steamvr" && detected.includes(component); });
  const tile = (device: PlayDevice) => <button key={device.id} type="button" className="vua-setup__device" aria-pressed={device.id === setup.device} data-nav-id={`play-device-${device.id}`} onClick={() => onChoose({ device: device.id, connection: recommendedConnection(connectionsFor(setup.platform, device.id), detected) })}>
    <RouteGlyph brand={device.brand} kind={device.kind ?? "headset"} />
    <span><strong>{deviceName(device)}</strong>{deviceHint(device.id) ? <small>{deviceHint(device.id)}</small> : null}</span>
    {found(device) ? <i className="vua-setup__found" title={words.detected} aria-label={words.detected} /> : null}
  </button>;
  return <div className="vua-setup" data-tour-anchor="play-environments">
    <div className="vua-setup__row">
      <span className="vua-setup__label">{words.platform}</span>
      <span className="vua-setup__platforms vua-segments" role="group" aria-label={words.platform}>
        <SegmentBar selected={setup.platform} />
        {PLATFORMS.map(id => <button key={id} type="button" aria-pressed={id === setup.platform} data-nav-id={`play-platform-${id}`} onClick={() => onChoose({ platform: id })}>{PLATFORM_NAMES[id]}</button>)}
      </span>
    </div>
    <div className="vua-setup__row">
      <span className="vua-setup__label">{words.device}</span>
      <div className="vua-setup__devices">
        {devices.filter(device => !device.other).map(tile)}
        <button type="button" className="vua-setup__device vua-setup__more" aria-expanded={showOther} data-nav-id="play-other-headsets" onClick={() => setShowOther(value => !value)}><strong>{planned.otherHeadsets}</strong></button>
        {showOther ? devices.filter(device => device.other).map(tile) : null}
      </div>
    </div>
    {connections.length > 1 ? <div className="vua-setup__row">
      <span className="vua-setup__label">{words.connection}</span>
      <div className="vua-setup__connections" role="radiogroup" aria-label={words.connection}>
        {connections.map(id => {
          const text = connectionWords(id);
          const component = PLAY_CONNECTIONS[id].component;
          return <label key={id} className="vua-setup__connection" title={text.summary} data-checked={id === setup.connection || undefined}>
            <input type="radio" name="vua-play-connection" checked={id === setup.connection} data-nav-id={`play-connection-${id}`} onChange={() => onChoose({ connection: id })} />
            <strong>{connectionName(id)}</strong>
            <small>{component !== null && component !== "steamvr" && detected.includes(component) ? words.detected : text.tag}</small>
          </label>;
        })}
      </div>
    </div> : null}
    {setup.connection !== null ? <p className="vua-setup-summary">{connectionWords(setup.connection).summary}</p> : null}
  </div>;
}

export function PlayPage({ onAccounts }: { onAccounts: () => void }) {
  const flowCopy = playFlowCopy[currentLocale];
  const words = playSetupCopy[currentLocale];
  const [requestedRoute] = useState(takeRequestedPlayRoute);
  const [remembered] = useState(readPlaySetup);
  const [setup, setSetup] = useState<PlaySetup>(() => requestedRoute !== null ? setupForRoute(requestedRoute) : remembered ?? PC_SETUP);
  // Once the player has chosen, what the computer has installed no longer changes the choice.
  const [chosen, setChosen] = useState(remembered !== null || requestedRoute !== null);
  const [expanded, setExpanded] = useState(remembered === null || requestedRoute !== null);
  const [steps, setSteps] = useState<Partial<Record<PlayRoute, PlayFlowStep>>>({});
  const [guidedStep, setGuidedStep] = useState<PlayFlowStep | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const dismissed = useRef(false);
  const close = useCallback(() => { dismissed.current = true; setExpanded(false); }, []);
  const toggleDetails = useCallback(() => setExpanded(value => { const nextValue = !value; dismissed.current = !nextValue; return nextValue; }), []);
  const live = usePlaySessions();
  const scan = useDeviceScan();
  const detected = scan.devices.map(item => item.id);
  const detectedKey = detected.join(" ");
  useEscapeClose(expanded, close);
  useEffect(() => {
    if (chosen || !scan.scanned) return;
    const found = detectedSetup(detected);
    if (found !== null) setSetup(found);
  }, [chosen, scan.scanned, detectedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const engine = setupEngine(setup);
  const route = engine.kind === "route" ? engine.route : null;
  const choose = (next: Partial<PlaySetup>) => {
    const value = normalizeSetup({ ...setup, ...next });
    setSetup(value); rememberPlaySetup(value); setChosen(true); setGuidedStep(null);
  };
  const desktopStep = useCallback((step: PlayFlowStep) => setSteps(p => ({ ...p, desktop_play: step })), []);
  const picoStep = useCallback((step: PlayFlowStep) => setSteps(p => ({ ...p, pico_pcvr: step })), []);
  const step = route !== null ? steps[route] : engine.kind === "tool" ? guidedStep ?? undefined : undefined;
  const next = () => {
    dismissed.current = false;
    if (engine.kind === "headset") { setExpanded(true); return; }
    if (!step || (step.needsDetails && !expanded)) { setExpanded(true); return; }
    if (step.phase === "launch") { rememberPlaySetup(setup); setChosen(true); }
    step.act();
  };
  // A failure or an official page to open is explained in the details, so they open with it
  // unless the player explicitly dismissed the drawer.
  const phase = step?.phase;
  const issue = route !== null ? live.sessions[route]?.issue : undefined;
  useEffect(() => { if (!dismissed.current && (phase === "retry" || phase === "handoff" || issue)) setExpanded(true); }, [phase, issue]);
  const refresh = () => { dismissed.current = false; void scan.run(); void live.refresh(); setRefreshToken(value => value + 1); };
  const device = playDevice(setup.device);
  const title = setupTitle(setup);
  const otherRunning = PLAY_ROUTES.filter(other => other !== route && live.sessions[other]?.canStop);
  const headset = engine.kind === "headset";
  const ready = phase === "launch" || phase === "stop";
  const label = phase === "confirm" && expanded ? flowCopy.confirmContinue : step?.label ?? copy.checking;

  return <div className="vua-page vua-route-page vua-play-page vua-compact-environments" data-route-stage={expanded ? "prepare" : "pick"}>
    <header className="vua-page__hero vua-environment-heading">
      <h1 className="vua-title">{strings.journey.launchPage}</h1>
      <Button variant="subtle" data-nav-id="play-refresh-devices" disabled={scan.busy} aria-busy={scan.busy} onClick={refresh}>{scan.busy ? flowCopy.detecting : flowCopy.refreshDevices}</Button>
    </header>
    <div className="vua-play-current vua-card-entry" data-card-entry={cardId(setup)}>
      <EnvironmentCard title={title} hint={ready && !expanded ? words.ready : words.changeHint} brand={device.brand} kind={device.brand ? undefined : device.kind ?? "headset"} id={cardId(setup)}
        action={headset ? "unknown" : stepAction(phase)} actionIcon={phase === "launch" || phase === "stop" ? undefined : step?.icon} phase={phase}
        status={headset ? "" : label} actionText={headset ? words.inHeadset : undefined} actionHint={headset ? words.inHeadset : phase === "launch" || phase === "stop" ? undefined : label}
        spinning={!headset && (step === undefined || step.spinning)} disabled={!headset && (step === undefined || step.disabled)} primary={stepIsPrimary(step)} progress={step?.percent}
        warning={issue !== undefined && issue !== null} selected={expanded} onDetails={toggleDetails} onAction={next} />
    </div>
    {otherRunning.map(other => <p key={other} className="vua-setup-other" role="status">
      <span>{other === "desktop_play" ? deviceName(playDevice("pc")) : "PICO"} · {strings.toolConnection.running}</span>
      <Button variant="subtle" data-nav-id={`play-stop-${other}`} onClick={() => { void live.act(other, true); }}>{flowCopy.phases.stop}</Button>
    </p>)}
    <SlideDrawer open={expanded} className="vua-play-drawer" label={title}>
      <SetupChoices setup={setup} detected={detected} onChoose={choose} />
      <h2 className="vua-setup__title">{words.stepsTitle}</h2>
      {PLAY_ROUTES.map(item => <div key={item} id={`${item === "desktop_play" ? "route-desktop" : "route-pico"}-details`} hidden={route !== item}>
        <PlayRouteFlow route={item} session={live.sessions[item] ?? null} unavailable={!!live.unavailable[item]} launchPending={!!live.pending[item]}
          refreshToken={refreshToken} onLaunch={stop => { void live.act(item, stop); }} onAccounts={onAccounts} onStep={item === "desktop_play" ? desktopStep : picoStep} />
      </div>)}
      {engine.kind === "tool" ? <div id={`${cardId(setup)}-details`}><GuidedFlow key={`${setup.platform}:${setup.device}:${setup.connection ?? ""}`} setup={setup} toolId={engine.toolId} detected={detected} refreshToken={refreshToken} onStep={setGuidedStep} /></div> : null}
      {engine.kind === "headset" ? <div id={`${cardId(setup)}-details`}><HeadsetFlow setup={setup} /></div> : null}
    </SlideDrawer>
  </div>;
}

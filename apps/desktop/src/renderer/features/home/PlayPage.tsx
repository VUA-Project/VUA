import { useCallback, useState } from "react";
import { PLAY_ROUTES, type PlayRoute } from "@vua/contracts";
import { strings } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { DeploymentPanel, type DeploymentCardState } from "../deployer/DeploymentPanel.tsx";
import { NetworkPanel } from "../deployer/NetworkPanel.tsx";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { GUIDE_TARGETS } from "../guide/guide-target.ts";
import { EnvironmentCard } from "./EnvironmentCard.tsx";
import { playCardDecision } from "./play-card-model.ts";
import { usePlaySessions } from "./use-play-sessions.ts";
import { RuntimeFactsPanel } from "./RuntimeFactsPanel.tsx";
import { openEncyclopedia } from "../help/encyclopedia-navigation.ts";
const copy = strings.environmentCards;
const developingRoutes = [
  { id: "quest", title: "Meta Quest", brand: "meta" },
  { id: "vive", title: "HTC VIVE", brand: "htcvive" },
  { id: "index", title: "Valve Index", brand: "valve" },
] as const;
export function PlayPage({ onAccounts }: { onAccounts: () => void }) {
  const [selected, setSelected] = useState<PlayRoute | typeof developingRoutes[number]["id"] | null>(null);
  const [deployment, setDeployment] = useState<Partial<Record<PlayRoute, DeploymentCardState>>>({});
  const live = usePlaySessions();
  const desktopState = useCallback((s: DeploymentCardState) => setDeployment(p => ({ ...p, desktop_play: s })), []);
  const picoState = useCallback((s: DeploymentCardState) => setDeployment(p => ({ ...p, pico_pcvr: s })), []);
  const title = (route: PlayRoute) => route === "desktop_play" ? strings.journey.desktop : "PICO";
  const open = (route: PlayRoute) => setSelected(route);
  const toggle = (route: NonNullable<typeof selected>) => setSelected(current => current === route ? null : route);
  const right = (route: PlayRoute) => {
    const decision = playCardDecision(live.sessions[route] ?? null, !!live.unavailable[route], !!deployment[route]?.busy, !!deployment[route]?.error);
    if (decision.action === "start" || decision.action === "stop") void live.act(route, decision.action === "stop");
    else open(route);
  };
  return <div className="vua-page vua-route-page vua-play-page vua-compact-environments" data-route-stage={selected ? "prepare" : "pick"}>
    <header className="vua-page__hero vua-environment-heading"><h1 className="vua-title">{strings.journey.play}</h1><Button variant="subtle" onClick={() => void live.refresh()}>{copy.inspect}</Button></header>
    <NetworkPanel compact />
    <div className="vua-environment-grid" data-tour-anchor="play-environments">
      {PLAY_ROUTES.map(route => {
        const decision = playCardDecision(live.sessions[route] ?? null, !!live.unavailable[route], !!deployment[route]?.busy, !!deployment[route]?.error);
        return <EnvironmentCard key={route} title={title(route)} kind={route === "desktop_play" ? "screen" : undefined} brand={route === "pico_pcvr" ? "pico" : undefined} id={route === "desktop_play" ? "route-desktop" : "route-pico"}
          {...decision} status={copy[decision.status]} spinning={decision.spinning || !!live.pending[route]} disabled={decision.disabled || !!live.pending[route]}
          selected={selected === route} onDetails={() => toggle(route)} onAction={() => right(route)} />;
      })}
      {developingRoutes.map(route => <EnvironmentCard key={route.id} title={route.title} brand={route.brand} id={`route-${route.id}`} action="unknown" status="" developing selected={selected === route.id} onDetails={() => toggle(route.id)} />)}
    </div>
    <Button variant="subtle" className="vua-play-hardware" data-nav-id="play-hardware-help" onClick={() => openEncyclopedia(GUIDE_TARGETS.hardware)}>{strings.journey.identifyHardware}</Button>
    {PLAY_ROUTES.map(route => live.sessions[route]?.issue && selected !== route ? <p className="vua-environment-notice" role="status" key={route}>{title(route)}{": "}{copy.issues[live.sessions[route]!.issue!]} <Button variant="subtle" onClick={() => open(route)}>{strings.journey.guide}</Button></p> : null)}
    {PLAY_ROUTES.map(route => {
      const session = live.sessions[route]; const installed = session?.software.every(s => s.presence === "verified") && !live.unavailable[route];
      return <section key={route} id={`${route === "desktop_play" ? "route-desktop" : "route-pico"}-details`} className="vua-environment-detail" hidden={selected !== route} aria-label={title(route)}>
        <header className="vua-environment-heading"><h2>{title(route)}</h2><Button variant="subtle" data-back onClick={() => setSelected(null)}>{copy.closeDetails}</Button></header>
        <h3>{copy.included}</h3><ul className="vua-environment-software">{(session?.software ?? (route === "desktop_play" ? ["steam", "vrchat"] : ["steam", "pico_runtime", "steamvr", "vrchat"]).map(component => ({ component, presence: "unknown", running: false, owned: false }))).map(s => <li key={s.component}>
          <strong>{strings.deployment.components[s.component as keyof typeof strings.deployment.components]}</strong><span>{live.unavailable[route] ? copy.unknown : s.presence === "verified" ? copy.installed : s.presence === "missing" ? copy.missing : copy.unknown}</span>
          {s.running && !live.unavailable[route] ? <span>{s.owned ? copy.owned : copy.borrowed}</span> : null}
        </li>)}</ul>
        {session?.issue ? <p role="alert">{copy.issues[session.issue]}</p> : null}
        {live.unavailable[route] ? <p role="status">{strings.journey.unavailable}</p> : null}
        <h3>{copy.install}</h3><DeploymentPanel zone="play" purpose={route} autoPlan={selected === route} onStateChange={route === "desktop_play" ? desktopState : picoState} />
        {route === "pico_pcvr" ? <div className="vua-environment-connection"><h3>{copy.connection}</h3><GuideEntryButton target={GUIDE_TARGETS.picoUsb} label={strings.journey.usb} /><GuideEntryButton target={GUIDE_TARGETS.picoWifi} label={strings.journey.wifi} /></div> : null}
        <div className="vua-route-platform"><Button variant="primary" disabled={!!live.unavailable[route] || (!session?.canStop && !installed) || !!live.pending[route] || session?.state === "stopping" || !!deployment[route]?.busy} onClick={() => void live.act(route, !!session?.canStop)}>{session?.canStop ? copy.stop.replace("{name}", title(route)) : copy.launch}</Button>
          <Button onClick={onAccounts} data-nav-id={`play-accounts-${route}`}>{strings.journey.accounts}</Button><GuideEntryButton target={GUIDE_TARGETS.vrchatFirstLaunch} label={strings.journey.guide} /><Button onClick={() => void window.vua?.window.showGameGuide()}>{strings.journey.gameGuide}</Button></div>
        <p className="vua-caption">{copy.closeHint}</p>{session?.state === "running" ? <p role="status">{copy.runningHint}</p> : null}
      </section>;
    })}
    {developingRoutes.map(route => <section key={route.id} id={`route-${route.id}-details`} className="vua-environment-detail" hidden={selected !== route.id} aria-label={route.title}>
      <header className="vua-environment-heading"><h2>{route.title}</h2><Button variant="subtle" data-back onClick={() => setSelected(null)}>{copy.closeDetails}</Button></header>
      <p>{strings.helpUi.developmentHint}</p>
    </section>)}
    <RuntimeFactsPanel />
  </div>;
}

import type { IconName } from "@vua/design-system";
import type { ExternalToolId } from "@vua/contracts";
import { format, strings } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { EnvironmentCard } from "../home/EnvironmentCard.tsx";
import { deriveToolCardState, type ToolConnectionStatusKey } from "./tool-connection-state.ts";
import { useToolConnection } from "./use-tool-connection.ts";
import "./tools.css";

/** Shared Steam connection card for the five non-VRCFT N2 tools: same state machine as VrcftCard without the hardware gate. */
export function SteamToolCard({ toolId, title, icon, selected, onDetails, onReveal, onPrepareSteam }: {
  toolId: ExternalToolId; title: string; icon: IconName; selected: boolean;
  onDetails(): void; onReveal(): void; onPrepareSteam(): void;
}) {
  const copy = strings.toolConnection;
  const live = useToolConnection(toolId);
  const s = live.snapshot;
  const waiting = !!s && s.activity !== "idle";
  const state = deriveToolCardState(live);
  const text = (template: string) => format(template, { tool: title });
  const status = (key: ToolConnectionStatusKey) => text(copy[key]);
  const act = () => {
    onReveal();
    if (!s || live.failed) { void live.refresh(); return; }
    if (s.canStop) void live.act("stop");
    else if (!s.steamReady) onPrepareSteam();
    else if (s.presence === "installed") void live.act("start");
    else if (s.presence === "unknown") void live.refresh();
    else void live.act("install");
  };
  return <>
    <EnvironmentCard title={title} icon={icon} id={`tool-${toolId}`}
      selected={selected} action={state.action} status={status(state.status)} onDetails={onDetails} onAction={act}
      disabled={live.pending || waiting} spinning={live.pending || waiting} warning={!!s?.issue && s.canStop} />
    <section id={`tool-${toolId}-details`} className="vua-environment-detail" hidden={!selected} aria-label={title}>
      <header className="vua-environment-heading"><h2>{title}</h2><Button variant="subtle" onClick={onDetails}>{strings.environmentCards.closeDetails}</Button></header>
      <p>{strings.helpUi[toolId]}</p>
      <div className="vua-tool-connection-actions"><Button variant="subtle" onClick={() => { void live.refresh(); }}>{copy.recheck}</Button></div>
      {live.failed || !live.available ? <p role="status">{status("unknown")}</p> : s ? <>
        <p role="status" data-tool-presence={s.presence}>{text(copy.presence[s.presence])}{s.running ? " · " + copy.running : ""}</p>
        {!s.steamReady ? <div><p>{text(copy.steamMissing)}</p><Button onClick={onPrepareSteam}>{copy.prepareSteam}</Button></div> : null}
        {s.issue ? <p role="alert">{text(copy.issues[s.issue])}</p> : null}
        {s.steamReady && (s.presence === "missing" || s.presence === "incomplete") && !waiting ? <Button disabled={live.pending} onClick={() => { void live.act("install"); }}>{copy.install}</Button> : null}
        {s.presence === "installed" && s.steamReady ? <Button disabled={live.pending || waiting} onClick={() => { void live.act("start"); }}>{text(copy.openApp)}</Button> : null}
        {waiting && s.activity !== "stopping" ? <div><p>{s.activity === "install_requested" ? copy.waitInstall : copy.waitOpen}</p><Button disabled={live.pending} variant="subtle" onClick={() => { void live.act("cancel"); }}>{copy.cancelWait}</Button><p className="vua-text-secondary">{copy.cancelHint}</p></div> : null}
        {s.running && !s.canStop ? <p className="vua-text-secondary">{text(copy.existing)}</p> : null}
      </> : <p role="status">{status("checking")}</p>}
    </section>
  </>;
}

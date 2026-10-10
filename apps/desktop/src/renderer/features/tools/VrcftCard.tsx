import { useState } from "react";
import { format, strings } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { ContentDialog } from "../../components/primitives/ContentDialog.tsx";
import { EnvironmentCard, type EnvironmentAction } from "../home/EnvironmentCard.tsx";
import { TRACKING_DEVICES, TRACKING_STEPS, readTrackingSetup, trackingChoice, type TrackingDevice, type TrackingSetup, type TrackingStep } from "./vrcft-devices.ts";
import { useVrcft } from "./use-vrcft.ts";
import "./vrcft.css";
const key = "vua-vrcft-setup";
function initialSetup() { try { return readTrackingSetup(localStorage.getItem(key)); } catch { return null; } }
export function VrcftCard({ selected, onDetails, onReveal, onPrepareSteam }: { selected: boolean; onDetails(): void; onReveal(): void; onPrepareSteam(): void }) {
  const copy = strings.faceTracking;
  const live = useVrcft(); const s = live.snapshot;
  const [setup, setSetup] = useState<TrackingSetup | null>(initialSetup);
  const [picker, setPicker] = useState(false);
  const [candidate, setCandidate] = useState<TrackingDevice | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const choice = setup ? trackingChoice(setup.device, setup.method) : null;
  const persist = (next: TrackingSetup) => { setSetup(next); try { localStorage.setItem(key, JSON.stringify(next)); setSaveFailed(false); } catch { setSaveFailed(true); } };
  const choose = (hardware: TrackingDevice, method: string) => {
    if (!setup || setup.device !== hardware.id || setup.method !== method) persist({ schemaVersion: 1, device: hardware.id, method, completed: [] });
    setPicker(false); setCandidate(null); onReveal();
  };
  const pick = () => { setCandidate(null); setPicker(true); };
  const waiting = !!s && s.activity !== "idle";
  let action: EnvironmentAction = "prepare";
  let status = !choice ? copy.chooseDevice : s?.presence === "installed" ? copy.openApp : copy.install;
  if (choice && s?.canStop) { action = "stop"; status = copy.closeApp; }
  else if (choice && s?.presence === "installed") { action = "start"; status = s.running ? copy.running : copy.openApp; }
  else if (choice && s?.presence === "unknown") { action = "unknown"; status = copy.unknown; }
  if (choice && s && !s.steamReady && !s.canStop) { action = "prepare"; status = copy.prepareSteam; }
  if (live.failed && choice) { action = "unknown"; status = copy.unknown; }
  else if (!s && choice) { action = "unknown"; status = copy.checking; }
  if (live.pending || waiting) { action = "busy"; status = s?.activity === "install_requested" ? copy.waitInstall : s?.activity === "stopping" ? copy.waitClose : copy.waitOpen; }
  const act = () => { onReveal(); if (!choice) { pick(); return; } if (!s || live.failed) { void live.refresh(); return; }
    if (s.canStop) void live.act("stop"); else if (!s.steamReady) onPrepareSteam(); else if (s.presence === "installed") void live.act("start"); else if (s.presence === "unknown") void live.refresh(); else void live.act("install");
  };
  const mark = (step: TrackingStep) => { if (!setup) return;
    const completed = setup.completed.includes(step) ? setup.completed.filter(item => item !== step && (step === "test" || item !== "test")) : [...setup.completed, step];
    persist({ ...setup, completed });
  };
  return <>
    <EnvironmentCard title="VRCFaceTracking" titleContent={<>VRCFace<wbr />Tracking</>} icon="avatar" id="tool-vrcft"
      selected={selected} action={action} status={status} onDetails={onDetails} onAction={act}
      disabled={live.pending || waiting} spinning={live.pending || waiting} warning={!!s?.issue && s.canStop} />
    <section id="tool-vrcft-details" className="vua-environment-detail vua-vrcft-detail" hidden={!selected} aria-label="VRCFaceTracking">
      <header className="vua-environment-heading"><h2>VRCFaceTracking</h2><Button variant="subtle" onClick={onDetails}>{strings.environmentCards.closeDetails}</Button></header>
      <p>{copy.intro}</p>
      <div className="vua-vrcft-actions"><Button onClick={pick}>{choice ? copy.changeDevice : copy.chooseDevice}</Button>
        <Button variant="subtle" onClick={() => { void live.refresh(); }}>{copy.recheck}</Button></div>
      {saveFailed ? <p role="alert">{copy.saveFailed}</p> : null}
      {live.failed || !live.available ? <p role="status">{copy.unknown}</p> : s ? <>
        <p className="vua-vrcft-software" role="status" data-tool-presence={s.presence}>{copy.presence[s.presence]}{s.running ? " · " + copy.running : ""}</p>
        {!s.steamReady ? <div><p>{copy.steamMissing}</p><Button onClick={onPrepareSteam}>{copy.prepareSteam}</Button></div> : null}
        {s.issue ? <p role="alert">{copy.issues[s.issue]}</p> : null}
        {choice && s.steamReady && (s.presence === "missing" || s.presence === "incomplete") && !waiting ? <Button disabled={live.pending} onClick={() => { void live.act("install"); }}>{copy.install}</Button> : null}
        {choice && s.presence === "installed" && s.steamReady ? <Button disabled={live.pending || waiting} onClick={() => { void live.act("start"); }}>{copy.openApp}</Button> : null}
        {waiting && s.activity !== "stopping" ? <div><p>{s.activity === "install_requested" ? copy.waitInstall : copy.waitOpen}</p><Button disabled={live.pending} variant="subtle" onClick={() => { void live.act("cancel"); }}>{copy.cancelWait}</Button><p className="vua-text-secondary">{copy.cancelHint}</p></div> : null}
        {s.running && !s.canStop ? <p className="vua-text-secondary">{copy.existing}</p> : null}
      </> : <p role="status">{copy.checking}</p>}
      {choice && setup ? <div className="vua-vrcft-sop" data-tracking-device={choice.hardware.id} data-tracking-method={choice.path.id}>
        <h3>{choice.hardware.name} · {choice.path.name}</h3>
        {choice.hardware.note ? <p>{copy.notes[choice.hardware.note]}</p> : null}
        {choice.hardware.id === "galaxy-xr" ? <p>{copy.notes.galaxy}</p> : null}
        <ol>{TRACKING_STEPS.map(step => <li key={step} data-tracking-step={step}>
          <h4>{copy.steps[step].title}</h4>
          <p>{step === "module" ? format(choice.path.package ? copy.packageStep : copy.moduleStep, { module: choice.path.module }) : copy.steps[step].body}</p>
          {step === "module" ? <code className="vua-vrcft-module">{choice.path.module}</code> : null}
          {step === "hardware" || step === "module" ? <a className="vua-vrcft-guide" href={step === "hardware" ? choice.hardware.hardwareGuide ?? choice.path.guide : choice.path.guide} target="_blank" rel="noopener noreferrer">{step === "hardware" ? copy.hardwareGuide : copy.officialGuide}</a> : null}
          <label className="vua-vrcft-confirm"><input type="checkbox" checked={setup.completed.includes(step)}
            disabled={(step === "module" && s?.presence !== "installed") || (step === "test" && TRACKING_STEPS.slice(0, 3).some(previous => !setup.completed.includes(previous)))} onChange={() => mark(step)} />{copy.steps[step].done}</label>
        </li>)}</ol>
        <p className="vua-text-secondary">{setup.completed.length === 4 ? copy.finished : copy.progressHint}</p>
      </div> : null}
    </section>
    <ContentDialog open={picker} title={candidate ? copy.connectionTitle : copy.devicesTitle} closeLabel={strings.environmentCards.closeDetails} onClose={() => setPicker(false)}>
      <div className="vua-vrcft-picker">
        {candidate ? <><p>{format(copy.connectionHint, { device: candidate.name })}</p><div className="vua-vrcft-choices">{candidate.methods.map(method => <Button key={method.id} data-tracking-choice={method.id} onClick={() => choose(candidate, method.id)}>{method.name}</Button>)}</div><Button variant="subtle" onClick={() => setCandidate(null)}>{copy.back}</Button></> : <>
          <p>{copy.devicesHint}</p>
          {(["headsets", "addons", "desktop"] as const).map(group => <section key={group}><h3>{copy.groups[group]}</h3><div className="vua-vrcft-choices">{TRACKING_DEVICES.filter(device => device.group === group).map(device => <button key={device.id} type="button" className="vua-vrcft-choice" data-tracking-device-choice={device.id} onClick={() => device.methods.length === 1 ? choose(device, device.methods[0]!.id) : setCandidate(device)}><strong>{device.id === "webcam" ? copy.webcam : device.name}</strong><span>{copy.tracking[device.tracking]}</span></button>)}</div></section>)}
          <p>{copy.unsupported}</p><a className="vua-vrcft-guide" href="https://docs.vrcft.io/docs/intro/getting-started#supported-hardware-list" target="_blank" rel="noopener noreferrer">{copy.otherDevices}</a>
        </>}
      </div>
    </ContentDialog>
  </>;
}

/** N1 presentation only. The Gateway owns plans, execution and task facts. Changing intent
 * invalidates displayed consent; an opened official page never changes readiness locally. */
import { useEffect, useRef, useState } from "react";
import { DEPLOYMENT_PURPOSES, UNITY_HUB_INSTALL_LINK, isTerminalTaskStateV01, readDeploymentProgress, type DeploymentIntent, type DeploymentPlan, type DeploymentProgress, type DeploymentPurpose, type PicoInstallRegion, type TaskSnapshotV01 } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
import { format } from "../../i18n/format.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { useUnityMirrors } from "../../app/unity-download-preference.ts";
import { storageKeys } from "../../app/storage-keys.ts";
import { useMinBusyValue } from "../../app/busy-timing.ts";
import { readDeploymentReceipt, type DeploymentReceiptBookmark } from "./deployment-receipt.ts";
import { readDeploymentManualHandoff } from "./deployment-handoff.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { GUIDE_TARGETS, guideTargetForComponent } from "../guide/guide-target.ts";
import type { CheckZone } from "./deployer-model.ts";

const copy = strings.deployment;
export interface DeploymentCardState { busy: boolean; error: boolean; ready: boolean }
export function DeploymentPanel({ zone, purpose, onReadyChange, onStateChange, autoPlan = false }: {
  zone: CheckZone;
  /** A route chosen by the user; standalone deployment keeps its multi-purpose picker. */
  purpose?: DeploymentPurpose;
  onReadyChange?: (ready: boolean) => void;
  onStateChange?: (state: DeploymentCardState) => void;
  autoPlan?: boolean;
}) {
  const gateway = useGateway();
  const port = gateway.environment.deployment;
  const useMirrors = useUnityMirrors();
  const mirrorPreference = useRef(useMirrors);
  mirrorPreference.current = useMirrors;
  const legacyReceiptKey = zone === "create" ? storageKeys.deploymentReceiptCreate : storageKeys.deploymentReceiptPlay;
  const receiptKey = purpose ? `${legacyReceiptKey}.${purpose}` : legacyReceiptKey;
  const autoPlanned = useRef(false);
  const [restored] = useState(() => {
    try { const receipt = readDeploymentReceipt(localStorage.getItem(receiptKey) ?? localStorage.getItem(legacyReceiptKey));
      return receipt && (!purpose || receipt.intent.purposes.includes(purpose)) ? receipt : null;
    } catch { return null; }
  });
  const [available, setAvailable] = useState(false);
  const [purposes, setPurposes] = useState<DeploymentPurpose[]>(purpose ? [purpose] : restored ? [...restored.intent.purposes] : [zone === "create" ? "pc_avatar" : "desktop_play"]);
  const [picoRegion, setPicoRegion] = useState<PicoInstallRegion | "">(() => {
    if (restored?.intent.picoRegion) return restored.intent.picoRegion;
    try { const value = localStorage.getItem(storageKeys.picoRegion); return value === "china_mainland" || value === "other" ? value : ""; }
    catch { return ""; }
  });
  const [editorRoot, setEditorRoot] = useState(restored?.intent.editorRoot ?? "C:\\Program Files\\Unity\\Hub\\Editor");
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [task, setTask] = useState<TaskSnapshotV01 | null>(null);
  const [taskId, setTaskId] = useState<string | null>(restored?.taskId ?? null);
  const [acceptedIntent, setAcceptedIntent] = useState<DeploymentIntent | null>(restored?.intent ?? null);
  // A restored task describes previous work. It does not prove the files still
  // exist now; revisiting the route requires a fresh plan before continuing.
  const [executedHere, setExecutedHere] = useState(false);
  const [requestBusy, setBusy] = useState(false);
  const busy = useMinBusyValue(requestBusy ? true : null) !== null;
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DeploymentProgress | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(restored?.startedAt ?? null);
  const [now, setNow] = useState(Date.now);
  const command = useRef<string | null>(null);
  const active = taskId !== null && (task === null || (!isTerminalTaskStateV01(task.state) && task.recoveryDisposition !== "inspect_required"));

  // This clock shows elapsed time only. Installer progress comes from adapter events.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => { setPlan(null); command.current = null; }, [useMirrors]);

  useEffect(() => {
    let alive = true;
    setAvailable(false);
    if (port !== undefined) void port.capability().then(c => { if (alive) setAvailable(c.state === "ready"); }, () => {});
    return () => { alive = false; };
  }, [port]);

  useEffect(() => {
    if (port === undefined || taskId === null) return;
    let alive = true;
    const unsubscribe = port.subscribe(taskId, setStep);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const snapshot = await port.status(taskId);
        if (!alive) return;
        setTask(snapshot); setError(null);
        if (!isTerminalTaskStateV01(snapshot.state) && snapshot.recoveryDisposition !== "inspect_required") timer = setTimeout(() => { void refresh(); }, 1000);
        else void gateway.environment.runCheck(zone).catch(() => { if (alive) setError(copy.reinspectFailed); });
      } catch { if (alive) { setError(copy.statusFailed); timer = setTimeout(() => { void refresh(); }, 3000); } }
    };
    void refresh();
    return () => { alive = false; unsubscribe(); if (timer !== undefined) clearTimeout(timer); };
  }, [port, taskId, gateway, zone]);

  const routeReady = available && !active && (
    (plan !== null && plan.prerequisitesReady && plan.steps.length > 0 && plan.steps.every(s => s.action === "retain" && s.reason === "verified")) ||
    (executedHere && task?.recoveryDisposition !== "inspect_required" && task?.result?.outcome === "prerequisites_verified"
      && acceptedIntent !== null && (!purpose || acceptedIntent.purposes.includes(purpose))
      && (!purpose || purpose.endsWith("play") || purpose === "pico_pcvr" || acceptedIntent.editorRoot === editorRoot))
  );
  useEffect(() => { onReadyChange?.(routeReady); }, [routeReady, onReadyChange]);

  const replan = async () => {
    if (!port) return;
    setBusy(true); setError(null); setPlan(null); setTask(null); setTaskId(null); setAcceptedIntent(null); setExecutedHere(false); setStep(null); command.current = null;
    try { localStorage.removeItem(receiptKey); } catch { /* Storage does not grant execution authority. */ }
    try {
      const prepared = await port.plan({ purposes, editorRoot, useMirrors, ...(purposes.includes("pico_pcvr") && picoRegion !== "" ? { picoRegion } : {}) });
      // Settings may change while the network-region probe is pending. Do not show
      // a late reply as current consent after the preference has changed.
      if (mirrorPreference.current === useMirrors) setPlan(prepared);
    }
    catch { setError(copy.planFailed); }
    finally { setBusy(false); }
  };
  const execute = async () => {
    if (plan === null || !port) return;
    setBusy(true); setError(null);
    // Preserve the command ID after an uncertain reply. Retrying sends identical consent;
    // backend idempotency returns the same task instead of running another installer.
    command.current ??= crypto.randomUUID();
    try {
      const id = await port.execute(plan, command.current);
      const started = Date.now();
      const bookmark: DeploymentReceiptBookmark = { v: 1, taskId: id, intent: plan.intent, startedAt: started };
      try {
        const serialized = JSON.stringify(bookmark);
        for (const selected of plan.intent.purposes) localStorage.setItem(`${selected === "pc_avatar" || selected === "quest_avatar" ? storageKeys.deploymentReceiptCreate : storageKeys.deploymentReceiptPlay}.${selected}`, serialized);
        if (plan.intent.purposes.some(p => p === "desktop_play" || p === "pico_pcvr")) localStorage.setItem(storageKeys.deploymentReceiptPlay, serialized);
        if (plan.intent.purposes.some(p => p === "pc_avatar" || p === "quest_avatar")) localStorage.setItem(storageKeys.deploymentReceiptCreate, serialized);
      } catch { /* The live receipt and task center remain available. */ }
      // Accepted work is monitored through its receipt. The old digest is no longer
      // a next-step action, especially after Steam hands installation back to the user.
      setPlan(null);
      setAcceptedIntent(plan.intent);
      setExecutedHere(true);
      if (id === taskId) setTask(await port.status(id));
      else { setTask(null); setStep(null); setStartedAt(started); setNow(started); setTaskId(id); }
    }
    catch { setError(copy.executeFailed); }
    finally { setBusy(false); }
  };
  const disabled = busy || active;
  const outcome = task?.result?.outcome;
  const manualHandoff = readDeploymentManualHandoff(task?.result);
  const acceptedPlayOnly = acceptedIntent !== null && acceptedIntent.purposes.every(p => p === "desktop_play" || p === "pico_pcvr");
  const playGuide = acceptedIntent?.purposes.includes("pico_pcvr") ? GUIDE_TARGETS.picoPrepare : GUIDE_TARGETS.vrchatFirstLaunch;
  const verifiedMessage = acceptedPlayOnly && acceptedIntent !== null
    ? format(copy.playVerified, { routes: acceptedIntent.purposes.map(p => copy.purposes[p]).join(" / ") }) : copy.verified;
  const installedEditor = task?.result?.editor;
  const installedVersion = typeof installedEditor === "object" && installedEditor !== null && "version" in installedEditor && typeof installedEditor.version === "string" ? installedEditor.version : null;
  const failedComponent = task?.error?.params?.component;
  const errorKey = task?.error?.code.replace(/^vua\.deployment\./, "");
  const failureMessage = errorKey !== undefined && Object.hasOwn(copy.installerErrors, errorKey)
    ? copy.installerErrors[errorKey as keyof typeof copy.installerErrors] : copy.failedHint;
  const hasCreatorPurpose = purposes.some(p => p === "pc_avatar" || p === "quest_avatar");
  const sourceFailures = [task?.result?.sourceFailures, task?.result?.installationFailures].flatMap(values => Array.isArray(values) ? values : []).flatMap(value => {
    const p = typeof value === "object" && value !== null ? readDeploymentProgress({ ...value, operation: "environment.executeDeployment", component: "unity_editor", action: "install_editor" }) : null;
    return p?.phase === "source_failed" || p?.phase === "installation_failed" ? [p] : [];
  });
  useEffect(() => { onStateChange?.({ busy: busy || active, error: error !== null || task?.state === "failed" || task?.recoveryDisposition === "inspect_required", ready: routeReady }); }, [busy, active, error, task?.state, task?.recoveryDisposition, routeReady, onStateChange]);
  useEffect(() => {
    // A fresh entry may inspect automatically. A saved receipt remains visible
    // and waits for an explicit recheck, including interrupted/recovered work.
    if (autoPlan && restored === null && available && !autoPlanned.current && !active && (!purposes.includes("pico_pcvr") || picoRegion !== "")) {
      autoPlanned.current = true; void replan();
    }
  }, [autoPlan, restored, available, active, picoRegion]);
  if (port === undefined || !available) return purpose ? <Card><p role="status">{strings.journey.unavailable}</p>
    <GuideEntryButton target={zone === "play" ? GUIDE_TARGETS.vrchatInstall : { topic: "guide-vua" }} label={strings.journey.guide} /></Card> : null;
  return <Card className="vua-deployment">
    {!purpose ? <><h2 className="vua-title">{copy.title}</h2><p>{copy.description}</p></> : null}
    {!purpose ? <fieldset disabled={disabled}><legend>{copy.purpose}</legend>
      {DEPLOYMENT_PURPOSES.map(p => <label key={p} className="vua-deployment__choice">
        <input type="checkbox" checked={purposes.includes(p)} onChange={() => { setPlan(null); command.current = null; setPurposes(old => old.includes(p) ? old.filter(x => x !== p) : [...old, p]); }} />
        {copy.purposes[p]}
      </label>)}
    </fieldset> : null}
    {purposes.includes("pico_pcvr") ? <><label>{copy.picoRegion}<select className="vua-deployment__location" disabled={disabled} value={picoRegion}
      onChange={e => {
        const region = e.target.value === "china_mainland" ? "china_mainland" : e.target.value === "other" ? "other" : "";
        setPicoRegion(region); setPlan(null); command.current = null;
        try { if (region !== "") localStorage.setItem(storageKeys.picoRegion, region); else localStorage.removeItem(storageKeys.picoRegion); } catch { /* This visit's explicit selection remains usable. */ }
      }}>
      <option value="">{copy.choosePicoRegion}</option>
      <option value="china_mainland">{copy.downloadRegions.china_mainland}</option><option value="other">{copy.downloadRegions.other}</option>
    </select></label><p className="vua-caption">{copy.picoRegionHint}</p></> : null}
    {hasCreatorPurpose ? <>
      <label>{copy.location}<input className="vua-deployment__location" value={editorRoot} disabled={disabled}
        onChange={e => { setEditorRoot(e.target.value); setPlan(null); command.current = null; }} /></label>
      <p className="vua-caption">{copy.locationHint}</p>
    </> : null}
    <Button disabled={disabled || purposes.length === 0 || (purposes.includes("pico_pcvr") && picoRegion === "")} onClick={() => { void replan(); }}>{busy ? copy.working : copy.plan}</Button>
    {plan !== null ? <>
      {plan.downloadPolicy !== undefined ? <p className="vua-caption">
        {copy.downloadRegion}{": "}{copy.downloadRegions[plan.downloadPolicy.region]}<br />
        {copy.downloadOrder}{": "}{plan.downloadPolicy.sources.map(source => copy.downloadSources[source]).join(" → ")}<br />
        {plan.downloadPolicy.editorEditions !== undefined ? copy.editorEditionOrder : null}
      </p> : null}
      <ol>{plan.steps.map(s => <li key={s.component}>
        <strong>{copy.components[s.component as keyof typeof copy.components]}</strong>{": "}{copy.actions[s.action]}
        <p className="vua-caption">{copy.reasons[s.reason]}{s.version === null ? "" : ` (${s.version})`}</p>
        {s.location !== null ? <code>{s.location}</code> : null}
        {s.action !== "retain" && s.officialUrl !== null ? <Button variant="subtle" disabled={disabled} onClick={() => { void openExternalUrl(s.officialUrl!); }}>{copy.official}</Button> : null}
        {/* 「查看操作指南」入口(首玩 B 切片):步骤组件有定位映射时出现 */}
        <GuideEntryButton target={guideTargetForComponent(s.component)} label={copy.guideCta} />
      </li>)}</ol>
      {plan.installer !== null ? <p>{copy.installer}{": "}{copy.installerKinds[plan.installer.kind]} ({plan.installer.version})<br /><code>{plan.installer.location}</code></p> : null}
      {plan.installer?.kind !== "hub_cli" && plan.installer !== null ? <p>{copy.installerHint}</p> : null}
      {plan.steps.some(s => s.action === "install_steam" || s.action === "install_pico_runtime") ? <p>{copy.vendorInstallerHint}</p> : null}
      {!purpose || !routeReady ? <><p>{copy.consent}</p>
      <Button variant="primary" disabled={disabled || plan.steps.some(s => s.action === "inspect")} onClick={() => { void execute(); }}>{copy.execute}</Button></> : null}
    </> : null}
    {task !== null ? <div role="status" aria-live="polite">
      <p>{task.recoveryDisposition === "inspect_required" ? copy.inspectRequired : copy.states[task.state]}</p>
      {step !== null ? <>
        <p>{copy.components[step.component as keyof typeof copy.components]}{": "}{copy.phases[step.phase]}{step.editorVersion === undefined ? "" : ` — ${step.editorVersion}`}{step.source === undefined ? "" : ` (${copy.downloadSources[step.source]})`}</p>
        {step.completedBytes !== undefined ? <p>{copy.transferred}{": "}{(step.completedBytes / 1048576).toFixed(1)}{step.totalBytes === undefined ? "" : ` / ${(step.totalBytes / 1048576).toFixed(1)}`} MiB</p> : null}
        {step.completedBytes !== undefined && step.totalBytes !== undefined ? <progress aria-label={copy.phases[step.phase]} value={step.completedBytes} max={step.totalBytes} /> : null}
        {step.phase === "installing" ? <p className="vua-caption">{copy.installingHint}</p> : null}
      </> : null}
      {active && startedAt !== null ? <p className="vua-caption">{copy.elapsed}{": "}{Math.max(0, Math.floor((now - startedAt) / 1000))} s</p> : null}
      {typeof failedComponent === "string" && Object.hasOwn(copy.components, failedComponent) ? <>
        <p>{copy.components[failedComponent as keyof typeof copy.components]}</p>
        <GuideEntryButton target={guideTargetForComponent(failedComponent)} label={copy.guideCta} />
      </> : null}
      {task.error !== undefined ? <>
        <p>{failureMessage}</p>
        <details><summary>{copy.errorDetails}</summary><code>{task.error.code}</code></details>
      </> : null}
      {task.error?.code === "vua.deployment.vendor_install_failed" ? <p>{copy.vendorInstallFailed}</p> : null}
      {task.error?.code === "vua.deployment.vendor_result_unreadable" ? <p>{copy.vendorResultUnreadable}</p> : null}
      {outcome === "manual_required" && task.result?.handoff === "unity_hub" && task.result?.handoffUrl === UNITY_HUB_INSTALL_LINK ? <>
        <p>{copy.hubFallback}</p>
        {sourceFailures.length > 0 ? <details><summary>{copy.sourceFailures}</summary><ul>{sourceFailures.map((failure, index) => <li key={index}>{failure.editorVersion}{" "}{failure.source === undefined ? copy.phases[failure.phase] : copy.downloadSources[failure.source]}{": "}<code>{failure.cause}</code></li>)}</ul></details> : null}
        <Button onClick={() => { void openExternalUrl(UNITY_HUB_INSTALL_LINK); }}>{copy.openHub}</Button>
        <Button variant="subtle" onClick={() => { void openExternalUrl("https://unity.com/download"); }}>{copy.getHub}</Button>
      </> : outcome === "manual_required" ? <>
        <p>{copy.manualRequired}</p>
        {manualHandoff !== null ? <>
          <p><strong>{copy.components[manualHandoff.component]}</strong></p>
          <Button onClick={() => { void openExternalUrl(manualHandoff.officialUrl); }}>{copy.official}</Button>
          <GuideEntryButton target={guideTargetForComponent(manualHandoff.component)} label={copy.guideCta} />
        </> : null}
      </> : null}
      {outcome === "prerequisites_verified" ? <>
        <p>{verifiedMessage}{installedVersion === null ? null : <><br />{copy.components.unity_editor}{": "}<code>{installedVersion}</code></>}</p>
        {acceptedPlayOnly ? <GuideEntryButton target={playGuide} label={copy.guideCta} /> : null}
      </> : null}
      {active && !task.cancellationRequested ? <Button disabled={busy} onClick={() => {
        setBusy(true); void port.cancel(task.taskId, task.revision).catch(() => setError(copy.cancelFailed)).finally(() => setBusy(false));
      }}>{copy.cancel}</Button> : null}
      {task.cancellationRequested && active ? <p>{copy.cancelPending}</p> : null}
    </div> : null}
    {error !== null ? <p role="alert">{error}</p> : null}
    {error === copy.statusFailed ? <Button disabled={busy} onClick={() => { void replan(); }}>{copy.plan}</Button> : null}
  </Card>;
}

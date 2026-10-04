/** N1 presentation only. The Gateway owns plans, execution and task facts. Changing intent
 * invalidates displayed consent; an opened official page never changes readiness locally. */
import { useEffect, useRef, useState } from "react";
import { DEPLOYMENT_PURPOSES, UNITY_HUB_INSTALL_LINK, isTerminalTaskStateV01, readDeploymentProgress, type DeploymentPlan, type DeploymentProgress, type DeploymentPurpose, type TaskSnapshotV01 } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { useUnityMirrors } from "../../app/unity-download-preference.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { guideTargetForComponent } from "../guide/guide-target.ts";
import type { CheckZone } from "./deployer-model.ts";

const copy = strings.deployment;
export function DeploymentPanel({ zone }: { zone: CheckZone }) {
  const gateway = useGateway();
  const port = gateway.environment.deployment;
  const useMirrors = useUnityMirrors();
  const mirrorPreference = useRef(useMirrors);
  mirrorPreference.current = useMirrors;
  const [available, setAvailable] = useState(false);
  const [purposes, setPurposes] = useState<DeploymentPurpose[]>([zone === "create" ? "pc_avatar" : "desktop_play"]);
  const [editorRoot, setEditorRoot] = useState("C:\\Program Files\\Unity\\Hub\\Editor");
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [task, setTask] = useState<TaskSnapshotV01 | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DeploymentProgress | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
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

  if (port === undefined || !available) return null;
  const replan = async () => {
    setBusy(true); setError(null); setPlan(null); setTask(null); setTaskId(null); setStep(null); command.current = null;
    try {
      const prepared = await port.plan({ purposes, editorRoot, useMirrors });
      // Settings may change while the network-region probe is pending. Do not show
      // a late reply as current consent after the preference has changed.
      if (mirrorPreference.current === useMirrors) setPlan(prepared);
    }
    catch { setError(copy.planFailed); }
    finally { setBusy(false); }
  };
  const execute = async () => {
    if (plan === null) return;
    setBusy(true); setError(null);
    // Preserve the command ID after an uncertain reply. Retrying sends identical consent;
    // backend idempotency returns the same task instead of running another installer.
    command.current ??= crypto.randomUUID();
    try {
      const id = await port.execute(plan, command.current);
      if (id === taskId) setTask(await port.status(id));
      else { setTask(null); setStep(null); setStartedAt(Date.now()); setNow(Date.now()); setTaskId(id); }
    }
    catch { setError(copy.executeFailed); }
    finally { setBusy(false); }
  };
  const disabled = busy || active;
  const outcome = task?.result?.outcome;
  const installedEditor = task?.result?.editor;
  const installedVersion = typeof installedEditor === "object" && installedEditor !== null && "version" in installedEditor && typeof installedEditor.version === "string" ? installedEditor.version : null;
  const failedComponent = task?.error?.params?.component;
  const sourceFailures = [task?.result?.sourceFailures, task?.result?.installationFailures].flatMap(values => Array.isArray(values) ? values : []).flatMap(value => {
    const p = typeof value === "object" && value !== null ? readDeploymentProgress({ ...value, operation: "environment.executeDeployment", component: "unity_editor", action: "install_editor" }) : null;
    return p?.phase === "source_failed" || p?.phase === "installation_failed" ? [p] : [];
  });
  return <Card className="vua-deployment">
    <h2 className="vua-title">{copy.title}</h2>
    <p>{copy.description}</p>
    <fieldset disabled={disabled}><legend>{copy.purpose}</legend>
      {DEPLOYMENT_PURPOSES.map(p => <label key={p} className="vua-deployment__choice">
        <input type="checkbox" checked={purposes.includes(p)} onChange={() => { setPlan(null); command.current = null; setPurposes(old => old.includes(p) ? old.filter(x => x !== p) : [...old, p]); }} />
        {copy.purposes[p]}
      </label>)}
    </fieldset>
    <label>{copy.location}<input className="vua-deployment__location" value={editorRoot} disabled={disabled}
      onChange={e => { setEditorRoot(e.target.value); setPlan(null); command.current = null; }} /></label>
    <p className="vua-caption">{copy.locationHint}</p>
    <Button disabled={disabled || purposes.length === 0} onClick={() => { void replan(); }}>{busy ? copy.working : copy.plan}</Button>
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
      <p>{copy.consent}</p>
      <Button variant="primary" disabled={disabled || plan.steps.some(s => s.action === "inspect")} onClick={() => { void execute(); }}>{copy.execute}</Button>
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
      {typeof failedComponent === "string" && Object.hasOwn(copy.components, failedComponent) ? <p>{copy.components[failedComponent as keyof typeof copy.components]}</p> : null}
      {task.error !== undefined ? <p>{copy.failedHint}<code>{task.error.code}</code></p> : null}
      {task.error?.code === "vua.deployment.vendor_install_failed" ? <p>{copy.vendorInstallFailed}</p> : null}
      {task.error?.code === "vua.deployment.vendor_result_unreadable" ? <p>{copy.vendorResultUnreadable}</p> : null}
      {outcome === "manual_required" && task.result?.handoff === "unity_hub" && task.result?.handoffUrl === UNITY_HUB_INSTALL_LINK ? <>
        <p>{copy.hubFallback}</p>
        {sourceFailures.length > 0 ? <details><summary>{copy.sourceFailures}</summary><ul>{sourceFailures.map((failure, index) => <li key={index}>{failure.editorVersion}{" "}{failure.source === undefined ? copy.phases[failure.phase] : copy.downloadSources[failure.source]}{": "}<code>{failure.cause}</code></li>)}</ul></details> : null}
        <Button onClick={() => { void openExternalUrl(UNITY_HUB_INSTALL_LINK); }}>{copy.openHub}</Button>
        <Button variant="subtle" onClick={() => { void openExternalUrl("https://unity.com/download"); }}>{copy.getHub}</Button>
      </> : outcome === "manual_required" ? <p>{copy.manualRequired}</p> : null}
      {outcome === "prerequisites_verified" ? <p>{copy.verified}{installedVersion === null ? null : <><br />{copy.components.unity_editor}{": "}<code>{installedVersion}</code></>}</p> : null}
      {active && !task.cancellationRequested ? <Button disabled={busy} onClick={() => {
        setBusy(true); void port.cancel(task.taskId, task.revision).catch(() => setError(copy.cancelFailed)).finally(() => setBusy(false));
      }}>{copy.cancel}</Button> : null}
      {task.cancellationRequested && active ? <p>{copy.cancelPending}</p> : null}
    </div> : null}
    {error !== null ? <p role="alert">{error}</p> : null}
  </Card>;
}

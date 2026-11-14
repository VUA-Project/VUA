/** One route's play preparation. The route's card holds the one button that always names the next step:
 * check the environment, confirm the checklist, install, retry after a failure, launch. These details show
 * what that step depends on. The Gateway owns checks, plans, tasks and sessions; this view only derives
 * the next step from them. */
import { useCallback, useEffect, useRef, useState } from "react";
import { isTerminalTaskStateV01, type DeploymentIntent, type DeploymentPlan, type DeploymentProgress, type EacProbeSnapshotV02, type PicoInstallRegion, type PlayRoute, type PlaySession, type ScenarioConnection, type ScenarioEnvironmentCheck, type ScenarioSop, type TaskSnapshotV01 } from "@vua/contracts";
import { Icon, type IconName } from "@vua/design-system";
import { useGateway } from "../../gateway/index.ts";
import { currentLocale, format, strings } from "../../i18n/index.ts";
import { playFlowCopy } from "../../i18n/play-flow-copy.ts";
import { structureCopy } from "../../i18n/structure-copy.ts";
import { storageKeys } from "../../app/storage-keys.ts";
import { useUnityMirrors } from "../../app/unity-download-preference.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { ConfirmDialog } from "../../components/primitives/ConfirmDialog.tsx";
import { readDeploymentReceipt, type DeploymentReceiptBookmark } from "../deployer/deployment-receipt.ts";
import { PICO_RUNTIME_PAGE, readDeploymentManualHandoff } from "../deployer/deployment-handoff.ts";
import { ToolReinstallRow } from "../tools/ToolReinstall.tsx";
import { EacDialog } from "./EacDialog.tsx";
import { eacConclusionHeadline, shouldPromptBeforeLaunch, shouldShowInlineEacRow } from "./eac-model.ts";
import { StepRows } from "./PlaySetupFlow.tsx";
import { checklistSignature, playChecklist, playFlowPhase, progressPercent, readConfirmed, writeConfirmed, type PlayFlowPhase } from "./play-flow-model.ts";
import "./play-flow.css";

const EDITOR_ROOT = "C:\\Program Files\\Unity\\Hub\\Editor";
const DEFAULT_SOFTWARE: Record<PlayRoute, readonly string[]> = { desktop_play: ["steam", "vrchat"], pico_pcvr: ["steam", "pico_runtime", "steamvr", "vrchat"] };
/** The last check of each route in this app session, so returning to the tab shows it at once. */
const lastChecks = new Map<PlayRoute, ScenarioEnvironmentCheck>();

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* This visit keeps its choice. */ } };
const readConnection = (): ScenarioConnection => read(storageKeys.picoConnection) === "wifi" ? "wifi" : "usb";
const readRegion = (): PicoInstallRegion | "" => { const value = read(storageKeys.picoRegion); return value === "china_mainland" || value === "other" ? value : ""; };
const finished = (task: TaskSnapshotV01 | null) => task !== null && (isTerminalTaskStateV01(task.state) || task.recoveryDisposition === "inspect_required");

const PHASE_ICONS: Partial<Record<PlayFlowPhase, IconName>> = { check: "refresh", confirm: "list", execute: "download", handoff: "arrow-right", retry: "refresh", unavailable: "warning" };

/** What the route's card shows and does for the next step. */
export interface PlayFlowStep {
  readonly phase: PlayFlowPhase;
  readonly label: string;
  /** Phases without their own action glyph name the step with this icon. */
  readonly icon: IconName | undefined;
  readonly spinning: boolean;
  readonly percent: number | null;
  /** The step depends on what the details show, so the card opens them before acting. */
  readonly needsDetails: boolean;
  readonly disabled: boolean;
  readonly act: () => void;
}

export function PlayRouteFlow({ route, session, unavailable, launchPending, refreshToken, onLaunch, onAccounts, onStep }: {
  route: PlayRoute; session: PlaySession | null; unavailable: boolean; launchPending: boolean;
  /** Changes when the page asks every route to check its environment again. */
  refreshToken: number;
  onLaunch: (stop: boolean) => void; onAccounts: () => void; onStep: (step: PlayFlowStep) => void;
}) {
  const gateway = useGateway();
  const scenarios = gateway.environment.scenarios, deployment = gateway.environment.deployment, eac = gateway.environment.eac;
  const copy = playFlowCopy[currentLocale];
  const useMirrors = useUnityMirrors();
  const receiptKey = `${storageKeys.deploymentReceiptPlay}.${route}`;
  const pico = route === "pico_pcvr";
  const [connection, setConnection] = useState<ScenarioConnection>(readConnection);
  const [region, setRegion] = useState<PicoInstallRegion | "">(readRegion);
  const [sop, setSop] = useState<ScenarioSop | null>(null);
  const [sopSettled, setSopSettled] = useState(false);
  const [check, setCheck] = useState<ScenarioEnvironmentCheck | null>(() => lastChecks.get(route) ?? null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [confirmedRaw, setConfirmedRaw] = useState(() => read(storageKeys.playChecklist));
  const signature = checklistSignature(sop, pico ? connection : "");
  const confirmed = readConfirmed(confirmedRaw, route, signature);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  // A receipt from an earlier visit (or the shared one older versions wrote) is followed only while its
  // task still runs; a finished one is history.
  const [taskId, setTaskId] = useState<string | null>(() => {
    const receipt = readDeploymentReceipt(read(receiptKey) ?? read(storageKeys.deploymentReceiptPlay));
    return receipt !== null && receipt.intent.purposes.includes(route) ? receipt.taskId : null;
  });
  const [task, setTask] = useState<TaskSnapshotV01 | null>(null);
  const [step, setStep] = useState<DeploymentProgress | null>(null);
  const [eacSnapshot, setEacSnapshot] = useState<EacProbeSnapshotV02 | null>(null);
  const [eacChecking, setEacChecking] = useState(false);
  const [eacDialogOpen, setEacDialogOpen] = useState(false);
  const [preLaunchPrompt, setPreLaunchPrompt] = useState<EacProbeSnapshotV02 | null>(null);
  const startedHere = useRef(false), command = useRef<string | null>(null), handedOff = useRef(false);
  const taskRef = useRef(task); taskRef.current = task;

  const intent = useCallback((): DeploymentIntent => ({ purposes: [route], editorRoot: EDITOR_ROOT, useMirrors, ...(pico && region !== "" ? { picoRegion: region } : {}) }), [route, useMirrors, pico, region]);
  const taskActive = taskId !== null && !finished(task);

  const runCheck = useCallback(async () => {
    if (!scenarios) return;
    setChecking(true); setCheckFailed(false);
    try {
      const result = await scenarios.check(intent());
      lastChecks.set(route, result); setCheck(result); setPrepareError(null);
      // A fresh check supersedes a finished task's failure or handoff: the button follows the new facts.
      if (finished(taskRef.current)) { setTask(null); setTaskId(null); }
    } catch { setCheckFailed(true); }
    finally { setChecking(false); }
  }, [scenarios, intent, route]);

  // The first visit in an app session checks at once; a refresh from the page checks again.
  const firstCheck = useRef(true);
  useEffect(() => {
    if (firstCheck.current) { firstCheck.current = false; if (lastChecks.has(route)) return; }
    void runCheck();
    if (eac && eacSnapshot !== null) {
      void eac.inspect().then(setEacSnapshot, () => {});
    }
  }, [refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const issue = session?.issue;
    if (!eac || (issue !== "start_timeout" && issue !== "close_timeout" && issue !== "close_failed")) return;
    let alive = true;
    void eac.inspect().then(
      (snap) => { if (alive) setEacSnapshot(snap); },
      () => {},
    );
    return () => { alive = false; };
  }, [eac, session?.issue]);

  useEffect(() => {
    if (!scenarios) { setSopSettled(true); return; }
    let alive = true;
    setSopSettled(false);
    void scenarios.sop({ scenario: route, ...(pico ? { connection } : {}) })
      .then(value => { if (alive) setSop(value); }, () => { if (alive) setSop(null); })
      .finally(() => { if (alive) setSopSettled(true); });
    return () => { alive = false; };
  }, [scenarios, route, pico, connection]);

  useEffect(() => {
    if (!deployment || taskId === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = deployment.subscribe(taskId, setStep);
    const refresh = async () => {
      try {
        const snapshot = await deployment.status(taskId);
        if (!alive) return;
        const terminal = finished(snapshot);
        if (terminal && !startedHere.current) { setTaskId(null); setTask(null); return; }
        setTask(snapshot);
        if (!terminal) timer = setTimeout(() => { void refresh(); }, 1000);
        else {
          write(receiptKey, null);
          void gateway.environment.runCheck("play").catch(() => {});
          if (snapshot.state !== "failed" && snapshot.result?.outcome !== "manual_required") void runCheck();
        }
      } catch { if (alive) timer = setTimeout(() => { void refresh(); }, 3000); }
    };
    void refresh();
    return () => { alive = false; unsubscribe(); if (timer !== undefined) clearTimeout(timer); };
  }, [deployment, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // After an official page the player comes back to VUA, and the check runs again then.
  useEffect(() => {
    const focus = () => { if (handedOff.current) { handedOff.current = false; void runCheck(); } };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [runCheck]);

  // Software installed outside VUA shows up here without another check.
  const observedReady = !session || session.software.length === 0 ? null : session.software.every(item => item.presence === "verified");
  const phase = playFlowPhase({ unavailable: unavailable || !scenarios, session, launchPending, checking: checking || !sopSettled, check, observedReady, checkFailed, confirmed,
    preparing, prepareFailed: prepareError !== null, task, taskActive });

  const needsRegion = pico && check !== null && !check.softwareReady;
  const regionMissing = needsRegion && region === "";
  const execute = async (reuse: boolean) => {
    if (!deployment || regionMissing) return;
    setPreparing(true); setPrepareError(null);
    try {
      let current = reuse ? plan : null;
      if (current === null) { current = await deployment.plan(intent()); setPlan(current); command.current = null; }
      if (current.steps.some(s => s.action === "inspect")) { setPrepareError(strings.deployment.planFailed); setPlan(null); return; }
      // An uncertain reply keeps the command ID: retrying the same plan returns the same task.
      command.current ??= crypto.randomUUID();
      const id = await deployment.execute(current, command.current);
      const bookmark: DeploymentReceiptBookmark = { v: 1, taskId: id, intent: current.intent, startedAt: Date.now() };
      write(receiptKey, JSON.stringify(bookmark));
      startedHere.current = true; command.current = null; setPlan(null);
      setTask(null); setStep(null); setTaskId(id);
    } catch { setPrepareError(strings.deployment.executeFailed); }
    finally { setPreparing(false); }
  };
  const handoff = readDeploymentManualHandoff(task?.result);
  const act = () => {
    if (phase === "check") void runCheck();
    else if (phase === "confirm") { const raw = writeConfirmed(confirmedRaw, route, signature); write(storageKeys.playChecklist, raw); setConfirmedRaw(raw); }
    else if (phase === "execute") void execute(false);
    else if (phase === "retry") { if (checkFailed) void runCheck(); else void execute(task === null && plan !== null); }
    else if (phase === "handoff") {
      if (handoff) void openExternalUrl(handoff.officialUrl);
      handedOff.current = true; lastChecks.delete(route); setTask(null); setTaskId(null); setCheck(null);
    }
    else if (phase === "launch") {
      if (!eac) { onLaunch(false); return; }
      if (eacChecking) return;
      setEacChecking(true);
      void eac.inspect().then(
        (snap) => {
          setEacSnapshot(snap);
          if (shouldPromptBeforeLaunch(snap)) setPreLaunchPrompt(snap);
          else onLaunch(false);
        },
        () => { onLaunch(false); },
      ).finally(() => { setEacChecking(false); });
    }
    else if (phase === "stop") onLaunch(true);
  };

  const scenario = strings.scenarioEnvironment;
  const componentName = (component: string) => strings.deployment.components[component as keyof typeof strings.deployment.components] ?? component;
  const percent = progressPercent(step);
  const items = playChecklist(sop);
  const observed = new Map((check?.observations ?? []).map(o => [o.component, o.presence === "verified"] as const));
  const software = (session?.software.map(s => s.component) ?? DEFAULT_SOFTWARE[route]).map(component => {
    const fact = session?.software.find(s => s.component === component);
    return { component, ready: observed.get(component) ?? fact?.presence === "verified", running: !unavailable && !!fact?.running, owned: !!fact?.owned };
  });
  const [repairOpen, setRepairOpen] = useState(false);
  const repairable = software.filter(item => item.ready && (item.component === "vrchat" || item.component === "steamvr"));
  const picoRepairable = software.some(item => item.ready && item.component === "pico_runtime");
  const failure = task?.error?.code.replace(/^vua\.deployment\./, "");
  const notice = phase === "retry"
    ? checkFailed ? scenario.failed
      : prepareError ?? (failure !== undefined && Object.hasOwn(strings.deployment.installerErrors, failure) ? strings.deployment.installerErrors[failure as keyof typeof strings.deployment.installerErrors] : strings.deployment.failedHint)
    : phase === "running" && step ? `${componentName(step.component)} · ${strings.deployment.phases[step.phase]}`
    : phase === "handoff" && handoff ? componentName(handoff.component)
    : phase === "execute" && regionMissing ? copy.regionNeeded
    : session?.issue ? strings.environmentCards.issues[session.issue]
    : null;
  const label = phase === "running" && percent !== null ? `${copy.phases.running} ${percent}%` : copy.phases[phase];
  const timeoutIssue =
    session?.issue === "start_timeout" || session?.issue === "close_timeout" || session?.issue === "close_failed"
      ? session.issue
      : null;
  const timeoutEacAttribution =
    timeoutIssue !== null && eacSnapshot !== null && eacSnapshot.conclusion !== "ready" && eacSnapshot.conclusion !== "unknown"
      ? format(strings.environmentCards.eacAttribution[timeoutIssue], {
          reason: eacConclusionHeadline(eacSnapshot, strings.eac, Date.now()),
        })
      : null;
  const spinning = phase === "checking" || phase === "running" || phase === "starting" || eacChecking;
  const actRef = useRef(act); actRef.current = act;
  const needsDetails = phase === "confirm" || phase === "unavailable" || (phase === "execute" && regionMissing);
  useEffect(() => {
    onStep({ phase, label, icon: PHASE_ICONS[phase], spinning, percent: phase === "running" ? percent : null, needsDetails, disabled: phase === "unavailable" || spinning, act: () => actRef.current() });
  }, [phase, label, spinning, percent, needsDetails, onStep]);

  return <div className="vua-play-flow" data-phase={phase} data-route={route}>
    <ul className="vua-play-flow__software" aria-label={strings.environmentCards.included}>
      {software.map(s => <li key={s.component} data-ready={s.ready} data-running={s.running || undefined}
        title={s.running ? s.owned ? strings.environmentCards.owned : strings.environmentCards.borrowed : undefined}>
        <span className="vua-play-flow__state" aria-hidden="true">{s.ready ? <Icon name="check" size={16} /> : null}</span>
        {componentName(s.component)}
        <span className="vua-play-flow__sr">{s.ready ? strings.environmentCards.installed : strings.environmentCards.missing}</span>
      </li>)}
    </ul>
    {shouldShowInlineEacRow(eacSnapshot) && eacSnapshot ? <div className="vua-play-eac-inline" role="status">
      <span>{eacConclusionHeadline(eacSnapshot, strings.eac, Date.now())}</span>
      <Button variant="subtle" data-nav-id={`play-eac-view-${route}`} onClick={() => setEacDialogOpen(true)}>{strings.eac.view}</Button>
    </div> : null}
    {pico ? <div className="vua-play-flow__options">
      <fieldset className="vua-segmented" disabled={spinning}><legend className="vua-play-flow__sr">{copy.connection}</legend>
        {(["usb", "wifi"] as const).map(value => <label key={value} data-checked={connection === value}>
          <input type="radio" name={`vua-${route}-connection`} checked={connection === value} onChange={() => { setConnection(value); write(storageKeys.picoConnection, value); }} />{scenario[value]}
        </label>)}
      </fieldset>
      {needsRegion ? <fieldset className="vua-segmented" disabled={spinning} data-required={regionMissing || undefined}><legend>{copy.region}</legend>
        {(["china_mainland", "other"] as const).map(value => <label key={value} data-checked={region === value}>
          <input type="radio" name={`vua-${route}-region`} checked={region === value} onChange={() => { setRegion(value); write(storageKeys.picoRegion, value); setPlan(null); }} />{strings.deployment.downloadRegions[value]}
        </label>)}
      </fieldset> : null}
    </div> : null}
    {items.length > 0 ? <div className="vua-play-flow__review" data-confirming={phase === "confirm" || undefined}>
      {phase === "confirm" ? <h3><Icon name="list" size={16} />{copy.checklist}</h3> : null}
      <StepRows rows={items.map(item => {
        const words = scenario.steps[item.id as keyof typeof scenario.steps];
        return { id: item.id, text: words?.title ?? item.id, actor: item.automatic ? "vua" as const : "player" as const, title: words?.explanation };
      })} />
    </div> : null}
    {notice ? <p className="vua-play-flow__notice" role="status" data-tone={phase === "retry" ? "warning" : undefined}>
      {notice}
      {timeoutEacAttribution ? <>{" "}{timeoutEacAttribution}{" "}<Button variant="subtle" onClick={() => setEacDialogOpen(true)}>{strings.eac.view}</Button></> : null}
    </p> : null}
    {repairable.length > 0 || picoRepairable ? <details className="vua-play-flow__repair" onToggle={event => setRepairOpen(event.currentTarget.open)}>
      <summary>{copy.repair}</summary>
      {repairOpen ? repairable.map(item => <ToolReinstallRow key={item.component} toolId={item.component as "vrchat" | "steamvr"} title={componentName(item.component)} />) : null}
      {repairOpen && picoRepairable ? <div className="vua-tool-reinstall-row">
        <strong>{componentName("pico_runtime")}</strong>
        <div className="vua-tool-reinstall"><Button data-nav-id="play-repair-pico" onClick={() => { void openExternalUrl(PICO_RUNTIME_PAGE); }}>{format(structureCopy[currentLocale].reinstallFromPage, { tool: componentName("pico_runtime") })}</Button></div>
      </div> : null}
    </details> : null}
    <div className="vua-play-flow__actions">
      {phase === "confirm" ? <Button variant="primary" data-nav-id={`play-confirm-${route}`} onClick={act}>{copy.confirmContinue}</Button> : null}
      {phase === "execute" && pico ? <Button variant="primary" data-nav-id={`play-install-${route}`} disabled={regionMissing} onClick={act}>{label}</Button> : null}
      {phase === "running" && task !== null && taskActive && !task.cancellationRequested && deployment
        ? <Button variant="subtle" onClick={() => { void deployment.cancel(task.taskId, task.revision).catch(() => {}); }}>{copy.cancel}</Button> : null}
      <Button variant="subtle" className="vua-play-flow__accounts" data-nav-id={`play-accounts-${route}`} onClick={onAccounts}>{copy.accounts}</Button>
    </div>
    <EacDialog
      open={eacDialogOpen}
      initialSnapshot={eacSnapshot}
      onClose={() => setEacDialogOpen(false)}
      onSnapshotChange={setEacSnapshot}
      {...(session?.canStop ? { onStopVrchat: () => onLaunch(true) } : {})}
    />
    <ConfirmDialog
      open={preLaunchPrompt !== null}
      title={strings.eac.preLaunch.title}
      cancelLabel={strings.eac.cancel}
      confirmLabel={strings.eac.launchAnyway}
      onCancel={() => setPreLaunchPrompt(null)}
      onConfirm={() => {
        setPreLaunchPrompt(null);
        onLaunch(false);
      }}
    >
      {preLaunchPrompt ? (
        <>
          <p>{eacConclusionHeadline(preLaunchPrompt, strings.eac, Date.now())}</p>
          <div>
            <Button
              variant="subtle"
              onClick={() => {
                setPreLaunchPrompt(null);
                setEacDialogOpen(true);
              }}
            >
              {strings.eac.view}
            </Button>
          </div>
        </>
      ) : null}
    </ConfirmDialog>
  </div>;
}

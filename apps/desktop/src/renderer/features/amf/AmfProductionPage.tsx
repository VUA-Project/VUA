import { AmfRecipeShareDialog } from "./AmfRecipeShareDialog.tsx";
import { AmfRecipeApplyDialog } from "./AmfRecipeApplyDialog.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AmfAssemblySelection, AmfOutfitSelection } from "@vua/contracts";
import { Icon } from "@vua/design-system";
import { useGateway, type AmfPrefab, type AmfProductionList, type AmfProductionRun, type AmfProductionPlan, type AmfProductionRestorePlan, type AmfSavedRecipe } from "../../gateway/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { strings, format, formatShortDateTime, termLabel } from "../../i18n/index.ts";
import { initialProductionSelection, updateOutfitSelection } from "./production-selection-model.ts";
import "./amf-production.css";
import { AmfRecipeLibrary } from "./AmfRecipeLibrary.tsx";
import { AmfCandidateGallery, AmfResultViews } from "./AmfPreviews.tsx";
import { onProductionRunRequested, takeRequestedProductionRecipe, takeRequestedProductionRun } from "./production-recipe-navigation.ts";
import { requestUnityLicenseGuide } from "../settings/account-guide-navigation.ts";
import { AUTOMATION_LEVELS, currentStation, lineBusy, lineStations, lineStatus, phaseStatus, rememberAutomationLevel, STATIONS, stopsAt, storedAutomationLevel, type AutomationLevel, type LineStatus } from "./factory-model.ts";
import "./factory.css";
import type { AmfRunProgress } from "../../gateway/index.ts";
import { formatDuration, lineLabels } from "./factory-model.ts";

const copy = strings.amfProduction;
const factory = strings.factory;
/** The running step's live state: Unity's stage and count, a running clock, the usual time on this computer, and Unity's silence. */
function LiveProgress({ progress }: { progress: AmfRunProgress }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const started = Date.parse(progress.startedAt);
  const elapsed = Math.max(progress.elapsedSeconds * 1000, Number.isFinite(started) ? now - started : 0);
  const usual = progress.usualSeconds === null ? null : progress.usualSeconds * 1000;
  const unity = progress.unity;
  const quietSince = unity ? Date.parse(unity.lastActivityAt) : NaN;
  const quiet = Number.isFinite(quietSince) && now - quietSince > 120_000;
  const count = unity?.current !== undefined ? (unity.total !== undefined ? format(factory.count, { current: unity.current, total: unity.total }) : String(unity.current)) : null;
  return <div className="vua-line__progress">
    <span className="vua-line__stage">{unity ? factory.stage[unity.stage] : factory.checkingProject}{count && unity?.stage === "importing" ? ` · ${count}` : ""}</span>
    <span className="vua-line__clock">{format(factory.elapsed, { time: formatDuration(elapsed) })}{usual !== null ? ` · ${format(factory.usual, { time: formatDuration(usual) })}` : ""}</span>
    {usual !== null && <span className="vua-line__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(95, Math.round(elapsed / usual * 100))}>
      <span style={{ width: `${Math.min(95, elapsed / usual * 100)}%` }}/></span>}
    {quiet && <span className="vua-line__quiet">{format(factory.quiet, { time: new Date(quietSince).toLocaleTimeString() })}</span>}
  </div>;
}
function StatusChip({ status }: { status: LineStatus }) {
  return <span className="vua-line__status" data-status={status}>{factory.status[status]}</span>;
}
const unavailable = format(copy.unavailable, { amf: termLabel("amf") });
const runKey = "vua-amf-production-run-v01";
const materialsKey = "vua-amf-production-materials-v01";
const blank: AmfAssemblySelection = { avatarPrefab: "", outfits: [] };
function storedRun(): string { try { const id = localStorage.getItem(runKey) ?? ""; return /^[a-zA-Z0-9-]{1,100}$/u.test(id) ? id : ""; } catch { return ""; } }
function storedMaterials(): string[] { try { const ids: unknown = JSON.parse(localStorage.getItem(materialsKey) ?? "[]"); return Array.isArray(ids) && ids.every(id => typeof id === "string") ? ids.slice(0,64) : []; } catch { return []; } }
function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Runtime facts remain authoritative. */ } }

export function AmfProductionPage({ onNavigate, onPrepareEnv }: {
  onNavigate: (page: PageId) => void; onPrepareEnv: () => void;
}) {
  const gateway = useGateway(); const port = gateway.amfProduction;
  const [list, setList] = useState<AmfProductionList | null>(null);
  const [sourceIds, setSourceIds] = useState<readonly string[]>(storedMaterials);
  const [search, setSearch] = useState(""); const [visible, setVisible] = useState(60);
  const [editorPath, setEditorPath] = useState("");
  const [requestedRecipe] = useState(takeRequestedProductionRecipe);
  const [runId, setRunId] = useState(() => takeRequestedProductionRun() ?? (requestedRecipe ? "" : storedRun()));
  useEffect(() => { if (runId) remember(runKey, runId); }, [runId]);
  useEffect(() => onProductionRunRequested(id => { takeRequestedProductionRun(); initialized.current = ""; setRunId(id); setError(null); }), []);
  const [run, setRun] = useState<AmfProductionRun | null>(null);
  const [selection, setSelection] = useState<AmfAssemblySelection>(blank);
  const [plan, setPlan] = useState<AmfProductionPlan | null>(null);
  const [restorePlan, setRestorePlan] = useState<AmfProductionRestorePlan | null>(null);
  const [restored, setRestored] = useState(false);
  const [recipeRefresh, setRecipeRefresh] = useState(0);
  const [recipePreview, setRecipePreview] = useState<AmfSavedRecipe | null>(null);
  const [sharingRecipe, setSharingRecipe] = useState<string | null>(null);
  const [applyingRecipe, setApplyingRecipe] = useState(false);
  const [savedRecipe, setSavedRecipe] = useState<AmfSavedRecipe | null>(null);
  const [recipeTitle, setRecipeTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskAction, setTaskAction] = useState<"prepare" | "assemble" | "reinspect" | "rollback" | "open" | null>(null);
  const [level, setLevel] = useState<AutomationLevel | null>(storedAutomationLevel);
  const [adjusting, setAdjusting] = useState(false);
  const chooseLevel = (next: AutomationLevel) => { setLevel(next); rememberAutomationLevel(next); };
  const initialized = useRef("");
  const refreshList = useCallback(async () => {
    if (!port) { setError(unavailable); return; }
    try {
      const observed = await port.list(); setList(observed); setRecipeRefresh(value => value + 1);
      const present = new Set(observed.sources.map(source => source.sourceId));
      setSourceIds(ids => ids.filter(id => present.has(id)));
    } catch (e) { setError(e instanceof Error ? e.message : unavailable); }
  }, [port]);
  useEffect(() => { void refreshList(); }, [refreshList]);
  useEffect(() => {
    if (!port || !requestedRecipe) return;
    let alive = true; setRequesting(true); remember(runKey, "");
    void port.getRecipe(requestedRecipe).then(value => { if (alive) setRecipePreview(value); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : copy.taskFailed); })
      .finally(() => { if (alive) setRequesting(false); });
    return () => { alive = false; };
  }, [port, requestedRecipe]);
  useEffect(() => { remember(materialsKey, JSON.stringify(sourceIds)); }, [sourceIds]);
  useEffect(() => { setSavedRecipe(null); setRecipeTitle(""); }, [runId]);
  useEffect(() => {
    if (!runId || !port) { setRun(null); return; }
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const loaded = await port.get(runId); if (!alive) return;
        setRun(loaded);
        if (taskId === null && initialized.current !== runId && (loaded.phase === "ready" || loaded.phase === "succeeded")) {
          initialized.current = runId; setSelection(initialProductionSelection(loaded));
        }
        // A reinspection keeps the previous phase until it ends; a running step still needs fresh facts.
        if (["preparing", "inspecting", "assembling", "restoring"].includes(loaded.phase) || loaded.steps.some(step => step.state === "running") || taskId !== null) timer = setTimeout(() => { void load(); }, 1000);
      } catch (e) { if (alive) { setError(e instanceof Error ? e.message : unavailable); timer = setTimeout(() => { void load(); }, 2000); } }
    };
    void load();
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [port, runId, taskId]);
  useEffect(() => {
    if (taskId === null) return;
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const observe = async () => {
      try {
        const view = await gateway.task.snapshot(); if (!alive) return;
        const task = view.tasks.find(t => t.id === taskId);
        if (task && ["completed", "completedWithWarnings", "failed", "cancelled"].includes(task.status)) {
          setTaskId(null); setTaskAction(null); void refreshList();
          if (task.status === "failed") setError(task.errorText ?? copy.taskFailed);
          if (taskAction === "rollback" && ["completed", "completedWithWarnings"].includes(task.status)) setRestored(true);
          return;
        }
      } catch { /* Keep waiting for an authoritative terminal task fact. */ }
      if (alive) timer = setTimeout(() => { void observe(); }, 1000);
    };
    void observe(); return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [gateway, taskId, taskAction, refreshList]);

  const edit = (next: AmfAssemblySelection) => { setSelection(next); setPlan(null); setError(null); };
  const outfit = (id: string, patch: Partial<AmfOutfitSelection> | null) => edit(updateOutfitSelection(selection, id, patch));
  const busy = requesting || taskId !== null || (run !== null && ["preparing", "inspecting", "assembling", "restoring"].includes(run.phase));
  const command = async (action: "prepare" | "assemble" | "reinspect" | "rollback" | "open") => {
    if (!port || busy) return;
    if ((action === "assemble" && !plan) || (action === "rollback" && !restorePlan)) return;
    setRequesting(true); setError(null);
    try {
      const response = action === "prepare" ? await port.prepare(sourceIds.map(sourceId => ({ sourceId, role: "auto" })), editorPath || list?.editors[0]?.path || "")
        : action === "assemble" && plan !== null ? await port.assemble(runId, plan)
        : action === "rollback" && restorePlan !== null ? await port.rollback(runId, restorePlan)
        : action === "reinspect" ? await port.reinspect(runId) : await port.open(runId);
      setTaskId(response.taskId); setTaskAction(action);
      setRestored(false); setRestorePlan(null);
      if (action === "prepare") { initialized.current = ""; setPlan(null); setSelection(blank); setRun(null); }
      if (action === "reinspect" || action === "rollback") { initialized.current = ""; setPlan(null); }
      setRunId(response.runId); remember(runKey, response.runId);
    } catch (e) { setError(e instanceof Error ? e.message : copy.taskFailed); }
    finally { setRequesting(false); }
  };
  const newPreparation = () => { initialized.current = ""; setRunId(""); setRun(null); setPlan(null); setRestorePlan(null); setRestored(false); setSelection(blank); setError(null); remember(runKey, ""); void refreshList(); };
  const prepareRecipe = async () => {
    if (!port || busy || !recipePreview) return;
    const editor = list?.editors.find(e => e.version === recipePreview.recipe.editorVersion);
    if (!editor) { setError(format(copy.recipeEditor, { version: recipePreview.recipe.editorVersion })); return; }
    setRequesting(true); setError(null);
    try {
      const accepted = await port.prepareRecipe(recipePreview.recipe.recipeId, editor.path);
      initialized.current = ""; setPlan(null); setRun(null); setSelection(blank); setRestorePlan(null); setSavedRecipe(null); setRecipePreview(null);
      setRunId(accepted.runId); remember(runKey, accepted.runId); setTaskId(accepted.taskId); setTaskAction("prepare");
    } catch (e) { setError(e instanceof Error ? e.message : copy.taskFailed); }
    finally { setRequesting(false); }
  };
  // Fully automatic: the one-sentence plan is the stop; confirming it reviews and assembles in one go.
  const assembleNow = async () => {
    if (!port || busy) return;
    setRequesting(true); setError(null);
    try {
      const reviewed = await port.plan(runId, selection);
      const response = await port.assemble(runId, reviewed);
      setPlan(null); setTaskId(response.taskId); setTaskAction("assemble"); setRunId(response.runId);
    } catch (e) { setError(e instanceof Error ? e.message : copy.taskFailed); }
    finally { setRequesting(false); }
  };
  const selectLine = (id: string) => { initialized.current = ""; setRunId(id); remember(runKey, id); setPlan(null); setRestorePlan(null); setAdjusting(false); setError(null); };
  const filtered = useMemo(() => (list?.sources ?? []).filter(s => `${s.itemName} ${s.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [list, search]);
  const avatars = [...new Map((run?.prefabs.filter(p => p.isAvatar && !p.hasMissingScripts && run.sources.some(s => s.sourceId === p.sourceId && (s.role === "avatar" || s.role === "auto"))) ?? []).map(p => [p.path,p])).values()];
  const avatar = avatars.find(p => p.path === selection.avatarPrefab);
  const step = run === null ? 0 : run.phase === "succeeded" ? 4 : run.phase === "assembling" ? 3 : plan !== null ? 2 : run.phase === "ready" ? 1 : 0;

  const states = run ? lineStations(run) : null;
  const status: LineStatus | null = run ? lineStatus(run) : null;
  const effective: AutomationLevel = level ?? "semi";
  const stops = stopsAt(effective);
  const showDetails = effective !== "auto" || adjusting;
  const lineName = (names: readonly string[]) => [...new Set(names.map(name => name.replace(/\.zip$/iu, "")))].join(" + ");
  const labels = lineLabels(list?.runs ?? [], date => formatShortDateTime(date));
  const runningStep = run?.steps.find(item => item.state === "running");

  return <div className="vua-page vua-n3 vua-workshop">
    <aside className="vua-workshop__rail" aria-label={factory.lineList}>
      <Button variant="primary" onClick={newPreparation}>{factory.newLine}</Button>
      {list !== null && list.runs.length === 0 && <p className="vua-caption vua-text-secondary">{factory.lineEmpty}</p>}
      {list?.runs.map(recent => <button type="button" key={recent.runId} className="vua-workshop__line" aria-current={recent.runId === runId || undefined} onClick={() => selectLine(recent.runId)}>
        <span>{labels.get(recent.runId)?.name ?? recent.runId}</span>
        {labels.get(recent.runId)?.extra && <small className="vua-workshop__line-extra">{labels.get(recent.runId)?.extra}</small>}
        <StatusChip status={recent.runId === run?.runId && run ? lineStatus(run) : phaseStatus(recent.phase)}/>
      </button>)}
    </aside>
    <div className="vua-workshop__main">
    {level === null && <Card><h2>{factory.levelQuestion}</h2><div className="vua-workshop__levels">{AUTOMATION_LEVELS.map(option => <button type="button" key={option} onClick={() => chooseLevel(option)}>
      <strong>{factory.levels[option].name}</strong><span>{factory.levels[option].hint}</span></button>)}</div><p className="vua-caption vua-text-secondary">{factory.levelLater}</p></Card>}
    {error !== null && <Card><div role="alert"><strong>{copy.error}</strong><p className="vua-caption vua-text-secondary">{error}</p><Button variant="subtle" onClick={() => { setError(null); void refreshList(); }}>{copy.retry}</Button></div></Card>}
    {run === null && error !== null && /license/iu.test(error) ? <Card>
      <h2>{strings.unityLicense.retry}</h2><p>{strings.unityLicense.retryHint}</p>
      <Button onClick={() => { requestUnityLicenseGuide(); onNavigate("settings-accounts"); }}>{strings.unityLicense.open}</Button>
    </Card> : null}
    {run === null ? <>
      <header className="vua-page__hero"><h1 className="vua-title">{factory.newLine}</h1><p className="vua-text-secondary">{copy.intro}</p></header>
      {!recipePreview && <AmfRecipeLibrary refreshKey={recipeRefresh} disabled={busy} onOpen={recipeId => {
        if (!port) return; setRequesting(true); setError(null);
        void port.getRecipe(recipeId).then(setRecipePreview).catch(e => setError(e instanceof Error ? e.message : copy.taskFailed)).finally(() => setRequesting(false));
      }}/>}
      {recipePreview && <Card><Button disabled={busy} onClick={() => setSharingRecipe(recipePreview.recipe.recipeId)}>{copy.shareRecipe}</Button><h2>{recipePreview.recipe.title}</h2><p>{format(copy.recipeSummary,{materials:recipePreview.recipe.materials.length,outfits:recipePreview.recipe.outfits.length})}</p>
        <details><summary>{copy.materials}</summary><ul>{recipePreview.recipe.materials.map(material => <li key={material.id}>{material.packageName}</li>)}</ul></details>
        <p className="vua-caption vua-text-secondary">{copy.recipeReproduceHint}</p>
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setRecipePreview(null)}>{copy.back}</Button><Button variant="primary" disabled={busy} onClick={() => { void prepareRecipe(); }}>{copy.recipeReproduce}</Button></div>
      </Card>}
      {!recipePreview && (list === null ? <Card><EmptyState title={requesting ? copy.loading : unavailable} description={copy.loading} /></Card> : <Card>
        <div className="vua-n3__toolbar"><input type="search" value={search} placeholder={copy.search} aria-label={copy.search} onChange={e => { setSearch(e.target.value); setVisible(60); }}/><span>{format(copy.selected,{count:sourceIds.length})}</span></div>
        {list.sources.length === 0 ? <EmptyState title={copy.empty} description={copy.emptyHint} /> :
          <div className="vua-n3__materials">{filtered.slice(0,visible).map(source => <label key={source.sourceId} className="vua-n3__material" data-selected={sourceIds.includes(source.sourceId) || undefined}>
            <input type="checkbox" checked={sourceIds.includes(source.sourceId)} disabled={busy || (!sourceIds.includes(source.sourceId) && sourceIds.length >= 64)} onChange={e => setSourceIds(ids => e.target.checked ? [...ids,source.sourceId] : ids.filter(id => id !== source.sourceId))}/>
            <span><strong title={source.itemName}>{source.itemName}</strong><small title={source.name}>{source.name}</small></span></label>)}</div>}
        {filtered.length > visible && <Button variant="subtle" onClick={() => setVisible(v => v + 60)}>{copy.more}</Button>}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => onNavigate("warehouse")}>{copy.library}</Button><Button variant="primary" disabled={busy || sourceIds.length === 0 || list.editors.length === 0} onClick={() => { void command("prepare"); }}>{copy.prepare}</Button></div>
        {list.editors.length === 0 ? <div className="vua-n3__notice"><p>{copy.editorMissing}</p><Button onClick={onPrepareEnv}>{copy.environment}</Button></div> : <details className="vua-n3__advanced"><summary>{copy.advanced}</summary><label>{copy.editor}<select value={editorPath || list.editors[0]?.path || ""} onChange={e => setEditorPath(e.target.value)}>{list.editors.map(editor => <option key={editor.path} value={editor.path}>{editor.version} — {editor.path}</option>)}</select></label><p className="vua-caption vua-text-secondary">{copy.originalSafe}</p></details>}
        <Button variant="subtle" onClick={() => { requestUnityLicenseGuide(); onNavigate("settings-accounts"); }}>{strings.unityLicense.open}</Button>
      </Card>)}
    </> : <>
      <header className="vua-line__header">
        <h1 className="vua-title">{lineName(run.sources.map(source => source.itemName)) || run.runId}</h1>
        {labels.get(run.runId)?.extra && <span className="vua-workshop__line-extra">{labels.get(run.runId)?.extra}</span>}
        {status && <StatusChip status={status}/>}
        <label className="vua-line__level">{factory.automation}<select value={effective} onChange={e => chooseLevel(e.target.value as AutomationLevel)}>
          {AUTOMATION_LEVELS.map(option => <option key={option} value={option}>{factory.levels[option].name}</option>)}</select></label>
      </header>
      {states && <ol className="vua-line__stations" aria-label={factory.stations[currentStation(states)]}>{STATIONS.map(key => <li key={key} className="vua-line__station" data-state={states[key]} aria-current={currentStation(states) === key ? "step" : undefined}>
        <strong>{factory.stations[key]}</strong><small>{factory.stationState[states[key]]}</small>
        {stops.has(key) && ["todo", "waiting"].includes(states[key]) && <span className="vua-line__stop">{factory.stopsHere}</span>}</li>)}</ol>}
      {lineBusy(run) && <Card className="vua-line__live" aria-live="polite">
        <div className="vua-line__live-head"><span className="vua-n3__spinner" aria-hidden="true"/>
          <strong>{runningStep ? copy.step[runningStep.key as keyof typeof copy.step] ?? runningStep.name : run.phase === "assembling" ? copy.assembling : run.phase === "restoring" ? copy.restoring : copy.preparing}</strong></div>
        {runningStep?.detail && <p className="vua-caption vua-text-secondary">{runningStep.detail}</p>}
        {run.progress && <LiveProgress progress={run.progress}/>}
        <div className="vua-n3__actions"><p className="vua-caption vua-text-secondary">{factory.stopHint}</p>
          <Button variant="subtle" disabled={!taskId && !run.taskId} onClick={() => { void gateway.task.cancel(taskId ?? run.taskId); }}>{factory.stop}</Button></div>
      </Card>}
      {!lineBusy(run) && (status === "attention" || status === "stopped") && <Card className="vua-line__attention" data-status={status}>
        <h2>{status === "stopped" ? factory.status.stopped : factory.attentionTitle}</h2>
        {run.error && /license/iu.test(run.error) ? <><p role="alert">{strings.unityLicense.retryHint}</p>
          <Button onClick={() => { requestUnityLicenseGuide(); onNavigate("settings-accounts"); }}>{strings.unityLicense.open}</Button></>
          : run.error && <p role="alert">{run.error.replace(/^vua.[a-z_.]+ — detail: /u, "")}</p>}
        {run.recovery && <p className="vua-n3__notice">{run.recovery === "restored" ? copy.recovered : copy.recoveryFailed}</p>}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={newPreparation}>{factory.newLine}</Button>
          {run.sources.length > 0 && <Button variant="primary" disabled={busy} onClick={() => { void command("reinspect"); }}>{factory.continue}</Button>}</div>
        <details className="vua-n3__advanced"><summary>{factory.details}</summary><ul className="vua-n3__progress">{run.steps.map((item,index) => <li key={`${item.key}-${index}`} data-state={item.state}>
          <span aria-hidden="true">{item.state === "succeeded" ? <Icon name="check" size={16}/> : item.state === "failed" ? <Icon name="warning" size={16}/> : <Icon name="dash" size={16}/>}</span>
          <span>{copy.step[item.key as keyof typeof copy.step] ?? item.name}{item.detail && <small>{item.detail}</small>}</span></li>)}</ul>
          {run.error && <code>{run.error}</code>}</details>
      </Card>}
      {restored && !busy && <Card><p role="status">{copy.restored}</p><p className="vua-caption vua-text-secondary">{copy.restoreReversible}</p></Card>}
      {restorePlan && !busy && <Card><h2>{copy.restoreTitle}</h2><p>{copy.restoreHint}</p>
        {restorePlan.currentChanged && <p className="vua-n3__notice">{copy.restoreChanged}</p>}
        <p className="vua-caption vua-text-secondary">{copy.restoreReversible}</p>
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setRestorePlan(null)}>{copy.back}</Button><Button variant="primary" onClick={() => { void command("rollback"); }}>{copy.restoreConfirm}</Button></div>
      </Card>}
      {run.phase === "ready" && !busy && plan === null && restorePlan === null && !showDetails && <Card className="vua-line__summary">
        <h2>{factory.stations.plan}</h2>
        <p className="vua-line__sentence">{format(factory.planSentence, { avatar: avatar?.name ?? copy.choosePrefab, outfits: selection.outfits.map(item => item.toggleName).join(" · ") || copy.needOutfit })}</p>
        {port && avatar && <AmfCandidateGallery port={port} runId={run.runId} candidates={[avatar, ...run.prefabs.filter(p => selection.outfits.some(o => o.prefabPath === p.path))]} chosen={avatar.path} label={copy.chooseAvatar} onChoose={() => setAdjusting(true)}/>}
        <p className="vua-caption vua-text-secondary">{copy.originalSafe}</p>
        <div className="vua-n3__actions"><Button variant="subtle" disabled={busy} onClick={() => { void command("reinspect"); }}>{copy.reinspect}</Button><Button variant="subtle" onClick={() => setAdjusting(true)}>{factory.adjust}</Button>
          <Button variant="primary" disabled={requesting || !selection.avatarPrefab || selection.outfits.length === 0} onClick={() => { void assembleNow(); }}>{factory.placeOrder}</Button></div>
      </Card>}
      {run.phase === "ready" && !busy && plan === null && restorePlan === null && showDetails && <>
        {!!run.result?.diagnostics?.some(d => d.severity !== "info") && <Card>
          {run.result.diagnostics.filter(d => d.severity !== "info").map(d => <p role="status" className="vua-n3__notice" key={d.code}>{d.message}</p>)}
        </Card>}
        <Card><h2>{copy.menuTitle}</h2><p className="vua-caption vua-text-secondary">{copy.menuHint}</p>
          {avatars.length !== 1 ? <label className="vua-n3__field">{copy.chooseAvatar}<select value={selection.avatarPrefab} onChange={e => edit({...selection,avatarPrefab:e.target.value})}><option value="">{copy.choosePrefab}</option>{avatars.map(p => <option key={`${p.sourceId}-${p.path}`} value={p.path}>{p.name} — {p.path}</option>)}</select></label> : <p>{format(copy.preparedAvatar,{name:avatar?.name ?? avatars[0]?.name ?? ""})}</p>}
          {port && <AmfCandidateGallery port={port} runId={run.runId} candidates={avatars} chosen={selection.avatarPrefab} label={copy.chooseAvatar} onChoose={p => edit({...selection,avatarPrefab:p.path})}/>}
          {avatars.length === 0 && <p role="alert">{copy.noCandidate}</p>}
        </Card>
        {run.sources.filter(source => source.role !== "dependency" && source.role !== "avatar").map(source => {
          const options = run.prefabs.filter(p => p.sourceId === source.sourceId && !p.isAvatar);
          if (options.length === 0) return null;
          const chosen = selection.outfits.find(o => o.sourceId === source.sourceId); const candidate = options.find(p => p.path === chosen?.prefabPath);
          const choose = (p: AmfPrefab | undefined) => outfit(source.sourceId,p ? {prefabPath:p.path,mode:p.hasSkinnedMesh || p.hasMergeArmature ? "merge_armature" : "attach_to_bone",bone:"",toggleName:source.itemName.slice(0,80)} : null);
          return <Card key={source.sourceId}><div className="vua-n3__outfit"><h3>{source.itemName}</h3>
            {port && <AmfCandidateGallery port={port} runId={run.runId} candidates={options} chosen={chosen?.prefabPath ?? ""} label={copy.choosePrefab} onChoose={p => { if (p.path !== chosen?.prefabPath) choose(p); }}/>}
            {(options.length > 1 || !chosen) && <label className="vua-n3__field">{copy.choosePrefab}<select value={chosen?.prefabPath ?? ""} onChange={e => choose(options.find(o => o.path === e.target.value))}>
              <option value="">{copy.importedOnly}</option>{options.map(p => <option key={p.path} value={p.path}>{p.name} — {p.path}</option>)}</select></label>}
            {candidate?.hasMissingScripts && <p role="alert">{copy.missingScripts}</p>}
            {chosen && <div className="vua-n3__fields"><label>{copy.switchName}<input value={chosen.toggleName} maxLength={80} onChange={e => outfit(source.sourceId,{toggleName:e.target.value})}/></label>
              <details className="vua-n3__advanced" open={effective === "manual"}><summary>{copy.binding}</summary><label>{copy.binding}<select value={chosen.mode} onChange={e => outfit(source.sourceId,{mode:e.target.value as AmfOutfitSelection["mode"],bone:""})}>
                <option value="merge_armature" disabled={!candidate?.hasSkinnedMesh && !candidate?.hasMergeArmature}>{copy.merge}</option><option value="attach_to_bone" disabled={candidate?.hasSkinnedMesh}>{copy.attach}</option></select></label></details>
              {chosen.mode === "attach_to_bone" && <label>{copy.bone}<select value={chosen.bone} onChange={e => outfit(source.sourceId,{bone:e.target.value})}><option value="">{copy.chooseBone}</option>{avatar?.humanoidBones.map(bone => <option key={bone} value={bone}>{bone}</option>)}</select></label>}
              <label className="vua-n3__check"><input type="checkbox" checked={chosen.active} onChange={e => outfit(source.sourceId,{active:e.target.checked})}/>{copy.active}</label>
            </div>}</div></Card>;
        })}
        {selection.outfits.length === 0 && <p className="vua-text-secondary">{copy.needOutfit}</p>}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={newPreparation}>{copy.newPreparation}</Button><Button variant="subtle" disabled={busy} onClick={() => { void command("reinspect"); }}>{copy.reinspect}</Button><Button variant="primary" disabled={requesting || !selection.avatarPrefab || selection.outfits.length === 0} onClick={() => {
          if (!port) return; setRequesting(true); setError(null);
          void port.plan(runId,selection).then(setPlan).catch(e => setError(e instanceof Error ? e.message : copy.taskFailed)).finally(() => setRequesting(false));
        }}>{copy.reviewCta}</Button></div>
      </>}
      {run.phase === "ready" && plan !== null && !busy && <Card><h2>{copy.reviewTitle}</h2>
        <ul className="vua-n3__review">{plan.inputs.map(input => <li key={input.sourceId}><strong>{input.name}</strong><span>{input.role === "avatar" ? copy.avatar : input.role === "outfit" ? copy.outfit : copy.importOnly}</span></li>)}</ul>
        <ul className="vua-n3__review">{plan.selection.outfits.map(item => <li key={item.sourceId}><span>{item.toggleName || copy.importedOnly}</span><span>{item.mode === "merge_armature" ? copy.merge : `${copy.attach} · ${item.bone}`}</span></li>)}</ul>
        <p className="vua-caption vua-text-secondary">{copy.originalSafe}</p>
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setPlan(null)}>{copy.back}</Button><Button variant="primary" onClick={() => { void command("assemble"); }}>{copy.confirm}</Button></div>
      </Card>}
      {run.phase === "succeeded" && !restorePlan && <Card><h2>{copy.completed}</h2><p>{copy.next}</p>
        {port && <AmfResultViews port={port} run={run}/>}
        <ul className="vua-n3__checks">{run.result?.facts?.instances?.length ? <>
          <li>{run.result.facts.instances.every(i => i.bindingVerified) && <Icon name="check" size={16}/>} {copy.bindings}</li>
          {run.result.facts.instances.some(i => i.menuModified) && <li>{run.result.facts.instances.filter(i => i.menuModified).every(i => i.menuVerified) && <Icon name="check" size={16}/>} {copy.menus}</li>}
        </> : null}{run.result?.facts?.sdkDescriptorRecognized && <li><Icon name="check" size={16}/> {copy.sdk}</li>}
          {run.result?.facts?.missingShaderMaterials?.length === 0 && <li><Icon name="check" size={16}/> {copy.shaders}</li>}
          {run.result?.facts?.sdkSignedIn === "yes" && <li><Icon name="check" size={16}/> {copy.sdkSignedIn}</li>}</ul>
        {!!run.result?.facts?.missingShaderMaterials?.length && <p className="vua-n3__notice">{format(copy.shadersMissing,{count:String(run.result.facts.missingShaderMaterials.length)})}</p>}
        {run.result?.facts?.sdkSignedIn === "no" && <p className="vua-text-secondary">{copy.sdkSignIn}</p>}
        <p className="vua-text-secondary">{copy.sdkNotRun}</p>
        {!!run.result?.facts?.missingReferences && <p className="vua-n3__notice">{copy.warning}</p>}
        {run.result?.diagnostics?.filter(d => d.severity !== "info" && d.code !== "amf.shaders.missing").map(d => <p className="vua-caption vua-text-secondary" key={d.code}>{d.message}</p>)}
        <div className="vua-n3__actions"><Button variant="subtle" disabled={busy} onClick={newPreparation}>{copy.newPreparation}</Button><Button disabled={busy} onClick={() => { void command("reinspect"); }}>{copy.continueEditing}</Button><Button variant="primary" disabled={busy} onClick={() => { void command("open"); }}>{taskAction === "open" ? copy.opening : copy.open}</Button></div>
      </Card>}
      {!busy && !restorePlan && ["ready","succeeded"].includes(run.phase) && run.result?.facts?.observedSelection && <Card>
        <div className="vua-n3__toolbar"><h2>{copy.saveRecipe}</h2><Button onClick={() => setApplyingRecipe(true)}>{copy.applyRecipe}</Button></div><p className="vua-caption vua-text-secondary">{copy.saveRecipeHint}</p>
        {savedRecipe ? <><Button disabled={busy} onClick={() => setSharingRecipe(savedRecipe.recipe.recipeId)}>{copy.shareRecipe}</Button><p role="status">{format(copy.recipeSaved,{title:savedRecipe.recipe.title})}</p><Button onClick={() => { setSavedRecipe(null); newPreparation(); }}>{copy.recipes}</Button></> :
          <form onSubmit={event => {
            event.preventDefault(); if (!port) return; setRequesting(true); setError(null);
            void port.saveRecipe(runId,recipeTitle.trim() || run.result?.facts?.avatarName || copy.title).then(setSavedRecipe)
              .catch(e => setError(e instanceof Error ? e.message : copy.taskFailed)).finally(() => setRequesting(false));
          }}><label className="vua-n3__field">{copy.recipeName}<input value={recipeTitle} maxLength={120} placeholder={run.result.facts.avatarName || copy.title} onChange={e => setRecipeTitle(e.target.value)}/></label>
          <Button type="submit" variant="primary">{copy.saveRecipe}</Button></form>}
      </Card>}
      {run.snapshotId && !busy && !restorePlan && !plan && run.phase !== "inspect_required" && <div className="vua-n3__actions"><Button variant="subtle" onClick={() => {
        if (!port) return; setRequesting(true); setError(null);
        void port.rollbackPlan(runId).then(setRestorePlan).catch(e => setError(e instanceof Error ? e.message : copy.taskFailed)).finally(() => setRequesting(false));
      }}>{copy.restore}</Button></div>}
      <details className="vua-n3__advanced" open={effective === "manual"}><summary>{copy.advanced}</summary><p>{run.editor.version}</p><code>{run.projectRoot}</code></details>
    </>}
    </div>
    {sharingRecipe && <AmfRecipeShareDialog recipeId={sharingRecipe} onClose={() => setSharingRecipe(null)}/>}
    {applyingRecipe && <AmfRecipeApplyDialog runId={runId} onClose={() => setApplyingRecipe(false)} onReinspect={() => { setApplyingRecipe(false); void command("reinspect"); }} onApplied={accepted => {
      setApplyingRecipe(false); initialized.current = ""; setPlan(null); setSavedRecipe(null); setRestorePlan(null); setRestored(false); setError(null);
      setRunId(accepted.runId); remember(runKey, accepted.runId); setTaskId(accepted.taskId); setTaskAction("assemble");
    }}/>}
  </div>;
}

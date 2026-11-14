import { AmfRecipeShareDialog } from "./AmfRecipeShareDialog.tsx";
import { AmfRecipeApplyDialog } from "./AmfRecipeApplyDialog.tsx";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AmfAssemblySelection, AmfOutfitSelection, AmfParameterBudgetPlanV01 } from "@vua/contracts";
import { Icon, SkinMotif } from "@vua/design-system";
import { AmfProductionError, useGateway, type AmfPrefab, type AmfPlanPrediction, type AmfProductionList, type AmfProductionRun, type AmfProductionPlan, type AmfProductionRestorePlan, type AmfSavedRecipe } from "../../gateway/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { useSwapFade } from "../../components/primitives/motion.ts";
import { SegmentBar } from "../../components/SegmentBar.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { Alert } from "../../components/primitives/Alert.tsx";
import { Popconfirm } from "../../components/primitives/Popconfirm.tsx";
import { Tooltip } from "../../components/primitives/Tooltip.tsx";
import { toast } from "../../components/primitives/toast-store.ts";
import { currentLocale, strings, presentationCopy, format, formatDateMinute, formatShortDateTime, termLabel } from "../../i18n/index.ts";
import { structureCopy } from "../../i18n/structure-copy.ts";
import { openExternalUrl } from "../../app/open-external.ts";
import { lineName, rememberLineName, storedLineNames } from "./line-presentation.ts";
import { AmfRecipeImportDialog } from "./AmfRecipeImportDialog.tsx";
import { MaterialThumb, useMaterialImages } from "./PlanImages.tsx";
import { latestProductionList, PRODUCTION_LIST_FRESH_MS, readProductionList, useTaskKey } from "./production-list-read.ts";
import { initialProductionSelection, sameSelection, updateOutfitSelection } from "./production-selection-model.ts";
import { MaterialPicker } from "./MaterialPicker.tsx";
import { StatusChip, WorkshopRail, type RailLine } from "./WorkshopRail.tsx";
import { TextureMemoryCard } from "./TextureMemoryCard.tsx";
import { OutfitRemovalCard } from "./OutfitRemovalCard.tsx";
import { LightingCard } from "./LightingCard.tsx";
import { AvatarOptimizerCard } from "./AvatarOptimizerCard.tsx";
import { FaceTrackingCard, FtLockNote } from "./FaceTrackingCard.tsx";
import { RevisionsCard } from "./RevisionsCard.tsx";
import { FitSaveCard } from "./FitSaveCard.tsx";
import { PlanImages } from "./PlanImages.tsx";
import { recommendAssembly, type AmfRecommendation } from "@vua/contracts";
import "./amf-production.css";
import { AmfRecipeLibrary } from "./AmfRecipeLibrary.tsx";
import { AmfCandidateGallery, AmfResultViews } from "./AmfPreviews.tsx";
import { onProductionRunRequested, takeRequestedNewProductionLine, takeRequestedProductionRecipe, takeRequestedProductionRun, requestTurntable } from "./production-recipe-navigation.ts";
import { requestLicenseStep } from "../deployer/license-step-navigation.ts";
import { isUnityLicenseFailure, productionErrorMessage } from "./unity-license-failure.ts";
import { assemblesWithoutAsking, interruptedChange, AUTOMATION_LEVELS, currentStation, lineBusy, lineStations, lineStatus, phaseStatus, rememberAutomationLevel, STATIONS, storedAutomationLevel, type AutomationLevel, type LineStatus, type StationKey, needsFullAutoNotice } from "./factory-model.ts";
import { FullAutoConfirm, type FullAutoReason } from "./FullAutoConfirm.tsx";
import "./factory.css";
import { PermissionModePicker } from "./PermissionModePicker.tsx";
import type { AmfRunProgress } from "../../gateway/index.ts";
import { formatDuration, lineLabels, queueAhead, runStartedAt } from "./factory-model.ts";

const copy = strings.amfProduction;
const factory = strings.factory;
const editorClose = strings.amfProduction.editorClose;
const start = structureCopy[currentLocale].workshop;
/** The one switch group the workshop offers: main outfits, worn one at a time. */
const MAIN_GROUP = "main";
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
const STATION_ICONS = { prepare: "folder", inspect: "flask", plan: "edit", assemble: "outfit", check: "square-check", face: "avatar" } as const;
/** A recorded step's state, in the words of the stations. */
const stepState = (state: string) => state === "succeeded" ? "done" : state === "failed" ? "failed" : state === "running" ? "running" : "stopped";
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
  // Work started elsewhere (an AI request, the release room, another line) changes the task list;
  // the line list and the open line read again whenever a task starts or changes state.
  const taskKey = useTaskKey();
  const [runReload, setRunReload] = useState(0);
  const [list, setList] = useState<AmfProductionList | null>(() => latestProductionList(port));
  const [sourceIds, setSourceIds] = useState<readonly string[]>(storedMaterials);
  const askedMaterials = useRef<readonly string[] | null>(null);
  const [editorPath, setEditorPath] = useState("");
  const [requestedRecipe] = useState(takeRequestedProductionRecipe);
  const [runId, setRunId] = useState(() => {
    const newLine = takeRequestedNewProductionLine();
    if (newLine !== null && newLine.length > 0) askedMaterials.current = newLine;
    return takeRequestedProductionRun() ?? (requestedRecipe || newLine !== null ? "" : storedRun());
  });
  useEffect(() => { if (askedMaterials.current !== null) { setSourceIds(askedMaterials.current); askedMaterials.current = null; } }, []);
  // A new line starts from materials or from a saved Recipe; opening a Recipe shows its preview.
  const [startFrom, setStartFrom] = useState<"materials" | "recipe">("materials");
  useEffect(() => { if (runId) remember(runKey, runId); }, [runId]);
  useEffect(() => onProductionRunRequested(id => { takeRequestedProductionRun(); initialized.current = ""; setRunId(id); setError(null); }), []);
  const [run, setRun] = useState<AmfProductionRun | null>(null);
  const [selection, setSelection] = useState<AmfAssemblySelection>(blank);
  const [plan, setPlan] = useState<AmfProductionPlan | null>(null);
  const [restorePlan, setRestorePlan] = useState<AmfProductionRestorePlan | null>(null);
  const [restored, setRestored] = useState(false);
  // The line whose project Unity opened for the SDK step.
  const [opened, setOpened] = useState<string | null>(null);
  const [recipeRefresh, setRecipeRefresh] = useState(0);
  const [recipePreview, setRecipePreview] = useState<AmfSavedRecipe | null>(null);
  const [importingRecipe, setImportingRecipe] = useState(false);
  const [lineNames, setLineNames] = useState(storedLineNames);
  const materialImage = useMaterialImages();
  const [sharingRecipe, setSharingRecipe] = useState<string | null>(null);
  const [applyingRecipe, setApplyingRecipe] = useState(false);
  const [savedRecipe, setSavedRecipe] = useState<AmfSavedRecipe | null>(null);
  const [recipeTitle, setRecipeTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskQueued, setTaskQueued] = useState(false);
  const [queuedAhead, setQueuedAhead] = useState(1);
  const [taskAction, setTaskAction] = useState<"prepare" | "assemble" | "reinspect" | "rollback" | "open" | "changeSources" | "lighting" | "restoreRevision" | "texture_memory" | "faceTracking" | "optimizer" | "closeEditor" | null>(null);
  // A project_open refusal offers saving and closing Unity; the refused action continues afterwards.
  const [closeOffer, setCloseOffer] = useState<{ readonly message: string; readonly retry: (() => void) | null } | null>(null);
  const afterClose = useRef<(() => void) | null>(null);
  const [level, setLevel] = useState<AutomationLevel>(storedAutomationLevel);
  const [confirmFull, setConfirmFull] = useState<FullAutoReason | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  // The station the player opened; without one the page follows the line.
  const [chosenStation, setChosenStation] = useState<StationKey | null>(null);
  // Materials being chosen for this line, and the confirmation before the change.
  const [changing, setChanging] = useState<readonly string[] | null>(null);
  const applyLevel = (next: AutomationLevel) => { setLevel(next); rememberAutomationLevel(next); };
  // Full access changes the work project without asking, so the player reads what that means first.
  const chooseLevel = (next: AutomationLevel) => { if (next === "full" && level !== "full") setConfirmFull("switch"); else applyLevel(next); };
  const unattended = useRef(new Set<string>());
  const initialized = useRef("");
  const refreshList = useCallback(async (maxAgeMs = 0, tasks = "") => {
    if (!port) { setError(unavailable); return; }
    try {
      const observed = await readProductionList(port, maxAgeMs, tasks); setList(observed); setRecipeRefresh(value => value + 1);
      const present = new Set(observed.sources.map(source => source.sourceId));
      setSourceIds(ids => ids.filter(id => present.has(id)));
    } catch (e) { setError(productionErrorMessage(e, unavailable)); }
  }, [port]);
  // Opening the page reuses a recent list; a task change or an action here reads again.
  useEffect(() => { void refreshList(PRODUCTION_LIST_FRESH_MS, taskKey); setRunReload(value => value + 1); }, [refreshList, taskKey]);
  useEffect(() => {
    if (!port || !requestedRecipe) return;
    let alive = true; setRequesting(true); remember(runKey, "");
    void port.getRecipe(requestedRecipe).then(value => { if (alive) setRecipePreview(value); })
      .catch(e => { if (alive) setError(productionErrorMessage(e, copy.taskFailed)); })
      .finally(() => { if (alive) setRequesting(false); });
    return () => { alive = false; };
  }, [port, requestedRecipe]);
  useEffect(() => { remember(materialsKey, JSON.stringify(sourceIds)); }, [sourceIds]);
  useEffect(() => { setSavedRecipe(null); setRecipeTitle(""); }, [runId]);
  useEffect(() => {
    if (!runId || !port) { setRun(null); return; }
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    // An error from reading the run leaves once the run reads again; other errors stay until handled.
    let loadFailed = false;
    const load = async () => {
      try {
        const loaded = await port.get(runId); if (!alive) return;
        if (loadFailed) { loadFailed = false; setError(null); }
        setRun(loaded);
        if (taskId === null && initialized.current !== runId && (loaded.phase === "ready" || loaded.phase === "succeeded")) {
          initialized.current = runId; setSelection(initialProductionSelection(loaded));
        }
        // A reinspection keeps the previous phase until it ends; a running step still needs fresh facts.
        if (["preparing", "inspecting", "assembling", "restoring"].includes(loaded.phase) || loaded.steps.some(step => step.state === "running") || taskId !== null) timer = setTimeout(() => { void load(); }, 1000);
      } catch (e) { if (alive) { loadFailed = true; setError(productionErrorMessage(e, unavailable)); timer = setTimeout(() => { void load(); }, 2000); } }
    };
    void load();
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [port, runId, taskId, runReload]);
  useEffect(() => {
    if (taskId === null) return;
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const observe = async () => {
      try {
        const view = await gateway.task.snapshot(); if (!alive) return;
        const task = view.tasks.find(t => t.id === taskId);
        setTaskQueued(task?.status === "queued");
        if (task?.status === "queued" && port) { const lane = await port.list(); if (alive) setQueuedAhead(queueAhead(lane, taskId)); }
        if (task && ["completed", "completedWithWarnings", "failed", "cancelled"].includes(task.status)) {
          setTaskId(null); setTaskAction(null); void refreshList();
          if (task.status === "failed") setError(task.errorText ?? copy.taskFailed);
          if (taskAction === "rollback" && ["completed", "completedWithWarnings"].includes(task.status)) setRestored(true);
          if (taskAction === "open" && ["completed", "completedWithWarnings"].includes(task.status)) setOpened(runId);
          if (taskAction === "closeEditor") {
            const next = afterClose.current; afterClose.current = null;
            if (["completed", "completedWithWarnings"].includes(task.status)) { if (next) next(); else toast(editorClose.closed, "success"); }
          }
          return;
        }
      } catch { /* Keep waiting for an authoritative terminal task fact. */ }
      if (alive) timer = setTimeout(() => { void observe(); }, 1000);
    };
    void observe(); return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [gateway, taskId, taskAction, refreshList, runId]);

  const edit = (next: AmfAssemblySelection) => { setSelection(next); setPlan(null); setError(null); };
  const outfit = (id: string, patch: Partial<AmfOutfitSelection> | null) => edit(updateOutfitSelection(selection, id, patch));
  const busy = requesting || taskId !== null || (run !== null && ["preparing", "inspecting", "assembling", "restoring"].includes(run.phase));
  const command = async (action: "prepare" | "assemble" | "reinspect" | "rollback" | "open" | "changeSources", rollbackTarget?: "restorePoint" | "prePatch") => {
    if (!port || busy) return;
    if ((action === "assemble" && !plan) || (action === "rollback" && !restorePlan) || (action === "changeSources" && !changing)) return;
    setRequesting(true); setError(null); setChosenStation(null);
    try {
      const response = action === "prepare" ? await port.prepare(sourceIds.map(sourceId => ({ sourceId, role: "auto" })), editorPath || list?.editors[0]?.path || "")
        : action === "changeSources" && changing !== null ? await port.changeSources(runId, changing.map(sourceId => ({ sourceId, role: "auto" })))
        : action === "assemble" && plan !== null ? await port.assemble(runId, plan)
        : action === "rollback" && restorePlan !== null ? await port.rollback(runId, restorePlan, rollbackTarget)
        : action === "reinspect" ? await port.reinspect(runId) : await port.open(runId);
      setTaskId(response.taskId); setTaskAction(action);
      setRestored(false); setRestorePlan(null); setOpened(null);
      if (action === "prepare") { initialized.current = ""; setPlan(null); setSelection(blank); setRun(null); }
      if (action === "reinspect" || action === "rollback" || action === "changeSources") { initialized.current = ""; setPlan(null); setAdjusting(false); }
      if (action === "changeSources") setChanging(null);
      setRunId(response.runId); remember(runKey, response.runId);
    } catch (e) { fail(e, () => { void command(action, rollbackTarget); }); }
    finally { setRequesting(false); }
  };
  /** Shows a refusal; Unity holding the project offers saving and closing it, then `retry`. */
  const fail = (e: unknown, retry: (() => void) | null = null) => {
    const message = productionErrorMessage(e, copy.taskFailed);
    setError(message);
    setCloseOffer(e instanceof AmfProductionError && e.suggestedAction === "amf.production.closeEditor" ? { message, retry } : null);
  };
  const closeUnity = async (retry: (() => void) | null) => {
    if (!port || busy) return;
    setRequesting(true); setError(null); setCloseOffer(null);
    try {
      const accepted = await port.closeEditor(runId, true, editorClose.task);
      afterClose.current = retry; setOpened(null); setTaskId(accepted.taskId); setTaskAction("closeEditor");
    } catch (e) { fail(e); }
    finally { setRequesting(false); }
  };
  const openRecipe = (recipeId: string) => {
    if (!port) return; setRequesting(true); setError(null);
    void port.getRecipe(recipeId).then(setRecipePreview).catch(e => setError(productionErrorMessage(e, copy.taskFailed))).finally(() => setRequesting(false));
  };
  const newPreparation = () => { initialized.current = ""; setChosenStation(null); setChanging(null); setRunId(""); setRun(null); setPlan(null); setRestorePlan(null); setRestored(false); setSelection(blank); setError(null); remember(runKey, ""); void refreshList(); };
  const prepareRecipe = async () => {
    if (!port || busy || !recipePreview) return;
    const editor = list?.editors.find(e => e.version === recipePreview.recipe.editorVersion);
    if (!editor) { setError(format(copy.recipeEditor, { version: recipePreview.recipe.editorVersion })); return; }
    setRequesting(true); setError(null);
    try {
      const accepted = await port.prepareRecipe(recipePreview.recipe.recipeId, editor.path);
      initialized.current = ""; setPlan(null); setRun(null); setSelection(blank); setRestorePlan(null); setSavedRecipe(null); setRecipePreview(null);
      setRunId(accepted.runId); remember(runKey, accepted.runId); setTaskId(accepted.taskId); setTaskAction("prepare");
    } catch (e) { setError(productionErrorMessage(e, copy.taskFailed)); }
    finally { setRequesting(false); }
  };
  // Fully automatic: the one-sentence plan is the stop; confirming it reviews and assembles in one go.
  const assembleNow = async () => {
    if (!port || busy) return;
    setRequesting(true); setError(null);
    try {
      const reviewed = await port.plan(runId, selection);
      const response = await port.assemble(runId, reviewed);
      setPlan(null); setAdjusting(false); setChosenStation(null); setTaskId(response.taskId); setTaskAction("assemble"); setRunId(response.runId);
    } catch (e) { setError(productionErrorMessage(e, copy.taskFailed)); }
    finally { setRequesting(false); }
  };
  const selectLine = (id: string) => { initialized.current = ""; setChosenStation(null); setChanging(null); setRunId(id); remember(runKey, id); setPlan(null); setRestorePlan(null); setAdjusting(false); setError(null); };
  const avatars = [...new Map((run?.prefabs.filter(p => p.isAvatar && !p.hasMissingScripts && run.sources.some(s => s.sourceId === p.sourceId && (s.role === "avatar" || s.role === "auto"))) ?? []).map(p => [p.path,p])).values()];
  const avatar = avatars.find(p => p.path === selection.avatarPrefab);
  // F7: outfits whose observed prefabs carry VRCFury integration components get the
  // official guide at intake; the observation is a hint, never proof of a working setup.
  const vrcFuryOutfits = run ? [...new Set(run.prefabs.filter(p => p.hasVrcFury === true && !p.isAvatar)
    .map(p => run.sources.find(s => s.sourceId === p.sourceId)?.itemName ?? p.sourceId))] : [];

  const states = run ? lineStations(run) : null;
  const status: LineStatus | null = run ? lineStatus(run) : null;
  const effective: AutomationLevel = level;
  // One layout for every mode; the modes differ in where the line stops.
  const showDetails = adjusting;
  const chosen = !!selection.avatarPrefab && selection.outfits.length > 0;
  useEffect(() => {
    if (!run || run.runId !== runId || plan !== null || restorePlan !== null || requesting) return;
    if (!assemblesWithoutAsking(effective, run, { busy, chosen })) return;
    const key = `${run.runId}:${run.steps.length}`;
    if (unattended.current.has(key)) return;
    unattended.current.add(key);
    void assembleNow();
  });
  const ui = presentationCopy.workshop;
  const objectName = run?.result?.facts?.avatarName?.trim() || avatar?.name || (avatars.length === 1 ? avatars[0]?.name : null) || ui.unknownAvatar;
  const labels = lineLabels(list?.runs ?? [], date => formatShortDateTime(date));
  const runningStep = run?.steps.find(item => item.state === "running");
  // A creator-patched line locks the operations that cannot replay its manual steps (face_tracking_manual_replay).
  const ftLocked = run?.result?.facts?.faceTracking?.manualReplayRequired === true;
  const reviewRestore = () => {
    if (!port) return; setRequesting(true); setError(null);
    void port.rollbackPlan(runId).then(setRestorePlan).catch(e => setError(productionErrorMessage(e, copy.taskFailed))).finally(() => setRequesting(false));
  };
  const ftRestore = run?.snapshotId ? reviewRestore : null;
  // Fits the working selection would apply, by name; a Recipe's own fits carry no name.
  const fitNames = [...new Set((run?.availableFits ?? [])
    .filter(fit => fit.name !== null && selection.outfits.some(outfit => outfit.sourceId === fit.sourceId))
    .map(fit => fit.name as string))];
  // Main outfits share one switch group and are worn one at a time.
  const mainOutfits = selection.outfits.filter(item => item.group === MAIN_GROUP).map(item => item.toggleName);
  const planFitNames = [...new Set((plan?.fits ?? [])
    .filter(fit => fit.name !== null).map(fit => fit.name as string))];

  const panels = factory.panels;
  // One card per run, even if a list read ever repeats an entry.
  const lines: RailLine[] = [...new Map((list?.runs ?? []).map(recent => [recent.runId, recent] as const)).values()].map(recent => ({ runId: recent.runId, name: lineName(recent.runId, recent.sourceNames[0] ?? "", lineNames) || ui.unknownAvatar,
    extra: runStartedAt(recent.runId) ? labels.get(recent.runId)?.extra ?? null : null, status: recent.runId === run?.runId && run ? lineStatus(run) : phaseStatus(recent.phase) }));
  // Without a chosen station the page shows where the line is: planning, the finished check, or the running station.
  const shown: StationKey = chosenStation ?? (run === null || states === null ? "prepare" : plan !== null ? "plan"
    : !lineBusy(run) && run.phase === "succeeded" ? "check" : !lineBusy(run) && run.phase === "ready" ? "plan" : currentStation(states));
  const stationsRef = useRef<HTMLOListElement | null>(null);
  const mainPane = useRef<HTMLDivElement>(null);
  useSwapFade(runId, mainPane);
  const [stationIndicator, setStationIndicator] = useState<{ x: number; y: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const list = stationsRef.current;
    if (!list) return;
    let active = true;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active) return;
        const selected = list.querySelector<HTMLElement>(".vua-line__station[aria-pressed='true']");
        if (!selected) { setStationIndicator(null); return; }
        const listRect = list.getBoundingClientRect();
        const rect = selected.getBoundingClientRect();
        const next = {
          x: rect.left - listRect.left + list.scrollLeft + 12,
          y: rect.bottom - listRect.top + list.scrollTop - 2,
          width: Math.max(0, rect.width - 24),
        };
        setStationIndicator(previous => previous?.x === next.x && previous.y === next.y && previous.width === next.width ? previous : next);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.querySelectorAll(".vua-line__station").forEach(element => observer.observe(element));
    update();
    void document.fonts.ready.then(update);
    return () => {
      active = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [shown, runId]);
  const executing = states ? STATIONS.find(key => states[key] === "running") : undefined;
  const observed = run?.result?.facts?.observedSelection ?? null;
  const planOpen = run !== null && !busy && restorePlan === null && (run.phase === "ready" || run.phase === "succeeded");
  const unchangedPlan = run?.phase === "succeeded" && observed !== null && sameSelection(selection, observed);
  // Another base on an assembled line rebuilds the whole line on it.
  const rebuilding = observed !== null && selection.avatarPrefab !== "" && selection.avatarPrefab !== observed.avatarPrefab;
  const canChange = run !== null && !busy && run.sources.length > 0 && ["ready", "succeeded", "failed", "stopped"].includes(run.phase);
  const currentIds = run?.choices.map(choice => choice.sourceId) ?? [];
  const sameMaterials = changing !== null && changing.length === currentIds.length && changing.every(id => currentIds.includes(id));
  const lastInspection = run ? [...run.steps].reverse().find(item => (item.key === "inspect" || item.key === "reinspect") && item.state === "succeeded") : undefined;
  const lastAssembly = run ? [...run.steps].reverse().find(item => item.key === "assembly") : undefined;
  const materials = run === null ? [] : run.sources.length > 0 ? run.sources.map(source => ({ id: source.sourceId, item: source.itemName, name: source.name }))
    : run.choices.map(choice => { const source = list?.sources.find(item => item.sourceId === choice.sourceId); return { id: choice.sourceId, item: source?.itemName ?? choice.sourceId, name: source?.name ?? "" }; });

  return <div className="vua-page vua-n3 vua-workshop">
    <WorkshopRail lines={lines} current={runId} onSelect={selectLine} onNew={newPreparation} onRename={(id, name) => setLineNames(rememberLineName(id, name))}
      capacity={list ? { value: list.capacity, changeable: list.running.length === 0 && list.queue.length === 0 } : undefined}
      onDeleting={id => { if (id === runId) newPreparation(); }} onDeleted={() => { void refreshList(); }} onError={setError} refresh={() => { void refreshList(); }} />
    <div ref={mainPane} className="vua-workshop__main">
    {importingRecipe && <AmfRecipeImportDialog onClose={() => setImportingRecipe(false)} onImported={() => setRecipeRefresh(value => value + 1)}
      onOpen={recipeId => { setImportingRecipe(false); newPreparation(); openRecipe(recipeId); }} />}
    <FullAutoConfirm reason={confirmFull} onCancel={() => setConfirmFull(null)}
      onConfirm={reason => { setConfirmFull(null); if (reason === "switch") applyLevel("full"); else void command("prepare"); }} />
    {taskQueued && taskId !== null && <Alert tone="info" action={<Button variant="subtle" onClick={() => { void gateway.task.cancel(taskId).catch(() => {}); }} data-nav-id="workshop-queue-remove">{factory.queued.remove}</Button>}>{format(factory.queued.hint, { count: queuedAhead })}</Alert>}
    {error !== null && isUnityLicenseFailure(error) && !isUnityLicenseFailure(run?.error) ? <Alert tone="warning" title={strings.unityLicense.retry}
      action={<Button onClick={() => { requestLicenseStep(runId ? { runId } : {}); onNavigate("env-create"); }}>{strings.unityLicense.open}</Button>}>{strings.unityLicense.retryHint}</Alert>
      : error !== null && !isUnityLicenseFailure(error) && <Alert tone="error" title={copy.error} action={closeOffer !== null && closeOffer.message === error && run !== null
        ? <Popconfirm title={editorClose.confirmTitle} description={editorClose.confirmBody} confirmLabel={editorClose.confirm} cancelLabel={editorClose.cancel}
            onConfirm={() => { void closeUnity(closeOffer.retry); }}>
            <Button variant="subtle" disabled={busy} data-nav-id="workshop-close-unity">{closeOffer.retry ? editorClose.actionContinue : editorClose.action}</Button>
          </Popconfirm>
        : <Button variant="subtle" onClick={() => { setError(null); void refreshList(); }}>{copy.retry}</Button>}>{closeOffer !== null && closeOffer.message === error ? editorClose.held : error}</Alert>}
    {run !== null && list?.runs.find(item => item.runId === run.runId)?.projectGone ? (() => {
      const goneEntry = list.runs.find(item => item.runId === run.runId);
      return <>
        <header className="vua-line__header"><div className="vua-line__object"><h1 className="vua-title">{lineName(run.runId, run.sources[0]?.itemName ?? "", lineNames) || objectName}</h1></div></header>
        <Card className="vua-line__gone" data-nav-id="workshop-project-gone">
          <h2>{factory.projectGone.title}</h2>
          <div className="vua-n3__actions">
            {goneEntry?.recipeId ? <>
              <Button variant="primary" data-nav-id="workshop-rebuild-recipe" onClick={() => { const id = goneEntry.recipeId!; newPreparation(); openRecipe(id); }}>{factory.projectGone.rebuildRecipe}</Button>
              <Button variant="subtle" data-nav-id="workshop-rebuild" onClick={() => { setSourceIds(run.sources.map(item => item.sourceId)); newPreparation(); }}>{factory.projectGone.newLine}</Button>
            </> : <Button variant="primary" data-nav-id="workshop-rebuild" onClick={() => { setSourceIds(run.sources.map(item => item.sourceId)); newPreparation(); }}>{factory.projectGone.newLine}</Button>}
          </div>
        </Card>
        {port && <AmfResultViews port={port} run={run}/>}
      </>;
    })() : run === null ? <>
      <header className="vua-line__header"><div className="vua-page__hero"><h1 className="vua-title">{factory.newLine}</h1></div><PermissionModePicker value={effective} onChoose={chooseLevel} /></header>
      {recipePreview && <Card><Button disabled={busy} onClick={() => setSharingRecipe(recipePreview.recipe.recipeId)}>{copy.shareRecipe}</Button><h2>{recipePreview.recipe.title}</h2><p>{format(copy.recipeSummary,{materials:recipePreview.recipe.materials.length,outfits:recipePreview.recipe.outfits.length})}</p>
        <details><summary>{copy.materials}</summary><ul>{recipePreview.recipe.materials.map(material => <li key={material.id}>{material.packageName}</li>)}</ul></details>
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setRecipePreview(null)}>{copy.back}</Button><Button variant="primary" disabled={busy} onClick={() => { void prepareRecipe(); }}>{copy.recipeReproduce}</Button></div>
      </Card>}
      {!recipePreview && <div className="vua-line__start-row"><div className="vua-line__start-from vua-segments" role="tablist" aria-label={factory.newLine}>
        <SegmentBar selected={startFrom} />
        {(["materials", "recipe"] as const).map(option => <button type="button" role="tab" key={option} aria-selected={startFrom === option}
          data-nav-id={`workshop-start-${option}`} onClick={() => setStartFrom(option)}>{option === "materials" ? start.fromMaterials : start.fromRecipe}</button>)}
      </div><Button disabled={busy} data-nav-id="workshop-import-recipe" onClick={() => setImportingRecipe(true)}>{copy.importRecipe}</Button></div>}
      {!recipePreview && startFrom === "recipe" && <AmfRecipeLibrary refreshKey={recipeRefresh} disabled={busy} onOpen={openRecipe}/>}
      {!recipePreview && startFrom === "materials" && (list === null ? <Card><EmptyState title={requesting || error === null ? copy.loading : unavailable} /></Card>
        : list.sources.length === 0 ? <Card><EmptyState title={start.noMaterials} action={<Button variant="primary" data-nav-id="workshop-import-materials" onClick={() => onNavigate("warehouse")}>{start.importMaterials}</Button>} /></Card>
        : <>
          {list.editors.length === 0 && <Alert tone="warning" title={start.needUnity} action={<Button data-nav-id="workshop-open-unity" onClick={onPrepareEnv}>{start.openUnitySetup}</Button>}>{copy.editorMissing}</Alert>}
          <Card className="vua-line__materials-card">
            <p className="vua-caption vua-text-secondary">{start.startHint}</p>
            <MaterialPicker sources={list.sources} chosen={sourceIds} onChange={setSourceIds} disabled={busy} />
          </Card>
          <details className="vua-n3__advanced"><summary>{copy.advanced}</summary>
            {list.editors.length > 0 && <label>{copy.editor}<select value={editorPath || list.editors[0]?.path || ""} onChange={e => setEditorPath(e.target.value)}>{list.editors.map(editor => <option key={editor.path} value={editor.path}>{editor.version} — {editor.path}</option>)}</select></label>}
            <Button variant="subtle" onClick={() => { requestLicenseStep(runId ? { runId } : {}); onNavigate("env-create"); }}>{strings.unityLicense.title}</Button>
          </details>
          <div className="vua-line__start-bar">
            {sourceIds.length === 0 && <small className="vua-text-secondary" data-start-hint>{start.pickFirst}</small>}
            <Button variant="primary" data-nav-id="workshop-start-line" disabled={busy || sourceIds.length === 0 || list.editors.length === 0} onClick={() => { if (needsFullAutoNotice(level)) setConfirmFull("start"); else void command("prepare"); }}>{level === "full" ? factory.materialsStart.startFull : factory.materialsStart.start}</Button>
          </div>
        </>)}
    </> : <>
      <header className="vua-line__header">
        <div className="vua-line__object"><h1 className="vua-title">{(run && lineName(run.runId, run.sources[0]?.itemName ?? list?.runs.find(item => item.runId === run.runId)?.sourceNames[0] ?? "", lineNames)) || objectName}</h1><span className="vua-caption vua-text-secondary">{format(ui.materials, { count: materials.length })}</span></div>
        {status && <StatusChip status={status}/>}
        <SkinMotif slot="control-panel-corner" className="vua-line__skin-motif" />
        <PermissionModePicker value={effective} onChoose={chooseLevel} />
      </header>
      {states && <ol ref={stationsRef} className="vua-line__stations" aria-label={factory.lineList}>{STATIONS.map(key => <li key={key} data-state={states[key]}>
        <button type="button" className="vua-line__station" data-vua-surface-role="workshop-step" data-state={states[key]} aria-pressed={shown === key} aria-current={executing === key ? "step" : undefined}
          onClick={() => setChosenStation(key)} data-nav-id={`workshop-station-${key}`}>
          <Icon name={STATION_ICONS[key]} size={20}/>
          <strong>{factory.stations[key]}</strong><small>{factory.stationState[states[key]]}</small>
        </button></li>)}
        {stationIndicator && <span key={runId} className="vua-line__station-indicator" aria-hidden="true"
          style={{ width: stationIndicator.width, transform: `translate(${stationIndicator.x}px, ${stationIndicator.y}px)` }} />}
      </ol>}
      {executing && executing !== shown && <div className="vua-line__context" role="status"><strong>{format(ui.viewing, { step: factory.stations[shown] })}</strong><span>{format(ui.executing, { step: factory.stations[executing] })}</span>
        <Button variant="subtle" data-nav-id="workshop-follow-line" onClick={() => setChosenStation(null)}>{factory.stations[executing]}</Button></div>}
      {lineBusy(run) && <Card className="vua-line__live" aria-live="polite">
        <div className="vua-line__live-head"><span className="vua-n3__spinner" aria-hidden="true"/>
          <strong>{runningStep ? copy.step[runningStep.key as keyof typeof copy.step] ?? runningStep.name : run.phase === "assembling" ? copy.assembling : run.phase === "restoring" ? copy.restoring : copy.preparing}</strong></div>
        {runningStep?.detail && <p className="vua-caption vua-text-secondary">{runningStep.detail}</p>}
        {run.progress && <LiveProgress progress={run.progress}/>}
        <div className="vua-n3__actions">
          <Tooltip content={factory.stopTip}><Button variant="subtle" disabled={!taskId && !run.taskId} onClick={() => { void gateway.task.cancel(taskId ?? run.taskId); }}>{factory.stop}</Button></Tooltip></div>
      </Card>}
      {!lineBusy(run) && (status === "attention" || status === "stopped") && <Card className="vua-line__attention" data-status={status}>
        <h2>{status === "stopped" ? factory.status.stopped : factory.attentionTitle}</h2>
        {run.error && isUnityLicenseFailure(run.error) ? <><p role="alert">{strings.unityLicense.retryHint}</p>
          <Button variant="primary" data-nav-id="workshop-fix-license" onClick={() => { requestLicenseStep(runId ? { runId } : {}); onNavigate("env-create"); }}>{strings.unityLicense.open}</Button></>
          : run.error && <p role="alert">{run.error.replace(/^vua.[a-z_.]+ — detail: /u, "")}</p>}
        {run.recovery && <p className="vua-n3__notice">{run.recovery === "restored" ? copy.recovered : copy.recoveryFailed}</p>}
        {interruptedChange(run) && <p>{factory.interrupted.hint}</p>}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={newPreparation}>{factory.newLine}</Button>
          {interruptedChange(run) && run.snapshotId && <Button disabled={busy || requesting} onClick={() => {
            if (!port) return; setRequesting(true); setError(null);
            void port.rollbackPlan(runId).then(setRestorePlan).catch(e => setError(productionErrorMessage(e, copy.taskFailed))).finally(() => setRequesting(false));
          }} data-nav-id="workshop-restore-interrupted">{factory.interrupted.restore}</Button>}
          {run.sources.length > 0 && <Button variant={run.error && isUnityLicenseFailure(run.error) ? "default" : "primary"} disabled={busy} onClick={() => { void command("reinspect"); }}>{factory.continue}</Button>}</div>
        <details className="vua-n3__advanced"><summary>{factory.details}</summary><ul className="vua-n3__progress">{run.steps.map((item,index) => <li key={`${item.key}-${index}`} data-state={item.state}>
          <span aria-hidden="true">{item.state === "succeeded" ? <Icon name="check" size={16}/> : item.state === "failed" ? <Icon name="warning" size={16}/> : <Icon name="dash" size={16}/>}</span>
          <span>{copy.step[item.key as keyof typeof copy.step] ?? item.name}{item.detail && <small>{item.detail}</small>}</span></li>)}</ul>
          {run.error && <code>{run.error}</code>}</details>
      </Card>}
      {restored && !busy && <Card><p role="status">{copy.restored}</p></Card>}
      {restorePlan && !busy && <Card><h2>{copy.restoreTitle}</h2><p>{copy.restoreHint}</p>
        {restorePlan.currentChanged && <p className="vua-n3__notice">{copy.restoreChanged}</p>}
        {restorePlan.prePatch && <p className="vua-n3__notice">{copy.restorePrePatchHint}</p>}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setRestorePlan(null)}>{copy.back}</Button>
          {restorePlan.prePatch && <Button variant="subtle" onClick={() => { void command("rollback", "prePatch"); }}>{copy.restorePrePatch}</Button>}
          <Button variant="primary" onClick={() => { void command("rollback"); }}>{copy.restoreConfirm}</Button></div>
      </Card>}
      {shown === "prepare" && <Card className="vua-line__panel">
        <h2>{panels.materials.title}</h2>
        {changing === null && <ul className="vua-line__materials">{materials.map(item => <li key={item.id}>
          <MaterialThumb src={materialImage(list?.sources.find(source => source.sourceId === item.id))} />
          <span><strong>{item.item}</strong>{item.name && <small>{item.name}</small>}</span></li>)}</ul>}
        {ftLocked && <FtLockNote onRestore={ftRestore} onNewLine={newPreparation} disabled={busy} />}
        {changing === null ? <div className="vua-n3__actions"><Button disabled={!canChange || ftLocked} onClick={() => setChanging(currentIds)} data-nav-id="workshop-change-materials">{panels.materials.change}</Button>
          <Button disabled={busy} data-nav-id="workshop-line-import-recipe" onClick={() => setImportingRecipe(true)}>{copy.importRecipe}</Button></div> : <>
          <h3>{panels.materials.changeTitle}</h3>
          <MaterialPicker sources={list?.sources ?? []} chosen={changing} onChange={setChanging} disabled={busy} />
          {sameMaterials && <p className="vua-caption vua-text-secondary">{panels.materials.unchanged}</p>}
          <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setChanging(null)}>{panels.materials.cancel}</Button>
            <Popconfirm title={panels.materials.confirmTitle} description={panels.materials.confirmBody} confirmLabel={panels.materials.confirm} cancelLabel={panels.materials.cancel}
              onConfirm={() => { void command("changeSources"); }}>
              <Button variant="primary" disabled={!canChange || sameMaterials || changing.length === 0 || ftLocked} data-nav-id="workshop-apply-materials">{panels.materials.apply}</Button>
            </Popconfirm></div>
        </>}
      </Card>}
      {shown === "inspect" && <Card className="vua-line__panel">
        <h2>{panels.inspect.title}</h2>
        {run.prefabs.length === 0 ? <p className="vua-text-secondary">{panels.inspect.waiting}</p> : <ul className="vua-line__found">
          <li>{format(panels.inspect.avatars, { names: avatars.map(item => item.name).join(" · ") || copy.noCandidate })}</li>
          {run.sources.filter(source => source.role !== "dependency" && source.role !== "avatar").map(source => {
            const count = run.prefabs.filter(item => item.sourceId === source.sourceId && !item.isAvatar).length;
            return count > 0 ? <li key={source.sourceId}>{format(panels.inspect.outfits, { source: source.itemName, count })}</li> : null;
          })}
        </ul>}
        {vrcFuryOutfits.length > 0 && <p role="status" className="vua-n3__notice">{format(panels.inspect.vrcFury, { sources: vrcFuryOutfits.join(" · ") })}
          <Button variant="subtle" onClick={() => { void openExternalUrl("https://vrcfury.com/download"); }}>{panels.inspect.vrcFuryGuide}</Button></p>}
        {run.result?.diagnostics?.filter(d => d.severity !== "info").map(d => <p role="status" className="vua-n3__notice" key={d.code}>{d.message}</p>)}
        {lastInspection?.endedAt && <p className="vua-caption vua-text-secondary">{format(panels.inspect.checkedAt, { time: formatDateMinute(lastInspection.endedAt) })}</p>}
        <div className="vua-n3__actions"><Button disabled={busy || run.sources.length === 0} onClick={() => { void command("reinspect"); }} data-nav-id="workshop-recheck">{panels.inspect.recheck}</Button></div>
      </Card>}
      {shown === "plan" && !planOpen && plan === null && <Card className="vua-line__panel"><h2>{factory.stations.plan}</h2><p className="vua-text-secondary">{panels.plan.waiting}</p></Card>}
      {shown === "plan" && planOpen && plan === null && !showDetails && <Card className="vua-line__summary">
        <h2>{factory.stations.plan}</h2>
        <p className="vua-line__sentence">{format(factory.planSentence, { avatar: avatar?.name ?? copy.choosePrefab, outfits: selection.outfits.map(item => item.toggleName).join(" · ") || copy.needOutfit })}</p>
        <PlanImages run={run} selection={selection} librarySources={list?.sources ?? []} />
        {mainOutfits.length > 1 && <p className="vua-caption vua-text-secondary">{format(copy.switchMainNote, { names: mainOutfits.join(" · ") })}</p>}
        {fitNames.length > 0 && <p className="vua-caption vua-text-secondary">{format(panels.plan.fits, { names: fitNames.join(" · ") })}</p>}
        {run.selection === null && !run.result?.facts?.observedSelection && <RecommendationNote recommendation={recommendAssembly(run.prefabs, run.sources)} prefabs={run.prefabs} />}
        {port && avatar && <AmfCandidateGallery port={port} runId={run.runId} candidates={[avatar, ...run.prefabs.filter(p => selection.outfits.some(o => o.prefabPath === p.path))]} chosen={avatar.path} label={copy.chooseAvatar} onChoose={() => setAdjusting(true)}/>}
        {rebuilding ? <p className="vua-n3__notice">{copy.rebuildNote}</p> : null}
        {unchangedPlan && <p className="vua-caption vua-text-secondary">{panels.plan.current}</p>}
        {ftLocked && <FtLockNote onRestore={ftRestore} onNewLine={newPreparation} disabled={busy} />}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setAdjusting(true)} data-nav-id="workshop-plan-adjust">{factory.adjust}</Button>
          <Button variant="primary" disabled={requesting || unchangedPlan || !selection.avatarPrefab || selection.outfits.length === 0 || ftLocked} onClick={() => { void assembleNow(); }}>{factory.placeOrder}</Button></div>
      </Card>}
      {shown === "plan" && planOpen && plan === null && showDetails && <>
        <Card><h2>{copy.menuTitle}</h2><p className="vua-caption vua-text-secondary">{copy.menuHint}</p>
          {avatars.length !== 1 ? <label className="vua-n3__field">{copy.chooseAvatar}<select value={selection.avatarPrefab} onChange={e => edit({...selection,avatarPrefab:e.target.value})}><option value="">{copy.choosePrefab}</option>{avatars.map(p => <option key={`${p.sourceId}-${p.path}`} value={p.path}>{p.name} — {p.path}</option>)}</select></label> : <p>{format(copy.preparedAvatar,{name:avatar?.name ?? avatars[0]?.name ?? ""})}</p>}
          {port && <AmfCandidateGallery port={port} runId={run.runId} candidates={avatars} chosen={selection.avatarPrefab} label={copy.chooseAvatar} onChoose={p => edit({...selection,avatarPrefab:p.path})}/>}
          {avatars.length === 0 && <p role="alert">{copy.noCandidate}</p>}
          {rebuilding && <p className="vua-n3__notice">{copy.rebuildNote}</p>}
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
              <details className="vua-n3__advanced"><summary>{copy.binding}</summary><label>{copy.binding}<select value={chosen.mode} onChange={e => outfit(source.sourceId,{mode:e.target.value as AmfOutfitSelection["mode"],bone:""})}>
                <option value="merge_armature" disabled={!candidate?.hasSkinnedMesh && !candidate?.hasMergeArmature}>{copy.merge}</option><option value="attach_to_bone" disabled={candidate?.hasSkinnedMesh}>{copy.attach}</option></select></label></details>
              {chosen.mode === "attach_to_bone" && <label>{copy.bone}<select value={chosen.bone} onChange={e => outfit(source.sourceId,{bone:e.target.value})}><option value="">{copy.chooseBone}</option>{avatar?.humanoidBones.map(bone => <option key={bone} value={bone}>{bone}</option>)}</select></label>}
              <label className="vua-n3__check"><input type="checkbox" checked={chosen.active} onChange={e => outfit(source.sourceId,{active:e.target.checked})}/>{copy.active}</label>
              <label className="vua-n3__check"><input type="checkbox" checked={chosen.group === MAIN_GROUP} disabled={!chosen.toggleName.trim()}
                onChange={e => outfit(source.sourceId,{group:e.target.checked ? MAIN_GROUP : ""})} data-nav-id={`workshop-switch-main-${source.sourceId}`}/>{copy.switchMain}</label>
              <label className="vua-n3__check"><input type="checkbox" checked={chosen.saved !== false} disabled={!chosen.toggleName.trim()}
                onChange={e => outfit(source.sourceId,{saved:e.target.checked})}/>{copy.switchSaved}</label>
            </div>}</div></Card>;
        })}
        {selection.outfits.length === 0 && <p className="vua-text-secondary">{copy.needOutfit}</p>}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setAdjusting(false)}>{copy.back}</Button><Button variant="primary" disabled={requesting || !selection.avatarPrefab || selection.outfits.length === 0} data-nav-id="workshop-plan-review" onClick={() => {
          if (!port) return; setRequesting(true); setError(null);
          void port.plan(runId,selection).then(setPlan).catch(e => setError(productionErrorMessage(e, copy.taskFailed))).finally(() => setRequesting(false));
        }}>{copy.reviewCta}</Button></div>
      </>}
      {shown === "plan" && run.phase === "succeeded" && port && !busy && <OutfitRemovalCard port={port} run={run} disabled={busy}
        onStarted={task => { initialized.current = ""; setTaskId(task); setTaskAction("assemble"); setPlan(null); setAdjusting(false); setChosenStation(null); }} onError={e => fail(e)}/>}
      {shown === "plan" && (run.phase === "ready" || run.phase === "succeeded") && plan !== null && !busy && <Card><h2>{copy.reviewTitle}</h2>
        <ul className="vua-n3__review">{plan.inputs.map(input => <li key={input.sourceId}><strong>{input.name}</strong><span>{input.role === "avatar" ? copy.avatar : input.role === "outfit" ? copy.outfit : copy.importOnly}</span></li>)}</ul>
        <ul className="vua-n3__review">{plan.selection.outfits.map(item => <li key={item.sourceId}><span>{item.toggleName || copy.importedOnly}
          {item.group ? <small className="vua-n3__tag">{copy.switchMainTag}</small> : null}{item.saved === false ? <small className="vua-n3__tag">{copy.switchUnsavedTag}</small> : null}</span>
          <span>{item.mode === "merge_armature" ? copy.merge : `${copy.attach} · ${item.bone}`}</span></li>)}</ul>
        {planFitNames.length > 0 && <p className="vua-caption vua-text-secondary">{format(panels.plan.fits, { names: planFitNames.join(" · ") })}</p>}
        {plan.parameterBudget && <ParameterBudgetNote budget={plan.parameterBudget}/>}
        {plan.prediction && <PredictionNote prediction={plan.prediction}/>}
        {plan.rebuild ? <p className="vua-n3__notice">{copy.rebuildNote}</p> : null}
        {ftLocked && <FtLockNote onRestore={ftRestore} onNewLine={newPreparation} disabled={busy} />}
        <div className="vua-n3__actions"><Button variant="subtle" onClick={() => setPlan(null)}>{copy.back}</Button><Button variant="primary" disabled={ftLocked} onClick={() => { void command("assemble"); }}>{copy.confirm}</Button></div>
      </Card>}
      {shown === "assemble" && <Card className="vua-line__panel">
        <h2>{factory.stations.assemble}</h2>
        {lastAssembly ? <p>{format(panels.assemble.last, { time: formatDateMinute(lastAssembly.endedAt ?? lastAssembly.startedAt ?? "") })} · {factory.stationState[stepState(lastAssembly.state)]}</p>
          : <p className="vua-text-secondary">{panels.assemble.waiting}</p>}
        {run.snapshotId && !busy && !restorePlan && !plan && run.phase !== "inspect_required" && <>
          <div className="vua-n3__actions"><Button variant="subtle" onClick={() => {
            if (!port) return; setRequesting(true); setError(null);
            void port.rollbackPlan(runId).then(setRestorePlan).catch(e => setError(productionErrorMessage(e, copy.taskFailed))).finally(() => setRequesting(false));
          }} data-nav-id="workshop-restore">{copy.restore}</Button></div>
        </>}
      </Card>}
      {shown === "assemble" && port && <RevisionsCard port={port} run={run} disabled={busy}
        onStarted={accepted => { setTaskId(accepted); setTaskAction("restoreRevision"); }} />}
      {shown === "check" && !(run.phase === "succeeded" && !restorePlan) && <Card className="vua-line__panel"><h2>{factory.stations.check}</h2><p className="vua-text-secondary">{panels.check.waiting}</p></Card>}
      {shown === "check" && run.phase === "succeeded" && !restorePlan && <Card><h2>{copy.completed}</h2><p>{copy.next}</p>
        {port && <AmfResultViews port={port} run={run}/>}
        <ul className="vua-n3__checks">{run.result?.facts?.instances?.length ? <>
          <li>{run.result.facts.instances.every(i => i.bindingVerified) && <Icon name="check" size={16}/>} {copy.bindings}</li>
          {run.result.facts.instances.some(i => i.menuModified) && <li>{run.result.facts.instances.filter(i => i.menuModified).every(i => i.menuVerified) && <Icon name="check" size={16}/>} {copy.menus}</li>}
        </> : null}{run.result?.facts?.sdkDescriptorRecognized && <li><Icon name="check" size={16}/> {copy.sdk}</li>}
          {run.result?.facts?.missingShaderMaterials?.length === 0 && <li><Icon name="check" size={16}/> {copy.shaders}</li>}
          {run.result?.facts?.sdkSignedIn === "yes" && <li><Icon name="check" size={16}/> {copy.sdkSignedIn}</li>}</ul>
        {!!run.result?.facts?.missingShaderMaterials?.length && <p className="vua-n3__notice">{format(copy.shadersMissing,{count:String(run.result.facts.missingShaderMaterials.length)})}</p>}
        {run.result?.facts?.sdkSignedIn === "no" && <p className="vua-text-secondary">{copy.sdkSignIn}</p>}
        {!!run.result?.facts?.missingReferences && <p className="vua-n3__notice">{copy.warning}</p>}
        {run.result?.diagnostics?.filter(d => d.severity !== "info" && d.code !== "amf.shaders.missing").map(d => <p className="vua-caption vua-text-secondary" key={d.code}>{d.message}</p>)}
        <div className="vua-n3__actions"><Button disabled={busy} onClick={() => { void command("open"); }} data-nav-id="workshop-open">{taskAction === "open" ? copy.opening : copy.open}</Button><Button variant="primary" onClick={() => { if (effective === "full") requestTurntable(run.runId); onNavigate("release"); }} data-nav-id="workshop-to-release">{start.toFinished}</Button></div>
        {opened === runId && taskAction !== "open" && <p role="status"><Icon name="check" size={16}/> {copy.opened}</p>}
        {taskAction === "closeEditor" && <p role="status" className="vua-caption vua-text-secondary">{editorClose.closing}</p>}
        {(taskAction === "open" || opened === runId) && <p className="vua-caption vua-text-secondary">{copy.openedPanel}</p>}
        {opened === runId && taskAction !== "open" && <div className="vua-n3__actions">
          <Popconfirm title={editorClose.confirmTitle} description={editorClose.confirmBody} confirmLabel={editorClose.confirm} cancelLabel={editorClose.cancel}
            onConfirm={() => { void closeUnity(null); }}>
            <Button variant="subtle" disabled={busy} data-nav-id="workshop-done-checking">{editorClose.doneChecking}</Button>
          </Popconfirm></div>}
      </Card>}
      {shown === "check" && !restorePlan && (run.phase === "succeeded" || (busy && !!run.result?.facts?.textureMemory?.length)) && port && <TextureMemoryCard port={port} run={run} level={level} disabled={busy}
        onStarted={taskId => { setTaskId(taskId); setTaskAction("texture_memory"); }} onError={e => fail(e)}/>}
      {shown === "check" && !busy && !restorePlan && run.phase === "succeeded" && port && <LightingCard port={port} run={run} level={level} disabled={busy}
        onStarted={taskId => { setTaskId(taskId); setTaskAction("lighting"); }} onError={e => fail(e)}/>}
      {shown === "check" && !restorePlan && run.phase === "succeeded" && port && <AvatarOptimizerCard port={port} run={run} disabled={busy} ftLocked={ftLocked}
        onStarted={taskId => { setTaskId(taskId); setTaskAction("optimizer"); }} onError={e => fail(e)}/>}
      {shown === "check" && !busy && !restorePlan && run.phase === "succeeded" && port && <FitSaveCard port={port} run={run} disabled={busy} />}
      {shown === "check" && !busy && !restorePlan && run.phase === "succeeded" && run.result?.facts?.observedSelection && <Card>
        <div className="vua-n3__toolbar"><h2>{copy.saveRecipe}</h2><Button disabled={ftLocked} onClick={() => setApplyingRecipe(true)}>{copy.applyRecipe}</Button></div>
        {ftLocked && <FtLockNote onRestore={ftRestore} onNewLine={newPreparation} disabled={busy} />}
        {savedRecipe ? <><Button disabled={busy} onClick={() => setSharingRecipe(savedRecipe.recipe.recipeId)}>{copy.shareRecipe}</Button><p role="status">{format(copy.recipeSaved,{title:savedRecipe.recipe.title})}</p><Button onClick={() => { setSavedRecipe(null); newPreparation(); }}>{copy.recipes}</Button></> :
          <form onSubmit={event => {
            event.preventDefault(); if (!port) return; setRequesting(true); setError(null);
            void port.saveRecipe(runId,recipeTitle.trim() || run.result?.facts?.avatarName || copy.title).then(setSavedRecipe)
              .catch(e => setError(productionErrorMessage(e, copy.taskFailed))).finally(() => setRequesting(false));
          }}><label className="vua-n3__field">{copy.recipeName}<input value={recipeTitle} maxLength={120} placeholder={run.result.facts.avatarName || copy.title} onChange={e => setRecipeTitle(e.target.value)}/></label>
          <Button type="submit" variant="default" disabled={ftLocked}>{copy.saveRecipe}</Button></form>}
      </Card>}
      <details className="vua-n3__advanced vua-line__source-details"><summary>{ui.details}</summary><dl><dt>{ui.lineId}</dt><dd>{run.runId}</dd><dt>{copy.editor}</dt><dd>{run.editor.version}</dd></dl><code>{run.projectRoot}</code><ul>{materials.map(material => <li key={material.id}>{material.item}<small>{material.name} · {material.id}</small></li>)}</ul></details>
      {shown === "face" && port && <FaceTrackingCard port={port} run={run} disabled={busy} onUnityHolds={e => fail(e)}
        onStarted={id => { setTaskId(id); setTaskAction("faceTracking"); }} onRestore={ftRestore} onNewLine={newPreparation} />}
    </>}
    </div>
    {sharingRecipe && <AmfRecipeShareDialog recipeId={sharingRecipe} onClose={() => setSharingRecipe(null)}/>}
    {applyingRecipe && <AmfRecipeApplyDialog runId={runId} onClose={() => setApplyingRecipe(false)} onReinspect={() => { setApplyingRecipe(false); void command("reinspect"); }} onApplied={accepted => {
      setApplyingRecipe(false); initialized.current = ""; setPlan(null); setSavedRecipe(null); setRestorePlan(null); setRestored(false); setError(null);
      setRunId(accepted.runId); remember(runKey, accepted.runId); setTaskId(accepted.taskId); setTaskAction("assemble");
    }}/>}
  </div>;
}

/** The plan's estimate of the synced parameter bits the assembled Avatar would use, with the
 *  sources that spend them. MA merges parameters at build time, so the number is an estimate. */
function ParameterBudgetNote({ budget }: { budget: AmfParameterBudgetPlanV01 }) {
  const budgetCopy = copy.parameterBudget;
  const kind = (source: AmfParameterBudgetPlanV01["sources"][number]) =>
    source.kind === "expression_parameters" ? budgetCopy.own : source.origin === "avatar_base" ? budgetCopy.embedded : budgetCopy.outfit;
  if (budget.state === "unknown") return <p className="vua-caption vua-text-secondary">{budgetCopy.unknown}</p>;
  return <div className="vua-line__budget">
    <p className={budget.state === "over_limit" ? "vua-n3__notice" : undefined} role={budget.state === "over_limit" ? "alert" : undefined}>
      {budgetCopy.title} · {budgetCopy.estimate} · {format(budgetCopy.total, { used: String(budget.estimateBits), limit: String(budget.limitBits) })}
      {budget.state === "over_limit" ? ` ${budgetCopy.overLimit}` : budget.state === "near_limit" ? ` ${budgetCopy.nearLimit}` : ""}
    </p>
    <ul className="vua-n3__review">{budget.sources.map((source, index) => <li key={`${source.kind}-${source.name}-${index}`}>
      <strong>{source.name}</strong><span>{kind(source)} · {source.bits} bit</span></li>)}</ul>
    {budget.unresolvedPrefixConfigs > 0 && <p className="vua-caption vua-text-secondary">
      {format(budgetCopy.prefixNote, { count: String(budget.unresolvedPrefixConfigs) })}</p>}
  </div>;
}

/** The plan's pre-assembly cost prediction (freeze row F5): one row per Avatar or outfit with
 *  its size, triangles, material slots, texture memory, PhysBones and parameter bits. */
function PredictionNote({ prediction }: { prediction: AmfPlanPrediction }) {
  const predictionCopy = copy.prediction;
  if (!prediction.available) return <p className="vua-caption vua-text-secondary">{predictionCopy.unavailable}</p>;
  const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  const cells = (row: { triangles: number; materialSlots: number; textureBytes: number; physBones: number; parameterBits: number | null; uncompressedBytes: number }) => [
    `≈ ${megabytes(row.uncompressedBytes)}`, row.triangles.toLocaleString(), String(row.materialSlots), `≈ ${megabytes(row.textureBytes)}`,
    String(row.physBones), row.parameterBits === null ? "—" : `${row.parameterBits} / 256`,
  ];
  const columns = ["size", "triangles", "materialSlots", "textureMemory", "physBones", "parameterBits"] as const;
  const ranks = prediction.total?.performanceRanks;
  return <div className="vua-line__prediction">
    <p>{predictionCopy.title}</p>
    {ranks && <p className="vua-caption" data-testid="prediction-performance-ranks">
      {format(predictionCopy.rankSummary, {
        pc: predictionCopy.ranks[ranks.pc.rank],
        android: predictionCopy.ranks[ranks.android.rank],
      })}
    </p>}
    <table className="vua-line__prediction-table">
      <thead><tr><th scope="col"/>{columns.map(column => <th key={column} scope="col">{predictionCopy.columns[column]}</th>)}</tr></thead>
      <tbody>
        {prediction.rows.map(row => <tr key={`${row.role}-${row.sourceId}`}>
          <th scope="row">{row.name}{row.role === "avatar" && <small>{copy.avatar}</small>}</th>
          {cells(row).map((cell, index) => <td key={columns[index]}>{cell}</td>)}
        </tr>)}
        {prediction.total && <tr className="vua-line__prediction-total"><th scope="row">{predictionCopy.total}</th>
          {cells(prediction.total).map((cell, index) => <td key={columns[index]}>{cell}</td>)}</tr>}
      </tbody>
    </table>
    {ranks && ranks.pc.limitingMetrics.length > 0 && <p className="vua-caption vua-text-secondary">
      {format(predictionCopy.limiting, {
        platform: predictionCopy.platforms.pc,
        metrics: ranks.pc.limitingMetrics.map(m => predictionCopy.metricNames[m]).join(", "),
      })}
    </p>}
    {ranks && ranks.android.limitingMetrics.length > 0 && <p className="vua-caption vua-text-secondary">
      {format(predictionCopy.limiting, {
        platform: predictionCopy.platforms.android,
        metrics: ranks.android.limitingMetrics.map(m => predictionCopy.metricNames[m]).join(", "),
      })}
    </p>}
    <p className="vua-caption vua-text-secondary">{predictionCopy.note}</p>
    {prediction.rows.some(row => !row.complete) && <p className="vua-caption vua-text-secondary">{predictionCopy.incomplete}</p>}
  </div>;
}

/** Why VUA chose the Avatar and outfits it starts the plan with, in its stated rules. */
function RecommendationNote({ recommendation, prefabs }: { recommendation: AmfRecommendation; prefabs: readonly AmfPrefab[] }) {  const reasons = strings.factory.reasons;
  const prefabName = (path: string) => prefabs.find(prefab => prefab.path === path)?.name ?? path.split("/").pop()?.replace(/\.prefab$/iu, "") ?? path;
  const parts = [
    ...(recommendation.avatar.path && recommendation.avatar.reason && recommendation.avatar.reason !== "only" ? [format(reasons[recommendation.avatar.reason], { name: prefabName(recommendation.avatar.path) })] : []),
    ...recommendation.outfits.flatMap(outfit => outfit.path && outfit.reason && outfit.reason !== "only" ? [format(reasons[outfit.reason], { name: prefabName(outfit.path) })] : []),
  ];
  if (parts.length === 0) return null;
  return <p className="vua-caption vua-text-secondary">{format(reasons.lead, { reasons: parts.join(reasons.join) })}</p>;
}

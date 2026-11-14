/** The release room: finished Avatars as an album with their turntable and upload, and, with the
 * experimental VRChat sign-in, the account's own Avatars on VRChat. The production records live in
 * Settings → Debugging information. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert } from "../../../components/primitives/Alert.tsx";
import { Button } from "../../../components/primitives/Button.tsx";
import { ConfirmDialog } from "../../../components/primitives/ConfirmDialog.tsx";
import { openEncyclopedia } from "../../help/encyclopedia-navigation.ts";
import { Icon } from "@vua/design-system";
import type { AiUploadConfirmationV01 } from "@vua/contracts";
import { useGateway, type AmfProductionList, type AmfProductionPort, type AmfProductionRun, type AmfReleasePort, type AmfReleaseState, type VrchatAvatarCheck, type VrchatPort } from "../../../gateway/index.ts";
import type { PageId } from "../../../app/nav-model.ts";
import { EmptyState } from "../../../components/primitives/EmptyState.tsx";
import { format, formatDateTime, formatShortDateTime, strings, termLabel } from "../../../i18n/index.ts";
import { queueAhead, runStartedAt } from "../factory-model.ts";
import { useAiRequests } from "../../ai-requests/use-ai-requests.ts";
import { requestRunId } from "../../ai-requests/ai-request-routing.ts";
import { onRequestRevealed } from "../../ai-requests/ai-request-reveal.ts";
import { ReleaseAlbum, type AlbumSpread } from "./ReleaseAlbum.tsx";
import { ReleaseStage, StagePhoto } from "./ReleaseStage.tsx";
import { ReleaseSheet } from "./ReleaseSheet.tsx";
import { LineTerms } from "./LineTerms.tsx";
import { ReleaseUploadDialog } from "./ReleaseUploadDialog.tsx";
import { baseName, finishedRunIds, lastStep, proposedUploadName, runBusy, runningLocalTest, runningUpload, sdkReviewView, uploadedAvatarId, uploadedAvatarIds } from "./release-model.ts";
import { VrchatAvatarShelf } from "./VrchatAvatarShelf.tsx";
import "./release-album.css";
import { TurntableExportDialog } from "./TurntableExportDialog.tsx";
import { recipeShareCopy } from "../../../i18n/index.ts";
import { lineName } from "../line-presentation.ts";
import { SegmentBar } from "../../../components/SegmentBar.tsx";
import { requestNewProductionLine, requestProductionRecipe, takeRequestedTurntable } from "../production-recipe-navigation.ts";

const copy = strings.releaseRoom;
const shelfCopy = strings.vrchat.shelf;
type View = "album" | "vrchat";

/** A failed start in plain words; the backend's detail stays under Details. */
export function ActionError({ error, onCheckAgain }: { error: unknown; onCheckAgain?: () => void }) {
  if (error === null || error === undefined) return null;
  const code = String((error as { code?: unknown }).code ?? (error instanceof Error ? error.message : "")).replace(/^vua\.amf_production\./u, "");
  const known = (copy.errors as Record<string, string>)[code];
  const detail = error instanceof Error && error.message !== code && !error.message.startsWith("vua.") ? error.message : "";
  return <Alert tone="error" className="vua-release-room__error"
    action={code === "project_drift" && onCheckAgain ? <button type="button" className="vua-release-upload__link" onClick={onCheckAgain}>{copy.upload.checkAgain}</button> : undefined}>
    <p>{known ?? copy.errors.other}</p>
    {detail && !known && <details><summary>{copy.upload.details}</summary><p>{detail}</p></details>}
  </Alert>;
}

function TurntableBar({ run, state, busy, error, onBake, onExport }: { run: AmfProductionRun; state: AmfReleaseState | null; busy: boolean; error: unknown; onBake: () => void; onExport: () => void }) {
  const turntable = state?.turntable ?? null;
  const step = lastStep(run, "turntable");
  const baking = step?.state === "running";
  const failed = !baking && step?.state === "failed" && !turntable?.current;
  return <div className="vua-album__turntable">
    <span className="vua-album__turntable-title"><Icon name="anim" size={16} />{copy.turntable.title}</span>
    {baking ? <span className="vua-album__working" role="status">{copy.turntable.baking}</span>
      : turntable?.current ? <>
        <span className="vua-text-secondary">{formatDateTime(turntable.bakedAt)}</span>
        <button type="button" className="vua-release-upload__link" onClick={onBake} disabled={busy}>{copy.turntable.bakeAgain}</button>
        {window.vua?.dialog?.recipeSharing && <button type="button" className="vua-album__bake" onClick={onExport} disabled={busy}>{recipeShareCopy.export}</button>}
      </> : <>
        {turntable || state?.editorOpen ? <span className="vua-text-secondary">{turntable ? copy.turntable.stale : copy.turntable.unityOpen}</span> : null}
        <button type="button" className="vua-album__bake" onClick={onBake} disabled={busy || state?.editorOpen}>{turntable ? copy.turntable.bakeAgain : copy.turntable.bake}</button>
      </>}
    {failed && <p className="vua-album__failed" role="alert">{copy.turntable.failed}{step?.detail ? <details><summary>{copy.upload.details}</summary><p>{step.detail}</p></details> : null}</p>}
    <ActionError error={error} />
  </div>;
}

/** Runs and release states of the shown spread and its neighbours, refreshed while work runs. */
function useAlbumData(production: AmfProductionPort, release: AmfReleasePort, focus: string | null, nonce: number) {
  const [list, setList] = useState<AmfProductionList | null>(null);
  const [failed, setFailed] = useState(false);
  const [runs, setRuns] = useState<Readonly<Record<string, AmfProductionRun>>>({});
  const [states, setStates] = useState<Readonly<Record<string, AmfReleaseState>>>({});
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      let busy = false;
      try {
        const observed = await production.list();
        if (!alive) return;
        setList(observed); setFailed(false);
        const ids = finishedRunIds(observed);
        const at = Math.max(0, focus === null ? 0 : ids.indexOf(focus));
        const near = ids.slice(Math.max(0, at - 1), at + 2);
        const [gotRuns, gotStates] = await Promise.all([
          Promise.all(near.map(id => production.get(id).catch(() => null))),
          Promise.all(near.map(id => release.state(id).catch(() => null))),
        ]);
        if (!alive) return;
        setRuns(previous => ({ ...previous, ...Object.fromEntries(gotRuns.flatMap(run => run ? [[run.runId, run]] : [])) }));
        setStates(previous => ({ ...previous, ...Object.fromEntries(gotStates.flatMap(state => state ? [[state.runId, state]] : [])) }));
        busy = observed.busy || gotRuns.some(run => run !== null && runBusy(run)) || gotStates.some(state => runningUpload(state) !== null || runningLocalTest(state) !== null);
      } catch {
        if (alive) setFailed(true);
      }
      if (alive) timer = setTimeout(() => { void load(); }, busy ? 1500 : 5000);
    };
    void load();
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [production, release, focus, nonce]);
  return { list, failed, runs, states };
}

function Album({ production, release, checksEnabled, onNavigate }: {
  production: AmfProductionPort; release: AmfReleasePort; checksEnabled: boolean; onNavigate: (page: PageId) => void;
}) {
  const gateway = useGateway();
  const vrchat = gateway.vrchat;
  const ai = useAiRequests();
  // Following a finished line here in full auto continues into its 360° preview.
  const [turntableRequest, setTurntableRequest] = useState(takeRequestedTurntable);
  const [focus, setFocus] = useState<string | null>(turntableRequest);
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce(value => value + 1);
  const { list, failed, runs, states } = useAlbumData(production, release, focus, nonce);
  const ids = useMemo(() => finishedRunIds(list), [list]);
  const index = Math.max(0, focus === null ? 0 : ids.indexOf(focus));
  const [dialog, setDialog] = useState<{ runId: string; requestId: string | null } | null>(null);
  const [exportRun, setExportRun] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<{ runId: string; kind: "bake" | "upload" | "localTest"; error: unknown } | null>(null);
  const otherWork = list?.busy ?? false;
  const queuedItemsFor = (runId: string) => list?.queue.filter(item => item.runId === runId) ?? [];
  const queuedFor = (runId: string) => queuedItemsFor(runId)[0] ?? null;
  const ownWork = (runId: string) => { const run = runs[runId]; const state = states[runId] ?? null; return (run !== undefined && runBusy(run)) || queuedFor(runId) !== null || runningUpload(state) !== null || runningLocalTest(state) !== null; };
  // Work started here, followed until it ends: one that waited and then could not start shows why.
  const [followed, setFollowed] = useState<Readonly<Record<string, { taskId: string; kind: "bake" | "upload" | "localTest" }>>>({});
  const follow = (runId: string, kind: "bake" | "upload" | "localTest", accepted: unknown) => {
    const taskId = (accepted as { taskId?: unknown } | null)?.taskId;
    if (typeof taskId === "string") setFollowed(previous => ({ ...previous, [runId]: { taskId, kind } }));
  };
  useEffect(() => {
    const entries = Object.entries(followed);
    if (entries.length === 0) return;
    let alive = true;
    const timer = setInterval(() => {
      void gateway.task.snapshot().then(view => {
        if (!alive) return;
        for (const [runId, { taskId, kind }] of entries) {
          const task = view.tasks.find(item => item.id === taskId);
          if (task === undefined || !["completed", "completedWithWarnings", "failed", "cancelled"].includes(task.status)) continue;
          setFollowed(previous => { const { [runId]: _ended, ...rest } = previous; return rest; });
          const cleanId = taskId.replace(/[^A-Za-z0-9-]/gu, "").slice(0, 80);
          // A failure the run already records (an upload/test record, a turntable step) speaks for itself.
          const recorded = kind === "upload" ? (states[runId]?.uploads.some(upload => upload.uploadId.includes(cleanId)) ?? false)
            : kind === "localTest" ? (states[runId]?.localTests?.some(test => test.testId.includes(cleanId)) ?? false)
            : (runs[runId]?.steps.some(step => step.key === "turntable" && step.state === "failed") ?? false);
          if (task.status === "failed" && !recorded) setActionError({ runId, kind, error: Object.assign(new Error(task.errorText ?? ""), { code: task.errorText }) });
          refresh();
        }
      }, () => {});
    }, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [gateway, followed, states, runs]);
  const requests = (ai.snapshot?.requests ?? []).filter(request => request.tool === "vua_request_amf_upload" && request.state === "pending");
  // An AI's upload request is confirmed here, with the Avatar's name and the rights statement.
  useEffect(() => onRequestRevealed(id => {
    const request = requests.find(item => item.id === id);
    const runId = request ? requestRunId(request) : null;
    if (request && runId) { setDialogError(null); setDialog({ runId, requestId: request.id }); }
  }), [requests]);

  // 上传核对(vrchat-session v0.1):玩家开启实验性登录后才读;结果按 Avatar ID 记住
  const [avatarChecks, setAvatarChecks] = useState<Readonly<Record<string, VrchatAvatarCheck>>>({});
  const [checkBusy, setCheckBusy] = useState(false);
  const rememberCheck = (id: string, read: () => Promise<VrchatAvatarCheck>) => {
    void read().then(
      check => setAvatarChecks(previous => ({ ...previous, [id]: check })),
      () => setAvatarChecks(previous => ({ ...previous, [id]: { blueprintId: id, state: "error", checkedAt: null, avatar: null } })),
    );
  };
  const shownIds = ids.map(id => uploadedAvatarId(states[id] ?? null)).filter((id): id is string => id !== null);
  const focusCheckId = shownIds[index] ?? null;
  useEffect(() => {
    if (vrchat === undefined || !checksEnabled || focusCheckId === null || avatarChecks[focusCheckId] !== undefined) return;
    rememberCheck(focusCheckId, () => vrchat.avatarCheck(focusCheckId, false));
  }, [vrchat, checksEnabled, focusCheckId, avatarChecks]);
  const refreshCheck = (id: string) => {
    if (vrchat === undefined || checkBusy) return;
    setCheckBusy(true);
    void vrchat.avatarCheck(id, true).then(
      check => { setAvatarChecks(previous => ({ ...previous, [id]: check })); setCheckBusy(false); },
      () => { setCheckBusy(false); },
    );
  };

  const [localTestPromptRunId, setLocalTestPromptRunId] = useState<string | null>(null);
  const act = (runId: string, kind: "bake" | "upload" | "localTest", work: () => Promise<unknown>) => {
    setActionError(null);
    void work().then(accepted => { follow(runId, kind, accepted); refresh(); }, error => setActionError({ runId, kind, error }));
  };
  const requestLocalTest = (runId: string) => {
    const eac = gateway.environment.eac;
    if (!eac) {
      act(runId, "localTest", () => release.localTest(runId));
      return;
    }
    void eac.inspect().then(
      (snap) => {
        if (snap.conclusion === "session_active" || snap.conclusion === "unloading") {
          setLocalTestPromptRunId(runId);
        } else {
          act(runId, "localTest", () => release.localTest(runId));
        }
      },
      () => {
        act(runId, "localTest", () => release.localTest(runId));
      },
    );
  };
  const checkAgain = (runId: string) => act(runId, "upload", () => production.reinspect(runId));
  useEffect(() => {
    if (turntableRequest === null) return;
    const state = states[turntableRequest];
    if (runs[turntableRequest] === undefined || state === undefined) return;
    setTurntableRequest(null);
    if (state.turntable?.current || state.editorOpen || ownWork(turntableRequest)) return;
    act(turntableRequest, "bake", () => release.bakeTurntable(turntableRequest));
  }, [turntableRequest, runs, states]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = async (confirmation: AiUploadConfirmationV01) => {
    if (dialog === null) return;
    setStarting(true); setDialogError(null);
    try {
      if (dialog.requestId !== null && ai.port) {
        const snapshot = await ai.port.resolve(dialog.requestId, "approve", confirmation);
        ai.setSnapshot(snapshot);
        const decided = snapshot.requests.find(request => request.id === dialog.requestId);
        if (decided?.state === "failed") throw Object.assign(new Error(decided.error ?? ""), { code: decided.error });
      } else {
        follow(dialog.runId, "upload", await release.upload(dialog.runId, confirmation));
      }
      setDialog(null); refresh();
    } catch (error) {
      setDialogError(error);
    } finally {
      setStarting(false);
    }
  };

  const titleOf = (runId: string) => lineName(runId, list?.runs.find(item => item.runId === runId)?.sourceNames[0] ?? runs[runId]?.sources[0]?.itemName ?? "") || baseName(runId);
  const spreads: AlbumSpread[] = ids.map((runId, at) => {
    const run = runs[runId];
    const listEntry = list?.runs.find(item => item.runId === runId);
    const projectGone = listEntry?.projectGone === true;
    const state = states[runId] ?? null;
    const title = titleOf(runId);
    // Finished Avatars with the same name are told apart by when their line started.
    const started = runStartedAt(runId);
    const tab = started && ids.some(other => other !== runId && titleOf(other) === title) ? `${title}\n${formatShortDateTime(started)}` : title;
    const request = requests.find(item => requestRunId(item) === runId) ?? null;
    const notice: ReactNode = request && <div className="vua-album__ai" role="status">
      <strong><Icon name="bell" size={16} />{copy.aiRequest.title}</strong>
      <span>
        <button type="button" className="vua-album__bake" onClick={() => { setDialogError(null); setDialog({ runId, requestId: request.id }); }}>{copy.aiRequest.review}</button>
        <button type="button" className="vua-release-upload__link" onClick={() => { void ai.resolve(request.id, "reject"); }}>{copy.aiRequest.decline}</button>
      </span>
    </div>;
    const error = actionError?.runId === runId ? actionError : null;
    const avatarId = uploadedAvatarId(state);
    return {
      key: runId, tab,
      left: live => run ? <div className="vua-album__left">
        <ReleaseStage production={production} release={release} run={run} turntable={projectGone ? null : state?.turntable ?? null} title={title} live={live} projectGone={projectGone} />
        {live && !projectGone && <TurntableBar run={run} state={state} busy={ownWork(runId)} error={error?.kind === "bake" ? error.error : null}
          onBake={() => act(runId, "bake", () => release.bakeTurntable(runId))} onExport={() => setExportRun(runId)} />}
      </div> : <p className="vua-text-secondary">{copy.loading}</p>,
      right: live => run ? <>
        <ReleaseSheet run={run} title={title} state={state} number={at + 1} live={live} notice={live ? notice : null}
          terms={live && list && !projectGone ? <LineTerms run={run} sources={list.sources} onOpenMaterials={() => onNavigate("warehouse")} /> : null} actions={{
          ...(projectGone ? {
            onNewLine: () => { requestNewProductionLine(run.sources.map(item => item.sourceId)); onNavigate("workshop"); },
            ...(listEntry?.recipeId ? { onRebuildRecipe: () => { requestProductionRecipe(listEntry.recipeId!); onNavigate("workshop"); } } : {}),
          } : {}),
          busy: ownWork(runId),
          uploadBlocked: runningUpload(state) !== null || queuedItemsFor(runId).some(item => item.operation === "amf.production.upload"),
          localTestBlocked: runningLocalTest(state) !== null || queuedItemsFor(runId).some(item => item.operation === "amf.production.localTest"),
          otherWork,
          queued: (() => { const queued = queuedFor(runId); return queued ? { operation: queued.operation, ahead: list ? queueAhead(list, queued.taskId) : 1, onRemove: () => { void gateway.task.cancel(queued.taskId).then(refresh, () => {}); } } : null; })(),
          onUpload: () => { setDialogError(null); setDialog({ runId, requestId: null }); },
          onLocalTest: () => requestLocalTest(runId),
          onStop: () => { const targetTaskId = followed[runId]?.taskId ?? list?.running.find(item => item.runId === runId)?.taskId ?? run.taskId; void gateway.task.cancel(targetTaskId).then(refresh, () => {}); },
          onCheckAgain: () => checkAgain(runId),
          onSdkFix: fixes => act(runId, "upload", () => production.sdkFix(runId, fixes)),
        }}
          avatarCheck={checksEnabled && avatarId !== null ? avatarChecks[avatarId] ?? null : null}
          {...(checksEnabled && avatarId !== null ? { onRefreshAvatarCheck: () => refreshCheck(avatarId) } : {})}
          {...(vrchat !== undefined ? { onOpenOnVrchat: (id: string) => { void vrchat.openAvatarPage(id).catch(() => {}); } } : {})} />
        {live && (error?.kind === "upload" || error?.kind === "localTest") && <ActionError error={error.error} onCheckAgain={() => checkAgain(runId)} />}
      </> : <p className="vua-text-secondary">{copy.loading}</p>,
    };
  });

  const dialogRun = dialog ? runs[dialog.runId] : undefined;
  if (list === null) return <p className="vua-text-secondary vua-release-room__loading">{failed ? copy.loadFailed : copy.loading}</p>;
  if (ids.length === 0) {
    return <div className="vua-album__cover">
      <span className="vua-album__ornament" data-place="top" data-skin-slot="album-cover" />
      <Icon name="avatar" size={24} />
      <h2>{copy.emptyTitle}</h2>
      <button type="button" className="vua-album__bake" onClick={() => onNavigate("workshop")}>{copy.toWorkshop}</button>
    </div>;
  }
  return <>
    {failed && <p className="vua-caption vua-text-secondary">{copy.loadFailed}</p>}
    <ReleaseAlbum spreads={spreads} index={index} onIndex={at => setFocus(ids[at] ?? null)} />
    {exportRun && <TurntableExportDialog runId={exportRun} onClose={() => setExportRun(null)} />}
    {dialog && dialogRun && <ReleaseUploadDialog proposedName={proposedUploadName(dialogRun)} avatarId={uploadedAvatarId(states[dialog.runId] ?? null)}
      picture={<StagePhoto port={production} run={dialogRun} label={titleOf(dialogRun.runId)} />} requestedByAi={dialog.requestId !== null}
      error={<ActionError error={dialogError} onCheckAgain={() => { setDialog(null); checkAgain(dialog.runId); }} />} starting={starting}
      sdkMustFix={sdkReviewView(dialogRun)?.mustFix.length ?? 0}
      onConfirm={confirmation => { void confirm(confirmation); }} onClose={() => setDialog(null)} />}
    <ConfirmDialog
      open={localTestPromptRunId !== null}
      title={strings.eac.localTest.title}
      cancelLabel={strings.eac.cancel}
      confirmLabel={strings.eac.localTest.confirm}
      onCancel={() => setLocalTestPromptRunId(null)}
      onConfirm={() => {
        const runId = localTestPromptRunId;
        setLocalTestPromptRunId(null);
        if (runId !== null) act(runId, "localTest", () => release.localTest(runId));
      }}
    >
      <p>{strings.eac.localTest.body}</p>
      <div>
        <Button
          variant="subtle"
          onClick={() => openEncyclopedia({ topic: "guide-start", section: "eac-sdk-multi-instance" })}
        >
          {strings.eac.openGuide}
        </Button>
      </div>
    </ConfirmDialog>
  </>;
}

/** The experimental VRChat sign-in is switched on (vrchat-session v0.1). */
function useVrchatEnabled(vrchat: VrchatPort | undefined): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (vrchat === undefined) { setEnabled(false); return; }
    let active = true;
    void vrchat.status().then(value => { if (active) setEnabled(value.enabled); }, () => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, [vrchat]);
  return enabled;
}

/** Avatar IDs of every upload VUA finished, read while the VRChat view is open. */
function useVuaUploads(production: AmfProductionPort | undefined, release: AmfReleasePort | undefined, active: boolean): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!active || production === undefined || release === undefined) return;
    let alive = true;
    void production.list().then(list => Promise.all(finishedRunIds(list).map(id => release.state(id).catch(() => null))))
      .then(states => { if (alive) setIds(uploadedAvatarIds(states)); }, () => {});
    return () => { alive = false; };
  }, [production, release, active]);
  return ids;
}

export function ReleaseAlbumPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const gateway = useGateway();
  const production = gateway.amfProduction, release = gateway.amfRelease, vrchat = gateway.vrchat;
  const vrchatEnabled = useVrchatEnabled(vrchat);
  const [view, setView] = useState<View>("album");
  const shelf = vrchatEnabled && vrchat !== undefined ? vrchat : null;
  const uploaded = useVuaUploads(production, release, shelf !== null && view === "vrchat");
  return <div className="vua-page vua-release-room" data-focus-scope>
    <header className="vua-page__hero">
      <h1 className="vua-title">{strings.nav.pages.release}</h1>
      {shelf && <div className="vua-release-room__tabs vua-segments" role="tablist" aria-label={copy.title}>
        <SegmentBar selected={view} />
        {(["album", "vrchat"] as const).map(key => <button key={key} type="button" role="tab" aria-selected={view === key}
          data-nav-id={`release-tab-${key}`} onClick={() => setView(key)}>{key === "album" ? shelfCopy.albumTab : shelfCopy.vrchatTab}</button>)}
      </div>}
    </header>
    {shelf && view === "vrchat" ? <VrchatAvatarShelf vrchat={shelf} uploadedIds={uploaded} onNavigate={onNavigate} />
      : production && release ? <Album production={production} release={release} checksEnabled={vrchatEnabled} onNavigate={onNavigate} />
        : <EmptyState title={format(strings.amfProduction.unavailable, { amf: termLabel("amf") })} />}
  </div>;
}

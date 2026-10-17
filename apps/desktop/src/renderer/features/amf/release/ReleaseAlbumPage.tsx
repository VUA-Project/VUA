/** The release room: finished Avatars as an album with their turntable and upload, and the
 * production records under their own tab. */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@vua/design-system";
import type { AiUploadConfirmationV01 } from "@vua/contracts";
import { useGateway, type AmfProductionList, type AmfProductionPort, type AmfProductionRun, type AmfReleasePort, type AmfReleaseState, type VrchatAvatarCheck } from "../../../gateway/index.ts";
import type { PageId } from "../../../app/nav-model.ts";
import { EmptyState } from "../../../components/primitives/EmptyState.tsx";
import { format, formatDateTime, formatShortDateTime, strings, termLabel } from "../../../i18n/index.ts";
import { runStartedAt } from "../factory-model.ts";
import { ReleasePage } from "../../release/ReleasePage.tsx";
import { useAiRequests } from "../../ai-requests/use-ai-requests.ts";
import { requestRunId } from "../../ai-requests/ai-request-routing.ts";
import { ReleaseAlbum, type AlbumSpread } from "./ReleaseAlbum.tsx";
import { ReleaseStage, StagePhoto } from "./ReleaseStage.tsx";
import { ReleaseSheet } from "./ReleaseSheet.tsx";
import { ReleaseUploadDialog } from "./ReleaseUploadDialog.tsx";
import { avatarTitle, baseName, finishedRunIds, lastStep, proposedUploadName, runBusy, runningUpload, sdkReviewView, uploadedAvatarId } from "./release-model.ts";
import "./release-album.css";

const copy = strings.releaseRoom;
type Tab = "album" | "records";

/** A failed start in plain words; the backend's detail stays under Details. */
export function ActionError({ error, onCheckAgain }: { error: unknown; onCheckAgain?: () => void }) {
  if (error === null || error === undefined) return null;
  const code = String((error as { code?: unknown }).code ?? (error instanceof Error ? error.message : "")).replace(/^vua\.amf_production\./u, "");
  const known = (copy.errors as Record<string, string>)[code];
  const detail = error instanceof Error && error.message !== code && !error.message.startsWith("vua.") ? error.message : "";
  return <div className="vua-release-room__error" role="alert">
    <p>{known ?? copy.errors.other}</p>
    {detail && !known && <details><summary>{copy.upload.details}</summary><p>{detail}</p></details>}
    {code === "project_drift" && onCheckAgain && <button type="button" className="vua-release-upload__link" onClick={onCheckAgain}>{copy.upload.checkAgain}</button>}
  </div>;
}

function TurntableBar({ run, state, busy, error, onBake }: { run: AmfProductionRun; state: AmfReleaseState | null; busy: boolean; error: unknown; onBake: () => void }) {
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
      </> : <>
        <span className="vua-text-secondary">{turntable ? copy.turntable.stale : state?.editorOpen ? copy.turntable.unityOpen : copy.turntable.bakeHint}</span>
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
        busy = observed.busy || gotRuns.some(run => run !== null && runBusy(run)) || gotStates.some(state => runningUpload(state) !== null);
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

function Album({ production, release, onNavigate }: { production: AmfProductionPort; release: AmfReleasePort; onNavigate: (page: PageId) => void }) {
  const gateway = useGateway();
  const vrchat = gateway.vrchat;
  const ai = useAiRequests();
  const [focus, setFocus] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const refresh = () => setNonce(value => value + 1);
  const { list, failed, runs, states } = useAlbumData(production, release, focus, nonce);
  const ids = useMemo(() => finishedRunIds(list), [list]);
  const index = Math.max(0, focus === null ? 0 : ids.indexOf(focus));
  const [dialog, setDialog] = useState<{ runId: string; requestId: string | null } | null>(null);
  const [dialogError, setDialogError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<{ runId: string; kind: "bake" | "upload"; error: unknown } | null>(null);
  const busy = list?.busy ?? false;
  const requests = (ai.snapshot?.requests ?? []).filter(request => request.tool === "vua_request_amf_upload" && request.state === "pending");

  // 上传核对(vrchat-session v0.1):玩家开启实验性登录后才读;结果按 Avatar ID 记住
  const [checksEnabled, setChecksEnabled] = useState(false);
  const [avatarChecks, setAvatarChecks] = useState<Readonly<Record<string, VrchatAvatarCheck>>>({});
  const [checkBusy, setCheckBusy] = useState(false);
  useEffect(() => {
    if (vrchat === undefined) { setChecksEnabled(false); return; }
    let active = true;
    void vrchat.status().then(value => { if (active) setChecksEnabled(value.enabled); }, () => { if (active) setChecksEnabled(false); });
    return () => { active = false; };
  }, [vrchat]);
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

  const act = (runId: string, kind: "bake" | "upload", work: () => Promise<unknown>) => {
    setActionError(null);
    void work().then(refresh, error => setActionError({ runId, kind, error }));
  };
  const checkAgain = (runId: string) => act(runId, "upload", () => production.reinspect(runId));
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
        await release.upload(dialog.runId, confirmation);
      }
      setDialog(null); refresh();
    } catch (error) {
      setDialogError(error);
    } finally {
      setStarting(false);
    }
  };

  const titleOf = (runId: string) => { const run = runs[runId]; return run ? avatarTitle(run) : baseName(list?.runs.find(item => item.runId === runId)?.sourceNames[0] ?? runId); };
  const spreads: AlbumSpread[] = ids.map((runId, at) => {
    const run = runs[runId];
    const state = states[runId] ?? null;
    const title = titleOf(runId);
    // Finished Avatars with the same name are told apart by when their line started.
    const started = runStartedAt(runId);
    const tab = started && ids.some(other => other !== runId && titleOf(other) === title) ? `${title} · ${formatShortDateTime(started)}` : title;
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
        <ReleaseStage production={production} release={release} run={run} turntable={state?.turntable ?? null} title={title} live={live} />
        {live && <TurntableBar run={run} state={state} busy={busy} error={error?.kind === "bake" ? error.error : null}
          onBake={() => act(runId, "bake", () => release.bakeTurntable(runId))} />}
      </div> : <p className="vua-text-secondary">{copy.loading}</p>,
      right: live => run ? <>
        <ReleaseSheet run={run} state={state} number={at + 1} live={live} notice={live ? notice : null} actions={{
          busy: busy || runBusy(run),
          onUpload: () => { setDialogError(null); setDialog({ runId, requestId: null }); },
          onStop: () => { void gateway.task.cancel(run.taskId).then(refresh, () => {}); },
          onCheckAgain: () => checkAgain(runId),
        }}
          avatarCheck={checksEnabled && avatarId !== null ? avatarChecks[avatarId] ?? null : null}
          {...(checksEnabled && avatarId !== null ? { onRefreshAvatarCheck: () => refreshCheck(avatarId) } : {})} />
        {live && error?.kind === "upload" && <ActionError error={error.error} onCheckAgain={() => checkAgain(runId)} />}
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
      <p className="vua-text-secondary">{copy.emptyHint}</p>
      <button type="button" className="vua-album__bake" onClick={() => onNavigate("workshop")}>{copy.toWorkshop}</button>
    </div>;
  }
  return <>
    {failed && <p className="vua-caption vua-text-secondary">{copy.loadFailed}</p>}
    <ReleaseAlbum spreads={spreads} index={index} onIndex={at => setFocus(ids[at] ?? null)} />
    {dialog && dialogRun && <ReleaseUploadDialog proposedName={proposedUploadName(dialogRun)} avatarId={uploadedAvatarId(states[dialog.runId] ?? null)}
      picture={<StagePhoto port={production} run={dialogRun} label={avatarTitle(dialogRun)} />} requestedByAi={dialog.requestId !== null}
      error={<ActionError error={dialogError} onCheckAgain={() => { setDialog(null); checkAgain(dialog.runId); }} />} starting={starting}
      sdkMustFix={sdkReviewView(dialogRun)?.mustFix.length ?? 0}
      onConfirm={confirmation => { void confirm(confirmation); }} onClose={() => setDialog(null)} />}
  </>;
}

export function ReleaseAlbumPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const gateway = useGateway();
  const [tab, setTab] = useState<Tab>("album");
  const production = gateway.amfProduction, release = gateway.amfRelease;
  return <div className="vua-page vua-release-room" data-focus-scope>
    <header className="vua-release-room__header">
      <h1>{copy.title}</h1>
      <div className="vua-release-room__tabs" role="tablist" aria-label={strings.factory.rooms.release.name}>
        {(["album", "records"] as const).map(key => <button key={key} type="button" role="tab" aria-selected={tab === key}
          data-nav-id={`release-tab-${key}`} onClick={() => setTab(key)}>{copy.tabs[key]}</button>)}
      </div>
    </header>
    {tab === "records" ? <ReleasePage onNavigate={onNavigate} />
      : production && release ? <Album production={production} release={release} onNavigate={onNavigate} />
      : <EmptyState title={format(strings.amfProduction.unavailable, { amf: termLabel("amf") })} />}
  </div>;
}

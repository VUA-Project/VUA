/** The stage on an album page: the 60-frame turntable while it shows this Avatar, else its three views. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "@vua/design-system";
import { TurntablePlayer, type BakeManifest } from "../../../components/preview/TurntablePlayer.tsx";
import type { AmfProductionPort, AmfProductionRun, AmfReleasePort, AmfTurntable } from "../../../gateway/index.ts";
import { format, strings } from "../../../i18n/index.ts";
import { ALBUM_MOTION, STILL_VIEWS, viewAfter, type StillView } from "./release-model.ts";

const copy = strings.releaseRoom;
const FRAME_LOADS_AT_ONCE = 6;

// Recently shown pictures, so turning back to a page shows it at once.
const stills = new Map<string, Promise<string>>();
const turntables = new Map<string, Promise<string[]>>();
function remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>, limit: number): Promise<T> {
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = load();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    for (const oldest of cache.keys()) { if (cache.size <= limit) break; cache.delete(oldest); }
  }
  return pending;
}

function useStill(port: AmfProductionPort, runId: string, path: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (path === undefined) return;
    let alive = true;
    void remember(stills, `${runId}\n${path}`, () => port.previewImage(runId, path), 48).then(url => { if (alive) setSrc(url); }, () => {});
    return () => { alive = false; };
  }, [port, runId, path]);
  return src;
}

/** The front view as a still picture, for pages that turn and for the turntable while it loads. */
export function StagePhoto({ port, run, view = "front", label }: { port: AmfProductionPort; run: AmfProductionRun; view?: StillView; label: string }) {
  const path = run.result?.facts?.previews?.find(preview => preview.view === view)?.path;
  const src = useStill(port, run.runId, path);
  return src !== null
    ? <img className="vua-album__still" src={src} alt={label} draggable={false} />
    : <span className="vua-album__still vua-album__still--empty" aria-busy={path !== undefined || undefined}>{path === undefined ? copy.stage.noPreview : null}</span>;
}

function loadTurntable(port: AmfReleasePort, runId: string, turntable: AmfTurntable, onLoaded: (count: number) => void): Promise<string[]> {
  return remember(turntables, `${runId}\n${turntable.bakedAt}`, async () => {
    const frames: string[] = new Array<string>(turntable.frames);
    let next = 0, loaded = 0;
    const worker = async () => {
      while (next < turntable.frames) {
        const index = next++;
        frames[index] = await port.turntableFrame(runId, index);
        onLoaded(++loaded);
      }
    };
    await Promise.all(Array.from({ length: FRAME_LOADS_AT_ONCE }, worker));
    return frames;
  }, 2);
}

function TurntableStage({ production, release, run, turntable, title }: {
  production: AmfProductionPort; release: AmfReleasePort; run: AmfProductionRun; turntable: AmfTurntable; title: string;
}) {
  const [frames, setFrames] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFrames(null); setLoaded(0); setFailed(false);
    void loadTurntable(release, run.runId, turntable, count => { if (alive) setLoaded(count); })
      .then(urls => { if (alive) setFrames(urls); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [release, run.runId, turntable]);
  const manifest = useMemo<BakeManifest>(() => ({ schemaVersion: 1, commandId: run.runId, avatarName: title, bakedAt: turntable.bakedAt,
    basis: "vua-unity-editor-bake", frames: turntable.frames, width: turntable.size, height: turntable.size, framePattern: "frames/frame_{0:D2}.png",
    cover: "cover.png", triangles: 0, materialSlots: 0, skinnedMeshRenderers: 0, bones: 0 }), [run.runId, title, turntable]);
  const urlFor = useMemo(() => (rel: string) => {
    const frame = /frame_(\d{2})\.png$/u.exec(rel);
    return frames?.[frame ? Number(frame[1]) : 0] ?? "";
  }, [frames]);
  if (frames === null) {
    return <>
      <StagePhoto port={production} run={run} label={title} />
      {!failed && <span className="vua-album__stage-progress" role="progressbar" aria-valuemin={0} aria-valuemax={turntable.frames} aria-valuenow={loaded}>
        <span style={{ width: `${Math.round((loaded / turntable.frames) * 100)}%` }} />
        <small>{format(copy.stage.loading, { loaded, total: turntable.frames })}</small>
      </span>}
    </>;
  }
  return <TurntablePlayer manifestPath="turntable/manifest.json" manifest={manifest} urlFor={urlFor} onStatus={() => {}} />;
}

function StillsStage({ production, run, title }: { production: AmfProductionPort; run: AmfProductionRun; title: string }) {
  const views = STILL_VIEWS.filter(view => run.result?.facts?.previews?.some(preview => preview.view === view));
  const [view, setView] = useState<StillView>("front");
  const drag = useRef<{ pointer: number; x: number; from: StillView } | null>(null);
  const shown = views.includes(view) ? view : views[0] ?? "front";
  const turn = (steps: number) => setView(viewAfter(views, shown, steps));
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (views.length < 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, from: shown };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    setView(viewAfter(views, current.from, Math.round((event.clientX - current.x) / ALBUM_MOTION.pixelsPerView)));
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => { if (drag.current?.pointer === event.pointerId) drag.current = null; };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.stopPropagation(); event.preventDefault();
    turn(event.key === "ArrowRight" ? 1 : -1);
  };
  return <div className="vua-album__stills" tabIndex={views.length > 1 ? 0 : -1} aria-label={copy.stage.dragViews} onKeyDown={onKeyDown}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
    <StagePhoto port={production} run={run} view={shown} label={`${title} · ${copy.stage.views[shown]}`} />
    {views.length > 1 && <>
      <button type="button" className="vua-album__turn" data-side="left" aria-label={copy.stage.turnLeft} onClick={() => turn(-1)} onPointerDown={event => event.stopPropagation()}>
        <Icon name="arrow-left" size={16} /></button>
      <button type="button" className="vua-album__turn" data-side="right" aria-label={copy.stage.turnRight} onClick={() => turn(1)} onPointerDown={event => event.stopPropagation()}>
        <Icon name="arrow-right" size={16} /></button>
      <span className="vua-album__views" aria-hidden="true">{views.map(item => <span key={item} data-current={item === shown || undefined}>{copy.stage.views[item]}</span>)}</span>
    </>}
  </div>;
}

/** The photo mounted on the left page. A turning page shows the front still only. */
export function ReleaseStage({ production, release, run, turntable, title, live }: {
  production: AmfProductionPort; release: AmfReleasePort; run: AmfProductionRun; turntable: AmfTurntable | null; title: string; live: boolean;
}) {
  const current = turntable?.current ? turntable : null;
  return <figure className="vua-album__photo" data-stage>
    <span className="vua-album__corners" data-skin-slot="album-photo-corners">
      <span data-corner="tl" /><span data-corner="tr" /><span data-corner="bl" /><span data-corner="br" />
    </span>
    <div className="vua-album__print">
      <span className="vua-album__backdrop" data-skin-slot="album-stage-backdrop" />
      {!live ? <StagePhoto port={production} run={run} label={title} />
        : current ? <TurntableStage production={production} release={release} run={run} turntable={current} title={title} />
        : <StillsStage production={production} run={run} title={title} />}
    </div>
    <figcaption>{current ? copy.stage.dragTurntable : copy.stage.dragViews}</figcaption>
  </figure>;
}

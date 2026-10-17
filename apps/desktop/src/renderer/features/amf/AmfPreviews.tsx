import { useEffect, useState } from "react";
import type { AmfPrefab, AmfProductionPort, AmfProductionRun } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";

const copy = strings.amfProduction;
// Data URLs of recently shown previews, so returning to a step shows them at once.
const loaded = new Map<string, Promise<string>>();
const MAX_LOADED = 160;

function previewUrl(port: AmfProductionPort, runId: string, path: string): Promise<string> {
  const key = `${runId}\n${path}`;
  let pending = loaded.get(key);
  if (pending === undefined) {
    pending = port.previewImage(runId, path);
    loaded.set(key, pending);
    pending.catch(() => loaded.delete(key));
    for (const oldest of loaded.keys()) { if (loaded.size <= MAX_LOADED) break; loaded.delete(oldest); }
  }
  return pending;
}

/** One Bridge preview read through the typed Gateway. */
export function AmfPreview({ port, runId, path, label }: { port: AmfProductionPort; runId: string; path: string | undefined; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (path === undefined) return;
    let alive = true;
    void previewUrl(port, runId, path).then(url => { if (alive) setSrc(url); }, () => { /* The name stays as the caption. */ });
    return () => { alive = false; };
  }, [port, runId, path]);
  return <figure className="vua-n3__preview">
    {src !== null ? <img src={src} alt={label} draggable={false}/> : <span className="vua-n3__preview-frame" aria-busy={path !== undefined || undefined}/>}
    <figcaption title={label}>{label}</figcaption>
  </figure>;
}

/** The finished Avatar from the front, side and back. */
export function AmfResultViews({ port, run }: { port: AmfProductionPort; run: AmfProductionRun }) {
  const views = run.result?.facts?.previews ?? [];
  if (views.length === 0) return null;
  return <section className="vua-n3__views" aria-label={copy.previewTitle}>
    <h3>{copy.previewTitle}</h3>
    <p className="vua-caption vua-text-secondary">{copy.previewHint}</p>
    <div className="vua-n3__view-row">{views.map(view => <AmfPreview key={view.path} port={port} runId={run.runId} path={view.path} label={copy.previewViews[view.view]}/>)}</div>
  </section>;
}

/** Candidate prefabs as pictures; choosing one picks it in the selection. */
export function AmfCandidateGallery({ port, runId, candidates, chosen, label, onChoose }: {
  port: AmfProductionPort; runId: string; candidates: readonly AmfPrefab[]; chosen: string; label: string; onChoose: (candidate: AmfPrefab) => void;
}) {
  if (!candidates.some(candidate => candidate.preview !== undefined)) return null;
  return <div className="vua-n3__gallery" role="group" aria-label={label}>
    {candidates.map(candidate => <button type="button" key={`${candidate.sourceId}-${candidate.path}`} title={candidate.path}
      aria-pressed={candidate.path === chosen} onClick={() => onChoose(candidate)}>
      <AmfPreview port={port} runId={runId} path={candidate.preview} label={candidate.name}/>
    </button>)}
  </div>;
}

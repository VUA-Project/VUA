import { useEffect, useState } from "react";
import type { AmfTextureMemoryPlan, TexturePlatform, TextureTargetRank } from "@vua/contracts";
import { textureRank } from "@vua/contracts";
import type { AmfProductionPort, AmfProductionRun } from "../../gateway/index.ts";
import { Card } from "../../components/primitives/Card.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { format, strings } from "../../i18n/index.ts";
import type { AutomationLevel } from "./factory-model.ts";

const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

export function TextureMemoryCard({ port, run, level, disabled, onStarted, onError }: {
  port: AmfProductionPort; run: AmfProductionRun; level: AutomationLevel; disabled: boolean;
  onStarted: (task: string) => void; onError: (error: unknown) => void;
}) {
  const copy = strings.textureMemory;
  const [platform, setPlatform] = useState<TexturePlatform>("pc");
  const [target, setTarget] = useState<TextureTargetRank>("good");
  const [review, setReview] = useState<AmfTextureMemoryPlan | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  const reports = run.result?.facts?.textureMemory;
  // Polling returns new objects for identical facts; retain a reviewed selection until the
  // facts actually change, rather than resetting the player's list on every poll.
  const factsKey = JSON.stringify(reports);
  useEffect(() => {
    let alive = true;
    setReview(null); setFailed(false);
    if (!disabled && reports?.length) void port.planTextureMemory(run.runId, platform, target).then(plan => {
      if (!alive) return;
      setReview(plan); setChosen(new Set(plan.plan.entries.map(e => e.proposed.path)));
    }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [port, run.runId, factsKey, platform, target, disabled]);
  const apply = async (paths: readonly string[]) => {
    if (!review || starting) return;
    setStarting(true);
    try { onStarted((await port.applyTextureMemory(run.runId, review, paths)).taskId); }
    catch (error) { onError(error); }
    finally { setStarting(false); }
  };
  const current = reports?.find(r => r.platform === platform);
  const plan = review?.plan;
  const selected = plan?.entries.filter(e => level === "full" || chosen.has(e.proposed.path)) ?? [];
  const estimated = plan ? plan.current.totalBytes - selected.reduce((sum, e) => sum + e.current.estimatedBytes - e.estimatedBytes, 0) : 0;
  // Before a measurement there is nothing to choose: one line says how to get one.
  if (!reports?.length) return <Card><h2>{copy.title}</h2><p className="vua-text-secondary">{copy.inspect}</p></Card>;
  return <Card>
    <h2>{copy.title}</h2>
    {current ? <p>{format(copy.total, { size: (current.complete ? "" : "≥ ") + mib(current.totalBytes), rank: copy.ranks[current.rank] })}</p> : <p>{copy.inspect}</p>}
    <div className="vua-texture__controls">
      <label>{copy.platform}<select value={platform} disabled={starting} onChange={e => setPlatform(e.target.value as TexturePlatform)}>
        <option value="pc">{copy.platforms.pc}</option><option value="android">{copy.platforms.android}</option></select></label>
      <label>{copy.target}<select value={target} disabled={starting} onChange={e => setTarget(e.target.value as TextureTargetRank)}>
        {(["excellent", "good", "medium", "poor"] as const).map(r => <option key={r} value={r}>{copy.ranks[r]}</option>)}</select></label>
    </div>
    <p className="vua-caption vua-text-secondary">{copy.note}</p>
    {failed && <p role="status">{copy.unavailable}</p>}
    {plan && <>
      <p>{format(copy.estimate, { size: (plan.current.complete ? "" : "≥ ") + mib(estimated), rank: copy.ranks[plan.current.complete ? textureRank(estimated, platform) : "unknown"] })}</p>
      {!plan.reachesTarget && <p>{copy.unreachable}</p>}
      {plan.entries.length === 0 && <p>{copy.matched}</p>}
      <ul className="vua-lighting__entries">{plan.entries.map(entry => <li key={entry.proposed.path}>
        {level === "smart" ? <label><input type="checkbox" checked={chosen.has(entry.proposed.path)} disabled={starting} onChange={e => setChosen(previous => {
          const next = new Set(previous); if (e.target.checked) next.add(entry.proposed.path); else next.delete(entry.proposed.path); return next;
        })}/>{entry.proposed.path}</label> : <span>{entry.proposed.path}</span>}
        <span>{entry.current.width} × {entry.current.height} · {entry.current.format} → {copy.maxSize} {entry.proposed.maxSize} · {entry.proposed.format} ({mib(entry.current.estimatedBytes)} → {mib(entry.estimatedBytes)} MiB)</span>
        {level === "ask" && <Button disabled={disabled || starting} onClick={() => { void apply([entry.proposed.path]); }}>{copy.one}</Button>}
      </li>)}</ul>
      {plan.entries.length > 0 && <p className="vua-caption vua-text-secondary">{copy.restore}</p>}
      {level !== "ask" && selected.length > 0 && <Button disabled={disabled || starting} onClick={() => { void apply(selected.map(e => e.proposed.path)); }}>
        {starting ? copy.applying : copy.apply}</Button>}
    </>}
    {current && <details><summary>{copy.inventory}</summary><ul>{current.textures.map(t => <li key={t.id}>
      {t.path || t.id} · {t.width} × {t.height} · {t.format} · {t.mipmap ? copy.mipmaps : copy.noMips} · {t.known ? `${mib(t.estimatedBytes)} MiB` : copy.ranks.unknown}
      {!t.editable && <> · {copy.skipped} <code>{t.reason}</code></>}
    </li>)}</ul></details>}
  </Card>;
}

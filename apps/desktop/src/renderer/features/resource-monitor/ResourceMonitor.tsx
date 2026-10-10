import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SystemResourceUsageV2 } from "@vua/contracts";
import { Icon } from "@vua/design-system";
import { format, strings } from "../../i18n/index.ts";
import { formatGigabytes, usagePercents } from "./resource-monitor-model.ts";
import "./resource-monitor.css";

const copy = strings.resourceMonitor;
const POLL_INTERVAL_MS = 2_000;
function MeterRow({ label, percent, detail }: { label: string; percent: number | null; detail?: string | undefined }) {
  return <div className="vua-usage-panel__row">
    <span className="vua-usage-panel__label">{label}</span>
    {percent === null ? <span className="vua-usage-panel__unavailable">{copy.unavailable}</span> : <>
      <span className="vua-usage-panel__bar" role="meter" aria-label={label} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span className="vua-usage-panel__bar-fill" data-constrained={percent >= 90 || undefined} style={{ width: percent + "%" }} />
      </span>
      <span className="vua-usage-panel__pct">{percent}%</span>
      {detail ? <span className="vua-usage-panel__bytes">{detail}</span> : null}
    </>}
  </div>;
}

/** Summary = remaining mean of available dimensions, with an independent
 * saturation indicator. Detail is portalled outside the glass titlebar. */
export function ResourceMonitor() {
  const [snapshot, setSnapshot] = useState<SystemResourceUsageV2 | null>(null);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const system = window.vua?.system;
    if (system === undefined) return;
    let alive = true;
    const tick = () => {
      const read = system.readResourceUsageV2 ? system.readResourceUsageV2() : system.readResourceUsage().then(value =>
        ({ ...value, schemaVersion: 2 as const, cpuUsagePercent: null, gpuUsagePercent: null, gpuName: null, gpuKind: null }));
      read.then(next => { if (alive) setSnapshot(next); }).catch(() => { if (alive) setSnapshot(null); });
    };
    tick();
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && (panelRef.current?.contains(event.target) || toggleRef.current?.contains(event.target))) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
    };
    const onWindowBlur = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [open]);

  if (snapshot === null) return null;
  const view = usagePercents(snapshot);
  const resourceNames = { cpu: copy.cpu, gpu: copy.gpu, ram: copy.ramShort, vram: copy.vramShort };
  const constrained = view.constrained ? format(copy.constrained, { resource: resourceNames[view.constrained], percent: view.constrainedPct ?? 0 }) : null;
  const summary = format(copy.indicatorAria, { percent: view.headroomPct, count: view.measuredCount });
  return <>
    <button ref={toggleRef} type="button" className="vua-shell__usage vua-caption" aria-expanded={open}
      aria-label={summary + (constrained ? " · " + constrained : "")} title={summary}
      data-nav-id="system-resources" onClick={() => setOpen(current => !current)}>
      <Icon name="gauge" size={16} />
      <span className="vua-shell__usage-value">{format(copy.headroom, { percent: view.headroomPct })}</span>
      {constrained ? <span className="vua-shell__usage-constrained"><Icon name="warning" size={16} /><span>{constrained}</span></span> : null}
    </button>
    {open ? createPortal(<div ref={panelRef} className="vua-usage-panel" role="region" aria-label={copy.title} tabIndex={-1}>
      <div className="vua-usage-panel__header">
        <span className="vua-usage-panel__title">{copy.title}</span>
        <button type="button" className="vua-usage-panel__close" aria-label={copy.closeAria} onClick={() => setOpen(false)}><Icon name="close" size={16} /></button>
      </div>
      <MeterRow label={copy.cpu} percent={view.cpuPct} />
      <MeterRow label={copy.gpu} percent={view.gpuPct} detail={snapshot.gpuName ? snapshot.gpuName + " · " + copy.gpuKinds[snapshot.gpuKind ?? "unknown"] : undefined} />
      <MeterRow label={copy.ram} percent={view.ramPct} detail={formatGigabytes(snapshot.ramUsedBytes) + " / " + formatGigabytes(snapshot.ramTotalBytes) + " GB"} />
      <MeterRow label={copy.vram} percent={view.vramPct}
        detail={snapshot.vramUsedBytes !== null && snapshot.vramTotalBytes !== null ? formatGigabytes(snapshot.vramUsedBytes) + " / " + formatGigabytes(snapshot.vramTotalBytes) + " GB" : undefined} />
      {snapshot.gpuKind === "integrated" ? <p className="vua-usage-panel__note">{copy.sharedMemory}</p> : null}
      <div className="vua-usage-panel__footer"><p className="vua-usage-panel__note">{format(copy.summaryNote, { count: view.measuredCount })}</p></div>
    </div>, document.body) : null}
  </>;
}

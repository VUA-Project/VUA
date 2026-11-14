import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@vua/design-system";
import { POPOVER_ENTER, POPOVER_EXIT, usePresenceMotion } from "../../components/primitives/motion.ts";
import { format, strings } from "../../i18n/index.ts";
import { amfCapacityGuidance, formatGigabytes, sparklinePoints, usagePercents } from "./resource-monitor-model.ts";
import { useResourceUsage } from "./resource-usage-store.ts";
import "./resource-monitor.css";

const copy = strings.resourceMonitor;
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

/** Summary names the tightest resource with a three-step state (F6).
 * Detail is portalled outside the glass titlebar. */
export function ResourceMonitor() {
  const { snapshot, history } = useResourceUsage();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const shown = usePresenceMotion(open, panelRef, POPOVER_ENTER, POPOVER_EXIT);

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
  const guidance = amfCapacityGuidance(snapshot);
  const trendPolyline = sparklinePoints(history, 120, 24);
  const resourceNames = { cpu: copy.cpu, gpu: copy.gpu, ram: copy.ramShort, vram: copy.vramShort };
  const stateWords = { plenty: copy.statePlenty, gettingTight: copy.stateGettingTight, tight: copy.stateTight };
  const state = stateWords[view.loadState];
  const summary = view.tightest !== null && view.tightestPct !== null
    ? format(copy.tightestAria, { resource: resourceNames[view.tightest], percent: view.tightestPct, state })
    : copy.title;
  return <>
    <button ref={toggleRef} type="button" className="vua-shell__usage vua-caption" aria-expanded={open}
      aria-label={summary} title={summary}
      data-nav-id="system-resources" onClick={() => setOpen(current => !current)}>
      <Icon name="gauge" size={16} />
      {view.tightest !== null && view.tightestPct !== null ? <>
        <span className="vua-shell__usage-value">{format(copy.tightest, { resource: resourceNames[view.tightest], percent: view.tightestPct })}</span>
        <span className="vua-shell__usage-state" data-state={view.loadState}>{state}</span>
      </> : null}
    </button>
    {shown ? createPortal(<div ref={panelRef} className="vua-usage-panel" data-vua-native-occluder role="region" aria-label={copy.title} tabIndex={-1}>
      <div className="vua-usage-panel__header">
        <span className="vua-usage-panel__title">{copy.title}</span>
        <button type="button" className="vua-usage-panel__close" aria-label={copy.closeAria} onClick={() => setOpen(false)}><Icon name="close" size={16} /></button>
      </div>
      <MeterRow label={copy.cpu} percent={view.cpuPct} />
      <MeterRow label={copy.gpu} percent={view.gpuPct} detail={snapshot.gpuName ? snapshot.gpuName + " · " + copy.gpuKinds[snapshot.gpuKind ?? "unknown"] : undefined} />
      <MeterRow label={copy.ram} percent={view.ramPct} detail={formatGigabytes(snapshot.ramUsedBytes) + " / " + formatGigabytes(snapshot.ramTotalBytes) + " GB"} />
      <MeterRow label={copy.vram} percent={view.vramPct}
        detail={snapshot.vramUsedBytes !== null && snapshot.vramTotalBytes !== null ? formatGigabytes(snapshot.vramUsedBytes) + " / " + formatGigabytes(snapshot.vramTotalBytes) + " GB" : undefined} />
      {trendPolyline ? (
        <div className="vua-usage-panel__trend">
          <span className="vua-usage-panel__label">{copy.trend60s}</span>
          <svg className="vua-usage-panel__sparkline" viewBox="0 0 120 24" aria-hidden="true" data-audit-skip>
            <polyline fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" points={trendPolyline} />
          </svg>
        </div>
      ) : null}
      {guidance ? <p className="vua-usage-panel__note">{format(copy.capacity[guidance.tier], { freeRam: guidance.availableRamGiB })}</p> : null}
      {snapshot.steamVrRunning === true ? <p className="vua-usage-panel__note">{copy.steamVrRunningNote}</p> : null}
      {snapshot.gpuKind === "integrated" ? <p className="vua-usage-panel__note">{copy.sharedMemory}</p> : null}
    </div>, document.body) : null}
  </>;
}

/** First-play guidance. A web probe never becomes a game-readiness gate; changing
 * settings or retrying retires the previous report until new observations arrive. */
import { useEffect, useRef, useState } from "react";
import { NETWORK_LINKS, NETEASE_UU_URL, type NetworkIntent, type NetworkReport } from "@vua/contracts";
import { useGateway } from "../../gateway/index.ts";
import { format, formatDateTime, strings } from "../../i18n/index.ts";
import { Card } from "../../components/primitives/Card.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { StatusLight } from "../../components/primitives/StatusLight.tsx";
import { GuideEntryButton } from "../guide/GuideEntryButton.tsx";
import { GUIDE_TARGETS } from "../guide/guide-target.ts";

const copy = strings.network;
export function NetworkPanel() {
  const port = useGateway().environment.network;
  const [ready, setReady] = useState(false);
  const [intent, setIntent] = useState<NetworkIntent>({ route: "desktop_play", region: "auto" });
  const [report, setReport] = useState<NetworkReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    let alive = true;
    setReady(false); setReport(null); setBusy(false);
    if (port) void port.capability().then(c => { if (alive) setReady(c.state === "ready"); }, () => {});
    return () => { alive = false; generation.current++; };
  }, [port]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  if (!port || !ready) return null;
  const change = (next: NetworkIntent) => { generation.current++; setIntent(next); setReport(null); setFailed(false); };
  const check = async () => {
    const ticket = ++generation.current;
    setBusy(true); setElapsed(0); setFailed(false); setReport(null);
    try { const next = await port.check(intent); if (ticket === generation.current) setReport(next); }
    catch { if (ticket === generation.current) setFailed(true); }
    finally { if (ticket === generation.current) setBusy(false); }
  };
  const showUu = intent.region === "china_mainland" || report?.effectiveRegion === "china_mainland";
  return <Card className="vua-network">
    <h2 className="vua-title">{copy.title}</h2>
    {collapsed ? <>
      <p>{copy.continued}</p>
      <Button variant="subtle" onClick={() => setCollapsed(false)}>{copy.reopen}</Button>
    </> : <>
      <p>{copy.description}</p>
      <fieldset disabled={busy} className="vua-network__options">
        <legend>{copy.options}</legend>
        <label>{copy.route}<select value={intent.route} onChange={e => change({ ...intent, route: e.target.value as NetworkIntent["route"] })}>
          <option value="desktop_play">{copy.routes.desktop_play}</option>
          <option value="pico_pcvr">{copy.routes.pico_pcvr}</option>
        </select></label>
        <label>{copy.regionUse}<select value={intent.region} onChange={e => change({ ...intent, region: e.target.value as NetworkIntent["region"] })}>
          <option value="auto">{copy.autoRegion}</option>
          <option value="china_mainland">{copy.regions.china_mainland}</option>
          <option value="other">{copy.regions.other}</option>
        </select></label>
      </fieldset>
      <p className="vua-caption vua-text-secondary">{copy.privacy}</p>
      <div className="vua-network__actions">
        <Button variant="primary" disabled={busy} onClick={() => { void check(); }}>{report || failed ? copy.recheck : copy.check}</Button>
        <Button variant="subtle" disabled={busy} onClick={() => setCollapsed(true)}>{copy.continue}</Button>
      </div>
      <div role="status" aria-live="polite">
        {busy ? <p>{format(copy.running, { seconds: elapsed })}</p> : null}
        {failed ? <p>{copy.failed}</p> : null}
        {report ? <>
          <p>{format(copy.summary, { count: report.results.filter(r => r.status === "reachable").length, total: report.results.length })}</p>
          <p className="vua-caption">{format(copy.checkedAt, { time: formatDateTime(report.capturedAt) })}</p>
          <p>{copy.region}{": "}{copy.regions[report.effectiveRegion]}{intent.region === "auto" ? ` — ${copy.regionHint}` : ""}</p>
          <ul className="vua-network__results">{report.results.map(result => <li key={result.target}>
            <header><StatusLight level={result.status === "reachable" ? "ok" : result.status === "probe_error" ? "unknown" : "warning"} />
              <strong>{copy.targets[result.target]}</strong><span>{copy.statuses[result.status]}</span></header>
            <p className="vua-caption">{format(copy.responseTime, { milliseconds: result.elapsedMs })}{result.httpStatus === null ? "" : ` · HTTP ${result.httpStatus}`}</p>
            {result.status !== "reachable" ? <p>{copy.remedies[result.status]}</p> : null}
            {/* Main owns web navigation and any source confirmation. A native anchor
                avoids treating Electron's intentional popup denial as a failed link. */}
            <a href={NETWORK_LINKS[result.target]} target="_blank" rel="noopener noreferrer">{copy.openService}</a>
          </li>)}</ul>
        </> : null}
      </div>
      {showUu ? <aside className="vua-network__guidance">
        <h3>{copy.uuTitle}</h3><p>{copy.uuQualifier}</p><p>{copy.uuSteps}</p><p>{copy.uuAffiliation}</p>
        <a href={NETEASE_UU_URL} target="_blank" rel="noopener noreferrer">{copy.openUu}</a>
        <p className="vua-caption">{copy.uuRecheck}</p>
      </aside> : null}
      <details className="vua-network__guidance"><summary>{copy.lagTitle}</summary>
        <p>{copy.lagRegion}</p><p>{copy.lagPerformance}</p>
      </details>
      <p className="vua-caption vua-text-secondary">{copy.scope}</p>
      {intent.route === "pico_pcvr" ? <p>{copy.picoLocal}</p> : null}
      {intent.route === "pico_pcvr" ? (
        <GuideEntryButton target={GUIDE_TARGETS.picoPrepare} label={copy.guideCta} />
      ) : null}
    </>}
  </Card>;
}

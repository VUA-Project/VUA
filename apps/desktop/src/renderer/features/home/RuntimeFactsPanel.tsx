import { useState } from "react";
import { useEnvironmentView, useGateway, type EnvironmentView } from "../../gateway/index.ts";
import { CHECK_GROUPS } from "../deployer/deployer-model.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { RouteGlyph } from "../../components/RouteTile.tsx";
import { strings } from "../../i18n/index.ts";
export function RuntimeFactsPanel() {
  const gateway = useGateway(); const view = useEnvironmentView();
  const [fresh, setFresh] = useState<EnvironmentView | null>(null); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const phase = (fresh ?? view).deployer.zones.play;
  const evidence = phase.kind === "results" ? phase : phase.kind === "not-run" ? null : phase.last;
  const items = evidence?.items.filter(item => (CHECK_GROUPS[0].memberIds as readonly string[]).includes(item.id)) ?? [];
  const copy = strings.environmentCards;
  return <details className="vua-runtime-facts"><summary>{copy.runtime}</summary>
    <div className="vua-environment-detail"><p>{copy.runtimeHint}</p>
      <Button disabled={busy} onClick={() => { setBusy(true); setFailed(false); void gateway.environment.runCheck("play").then(setFresh, () => setFailed(true)).finally(() => setBusy(false)); }}>{busy ? copy.checking : copy.inspect}</Button>
      {failed || phase.kind !== "results" ? <p role="status">{copy.unknown}</p> : null}
      <ul className="vua-runtime-facts__list">{items.map(item => <li key={item.id}>
        <RouteGlyph brand={item.id === "pico_runtime" ? "pico" : item.id === "oculus_runtime" ? "meta" : item.id === "vive_runtime" ? "htcvive" : item.id === "steamvr" ? "valve" : undefined} kind="headset" />
        <strong>{item.title}</strong><span>{phase.kind !== "results" || failed ? copy.unknown : item.status === "ok" ? copy.installed : item.status === "error" ? copy.unknown : copy.notFound}</span>
      </li>)}</ul>
    </div>
  </details>;
}

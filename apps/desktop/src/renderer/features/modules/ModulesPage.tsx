import { useState } from "react";
import { useAmfModule, useGateway } from "../../gateway/index.ts";
import { format, strings, TERMS } from "../../i18n/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { Badge } from "../../components/primitives/Badge.tsx";

export function ModulesPage({ onOpen, embedded = false }: { onOpen: () => void; embedded?: boolean }) {
  const snapshot = useAmfModule();
  const gateway = useGateway();
  const copy = strings.amfModule;
  const text = (key: keyof typeof copy) => format(copy[key], { amf: TERMS.amf });
  const [changing, setChanging] = useState(false);
  const [outcome, setOutcome] = useState<"busy" | "failed" | null>(null);
  const change = async (enabled: boolean) => {
    setChanging(true); setOutcome(null);
    try {
      const result = await gateway.amfModule.setEnabled(enabled);
      if (result.outcome !== "updated") setOutcome(result.outcome);
    } catch { setOutcome("failed"); }
    finally { setChanging(false); }
  };
  return <div className={embedded ? "vua-page__stack" : "vua-page"}>
    {!embedded ? <header className="vua-page__hero"><h1 className="vua-title">{text("title")}</h1></header> : null}
    <p className="vua-text-secondary">{text("hint")}</p>
    <Card>
      <div className="vua-page__stack" data-module="production">
        <div className="vua-page__actions"><h2 className="vua-title">{text("amf")}</h2><Badge tone={snapshot.state === "ready" ? "success" : snapshot.state === "failed" ? "warning" : "neutral"}>{text(snapshot.state)}</Badge></div>
        <p>{text("description")}</p>
        <div className="vua-page__actions">
          {snapshot.state === "ready" ? <Button variant="primary" data-nav-id="open-amf" onClick={onOpen}>{text("open")}</Button> : <Button variant="primary" data-nav-id="enable-amf" disabled={changing || snapshot.state === "starting" || snapshot.state === "stopping"} onClick={() => void change(true)}>{changing ? text("wait") : snapshot.installed ? text("retry") : text("enable")}</Button>}
          {snapshot.installed ? <Button variant="subtle" data-nav-id="disable-amf" disabled={changing || snapshot.state === "starting"} onClick={() => void change(false)}>{text("disable")}</Button> : null}
        </div>
        <p className="vua-caption vua-text-secondary">{text("retained")}</p>
        {outcome ? <p role="status">{outcome === "busy" ? text("busy") : text("changeFailed")}</p> : null}
      </div>
    </Card>
  </div>;
}

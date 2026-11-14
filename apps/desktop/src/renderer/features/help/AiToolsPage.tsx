import { useEffect, useRef, useState } from "react";
import type { AiToolsSnapshotV01 } from "@vua/contracts";
import { toast } from "../../components/primitives/toast-store.ts";
import type { PageId } from "../../app/nav-model.ts";
import { useGateway } from "../../gateway/index.ts";
import { currentLocale, strings } from "../../i18n/index.ts";
import { Card } from "../../components/primitives/Card.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { AiRequestCard } from "../ai-requests/AiRequestCard.tsx";
import { requestPage } from "../ai-requests/ai-request-routing.ts";
import { revealRequest } from "../ai-requests/ai-request-reveal.ts";
import "./ai-tools.css";

const copy = strings.aiTools;
/** Connection setup and the list of every AI request. Each request is decided on the page it changes;
 * requests without such a page are decided here. */
export function AiToolsPage({ navigate }: { navigate: (page: PageId) => void }) {
  const port = useGateway().aiTools;
  const [snapshot, setSnapshot] = useState<AiToolsSnapshotV01 | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const approvalSection = useRef<HTMLElement>(null);
  const shownRequests = useRef(new Set<string>());
  useEffect(() => {
    const currentIds = new Set(snapshot?.requests.map(request => request.id) ?? []);
    shownRequests.current = new Set([...shownRequests.current].filter(id => currentIds.has(id)));
    const fresh = snapshot?.requests.filter(request => request.state === "pending" && !shownRequests.current.has(request.id)) ?? [];
    if (fresh.length) {
      fresh.forEach(request => shownRequests.current.add(request.id));
      // Show the actual decision immediately, without changing OS focus or
      // making the player scroll past the connection instructions again.
      approvalSection.current?.scrollIntoView({ block: "start" });
    }
  }, [snapshot?.requests]);
  useEffect(() => {
    if (!port) return;
    let alive = true;
    const update = (value: AiToolsSnapshotV01) => { if (alive) setSnapshot(value); };
    void port.snapshot().then(update, () => { if (alive) setError(true); });
    const unsubscribe = port.subscribe(update);
    return () => { alive = false; unsubscribe(); };
  }, [port]);
  useEffect(() => {
    setPrompt("");
    if (!port || !snapshot?.enabled || !snapshot.endpoint) return;
    let alive = true;
    void port.prompt(currentLocale).then(value => { if (alive) setPrompt(value); }, () => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [port, snapshot?.enabled, snapshot?.endpoint]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(false);
    try { await action(); } catch { setError(true); } finally { setBusy(false); }
  };
  const clear = port?.clear ? (ids: readonly string[]) => { void act(async () => setSnapshot(await port.clear!(ids))); } : undefined;
  if (!port) return <Card><p role="status">{copy.unavailable}</p></Card>;
  return <div className="vua-ai-tools">
    <Card>
      <h2>{copy.first}</h2>
      <div className="vua-ai-tools__controls"><Button variant="primary" disabled={busy} onClick={() => { void act(async () => setSnapshot(await port.setEnabled(!snapshot?.enabled))); }}>{snapshot?.enabled ? copy.disable : copy.enable}</Button>
        <span role="status">{snapshot?.enabled ? copy.on : copy.off}</span></div>
      {snapshot?.endpoint ? <p className="vua-caption">{copy.endpoint}: <code>{snapshot.endpoint}</code> · {copy.clients}: {snapshot.connections}</p> : null}
      {error || snapshot?.error ? <p role="alert">{copy.error}</p> : null}
    </Card>
    {snapshot?.enabled ? <Card>
      <h2>{copy.second}</h2>
      <textarea className="vua-ai-tools__prompt" rows={12} readOnly aria-label={copy.second} value={prompt} />
      <div className="vua-ai-tools__copy-actions">
        <Button disabled={busy || !prompt} onClick={() => { void act(async () => { await port.copyPrompt(currentLocale); toast(copy.copied, "success"); }); }}>{copy.copy}</Button>
        {port.copyConfig ? <Button variant="subtle" disabled={busy || !prompt} onClick={() => { void act(async () => { await port.copyConfig!(); toast(copy.copied, "success"); }); }}>{copy.copyConfig}</Button> : null}
      </div>
      <p className="vua-caption">{copy.private}</p>
      <h3>{copy.third}</h3><p>{copy.thirdHint}</p>
    </Card> : null}
    <section ref={approvalSection} className="vua-ai-tools__requests" aria-label={copy.requests}>
      <header className="vua-ai-tools__request-heading"><h2>{copy.requests}</h2>
        {clear ? <Button variant="subtle" disabled={busy || !snapshot?.requests.length} onClick={() => clear(snapshot?.requests.map(request => request.id) ?? [])}>{copy.clearAll}</Button> : null}</header>
      {snapshot?.requests.length ? <p className="vua-caption">{copy.clearHint}</p> : <p>{copy.noRequests}</p>}
      {[...(snapshot?.requests ?? [])].reverse().map(request => requestPage(request) === "help-ai"
        ? <AiRequestCard key={request.id} request={request} busy={busy} onClear={clear ? () => clear([request.id]) : undefined}
          onResolve={decision => { void act(async () => setSnapshot(await port.resolve(request.id, decision))); }} />
        : <AiRequestCard key={request.id} request={request} busy={busy} onClear={clear ? () => clear([request.id]) : undefined} onOpen={() => revealRequest(request, navigate)} />)}
    </section>
  </div>;
}

import { useEffect, useRef, useState } from "react";
import type { PageId } from "../../app/nav-model.ts";
import { useTaskCenter } from "../../gateway/index.ts";
import { strings } from "../../i18n/index.ts";
import { AiRequestCard } from "./AiRequestCard.tsx";
import { requestPage, visibleRequests } from "./ai-request-routing.ts";
import { onRequestRevealed, takeRevealedRequest } from "./ai-request-reveal.ts";
import { useAiRequests } from "./use-ai-requests.ts";

const copy = strings.aiTools;

/** AI requests that this page owns, decided where their result shows. */
export function AiRequestsHere({ page }: { page: PageId }) {
  const { snapshot, busy, failed, resolve } = useAiRequests();
  const tasks = useTaskCenter().tasks;
  const taskOrigin = (taskId: string) => tasks.find(task => task.id === taskId)?.originPage;
  const [revealed, setRevealed] = useState<string | null>(takeRevealedRequest);
  const section = useRef<HTMLElement>(null);
  useEffect(() => onRequestRevealed(id => { takeRevealedRequest(); setRevealed(id); }), []);
  const requests = visibleRequests(snapshot?.requests ?? [], Date.now()).filter(request => requestPage(request, taskOrigin) === page).reverse();
  const shown = requests.some(request => request.id === revealed);
  useEffect(() => {
    if (!shown || !revealed) return;
    section.current?.querySelector(`[data-ai-request="${CSS.escape(revealed)}"]`)?.scrollIntoView({ block: "start" });
  }, [shown, revealed]);
  if (requests.length === 0) return null;
  return <section ref={section} className="vua-ai-requests-here" aria-label={copy.requests}>
    <h2>{copy.requests}</h2>
    {failed ? <p role="alert">{copy.error}</p> : null}
    {requests.map(request => <AiRequestCard key={request.id} request={request} busy={busy} revealed={request.id === revealed}
      onResolve={decision => { void resolve(request.id, decision); }} />)}
  </section>;
}

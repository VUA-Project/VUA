import type { AiActionRequestV01 } from "@vua/contracts";
import type { PageId } from "../../app/nav-model.ts";
import { requestProductionRun } from "../amf/production-recipe-navigation.ts";
import { requestPage, requestRunId } from "./ai-request-routing.ts";

// The card to bring into view once its page has rendered; survives the page change.
let revealed: string | null = null;
const listeners = new Set<(requestId: string) => void>();

/** Opens the page that owns the request, with the request's run selected, and marks its card. */
export function revealRequest(request: AiActionRequestV01, navigate: (page: PageId) => void, taskOrigin?: (taskId: string) => PageId | undefined): void {
  const runId = requestRunId(request);
  if (runId) requestProductionRun(runId);
  revealed = request.id;
  navigate(requestPage(request, taskOrigin));
  for (const listener of listeners) listener(request.id);
}
export function takeRevealedRequest(): string | null { const id = revealed; revealed = null; return id; }
export function onRequestRevealed(listener: (requestId: string) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}

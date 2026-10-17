import type { AiActionRequestV01 } from "@vua/contracts";
import type { PageId } from "../../app/nav-model.ts";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const parameters = (request: AiActionRequestV01) => record(request.details.parameters) ? request.details.parameters : {};
const PLAY_PURPOSES = new Set(["desktop_play", "pico_pcvr"]);

/** The page where the player confirms this request: the page that owns what the request changes. */
export function requestPage(request: AiActionRequestV01, taskOrigin: (taskId: string) => PageId | undefined = () => undefined): PageId {
  const params = parameters(request);
  if (request.tool === "vua_request_amf_upload") return "release";
  if (request.tool.startsWith("vua_request_amf_")) return "workshop";
  if (request.tool === "vua_request_play") return "env-play";
  if (request.tool === "vua_request_tool") return "tools-discover";
  if (request.tool === "vua_request_installation") {
    const purposes = record(params.intent) && Array.isArray(params.intent.purposes) ? params.intent.purposes : [];
    return purposes.length > 0 && purposes.every(purpose => PLAY_PURPOSES.has(String(purpose))) ? "env-play" : "env-create";
  }
  if (request.tool === "vua_request_cancel_task" && typeof params.taskId === "string") return taskOrigin(params.taskId) ?? "help-ai";
  return "help-ai";
}

/** The Avatar production run an AMF request acts on. */
export function requestRunId(request: AiActionRequestV01): string | null {
  const runId = parameters(request).runId;
  return request.tool.startsWith("vua_request_amf_") && typeof runId === "string" && runId.length > 0 ? runId : null;
}

/** Requests the player still decides, and ones that changed state in the last minutes. */
export function visibleRequests(requests: readonly AiActionRequestV01[], now: number, recentMs = 20 * 60_000): AiActionRequestV01[] {
  return requests.filter(request => request.state === "pending" || request.state === "running" || now - Date.parse(request.createdAt) < recentMs);
}

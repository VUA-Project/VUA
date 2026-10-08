import { isDeploymentIntent, type DeploymentIntent } from "@vua/contracts";

/** A bookmark of an accepted task, never consent or readiness. Returning to the
 * page only queries that task; every new execution still needs a fresh plan. */
export interface DeploymentReceiptBookmark {
  readonly v: 1;
  readonly taskId: string;
  readonly intent: DeploymentIntent;
  readonly startedAt: number;
}

export function readDeploymentReceipt(raw: string | null): DeploymentReceiptBookmark | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const bookmark = value as Record<string, unknown>;
    if (Object.keys(bookmark).length !== 4 || bookmark.v !== 1
      || typeof bookmark.taskId !== "string" || !bookmark.taskId.trim() || bookmark.taskId.length > 128 || /\p{Cc}/u.test(bookmark.taskId)
      || !isDeploymentIntent(bookmark.intent) || !Number.isSafeInteger(bookmark.startedAt) || Number(bookmark.startedAt) < 0) return null;
    return bookmark as unknown as DeploymentReceiptBookmark;
  } catch { return null; }
}

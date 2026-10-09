import type { PlaySession } from "@vua/contracts";
import type { EnvironmentAction } from "./EnvironmentCard.tsx";
export interface PlayCardDecision { action: EnvironmentAction; status: "checking" | "installing" | "unknown" | "missing" | "ready" | "starting" | "close" | "stopping" | "attention"; spinning: boolean; disabled: boolean; warning: boolean }
export function playCardDecision(session: PlaySession | null, unavailable: boolean, installing: boolean, installError: boolean): PlayCardDecision {
  if (unavailable) return { action: "unknown", status: "unknown", spinning: false, disabled: false, warning: true };
  if (session?.canStop) return { action: "stop", status: session.state === "stopping" ? "stopping" : session.state === "starting" ? "starting" : "close", spinning: session.state === "starting" || session.state === "stopping", disabled: session.state === "stopping", warning: session.issue !== null };
  if (installing) return { action: "busy", status: "installing", spinning: true, disabled: false, warning: false };
  if (installError || session?.issue || session?.software.some(s => s.presence === "unknown" || s.presence === "unusable")) return { action: "attention", status: "attention", spinning: false, disabled: false, warning: true };
  if (session === null) return { action: "busy", status: "checking", spinning: true, disabled: false, warning: false };
  const ready = session.software.length > 0 && session.software.every(s => s.presence === "verified");
  return { action: ready ? "start" : "prepare", status: ready ? "ready" : "missing", spinning: false, disabled: false, warning: false };
}

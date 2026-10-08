import type { GatewayClient } from "./gateway-client.ts";
import { isManagerAppsResult, type ManagerAppsResult } from "@vua/contracts";
export interface CreatorEditor { readonly version: string; readonly path: string; readonly classification: string }
export interface CreatorManagers {
  readonly editors: readonly CreatorEditor[];
  readonly editorsKnown: boolean;
  /** Config discovery only; a config file is not proof of an installed manager executable. */
  readonly vcc: "found" | "not_found" | "read_failed" | null;
  readonly alcom: "found" | "not_found" | "read_failed" | null;
  readonly apps: ManagerAppsResult["managerApps"]["apps"] | null;
}
function record(v: unknown): v is Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v); }
export function createCreatorInventoryPort(client: GatewayClient): { inspect(): Promise<CreatorManagers> } {
  return { async inspect() {
    const [appsRequest, managerRequest] = await Promise.allSettled([
      client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.inspectManagerApps", params: {} }),
      client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "project.environmentManagers", params: {} }),
    ]);
    const appsReply = appsRequest.status === "fulfilled" ? appsRequest.value : null;
    const apps = appsReply?.ok && isManagerAppsResult(appsReply.value) ? appsReply.value.managerApps.apps : null;
    const r = managerRequest.status === "fulfilled" ? managerRequest.value : null;
    const s = r?.ok && "operation" in r.value && r.value.operation === "project.environmentManagers" && record(r.value.result) ? r.value.result : null;
    const presence = (v: unknown): v is { presence: CreatorManagers["vcc"] } => record(v) && typeof v.presence === "string" && ["found", "not_found", "read_failed"].includes(v.presence);
    if (!s || s.schemaVersion !== "vua.environment-managers-snapshot/v0.1" || !Array.isArray(s.editors) || !presence(s.vcc) || !presence(s.alcom)) {
      if (!apps) throw new Error("creator_inventory_unavailable");
      return { editors: [], editorsKnown: false, vcc: null, alcom: null, apps };
    }
    const findings = s.editors;
    // Directory discoveries alone do not establish a complete editor. Verify each
    // candidate through the existing read-only primitive before showing its card.
    const editors: CreatorEditor[] = [];
    let editorsKnown = findings.length <= 64;
    for (const e of findings.slice(0, 64)) {
      if (!record(e) || typeof e.version !== "string" || typeof e.path !== "string" || typeof e.classification !== "string") { editorsKnown = false; continue; }
      const verified = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.verifyEditor", params: { path: e.path } }).catch(() => null);
      if (!verified?.ok) { editorsKnown = false; continue; }
      if (!record(verified.value) || verified.value.verdict !== "verified"
        || typeof verified.value.version !== "string" || typeof verified.value.exePath !== "string" || typeof verified.value.classification !== "string") continue;
      editors.push({ version: verified.value.version, path: verified.value.exePath, classification: verified.value.classification });
    }
    return { editors, editorsKnown, vcc: s.vcc.presence, alcom: s.alcom.presence, apps };
  } };
}

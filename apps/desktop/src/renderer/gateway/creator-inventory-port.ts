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
    const [appsRequest, environmentRequest, managerRequest] = await Promise.allSettled([
      client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.inspectManagerApps", params: {} }),
      client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.getSnapshot", params: {} }),
      client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "project.environmentManagers", params: {} }),
    ]);
    const appsReply = appsRequest.status === "fulfilled" ? appsRequest.value : null;
    const apps = appsReply?.ok && isManagerAppsResult(appsReply.value) ? appsReply.value.managerApps.apps : null;
    const r = managerRequest.status === "fulfilled" ? managerRequest.value : null;
    const s = r?.ok && "operation" in r.value && r.value.operation === "project.environmentManagers" && record(r.value.result) ? r.value.result : null;
    const presence = (v: unknown): v is { presence: CreatorManagers["vcc"] } => record(v) && typeof v.presence === "string" && ["found", "not_found", "read_failed"].includes(v.presence);
    const config = s?.schemaVersion === "vua.environment-managers-snapshot/v0.1" ? s : null;
    const vcc = config && presence(config.vcc) ? config.vcc.presence : null;
    const alcom = config && presence(config.alcom) ? config.alcom.presence : null;
    // Editor discovery belongs to the host. The AMF-owned project/manager
    // configuration reply is optional and never gates this inventory.
    const environment = environmentRequest.status === "fulfilled" && environmentRequest.value.ok ? environmentRequest.value.value : null;
    const items = record(environment) && Array.isArray(environment.items) ? environment.items : [];
    const finding = items.find(item => record(item) && item.checkId === "unity_editors" && item.zone === "create");
    const observed = record(finding) && record(finding.facts) && Array.isArray(finding.facts.editors) ? finding.facts.editors : null;
    const findings = record(finding) && finding.presence === "detected" && observed !== null ? observed : [];
    const discoveryKnown = record(finding) && (finding.presence === "not_detected" || finding.presence === "detected" && observed !== null);
    if (!apps && vcc === null && alcom === null && !discoveryKnown) throw new Error("creator_inventory_unavailable");
    // Directory discoveries alone do not establish a complete editor. Verify each
    // candidate through the existing read-only primitive before showing its card.
    const editors: CreatorEditor[] = [];
    let editorsKnown = discoveryKnown && findings.length <= 64;
    for (const e of findings.slice(0, 64)) {
      if (!record(e) || typeof e.version !== "string" || typeof e.path !== "string" || typeof e.classification !== "string") { editorsKnown = false; continue; }
      const verified = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.verifyEditor", params: { path: e.path } }).catch(() => null);
      if (!verified?.ok) { editorsKnown = false; continue; }
      if (!record(verified.value) || verified.value.verdict !== "verified"
        || typeof verified.value.version !== "string" || typeof verified.value.exePath !== "string" || typeof verified.value.classification !== "string") continue;
      editors.push({ version: verified.value.version, path: verified.value.exePath, classification: verified.value.classification });
    }
    return { editors, editorsKnown, vcc, alcom, apps };
  } };
}

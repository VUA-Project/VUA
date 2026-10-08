import { describe, expect, it, vi } from "vitest";
import type { DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createCreatorInventoryPort } from "./creator-inventory-port.ts";
const unavailable = { ok: false as const, error: { kind: "unavailable" as const } };
const reply = (value: unknown) => ({ ok: true as const, value: value as DesktopGatewaySuccessValueV1 });
const apps = { managerApps: { schemaVersion: "vua.manager-apps/v0.1", capturedAt: "synthetic", apps: [
  { component: "unity_hub", presence: "not_found", path: null }, { component: "vcc", presence: "not_found", path: null }, { component: "alcom", presence: "found", path: "C:/Synthetic/ALCOM.exe" },
] } };
const managers = (editors: unknown[]) => ({ operation: "project.environmentManagers", result: { schemaVersion: "vua.environment-managers-snapshot/v0.1", editors, vcc: { presence: "found" }, alcom: { presence: "not_found" } } });
describe("creator inventory Gateway port", () => {
  it("does not treat configuration or an editor directory as installed software", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>(async request => {
      if (request.method === "environment.inspectManagerApps") return reply(apps);
      if (request.method === "project.environmentManagers") return reply(managers([
        { version: "2019.4.31f1", path: "C:/Synthetic/Incomplete", classification: "migration_source" },
        { version: "2022.3.22f1c1", path: "C:/Synthetic/Complete", classification: "production_target" },
      ]));
      if (request.method === "environment.verifyEditor") return reply(request.params.path === "C:/Synthetic/Incomplete" ? { verdict: "refused" } : { verdict: "verified", version: "2022.3.22f1c1", exePath: "C:/Synthetic/Complete/Editor/Unity.exe", classification: "production_target" });
      return unavailable;
    });
    const result = await createCreatorInventoryPort({ invoke, subscribe: () => () => {} }).inspect();
    expect(result.editors.map(e => e.version)).toEqual(["2022.3.22f1c1"]); expect(result.editorsKnown).toBe(true);
    expect(result.vcc).toBe("found"); expect(result.apps?.find(a => a.component === "vcc")?.presence).toBe("not_found");
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ method: "environment.verifyEditor", params: { path: "C:/Synthetic/Complete" } }));
  });
  it("retains executable observations if manager configuration discovery fails", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>(async request => request.method === "environment.inspectManagerApps" ? reply(apps) : unavailable);
    const result = await createCreatorInventoryPort({ invoke, subscribe: () => () => {} }).inspect();
    expect(result).toMatchObject({ editors: [], editorsKnown: false, vcc: null, alcom: null }); expect(result.apps?.find(a => a.component === "alcom")?.presence).toBe("found");
  });
  it("preserves partial facts and reports unconfirmed editors on verification failure", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>(async request => request.method === "project.environmentManagers" ? reply(managers([{ version: "2021.3.45f1", path: "C:/Synthetic/Editor", classification: "migration_source" }])) : unavailable);
    expect(await createCreatorInventoryPort({ invoke, subscribe: () => () => {} }).inspect()).toMatchObject({ editors: [], editorsKnown: false, vcc: "found", apps: null });
    invoke.mockResolvedValue(unavailable);
    await expect(createCreatorInventoryPort({ invoke, subscribe: () => () => {} }).inspect()).rejects.toThrow("creator_inventory_unavailable");
  });
});

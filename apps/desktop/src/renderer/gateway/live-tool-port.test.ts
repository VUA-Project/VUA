import { describe, expect, it, vi } from "vitest";
import type { ExternalToolSnapshot } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLiveToolPort } from "./live-tool-port.ts";
const snapshot: ExternalToolSnapshot = { schemaVersion: "vua.external-tool/v0.1", toolId: "vrcft", capturedAt: "synthetic", presence: "installed", steamReady: true, buildId: "123", running: true, canStop: false, activity: "idle", issue: null };
describe("live external-tool Gateway port", () => {
  it("preserves caller command identity and borrowed-instance facts", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValue({ ok: true, value: { toolConnection: snapshot } });
    const port = createLiveToolPort({ invoke, subscribe: () => () => {} });
    expect(await port.observe()).toEqual(snapshot); await port.act("start", "one-click");
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ method: "tools.actConnection", params: { toolId: "vrcft", action: "start", commandId: "one-click" } }));
  });
  it("rejects unavailable or malformed observations without inventing installed hardware", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValueOnce({ ok: false, error: { kind: "unavailable" } })
      // Deliberately forged provider packet: the runtime boundary must reject it.
      .mockResolvedValueOnce({ ok: true, value: { toolConnection: { ...snapshot, toolId: "custom" } as unknown as ExternalToolSnapshot } })
      .mockResolvedValueOnce({ ok: true, value: { toolConnection: { ...snapshot, running: false, canStop: true } } });
    const port = createLiveToolPort({ invoke, subscribe: () => () => {} });
    for (let i = 0; i < 3; i++) await expect(port.observe()).rejects.toThrow("external_tool_unavailable");
  });
});

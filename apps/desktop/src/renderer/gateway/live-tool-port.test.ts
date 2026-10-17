import { describe, expect, it, vi } from "vitest";
import { EXTERNAL_TOOL_IDS, type ExternalToolId, type ExternalToolSnapshot } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLiveToolPort } from "./live-tool-port.ts";
const snapshot: ExternalToolSnapshot = { schemaVersion: "vua.external-tool/v0.2", toolId: "vrcft", capturedAt: "synthetic", presence: "installed", steamReady: true, buildId: "123", running: true, canStop: false, activity: "idle", issue: null };
describe("live external-tool Gateway port", () => {
  it("preserves caller command identity and borrowed-instance facts", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValue({ ok: true, value: { toolConnection: snapshot } });
    const port = createLiveToolPort({ invoke, subscribe: () => () => {} });
    expect(await port.observe("vrcft")).toEqual(snapshot); await port.act("vrcft", "start", "one-click");
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ method: "tools.actConnection", params: { toolId: "vrcft", action: "start", commandId: "one-click" } }));
  });
  it("sends the requested tool identity as params for every fixed Steam entry", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockImplementation(async request =>
      ({ ok: true, value: { toolConnection: { ...snapshot, toolId: (request.params as { toolId: ExternalToolId }).toolId } } }));
    const port = createLiveToolPort({ invoke, subscribe: () => () => {} });
    for (const toolId of EXTERNAL_TOOL_IDS) {
      expect((await port.observe(toolId)).toolId).toBe(toolId);
      expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ method: "tools.observeConnection", params: { toolId } }));
      await port.act(toolId, "install", `once-${toolId}`);
      expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ method: "tools.actConnection", params: { toolId, action: "install", commandId: `once-${toolId}` } }));
    }
  });
  it("rejects unavailable or malformed observations without inventing installed hardware", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValueOnce({ ok: false, error: { kind: "unavailable" } })
      // Deliberately forged provider packet: the runtime boundary must reject it.
      .mockResolvedValueOnce({ ok: true, value: { toolConnection: { ...snapshot, toolId: "custom" } as unknown as ExternalToolSnapshot } })
      .mockResolvedValueOnce({ ok: true, value: { toolConnection: { ...snapshot, running: false, canStop: true } } });
    const port = createLiveToolPort({ invoke, subscribe: () => () => {} });
    for (let i = 0; i < 3; i++) await expect(port.observe("vrcft")).rejects.toThrow("external_tool_unavailable");
  });
  it("rejects forged tool identities, superseded v0.1 snapshots and cross-tool mislabelling", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>()
      // LIV is an accepted N2 entry but not part of the fixed six-tool Steam face.
      .mockResolvedValueOnce({ ok: true, value: { toolConnection: { ...snapshot, toolId: "liv" } as unknown as ExternalToolSnapshot } })
      .mockResolvedValueOnce({ ok: true, value: { toolConnection: { ...snapshot, schemaVersion: "vua.external-tool/v0.1" } as unknown as ExternalToolSnapshot } })
      // A valid v0.2 snapshot answering for a different tool than requested.
      .mockResolvedValueOnce({ ok: true, value: { toolConnection: { ...snapshot, toolId: "space" } } });
    const port = createLiveToolPort({ invoke, subscribe: () => () => {} });
    await expect(port.observe("vrcft")).rejects.toThrow("external_tool_unavailable");
    await expect(port.observe("vrcft")).rejects.toThrow("external_tool_unavailable");
    await expect(port.observe("vrcft")).rejects.toThrow("external_tool_unavailable");
  });
});

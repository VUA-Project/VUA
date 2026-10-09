import { describe, expect, it, vi } from "vitest";
import type { PlaySession } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { createLivePlayPort } from "./live-play-port.ts";
const session: PlaySession = { schemaVersion: "vua.play-session/v0.2", capturedAt: "synthetic", route: "desktop_play", state: "idle", canStop: false, issue: null,
  software: [{ component: "steam", presence: "verified", running: true, owned: false }, { component: "vrchat", presence: "verified", running: false, owned: false }] };
describe("live play Gateway port", () => {
  it("preserves borrowed software facts and the caller's retry identity across start/stop", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValue({ ok: true, value: { playSession: session } });
    const port = createLivePlayPort({ invoke, subscribe: () => () => {} });
    expect(await port.observe("desktop_play")).toEqual(session);
    await port.start("desktop_play", "start-once"); await port.stop("desktop_play", "stop-once");
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ method: "environment.startPlay", params: { route: "desktop_play", commandId: "start-once" } }));
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({ method: "environment.stopPlay", params: { route: "desktop_play", commandId: "stop-once" } }));
  });
  it("rejects wrong-route, inconsistent ownership and unavailable observations", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValueOnce({ ok: true, value: { playSession: session } })
      .mockResolvedValueOnce({ ok: true, value: { playSession: { ...session, software: session.software.map(s => ({ ...s, owned: true })) } } })
      .mockResolvedValue({ ok: false, error: { kind: "unavailable" } });
    const port = createLivePlayPort({ invoke, subscribe: () => () => {} });
    await expect(port.observe("pico_pcvr")).rejects.toThrow("play_session_unavailable");
    await expect(port.observe("desktop_play")).rejects.toThrow("play_session_unavailable");
    await expect(port.observe("desktop_play")).rejects.toThrow("play_session_unavailable");
  });
});

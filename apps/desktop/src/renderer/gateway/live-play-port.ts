import { isPlaySessionResult, type PlayRoute } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import type { PlayPort } from "./environment-port.ts";
export function createLivePlayPort(client: GatewayClient): PlayPort {
  async function call(method: "environment.observePlay" | "environment.startPlay" | "environment.stopPlay", route: PlayRoute, commandId?: string) {
    const result = await client.invoke(method === "environment.observePlay"
      ? { schemaVersion: 1, requestId: crypto.randomUUID(), method, params: { route } }
      : { schemaVersion: 1, requestId: crypto.randomUUID(), method, params: { route, commandId: commandId! } });
    if (!result.ok || !isPlaySessionResult(result.value) || result.value.playSession.route !== route) throw new Error("play_session_unavailable");
    return result.value.playSession;
  }
  return { observe: route => call("environment.observePlay", route), start: (route, commandId) => call("environment.startPlay", route, commandId), stop: (route, commandId) => call("environment.stopPlay", route, commandId) };
}

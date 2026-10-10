import { isExternalToolResult, type ExternalToolAction } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
export function createLiveToolPort(client: GatewayClient) {
  async function call(action?: ExternalToolAction, commandId?: string) {
    const result = await client.invoke(action === undefined
      ? { schemaVersion: 1, requestId: crypto.randomUUID(), method: "tools.observeConnection", params: { toolId: "vrcft" } }
      : { schemaVersion: 1, requestId: crypto.randomUUID(), method: "tools.actConnection", params: { toolId: "vrcft", action, commandId: commandId! } });
    if (!result.ok || !isExternalToolResult(result.value)) throw new Error("external_tool_unavailable");
    return result.value.toolConnection;
  }
  return { observe: () => call(), act: (action: ExternalToolAction, commandId: string) => call(action, commandId) };
}

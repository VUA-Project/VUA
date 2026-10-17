import { isExternalToolResult, type ExternalToolAction, type ExternalToolId } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
export function createLiveToolPort(client: GatewayClient) {
  async function call(toolId: ExternalToolId, action?: ExternalToolAction, commandId?: string) {
    const result = await client.invoke(action === undefined
      ? { schemaVersion: 1, requestId: crypto.randomUUID(), method: "tools.observeConnection", params: { toolId } }
      : { schemaVersion: 1, requestId: crypto.randomUUID(), method: "tools.actConnection", params: { toolId, action, commandId: commandId! } });
    // 回执必须匹配所问工具:六个固定条目之一被错标时如实缺席,不在卡片间串台
    if (!result.ok || !isExternalToolResult(result.value) || result.value.toolConnection.toolId !== toolId) throw new Error("external_tool_unavailable");
    return result.value.toolConnection;
  }
  return { observe: (toolId: ExternalToolId) => call(toolId), act: (toolId: ExternalToolId, action: ExternalToolAction, commandId: string) => call(toolId, action, commandId) };
}

import { afterEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { DesktopGatewayRequestV1, DesktopGatewayResponseV1 } from "@vua/contracts";
import { AiToolsServer } from "./ai-tools-server.js";
import { AI_TOOLS, aiGatewayRequest } from "./ai-tool-catalog.js";
import { request as httpRequest } from "node:http";

const token = "a".repeat(43), digest = "b".repeat(64);
const intent = { purposes: ["desktop_play"], editorRoot: "C:\\Program Files\\Unity\\Hub\\Editor", useMirrors: true };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function envelope(request: DesktopGatewayRequestV1, value: unknown): DesktopGatewayResponseV1 {
  return { schemaVersion: 1, requestId: request.requestId, ok: true, value } as DesktopGatewayResponseV1;
}
async function setup(handler?: (request: DesktopGatewayRequestV1) => Promise<DesktopGatewayResponseV1>, now?: () => number) {
  const calls: DesktopGatewayRequestV1[] = [];
  const service = new AiToolsServer({ version: "test", port: 0, now, load: () => ({ enabled: false, token }), save: () => {},
    invoke: async request => {
      calls.push(request);
      if (handler) return handler(request);
      if (request.method === "environment.planDeployment") return envelope(request, { deploymentPlan: { digest, intent: request.params.intent,
        steps: [{ component: "steam", action: "install_steam", reason: "missing" }] } });
      if (request.method === "environment.executeDeployment") return envelope(request, { taskId: "test-installation" });
      if (request.method === "environment.observePlay") return envelope(request, { playSession: { route: request.params.route, software: [] } });
      return envelope(request, { observed: request.method });
    } });
  cleanups.push(() => service.dispose());
  await service.setEnabled(true);
  const endpoint = service.snapshot().endpoint!;
  const client = new Client({ name: "test-agent", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  cleanups.push(async () => { await transport.terminateSession().catch(() => {}); await client.close(); });
  return { service, client, endpoint, calls };
}
function data(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
  const text = result.content?.find(value => value.type === "text");
  return JSON.parse(text?.type === "text" ? text.text : "{}") as Record<string, unknown>;
}
describe("built-in MCP, using the official HTTP client", () => {
  it("initializes, lists a closed tool catalog and calls independent reads", async () => {
    const { client, calls, service } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual(AI_TOOLS.map(tool => tool.name));
    expect(service.snapshot().connections).toBe(1);
    await client.callTool({ name: "vua_sop", arguments: { scenario: "pico_pcvr", connection: "wifi" } });
    await client.callTool({ name: "vua_check_environment", arguments: { intent: { purposes: ["desktop_play"] } } });
    expect(calls.map(request => request.method)).toEqual(["environment.getScenarioSop", "environment.checkScenarioEnvironment"]);
    expect(calls[0]!.params).toEqual({ schemaVersion: "0.1", scenario: { scenario: "pico_pcvr", connection: "wifi" } });
    expect(calls[1]!.params).toEqual({ schemaVersion: "0.1", intent });
    expect(service.snapshot().requests).toEqual([]);
  });
  it("queues the concrete installation, deduplicates retries, and requires a local approval", async () => {
    const { client, calls, service } = await setup();
    const args = { intent: { purposes: ["desktop_play"] }, confirmedDigest: digest };
    const first = data(await client.callTool({ name: "vua_request_installation", arguments: args }));
    const second = data(await client.callTool({ name: "vua_request_installation", arguments: args }));
    expect(first.data).toEqual(second.data);
    const request = service.snapshot().requests[0]!;
    expect(request.state).toBe("pending");
    expect(request.details.reviewed).toHaveProperty("deploymentPlan.steps.0.component", "steam");
    expect(calls.map(request => request.method)).toEqual(["environment.planDeployment"]);
    const forged = await client.callTool({ name: "vua_action_status", arguments: { approvalId: request.id, decision: "approve" } });
    expect(forged.isError).toBe(true);
    expect(calls).toHaveLength(1);
    await service.resolve(request.id, "approve");
    expect(calls.map(request => request.method)).toEqual(["environment.planDeployment", "environment.executeDeployment"]);
    expect(service.snapshot().requests[0]).toMatchObject({ state: "accepted", result: { taskId: "test-installation" } });
    await expect(service.resolve(request.id, "approve")).rejects.toThrow("resolved");
    const state = data(await client.callTool({ name: "vua_action_status", arguments: { approvalId: request.id } }));
    expect(state.data).toHaveProperty("state", "accepted");
  });
  it("rejects a stale digest before consent and preserves a backend rejection after consent", async () => {
    let changed = false;
    const { client, service } = await setup(async request => {
      if (request.method === "environment.planDeployment") return envelope(request, { deploymentPlan: { digest, intent } });
      if (changed) return { schemaVersion: 1, requestId: request.requestId, ok: false, error: { code: "application", application: {
        contractVersion: "0.1", code: "vua.deployment.plan_changed", category: "validation", messageKey: "errors.deployment.failed",
        recoverable: true, retryable: false, correlationId: request.requestId,
      } } };
      return envelope(request, {});
    });
    const stale = await client.callTool({ name: "vua_request_installation", arguments: { intent: { purposes: ["desktop_play"] }, confirmedDigest: "c".repeat(64) } });
    expect(stale.isError).toBe(true); expect(service.snapshot().requests).toEqual([]);
    await client.callTool({ name: "vua_request_installation", arguments: { intent: { purposes: ["desktop_play"] }, confirmedDigest: digest } });
    changed = true;
    await service.resolve(service.snapshot().requests[0]!.id, "approve");
    expect(service.snapshot().requests[0]).toMatchObject({ state: "failed", error: "vua.deployment.plan_changed" });
  });
  it("requires pairing on every request and rejects websites, alternate hosts and oversized bodies", async () => {
    const { endpoint } = await setup();
    const post = (headers: Record<string, string>, body = "{}") => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
    expect((await post({})).status).toBe(401);
    expect((await post({ Authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post({ Authorization: `Bearer ${token}`, Origin: "https://booth.pm" })).status).toBe(403);
    const wrongHost = await new Promise<number>(resolve => {
      const request = httpRequest(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, Host: "attacker.test", "Content-Type": "application/json" } }, response => { response.resume(); resolve(response.statusCode!); });
      request.end("{}");
    });
    expect(wrongHost).toBe(403);
    expect((await post({ Authorization: `Bearer ${token}` }, JSON.stringify({ padding: "x".repeat(129 * 1024) }))).status).toBe(413);
  });
  it("keeps a request waiting, lets the AI withdraw it, and withdraws the rest when the connection is turned off", async () => {
    let clock = Date.now();
    const { client, service, calls, endpoint } = await setup(undefined, () => clock);
    await client.callTool({ name: "vua_request_play", arguments: { route: "desktop_play", action: "start" } });
    const first = service.snapshot().requests[0]!;
    await service.resolve(first.id, "reject");
    await client.callTool({ name: "vua_request_play", arguments: { route: "desktop_play", action: "start" } });
    await client.callTool({ name: "vua_request_play", arguments: { route: "desktop_play", action: "stop" } });
    const [, start, stop] = service.snapshot().requests;
    clock += 24 * 60 * 60_000;
    expect(service.snapshot().requests[1]!.state).toBe("pending");
    const withdrawn = data(await client.callTool({ name: "vua_withdraw_request", arguments: { approvalId: start!.id } }));
    expect(withdrawn.data).toMatchObject({ state: "withdrawn", error: "withdrawn_by_ai" });
    await expect(service.resolve(start!.id, "approve")).rejects.toThrow("withdrawn");
    expect((await client.callTool({ name: "vua_withdraw_request", arguments: { approvalId: first.id } })).isError).toBe(true);
    expect(calls.every(request => request.method === "environment.observePlay")).toBe(true);
    expect(service.snapshot()).not.toHaveProperty("token");
    expect(service.prompt("zh-CN")).toContain("Bearer ");
    await service.setEnabled(false);
    expect(service.snapshot().requests.find(r => r.id === stop!.id)).toMatchObject({ state: "withdrawn", error: "connection_disabled" });
    expect(service.snapshot()).toMatchObject({ enabled: false, endpoint: null, connections: 0 });
    expect(() => service.prompt("en")).toThrow("disabled");
    await expect(fetch(endpoint)).rejects.toThrow();
  });
  it("brings waiting requests back after a restart and marks an interrupted dispatch", async () => {
    let saved: unknown = null;
    const options = { version: "test", port: 0, load: () => ({ enabled: false, token }), save: () => {},
      loadRequests: () => saved, saveRequests: (approvals: readonly unknown[]) => { saved = structuredClone(approvals); },
      invoke: async (request: DesktopGatewayRequestV1) => envelope(request, { playSession: { route: "desktop_play", software: [] } }) };
    const first = new AiToolsServer(options);
    await first.setEnabled(true);
    const client = new Client({ name: "restart-agent", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(first.snapshot().endpoint!), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await client.connect(transport);
    await client.callTool({ name: "vua_request_play", arguments: { route: "desktop_play", action: "start" } });
    await transport.terminateSession().catch(() => {}); await client.close();
    const waiting = first.snapshot().requests[0]!;
    await first.dispose();
    (saved as { view: { state: string } }[]).push({ ...(saved as { view: object; request: object }[])[0]!, view: { ...waiting, id: "dispatching", state: "running" } } as never);
    const second = new AiToolsServer(options);
    cleanups.push(() => second.dispose());
    expect(second.snapshot().requests.map(r => [r.id, r.state, r.error])).toEqual([[waiting.id, "pending", undefined], ["dispatching", "failed", "interrupted"]]);
    await second.setEnabled(true);
    await second.resolve(waiting.id, "approve");
    expect(second.snapshot().requests[0]!.state).toBe("accepted");
  });
  it("runs an upload request only with the player's rights confirmation", async () => {
    const { client, calls, service } = await setup();
    const queued = data(await client.callTool({ name: "vua_request_amf_upload", arguments: { runId: "n3-test" } }));
    expect(queued.whatHappened).toContain("waiting for the player");
    const request = service.snapshot().requests[0]!;
    expect(request.details.parameters).toEqual({ runId: "n3-test", schemaVersion: "0.1" });
    expect(calls.map(call => call.method)).toEqual(["amf.production.get"]);
    await expect(service.resolve(request.id, "approve")).rejects.toThrow("upload_confirmation_required");
    await expect(service.resolve(request.id, "approve", { avatarName: " Meiyun", rightsConfirmed: true })).rejects.toThrow("upload_confirmation_required");
    expect(service.snapshot().requests[0]!.state).toBe("pending");
    await service.resolve(request.id, "approve", { avatarName: "Meiyun", rightsConfirmed: true });
    expect(service.snapshot().requests[0]!.state).toBe("accepted");
    expect(calls.at(-1)).toMatchObject({ method: "amf.production.upload", params: { schemaVersion: "0.1", runId: "n3-test", avatarName: "Meiyun", rightsConfirmed: true } });
    const play = data(await client.callTool({ name: "vua_request_play", arguments: { route: "desktop_play", action: "start" } }));
    expect(play.data).toBeTruthy();
    const other = service.snapshot().requests.find(r => r.tool === "vua_request_play")!;
    await expect(service.resolve(other.id, "approve", { avatarName: "Meiyun", rightsConfirmed: true })).rejects.toThrow("upload_confirmation_required");
  });
  it("returns a run's previews as labelled image content", async () => {
    const front = ".vua/previews/n3-test-1/front.png", coat = ".vua/previews/n3-test-0/candidate-000.png";
    const { client, calls } = await setup(async request => {
      if (request.method === "amf.production.get") return envelope(request, { runId: "n3-test", prefabs: [{ path: "Assets/Coat.prefab", isAvatar: false, preview: coat }, { path: "Assets/Hat.prefab", isAvatar: false }],
        result: { facts: { previews: [{ view: "front", path: front }] } } });
      if (request.method === "amf.production.previewImage" && request.params.path === front) return envelope(request, { mediaType: "image/png", data: "iVBORw0KGgoFRONT" });
      return { schemaVersion: 1, requestId: request.requestId, ok: false, error: { code: "application", application: { contractVersion: "0.1", code: "vua.amf_production.preview_missing",
        category: "validation", messageKey: "errors.amfProduction.failed", recoverable: true, retryable: false, correlationId: request.requestId } } } as DesktopGatewayResponseV1;
    });
    const result = await client.callTool({ name: "vua_amf_run", arguments: { runId: "n3-test" } });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([expect.objectContaining({ type: "text" }), { type: "text", text: "Assembled Avatar, front view" }, { type: "image", data: "iVBORw0KGgoFRONT", mimeType: "image/png" }]);
    expect(calls.map(request => [request.method, request.params])).toEqual([["amf.production.get", { schemaVersion: "0.1", runId: "n3-test" }],
      ["amf.production.previewImage", { schemaVersion: "0.1", runId: "n3-test", path: front }], ["amf.production.previewImage", { schemaVersion: "0.1", runId: "n3-test", path: coat }]]);
  });
  it("reports a running run's Unity stage and elapsed time", async () => {
    const progress = { step: "inspect", name: "Identify actual Avatar and outfit prefabs", startedAt: "2026-10-17T08:00:00.000Z", elapsedSeconds: 221, usualSeconds: 412,
      unity: { stage: "importing", current: 123, total: 379, lastActivityAt: "2026-10-17T08:03:41.000Z" } };
    const { client } = await setup(async request => envelope(request, { runId: "n3-test", phase: "preparing", prefabs: [], result: null, usualDurations: { inspect: 412 }, progress }));
    const result = await client.callTool({ name: "vua_amf_run", arguments: { runId: "n3-test" } });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { data: { progress: unknown } }).data.progress).toEqual(progress);
  });
  it("rejects invented methods and parameter injection before touching the Gateway", async () => {
    const { client, calls } = await setup();
    for (const request of [
      { name: "execute_shell", arguments: { command: "anything" } },
      { name: "vua_sop", arguments: { scenario: "desktop_play", connection: "wifi" } },
      { name: "vua_check_environment", arguments: { intent: { purposes: ["desktop_play"], method: "anything" } } },
      { name: "vua_request_play", arguments: { route: "desktop", action: "start" } },
    ]) expect((await client.callTool(request)).isError).toBe(true);
    expect(calls).toEqual([]);
    for (const spec of AI_TOOLS.filter(spec => spec.method && !spec.command && !["vua_task", "vua_material_files", "vua_amf_run", "vua_sop", "vua_check_environment", "vua_plan_installation", "vua_play_status", "vua_tool_status", "vua_amf_plan", "vua_amf_release"].includes(spec.name))) {
      expect(() => aiGatewayRequest(spec, {}, "test")).not.toThrow();
    }
  });
});

describe("the experimental VRChat sign-in stays outside the AI tool catalog", () => {
  it("exposes no vrchat tool, so credentials can never queue as an approval", async () => {
    expect(AI_TOOLS.some(spec => spec.name.includes("vrchat") || (spec.method ?? "").startsWith("vrchat."))).toBe(false);
    const { client } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.some(tool => tool.name.includes("vrchat"))).toBe(false);
    const result = data(await client.callTool({ name: "vua_status", arguments: {} }));
    // The snapshot this test harness returns is the mock's; the real envelope's
    // vrchat field is pinned to exactly two booleans in gateway-router.test.ts.
    expect(result).toBeDefined();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type DesktopGatewayRequestV1, type DesktopGatewayResponseV1, type ExternalToolSnapshot } from "@vua/contracts";
import { AiToolsServer } from "./ai-tools-server.js";
import { MCP_RETRYABLE_CODES, errorFields, runSummary, safeErrorMessage, taskChange, taskSummary } from "./ai-tool-results.js";
import { AGENT_TOOL_ACTIONS, AGENT_TOOL_IDS, AI_TOOLS, aiGatewayRequest } from "./ai-tool-catalog.js";
import { request as httpRequest } from "node:http";
import { reportLibrary, reportRun, reportRunWithRevisions, reportStatus, reportTasks } from "./ai-tool-results.fixtures.js";

const token = "a".repeat(43), digest = "b".repeat(64);
const build = { version: "test", commit: "abc1234", dirty: false, builtAt: "2026-10-20T00:00:00.000Z" };
const intent = { purposes: ["desktop_play"], editorRoot: "C:\\Program Files\\Unity\\Hub\\Editor", useMirrors: true };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
function envelope(request: DesktopGatewayRequestV1, value: unknown): DesktopGatewayResponseV1 {
  return { schemaVersion: 1, requestId: request.requestId, ok: true, value } as DesktopGatewayResponseV1;
}
async function setup(handler?: (request: DesktopGatewayRequestV1) => Promise<DesktopGatewayResponseV1>, now?: () => number) {
  const calls: DesktopGatewayRequestV1[] = [];
  const service = new AiToolsServer({ version: "test", build, port: 0, now, load: () => ({ enabled: false, token }), save: () => {},
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
  it("clears exact displayed requests, rejects waiting ones and keeps their AI receipts", async () => {
    const { service, client, calls } = await setup();
    await client.callTool({ name: "vua_request_play", arguments: { route: "desktop_play", action: "start" } });
    const first = service.snapshot().requests[0]!;
    const writes = () => calls.filter(call => call.method === "environment.startPlay");
    const displayedIds = [first.id];
    await client.callTool({ name: "vua_request_play", arguments: { route: "pico_pcvr", action: "start" } });
    const second = service.snapshot().requests[1]!;
    expect(service.clear(displayedIds).requests.map(request => request.id)).toEqual([second.id]);
    expect(writes()).toHaveLength(0);
    expect(data(await client.callTool({ name: "vua_action_status", arguments: { approvalId: first.id } })).data).toMatchObject({ id: first.id, state: "rejected" });
    await expect(service.resolve(first.id, "approve")).rejects.toThrow("approval_resolved_or_withdrawn");
    await service.resolve(second.id, "approve");
    expect(service.clear([second.id, "already-gone"]).requests).toEqual([]);
    expect(data(await client.callTool({ name: "vua_action_status", arguments: { approvalId: second.id } })).data).toMatchObject({ id: second.id, state: "accepted" });
    expect(writes()).toHaveLength(1);
    expect(service.clear(displayedIds).requests).toEqual([]);
  });
  it("keeps a cleared running dispatch alive and restores its hidden receipt after restart", async () => {
    let finish!: () => void, saved: unknown = [{ view: { id: "running-clear", tool: "vua_request_play", state: "pending" },
      request: { schemaVersion: 1, requestId: "test", method: "environment.startPlay", params: { route: "desktop_play", commandId: "clear-test" } } }];
    const dispatch = new Promise<void>(resolve => { finish = resolve; });
    const options = { version: "test", build, port: 0, load: () => ({ enabled: false, token }), save: () => {},
      loadRequests: () => saved, saveRequests: (approvals: readonly unknown[]) => { saved = structuredClone(approvals); },
      invoke: async (request: DesktopGatewayRequestV1) => { await dispatch; return envelope(request, { observed: "finished" }); } };
    const service = new AiToolsServer(options); cleanups.push(() => service.dispose());
    await service.setEnabled(true);
    const resolving = service.resolve("running-clear", "approve");
    expect(service.snapshot().requests[0]!.state).toBe("running");
    expect(service.clear(["running-clear"]).requests).toEqual([]);
    finish(); await resolving;
    expect(service.snapshot().requests).toEqual([]);
    expect(saved).toMatchObject([{ cleared: true, view: { state: "accepted", result: { observed: "finished" } } }]);
    const restarted = new AiToolsServer(options); cleanups.push(() => restarted.dispose());
    expect(restarted.snapshot().requests).toEqual([]);
  });
  it("requires local player approval before saving and closing Unity", async () => {
    const {client,calls,service}=await setup();
    await client.callTool({name:"vua_request_amf_close_editor",arguments:{runId:"n3-test"}});
    expect(calls.map(call=>call.method)).toEqual(["amf.production.get"]);
    const request=service.snapshot().requests[0]!;
    expect(request.state).toBe("pending");
    expect(request.details.parameters).toEqual({schemaVersion:"0.1",runId:"n3-test",confirmed:true});
    await service.resolve(request.id,"approve");
    expect(calls.at(-1)).toMatchObject({method:"amf.production.closeEditor",params:{schemaVersion:"0.1",runId:"n3-test",confirmed:true}});
    expect(errorFields(new Error("vua.amf_production.project_open"))).toMatchObject({suggestedAction:"amf.production.closeEditor",retryable:false});
    const editorClose={schemaVersion:"0.1",runId:"n3-test",closeId:"close-1",outcome:"saved",scenesSaved:true,assetsSaved:true,editorClosed:true,reason:"",detail:""};
    expect(runSummary({runId:"n3-test",editorClose})).toMatchObject({editorClose});
    expect(taskSummary({result:editorClose})).toMatchObject({result:{outcome:"saved",scenesSaved:true,assetsSaved:true,editorClosed:true}});
    expect(taskSummary({result:{schemaVersion:"0.1",runId:"n3-test",outcome:"already_closed",editorClosed:true}})).toMatchObject({result:{outcome:"already_closed",editorClosed:true}});
  });
  it("initializes, lists a closed tool catalog and calls independent reads", async () => {
    const { client, calls, service } = await setup();
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual(AI_TOOLS.map(tool => tool.name));
    expect(service.snapshot().connections).toBe(1);
    await client.callTool({ name: "vua_play_setups", arguments: {} });
    await client.callTool({ name: "vua_sop", arguments: { scenario: "pico_pcvr", connection: "wifi" } });
    await client.callTool({ name: "vua_sop", arguments: { selection: { platform: "vrchat", device: "quest", connection: "quest-link" } } });
    await client.callTool({ name: "vua_check_environment", arguments: { intent: { purposes: ["desktop_play"] } } });
    expect(calls.map(request => request.method)).toEqual(["environment.listPlaySetups", "environment.getScenarioSop", "environment.getScenarioSop", "environment.checkScenarioEnvironment"]);
    expect(calls[0]!.params).toEqual({ schemaVersion: "0.2" });
    expect(calls[1]!.params).toEqual({ schemaVersion: "0.1", scenario: { scenario: "pico_pcvr", connection: "wifi" } });
    expect(calls[2]!.params).toEqual({ schemaVersion: "0.2", selection: { platform: "vrchat", device: "quest", connection: "quest-link" } });
    expect(calls[3]!.params).toEqual({ schemaVersion: "0.1", intent });
    expect(service.snapshot().requests).toEqual([]);
  });
  it("exposes only the passive Unity license tool and dispatches no check or approval", async () => {
    const { client, calls, service } = await setup();
    const catalog = await client.listTools();
    const tool = catalog.tools.find(tool=>tool.name === "vua_unity_license");
    expect(tool?.description).toContain("Starts no program");
    expect(AI_TOOLS.some(tool=>tool.method === "environment.checkUnityLicense")).toBe(false);
    await client.callTool({name:"vua_unity_license",arguments:{}});
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({method:"environment.unityLicense",params:{schemaVersion:"0.1"}});
    expect(service.snapshot().requests).toEqual([]);
    expect((await client.callTool({name:"vua_unity_license",arguments:{editorPath:"C:/synthetic/Unity.exe"}})).isError).toBe(true);
    expect(calls).toHaveLength(1);
  });
  it.each(AGENT_TOOL_IDS)("observes %s and requires player approval for each Steam tool action", async toolId => {
    const toolConnection: ExternalToolSnapshot = { schemaVersion: "vua.external-tool/v0.4", toolId,
      capturedAt: "2026-10-29T00:00:00.000Z", presence: "installed", steamReady: true, buildId: "12345",
      running: false, canStop: false, activity: "idle", issue: null };
    const { client, calls, service } = await setup(async request => envelope(request, { toolConnection }));
    const status = await client.callTool({ name: "vua_tool_status", arguments: { toolId } });
    expect(status.isError).toBeFalsy();
    expect(data(status).data).toEqual({ toolConnection });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "tools.observeConnection", params: { toolId } });
    expect(service.snapshot().requests).toEqual([]);
    for (const action of AGENT_TOOL_ACTIONS) {
      const before = calls.length;
      const args = { toolId, action };
      const queued = await client.callTool({ name: "vua_request_tool", arguments: args });
      expect(queued.isError).toBeFalsy();
      const approval = service.snapshot().requests.find(request => request.state === "pending")!;
      expect(approval).toMatchObject({ tool: "vua_request_tool", state: "pending", details: { parameters: args } });
      expect(calls.slice(before)).toEqual([expect.objectContaining({ method: "tools.observeConnection", params: { toolId } })]);
      const duplicate = await client.callTool({ name: "vua_request_tool", arguments: args });
      expect(data(duplicate).data).toEqual(data(queued).data);
      expect(calls).toHaveLength(before + 1);
      const forged = await client.callTool({ name: "vua_request_tool", arguments: { ...args, decision: "approve" } });
      expect(forged.isError).toBe(true);
      expect(calls).toHaveLength(before + 1);
      await service.resolve(approval.id, "approve");
      expect(calls.slice(before + 1)).toEqual([expect.objectContaining({ method: "tools.actConnection",
        params: { ...args, commandId: expect.stringMatching(/^ai-/) } })]);
      expect(service.snapshot().requests.find(request => request.id === approval.id)).toMatchObject({ state: "accepted", result: { toolConnection } });
    }
  });
  it("rejects unknown Steam tool IDs in the MCP schema before observation or approval", async () => {
    const { client, calls, service } = await setup();
    const catalog = await client.listTools();
    for (const name of ["vua_tool_status", "vua_request_tool"]) {
      const tool = catalog.tools.find(tool => tool.name === name)!;
      expect(tool.inputSchema.properties?.toolId).toEqual({ enum: [...AGENT_TOOL_IDS] });
      for (const toolId of ["unknown", "liv", "vrcs", "vrchat", "steamvr"]) {
        const result = await client.callTool({ name, arguments: { toolId, ...(name === "vua_request_tool" ? { action: "start" } : {}) } });
        expect(result.isError).toBe(true);
        expect(data(result)).toHaveProperty("error", "unsupported_tool_or_parameters");
      }
    }
    const reinstall = await client.callTool({ name: "vua_request_tool", arguments: { toolId: "vrcft", action: "reinstall" } });
    expect(reinstall.isError).toBe(true);
    expect(data(reinstall)).toHaveProperty("error", "unsupported_tool_or_parameters");
    expect(calls).toEqual([]);
    expect(service.snapshot().requests).toEqual([]);
  });
  it("reads recorded VN3 terms and checks one use across products without fetching or queueing", async () => {
    const { client, calls, service } = await setup();
    await client.callTool({name:"vua_terms",arguments:{productId:"booth:6082686"}});
    await client.callTool({name:"vua_terms_check",arguments:{presetId:"vrchat_personal",productIds:["booth:6082686","booth:5813187"]}});
    expect(calls.map(call=>[call.method,call.params])).toEqual([
      ["terms.getProduct",{schemaVersion:"0.1",productId:"booth:6082686"}],
      ["terms.checkUse",{schemaVersion:"0.1",presetId:"vrchat_personal",productIds:["booth:6082686","booth:5813187"]}],
    ]);
    expect(AI_TOOLS.some(tool=>tool.method?.startsWith("terms.refresh"))).toBe(false);
    for (const args of [{productId:"6082686"},{productId:"booth:0"}]) expect((await client.callTool({name:"vua_terms",arguments:args})).isError).toBe(true);
    expect((await client.callTool({name:"vua_terms_check",arguments:{presetId:"anything",productIds:["booth:1"]}})).isError).toBe(true);
    expect((await client.callTool({name:"vua_terms_check",arguments:{presetId:"adult_content",productIds:[]}})).isError).toBe(true);
    expect(calls).toHaveLength(2);
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
    const options = { version: "test", build, port: 0, load: () => ({ enabled: false, token }), save: () => {},
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
  it("waits for approval before local testing without asking for upload rights", async () => {
    const { client, calls, service } = await setup();
    await client.callTool({ name: "vua_request_amf_local_test", arguments: { runId: "n3-test" } });
    const request = service.snapshot().requests[0]!;
    expect(request.state).toBe("pending");
    expect(calls.map(call => call.method)).toEqual(["amf.production.get"]);
    await service.resolve(request.id, "approve");
    expect(service.snapshot().requests[0]!.state).toBe("accepted");
    expect(calls.at(-1)).toMatchObject({ method: "amf.production.localTest", params: { schemaVersion: "0.1", runId: "n3-test" } });
    expect(calls.at(-1)!.params).toEqual({ schemaVersion: "0.1", runId: "n3-test" });
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
    expect(result.content).toEqual([expect.objectContaining({ type: "text" }), expect.objectContaining({ type: "resource_link", uri: "vua://amf/runs/n3-test" }), { type: "text", text: "Assembled Avatar, front view" }, { type: "image", data: "iVBORw0KGgoFRONT", mimeType: "image/png" }]);
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
      { name: "vua_sop", arguments: {} },
      { name: "vua_sop", arguments: { scenario: "desktop_play", selection: { platform: "vrchat", device: "pc", connection: null } } },
      { name: "vua_sop", arguments: { scenario: "desktop_play", connection: "wifi" } },
      { name: "vua_sop", arguments: { selection: { platform: "reborn", device: "pc", connection: null } } },
      { name: "vua_sop", arguments: { selection: { platform: "chilloutvr", device: "quest", connection: "standalone" } } },
      { name: "vua_check_environment", arguments: { intent: { purposes: ["desktop_play"], method: "anything" } } },
      { name: "vua_request_play", arguments: { route: "desktop", action: "start" } },
      { name: "vua_glb_inspect", arguments: {} },
      { name: "vua_glb_inspect", arguments: { productId: "booth:123", entryId: "entry-1" } },
    ]) expect((await client.callTool(request)).isError).toBe(true);
    expect(calls).toEqual([]);
    for (const spec of AI_TOOLS.filter(spec => spec.method && !spec.command && !["vua_task", "vua_material_files", "vua_glb_inspect", "vua_terms", "vua_terms_check", "vua_amf_run", "vua_recipe_materials", "vua_recipe_apply_plan", "vua_sop", "vua_check_environment", "vua_plan_installation", "vua_play_status", "vua_tool_status", "vua_installer_tool_status", "vua_diagnose_symptom", "vua_recipe", "vua_amf_face_tracking_plan", "vua_amf_texture_plan", "vua_amf_lighting_plan", "vua_amf_outfit_removal_plan", "vua_amf_plan", "vua_amf_release"].includes(spec.name))) {
      expect(() => aiGatewayRequest(spec, {}, "test")).not.toThrow();
    }
    const { client: compatClient, calls: compatCalls } = await setup();
    expect((await compatClient.callTool({ name: "vua_pose_graph", arguments: {} })).isError).toBeFalsy();
    expect((await compatClient.callTool({ name: "vua_glb_inspect", arguments: { productId: "booth:12345" } })).isError).toBeFalsy();
    expect((await compatClient.callTool({ name: "vua_terms_check", arguments: { presetId: "vrchat_personal", productIds: ["booth:12345"] } })).isError).toBeFalsy();
    expect(compatCalls.map(c => [c.method, c.params])).toEqual([
      ["environment.observePoseGraph", { schemaVersion: "0.1" }],
      ["library.inspectGlb", { schemaVersion: "0.1", productId: "booth:12345" }],
      ["terms.checkUse", { schemaVersion: "0.1", presetId: "vrchat_personal", productIds: ["booth:12345"] }],
    ]);
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

describe("vua_amf_plan without a selection", () => {
  it("returns the same Recipe checklist and differences and retains its mapped selection", async () => {
    const selection={avatarPrefab:"Assets/Avatar.prefab",outfits:[{sourceId:"coat",prefabPath:"Assets/Moved.prefab",mode:"merge_armature",bone:"",toggleName:"Coat",active:true}]};
    const materials=[{materialId:"material-2",status:"material_not_downloaded",boothProductId:"1001"}];
    const recipeDifferences=[{kind:"prefab_mapped",rule:"guid",before:"Assets/Old.prefab",after:"Assets/Moved.prefab"}];
    const {client,calls}=await setup(async request=>envelope(request,request.method==="amf.production.get"
      ? {recipeId:"recipe-test",selection,recipeMaterials:materials,recipeDifferences}
      : {materials,recipeDifferences,planDigest:digest}));
    const checklist=await client.callTool({name:"vua_recipe_materials",arguments:{recipeId:"recipe-test",materialChoices:{"material-2":"source-2"}}});
    expect(JSON.stringify(data(checklist))).toContain("material_not_downloaded");
    expect(calls.at(-1)).toMatchObject({method:"amf.production.recipeMaterialPlan",params:{materialChoices:{"material-2":"source-2"}}});
    const result=await client.callTool({name:"vua_amf_plan",arguments:{runId:"n3-test"}});
    expect(result.isError).toBeFalsy();
    expect(calls.at(-1)).toMatchObject({method:"amf.production.plan",params:{selection}});
    expect(JSON.stringify(data(result))).toContain("recipeDifferences");
    expect(calls.every(call=>!["amf.production.assemble","amf.production.prepareRecipe"].includes(call.method))).toBe(true);
  });
  const prefab = (sourceId: string, name: string, isAvatar: boolean) => ({ sourceId, path: `Assets/${sourceId}/${name}.prefab`, name, isAvatar,
    hasSkinnedMesh: !isAvatar, hasMergeArmature: !isAvatar, hasMissingScripts: false, humanoidBones: [] });
  const run = (avatars: readonly string[]) => ({ runId: "n3-test", prefabs: [...avatars.map(name => prefab("avatar", name, true)), prefab("outfit", "TshirtShorts_Meiyun", false)],
    sources: [{ sourceId: "avatar", role: "auto", itemName: "Meiyun_v2.1.0.zip" }, { sourceId: "outfit", role: "auto", itemName: "TshirtShorts_Meiyun_v1.00.zip" }] });
  it("plans VUA's stated recommendation and says why", async () => {
    const { client, calls } = await setup(async request => request.method === "amf.production.get"
      ? envelope(request, run(["Meiyu_改変 2P", "Meiyu_改変", "Meiyun"])) : envelope(request, { planDigest: "d".repeat(64) }));
    const result = await client.callTool({ name: "vua_amf_plan", arguments: { runId: "n3-test" } });
    expect(result.isError).toBeFalsy();
    const planned = calls.find(call => call.method === "amf.production.plan");
    expect(planned?.params).toMatchObject({ selection: { avatarPrefab: "Assets/avatar/Meiyu_改変.prefab", outfits: [{ prefabPath: "Assets/outfit/TshirtShorts_Meiyun.prefab", toggleName: "TshirtShorts" }] } });
    expect(JSON.stringify(data(result))).toContain("creator_base");
  });
  it("hands an equal tie back to the player without planning", async () => {
    const { client, calls } = await setup(async request => envelope(request, run(["Alpha", "Beta"])));
    const result = await client.callTool({ name: "vua_amf_plan", arguments: { runId: "n3-test" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(data(result))).toContain("recommendation_needs_player");
    expect(calls.some(call => call.method === "amf.production.plan")).toBe(false);
  });
});

describe("MCP result envelope", () => {
  const task = (taskId: string, state = "running", extra = {}) => ({ contractVersion: "0.1", taskId, revision: 1, correlationId: taskId, state,
    cancellationRequested: false, recoveryDisposition: "none", updatedAt: "2026-10-20T00:00:00.000Z", ...extra });
  it("reports the injected build identity", async () => {
    const { client } = await setup(async request => envelope(request, reportStatus));
    expect(data(await client.callTool({ name: "vua_status" })).data).toEqual({ ...reportStatus, build });
  });
  it("validates pagination and states before invoking, then filters, sorts and bounds the task list", async () => {
    const tasks = [task("old", "running", { updatedAt: "2026-10-19T00:00:00.000Z" }), task("new", "failed"), task("middle", "running", { updatedAt: "2026-10-19T23:00:00.000Z" })];
    const { client, calls } = await setup(async request => envelope(request, request.method === "task.list" ? { revision: 3, tasks } : { runs: [] }));
    for (const args of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { state: ["invented"] }, { state: "running" }, { state: ["running", "running"] }]) {
      const result = await client.callTool({ name: "vua_tasks", arguments: args });
      expect(result.isError).toBe(true);
      expect(data(result)).toMatchObject({ error: "unsupported_tool_or_parameters", mutationStarted: false, retryable: false });
    }
    expect(calls).toEqual([]);
    const result = data(await client.callTool({ name: "vua_tasks", arguments: { limit: 1, state: ["running"] } }));
    expect(result.data).toMatchObject({ total: 2, hasMore: true, tasks: [{ taskId: "middle", requestedBy: "vua" }] });
    expect(calls[0]).toMatchObject({ method: "task.list", params: {} });
    expect((data(await client.callTool({ name: "vua_tasks", arguments: { limit: 100, state: [] } })).data as { tasks: unknown[] }).tasks).toHaveLength(3);
  });
  it("advertises Resources, paginates existing runs and reads complete current facts with revisions", async () => {
    const full = { ...reportRun, revisions: [{ revision: 1, operation: "prepare", taskId: "earlier" }] };
    const release = { schemaVersion: "0.1", runId: full.runId, turntable: null, editorOpen: false, uploads: Array.from({ length: 10 }, (_, i) => ({ uploadId: `upload-${i}`, state: "failed", stage: "build", reason: "sdk_refused", detail: "Synthetic SDK explanation" })) };
    const { client, calls } = await setup(async request => envelope(request, request.method === "amf.production.list" ? { runs: Array.from({ length: 52 }, (_, i) => ({ runId: `n3-${i}` })) }
      : request.method === "amf.production.releaseState" ? release : full));
    expect(client.getServerCapabilities()?.resources).toBeDefined();
    expect((await client.listResourceTemplates()).resourceTemplates.map(template => template.uriTemplate)).toEqual(["vua://amf/runs/{runId}", "vua://amf/runs/{runId}/release"]);
    const page = await client.listResources({ cursor: "runs:0" });
    expect(page.resources).toHaveLength(100);
    expect(page.nextCursor).toBe("runs:50");
    expect((await client.listResources({ cursor: page.nextCursor })).resources).toHaveLength(4);
    const previous = calls.length;
    for (const uri of ["vua://amf/runs/../escape", "vua://amf/runs/with_under", "vua://amf/runs/%2e%2e", "vua://amf/runs/n3-test?token=value", `vua://amf/runs/${"a".repeat(101)}`, "https://example.invalid/run"]) {
      await expect(client.readResource({ uri })).rejects.toMatchObject({ code: -32602, data: { mutationStarted: false, retryable: false } });
    }
    await expect(client.listResources({ cursor: "invalid" })).rejects.toMatchObject({ code: -32602 });
    expect(calls).toHaveLength(previous);
    const resource = await client.readResource({ uri: "vua://amf/runs/n3-report" });
    expect(resource.contents[0]).toMatchObject({ mimeType: "application/json", text: JSON.stringify(full) });
    const summary = await client.callTool({ name: "vua_amf_run", arguments: { runId: full.runId } });
    expect(data(summary).data).toMatchObject({ revision: 7, revisions: full.revisions, prefabs: [{ path: full.prefabs[0]!.path, name: "Avatar0", isAvatar: true, humanoidBoneCount: 50 }, ...full.prefabs.slice(1).map(prefab => ({ path: prefab.path, name: prefab.name, isAvatar: prefab.isAvatar, humanoidBoneCount: 50 }))] });
    expect(JSON.stringify(data(summary))).not.toContain("humanoidBones");
    expect(summary.content).toContainEqual(expect.objectContaining({ type: "resource_link", uri: "vua://amf/runs/n3-report" }));
    const releaseTool = await client.callTool({ name: "vua_amf_release", arguments: { runId: full.runId } });
    expect(data(releaseTool).data).toMatchObject({ uploadCount: 10, uploads: release.uploads.slice(0, 3).map(({ detail: _detail, ...upload }) => upload) });
    expect(releaseTool.content).toContainEqual(expect.objectContaining({ type: "resource_link", uri: "vua://amf/runs/n3-report/release" }));
    expect((await client.readResource({ uri: "vua://amf/runs/n3-report/release" })).contents[0]).toHaveProperty("text", JSON.stringify(release));
    expect(calls.every(call => ["amf.production.list", "amf.production.get", "amf.production.releaseState", "amf.production.previewImage"].includes(call.method))).toBe(true);
  });
  it("keeps one image for products and local source matches, with an explicit full-image read", async () => {
    const library = { ...reportLibrary, items: [...reportLibrary.items, { kind: "local", entry: { entryId: "local" }, sourceMatch: { product: reportLibrary.items[0]!.product } }] };
    const { client, calls } = await setup(async request => envelope(request, library));
    const summary = data(await client.callTool({ name: "vua_library" })).data as typeof library;
    expect(summary.items[0]!.product!.imageUrls).toHaveLength(1);
    expect(summary.items.at(-1)!.sourceMatch!.product.imageUrls).toHaveLength(1);
    expect(data(await client.callTool({ name: "vua_library", arguments: { includeImages: true } })).data).toEqual(library);
    expect(calls.every(call => !("includeImages" in call.params))).toBe(true);
    expect(calls[0]!.params).toEqual({ schemaVersion: "0.3", limit: 25 });
    expect(reportLibrary.items[0]!.product.imageUrls).toHaveLength(28);
  });
  it("uses a conservative retry table and bounded, sanitized Gateway explanations in every error", async () => {
    let code = "vua.amf_production.busy";
    const detail = 'Wait for this line. password="synthetic-password" https://user:pass@example.invalid/?token=secret "C:\\Users\\Synthetic Player\\project" token=secret-value';
    const { client } = await setup(async request => ({ schemaVersion: 1, requestId: request.requestId, ok: false, error: { code: "application", application: {
      contractVersion: "0.1", code, category: "validation", messageKey: "errors.amfProduction.failed", params: { detail }, recoverable: true, retryable: true, correlationId: request.requestId,
    } } }));
    const failure = data(await client.callTool({ name: "vua_amf_run", arguments: { runId: "n3-test" } }));
    expect(failure).toMatchObject({ error: code, mutationStarted: false, retryable: true, message: expect.stringContaining("Wait for this line."), nextAction: expect.any(String) });
    expect(JSON.stringify(failure)).not.toMatch(/synthetic-password|secret-value|user:pass|Synthetic Player/u);
    code = "vua.unknown.future";
    expect(data(await client.callTool({ name: "vua_status" }))).toMatchObject({ error: code, retryable: false });
    await expect(client.readResource({ uri: "vua://amf/runs/n3-test" })).rejects.toMatchObject({ data: { error: code, mutationStarted: false, retryable: false } });
    const { client: disabledClient } = await setup(async request => ({ schemaVersion: 1, requestId: request.requestId, ok: false, error: { code: "application", application: {
      contractVersion: "0.1", code: "vua.amf.unavailable", category: "unavailable", messageKey: "errors.amf.unavailable", recoverable: true, retryable: false, correlationId: request.requestId,
    } } }));
    expect(data(await disabledClient.callTool({ name: "vua_amf_materials" }))).toMatchObject({
      error: "vua.amf.unavailable",
      retryable: false,
      nextAction: expect.stringContaining("Settings → Modules"),
    });
    expect([...safeErrorMessage("x".repeat(800))]).toHaveLength(512);
    for (const message of ["Failed at /home/synthetic/private/project", "Failed at \\\\host\\share\\private", `Pairing ${token}`]) expect(safeErrorMessage(message, [token])).not.toMatch(/private|home|host|a{43}/u);
    expect(safeErrorMessage('Failed: {"password":"synthetic-password","access_token":"synthetic-token"}')).not.toMatch(/synthetic-password|synthetic-token/u);
    for (const [error, retryable] of Object.entries(MCP_RETRYABLE_CODES)) {
      expect(errorFields(new Error(error))).toMatchObject({ error, retryable, mutationStarted: false, message: expect.any(String), nextAction: expect.any(String) });
    }
    expect(errorFields(new Error("constructor"))).toMatchObject({ error: "constructor", retryable: false, mutationStarted: false, message: expect.any(String), nextAction: expect.any(String) });
  });
  it("returns the full error envelope for oversized results and unexpected Gateway exceptions", async () => {
    let thrown = false;
    const { client } = await setup(async request => { if (thrown) throw new Error("private stack C:/private token=secret"); return envelope(request, { padding: "x".repeat(257 * 1024) }); });
    const large = await client.callTool({ name: "vua_status" });
    expect(large.isError).toBe(true);
    expect(data(large)).toMatchObject({ error: "result_too_large", mutationStarted: false, retryable: false, message: expect.any(String), nextAction: expect.any(String) });
    thrown = true;
    expect(data(await client.callTool({ name: "vua_status" }))).toMatchObject({ error: "gateway_unavailable", retryable: true, mutationStarted: false });
  });
  it("shares the four-read bound with Resources and returns retry metadata when contended", async () => {
    let entered = 0, ready!: () => void, release!: () => void;
    const allEntered = new Promise<void>(resolve => { ready = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { client } = await setup(async request => { if (++entered === 4) ready(); await gate; return envelope(request, {}); });
    const reads = Array.from({ length: 4 }, () => client.callTool({ name: "vua_status" }));
    try {
      await allEntered;
      expect(data(await client.callTool({ name: "vua_tasks" }))).toMatchObject({ error: "too_many_requests", message: expect.any(String), nextAction: expect.any(String), retryable: true, mutationStarted: false });
      await expect(client.readResource({ uri: "vua://amf/runs/n3-test" })).rejects.toMatchObject({ data: { error: "too_many_requests", retryable: true, mutationStarted: false } });
    } finally { release(); await Promise.all(reads); }
  });
  it("derives AMF changes only from matching task/run witnesses and keeps missing evidence unknown", async () => {
    const queue = task("queued", "queued"), success = task("succeeded", "succeeded", { result: { operation: "amf.production", runId: "n3-ok" } });
    const failed = task("failed", "failed", { error: { code: "vua.amf_production.assembly_failed" } });
    const runs = [{ runId: "n3-ok", taskId: success.taskId, recovery: null, steps: [{ key: "reinspect", state: "succeeded" }] },
      { runId: "n3-failed", taskId: failed.taskId, recovery: "restored", steps: [{ key: "assembly", state: "failed" }] }];
    const { client } = await setup(async request => envelope(request, request.method === "task.list" ? { tasks: [queue, success, failed] }
      : request.method === "task.get" ? failed : request.method === "amf.production.list" ? { runs, queue: [{ taskId: queue.taskId, runId: "n3-ok" }], running: [] }
      : runs.find(run => request.method === "amf.production.get" && run.runId === request.params.runId)));
    const tasks = (data(await client.callTool({ name: "vua_tasks" })).data as { tasks: Record<string, unknown>[] }).tasks;
    expect(tasks.find(row => row.taskId === "queued")!.change).toMatchObject({ started: false, committed: false, checked: null, recovery: null, retrySafe: false });
    expect(tasks.find(row => row.taskId === "succeeded")!.change).toEqual({ started: true, committed: true, checked: true, recovery: "none", retrySafe: false });
    expect(data(await client.callTool({ name: "vua_task", arguments: { taskId: "failed" } })).data).toMatchObject({ requestedBy: "vua", change: { started: true, committed: false, checked: null, recovery: "restored", retrySafe: true } });
    expect(taskChange(failed, null)).toEqual({ started: null, committed: false, checked: null, recovery: null, retrySafe: null });
    expect(taskChange(failed, { taskId: "later-task", recovery: "restored", steps: [{ key: "inspect", state: "succeeded" }] })).toMatchObject({ started: null, recovery: null, retrySafe: null });
    expect(taskChange(failed, { taskId: "failed", recovery: "restore_failed: io_error", steps: [] })).toMatchObject({ started: true, recovery: "restore_failed", retrySafe: false });
    expect(taskChange(failed, null, true)).toMatchObject({ started: false, retrySafe: true });
    expect(taskChange(task("ok", "succeeded_with_warnings"), { taskId: "ok", recovery: null, steps: [{ key: "upload", state: "succeeded" }] })).toMatchObject({ committed: true, checked: false });
    expect(taskChange(task("cancelled", "cancelled"), null)).toMatchObject({ started: null, committed: false, checked: null, recovery: null, retrySafe: false });
    expect(taskChange(task("future", "future_state"), null)).toEqual({ started: null, committed: null, checked: null, recovery: null, retrySafe: null });
    for (const state of ["preparing", "running", "waiting_for_input", "paused"]) expect(taskChange(task("active", state), null)).toMatchObject({ started: true, committed: false, checked: null, recovery: null });
  });
  it("labels only player-approved dispatched tasks as ai_request, and never relabels a cancellation target", async () => {
    const actual = task("test-installation", "queued");
    const { client, service } = await setup(async request => envelope(request, request.method === "environment.planDeployment" ? { deploymentPlan: { digest } }
      : request.method === "environment.executeDeployment" ? { taskId: actual.taskId } : request.method === "task.requestCancellation" ? { taskId: "vua-task", outcome: "requested" }
      : request.method === "task.get" ? task(request.params.taskId) : request.method === "task.list" ? { tasks: [actual, task("vua-task")] } : { runs: [] }));
    await client.callTool({ name: "vua_request_installation", arguments: { intent: { purposes: ["desktop_play"] }, confirmedDigest: digest } });
    const approval = service.snapshot().requests[0]!;
    expect(data(await client.callTool({ name: "vua_task", arguments: { taskId: actual.taskId } })).data).toMatchObject({ requestedBy: "vua" });
    await service.resolve(approval.id, "approve");
    expect(data(await client.callTool({ name: "vua_task", arguments: { taskId: actual.taskId } })).data).toMatchObject({ requestedBy: "ai_request" });
    await client.callTool({ name: "vua_request_cancel_task", arguments: { taskId: "vua-task", observedRevision: 1 } });
    await service.resolve(service.snapshot().requests.at(-1)!.id, "approve");
    expect(data(await client.callTool({ name: "vua_task", arguments: { taskId: "vua-task" } })).data).toMatchObject({ requestedBy: "vua" });
    expect((data(await client.callTool({ name: "vua_tasks" })).data as { tasks: unknown[] }).tasks).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: actual.taskId, requestedBy: "ai_request" }), expect.objectContaining({ taskId: "vua-task", requestedBy: "vua" })]));
  });
  it("recognizes a player's completed Editor handoff receipt without borrowing the earlier run's checks", async () => {
    const handoff = task("player-open", "succeeded", { result: { schemaVersion: "0.1", runId: "n3-open", avatarSelected: true, sdkPanelRequested: true } });
    const { client } = await setup(async request => envelope(request, request.method === "task.get" ? handoff : request.method === "task.list" ? { tasks: [handoff] }
      : request.method === "amf.production.list" ? { runs: [{ runId: "n3-open" }] }
      : { runId: "n3-open", taskId: "earlier-inspection", recovery: "restored", steps: [{ key: "inspect", state: "succeeded" }] }));
    const expected = { requestedBy: "vua", change: { started: true, committed: true, checked: null, recovery: null, retrySafe: false } };
    expect(data(await client.callTool({ name: "vua_task", arguments: { taskId: handoff.taskId } })).data).toMatchObject(expected);
    expect(data(await client.callTool({ name: "vua_tasks" })).data).toMatchObject({ tasks: [expected] });
  });
  it("keeps report-shaped default text reads under 10,000 UTF-8 bytes", async () => {
    const { client } = await setup(async request => envelope(request, request.method === "amf.production.previewImage" ? { mediaType: "image/png", data: "iVBORw0KGgoSYNTHETIC" }
      : request.method === "app.snapshot" ? reportStatus : request.method === "task.list" ? reportTasks
      : request.method === "library.list" ? reportLibrary : request.method === "amf.production.list" ? { runs: [{ runId: reportRun.runId }] } : reportRunWithRevisions));
    const sizes: Record<string, { before: number; after: number }> = {};
    for (const [name, args, raw] of [["vua_status", {}, reportStatus], ["vua_tasks", {}, reportTasks], ["vua_amf_run", { runId: reportRun.runId }, reportRunWithRevisions], ["vua_library", {}, reportLibrary]] as const) {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError).toBeFalsy();
      const after = (response.content ?? []).reduce((sum, part) => sum + (part.type === "text" ? Buffer.byteLength(part.text) : 0), 0);
      const spec = AI_TOOLS.find(tool => tool.name === name)!;
      const labels = (response.content ?? []).slice(1).reduce((sum, part) => sum + (part.type === "text" ? Buffer.byteLength(part.text) : 0), 0);
      const before = labels + Buffer.byteLength(JSON.stringify({ whatHappened: "The requested facts or plan were read. No change was made.",
        nextAction: name === "vua_tasks" ? "Inspect a relevant task using vua_task." : spec.next,
        expectedResult: name === "vua_tasks" ? "Actual task states and recovery facts." : name === "vua_status" ? "Actual capability availability." : spec.expected, data: raw }));
      sizes[name] = { before, after };
      expect(after, name).toBeLessThan(10_000);
      if (name === "vua_tasks") expect(data(response).data).toMatchObject({ total: 80, hasMore: true, tasks: expect.arrayContaining([expect.objectContaining({ taskId: "report-task-079" })]) });
      if (name === "vua_amf_run") expect(response.content?.filter(part => part.type === "image")).toHaveLength(12);
    }
    console.info("Synthetic MCP text bytes", JSON.stringify(sizes));
  });
});

describe("run summary", () => {
  it("names the newest revisions and counts the rest, which stay in the run Resource", () => {
    const revisions = Array.from({ length: 50 }, (_, index) => ({ id: `rev-${50 - index}`, before: "assembly", takenAt: "2026-10-20T00:00:00Z", editedInUnity: false,
      summary: { avatar: "Meiyun", outfits: ["T-shirt", "Shorts"], sources: ["Meiyun_v2.1.0", "Amenbo T-shirt & Shorts"], lightingMaterials: 12, sdkFixes: [] } }));
    const summary = runSummary({ runId: "n3-a", phase: "succeeded", revisions }) as Record<string, unknown>;
    expect(summary.revisionCount).toBe(50);
    expect(summary.revisions).toEqual(revisions.slice(0, 5));
    expect("revisions" in (runSummary({ runId: "n3-a", phase: "ready" }) as Record<string, unknown>)).toBe(false);
  });

  it("exposes local diagnostics, official-installer tools, Recipes, face-tracking plans, and library v0.3 filters", async () => {
    const { client, calls, service } = await setup(async request => {
      if (request.method === "environment.planDeployment") return envelope(request, { deploymentPlan: { digest } });
      if (request.method === "diagnostics.observeLocal") return envelope(request, { localDiagnostics: { clientRunning: false, osc: { avatarConfigCount: 2 } } });
      if (request.method === "diagnostics.diagnoseSymptom") return envelope(request, { symptomDiagnosis: { symptom: request.params.symptom, sopSteps: [{ stepId: "osc_enable_radial_menu" }] } });
      if (request.method === "tools.observeInstaller") return envelope(request, { installerTool: { toolId: request.params.toolId, presence: "installed", running: false } });
      if (request.method === "amf.production.listRecipes") return envelope(request, { recipes: [{ recipeId: "recipe-1", title: "Winter" }] });
      if (request.method === "amf.production.getRecipe") return envelope(request, { recipe: { recipeId: request.params.recipeId, title: "Winter" } });
      if (request.method === "amf.production.faceTrackingPlan") return envelope(request, { planDigest: digest, parameterBudget: { state: "fits", usedBits: 120, limitBits: 256 } });
      return envelope(request, { ok: true });
    });

    expect((await client.callTool({ name: "vua_local_diagnostics", arguments: {} })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_diagnose_symptom", arguments: { symptom: "osc_or_face_tracking_not_responding" } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_installer_tool_status", arguments: { toolId: "slimevr" } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_plan_installation", arguments: { intent: { tools: ["slimevr", "vrcx"] } } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_recipes", arguments: {} })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_recipe", arguments: { recipeId: "recipe-1" } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_amf_face_tracking_plan", arguments: { runId: "n3-test", menuId: digest } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_library", arguments: { sort: "added_desc", vn3: { state: "readable", items: ["C", "I"] } } })).isError).toBeFalsy();
    expect(calls.find(c => c.method === "library.list")?.params).toEqual({
      schemaVersion: "0.3",
      limit: 25,
      sort: "added_desc",
      vn3: { state: "readable", items: ["C", "I"] },
    });

    // Approval-gated installer tool launch, manager launch and OSC cache clear review current facts first.
    const instReq = await client.callTool({ name: "vua_request_installer_tool", arguments: { toolId: "vrcx", action: "start" } });
    expect(instReq.isError).toBeFalsy();
    const oscReq = await client.callTool({ name: "vua_request_clear_osc_cache", arguments: {} });
    expect(oscReq.isError).toBeFalsy();
    expect(service.snapshot().requests.map(r => r.tool)).toEqual(["vua_request_installer_tool", "vua_request_clear_osc_cache"]);
  });

  it("exposes sanitized manager-app presence and approval-gated breakaway launch without leaking local paths", async () => {
    const rawManagers = {
      managerApps: {
        schemaVersion: "vua.manager-apps/v0.1",
        capturedAt: "2026-11-14T00:00:00Z",
        apps: [
          { component: "unity_hub", presence: "found", path: "C:\\Program Files\\Unity Hub\\Unity Hub.exe" },
          { component: "vcc", presence: "not_found", path: null },
          { component: "alcom", presence: "found", path: "C:\\Users\\Alice\\AppData\\Local\\ALCOM\\ALCOM.exe" },
        ],
      },
    };
    const { client, calls, service } = await setup(async request => {
      if (request.method === "environment.inspectManagerApps") return envelope(request, rawManagers);
      if (request.method === "environment.openManagerApp") {
        return envelope(request, {
          managerAppLaunch: {
            schemaVersion: "vua.manager-apps/v0.2",
            managerId: request.params.managerId,
            launchedAt: "2026-11-14T00:00:01Z",
          },
        });
      }
      return envelope(request, { ok: true });
    });

    const observed = await client.callTool({ name: "vua_manager_apps", arguments: {} });
    expect(observed.isError).toBeFalsy();
    expect(JSON.stringify(observed)).not.toContain("Alice");
    expect(data(observed).data).toEqual({
      managerApps: {
        schemaVersion: "vua.manager-apps/v0.1",
        capturedAt: "2026-11-14T00:00:00Z",
        apps: [
          { component: "unity_hub", presence: "found" },
          { component: "vcc", presence: "not_found" },
          { component: "alcom", presence: "found" },
        ],
      },
    });

    const queued = await client.callTool({ name: "vua_request_open_manager", arguments: { managerId: "alcom" } });
    expect(queued.isError).toBeFalsy();
    expect(JSON.stringify(queued)).not.toContain("Alice");
    const pending = service.snapshot().requests[0]!;
    expect(pending.tool).toBe("vua_request_open_manager");
    await service.resolve(pending.id, "approve");
    expect(calls.find(c => c.method === "environment.openManagerApp")?.params).toMatchObject({
      managerId: "alcom",
      commandId: expect.stringMatching(/^ai-/),
    });
  });

  it("exposes tool catalog filtering, enriched library filters, grouped migration intake, client config update, and AMF texture/lighting/outfit-removal plans and guarded approvals", async () => {
    let currentDigest = digest;
    const { client, calls, service } = await setup(async request => {
      if (request.method === "diagnostics.observeLocal") return envelope(request, { localDiagnostics: { clientRunning: false } });
      if (request.method === "diagnostics.updateClientConfig") return envelope(request, { clientConfigReceipt: { backupWritten: true, cacheSizeGb: 30, cacheExpiryDelayDays: 60 } });
      if (request.method === "library.importGroups") return envelope(request, { schemaVersion: "0.1", operation: "library.importGroups", taskId: "migration-1", correlationId: "corr-1" });
      if (request.method === "amf.production.planTextureMemory") return envelope(request, { schemaVersion: "0.1", runId: request.params.runId, planDigest: currentDigest, plan: { platform: request.params.platform, targetRank: request.params.targetRank } });
      if (request.method === "amf.production.applyTextureMemory") return envelope(request, { operation: "amf.production", runId: request.params.runId, taskId: "tex-task" });
      if (request.method === "amf.production.planLighting") return envelope(request, { schemaVersion: "0.1", runId: request.params.runId, planDigest: currentDigest });
      if (request.method === "amf.production.applyLighting") return envelope(request, { operation: "amf.production", runId: request.params.runId, taskId: "light-task" });
      if (request.method === "amf.production.planOutfitRemoval") return envelope(request, { schemaVersion: "0.1", runId: request.params.runId, planDigest: currentDigest });
      if (request.method === "amf.production.removeOutfit") return envelope(request, { operation: "amf.production", runId: request.params.runId, taskId: "remove-task" });
      return envelope(request, { items: [], total: 0 });
    });

    // 1. Static companion-tool catalog filter (no Gateway IPC call).
    const freeTracking = data(await client.callTool({ name: "vua_tool_catalog", arguments: { goal: "tracking", freeOnly: true } }));
    expect((freeTracking.data as { tools: { id: string }[] }).tools.map(t => t.id)).toEqual(["vrcft", "space", "slimevr"]);
    expect(calls).toHaveLength(0);

    // 2. Enriched library filters (source: "local", availabilityStatus, sourceCategory: null, descriptionLinksTo).
    expect((await client.callTool({
      name: "vua_library",
      arguments: {
        source: "local",
        availabilityStatus: "available",
        sourceCategory: null,
        descriptionLinksTo: "booth:6082686",
      },
    })).isError).toBeFalsy();
    expect(calls.at(-1)?.params).toEqual({
      schemaVersion: "0.3",
      limit: 25,
      source: "local",
      availabilityStatus: "available",
      sourceCategory: null,
      descriptionLinksTo: "booth:6082686",
    });

    // 3. Plan reads and digest-guarded approvals for texture memory, lighting, and outfit removal.
    expect((await client.callTool({ name: "vua_amf_texture_plan", arguments: { runId: "n3-test", platform: "android", targetRank: "good" } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_amf_lighting_plan", arguments: { runId: "n3-test" } })).isError).toBeFalsy();
    expect((await client.callTool({ name: "vua_amf_outfit_removal_plan", arguments: { runId: "n3-test", sourceId: "coat-1" } })).isError).toBeFalsy();

    // Digest drift fails closed before queueing approval.
    currentDigest = "e".repeat(64);
    const staleTex = await client.callTool({
      name: "vua_request_amf_texture_apply",
      arguments: { runId: "n3-test", platform: "android", targetRank: "good", planDigest: digest, textures: ["Assets/Outfit/MainTex.png"] },
    });
    expect(staleTex.isError).toBe(true);
    expect(data(staleTex)).toMatchObject({ error: "texture_plan_changed", retryable: false });

    currentDigest = digest;
    expect((await client.callTool({
      name: "vua_request_amf_texture_apply",
      arguments: { runId: "n3-test", platform: "android", targetRank: "good", planDigest: digest, textures: ["Assets/Outfit/MainTex.png"] },
    })).isError).toBeFalsy();
    expect((await client.callTool({
      name: "vua_request_amf_lighting_apply",
      arguments: { runId: "n3-test", planDigest: digest, materials: ["Assets/Outfit/Coat.mat"] },
    })).isError).toBeFalsy();
    expect((await client.callTool({
      name: "vua_request_amf_outfit_remove",
      arguments: { runId: "n3-test", sourceId: "coat-1", planDigest: digest },
    })).isError).toBeFalsy();

    // Resolve the three AMF approvals so the four-pending bound has room for the remaining two.
    for (const req of service.snapshot().requests) {
      await service.resolve(req.id, "approve");
    }
    expect(calls.filter(c => ["amf.production.applyTextureMemory", "amf.production.applyLighting", "amf.production.removeOutfit"].includes(c.method)).map(c => c.method)).toEqual([
      "amf.production.applyTextureMemory",
      "amf.production.applyLighting",
      "amf.production.removeOutfit",
    ]);

    // 4. Client config update + grouped library migration intake require local player approval.
    expect((await client.callTool({ name: "vua_request_update_client_config", arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: "vua_request_update_client_config", arguments: { cacheSizeGb: 30, cacheExpiryDelayDays: 60 } })).isError).toBeFalsy();
    expect((await client.callTool({
      name: "vua_request_library_import_groups",
      arguments: {
        groups: [{
          name: "Meiyun_Winter_Coat",
          root: "D:/Downloads/Materials",
          files: [{ path: "Meiyun_Coat.unitypackage", bytes: 4096, modifiedMs: 1700000000000 }],
        }],
        autoGenerate: false,
      },
    })).isError).toBeFalsy();

    for (const req of service.snapshot().requests.filter(r => r.state === "pending")) {
      await service.resolve(req.id, "approve");
    }
    expect(calls.find(c => c.method === "diagnostics.updateClientConfig")?.params).toMatchObject({
      schemaVersion: "0.1",
      cacheSizeGb: 30,
      cacheExpiryDelayDays: 60,
      commandId: expect.stringMatching(/^ai-/),
    });
    expect(calls.find(c => c.method === "library.importGroups")?.params).toMatchObject({
      schemaVersion: "0.1",
      autoGenerate: false,
      commandId: expect.stringMatching(/^ai-/),
    });

    // 5. MCP prompts capability + format-filtered vua_library + standalone JSON config snippet.
    expect(client.getServerCapabilities()?.prompts).toBeDefined();
    const listedPrompts = await client.listPrompts();
    expect(listedPrompts.prompts.map(p => p.name)).toEqual([
      "vua-play-setup",
      "vua-diagnose-symptom",
      "vua-amf-assembly",
      "vua-release-check",
    ]);
    const diagPrompt = await client.getPrompt({ name: "vua-diagnose-symptom", arguments: { symptom: "streaming_blurry_or_compression" } });
    expect(diagPrompt.messages[0]?.content).toMatchObject({ type: "text", text: expect.stringContaining("streaming_blurry_or_compression") });
    const releasePrompt = await client.getPrompt({ name: "vua-release-check", arguments: { runId: "n3-test-run", targetPlatform: "vrchat_quest" } });
    expect(releasePrompt.messages[0]?.content).toMatchObject({ type: "text", text: expect.stringContaining("vrchat_quest") });
    await expect(client.getPrompt({ name: "vua-diagnose-symptom", arguments: { symptom: "not_a_symptom" } })).rejects.toMatchObject({ code: -32602 });
    await expect(client.getPrompt({ name: "vua-release-check", arguments: { runId: "../escape" } })).rejects.toMatchObject({ code: -32602 });
    await expect(client.getPrompt({ name: "vua-unknown" })).rejects.toMatchObject({ code: -32602 });

    expect((await client.callTool({ name: "vua_library", arguments: { format: "vrm_or_glb" } })).isError).toBeFalsy();
    expect(calls.findLast(c => c.method === "library.list")?.params).toMatchObject({ schemaVersion: "0.3", format: "vrm_or_glb", limit: 25 });
    expect((await client.callTool({ name: "vua_library", arguments: { format: "fbx" } })).isError).toBe(true);

    const parsedConfig = JSON.parse(service.configJson()) as { mcpServers: { vua: { type: string; url: string; headers: { Authorization: string } } } };
    expect(parsedConfig.mcpServers.vua.type).toBe("http");
    expect(parsedConfig.mcpServers.vua.url).toBe(service.snapshot().endpoint);
    expect(parsedConfig.mcpServers.vua.headers.Authorization).toMatch(/^Bearer /);
  });
});

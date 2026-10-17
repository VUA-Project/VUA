// Official MCP HTTP client -> real Gateway -> real isolated host Provider.
// Read-only software observations. Never launches Unity or any installer.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const require = createRequire(import.meta.url);
const { AiToolsServer } = require("../dist/electron/ai-tools-server.js");
const { ModuleProvider } = require("../dist/electron/module-provider.js");
const { createDesktopOrchestratorProvider } = require("../dist/electron/provider-bootstrap.js");
const { routeDesktopGatewayInvoke } = require("../dist/electron/gateway-router.js");
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const evidence = path.join(workspace, "docs/plans/_agent-local", `native-${Date.now()}`);
await mkdir(evidence, { recursive: true });
const host = createDesktopOrchestratorProvider({ role: "host", executablePath: path.join(workspace, "target/release/vua-orchestrator-provider.exe"), databasePath: path.join(evidence, "host-tasks.db"),
  profileRoots: { home: process.env.USERPROFILE, localAppData: process.env.LOCALAPPDATA, appData: process.env.APPDATA } });
let activated = false;
const provider = new ModuleProvider({ host, enabled: false, persist: () => {}, createAmf: () => { activated = true; throw new Error("AMF must remain absent"); } });
const token = randomBytes(32).toString("base64url");
const mcp = new AiToolsServer({ version: "0.6.7-local", port: 0, load: () => ({ enabled: false, token }), save: () => {},
  invoke: request => routeDesktopGatewayInvoke({ provider, productVersion: "0.6.7-local", platform: "win32", rendererUrl: "http://127.0.0.1/internal-test",
    resolveMaterialSource: () => undefined }, "http://127.0.0.1/internal-test", request) });
let client, transport;
const checks = [], observations = [];
function assert(value, message) { if (!value) throw new Error(message); checks.push(message); }
async function tool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`Unexpected tool failure: ${name}`);
  return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === "text").text);
}
try {
  await provider.start(); await mcp.setEnabled(true);
  transport = new StreamableHTTPClientTransport(new URL(mcp.snapshot().endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  client = new Client({ name: "VUA read-only acceptance", version: "1" }); await client.connect(transport);
  const sop = (await tool("vua_sop", { scenario: "pico_pcvr", connection: "usb" })).data;
  assert(sop.performed === "sop_only" && sop.connection === "usb", "Actual host serves the independent PICO USB SOP");
  for (const purpose of ["desktop_play", "pc_avatar"]) {
    const result = (await tool("vua_check_environment", { intent: { purposes: [purpose] } })).data;
    assert(result.performed === "software_check_only" && result.installationStarted === false && result.licenseState === "not_checked", `${purpose} observes files without installation or a license claim`);
    observations.push(result);
  }
  const tasks = (await tool("vua_tasks", {})).data;
  assert(tasks.tasks.length === 0, "Read-only calls create no tasks");
  const disabled = await client.callTool({ name: "vua_amf_materials", arguments: {} });
  assert(disabled.isError && !activated, "AMF remains disabled; tool access never activates it");
  assert(mcp.snapshot().requests.length === 0, "Reads create no pending changes");
  await writeFile(path.join(evidence, "result.json"), JSON.stringify({ timestamp: new Date().toISOString(), scope: "Official MCP client and real host; local software observations only", checks, observations }, null, 2));
  console.log(JSON.stringify({ scope: "Official MCP HTTP client -> actual host, read-only", passed: checks.length, checks }));
} finally {
  await transport?.terminateSession().catch(() => {}); await client?.close().catch(() => {}); await mcp.dispose();
  await provider.prepareShutdown({ timeoutMs: 3000 });
}

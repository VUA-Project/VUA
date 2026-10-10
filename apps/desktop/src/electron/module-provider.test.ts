import { describe, expect, it } from "vitest";
import type { ApplicationRequestV01, ApplicationResponseV01, AmfModuleSnapshotV01, TaskSnapshotV01 } from "@vua/contracts";
import { MockOrchestratorProviderV01, type OrchestratorProviderV01, type ProviderStatusV01 } from "@vua/orchestrator-provider";
import { ModuleProvider } from "./module-provider.js";

const query = (method: "task.list" | "application.getSnapshot"): ApplicationRequestV01 => ({ contractVersion: "0.1", requestId: method, correlationId: method, kind: "query", method, params: {} });
const task = (id: string, state: TaskSnapshotV01["state"] = "succeeded"): TaskSnapshotV01 => ({ contractVersion: "0.1", taskId: id, state, revision: 1, correlationId: id, cancellationRequested: false, recoveryDisposition: "none", updatedAt: "2026-10-09T00:00:00Z" });

class Port extends MockOrchestratorProviderV01 {
  calls: ApplicationRequestV01[] = [];
  tasks: TaskSnapshotV01[] = [];
  failed = false;
  shutdownCalls = 0;
  lifecycleListeners = new Set<(status: ProviderStatusV01) => void>();
  override status(): ProviderStatusV01 { return this.failed ? { contractVersion: "0.1", state: "failed", acceptingCalls: false } : super.status(); }
  override async invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
    this.calls.push(request);
    if (request.method === "task.list") return { contractVersion: "0.1", requestId: request.requestId, ok: true, value: { contractVersion: "0.1", revision: 2, tasks: this.tasks } };
    if (request.method === "task.get") {
      const found = this.tasks.find(task => task.taskId === request.params.taskId);
      if (found) return { contractVersion: "0.1", requestId: request.requestId, ok: true, value: found };
    }
    return super.invoke(request);
  }
  override async prepareShutdown(request: { timeoutMs: number }) { this.shutdownCalls += 1; return super.prepareShutdown(request); }
  subscribeStatus(listener: (status: ProviderStatusV01) => void) { this.lifecycleListeners.add(listener); return () => this.lifecycleListeners.delete(listener); }
  crash() { this.failed = true; for (const listener of this.lifecycleListeners) listener(this.status()); }
}

function setup(options: { enabled?: boolean; factory?: () => OrchestratorProviderV01; shellBusy?: () => boolean } = {}) {
  const host = new Port({ capabilities: [
    { operationId: "environment.getSnapshot", availability: "available" },
    { operationId: "production.recipes", availability: "unavailable" },
  ] });
  const amf = new Port({ capabilities: [
    { operationId: "production.recipes", availability: "available" },
    { operationId: "environment.getSnapshot", availability: "unavailable" },
  ] });
  const saved: boolean[] = [];
  let activations = 0;
  const provider = new ModuleProvider({ host, enabled: options.enabled ?? false,
    createAmf: () => { activations += 1; return options.factory?.() ?? amf; },
    persist: enabled => saved.push(enabled), ...(options.shellBusy ? { shellBusy: options.shellBusy } : {}) });
  return { host, amf, provider, saved, activations: () => activations };
}

describe("host / optional AMF process boundary", () => {
  it("keeps VRCFT queries and actions on the host while AMF is disabled", async () => {
    const { provider, host, amf, activations } = setup(); await provider.start();
    await provider.invoke({ contractVersion: "0.1", requestId: "tool-read", correlationId: "tool-read", kind: "query", method: "tools.observeConnection", params: { toolId: "vrcft" } });
    await provider.invoke({ contractVersion: "0.1", requestId: "tool-act", correlationId: "tool-act", kind: "command", method: "tools.actConnection", commandId: "tool-once", params: { toolId: "vrcft", action: "start" } });
    expect(host.calls.map(call => call.method)).toEqual(["tools.observeConnection", "tools.actConnection"]);
    expect(amf.calls).toHaveLength(0); expect(activations()).toBe(0);
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("discovers an AMF task owner before cancellation without leaking command fields into its query", async () => {
    const { provider, host, amf } = setup();
    await provider.start(); await provider.setAmfEnabled(true);
    amf.tasks = [task("previous-session-amf-task")];
    await provider.invoke({ contractVersion: "0.1", requestId: "cancel", correlationId: "cancel", kind: "command", method: "task.requestCancellation", commandId: "cancel", params: { taskId: "previous-session-amf-task" } });
    expect(host.calls.at(-1)?.method).toBe("task.get");
    expect(host.calls.at(-1)).not.toHaveProperty("commandId");
    expect(amf.calls.map(call => call.method)).toEqual(["task.get", "task.requestCancellation"]);
    expect(amf.calls[0]).not.toHaveProperty("commandId");
    await provider.setAmfEnabled(false); await provider.prepareShutdown({ timeoutMs: 100 });
  });

  it("does not stop the module during an admitted metadata mutation", async () => {
    const { provider, amf } = setup();
    await provider.start(); await provider.setAmfEnabled(true);
    let finish!: () => void;
    const original = amf.invoke.bind(amf);
    amf.invoke = async request => {
      if (request.method === "catalog.beginLibrarySync") await new Promise<void>(resolve => { finish = resolve; });
      return original(request);
    };
    const pending = provider.invoke({ contractVersion: "0.1", requestId: "metadata", correlationId: "metadata", kind: "command", method: "catalog.beginLibrarySync", commandId: "metadata", params: { schemaVersion: "0.3", runId: "module-admission-test", libraryTypes: ["bought"] } });
    expect((await provider.setAmfEnabled(false)).outcome).toBe("busy");
    expect(amf.shutdownCalls).toBe(0);
    finish(); await pending;
    await provider.setAmfEnabled(false); await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("a fresh host never creates or queries AMF", async () => {
    const { provider, amf, host, activations } = setup();
    await provider.start();
    const snapshot = await provider.invoke(query("application.getSnapshot"));
    expect(snapshot.ok && "capabilities" in snapshot.value && snapshot.value.capabilities.operations).toEqual([
      { operationId: "environment.getSnapshot", availability: "available" },
      expect.objectContaining({ operationId: "production.recipes", availability: "unavailable" }),
    ]);
    await provider.invoke(query("task.list"));
    expect(activations()).toBe(0);
    expect(amf.calls).toEqual([]);
    expect(host.calls).toHaveLength(2);
    expect(provider.moduleSnapshot()).toEqual({ schemaVersion: "0.1", moduleId: "amf", installed: false, state: "absent" });
    await provider.prepareShutdown({ timeoutMs: 100 });
  });

  it("AMF startup failure does not prevent host start or core queries", async () => {
    const { provider, host } = setup({ enabled: true, factory: () => { throw new Error("corrupt BDL"); } });
    await provider.start();
    expect(provider.status().state).toBe("ready");
    expect(provider.moduleSnapshot().state).toBe("failed");
    expect((await provider.invoke(query("task.list"))).ok).toBe(true);
    expect((await provider.invoke(query("application.getSnapshot"))).ok).toBe(true);
    const blocked = await provider.invoke({ contractVersion: "0.1", requestId: "recipe", correlationId: "recipe", kind: "query", method: "recipe.list", params: {} });
    expect(!blocked.ok && blocked.error.code).toBe("vua.amf.unavailable");
    expect(host.calls.every(call => !call.method.startsWith("recipe."))).toBe(true);
    await provider.prepareShutdown({ timeoutMs: 100 });
  });

  it("merges owner capabilities and tasks, and routes cancellation to the persisted owner", async () => {
    const { provider, host, amf, saved } = setup();
    await provider.start();
    host.tasks = [task("host-task")]; amf.tasks = [task("amf-task")];
    expect((await provider.setAmfEnabled(true)).snapshot.state).toBe("ready");
    const snapshot = await provider.invoke(query("application.getSnapshot"));
    expect(snapshot.ok && "capabilities" in snapshot.value && snapshot.value.capabilities.operations).toEqual([
      { operationId: "environment.getSnapshot", availability: "available" },
      { operationId: "production.recipes", availability: "available" },
    ]);
    const list = await provider.invoke(query("task.list"));
    expect(list.ok && "tasks" in list.value && list.value.tasks.map(row => row.taskId)).toEqual(["amf-task", "host-task"]);
    await provider.invoke({ contractVersion: "0.1", requestId: "cancel", correlationId: "cancel", kind: "command", method: "task.requestCancellation", commandId: "cancel", params: { taskId: "amf-task" } });
    expect(amf.calls.at(-1)?.method).toBe("task.requestCancellation");
    expect(host.calls.some(call => call.method === "task.requestCancellation")).toBe(false);
    const stopped = await provider.setAmfEnabled(false);
    expect(stopped.outcome).toBe("updated");
    expect(stopped.snapshot.installed).toBe(false);
    expect(saved).toEqual([true, false]);
    expect(host.status().state).toBe("ready");
    expect(amf.shutdownCalls).toBe(1);
    await provider.prepareShutdown({ timeoutMs: 100 });
  });

  it("keeps the module enabled while an AMF task or shell download is active", async () => {
    let downloading = false;
    const { provider, amf, saved } = setup({ shellBusy: () => downloading });
    await provider.start(); await provider.setAmfEnabled(true);
    amf.tasks = [task("amf-task", "running")];
    expect((await provider.setAmfEnabled(false)).outcome).toBe("busy");
    amf.tasks = []; downloading = true;
    expect((await provider.setAmfEnabled(false)).outcome).toBe("busy");
    expect(amf.shutdownCalls).toBe(0);
    expect(saved).toEqual([true]);
    expect(provider.moduleSnapshot().state).toBe("ready");
    downloading = false;
    await provider.setAmfEnabled(false); await provider.prepareShutdown({ timeoutMs: 100 });
  });

  it("publishes AMF crash facts and leaves the host alive", async () => {
    const { provider, amf } = setup();
    await provider.start(); await provider.setAmfEnabled(true);
    const changes: AmfModuleSnapshotV01[] = [];
    provider.subscribeModule(snapshot => changes.push(snapshot));
    amf.crash();
    expect(changes.at(-1)?.state).toBe("failed");
    expect(provider.status().state).toBe("ready");
    expect((await provider.invoke(query("task.list"))).ok).toBe(true);
    await provider.setAmfEnabled(false); await provider.prepareShutdown({ timeoutMs: 100 });
  });
});

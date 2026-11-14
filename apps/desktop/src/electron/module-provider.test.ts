import { describe, expect, it, vi } from "vitest";
import type { ApplicationRequestV01, ApplicationResponseV01, AmfModuleSnapshotV01, TaskSnapshotV01 } from "@vua/contracts";
import { MockOrchestratorProviderV01, type OrchestratorProviderV01, type ProviderStatusV01 } from "@vua/orchestrator-provider";
import { isAmfOperation, ModuleProvider } from "./module-provider.js";

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

function setup(options: { enabled?: boolean; deferInitialAmf?: boolean; factory?: () => OrchestratorProviderV01; shellBusy?: () => boolean; expectedAmfBuild?: () => string } = {}) {
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
    ...(options.deferInitialAmf ? { deferInitialAmf: true } : {}),
    createAmf: () => { activations += 1; return options.factory?.() ?? amf; },
    persist: enabled => saved.push(enabled), ...(options.shellBusy ? { shellBusy: options.shellBusy } : {}),
    ...(options.expectedAmfBuild ? { expectedAmfBuild: options.expectedAmfBuild } : {}) });
  return { host, amf, provider, saved, activations: () => activations };
}

describe("host / optional AMF process boundary", () => {
  it("defers initial AMF process creation until requested while reporting starting", async () => {
    const { provider, activations, host } = setup({ enabled: true, deferInitialAmf: true });
    await provider.start();
    expect(host.status().state).toBe("ready");
    expect(activations()).toBe(0);
    expect(provider.moduleSnapshot().state).toBe("starting");
    expect(provider.amfReady()).toBe(false);
    provider.startInitialAmf();
    await vi.waitFor(() => expect(provider.amfReady()).toBe(true));
    expect(activations()).toBe(1);
    expect(provider.moduleSnapshot().state).toBe("ready");
    provider.startInitialAmf();
    expect(activations()).toBe(1);
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("does not construct AMF or open its data after invalid profile admission", async () => {
    const { provider, activations, host } = setup({ enabled: true }); provider.refuseDataTrial();
    await provider.start();
    expect(activations()).toBe(0); expect(provider.moduleSnapshot().state).toBe("failed");
    expect((await provider.invoke(query("application.getSnapshot"))).ok).toBe(true); expect(host.status().state).toBe("ready");
    expect((await provider.setAmfEnabled(true)).outcome).toBe("busy");
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("fences AMF user work until migrated data and provider/UI health commit", async () => {
    const { provider, host, amf } = setup(); await provider.start(); await provider.setAmfEnabled(true);
    amf.calls = []; provider.setDataTrial(true);
    expect(provider.amfHealthReady()).toBe(true); expect(provider.amfReady()).toBe(false);
    expect(provider.moduleSnapshot().state).toBe("starting");
    const request = { contractVersion: "0.1", requestId: "blocked-trial", correlationId: "trial", kind: "query", method: "recipe.list", params: {} } as const;
    expect(await provider.invoke(request)).toMatchObject({ ok: false, error: { code: "vua.amf.unavailable" } });
    expect((await provider.invoke(query("application.getSnapshot"))).ok).toBe(true);
    expect((await provider.setAmfEnabled(false)).outcome).toBe("busy"); expect(amf.calls).toHaveLength(0);
    expect(host.shutdownCalls).toBe(0); provider.setDataTrial(false);
    await provider.invoke(request); expect(amf.calls.at(-1)?.method).toBe("recipe.list");
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("rejects a running candidate with the wrong service build and restores only AMF", async () => {
    class IdentityPort extends Port {
      constructor(private readonly buildId: string) { super(); }
      override async start() { return { ...await super.start(), providerBuildId: this.buildId }; }
    }
    const old = new IdentityPort("amf/0.2.0@old"); const next = new IdentityPort("amf/0.2.0@wrong");
    let selected = old; let expected = "amf/0.2.0@old";
    const { provider, host } = setup({ factory: () => selected, expectedAmfBuild: () => expected });
    await provider.start(); await provider.setAmfEnabled(true);
    const complete = vi.fn(async () => {});
    expect(await provider.replaceAmf({ activate: async () => { selected = next; expected = "amf/0.2.0@next"; },
      verifyUi: async () => true, complete, restore: async () => { selected = old; expected = "amf/0.2.0@old"; } })).toBe("failed");
    expect(complete).not.toHaveBeenCalled(); expect(next.shutdownCalls).toBeGreaterThan(0);
    expect(provider.amfReady()).toBe(true); expect(host.shutdownCalls).toBe(0);
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("replaces idle AMF while a host task continues, without changing the enabled choice", async () => {
    const old = new Port(); const next = new Port(); let selected = old;
    const { provider, host, saved } = setup({ factory: () => selected }); await provider.start(); await provider.setAmfEnabled(true);
    host.tasks = [task("play-session", "running")];
    const complete = vi.fn(async () => {});
    expect(await provider.replaceAmf({ activate: async () => { selected = next; }, verifyUi: async () => true, complete, restore: async () => { selected = old; } })).toBe("updated");
    expect(host.shutdownCalls).toBe(0); expect(host.status().state).toBe("ready"); expect(old.shutdownCalls).toBe(1);
    expect(next.status().state).toBe("ready"); expect(saved).toEqual([true]); expect(complete).toHaveBeenCalledOnce();
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it.each([true, false])("publishes usable readiness after the replacement gate reopens (UI health %s)", async healthy => {
    const old = new Port(); const next = new Port(); let selected = old;
    const { provider } = setup({ factory: () => selected });
    await provider.start(); await provider.setAmfEnabled(true);
    const readiness: boolean[] = [];
    provider.subscribeModule(snapshot => { if (snapshot.state === "ready") readiness.push(provider.amfReady()); });
    expect(await provider.replaceAmf({
      activate: async () => { selected = next; },
      verifyUi: async () => { expect(provider.amfReady()).toBe(false); return healthy; },
      complete: async () => {}, restore: async () => { selected = old; },
    })).toBe(healthy ? "updated" : "failed");
    // Main's shell/image-cache subscription must see calls admitted again, on
    // both successful replacement and recovery of the previous generation.
    expect(readiness.at(-1)).toBe(true);
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("refuses a live AMF task before stopping either process", async () => {
    const { provider, host, amf } = setup(); await provider.start(); await provider.setAmfEnabled(true); amf.tasks = [task("inspection", "running")];
    const activate = vi.fn(async () => {});
    expect(await provider.replaceAmf({ activate, verifyUi: async () => true, complete: async () => {}, restore: async () => {} })).toBe("busy");
    expect(activate).not.toHaveBeenCalled(); expect(amf.shutdownCalls).toBe(0); expect(host.shutdownCalls).toBe(0);
    amf.tasks = []; await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("restores both the old AMF provider and selection if candidate UI health fails", async () => {
    const old = new Port(); const next = new Port(); let selected = old;
    const { provider, host, saved } = setup({ factory: () => selected }); await provider.start(); await provider.setAmfEnabled(true);
    const restore = vi.fn(async () => { selected = old; });
    expect(await provider.replaceAmf({ activate: async () => { selected = next; }, verifyUi: async () => false, complete: async () => {}, restore })).toBe("failed");
    expect(restore).toHaveBeenCalledOnce(); expect(next.shutdownCalls).toBe(1); expect(provider.amfReady()).toBe(true);
    expect(saved).toEqual([true]); expect(host.shutdownCalls).toBe(0); await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("updates a disabled AMF without starting it or changing its saved preference", async () => {
    const { provider, host, saved, activations } = setup(); await provider.start(); const verifyUi = vi.fn(async () => true);
    expect(await provider.replaceAmf({ activate: async () => {}, verifyUi, complete: async () => {}, restore: async () => {} })).toBe("updated");
    expect(activations()).toBe(0); expect(saved).toEqual([]); expect(provider.moduleSnapshot().state).toBe("absent");
    expect(verifyUi).toHaveBeenCalledOnce(); expect(host.shutdownCalls).toBe(0); await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("keeps terms reads and refreshes within the enabled AMF process", async () => {
    const { provider, host, amf, activations } = setup(); await provider.start();
    const read = { contractVersion: "0.1", requestId: "terms", correlationId: "terms", kind: "query", method: "terms.getProduct", params: { schemaVersion: "0.1", productId: "booth:1" } } as const;
    const unavailable = await provider.invoke(read); expect(unavailable).toMatchObject({ ok: false, error: { code: "vua.amf.unavailable" } });
    expect(host.calls).toEqual([]); expect(activations()).toBe(0);
    await provider.setAmfEnabled(true);
    await provider.invoke(read);
    await provider.invoke({ contractVersion: "0.1", requestId: "refresh", correlationId: "refresh", kind: "command", method: "terms.refreshProduct", commandId: "refresh", params: { schemaVersion: "0.1", productId: "booth:1" } });
    expect(amf.calls.map(call => call.method)).toEqual(["terms.getProduct", "terms.refreshProduct"]); expect(host.calls).toEqual([]);
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
  it("keeps passive license detection on the host without AMF and runs checks on the AMF authority", async () => {
    const { provider, host, amf, activations } = setup(); await provider.start();
    const read: ApplicationRequestV01 = {contractVersion:"0.1",requestId:"license-read",correlationId:"license-read",kind:"query",
      method:"environment.unityLicense",params:{schemaVersion:"0.1"}};
    const check: ApplicationRequestV01 = {contractVersion:"0.1",requestId:"license-check",correlationId:"license-check",kind:"command",commandId:"license-once",
      method:"environment.checkUnityLicense",params:{schemaVersion:"0.1",editorPath:"C:/synthetic/Unity.exe"}};
    await provider.invoke(read);
    expect(host.calls.map(call=>call.method)).toEqual(["environment.unityLicense"]);
    expect((await provider.invoke(check)).ok).toBe(false); expect(activations()).toBe(0); expect(amf.calls).toHaveLength(0);
    await provider.setAmfEnabled(true); host.calls.length = 0; amf.calls.length = 0;
    await provider.invoke(read); await provider.invoke(check);
    expect(amf.calls.map(call=>call.method)).toEqual(["environment.unityLicense","environment.checkUnityLicense"]);
    expect(host.calls).toHaveLength(0);
    await provider.prepareShutdown({timeoutMs:100});
  });
  it("admits update restart only after host/AMF work and shell transfers finish", async () => {
    let busy = false; const { provider, host, amf, saved } = setup({ shellBusy: () => busy });
    await provider.start(); await provider.setAmfEnabled(true);
    host.tasks = [task("host-work", "running")]; expect(await provider.prepareForUpdate()).toBe(false);
    host.tasks = []; amf.tasks = [task("amf-work", "running")]; expect(await provider.prepareForUpdate()).toBe(false);
    amf.tasks = []; busy = true; expect(await provider.prepareForUpdate()).toBe(false);
    expect(host.shutdownCalls).toBe(0); expect(amf.shutdownCalls).toBe(0);
    busy = false; expect(await provider.prepareForUpdate()).toBe(true);
    expect(host.shutdownCalls).toBe(1); expect(amf.shutdownCalls).toBe(1); expect(saved).toEqual([true]);
  });
  it("waits for an AMF operation that reads the whole work project", async () => {
    let finish: (response: ApplicationResponseV01) => void = () => undefined;
    class SlowSave extends Port {
      override async invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
        if (request.method !== "amf.production.saveRecipe") return super.invoke(request);
        return new Promise(resolve => { finish = resolve; });
      }
    }
    const slow = new SlowSave({ capabilities: [] });
    const { provider } = setup({ enabled: true, factory: () => slow });
    await provider.start();
    vi.useFakeTimers();
    try {
      const pending = provider.invoke({ contractVersion: "0.1", requestId: "save", correlationId: "save", kind: "command", method: "amf.production.saveRecipe", commandId: "save", params: {} } as unknown as ApplicationRequestV01);
      await vi.advanceTimersByTimeAsync(10_000);
      finish({ contractVersion: "0.1", requestId: "save", ok: true, value: {} } as unknown as ApplicationResponseV01);
      expect((await pending).ok).toBe(true);
    } finally { vi.useRealTimers(); }
    await provider.prepareShutdown({ timeoutMs: 100 });
  });
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

  it("waits for a failed AMF process to exit before starting AMF again", async () => {
    const order: string[] = [];
    class FailingStart extends Port {
      override async start(): Promise<never> { this.failed = true; throw new Error("corrupt BDL"); }
      async waitForExit(): Promise<boolean> { order.push("previous exited"); return true; }
    }
    const instances: OrchestratorProviderV01[] = [new FailingStart({ capabilities: [] }), new Port({ capabilities: [{ operationId: "production.recipes", availability: "available" }] })];
    const { provider } = setup({ factory: () => { order.push("created"); return instances.shift()!; } });
    await provider.start();
    expect((await provider.setAmfEnabled(true)).outcome).toBe("failed");
    expect((await provider.setAmfEnabled(true)).snapshot.state).toBe("ready");
    expect(order).toEqual(["created", "previous exited", "created"]);
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

  it("lists tasks newest first and keeps each row in place while progress updates it", async () => {
    const { provider, host, amf } = setup();
    await provider.start(); await provider.setAmfEnabled(true);
    const at = (row: TaskSnapshotV01, updatedAt: string): TaskSnapshotV01 => ({ ...row, updatedAt });
    const order = async () => {
      const list = await provider.invoke(query("task.list"));
      return list.ok && "tasks" in list.value ? list.value.tasks.map(row => row.taskId) : [];
    };
    host.tasks = [at(task("slow-download", "running"), "2026-10-16T10:00:00.000Z")];
    amf.tasks = [at(task("fast-download", "running"), "2026-10-16T10:00:01.000Z")];
    expect(await order()).toEqual(["fast-download", "slow-download"]);
    host.tasks = [at(task("slow-download", "running"), "2026-10-16T10:00:09.000Z")];
    amf.tasks = [at(task("fast-download", "running"), "2026-10-16T10:00:05.000Z"), at(task("newer-download", "queued"), "2026-10-16T10:00:08.000Z")];
    expect(await order()).toEqual(["newer-download", "fast-download", "slow-download"]);
    await provider.setAmfEnabled(false); await provider.prepareShutdown({ timeoutMs: 100 });
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

  it("routes freeAssets operations to the AMF module boundary", () => {
    expect(isAmfOperation("freeAssets.state")).toBe(true);
    expect(isAmfOperation("freeAssets.updatePreferences")).toBe(true);
    expect(isAmfOperation("freeAssets.ingestSearchPage")).toBe(true);
  });
});

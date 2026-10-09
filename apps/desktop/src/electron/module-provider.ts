import {
  APPLICATION_CONTRACT_VERSION,
  isTerminalTaskStateV01,
  type AmfModuleSnapshotV01,
  type AmfModuleChangeResultV01,
  type ApplicationEventV01,
  type ApplicationRequestV01,
  type ApplicationResponseV01,
  type ApplicationSnapshotV01,
  type CapabilityOperationV01,
  type TaskSnapshotV01,
} from "@vua/contracts";
import type {
  OrchestratorProviderV01, ProviderEventListenerV01, ProviderHandshakeV01,
  ProviderUnsubscribe, ProviderShutdownResultV01, ContinueShutdownRequestV01,
} from "@vua/orchestrator-provider";

const AMF_PREFIXES = ["production.", "warehouse.", "catalog.", "library.", "download.", "downloads.", "dependencies.", "recipe.", "recipeDraft.", "plan.", "job.", "record.", "inspection.", "release.", "project.", "packages.", "overlay."];
export function isAmfOperation(method: string): boolean {
  return AMF_PREFIXES.some(prefix => method.startsWith(prefix));
}

interface Options {
  readonly host: OrchestratorProviderV01;
  readonly createAmf: () => OrchestratorProviderV01;
  readonly enabled: boolean;
  readonly persist: (enabled: boolean) => void;
  readonly shellBusy?: () => boolean;
}

/** An explicit two-process composition, not an arbitrary plugin loader.
 * Each provider owns its task DB, process job and native services. Routing does
 * not reinterpret AMF's frozen Recipe/BDL/Bridge requests or persisted rows. */
export class ModuleProvider implements OrchestratorProviderV01 {
  readonly contractVersion = APPLICATION_CONTRACT_VERSION;
  readonly #listeners = new Set<ProviderEventListenerV01>();
  readonly #moduleListeners = new Set<(snapshot: AmfModuleSnapshotV01) => void>();
  readonly #taskOwners = new Map<string, "host" | "amf">();
  #amf: OrchestratorProviderV01 | undefined;
  #amfUnsubscribes: ProviderUnsubscribe[] = [];
  #enabled: boolean;
  #changing = false;
  #mutations = 0;
  #revision = 0;
  #moduleRevision = 0;
  #snapshotKey = "";
  #lastModuleKey = "";
  #shutdown: OrchestratorProviderV01[] = [];

  constructor(private readonly options: Options) {
    this.#enabled = options.enabled;
    options.host.subscribe(event => this.#forward(event, "host"));
  }

  status() { return this.options.host.status(); }

  async start(): Promise<ProviderHandshakeV01> {
    const handshake = await this.options.host.start();
    if (this.#enabled) void this.#startAmf();
    // The host handshake describes the host. AMF download readiness is queried
    // separately, and can change without restarting the host.
    return handshake;
  }

  moduleSnapshot(): AmfModuleSnapshotV01 {
    const state = this.#amf?.status().state;
    return { schemaVersion: "0.1", moduleId: "amf", installed: this.#enabled,
      state: !this.#enabled ? "absent" : state === "ready" ? "ready" : state === "starting" ? "starting" : state === "stopping" ? "stopping" : "failed" };
  }

  amfReady(): boolean { return this.#enabled && !this.#changing && this.#amf?.status().acceptingCalls === true; }
  subscribeModule(listener: (snapshot: AmfModuleSnapshotV01) => void): () => void {
    this.#moduleListeners.add(listener);
    return () => this.#moduleListeners.delete(listener);
  }

  async setAmfEnabled(enabled: boolean): Promise<AmfModuleChangeResultV01> {
    const result = (outcome: AmfModuleChangeResultV01["outcome"]): AmfModuleChangeResultV01 => ({ outcome, snapshot: this.moduleSnapshot() });
    if (this.#changing || this.#amf?.status().state === "starting" || this.#shutdown.length > 0) return result("busy");
    if (enabled && this.amfReady()) return result("updated");
    if (!enabled && !this.#enabled) return result("updated");
    this.#changing = true;
    try {
      if (enabled) {
        this.options.persist(true);
        this.#enabled = true;
        await this.#startAmf();
        return result(this.#amf?.status().state === "ready" ? "updated" : "failed");
      }
      if (this.#mutations > 0 || this.options.shellBusy?.()) return result("busy");
      if (this.#amf?.status().state === "ready") {
        const tasks = await this.#optionalInvoke(this.#query("task.list"));
        if (!tasks?.ok || !("revision" in tasks.value) || !("tasks" in tasks.value) || (tasks.value.tasks as readonly TaskSnapshotV01[]).some(task => !isTerminalTaskStateV01(task.state))) return result("busy");
        const stopped = await this.#amf.prepareShutdown({ timeoutMs: 3_000 });
        if (stopped.outcome === "needs_user_choice") return result("busy");
      } else if (this.#amf?.status().state === "stopping") {
        const stopped = await this.#amf.continueShutdown({ decision: "wait", timeoutMs: 3_000 });
        if (stopped.outcome === "needs_user_choice") return result("busy");
      }
      this.options.persist(false);
      this.#enabled = false;
      this.#detachAmf();
      return result("updated");
    } catch {
      return result("failed");
    } finally {
      this.#changing = false;
      this.#publishModule();
    }
  }

  async #startAmf(): Promise<void> {
    this.#detachAmf();
    try {
      const amf = this.options.createAmf();
      this.#amf = amf;
      this.#amfUnsubscribes.push(amf.subscribe(event => this.#forward(event, "amf")));
      if (amf.subscribeStatus) this.#amfUnsubscribes.push(amf.subscribeStatus(() => this.#publishModule()));
      await amf.start();
    } catch {
      // Failure belongs to AMF. Never reject the host bootstrap or reopen data
      // with a different layout to make a corrupt module appear healthy.
    } finally { this.#publishModule(); }
  }

  #detachAmf(): void {
    for (const unsubscribe of this.#amfUnsubscribes) unsubscribe();
    this.#amfUnsubscribes = [];
    this.#amf = undefined;
  }

  #publishModule(): void {
    const snapshot = this.moduleSnapshot();
    const key = JSON.stringify(snapshot);
    if (key === this.#lastModuleKey) return;
    this.#lastModuleKey = key;
    this.#moduleRevision += 1;
    for (const listener of this.#moduleListeners) listener(snapshot);
    // Invalidates served-capability consumers using the existing fact signal.
    for (const listener of this.#listeners) listener({ contractVersion: this.contractVersion,
      kind: "capability.changed", eventId: `modules-${this.#moduleRevision}`, revision: this.#moduleRevision,
      occurredAt: new Date().toISOString(), correlationId: "amf-lifecycle", payload: { revision: this.#moduleRevision, operations: [] } });
  }

  #forward(event: ApplicationEventV01, owner: "host" | "amf"): void {
    if ("taskId" in event) this.#taskOwners.set(event.taskId, owner);
    for (const listener of this.#listeners) listener(event);
  }

  subscribe(listener: ProviderEventListenerV01): ProviderUnsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #query(method: "application.getSnapshot" | "task.list"): ApplicationRequestV01 {
    return { contractVersion: this.contractVersion, requestId: crypto.randomUUID(), correlationId: crypto.randomUUID(), kind: "query", method, params: {} };
  }

  #unavailable(request: ApplicationRequestV01): ApplicationResponseV01 {
    return { contractVersion: this.contractVersion, requestId: request.requestId, ok: false,
      error: { contractVersion: this.contractVersion, code: "vua.amf.unavailable", category: "unavailable",
        messageKey: "errors.amf.unavailable", recoverable: true, retryable: true, correlationId: request.correlationId } };
  }

  async #optionalInvoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01 | undefined> {
    const amf = this.#amf;
    if (!this.#enabled || amf?.status().state !== "ready") return undefined;
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([amf.invoke(request), new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), 3_000); })]);
    } catch { return undefined; }
    finally { if (timeout) clearTimeout(timeout); }
  }

  async invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
    if (request.method === "application.getSnapshot" || request.method === "task.list") return this.#aggregate(request);
    if (isAmfOperation(request.method)) {
      if (!this.amfReady()) return this.#unavailable(request);
      if (request.kind === "command") this.#mutations += 1;
      try { return await this.#optionalInvoke(request) ?? this.#unavailable(request); }
      finally { if (request.kind === "command") this.#mutations -= 1; }
    }
    if (request.method === "task.get" || request.method === "task.requestCancellation") {
      const id = request.params.taskId;
      if (this.#taskOwners.get(id) === "amf") {
        if (!this.amfReady()) return this.#unavailable(request);
        return await this.#optionalInvoke(request) ?? this.#unavailable(request);
      }
      if (this.#taskOwners.get(id) !== "host" && this.#enabled) {
        const get: ApplicationRequestV01 = { contractVersion: this.contractVersion,
          requestId: crypto.randomUUID(), correlationId: request.correlationId,
          kind: "query", method: "task.get", params: { taskId: id } };
        const found = await this.options.host.invoke(get);
        if (found.ok) this.#taskOwners.set(id, "host");
        else if (found.error.code !== "vua.task.not_found") return { ...found, requestId: request.requestId };
        else {
          const optional = await this.#optionalInvoke(get);
          if (optional?.ok) {
            this.#taskOwners.set(id, "amf");
            if (request.method === "task.get") return { ...optional, requestId: request.requestId };
            return await this.#optionalInvoke(request) ?? this.#unavailable(request);
          }
          if (!optional) return this.#unavailable(request);
        }
      }
    }
    return this.options.host.invoke(request);
  }

  async #aggregate(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
    const core = await this.options.host.invoke(request);
    if (!core.ok) return core;
    const optional = await this.#optionalInvoke(request);
    if (request.method === "task.list" && "tasks" in core.value && "revision" in core.value) {
      const hostTasks = core.value.tasks as readonly TaskSnapshotV01[];
      const amfTasks = optional?.ok && "revision" in optional.value && "tasks" in optional.value ? optional.value.tasks as readonly TaskSnapshotV01[] : [];
      hostTasks.forEach(task => this.#taskOwners.set(task.taskId, "host"));
      amfTasks.forEach(task => this.#taskOwners.set(task.taskId, "amf"));
      return { ...core, value: { contractVersion: this.contractVersion,
        revision: this.#nextRevision(core.value.revision, optional?.ok && "revision" in optional.value ? optional.value.revision : 0),
        tasks: [...hostTasks, ...amfTasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.taskId.localeCompare(b.taskId)) } };
    }
    if (request.method === "application.getSnapshot" && "capabilities" in core.value) {
      const host = core.value as ApplicationSnapshotV01;
      const amf = optional?.ok && "capabilities" in optional.value ? optional.value as ApplicationSnapshotV01 : undefined;
      const rows = new Map(amf?.capabilities.operations.filter(row => isAmfOperation(row.operationId)).map(row => [row.operationId, row]));
      const operations: CapabilityOperationV01[] = host.capabilities.operations.map(row => isAmfOperation(row.operationId)
        ? rows.get(row.operationId) ?? { operationId: row.operationId, availability: "unavailable", reason: this.#unavailableReason(request) } : row);
      const revision = this.#nextRevision(host.revision, amf?.revision ?? 0);
      return { ...core, value: { contractVersion: this.contractVersion, revision, capabilities: { revision, operations } } };
    }
    return core;
  }

  #unavailableReason(request: ApplicationRequestV01) {
    const response = this.#unavailable(request);
    if (response.ok) throw new Error("Expected unavailable");
    return response.error;
  }

  #nextRevision(host: number, amf: number): number {
    const key = `${host}:${amf}:${this.#moduleRevision}`;
    if (key !== this.#snapshotKey) { this.#snapshotKey = key; this.#revision = Math.max(this.#revision + 1, host + amf); }
    return this.#revision;
  }

  async prepareShutdown(request: { readonly timeoutMs: number }): Promise<ProviderShutdownResultV01> {
    this.#shutdown = [this.#amf, this.options.host].filter((item): item is OrchestratorProviderV01 => item?.status().state === "ready" || item?.status().state === "stopping");
    const results: ProviderShutdownResultV01[] = [];
    for (const provider of this.#shutdown) results.push(provider.status().state === "stopping"
      ? await provider.continueShutdown({ decision: "wait", timeoutMs: request.timeoutMs }) : await provider.prepareShutdown(request));
    return this.#shutdownResult(results);
  }

  async continueShutdown(request: ContinueShutdownRequestV01): Promise<ProviderShutdownResultV01> {
    const results: ProviderShutdownResultV01[] = [];
    for (const provider of this.#shutdown) if (provider.status().state === "stopping") results.push(await provider.continueShutdown(request));
    return this.#shutdownResult(results);
  }

  #shutdownResult(results: readonly ProviderShutdownResultV01[]): ProviderShutdownResultV01 {
    const blockingTasks = results.flatMap(result => result.outcome === "needs_user_choice" ? result.blockingTasks : []);
    if (blockingTasks.length > 0) return { contractVersion: this.contractVersion, outcome: "needs_user_choice", blockingTasks };
    const forced = results.find(result => result.outcome === "forced");
    if (forced?.outcome === "forced") return { ...forced, interruptedTasks: results.flatMap(result => result.outcome === "forced" ? result.interruptedTasks : []) };
    return { contractVersion: this.contractVersion, outcome: "safe_to_stop", blockingTasks: [] };
  }
}

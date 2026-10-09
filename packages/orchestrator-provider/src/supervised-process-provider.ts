import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import {
  APPLICATION_CONTRACT_VERSION,
  type ApplicationEventV01,
  type ApplicationRequestV01,
  type ApplicationResponseV01,
} from "@vua/contracts";
import type {
  ContinueShutdownRequestV01,
  OrchestratorProviderV01,
  ProviderEventListenerV01,
  ProviderHandshakeV01,
  ProviderShutdownResultV01,
  ProviderStatusV01,
  ProviderUnsubscribe,
} from "./provider.js";

const FRAME_VERSION = "0.1";
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

interface ProviderFrame {
  readonly frameVersion: typeof FRAME_VERSION;
  readonly frameId: string;
  readonly kind: "response" | "event" | "protocol_error";
  readonly payload: unknown;
}

interface PendingFrame {
  readonly resolve: (payload: unknown) => void;
  readonly reject: (error: Error) => void;
}

export interface SupervisedProcessProviderOptionsV01 {
  readonly executablePath: string;
  readonly databasePath: string;
  readonly handshakeTimeoutMs?: number;
}

export type ProviderProcessFactoryV01 = (
  executablePath: string,
  databasePath: string,
) => ChildProcessWithoutNullStreams;

export class SupervisedProcessProviderV01 implements OrchestratorProviderV01 {
  readonly contractVersion = APPLICATION_CONTRACT_VERSION;

  readonly #options: SupervisedProcessProviderOptionsV01;
  readonly #processFactory: ProviderProcessFactoryV01;
  readonly #listeners = new Set<ProviderEventListenerV01>();
  readonly #statusListeners = new Set<(status: ProviderStatusV01) => void>();
  readonly #pending = new Map<string, PendingFrame>();
  #state: ProviderStatusV01["state"] = "stopped";
  #acceptingCalls = false;
  #child: ChildProcessWithoutNullStreams | undefined;
  #frameSequence = 0;
  #stdoutBuffer = Buffer.alloc(0);
  #stderr = "";
  #expectedExit = false;

  constructor(
    options: SupervisedProcessProviderOptionsV01,
    processFactory: ProviderProcessFactoryV01 = spawnProviderProcess,
  ) {
    if (!path.isAbsolute(options.executablePath) || !path.isAbsolute(options.databasePath)) {
      throw new Error("Provider executable and database paths must be absolute");
    }
    this.#options = options;
    this.#processFactory = processFactory;
  }

  status(): ProviderStatusV01 {
    return {
      contractVersion: this.contractVersion,
      state: this.#state,
      acceptingCalls: this.#acceptingCalls,
    };
  }

  async start(): Promise<ProviderHandshakeV01> {
    if (this.#state === "starting" || this.#state === "ready" || this.#state === "stopping") {
      throw new Error(`Provider cannot start while ${this.#state}`);
    }
    this.#state = "starting";
    this.#publishStatus();
    this.#acceptingCalls = false;
    this.#expectedExit = false;
    this.#stdoutBuffer = Buffer.alloc(0);
    this.#stderr = "";
    let child: ReturnType<ProviderProcessFactoryV01>;
    try { child = this.#processFactory(this.#options.executablePath, this.#options.databasePath); }
    catch (error) { this.#fail(asError(error)); throw error; }
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => this.#receiveStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.#receiveStderr(chunk));
    child.once("error", (error) => this.#fail(error));
    child.once("exit", (code, signal) => this.#handleExit(code, signal));

    try {
      const handshake = await this.#withTimeout(
        this.#send("handshake", null),
        this.#options.handshakeTimeoutMs ?? 5_000,
      );
      if (!isHandshake(handshake)) throw new Error("Provider returned an invalid handshake");
      this.#state = "ready";
      this.#acceptingCalls = true;
      this.#publishStatus();
      return handshake;
    } catch (error) {
      child.kill();
      this.#fail(asError(error));
      throw error;
    }
  }

  async invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
    if (!this.#acceptingCalls || this.#state !== "ready") {
      return {
        contractVersion: this.contractVersion,
        requestId: request.requestId,
        ok: false,
        error: {
          contractVersion: this.contractVersion,
          code: "vua.provider.not_accepting",
          category: "unavailable",
          messageKey: "errors.provider.notAccepting",
          recoverable: true,
          retryable: true,
          correlationId: request.correlationId,
        },
      };
    }
    const response = await this.#send("request", request);
    if (!isApplicationResponse(response, request.requestId)) {
      throw new Error("Provider returned an invalid application response");
    }
    return response;
  }

  subscribe(listener: ProviderEventListenerV01): ProviderUnsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeStatus(listener: (status: ProviderStatusV01) => void): ProviderUnsubscribe {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  #publishStatus(): void {
    for (const listener of this.#statusListeners) listener(this.status());
  }

  async prepareShutdown(request: { readonly timeoutMs: number }): Promise<ProviderShutdownResultV01> {
    requirePositiveInteger(request.timeoutMs, "shutdown timeout");
    if (this.#state !== "ready") throw new Error("Provider is not ready");
    this.#acceptingCalls = false;
    this.#state = "stopping";
    this.#publishStatus();
    const response = await this.#send("prepare_shutdown", request);
    if (!isShutdownResult(response)) throw new Error("Provider returned an invalid shutdown result");
    if (response.outcome === "safe_to_stop") this.#expectedExit = true;
    return response;
  }

  async continueShutdown(request: ContinueShutdownRequestV01): Promise<ProviderShutdownResultV01> {
    if (this.#state !== "stopping") throw new Error("Shutdown was not prepared");
    if (request.decision === "wait") requirePositiveInteger(request.timeoutMs, "shutdown timeout");
    else if (request.userDecisionId.trim().length === 0) throw new Error("Force shutdown requires a user decision id");
    const response = await this.#send("continue_shutdown", request);
    if (!isShutdownResult(response)) throw new Error("Provider returned an invalid shutdown result");
    if (response.outcome !== "needs_user_choice") this.#expectedExit = true;
    return response;
  }

  #send(kind: string, payload: unknown): Promise<unknown> {
    const child = this.#child;
    if (child === undefined || child.stdin.destroyed) return Promise.reject(new Error("Provider process is unavailable"));
    this.#frameSequence += 1;
    const frameId = `main-${this.#frameSequence}`;
    const encoded = Buffer.from(`${JSON.stringify({
      frameVersion: FRAME_VERSION,
      frameId,
      kind,
      payload,
    })}\n`, "utf8");
    if (encoded.byteLength > MAX_FRAME_BYTES) return Promise.reject(new Error("Provider frame exceeds one MiB"));
    return new Promise((resolve, reject) => {
      this.#pending.set(frameId, { resolve, reject });
      child.stdin.write(encoded, (error) => {
        if (error !== null && error !== undefined) {
          this.#pending.delete(frameId);
          reject(error);
        }
      });
    });
  }

  #receiveStdout(chunk: Buffer): void {
    this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, chunk]);
    if (this.#stdoutBuffer.byteLength > MAX_FRAME_BYTES && !this.#stdoutBuffer.includes(0x0a)) {
      this.#fail(new Error("Provider emitted an oversized frame"));
      this.#child?.kill();
      return;
    }
    let newline = this.#stdoutBuffer.indexOf(0x0a);
    while (newline >= 0) {
      const line = this.#stdoutBuffer.subarray(0, newline);
      this.#stdoutBuffer = this.#stdoutBuffer.subarray(newline + 1);
      if (line.byteLength > MAX_FRAME_BYTES) {
        this.#fail(new Error("Provider emitted an oversized frame"));
        this.#child?.kill();
        return;
      }
      this.#receiveFrame(line);
      newline = this.#stdoutBuffer.indexOf(0x0a);
    }
  }

  #receiveFrame(line: Buffer): void {
    let value: unknown;
    try {
      value = JSON.parse(line.toString("utf8"));
    } catch {
      this.#fail(new Error("Provider emitted invalid JSON"));
      this.#child?.kill();
      return;
    }
    if (!isProviderFrame(value)) {
      this.#fail(new Error("Provider emitted an invalid frame"));
      this.#child?.kill();
      return;
    }
    if (value.kind === "event") {
      if (!isApplicationEvent(value.payload)) {
        this.#fail(new Error("Provider emitted an invalid application event"));
        this.#child?.kill();
        return;
      }
      for (const listener of this.#listeners) listener(value.payload);
      return;
    }
    const pending = this.#pending.get(value.frameId);
    if (pending === undefined) return;
    this.#pending.delete(value.frameId);
    if (value.kind === "protocol_error") pending.reject(new Error("Provider rejected the protocol frame"));
    else {
      if (this.#state === "stopping" && isShutdownResult(value.payload)
        && value.payload.outcome !== "needs_user_choice") {
        this.#expectedExit = true;
      }
      pending.resolve(value.payload);
    }
  }

  #receiveStderr(chunk: Buffer): void {
    if (this.#stderr.length >= MAX_STDERR_BYTES) return;
    this.#stderr += chunk.toString("utf8").slice(0, MAX_STDERR_BYTES - this.#stderr.length);
  }

  #handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const expected = this.#expectedExit;
    this.#child = undefined;
    this.#acceptingCalls = false;
    this.#state = expected ? "stopped" : "failed";
    this.#publishStatus();
    const detail = `Provider exited (${code ?? "no-code"}/${signal ?? "no-signal"})`;
    this.#rejectPending(new Error(detail));
  }

  #fail(error: Error): void {
    this.#acceptingCalls = false;
    this.#state = "failed";
    this.#publishStatus();
    this.#rejectPending(error);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  async #withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    requirePositiveInteger(timeoutMs, "handshake timeout");
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Provider handshake timed out")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function spawnProviderProcess(executablePath: string, databasePath: string): ChildProcessWithoutNullStreams {
  return spawn(executablePath, ["--database", databasePath], {
    cwd: path.dirname(executablePath),
    env: providerEnvironment(process.env),
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

export function providerEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set(["systemroot", "windir", "temp", "tmp"]);
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => value !== undefined && allowed.has(key.toLowerCase())),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProviderFrame(value: unknown): value is ProviderFrame {
  return isRecord(value)
    && value.frameVersion === FRAME_VERSION
    && typeof value.frameId === "string"
    && (value.kind === "response" || value.kind === "event" || value.kind === "protocol_error")
    && "payload" in value;
}

function isHandshake(value: unknown): value is ProviderHandshakeV01 {
  return isRecord(value)
    && value.contractVersion === APPLICATION_CONTRACT_VERSION
    && Array.isArray(value.supportedContractVersions)
    && value.supportedContractVersions.includes(APPLICATION_CONTRACT_VERSION)
    && typeof value.providerBuildId === "string"
    && value.providerBuildId.length > 0
    && typeof value.providerInstanceId === "string"
    && value.providerInstanceId.length > 0
    // proposal 001: downloadIngest is a mandatory v0.1 capability bit; a
    // handshake without it is the drift that once broke the F4-4 receipt loop.
    && typeof value.downloadIngest === "boolean";
}

function isApplicationResponse(value: unknown, requestId: string): value is ApplicationResponseV01 {
  return isRecord(value)
    && value.contractVersion === APPLICATION_CONTRACT_VERSION
    && value.requestId === requestId
    && typeof value.ok === "boolean";
}

function isApplicationEvent(value: unknown): value is ApplicationEventV01 {
  return isRecord(value)
    && value.contractVersion === APPLICATION_CONTRACT_VERSION
    && typeof value.eventId === "string"
    && typeof value.kind === "string";
}

function isShutdownResult(value: unknown): value is ProviderShutdownResultV01 {
  if (!isRecord(value) || value.contractVersion !== APPLICATION_CONTRACT_VERSION) return false;
  if (value.outcome === "safe_to_stop") {
    return Array.isArray(value.blockingTasks) && value.blockingTasks.length === 0;
  }
  if (value.outcome === "needs_user_choice") {
    return Array.isArray(value.blockingTasks) && value.blockingTasks.every(isBlockingTask);
  }
  return value.outcome === "forced"
    && typeof value.userDecisionId === "string"
    && value.userDecisionId.length > 0
    && Array.isArray(value.interruptedTasks)
    && value.interruptedTasks.every(isBlockingTask);
}

function isBlockingTask(value: unknown): boolean {
  return isRecord(value)
    && typeof value.taskId === "string"
    && Number.isSafeInteger(value.revision)
    && (value.revision as number) >= 1
    && typeof value.state === "string"
    && [
      "queued", "preparing", "running", "waiting_for_input", "paused",
      "succeeded", "succeeded_with_warnings", "failed", "cancelled",
    ].includes(value.state);
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

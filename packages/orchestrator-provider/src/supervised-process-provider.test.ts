import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_CONTRACT_VERSION,
  type ApplicationRequestV01,
} from "@vua/contracts";
import {
  providerEnvironment,
  SupervisedProcessProviderV01,
  type ProviderProcessFactoryV01,
} from "./supervised-process-provider.js";

class FakeProviderProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdio = [this.stdin, this.stdout, this.stderr];
  killed = false;
  #buffer = "";
  readonly #handshakePayload: unknown;

  constructor(handshakePayload: unknown = {
    contractVersion: "0.1",
    supportedContractVersions: ["0.1"],
    providerBuildId: "fake-build",
    providerInstanceId: "fake-instance",
    downloadIngest: false,
  }) {
    super();
    this.#handshakePayload = handshakePayload;
    this.stdin.on("data", (chunk: Buffer) => {
      this.#buffer += chunk.toString("utf8");
      let newline = this.#buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        this.#handle(JSON.parse(line) as Record<string, unknown>);
        newline = this.#buffer.indexOf("\n");
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  }

  crash(): void {
    this.emit("exit", 23, null);
  }

  #handle(frame: Record<string, unknown>): void {
    const frameId = frame.frameId as string;
    const kind = frame.kind as string;
    if (kind === "handshake") {
      this.#respond(frameId, this.#handshakePayload);
      return;
    }
    if (kind === "prepare_shutdown" || kind === "continue_shutdown") {
      this.#respond(frameId, {
        contractVersion: "0.1",
        outcome: "safe_to_stop",
        blockingTasks: [],
      });
      queueMicrotask(() => this.emit("exit", 0, null));
      return;
    }
    const request = frame.payload as ApplicationRequestV01;
    this.#respond(frameId, {
      contractVersion: "0.1",
      requestId: request.requestId,
      ok: true,
      value: {
        contractVersion: "0.1",
        taskId: "task-recovered",
        revision: 4,
        correlationId: request.correlationId,
        state: "running",
        cancellationRequested: false,
        recoveryDisposition: "inspect_required",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    });
    this.stdout.write(`${JSON.stringify({
      frameVersion: "0.1",
      frameId: "event-1",
      kind: "event",
      payload: {
        contractVersion: "0.1",
        eventId: "event-1",
        taskId: "task-recovered",
        revision: 4,
        occurredAt: "2026-09-02T00:00:00.000Z",
        correlationId: request.correlationId,
        kind: "task.stateChanged",
        state: "running",
        payload: {},
      },
    })}\n`);
  }

  #respond(frameId: string, payload: unknown): void {
    this.stdout.write(`${JSON.stringify({
      frameVersion: "0.1",
      frameId,
      kind: "response",
      payload,
    })}\n`);
  }
}

function harness(handshakePayload?: unknown): {
  readonly provider: SupervisedProcessProviderV01;
  readonly processes: FakeProviderProcess[];
} {
  const processes: FakeProviderProcess[] = [];
  const factory: ProviderProcessFactoryV01 = () => {
    const process = new FakeProviderProcess(handshakePayload);
    processes.push(process);
    return process as never;
  };
  return {
    provider: new SupervisedProcessProviderV01({
      executablePath: path.resolve("fake-provider.exe"),
      databasePath: path.resolve("fake-provider.db"),
    }, factory),
    processes,
  };
}

function getRequest(): ApplicationRequestV01 {
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    requestId: "request-get",
    correlationId: "correlation-get",
    kind: "query",
    method: "task.get",
    params: { taskId: "task-recovered" },
  };
}

describe("supervised process Provider v0.1", () => {
  it("publishes failed rather than staying starting when process creation throws", async () => {
    const provider = new SupervisedProcessProviderV01({ executablePath: path.resolve("absent.exe"), databasePath: path.resolve("absent.db") }, () => { throw new Error("spawn refused"); });
    const states: string[] = [];
    const unsubscribe = provider.subscribeStatus(status => states.push(status.state));
    await expect(provider.start()).rejects.toThrow("spawn refused");
    expect(provider.status().state).toBe("failed");
    expect(provider.status().acceptingCalls).toBe(false);
    expect(states).toEqual(["starting", "failed"]);
    unsubscribe();
  });
  it("keeps admission closed through handshake and forwards responses and events", async () => {
    const { provider } = harness();
    expect(provider.status()).toMatchObject({ state: "stopped", acceptingCalls: false });
    await expect(provider.start()).resolves.toMatchObject({ providerInstanceId: "fake-instance" });
    expect(provider.status()).toMatchObject({ state: "ready", acceptingCalls: true });
    const events: string[] = [];
    provider.subscribe((event) => events.push(event.kind));
    await expect(provider.invoke(getRequest())).resolves.toMatchObject({
      ok: true,
      value: { recoveryDisposition: "inspect_required" },
    });
    expect(events).toEqual(["task.stateChanged"]);
    await expect(provider.prepareShutdown({ timeoutMs: 1_000 }))
      .resolves.toMatchObject({ outcome: "safe_to_stop" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.status()).toMatchObject({ state: "stopped", acceptingCalls: false });
  });

  it("reports an unexpected process exit and permits an explicit restart", async () => {
    const { provider, processes } = harness();
    await provider.start();
    processes[0]?.crash();
    expect(provider.status()).toMatchObject({ state: "failed", acceptingCalls: false });
    await expect(provider.start()).resolves.toMatchObject({ providerBuildId: "fake-build" });
    expect(processes).toHaveLength(2);
    await provider.prepareShutdown({ timeoutMs: 1_000 });
  });

  it("keeps a rejected handshake in the failed state after terminating the child", async () => {
    const { provider } = harness({ contractVersion: "unknown" });
    await expect(provider.start()).rejects.toThrow("invalid handshake");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.status()).toMatchObject({ state: "failed", acceptingCalls: false });
  });

  it("does not pass credential-like environment variables to the Provider", () => {
    expect(providerEnvironment({
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      VUA_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      PATH: "unneeded",
    })).toEqual({ SystemRoot: "C:\\Windows", TEMP: "C:\\Temp" });
  });
});

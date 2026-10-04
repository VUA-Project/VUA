import { describe, expect, it, vi } from "vitest";
import { APPLICATION_CONTRACT_VERSION, type ApplicationEventV01 } from "@vua/contracts";
import { createElectronGateway } from "./electron-gateway.js";
import { createGatewayClient, type DesktopGatewayHost } from "./gateway-client.js";
import { strings } from "../i18n/index.js";
import type { TaskCenterView } from "./task-port.js";

function taskSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: APPLICATION_CONTRACT_VERSION,
    taskId: "demo-1",
    revision: 1,
    correlationId: "correlation-1",
    state: "queued",
    cancellationRequested: false,
    recoveryDisposition: "none",
    updatedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

interface InvokeCall {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function stubHost(responses: (call: InvokeCall) => unknown): {
  host: DesktopGatewayHost;
  calls: InvokeCall[];
  emit: (event: ApplicationEventV01) => void;
} {
  const calls: InvokeCall[] = [];
  const listeners = new Set<(event: ApplicationEventV01) => void>();
  const host: DesktopGatewayHost = {
    gateway: {
      invoke: vi.fn(async (request) => {
        const typed = request as InvokeCall & { schemaVersion: number };
        calls.push({ method: typed.method, params: typed.params });
        return responses(calls[calls.length - 1]!);
      }),
    },
    events: {
      subscribe: vi.fn((listener: (event: ApplicationEventV01) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
  };
  return { host, calls, emit: (event) => listeners.forEach((listener) => listener(event)) };
}

const ok = (value: unknown) => ({ ok: true as const, value });
// Kernel 信封:Provider 应用错误以 code=application 包装透传(见 gateway-router)
const appError = (code: string) => ({
  ok: false as const,
  error: {
    code: "application" as const,
    application: {
      contractVersion: APPLICATION_CONTRACT_VERSION,
      code,
      category: "validation" as const,
      messageKey: "errors.test",
      recoverable: false,
      retryable: false,
      correlationId: "correlation-1",
    },
  },
});

describe("N1 deployment consumer", () => {
  const intent = { purposes: ["pc_avatar"] as const, editorRoot: "C:\\VUA Test\\Editors" };
  const plan = { schemaVersion: "vua.environment-deployment/v0.1" as const, intent, digest: "a".repeat(64), prerequisitesReady: false, installer: null,
    steps: ["unity_hub", "unity_editor"].map(component => ({ component, action: "manual_install" as const, reason: "missing" as const, location: null, version: null, officialUrl: "https://unity.com/download" })) };
  it("requires both served deployment capabilities rather than inferring them from inspection", async () => {
    for (const available of [true, false]) {
      const { host } = stubHost(() => ok({ capabilities: { operations: available
        ? ["environment.planDeployment", "environment.executeDeployment"].map(operationId => ({ operationId, availability: "available" }))
        : [{ operationId: "environment.getSnapshot", availability: "available" }] } }));
      expect((await createElectronGateway(host, null).environment.deployment!.capability()).state).toBe(available ? "ready" : "unavailable");
    }
  });
  it("uses confirmed backend intent and command identity, then reads authoritative task state", async () => {
    const { host, calls } = stubHost(call => call.method === "environment.planDeployment"
      ? ok({ deploymentPlan: plan }) : call.method === "environment.executeDeployment"
        ? ok({ schemaVersion: plan.schemaVersion, operation: "environment.executeDeployment", taskId: "deployment-1", correlationId: "corr" })
        : ok(taskSnapshot({ taskId: "deployment-1" })));
    const port = createElectronGateway(host, null).environment.deployment!;
    expect(await port.plan(intent)).toEqual(plan);
    expect(await port.execute(plan, "command-1")).toBe("deployment-1");
    expect(calls[1]!.params).toEqual({ intent, confirmedDigest: plan.digest, commandId: "command-1" });
    expect((await port.status("deployment-1")).state).toBe("queued");
    await port.cancel("deployment-1", 4);
    expect(calls[3]!.params).toMatchObject({ taskId: "deployment-1", observedRevision: 4 });
  });
  it("keeps unavailable plans, malformed receipts and failed refresh visible", async () => {
    const { host } = stubHost(() => ok({ taskId: "looks-successful" }));
    const env = createElectronGateway(host, null).environment;
    await expect(env.deployment!.plan(intent)).rejects.toThrow();
    await expect(env.deployment!.execute(plan, "command-1")).rejects.toThrow();
    await expect(env.runCheck("create")).rejects.toThrow("environment_snapshot_unavailable");
  });
  it("refuses another task's snapshot and unknown states instead of inventing progress", async () => {
    for (const snapshot of [taskSnapshot({ taskId: "wrong-task" }), taskSnapshot({ taskId: "deployment-1", state: "installed" })]) {
      const { host } = stubHost(() => ok(snapshot));
      await expect(createElectronGateway(host, null).environment.deployment!.status("deployment-1")).rejects.toThrow("deployment_status_unavailable");
    }
  });
  it("accepts only this task's closed live step facts and unsubscribes", () => {
    const { host, emit } = stubHost(() => ok({}));
    const callback = vi.fn();
    const unsubscribe = createElectronGateway(host, null).environment.deployment!.subscribe("deployment-1", callback);
    const event: ApplicationEventV01 = { contractVersion: "0.1", kind: "task.progressed", eventId: "e", taskId: "deployment-1", revision: 4,
      correlationId: "corr", occurredAt: "2026-09-30T00:00:00Z", state: "running", payload: { completed: 0, total: 2,
        messageKey: "deployment.actions.install_editor", params: { operation: "environment.executeDeployment", component: "unity_editor", action: "install_editor", phase: "started" } } };
    emit({ ...event, taskId: "different-task" });
    emit({ ...event, payload: { ...event.payload, params: { ...event.payload.params, action: "erase_disk" } } });
    expect(callback).not.toHaveBeenCalled();
    emit(event);
    expect(callback).toHaveBeenCalledWith({ component: "unity_editor", action: "install_editor", phase: "started" });
    emit({ ...event, payload: { ...event.payload, params: { ...event.payload.params, phase: "downloading", source: "nounitycn", completedBytes: 1024, totalBytes: 2048 } } });
    expect(callback).toHaveBeenLastCalledWith({ component: "unity_editor", action: "install_editor", phase: "downloading", source: "nounitycn", completedBytes: 1024, totalBytes: 2048 });
    emit({ ...event, payload: { ...event.payload, params: { ...event.payload.params, phase: "downloading", completedBytes: -1 } } });
    unsubscribe(); emit(event); expect(callback).toHaveBeenCalledTimes(2);
  });
});

describe("live Electron Gateway (F2)", () => {
  it("serves the task center from task.list and projects contract values", async () => {
    const { host } = stubHost(() => ok({
      contractVersion: APPLICATION_CONTRACT_VERSION,
      revision: 2,
      tasks: [taskSnapshot()],
    }));
    const gateway = createElectronGateway(host, null);

    const view = await gateway.task.snapshot();
    expect(view.tasks).toEqual([
      expect.objectContaining({ id: "demo-1", status: "queued", cancellable: true }),
    ]);
    expect(gateway.dataSource()).toBe("live");
  });

  it("refreshes the view after task events and stops on unsubscribe", async () => {
    const { host, emit } = stubHost(() => ok({
      contractVersion: APPLICATION_CONTRACT_VERSION,
      revision: 2,
      tasks: [],
    }));
    const gateway = createElectronGateway(host, null);
    const views: TaskCenterView[] = [];
    const unsubscribe = gateway.task.subscribe((view) => views.push(view));

    emit({
      contractVersion: APPLICATION_CONTRACT_VERSION,
      eventId: "event-1",
      taskId: "demo-1",
      revision: 2,
      occurredAt: "2026-09-04T00:00:01.000Z",
      correlationId: "correlation-1",
      kind: "task.stateChanged",
      state: "running",
      payload: {},
    });
    await vi.waitFor(() => expect(views).toHaveLength(1));

    unsubscribe();
    emit({
      contractVersion: APPLICATION_CONTRACT_VERSION,
      eventId: "event-2",
      taskId: "demo-1",
      revision: 3,
      occurredAt: "2026-09-04T00:00:02.000Z",
      correlationId: "correlation-1",
      kind: "task.stateChanged",
      state: "succeeded",
      payload: {},
    });
    expect(views).toHaveLength(1);
  });

  it("distinguishes unknown tasks from provider outages when cancelling", async () => {
    const notFound = stubHost(() => appError("vua.task.not_found"));
    const gatewayNotFound = createElectronGateway(notFound.host, null);
    const rejected = await gatewayNotFound.task.cancel("missing");
    expect(rejected).toMatchObject({ kind: "rejected", reason: "unknown_task" });

    const outage = stubHost(() => ({ ok: false, error: { code: "internal", messageKey: "errors.gateway.providerUnavailable" } }));
    const gatewayOutage = createElectronGateway(outage.host, null);
    const unavailable = await gatewayOutage.task.cancel("demo-1");
    expect(unavailable).toMatchObject({ kind: "rejected", reason: "unavailable" });
  });

  it("throws on the first frame when the provider is unreachable so the shell shows an honest failure", async () => {
    const outage = stubHost(() => ({ ok: false, error: { code: "internal", messageKey: "errors.gateway.providerUnavailable" } }));
    const gateway = createElectronGateway(outage.host, null);
    await expect(gateway.task.snapshot()).rejects.toThrow("task_list_unavailable");
    await expect(gateway.environment.snapshot()).rejects.toThrow("environment_snapshot_unavailable");
  });

  it("projects the environment snapshot and derives the module capability", async () => {
    const { host } = stubHost((call) =>
      call.method === "environment.getSnapshot"
        ? ok({
            // provider-host live 形状(BOARD #36 缺陷③,#22 教训:mock 钉
            // live wire 而非 TS 面):顶层 contractVersion/revision 手拼,
            // items 为引擎 serde 逐条输出(逐条 schemaVersion+checkId,
            // errorCode 非 detection_failed 时为 null)
            contractVersion: APPLICATION_CONTRACT_VERSION,
            revision: 1,
            capturedAt: "2026-09-04T01:00:00.000Z",
            items: [
              {
                schemaVersion: 1,
                checkId: "steam",
                zone: "play",
                presence: "detected",
                errorCode: null,
                facts: {},
              },
            ],
          })
        : ok({
            contractVersion: APPLICATION_CONTRACT_VERSION,
            revision: 1,
            capabilities: { revision: 1, operations: [] },
          }),
    );
    const gateway = createElectronGateway(host, null);

    const view = await gateway.environment.snapshot();
    const play = view.deployer.zones.play;
    if (play.kind !== "results") throw new Error("expected a results phase");
    expect(play.items[0]).toMatchObject({ id: "steam", status: "ok" });
    // #31 验收点:title 经投影词表带出(wire=checkId 后非空),DeployerPage
    // h2 渲染 item.title 即此值
    expect(play.items[0]?.title).toBe(strings.deployer.checks.steam);
    await expect(gateway.environment.capability()).resolves.toEqual({ state: "ready" });
    await expect(gateway.environment.planFix("steam")).resolves.toEqual({ kind: "unavailable" });
    await expect(gateway.task.capability()).resolves.toEqual({ state: "unavailable", detailKey: "taskEngineMissing" });
  });

  it("falls back to the honest not-run ports outside the Electron host", async () => {
    const gateway = createElectronGateway(undefined, null);
    await expect(gateway.task.snapshot()).rejects.toThrow("task_list_unavailable");
    expect(await gateway.environment.planFix("steam")).toEqual({ kind: "unavailable" });
  });

describe("live pickMaterial over the Kernel dialog surface", () => {
  it("maps the picked source to a MaterialRef and degrades to null without a host", async () => {
    const dialog = {
      pickMaterialSource: async (intake: string) =>
        intake === "direct_unity_package"
          ? { refId: "mat-1-abc", displayName: "closet.unitypackage" }
          : null,
    };
    const invoke = async () => ({ ok: true as const, value: { contractVersion: "0.1" } as never });
    const gateway = createElectronGateway(
      { gateway: { invoke }, events: { subscribe: () => () => {} }, dialog },
      null,
    );

    const picked = await gateway.modelProduction.pickMaterial("direct_unity_package");
    expect(picked).toEqual({
      materialId: "mat-1-abc",
      intake: "direct_unity_package",
      displayName: "closet.unitypackage",
    });
    expect(await gateway.modelProduction.pickMaterial("local_reusable_vpm")).toBeNull();
  });

  it("keeps the run view honest before any run while capability follows the task engine", async () => {
    const gateway = createElectronGateway(
      {
        gateway: {
          invoke: async () => ({
            ok: true as const,
            value: {
              schemaVersion: 1 as const,
              productVersion: "0.4.2",
              runtime: "electron" as const,
              platform: "win32" as const,
              capabilities: {
                gateway: true as const,
                tasks: false,
                remoteBrowser: false,
                // BOARD #36 缺陷①起信封必带 provider 能力行(可空数组)
                operations: [],
              },
            },
          }),
        },
        events: { subscribe: () => () => {} },
        dialog: { pickMaterialSource: async () => null },
      },
      null,
    );
    const view = await gateway.modelProduction.snapshot();
    expect(view.productionRun).toEqual({ schemaVersion: 1, kind: "not-connected" });
    expect(view.workshop).toEqual({ kind: "idle" });
    // F-3:能力报告随任务引擎事实(生产缺席在命令层以应用错误如实拒绝)
    const capability = await gateway.modelProduction.capability();
    expect(capability).toEqual({
      overall: { state: "unavailable", detailKey: "detectorsMissing" },
      production: { state: "unavailable", detailKey: "taskEngineMissing" },
    });
    // 取数失败:首帧诚实失败向上抛(页面呈现失败卡 + 重试)
    const broken = createElectronGateway(
      {
        gateway: { invoke: async () => ({ ok: false, error: { code: "internal", messageKey: "x" } }) },
        events: { subscribe: () => () => {} },
        dialog: { pickMaterialSource: async () => null },
      },
      null,
    );
    await expect(broken.modelProduction.capability()).rejects.toThrow("production_capability_unavailable");
    // 无宿主:选取如实返回 null(入口本就由 capability 隐藏)
    const gatewayNoHost = createElectronGateway(undefined, null);
    await expect(gatewayNoHost.modelProduction.pickMaterial("local_reusable_vpm")).resolves.toBeNull();
  });
});
});

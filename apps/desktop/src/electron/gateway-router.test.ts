import { describe, expect, it, vi } from "vitest";
import { MockOrchestratorProviderV01 } from "@vua/orchestrator-provider";
import { routeDesktopGatewayInvoke, type DesktopGatewayRouteContext } from "./gateway-router.js";
import { SHELL_CAPABILITIES } from "./shell-capabilities.js";

const rendererUrl = "http://127.0.0.1:5173";

function request(): unknown {
  return {
    schemaVersion: 1,
    requestId: "desktop-request-1",
    method: "app.snapshot",
    params: {},
  };
}

describe("Electron Desktop Gateway routing", () => {
  it("routes network checks as read-only queries and rejects arbitrary endpoints", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");
    const context = { provider, productVersion: "0.6.0", platform: "win32" as const, rendererUrl };
    const params = { intent: { route: "desktop_play", region: "china_mainland" } };
    await routeDesktopGatewayInvoke(context, `${rendererUrl}/`, { schemaVersion: 1, requestId: "network", method: "environment.checkNetwork", params });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ kind: "query", method: "environment.checkNetwork", params }));
    invoke.mockClear();
    const rejected = await routeDesktopGatewayInvoke(context, `${rendererUrl}/`, { schemaVersion: 1, requestId: "network", method: "environment.checkNetwork", params: { ...params, url: "http://localhost" } });
    expect(rejected).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("maps N1 confirmation into the application command and rejects renderer commands", async () => {
    const provider = new MockOrchestratorProviderV01(); await provider.start();
    const invoke = vi.spyOn(provider, "invoke");
    const context = { provider, productVersion: "0.6.0", platform: "win32", rendererUrl };
    const params = { intent: { purposes: ["pc_avatar"], editorRoot: "C:\\VUA Test\\Editors" }, confirmedDigest: "a".repeat(64), commandId: "deployment-command" };
    await routeDesktopGatewayInvoke(context, `${rendererUrl}/`, { schemaVersion: 1, requestId: "deploy", method: "environment.executeDeployment", params });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ kind: "command", method: "environment.executeDeployment", commandId: params.commandId,
      params: { intent: params.intent, confirmedDigest: params.confirmedDigest } }));
    invoke.mockClear();
    const rejected = await routeDesktopGatewayInvoke(context, `${rendererUrl}/`, { schemaVersion: 1, requestId: "bad", method: "environment.executeDeployment", params: { ...params, executable: "cmd.exe" } });
    expect(rejected).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects an invalid envelope before invoking the Provider", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const response = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { ...request() as object, method: "shell.execute" },
    );

    expect(response).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("retains the local-origin boundary", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();

    await expect(routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      "https://booth.pm/",
      request(),
    )).rejects.toThrow("untrusted renderer origin");
  });

  it("routes app.snapshot through the Provider and derives honest capabilities", async () => {
    const provider = new MockOrchestratorProviderV01({
      capabilities: [
        { operationId: "task.list", availability: "available" },
        {
          // 带 reason 的 unavailable 行照原样透传钉死;用 demo.task 变体——
          // desktop.remoteBrowser 不是 provider 操作(015 §11 (a)),mock 不
          // 复活已移除的死形状(#22 live/fixture 形状一致)
          operationId: "demo.task",
          availability: "unavailable",
          reason: {
            contractVersion: "0.1",
            code: "vua.demo.task_unavailable",
            category: "unavailable",
            messageKey: "errors.demo.taskUnavailable",
            recoverable: true,
            retryable: false,
            correlationId: "capability-test",
          },
        },
      ],
    });
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const response = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      request(),
    );

    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-1",
      correlationId: "desktop-request-1",
      kind: "query",
      method: "application.getSnapshot",
      params: {},
    });
    expect(response).toMatchObject({
      ok: true,
      // #36 缺陷4′ 钉死:信封 remoteBrowser 与壳自报引用同一事实源
      // (shell-capabilities),不再是硬编码字面量——实现改回硬编码即红
      value: {
        capabilities: {
          gateway: true,
          tasks: true,
          remoteBrowser: SHELL_CAPABILITIES.remoteBrowser,
        },
      },
    });
    if (!response.ok) throw new Error("expected a snapshot response");
    const capabilities = (response.value as {
      capabilities: { operations: unknown };
    }).capabilities;
    // BOARD #36 缺陷①钉死(#22 live/fixture 形状一致性):provider 能力行
    // 原样透传进桌面信封——live provider(mock 与受监督进程同面)声明什么
    // 行,渲染层读到的就是什么行,Kernel 不解释不增删。行序 = provider 侧
    // 事实(mock 内部按 operationId 排序),断言按排序比较不耦合该内部顺序
    const sortedRows = (rows: { operationId: string }[]) =>
      [...rows].sort((a, b) => a.operationId.localeCompare(b.operationId));
    expect(sortedRows(capabilities.operations)).toEqual(sortedRows([
      { operationId: "task.list", availability: "available" },
      {
        operationId: "demo.task",
        availability: "unavailable",
        reason: {
          contractVersion: "0.1",
          code: "vua.demo.task_unavailable",
          category: "unavailable",
          messageKey: "errors.demo.taskUnavailable",
          recoverable: true,
          retryable: false,
          correlationId: "capability-test",
        },
      },
    ]));
  });

  it("reports absent Provider capabilities as unavailable", async () => {
    const provider = new MockOrchestratorProviderV01({ capabilities: [] });
    await provider.start();

    const response = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      request(),
    );

    expect(response).toMatchObject({
      ok: true,
      // 同源钉死(#36 缺陷4′):空 provider 行集下信封能力布尔仍与壳自报
      // 同一事实源
      value: {
        capabilities: {
          gateway: true,
          tasks: false,
          remoteBrowser: SHELL_CAPABILITIES.remoteBrowser,
        },
      },
    });
    if (!response.ok) throw new Error("expected a snapshot response");
    // 空能力表照原样透传:空数组是诚实空态,不是缺字段(读行方的词表 gate
    // 依赖 Array.isArray 判定,缺字段会被误判为不可用——同一事实的两种
    // 形状,信封只允许带行的那种)
    expect((response.value as {
      capabilities: { operations: unknown };
    }).capabilities.operations).toEqual([]);
  });

  it("routes task.list through the Provider and returns the application value verbatim", async () => {
    const provider = new MockOrchestratorProviderV01({ tasks: [{
      contractVersion: "0.1",
      taskId: "task-1",
      revision: 2,
      correlationId: "correlation-1",
      state: "running",
      cancellationRequested: false,
      recoveryDisposition: "none",
      updatedAt: "2026-09-04T00:00:00.000Z",
    }] });
    await provider.start();

    const response = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-3", method: "task.list", params: {} },
    );

    expect(response.ok).toBe(true);
    if (response.ok && "tasks" in response.value) {
      expect(response.value.tasks).toHaveLength(1);
      expect(response.value.tasks[0]?.taskId).toBe("task-1");
    } else {
      throw new Error("expected a task list value");
    }
  });

  it("passes application errors through instead of masking them as internal", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();

    const response = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-4", method: "task.get", params: { taskId: "missing" } },
    );

    expect(response.ok).toBe(false);
    if (!response.ok && response.error.code === "application") {
      expect(response.error.application.code).toBe("vua.task.not_found");
      expect(response.error.application.messageKey).toBe("errors.task.notFound");
    } else {
      throw new Error("expected an application error");
    }
  });

  it("routes the demo task command end to end with capability gating", async () => {
    const gated = new MockOrchestratorProviderV01({
      capabilities: [{ operationId: "demo.task", availability: "available" }],
    });
    await gated.start();

    const started = await routeDesktopGatewayInvoke(
      { provider: gated, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-5", method: "task.startDemo", params: { commandId: "demo-1" } },
    );
    expect(started.ok).toBe(true);
    if (started.ok && "task" in started.value) {
      expect(started.value.task.state).toBe("queued");
    } else {
      throw new Error("expected a demo task");
    }

    const cancelled = await routeDesktopGatewayInvoke(
      { provider: gated, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-6",
        method: "task.requestCancellation",
        params: { taskId: "demo-1", commandId: "cancel-1" },
      },
    );
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok && "outcome" in cancelled.value) {
      expect(cancelled.value.outcome).toBe("requested");
    } else {
      throw new Error("expected a cancellation result");
    }
  });

  it("routes environment.getSnapshot and returns the presence snapshot", async () => {
    const provider = new MockOrchestratorProviderV01({
      environment: {
        contractVersion: "0.1",
        revision: 1,
        capturedAt: "2026-09-04T00:00:00.000Z",
        items: [{
          checkId: "steam",
          zone: "play",
          presence: "not_detected",
          facts: {},
        }],
      },
    });
    await provider.start();

    const response = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-7", method: "environment.getSnapshot", params: {} },
    );

    expect(response.ok).toBe(true);
    if (response.ok && "items" in response.value) {
      expect(response.value.items).toHaveLength(1);
      expect(response.value.items[0]?.presence).toBe("not_detected");
    } else {
      throw new Error("expected an environment snapshot");
    }
  });

  it("routes overlay.getSnapshot verbatim and passes the typed absence through (017 batch 1)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // mock 未接线 overlay 生产读面:诚实不可用照原样透传(不折叠不伪装)
    const unavailable = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-8", method: "overlay.getSnapshot", params: {} },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-8",
      correlationId: "desktop-request-8",
      kind: "query",
      method: "overlay.getSnapshot",
      params: {},
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.overlay.unavailable" } },
    });

    // 非空 params 在信封守卫即拒(闭集空)
    const invalidParams = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-9", method: "overlay.getSnapshot", params: { taskId: "x" } },
    );
    expect(invalidParams).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});

describe("inspection-queries v0.1 routing (M7 消费批)", () => {
  const INSP_ID = "01982b5a-3f10-7c4e-9d2a-4b8e1f6a7c21";

  it("routes inspection.get with the identity param and passes the typed absence through", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // mock 未配置检查域:诚实不可用照原样透传(不折叠不伪装)
    const unavailable = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-insp-1", method: "inspection.get", params: { inspectionId: INSP_ID } },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-insp-1",
      correlationId: "desktop-request-insp-1",
      kind: "query",
      method: "inspection.get",
      params: { inspectionId: INSP_ID },
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.inspection.unavailable" } },
    });
  });

  it("routes inspection.list with verbatim optional params and rejects unknown keys at the guard", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const unavailable = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-insp-2",
        method: "inspection.list",
        params: { avatarRef: "warehouse:booth-item-1001", overallStatus: "fail", limit: 50, offset: 0 },
      },
    );
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "query", method: "inspection.list" }),
    );
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.inspection.unavailable" } },
    });

    // 词表外过滤键在信封守卫即拒(闭集:avatarRef/overallStatus/limit/offset)
    const invalidParams = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-insp-3", method: "inspection.list", params: { text: "fuzzy" } },
    );
    expect(invalidParams).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});

describe("release-handoff v0.2 inspection routing (U19 桌面对齐批)", () => {
  const BUILD_ID = "019513e7-7a2b-7cd1-9f3a-4d8e21b90c99";

  it("routes release.openForInspection as a tasked command with the requestId-commandId and passes the typed absence through", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // mock 无构建记录面/产线进程窗口面:vua.release_handoff.unavailable
    // 诚实缺席照原样透传(不折叠不伪装;检视路由与交棒同缺席语义)
    const unavailable = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-insp-open-1", method: "release.openForInspection", params: { buildId: BUILD_ID } },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-insp-open-1",
      correlationId: "desktop-request-insp-open-1",
      kind: "command",
      method: "release.openForInspection",
      commandId: "desktop-request-insp-open-1",
      params: { buildId: BUILD_ID },
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.release_handoff.unavailable" } },
    });
  });

  it("rejects word-list escape params and empty buildId at the envelope guard", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const extraKey = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-insp-open-2",
        method: "release.openForInspection",
        params: { buildId: BUILD_ID, projectPath: "C:/VRChat/Projects/Chiffon" },
      } as unknown as { schemaVersion: 1; requestId: string; method: string; params: Record<string, string> },
    );
    expect(extraKey).toMatchObject({ ok: false, error: { code: "invalid_request" } });

    const emptyId = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-request-insp-open-3", method: "release.openForInspection", params: { buildId: "" } },
    );
    expect(emptyId).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("packages-ops v0.1 A1 removal routing (026 消费批)", () => {
  it("routes packages.previewRemove verbatim (query; array copied verbatim) and passes the typed absence through", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const unavailable = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-rmv-1",
        method: "packages.previewRemove",
        params: { projectPath: "C:/VRChat/Projects/Chiffon", packageIds: ["com.vrchat.avatars"] },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-rmv-1",
      correlationId: "desktop-request-rmv-1",
      kind: "query",
      method: "packages.previewRemove",
      params: { projectPath: "C:/VRChat/Projects/Chiffon", packageIds: ["com.vrchat.avatars"] },
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.packages.unavailable" } },
    });
  });

  it("routes packages.applyRemove as a tasked command with a Kernel-generated rmv- commandId (import-copy same shape)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-rmv-2",
        method: "packages.applyRemove",
        params: { projectPath: "C:/VRChat/Projects/Chiffon", packageIds: ["com.vrchat.avatars"], confirmedDigest: "fnv-1a-abc" },
      },
    );
    const call = invoke.mock.calls[0]?.[0] as { kind: string; method: string; commandId: string; params: Record<string, unknown> };
    expect(call.kind).toBe("command");
    expect(call.method).toBe("packages.applyRemove");
    expect(call.commandId.startsWith("rmv-")).toBe(true);
    expect(call.params).toEqual({
      projectPath: "C:/VRChat/Projects/Chiffon",
      packageIds: ["com.vrchat.avatars"],
      confirmedDigest: "fnv-1a-abc",
    });
  });

  it("rejects the preview carrying a digest slot and apply without the digest at the envelope guard", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // preview 参数无 digest 位(冻结词面:携即形状违反)
    const digestSlot = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-rmv-3",
        method: "packages.previewRemove",
        params: { projectPath: "C:/x", packageIds: ["com.a.b"], confirmedDigest: "fnv-1a-abc" },
      },
    );
    expect(digestSlot).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    // apply 缺 confirmedDigest:信封守卫即拒
    const missingDigest = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-rmv-4",
        method: "packages.applyRemove",
        params: { projectPath: "C:/x", packageIds: ["com.a.b"] },
      },
    );
    expect(missingDigest).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("packages-ops v0.2 A2 install routing (026 消费批)", () => {
  it("routes packages.previewInstall verbatim (query; request rows copied verbatim) and passes the typed absence through", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const unavailable = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-inst-1",
        method: "packages.previewInstall",
        params: {
          projectPath: "C:/VRChat/Projects/Chiffon",
          packages: [{ packageId: "com.vrchat.avatars", version: null }],
        },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-inst-1",
      correlationId: "desktop-request-inst-1",
      kind: "query",
      method: "packages.previewInstall",
      params: {
        projectPath: "C:/VRChat/Projects/Chiffon",
        packages: [{ packageId: "com.vrchat.avatars", version: null }],
      },
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.packages.unavailable" } },
    });
  });

  it("routes packages.applyInstall as a tasked command with a Kernel-generated inst- commandId (applyRemove same shape)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-inst-2",
        method: "packages.applyInstall",
        params: {
          projectPath: "C:/VRChat/Projects/Chiffon",
          packages: [{ packageId: "com.vrchat.avatars", version: null }],
          confirmedDigest: "fnv-1a-abc",
        },
      },
    );
    const call = invoke.mock.calls[0]?.[0] as { kind: string; method: string; commandId: string; params: Record<string, unknown> };
    expect(call.kind).toBe("command");
    expect(call.method).toBe("packages.applyInstall");
    expect(call.commandId.startsWith("inst-")).toBe(true);
    expect(call.params).toEqual({
      projectPath: "C:/VRChat/Projects/Chiffon",
      packages: [{ packageId: "com.vrchat.avatars", version: null }],
      confirmedDigest: "fnv-1a-abc",
    });
  });

  it("rejects the preview carrying a digest slot, apply without the digest, and repeated request-row ids at the envelope guard", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // preview 参数无 digest 位(冻结词面:携即形状违反)
    const digestSlot = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-inst-3",
        method: "packages.previewInstall",
        params: {
          projectPath: "C:/x",
          packages: [{ packageId: "com.a.b", version: null }],
          confirmedDigest: "fnv-1a-abc",
        },
      },
    );
    expect(digestSlot).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    // apply 缺 confirmedDigest:信封守卫即拒
    const missingDigest = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-inst-4",
        method: "packages.applyInstall",
        params: { projectPath: "C:/x", packages: [{ packageId: "com.a.b", version: null }] },
      },
    );
    expect(missingDigest).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    // 同 id 异版本(行间 id 唯一):信封守卫即拒(钉法收口口径,TS 层钉死)
    const repeatedId = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-inst-5",
        method: "packages.previewInstall",
        params: {
          projectPath: "C:/x",
          packages: [{ packageId: "com.a.b", version: null }, { packageId: "com.a.b", version: "3.1.4" }],
        },
      },
    );
    expect(repeatedId).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("routes packages.registerLocalPackage as a tasked command with a Kernel-generated reg- commandId and the verbatim packageRoot (026 A3; the family's only face without a preview arm), and rejects carried digest/projectPath slots at the envelope guard", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-reg-1",
        method: "packages.registerLocalPackage",
        params: { packageRoot: "C:/LocalPackages/com.a.b-1.0.0" },
      },
    );
    const call = invoke.mock.calls[0]?.[0] as { kind: string; method: string; commandId: string; params: Record<string, unknown> };
    expect(call.kind).toBe("command");
    expect(call.method).toBe("packages.registerLocalPackage");
    expect(call.commandId.startsWith("reg-")).toBe(true);
    expect(call.params).toEqual({ packageRoot: "C:/LocalPackages/com.a.b-1.0.0" });

    // 发明 projectPath 位(注册不触项目)与携 digest 位(本面无 preview 可
    // 漂移,携即形状违反):信封守卫即拒,绝不进任务
    const carriedProjectPath = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-reg-2",
        method: "packages.registerLocalPackage",
        params: { packageRoot: "C:/LocalPackages/com.a.b-1.0.0", projectPath: "C:/x" },
      },
    );
    expect(carriedProjectPath).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    const carriedDigest = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-reg-3",
        method: "packages.registerLocalPackage",
        params: { packageRoot: "C:/LocalPackages/com.a.b-1.0.0", confirmedDigest: "fnv-1a-abc" },
      },
    );
    expect(carriedDigest).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("routes the A4 repo write trio as tasked commands with Kernel-generated repo- commandIds and verbatim closed params, and rejects carried digest/projectPath slots at the envelope guard (026 A4; the face breaks the preview/apply pair per the A3 law - the user's explicit submission IS the confirmation)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-repo-1",
        method: "packages.addRemoteRepo",
        params: { url: "https://vpm.example/index.json", name: "Example Repo" },
      },
    );
    const addRemote = invoke.mock.calls[0]?.[0] as { kind: string; method: string; commandId: string; params: Record<string, unknown> };
    expect(addRemote.kind).toBe("command");
    expect(addRemote.method).toBe("packages.addRemoteRepo");
    expect(addRemote.commandId.startsWith("repo-")).toBe(true);
    expect(addRemote.params).toEqual({ url: "https://vpm.example/index.json", name: "Example Repo" });

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-repo-2",
        method: "packages.addLocalRepo",
        params: { path: "C:/Repos/local-curations", name: "Local Curations" },
      },
    );
    const addLocal = invoke.mock.calls[1]?.[0] as { kind: string; method: string; commandId: string; params: Record<string, unknown> };
    expect(addLocal.method).toBe("packages.addLocalRepo");
    expect(addLocal.commandId.startsWith("repo-")).toBe(true);
    expect(addLocal.params).toEqual({ path: "C:/Repos/local-curations", name: "Local Curations" });

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-repo-3",
        method: "packages.removeRepo",
        params: { repoId: "repo-example" },
      },
    );
    const remove = invoke.mock.calls[2]?.[0] as { kind: string; method: string; commandId: string; params: Record<string, unknown> };
    expect(remove.method).toBe("packages.removeRepo");
    expect(remove.commandId.startsWith("repo-")).toBe(true);
    expect(remove.params).toEqual({ repoId: "repo-example" });

    // 发明 projectPath 位(订阅面不触项目)与携 digest 位(本面无 preview
    // 可漂移,携即形状违反——负例 invalid-add-remote-carries-digest 同形):
    // 信封守卫即拒,绝不进任务
    const carriedProjectPath = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-repo-4",
        method: "packages.addRemoteRepo",
        params: { url: "https://vpm.example/index.json", name: "Example Repo", projectPath: "C:/x" },
      },
    );
    expect(carriedProjectPath).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    const carriedDigest = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-repo-5",
        method: "packages.removeRepo",
        params: { repoId: "repo-example", confirmedDigest: "fnv-1a-abc" },
      },
    );
    expect(carriedDigest).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("routes packages.createProject as a tasked command with a Kernel-generated create- commandId and verbatim three-key params (template REQUIRED-nullable passthrough), and rejects carried digest/projectPath/empty-template shapes at the envelope guard (026 A5; single-stage task rooted in the port - the user's explicit form submission IS the confirmation; creation addresses no registered project)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-create-1",
        method: "packages.createProject",
        params: { parent: "C:/Users/me/VRC projects", name: "New World", template: null },
      },
    );
    const created = invoke.mock.calls[0]?.[0] as { kind: string; method: string; commandId: string; params: Record<string, unknown> };
    expect(created.kind).toBe("command");
    expect(created.method).toBe("packages.createProject");
    expect(created.commandId.startsWith("create-")).toBe(true);
    expect(created.params).toEqual({ parent: "C:/Users/me/VRC projects", name: "New World", template: null });

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-create-2",
        method: "packages.createProject",
        params: { parent: "C:/Users/me/VRC projects", name: "New Avatar", template: "Avatar" },
      },
    );
    const createdWithTemplate = invoke.mock.calls[1]?.[0] as { commandId: string; params: Record<string, unknown> };
    expect(createdWithTemplate.commandId.startsWith("create-")).toBe(true);
    expect(createdWithTemplate.params).toEqual({ parent: "C:/Users/me/VRC projects", name: "New Avatar", template: "Avatar" });

    // 发明 projectPath 位(创建不寻址任何在册项目,013 复用不适用)/携
    // digest 位(本面无 preview 可漂移,携即形状违反)/空 template(词面
    // REQUIRED-nullable:空串 = 形状违反):信封守卫即拒,绝不进任务
    const carriedProjectPath = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-create-3",
        method: "packages.createProject",
        params: { parent: "C:/p", name: "New World", template: null, projectPath: "C:/proj" },
      },
    );
    expect(carriedProjectPath).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    const carriedDigest = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-create-4",
        method: "packages.createProject",
        params: { parent: "C:/p", name: "New World", template: null, confirmedDigest: "fnv-1a-abc" },
      },
    );
    expect(carriedDigest).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    const emptyTemplate = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-create-5",
        method: "packages.createProject",
        params: { parent: "C:/p", name: "New World", template: "" },
      },
    );
    expect(emptyTemplate).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe("packages-query v0.1 routing (024 P1 消费批)", () => {
  it("routes packages.listInstalled verbatim and passes the typed absence through", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // mock 未装配包引擎:vua.packages.unavailable 诚实缺席照原样透传
    const unavailable = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-1",
        method: "packages.listInstalled",
        params: { projectPath: "C:/VRChat/Projects/Chiffon" },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-pkg-1",
      correlationId: "desktop-request-pkg-1",
      kind: "query",
      method: "packages.listInstalled",
      params: { projectPath: "C:/VRChat/Projects/Chiffon" },
    });
    expect(unavailable).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.packages.unavailable" } },
    });
  });

  it("rejects word-list-escape params at the envelope guard (closed single key)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // 词表外键在信封守卫即拒(闭集单键 projectPath;投机 projectId 拒绝)
    const invalidParams = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-2",
        method: "packages.listInstalled",
        params: { projectPath: "C:/x", projectId: "p-1" },
      },
    );
    expect(invalidParams).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("routes the 025 P2 read faces verbatim and passes the typed absence through", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // listRepos:空闭集 params verbatim(mock 无 VpmBackend →
    // vua.packages.unavailable 诚实缺席照原样透传)
    const repos = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-3",
        method: "packages.listRepos",
        params: {},
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-pkg-3",
      correlationId: "desktop-request-pkg-3",
      kind: "query",
      method: "packages.listRepos",
      params: {},
    });
    expect(repos).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.packages.unavailable" } },
    });

    // packageCatalog:双键闭集 verbatim
    const catalog = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-4",
        method: "packages.packageCatalog",
        params: { projectPath: "C:/VRChat/Projects/Chiffon", packageId: "com.anatawa12.avatar-optimizer" },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-pkg-4",
      correlationId: "desktop-request-pkg-4",
      kind: "query",
      method: "packages.packageCatalog",
      params: { projectPath: "C:/VRChat/Projects/Chiffon", packageId: "com.anatawa12.avatar-optimizer" },
    });
    expect(catalog).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.packages.unavailable" } },
    });
  });

  it("rejects 025 P2 word-list-escape params at the envelope guard (empty closed set / two-key closed set)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // listRepos:全局配置面,任何键在信封守卫即拒
    const reposExtraKey = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-5",
        method: "packages.listRepos",
        params: { projectPath: "C:/x" },
      },
    );
    expect(reposExtraKey).toMatchObject({ ok: false, error: { code: "invalid_request" } });

    // packageCatalog:投机 includePrerelease(词面外零 wire 开关)拒绝
    const catalogExtraKey = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-6",
        method: "packages.packageCatalog",
        params: { projectPath: "C:/x", packageId: "com.a.b", includePrerelease: true },
      },
    );
    expect(catalogExtraKey).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("routes the 027 F5 template enumeration verbatim and rejects word-list-escape params (empty closed set)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    // listTemplates:空闭集 params verbatim(mock 无模板能力 →
    // vua.vpm.capability_missing 诚实缺席照原样透传;mock 未实现该方法时
    // 走通用 application 错误面,分发形状仍逐字可断言)
    const templates = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-tpl-1",
        method: "packages.listTemplates",
        params: {},
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-request-pkg-tpl-1",
      correlationId: "desktop-request-pkg-tpl-1",
      kind: "query",
      method: "packages.listTemplates",
      params: {},
    });
    expect(templates.ok).toBe(false);

    // 空闭集:任何键在信封守卫即拒(词表外键零 wire 开销)
    const templatesExtraKey = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-pkg-tpl-2",
        method: "packages.listTemplates",
        params: { projectPath: "C:/x" },
      },
    );
    expect(templatesExtraKey).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("bdl-queries v0.2 routing", () => {
  it("routes the five read-only queries through to the provider verbatim", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const listResponse = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.2", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-catalog-list",
        method: "catalog.list",
        params: { text: "uniform", availabilityStatus: "available", limit: 20, offset: 0 },
      },
    );

    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-catalog-list",
      correlationId: "desktop-catalog-list",
      kind: "query",
      method: "catalog.list",
      params: { text: "uniform", availabilityStatus: "available", limit: 20, offset: 0 },
    });
    expect(listResponse).toMatchObject({
      ok: true,
      // bdl-queries v0.4 冻结 wire 信封(核心 63f652e mock 回正的机械跟随,
      // 2026-09-18):三键 {schemaVersion, operation, result},内层 result 才是
      // 结果本体;平铺断言随 mock 回正一并退役(#22 live/fixture 形状一致)
      value: {
        schemaVersion: "0.5",
        operation: "catalog.list",
        result: { total: 0, entries: [] },
      },
    });

    const statusResponse = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.2", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      { schemaVersion: 1, requestId: "desktop-catalog-status", method: "catalog.status", params: {} },
    );
    expect(statusResponse).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "0.5",
        operation: "catalog.status",
        result: { health: "unknown", revision: { catalogUpdatedSeq: null, datasetRevision: "0.1" } },
      },
    });

    const detailResponse = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.2", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-catalog-detail",
        method: "catalog.detail",
        params: { productId: "booth:404" },
      },
    );
    expect(detailResponse).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.catalog.product_not_found" } },
    });

    const entryResponse = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.2", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-entry-detail",
        method: "warehouse.entryDetail",
        params: { warehouseItemId: "wh-1" },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-entry-detail",
      correlationId: "desktop-entry-detail",
      kind: "query",
      method: "warehouse.entryDetail",
      params: { warehouseItemId: "wh-1" },
    });
    expect(entryResponse).toMatchObject({
      ok: false,
      // mock-provider 对齐(核心复核 2026-09-08):真实 provider(10325cd)对
      // entryDetail 未命中回既有冻结码 entry_not_found,非旧 not_found 字面量
      error: { code: "application", application: { code: "vua.warehouse.entry_not_found" } },
    });
  });

  it("rejects entity filters at the envelope before the provider is invoked", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const response = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.2", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-entity-filter",
        method: "catalog.list",
        params: { entityType: "avatar" },
      },
    );

    expect(response).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("amf-production v0.2 routing", () => {
  const quad = {
    sourceFolder: "C:/materials/source",
    projectRoot: "C:/projects/target",
    artifactOutputRoot: "C:/artifacts",
    projectId: "vua-m3-synthetic-avatar",
  };

  function productionContext(provider: DesktopGatewayRouteContext["provider"]): DesktopGatewayRouteContext {
    return {
      provider,
      productVersion: "0.6.0",
      platform: "win32",
      rendererUrl,
      resolveMaterialSource: (refId) => (refId === "mat-1" ? quad : undefined),
    };
  }

  it("translates startInspection into the one-time production context handover", async () => {
    const provider = new MockOrchestratorProviderV01({
      capabilities: [{ operationId: "production.useCase", availability: "available" }],
    });
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const response = await routeDesktopGatewayInvoke(
      productionContext(provider),
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-start-1",
        method: "production.startInspection",
        params: { materialRefId: "mat-1", commandId: "command-1" },
      },
    );

    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      kind: "command",
      method: "production.startInspection",
      commandId: "command-1",
      // 四元组随应用请求一次性转交;渲染层只有 refId
      params: quad,
    }));

    const unknown = await routeDesktopGatewayInvoke(
      productionContext(provider),
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-start-2",
        method: "production.startInspection",
        params: { materialRefId: "mat-missing", commandId: "command-2" },
      },
    );
    expect(unknown).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.material.source_unknown" } },
    });
  });

  it("passes requestPlan mode and confirmPlan risk decision through verbatim", async () => {
    const provider = new MockOrchestratorProviderV01({
      capabilities: [{ operationId: "production.useCase", availability: "available" }],
    });
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    await routeDesktopGatewayInvoke(
      productionContext(provider),
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-plan-1",
        method: "production.requestPlan",
        params: {
          inspectionId: "insp-0123456789abcdef",
          commandId: "command-plan",
          mode: "local_reusable_vpm",
        },
      },
    );
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({
      method: "production.requestPlan",
      params: { inspectionId: "insp-0123456789abcdef", mode: "local_reusable_vpm" },
    }));

    await routeDesktopGatewayInvoke(
      productionContext(provider),
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-confirm-1",
        method: "production.confirmPlan",
        params: {
          planId: "plan-0123456789abcdef",
          commandId: "command-confirm",
          observedRevision: 3,
          riskChoice: "snapshot_and_continue",
          rememberForSession: true,
        },
      },
    );
    expect(invoke).toHaveBeenLastCalledWith(expect.objectContaining({
      method: "production.confirmPlan",
      params: {
        planId: "plan-0123456789abcdef",
        observedRevision: 3,
        riskChoice: "snapshot_and_continue",
        rememberForSession: true,
      },
    }));
  });

  it("generates the recover decisionId in the Kernel and never accepts renderer paths", async () => {
    const provider = new MockOrchestratorProviderV01({
      capabilities: [{ operationId: "production.useCase", availability: "available" }],
    });
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const response = await routeDesktopGatewayInvoke(
      productionContext(provider),
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-recover-1",
        method: "production.recover",
        params: {
          taskId: "task-failed-1",
          decision: "rollback",
          commandId: "command-recover",
        },
      },
    );

    // 本测试只锁 Kernel 翻译(任务不存在时 mock 的应用错误与本翻译无关)
    const application = invoke.mock.calls.at(-1)?.[0] as {
      method: string;
      params: { decisionId: string; taskId: string; decision: string };
    };
    expect(application.method).toBe("production.recover");
    expect(application.params.taskId).toBe("task-failed-1");
    expect(application.params.decision).toBe("rollback");
    // 用户决定 ID 是 Kernel 侧授权事实:受理时生成并绑定,渲染层不可见
    expect(application.params.decisionId).toMatch(/^udid-/);
    expect(response.ok).toBe(false);

    // 信封守卫:v0.2 recover 面不再接受渲染层携带路径/风险选择等权威字段
    const stale = await routeDesktopGatewayInvoke(
      productionContext(provider),
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-recover-2",
        method: "production.recover",
        params: {
          taskId: "task-failed-1",
          decision: "rollback",
          commandId: "command-recover-2",
          sourceFolder: "C:/renderer-supplied",
        },
      },
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });
});

describe("bdl-commands v0.1 command routing", () => {
  it("routes the three warehouse write commands with commandId mapping", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    // provider-host 路由由核心登记(proposal 005);本测试锁映射与透传,
    // 不依赖 provider 对写命令的真实处置
    const invoke = vi.spyOn(provider, "invoke").mockResolvedValue({
      ok: true,
      value: { warehouseItemId: "wh-1", effectiveMode: "use_original_unitypackage" },
    });
    const context = { provider, productVersion: "0.4.2", platform: "win32" as const, rendererUrl };

    const modeResponse = await routeDesktopGatewayInvoke(
      context,
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-wh-mode",
        method: "warehouse.setArtifactMode",
        params: { warehouseItemId: "wh-1", mode: null, commandId: "cmd-1" },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-wh-mode",
      correlationId: "desktop-wh-mode",
      kind: "command",
      method: "warehouse.setArtifactMode",
      commandId: "cmd-1",
      params: { warehouseItemId: "wh-1", mode: null },
    });
    expect(modeResponse).toMatchObject({
      ok: true,
      value: { warehouseItemId: "wh-1", effectiveMode: "use_original_unitypackage" },
    });

    await routeDesktopGatewayInvoke(
      context,
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-wh-vpm",
        method: "warehouse.generateVpm",
        params: { warehouseItemId: "wh-1", commandId: "cmd-2" },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-wh-vpm",
      correlationId: "desktop-wh-vpm",
      kind: "command",
      method: "warehouse.generateVpm",
      commandId: "cmd-2",
      params: { warehouseItemId: "wh-1" },
    });

    await routeDesktopGatewayInvoke(
      context,
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-wh-del",
        method: "warehouse.deleteOriginals",
        params: { warehouseItemId: "wh-1", commandId: "cmd-3" },
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-wh-del",
      correlationId: "desktop-wh-del",
      kind: "command",
      method: "warehouse.deleteOriginals",
      commandId: "cmd-3",
      params: { warehouseItemId: "wh-1" },
    });
  });

  it("routes the v0.4 download-adoption command with identity-only params", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke").mockResolvedValue({
      ok: true,
      value: { taskId: "task-1", correlationId: "corr-1" },
    });
    const context = { provider, productVersion: "0.4.2", platform: "win32" as const, rendererUrl };

    const response = await routeDesktopGatewayInvoke(
      context,
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-wh-downloads",
        method: "warehouse.importDownloads",
        params: { downloadIds: ["dl-1", "dl-2"], commandId: "cmd-dl-1" },
      },
    );
    // 仅身份透传(路径/大小/文件名是服务端事实,永不经渲染层)
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-wh-downloads",
      correlationId: "desktop-wh-downloads",
      kind: "command",
      method: "warehouse.importDownloads",
      commandId: "cmd-dl-1",
      params: { downloadIds: ["dl-1", "dl-2"] },
    });
    expect(response).toMatchObject({ ok: true, value: { taskId: "task-1", correlationId: "corr-1" } });
  });

  it("routes the 013 environmentManagers read query verbatim", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke").mockResolvedValue({
      ok: true,
      value: { schemaVersion: "vua.environment-managers-snapshot/v0.1" },
    });
    const context = { provider, productVersion: "0.4.2", platform: "win32" as const, rendererUrl };

    const response = await routeDesktopGatewayInvoke(
      context,
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-proj-em",
        method: "project.environmentManagers",
        params: {},
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-proj-em",
      correlationId: "desktop-proj-em",
      kind: "query",
      method: "project.environmentManagers",
      params: {},
    });
    expect(response).toMatchObject({
      ok: true,
      value: { schemaVersion: "vua.environment-managers-snapshot/v0.1" },
    });
  });

  it("routes the v0.4 completed-downloads read query verbatim", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke").mockResolvedValue({
      ok: true,
      // mock 与 live wire 同形(三键信封,#22 形状一致纪律,2026-09-18 跟随):
      // 本用例钉的是路由原样透传——信封进、信封出,不解包不加工
      value: {
        schemaVersion: "0.5",
        operation: "downloads.listCompleted",
        result: { downloads: [] },
      },
    });
    const context = { provider, productVersion: "0.4.2", platform: "win32" as const, rendererUrl };

    const response = await routeDesktopGatewayInvoke(
      context,
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-dl-list",
        method: "downloads.listCompleted",
        params: {},
      },
    );
    expect(invoke).toHaveBeenCalledWith({
      contractVersion: "0.1",
      requestId: "desktop-dl-list",
      correlationId: "desktop-dl-list",
      kind: "query",
      method: "downloads.listCompleted",
      params: {},
    });
    expect(response).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "0.5",
        operation: "downloads.listCompleted",
        result: { downloads: [] },
      },
    });
  });

  it("routes the v0.2 setNote command with a Kernel-generated commandId (guard positive example)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi
      .spyOn(provider, "invoke")
      .mockResolvedValue({ ok: true, value: { taskId: "t-1", correlationId: "c-1" } });
    const context = { provider, productVersion: "0.4.2", platform: "win32" as const, rendererUrl };

    const response = await routeDesktopGatewayInvoke(
      context,
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-note-1",
        method: "project.setNote",
        params: { projectPath: "C:/projects/demo", note: "亚洲字符补位备注" },
      },
    );
    const call = invoke.mock.calls[0]?.[0] as { commandId?: string; method?: string; kind?: string };
    expect(call.method).toBe("project.setNote");
    expect(call.kind).toBe("command");
    // commandId 由 Kernel 生成(note- 前缀惯例),不透传渲染层值
    expect(call.commandId).toMatch(/^note-/);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "command",
        method: "project.setNote",
        params: { projectPath: "C:/projects/demo", note: "亚洲字符补位备注" },
      }),
    );
    expect(response).toMatchObject({ ok: true, value: { taskId: "t-1" } });

    // 信封守卫负例:null 清除合法;换行 note / 空 note / 多余键拒绝
    const invokeAgain = async (params: unknown) =>
      routeDesktopGatewayInvoke(
        context,
        `${rendererUrl}/`,
        { schemaVersion: 1, requestId: "desktop-note-2", method: "project.setNote", params },
      );
    const clearOk = await invokeAgain({ projectPath: "C:/projects/demo", note: null });
    expect(clearOk.ok).toBe(true);
    const newlineNote = await invokeAgain({ projectPath: "C:/projects/demo", note: "a\nb" });
    expect(newlineNote.ok).toBe(false);
    const emptyNote = await invokeAgain({ projectPath: "C:/projects/demo", note: "" });
    expect(emptyNote.ok).toBe(false);
    const extraKey = await invokeAgain({ projectPath: "C:/projects/demo", note: null, extra: 1 });
    expect(extraKey.ok).toBe(false);
  });
});

describe("packages-ops v0.6 F4 repo lifecycle routing (027 消费批)", () => {
  it("routes the three lifecycle methods as tasked commands with Kernel-generated lifecycle- commandIds and verbatim single-key {repoId} params, and rejects carried digest/projectPath/extra-key/empty-repoId shapes at the envelope guard (word-list escape costs zero wire overhead)", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    for (const [index, method] of [
      "packages.enableRepo",
      "packages.disableRepo",
      "packages.refreshRepo",
    ].entries()) {
      await routeDesktopGatewayInvoke(
        { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
        `${rendererUrl}/`,
        {
          schemaVersion: 1,
          requestId: `desktop-request-lifecycle-${index}`,
          method,
          params: { repoId: "repo-example" },
        },
      );
      const translated = invoke.mock.calls[index]?.[0] as {
        kind: string;
        method: string;
        commandId: string;
        params: Record<string, unknown>;
      };
      expect(translated.kind).toBe("command");
      expect(translated.method).toBe(method);
      expect(translated.commandId.startsWith("lifecycle-")).toBe(true);
      expect(translated.params).toEqual({ repoId: "repo-example" });
    }
    expect(invoke).toHaveBeenCalledTimes(3);

    // 携 confirmedDigest(无 preview 臂——启停 diff 无既有摘要、刷新即网
    // 络本体)/携 projectPath(生命周期面只寻址订阅行)/发明额外键/空
    // repoId(词面 minLength 1):信封守卫即拒,绝不进任务
    const carriedDigest = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-lifecycle-9",
        method: "packages.refreshRepo",
        params: { repoId: "repo-example", confirmedDigest: "fnv-1a-abc" },
      },
    );
    expect(carriedDigest).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    const carriedProjectPath = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-lifecycle-10",
        method: "packages.disableRepo",
        params: { repoId: "repo-example", projectPath: "C:/proj" },
      },
    );
    expect(carriedProjectPath).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    const emptyRepoId = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-lifecycle-11",
        method: "packages.enableRepo",
        params: { repoId: "" },
      },
    );
    expect(emptyRepoId).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});

// bdl-queries v0.5(桌面消费准备切片 2026-09-22):两方法只读 verbatim
// 透传,零折叠——查询闭集由信封守卫验证;核心接线批升信封常量与路由臂前,
// provider(mock 缺席臂)答类型化 vua.catalog.unavailable 诚实缺席,原样
// 透传不折叠(缺席语义不折叠,recipe.exportProjectDraft 先例同律)。
describe("bdl-queries v0.5 routing (dependencies.lookup / dependencies.listByProduct)", () => {
  it("routes both read-only queries verbatim and passes the typed absence through", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");

    const lookup = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-dep-1",
        method: "dependencies.lookup",
        params: { name: "lilToon", depKind: null, limit: 50, offset: 0 },
      },
    );
    expect(invoke).toHaveBeenNthCalledWith(1, {
      contractVersion: "0.1",
      requestId: "desktop-request-dep-1",
      correlationId: "desktop-request-dep-1",
      kind: "query",
      method: "dependencies.lookup",
      params: { name: "lilToon", depKind: null, limit: 50, offset: 0 },
    });
    expect(lookup).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.catalog.unavailable" } },
    });

    const listByProduct = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-dep-2",
        method: "dependencies.listByProduct",
        params: { productId: "booth:6584744" },
      },
    );
    expect(invoke).toHaveBeenNthCalledWith(2, {
      contractVersion: "0.1",
      requestId: "desktop-request-dep-2",
      correlationId: "desktop-request-dep-2",
      kind: "query",
      method: "dependencies.listByProduct",
      params: { productId: "booth:6584744" },
    });
    expect(listByProduct).toMatchObject({
      ok: false,
      error: { code: "application", application: { code: "vua.catalog.unavailable" } },
    });

    // 词表外键在信封守卫即拒(fuzzy 等价开关 = 冻结负例向量钉死)
    const fuzzy = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-dep-3",
        method: "dependencies.lookup",
        params: { name: "lilToon", fuzzy: true },
      },
    );
    expect(fuzzy).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    // listByProduct 客户端过滤 = 契约错误(信封守卫即拒,绝不静默空答)
    const filtered = await routeDesktopGatewayInvoke(
      { provider, productVersion: "0.4.1", platform: "win32", rendererUrl },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "desktop-request-dep-4",
        method: "dependencies.listByProduct",
        params: { productId: "booth:6584744", depKind: "shader" },
      },
    );
    expect(filtered).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

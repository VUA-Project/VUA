/**
 * Overlay live 端口测试(017 表面批 1 消费接线;批 2 下载卡增量):以假
 * GatewayClient 驱动四类事实:
 * - ok 回执 → available 快照原样透传(任务卡/生产卡;downloadCard 携带则
 *   透传、批 1 世代缺席则向后兼容);
 * - vua.overlay.unavailable → unavailable 缺席快照(不伪装空数据);
 * - 其它应用错误/信封失败 → reject(表面呈现失败+重试);
 * - dispatch(request_cancel_task) → 走既有命令面 task.requestCancellation,
 *   回执后重取快照;not_found → rejected。
 * - 订阅:事件到达重取快照;退订(无订阅者)即停事件重取(按需轮询,不常驻)。
 */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type {
  ApplicationEventV01,
  DesktopGatewayRequestV1,
  DesktopGatewaySuccessValueV1,
  AmfModuleApiV01,
  AmfModuleSnapshotV01,
} from "@vua/contracts";
import { createGatewayClient, type DesktopGatewayHost, type GatewayClient } from "../../gateway/gateway-client.ts";
import { createHostOverlayPort, createLiveOverlayPort } from "./overlay-port-live.ts";

interface ScriptedResponse {
  readonly value?: DesktopGatewaySuccessValueV1;
  readonly applicationError?: { readonly code: string };
  readonly reject?: boolean;
}

/** 假宿主:按方法记录请求,按脚本逐次应答 */
function makeHost(script: Partial<Record<string, ScriptedResponse[]>>): {
  host: DesktopGatewayHost;
  requests: DesktopGatewayRequestV1[];
  emit: (event: ApplicationEventV01) => void;
} {
  const requests: DesktopGatewayRequestV1[] = [];
  const remaining = new Map<string, ScriptedResponse[]>(
    Object.entries(script).map(([method, responses]) => [method, [...(responses ?? [])]]),
  );
  const listeners = new Set<(event: ApplicationEventV01) => void>();
  return {
    requests,
    host: {
      gateway: {
        async invoke(request) {
          requests.push(request as DesktopGatewayRequestV1);
          const queue = remaining.get((request as DesktopGatewayRequestV1).method);
          const next = queue?.shift();
          if (next === undefined) {
            return { schemaVersion: 1, requestId: "x", ok: false, error: { code: "internal", messageKey: "errors.gateway.providerUnavailable" } };
          }
          if (next.reject === true) throw new Error("bridge down");
          if (next.applicationError !== undefined) {
            return {
              schemaVersion: 1,
              requestId: "x",
              ok: false,
              error: {
                code: "application",
                application: {
                  contractVersion: "0.1",
                  code: next.applicationError.code,
                  category: "unavailable",
                  messageKey: "errors.overlay.unavailable",
                  recoverable: true,
                  retryable: false,
                  correlationId: "c",
                },
              },
            };
          }
          return { schemaVersion: 1, requestId: "x", ok: true, value: next.value! };
        },
      },
      events: {
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
  };
}

const overlayResult: DesktopGatewaySuccessValueV1 = {
  contractVersion: "0.1",
  tasks: [{ taskId: "task-1", state: "running", correlationId: "c1" }],
  productionCard: {
    currentPlan: null,
    latestRecord: {
      buildId: "record-1",
      planId: "plan-1",
      status: "succeeded",
      finishedAt: "2026-09-13T00:05:00.000Z",
    },
  },
};

/** 017 批 2:wire 快照带 downloadCard 的世代 */
const overlayResultWithDownloadCard: DesktopGatewaySuccessValueV1 = {
  contractVersion: "0.1",
  tasks: [
    { taskId: "task-1", state: "running", correlationId: "c1" },
    { taskId: "dl-019e-a1", state: "running", correlationId: "c2" },
  ],
  productionCard: { currentPlan: null, latestRecord: null },
  downloadCard: {
    activeDownloads: [
      { downloadId: "dl-019e-a1", state: "running", updatedAt: "2026-09-16T01:30:00.000Z" },
    ],
  },
};

function makeEvent(kind: ApplicationEventV01["kind"]): ApplicationEventV01 {
  return {
    contractVersion: "0.1",
    eventId: `e-${Math.random()}`,
    taskId: "task-1",
    revision: 1,
    occurredAt: "2026-09-13T00:00:00.000Z",
    correlationId: "c1",
    kind,
    state: "running",
    payload: {},
  } as ApplicationEventV01;
}

function clientOf(host: DesktopGatewayHost): GatewayClient {
  return createGatewayClient(host);
}

const hostTasks: DesktopGatewaySuccessValueV1 = { contractVersion: "0.1", revision: 1, tasks: [{
  contractVersion: "0.1", taskId: "host-deployment", state: "succeeded", revision: 1,
  correlationId: "host", cancellationRequested: false, recoveryDisposition: "none", updatedAt: "2026-10-09T00:00:00Z",
}] };
function modulesWith(state: AmfModuleSnapshotV01["state"]): AmfModuleApiV01 {
  const snapshot: AmfModuleSnapshotV01 = { schemaVersion: "0.1", moduleId: "amf", installed: state !== "absent", state };
  return { snapshot: async () => snapshot, setEnabled: async () => ({ outcome: "failed", snapshot }), subscribe: () => () => {} };
}

describe("host task window independent of AMF", () => {
  for (const state of ["absent", "failed"] as const) test(`host tasks remain available with AMF ${state}`, async () => {
    const { host, requests } = makeHost({ "task.list": [{ value: hostTasks }] });
    const snapshot = await createHostOverlayPort(clientOf(host), modulesWith(state)).snapshot();
    assert.ok(snapshot.schemaVersion === 3 && snapshot.availability === "available");
    assert.equal(snapshot.amfUnavailable, state === "failed");
    assert.deepEqual(snapshot.tasks, [{ taskId: "host-deployment", state: "succeeded", correlationId: "host" }]);
    assert.equal(snapshot.productionCard, undefined);
    assert.deepEqual(requests.map(request => request.method), ["task.list"]);
  });
  test("AMF disconnect between readiness and its card query does not hide the host tasks", async () => {
    const { host } = makeHost({ "task.list": [{ value: hostTasks }], "overlay.getSnapshot": [{ reject: true }] });
    const snapshot = await createHostOverlayPort(clientOf(host), modulesWith("ready")).snapshot();
    assert.ok(snapshot.schemaVersion === 3 && snapshot.availability === "available");
    assert.equal(snapshot.tasks.length, 1);
    assert.equal(snapshot.productionCard, undefined);
    assert.equal(snapshot.amfUnavailable, true);
  });
});

describe("overlay live 端口(017 批 1 消费)", () => {
  test("ok 回执 → available 快照原样透传,查询词表为 overlay.getSnapshot 且空参", async () => {
    const { host, requests } = makeHost({ "overlay.getSnapshot": [{ value: overlayResult }] });
    const port = createLiveOverlayPort(clientOf(host));
    const snapshot = await port.snapshot();
    assert.equal(snapshot.availability, "available");
    assert.ok(snapshot.availability === "available");
    assert.deepEqual(snapshot.tasks, overlayResult.tasks);
    assert.deepEqual(snapshot.productionCard, overlayResult.productionCard);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "overlay.getSnapshot");
    assert.deepEqual(requests[0]?.params, {});
  });

  test("017 批 2 downloadCard:wire 携带则原样透传;批 1 世代无此字段则缺席(向后兼容)", async () => {
    const { host } = makeHost({
      "overlay.getSnapshot": [
        { value: overlayResultWithDownloadCard },
        { value: overlayResult },
      ],
    });
    const port = createLiveOverlayPort(clientOf(host));
    const withCard = await port.snapshot();
    assert.ok(withCard.availability === "available");
    assert.deepEqual(withCard.downloadCard, {
      activeDownloads: [
        { downloadId: "dl-019e-a1", state: "running", updatedAt: "2026-09-16T01:30:00.000Z" },
      ],
    });
    const legacy = await port.snapshot();
    assert.ok(legacy.availability === "available");
    assert.equal(legacy.downloadCard, undefined);
  });

  test("vua.overlay.unavailable → unavailable 缺席快照(诚实缺席,不 reject)", async () => {
    const { host } = makeHost({
      "overlay.getSnapshot": [{ applicationError: { code: "vua.overlay.unavailable" } }],
    });
    const port = createLiveOverlayPort(clientOf(host));
    const snapshot = await port.snapshot();
    assert.equal(snapshot.availability, "unavailable");
  });

  test("其它应用错误 → reject(表面呈现失败+重试,不折叠为缺席)", async () => {
    const { host } = makeHost({
      "overlay.getSnapshot": [{ applicationError: { code: "vua.overlay.store_failed" } }],
    });
    const port = createLiveOverlayPort(clientOf(host));
    await assert.rejects(port.snapshot());
  });

  test("传输失败 → reject", async () => {
    const { host } = makeHost({ "overlay.getSnapshot": [{ reject: true }] });
    const port = createLiveOverlayPort(clientOf(host));
    await assert.rejects(port.snapshot());
  });

  test("dispatch request_cancel_task:走 task.requestCancellation 既有命令面,回执后重取", async () => {
    const { host, requests } = makeHost({
      "overlay.getSnapshot": [{ value: overlayResult }],
      "task.requestCancellation": [{ value: {
        contractVersion: "0.1",
        taskId: "task-1",
        revision: 2,
        state: "running",
        outcome: "requested",
      } }],
    });
    const port = createLiveOverlayPort(clientOf(host));
    const result = await port.dispatch("request_cancel_task", { taskId: "task-1" });
    assert.equal(result.kind, "ok");
    // 顺序:先取消命令,后重取权威快照
    assert.equal(requests[0]?.method, "task.requestCancellation");
    assert.equal(requests[1]?.method, "overlay.getSnapshot");
    assert.deepEqual(requests[0]?.params, { taskId: "task-1", commandId: requests[0]?.params.commandId });
  });

  test("dispatch request_cancel_task 缺 taskId → rejected(不猜测目标)", async () => {
    const { host, requests } = makeHost({
      "overlay.getSnapshot": [{ value: overlayResult }],
    });
    const port = createLiveOverlayPort(clientOf(host));
    const result = await port.dispatch("request_cancel_task");
    assert.equal(result.kind, "rejected");
    assert.equal(result.reason, "action_not_allowed");
    assert.equal(requests.length, 1);
  });

  test("dispatch request_cancel_task 目标不存在(vua.task.not_found)→ rejected", async () => {
    const { host } = makeHost({
      "overlay.getSnapshot": [{ value: overlayResult }, { value: overlayResult }],
      "task.requestCancellation": [{ applicationError: { code: "vua.task.not_found" } }],
    });
    const port = createLiveOverlayPort(clientOf(host));
    const result = await port.dispatch("request_cancel_task", { taskId: "ghost" });
    assert.equal(result.kind, "rejected");
    assert.equal(result.reason, "action_not_allowed");
  });

  test("dispatch open_on_desktop → rejected(1.0.0 无 VR 传输路径);dismiss → ok", async () => {
    const { host } = makeHost({
      "overlay.getSnapshot": [{ value: overlayResult }, { value: overlayResult }],
    });
    const port = createLiveOverlayPort(clientOf(host));
    const open = await port.dispatch("open_on_desktop");
    assert.equal(open.kind, "rejected");
    const dismiss = await port.dispatch("dismiss");
    assert.equal(dismiss.kind, "ok");
  });

  test("订阅:事件到达重取快照;全部订阅者退订后事件重取停止(按需轮询)", async () => {
    const { host, requests, emit } = makeHost({
      "overlay.getSnapshot": [
        { value: overlayResult },
        { value: overlayResult },
      ],
    });
    const port = createLiveOverlayPort(clientOf(host));
    const seen: string[] = [];
    const unsubscribe = port.subscribe((snapshot) => {
      if (snapshot.availability === "available") seen.push(String(snapshot.tasks.length));
    });
    // 订阅本身不取数(按需);事件事实通知才驱动重取
    assert.equal(requests.length, 0);
    emit(makeEvent("task.stateChanged"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    assert.deepEqual(seen, ["1"]);
    unsubscribe();
    emit(makeEvent("task.stateChanged"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1, "退订后事件不再驱动重取(不常驻轮询)");
  });
});

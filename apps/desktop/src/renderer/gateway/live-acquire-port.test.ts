import { describe, expect, it, vi } from "vitest";
import type {
  ApplicationEventV01,
  DesktopGatewayRequestV1,
  DesktopGatewaySuccessValueV1,
  TaskStateV01,
} from "@vua/contracts";
import type { GatewayClient, GatewayResult } from "./gateway-client.ts";
import { createLiveAcquire } from "./live-acquire-port.ts";
import type { AcquireEntryDetailView, AcquireView } from "./acquire-port.ts";

/**
 * F4-6 live 本地轨端口测试:warehouse.listEntries / warehouse.entryDetail 的
 * wire 投影(client 纪律)、断连语义与事件驱动重取。不经 Kernel 全链路
 * (路由臂由 contracts 守卫测试与 mock provider 覆盖)。
 * BOARD #36 缺陷②同类修复批(2026-09-18):mock 应答统一钉 live 形状
 * (bdl-queries 三键信封,schemaVersion "0.5" + operation + result)——
 * 此前 mock 钉契约平铺值、live 实答带信封,测试全绿真机不通(#22 教训)。
 */

const sha = (seed: string) => `sha256:${seed.repeat(8)}`;

function wireArtifact(overrides: Record<string, unknown> = {}) {
  return {
    artifactSha256: sha("a1b2c3d4"),
    relativePath: "orig/pack.unitypackage",
    state: "clean",
    sizeBytes: 1024,
    role: "original",
    suggestedFileName: "pack.unitypackage",
    inspectedAt: "2026-09-01T10:21:00+08:00",
    rejectionReason: null,
    sourceCorrelated: false,
    mappedProductIds: [],
    ...overrides,
  };
}

function wireEntry(overrides: Record<string, unknown> = {}) {
  return {
    warehouseItemId: "whentry-1",
    folderName: "Miko_Dress_set",
    displayName: "Miko Dress Set",
    kind: "downloaded_material",
    createdAt: "2026-09-01T10:20:00+08:00",
    artifactMode: null,
    effectiveArtifactMode: "use_original_unitypackage",
    artifacts: [wireArtifact()],
    ...overrides,
  };
}

/** live 信封(provider-host bdl_query_success 同形):三键包裹 result 本体 */
const okBdl = (operation: string, result: unknown): GatewayResult<DesktopGatewaySuccessValueV1> => ({
  ok: true,
  value: { schemaVersion: "0.5", operation, result } as unknown as DesktopGatewaySuccessValueV1,
});

const okList = (entries: readonly unknown[]): GatewayResult<DesktopGatewaySuccessValueV1> =>
  okBdl("warehouse.listEntries", { entries });

const errApplication = (code: string): GatewayResult<DesktopGatewaySuccessValueV1> => ({
  ok: false,
  error: {
    kind: "application",
    error: {
      contractVersion: "0.1",
      code,
      category: "validation",
      messageKey: "errors.test",
      recoverable: false,
      retryable: false,
      correlationId: "corr",
    },
  },
});

const errUnavailable: GatewayResult<DesktopGatewaySuccessValueV1> = {
  ok: false,
  error: { kind: "unavailable" },
};

interface StubClient extends GatewayClient {
  /** 测试中手动投递应用事件(模拟 Kernel 广播) */
  emit(event: ApplicationEventV01): void;
  /** 覆盖下一次 invoke 回执(队列空时回 unavailable) */
  queue(result: GatewayResult<DesktopGatewaySuccessValueV1>): void;
  requests(): string[];
}

function stubClient(): StubClient {
  const queue: GatewayResult<DesktopGatewaySuccessValueV1>[] = [];
  const methods: string[] = [];
  const listeners = new Set<(event: ApplicationEventV01) => void>();
  return {
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    queue: (result) => {
      queue.push(result);
    },
    requests: () => methods,
    async invoke(request: DesktopGatewayRequestV1) {
      methods.push(request.method);
      return queue.length > 0 ? (queue.shift() as GatewayResult<DesktopGatewaySuccessValueV1>) : errUnavailable;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function taskEvent(kind: "task.stateChanged" | "task.progressed", state: TaskStateV01 = "succeeded"): ApplicationEventV01 {
  return {
    contractVersion: "0.1",
    eventId: `evt-${state}-${kind}`,
    taskId: "task-1",
    revision: 1,
    occurredAt: "2026-09-01T10:22:00+08:00",
    correlationId: "corr",
    state,
    kind,
    payload: {},
  } as unknown as ApplicationEventV01;
}

async function snapshotOf(port: ReturnType<typeof createLiveAcquire>): Promise<AcquireView> {
  return port.snapshot();
}

describe("live acquire port (F4-6)", () => {
  it("projects warehouse.listEntries wire values into entry domain types", async () => {
    const client = stubClient();
    client.queue(okList([wireEntry()]));
    const port = createLiveAcquire(client);
    const view = await port.snapshot();
    expect(view.kind).toBe("entries");
    if (view.kind !== "entries") return;
    expect(view.entries).toHaveLength(1);
    const entry = view.entries[0];
    expect(entry?.warehouseItemId).toBe("whentry-1");
    expect(entry?.artifactMode).toBeNull();
    expect(entry?.effectiveArtifactMode).toBe("use_original_unitypackage");
    expect(entry?.artifacts[0]?.role).toBe("original");
  });

  it("drops entries whose closed-vocabulary fields are out of vocabulary", async () => {
    const client = stubClient();
    client.queue(
      okList([
        wireEntry({ warehouseItemId: "whentry-good" }),
        wireEntry({ warehouseItemId: "whentry-bad-kind", kind: "mystery_kind" }),
        wireEntry({
          warehouseItemId: "whentry-bad-artifact",
          artifacts: [wireArtifact({ state: "unclear" })],
        }),
      ]),
    );
    const view = await createLiveAcquire(client).snapshot();
    expect(view.kind).toBe("entries");
    if (view.kind !== "entries") return;
    // 词表外条目/工件如实丢弃,不渲染半可信条目
    expect(view.entries.map((entry) => entry.warehouseItemId)).toEqual(["whentry-good"]);
  });

  it("falls back to honest not-connected on transport failure instead of throwing", async () => {
    const client = stubClient(); // 队列空 → unavailable
    const port = createLiveAcquire(client);
    const view = await snapshotOf(port);
    expect(view).toEqual({ schemaVersion: 1, kind: "not-connected" });
    expect((await port.capability()).state).toBe("unavailable");
  });

  it("maps entryDetail: detail / not-found / not-connected", async () => {
    const client = stubClient();
    const port = createLiveAcquire(client);

    client.queue(okBdl("warehouse.entryDetail", { entry: wireEntry() }));
    const detail = await port.entryDetail("whentry-1");
    expect(detail.kind).toBe("detail");
    if (detail.kind !== "detail") return;
    expect(detail.entry.artifacts[0]?.inspectedAt).toBe("2026-09-01T10:21:00+08:00");

    client.queue(errApplication("vua.warehouse.entry_not_found"));
    expect((await port.entryDetail("whentry-missing")).kind).toBe("not-found");

    client.queue(errApplication("vua.warehouse.unavailable"));
    const degraded = await port.entryDetail("whentry-1");
    expect(degraded.kind).toBe("not-connected");

    // 形态不齐(信封缺 result 本体键)按未接入处理,不渲染半可信详情
    client.queue(okBdl("warehouse.entryDetail", {}));
    expect((await port.entryDetail("whentry-1")).kind).toBe("not-connected");

    // #22 回摆钉死:契约平铺值(无信封)在 live 形状纪律下按不可解释处理
    client.queue({ ok: true, value: { entry: wireEntry() } as unknown as DesktopGatewaySuccessValueV1 });
    expect((await port.entryDetail("whentry-1")).kind).toBe("not-connected");
  });

  it("capability probes the read face with the warehouseMissing detail key", async () => {
    const client = stubClient();
    const port = createLiveAcquire(client);
    client.queue(okList([]));
    expect(await port.capability()).toEqual({ state: "ready" });
    client.queue(errUnavailable);
    const report = await port.capability();
    expect(report).toEqual({ state: "unavailable", detailKey: "warehouseMissing" });
  });

  it("refetches on task lifecycle events, skips progress, keeps last view on failure", async () => {
    const client = stubClient();
    client.queue(okList([wireEntry({ warehouseItemId: "whentry-first" })]));
    const port = createLiveAcquire(client);
    await port.snapshot();

    const seen: string[] = [];
    const off = port.subscribe((view) => {
      if (view.kind === "entries") seen.push(view.entries.map((entry) => entry.warehouseItemId).join(","));
    });

    // progress 不触发重取
    client.emit(taskEvent("task.progressed"));
    expect(client.requests().filter((method) => method === "warehouse.listEntries")).toHaveLength(1);

    // 终态事件触发权威重取并推送
    client.queue(okList([
      wireEntry({ warehouseItemId: "whentry-first" }),
      wireEntry({ warehouseItemId: "whentry-second", folderName: "New_Entry" }),
    ]));
    client.emit(taskEvent("task.stateChanged"));
    await vi.waitFor(() => expect(seen).toEqual(["whentry-first,whentry-second"]));

    // 重取失败:保留上一视图(事件只是事实通知)
    client.emit(taskEvent("task.stateChanged", "queued"));
    await vi.waitFor(() =>
      expect(client.requests().filter((method) => method === "warehouse.listEntries")).toHaveLength(3),
    );
    expect(seen).toEqual(["whentry-first,whentry-second"]);

    off();
  });

  it("entryDetail preserves null-vs-absent discipline on fact fields", async () => {
    const client = stubClient();
    const port = createLiveAcquire(client);
    client.queue(okBdl("warehouse.entryDetail", {
      entry: wireEntry({
        artifactMode: "generate_vpm",
        effectiveArtifactMode: "generate_vpm",
        artifacts: [wireArtifact({ suggestedFileName: null, rejectionReason: "executable detected" })],
      }),
    }));
    const detail: AcquireEntryDetailView = await port.entryDetail("whentry-1");
    expect(detail.kind).toBe("detail");
    if (detail.kind !== "detail") return;
    expect(detail.entry.artifactMode).toBe("generate_vpm");
    expect(detail.entry.artifacts[0]?.suggestedFileName).toBeNull();
    expect(detail.entry.artifacts[0]?.rejectionReason).toBe("executable detected");
  });
});

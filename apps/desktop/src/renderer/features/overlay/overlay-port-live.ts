/**
 * Overlay 表面 live 端口(017 表面批 1 消费接线):经 Desktop Gateway 消费
 * overlay.getSnapshot 冻结读面。桌面表态兑现(017 §4 表态,2026-09-10):
 * - 按需轮询:快照查询只在显影(有订阅者)或事件事实通知后发生,零新增
 *   推送/订阅词表;事件只是事实通知,权威状态一律经查询重取(与 task-port
 *   同一消费纪律);
 * - 零会话身份:查询与动作走既有命令面同一受理路径(task.requestCancellation),
 *   无 overlay 专有词表、无 overlay 会话表达;
 * - 诚实缺席:生产读面未接线(vua.overlay.unavailable)映射为快照
 *   unavailable 形态,绝不以空快照伪装;传输/信封失败 reject(表面呈现
 *   失败+重试)。
 */
import type {
  AmfModuleApiV01,
  OverlayDownloadCardV01,
} from "@vua/contracts";
import type {
  OverlayAction,
  OverlayActionPayload,
  OverlayDispatchResult,
  OverlayPresentationV1,
  OverlaySnapshot,
} from "./overlay-contract.ts";
import type { GatewayClient } from "../../gateway/index.ts";
import type { OverlaySurfacePort, Unsubscribe } from "./overlay-port.ts";

/** 壳侧呈现偏好:渲染进程本地事实(reduced-motion 媒体查询;i18n 当前语言)。
 *  防守式访问(测试/非 DOM 上下文回退默认值) */
function localPresentation(): OverlayPresentationV1 {
  const locale =
    typeof document !== "undefined"
      ? document.documentElement.lang || "zh-CN"
      : "zh-CN";
  return {
    locale,
    textScale: 1,
    reducedMotion:
      typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

function unavailableSnapshot(): OverlaySnapshot {
  return { schemaVersion: 2, availability: "unavailable", presentation: localPresentation() };
}

/** New host task window: task.list is the authority even without AMF.
 * AMF's original overlay face is queried only for its optional cards. */
export function createHostOverlayPort(client: GatewayClient, modules: AmfModuleApiV01): OverlaySurfacePort {
  return createLiveOverlayPort(client, async () => {
    const result = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "task.list", params: {} });
    if (!result.ok || !("revision" in result.value) || !("tasks" in result.value)) throw new Error("host_tasks_unavailable");
    const amf = await modules.snapshot();
    const optional = amf.state === "ready" ? await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "overlay.getSnapshot", params: {} }).catch(() => undefined) : undefined;
    const cards = optional?.ok && "productionCard" in optional.value ? optional.value : undefined;
    return { schemaVersion: 3, availability: "available", presentation: localPresentation(),
      tasks: [...result.value.tasks].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.taskId.localeCompare(b.taskId)).map(task => ({ taskId: task.taskId, state: task.state, correlationId: task.correlationId })),
      amfUnavailable: amf.installed && (!cards || amf.state !== "ready"),
      ...(cards ? { productionCard: cards.productionCard } : {}),
      ...(cards?.downloadCard ? { downloadCard: cards.downloadCard } : {}),
    };
  });
}

function isOverlayResult(value: object): value is {
  readonly tasks: readonly unknown[];
  readonly productionCard: unknown;
  readonly downloadCard?: OverlayDownloadCardV01;
} {
  return "tasks" in value && "productionCard" in value;
}

export function createLiveOverlayPort(client: GatewayClient, source?: () => Promise<OverlaySnapshot>): OverlaySurfacePort {
  const fetchSnapshot = source ?? (async (): Promise<OverlaySnapshot> => {
    const result = await client.invoke({
      schemaVersion: 1,
      requestId: crypto.randomUUID(),
      method: "overlay.getSnapshot",
      params: {},
    });
    if (!result.ok) {
      // 生产读面未接线 = 诚实缺席(冻结语义);其余失败如实上抛
      if (
        result.error.kind === "application"
        && result.error.error.code === "vua.overlay.unavailable"
      ) {
        return unavailableSnapshot();
      }
      throw new Error("overlay_snapshot_unavailable");
    }
    if (typeof result.value !== "object" || result.value === null || !isOverlayResult(result.value)) {
      throw new Error("overlay_snapshot_unavailable");
    }
    return {
      schemaVersion: 2,
      availability: "available",
      presentation: localPresentation(),
      tasks: result.value.tasks,
      productionCard: result.value.productionCard,
      // 017 批 2 可选增量原样透传:批 1 世代快照无此字段即缺席(不合成空卡)
      ...(result.value.downloadCard === undefined
        ? {}
        : { downloadCard: result.value.downloadCard }),
    };
  });

  const listeners = new Set<(snapshot: OverlaySnapshot) => void>();
  let unsubscribeEvents: Unsubscribe | null = null;
  const push = (snapshot: OverlaySnapshot) => {
    for (const listener of listeners) listener(snapshot);
  };
  // 事件事实通知 → 重取权威快照;失败保留上一视图(断连不清洗)
  const refresh = () => {
    void fetchSnapshot().then(push, () => {});
  };

  const currentOrUnavailable = async (): Promise<OverlaySnapshot> => {
    try {
      return await fetchSnapshot();
    } catch {
      return unavailableSnapshot();
    }
  };

  return {
    snapshot: fetchSnapshot,
    subscribe(callback) {
      listeners.add(callback);
      if (unsubscribeEvents === null) unsubscribeEvents = client.subscribe(refresh);
      return () => {
        listeners.delete(callback);
        // 无订阅者即未显影:停事件重取,不常驻轮询(017 表态 1)
        if (listeners.size === 0 && unsubscribeEvents !== null) {
          unsubscribeEvents();
          unsubscribeEvents = null;
        }
      };
    },
    async dispatch(
      action: OverlayAction,
      payload?: OverlayActionPayload,
    ): Promise<OverlayDispatchResult> {
      if (action === "request_cancel_task") {
        const taskId = payload?.taskId;
        if (typeof taskId !== "string" || taskId.length === 0) {
          return { kind: "rejected", reason: "action_not_allowed", snapshot: await currentOrUnavailable() };
        }
        // 语义动作走既有命令面(017 §3):同一受理路径、同一九态纪律;
        // 结果三态(already_terminal/already_requested/requested)都是
        // 受理回执,快照重取后 ok 呈现
        const result = await client.invoke({
          schemaVersion: 1,
          requestId: crypto.randomUUID(),
          method: "task.requestCancellation",
          params: { taskId, commandId: crypto.randomUUID() },
        });
        const snapshot = await currentOrUnavailable();
        if (!result.ok && result.error.kind === "application"
          && result.error.error.code === "vua.task.not_found") {
          return { kind: "rejected", reason: "action_not_allowed", snapshot };
        }
        return { kind: "ok", snapshot };
      }
      // dismiss = 关窗动作(壳层处理,窗口永远关得掉);open_on_desktop =
      // VR 落点动作,1.0.0 无 VR 传输路径(用户裁决 2026-09-06)——诚实拒绝
      const snapshot = await currentOrUnavailable();
      if (action === "open_on_desktop") {
        return { kind: "rejected", reason: "action_not_allowed", snapshot };
      }
      return { kind: "ok", snapshot };
    },
  };
}

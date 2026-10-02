import type { PageId } from "../app/nav-model.ts";
import type { GatewayClient } from "./gateway-client.ts";
import type { WarehouseArtifactMode } from "./acquire-port.ts";
import type {
  WarehouseCommandOutcome,
  WarehouseCommandsPort,
} from "./warehouse-commands-port.ts";
import { registerTaskIdentity } from "./task-identity.ts";
import { strings } from "../i18n/index.ts";

/**
 * F4-9 live 写命令端口:warehouse.setArtifactMode / generateVpm /
 * deleteOriginals(bdl-commands v0.1 冻结业务词表)经 typed client →
 * Kernel 路由 → provider-host → AMF/BDL 真实链路。
 *
 * - 收窄纪律(client 纪律):wire 受理载荷带协议判别信封(schemaVersion/
 *   operation,proposal 005 核心回执),按字段存在性收窄为域结果;词表外
 *   生效模式或收不齐必需字段 = 提供方响应不可解释,如实 unavailable;
 * - 错误透传:应用错误(vua.warehouse.* 稳定码 + recoverable/retryable)
 *   原样透传,不在本层翻译、吞掉或改判重试性。
 */

const MODES: readonly WarehouseArtifactMode[] = [
  "use_original_unitypackage",
  "generate_vpm",
];

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function outcomeFromClientError(error: {
  kind: "unavailable" | "request_rejected" | "application";
  error?: {
    code: string;
    messageKey: string;
    recoverable: boolean;
    retryable: boolean;
  };
}): WarehouseCommandOutcome {
  if (error.kind === "application" && error.error !== undefined) {
    return {
      ok: false,
      error: {
        kind: "application",
        code: error.error.code,
        messageKey: error.error.messageKey,
        recoverable: error.error.recoverable,
        retryable: error.error.retryable,
      },
    };
  }
  return { ok: false, error: { kind: error.kind === "application" ? "unavailable" : error.kind } };
}

function narrowModeSet(value: unknown): WarehouseCommandOutcome {
  const record = asRecord(value);
  const warehouseItemId = record === null ? null : asString(record.warehouseItemId);
  const effectiveRaw = record === null ? null : record.effectiveMode;
  if (
    warehouseItemId === null
    || typeof effectiveRaw !== "string"
    || !MODES.includes(effectiveRaw as WarehouseArtifactMode)
  ) {
    return { ok: false, error: { kind: "unavailable" } };
  }
  return {
    ok: true,
    result: { warehouseItemId, effectiveMode: effectiveRaw as WarehouseArtifactMode },
  };
}

function narrowAcceptance(value: unknown): WarehouseCommandOutcome {
  const record = asRecord(value);
  const taskId = record === null ? null : asString(record.taskId);
  const correlationId = record === null ? null : asString(record.correlationId);
  if (taskId === null || correlationId === null) {
    return { ok: false, error: { kind: "unavailable" } };
  }
  return { ok: true, accepted: { taskId, correlationId } };
}

/** 受理即登记任务身份(W25 走查 D1):命令回执给出 taskId,发起端口已知
 * 操作类型与来源页——登记后通知中心以人类可读标题呈现,不再裸 taskId。
 * wire 无描述字段,登记是渲染层会话事实,不发明 wire 面。 */
function acceptWithIdentity(
  value: unknown,
  identity: { readonly title: string; readonly originPage: PageId },
): WarehouseCommandOutcome {
  const outcome = narrowAcceptance(value);
  if (outcome.ok && "accepted" in outcome) {
    registerTaskIdentity(outcome.accepted.taskId, identity);
  }
  return outcome;
}

/** W14 v0.2 全局层:回执 = 从 BDL 读回的持久事实(globalDefaultMode),非回显 */
function narrowGlobalDefault(value: unknown): WarehouseCommandOutcome {
  const record = asRecord(value);
  const modeRaw = record === null ? null : record.globalDefaultMode;
  if (
    modeRaw === null ||
    typeof modeRaw !== "string" ||
    !MODES.includes(modeRaw as WarehouseArtifactMode)
  ) {
    return { ok: false, error: { kind: "unavailable" } };
  }
  return { ok: true, global: { globalDefaultMode: modeRaw as WarehouseArtifactMode } };
}

export function createWarehouseCommands(client: GatewayClient): WarehouseCommandsPort {
  return {
    setArtifactMode: async (warehouseItemId, mode) => {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "warehouse.setArtifactMode",
        params: {
          warehouseItemId,
          mode,
          commandId: `whcmd-${crypto.randomUUID()}`,
        },
      });
      return response.ok ? narrowModeSet(response.value) : outcomeFromClientError(response.error);
    },
    generateVpm: async (warehouseItemId) => {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "warehouse.generateVpm",
        params: { warehouseItemId, commandId: `whcmd-${crypto.randomUUID()}` },
      });
      return response.ok ? narrowAcceptance(response.value) : outcomeFromClientError(response.error);
    },
    deleteOriginals: async (warehouseItemId) => {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "warehouse.deleteOriginals",
        params: { warehouseItemId, commandId: `whcmd-${crypto.randomUUID()}` },
      });
      return response.ok ? narrowAcceptance(response.value) : outcomeFromClientError(response.error);
    },
    // W14 v0.2 全局层(W15 重做:设置页全局开关的写面)
    setGlobalDefaultMode: async (mode) => {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "warehouse.setGlobalDefaultMode",
        params: { mode, commandId: `whcmd-${crypto.randomUUID()}` },
      });
      return response.ok ? narrowGlobalDefault(response.value) : outcomeFromClientError(response.error);
    },
    // W19 批量导入(bdl-commands v0.3):受理即导入任务身份;进度经任务面
    importFolders: async (sourceFolders, options) => {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "warehouse.import",
        params: {
          sourceFolders: [...sourceFolders],
          commandId: `whcmd-${crypto.randomUUID()}`,
          // N5 实验选项(设置-实验性门控):导入后自动制成 VPM 包再入库
          ...(options?.autoGenerate === true ? { autoGenerate: true } : {}),
        },
      });
      return response.ok
        ? acceptWithIdentity(response.value, {
            title: strings.taskTitles.importBatch,
            // 来源页 = 仓储页:素材导入自 2026-09-20 导航重构起为仓储页内
            // 弹窗,不再持独立页;任务「回到来源页」落回其宿主页面
            originPage: "warehouse",
          })
        : outcomeFromClientError(response.error);
    },
    // IMP-3 下载采纳(bdl-commands v0.4):仅身份请求,受理即采纳任务身份;
    // 进度与落成条目经任务面/读面
    importDownloads: async (downloadIds) => {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "warehouse.importDownloads",
        params: { downloadIds: [...downloadIds], commandId: `whcmd-${crypto.randomUUID()}` },
      });
      return response.ok
        ? acceptWithIdentity(response.value, {
            title: strings.taskTitles.adoptDownload,
            // 来源页同上:下载采纳入口现居仓储页素材导入弹窗内
            originPage: "warehouse",
          })
        : outcomeFromClientError(response.error);
    },
    capability: async () => {
      // 能力探测同 live-acquire 先例:读面探针(写面与读面同域,服务缺位时
      // 一并缺位);detailKey 与读取面一致,入口显隐由页面按 §2.6 裁决
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "warehouse.listEntries",
        params: {},
      });
      return result.ok
        ? { state: "ready" }
        : { state: "unavailable", detailKey: "warehouseMissing" };
    },
  };
}

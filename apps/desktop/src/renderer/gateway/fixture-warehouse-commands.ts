import type { WarehouseArtifactMode } from "./acquire-port.ts";
import type {
  AcquireFixtureStore,
} from "./fixture-acquire.ts";
import type {
  WarehouseCommandOutcome,
  WarehouseCommandsPort,
} from "./warehouse-commands-port.ts";
import type { ProductionTaskLink } from "./fixture-production.ts";
import { format, strings } from "../i18n/index.ts";

/**
 * Warehouse 写命令 fixture(F4-9 走查载体,仅 DEV 可达):在演示条目数据上
 * 演示 bdl-commands v0.1 的守卫语义与任务化受理——
 * - setArtifactMode:设置/清除覆盖并回读生效模式(演示为「覆盖 ?? fixture
 *   全局默认」,真实全局默认由 provider 运行时配置注入,不进 wire);
 * - generateVpm / deleteOriginals:按协议守卫同步裁决(invalid_state /
 *   no_original_material / already_generated / generated_artifact_missing /
 *   entry_not_found),受理后在任务中心出现九态任务并联动条目数据变更
 *   (fixture 即时完成演示;真实进度/回执经任务面,完成载荷由核心接线);
 * - 错误形态与 live 同构:协议稳定码原样透传,不在端口层吞掉或翻译。
 */

/** fixture 演示全局默认(W15 重做:全局开关写入后联动条目生效模式解析) */
let fixtureGlobalDefault: WarehouseArtifactMode = "use_original_unitypackage";

const SETTLE_MS = 900;

function applicationError(code: string, messageKey: string): WarehouseCommandOutcome {
  return {
    ok: false,
    error: { kind: "application", code, messageKey, recoverable: true, retryable: false },
  };
}

export interface FixtureWarehouseCommandsOptions {
  /** 任务中心联动(演示任务九态呈现);未注入时只做数据变更不建任务 */
  readonly taskLink?: ProductionTaskLink;
}

export function createFixtureWarehouseCommands(
  store: AcquireFixtureStore,
  options: FixtureWarehouseCommandsOptions = {},
): WarehouseCommandsPort {
  const { taskLink } = options;
  const taskTitles = strings.taskTitles;

  const linkTask = (taskId: string, title: string): void => {
    taskLink?.upsertTask({
      id: taskId,
      title,
      status: "running",
      originPage: "warehouse",
      cancellable: false,
    });
  };
  const completeTask = (taskId: string): void => {
    taskLink?.patchTask(taskId, { status: "completed", cancellable: false });
  };

  return {
    setArtifactMode: (warehouseItemId, mode) => {
      const entry = store.entry(warehouseItemId);
      if (entry === null) {
        return Promise.resolve(applicationError(
          "vua.warehouse.entry_not_found",
          "errors.warehouse.entryNotFound",
        ));
      }
      // 演示语义:生效模式 = 覆盖 ?? fixture 全局默认(真实解析在服务端读回)
      const effective = mode ?? fixtureGlobalDefault;
      store.setMode(warehouseItemId, mode);
      return Promise.resolve({
        ok: true,
        result: { warehouseItemId, effectiveMode: effective },
      });
    },

    generateVpm: (warehouseItemId) => {
      const entry = store.entry(warehouseItemId);
      if (entry === null) {
        return Promise.resolve(applicationError(
          "vua.warehouse.entry_not_found",
          "errors.warehouse.entryNotFound",
        ));
      }
      if (entry.effectiveArtifactMode !== "generate_vpm") {
        return Promise.resolve(applicationError(
          "vua.warehouse.invalid_state",
          "errors.warehouse.invalidState",
        ));
      }
      if (!entry.artifacts.some((artifact) => artifact.role === "original")) {
        return Promise.resolve(applicationError(
          "vua.warehouse.no_original_material",
          "errors.warehouse.noOriginalMaterial",
        ));
      }
      if (entry.artifacts.some((artifact) => artifact.role === "generated_vpm")) {
        return Promise.resolve(applicationError(
          "vua.warehouse.already_generated",
          "errors.warehouse.alreadyGenerated",
        ));
      }
      const taskId = `task-wh-gen-${warehouseItemId}`;
      const correlationId = `corr-${taskId}`;
      // 走查 3a 修复:任务标题绑定操作条目实体(displayName),不再固定演示名
      linkTask(taskId, format(taskTitles.generateVpm, { name: entry.displayName }));
      setTimeout(() => {
        store.addGeneratedVpm(warehouseItemId);
        completeTask(taskId);
      }, SETTLE_MS);
      return Promise.resolve({ ok: true, accepted: { taskId, correlationId } });
    },

    deleteOriginals: (warehouseItemId) => {
      const entry = store.entry(warehouseItemId);
      if (entry === null) {
        return Promise.resolve(applicationError(
          "vua.warehouse.entry_not_found",
          "errors.warehouse.entryNotFound",
        ));
      }
      if (entry.effectiveArtifactMode !== "generate_vpm") {
        return Promise.resolve(applicationError(
          "vua.warehouse.invalid_state",
          "errors.warehouse.invalidState",
        ));
      }
      if (!entry.artifacts.some((artifact) => artifact.role === "generated_vpm")) {
        return Promise.resolve(applicationError(
          "vua.warehouse.generated_artifact_missing",
          "errors.warehouse.generatedArtifactMissing",
        ));
      }
      const taskId = `task-wh-del-${warehouseItemId}`;
      const correlationId = `corr-${taskId}`;
      // 走查 3b 修复:同 3a,标题绑定操作条目实体
      linkTask(taskId, format(taskTitles.deleteOriginals, { name: entry.displayName }));
      setTimeout(() => {
        store.removeOriginals(warehouseItemId);
        completeTask(taskId);
      }, SETTLE_MS);
      return Promise.resolve({ ok: true, accepted: { taskId, correlationId } });
    },

    // N5 收口:fixture 仓储无 BOOTH 商品映射,按商品删除恒答事实性未命中
    // (演示卡片墙 importedArtifacts 恒 0,菜单不出现,此臂只保类型完整)
    deleteOriginalsByProduct: () => {
      return Promise.resolve(applicationError(
        "vua.warehouse.entry_not_found",
        "errors.warehouse.entryNotFound",
      ));
    },

    // W14 v0.2 全局层(演示语义):同步写入演示状态并回读持久事实(非回显)
    setGlobalDefaultMode: (mode) => {
      fixtureGlobalDefault = mode;
      return Promise.resolve({ ok: true, global: { globalDefaultMode: mode } });
    },
    // W19 批量导入(bdl-commands v0.3,演示):逐 folder 落成条目并受理任务
    importFolders: (sourceFolders) => {
      const folders = [...sourceFolders].map((raw) => raw.trimEnd().replace(/[\/]+$/, ""));
      if (folders.length === 0) {
        return Promise.resolve(applicationError(
          "vua.warehouse.invalid_params",
          "errors.warehouse.invalidParams",
        ));
      }
      const taskId = `task-wh-import-${Date.now()}`;
      const correlationId = `corr-${taskId}`;
      linkTask(taskId, taskTitles.importBatch);
      setTimeout(() => {
        for (const folder of folders) store.addImportedEntry(folder.split(/[\/]/).pop() ?? folder);
        completeTask(taskId);
      }, SETTLE_MS);
      return Promise.resolve({ ok: true, accepted: { taskId, correlationId } });
    },

    // IMP-3 下载采纳(bdl-commands v0.4,演示):逐下载身份落成
    // downloaded_material 条目并受理任务;守卫语义(仅已完成交付可采纳)
    // 在服务端,演示不模拟下载事件日志
    importDownloads: (downloadIds) => {
      const ids = [...downloadIds];
      if (ids.length === 0) {
        return Promise.resolve(applicationError(
          "vua.warehouse.invalid_params",
          "errors.warehouse.invalidParams",
        ));
      }
      const taskId = `task-wh-import-downloads-${Date.now()}`;
      const correlationId = `corr-${taskId}`;
      linkTask(taskId, taskTitles.importBatch);
      setTimeout(() => {
        for (const downloadId of ids) store.addDownloadedEntry(downloadId);
        completeTask(taskId);
      }, SETTLE_MS);
      return Promise.resolve({ ok: true, accepted: { taskId, correlationId } });
    },

    capability: () => Promise.resolve({ state: "ready" }),
  };
}

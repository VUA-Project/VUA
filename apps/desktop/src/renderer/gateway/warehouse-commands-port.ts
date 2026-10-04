import type { WarehouseArtifactMode } from "./acquire-port.ts";
import type { CapabilityReport } from "./types.ts";

/**
 * Warehouse 写命令窄端口(F4-9;bdl-commands v0.1 冻结业务词表的渲染层面)。
 *
 * 定位(proposal 005 两端登记后的表现层切口):
 * - acquire-port 保持只读(C-ACQUIRE 纪律);本端口只承载三条写命令,
 *   语义与守卫事实归 AMF(服务端事实永不是客户端断言);
 * - setArtifactMode 同步受理即结果:effectiveMode 是服务端读回的查询期
 *   事实(override ?? 全局默认),端口不本地推导、不回显请求值;
 * - generateVpm / deleteOriginals 任务化:受理 = 九态任务出现在任务中心,
 *   进度/回执走全局任务面;完成载荷经任务面投递(通道由核心 provider-host
 *   接线),本端口只呈现受理事实;
 * - 全局默认产物模式是 provider 运行时配置(VUA_WAREHOUSE_DEFAULT_MODE),
 *   不进 wire:渲染层不提供全局默认的写入口,"跟随全局"是只读语义;
 * - 错误词表 = 协议稳定错误码(vua.warehouse.*,docs/protocols/
 *   bdl-commands-v0.1_ZH)原样透传,本地化与重试判定引用 code 与
 *   recoverable/retryable 原值,不在端口层翻译或吞掉。
 */

export interface WarehouseModeSetResult {
  readonly warehouseItemId: string;
  readonly effectiveMode: WarehouseArtifactMode;
}

/** 全局默认写入结果(bdl-commands v0.2):持久事实读回,非回显 */
export interface WarehouseGlobalDefaultResult {
  readonly globalDefaultMode: WarehouseArtifactMode;
}

export interface WarehouseMaintenanceAcceptance {
  readonly taskId: string;
  readonly correlationId: string;
}

export type WarehouseCommandOutcome =
  | { readonly ok: true; readonly result: WarehouseModeSetResult }
  | { readonly ok: true; readonly global: WarehouseGlobalDefaultResult }
  | { readonly ok: true; readonly accepted: WarehouseMaintenanceAcceptance }
  | {
      readonly ok: true;
      /** 按商品删除受理(N5):逐条目 delete_originals 任务的受理计数事实,
       * 非任务受理信封——各任务进度经任务面呈现 */
      readonly deleted: { readonly productId: string; readonly deletedItemCount: number };
    }
  | {
      readonly ok: false;
      /** 协议稳定码(vua.warehouse.*)或传输面三态,原样透传 */
      readonly error:
        | { readonly kind: "unavailable" }
        | { readonly kind: "request_rejected" }
        | {
            readonly kind: "application";
            readonly code: string;
            readonly messageKey: string;
            readonly recoverable: boolean;
            readonly retryable: boolean;
          };
    };

export interface WarehouseCommandsPort {
  /**
   * 设置或清除条目级产物模式覆盖(mode = null 清除,回落「覆盖 ?? 全局
   * 默认」动态解析);同步受理,effectiveMode 为服务端读回事实。
   */
  setArtifactMode(
    warehouseItemId: string,
    mode: WarehouseArtifactMode | null,
  ): Promise<WarehouseCommandOutcome>;
  /** 为条目从 original 角色副本生成本地 VPM 包(任务化受理) */
  generateVpm(warehouseItemId: string): Promise<WarehouseCommandOutcome>;
  /**
   * 受守卫删除条目的原始素材(审计性破坏操作;生效模式必须是
   * generate_vpm 且生成副本在场,守卫在服务端)
   */
  deleteOriginals(warehouseItemId: string): Promise<WarehouseCommandOutcome>;
  /**
   * 按商品删除本地原件(N5 收口,卡片墙右键动作):服务端反查该商品全部
   * 仓储条目,逐条提交条目级 delete_originals(独立审计任务);回执为受理
   * 计数事实,任务进度经任务面呈现。记录(book/catalog)保留,只有本地
   * 原件文件被移除——「文件没有了直接从 booth 重新下」的用户裁决
   */
  deleteOriginalsByProduct(productId: string): Promise<WarehouseCommandOutcome>;
  /**
   * 写全局默认产物模式(bdl-commands v0.2 两级选项的全局层;同步受理,
   * 回执为从 BDL 读回的持久事实,非回显;无 null——全局默认恒有值)
   */
  setGlobalDefaultMode(mode: WarehouseArtifactMode): Promise<WarehouseCommandOutcome>;
  /**
   * 批量导入素材文件夹(bdl-commands v0.3,W19):folder 批一次提交,
   * 受理即导入任务身份;逐 folder 进度与条目落成经任务面/读面呈现;
   * 导入编排内的自动生成挂点在任务内(010 路径 A,服务端)
   */
  importFolders(
    sourceFolders: readonly string[],
    options?: { readonly autoGenerate?: boolean },
  ): Promise<WarehouseCommandOutcome>;
  /**
   * 采纳已完成下载为仓储条目(bdl-commands v0.4,IMP-3):只携带端口下载
   * 身份——暂存路径/大小/文件名是 BDL 下载事件日志的服务端事实,永不是
   * 请求字段或客户端断言;受理即采纳任务身份,逐下载进度经任务面呈现;
   * 采纳=复制落库,暂存清理不是本命令语义
   */
  importDownloads(downloadIds: readonly string[]): Promise<WarehouseCommandOutcome>;
  capability(): Promise<CapabilityReport>;
}

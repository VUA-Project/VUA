/**
 * Overlay 表面契约的渲染层本地镜像(v2,017 表面批 1 wire 消费接线)。
 *
 * 语义来源:packages/contracts 的 OverlaySnapshotResultV01 冻结面(应用契约
 * 017 批 1,main 1d3509b 入库)+ docs/architecture/integrations-and-overlays.md
 * §Overlay。v1 镜像(切片五)预设的 revision/allowedActions/environment 与
 * stage/progress 字段在冻结 wire 面不存在——纯函数纪律不带聚合 revision,
 * 动作权限守卫在服务权威侧(017 §3),环境/下载卡属批 2 未投影——v2 以
 * wire 冻结面为准对齐,不另造第二套词表:任务卡与生产卡类型直接复用
 * @vua/contracts,原样透传。
 */

import type {
  OverlayDownloadCardV01,
  OverlayProductionCardV01,
  OverlayTaskCardV01,
} from "@vua/contracts";

export type {
  OverlayDownloadCardV01,
  OverlayProductionCardV01,
  OverlayTaskCardV01,
} from "@vua/contracts";

/** 三个语义动作:Overlay 表面(桌面置顶窗 / VR Dashboard)只发送这些 */
export type OverlayAction = "open_on_desktop" | "dismiss" | "request_cancel_task";

/** request_cancel_task 的目标载荷(wire 任务卡事实 taskId);其余动作无载荷 */
export interface OverlayActionPayload {
  readonly taskId?: string;
}

/** 状态基调(展示语义;视觉映射由表现模型负责,契约不带颜色词)。
 *  v2 中 tone 由渲染层从冻结词表事实推导(见 overlay-model),waiting 在
 *  wire 批 1 无事实源,类型保留供批 2 演进。 */
export type OverlayStatusTone = "inactive" | "active" | "waiting" | "blocked";

export const overlayStatusTones: readonly OverlayStatusTone[] = [
  "inactive",
  "active",
  "waiting",
  "blocked",
];

/** 呈现偏好(壳侧:渲染进程本地,非 wire 事实) */
export interface OverlayPresentationV1 {
  readonly locale: string;
  readonly textScale: number;
  readonly reducedMotion: boolean;
}

/**
 * Overlay 快照 v2:两态判别。
 * - available:overlay.getSnapshot 冻结投影原样透传(任务卡列表＋生产状态
 *   卡两半独立可空;017 批 2 起新增可选 downloadCard——批 1 世代快照无此
 *   字段仍有效,向后兼容);
 * - unavailable:生产读面未接线的诚实缺席(vua.overlay.unavailable)——
 *   绝不以空快照伪装(017 批 1 冻结语义),呈现缺席空态而非空数据。
 */
export type OverlaySnapshotV2 =
  | {
      readonly schemaVersion: 2;
      readonly availability: "available";
      readonly presentation: OverlayPresentationV1;
      readonly tasks: readonly OverlayTaskCardV01[];
      readonly productionCard: OverlayProductionCardV01;
      /** 017 批 2 可选增量:仅承载进行中下载尝试;缺席 = 批 1 世代快照 */
      readonly downloadCard?: OverlayDownloadCardV01;
    }
  | {
      readonly schemaVersion: 2;
      readonly availability: "unavailable";
      readonly presentation: OverlayPresentationV1;
    };

export type OverlayDispatchResultV2 =
  | { readonly kind: "ok"; readonly snapshot: OverlaySnapshotV2 }
  | {
      readonly kind: "rejected";
      readonly reason: "unknown_action" | "action_not_allowed";
      readonly snapshot: OverlaySnapshotV2;
    };

/** 端口侧惯用短名(v2 当前代;同 tutorial-contract 惯例) */
/** Host tasks exist independently of AMF. An absent production card carries
 * no production readiness claim; the old wire mirror stays unchanged. */
export interface HostOverlaySnapshotV3 {
  readonly schemaVersion: 3;
  readonly availability: "available";
  readonly presentation: OverlayPresentationV1;
  readonly tasks: readonly OverlayTaskCardV01[];
  readonly productionCard?: OverlayProductionCardV01;
  readonly downloadCard?: OverlayDownloadCardV01;
  readonly amfUnavailable: boolean;
}
export type OverlaySnapshot = OverlaySnapshotV2 | HostOverlaySnapshotV3;
export type OverlayDispatchResult =
  | { readonly kind: "ok"; readonly snapshot: OverlaySnapshot }
  | { readonly kind: "rejected"; readonly reason: "unknown_action" | "action_not_allowed"; readonly snapshot: OverlaySnapshot };

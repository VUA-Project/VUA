import type { PageId } from "../app/nav-model.ts";
import type { TaskStatus } from "../app/task-status.ts";
import type { CapabilityReport, Unsubscribe } from "./types.ts";

/**
 * 任务领域窄端口(M0 TaskPort):后台任务中心。
 *
 * 状态事实来源在应用层(§6.3:组件卸载、窗口关闭或切换模块不能让可恢复
 * 任务失去状态);前端存储只做显示缓存。九态文案一律查 strings.taskStatus。
 *
 * 文案纪律:title / errorText 为数据负载(由任务引擎提供,先例同
 * deployer-model 的 CheckItem.title),UI 框架文案在 strings.taskCenter;
 * fixture 任务负载文案在 strings.fixtures(DEV 专用)。
 */
export interface TaskItem {
  readonly id: string;
  /** 任务标题(数据负载) */
  readonly title: string;
  readonly status: TaskStatus;
  /** 进度;不可量化时省略,不得以假进度填充 */
  readonly progress?: { readonly done: number; readonly total: number };
  /** 来源页:任务列表提供"回到来源页"回跳 */
  readonly originPage: PageId;
  /** 当前状态是否允许取消(由应用层裁决,前端不自行推断) */
  readonly cancellable: boolean;
  /** 失败/警告说明(数据负载) */
  readonly errorText?: string;
  /** 终态后仍显示为通知直到手动清除(登记身份时声明;见 task-identity) */
  readonly notifyOnComplete?: boolean;
}

export interface TaskCenterView {
  schemaVersion: 1;
  tasks: readonly TaskItem[];
}

export type CancelTaskResult =
  | { kind: "ok"; view: TaskCenterView }
  | {
      kind: "rejected";
      /** unavailable = Kernel/Provider 不可达(断连);其余为应用层裁决 */
      reason: "unknown_task" | "not_cancellable" | "unavailable";
      view: TaskCenterView;
    };

export type RetryTaskResult =
  | { kind: "ok"; decision: "resume" | "retry" }
  | {
      kind: "rejected";
      /** unavailable = 断连;not_retryable = AMF 重试策略裁决(任务级动作,
       *  由 AMF 权威决定,渲染层如实呈现拒绝原因) */
      reason: "unknown_task" | "not_retryable" | "unavailable";
    };

export interface TaskPort {
  snapshot(): Promise<TaskCenterView>;
  subscribe(callback: (view: TaskCenterView) => void): Unsubscribe;
  /** 取消意图:应用层裁决 ok / rejected,一律携带最新快照 */
  cancel(taskId: string): Promise<CancelTaskResult>;
  /** 重试意图(下载等可重试任务):任务级动作,AMF 以冻结重试策略裁决 */
  retry(taskId: string): Promise<RetryTaskResult>;
  capability(): Promise<CapabilityReport>;
}

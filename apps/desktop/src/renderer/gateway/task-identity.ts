import type { PageId } from "../app/nav-model.ts";

/**
 * 渲染层任务身份登记(W25 走查 D1 修复,2026-09-20):
 * wire 面 TaskSnapshotV01 v0.1 无描述负载(冻结面,不发明 wire 字段),
 * 引擎侧 taskId 也不携带类型信息——人类可读标题只能来自渲染层自己发起
 * 操作时已知的事实:命令受理回执给出 taskId,发起端口据此登记「这是哪类
 * 操作、来源页在哪」。与 live-production-port 的既有纪律同构:渲染层只
 * 关联自己经命令创建的任务(命令回执),不依赖 taskId 前缀。
 *
 * - 登记是渲染层会话事实:窗口重载后登记消失,未登记任务回落诚实类型词
 *   (strings.taskCenter.unlabeledTask),不以猜测补标题(诚实纪律);
 * - 标题照 taskTitles 模板在登记时按当前语言组合,实体名保持原文(先例
 *   677ba1b:动词/状态走 i18n,实体名 verbatim);
 * - 登记只影响呈现投影(projectTaskItem),不改任务权威事实。
 */
export interface TaskIdentity {
  /** 任务标题(数据负载,登记时按当前语言组合) */
  readonly title: string;
  /** 来源页:任务列表「回到来源页」与行打开的回跳目标 */
  readonly originPage: PageId;
  /** 终态后仍作为通知显示直到手动清除(用户裁决 2026-10-02:短任务的
   * 完成也应有通知——运行窗口太短,用户打开通知中心时已按默认纪律
   * 消失)。只影响呈现,不影响任务权威事实。 */
  readonly notifyOnComplete?: boolean;
}

const identities = new Map<string, TaskIdentity>();

/** 命令受理回执抵达时登记任务身份(同 taskId 重复受理以最新为准) */
export function registerTaskIdentity(taskId: string, identity: TaskIdentity): void {
  identities.set(taskId, identity);
}

/** 投影时查身份;未登记返回 undefined(调用方回落诚实类型词) */
export function taskIdentityOf(taskId: string): TaskIdentity | undefined {
  return identities.get(taskId);
}

/** 测试隔离:清空全部登记(生产代码不调用) */
export function resetTaskIdentities(): void {
  identities.clear();
}

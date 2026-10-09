import type { DeploymentIntent, DeploymentPlan, DeploymentProgress, TaskSnapshotV01 } from "@vua/contracts";
import type { NetworkIntent, NetworkReport } from "@vua/contracts";
import type { WebsiteObservation } from "@vua/contracts";
import type { PlayRoute, PlaySession } from "@vua/contracts";
import type { CreatorManagers } from "./creator-inventory-port.ts";
import type { CheckZone, DeployerView, VersionTrack } from "../features/deployer/deployer-model.ts";
import type { FixPlanV1 } from "../features/deployer/fix-plan-model.ts";
import type { CapabilityReport, Unsubscribe } from "./types.ts";

/** 修复计划查询结果(C-ENV):能力不可用与未知检测项分别如实表达 */
export type FixPlanResult =
  | { kind: "ok"; plan: FixPlanV1 }
  | { kind: "unknown-check" }
  | { kind: "unavailable" };

/**
 * 环境领域窄端口(M0 EnvironmentPort):部署器健康视图的唯一取数口。
 * 真实检测器经 Rust 应用层接入后,live 实现替换本端口实现,接口不变。
 */
export interface EnvironmentView {
  schemaVersion: 1;
  deployer: DeployerView;
  /** 版本轨道(S-XV):运行库/依赖的已安装与最新事实,按辖区分组;
   *  版本源未接入时为空数组(表现层整块不渲染,而非虚构数据) */
  versions: Record<CheckZone, VersionTrack[]>;
}

/** Real deployment port; fixture/empty sources deliberately do not simulate installation. */
export interface DeploymentPort {
  capability(): Promise<CapabilityReport>;
  plan(intent: DeploymentIntent): Promise<DeploymentPlan>;
  execute(plan: DeploymentPlan, commandId: string): Promise<string>;
  status(taskId: string): Promise<TaskSnapshotV01>;
  cancel(taskId: string, revision: number): Promise<void>;
  /** Live step facts; task.get remains authoritative for final/cancellation/recovery state. */
  subscribe(taskId: string, callback: (step: DeploymentProgress) => void): Unsubscribe;
}

export interface EnvironmentPort {
  readonly play?: PlayPort;
  readonly managers?: { inspect(): Promise<CreatorManagers> };
  readonly network?: NetworkPort;
  readonly deployment?: DeploymentPort;
  /** 只读快照:渲染前拉取;订阅推送到达前不得把本地缓存当事实来源 */
  snapshot(): Promise<EnvironmentView>;
  /** 订阅快照广播(检测完成、状态变化时推送) */
  subscribe(callback: (view: EnvironmentView) => void): Unsubscribe;
  /**
   * 环境检测意图(C-ENV):用户主动触发指定辖区的检测;实现经 subscribe
   * 推送该辖区 running → results / failed 迁移(running/failed 须携带
   * 上次证据 last),本方法返回调用时刻的最新快照。
   * 真实检测器未接入时 capability 为 unavailable,
   * 入口按钮不出现(§2.6,而非禁用)。
   */
  runCheck(zone: CheckZone): Promise<EnvironmentView>;
  /**
   * 修复计划意图(C-ENV):为指定检测项生成版本化修复计划(计划/确认/
   * 引导执行;安装器与下载执行 M5)。能力不可用时返回 unavailable,
   * 入口按钮不出现(与 runCheck 同一 capability 门控)。
   */
  planFix(checkId: string): Promise<FixPlanResult>;
  capability(): Promise<CapabilityReport>;
}

export interface PlayPort {
  observe(route: PlayRoute): Promise<PlaySession>;
  start(route: PlayRoute, commandId: string): Promise<PlaySession>;
  stop(route: PlayRoute, commandId: string): Promise<PlaySession>;
}

/** Explicit HTTPS diagnostics, independent of software readiness and the legacy TCP check. */
export interface NetworkPort {
  websiteCapability(): Promise<CapabilityReport>;
  testWebsites(urls: readonly string[]): Promise<readonly WebsiteObservation[]>;
  capability(): Promise<CapabilityReport>;
  check(intent: NetworkIntent): Promise<NetworkReport>;
}

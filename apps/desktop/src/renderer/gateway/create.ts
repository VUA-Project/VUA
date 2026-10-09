import { createElectronGateway } from "./electron-gateway.ts";
import { emptyGateway } from "./empty-gateway.ts";
import { fixtureGateway } from "./fixture-gateway.ts";
import type { VuaGateway } from "./gateway.ts";
import {
  anyFixturePort,
  readDevPortSelection,
  type DevPortSelectionState,
} from "../app/dev-port-selection.ts";
import type { StoredGoalsV1 } from "../app/onboarding-model.ts";

/**
 * Gateway 装配(原则①硬防线):
 * - 生产构建:import.meta.env.DEV 恒 false,无条件 emptyGateway(not-run)。
 *   Desktop Gateway v1(app.snapshot)尚未覆盖八领域端口,各端口呈现诚实
 *   not-run 状态;fixture-gateway 模块在此分支不可达,被 Rollup 剔除
 *   (check-leak 验证)。AMF 契约切片接入后,此处装配经 window.vua.gateway
 *   的 Electron live 实现,页面零重写;
 * - 开发构建(018 批 1,per-port 混合装配):live(真实 Electron 链路)为
 *   基线;开发模式区(设置-实验性,会话级)可把任一端口切到 fixture——
 *   任一 fixture 端口即「演示数据」徽标恒显(原则①聚合语义)。场景套装
 *   切换(DevScenarioBar)退役(C1);fixture 数据档位由装配内固定档承载,
 *   场景资产按端口拆档演进(018 §4.4)。
 */

/** per-port 混合装配:selection 覆盖的端口取 fixture,其余取 live 基线。
 *  live 基线在无 Electron 宿主时为 emptyGateway(not-run 诚实空态)——
 *  「live 目标」在无宿主浏览器里诚实呈现不可用,不伪造。 */
function assembleDevGateway(
  selection: DevPortSelectionState,
  initialGoals: StoredGoalsV1 | null,
): VuaGateway {
  const live =
    window.vua === undefined
      ? emptyGateway(initialGoals)
      : createElectronGateway(window.vua, initialGoals);
  const fixture = fixtureGateway(selection.fixtureTier, initialGoals);
  return {
    amfModule: anyFixturePort(selection.targets) ? fixture.amfModule : live.amfModule,
    environment: selection.targets.environment === "fixture" ? fixture.environment : live.environment,
    tutorial: selection.targets.tutorial === "fixture" ? fixture.tutorial : live.tutorial,
    modelProduction:
      selection.targets.modelProduction === "fixture"
        ? fixture.modelProduction
        : live.modelProduction,
    toolCatalog:
      selection.targets.toolCatalog === "fixture" ? fixture.toolCatalog : live.toolCatalog,
    task: selection.targets.task === "fixture" ? fixture.task : live.task,
    settings: selection.targets.settings === "fixture" ? fixture.settings : live.settings,
    acquire: selection.targets.acquire === "fixture" ? fixture.acquire : live.acquire,
    warehouseCommands:
      selection.targets.warehouseCommands === "fixture"
        ? fixture.warehouseCommands
        : live.warehouseCommands,
    projectOps:
      selection.targets.projectOps === "fixture" ? fixture.projectOps : live.projectOps,
    // 019 批 C:生产链无 fixture 目标(禁模拟替代未完成接口)——恒 live
    // 基线(无宿主时为 not-run 诚实不可用),开发切档不产生演示生产数据
    productionChain: live.productionChain,
    // 029 B 面环 4:配方导出同观察事实纪律(草稿不模拟)——恒 live 基线,
    // 无宿主时诚实缺席;转正走既有保存链,开发切档不产生演示草稿
    recipeExport: live.recipeExport,
    recipe: live.recipe,
    // bdl-queries v0.5 消费准备切片:依赖反查/观察列同观察事实纪律(线索/
    // 建议不模拟)——恒 live 基线,无宿主时诚实缺席;开发切档不产生演示
    // 依赖事实(消费页面候 U18 终裁后切片)
    dependencies: live.dependencies,
    // M7 消费批:检查读面同 productionChain 纪律(观察事实不模拟)——恒
    // live 基线,无宿主时诚实缺席
    inspection: live.inspection,
    // 023 消费切片:交接命令同纪律——恒 live 基线,无宿主时诚实缺席
    releaseHandoff: live.releaseHandoff,
    // U19 第二交付:open 检查入口同纪律——恒 live 基线(路由已入库 v0.2,
    // live 装配已接线;无宿主时诚实缺席),开发切档不产生演示打开受理
    releaseProjectOpen: live.releaseProjectOpen,
    packages: selection.targets.packages === "fixture" ? fixture.packages : live.packages,
    dataSource: () => (anyFixturePort(selection.targets) ? "fixture" : live.dataSource()),
  };
}

export type GatewayStateName = "live" | "not-run" | "dev-mixed";

export function createGatewayState(
  initialGoals: StoredGoalsV1 | null,
): { gateway: VuaGateway; name: GatewayStateName } {
  // #27 诊断自检(仅 DEV,生产构建随 DEV 门控剔除):Electron 宿主内壳 API
  // 缺失 = preload 未注入(加载失败/路径错误),此时整壳呈 not-run「未接入」
  // 且内嵌浏览器回退——四症状同源。显式 console.warn 让 DevTools 一眼定位,
  // 不改变任何呈现语义(页面仍诚实 not-run)
  if (import.meta.env.DEV && window.vua === undefined && /Electron/i.test(navigator.userAgent)) {
    console.warn(
      "[vua] Electron host detected but window.vua is undefined - preload script did not inject (load failure? path wrong? sandbox require rejected?).",
    );
  }
  if (!import.meta.env.DEV) {
    // F2:Electron 宿主内走 live Gateway(任务/环境直达应用层);纯浏览器
    // 打开生产产物时无 preload,保持 not-run 诚实空态(check-leak 验证
    // fixture 仍只在 DEV 分支可达)
    if (window.vua === undefined) {
      return { gateway: emptyGateway(initialGoals), name: "not-run" };
    }
    return {
      gateway: createElectronGateway(window.vua, initialGoals),
      name: "not-run",
    };
  }
  // 018 批 1:per-port 混合装配(开发模式区选择;DevScenarioBar 套装退役)
  const selection = readDevPortSelection();
  if (Object.keys(selection.targets).length === 0) {
    // 无 per-port 覆盖:live 基线(无宿主=not-run 诚实空态)
    if (window.vua === undefined) {
      return { gateway: emptyGateway(initialGoals), name: "not-run" };
    }
    return { gateway: createElectronGateway(window.vua, initialGoals), name: "live" };
  }
  return { gateway: assembleDevGateway(selection, initialGoals), name: "dev-mixed" };
}

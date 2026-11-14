import type { EnvironmentPort } from "./environment-port.ts";
import type { ModelProductionPort } from "./model-production-port.ts";
import type { AcquirePort } from "./acquire-port.ts";
import type { PackagesPort } from "./packages-port.ts";
import type { SettingsPort } from "./settings-port.ts";
import type { TaskPort } from "./task-port.ts";
import type { ToolCatalogPort } from "./tool-catalog-port.ts";
import type { TutorialPort } from "./tutorial-port.ts";
import type { WarehouseCommandsPort } from "./warehouse-commands-port.ts";
import type { ProjectOpsPort } from "./project-ops-port.ts";
import type { ProductionChainPort } from "./production-chain-port.ts";
import type { RecipeExportPort } from "./recipe-export-port.ts";
import type { DependenciesPort } from "./dependencies-port.ts";
import type { InspectionPort } from "../features/inspection/inspection-port.ts";
import type { ReleaseHandoffPort } from "../features/release/release-handoff-port.ts";
import type { ReleaseProjectOpenPort } from "../features/release/release-project-open-port.ts";
import type { DataSource } from "./types.ts";

/**
 * VuaGateway(G3):九个领域窄端口的组合,表现层唯一的取数与意图入口。
 * 端口按领域划分(M0),不按 React 页面划分;实现可整体替换
 * (fixture / not-run / 未来 Tauri live),页面零重写。
 */
export interface VuaGateway {
  readonly aiTools?: import("@vua/contracts").DesktopAiToolsApiV01 | undefined;
  readonly amfProduction?: import("./amf-production-port.ts").AmfProductionPort | undefined;
  /** 素材库列表共享端口(与 library-browser-instance 同一实现);未注入时
   * 消费方退单例——预览/测试借此替换素材库读数 */
  readonly libraryBrowser?: import("./library-browser-port.ts").LibraryBrowserPort | undefined;
  readonly amfRelease?: import("./amf-release-port.ts").AmfReleasePort | undefined;
  /** vrchat-session v0.1(实验性 VRChat 登录):恒 live 基线,无宿主时诚实缺席 */
  readonly vrchat?: import("./vrchat-port.ts").VrchatPort | undefined;
  /** VN3 terms read from products' public license links (terms v0.1). */
  readonly terms?: import("./terms-port.ts").TermsPort | undefined;
  readonly distribution?: import("@vua/contracts").DesktopDistributionApiV01 | undefined;
  readonly componentUpdates?: import("@vua/contracts").DesktopComponentUpdatesApiV02 | undefined;
  readonly updatePlans?: import("@vua/contracts").DesktopUpdatePlansApiV01 | undefined;
  readonly amfUiRuntime?: import("@vua/contracts").DesktopAmfUiRuntimeApiV01 | undefined;
  /** Signed entry-guide content channel (`guide-content` v0.1): on-demand Main verification with cached/bundled fallback. */
  readonly guideContent?: import("@vua/contracts").DesktopGuideContentApiV01 | undefined;
  /** Manual Avatar-scoped BOOTH free-asset discovery (`booth-free-assets` v0.1). */
  readonly freeAssets?: import("./free-assets-port.ts").FreeAssetsPort | undefined;
  readonly amfModule: import("@vua/contracts").AmfModuleApiV01;
  readonly environment: EnvironmentPort;
  readonly tutorial: TutorialPort;
  readonly modelProduction: ModelProductionPort;
  readonly toolCatalog: ToolCatalogPort;
  readonly task: TaskPort;
  readonly settings: SettingsPort;
  readonly acquire: AcquirePort;
  /** F4-9:warehouse 写命令面(bdl-commands v0.1;acquire 读取面保持只读) */
  readonly warehouseCommands: WarehouseCommandsPort;
  /** F6/014:项目操作写面(project.import-copy 副本导入确认链) */
  readonly projectOps: ProjectOpsPort;
  /** 019 批 C:生产链共享端口(解析/计划/任务/记录;两套 UI 共用) */
  readonly productionChain: ProductionChainPort;
  /** 029 B 面环 4:配方导出端口(recipe.exportProjectDraft 同步只读;草稿
   *  转正唯一通道 = 用户显式确认后的既有 recipe.save 保存链) */
  readonly recipeExport: RecipeExportPort;
  readonly recipe: import("./recipe-port.js").RecipePort;
  /** bdl-queries v0.5 消费准备切片:依赖反查/观察列只读端口
   *  (dependencies.lookup 建议面 / dependencies.listByProduct 线索面;
   *  消费页面候 U18 终裁后切片,缺席臂 = 控制不渲染先例) */
  readonly dependencies: DependenciesPort;
  /** M7 检查切片消费批:检查读面端口(inspection.get/list;016 仲裁
   *  独立词表行) */
  readonly inspection: InspectionPort;
  /** M7 消费切片:release.openForHandoff 交接命令端口(023 词表行;
   *  实现域未接线=诚实缺席语义) */
  readonly releaseHandoff: ReleaseHandoffPort;
  /** U19 第二交付:「在 Unity 中打开以检查/修复」独立端口(与交棒显式
   *  分离,不按记录状态闸;路由已入库 release-handoff v0.2,live 装配
   *  接线,empty/fixture 保持各自诚实缺席语义) */
  readonly releaseProjectOpen: ReleaseProjectOpenPort;
  readonly packages: PackagesPort;
  /** 数据来源标识:驱动"演示数据"徽标(原则①) */
  dataSource(): DataSource;
}

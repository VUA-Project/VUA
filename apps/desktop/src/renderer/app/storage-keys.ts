/**
 * 浏览器存储键唯一来源(G2-A):应用代码与调试/走查入口共用同一份定义,
 * 防止键名漂移。
 * - lastPage / goals 用 localStorage(跨会话);
 * - scenario 用 sessionStorage(仅本次会话,见 DevScenarioBar)。
 */
export const storageKeys = {
  displayMode: "vua-display-mode",
  firstRunJourney: "vua-first-run-journey-v1",
  /** Explicit PICO official distribution choice, independent of UI language. */
  picoRegion: "vua-pico-region",
  /** Accepted task bookmark only; contains no plan digest or installation result. */
  deploymentReceiptPlay: "vua-deployment-receipt-play-v1",
  deploymentReceiptCreate: "vua-deployment-receipt-create-v1",
  /** Website destinations only; measured responses remain session-local. */
  testWebsites: "vua-test-websites-v1",
  /** N1 download-source preference; absence enables region-aware mirror fallback. */
  unityMirrors: "vua-unity-mirrors",
  lastPage: "vua-last-page",
  scenario: "vua-scenario",
  goals: "vua-goals",
  /** 素材生命周期(G8):版本化 StoredLifecycleV1,见 features/warehouse/asset-lifecycle.ts */
  lifecycle: "vua-asset-lifecycle",
  /** 调试模式(G8 用户反馈):见 app/debug-mode.ts */
  debugMode: "vua-debug-mode",
  /** Recipe 图谱布局(C-RECIPE-2):版本化 StoredRecipeLayoutsV1,见 features/recipe/recipe-layout-model.ts */
  recipeLayout: "vua-recipe-layout",
  /** 配方版本管理器(S-IX-4):版本化 StoredRecipeVersionsV1,见 features/recipe/recipe-versions.ts */
  recipeVersions: "vua-recipe-versions",
  /** 主题偏好(2026-10-09 默认深色裁决):dark | light | system;缺省 dark;
   *  旧版写入的 dark|light 仍是合法子集。解析/写入见 app/theme-preference.ts */
  theme: "vua-theme",
  /** 界面语言(C-I18N):LocaleId;缺省走系统探测,fallback 见 i18n/locales.ts */
  locale: "vua-locale",
  /** 指南阅读位置(首玩 B 切片):版本化前仅存 {topic, section?};只保存阅读
   *  信息,不保存账号信息或部署任务进度;读写见 features/guide/guide-target.ts */
  guideReading: "vua-guide-reading",
  /** 应用导览进度(三类引导裁决 2026-10-05):版本化 TourProgressV1
   *  {v,status,step};独立于阅读器阅读位置与安装任务状态;读写见
   *  features/tour/tour-model.ts */
  tourProgress: "vua-tour-progress",
  /** 游戏引导进度(三类引导 §4 手动版):版本化 GameGuideProgressV1
   *  {v,current,decided};只记录玩家自己确认/跳过过哪些步骤,不代表
   *  VUA 检查或更改了游戏设置;读写见 features/game-guide/game-guide-model.ts */
  gameGuideProgress: "vua-game-guide-progress",
  /** 游戏引导呈现偏好(透明度 0.2–1,缺省 0.5 用户裁决):版本化
   *  GameGuidePresentationV1;与进度分键;读写同上 */
  gameGuidePresentation: "vua-game-guide-presentation",
  /** 游戏引导跟随偏好(guidance §4,缺省 true 用户裁决):版本化
   *  GameGuideFollowingV1 {v,enabled};渲染层只持久化与推送,Main 强制
   *  执行;读写同上 */
  gameGuideFollowing: "vua-game-guide-following",
  /** 高对比度(C-I18N):"auto" 跟随系统 forced-colors | "on" 始终开启;缺省 auto */
  hc: "vua-hc",
  /** 动态特效总开关(S-VFX-5,VR/省资源):"on" | "off";缺省 on */
  effects: "vua-effects",
  /** SteamVR 运行时自动打开资源节约模式:"on" | "off";缺省 off(检测器接入后生效,issue #27) */
  effectsAuto: "vua-effects-auto-steamvr",
  /** 通知中心已清除通知(proposal 007 路径 b):已清除终态任务 id 的 JSON 数组;
   *  只隐藏通知呈现,任务权威事实仍可经任务列表/详情面查询 */
  notificationDismissed: "vua-notification-dismissed",
  /** 「生成后删除原始素材文件」偏好(W15 重做,proposal 008 未决):"on" | "off";
   *  缺省 off。当前为未接线呈现层偏好——全局自动删除语义超出已冻结的条目级
   *  deleteOriginals,协议面随 proposal 008 裁决;开启仅记录意图,不触发任何
   *  服务端行为 */
  deleteOriginalsAfterGenerate: "vua-delete-originals-after-generate",
  /** 「下载前弹清单」(N5 静默下载,2026-10-05):"on" | "off";缺省 off
   *  (Steam 式直下全部);on = 右键下载先弹文件勾选清单(默认全选) */
  downloadChecklist: "vua-download-checklist",
  /** Optional N5 dependency clues and exact-name reverse lookup; absent = off. */
  dependencyClues: "vua-dependency-clues",
  /** 开发模式 per-port 连接目标(018,裁决 13;DEV-only):sessionStorage,
   *  JSON 形态 { [DevPortId]: "live" | "fixture" };解析/校验见
   *  app/dev-port-selection.ts,生产构建恒无此键消费 */
  devPortSelection: "vua-dev-port-selection",
  /** 多套 UI 根选择(019 批 A,需求 §2.1 首批开发设置入口):sessionStorage,
   *  值 = ui-registry 的 UiRootId(current | forest-green);共享容器
   *  (GatewayProvider)不随切换重建 */
  uiRootSelection: "vua-ui-root-selection",
  /** 版本检测开关(2026-09-19 裁决:默认开启、设置可关):absent/"on" = 开,
   *  "off" = 关;见 app/update-check-store.ts */
  updateCheckEnabled: "vua-update-check-enabled",
  /** 版本检测最近结果缓存(开屏角标/设置页冷启动呈现):版本化
   *  StoredUpdateCheckV1;见 app/update-check-store.ts */
  updateCheckCache: "vua-update-check-cache",
  /** 素材导入应用内文件夹选择器的上次浏览目录(2026-09-25 用户裁决):
   *  裸路径字符串,非法/缺失 = 回落用户主目录;见
   *  features/import/folder-picker-model.ts */
  importLastFolder: "vua-import-last-folder",
} as const;

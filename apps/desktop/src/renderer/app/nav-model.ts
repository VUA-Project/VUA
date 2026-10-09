import type { Strings } from "../i18n/strings.en.ts";
import type { TermId } from "../i18n/terms.ts";

/** Stable feature ownership and deep links. The visible shell uses one fixed directory
 * and a Home entry on the brand mark (2026-10-08 user ruling). Business module IDs
 * remain compatible with existing settings, task origins and provider adapters. */

/** 两类用户目标(业务模块);与首次引导的目标 id 一致(onboarding-model.GoalId) */
export type BusinessModuleId = "env" | "production";

/** Stable business ownership plus the independent settings section. Home is global. */
export type AppSectionId = BusinessModuleId | "settings";

export type PageId =
  | "home"
  | "environment-hub"
  | "avatar-hub"
  | "help"
  | "env-play"
  | "env-create"
  | "warehouse"
  | "recipe"
  | "inspection"
  | "release"
  | "workshop"
  | "packages"
  | "tools-discover"
  | "tools-devices"
  | "tools-calibration"
  | "tools-installed"
  | "settings-modules"
  | "settings-goals"
  | "settings-environment"
  | "settings-accounts"
  | "settings-language"
  | "settings-theme"
  | "settings-version"
  | "settings-experimental"
  | "settings-about"
  | "settings-donate";

type NavTabKey = keyof Strings["nav"]["tabs"];
type NavGroupKey = keyof Strings["nav"]["groups"];
type NavPageKey = keyof Strings["nav"]["pages"];

export interface SidebarPage {
  id: PageId;
  /** 文案 key(strings.nav.pages);术语页为 null */
  labelKey: NavPageKey | null;
  /** 术语页标签:由这些术语组成(表现层 termLabel/termSequence 渲染) */
  labelTerms?: readonly TermId[];
}

export interface SidebarGroup {
  /** 分组标签 key(strings.nav.groups),无分组时省略 */
  labelKey?: NavGroupKey;
  pages: SidebarPage[];
}

export interface ModuleDef {
  id: AppSectionId;
  /** Tab 文案 key(strings.nav.tabs) */
  labelKey: NavTabKey;
  defaultPage: PageId;
  groups: SidebarGroup[];
  /** 整页宽布局模块不渲染二级侧栏(机制保留;指挥台退役后当前无使用者) */
  hideSidebar?: boolean;
}

/** Default landing (2026-10-08): Home replaces the retired two-tab landing.
 * Historical rationale:无历史页面时打开环境部署(2026-09-25 用户裁决:指挥台
 *  页退役,生产着陆前移——环境部署是四类用户目标之首的默认页) */
export const defaultPage: PageId = "home";

/** Stable business ownership for existing pages and deep links, independent of visible Home. */
export const businessModules: readonly ModuleDef[] = [
  {
    id: "env",
    labelKey: "env",
    defaultPage: "env-play",
    // 2026-09-26 用户裁决:工具合集模块并入环境部署,页面 id 不变(深链接
    // #/tools-* 保持有效),成为第二个侧栏分组;组标签机制随之启用
    groups: [
      {
        labelKey: "env",
        pages: [
          { id: "env-play", labelKey: "envPlay" },
          { id: "env-create", labelKey: "envCreate" },
        ],
      },
      {
        labelKey: "tools",
        pages: [
          { id: "tools-discover", labelKey: "toolsDiscover" },
          { id: "tools-devices", labelKey: "toolsDevices" },
          { id: "tools-calibration", labelKey: "toolsCalibration" },
          { id: "tools-installed", labelKey: "toolsInstalled" },
        ],
      },
    ],
  },
  {
    id: "production",
    labelKey: "production",
    defaultPage: "warehouse",
    // 2026-09-20 导航重构(用户裁决):无组标签平铺,与其它模块一致——
    // 素材导入/搭配草稿不再是独立页,收敛为仓储页/配方页 hero 内的
    // 内容型弹窗(ContentDialog 承载原页面组件,见 WarehousePage/
    // RecipePage);检查页(BG-15,设计标准 §8.6)保持独立页,是主流程
    // 「装配 → 检测 → SDK 交接」中独立于车间的检测落点
    groups: [
      {
        pages: [
          { id: "warehouse", labelKey: null, labelTerms: ["warehouse"] },
          { id: "recipe", labelKey: null, labelTerms: ["recipe"] },
          { id: "inspection", labelKey: null, labelTerms: ["inspection"] },
          { id: "release", labelKey: null, labelTerms: ["release"] },
          // 2026-09-25 用户裁决:复合术语序列(装配 → 生产 → 检测)退役为
          // 「车间」——术语行退化成自指缩写,直给词面更诚实
          { id: "workshop", labelKey: "workshop" },
          { id: "packages", labelKey: "packages" },
        ],
      },
    ],
  },
];

/** 设置区:固定顶部最右侧,承载目标重选、语言、主题、版本、关于与捐赠(§2.1) */
export const settingsModule: ModuleDef = {
  id: "settings",
  labelKey: "settings",
  defaultPage: "settings-goals",
  groups: [
    {
      pages: [
        { id: "settings-modules", labelKey: "settingsModules" },
        { id: "settings-goals", labelKey: "settingsGoals" },
        { id: "settings-environment", labelKey: "settingsEnvironment" },
        { id: "settings-accounts", labelKey: "settingsAccounts" },
        { id: "settings-language", labelKey: "settingsLanguage" },
        { id: "settings-theme", labelKey: "settingsTheme" },
        { id: "settings-version", labelKey: "settingsVersion" },
        { id: "settings-experimental", labelKey: "settingsExperimental" },
        { id: "settings-about", labelKey: "settingsAbout" },
        { id: "settings-donate", labelKey: "settingsDonate" },
      ],
    },
  ],
};

export const modules: readonly ModuleDef[] = [...businessModules, settingsModule];

const pageModule = new Map<PageId, AppSectionId>(
  modules.flatMap((m) => m.groups.flatMap((g) => g.pages.map((p) => [p.id, m.id] as const))),
);

for (const [page, section] of [["home", "settings"], ["help", "settings"], ["environment-hub", "env"], ["avatar-hub", "production"]] as const) pageModule.set(page, section);

const pageIds = new Set<string>(pageModule.keys());

export function isPageId(value: string | null): value is PageId {
  return value !== null && pageIds.has(value);
}

export function moduleOf(page: PageId): AppSectionId {
  const found = pageModule.get(page);
  if (!found) throw new Error(`unknown page: ${page}`);
  return found;
}

export function moduleDef(id: AppSectionId): ModuleDef {
  const found = modules.find((m) => m.id === id);
  if (!found) throw new Error(`unknown module: ${id}`);
  return found;
}

/**
 * 从启动落点到达某页所需点击数:
 * 同模块内 = 1 次侧栏点击;跨模块 = 1 次 Tab + 至多 1 次侧栏;
 * 最坏情况 2 次(§2.1:进入对应 Tab 后一次点击到达)。
 */
export function clicksToReach(page: PageId, from: PageId = defaultPage): number {
  if (page === from) return 0;
  if (moduleOf(page) === moduleOf(from)) return 1;
  return page === moduleDef(moduleOf(page)).defaultPage ? 1 : 2;
}

/** Tab 落点:进入该模块的默认页,不做门控 */
export function resolveTabLanding(tab: AppSectionId): PageId {
  return moduleDef(tab).defaultPage;
}

/**
 * 顶栏窄窗折叠(2026-09-25 用户裁决:品牌副标题退役,梯子随之简化):
 * 品牌区宽度恒定后分级收敛为两级——
 * - 0 级 = 完整(全量 Tab);
 * - 1 级 = 整排 Tab 收进一个折叠按钮(NavOverflowMenu 展开原控件);
 * 回扩要求可用宽度多出 BUFFER 余量防临界点抖动;各级宽度全部由表现层
 * 实测传入,本函数保持纯。
 */
/** 回扩余量:恢复完整要求可用宽度多出这么多 */
export const NAV_LEVEL_BUFFER_PX = 24;

export type NavLevel = 0 | 1;

export interface NavLevelInput {
  readonly level: NavLevel;
  /** 全量 Tab 自然宽(量尺行实测) */
  readonly required: number;
  /** 轨道内容盒当前宽 */
  readonly available: number;
}

export function navLevelNext(input: NavLevelInput): NavLevel {
  const { level, required, available } = input;
  if (level === 0) return required > available ? 1 : 0;
  return required <= available - NAV_LEVEL_BUFFER_PX ? 0 : 1;
}

/**
 * 判定输入快照(#28 顶栏抖动修复;2026-09-25 随两级化修订):决定分级的外部
 * 事实是窗口宽、全量 Tab 自然宽与轨道可用宽。副标题时代折叠动作会经品牌区
 * 收放改变轨道宽(自反馈),快照曾刻意排除 available——那同时吞掉了布局沉降
 * 后的合法重判,是「启动即卡最窄态」缺陷的根因(首判用副标题在位的几何连降
 * 两级,品牌收起让出宽度后,快照未变守卫把纠正触发吞掉)。品牌区宽度恒定后
 * available 只随外部事实变化,纳入快照不再构成自反馈环;快照未变即观察者
 * 噪声,判定跳过——语言切换与用户改窗照常重判。
 */
export interface NavMeasureSnapshot {
  /** 视口宽(window.innerWidth) */
  readonly windowWidth: number;
  /** 全量 Tab 自然宽(量尺行实测) */
  readonly required: number;
  /** 轨道内容盒宽(折叠/展开不改变:容器 flex:1,品牌区恒定) */
  readonly available: number;
}

export function navMeasureChanged(
  prev: NavMeasureSnapshot | null,
  next: NavMeasureSnapshot,
): boolean {
  if (prev === null) return true;
  return prev.windowWidth !== next.windowWidth
    || prev.required !== next.required
    || prev.available !== next.available;
}

/** Installed module state, never onboarding goals, controls AMF navigation. */
export function isAmfPage(page: PageId): boolean { return moduleOf(page) === "production"; }
export function availablePage(page: PageId, amfInstalled: boolean): PageId { return !amfInstalled && isAmfPage(page) ? "settings-modules" : page; }

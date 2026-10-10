import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { strings } from "../i18n/strings.zh-CN.ts";
import { TERMS, termSequence, type TermId } from "../i18n/terms.ts";
import {
  businessModules,
  clicksToReach,
  defaultPage,
  isPageId,
  moduleOf,
  modules,
  NAV_LEVEL_BUFFER_PX,
  navLevelNext,
  navMeasureChanged,
  resolveTabLanding,
  settingsModule,
  type ModuleDef,
  type NavMeasureSnapshot,
  type SidebarPage,
} from "./nav-model.ts";

/**
 * BOARD #8:termSequence 经 current-table 按宿主 navigator 选表,CI(en-US)
 * 解析到 en 表注解为空串,期望中文注解的断言随之失败。测试显式固定语言表
 * 为 zh-CN,不依赖宿主 locale。
 */
vi.mock("../i18n/current-table.ts", async () => {
  const { strings: zhCN } = await import("../i18n/strings.zh-CN.ts");
  return { currentLocale: "zh-CN", currentStrings: zhCN };
});

const allPages = modules.flatMap((m) => m.groups.flatMap((g) => g.pages));
const allPageIds = allPages.map((p) => p.id);

function pageLabel(page: SidebarPage): string {
  if (page.labelTerms) return termSequence(page.labelTerms);
  if (page.labelKey) return strings.nav.pages[page.labelKey];
  throw new Error(`page without label: ${page.id}`);
}

function moduleLabel(def: ModuleDef): string {
  return strings.nav.tabs[def.labelKey];
}

test("top-level structure is two goal tabs plus an independent settings section", () => {
  // 2026-09-25 用户裁决:指挥台(home)页退役——首 Tab 为环境部署;
  // 2026-09-26 用户裁决:工具合集并入环境部署、游戏引导迁至覆盖层窗口,
  // 顶栏剩两个业务模块
  assert.deepEqual(
    businessModules.map((m) => m.id),
    ["env", "production"],
  );
  assert.equal(settingsModule.id, "settings");
  assert.deepEqual(
    modules.map((m) => m.id),
    ["env", "production", "settings"],
  );
});

test("every feature page is reachable within two clicks", () => {
  for (const page of allPageIds) {
    assert.ok(clicksToReach(page) <= 2, `${page} needs ${clicksToReach(page)} clicks`);
  }
});

test("no forced redirects: tab landing is unconditional, workshop stays workshop", () => {
  // v0.3.3 §2.1:不自动切页;车间阻断由页面内阻断态表达,导航层不再门控
  assert.equal(resolveTabLanding("production"), "warehouse");
  assert.equal(resolveTabLanding("env"), "env-play");
  assert.equal(resolveTabLanding("settings"), "settings-theme");
  assert.ok(isPageId("workshop"));
  assert.ok(clicksToReach("workshop") <= 2);
});

test("every page belongs to exactly its own module", () => {
  assert.equal(moduleOf("env-play"), "env");
  assert.equal(moduleOf("env-create"), "env");
  assert.equal(moduleOf("warehouse"), "production");
  assert.equal(moduleOf("recipe"), "production");
  assert.equal(moduleOf("inspection"), "production");
  assert.equal(moduleOf("release"), "production");
  assert.equal(moduleOf("workshop"), "production");
  assert.equal(moduleOf("packages"), "production");
  // 2026-09-26 用户裁决:工具合集并入环境部署——页面 id 不变,模块归属换为 env
  assert.equal(moduleOf("tools-discover"), "env");
  assert.equal(moduleOf("tools-devices"), "env");
  assert.equal(moduleOf("tools-calibration"), "env");
  assert.equal(moduleOf("tools-installed"), "env");
  assert.equal(moduleOf("settings-about"), "settings");
  for (const page of ["help-wizard", "help-tour", "help-game-assistant", "help-encyclopedia"] as const) assert.equal(moduleOf(page), "env");
  for (const retired of ["settings-version", "settings-language", "settings-donate"]) assert.equal(isPageId(retired), false);
  assert.equal(moduleOf("settings-experimental"), "settings");
  assert.equal(isPageId("settings-goals"), false);
});

test("environment module carries the merged tools group with labels, page ids unchanged", () => {
  // 2026-09-26 用户裁决:工具合集成为环境部署的第二侧栏分组;
  // 组标签机制首次启用(环境/工具),深链接 #/tools-* 保持有效
  const env = modules.find((m) => m.id === "env");
  assert.equal(env?.defaultPage, "env-play");
  assert.deepEqual(
    env?.groups.map((g) => g.labelKey),
    ["env", "tools"],
  );
  assert.deepEqual(
    env?.groups[0]?.pages.map((p) => p.id),
    ["env-play", "tools-discover", "env-create", "help"],
  );
  assert.deepEqual(
    env?.groups[1]?.pages.map((p) => p.id),
    ["tools-devices", "tools-calibration", "tools-installed"],
  );
  assert.equal(strings.nav.groups.env, "环境");
  assert.equal(strings.nav.groups.tools, "工具");
});

test("production sidebar is one flat group without a group label, pages in flow order", () => {
  // 2026-09-20 导航重构(用户裁决):模型生产与其余模块一致为无组标签平铺;
  // 素材导入/搭配草稿不再是页(收敛为仓储页/配方页内弹窗),检查页保持独立
  const production = modules.find((m) => m.id === "production");
  assert.equal(production?.groups.length, 1);
  assert.equal(production?.groups[0]?.labelKey, undefined);
  assert.deepEqual(
    production?.groups[0]?.pages.map((p) => p.id),
    ["warehouse", "recipe", "inspection", "release", "workshop", "packages"],
  );
});

test("every page has exactly one label source", () => {
  for (const m of modules) {
    for (const g of m.groups) {
      for (const p of g.pages) {
        assert.notEqual(p.labelKey !== null, p.labelTerms !== undefined, `page ${p.id} label`);
      }
    }
  }
});

test("label keys resolve in the string table and term ids are valid", () => {
  for (const m of modules) {
    assert.ok(m.labelKey in strings.nav.tabs, `tab key ${m.labelKey}`);
    for (const g of m.groups) {
      if (g.labelKey) assert.ok(g.labelKey in strings.nav.groups, `group key ${g.labelKey}`);
      for (const p of g.pages) {
        if (p.labelKey) assert.ok(p.labelKey in strings.nav.pages, `page key ${p.labelKey}`);
        for (const t of p.labelTerms ?? []) {
          assert.ok(t in TERMS, `page ${p.id} term ${t}`);
        }
      }
    }
  }
});

test("sidebar labels use localized names without English prefixes", () => {
  const warehouse = allPages.find((p) => p.id === "warehouse");
  assert.equal(warehouse ? pageLabel(warehouse) : "", "仓储");
  // 2026-09-25 用户裁决:车间侧栏标签由复合术语序列(装配 → 生产 → 检测)
  // 改为直给词面「车间」
  const workshop = allPages.find((p) => p.id === "workshop");
  assert.equal(workshop ? pageLabel(workshop) : "", "车间");
});

test("tab labels come from the string table (two goals + settings)", () => {
  // 2026-09-26 用户裁决:工具合集并入环境部署、游戏引导迁至覆盖层窗口,
  // 顶栏剩两个业务模块
  assert.deepEqual(
    modules.map((m) => moduleLabel(m)),
    ["环境部署", "模型生产", "设置"],
  );
});

test("nav ladder: 两级折叠——真溢出才收进折叠按钮,回扩带余量", () => {
  // 0 级:排得下保持(等宽也不收)
  assert.equal(navLevelNext({ level: 0, required: 600, available: 600 }), 0);
  // 0 级:真正溢出才折叠到 1
  assert.equal(navLevelNext({ level: 0, required: 601, available: 600 }), 1);
  // 1 级:回扩到 0 要求 Tab 加余量排得下
  assert.equal(
    navLevelNext({ level: 1, required: 400, available: 400 + NAV_LEVEL_BUFFER_PX }),
    0,
  );
  assert.equal(
    navLevelNext({ level: 1, required: 400, available: 400 + NAV_LEVEL_BUFFER_PX - 1 }),
    1,
  );
  // 1 级:仍溢出保持折叠
  assert.equal(navLevelNext({ level: 1, required: 601, available: 600 }), 1);
});

test("nav measure snapshot: 外部事实未变即观察者噪声,判定跳过(#28 抖动修复)", () => {
  const snapshot: NavMeasureSnapshot = {
    windowWidth: 1000,
    required: 600,
    available: 700,
  };
  // 首次判定:无前值必判
  assert.equal(navMeasureChanged(null, snapshot), true);
  // 完全相同的快照:折叠/展开不改变自己量的三样事实,相同即噪声,断开
  // #28 临界振荡环(0↔1 反复切换)的判定回路
  assert.equal(navMeasureChanged(snapshot, { ...snapshot }), false);
  // 窗口宽变化(用户改窗/DevTools 开合):必须重判
  assert.equal(navMeasureChanged(snapshot, { ...snapshot, windowWidth: 1001 }), true);
  // 量尺行变化(语言切换/字体加载):必须重判
  assert.equal(navMeasureChanged(snapshot, { ...snapshot, required: 601 }), true);
  // 轨道宽变化(布局沉降/邻接控件增减):必须重判——2026-09-25 修订:
  // 副标题时代快照排除 available,曾把启动首判后的合法纠正触发吞成
  // 「自反馈」,致启动即卡最窄态;品牌区宽度恒定后 available 只随外部
  // 事实变化,纳入快照不再构成自反馈环
  assert.equal(navMeasureChanged(snapshot, { ...snapshot, available: 701 }), true);
});

test("default landing is the independent home", () => {
  // 2026-09-25 用户裁决:指挥台(home)页退役,默认落点为环境部署
  assert.equal(defaultPage, "home");
});

test("isPageId rejects unknown and legacy ids", () => {
  assert.ok(isPageId("env-play"));
  assert.ok(!isPageId("deployer-play"));
  // 2026-09-20 导航重构退役页:不再合法,存储的过期落点由 resolveEntry 回退默认页
  assert.ok(!isPageId("import-material"));
  assert.ok(!isPageId("compose"));
  // 2026-09-25 用户裁决:指挥台(home)页退役——存储的 home 落点同判非法,
  // resolveEntry 回退默认页(env-play)
  assert.ok(isPageId("home"));
  // 2026-09-26 用户裁决:游戏引导页退役(引导内容迁至覆盖层窗口)——存储的
  // guide-* 落点同判非法,resolveEntry 回退默认页(env-play)
  assert.ok(!isPageId("guide-start"));
  assert.ok(!isPageId("guide-basics"));
  assert.ok(!isPageId("guide-safety"));
  assert.ok(!isPageId("guide-devices"));
  assert.ok(!isPageId("guide-tutorials"));
  assert.ok(!isPageId("nope"));
  assert.ok(!isPageId(null));
});

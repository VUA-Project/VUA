import { formatDateTime } from "./i18n/index.ts";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { saveDebugMode, useDebugMode } from "./app/debug-mode.ts";
import {
  businessModules,
  defaultPage,
  isPageId,
  moduleDef,
  moduleOf,
  modules,
  navLevelNext,
  navMeasureChanged,
  resolveTabLanding,
  type AppSectionId,
  type ModuleDef,
  type NavLevel,
  type NavMeasureSnapshot,
  type PageId,
  type SidebarGroup,
  type SidebarPage,
} from "./app/nav-model.ts";
import {
  envGoalEnabled,
  goalEnabled,
  goalsStorageKey,
  parseStoredGoals,
  resolveEntry,
  serializeGoals,
  type GoalId,
  type StoredGoalsV1,
} from "./app/onboarding-model.ts";
import { resourceSaverActive, resourceSaverSource } from "./app/resource-saver.ts";
import { storageKeys } from "./app/storage-keys.ts";
import {
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
  toggledPreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./app/theme-preference.ts";
import {
  isUiRootAvailable,
  readUiRootSelection,
  writeUiRootSelection,
  type UiRootId,
} from "./app/ui-registry.ts";
import {
  ForestAvailabilityBadge,
  ForestVariantRoot,
} from "./app/ForestVariantRoot.tsx";
import {
  forestVariantEntries,
  resolveForestVariant,
} from "./app/ui-variant-discovery.ts";
import { Button } from "./components/primitives/Button.tsx";
import { BrandMark } from "./components/BrandMark.tsx";
import { Card } from "./components/primitives/Card.tsx";
import { EmptyState } from "./components/primitives/EmptyState.tsx";
import { Icon } from "@vua/design-system";
import { format, strings, termLabel, termSequence, TERMS } from "./i18n/index.ts";
import { currentLocale, localeRegistry } from "./i18n/index.ts";
import { creatorEnvReady } from "./features/deployer/deployer-model.ts";
import { DeployerPage } from "./features/deployer/DeployerPage.tsx";
import { OnboardingPage, type OnboardingResult } from "./features/onboarding/OnboardingPage.tsx";
import { NavigationConfirmOverlay } from "./app/NavigationConfirmOverlay.tsx";
import { AppTour } from "./features/tour/AppTour.tsx";
import { PackagesPage } from "./features/packages/PackagesPage.tsx";
import { ProductionIntroOverlay } from "./features/production/ProductionIntroOverlay.tsx";
import { RecipePage } from "./features/recipe/RecipePage.tsx";
import { ReleasePage } from "./features/release/ReleasePage.tsx";
import { InspectionPage } from "./features/inspection/InspectionPage.tsx";
import {
  nextIntroPhase,
  type ProductionIntroPhase,
} from "./features/production/production-intro-state.ts";
import { Taskbar } from "./features/task-center/Taskbar.tsx";
import { NotificationPopover } from "./features/task-center/NotificationPopover.tsx";
import { ResourceMonitor } from "./features/resource-monitor/ResourceMonitor.tsx";
import { BootSplash } from "./components/splash/BootSplash.tsx";
import { bootProgress } from "./app/boot-progress.ts";
import { ToolsPage, type ToolsPageId } from "./features/tools/ToolsPage.tsx";
import { WarehousePage } from "./features/warehouse/WarehousePage.tsx";
import { WorkshopPage } from "./features/workshop/WorkshopPage.tsx";
import {
  buildDiagnostics,
  downloadDiagnostics,
} from "./features/settings/diagnostics.ts";
import { ExperimentalCommands } from "./features/settings/experimental-commands.tsx";
import { DevModeSection } from "./features/settings/dev-mode-section.tsx";
import { EnvironmentSettingsPage } from "./features/settings/environment-page.tsx";
import { useAutoDeleteOriginals } from "./app/delete-originals-auto.ts";
import {
  runUpdateCheck,
  saveUpdateCheckEnabled,
  useUpdateCheckCache,
  useUpdateCheckEnabled,
} from "./app/update-check-store.ts";
import { appMeta } from "./app/app-meta.ts";
import { NavOverflowMenu } from "./app/NavOverflowMenu.tsx";
import { openExternalUrl } from "./app/open-external.ts";
import { isPaletteToggle } from "./app/shortcuts.ts";
import {
  CommandPalette,
} from "./features/command-palette/CommandPalette.tsx";
import type { CommandItem } from "./features/command-palette/command-palette-model.ts";
import {
  createGatewayState,
  type GatewayStateName,
  GatewayProvider,
  useDataSource,
  useEnvironmentView,
  useSettingsView,
  type VuaGateway,
} from "./gateway/index.ts";
import "./app-shell.css";
import "./features/settings/settings.css";

/** 高对比度(C-I18N):auto = 跟随系统 forced-colors;on = 显式高对比配色 */
type HcMode = "auto" | "on";

/** 动态特效总开关(S-VFX-5):on = 全装饰层;off = VR/省资源静态化 */
type EffectsMode = "on" | "off";

const lastPageStorageKey = storageKeys.lastPage;

/** 深链接读取(C-EFFICIENCY):#/page-id 形态;非法 id 回退 null */
function readHashPage(): PageId | null {
  try {
    const raw = window.location.hash.replace(/^#\/?/, "");
    return isPageId(raw) ? raw : null;
  } catch {
    return null;
  }
}

function readStoredPage(): string | null {
  try {
    return localStorage.getItem(lastPageStorageKey);
  } catch {
    return null;
  }
}

/**
 * DEV 只读覆盖(可视化走查用):?onboarded=1 视为"全部目标已选",
 * ?onboarded=skip 视为"已跳过";均不写入 localStorage,不影响真实首启流程。
 */
type OnboardingOverride = "all" | "skip" | null;

function readOnboardingOverride(): OnboardingOverride {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(window.location.search).get("onboarded");
  if (value === "1") return "all";
  if (value === "skip") return "skip";
  return null;
}

const overrideGoals: Record<Exclude<OnboardingOverride, null>, StoredGoalsV1> = {
  all: {
    version: 1,
    onboarding: "completed",
    goals: ["env", "production"],
    environments: ["play", "create"],
  },
  skip: { version: 1, onboarding: "skipped", goals: [], environments: [] },
};

function readStoredGoals(override: OnboardingOverride): StoredGoalsV1 | null {
  if (override !== null) return overrideGoals[override];
  try {
    return parseStoredGoals(localStorage.getItem(goalsStorageKey));
  } catch {
    return null;
  }
}

/* ---- 标签解析:模型只持有 key / 术语 id,文案在此查表(i18n 预备) ---- */

function tabLabel(def: ModuleDef): string {
  return strings.nav.tabs[def.labelKey];
}

function groupLabel(group: SidebarGroup): string | null {
  return group.labelKey ? strings.nav.groups[group.labelKey] : null;
}

function pageLabel(page: SidebarPage): string {
  if (page.labelTerms) return termSequence(page.labelTerms);
  if (page.labelKey) return strings.nav.pages[page.labelKey];
  throw new Error(`page without label: ${page.id}`);
}

/* ---- 占位页:功能未接入时的诚实空态(原则①) ---- */

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{title}</h1>
      </section>
      {/* 空态面板不再套大灰框(§氛围基线 #11):吉祥物静态帧 + 文案直放页面 */}
      <EmptyState title={strings.placeholders.notOpenTitle} description={description} />
    </div>
  );
}

/**
 * 设置-实验性页(W15 重做形态,用户走查示意图 A/B):单卡 = 标题+副题+警示条
 * +「生成 VPM 替代」全局开关(已冻结的 warehouse.setGlobalDefaultMode)+
 * 「生成后删除原始素材文件」危险开关(未接线偏好,确认对话框,proposal 008)。
 * 007 的「生成 VPM 模式入口」偏好开关被全局开关语义取代(提案 008 复核)。
 */
/* 森林绿 UI 根接线(019 批 D D-2)已迁至 app/ForestVariantRoot.tsx:
 * absent = 诚实不可用呈现(字段保留＋只读摘要＋返回现有界面入口);
 * present = 构建期发现的变体入口按需加载,失败如实呈现。共享容器
 * (GatewayProvider/事件/状态)在任何分支下继续存在——仅 UI 树替换。 */

function ExperimentalSettingsPage({
  uiRoot,
  onUiRootChange,
}: {
  uiRoot: UiRootId;
  onUiRootChange: (root: UiRootId) => void;
}) {
  const forestAvailable = isUiRootAvailable(
    "forest-green",
    resolveForestVariant(forestVariantEntries).status === "present",
  );
  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsExperimental}</h1>
      </section>
      <Card>
        <ExperimentalCommands />
      </Card>
      {/* 开发模式区(018 批 1,裁决 13 备稿授权):仅 DEV 构建渲染,
          生产构建零存在(leak 指纹扩展覆盖 per-port 选择键) */}
      {import.meta.env.DEV ? (
        <>
          <Card>
            <DevModeSection />
          </Card>
          <Card>
            <div className="vua-page__stack">
              <h3 className="vua-warehouse-detail__section-title">
                {strings.dev.uiSwitchTitle}
              </h3>
              <p className="vua-caption vua-text-secondary">{strings.dev.uiSwitchDesc}</p>
              <ul className="vua-project-compat__specs">
                <li>
                  <Button
                    variant={uiRoot === "current" ? "primary" : "default"}
                    onClick={() => onUiRootChange("current")}
                  >
                    {strings.dev.uiCurrentLabel}
                  </Button>
                </li>
                <li>
                  <Button
                    variant={uiRoot === "forest-green" ? "primary" : "default"}
                    disabled={!forestAvailable}
                    onClick={() => onUiRootChange("forest-green")}
                  >
                    {strings.dev.uiForestLabel}
                  </Button>{' '}
                  {!forestAvailable ? (
                    <ForestAvailabilityBadge available={false} />
                  ) : null}
                </li>
              </ul>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function ThemeSettingsPage({
  theme,
  hc,
  saverOn,
  saverAuto,
  steamVRRunning,
  onThemeChange,
  onHcChange,
  onSaverToggle,
  onSaverAutoChange,
}: PagePrefs) {
  const copy = strings.settings.theme;
  const saverSource = resourceSaverSource({
    manualOn: saverOn,
    autoEnabled: saverAuto,
    steamVRRunning,
  });
  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsTheme}</h1>
      </section>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.appearanceHeading}</h2>
          <div>
            <select
              className="vua-settings-select"
              aria-label={copy.appearanceAria}
              value={theme}
              onChange={(event) => onThemeChange(event.target.value as ThemePreference)}
            >
              <option value="system">{copy.system}</option>
              <option value="dark">{copy.dark}</option>
              <option value="light">{copy.light}</option>
            </select>
          </div>
        </div>
      </Card>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.hcHeading}</h2>
          <p className="vua-text-secondary">{copy.hcDescription}</p>
          <div>
            <select
              className="vua-settings-select"
              aria-label={copy.hcAria}
              value={hc}
              onChange={(event) => onHcChange(event.target.value as HcMode)}
            >
              <option value="auto">{copy.hcAuto}</option>
              <option value="on">{copy.hcOn}</option>
            </select>
          </div>
        </div>
      </Card>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.saverHeading}</h2>
          <p className="vua-text-secondary">{copy.saverDescription}</p>
          <div className="vua-settings-row">
            <Button
              variant={saverOn ? "default" : "primary"}
              onClick={onSaverToggle}
            >
              {saverOn ? copy.saverTurnOff : copy.saverTurnOn}
            </Button>
            <span className="vua-text-secondary">
              {saverSource === "off"
                ? copy.saverStateOff
                : saverSource === "manual"
                  ? copy.saverStateManual
                  : copy.saverStateAuto}
            </span>
          </div>
          <label className="vua-settings-check">
            <input
              type="checkbox"
              checked={saverAuto}
              aria-label={copy.saverAutoAria}
              onChange={(event) => onSaverAutoChange(event.target.checked)}
            />
            <span>{copy.saverAutoLabel}</span>
          </label>
          {/* 诚实标注:SteamVR 运行检测未接入(issue #27),接入前自动路径不生效 */}
          <p className="vua-caption vua-text-secondary">{copy.saverAutoNote}</p>
        </div>
      </Card>
    </div>
  );
}

function LanguageSettingsPage() {
  const copy = strings.settings.language;
  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsLanguage}</h1>
      </section>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.heading}</h2>
          <p className="vua-text-secondary">{copy.description}</p>
          <div>
            <select
              className="vua-settings-select"
              aria-label={copy.aria}
              value={currentLocale}
              onChange={(event) => {
                // 切换语言 = 写存储 + 整页重载选表(与场景切换同模式)
                try {
                  localStorage.setItem(storageKeys.locale, event.target.value);
                } catch {
                  /* 存储不可用时仅本次会话生效 */
                }
                window.location.reload();
              }}
            >
              {localeRegistry.map((entry) => (
                <option key={entry.id} value={entry.id} disabled={!entry.available}>
                  {entry.available ? entry.endonym : `${entry.endonym} (${copy.pending})`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>
    </div>
  );
}

function GoalsSettingsPage({ onRestart }: { onRestart: () => void }) {
  const copy = strings.settings.goals;
  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsGoals}</h1>
      </section>
      {/* 应用导览「route」步锚点(三类引导裁决 2026-10-05) */}
      <Card data-tour-anchor="tour-goals">
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.heading}</h2>
          <p className="vua-text-secondary">{copy.description}</p>
          <div>
            <Button variant="primary" onClick={onRestart}>
              {copy.restartCta}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function VersionPage() {
  const copy = strings.settings.version;
  const debugMode = useDebugMode();
  const environment = useEnvironmentView();
  const settings = useSettingsView();
  const dataSource = useDataSource();
  const [exportFailed, setExportFailed] = useState(false);
  // 版本检测(2026-09-19 裁决:默认开启、设置可关;只读探测,Phase C
  // 下载/应用更新独立提案):开关与缓存经 update-check-store,三态如实呈现
  const updateEnabled = useUpdateCheckEnabled();
  const updateCache = useUpdateCheckCache();
  const [updateChecking, setUpdateChecking] = useState(false);

  const exportDiagnostics = () => {
    const bundle = buildDiagnostics({
      dataSource,
      goals: settings.goals,
      deployer: environment.deployer,
    });
    setExportFailed(!downloadDiagnostics(bundle));
  };

  const checkNow = () => {
    setUpdateChecking(true);
    void runUpdateCheck().finally(() => setUpdateChecking(false));
  };

  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsVersion}</h1>
      </section>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.heading}</h2>
          <p className="vua-page__version">{format(copy.versionLine, { version: __VUA_BUILD_INFO__.version })}</p>
          <p className="vua-text-secondary">{copy.description}</p>
        </div>
      </Card>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.updateHeading}</h2>
          <p className="vua-text-secondary">{copy.updateDescription}</p>
          <label className="vua-settings-toggle">
            <input
              type="checkbox"
              checked={updateEnabled}
              onChange={(event) => saveUpdateCheckEnabled(event.target.checked)}
            />
            {copy.updateToggle}
          </label>
          {updateCache?.state === "newer-available" ? (
            <p className="vua-caption">
              {format(copy.updateNewer, { version: updateCache.latestVersion ?? "" })}
            </p>
          ) : null}
          {updateCache?.state === "up-to-date" ? (
            <p className="vua-caption vua-text-secondary">{copy.updateUpToDate}</p>
          ) : null}
          {updateCache?.state === "check-failed" ? (
            <p className="vua-caption vua-text-secondary">{copy.updateFailed}</p>
          ) : null}
          {updateCache ? (
            <p className="vua-caption vua-text-secondary">
              {format(copy.updateCheckedAt, { at: formatDateTime(updateCache.checkedAt) })}
            </p>
          ) : null}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Button variant="default" disabled={updateChecking} onClick={checkNow}>
              {updateChecking ? copy.updateChecking : copy.updateNow}
            </Button>
            {updateCache?.state === "newer-available" && updateCache.releaseUrl ? (
              <Button variant="subtle" onClick={() => openExternalUrl(updateCache.releaseUrl!)}>
                {copy.updateViewRelease}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.debugHeading}</h2>
          <p className="vua-text-secondary">{copy.debugDescription}</p>
          <label className="vua-settings-toggle">
            <input
              type="checkbox"
              checked={debugMode}
              onChange={(event) => saveDebugMode(event.target.checked)}
            />
            {copy.debugToggle}
          </label>
        </div>
      </Card>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.diagnosticsHeading}</h2>
          <p className="vua-text-secondary">{copy.diagnosticsDescription}</p>
          {exportFailed ? (
            <p className="vua-caption vua-text-secondary">{copy.diagnosticsFailed}</p>
          ) : null}
          <div>
            <Button variant="default" onClick={exportDiagnostics}>
              {copy.diagnosticsExport}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AboutPage() {
  const copy = strings.settings.about;
  const [repoFailed, setRepoFailed] = useState(false);
  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{strings.nav.pages.settingsAbout}</h1>
      </section>
      {/* Banner 槽位(美术需求文档 §3):定稿前诚实占位,不放伪造图 */}
      <div className="vua-about-banner">
        <span className="vua-caption vua-text-secondary">{copy.bannerSlot}</span>
      </div>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.heading}</h2>
          <p className="vua-text-secondary">{format(copy.description, { amf: TERMS.amf })}</p>
        </div>
      </Card>
      <Card>
        <div className="vua-page__stack">
          <h2 className="vua-title">{copy.contributorsHeading}</h2>
          <p className="vua-text-secondary">{copy.contributorsDescription}</p>
          <p className="vua-caption vua-text-secondary">{copy.repoImpact}</p>
          {repoFailed ? (
            <p className="vua-caption vua-text-secondary">{copy.repoFailed}</p>
          ) : null}
          <div>
            <Button
              variant="default"
              onClick={() => {
                setRepoFailed(false);
                void openExternalUrl(appMeta.repoUrl).then((ok) => {
                  if (!ok) setRepoFailed(true);
                });
              }}
            >
              {copy.repoCta}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

interface PageActions {
  /** 部署器中性态"选择环境目标"→ 设置·目标重选 */
  chooseGoals: () => void;
  /** 车间阻断态"前往准备生产环境"→ 环境部署·生产环境(用户点击才跳转) */
  prepareEnv: () => void;
  /** 设置·目标重选"重新选择目标"→ 重新进入首次引导 */
  restartOnboarding: () => void;
  /** 指挥台首页(S-VFX-2):打开命令面板 */
  openPalette: () => void;
  /** 指挥台首页(S-VFX-2):速达卡跳转 */
  navigate: (target: PageId) => void;
}

/** 主题页偏好管道(C-I18N/主题页):AppShell 持有的主题偏好/HC/资源节约状态下传给主题设置页 */
interface PagePrefs {
  /** 外观选择当前值:跟随系统时为偏好值;走查覆盖(?theme=)时为覆盖值 */
  theme: ThemePreference;
  hc: HcMode;
  onThemeChange: (theme: ThemePreference) => void;
  onHcChange: (mode: HcMode) => void;
  /** 资源节约模式(S-VFX-5 落地):手动开状态(持久化) */
  saverOn: boolean;
  onSaverToggle: () => void;
  /** SteamVR 运行时自动打开(持久化偏好) */
  saverAuto: boolean;
  onSaverAutoChange: (on: boolean) => void;
  /** SteamVR 是否在运行:检测器未接入前恒 false(GitHub issue #27) */
  steamVRRunning: boolean;
}

function renderPage(
  page: PageId,
  goals: StoredGoalsV1 | null,
  creatorReady: boolean,
  actions: PageActions,
  prefs: PagePrefs,
  uiRoot: UiRootId,
  onUiRootChange: (root: UiRootId) => void,
) {
  switch (page) {
    case "env-play":
    case "env-create": {
      const zone = page === "env-play" ? ("play" as const) : ("create" as const);
      const goal = !goalEnabled(goals, "env")
        ? ("goal-off" as const)
        : envGoalEnabled(goals, zone)
          ? ("active" as const)
          : ("env-off" as const);
      return <DeployerPage zone={zone} goal={goal} onChooseGoals={actions.chooseGoals} />;
    }
    case "warehouse":
      return <WarehousePage onNavigate={actions.navigate} />;
    case "recipe":
      return <RecipePage />;
    case "inspection":
      return <InspectionPage />;
    case "release":
      return <ReleasePage onNavigate={actions.navigate} />;
    case "packages":
      return <PackagesPage />;
    case "workshop":
      return (
        <WorkshopPage
          envReady={creatorReady}
          onPrepareEnv={actions.prepareEnv}
          onNavigate={actions.navigate}
        />
      );
    case "tools-discover":
    case "tools-devices":
    case "tools-calibration":
    case "tools-installed":
      return <ToolsPage page={page as ToolsPageId} />;
    case "settings-goals":
      return <GoalsSettingsPage onRestart={actions.restartOnboarding} />;
    case "settings-environment":
      return <EnvironmentSettingsPage />;
    case "settings-language":
      return <LanguageSettingsPage />;
    case "settings-theme":
      return <ThemeSettingsPage {...prefs} />;
    case "settings-version":
      return <VersionPage />;
    case "settings-experimental":
      return (
        <ExperimentalSettingsPage
          uiRoot={uiRoot}
          onUiRootChange={onUiRootChange}
        />
      );
    case "settings-about":
      return <AboutPage />;
    case "settings-donate":
      return (
        <PlaceholderPage
          title={strings.nav.pages.settingsDonate}
          description={strings.placeholders.donateDescription}
        />
      );
  }
}

/** 顶栏折叠相位(S-XIII-3):过渡相位承载飞入飞出动画窗 */
type NavPhase = "expanded" | "collapsing" | "collapsed" | "expanding";

/**
 * 应用壳(G3):在 GatewayProvider 内渲染,页面数据一律经 Gateway hooks
 * 取得;creatorReady 由环境快照计算,不再读 scenario 负载。
 */
function AppShell({
  page,
  navigate,
  goals,
  actions,
  uiRoot,
  onUiRootChange,
}: {
  page: PageId;
  navigate: (target: PageId) => void;
  goals: StoredGoalsV1 | null;
  /** 壳层注入的动作(openPalette/navigate 由 AppShell 内部补齐,见 pageActions) */
  actions: Omit<PageActions, "openPalette" | "navigate">;
  /** 多套 UI 根(019 批 A):共享容器持有,切换不重建 Gateway */
  uiRoot: UiRootId;
  onUiRootChange: (root: UiRootId) => void;
}) {
  // 008 路径 a 桌面接线(W19):删除偏好开启时,生成完成即逐条目发起独立删除任务
  useAutoDeleteOriginals();
  // 启动里程碑 paint:AppShell 首帧提交(Phase A 开屏牵线)
  useEffect(() => {
    bootProgress.report("paint");
  }, []);
  // 主题(C-RESUME 工作区恢复 + 2026-09-26 跟随系统裁决):偏好三值
  // dark|light|system 持久化(键 vua-theme,旧 dark|light 存储仍然合法);
  // ?theme=dark|light 仅作走查覆盖——强制生效值,不写存储,会话内可被
  // 设置页/palette 翻转(沿用覆盖语义)
  const [themeOverride, setThemeOverride] = useState<ResolvedTheme | null>(() => {
    const value = new URLSearchParams(window.location.search).get("theme");
    return value === "light" || value === "dark" ? value : null;
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [themePref, setThemePref] = useState<ThemePreference>(() =>
    loadThemePreference((key) => localStorage.getItem(key)),
  );
  // 生效主题 = 覆盖 ?? 偏好解析;pref=system 时按系统深浅色解析
  const resolvedTheme: ResolvedTheme =
    themeOverride ?? resolveTheme(themePref, systemDark);
  const environmentView = useEnvironmentView();
  const creatorReady = creatorEnvReady(environmentView.deployer);
  const activeModule: AppSectionId = moduleOf(page);

  // 命令面板(C-EFFICIENCY,ui-ux §6.1):Ctrl/Cmd+P 开关;命令 = 全部页面跳转 + 主题切换
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 应用导览重播信号(三类引导裁决 2026-10-05):命令面板动作递增,
  // AppTour 据此从第一步重开;导览的进度/自动开始在其内部自治
  const [tourStartRequest, setTourStartRequest] = useState(0);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPaletteToggle(event)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 顶栏折叠(2026-09-25 两级化):梯子 0=完整 / 1=Tab 收进折叠按钮。
  // 量尺行测全量 Tab 自然宽;轨道与量尺的 ResizeObserver 在窗口/语言
  // 变化时重新触发判定。相位机只管 0↔1 的飞入飞出动画窗。
  // 首次判定直接落位不播动画(启动即窄窗不应看到整排 Tab 飞走);
  // 每次判定循环至不动点——几何与级别解耦(品牌区宽度恒定),一次外部
  // 事件直接落到最终级,不留中间卡态
  const [navLevel, setNavLevel] = useState<NavLevel>(0);
  const navCollapsed = navLevel === 1;
  const [navPhase, setNavPhase] = useState<NavPhase>("expanded");
  /** 折叠菜单打开状态:null 即关闭;x/y 为折叠按钮下缘的视口坐标 */
  const [navMenu, setNavMenu] = useState<{ x: number; y: number } | null>(null);
  const tabsRef = useRef<HTMLElement | null>(null);
  const tabsMeasureRef = useRef<HTMLDivElement | null>(null);
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const navMeasuredRef = useRef(false);
  /** 上次判定的输入快照(#28 抖动修复):轨道/品牌几何不随折叠动作变化,
   *  快照未变的 resize 触发即观察者噪声,跳过判定断开临界宽度振荡环 */
  const lastMeasureRef = useRef<NavMeasureSnapshot | null>(null);
  useEffect(() => {
    const nav = tabsRef.current;
    const measure = tabsMeasureRef.current;
    if (!nav || !measure) return;
    const settle = (from: NavLevel, required: number, available: number): NavLevel => {
      let level = from;
      for (let step = 0; step < 4; step += 1) {
        const next = navLevelNext({ level, required, available });
        if (next === level) return level;
        level = next;
      }
      return level;
    };
    const update = () => {
      // #28 自反馈断链:外部事实(窗口宽/量尺行/轨道宽)未变时不喂回判定
      const style = getComputedStyle(nav);
      const available =
        nav.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const snapshot: NavMeasureSnapshot = {
        windowWidth: window.innerWidth,
        required: measure.offsetWidth,
        available,
      };
      if (!navMeasureChanged(lastMeasureRef.current, snapshot)) return;
      lastMeasureRef.current = snapshot;
      if (!navMeasuredRef.current) {
        navMeasuredRef.current = true;
        // 首判落位:一步收敛到终态,不播折叠动画
        const level = settle(0, snapshot.required, available);
        setNavLevel(level);
        setNavPhase(level === 1 ? "collapsed" : "expanded");
        return;
      }
      setNavLevel((level) => settle(level, snapshot.required, available));
    };
    // W25 走查缺陷①修复(2026-09-23):首判前等字体就绪——首判若在
    // webfont 加载完成前量测,fallback 字体宽度偏大,量尺行 required 虚高,
    // 启动即误判收缩。document.fonts.ready 在字体已就绪时立即 resolve
    // (零等待,行为不变);不可用环境(极老内核)诚实降级为原时序。
    // observer 同样在就绪后挂载,字体加载触发的布局变化照常重判。
    let disposed = false;
    const observer = new ResizeObserver(update);
    const start = (): void => {
      if (disposed) return;
      update();
      observer.observe(nav);
      observer.observe(measure);
    };
    const fontsReady: Promise<unknown> | undefined =
      typeof document !== "undefined" && "fonts" in document
        ? document.fonts.ready
        : undefined;
    if (fontsReady === undefined) {
      start();
    } else {
      void fontsReady.then(start, start);
    }
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, []);

  // 目标态变化 → 进入过渡相位;过渡窗(与 CSS 动画时长对齐)结束 → 落定
  useEffect(() => {
    setNavPhase((phase) => {
      if (navCollapsed) {
        return phase === "collapsed" || phase === "collapsing" ? phase : "collapsing";
      }
      return phase === "expanded" || phase === "expanding" ? phase : "expanding";
    });
  }, [navCollapsed]);

  useEffect(() => {
    if (navPhase !== "collapsing" && navPhase !== "expanding") return;
    /* 动效被全局压平时(reduced-motion / 特效关)不空等动画窗,立即落定;
     * 读根元素 dataset 而非 effects state:该 state 声明在组件后部 */
    const flattened =
      document.documentElement.dataset.effects === "off" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = flattened ? 0 : navPhase === "collapsing" ? 300 : 430;
    const timer = window.setTimeout(
      () => setNavPhase(navPhase === "collapsing" ? "collapsed" : "expanded"),
      ms,
    );
    return () => window.clearTimeout(timer);
  }, [navPhase]);

  // 离开折叠态时折叠菜单若还开着,其坐标已失效,直接关闭
  useEffect(() => {
    if (navPhase !== "collapsed") setNavMenu(null);
  }, [navPhase]);

  const commands = useMemo<CommandItem[]>(() => {
    const pages: CommandItem[] = modules.flatMap((module) =>
      module.groups.flatMap((group) =>
        group.pages.map((p) => ({
          id: p.id,
          group: "pages" as const,
          label: pageLabel(p),
          keywords: p.id,
          run: () => navigate(p.id),
        })),
      ),
    );
    const actions: CommandItem[] = [
      {
        id: "start-tour",
        group: "actions",
        label: strings.tour.paletteEntry,
        keywords: "tour guide onboarding",
        run: () => setTourStartRequest((value) => value + 1),
      },
      {
        id: "toggle-theme",
        group: "actions",
        label:
          resolvedTheme === "dark"
            ? strings.commandPalette.toggleThemeToLight
            : strings.commandPalette.toggleThemeToDark,
        keywords: "theme",
        // pref=system 时落当前生效主题的反面(此后不再跟随系统);走查覆盖
        // 在时翻转覆盖值(不写存储);其余直翻偏好
        run: () => {
          if (themeOverride !== null) {
            setThemeOverride(themeOverride === "dark" ? "light" : "dark");
            return;
          }
          setThemePref(toggledPreference(resolvedTheme));
        },
      },
    ];
    return [...pages, ...actions];
    // navigate 由 App 每次渲染新建;命令表重建成本低,无需缓存
  }, [navigate, resolvedTheme, themeOverride]);

  // 模型生产假加载页(需求 2026-08):本次启动首次进入 production 模块时覆盖,
  // 固定时长/点击/Escape 退出;真实初始化任务接入后由任务状态驱动(G10)
  const [introPhase, setIntroPhase] = useState<ProductionIntroPhase>("idle");
  useEffect(() => {
    setIntroPhase((phase) => nextIntroPhase(phase, activeModule === "production"));
  }, [activeModule]);

  // 沉浸式自定义标题栏:仅在 Electron 壳内渲染窗口控制(浏览器预览无 preload,不渲染)
  const inShell = window.vua !== undefined;

  // 命令面板与导航动作注入 renderPage(指挥台页退役后面板入口仅剩
  // 顶栏 palette 按钮,动作注入面不变)
  const pageActions: PageActions = {
    ...actions,
    openPalette: () => setPaletteOpen(true),
    navigate,
  };

  // 生效主题 → data-theme:单次 dataset 写入,变化才触发,不做二次翻转
  // (防双写闪烁;已知的间歇性 stale-compositor 重绘缺陷不猜因、不作投机修复)
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  // 偏好持久化:覆盖在时跳过(走查不写存储)
  useEffect(() => {
    if (themeOverride !== null) return;
    saveThemePreference((key, value) => localStorage.setItem(key, value), themePref);
  }, [themePref, themeOverride]);

  // pref=system 时订阅系统深浅色变化,实时重解析生效主题;其余偏好不监听
  // (覆盖在时同样不监听——生效值被覆盖钉死)
  useEffect(() => {
    if (themeOverride !== null || themePref !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [themeOverride, themePref]);

  // 高对比度(C-I18N):auto=跟随系统 forced-colors;on=显式高对比配色;
  // ?hc=on 仅作走查覆盖(不写存储),存储选择持久化
  const [hcOverrideFromUrl] = useState(
    () => new URLSearchParams(window.location.search).get("hc") === "on",
  );
  const [hc, setHc] = useState<HcMode>(() => {
    if (new URLSearchParams(window.location.search).get("hc") === "on") return "on";
    try {
      const stored = localStorage.getItem(storageKeys.hc);
      if (stored === "on" || stored === "auto") return stored;
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
    return "auto";
  });
  useEffect(() => {
    if (hc === "on") {
      document.documentElement.dataset.hc = "on";
    } else {
      delete document.documentElement.dataset.hc;
    }
    if (hcOverrideFromUrl) return;
    try {
      localStorage.setItem(storageKeys.hc, hc);
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
  }, [hc, hcOverrideFromUrl]);

  // 资源节约模式(S-VFX-5 落地):手动开关持久化(storageKeys.effects);
  // "SteamVR 运行时自动打开"为独立持久化偏好,检测器未接入前(issue #27)
  // steamVRRunning 恒 false。生效态 = 手动开 || (自动偏好开 && SteamVR 运行中)
  // || ?effects=off 走查覆盖(覆盖不写存储)。生效时 data-effects="off":
  // 装饰 token 置 none、动画压平、WebGL 场景不挂载(useSceneMode 读同一属性)
  const [effectsOverrideFromUrl] = useState(
    () => new URLSearchParams(window.location.search).get("effects") === "off",
  );
  const [effects, setEffects] = useState<EffectsMode>(() => {
    if (new URLSearchParams(window.location.search).get("effects") === "off") return "off";
    try {
      const stored = localStorage.getItem(storageKeys.effects);
      if (stored === "on" || stored === "off") return stored;
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
    return "on";
  });
  const [effectsAuto, setEffectsAuto] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKeys.effectsAuto) === "on";
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
      return false;
    }
  });
  const steamVRRunning = false;
  const saverApplied =
    effectsOverrideFromUrl ||
    resourceSaverActive({
      manualOn: effects === "off",
      autoEnabled: effectsAuto,
      steamVRRunning,
    });
  useEffect(() => {
    if (saverApplied) {
      document.documentElement.dataset.effects = "off";
    } else {
      delete document.documentElement.dataset.effects;
    }
  }, [saverApplied]);
  useEffect(() => {
    if (effectsOverrideFromUrl) return;
    try {
      localStorage.setItem(storageKeys.effects, effects);
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
  }, [effects, effectsOverrideFromUrl]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKeys.effectsAuto, effectsAuto ? "on" : "off");
    } catch {
      /* localStorage 不可用时仅本次会话生效 */
    }
  }, [effectsAuto]);

  return (
    <div
      className="vua-shell"
      data-module={activeModule}
      // 右键纪律(S-XII,用户裁定):大部分区域不放右键菜单——统一抑制浏览器
      // 默认菜单;仅文本输入框放行原生编辑菜单。素材/配方/成品卡片的自定义
      // 菜单(ContextMenu)在各自组件的冒泡阶段接管,与此捕获层互不冲突。
      onContextMenuCapture={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, [contenteditable]")) return;
        event.preventDefault();
      }}
    >
      {/* 背景光效退役(2026-09-25 用户裁决):基线界面不再挂载星云云幕
       *  WebGL 背景与辉光斑,保留网格纹理;重负载展示(出厂转盘/指挥台
       *  3D 核心/动效/毛玻璃)由资源节约模式统一关闭 */}
      {/* 沉浸式标题栏(§氛围基线 #12):顶栏即标题栏,空白处可拖拽;
       *  拖拽属性只放在容器与品牌元素上,Tabs/按钮保持可点 */}
      <header className="vua-shell__header vua-drag-region">
        <div className="vua-shell__brand vua-drag-region">
          {/* 正式字标(品牌候选 06「Level」,2026-10-07 用户裁决):随模块辖区
           *  变色——环境部署紫、模型生产橙(--vua-accent 别名自动切换),
           *  设置 = 三色混合(V 紫/U 中性/A 橙)。「中性色不随模块变」的
           *  占位字标纪律随之退役 */}
          <span className="vua-shell__wordmark vua-drag-region">
            <BrandMark variant={activeModule === "settings" ? "mixed" : "solid"} />
          </span>
        </div>
        {/* tabs 容器 flex:1 占满中段——拖拽属性必须落在容器上,否则按钮右侧的
         *  空白属于 nav 而非 header,无法拖动窗口(按钮自身不受影响) */}
        <nav
          className={
            navPhase === "collapsing"
              ? "vua-shell__tabs vua-shell__tabs--leaving"
              : navPhase === "expanding"
                ? "vua-shell__tabs vua-shell__tabs--entering"
                : "vua-shell__tabs"
          }
          aria-label={strings.app.moduleNavAria}
          ref={tabsRef}
        >
          {navPhase === "collapsed" ? (
            /* 窄窗折叠:整排 Tab 收进一个按钮,点击在按钮下方弹出原两项;
             * 标签显示当前模块(落在设置页时退回通用导航名);
             * 当前模块是业务模块时带 aria-current,按下态视觉与展开时一致 */
            <button
              type="button"
              className="vua-shell__tab vua-shell__tab--nav-toggle"
              aria-haspopup="menu"
              aria-expanded={navMenu !== null}
              aria-current={
                businessModules.some((m) => m.id === activeModule) ? "page" : undefined
              }
              ref={navToggleRef}
              onClick={(event) => {
                if (navMenu) {
                  setNavMenu(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setNavMenu({ x: rect.left, y: rect.bottom + 6 });
              }}
            >
              <span className="vua-shell__tab-label">
                {businessModules.some((m) => m.id === activeModule)
                  ? tabLabel(moduleDef(activeModule))
                  : strings.app.moduleNavAria}
              </span>
              <span className="vua-shell__tab-chevron">
                <Icon name="chevron-down" size={16} />
              </span>
            </button>
          ) : (
            businessModules.map((m, index) => (
              <button
                key={m.id}
                type="button"
                className="vua-shell__tab"
                style={{ "--tab-index": index } as CSSProperties}
                aria-current={activeModule === m.id ? "page" : undefined}
                onClick={() => navigate(resolveTabLanding(m.id))}
              >
                <span className="vua-shell__tab-label">{tabLabel(m)}</span>
              </button>
            ))
          )}
          {/* 量尺:不可见的全量 Tab 行,内容与真实 Tab 一一对应;绝对定位
           *  脱离布局流,offsetWidth 恒为自然总宽,不受轨道收缩影响 */}
          <div className="vua-shell__tabs-measure" aria-hidden="true" ref={tabsMeasureRef}>
            {businessModules.map((m) => (
              <span key={m.id} className="vua-shell__tab">
                <span className="vua-shell__tab-label">{tabLabel(m)}</span>
              </span>
            ))}
          </div>
        </nav>
        {/* 占用查看器(2026-09-25 用户裁决):设置按钮左侧常驻读数,
         *  RAM/VRAM 取高;点击展开右上角详情小窗 */}
        <ResourceMonitor />
        {/* 设置固定最右侧(§2.1):与业务 Tab 同款平行四边形 pressed 卡;
         *  S-X-1 起顶栏选中态由卡片自身承载(深底+内阴影),不再用滑动 pill */}
        <button
          type="button"
          className="vua-shell__tab vua-shell__settings"
          aria-current={activeModule === "settings" ? "page" : undefined}
          onClick={() => navigate(resolveTabLanding("settings"))}
        >
          <span className="vua-shell__tab-label">{tabLabel(moduleDef("settings"))}</span>
        </button>
        <button
          type="button"
          className="vua-shell__palette-cta vua-caption"
          onClick={() => setPaletteOpen(true)}
        >
          {strings.commandPalette.cta} · {strings.commandPalette.ctaHint}
        </button>
        {/* 准备阅读器入口(三类引导裁决 2026-10-05:长篇引导迁入普通阅读
         *  窗口):showReader() 无定位 = 普通打开并恢复上次阅读位置;带定位
         *  的上下文帮助(GuideEntryButton)同样进入阅读器。无 preload 环境
         *  (浏览器直开主壳)可选链安全退化为无动作 */}
        <button
          type="button"
          className="vua-shell__theme-toggle vua-caption"
          title={strings.app.overlayGuide}
          data-tour-anchor="tour-guide-entry"
          onClick={() => void window.vua?.window.showReader()}
        >
          {strings.app.overlayGuide}
        </button>
        {/* 任务状态置顶窗入口(阅读器迁移后状态访问保持独立):打开即状态
         *  视图;关闭阅读器或本窗口不影响任何任务 */}
        <button
          type="button"
          className="vua-shell__theme-toggle vua-caption"
          title={strings.overlay.views.status}
          onClick={() => void window.vua?.window.showOverlay("status")}
        >
          {strings.overlay.views.status}
        </button>
        {/* 游戏引导小窗入口(三类引导 §4 手动版):透明置顶窗,打开不夺
         *  焦点;隐藏不销毁,进度与透明度本地持久化 */}
        <button
          type="button"
          className="vua-shell__theme-toggle vua-caption"
          title={strings.app.gameGuide}
          onClick={() => void window.vua?.window.showGameGuide()}
        >
          {strings.app.gameGuide}
        </button>
        {/* 通知中心顶栏入口(对标 Comfy 铃铛,自绘):与底部任务条共用同一通知投影;
         *  capability 非 ready 时组件自身不渲染 */}
        <NotificationPopover navigate={navigate} />
        {inShell ? (
          <div className="vua-shell__window-controls">
            <button
              type="button"
              className="vua-shell__window-button"
              aria-label={strings.app.windowMinimize}
              onClick={() => void window.vua?.window.minimize()}
            >
              <Icon name="minimize" size={16} />
            </button>
            <button
              type="button"
              className="vua-shell__window-button"
              aria-label={strings.app.windowMaximize}
              onClick={() => void window.vua?.window.toggleMaximize()}
            >
              <Icon name="maximize" size={16} />
            </button>
            <button
              type="button"
              className="vua-shell__window-button vua-shell__window-button--close"
              aria-label={strings.app.windowClose}
              onClick={() => void window.vua?.window.close()}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ) : null}
      </header>
      <div className="vua-shell__body">
        {/* 整页宽模块(hideSidebar)不渲染二级侧栏;指挥台退役后当前
            所有模块均带侧栏,机制保留 */}
        {!moduleDef(activeModule).hideSidebar ? (
        <aside className="vua-shell__sidebar" aria-label={strings.app.sidebarAria}>
          {moduleDef(activeModule).groups.map((group, index) => (
            <div className="vua-shell__sidebar-group" key={group.labelKey ?? index}>
              {groupLabel(group) ? (
                <span className="vua-shell__sidebar-label">{groupLabel(group)}</span>
              ) : null}
              {group.pages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="vua-shell__sidebar-item"
                  aria-current={page === p.id ? "page" : undefined}
                  onClick={() => navigate(p.id)}
                >
                  {pageLabel(p)}
                </button>
              ))}
            </div>
          ))}
        </aside>
        ) : null}
        <main className="vua-shell__main">
          <div key={page} className="vua-page-enter">
            {renderPage(page, goals, creatorReady, pageActions, {
              theme: themeOverride ?? themePref,
              hc,
              onThemeChange: (next) => {
                // 走查覆盖在时:dark|light 选择翻转覆盖值(不写存储);
                // 跟随系统无法由覆盖表达,忽略(开发面,不猜态)
                if (themeOverride !== null) {
                  if (next === "dark" || next === "light") setThemeOverride(next);
                  return;
                }
                setThemePref(next);
              },
              onHcChange: setHc,
              saverOn: effects === "off",
              onSaverToggle: () =>
                setEffects((current) => (current === "off" ? "on" : "off")),
              saverAuto: effectsAuto,
              onSaverAutoChange: setEffectsAuto,
              steamVRRunning,
            }, uiRoot, onUiRootChange)}
          </div>
          {introPhase === "showing" ? (
            <ProductionIntroOverlay onDone={() => setIntroPhase("done")} />
          ) : null}
        </main>
      </div>
      {/* 任务中心(ui-ux §4.2 底部入口):capability 非 ready 时组件自身不渲染 */}
      <Taskbar navigate={navigate} />
      {/* 导航确认卡(015 §12,批 B-3):U9(1)/(3) 确认层的渲染层载体,全局一次挂载 */}
      <NavigationConfirmOverlay />
      {/* 应用导览(三类引导裁决 2026-10-05):主窗口内有序高亮;从未运行自动
       *  开始,active 按步号恢复,重播经命令面板;状态独立于阅读器/安装 */}
      <AppTour page={page} navigate={navigate} startRequest={tourStartRequest} />
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}
      {navMenu && navPhase === "collapsed" ? (
        <NavOverflowMenu
          x={navMenu.x}
          y={navMenu.y}
          activeModule={activeModule}
          toggleRef={navToggleRef}
          onSelect={(id) => navigate(resolveTabLanding(id))}
          onClose={() => setNavMenu(null)}
        />
      ) : null}
    </div>
  );
}

export function App() {
  const [override] = useState(readOnboardingOverride);
  const [storedGoals, setStoredGoals] = useState<StoredGoalsV1 | null>(() =>
    readStoredGoals(override),
  );
  // Gateway 装配(G3):生产构建恒为 emptyGateway(not-run);
  // fixture 仅 DEV 可达——硬防线在 gateway/create.ts
  const [{ gateway, name }] = useState<{ gateway: VuaGateway; name: GatewayStateName }>(() =>
    createGatewayState(storedGoals),
  );
  // 多套 UI 根选择(019 批 A):共享容器(GatewayProvider)不随切换重建
  const [uiRoot, setUiRoot] = useState<UiRootId>(() => readUiRootSelection());
  // 启动入口决策:引导未完成时 vua-last-page 不能绕过(onboarding-model 测试覆盖)
  const [entry] = useState(() =>
    resolveEntry(storedGoals, override === null ? readStoredPage() : null),
  );
  const [showOnboarding, setShowOnboarding] = useState(entry.showOnboarding);
  // 启动开屏:首帧覆盖层,播完/跳过后卸载;与 Gateway 装配并行,不阻塞数据
  const [splashDone, setSplashDone] = useState(false);
  // 启动里程碑(Phase A 牵线):gateway 装配完成即报;provider 探针=首个
  // capability 应答(任一结果均计,测网关链活性);paint 由 AppShell 首效应上报
  useEffect(() => {
    bootProgress.report("gateway");
    void gateway.task.capability().then(
      () => bootProgress.report("provider"),
      () => bootProgress.report("provider"),
    );
  }, [gateway]);
  // 版本检测(2026-09-19 裁决:默认开启、设置可关):启动后静默自检一次,
  // 结果落缓存供开屏角标/设置页呈现;延迟 2.5s 让启动链路先行,失败
  // 恒落 check-failed 缓存(不弹打扰、不猜态)
  useEffect(() => {
    const timer = window.setTimeout(() => void runUpdateCheck(), 2500);
    return () => window.clearTimeout(timer);
  }, []);
  // 深链接(C-EFFICIENCY):#<pageId> 优先于 ?page= 与历史落点
  const [page, setPage] = useState<PageId>(() => {
    const hashPage = readHashPage();
    const params = new URLSearchParams(window.location.search);
    // 允许 ?page=workshop 指定初始页,供人工走查与调试使用(引导未完成时不生效)
    const pageParam = params.get("page");
    if (!entry.showOnboarding && hashPage) return hashPage;
    return !entry.showOnboarding && isPageId(pageParam) ? pageParam : entry.page;
  });
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  function navigate(target: PageId) {
    // 不做强制重定向(v0.3.3 §2.1):所有页面直达,阻断由页面内诚实状态表达
    setPage(target);
    if (!showOnboarding) {
      // 深链接:当前页同步进 hash,可粘贴直达
      try {
        window.location.hash = target;
      } catch {
        /* 极端环境下 hash 不可写时仅本次会话生效 */
      }
    }
    // 引导未完成或 DEV 只读覆盖时,不写持久存储
    if (!showOnboarding && override === null) {
      try {
        localStorage.setItem(lastPageStorageKey, target);
      } catch {
        /* localStorage 不可用时仅本次会话生效 */
      }
    }
  }

  // 深链接:用户粘贴/回退产生 hashchange 时同步页面(navigate 写入的同值不回环)
  useEffect(() => {
    if (showOnboarding) return;
    const onHashChange = () => {
      const target = readHashPage();
      if (target && target !== pageRef.current) navigate(target);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
    // navigate 每次渲染重建,但读取的 pageRef 恒新;showOnboarding 切换时重挂监听
  }, [showOnboarding]);

  function handleOnboardingComplete(result: OnboardingResult) {
    const status = result.status === "skipped" ? "skipped" : "completed";
    const raw = serializeGoals(status, result.goals, result.environments);
    try {
      localStorage.setItem(goalsStorageKey, raw);
    } catch {
      /* 存储不可用时目标仅本次会话生效 */
    }
    const stored = parseStoredGoals(raw);
    setStoredGoals(stored);
    // 设置端口内状态同步(G3):端口为查询事实来源,持久化仍由 App 壳负责
    if (stored) void gateway.settings.setGoals(stored);
    setShowOnboarding(false);
    // §2.2 步骤 3:按顶部导航从左到右进入第一个已选目标;跳过则进默认落点
    const first = businessModules.find((m) => goalEnabled(stored, m.id as GoalId));
    navigate(first ? first.defaultPage : defaultPage);
  }

  if (showOnboarding) {
    return (
      <>
        {!splashDone ? <BootSplash onDone={() => setSplashDone(true)} /> : null}
        <OnboardingPage
          initialGoals={storedGoals?.goals ?? []}
          initialEnvs={storedGoals?.environments ?? []}
          onComplete={handleOnboardingComplete}
        />
      </>
    );
  }

  const actions: Omit<PageActions, "openPalette" | "navigate"> = {
    chooseGoals: () => navigate("settings-goals"),
    prepareEnv: () => navigate("env-create"),
    restartOnboarding: () => setShowOnboarding(true),
  };

  return (
    <GatewayProvider gateway={gateway}>
      {!splashDone ? <BootSplash onDone={() => setSplashDone(true)} /> : null}
      {uiRoot === "forest-green" ? (
        <ForestVariantRoot onBackToCurrent={() => setUiRoot("current")} />
      ) : (
        <AppShell
          page={page}
          navigate={navigate}
          goals={storedGoals}
          actions={actions}
          uiRoot={uiRoot}
          onUiRootChange={setUiRoot}
        />
      )}
    </GatewayProvider>
  );
}

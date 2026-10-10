import { formatDateTime } from "./i18n/index.ts";
import { lazy, Suspense, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { DesktopShellCommandV1, GuideTargetV1 } from "@vua/contracts";
import { saveDebugMode, useDebugMode } from "./app/debug-mode.ts";
import {
  availablePage,
  isAmfPage,
  defaultPage,
  isPageId,
  moduleDef,
  moduleOf,
  modules,
  type ModuleDef,
  type PageId,
  type SidebarPage,
} from "./app/nav-model.ts";
import {
  goalsStorageKey,
  migratePageId,
  parseStoredGoals,
  resolveEntry,
  serializeGoals,
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
import { Icon } from "@vua/design-system";
import { format, strings, termLabel, termSequence, TERMS } from "./i18n/index.ts";
import { currentLocale, localeRegistry } from "./i18n/index.ts";
import { creatorEnvReady } from "./features/deployer/deployer-model.ts";
import { OnboardingPage, type OnboardingResult } from "./features/onboarding/OnboardingPage.tsx";
import { NavigationConfirmOverlay } from "./app/NavigationConfirmOverlay.tsx";
import { AppTour } from "./features/tour/AppTour.tsx";
import { firstTourRequired } from "./features/tour/tour-model.ts";
import { LoginBrowserOverlay } from "./app/LoginBrowserOverlay.tsx";
import { closeLoginBrowser } from "./app/login-browser-store.ts";
import { closeBrowserModal } from "./components/primitives/modal-layer.tsx";
import { NotificationPopover } from "./features/task-center/NotificationPopover.tsx";
import { ResourceMonitor } from "./features/resource-monitor/ResourceMonitor.tsx";
import { BootGate, BootSplash } from "./components/splash/BootSplash.tsx";
import { bootProgress } from "./app/boot-progress.ts";
import { ToolsPage, type ToolsPageId } from "./features/tools/ToolsPage.tsx";
import { ToolsHub } from "./features/tools/ToolsHub.tsx";
import { HelpPage } from "./features/help/HelpPage.tsx";
import { ENCYCLOPEDIA_EVENT } from "./features/help/encyclopedia-navigation.ts";
import { shouldClearGuideRequest, type GuideRequest } from "./features/overlay/GuideOverlayView.tsx";
import {
  buildDiagnostics,
  downloadDiagnostics,
} from "./features/settings/diagnostics.ts";
import { ExperimentalCommands } from "./features/settings/experimental-commands.tsx";
import { DevModeSection } from "./features/settings/dev-mode-section.tsx";
import { AccountSettingsPage } from "./features/settings/AccountSettingsPage.tsx";
import { EnvironmentSettingsPage } from "./features/settings/environment-page.tsx";
import { useAutoDeleteOriginals } from "./app/delete-originals-auto.ts";
import {
  runUpdateCheck,
  saveUpdateCheckEnabled,
  useUpdateCheckCache,
  useUpdateCheckEnabled,
} from "./app/update-check-store.ts";
import { appMeta } from "./app/app-meta.ts";

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
  useAmfModule,
  useEnvironmentView,
  useSettingsView,
  type VuaGateway,
} from "./gateway/index.ts";
import { ModulesPage } from "./features/modules/ModulesPage.tsx";
import { AmfBoundary } from "./features/modules/AmfBoundary.tsx";
const AmfPages = lazy(() => import("./features/amf/AmfPages.tsx"));
import { HomePage, directory } from "./features/home/HomePage.tsx";
import { RouteEnvironmentPage } from "./features/home/RouteEnvironmentPage.tsx";
import "./app-shell.css";
import "./features/home/home.css";
import "./features/settings/settings.css";

/** 高对比度(C-I18N):auto = 跟随系统 forced-colors;on = 显式高对比配色 */
type HcMode = "auto" | "on";

/** 动态特效总开关(S-VFX-5):on = 全装饰层;off = VR/省资源静态化 */
type EffectsMode = "on" | "off";

const lastPageStorageKey = storageKeys.lastPage;

/** 深链接读取(C-EFFICIENCY):#/page-id 形态;非法 id 回退 null */
function readHashPage(): PageId | null {
  try {
    const raw = migratePageId(window.location.hash.replace(/^#\/?/, "").split("?")[0] ?? "");
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

function pageLabel(page: SidebarPage): string {
  if (page.labelTerms) return termSequence(page.labelTerms);
  if (page.labelKey) return strings.nav.pages[page.labelKey];
  throw new Error(`page without label: ${page.id}`);
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

function AmfExperimentalCommands() {
  const amf = useAmfModule();
  return amf.state === "ready" ? <ExperimentalCommands /> : null;
}

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
        <AmfExperimentalCommands />
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
  const themeOptions = [
    { value: "dark", label: copy.dark },
    { value: "light", label: copy.light },
    { value: "system", label: copy.system },
  ] as const;
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
          <div className="vua-theme-choice" role="group" aria-label={copy.appearanceAria}>
            <span
              className="vua-theme-choice__selection"
              aria-hidden="true"
              style={{ transform: `translateX(${themeOptions.findIndex(option => option.value === theme) * 100}%)` }}
            />
            {themeOptions.map(option => (
              <button
                type="button"
                key={option.value}
                className="vua-theme-choice__button"
                aria-pressed={theme === option.value}
                data-nav-id={`theme-${option.value}`}
                onClick={() => onThemeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
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

function LanguageSelector() {
  const copy = strings.settings.language;
  return (
            <div className="vua-shell__language">
            <svg className="vua-shell__language-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5h12M9 3v2M5 5c1 5 4 8 8 10M13 5c-1 5-4 8-9 11M13 21l4.5-11L22 21M15 17h5" />
            </svg>
            <select
              className="vua-settings-select"
              data-nav-id="settings-language-select"
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
  );
}

function VersionDetails() {
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
    void runUpdateCheck({ manual: true }).finally(() => setUpdateChecking(false));
  };

  return (
    <div className="vua-page__stack" data-version-details>
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
            <Button variant="default" data-nav-id="about-check-updates" disabled={updateChecking} onClick={checkNow}>
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
      <VersionDetails />
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
  /** 车间阻断态"前往准备生产环境"→ 环境部署·生产环境(用户点击才跳转) */
  prepareEnv: () => void;
  /** 指挥台首页(S-VFX-2):打开命令面板 */
  openPalette: () => void;
  /** 指挥台首页(S-VFX-2):速达卡跳转 */
  navigate: (target: PageId) => void;
  openAccounts: () => void;
  startTour: () => void;
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
  creatorReady: boolean,
  actions: PageActions,
  prefs: PagePrefs,
  uiRoot: UiRootId,
  onUiRootChange: (root: UiRootId) => void,
  amf: import("@vua/contracts").AmfModuleSnapshotV01,
  encyclopedia: { request: GuideRequest | null; acknowledge: (nonce: number) => void },
) {
  if (isAmfPage(page) && amf.state !== "ready") return <ModulesPage onOpen={() => actions.navigate("warehouse")} />;
  switch (page) {
    case "home": case "environment-hub": case "avatar-hub":
      return <HomePage page={page} navigate={actions.navigate} amfInstalled={amf.installed} />;
    case "help": case "help-wizard": case "help-tour": case "help-game-assistant": case "help-encyclopedia":
      return <HelpPage page={page} navigate={actions.navigate} onAccounts={actions.openAccounts} startTour={actions.startTour} guideRequest={encyclopedia.request} acknowledgeGuide={encyclopedia.acknowledge} />;
    case "env-play": case "env-create":
      return <RouteEnvironmentPage zone={page === "env-play" ? "play" : "create"} onAccounts={actions.openAccounts} onOpenAmf={() => actions.navigate("warehouse")} />;
    case "warehouse": case "asset-browser": case "recipe": case "inspection": case "release": case "packages": case "workshop":
      return <AmfBoundary key={page} manage={() => actions.navigate("settings-modules")}><Suspense fallback={<p role="status">{format(strings.amfModule.loading, { amf: TERMS.amf })}</p>}><AmfPages page={page} creatorReady={creatorReady} navigate={actions.navigate} prepareEnv={actions.prepareEnv} /></Suspense></AmfBoundary>;
    case "settings-modules":
      return <ModulesPage onOpen={() => actions.navigate("warehouse")} />;
    case "tools-discover":
      return <ToolsHub onPrepareSteam={() => actions.navigate("env-play")} />;
    case "tools-devices":
    case "tools-calibration":
    case "tools-installed":
      return <ToolsPage page={page as ToolsPageId} />;
    case "settings-environment":
      return <EnvironmentSettingsPage />;
    case "settings-accounts":
      return <AccountSettingsPage />;
    case "settings-theme":
      return <ThemeSettingsPage {...prefs} />;
    case "settings-experimental":
      return (
        <ExperimentalSettingsPage
          uiRoot={uiRoot}
          onUiRootChange={onUiRootChange}
        />
      );
    case "settings-about":
      return <AboutPage />;
  }
}

/**
 * 应用壳(G3):在 GatewayProvider 内渲染,页面数据一律经 Gateway hooks
 * 取得;creatorReady 由环境快照计算,不再读 scenario 负载。
 */
function AppShell({
  page,
  navigate: navigatePage,
  showOnboarding,
  autoStartTour,
  startupComplete,
  onTourFinish,
  onOnboardingComplete,
  actions,
  uiRoot,
  onUiRootChange,
}: {
  page: PageId;
  navigate: (target: PageId) => void;
  showOnboarding: boolean;
  autoStartTour: boolean;
  startupComplete: boolean;
  onTourFinish: () => void;
  onOnboardingComplete: (result: OnboardingResult) => void;
  /** 壳层注入的动作(openPalette/navigate 由 AppShell 内部补齐,见 pageActions) */
  actions: Omit<PageActions, "openPalette" | "navigate" | "openAccounts" | "startTour">;
  /** 多套 UI 根(019 批 A):共享容器持有,切换不重建 Gateway */
  uiRoot: UiRootId;
  onUiRootChange: (root: UiRootId) => void;
}) {
  // 008 路径 a 桌面接线(W19):删除偏好开启时,生成完成即逐条目发起独立删除任务
  const amf = useAmfModule();
  const [guideRequest, setGuideRequest] = useState<GuideRequest | null>(null);
  const guideRequestNonce = useRef(0);
  const acknowledgeGuide = (nonce: number) => setGuideRequest(current => shouldClearGuideRequest(current, nonce) ? null : current);
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
  const activeModule = page === "home" || page.startsWith("help") ? "global" : moduleOf(page);
  // Retired layout preferences never change the ordinary desktop shell.
  useEffect(() => { try { localStorage.removeItem(storageKeys.retiredDisplayMode); } catch { /* Ignored even when storage is unavailable. */ } }, []);
  const settingsOpen = page.startsWith("settings-");
  // Settings temporarily covers the source page; its local workflow stays mounted.
  const [settingsReturn, setSettingsReturn] = useState<PageId | null>(() => {
    const saved = window.history.state?.vuaSettingsReturn;
    return settingsOpen && typeof saved === "string" && isPageId(saved) && !saved.startsWith("settings-") ? saved : null;
  });
  useEffect(() => {
    if (!settingsOpen) return;
    const saved = window.history.state?.vuaSettingsReturn;
    if (settingsReturn === null && typeof saved === "string" && isPageId(saved) && !saved.startsWith("settings-")) { setSettingsReturn(saved); return; }
    if (settingsReturn) window.history.replaceState({ ...window.history.state, vuaSettingsReturn: settingsReturn }, "");
  }, [page, settingsOpen, settingsReturn]);
  const navigate = (target: PageId) => {
    target = availablePage(target, amf.installed);
    if (target === page) {
      if (showOnboarding && !settingsOpen) onOnboardingComplete({ status: "skipped", goals: [], environments: [] });
      return;
    }
    if (target.startsWith("settings-")) {
      if (!settingsOpen) setSettingsReturn(page);
      navigatePage(target);
      return;
    }
    const source = settingsOpen ? settingsReturn : page;
    if (source?.startsWith("help-") && target === "help") {
      setSettingsReturn(null);
      navigatePage("help");
      return;
    }
    setSettingsReturn(null);
    if (showOnboarding) onOnboardingComplete({ status: "skipped", goals: [], environments: [] });
    navigatePage(target);
  };
  useEffect(() => {
    if (!amf.installed && isAmfPage(page)) navigatePage("settings-modules");
    setSettingsReturn(previous => previous && !amf.installed && isAmfPage(previous) ? "home" : previous);
  }, [amf.installed, page, navigatePage]);
  const returnFromSettings = () => {
    const candidate = availablePage(settingsReturn ?? "home", amf.installed);
    const target = candidate.startsWith("settings-") ? "home" : candidate;
    navigatePage(target);
    setSettingsReturn(null);
  };
  const onShellCommand = useEffectEvent((command: DesktopShellCommandV1) => {
    if (command === "check-updates") {
      navigate("settings-about");
      void runUpdateCheck({ manual: true });
    }
  });
  useEffect(() => window.vua?.window.shellCommandEvents?.subscribe(onShellCommand), []);
  const onEncyclopediaTarget = useEffectEvent((target: GuideTargetV1 | null) => {
    setGuideRequest({ target, nonce: ++guideRequestNonce.current });
    navigate("help-encyclopedia");
  });
  useEffect(() => {
    const unsubscribe = window.vua?.window.encyclopediaTargetEvents.subscribe(onEncyclopediaTarget);
    const onPreviewRequest = (event: Event) => onEncyclopediaTarget((event as CustomEvent<GuideTargetV1 | null>).detail);
    window.addEventListener(ENCYCLOPEDIA_EVENT, onPreviewRequest);
    return () => { unsubscribe?.(); window.removeEventListener(ENCYCLOPEDIA_EVENT, onPreviewRequest); };
  }, []);

  // 命令面板(C-EFFICIENCY,ui-ux §6.1):Ctrl/Cmd+P 开关;命令 = 全部页面跳转 + 主题切换
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 应用导览重播信号(三类引导裁决 2026-10-05):命令面板动作递增,
  // AppTour 据此从第一步重开;导览的进度/自动开始在其内部自治
  const [tourStartRequest, setTourStartRequest] = useState(0);
  const startTour = () => {
    if (showOnboarding) onOnboardingComplete({ status: "skipped", goals: [], environments: [] });
    setTourStartRequest(value => value + 1);
  };
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

  const commands = useMemo<CommandItem[]>(() => {
    const pages: CommandItem[] = modules.filter(module => module.id !== "production" || amf.installed).flatMap((module) =>
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
      { id: "help", group: "pages", label: strings.journey.help, keywords: "help guidance encyclopedia", run: () => navigate("help") },
      {
        id: "start-tour",
        group: "actions",
        label: strings.tour.paletteEntry,
        keywords: "tour guide onboarding",
        run: startTour,
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
  }, [navigate, resolvedTheme, themeOverride, amf.installed]);

  // 沉浸式自定义标题栏:仅在 Electron 壳内渲染窗口控制(浏览器预览无 preload,不渲染)
  const inShell = window.vua !== undefined;

  // Settings search and the global shortcut share the same command palette.
  const pageActions: PageActions = {
    ...actions,
    prepareEnv: () => navigate("env-create"),
    openPalette: () => setPaletteOpen(true),
    navigate,
    openAccounts: () => navigate("settings-accounts"),
    startTour,
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

  const pagePrefs: PagePrefs = {
    theme: themeOverride ?? themePref, hc,
    onThemeChange: (next) => {
      if (themeOverride !== null) {
        if (next === "dark" || next === "light") setThemeOverride(next);
        return;
      }
      setThemePref(next);
    },
    onHcChange: setHc,
    saverOn: effects === "off",
    onSaverToggle: () => setEffects(current => current === "off" ? "on" : "off"),
    saverAuto: effectsAuto, onSaverAutoChange: setEffectsAuto, steamVRRunning,
  };
  const contentPage = settingsOpen ? settingsReturn : page;

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
        <button type="button" className="vua-shell__logo-home" aria-label={strings.journey.home} title={strings.journey.home} data-nav-id="logo-home" onClick={() => navigate("home")}>
          <span className="vua-shell__wordmark"><BrandMark domain={activeModule} /></span>
        </button>
        <div className="vua-shell__location vua-drag-region">
          {settingsOpen ? <Button variant="primary" className="vua-shell__back" data-nav-id="shell-back" onClick={returnFromSettings}><Icon name="arrow-left" size={20} />{strings.journey.back}</Button> : null}
        </div>
        {/* Resource headroom summary; details retain each measured resource. */}
        <ResourceMonitor />
        <button type="button" className="vua-shell__tab vua-shell__help" aria-current={page.startsWith("help") ? "page" : undefined} data-nav-id="shell-help" onClick={() => navigate("help")}>
          <span className="vua-shell__tab-label">{strings.journey.help}</span>
        </button>
        {/* 设置固定最右侧(§2.1):与业务 Tab 同款平行四边形 pressed 卡;
         *  S-X-1 起顶栏选中态由卡片自身承载(深底+内阴影),不再用滑动 pill */}
        <button
          type="button"
          className="vua-shell__tab vua-shell__settings"
          aria-current={settingsOpen ? "page" : undefined}
          data-nav-id="shell-settings"
          onClick={() => settingsOpen ? returnFromSettings() : navigate("settings-theme")}
        >
          <span className="vua-shell__tab-label">{tabLabel(moduleDef("settings"))}</span>
        </button>
        {/* 通知中心顶栏入口(对标 Comfy 铃铛,自绘):保留任务与通知投影;
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
        <aside className={`vua-shell__sidebar${settingsOpen ? " vua-shell__sidebar--settings" : ""}`} aria-label={settingsOpen ? strings.nav.tabs.settings : strings.app.sidebarAria}>
          {settingsOpen ? <div className="vua-shell__sidebar-group vua-shell__sidebar-group--settings" data-module="settings">
            {moduleDef("settings").groups.flatMap(g => g.pages).map(p => <button type="button" key={p.id} className="vua-shell__sidebar-item" aria-current={page === p.id ? "page" : undefined} onClick={() => navigate(p.id)} data-nav-id={`nav-${p.id}`}>{pageLabel(p)}</button>)}
          </div> : (["env", "production"] as const).filter(group => group !== "production" || amf.installed).map(group => <div className="vua-shell__sidebar-group" key={group} data-module={group}>
            <button type="button" className="vua-shell__sidebar-label" onClick={() => navigate(group === "env" ? "environment-hub" : "avatar-hub")}>{group === "env" ? strings.journey.environment : TERMS.amf}</button>
            {directory[group].map(item => <button type="button" key={item.id} className="vua-shell__sidebar-item" aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)} data-nav-id={`nav-${item.id}`}>{item.title}</button>)}
          </div>)}
          {!settingsOpen && !amf.installed ? <div className="vua-shell__sidebar-group" data-module="amf-enablement">
            <span className="vua-shell__sidebar-label">{TERMS.amf}</span>
            <button type="button" className="vua-shell__sidebar-item vua-shell__amf-entry" data-nav-id="nav-enable-amf" onClick={() => {
              navigate("env-create");
              window.requestAnimationFrame(() => document.querySelector(".vua-creator-page [data-amf-setup]")?.scrollIntoView({ block: "start" }));
            }}><Icon name="arrow-right" size={16} />{format(strings.amfModule.enable, { amf: TERMS.amf })}</button>
          </div> : null}
          {settingsOpen ? <div className="vua-shell__sidebar-footer">
            <LanguageSelector />
            <button
              type="button"
              className="vua-shell__sidebar-search"
              data-nav-id="settings-search"
              aria-keyshortcuts="Control+P Meta+P"
              title={`${strings.commandPalette.cta} · ${strings.commandPalette.ctaHint}`}
              onClick={() => setPaletteOpen(true)}
            >
              {strings.commandPalette.cta}
            </button>
          </div> : null}
        </aside>
        <main className="vua-shell__main">
          {contentPage !== null ? <div hidden={showOnboarding || settingsOpen} key={contentPage} className="vua-page-enter">
            {renderPage(contentPage, creatorReady, pageActions, pagePrefs, uiRoot, onUiRootChange, amf, { request: guideRequest, acknowledge: acknowledgeGuide })}
          </div> : null}
          {showOnboarding ? <div key="first-run" hidden={settingsOpen}><OnboardingPage onComplete={onOnboardingComplete} onAccounts={pageActions.openAccounts} /></div> : null}
          {settingsOpen ? <div key={page} className="vua-page-enter">{renderPage(page, creatorReady, pageActions, pagePrefs, uiRoot, onUiRootChange, amf, { request: guideRequest, acknowledge: acknowledgeGuide })}</div> : null}
        </main>
      </div>
      {/* 导航确认卡(015 §12,批 B-3):U9(1)/(3) 确认层的渲染层载体,全局一次挂载 */}
      <NavigationConfirmOverlay />
      {/* 应用导览(三类引导裁决 2026-10-05):主窗口内有序高亮;从未运行自动
       *  开始,active 按步号恢复,重播经命令面板;状态独立于阅读器/安装 */}
      {!showOnboarding && startupComplete ? <AppTour page={page} navigate={navigate} startRequest={tourStartRequest} autoStart={autoStartTour} onFinish={onTourFinish} /> : null}
      {/* 窗口级登录浏览器(2026-10-05 用户裁决):无开启意图时零渲染;视图
          生命周期归组件(卸载即关),宿主不依赖任何页面/弹窗 */}
      <LoginBrowserOverlay />
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
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
  const [firstTourPending, setFirstTourPending] = useState(() => {
    if (override !== null) return false;
    try { return firstTourRequired(!entry.showOnboarding, localStorage.getItem(storageKeys.tourProgress)); }
    catch { return entry.showOnboarding; }
  });
  // Main owns the native splash; browser previews retain an in-page fallback.
  const [splashDone, setSplashDone] = useState(false);
  const nativeStartup = window.vua?.startup;
  const finishStartup = () => {
    setSplashDone(true);
    void nativeStartup?.complete().catch(() => { /* Main's bounded fallback still opens the shell. */ });
  };
  const finishFirstTour = () => {
    if (!firstTourPending) return;
    setFirstTourPending(false);
    setPage("home");
  };
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
  // 结果落缓存供设置页呈现;延迟 2.5s 让启动链路先行,失败
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
    const rawPageParam = params.get("page");
    const pageParam = rawPageParam === null ? null : migratePageId(rawPageParam);
    if (!entry.showOnboarding && hashPage) return hashPage;
    return !entry.showOnboarding && isPageId(pageParam) ? pageParam : entry.page;
  });
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  function navigate(target: PageId, updateHash = true) {
    if (target !== pageRef.current) { closeLoginBrowser(); closeBrowserModal(); }
    // 不做强制重定向(v0.3.3 §2.1):所有页面直达,阻断由页面内诚实状态表达
    setPage(target);
    if (!showOnboarding && updateHash) {
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
      if (target && target !== pageRef.current) navigate(target, false);
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
    if (result.page) navigate(result.page);
  }

  const actions: Omit<PageActions, "openPalette" | "navigate" | "openAccounts" | "startTour"> = {
    prepareEnv: () => navigate("env-create"),
  };

  return (
    <GatewayProvider gateway={gateway}>
      {!splashDone ? (nativeStartup ? <BootGate onDone={finishStartup} /> : <BootSplash onDone={finishStartup} />) : null}
      {uiRoot === "forest-green" ? (
        <ForestVariantRoot onBackToCurrent={() => setUiRoot("current")} />
      ) : (
        <AppShell
          page={page}
          navigate={navigate}
          showOnboarding={showOnboarding && !firstTourPending}
          autoStartTour={firstTourPending}
          startupComplete={splashDone}
          onTourFinish={finishFirstTour}
          onOnboardingComplete={handleOnboardingComplete}
          actions={actions}
          uiRoot={uiRoot}
          onUiRootChange={setUiRoot}
        />
      )}
    </GatewayProvider>
  );
}

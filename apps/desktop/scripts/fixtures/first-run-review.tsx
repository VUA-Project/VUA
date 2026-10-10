import { createRoot, type Root } from "react-dom/client";
import type { DesktopShellCommandV1, VuaDesktopApiV2 } from "@vua/contracts";
import { App } from "../../src/renderer/App.tsx";
import { strings } from "../../src/renderer/i18n/index.ts";
import { storageKeys } from "../../src/renderer/app/storage-keys.ts";
import { TOUR_STEPS } from "../../src/renderer/features/tour/tour-model.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";

const copy = strings.journey;
let root: Root | undefined;
let scenario: "installed" | "missing" | "restored" = "installed";
let guideId: string | null = null;
const intents: string[][] = [];
const checks: string[] = [];
let shellCommand: ((command: DesktopShellCommandV1) => void) | undefined;
let updateChecks = 0;
let playUnavailable = false, installationRunning = false, websiteCalls = 0, borrowedSteam = true;
const playStates: Record<string, string> = { desktop_play: "idle", pico_pcvr: "idle" };
const playCalls: string[] = [];
function syntheticPlay(route: string) {
  const state = playStates[route]; const active = state !== "idle";
  return { playSession: { schemaVersion: "vua.play-session/v0.2", capturedAt: new Date().toISOString(), route, state, issue: null, canStop: active,
    software: (route === "desktop_play" ? ["steam", "vrchat"] : ["steam", "pico_runtime", "steamvr", "vrchat"]).map(component => ({ component,
      presence: scenario === "missing" ? "missing" : "verified", running: component === "steam" ? borrowedSteam || active : state === "running" || state === "stopping",
      owned: component === "steam" ? !borrowedSteam && active : state === "running" || state === "stopping" })) } };
}
const check = (name: string, value: unknown) => { if (!value) throw new Error(name); checks.push(name); };
const wait = async (predicate: () => unknown, label = "") => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 10000) throw new Error(`UI condition timed out: ${label}; wizard=${document.querySelector("[data-wizard-step]")?.getAttribute("data-wizard-step")}`); await new Promise(r => setTimeout(r, 25)); }
};
const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest("[hidden]");
const detailsBelowCard = (control: Element) => {
  const entry = control.closest('[data-card-entry]')!;
  const card = entry.firstElementChild!, detail = document.getElementById(control.getAttribute('aria-controls')!)!;
  const cardRect = card.getBoundingClientRect(), detailRect = detail.getBoundingClientRect();
  return detail.parentElement === entry && card.nextElementSibling === detail && visible(detail)
    && Math.abs(detailRect.left - cardRect.left) < 1 && Math.abs(detailRect.width - cardRect.width) < 1
    && detailRect.top >= cardRect.bottom && detailRect.top - cardRect.bottom <= 14 && detail.scrollWidth <= detail.clientWidth + 2;
};
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => visible(el) && (el.textContent?.trim() === label || el.querySelector("strong")?.textContent === label));
const click = async (label: string) => { await wait(() => button(label) && !button(label)!.disabled, `button ${label}`); button(label)!.focus(); button(label)!.click(); };
const step = (value: string) => wait(() => document.querySelector(`[data-wizard-step="${value}"]`), `step ${value}`);
const settlePage = async () => {
  await wait(() => { const page = document.querySelector(".vua-page-enter"); return page && parseFloat(getComputedStyle(page).opacity) > 0.99; }, "page transition completed");
  document.querySelector(".vua-page")!.scrollTop = 0;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};

window.vua = {
  gateway: { invoke: async (req: { method: string; params?: { intent?: { purposes: string[] }; route?: string; urls?: string[]; path?: string }; }) => {
    let value: unknown;
    if (req.method === "app.snapshot") value = { capabilities: { tasks: true, operations: ["environment.planDeployment", "environment.executeDeployment", "environment.testWebsites", "environment.observePlay", "environment.startPlay", "environment.stopPlay", "environment.inspectManagerApps"].map(operationId => ({ operationId, availability: "available" })) } };
    if (req.method === "task.list") value = { revision: 1, tasks: [] };
    if (req.method === "environment.getSnapshot") value = { contractVersion: "0.1", revision: 0, capturedAt: new Date().toISOString(), items: [{ checkId: "unity_editors", zone: "create", presence: "detected", facts: { editors: ["2022.3.22f1", "2019.4.31f1", "2021.3.45f1"].map(version => ({ version, path: `C:/Synthetic/Unity/${version}`, classification: "other_unity_version" })) } }] };
    if (req.method === "environment.testWebsites") { websiteCalls += 1; value = { websiteTests: req.params!.urls!.map(url => ({ url, status: "reachable", elapsedMs: 8, httpStatus: 200 })) }; }
    if (["environment.observePlay", "environment.startPlay", "environment.stopPlay"].includes(req.method)) {
      if (playUnavailable) return { ok: false, error: { code: "unsupported_method", messageKey: "synthetic" } };
      const route = req.params!.route!;
      if (req.method !== "environment.observePlay") { const stopping = req.method === "environment.stopPlay"; playCalls.push(req.method + ":" + route); playStates[route] = stopping ? "stopping" : "starting"; setTimeout(() => { playStates[route] = stopping ? "idle" : "running"; }, 100); }
      value = syntheticPlay(route);
    }
    if (req.method === "project.environmentManagers") value = { operation: req.method, result: { schemaVersion: "vua.environment-managers-snapshot/v0.1", editors: ["2022.3.22f1", "2019.4.31f1", "2021.3.45f1"].map(version => ({ version, path: `C:/Synthetic/Unity/${version}`, classification: "other_unity_version" })), vcc: { presence: "found" }, alcom: { presence: "not_found" } } };
    if (req.method === "environment.verifyEditor") value = { verdict: "verified", version: req.params!.path!.split("/").at(-1), exePath: req.params!.path! + "/Editor/Unity.exe", classification: "other_unity_version" };
    if (req.method === "environment.inspectManagerApps") value = { managerApps: { schemaVersion: "vua.manager-apps/v0.1", capturedAt: new Date().toISOString(), apps: ["unity_hub", "vcc", "alcom"].map(component => ({ component, presence: component === "alcom" ? "not_found" : "found", path: component === "alcom" ? null : `C:/Synthetic/${component}.exe` })) } };
    if (req.method === "environment.planDeployment") {
      intents.push([...req.params!.intent!.purposes]);
      value = { deploymentPlan: { schemaVersion: "vua.environment-deployment/v0.1", intent: req.params!.intent, digest: "a".repeat(64), prerequisitesReady: scenario === "installed", installer: null,
        steps: ["steam", "vrchat"].map(component => ({ component, action: scenario === "installed" ? "retain" : "manual_install", reason: scenario === "installed" ? "verified" : "missing", location: null, version: null,
          officialUrl: component === "steam" ? "https://store.steampowered.com/about/" : "https://store.steampowered.com/app/438100/" })) } };
    }
    if (req.method === "environment.executeDeployment") value = { schemaVersion: "vua.environment-deployment/v0.1", operation: req.method, taskId: "synthetic-deployment", correlationId: "synthetic" };
    if (req.method === "task.get") value = { contractVersion: "0.1", taskId: "synthetic-deployment", correlationId: "synthetic", revision: 1, state: installationRunning ? "running" : "succeeded_with_warnings", recoveryDisposition: "none", cancellationRequested: false, updatedAt: new Date().toISOString(),
      result: scenario === "restored" ? { outcome: "prerequisites_verified" } : { outcome: "manual_required", nextStep: { component: "vrchat", action: "manual_install", officialUrl: "https://store.steampowered.com/app/438100/" } } };
    return value ? { ok: true, value } : { ok: false, error: { code: "unsupported_method", messageKey: "synthetic" } };
  } }, events: { subscribe: () => () => {} },
  window: { showReader: async () => {}, showGameGuide: async () => {}, showOverlay: async () => {},
    showEncyclopedia: async () => ({ visible: true }), encyclopediaTargetEvents: { subscribe: () => () => {} },
    shellCommandEvents: { subscribe: (listener: typeof shellCommand) => { shellCommand = listener; return () => { shellCommand = undefined; }; } } },
  system: {
    readResourceUsage: async () => ({ schemaVersion: 1, ramUsedBytes: 1024, ramTotalBytes: 4096, vramUsedBytes: null, vramTotalBytes: null, sampledAt: new Date().toISOString() }),
    checkUpdate: async () => { updateChecks += 1; return { schemaVersion: 1, state: "up-to-date", currentVersion: "synthetic", latestVersion: "synthetic", releaseUrl: null, checkedAt: new Date().toISOString() }; },
  },
  remoteContent: { openAccountGuideInBrowser: async (id: string) => { guideId = id; }, authProbe: async () => ({ authOk: false, accountName: null }) },
} as unknown as VuaDesktopApiV2;

async function mount(mode: typeof scenario = "installed", legacyMode = "desktop") {
  root?.unmount(); localStorage.clear(); location.hash = ""; scenario = mode; playUnavailable = false; installationRunning = false; websiteCalls = 0; borrowedSteam = true; playStates.desktop_play = "idle"; playStates.pico_pcvr = "idle"; playCalls.length = 0;
  localStorage.setItem(storageKeys.locale, "en");
  localStorage.setItem(storageKeys.retiredDisplayMode, legacyMode);
  localStorage.setItem(storageKeys.tourProgress, JSON.stringify({ v: 1, status: "skipped", step: 0 }));
  if (mode === "restored") {
    localStorage.setItem(storageKeys.firstRunJourney, JSON.stringify({ v: 1, step: "prepare", purpose: "desktop_play", connection: null }));
    localStorage.setItem(storageKeys.deploymentReceiptPlay, JSON.stringify({ v: 1, taskId: "synthetic-deployment", startedAt: Date.now() - 60000, intent: { purposes: ["desktop_play"], editorRoot: "C:/Synthetic/Editor" } }));
  }
  root = createRoot(document.getElementById("root")!); root.render(<App />);
  await wait(() => document.querySelector(".vua-shell"));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(() => !document.querySelector(".vua-boot-splash"));
}
async function prepare() {
  await click(copy.playGoal); await step("play-mode"); await click(copy.desktop); await step("network");
  await click(copy.networkContinue); await step("prepare"); await click(strings.deployment.plan);
}
const review = {
  async run() {
    await mount(); await step("goal");
    check("a new session defaults to Dark with the system set to Light", localStorage.getItem(storageKeys.theme) === "dark" && document.documentElement.dataset.theme === "dark");
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => document.querySelector(".vua-home") && !document.querySelector("[data-wizard-step]"));
    check("logo exits the first-run guide even when Home is already the underlying page", !document.querySelector("[data-wizard-step]"));
    await mount(); await step("goal");
    check("single-choice first page has no Continue action", !button(copy.next));
    await click(copy.playGoal); await step("play-mode");
    await click(copy.vr); await step("headset");
    check("Quest stays a disabled peer", [...document.querySelectorAll<HTMLButtonElement>("button")].some(el => el.textContent?.includes("Meta Quest") && el.disabled));
    check("headset choices use distinct brand glyphs including the supplied PICO wordmark", ["pico", "meta", "htcvive", "valve"].every(brand => document.querySelector(`[data-brand="${brand}"] svg path`)));
    await click(copy.restart); await step("goal"); await prepare(); await wait(() => button(copy.preparedNext));
    check("desktop plans only desktop prerequisites", intents.at(-1)?.join() === "desktop_play");
    await click(copy.preparedNext); await step("launch"); await click(copy.accounts);
    await wait(() => document.querySelector(".vua-account-grid")); await click(copy.linking);
    await click(copy.official); check("registration handoff sends a closed guide ID", guideId === "linking");
    check("settings sidebar contains only settings pages", document.querySelectorAll(".vua-shell__sidebar [data-module='settings']").length === 1 && !document.querySelector(".vua-shell__sidebar [data-module='env'], .vua-shell__sidebar [data-module='production']"));
    document.querySelector<HTMLButtonElement>(".vua-journey-actions [data-back]")!.click();
    await wait(() => document.querySelector(".vua-account-grid") && visible(document.querySelector(".vua-account-grid")!));
    check("account guide has its own one-level Back", !!document.querySelector(".vua-account-grid"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-back"]')!.click(); await step("launch");
    check("account return retains the launch step", !!document.querySelector('[data-wizard-step="launch"]'));
    check("account return leaves the originating control available", !!button(copy.accounts));
    await click(copy.finish); await wait(() => document.querySelector(".vua-home"));
    check("finishing the wizard returns to the fixed Home", !document.querySelector("[data-wizard-step]"));
    check("only the logo is the Home action", document.querySelectorAll('[data-nav-id="logo-home"]').length === 1 && !document.querySelector(".vua-shell__tabs"));
    check("home has no tile subtitles", !document.querySelector(".vua-home .vua-route-tile__description"));
    check("header no longer repeats the page title beside the logo", !document.querySelector(".vua-shell__location strong"));
    const headerLabels = [...document.querySelectorAll(".vua-shell__header button")].map(el => el.textContent?.trim());
    check("header has no Tasks, theme or search button", [copy.tasks, strings.settings.theme.dark, strings.settings.theme.light, strings.commandPalette.cta].every(label => !headerLabels.some(text => text?.includes(label))));
    await wait(() => document.querySelector(".vua-shell__notify"));
    check("ready task capability retains the bell without mounting a bottom taskbar", !!document.querySelector(".vua-shell__notify") && !document.querySelector(".vua-shell__taskbar"));
    await mount("installed", "desktop"); await step("goal");
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => !document.querySelector("[data-wizard-step]"));
    check("AMF remains inactive until explicit enablement", !document.querySelector('.vua-shell__sidebar [data-module="production"]') && !!document.querySelector('[data-nav-id="nav-enable-amf"]'));
    check("bottom-left duplicate settings and help entries are gone", !document.querySelector(".vua-shell__sidebar-global") && !document.querySelector('.vua-shell__sidebar [data-nav-id="nav-settings-theme"]'));
    check("desktop sidebar is narrower and retains frosted glass", document.querySelector(".vua-shell__sidebar")!.getBoundingClientRect().width === 176 && getComputedStyle(document.querySelector(".vua-shell__sidebar")!).backdropFilter.includes("blur"));
    check("feature search has no sidebar button outside Settings", !document.querySelector('[data-nav-id="settings-search"]'));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelector(".vua-palette"));
    check("Ctrl+P still opens feature search outside Settings", !!document.querySelector(".vua-palette"));
    document.querySelector<HTMLInputElement>(".vua-palette__input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(() => !document.querySelector(".vua-palette"));
    await click(copy.play); await click(copy.desktop);
    await wait(() => document.querySelector('[data-route-stage="prepare"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    await wait(() => document.querySelector('[data-nav-id="nav-settings-accounts"]'));
    const search = document.querySelector<HTMLButtonElement>('[data-nav-id="settings-search"]')!;
    const sidebar = document.querySelector<HTMLElement>(".vua-shell__sidebar")!;
    check("Settings places its single search button at the sidebar bottom", search.closest(".vua-shell__sidebar-footer") && sidebar.lastElementChild === search.parentElement && Math.abs(search.getBoundingClientRect().bottom - (sidebar.getBoundingClientRect().bottom - parseFloat(getComputedStyle(sidebar).paddingBottom))) < 2);
    search.click(); await wait(() => document.querySelector(".vua-palette"));
    check("Settings search button opens the command palette", !!document.querySelector(".vua-palette"));
    document.querySelector<HTMLInputElement>(".vua-palette__input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(() => !document.querySelector(".vua-palette"));
    check("appearance has ordered connected Dark / Light / System choices", [...document.querySelectorAll(".vua-theme-choice__button")].map(el => el.getAttribute("data-nav-id")).join() === "theme-dark,theme-light,theme-system");
    await review.setThemePreference("light");
    check("Light applies immediately and only its appearance button is selected", document.documentElement.dataset.theme === "light" && document.querySelectorAll('.vua-theme-choice [aria-pressed="true"]').length === 1 && document.querySelector('[data-nav-id="theme-light"][aria-pressed="true"]'));
    await review.setThemePreference("system");
    check("System keeps its own saved selection even when resolved to Light", document.documentElement.dataset.theme === "light" && localStorage.getItem(storageKeys.theme) === "system" && document.querySelector('[data-nav-id="theme-system"][aria-pressed="true"]'));
    await review.setThemePreference("dark");
    document.querySelector<HTMLButtonElement>('[data-nav-id="nav-settings-accounts"]')!.click();
    await wait(() => document.querySelector(".vua-account-grid"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    await wait(() => document.querySelector('[data-route-stage="prepare"]') && visible(document.querySelector('[data-route-stage="prepare"]')!));
    check("clicking Settings again returns to the source workflow without resetting its step", !!document.querySelector('[data-route-stage="prepare"]'));
    localStorage.setItem(storageKeys.updateCheckEnabled, "off");
    const beforeChecks = updateChecks;
    shellCommand!("check-updates");
    await wait(() => document.querySelector('[data-nav-id="nav-settings-about"][aria-current="page"]') && updateChecks > beforeChecks);
    check("tray update gesture opens About and checks even when automatic checks are disabled", updateChecks > beforeChecks);
    shellCommand!("bigscreen");
    await new Promise(resolve => requestAnimationFrame(resolve));
    check("legacy big-screen gesture cannot resurrect the retired mode", !document.querySelector('.vua-shell[data-display-mode]') && !!document.querySelector('[data-nav-id="nav-settings-about"][aria-current="page"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-back"]')!.click();
    await wait(() => !document.querySelector('[data-nav-id="nav-settings-about"]'));
    check("tray-opened settings retains the same source page", !!document.querySelector('[data-route-stage="prepare"]'));
    await mount("missing"); await prepare(); await wait(() => button(strings.deployment.execute));
    check("missing software cannot continue", !button(copy.preparedNext));
    await click(strings.deployment.execute); await wait(() => document.body.textContent?.includes(strings.deployment.manualRequired));
    check("manual handoff cannot imply ready", !button(copy.preparedNext));
    scenario = "installed"; await click(strings.deployment.plan); await wait(() => button(copy.preparedNext));
    check("fresh detection enables continuation", !!button(copy.preparedNext));
    await mount("restored"); await step("prepare"); await wait(() => button(strings.deployment.plan) && !button(strings.deployment.plan)!.disabled);
    check("old terminal receipt alone does not authorize continuation", !button(copy.preparedNext));
    scenario = "installed"; await click(strings.deployment.plan); await wait(() => button(copy.preparedNext));
    check("restored work can continue after reinspection", !!button(copy.preparedNext));
    await mount("installed", "bigscreen"); await step("goal");
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => document.querySelector('[data-nav-id="home-help"]'));
    check("a saved big-screen preference is cleared and retains the ordinary Home directory", localStorage.getItem(storageKeys.retiredDisplayMode) === null && !document.querySelector('.vua-shell[data-display-mode]'));
    await click(copy.help); document.querySelector<HTMLButtonElement>('[data-nav-id="help-tour"]')!.click();
    await wait(() => document.querySelector('[data-nav-id="help-start-tour"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="help-start-tour"]')!.click();
    for (let index = 0; index < TOUR_STEPS.findIndex(step => step.id === "tasks"); index += 1) {
      await wait(() => document.querySelector('.vua-tour .vua-button--primary'));
      document.querySelector<HTMLButtonElement>('.vua-tour .vua-button--primary')!.click();
      await wait(() => JSON.parse(localStorage.getItem(storageKeys.tourProgress)!).step === index + 1);
    }
    await wait(() => document.querySelector('[data-nav-id="home-tasks"]') && document.querySelector(".vua-tour__highlight") && document.querySelector(".vua-tour")?.textContent?.includes(strings.tour.steps.tasks.body), "task tour page and highlight");
    const taskTile = document.querySelector('[data-nav-id="home-tasks"]')!.getBoundingClientRect();
    const taskHighlight = document.querySelector(".vua-tour__highlight")!.getBoundingClientRect();
    check("explicit task-tour step highlights the Home Tasks entry", document.querySelector(".vua-tour")?.textContent?.includes(strings.tour.steps.tasks.body) && Math.abs((taskTile.x + taskTile.width / 2) - (taskHighlight.x + taskHighlight.width / 2)) < 1 && Math.abs((taskTile.y + taskTile.height / 2) - (taskHighlight.y + taskHighlight.height / 2)) < 1);
    await mount(); await step("goal");
    return checks;
  },
  async runEnvironmentCards() {
    const startAt = checks.length;
    await mount("installed", "desktop"); await step("goal"); document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click(); await wait(() => !document.querySelector("[data-wizard-step]"));
    check("Software & connections is absent from the fixed directory", !document.querySelector('[data-nav-id="nav-software"]') && !document.querySelector('[data-nav-id="home-software"]'));
    await click(copy.play); const card = () => document.querySelector<HTMLElement>('[data-card="route-desktop"]')!;
    await wait(() => card()?.dataset.action === "start");
    const halves = card().querySelectorAll<HTMLButtonElement>(":scope > button"); const network = document.querySelector<HTMLElement>(".vua-network-tile")!;
    const separatorWidth = parseFloat(getComputedStyle(halves[1]!).borderLeftWidth);
    check("play card has two independent halves and a thin separator", halves.length === 2 && !halves[0]!.disabled && separatorWidth > 0 && separatorWidth <= 1);
    check("network is above the environments and has the same height", network.getBoundingClientRect().bottom <= card().getBoundingClientRect().top && Math.abs(network.getBoundingClientRect().height - card().getBoundingClientRect().height) < 1);
    check("entering Play makes no website test requests", websiteCalls === 0);
    check("unconfirmed regional ping remains unavailable", document.querySelector<HTMLButtonElement>('[data-nav-id="play-network-test"]')!.disabled && network.textContent?.includes(strings.websiteTests.europe) && network.textContent?.includes(strings.websiteTests.west) && network.textContent?.includes(strings.websiteTests.east));
    document.querySelector<HTMLButtonElement>('[data-nav-id="play-network-details"]')!.click();
    await wait(() => visible(document.querySelector(".vua-network")!));
    document.querySelector<HTMLButtonElement>(`.vua-network [aria-label="${strings.websiteTests.testAll}"]`)!.click(); await wait(() => websiteCalls === 1 && document.querySelector(".vua-network")!.textContent?.includes("ms"));
    check("website tests live only in expanded details and cannot become regional ping", websiteCalls === 1 && !network.textContent?.includes("ms"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop"]')!.click(); await wait(() => document.querySelector('[data-route-stage="prepare"]'));
    check("left half opens details without launching software", playCalls.length === 0 && document.querySelector(".vua-environment-software"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop-action"]')!.click(); await wait(() => card().dataset.action === "stop");
    check("pending start offers scoped close rather than a second start", card().querySelector(".vua-environment-card__action")!.getAttribute("aria-label")?.includes("Close this session"));
    await wait(() => card().textContent?.includes(strings.environmentCards.close));
    check("observed running software identifies pre-existing Steam as retained", document.querySelector(".vua-environment-software")!.textContent?.includes(strings.environmentCards.borrowed));
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop-action"]')!.click(); await wait(() => card().dataset.action === "start");
    check("close returns the environment to play after observation", playCalls.join() === "environment.startPlay:desktop_play,environment.stopPlay:desktop_play");
    borrowedSteam = false;
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop-action"]')!.click(); await wait(() => playStates.desktop_play === "running");
    playStates.desktop_play = "finished";
    await click(strings.environmentCards.inspect);
    await wait(() => card().textContent?.includes(strings.environmentCards.close) && document.querySelector(".vua-environment-software li")!.textContent?.includes(strings.environmentCards.owned)
      && document.querySelectorAll(".vua-environment-software li")[1]!.querySelectorAll("span").length === 1, "finished session observed with only owned Steam still running");
    check("normal game exit keeps Close for owned Steam without a warning or failure", card().dataset.action === "stop" && card().textContent?.includes(strings.environmentCards.close) && !card().querySelector(".vua-environment-card__warning") && !document.querySelector(".vua-play-page [role=alert]"));
    playStates.desktop_play = "idle";
    await click(strings.environmentCards.inspect); await wait(() => card().dataset.action === "start");
    check("exit of all owned software restores Play without an extra close request", playCalls.filter(call => call.startsWith("environment.stopPlay:")).length === 1);
    check("Quest, Vive and Index remain development peers", ["quest", "vive", "index"].every(id => document.querySelector(`[data-card="route-${id}"] .vua-route-tile__tag`)?.textContent === copy.developing));
    playUnavailable = true; await click(strings.environmentCards.inspect); await wait(() => card().dataset.action === "unknown");
    check("provider failure is unknown instead of missing or ready", card().textContent?.includes(strings.environmentCards.unknown));
    await click(copy.create); await wait(() => document.querySelector('[data-nav-id="editor-2019.4.31f1"]'));
    check("creator lists complete discovered versions beside the fixed Unity entries", document.querySelector('[data-nav-id="route-unity2022"]') && document.querySelector('[data-nav-id="editor-2021.3.45f1"]') && document.querySelector('[data-nav-id="route-unity6"] .vua-route-tile__tag')?.textContent === copy.developing);
    check("Hub, VCC and ALCOM have separate detected statuses", ["unity_hub", "vcc", "alcom"].every(id => document.querySelector(`[data-manager="${id}"] [role="status"]`)) && document.querySelector('[data-manager="alcom"]')!.textContent?.includes(strings.environmentCards.notFound));
    document.querySelector<HTMLButtonElement>('[data-nav-id="manager-vcc"]')!.click(); await wait(() => !document.querySelector<HTMLElement>("#manager-vcc-details")!.hidden);
    check("manager configuration is shown separately from executable detection", document.querySelector("#manager-vcc-details")!.textContent?.includes(strings.environmentCards.configFound));
    document.querySelector<HTMLButtonElement>('[data-nav-id="manager-vcc"]')!.click();
    for (const control of document.querySelectorAll<HTMLButtonElement>('.vua-creator-page .vua-card-entry [aria-controls]')) {
      control.click();
      await wait(() => control.getAttribute('aria-expanded') === 'true');
      check(`${control.dataset.navId} opens details immediately below its own card`, detailsBelowCard(control));
      control.click();
      await wait(() => control.getAttribute('aria-expanded') === 'false');
    }
    await mount("missing", "desktop"); await step("goal"); document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click(); await wait(() => !document.querySelector("[data-wizard-step]")); await click(copy.play);
    await wait(() => card()?.dataset.action === "prepare"); document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop-action"]')!.click(); await wait(() => button(strings.deployment.execute));
    check("plus opens the reviewed installation plan without launching software", playCalls.length === 0 && !!button(strings.deployment.execute));
    installationRunning = true; await click(strings.deployment.execute); await wait(() => card().dataset.action === "busy");
    check("accepted installation shows a spinner and cannot launch", card().querySelector(".vua-environment-card__spin") && card().textContent?.includes(strings.environmentCards.installing) && document.querySelector<HTMLButtonElement>(".vua-play-page .vua-environment-detail:not([hidden]) .vua-route-platform > button")!.disabled);
    check("details remain available while installation is running", !card().querySelector<HTMLButtonElement>(".vua-environment-card__details")!.disabled);
    const panel = document.querySelector('#route-desktop-details .vua-deployment');
    const receipt = localStorage.getItem(storageKeys.deploymentReceiptPlay);
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop"]')!.click();
    await wait(() => document.querySelector<HTMLElement>('#route-desktop-details')!.hidden);
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-pico"]')!.click();
    await wait(() => !document.querySelector<HTMLElement>('#route-pico-details')!.hidden);
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop"]')!.click();
    await wait(() => !document.querySelector<HTMLElement>('#route-desktop-details')!.hidden);
    check("closing and switching card details retains the live installation panel and receipt", panel === document.querySelector('#route-desktop-details .vua-deployment') && receipt === localStorage.getItem(storageKeys.deploymentReceiptPlay) && card().dataset.action === 'busy');
    return checks.slice(startAt);
  },
  async previewEnvironment(page: "play" | "create") {
    await mount("installed"); await step("goal"); document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click(); await wait(() => !document.querySelector("[data-wizard-step]"));
    await click(copy[page]);
    await wait(() => page === "play" ? document.querySelector<HTMLElement>('[data-card="route-desktop"]')?.dataset.action === "start" : document.querySelector('[data-nav-id="editor-2019.4.31f1"]'));
    await settlePage();
  },
  settlePage,
  async beforeKey(key: string) {
    if (key === "Enter") button(copy.playGoal)!.focus();
  },
  async afterKey(key: string) {
    if (key === "Enter") await step("play-mode");
    if (key !== "Enter") {
      await step("play-mode");
      if (document.querySelector('.vua-shell[data-display-mode]')) throw new Error("Retired keyboard mode became active");
    }
    return `Chromium ${key}: ${key === "Enter" ? "native button opens its branch" : "no retired shell navigation"}`;
  },
  async setThemePreference(theme: "light" | "dark" | "system") {
    if (!document.querySelector('[data-nav-id="nav-settings-theme"]')) {
      document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    } else if (!document.querySelector('[data-nav-id="nav-settings-theme"][aria-current="page"]')) {
      document.querySelector<HTMLButtonElement>('[data-nav-id="nav-settings-theme"]')!.click();
    }
    await wait(() => document.querySelector(`[data-nav-id="theme-${theme}"]`));
    document.querySelector<HTMLButtonElement>(`[data-nav-id="theme-${theme}"]`)!.click();
    await wait(() => localStorage.getItem(storageKeys.theme) === theme);
    await wait(() => {
      const selected = document.querySelector('.vua-theme-choice [aria-pressed="true"]')!.getBoundingClientRect();
      const frame = document.querySelector(".vua-theme-choice__selection")!.getBoundingClientRect();
      return Math.abs(selected.x - frame.x) < 1 && Math.abs(selected.width - frame.width) < 1;
    }, "appearance selection frame matches its button");
  },
  async setResourceSaver(enabled: boolean) {
    await click(enabled ? strings.settings.theme.saverTurnOn : strings.settings.theme.saverTurnOff);
    await wait(() => (document.documentElement.dataset.effects === "off") === enabled);
  },
  expectFlattenedThemeMotion(mode: "reduced-motion" | "resource-saving") {
    const style = getComputedStyle(document.querySelector(".vua-theme-choice__selection")!);
    const flattened = mode === "reduced-motion" ? !style.transitionProperty.includes("transform") : parseFloat(style.transitionDuration) <= 0.001;
    if (!flattened) throw new Error(`Theme frame does not flatten for ${mode}`);
    return `Appearance selection remains usable with ${mode}`;
  },
  async expectSearchFooterVisible() {
    await wait(() => window.innerWidth === 960 && window.innerHeight === 600);
    const search = document.querySelector('[data-nav-id="settings-search"]')!.getBoundingClientRect();
    const categories = document.querySelector(".vua-shell__sidebar-group--settings")!;
    const language = document.querySelector('[data-nav-id="settings-language-select"]')!.getBoundingClientRect();
    if (search.bottom > window.innerHeight || search.top < 0 || language.bottom + 12 > search.top || categories.getBoundingClientRect().bottom > language.top) throw new Error("Language and Search overlap Settings categories in a small window");
    return "Small Settings keeps language and Search separate below its categories";
  },
};
(window as unknown as { firstRunReview: typeof review }).firstRunReview = review;

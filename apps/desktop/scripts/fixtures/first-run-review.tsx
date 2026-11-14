import { createRoot, type Root } from "react-dom/client";
import {
  POSE_SOURCE_IDS,
  scenarioRequiredComponents,
  type DeploymentPurpose,
  type DesktopShellCommandV1,
  type LocalDiagnosticsSnapshotV01,
  type PoseGraphSnapshotV01,
  type SymptomDiagnosisV01,
  type SymptomIdV01,
  type VuaDesktopApiV2,
} from "@vua/contracts";
import { App } from "../../src/renderer/App.tsx";
import { currentLocale, format, strings } from "../../src/renderer/i18n/index.ts";
import { storageKeys } from "../../src/renderer/app/storage-keys.ts";
import { TOUR_STEPS } from "../../src/renderer/features/tour/tour-model.ts";
import { BEGINNER_CONCEPTS } from "../../src/renderer/features/help/beginner-wizard-model.ts";
import { playFlowCopy } from "../../src/renderer/i18n/play-flow-copy.ts";
import { structureCopy } from "../../src/renderer/i18n/structure-copy.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";

const copy = strings.journey;
const flowCopy = playFlowCopy[currentLocale];
const unitySetup = structureCopy[currentLocale].unitySetup;
// Capture the shell's requested theme before App mounting can resolve or persist a default.
const previewTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
let root: Root | undefined;
let scenario: "installed" | "missing" | "restored" = "installed";
let creatorInventory: "all" | "standard" = "all";
const editorVersions = () => creatorInventory === "standard" ? ["2022.3.22f1"] : ["2022.3.22f1", "2019.4.31f1", "2021.3.45f1"];
let guideId: string | null = null;
const intents: string[][] = [];
const checkIntents: string[][] = [];
const checks: string[] = [];
let shellCommand: ((command: DesktopShellCommandV1) => void) | undefined;
let updateChecks = 0;
let creatorInventoryReads = 0;
let playUnavailable = false, installationRunning = false, websiteCalls = 0, borrowedSteam = true;
const playStates: Record<string, string> = { desktop_play: "idle", pico_pcvr: "idle" };
const playCalls: string[] = [];
let playObservationCount = 0;
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
  while (!predicate()) { if (Date.now() - start > 10000) throw new Error(`UI condition timed out: ${label || predicate.toString().slice(0, 160)}; wizard=${document.querySelector("[data-first-use-notice]")?.getAttribute("data-first-use-notice")}`); await new Promise(r => setTimeout(r, 25)); }
};
const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest("[hidden],[inert]");
const flowButton = (route = "desktop_play") => document.querySelector<HTMLButtonElement>(`[data-nav-id="${route === "desktop_play" ? "route-desktop" : "route-pico"}-action"]`);
const flowPhase = (route = "desktop_play") => flowButton(route)?.dataset.phase;
const advance = async (phase: string, route = "desktop_play") => {
  await wait(() => flowPhase(route) === phase && !flowButton(route)!.disabled, `play flow ${phase}`);
  flowButton(route)!.click();
};
const softwareChips = (route = "desktop_play") => [...document.querySelectorAll<HTMLElement>(`.vua-play-flow[data-route="${route}"] .vua-play-flow__software li`)];
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
const settlePage = async () => {
  await wait(() => { const page = document.querySelector(".vua-page-enter"); return page && parseFloat(getComputedStyle(page).opacity) > 0.99; }, "page transition completed");
  document.querySelector(".vua-page")!.scrollTop = 0;
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
};

function syntheticDiagnosticsSnapshot(): LocalDiagnosticsSnapshotV01 {
  const now = new Date().toISOString();
  return {
    schemaVersion: "vua.local-diagnostics/v0.1",
    capturedAt: now,
    clientRunning: false,
    clientConfig: {
      presence: "found",
      cacheDirectoryCustom: false,
      cacheSizeGb: 30,
      cacheExpiryDelayDays: 30,
      cameraResWidth: null,
      cameraResHeight: null,
      screenshotResWidth: null,
      screenshotResHeight: null,
      fpvSteadycamFov: null,
    },
    clientCache: {
      presence: "found",
      totalBytes: 8 * 1024 * 1024 * 1024,
      truncated: false,
      driveFreeBytes: 120 * 1024 * 1024 * 1024,
      driveTotalBytes: 512 * 1024 * 1024 * 1024,
    },
    osc: {
      avatarCachePresence: "found",
      avatarConfigCount: 4,
      avatarCacheBytes: 16384,
      newestModifiedAt: now,
      udp9000: { state: "bound", ownerPid: 4200, ownerProcess: "VRCFaceTracking.exe" },
      udp9001: { state: "unbound", ownerPid: null, ownerProcess: null },
      oscQuery: { state: "found", httpPort: 54321, advertisedOscPort: 9000, ownerProcess: "VRCFaceTracking.exe" },
    },
    steamvrSettings: {
      presence: "found",
      renderTargetMultiplier: 1.0,
      motionSmoothing: false,
      vrchatResolutionScale: 1.0,
      safeModeEnabled: false,
      blockedDrivers: [],
    },
    audioEndpoints: {
      state: "observed",
      defaultCaptureRole: "physical_or_usb",
      virtualMicHijack: "none",
      communicationsMismatch: false,
    },
    streamingSettings: {
      questLink: { presence: "missing", encodeResolutionWidth: null, encodeBitrateMbps: null, dynamicBitrate: null, linkSharpening: null },
      picoConnect: { presence: "found", preset: "ultra", bitrateMbps: 150 },
    },
    systemTuning: {
      hardwareGpuScheduling: true,
      powerPlanRole: "balanced",
      ovrAdvancedSettingsInstalled: true,
    },
    recentClientLog: {
      classification: "clean_or_inconclusive",
      newestModifiedAt: now,
    },
  };
}

function syntheticSymptomDiagnosis(symptom: SymptomIdV01): SymptomDiagnosisV01 {
  const snapshot = syntheticDiagnosticsSnapshot();
  return {
    schemaVersion: "vua.local-diagnostics/v0.1",
    symptom,
    capturedAt: snapshot.capturedAt,
    snapshot,
    findings: [
      { code: "osc_port_9000_conflict", severity: "attention", layer: "companion_osc" },
      { code: "osc_avatar_cache_present", severity: "info", layer: "client_config_cache" },
    ],
    sopSteps: [
      {
        stepId: "osc_resolve_port_9000_conflict",
        layer: "companion_osc",
        title: "Resolve UDP 9000 conflict",
        instruction: "Ensure only one router binds UDP 9000 before starting VRChat.",
      },
      {
        stepId: "osc_check_avatar_parameters",
        layer: "avatar_sdk",
        title: "Verify avatar parameter sync",
        instruction: "Refresh cached avatar parameter JSON files when parameters change.",
      },
    ],
    suggestedHelper: "clear_osc_avatar_cache",
  };
}

function syntheticPoseGraph(): PoseGraphSnapshotV01 {
  return {
    schemaVersion: "vua.pose-graph/v0.1",
    capturedAt: new Date().toISOString(),
    openxr: { presence: "found", runtimeName: "SteamVR" },
    steamvrDrivers: ["space_calibrator", "slimevr", "mocopi"],
    blockedSteamvrDrivers: ["space_calibrator"],
    fbtDriverConflictRisk: "multiple_openvr_fbt_drivers",
    lastHeadsetHint: "PICO 4 Pro",
    poseSources: POSE_SOURCE_IDS.map(sourceId => ({
      sourceId,
      state: sourceId === "headset_6dof" || sourceId === "slimevr"
        ? "active"
        : sourceId === "mocopi" || sourceId === "space_calibrator"
          ? "installed"
          : "not_detected",
      detailCode: sourceId === "space_calibrator" ? "blocked_by_safe_mode" : null,
    })),
  };
}

window.vua = {
  gateway: { invoke: async (req: { method: string; params?: { intent?: { purposes: string[] }; route?: string; urls?: string[]; path?: string; symptom?: SymptomIdV01 }; }) => {
    let value: unknown;
    if (req.method === "app.snapshot") value = { capabilities: { tasks: true, operations: ["environment.planDeployment", "environment.executeDeployment", "environment.testWebsites", "environment.observePlay", "environment.startPlay", "environment.stopPlay", "environment.inspectManagerApps", "diagnostics.observeLocal", "diagnostics.diagnoseSymptom", "environment.observePoseGraph"].map(operationId => ({ operationId, availability: "available" })) } };
    if (req.method === "diagnostics.observeLocal") value = { localDiagnostics: syntheticDiagnosticsSnapshot() };
    if (req.method === "diagnostics.diagnoseSymptom") value = { symptomDiagnosis: syntheticSymptomDiagnosis(req.params?.symptom ?? "osc_or_face_tracking_not_responding") };
    if (req.method === "environment.observePoseGraph") value = { poseGraph: syntheticPoseGraph() };
    if (req.method === "task.list") value = { revision: 1, tasks: [] };
    if (req.method === "environment.getSnapshot") value = { contractVersion: "0.1", revision: 0, capturedAt: new Date().toISOString(), items: [{ checkId: "unity_editors", zone: "create", presence: "detected", facts: { editors: editorVersions().map(version => ({ version, path: `C:/Synthetic/Unity/${version}`, classification: "other_unity_version" })) } }] };
    if (req.method === "environment.testWebsites") { websiteCalls += 1; value = { websiteTests: req.params!.urls!.map(url => ({ url, status: "reachable", elapsedMs: 8, httpStatus: 200 })) }; }
    if (["environment.observePlay", "environment.startPlay", "environment.stopPlay"].includes(req.method)) {
      if (playUnavailable) return { ok: false, error: { code: "unsupported_method", messageKey: "synthetic" } };
      const route = req.params!.route!;
      if (req.method === "environment.observePlay") playObservationCount += 1;
      if (req.method !== "environment.observePlay") { const stopping = req.method === "environment.stopPlay"; playCalls.push(req.method + ":" + route); playStates[route] = stopping ? "stopping" : "starting"; setTimeout(() => { playStates[route] = stopping ? "idle" : "running"; }, 100); }
      value = syntheticPlay(route);
    }
    if (req.method === "project.environmentManagers") value = { operation: req.method, result: { schemaVersion: "vua.environment-managers-snapshot/v0.1", editors: editorVersions().map(version => ({ version, path: `C:/Synthetic/Unity/${version}`, classification: "other_unity_version" })), vcc: { presence: "found" }, alcom: { presence: "not_found" } } };
    if (req.method === "environment.verifyEditor") value = { verdict: "verified", version: req.params!.path!.split("/").at(-1), exePath: req.params!.path! + "/Editor/Unity.exe", classification: "other_unity_version" };
    if (req.method === "environment.inspectManagerApps") { creatorInventoryReads++; value = { managerApps: { schemaVersion: "vua.manager-apps/v0.1", capturedAt: new Date().toISOString(), apps: ["unity_hub", "vcc", "alcom"].map(component => ({ component, presence: component === "alcom" ? "not_found" : "found", path: component === "alcom" ? null : `C:/Synthetic/${component}.exe` })) } }; }
    if (req.method === "environment.planDeployment") {
      intents.push([...req.params!.intent!.purposes]);
      value = { deploymentPlan: { schemaVersion: "vua.environment-deployment/v0.1", intent: req.params!.intent, digest: "a".repeat(64), prerequisitesReady: scenario === "installed", installer: null,
        steps: ["steam", "vrchat"].map(component => ({ component, action: scenario === "installed" ? "retain" : "manual_install", reason: scenario === "installed" ? "verified" : "missing", location: null, version: null,
          officialUrl: component === "steam" ? "https://store.steampowered.com/about/" : "https://store.steampowered.com/app/438100/" })) } };
    }
    if (req.method === "environment.checkScenarioEnvironment") {
      const intent = req.params!.intent!, ready = scenario === "installed";
      checkIntents.push([...intent.purposes]);
      value = { schemaVersion: "vua.scenario-environment/v0.1", intent, softwareReady: ready, licenseState: "not_checked", performed: "software_check_only",
        nextAction: ready ? "follow_sop" : "plan_installation", installationStarted: false,
        observations: scenarioRequiredComponents(intent.purposes as DeploymentPurpose[]).map(component => ({ component, presence: ready ? "verified" : "missing", location: null, version: null })) };
    }
    if (req.method === "environment.executeDeployment") value = { schemaVersion: "vua.environment-deployment/v0.1", operation: req.method, taskId: "synthetic-deployment", correlationId: "synthetic" };
    if (req.method === "task.get") value = { contractVersion: "0.1", taskId: "synthetic-deployment", correlationId: "synthetic", revision: 1, state: installationRunning ? "running" : "succeeded_with_warnings", recoveryDisposition: "none", cancellationRequested: false, updatedAt: new Date().toISOString(),
      result: scenario === "restored" ? { outcome: "prerequisites_verified" } : { outcome: "manual_required", nextStep: { component: "vrchat", action: "manual_install", officialUrl: "https://store.steampowered.com/app/438100/" } } };
    return value ? { ok: true, value } : { ok: false, error: { code: "unsupported_method", messageKey: "synthetic" } };
  } }, events: { subscribe: () => () => {} },
  window: { showReader: async () => {}, showGameGuide: async () => {}, showOverlay: async () => {},
    showEncyclopedia: async (target: unknown) => { window.dispatchEvent(new CustomEvent("vua:open-encyclopedia", { detail: target })); return { visible: true }; }, encyclopediaTargetEvents: { subscribe: () => () => {} },
    shellCommandEvents: { subscribe: (listener: typeof shellCommand) => { shellCommand = listener; return () => { shellCommand = undefined; }; } } },
  system: {
    readResourceUsage: async () => ({ schemaVersion: 1, ramUsedBytes: 1024, ramTotalBytes: 4096, vramUsedBytes: null, vramTotalBytes: null, sampledAt: new Date().toISOString() }),
    checkUpdate: async () => { updateChecks += 1; return { schemaVersion: 1, state: "up-to-date", currentVersion: "synthetic", latestVersion: "synthetic", releaseUrl: null, checkedAt: new Date().toISOString() }; },
  },
  remoteContent: { openAccountGuideInBrowser: async (id: string) => { guideId = id; }, authProbe: async () => ({ authOk: false, accountName: null }) },
} as unknown as VuaDesktopApiV2;

let autoConfirmFirstRun = true;
async function completeFirstRun(keepGuide = false) {
  await wait(() => document.querySelector("[data-first-use-notice]"));
  if (!autoConfirmFirstRun) return;
  document.querySelector<HTMLButtonElement>('[data-nav-id="first-use-beginner"]')!.click();
  await wait(() => document.querySelector('[data-wizard-step="vrchat"]'));
  document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
  await wait(() => document.querySelector(".vua-home") && !document.querySelector("[data-first-use-notice]") && !document.querySelector(".vua-tour"));
  if (!keepGuide) {
    const guide = document.querySelector('[data-context-guide="home"]');
    if (guide) [...guide.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === strings.contextGuide.dismiss)?.click();
  }
}
async function mount(mode: typeof scenario = "installed", legacyMode = "desktop", theme?: "dark" | "light", inventory: typeof creatorInventory = "all", keepGuide = false) {
  creatorInventory = inventory;
  const previousGoals = localStorage.getItem(storageKeys.goals);
  root?.unmount(); localStorage.clear(); sessionStorage.clear(); location.hash = ""; scenario = mode; playUnavailable = false; installationRunning = false; websiteCalls = 0; borrowedSteam = true; playStates.desktop_play = "idle"; playStates.pico_pcvr = "idle"; playCalls.length = 0;
  intents.length = 0; checkIntents.length = 0;
  localStorage.setItem(storageKeys.locale, currentLocale);
  if (previousGoals !== null) localStorage.setItem(storageKeys.goals, previousGoals);
  if (theme) localStorage.setItem(storageKeys.theme, theme);
  localStorage.setItem(storageKeys.retiredDisplayMode, legacyMode);
  if (mode === "restored") {
    localStorage.setItem(storageKeys.goals, JSON.stringify({ version: 1, onboarding: "completed", goals: ["env"], environments: ["play"] }));
    localStorage.setItem(storageKeys.firstRunJourney, JSON.stringify({ v: 1, step: "prepare", purpose: "desktop_play", connection: null }));
    localStorage.setItem(storageKeys.deploymentReceiptPlay, JSON.stringify({ v: 1, taskId: "synthetic-deployment", startedAt: Date.now() - 60000, intent: { purposes: ["desktop_play"], editorRoot: "C:/Synthetic/Editor" } }));
  }
  root = createRoot(document.getElementById("root")!); root.render(<App />);
  await wait(() => document.querySelector(".vua-shell"));
  await wait(() => !document.querySelector(".vua-boot-splash"));
  if (mode === "restored" || previousGoals !== null) {
    await wait(() => !document.querySelector("[data-first-use-notice]"));
    if (!keepGuide) {
      const guide = document.querySelector('[data-context-guide="home"]');
      if (guide) [...guide.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === strings.contextGuide.dismiss)?.click();
    }
  } else await completeFirstRun(keepGuide);
}
async function mountPreview(inventory: typeof creatorInventory = "all") {
  // Preview states use a completed profile; dedicated first-use checks cover both choices.
  localStorage.setItem(storageKeys.goals, JSON.stringify({ version: 1, onboarding: "completed", goals: [], environments: [] }));
  await mount("installed", "desktop", previewTheme, inventory);
}
async function prepare() {
  await click(copy.launchPage);
  // Remounting the fixture retains the app session's route checks. Refresh after
  // changing synthetic software facts so the next step uses the current scenario.
  await click(flowCopy.refreshDevices);

  await wait(() => document.querySelector('[data-route-stage="prepare"]'));
  // The flow checks the environment by itself; the checklist is the next step.
  await wait(() => ["confirm", "execute", "launch"].includes(flowPhase() ?? ""), "play flow after its own check");
}
const review = {
  async previewFirstUse() {
    localStorage.removeItem(storageKeys.goals);
    autoConfirmFirstRun = false;
    try { await mount("installed", "desktop", previewTheme); }
    finally { autoConfirmFirstRun = true; }
    await settlePage();
  },
  async previewBeginner() {
    await review.previewFirstUse();
    document.querySelector<HTMLButtonElement>('[data-nav-id="first-use-beginner"]')!.click();
    await wait(() => document.querySelector('[data-wizard-step="vrchat"]'));
    await settlePage();
  },
  async updatePrivacy() {
    const original = window.vua!.componentUpdates;
    const requests: string[] = [];
    const port = {
      snapshot: async (component: string) => ({schemaVersion: "0.2", component, available: true, state: "idle", rollbackAvailable: false}),
      check: async (component: string) => { requests.push(component); }, subscribe: () => () => {},
    };
    Object.defineProperty(window.vua, "componentUpdates", {value: port, configurable: true});
    localStorage.removeItem(storageKeys.goals); autoConfirmFirstRun = false;
    try {
      await mount();
      check("first-use includes update privacy information", document.querySelector("[data-first-use-notice] [data-update-privacy]"));
      await new Promise(resolve => setTimeout(resolve, 2800));
      check("no automatic request while the first-use notice is open", requests.length === 0);
      localStorage.setItem("vua-component-update-host-enabled", "off");
      document.querySelector<HTMLButtonElement>('[data-nav-id="first-use-beginner"]')!.click();
      await wait(() => requests.length > 0, "automatic update after first-use acknowledgment");
      check("closing the notice schedules only the separately enabled AMF check", requests.join(",") === "amf");
      return checks.slice(-3);
    } finally {
      autoConfirmFirstRun = true;
      Object.defineProperty(window.vua, "componentUpdates", {value: original, configurable: true});
    }
  },
  async firstUseChoices() {
    localStorage.removeItem(storageKeys.goals);
    autoConfirmFirstRun = false;
    try { await mount(); } finally { autoConfirmFirstRun = true; }
    check("first use has five notice parts including update disclosure, two choices and no language question",
      document.querySelectorAll("[data-first-use-part]").length === 5
      && document.querySelectorAll("[data-first-use-notice] button").length === 2
      && !document.querySelector("[data-first-use-notice] select, [data-first-use-notice] input"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="first-use-beginner"]')!.click();
    await wait(() => document.querySelector('[data-wizard-step="vrchat"]'));
    check("beginner choice starts with VRChat without a feature tour", !document.querySelector(".vua-tour"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="wizard-want"]')!.click();
    await wait(() => document.querySelector('[data-tour-anchor="play-environments"]'));
    check("Want this opens actual play setup without requesting a plan", intents.length === 0);
    await click(copy.help); await click(copy.wizard);
    for (const concept of BEGINNER_CONCEPTS) {
      await wait(() => document.querySelector("[data-wizard-step]")?.getAttribute("data-wizard-step") === concept.id);
      check("one concept per page: " + concept.id, document.querySelectorAll(".vua-beginner-wizard__article").length === 1);
      document.querySelector<HTMLButtonElement>('[data-nav-id="wizard-next"]')!.click();
    }
    await wait(() => document.querySelector(".vua-home"));
    check("reading concepts preserves language and does not fabricate completed setup",
      localStorage.getItem(storageKeys.locale) === currentLocale && intents.length === 0
      && localStorage.getItem(storageKeys.guideReading) === null);
    localStorage.removeItem(storageKeys.goals);
    autoConfirmFirstRun = false;
    try { await mount(); } finally { autoConfirmFirstRun = true; }
    document.querySelector<HTMLButtonElement>('[data-nav-id="first-use-enter"]')!.click();
    await wait(() => document.querySelector(".vua-tour")?.getAttribute("data-tour-step") === "welcome");
    check("Got it starts the light feature tour", !document.querySelector("[data-first-use-notice]"));
    document.querySelector<HTMLButtonElement>(".vua-tour__actions button")!.click();
    await wait(() => !document.querySelector(".vua-tour"));
    check("the first-use tour is skippable and neither choice changes language",
      localStorage.getItem(storageKeys.locale) === currentLocale && JSON.parse(localStorage.getItem(storageKeys.goals)!).onboarding === "completed");
  },
  async run() {
    await review.firstUseChoices();
    await mount("installed", "desktop", undefined, undefined, true);
    check("a new session defaults to Dark with the system set to Light", localStorage.getItem(storageKeys.theme) === "dark" && document.documentElement.dataset.theme === "dark");
    await wait(() => document.querySelector('[data-context-guide="home"]'));
    check("returning from the concept wizard leaves no forced tour or notice", !document.querySelector(".vua-tour") && !document.querySelector("[data-first-use-notice]"));
    check("reading guidance and page introductions request no deployment plan", intents.length === 0);
    check("a page introduction offers one button to close it", [...document.querySelectorAll<HTMLButtonElement>('[data-context-guide="home"] button')].filter(button => button.textContent?.trim() === strings.contextGuide.dismiss).length === 1);
    await click(strings.contextGuide.dismiss);
    check("closing is remembered without a wizard or forced tour", JSON.parse(localStorage.getItem(storageKeys.contextGuide)!).dismissed.home === 1 && !document.querySelector(".vua-tour"));
    await click(copy.help); await click(copy.wizard);
    await wait(() => document.querySelector(".vua-vua-guide"));
    check("the concept wizard shows its three buttons in one row", (() => {
      const row = ["wizard-previous", "wizard-want", "wizard-next"].map(id => document.querySelector<HTMLElement>(`[data-nav-id="${id}"]`)!.getBoundingClientRect());
      return row.every(rect => Math.abs(rect.top - row[0]!.top) < 1 && Math.abs(rect.width - row[0]!.width) < 1);
    })());
    const nextAt = () => document.querySelector<HTMLElement>('[data-nav-id="wizard-next"]')!.getBoundingClientRect().top;
    const before = nextAt();
    document.querySelector<HTMLButtonElement>('[data-nav-id="wizard-next"]')!.click();
    await wait(() => document.querySelector('[data-wizard-step="steam"]'));
    check("the wizard's buttons stay in place from page to page", Math.abs(nextAt() - before) < 1);
    document.querySelector<HTMLButtonElement>('[data-nav-id="wizard-previous"]')!.click();
    await wait(() => document.querySelector('[data-wizard-step="vrchat"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => document.querySelector(".vua-home"));
    const savedGoals = localStorage.getItem(storageKeys.goals);
    const savedTheme = localStorage.getItem(storageKeys.theme);
    root!.unmount(); sessionStorage.clear(); location.hash = "";
    root = createRoot(document.getElementById("root")!); root.render(<App />);
    await wait(() => document.querySelector(".vua-home"));
    check("a new session keeps the introduction closed, the preferences and first-use completion",
      !document.querySelector('[data-context-guide="home"]')
      && localStorage.getItem(storageKeys.goals) === savedGoals && localStorage.getItem(storageKeys.theme) === savedTheme
      && !document.querySelector("[data-first-use-notice]") && !document.querySelector(".vua-tour"));
    await prepare();
    check("Play checks each route independently and plans nothing yet",
      ["desktop_play", "pico_pcvr"].every(route => checkIntents.some(intent => intent.join() === route))
      && checkIntents.every(intent => intent.length === 1) && intents.length === 0);
    await wait(() => document.querySelector('[data-card="route-desktop"]')?.dataset.action === "start");
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    await wait(() => document.querySelector('[data-nav-id="nav-settings-accounts"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="nav-settings-accounts"]')!.click();
    await wait(() => document.querySelector(".vua-account-grid")); await click(copy.linking);
    await click(copy.official); check("registration handoff sends a closed guide ID", guideId === "linking");
    check("settings sidebar contains only settings pages", document.querySelectorAll(".vua-shell__sidebar [data-module='settings']").length === 1 && !document.querySelector(".vua-shell__sidebar [data-module='env'], .vua-shell__sidebar [data-module='production']"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-back"]')!.click();
    await wait(() => document.querySelector('[data-route-stage="prepare"]'));
    check("account return preserves the originating environment workflow", !!document.querySelector('[data-route-stage="prepare"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => document.querySelector(".vua-home"));
    check("home is reachable without completing a global wizard", !document.querySelector("[data-first-use-notice]"));
    check("only the logo is the Home action", document.querySelectorAll('[data-nav-id="logo-home"]').length === 1 && !document.querySelector(".vua-shell__tabs"));
    check("home has no tile subtitles", !document.querySelector(".vua-home .vua-route-tile__description"));
    check("header no longer repeats the page title beside the logo", !document.querySelector(".vua-shell__location strong"));
    const headerLabels = [...document.querySelectorAll(".vua-shell__header button")].map(el => el.textContent?.trim());
    check("header has no Tasks, theme or search button", [copy.tasks, strings.settings.theme.dark, strings.settings.theme.light, strings.commandPalette.cta].every(label => !headerLabels.some(text => text?.includes(label))));
    await wait(() => document.querySelector(".vua-shell__notify"));
    check("ready task capability retains the bell without mounting a bottom taskbar", !!document.querySelector(".vua-shell__notify") && !document.querySelector(".vua-shell__taskbar"));
    await mount("installed", "desktop");
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => !document.querySelector("[data-first-use-notice]"));
    check("AMF remains inactive until explicit enablement", !document.querySelector('[data-nav-id="nav-warehouse"]') && !!document.querySelector('[data-nav-id="nav-enable-amf"]'));
    check("Unity setup stays reachable without AMF, under Avatar editing", !!document.querySelector('.vua-shell__sidebar [data-module="production"] [data-nav-id="nav-env-create"]'));
    check("bottom-left duplicate settings and help entries are gone", !document.querySelector(".vua-shell__sidebar-global") && !document.querySelector('.vua-shell__sidebar [data-nav-id="nav-settings-theme"]'));
    check("desktop sidebar is narrower and retains frosted glass", document.querySelector(".vua-shell__sidebar")!.getBoundingClientRect().width === 176 && getComputedStyle(document.querySelector(".vua-shell__sidebar")!).backdropFilter.includes("blur"));
    check("feature search has no sidebar button outside Settings", !document.querySelector('[data-nav-id="settings-search"]'));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelector(".vua-palette"));
    check("Ctrl+P still opens feature search outside Settings", !!document.querySelector(".vua-palette"));
    document.querySelector<HTMLInputElement>(".vua-palette__input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await wait(() => !document.querySelector(".vua-palette"));
    await click(copy.launchPage);
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
    check("appearance has ordered connected Dark / Light / System choices", [...document.querySelectorAll(".vua-theme-choice__button")].map(el => el.getAttribute("data-nav-id")).join() === "theme-dark,theme-light,theme-system,theme-hc-auto,theme-hc-on");
    await review.setThemePreference("light");
    check("Light applies immediately and only its appearance button is selected", document.documentElement.dataset.theme === "light" && document.querySelectorAll('.vua-theme-choice:not(.vua-theme-choice--pair) [aria-pressed="true"]').length === 1 && document.querySelector('[data-nav-id="theme-light"][aria-pressed="true"]'));
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
    await mount("missing"); await prepare(); await advance("confirm"); await wait(() => flowPhase() === "execute");
    check("missing software cannot continue", document.querySelector('[data-card="route-desktop"]')?.dataset.action !== "start");
    await advance("execute"); await wait(() => flowPhase() === "handoff", "official handoff after the run");
    check("manual handoff cannot imply ready", document.querySelector('[data-card="route-desktop"]')?.dataset.action !== "start");
    scenario = "installed"; await click(flowCopy.refreshDevices);
    await wait(() => document.querySelector('[data-card="route-desktop"]')?.dataset.action === "start");
    check("fresh detection enables continuation", document.querySelector('[data-card="route-desktop"]')?.dataset.action === "start");
    const observationsBeforeRestore = playObservationCount;
    await mount("restored"); await click(copy.launchPage);
    await wait(() => playObservationCount > observationsBeforeRestore && document.querySelector('[data-card="route-desktop"]')?.dataset.action === "start", "fresh observation after restoring a receipt");
    check("an old terminal receipt cannot replace fresh observation or launch software", playObservationCount > observationsBeforeRestore
      && document.querySelector('[data-card="route-desktop"]')?.dataset.action === "start" && playCalls.length === 0);
    scenario = "installed"; await click(flowCopy.refreshDevices);
    await wait(() => document.querySelector('[data-card="route-desktop"]')?.dataset.action === "start");
    check("restored work remains usable after an explicit environment review", document.querySelector('[data-card="route-desktop"]')?.dataset.action === "start" && playCalls.length === 0);
    await mount("installed", "bigscreen");
    await wait(() => document.querySelector(".vua-home"));
    check("a saved big-screen preference is cleared and retains the ordinary Home directory", localStorage.getItem(storageKeys.retiredDisplayMode) === null && !document.querySelector('.vua-shell[data-display-mode]'));
    await click(copy.help); document.querySelector<HTMLButtonElement>('[data-nav-id="help-tour"]')!.click();
    for (let index = 0; index < TOUR_STEPS.findIndex(step => step.id === "tasks"); index += 1) {
      await wait(() => document.querySelector('.vua-tour .vua-button--primary'));
      document.querySelector<HTMLButtonElement>('.vua-tour .vua-button--primary')!.click();
      await wait(() => JSON.parse(localStorage.getItem(storageKeys.tourProgress)!).step === index + 1);
    }
    await wait(() => document.querySelector('[data-nav-id="shell-notifications"]') && document.querySelector(".vua-tour__highlight") && document.querySelector(".vua-tour")?.textContent?.includes(strings.tour.steps.tasks.body), "notification tour page and highlight");
    const taskTile = document.querySelector('[data-nav-id="shell-notifications"]')!.getBoundingClientRect();
    const taskHighlight = document.querySelector(".vua-tour__highlight")!.getBoundingClientRect();
    check("explicit task-tour step highlights the notification entry", document.querySelector(".vua-tour")?.textContent?.includes(strings.tour.steps.tasks.body) && Math.abs((taskTile.x + taskTile.width / 2) - (taskHighlight.x + taskHighlight.width / 2)) < 1 && Math.abs((taskTile.y + taskTile.height / 2) - (taskHighlight.y + taskHighlight.height / 2)) < 1);
    await mount();
    return checks;
  },
  async runEnvironmentCards() {
    const startAt = checks.length;
    await mount("installed", "desktop");  document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click(); await wait(() => !document.querySelector("[data-first-use-notice]"));
    check("Software & connections is absent from the fixed directory", !document.querySelector('[data-nav-id="nav-software"]') && !document.querySelector('[data-nav-id="home-software"]'));
    await click(copy.launchPage); const card = () => document.querySelector<HTMLElement>('[data-card="route-desktop"]')!;
    await wait(() => card()?.dataset.action === "start", "desktop card ready to start");
    const halves = card().querySelectorAll<HTMLButtonElement>(":scope > button");
    const separatorWidth = parseFloat(getComputedStyle(halves[1]!).borderLeftWidth);
    check("play card has two independent halves and a thin separator", halves.length === 2 && !halves[0]!.disabled && separatorWidth > 0 && separatorWidth <= 1);
    check("latency lives in the top bar instead of the Play page", !document.querySelector(".vua-play-page .vua-network") && !!document.querySelector('[data-nav-id="shell-network"]'));
    check("entering Play makes no website test requests", websiteCalls === 0);
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-network"]')!.click();
    await wait(() => document.querySelector(".vua-network-panel") && !document.querySelector<HTMLButtonElement>('[data-nav-id="network-test"]')!.disabled);
    const network = document.querySelector<HTMLElement>(".vua-network-panel")!;
    check("opening latency tests the regions, keeping both US coasts", network.textContent?.includes(strings.websiteTests.regionTitle) && [strings.websiteTests.regionCities.eu, strings.websiteTests.regionCities.usw, strings.websiteTests.regionCities.use].every(city => network.textContent?.includes(city)));
    document.querySelector<HTMLElement>(".vua-network-panel__sites")!.setAttribute("open", "");
    const beforeSites = websiteCalls;
    document.querySelector<HTMLButtonElement>(`.vua-network [aria-label="${strings.websiteTests.testAll}"]`)!.click(); await wait(() => websiteCalls > beforeSites && document.querySelector(".vua-network")!.textContent?.includes("ms"));
    check("website tests sit one level down, separate from the regional reading", websiteCalls > beforeSites);
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-network"]')!.click();
    check("the choices stay open until the player has chosen", !!document.querySelector('[data-route-stage="prepare"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop"]')!.click(); await wait(() => document.querySelector('[data-route-stage="pick"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop"]')!.click(); await wait(() => document.querySelector('[data-route-stage="prepare"]'));
    check("left half opens details without launching software", playCalls.length === 0 && softwareChips().length === 2 && document.querySelector<HTMLElement>(".vua-play-drawer")?.dataset.open === "true");
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop-action"]')!.click(); await wait(() => card().dataset.action === "stop");
    check("pending start offers scoped close rather than a second start", card().querySelector(".vua-environment-card__action")!.getAttribute("aria-label") === format(strings.environmentCards.stop, { name: card().querySelector(".vua-environment-card__details strong")!.textContent ?? "" }));
    await wait(() => card().textContent?.includes(strings.environmentCards.close));
    check("observed running software identifies pre-existing Steam as retained", softwareChips()[0]?.title === strings.environmentCards.borrowed);
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop-action"]')!.click(); await wait(() => card().dataset.action === "start", "close returns the card to start");
    check("close returns the environment to play after observation", playCalls.join() === "environment.startPlay:desktop_play,environment.stopPlay:desktop_play");
    borrowedSteam = false;
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop-action"]')!.click(); await wait(() => playStates.desktop_play === "running", "owned session running");
    playStates.desktop_play = "finished";
    await click(flowCopy.refreshDevices);
    await wait(() => card().textContent?.includes(strings.environmentCards.close) && softwareChips()[0]?.title === strings.environmentCards.owned
      && !softwareChips()[1]?.title, "finished session observed with only owned Steam still running");
    check("normal game exit keeps Close for owned Steam without a warning or failure", card().dataset.action === "stop" && card().textContent?.includes(strings.environmentCards.close) && !card().querySelector(".vua-environment-card__warning") && !document.querySelector(".vua-play-page [role=alert]"));
    playStates.desktop_play = "idle";
    await click(flowCopy.refreshDevices); await wait(() => card().dataset.action === "start", "all owned software exited");
    check("exit of all owned software restores Play without an extra close request", playCalls.filter(call => call.startsWith("environment.stopPlay:")).length === 1);
    check("Quest, Vive and Index are devices to choose beside PC mode and PICO", ["pc", "pico", "quest", "vive-standalone", "vive-wired", "index"].every(id => !!document.querySelector(`[data-nav-id="play-device-${id}"]`)));
    playUnavailable = true; await click(flowCopy.refreshDevices); await wait(() => card().dataset.action === "unknown", "provider failure shown as unknown");
    check("provider failure is unknown instead of missing or ready", card().textContent?.includes(flowCopy.phases.unavailable));
    await click(unitySetup); await wait(() => document.querySelector('[data-nav-id="editor-2019.4.31f1"]'));
    check("creator lists complete discovered versions beside the fixed Unity entries", document.querySelector('[data-nav-id="route-unity2022"]') && document.querySelector('[data-nav-id="editor-2021.3.45f1"]') && document.querySelector('[data-nav-id="route-unity6"] .vua-route-tile__tag')?.textContent === copy.developing);
    check("Hub, VCC and ALCOM have separate detected statuses", ["unity_hub", "vcc", "alcom"].every(id => document.querySelector(`[data-manager="${id}"] [role="status"]`)) && document.querySelector('[data-manager="alcom"]')!.textContent?.includes(strings.environmentCards.notFound));
    document.querySelector<HTMLButtonElement>('[data-nav-id="manager-vcc"]')!.click(); await wait(() => document.querySelector<HTMLElement>("#manager-vcc-details")!.dataset.open === "true");
    check("manager configuration is shown separately from executable detection", document.querySelector("#manager-vcc-details")!.textContent?.includes(strings.environmentCards.configFound));
    document.querySelector<HTMLButtonElement>('[data-nav-id="manager-vcc"]')!.click();
    for (const control of document.querySelectorAll<HTMLButtonElement>('.vua-creator-page .vua-card-entry [aria-controls]')) {
      control.click();
      await wait(() => control.getAttribute('aria-expanded') === 'true');
      await wait(() => detailsBelowCard(control), `${control.dataset.navId} drawer reaches its expanded position`);
      check(`${control.dataset.navId} opens details immediately below its own card`, detailsBelowCard(control));
      control.click();
      await wait(() => control.getAttribute('aria-expanded') === 'false');
    }
    await mount("missing", "desktop");  document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click(); await wait(() => !document.querySelector("[data-first-use-notice]")); await click(copy.launchPage);
    await click(flowCopy.refreshDevices);
    await wait(() => card()?.dataset.action === "prepare");
    await wait(() => flowPhase() === "confirm", "plus shows the checked flow");
    check("plus checks software without planning, installing or launching", playCalls.length === 0 && intents.length === 0);
    await advance("confirm"); await wait(() => flowPhase() === "execute", "the run follows the confirmed checklist");
    check("the installation waits for an explicit run without launching software", playCalls.length === 0 && intents.length === 0);
    installationRunning = true; await advance("execute"); await wait(() => card().dataset.action === "busy");
    check("accepted installation shows a spinner and cannot launch", card().querySelector(".vua-environment-card__spin") && card().textContent?.includes(flowCopy.phases.running) && flowButton()!.disabled && flowPhase() === "running");
    check("details remain available while installation is running", !card().querySelector<HTMLButtonElement>(".vua-environment-card__details")!.disabled);
    const panel = document.querySelector('#route-desktop-details .vua-play-flow');
    const receipt = localStorage.getItem(`${storageKeys.deploymentReceiptPlay}.desktop_play`);
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop"]')!.click();
    await wait(() => document.querySelector<HTMLElement>('.vua-play-drawer')!.dataset.open === 'false');
    document.querySelector<HTMLButtonElement>('[data-nav-id="route-desktop"]')!.click();
    await wait(() => document.querySelector<HTMLElement>('.vua-play-drawer')!.dataset.open === 'true');
    document.querySelector<HTMLButtonElement>('[data-nav-id="play-device-pico"]')!.click();
    await wait(() => !document.querySelector<HTMLElement>('#route-pico-details')!.hidden);
    document.querySelector<HTMLButtonElement>('[data-nav-id="play-device-pc"]')!.click();
    await wait(() => !document.querySelector<HTMLElement>('#route-desktop-details')!.hidden);
    check("closing and switching card details retains the live installation flow and receipt", panel === document.querySelector('#route-desktop-details .vua-play-flow') && receipt !== null && receipt === localStorage.getItem(`${storageKeys.deploymentReceiptPlay}.desktop_play`) && card().dataset.action === 'busy');
    return checks.slice(startAt);
  },
  async creatorSession() {
    const start = checks.length;
    await mountPreview(); await click(unitySetup);
    const refresh = () => document.querySelector<HTMLButtonElement>('[data-nav-id="creator-refresh-environment"]')!;
    await wait(() => !!refresh() && !refresh().disabled);
    const scanned = creatorInventoryReads;
    await click(copy.launchPage); await wait(() => document.querySelector(".vua-play-page"));
    await click(unitySetup); await wait(() => document.querySelector(".vua-creator-page"));
    check("returning to Creator immediately restores the checked inventory", !refresh().disabled && !refresh().textContent?.includes(strings.environmentCards.checking));
    await new Promise(resolve => setTimeout(resolve, 100));
    check("returning to Creator starts no new scan", creatorInventoryReads === scanned);
    refresh().click(); await wait(() => creatorInventoryReads === scanned + 1 && !refresh().disabled);
    check("Creator's explicit refresh still runs a new scan", creatorInventoryReads === scanned + 1);
    return checks.slice(start);
  },
  async previewEnvironment(page: "play" | "create", inventory: typeof creatorInventory = "all") {
    await mountPreview(inventory);  document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click(); await wait(() => !document.querySelector("[data-first-use-notice]"));
    await click(page === "play" ? copy.launchPage : unitySetup);
    await wait(() => page === "play" ? document.querySelector<HTMLElement>('[data-card="route-desktop"]')?.dataset.action === "start" : document.querySelector('[data-editor-status]')?.textContent?.includes("2022.3.22f1"));
    await settlePage();
  },
  async previewSettings() {
    await mountPreview();
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => !document.querySelector("[data-first-use-notice]"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    await wait(() => location.hash === "#settings-theme" && document.querySelector(".vua-theme-choice"));
    await settlePage();
    check("settings capture owns the settings-theme route and actual appearance controls",
      location.hash === "#settings-theme" && document.querySelectorAll(".vua-theme-choice").length === 2
      && document.querySelectorAll(".vua-theme-choice__button").length === 5
      && !document.querySelector("[data-first-use-notice]"));
    check("settings capture preserves its requested appearance preference",
      document.documentElement.dataset.theme === previewTheme
      && document.querySelector(`[data-nav-id="theme-${previewTheme}"][aria-pressed="true"]`));
    check("theme settings groups family, appearance, contrast and resource preferences",
      document.querySelectorAll(".vua-settings-group .vua-preference-row").length === 4
      && document.querySelectorAll(".vua-theme-family__option").length === 4
      && document.querySelectorAll('.vua-settings-group [role="switch"]').length === 1
      && !document.querySelector(".vua-settings-group .vua-button--primary"));
    const previews = [...document.querySelectorAll<HTMLImageElement>(".vua-theme-family__preview .vua-skin-motif")];
    await wait(() => previews.every(image => image.complete && image.naturalWidth > 0), "skin preview assets");
    check("each non-Grid preset renders its own motif and Grid keeps its color swatches",
      previews.length === 3 && previews.every(image => image.complete && image.naturalWidth > 0)
      && new Set(previews.map(image => image.dataset.motifFamily)).size === 3
      && document.querySelectorAll('.vua-theme-family__preview[data-theme-family="grid"] > span').length === 3);
    const initialFamily = document.documentElement.dataset.themeFamily === "frutiger-aero" ? "frutiger-aero" : "grid";
    const nextFamily = initialFamily === "grid" ? "frutiger-aero" : "grid";
    const initialMode = document.documentElement.dataset.theme;
    const storedFamily = localStorage.getItem(storageKeys.themeFamily);
    const storedMode = localStorage.getItem(storageKeys.theme);
    const familyOverride = new URLSearchParams(location.search).has("themeFamily");
    document.querySelector<HTMLButtonElement>(`[data-nav-id="theme-family-${nextFamily}"]`)!.click();
    await wait(() => document.documentElement.dataset.themeFamily === nextFamily
      && document.querySelector(`[data-nav-id="theme-family-${nextFamily}"][aria-pressed="true"]`));
    const storedFamilyMatches = familyOverride
      ? localStorage.getItem(storageKeys.themeFamily) === storedFamily
      : localStorage.getItem(storageKeys.themeFamily) === nextFamily;
    check("theme family switches independently and preserves preview and storage semantics",
      storedFamilyMatches && document.documentElement.dataset.theme === initialMode);
    document.querySelector<HTMLButtonElement>(`[data-nav-id="theme-family-${initialFamily}"]`)!.click();
    await wait(() => document.documentElement.dataset.themeFamily === initialFamily
      && document.querySelector(`[data-nav-id="theme-family-${initialFamily}"][aria-pressed="true"]`));
    for (const [family, expectedMode] of [["tenshi", "light"], ["jirai", "dark"]] as const) {
      document.querySelector<HTMLButtonElement>(`[data-nav-id="theme-family-${family}"]`)!.click();
      await wait(() => document.documentElement.dataset.themeFamily === family
        && document.documentElement.dataset.theme === expectedMode
        && document.querySelector(`[data-nav-id="theme-${expectedMode}"][aria-pressed="true"]`)
        && localStorage.getItem(storageKeys.theme) === (familyOverride ? storedMode : expectedMode)
        && localStorage.getItem(storageKeys.themeFamily) === (familyOverride ? storedFamily : family),
        `${family} appearance and storage`);
      check(`${family} locks its supported appearance without changing unrelated preferences`,
        (["dark", "light", "system"] as const).every(mode => document.querySelector<HTMLButtonElement>(`[data-nav-id="theme-${mode}"]`)!.disabled)
        && document.querySelector(".vua-theme-choice")?.getAttribute("aria-disabled") === "true"
        && localStorage.getItem(storageKeys.theme) === (familyOverride ? storedMode : expectedMode)
        && localStorage.getItem(storageKeys.themeFamily) === (familyOverride ? storedFamily : family));
      await wait(() => {
        const motif = document.querySelector<HTMLImageElement>(".vua-shell__skin-motif");
        return motif?.dataset.motifFamily === family && motif.complete && motif.naturalWidth > 0;
      }, `${family} shell motif`);
    }
    document.querySelector<HTMLButtonElement>(`[data-nav-id="theme-family-${initialFamily}"]`)!.click();
    await wait(() => document.documentElement.dataset.themeFamily === initialFamily
      && [...document.querySelectorAll<HTMLButtonElement>(".vua-theme-choice__button")].every(button => !button.disabled));
    if (initialMode === "light" || initialMode === "dark") await review.setThemePreference(initialMode);
    await wait(() => {
      const motif = document.querySelector<HTMLImageElement>(".vua-shell__skin-motif");
      return initialFamily === "grid" ? motif === null
        : motif?.dataset.motifFamily === initialFamily && motif.complete && motif.naturalWidth > 0;
    }, "restored shell motif");
    const toggle = document.querySelector<HTMLButtonElement>('.vua-settings-group [role="switch"]')!;
    const activeMotif = document.querySelector<HTMLImageElement>(".vua-shell__skin-motif");
    const previous = toggle.getAttribute("aria-checked");
    toggle.click();
    await wait(() => toggle.getAttribute("aria-checked") !== previous);
    check("resource-saving removes skin motifs and decorative canvas textures",
      (!activeMotif || getComputedStyle(activeMotif).display === "none")
      && !getComputedStyle(document.body).backgroundImage.includes("url(")
      && !getComputedStyle(document.body).backgroundImage.includes("gradient"));
    toggle.click();
    await wait(() => toggle.getAttribute("aria-checked") === previous);
    document.querySelector<HTMLButtonElement>('[data-nav-id="theme-hc-on"]')!.click();
    await wait(() => document.documentElement.dataset.hc === "on");
    check("high contrast removes skin motifs and decorative canvas textures",
      (!activeMotif || getComputedStyle(activeMotif).display === "none")
      && !getComputedStyle(document.body).backgroundImage.includes("url(")
      && !getComputedStyle(document.body).backgroundImage.includes("gradient"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="theme-hc-auto"]')!.click();
    await wait(() => !document.documentElement.dataset.hc);
    await settlePage();
  },
  async previewTools() {
    await mountPreview();
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => !document.querySelector("[data-first-use-notice]"));
    await click(copy.tools);
    await wait(() => document.querySelector(".vua-tools-hub") && document.querySelector("[data-pose-graph] .vua-pose-graph__body"));
    await settlePage();
  },
  async previewDiagnostics() {
    await mountPreview();
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => !document.querySelector("[data-first-use-notice]"));
    window.location.hash = "#help?sub=diagnostics";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await wait(() => document.querySelector("[data-local-diagnostics] [data-symptom-diagnosis]"), "local diagnostics panel");
    await settlePage();
  },
  async previewCommandPalette() {
    await mountPreview();
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => !document.querySelector("[data-first-use-notice]"));
    await settlePage();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, bubbles: true }));
    await wait(() => document.querySelector(".vua-palette") && document.querySelectorAll(".vua-palette__option").length > 0, "command palette open");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  },
  settlePage,
  async beforeKey(key: string) {
    if (key === "Enter") {
      autoConfirmFirstRun = false;
      localStorage.removeItem(storageKeys.goals);
      await mount();
      autoConfirmFirstRun = true;
      await wait(() => document.querySelector('[data-nav-id="first-use-enter"]'), "first-use Got it for native Enter");
      sessionStorage.setItem("vua-test-native-first-run-enter", "pending");
      document.querySelector<HTMLButtonElement>('[data-nav-id="first-use-enter"]')!.focus();
    }
  },
  async afterKey(key: string) {
    if (key === "Enter") {
      await wait(() => document.querySelector(".vua-tour")?.getAttribute("data-tour-step") === "welcome");
      check("native Enter acknowledges the notice and starts only the welcome step",
        sessionStorage.getItem("vua-test-native-first-run-enter") === "pending"
        && JSON.parse(localStorage.getItem(storageKeys.goals) ?? "null")?.onboarding === "completed"
        && !document.querySelector("[data-first-use-notice]"));
      document.querySelector<HTMLButtonElement>(".vua-tour__actions button")!.click();
      await mount();
      check("a returning completed profile does not repeat the first-use tour",
        !!document.querySelector(".vua-home") && !document.querySelector(".vua-tour"));
    } else await wait(() => !document.querySelector(".vua-shell[data-display-mode]"));
    return "Chromium " + key + ": " + (key === "Enter" ? "Got it starts the tour welcome" : "no retired directional shell navigation");
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
    const toggle = document.querySelector<HTMLButtonElement>('.vua-preference-row [role="switch"]');
    if (!toggle) throw new Error("Resource-saving preference switch is missing");
    if ((toggle.getAttribute("aria-checked") === "true") !== enabled) toggle.click();
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

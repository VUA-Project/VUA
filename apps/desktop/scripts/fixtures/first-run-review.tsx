import { createRoot, type Root } from "react-dom/client";
import type { DesktopShellCommandV1, VuaDesktopApiV1 } from "@vua/contracts";
import { App } from "../../src/renderer/App.tsx";
import { strings } from "../../src/renderer/i18n/index.ts";
import { storageKeys } from "../../src/renderer/app/storage-keys.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";

const copy = strings.journey;
let root: Root | undefined;
let scenario: "installed" | "missing" | "restored" = "installed";
let guideId: string | null = null;
const intents: string[][] = [];
const checks: string[] = [];
let escapes = 0;
let shellCommand: ((command: DesktopShellCommandV1) => void) | undefined;
let updateChecks = 0;
const check = (name: string, value: unknown) => { if (!value) throw new Error(name); checks.push(name); };
const wait = async (predicate: () => unknown, label = "") => {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > 10000) throw new Error(`UI condition timed out: ${label}; wizard=${document.querySelector("[data-wizard-step]")?.getAttribute("data-wizard-step")}`); await new Promise(r => setTimeout(r, 25)); }
};
const visible = (el: Element) => el.getClientRects().length > 0 && !el.closest("[hidden]");
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(el => visible(el) && (el.textContent?.trim() === label || el.querySelector("strong")?.textContent === label));
const click = async (label: string) => { await wait(() => button(label) && !button(label)!.disabled, `button ${label}`); button(label)!.focus(); button(label)!.click(); };
const step = (value: string) => wait(() => document.querySelector(`[data-wizard-step="${value}"]`), `step ${value}`);

window.vua = {
  gateway: { invoke: async (req: { method: string; params?: { intent?: { purposes: string[] } }; }) => {
    let value: unknown;
    if (req.method === "app.snapshot") value = { capabilities: { tasks: false, operations: ["environment.planDeployment", "environment.executeDeployment"].map(operationId => ({ operationId, availability: "available" })) } };
    if (req.method === "task.list") value = { revision: 1, tasks: [] };
    if (req.method === "environment.getSnapshot") value = { capturedAt: new Date().toISOString(), items: [] };
    if (req.method === "environment.planDeployment") {
      intents.push([...req.params!.intent!.purposes]);
      value = { deploymentPlan: { schemaVersion: "vua.environment-deployment/v0.1", intent: req.params!.intent, digest: "a".repeat(64), prerequisitesReady: scenario === "installed", installer: null,
        steps: ["steam", "vrchat"].map(component => ({ component, action: scenario === "installed" ? "retain" : "manual_install", reason: scenario === "installed" ? "verified" : "missing", location: null, version: null,
          officialUrl: component === "steam" ? "https://store.steampowered.com/about/" : "https://store.steampowered.com/app/438100/" })) } };
    }
    if (req.method === "environment.executeDeployment") value = { schemaVersion: "vua.environment-deployment/v0.1", operation: req.method, taskId: "synthetic-deployment", correlationId: "synthetic" };
    if (req.method === "task.get") value = { contractVersion: "0.1", taskId: "synthetic-deployment", correlationId: "synthetic", revision: 1, state: "succeeded_with_warnings", recoveryDisposition: "none", cancellationRequested: false, updatedAt: new Date().toISOString(),
      result: scenario === "restored" ? { outcome: "prerequisites_verified" } : { outcome: "manual_required", nextStep: { component: "vrchat", action: "manual_install", officialUrl: "https://store.steampowered.com/app/438100/" } } };
    return value ? { ok: true, value } : { ok: false, error: { code: "unsupported_method", messageKey: "synthetic" } };
  } }, events: { subscribe: () => () => {} },
  window: { showReader: async () => {}, showGameGuide: async () => {}, showOverlay: async () => {},
    shellCommandEvents: { subscribe: (listener: typeof shellCommand) => { shellCommand = listener; return () => { shellCommand = undefined; }; } } },
  system: {
    readResourceUsage: async () => ({ schemaVersion: 1, ramUsedBytes: 1024, ramTotalBytes: 4096, vramUsedBytes: null, vramTotalBytes: null, sampledAt: new Date().toISOString() }),
    checkUpdate: async () => { updateChecks += 1; return { schemaVersion: 1, state: "up-to-date", currentVersion: "synthetic", latestVersion: "synthetic", releaseUrl: null, checkedAt: new Date().toISOString() }; },
  },
  remoteContent: { openAccountGuideInBrowser: async (id: string) => { guideId = id; }, authProbe: async () => ({ authOk: false, accountName: null }) },
} as unknown as VuaDesktopApiV1;

async function mount(mode: typeof scenario = "installed", displayMode = "bigscreen") {
  root?.unmount(); localStorage.clear(); location.hash = ""; scenario = mode;
  localStorage.setItem(storageKeys.locale, "en"); localStorage.setItem(storageKeys.theme, "dark");
  localStorage.setItem(storageKeys.displayMode, displayMode);
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
    check("settings sidebar contains only settings pages, also in big screen mode", document.querySelectorAll(".vua-shell__sidebar [data-module='settings']").length === 1 && !document.querySelector(".vua-shell__sidebar [data-module='env'], .vua-shell__sidebar [data-module='production']"));
    document.querySelector<HTMLButtonElement>(".vua-journey-actions [data-back]")!.click();
    await wait(() => document.querySelector(".vua-account-grid") && visible(document.querySelector(".vua-account-grid")!));
    check("account guide has its own one-level Back", !!document.querySelector(".vua-account-grid"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-back"]')!.click(); await step("launch");
    check("account return retains the launch step", !!document.querySelector('[data-wizard-step="launch"]'));
    await wait(() => document.activeElement?.getAttribute("data-nav-id") === "play-accounts");
    check("account return restores the originating control", document.activeElement?.getAttribute("data-nav-id") === "play-accounts");
    await click(copy.finish); await wait(() => document.querySelector(".vua-home"));
    check("finishing the wizard returns to the fixed Home", !document.querySelector("[data-wizard-step]"));
    check("only the logo is the Home action", document.querySelectorAll('[data-nav-id="logo-home"]').length === 1 && !document.querySelector(".vua-shell__tabs"));
    check("home has no tile subtitles", !document.querySelector(".vua-home .vua-route-tile__description"));
    check("header no longer repeats the page title beside the logo", !document.querySelector(".vua-shell__location strong"));
    await mount("installed", "desktop"); await step("goal");
    document.querySelector<HTMLButtonElement>('[data-nav-id="logo-home"]')!.click();
    await wait(() => !document.querySelector("[data-wizard-step]"));
    check("Inspection belongs to the Avatar sidebar group", !!document.querySelector('[data-module="production"] [data-nav-id="nav-inspection"]'));
    check("bottom-left duplicate settings and help entries are gone", !document.querySelector(".vua-shell__sidebar-global") && !document.querySelector('.vua-shell__sidebar [data-nav-id="nav-settings-theme"]'));
    await click(copy.play); await click(copy.desktop);
    await wait(() => document.querySelector('[data-route-stage="prepare"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    await wait(() => document.querySelector('[data-nav-id="nav-settings-accounts"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="nav-settings-accounts"]')!.click();
    await wait(() => document.querySelector(".vua-account-grid"));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    await wait(() => document.querySelector('[data-route-stage="prepare"]') && visible(document.querySelector('[data-route-stage="prepare"]')!));
    check("clicking Settings again returns to the source workflow without resetting its step", !!document.querySelector('[data-route-stage="prepare"]'));
    localStorage.setItem(storageKeys.updateCheckEnabled, "off");
    const beforeChecks = updateChecks;
    shellCommand!("check-updates");
    await wait(() => document.querySelector('[data-nav-id="nav-settings-version"][aria-current="page"]') && updateChecks > beforeChecks);
    check("tray update gesture opens Version and checks even when automatic checks are disabled", updateChecks > beforeChecks);
    shellCommand!("bigscreen");
    await wait(() => document.querySelector('.vua-shell[data-display-mode="bigscreen"]'));
    check("tray big screen gesture switches the existing shell", !!document.querySelector('.vua-shell[data-display-mode="bigscreen"]'));
    document.querySelector<HTMLButtonElement>('[data-nav-id="shell-back"]')!.click();
    await wait(() => !document.querySelector('[data-nav-id="nav-settings-version"]'));
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
    await mount(); await step("goal");
    await wait(() => document.activeElement?.getAttribute("data-nav-id")?.startsWith("wizard-play-mode"));
    return checks;
  },
  async beforeKey(key: string) {
    if (key === "ArrowRight") {
      if (button(copy.exit)) await click(copy.exit);
      await wait(() => document.querySelector('[data-nav-id="home-environment"]'));
      document.querySelector<HTMLButtonElement>('[data-nav-id="home-environment"]')!.focus();
    }
  },
  async afterKey(key: string) {
    if (key === "Enter") await step("play-mode");
    if (key === "Escape") {
      escapes += 1;
      if (escapes === 1) await step("goal");
      else await wait(() => document.querySelector(".vua-home") && !document.querySelector("[data-wizard-step]"));
    }
    if (key === "ArrowRight") await wait(() => document.activeElement?.getAttribute("data-nav-id") === "home-avatar");
    return `Chromium ${key}: ${key === "Enter" ? "direct branch" : key === "Escape" ? escapes === 1 ? "one level back" : "first level returns Home" : "next domain"}`;
  },
  async setThemePreference(theme: "light" | "dark" | "system") {
    if (!document.querySelector('[data-nav-id="nav-settings-theme"]')) {
      document.querySelector<HTMLButtonElement>('[data-nav-id="shell-settings"]')!.click();
    } else if (!document.querySelector('[data-nav-id="nav-settings-theme"][aria-current="page"]')) {
      document.querySelector<HTMLButtonElement>('[data-nav-id="nav-settings-theme"]')!.click();
    }
    await wait(() => [...document.querySelectorAll<HTMLSelectElement>("select")].some(el => visible(el) && el.getAttribute("aria-label") === strings.settings.theme.appearanceAria));
    const select = [...document.querySelectorAll<HTMLSelectElement>("select")].find(el => visible(el) && el.getAttribute("aria-label") === strings.settings.theme.appearanceAria)!;
    select.value = theme; select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(() => localStorage.getItem(storageKeys.theme) === theme);
  },
};
(window as unknown as { firstRunReview: typeof review }).firstRunReview = review;

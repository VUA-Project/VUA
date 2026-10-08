import { createRoot, type Root } from "react-dom/client";
import type { VuaDesktopApiV1 } from "@vua/contracts";
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
  window: { showReader: async () => {}, showGameGuide: async () => {}, showOverlay: async () => {} },
  remoteContent: { openAccountGuideInBrowser: async (id: string) => { guideId = id; }, authProbe: async () => ({ authOk: false, accountName: null }) },
} as unknown as VuaDesktopApiV1;

async function mount(mode: typeof scenario = "installed") {
  root?.unmount(); localStorage.clear(); location.hash = ""; scenario = mode;
  localStorage.setItem(storageKeys.locale, "en"); localStorage.setItem(storageKeys.theme, "dark");
  localStorage.setItem(storageKeys.displayMode, "bigscreen");
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
    await click(copy.restart); await step("goal"); await prepare(); await wait(() => button(copy.preparedNext));
    check("desktop plans only desktop prerequisites", intents.at(-1)?.join() === "desktop_play");
    await click(copy.preparedNext); await step("launch"); await click(copy.accounts);
    await wait(() => document.querySelector(".vua-account-grid")); await click(copy.linking);
    await click(copy.official); check("registration handoff sends a closed guide ID", guideId === "linking");
    document.querySelector<HTMLButtonElement>(".vua-shell__location button")!.click();
    await wait(() => document.querySelector(".vua-account-grid") && visible(document.querySelector(".vua-account-grid")!));
    check("header Back returns from guide to account cards", !!document.querySelector(".vua-account-grid"));
    await click(copy.accountReturn); await step("launch");
    check("account return retains the launch step", !!document.querySelector('[data-wizard-step="launch"]'));
    await wait(() => document.activeElement?.getAttribute("data-nav-id") === "play-accounts");
    check("account return restores the originating control", document.activeElement?.getAttribute("data-nav-id") === "play-accounts");
    await click(copy.finish); await wait(() => document.querySelector(".vua-home"));
    check("finishing the wizard returns to the fixed Home", !document.querySelector("[data-wizard-step]"));
    check("only the logo is the Home action", document.querySelectorAll('[data-nav-id="logo-home"]').length === 1 && !document.querySelector(".vua-shell__tabs"));
    check("home has no tile subtitles", !document.querySelector(".vua-home .vua-route-tile__description"));
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
};
(window as unknown as { firstRunReview: typeof review }).firstRunReview = review;

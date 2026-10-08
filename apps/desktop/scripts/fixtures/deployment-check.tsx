// Controlled renderer observations, outside the product bundle. No installer runs here.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { DeploymentIntent, DeploymentPlan, DeploymentProgress, TaskSnapshotV01 } from "@vua/contracts";
import { GatewayProvider } from "../../src/renderer/gateway/GatewayProvider.tsx";
import { emptyGateway } from "../../src/renderer/gateway/empty-gateway.ts";
import { DeploymentPanel } from "../../src/renderer/features/deployer/DeploymentPanel.tsx";
import { storageKeys } from "../../src/renderer/app/storage-keys.ts";
import { strings } from "../../src/renderer/i18n/index.ts";
import type { GuideTarget } from "../../src/renderer/features/guide/guide-target.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";
import "../../src/renderer/features/deployer/deployer.css";

const base = emptyGateway();
const root = createRoot(document.getElementById("root")!);
const checks: string[] = [];
const openedUrls: string[] = [];
const openedGuides: GuideTarget[] = [];
// Observe navigation requests without opening external pages or an actual guide window.
window.open = url => { openedUrls.push(String(url)); return {} as Window; };
Object.assign(window, { vua: { window: { showReader: async (target: GuideTarget) => { openedGuides.push(target); } } } });
const listeners = new Set<(progress: DeploymentProgress) => void>();
let executions = 0, statuses = 0, plans = 0, generation = 0;
let snapshot: TaskSnapshotV01 = { contractVersion: "0.1", taskId: "synthetic-acquisition", revision: 1,
  correlationId: "synthetic", state: "queued", cancellationRequested: false, recoveryDisposition: "none", updatedAt: "2026-10-08T00:00:00Z" };
const gateway = { ...base, environment: { ...base.environment, deployment: {
  capability: async () => ({ state: "ready" as const }),
  plan: async (intent: DeploymentIntent): Promise<DeploymentPlan> => {
    plans++;
    return { schemaVersion: "vua.environment-deployment/v0.1", intent, digest: "a".repeat(64), installer: null, prerequisitesReady: false,
      steps: [
        { component: "steam", action: "install_steam", reason: "missing", location: null, version: null, officialUrl: "https://store.steampowered.com/about/" },
        { component: "vrchat", action: "manual_install", reason: "missing", location: null, version: null, officialUrl: "https://store.steampowered.com/app/438100/" },
        { component: "steamvr", action: "manual_install", reason: "missing", location: null, version: null, officialUrl: "https://store.steampowered.com/app/250820/" },
        { component: "pico_runtime", action: "install_pico_runtime", reason: "missing", location: null, version: null,
          officialUrl: intent.picoRegion === "china_mainland" ? "https://www.picoxr.com/cn/software/pico-link" : "https://www.picoxr.com/global/software/pico-link" },
      ] };
  },
  execute: async () => { executions++; return snapshot.taskId; },
  status: async () => { statuses++; return snapshot; },
  cancel: async () => {},
  subscribe: (_id: string, listener: (progress: DeploymentProgress) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
} } };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 40));
function assert(value: unknown, name: string) { if (!value) throw Error(name); checks.push(name); }
async function until(predicate: () => unknown) {
  for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await tick(); }
  throw Error("renderer did not settle");
}
function findButton(label: string) {
  return [...document.querySelectorAll("button")].find(value => value.textContent === label);
}
function button(label: string) {
  const found = findButton(label);
  if (!found) throw Error(`missing button ${label}`); return found;
}
function choice(label: string) {
  const found = [...document.querySelectorAll("label")].find(value => value.textContent === label)?.querySelector("input");
  if (!found) throw Error(`missing choice ${label}`); return found;
}
function mount() { root.render(<StrictMode><GatewayProvider gateway={gateway}><DeploymentPanel key={++generation} zone="play" /></GatewayProvider></StrictMode>); }
Object.assign(window, { deploymentReview: { run: async () => {
  localStorage.removeItem(storageKeys.deploymentReceiptPlay); localStorage.removeItem(storageKeys.picoRegion); mount();
  await until(() => document.querySelector("fieldset"));
  assert(executions === 0, "mount never starts installation");
  assert(!document.querySelector("input[type=text]"), "play route hides Unity location");
  choice(strings.deployment.purposes.pico_pcvr).click(); await tick();
  assert(button(strings.deployment.plan).disabled, "PICO requires explicit region");
  const region = document.querySelector("select")!;
  region.value = "china_mainland"; region.dispatchEvent(new Event("change", { bubbles: true })); await tick();
  button(strings.deployment.plan).click(); await until(() => document.querySelector("ol"));
  assert(document.body.textContent?.includes(strings.deployment.actions.install_pico_runtime), "vendor actions render in selected locale");
  region.value = "other"; region.dispatchEvent(new Event("change", { bubbles: true })); await tick();
  assert(!document.querySelector("ol"), "changing region clears displayed consent");
  await until(() => findButton(strings.deployment.plan)?.disabled === false);
  button(strings.deployment.plan).click(); await until(() => document.querySelector("ol"));
  await until(() => findButton(strings.deployment.execute)?.disabled === false);
  button(strings.deployment.execute).click(); await until(() => executions === 1 && statuses > 0);
  assert(!findButton(strings.deployment.execute), "accepted task clears obsolete execution consent");
  listeners.forEach(listener => listener({ component: "steam", action: "install_steam", phase: "downloading", source: "official", completedBytes: 1024, totalBytes: 2048 }));
  await until(() => document.querySelector("progress"));
  assert(document.querySelector("progress")!.value === 1024, "download uses actual byte progress");
  listeners.forEach(listener => listener({ component: "steam", action: "install_steam", phase: "installing", source: "official" })); await tick();
  assert(!document.querySelector("progress"), "native installation has no invented percentage");
  const beforeReturn = statuses; mount(); await until(() => statuses > beforeReturn);
  assert(executions === 1 && plans === 2, "return queries accepted receipt without execution or replanning");
  assert((document.querySelector("select") as HTMLSelectElement).value === "other", "return restores confirmed region");
  snapshot = { ...snapshot, state: "failed", revision: 2, error: { contractVersion: "0.1", code: "vua.deployment.installer_timed_out",
    category: "external_failure", messageKey: "errors.deployment.failed", correlationId: "synthetic", recoverable: true, retryable: false } };
  await until(() => document.body.textContent?.includes(strings.deployment.installerErrors.installer_timed_out));
  assert(document.querySelector("details code")?.textContent === snapshot.error!.code, "failure code stays in expandable details");
  assert(!(document.querySelector("details") as HTMLDetailsElement).open, "failure details default collapsed");
  assert(executions === 1, "failed task never auto-retries");
  snapshot = { ...snapshot, state: "succeeded_with_warnings", revision: 3, error: undefined,
    result: { outcome: "manual_required", prerequisitesReady: false,
      nextStep: { component: "vrchat", action: "manual_install", officialUrl: "https://store.steampowered.com/app/438100/" } } };
  mount(); await until(() => findButton(strings.deployment.official));
  assert(!document.querySelector("ol") && !!document.querySelector('[data-guide-entry="install-vrchat"]'), "returned handoff retains official and guide entries without a saved plan");
  button(strings.deployment.official).click();
  assert(openedUrls.at(-1) === "https://store.steampowered.com/app/438100/", "returned handoff requests the current official destination");
  (document.querySelector('[data-guide-entry="install-vrchat"]') as HTMLButtonElement).click();
  assert(openedGuides.at(-1)?.section === "install-vrchat", "returned handoff opens the current installation guide section");
  assert(executions === 1 && plans === 2, "manual handoff return does not start another task");
  snapshot = { ...snapshot, state: "succeeded", revision: 4, result: { outcome: "prerequisites_verified", prerequisitesReady: true } };
  mount(); await until(() => document.querySelector('[data-guide-entry="pico-prepare"]'));
  assert(document.body.textContent?.includes([strings.deployment.purposes.desktop_play, strings.deployment.purposes.pico_pcvr].join(" / ")), "task outcome names the accepted routes");
  assert(!!document.querySelector('[data-guide-entry="pico-prepare"]'), "returned successful play task leads to the accepted PICO route");
  (document.querySelector('[data-guide-entry="pico-prepare"]') as HTMLButtonElement).click();
  assert(openedGuides.at(-1)?.section === "pico-prepare", "software preparation opens the selected route guide");
  choice(strings.deployment.purposes.pico_pcvr).click(); await tick();
  assert(!!document.querySelector('[data-guide-entry="pico-prepare"]'), "changing future choices cannot rewrite the accepted task route");
  return checks;
} } });

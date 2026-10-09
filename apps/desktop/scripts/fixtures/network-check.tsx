// Explicit DOM fixture, outside the product bundle. No Internet observations are simulated as live.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { NetworkIntent, NetworkReport, WebsiteObservation } from "@vua/contracts";
import { GatewayProvider } from "../../src/renderer/gateway/GatewayProvider.tsx";
import { emptyGateway } from "../../src/renderer/gateway/empty-gateway.ts";
import { NetworkPanel } from "../../src/renderer/features/deployer/NetworkPanel.tsx";
import { storageKeys } from "../../src/renderer/app/storage-keys.ts";
import { strings, format } from "../../src/renderer/i18n/index.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";

const checks: string[] = [];
const root = createRoot(document.getElementById("root")!);
const base = emptyGateway();
let pending: { urls: readonly string[]; resolve: (rows: readonly WebsiteObservation[]) => void; reject: () => void } | null = null;
let requestCount = 0;
let regionRequests = 0;
const gateway = { ...base, environment: { ...base.environment, network: {
  capability: async () => ({ state: "ready" as const }),
  websiteCapability: async () => ({ state: "ready" as const }),
  check: async (intent: NetworkIntent): Promise<NetworkReport> => { regionRequests++; return { schemaVersion: "0.1", intent,
    detectedRegion: "unknown", effectiveRegion: "unknown", capturedAt: "2026-10-07T00:00:00Z", durationMs: 0, results: [] }; },
  testWebsites: (urls: readonly string[]) => new Promise<readonly WebsiteObservation[]>((resolve, reject) => {
    requestCount++; pending = { urls, resolve, reject: () => reject(Error("synthetic transport failure")) };
  }),
} } };
const tick = () => new Promise<void>(r => setTimeout(r, 40));
function assert(value: unknown, name: string) { if (!value) throw Error(name); checks.push(name); }
function button(label: string) {
  const found = [...document.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === label || b.textContent === label);
  if (!found) throw Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) { button(label).click(); await tick(); }
function mount() { root.render(<StrictMode><GatewayProvider gateway={gateway}><NetworkPanel /></GatewayProvider></StrictMode>); }
function rows(urls: readonly string[]): WebsiteObservation[] {
  return urls.map((url, i) => ({ url, status: i === 1 ? "timeout" : "reachable", elapsedMs: i === 1 ? 6000 : 123, httpStatus: i === 1 ? null : 200 }));
}
Object.assign(window, { networkReview: { run: async () => {
  localStorage.removeItem(storageKeys.testWebsites); mount();
  for (let n = 0; n < 100 && !document.querySelector(".vua-network__test:not(:disabled)"); n++) await tick();
  assert(document.querySelectorAll(".vua-network__site").length === 3, "three default website cards");
  assert(requestCount === 0, "mount never runs a probe");
  await click(strings.websiteTests.testAll);
  assert(pending?.urls.length === 3 && button(strings.websiteTests.testAll).disabled, "test all uses one bounded batch");
  pending!.resolve(rows(pending!.urls)); pending = null; await tick();
  assert(document.body.textContent?.includes("123 ms") && document.body.textContent?.includes(strings.websiteTests.statuses.timeout), "mixed results remain visible per card");
  await click(format(strings.websiteTests.testSite, { name: "VRChat" }));
  assert(pending?.urls.length === 1, "individual retry requests one site");
  pending!.reject(); pending = null; await tick();
  assert(document.body.textContent?.includes(strings.websiteTests.statuses.probe_error), "failed retry replaces only its card");
  assert(document.body.textContent?.includes("123 ms"), "other card result survives retry");
  await click(strings.websiteTests.add);
  assert(Boolean(document.querySelector('[role="dialog"]')), "add opens an editor");
  await click(strings.websiteTests.cancel);
  assert(!document.querySelector(".vua-network__help, select, .vua-network a"), "connection help, region selection and product recommendations are removed");
  assert(regionRequests === 0, "website testing never invokes country detection");
  return checks;
} } });

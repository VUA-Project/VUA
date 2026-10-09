// Actual Chromium interactions with synthetic records; never imported by the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopGatewayRequestV1 } from "@vua/contracts";
import library from "../../../../schemas/library-view/v0.1/examples/list.response.json";
import { strings, currentLocale } from "../../src/renderer/i18n/index.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";
import "../../src/renderer/app-shell.css";

const copy = strings.warehouse;
const settings = strings.settings.experimental;
let mode: "normal" | "empty" | "absent" | "delayed" = "normal";
let release: (() => void) | null = null;
const calls: DesktopGatewayRequestV1[] = [];
const observation = {
  depKind: "other", depName: "Example Avatar", versionHint: null,
  rawQuote: "https://example.booth.pm/items/91", sourceSpan: "description_link",
  extractionMethod: "link", extractedBy: "synthetic-link-reader", observedAt: "2026-10-09T00:00:00Z",
  resolution: { productId: "booth:91", confirmed: false,
    evidence: [{ linkText: "Example Avatar", linkUrl: "https://example.booth.pm/items/91", span: "description_link", note: null }] },
};
const match = (index: number) => ({
  productId: `booth:${1000 + index}`, productTitle: `Synthetic source ${index}`, availabilityStatus: "unknown", availabilityRaw: null,
  depKind: "other", depName: observation.depName, versionHint: null, rawQuote: observation.rawQuote,
  sourceSpan: "description_link", extractionMethod: "link", resolvedProductId: null, advisory: null,
});
const application = (code: string, category = "validation") => ({ ok: false, error: { code: "application", application: {
  schemaVersion: "0.1", code, category, messageKey: "errors.catalog.fallback", recoverable: true,
  correlationId: "synthetic", params: {},
} } });
const invoke = async (request: DesktopGatewayRequestV1) => {
  calls.push(structuredClone(request));
  if (request.method === "library.list") return { ok: true, value: library };
  if (request.method === "catalog.detail") return application("vua.catalog.product_not_found");
  if (request.method === "dependencies.listByProduct" || request.method === "dependencies.lookup") {
    if (mode === "absent") return application("vua.provider.unknown_method", "unavailable");
    if (mode === "delayed") await new Promise<void>((resolve) => { release = resolve; });
    const result = request.method === "dependencies.listByProduct"
      ? { productId: request.params.productId, productStatus: "complete", observations: mode === "empty" ? [] : [observation] }
      : { total: mode === "empty" ? 0 : 51, matches: mode === "empty" ? []
        : Array.from({ length: request.params.offset === 50 ? 1 : 50 }, (_, index) => match((request.params.offset ?? 0) + index)) };
    return { ok: true, value: { schemaVersion: "0.6", operation: request.method, result } };
  }
  throw new Error(`unexpected synthetic method: ${request.method}`);
};
Object.defineProperty(window, "vua", { configurable: true, value: { gateway: { invoke }, events: { subscribe: () => () => {} } } });
const { GatewayProvider, emptyGateway, createGatewayClient, createLiveDependenciesPort } = await import("../../src/renderer/gateway/index.ts");
const { DependencyCluesSetting } = await import("../../src/renderer/features/settings/DependencyCluesSetting.tsx");
const { WarehousePage } = await import("../../src/renderer/features/warehouse/WarehousePage.tsx");
const { saveDependencyClues, loadDependencyClues } = await import("../../src/renderer/app/dependency-clues-flag.ts");
const gateway = { ...emptyGateway(), dataSource: () => "live" as const, dependencies: createLiveDependenciesPort(createGatewayClient(window.vua)) };
document.documentElement.lang = currentLocale;
document.body.dataset.module = "production";
const root = createRoot(document.getElementById("root")!);
const checks: string[] = [];
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
const text = () => document.body.textContent ?? "";
function check(value: unknown, name: string) { if (!value) throw new Error(name); checks.push(name); }
async function until(test: () => boolean, name: string) {
  const deadline = performance.now() + 7000;
  while (!test()) { if (performance.now() > deadline) throw new Error(`${name}: ${text()}`); await pause(); }
}
function button(label: string): HTMLButtonElement {
  const scope = document.querySelector('[role="dialog"]') ?? document;
  const node = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label);
  if (!node) throw new Error(`missing button: ${label}`);
  return node;
}
async function click(label: string) { button(label).click(); await pause(); }
async function toggle() {
  document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${settings.dependencyCluesTitle}"]`)!.click();
  await pause();
}
function clues() { return calls.filter((call) => call.method.startsWith("dependencies.")); }
async function menu() {
  document.querySelector<HTMLElement>('[data-product-id="booth:90"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
  await until(() => document.querySelector('[role="menu"]') !== null, "product menu opens");
}
async function openClues(nextMode: typeof mode = "normal") {
  mode = nextMode; await menu(); await click(copy.cardMenu.showCompatible);
}
function setName(value: string) {
  const input = document.getElementById("dependency-lookup-name") as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
async function run() {
  check(!loadDependencyClues(), "dependency clues default off in a fresh profile");
  root.render(<StrictMode><GatewayProvider gateway={gateway}><div style={{ padding: 16 }}>
    <DependencyCluesSetting /><WarehousePage />
  </div></GatewayProvider></StrictMode>);
  await until(() => document.querySelector('[data-product-id="booth:90"]') !== null, "library card loads");
  check(clues().length === 0 && !text().includes(copy.dependencyLookup.open), "default-off library neither queries nor exposes reverse lookup");
  await menu(); check(!text().includes(copy.cardMenu.showCompatible), "default-off product menu hides dependency clues");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await pause();
  await toggle(); await until(() => text().includes(settings.dependencyCluesWarning), "enable explanation opens");
  check(!loadDependencyClues() && text().includes(settings.dependencyCluesReverseNote), "accuracy and matching boundaries precede enablement");
  await click(settings.dialogCancel); check(!loadDependencyClues(), "cancelling explanation keeps feature off");
  await toggle(); await click(settings.dependencyCluesEnable);
  await until(() => text().includes(copy.dependencyLookup.open), "library entry appears after enablement");
  check(loadDependencyClues(), "enablement persists in settings");
  await openClues(); await until(() => text().includes(observation.depName), "description link is displayed");
  check(text().includes(copy.compatibleDialog.unconfirmed) && text().includes(copy.compatibleDialog.boundary), "known link remains an unconfirmed clue with accuracy limits");
  check(text().includes(observation.rawQuote), "source evidence is readable");
  await click(copy.compatibleDialog.lookupName);
  await until(() => text().includes("Synthetic source 0"), "clue-name reverse lookup returns declaring products");
  const first = clues().filter((call) => call.method === "dependencies.lookup").at(-1)!;
  check(first.params.name === observation.depName && first.params.offset === 0 && first.params.limit === 50, "reverse lookup submits the observed full name without title inference");
  check(text().includes(copy.compatibleDialog.unconfirmed) && text().includes(copy.dependencyLookup.boundary), "reverse results retain uncertainty and coverage limits");
  await click(copy.libraryState.nextPage); await until(() => text().includes("Synthetic source 50"), "next page returns final observation");
  check(clues().filter((call) => call.method === "dependencies.lookup").at(-1)!.params.offset === 50, "reverse lookup uses server pagination");
  await click(copy.dependencyLookup.openProduct);
  await until(() => calls.some((call) => call.method === "catalog.detail" && call.params.productId === "booth:1050"), "source product opens in detail drawer");
  check(document.querySelector('[role="dialog"]') === null, "source selection closes reverse lookup");
  await toggle();
  check(!loadDependencyClues() && document.querySelector('[role="dialog"]') === null, "settings can turn off immediately without another confirmation");
  await toggle(); await click(settings.dependencyCluesEnable);
  mode = "empty"; await click(copy.dependencyLookup.open); await pause();
  check(button(copy.dependencyLookup.search).disabled, "empty name does not send a query");
  setName("User entered name"); await pause(); await click(copy.dependencyLookup.search);
  await until(() => text().includes(copy.dependencyLookup.empty), "empty reverse results are explicit");
  check(clues().filter((call) => call.method === "dependencies.lookup").at(-1)!.params.name === "User entered name", "manual search uses the provided full name");
  document.querySelector<HTMLButtonElement>(`[aria-label="${strings.common.dialogClose}"]`)!.click(); await pause();
  await openClues("empty"); await until(() => text().includes(copy.compatibleDialog.empty), "empty clues do not claim no dependencies exist");
  document.querySelector<HTMLButtonElement>(`[aria-label="${strings.common.dialogClose}"]`)!.click(); await pause();
  await openClues("absent"); await until(() => text().includes(copy.compatibleDialog.absent), "unavailable query is shown honestly");
  document.querySelector<HTMLButtonElement>(`[aria-label="${strings.common.dialogClose}"]`)!.click(); await pause();
  await openClues("delayed"); await until(() => release !== null, "slow observation request is in flight");
  saveDependencyClues(false); await until(() => document.querySelector('[role="dialog"]') === null, "turning off closes an in-flight observation dialog");
  release!(); release = null; await pause();
  check(!text().includes(copy.dependencyLookup.open) && !text().includes(observation.depName), "late observation reply cannot reopen disabled UI");
  const count = clues().length;
  await menu(); check(!text().includes(copy.cardMenu.showCompatible) && clues().length === count, "disabled menu stops dependency query initiation");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await pause();
  await toggle(); await click(settings.dependencyCluesEnable);
  mode = "delayed"; await click(copy.dependencyLookup.open); setName("Late result"); await pause(); await click(copy.dependencyLookup.search);
  await until(() => release !== null, "slow reverse query is in flight");
  saveDependencyClues(false); await pause(); release!(); release = null; await pause();
  check(document.querySelector('[role="dialog"]') === null && !text().includes("Synthetic source 0"), "late reverse reply cannot reopen disabled UI");
  await toggle(); await click(settings.dependencyCluesEnable); await openClues();
  await until(() => text().includes(observation.depName), "enabled clues remain usable after cancellation");
  return checks;
}
(window as unknown as { n5DependencyReview: { run: typeof run } }).n5DependencyReview = { run };

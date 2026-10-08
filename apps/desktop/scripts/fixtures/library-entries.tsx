// Source/record dialogs with synthetic local entries and durable receipt simulation.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopGatewayRequestV1, LibraryEntryMetadataV01 } from "@vua/contracts";
import { strings, currentLocale } from "../../src/renderer/i18n/index.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";
import "../../src/renderer/app-shell.css";

const source = strings.warehouse.editSource;
const removal = strings.warehouse.removeEntries;
const entries = [{ entryId: "whi-first", displayName: "Same title" }, { entryId: "whi-second", displayName: "Same title" }];
const thumbnail = `vua-img://local/${"a".repeat(64)}`;
const records = new Map<string, LibraryEntryMetadataV01>();
const receipts = new Map<string, unknown>();
let mode: "normal" | "lost_source" | "conflict" | "lost_remove" = "normal";
let lost = false;
let changed = 0;
let writes = 0;
let removed = 0;
let fetched: string[] = [];
let calls: DesktopGatewayRequestV1[] = [];
const application = (code: string) => ({ ok: false, error: { code: "application", application: {
  schemaVersion: "0.1", code, category: "conflict", messageKey: "errors.library.metadataFailed",
  recoverable: true, correlationId: "synthetic", params: {},
} } });
const invoke = async (request: DesktopGatewayRequestV1) => {
  calls.push(structuredClone(request));
  if (request.method === "library.entryMetadata") return { ok: true, value: structuredClone(records.get(request.params.entryId)) };
  if (request.method === "catalog.detail") return { ok: true, value: { schemaVersion: "0.6", operation: request.method, result: { product: {
    productId: request.params.productId, title: `Official ${request.params.productId}`, libraryType: null,
    price: null, imageUrl: null, imageUrls: [], videoUrls: [], subproducts: [], availabilityRaw: null, availabilityStatus: "unknown",
  } } } };
  if (request.method === "library.updateEntryMetadata") {
    if (mode === "conflict") return application("vua.library.metadata_conflict");
    const p = request.params;
    if (!receipts.has(p.commandId)) {
      const record = { schemaVersion: "0.1", entryId: p.entryId, revision: p.expectedRevision + 1,
        displayName: p.displayName, productId: p.productId, thumbnailRef: p.thumbnailRef };
      records.set(p.entryId, record); receipts.set(p.commandId, record); writes++;
    }
    if (mode === "lost_source" && !lost) { lost = true; throw new Error("receipt lost after commit"); }
    return { ok: true, value: structuredClone(receipts.get(p.commandId)) };
  }
  if (request.method === "library.removeLocalEntries") {
    const p = request.params;
    if (!receipts.has(p.commandId)) {
      receipts.set(p.commandId, { schemaVersion: "0.1", entryIds: p.entryIds }); removed++;
    }
    if (mode === "lost_remove" && !lost) { lost = true; throw new Error("receipt lost after commit"); }
    return { ok: true, value: structuredClone(receipts.get(p.commandId)) };
  }
  throw new Error(`unexpected synthetic method: ${request.method}`);
};
Object.defineProperty(window, "vua", { configurable: true, value: { gateway: { invoke }, events: { subscribe: () => () => {} },
  dialog: { pickLibraryThumbnail: async () => thumbnail },
  catalogSync: { fetchProduct: async (id: string) => { fetched.push(id); return { ok: true }; } },
} });
const { EditSourceDialog } = await import("../../src/renderer/features/warehouse/EditSourceDialog.tsx");
const { RemoveEntriesDialog } = await import("../../src/renderer/features/warehouse/RemoveEntriesDialog.tsx");
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
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label);
  if (!node) throw new Error(`missing button: ${label}`);
  return node;
}
async function click(label: string) { button(label).click(); await pause(); }
function input(index: number, value: string) {
  const node = document.querySelectorAll<HTMLInputElement>(".vua-edit-source input")[index]!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}
function Case({ kind }: { kind: "source" | "remove" }) {
  const [open, setOpen] = useState(true);
  return open ? kind === "source" ? <EditSourceDialog entries={entries} onClose={() => setOpen(false)} onChanged={() => changed++} />
    : <RemoveEntriesDialog entries={entries} onClose={() => setOpen(false)} onChanged={() => changed++} /> : <p>Closed synthetic dialog</p>;
}
let generation = 0;
async function open(kind: "source" | "remove", nextMode: typeof mode = "normal") {
  mode = nextMode; lost = false; changed = 0; writes = 0; removed = 0; fetched = []; calls = []; receipts.clear(); records.clear();
  for (const entry of entries) records.set(entry.entryId, { schemaVersion: "0.1", entryId: entry.entryId, revision: 0, displayName: entry.displayName, productId: null, thumbnailRef: null });
  const reviewGeneration = ++generation;
  root.render(<StrictMode><div key={reviewGeneration} data-review-generation={reviewGeneration}><Case kind={kind} /></div></StrictMode>);
  await until(() => document.querySelector(`[data-review-generation="${generation}"]`) !== null && (kind === "source"
    ? document.querySelectorAll(".vua-edit-source input").length === 2
    : document.querySelectorAll('input[type="checkbox"]').length === 2), "dialog loads");
}
async function run() {
  await open("source", "lost_source");
  input(1, "Manual title"); await pause(); await click(source.pickImage);
  check(document.querySelector<HTMLImageElement>(".vua-edit-source img")?.getAttribute("src") === thumbnail, "thumbnail remains an opaque private reference in the renderer");
  await until(() => document.querySelector<HTMLImageElement>(".vua-edit-source img")?.naturalWidth === 1, "synthetic protocol image renders");
  await click(source.save); await until(() => text().includes(source.saveFailed), "lost metadata receipt is visible");
  check(changed === 0 && writes === 1, "lost receipt does not show success or commit twice");
  await click(source.save); await until(() => document.querySelector('[role="dialog"]') === null, "metadata retry recovers receipt");
  const updates = calls.filter((call) => call.method === "library.updateEntryMetadata");
  check(updates.length === 2 && JSON.stringify(updates[0]!.params) === JSON.stringify(updates[1]!.params) && changed === 1 && writes === 1, "metadata retry keeps the same command and revision");
  check(records.get("whi-first")?.displayName === "Manual title" && records.get("whi-first")?.thumbnailRef === thumbnail && records.get("whi-second")?.displayName === "Same title", "manual metadata changes only the selected import");

  await open("source"); input(0, "https://example.booth.pm/ja/items/902"); await pause(); await click(source.readOfficial);
  await until(() => document.querySelectorAll<HTMLInputElement>(".vua-edit-source input")[1]?.value === "Official booth:902", "official lookup supplies a name");
  check(fetched[0] === "booth:902", "BOOTH link reuses official lookup with canonical identity");
  input(1, "User supplied title"); input(0, "903"); await pause(); await click(source.save);
  await until(() => document.querySelector('[role="dialog"]') === null, "changed source is resolved before saving");
  check(fetched.includes("booth:903") && records.get("whi-first")?.productId === "booth:903" && records.get("whi-first")?.displayName === "User supplied title", "new official lookup preserves an explicitly edited name");

  await open("source"); input(0, "https://example.invalid/items/902"); await pause(); await click(source.save);
  await until(() => text().includes(source.invalidId), "foreign source URL is rejected");
  check(fetched.length === 0 && writes === 0, "invalid source never fetches or writes metadata");
  await open("source", "conflict"); input(1, "Changed"); await pause(); await click(source.save);
  await until(() => text().includes(source.conflict), "revision conflict has explicit feedback");
  check(changed === 0 && document.querySelector('[role="dialog"]') !== null, "revision conflict retains the open form without claiming success");

  await open("source");
  const select = document.querySelector<HTMLSelectElement>(".vua-edit-source select")!;
  select.value = "whi-second"; select.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => calls.some((call) => call.method === "library.entryMetadata" && call.params.entryId === "whi-second"), "other merged origin loads");
  await until(() => !button(source.save).disabled, "other origin becomes editable");
  input(1, "Second local title"); await pause(); await click(source.save);
  await until(() => document.querySelector('[role="dialog"]') === null, "second origin is saved");
  check(records.get("whi-second")?.displayName === "Second local title" && records.get("whi-first")?.displayName === "Same title", "identical card names do not conflate source-edit targets");

  await open("remove");
  check(text().includes(removal.description) && text().includes(removal.wholeImport), "record removal explains retained files/references and whole-import scope");
  await click(removal.cancel);
  check(removed === 0 && changed === 0, "cancelling record removal performs no command");
  await open("remove", "lost_remove");
  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!.click(); await pause();
  await click(removal.confirm); await until(() => text().includes(removal.failed), "lost removal receipt is visible");
  check(removed === 1 && changed === 0, "record removal cannot claim success without its receipt");
  await click(removal.confirm); await until(() => document.querySelector('[role="dialog"]') === null, "record-removal retry recovers receipt");
  const removals = calls.filter((call) => call.method === "library.removeLocalEntries");
  check(removals.length === 2 && JSON.stringify(removals[0]!.params) === JSON.stringify(removals[1]!.params) && removed === 1 && changed === 1, "record-removal retry keeps one command and one mutation");
  check(JSON.stringify(removals[0]!.params.entryIds) === JSON.stringify(["whi-second"]) && !calls.some((call) => call.method === "library.removeFiles"), "record removal submits selected local identities and never deletes files");
  await open("remove");
  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((node) => node.click()); await pause();
  check(button(removal.confirm).disabled, "empty record selection cannot be submitted");
  return checks;
}
(window as unknown as { n5EntriesReview: { run: typeof run } }).n5EntriesReview = { run };

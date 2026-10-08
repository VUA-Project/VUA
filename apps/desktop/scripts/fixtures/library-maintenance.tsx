// Actual Chromium interaction with a synthetic Gateway. Never imported by the app.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopGatewayRequestV1, LibraryRemovalPreviewV01, LibraryRemovalSnapshotV01, LibraryRemoveFilesParamsV01 } from "@vua/contracts";
import { strings, currentLocale, format, termLabel } from "../../src/renderer/i18n/index.ts";
import { fixtureStrings } from "../../src/renderer/i18n/strings.fixtures.zh-CN.ts";
import "@vua/design-system/tokens.css";
import "@vua/design-system/base.css";
import "../../src/renderer/app-shell.css";

const copy = strings.warehouse.removeFiles;
const target = { kind: "product", id: "booth:90" } as const;
const files: LibraryRemovalPreviewV01["files"] = [
  { copyId: "cpy-original", entryId: "whi-synthetic", fileName: "synthetic-notes.pdf", role: "original", artifactSha256: `sha256:${"a".repeat(64)}`, sizeBytes: 14, presence: "present", superseded: false },
  { copyId: "cpy-old-vpm", entryId: "whi-synthetic", fileName: "vpm/synthetic-old.zip", role: "generated_vpm", artifactSha256: `sha256:${"b".repeat(64)}`, sizeBytes: 19, presence: "missing", superseded: true },
];
type Mode = "normal" | "lost_receipt" | "preview_drift" | "reference_failure" | "recovered";
let mode: Mode = "normal";
let accepted: LibraryRemoveFilesParamsV01 | null = null;
let latest: LibraryRemovalSnapshotV01 | null = null;
let commandCalls: LibraryRemoveFilesParamsV01[] = [];
let starts = 0;
let recoveredReceipt = false;
let refreshes = 0;
let cancellation: { taskId: string; observedRevision: number } | null = null;
const ok = (value: unknown) => ({ ok: true, value });
const application = (code: string) => ({ ok: false, error: { code: "application", application: {
  schemaVersion: "0.1", code, category: "conflict", messageKey: "errors.library.removalFailed", recoverable: true, correlationId: "synthetic", params: {},
} } });
const invoke = async (request: DesktopGatewayRequestV1): Promise<unknown> => {
  if (request.method === "library.removalPreview") {
    if (mode === "reference_failure") return application("vua.library.reference_read_failed");
    const selected = files.filter((file) => request.params.copyIds === undefined || request.params.copyIds.includes(file.copyId));
    return ok({ schemaVersion: "0.1", target, previewHash: `sha256:${(selected.length === 2 ? "c" : "d").repeat(64)}`,
      files: selected, referenceCoverage: "drafts_and_recipes", unresolvedRecipeAssets: 1,
      references: [{ kind: "draft", id: "recipe-draft-synthetic", title: "Synthetic selection", revision: 3,
        copyIds: selected.map((file) => file.copyId), missingAfterRemoval: true }],
    } satisfies LibraryRemovalPreviewV01);
  }
  if (request.method === "library.removeFiles") {
    commandCalls.push(structuredClone(request.params));
    if (mode === "preview_drift") return application("vua.library.preview_changed");
    if (accepted === null) {
      accepted = structuredClone(request.params); starts++;
      latest = { schemaVersion: "0.1", removalId: accepted.removalId, target, taskId: "task-synthetic-removal", taskState: "running",
        revision: 3, cancelRequested: false, recoveryDisposition: mode === "recovered" ? "inspect_required" : "none", state: mode === "recovered" ? "unconfirmed" : "running",
        files: files.filter((file) => accepted!.copyIds.includes(file.copyId)).map((file) => ({ copyId: file.copyId, entryId: file.entryId, fileName: file.fileName, phase: "pending", errorCode: null })),
      };
      if (mode === "lost_receipt") throw new Error("synthetic lost receipt after acceptance");
    } else if (JSON.stringify(accepted) !== JSON.stringify(request.params)) {
      throw new Error("retry changed the authorized request");
    }
    recoveredReceipt = true;
    return ok(structuredClone(latest));
  }
  if (request.method === "library.removalStatus") {
    if (latest === null || mode === "lost_receipt" && !recoveredReceipt) throw new Error("synthetic status unavailable");
    return ok(structuredClone(latest));
  }
  if (request.method === "task.requestCancellation") {
    const { taskId, observedRevision } = request.params;
    if (observedRevision === undefined) throw new Error("cancellation omitted the observed revision");
    cancellation = { taskId, observedRevision };
    latest = { ...latest!, revision: latest!.revision + 1, cancelRequested: true };
    return ok({ contractVersion: "0.1", taskId, revision: latest.revision, state: latest.taskState, outcome: "requested" });
  }
  throw new Error(`unexpected synthetic method: ${request.method}`);
};
// The singleton port captures its host at import time; install the synthetic host first.
Object.defineProperty(window, "vua", { configurable: true, value: { gateway: { invoke }, events: { subscribe: () => () => {} } } });
const { RemoveFilesDialog } = await import("../../src/renderer/features/warehouse/RemoveFilesDialog.tsx");
document.documentElement.lang = currentLocale;
document.body.dataset.module = "production";
const root = createRoot(document.getElementById("root")!);
const results: string[] = [];
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
function check(value: unknown, name: string) { if (!value) throw new Error(name); results.push(name); }
async function until(test: () => boolean, name: string) {
  const deadline = performance.now() + 7000;
  while (!test()) { if (performance.now() > deadline) throw new Error(`${name}: ${document.body.textContent}`); await pause(); }
}
function button(text: string): HTMLButtonElement {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text);
  if (!node) throw new Error(`missing button: ${text}`);
  return node;
}
async function click(text: string) { button(text).click(); await pause(); }
function Case() {
  const [open, setOpen] = useState(false);
  return <><p>{fixtureStrings.libraryMaintenanceProbeTitle}</p><button id="opener" onClick={() => setOpen(true)}>open synthetic removal</button>
    {open ? <RemoveFilesDialog item={{ target, title: "Synthetic material" }} onClose={() => setOpen(false)} onChanged={() => { refreshes++; }} /> : null}</>;
}
let generation = 0;
async function open(nextMode: Mode = "normal") {
  mode = nextMode; accepted = null; latest = null; commandCalls = []; starts = 0; recoveredReceipt = false; refreshes = 0; cancellation = null;
  root.render(<StrictMode><Case key={++generation} /></StrictMode>); await pause();
  document.getElementById("opener")!.focus(); await click("open synthetic removal");
  if (nextMode === "reference_failure") await until(() => document.body.textContent!.includes(copy.loadFailed), "reference failure displayed");
  else await until(() => !button(copy.confirm).disabled, "preview ready");
}
async function run() {
  await open();
  check(commandCalls.length === 0, "opening the preview never starts deletion");
  check(document.querySelectorAll('input[type="checkbox"]:checked').length === 2, "all observed copies initially selected");
  check(document.body.textContent!.includes(copy.oldVersion) && document.body.textContent!.includes(copy.missing), "old generated and missing file facts shown");
  check(document.body.textContent!.includes(format(copy.unresolvedReferences, { count: 1, recipe: termLabel("recipe") })), "unresolved Recipe coverage remains visible");
  await click(copy.clear);
  check(button(copy.confirm).disabled && !button(copy.retry).disabled, "empty selection cannot delete and does not remain busy");
  (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
  await until(() => !button(copy.confirm).disabled, "subset preview ready");
  check(document.querySelectorAll('input[type="checkbox"]:checked').length === 1, "subset selection is retained");
  await click(copy.selectAll); await until(() => !button(copy.confirm).disabled, "all-file preview refreshed");
  check(commandCalls.length === 0, "selection changes only preview");

  await open("lost_receipt");
  await click(copy.confirm);
  await until(() => [...document.querySelectorAll("button")].some((node) => node.textContent?.trim() === copy.retryRequest), "lost receipt recovery entry");
  check(document.body.textContent!.includes(copy.resultUnknown) && starts === 1, "lost receipt is unknown, not a claimed failed deletion");
  await click(copy.retryRequest);
  await until(() => [...document.querySelectorAll("button")].some((node) => node.textContent?.trim() === copy.cancel), "accepted task shown");
  check(starts === 1 && commandCalls.length === 2 && JSON.stringify(commandCalls[0]) === JSON.stringify(commandCalls[1]), "explicit retry retains removal ID, preview hash and selected copies");
  check(refreshes > 0, "durable receipts refresh the owning library");
  await click(copy.cancel);
  check(cancellation?.taskId === "task-synthetic-removal" && cancellation.observedRevision === 3, "cancellation targets the observed task revision");
  check(!document.body.textContent!.includes(copy.cancelled), "cancellation acceptance does not claim terminal cancellation");
  await until(() => button(copy.cancel).disabled, "cancel flag observed");
  latest = { ...latest!, revision: 5, taskState: "cancelled", state: "cancelled", files: latest!.files.map((file, index) => ({ ...file, phase: index === 0 ? "removed" : "pending" })) };
  await until(() => document.body.textContent!.includes(copy.cancelled), "terminal cancellation shown");
  check(document.body.textContent!.includes(copy.removed) && document.body.textContent!.includes(copy.pending), "cancelled partial results remain visible");

  await open("reference_failure");
  check(!document.body.textContent!.includes(copy.noReferences) && commandCalls.length === 0, "failed reference read never becomes no references or allows deletion");
  mode = "normal"; await click(copy.retry); await until(() => !button(copy.confirm).disabled, "reference read retry");
  check(commandCalls.length === 0, "refreshing a failed reference preview never starts deletion");

  await open("recovered"); await click(copy.confirm);
  await until(() => document.body.textContent!.includes(copy.unconfirmed), "interrupted operation inspection shown");
  check(commandCalls.length === 1 && !document.body.textContent!.includes(copy.cancelled), "recovered operation never restarts or invents cancellation");

  await open("preview_drift"); await click(copy.confirm);
  await until(() => document.body.textContent!.includes(copy.drift), "stale preview refusal remains visible");
  check(starts === 0 && commandCalls.length === 1, "drift refusal does not start or automatically retry deletion");
  mode = "normal"; await click(copy.retry); await until(() => !button(copy.confirm).disabled, "final preview ready");
  check(document.querySelectorAll('[role="dialog"]').length === 1, "one accessible dialog remains ready for keyboard close");
  return results;
}
function checkNativeClose() {
  check(document.querySelector('[role="dialog"]') === null && document.activeElement?.id === "opener", "native Escape closes the dialog and restores focus");
  return results;
}
Object.assign(window, { n5MaintenanceReview: { run, checkNativeClose } });

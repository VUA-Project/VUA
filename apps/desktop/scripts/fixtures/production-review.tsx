import React, { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ContentDialog } from "../../src/renderer/components/primitives/ContentDialog.tsx";
import { ConfirmDialog } from "../../src/renderer/components/primitives/ConfirmDialog.tsx";
import { useModalOwner } from "../../src/renderer/components/primitives/modal-layer.tsx";
import { RecipePage } from "../../src/renderer/features/recipe/RecipePage.tsx";
import { ImportPage } from "../../src/renderer/features/import/ImportPage.tsx";
import { WorkshopPage } from "../../src/renderer/features/workshop/WorkshopPage.tsx";
import { GatewayProvider } from "../../src/renderer/gateway/GatewayProvider.tsx";
import { emptyGateway } from "../../src/renderer/gateway/empty-gateway.ts";
import { composeAddItemAction, composeSetNameHintAction, useComposeDraft } from "../../src/renderer/app/compose-draft-store.ts";
import { recipePersisted } from "../../src/renderer/app/recipe-library-revision.ts";
import { format, strings } from "../../src/renderer/i18n/index.ts";

const root = createRoot(document.getElementById("root")!);
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 40));
const results: string[] = [];
function check(ok: unknown, name: string) { if (!ok) throw new Error(name); results.push(name); }
function button(text: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text);
  if (!found) {
    const body = (document.body.textContent ?? "").replace(/\s+/g, " ").slice(0, 1200);
    throw new Error("Button missing: " + text + " | BODY: " + body);
  }
  return found;
}
async function click(text: string, within: ParentNode = document) { button(text, within).click(); await wait(); }
async function key(value: string, shiftKey = false) {
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }));
  await wait();
}
function Satellite() {
  const owner = useModalOwner();
  return createPortal(<div data-vua-modal-owner={owner}><button id="satellite">remote close</button></div>, document.body);
}
function ModalCase() {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  const [dynamic, setDynamic] = useState(false);
  return <><button id="opener" onClick={() => setOpen(true)}>open</button><button id="background">background</button>
    <ContentDialog open={open} title="outer" closeLabel="close outer" onClose={() => setOpen(false)}>
      <button id="inner-opener" onClick={() => setInner(true)}>inner</button>
      <button onClick={() => setDynamic(!dynamic)}>toggle dynamic</button>
      {dynamic && <button id="dynamic" onClick={() => setDynamic(false)}>remove me</button>}
      <Satellite />
      <ConfirmDialog open={inner} title="inner" cancelLabel="cancel" confirmLabel="confirm"
        onCancel={() => setInner(false)} onConfirm={() => setInner(false)}>confirmation</ConfirmDialog>
    </ContentDialog></>;
}
async function modalTests() {
  root.render(<StrictMode><ModalCase /></StrictMode>); await wait();
  const opener = document.getElementById("opener")!; opener.focus(); await click("open");
  check(document.activeElement?.getAttribute("aria-label") === "close outer", "initial focus / StrictMode");
  check(!!document.getElementById("background")?.closest("[inert]"), "background inert");
  check(!document.getElementById("satellite")?.closest("[inert]"), "body portal remains active");
  document.getElementById("satellite")!.focus(); await key("Tab");
  check(document.activeElement?.getAttribute("aria-label") === "close outer", "Tab wraps from body portal");
  await key("Tab", true); check(document.activeElement?.id === "satellite", "Shift+Tab wraps to portal");
  document.getElementById("inner-opener")!.focus(); await click("inner");
  check(document.activeElement?.closest('[aria-label="inner"]'), "nested initial focus");
  check(!!document.getElementById("satellite")?.closest("[inert]"), "parent portal inert behind confirmation");
  await key("Escape"); check(document.querySelectorAll('[role="dialog"]').length === 1, "first Esc closes only inner");
  check(document.activeElement?.id === "inner-opener", "nested focus restoration");
  await click("inner"); (document.querySelector(".vua-confirm-dialog__overlay") as HTMLElement).click(); await wait();
  check(document.querySelectorAll('[role="dialog"]').length === 1, "inner backdrop leaves parent open");
  await click("toggle dynamic");
  const dynamic = document.getElementById("dynamic") as HTMLButtonElement;
  dynamic.focus(); dynamic.disabled = true; await wait();
  check(document.activeElement !== dynamic && document.activeElement?.closest('[role="dialog"]'), "disabled focused button recovers focus");
  dynamic.disabled = false; dynamic.focus(); await click("remove me");
  check(document.activeElement?.closest('[role="dialog"]'), "removed focused button recovers focus");
  await key("Escape"); check(!document.querySelector('[role="dialog"]'), "second Esc closes outer");
  check(document.activeElement === opener, "outer focus restoration");
  check(!document.querySelector("[inert]"), "background restored after close");
  await click("open"); root.render(<div>unmounted</div>); await wait();
  check(!document.querySelector("[inert]"), "unmount clears isolation");
}

const gateway = emptyGateway();
// This fixture hosts AMF pages; declare the optional module ready so the host
// loads their synthetic read ports rather than correctly retaining unavailable states.
gateway.amfModule = { ...gateway.amfModule,
  snapshot: async () => ({ schemaVersion: "0.1", moduleId: "amf", installed: true, state: "ready" }),
};
let documents: Record<string, any> = {};
let pendingSave: { document: any; resolve: (value: any) => void } | null = null;
let listCalls = 0, getCalls = 0;
let holdList = false, holdGet = false;
let delayed: (() => void)[] = [];
const ok = (value: unknown) => ({ schemaVersion: 1, requestId: "synthetic", ok: true, value });
const failure = () => ({ schemaVersion: 1, requestId: "synthetic", ok: false, error: { code: "internal", messageKey: "synthetic" } });
const invoke = async (request: any) => {
  if (request.method === "recipe.list") {
    listCalls++;
    const response = ok({ entries: Object.values(documents).map((doc: any) => ({ recipeId: doc.recipeId, title: doc.title, revision: doc.revision, updatedAt: doc.updatedAt })) });
    if (holdList) { holdList = false; return new Promise((resolve) => delayed.push(() => resolve(response))); }
    return response;
  }
  if (request.method === "recipe.get") {
    getCalls++;
    // Frozen wire face (production-use-case v0.2 recipe-get.result): the
    // receipt carries required top-level identity fields (recipeId/revision,
    // store-authoritative) plus the transparent `recipeDocument` body; the
    // renderer narrows the chain-selection identity from the receipt (029 A4).
    const stored = documents[request.params.recipeId];
    const response = ok({
      recipeId: stored?.recipeId ?? request.params.recipeId,
      revision: stored?.revision ?? 1,
      recipeDocument: stored,
    });
    if (holdGet) { holdGet = false; return new Promise((resolve) => delayed.push(() => resolve(response))); }
    return response;
  }
  if (request.method === "recipe.save") return new Promise((resolve) => { pendingSave = { document: request.params.recipeDocument, resolve }; });
  return failure();
};
function DraftProbe() { const draft = useComposeDraft(); return <output id="draft-probe">{JSON.stringify(draft)}</output>; }
// 029 A3(切片三):合成仓储读面(acquire entries)——选择器投影的本地事实源;
// 条目 1 的 warehouseItemId 与配方文档既有素材 id 相同,验证「已在本配方」标注。
const acquireEntries = ["synthetic-asset", "whentry-b", "whentry-c", "whentry-d"].map((id, index) => ({
  warehouseItemId: id, folderName: `folder-${id}`,
  displayName: id === "synthetic-asset" ? "Synthetic" : `Entry ${String.fromCharCode(66 + index - 1)}`,
  kind: "imported_material", createdAt: "2026-09-21T00:00:00Z",
  artifactMode: null, effectiveArtifactMode: "use_original_unitypackage", artifacts: [],
}));
const gatewayWithAcquire = { ...gateway, acquire: {
  snapshot: async () => ({ schemaVersion: 1, kind: "entries", entries: acquireEntries }),
  subscribe: () => () => {},
  entryDetail: async () => ({ schemaVersion: 1, kind: "not-found" }),
  capability: async () => ({ state: "unavailable", detailKey: "synthetic" }),
} } as any;
function recipeRoot(g = gatewayWithAcquire) { root.render(<StrictMode><GatewayProvider gateway={g}><RecipePage /><DraftProbe /></GatewayProvider></StrictMode>); }
function pickerPanel() { return document.querySelector(`[aria-label="${strings.recipe.materialPickerTitle}"]`); }
const savedNoteAt = (revision: number) => format(strings.compose.savedNote, { revision: String(revision) });
function settleSave(success = true) {
  if (!pendingSave) throw new Error("No pending save");
  const { document, resolve } = pendingSave; pendingSave = null;
  if (!success) { resolve(failure()); return; }
  const revision = (documents[document.recipeId]?.revision ?? 0) + 1;
  documents[document.recipeId] = { ...document, title: "saved-recipe", revision, updatedAt: "2026-09-21T00:00:00Z",
    assets: document.assets.map((asset: any) => ({ ...asset, label: `asset-rev-${revision}` })) };
  resolve(ok({ recipeId: document.recipeId, revision }));
}
async function openCompose() { await click(strings.nav.pages.composePage); }
async function save() { await click(strings.compose.saveCta); }
async function recipeTests() {
  window.vua = { gateway: { invoke } } as any;
  composeAddItemAction({ warehouseItemId: "synthetic-asset", title: "Synthetic", role: "avatar_base", nameHint: "Avatar" });
  recipeRoot(); await wait(); await wait();
  // 029 A1(切片三):主路径「创建」入口升格——词面用「创建」(U16 原文),
  // 打开的仍是同一搭配草稿弹窗(草稿弹窗保留为创建起点之一,一保存链)
  await click(strings.recipe.createCta);
  check(document.querySelector(`[aria-label="${strings.nav.pages.composePage}"]`) !== null, "creation entry opens the same compose draft dialog (029 A1)");
  await save();
  check(!!pendingSave, "first save submitted");
  await key("Escape"); const before = listCalls; settleSave(); await wait(); await wait();
  check(listCalls > before && !!document.querySelector(".vua-recipe-library strong"), "success after dialog close refreshes list");
  (document.querySelector(".vua-recipe-library li button") as HTMLElement).click(); await wait();
  check(document.querySelector(".vua-recipe-library")?.textContent?.includes("asset-rev-1"), "selected persisted document loads details");
  await openCompose(); await save();
  check(document.querySelectorAll('[role="dialog"]').length === 2, "real duplicate save opens nested confirmation");
  await key("Escape"); check(document.querySelectorAll('[role="dialog"]').length === 1 && !pendingSave, "duplicate Esc cancels only confirmation");
  await save(); const confirm = document.querySelector(".vua-confirm-dialog__actions button:last-child") as HTMLElement;
  confirm.click(); await wait(); const getsBefore = getCalls; settleSave(); await wait(); await wait();
  check(getCalls > getsBefore, "new revision refetches selected details");
  await key("Escape");
  check(document.querySelector(".vua-recipe-library")?.textContent?.includes("asset-rev-2"), "new revision displayed");
  const closedCalls = listCalls; await openCompose(); await key("Escape");
  check(listCalls === closedCalls, "closing alone does not invalidate");
  composeSetNameHintAction("synthetic-asset", "changed"); await openCompose(); await save();
  const failedCalls = listCalls; settleSave(false); await wait();
  check(listCalls === failedCalls, "failed save does not invalidate");
  await save(); composeSetNameHintAction("synthetic-asset", "edited while saving"); settleSave(); await wait(); await key("Escape");
  check(JSON.parse(document.getElementById("draft-probe")!.textContent!).dirty, "in-flight draft edits stay dirty");
  holdList = true; holdGet = true; await click(strings.recipe.libraryReload); await wait();
  const id = Object.keys(documents)[0]!;
  documents[id] = { ...documents[id], revision: 4, title: "newest-recipe", assets: [{ id: "synthetic-asset", role: "avatar_base", label: "newest-detail" }] };
  recipePersisted(); await wait(); await wait();
  delayed.forEach((resolve) => resolve()); delayed = []; await wait();
  const library = document.querySelector(".vua-recipe-library")!.textContent!;
  check(library.includes("newest-recipe") && library.includes("newest-detail") && !library.includes("asset-rev-3"), "old list and detail requests cannot overwrite latest reads");
}

async function recipeEditTests() {
  // 029 A2/A3(切片三):选中态添加素材——平行文档编辑链、同一保存链形状
  // 同一守卫集(baseRevision 版本链＋忙碌守卫＋D5 查重＋回执分类);选择器
  // 系仓储读面投影,不立第三导入入口;云端缺席如实(未决项 3 = #46)。
  recipeRoot(); await wait(); await wait();
  (document.querySelector(".vua-recipe-library li button") as HTMLElement).click(); await wait(); await wait();
  // 选择器:诚实投影(本地条目;既有素材标注;无导入词面)
  await click(strings.recipe.addMaterialCta);
  const picker = pickerPanel();
  check(picker !== null, "add-assets action opens the warehouse read-face picker");
  check(picker!.textContent!.includes(strings.warehouse.selector.localOnlyNote), "picker carries the local-only honest scope note (cloud absent pending #46)");
  check(!picker!.textContent!.includes(strings.warehouse.acquire.importTitle) && !picker!.textContent!.includes(strings.warehouse.acquire.importPick), "picker hosts no third import entry");
  check(picker!.textContent!.includes(strings.warehouse.selector.addedBadge), "entry already in the recipe is honestly badged");
  check([...picker!.querySelectorAll("button")].filter((node) => node.textContent?.trim() === strings.warehouse.selector.pickCta).length === acquireEntries.length - 1, "only entries not yet in the recipe offer the add action");
  // 挑选 → 待保存新增(未保存不冒充已保存)
  await click(strings.warehouse.selector.pickCta, picker!);
  check(document.body.textContent!.includes("Entry B"), "picked entry appears as a pending addition");
  check(document.body.textContent!.includes(strings.recipe.editDirtyNote), "pending additions carry the unsaved honesty note");
  check(!document.body.textContent!.includes(savedNoteAt(5)), "no saved note before a receipt");
  await key("Escape"); await wait();
  check(pickerPanel() === null && document.body.textContent!.includes("Entry B"), "pending addition survives picker close");
  // 同一保存链:recipe.save + baseRevision 版本链 + 忙碌守卫 + 透明合并
  await click(strings.recipe.saveEditCta);
  check(!!pendingSave, "document edit save rides the same recipe.save chain");
  check(pendingSave.document.baseRevision === 4 && pendingSave.document.assets.length === 2, "save carries baseRevision 4 and the merged asset set");
  check(pendingSave.document.title === "newest-recipe", "merge preserves the saved title (no silent rewrite)");
  check(pendingSave.document.instances[1].entrypoint.nameHint === "Entry B", "mount name derives from the entry display name (D3 same rule)");
  check(button(strings.recipe.savingEditCta).disabled, "busy guard disables save while a submission is in flight");
  const samePending = pendingSave;
  await click(strings.recipe.savingEditCta);
  check(pendingSave === samePending, "no double submission while in flight");
  settleSave(); await wait(); await wait();
  check(document.body.textContent!.includes(savedNoteAt(5)), "saved note only after the receipt (revision 5)");
  check(document.querySelector(".vua-recipe-library")!.textContent!.includes("asset-rev-5"), "selected details refetch the saved revision");
  check(!document.body.textContent!.includes(strings.recipe.editDirtyNote), "receipt clears pending additions");
  // 失败如实:待保存新增保留、可显式重试
  await click(strings.recipe.addMaterialCta); await wait();
  await click(strings.warehouse.selector.pickCta, pickerPanel()!); await wait();
  await key("Escape"); await wait();
  await click(strings.recipe.saveEditCta);
  check(!!pendingSave && pendingSave.document.assets.length === 3, "second addition merges onto revision 5");
  settleSave(false); await wait();
  check(document.body.textContent!.includes(strings.recipe.editFailedNote), "failed save is presented as a failure");
  check(document.body.textContent!.includes("Entry C") && document.body.textContent!.includes(strings.recipe.editDirtyNote), "failed save keeps pending additions (retry stays explicit)");
  await click(strings.recipe.saveEditCta);
  settleSave(); await wait(); await wait();
  check(document.body.textContent!.includes(savedNoteAt(6)), "explicit retry succeeds (revision 6)");
  // D5 同一守卫:文档编辑路径查重命中 → 确认框 → 用户确认才提交
  await click(strings.recipe.addMaterialCta); await wait();
  await click(strings.warehouse.selector.pickCta, pickerPanel()!); await wait();
  await key("Escape"); await wait();
  await click(strings.recipe.saveEditCta);
  check(!!pendingSave, "third addition submits for dedup comparison");
  const mergedDoc = pendingSave.document;
  settleSave(false); await wait();
  documents["twin-recipe"] = { ...structuredClone(mergedDoc), recipeId: "twin-recipe", revision: 1, title: "twin" };
  await click(strings.recipe.saveEditCta);
  check(document.body.textContent!.includes(strings.compose.dedupTitle), "identical content opens the same D5 confirmation on the document path");
  check(!pendingSave, "dedup hit holds the submission until the user confirms");
  (document.querySelector(".vua-confirm-dialog__actions button:last-child") as HTMLElement).click(); await wait();
  check(!!pendingSave, "user confirmation submits the new revision");
  settleSave(); await wait(); await wait();
  check(document.body.textContent!.includes(savedNoteAt(7)), "confirmed dedup save lands (revision 7)");
  // 读面未接入:选择器诚实缺席(A3)
  root.render(<StrictMode><GatewayProvider gateway={gateway}><RecipePage /><DraftProbe /></GatewayProvider></StrictMode>);
  await wait(); await wait();
  (document.querySelector(".vua-recipe-library li button") as HTMLElement).click(); await wait(); await wait();
  await click(strings.recipe.addMaterialCta); await wait();
  const offlinePicker = pickerPanel();
  check(offlinePicker !== null && offlinePicker!.textContent!.includes(strings.warehouse.acquire.states.notConnectedTitle), "picker renders the honest not-connected state when the read face is absent");
  check([...offlinePicker!.querySelectorAll("button")].every((node) => node.textContent?.trim() !== strings.warehouse.selector.pickCta), "not-connected picker offers no add actions");
  await key("Escape"); await wait();
  root.render(<div>edit-done</div>); await wait();
}

async function recipeExportTests() {
  // 029 B 面环 4(桌面消费):从工程导出配方草稿——拾取段限定 VUA 已注册
  // 工程集(不开放任意路径输入;陈旧登记如实标注禁用);确认段草稿六事实键
  // 如实呈现(缺失维度清单照单——不宣称还原设计意图);转正 = 用户显式补全
  // 后走既有 recipe.save 保存链(同一守卫集;草稿绝不静默转正)。
  // 先钉读面缺席臂:empty 网关的 projectOps 诚实不可用 → 拾取段诚实空态。
  root.render(<StrictMode><GatewayProvider gateway={gateway}><RecipePage /></GatewayProvider></StrictMode>);
  await wait(); await wait();
  await click(strings.recipe.exportCta);
  const absentDialog = document.querySelector(`[aria-label="${strings.recipe.exportDialogTitle}"]`);
  check(absentDialog !== null && absentDialog!.textContent!.includes(strings.recipe.exportPickUnavailable), "pick stage renders the honest unavailable state when the registry read face is absent");
  await key("Escape"); await wait();

  const exportProjects = [
    { path: "C:/demo", name: "Demo Avatar", pathPresent: true, unityVersion: "2022.3.22f1" },
    { path: "C:/stale", name: "Stale Project", pathPresent: false, unityVersion: null },
  ];
  const exportDraft = {
    schemaVersion: "vua.recipe-export/v0.1",
    draftId: "01900000-0000-7000-8000-000000000001",
    exportedAt: "2026-09-22T04:30:00Z",
    origin: { projectPath: "C:/demo", projectName: "Demo Avatar", vuaIdentityStatus: "present" },
    environment: { unityVersionConstraint: null },
    dependencies: [
      { packageId: "com.vrchat.avatars", versionConstraint: "3.7.x", lockedVersion: "3.7.0" },
      { packageId: "com.animals.box", versionConstraint: "1.2.3" },
    ],
    missing: ["assets", "instances", "relations", "wardrobeGroups", "targetAvatar", "assetRoles", "assetLabels", "sourceRefs", "titleSemantics", "environmentUnityVersion"],
  };
  const gatewayWithProjects = { ...gatewayWithAcquire,
    projectOps: {
      listProjects: async () => ({ ok: true, projects: exportProjects, unreadable: 0 }),
      importCopy: async () => ({ ok: false, error: { kind: "unavailable" } }),
      setNote: async () => ({ ok: false, error: { kind: "unavailable" } }),
    },
    recipeExport: {
      exportProjectDraft: async (projectPath: string) => projectPath === "C:/demo"
        ? { ok: true, draft: exportDraft }
        : { ok: false, error: { kind: "request_rejected" } },
    },
  } as any;
  recipeRoot(gatewayWithProjects); await wait(); await wait();
  await click(strings.recipe.exportCta);
  const dialog = () => document.querySelector(`[aria-label="${strings.recipe.exportDialogTitle}"]`)!;
  check(dialog() !== null && dialog().textContent!.includes(strings.recipe.exportPickTitle), "export entry opens the pick stage over registered projects (029 B4)");
  check(dialog().textContent!.includes("Demo Avatar") && dialog().textContent!.includes("C:/stale"), "registered projects are listed as facts (name and path)");
  const staleButton = [...dialog().querySelectorAll("button")].find((node) => node.textContent?.includes("Stale Project")) as HTMLButtonElement;
  check(staleButton.disabled && dialog().textContent!.includes(strings.recipe.exportStaleBadge), "stale registration is honestly badged and disabled");
  // 拾取 → 导出回执 → 确认段(六事实键)
  ([...dialog().querySelectorAll("button")].find((node) => node.textContent?.includes("Demo Avatar")) as HTMLElement).click();
  await wait();
  check(dialog().textContent!.includes(strings.recipe.exportDraftBadge), "confirm stage presents the project-exported draft badge (never silent promotion)");
  check(dialog().textContent!.includes("com.vrchat.avatars") && dialog().textContent!.includes(format(strings.recipe.exportDepsLocked, { version: "3.7.0" })), "declared dependencies render verbatim with the presentation-only locked pin");
  check(dialog().textContent!.includes(strings.recipe.missingDims.assets) && dialog().textContent!.includes(strings.recipe.missingDims.environmentUnityVersion) && dialog().textContent!.includes(strings.recipe.exportHonestyNote), "missing-dimension list renders as-is with the honesty note (no design-intent claim)");
  check(dialog().textContent!.includes(strings.recipe.exportUnityUnreadable), "unreadable unity version is honestly presented for explicit completion");
  const titleInput = dialog().querySelector(`input[aria-label="${strings.recipe.exportTitleAria}"]`) as HTMLInputElement;
  check(titleInput.value === "Demo Avatar" && dialog().textContent!.includes(strings.recipe.exportTitlePrefillNote), "title prefills from the project name with the labeled source (draft has no title)");
  const saveButton = () => [...dialog().querySelectorAll("button")].find((node) => node.textContent?.trim() === strings.recipe.exportSaveCta) as HTMLButtonElement;
  check(saveButton() !== undefined && saveButton().disabled, "promotion is blocked before completion (title / version / at least one asset)");
  // 素材补全 = 同一仓储读面投影选择器(不立第三导入入口)
  check(dialog().textContent!.includes(strings.warehouse.selector.localOnlyNote), "asset completion rides the same read-face picker with no import wording");
  await click(strings.warehouse.selector.pickCta, dialog());
  check(dialog().textContent!.includes("Synthetic"), "picked asset appears as a pending completion");
  check(saveButton().disabled, "save stays blocked while the unreadable version is uncompleted");
  const versionInput = dialog().querySelector(`input[aria-label="${strings.recipe.exportUnityInputAria}"]`) as HTMLInputElement;
  // React 受控输入:经原型原生 value setter 赋值再冒泡 input 事件,驱动
  // React 合成事件(直接赋 .value 不触发 onChange)
  const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  nativeValueSetter.call(versionInput, "2022.3.22f1");
  versionInput.dispatchEvent(new Event("input", { bubbles: true })); await wait();
  check(!saveButton().disabled, "explicit user completion enables promotion");
  // 转正走既有保存链:recipe.save + baseRevision 0 + 两维 verbatim + 无 locked 块
  await click(strings.recipe.exportSaveCta);
  check(!!pendingSave, "promotion rides the standing recipe.save chain");
  check(pendingSave.document.baseRevision === 0 && pendingSave.document.title === "Demo Avatar", "first save carries baseRevision 0 and the user title");
  check(pendingSave.document.environment.unityVersionConstraint === "2022.3.22f1", "completed unity constraint rides the document verbatim");
  check(JSON.stringify(pendingSave.document.dependencies).includes("com.vrchat.avatars") && !JSON.stringify(pendingSave.document).includes("3.7.0"), "declared dependencies transfer verbatim; locked pins never enter the document (no fabricated locked block)");
  check(button(strings.recipe.savingEditCta).disabled, "busy guard disables promotion while in flight");
  settleSave(false); await wait();
  check(dialog().textContent!.includes(strings.recipe.editFailedNote), "failed promotion is presented as a failure");
  await click(strings.recipe.exportSaveCta);
  settleSave(); await wait(); await wait();
  check(dialog().textContent!.includes(savedNoteAt(1)), "saved note only after the persistence receipt (revision 1)");
  // D5 同一守卫:同一素材集再存 → 同一确认框,用户确认才提交
  await click(strings.recipe.exportSaveCta); await wait();
  check(document.body.textContent!.includes(strings.compose.dedupTitle), "second promotion of an identical asset set opens the same D5 confirmation");
  check(!pendingSave, "dedup hit holds the promotion until the user confirms");
  const listCallsBeforeConfirm = listCalls;
  (document.querySelector(".vua-confirm-dialog__actions button:last-child") as HTMLElement).click(); await wait();
  check(!!pendingSave, "user confirmation submits the promotion");
  settleSave(); await wait(); await wait();
  check(listCalls > listCallsBeforeConfirm, "confirmed dedup promotion lands and refreshes the library (a fresh first save mints its own recipe identity)");
  await key("Escape"); await wait();
  check(document.querySelector(`[aria-label="${strings.recipe.exportDialogTitle}"]`) === null, "closing the export dialog stays user-initiated");
  root.render(<div>export-done</div>); await wait();
}

async function importTests() {
  let listeners = new Set<(event: any) => void>(); let closed = 0, next = 0;
  window.vua = { gateway: { invoke }, capabilities: { remoteBrowser: true }, remoteContent: {
    events: { subscribe: (listener: any) => { listeners.add(listener); return () => listeners.delete(listener); } },
    signInHint: async () => "stored",
    open: async () => { const viewId = `synthetic-${++next}`;
      const state = { viewId, currentUrl: "https://booth.pm/", canGoBack: false, canGoForward: false, loading: false };
      queueMicrotask(() => listeners.forEach((listener) => listener({ kind: "view-opened", viewId, url: state.currentUrl })));
      return state; },
    close: async (viewId: string) => { closed++; listeners.forEach((listener) => listener({ kind: "view-closed", viewId })); },
  } } as any;
  root.render(<StrictMode><GatewayProvider gateway={gateway}><ContentDialog open title="import" closeLabel="close" onClose={() => {}}><ImportPage /></ContentDialog></GatewayProvider></StrictMode>);
  await wait(); await wait();
  // W25 走查缺陷②来源分流(用户裁决 2026-09-23):云端段只在显式选择后
  // 激活——夹具随行先选「云端导入」,原断言语义(工具条不 inert、可点)
  // 不变;signInHint 桩为同批新增(缺陷③b 首导线索面)。
  await click(strings.importPage.chooseCloudCta);
  await wait(); await wait();
  const bar = document.querySelector<HTMLElement>(".vua-import__browse-bar");
  check(bar && bar.closest("[data-vua-browser-frame]")?.parentElement === document.body && !bar.closest("[inert]"), "actual ImportPage body portal toolbar is not inert");
  const close = bar!.querySelector<HTMLButtonElement>(".vua-import__browse-button--close")!;
  close.focus(); check(document.activeElement === close, "actual remote close accepts focus");
  const before = closed; close.click(); await wait(); check(closed > before, "actual remote close remains actionable");
  root.render(<div>finished</div>); await wait(); check(!document.querySelector("[inert]"), "import unmount restores background");
}
async function workshopEmptyTests() {
  // 029 A6 车间执行状态面·无链分支(空网关,零真机服务;置于配方链测试之前,
  // 因链 store 是模块级共享信号,配方测试会写入链身份):车间只作状态显示——
  // 本会话无链身份时诚实空态 + 纯导航 CTA;素材直产链发起面不再寄宿车间页。
  let navigated: string | null = null;
  root.render(
    <StrictMode>
      <GatewayProvider gateway={gateway}>
        <WorkshopPage onNavigate={(target) => { navigated = target; }} />
      </GatewayProvider>
    </StrictMode>,
  );
  await wait(); await wait();
  check(document.body.textContent!.includes(strings.workshop.chain.noChainTitle), "workshop status face renders honest no-chain empty state");
  check(document.querySelector(".vua-flow") === null, "material direct-chain initiation face has left the workshop page");
  const goRecipe = button(strings.workshop.chain.noChainCta);
  goRecipe.click(); await wait();
  check(navigated === "recipe", "no-chain CTA is pure navigation to the recipe page (023 projection discipline)");
  root.render(<div>phase-done</div>); await wait();
}

async function workshopStatusTests() {
  // 029 A6 车间执行状态面·链在场分支(复用配方链测试写入链 store 的会话事实):
  // 计划/执行/记录各卡如实呈现,且零发起动作——批准/执行按钮不出现在状态面。
  let navigated: string | null = null;
  root.render(
    <StrictMode>
      <GatewayProvider gateway={gateway}>
        <WorkshopPage onNavigate={(target) => { navigated = target; }} />
      </GatewayProvider>
    </StrictMode>,
  );
  await wait(); await wait();
  const chainWords = strings.compose.chain;
  const text = document.body.textContent ?? "";
  check(text.includes(strings.workshop.chain.title), "workshop status face renders the execution status cards for the session chain");
  check(text.includes(strings.workshop.chain.resolveIdleNote) && text.includes(strings.workshop.chain.planApprovalNote) && text.includes(strings.workshop.chain.executeIdleNote), "status face presents resolve/plan/execute facts without initiation wording");
  check(document.querySelector(".vua-flow") === null, "chain-present status face still hosts no material direct-chain initiation");
  check(![...document.querySelectorAll("button")].some((node) => node.textContent?.trim() === chainWords.planApproveCta || node.textContent?.trim() === chainWords.executeCta), "status face renders no approve/execute initiation buttons");
  check(navigated === null, "status face navigation stays user-initiated");
  root.render(<div>finished</div>); await wait();
}

window.review = {
  nativeStart: async () => { root.render(<StrictMode><ModalCase /></StrictMode>); await wait();
    document.getElementById("opener")!.focus(); await click("open");
    document.getElementById("inner-opener")!.focus(); await click("inner"); },
  nativeCheck: async (remaining: number) => { await wait();
    check(document.querySelectorAll('[role="dialog"]').length === remaining, `native Esc leaves ${remaining} dialogs`);
    return document.activeElement?.id; },
  run: async () => { await modalTests(); await workshopEmptyTests(); await recipeTests(); await recipeEditTests(); await recipeExportTests(); await workshopStatusTests(); await importTests(); return results; } };

import type { AmfAssemblySelection, AmfProductionBodyV01, AmfSourceChoice, AmfSourceRole, AmfRecipeDocument, AmfSharedRecipe, AmfRecipeApplyChoice,
  AmfRunPhaseV01, AmfStepV01, AmfUsualDurations, AmfRunProgressV01, AmfProductionProgressV01 } from "@vua/contracts";
import { isAmfAssemblySelection, isAmfPreviewPath, isAmfRecipeDocument, isAmfSharedRecipe, decodeAmfRecipeShare, sameAmfRecipeShare,
  AMF_RUN_PHASES, isAmfStep, isAmfUsualDurations, isAmfRunProgress, readAmfProductionProgress } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { registerTaskIdentity } from "./task-identity.ts";
import type { Unsubscribe } from "./types.ts";
import { strings } from "../i18n/index.ts";

export interface AmfProductionSource { readonly sourceId: string; readonly itemId: string; readonly itemName: string; readonly name: string }
export interface AmfProductionEditor { readonly path: string; readonly version: string }
export interface AmfPrefab {
  readonly sourceId: string; readonly path: string; readonly name: string; readonly isAvatar: boolean;
  readonly hasSkinnedMesh: boolean; readonly hasMergeArmature: boolean; readonly hasMissingScripts: boolean; readonly humanoidBones: readonly string[];
  /** Work-project-relative PNG rendered for this candidate; read it with `previewImage`. */
  readonly preview?: string;
}
export interface AmfPreviewImage { readonly view: "front" | "side" | "back"; readonly path: string }
export type AmfRunPhase = AmfRunPhaseV01;
export type { AmfStepV01 as AmfStep, AmfUsualDurations, AmfRunProgressV01 as AmfRunProgress, AmfProductionProgressV01 as AmfProductionProgress } from "@vua/contracts";
export interface AmfProductionRun {
  readonly schemaVersion: "0.1"; readonly runId: string; readonly phase: AmfRunPhase; readonly taskId: string;
  readonly editor: AmfProductionEditor; readonly projectRoot: string; readonly choices: readonly AmfSourceChoice[];
  readonly sources: readonly { readonly sourceId: string; readonly role: AmfSourceRole; readonly itemName: string; readonly name: string; readonly sha256: string }[];
  readonly prefabs: readonly AmfPrefab[];
  /** Steps with their times; an unfinished step of work that no longer runs reads `interrupted`. */
  readonly steps: readonly AmfStepV01[];
  /** Median seconds of each step kind on this computer. `amf.production.get` always reports it. */
  readonly usualDurations?: AmfUsualDurations;
  /** The running step while a task works on the run, otherwise `null`. `amf.production.get` always reports it. */
  readonly progress?: AmfRunProgressV01 | null;
  readonly selection: AmfAssemblySelection | null; readonly error: string | null; readonly recovery: string | null;
  readonly snapshotId: string | null;
  /** When assembly finished the Avatar. */
  readonly completedAt?: string | null;
  readonly result: { readonly facts?: { readonly sdkDescriptorRecognized: boolean; readonly missingReferences: number; readonly avatarName: string | null;
    readonly instances: readonly { readonly sourceId: string; readonly bindingVerified: boolean; readonly menuVerified: boolean; readonly menuModified?: boolean }[];
    readonly observedSelection?: AmfAssemblySelection | null; readonly hasMissingScripts?: boolean;
    readonly missingShaderMaterials?: readonly string[]; readonly sdkSignedIn?: "yes" | "no" | "unknown";
    readonly previews?: readonly AmfPreviewImage[]; readonly sdkReview?: AmfSdkReview };
    readonly diagnostics?: readonly { readonly code: string; readonly severity: string; readonly message: string }[] } | null;
}
/** VRChat SDK performance ratings, best first. */
export const AMF_SDK_RATINGS = ["Excellent", "Good", "Medium", "Poor", "VeryPoor"] as const;
export type AmfSdkRating = (typeof AMF_SDK_RATINGS)[number];
/** One item of the SDK panel's own Avatar checks, in the SDK's words. */
export interface AmfSdkIssue { readonly level: "error" | "warning" | "info"; readonly text: string; readonly canFix: boolean }
/** One performance category the SDK rated, e.g. `PolyCount`, with the SDK's own line. */
export interface AmfSdkStat { readonly category: string; readonly rating: AmfSdkRating; readonly text: string }
/** The SDK panel's checks and performance estimate, read by the Bridge without opening the panel. */
export interface AmfSdkReview {
  readonly state: "checked" | "partial" | "unavailable" | "not_run";
  readonly platform: "pc" | "android" | "";
  readonly overall: AmfSdkRating | "None" | "";
  readonly issues: readonly AmfSdkIssue[];
  readonly stats: readonly AmfSdkStat[];
  readonly detail: string;
}
export interface AmfProductionList {
  readonly sources: readonly AmfProductionSource[]; readonly editors: readonly AmfProductionEditor[]; readonly busy: boolean;
  readonly runs: readonly { readonly runId: string; readonly phase: AmfRunPhase; readonly sourceNames: readonly string[] }[];
}
export interface AmfProductionPlan {
  readonly runId: string; readonly planDigest: string; readonly selection: AmfAssemblySelection;
  readonly inputs: readonly { readonly sourceId: string; readonly name: string; readonly role: "avatar" | "outfit" | "import_only" }[];
}
export interface AmfProductionAccepted { readonly runId: string; readonly taskId: string }
export interface AmfSavedRecipe { readonly recipe: AmfRecipeDocument; readonly revision: number; readonly updatedAt: string }
export interface AmfRecipeSummary { readonly recipeId: string; readonly title: string; readonly revision: number; readonly updatedAt: string }
export interface AmfProductionRestorePlan {
  readonly runId: string; readonly planDigest: string; readonly snapshotId: string;
  readonly projectRoot: string; readonly currentChanged: boolean; readonly preserveCurrent: true;
}
export interface AmfRecipeSharePlan {
  readonly recipeId: string; readonly title: string; readonly revision: number; readonly planDigest: string;
  readonly materials: readonly { readonly materialId: string; readonly packageName: string; readonly candidates: readonly string[]; readonly selectedProductId: string | null }[];
}
export interface AmfRecipeShareExport { readonly shareCode: string; readonly fileText: string; readonly document: AmfSharedRecipe }
export interface AmfRecipeApplyPlan {
  readonly runId: string; readonly recipeId: string; readonly title: string; readonly avatarName: string;
  readonly avatarGlobalObjectId: string; readonly planDigest: string; readonly retainedOutfits: number; readonly overlayBlocker: string | null;
  readonly conflicts: readonly { readonly sourceId: string; readonly packageName: string; readonly field: "mode" | "bone" | "toggleName" | "active"; readonly current: string | boolean; readonly incoming: string | boolean }[];
  readonly recipeSelection: AmfAssemblySelection; readonly currentSelection: AmfAssemblySelection;
  readonly targets: readonly { readonly globalObjectId: string; readonly name: string; readonly verified: boolean }[];
}
export interface AmfProductionPort {
  recipeApplyPlan(runId: string, recipeId: string, avatarGlobalObjectId?: string): Promise<AmfRecipeApplyPlan>;
  applyRecipe(plan: AmfRecipeApplyPlan, choice: AmfRecipeApplyChoice): Promise<AmfProductionAccepted>;
  recipeSharePlan(recipeId: string): Promise<AmfRecipeSharePlan>;
  exportRecipe(recipeId: string, planDigest: string, sources: Readonly<Record<string,string>>): Promise<AmfRecipeShareExport>;
  previewRecipeShare(text: string): Promise<AmfSharedRecipe>;
  importRecipe(text: string): Promise<AmfSavedRecipe>;
  listRecipes(): Promise<readonly AmfRecipeSummary[]>;
  getRecipe(recipeId: string): Promise<AmfSavedRecipe>;
  saveRecipe(runId: string, title: string): Promise<AmfSavedRecipe>;
  prepareRecipe(recipeId: string, editorPath: string): Promise<AmfProductionAccepted>;
  list(): Promise<AmfProductionList>;
  get(runId: string): Promise<AmfProductionRun>;
  prepare(sources: readonly AmfSourceChoice[], editorPath: string): Promise<AmfProductionAccepted>;
  plan(runId: string, selection: AmfAssemblySelection): Promise<AmfProductionPlan>;
  assemble(runId: string, plan: AmfProductionPlan): Promise<AmfProductionAccepted>;
  reinspect(runId: string): Promise<AmfProductionAccepted>;
  rollbackPlan(runId: string): Promise<AmfProductionRestorePlan>;
  rollback(runId: string, plan: AmfProductionRestorePlan): Promise<AmfProductionAccepted>;
  open(runId: string): Promise<AmfProductionAccepted>;
  /** A `data:image/png` URL for one preview the run reports. */
  previewImage(runId: string, path: string): Promise<string>;
  /** Stop: VUA ends Unity and keeps the work project and its materials; the run becomes `stopped`.
   * Continue with `reinspect`. Work between Unity steps stops at the next step boundary. */
  stop(run: Pick<AmfProductionRun, "taskId">): Promise<void>;
  /** Live progress of every AMF production task, read from task progress events. */
  onProgress(listener: (progress: AmfProductionProgressV01) => void): Unsubscribe;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const phases: readonly string[] = AMF_RUN_PHASES;
const roles = ["auto", "avatar", "outfit", "dependency"];
const savedRecipe = (v: unknown): v is AmfSavedRecipe => record(v) && isAmfRecipeDocument(v.recipe) && Number.isSafeInteger(v.revision) && Number(v.revision) > 0 && text(v.updatedAt);
const choice = (v: unknown) => record(v) && text(v.sourceId) && roles.includes(String(v.role));
const editor = (v: unknown): v is AmfProductionEditor => record(v) && text(v.path) && (v.version === "2022.3.22f1" || v.version === "2022.3.22f1c1");
const source = (v: unknown): v is AmfProductionSource => record(v) && [v.sourceId, v.itemId, v.itemName, v.name].every(text);
const prefab = (v: unknown): v is AmfPrefab => record(v) && [v.sourceId, v.path, v.name].every(text)
  && [v.isAvatar, v.hasSkinnedMesh, v.hasMergeArmature, v.hasMissingScripts].every(p => typeof p === "boolean") && texts(v.humanoidBones)
  && (v.preview === undefined || isAmfPreviewPath(v.preview));
const ratings: readonly string[] = AMF_SDK_RATINGS;
export function isAmfSdkReview(v: unknown): v is AmfSdkReview {
  return record(v) && ["checked", "partial", "unavailable", "not_run"].includes(String(v.state))
    && ["pc", "android", ""].includes(String(v.platform)) && (v.overall === "" || v.overall === "None" || ratings.includes(String(v.overall)))
    && text(v.detail) && Array.isArray(v.issues) && v.issues.length <= 64
    && v.issues.every(i => record(i) && ["error", "warning", "info"].includes(String(i.level)) && text(i.text) && typeof i.canFix === "boolean")
    && Array.isArray(v.stats) && v.stats.length <= 64
    && v.stats.every(stat => record(stat) && text(stat.category) && ratings.includes(String(stat.rating)) && text(stat.text));
}
function result(v: unknown): boolean {
  if (v === null) return true;
  if (!record(v)) return false;
  const facts = v.facts;
  return (facts === undefined || (record(facts) && typeof facts.sdkDescriptorRecognized === "boolean"
    && typeof facts.missingReferences === "number" && Number.isInteger(facts.missingReferences) && facts.missingReferences >= 0
    && (facts.avatarName === null || text(facts.avatarName)) && Array.isArray(facts.instances)
    && (facts.observedSelection === undefined || facts.observedSelection === null || isAmfAssemblySelection(facts.observedSelection))
    && (facts.hasMissingScripts === undefined || typeof facts.hasMissingScripts === "boolean")
    && (facts.missingShaderMaterials === undefined || texts(facts.missingShaderMaterials))
    && (facts.sdkSignedIn === undefined || ["yes","no","unknown"].includes(String(facts.sdkSignedIn)))
    && (facts.sdkReview === undefined || isAmfSdkReview(facts.sdkReview))
    && (facts.previews === undefined || (Array.isArray(facts.previews) && facts.previews.length <= 3 && facts.previews.every(p => record(p) && ["front","side","back"].includes(String(p.view)) && isAmfPreviewPath(p.path))))
    && facts.instances.every(i => record(i) && text(i.sourceId) && typeof i.bindingVerified === "boolean" && typeof i.menuVerified === "boolean"
      && (i.menuModified === undefined || typeof i.menuModified === "boolean"))))
    && (v.diagnostics === undefined || (Array.isArray(v.diagnostics) && v.diagnostics.every(d => record(d) && text(d.code) && text(d.message) && ["info","warning","error"].includes(String(d.severity)))));
}
export function isAmfProductionRun(v: unknown): v is AmfProductionRun {
  return record(v) && v.schemaVersion === "0.1" && text(v.runId) && typeof v.phase === "string" && phases.includes(v.phase) && text(v.taskId) && editor(v.editor) && text(v.projectRoot)
    && Array.isArray(v.choices) && v.choices.every(choice) && Array.isArray(v.sources) && v.sources.every(s => choice(s) && record(s) && [s.itemName, s.name, s.sha256].every(text))
    && Array.isArray(v.prefabs) && v.prefabs.every(prefab) && Array.isArray(v.steps) && v.steps.every(isAmfStep)
    && (v.usualDurations === undefined || isAmfUsualDurations(v.usualDurations))
    && (v.progress === undefined || v.progress === null || isAmfRunProgress(v.progress))
    && (v.error === null || text(v.error)) && (v.recovery === null || text(v.recovery))
    && (v.snapshotId === null || (text(v.snapshotId) && v.snapshotId.length > 0))
    && (v.selection === null || isAmfAssemblySelection(v.selection)) && result(v.result);
}
export function createAmfProductionPort(client: GatewayClient): AmfProductionPort {
  const call = async (body: AmfProductionBodyV01): Promise<unknown> => {
    const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), ...body });
    if (!response.ok) {
      const error = response.error;
      if (error.kind === "application") throw new Error(typeof error.error.params?.detail === "string" ? error.error.params.detail : error.error.code);
      throw new Error(error.kind);
    }
    return response.value;
  };
  const accepted = (value: unknown, title: string): AmfProductionAccepted => {
    if (!record(value) || value.schemaVersion !== "0.1" || !text(value.runId) || !text(value.taskId) || !value.taskId) throw new Error("amf_production_receipt_invalid");
    registerTaskIdentity(value.taskId, { title, originPage: "workshop", notifyOnComplete: true });
    return { runId: value.runId, taskId: value.taskId };
  };
  return {
    async recipeApplyPlan(runId, recipeId, avatarGlobalObjectId) {
      const v = await call({method:"amf.production.recipeApplyPlan", params:{schemaVersion:"0.1", runId, recipeId, ...(avatarGlobalObjectId !== undefined ? {avatarGlobalObjectId} : {})}});
      const p = record(v) && v.schemaVersion === "0.1" ? v.plan : null;
      if (!record(p) || p.runId !== runId || p.recipeId !== recipeId || !text(p.title) || !text(p.avatarName) || !text(p.avatarGlobalObjectId) || !p.avatarGlobalObjectId
        || !text(p.planDigest) || !/^[a-f0-9]{64}$/u.test(p.planDigest) || !Number.isSafeInteger(p.retainedOutfits) || Number(p.retainedOutfits) < 0 || Number(p.retainedOutfits) > 64
        || (p.overlayBlocker !== null && !text(p.overlayBlocker)) || !isAmfAssemblySelection(p.recipeSelection) || !isAmfAssemblySelection(p.currentSelection)
        || !Array.isArray(p.conflicts) || p.conflicts.length > 256 || !p.conflicts.every(c => record(c) && text(c.sourceId) && text(c.packageName)
          && ["mode","bone","toggleName","active"].includes(String(c.field)) && (c.field === "active" ? typeof c.current === "boolean" && typeof c.incoming === "boolean" : text(c.current) && text(c.incoming)))) throw new Error("amf_recipe_apply_plan_invalid");
      if (!Array.isArray(p.targets) || p.targets.length < 1 || p.targets.length > 64
        || !p.targets.every(t => record(t) && text(t.globalObjectId) && t.globalObjectId.length > 0 && t.globalObjectId.length <= 256 && text(t.name) && typeof t.verified === "boolean")
        || new Set(p.targets.map(t=>t.globalObjectId)).size !== p.targets.length
        || !p.targets.some(t=>t.globalObjectId === p.avatarGlobalObjectId && t.verified)
        || (avatarGlobalObjectId !== undefined && avatarGlobalObjectId !== p.avatarGlobalObjectId)) throw new Error("amf_recipe_apply_plan_invalid");
      return p as unknown as AmfRecipeApplyPlan;
    },
    async applyRecipe(plan, choice) {
      return accepted(await call({method:"amf.production.applyRecipe",params:{schemaVersion:"0.1",runId:plan.runId,recipeId:plan.recipeId,planDigest:plan.planDigest,choice,avatarGlobalObjectId:plan.avatarGlobalObjectId}}),strings.amfProduction.assembling);
    },
    async recipeSharePlan(recipeId) {
      const v = await call({ method: "amf.production.recipeSharePlan", params: {schemaVersion:"0.1",recipeId} });
      const plan = record(v) && v.schemaVersion === "0.1" ? v.plan : null;
      const booth = (id: unknown): id is string => text(id) && /^[1-9][0-9]{0,19}$/u.test(id);
      if (!record(plan) || plan.recipeId !== recipeId || !text(plan.title) || !Number.isSafeInteger(plan.revision) || Number(plan.revision) < 1
        || !text(plan.planDigest) || !/^[a-f0-9]{64}$/u.test(plan.planDigest) || !Array.isArray(plan.materials) || plan.materials.length < 1 || plan.materials.length > 64
        || !plan.materials.every(m => record(m) && text(m.materialId) && /^m-[a-f0-9]{64}$/u.test(m.materialId) && text(m.packageName) && Array.isArray(m.candidates) && m.candidates.every(booth) && (m.selectedProductId === null || booth(m.selectedProductId)))
        || new Set(plan.materials.map(m=>m.materialId)).size !== plan.materials.length) throw new Error("amf_recipe_share_plan_invalid");
      return plan as unknown as AmfRecipeSharePlan;
    },
    async exportRecipe(recipeId, planDigest, sources) {
      const v = await call({ method:"amf.production.exportRecipe", params:{schemaVersion:"0.1",recipeId,planDigest,sources} });
      const result = record(v) && v.schemaVersion === "0.1" ? v.export : null;
      if (!record(result) || !text(result.shareCode) || !result.shareCode.startsWith("vuar0.4.") || result.shareCode.length > 349557 || !text(result.fileText)
        || new TextEncoder().encode(result.fileText).length > 262144 || !isAmfSharedRecipe(result.document) || result.document.recipe.recipeId !== recipeId) throw new Error("amf_recipe_share_invalid");
      const file = decodeAmfRecipeShare(result.fileText); const code = decodeAmfRecipeShare(result.shareCode);
      if (!file || !code || !sameAmfRecipeShare(file,result.document) || !sameAmfRecipeShare(code,result.document)) throw new Error("amf_recipe_share_invalid");
      return result as unknown as AmfRecipeShareExport;
    },
    async previewRecipeShare(text) {
      const v = await call({method:"amf.production.previewRecipeShare",params:{schemaVersion:"0.1",text}});
      if (!record(v) || v.schemaVersion !== "0.1" || !isAmfSharedRecipe(v.document)) throw new Error("amf_recipe_share_invalid");
      return v.document;
    },
    async importRecipe(text) {
      const v = await call({method:"amf.production.importRecipe",params:{schemaVersion:"0.1",text}});
      if (!record(v) || v.schemaVersion !== "0.1" || !savedRecipe(v.document)) throw new Error("amf_recipe_document_invalid");
      return v.document;
    },
    async listRecipes() {
      const v = await call({ method: "amf.production.listRecipes", params: { schemaVersion: "0.1" } });
      if (!record(v) || v.schemaVersion !== "0.1" || !Array.isArray(v.recipes) || !v.recipes.every(r => record(r) && text(r.recipeId) && text(r.title) && text(r.updatedAt) && Number.isSafeInteger(r.revision) && Number(r.revision) > 0)) throw new Error("amf_recipe_list_invalid");
      return v.recipes as unknown as readonly AmfRecipeSummary[];
    },
    async getRecipe(recipeId) {
      const v = await call({ method: "amf.production.getRecipe", params: { schemaVersion: "0.1", recipeId } });
      if (!record(v) || v.schemaVersion !== "0.1" || !savedRecipe(v.document) || v.document.recipe.recipeId !== recipeId) throw new Error("amf_recipe_document_invalid");
      return v.document;
    },
    async saveRecipe(runId, title) {
      const v = await call({ method: "amf.production.saveRecipe", params: { schemaVersion: "0.1", runId, title } });
      if (!record(v) || v.schemaVersion !== "0.1" || !savedRecipe(v.document)) throw new Error("amf_recipe_document_invalid");
      return v.document;
    },
    async prepareRecipe(recipeId, editorPath) { return accepted(await call({ method: "amf.production.prepareRecipe", params: { schemaVersion: "0.1", recipeId, editorPath } }), strings.amfProduction.preparing); },
    async list() {
      const v = await call({ method: "amf.production.list", params: { schemaVersion: "0.1" } });
      if (!record(v) || v.schemaVersion !== "0.1" || !Array.isArray(v.sources) || !v.sources.every(source) || !Array.isArray(v.editors) || !v.editors.every(editor)
        || typeof v.busy !== "boolean" || !Array.isArray(v.runs) || !v.runs.every(r => record(r) && text(r.runId) && typeof r.phase === "string" && phases.includes(r.phase) && texts(r.sourceNames))) throw new Error("amf_production_list_invalid");
      return v as unknown as AmfProductionList;
    },
    async get(runId) { const v = await call({ method: "amf.production.get", params: { schemaVersion: "0.1", runId } }); if (!isAmfProductionRun(v) || v.runId !== runId) throw new Error("amf_production_run_invalid"); return v; },
    async prepare(sources, editorPath) { return accepted(await call({ method: "amf.production.prepare", params: { schemaVersion: "0.1", sources, editorPath } }), strings.amfProduction.preparing); },
    async plan(runId, selection) {
      const v = await call({ method: "amf.production.plan", params: { schemaVersion: "0.1", runId, selection } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || typeof v.planDigest !== "string" || !/^[a-f0-9]{64}$/u.test(v.planDigest) || !Array.isArray(v.inputs)
        || !isAmfAssemblySelection(v.selection) || v.preserveOriginals !== true || v.officialSdkChecks !== "not_run" || !editor(v.editor) || !text(v.projectRoot)
        || !v.inputs.every(i => record(i) && text(i.sourceId) && text(i.name) && ["avatar", "outfit", "import_only"].includes(String(i.role)))) throw new Error("amf_production_plan_invalid");
      return v as unknown as AmfProductionPlan;
    },
    async assemble(runId, plan) { return accepted(await call({ method: "amf.production.assemble", params: { schemaVersion: "0.1", runId, planDigest: plan.planDigest, selection: plan.selection } }), strings.amfProduction.assembling); },
    async reinspect(runId) { return accepted(await call({ method: "amf.production.reinspect", params: { schemaVersion: "0.1", runId } }), strings.amfProduction.reinspect); },
    async rollbackPlan(runId) {
      const v = await call({ method: "amf.production.rollbackPlan", params: { schemaVersion: "0.1", runId } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || !text(v.planDigest) || !/^[a-f0-9]{64}$/u.test(v.planDigest)
        || !text(v.snapshotId) || !v.snapshotId || !text(v.projectRoot) || typeof v.currentChanged !== "boolean" || v.preserveCurrent !== true) throw new Error("amf_production_restore_plan_invalid");
      return v as unknown as AmfProductionRestorePlan;
    },
    async rollback(runId, plan) {
      if (plan.runId !== runId) throw new Error("amf_production_restore_plan_invalid");
      return accepted(await call({ method: "amf.production.rollback", params: { schemaVersion: "0.1", runId, planDigest: plan.planDigest } }), strings.amfProduction.restoring);
    },
    async previewImage(runId, path) {
      const v = await call({ method: "amf.production.previewImage", params: { schemaVersion: "0.1", runId, path } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || v.path !== path || v.mediaType !== "image/png"
        || !text(v.data) || v.data.length > 900_000 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/u.test(v.data)) throw new Error("amf_production_preview_invalid");
      return `data:image/png;base64,${v.data}`;
    },
    async open(runId) { return accepted(await call({ method: "amf.production.open", params: { schemaVersion: "0.1", runId } }), strings.amfProduction.opening); },
    async stop(run) {
      if (!text(run.taskId) || run.taskId.length === 0) throw new Error("amf_production_not_running");
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "task.requestCancellation", params: { taskId: run.taskId, commandId: crypto.randomUUID() } });
      if (!response.ok) throw new Error(response.error.kind === "application" ? response.error.error.code : response.error.kind);
    },
    onProgress(listener) {
      return client.subscribe(event => {
        if (event.kind !== "task.progressed") return;
        const progress = readAmfProductionProgress(event.payload);
        if (progress !== null) listener(progress);
      });
    },
  };
}

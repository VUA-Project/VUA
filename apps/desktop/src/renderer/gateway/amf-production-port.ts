import type { AmfMaterialChoices, AmfRecipeMaterialPlan, AmfRecipeMaterialResolution, AmfRecipeDifference } from "@vua/contracts";
import { hasValidAmfRecipeReview, isAmfRecipeMaterialPlan, isAmfRecipeMaterials, isAmfMaterialChoices } from "@vua/contracts";
import type { AmfTextureMemoryPlan, TexturePlatform, TextureTargetRank, TextureMemoryReport } from "@vua/contracts";
import { isTextureMemoryFacts, isAmfTextureMemoryPlan } from "@vua/contracts";
import type { OutfitRemoval, OutfitRemovalApplied, OutfitRemovalPlan, AmfEditorCloseResult, FaceTrackingFactsV01, FaceTrackingPlanV01, AmfAssemblySelection, AmfProductionBodyV01, AmfSourceChoice, AmfSourceRole, AmfRecipeDocument, AmfSharedRecipe, AmfRecipeApplyChoice,
  AmfRunPhaseV01, AmfStepV01, AmfUsualDurations, AmfRunProgressV01, AmfProductionProgressV01, AmfProductionCapacity, AmfProductionWorkV01, AmfProductionLaneV01,
  AmfLightingEntry, AmfLightingLimits, AmfLightingReferenceReason, AmfLightingSkip, AmfProductionRevisionKind, AmfParameterBudgetPlanV01,
  AmfOptimizerMetrics, AmfOptimizerReport, AmfOptimizerState } from "@vua/contracts";
import { isOutfitRemovalFacts, isOutfitRemovalApplied, isOutfitRemovalPlan, isAmfEditorCloseResult, isFaceTrackingFacts, isFaceTrackingPlan, isAmfAssemblySelection, isAmfPreviewPath, isAmfRecipeDocument, isAmfSharedRecipe, decodeAmfRecipeShare, sameAmfRecipeShare,
  AMF_RUN_PHASES, isAmfStep, isAmfUsualDurations, isAmfRunProgress, readAmfProductionProgress, isAmfProductionCapacity, isAmfParameterBudgetPlan,
  isAmfOptimizerReport, isAmfOptimizerState } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { registerTaskIdentity } from "./task-identity.ts";
import type { Unsubscribe } from "./types.ts";
import { strings } from "../i18n/index.ts";

export interface AmfProductionSource { readonly sourceId: string; readonly itemId: string; readonly itemName: string; readonly name: string;
  /** The BOOTH products the library entry maps to; empty when none is known. */
  readonly productIds?: readonly string[];
  /** Previously recorded digest; listing sources does not hash their contents. */
  readonly sha256?: string }
export interface AmfProductionEditor { readonly path: string; readonly version: string }
export interface AmfPrefab {
  readonly sourceId: string; readonly path: string; readonly name: string; readonly isAvatar: boolean;
  readonly prefabGuid?: string; readonly objectPaths?: readonly string[];
  readonly hasSkinnedMesh: boolean; readonly hasMergeArmature: boolean; readonly hasMissingScripts: boolean; readonly humanoidBones: readonly string[];
  /** Observed VRCFury integration components; absent when an older AMF build did not report it. */
  readonly hasVrcFury?: boolean;
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
  readonly editorClose?: AmfEditorCloseResult;
  readonly recipeMaterials?: readonly AmfRecipeMaterialResolution[];
  readonly recipeMaterialSources?: AmfMaterialChoices;
  readonly materialChoices?: AmfMaterialChoices;
  readonly recipeDifferences?: readonly AmfRecipeDifference[];
  readonly selection: AmfAssemblySelection | null; readonly error: string | null; readonly recovery: string | null;
  readonly snapshotId: string | null;
  /** The copy kept from before the creator patch, while the line carries its marker; absent when the engine keeps none. */
  readonly ftPrePatchSnapshot?: string | null;
  /** Recorded states of the line, newest first; absent on runs made before revisions. */
  readonly revisions?: readonly AmfProductionRevisionSummaryItem[];
  /** Pending manual fit adjustments per source, with the digest they save under; absent when the engine does not track them. */
  readonly fitChanges?: readonly AmfProductionFitChanges[];
  /** Saved fits that match a source of this run; absent when the engine does not report them. */
  readonly availableFits?: readonly AmfProductionAvailableFit[];
  /** Optional Avatar Optimizer (`TraceAndOptimize`) state on the line's owned Avatar. */
  readonly optimizer?: AmfOptimizerState;
  /** When assembly finished the Avatar. */
  readonly completedAt?: string | null;
  readonly result: { readonly facts?: { readonly sdkDescriptorRecognized: boolean; readonly missingReferences: number; readonly avatarName: string | null;
    readonly instances: readonly { readonly sourceId: string; readonly bindingVerified: boolean; readonly menuVerified: boolean; readonly menuModified?: boolean }[];
    readonly observedSelection?: AmfAssemblySelection | null; readonly hasMissingScripts?: boolean;
    readonly materialPaths?: readonly string[]; readonly missingShaderMaterials?: readonly string[]; readonly sdkSignedIn?: "yes" | "no" | "unknown";
    readonly faceTracking?: FaceTrackingFactsV01;
    readonly outfitRemoval?: readonly OutfitRemoval[]; readonly outfitRemovalApplied?: readonly OutfitRemovalApplied[];
    readonly previews?: readonly AmfPreviewImage[]; readonly sdkReview?: AmfSdkReview;
    /** The SDK items the last fix ran the SDK's Auto Fix for. */
    readonly textureMemory?: readonly TextureMemoryReport[]; readonly sdkFixesApplied?: readonly string[];
    readonly optimizerReport?: AmfOptimizerReport;
    readonly optimizerWarnings?: readonly string[];
    /** Saved-fit objects the last assembly could not find in each garment; they kept the garment's own placement. */
    readonly fitSkipped?: readonly { readonly sourceId: string; readonly paths: readonly string[] }[] };
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
/** Unity work waiting for its turn behind the running job. */
export type AmfQueuedWork = AmfProductionWorkV01;
export interface AmfProductionList extends AmfProductionLaneV01 {
  readonly sources: readonly AmfProductionSource[]; readonly editors: readonly AmfProductionEditor[];
  /** `projectGone`: the line's work project is no longer on this computer. */
  readonly runs: readonly { readonly runId: string; readonly phase: AmfRunPhase; readonly sourceNames: readonly string[]; readonly projectGone?: boolean; readonly recipeId?: string }[];
}
export interface AmfProductionPlan {
  readonly runId: string; readonly planDigest: string; readonly selection: AmfAssemblySelection;
  readonly inputs: readonly { readonly sourceId: string; readonly name: string; readonly role: "avatar" | "outfit" | "import_only" }[];
  /** Assembling rebuilds the line on another Avatar prefab, behind a restore point. */
  readonly rebuild?: boolean;
  readonly materials?: readonly AmfRecipeMaterialResolution[];
  readonly materialChoices?: AmfMaterialChoices;
  readonly recipeDifferences?: readonly AmfRecipeDifference[];
  readonly canAssemble?: boolean;
  /** Estimated synced parameter bits of the assembled Avatar against the 256-bit limit; absent when
   *  the engine predates the estimate. */
  readonly parameterBudget?: AmfParameterBudgetPlanV01;
  /** Pre-assembly cost prediction for the Avatar and each selected outfit; absent when the
   *  engine predates the observation. */
  readonly prediction?: AmfPlanPrediction;
  /** The saved fit the plan applies per source, when one is known; `null` names no fit. Absent when the engine does not report fits. */
  readonly fits?: readonly { readonly sourceId: string; readonly fitId: string | null; readonly name: string | null }[];
}
/** One candidate's predicted cost before assembly. `parameterBits` is null when the source
 *  evidence cannot decide it; `complete` says whether every value was decided. */
export interface AmfPlanPredictionRow {
  readonly sourceId: string; readonly name: string; readonly role: "avatar" | "outfit";
  readonly triangles: number; readonly materialSlots: number; readonly textureBytes: number;
  readonly physBones: number; readonly parameterBits: number | null;
  readonly uncompressedBytes: number; readonly complete: boolean;
}
export type AmfPredictedPerformanceRank = "excellent" | "good" | "medium" | "poor" | "very_poor";
export type AmfPredictedLimitingMetric = "triangles" | "skinnedMeshes" | "basicMeshes" | "materialSlots" | "textureBytes" | "physBones";
export interface AmfPredictedPlatformRank {
  readonly rank: AmfPredictedPerformanceRank;
  readonly limitingMetrics: readonly AmfPredictedLimitingMetric[];
}
export interface AmfPredictedPerformanceRanks {
  readonly pc: AmfPredictedPlatformRank;
  readonly android: AmfPredictedPlatformRank;
}
export interface AmfPlanPredictionTotal {
  readonly triangles: number; readonly materialSlots: number; readonly textureBytes: number;
  readonly physBones: number; readonly parameterBits: number | null;
  readonly uncompressedBytes: number; readonly complete: boolean;
  readonly performanceRanks?: AmfPredictedPerformanceRanks;
}
/** The plan's pre-assembly cost prediction; `available` is false when a selected candidate
 *  carries no observation, and the rows are then empty. */
export interface AmfPlanPrediction {
  readonly schemaVersion: "0.1"; readonly evidence: "unity_source_estimate"; readonly platform: "pc";
  readonly available: boolean;
  readonly tolerance: { readonly counts: "exact"; readonly textureBytes: "decoded_estimate"; readonly uncompressedBytes: "within_25_percent" };
  readonly rows: readonly AmfPlanPredictionRow[];
  readonly total?: AmfPlanPredictionTotal;
}
export interface AmfProductionAccepted { readonly runId: string; readonly taskId: string }
export interface AmfSavedRecipe { readonly recipe: AmfRecipeDocument; readonly revision: number; readonly updatedAt: string }
export interface AmfRecipeSummary {
  readonly recipeId: string; readonly title: string; readonly revision: number; readonly updatedAt: string;
  readonly avatarName?: string; readonly outfitCount?: number; readonly materialCount?: number;
  readonly packageCount?: number; readonly boothProductIds?: readonly string[];
}
export interface AmfRecipeImage { readonly mediaType: "image/png"; readonly data: string }
export function isAmfRecipeSummary(v: unknown): v is AmfRecipeSummary {
  return record(v) && text(v.recipeId) && text(v.title) && text(v.updatedAt) && Number.isSafeInteger(v.revision) && Number(v.revision) > 0
    && (v.avatarName === undefined || (text(v.avatarName) && [...v.avatarName].length <= 240))
    && ["outfitCount", "materialCount", "packageCount"].every(key => v[key] === undefined || (Number.isSafeInteger(v[key]) && Number(v[key]) >= 0))
    && (v.boothProductIds === undefined || (Array.isArray(v.boothProductIds) && v.boothProductIds.length <= 64
      && v.boothProductIds.every(id => typeof id === "string" && /^[1-9][0-9]{0,19}$/u.test(id)) && new Set(v.boothProductIds).size === v.boothProductIds.length));
}
export interface AmfProductionRestorePlan {
  readonly runId: string; readonly planDigest: string; readonly snapshotId: string;
  readonly projectRoot: string; readonly currentChanged: boolean; readonly preserveCurrent: true;
  /** The state from before the creator patch, offered while the line carries its marker; absent when the engine keeps none. */
  readonly prePatch?: { readonly snapshotId: string; readonly planDigest: string };
}
/** What one recorded revision captured of the line. */
export interface AmfProductionRevisionSummary {
  readonly avatar: string | null; readonly outfits: readonly string[]; readonly sources: readonly string[];
  readonly lightingMaterials: number; readonly sdkFixes: readonly string[]; readonly optimizer?: boolean;
}
/** One revision of a run's history, newest first in `AmfProductionRun.revisions`. */
export interface AmfProductionRevisionSummaryItem {
  readonly id: string; readonly before: AmfProductionRevisionKind; readonly takenAt: string;
  readonly summary: AmfProductionRevisionSummary; readonly editedInUnity: boolean;
}
/** The reviewed restore of a line to one recorded revision. */
export interface AmfProductionRevisionPlan {
  readonly runId: string; readonly revisionId: string; readonly planDigest: string;
  readonly before: AmfProductionRevisionKind; readonly takenAt: string;
  readonly summary: AmfProductionRevisionSummary; readonly editedInUnity: boolean; readonly warning: string | null;
  readonly steps: readonly { readonly key: string; readonly skipped: boolean; readonly rebuild?: boolean; readonly enabled?: boolean;
    readonly materials?: readonly { readonly material: string; readonly min: string; readonly max: string }[];
    readonly fixes?: readonly string[] }[];
}
/** One object's saved local-Transform adjustment of a garment on an Avatar. */
export interface AmfFitObject {
  readonly path: string;
  readonly localPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly localRotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  readonly localScale: { readonly x: number; readonly y: number; readonly z: number };
}
/** One source's pending manual fit adjustments of a run, with the digest they save under. */
export interface AmfProductionFitChanges {
  readonly sourceId: string; readonly moved: readonly AmfFitObject[]; readonly missing: readonly string[]; readonly changesDigest: string;
}
/** One saved fit that matches a source of a run. */
export interface AmfProductionAvailableFit { readonly sourceId: string; readonly fitId: string; readonly name: string }
/** One saved fit as the list of fits reports it, with the garment and Avatar it belongs to. */
export interface AmfFitSummary {
  readonly fitId: string; readonly name: string; readonly createdAt: string; readonly updatedAt: string;
  readonly garment: { readonly sha256: string; readonly prefabPath: string; readonly name: string };
  readonly avatar: { readonly sha256: string; readonly prefabPath: string; readonly name: string };
  readonly objectCount: number;
}
/** The saved fit as its saving reports it. */
export interface AmfFitSaved { readonly fitId: string; readonly name: string; readonly createdAt: string; readonly updatedAt: string }
/** The reviewed lilToon brightness alignment of an assembled line. */
export interface AmfLightingPlan {
  readonly runId: string; readonly planDigest: string;
  readonly reference: AmfLightingLimits | null; readonly referenceReason: AmfLightingReferenceReason | null;
  readonly entries: readonly AmfLightingEntry[]; readonly skipped: readonly AmfLightingSkip[];
}
export type { AmfLightingEntry, AmfLightingLimits, AmfLightingReferenceReason, AmfLightingSkip, AmfProductionRevisionKind, AmfOptimizerMetrics, AmfOptimizerReport, AmfOptimizerState } from "@vua/contracts";
export interface AmfRecipeSharePlan {
  readonly recipeId: string; readonly title: string; readonly revision: number; readonly planDigest: string;
  readonly materials: readonly { readonly materialId: string; readonly packageName: string; readonly candidates: readonly string[]; readonly selectedProductId: string | null }[];
}
export interface AmfRecipeShareExport { readonly shareCode: string; readonly fileText: string; readonly document: AmfSharedRecipe }
export interface AmfRecipeApplyPlan {
  readonly materials?: readonly AmfRecipeMaterialResolution[]; readonly materialChoices?: AmfMaterialChoices;
  readonly recipeDifferences?: readonly AmfRecipeDifference[]; readonly canApply?: boolean;
  readonly runId: string; readonly recipeId: string; readonly title: string; readonly avatarName: string;
  readonly avatarGlobalObjectId: string; readonly planDigest: string; readonly retainedOutfits: number; readonly overlayBlocker: string | null;
  readonly conflicts: readonly { readonly sourceId: string; readonly packageName: string; readonly field: "mode" | "bone" | "toggleName" | "active" | "saved" | "group"; readonly current: string | boolean; readonly incoming: string | boolean }[];
  readonly recipeSelection: AmfAssemblySelection; readonly currentSelection: AmfAssemblySelection;
  readonly targets: readonly { readonly globalObjectId: string; readonly name: string; readonly verified: boolean }[];
}
export interface AmfProductionPort {
  recipeMaterialPlan(recipeId: string, materialChoices?: AmfMaterialChoices): Promise<AmfRecipeMaterialPlan>;
  recipeApplyPlan(runId: string, recipeId: string, avatarGlobalObjectId?: string, materialChoices?: AmfMaterialChoices): Promise<AmfRecipeApplyPlan>;
  applyRecipe(plan: AmfRecipeApplyPlan, choice: AmfRecipeApplyChoice, recipeDifferencesConfirmed?: true): Promise<AmfProductionAccepted>;
  recipeSharePlan(recipeId: string): Promise<AmfRecipeSharePlan>;
  exportRecipe(recipeId: string, planDigest: string, sources: Readonly<Record<string,string>>): Promise<AmfRecipeShareExport>;
  previewRecipeShare(text: string): Promise<AmfSharedRecipe>;
  importRecipe(text: string): Promise<AmfSavedRecipe>;
  listRecipes(): Promise<readonly AmfRecipeSummary[]>;
  getRecipe(recipeId: string): Promise<AmfSavedRecipe>;
  /** Renames the exact saved revision. Optional for older or fixture ports. */
  renameRecipe?(recipeId: string, expectedRevision: number, title: string): Promise<AmfSavedRecipe>;
  /** Deletes an unreferenced Recipe; a retained line reference is recipe_in_use. */
  deleteRecipe?(recipeId: string, expectedRevision: number): Promise<void>;
  recipeImage?(recipeId: string): Promise<AmfRecipeImage | null>;
  saveRecipe(runId: string, title: string): Promise<AmfSavedRecipe>;
  prepareRecipe(recipeId: string, editorPath: string, materialChoices?: AmfMaterialChoices): Promise<AmfProductionAccepted>;
  list(): Promise<AmfProductionList>;
  setCapacity(capacity: AmfProductionCapacity): Promise<AmfProductionCapacity>;
  get(runId: string): Promise<AmfProductionRun>;
  prepare(sources: readonly AmfSourceChoice[], editorPath: string): Promise<AmfProductionAccepted>;
  plan(runId: string, selection: AmfAssemblySelection): Promise<AmfProductionPlan>;
  assemble(runId: string, plan: AmfProductionPlan, recipeDifferencesConfirmed?: true): Promise<AmfProductionAccepted>;
  reinspect(runId: string): Promise<AmfProductionAccepted>;
  /** Runs the VRChat SDK's own Auto Fix for items its last check offers one for, by the SDK's exact words. */
  faceTrackingPlan(runId: string, menuId: string): Promise<FaceTrackingPlanV01>;
  faceTrackingPatch(runId: string, menuId: string, planDigest: string, confirmTrustedCode: true, title: string): Promise<AmfProductionAccepted>;
  sdkFix(runId: string, fixes: readonly string[]): Promise<AmfProductionAccepted>;
  /** Changes the line's own materials behind a restore point; the line plans again. */
  changeSources(runId: string, sources: readonly AmfSourceChoice[]): Promise<AmfProductionAccepted>;
  /** Reviews the lilToon brightness alignment of an assembled line: the Avatar's reference limits and the outfit entries that differ. */
  planTextureMemory(runId: string, platform: TexturePlatform, targetRank: TextureTargetRank): Promise<AmfTextureMemoryPlan>;
  applyTextureMemory(runId: string, plan: AmfTextureMemoryPlan, textures: readonly string[]): Promise<AmfProductionAccepted>;
  planOutfitRemoval(runId: string, sourceId: string): Promise<OutfitRemovalPlan>;
  removeOutfit(runId: string, plan: OutfitRemovalPlan, confirmed: true): Promise<AmfProductionAccepted>;
  planLighting(runId: string): Promise<AmfLightingPlan>;
  /** Aligns the chosen reviewed materials with the Avatar's reference behind a restore point, then rechecks the project in Unity. */
  applyLighting(runId: string, plan: AmfLightingPlan, materials: readonly string[]): Promise<AmfProductionAccepted>;
  /** Enables or disables optional Avatar Optimizer (`TraceAndOptimize`) on VUA's owned Avatar behind a restore point. */
  setOptimizer(runId: string, enabled: boolean, title?: string): Promise<AmfProductionAccepted>;
  /** Deletes a line with its work project and release record. */
  delete(runId: string): Promise<AmfProductionAccepted>;
  rollbackPlan(runId: string): Promise<AmfProductionRestorePlan>;
  /** Which retained copy a reviewed restore returns to; the restore point when omitted. */
  rollback(runId: string, plan: AmfProductionRestorePlan, target?: "restorePoint" | "prePatch"): Promise<AmfProductionAccepted>;
  /** Reviews the restore of a line to one recorded revision before any mutation. */
  revisionPlan(runId: string, revisionId: string): Promise<AmfProductionRevisionPlan>;
  /** Restores the line to the reviewed revision, behind a restore point of the current state. */
  restoreRevision(runId: string, plan: AmfProductionRevisionPlan): Promise<AmfProductionAccepted>;
  /** Saves the line's pending manual fit adjustments of one source under a name; synchronous, no task. */
  saveFit(runId: string, sourceId: string, name: string, changesDigest: string): Promise<AmfFitSaved>;
  /** Lists every saved fit with the garment and Avatar it belongs to. */
  listFits(): Promise<readonly AmfFitSummary[]>;
  /** Renames a saved fit; synchronous, no task. */
  renameFit(fitId: string, name: string): Promise<{ readonly fitId: string; readonly name: string }>;
  /** Deletes a saved fit; synchronous, no task. */
  deleteFit(fitId: string): Promise<void>;
  closeEditor(runId: string, confirmed: true, title: string): Promise<AmfProductionAccepted>;
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
const work = (v: unknown): v is AmfProductionWorkV01 => record(v) && text(v.taskId) && v.taskId.length > 0
  && text(v.runId) && v.runId.length > 0 && text(v.operation) && v.operation.startsWith("amf.production.");
const phases: readonly string[] = AMF_RUN_PHASES;
const roles = ["auto", "avatar", "outfit", "dependency"];
const savedRecipe = (v: unknown): v is AmfSavedRecipe => record(v) && isAmfRecipeDocument(v.recipe) && Number.isSafeInteger(v.revision) && Number(v.revision) > 0 && text(v.updatedAt);
const choice = (v: unknown) => record(v) && text(v.sourceId) && roles.includes(String(v.role));
const editor = (v: unknown): v is AmfProductionEditor => record(v) && text(v.path) && (v.version === "2022.3.22f1" || v.version === "2022.3.22f1c1");
const source = (v: unknown): v is AmfProductionSource => record(v) && [v.sourceId, v.itemId, v.itemName, v.name].every(text)
  && (v.sha256 === undefined || (typeof v.sha256 === "string" && /^[0-9a-f]{64}$/u.test(v.sha256)))
  && (v.productIds === undefined || (Array.isArray(v.productIds) && v.productIds.length <= 64 && v.productIds.every(id => typeof id === "string" && /^[a-z]+:[A-Za-z0-9_-]{1,64}$/u.test(id))));
const prefab = (v: unknown): v is AmfPrefab => record(v) && [v.sourceId, v.path, v.name].every(text)
  && [v.isAvatar, v.hasSkinnedMesh, v.hasMergeArmature, v.hasMissingScripts].every(p => typeof p === "boolean") && texts(v.humanoidBones)
  && (v.preview === undefined || isAmfPreviewPath(v.preview))
  && (v.hasVrcFury === undefined || typeof v.hasVrcFury === "boolean")
  && (v.prefabGuid === undefined || (typeof v.prefabGuid === "string" && /^[a-f0-9]{32}$/u.test(v.prefabGuid)))
  && (v.objectPaths === undefined || (texts(v.objectPaths) && v.objectPaths.length <= 2048 && v.objectPaths.every(p => p.length <= 512) && new Set(v.objectPaths).size === v.objectPaths.length));
const ratings: readonly string[] = AMF_SDK_RATINGS;
const count = (v: unknown, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const predictedRanks = ["excellent", "good", "medium", "poor", "very_poor"];
const predictedMetrics = ["triangles", "skinnedMeshes", "basicMeshes", "materialSlots", "textureBytes", "physBones"];
const predictedPlatformRank = (v: unknown): v is AmfPredictedPlatformRank => record(v)
  && Object.keys(v).length === 2
  && typeof v.rank === "string" && predictedRanks.includes(v.rank)
  && Array.isArray(v.limitingMetrics) && v.limitingMetrics.length <= 6
  && v.limitingMetrics.every(m => typeof m === "string" && predictedMetrics.includes(m))
  && new Set(v.limitingMetrics).size === v.limitingMetrics.length;
const predictedPerformanceRanks = (v: unknown): v is AmfPredictedPerformanceRanks => record(v)
  && Object.keys(v).length === 2
  && predictedPlatformRank(v.pc) && predictedPlatformRank(v.android);
const predictionTotal = (v: unknown): v is AmfPlanPredictionTotal => record(v)
  && [v.triangles, v.materialSlots, v.textureBytes, v.physBones, v.uncompressedBytes].every(n => count(n, 1 << 40))
  && (v.parameterBits === null || count(v.parameterBits, 1 << 20)) && typeof v.complete === "boolean"
  && (v.performanceRanks === undefined || predictedPerformanceRanks(v.performanceRanks));
const predictionRow = (v: unknown): v is AmfPlanPredictionRow => record(v) && text(v.sourceId) && text(v.name)
  && (v.role === "avatar" || v.role === "outfit")
  && [v.triangles, v.materialSlots, v.textureBytes, v.physBones, v.uncompressedBytes].every(n => count(n, 1 << 40))
  && (v.parameterBits === null || count(v.parameterBits, 1 << 20)) && typeof v.complete === "boolean";
/** The pre-assembly prediction: an unavailable document carries no rows and no total; an
 *  available one carries at least one row and a total whose sums are the rows' sums. */
export const isAmfPlanPrediction = (v: unknown): v is AmfPlanPrediction => record(v)
  && v.schemaVersion === "0.1" && v.evidence === "unity_source_estimate" && v.platform === "pc"
  && record(v.tolerance) && v.tolerance.counts === "exact" && v.tolerance.textureBytes === "decoded_estimate"
  && v.tolerance.uncompressedBytes === "within_25_percent"
  && typeof v.available === "boolean" && Array.isArray(v.rows) && v.rows.length <= 64 && v.rows.every(predictionRow)
  && (v.available
    ? v.rows.length > 0 && predictionTotal(v.total)
    : v.rows.length === 0 && v.total === undefined);
const revisionKinds: readonly string[] = ["materials", "assembly", "rebuild", "sdk_fix", "face_tracking", "editor_save", "outfit_removal", "lighting", "texture_memory", "optimizer", "restore"];
const revisionSummary = (v: unknown): v is AmfProductionRevisionSummary => record(v)
  && (v.avatar === null || text(v.avatar)) && texts(v.outfits) && texts(v.sources)
  && Number.isSafeInteger(v.lightingMaterials) && Number(v.lightingMaterials) >= 0 && texts(v.sdkFixes)
  && (v.optimizer === undefined || typeof v.optimizer === "boolean");
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fitVector = (v: unknown): boolean => record(v) && finite(v.x) && finite(v.y) && finite(v.z);
const fitObject = (v: unknown): v is AmfFitObject => record(v) && text(v.path)
  && fitVector(v.localPosition) && fitVector(v.localScale)
  && record(v.localRotation) && finite(v.localRotation.x) && finite(v.localRotation.y) && finite(v.localRotation.z) && finite(v.localRotation.w);
const fitMaterial = (v: unknown): boolean => record(v) && text(v.sha256) && /^[a-f0-9]{64}$/u.test(v.sha256) && text(v.prefabPath) && text(v.name);
const planFits = (v: unknown): boolean => v === undefined || (Array.isArray(v)
  && v.every(f => record(f) && text(f.sourceId) && (f.fitId === null || text(f.fitId)) && (f.name === null || text(f.name))));
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
    && (facts.outfitRemoval === undefined || isOutfitRemovalFacts(facts.outfitRemoval))
    && (facts.outfitRemovalApplied === undefined || (Array.isArray(facts.outfitRemovalApplied) && facts.outfitRemovalApplied.length <= 1 && facts.outfitRemovalApplied.every(isOutfitRemovalApplied)))
    && (facts.materialPaths === undefined || (texts(facts.materialPaths) && facts.materialPaths.length <= 4096 && new Set(facts.materialPaths).size === facts.materialPaths.length && facts.materialPaths.every(p => p.length <= 2048 && p.startsWith("Assets/") && p.endsWith(".mat") && !/[\\:\0]/u.test(p) && p.split("/").every(part => part !== "" && part !== "." && part !== ".."))))
    && (facts.faceTracking === undefined || isFaceTrackingFacts(facts.faceTracking))
    && (facts.textureMemory === undefined || isTextureMemoryFacts(facts.textureMemory))
    && (facts.sdkReview === undefined || isAmfSdkReview(facts.sdkReview))
    && (facts.sdkFixesApplied === undefined || (texts(facts.sdkFixesApplied) && facts.sdkFixesApplied.length <= 16))
    && (facts.optimizerReport === undefined || isAmfOptimizerReport(facts.optimizerReport))
    && (facts.optimizerWarnings === undefined || (texts(facts.optimizerWarnings) && facts.optimizerWarnings.length <= 16))
    && (facts.fitSkipped === undefined || (Array.isArray(facts.fitSkipped) && facts.fitSkipped.every(entry => record(entry) && text(entry.sourceId) && texts(entry.paths))))
    && (facts.previews === undefined || (Array.isArray(facts.previews) && facts.previews.length <= 3 && facts.previews.every(p => record(p) && ["front","side","back"].includes(String(p.view)) && isAmfPreviewPath(p.path))))
    && facts.instances.every(i => record(i) && text(i.sourceId) && typeof i.bindingVerified === "boolean" && typeof i.menuVerified === "boolean"
      && (i.menuModified === undefined || typeof i.menuModified === "boolean"))))
    && (v.diagnostics === undefined || (Array.isArray(v.diagnostics) && v.diagnostics.every(d => record(d) && text(d.code) && text(d.message) && ["info","warning","error"].includes(String(d.severity)))));
}
// Each part of a run the renderer relies on, named so a rejected run says which part failed.
const runChecks: readonly (readonly [string, (v: Record<string, unknown>) => boolean])[] = [
  ["identity", v => v.schemaVersion === "0.1" && text(v.runId) && typeof v.phase === "string" && phases.includes(v.phase) && text(v.taskId) && editor(v.editor) && text(v.projectRoot)],
  ["choices", v => Array.isArray(v.choices) && v.choices.every(choice)],
  ["sources", v => Array.isArray(v.sources) && v.sources.every(s => choice(s) && record(s) && [s.itemName, s.name, s.sha256].every(text))],
  ["prefabs", v => Array.isArray(v.prefabs) && v.prefabs.every(prefab)],
  ["steps", v => Array.isArray(v.steps) && v.steps.every(isAmfStep)],
  ["usualDurations", v => v.usualDurations === undefined || isAmfUsualDurations(v.usualDurations)],
  ["progress", v => v.progress === undefined || v.progress === null || isAmfRunProgress(v.progress)],
  ["recipeReview", v => hasValidAmfRecipeReview({...v,materials:v.recipeMaterials}) && (v.recipeMaterialSources === undefined || isAmfMaterialChoices(v.recipeMaterialSources))],
  ["editorClose", v => v.editorClose === undefined || (isAmfEditorCloseResult(v.editorClose) && v.editorClose.runId === v.runId)],
  ["error", v => (v.error === null || text(v.error)) && (v.recovery === null || text(v.recovery))],
  ["snapshotId", v => (v.snapshotId === null || (text(v.snapshotId) && v.snapshotId.length > 0))
    && (v.ftPrePatchSnapshot === undefined || v.ftPrePatchSnapshot === null || (text(v.ftPrePatchSnapshot) && v.ftPrePatchSnapshot.length > 0))],
  ["selection", v => v.selection === null || isAmfAssemblySelection(v.selection)],
  ["revisions", v => v.revisions === undefined || (Array.isArray(v.revisions)
    && v.revisions.every(r => record(r) && text(r.id) && text(r.takenAt) && revisionKinds.includes(String(r.before))
      && typeof r.editedInUnity === "boolean" && revisionSummary(r.summary)))],
  ["fitChanges", v => v.fitChanges === undefined || (Array.isArray(v.fitChanges)
    && v.fitChanges.every(f => record(f) && text(f.sourceId) && Array.isArray(f.moved) && f.moved.every(fitObject)
      && texts(f.missing) && text(f.changesDigest) && /^[a-f0-9]{64}$/u.test(f.changesDigest)))],
  ["availableFits", v => v.availableFits === undefined || (Array.isArray(v.availableFits)
    && v.availableFits.every(f => record(f) && text(f.sourceId) && text(f.fitId) && text(f.name)))],
  ["optimizer", v => v.optimizer === undefined || isAmfOptimizerState(v.optimizer)],
  ["result", v => result(v.result)],
];
/** The first part of a run the renderer cannot read, or null when the run is valid. */
export function amfRunProblem(v: unknown): string | null {
  if (!record(v)) return "record";
  return runChecks.find(([, check]) => !check(v))?.[0] ?? null;
}
export function isAmfProductionRun(v: unknown): v is AmfProductionRun {
  return amfRunProblem(v) === null;
}
export class AmfProductionError extends Error {
  constructor(readonly code: string, detail: string, readonly suggestedAction?: "amf.production.closeEditor" | "amf.production.recipeMaterialPlan", readonly materials?: readonly AmfRecipeMaterialResolution[]) { super(detail); }
}
export function createAmfProductionPort(client: GatewayClient): AmfProductionPort {
  const call = async (body: AmfProductionBodyV01): Promise<unknown> => {
    const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), ...body });
    if (!response.ok) {
      const error = response.error;
      if (error.kind === "application") {
        const action = error.error.params?.suggestedAction;
        if (action !== undefined && !((action === "amf.production.closeEditor" && error.error.code === "vua.amf_production.project_open") || (action === "amf.production.recipeMaterialPlan" && error.error.code === "vua.amf_production.recipe_materials_unresolved"))) throw new Error("amf_production_error_invalid");
        let materials: unknown;
        if (error.error.params?.materials !== undefined) {
          try { materials = JSON.parse(String(error.error.params.materials)); } catch { throw new Error("amf_production_error_invalid"); }
          if (!isAmfRecipeMaterials(materials)) throw new Error("amf_production_error_invalid");
        }
        throw new AmfProductionError(error.error.code, typeof error.error.params?.detail === "string" ? error.error.params.detail : error.error.code, action, materials as readonly AmfRecipeMaterialResolution[] | undefined);
      }
      throw new Error(error.kind);
    }
    return response.value;
  };
  const accepted = (value: unknown, title: string): AmfProductionAccepted => {
    if (!record(value) || value.schemaVersion !== "0.1" || !text(value.runId) || !text(value.taskId) || !value.taskId) throw new Error("amf_production_receipt_invalid");
    registerTaskIdentity(value.taskId, { title, originPage: "workshop", notifyOnComplete: true, notifyFamily: "amf:production" });
    return { runId: value.runId, taskId: value.taskId };
  };
  return {
    async recipeMaterialPlan(recipeId, materialChoices) {
      const v = await call({method:"amf.production.recipeMaterialPlan",params:{schemaVersion:"0.1",recipeId,...(materialChoices !== undefined ? {materialChoices} : {})}});
      if (!record(v) || v.schemaVersion !== "0.1" || !isAmfRecipeMaterialPlan(v.plan) || v.plan.recipeId !== recipeId) throw new Error("amf_recipe_material_plan_invalid");
      return v.plan;
    },
    async recipeApplyPlan(runId, recipeId, avatarGlobalObjectId, materialChoices) {
      const v = await call({method:"amf.production.recipeApplyPlan", params:{schemaVersion:"0.1", runId, recipeId, ...(avatarGlobalObjectId !== undefined ? {avatarGlobalObjectId} : {}),...(materialChoices !== undefined ? {materialChoices} : {})}});
      const p = record(v) && v.schemaVersion === "0.1" ? v.plan : null;
      if (!record(p) || !hasValidAmfRecipeReview(p) || p.runId !== runId || p.recipeId !== recipeId || !text(p.title) || !text(p.avatarName) || !text(p.avatarGlobalObjectId) || !p.avatarGlobalObjectId
        || !text(p.planDigest) || !/^[a-f0-9]{64}$/u.test(p.planDigest) || !Number.isSafeInteger(p.retainedOutfits) || Number(p.retainedOutfits) < 0 || Number(p.retainedOutfits) > 64
        || (p.overlayBlocker !== null && !text(p.overlayBlocker)) || (p.canApply !== false && !isAmfAssemblySelection(p.recipeSelection)) || !isAmfAssemblySelection(p.currentSelection)
        || !Array.isArray(p.conflicts) || p.conflicts.length > 256 || !p.conflicts.every(c => record(c) && text(c.sourceId) && text(c.packageName)
          && ["mode","bone","toggleName","active","saved","group"].includes(String(c.field))
          && (c.field === "active" || c.field === "saved" ? typeof c.current === "boolean" && typeof c.incoming === "boolean"
            : c.field === "group" ? typeof c.current === "string" && typeof c.incoming === "string" : text(c.current) && text(c.incoming)))) throw new Error("amf_recipe_apply_plan_invalid");
      if (!Array.isArray(p.targets) || p.targets.length < 1 || p.targets.length > 64
        || !p.targets.every(t => record(t) && text(t.globalObjectId) && t.globalObjectId.length > 0 && t.globalObjectId.length <= 256 && text(t.name) && typeof t.verified === "boolean")
        || new Set(p.targets.map(t=>t.globalObjectId)).size !== p.targets.length
        || !p.targets.some(t=>t.globalObjectId === p.avatarGlobalObjectId && t.verified)
        || (avatarGlobalObjectId !== undefined && avatarGlobalObjectId !== p.avatarGlobalObjectId)) throw new Error("amf_recipe_apply_plan_invalid");
      return p as unknown as AmfRecipeApplyPlan;
    },
    async applyRecipe(plan, choice, recipeDifferencesConfirmed) {
      return accepted(await call({method:"amf.production.applyRecipe",params:{schemaVersion:"0.1",runId:plan.runId,recipeId:plan.recipeId,planDigest:plan.planDigest,choice,...(recipeDifferencesConfirmed !== undefined ? {recipeDifferencesConfirmed} : {}),...(plan.materialChoices !== undefined ? {materialChoices:plan.materialChoices} : {}),avatarGlobalObjectId:plan.avatarGlobalObjectId}}),strings.amfProduction.assembling);
    },
    async recipeSharePlan(recipeId) {
      const v = await call({ method: "amf.production.recipeSharePlan", params: {schemaVersion:"0.1",recipeId} });
      const plan = record(v) && v.schemaVersion === "0.1" ? v.plan : null;
      const booth = (id: unknown): id is string => text(id) && /^[1-9][0-9]{0,19}$/u.test(id);
      if (!record(plan) || plan.recipeId !== recipeId || !text(plan.title) || !Number.isSafeInteger(plan.revision) || Number(plan.revision) < 1
        || !text(plan.planDigest) || !/^[a-f0-9]{64}$/u.test(plan.planDigest) || !Array.isArray(plan.materials) || plan.materials.length < 1 || plan.materials.length > 64
        || !plan.materials.every(m => record(m) && text(m.materialId) && /^[a-zA-Z0-9_-]{1,100}$/u.test(m.materialId) && text(m.packageName) && Array.isArray(m.candidates) && m.candidates.every(booth) && (m.selectedProductId === null || booth(m.selectedProductId)))
        || new Set(plan.materials.map(m=>m.materialId)).size !== plan.materials.length) throw new Error("amf_recipe_share_plan_invalid");
      return plan as unknown as AmfRecipeSharePlan;
    },
    async exportRecipe(recipeId, planDigest, sources) {
      const v = await call({ method:"amf.production.exportRecipe", params:{schemaVersion:"0.1",recipeId,planDigest,sources} });
      const result = record(v) && v.schemaVersion === "0.1" ? v.export : null;
      if (!record(result) || !text(result.shareCode) || !/^vuar0\.[456]\./u.test(result.shareCode) || result.shareCode.length > 349557 || !text(result.fileText)
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
      if (!record(v) || v.schemaVersion !== "0.1" || !Array.isArray(v.recipes) || !v.recipes.every(isAmfRecipeSummary)) throw new Error("amf_recipe_list_invalid");
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
    async renameRecipe(recipeId, expectedRevision, title) {
      const v = await call({ method: "amf.production.renameRecipe", params: { schemaVersion: "0.1", recipeId, expectedRevision, title } });
      if (!record(v) || v.schemaVersion !== "0.1" || !savedRecipe(v.document) || v.document.recipe.recipeId !== recipeId
        || v.document.revision !== expectedRevision + 1 || v.document.recipe.title !== title) throw new Error("amf_recipe_document_invalid");
      return v.document;
    },
    async deleteRecipe(recipeId, expectedRevision) {
      const v = await call({ method: "amf.production.deleteRecipe", params: { schemaVersion: "0.1", recipeId, expectedRevision } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.recipeId !== recipeId || v.deleted !== true) throw new Error("amf_recipe_delete_invalid");
    },
    async recipeImage(recipeId) {
      const v = await call({ method: "amf.production.recipeImage", params: { schemaVersion: "0.1", recipeId } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.recipeId !== recipeId) throw new Error("amf_recipe_image_invalid");
      if (v.image === null) return null;
      const picture = v.image;
      if (!record(picture) || picture.mediaType !== "image/png" || typeof picture.data !== "string" || picture.data.length > 873816
        || !/^iVBORw0KGg[opqr][A-Za-z0-9+/]*(?:={1,2})?$/u.test(picture.data) || picture.data.length % 4 !== 0
        || picture.data.length / 4 * 3 - (picture.data.endsWith("==") ? 2 : picture.data.endsWith("=") ? 1 : 0) > 655360) throw new Error("amf_recipe_image_invalid");
      return { mediaType: "image/png", data: picture.data };
    },
    async prepareRecipe(recipeId, editorPath, materialChoices) { return accepted(await call({ method: "amf.production.prepareRecipe", params: { schemaVersion: "0.1", recipeId, editorPath,...(materialChoices !== undefined ? {materialChoices} : {}) } }), strings.amfProduction.preparing); },
    async list() {
      const v = await call({ method: "amf.production.list", params: { schemaVersion: "0.1" } });
      if (!record(v) || v.schemaVersion !== "0.1" || !Array.isArray(v.sources) || !v.sources.every(source) || !Array.isArray(v.editors) || !v.editors.every(editor)
        || typeof v.busy !== "boolean" || !Array.isArray(v.runs) || !v.runs.every(r => record(r) && text(r.runId) && typeof r.phase === "string" && phases.includes(r.phase) && texts(r.sourceNames) && (r.projectGone === undefined || r.projectGone === true)
          && (r.recipeId === undefined || (typeof r.recipeId === "string" && /^[a-zA-Z0-9-]{1,100}$/u.test(r.recipeId))))
        || !isAmfProductionCapacity(v.capacity) || !Array.isArray(v.running) || v.running.length > v.capacity || !v.running.every(work)
        || v.busy !== (v.running.length > 0)
        || !Array.isArray(v.queue) || v.queue.length > 64 || !v.queue.every(work)) throw new Error("amf_production_list_invalid");
      return v as unknown as AmfProductionList;
    },
    async setCapacity(capacity) {
      const v = await call({ method: "amf.production.setCapacity", params: { schemaVersion: "0.1", capacity } });
      if (!record(v) || v.schemaVersion !== "0.1" || !isAmfProductionCapacity(v.capacity) || v.capacity !== capacity) throw new Error("amf_production_capacity_invalid");
      return v.capacity;
    },
    async get(runId) {
      const v = await call({ method: "amf.production.get", params: { schemaVersion: "0.1", runId } });
      const problem = amfRunProblem(v) ?? (record(v) && v.runId !== runId ? "runId" : null);
      if (problem !== null) throw new Error(`amf_production_run_invalid: ${problem}`);
      return v as AmfProductionRun;
    },
    async prepare(sources, editorPath) { return accepted(await call({ method: "amf.production.prepare", params: { schemaVersion: "0.1", sources, editorPath } }), strings.amfProduction.preparing); },
    async plan(runId, selection) {
      const v = await call({ method: "amf.production.plan", params: { schemaVersion: "0.1", runId, selection } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || typeof v.planDigest !== "string" || !/^[a-f0-9]{64}$/u.test(v.planDigest) || !Array.isArray(v.inputs)
        || !isAmfAssemblySelection(v.selection) || v.preserveOriginals !== true || v.officialSdkChecks !== "not_run" || !editor(v.editor) || !text(v.projectRoot)
        || !v.inputs.every(i => record(i) && text(i.sourceId) && text(i.name) && ["avatar", "outfit", "import_only"].includes(String(i.role)))
        || (v.parameterBudget !== undefined && !isAmfParameterBudgetPlan(v.parameterBudget))
        || (v.prediction !== undefined && !isAmfPlanPrediction(v.prediction))
        || !planFits(v.fits) || !hasValidAmfRecipeReview(v)) throw new Error("amf_production_plan_invalid");
      return v as unknown as AmfProductionPlan;
    },
    async assemble(runId, plan, recipeDifferencesConfirmed) { return accepted(await call({ method: "amf.production.assemble", params: { schemaVersion: "0.1", runId, planDigest: plan.planDigest, selection: plan.selection,...(recipeDifferencesConfirmed !== undefined ? {recipeDifferencesConfirmed} : {}) } }), strings.amfProduction.assembling); },
    async reinspect(runId) { return accepted(await call({ method: "amf.production.reinspect", params: { schemaVersion: "0.1", runId } }), strings.amfProduction.reinspect); },
    async faceTrackingPlan(runId, menuId) {
      const value = await call({ method: "amf.production.faceTrackingPlan", params: { schemaVersion: "0.1", runId, menuId } });
      if (!isFaceTrackingPlan(value) || value.runId !== runId || value.menu.id !== menuId) throw new Error("amf_face_tracking_plan_invalid");
      return value;
    },
    async faceTrackingPatch(runId, menuId, planDigest, confirmTrustedCode, title) {
      return accepted(await call({ method: "amf.production.faceTrackingPatch", params: { schemaVersion: "0.1", runId, menuId, planDigest, confirmTrustedCode } }), title);
    },
    async sdkFix(runId, fixes) { return accepted(await call({ method: "amf.production.sdkFix", params: { schemaVersion: "0.1", runId, fixes: [...fixes] } }), strings.sdkReview.fixTitle); },
    async changeSources(runId, sources) { return accepted(await call({ method: "amf.production.changeSources", params: { schemaVersion: "0.1", runId, sources: [...sources] } }), strings.factory.panels.materials.change); },
    async planTextureMemory(runId, platform, targetRank) {
      const value = await call({ method: "amf.production.planTextureMemory", params: { schemaVersion: "0.1", runId, platform, targetRank } });
      if (!isAmfTextureMemoryPlan(value) || value.runId !== runId) throw new Error("amf_production_texture_plan_invalid");
      return value;
    },
    async applyTextureMemory(runId, plan, textures) {
      if (plan.runId !== runId || !isAmfTextureMemoryPlan(plan)) throw new Error("amf_production_texture_plan_invalid");
      return accepted(await call({ method: "amf.production.applyTextureMemory", params: { schemaVersion: "0.1", runId, platform: plan.plan.platform,
        targetRank: plan.plan.targetRank, planDigest: plan.planDigest, textures: [...textures] } }), strings.textureMemory.task);
    },
    async planOutfitRemoval(runId, sourceId) {
      const value = await call({method:"amf.production.planOutfitRemoval", params:{schemaVersion:"0.1",runId,sourceId}});
      if (!isOutfitRemovalPlan(value) || value.runId !== runId || value.removal.sourceId !== sourceId) throw new Error("amf_outfit_removal_plan_invalid");
      return value;
    },
    async removeOutfit(runId, plan, confirmed) {
      if (!isOutfitRemovalPlan(plan) || plan.runId !== runId || confirmed !== true) throw new Error("amf_outfit_removal_confirmation_required");
      return accepted(await call({method:"amf.production.removeOutfit",params:{schemaVersion:"0.1",runId,sourceId:plan.removal.sourceId,planDigest:plan.planDigest,confirmed}}), strings.outfitRemoval.title);
    },
    async planLighting(runId) {
      const v = await call({ method: "amf.production.planLighting", params: { schemaVersion: "0.1", runId } });
      const limits = (l: unknown): l is AmfLightingLimits => record(l) && text(l.min) && text(l.max);
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || typeof v.planDigest !== "string" || !/^[a-f0-9]{64}$/u.test(v.planDigest)
        || !(v.reference === null || limits(v.reference))
        || !(v.referenceReason === null || ["no_avatar_liltoon", "tie"].includes(String(v.referenceReason)))
        || (v.reference === null) !== (v.referenceReason !== null)
        || !Array.isArray(v.entries) || v.entries.length > 512
        || !v.entries.every(e => record(e) && text(e.material) && text(e.sourceId) && limits(e.current) && limits(e.proposed))
        || !Array.isArray(v.skipped) || v.skipped.length > 512
        || !v.skipped.every(s => record(s) && text(s.material) && s.reason === "shared_with_avatar")) throw new Error("amf_production_lighting_plan_invalid");
      return v as unknown as AmfLightingPlan;
    },
    async applyLighting(runId, plan, materials) {
      if (plan.runId !== runId) throw new Error("amf_production_lighting_plan_invalid");
      return accepted(await call({ method: "amf.production.applyLighting", params: { schemaVersion: "0.1", runId, planDigest: plan.planDigest, materials: [...materials] } }), strings.factory.panels.lighting.task);
    },
    async setOptimizer(runId, enabled, title) {
      return accepted(await call({ method: "amf.production.setOptimizer", params: { schemaVersion: "0.1", runId, enabled } }), title ?? strings.amfProduction.assembling);
    },
    async delete(runId) { return accepted(await call({ method: "amf.production.delete", params: { schemaVersion: "0.1", runId } }), strings.factory.lineMenu.delete); },
    async rollbackPlan(runId) {
      const v = await call({ method: "amf.production.rollbackPlan", params: { schemaVersion: "0.1", runId } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || !text(v.planDigest) || !/^[a-f0-9]{64}$/u.test(v.planDigest)
        || !text(v.snapshotId) || !v.snapshotId || !text(v.projectRoot) || typeof v.currentChanged !== "boolean" || v.preserveCurrent !== true
        || (v.prePatch !== undefined && !(record(v.prePatch) && text(v.prePatch.snapshotId) && v.prePatch.snapshotId
          && text(v.prePatch.planDigest) && /^[a-f0-9]{64}$/u.test(v.prePatch.planDigest)))) throw new Error("amf_production_restore_plan_invalid");
      return v as unknown as AmfProductionRestorePlan;
    },
    async rollback(runId, plan, target) {
      if (plan.runId !== runId) throw new Error("amf_production_restore_plan_invalid");
      const digest = target === "prePatch" ? plan.prePatch?.planDigest : plan.planDigest;
      if (!text(digest)) throw new Error("amf_production_restore_plan_invalid");
      return accepted(await call({ method: "amf.production.rollback", params: { schemaVersion: "0.1", runId, planDigest: digest, ...(target !== undefined ? { target } : {}) } }), strings.amfProduction.restoring);
    },
    async revisionPlan(runId, revisionId) {
      const v = await call({ method: "amf.production.revisionPlan", params: { schemaVersion: "0.1", runId, revisionId } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || v.revisionId !== revisionId
        || !text(v.planDigest) || !/^[a-f0-9]{64}$/u.test(v.planDigest)
        || !revisionKinds.includes(String(v.before)) || !text(v.takenAt) || !revisionSummary(v.summary)
        || typeof v.editedInUnity !== "boolean" || (v.warning !== null && !text(v.warning))
        || !Array.isArray(v.steps) || !v.steps.every(s => record(s) && ["materials", "assembly", "lighting", "sdk_fix", "optimizer"].includes(String(s.key)) && typeof s.skipped === "boolean"
          && (s.rebuild === undefined || typeof s.rebuild === "boolean")
          && (s.enabled === undefined || typeof s.enabled === "boolean")
          && (s.materials === undefined || (Array.isArray(s.materials) && s.materials.every(m => record(m) && text(m.material) && text(m.min) && text(m.max))))
          && (s.fixes === undefined || texts(s.fixes)))) throw new Error("amf_production_revision_plan_invalid");
      return v as unknown as AmfProductionRevisionPlan;
    },
    async restoreRevision(runId, plan) {
      if (plan.runId !== runId) throw new Error("amf_production_revision_plan_invalid");
      return accepted(await call({ method: "amf.production.restoreRevision", params: { schemaVersion: "0.1", runId, revisionId: plan.revisionId, planDigest: plan.planDigest } }), strings.amfProduction.restoring);
    },
    async saveFit(runId, sourceId, name, changesDigest) {
      const v = await call({ method: "amf.production.saveFit", params: { schemaVersion: "0.1", runId, sourceId, name, changesDigest } });
      if (!record(v) || v.schemaVersion !== "0.1" || !text(v.fitId) || !/^fit-[A-Za-z0-9_-]{1,72}$/u.test(v.fitId)
        || v.name !== name || !text(v.createdAt) || !text(v.updatedAt)) throw new Error("amf_production_save_fit_invalid");
      return { fitId: v.fitId, name: v.name as string, createdAt: v.createdAt, updatedAt: v.updatedAt };
    },
    async listFits() {
      const v = await call({ method: "amf.production.listFits", params: { schemaVersion: "0.1" } });
      if (!record(v) || v.schemaVersion !== "0.1" || !Array.isArray(v.fits)
        || !v.fits.every(f => record(f) && text(f.fitId) && text(f.name) && text(f.createdAt) && text(f.updatedAt)
          && fitMaterial(f.garment) && fitMaterial(f.avatar)
          && Number.isSafeInteger(f.objectCount) && Number(f.objectCount) >= 0)) throw new Error("amf_production_fit_list_invalid");
      return v.fits as unknown as readonly AmfFitSummary[];
    },
    async renameFit(fitId, name) {
      const v = await call({ method: "amf.production.renameFit", params: { schemaVersion: "0.1", fitId, name } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.fitId !== fitId || v.name !== name) throw new Error("amf_production_rename_fit_invalid");
      return { fitId, name };
    },
    async deleteFit(fitId) {
      const v = await call({ method: "amf.production.deleteFit", params: { schemaVersion: "0.1", fitId } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.fitId !== fitId) throw new Error("amf_production_delete_fit_invalid");
    },
    async previewImage(runId, path) {
      const v = await call({ method: "amf.production.previewImage", params: { schemaVersion: "0.1", runId, path } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || v.path !== path || v.mediaType !== "image/png"
        || !text(v.data) || v.data.length > 900_000 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/u.test(v.data)) throw new Error("amf_production_preview_invalid");
      return `data:image/png;base64,${v.data}`;
    },
    async closeEditor(runId, confirmed, title) { return accepted(await call({ method: "amf.production.closeEditor", params: { schemaVersion: "0.1", runId, confirmed } }), title); },
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

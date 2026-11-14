import { isTermsProductId } from "./terms-v01.js";

/** Candidate glb-inspection v0.1 (0.1.0): AMF-owned pure-Rust streaming inspection
 * of warehouse .glb / .vrm artifacts (standalone files and unexpanded .zip members),
 * VRM 1.0 / VRM 0.x metadata, and scene world-space bounding boxes. */
export const GLB_INSPECTION_SCHEMA = "vua.glb-inspection/v0.1" as const;

export const GLB_FORMATS_V01 = [
  "vrm_1_0",
  "vrm_0_x",
  "glb_2_0",
  "invalid_glb",
] as const;
export type GlbFormatV01 = typeof GLB_FORMATS_V01[number];

export const GLB_SOURCE_KINDS_V01 = [
  "standalone_file",
  "zip_member",
] as const;
export type GlbSourceKindV01 = typeof GLB_SOURCE_KINDS_V01[number];

export type InspectGlbParamsV01 =
  | { readonly schemaVersion: "0.1"; readonly productId: string }
  | { readonly schemaVersion: "0.1"; readonly entryId: string };

export interface GlbContentSummaryV01 {
  readonly meshCount: number;
  readonly primitiveCount: number;
  readonly triangleEstimate: number;
  readonly skinCount: number;
  readonly nodeCount: number;
  readonly animationCount: number;
}

export interface GlbMaterialSummaryV01 {
  readonly materialCount: number;
  readonly unlitMaterialCount: number;
  readonly mtoonMaterialCount: number;
}

export interface GlbTextureSummaryV01 {
  readonly textureCount: number;
  readonly embeddedImageCount: number;
  readonly externalUriTextureCount: number;
}

export interface GlbSecondaryMotionSummaryV01 {
  readonly springBoneJointCount: number;
  readonly nodeConstraintCount: number;
  readonly expressionCount: number;
}

export interface GlbVrmSummaryV01 {
  readonly specVersion: string | null;
  readonly hasHumanoidHeadBone: boolean;
  readonly hasFullBodyBones: boolean;
  readonly hasToeBones: boolean;
  readonly headBoneHeightMeters: number | null;
  readonly boneCount: number;
  readonly modelName: string | null;
  readonly authors: readonly string[];
  readonly avatarPermission: string | null;
  readonly commercialUsage: string | null;
  readonly modification: string | null;
  readonly licenseUrl: string | null;
}

export interface GlbBoundsMetersV01 {
  readonly size: readonly [number, number, number];
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface GlbInspectedFileV01 {
  readonly copyId: string;
  readonly fileName: string;
  readonly sourceKind: GlbSourceKindV01;
  readonly containerFileName: string | null;
  readonly sizeBytes: number;
  readonly format: GlbFormatV01;
  readonly extensionsUsed: readonly string[];
  readonly contentSummary: GlbContentSummaryV01 | null;
  readonly materialSummary: GlbMaterialSummaryV01 | null;
  readonly textureSummary: GlbTextureSummaryV01 | null;
  readonly secondaryMotion: GlbSecondaryMotionSummaryV01 | null;
  readonly vrm: GlbVrmSummaryV01 | null;
  readonly boundsMeters: GlbBoundsMetersV01 | null;
}

export interface GlbInspectionResultV01 {
  readonly schemaVersion: typeof GLB_INSPECTION_SCHEMA;
  readonly items: readonly GlbInspectedFileV01[];
  readonly truncated: boolean;
}

export interface InspectGlbGatewayRequestV1 {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly method: "library.inspectGlb";
  readonly params: InspectGlbParamsV01;
}

function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function exactKeys(v: unknown, expected: readonly string[]): v is Record<string, unknown> {
  return record(v) && Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
}

function nullableString(v: unknown, max: number): v is string | null {
  return v === null || (typeof v === "string" && v.length <= max);
}

function boundedInt(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
}

function vec3(v: unknown, nonNegative = false): v is readonly [number, number, number] {
  return Array.isArray(v)
    && v.length === 3
    && v.every(n => typeof n === "number" && Number.isFinite(n) && (!nonNegative || n >= 0));
}

export function isInspectGlbParamsV01(v: unknown): v is InspectGlbParamsV01 {
  if (!record(v) || v.schemaVersion !== "0.1") return false;
  const keys = Object.keys(v);
  if (keys.length === 2 && Object.hasOwn(v, "schemaVersion") && Object.hasOwn(v, "productId")) {
    return isTermsProductId(v.productId);
  }
  if (keys.length === 2 && Object.hasOwn(v, "schemaVersion") && Object.hasOwn(v, "entryId")) {
    return typeof v.entryId === "string"
      && v.entryId.length >= 1
      && v.entryId.length <= 128
      && !/[\\/]/u.test(v.entryId);
  }
  return false;
}

function isContentSummary(v: unknown): v is GlbContentSummaryV01 {
  if (!exactKeys(v, [
    "meshCount",
    "primitiveCount",
    "triangleEstimate",
    "skinCount",
    "nodeCount",
    "animationCount",
  ])) return false;
  return boundedInt(v.meshCount, 65_536)
    && boundedInt(v.primitiveCount, 1_000_000)
    && boundedInt(v.triangleEstimate, 1_000_000_000)
    && boundedInt(v.skinCount, 4_096)
    && boundedInt(v.nodeCount, 65_536)
    && boundedInt(v.animationCount, 4_096);
}

function isMaterialSummary(v: unknown): v is GlbMaterialSummaryV01 {
  if (!exactKeys(v, [
    "materialCount",
    "unlitMaterialCount",
    "mtoonMaterialCount",
  ])) return false;
  return boundedInt(v.materialCount, 16_384)
    && boundedInt(v.unlitMaterialCount, 16_384)
    && boundedInt(v.mtoonMaterialCount, 16_384);
}

function isTextureSummary(v: unknown): v is GlbTextureSummaryV01 {
  if (!exactKeys(v, [
    "textureCount",
    "embeddedImageCount",
    "externalUriTextureCount",
  ])) return false;
  return boundedInt(v.textureCount, 16_384)
    && boundedInt(v.embeddedImageCount, 16_384)
    && boundedInt(v.externalUriTextureCount, 16_384);
}

function isSecondaryMotionSummary(v: unknown): v is GlbSecondaryMotionSummaryV01 {
  if (!exactKeys(v, [
    "springBoneJointCount",
    "nodeConstraintCount",
    "expressionCount",
  ])) return false;
  return boundedInt(v.springBoneJointCount, 65_536)
    && boundedInt(v.nodeConstraintCount, 65_536)
    && boundedInt(v.expressionCount, 4_096);
}

function isVrmSummary(v: unknown): v is GlbVrmSummaryV01 {
  if (!exactKeys(v, [
    "specVersion",
    "hasHumanoidHeadBone",
    "hasFullBodyBones",
    "hasToeBones",
    "headBoneHeightMeters",
    "boneCount",
    "modelName",
    "authors",
    "avatarPermission",
    "commercialUsage",
    "modification",
    "licenseUrl",
  ])) return false;
  return nullableString(v.specVersion, 32)
    && typeof v.hasHumanoidHeadBone === "boolean"
    && typeof v.hasFullBodyBones === "boolean"
    && typeof v.hasToeBones === "boolean"
    && (v.headBoneHeightMeters === null
      || (typeof v.headBoneHeightMeters === "number"
        && Number.isFinite(v.headBoneHeightMeters)
        && v.headBoneHeightMeters >= 0
        && v.headBoneHeightMeters <= 10))
    && boundedInt(v.boneCount, 512)
    && nullableString(v.modelName, 256)
    && Array.isArray(v.authors)
    && v.authors.length <= 32
    && v.authors.every(a => typeof a === "string" && a.length <= 256)
    && nullableString(v.avatarPermission, 64)
    && nullableString(v.commercialUsage, 64)
    && nullableString(v.modification, 64)
    && nullableString(v.licenseUrl, 2048);
}

function isSafeRelativeFileName(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 1 || v.length > 512) return false;
  // Never expose Windows drive prefixes, UNC paths, or parent-directory traversal.
  if (/^[A-Za-z]:/u.test(v) || v.startsWith("\\\\") || v.startsWith("/") || v.includes("..\\") || v.includes("../")) {
    return false;
  }
  return !v.includes("\\");
}

function isGlbInspectedFile(v: unknown): v is GlbInspectedFileV01 {
  if (!exactKeys(v, [
    "copyId",
    "fileName",
    "sourceKind",
    "containerFileName",
    "sizeBytes",
    "format",
    "extensionsUsed",
    "contentSummary",
    "materialSummary",
    "textureSummary",
    "secondaryMotion",
    "vrm",
    "boundsMeters",
  ])) return false;
  if (typeof v.copyId !== "string" || v.copyId.length < 1 || v.copyId.length > 128) return false;
  if (!isSafeRelativeFileName(v.fileName)) return false;
  if (!GLB_SOURCE_KINDS_V01.includes(v.sourceKind as GlbSourceKindV01)) return false;
  if (v.containerFileName !== null && !isSafeRelativeFileName(v.containerFileName)) return false;
  if (typeof v.sizeBytes !== "number" || !Number.isSafeInteger(v.sizeBytes) || v.sizeBytes < 0) return false;
  if (!GLB_FORMATS_V01.includes(v.format as GlbFormatV01)) return false;
  if (!Array.isArray(v.extensionsUsed) || v.extensionsUsed.length > 64) return false;
  if (!v.extensionsUsed.every(e => typeof e === "string" && e.length >= 1 && e.length <= 128)) return false;
  if (v.contentSummary !== null && !isContentSummary(v.contentSummary)) return false;
  if (v.materialSummary !== null && !isMaterialSummary(v.materialSummary)) return false;
  if (v.textureSummary !== null && !isTextureSummary(v.textureSummary)) return false;
  if (v.secondaryMotion !== null && !isSecondaryMotionSummary(v.secondaryMotion)) return false;
  if (v.vrm !== null && !isVrmSummary(v.vrm)) return false;
  if (v.boundsMeters !== null) {
    if (!exactKeys(v.boundsMeters, ["size", "min", "max"])) return false;
    if (!vec3(v.boundsMeters.size, true) || !vec3(v.boundsMeters.min) || !vec3(v.boundsMeters.max)) return false;
  }
  return true;
}

export function isGlbInspectionResultV01(v: unknown): v is GlbInspectionResultV01 {
  if (!exactKeys(v, ["schemaVersion", "items", "truncated"])) return false;
  if (v.schemaVersion !== GLB_INSPECTION_SCHEMA || typeof v.truncated !== "boolean") return false;
  if (!Array.isArray(v.items) || v.items.length > 64) return false;
  return v.items.every(isGlbInspectedFile);
}

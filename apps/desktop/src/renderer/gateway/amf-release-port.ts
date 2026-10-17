import { AMF_TURNTABLE_FRAMES, isAmfAvatarName, type AiUploadConfirmationV01, type AmfProductionBodyV01 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { registerTaskIdentity } from "./task-identity.ts";
import { strings } from "../i18n/index.ts";

export const AMF_UPLOAD_STAGES = ["starting", "sdk_panel", "sign_in", "checking", "building", "uploading", "finishing"] as const;
export type AmfUploadStage = typeof AMF_UPLOAD_STAGES[number];
export const AMF_UPLOAD_REASONS = ["sign_in_required", "no_publish_permission", "validation", "ownership", "agreement_declined", "build", "build_blocked",
  "upload", "thumbnail_missing", "avatar_missing", "scene_not_saved", "interrupted", "editor_unavailable", "timeout", "cancelled", "unknown"] as const;
export type AmfUploadReason = typeof AMF_UPLOAD_REASONS[number];

export interface AmfUpload {
  readonly uploadId: string; readonly avatarName: string; readonly startedAt: string; readonly endedAt: string | null;
  readonly state: "running" | "succeeded" | "failed" | "cancelled"; readonly stage: AmfUploadStage;
  /** Upload share from 0 to 1 while the SDK sends the bundle. */
  readonly progress: number | null; readonly status: string;
  readonly blueprintId: string | null; readonly firstUpload: boolean | null;
  readonly reason: AmfUploadReason | null; readonly detail: string; readonly errors: readonly string[];
  /** How the SDK panel signed in for this upload: with the VUA session, or in the panel. */
  readonly sdkSignIn?: "vua_session" | "panel" | null;
}
export interface AmfTurntable { readonly frames: number; readonly size: number; readonly bakedAt: string; readonly current: boolean }
export interface AmfReleaseState {
  readonly runId: string; readonly turntable: AmfTurntable | null;
  /** Newest first. */
  readonly uploads: readonly AmfUpload[];
  /** Unity holds the work project now; an upload then uses the scene as it is there. */
  readonly editorOpen: boolean;
}
export interface AmfReleaseAccepted { readonly runId: string; readonly taskId: string }
export interface AmfReleasePort {
  state(runId: string): Promise<AmfReleaseState>;
  /** A `data:image/png` URL for one turntable frame. */
  turntableFrame(runId: string, index: number): Promise<string>;
  bakeTurntable(runId: string): Promise<AmfReleaseAccepted>;
  /** Starts only with the player's own rights confirmation for this upload. */
  upload(runId: string, confirmation: AiUploadConfirmationV01): Promise<AmfReleaseAccepted>;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const blueprint = (v: unknown) => v === null || (text(v) && /^avtr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u.test(v));
function upload(v: unknown): v is AmfUpload {
  return record(v) && [v.uploadId, v.avatarName, v.startedAt, v.status, v.detail].every(text) && nullableText(v.endedAt)
    && ["running", "succeeded", "failed", "cancelled"].includes(String(v.state)) && (AMF_UPLOAD_STAGES as readonly string[]).includes(String(v.stage))
    && (v.progress === null || (typeof v.progress === "number" && v.progress >= 0 && v.progress <= 1))
    && blueprint(v.blueprintId) && (v.firstUpload === null || typeof v.firstUpload === "boolean")
    && (v.reason === null || (AMF_UPLOAD_REASONS as readonly string[]).includes(String(v.reason)))
    && Array.isArray(v.errors) && v.errors.length <= 32 && v.errors.every(text)
    && (v.sdkSignIn === null || v.sdkSignIn === undefined || ["vua_session", "panel"].includes(String(v.sdkSignIn)))
    && (v.state !== "succeeded" || v.blueprintId !== null);
}
export function isAmfReleaseState(v: unknown, runId: string): v is AmfReleaseState {
  if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || typeof v.editorOpen !== "boolean" || !Array.isArray(v.uploads) || v.uploads.length > 10) return false;
  const t = v.turntable;
  return (t === null || (record(t) && t.frames === AMF_TURNTABLE_FRAMES && t.size === 512 && text(t.bakedAt) && typeof t.current === "boolean"))
    && v.uploads.every(upload);
}

export function createAmfReleasePort(client: GatewayClient): AmfReleasePort {
  const call = async (body: AmfProductionBodyV01): Promise<unknown> => {
    const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), ...body });
    if (!response.ok) {
      const error = response.error;
      // The code names what the release room explains; the detail stays for "Details".
      if (error.kind === "application") throw Object.assign(new Error(typeof error.error.params?.detail === "string" ? error.error.params.detail : error.error.code), { code: error.error.code });
      throw new Error(error.kind);
    }
    return response.value;
  };
  const accepted = (value: unknown, title: string): AmfReleaseAccepted => {
    if (!record(value) || value.schemaVersion !== "0.1" || !text(value.runId) || !text(value.taskId) || !value.taskId) throw new Error("amf_release_receipt_invalid");
    registerTaskIdentity(value.taskId, { title, originPage: "release", notifyOnComplete: true });
    return { runId: value.runId, taskId: value.taskId };
  };
  return {
    async state(runId) {
      const v = await call({ method: "amf.production.releaseState", params: { schemaVersion: "0.1", runId } });
      if (!isAmfReleaseState(v, runId)) throw new Error("amf_release_state_invalid");
      return v;
    },
    async turntableFrame(runId, index) {
      const v = await call({ method: "amf.production.turntableFrame", params: { schemaVersion: "0.1", runId, index } });
      if (!record(v) || v.schemaVersion !== "0.1" || v.runId !== runId || v.index !== index || v.mediaType !== "image/png"
        || !text(v.data) || v.data.length > 900_000 || !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/u.test(v.data)) throw new Error("amf_release_frame_invalid");
      return `data:image/png;base64,${v.data}`;
    },
    async bakeTurntable(runId) {
      return accepted(await call({ method: "amf.production.bakeTurntable", params: { schemaVersion: "0.1", runId } }), strings.releaseRoom.turntable.baking);
    },
    async upload(runId, confirmation) {
      if (confirmation.rightsConfirmed !== true || !isAmfAvatarName(confirmation.avatarName)) throw new Error("amf_release_confirmation_invalid");
      return accepted(await call({ method: "amf.production.upload", params: { schemaVersion: "0.1", runId, avatarName: confirmation.avatarName, rightsConfirmed: true } }),
        strings.releaseRoom.upload.button);
    },
  };
}

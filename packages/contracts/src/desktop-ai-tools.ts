import type { VuaDesktopApiV3 } from "./desktop-distribution.js";
import { isAmfAvatarName } from "./amf-production-v01.js";
export type AiConnectionLocale = "en" | "zh-CN" | "ja" | "ko";
/** A request waits until the player decides or the AI withdraws it, also across VUA restarts.
 * `error` names why a request failed or was withdrawn. */
export interface AiActionRequestV01 {
  readonly id: string; readonly tool: string; readonly title: string; readonly explanation: string;
  readonly expectedResult: string; readonly createdAt: string;
  readonly state: "pending" | "running" | "accepted" | "rejected" | "withdrawn" | "failed";
  readonly details: Readonly<Record<string,unknown>>; readonly result?: unknown; readonly error?: string;
}
export interface AiToolsSnapshotV01 {
  readonly schemaVersion: "0.1"; readonly enabled: boolean; readonly endpoint: string | null;
  readonly connections: number; readonly requests: readonly AiActionRequestV01[]; readonly error: string | null;
}
/** The player's own confirmation of an AI upload request, given in the Release page's upload dialog. */
export interface AiUploadConfirmationV01 { readonly avatarName: string; readonly rightsConfirmed: true }
export function isAiUploadConfirmationV01(value: unknown): value is AiUploadConfirmationV01 {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 2
    && isAmfAvatarName((value as Record<string, unknown>).avatarName) && (value as Record<string, unknown>).rightsConfirmed === true;
}
export interface DesktopAiToolsApiV01 {
  snapshot(): Promise<AiToolsSnapshotV01>;
  setEnabled(enabled:boolean):Promise<AiToolsSnapshotV01>;
  prompt(locale:AiConnectionLocale):Promise<string>;
  copyPrompt(locale:AiConnectionLocale):Promise<void>;
  /** `confirmation` completes an upload request with the player's own rights confirmation. */
  resolve(id:string,decision:"approve"|"reject",confirmation?:AiUploadConfirmationV01):Promise<AiToolsSnapshotV01>;
  subscribe(listener:(snapshot:AiToolsSnapshotV01)=>void):()=>void;
  /** While VUA is not the foreground window: blink the tray icon and flash the taskbar button. */
  attention?():Promise<void>;
}
export interface VuaDesktopApiV4 extends VuaDesktopApiV3 {readonly aiTools?:DesktopAiToolsApiV01}

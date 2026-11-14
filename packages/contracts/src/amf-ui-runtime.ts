/** First-party AMF UI generation handshake; paths and code selection remain Main-owned. */
import type { VuaDesktopApiV6 } from "./update-plans.js";
export interface AmfUiGenerationV01 {
  readonly id: string;
  readonly instanceId: string;
  readonly version: string;
  readonly build: string;
  readonly uiAbi: "amf-ui/0.1";
}
export type AmfUiTransitionV01 = "quiescing" | "loading";
export interface AmfUiRuntimeSnapshotV01 {
  readonly schemaVersion: "0.1";
  readonly available: boolean;
  readonly phase: "idle" | AmfUiTransitionV01 | "restoring";
  readonly active?: AmfUiGenerationV01 | undefined;
  readonly candidate?: AmfUiGenerationV01 | undefined;
  readonly transactionId?: string | undefined;
  readonly error?: string | undefined;
}
export interface DesktopAmfUiRuntimeApiV01 {
  snapshot(): Promise<AmfUiRuntimeSnapshotV01>;
  respond(transactionId: string, phase: AmfUiTransitionV01, accepted: boolean, reason?: "busy" | "restart_required" | "failed"): Promise<void>;
  subscribe(listener: (snapshot: AmfUiRuntimeSnapshotV01) => void): () => void;
}
/** Each connected tool's own icon as a data URL, or null while it cannot be fetched. */
export interface DesktopToolLogosApiV01 {
  logo(toolId: string): Promise<string | null>;
}
/** Narrow Electron Main surface for EAC folder location and experimental termination consent. */
export interface DesktopEacApiV01 {
  openRepairFolder(): Promise<{ readonly opened: boolean }>;
  getExperimentalTermination(): Promise<{ readonly enabled: boolean }>;
  setExperimentalTermination(enabled: boolean): Promise<{ readonly enabled: boolean }>;
}
export interface VuaDesktopApiV7 extends VuaDesktopApiV6 {
  readonly amfUiRuntime?: DesktopAmfUiRuntimeApiV01;
  readonly toolLogos?: DesktopToolLogosApiV01;
  readonly guideContent?: import("./guide-content.js").DesktopGuideContentApiV01;
  readonly eac?: DesktopEacApiV01;
}

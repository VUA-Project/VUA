import { describe, expect, it } from "vitest";
import type { ExternalToolSnapshot } from "@vua/contracts";
import { deriveToolCardState } from "./tool-connection-state.ts";

const base: ExternalToolSnapshot = { schemaVersion: "vua.external-tool/v0.2", toolId: "space", capturedAt: "synthetic", presence: "missing", steamReady: true, buildId: null, running: false, canStop: false, activity: "idle", issue: null };
const live = (snapshot: ExternalToolSnapshot | null, pending = false, failed = false) => ({ snapshot, pending, failed });

describe("SteamToolCard state derivation", () => {
  it("waits for the first observation and reports provider failure as unknown", () => {
    expect(deriveToolCardState(live(null))).toEqual({ action: "unknown", status: "checking" });
    expect(deriveToolCardState(live(null, false, true))).toEqual({ action: "unknown", status: "unknown" });
  });
  it("offers install only for a readable absence with Steam ready", () => {
    expect(deriveToolCardState(live(base))).toEqual({ action: "prepare", status: "install" });
    expect(deriveToolCardState(live({ ...base, presence: "incomplete" }))).toEqual({ action: "prepare", status: "install" });
    expect(deriveToolCardState(live({ ...base, presence: "unknown" }))).toEqual({ action: "unknown", status: "unknown" });
  });
  it("routes a missing Steam runtime to preparation instead of a dead install", () => {
    expect(deriveToolCardState(live({ ...base, steamReady: false }))).toEqual({ action: "prepare", status: "prepareSteam" });
    expect(deriveToolCardState(live({ ...base, steamReady: false, presence: "installed" }))).toEqual({ action: "prepare", status: "prepareSteam" });
  });
  it("starts installed tools, shows running state and limits close to owned instances", () => {
    expect(deriveToolCardState(live({ ...base, presence: "installed", buildId: "123" }))).toEqual({ action: "start", status: "openApp" });
    expect(deriveToolCardState(live({ ...base, presence: "installed", buildId: "123", running: true }))).toEqual({ action: "start", status: "running" });
    expect(deriveToolCardState(live({ ...base, presence: "installed", buildId: "123", running: true, canStop: true }))).toEqual({ action: "stop", status: "closeApp" });
  });
  it("keeps close authority above Steam preparation for owned instances", () => {
    expect(deriveToolCardState(live({ ...base, steamReady: false, running: true, canStop: true }))).toEqual({ action: "stop", status: "closeApp" });
  });
  it("reports busy for each handoff phase and during a pending action", () => {
    expect(deriveToolCardState(live({ ...base, activity: "install_requested" }))).toEqual({ action: "busy", status: "waitInstall" });
    expect(deriveToolCardState(live({ ...base, presence: "installed", activity: "starting" }))).toEqual({ action: "busy", status: "waitOpen" });
    expect(deriveToolCardState(live({ ...base, presence: "installed", running: true, canStop: true, activity: "stopping" }))).toEqual({ action: "busy", status: "waitClose" });
    expect(deriveToolCardState(live(base, true))).toEqual({ action: "busy", status: "waitOpen" });
  });
});

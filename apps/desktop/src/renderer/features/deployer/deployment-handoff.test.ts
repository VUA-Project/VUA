import { describe, expect, it } from "vitest";
import { readDeploymentManualHandoff } from "./deployment-handoff.ts";

describe("returned deployment handoff", () => {
  const result = { outcome: "manual_required", prerequisitesReady: false,
    nextStep: { component: "vrchat", action: "manual_install", officialUrl: "https://store.steampowered.com/app/438100/" } };
  it("retains the authoritative Steam destination without a saved plan", () => {
    expect(readDeploymentManualHandoff(result)).toEqual({ component: "vrchat", officialUrl: result.nextStep.officialUrl });
  });
  it("rejects a foreign URL or the destination for a different component", () => {
    for (const officialUrl of ["https://example.invalid/", "steam://uninstall/438100", "https://store.steampowered.com/app/250820/"]) {
      expect(readDeploymentManualHandoff({ ...result, nextStep: { ...result.nextStep, officialUrl } })).toBeNull();
    }
  });
  it("does not invent a manual step from completion, failure or malformed data", () => {
    for (const value of [null, {}, { ...result, outcome: "prerequisites_verified" }, { ...result, nextStep: null },
      { ...result, nextStep: { ...result.nextStep, component: "unknown" } },
      { ...result, nextStep: { ...result.nextStep, action: "install_steam" } }]) {
      expect(readDeploymentManualHandoff(value)).toBeNull();
    }
  });
});

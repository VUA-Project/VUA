import { describe, expect, it } from "vitest";
import { TRACKING_DEVICES, readTrackingSetup, trackingChoice } from "./vrcft-devices.ts";
describe("device-specific VRCFT instructions", () => {
  it("chooses the connection's actual module instead of one generic Quest module", () => {
    expect(trackingChoice("quest-pro", "steamlink")?.path.module).toBe("SteamLink VRCFT Module");
    expect(trackingChoice("quest-pro", "vd")?.path.module).toBe("Virtual Desktop");
    expect(trackingChoice("quest-pro", "alxr")?.path.module).toBe("ALXR Remote");
    expect(trackingChoice("galaxy-xr", "steamlink")).toBeNull();
    expect(trackingChoice("pico4-pro", "pico-connect")?.path.module).toBe("Pico4SAFTExtTrackingModule");
    expect(trackingChoice("pico4", "pico-connect")).toBeNull();
  });
  it("keeps add-on and desktop paths, package exceptions and hardware guides distinct", () => {
    expect(trackingChoice("webcam", "babble")?.hardware.tracking).toBe("face");
    expect(trackingChoice("eyetrackvr", "etvr")?.path.guide).toMatch(/^https:\/\/docs.eyetrackvr.dev\//);
    expect(trackingChoice("pimax-crystal", "tobii")?.path.package).toBe(true);
    expect(trackingChoice("galaxy-xr", "vd")?.hardware.hardwareGuide).toContain("galaxy-xr");
    expect(new Set(TRACKING_DEVICES.map(d => d.id)).size).toBe(TRACKING_DEVICES.length);
    for (const d of TRACKING_DEVICES) for (const m of d.methods) expect(m.guide).toMatch(/^https:\/\//);
  });
  it("resumes known device/connection progress and rejects stale or forged choices", () => {
    const setup = { schemaVersion: 1, device: "quest-pro", method: "vd", completed: ["hardware", "module"] };
    expect(readTrackingSetup(JSON.stringify(setup))).toEqual(setup);
    for (const patch of [{ schemaVersion: 2 }, { device: "pico4" }, { method: "meta-link" }, { completed: ["hardware", "hardware"] }, { completed: ["autodetected"] }, { completed: null }]) expect(readTrackingSetup(JSON.stringify({ ...setup, ...patch }))).toBeNull();
    expect(readTrackingSetup("broken")).toBeNull();
  });
});

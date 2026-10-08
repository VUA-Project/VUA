import { describe, expect, it } from "vitest";
import type { PlaySession } from "@vua/contracts";
import { playCardDecision } from "./play-card-model.ts";
const ready: PlaySession = { schemaVersion: "vua.play-session/v0.1", capturedAt: "fixture", route: "desktop_play", state: "idle", canStop: false, issue: null, software: ["steam", "vrchat"].map(component => ({ component: component as "steam" | "vrchat", presence: "verified", running: false, owned: false })) };
describe("environment-card actions", () => {
  it("never offers play from a missing, partial or unavailable observation", () => {
    expect(playCardDecision(ready, false, false, false).action).toBe("start");
    expect(playCardDecision(ready, true, false, false).action).toBe("unknown");
    expect(playCardDecision({ ...ready, software: ready.software.map(s => ({ ...s, presence: "missing" })) }, false, false, false).action).toBe("prepare");
    expect(playCardDecision({ ...ready, software: ready.software.map(s => ({ ...s, presence: "unusable" })) }, false, false, false).action).toBe("attention");
    expect(playCardDecision(ready, false, true, false)).toMatchObject({ action: "busy", status: "installing", spinning: true });
    expect(playCardDecision({ ...ready, state: "attention", issue: "not_installed", software: ready.software.map(s => ({ ...s, presence: "unusable" })) }, false, true, true)).toMatchObject({ action: "busy", status: "installing", spinning: true });
  });
  it("keeps close available for a pending or failed owned session", () => {
    expect(playCardDecision({ ...ready, state: "starting", canStop: true }, false, false, false)).toMatchObject({ action: "stop", spinning: true, disabled: false });
    expect(playCardDecision({ ...ready, state: "attention", canStop: true, issue: "start_timeout" }, false, false, false)).toMatchObject({ action: "stop", warning: true });
    expect(playCardDecision({ ...ready, state: "stopping", canStop: true }, false, false, false)).toMatchObject({ action: "stop", disabled: true });
    expect(playCardDecision({ ...ready, state: "attention", issue: "close_timeout" }, false, false, false)).toMatchObject({ action: "attention", status: "attention" });
  });
});

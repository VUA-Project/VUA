import { describe, expect, it } from "vitest";
import { GAME_WINDOW_OBSERVE_SCHEMA_VERSION, isGameWindowObservationResult } from "./game-window.js";
import { isApplicationRequestV01 } from "./application-contract.js";

describe("game window observation contract", () => {
  const windowFacts = {
    sessionId: "4242:0000000000010B3A",
    rectPhysical: { x: 100, y: 50, width: 1280, height: 720 },
    minimized: false,
    foreground: true,
  };
  const observationBase = { schemaVersion: GAME_WINDOW_OBSERVE_SCHEMA_VERSION, capturedAt: "2026-10-08T04:30:00Z" };

  it("accepts the well-formed query and rejects params keys, wrong kind and missing envelope keys", () => {
    const request = { requestId: "gw", method: "environment.observeGameWindow", params: {} };
    expect(isApplicationRequestV01({ ...request, contractVersion: "0.1", correlationId: "gw", kind: "query" })).toBe(true);
    expect(isApplicationRequestV01({
      ...request, contractVersion: "0.1", correlationId: "gw", kind: "query", params: { hwnd: 1 },
    })).toBe(false);
    expect(isApplicationRequestV01({ ...request, contractVersion: "0.1", correlationId: "gw", kind: "command" })).toBe(false);
    expect(isApplicationRequestV01({ ...request, contractVersion: "0.1", kind: "query" })).toBe(false);
  });

  it("accepts ready/absent/waiting observations with the state ⇔ window consistency", () => {
    expect(isGameWindowObservationResult({ gameWindow: { ...observationBase, state: "ready", window: windowFacts } })).toBe(true);
    expect(isGameWindowObservationResult({ gameWindow: { ...observationBase, state: "absent", window: null } })).toBe(true);
    expect(isGameWindowObservationResult({ gameWindow: { ...observationBase, state: "waiting", window: null } })).toBe(true);
  });

  it("rejects inconsistent states, foreign keys and malformed facts", () => {
    expect(isGameWindowObservationResult({ gameWindow: { ...observationBase, state: "ready", window: null } })).toBe(false);
    expect(isGameWindowObservationResult({ gameWindow: { ...observationBase, state: "absent", window: windowFacts } })).toBe(false);
    expect(isGameWindowObservationResult({ gameWindow: { ...observationBase, state: "closing", window: null } })).toBe(false);
    expect(isGameWindowObservationResult({ gameWindow: { ...observationBase, state: "absent", window: null, note: 1 } })).toBe(false);
    expect(isGameWindowObservationResult({
      gameWindow: { ...observationBase, state: "ready", window: { ...windowFacts, rectPhysical: { ...windowFacts.rectPhysical, width: -1 } } },
    })).toBe(false);
    expect(isGameWindowObservationResult({
      gameWindow: { ...observationBase, state: "ready", window: { ...windowFacts, rectPhysical: { ...windowFacts.rectPhysical, x: 0.5 } } },
    })).toBe(false);
    expect(isGameWindowObservationResult({
      gameWindow: { ...observationBase, state: "ready", window: { ...windowFacts, sessionId: "" } },
    })).toBe(false);
    expect(isGameWindowObservationResult({
      gameWindow: { ...observationBase, schemaVersion: "vua.game-window-observe/v9.9", state: "absent", window: null },
    })).toBe(false);
  });
});

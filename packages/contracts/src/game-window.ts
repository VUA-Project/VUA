/** VRChat game-window observation (Main-internal provider query environment.observeGameWindow). */
export const GAME_WINDOW_OBSERVE_SCHEMA_VERSION = "vua.game-window-observe/v0.1" as const;

export interface GameWindowRectPhysicalV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface GameWindowFactsV1 {
  readonly sessionId: string;
  readonly rectPhysical: GameWindowRectPhysicalV1;
  readonly minimized: boolean;
  readonly foreground: boolean;
}

export type GameWindowObservationStateV1 = "absent" | "waiting" | "ready";

export interface GameWindowObservationV1 {
  readonly schemaVersion: string;
  readonly capturedAt: string;
  readonly state: GameWindowObservationStateV1;
  readonly window: GameWindowFactsV1 | null;
}

export interface GameWindowObservationResultV1 {
  readonly gameWindow: GameWindowObservationV1;
}

function isRectPhysical(value: unknown): value is GameWindowRectPhysicalV1 {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 4) return false;
  const { x, y, width, height } = value as GameWindowRectPhysicalV1;
  for (const field of [x, y, width, height]) {
    if (!Number.isSafeInteger(field) || field < -2147483648 || field > 2147483647) return false;
  }
  return width >= 0 && height >= 0;
}

function isGameWindowFacts(value: unknown): value is GameWindowFactsV1 {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 4) return false;
  const facts = value as GameWindowFactsV1;
  return typeof facts.sessionId === "string" && facts.sessionId.length > 0
    && isRectPhysical(facts.rectPhysical)
    && typeof facts.minimized === "boolean"
    && typeof facts.foreground === "boolean";
}

/** Exact key sets at every level; ready ⇔ window facts present, absent/waiting ⇔ null. */
export function isGameWindowObservationResult(value: unknown): value is GameWindowObservationResultV1 {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !("gameWindow" in value)) return false;
  const observation = (value as GameWindowObservationResultV1).gameWindow;
  if (!observation || typeof observation !== "object" || Object.keys(observation).length !== 4) return false;
  if (observation.schemaVersion !== GAME_WINDOW_OBSERVE_SCHEMA_VERSION) return false;
  if (typeof observation.capturedAt !== "string" || observation.capturedAt.length === 0) return false;
  if (observation.state === "ready") return isGameWindowFacts(observation.window);
  if (observation.state === "absent" || observation.state === "waiting") return observation.window === null;
  return false;
}

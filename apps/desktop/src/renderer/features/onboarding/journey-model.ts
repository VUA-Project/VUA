import type { DeploymentPurpose } from "@vua/contracts";
export type JourneyStep = "goal" | "play-mode" | "headset" | "creator-start" | "target" | "editor" | "network" | "prepare" | "connection" | "launch" | "library" | "creator-done";
export interface JourneyState { v: 1; step: JourneyStep; purpose: DeploymentPurpose | null; connection: "usb" | "wifi" | null }
export const initialJourney: JourneyState = { v: 1, step: "goal", purpose: null, connection: null };
const steps: readonly JourneyStep[] = ["goal", "play-mode", "headset", "creator-start", "target", "editor", "network", "prepare", "connection", "launch", "library", "creator-done"];
/** Reading progress grants no installation, readiness or account authority. */
export function parseJourney(raw: string | null): JourneyState {
  try {
    const s: unknown = JSON.parse(raw ?? "null");
    if (typeof s !== "object" || s === null || !("v" in s) || s.v !== 1 || !("step" in s) || !steps.includes(s.step as JourneyStep)) return initialJourney;
    const value = s as JourneyState;
    if (![null, "desktop_play", "pico_pcvr", "pc_avatar", "quest_avatar"].includes(value.purpose)) return initialJourney;
    const purpose = value.purpose;
    if (["prepare", "network", "connection", "launch", "creator-done", "editor"].includes(value.step) && purpose === null) return initialJourney;
    if (["connection", "launch", "network"].includes(value.step) && purpose !== "desktop_play" && purpose !== "pico_pcvr") return initialJourney;
    if (value.step === "connection" && purpose !== "pico_pcvr") return initialJourney;
    if (["editor", "creator-done"].includes(value.step) && purpose !== "pc_avatar" && purpose !== "quest_avatar") return initialJourney;
    // On reopen, recheck preparation instead of reusing a former ready conclusion.
    const step = ["launch", "connection", "creator-done"].includes(value.step) ? "prepare" : value.step;
    return { v: 1, step, purpose, connection: purpose === "pico_pcvr" && (value.connection === "usb" || value.connection === "wifi") ? value.connection : null };
  } catch { return initialJourney; }
}
export function journeyBack(state: JourneyState): JourneyStep {
  switch (state.step) {
    case "play-mode": case "creator-start": return "goal";
    case "headset": return "play-mode";
    case "target": case "library": return "creator-start";
    case "editor": return "target";
    case "network": return state.purpose === "pico_pcvr" ? "headset" : "play-mode";
    case "prepare": return state.purpose === "desktop_play" || state.purpose === "pico_pcvr" ? "network" : "editor";
    case "connection": case "creator-done": return "prepare";
    case "launch": return state.purpose === "pico_pcvr" ? "connection" : "prepare";
    default: return "goal";
  }
}

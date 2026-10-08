import { expect, test } from "vitest";
import { initialJourney, journeyBack, parseJourney } from "./journey-model.ts";
test("reopening a launch or connection step requires inspection again", () => {
  for (const step of ["launch", "connection"]) expect(parseJourney(JSON.stringify({ v: 1, step, purpose: "pico_pcvr", connection: "wifi" }))).toEqual({ v: 1, step: "prepare", purpose: "pico_pcvr", connection: "wifi" });
  expect(parseJourney(JSON.stringify({ v: 1, step: "creator-done", purpose: "quest_avatar", connection: null })).step).toBe("prepare");
});
test("foreign versions and incoherent branch bookmarks do not acquire authority", () => {
  for (const value of [null, "{", { v: 2, step: "launch", purpose: "desktop_play" }, { v: 1, step: "connection", purpose: "pc_avatar" }, { v: 1, step: "editor", purpose: "pico_pcvr" }, { v: 1, step: "prepare", purpose: null }])
    expect(parseJourney(typeof value === "string" ? value : JSON.stringify(value))).toEqual(initialJourney);
});
test("desktop bookmarks discard stale headset connection; Back follows the actual branch", () => {
  const desktop = parseJourney(JSON.stringify({ v: 1, step: "prepare", purpose: "desktop_play", connection: "usb" }));
  expect(desktop.connection).toBeNull();
  expect(journeyBack({ ...desktop, step: "launch" })).toBe("prepare");
  expect(journeyBack({ ...desktop, purpose: "pico_pcvr", step: "launch" })).toBe("connection");
  expect(journeyBack({ ...desktop, purpose: "quest_avatar", step: "prepare" })).toBe("editor");
  expect(journeyBack({ ...desktop, step: "library" })).toBe("creator-start");
});

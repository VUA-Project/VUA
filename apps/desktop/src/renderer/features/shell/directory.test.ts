import { describe, expect, it } from "vitest";
import { isAmfPage, isPageId } from "../../app/nav-model.ts";
import { migratePageId } from "../../app/onboarding-model.ts";
import { strings } from "../../i18n/index.ts";
import { directory, directoryGroupLabel, directoryItemSelected, presentedModule } from "./directory.ts";
import { summarizeLines } from "./use-line-summary.ts";

describe("directory", () => {
  it("lists every page once, in the player's order", () => {
    const ids = [...directory.env, ...directory.production].map(item => item.id);
    expect(ids).toEqual(["env-play", "tools-discover", "warehouse", "asset-browser", "workshop", "release", "recipe", "packages", "env-create"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isPageId)).toBe(true);
  });

  it("keeps Unity setup reachable without AMF and hides the AMF pages", () => {
    expect(directory.production.filter(item => !isAmfPage(item.id)).map(item => item.id)).toEqual(["env-create"]);
  });

  it("selects Materials and Browse independently as top-level items", () => {
    const materials = directory.production.find(item => item.id === "warehouse")!;
    const browse = directory.production.find(item => item.id === "asset-browser")!;
    expect(directoryItemSelected(materials, "warehouse")).toBe(true);
    expect(directoryItemSelected(materials, "asset-browser")).toBe(false);
    expect(directoryItemSelected(browse, "asset-browser")).toBe(true);
    expect(directoryItemSelected(materials, "workshop")).toBe(false);
  });

  it("names the Avatar group with the player's word", () => {
    expect(directoryGroupLabel("env")).toBe(strings.journey.play);
  });

  it("presents Unity setup as Avatar work while its owner stays the environment", () => {
    expect(presentedModule("env-create", "env")).toBe("production");
    expect(presentedModule("env-play", "env")).toBe("env");
  });

  it("sends stored routes of retired pages somewhere that exists", () => {
    expect(migratePageId("avatar-hub")).toBe("home");
    expect(migratePageId("environment-hub")).toBe("home");
    expect(migratePageId("help-tour")).toBe("help");
    expect(migratePageId("help-game-assistant")).toBe("help");
    expect(isPageId("help-tour")).toBe(false);
  });
});

describe("line summary", () => {
  const list = {
    sources: [{ sourceId: "a" }, { sourceId: "b" }],
    editors: [{ path: "C:/Unity.exe", version: "2022.3.22f1" }],
    runs: [
      { runId: "r1", phase: "preparing", sourceNames: ["Meiyun.zip"] },
      { runId: "r2", phase: "ready", sourceNames: ["Karin.zip", "Dress.zip"] },
      { runId: "r3", phase: "failed", sourceNames: ["Rusk.zip"] },
      { runId: "r4", phase: "succeeded", sourceNames: ["Rusk.zip"] },
      { runId: "r5", phase: "ready", sourceNames: ["Hidden.zip"] },
      { runId: "r2", phase: "ready", sourceNames: ["Karin.zip"] },
    ],
  } as unknown as Parameters<typeof summarizeLines>[0];

  it("counts each line by what it needs from the player, once, leaving hidden lines out", () => {
    const summary = summarizeLines(list, 3, new Set(["r5"]));
    expect(summary).toMatchObject({ loaded: true, materials: 2, hasEditor: true, recipes: 3, running: 1, waiting: 1, attention: 1, finished: 1 });
    expect(summary.lines.map(line => [line.runId, line.name])).toEqual([["r1", "Meiyun"], ["r2", "Karin"], ["r3", "Rusk"], ["r4", "Rusk"]]);
  });

  it("reports a missing Editor", () => {
    expect(summarizeLines({ ...list, editors: [] }, null, new Set()).hasEditor).toBe(false);
  });
});

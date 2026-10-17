import { describe, expect, it } from "vitest";
import type { AmfProductionRun, AmfReleaseState } from "../../../gateway/index.ts";
import { avatarTitle, cubicBezier, dragProgress, durationOf, easeInOut, easingOf, finishedRunIds, materialsLine, outfitLines, proposedUploadName, releaseChecks, sdkReviewView, turnCompletes, turnTo, uploadedAvatarId, viewAfter } from "./release-model.ts";

const run = {
  schemaVersion: "0.1", runId: "n3-a", phase: "succeeded", taskId: "t", editor: { path: "Unity.exe", version: "2022.3.22f1" }, projectRoot: "C:/w", choices: [],
  sources: [{ sourceId: "a", role: "avatar", itemName: "Meiyun_v2.1.0.zip", name: "Meiyun.unitypackage", sha256: "x" },
    { sourceId: "o", role: "outfit", itemName: "TshirtShorts_Meiyun_v1.00.zip", name: "T.unitypackage", sha256: "y" }],
  prefabs: [], steps: [], error: null, recovery: null, snapshotId: null,
  selection: { avatarPrefab: "Assets/Meiyun/Meiyun.prefab", outfits: [{ sourceId: "o", prefabPath: "Assets/T/TshirtShorts.prefab", mode: "merge_armature", bone: "", toggleName: "T-shirt", active: true }] },
  result: { facts: { sdkDescriptorRecognized: true, missingReferences: 0, avatarName: "Meiyu_改変", instances: [{ sourceId: "o", bindingVerified: true, menuVerified: true }],
    missingShaderMaterials: [], sdkSignedIn: "no" } },
} as unknown as AmfProductionRun;

describe("release room facts", () => {
  it("lists finished Avatars newest first", () => {
    expect(finishedRunIds({ sources: [], editors: [], busy: false, runs: [
      { runId: "n3-c", phase: "succeeded", sourceNames: [] }, { runId: "n3-b", phase: "ready", sourceNames: [] }, { runId: "n3-a", phase: "succeeded", sourceNames: [] }] })).toEqual(["n3-c", "n3-a"]);
    expect(finishedRunIds(null)).toEqual([]);
  });
  it("names the Avatar, its materials and a VRChat name from what Unity observed", () => {
    expect(avatarTitle(run)).toBe("Meiyu_改変");
    expect(avatarTitle({ ...run, result: null })).toBe("Meiyun");
    expect(materialsLine(run)).toBe("Meiyun_v2.1.0 + TshirtShorts_Meiyun_v1.00");
    expect(proposedUploadName(run)).toBe("Meiyu_改変 TshirtShorts");
    expect([...proposedUploadName({ ...run, result: { facts: { ...run.result!.facts!, avatarName: "名".repeat(80) } } })]).toHaveLength(64);
    expect(outfitLines(run)).toEqual([{ name: "TshirtShorts", toggle: "T-shirt", active: true }]);
    expect(outfitLines({ ...run, selection: { ...run.selection!, outfits: [{ ...run.selection!.outfits[0]!, toggleName: " ", active: false }] } })).toEqual([{ name: "TshirtShorts", toggle: null, active: false }]);
  });
  it("reads the checks in plain states", () => {
    expect(releaseChecks(run).map(check => [check.key, check.state])).toEqual([["descriptor", "ok"], ["bindings", "ok"], ["menus", "ok"], ["references", "ok"],
      ["scripts", "ok"], ["shaders", "ok"], ["signIn", "info"]]);
    const facts = { ...run.result!.facts!, missingReferences: 2, missingShaderMaterials: ["Assets/a.mat"], instances: [{ sourceId: "o", bindingVerified: false, menuVerified: true }] };
    const checks = releaseChecks({ ...run, result: { facts } });
    expect(checks.find(check => check.key === "references")).toEqual({ key: "references", state: "attention", count: 2 });
    expect(checks.find(check => check.key === "shaders")?.count).toBe(1);
    expect(checks.find(check => check.key === "bindings")?.state).toBe("attention");
    expect(releaseChecks({ ...run, result: null })).toEqual([]);
  });
  it("keeps the Avatar ID of the newest successful upload", () => {
    const upload = { uploadId: "u", avatarName: "M", startedAt: "", endedAt: null, stage: "finishing", progress: null, status: "", firstUpload: true, reason: null, detail: "", errors: [] };
    const state = { runId: "n3-a", turntable: null, editorOpen: false, uploads: [
      { ...upload, uploadId: "u3", state: "failed", blueprintId: null, reason: "validation" },
      { ...upload, uploadId: "u2", state: "succeeded", blueprintId: "avtr_2" }, { ...upload, uploadId: "u1", state: "succeeded", blueprintId: "avtr_1" }] } as unknown as AmfReleaseState;
    expect(uploadedAvatarId(state)).toBe("avtr_2");
    expect(uploadedAvatarId(null)).toBeNull();
  });
  it("turns one page at a time and completes a released corner past a third", () => {
    expect(turnTo(0, 1, 3)).toEqual({ from: 0, to: 1, direction: "next" });
    expect(turnTo(2, 0, 3)).toEqual({ from: 2, to: 0, direction: "prev" });
    expect(turnTo(1, 1, 3)).toBeNull();
    expect(turnTo(2, 3, 3)).toBeNull();
    expect(dragProgress("next", 900, 600, 900)).toBeCloseTo(1 / 3);
    expect(dragProgress("next", 900, 950, 900)).toBe(0);
    expect(dragProgress("prev", 100, 1200, 900)).toBe(1);
    expect(turnCompletes(0.2)).toBe(false);
    expect(turnCompletes(0.5)).toBe(true);
    expect([easeInOut(0), easeInOut(0.5), easeInOut(1)]).toEqual([0, 0.5, 1]);
  });
  it("follows the motion tokens for duration and easing", () => {
    expect(durationOf("560ms", 1)).toBe(560);
    expect(durationOf(" 0.3s", 1)).toBe(300);
    expect(durationOf("", 420)).toBe(420);
    const ease = easingOf("cubic-bezier(0.2, 0.8, 0.2, 1)");
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeGreaterThan(0.8);
    expect(easingOf("ease")(0.5)).toBe(0.5);
    expect(cubicBezier(0, 0, 1, 1)(0.25)).toBeCloseTo(0.25, 3);
  });
  it("steps through the still views both ways", () => {
    expect(viewAfter(["front", "side", "back"], "front", 1)).toBe("side");
    expect(viewAfter(["front", "side", "back"], "front", -1)).toBe("back");
    expect(viewAfter(["front", "back"], "side", 1)).toBe("back");
  });
});

describe("the SDK's own checks", () => {
  const withReview = (sdkReview: unknown) => ({ ...run, result: { facts: { ...run.result!.facts!, sdkReview } } }) as unknown as AmfProductionRun;
  it("groups the SDK's items the way a player acts on them", () => {
    const view = sdkReviewView(withReview({
      state: "checked", platform: "pc", overall: "Poor", detail: "",
      issues: [
        { level: "error", text: "This avatar has no pipeline manager component.", canFix: true },
        { level: "warning", text: "This avatar uses Unity constraints.", canFix: true },
        { level: "info", text: "This avatar can be used as a custom fallback.", canFix: false },
      ],
      stats: [
        { category: "PolyCount", rating: "Good", text: "Triangles: 60000" },
        { category: "MaterialCount", rating: "Medium", text: "Material Slots: 12" },
        { category: "BoneCount", rating: "Poor", text: "Bones: 300" },
      ],
    }));
    expect(view?.overall).toBe("Poor");
    expect(view?.mustFix.map(issue => issue.text)).toEqual(["This avatar has no pipeline manager component."]);
    expect(view?.reminders).toHaveLength(1);
    expect(view?.notes).toHaveLength(1);
    expect(view?.rankItems.map(stat => stat.category)).toEqual(["BoneCount", "MaterialCount"]);
  });
  it("reads an older run or an unrated estimate as nothing yet", () => {
    expect(sdkReviewView(run)).toBeNull();
    const unrated = sdkReviewView(withReview({ state: "unavailable", platform: "", overall: "None", detail: "x", issues: [], stats: [] }));
    expect(unrated).toMatchObject({ state: "unavailable", platform: "pc", overall: null, mustFix: [], rankItems: [] });
  });
});

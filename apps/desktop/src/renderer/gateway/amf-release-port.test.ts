import { describe, expect, it } from "vitest";
import type { DesktopGatewaySuccessValueV1 } from "@vua/contracts";
import { createAmfReleasePort, isAmfReleaseState } from "./amf-release-port.ts";
import type { GatewayClient } from "./gateway-client.ts";

const avatarId = "avtr_0d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6";
const uploaded = { uploadId: "upload-1", avatarName: "Meiyun", startedAt: "2026-10-17T00:00:00Z", endedAt: "2026-10-17T00:05:00Z", state: "succeeded",
  stage: "finishing", progress: 1, status: "", blueprintId: avatarId, firstUpload: true, reason: null, detail: "", errors: [] };
const state = { schemaVersion: "0.1", runId: "n3-test", editorOpen: false, uploads: [uploaded],
  turntable: { frames: 60, size: 512, bakedAt: "2026-10-17T00:00:00Z", current: true } };

function client(response: () => unknown, requests: unknown[] = []): GatewayClient {
  return { async invoke(request) { requests.push(request); return { ok: true, value: response() as DesktopGatewaySuccessValueV1 }; }, subscribe() { return () => {}; } };
}

describe("AMF release response boundary", () => {
  it("accepts a release state with a recorded turntable and uploads", () => {
    expect(isAmfReleaseState(state, "n3-test")).toBe(true);
    expect(isAmfReleaseState({ ...state, turntable: null, uploads: [] }, "n3-test")).toBe(true);
    expect(isAmfReleaseState(state, "n3-other")).toBe(false);
    expect(isAmfReleaseState({ ...state, turntable: { ...state.turntable, frames: 30 } }, "n3-test")).toBe(false);
    expect(isAmfReleaseState({ ...state, uploads: [{ ...uploaded, blueprintId: null }] }, "n3-test")).toBe(false);
    expect(isAmfReleaseState({ ...state, uploads: [{ ...uploaded, blueprintId: "wrld_x" }] }, "n3-test")).toBe(false);
    expect(isAmfReleaseState({ ...state, uploads: [{ ...uploaded, state: "failed", blueprintId: null, reason: "validation", errors: ["Too many materials"] }] }, "n3-test")).toBe(true);
    expect(isAmfReleaseState({ ...state, uploads: [{ ...uploaded, state: "failed", reason: "invented" }] }, "n3-test")).toBe(false);
    expect(isAmfReleaseState({ ...state, uploads: [{ ...uploaded, stage: "dancing" }] }, "n3-test")).toBe(false);
  });
  it("sends an upload only with the player's rights confirmation", async () => {
    const requests: unknown[] = [];
    const port = createAmfReleasePort(client(() => ({ schemaVersion: "0.1", runId: "n3-test", taskId: "task-upload" }), requests));
    expect(await port.upload("n3-test", { avatarName: "Meiyun", rightsConfirmed: true })).toEqual({ runId: "n3-test", taskId: "task-upload" });
    expect(requests[0]).toMatchObject({ method: "amf.production.upload", params: { schemaVersion: "0.1", runId: "n3-test", avatarName: "Meiyun", rightsConfirmed: true } });
    await expect(port.upload("n3-test", { avatarName: " Meiyun", rightsConfirmed: true })).rejects.toThrow("confirmation_invalid");
    await expect(port.upload("n3-test", { avatarName: "Meiyun", rightsConfirmed: false as true })).rejects.toThrow("confirmation_invalid");
    expect(requests).toHaveLength(1);
  });
  it("turns a turntable frame into a PNG data URL for that index", async () => {
    let response: unknown = { schemaVersion: "0.1", runId: "n3-test", index: 7, mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUg==" };
    const port = createAmfReleasePort(client(() => response));
    expect(await port.turntableFrame("n3-test", 7)).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
    response = { ...(response as object), index: 8 };
    await expect(port.turntableFrame("n3-test", 7)).rejects.toThrow("frame_invalid");
    response = { schemaVersion: "0.1", runId: "n3-test", index: 7, mediaType: "image/png", data: "PHN2Zz48L3N2Zz4=" };
    await expect(port.turntableFrame("n3-test", 7)).rejects.toThrow("frame_invalid");
  });
});

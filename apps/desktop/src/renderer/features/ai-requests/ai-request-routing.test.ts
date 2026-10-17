import { describe, expect, it } from "vitest";
import type { AiActionRequestV01 } from "@vua/contracts";
import { requestPage, requestRunId, visibleRequests } from "./ai-request-routing.ts";

const request = (tool: string, parameters: Record<string, unknown> = {}, extra: Partial<AiActionRequestV01> = {}): AiActionRequestV01 => ({
  id: `${tool}-1`, tool, title: tool, explanation: "", expectedResult: "", createdAt: "2026-10-16T05:00:00.000Z",
  state: "pending", details: { parameters }, ...extra,
});

describe("AI requests are confirmed on the page they change", () => {
  it("routes Avatar work to production with its run", () => {
    const assemble = request("vua_request_amf_assemble", { runId: "n3-run" });
    expect(requestPage(assemble)).toBe("workshop");
    expect(requestRunId(assemble)).toBe("n3-run");
    expect(requestRunId(request("vua_request_play", { runId: "n3-run" }))).toBeNull();
  });
  it("routes an upload to the release room, where the player confirms the rights", () => {
    const upload = request("vua_request_amf_upload", { runId: "n3-run" });
    expect(requestPage(upload)).toBe("release");
    expect(requestRunId(upload)).toBe("n3-run");
  });
  it("routes play, tools and installation by what they prepare", () => {
    expect(requestPage(request("vua_request_play", { route: "pico_pcvr" }))).toBe("env-play");
    expect(requestPage(request("vua_request_tool", { toolId: "vrcft" }))).toBe("tools-discover");
    expect(requestPage(request("vua_request_installation", { intent: { purposes: ["desktop_play", "pico_pcvr"] } }))).toBe("env-play");
    expect(requestPage(request("vua_request_installation", { intent: { purposes: ["desktop_play", "pc_avatar"] } }))).toBe("env-create");
    expect(requestPage(request("vua_request_installation", {}))).toBe("env-create");
  });
  it("sends a stop request to the page its task came from", () => {
    const cancel = request("vua_request_cancel_task", { taskId: "task-1" });
    expect(requestPage(cancel, id => id === "task-1" ? "warehouse" : undefined)).toBe("warehouse");
    expect(requestPage(cancel)).toBe("help-ai");
  });
  it("keeps decided requests visible for a while", () => {
    const now = Date.parse("2026-10-16T05:10:00.000Z");
    const recent = request("vua_request_amf_open", {}, { state: "accepted" });
    const old = request("vua_request_amf_open", {}, { id: "old", state: "withdrawn", createdAt: "2026-10-16T04:00:00.000Z" });
    const waiting = request("vua_request_amf_open", {}, { id: "waiting", createdAt: "2026-10-16T04:00:00.000Z" });
    expect(visibleRequests([recent, old, waiting], now).map(r => r.id)).toEqual([recent.id, "waiting"]);
  });
});

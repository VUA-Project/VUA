import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import type { NetworkReport } from "@vua/contracts";
import { createLiveNetworkPort } from "./live-network-port.ts";
import type { GatewayClient } from "./gateway-client.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../../../schemas/environment-network/v0.1/vectors.json", import.meta.url), "utf8")) as { name: string; value: NetworkReport }[];
const report = vectors.find(v => v.name === "mixed result")!.value;
describe("live network port", () => {
  it("tests just the selected cards and rejects another website's result", async () => {
    const observation = { url: "https://github.com/", status: "reachable", elapsedMs: 123, httpStatus: 200 } as const;
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValue({ ok: true, value: { websiteTests: [observation] } });
    const port = createLiveNetworkPort({ invoke, subscribe: () => () => {} });
    expect(await port.testWebsites([observation.url])).toEqual([observation]);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ method: "environment.testWebsites", params: { urls: [observation.url] } }));
    await expect(port.testWebsites(["https://vrchat.com/"])).rejects.toThrow();
  });
  it("uses the typed query and preserves partial failures", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValue({ ok: true, value: { networkReport: report } });
    const port = createLiveNetworkPort({ invoke, subscribe: () => () => {} });
    expect(await port.check(report.intent)).toEqual(report);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ method: "environment.checkNetwork", params: { intent: report.intent } }));
  });
  it("rejects a reply for a different route instead of showing it as current", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValue({ ok: true, value: { networkReport: report } });
    const port = createLiveNetworkPort({ invoke, subscribe: () => () => {} });
    await expect(port.check({ route: "pico_pcvr", region: "auto" })).rejects.toThrow("network_check_unavailable");
  });
  it("rejects missing observations and transport failure", async () => {
    const invoke = vi.fn<GatewayClient["invoke"]>().mockResolvedValue({ ok: false, error: { kind: "unavailable" } })
      .mockResolvedValueOnce({ ok: true, value: { networkReport: { ...report, results: [] } } });
    const port = createLiveNetworkPort({ invoke, subscribe: () => () => {} });
    await expect(port.check(report.intent)).rejects.toThrow();
    await expect(port.check(report.intent)).rejects.toThrow();
    expect(await port.capability()).toEqual({ state: "unavailable" });
  });
});

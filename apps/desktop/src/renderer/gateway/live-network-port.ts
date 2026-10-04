/** Only validated, current-request observations become UI facts. */
import { isNetworkResult, isWebsiteTestResult } from "@vua/contracts";
import type { NetworkPort } from "./environment-port.ts";
import type { GatewayClient } from "./gateway-client.ts";

export function createLiveNetworkPort(client: GatewayClient): NetworkPort {
  return {
    async websiteCapability() {
      const result = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "app.snapshot", params: {} });
      return { state: result.ok && "capabilities" in result.value && result.value.capabilities.operations.some(
        op => op.operationId === "environment.testWebsites" && op.availability === "available") ? "ready" : "unavailable" };
    },
    async testWebsites(urls) {
      const result = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.testWebsites", params: { urls } });
      if (!result.ok || !isWebsiteTestResult(result.value) || result.value.websiteTests.length !== urls.length
        || result.value.websiteTests.some((row, index) => row.url !== urls[index])) throw new Error("website_test_unavailable");
      return result.value.websiteTests;
    },
    async capability() {
      const result = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "app.snapshot", params: {} });
      return { state: result.ok && "capabilities" in result.value && result.value.capabilities.operations.some(
        op => op.operationId === "environment.checkNetwork" && op.availability === "available") ? "ready" : "unavailable" };
    },
    async check(intent) {
      const result = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.checkNetwork", params: { intent } });
      if (!result.ok || !isNetworkResult(result.value) || result.value.networkReport.intent.route !== intent.route
        || result.value.networkReport.intent.region !== intent.region) throw new Error("network_check_unavailable");
      return result.value.networkReport;
    },
  };
}

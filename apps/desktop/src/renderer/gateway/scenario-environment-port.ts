import { isScenarioEnvironmentCheck, isScenarioSop, type DeploymentIntent, type ScenarioEnvironmentCheck, type ScenarioSelection, type ScenarioSop } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
export interface ScenarioEnvironmentPort {
  sop(selection: ScenarioSelection): Promise<ScenarioSop>;
  check(intent: DeploymentIntent): Promise<ScenarioEnvironmentCheck>;
}
/** The SOP query never calls a check; the check query never calls a plan. */
export function createScenarioEnvironmentPort(client: GatewayClient): ScenarioEnvironmentPort {
  return {
    async sop(scenario) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.getScenarioSop", params: { schemaVersion: "0.1", scenario } });
      if (!response.ok || !isScenarioSop(response.value)) throw new Error("scenario_sop_unavailable");
      return response.value;
    },
    async check(intent) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.checkScenarioEnvironment", params: { schemaVersion: "0.1", intent } });
      if (!response.ok || !isScenarioEnvironmentCheck(response.value)) throw new Error("scenario_check_unavailable");
      return response.value;
    },
  };
}

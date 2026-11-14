import {
  EAC_METHODS_SCHEMA,
  isEacInspectResult,
  isEacRepairResult,
  isEacTerminateResult,
  type DesktopEacApiV01,
} from "@vua/contracts";
import type { EacPort } from "./environment-port.ts";
import type { GatewayClient } from "./gateway-client.ts";

export function createLiveEacPort(
  client: GatewayClient,
  host?: { readonly eac?: DesktopEacApiV01 | undefined },
): EacPort {
  return {
    async inspect() {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "environment.inspectEac",
        params: { schemaVersion: EAC_METHODS_SCHEMA },
      });
      if (!result.ok || !isEacInspectResult(result.value)) {
        throw new Error("eac_inspect_unavailable");
      }
      return result.value.eacSnapshot;
    },
    async repairCapability() {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "app.snapshot",
        params: {},
      });
      const ready =
        result.ok
        && "capabilities" in result.value
        && result.value.capabilities.operations.some(
          (op) => op.operationId === "environment.launchEacRepair" && op.availability === "available",
        );
      return ready ? { state: "ready" } : { state: "unavailable" };
    },
    async terminateResidual(target, commandId) {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "environment.terminateEacResidual",
        params: {
          schemaVersion: EAC_METHODS_SCHEMA,
          pid: target.pid,
          created: target.created,
          path: target.path,
          confirmed: true,
          commandId,
        },
      });
      if (!result.ok || !isEacTerminateResult(result.value)) {
        const code = !result.ok && result.error.kind === "application"
          ? result.error.error.code
          : "eac_terminate_unavailable";
        throw new Error(code);
      }
      return result.value;
    },
    async launchRepair(commandId) {
      const result = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "environment.launchEacRepair",
        params: {
          schemaVersion: EAC_METHODS_SCHEMA,
          confirmed: true,
          commandId,
        },
      });
      if (!result.ok || !isEacRepairResult(result.value)) {
        const code = !result.ok && result.error.kind === "application"
          ? result.error.error.code
          : "eac_repair_unavailable";
        throw new Error(code);
      }
      return result.value;
    },
    openRepairFolder: () =>
      host?.eac ? host.eac.openRepairFolder() : Promise.resolve({ opened: false }),
    getExperimentalTermination: () =>
      host?.eac ? host.eac.getExperimentalTermination() : Promise.resolve({ enabled: false }),
    setExperimentalTermination: (enabled: boolean) =>
      host?.eac ? host.eac.setExperimentalTermination(enabled) : Promise.resolve({ enabled: false }),
  };
}

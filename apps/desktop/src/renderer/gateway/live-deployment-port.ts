/** N1 wire adapter. Validate Provider facts and translate UI calls into the narrow Gateway.
 * No installer selection, filesystem access, vendor command or readiness decision lives here. */
import {
  isDeploymentAccepted,
  isDeploymentPlanResult,
  readDeploymentProgress,
  type TaskSnapshotV01,
} from "@vua/contracts";
import { strings } from "../i18n/index.ts";
import type { DeploymentPort } from "./environment-port.ts";
import type { GatewayClient } from "./gateway-client.ts";
import { registerTaskIdentity } from "./task-identity.ts";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Check the fields this view consumes; a wrong task or malformed state never becomes UI fact. */
function validSnapshot(value: unknown, taskId: string): value is TaskSnapshotV01 {
  return record(value) && value.contractVersion === "0.1" && value.taskId === taskId
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1
    && typeof value.correlationId === "string" && typeof value.updatedAt === "string"
    && typeof value.cancellationRequested === "boolean"
    && (value.recoveryDisposition === "none" || value.recoveryDisposition === "inspect_required")
    && typeof value.state === "string"
    && ["queued", "preparing", "running", "waiting_for_input", "paused", "succeeded", "succeeded_with_warnings", "failed", "cancelled"].includes(value.state)
    && (value.error === undefined || (record(value.error) && typeof value.error.code === "string"));
}

export function createLiveDeploymentPort(client: GatewayClient): DeploymentPort {
  return {
    async capability() {
      const result = await client.invoke({
        schemaVersion: 1, requestId: crypto.randomUUID(), method: "app.snapshot", params: {},
      });
      if (!result.ok || !("capabilities" in result.value)) return { state: "unavailable" };
      const operations = result.value.capabilities.operations;
      if (!Array.isArray(operations)) return { state: "unavailable" };
      return ["environment.planDeployment", "environment.executeDeployment"].every(id =>
        operations.some(operation => operation.operationId === id && operation.availability === "available"))
        ? { state: "ready" } : { state: "unavailable" };
    },
    async plan(intent) {
      const result = await client.invoke({
        schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.planDeployment", params: { intent },
      });
      if (!result.ok || !isDeploymentPlanResult(result.value)) throw new Error("deployment_plan_unavailable");
      return result.value.deploymentPlan;
    },
    async execute(plan, commandId) {
      const result = await client.invoke({
        schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.executeDeployment",
        params: { intent: plan.intent, confirmedDigest: plan.digest, commandId },
      });
      if (!result.ok || !isDeploymentAccepted(result.value)) throw new Error("deployment_not_accepted");
      registerTaskIdentity(result.value.taskId, {
        title: strings.deployment.title,
        originPage: plan.intent.purposes.some(p => p === "pc_avatar" || p === "quest_avatar") ? "env-create" : "env-play",
      });
      return result.value.taskId;
    },
    async status(taskId) {
      const result = await client.invoke({
        schemaVersion: 1, requestId: crypto.randomUUID(), method: "task.get", params: { taskId },
      });
      if (!result.ok || !validSnapshot(result.value, taskId)) throw new Error("deployment_status_unavailable");
      return result.value;
    },
    async cancel(taskId, observedRevision) {
      const result = await client.invoke({
        schemaVersion: 1, requestId: crypto.randomUUID(), method: "task.requestCancellation",
        params: { taskId, observedRevision, commandId: crypto.randomUUID() },
      });
      if (!result.ok) throw new Error("deployment_cancel_failed");
    },
    subscribe(taskId, callback) {
      return client.subscribe(event => {
        if (event.kind !== "task.progressed" || event.taskId !== taskId) return;
        const progress = readDeploymentProgress(event.payload.params);
        if (progress !== null) callback(progress);
      });
    },
  };
}

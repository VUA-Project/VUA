import { isUnityLicenseAcceptedV01, isUnityLicenseSnapshotV01, type UnityLicenseSnapshotV01 } from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";
import { registerTaskIdentity } from "./task-identity.ts";

/** Unity license facts on this computer, and the one real check that opens Unity briefly. */
export interface UnityLicensePort {
  /** File, Hub and licensing-client observations with the last check; starts no program. */
  snapshot(): Promise<UnityLicenseSnapshotV01>;
  /** Opens the given Editor once in a small VUA project; the result arrives as the snapshot's last check. */
  check(editorPath: string, title: string): Promise<{ readonly taskId: string }>;
}

export function createUnityLicensePort(client: GatewayClient): UnityLicensePort {
  return {
    async snapshot() {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.unityLicense", params: { schemaVersion: "0.1" } });
      if (!response.ok || !isUnityLicenseSnapshotV01(response.value)) throw new Error("unity_license_unavailable");
      return response.value;
    },
    async check(editorPath, title) {
      const response = await client.invoke({ schemaVersion: 1, requestId: crypto.randomUUID(), method: "environment.checkUnityLicense", params: { schemaVersion: "0.1", editorPath } });
      if (!response.ok) {
        const error = response.error;
        throw new Error(error.kind === "application" ? error.error.code : error.kind);
      }
      if (!isUnityLicenseAcceptedV01(response.value)) throw new Error("unity_license_check_invalid");
      registerTaskIdentity(response.value.taskId, { title, originPage: "settings-accounts", notifyOnComplete: true, notifyFamily: "unity:license" });
      return { taskId: response.value.taskId };
    },
  };
}

import { isPoseGraphResultV01, type PoseGraphSnapshotV01 } from "@vua/contracts";
import type { GatewayClient, GatewayClientError } from "./gateway-client.ts";

export interface PoseGraphPort {
  observe(): Promise<PoseGraphSnapshotV01>;
}

function fail(response: { readonly error: GatewayClientError }): Error {
  return new Error(
    response.error.kind === "application" ? response.error.error.code : response.error.kind,
  );
}

export function createLivePoseGraphPort(client: GatewayClient): PoseGraphPort {
  return {
    async observe() {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "environment.observePoseGraph",
        params: { schemaVersion: "0.1" },
      });
      if (!response.ok) throw fail(response);
      if (!isPoseGraphResultV01(response.value)) {
        throw new Error("pose_graph_invalid");
      }
      return response.value.poseGraph;
    },
  };
}

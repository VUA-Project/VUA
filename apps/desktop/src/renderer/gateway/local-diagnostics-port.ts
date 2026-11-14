import {
  isClientConfigUpdateReceiptResultV01,
  isLocalDiagnosticsResultV01,
  isOscCacheClearReceiptResultV01,
  isSymptomDiagnosisResultV01,
  type ClientConfigUpdateReceiptV01,
  type LocalDiagnosticsSnapshotV01,
  type OscCacheClearReceiptV01,
  type SymptomDiagnosisV01,
  type SymptomIdV01,
} from "@vua/contracts";
import type { GatewayClient } from "./gateway-client.ts";

export interface ClientConfigUpdateDraft {
  readonly cacheSizeGb?: number;
  readonly cacheExpiryDelayDays?: number;
}

/** Multi-layer local client/OSC/SteamVR/log diagnostics and guarded offline helpers. */
export interface LocalDiagnosticsPort {
  observe(): Promise<LocalDiagnosticsSnapshotV01>;
  diagnose(symptom: SymptomIdV01): Promise<SymptomDiagnosisV01>;
  clearOscAvatarCache(commandId: string): Promise<OscCacheClearReceiptV01>;
  updateClientConfig(input: ClientConfigUpdateDraft, commandId: string): Promise<ClientConfigUpdateReceiptV01>;
}

function throwGatewayError(error: { readonly kind: string; readonly error?: { readonly code: string } }): never {
  throw new Error(error.kind === "application" && error.error ? error.error.code : error.kind);
}

export function createLiveLocalDiagnosticsPort(client: GatewayClient): LocalDiagnosticsPort {
  return {
    async observe() {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "diagnostics.observeLocal",
        params: { schemaVersion: "0.1" },
      });
      if (!response.ok) throwGatewayError(response.error);
      if (!isLocalDiagnosticsResultV01(response.value)) throw new Error("local_diagnostics_invalid");
      return response.value.localDiagnostics;
    },
    async diagnose(symptom) {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "diagnostics.diagnoseSymptom",
        params: { schemaVersion: "0.1", symptom },
      });
      if (!response.ok) throwGatewayError(response.error);
      if (!isSymptomDiagnosisResultV01(response.value)) throw new Error("symptom_diagnosis_invalid");
      return response.value.symptomDiagnosis;
    },
    async clearOscAvatarCache(commandId) {
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "diagnostics.clearOscAvatarCache",
        params: { schemaVersion: "0.1", commandId },
      });
      if (!response.ok) throwGatewayError(response.error);
      if (!isOscCacheClearReceiptResultV01(response.value)) throw new Error("osc_cache_receipt_invalid");
      return response.value.oscCacheClearReceipt;
    },
    async updateClientConfig(input, commandId) {
      const params: {
        schemaVersion: "0.1";
        commandId: string;
        cacheSizeGb?: number;
        cacheExpiryDelayDays?: number;
      } = { schemaVersion: "0.1", commandId };
      if (input.cacheSizeGb !== undefined) params.cacheSizeGb = input.cacheSizeGb;
      if (input.cacheExpiryDelayDays !== undefined) params.cacheExpiryDelayDays = input.cacheExpiryDelayDays;
      const response = await client.invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "diagnostics.updateClientConfig",
        params,
      });
      if (!response.ok) throwGatewayError(response.error);
      if (!isClientConfigUpdateReceiptResultV01(response.value)) throw new Error("client_config_receipt_invalid");
      return response.value.clientConfigReceipt;
    },
  };
}

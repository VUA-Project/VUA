import { spawn } from "node:child_process";
import path from "node:path";
import { providerEnvironment, SupervisedProcessProviderV01, type OrchestratorProviderV01, type ProviderProcessFactoryV01 } from "@vua/orchestrator-provider";

export interface DesktopProviderEndpoint {
  readonly role: "host" | "amf";
  readonly executablePath: string;
  readonly databasePath: string;
  readonly legacyDatabasePath?: string;
  readonly providerDataRoot?: string;
  readonly warehouseRoot?: string;
  readonly projectRoot?: string;
  readonly unityEditorPath?: string | null;
  /** OS folder facts selected by Main, not ambient host-variable passthrough. */
  readonly profileRoots?: { readonly home: string; readonly localAppData: string; readonly appData: string };
}

/** A sanitized process boundary. AMF paths are injected only into AMF; core
 * never sees VUA_PROVIDER_DATA/WAREHOUSE_ROOT/PROJECT_ROOT or opens BDL. */
export function desktopProviderProcessFactory(endpoint: Omit<DesktopProviderEndpoint, "executablePath" | "databasePath">): ProviderProcessFactoryV01 {
  return (executablePath, databasePath) => {
    if (endpoint.role === "amf" && (!endpoint.providerDataRoot || !endpoint.warehouseRoot || !endpoint.projectRoot)) throw new Error("AMF requires its own data roots");
    return spawn(executablePath, ["--database", databasePath], {
      cwd: path.dirname(executablePath),
      env: {
        ...providerEnvironment(process.env),
        ...(endpoint.profileRoots ? { USERPROFILE: endpoint.profileRoots.home,
          LOCALAPPDATA: endpoint.profileRoots.localAppData, APPDATA: endpoint.profileRoots.appData } : {}),
        ...(endpoint.legacyDatabasePath ? { VUA_LEGACY_TASK_DB: endpoint.legacyDatabasePath } : {}),
        ...(endpoint.role === "amf" ? {
          VUA_PROVIDER_DATA: endpoint.providerDataRoot,
          VUA_WAREHOUSE_ROOT: endpoint.warehouseRoot,
          VUA_PROJECT_ROOT: endpoint.projectRoot,
          ...(endpoint.unityEditorPath ? { VUA_UNITY_EDITOR: endpoint.unityEditorPath } : {}),
        } : {}),
      },
      shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
  };
}

export function createDesktopOrchestratorProvider(endpoint: DesktopProviderEndpoint): OrchestratorProviderV01 {
  return new SupervisedProcessProviderV01({ executablePath: endpoint.executablePath,
    databasePath: endpoint.databasePath, handshakeTimeoutMs: 15_000 }, desktopProviderProcessFactory(endpoint));
}

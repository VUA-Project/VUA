import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { APPLICATION_CONTRACT_VERSION, type ApplicationRequestV01, type ApplicationResponseV01 } from "@vua/contracts";

const EXPERIMENTAL_FILENAME = "eac-experimental.json";
const SETUP_RELATIVE_SEGMENTS = ["EasyAntiCheat", "EasyAntiCheat_EOS_Setup.exe"] as const;

export interface ProviderInvoker {
  invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01>;
  subscribeStatus?: (
    listener: (status: { readonly state: string; readonly acceptingCalls?: boolean }) => void,
  ) => () => void;
}

export interface EacMainOptions {
  readonly userDataDir: string;
  readonly provider: ProviderInvoker;
  readonly showItemInFolder: (fullPath: string) => void;
}

export interface EacMainController {
  isExperimentalEnabled(): boolean;
  getExperimentalTermination(): Promise<{ readonly enabled: boolean }>;
  setExperimentalTermination(enabled: boolean): Promise<{ readonly enabled: boolean }>;
  syncProvider(): Promise<void>;
  ensureSynced(): Promise<void>;
  openRepairFolder(): Promise<{ readonly opened: boolean }>;
}

function isInsideDirectory(rootDir: string, candidatePath: string): boolean {
  const normalizedRoot = process.platform === "win32" ? path.resolve(rootDir).toLowerCase() : path.resolve(rootDir);
  const normalizedCandidate =
    process.platform === "win32" ? path.resolve(candidatePath).toLowerCase() : path.resolve(candidatePath);
  const rel = path.relative(normalizedRoot, normalizedCandidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Verifies that `<vrchatDir>/EasyAntiCheat/EasyAntiCheat_EOS_Setup.exe` resolves
 * strictly inside the real VRChat installation directory before calling Explorer.
 */
export async function resolveVerifiedRepairTarget(
  vrchatDir: string,
  candidateTargetPath?: string,
): Promise<string | null> {
  if (!vrchatDir || !path.isAbsolute(vrchatDir) || vrchatDir.includes("\0")) {
    return null;
  }
  try {
    const realRoot = await fs.promises.realpath(vrchatDir);
    const rootStat = await fs.promises.stat(realRoot);
    if (!rootStat.isDirectory()) return null;

    const target = candidateTargetPath ?? path.join(realRoot, ...SETUP_RELATIVE_SEGMENTS);
    if (!path.isAbsolute(target) || target.includes("\0")) return null;

    const realTarget = await fs.promises.realpath(target);
    if (!isInsideDirectory(realRoot, realTarget)) return null;

    const targetStat = await fs.promises.stat(realTarget);
    if (!targetStat.isFile()) return null;
    return realTarget;
  } catch {
    return null;
  }
}

function readPersistedExperimental(filePath: string): boolean {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && (parsed as { schemaVersion?: unknown }).schemaVersion === 1
      && typeof (parsed as { enabled?: unknown }).enabled === "boolean"
    ) {
      return (parsed as { enabled: boolean }).enabled;
    }
    return false;
  } catch {
    return false;
  }
}

async function writePersistedExperimental(filePath: string, enabled: boolean): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const payload = `${JSON.stringify({ schemaVersion: 1, enabled }, null, 2)}\n`;
  await fs.promises.writeFile(tempPath, payload, "utf8");
  try {
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

function extractVrchatDirFromSnapshot(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as { checkId?: unknown; presence?: unknown; facts?: unknown };
    if (record.checkId !== "vrchat" || record.presence !== "detected") continue;
    if (record.facts === null || typeof record.facts !== "object" || Array.isArray(record.facts)) continue;
    const exe = (record.facts as { exe?: unknown }).exe;
    if (typeof exe === "string" && path.isAbsolute(exe) && !exe.includes("\0")) {
      return path.dirname(exe);
    }
  }
  return null;
}

export function createEacMainController(options: EacMainOptions): EacMainController {
  const settingsFile = path.join(options.userDataDir, EXPERIMENTAL_FILENAME);
  let experimentalEnabled = readPersistedExperimental(settingsFile);
  let syncedValue: boolean | null = null;
  let inFlightSync: Promise<void> | null = null;

  const syncProvider = async (): Promise<void> => {
    const target = experimentalEnabled;
    const id = `eac-exp-${crypto.randomUUID()}`;
    const run = (async () => {
      try {
        const response = await options.provider.invoke({
          contractVersion: APPLICATION_CONTRACT_VERSION,
          requestId: id,
          correlationId: id,
          kind: "command",
          commandId: id,
          method: "environment.configureEacExperimental",
          params: { enabled: target },
        });
        if (response.ok && experimentalEnabled === target) {
          syncedValue = target;
        }
      } catch {
        /* Provider may still be starting or restarting; ensureSynced / subscribeStatus will retry. */
      }
    })();
    inFlightSync = run;
    try {
      await run;
    } finally {
      if (inFlightSync === run) {
        inFlightSync = null;
      }
    }
  };

  const ensureSynced = async (): Promise<void> => {
    if (syncedValue === experimentalEnabled) return;
    if (inFlightSync !== null) {
      await inFlightSync;
      if (syncedValue === experimentalEnabled) return;
    }
    await syncProvider();
  };

  options.provider.subscribeStatus?.((status) => {
    if (status.state !== "ready" || status.acceptingCalls === false) {
      syncedValue = null;
      return;
    }
    if (syncedValue !== experimentalEnabled) {
      void syncProvider();
    }
  });

  return {
    isExperimentalEnabled: () => experimentalEnabled,
    async getExperimentalTermination() {
      return { enabled: experimentalEnabled };
    },
    async setExperimentalTermination(enabled: boolean) {
      if (typeof enabled !== "boolean") {
        throw new Error("invalid EAC experimental toggle");
      }
      // Persist to disk FIRST so a failed write never leaves Main, disk, and Provider out of sync.
      await writePersistedExperimental(settingsFile, enabled);
      experimentalEnabled = enabled;
      syncedValue = null;
      await syncProvider();
      return { enabled: experimentalEnabled };
    },
    syncProvider,
    ensureSynced,
    async openRepairFolder() {
      try {
        const id = `eac-open-${crypto.randomUUID()}`;
        const response = await options.provider.invoke({
          contractVersion: APPLICATION_CONTRACT_VERSION,
          requestId: id,
          correlationId: id,
          kind: "query",
          method: "environment.getSnapshot",
          params: {},
        });
        if (!response.ok) return { opened: false };
        const vrchatDir = extractVrchatDirFromSnapshot(response.value);
        if (vrchatDir === null) return { opened: false };
        const verifiedTarget = await resolveVerifiedRepairTarget(vrchatDir);
        if (verifiedTarget === null) return { opened: false };
        options.showItemInFolder(verifiedTarget);
        return { opened: true };
      } catch {
        return { opened: false };
      }
    },
  };
}

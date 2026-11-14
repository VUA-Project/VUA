import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_CONTRACT_VERSION, type ApplicationRequestV01, type ApplicationResponseV01 } from "@vua/contracts";
import { MockOrchestratorProviderV01 } from "@vua/orchestrator-provider";
import { createEacMainController, resolveVerifiedRepairTarget } from "./eac-main.js";
import { routeDesktopGatewayInvoke } from "./gateway-router.js";

const rendererUrl = "http://127.0.0.1:5173";

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("EAC Main controller and Gateway routing", () => {
  it("resolves EasyAntiCheat_EOS_Setup.exe inside the VRChat directory and rejects paths outside it", async () => {
    const steamRoot = makeTempDir("vua-eac-root-");
    const vrchatDir = path.join(steamRoot, "VRChat");
    const eacDir = path.join(vrchatDir, "EasyAntiCheat");
    const setupPath = path.join(eacDir, "EasyAntiCheat_EOS_Setup.exe");
    const outsidePath = path.join(steamRoot, "OtherGame", "EasyAntiCheat_EOS_Setup.exe");

    fs.mkdirSync(eacDir, { recursive: true });
    fs.mkdirSync(path.dirname(outsidePath), { recursive: true });
    fs.writeFileSync(setupPath, "synthetic-setup");
    fs.writeFileSync(outsidePath, "outside-setup");

    const expectedRealSetup = await fs.promises.realpath(setupPath);
    const valid = await resolveVerifiedRepairTarget(vrchatDir);
    expect(valid).toBe(expectedRealSetup);
    expect(await resolveVerifiedRepairTarget(vrchatDir, setupPath)).toBe(expectedRealSetup);

    const escaped = await resolveVerifiedRepairTarget(vrchatDir, outsidePath);
    expect(escaped).toBeNull();

    const traversal = await resolveVerifiedRepairTarget(
      vrchatDir,
      path.join(vrchatDir, "..", "OtherGame", "EasyAntiCheat_EOS_Setup.exe"),
    );
    expect(traversal).toBeNull();
  });

  it("opens Explorer only from server-observed VRChat path and persists experimental switch", async () => {
    const userDataDir = makeTempDir("vua-eac-userdata-");
    const vrchatDir = path.join(makeTempDir("vua-eac-vrchat-"), "VRChat");
    const setupPath = path.join(vrchatDir, "EasyAntiCheat", "EasyAntiCheat_EOS_Setup.exe");
    fs.mkdirSync(path.dirname(setupPath), { recursive: true });
    fs.writeFileSync(setupPath, "synthetic-setup");
    fs.writeFileSync(path.join(vrchatDir, "VRChat.exe"), "synthetic-vrchat");

    const calls: ApplicationRequestV01[] = [];
    const shown: string[] = [];
    const provider = {
      async invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
        calls.push(request);
        if (request.method === "environment.getSnapshot") {
          return {
            contractVersion: APPLICATION_CONTRACT_VERSION,
            requestId: request.requestId,
            ok: true,
            value: {
              contractVersion: APPLICATION_CONTRACT_VERSION,
              revision: 1,
              capturedAt: "2026-11-14T10:00:00.000Z",
              items: [
                {
                  checkId: "vrchat",
                  zone: "play",
                  presence: "detected",
                  facts: { exe: path.join(vrchatDir, "VRChat.exe") },
                },
              ],
            },
          };
        }
        return {
          contractVersion: APPLICATION_CONTRACT_VERSION,
          requestId: request.requestId,
          ok: true,
          value: { enabled: true },
        };
      },
    };

    const controller = createEacMainController({
      userDataDir,
      provider,
      showItemInFolder: (fullPath) => shown.push(fullPath),
    });

    expect(controller.isExperimentalEnabled()).toBe(false);
    expect(await controller.getExperimentalTermination()).toEqual({ enabled: false });

    const opened = await controller.openRepairFolder();
    expect(opened).toEqual({ opened: true });
    expect(shown).toEqual([await fs.promises.realpath(setupPath)]);

    expect(await controller.setExperimentalTermination(true)).toEqual({ enabled: true });
    expect(controller.isExperimentalEnabled()).toBe(true);
    expect(calls.some((call) => call.method === "environment.configureEacExperimental")).toBe(true);

    // Reload from disk in a fresh controller instance.
    const reloaded = createEacMainController({
      userDataDir,
      provider,
      showItemInFolder: () => {},
    });
    expect(reloaded.isExperimentalEnabled()).toBe(true);
  });

  it("blocks environment.terminateEacResidual in Main when experimental switch is off and forwards inspectEac", async () => {
    const provider = new MockOrchestratorProviderV01();
    await provider.start();
    const invoke = vi.spyOn(provider, "invoke");
    const resolveMaterialSource = () => undefined;

    await routeDesktopGatewayInvoke(
      { provider, productVersion: "1.1.0", platform: "win32", rendererUrl, resolveMaterialSource },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "eac-inspect-1",
        method: "environment.inspectEac",
        params: { schemaVersion: "0.2" },
      },
    );
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "query",
        method: "environment.inspectEac",
        params: { schemaVersion: "0.2" },
      }),
    );

    invoke.mockClear();
    const blocked = await routeDesktopGatewayInvoke(
      {
        provider,
        productVersion: "1.1.0",
        platform: "win32",
        rendererUrl,
        resolveMaterialSource,
        eac: { isExperimentalEnabled: () => false },
      },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "eac-term-blocked",
        method: "environment.terminateEacResidual",
        params: {
          schemaVersion: "0.2",
          pid: 14200,
          created: "134075820000000000",
          path: "D:\\SteamLibrary\\steamapps\\common\\VRChat\\start_protected_game.exe",
          confirmed: true,
          commandId: "cmd-eac-1",
        },
      },
    );
    expect(blocked).toMatchObject({
      ok: false,
      error: {
        code: "application",
        application: { code: "vua.eac.experimental_disabled" },
      },
    });
    expect(invoke).not.toHaveBeenCalled();

    await routeDesktopGatewayInvoke(
      {
        provider,
        productVersion: "1.1.0",
        platform: "win32",
        rendererUrl,
        resolveMaterialSource,
        eac: { isExperimentalEnabled: () => true },
      },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "eac-term-allowed",
        method: "environment.terminateEacResidual",
        params: {
          schemaVersion: "0.2",
          pid: 14200,
          created: "134075820000000000",
          path: "D:\\SteamLibrary\\steamapps\\common\\VRChat\\start_protected_game.exe",
          confirmed: true,
          commandId: "cmd-eac-2",
        },
      },
    );
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "command",
        method: "environment.terminateEacResidual",
        commandId: "cmd-eac-2",
        params: {
          schemaVersion: "0.2",
          pid: 14200,
          created: "134075820000000000",
          path: "D:\\SteamLibrary\\steamapps\\common\\VRChat\\start_protected_game.exe",
          confirmed: true,
        },
      }),
    );

    invoke.mockClear();
    const repairBlocked = await routeDesktopGatewayInvoke(
      {
        provider,
        productVersion: "1.1.0",
        platform: "win32",
        rendererUrl,
        resolveMaterialSource,
        eac: { isExperimentalEnabled: () => false },
      },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "eac-repair-blocked",
        method: "environment.launchEacRepair",
        params: {
          schemaVersion: "0.2",
          confirmed: true,
          commandId: "cmd-repair-blocked",
        },
      },
    );
    expect(repairBlocked).toMatchObject({
      ok: false,
      error: {
        code: "application",
        application: { code: "vua.eac.experimental_disabled" },
      },
    });
    expect(invoke).not.toHaveBeenCalled();

    const ensureSynced = vi.fn(async () => {});
    await routeDesktopGatewayInvoke(
      {
        provider,
        productVersion: "1.1.0",
        platform: "win32",
        rendererUrl,
        resolveMaterialSource,
        eac: { isExperimentalEnabled: () => true, ensureSynced },
      },
      `${rendererUrl}/`,
      {
        schemaVersion: 1,
        requestId: "eac-repair-allowed",
        method: "environment.launchEacRepair",
        params: {
          schemaVersion: "0.2",
          confirmed: true,
          commandId: "cmd-repair-allowed",
        },
      },
    );
    expect(ensureSynced).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "command",
        method: "environment.launchEacRepair",
        commandId: "cmd-repair-allowed",
        params: {
          schemaVersion: "0.2",
          confirmed: true,
        },
      }),
    );
  });

  it("keeps Main memory false when disk write fails and re-syncs experimental state on provider restart", async () => {
    const userDataDir = makeTempDir("vua-eac-sync-");
    // Block eac-experimental.json with a directory so rename fails deterministically.
    const blockedSettingsDir = path.join(userDataDir, "eac-experimental.json");
    fs.mkdirSync(blockedSettingsDir, { recursive: true });

    const syncCalls: boolean[] = [];
    let statusListener:
      | ((status: { readonly state: string; readonly acceptingCalls?: boolean }) => void)
      | null = null;
    const provider = {
      subscribeStatus(
        listener: (status: { readonly state: string; readonly acceptingCalls?: boolean }) => void,
      ) {
        statusListener = listener;
        return () => {
          statusListener = null;
        };
      },
      async invoke(request: ApplicationRequestV01): Promise<ApplicationResponseV01> {
        if (request.method === "environment.configureEacExperimental") {
          syncCalls.push(request.params.enabled);
        }
        return {
          contractVersion: APPLICATION_CONTRACT_VERSION,
          requestId: request.requestId,
          ok: true,
          value: { enabled: request.method === "environment.configureEacExperimental" ? request.params.enabled : false },
        };
      },
    };

    const controller = createEacMainController({
      userDataDir,
      provider,
      showItemInFolder: () => {},
    });

    await expect(controller.setExperimentalTermination(true)).rejects.toThrow();
    expect(controller.isExperimentalEnabled()).toBe(false);
    expect(syncCalls).toEqual([]);

    // Remove the blocking directory so persistence succeeds, then verify provider restart re-syncs.
    fs.rmSync(blockedSettingsDir, { recursive: true, force: true });
    expect(await controller.setExperimentalTermination(true)).toEqual({ enabled: true });
    expect(controller.isExperimentalEnabled()).toBe(true);
    expect(syncCalls).toEqual([true]);

    // Simulate supervised provider restart: failed -> ready triggers automatic re-sync.
    expect(statusListener).not.toBeNull();
    statusListener?.({ state: "failed", acceptingCalls: false });
    statusListener?.({ state: "ready", acceptingCalls: true });
    await controller.ensureSynced();
    expect(syncCalls).toEqual([true, true]);
  });
});

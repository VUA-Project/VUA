import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 桌面壳 Provider 运行时环境注入(用户实测缺口修复 2026-09-12):
 * 基座清洗只放行系统变量,仓储/下载/生产用例服务面按 bin 约定从环境读取
 * VUA_PROVIDER_DATA/VUA_WAREHOUSE_ROOT/VUA_PROJECT_ROOT——壳作为组合根
 * 显式补齐;本测试钉死注入面:三变量在位、其余宿主变量仍被清洗剥离。
 */

const spawn = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawn(...args),
}));

import { desktopProviderProcessFactory } from "./provider-bootstrap.js";

const ENDPOINT_ROOTS = {
  role: "amf" as const,
  providerDataRoot: "C:/Users/test/AppData/Roaming/vua",
  warehouseRoot: "C:/Users/test/AppData/Roaming/vua/warehouse",
  projectRoot: "C:/Users/test/AppData/Roaming/vua/production/synthetic-avatar-project",
};

describe("desktop provider process factory environment injection", () => {
  beforeEach(() => {
    spawn.mockReset();
    spawn.mockReturnValue({ fake: "child" });
  });

  it("host composition rejects AMF roots even when ambient variables or obsolete callers supply them", () => {
    const factory = desktopProviderProcessFactory({ ...ENDPOINT_ROOTS, role: "host", legacyDatabasePath: "C:/vua/legacy.db" });
    factory("C:/vua/host.exe", "C:/vua/host.db");
    const options = spawn.mock.calls[0]![2] as { env: Record<string, string | undefined> };
    expect(options.env.VUA_PROVIDER_DATA).toBeUndefined();
    expect(options.env.VUA_WAREHOUSE_ROOT).toBeUndefined();
    expect(options.env.VUA_PROJECT_ROOT).toBeUndefined();
    expect(options.env.VUA_LEGACY_TASK_DB).toBe("C:/vua/legacy.db");
  });

  it("spawns with the runtime-config variables the provider bin reads", () => {
    const factory = desktopProviderProcessFactory(ENDPOINT_ROOTS);
    const child = factory("C:/vua/provider.exe", "C:/vua/provider.db");
    expect(child).toEqual({ fake: "child" });
    expect(spawn).toHaveBeenCalledTimes(1);
    const [executable, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: Record<string, string | undefined> },
    ];
    expect(executable).toBe("C:/vua/provider.exe");
    expect(args).toEqual(["--database", "C:/vua/provider.db"]);
    expect(options.cwd).toBe("C:/vua");
    expect(options.env.VUA_PROVIDER_DATA).toBe(ENDPOINT_ROOTS.providerDataRoot);
    expect(options.env.VUA_WAREHOUSE_ROOT).toBe(ENDPOINT_ROOTS.warehouseRoot);
    expect(options.env.VUA_PROJECT_ROOT).toBe(ENDPOINT_ROOTS.projectRoot);
  });

  it.each(["host", "amf"] as const)("injects only Main-selected OS profile folders into %s", (role) => {
    vi.stubEnv("USERPROFILE", "C:/ambient-home");
    vi.stubEnv("LOCALAPPDATA", "C:/ambient-local");
    vi.stubEnv("APPDATA", "C:/ambient-roaming");
    vi.stubEnv("VUA_TOKEN", "synthetic-secret");
    try {
      const factory = desktopProviderProcessFactory({ ...ENDPOINT_ROOTS, role, profileRoots: {
        home: "C:/selected/home", localAppData: "C:/selected/local", appData: "C:/selected/roaming",
      } });
      factory("C:/vua/provider.exe", "C:/vua/provider.db");
      const options = spawn.mock.calls[0]![2] as { env: Record<string, string | undefined> };
      expect(options.env.USERPROFILE).toBe("C:/selected/home");
      expect(options.env.LOCALAPPDATA).toBe("C:/selected/local");
      expect(options.env.APPDATA).toBe("C:/selected/roaming");
      expect(options.env.VUA_TOKEN).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the sanitize base: host variables other than the injected set stay stripped", () => {
    const previous = {
      PATH: "C:/unneeded",
      VUA_TOKEN: "secret",
      GITHUB_TOKEN: "secret",
      TEMP: "C:\\Temp",
    };
    const original = { ...process.env };
    Object.assign(process.env, previous);
    try {
      const factory = desktopProviderProcessFactory(ENDPOINT_ROOTS);
      factory("C:/vua/provider.exe", "C:/vua/provider.db");
      const [, , options] = spawn.mock.calls[0] as unknown as [
        string,
        string[],
        { env: Record<string, string | undefined> },
      ];
      // 环境键集 = 清洗层放行的系统变量(大小写随宿主环境块)+ 三个注入的
      // 运行时根,别无其它;凭据形与普通宿主变量一律剥离
      const allowed = new Set(["systemroot", "windir", "temp", "tmp"]);
      const injected = new Set(["VUA_PROVIDER_DATA", "VUA_WAREHOUSE_ROOT", "VUA_PROJECT_ROOT"]);
      for (const key of Object.keys(options.env)) {
        expect(
          allowed.has(key.toLowerCase()) || injected.has(key),
          `unexpected env key: ${key}`,
        ).toBe(true);
      }
      expect(options.env.TEMP).toBe("C:\\Temp");
      expect(options.env.PATH).toBeUndefined();
      expect(options.env.VUA_TOKEN).toBeUndefined();
      expect(options.env.GITHUB_TOKEN).toBeUndefined();
      expect(options.env.VUA_PROVIDER_DATA).toBe(ENDPOINT_ROOTS.providerDataRoot);
    } finally {
      for (const key of Object.keys(previous)) {
        if (original[key] === undefined) delete process.env[key];
        else process.env[key] = original[key];
      }
    }
  });
});

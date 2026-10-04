import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDesktopRuntime } from "./runtime-paths.js";

const location = {
  isPackaged: true,
  resourcesPath: path.resolve("temporary install", "用户目录", "resources"),
  mainDirectory: path.resolve("checkout", "apps/desktop/dist/electron"),
  platform: "win32" as const,
  env: {},
};

describe("standalone desktop resources", () => {
  it("uses the bundled native executable and local UI even with developer overrides", () => {
    const result = resolveDesktopRuntime({ ...location, env: {
      VUA_PROVIDER_EXECUTABLE: "stale-provider.exe",
      VUA_RENDERER_URL: "http://127.0.0.1:5173",
    } });
    expect(result.providerExecutable).toBe(path.join(location.resourcesPath, "provider", "vua-orchestrator-provider.exe"));
    expect(result.rendererUrl).toBeUndefined();
  });

  it("keeps the checkout build path for development without depending on cwd", () => {
    const result = resolveDesktopRuntime({ ...location, isPackaged: false });
    expect(result.providerExecutable).toBe(path.resolve("checkout/target/release/vua-orchestrator-provider.exe"));
  });

  it("retains explicit development overrides and non-Windows executable names", () => {
    const env = { VUA_PROVIDER_EXECUTABLE: "/custom/provider", VUA_RENDERER_URL: "http://127.0.0.1:5173" };
    expect(resolveDesktopRuntime({ ...location, isPackaged: false, platform: "linux", env }))
      .toEqual({ providerExecutable: env.VUA_PROVIDER_EXECUTABLE, rendererUrl: env.VUA_RENDERER_URL });
    expect(resolveDesktopRuntime({ ...location, isPackaged: false, platform: "linux" }).providerExecutable)
      .toBe(path.resolve("checkout/target/release/vua-orchestrator-provider"));
  });
});

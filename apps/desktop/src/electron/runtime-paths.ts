import path from "node:path";

interface RuntimeLocation {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly mainDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
}

/** Resolve executable resources independently of the working directory.
 * Packaged apps always use their bundled Provider/UI. Development overrides stay
 * available in a checkout, but cannot redirect a distributed app to stale builds. */
export function resolveDesktopRuntime(location: RuntimeLocation): {
  readonly providerExecutable: string;
  readonly rendererUrl: string | undefined;
} {
  const binary = `vua-orchestrator-provider${location.platform === "win32" ? ".exe" : ""}`;
  if (location.isPackaged) {
    return {
      providerExecutable: path.join(location.resourcesPath, "provider", binary),
      rendererUrl: undefined,
    };
  }
  return {
    providerExecutable: location.env.VUA_PROVIDER_EXECUTABLE
      ?? path.resolve(location.mainDirectory, "../../../..", "target", "release", binary),
    rendererUrl: location.env.VUA_RENDERER_URL,
  };
}

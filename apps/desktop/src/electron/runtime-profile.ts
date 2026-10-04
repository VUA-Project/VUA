import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { App, BrowserWindow } from "electron";

interface ProfileLocation {
  readonly isPackaged: boolean;
  readonly appData: string;
  readonly localAppData?: string | undefined;
  /** Canonical directory of the compiled Main module, independent of process.cwd(). */
  readonly mainDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly developmentOverride?: string | undefined;
  readonly packagedSmokeDirectory?: string | undefined;
}

export interface DesktopProfile {
  readonly kind: "development" | "release" | "packaged-smoke";
  readonly userData: string;
  readonly sessionData: string;
  readonly developmentLabel?: string;
}

/** Select one profile before creating any Session, window or Provider.
 * Checkouts own development data; releases keep a stable installation-independent
 * profile. Branch names/commits are deliberately absent from the identity.
 * Existing shared data is never copied, migrated or removed by this selector. */
export function resolveDesktopProfile(location: ProfileLocation): DesktopProfile {
  const paths = location.platform === "win32" ? path.win32 : path.posix;
  const absolute = (directory: string): string => {
    if (!paths.isAbsolute(directory) || directory.includes("\0")) {
      throw new Error("Desktop profile directory must be an absolute path");
    }
    return paths.normalize(directory);
  };
  const profile = (kind: DesktopProfile["kind"], directory: string, developmentLabel?: string): DesktopProfile => ({
    kind,
    userData: directory,
    // Keep browser storage at the same relative location in existing releases.
    // Explicitly setting both paths prevents Electron retaining its default session root.
    sessionData: directory,
    ...(developmentLabel === undefined ? {} : { developmentLabel }),
  });

  if (location.isPackaged) {
    if (location.packagedSmokeDirectory !== undefined) {
      return profile("packaged-smoke", absolute(location.packagedSmokeDirectory));
    }
    // A developer environment variable must never redirect an ordinary release.
    return profile("release", paths.join(absolute(location.appData), "VUA"));
  }

  const worktree = paths.resolve(absolute(location.mainDirectory), "../../../..");
  const identity = location.platform === "win32" ? worktree.toLowerCase() : worktree;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  const name = paths.basename(identity).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 48) || "checkout";
  const directory = location.developmentOverride !== undefined
    ? absolute(location.developmentOverride)
    : paths.join(absolute(location.localAppData ?? location.appData), "VUA-dev", `${name}-${hash}`);
  const label = `${paths.basename(worktree)}-${hash}${location.developmentOverride !== undefined ? " / custom" : ""}`;
  return profile("development", directory, label);
}

/** Electron caches Session paths during startup: configure before app.ready.
 * All application/Provider paths are subsequently derived from userData. */
export function configureDesktopProfile(
  app: Pick<App, "isReady" | "setPath" | "setAppLogsPath">,
  profile: DesktopProfile,
): void {
  if (app.isReady()) throw new Error("Desktop profile must be configured before app.ready");
  fs.mkdirSync(profile.userData, { recursive: true });
  app.setPath("userData", profile.userData);
  app.setPath("sessionData", profile.sessionData);
  app.setAppLogsPath(path.join(profile.userData, "logs"));
}

/** Native titles identify frameless development windows in taskbar/Alt+Tab.
 * Renderer page titles must not replace the checkout label after navigation. */
export function tagDevelopmentWindow(window: BrowserWindow, profile: DesktopProfile): void {
  if (profile.developmentLabel === undefined) return;
  const title = `VUA [DEV ${profile.developmentLabel}]`;
  window.setTitle(title);
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(title);
  });
}

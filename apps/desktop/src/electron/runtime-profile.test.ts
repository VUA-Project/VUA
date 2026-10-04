import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureDesktopProfile, resolveDesktopProfile, tagDevelopmentWindow } from "./runtime-profile.js";

const location = {
  isPackaged: false,
  appData: "C:\\Users\\player\\AppData\\Roaming",
  localAppData: "C:\\Users\\player\\AppData\\Local",
  mainDirectory: "C:\\work\\VUA\\apps\\desktop\\dist\\electron",
  platform: "win32" as const,
};
const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("checkout profile selection", () => {
  it("gives the three checkouts separate complete profiles and keeps restart identity stable", () => {
    const profiles = ["VUA", "VUA-docs", "VUA-GLM"].map((name) => resolveDesktopProfile({
      ...location, mainDirectory: `C:\\work\\${name}\\apps\\desktop\\dist\\electron`,
    }));
    expect(new Set(profiles.map((profile) => profile.userData)).size).toBe(3);
    for (const profile of profiles) {
      expect(profile.userData).toMatch(/^C:\\Users\\player\\AppData\\Local\\VUA-dev\\/);
      expect(profile.sessionData).toBe(profile.userData);
    }
    expect(resolveDesktopProfile(location)).toEqual(profiles[0]);
  });

  it("distinguishes same-named checkouts under different parents", () => {
    const other = resolveDesktopProfile({ ...location, mainDirectory: "C:\\other\\VUA\\apps\\desktop\\dist\\electron" });
    expect(other.userData).not.toBe(resolveDesktopProfile(location).userData);
    expect(other.developmentLabel).not.toBe(resolveDesktopProfile(location).developmentLabel);
  });

  it("normalizes Windows path case, separators and trailing separators", () => {
    expect(resolveDesktopProfile({
      ...location, mainDirectory: "c:/WORK/vua/apps/desktop/dist/electron/",
    }).userData).toBe(resolveDesktopProfile(location).userData);
  });

  it("supports Unicode and spaces and retains case-sensitive identities outside Windows", () => {
    const unix = { ...location, platform: "linux" as const, appData: "/tmp/app-data", localAppData: undefined };
    const upper = resolveDesktopProfile({ ...unix, mainDirectory: "/tmp/用户目录/VUA space/apps/desktop/dist/electron" });
    const lower = resolveDesktopProfile({ ...unix, mainDirectory: "/tmp/用户目录/vua space/apps/desktop/dist/electron" });
    expect(upper.userData).toMatch(/^\/tmp\/app-data\/VUA-dev\/VUA space-/);
    expect(lower.userData).not.toBe(upper.userData);
  });

  it("supports an explicit isolated development test directory", () => {
    const result = resolveDesktopProfile({ ...location, developmentOverride: "D:\\测试 profiles\\run-1" });
    expect(result.userData).toBe("D:\\测试 profiles\\run-1");
    expect(result.sessionData).toBe(result.userData);
    expect(result.developmentLabel).toContain("/ custom");
  });

  it.each(["", "relative-profile", "C:relative", "D:\\bad\0path"])("rejects an invalid explicit directory: %j", (directory) => {
    expect(() => resolveDesktopProfile({ ...location, developmentOverride: directory })).toThrow("absolute path");
  });

  it("keeps release data stable across installation locations and ignores dev overrides", () => {
    const first = resolveDesktopProfile({ ...location, isPackaged: true, developmentOverride: "relative-invalid" });
    const moved = resolveDesktopProfile({ ...location, isPackaged: true, mainDirectory: "D:\\portable\\resources\\app.asar" });
    expect(first).toEqual(moved);
    expect(first).toEqual({
      kind: "release", userData: `${location.appData}\\VUA`, sessionData: `${location.appData}\\VUA`,
    });
  });

  it("selects packaged smoke data before release data and rejects a bad smoke path", () => {
    const result = resolveDesktopProfile({ ...location, isPackaged: true,
      packagedSmokeDirectory: "D:\\smoke\\profile", developmentOverride: "D:\\dev" });
    expect(result).toEqual({ kind: "packaged-smoke", userData: "D:\\smoke\\profile", sessionData: "D:\\smoke\\profile" });
    expect(() => resolveDesktopProfile({ ...location, isPackaged: true, packagedSmokeDirectory: "" })).toThrow("absolute path");
  });
});

describe("early profile configuration", () => {
  it("configures both Electron stores and logs without importing or replacing existing files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vua-profile-test-"));
    temporary.push(root);
    const userData = path.join(root, "new-profile");
    const sentinel = path.join(root, "legacy.db");
    fs.writeFileSync(sentinel, "old data stays untouched");
    const app = { isReady: () => false, setPath: vi.fn(), setAppLogsPath: vi.fn() };
    const profile = { kind: "development" as const, userData, sessionData: userData };
    configureDesktopProfile(app, profile);
    fs.writeFileSync(path.join(userData, "settings.json"), '{"kept":true}');
    configureDesktopProfile(app, profile);
    expect(app.setPath).toHaveBeenCalledWith("userData", userData);
    expect(app.setPath).toHaveBeenCalledWith("sessionData", userData);
    expect(app.setAppLogsPath).toHaveBeenCalledWith(path.join(userData, "logs"));
    expect(fs.readdirSync(userData)).toEqual(["settings.json"]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("old data stays untouched");
    expect(fs.readFileSync(path.join(userData, "settings.json"), "utf8")).toBe('{"kept":true}');
  });

  it("refuses late configuration before changing Electron paths", () => {
    const app = { isReady: () => true, setPath: vi.fn(), setAppLogsPath: vi.fn() };
    expect(() => configureDesktopProfile(app, resolveDesktopProfile(location))).toThrow("before app.ready");
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it("keeps the development title through renderer navigation without tagging releases", () => {
    const window = { setTitle: vi.fn(), on: vi.fn() };
    tagDevelopmentWindow(window as unknown as BrowserWindow, resolveDesktopProfile(location));
    const expected = window.setTitle.mock.calls[0]![0];
    const preventDefault = vi.fn();
    window.on.mock.calls[0]![1]({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(window.setTitle).toHaveBeenLastCalledWith(expected);
    expect(expected).toContain("[DEV VUA-");
    const release = { setTitle: vi.fn(), on: vi.fn() };
    tagDevelopmentWindow(release as unknown as BrowserWindow, resolveDesktopProfile({ ...location, isPackaged: true }));
    expect(release.setTitle).not.toHaveBeenCalled();
    expect(release.on).not.toHaveBeenCalled();
  });
});

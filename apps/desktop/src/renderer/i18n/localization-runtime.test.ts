import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateTime } from "./date-time.ts";
import { diagnosticMessage, taskErrorMessage } from "./diagnostics.ts";
import { installLocaleSync, localeChangeRequiresReload } from "./locale-sync.ts";
import { storageKeys } from "../app/storage-keys.ts";
import { strings as en } from "./strings.en.ts";
import { strings as ja } from "./strings.ja.ts";
import { strings as zh } from "./strings.zh-CN.ts";
import { strings as zhTW } from "./strings.zh-TW.ts";
import { strings as ko } from "./strings.ko.ts";

afterEach(() => vi.unstubAllGlobals());

describe("application language formatting", () => {
  it("uses the chosen language even when the host uses another default", () => {
    const timestamp = "2026-09-20T04:30:00Z";
    for (const locale of ["en", "ja", "zh-CN", "zh-TW", "ko"] as const) {
      expect(formatDateTime(timestamp, locale)).toBe(new Intl.DateTimeFormat(locale, {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).format(new Date(timestamp)));
    }
    expect(formatDateTime(timestamp, "ja")).not.toBe(formatDateTime(timestamp, "en"));
  });
  it("retains malformed upstream timestamps", () => {
    expect(formatDateTime("unknown", "ja")).toBe("unknown");
    expect(formatDateTime("", "ja")).toBe("");
  });
});

describe("diagnostics preserve uncertainty", () => {
  it("explains known findings and does not mistake readiness for SDK approval", () => {
    for (const table of [en, ja, zh, zhTW, ko]) {
      expect(diagnosticMessage("references.missing_material", table.diagnostics)).toBe(table.diagnostics.missingMaterial);
      expect(diagnosticMessage("upload_readiness.clean", table.diagnostics)).toBe(table.diagnostics.uploadComponentsPresent);
      expect(diagnosticMessage("performance.estimated", table.diagnostics)).toBe(table.diagnostics.performanceEstimated);
      expect(taskErrorMessage("inspect_required", table.diagnostics)).toBe(table.diagnostics.inspectRequired);
    }
  });
  it("never invents a translation for an unknown or near-matching code", () => {
    for (const code of ["vendor.failure", "references.clean.future", "constructor", "__proto__", ""]) {
      expect(diagnosticMessage(code, ja.diagnostics)).toBe(ja.diagnostics.unknown);
      expect(taskErrorMessage(code, ja.diagnostics)).toBe(ja.diagnostics.taskFailed);
    }
  });
});

describe("language changes across local windows", () => {
  it("ignores unrelated or unchanged settings and resolves removal using the system language", () => {
    expect(localeChangeRequiresReload(storageKeys.theme, "ja", "en", ["en"])).toBe(false);
    expect(localeChangeRequiresReload(storageKeys.locale, "ja", "ja", ["en"])).toBe(false);
    expect(localeChangeRequiresReload(storageKeys.locale, "ja", "en", ["en"])).toBe(true);
    expect(localeChangeRequiresReload(storageKeys.locale, null, "ja", ["en"])).toBe(true);
    expect(localeChangeRequiresReload(null, null, "ja", ["ja"])).toBe(false);
    expect(localeChangeRequiresReload(storageKeys.locale, "invalid", "en", ["en"])).toBe(false);
  });
  it("subscribes every surface, ignores session storage, and removes its listener", () => {
    const target = new EventTarget();
    const localStorage = {};
    const reload = vi.fn();
    vi.stubGlobal("window", { localStorage, location: { reload }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) });
    vi.stubGlobal("navigator", { languages: ["en"] });
    const dispose = installLocaleSync("en");
    const send = (storageArea: object, key: string, newValue: string) => target.dispatchEvent(Object.assign(new Event("storage"), { storageArea, key, newValue }));
    send({}, storageKeys.locale, "ja");
    send(localStorage, storageKeys.theme, "ja");
    expect(reload).not.toHaveBeenCalled();
    send(localStorage, storageKeys.locale, "ja");
    expect(reload).toHaveBeenCalledTimes(1);
    dispose();
    send(localStorage, storageKeys.locale, "ko");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

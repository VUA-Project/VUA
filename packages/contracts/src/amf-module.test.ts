import { describe, expect, it } from "vitest";
import { isAmfModuleSnapshotV01, isAmfModuleChangeResultV01 } from "./amf-module.js";

const absent = { schemaVersion: "0.1", moduleId: "amf", installed: false, state: "absent" };
describe("optional AMF lifecycle v0.1", () => {
  it("requires installed/readiness facts to agree and rejects unknown fields or versions", () => {
    expect(isAmfModuleSnapshotV01(absent)).toBe(true);
    for (const state of ["starting", "ready", "failed", "stopping"]) {
      expect(isAmfModuleSnapshotV01({ ...absent, installed: true, state })).toBe(true);
      expect(isAmfModuleSnapshotV01({ ...absent, state })).toBe(false);
    }
    for (const value of [null, [], { ...absent, installed: true }, { ...absent, schemaVersion: "0.2" },
      { ...absent, moduleId: "mio" }, { ...absent, filePath: "private" }, { ...absent, state: "unknown" }]) {
      expect(isAmfModuleSnapshotV01(value)).toBe(false);
    }
  });
  it("accepts only the closed change result with a valid actual lifecycle snapshot", () => {
    for (const outcome of ["updated", "busy", "failed"]) expect(isAmfModuleChangeResultV01({ outcome, snapshot: absent })).toBe(true);
    for (const value of [null, { outcome: "ok", snapshot: absent }, { outcome: "updated", snapshot: { ...absent, state: "ready" } },
      { outcome: "updated", snapshot: absent, untrusted: true }]) expect(isAmfModuleChangeResultV01(value)).toBe(false);
  });
});

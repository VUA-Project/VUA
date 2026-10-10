import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AmfRegistry } from "./amf-registry.js";

const profiles: string[] = [];
function profile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vua-module-registry-"));
  profiles.push(directory);
  return directory;
}
afterEach(() => { for (const directory of profiles.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("host-owned AMF selection and data layout", () => {
  it("fresh profiles default to enabled without creating module data during selection", () => {
    const directory = profile();
    const registry = new AmfRegistry(directory);
    expect(registry.registration).toEqual({ schemaVersion: "0.1", enabled: true, dataLayout: "isolated" });
    expect(registry.needsRegistration).toBe(true);
    expect(fs.readdirSync(directory)).toEqual([]);
    registry.save(registry.registration.enabled);
    fs.mkdirSync(path.join(directory, "host"));
    fs.writeFileSync(path.join(directory, "host", "tasks.db"), "host");
    expect(new AmfRegistry(directory).registration.enabled).toBe(true);
  });

  it("an existing host profile without a saved module choice keeps the old disabled default", () => {
    const directory = profile();
    fs.mkdirSync(path.join(directory, "host"));
    fs.writeFileSync(path.join(directory, "host", "tasks.db"), "host");
    expect(new AmfRegistry(directory).registration.enabled).toBe(false);
  });

  it("legacy data waits for explicit enable and keeps its layout even if BDL cannot be read", () => {
    const directory = profile();
    fs.mkdirSync(path.join(directory, "bdl"));
    fs.writeFileSync(path.join(directory, "bdl", "bdl.db"), "not a readable BDL");
    const registry = new AmfRegistry(directory);
    expect(registry.registration).toEqual({ schemaVersion: "0.1", enabled: false, dataLayout: "legacy" });
    expect(registry.dataRoot()).toBe(directory);
    expect(fs.existsSync(registry.file)).toBe(false);
    registry.save(true);
    const restarted = new AmfRegistry(directory);
    expect(restarted.registration.enabled).toBe(true);
    expect(restarted.dataRoot()).toBe(directory);
    restarted.save(false);
    expect(new AmfRegistry(directory).registration.enabled).toBe(false);
    expect(fs.readFileSync(path.join(directory, "bdl", "bdl.db"), "utf8")).toBe("not a readable BDL");
  });

  it("enable/disable survives restart and keeps the same isolated data", () => {
    const registry = new AmfRegistry(profile());
    registry.save(true);
    fs.mkdirSync(registry.dataRoot(), { recursive: true });
    fs.writeFileSync(path.join(registry.dataRoot(), "retained.fixture"), "retained");
    const restarted = new AmfRegistry(registry.userData);
    expect(restarted.registration.enabled).toBe(true);
    restarted.save(false);
    expect(new AmfRegistry(registry.userData).registration.enabled).toBe(false);
    expect(fs.readFileSync(path.join(restarted.dataRoot(), "retained.fixture"), "utf8")).toBe("retained");
    expect(fs.existsSync(`${registry.file}.pending`)).toBe(false);
  });

  it("a damaged selection is not replaced or mistaken for a fresh profile", () => {
    const directory = profile();
    const file = path.join(directory, "modules", "amf.json");
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, "{broken");
    const registry = new AmfRegistry(directory);
    expect(registry.invalid).toBe(true);
    expect(() => registry.save(false)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });
});

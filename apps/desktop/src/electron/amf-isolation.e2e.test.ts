import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { ApplicationRequestV01 } from "@vua/contracts";
import type { OrchestratorProviderV01 } from "@vua/orchestrator-provider";
import { AmfRegistry } from "./amf-registry.js";
import { createDesktopOrchestratorProvider } from "./provider-bootstrap.js";
import { ModuleProvider } from "./module-provider.js";

const suffix = process.platform === "win32" ? ".exe" : "";
const hostBinary = process.env.VUA_TEST_HOST_EXECUTABLE ?? path.resolve("../../target/release/vua-orchestrator-provider" + suffix);
const amfBinary = process.env.VUA_TEST_AMF_EXECUTABLE ?? path.resolve("../../target/release/vua-amf-provider" + suffix);
const binariesExist = fs.existsSync(hostBinary) && fs.existsSync(amfBinary);

// Native checks run explicitly after both binaries are built. Ordinary unit
// tests must not accidentally consume a previous branch's cached executable.
describe.skipIf(process.env.VUA_MODULE_ISOLATION_TEST !== "1" || !binariesExist)("real host / AMF process isolation (no vendor launch or material import)", () => {
  it("starts without AMF, survives corrupt BDL, activates/retries and disables without deleting data", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vua-amf-isolation-"));
    const profileRoots = { home: directory, localAppData: path.join(directory, "Local"), appData: path.join(directory, "Roaming") };
    const registry = new AmfRegistry(directory);
    const data = registry.dataRoot();
    const bdlFile = path.join(data, "bdl", "bdl.db");
    const native: OrchestratorProviderV01[] = [];
    const host = createDesktopOrchestratorProvider({ role: "host", executablePath: hostBinary,
      databasePath: path.join(directory, "host", "tasks.db"), profileRoots });
    native.push(host);
    const provider = new ModuleProvider({ host, enabled: registry.registration.enabled, persist: enabled => registry.save(enabled),
      createAmf: () => {
        const warehouseRoot = path.join(data, "warehouse");
        const projectRoot = path.join(data, "production", "synthetic-avatar-project");
        fs.mkdirSync(warehouseRoot, { recursive: true }); fs.mkdirSync(projectRoot, { recursive: true });
        const instance = createDesktopOrchestratorProvider({ role: "amf", executablePath: amfBinary,
          databasePath: path.join(directory, "modules", "amf", "tasks.db"), providerDataRoot: data, warehouseRoot, projectRoot, profileRoots });
        native.push(instance); return instance;
      } });
    const query = (method: "application.getSnapshot" | "task.list" | "warehouse.listEntries"): ApplicationRequestV01 => ({ contractVersion: "0.1", requestId: crypto.randomUUID(), correlationId: "module-isolation", kind: "query", method, params: {} });
    try {
      expect((await provider.start()).downloadIngest).toBe(false);
      expect(provider.moduleSnapshot().installed).toBe(false);
      expect(fs.existsSync(path.join(directory, "bdl"))).toBe(false);
      expect(fs.existsSync(data)).toBe(false);
      const initial = await provider.invoke(query("application.getSnapshot"));
      if (!initial.ok || !("capabilities" in initial.value)) throw new Error("Expected host snapshot");
      expect(initial.value.capabilities.operations.find(row => row.operationId === "environment.executeDeployment")?.availability).toBe("available");
      expect(initial.value.capabilities.operations.find(row => row.operationId === "catalog.ingestLibraryPage")?.availability).toBe("unavailable");

      fs.mkdirSync(path.dirname(bdlFile), { recursive: true });
      fs.writeFileSync(bdlFile, "deliberately corrupt isolated test database");
      expect((await provider.setAmfEnabled(true)).outcome).toBe("failed");
      expect(provider.status().state).toBe("ready");
      expect((await provider.invoke(query("task.list"))).ok).toBe(true);
      expect((await provider.invoke(query("application.getSnapshot"))).ok).toBe(true);

      fs.unlinkSync(bdlFile);
      expect((await provider.setAmfEnabled(true)).snapshot.state).toBe("ready");
      const entries = await provider.invoke(query("warehouse.listEntries"));
      expect(entries.ok).toBe(true);
      expect(fs.existsSync(bdlFile)).toBe(true);
      expect((await provider.setAmfEnabled(false)).outcome).toBe("updated");
      expect(provider.status().state).toBe("ready");
      expect(fs.existsSync(bdlFile)).toBe(true);
      expect(new AmfRegistry(directory).registration.enabled).toBe(false);
      expect((await provider.invoke(query("task.list"))).ok).toBe(true);
    } finally {
      if (provider.status().state === "ready") await provider.prepareShutdown({ timeoutMs: 3_000 });
      for (let attempt = 0; attempt < 60 && native.some(port => port.status().state === "stopping"); attempt += 1) await delay(50);
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

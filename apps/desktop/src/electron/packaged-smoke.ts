import { app, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { OrchestratorProviderV01 } from "@vua/orchestrator-provider";

/** Explicit packaging diagnostic, used by scripts/smoke-packaged.ps1.
 * It uses a caller-selected isolated profile, the real preload and real Provider;
 * no installer, account or production command is issued. Normal startup ignores it. */
export function preparePackagedSmoke(): PackagedSmoke | undefined {
  if (!app.isPackaged || !app.commandLine.hasSwitch("vua-smoke-test")) return undefined;
  const directory = app.commandLine.getSwitchValue("vua-smoke-test");
  if (!path.isAbsolute(directory)) throw new Error("Packaged smoke requires an absolute isolated profile directory");
  // Main configures both userData and sessionData before any Session is created.
  if (path.resolve(app.getPath("userData")) !== path.resolve(directory)
    || path.resolve(app.getPath("sessionData")) !== path.resolve(directory)) {
    throw new Error("Packaged smoke profile was not initialized");
  }
  return new PackagedSmoke(directory);
}

class PackagedSmoke {
  private readonly timeout: NodeJS.Timeout;

  constructor(private readonly directory: string) {
    // This watchdog also covers startup failures before a renderer exists.
    this.timeout = setTimeout(() => this.fail(new Error("Packaged startup exceeded 45 seconds")), 45_000);
  }

  fail(error: unknown): void {
    clearTimeout(this.timeout);
    this.write({ status: "failed", error: error instanceof Error ? error.message : String(error) });
    app.exit(1);
  }

  async verify(window: BrowserWindow, provider: OrchestratorProviderV01): Promise<void> {
    if (provider.status().state !== "ready") throw new Error("Bundled Provider did not start");
    // Electron exposes ASAR through fs; the package needs no workspace node_modules.
    if (fs.existsSync(path.join(app.getAppPath(), "node_modules"))) throw new Error("Workspace dependencies leaked into the archive");
    const modules = fs.readdirSync(path.join(app.getAppPath(), "dist", "electron")).sort();
    if (modules.join(",") !== "main.js,preload.js") throw new Error("Unexpected desktop modules in the archive");
    // React commits after loadFile resolves. Check the actual compiled shell, not a fixture.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await window.webContents.executeJavaScript("Boolean(document.querySelector('#root')?.children.length)")) break;
      if (attempt === 99) throw new Error("Packaged renderer did not mount");
      await delay(100);
    }
    const result = await window.webContents.executeJavaScript(`(async () => {
      const snapshot = await window.vua.gateway.invoke({schemaVersion: 1, requestId: 'packaged-smoke-snapshot', method: 'app.snapshot', params: {}});
      const tasks = await window.vua.gateway.invoke({schemaVersion: 1, requestId: 'packaged-smoke-tasks', method: 'task.list', params: {}});
      if (!snapshot.ok || !tasks.ok) throw new Error('Packaged Gateway query failed');
      if (snapshot.value.runtime !== 'electron' || snapshot.value.capabilities.operations.length === 0) throw new Error('Missing Provider capabilities');
      const previousMarker = localStorage.getItem('vua.packaged-smoke');
      localStorage.setItem('vua.packaged-smoke', 'persisted');
      return { previousMarker, version: snapshot.value.productVersion, capabilities: snapshot.value.capabilities.operations.length };
    })()`) as { previousMarker: string | null; version: string; capabilities: number };
    await window.webContents.session.flushStorageData();
    const database = path.join(this.directory, "orchestrator", "provider.db");
    if (!fs.statSync(database).isFile()) throw new Error("Provider database was not created in the isolated profile");
    const shutdown = await provider.prepareShutdown({ timeoutMs: 5_000 });
    if (shutdown.outcome === "needs_user_choice") throw new Error("Read-only smoke unexpectedly left a running task");
    clearTimeout(this.timeout);
    this.write({ status: "passed", rendererMounted: true, gatewayQueries: ["app.snapshot", "task.list"], ...result });
    app.exit(0);
  }

  private write(result: Record<string, unknown>): void {
    fs.writeFileSync(path.join(this.directory, "packaged-smoke.json"), JSON.stringify({
      ...result, testedAt: new Date().toISOString(), scope: "Packaged desktop bootstrap; no play or installation acceptance",
    }, null, 2));
  }
}

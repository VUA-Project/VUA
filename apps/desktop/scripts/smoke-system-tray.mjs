// Native Electron tray/menu wiring in an isolated process. No physical click or VR acceptance.
import assert from "node:assert/strict";
import { app, Tray, nativeTheme } from "electron";
import { build } from "vite";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let handle;
const originalSetMenu = Tray.prototype.setContextMenu;
const originalSetImage = Tray.prototype.setImage;
async function main() {
try {
  await app.whenReady();
  const output = await mkdtemp(path.join(os.tmpdir(), "vua-tray-smoke-"));
  await build({ configFile: false, root: desktop, logLevel: "error", build: {
    outDir: output, emptyOutDir: false, target: "node24", minify: false,
    lib: { entry: path.join(desktop, "src/electron/system-tray.ts"), formats: ["cjs"], fileName: () => "system-tray.cjs" },
    rolldownOptions: { platform: "node", external: ["electron", /^node:/] },
  } });
  let tray, menu, refreshedImage;
  Tray.prototype.setContextMenu = function (value) { tray = this; menu = value; return originalSetMenu.call(this, value); };
  Tray.prototype.setImage = function (value) { refreshedImage = value; return originalSetImage.call(this, value); };
  let opened = 0, exited = 0;
  const commands = [];
  const { createVuaTray, vuaTrayImage } = require(path.join(output, "system-tray.cjs"));
  handle = createVuaTray({ locale: "zh-CN", showMain: () => { opened += 1; }, command: command => commands.push(command), quit: () => { exited += 1; } });
  const checks = [];
  assert.equal(tray.isDestroyed(), false); checks.push("native VUA tray is created");
  assert.deepEqual(menu.items.map(item => item.label), ["检查更新", "大屏幕模式", "退出"]); checks.push("right-click menu has exactly the three requested actions");
  tray.emit("double-click"); assert.equal(opened, 1); checks.push("double-click routes to the main-window restore action");
  menu.items[0].click(); menu.items[1].click();
  assert.deepEqual(commands, ["check-updates", "bigscreen"]); checks.push("menu emits only closed update and big screen gestures");
  menu.items[2].click(); assert.equal(exited, 1); checks.push("Exit uses the application quit path");
  for (const locale of ["en", "ja", "ko"]) { handle.setLocale(locale); assert.equal(menu.items.length, 3); }
  handle.setLocale("en"); assert.equal(menu.items[0].label, "Check for updates"); checks.push("menu follows all four UI languages");
  for (const dark of [false, true]) {
    const decoded = vuaTrayImage(dark);
    assert.equal(decoded.isEmpty(), false);
    assert.deepEqual(decoded.getSize(), { width: 16, height: 16 });
    assert.deepEqual(decoded.getScaleFactors(), [1, 1.25, 1.5, 2]);
    nativeTheme.themeSource = dark ? "dark" : "light";
    nativeTheme.emit("updated");
    assert.equal(refreshedImage.isEmpty(), false);
    assert.deepEqual(refreshedImage.getSize(), { width: 16, height: 16 });
    assert.deepEqual(refreshedImage.getScaleFactors(), [1, 1.25, 1.5, 2]);
  }
  checks.push("transparent VUA icons decode for both themes at 100/125/150/200 percent DPI");
  const beforeDispose = nativeTheme.listenerCount("updated");
  handle.dispose(); handle.dispose();
  assert.equal(tray.isDestroyed(), true); assert.equal(nativeTheme.listenerCount("updated"), beforeDispose - 1);
  checks.push("exit removes tray and theme listener; cleanup is repeatable");
  console.log(JSON.stringify({ scope: "Native Electron tray API and programmatically invoked events, isolated process; physical Windows tray clicks remain user review", passed: checks.length, checks }, null, 2));
  app.exit(0);
} catch (error) {
  console.error(error); handle?.dispose(); app.exit(1);
} finally {
  Tray.prototype.setContextMenu = originalSetMenu;
  Tray.prototype.setImage = originalSetImage;
}
}
void main();

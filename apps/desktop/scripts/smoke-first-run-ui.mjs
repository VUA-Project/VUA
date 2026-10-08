// Actual Electron/Chromium UI, synthetic Gateway. No real accounts, installers or hardware.
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { writeFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server, window, taskWindow;
async function main() {
try {
  await app.whenReady();
  server = await createServer({ configFile: false, appType: "custom", root, plugins: [react()],
    cacheDir: path.join(os.tmpdir(), "vua-first-run-ui-vite"),
    define: { __VUA_BUILD_INFO__: JSON.stringify({ version: "synthetic-ui", commit: "synthetic", dirty: false }) },
    server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { force: true, include: ["react", "react-dom/client", "@vua/contracts"] } });
  server.middlewares.use(async (req, res, next) => {
    const route = req.url?.split("?")[0];
    if (route !== "/__first-run-review" && route !== "/__task-window-review") return next();
    res.setHeader("Content-Type", "text/html");
    const entry = route === "/__first-run-review" ? "first-run-review" : "task-window-review";
    res.end(await server.transformIndexHtml(req.url, `<html><head><script>localStorage.setItem("vua-locale","en")</script></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/${entry}.tsx"></script></body></html>`));
  });
  await server.listen();
  const partition = `vua-first-run-review-${Date.now()}`;
  window = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, partition } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__first-run-review`);
  const checks = await window.webContents.executeJavaScript("new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(window.firstRunReview){clearInterval(timer);window.firstRunReview.run().then(resolve,reject);}else if(Date.now()-start>15000){clearInterval(timer);reject(new Error('fixture load timeout'));}},50);})");
  console.log(`First-run controlled UI: ${checks.length} checks passed`);
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (const key of ["Enter", "Escape", "Escape", "ArrowRight"]) {
    await window.webContents.executeJavaScript(`window.firstRunReview.beforeKey(${JSON.stringify(key)})`);
    const code = key === "Enter" ? 13 : key === "Escape" ? 27 : 39;
    await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code,
      ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}) });
    await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
    checks.push(await window.webContents.executeJavaScript(`window.firstRunReview.afterKey(${JSON.stringify(key)})`));
  }
  await window.webContents.executeJavaScript('window.firstRunReview.setThemePreference("light")');
  taskWindow = new BrowserWindow({ show: false, width: 460, height: 640,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition } });
  taskWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  taskWindow.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  await taskWindow.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__task-window-review?view=status`);
  const taskChecks = await taskWindow.webContents.executeJavaScript("new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(window.taskWindowReview){clearInterval(timer);window.taskWindowReview.run().then(resolve,reject);}else if(Date.now()-start>15000){clearInterval(timer);reject(new Error('task fixture load timeout'));}},50);})");
  checks.push(...taskChecks);
  checks.push(await taskWindow.webContents.executeJavaScript('window.taskWindowReview.expectTheme("light")'));
  await window.webContents.executeJavaScript('window.firstRunReview.setThemePreference("dark")');
  checks.push(await taskWindow.webContents.executeJavaScript('window.taskWindowReview.expectTheme("dark")'));
  taskWindow.webContents.debugger.attach("1.3");
  await taskWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await window.webContents.executeJavaScript('window.firstRunReview.setThemePreference("system")');
  checks.push(await taskWindow.webContents.executeJavaScript('window.taskWindowReview.expectTheme("light")'));
  await taskWindow.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  checks.push(await taskWindow.webContents.executeJavaScript('window.taskWindowReview.expectTheme("dark")'));
  await writeFile(path.join(os.tmpdir(), "vua-settings-review.png"), (await window.webContents.capturePage()).toPNG());
  await writeFile(path.join(os.tmpdir(), "vua-task-window-review.png"), (await taskWindow.webContents.capturePage()).toPNG());
  // A missing favicon is irrelevant to the route; actual renderer errors fail the smoke.
  const meaningfulErrors = errors.filter(e => !e.includes("404 (Not Found)"));
  if (meaningfulErrors.length) throw new Error(meaningfulErrors.join("\n"));
  const report = { testedAt: new Date().toISOString(), scope: "Actual Chromium UI with synthetic Gateway; no installation, authentication or VR acceptance", checks, passed: checks.length };
  await writeFile(path.join(os.tmpdir(), "vua-first-run-ui-dom.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  taskWindow.destroy(); window.destroy(); await server.close(); app.exit(0);
} catch (error) {
  console.error(error); taskWindow?.destroy(); window?.destroy(); await server?.close(); app.exit(1);
}
}
void main();

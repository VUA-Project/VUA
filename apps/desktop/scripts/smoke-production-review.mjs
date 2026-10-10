// Actual Chromium DOM regression; synthetic Gateway only, no production/remote services.
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import os from "node:os";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server, window;
// Allow asynchronous cleanup to finish without quitting successfully on failure.
app.on("window-all-closed", () => {});
async function main() {
try {
  await app.whenReady();
  server = await createServer({ configFile: false, appType: "custom", root, plugins: [react()],
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    optimizeDeps: { include: ["react", "react-dom/client", "@vua/contracts"] } });
  server.middlewares.use(async (req, res, next) => {
    if (req.url !== "/__production-review") return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/scripts/fixtures/production-review.tsx"></script></body></html>'));
  });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on("console-message", (event) => { if (event.level === "error") console.error(event.message); });
  await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__production-review`);
  await window.webContents.executeJavaScript('new Promise((resolve, reject) => { let attempts = 0; const timer = setInterval(() => { if(window.review) { clearInterval(timer); resolve(); } else if (++attempts > 200) { clearInterval(timer); reject(new Error("fixture load timeout")); } }, 50); })');
  const checks = await window.webContents.executeJavaScript("window.review.run()");
  await window.webContents.executeJavaScript("window.review.nativeStart()");
  for (const [remaining, target] of [[1, "inner-opener"], [0, "opener"]]) {
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    const focused = await window.webContents.executeJavaScript(`window.review.nativeCheck(${remaining})`);
    if (focused !== target) throw new Error(`native focus restore: expected ${target}, got ${focused}`);
    checks.push(`native Esc leaves ${remaining} dialogs and restores ${target}`);
  }
  const evidence = { date: new Date().toISOString(), browser: process.versions.chrome,
    scope: "Actual Chromium DOM, synthetic Gateway; no remote or production E2E claim", checks, passed: checks.length };
  await writeFile(path.join(os.tmpdir(), "vua-production-review-dom.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  window.destroy(); await server.close(); app.exit(0);
} catch (error) {
  console.error(error); window?.destroy(); await server?.close(); app.exit(1);
}

}
void main();

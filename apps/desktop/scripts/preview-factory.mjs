// Renders the AMF base map, workshop and release room with synthetic data and saves screenshots for visual review.
// Usage: pnpm preview:factory [output-dir] [locale] [theme] [--only=<view prefix>]
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [output = path.join(os.tmpdir(), "vua-preview-factory"), locale = "zh-CN", theme = "dark"] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const views = ["map", "map-flight", "map-control", "map-materials", "map-release", "map-workshop", "workshop-running", "workshop-waiting-auto", "workshop-waiting", "workshop-attention", "workshop-finished",
  "control-recipes", "control-recipes-still", "control-recipes-selected", "control-recipes-part", "control-recipes-list", "control-recipes-many", "control-recipes-empty",
  "control-packages", "control-packages-project", "control-packages-unlisted", "control-packages-repos",
  "release-album", "release-stills", "release-turn", "release-confirm", "release-signin", "release-uploading", "release-uploaded", "release-check", "release-failed", "release-empty", "release-sdk",
  "settings-vrchat", "settings-vrchat-account"];
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice("--only=".length) ?? "";
let server;
app.on("window-all-closed", () => {});
async function main() {
await app.whenReady();
try {
  server = await createServer({ configFile: false, appType: "custom", root, plugins: [react()], logLevel: "error", server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { include: ["react", "react-dom/client", "@vua/contracts"] } });
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/__factory")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml(req.url, `<html data-theme="${theme}"><head><script>localStorage.setItem("vua-locale", ${JSON.stringify(locale)});</script><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column;padding:24px;box-sizing:border-box;background:var(--vua-bg-canvas)}</style></head><body><div id="root" data-module="production"></div><script type="module" src="/scripts/fixtures/factory-preview.tsx"></script></body></html>`));
  });
  await server.listen();
  await mkdir(output, { recursive: true });
  const port = server.httpServer.address().port;
  for (const view of views.filter(name => name.startsWith(only))) {
    const window = new BrowserWindow({ show: false, width: 1280, height: view.startsWith("release-") ? 1000 : 860, webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } });
    window.webContents.on("console-message", event => { if (event.level === "error") console.error(view, event.message); });
    await window.loadURL(`http://127.0.0.1:${port}/__factory#${view}`);
    await new Promise(resolve => setTimeout(resolve, view.startsWith("control-recipes") ? 4500 : 2500));
    await writeFile(path.join(output, `${view}.png`), (await window.webContents.capturePage()).toPNG());
    console.log("captured", view);
    window.destroy();
  }
} catch (error) { console.error(error); process.exitCode = 1; }
await server?.close();
app.exit(process.exitCode ?? 0);
}
void main();

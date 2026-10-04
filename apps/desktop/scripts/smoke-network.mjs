// Real Chromium UI checks with controlled observations; live HTTPS evidence is separate.
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(root, "../../_local_real_machine/network-ui");
app.setPath("userData", path.join(output, "profile"));
let server, window;
const watchdog = setTimeout(() => { console.error("Network DOM smoke timed out"); app.exit(1); }, 60_000);
async function main() {
try {
  await mkdir(output, { recursive: true });
  await app.whenReady();
  server = await createServer({ configFile: false, appType: "custom", root, plugins: [react()],
    server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { include: ["react", "react-dom/client", "@vua/contracts"] } });
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/__network")) return next();
    res.setHeader("Content-Type", "text/html");
    res.end(await server.transformIndexHtml(req.url, '<html><head><script>localStorage.setItem("vua-locale", new URLSearchParams(location.search).get("locale"));</script></head><body style="padding:24px"><div id="root"></div><script type="module" src="/scripts/fixtures/network-check.tsx"></script></body></html>'));
  });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1200, height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on("console-message", event => { if (event.level === "error") console.error(event.message); });
  const results = {};
  for (const locale of ["en", "zh-CN", "ja", "ko"]) {
    await window.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__network?locale=${locale}`);
    await window.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(window.networkReview){clearInterval(t);resolve();}else if(++n>200){clearInterval(t);reject(Error("fixture not loaded"));}},50);})');
    results[locale] = await window.webContents.executeJavaScript("window.networkReview.run()");
    const height = await window.webContents.executeJavaScript("document.documentElement.scrollHeight");
    window.setSize(1200, Math.min(3000, height + 40));
    await writeFile(path.join(output, `${locale}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await writeFile(path.join(output, "checks.json"), JSON.stringify({ testedAt: new Date().toISOString(), scope: "Chromium DOM with synthetic observations; no live network or human UI acceptance claim", results }, null, 2));
  console.log(JSON.stringify({ locales: Object.keys(results), checksPerLocale: Object.values(results).map(r => r.length), status: "passed" }));
  window.destroy(); await server.close(); clearTimeout(watchdog); app.exit(0);
} catch (error) { console.error(error); window?.destroy(); await server?.close(); clearTimeout(watchdog); app.exit(1); }
}
void main();

// Actual transparent Chromium surface; no VRChat process or live provider.
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { writeFile } from "node:fs/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let server, guide;
const watchdog = setTimeout(() => { console.error("Game-guide smoke timed out"); app.exit(1); }, 60_000);
async function main() {
  try {
    await app.whenReady();
    server = await createServer({ configFile: false, appType: "custom", root, plugins: [react()],
      cacheDir: path.join(os.tmpdir(), "vua-game-guide-vite"),
      define: { __VUA_BUILD_INFO__: JSON.stringify({ version: "synthetic-ui", commit: "synthetic", dirty: false }) },
      server: { host: "127.0.0.1", port: 0 }, optimizeDeps: { force: true, include: ["react", "react-dom/client", "@vua/contracts"] } });
    server.middlewares.use(async (req, res, next) => {
      if (req.url?.split("?")[0] !== "/__game-guide") return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><head><script>localStorage.clear();localStorage.setItem("vua-locale","zh-CN")</script></head><body><div id="root"></div><script type="module" src="/src/renderer/main.tsx"></script></body></html>'));
    });
    await server.listen();
    guide = new BrowserWindow({ show: false, frame: false, transparent: true, backgroundColor: "#00000000", width: 360, height: 560,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, partition: `vua-guide-smoke-${Date.now()}` } });
    const errors = [];
    guide.webContents.on("console-message", event => { if (event.level === "error" && !event.message.includes("404")) errors.push(event.message); });
    await guide.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__game-guide?surface=game-guide`);
    await guide.webContents.executeJavaScript('new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{if(document.querySelector(".vua-game-guide__panel")){clearInterval(t);resolve();}else if(++n>200){clearInterval(t);reject(Error("Guide surface missing"));}},25);})');
    const check = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
    const checks = [];
    const samples = [];
    for (const percent of [20, 80]) {
      const styles = await guide.webContents.executeJavaScript(`(async()=>{
        const input=document.querySelector('input[type=range]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${percent}');
        input.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const panel=document.querySelector('.vua-game-guide__panel');
        return {root:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,
          panelOpacity:getComputedStyle(panel).opacity,backdropOpacity:getComputedStyle(panel,'::before').opacity,
          background:getComputedStyle(panel,'::before').backgroundImage,saved:localStorage.getItem('vua-game-guide-opacity'),width:innerWidth,height:innerHeight};
      })()`);
      check(styles.root === "rgba(0, 0, 0, 0)" && styles.body === "rgba(0, 0, 0, 0)", `transparent outer canvas at ${percent}%`);
      check(Number(styles.backdropOpacity) === percent / 100 && styles.panelOpacity === "1", `slider changes background without fading text at ${percent}%`);
      check(styles.background.includes("repeating-linear-gradient"), `matrix stays within the adjustable background at ${percent}%`);
      // Wake the hidden compositor, then capture the newly committed frame.
      await guide.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await guide.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const capture = await guide.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      const size = capture.getSize(1); const bitmap = capture.toBitmap({ scaleFactor: 1 });
      const x = Math.round(16 * size.width / styles.width), y = Math.round((styles.height - 45) * size.height / styles.height);
      samples.push(bitmap[(y * size.width + x) * 4 + 3]);
      console.log(JSON.stringify({ percent, alpha: samples.at(-1), size, bitmapBytes: bitmap.length }));
      await writeFile(path.join(os.tmpdir(), `vua-guide-opacity-${percent}.png`), capture.toPNG());
    }
    check(samples[1] > samples[0] + 100, "captured background alpha follows the slider");
    check(errors.length === 0, "guide surface has no renderer errors");
    console.log(JSON.stringify({ scope: "Actual Chromium guide; no live game", checks, alphaSamples: samples, passed: checks.length }));
    guide.destroy(); await server.close(); clearTimeout(watchdog); app.exit(0);
  } catch (error) { console.error(error); guide?.destroy(); await server?.close(); clearTimeout(watchdog); app.exit(1); }
}
void main();

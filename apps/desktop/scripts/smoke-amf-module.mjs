// Real Main/preload/renderer and both native providers, isolated disposable data.
// No vendor launches, account actions, material imports or Unity operations.
import { app, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vua-amf-module-ui-"));
const profile = path.join(output, "profile");
const home = path.join(output, "home");
for (const directory of [home, profile, path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local")]) fs.mkdirSync(directory, { recursive: true });
app.setPath("home", home);
app.setPath("appData", path.join(home, "AppData", "Roaming"));
process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
process.env.VUA_DEV_USER_DATA = profile;
process.env.VUA_PROVIDER_EXECUTABLE = process.env.VUA_TEST_HOST_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-orchestrator-provider.exe");
process.env.VUA_AMF_EXECUTABLE = process.env.VUA_TEST_AMF_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-amf-provider.exe");
delete process.env.VUA_RENDERER_URL;
// Keep this controlled application hidden, including its normal ready-to-show path.
BrowserWindow.prototype.show = function () {};
let exitCode = 1;
let window;
const errors = [];
app.on("browser-window-created", (_event, created) => {
  created.webContents.setBackgroundThrottling(false);
  created.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
});
app.on("will-quit", () => { if (exitCode !== 0) app.exit(exitCode); });
const deadline = setTimeout(() => { console.error("AMF UI smoke timed out"); app.quit(); }, 45_000);

async function waitFor(check, label) {
  for (let i = 0; i < 150; i += 1) { if (await check()) return; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
async function run() {
  try {
    for (const binary of [process.env.VUA_PROVIDER_EXECUTABLE, process.env.VUA_AMF_EXECUTABLE]) if (!fs.existsSync(binary)) throw new Error("Build both native providers first");
    const require = createRequire(import.meta.url);
    require(path.join(desktop, "dist/packaged-electron/main.js"));
    await app.whenReady();
    await waitFor(() => {
      window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith("file:"));
      return Boolean(window && !window.webContents.isLoading());
    }, "production renderer");
    const js = source => window.webContents.executeJavaScript(source);
    await waitFor(() => js('!!document.querySelector(".vua-onboarding") && !document.querySelector(".vua-boot-splash")'), "fresh wizard");
    const checks = [];
    const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
    assert((await js("window.vua.amfModule.snapshot()")).state === "absent", "fresh host has no AMF");
    assert(!fs.existsSync(path.join(profile, "modules/amf/data")), "host does not create module data");
    await js('document.querySelector(".vua-journey-top button").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=home-modules]")'), "home module entry");
    assert(await js('!document.querySelector("[data-nav-id=nav-warehouse]") && !document.querySelector("[data-nav-id=home-warehouse]")'), "fresh home and sidebar omit editing");
    // Goal preference must not install a module or expose its deep link.
    await js('localStorage.setItem("vua-goals",JSON.stringify({version:1,onboarding:"completed",goals:["production"],environments:[]})); window.location.hash="/warehouse"');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=enable-amf]")'), "uninstalled deep link routes to modules");
    assert(await js('!document.querySelector("[data-nav-id=nav-warehouse]")'), "old creator goals do not enable AMF");
    await js('document.querySelector("[data-nav-id=enable-amf]").click()');
    await waitFor(() => js('window.vua.amfModule.snapshot().then(value=>value.state==="ready")'), "native AMF startup");
    await waitFor(() => js('!!document.querySelector("[data-nav-id=open-amf]")'), "module controls update");
    assert(fs.existsSync(path.join(profile, "modules/amf/data/bdl/bdl.db")), "AMF owns isolated BDL");
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await delay(400); // Let the existing page-entry transition reach its final frame.
    // Chromium may pause compositor animations in a hidden native window.
    // Preview their final frame; this smoke makes no motion-acceptance claim.
    await js('document.getAnimations().filter(animation=>animation.effect?.target?.classList?.contains("vua-page-enter")).forEach(animation=>animation.finish())');
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.promises.writeFile(path.join(output, "module-dark.png"), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
    await js('document.querySelector("[data-nav-id=open-amf]").click()');
    await waitFor(() => js('document.querySelector("[data-nav-id=nav-warehouse]")?.getAttribute("aria-current")==="page" && !!document.querySelector(".vua-warehouse")'), "AMF page and navigation");
    assert(await js('!document.querySelector(".vua-onboarding")'), "module opens the asset library");
    await js('document.querySelector("[data-nav-id=shell-settings]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-settings-modules]")'), "settings sidebar");
    await js('document.querySelector("[data-nav-id=nav-settings-modules]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=disable-amf]")'), "module disable control");
    await js('document.querySelector("[data-nav-id=disable-amf]").click()');
    await waitFor(() => js('window.vua.amfModule.snapshot().then(value=>value.state==="absent")'), "module stop");
    assert(fs.existsSync(path.join(profile, "modules/amf/data/bdl/bdl.db")), "disable keeps BDL");
    assert(JSON.parse(fs.readFileSync(path.join(profile, "modules/amf.json"), "utf8")).enabled === false, "disable selection is persisted");
    await js('document.querySelector("[data-nav-id=shell-back]").click()');
    await waitFor(() => js('!document.querySelector(".vua-shell__sidebar--settings")'), "return from settings");
    assert(await js('!document.querySelector("[data-nav-id=nav-warehouse]")'), "disable removes editing navigation");
    const core = await js('window.vua.gateway.invoke({schemaVersion:1,requestId:"module-ui-core",method:"app.snapshot",params:{}})');
    assert(core.ok && core.value.capabilities.operations.some(row => row.operationId === "environment.executeDeployment" && row.availability === "available"), "host preparation remains available");
    assert(errors.length === 0, `renderer errors: ${errors.join("; ")}`);
    fs.writeFileSync(path.join(output, "checks.json"), JSON.stringify({ scope: "Real application with isolated module data; no hardware/material/vendor acceptance", checks }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, evidence: output }));
    exitCode = 0;
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      console.error(JSON.stringify(await window.webContents.executeJavaScript('({hash:location.hash, headings:[...document.querySelectorAll("main h1")].map(e=>e.textContent),current:[...document.querySelectorAll("[aria-current=page]")].map(e=>e.getAttribute("data-nav-id")),buttons:[...document.querySelectorAll(".vua-shell__main button")].map(e=>({id:e.getAttribute("data-nav-id"),text:e.textContent})),chunks:performance.getEntriesByType("resource").map(e=>e.name.split("/").at(-1))})')));
      fs.writeFileSync(path.join(output, "failure.png"), (await window.webContents.capturePage()).toPNG());
      console.error(JSON.stringify({ evidence: output, rendererErrors: errors }));
    }
  }
  finally { clearTimeout(deadline); app.quit(); }
}
void run();

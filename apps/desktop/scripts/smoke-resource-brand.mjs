// Real Main/preload/renderer; read-only native sensors and labelled synthetic
// UI states. Disposable profile, no vendor, account, material or headset actions.
import { app, BrowserWindow, ipcMain } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vua-resource-brand-ui-"));
const home = path.join(output, "home");
for (const directory of [home, path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local")]) fs.mkdirSync(directory, { recursive: true });
app.setPath("home", home);
app.setPath("appData", path.join(home, "AppData", "Roaming"));
process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
process.env.VUA_DEV_USER_DATA = path.join(output, "profile");
process.env.VUA_PROVIDER_EXECUTABLE = process.env.VUA_TEST_HOST_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-orchestrator-provider.exe");
process.env.VUA_AMF_EXECUTABLE = process.env.VUA_TEST_AMF_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-amf-provider.exe");
delete process.env.VUA_RENDERER_URL;
app.getPreferredSystemLanguages = () => ["zh-CN"];
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
const errors = [];
let window;
let exitCode = 1;
app.on("browser-window-created", (_event, created) => {
  created.webContents.setBackgroundThrottling(false);
  created.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
});
app.on("will-quit", () => { if (exitCode) app.exit(exitCode); });
const deadline = setTimeout(() => { console.error("Resource/brand smoke timed out"); app.quit(); }, 75_000);
async function waitFor(check, label) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
async function run() {
  const checks = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  try {
    createRequire(import.meta.url)(path.join(desktop, "dist/packaged-electron/main.js"));
    await app.whenReady();
    await waitFor(() => {
      window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith("file:") && !candidate.webContents.getURL().includes("surface=splash"));
      return window && !window.webContents.isLoading();
    }, "production renderer");
    const js = source => window.webContents.executeJavaScript(source);
    const click = id => js(`document.querySelector('[data-nav-id="${id}"]').click()`);
    const capture = async filename => {
      await js('document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime) && !animation.effect?.target?.classList?.contains("vua-brand-switch__current--wiping")).forEach(animation=>animation.finish()); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      // Hidden Windows compositors can retain an older backing surface.
      // A one-DIP round trip requests a fresh paint without showing/focusing it.
      const bounds = window.getBounds();
      window.setSize(bounds.width + 1, bounds.height + 1);
      window.setSize(bounds.width, bounds.height);
      await delay(100);
      await fs.promises.writeFile(path.join(output, filename), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    };
    await waitFor(() => js('document.querySelector(".vua-tour")?.dataset.tourStep==="welcome"'), "welcome");
    await js('document.querySelector(".vua-tour__actions button").click()');
    await waitFor(() => js('!!document.querySelector(".vua-journey-top button")'), "wizard");
    await js('document.querySelector(".vua-journey-top button").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-warehouse]")'), "fresh AMF navigation");
    const actual = await js("window.vua.system.readResourceUsageV2()");
    const old = await js("window.vua.system.readResourceUsage()");
    assert(actual.schemaVersion === 2 && actual.ramTotalBytes > 0 && [actual.cpuUsagePercent, actual.gpuUsagePercent].every(value => value === null || Number.isFinite(value) && value >= 0 && value <= 100), "Real V2 IPC returns valid measured/nullable resources");
    assert(old.schemaVersion === 1 && Object.keys(old).length === 6, "Retained V1 port has its original shape");
    // Controlled UI examples are synthetic, independent of the native reading.
    const gib = 1024 ** 3;
    let synthetic = { schemaVersion: 2, cpuUsagePercent: 20, gpuUsagePercent: 40,
      ramUsedBytes: 6 * gib, ramTotalBytes: 10 * gib, vramUsedBytes: 8 * gib, vramTotalBytes: 10 * gib,
      gpuName: "Synthetic review GPU", gpuKind: "discrete", sampledAt: new Date().toISOString() };
    ipcMain.removeHandler("vua:system:resource-usage-v2");
    ipcMain.handle("vua:system:resource-usage-v2", () => synthetic);
    await waitFor(() => js('document.querySelector(".vua-shell__usage-value")?.textContent.includes("50%")'), "four-resource headroom");
    await click("system-resources");
    assert(await js('document.querySelectorAll(".vua-usage-panel [role=meter]").length===4'), "Details show four named resource meters");
    assert(await js('document.querySelector(".vua-usage-panel").textContent.includes("Synthetic review GPU") && document.querySelector(".vua-usage-panel").textContent.includes("4/4")'), "Details identify the selected card and measured count");
    assert(await js('!document.querySelector(".vua-usage-panel").textContent.includes("采样于")'), "Sampling-time display remains absent");
    await capture("resource-dark-synthetic.png");
    synthetic = { ...synthetic, gpuUsagePercent: 99 };
    await waitFor(() => js('document.querySelector(".vua-shell__usage-constrained")?.textContent.includes("GPU 99%")'), "saturation indicator");
    assert(await js('document.querySelector(".vua-shell__usage-value").textContent.includes("35%")'), "Healthy mean does not hide a saturated GPU");
    synthetic = { ...synthetic, cpuUsagePercent: null, gpuUsagePercent: null, vramUsedBytes: null, vramTotalBytes: null, gpuName: null, gpuKind: null };
    await waitFor(() => js('document.querySelector(".vua-usage-panel").textContent.includes("1/4")'), "unknown readings");
    assert(await js('document.querySelectorAll(".vua-usage-panel__unavailable").length===3 && document.querySelector(".vua-shell__usage-value").textContent.includes("40%")'), "Unknown dimensions are shown and excluded from the mean");
    synthetic = { ...synthetic, cpuUsagePercent: 20, gpuUsagePercent: 40, gpuName: "Synthetic integrated GPU", gpuKind: "integrated" };
    await waitFor(() => js('document.querySelector(".vua-usage-panel").textContent.includes("共享内存")'), "UMA explanation");
    assert(await js('document.querySelectorAll(".vua-usage-panel [role=meter]").length===3'), "Shared-memory graphics do not double-count RAM as VRAM");
    await click("system-resources");
    assert(await js('document.querySelector(".vua-brand-switch").getBoundingClientRect().width===30 && document.querySelector(".vua-brand-switch").getBoundingClientRect().height===30'), "Layered Home logo retains its dimensions");
    await click("nav-env-play");
    await waitFor(() => js('document.querySelector("[data-brand-domain]")?.dataset.brandDomain==="env"'), "purple jurisdiction");
    await delay(450);
    await click("nav-warehouse");
    const mid = await js(`(() => {
      const target=document.querySelector('.vua-brand-switch__current--wiping');
      const animation=document.getAnimations().find(item=>item.effect?.target===target);
      if (!animation) return null;
      animation.pause(); animation.currentTime=160;
      return {previous:!!document.querySelector('.vua-brand-switch__previous'),duration:animation.effect.getTiming().duration,domain:target.dataset.brandDomain};
    })()`);
    assert(mid?.previous && mid.duration === 380 && mid.domain === "production", "Logo replacement keeps both jurisdictions during its 120-degree wipe");
    await delay(500);
    assert(await js('!document.querySelector(".vua-brand-switch__previous") && document.querySelector("[data-brand-domain]").dataset.brandDomain==="production"'), "Old decorative layer is removed after the wipe");
    await click("nav-env-play");
    await click("nav-warehouse");
    await click("logo-home");
    await delay(500);
    assert(await js('document.querySelector("[data-brand-domain]").dataset.brandDomain==="global" && !document.querySelector(".vua-brand-switch__previous")'), "Rapid changes settle on Home's mixed mark");
    await js('document.documentElement.dataset.effects="off"');
    await click("nav-env-play");
    assert(await js('getComputedStyle(document.querySelector("[data-brand-domain]")).animationName==="none" && getComputedStyle(document.querySelector(".vua-brand-switch__previous")).display==="none"'), "Resource saving switches colours without decorative motion");
    await js('delete document.documentElement.dataset.effects');
    await window.webContents.debugger.attach("1.3");
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await click("nav-warehouse");
    assert(await js('getComputedStyle(document.querySelector("[data-brand-domain]")).animationName==="none"'), "Reduced motion flattens logo replacement");
    await delay(450);
    await js('document.documentElement.dataset.theme="light"');
    await click("system-resources");
    assert(await js('document.documentElement.dataset.theme==="light"'), "Light appearance applies to the resource panel");
    await capture("resource-light-synthetic.png");
    // Capture a held intermediate colour boundary after the normal timing and
    // flattened-motion checks. Virtual time affects this disposable renderer only.
    await click("system-resources");
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
    await click("nav-env-play");
    await delay(450);
    await click("nav-warehouse");
    await js('document.getAnimations().find(animation=>animation.effect?.target?.classList?.contains("vua-brand-switch__current--wiping"))?.pause(); document.getAnimations().filter(animation=>animation.effect?.target?.classList?.contains("vua-brand-switch__current--wiping")).forEach(animation=>animation.currentTime=65)');
    await window.webContents.debugger.sendCommand("Emulation.setVirtualTimePolicy", { policy: "pause" });
    const bounds = window.getBounds();
    window.setSize(bounds.width + 1, bounds.height + 1);
    window.setSize(bounds.width, bounds.height);
    await fs.promises.writeFile(path.join(output, "logo-wipe.png"), (await window.webContents.capturePage({ x: 0, y: 0, width: 110, height: 70 }, { stayHidden: true, stayAwake: true })).toPNG());
    assert(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
    fs.writeFileSync(path.join(output, "checks.json"), JSON.stringify({ scope: "Real IPC/renderer with labelled synthetic resource UI cases; not multiple-hardware or VRCFT acceptance", checks }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, evidence: output }));
    exitCode = 0;
  } catch (error) {
    console.error(error);
    console.error(JSON.stringify({ evidence: output, rendererErrors: errors }));
    if (window && !window.isDestroyed()) fs.writeFileSync(path.join(output, "failure.png"), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
  } finally { clearTimeout(deadline); app.quit(); }
}
void run();

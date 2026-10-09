// Real Main/preload/production renderer in a disposable profile. No vendor actions.
import { app, BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vua-help-ui-"));
const home = path.join(output, "home");
const profile = path.join(output, "profile");
for (const directory of [home, profile, path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local")]) fs.mkdirSync(directory, { recursive: true });
app.setPath("home", home);
app.setPath("appData", path.join(home, "AppData", "Roaming"));
process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
process.env.VUA_DEV_USER_DATA = profile;
process.env.VUA_PROVIDER_EXECUTABLE = process.env.VUA_TEST_HOST_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-orchestrator-provider.exe");
process.env.VUA_AMF_EXECUTABLE = process.env.VUA_TEST_AMF_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-amf-provider.exe");
delete process.env.VUA_RENDERER_URL;
// Prevent this controlled instance from appearing or moving the user's focus.
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
const deadline = setTimeout(() => { console.error("Help UI smoke timed out"); app.quit(); }, 60_000);
async function waitFor(check, label) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(100); }
  throw new Error(`Timeout: ${label}`);
}
async function run() {
  const checks = [];
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  try {
    if (!fs.existsSync(process.env.VUA_PROVIDER_EXECUTABLE)) throw new Error("Build the host provider first");
    createRequire(import.meta.url)(path.join(desktop, "dist/packaged-electron/main.js"));
    await app.whenReady();
    await waitFor(() => {
      window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith("file:"));
      return window && !window.webContents.isLoading();
    }, "production renderer");
    const js = source => window.webContents.executeJavaScript(source);
    const chapterContrast = () => js(`(()=>{
      const style=getComputedStyle(document.querySelector('.vua-overlay-guide__topic[data-active]'));
      const luminance=color=>color.match(/[\\d.]+/g).slice(0,3).map(Number).map(value=>{const v=value/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      const foreground=luminance(style.color), background=luminance(style.backgroundColor);
      return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
    })()`);
    const capture = async name => {
      await js('document.fonts.ready.then(()=>true)');
      // A hidden Windows compositor can keep the previous route's frame; resizing invalidates it.
      const [width, height] = window.getSize();
      window.setSize(width + 1, height);
      await delay(50);
      window.setSize(width, height);
      // Wake page painting without showing the native window, then capture its settled frame.
      await window.webContents.capturePage();
      await delay(500);
      await js('document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish())');
      await delay(100);
      fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    };
    await waitFor(() => js('!!document.querySelector(".vua-onboarding") && !document.querySelector(".vua-boot-splash")'), "fresh entry");
    // Use an explicit UI preference instead of depending on the test machine's locale.
    await js('localStorage.setItem("vua-locale","zh-CN"); location.reload()');
    await waitFor(() => js('!!document.querySelector(".vua-onboarding") && !document.querySelector(".vua-boot-splash") && document.documentElement.lang==="zh-CN"'), "localized fresh entry");
    await js('document.querySelector(".vua-journey-top button").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-help]")'), "environment directory");
    assert(await js('!!document.querySelector("[data-nav-id=nav-tools-discover]") && ![...document.querySelectorAll(".vua-shell__topbar button")].some(b=>b.textContent==="帮助")'), "Tools and Help belong in the environment directory, not the topbar");
    await js('document.querySelector("[data-nav-id=nav-tools-discover]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-tools-hub")'), "tool directory");
    assert(await js('document.querySelector(".vua-tools-hub").textContent.includes("VRCFaceTracking") && document.querySelector(".vua-tools-hub").textContent.includes("VRCS") && document.querySelector(".vua-tools-hub").textContent.includes("OVR Overlay Translator") && [...document.querySelectorAll(".vua-tools-hub .vua-route-tile")].every(b=>b.disabled)'), "Tracking and translation entries are honest development placeholders");
    await js('document.querySelector("[data-nav-id=nav-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-hardware-help]")'), "Play cards");
    window.setSize(1180, 820);
    await delay(100);
    assert(await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-88)<1)'), "All Play cards, including network, are half-height");
    const cardLayout = await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card button")].map(b=>({label:b.getAttribute("data-nav-id"),overflow:b.scrollHeight-b.clientHeight}))');
    assert(cardLayout.every(row => row.overflow < 3), "Compact card content fits without vertical clipping");
    await capture("play-dark");
    await js('document.querySelector("[data-nav-id=play-hardware-help]").click()');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.textContent==="硬件介绍"'), "Hardware introduction in Help");
    assert(BrowserWindow.getAllWindows().length === 1, "Hardware help opens inside the main window");
    assert(await js('document.querySelector("[data-nav-id=nav-help]").getAttribute("aria-current")==="page" && !!document.querySelector("[data-guide-section=identify-device]")'), "Encyclopedia keeps Help selected and targets hardware");
    await capture("hardware-dark");
    assert(await chapterContrast() >= 4.5, "Selected chapter text is legible in dark appearance");
    await js('const unsubscribe = window.vua.window.encyclopediaTargetEvents.subscribe(()=>{}); unsubscribe(); unsubscribe()');
    await js('window.vua.window.showEncyclopedia({topic:"guide-devices",section:"pico-wifi"})');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.getAttribute("id").includes("guide-devices")'), "Contextual chapter navigation");
    await waitFor(() => js('localStorage.getItem("vua-guide-reading")?.includes("pico-wifi")'), "Targeted section saved");
    await waitFor(() => js('document.querySelector("[data-guide-section=pico-wifi]").getBoundingClientRect().top >= document.querySelector(".vua-overlay-guide__topics").getBoundingClientRect().bottom-2'), "Target heading remains below the sticky chapter selector");
    assert(true, "Targeted chapter headings are readable below the sticky navigation");
    assert(BrowserWindow.getAllWindows().length === 1, "Repeated contextual requests never create a reader window");
    await js('document.querySelector("[data-nav-id=knowledge-back]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "Help landing");
    assert(await js('document.querySelector("[data-nav-id=help-wizard]").textContent.includes("入门引导") && document.querySelector("[data-nav-id=help-encyclopedia]").textContent.includes("知识百科") && document.querySelector("[data-nav-id=help-game-assistant]").textContent.includes("游戏内助手")'), "Help names match the current ruling");
    await js('document.querySelector("[data-nav-id=help-encyclopedia]").click()');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.getAttribute("id").includes("guide-devices")'), "Reading position survives page return");
    await js('document.querySelector("[data-nav-id=shell-settings]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-settings-theme]")'), "Settings navigation");
    await js('document.querySelector(".vua-theme-choice button:nth-of-type(2)").click()');
    await js('document.querySelector("[data-nav-id=shell-back]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-knowledge") && document.documentElement.dataset.theme==="light"'), "Knowledge follows light appearance and Settings return");
    await capture("knowledge-light");
    assert(await chapterContrast() >= 4.5, "Selected chapter text is legible in light appearance");
    await waitFor(() => js('!!document.querySelector(".vua-shell__usage")'), "Resource panel");
    await js('document.querySelector(".vua-shell__usage").click()');
    assert(await js('!!document.querySelector(".vua-usage-panel") && !document.querySelector(".vua-usage-panel__footer")'), "Resource panel has no sampled-time display");
    await js('document.querySelector(".vua-usage-panel__close").click(); localStorage.setItem("vua-display-mode","bigscreen")');
    await js('location.reload()');
    await waitFor(() => js('document.querySelector(".vua-shell")?.dataset.displayMode==="bigscreen" && !document.querySelector(".vua-boot-splash")'), "Big screen restart");
    await js('location.hash="/environment-hub"');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=home-help]")'), "Big screen environment menu");
    await js('document.querySelector("[data-nav-id=home-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-hardware-help]")'), "Big screen Play");
    assert(await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-108)<1)'), "Big screen cards retain the halved height and larger controls");
    await capture("play-bigscreen");
    assert(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
    fs.writeFileSync(path.join(output, "checks.json"), JSON.stringify({ checks, scope: "Controlled application navigation/layout only; no hardware, vendor or human-language acceptance" }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, evidence: output }));
    exitCode = 0;
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      fs.writeFileSync(path.join(output, "failure.png"), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
      console.error(JSON.stringify({ evidence: output, rendererErrors: errors }));
    }
  } finally { clearTimeout(deadline); app.quit(); }
}
void run();

// Production Main/preload/renderer, disposable profile, labelled synthetic tool actions.
// One native read-only discovery runs through the real provider; no vendor launches/modules.
import { app, BrowserWindow, ipcMain } from "electron";
import { enterHomeFromFirstUse } from "./smoke-first-use.mjs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
app.getPreferredSystemLanguages = () => ["zh-CN"];
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vua-vrcft-ui-")), home = path.join(output, "home"), profile = path.join(output, "profile");
for (const dir of [home, profile, path.join(home, "AppData/Roaming"), path.join(home, "AppData/Local"), path.join(profile, "modules")]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(profile, "modules/amf.json"), JSON.stringify({ schemaVersion: "0.1", enabled: false, dataLayout: "isolated" }));
app.setPath("home", home); app.setPath("appData", path.join(home, "AppData/Roaming"));
process.env.LOCALAPPDATA = path.join(home, "AppData/Local"); process.env.VUA_DEV_USER_DATA = profile;
process.env.VUA_PROVIDER_EXECUTABLE = process.env.VUA_TEST_HOST_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-orchestrator-provider.exe");
process.env.VUA_AMF_EXECUTABLE = process.env.VUA_TEST_AMF_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-amf-provider.exe");
delete process.env.VUA_RENDERER_URL;
BrowserWindow.prototype.show = function () {}; BrowserWindow.prototype.focus = function () {};
let window, exitCode = 1, nativeRead = false, unavailable = false;
let synthetic = { schemaVersion: "vua.external-tool/v0.4", toolId: "vrcft", capturedAt: "synthetic", presence: "missing", steamReady: true, buildId: null, running: false, canStop: false, activity: "idle", issue: null };
const syntheticInstaller = { schemaVersion: "vua.installer-tool/v0.1", toolId: "slimevr", capturedAt: "synthetic", presence: "missing", location: null, version: null, running: false, canStop: false, activity: "idle", issue: null };
const actions = [], errors = [], checks = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, request, ...rest) => {
  if (channel !== "vua:gateway:invoke" || !request?.method?.startsWith("tools.")) return listener(event, request, ...rest);
  if (request.method === "tools.observeInstaller" || request.method === "tools.actInstaller") {
    if (unavailable) return { schemaVersion: 1, requestId: request.requestId, ok: false, error: { code: "internal", messageKey: "errors.installerTool.unavailable" } };
    return { schemaVersion: 1, requestId: request.requestId, ok: true, value: { installerTool: { ...syntheticInstaller, toolId: request.params.toolId } } };
  }
  if (nativeRead && request.method === "tools.observeConnection") return listener(event, request);
  if (unavailable) return { schemaVersion: 1, requestId: request.requestId, ok: false, error: { code: "internal", messageKey: "errors.externalTool.unavailable" } };
  if (request.method === "tools.actConnection") {
    actions.push(request.params);
    const action = request.params.action;
    synthetic = { ...synthetic, activity: action === "install" ? "install_requested" : action === "start" ? "starting" : action === "stop" ? "stopping" : "idle" };
  }
  return { schemaVersion: 1, requestId: request.requestId, ok: true, value: { toolConnection: { ...synthetic, toolId: request.params.toolId } } };
});
app.on("browser-window-created", (_event, created) => {
  created.webContents.setBackgroundThrottling(false);
  created.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
});
app.on("will-quit", () => { if (exitCode) app.exit(exitCode); });
const deadline = setTimeout(() => { console.error("VRCFT UI smoke timed out"); app.quit(); }, 90_000);
const assert = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
async function waitFor(check, label) { for (let i = 0; i < 150; i++) { if (await check()) return; await delay(100); } throw new Error(`Timeout: ${label}`); }
async function run() {
  try {
    createRequire(import.meta.url)(path.join(desktop, "dist/packaged-electron/main.js")); await app.whenReady();
    await waitFor(() => { window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith("file:") && !w.webContents.getURL().includes("surface=splash")); return window && !window.webContents.isLoading(); }, "renderer");
    const js = source => window.webContents.executeJavaScript(source, true);
    const click = selector => js(`document.querySelector('${selector}').click()`);
    const refresh = async () => { await js('window.dispatchEvent(new Event("focus"))'); await delay(150); };
    const capture = async name => {
      await js('document.fonts.ready.then(()=>true); document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish())');
      const [w, h] = window.getSize(); window.setSize(w + 1, h); await delay(50); window.setSize(w, h); await delay(200);
      fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    };
    await enterHomeFromFirstUse(js, waitFor);
    await waitFor(() => js('document.documentElement.lang==="zh-CN" && !!document.querySelector("[data-nav-id=nav-tools-discover]") && !document.querySelector(".vua-onboarding") && !document.querySelector(".vua-tour")'), "directory");
    nativeRead = true;
    const observed = await js('window.vua.gateway.invoke({schemaVersion:1,requestId:"native-tool-read",method:"tools.observeConnection",params:{toolId:"vrcft"}})');
    // CI may have no vendor apps. Schema validation and the actual native gate must still work.
    const nativeSchema = observed.value?.toolConnection?.schemaVersion;
    assert(observed.ok && observed.value.toolConnection.toolId === "vrcft" && nativeSchema === "vua.external-tool/v0.4", "Native host returns VRCFT v0.4 facts while AMF is disabled");
    const nativePresence = observed.value.toolConnection.presence; nativeRead = false;
    await click('[data-nav-id=nav-tools-discover]'); await waitFor(() => js('!!document.querySelector("[data-nav-id=tool-vrcft-action]")'), "tool card"); await refresh();
    assert(await js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card__action")].length===14 && [...document.querySelectorAll(".vua-tools-hub .vua-environment-card__action")].every(button=>!!button.textContent.trim() && !!button.getAttribute("aria-label"))'), "All fourteen tool actions name their next step in a word and keep an accessible operation name");
    await waitFor(() => js('!!document.querySelector("[data-testid=tools-filter-bar]") && !!document.querySelector("[data-pose-graph] .vua-pose-graph__body")'), "tools filter bar and native pose graph");
    assert(await js('document.querySelectorAll("[data-pose-graph] .vua-pose-graph__sources > li").length === 9'), "Native pose graph renders all nine canonical pose sources");
    await click('[data-testid=tools-filter-free-only]');
    await waitFor(() => js('document.querySelectorAll(".vua-tools-hub .vua-environment-card__action").length === 9'), "free-only filter");
    assert(await js('document.querySelector("[data-testid=tools-filter-free-only]").getAttribute("aria-pressed") === "true"'), "Free-only filter exposes pressed state and narrows catalog to nine free tools");
    await click('[data-testid=tools-goal-tracking]');
    await waitFor(() => js('document.querySelectorAll(".vua-tools-hub .vua-environment-card__action").length === 3'), "tracking goal filter");
    assert(await js('document.querySelector("[data-testid=tools-goal-tracking]").getAttribute("aria-pressed") === "true"'), "Goal filter narrows catalog to three tracking tools");
    await click('[data-testid=tools-goal-all]');
    await click('[data-testid=tools-filter-free-only]');
    await waitFor(() => js('document.querySelectorAll(".vua-tools-hub .vua-environment-card__action").length === 14'), "reset tool filters");
    for (const scale of [1, 1.5]) {
      window.setSize(960, 800); window.webContents.setZoomFactor(scale);
      for (const toolId of ['vrcft','space','slimevr','vrcs','translator','vrct','advanced','toolkit','oyasumi','xsoverlay','desktopplus','fpsvr','vrcx','liv']) {
        await click(`[data-nav-id=tool-${toolId}]`);
        await waitFor(() => js(`(()=>{
          const trigger=document.querySelector('[data-nav-id=tool-${toolId}]'), entry=trigger.closest('[data-card-entry]');
          const detail=document.getElementById(trigger.getAttribute('aria-controls')), drawer=detail.closest('.vua-tools-drawer');
          const card=entry.getBoundingClientRect(), panel=drawer.getBoundingClientRect(), grid=entry.parentElement.getBoundingClientRect();
          return trigger.getAttribute('aria-expanded')==='true' && drawer.dataset.open==='true' && !detail.hidden
            && panel.top>=card.bottom && Math.abs(panel.left-grid.left)<1 && Math.abs(panel.width-grid.width)<1
            && panel.height>40 && detail.scrollWidth<=detail.clientWidth+2;
        })()`), `${toolId} full-row drawer at ${scale} scale`);
        assert(true, `${toolId}: full-row sliding details fit at ${scale} page scale`);
        await click(`[data-nav-id=tool-${toolId}]`);
        assert(await js(`document.getElementById('tool-${toolId}-details').closest('.vua-tools-drawer').inert`), `${toolId}: closed details stay mounted and inert`);
      }
    }
    window.webContents.setZoomFactor(1); window.setSize(1440,960);
    await click('[data-nav-id=tool-vrcft-action]'); await waitFor(() => js('!!document.querySelector("[role=dialog]")'), "picker");
    assert(await js('document.querySelector("[role=dialog]").textContent.includes("可用的设备") && !!document.querySelector("[data-tracking-device-choice=quest-pro]") && !!document.querySelector("[data-tracking-device-choice=iphone]") && !!document.querySelector("[data-tracking-device-choice=eyetrackvr]")'), "Picker includes headsets, phone and add-on trackers beyond PICO");
    await capture('devices-dark'); await click('[data-tracking-device-choice=pico4-pro]');
    await waitFor(() => js('!!document.querySelector("[data-tracking-device=pico4-pro]") && !document.querySelector("[role=dialog]")'), "PICO SOP");
    assert(await js('document.querySelector(".vua-vrcft-module").textContent==="Pico4SAFTExtTrackingModule" && document.querySelector("[data-tracking-step=module] input").disabled'), "Missing VRCFT cannot be marked as an installed module");
    await click('[data-nav-id=tool-vrcft-action]'); await refresh();
    assert(actions.length === 1 && actions[0].action === 'install' && await js('document.querySelector("[data-nav-id=tool-vrcft-action]").disabled'), "Install is a pending Steam handoff with duplicate clicks disabled");
    await js('[...document.querySelectorAll("#tool-vrcft-details button")].find(b=>b.textContent==="停止等待").click()'); await refresh();
    assert(actions.at(-1).action === 'cancel' && synthetic.presence === 'missing', "Stopping wait does not fake or cancel upstream installation");
    synthetic = { ...synthetic, presence: 'installed', buildId: '123', activity: 'idle' }; await refresh();
    await click('[data-nav-id=tool-vrcft-action]'); await refresh(); assert(actions.at(-1).action === 'start', "Installed VRCFT opens through the typed tool action");
    synthetic = { ...synthetic, running: true, canStop: true, activity: 'idle' }; await refresh();
    assert(await js('document.querySelector("[data-card=tool-vrcft]").dataset.action==="stop"'), "Only this run's owned instance offers Close");
    for (const step of ['hardware', 'module', 'osc', 'test']) await click(`[data-tracking-step=${step}] input`);
    assert(await js('JSON.parse(localStorage.getItem("vua-vrcft-setup")).completed.length===4 && document.querySelector("#tool-vrcft-details").textContent.includes("全部步骤已确认")'), "SOP completion records user confirmation rather than measured tracking");
    await capture('pico-sop-dark');
    await click('[data-nav-id=tool-vrcft-action]'); await refresh();
    assert(actions.at(-1).action === 'stop' && await js('document.querySelector("[data-nav-id=tool-vrcft-action]").disabled'), "Close requests only VRCFT and waits for actual exit");
    synthetic = { ...synthetic, running: false, canStop: false, activity: 'idle' }; await refresh();
    assert(await js('document.querySelector("[data-card=tool-vrcft]").dataset.action==="start" && !document.querySelector(".vua-environment-card__warning")'), "Manual normal exit restores Open without a warning");
    await click('[data-nav-id=tool-vrcft-action]'); await refresh(); synthetic = { ...synthetic, running: true, canStop: false, activity: 'idle' }; await refresh();
    assert(await js('document.querySelector("[data-card=tool-vrcft]").dataset.action==="start" && document.querySelector("#tool-vrcft-details").textContent.includes("已在 VUA 外运行")'), "An existing instance stays outside VUA's close authority");
    await js('[...document.querySelectorAll("#tool-vrcft-details button")].find(b=>b.textContent==="更换设备").click()');
    await click('[data-tracking-device-choice=quest-pro]');
    assert(await js('!!document.querySelector("[role=dialog]") && !!document.querySelector("[data-tracking-choice=steamlink]") && !!document.querySelector("[data-tracking-choice=vd]")'), "Quest Pro asks for its actual connection before choosing a module");
    await click('[data-tracking-choice=vd]');
    assert(await js('document.querySelector(".vua-vrcft-module").textContent==="Virtual Desktop" && JSON.parse(localStorage.getItem("vua-vrcft-setup")).completed.length===0'), "Changing hardware/connection resets obsolete confirmation");
    const guideUrls = []; window.webContents.setWindowOpenHandler(({ url }) => { guideUrls.push(url); return { action: 'deny' }; });
    await click('[data-tracking-step=module] a'); await delay(100);
    assert(guideUrls.at(-1) === "https://docs.vrcft.io/docs/hardware/vr/meta/quest-pro/virtual-desktop", "Module help opens the matching upstream guide through native popup routing");
    synthetic = { ...synthetic, steamReady: false, presence: 'missing', buildId: null, running: false }; await refresh();
    assert(await js('document.querySelector("[data-nav-id=tool-vrcft-action]").getAttribute("aria-label").includes("准备 Steam")'), "Missing Steam offers prerequisite preparation instead of a dead install action");
    await click('[data-nav-id=tool-vrcft-action]'); await waitFor(() => js('!!document.querySelector(".vua-play-page")'), "Steam preparation");
    await click('[data-nav-id=nav-tools-discover]'); await click('[data-nav-id=tool-vrcft]');
    assert(await js('document.querySelector("[data-tracking-device=quest-pro]")?.dataset.trackingMethod==="vd"'), "Returning from prerequisites retains device and connection");
    synthetic = { ...synthetic, steamReady: true, presence: 'unknown' }; await refresh();
    assert(await js('document.querySelector("[data-card=tool-vrcft]").dataset.action==="unknown" && ![...document.querySelectorAll("#tool-vrcft-details button")].some(b=>b.textContent==="在 Steam 安装")'), "Unreadable installation offers reinspection rather than assumed absence");
    synthetic = { ...synthetic, presence: 'installed', buildId: '123' };
    unavailable = true; await refresh();
    assert(await js('document.querySelector("[data-card=tool-vrcft]").dataset.action==="unknown" && document.querySelector("#tool-vrcft-details").textContent.includes("无法检查")'), "Provider failure remains Unknown instead of installed/absent");
    unavailable = false; await refresh(); await js('document.documentElement.dataset.theme="light"');
    await js('[...document.querySelectorAll("#tool-vrcft-details button")].find(b=>b.textContent==="更换设备").click()');
    // The app's minimum window is 960x600. A smaller requested native size can
    // be clamped differently by Windows/DPI; short fonts can also fit without
    // overflow. Use a real 150% page scale to require scrolling deterministically.
    window.setSize(960, 600); window.webContents.setZoomFactor(1.5);
    await js('document.fonts.ready.then(()=>{document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish()); return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})');
    let picker;
    await waitFor(async () => {
      picker = await js('(()=>{const d=document.querySelector("[role=dialog]"),b=d.getBoundingClientRect(),body=d.querySelector(".vua-content-dialog__body");return {top:b.top,bottom:b.bottom,height:innerHeight,scroll:body.scrollHeight,client:body.clientHeight,width:d.scrollWidth,available:d.clientWidth}})()');
      return picker.top >= 0 && picker.bottom <= picker.height && picker.scroll > picker.client && picker.width <= picker.available + 2;
    }, "light picker at minimum window and 150% page scale").catch(error => { throw new Error(`${error.message}: ${JSON.stringify(picker)}`, { cause: error }); });
    assert(picker.client > 0, "Light picker fits minimum window at 150% scale and scrolls inside the dialog");
    await capture('devices-light-small'); await click('.vua-content-dialog__close'); await js('location.reload()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-tools-discover]")'), "restart"); await click('[data-nav-id=nav-tools-discover]'); await click('[data-nav-id=tool-vrcft]');
    assert(await js('document.querySelector("[data-tracking-device=quest-pro]")?.dataset.trackingMethod==="vd"'), "Device and connection resume after reload");
    assert(errors.length === 0, `Renderer errors: ${errors.join('; ')}`);
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ scope: 'Native read-only discovery + synthetic tool UI, not physical tracking or vendor install/launch acceptance', nativeSchema, nativePresence, checks }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, nativeSchema, nativePresence, evidence: output })); exitCode = 0;
  } catch (error) { console.error(error); console.error(JSON.stringify({ evidence: output, passed: checks.length, rendererErrors: errors })); if (window && !window.isDestroyed()) fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG()); }
  finally { clearTimeout(deadline); app.quit(); }
}
void run();

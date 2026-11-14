// Real Main/preload/production renderer in a disposable profile. No vendor actions.
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
const guideMediaOutput = process.env.VUA_GUIDE_MEDIA_OUTPUT ? path.resolve(process.env.VUA_GUIDE_MEDIA_OUTPUT) : null;
const publishableCaptures = new Set(["first-run", "help-faq", "avatar-preparation", "theme-presets"]);
const captureMetadata = {};
if (guideMediaOutput) {
  fs.mkdirSync(guideMediaOutput, { recursive: true });
  fs.writeFileSync(path.join(guideMediaOutput, "source-build.json"), JSON.stringify({
    ...JSON.parse(fs.readFileSync(path.join(desktop, "dist/renderer/build-info.json"), "utf8")),
    captureMode: "controlled-production",
    scope: "Actual Main/preload/production renderer and local providers in a disposable profile; not a packaged installer or vendor execution",
    privacy: "No accounts, credentials or private materials; eligibility capture is cropped to its note",
  }, null, 2));
}
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vua-help-ui-"));
const home = path.join(output, "home");
const profile = path.join(output, "profile");
for (const directory of [home, profile, path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local")]) fs.mkdirSync(directory, { recursive: true });
app.setPath("home", home);
app.setPath("appData", path.join(home, "AppData", "Roaming"));
process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
process.env.VUA_DEV_USER_DATA = profile;
// Deliberately retain an existing user's opt-out while testing reactivation.
fs.mkdirSync(path.join(profile, "modules"));
fs.writeFileSync(path.join(profile, "modules", "amf.json"), JSON.stringify({ schemaVersion: "0.1", enabled: false, dataLayout: "isolated" }));
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
const deadline = setTimeout(() => { console.error("Help UI smoke timed out"); app.quit(); }, 90_000);
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
      window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith("file:") && !candidate.webContents.getURL().includes("surface=splash"));
      return window && !window.webContents.isLoading();
    }, "production renderer");
    // Chromium's Back intervention skips script-created entries without user activation.
    const js = source => window.webContents.executeJavaScript(source, true).catch(error => {
      console.error("Renderer evaluation failed:", source);
      throw error;
    });
    // The Play drawer opens below the row of its card and takes the grid's full width.
    const playDrawerBelow = button => js(`(()=>{
      const entry=document.querySelector('[data-nav-id="${button}"]').closest('[data-card-entry]');
      const drawer=document.querySelector('.vua-play-drawer');
      const card=entry.getBoundingClientRect(), panel=drawer.getBoundingClientRect();
      return drawer.dataset.open==='true' && !document.getElementById('${button}-details').hidden
        && panel.top>=card.bottom && Math.abs(panel.width-card.width)<1 && panel.height>40;
    })()`);
    const inlineDetailFits = button => js(`(()=>{
      const control=document.querySelector('[data-nav-id="${button}"]');
      const entry=control.closest('[data-card-entry]'), detail=document.getElementById(control.getAttribute('aria-controls'));
      const card=entry.firstElementChild, cardRect=card.getBoundingClientRect(), detailRect=detail.getBoundingClientRect();
      return detail.parentElement===entry && card.nextElementSibling===detail && !detail.hidden
        && Math.abs(detailRect.left-cardRect.left)<1 && Math.abs(detailRect.width-cardRect.width)<1
        && detailRect.top>=cardRect.bottom && detailRect.top-cardRect.bottom<=14
        && detail.scrollWidth<=detail.clientWidth+2;
    })()`);
    const toolDrawerFits = button => js(`(()=>{
      const control=document.querySelector('[data-nav-id="${button}"]'), entry=control.closest('[data-card-entry]');
      const detail=document.getElementById(control.getAttribute('aria-controls')), drawer=detail.closest('.vua-tools-drawer');
      const card=entry.getBoundingClientRect(), panel=drawer.getBoundingClientRect(), grid=entry.parentElement.getBoundingClientRect();
      return drawer.dataset.open==='true' && !detail.hidden && panel.top>=card.bottom
        && Math.abs(panel.left-grid.left)<1 && Math.abs(panel.width-grid.width)<1 && panel.height>40
        && detail.scrollWidth<=detail.clientWidth+2;
    })()`);
    const languageFooterFits = () => js(`(()=>{
      const select=document.querySelector('[data-nav-id=settings-language-select]'), language=select.parentElement;
      const search=document.querySelector('[data-nav-id=settings-search]');
      const languageRect=language.getBoundingClientRect(), selectRect=select.getBoundingClientRect(), searchRect=search.getBoundingClientRect();
      return language.querySelector('svg')===select.previousElementSibling && language.nextElementSibling===search
        && languageRect.bottom+12<=searchRect.top && selectRect.width<searchRect.width
        && selectRect.height===36 && languageRect.top>=0 && searchRect.bottom<=innerHeight;
    })()`);
    const toolLabelsFit = () => js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card strong")].every(label=>{const r=label.getBoundingClientRect(),b=label.parentElement.getBoundingClientRect();return r.left>=b.left && r.right<=b.right+1 && r.top>=b.top && r.bottom<=b.bottom})');
    const chapterContrast = () => js(`(()=>{
      const chapter=document.querySelector('.vua-overlay-guide__topic[data-active]');
      if(!chapter) throw new Error('Missing selected guide chapter at '+location.hash+'; knowledge='+!!document.querySelector('.vua-knowledge')+'; selectedTab='+document.querySelector('[role=tab][aria-selected=true]')?.id);
      const style=getComputedStyle(chapter);
      const luminance=color=>color.match(/[\\d.]+/g).slice(0,3).map(Number).map(value=>{const v=value/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
      const foreground=luminance(style.color), background=luminance(style.backgroundColor);
      return (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05);
    })()`);
    const setSearch = value => js(`(()=>{
      const input=document.querySelector('.vua-encyclopedia-search input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    const setFilter = (index, value) => js(`(()=>{
      const select=document.querySelectorAll('.vua-encyclopedia-search select')[${index}];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(value)});
      select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    const capture = async (name, selector) => {
      await js('document.fonts.ready.then(()=>true)');
      // A hidden Windows compositor can keep the previous route's frame; resizing invalidates it.
      const [width, height] = window.getSize();
      window.setSize(width + 1, height);
      await delay(50);
      window.setSize(width, height);
      await delay(200);
      // Wake page painting without showing the native window, then capture its settled frame.
      await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await delay(500);
      await js('document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish())');
      await delay(100);
      let region = selector ? await js(`(()=>{
        const element=document.querySelector(${JSON.stringify(selector)});
        if(!element) return null;
        element.scrollIntoView({block:'center'});
        const rect=element.getBoundingClientRect();
        return {x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.ceil(rect.width),height:Math.ceil(rect.height)};
      })()`) : undefined;
      if (selector && !region) throw new Error(`Missing capture region: ${selector}`);
      if (selector) {
        // Scrolling after the first paint leaves a stale hidden-window frame on Windows.
        // Repaint the scrolled viewport, then measure again before cropping the requested element.
        await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        await delay(150);
        region = await js(`(()=>{
          const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
          return {x:Math.floor(rect.x),y:Math.floor(rect.y),width:Math.ceil(rect.width),height:Math.ceil(rect.height)};
        })()`);
      }
      const image = await window.webContents.capturePage(region, { stayHidden: true, stayAwake: true });
      fs.writeFileSync(path.join(output, `${name}.png`), image.toPNG());
      if (guideMediaOutput && publishableCaptures.has(name)) {
        const png = image.toPNG();
        fs.writeFileSync(path.join(guideMediaOutput, `${name}.png`), png);
        captureMetadata[name] = { width: png.readUInt32BE(16), height: png.readUInt32BE(20), capturedAt: new Date().toISOString() };
        fs.writeFileSync(path.join(guideMediaOutput, "captures.json"), JSON.stringify(captureMetadata, null, 2));
      }
    };
    await waitFor(() => js('!!document.querySelector("[data-first-use-notice]")'), "first-use notice");
    await capture("first-run");
    assert(await js('document.documentElement.lang==="zh-CN" && localStorage.getItem("vua-locale")===null && !document.querySelector(".vua-onboarding select")'), "The first-use notice adopts Chinese system language");
    await enterHomeFromFirstUse(js, waitFor);
    assert(await js('(()=>{const h=document.querySelector("[data-nav-id=shell-help]"),s=document.querySelector("[data-nav-id=shell-settings]");return h.closest("header")&&h.nextElementSibling===s&&!document.querySelector(".vua-shell__sidebar [data-nav-id=nav-help]")&&getComputedStyle(h).transform===getComputedStyle(s).transform})()'), "Help shares Settings parallelogram styling in the topbar with no sidebar duplicate");
    await js('document.querySelector("[data-nav-id=shell-help]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "Help for the first encyclopedia catalog");
    await js('document.querySelector("[data-nav-id=help-encyclopedia]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), "First encyclopedia catalog");
    assert(await js('document.querySelectorAll("[data-guide-task]").length===6 && document.querySelectorAll(".vua-encyclopedia-tree > li > details").length===9 && !document.querySelector("[data-guide-continue]")'), "Encyclopedia starts with six questions and nine topics");
    assert(await js('localStorage.getItem("vua-guide-reading")===null'), "Browsing the catalog alone writes no reading bookmark");
    await capture("encyclopedia-catalog");
    await js('document.querySelector("[data-nav-id=help-child-back]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "Help after the first catalog");
    assert(await js('!!document.querySelector(".vua-shell__sidebar [data-nav-id=nav-tools-discover]")'), "Tools remains in the Environment sidebar");
    await js('document.querySelector("[data-nav-id=nav-tools-discover]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-tools-hub")'), "tool directory");
    assert(await js('document.querySelector(".vua-tools-hub").textContent.includes("VRCFaceTracking") && document.querySelector(".vua-tools-hub").textContent.includes("VRCS") && document.querySelector(".vua-tools-hub").textContent.includes("OVR Overlay Translator") && !document.querySelector("[data-nav-id=tool-vrcft-action]").disabled && ["space","translator","advanced","toolkit","oyasumi","desktopplus","fpsvr","slimevr","vrct","vrcx","vrcs"].every(id=>document.querySelector(`[data-card=tool-${id}] .vua-environment-card__action`) && !document.querySelector(`[data-card=tool-${id}] .vua-environment-card__developing`)) && ["xsoverlay","liv"].every(id=>document.querySelector(`[data-nav-id=tool-${id}-action]`).disabled && !!document.querySelector(`[data-card=tool-${id}] .vua-environment-card__developing`))'), "VRCFT, seven Steam tools and four official-installer tools have live cards; XSOverlay and LIV remain development placeholders");
    assert(await js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-88)<1) && [...document.querySelectorAll(".vua-shell__sidebar [data-nav-id]")].map(c=>c.dataset.navId).indexOf("nav-tools-discover") < [...document.querySelectorAll(".vua-shell__sidebar [data-nav-id]")].map(c=>c.dataset.navId).indexOf("nav-env-create")'), "Tools share Play card dimensions and precede Avatar editing");
    for (const button of await js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card__details")].map(b=>b.dataset.navId)')) {
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='true' && !document.getElementById('${button}-details').hidden`), `${button} opens inline details`);
      await waitFor(() => toolDrawerFits(button), `${button} full-row sliding details`);
      assert(true, `${button} details slide below their row and span the full grid width`);
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='false' && document.getElementById('${button}-details').closest('.vua-tools-drawer').inert`), `${button} closes on a second click and makes its retained details inert`);
    }
    await capture("tools-dark");
    assert(await toolLabelsFit(), "Compact tool names fit completely inside their detail buttons");
    const toolWidths = await js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card")].map(c=>c.getBoundingClientRect().width)');
    assert(toolWidths.every(width=>Math.abs(width-toolWidths[0])<1), "Every tool has the same card width, including the single Capture entry");
    await js('document.querySelector("[data-nav-id=nav-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-refresh-devices]")'), "Play cards");
    window.setSize(1180, 820);
    await delay(100);
    if (process.env.VUA_TEST_NETWORK_LIVE === "1") {
      await js('document.querySelector("[data-nav-id=shell-network]").click()');
      await waitFor(() => js('!!document.querySelector("[data-nav-id=network-test]") && !document.querySelector("[data-nav-id=network-test]").disabled'), "Regional response");
      const timings = await js('document.querySelector(".vua-network__references").textContent');
      await js('document.querySelector("[data-nav-id=shell-network]").click()');
      fs.writeFileSync(path.join(output, "live-regional-reference.json"), JSON.stringify({ scope: "Actual native HTTPS response time to Oracle regional origins, not game Ping", timings }, null, 2));
      assert(timings.includes("≈"), "At least one live regional reference returned a timed response");
    }
    assert(await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-88)<1)'), "All Play cards are half-height");
    const cardLayout = await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card button")].map(b=>({label:b.getAttribute("data-nav-id"),overflow:b.scrollHeight-b.clientHeight}))');
    assert(cardLayout.every(row => row.overflow < 3), "Compact card content fits without vertical clipping");
    await capture("play-dark");
    // A player who has not chosen sees the choices; a device leads to its connections and steps.
    if (await js('document.querySelector(".vua-play-drawer").dataset.open!=="true"')) await js('document.querySelector(".vua-play-current .vua-environment-card__details").click()');
    await waitFor(() => js('document.querySelector(".vua-play-drawer").dataset.open==="true"'), "The card's left half opens the choices");
    await js('document.querySelector("[data-nav-id=play-other-headsets]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-device-varjo]")'), "Less common headsets follow their own entry");
    await js('document.querySelector("[data-nav-id=play-device-varjo]").click()');
    await waitFor(() => js('!!document.getElementById("route-varjo-details") && !!document.querySelector("[data-nav-id=play-official-varjo-base]") && document.querySelector("[data-nav-id=route-varjo-action]")?.getAttribute("aria-busy")==="false"'), "Varjo's steps link its official page");
    assert(await js('!document.querySelector(".vua-setup__connections")'), "A wired headset skips the connection question");
    await js('document.querySelector("[data-nav-id=play-device-quest]").click()');
    await waitFor(() => js('!!document.getElementById("route-quest-details") && !!document.querySelector("[data-nav-id=play-official-quest-link]") && document.querySelector("[data-nav-id=route-quest-action]")?.getAttribute("aria-busy")==="false"'), "Meta Quest's steps");
    assert(await js('document.querySelectorAll(".vua-setup__connections input[type=radio]").length===5'), "Meta Quest offers its five connections, including no PC");
    await js(`(() => {
      window.__helpEscapeTrace = [];
      const record = kind => {
        const state = {kind, time:performance.now(), open:document.querySelector('.vua-play-drawer')?.dataset.open, phase:document.querySelector('.vua-play-current [data-phase]')?.dataset.phase, owners:[...document.querySelectorAll('[role="dialog"], [role="menu"], .vua-tour')].map(e=>({role:e.getAttribute('role'),className:e.className}))};
        if (window.__helpEscapeTrace.length < 40) window.__helpEscapeTrace.push(state);
      };
      const observer = new MutationObserver(() => record('mutation'));
      observer.observe(document.querySelector('.vua-play-page'), {subtree:true,attributes:true,attributeFilter:['data-open','data-phase']});
      window.addEventListener('keydown', event => {if(event.key==='Escape') record('escape');}, {capture:true});
      record('before-connection');
    })()`);
    await js('document.querySelector("[data-nav-id=play-connection-virtual-desktop]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-official-virtual-desktop]") && document.querySelector("[data-nav-id=route-quest-action]")?.getAttribute("aria-busy")==="false"'), "Choosing a connection changes the steps");
    await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
    await waitFor(() => js('document.querySelector(".vua-play-drawer").dataset.open==="false"'), "Esc closes the choices");
    fs.writeFileSync(path.join(output, "escape-trace.json"), JSON.stringify(await js('window.__helpEscapeTrace'), null, 2));
    await js('document.querySelector("[data-nav-id=route-quest]").click()');
    await waitFor(() => js('document.querySelector(".vua-play-drawer").dataset.open==="true"'), "The card's left half opens the choices");
    await js('document.querySelector("[data-nav-id=play-device-pc]").click()');
    await waitFor(() => playDrawerBelow("route-desktop"), "PC mode's steps open below its card");
    await capture("play-inline-details");
    await js('document.querySelector("[data-nav-id=play-device-pico]").click()');
    await waitFor(() => playDrawerBelow("route-pico"), "PICO's steps open below its card");
    await js('document.querySelector("[data-nav-id=play-device-pc]").click()');
    await waitFor(() => playDrawerBelow("route-desktop"), "Back to PC mode");
    await js('document.querySelector("[data-nav-id=route-desktop]").click()');
    await waitFor(() => js('document.querySelector(".vua-play-drawer").dataset.open==="false"'), "A second click closes the choices");
    await js('document.querySelector("[data-nav-id=nav-enable-amf]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-creator-page [data-nav-id=toggle-amf]")'), "AMF setup in Avatar editing");
    assert(await js('!document.querySelector("[data-nav-id=toggle-amf]").checked && document.querySelector("[data-amf-setup]").textContent.includes("尚未启用") && !document.querySelector(".vua-shell__sidebar [data-nav-id=nav-workshop]")'), "AMF shows as not enabled in Avatar editing and waits for explicit enablement");
    await capture("amf-off");
    await capture("avatar-preparation", ".vua-upload-eligibility");
    if (process.env.VUA_TEST_EXPECT_EDITOR_VERSION) {
      const expected = process.env.VUA_TEST_EXPECT_EDITOR_VERSION;
      await waitFor(() => js(`document.querySelector('[data-editor-status]')?.textContent.includes(${JSON.stringify(expected)})`), "Host Editor inventory before AMF activation");
      assert(await js('!document.querySelector("[data-nav-id=toggle-amf]").checked'), "The existing C1 Editor is detected before AMF activation or CLI installation");
    }
    // Unity 6 opens details only when a 6000 editor is installed; otherwise it is a tooltip-only card.
    const unity6Installed = await js('!!document.getElementById("route-unity6-details")');
    if (!unity6Installed) assert(await js('document.querySelector("[data-nav-id=route-unity6]").disabled'), "Unity 6 without an installed editor opens no details");
    for (const button of ['route-unity2022', ...(unity6Installed ? ['route-unity6'] : []), 'manager-unity_hub','manager-vcc','manager-alcom']) {
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='true'`), `${button} expands inline`);
      await waitFor(() => inlineDetailFits(button), `${button} details stay below their own editor or manager card`);
      if (button === 'route-unity2022') {
        const softwareChecked = 'document.querySelector("#route-unity2022-details [data-scenario-software-check] li") && !document.querySelector("#route-unity2022-details [data-deployment-plan]")';
        try { await waitFor(() => js(`!!(${softwareChecked})`), "Automatic Unity software check"); }
        catch (error) { console.error(JSON.stringify({ unityDetails: await js('document.querySelector("#route-unity2022-details")?.innerText.slice(0, 1200)') })); throw error; }
        assert(await js(`!!(${softwareChecked})`), "Unity preparation checks software on first entry without planning or installing");
        assert(await js(`(() => { const steps = document.querySelectorAll('#route-unity2022-details .vua-scenario-license-step'); return steps.length === 1 && !steps[0].closest('details') && steps[0].getBoundingClientRect().height > 0; })()`), "Unity licensing is a single visible scenario step outside the SOP");
        assert(await js(`document.querySelectorAll('#route-unity2022-details .vua-unity-license-status > button').length === 1`), "With AMF disabled, the license step offers only installation through the existing plan");
        if (process.env.VUA_TEST_EXPECT_EDITOR_VERSION) {
          const expected = process.env.VUA_TEST_EXPECT_EDITOR_VERSION;
          assert(await js(`[...document.querySelectorAll('#route-unity2022-details [data-scenario-software-check] li')].some(item=>item.textContent.includes(${JSON.stringify(expected)}))`), "The existing Editor's full version is reported on first entry without installation");
          await capture('unity-first-entry');
        }
      }
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='false'`), `${button} collapses inline`);
    }
    await js('document.querySelector(".vua-creator-page").scrollTop=0; document.querySelector("main").scrollTop=0');
    await capture("create-dark");
    await js('document.querySelector("[data-nav-id=nav-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-refresh-devices]")'), "Play return");
    await js('window.vua.window.showEncyclopedia({topic:"guide-hardware",section:"identify-device"})');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.textContent==="硬件介绍"'), "Hardware introduction in Help");
    assert(BrowserWindow.getAllWindows().length === 1, "Hardware help opens inside the main window");
    assert(await js('document.querySelector("[data-nav-id=shell-help]").getAttribute("aria-current")==="page" && !!document.querySelector("[data-guide-section=identify-device]")'), "Encyclopedia keeps Help selected and targets hardware");
    await capture("hardware-dark");
    assert(await chapterContrast() >= 4.5, "Selected chapter text is legible in dark appearance");
    await js('const unsubscribe = window.vua.window.encyclopediaTargetEvents.subscribe(()=>{}); unsubscribe(); unsubscribe()');
    await js('window.vua.window.showEncyclopedia({topic:"guide-devices",section:"pico-wifi"})');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.getAttribute("id").includes("guide-devices")'), "Contextual chapter navigation");
    await waitFor(() => js('localStorage.getItem("vua-guide-reading")?.includes("pico-wifi")'), "Targeted section saved");
    await waitFor(() => js('(()=>{const heading=document.querySelector("[data-guide-section=pico-wifi] h3").getBoundingClientRect(),body=document.querySelector(".vua-knowledge__body").getBoundingClientRect();return heading.top>=body.top-2 && heading.bottom<=body.bottom})()'), "Target heading is fully visible in the article viewport");
    assert(true, "Targeted chapter headings remain visible beside the vertical topic navigation");
    assert(BrowserWindow.getAllWindows().length === 1, "Repeated contextual requests never create a reader window");
    await js('document.querySelector("[data-nav-id=help-child-back]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "Help landing");
    await capture("help-faq");
    assert(await js('["trust-rank","shield","personal-space","untrusted-urls"].every(id=>!!document.querySelector(`[data-faq="${id}"]`))'), "Help shows trust, shield, personal-space and untrusted-link answers directly");
    assert(await js('document.querySelector("[data-nav-id=help-wizard]").textContent.includes("入门向导") && document.querySelector("[data-nav-id=help-encyclopedia]").textContent.includes("知识百科") && document.querySelector("[data-nav-id=help-game-assistant]").textContent.includes("游戏内助手")'), "Help separates VUA instructions, encyclopedia and game assistant");
    await js('document.querySelector("[data-faq=trust-rank] [data-guide-entry=improve-trust]").click()');
    await waitFor(() => js('!!document.querySelector("[data-guide-section=improve-trust]")'), "Trust improvement opens the matching local answer");
    assert(await js('document.querySelector("[data-guide-source=guide-creator]")?.title.includes("creating-your-first-avatar")'), "Upload answers link the official creator documentation");
    await js('document.querySelector("[data-nav-id=help-child-back]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "FAQ returns to Help");
    const side = command => window.emit('app-command', {}, command);
    for (const child of ['help-wizard','help-encyclopedia']) {
      await js(`document.querySelector('[data-nav-id="${child}"]').click()`);
      await waitFor(() => js(`location.hash.startsWith('#${child}') && !!document.querySelector('[data-nav-id=help-child-back]')`), child);
      assert(BrowserWindow.getAllWindows().length === 1, `${child} opens a main-window child page`);
      await delay(100);
      side('browser-backward');
      await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), `${child} mouse Back`);
      side('browser-forward');
      await waitFor(() => js(`location.hash.startsWith('#${child}') && !!document.querySelector('[data-nav-id=help-child-back]')`), `${child} mouse Forward`);
      assert(await js('document.querySelector("[data-nav-id=shell-help]").getAttribute("aria-current")==="page"'), `${child} restores on mouse Forward`);
      if (child === 'help-wizard') {
        await waitFor(() => js('!!document.querySelector(".vua-vua-guide") && !!document.querySelector("[data-wizard-step=vrchat]")'), "Help opens the concept wizard at VRChat");
        const wizardButtons = () => js('JSON.stringify(["wizard-previous","wizard-want","wizard-next"].map(id=>{const r=document.querySelector(`[data-nav-id="${id}"]`).getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]}))');
        const firstPageButtons = await wizardButtons();
        assert(await js('document.querySelector("[data-nav-id=wizard-previous]").disabled'), "The first wizard page has no previous page");
        await js('document.querySelector("[data-nav-id=wizard-next]").click()');
        await waitFor(() => js('!document.querySelector("[data-wizard-step=vrchat]")'), "Wizard next page");
        assert(await wizardButtons() === firstPageButtons, "The three wizard buttons keep one place across pages");
        assert(await js('!document.querySelector("[data-nav-id=wizard-previous]").disabled'), "Later wizard pages can go back");
        await js('document.querySelector("[data-nav-id=wizard-previous]").click()');
        await waitFor(() => js('!!document.querySelector("[data-wizard-step=vrchat]")'), "Wizard previous page");
      }
      await js('document.querySelector("[data-nav-id=help-child-back]").click()');
      await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "Help return");
    }
    await js('document.querySelector("[data-nav-id=help-encyclopedia]").click()');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.getAttribute("id").includes("guide-creator")'), "Encyclopedia restores its own latest topic");
    await js('document.querySelector("#guide-overlay-tab-guide-hardware").click()');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-hardware")'), "Chapter choice");
    side('browser-backward');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-creator")'), "Chapter Back returns to the creator topic");
    side('browser-forward');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-hardware")'), "Chapter Forward");
    assert(true, "Knowledge chapters support mouse Back and Forward");
    await js('document.querySelector("#guide-overlay-tab-guide-hardware").focus(); document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-room")'), "Vertical chapter Arrow Down");
    await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}))');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id==="guide-overlay-tab-guide-hardware" && document.activeElement.id==="guide-overlay-tab-guide-hardware"'), "Vertical chapter Arrow Up");
    assert(true, "Vertical topic navigation supports arrow keys and retains focus on the selected tab");
    await js('document.querySelector("[data-nav-id=help-catalog]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), "Encyclopedia catalog from the reader");
    await setSearch("New User");
    await setFilter(0, "guide-creator");
    await setFilter(1, "procedure");
    await waitFor(() => js(`!!document.querySelector('[data-guide-result="guide-creator/upload-eligibility"]')`), "Search and filters find the upload answer");
    assert(await js('[...document.querySelectorAll("[data-guide-result]")].every(result=>result.dataset.guideResult.startsWith("guide-creator/"))'), "Search filters keep only the chosen topic and answer type");
    await js(`document.querySelector('[data-guide-result="guide-creator/upload-eligibility"]').click()`);
    await waitFor(() => js('!!document.querySelector("[data-guide-section=upload-eligibility]") && localStorage.getItem("vua-guide-reading")?.includes("upload-eligibility")'), "Search opens and bookmarks the exact answer");
    await js('document.querySelector("[data-nav-id=help-catalog]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), "Search state returns to the catalog");
    assert(await js('document.querySelector(".vua-encyclopedia-search input").value==="New User"'), "Catalog preserves the search when returning from an answer");
    await js('document.querySelector(".vua-encyclopedia-search button").click()');
    await setSearch("变粉");
    await waitFor(() => js(`!!document.querySelector('[data-guide-result="guide-avatars/pink-materials"]')`), "Chinese symptom search finds pink-material guidance");
    await js(`document.querySelector('[data-guide-result="guide-avatars/pink-materials"]').click()`);
    await waitFor(() => js('!!document.querySelector("[data-guide-section=pink-materials]")'), "Pink-material article opens");
    await capture("avatar-pink");
    await js('document.querySelector("[data-nav-id=help-catalog]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), "Catalog before full-body search");
    await setSearch("PhysBone");
    await waitFor(() => js(`!!document.querySelector('[data-guide-result="guide-avatars/outfit-diagnostics"]')`), "Full-body search finds an article section");
    assert(await js(`!document.querySelector('[data-guide-result="guide-avatars/outfit-diagnostics"]').textContent.includes("PhysBone")`), "Full-body search finds text beyond the title, aliases and displayed summary");
    await setSearch("term-that-has-no-answer");
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-empty")'), "Unknown search has an honest empty state");
    await js('document.querySelector(".vua-encyclopedia-search button").click()');
    assert(await js('document.querySelector(".vua-encyclopedia-search input").value==="" && [...document.querySelectorAll(".vua-encyclopedia-search select")].every(select=>select.value==="all")'), "Clear restores the query and both filters");
    await js('document.querySelector("[data-guide-task=avatar-visibility]").click()');
    await waitFor(() => js('!!document.querySelector("[data-guide-section=visibility]")'), "Task entry opens the visibility answer");
    assert(await js(`document.querySelectorAll('[data-guide-article-source="guide-avatars/visibility"]').length===3`), "Visibility lists its three checked sources without a real-machine claim");
    await capture("avatar-visibility");
    await js('document.querySelector("[data-nav-id=help-catalog]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), "Catalog participates in history");
    // Exercise the responsive disclosure in the real renderer; the production window normally has a 960px minimum.
    window.setMinimumSize(640, 600);
    window.setSize(640, 720);
    await waitFor(() => js('matchMedia("(max-width:720px)").matches'), "Narrow encyclopedia viewport");
    assert(await js('(()=>{const body=document.querySelector(".vua-knowledge__body"),input=document.querySelector(".vua-encyclopedia-search input"),r=body.getBoundingClientRect(),i=input.getBoundingClientRect();return body.scrollWidth<=body.clientWidth+2 && i.left>=r.left && i.right<=r.right+1})()'), "Narrow catalog stacks its search controls without horizontal overflow");
    await capture("encyclopedia-narrow-catalog");
    await js('document.querySelector("[data-guide-task=avatar-visibility]").click()');
    await waitFor(() => js('!!document.querySelector("[data-guide-section=visibility]") && getComputedStyle(document.querySelector(".vua-overlay-guide__topic-menu > summary")).display!=="none"'), "Narrow chapter disclosure");
    assert(await js('!document.querySelector(".vua-overlay-guide__topic-menu").open'), "Narrow chapter navigation starts as a compact disclosure");
    await js('document.querySelector(".vua-overlay-guide__topic-menu > summary").click()');
    assert(await js('document.querySelector(".vua-overlay-guide__topic-menu").open && !!document.querySelector(".vua-overlay-guide__topic[data-active]")'), "Narrow disclosure exposes the selected chapter");
    await capture("encyclopedia-narrow-reader");
    await js('document.querySelector("[data-nav-id=help-catalog]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), "Narrow catalog return");
    window.setSize(1180, 820);
    window.setMinimumSize(960, 600);
    await waitFor(() => js('matchMedia("(min-width:721px)").matches'), "Wide encyclopedia restored");
    side('browser-backward');
    await waitFor(() => js('!!document.querySelector("[data-guide-section=visibility]")'), "Back returns from catalog to the article");
    side('browser-forward');
    await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), "Forward returns to the catalog");
    assert(await js('localStorage.getItem("vua-guide-reading")?.includes("visibility")'), "Catalog and article preserve the encyclopedia bookmark");
    await js('window.vua.window.showEncyclopedia({topic:"guide-vua",section:"first-run-language"})');
    await waitFor(() => js('!!document.querySelector("[data-guide-section=first-run-language]") && !Array.from(document.querySelectorAll("figure img")).some(image=>image.getAttribute("src").endsWith("/first-run.png"))'), "Updated first-use explanation excludes the retired language-choice capture");
    assert(await js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-vua")'), "Using VUA is a topic of the encyclopedia and describes the current first use");
    await capture("vua-guide-media");
    await js('document.querySelector("[data-nav-id=help-child-back]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=help-wizard]")'), "Help before the full explanation");
    await js('document.querySelector("[data-nav-id=help-wizard]").click()');
    await waitFor(() => js('!!document.querySelector("[data-wizard-step=vrchat] [data-guide-entry=what-is-vrchat]")'), "Wizard full explanation");
    await js('document.querySelector("[data-guide-entry=what-is-vrchat]").click()');
    await waitFor(() => js('location.hash.startsWith("#help-encyclopedia") && !!document.querySelector("[data-guide-section=what-is-vrchat]")'), "The wizard's full explanation opens that section of the encyclopedia");
    assert(BrowserWindow.getAllWindows().length === 1, "The full explanation stays in the main window");
    await js('window.vua.window.showEncyclopedia({topic:"guide-avatars",section:"visibility"})');
    await waitFor(() => js('!!document.querySelector("[data-guide-section=visibility]") && localStorage.getItem("vua-guide-reading")?.includes("visibility")'), "Encyclopedia article before Settings");
    const articleHashBeforeSettings = await js('location.hash');
    await js('document.querySelector("[data-nav-id=shell-settings]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-settings-theme]")'), "Settings navigation");
    assert(await js('!["nav-settings-goals","nav-settings-language","nav-settings-version","nav-settings-donate"].some(id=>document.querySelector(`[data-nav-id=${id}]`))'), "Retired Settings pages, including goal reselection, are absent");
    assert(await languageFooterFits(), "A compact language selector with translation glyph sits above Search without overlap");
    await capture("theme-presets");
    window.setSize(960, 600);
    await delay(100);
    assert(await languageFooterFits(), "Language and Search remain separate in a short window");
    await capture('settings-small');
    window.setSize(1180, 820);
    await delay(100);
    assert(await js('!document.querySelector(".vua-shell").hasAttribute("data-display-mode") && document.querySelectorAll(".vua-theme-choice__button").length===5 && !document.querySelector("main").textContent.includes("大屏幕模式")'), "Theme keeps appearance controls and has no retired layout mode");
    await js('document.querySelector("[data-nav-id=nav-settings-about]").click()');
    await waitFor(() => js('!!document.querySelector("[data-version-details]")'), "About version controls");
    assert(await js('!!document.querySelector("[data-version-details] [data-nav-id=about-check-updates]")'), "About contains the existing version and update controls");
    await capture("about-dark");
    await js('document.querySelector("[data-nav-id=nav-settings-theme]").click()');
    await js('document.querySelector(".vua-theme-choice button:nth-of-type(2)").click()');
    await js('document.querySelector("[data-nav-id=shell-back]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-knowledge") && document.documentElement.dataset.theme==="light"'), "Knowledge follows light appearance and Settings return");
    await waitFor(() => js(`location.hash===${JSON.stringify(articleHashBeforeSettings)} && !!document.querySelector('[data-guide-section=visibility]')`), "Settings restores the exact article instead of the catalog");
    assert(true, "Changing appearance preserves the article and its chapter URL");
    await capture("knowledge-light");
    assert(await chapterContrast() >= 4.5, "Selected chapter text is legible in light appearance");
    await js('document.querySelector("[data-nav-id=nav-enable-amf]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=toggle-amf]")'), "AMF switch");
    await js('document.querySelector("[data-nav-id=toggle-amf]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=open-amf]") && !!document.querySelector(".vua-shell__sidebar [data-nav-id=nav-workshop]")'), "Explicit AMF enablement");
    // Provider readiness precedes the IPC reply while Main initializes the AMF shell.
    // A real user can toggle again only after this control becomes enabled.
    await waitFor(() => js('document.querySelector("[data-nav-id=toggle-amf]")?.disabled===false'), "AMF enablement control released");
    assert(await js('document.querySelector("[data-nav-id=toggle-amf]").checked && !document.querySelector("[data-nav-id=nav-enable-amf]")'), "AMF activation exposes its own sidebar without navigating away");
    await js('document.querySelector("[data-nav-id=logo-home]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=home-release]")'), "AMF Home directory");
    // Home follows the Avatar path; Recipes and Packages stay in the directory.
    assert(await js('["warehouse","workshop","release"].every(id => !!document.querySelector(`[data-nav-id=home-${id}]`)) && !document.querySelector("[data-nav-id=home-recipe]") && !document.querySelector("[data-nav-id=home-packages]")'), "AMF Home follows materials, Workshop and Finished Avatars");
    await js('document.querySelector("[data-nav-id=home-release]").click()');
    await waitFor(() => js('location.hash==="#release" && !!document.querySelector("main h1")'), "Finished Avatars destination");
    await js('document.querySelector("[data-nav-id=nav-recipe]").click()');
    await waitFor(() => js('location.hash==="#recipe" && !!document.querySelector("main h1")'), "Recipes destination");
    await js('document.querySelector("[data-nav-id=nav-packages]").click()');
    await waitFor(() => js('location.hash==="#packages" && !!document.querySelector("main h1")'), "Package Manager destination");
    assert(true, "Finished Avatars, Recipes and Packages open their functional pages");
    // Synthetic authentication replies exercise the real renderer/Main IPC
    // handoff without contacting BOOTH, loading login pages or syncing accounts.
    let resolveAccountProbe;
    let authOk = false;
    let firstProbe = true;
    const loginRequests = [];
    let syncRequests = 0;
    ipcMain.removeHandler('vua:remote-content:auth-probe');
    ipcMain.handle('vua:remote-content:auth-probe', () => {
      if (firstProbe) { firstProbe = false; return new Promise(resolve => { resolveAccountProbe = resolve; }); }
      return { authOk, accountName: null };
    });
    ipcMain.removeHandler('vua:remote-content:open');
    ipcMain.handle('vua:remote-content:open', (_event, request) => {
      loginRequests.push(request.url);
      return { viewId: `synthetic-login-${loginRequests.length}`, url: request.url, visible: true, canGoBack: false, canGoForward: false };
    });
    ipcMain.removeHandler('vua:remote-content:close');
    ipcMain.handle('vua:remote-content:close', () => {});
    ipcMain.removeHandler('vua:catalog-sync:start');
    ipcMain.handle('vua:catalog-sync:start', () => { syncRequests += 1; return { status: 'blocked', reason: 'sign-in-required' }; });
    await js('document.querySelector("[data-nav-id=nav-warehouse]").click()');
    await waitFor(async () => await js('!!document.querySelector("[data-nav-id=warehouse-sync]")') && resolveAccountProbe !== undefined, "Warehouse entry account probe");
    assert(await js('document.querySelector("[data-nav-id=warehouse-sync]").textContent.includes("正在检测")'), "The sync button says authentication is being checked");
    resolveAccountProbe({ authOk: false, accountName: null });
    await waitFor(() => js('document.querySelector("[data-nav-id=warehouse-sync]")?.textContent.includes("登录 BOOTH")'), "Login required before sync");
    await js('document.querySelector("[data-nav-id=warehouse-sync]").click()');
    await waitFor(async () => loginRequests.length === 1 && await js('!!document.querySelector(".vua-import__browse-button--close")'), "Direct login handoff");
    assert(syncRequests === 0 && loginRequests[0] === 'https://accounts.booth.pm/users/sign_in', "Unauthenticated sync entry opens BOOTH login directly without a sync request");
    authOk = true;
    await js('document.querySelector(".vua-import__browse-button--close").click()');
    await waitFor(() => js('document.querySelector("[data-nav-id=warehouse-sync]")?.textContent.includes("同步 BOOTH") && !document.querySelector("[data-nav-id=warehouse-sync]").disabled'), "Post-login entry refresh");
    assert(await js('document.querySelector("[data-nav-id=warehouse-sync]").textContent.includes("同步 BOOTH")'), "Closing login reprobes the actual account result before offering sync");
    await js('document.querySelector("[data-nav-id=warehouse-sync]").click()');
    await waitFor(async () => loginRequests.length === 2 && await js('!!document.querySelector(".vua-import__browse-button--close")'), "Expired-session login handoff");
    assert(syncRequests === 1, "A session rejected after the fresh probe reopens login instead of only showing a message");
    await js('document.querySelector(".vua-import__browse-button--close").click(); document.querySelector("[data-nav-id=nav-env-create]").click()');
    await waitFor(() => js('document.querySelector("[data-nav-id=toggle-amf]")?.disabled===false'), "AMF setup return");
    await js('document.querySelector("[data-nav-id=toggle-amf]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-enable-amf]") && !document.querySelector("[data-nav-id=toggle-amf]").checked'), "Explicit AMF disablement");
    assert(await js('!document.querySelector(".vua-shell__sidebar [data-nav-id=nav-workshop]")'), "Disabling AMF removes its pages and restores its enablement entry");
    await js('document.querySelector("[data-nav-id=shell-settings]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=settings-language-select]")'), "Sidebar language control");
    await js('const choice=document.querySelector("[data-nav-id=settings-language-select]"); choice.value="en"; choice.dispatchEvent(new Event("change",{bubbles:true}))');
    await waitFor(() => js('document.documentElement.lang==="en" && !!document.querySelector("[data-nav-id=settings-language-select]") && !document.querySelector(".vua-boot-splash")'), "Language preference reload");
    assert(await js('document.querySelector("[data-nav-id=settings-language-select]").value==="en" && localStorage.getItem("vua-locale")==="en"'), "The sidebar language selector actually switches and persists language");
    await js('document.querySelector("[data-nav-id=shell-back]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-creator-page") && !document.querySelector(".vua-shell__sidebar--settings")'), "Settings source after language reload");
    assert(true, "Switching language preserves the Settings return destination");
    window.webContents.send("vua:window:shell-command", "check-updates");
    await waitFor(() => js('location.hash==="#settings-about" && !!document.querySelector("[data-nav-id=about-check-updates]")'), "Tray update destination after reload");
    assert(true, "The native update command opens About after a language reload");
    await waitFor(() => js('!!document.querySelector(".vua-shell__usage")'), "Resource panel");
    await js('document.querySelector(".vua-shell__usage").click()');
    assert(await js('!!document.querySelector(".vua-usage-panel") && !document.querySelector(".vua-usage-panel time") && !document.querySelector(".vua-usage-panel").textContent.includes("Sampled at")'), "Resource panel has no sampled-time display");
    await js('document.querySelector(".vua-usage-panel__close").click(); localStorage.setItem("vua-display-mode","bigscreen")');
    await js('location.reload()');
    await waitFor(() => js('!!document.querySelector(".vua-shell") && !document.querySelector(".vua-boot-splash") && localStorage.getItem("vua-display-mode")===null'), "Retired layout preference cleanup");
    assert(await js('!document.querySelector(".vua-shell").hasAttribute("data-display-mode") && !!document.querySelector(".vua-shell__sidebar")'), "An old big-screen preference starts the ordinary desktop shell with its sidebar");
    window.webContents.send("vua:window:shell-command", "bigscreen");
    await delay(100);
    assert(await js('location.hash==="#settings-about" && !document.querySelector(".vua-shell").hasAttribute("data-display-mode")'), "Legacy big-screen commands cannot change the page or resurrect the retired mode");
    assert(await js('document.querySelector("[data-nav-id=settings-search]").textContent.trim()==="Search"') && await languageFooterFits(), "English uses the short Search label and a separate compact language row");
    await js('location.hash="/settings-goals"');
    await waitFor(() => js('!!document.querySelector(".vua-vua-guide") && !!document.querySelector("[data-nav-id=help-child-back]") && !document.querySelector(".vua-shell__sidebar--settings")'), "Retired goal destination migration");
    assert(true, "Old goal-reselection links open the VRChat wizard");
    await js('document.querySelector("[data-nav-id=nav-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-refresh-devices]")'), "Ordinary Play after migration");
    assert(await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-88)<1)'), "Retired preferences never enlarge Play cards");
    const encyclopediaLocales = [
      ["en", "What do you want to know?", "Avatars & outfits"],
      ["zh-CN", "想先解决什么问题？", "Avatar 与换装"],
      ["zh-TW", "想先解決什麼問題？", "Avatar 與換裝"],
      ["ja", "何を知りたいですか？", "アバターと衣装"],
      ["ko", "무엇이 궁금한가요?", "아바타와 의상"],
    ];
    for (const [locale, homeTitle, avatarTitle] of encyclopediaLocales) {
      await js(`localStorage.setItem("vua-locale",${JSON.stringify(locale)}); location.hash="#help-encyclopedia?guideTopic=guide-avatars&guideSection=visibility"; location.reload()`);
      await waitFor(() => js(`document.documentElement.lang===${JSON.stringify(locale)} && !!document.querySelector("[data-guide-section=visibility]")`), `${locale} encyclopedia reader`);
      await js('document.querySelector("[data-nav-id=help-catalog]").click()');
      await waitFor(() => js('!!document.querySelector(".vua-encyclopedia-home")'), `${locale} encyclopedia catalog`);
      assert(await js(`document.querySelector(".vua-encyclopedia-home h2").textContent===${JSON.stringify(homeTitle)} && document.querySelectorAll("[data-guide-task]").length===6 && document.querySelectorAll(".vua-encyclopedia-tree > li > details").length===9`), `${locale} renders its localized catalog, six tasks and nine topics`);
      await setSearch("Quest");
      await waitFor(() => js(`!!document.querySelector('[data-guide-result="guide-avatars/platforms"]')`), `${locale} local search`);
      await capture(`encyclopedia-${locale}`);
      await js(`document.querySelector('[data-guide-result="guide-avatars/platforms"]').click()`);
      await waitFor(() => js(`document.querySelector(".vua-overlay-guide__title")?.textContent===${JSON.stringify(avatarTitle)} && !!document.querySelector("[data-guide-section=platforms]")`), `${locale} Avatar article`);
      assert(await js('document.querySelector(".vua-knowledge__body").scrollWidth<=document.querySelector(".vua-knowledge__body").clientWidth+2'), `${locale} article fits the production reader without horizontal overflow`);
    }
    assert(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
    fs.writeFileSync(path.join(output, "checks.json"), JSON.stringify({ checks, scope: "Controlled application navigation/layout only; no hardware, vendor or human-language acceptance" }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, evidence: output }));
    exitCode = 0;
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      const failureCapture = await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).catch(() => null);
      if (failureCapture) fs.writeFileSync(path.join(output, "failure.png"), failureCapture.toPNG());
      const dom = await window.webContents.executeJavaScript('({hash:location.hash, heading:document.querySelector("main h1")?.textContent, wizard:document.querySelector(".vua-onboarding")?.dataset.wizardStep, amfSwitch:document.querySelector("[data-nav-id=toggle-amf]")?{checked:document.querySelector("[data-nav-id=toggle-amf]").checked,disabled:document.querySelector("[data-nav-id=toggle-amf]").disabled}:null, status:[...document.querySelectorAll("[data-amf-setup] [role=status]")].map(e=>e.textContent), playDrawer:document.querySelector(".vua-play-drawer")?.dataset.open, playPhase:document.querySelector(".vua-play-current [data-phase]")?.dataset.phase, escapeOwners:[...document.querySelectorAll("[role=dialog], [role=menu], .vua-tour")].map(e=>({role:e.getAttribute("role"),className:e.className,step:e.dataset.tourStep}))})');
      fs.writeFileSync(path.join(output, "navigation.json"), JSON.stringify({ index: window.webContents.navigationHistory.getActiveIndex(), entries: window.webContents.navigationHistory.getAllEntries(), dom }, null, 2));
      console.error(JSON.stringify(dom));
      console.error(JSON.stringify({ escapeTrace: await window.webContents.executeJavaScript('window.__helpEscapeTrace ?? null') }));
      console.error(JSON.stringify({ evidence: output, rendererErrors: errors }));
    }
  } finally { clearTimeout(deadline); app.quit(); }
}
void run();

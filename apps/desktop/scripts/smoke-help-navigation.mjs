// Real Main/preload/production renderer in a disposable profile. No vendor actions.
import { app, BrowserWindow, ipcMain } from "electron";
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
    const js = source => window.webContents.executeJavaScript(source, true);
    const inlineDetailFits = button => js(`(()=>{
      const control=document.querySelector('[data-nav-id="${button}"]');
      const entry=control.closest('[data-card-entry]'), detail=document.getElementById(control.getAttribute('aria-controls'));
      const card=entry.firstElementChild, cardRect=card.getBoundingClientRect(), detailRect=detail.getBoundingClientRect();
      return detail.parentElement===entry && card.nextElementSibling===detail && !detail.hidden
        && Math.abs(detailRect.left-cardRect.left)<1 && Math.abs(detailRect.width-cardRect.width)<1
        && detailRect.top>=cardRect.bottom && detailRect.top-cardRect.bottom<=14
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
    await waitFor(() => js('document.querySelector(".vua-tour")?.dataset.tourStep==="welcome"'), "first-use welcome");
    await js('document.querySelector(".vua-tour__actions button").click()');
    await waitFor(() => js('!!document.querySelector(".vua-onboarding") && !document.querySelector(".vua-boot-splash")'), "fresh entry after tour skip");
    // Use an explicit UI preference instead of depending on the test machine's locale.
    await js('localStorage.setItem("vua-locale","zh-CN"); location.reload()');
    await waitFor(() => js('!!document.querySelector(".vua-onboarding") && !document.querySelector(".vua-boot-splash") && document.documentElement.lang==="zh-CN"'), "localized fresh entry");
    await js('document.querySelector(".vua-journey-top button").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=shell-help]")'), "Help in topbar");
    assert(await js('(()=>{const h=document.querySelector("[data-nav-id=shell-help]"),s=document.querySelector("[data-nav-id=shell-settings]");return h.closest("header")&&h.nextElementSibling===s&&!document.querySelector(".vua-shell__sidebar [data-nav-id=nav-help]")&&getComputedStyle(h).transform===getComputedStyle(s).transform})()'), "Help shares Settings parallelogram styling in the topbar with no sidebar duplicate");
    assert(await js('!!document.querySelector(".vua-shell__sidebar [data-nav-id=nav-tools-discover]")'), "Tools remains in the Environment sidebar");
    await js('document.querySelector("[data-nav-id=nav-tools-discover]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-tools-hub")'), "tool directory");
    assert(await js('document.querySelector(".vua-tools-hub").textContent.includes("VRCFaceTracking") && document.querySelector(".vua-tools-hub").textContent.includes("VRCS") && document.querySelector(".vua-tools-hub").textContent.includes("OVR Overlay Translator") && !document.querySelector("[data-nav-id=tool-vrcft-action]").disabled && [...document.querySelectorAll(".vua-tools-hub .vua-environment-card:not([data-card=tool-vrcft]) .vua-environment-card__action")].every(b=>b.disabled)'), "VRCFT offers device selection; other tool actions remain honest development placeholders");
    assert(await js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-88)<1) && [...document.querySelectorAll(".vua-shell__sidebar [data-nav-id]")].map(c=>c.dataset.navId).indexOf("nav-tools-discover") < [...document.querySelectorAll(".vua-shell__sidebar [data-nav-id]")].map(c=>c.dataset.navId).indexOf("nav-env-create")'), "Tools share Play card dimensions and precede Avatar editing");
    for (const button of await js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card__details")].map(b=>b.dataset.navId)')) {
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='true' && !document.getElementById('${button}-details').hidden`), `${button} opens inline details`);
      assert(await inlineDetailFits(button), `${button} details are directly below their own card and fit its width`);
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='false' && document.getElementById('${button}-details').hidden`), `${button} closes on a second click`);
    }
    await capture("tools-dark");
    assert(await toolLabelsFit(), "Compact tool names fit completely inside their detail buttons");
    const toolWidths = await js('[...document.querySelectorAll(".vua-tools-hub .vua-environment-card")].map(c=>c.getBoundingClientRect().width)');
    assert(toolWidths.every(width=>Math.abs(width-toolWidths[0])<1), "Every tool has the same card width, including the single Capture entry");
    await js('document.querySelector("[data-nav-id=nav-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-hardware-help]")'), "Play cards");
    window.setSize(1180, 820);
    await delay(100);
    if (process.env.VUA_TEST_NETWORK_LIVE === "1") {
      await waitFor(() => js('!document.querySelector("[data-nav-id=play-network-test]").disabled'), "Regional probe available");
      await js('document.querySelector("[data-nav-id=play-network-test]").click()');
      await waitFor(() => js('!document.querySelector("[data-nav-id=play-network-test]").disabled'), "Explicit regional response");
      const timings = await js('document.querySelector(".vua-network-tile__results").textContent');
      fs.writeFileSync(path.join(output, "live-regional-reference.json"), JSON.stringify({ scope: "Actual native HTTPS response time to Oracle regional origins, not game Ping", timings }, null, 2));
      assert(timings.includes("≈"), "At least one live regional reference returned a timed response");
    }
    assert(await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-88)<1)'), "All Play cards, including network, are half-height");
    const cardLayout = await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card button")].map(b=>({label:b.getAttribute("data-nav-id"),overflow:b.scrollHeight-b.clientHeight}))');
    assert(cardLayout.every(row => row.overflow < 3), "Compact card content fits without vertical clipping");
    await capture("play-dark");
    for (const button of ['route-desktop','route-pico','route-quest','route-vive','route-index']) {
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`!document.getElementById('${button}-details').hidden`), `${button} opens inline details`);
      assert(await inlineDetailFits(button), `${button} details are directly below their own card and fit its width`);
      if (button === 'route-desktop') await capture('play-inline-details');
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.getElementById('${button}-details').hidden`), `${button} closes on a second click`);
    }
    await js('document.querySelector("[data-nav-id=nav-enable-amf]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-creator-page [data-nav-id=toggle-amf]")'), "AMF setup in Avatar editing");
    assert(await js('!document.querySelector("[data-nav-id=toggle-amf]").checked && document.querySelector("[data-amf-setup]").textContent.includes("导入和整理素材") && !document.querySelector(".vua-shell__sidebar [data-module=production]")'), "AMF is explained in Avatar editing and waits for explicit enablement");
    await capture("amf-off");
    if (process.env.VUA_TEST_EXPECT_EDITOR_VERSION) {
      const expected = process.env.VUA_TEST_EXPECT_EDITOR_VERSION;
      await waitFor(() => js(`document.querySelector('[data-editor-status]')?.textContent.includes(${JSON.stringify(expected)})`), "Host Editor inventory before AMF activation");
      assert(await js('!document.querySelector("[data-nav-id=toggle-amf]").checked'), "The existing C1 Editor is detected before AMF activation or CLI installation");
    }
    for (const button of ['route-unity2022','route-unity6','manager-unity_hub','manager-vcc','manager-alcom']) {
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='true'`), `${button} expands inline`);
      assert(await inlineDetailFits(button), `${button} details stay below their own editor or manager card`);
      if (button === 'route-unity2022') {
        await waitFor(() => js('!!document.querySelector("#route-unity2022-details .vua-deployment ol li")'), "Automatic Unity entry inspection");
        assert(await js('!!document.querySelector("#route-unity2022-details .vua-deployment ol li")'), "Unity preparation inspects on first entry before any install command");
        if (process.env.VUA_TEST_EXPECT_EDITOR_VERSION) {
          const expected = process.env.VUA_TEST_EXPECT_EDITOR_VERSION;
          assert(await js(`[...document.querySelectorAll('#route-unity2022-details .vua-deployment ol li')].some(item=>item.textContent.includes(${JSON.stringify(expected)}) && item.textContent.includes('保留'))`), "The existing Editor's full version is reused on first entry without installation");
          await capture('unity-first-entry');
        }
      }
      await js(`document.querySelector('[data-nav-id="${button}"]').click()`);
      assert(await js(`document.querySelector('[data-nav-id="${button}"]').getAttribute('aria-expanded')==='false'`), `${button} collapses inline`);
    }
    await js('document.querySelector(".vua-creator-page").scrollTop=0; document.querySelector("main").scrollTop=0');
    await capture("create-dark");
    await js('document.querySelector("[data-nav-id=nav-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-hardware-help]")'), "Play return");
    await js('document.querySelector("[data-nav-id=play-hardware-help]").click()');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.textContent==="硬件介绍"'), "Hardware introduction in Help");
    assert(BrowserWindow.getAllWindows().length === 1, "Hardware help opens inside the main window");
    assert(await js('document.querySelector("[data-nav-id=shell-help]").getAttribute("aria-current")==="page" && !!document.querySelector("[data-guide-section=identify-device]")'), "Encyclopedia keeps Help selected and targets hardware");
    await capture("hardware-dark");
    assert(await chapterContrast() >= 4.5, "Selected chapter text is legible in dark appearance");
    await js('const unsubscribe = window.vua.window.encyclopediaTargetEvents.subscribe(()=>{}); unsubscribe(); unsubscribe()');
    await js('window.vua.window.showEncyclopedia({topic:"guide-devices",section:"pico-wifi"})');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.getAttribute("id").includes("guide-devices")'), "Contextual chapter navigation");
    await waitFor(() => js('localStorage.getItem("vua-guide-reading")?.includes("pico-wifi")'), "Targeted section saved");
    await waitFor(() => js('document.querySelector("[data-guide-section=pico-wifi]").getBoundingClientRect().top >= document.querySelector(".vua-overlay-guide__topics").getBoundingClientRect().bottom-2'), "Target heading remains below the sticky chapter selector");
    assert(true, "Targeted chapter headings are readable below the sticky navigation");
    assert(BrowserWindow.getAllWindows().length === 1, "Repeated contextual requests never create a reader window");
    await js('document.querySelector("[data-nav-id=help-child-back]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "Help landing");
    assert(await js('document.querySelector("[data-nav-id=help-wizard]").textContent.includes("入门引导") && document.querySelector("[data-nav-id=help-encyclopedia]").textContent.includes("知识百科") && document.querySelector("[data-nav-id=help-game-assistant]").textContent.includes("游戏内助手")'), "Help names match the current ruling");
    const side = command => window.emit('app-command', {}, command);
    for (const child of ['help-wizard','help-tour','help-game-assistant','help-encyclopedia']) {
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
        await js('[...document.querySelectorAll(".vua-onboarding .vua-route-tile")][0].click()');
        await waitFor(() => js('document.querySelector(".vua-onboarding").dataset.wizardStep==="play-mode"'), "Wizard choice");
        side('browser-backward');
        await waitFor(() => js('document.querySelector(".vua-onboarding").dataset.wizardStep==="goal"'), "Wizard step Back");
        side('browser-forward');
        await waitFor(() => js('document.querySelector(".vua-onboarding").dataset.wizardStep==="play-mode"'), "Wizard step Forward");
        assert(true, "Wizard choices also support mouse Back and Forward");
      }
      await js('document.querySelector("[data-nav-id=help-child-back]").click()');
      await waitFor(() => js('!!document.querySelector("[data-nav-id=help-encyclopedia]")'), "Help return");
    }
    await js('document.querySelector("[data-nav-id=help-encyclopedia]").click()');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.getAttribute("id").includes("guide-devices")'), "Reading position survives page return");
    await js('document.querySelector("#guide-overlay-tab-guide-hardware").click()');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-hardware")'), "Chapter choice");
    side('browser-backward');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-devices")'), "Chapter Back");
    side('browser-forward');
    await waitFor(() => js('document.querySelector("[role=tab][aria-selected=true]")?.id.includes("guide-hardware")'), "Chapter Forward");
    assert(true, "Knowledge chapters support mouse Back and Forward");
    await js('document.querySelector("[data-nav-id=shell-settings]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-settings-theme]")'), "Settings navigation");
    assert(await js('!["nav-settings-goals","nav-settings-language","nav-settings-version","nav-settings-donate"].some(id=>document.querySelector(`[data-nav-id=${id}]`))'), "Retired Settings pages, including goal reselection, are absent");
    assert(await languageFooterFits(), "A compact language selector with translation glyph sits above Search without overlap");
    window.setSize(960, 600);
    await delay(100);
    assert(await languageFooterFits(), "Language and Search remain separate in a short window");
    await capture('settings-small');
    window.setSize(1180, 820);
    await delay(100);
    assert(await js('!document.querySelector(".vua-shell").hasAttribute("data-display-mode") && document.querySelectorAll(".vua-theme-choice__button").length===3 && !document.querySelector("main").textContent.includes("大屏幕模式")'), "Theme keeps appearance controls and has no retired layout mode");
    await js('document.querySelector("[data-nav-id=nav-settings-about]").click()');
    await waitFor(() => js('!!document.querySelector("[data-version-details]")'), "About version controls");
    assert(await js('!!document.querySelector("[data-version-details] [data-nav-id=about-check-updates]")'), "About contains the existing version and update controls");
    await capture("about-dark");
    await js('document.querySelector("[data-nav-id=nav-settings-theme]").click()');
    await js('document.querySelector(".vua-theme-choice button:nth-of-type(2)").click()');
    await js('document.querySelector("[data-nav-id=shell-back]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-knowledge") && document.documentElement.dataset.theme==="light"'), "Knowledge follows light appearance and Settings return");
    await capture("knowledge-light");
    assert(await chapterContrast() >= 4.5, "Selected chapter text is legible in light appearance");
    await js('document.querySelector("[data-nav-id=nav-enable-amf]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=toggle-amf]")'), "AMF switch");
    await js('document.querySelector("[data-nav-id=toggle-amf]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=open-amf]") && !!document.querySelector(".vua-shell__sidebar [data-module=production]")'), "Explicit AMF enablement");
    // Provider readiness precedes the IPC reply while Main initializes the AMF shell.
    // A real user can toggle again only after this control becomes enabled.
    await waitFor(() => js('document.querySelector("[data-nav-id=toggle-amf]")?.disabled===false'), "AMF enablement control released");
    assert(await js('document.querySelector("[data-nav-id=toggle-amf]").checked && !document.querySelector("[data-nav-id=nav-enable-amf]")'), "AMF activation exposes its own sidebar without navigating away");
    await js('document.querySelector("[data-nav-id=logo-home]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=home-release]")'), "AMF Home directory");
    assert(await js('!document.querySelector("[data-nav-id=home-inspection]") && document.querySelector("[data-nav-id=home-release]").textContent.includes("成品") && document.querySelector("[data-nav-id=home-packages]").textContent.includes("包管理器")'), "Finished Avatars and Package Manager replace the Inspection Home card");
    await js('document.querySelector("[data-nav-id=home-release]").click()');
    await waitFor(() => js('location.hash==="#release" && !!document.querySelector("main h1")'), "Finished Avatars destination");
    await js('document.querySelector("[data-nav-id=logo-home]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=home-packages]")'), "AMF Home return");
    await js('document.querySelector("[data-nav-id=home-packages]").click()');
    await waitFor(() => js('location.hash==="#packages" && !!document.querySelector("main h1")'), "Package Manager destination");
    assert(true, "Both new AMF Home cards open their existing functional pages");
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
    assert(await js('document.querySelector("[data-nav-id=warehouse-sync]").disabled && document.querySelector("[data-nav-id=warehouse-sync]").textContent.includes("正在检测")'), "Warehouse does not offer sync while authentication is being checked");
    resolveAccountProbe({ authOk: false, accountName: null });
    await waitFor(() => js('document.querySelector("[data-nav-id=warehouse-sync]")?.textContent.includes("打开登录页")'), "Login required before sync");
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
    assert(await js('!document.querySelector(".vua-shell__sidebar [data-module=production]")'), "Disabling AMF removes the Avatar sidebar and restores its enablement entry");
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
    await waitFor(() => js('!!document.querySelector(".vua-help-child .vua-onboarding") && !document.querySelector(".vua-shell__sidebar--settings")'), "Retired goal destination migration");
    assert(true, "Old goal-reselection links open Help's getting-started wizard");
    await js('document.querySelector("[data-nav-id=nav-env-play]").click()');
    await waitFor(() => js('!!document.querySelector("[data-nav-id=play-hardware-help]")'), "Ordinary Play after migration");
    assert(await js('[...document.querySelectorAll(".vua-play-page .vua-environment-card")].every(c=>Math.abs(c.getBoundingClientRect().height-88)<1)'), "Retired preferences never enlarge Play cards");
    assert(errors.length === 0, `Renderer errors: ${errors.join("; ")}`);
    fs.writeFileSync(path.join(output, "checks.json"), JSON.stringify({ checks, scope: "Controlled application navigation/layout only; no hardware, vendor or human-language acceptance" }, null, 2));
    console.log(JSON.stringify({ passed: checks.length, evidence: output }));
    exitCode = 0;
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) {
      fs.writeFileSync(path.join(output, "failure.png"), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
      const dom = await window.webContents.executeJavaScript('({hash:location.hash, heading:document.querySelector("main h1")?.textContent, wizard:document.querySelector(".vua-onboarding")?.dataset.wizardStep, amfSwitch:document.querySelector("[data-nav-id=toggle-amf]")?{checked:document.querySelector("[data-nav-id=toggle-amf]").checked,disabled:document.querySelector("[data-nav-id=toggle-amf]").disabled}:null, status:[...document.querySelectorAll("[data-amf-setup] [role=status]")].map(e=>e.textContent)})');
      fs.writeFileSync(path.join(output, "navigation.json"), JSON.stringify({ index: window.webContents.navigationHistory.getActiveIndex(), entries: window.webContents.navigationHistory.getAllEntries(), dom }, null, 2));
      console.error(JSON.stringify(dom));
      console.error(JSON.stringify({ evidence: output, rendererErrors: errors }));
    }
  } finally { clearTimeout(deadline); app.quit(); }
}
void run();

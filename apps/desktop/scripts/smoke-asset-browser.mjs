// Real Main, preload, renderer and providers; fixed HTTPS fixtures in disposable sessions.
// Public-site checks are opt-in and never perform login, purchase or downloads.
import { app, BrowserWindow, session } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "vua-asset-browser-"));
const home = path.join(output, "home"), profile = path.join(output, "profile");
for (const directory of [home, profile, path.join(home, "AppData", "Roaming"), path.join(home, "AppData", "Local"), path.join(profile, "modules")]) fs.mkdirSync(directory, { recursive: true });
app.setPath("home", home);
app.setPath("appData", path.join(home, "AppData", "Roaming"));
app.setPath("userData", profile);
process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
process.env.VUA_DEV_USER_DATA = profile;
fs.writeFileSync(path.join(profile, "modules", "amf.json"), JSON.stringify({ schemaVersion: "0.1", enabled: false, dataLayout: "isolated" }));
process.env.VUA_PROVIDER_EXECUTABLE = process.env.VUA_TEST_HOST_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-orchestrator-provider.exe");
process.env.VUA_AMF_EXECUTABLE = process.env.VUA_TEST_AMF_EXECUTABLE ?? path.resolve(desktop, "../../target/release/vua-amf-provider.exe");
delete process.env.VUA_RENDERER_URL;
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.focus = function () {};
const checks = [], publicSites = [], errors = [];
let window, exitCode = 1;
app.on("browser-window-created", (_event, created) => {
  created.webContents.setBackgroundThrottling(false);
  created.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
});
app.on("will-quit", () => { if (exitCode) app.exit(exitCode); });
const deadline = setTimeout(() => { console.error("Browser smoke deadline exceeded", output); app.exit(1); }, 180_000);
const assert = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
async function waitFor(predicate, label, limit = 12_000) {
  const start = Date.now();
  while (Date.now() - start < limit) { if (await predicate()) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
const fixtures = ["vua-knowledge", "persist:vua-remote"];
async function main() {
  try {
    createRequire(import.meta.url)(path.join(desktop, "dist/packaged-electron/main.js"));
    await app.whenReady();
    for (const partition of fixtures) await session.fromPartition(partition).protocol.handle("https", request => {
      const url = new URL(request.url);
      if (url.hostname === "vrc-style.com") return Response.error();
      const label = url.hostname.replace(/[^\w.-]/g, "");
      return new Response(`<!doctype html><html><head><title>${label} ${url.pathname}</title><style>body{font:20px system-ui;padding:24px;min-height:2400px;background:#fafafa;color:#17142e}a{display:block;margin:20px 0}</style></head><body><h1>${label}</h1><a id="next" href="/second">Next page</a><a id="new-tab" href="/child" target="_blank">New tab</a><a id="outside" href="https://example.test/">Outside shortcut list</a><textarea id="note"></textarea><p>Isolated browser smoke fixture; no real account or material data.</p></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    });
    await waitFor(() => {
      window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith("file:") && !candidate.webContents.getURL().includes("surface="));
      return window && !window.webContents.isLoading();
    }, "production renderer");
    // A failing script names itself, so a CI failure points at its step.
    const js = source => window.webContents.executeJavaScript(source, true)
      .catch(error => { throw new Error(`VUA page script failed: ${source.slice(0, 100)}`, { cause: error }); });
    const remoteViews = () => window.contentView.children.filter(view => view.webContents && view.webContents !== window.webContents);
    const activeView = () => remoteViews().find(view => view.getVisible());
    const inView = source => activeView().webContents.executeJavaScript(source, true)
      .catch(error => { throw new Error(`Website script failed: ${source.slice(0, 100)}`, { cause: error }); });
    const viewHas = selector => waitFor(() => activeView()?.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
    // VUA controls re-render around navigation; a control is clicked once it is present again.
    const clickShell = async selector => {
      await waitFor(() => js(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    };
    // A website link is clicked once its page has rendered it; the URL changes before the DOM is ready.
    const clickInPage = async selector => {
      await waitFor(() => activeView()?.webContents.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
      await activeView().webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`, true);
    };
    const click = async id => {
      await waitFor(() => js(`!!document.querySelector('[data-nav-id="${id}"]')`), id);
      await js(`document.querySelector('[data-nav-id="${id}"]').click()`);
    };
    const frameFits = async () => {
      const native = activeView();
      if (!native) return false;
      const rect = native.getBounds(), zoom = window.webContents.getZoomFactor();
      const layout = await js(`(()=>{ const m=document.querySelector('.vua-shell__main').getBoundingClientRect(), f=document.querySelector('.vua-browser-frame:not([hidden])').getBoundingClientRect(), v=document.querySelector('.vua-browser-frame:not([hidden]) .vua-browser-frame__viewport').getBoundingClientRect(), s=document.querySelector('.vua-shell__sidebar'),h=document.querySelector('.vua-shell__header'); return {x:v.x,y:v.y,width:v.width,height:v.height,mx:m.x,my:m.y,frameFitsMain:['left','top','right','bottom'].every(k=>Math.abs(m[k]-f[k])<1.5),windowWidth:innerWidth,windowHeight:innerHeight,shellActive:!s.inert&&!h.inert&&!s.closest('[inert]')&&!h.closest('[inert]'),overflow:document.querySelector('.vua-browser-frame:not([hidden])').scrollWidth>document.querySelector('.vua-browser-frame:not([hidden])').clientWidth+1};})()`);
      const content = window.getContentBounds();
      return layout.shellActive && layout.frameFitsMain && Math.abs(layout.windowWidth * zoom - content.width) <= 1.5 && Math.abs(layout.windowHeight * zoom - content.height) <= 1.5 && !layout.overflow && rect.x >= layout.mx * zoom - 1 && rect.y >= layout.my * zoom - 1
        && ["x", "y", "width", "height"].every(key => Math.abs(rect[key] - layout[key] * zoom) <= 1.5);
    };
    await waitFor(() => js('document.querySelector(".vua-tour")?.dataset.tourStep==="welcome"'), "welcome");
    await clickShell(".vua-tour__actions button");
    await waitFor(() => js('!!document.querySelector(".vua-onboarding") && !document.querySelector(".vua-boot-splash")'), "first use");
    await clickShell(".vua-journey-top button");
    await click("shell-help"); await click("help-encyclopedia"); await click("knowledge-wiki");
    await waitFor(() => activeView()?.webContents.getURL() === "https://wiki.vrchat.com/", "Wiki native page");
    await waitFor(frameFits, "Wiki fits content");
    assert(await frameFits(), "Wiki opens with AMF off and leaves header/sidebar interactive");
    assert(!fs.existsSync(path.join(profile, "modules", "amf", "data")), "Host Wiki does not initialize material storage");
    assert(Object.values(await activeView().webContents.executeJavaScript('({vua:typeof window.vua,node:typeof require,process:typeof process})')).every(value => value === "undefined"), "Remote Wiki has no VUA, Node or process capability");
    await clickInPage("#outside");
    await waitFor(() => js('!!document.querySelector(".vua-nav-confirm__backdrop")'), "navigation prompt");
    assert(remoteViews().every(view => !view.getVisible()), "Native pages yield to local navigation confirmation");
    await clickShell(".vua-nav-confirm__actions button");
    await waitFor(frameFits, "Wiki after cancellation");
    assert(activeView().webContents.getURL() === "https://wiki.vrchat.com/", "Cancel preserves the current Wiki page");
    await click("shell-settings");
    await waitFor(() => remoteViews().every(view => !view.getVisible()), "Wiki hidden under Settings");
    assert(true, "Settings temporarily hides Wiki without leaving an uncontrollable native view");
    await click("shell-back"); await waitFor(frameFits, "Wiki returns from Settings");
    const wikiContents = activeView().webContents.id;
    await clickInPage("#next");
    await waitFor(() => activeView()?.webContents.getURL().endsWith("/second"), "Wiki child page");
    await click("shell-help"); await waitFor(() => remoteViews().every(view => !view.getVisible()), "Wiki hidden after leaving knowledge");
    assert(remoteViews().length === 1, "Leaving knowledge retains its hidden native page");
    await click("help-encyclopedia"); await click("knowledge-wiki"); await waitFor(frameFits, "Wiki session return");
    assert(activeView().webContents.id === wikiContents && activeView().webContents.getURL().endsWith("/second"), "Wiki returns to the same page and native history");
    const closedWikiId = await js('document.body.dataset.vuaBrowserView');
    await clickShell(".vua-browser-frame__bar button:last-child");
    await waitFor(() => remoteViews().length === 0, "explicit Wiki close");
    await js(`window.vua.desktopBrowser.setViewport(${JSON.stringify(closedWikiId)},{x:180,y:100,width:800,height:600})`);
    assert(remoteViews().length === 0, "Late layout receipts do not revive a disposed browser");
    const reject = await js(`Promise.all([window.vua.desktopBrowser.open('booth'),window.vua.desktopBrowser.open('https://booth.pm/')].map(p=>p.then(()=>false,()=>true)))`);
    assert(reject.every(Boolean), "AMF-off assets and arbitrary site strings are rejected by Main");
    await click("nav-enable-amf"); await click("toggle-amf");
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-warehouse]") && document.querySelector("[data-nav-id=toggle-amf]")?.disabled===false'), "AMF mounted");
    await click("nav-warehouse"); await waitFor(() => js('!!document.querySelector("[data-nav-id=tab-asset-browser]")'), "materials room tabs"); await click("tab-asset-browser");
    await waitFor(() => activeView()?.webContents.getURL() === "https://booth.pm/", "default BOOTH");
    await waitFor(frameFits, "BOOTH fits");
    assert(await js('document.querySelectorAll("[data-browser-site]").length===9'), "AMF material browser includes all nine requested shortcuts");
    const sites = await js('[...document.querySelectorAll("[data-browser-site]")].map(e=>({id:e.dataset.browserSite,url:e.title}))');
    for (const site of sites.filter(site => site.id !== "vrc-style")) {
      await clickShell(`[data-browser-site="${site.id}"]`);
      await waitFor(() => activeView()?.webContents.getURL() === site.url && !activeView()?.webContents.isLoading(), site.id);
      assert(true, `${site.id} loads in the same isolated view`);
    }
    assert(remoteViews().length === 1, "Shortcut changes reuse a single native view");
    await activeView().webContents.executeJavaScript('location.href="https://accounts.booth.pm/login?code=private-fixture#token=private-fixture";true', true);
    await waitFor(() => js('document.querySelector(".vua-browser-frame__bar .vua-import__browse-url")?.title==="https://accounts.booth.pm/login"'), "display-only URL");
    assert(true, "Candidate browser metadata omits account URL query and fragment secrets");
    assert(await js('document.querySelector("[data-browser-site=booth]")?.getAttribute("aria-current")==="true"'), "Account navigation selects BOOTH rather than the previous shortcut");
    await clickShell("[data-browser-site=vrc-db]");
    await waitFor(() => activeView()?.webContents.getURL() === "https://vrc-db.com/", "history site reset");
    await clickInPage("#next");
    await waitFor(() => activeView()?.webContents.getURL().endsWith("/second"), "site history");
    await waitFor(() => js('document.querySelector(".vua-browser-frame__bar button:nth-child(1)")?.disabled===false'), "Back enabled");
    await clickShell(".vua-browser-frame__bar button:nth-child(1)");
    await waitFor(() => activeView()?.webContents.getURL() === "https://vrc-db.com/", "browser Back");
    await clickShell(".vua-browser-frame__bar button:nth-child(2)");
    await waitFor(() => activeView()?.webContents.getURL().endsWith("/second"), "browser Forward");
    assert(true, "Browser Back and Forward use website history");
    await clickShell("[data-browser-site=vrc-style]");
    await waitFor(async () => (await js('!!document.querySelector(".vua-browser-frame__error")')) && remoteViews().every(view => !view.getVisible()), "honest load failure");
    assert(true, "Failed site shows a reachable retry instead of a blank native page");
    await clickShell("[data-browser-site=booth]");
    await waitFor(() => activeView()?.webContents.getURL() === "https://booth.pm/", "recover using another site");
    await clickInPage("#next");
    await waitFor(() => activeView()?.webContents.getURL().endsWith("/second"), "material child page");
    const originalContents = activeView().webContents.id;
    await waitFor(() => js('!!document.querySelector("[data-browser-tab][aria-selected=true]")'), "selected material tab");
    const originalTab = await js('document.querySelector("[data-browser-tab][aria-selected=true]").dataset.browserTab');
    await viewHas("#note");
    await inView('document.querySelector("#note").value="retained draft";window.scrollTo(0,420);true');
    await click("nav-env-play"); await waitFor(() => remoteViews().every(view => !view.getVisible()), "material browser hidden on another route");
    assert(remoteViews().length === 1, "Another shell route retains the material native view");
    await click("nav-warehouse"); await waitFor(() => js('!!document.querySelector("[data-nav-id=tab-asset-browser]")'), "materials room tabs"); await click("tab-asset-browser"); await waitFor(frameFits, "material route return");
    await viewHas("#note");
    const remembered = await inView('({note:document.querySelector("#note").value,scroll:window.scrollY})');
    assert(activeView().webContents.id === originalContents && activeView().webContents.getURL().endsWith("/second") && remembered.note === "retained draft" && remembered.scroll === 420,
      "Returning retains URL, history, form draft and scroll without reloading BOOTH");
    await clickShell("[data-browser-new-tab]");
    await waitFor(() => remoteViews().length === 2 && activeView()?.webContents.getURL() === "https://booth.pm/", "new material tab");
    await waitFor(frameFits, "new tab geometry");
    assert(activeView().webContents.id !== originalContents && remoteViews().filter(view => view.getVisible()).length === 1, "Each tab has an independent native page and only one is visible");
    await clickInPage("#new-tab");
    await waitFor(() => remoteViews().length === 3 && activeView()?.webContents.getURL().endsWith("/child"), "website link opens local child tab");
    assert(await js('document.querySelectorAll("[data-browser-tab]").length===3'), "Allowed website popup becomes a VUA tab");
    await waitFor(() => js('!!document.querySelector("[data-browser-site=vrcfinder]")'), "vrcfinder shortcut");
    await js('document.querySelector("[data-browser-site=vrcfinder]").dispatchEvent(new MouseEvent("click",{bubbles:true,ctrlKey:true}))');
    await waitFor(() => remoteViews().length === 4 && activeView()?.webContents.getURL() === "https://vrcfinder.net/", "shortcut opens new tab");
    assert(true, "Ctrl shortcut opens a separate tab without replacing the previous page");
    await clickShell(`[data-browser-tab="${originalTab}"]`);
    await waitFor(() => activeView()?.webContents.id === originalContents, "original tab activation");
    await viewHas("#note");
    assert((await inView('document.querySelector("#note").value')) === "retained draft", "Tab switching preserves the original form");
    while (await js('document.querySelectorAll("[data-browser-tab]").length<8')) {
      const count = remoteViews().length;
      await clickShell("[data-browser-new-tab]");
      await waitFor(() => remoteViews().length === count + 1 && activeView()?.webContents.getURL() === "https://booth.pm/", "tab limit preparation");
    }
    await waitFor(() => js('document.querySelector("[data-browser-new-tab]").disabled'), "tab limit visible");
    await waitFor(frameFits, "eight tabs geometry");
    await clickInPage("#new-tab");
    await delay(150);
    assert(remoteViews().length === 8 && (await js('document.querySelectorAll("[data-browser-tab]").length')) === 8, "Both Main and Renderer cap retained tabs at eight");
    const extraTabs = await js(`[...document.querySelectorAll('[data-browser-close-tab]')].map(button=>button.dataset.browserCloseTab).filter(id=>id!==${JSON.stringify(originalTab)})`);
    for (const id of extraTabs) await clickShell(`[data-browser-close-tab="${id}"]`);
    await waitFor(() => remoteViews().length === 1 && activeView()?.webContents.id === originalContents, "extra tabs closed");
    assert(true, "Closing other tabs leaves the original page and history intact");
    for (const locale of ["en", "zh-CN", "ja", "ko"]) {
      await js(`localStorage.setItem('vua-locale','${locale}');location.reload()`);
      await waitFor(() => js(`document.documentElement.lang==='${locale}' && !!document.querySelector('[data-nav-id=nav-warehouse]') && !document.querySelector('.vua-boot-splash')`), locale);
      await click("nav-warehouse"); await waitFor(() => js('!!document.querySelector("[data-nav-id=tab-asset-browser]")'), "materials room tabs"); await click("tab-asset-browser"); await waitFor(frameFits, `${locale} viewport`);
      for (const [width, height, zoom] of [[1280, 850, 1], [960, 600, 1.25], [760, 560, 1]]) {
        window.setSize(width, height); window.webContents.setZoomFactor(zoom);
        await waitFor(frameFits, `${locale} at ${width} / ${zoom}`);
        assert(true, `${locale} content fits at ${width}×${height}, zoom ${zoom}`);
      }
      window.setSize(1280, 850); window.webContents.setZoomFactor(1);
      await waitFor(frameFits, "reset viewport");
      await js('document.fonts.ready.then(()=>true)');
      const [captureWidth, captureHeight] = window.getSize();
      window.setSize(captureWidth + 1, captureHeight); await delay(50); window.setSize(captureWidth, captureHeight);
      await waitFor(frameFits, "capture viewport");
      await window.webContents.capturePage(); await delay(400);
      await js('document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).forEach(a=>a.finish())');
      await delay(100);
      fs.writeFileSync(path.join(output, `assets-${locale}.png`), (await window.webContents.capturePage()).toPNG());
    }
    await click("shell-settings");
    await waitFor(() => remoteViews().every(view => !view.getVisible()), "asset hide");
    await click("shell-back"); await waitFor(frameFits, "asset return");
    assert(true, "Settings return restores the material browser and its shortcuts");
    await clickShell(".vua-browser-frame__bar button:last-child");
    await waitFor(() => remoteViews().length === 0, "browser close");
    assert(await js('!!document.querySelector("main .vua-button")'), "Closing material browser offers reopening BOOTH");

    // Retained login flow now shares the inset geometry and closes on shell navigation.
    await click("shell-settings"); await click("nav-settings-accounts");
    await waitFor(() => js('!!document.querySelector("[data-nav-id=accounts-booth-login]")'), "BOOTH login button");
    await click("accounts-booth-login"); await waitFor(frameFits, "login inset");
    assert(true, "Retained BOOTH login also leaves shell chrome visible and interactive");
    await click("nav-settings-theme"); await waitFor(() => remoteViews().length === 0, "login close on navigation");
    assert(true, "Leaving the login page disposes its view");
    await click("logo-home"); await click("nav-warehouse"); await click("warehouse-import");
    await waitFor(() => js('!!document.querySelector(".vua-folder-picker")'), "direct local folder picker");
    assert(await js('!document.querySelector("[data-nav-id=import-cloud]")') && remoteViews().length === 0,
      "Local import opens its folder picker directly without the retired source choice or a remote page");
    await clickShell(".vua-folder-picker__close");
    await waitFor(() => js('!document.querySelector(".vua-content-dialog") && !document.querySelector(".vua-folder-picker")'), "initial folder selection cancelled");
    assert(true, "Cancelling the initial folder selection closes the local import dialog");
    await click("shell-settings");
    await waitFor(async () => (await js('!document.querySelector(".vua-content-dialog")')) && remoteViews().length === 0, "import leave");
    assert(true, "Settings remains available after cancelling local import");
    await click("shell-back");
    assert(await js('!document.querySelector(".vua-content-dialog")'), "Returning to the library does not reopen a stale import modal");
    if (process.env.VUA_SMOKE_PUBLIC_BROWSER === "1") {
      for (const partition of fixtures) session.fromPartition(partition).protocol.unhandle("https");
      for (const site of [...sites, { id: "vrchat-wiki", url: "https://wiki.vrchat.com/" }]) {
        const state = await js(`window.vua.desktopBrowser.open('${site.id}')`);
        const view = remoteViews().find(view => view.webContents.getURL() === site.url) ?? remoteViews().at(-1);
        await delay(100);
        await Promise.race([waitFor(() => !view.webContents.isLoading(), site.id, 8000).catch(() => {}), delay(8000)]);
        publicSites.push({ site: site.id, url: view.webContents.getURL(), loading: view.webContents.isLoading() });
        await js(`window.vua.desktopBrowser.close('${state.viewId}')`);
      }
    }
    fs.writeFileSync(path.join(output, "evidence.json"), JSON.stringify({ scope: "Real Main/preload/renderer/providers, synthetic public pages, no account/material/device acceptance", checks, publicSites, errors }, null, 2));
    exitCode = 0;
    console.log(JSON.stringify({ passed: checks.length, publicSites, output }));
    clearTimeout(deadline); app.quit();
  } catch (error) {
    console.error(error.stack ?? String(error));
    const views = window && !window.isDestroyed() ? window.contentView.children.filter(view => view.webContents && view.webContents !== window.webContents).map(view => ({ url: view.webContents.getURL(), visible: view.getVisible(), history: view.webContents.navigationHistory.getAllEntries() })) : [];
    fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({ error: error.stack, checks, errors, views }, null, 2));
    console.error(output); clearTimeout(deadline); app.quit();
  }
}
void main();

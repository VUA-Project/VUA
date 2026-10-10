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
      return new Response(`<!doctype html><html><head><title>${label}</title><style>body{font:20px system-ui;padding:24px;background:#fafafa;color:#17142e}a{display:block;margin:20px 0}</style></head><body><h1>${label}</h1><a id="next" href="/second">Next page</a><a id="outside" href="https://example.test/">Outside shortcut list</a><p>Isolated browser smoke fixture; no real account or material data.</p></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    });
    await waitFor(() => {
      window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().startsWith("file:") && !candidate.webContents.getURL().includes("surface="));
      return window && !window.webContents.isLoading();
    }, "production renderer");
    const js = source => window.webContents.executeJavaScript(source, true);
    const remoteViews = () => window.contentView.children.filter(view => view.webContents && view.webContents !== window.webContents);
    const activeView = () => remoteViews().find(view => view.getVisible());
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
    await js('document.querySelector(".vua-tour__actions button").click()');
    await waitFor(() => js('!!document.querySelector(".vua-onboarding") && !document.querySelector(".vua-boot-splash")'), "first use");
    await js('document.querySelector(".vua-journey-top button").click()');
    await click("shell-help"); await click("help-encyclopedia"); await click("knowledge-wiki");
    await waitFor(() => activeView()?.webContents.getURL() === "https://wiki.vrchat.com/", "Wiki native page");
    await waitFor(frameFits, "Wiki fits content");
    assert(await frameFits(), "Wiki opens with AMF off and leaves header/sidebar interactive");
    assert(!fs.existsSync(path.join(profile, "modules", "amf", "data")), "Host Wiki does not initialize material storage");
    assert(Object.values(await activeView().webContents.executeJavaScript('({vua:typeof window.vua,node:typeof require,process:typeof process})')).every(value => value === "undefined"), "Remote Wiki has no VUA, Node or process capability");
    await activeView().webContents.executeJavaScript('document.querySelector("#outside").click()');
    await waitFor(() => js('!!document.querySelector(".vua-nav-confirm__backdrop")'), "navigation prompt");
    assert(remoteViews().every(view => !view.getVisible()), "Native pages yield to local navigation confirmation");
    await js('document.querySelector(".vua-nav-confirm__actions button").click()');
    await waitFor(frameFits, "Wiki after cancellation");
    assert(activeView().webContents.getURL() === "https://wiki.vrchat.com/", "Cancel preserves the current Wiki page");
    await click("shell-settings");
    await waitFor(() => remoteViews().every(view => !view.getVisible()), "Wiki hidden under Settings");
    assert(true, "Settings temporarily hides Wiki without leaving an uncontrollable native view");
    await click("shell-back"); await waitFor(frameFits, "Wiki returns from Settings");
    const closedWikiId = await js('document.body.dataset.vuaBrowserView');
    await click("shell-help"); await waitFor(() => remoteViews().length === 0, "Wiki teardown");
    assert(true, "Leaving knowledge closes its native browser");
    await js(`window.vua.desktopBrowser.setViewport(${JSON.stringify(closedWikiId)},{x:180,y:100,width:800,height:600})`);
    assert(remoteViews().length === 0, "Late layout receipts do not revive a disposed browser");
    const reject = await js(`Promise.all([window.vua.desktopBrowser.open('booth'),window.vua.desktopBrowser.open('https://booth.pm/')].map(p=>p.then(()=>false,()=>true)))`);
    assert(reject.every(Boolean), "AMF-off assets and arbitrary site strings are rejected by Main");
    await click("nav-enable-amf"); await click("toggle-amf");
    await waitFor(() => js('!!document.querySelector("[data-nav-id=nav-asset-browser]") && document.querySelector("[data-nav-id=toggle-amf]")?.disabled===false'), "AMF mounted");
    await click("nav-asset-browser");
    await waitFor(() => activeView()?.webContents.getURL() === "https://booth.pm/", "default BOOTH");
    await waitFor(frameFits, "BOOTH fits");
    assert(await js('document.querySelectorAll("[data-browser-site]").length===9'), "AMF material browser includes all nine requested shortcuts");
    const sites = await js('[...document.querySelectorAll("[data-browser-site]")].map(e=>({id:e.dataset.browserSite,url:e.title}))');
    for (const site of sites.filter(site => site.id !== "vrc-style")) {
      await js(`document.querySelector('[data-browser-site="${site.id}"]').click()`);
      await waitFor(() => activeView()?.webContents.getURL() === site.url && !activeView()?.webContents.isLoading(), site.id);
      assert(true, `${site.id} loads in the same isolated view`);
    }
    assert(remoteViews().length === 1, "Shortcut changes reuse a single native view");
    await activeView().webContents.executeJavaScript('location.href="https://accounts.booth.pm/login?code=private-fixture#token=private-fixture";true', true);
    await waitFor(() => js('document.querySelector(".vua-browser-frame__bar .vua-import__browse-url")?.title==="https://accounts.booth.pm/login"'), "display-only URL");
    assert(true, "Candidate browser metadata omits account URL query and fragment secrets");
    assert(await js('document.querySelector("[data-browser-site=booth]")?.getAttribute("aria-current")==="true"'), "Account navigation selects BOOTH rather than the previous shortcut");
    await js('document.querySelector("[data-browser-site=vrc-db]").click()');
    await waitFor(() => activeView()?.webContents.getURL() === "https://vrc-db.com/", "history site reset");
    await activeView().webContents.executeJavaScript('document.querySelector("#next").click()', true);
    await waitFor(() => activeView()?.webContents.getURL().endsWith("/second"), "site history");
    await waitFor(() => js('document.querySelector(".vua-browser-frame__bar button:nth-child(1)")?.disabled===false'), "Back enabled");
    await js('document.querySelector(".vua-browser-frame__bar button:nth-child(1)").click()');
    await waitFor(() => activeView()?.webContents.getURL() === "https://vrc-db.com/", "browser Back");
    await js('document.querySelector(".vua-browser-frame__bar button:nth-child(2)").click()');
    await waitFor(() => activeView()?.webContents.getURL().endsWith("/second"), "browser Forward");
    assert(true, "Browser Back and Forward use website history");
    await js('document.querySelector("[data-browser-site=vrc-style]").click()');
    await waitFor(() => js('!!document.querySelector(".vua-browser-frame__error")') && remoteViews().every(view => !view.getVisible()), "honest load failure");
    assert(true, "Failed site shows a reachable retry instead of a blank native page");
    await js('document.querySelector("[data-browser-site=booth]").click()');
    await waitFor(() => activeView()?.webContents.getURL() === "https://booth.pm/", "recover using another site");
    for (const locale of ["en", "zh-CN", "ja", "ko"]) {
      await js(`localStorage.setItem('vua-locale','${locale}');location.reload()`);
      await waitFor(() => js(`document.documentElement.lang==='${locale}' && !!document.querySelector('[data-nav-id=nav-asset-browser]') && !document.querySelector('.vua-boot-splash')`), locale);
      await click("nav-asset-browser"); await waitFor(frameFits, `${locale} viewport`);
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
    await js('document.querySelector(".vua-browser-frame__bar button:last-child").click()');
    await waitFor(() => remoteViews().length === 0, "browser close");
    assert(await js('!!document.querySelector("main .vua-button")'), "Closing material browser offers reopening BOOTH");

    // Retained login flow now shares the inset geometry and closes on shell navigation.
    await click("shell-settings"); await click("nav-settings-accounts");
    await waitFor(() => js('!!document.querySelector("[data-nav-id=accounts-booth-login]")'), "BOOTH login button");
    await click("accounts-booth-login"); await waitFor(frameFits, "login inset");
    assert(true, "Retained BOOTH login also leaves shell chrome visible and interactive");
    await click("nav-settings-theme"); await waitFor(() => remoteViews().length === 0, "login close on navigation");
    assert(true, "Leaving the login page disposes its view");
    await click("logo-home"); await click("nav-warehouse"); await click("warehouse-import"); await click("import-cloud");
    await waitFor(frameFits, "import browser inset and modal navigation");
    assert(true, "BOOTH import leaves shell chrome usable despite the surrounding modal");
    await click("shell-settings");
    await waitFor(() => js('!document.querySelector(".vua-content-dialog")') && remoteViews().length === 0, "import leave");
    assert(true, "Leaving import closes its browser and modal before Settings");
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

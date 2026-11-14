// Actual Chromium geometry with isolated synthetic ports; no native software is launched.
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { FIXTURES } from "./design-audit/views.mjs";
// Destroying the last window must not end the run before a failure's exit code is set.
app.on("window-all-closed", () => {});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(os.tmpdir(), "vua-layout-stability-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", "1");
let server, win, requestedTheme = "dark";
const checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = source => win.webContents.executeJavaScript(source, true);
const selector = value => JSON.stringify(value);
async function until(source, label) {
  const deadline = Date.now() + 12000;
  while (!await evaluate(source)) {
    if (Date.now() > deadline) throw new Error(label);
    await pause(40);
  }
}
async function click(css) {
  await until(`!!document.querySelector(${selector(css)})`, `missing ${css}`);
  await evaluate(`document.querySelector(${selector(css)}).click()`);
  await pause(240);
}
async function snapshot(pageCss) {
  return evaluate(`(() => {
    const page = document.querySelector(${selector(pageCss)}), rect = page.getBoundingClientRect();
    const cards = [...page.querySelectorAll('[data-card-entry]')].map(entry => entry.querySelector('.vua-route-tile, .vua-environment-card'));
    if (!cards.length) cards.push(...page.querySelectorAll('.vua-line__stations, .vua-workshop__main'));
    const visible = cards.filter(card => card && card.getClientRects().length);
    return { viewport:innerHeight, client:page.clientHeight, scroll:page.scrollHeight, width:page.clientWidth,
      content:Math.max(...[...page.children].filter(child=>child.getClientRects().length).map(child=>child.getBoundingClientRect().bottom-rect.top))+parseFloat(getComputedStyle(page).paddingBottom),
      cards:visible.map(card=>{const r=card.getBoundingClientRect();return {left:r.left,width:r.width}}) };
  })()`);
}
function sameWidths(before, after, label) {
  assert.equal(before.width, after.width, `${label}: page client width`);
  assert.equal(before.cards.length, after.cards.length, `${label}: persistent cards`);
  before.cards.forEach((card, i) => {
    assert.ok(Math.abs(card.width-after.cards[i].width)<0.75 && Math.abs(card.left-after.cards[i].left)<0.75,
      `${label}: card ${i} moved or resized: ${JSON.stringify({before:card,after:after.cards[i]})}`);
  });
}
async function overflowRoundTrip(pageCss, openCss, closeCss, label) {
  const natural = await snapshot(pageCss);
  // The last row's own margin counts towards the scroll height.
  const height = Math.ceil(natural.viewport-natural.client+natural.content+12);
  win.setContentSize(1280, height);
  await pause(300);
  const before = await snapshot(pageCss);
  assert.ok(before.scroll <= before.client+1, `${label}: closed page must fit (${JSON.stringify(before)})`);
  await click(openCss);
  const expanded = await snapshot(pageCss);
  assert.ok(expanded.scroll > expanded.client+1, `${label}: detail must produce real overflow (${JSON.stringify(expanded)})`);
  sameWidths(before, expanded, `${label} expanded`);
  await click(closeCss);
  const collapsed = await snapshot(pageCss);
  assert.ok(collapsed.scroll <= collapsed.client+1, `${label}: collapse restores non-scrolling page`);
  sameWidths(before, collapsed, `${label} collapsed`);
  checks.push(`${label}: non-scrolling → scrolling → non-scrolling keeps page/card widths and left edges`);
}
async function firstRun(theme, step) {
  requestedTheme = theme;
  win.setContentSize(1280, 1600);
  await win.loadURL(`${server.resolvedUrls.local[0]}__layout-app`);
  // Initialize the page before CDP media emulation; hosted Windows reduces motion.
  // Reduced-motion behavior has its own fixture, while this case verifies transitions.
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
    features: [{name:"prefers-reduced-motion",value:"no-preference"}],
  });
  await until("!!window.firstRunReview", "App fixture did not load");
  await evaluate(step);
  await pause(200);
  assert.equal(await evaluate("document.documentElement.dataset.theme"), theme);
}
async function sidebar() {
  const read = () => evaluate(`([...document.querySelectorAll('.vua-shell__sidebar-item')].map(item=>{
    const r=item.getBoundingClientRect(),s=getComputedStyle(item);return {id:item.dataset.navId,x:r.x,y:r.y,w:r.width,h:r.height,font:s.fontSize,padding:s.padding};}))`);
  await evaluate("document.activeElement?.blur()");
  win.webContents.sendInputEvent({type:"mouseMove",x:700,y:100}); await pause(250);
  const idle = await read();
  win.webContents.sendInputEvent({type:"mouseMove",x:Math.round(idle[0].x+20),y:Math.round(idle[0].y+idle[0].h/2)}); await pause(250);
  assert.deepEqual(await read(), idle, "sidebar hover must not change any label or neighbour's geometry");
  win.webContents.sendInputEvent({type:"mouseMove",x:700,y:100});
  await evaluate("document.querySelectorAll('.vua-shell__sidebar-item').item(1).focus()"); await pause(250);
  assert.deepEqual(await read(), idle, "sidebar focus must not change any label or neighbour's geometry");
  checks.push("sidebar: idle, pointer hover and keyboard focus keep all item bounds, padding and text sizes");
}
async function creatorRows(label) {
  const rows = await evaluate(`([...document.querySelectorAll('.vua-creator-page .vua-route-tile')].map(row=>{
    const r=row.getBoundingClientRect();return {id:row.dataset.navId,width:r.width,height:r.height,left:r.left,disabled:row.disabled};}))`);
  assert.ok(rows.length>=5, "creator includes editors and all three managers");
  assert.ok(rows.every(row=>Math.abs(row.width-rows[0].width)<0.75 && Math.abs(row.left-rows[0].left)<0.75 && Math.abs(row.height-rows[0].height)<0.75), `${label}: creator rows align, including disabled Unity 6`);
  assert.equal(rows.find(row=>row.id==="route-unity6").disabled, true);
  checks.push(`${label}: editor and manager rows share width, height and alignment, including the disabled tooltip anchor`);
}
async function creatorNarrow(theme) {
  win.setContentSize(640,900); await pause(300);
  const layout=await evaluate(`(() => {const page=document.querySelector('.vua-creator-page'),r=page.getBoundingClientRect();
    return {fits:page.scrollWidth<=page.clientWidth,rows:[...page.querySelectorAll('.vua-route-tile')].map(row=>{const b=row.getBoundingClientRect();return {x:b.x,w:b.width}}),
      controls:[...page.querySelectorAll('[data-amf-setup] button,[data-amf-setup] label')].every(control=>{const b=control.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right;})};})()`);
  assert.ok(layout.fits&&layout.controls,`creator ${theme}: narrow page and AMF controls fit`);
  assert.ok(layout.rows.every(row=>Math.abs(row.x-layout.rows[0].x)<0.75&&Math.abs(row.w-layout.rows[0].w)<0.75),`creator ${theme}: narrow rows align`);
  checks.push(`creator ${theme}: 640 px window keeps software rows and AMF controls aligned without horizontal overflow`);
}
async function creatorMotion(theme) {
  const motion = await evaluate(`(async () => {
    const results=[];
    const getGridAnims=async drawer=>{
      await new Promise(resolve=>setTimeout(resolve,0));
      drawer.getBoundingClientRect();
      let anims=drawer.getAnimations().filter(animation=>animation.transitionProperty==='grid-template-rows');
      if (anims.length===0) {
        await new Promise(resolve=>requestAnimationFrame(resolve));
        anims=drawer.getAnimations().filter(animation=>animation.transitionProperty==='grid-template-rows');
      }
      return anims;
    };
    const sampleMidpoint=anims=>{
      for (const anim of anims) {
        anim.pause();
        const duration=Number(anim.effect?.getTiming?.().duration)||240;
        anim.currentTime=duration/2;
      }
    };
    const finishAnims=async anims=>{
      for (const anim of anims) anim.finish();
      await new Promise(resolve=>requestAnimationFrame(resolve));
    };
    for (const control of document.querySelectorAll('.vua-creator-page .vua-route-tile:not(:disabled)')) {
      const drawer=document.getElementById(control.getAttribute('aria-controls'));
      if (!drawer) continue;
      const height=()=>drawer.getBoundingClientRect().height;
      control.click();
      const openAnims=await getGridAnims(drawer);
      const opening=openAnims.length>0;
      sampleMidpoint(openAnims);
      const middle=height();
      await finishAnims(openAnims);
      const expanded=height();
      control.click();
      const closeAnims=await getGridAnims(drawer);
      const closing=closeAnims.length>0;
      const inaccessible=drawer.inert&&drawer.getAttribute('aria-hidden')==='true';
      sampleMidpoint(closeAnims);
      const closingMiddle=height();
      await finishAnims(closeAnims);
      results.push({id:control.dataset.navId,opening,closing,inaccessible,middle,expanded,closingMiddle,closed:height()});
    }
    return results;
  })()`);
  assert.ok(motion.length>=4);
  for(const row of motion) assert.ok(row.opening&&row.closing&&row.inaccessible&&row.middle>0&&row.middle<row.expanded
    &&row.closingMiddle>0&&row.closingMiddle<row.expanded&&row.closed<1,`${theme} ${row.id}: both directions animate through an intermediate height and closed content is inert: ${JSON.stringify(row)}`);
  checks.push(`creator ${theme}: all ${motion.length} available cards animate opening and closing, with closed details inert`);
}
async function workshopAlignment(theme) {
  const read = () => evaluate(`(() => {
    const page=document.querySelector('.vua-workshop'), rail=page.querySelector('.vua-workshop__rail'), main=page.querySelector('.vua-workshop__main');
    const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}};
    const header=main.querySelector('.vua-line__header'), mode=main.querySelector('[data-nav-id="workshop-mode"]');
    return {page:box(page),rail:box(rail),main:box(main),newLine:box(rail.firstElementChild),header:box(header),mode:box(mode),
      stations:main.querySelector('.vua-line__stations')?box(main.querySelector('.vua-line__stations')):null,
      station:main.querySelector('.vua-line__station')?box(main.querySelector('.vua-line__station')):null,
      firstLine:rail.querySelector('.vua-workshop__line')?box(rail.querySelector('.vua-workshop__line')):null,
      label:mode.querySelector('.vua-mode-picker__value > span')?.textContent, fits:page.scrollWidth<=page.clientWidth+1};
  })()`);
  const layout = await read();
  assert.ok(Math.abs(layout.newLine.top-layout.header.top)<1 && Math.abs(layout.newLine.bottom-layout.header.bottom)<1,`${theme}: workshop columns share a header baseline`);
  assert.ok(Math.abs(layout.mode.right-layout.main.right)<1 && Math.abs(layout.stations.left-layout.header.left)<1
    && Math.abs(layout.stations.top-layout.newLine.bottom-16)<1,`${theme}: mode, station strip and rail share the content grid`);
  assert.ok(layout.label && layout.mode.height>=64);
  assert.ok(layout.firstLine&&layout.station&&Math.abs(layout.firstLine.top-layout.station.top)<1,`${theme}: visible line rows and station cards share their top edge`);
  await click('[data-nav-id="workshop-mode"]');
  assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-checked')`),'true','opening the mode menu focuses the active permission');
  const current = await evaluate(`document.querySelector('[data-nav-id="workshop-mode"]').getAttribute('aria-label')`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await until(`document.querySelector('[data-nav-id="workshop-mode"]').getAttribute('aria-expanded')==='false'`,'Escape closes mode menu');
  assert.equal(await evaluate(`document.activeElement?.dataset.navId`),'workshop-mode');
  assert.equal(await evaluate(`document.querySelector('[data-nav-id="workshop-mode"]').getAttribute('aria-label')`),current,'opening and dismissing the menu never changes automation');
  await evaluate(`document.querySelector('.vua-workshop__rail > .vua-button').click()`); await pause(300);
  assert.ok((await read()).label,'a new line exposes its automation before work starts');
  win.setContentSize(640,900); await pause(300);
  const narrow=await read();
  assert.ok(narrow.fits&&narrow.mode.left>=narrow.main.left-1&&narrow.mode.right<=narrow.main.right+1,`${theme}: the prominent mode control fits a narrow workshop`);
  checks.push(`workshop ${theme}: columns and mode align, keyboard dismissal preserves permissions, and new/narrow lines expose the control`);
}
async function main() {
  try {
    await app.whenReady();
    server=await createServer({configFile:false,appType:"custom",root,plugins:[react()],logLevel:"error",
      cacheDir:path.join(profile,"vite-cache"),
      server:{host:"127.0.0.1",port:0},optimizeDeps:{include:["react","react-dom/client","@vua/contracts"]}});
    server.middlewares.use(async(req,res,next)=>{
      const route=req.url?.split("?")[0];
      if(!["/__layout-app","/__layout-factory"].includes(route))return next();
      const fixture=route==="/__layout-app"?FIXTURES["first-run"]:FIXTURES.factory;
      res.setHeader("Content-Type","text/html");
      res.end(await server.transformIndexHtml(req.url,fixture.shell({locale:"en",theme:requestedTheme})));
    });
    await server.listen();
    win=new BrowserWindow({show:false,width:1280,height:1600,webPreferences:{contextIsolation:true,sandbox:true,offscreen:true,backgroundThrottling:false}});
    win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
    for(const theme of ["dark","light"]){
      await firstRun(theme,'window.firstRunReview.previewEnvironment("create","standard")');
      await sidebar(); await creatorRows(`creator ${theme} / standard`);
      await overflowRoundTrip(".vua-creator-page",'[data-nav-id="manager-vcc"]','[data-nav-id="manager-vcc"]',`creator ${theme}`);
      await firstRun(theme,'window.firstRunReview.previewEnvironment("create")'); await creatorRows(`creator ${theme} / extra editors`);
      await creatorMotion(theme);
      await creatorNarrow(theme);
      await firstRun(theme,'window.firstRunReview.previewEnvironment("play")');
      // The choices open on a first visit; this measures opening them from the closed card.
      await click('[data-nav-id="route-desktop"]'); await pause(500);
      await overflowRoundTrip(".vua-play-page",'[data-nav-id="route-desktop"]','[data-nav-id="route-desktop"]',`play ${theme}`);
      await firstRun(theme,"window.firstRunReview.previewTools()");
      await overflowRoundTrip(".vua-tools-hub",'[data-nav-id="tool-vrcs"]','[data-nav-id="tool-vrcs"]',`tools ${theme}`);
      win.setContentSize(1280,1600);
      await win.loadURL(`${server.resolvedUrls.local[0]}__layout-factory?layout-review=1#workshop-finished`);
      await until("!!document.querySelector('[data-nav-id=\"workshop-station-inspect\"]')", "workshop did not load");
      await click('[data-nav-id="workshop-station-inspect"]');
      await overflowRoundTrip(".vua-workshop",'[data-nav-id="workshop-station-check"]','[data-nav-id="workshop-station-inspect"]',`workshop ${theme}`);
      await workshopAlignment(theme);
    }
    for(const check of checks)console.log(`✔ ${check}`);
    console.log(JSON.stringify({scope:"Real Chromium components; synthetic data; no device or material acceptance",passed:checks.length}));
    win.destroy();await server.close();app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
}
void main();

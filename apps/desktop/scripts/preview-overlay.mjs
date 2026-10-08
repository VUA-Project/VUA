// 切片五(F7a)Overlay 双表面预览(在 Electron Main 进程内执行):
// - 默认:桌面覆盖层预览窗(transparent + frameless + skipTaskbar +
//   alwaysOnTop(screen-saver 级),460×640,加载 ?surface=overlay-desktop,
//   形态参数同 S-F7a spike-overlay.mjs 的验证结论);
// - --vr:VR 表面预览窗(1024×768 不透明固定窗,?surface=overlay-vr);
// - --both:两者双开;
// - --capture <out.rgba>:不开窗,离屏渲染 VR 表面(1024×768),
//   webContents.capturePage → toBitmap(BGRA,Windows 预乘)→ 通道交换为 RGBA
//   原始字节写入 <out.rgba>,并写 <out.rgba>.json({width,height,format:"rgba8"})。
//   该产物是喂给 spikes/steamvr-overlay 的 IVROverlay::SetOverlayRaw 的
//   接缝产物:同一渲染表面,纹理推流与事件回传属 Kernel/spike 侧,本脚本不接线。
//
// 渲染地址:process.env.VUA_RENDERER_URL 优先;缺省探测 http://127.0.0.1:5173
// (dev server);不可达则回退 dist/renderer/index.html(存在性检查,不存在则
// 明确报错并非零退出)。
// preload 存在(dist/electron 已编译)时注入,窗口获得 window.vua.window 壳层
// 动作;本脚本注册与 src/electron/main.ts 相同的 vua:window:* 处理器
// (关闭按钮真实关窗);preload 缺失时窗口仍可预览,关闭按钮退化为端口 dismiss。
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

// 启动方管道可能先死(终端关闭/输出被截断):Windows 上 GUI 进程向已断管道
// console.error 会抛 EPIPE 未捕获异常并弹出错误对话框。stdio 写失败对本
// 预览无害,一律吞掉,保证窗口不因日志通道死亡而崩溃。
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", () => {});
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEV_RENDERER_URL = "http://127.0.0.1:5173";
const DESKTOP_SURFACE = "overlay-desktop";
const VR_SURFACE = "overlay-vr";

const args = process.argv.slice(2);
const captureIndex = args.indexOf("--capture");
const capturePath = captureIndex >= 0 ? args[captureIndex + 1] : null;
const wantVr = args.includes("--vr") || args.includes("--both") || capturePath !== null;
const wantDesktop = capturePath === null && (args.includes("--both") || !args.includes("--vr"));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** 渲染地址解析:dev 服务器优先(缺省),生产产物回退;都没有则响亮失败 */
async function resolveRendererTarget() {
  if (process.env.VUA_RENDERER_URL) {
    return { kind: "url", href: process.env.VUA_RENDERER_URL };
  }
  if (await reachable(DEV_RENDERER_URL)) {
    return { kind: "url", href: DEV_RENDERER_URL };
  }
  const distIndex = path.join(scriptDirectory, "../dist/renderer/index.html");
  if (existsSync(distIndex)) {
    return { kind: "url", href: pathToFileURL(distIndex).href };
  }
  console.error(
    "preview-overlay: 渲染地址不可用——dev 服务器(http://127.0.0.1:5173)不可达," +
      "且 dist/renderer/index.html 不存在。先运行 pnpm dev 或 pnpm build,或设置 VUA_RENDERER_URL。",
  );
  app.exit(1);
  process.exit(1);
}

/** preload 存在才注入(缺 preload 时 window.vua 不存在,表面退化路径已覆盖) */
function webPreferences() {
  const preload = path.join(scriptDirectory, "../dist/electron/preload.js");
  return {
    ...(existsSync(preload) ? { preload } : {}),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
  };
}

/** 与 main.ts 相同的窗口控制处理器(预览本地版):preload 暴露的
 * window.vua.window.* 走这三个 channel;缺处理器时关窗 invoke 会拒绝,
 * 窗口表现为"关不掉"。动作只作用于事件发送者自己的窗口。 */
function registerWindowControls() {
  const forSenderWindow = (event, apply) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) apply(win);
  };
  ipcMain.handle("vua:window:minimize", (event) => forSenderWindow(event, (w) => w.minimize()));
  ipcMain.handle("vua:window:toggle-maximize", (event) =>
    forSenderWindow(event, (w) => (w.isMaximized() ? w.unmaximize() : w.maximize())),
  );
  ipcMain.handle("vua:window:close", (event) => forSenderWindow(event, (w) => w.close()));
}

function surfaceUrl(base, surface) {
  return `${base.href}?surface=${surface}&overlayPreview=1`;
}

async function openDesktopPreview(base) {
  const win = new BrowserWindow({
    width: 460,
    height: 640,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: webPreferences(),
  });
  win.setAlwaysOnTop(true, "screen-saver");
  await win.loadURL(surfaceUrl(base, DESKTOP_SURFACE));
  win.show();
  return win;
}

async function openVrPreview(base) {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    frame: true,
    transparent: false,
    resizable: false,
    webPreferences: webPreferences(),
  });
  await win.loadURL(surfaceUrl(base, VR_SURFACE));
  win.show();
  return win;
}

/** BGRA(Windows toBitmap 输出,预乘)→ RGBA 原始字节(SetOverlayRaw 期望的排列) */
function bgraToRgba(bitmap) {
  const rgba = Buffer.allocUnsafe(bitmap.length);
  for (let i = 0; i < bitmap.length; i += 4) {
    rgba[i] = bitmap[i + 2];
    rgba[i + 1] = bitmap[i + 1];
    rgba[i + 2] = bitmap[i];
    rgba[i + 3] = bitmap[i + 3];
  }
  return rgba;
}

async function captureVrSurface(base, outPath) {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    webPreferences: webPreferences(),
  });
  await win.loadURL(surfaceUrl(base, VR_SURFACE));
  const deadline = Date.now() + 10_000;
  while (win.webContents.isLoading()) {
    if (Date.now() > deadline) throw new Error("capture: VR surface load timed out");
    await delay(50);
  }
  // 等 DEV 演示端口的动态 import 与首帧快照落盘后再抓帧
  await delay(1500);
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const rgba = bgraToRgba(image.toBitmap());
  writeFileSync(outPath, rgba);
  writeFileSync(
    `${outPath}.json`,
    `${JSON.stringify({ width: size.width, height: size.height, format: "rgba8" }, null, 2)}\n`,
  );
  console.log(
    `preview-overlay: 已写入 ${outPath}(${size.width}x${size.height}, rgba8)与 ${outPath}.json`,
  );
  win.destroy();
}

app
  .whenReady()
  .then(async () => {
    registerWindowControls();
    const base = await resolveRendererTarget();
    if (capturePath !== null) {
      await captureVrSurface(base, path.resolve(capturePath));
      app.exit(0);
      return;
    }
    if (wantDesktop) await openDesktopPreview(base);
    if (wantVr) await openVrPreview(base);
    app.on("window-all-closed", () => app.quit());
  })
  .catch((error) => {
    console.error("preview-overlay: 失败", error);
    app.exit(1);
  });

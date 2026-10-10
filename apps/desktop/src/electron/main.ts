import { dialogStrings, startupFailureCopy } from "./dialog-i18n.js";
import { app, BrowserWindow, dialog, ipcMain, net, screen, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  ApplicationEventV01,
  CatalogSyncBeginV03,
  CatalogSyncFinishV03,
  CatalogSyncPageV03,
  DownloadEventV01,
  DesktopShellCommandV1,
  EditorSettingsV1,
  GameGuideFollowStatusV1,
  GameWindowRectPhysicalV1,
  GuideTargetV1,
  NavigationConfirmRequestV1,
  OverlayViewV1,
  RemoteContentEventV1,
} from "@vua/contracts";
import { APPLICATION_CONTRACT_VERSION, accountGuideDestination, isGameWindowObservationResult, isLibraryDownloadParamsV01, isLibraryDownloadSnapshotV01 } from "@vua/contracts";
import type { OrchestratorProviderV01 } from "@vua/orchestrator-provider";
import { routeDesktopGatewayInvoke } from "./gateway-router.js";
import { DownloadPort } from "./download-port.js";
import { createSilentDownloadQueue } from "./silent-download.js";
import { createDownloadEventSink } from "./download-ingest.js";
import {
  CATALOG_SYNC_DEFAULT_START_URL,
  startCatalogSync,
  type CatalogSyncRun,
} from "./catalog-sync.js";
import { probeBoothAuthentication } from "./booth-auth.js";
import { deactivateImageCache, importLocalThumbnail, registerImageCacheProtocol, registerImageCacheScheme } from "./image-cache.js";
import { RemoteContentManager } from "./remote-content.js";
import { createDesktopOrchestratorProvider, type DesktopProviderEndpoint } from "./provider-bootstrap.js";
import { AmfRegistry } from "./amf-registry.js";
import { ModuleProvider } from "./module-provider.js";
import {
  isEditorSettingsV1,
  readEditorSettingsFromFile,
  writeEditorSettingsToFile,
} from "./editor-settings.js";
import {
  readMaterialSourcesFromFile,
  writeMaterialSourcesToFile,
  type MaterialSourceEntryV1,
} from "./material-source-store.js";
import {
  OVERLAY_SURFACE_PARAM,
  OVERLAY_WINDOW_HEIGHT,
  OVERLAY_WINDOW_LEVEL,
  OVERLAY_WINDOW_WIDTH,
  decideOverlayWindowAction,
  guideTargetQuery,
  overlayVisibilityAfterDecision,
  parseGuideTargetPayload,
} from "./overlay-window.js";
import {
  READER_SURFACE_PARAM,
  READER_WINDOW_HEIGHT,
  READER_WINDOW_MIN_HEIGHT,
  READER_WINDOW_MIN_WIDTH,
  READER_WINDOW_WIDTH,
  decideReaderWindowAction,
  readerVisibilityAfterDecision,
} from "./reader-window.js";
import {
  GAME_GUIDE_SURFACE_PARAM,
  GAME_GUIDE_WINDOW_HEIGHT,
  GAME_GUIDE_WINDOW_LEVEL,
  GAME_GUIDE_WINDOW_MIN_HEIGHT,
  GAME_GUIDE_WINDOW_MIN_WIDTH,
  GAME_GUIDE_WINDOW_WIDTH,
  decideGameGuideWindowAction,
  gameGuideVisibilityAfterDecision,
} from "./game-guide-window.js";
import {
  applyFollowToggle,
  applyManualHide,
  applyManualShow,
  decideFollowTick,
  initialGameGuideFollowState,
  recordGuideDrag,
  recordUnknownTick,
  type DipRect,
  type GameGuideFollowState,
} from "./game-guide-follow.js";
import { readGuidePlacement, writeGuidePlacement } from "./game-guide-placement-store.js";
import {
  installLocalContentNavigationPolicy,
  installPermissionDenyPolicy,
  isAllowedLocalSender,
  localWindowWebPreferences,
} from "./security.js";
import { checkLatestRelease } from "./update-check.js";
import { SystemUsageCollector } from "./system-usage.js";
import { createFsDirectory, listFsDirectory } from "./fs-directory.js";
import { resolveDesktopRuntime } from "./runtime-paths.js";
import { preparePackagedSmoke } from "./packaged-smoke.js";
import { configureDesktopProfile, resolveDesktopProfile, tagDevelopmentWindow } from "./runtime-profile.js";
import { createVuaTray } from "./system-tray.js";

registerImageCacheScheme();

const desktopRuntime = resolveDesktopRuntime({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  mainDirectory: __dirname,
  platform: process.platform,
  env: process.env,
});
const rendererUrl = desktopRuntime.rendererUrl;
// Resolve all persistence before app.ready/Session/Provider initialization. Resolve
// symlinks in development so a second spelling of one checkout retains its identity.
const desktopProfile = resolveDesktopProfile({
  isPackaged: app.isPackaged,
  appData: app.getPath("appData"),
  localAppData: process.env.LOCALAPPDATA,
  mainDirectory: app.isPackaged ? __dirname : fs.realpathSync(__dirname),
  platform: process.platform,
  developmentOverride: process.env.VUA_DEV_USER_DATA,
  packagedSmokeDirectory: app.isPackaged && app.commandLine.hasSwitch("vua-smoke-test")
    ? app.commandLine.getSwitchValue("vua-smoke-test") : undefined,
});
configureDesktopProfile(app, desktopProfile);
if (desktopProfile.kind !== "release") {
  process.stderr.write(`${JSON.stringify({ channel: "desktop-profile", ...desktopProfile })}\n`);
}
const packagedSmoke = preparePackagedSmoke();
let mainWindow: BrowserWindow | null = null;
let systemTray: ReturnType<typeof createVuaTray> | null = null;
let shellListening = false;
let encyclopediaListening = false;
let pendingEncyclopediaTarget: GuideTargetV1 | null | undefined;
let shellLocale: string | null = null;
let pendingShellCommand: DesktopShellCommandV1 | null = null;
let overlayWindow: BrowserWindow | null = null;
let readerWindow: BrowserWindow | null = null;
let gameGuideWindow: BrowserWindow | null = null;
let provider: ModuleProvider | null = null;
let amfRegistry: AmfRegistry | null = null;
let disposeAmfShell: (() => void) | null = null;
let mountingAmfShell: Promise<void> | null = null;
let amfIngestSink: ReturnType<typeof createDownloadEventSink> | null = null;
let remoteContent: RemoteContentManager | null = null;
let downloadPort: DownloadPort | null = null;
let silentDownloadQueue: ReturnType<typeof createSilentDownloadQueue> | null = null;
// 账号库同步当前运行(N5 S1):单并发守卫的持有位;结果落 provider 任务面
let catalogSyncRun: CatalogSyncRun | null = null;
// 最近一次同步运行的终态事实(任务前失败可见性,真机 2026-10-05):首页就
// 失败的运行在 provider 侧不产生任务,通知中心/任务轮询永远等不到——此处
// 记下终态码,probe 面据此让渲染层把「已开始」翻成失败提示
let catalogSyncLastTerminal: { runId: string; code: string | null } | null = null;
// 系统资源占用采集器(顶栏占用查看器):whenReady 启动,退出前 stop
const systemUsage = new SystemUsageCollector();
const lastAppliedIntentSeq = new Map<string, number>();
let shutdownStarted = false;

function focusMainWindow(): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendShellCommand(command: DesktopShellCommandV1): void {
  focusMainWindow();
  if (shellListening && mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("vua:window:shell-command", command);
  } else pendingShellCommand = command;
}

// 游戏引导跟随(game-guide follow 切片,guidance §4):状态机与决策在
// game-guide-follow.ts(纯函数可测);此处只持有状态、250ms 定时器与请求
// 序号。跟随开关缺省 ON(用户裁决),渲染层持久化并经 set-following 推送,
// Main 强制执行
const gameGuidePlacementFile = path.join(app.getPath("userData"), "game-guide-placement.json");
let gameGuideFollow: GameGuideFollowState = { ...initialGameGuideFollowState, relativePlacement: readGuidePlacement(gameGuidePlacementFile) };
let gameGuideFollowTimer: ReturnType<typeof setInterval> | null = null;
let gameGuideFollowSeq = 0;

// #26 防弹兜底(用户实测退出弹「Uncaught Exception」原生框):意外异常改为
// 诊断通道 stderr 全文留痕,不弹系统错误框——失败仍如实呈现(留痕可查),
// 但退出路径不再被原生弹窗打断。放在模块顶层,窗口创建前即生效
process.on("uncaughtException", (error) => {
  process.stderr.write(
    `${JSON.stringify({ channel: "uncaught-exception", message: error?.stack ?? String(error) })}\n`,
  );
});

/** Kernel 侧素材来源映射(refId → 真实路径):Renderer 只见不透明 refId;
 *  生产命令 live 接线后,由 Kernel 在 Gateway → 应用契约翻译时补全四元组。
 *  持久化(W25 真机实测易失缺陷修复 2026-09-20):登记落盘 userData 下
 *  material-sources.json,启动载入、注册即写盘——此前仅存内存,应用重启
 *  即失,渲染层残留 refId 成死引用(详见 material-source-store.ts)。 */
const materialSources = new Map<string, MaterialSourceEntryV1>();
let materialSourceSequence = 0;

/** 素材登记落盘路径:userData 内,含用户本机路径不入 git(操作者红线,
 *  无脱敏设计) */
function amfDataRoot(): string {
  if (amfRegistry === null || amfRegistry.invalid) throw new Error("AMF registration unavailable");
  return amfRegistry.dataRoot();
}

function assertAmfReady(): void {
  if (!provider?.amfReady()) throw new Error("vua.amf.unavailable");
}

function materialSourcesPath(): string {
  return path.join(amfDataRoot(), "material-sources.json");
}

/** 注册面写盘:内存为准落盘(全量覆写,原子写);写失败即本次拾取失败
 *  (handler 拒绝,渲染层如实呈现)——登记不能只报成功不留盘,否则同一
 *  易失缺陷静默回归 */
function persistMaterialSources(): void {
  writeMaterialSourcesToFile(materialSourcesPath(), materialSources, new Date().toISOString());
}

/** AMF 启用时载入(进程启动前):落盘事实为准;损坏文件已由
 *  读取侧归档并按空登记,诊断通道留痕(诚实可见,不静默) */
function loadMaterialSourcesFromDisk(): void {
  const loaded = readMaterialSourcesFromFile(materialSourcesPath());
  if (loaded.kind === "recovered") {
    process.stderr.write(`${JSON.stringify({
      channel: "material-sources",
      event: "persisted-file-recovered",
      reason: loaded.reason,
      archivedTo: loaded.archivedTo,
    })}\n`);
  }
  if (loaded.kind !== "loaded") return;
  materialSources.clear();
  for (const [refId, entry] of loaded.sources) materialSources.set(refId, entry);
  materialSourceSequence = loaded.sequence;
}

/**
 * 生产上下文(amf-production v0.2,M3 纵向):projectRoot/artifactOutputRoot/
 * projectId 是 VUA 管辖配置的确定性路径(合成 Avatar 纵向,位于用户数据目录,
 * 渲染层不可见);sourceFolder 是用户显式选取的素材路径。四元组随
 * startInspection 一次性转交 AMF,此后任何请求面不再出现路径。
 */
function resolveProductionContext(refId: string): {
  sourceFolder: string;
  projectRoot: string;
  artifactOutputRoot: string;
  projectId: string;
} | undefined {
  const source = materialSources.get(refId);
  if (source === undefined) return undefined;
  const productionRoot = path.join(amfDataRoot(), "production");
  return {
    sourceFolder: source.path,
    projectRoot: path.join(productionRoot, "synthetic-avatar-project"),
    artifactOutputRoot: path.join(productionRoot, "artifacts"),
    projectId: "vua-m3-synthetic-avatar",
  };
}

function assertLocalSender(senderUrl: string): void {
  if (!isAllowedLocalSender(senderUrl, rendererUrl)) throw new Error("untrusted renderer origin");
}

function senderFrameUrl(event: Electron.IpcMainInvokeEvent): string {
  return event.senderFrame?.url ?? "";
}

/** Provider 类型化事件 → 全部本地来源窗口(多窗口同步的 Kernel 侧) */
function broadcastGatewayEvent(rendererUrl: string | undefined, event: ApplicationEventV01): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (isAllowedLocalSender(window.webContents.getURL(), rendererUrl)) {
      window.webContents.send("vua:gateway:event", event);
    }
  }
}

/** 远程内容事件 → 全部本地来源窗口(隔离基座 F4-2;违规透明上报) */
function broadcastRemoteContentEvent(rendererUrl: string | undefined, event: RemoteContentEventV1): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (isAllowedLocalSender(window.webContents.getURL(), rendererUrl)) {
      window.webContents.send("vua:remote-content:event", event);
    }
  }
}

/** 壳编辑器设置落盘路径(U10 门③留痕,机器级 settings) */
function editorSettingsPath(): string {
  return path.join(app.getPath("userData"), "editor-settings.json");
}

/** Host startup has no AMF roots. Legacy task rows are copied read-only. */
function resolveProviderEndpoint(): DesktopProviderEndpoint {
  const executablePath = desktopRuntime.providerExecutable;
  if (!fs.existsSync(executablePath)) throw new Error("Bundled host provider is missing");
  const userData = app.getPath("userData");
  return { role: "host", executablePath, databasePath: path.join(userData, "host", "tasks.db"), profileRoots: profileRoots(),
    legacyDatabasePath: path.join(userData, "orchestrator", "provider.db") };
}

function profileRoots() {
  const home = app.getPath("home");
  const local = process.env.LOCALAPPDATA;
  return { home, appData: app.getPath("appData"), localAppData: local && path.isAbsolute(local) ? local : path.join(home, "AppData", "Local") };
}

/** Material roots are resolved only after AMF is selected. */
function resolveAmfEndpoint(): DesktopProviderEndpoint {
  if (amfRegistry?.invalid) throw new Error("Invalid AMF registration; file retained");
  const providerDataRoot = amfDataRoot();
  const warehouseRoot = path.join(providerDataRoot, "warehouse");
  const projectRoot = path.join(providerDataRoot, "production", "synthetic-avatar-project");
  for (const directory of [warehouseRoot, projectRoot]) fs.mkdirSync(directory, { recursive: true });
  loadMaterialSourcesFromDisk();
  return { role: "amf", executablePath: desktopRuntime.amfExecutable, profileRoots: profileRoots(),
    databasePath: path.join(app.getPath("userData"), "modules", "amf", "tasks.db"),
    legacyDatabasePath: path.join(app.getPath("userData"), "orchestrator", "provider.db"),
    providerDataRoot, warehouseRoot, projectRoot,
    unityEditorPath: readEditorSettingsFromFile(editorSettingsPath()).confirmedEditor?.path ?? null };
}

function registerIpc(provider: ModuleProvider): void {
  ipcMain.handle("vua:amf-module:snapshot", (event) => {
    assertLocalSender(senderFrameUrl(event));
    return provider.moduleSnapshot();
  });
  ipcMain.handle("vua:amf-module:set-enabled", async (event, enabled: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof enabled !== "boolean") throw new Error("invalid AMF lifecycle request");
    const result = await provider.setAmfEnabled(enabled);
    if (result.snapshot.state === "ready") await ensureAmfShell();
    return result;
  });
  ipcMain.handle("vua:gateway:invoke", (event, request: unknown) => routeDesktopGatewayInvoke(
    {
      provider,
      productVersion: app.getVersion(),
      platform: process.platform as "win32" | "darwin" | "linux",
      rendererUrl,
      resolveMaterialSource: resolveProductionContext,
    },
    senderFrameUrl(event),
    request,
  ));

  // 素材来源对话框(生产用例契约草案"双素材入口"):两个 intake 均为文件夹选择器
  // (W25 真机第四批:provider 端 inspect_folder 对 sourceFolder 做
  // canonicalize+is_dir 校验(material_intake.rs),非目录一律
  // vua.material.source_invalid 拒绝——曾经的 openFile+.unitypackage 过滤器
  // 让用户选中文件必被 provider 拒)。桌面侧不做目录性预拦:登记原样落
  // Kernel 映射并回发 { refId, displayName },取消返回 null;若仍有文件路径
  // 登记(如旧版落盘残留),provider 拒绝经渲染层 source_invalid 专用拒绝
  // 原因如实上呈。对话框标题按应用语言本地化(i18n 批 locale 边界):
  // direct_unity_package 拾取的是内含 .unitypackage 的素材文件夹,标题词面
  // 随第四批四语表 pick 措辞取文件夹语义
  ipcMain.handle("vua:dialog:pick-material-source", async (event, intake: unknown, locale: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (intake !== "direct_unity_package" && intake !== "local_reusable_vpm") {
      throw new Error("invalid material intake");
    }
    const options = {
      title:
        intake === "direct_unity_package"
          ? dialogStrings(locale).unityPackage
          : dialogStrings(locale).localVpm,
      filters: [] as { name: string; extensions: string[] }[],
      properties: ["openDirectory"] as ("openFile" | "openDirectory")[],
    };
    const result =
      mainWindow === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(mainWindow, options);
    if (result.canceled || result.filePaths.length !== 1) return null;
    assertAmfReady();
    const pickedPath = result.filePaths[0]!;
    materialSourceSequence += 1;
    const refId = `mat-${materialSourceSequence}-${crypto.randomUUID()}`;
    const displayName = path.basename(pickedPath);
    materialSources.set(refId, { path: pickedPath, displayName });
    // 注册即写盘(W25 易失缺陷修复):重启后登记仍在;写失败向上抛,
    // 拾取如实失败(渲染层可发现),不留「成功但不持久」的静默缺口
    persistMaterialSources();
    return { refId, displayName };
  });

  // 仓储导入文件夹多选(W18,bdl-commands v0.3 warehouse.import 的本地拾取面):
  // openDirectory + multiSelections;取消或空选返回 null,路径交给渲染层经
  // warehouse.import 提交(本进程不做任何文件操作)
  ipcMain.handle("vua:dialog:pick-warehouse-folders", async (event, locale: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    const result = await dialog.showOpenDialog({
      title: dialogStrings(locale).warehouse,
      properties: ["openDirectory", "multiSelections"] as ("openFile" | "openDirectory" | "multiSelections")[],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    assertAmfReady();
    return result.filePaths;
  });
  ipcMain.handle("vua:dialog:pick-library-thumbnail", async (event, locale: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    const result = await dialog.showOpenDialog({ title: dialogStrings(locale).libraryThumbnail,
      filters: [{ name: "PNG / JPEG / WebP", extensions: ["png", "jpg", "jpeg", "webp"] }], properties: ["openFile"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    assertAmfReady();
    return importLocalThumbnail(result.filePaths[0]!);
  });

  // U10 手选编辑器路径(021 收敛点 4:单一「浏览」入口双态):exe 文件本身
  // 或目录(版本化根/Editor 目录);取消返回 null。路径原样交渲染层经
  // environment.verifyEditor 透传验证,本进程不做归一化
  ipcMain.handle("vua:dialog:pick-editor-path", async (event, mode: unknown, locale: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (mode !== "executable" && mode !== "directory") {
      throw new Error("invalid editor path mode");
    }
    const options =
      mode === "executable"
        ? {
            title: dialogStrings(locale).editorExecutable,
            filters: [{ name: "Unity", extensions: ["exe"] }],
            properties: ["openFile"] as ("openFile" | "openDirectory")[],
          }
        : {
            title: dialogStrings(locale).editorDirectory,
            filters: [] as { name: string; extensions: string[] }[],
            properties: ["openDirectory"] as ("openFile" | "openDirectory")[],
          };
    const result =
      mainWindow === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(mainWindow, options);
    if (result.canceled || result.filePaths.length !== 1) return null;
    return result.filePaths[0]!;
  });

  // 壳编辑器设置读写(U10 门③留痕):读取按落盘事实;保存校验形状,词表外
  // 内容拒绝并回当前落盘值(不猜测、不修复)
  ipcMain.handle("vua:editor-settings:read", async (event) => {
    assertLocalSender(senderFrameUrl(event));
    return readEditorSettingsFromFile(editorSettingsPath());
  });
  ipcMain.handle("vua:editor-settings:save", async (event, settings: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    const current = readEditorSettingsFromFile(editorSettingsPath());
    if (!isEditorSettingsV1(settings)) return current;
    return writeEditorSettingsToFile(editorSettingsPath(), settings as EditorSettingsV1);
  });

  // 版本检测(2026-09-19 用户裁决:默认开启、设置可关;只读探测——
  // 下载/应用更新属 Phase C 独立提案):经 electron net 栈走系统网络,
  // 10s 超时熔断;失败语义全部内收于 check-failed,本 handler 永不抛
  ipcMain.handle("vua:system:check-update", async (event) => {
    assertLocalSender(senderFrameUrl(event));
    return checkLatestRelease(app.getVersion(), async (url) => {
      const response = await net.fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`http ${response.status}`);
      return response.json();
    });
  });

  // 系统资源占用(2026-09-25 用户裁决:顶栏占用查看器):读采集器缓存
  // 快照,单次调用零采集成本;VRAM 不可用时字段 null,不猜值
  ipcMain.handle("vua:system:resource-usage", (event) => {
    assertLocalSender(senderFrameUrl(event));
    return systemUsage.snapshot();
  });

  // 文件系统窄面(2026-09-25 用户裁决:素材导入应用内文件夹选择器):
  // 只读列目录(仅子目录) + 单层新建;失败收信不抛,渲染层按 error
  // 词表如实呈现;参数形状非法 = 形状违反,沿用本文件先例以错误拒绝
  ipcMain.handle("vua:fs:list-directory", async (event, target: unknown, options: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (target !== null && typeof target !== "string") {
      throw new Error("invalid fs list target");
    }
    const showHidden =
      typeof options === "object" && options !== null
        ? (options as { showHidden?: unknown }).showHidden === true
        : false;
    return listFsDirectory(target, { showHidden });
  });
  ipcMain.handle("vua:fs:create-directory", async (event, parentPath: unknown, name: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof parentPath !== "string" || typeof name !== "string") {
      throw new Error("invalid fs create params");
    }
    return createFsDirectory(parentPath, name);
  });

  ipcMain.handle("vua:window:minimize", (event) => {
    assertLocalSender(senderFrameUrl(event));
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("vua:window:toggle-maximize", (event) => {
    assertLocalSender(senderFrameUrl(event));
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    window.isMaximized() ? window.unmaximize() : window.maximize();
  });
  ipcMain.handle("vua:window:close", (event) => {
    assertLocalSender(senderFrameUrl(event));
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // Overlay 置顶窗开关(proposal 017 实现面备注,正式入口形态):只受理本地
  // 来源窗口;动作与回执语义在 overlay-window.ts 决策面(纯函数可测)
  ipcMain.handle("vua:overlay:toggle", (event) => {
    assertLocalSender(senderFrameUrl(event));
    return toggleOverlayWindow();
  });

  // 打开/聚焦覆盖层并切视图(2026-09-26 additive 裁决:覆盖层窗口成为引导
  // 宿主):只受理本地来源;视图词表闭集 guide|status,缺省 guide;
  // 语义在 showOverlayWindow——无窗口=创建并显示请求视图(首视图经加载
  // 查询投递),隐藏=显示并切视图,可见=仅切视图(不隐藏;经
  // vua:overlay:set-view 事件投递给覆盖层窗口本身)
  ipcMain.handle("vua:overlay:show", (event, view: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (view !== null && view !== "guide" && view !== "status") {
      throw new Error("invalid overlay view");
    }
    return showOverlayWindow(view === null ? "guide" : view);
  });

  // 按定位打开引导(首玩 B 切片 additive):形状收窄在 overlay-window.ts
  // 纯函数(垃圾形状响亮 throw;主题/分节词表回退归渲染层引导模型)
  ipcMain.handle("vua:overlay:show-guide", (event, target: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    return showGuideWindow(parseGuideTargetPayload(target));
  });

  // 打开/聚焦准备阅读器(三类引导裁决 additive):只受理本地来源;定位载荷
  // 形状收窄复用 overlay-window 纯函数(垃圾形状响亮 throw;词表回退归渲染
  // 层引导模型);窗口显隐语义在 reader-window.ts 决策面(纯函数可测)
  ipcMain.handle("vua:reader:show", (event, target: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    return showReaderWindow(parseGuideTargetPayload(target));
  });

  // V2 adds main-page knowledge navigation; legacy V1 reader behavior stays intact.
  ipcMain.handle("vua:knowledge:show", (event, target: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    const parsed = parseGuideTargetPayload(target);
    if (mainWindow === null || mainWindow.isDestroyed()) return { visible: false };
    pendingEncyclopediaTarget = parsed;
    focusMainWindow();
    if (encyclopediaListening) {
      mainWindow.webContents.send("vua:knowledge:target", parsed);
      pendingEncyclopediaTarget = undefined;
    }
    return { visible: true };
  });
  ipcMain.on("vua:knowledge:listening", (event, listening: unknown) => {
    if (typeof listening !== "boolean" || mainWindow === null || mainWindow.isDestroyed()
      || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame
      || !isAllowedLocalSender(event.senderFrame?.url ?? "", rendererUrl)) return;
    encyclopediaListening = listening;
    if (listening && pendingEncyclopediaTarget !== undefined) {
      mainWindow.webContents.send("vua:knowledge:target", pendingEncyclopediaTarget);
      pendingEncyclopediaTarget = undefined;
    }
  });

  // 打开/聚焦游戏引导小窗(三类引导 §4 additive):只受理本地来源;
  // 窗口显隐语义在 game-guide-window.ts 决策面(纯函数可测);隐藏由渲染面
  // 经 vua:game-guide:hide 显式发起。显式打开 = 清除本会话手动隐藏记录,
  // 恢复跟随(game-guide-follow.ts applyManualShow)
  ipcMain.handle("vua:game-guide:show", (event) => {
    assertLocalSender(senderFrameUrl(event));
    gameGuideFollow = applyManualShow(gameGuideFollow);
    return showGameGuideWindow();
  });
  ipcMain.handle("vua:game-guide:hide", (event) => {
    assertLocalSender(senderFrameUrl(event));
    // 本会话内手动隐藏优先:当前游戏会话的窗口变化不再把它带回
    gameGuideFollow = applyManualHide(gameGuideFollow);
    hideGameGuideWindow();
    return { visible: false };
  });

  // 跟随开关(game-guide follow 切片 additive):渲染层持久化(localStorage)
  // 并经本通道推送,Main 强制执行——关闭即停一切自动显隐/移动,已绑定且
  // 可见的引导立即收起,不留全局置顶窗压在无关应用上;开启只翻开关,
  // 显隐恢复等下一个 tick 按观察决定。定时器随开关与窗口在位状态启停
  ipcMain.handle("vua:game-guide:set-following", (event, following: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof following !== "boolean") throw new Error("invalid game-guide follow flag");
    const result = applyFollowToggle(
      gameGuideFollow,
      following,
      gameGuideWindow !== null && !gameGuideWindow.isDestroyed() && gameGuideWindow.isVisible(),
    );
    gameGuideFollow = result.next;
    if (result.hideNow) hideGameGuideWindow();
    if (following) ensureGameGuideFollowTimer();
    else stopGameGuideFollowTimer();
  });
  // 跟随状态(只读):跟随开关 + 最近一次游戏窗口观察三态(unknown = 观察
  // 通道未就绪/查询失败的诚实缺席,绝不伪造 ready)
  ipcMain.handle("vua:game-guide:follow-status", (event): GameGuideFollowStatusV1 => {
    assertLocalSender(senderFrameUrl(event));
    return {
      following: gameGuideFollow.followEnabled,
      observation: gameGuideFollow.lastObservation,
      gameForeground: gameGuideFollow.lastGameForeground,
    };
  });

  // 收起覆盖层(首玩 B 切片 additive):隐藏不销毁,保留窗口与阅读状态;
  // 窗口缺席幂等回执 false,绝不创建窗口(与 toggle 的 create 语义区分)
  ipcMain.handle("vua:overlay:hide", (event) => {
    assertLocalSender(senderFrameUrl(event));
    if (overlayWindow !== null && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.hide();
    }
    return { visible: false };
  });

  // 返回主窗口(首玩 B 切片 additive):仅响应用户明确动作(覆盖层「返回
  // 主窗口」),允许切换焦点;最小化先还原;主窗口缺席(启动中/已关闭)幂等
  ipcMain.handle("vua:window:focus-main", (event) => {
    assertLocalSender(senderFrameUrl(event));
    focusMainWindow();
  });
  ipcMain.on("vua:window:shell-listening", (event, listening: unknown, locale: unknown) => {
    if (typeof listening !== "boolean" || mainWindow === null || mainWindow.isDestroyed()
      || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame
      || !isAllowedLocalSender(event.senderFrame?.url ?? "", rendererUrl)) return;
    shellListening = listening;
    if (!listening) return;
    if (typeof locale === "string" && locale.length <= 32) shellLocale = locale;
    systemTray?.setLocale(shellLocale);
    if (pendingShellCommand !== null) {
      const command = pendingShellCommand;
      pendingShellCommand = null;
      sendShellCommand(command);
    }
  });

  // 远程内容窄面(F4-2 隔离基座):Renderer 只发语义动作;来源允许清单在
  // Main 侧裁决,视图内违规以事件透明上报。种子允许清单只含目录浏览域,
  // 真实值随 catalog 契约冻结(F4-1②)调整
  // Registration uses the official browser handoff until temporary embedded account
  // sessions have their own acceptance. BOOTH acquisition keeps its existing profile.
  ipcMain.handle("vua:remote-content:open-account-guide-in-browser", async (event, guide: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    const url = accountGuideDestination(guide);
    if (url === null) throw new Error("invalid account guide");
    await shell.openExternal(url);
  });
  ipcMain.handle("vua:remote-content:open", (event, request: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    const url = (request as { url?: unknown } | null)?.url;
    if (typeof url !== "string") throw new Error("invalid remote content request");
    return remoteContent!.open(url);
  });
  ipcMain.handle("vua:remote-content:navigate", (event, viewId: unknown, url: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (typeof viewId !== "string" || typeof url !== "string") throw new Error("invalid remote content request");
    return remoteContent!.navigate(viewId, url);
  });
  // 视图内导航历史(固定导航条动作面):身份守卫在管理器,本地来源守卫在此
  ipcMain.handle("vua:remote-content:go-back", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    return remoteContent!.goBack(viewId);
  });
  ipcMain.handle("vua:remote-content:go-forward", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    return remoteContent!.goForward(viewId);
  });
  ipcMain.handle("vua:remote-content:reload", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    return remoteContent!.reload(viewId);
  });
  ipcMain.handle("vua:remote-content:close", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    remoteContent!.close(viewId);
  });
  ipcMain.handle("vua:remote-content:set-visible", (event, viewId: unknown, visible: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (typeof viewId !== "string" || typeof visible !== "boolean") throw new Error("invalid remote content request");
    return remoteContent!.setVisible(viewId, visible);
  });
  // BOOTH 登录态线索(W25 走查缺陷③b):只读探测本机分区 Cookie 存在性,
  // Cookie 值不过 IPC;探测失败在管理器内归并为 "unknown"(诚实未知)
  ipcMain.handle("vua:remote-content:sign-in-hint", (event) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    return remoteContent!.signInHint();
  });
  // 真实登录判定(2026-10-05,登录浏览器轮询用):抓一次已购库首页按内容
  // 识别登录页——与同步启动门同一判据;探测异常恒 false,不冒充已登录。
  // 已登录时顺带提取页头 data-user-name(登录 ID 原样,账号管理卡显示用;
  // 提取失败 = null,不猜)
  ipcMain.handle("vua:remote-content:auth-probe", async (event) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (remoteContent === null) return { authOk: false, accountName: null };
    return probeBoothAuthentication(remoteContent);
  });
  // 登出(账号管理,2026-10-05):清空分区存储并关闭打开中的远程视图
  ipcMain.handle("vua:remote-content:sign-out", async (event) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (remoteContent === null) throw new Error("remote content is unavailable");
    await remoteContent.signOut();
  });

  // 账号库同步触发面(N5 S1,计划 D4):分区会话逐页抓取 → provider
  // catalog.ingestLibraryPage 折叠;进度与终态走九态任务面(通知中心),
  // 本面只回触发结果。登录线索 "none" 返回 blocked 引导登录不空跑;
  // "unknown" 放行走真抓取(探测失败不冒充事实,HTTP 结果才是)。凭据
  // 全程留在 remoteContent 的分区会话内,IPC 面零 Cookie/令牌。
  ipcMain.handle("vua:catalog-sync:start", async (event, request: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    if (remoteContent === null) throw new Error("remote content is unavailable");
    if (catalogSyncRun !== null) {
      return { status: "already_running", runId: catalogSyncRun.runId };
    }
    const hint = await remoteContent.signInHint();
    // The awaited probe lets another start install the global run.
    const concurrentRun = catalogSyncRun as CatalogSyncRun | null;
    if (concurrentRun !== null) {
      return { status: "already_running", runId: concurrentRun.runId };
    }
    if (hint === "none") {
      return { status: "blocked", reason: "sign-in-required" };
    }
    // 库类型(已购缺省/gifts/free_downloads/all=三库串行,用户期望
    // 2026-10-05:一次点击覆盖全部 ~35 件);来源守卫由 fetchWithSession
    // 的允许清单最终把关
    const libraryTypeRaw = (request as { libraryType?: unknown } | null | undefined)?.libraryType;
    // 缺省显式化为 bought:观察面是“最新事实全量覆盖”,不带类型的同步
    // 会把已分类行清回 NULL(真机 2026-10-03 确诊)
    const libraryType =
      libraryTypeRaw === "gifts" || libraryTypeRaw === "free_downloads" || libraryTypeRaw === "bought" || libraryTypeRaw === "all"
        ? libraryTypeRaw
        : ("bought" as const);
    const segments =
      libraryType === "all"
        ? [
            { startUrl: CATALOG_SYNC_DEFAULT_START_URL, libraryType: "bought" as const },
            { startUrl: "https://accounts.booth.pm/library/gifts?page=1", libraryType: "gifts" as const },
            { startUrl: "https://accounts.booth.pm/library/free_downloads?page=1", libraryType: "free_downloads" as const },
          ]
        : libraryType === "gifts"
          ? [{ startUrl: "https://accounts.booth.pm/library/gifts?page=1", libraryType: "gifts" as const }]
          : libraryType === "free_downloads"
            ? [{ startUrl: "https://accounts.booth.pm/library/free_downloads?page=1", libraryType: "free_downloads" as const }]
            : [{ startUrl: CATALOG_SYNC_DEFAULT_START_URL, libraryType: "bought" as const }];
    const content = remoteContent;
    const invokeCatalogSync = (command:
      | { readonly method: "catalog.beginLibrarySync"; readonly params: CatalogSyncBeginV03 }
      | { readonly method: "catalog.ingestLibraryPage"; readonly params: CatalogSyncPageV03 }
      | { readonly method: "catalog.finishLibrarySync"; readonly params: CatalogSyncFinishV03 }
    ) => {
      if (provider === null) {
        return Promise.reject(new Error("provider is not running"));
      }
      return provider
        .invoke({
          contractVersion: APPLICATION_CONTRACT_VERSION,
          requestId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          kind: "command",
          ...command,
        })
        .then((response) =>
          response.ok
            ? { ok: true as const, value: response.value }
            : { ok: false as const, error: { code: response.error.code } },
        );
    };
    const run = startCatalogSync(
      {
        fetch: (url, signal) => content.fetchWithSession(url, signal),
        begin: (params) => invokeCatalogSync({ method: "catalog.beginLibrarySync", params }),
        invoke: (params) => invokeCatalogSync({ method: "catalog.ingestLibraryPage", params }),
        finish: (params) => invokeCatalogSync({ method: "catalog.finishLibrarySync", params }),
      },
      { segments },
    );
    catalogSyncRun = run;
    catalogSyncLastTerminal = null;
    void run.result.then(
      (result) => {
        catalogSyncLastTerminal = {
          runId: run.runId,
          code: result.status === "completed" ? null : (result.error?.code ?? result.status),
        };
      },
      () => {
        catalogSyncLastTerminal = { runId: run.runId, code: "internal" };
      },
    );
    void run.result.finally(() => {
      if (catalogSyncRun === run) catalogSyncRun = null;
    });
    await run.ready;
    return { status: "started", runId: run.runId };
  });
  ipcMain.handle("vua:catalog-sync:stop", (event) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    catalogSyncRun?.stop();
  });
  // 静默下载触发面(N5,2026-10-05 用户裁决:Steam 式,不打开页面):渲染层
  // 传入 BDL 捕获的文件 id 批;入队即受理,进度与终态走下载任务面(通知中心)
  ipcMain.handle(
    "vua:silent-download:start",
    async (event, productId: unknown, downloadableIds: unknown, replacementTargets: unknown) => {
      assertLocalSender(senderFrameUrl(event));
      assertAmfReady();
      if (silentDownloadQueue === null || provider === null || !provider.amfReady()) return { errorCode: "vua.library.unavailable" };
      const queue = silentDownloadQueue;
      const currentProvider = provider;
      const batchId = `library-download-${crypto.randomUUID()}`;
      const params = { schemaVersion: "0.1" as const, batchId, productId, downloadableIds, ...(replacementTargets === undefined ? {} : { replacementTargets }) };
      if (!isLibraryDownloadParamsV01("library.beginDownload", params)) throw new Error("invalid library download selection");
      const beginParams = params as import("@vua/contracts").LibraryDownloadBeginV01;
      if (await remoteContent?.signInHint() === "none") return { blocked: "sign-in-required" };
      const response = await currentProvider.invoke({
        contractVersion: APPLICATION_CONTRACT_VERSION, requestId: crypto.randomUUID(), correlationId: batchId,
        kind: "command", method: "library.beginDownload", commandId: batchId,
        params: beginParams,
      });
      if (!response.ok) return { errorCode: response.error.code };
      if (!isLibraryDownloadSnapshotV01(response.value) || response.value.batchId !== batchId || response.value.state !== "running"
        || response.value.productId !== beginParams.productId || response.value.files.length !== beginParams.downloadableIds.length
        || response.value.files.some((file) => !beginParams.downloadableIds.includes(file.downloadableId))) throw new Error("library download receipt unconfirmed");
      const accepted = queue.enqueue({ batchId, productId: response.value.productId, downloadableIds: response.value.files.map((file) => file.downloadableId) });
      if (accepted === 0) {
        for (const file of response.value.files) {
          await currentProvider.invoke({
            contractVersion: APPLICATION_CONTRACT_VERSION, requestId: crypto.randomUUID(), correlationId: batchId,
            kind: "command", method: "library.observeDownload", commandId: crypto.randomUUID(),
            params: { schemaVersion: "0.1", batchId, downloadableId: file.downloadableId, outcome: "initiation_failed" },
          });
        }
        return { errorCode: "vua.library.initiation_failed" };
      }
      return { accepted, batchId, taskId: response.value.taskId };
    },
  );
  // 运行状态探针(任务前失败可见性):渲染层轮询 provider 任务之外,经此面
  // 得知「运行已结束且从未产生任务」的终态事实,把卡住的“已开始”翻成失败
  ipcMain.handle("vua:catalog-sync:probe", (event) => {
    assertLocalSender(senderFrameUrl(event));
    assertAmfReady();
    return {
      status: catalogSyncRun !== null ? ("running" as const) : ("idle" as const),
      runId: catalogSyncRun?.runId ?? catalogSyncLastTerminal?.runId ?? null,
      lastFailureCode: catalogSyncRun === null ? catalogSyncLastTerminal?.code ?? null : null,
    };
  });
  // 详情富化(N5 D2,2026-10-03):单商品页抓取 → 同一 ingest 面(provider
  // 自动识别 #items 商品页语法走全量观察);URL 由商品号派生,不放开任意 URL
  ipcMain.handle(
    "vua:catalog-sync:fetch-product",
    async (event, productId: unknown) => {
      assertLocalSender(senderFrameUrl(event));
      assertAmfReady();
      if (remoteContent === null) throw new Error("remote content is unavailable");
      if (typeof productId !== "string" || !/^booth:[0-9]+$/.test(productId)) {
        throw new Error("invalid product id");
      }
      const nativeId = productId.slice("booth:".length);
      const url = `https://booth.pm/zh-cn/items/${nativeId}`;
      const providerRef = provider;
      if (providerRef === null) return { ok: false };
      try {
        const outcome = await remoteContent.fetchWithSession(url);
        if (outcome.status !== 200) return { ok: false };
        const result = await providerRef
          .invoke({
            contractVersion: APPLICATION_CONTRACT_VERSION,
            requestId: crypto.randomUUID(),
            correlationId: crypto.randomUUID(),
            commandId: crypto.randomUUID(),
            kind: "command",
            method: "catalog.ingestLibraryPage",
            params: {
              schemaVersion: "0.2",
              sourceUrl: url,
              html: outcome.body,
              fetchedAt: new Date().toISOString(),
            },
          })
          .then((r) => (r.ok ? { ok: true as const } : { ok: false as const }));
        return result;
      } catch {
        return { ok: false };
      }
    },
  );

  // 导航确认作答(015 §12):只受理本地来源;未知 confirmId/重复作答忽略
  // (渲染层不能伪造未发出的确认);作答后 pending 移除,确认 Promise 落定
  ipcMain.handle("vua:nav-confirm:respond", (event, confirmId: unknown, approved: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof confirmId !== "string" || typeof approved !== "boolean") {
      throw new Error("invalid navigation confirm response");
    }
    const resolve = pendingNavConfirms.get(confirmId);
    if (resolve === undefined) return;
    pendingNavConfirms.delete(confirmId);
    resolve(approved);
  });
}

/**
 * U9(1)/U9(3) 导航确认层(015 §12,批 B-3:渲染层 i18n 确认流):确认在前
 * (A-1 逐次阻断式),确认卡显示完整目标 URL 与放行后果;每次确认,无任何
 * 免确认记忆(A-2)。用户不答=pending 保持=导航不执行(无超时,阻断式确认
 * 的诚实形态);respond 校验 confirmId(渲染层不能伪造未发出的确认,双
 * 作答只首次生效)。导航策略本体在 security.ts 分类与分流——本函数仅是
 * 确认 UI 载体(原生英文对话框已移除,四语化由渲染层确认卡承载)。
 */
const pendingNavConfirms = new Map<string, (approved: boolean) => void>();

function confirmNavigation(
  url: string,
  reason: "origin_not_allowed" | "external_protocol",
): Promise<boolean> {
  const confirmId = crypto.randomUUID();
  return new Promise<boolean>((resolve) => {
    pendingNavConfirms.set(confirmId, resolve);
    const request: NavigationConfirmRequestV1 = { confirmId, url, reason };
    for (const window of BrowserWindow.getAllWindows()) {
      if (isAllowedLocalSender(window.webContents.getURL(), rendererUrl)) {
        window.webContents.send("vua:nav-confirm:request", request);
      }
    }
  });
}

/**
 * Overlay 置顶窗(proposal 017 §4 桌面表态:同一 Electron 进程内的独立
 * BrowserWindow,与主窗口共用同一 VuaDesktopApiV1 preload 面;故障隔离由
 * Provider 独立进程＋渲染进程模型双层承载,不需要独立 Gateway 连接)。
 *
 * - 形态参数(F7a spike 结论):transparent + frameless + skipTaskbar +
 *   hasShadow:false,460×640,alwaysOnTop("screen-saver" 级);渲染面加载
 *   ?surface=overlay-desktop&view=<guide|status>(main.tsx 表面路由既有分流,
 *   不初始化主壳;2026-09-26 additive:view 参数投递首视图,缺省 guide);
 * - 显隐以 showInactive 执行:悬浮窗出现不夺焦点(VRChat 全屏时不打断);
 * - 事件面零新增:broadcastGatewayEvent/isAllowedLocalSender 对 ?surface=
 *   参数 URL 天然放行(前缀/路径匹配),overlay 窗口天然在广播清单内;
 *   唯一例外是视图切换事件 vua:overlay:set-view(2026-09-26 additive)——
 *   只投递给覆盖层窗口本身;
 * - 读面 wire 词表不预接(候选核心批 1,017 内联领取声明):渲染面生产
 *   路径恒为诚实 inactive 空态,本窗口层不含任何快照语义;
 * - 生命周期:显隐切换不销毁(hide 保状态);窗口自身关闭(closed)清引用,
 *   下次 toggle 重建;主窗口关闭(closed)销毁 overlay——主窗口关闭＝应用
 *   退出语义不变(window-all-closed 行为不被悬浮窗拖住)。
 */
function createOverlayWindow(
  view: OverlayViewV1 = "guide",
  guideTarget: GuideTargetV1 | null = null,
): void {
  const preload = path.join(__dirname, "preload.js");
  const win = new BrowserWindow({
    width: OVERLAY_WINDOW_WIDTH,
    height: OVERLAY_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: localWindowWebPreferences(preload),
  });
  tagDevelopmentWindow(win, desktopProfile);
  win.setAlwaysOnTop(true, OVERLAY_WINDOW_LEVEL);
  overlayWindow = win;
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.on("closed", () => {
    if (overlayWindow === win) overlayWindow = null;
  });
  // 首帧投递:视图经 view=,指南定位(首玩 B 切片)经 guideTopic=/guideSection=
  const search = `surface=${OVERLAY_SURFACE_PARAM}&view=${view}${guideTargetQuery(guideTarget)}`;
  if (rendererUrl) void win.loadURL(`${rendererUrl}?${search}`);
  else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"), {
      search,
    });
  }
}

function toggleOverlayWindow(): { readonly visible: boolean } {
  const exists = overlayWindow !== null && !overlayWindow.isDestroyed();
  const decision = decideOverlayWindowAction({
    exists,
    visible: exists && overlayWindow!.isVisible(),
  });
  if (decision === "create") createOverlayWindow();
  else if (decision === "show") overlayWindow!.showInactive();
  else overlayWindow!.hide();
  return { visible: overlayVisibilityAfterDecision(decision) };
}

/**
 * showOverlay 语义(2026-09-26 additive,契约 OverlayWindowShowResultV1):
 * 窗口缺席 = 创建并显示请求视图(首视图经加载查询投递,渲染层首帧即落
 * 正确视图);隐藏 = showInactive 显示并投递视图切换;可见 = 仅投递视图
 * 切换(绝不隐藏)。已开窗的切换经 vua:overlay:set-view 事件投递给覆盖层
 * 窗口本身——发送前校验 webContents 存活,窗口恰在关闭途中则丢弃(下次
 * 创建经查询参数恢复,无状态丢失)。
 */
function showOverlayWindow(view: OverlayViewV1): {
  readonly visible: boolean;
  readonly view: OverlayViewV1;
} {
  const exists = overlayWindow !== null && !overlayWindow.isDestroyed();
  if (!exists) {
    createOverlayWindow(view);
    return { visible: true, view };
  }
  if (!overlayWindow!.isVisible()) overlayWindow!.showInactive();
  if (!overlayWindow!.webContents.isDestroyed()) {
    overlayWindow!.webContents.send("vua:overlay:set-view", view);
  }
  return { visible: true, view };
}

/**
 * showGuide 语义(首玩 B 切片 additive,契约 DesktopWindowApiV1.showGuide):
 * 窗口缺席 = 创建并显示引导视图,定位经加载查询投递(首帧落位);
 * 隐藏 = showInactive 显示并投递;可见 = 仅投递(绝不隐藏)。
 * 已开窗的投递先发 set-view(guide)再发 guide-target——DesktopOverlaySurface
 * 常驻并暂存定位请求,GuideOverlayView 的挂载时序不影响定位到达。
 */
function showGuideWindow(target: GuideTargetV1 | null): {
  readonly visible: boolean;
  readonly view: OverlayViewV1;
} {
  const exists = overlayWindow !== null && !overlayWindow.isDestroyed();
  if (!exists) {
    createOverlayWindow("guide", target);
    return { visible: true, view: "guide" };
  }
  if (!overlayWindow!.isVisible()) overlayWindow!.showInactive();
  if (!overlayWindow!.webContents.isDestroyed()) {
    overlayWindow!.webContents.send("vua:overlay:set-view", "guide");
    overlayWindow!.webContents.send("vua:overlay:guide-target", target);
  }
  return { visible: true, view: "guide" };
}

/**
 * 准备阅读器(三类引导裁决 2026-10-05 additive,契约 DesktopWindowApiV1.
 * showReader):普通不透明可缩放窗口——系统窗框承担最小化/还原/关闭,有
 * 任务栏条目;不置顶、不透明、无边框默认全部不用。打开允许夺焦点(用户
 * 明确动作);后台任务事件不抬起窗口(本窗口不订阅任何广播,事件广播
 * 清单天然只按 URL 放行本地来源,阅读器不主动请求任何事件通道)。
 * 定位:窗口缺席 = 创建并经加载查询 ?guideTopic=/guideSection= 首帧投递;
 * 已开窗 = show + focus 后经 vua:reader:guide-target 事件投递(渲染层
 * ReaderSurface 暂存转发,与覆盖层 guide-target 同纪律)。关闭即销毁:
 * 阅读位置在渲染层 localStorage,重建窗口按上次阅读位置恢复;关闭只关
 * 呈现,安装任务与游戏不受影响。
 */
function createReaderWindow(target: GuideTargetV1 | null): void {
  const preload = path.join(__dirname, "preload.js");
  const win = new BrowserWindow({
    width: READER_WINDOW_WIDTH,
    height: READER_WINDOW_HEIGHT,
    minWidth: READER_WINDOW_MIN_WIDTH,
    minHeight: READER_WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: "#0b0a12",
    webPreferences: localWindowWebPreferences(preload),
  });
  tagDevelopmentWindow(win, desktopProfile);
  readerWindow = win;
  // 普通阅读窗口不带应用菜单:系统窗框只承担最小化/还原/关闭( Electron
  // 默认菜单是无框主窗口看不到的开发遗留,标准窗框下会露出 File/Edit 行)
  win.removeMenu();
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });
  win.on("closed", () => {
    if (readerWindow === win) readerWindow = null;
  });
  const search = `surface=${READER_SURFACE_PARAM}${guideTargetQuery(target)}`;
  if (rendererUrl) void win.loadURL(`${rendererUrl}?${search}`);
  else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"), {
      search,
    });
  }
}

function showReaderWindow(target: GuideTargetV1 | null): { readonly visible: boolean } {
  const exists = readerWindow !== null && !readerWindow.isDestroyed();
  const decision = decideReaderWindowAction({ exists });
  if (decision === "create") {
    createReaderWindow(target);
    return { visible: readerVisibilityAfterDecision(decision) };
  }
  if (readerWindow!.isMinimized()) readerWindow!.restore();
  readerWindow!.show();
  readerWindow!.focus();
  if (!readerWindow!.webContents.isDestroyed()) {
    readerWindow!.webContents.send("vua:reader:guide-target", target);
  }
  return { visible: readerVisibilityAfterDecision(decision) };
}

/**
 * 游戏引导小窗(三类引导 §4 additive,契约 DesktopWindowApiV1.
 * showGameGuide):小型透明置顶窗——transparent + frameless + skipTaskbar +
 * hasShadow:false,360×560 可缩放,alwaysOnTop("screen-saver" 级,盖过全屏
 * 游戏)。打开永远 showInactive:不夺游戏焦点;跟随开启时由
 * gameGuideFollowTick 按游戏窗口观察自动落位/显隐(决策在
 * game-guide-follow.ts)。隐藏走渲染面显式动作(隐藏不销毁,保留
 * 位置与进度),已开窗(含隐藏态)的打开 = showInactive 恢复。透明度由
 * 渲染面就地调节并持久化,不经 Main。
 */
function createGameGuideWindow(): void {
  const preload = path.join(__dirname, "preload.js");
  const win = new BrowserWindow({
    width: GAME_GUIDE_WINDOW_WIDTH,
    height: GAME_GUIDE_WINDOW_HEIGHT,
    minWidth: GAME_GUIDE_WINDOW_MIN_WIDTH,
    minHeight: GAME_GUIDE_WINDOW_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: localWindowWebPreferences(preload),
  });
  tagDevelopmentWindow(win, desktopProfile);
  win.setAlwaysOnTop(true, GAME_GUIDE_WINDOW_LEVEL);
  gameGuideWindow = win;
  let savedPlacementKey = JSON.stringify(gameGuideFollow.relativePlacement);
  // will-move is emitted for a player drag, not an automatic setBounds.
  win.on("will-move", (_event, bounds) => {
    if (win.isVisible()) gameGuideFollow = recordGuideDrag(gameGuideFollow, bounds);
  });
  win.on("moved", () => {
    const placement = gameGuideFollow.relativePlacement;
    const key = JSON.stringify(placement);
    if (placement && key !== savedPlacementKey && writeGuidePlacement(gameGuidePlacementFile, placement)) savedPlacementKey = key;
  });
  // 跟随定时器随窗口创建惰性启动(跟随开启时);窗口销毁即停,绝不并跑
  ensureGameGuideFollowTimer();
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.on("closed", () => {
    if (gameGuideWindow === win) gameGuideWindow = null;
    stopGameGuideFollowTimer();
  });
  const search = `surface=${GAME_GUIDE_SURFACE_PARAM}`;
  if (rendererUrl) void win.loadURL(`${rendererUrl}?${search}`);
  else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"), {
      search,
    });
  }
}

function showGameGuideWindow(): { readonly visible: boolean } {
  const exists = gameGuideWindow !== null && !gameGuideWindow.isDestroyed();
  const decision = decideGameGuideWindowAction({ exists });
  if (decision === "create") {
    createGameGuideWindow();
    return { visible: gameGuideVisibilityAfterDecision(decision) };
  }
  if (gameGuideWindow!.isMinimized()) gameGuideWindow!.restore();
  gameGuideWindow!.showInactive();
  return { visible: gameGuideVisibilityAfterDecision(decision) };
}

/** 游戏引导窗隐藏(渲染面显式动作):隐藏不销毁,保留位置与进度呈现 */
function hideGameGuideWindow(): void {
  if (gameGuideWindow !== null && !gameGuideWindow.isDestroyed() && gameGuideWindow.isVisible()) {
    gameGuideWindow.hide();
  }
}

/**
 * 游戏窗口物理矩形 → DIP(game-guide follow 切片):provider 观察是物理
 * 像素,setBounds 收 DIP。首选 screenToDipRect(win32;window=null = 按矩形
 * 所在显示器换算——跟随跨显示器/DPI 变化);非 Windows 平台该 API 缺席时
 * 按匹配显示器 scaleFactor 换算回落。本函数永不触碰游戏窗口本身。
 */
function gameWindowRectToDip(rect: GameWindowRectPhysicalV1): DipRect {
  if (typeof screen.screenToDipRect === "function") {
    const dip = screen.screenToDipRect(null, rect);
    return { x: dip.x, y: dip.y, width: dip.width, height: dip.height };
  }
  const scale = screen.getDisplayMatching(rect).scaleFactor || 1;
  return {
    x: Math.round(rect.x / scale),
    y: Math.round(rect.y / scale),
    width: Math.round(rect.width / scale),
    height: Math.round(rect.height / scale),
  };
}

/** 跟随定时器:引导窗在位且跟随开启才运行;幂等,绝不并跑两个 */
function ensureGameGuideFollowTimer(): void {
  if (gameGuideFollowTimer !== null) return;
  if (!gameGuideFollow.followEnabled) return;
  if (gameGuideWindow === null || gameGuideWindow.isDestroyed()) return;
  gameGuideFollowTimer = setInterval(() => {
    void gameGuideFollowTick();
  }, 250);
}

function stopGameGuideFollowTimer(): void {
  if (gameGuideFollowTimer !== null) {
    clearInterval(gameGuideFollowTimer);
    gameGuideFollowTimer = null;
  }
}

/**
 * 跟随 tick(guidance §4 自动跟随):向 provider 查询 environment.
 * observeGameWindow,决策在 game-guide-follow.ts(纯函数)。纪律:
 * - 跟随关闭/窗口缺席 = 跳过(手动打开的窗口保持纯手动);
 * - provider 未就绪(state ≠ ready)、应用错误(vua.game_window.*)或
 *   响应形状违反 = recordUnknownTick 诚实缺席,本 tick 无动作——通道
 *   打嗝绝不当作游戏缺席;
 * - 动作接缝:show = setBounds + showInactive(永不夺焦点,唯一显示
 *   路径);move = 仅可见时 setBounds;hide = hide();
 * - 响应到达时重读窗口/状态(查询在途期间可能已有手动显隐)。
 */
async function gameGuideFollowTick(): Promise<void> {
  const win = gameGuideWindow;
  if (!gameGuideFollow.followEnabled || win === null || win.isDestroyed()) return;
  const running = provider;
  let providerReady = false;
  try {
    providerReady = running !== null && running.status().state === "ready";
  } catch {
    providerReady = false;
  }
  if (running === null || !providerReady) {
    gameGuideFollow = recordUnknownTick(gameGuideFollow);
    return;
  }
  gameGuideFollowSeq += 1;
  const requestId = `game-guide-follow-${gameGuideFollowSeq}`;
  let response: Awaited<ReturnType<OrchestratorProviderV01["invoke"]>>;
  try {
    response = await running.invoke({
      contractVersion: APPLICATION_CONTRACT_VERSION,
      requestId,
      correlationId: requestId,
      kind: "query",
      method: "environment.observeGameWindow",
      params: {},
    });
  } catch {
    gameGuideFollow = recordUnknownTick(gameGuideFollow);
    return;
  }
  if (!response.ok || !isGameWindowObservationResult(response.value)) {
    gameGuideFollow = recordUnknownTick(gameGuideFollow);
    return;
  }
  if (win.isDestroyed() || gameGuideWindow !== win || !gameGuideFollow.followEnabled) return;
  const { action, next } = decideFollowTick(
    gameGuideFollow,
    response.value.gameWindow,
    { visible: win.isVisible(), focused: win.isFocused() },
    win.getBounds(),
    gameWindowRectToDip,
  );
  gameGuideFollow = next;
  if (action === null) return;
  if (action.kind === "hide") {
    win.hide();
    return;
  }
  win.setBounds(action.placement);
  if (action.kind === "show") win.showInactive();
}

async function createWindow(): Promise<void> {
  const preload = path.join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    /* 默认 1440×900(2026-09-25):顶栏新增占用查看器后,1280 下全量 Tab
     * 排不下(两级折叠会收进折叠按钮);1440 保证默认窗口即完整顶栏 */
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: "#0b0a12",
    webPreferences: {
      ...localWindowWebPreferences(preload),
      /* 遮挡误判防护(2026-09-26):Windows 下 Chromium 偶发把可见的无边框
       * 主窗口误判为被遮挡→停止产帧,界面定格在旧样式(截图/强制的
       * BeginFrame 一来又"自愈",观测即治愈)。关闭后台节流后误判期
       * rAF/计时器照走,症状面消除;代价是窗口真最小化时仍有少量帧
       * 调度开销。悬浮窗恒置顶不被遮挡,不在此列。 */
      backgroundThrottling: false,
    },
  });

  tagDevelopmentWindow(mainWindow, desktopProfile);
  // Native mouse side buttons use Chromium history, including same-document Help routes.
  mainWindow.on("app-command", (_event, command) => {
    const navigation = mainWindow?.webContents.navigationHistory;
    if (command === "browser-backward" && navigation?.canGoBack()) navigation.goBack();
    else if (command === "browser-forward" && navigation?.canGoForward()) navigation.goForward();
  });
  mainWindow.webContents.on("did-navigate", () => { shellListening = false; });
  // Hash navigation can emit did-start-loading without remounting the shell listener.
  mainWindow.webContents.on("did-navigate", () => { encyclopediaListening = false; });

  // U9 四分法(本地壳窗口):http/https 弹窗不再交系统浏览器——清单内直行/
  // 清单外确认后转当前内嵌视图(RemoteContentManager);外部协议手势+确认后
  // 交系统;伪协议无条件拒。浏览允许清单与下载域清单严格分开(U9 双轨)
  installLocalContentNavigationPolicy(mainWindow.webContents, {
    rendererUrl,
    allowedOrigins: ["https://booth.pm"],
    // 延迟读取模块变量:弹窗发生时 remoteContent 已随窗口创建
    navigateCurrentView: (url) => {
      remoteContent?.openAfterConfirmation(url);
    },
    openExternal: (url) => void shell.openExternal(url),
    confirmNavigation,
  });
  mainWindow.once("ready-to-show", () => { if (!packagedSmoke) mainWindow?.show(); });

  if (provider?.amfReady()) await ensureAmfShell();
  mainWindow.on("resize", () => remoteContent?.refreshBounds());
  // #26 用户实测退出崩溃修复:内嵌视图清理前移到 close(窗口仍存活,
  // contentView 可安全操作);closed 在窗口销毁之后触发,原在此处 dispose
  // 会经 #destroyView 访问已销毁 hostWindow 抛「Object has been destroyed」。
  // closed 只做引用清理与 overlay 销毁,不再触任何 remoteContent 原生面。
  // close 无取消路径(壳内关闭不经 beforeinput 拦截),dispose 幂等,重复
  // 触发安全
  mainWindow.on("close", () => {
    disposeAmfShell?.();
    disposeAmfShell = null;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    shellListening = false;
    encyclopediaListening = false;
    pendingEncyclopediaTarget = undefined;
    pendingShellCommand = null;
    // 主窗口关闭＝应用退出语义:悬浮窗、阅读器与游戏引导窗都不拖住
    // window-all-closed(窗口随主窗口生命周期销毁,closed 处理器自行清引用)
    overlayWindow?.destroy();
    readerWindow?.destroy();
    gameGuideWindow?.destroy();
  });

  if (rendererUrl) await mainWindow.loadURL(rendererUrl);
  else await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

async function ensureAmfShell(): Promise<void> {
  if (mainWindow === null || !provider?.amfReady()) return;
  if (disposeAmfShell !== null) { await registerImageCacheProtocol(amfDataRoot()); return; }
  if (mountingAmfShell) return mountingAmfShell;
  mountingAmfShell = (async () => {
    await registerImageCacheProtocol(amfDataRoot());
    if (mainWindow === null || !provider?.amfReady()) { deactivateImageCache(); return; }
    // 下载端口(F4-3/F4-4):will-download 接管 + 冻结词表事件规范化。事件汇
    // 按传输定案批量投递 download.ingest(at-least-once:回执裁剪缓冲 + BDL
    // 去重;投递失败按指数退避自主重试,不依赖后续新事件——抽至
    // download-ingest.ts,行为有单测)。握手未声明下载域时诚实降级写诊断
    // 通道。暂存根跟随用户数据目录布局,由注入决定,端口不自选策略
    const ingestSink = createDownloadEventSink({
      onPersisted: (event) => silentDownloadQueue?.notifyPersisted(event),
      onRejected: (event) => silentDownloadQueue?.notifyUnconfirmed(event),
      onDropped: (event) => silentDownloadQueue?.notifyUnconfirmed(event),
      invoke: (params) => {
        if (provider === null) {
          return Promise.reject(new Error("provider is not running"));
        }
        return provider
          .invoke({
            contractVersion: APPLICATION_CONTRACT_VERSION,
            requestId: crypto.randomUUID(),
            correlationId: crypto.randomUUID(),
            commandId: crypto.randomUUID(),
            kind: "command",
            method: "download.ingest",
            params,
          })
          .then((response) =>
            response.ok
              ? { ok: true as const, value: response.value }
              : Promise.reject(new Error(response.error.code)),
          );
      },
    });
    amfIngestSink = ingestSink;
    const downloadSink = {
      emit: (event: DownloadEventV01): void => {
        silentDownloadQueue?.notifyTransport(event);
        if (provider?.amfReady() === true) ingestSink.emit(event);
        else {
          silentDownloadQueue?.notifyUnconfirmed(event);
          process.stderr.write(JSON.stringify({ channel: "download-events", kind: event.kind, downloadId: event.downloadId, persistenceUnavailable: true }) + "\n");
        }
      },
    };
    downloadPort = new DownloadPort({
      stagingRoot: path.join(amfDataRoot(), "downloads-staging"),
      partitionSession: session.fromPartition("persist:vua-remote"),
      allowedOrigins: ["https://booth.pm"],
      sink: downloadSink,
      isAwaitingLibraryRequest: (originalUrl) => silentDownloadQueue?.isAwaitingNative(originalUrl) === true,
    });
    // 静默下载编排(N5,2026-10-05 用户裁决):串行 + 6s 源站礼貌间隔,经
    // downloadURL 走 will-download 管道(暂存/事件/九态任务/采纳全复用)
    silentDownloadQueue = createSilentDownloadQueue({
      partitionSession: session.fromPartition("persist:vua-remote"),
      abandon: (downloadId) => downloadPort?.applyIntent(downloadId, "abandon"),
      observe: async (params) => {
        if (provider === null) throw new Error("provider unavailable");
        const response = await provider.invoke({
          contractVersion: APPLICATION_CONTRACT_VERSION, requestId: crypto.randomUUID(), correlationId: params.batchId,
          kind: "command", method: "library.observeDownload", commandId: crypto.randomUUID(), params,
        });
        if (!response.ok || !isLibraryDownloadSnapshotV01(response.value)
          || response.value.batchId !== params.batchId) throw new Error("library receipt unconfirmed");
      },
    });

    // 远程内容管理器(F4-2):独立 partition Session;目录浏览域为种子允许清单,
    // 真实值随 catalog 契约冻结(F4-1②)调整;违规事件广播到本地来源窗口;
    // 确认层注入使 U9(1) 清单外「提示后放行」与 U9(3) 外部协议确认在视图内生效。
    // 登录链域(真机首验 2026-10-02 修正):BOOTH 登录实际走 pixiv SSO——
    // accounts.booth.pm 起步 → oauth.secure.pixiv.net 授权 → accounts.pixiv.net
    // 登录/选号 → 回跳 booth.pm。W25 走查缺陷③b 只认账户子域的假设不完整:
    // 缺 pixiv 两域时 OAuth 跳转被导航策略无声拦截,「继续使用此账号」点击
    // 无任何可见效果,登录永远无法完成。本清单只放行导航;下载域清单仍仅
    // booth.pm(素材获取边界不变)。
    remoteContent = new RemoteContentManager({
      partition: "persist:vua-remote",
      allowedOrigins: [
        "https://booth.pm",
        "https://accounts.booth.pm",
        "https://oauth.secure.pixiv.net",
        "https://accounts.pixiv.net",
      ],
      openExternal: (url) => void shell.openExternal(url),
      broadcast: (event) => broadcastRemoteContentEvent(rendererUrl, event),
      confirmNavigation,
      willDownload: (event, item, webContents) => {
        if (!provider?.amfReady()) { event.preventDefault(); return; }
        downloadPort?.handleWillDownload(event, item, webContents);
      },
    });
    remoteContent.setHostWindow(mainWindow);
    disposeAmfShell = () => {
      catalogSyncRun?.stop(); catalogSyncRun = null;
      remoteContent?.dispose(); remoteContent = null;
      ingestSink.dispose(); amfIngestSink = null; silentDownloadQueue?.dispose(); silentDownloadQueue = null;
      downloadPort = null;
      materialSources.clear();
      deactivateImageCache();
    };
  })();
  try { await mountingAmfShell; } finally { mountingAmfShell = null; }
}

app.whenReady().then(async () => {
  amfRegistry = new AmfRegistry(app.getPath("userData"));
  provider = new ModuleProvider({
    host: createDesktopOrchestratorProvider(resolveProviderEndpoint()),
    enabled: amfRegistry.registration.enabled,
    persist: enabled => amfRegistry!.save(enabled),
    createAmf: () => createDesktopOrchestratorProvider(resolveAmfEndpoint()),
    shellBusy: () => catalogSyncRun !== null || (silentDownloadQueue?.pending() ?? 0) > 0
      || downloadPort?.hasActiveTransfers() === true || amfIngestSink?.pending() === true,
  });
  provider.subscribeModule(snapshot => {
    void (async () => {
      if (snapshot.state === "ready") await ensureAmfShell();
      else if (snapshot.state === "absent") { disposeAmfShell?.(); disposeAmfShell = null; }
      else deactivateImageCache();
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && isAllowedLocalSender(window.webContents.getURL(), rendererUrl)) window.webContents.send("vua:amf-module:changed", snapshot);
      }
    })().catch(error => console.error("[vua] AMF shell unavailable:", error));
  });
  try {
    await provider.start();
  } catch (error) {
    /* 启动韧性(2026-09-26):Provider 起不来(如端口被僵尸实例占用)不再
     * 带走主窗口——历史症状是"启动器打印版本号后永远无窗口"。窗口照常
     * 开,Gateway 调用经既有拒绝路径如实呈现不可用,恢复手段=重启应用。 */
    console.error("[vua] provider start failed; main window still opens:", error);
  }
  provider.subscribe((event) => {
    if (event.kind === "task.cancellationRequested" && event.taskId === catalogSyncRun?.runId) {
      catalogSyncRun.stop();
    }
    if (event.kind === "task.cancellationRequested" && event.taskId.startsWith("library-download-")) silentDownloadQueue?.cancel(event.taskId);
    if (event.kind === "download.intent") {
      // 端口意图:intentSeq 去重后串行解释;Main 内部消费,不广播渲染层
      const { downloadId, intent, intentSeq } = event.payload;
      const last = lastAppliedIntentSeq.get(downloadId) ?? -1;
      if (intentSeq <= last) return;
      lastAppliedIntentSeq.set(downloadId, intentSeq);
      // 意图直通:applyIntent 按冻结裁定解释 resume/retry/abandon
      downloadPort?.applyIntent(downloadId, intent);
      return;
    }
    broadcastGatewayEvent(rendererUrl, event);
  });
  installPermissionDenyPolicy(session.defaultSession);
  registerIpc(provider);
  systemUsage.start();
  await createWindow();
  if (packagedSmoke && mainWindow) {
    await packagedSmoke.verify(mainWindow, provider);
    return;
  }
  systemTray = createVuaTray({ locale: shellLocale ?? app.getLocale(), showMain: focusMainWindow, command: sendShellCommand, quit: () => app.quit() });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error: unknown) => {
  if (packagedSmoke) packagedSmoke.fail(error);
  else {
    console.error("[vua] desktop bootstrap failed:", error);
    dialog.showErrorBox("VUA", startupFailureCopy(app.getLocale()));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => { systemTray?.dispose(); systemTray = null; });

/**
 * 进程关闭协议(M2 交付):退出前先 prepareShutdown——关闭新调用入口并等待
 * 在途修改任务到安全边界;超时出现阻塞任务时,当前阶段尚无用户询问 UI,
 * 以 Kernel 生成的用户决定 ID 强制退出(F3 任务中心接入询问流),遗留任务
 * 由 SQLite 权威状态标记 inspect_required,下次启动如实呈现。
 */
app.on("before-quit", (event) => {
  systemUsage.stop();
  stopGameGuideFollowTimer();
  if (provider === null || shutdownStarted || provider.status().state === "stopped") return;
  event.preventDefault();
  shutdownStarted = true;
  void (async () => {
    try {
      const result = await provider!.prepareShutdown({ timeoutMs: 3_000 });
      if (result.outcome === "needs_user_choice") {
        await provider!.continueShutdown({
          decision: "force",
          userDecisionId: crypto.randomUUID(),
        });
      }
    } catch {
      /* Provider 已不可达:进程树遏制保证子进程随后终止 */
    } finally {
      app.quit();
    }
  })();
});

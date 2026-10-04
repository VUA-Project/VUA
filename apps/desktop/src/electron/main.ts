import { dialogStrings, startupFailureCopy } from "./dialog-i18n.js";
import { app, BrowserWindow, dialog, ipcMain, net, session, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  ApplicationEventV01,
  DownloadEventV01,
  EditorSettingsV1,
  GuideTargetV1,
  NavigationConfirmRequestV1,
  OverlayViewV1,
  RemoteContentEventV1,
} from "@vua/contracts";
import { APPLICATION_CONTRACT_VERSION } from "@vua/contracts";
import type { OrchestratorProviderV01 } from "@vua/orchestrator-provider";
import { routeDesktopGatewayInvoke } from "./gateway-router.js";
import { DownloadPort } from "./download-port.js";
import { createDownloadEventSink } from "./download-ingest.js";
import { RemoteContentManager } from "./remote-content.js";
import { createDesktopOrchestratorProvider } from "./provider-bootstrap.js";
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

const desktopRuntime = resolveDesktopRuntime({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  mainDirectory: __dirname,
  platform: process.platform,
  env: process.env,
});
const rendererUrl = desktopRuntime.rendererUrl;
// Keep distributed app data stable when the ZIP moves or a later installer replaces it.
// The development profile stays separate; the smoke harness selects its own temporary profile.
if (app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "VUA"));
const packagedSmoke = preparePackagedSmoke();
let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let provider: OrchestratorProviderV01 | null = null;
let remoteContent: RemoteContentManager | null = null;
let downloadPort: DownloadPort | null = null;
// 系统资源占用采集器(顶栏占用查看器):whenReady 启动,退出前 stop
const systemUsage = new SystemUsageCollector();
let providerHandshake: Awaited<ReturnType<OrchestratorProviderV01["start"]>> | null = null;
const lastAppliedIntentSeq = new Map<string, number>();
let shutdownStarted = false;

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
function materialSourcesPath(): string {
  return path.join(app.getPath("userData"), "material-sources.json");
}

/** 注册面写盘:内存为准落盘(全量覆写,原子写);写失败即本次拾取失败
 *  (handler 拒绝,渲染层如实呈现)——登记不能只报成功不留盘,否则同一
 *  易失缺陷静默回归 */
function persistMaterialSources(): void {
  writeMaterialSourcesToFile(materialSourcesPath(), materialSources, new Date().toISOString());
}

/** 启动载入(进程 ready 后、IPC 注册前):落盘事实为准;损坏文件已由
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
  const productionRoot = path.join(app.getPath("userData"), "production");
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

/**
 * 受监督 Provider 端点解析(M2):
 * - 可执行文件:分发包取 resources/provider;开发环境允许覆盖或取仓库构建产物。
 *   文件缺失即启动失败——
 *   诚实失败优于静默回落 Mock;
 * - 任务库:用户数据目录,跨重启持久(重启恢复验收的权威来源);
 * - Provider 运行时根(用户实测缺口修复 2026-09-12):数据根=用户数据目录
 *   本身(BDL/记录/temp/生产用例文档按 bin 约定落 bdl/records/temp/production
 *   子目录,与壳内 resolveProductionContext 的 production 布局同源);仓储根
 *   与生产作业项目根为确定性路径。缺失即仓储/下载/生产用例面诚实不可用,
 *   Provider 正常运行(渲染层呈现诚实空态),此处保证服务面在场。
 */
/** 壳编辑器设置落盘路径(U10 门③留痕,机器级 settings) */
function editorSettingsPath(): string {
  return path.join(app.getPath("userData"), "editor-settings.json");
}

function resolveProviderEndpoint(): {
  executablePath: string;
  databasePath: string;
  providerDataRoot: string;
  warehouseRoot: string;
  projectRoot: string;
  /** 门③已确认手选编辑器(null = 无手选):经 VUA_UNITY_EDITOR 注入消费;
   *  读取于 provider 启动时刻,确认留痕后的注入生效时机 = 下次进程启动,
   *  设置面如实标注(诚实纪律:不宣称即时生效) */
  unityEditorPath: string | null;
} {
  const executablePath = desktopRuntime.providerExecutable;
  if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
    throw new Error(
      app.isPackaged
        ? `The bundled VUA backend is missing. Extract the complete ZIP again: ${executablePath}`
        : `Provider executable is missing: ${executablePath} (build it with: cargo build --release -p vua-provider-host --bin vua-orchestrator-provider)`,
    );
  }
  const userData = app.getPath("userData");
  const providerDataRoot = userData;
  const warehouseRoot = path.join(userData, "warehouse");
  const projectRoot = path.join(userData, "production", "synthetic-avatar-project");
  // U10 手选注入:门③确认留痕在位才注入(无手选 = null,零配置直用策略
  // 由核心组装面决策,壳只透传显式手选——021 核心表态 2)
  const editorSettings = readEditorSettingsFromFile(editorSettingsPath());
  const unityEditorPath = editorSettings.confirmedEditor?.path ?? null;
  // 目录创建防首次运行失败:Provider 侧 SQLite/文档存储期望根已存在
  // (mkdir recursive 对已存在目录是幂等 no-op)
  for (const dir of [warehouseRoot, projectRoot]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const databasePath = path.join(userData, "orchestrator", "provider.db");
  return { executablePath, databasePath, providerDataRoot, warehouseRoot, projectRoot, unityEditorPath };
}

function registerIpc(provider: OrchestratorProviderV01): void {
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
    const result = await dialog.showOpenDialog({
      title: dialogStrings(locale).warehouse,
      properties: ["openDirectory", "multiSelections"] as ("openFile" | "openDirectory" | "multiSelections")[],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths;
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
    if (mainWindow === null || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  // 远程内容窄面(F4-2 隔离基座):Renderer 只发语义动作;来源允许清单在
  // Main 侧裁决,视图内违规以事件透明上报。种子允许清单只含目录浏览域,
  // 真实值随 catalog 契约冻结(F4-1②)调整
  ipcMain.handle("vua:remote-content:open", (event, request: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    const url = (request as { url?: unknown } | null)?.url;
    if (typeof url !== "string") throw new Error("invalid remote content request");
    return remoteContent!.open(url);
  });
  ipcMain.handle("vua:remote-content:navigate", (event, viewId: unknown, url: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof viewId !== "string" || typeof url !== "string") throw new Error("invalid remote content request");
    return remoteContent!.navigate(viewId, url);
  });
  // 视图内导航历史(固定导航条动作面):身份守卫在管理器,本地来源守卫在此
  ipcMain.handle("vua:remote-content:go-back", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    return remoteContent!.goBack(viewId);
  });
  ipcMain.handle("vua:remote-content:go-forward", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    return remoteContent!.goForward(viewId);
  });
  ipcMain.handle("vua:remote-content:reload", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    return remoteContent!.reload(viewId);
  });
  ipcMain.handle("vua:remote-content:close", (event, viewId: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof viewId !== "string") throw new Error("invalid remote content request");
    remoteContent!.close(viewId);
  });
  ipcMain.handle("vua:remote-content:set-visible", (event, viewId: unknown, visible: unknown) => {
    assertLocalSender(senderFrameUrl(event));
    if (typeof viewId !== "string" || typeof visible !== "boolean") throw new Error("invalid remote content request");
    return remoteContent!.setVisible(viewId, visible);
  });
  // BOOTH 登录态线索(W25 走查缺陷③b):只读探测本机分区 Cookie 存在性,
  // Cookie 值不过 IPC;探测失败在管理器内归并为 "unknown"(诚实未知)
  ipcMain.handle("vua:remote-content:sign-in-hint", (event) => {
    assertLocalSender(senderFrameUrl(event));
    return remoteContent!.signInHint();
  });

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

  // 下载端口(F4-3/F4-4):will-download 接管 + 冻结词表事件规范化。事件汇
  // 按传输定案批量投递 download.ingest(at-least-once:回执裁剪缓冲 + BDL
  // 去重;投递失败按指数退避自主重试,不依赖后续新事件——抽至
  // download-ingest.ts,行为有单测)。握手未声明下载域时诚实降级写诊断
  // 通道。暂存根跟随用户数据目录布局,由注入决定,端口不自选策略
  const ingestSink = createDownloadEventSink({
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
  const downloadSink = {
    emit: (event: DownloadEventV01): void => {
      if (providerHandshake?.downloadIngest === true) {
        ingestSink.emit(event);
      } else {
        process.stderr.write(`${JSON.stringify({ channel: "download-events", ...event })}\n`);
      }
    },
  };
  downloadPort = new DownloadPort({
    stagingRoot: path.join(app.getPath("userData"), "downloads-staging"),
    partitionSession: session.fromPartition("persist:vua-remote"),
    allowedOrigins: ["https://booth.pm"],
    sink: downloadSink,
  });

  // 远程内容管理器(F4-2):独立 partition Session;目录浏览域为种子允许清单,
  // 真实值随 catalog 契约冻结(F4-1②)调整;违规事件广播到本地来源窗口;
  // 确认层注入使 U9(1) 清单外「提示后放行」与 U9(3) 外部协议确认在视图内生效。
  // accounts.booth.pm(W25 走查缺陷③b):登录/库/会话唯一账户子域——未登录
  // 引导首导登录页需直行该域(否则登录引导被清单拒绝),视图内登录跳转
  // 同域受益;仅内嵌浏览清单扩此域,下载域清单与本地窗口弹窗清单不动
  remoteContent = new RemoteContentManager({
    partition: "persist:vua-remote",
    allowedOrigins: ["https://booth.pm", "https://accounts.booth.pm"],
    openExternal: (url) => void shell.openExternal(url),
    broadcast: (event) => broadcastRemoteContentEvent(rendererUrl, event),
    confirmNavigation,
    willDownload: (event, item, webContents) => downloadPort?.handleWillDownload(event, item, webContents),
  });
  remoteContent.setHostWindow(mainWindow);
  mainWindow.on("resize", () => remoteContent?.refreshBounds());
  // #26 用户实测退出崩溃修复:内嵌视图清理前移到 close(窗口仍存活,
  // contentView 可安全操作);closed 在窗口销毁之后触发,原在此处 dispose
  // 会经 #destroyView 访问已销毁 hostWindow 抛「Object has been destroyed」。
  // closed 只做引用清理与 overlay 销毁,不再触任何 remoteContent 原生面。
  // close 无取消路径(壳内关闭不经 beforeinput 拦截),dispose 幂等,重复
  // 触发安全
  mainWindow.on("close", () => {
    remoteContent?.dispose();
    remoteContent = null;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    // 主窗口关闭＝应用退出语义:悬浮窗不拖住 window-all-closed(overlay
    // 窗口随主窗口生命周期销毁,closed 处理器自行清引用)
    overlayWindow?.destroy();
  });

  if (rendererUrl) await mainWindow.loadURL(rendererUrl);
  else await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  // 素材登记持久化(W25 易失缺陷修复):先载入落盘事实再开放 IPC 面,
  // 保证首个渲染层请求可见的登记与上一次会话一致
  loadMaterialSourcesFromDisk();
  provider = createDesktopOrchestratorProvider(resolveProviderEndpoint());
  try {
    providerHandshake = await provider.start();
  } catch (error) {
    /* 启动韧性(2026-09-26):Provider 起不来(如端口被僵尸实例占用)不再
     * 带走主窗口——历史症状是"启动器打印版本号后永远无窗口"。窗口照常
     * 开,Gateway 调用经既有拒绝路径如实呈现不可用,恢复手段=重启应用。 */
    console.error("[vua] provider start failed; main window still opens:", error);
  }
  provider.subscribe((event) => {
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

/**
 * 进程关闭协议(M2 交付):退出前先 prepareShutdown——关闭新调用入口并等待
 * 在途修改任务到安全边界;超时出现阻塞任务时,当前阶段尚无用户询问 UI,
 * 以 Kernel 生成的用户决定 ID 强制退出(F3 任务中心接入询问流),遗留任务
 * 由 SQLite 权威状态标记 inspect_required,下次启动如实呈现。
 */
app.on("before-quit", (event) => {
  systemUsage.stop();
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

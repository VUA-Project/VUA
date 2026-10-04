import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ApplicationEventV01,
  DesktopGatewayRequestV1,
  EditorSettingsV1,
  GuideTargetV1,
  NavigationConfirmRequestV1,
  OverlayViewV1,
  RemoteContentEventV1,
  VuaDesktopApiV1,
} from "@vua/contracts";

// 沙箱 preload 只允许 require electron 白名单模块:@vua/contracts 在此仅做
// 类型导入(编译期擦除,不产生运行时 require)。DESKTOP_GATEWAY_VERSION 以
// 本地字面量对齐,漂移由 packages/contracts 的契约测试把守。
const DESKTOP_GATEWAY_VERSION = 1 as const;

/** contextBridge 会克隆回调:持有原监听器到包装器的映射,保证退订精确移除 */
const eventListeners = new WeakMap<
  (event: ApplicationEventV01) => void,
  (event: IpcRendererEvent, payload: ApplicationEventV01) => void
>();

const remoteContentListeners = new WeakMap<
  (event: RemoteContentEventV1) => void,
  (event: IpcRendererEvent, payload: RemoteContentEventV1) => void
>();

const navConfirmListeners = new WeakMap<
  (request: NavigationConfirmRequestV1) => void,
  (event: IpcRendererEvent, payload: NavigationConfirmRequestV1) => void
>();

const overlayViewListeners = new WeakMap<
  (view: OverlayViewV1) => void,
  (event: IpcRendererEvent, payload: OverlayViewV1) => void
>();

const guideTargetListeners = new WeakMap<
  (target: GuideTargetV1 | null) => void,
  (event: IpcRendererEvent, payload: GuideTargetV1 | null) => void
>();

const api: VuaDesktopApiV1 = Object.freeze({
  gateway: Object.freeze({
    version: DESKTOP_GATEWAY_VERSION,
    invoke: (request: DesktopGatewayRequestV1) => ipcRenderer.invoke("vua:gateway:invoke", request),
  }),
  dialog: Object.freeze({
    pickMaterialSource: (intake: "direct_unity_package" | "local_reusable_vpm") =>
      ipcRenderer.invoke("vua:dialog:pick-material-source", intake, document.documentElement.lang),
    pickWarehouseFolders: () => ipcRenderer.invoke("vua:dialog:pick-warehouse-folders", document.documentElement.lang),
    // U10 手选编辑器路径(021 收敛点 4:双态浏览;取消返回 null)
    pickEditorExecutable: () => ipcRenderer.invoke("vua:dialog:pick-editor-path", "executable", document.documentElement.lang),
    pickEditorDirectory: () => ipcRenderer.invoke("vua:dialog:pick-editor-path", "directory", document.documentElement.lang),
  }),
  // 壳编辑器设置(U10 门③留痕:手选值物理持久化归桌面机器级 settings,
  // 核心经 VUA_UNITY_EDITOR 注入消费)
  editorSettings: Object.freeze({
    read: () => ipcRenderer.invoke("vua:editor-settings:read"),
    save: (settings: EditorSettingsV1) => ipcRenderer.invoke("vua:editor-settings:save", settings),
  }),
  events: Object.freeze({
    subscribe: (listener: (event: ApplicationEventV01) => void) => {
      const wrapped = (_event: IpcRendererEvent, payload: ApplicationEventV01) => listener(payload);
      eventListeners.set(listener, wrapped);
      ipcRenderer.on("vua:gateway:event", wrapped);
      return () => {
        const wrappedListener = eventListeners.get(listener);
        if (wrappedListener) ipcRenderer.removeListener("vua:gateway:event", wrappedListener);
        eventListeners.delete(listener);
      };
    },
  }),
  window: Object.freeze({
    minimize: () => ipcRenderer.invoke("vua:window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("vua:window:toggle-maximize"),
    close: () => ipcRenderer.invoke("vua:window:close"),
    // Overlay 置顶窗开关(proposal 017 实现面备注):同一 preload 契约面对
    // 主窗口与 overlay 窗口共用,零新增连接语义
    toggleOverlay: () => ipcRenderer.invoke("vua:overlay:toggle"),
    // 打开/聚焦覆盖层并切视图(2026-09-26 additive):缺省 guide;undefined
    // 经 IPC 序列化为 null,Main 侧按 null=缺省收窄
    showOverlay: (view?: OverlayViewV1) => ipcRenderer.invoke("vua:overlay:show", view ?? null),
    // 覆盖层视图事件(2026-09-26 additive):Main 只投递给覆盖层窗口本身
    overlayViewEvents: Object.freeze({
      subscribe: (listener: (view: OverlayViewV1) => void) => {
        const wrapped = (_event: IpcRendererEvent, payload: OverlayViewV1) => listener(payload);
        overlayViewListeners.set(listener, wrapped);
        ipcRenderer.on("vua:overlay:set-view", wrapped);
        return () => {
          const wrappedListener = overlayViewListeners.get(listener);
          if (wrappedListener) ipcRenderer.removeListener("vua:overlay:set-view", wrappedListener);
          overlayViewListeners.delete(listener);
        };
      },
    }),
    // 指南定位(首玩 B 切片 additive):按主题+分节打开引导;形状收窄在
    // Main,词表回退在渲染层;undefined 经 IPC 序列化为 null(仅打开)
    showGuide: (target?: GuideTargetV1 | null) =>
      ipcRenderer.invoke("vua:overlay:show-guide", target ?? null),
    // 收起覆盖层(隐藏不销毁;幂等,绝不创建窗口)
    hideOverlay: () => ipcRenderer.invoke("vua:overlay:hide"),
    // 指南定位事件:additive;Main 只投递给覆盖层窗口本身
    guideTargetEvents: Object.freeze({
      subscribe: (listener: (target: GuideTargetV1 | null) => void) => {
        const wrapped = (_event: IpcRendererEvent, payload: GuideTargetV1 | null) =>
          listener(payload);
        guideTargetListeners.set(listener, wrapped);
        ipcRenderer.on("vua:overlay:guide-target", wrapped);
        return () => {
          const wrappedListener = guideTargetListeners.get(listener);
          if (wrappedListener)
            ipcRenderer.removeListener("vua:overlay:guide-target", wrappedListener);
          guideTargetListeners.delete(listener);
        };
      },
    }),
    // 返回主窗口(仅响应用户明确动作,允许切换焦点)
    focusMainWindow: () => ipcRenderer.invoke("vua:window:focus-main"),
  }),
  // 远程内容窄面(F4-2):只发语义动作;远程页面本身无 preload、无本面
  remoteContent: Object.freeze({
    open: (request: { readonly url: string }) => ipcRenderer.invoke("vua:remote-content:open", request),
    navigate: (viewId: string, url: string) => ipcRenderer.invoke("vua:remote-content:navigate", viewId, url),
    goBack: (viewId: string) => ipcRenderer.invoke("vua:remote-content:go-back", viewId),
    goForward: (viewId: string) => ipcRenderer.invoke("vua:remote-content:go-forward", viewId),
    reload: (viewId: string) => ipcRenderer.invoke("vua:remote-content:reload", viewId),
    close: (viewId: string) => ipcRenderer.invoke("vua:remote-content:close", viewId),
    setVisible: (viewId: string, visible: boolean) =>
      ipcRenderer.invoke("vua:remote-content:set-visible", viewId, visible),
    signInHint: () => ipcRenderer.invoke("vua:remote-content:sign-in-hint"),
    events: Object.freeze({
      subscribe: (listener: (event: RemoteContentEventV1) => void) => {
        const wrapped = (_event: IpcRendererEvent, payload: RemoteContentEventV1) => listener(payload);
        remoteContentListeners.set(listener, wrapped);
        ipcRenderer.on("vua:remote-content:event", wrapped);
        return () => {
          const wrappedListener = remoteContentListeners.get(listener);
          if (wrappedListener) ipcRenderer.removeListener("vua:remote-content:event", wrappedListener);
          remoteContentListeners.delete(listener);
        };
      },
    }),
  }),
  // 壳能力自报(proposal 015 §11 方案 a):能力拥有者静态声明;内嵌浏览
  // 基座(remote-content + U9 导航策略)随本壳交付,呈现两态由渲染层据此
  // 驱动(端到端可用才翻转呈现,desktop 架构 1.1.0)。沙箱 preload 不能
  // 运行时导入本地模块,值按 DESKTOP_GATEWAY_VERSION 先例持本地字面量,
  // 与 electron/shell-capabilities 单一事实源的同值由测试钉死把守
  // (#36 缺陷4′ 能力面对齐)
  capabilities: Object.freeze({
    remoteBrowser: true,
  }),
  // 版本检测(2026-09-19 裁决:默认开启、设置可关;只读探测,下载/
  // 应用更新属 Phase C 独立提案;失败恒落 check-failed,渲染层如实呈现)
  system: Object.freeze({
    checkUpdate: () => ipcRenderer.invoke("vua:system:check-update"),
    // 系统资源占用(2026-09-25 裁决:顶栏占用查看器):读 Main 侧缓存
    // 快照;VRAM 采集不可用时字段 null,渲染层如实呈现「不可用」
    readResourceUsage: () => ipcRenderer.invoke("vua:system:resource-usage"),
  }),
  // 文件系统窄面(2026-09-25 用户裁决:素材导入应用内文件夹选择器):
  // 只读列目录 + 单层新建;失败收信不抛,options 缺席经 null 透传(Main
  // 侧按形状收窄,IPC 序列化 undefined→null 的可选参数洞由此封死)
  fs: Object.freeze({
    listDirectory: (target: string | null, options?: { readonly showHidden?: boolean }) =>
      ipcRenderer.invoke("vua:fs:list-directory", target, options ?? null),
    createDirectory: (parentPath: string, name: string) =>
      ipcRenderer.invoke("vua:fs:create-directory", parentPath, name),
  }),
  // 导航确认流(015 §12,批 B-3):Main 发确认请求,渲染层以 i18n 确认卡
  // 作答;确认在前/逐次无记忆,用户不答=不执行
  navigationConfirm: Object.freeze({
    respond: (confirmId: string, approved: boolean) =>
      ipcRenderer.invoke("vua:nav-confirm:respond", confirmId, approved),
    events: Object.freeze({
      subscribe: (listener: (request: NavigationConfirmRequestV1) => void) => {
        const wrapped = (_event: IpcRendererEvent, payload: NavigationConfirmRequestV1) =>
          listener(payload);
        navConfirmListeners.set(listener, wrapped);
        ipcRenderer.on("vua:nav-confirm:request", wrapped);
        return () => {
          const wrappedListener = navConfirmListeners.get(listener);
          if (wrappedListener) ipcRenderer.removeListener("vua:nav-confirm:request", wrappedListener);
          navConfirmListeners.delete(listener);
        };
      },
    }),
  }),
});

contextBridge.exposeInMainWorld("vua", api);

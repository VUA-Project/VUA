import { WebContentsView, session, type BrowserWindow, type Rectangle, type Session } from "electron";
import type { RemoteContentEventV1, RemoteContentViewStateV1 } from "@vua/contracts";
import {
  installCookiePersistencePolicy,
  installRemoteContentNavigationPolicy,
  installRemoteContentSessionPolicy,
  isAllowedRemoteOrigin,
  type ExternalUrlOpener,
  type NavigationConfirmLayer,
  type RemoteContentViolationObserver,
} from "./security.js";

/**
 * 内嵌视图顶部预留条高度(px):视图不覆盖宿主窗口整窗,顶部留给渲染层
 * 固定导航条(后退/前进/刷新/回首页/URL/关闭——用户实测缺口修复,否则
 * 全屏视图盖死壳界面无法退出)。渲染层侧等高条在 ImportPage 浏览面板;
 * 两处以同一常量语义对齐,改动必须同批。
 */
export const REMOTE_VIEW_NAV_STRIP_PX = 44;

/**
 * 远程内容管理器(F4 隔离基座):Main 持有的 `WebContentsView` 生命周期与
 * 隔离边界(docs/architecture/desktop_ZH:独立 partition Session 保存独立远程
 * 存储;远程页面无 preload、无 Node、能力面只含标准 Web API)。
 *
 * - Renderer 只经窄面发语义动作(open/navigate/goBack/goForward/reload/
 *   close/setVisible),任何 Electron 对象、Cookie、下载令牌都不过 IPC;
 * - 允许清单外的导航与打开动作在 Main 拒绝(打开动作以错误 reject,视图内
 *   用户点击以 blocked 事件透明上报);
 * - 下载默认拒绝(F4-3 下载端口接管后替换 session 钩子);
 * - 登录会话存活:允许清单来源的会话 Cookie 补有界持久到期(安全.ts 策略),
 *   Cookie 数据只落本机分区,永不离开本机;
 * - 视图占满宿主窗口内容区并预留顶部导航条:导航条布局由表现层承载,本
 *   模块只负责让位(上缘 = REMOTE_VIEW_NAV_STRIP_PX)。
 */

export interface RemoteContentManagerOptions {
  /** 独立 Session partition(persist: 前缀保存独立远程存储) */
  readonly partition: string;
  readonly allowedOrigins: readonly string[];
  readonly openExternal: ExternalUrlOpener;
  readonly broadcast: (event: RemoteContentEventV1) => void;
  /** U9(1)/U9(3) 确认层注入(存在时透传给每视图导航策略);缺失=清单外
   *  与外部协议一律不放行(保守降级,违规照常上报) */
  readonly confirmNavigation?: NavigationConfirmLayer;
  /** 下载接缝:存在时下载交由调用方端口接管(F4-3),缺失保持默认拒绝 */
  readonly willDownload?: (
    event: { readonly preventDefault: () => void },
    item: import("electron").DownloadItem,
    webContents: import("electron").WebContents,
  ) => void;
}

interface ManagedView {
  readonly view: WebContentsView;
  readonly viewId: string;
  visible: boolean;
}

export class RemoteContentManager {
  readonly #options: RemoteContentManagerOptions;
  readonly #session: Session;
  readonly #views = new Map<string, ManagedView>();
  #hostWindow: BrowserWindow | null = null;
  #sequence = 0;
  #disposed = false;

  constructor(options: RemoteContentManagerOptions) {
    this.#options = options;
    this.#session = session.fromPartition(options.partition);
    const onViolation: RemoteContentViolationObserver = (url, reason) => {
      this.#broadcast({ kind: "blocked", viewId: "", url, reason });
    };
    installRemoteContentSessionPolicy(this.#session, {
      onViolation,
      ...(options.willDownload === undefined ? {} : { willDownload: options.willDownload }),
    });
    // 登录会话存活(隔离边界内):允许清单来源的会话 Cookie 补持久到期,
    // 数据只落本机分区存储(见类注释红线节)
    installCookiePersistencePolicy(this.#session, options.allowedOrigins);
  }

  setHostWindow(window: BrowserWindow | null): void {
    this.#hostWindow = window;
  }

  open(url: string): RemoteContentViewStateV1 {
    this.#assertUsable();
    if (!isAllowedRemoteOrigin(url, this.#options.allowedOrigins)) {
      throw new Error("origin_not_allowed");
    }
    return this.#createView(url);
  }

  /** U9(1) 确认放行专用入口:导航策略确认层在 Main 侧放行清单外目标时经此
   *  入视图(用户显式确认是放行依据);渲染层窄面(vua:remote-content:open)
   *  仍只允许清单内——两个入口的守卫差异是刻意的,不对外收敛。 */
  openAfterConfirmation(url: string): RemoteContentViewStateV1 {
    this.#assertUsable();
    return this.#createView(url);
  }

  #createView(url: string): RemoteContentViewStateV1 {
    this.#sequence += 1;
    const viewId = `rc-${this.#sequence}-${crypto.randomUUID()}`;
    const view = new WebContentsView({
      webPreferences: {
        // 无 preload:远程内容能力面只含标准 Web API(隔离红线)
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition: this.#options.partition,
      },
    });
    const managed: ManagedView = { view, viewId, visible: true };
    this.#views.set(viewId, managed);
    const onViolation: RemoteContentViolationObserver = (violationUrl, reason) => {
      this.#broadcast({ kind: "blocked", viewId, url: violationUrl, reason });
    };
    installRemoteContentNavigationPolicy(view.webContents, {
      allowedOrigins: this.#options.allowedOrigins,
      openExternal: this.#options.openExternal,
      onViolation,
      ...(this.#options.confirmNavigation === undefined
        ? {}
        : { confirmNavigation: this.#options.confirmNavigation }),
    });
    view.webContents.on("did-navigate", () => this.#broadcastNavigated(managed));
    view.webContents.on("did-navigate-in-page", () => this.#broadcastNavigated(managed));
    view.webContents.on("render-process-gone", () => {
      this.#broadcast({ kind: "view-closed", viewId });
      this.#destroyView(viewId);
    });
    this.#attach(managed);
    this.#broadcast({ kind: "view-opened", viewId, url });
    void view.webContents.loadURL(url);
    return this.#stateOf(managed);
  }

  navigate(viewId: string, url: string): RemoteContentViewStateV1 {
    this.#assertUsable();
    const managed = this.#requireView(viewId);
    if (!isAllowedRemoteOrigin(url, this.#options.allowedOrigins)) {
      throw new Error("origin_not_allowed");
    }
    void managed.view.webContents.loadURL(url);
    return this.#stateOf(managed);
  }

  /* ---- 视图内导航历史(固定导航条动作面):历史成员在产生时已过导航
   *  策略,这里只做身份与可走性守卫,不做二次来源裁决 ---- */

  goBack(viewId: string): RemoteContentViewStateV1 {
    this.#assertUsable();
    const managed = this.#requireView(viewId);
    if (managed.view.webContents.navigationHistory.canGoBack()) {
      managed.view.webContents.navigationHistory.goBack();
    }
    return this.#stateOf(managed);
  }

  goForward(viewId: string): RemoteContentViewStateV1 {
    this.#assertUsable();
    const managed = this.#requireView(viewId);
    if (managed.view.webContents.navigationHistory.canGoForward()) {
      managed.view.webContents.navigationHistory.goForward();
    }
    return this.#stateOf(managed);
  }

  reload(viewId: string): RemoteContentViewStateV1 {
    this.#assertUsable();
    const managed = this.#requireView(viewId);
    managed.view.webContents.reload();
    return this.#stateOf(managed);
  }

  close(viewId: string): void {
    this.#requireView(viewId);
    this.#broadcast({ kind: "view-closed", viewId });
    this.#destroyView(viewId);
  }

  setVisible(viewId: string, visible: boolean): RemoteContentViewStateV1 {
    const managed = this.#requireView(viewId);
    managed.visible = visible;
    managed.view.setVisible(visible);
    if (visible) this.#applyBounds(managed);
    return this.#stateOf(managed);
  }

  /**
   * BOOTH 登录态线索(W25 走查缺陷③b 最小实现,只读探测):检查本机分区
   * Session 中账户域(accounts.booth.pm——登录/库/会话功能唯一子域,普通
   * 浏览 booth.pm 主页不在此域种 Cookie)是否存在已存 Cookie。
   * - 诚实边界:会话 Cookie 具体键名无公开文档,不作键名猜测;「有 Cookie」
   *   只说明账户域有存储痕迹(登录过/访问过账户页),不是登录判定——返回
   *   线索三态,登录与否以站点实际呈现为准;
   * - Cookie 值永不过本方法(只计存在性),符合「Cookie 数据只落本机分区,
   *   永不离开本机」红线;
   * - 探测异常如实返回 "unknown",不猜测不降级为已登录/未登录任一断言。
   */
  async signInHint(): Promise<"stored" | "none" | "unknown"> {
    try {
      // 真机修正(2026-10-02):登录会话 Cookie 是 accounts.booth.pm 的
      // host-only Cookie——按 booth.pm 查询再过滤永远取不到它们,已登录
      // 也被误报 "none"。直接按账户域查询。
      const accountCookies = await this.#session.cookies.get({ domain: "accounts.booth.pm" });
      return accountCookies.length > 0 ? "stored" : "none";
    } catch {
      return "unknown";
    }
  }

  /**
   * 登出(账号管理,2026-10-05):清空本分区的全部存储——Cookie、
   * localStorage、缓存凭据都属于「BOOTH/Pixiv 登录态」这一件事,登出
   * 即整体清除,不做过期裁剪(分区本就专用于远程浏览,无其它数据可误伤)。
   * 打开中的视图一并关闭(带着旧会话的页面没有继续存在的意义)。
   */
  async signOut(): Promise<void> {
    this.#assertUsable();
    this.closeAll();
    await this.#session.clearStorageData();
    await this.#session.clearAuthCache().catch(() => {
      /* 认证缓存清理失败不阻断登出事实 */
    });
  }

  /**
   * 以本管理器的分区会话发起一次只读 GET（N5 S1 账号库同步读取器专用）。
   * 会话 Cookie 只在本方法内部的 Electron 网络层使用；返回面只有
   * status/body/finalUrl 文本——凭据与 Cookie 永不出分区边界。来源守卫
   * 沿用允许清单：清单外 URL 直接抛错，不发起请求。
   */
  async fetchWithSession(url: string): Promise<{
    readonly status: number;
    readonly body: string;
    readonly finalUrl: string;
  }> {
    this.#assertUsable();
    if (!isAllowedRemoteOrigin(url, this.#options.allowedOrigins)) {
      throw new Error("origin_not_allowed");
    }
    const response = await this.#session.fetch(url, {
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    return {
      status: response.status,
      body: await response.text(),
      finalUrl: response.url,
    };
  }

  /** 宿主窗口尺寸变化时重排可见视图(骨架行为:占满内容区) */
  refreshBounds(): void {
    for (const managed of this.#views.values()) {
      if (managed.visible) this.#applyBounds(managed);
    }
  }

  closeAll(): void {
    for (const viewId of [...this.#views.keys()]) {
      this.#broadcast({ kind: "view-closed", viewId });
      this.#destroyView(viewId);
    }
  }

  #attach(managed: ManagedView): void {
    const window = this.#requireHost();
    window.contentView.addChildView(managed.view);
    this.#applyBounds(managed);
  }

  #applyBounds(managed: ManagedView): void {
    const window = this.#requireHost();
    const bounds: Rectangle = window.getContentBounds();
    // 顶部让位给渲染层固定导航条(高度见 REMOTE_VIEW_NAV_STRIP_PX 注释);
    // 窗口过矮时条高吃满则视图不显示(诚实让位,不产生负高度)
    const height = Math.max(bounds.height - REMOTE_VIEW_NAV_STRIP_PX, 0);
    managed.view.setBounds({
      x: 0,
      y: REMOTE_VIEW_NAV_STRIP_PX,
      width: bounds.width,
      height,
    });
  }

  #requireHost(): BrowserWindow {
    if (this.#hostWindow === null) throw new Error("remote content host window is not attached");
    return this.#hostWindow;
  }

  #requireView(viewId: string): ManagedView {
    const managed = this.#views.get(viewId);
    if (managed === undefined) throw new Error("unknown_remote_view");
    return managed;
  }

  #destroyView(viewId: string): void {
    const managed = this.#views.get(viewId);
    if (managed === undefined) return;
    this.#views.delete(viewId);
    // #26 用户实测退出崩溃修复(isDestroyed 双护栏):宿主窗口 close→closed
    // 时序中清理可能晚于窗口销毁,已销毁对象的 contentView/webContents 访问
    // 抛「Object has been destroyed」;销毁面跳过对应原生调用,视图登记照常
    // 移除(视图层语义不因护栏改变)。webContents 随视图 GC 兜底,不再显式
    // close 的场合只发生在其已销毁时——无泄漏新增面
    if (this.#hostWindow !== null && !this.#hostWindow.isDestroyed()) {
      this.#hostWindow.contentView.removeChildView(managed.view);
    }
    if (!managed.view.webContents.isDestroyed()) {
      managed.view.webContents.close();
    }
  }

  #broadcastNavigated(managed: ManagedView): void {
    const contents = managed.view.webContents;
    this.#broadcast({
      kind: "navigated",
      viewId: managed.viewId,
      url: contents.getURL(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    });
  }

  #stateOf(managed: ManagedView): RemoteContentViewStateV1 {
    const contents = managed.view.webContents;
    return {
      viewId: managed.viewId,
      url: contents.getURL(),
      visible: managed.visible,
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward(),
    };
  }

  #broadcast(event: RemoteContentEventV1): void {
    // session 级违规(下载/权限)发生在 viewId 归属前:携带空 viewId 上报,
    // 渲染层按全局违规提示呈现;视图级违规恒有具体 viewId
    if (this.#disposed) return;
    this.#options.broadcast(event);
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("remote content manager is disposed");
  }

  dispose(): void {
    this.#disposed = true;
    this.closeAll();
    this.setHostWindow(null);
  }
}

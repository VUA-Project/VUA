import type { Session, WebContents, WebPreferences } from "electron";

export type ExternalUrlOpener = (url: string) => void | Promise<void>;
export type PermissionRequestObserver = (permission: string, requestingUrl: string) => void;

export function localWindowWebPreferences(preload?: string): WebPreferences {
  return {
    ...(preload ? { preload } : {}),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  };
}

export function isAllowedLocalSender(url: string, rendererUrl?: string): boolean {
  if (rendererUrl) return url === rendererUrl || url.startsWith(`${rendererUrl}/`);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" && parsed.pathname.replaceAll("\\", "/").endsWith("/dist/renderer/index.html");
  } catch {
    return false;
  }
}

export function installPermissionDenyPolicy(
  targetSession: Session,
  observeRequest?: PermissionRequestObserver,
): void {
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    observeRequest?.(permission, details.requestingUrl || webContents.getURL());
    callback(false);
  });
}

/* ---- U9 四分法导航分类(2026-09-09 用户裁决,导航实差必做改造) ----
 * 权威:BOARD U9(新窗口/外部协议四分法)＋outline 2.0.11 治理注记。
 * 浏览宽(清单外 http/https 提示后放行转当前内嵌视图,内容可达性不受影响)、
 * 下载严(域清单不放,download-port 管辖)双轨;外部协议逐次确认。 */

/** U9(3) 外部协议显式清单:初始恰为用户点名四项(panel-prebatch A-4 保守
 *  集合);清单是放行枚举,未知协议默认拒绝;无任何层级免确认记忆(A-2),
 *  扩充走后续提案(逐项安全评估)。 */
export const EXTERNAL_PROTOCOL_ALLOWLIST: readonly string[] = [
  "mailto:",
  "steam:",
  "unityhub:",
  "vrchat:",
  "discord:",
];

export type NavigationTargetKind =
  | { readonly kind: "web"; readonly allowed: boolean }
  | { readonly kind: "external-protocol"; readonly protocol: string }
  | { readonly kind: "pseudo-protocol" }
  | { readonly kind: "unknown-scheme" };

/** 导航/弹窗目标四分类:web(http/https,带清单判定)/外部协议(清单内,
 *  确认后交系统打开)/伪协议(U9(2) 无条件拒)/未知协议(默认拒)。
 *  解析失败保守归伪协议(拒绝向)。 */
export function classifyNavigationTarget(
  url: string,
  allowedOrigins: readonly string[],
): NavigationTargetKind {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "pseudo-protocol" };
  }
  switch (parsed.protocol) {
    case "https:":
    case "http:":
      return { kind: "web", allowed: isAllowedRemoteOrigin(url, allowedOrigins) };
    case "javascript:":
    case "data:":
    case "blob:":
    case "file:":
    case "vbscript:":
      // U9(2) 管辖面是窗口/导航目标;下载流走 will-download 由下载端口
      // 策略管辖(域过滤照旧),不受此分类牵连(A-6)
      return { kind: "pseudo-protocol" };
    default:
      if (EXTERNAL_PROTOCOL_ALLOWLIST.includes(parsed.protocol)) {
        return { kind: "external-protocol", protocol: parsed.protocol };
      }
      // U9(3) 未知协议默认拒绝
      return { kind: "unknown-scheme" };
  }
}

/** 确认层注入(U9(1) 清单外「提示后放行」/U9(3) 外部协议确认):确认在前
 *  (A-1 逐次阻断式),resolve(true)=用户确认放行;不提供免确认记忆(A-2)。 */
export type NavigationConfirmLayer = (
  url: string,
  reason: "origin_not_allowed" | "external_protocol",
) => Promise<boolean>;

export interface LocalContentPolicyOptions {
  readonly rendererUrl: string | undefined;
  /** U9(1) 浏览允许清单(与下载域清单严格分开):清单内直行/清单外确认后
   *  转,目标都是当前内嵌视图 */
  readonly allowedOrigins: readonly string[];
  /** http/https 目标转当前内嵌视图的注入(本地窗口=RemoteContentManager);
   *  注入缺失时目标不放行(诚实降级,维持拒绝)。 */
  readonly navigateCurrentView?: (url: string) => void;
  readonly openExternal: ExternalUrlOpener;
  readonly confirmNavigation?: NavigationConfirmLayer;
}

/** 本地壳窗口导航面:will-navigate 维持本地身份拦截(本地壳不导航,该面
 *  不属 U9 域清单场景);弹窗按 U9 四分法分流——http/https 转当前内嵌
 *  视图(不再交系统浏览器),外部协议确认后交系统,伪协议无条件拒。
 *  U9(4) 手势门槛的等效实现:Electron 当前版本窗口打开 details 不提供
 *  手势字段,协议启动一律经逐次确认层——用户确认点击即显式手势,页面
 *  自动触发未经确认不执行(比字面更严,如实声明)。 */
export function installLocalContentNavigationPolicy(
  webContents: WebContents,
  options: LocalContentPolicyOptions,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    const target = classifyNavigationTarget(url, options.allowedOrigins);
    if (target.kind === "web") {
      if (target.allowed) {
        // 清单内直行:原生新窗口仍一律 deny,目标转当前内嵌视图(U9(1))
        options.navigateCurrentView?.(url);
      } else {
        // 清单外:提示后放行转当前内嵌视图(确认在前)
        void offerConfirmedView(options.confirmNavigation, options.navigateCurrentView, url);
      }
      return { action: "deny" };
    }
    if (target.kind === "external-protocol") {
      // U9(3)/U9(4):确认层逐次确认后交系统打开;确认点击即用户显式手势,
      // 自动触发未经确认不执行
      void offerConfirmedExternal(options.confirmNavigation, options.openExternal, url);
      return { action: "deny" };
    }
    // 伪协议窗口无条件拒(U9(2));未知协议默认拒绝(U9(3))
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (!isAllowedLocalSender(url, options.rendererUrl)) event.preventDefault();
  });
}

/** 确认后转当前内嵌视图;确认层或视图注入缺失时不放行(保守降级)。 */
function offerConfirmedView(
  confirm: NavigationConfirmLayer | undefined,
  navigate: ((url: string) => void) | undefined,
  url: string,
): void {
  if (!confirm || !navigate) return;
  void confirm(url, "origin_not_allowed").then((ok) => {
    if (ok) navigate(url);
  });
}

/** 确认后交系统打开外部协议;确认层缺失时不执行(保守降级)。 */
function offerConfirmedExternal(
  confirm: NavigationConfirmLayer | undefined,
  openExternal: ExternalUrlOpener,
  url: string,
): void {
  if (!confirm) return;
  void confirm(url, "external_protocol").then((ok) => {
    if (ok) void openExternal(url);
  });
}

/* ---- 远程内容策略(F4 隔离浏览;所有权边界见 docs/architecture/desktop_ZH):
 * Main 持有 Session/WebContentsView,远程页面按来源允许清单导航,权限默认
 * 全拒绝,下载默认拒绝(F4-3 下载端口接管后替换),违规透明上报不静默。 ---- */

export type RemoteContentViolationReason =
  | "origin_not_allowed"
  | "download_denied"
  | "popup_denied"
  | "permission_denied";

export type RemoteContentViolationObserver = (url: string, reason: RemoteContentViolationReason) => void;

function remoteOriginOf(url: string): { protocol: string; host: string; port: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    // 端口属于 origin 语义:显式端口与协议默认端口(https 443 / http 80)
    // 归一,避免 127.0.0.1:A 与 127.0.0.1:B 互相同源
    const defaultPort = parsed.protocol === "https:" ? "443" : "80";
    return {
      protocol: parsed.protocol,
      host: parsed.hostname.toLowerCase(),
      port: parsed.port === "" ? defaultPort : parsed.port,
    };
  } catch {
    return null;
  }
}

/** 远程来源允许判定:https/http + 协议、主机(点后缀子域语义)与端口一致 */
export function isAllowedRemoteOrigin(url: string, allowedOrigins: readonly string[]): boolean {
  const target = remoteOriginOf(url);
  if (target === null) return false;
  return allowedOrigins.some((allowed) => {
    const origin = remoteOriginOf(allowed);
    if (origin === null) return false;
    if (origin.protocol !== target.protocol) return false;
    if (origin.port !== target.port) return false;
    return target.host === origin.host || target.host.endsWith(`.${origin.host}`);
  });
}

export interface RemoteContentPolicyOptions {
  readonly allowedOrigins: readonly string[];
  readonly openExternal: ExternalUrlOpener;
  readonly onViolation?: RemoteContentViolationObserver;
  /** U9(1)/U9(3) 确认层注入;缺失=清单外与外部协议一律不放行(保守降级) */
  readonly confirmNavigation?: NavigationConfirmLayer;
}

/** 单个远程视图的导航面(U9 四分法):清单内导航/弹窗目标转当前视图;清单外
 *  「提示后放行」转当前视图(确认在前);外部协议经确认层交系统打开(确认
 *  点击即用户显式手势,页面自动触发未经确认不执行);伪协议窗口无条件拒;
 *  原生新窗口一律 deny。违规透明上报不静默——导航拒绝报 origin_not_allowed、
 *  弹窗拒绝报 popup_denied(沿用既有事件语义)。 */
export function installRemoteContentNavigationPolicy(
  webContents: WebContents,
  options: RemoteContentPolicyOptions,
): void {
  webContents.setWindowOpenHandler(({ url }) => {
    const target = classifyNavigationTarget(url, options.allowedOrigins);
    if (target.kind === "web" && target.allowed) {
      // 清单内直行:弹窗不创建,目标转当前内嵌视图(U9(1))
      void loadRemoteUrl(webContents, url);
      return { action: "deny" };
    }
    if (target.kind === "web") {
      options.onViolation?.(url, "origin_not_allowed");
      // 清单外:提示后放行转当前内嵌视图(确认在前,A-1)
      offerConfirmedNavigationToView(webContents, options, url);
      return { action: "deny" };
    }
    if (target.kind === "external-protocol" && options.confirmNavigation) {
      // U9(3)/U9(4):确认层逐次确认后交系统打开
      void options.confirmNavigation(url, "external_protocol").then((ok) => {
        if (ok) void options.openExternal(url);
      });
      return { action: "deny" };
    }
    // 伪协议无条件拒(U9(2));外部协议缺确认层注入不执行(保守降级);未知协议默认拒
    options.onViolation?.(url, "popup_denied");
    return { action: "deny" };
  });
  const guardNavigation = (event: { preventDefault(): void; isMainFrame?: boolean }, url: string) => {
    if (event.isMainFrame === false) return;
    const target = classifyNavigationTarget(url, options.allowedOrigins);
    if (target.kind === "web" && target.allowed) return;
    event.preventDefault();
    if (target.kind === "web") {
      options.onViolation?.(url, "origin_not_allowed");
      // U9(1) 提示后放行:确认后在本视图导航(即转当前内嵌视图)。
      // will-navigate 无手势字段,确认层本身即用户显式动作(等效手势门槛)
      offerConfirmedNavigationToView(webContents, options, url);
      return;
    }
    if (target.kind === "external-protocol" && options.confirmNavigation) {
      // U9(3):同窗口导航形态的外部协议链接,逐次确认后交系统打开
      void options.confirmNavigation(url, "external_protocol").then((ok) => {
        if (ok) void options.openExternal(url);
      });
      return;
    }
    // 伪协议/未知协议导航:拒,不提供确认(保守)
    options.onViolation?.(url, "origin_not_allowed");
  };
  webContents.on("will-navigate", guardNavigation);
  webContents.on("will-redirect", guardNavigation);
}

/** 清单外 http(s) 目标的确认放行:确认后在本视图导航(转当前内嵌视图);
 *  确认层缺失时不放行(violation 已上报,诚实降级)。 */
function offerConfirmedNavigationToView(
  webContents: WebContents,
  options: RemoteContentPolicyOptions,
  url: string,
): void {
  if (!options.confirmNavigation) return;
  void options.confirmNavigation(url, "origin_not_allowed").then((ok) => {
    if (ok) void loadRemoteUrl(webContents, url);
  });
}

async function loadRemoteUrl(webContents: WebContents, url: string): Promise<void> {
  if (webContents.isDestroyed?.()) return;
  try { await webContents.loadURL(url); } catch { /* The owning browser reports load failure or teardown. */ }
}

/** 远程分区 Session 面:权限请求全拒绝;下载默认拒绝——`willDownload`
 *  接缝存在时委托给下载端口(F4-3 接管,策略拒绝由端口 preventDefault),
 *  不存在则保持安全默认并上报 */
export function installRemoteContentSessionPolicy(
  targetSession: Session,
  options: Pick<RemoteContentPolicyOptions, "onViolation"> & {
    readonly willDownload?: (
      event: { readonly preventDefault: () => void },
      item: import("electron").DownloadItem,
      webContents: import("electron").WebContents,
    ) => void;
  },
): void {
  installPermissionDenyPolicy(targetSession, (permission, requestingUrl) => {
    options.onViolation?.(requestingUrl, "permission_denied");
  });
  if (options.willDownload) {
    const willDownload = options.willDownload;
    targetSession.on("will-download", (event, item, webContents) => {
      willDownload(event, item, webContents);
    });
  } else {
    targetSession.on("will-download", (event, item) => {
      event.preventDefault();
      options.onViolation?.(item.getURL(), "download_denied");
    });
  }
}

/* ---- 登录会话存活(用户实测缺口修复 2026-09-12):persist 分区让持久
 * Cookie 落盘,但 Chromium 把无到期时间的「会话 Cookie」只存内存——应用
 * 一退就丢,用户每次重启都要重登。策略:允许清单来源的会话 Cookie 在写入
 * 时补一个有界的持久到期(不改值/不改域),登录态跨重启携带。Cookie 只落
 * 本机分区存储:不进渲染层、不经 IPC、不随任何提交离开本机(隔离红线)。 ---- */

/** 补持久窗口(天):与常见站点「记住登录」量级一致,有界而非永久 */
export const COOKIE_PERSIST_DAYS = 180;

/** 会话 Cookie 的域是否落在允许清单内(点前缀=域 Cookie,子域语义与
 *  isAllowedRemoteOrigin 一致)。非 https/http 语义的域一律拒绝。 */
export function isCookieDomainAllowed(
  domain: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (domain === undefined) return false;
  const host = domain.replace(/^\./, "").toLowerCase();
  if (host === "") return false;
  return isAllowedRemoteOrigin(`https://${host}/`, allowedOrigins);
}

/** 会话 Cookie → 持久化重写参数;清单外或缺域/路径或非会话 Cookie 返回
 *  null(不动) */
export function sessionCookiePersistence(
  cookie: {
    readonly domain?: string;
    readonly path?: string;
    readonly name: string;
    readonly session?: boolean;
    readonly secure?: boolean;
  },
  allowedOrigins: readonly string[],
  nowSeconds: number,
): { readonly url: string; readonly expirationDate: number } | null {
  if (cookie.session !== true) return null;
  if (!isCookieDomainAllowed(cookie.domain, allowedOrigins)) return null;
  if (cookie.path === undefined) return null;
  const host = cookie.domain!.replace(/^\./, "");
  return {
    url: `${cookie.secure === false ? "http" : "https"}://${host}${cookie.path}`,
    expirationDate: nowSeconds + COOKIE_PERSIST_DAYS * 24 * 60 * 60,
  };
}

/** 允许清单来源的会话 Cookie 补持久到期(登录会话跨重启存活):
 *  重写只补 expirationDate,值/域/路径/安全旗标原样保留;重写产生的
 *  changed 事件携带非会话 Cookie,自然终止不循环。 */
export function installCookiePersistencePolicy(
  targetSession: Session,
  allowedOrigins: readonly string[],
  now: () => number = () => Date.now() / 1000,
): void {
  targetSession.cookies.on("changed", (_event, cookie, _cause, removed) => {
    if (removed) return;
    const persistence = sessionCookiePersistence(cookie, allowedOrigins, Math.floor(now()));
    if (persistence === null) return;
    const details: import("electron").CookiesSetDetails = {
      url: persistence.url,
      name: cookie.name,
      value: cookie.value,
      expirationDate: persistence.expirationDate,
      ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
      ...(cookie.path === undefined ? {} : { path: cookie.path }),
      ...(cookie.secure === undefined ? {} : { secure: cookie.secure }),
      ...(cookie.httpOnly === undefined ? {} : { httpOnly: cookie.httpOnly }),
      ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite }),
    };
    void targetSession.cookies.set(details);
  });
}

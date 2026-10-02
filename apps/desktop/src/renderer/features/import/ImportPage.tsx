import { useModalOwner } from "../../components/primitives/modal-layer.tsx";
import { formatDateTime } from "../../i18n/index.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { Icon } from "@vua/design-system";
import {
  useGateway,
  type WarehouseCommandOutcome,
} from "../../gateway/index.ts";
import { commandErrorText } from "../warehouse/acquire-model.ts";
import { format, strings } from "../../i18n/index.ts";
import type { DownloadsListCompletedItemV04 } from "@vua/contracts";
import { FolderPickerDialog } from "./FolderPickerDialog.tsx";
import { mergeUniqueFolders } from "./folder-picker-model.ts";
import {
  autoCloseArmed,
  BOOTH_HOME_URL,
  BOOTH_SIGN_IN_URL,
  browseAvailability,
  classifyRemoteOpenError,
  createAutoCloseTimer,
  createBrowsePanelLifecycle,
  createViewCloseTracker,
  dialogAutoCloseOnViewClose,
  displayUrl,
  embeddedBrowseReducer,
  initialBrowseUrl,
  initialEmbeddedBrowseState,
  normalizeBrowseAddress,
  bytesText,
  narrowCompletedDownloads,
  type EmbeddedBrowseAvailability,
  type EmbeddedBrowseOpenFailure,
  type EmbeddedBrowseState,
} from "./import-model.ts";
import "./import-page.css";
import { useAcquireView } from "../../gateway/GatewayProvider.tsx";
import { entrySurfacesVisible, inferGlobalDefaultMode } from "../warehouse/acquire-model.ts";

/**
 * 素材导入(M6 IMP-2 批 A;proposal 015 对账受理,design-standard §8.3):连续素
 * 材获取路径的两段诚实呈现。2026-09-20 导航重构(用户裁决)起不再是独立页——
 * 组件整体由仓储页经 ContentDialog 挂载为页内弹窗,导航模型无对应页面;以下
 * 生命周期与两段内容语义不变,弹窗关闭即卸载组件,恰好触发同款「卸载即关」
 * 语义(见下)。
 *
 * - 云端段:内嵌浏览面板。能力两态(desktop 架构 1.1.0):壳能力自报驱动——
 *   false = 未接线诚实降级(不可用标注,无替代假动作);true = 面板可用。
 *   首开自动导航默认首页 booth.pm(允许清单内;用户实测缺口修复)——
 *   signInHint 引导(未登录 → 登录页,已登录/未知 → 主页)。2026-09-25
 *   用户裁决极简形态:地址输入行退役(它不导入链接,只开内嵌浏览器,
 *   而允许清单本就只有 booth.pm/accounts.booth.pm——近死重),空态 =
 *   短说明 + 一个主钮(与首开同一条自动导航线);「重选来源」回行云端
 *   段移除(本地段保留)。用户关闭视图(导航条 ×)的归因(import-model
 *   ViewCloseTracker,拆卸/代次兜底关闭永不误判):已完成下载为零 →
 *   宿主弹窗自动收口;有下载 → 驻留,空态换「重新打开内嵌浏览」细钮。
 *   视图打开时呈现固定导航条(后退/前进/刷新/回首页/URL 脱敏显示/关闭回
 *   VUA+窗口控制;用户实测缺口修复——全屏视图原盖死壳界面无法退出),
 *   Main 侧视图上缘让位同高条带(remote-content REMOTE_VIEW_NAV_STRIP_PX)。
 *   视图生命周期随组件卸载(#25 定性修复 2026-09-13):宿主弹窗关闭即卸载
 *   本组件,面板卸载(切页/关弹窗)即关闭在途视图——组件是视图唯一控制面,
 *   卸载不关会留下无导航条、不可控的全屏视图与重开泄漏;U9 四分法导航在
 *   Main 侧生效,本组件不做第二次分流;
 *   blocked 事件诚实呈现。生命周期守卫用代次模型(#37 修复 2026-09-18):
 *   原卸载布尔在 StrictMode 效果双调用后永真,自动打开与「打开」全部
 *   瞬间自关,内嵌浏览无法进入;代次比较使活跃挂载的 open 保留、已卸载
 *   或过期挂载的 open 随即关闭。导航条经 createPortal 挂 document.body
 *   (#38 修复 2026-09-18):面板所在 .vua-card 带毛玻璃 backdrop-filter,
 *   按 CSS 规范构成 fixed 后代的包含块,把 position:fixed;top:0 的导航
 *   条钉进卡片内部、落入视图覆盖区看不见点不着(视图内无退出);portal
 *   脱离该包含块,top:0 恢复相对视口,与 Main 侧让位条带重新对齐。
 *   首开地址归一化(#39 修复 2026-09-18)保留:裸域名自动补 https:// 再开,
 *   open 失败按拒绝原因三分呈现,不再误用仓储命令文案。Main 侧清单裁决
 *   语义不变。批 A 未含:目录模式(catalog 轨迁移随 IMP-4 重组);
 * - 本地段:W18 提交流迁入(确认列表→单命令 warehouse.import→任务中心;
 *   IMP-4 收口)。拾取面 2026-09-25 起为应用内文件夹选择器(用户裁决,
 *   ALCOM 形态:目录浏览/多选/新建/记忆,DesktopFsApiV1 窄面;Windows
 *   原生选择降为选择器内次级路径),确认合流去重累加。两段落成同一素
 *   材包条目模型。
 */
const copy = strings.importPage;
const acquireCopy = strings.warehouse.acquire;

function commandErrorTextFor(error: {
  kind: "unavailable" | "request_rejected" | "application";
  code?: string;
}): string {
  return commandErrorText(error, acquireCopy.commandErrors as Record<string, string>);
}

/** 失败详情词面(律同 production-workshop-view.failureLogText):本地化
 *  文案之外保留协议稳定码——词面不可解释时码仍是可取证细节,失败以失败
 *  呈现不吞细节。 */
function failureDetailText(error: {
  kind: "unavailable" | "request_rejected" | "application";
  code?: string;
}): string {
  const base = commandErrorTextFor(error);
  return typeof error.code === "string" && error.code !== "" ? `${base} (${error.code})` : base;
}

/** 内嵌视图 open 失败文案映射(BOARD #39 修复):按拒绝原因呈现——
 *  本地归一化失败/清单外拒绝/其它失败三分,不再误用仓储命令文案
 *  (原实现复用 vua_warehouse_unavailable「仓库服务尚未接入」,与本
 *  错误完全无关,用户据此外观误判 #37 未修复)。 */
const openFailureText: Record<EmbeddedBrowseOpenFailure["kind"], string> = {
  "invalid-address": copy.openInvalidAddress,
  "origin-not-allowed": copy.openOriginNotAllowed,
  "open-failed": copy.openFailed,
};

/* ---- 云端段:内嵌浏览面板 ---- */

function EmbeddedBrowsePanel({
  availability,
  onViewClosedByUser,
}: {
  availability: EmbeddedBrowseAvailability;
  /** 用户经导航条 × 关闭当前视图(且已完成下载为零时宿主弹窗自动收口
   *  的裁决在 ImportPage):仅「用户关闭」会触发,拆卸/代次兜底关闭
   *  永不触发(归因见 import-model ViewCloseTracker) */
  onViewClosedByUser?: (() => void) | undefined;
}) {
  const modalOwner = useModalOwner();
  const [browse, setBrowse] = useState<EmbeddedBrowseState>(initialEmbeddedBrowseState);
  const [openFailure, setOpenFailure] = useState<EmbeddedBrowseOpenFailure | null>(null);
  // 用户关闭过视图(当前代次内):空态呈现「重新打开内嵌浏览」细钮,
  // 否则呈现「打开 BOOTH 内嵌浏览」主钮——同一条自动导航线,两态词面
  const [userClosedView, setUserClosedView] = useState(false);
  // 视图生命周期守卫(#25 卸载即关 + #37 StrictMode 修复):Main 侧视图在
  // 壳导航切页后仍存续,而导航条/视图状态随本面板卸载——失联视图既无导航
  // 条也不可控(渲染层 viewId 判空,关闭入口缺席),重挂载首开还会叠加无人
  // 能关的泄漏视图。守卫用生命周期代次(import-model):挂载与卸载都推进
  // 代次,open 落定按「捕获代次 = 当前代次?」判定——原 disposedRef 布尔
  // 只在清理置 true、无挂载复位,StrictMode 效果双调用(mount→cleanup→
  // mount)后永真,每个新视图被竞态兜底立即关闭(#37 根因);代次模型下
  // 活跃挂载的 open 落定即保留,已卸载/过期挂载的 open 落定即关闭
  const lifecycleRef = useRef(createBrowsePanelLifecycle());
  // 视图关闭归因(2026-09-25 用户裁决):view-closed 事件不区分来源
  // (用户 ×/拆卸即关/孤儿清理同事件),武装弹窗收口前必须归因——
  // 导航条 × 先 markUserClose;拆卸与代次兜底清理先 markTeardownClose;
  // 订阅本身随卸载退订,但事件可能已排队,teardown 标记兜该竞态
  const trackerRef = useRef(createViewCloseTracker());
  const onViewClosedByUserRef = useRef(onViewClosedByUser);
  onViewClosedByUserRef.current = onViewClosedByUser;
  const viewIdRef = useRef<string | null>(null);

  useEffect(() => {
    const remote = window.vua?.remoteContent;
    if (remote === undefined) return undefined;
    return remote.events.subscribe((event) => {
      if (event.kind === "view-closed") {
        // 归因消费:仅用户 × 关闭武装(置 reopen 态 + 上报宿主);
        // teardown/unrelated 静默归约,不武装(拆卸永不触发弹窗收口)
        if (trackerRef.current.classify(event.viewId) === "user") {
          setUserClosedView(true);
          onViewClosedByUserRef.current?.();
        }
      }
      if (event.kind === "view-opened") trackerRef.current.reset();
      setBrowse((state) => embeddedBrowseReducer(state, event));
    });
  }, []);

  // viewId 同步进 ref:卸载清理闭包读 state 不保新值
  useEffect(() => {
    viewIdRef.current = browse.viewId;
  }, [browse.viewId]);

  // 卸载即关(#25 定性修复;#37 起卸载接线同时推进生命周期代次):素材导入
  // 页是视图的唯一控制面(固定导航条随页面渲染,壳导航常驻面没有第二套视
  // 图控制),带着视图切页＝留下无导航条的全屏视图;页面卸载时显式关闭已
  // 托管视图,并在途 open 落定时代次失配随即关闭,重挂载首开不叠加泄漏视图
  useEffect(
    () => () => {
      lifecycleRef.current.unmount();
      const current = viewIdRef.current;
      if (current !== null) {
        // 拆卸引发的关闭先归因标记:排队中/晚到的 view-closed 判
        // teardown,永不武装弹窗收口(卸载后宿主弹窗可能仍在,误收口
        // = 跑在用户操作下面)
        trackerRef.current.markTeardownClose(current);
        void window.vua?.remoteContent?.close(current).catch(() => {
          /* 视图已被关闭(重复清理/竞态):诚实忽略,无状态可猜 */
        });
      }
    },
    [],
  );

  const openAddress = (url: string) => {
    setOpenFailure(null);
    const remote = window.vua?.remoteContent;
    if (remote === undefined) return;
    // 输入归一化(#39 修复):裸域名(如 booth.pm)自动补 https://——原样
    // 透传会被 Main 源站清单按 origin_not_allowed 拒绝(用户真机实测撞
    // 上);无法解析的输入不上 Main,本地按「地址无法解析」诚实呈现。
    // Main 清单裁决语义不变,归一化只做「用户可读地址 → 可解析 URL」翻译
    const normalized = normalizeBrowseAddress(url);
    if (normalized.kind === "invalid") {
      setOpenFailure({ kind: "invalid-address" });
      return;
    }
    const generation = lifecycleRef.current.capture();
    void remote.open({ url: normalized.url }).then((state) => {
      // open 落定时该 open 若属已卸载实例(真实切页)或已过期挂载
      // (StrictMode 首挂的自动打开),代次失配:视图随即关闭,不留失联/
      // 孤儿视图;活跃挂载的 open 正常保留(#37 修复点)
      if (lifecycleRef.current.isStale(generation)) {
        trackerRef.current.markTeardownClose(state.viewId);
        void remote.close(state.viewId).catch(() => {});
      }
    }).catch((error: unknown) => {
      // 窄面拒绝按原因诚实呈现(#39 修复:原实现误用仓储命令文案):
      // 清单外拒绝/其它失败分类呈现,不放行不猜测(Main 确认层语义属
      // 导航策略面,页内确认层随批 B);面板已卸载则不再呈现
      if (!lifecycleRef.current.isStale(generation)) {
        setOpenFailure(classifyRemoteOpenError(error));
      }
    });
  };

  // 首开/重开同一条自动导航线(2026-09-25 用户裁决:云端段极简形态,
  // 唯一入口按钮与首开挂载共用):先取本机登录态线索——未登录引导登录页
  // (accounts.booth.pm/users/sign_in),已登录/未知回落 booth.pm 主页
  // (unknown 不冒充已检测)。仅面板挂载时首开一次;用户关闭视图后不强行
  // 重开(重开须点「重新打开内嵌浏览」)。StrictMode 双调用下首挂的 open
  // 在次挂后落定,由生命周期代次判失配随即关闭,只留次挂(#37 修复)视图。
  // 线索探测异步一瞬,落定前不开视图,不呈现猜测态
  const openInitialBrowse = () => {
    setOpenFailure(null);
    const remote = window.vua?.remoteContent;
    if (remote === undefined) return;
    void remote.signInHint().then((hint) => {
      openAddress(initialBrowseUrl(hint));
    });
  };

  useEffect(() => {
    if (availability.kind !== "available") return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) openInitialBrowse();
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 挂载一次性动作
  }, [availability.kind]);

  const viewId = browse.viewId;
  const closeView = () => {
    if (viewId === null) return;
    // 用户经导航条 × 关闭:在途标记,事件到达归因「user」——这是唯一
    // 武装弹窗自动收口的关闭来源(2026-09-25 用户裁决)
    trackerRef.current.markUserClose(viewId);
    void window.vua?.remoteContent?.close(viewId).catch(() => {
      // 未知视图(已被关闭等):视图关闭事件会同步状态,这里不猜测
    });
  };
  const reopenBrowse = () => {
    setUserClosedView(false);
    openInitialBrowse();
  };
  const historyAction = (action: "goBack" | "goForward" | "reload") => {
    if (viewId === null) return;
    void window.vua?.remoteContent?.[action](viewId).catch(() => {
      // 未知视图(已被关闭等):视图关闭事件会同步状态,这里不猜测
    });
  };

  if (availability.kind === "unavailable") {
    return (
      <div className="vua-import__cloud-degraded" role="note">
        <Badge tone="neutral">{strings.settings.experimental.badge}</Badge>
        <p className="vua-text-secondary">{copy.cloudUnavailable}</p>
      </div>
    );
  }
  return (
    <div className="vua-import__cloud-panel">
      <Badge tone="neutral">{copy.cloudBadge}</Badge>
      {browse.viewId === null ? (
        /* 极简空态(2026-09-25 用户裁决):地址输入行退役——它不导入链接,
           只开内嵌浏览器,而允许清单本就只有 booth.pm/accounts.booth.pm。
           空态 = 短说明 + 一个主钮(首开自动导航线);用户关闭过视图则换
           「重新打开内嵌浏览」细钮。自动打开失败按 #39 分类词面诚实呈现 */
        <div className="vua-import__cloud-idle">
          <p className="vua-caption vua-text-secondary">{copy.noView}</p>
          {userClosedView ? (
            <Button variant="subtle" onClick={reopenBrowse}>
              {copy.reopenBrowseCta}
            </Button>
          ) : (
            <Button variant="primary" onClick={openInitialBrowse}>
              {copy.openBrowseCta}
            </Button>
          )}
          {openFailure !== null ? (
            <p className="vua-caption vua-text-secondary" role="alert">
              {openFailureText[openFailure.kind]}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="vua-caption vua-text-secondary" title={browse.currentUrl ?? undefined}>
          {browse.currentUrl}
        </p>
      )}
      {browse.lastBlocked !== null ? (
        <div role="alert">
          <p className="vua-caption vua-text-secondary">{copy.blockedTitle}</p>
          <p className="vua-caption vua-text-secondary">{browse.lastBlocked}</p>
        </div>
      ) : null}
      {/* 导航条经 createPortal 挂 document.body(#38 修复 2026-09-18):
          面板所在 .vua-card 带毛玻璃 backdrop-filter,按 CSS 规范构成
          fixed 后代的包含块,把 position:fixed;top:0 的导航条钉进卡片
          内部、落入原生视图覆盖区(Main 侧视图占 y≥44 全窗)——被压在
          视图下面看不见点不着＝视图内无退出;portal 脱离该包含块后
          top:0 恢复视口语义,重新对齐 Main 侧 REMOTE_VIEW_NAV_STRIP_PX=44
          让位条带(两处同批改动纪律不变,本修复不动高度)。仓库先例:
          ContextMenu(同类 fixed 包含块问题经 portal 解决)。条件渲染与
          卸载语义不变:随本面板卸载 portal 内容同步移除,#25 卸载即关
          与 #37 代次模型均不受影响。 */}
      {viewId !== null
        ? createPortal(
            <div data-vua-modal-owner={modalOwner} className="vua-import__browse-bar" role="toolbar" aria-label={copy.navBarAria}>
              <button
                type="button"
                className="vua-import__browse-button"
                aria-label={copy.navBack}
                title={copy.navBack}
                disabled={!browse.canGoBack}
                onClick={() => historyAction("goBack")}
              >
                <Icon name="arrow-left" size={16} />
              </button>
              <button
                type="button"
                className="vua-import__browse-button"
                aria-label={copy.navForward}
                title={copy.navForward}
                disabled={!browse.canGoForward}
                onClick={() => historyAction("goForward")}
              >
                <Icon name="arrow-right" size={16} />
              </button>
              <button
                type="button"
                className="vua-import__browse-button"
                aria-label={copy.navReload}
                title={copy.navReload}
                onClick={() => historyAction("reload")}
              >
                <Icon name="refresh" size={16} />
              </button>
              <button
                type="button"
                className="vua-import__browse-button"
                aria-label={copy.navHome}
                title={copy.navHome}
                onClick={() => void window.vua?.remoteContent?.navigate(viewId, BOOTH_HOME_URL)}
              >
                <Icon name="home" size={16} />
              </button>
              <span className="vua-import__browse-url" title={browse.currentUrl ?? undefined}>
                {displayUrl(browse.currentUrl ?? "")}
              </span>
              <button
                type="button"
                className="vua-import__browse-button vua-import__browse-button--close"
                aria-label={copy.navClose}
                title={copy.navClose}
                onClick={closeView}
              >
                <Icon name="close" size={16} />
              </button>
              <span className="vua-import__browse-separator" aria-hidden="true" />
              <button
                type="button"
                className="vua-import__browse-button"
                aria-label={strings.app.windowMinimize}
                title={strings.app.windowMinimize}
                onClick={() => void window.vua?.window.minimize()}
              >
                <Icon name="minimize" size={16} />
              </button>
              <button
                type="button"
                className="vua-import__browse-button"
                aria-label={strings.app.windowMaximize}
                title={strings.app.windowMaximize}
                onClick={() => void window.vua?.window.toggleMaximize()}
              >
                <Icon name="maximize" size={16} />
              </button>
              <button
                type="button"
                className="vua-import__browse-button vua-import__browse-button--close"
                aria-label={strings.app.windowClose}
                title={strings.app.windowClose}
                onClick={() => void window.vua?.window.close()}
              >
                <Icon name="close" size={16} />
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/* ---- 本地段:W18 提交流(仓储页 verbatim 迁入,IMP-4 收口) ---- */

/** 本地段提交回执的呈现态:受理/失败/提示三型——失败以 alert 呈现并取消
 *  在飞自动关闭(失败需用户知悉,不静默关走),受理以 status 呈现并武装
 *  自动关闭计时,提示(如空选)仅 status 呈现。 */
interface ImportFeedback {
  readonly kind: "accepted" | "failure" | "notice";
  readonly text: string;
}

/** 关闭请求线属性(exactOptionalPropertyTypes 下显式容 undefined:解构
 *  透传链上 undefined 合法——无宿主即无请求,不猜测)。 */
interface ImportCloseRequest {
  readonly onRequestClose?: (() => void) | undefined;
}

function LocalImportSection({ onRequestClose }: ImportCloseRequest) {
  const gateway = useGateway();
  const [pendingFolders, setPendingFolders] = useState<readonly string[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importFeedback, setImportFeedback] = useState<ImportFeedback | null>(null);
  // 应用内文件夹选择器(2026-09-25 用户裁决,ALCOM 形态):拾取从原生
  // 对话框改为弹窗内目录浏览(DesktopFsApiV1 窄面),原生选择降为选择器
  // 内次级路径;确认合流去重累加(重复拾取补选,不清空既有待确认清单)
  const [pickerOpen, setPickerOpen] = useState(false);
  // 受理态自动关闭(W25 走查缺陷③根因修复):受理后弹窗短暂呈现「已受理」
  // 随即自动关闭,任务进度归任务中心——模态滞留(背景全部 inert)被用户
  // 视作整屏卡死的行为终止。武装判据见 autoCloseArmed(import-model,第
  // 181 批反向审查收紧):仅受理态武装;失败到达不武装(失败驻留);用户
  // 在受理窗口内再次发起拾取(反馈被清空=用户接管)即取消在飞计时——
  // 自动关闭不跑在用户进行中的操作下面;同窗二次受理经「清空→再置受理」
  // 重新武装 = 重新计时。卸载/手动先关即清理,重开弹窗(重挂载)不被旧
  // 定时器误关。回调经 ref 读取,宿主重渲染不重排定时器。
  const requestCloseRef = useRef(onRequestClose);
  requestCloseRef.current = onRequestClose;
  useEffect(() => {
    if (!autoCloseArmed(importFeedback)) return undefined;
    const timer = createAutoCloseTimer(() => requestCloseRef.current?.());
    timer.schedule();
    return () => timer.cancel();
  }, [importFeedback]);

  const startImport = () => {
    setImportFeedback(null);
    setPickerOpen(true);
  };

  const handlePickerConfirm = (folders: readonly string[]) => {
    if (folders.length === 0) {
      setImportFeedback({ kind: "notice", text: acquireCopy.importEmptySelection });
      return;
    }
    setPendingFolders((current) => mergeUniqueFolders(current, folders));
  };

  const handleUseWindowsPicker = (): Promise<readonly string[] | null> => {
    const dialog = window.vua?.dialog;
    if (dialog === undefined) return Promise.resolve(null);
    return dialog.pickWarehouseFolders();
  };

  // N5 实验选项(用户方向 2026-10-02):「制成 VPM 包再导入」只在设置-实验性
  // 的「生成 VPM 包替代」开启时显示;推断同仓储条目面(entrySurfacesVisible)
  const acquireView = useAcquireView();
  const globalDefault = inferGlobalDefaultMode(
    acquireView !== null && acquireView.kind === "entries" ? acquireView.entries : [],
  );
  const vpmOptionVisible = entrySurfacesVisible(globalDefault);
  const [autoVpm, setAutoVpm] = useState(false);
  const submitImport = (folders: readonly string[]) => {
    setImportBusy(true);
    setImportFeedback(null);
    void gateway.warehouseCommands
      .importFolders(folders, autoVpm ? { autoGenerate: true } : undefined)
      .then((outcome: WarehouseCommandOutcome) => {
      setImportBusy(false);
      if (outcome.ok) {
        setPendingFolders(null);
        setImportFeedback({ kind: "accepted", text: acquireCopy.importAccepted });
      } else {
        // 失败态保持打开(失败需用户知悉):醒目主按钮「关闭」为主动线,
        // × 仅辅助;详情词面按 failureLogText 律保留协议稳定码。
        setImportFeedback({ kind: "failure", text: failureDetailText(outcome.error) });
      }
    });
  };

  return (
    <div className="vua-import__local">
      <Button variant="default" onClick={startImport} disabled={importBusy}>
        {acquireCopy.importTitle}
      </Button>
      {importFeedback !== null ? (
        <p
          className="vua-caption vua-text-secondary"
          role={importFeedback.kind === "failure" ? "alert" : "status"}
        >
          {importFeedback.text}
        </p>
      ) : null}
      {importFeedback?.kind === "accepted" ? (
        <p className="vua-caption vua-text-secondary" role="status">
          {copy.acceptedAutoClose}
        </p>
      ) : null}
      {pendingFolders !== null ? (
        <div className="vua-warehouse__import-confirm" role="group" aria-label={acquireCopy.importConfirmTitle}>
          <p className="vua-warehouse-detail__section-title">{acquireCopy.importConfirmTitle}</p>
          <p className="vua-caption vua-text-secondary">{acquireCopy.importConfirmDesc}</p>
          <ul className="vua-warehouse__import-list">
            {pendingFolders.map((folder) => (
              <li key={folder}>
                <span>{folder}</span>
                <Button
                  variant="subtle"
                  aria-label={`${acquireCopy.importRemove}: ${folder}`}
                  disabled={importBusy}
                  onClick={() => setPendingFolders(pendingFolders.filter((f) => f !== folder))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
          <div className="vua-warehouse__import-actions">
            <Button variant="default" disabled={importBusy} onClick={() => setPendingFolders(null)}>
              {acquireCopy.importCancel}
            </Button>
            {vpmOptionVisible ? (
              <label className="vua-import__vpm-toggle">
                <input
                  type="checkbox"
                  checked={autoVpm}
                  disabled={importBusy}
                  onChange={(event) => setAutoVpm(event.target.checked)}
                />
                {copy.vpmImportOption}
              </label>
            ) : null}
            <Button variant="primary" disabled={importBusy} onClick={() => submitImport(pendingFolders)}>
              {acquireCopy.importConfirmCta}
            </Button>
          </div>
        </div>
      ) : null}
      {importFeedback?.kind === "failure" ? (
        <div className="vua-import__failure-actions">
          <Button variant="primary" onClick={() => requestCloseRef.current?.()}>
            {strings.common.dialogClose}
          </Button>
        </div>
      ) : null}
      <FolderPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={handlePickerConfirm}
        onUseWindowsPicker={handleUseWindowsPicker}
      />
    </div>
  );
}

/* ---- 云端段:已完成下载列表＋采纳入口(bdl-queries v0.4 + v0.4 写面) ---- */

interface DownloadsViewState {
  readonly kind: "loading" | "unavailable";
}
interface DownloadsViewLoaded {
  readonly kind: "loaded";
  readonly downloads: readonly DownloadsListCompletedItemV04[];
}

function CompletedDownloadsPanel({
  onRequestClose,
  onDownloadsLoaded,
}: ImportCloseRequest & {
  /** 清单每次落定(含刷新/采纳后)上报条目数;读面不可达上报 null——
   *  宿主据此裁决「用户关闭内嵌视图且下载为零 → 弹窗自动收口」
   *  (计数未知不武装,不猜态) */
  onDownloadsLoaded?: ((count: number | null) => void) | undefined;
}) {
  const gateway = useGateway();
  const [state, setState] = useState<DownloadsViewState | DownloadsViewLoaded>({
    kind: "loading",
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [adoptBusyId, setAdoptBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ImportFeedback | null>(null);
  const onDownloadsLoadedRef = useRef(onDownloadsLoaded);
  onDownloadsLoadedRef.current = onDownloadsLoaded;
  // 采纳受理同样自动关闭(W25 走查缺陷③同根因:采纳即导入任务受理,模态
  // 滞留同形态)。武装判据与本地段同一纯件 autoCloseArmed(第 179 批反向
  // 审查收紧,语义两段一致):失败驻留、用户接管取消计时、二次受理重新计时。
  const requestCloseRef = useRef(onRequestClose);
  requestCloseRef.current = onRequestClose;
  useEffect(() => {
    if (!autoCloseArmed(feedback)) return undefined;
    const timer = createAutoCloseTimer(() => requestCloseRef.current?.());
    timer.schedule();
    return () => timer.cancel();
  }, [feedback]);

  useEffect(() => {
    // 无宿主降级(第 181 批反向审查修复):window.vua 缺席(浏览器 dev 等
    // 无壳环境)时可选链整条短路,原实现连 .then 都不执行——state 恒悬挂
    // 在 loading(「加载中」假陈述,失败未被呈现)。同配方库列表先例
    // (RecipePage !result?.ok → unavailable):无宿主 = 读面不可达,诚实
    // unavailable,不悬挂过程态。
    const api = window.vua?.gateway;
    if (api === undefined) {
      setState({ kind: "unavailable" });
      onDownloadsLoadedRef.current?.(null);
      return undefined;
    }
    let active = true;
    setState({ kind: "loading" });
    void api
      .invoke({
        schemaVersion: 1,
        requestId: crypto.randomUUID(),
        method: "downloads.listCompleted",
        params: {},
      })
      .then((result) => {
        if (!active) return;
        // 收窄纪律(BOARD #36 缺陷②修复批):live 应答 = bdl-queries 三键
        // 信封 {schemaVersion, operation, result:{downloads}},不是契约平铺
        // 值——按信封收窄(与 packages-live 同纪律),收不齐 = 提供方响应
        // 不可解释,如实 unavailable,不以空清单伪装
        const downloads = result.ok ? narrowCompletedDownloads(result.value) : null;
        if (downloads !== null) {
          setState({ kind: "loaded", downloads });
          onDownloadsLoadedRef.current?.(downloads.length);
        } else {
          setState({ kind: "unavailable" });
          onDownloadsLoadedRef.current?.(null);
        }
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const adopt = (downloadId: string) => {
    setAdoptBusyId(downloadId);
    setFeedback(null);
    void gateway.warehouseCommands.importDownloads([downloadId]).then((outcome: WarehouseCommandOutcome) => {
      setAdoptBusyId(null);
      if (outcome.ok) {
        setFeedback({ kind: "accepted", text: copy.downloadAccepted });
        setReloadKey((key) => key + 1);
      } else {
        // 失败态保持打开:醒目主按钮「关闭」＋详情词面(failureLogText 律),
        // 与本地段同一失败呈现律。
        setFeedback({ kind: "failure", text: failureDetailText(outcome.error) });
      }
    });
  };

  return (
    <div className="vua-import__downloads">
      {feedback !== null ? (
        <p
          className="vua-caption vua-text-secondary"
          role={feedback.kind === "failure" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}
      {feedback?.kind === "accepted" ? (
        <p className="vua-caption vua-text-secondary" role="status">
          {copy.acceptedAutoClose}
        </p>
      ) : null}
      {feedback?.kind === "failure" ? (
        <div className="vua-import__failure-actions">
          <Button variant="primary" onClick={() => requestCloseRef.current?.()}>
            {strings.common.dialogClose}
          </Button>
        </div>
      ) : null}
      {state.kind === "loading" ? (
        // 加载态词面(第 179 批反向审查纠正):原借用确认段标题
        // importConfirmTitle「确认导入以下文件夹」与本过程态语义无关
        // (#39「误用他面文案」族同构),改用专属加载词面如实呈现。
        <p className="vua-caption vua-text-secondary">{copy.downloadsLoading}</p>
      ) : null}
      {state.kind === "unavailable" ? (
        <p className="vua-caption vua-text-secondary" role="alert">
          {acquireCopy.commandErrors.vua_warehouse_unavailable}
        </p>
      ) : null}
      {state.kind === "loaded" && state.downloads.length === 0 ? (
        <p className="vua-caption vua-text-secondary">{copy.downloadsEmpty}</p>
      ) : null}
      {state.kind === "loaded" && state.downloads.length > 0 ? (
        <ul className="vua-project-compat__specs">
          {state.downloads.map((download) => {
            const adopted = download.adoptedWarehouseItemIds.length > 0;
            const name = download.suggestedFileName ?? download.sourceUrl;
            return (
              <li key={download.downloadId}>
                <strong>{name}</strong>{" "}
                <span className="vua-caption vua-text-secondary">
                  {format(copy.downloadSize, { size: bytesText(download.receivedBytes) })} ·{" "}
                  {format(copy.downloadCompletedAt, { at: formatDateTime(download.completedAt) })}
                </span>{" "}
                {adopted ? (
                  <Badge tone="success">{copy.downloadAdopted}</Badge>
                ) : (
                  <Button
                    variant="default"
                    disabled={adoptBusyId !== null}
                    onClick={() => adopt(download.downloadId)}
                  >
                    {copy.downloadAdoptCta}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button variant="subtle" onClick={() => setReloadKey((key) => key + 1)}>
        {copy.downloadsReload}
      </Button>
    </div>
  );
}

/* ---- 页面 ---- */

export function ImportPage({ onRequestClose }: ImportCloseRequest = {}) {
  // 能力两态数据源 = 壳能力自报(proposal 015 §11 仲裁方案 a:能力拥有者
  // (Electron 壳)经 preload 面静态自报,不经 provider 转述)。无壳环境
  // (浏览器开发)保守不可用;非函数态读取同样保守不可用。
  const availability = useMemo<EmbeddedBrowseAvailability>(
    () => browseAvailability(window.vua?.capabilities?.remoteBrowser),
    [],
  );
  // 来源分流(W25 走查缺陷②,用户裁决期望):弹窗打开先选「本地导入/
  // 云端导入」再进入对应段——不再同时铺开两段,云端段(内嵌 BOOTH 视图)
  // 只在用户显式选择后激活,不再一开弹窗就自动盖出浏览器。弹窗关闭即
  // 卸载组件,重开回到选择态(诚实起点,无记忆猜测)。
  // onRequestClose(W25 走查缺陷③根因修复):宿主弹窗的关闭请求线——
  // 受理态自动关闭计时与失败态醒目「关闭」主按钮都经此线收口;缺省
  // (如独立夹具挂载)诚实降级为无自动关闭,不猜测宿主。
  const [section, setSection] = useState<"choose" | "local" | "cloud">("choose");
  // 已完成下载计数(云端段自动收口裁决的事实源):null = 读面不可达/
  // 未落定,未知不武装(不猜态);由 CompletedDownloadsPanel 落定即报
  const [downloadsCount, setDownloadsCount] = useState<number | null>(null);
  const onRequestCloseRef = useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;
  const handleViewClosedByUser = () => {
    // 2026-09-25 用户裁决:内嵌视图被用户关闭且已完成下载为零 → 弹窗
    // 自动收口;有下载 → 驻留,云端段自持「重新打开内嵌浏览」继续操作
    if (dialogAutoCloseOnViewClose(downloadsCount)) {
      onRequestCloseRef.current?.();
    }
  };

  return (
    <div className="vua-page">
      <section className="vua-page__hero">
        <h1 className="vua-title">{copy.title}</h1>
        <p className="vua-caption vua-text-secondary">{copy.subtitle}</p>
      </section>

      {section === "choose" ? (
        <Card>
          <div className="vua-import__choose" role="group" aria-label={copy.chooseAria}>
            <p className="vua-text-secondary">{copy.chooseLead}</p>
            <div className="vua-import__choose-actions">
              <Button variant="primary" onClick={() => setSection("local")}>
                {copy.chooseLocalCta}
              </Button>
              <Button
                variant="default"
                disabled={availability.kind !== "available"}
                onClick={() => setSection("cloud")}
              >
                {copy.chooseCloudCta}
              </Button>
            </div>
            {availability.kind !== "available" ? (
              <p className="vua-caption vua-text-secondary">{copy.cloudUnavailable}</p>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="vua-page__stack">
            {section === "cloud" ? (
              /* 云端段(2026-09-25 用户裁决极简形态):无「重选来源」回行
                 (本地段保留)——空下载时关视图即弹窗收口,有下载时面板内
                 「重新打开内嵌浏览」继续,收口路径不缺 */
              <section>
                <h3 className="vua-warehouse-detail__section-title">{copy.cloudTitle}</h3>
                <EmbeddedBrowsePanel
                  availability={availability}
                  onViewClosedByUser={handleViewClosedByUser}
                />
                <h3 className="vua-warehouse-detail__section-title">{copy.downloadsTitle}</h3>
                <CompletedDownloadsPanel
                  onRequestClose={onRequestClose}
                  onDownloadsLoaded={setDownloadsCount}
                />
              </section>
            ) : (
              <section>
                <div>
                  <Button variant="subtle" onClick={() => setSection("choose")}>
                    {copy.rechooseCta}
                  </Button>
                </div>
                <h3 className="vua-warehouse-detail__section-title">{copy.localTitle}</h3>
                <LocalImportSection onRequestClose={onRequestClose} />
              </section>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

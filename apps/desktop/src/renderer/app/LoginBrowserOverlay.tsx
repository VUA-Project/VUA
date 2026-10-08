import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@vua/design-system";
import { displayUrl } from "../features/import/import-model.ts";
import "../features/import/import-page.css";
import { closeLoginBrowser, useLoginBrowserRequest } from "./login-browser-store.ts";
import { format, strings } from "../i18n/index.ts";
import "./login-browser.css";

const copy = strings.warehouse.loginBrowser;
const navCopy = strings.importPage;

/** 登录成功判定轮询间隔与自动关闭倒计时(用户裁决 2026-10-05) */
const AUTH_POLL_INTERVAL_MS = 3_000;
const AUTO_CLOSE_SECONDS = 6;

/**
 * 窗口级登录浏览器(用户裁决 2026-10-05):登录流程脱离素材导入弹窗的
 * 过渡形态——固定导航条直接挂窗口顶部(Main 侧视图照 REMOTE_VIEW_NAV_STRIP_PX
 * 让位),不依赖任何页面/弹窗宿主。
 *
 * - 登录成功检测:轮询 remoteContent.authProbe(真实判据 = 分区会话此刻
 *   能读到账号库首页;cookie 线索会被「访问过登录页」的半登录会话误报);
 *   首次 authOk 在导航条 X 旁弹「登录成功」,6 秒倒计时自动关闭,取消
 *   按钮中止倒计时(视图保留,想继续手动的用户不受打扰);
 * - 视图生命周期:本组件是唯一控制面,卸载/关闭即关视图(#25 纪律);
 *   关闭经 store 派发,仓储页订阅后重探登录态。
 */
export function LoginBrowserOverlay() {
  const request = useLoginBrowserRequest();
  return request !== null ? <LoginBrowserSurface url={request.url} /> : null;
}

function LoginBrowserSurface({ url }: { url: string }) {
  const [viewId, setViewId] = useState<string | null>(null);
  const [nav, setNav] = useState({ canGoBack: false, canGoForward: false, url: "" });
  const [countdown, setCountdown] = useState<number | null>(null);
  const viewIdRef = useRef<string | null>(null);
  viewIdRef.current = viewId;
  const closeViewRef = useRef<() => void>(() => {});
  closeViewRef.current = () => {
    const current = viewIdRef.current;
    if (current !== null) {
      void window.vua?.remoteContent?.close(current).catch(() => {});
    }
    closeLoginBrowser();
  };

  // 开视图 + 订阅事件;卸载即关视图(#25:组件是视图唯一控制面)
  useEffect(() => {
    const remote = window.vua?.remoteContent;
    if (remote === undefined) {
      closeLoginBrowser();
      return;
    }
    let disposed = false;
    void remote
      .open({ url })
      .then((state) => {
        if (disposed) {
          void remote.close(state.viewId).catch(() => {});
          return;
        }
        setViewId(state.viewId);
        setNav({ canGoBack: state.canGoBack, canGoForward: state.canGoForward, url: state.url });
      })
      .catch(() => {
        /* 打开失败(清单外/基座缺位):如实收口,不留半开状态 */
        closeLoginBrowser();
      });
    const unsubscribe = remote.events.subscribe((event) => {
      if (event.kind === "navigated" && event.viewId === viewIdRef.current) {
        setNav({ canGoBack: event.canGoBack, canGoForward: event.canGoForward, url: event.url });
      }
      if (event.kind === "view-closed" && event.viewId === viewIdRef.current) {
        setViewId(null);
        closeLoginBrowser();
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      const current = viewIdRef.current;
      if (current !== null) {
        void remote.close(current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 开启意图一次开视图
  }, [url]);

  // 登录成功检测:轮询真实判据,首次通过即武装 6 秒自动关闭(取消后不再武装)
  useEffect(() => {
    if (viewId === null) return;
    let cancelled = false;
    let armed = false;
    const poll = window.setInterval(() => {
      if (armed) return;
      void window.vua?.remoteContent
        ?.authProbe()
        .then((probe) => {
          if (cancelled || armed || !probe.authOk) return;
          armed = true;
          setCountdown(AUTO_CLOSE_SECONDS);
        })
        .catch(() => {});
    }, AUTH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [viewId]);

  // 倒计时:每秒递减,到 0 自动关闭;countdown 清 null 即中止(取消按钮)
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      closeViewRef.current();
      return;
    }
    const timer = window.setTimeout(() => {
      setCountdown((value) => (value === null ? null : value - 1));
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const historyAction = (action: "goBack" | "goForward" | "reload") => {
    if (viewId === null) return;
    void window.vua?.remoteContent?.[action](viewId).catch(() => {});
  };

  if (viewId === null) return null;

  return createPortal(
    <div className="vua-login-browser__bar" role="toolbar" aria-label={navCopy.navBarAria}>
      <button
        type="button"
        className="vua-import__browse-button"
        aria-label={navCopy.navBack}
        title={navCopy.navBack}
        disabled={!nav.canGoBack}
        onClick={() => historyAction("goBack")}
      >
        <Icon name="arrow-left" size={16} />
      </button>
      <button
        type="button"
        className="vua-import__browse-button"
        aria-label={navCopy.navForward}
        title={navCopy.navForward}
        disabled={!nav.canGoForward}
        onClick={() => historyAction("goForward")}
      >
        <Icon name="arrow-right" size={16} />
      </button>
      <button
        type="button"
        className="vua-import__browse-button"
        aria-label={navCopy.navReload}
        title={navCopy.navReload}
        onClick={() => historyAction("reload")}
      >
        <Icon name="refresh" size={16} />
      </button>
      <span className="vua-import__browse-url" title={nav.url}>
        {displayUrl(nav.url)}
      </span>
      <button
        type="button"
        className="vua-import__browse-button vua-import__browse-button--close"
        aria-label={navCopy.navClose}
        title={navCopy.navClose}
        onClick={() => closeViewRef.current()}
      >
        <Icon name="close" size={16} />
      </button>
      {countdown !== null ? (
        <div className="vua-login-browser__toast" role="status">
          <span className="vua-login-browser__toast-title">{copy.successTitle}</span>
          <span className="vua-login-browser__toast-countdown">
            {format(copy.autoCloseHint, { countdown: Math.max(countdown, 0) })}
          </span>
          <button
            type="button"
            className="vua-login-browser__toast-cancel"
            onClick={() => setCountdown(null)}
          >
            {copy.cancel}
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

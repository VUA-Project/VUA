import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@vua/design-system";
import { format, strings } from "../../i18n/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import type { TaskItem } from "../../gateway/index.ts";
import { NotificationList } from "./NotificationList.tsx";
import { scrollClosesPanel, taskRowOpenTarget } from "./notification-model.ts";
import { useNotificationCenter } from "./use-notification-center.ts";
import "./notification-popover.css";

const copy = strings.taskCenter;

/** 面板入场/退场动画窗(与 notification-popover.css 对齐) */
const PANEL_EXIT_MS = 140;

/**
 * 顶栏通知入口(对标 Comfy-Desktop 右上角铃铛,按用户裁定自绘):
 * 铃铛按钮 + 进行中徽标;点击后整屏毛玻璃 backdrop 上动画展开面板,
 * 内容经 NotificationList 投影任务事实;底部任务条已退出主壳。
 *
 * 定位纪律:header 自身带 backdrop-filter,会囚禁 fixed 后代(BOARD #38),
 * 因此 backdrop 与面板一律 portal 到 document.body;面板本体实底不模糊
 * (走查#2:行移除时 backdrop-filter 合成层留残影),模糊只放在全屏 backdrop。
 *
 * 入口显隐(§2.6):任务引擎 capability 非 ready 时整条不出现(而非禁用)。
 */
export function NotificationPopover({ navigate }: { navigate: (target: PageId) => void }) {
  const center = useNotificationCenter();
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);

  // 退场窗结束后卸载;动效压平时不空等动画窗
  useEffect(() => {
    if (phase !== "closing") return;
    const flattened =
      document.documentElement.dataset.effects === "off" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPhase("closed"), flattened ? 0 : PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const close = () => setPhase((p) => (p === "open" ? "closing" : p));

  // 打开即聚焦面板;关闭后焦点还回铃铛(仅当焦点曾在面板内)
  useEffect(() => {
    if (phase === "open") {
      wasOpenRef.current = true;
      panelRef.current?.focus();
      return;
    }
    if (phase === "closed" && wasOpenRef.current) {
      wasOpenRef.current = false;
      // 面板卸载后焦点落空到 body 时,还回铃铛;用户已点到别处则不抢
      if (document.activeElement === document.body) {
        toggleRef.current?.focus();
      }
    }
  }, [phase]);

  // 外击(排除面板与铃铛自身)/Escape/面板外滚动/失焦关闭——与 NavOverflowMenu
  // 交互对齐;面板内列表滚动不关闭(W25 真机第四批:window 捕获阶段的
  // scroll 关闭监听曾把面板内滚动一并算作关闭手势,判定语义钉在
  // notification-model.scrollClosesPanel)
  useEffect(() => {
    if (phase !== "open") return;
    const panel = panelRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      if (event.target instanceof Node && toggleRef.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onScroll = (event: Event) => {
      const target = event.target instanceof Node ? event.target : null;
      if (scrollClosesPanel(target !== null && panel?.contains(target) === true)) close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", close);
    };
  }, [phase]);

  // §2.6:任务引擎未接入时入口整条不出现(所有 hooks 之后)
  if (center.capability?.state !== "ready") return null;

  const open = phase !== "closed";

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="vua-shell__notify"
        aria-expanded={open}
        aria-label={format(copy.openAria, { count: center.activeCount })}
        onClick={() => setPhase((p) => (p === "closed" ? "open" : "closing"))}
      >
        <Icon name="bell" size={16} />
        {center.activeCount > 0 ? (
          <span className="vua-shell__notify-badge" aria-hidden="true">
            {center.activeCount}
          </span>
        ) : null}
      </button>
      {open
        ? createPortal(
            <>
              <div
                className={`vua-notify-backdrop${phase === "closing" ? " vua-notify-backdrop--closing" : ""}`}
                onClick={close}
              />
              <div
                ref={panelRef}
                className={`vua-notify-panel${phase === "closing" ? " vua-notify-panel--closing" : ""}`}
                role="region"
                aria-label={copy.title}
                tabIndex={-1}
              >
                <div className="vua-notify-panel__header">
                  <span className="vua-notify-panel__title">{copy.title}</span>
                  <button
                    type="button"
                    className="vua-notify-panel__close"
                    aria-label={copy.closeAria}
                    onClick={close}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
                <NotificationList
                  notifications={center.notifications}
                  rejectedId={center.rejectedId}
                  showCompleted={center.showCompleted}
                  onShowCompletedChange={center.setShowCompleted}
                  onCancel={(id) => void center.cancel(id)}
                  onRetry={(id) => void center.retry(id)}
                  dismissible={center.dismissible}
                  onBackToOrigin={(task: TaskItem) => {
                    close();
                    // 行打开语义经模型函数(D2):活动/终态两态一致回来源页
                    navigate(taskRowOpenTarget(task));
                  }}
                  emptyText={copy.empty}
                  replay={center.replay}
                />
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

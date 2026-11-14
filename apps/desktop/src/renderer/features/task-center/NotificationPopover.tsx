import { useAmfModule } from "../../gateway/index.ts";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../../components/primitives/Tooltip.tsx";
import { createPortal } from "react-dom";
import type { AiActionRequestV01 } from "@vua/contracts";
import { Icon } from "@vua/design-system";
import { format, strings, TERMS } from "../../i18n/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import type { TaskItem } from "../../gateway/index.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { NotificationList } from "./NotificationList.tsx";
import { isTerminalStatus, notificationBellAlert, scrollClosesPanel, taskRowOpenTarget } from "./notification-model.ts";
import { useNotificationCenter } from "./use-notification-center.ts";
import { requestClock, requestTitle } from "../ai-requests/AiRequestCard.tsx";
import { requestPage } from "../ai-requests/ai-request-routing.ts";
import { revealRequest } from "../ai-requests/ai-request-reveal.ts";
import { useAiRequests } from "../ai-requests/use-ai-requests.ts";
import "./notification-popover.css";

const copy = strings.taskCenter;
const aiCopy = strings.aiTools;

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
export function NotificationPopover({ navigate, page }: { navigate: (target: PageId) => void; page: PageId }) {
  const amf = useAmfModule();
  const center = useNotificationCenter();
  const ai = useAiRequests();
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const [pinned, setPinned] = useState(false);
  const [seenTerminalIds, setSeenTerminalIds] = useState<ReadonlySet<string>>(() => new Set());
  const [peek, setPeek] = useState<AiActionRequestV01 | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const announced = useRef(new Set<string>());

  // AI requests wait on the page they change. Elsewhere the bell offers them; in the background
  // the system is asked for attention (tray icon and taskbar button).
  const requests = ai.snapshot?.requests ?? [];
  const pending = requests.filter(request => request.state === "pending");
  const taskOrigin = (taskId: string) => center.tasks.find(task => task.id === taskId)?.originPage;
  const openRequest = (request: AiActionRequestV01) => { setPeek(null); revealRequest(request, navigate, taskOrigin); };
  const pendingKey = pending.map(request => request.id).join("|");
  useEffect(() => {
    for (const request of pending) {
      if (announced.current.has(request.id)) continue;
      announced.current.add(request.id);
      if (!document.hasFocus()) void ai.port?.attention?.();
      if (requestPage(request, taskOrigin) !== page) setPeek(request);
    }
  }, [pendingKey]);
  useEffect(() => {
    if (peek && (requestPage(peek, taskOrigin) === page || !pending.some(request => request.id === peek.id))) setPeek(null);
  }, [page, pendingKey, peek]);

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

  useEffect(() => {
    if (phase !== "open") return;
    const terminalIds = center.notifications.filter((task) => isTerminalStatus(task.status)).map((task) => task.id);
    if (terminalIds.length === 0) return;
    setSeenTerminalIds((current) => {
      if (terminalIds.every((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of terminalIds) next.add(id);
      return next;
    });
  }, [phase, center.notifications]);

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
  // 交互对齐;固定(pinned)模式下外击/外滚/失焦不自动关闭面板。
  useEffect(() => {
    if (phase !== "open") return;
    const panel = panelRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (pinned) return;
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      if (event.target instanceof Node && toggleRef.current?.contains(event.target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pinned && !(event.target instanceof Node && panel?.contains(event.target))) return;
        event.stopPropagation();
        setPinned(false);
        close();
      }
    };
    const onScroll = (event: Event) => {
      if (pinned) return;
      const target = event.target instanceof Node ? event.target : null;
      if (scrollClosesPanel(target !== null && panel?.contains(target) === true)) close();
    };
    const onBlur = () => {
      if (!pinned) close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [phase, pinned]);

  // §2.6:任务引擎未接入时入口整条不出现(所有 hooks 之后)
  if (center.capability?.state !== "ready") return null;

  const expanded = phase !== "closed";
  const count = center.activeCount + pending.length;
  const alert = notificationBellAlert(center.notifications, pending.length, seenTerminalIds);

  return (
    <>
      <Tooltip content={expanded ? null : copy.title} placement="bottom">
      <button
        ref={toggleRef}
        type="button"
        className="vua-shell__notify"
        data-nav-id="shell-notifications"
        data-attention={pending.length > 0 || undefined}
        data-alert={alert ?? undefined}
        aria-expanded={expanded}
        aria-label={format(copy.openAria, { count })}
        onClick={() => { setPeek(null); if (expanded) setPinned(false); setPhase((p) => (p === "closed" ? "open" : "closing")); }}
      >
        <Icon name="bell" size={16} />
        {count > 0 ? (
          <span className="vua-shell__notify-badge" data-alert={alert === "failed" ? "failed" : undefined} aria-hidden="true">
            {count}
          </span>
        ) : alert !== null ? (
          <span className="vua-shell__notify-dot" data-alert={alert} aria-hidden="true" />
        ) : null}
      </button>
      </Tooltip>
      {peek && !expanded
        ? createPortal(
            <div className="vua-notify-peek" role="alertdialog" aria-label={aiCopy.peekTitle} data-vua-native-occluder data-vua-shell-popover>
              <p className="vua-caption vua-text-secondary">{aiCopy.peekTitle}</p>
              <strong>{requestTitle(peek)}</strong>
              <p className="vua-caption vua-text-secondary">{format(aiCopy.askedAt, { time: requestClock(peek.createdAt) })}</p>
              <div className="vua-notify-peek__actions">
                <Button variant="primary" onClick={() => openRequest(peek)}>{aiCopy.goConfirm}</Button>
                <Button variant="subtle" onClick={() => setPeek(null)}>{aiCopy.later}</Button>
              </div>
            </div>,
            document.body,
          )
        : null}
      {expanded
        ? createPortal(
            <>
              {!pinned ? (
                <div
                  className={`vua-notify-backdrop${phase === "closing" ? " vua-notify-backdrop--closing" : ""}`}
                  data-vua-native-occluder data-vua-shell-popover
                  onClick={close}
                />
              ) : null}
              <div
                ref={panelRef}
                className={`vua-notify-panel${phase === "closing" ? " vua-notify-panel--closing" : ""}`}
                data-vua-native-occluder
                data-vua-shell-popover
                data-pinned={pinned || undefined}
                role="region"
                aria-label={copy.title}
                tabIndex={-1}
              >
                <div className="vua-notify-panel__header">
                  <span className="vua-notify-panel__title">{copy.title}</span>
                  <div className="vua-notify-panel__actions">
                    <button
                      type="button"
                      className="vua-notify-panel__pin"
                      aria-pressed={pinned}
                      aria-label={pinned ? copy.unpinAria : copy.pinAria}
                      title={pinned ? copy.unpinAria : copy.pinAria}
                      data-nav-id="shell-notifications-pin"
                      onClick={() => setPinned((current) => !current)}
                    >
                      <Icon name="pin" size={16} />
                    </button>
                    <button
                      type="button"
                      className="vua-notify-panel__close"
                      aria-label={copy.closeAria}
                      onClick={() => { setPinned(false); close(); }}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                </div>
                {amf.state === "failed" ? <p role="status">{format(strings.amfModule.failed, { amf: TERMS.amf })}</p> : null}
                {pending.length > 0 ? <section className="vua-notify-ai" aria-label={aiCopy.requests}>
                  <h3 className="vua-caption">{aiCopy.requests}</h3>
                  <ul>{pending.map(request => <li key={request.id}>
                    <span><strong>{requestTitle(request)}</strong><br />
                      <span className="vua-caption vua-text-secondary">{format(aiCopy.askedAt, { time: requestClock(request.createdAt) })}</span></span>
                    <Button variant="primary" onClick={() => { if (!pinned) close(); openRequest(request); }}>{aiCopy.goConfirm}</Button>
                  </li>)}</ul>
                </section> : null}
                <NotificationList
                  notifications={center.notifications}
                  rejectedId={center.rejectedId}
                  onCancel={(id) => void center.cancel(id)}
                  onRetry={(id) => void center.retry(id)}
                  dismissible={center.dismissible}
                  onBackToOrigin={(task: TaskItem) => {
                    if (!pinned) close();
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

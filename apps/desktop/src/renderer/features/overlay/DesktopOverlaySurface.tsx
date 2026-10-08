import { formatDateTime } from "../../i18n/index.ts";
/**
 * 桌面 Overlay 表面(切片五 F7a,键鼠形态;设计规范 v0.6.1 §8.8)。
 * 经 ?surface=overlay-desktop 在应用初始化最早阶段分流渲染:不初始化主壳
 * Gateway、DEV scenario、路由与业务 store;只挂 Overlay 表面端口。
 *
 * 017 表面批 1 消费接线:快照 = overlay.getSnapshot 冻结投影(任务卡列表＋
 * 生产状态卡);状态概括与基调由表现模型从冻结词表事实推导;unavailable
 * 为诚实缺席空态;传输失败为失败+重试态。
 *
 * 017 批 2 消费:下载/导入进度卡 = downloadCard 可选增量(仅进行中下载
 * 尝试行:downloadId/state/updatedAt,无字节进度——进度在任务事件通道,
 * 快照不发明);呈现策略「有进行中项时呈现」,缺席/空集不渲染。取消目标
 * 仍由任务卡承载(downloadId 是 correlationId 非 taskId,不做行内猜测);
 * 环境摘要属批 2 未投影,本表面不渲染。
 *
 * 2026-10-09 用户裁决:任务入口仅呈现实际任务/下载,不混入新手引导。
 * 旧版显式引导调用仍经 GuideOverlayView 与既有事件接收,兼容旧面;
 * 日常引导走帮助/阅读器。任务窗主题与主窗口共用偏好及系统变化。
 *
 * 交互规格(键鼠):紧凑面板 + 拖拽区标题栏 + 关闭 chrome;Tab/Shift+Tab
 * 焦点环(base.css 全局 :focus-visible)、Enter/Space 激活(原生 button)、
 * Esc 关闭;hover 态;目标 32–40px;单主操作(dismiss)。取消用 DelayedButton
 * 延迟确认原语(§8.1 危险操作纪律),目标由任务卡 taskId 携带。
 *
 * 诚实四态:首帧骨架 / 失败+重试 / 缺席或空态 / 正常;关闭永远可用
 * (后端不可达时退化 nativeWindow?.close())。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@vua/design-system";
import { overlayPort, overlayPreviewEnabled } from "./overlay-port-instance.ts";
import { useSurfaceAppearance } from "../../app/surface-appearance.ts";
import { GuideOverlayView, shouldClearGuideRequest, type GuideRequest } from "./GuideOverlayView.tsx";
import {
  isOverlayView,
  parseOverlayView,
  type OverlayView,
} from "./overlay-view-model.ts";
import type {
  OverlayAction,
  OverlayActionPayload,
  OverlaySnapshot,
} from "./overlay-contract.ts";
import {
  overlayViewModel,
  type OverlayActionView,
  type OverlayVisualTone,
} from "./overlay-model.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { Card } from "../../components/primitives/Card.tsx";
import { DelayedButton } from "../../components/primitives/DelayedButton.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { format, strings } from "../../i18n/index.ts";
import "./overlay.css";

const copy = strings.overlay;

/** 首帧快照超时:超过即判定后端不可达,进入失败态而非永久空白(同教程表面) */
const SNAPSHOT_TIMEOUT_MS = 4000;
/** dismiss 裁决超时:超过直接关窗,窗口永远关得掉 */
const DISMISS_TIMEOUT_MS = 2000;
/** 危险操作延迟确认(§8.1:先读完提示再可点) */
const CANCEL_DELAY_MS = 1200;
/** 壳层窗口动作(preload 注入);浏览器预览无 preload */
const nativeWindow = window.vua?.window;

/** 视觉基调 → Badge 语义色(状态不只依赖颜色:徽标文本与色条双通道) */
function badgeTone(tone: OverlayVisualTone): "neutral" | "brand" | "warning" | "error" {
  switch (tone) {
    case "neutral":
      return "neutral";
    case "accent":
      return "brand";
    case "amber":
      return "warning";
    case "error":
      return "error";
  }
}

/** 任务态文案:九态冻结词表内取任务中心同表文案,词表外原词透传(不猜测) */
const TASK_STATE_KEYS = strings.taskStatus;
function taskStateLabel(state: string): string {
  return state in TASK_STATE_KEYS
    ? TASK_STATE_KEYS[state as keyof typeof TASK_STATE_KEYS]
    : state;
}

export function DesktopOverlaySurface() {
  useSurfaceAppearance();
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // 2026-09-26 视图宿主裁决:首视图经加载查询 ?view= 投递(创建窗口的
  // Main 侧决定,渲染层词表外值回落默认视图引导,不猜态);已开窗的切换
  // 经 vua:overlay:set-view 事件投递(下方订阅)
  const [view, setView] = useState<OverlayView>(() =>
    parseOverlayView(new URLSearchParams(window.location.search).get("view")),
  );
  // 指南定位请求(首玩 B 切片):Main 的 guide-target 事件经本面暂存并
  // 转发给 GuideOverlayView——本面常驻,GuideOverlayView 的挂载时序不影响
  // 定位到达(先发 set-view 再发 guide-target 的两连发安全)
  const [guideRequest, setGuideRequest] = useState<GuideRequest | null>(null);
  const guideRequestNonce = useRef(0);

  useEffect(() => {
    const events = window.vua?.window.overlayViewEvents;
    if (!events) return;
    return events.subscribe((next) => {
      if (isOverlayView(next)) setView(next);
    });
  }, []);

  useEffect(() => {
    const events = window.vua?.window.guideTargetEvents;
    if (!events) return;
    return events.subscribe((target) => {
      setView("guide");
      guideRequestNonce.current += 1;
      setGuideRequest({ target, nonce: guideRequestNonce.current });
    });
  }, []);

  // 定位请求应用回执:只清除已被应用的那一条(之后到达的新请求保留)
  const ackGuideRequest = useCallback((nonce: number) => {
    setGuideRequest((current) =>
      shouldClearGuideRequest(current, nonce) ? null : current,
    );
  }, []);

  const loadSnapshot = useCallback((onFailure: () => void) => {
    // 首帧快照必须带超时与失败态:请求永不返回(应用层冻结/后端不可达)时
    // 窗口不得停留在无内容的空白态(同教程表面纪律)
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS);
    });
    void Promise.race([overlayPort.snapshot(), timeout])
      .then((s) => {
        if (s === null) onFailure();
        else setSnapshot(s);
      })
      .catch(onFailure);
  }, []);

  useEffect(() => {
    let alive = true;
    loadSnapshot(() => {
      if (alive) setLoadFailed(true);
    });
    const unsubscribe = overlayPort.subscribe(setSnapshot);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [loadSnapshot]);

  /** 关闭 = dismiss + 关窗;后端不可达时退化为原生关窗,窗口永远关得掉 */
  const closeSurface = useCallback(() => {
    // 宿主未注册窗口处理器时(预览 harness/桥异常)invoke 会拒绝:
    // 关窗是尽力而为,拒绝必须静默,不能表现为未处理异常
    const nativeClose = () => void nativeWindow?.close()?.catch(() => {});
    if (!nativeWindow) {
      void overlayPort
        .dispatch("dismiss")
        .then((result) => setSnapshot(result.snapshot))
        .catch(() => {});
      return;
    }
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), DISMISS_TIMEOUT_MS);
    });
    void Promise.race([overlayPort.dispatch("dismiss"), timeout])
      .then(nativeClose)
      .catch(nativeClose);
  }, []);

  // Esc 关闭(桌面键鼠纪律;焦点在任何位置都可关)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSurface();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSurface]);

  const dispatch = useCallback((action: OverlayAction, payload?: OverlayActionPayload) => {
    // rejected 携带最新快照,以其为准重新同步
    void overlayPort.dispatch(action, payload).then((result) => setSnapshot(result.snapshot));
  }, []);

  const retrySnapshot = useCallback(() => {
    setLoadFailed(false);
    setSnapshot(null);
    loadSnapshot(() => setLoadFailed(true));
  }, [loadSnapshot]);

  /** 收起(首玩 B 切片):隐藏覆盖层不销毁,保留窗口与阅读状态;
   *  无 preload 宿主(浏览器预览)幂等无动作 */
  const collapseSurface = useCallback(() => {
    const hide = window.vua?.window.hideOverlay;
    if (hide !== undefined) void hide().catch(() => {});
  }, []);

  /** 返回主窗口(首玩 B 切片):用户明确动作,允许切换焦点;
   *  无 preload 宿主幂等无动作 */
  const returnToMainWindow = useCallback(() => {
    const focusMain = window.vua?.window.focusMainWindow;
    if (focusMain !== undefined) void focusMain().catch(() => {});
  }, []);

  const model = snapshot === null ? null : overlayViewModel(snapshot, "desktop");

  const renderActionsRow = (actions: readonly OverlayActionView[]) => (
    <div className="vua-overlay__actions-row">
      {actions.filter((action) => action.visible).map((action) => {
        if (action.action === "dismiss") {
          return (
            <Button
              key={action.action}
              variant={action.primary ? "primary" : "default"}
              onClick={closeSurface}
            >
              {view === "status" ? copy.closeWindow : copy.actions.dismiss}
            </Button>
          );
        }
        return null;
      })}
    </div>
  );

  return (
    <div
      className={[
        "vua-overlay",
        "vua-overlay--desktop",
        model?.reducedMotion ? "vua-overlay--reduced-motion" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--vua-overlay-text-scale": model?.textScale ?? 1 } as CSSProperties}
    >
      <header className="vua-overlay__titlebar vua-drag-region">
        <span className="vua-overlay__title vua-drag-region">{view === "status" ? strings.journey.tasks : copy.views.guide}</span>
        {/* 演示徽标只钉在状态视图:引导是静态真实内容,标"演示数据"属误标 */}
        {overlayPreviewEnabled && view === "status" ? (
          <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
        ) : null}
        {/* 首玩 B 切片:明确的收起(隐藏不销毁)与返回主窗口(允许切换焦点);
            关闭 chrome 语义不变(关窗不取消安装、不停止游戏) */}
        <button
          type="button"
          className="vua-overlay__chrome-button"
          aria-label={copy.collapse}
          title={copy.collapse}
          onClick={collapseSurface}
        >
          <Icon name="minimize" size={16} />
        </button>
        <button
          type="button"
          className="vua-overlay__chrome-button"
          aria-label={copy.returnToMain}
          title={copy.returnToMain}
          onClick={returnToMainWindow}
        >
          <Icon name="home" size={16} />
        </button>
        <button
          type="button"
          className="vua-overlay__chrome-button vua-overlay__chrome-button--close"
          aria-label={copy.closeWindow}
          title={copy.closeWindow}
          onClick={closeSurface}
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      {/* Tasks has no onboarding switch. Legacy explicit guide requests remain compatible. */}

      <main className="vua-overlay__body">
        {view === "guide" ? (
          <GuideOverlayView guideRequest={guideRequest} onGuideRequestApplied={ackGuideRequest} />
        ) : loadFailed ? (
          <>
            <EmptyState title={copy.loadErrorTitle} description={copy.loadErrorBody} />
            <div className="vua-overlay__error-actions">
              <Button variant="default" onClick={retrySnapshot}>
                {copy.retry}
              </Button>
              <Button variant="primary" onClick={() => void nativeWindow?.close()}>
                {copy.closeWindow}
              </Button>
            </div>
          </>
        ) : model === null ? (
          <>
            <Skeleton height={72} />
            <Skeleton height={56} />
            <Skeleton height={32} width="60%" />
          </>
        ) : model.state === "inactive" ? (
          <EmptyState title={copy.inactiveTitle} description={copy.inactiveBody} />
        ) : (
          <>
            <section className="vua-overlay__status" data-tone={model.tone} aria-live="polite">
              <div>
                <Badge tone={badgeTone(model.tone)}>{copy.statusTones[model.statusTone]}</Badge>
              </div>
              <h1 className="vua-overlay__status-title">
                {format(copy.statusTitles[model.statusTitleKey], {
                  count: model.taskCards.length,
                })}
              </h1>
            </section>

            {model.taskCards.length > 0 ? (
              <section aria-label={copy.taskSectionLabel}>
                <p className="vua-overlay__section-label">{copy.taskSectionLabel}</p>
                <ul className="vua-overlay__task-list">
                  {model.taskCards.map((card) => (
                    <li key={card.taskId}>
                      <Card className="vua-overlay__task">
                        <h2 className="vua-overlay__task-title">{card.taskId}</h2>
                        <p className="vua-overlay__task-meta">
                          <Badge tone={card.cancellable ? "brand" : "neutral"}>
                            {taskStateLabel(card.stateRaw)}
                          </Badge>
                        </p>
                        {card.cancellable ? (
                          <div className="vua-overlay__task-cancel">
                            <DelayedButton
                              variant="default"
                              delayMs={CANCEL_DELAY_MS}
                              title={copy.cancelHint}
                              onClick={() => dispatch("request_cancel_task", { taskId: card.taskId })}
                            >
                              {copy.actions.requestCancel}
                            </DelayedButton>
                          </div>
                        ) : null}
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {model.productionCard.currentPlan !== null || model.productionCard.latestRecord !== null ? (
              <details className="vua-overlay__production-details">
                <summary className="vua-overlay__section-label">{copy.productionSectionLabel}</summary>
                {model.productionCard.currentPlan !== null ? (
                  <Card className="vua-overlay__production">
                    <p className="vua-overlay__production-line">
                      {format(copy.productionPlan, { planId: model.productionCard.currentPlan.planId })}
                    </p>
                    <p className="vua-overlay__production-meta">
                      {copy.productionPlanStatuses[model.productionCard.currentPlan.statusLabel as keyof typeof copy.productionPlanStatuses]
                        ?? model.productionCard.currentPlan.statusLabel}
                      {" · "}
                      {model.productionCard.currentPlan.recipeId}
                    </p>
                  </Card>
                ) : null}
                {model.productionCard.latestRecord !== null ? (
                  <Card className="vua-overlay__production">
                    <p className="vua-overlay__production-line">
                      {format(copy.productionRecord, { buildId: model.productionCard.latestRecord.buildId })}
                    </p>
                    <p className="vua-overlay__production-meta">
                      {copy.productionRecordStatuses[model.productionCard.latestRecord.statusLabel as keyof typeof copy.productionRecordStatuses]
                        ?? model.productionCard.latestRecord.statusLabel}
                      {" · "}
                      {formatDateTime(model.productionCard.latestRecord.finishedAt)}
                    </p>
                  </Card>
                ) : null}
              </details>
            ) : null}

            {model.downloadCard !== null ? (
              <section aria-label={copy.downloadSectionLabel}>
                <p className="vua-overlay__section-label">{copy.downloadSectionLabel}</p>
                <ul className="vua-overlay__task-list">
                  {model.downloadCard.activeDownloads.map((row) => (
                    <li key={row.downloadId}>
                      <Card className="vua-overlay__task">
                        <h2 className="vua-overlay__task-title">{row.downloadId}</h2>
                        <p className="vua-overlay__task-meta">
                          <Badge tone="brand">{taskStateLabel(row.stateRaw)}</Badge>
                          {" · "}
                          {formatDateTime(row.updatedAt)}
                        </p>
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {renderActionsRow(model.actions)}
          </>
        )}
      </main>
    </div>
  );
}

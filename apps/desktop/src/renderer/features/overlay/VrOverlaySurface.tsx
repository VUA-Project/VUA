/**
 * VR Overlay 表面(切片五 F7a,激光点按形态;设计规范 v0.6.1 §8.8)。
 * 经 ?surface=overlay-vr 在应用初始化最早阶段分流渲染;与桌面 Overlay 共享
 * 同一 OverlaySnapshot 端口,只回语义动作。
 *
 * 017 表面批 1 消费接线:快照 = overlay.getSnapshot 冻结投影(任务卡列表＋
 * 生产状态卡);017 批 2 下载/导入进度卡已投影,但本表面呈现面维持收窄不
 * 渲染(渲染路径未发布,随 VR 发布切片演进,如实申报)。环境摘要属批 2
 * 未投影。VR Dashboard/VR Overlay 不进 M7 与 1.0.0(用户裁决 2026-09-06),
 * 本表面为双表面共享层的形态跟随(渲染路径未发布)。
 *
 * 交互规格(触摸/激光):固定 1024×768 设计预算;无 hover 依赖——按下即
 * :active 反馈;操作目标 ≥56px;一层平面面板(不嵌套卡);动作 ≤3 个大按钮;
 * 无滚动长列表(任务卡超出以计数折叠)。
 *
 * 取消确认形态:两步确认——点一次进入确认态(confirm/keep 双按钮 + 提示),
 * 再点确认;超时或快照推进自动还原;确认态目标由任务卡 taskId 携带。
 *
 * 诚实四态与桌面一致;关闭永远可用(后端不可达退化 nativeWindow?.close())。
 * VR 表面不做装饰动画(§8.8 + reduced-motion 纪律)。
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Icon } from "@vua/design-system";
import { overlayPort } from "./overlay-port-instance.ts";
import type {
  OverlayAction,
  OverlayActionPayload,
  OverlaySnapshot,
} from "./overlay-contract.ts";
import {
  overlayViewModel,
  type OverlayVisualTone,
} from "./overlay-model.ts";
import { Badge } from "../../components/primitives/Badge.tsx";
import { Button } from "../../components/primitives/Button.tsx";
import { EmptyState } from "../../components/primitives/EmptyState.tsx";
import { Skeleton } from "../../components/primitives/Skeleton.tsx";
import { format, strings, TERMS } from "../../i18n/index.ts";
import "./overlay.css";

const copy = strings.overlay;

const SNAPSHOT_TIMEOUT_MS = 4000;
const DISMISS_TIMEOUT_MS = 2000;
/** 两步确认的超时还原(点按形态下不留悬挂的确认态) */
const CONFIRM_TIMEOUT_MS = 5000;
const nativeWindow = window.vua?.window;

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

export function VrOverlaySurface() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);

  const loadSnapshot = useCallback((onFailure: () => void) => {
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

  const dispatch = useCallback((action: OverlayAction, payload?: OverlayActionPayload) => {
    void overlayPort.dispatch(action, payload).then((result) => setSnapshot(result.snapshot));
  }, []);

  const retrySnapshot = useCallback(() => {
    setLoadFailed(false);
    setSnapshot(null);
    loadSnapshot(() => setLoadFailed(true));
  }, [loadSnapshot]);

  // 快照推进(含取消生效)即解除确认态,不留悬挂
  const snapshotKey = snapshot === null ? "none" : JSON.stringify(snapshot);
  useEffect(() => {
    setCancelTarget(null);
  }, [snapshotKey]);

  // 确认态超时自动还原
  useEffect(() => {
    if (cancelTarget === null) return;
    const timer = setTimeout(() => setCancelTarget(null), CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [cancelTarget]);

  const model = snapshot === null ? null : overlayViewModel(snapshot, "vr");
  const openOnDesktop = model?.actions.find((action) => action.action === "open_on_desktop");
  const dismiss = model?.actions.find((action) => action.action === "dismiss");

  return (
    <div
      className={[
        "vua-overlay",
        "vua-overlay--vr",
        model?.reducedMotion ? "vua-overlay--reduced-motion" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--vua-overlay-text-scale": model?.textScale ?? 1 } as CSSProperties}
    >
      <header className="vua-overlay__titlebar">
        <span className="vua-overlay__title">{copy.surfaceTitle}</span>
        {import.meta.env.DEV ? (
          <Badge tone="warning">{strings.common.fixtureBadge}</Badge>
        ) : null}
        <button
          type="button"
          className="vua-overlay__chrome-button vua-overlay__chrome-button--close"
          aria-label={copy.closeWindow}
          onClick={closeSurface}
        >
          <Icon name="close" size={24} />
        </button>
      </header>

      <main className="vua-overlay__body">
        {loadFailed ? (
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
            <Skeleton height={120} />
            <Skeleton height={64} />
            <Skeleton height={56} width="50%" />
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
              <section className="vua-overlay__task" aria-label={copy.taskSectionLabel}>
                {snapshot?.schemaVersion === 3 && snapshot.amfUnavailable ? <p role="status">{format(strings.amfModule.failed, { amf: TERMS.amf })}</p> : null}
              {model.taskCards.map((card) => (
                  <div key={card.taskId} className="vua-overlay__task-row">
                    {cancelTarget === card.taskId ? (
                      // 确认态下只留确认/返回两个目标(动作 ≤3,确认语境不混排)
                      <>
                        <Button
                          className="vua-overlay__button--danger"
                          onClick={() => {
                            setCancelTarget(null);
                            dispatch("request_cancel_task", { taskId: card.taskId });
                          }}
                        >
                          {copy.actions.cancelConfirm}
                        </Button>
                        <Button variant="default" onClick={() => setCancelTarget(null)}>
                          {copy.actions.cancelKeep}
                        </Button>
                      </>
                    ) : (
                      <>
                        <h2 className="vua-overlay__task-title">{card.taskId}</h2>
                        <p className="vua-overlay__task-meta">
                          <Badge tone={card.cancellable ? "brand" : "neutral"}>
                            {taskStateLabel(card.stateRaw)}
                          </Badge>
                        </p>
                        {card.cancellable ? (
                          <Button variant="default" onClick={() => setCancelTarget(card.taskId)}>
                            {copy.actions.requestCancel}
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                ))}
                {cancelTarget !== null ? (
                  <p className="vua-overlay__hint">{copy.cancelArmedHint}</p>
                ) : (
                  <p className="vua-overlay__hint">{copy.cancelHint}</p>
                )}
              </section>
            ) : null}

            {model.productionCard.currentPlan !== null || model.productionCard.latestRecord !== null ? (
              <section aria-label={copy.productionSectionLabel}>
                {model.productionCard.currentPlan !== null ? (
                  <p className="vua-overlay__task-meta">
                    {format(copy.productionPlan, { planId: model.productionCard.currentPlan.planId })}
                    {" · "}
                    {copy.productionPlanStatuses[model.productionCard.currentPlan.statusLabel as keyof typeof copy.productionPlanStatuses]
                      ?? model.productionCard.currentPlan.statusLabel}
                  </p>
                ) : null}
                {model.productionCard.latestRecord !== null ? (
                  <p className="vua-overlay__task-meta">
                    {format(copy.productionRecord, { buildId: model.productionCard.latestRecord.buildId })}
                    {" · "}
                    {copy.productionRecordStatuses[model.productionCard.latestRecord.statusLabel as keyof typeof copy.productionRecordStatuses]
                      ?? model.productionCard.latestRecord.statusLabel}
                  </p>
                ) : null}
              </section>
            ) : null}

            <div className="vua-overlay__actions">
              <div className="vua-overlay__actions-row">
                {openOnDesktop?.visible ? (
                  <Button
                    variant={openOnDesktop.primary ? "primary" : "default"}
                    onClick={() => dispatch("open_on_desktop")}
                  >
                    {copy.actions.openOnDesktop}
                  </Button>
                ) : null}
                {dismiss?.visible ? (
                  <Button
                    variant={dismiss.primary ? "primary" : "default"}
                    onClick={closeSurface}
                  >
                    {copy.actions.dismiss}
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

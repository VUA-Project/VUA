/**
 * 应用导览表面(三类引导架构 2026-10-05 §2:主窗口内的有序高亮导览)。
 * 渲染在主 React 树内(经 AppShell 挂载),高亮真实控件:高透明遮罩
 * (box-shadow 反镂空)+ 高亮环 + 指引卡;导览永不覆盖其他应用。
 *
 * 纪律(guidance §2 / 首玩交付计划 §2.B):
 * - 步进即页面导航:步表声明页面与锚点,进入该步经 App 的 navigate
 *   直达,锚点按有界重试等待渲染(布局未长开不误判,同引导定位纪律);
 * - 锚点缺席 = 诚实缺席态:指引卡居中 + 该步的缺席说明,绝不指向
 *   不相关位置;控件中途出现也不抢焦点(缺席说明保持可读);
 * - back/next、skip/exit、restart(经壳的 startRequest)齐全;退出保留
 *   底层页面、已接受任务与输入——导览不派发任何业务动作,也不取消
 *   任务;等待下载不会把玩家困在导览里;
 * - 键盘纪律:步进后焦点落在指引卡,Esc = 跳出,←/→ 翻步,Tab 在卡内
 *   循环;导览结束恢复先前焦点;
 * - 进度状态独立(storageKeys.tourProgress):从未运行 = 自动开始,
 *   active 按步号恢复(中途关应用),completed/skipped 不再自动出现;
 *   重播经命令面板,不重置阅读器或安装状态。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { storageKeys } from "../../app/storage-keys.ts";
import { Button } from "../../components/primitives/Button.tsx";
import { format, strings } from "../../i18n/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import {
  TOUR_STEPS,
  normalizeStep,
  parseTourProgress,
  serializeTourProgress,
  type TourProgressV1,
} from "./tour-model.ts";
import "./tour.css";

/** 锚点等待上限(帧):布局与页面导航落定的时间预算,超时 = 诚实缺席 */
const ANCHOR_MAX_ATTEMPTS = 60;
/** 指引卡排版参数(与 tour.css 对齐) */
const CARD_WIDTH = 360;
const CARD_MARGIN = 16;
const CARD_GAP = 12;
const CARD_EST_HEIGHT = 250;
/** 高亮环外扩:控件四周留出可辨空隙 */
const HIGHLIGHT_PAD = 6;

/** 锚点矩形(视口坐标,与 fixed 定位同参照系) */
interface AnchorRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly bottom: number;
}

/** target 三态:undefined = 测量中;null = 锚点缺席;rect = 在位 */
type AnchorTarget = AnchorRect | null | undefined;

function rectOf(element: Element): AnchorRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    bottom: rect.bottom,
  };
}

function readStoredProgress(): TourProgressV1 | null {
  try {
    return parseTourProgress(localStorage.getItem(storageKeys.tourProgress));
  } catch {
    return null;
  }
}

function persistProgress(progress: TourProgressV1): void {
  try {
    localStorage.setItem(storageKeys.tourProgress, serializeTourProgress(progress));
  } catch {
    /* 存储不可用:进度仅本次会话生效 */
  }
}

/** 指引卡落点:优先锚点下方,空间不足换上方,都放不下则钳回视口内 */
function placeCard(rect: AnchorRect): CSSProperties {
  const left = Math.min(
    Math.max(CARD_MARGIN, rect.left + rect.width / 2 - CARD_WIDTH / 2),
    Math.max(CARD_MARGIN, window.innerWidth - CARD_WIDTH - CARD_MARGIN),
  );
  const below = rect.bottom + CARD_GAP;
  const above = rect.top - CARD_GAP - CARD_EST_HEIGHT;
  let top: number;
  if (below + CARD_EST_HEIGHT <= window.innerHeight - CARD_MARGIN) top = below;
  else if (above >= CARD_MARGIN) top = above;
  else top = Math.min(below, window.innerHeight - CARD_EST_HEIGHT - CARD_MARGIN);
  return { left, top, width: CARD_WIDTH };
}

/** 缺席态指引卡:视口居中(不指向任何不相关位置) */
function centerCard(): CSSProperties {
  return {
    left: Math.max(CARD_MARGIN, window.innerWidth / 2 - CARD_WIDTH / 2),
    top: Math.max(CARD_MARGIN, window.innerHeight / 2 - CARD_EST_HEIGHT / 2),
    width: CARD_WIDTH,
  };
}

export function AppTour({
  page,
  navigate,
  startRequest,
  autoStart = true,
}: {
  page: PageId;
  navigate: (target: PageId) => void;
  /** 壳侧重播信号:值递增 = 从第一步重开(命令面板入口) */
  startRequest: number;
  autoStart?: boolean;
}) {
  const copy = strings.tour;
  const [progress, setProgress] = useState<TourProgressV1 | null>(() => readStoredProgress());
  const [target, setTarget] = useState<AnchorTarget>(undefined);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastStartRequest = useRef(startRequest);

  const active = progress?.status === "active";
  const stepIndex = active ? normalizeStep(progress.step, TOUR_STEPS.length) : 0;
  // 步号经 normalizeStep 钳回合法区间,表长 ≥ 1;断言收敛索引访问
  const stepDef = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0]!;
  const lastStep = stepIndex === TOUR_STEPS.length - 1;

  // 从未运行 = 自动开始(每次档案一次;跳过/完成后不再自动出现)
  useEffect(() => {
    if (!autoStart) return;
    setProgress((current) => {
      if (current !== null) return current;
      const started: TourProgressV1 = { v: 1, status: "active", step: 0 };
      persistProgress(started);
      return started;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载一次
  }, []);

  // 壳侧重播信号:跳过初始值,递增 = 从第一步重开
  useEffect(() => {
    if (startRequest === lastStartRequest.current) return;
    lastStartRequest.current = startRequest;
    const restarted: TourProgressV1 = { v: 1, status: "active", step: 0 };
    persistProgress(restarted);
    setProgress(restarted);
  }, [startRequest]);

  // 步进即页面导航:目标页与当前页不同才导航(页面切换由 App 渲染承载)
  useEffect(() => {
    if (!active) return;
    if (page !== stepDef.page) navigate(stepDef.page);
    // navigate/page 由壳每次渲染重建;仅按步号导航
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 步进驱动
  }, [active, stepIndex]);

  // 锚点获取(有界重试):导航/渲染落定后查找;找到先滚入视口再测量;
  // 超时 = 该步锚点缺席,诚实进入缺席态
  useEffect(() => {
    if (!active) return;
    let attempts = 0;
    let frame: number | null = null;
    let cancelled = false;
    setTarget(undefined);
    const run = () => {
      if (cancelled) return;
      attempts += 1;
      const element = document.querySelector(stepDef.anchor);
      if (element instanceof HTMLElement) {
        element.scrollIntoView({ block: "center" });
        setTarget(rectOf(element));
        return;
      }
      if (attempts >= ANCHOR_MAX_ATTEMPTS) {
        setTarget(null);
        return;
      }
      frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [active, stepIndex, page, stepDef.anchor]);

  // 在位锚点跟随滚动/窗口变化(缺席态不升级——缺席说明保持可读)
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      const element = document.querySelector(stepDef.anchor);
      if (!(element instanceof HTMLElement)) return;
      setTarget((current) => (current === null ? current : rectOf(element)));
    };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [active, stepIndex, stepDef.anchor]);

  // 步进后焦点落卡;激活时记下先前焦点,退出时恢复(键盘纪律)
  useEffect(() => {
    if (!active) {
      const previous = returnFocusRef.current;
      returnFocusRef.current = null;
      previous?.focus?.();
      return;
    }
    if (returnFocusRef.current === null) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    const frame = requestAnimationFrame(() => cardRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, stepIndex]);

  const applyProgress = useCallback((next: TourProgressV1) => {
    persistProgress(next);
    setProgress(next);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (progress?.status !== "active") return;
      applyProgress({ v: 1, status: "active", step: normalizeStep(next, TOUR_STEPS.length) });
    },
    [progress, applyProgress],
  );

  const exit = useCallback(
    (status: "completed" | "skipped") => {
      applyProgress({ v: 1, status, step: 0 });
    },
    [applyProgress],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      exit("skipped");
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (!lastStep) goTo(stepIndex + 1);
      else exit("completed");
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(stepIndex - 1);
      return;
    }
    // Tab 在指引卡内循环(遮罩下页面不可达,焦点不得逸出)
    if (event.key === "Tab") {
      const card = cardRef.current;
      if (card === null) return;
      const focusable = [...card.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  if (!active) return null;

  const stepCopy = copy.steps[stepDef.id as keyof typeof copy.steps];
  const absentCopy = "absent" in stepCopy ? stepCopy.absent : undefined;
  const absent = target === null;
  const cardStyle =
    target === null || target === undefined
      ? centerCard()
      : placeCard(target);

  return (
    <div className="vua-tour" role="dialog" aria-modal="true" aria-label={copy.title} data-absent={absent || undefined} onKeyDown={onKeyDown}>
      {target != null ? (
        <div
          className="vua-tour__highlight"
          style={{
            left: target.left - HIGHLIGHT_PAD,
            top: target.top - HIGHLIGHT_PAD,
            width: target.width + HIGHLIGHT_PAD * 2,
            height: target.height + HIGHLIGHT_PAD * 2,
          }}
        />
      ) : null}
      <div className="vua-tour__card" ref={cardRef} tabIndex={-1} style={cardStyle}>
        <p className="vua-tour__counter">
          {format(strings.onboarding.steps.counter, {
            current: stepIndex + 1,
            total: TOUR_STEPS.length,
          })}
        </p>
        <h2 className="vua-tour__title">{stepCopy.title}</h2>
        <p className="vua-tour__body">{stepCopy.body}</p>
        {absent ? <p className="vua-tour__absent">{absentCopy ?? copy.absentDefault}</p> : null}
        <div className="vua-tour__actions">
          <Button variant="subtle" onClick={() => exit("skipped")}>
            {copy.skip}
          </Button>
          <div className="vua-tour__nav">
            <Button variant="default" disabled={stepIndex === 0} onClick={() => goTo(stepIndex - 1)}>
              {copy.back}
            </Button>
            <Button variant="primary" onClick={() => (lastStep ? exit("completed") : goTo(stepIndex + 1))}>
              {lastStep ? copy.finish : copy.next}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

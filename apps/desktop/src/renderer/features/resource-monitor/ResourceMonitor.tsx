import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SystemResourceUsageV1 } from "@vua/contracts";
import { Icon } from "@vua/design-system";
import { format, strings } from "../../i18n/index.ts";
import {
  formatGigabytes,
  usagePercents,
} from "./resource-monitor-model.ts";
import "./resource-monitor.css";

const copy = strings.resourceMonitor;

/** 顶栏读数轮询间隔(ms):与 Main 侧 VRAM 采样间隔同档,数字不跳动刺眼 */
const POLL_INTERVAL_MS = 2_000;

/**
 * 顶栏占用查看器(2026-09-25 用户裁决):设置按钮左侧的常驻读数——
 * RAM/VRAM 占用百分比二者取高;点击展开贴近右上角的小窗,看 RAM/VRAM
 * 具体占用(已用/总量 GiB + 采样时刻)。数据全部来自 Main 侧采集快照,
 * 缺席(浏览器 dev 无宿主/首拍未回)整条不出现;VRAM 采集不可用
 * 如实呈现「不可用」,绝不猜值。
 *
 * 定位纪律:header 带 backdrop-filter 会囚禁 fixed 后代(BOARD #38),
 * 弹层 portal 到 document.body,锚定视口右上角。
 */
export function ResourceMonitor() {
  const [snapshot, setSnapshot] = useState<SystemResourceUsageV1 | null>(null);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 轮询 Main 侧缓存快照;宿主缺席(纯浏览器 dev)不挂载轮询
  useEffect(() => {
    const system = window.vua?.system;
    if (system === undefined) return;
    let alive = true;
    const tick = () => {
      system
        .readResourceUsage()
        .then((next) => {
          if (alive) setSnapshot(next);
        })
        .catch(() => {
          /* 单拍失败保留上一帧,下一拍自愈;不猜造读数 */
        });
    };
    tick();
    const timer = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  // 外击(排除弹层与按钮自身)/Escape/失焦关闭——与通知弹层交互对齐
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && panel?.contains(event.target)) return;
      if (event.target instanceof Node && toggleRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    // 失焦关闭必须用具名处理器:removeEventListener 按引用匹配,匿名箭头
    // 每次都是新引用、移除永不生效——每次开合循环泄漏一个常驻 blur 监听
    // (2026-09-25 反向审查发现,cae84388 引入;与通知弹层的具名 close 同构)
    const onWindowBlur = () => setOpen(false);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [open]);

  // 首拍未回/无宿主:诚实缺席,整条不出现
  if (snapshot === null) return null;

  const view = usagePercents(snapshot);

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="vua-shell__usage vua-caption"
        aria-expanded={open}
        aria-label={format(copy.indicatorAria, { percent: view.dominantPct })}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="gauge" size={16} />
        <span className="vua-shell__usage-value">{view.dominantPct}%</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="vua-usage-panel"
              role="region"
              aria-label={copy.title}
              tabIndex={-1}
            >
              <div className="vua-usage-panel__header">
                <span className="vua-usage-panel__title">{copy.title}</span>
                <button
                  type="button"
                  className="vua-usage-panel__close"
                  aria-label={copy.closeAria}
                  onClick={() => setOpen(false)}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              <div className="vua-usage-panel__row">
                <span className="vua-usage-panel__label">{copy.ram}</span>
                <span
                  className="vua-usage-panel__bar"
                  role="meter"
                  aria-valuenow={view.ramPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span
                    className="vua-usage-panel__bar-fill"
                    style={{ width: `${view.ramPct}%` }}
                  />
                </span>
                <span className="vua-usage-panel__pct">{view.ramPct}%</span>
                <span className="vua-usage-panel__bytes">
                  {formatGigabytes(snapshot.ramUsedBytes)} / {formatGigabytes(snapshot.ramTotalBytes)} GB
                </span>
              </div>
              <div className="vua-usage-panel__row">
                <span className="vua-usage-panel__label">{copy.vram}</span>
                {view.vramPct !== null &&
                snapshot.vramUsedBytes !== null &&
                snapshot.vramTotalBytes !== null ? (
                  <>
                    <span
                      className="vua-usage-panel__bar"
                      role="meter"
                      aria-valuenow={view.vramPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span
                        className="vua-usage-panel__bar-fill"
                        style={{ width: `${view.vramPct}%` }}
                      />
                    </span>
                    <span className="vua-usage-panel__pct">{view.vramPct}%</span>
                    <span className="vua-usage-panel__bytes">
                      {formatGigabytes(snapshot.vramUsedBytes)} / {formatGigabytes(snapshot.vramTotalBytes)} GB
                    </span>
                  </>
                ) : (
                  <span className="vua-usage-panel__unavailable">{copy.vramUnavailable}</span>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

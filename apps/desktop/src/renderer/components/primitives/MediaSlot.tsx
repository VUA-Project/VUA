/**
 * 媒体槽(ui-ux §2.8 加载/失败语义 + v0.3.3 诚实状态原则):
 * - 加载中:等比骨架屏,与最终布局同形(经 aspectRatio 约定);
 * - 失败:诚实说明 + 重试按钮,不显示破图、不停留在空白;
 * - 就绪:显示媒体本身。
 *
 * 两种重试模式:
 * - manual(默认,本地 SVG 等):失败后说明 + 手动重试按钮;
 * - auto(远程目录图片):失败不展示按钮,转圈等待并按
 *   MEDIA_AUTO_RETRY_INTERVAL_MS / MEDIA_AUTO_RETRY_MAX 自动重载;
 *   耗尽后保持转圈,直到 src 变更或组件重建(下次列出时恢复额度)。
 *   浮层遮挡场景(卡片 hover 动作层)下手动按钮不可达,远程图必须用 auto。
 */
import { useEffect, useState } from "react";
import { strings } from "../../i18n/index.ts";
import { Button } from "./Button.tsx";
import { Skeleton } from "./Skeleton.tsx";
import {
  MEDIA_AUTO_RETRY_INTERVAL_MS,
  mediaReducer,
  shouldAutoRetry,
  type MediaState,
} from "./media-state.ts";
import "./media-slot.css";

export interface MediaSlotProps {
  src: string;
  alt: string;
  /** 宽高比(如 "16 / 9"),加载/失败态与最终媒体同形,避免布局跳动 */
  aspectRatio?: string;
  /** 重试模式:manual = 说明+按钮(本地媒体);auto = 转圈自动重载(远程媒体) */
  retry?: "manual" | "auto";
  /** 展台专用:强制渲染某一状态(正常内容流不得使用) */
  previewState?: MediaState;
}

export function MediaSlot({
  src,
  alt,
  aspectRatio = "16 / 9",
  retry = "manual",
  previewState,
}: MediaSlotProps) {
  const [state, setState] = useState<MediaState>("loading");
  // attempt 既作 img 重建键,也作缓存破除参数(同名失败响应不应被缓存复用)
  const [attempt, setAttempt] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const effective = previewState ?? state;

  // src 变更即重置:重新列出该商品(新 src)时恢复重试额度
  useEffect(() => {
    setState("loading");
    setAttempt(0);
    setRetryCount(0);
  }, [src]);

  // 缓存秒载护栏(真机 2026-10-03):浏览器缓存命中的图片可能在 React
  // 挂上 onLoad 之前就完成加载,事件丢失会让卡片永久停在 spinner 且
  // 正文被 pending 遮蔽。ref 回调在挂载/重建时检查 complete +
  // naturalWidth,已完成即直接置 ready;未完成则由 onLoad 正常接管。
  const imageRef = (element: HTMLImageElement | null): void => {
    if (element !== null && element.complete && element.naturalWidth > 0) {
      setState((current) => (current === "loading" ? "ready" : current));
    }
  };

  // 自动重试:失败后在间隔后重建 img;耗尽次数后停在转圈(诚实等待,
  // 不显示失败说明——用户无需操作,也不必面对不可达的按钮)
  useEffect(() => {
    if (retry !== "auto" || state !== "failed" || !shouldAutoRetry(retryCount)) return;
    const timer = setTimeout(() => {
      setRetryCount((count) => count + 1);
      setAttempt((value) => value + 1);
      setState((current) => mediaReducer(current, "retry"));
    }, MEDIA_AUTO_RETRY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [retry, state, retryCount]);

  if (effective === "failed" && retry === "manual") {
    return (
      <div className="vua-media-slot vua-media-slot--failed" style={{ aspectRatio }}>
        <span className="vua-media-slot__note">{strings.media.loadFailed}</span>
        <Button
          variant="subtle"
          onClick={() => {
            setState((s) => mediaReducer(s, "retry"));
            setAttempt((a) => a + 1);
          }}
        >
          {strings.media.retry}
        </Button>
      </div>
    );
  }

  // auto 模式的缓存破除:重试时给请求加 _r 序号(vuaimg handler 只读 u 参数,
  // 缓存键仍按原始 URL;浏览器直连时避免复用失败响应)
  const effectiveSrc =
    retry === "auto" && attempt > 0
      ? `${src}${src.includes("?") ? "&" : "?"}_r=${attempt}`
      : src;

  return (
    <div className="vua-media-slot" style={{ aspectRatio }}>
      {effective !== "ready" ? (
        retry === "auto" ? (
          <span
            className="vua-media-slot__spinner"
            role="status"
            aria-label={strings.media.loading}
          />
        ) : (
          <Skeleton width="100%" height="100%" />
        )
      ) : null}
      {/* 非就绪期间保持布局盒但不可见(visibility 而非 display:none):
       *  loading="lazy" 对 display:none 的图片会被 Chromium 立即加载(兼容行为),
       *  只有带布局盒的不可见图才能真正延迟到接近视口再请求——309 张卡片的
       *  目录墙依赖这一点避免首屏下载风暴;visibility 同样遮挡裂图 icon。
       *  decoding="async":大图解码不阻塞主线程 */}
      <img
        key={attempt}
        ref={imageRef}
        className="vua-media-slot__img"
        data-pending={effective !== "ready" || undefined}
        loading="lazy"
        decoding="async"
        src={effectiveSrc}
        alt={alt}
        onLoad={() => setState((s) => mediaReducer(s, "load"))}
        onError={() => setState((s) => mediaReducer(s, "error"))}
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import "./brand-mark.css";

/**
 * 正式字标(品牌候选 06「Level」,2026-10-07 用户裁决启用):
 * 120° 斜笔 VUA 组合标志,几何取自 _local_branding/VUA/candidates-06 的
 * SVG 主稿(200×200 外轮廓、16 单位笔画,U/A 底部连接线齐平,几何未改动)。
 *
 * 环境域为紫色,AMF 域为橙色,其它域为三色混合。每层直接消费对应
 * 基础语义令牌,避免旧图层随新页面的 --vua-accent 一起变色。
 * 混合标志的 U 使用 --vua-text-strong 适配深浅色主题;切换采用
 * 120° 从右上向左下覆盖,保留既有品牌几何和对比度令牌。
 */
const LETTER_PATHS = {
  v: [
    "M0 0L16 0L16 200L0 200Z",
    "M0 197.856406L114.23245 0L132.707658 0L17.237604 200L0 200Z",
  ],
  u: [
    "M137.075765 0L155.550974 0L40.08092 200L21.605711 200Z",
    "M159.91908 0L178.394289 0L62.924235 200L44.449026 200Z",
    "M30.843315 184H72.161839L62.924235 200H21.605711Z",
  ],
  a: [
    "M182.762396 0L200 0L200 2.143594L85.76755 200L67.292342 200Z",
    "M184 0L200 0L200 200L184 200Z",
    "M85.76755 184H192V200H76.529946Z",
  ],
} as const;

type BrandDomain = "env" | "production" | "global" | "settings";

function Letters({ domain }: { domain: BrandDomain }) {
  const accent = domain === "production" ? "var(--vua-orange)" : "var(--vua-purple)";
  const mixed = domain !== "env" && domain !== "production";
  const fills = {
    v: accent,
    u: mixed ? "var(--vua-text-strong)" : accent,
    a: mixed ? "var(--vua-orange)" : accent,
  } as const;
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" fill="currentColor" stroke="none">
      <g fill={fills.v}>
        {LETTER_PATHS.v.map((path) => <path key={path} d={path} />)}
      </g>
      <g fill={fills.u}>
        {LETTER_PATHS.u.map((path) => <path key={path} d={path} />)}
      </g>
      <g fill={fills.a}>
        {LETTER_PATHS.a.map((path) => <path key={path} d={path} />)}
      </g>
    </svg>
  );
}

/** Two decorative layers keep their own domain colours during the 120° wipe.
 * Cleanup uses a timer rather than animationend, so flattened motion cannot
 * strand the old layer. Rapid navigation replaces the transition immediately. */
export function BrandMark({ domain }: { domain: BrandDomain }) {
  const [transition, setTransition] = useState({ current: domain, previous: null as BrandDomain | null });
  if (transition.current !== domain) setTransition({ current: domain, previous: transition.current });
  useEffect(() => {
    if (transition.previous === null) return;
    const timer = window.setTimeout(() => setTransition(current => ({ ...current, previous: null })), 420);
    return () => window.clearTimeout(timer);
  }, [transition.current, transition.previous]);
  return <span className="vua-brand-switch" role="img" aria-label="VUA">
    {transition.previous !== null ? <span className="vua-brand-switch__previous" aria-hidden="true"><Letters domain={transition.previous} /></span> : null}
    <span key={domain} className={transition.previous === null ? "vua-brand-switch__current" : "vua-brand-switch__current vua-brand-switch__current--wiping"} data-brand-domain={domain} aria-hidden="true"><Letters domain={domain} /></span>
  </span>;
}

/**
 * 正式字标(品牌候选 06「Level」,2026-10-07 用户裁决启用):
 * 120° 斜笔 VUA 组合标志,几何取自 _local_branding/VUA/candidates-06 的
 * SVG 主稿(200×200 外轮廓、16 单位笔画,U/A 底部连接线齐平,几何未改动)。
 *
 * 两种着色(用户裁决:环境部署紫、模型生产橙、设置三色混合):
 * - solid:三组字母全部消费 --vua-accent 辖区别名——env 区解析为品牌紫、
 *   production 区解析为 AMF 橙,浅色主题自动落到压暗令牌(#6557D2/#BB4A10);
 * - mixed:V 消费 --vua-accent(设置区=紫)、A 固定 --vua-orange 基础令牌
 *   (不随辖区),U 消费 --vua-text-strong——候选稿的 U 为纯黑,只适合浅色
 *   底评审;顶栏深色画布上以 text-strong 适配双主题(浅色下仍为黑)。
 * 颜色全部经语义令牌消费,不引入新的字面色值(check-contrast 辖区不变)。
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

export function BrandMark({ variant }: { variant: "solid" | "mixed" }) {
  const fills = {
    v: "var(--vua-accent)",
    u: variant === "mixed" ? "var(--vua-text-strong)" : "var(--vua-accent)",
    a: variant === "mixed" ? "var(--vua-orange)" : "var(--vua-accent)",
  } as const;
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="VUA" fill="currentColor" stroke="none">
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

import { createHash } from "node:crypto";
import { productsOf, type Share } from "./validation.js";

const copy = {
  en: { title: "Materials", recipe: "This is an Avatar assembly plan.", purchase: "Buy these materials yourself. This page is only a list and includes no files.", open: "Open in VUA", get: "Get VUA", product: "BOOTH item", count: "items" },
  ja: { title: "使用素材", recipe: "アバターの組み立てプランです。", purchase: "素材はご自身で購入してください。このページは一覧のみで、ファイルは含まれません。", open: "VUAで開く", get: "VUAを入手", product: "BOOTH商品", count: "点" },
  "zh-Hans": { title: "素材清单", recipe: "这是一份 Avatar 装配方案。", purchase: "这些素材需要自行购买。这里只是一份清单，不包含任何文件。", open: "在 VUA 中打开", get: "获取 VUA", product: "BOOTH 商品", count: "件素材" },
  "zh-Hant": { title: "素材清單", recipe: "這是一份 Avatar 組裝方案。", purchase: "這些素材需要自行購買。這裡只是一份清單，不包含任何檔案。", open: "在 VUA 中開啟", get: "取得 VUA", product: "BOOTH 商品", count: "件素材" },
  ko: { title: "사용 소재", recipe: "아바타 조립 구성입니다.", purchase: "소재는 직접 구매해야 합니다. 이 페이지는 목록이며 파일을 포함하지 않습니다.", open: "VUA에서 열기", get: "VUA 다운로드", product: "BOOTH 상품", count: "개" },
} as const;
export type Language = keyof typeof copy;

export function languageFor(header: string): Language {
  const preferences = header.split(",").map((entry, index) => {
    const [tag = "", ...parameters] = entry.trim().toLowerCase().split(";");
    const q = parameters.find(part => part.trim().startsWith("q="))?.trim().slice(2) ?? "1";
    return { tag, quality: /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/u.test(q) ? Number(q) : 0, index };
  }).filter(entry => entry.quality > 0).sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of preferences) {
    const base = tag.split("-")[0];
    if (base === "ja" || base === "en" || base === "ko") return base;
    if (base === "zh") return /(?:^|-)(?:hant|tw|hk|mo)(?:-|$)/u.test(tag) ? "zh-Hant" : "zh-Hans";
    if (tag === "*") return "en";
  }
  return "en";
}

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

const style = `:root{color-scheme:light dark;--bg:#f4f3ef;--card:#fff;--ink:#202a29;--muted:#5a6561;--line:#d2d9d2;--accent:#246448}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}main{width:min(100% - 32px,760px);margin:44px auto 64px}header{display:flex;justify-content:space-between;gap:20px;align-items:center;border-bottom:1px solid var(--line);padding-bottom:20px}.brand{font-size:20px;font-weight:800;letter-spacing:.12em}code{font-size:12px;overflow-wrap:anywhere;color:var(--muted)}h1{font-size:clamp(30px,7vw,46px);line-height:1.2;margin:36px 0 14px}p{margin:0 0 16px}.count{color:var(--muted);font-size:14px}ul{list-style:none;padding:0;margin:24px 0}li{padding:20px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin:12px 0;overflow-wrap:anywhere}a{color:var(--accent);text-underline-offset:4px}li a{font-weight:650;display:inline-block;min-height:32px}.shop,.variant{color:var(--muted);font-size:14px;margin:6px 0 0}.notice{border-top:1px solid var(--line);padding-top:24px;color:var(--muted)}.actions{display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin-top:28px}.primary{padding:12px 22px;min-height:48px;background:var(--accent);color:#fff;border-radius:8px;text-decoration:none;font-weight:650}.actions>a:not(.primary){padding:12px 0}a:focus-visible{outline:3px solid var(--ink);outline-offset:5px}@media(prefers-color-scheme:dark){:root{--bg:#141c19;--card:#1c2923;--ink:#e5ede7;--muted:#adbbb1;--line:#3c5043;--accent:#a9d4ae}.primary{color:#142219}}@media(max-width:440px){main{margin-top:24px}header{align-items:flex-start;flex-direction:column;gap:6px}li{padding:16px}.actions{align-items:stretch;flex-direction:column;gap:10px}.primary{text-align:center}}`;
export const PAGE_CSP = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(style).digest("base64")}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`;

/** Intentionally never reads either kind's player-supplied title. */
export function materialPage(share: Share, code: string, language: Language): string {
  const text = copy[language];
  const products = productsOf(share);
  const pageTitle = `${text.title} · VUA`;
  const description = `${products.length} ${text.count}${"recipe" in share ? ` — ${text.recipe}` : ""} ${text.purchase}`;
  const items = products.map(product => `<li><a href="https://booth.pm/ja/items/${product.productId}" target="_blank" rel="noopener noreferrer">${text.product} #${product.productId} ↗</a>${product.shopName ? `<p class="shop">${escapeHtml(product.shopName)}</p>` : ""}${product.variantName ? `<p class="variant">${escapeHtml(product.variantName)}</p>` : ""}</li>`).join("");
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow,noarchive"><meta property="og:type" content="website"><meta property="og:site_name" content="VUA"><meta property="og:title" content="${escapeHtml(pageTitle)}"><meta property="og:description" content="${escapeHtml(description)}"><meta name="twitter:card" content="summary"><title>${escapeHtml(pageTitle)}</title><style>${style}</style></head><body><main><header><span class="brand">VUA</span><code>${code}</code></header><h1>${text.title}</h1>${"recipe" in share ? `<p>${text.recipe}</p>` : ""}<p class="count">${products.length} ${text.count}</p><ul>${items}</ul><p class="notice">${text.purchase}</p><nav class="actions"><a class="primary" href="vua://share/${code}">${text.open}</a><a href="https://ph-r.com/projects/vua/" rel="noreferrer">${text.get} ↗</a></nav></main></body></html>`;
}

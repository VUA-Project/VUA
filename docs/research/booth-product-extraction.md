# BOOTH product page extraction spec

> Status: Research record — retained extraction study; input to the N5 capability audit, no normative effect
> Spec content version: 0.2 (0.1 amended by golden-anchor ancestor trace)
> Scope: BOOTH product page (static archive) extraction research for BDL
> Updated: 2026-10-02
> Effect: none. The earlier "Accepted — governs the recognition-pipeline
> rewrite" framing predates the N5 audit-first ruling; this study is evidence
> input to the N5 capability audit ([development-outline](../development-outline.md)),
> and any recognition-pipeline rework is a proposal that audit judges.

Derived from real product HTML observed in the local corpus; the golden
anchors are products 4431242 and 5986971 (full archives kept locally, never
in the repository). Rules drawn from static page structure were confirmed
against those two archived pages, including the negative knowledge in the
pitfalls section. Rows describing live-site or post-render behavior that two
static archives cannot prove (for example `Delisted → HTTP 404/410`) are
marked **live-check pending**: they record expectations, not
archive-confirmed facts.

## Page structure

```text
<main>
└─ #items                         product root
   ├─ #js-item                    frontend mount point — usually EMPTY in static HTML
   ├─ article
   │  ├─ .summary                 product summary block
   │  ├─ .primary-image-area      product image gallery
   │  └─ .main-info-column        description body and additional sections
   └─ aside                       related products / related shops — NOT part of this product
```

## Extraction rules

| Data | Actual HTML location | Rule |
| --- | --- | --- |
| Product ID | `#items[data-product-id]` | The native BOOTH product ID. |
| BOOTH category | `#items[data-shop-tracking-product-category]` | Taken directly (e.g. `3D Characters`); `data-product-category` is the numeric code. |
| Category fallback | `#js-item-category-breadcrumbs` | Used only when the root carries no category; never infer a category. |
| Title | `article .summary h2` | The full displayed title. |
| Title fallback | `script[type="application/ld+json"]`, Product `name` | `data-product-name` was observed truncated (Nemesis), so it must not be the sole title source. |
| Author / shop name | `article .shop-name` (inside the `section.shop-items` block: `.shop-info` → `.shop-name`) | The displayed name. v0.1 first located it under `.summary`; the golden-anchor ancestor trace (4431242) showed the shop block is a separate section outside `.summary`. |
| Author page | JSON-LD Product `brand.url`, or the shop link | Records the author/shop itself; not treated as a body link. |
| Adult marker | `.summary [class~="bg-primary700"]` with text `Adult` | Only BOOTH's explicit display counts; never guess from the title. |
| Likes | `#js-item-wishlist-button` | After browser rendering the count sits in the button's text node (usually `.typography-14`); may be empty in static archives. **Live-check pending** — the rendered count is not observable in the archived static HTML. |
| Published date | `#js-item-published-date` | Rendered text, e.g. `商品公開日時：2024年8月11日 20時22分`. **Live-check pending** — rendered-only field, null in the archived static HTML (pitfall 3). |
| Updated date | no stable source field | Standing decision: keep `null`. |
| Single price | `#items[data-product-price]` or JSON-LD `offers.price` | Only valid for products without complex options. |
| Overall availability | JSON-LD `offers.availability` | `InStock`, `OutOfStock`, … |
| Sold out | `li.variation-item.sold-out` or a disabled buy button | Record as unavailable; never delete the product record. |
| Delisted | HTTP 404/410 | Record a deleted/tombstone state. **Live-check pending** — a live HTTP status cannot be confirmed from static archives. |
| Subproducts | `#variations > li.variation-item` | Each `li` is one publicly sold option. |
| Subproduct name | `li .variation-name` | Original text; never replace with a semantic classification. |
| Subproduct price | `li .variation-price` | Amount and currency. |
| Subproduct ID | `data-product-variant` or hidden `input[name="cart_item[variation_id]"]` | Cart and gift buttons may duplicate; dedupe by ID. |
| Subproduct order/count | count and DOM order of `li.variation-item` | The page has no unified stock field; store the option count and the display order. |
| Body | `.js-market-item-detail-description.description` | Extract the visible body text. |
| Additional body sections | `section.shop__text` within the same `article` | Append to the body in DOM order. |
| Search projection | body, title, author, subproduct names, source category | Concatenated into one string; links stay inside the body string. |
| Product images | `.primary-image-area .market-item-detail-item-image` `data-origin` | Prefer originals; `src`/`data-lazy` are fallbacks. |
| Body images | `<img>`, `<picture><source>` inside the body | Enter `image_urls` only when confirmed to belong to this product. |
| Videos | `<video src>`, `<video><source>`, explicit YouTube/Vimeo `<iframe>` | Ordinary download links and trial-page links never enter `video_urls`. |
| Discovery thumbnails | `li.item-card[data-product-id] .item-card__thumbnail` | Discovery-page data; not part of the product projection. |

## Pitfalls (negative knowledge)

1. `#js-item` is a frontend mount point and is frequently **empty** in saved
   raw HTML; the actual detail comes from the `article` under `#items`.
2. Body links (VRChat trial pages, related products, author pages, Discord,
   Google Drive, …) stay inside the body search string; they never
   automatically become images or videos.
3. `favorites_count` and `source_published_at` currently return `null` in
   static archives; `source_updated_at` being empty is a standing decision.
   The locations above rest on rendered-page observation rather than the two
   static archives, so they are marked live-check pending in the table.
4. `created_at`, `updated_at`, and `observed_at` are pipeline times — they
   are never BOOTH product publish times.

## Pipeline contract

- Fetch pace for any BOOTH HTML/image re-verification: **6 seconds per
  request**, inherited from the legacy crawler's observed rule; `robots.txt`
  is fetched and hashed alongside (`robots_url` + `robots_sha256`).
- Extraction output fed the spike schema `schemas/bdl-spike/v0.1/schema.sql`
  (`products` columns); the current frozen production schema is
  `schemas/bdl/v0.2`. Every row carries `content_hash`, `observed_at`,
  `run_id`, and `processor_version` so trust is traceable to the producing
  pipeline.
- A from-zero recognition-pipeline rewrite against these rules was proposed
  here and exercised on 2026-09-04: `crates/orchestrator/src/booth_extraction.rs`
  cites this document as its rule source, golden assertions run on the two
  anchor archives locally, and CI uses structurally equivalent synthetic
  fixtures only. Under the N5 audit-first ruling, the capability audit
  decides whether that pipeline is retained, completed, or replaced — this
  document no longer prescribes a rewrite.

## Open items

- Terms observation (VN3 / ToS) extraction rules — pending the Google
  Docs/Drive automated-access policy review; v1 keeps human extraction.
- Compatibility/dependency extraction rules from body text and subproduct
  names — same method: real HTML first, rules second.

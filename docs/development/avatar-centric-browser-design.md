# Avatar-centric asset browser and omnibox design

> Status: Draft — awaiting author ruling on Section 2.1 before implementation
> Scope: N5 top-level `Browse` workspace (`AssetBrowserPage`, `SiteBrowser`, `BoothReadGate`, and Avatar discovery model)
> Updated: 2026-11-14
> Owner: AMF + Desktop

## 1. Baseline traceability and verified BOOTH facts

### 1.1 Existing branch baseline

Commits `dab0d670` and `8143c2f1` on `slice/booth-free-assets` implement the 2026-11-14 author
ruling for opt-in manual free-asset discovery and browser download adoption:

| Area | Owning file on `slice/booth-free-assets` | Current state |
| --- | --- | --- |
| Product scope ruling | [product-boundary.md](../product-boundary.md#booth-free-asset-discovery-and-browser-download-adoption-user-ruling-2026-11-14) | Top-level `Browse` page, manual initiation only, unified pixiv Common Terms Article 14 (items 23 and 24) pacing rule, human download click in `SiteBrowser`, and `artifact_mappings` + `zip_intake` single-card reconciliation |
| N5 delivery outline | [development-outline.md](../development-outline.md#n5-audit-and-redo-material-management) | Records the opt-in free-asset discovery and browser-download adoption path without closing real-material or human UI review |
| Contracts and registry | [booth-free-assets-v0.1.md](../protocols/booth-free-assets-v0.1.md), [desktop-browser-v0.1.md](../protocols/desktop-browser-v0.1.md), [REGISTRY.md](../REGISTRY.md) | `booth-free-assets` `0.1` (`Implementation baseline`) and `desktop-browser` `1.2.0` (`Candidate`) with JSON Schemas and wire vectors |
| Session read gate and parser | `apps/desktop/src/electron/booth-read-gate.ts`, `crates/acquisition/src/booth_free_assets.rs` | Shared FIFO BOOTH session gate, strict `data-product-price="0"` card parser, four-way ownership union, and `<VUA_PROVIDER_DATA>/free-assets-state.json` persistence (`BDL_FORMAT_VERSION` unchanged at `0.11`) |
| Browser chrome | `apps/desktop/src/renderer/components/SiteBrowser.tsx`, `apps/desktop/src/renderer/components/browser-frame.css` | Tab strip, static `.vua-browser-frame__address` display, Browser Homepage, and `BOOTH Free` local tab |

Real-machine UI review on Windows 11 across Grid Dark, Tenshi Kaiwai Light, and Jirai Kei Dark on
2026-11-14 exposed four structural UX and visual defects in that baseline:

1. `Browse` lacks first-class Avatar reading and Avatar-classified material browsing; raw bracket
   extraction split dual-script titles for the same Avatar into duplicate chips without thumbnails
   or local compatibility counts.
2. The `BOOTH Free` label repeated four times across the Browser Homepage and navigation bar,
   treating free items as a bolted-on sub-feature rather than an Avatar-scoped discovery filter.
3. `.vua-browser-frame__address` rendered read-only placeholder text instead of functioning as an
   interactive address and search bar, while carrying a redundant right-hand mode button.
4. Multi-line shortcut cards, sidebar borders, hanging header motifs, and Latin title glyphs
   exhibited theme regressions in Tenshi Kaiwai and Jirai Kei.

### 1.2 Verified public BOOTH browse behavior (2026-11-14)

Verified against live public BOOTH browse pages on 2026-11-14 with `>= 5,200 ms` spacing (raw HTML
discarded immediately; only structural facts retained):

1. **Dedicated 3D sub-category paths and query parameters:**
   - BOOTH serves dedicated browse routes by Japanese category name under `/ja/browse/<category>`,
     including independent routes for `/ja/browse/3D髪型` and `/ja/browse/3D靴`. Numeric category
     IDs do not appear in browse URLs and are not relied upon for routing or local classification.
   - Server-side query filtering via `?q=<encoded>&max_price=0&sort=new&in_stock=true` (and without
     `max_price=0`) is active on all eight verified HTTP `200` routes:
     - `/ja/browse/3Dモデル`
     - `/ja/browse/3D衣装`
     - `/ja/browse/3D髪型`
     - `/ja/browse/3D靴`
     - `/ja/browse/3D装飾品`
     - `/ja/browse/3Dテクスチャ`
     - `/ja/browse/3Dツール・システム`
     - `/ja/browse/3Dモーション・アニメーション`
   - For example, `/ja/browse/3D髪型` returned `2,752` items unfiltered, `37` items with
     `?q=VRChat&max_price=0&sort=new&in_stock=true`, and `/ja/browse/3D靴?q=VRChat&sort=new&in_stock=true`
     returned `592` items with server-generated pagination links preserving
     `?in_stock=true&page=2&q=VRChat&sort=new`.
   - `3Dツール・システム` and `3Dモーション・アニメーション` remain two distinct tabs so one tab
     selection maps to exactly one single-page request.
2. **Multi-variant starting price (`~`) DOM and sample folding:**
   - On `li.item-card`, `data-product-price` stores only the integer minimum price without a range
     marker, whereas `.price` renders `<div class="price ...">¥ 2,000~</div>` (ASCII `¥`, space,
     comma-grouped digits, and trailing ASCII `~` when higher-priced variants exist).
   - Card parsing must read `.price` text to preserve any trailing `~` (`hasPriceRange`). If an
     item combines a `¥ 0` trial variant with paid full variants (`¥ 0~`), the UI must display
     `¥ 0~` rather than plain `¥ 0`.
   - Sample and trial folding (`isSample`: titles matching `お試し`, `サンプル`, `体験版`, or
     standalone ASCII words `demo` / `sample`) remains collapsed by default (`showSamples: false`)
     with an explicit count toggle.

---

## 2. Scope and security boundaries

### 2.1 Open author ruling required: price scope in category browse

[N5](../development-outline.md#n5-audit-and-redo-material-management) currently states that
`Browse` opens BOOTH and public discovery sites as ordinary browser shortcuts without adding a
general catalog adapter, and the 2026-11-14 ruling scoped inline card queries strictly to
`max_price=0` free distributions. Implementation awaits the author's choice between:

- **Option B1-A (retain current boundary — free distributions only):**
  Inline Avatar-by-category browsing queries `max_price=0&in_stock=true` across the eight 3D
  categories alongside local library fit counts. No paid catalog prices are queried inline, and no
  price-scope toggle is needed; browsing all paid items for the selected Avatar opens the real
  BOOTH search page in a `SiteBrowser` web tab. Requires no expansion of N5 catalog scope.
- **Option B1-B (expand boundary — page-1 all-price category browse plus free filter):**
  Adds an `[ All | Free ]` filter toggle (`max_price=0` omitted vs present) and renders observed
  `.price` text including trailing `~` (`¥ 2,000~`, `¥ 0~`) and `Owned` badges. Requires an
  explicit author ruling and synchronized updates to [development-outline.md](../development-outline.md)
  and [product-boundary.md](../product-boundary.md).

### 2.2 Locked boundary rules

1. **No third-party search URL construction:**
   Per the 2026-10-09 ruling ([product-boundary.md](../product-boundary.md#missing-files-and-source-supplementation-user-ruling-2026-10-08)),
   third-party search integration remains deferred. Only BOOTH receives Main-constructed keyword
   browse URLs. Third-party shortcut cards (`VRCFinder`, `BOOTHPLORER`, `Yorimichi`, `PolySeek`,
   `VRC STYLE`, `Avatar Network`, `Avatar Catalog`, `VRC DB`) open their fixed public home URLs
   only; when an Avatar is selected, the UI provides a plain **Copy Avatar name** button for manual
   pasting.
2. **Main-owned omnibox resolution and session-partition isolation:**
   - The renderer never constructs arbitrary navigation URLs; it submits raw user text via a narrow
     IPC call `desktopBrowser.submitOmnibox(viewIdOrNull, rawInput)` (`desktop-browser` bumped to
     `1.3.0` Candidate).
   - Electron Main parses and routes `rawInput` under `security.ts`:
     - **Pseudo-protocols and unknown schemes** (`javascript:`, `data:`, `file:`, `blob:`,
       `vbscript:`): unconditionally rejected in Main.
     - **BOOTH item shorthand or URL** (`booth:<digits>` or `https://booth.pm/.../items/<digits>`):
       opened in `SiteBrowser` (`persist:vua-remote`) with automatic product observation.
     - **Allowlisted asset-discovery origins** (`browsingOrigins` / `allowedOrigins`): opened in
       `SiteBrowser`. When viewing a non-`booth.pm` allowlisted site, the browser bar displays a
       factual notice that built-in download intake accepts `booth.pm` product files only.
     - **Unlisted `http:` / `https:` URLs:** never loaded into the authenticated
       `persist:vua-remote` session partition. Main prompts via `confirmNavigation` displaying both
       the ASCII Punycode hostname (`url.hostname`) and full URL; upon confirmation, Main hands the
       URL to the OS default browser via `openExternal`.
     - **Plain search keywords:** Main encodes the query into
       `https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?q=<encoded>` and opens it in a
       `SiteBrowser` web tab.
3. **Plain terminology and explicit download adoption:**
   - UI copy uses plain terms (`免费配布` in `zh-CN`, `免費素材` in `zh-TW`, `無料配布` in `ja`,
     `Free assets` in `en`, `무료 소재` in `ko`) without slang, removing the right-hand bar button
     and the fourfold `BOOTH Free` repetition.
   - `收入素材库` (`Add to library`) refers strictly to adopting files that the player personally
     clicked to download on a BOOTH item page (`warehouse.importDownloads`), never automated
     claiming.

---

## 3. Avatar reading, alias preservation, and player correction

`Browse` consolidates onto a single Browser Homepage (`home` tab) plus real `web` tabs, retiring
the separate `free-assets` pseudo-tab. Avatar reading uses existing BDL facts and an AMF-owned
state file (`<VUA_PROVIDER_DATA>/avatar-browser-state.json`), leaving `BDL_FORMAT_VERSION` at `0.11`:

1. **Candidate Avatar selection without outfit false positives:**
   - Includes library rows whose `sourceCategory === "3Dキャラクター"`, or partially synced rows
     whose title contains `オリジナル3Dモデル` / `Original 3D Model` without subordinate outfit
     phrasing (`対応`, `専用`, `向け`), plus player-added watched Avatars.
2. **Original-script display and search names (`extractAvatarDisplayNames`):**
   - `avatarFitNames()` in `materials-fit-model.ts` folds width, lowercases, and strips spaces for
     comparison only and must not be used as UI labels.
   - A dedicated pure helper `extractAvatarDisplayNames(title, packageNames)` preserves original
     casing and script: dual-script quoted spans such as `「あかり -akari-」` together with package
     stems such as `Akari_v1.0.zip` resolve onto **one** Avatar card with `primaryName: "あかり"`
     and `aliases: ["akari", "Akari"]`, eliminating duplicate chips for the same Avatar.
3. **Evidence-split local compatibility counts and short-name word boundaries:**
   - Local items are bucketed by `LibraryRowV01.sourceCategory` string names (`"3D衣装"`,
     `"3D髪型"`, `"3D靴"`, `"3D装飾品"`, `"3Dテクスチャ"`, `"3Dツール・システム"`,
     `"3Dモーション・アニメーション"`, `"3Dモデル（その他）"`).
   - Counts separate two distinct evidence classes:
     - **Author-linked items:** BDL `product_description_links` explicitly referencing the Avatar's
       `productId`;
     - **Name-matched clues:** title or package text matching an Avatar alias, guarded by non-alphanumeric
       word boundaries for ASCII names (preventing short names from matching unrelated substrings)
       and bracket/compatibility-suffix context (`対応`, `専用`, `用`, `向け`) for 2-character CJK
       or kana names.
4. **Player merge/split overrides and stable identity across sync:**
   - `avatar-browser-state.json` stores player `avatarOverrides` to manually merge two Avatar cards
     (such as v1/v2 `productId` entries or an unlinked local package), split an unwanted merge,
     hide a misclassified card, or override the preferred BOOTH search keyword.
   - Confirmed products use `product:<productId>`; unlinked local Avatars use
     `entry:<warehouseItemId>` while recording `memberEntryIds`. When a local Avatar later gains a
     confirmed `productId` via sync reconciliation or manual provenance, its overrides migrate
     automatically to `product:<productId>` without splitting into two cards.

---

## 4. Request discipline and shared rate budget

1. **Honest network disclosure on Homepage open:**
   Opening `Browse` triggers zero BOOTH HTML or search requests. Rendering thumbnails for owned
   Avatars loads cached or recorded `https://booth.pximg.net/` images through the existing
   `vua-img://` proxy on first view.
2. **Five-layer throttling in Electron Main (`BoothReadGate`):**
   - **UI debounce (`450 ms`):** rapid Avatar, category, or filter clicks coalesce into the final
     selection before invoking IPC.
   - **Preemptive cancellation (`AbortController`):** a new browse request immediately aborts any
     queued or in-flight browse request it supersedes.
   - **10-minute result cache:** Main caches up to 30 normalized `(query, categoryName, priceMode)`
     entries for `600,000 ms`; revisiting a recent Avatar/category pair renders from memory with
     zero network reads unless the player explicitly clicks refresh.
   - **Shared sliding-window budget (`10 reads / 60 s`):** `BoothReadGate` enforces a shared
     rolling 60-second ceiling of at most 10 BOOTH HTML reads across category browse queries,
     `catalog.searchProducts`, foreground `fetchProduct` observations, and background
     `catalog-enrich`, returning a typed cooldown/budget status when full.
   - **Minimum inter-read spacing:** `>= 1,500 ms` for public browse/keyword searches and
     `>= 5,000 ms` for product-page reads, halting immediately on HTTP `403`, `429`, `5xx`, or
     sign-in redirection.

---

## 5. Multi-theme geometry, border, and typography fixes

1. **Container corner role on multi-line cards (`shapes.css`):**
   Avatar cards, result cards, and community shortcut cards use container semantics (`--vua-corners-container`:
   Grid `8px`, Tenshi `14px`, Jirai `10px`) rather than bare `<button>` containers, preventing
   `shapes.css` (`--vua-corners-action-quiet: 999px` in Tenshi and Jirai) from turning multi-line
   cards into text-clipping pills.
2. **Theme-conditional left border on `.vua-browser-frame`:**
   Grid's gradient-glass sidebar draws no right border (`app-shell.css`), so `.vua-browser-frame`
   retains its base `border-left: 1px solid var(--vua-border)` in Grid and suppresses `border-left`
   only in themes whose sidebar already draws a solid outer edge (`frutiger-aero`, `jirai`, and
   `tenshi` beside its `14px` webbing strap).
3. **Single Portal rendering path with `--vua-header-overhang`:**
   `BrowserFrame` keeps one consistent Portal mount across `home` and `web` tabs (avoiding remounts
   on tab switch). A shell token `--vua-header-overhang` (`0px` in Grid, Aero, and `data-hc="on"`;
   `12px` in Tenshi for the zipper tape; `16px` in Jirai for the black lace hem) offsets both
   `.vua-browser-frame` top/height and the native `WebContentsView` viewport bounds so hanging
   header motifs remain unobstructed on every tab.
4. **Latin `unicode-range` handoff on decorative title fonts:**
   `make-fonts.mjs` already includes printable ASCII (`0x20–0x7E`), and `ZCOOL KuaiLe`'s own glyph
   for uppercase `O` is square-shaped. Adding `unicode-range` excluding Basic Latin (`U+0021–007E`)
   to the `@font-face` rules for `ZCOOL KuaiLe` (`jirai.css`) and `Resource Han Rounded CN`
   (`tenshi.css`) delegates `BOOTH`, `VRChat`, and `Avatar` to `--vua-font-family` cleanly.
5. **Seamless active-tab join and Tenshi Light contrast:**
   Active tabs merge cleanly into `.vua-browser-frame__bar` without a continuous bottom border seam
   or corner-clipped inset top shadow, and Tenshi Light uses solid `#ffffff` (`--vua-bg-panel`)
   surfaces with `--vua-border-strong` outlines for crisp contrast.

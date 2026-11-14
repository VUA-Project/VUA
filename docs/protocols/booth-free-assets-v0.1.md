# BOOTH free-asset discovery v0.1

> Document version: 0.1
> Status: Implementation baseline (2026-11-14)
> Owner: AMF acquisition

This face backs the opt-in **BOOTH Free** tab inside AMF's
top-level `Browse` page ([product boundary](../product-boundary.md#booth-free-asset-discovery-and-browser-download-adoption-user-ruling-2026-11-14)).
Electron Main owns the BOOTH session, polite read spacing, and
cancellation; AMF parses supplied public browse pages, computes live Warehouse ownership
status against BDL, and persists preferences and the last result cache in its own local
state file (`<VUA_PROVIDER_DATA>/free-assets-state.json`). No BDL tables or migrations
are added (`BDL_FORMAT_VERSION` remains `0.11`), and discovery never writes `products` or
`product_library_memberships`.

## Closed category and item rules

Watched keywords are trimmed strings of 1–80 Unicode scalars without control or unpaired
surrogate code points. At most 20 keywords may be stored and at most **5** may have
`enabled: true` simultaneously. Suggested keywords are extracted deterministically from
bracketed literal spans (`「...」`, `『...』`, `【...】`) in observed `3Dキャラクター` product
titles in BDL, excluding generic modifier phrases (`オリジナル`, `3Dモデル`, `対応`, `専用`,
`衣装`, `VRC`, `VRChat`, `アバター`, `Avatar`, `ver`, `改変`).

Closed BOOTH 3D sub-category IDs (`FreeAssetCategoryIdV01`) match BOOTH's numeric
`data-product-category` attribute and `.item-card__category-anchor` label:

- Default enabled: `"209"` (`3D衣装`), `"230"` (`3D髪型`), `"231"` (`3D靴`),
  `"217"` (`3D装飾品`), `"214"` (`3Dテクスチャ`).
- Default disabled (player-toggleable): `"215"` (`3Dツール・システム`),
  `"216"` (`3Dモーション・アニメーション`), `"127"` (`3Dモデル（その他）`).
- Unlisted sub-categories normalize `categoryId` to `null` while retaining a non-empty
  observed `categoryLabel` (up to 120 scalars) when present.

Card parsing accepts only `li.item-card` elements with numeric `data-product-id` (1–20
digits, mapped to `booth:<digits>`) and `data-product-price="0"`. Non-zero prices are
discarded. At most 60 unique items are parsed per page. `thumbnailUrl` is read from
`.item-card__thumbnail-image[data-original]` (falling back to an `img[src]` inside the
thumbnail anchor) and accepted **only** when it is a valid `https://booth.pximg.net/` URL
without credentials or fragments; any other URL becomes `null`.

Each item carries factual flags only:

- `isSample`: `true` when the title matches `お試し`, `サンプル`, `体験版`, or standalone
  ASCII words `demo` / `sample` (case-insensitive). The UI hides sample cards by default
  (`showSamples: false`) and shows a collapsed count toggle.
- `hasDateCue`: `true` when the title contains explicit date/period wording (`期間限定`,
  `無料期間`, `本日まで`, `今週末まで`, `\d{1,2}/\d{1,2}\s*まで`, or `\d{1,2}月\d{1,2}日\s*まで`).
  `セール` alone never sets `hasDateCue`, and the UI labels this factually as a date cue in
  the title rather than asserting time-limited free status.
- `owned`: recomputed live on every AMF state/ingest/update reply as the four-way union of
  BDL `product_library_memberships`, `library_entry_metadata.product_id`,
  `artifact_mappings.product_id`, and `removed_library_cards`.

## Application methods

All methods use the v0.1 application envelope and closed parameter objects.

- Query `freeAssets.state { schemaVersion: "0.1" }` returns `FreeAssetsStateV01`:
  `{ schemaVersion: "0.1", watchedKeywords, suggestedKeywords, enabledCategories, hideOwned, showSamples, dismissedProductIds, lastQueriedAt, items }`.
- Command `freeAssets.updatePreferences { schemaVersion: "0.1", watchedKeywords?, enabledCategories?, hideOwned?, showSamples?, dismissProductId?, clearDismissed? }`
  requires at least one mutation field, validates closed bounds, writes
  `free-assets-state.json` via temporary-file write + sync + rename, and returns the
  updated `FreeAssetsStateV01`.
- Command `freeAssets.ingestSearchPage { schemaVersion: "0.1", keyword, sourceUrl, html, fetchedAt, resetCache }`
  validates that `sourceUrl` equals
  `https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?q=${encodeURIComponent(keyword)}&max_price=0&sort=new&in_stock=true`,
  `html` is 1..5,000,000 UTF-8 bytes containing a recognized BOOTH browse shell
  (`.market-items` or `li.item-card[data-product-id]`), and `fetchedAt` is a UTC RFC 3339
  timestamp. When `resetCache` is `true`, previous cached items are replaced; when `false`,
  newly parsed items merge by `productId` and append `keyword` to `matchedKeywords`. Returns
  the updated `FreeAssetsStateV01`.

Invalid parameters return `vua.free_assets.invalid_params`; unrecognized HTML returns
`vua.free_assets.invalid_page`; storage or readiness failures return
`vua.free_assets.store_failed` or `vua.free_assets.unavailable`. Corrupt state files are
quarantined to `free-assets-state.corrupt-<timestamp>.json` and reset to clean defaults
without blocking AMF startup.

## Desktop transport and browser adoption

Main exposes `window.vua.freeAssets` (`status()`, `query(target?)`, `cancel()`, `subscribe()`) to
trusted local senders when AMF is ready:

- Zero startup or background requests. `query(target?)` runs only on explicit player invocation
  for an ad-hoc keyword (`string`), an explicit list of 1–5 keywords (`readonly string[]`), or
  the enabled watched keywords (`undefined` / `null`, at most 5). A new player query supersedes
  any in-flight free-assets query; runs yield with `"busy"` only while `catalogSync` or active
  `DownloadPort` transfers are running.
- Every BOOTH session HTTP read (`freeAssets`, `catalogEnricher`, `catalogSync.fetchProduct`,
  and `catalogSync.searchProducts`) acquires a slot from the shared Main FIFO BOOTH read gate
  (`booth-read-gate.ts`), enforcing `5,000 ms` minimum spacing for item-page enrichment and
  silent downloads and `1,500 ms` minimum spacing for public keyword and `max_price=0` browse
  searches. Foreground reads pause `catalogEnricher` while queued or active.
- `query()` streams per-keyword updates over `vua:free-assets:changed`, supports immediate
  `AbortSignal` cancellation via `cancel()`, and halts immediately on HTTP `403`, `429`,
  `5xx`, network error, or sign-in redirection without clearing prior cached results if the
  first keyword failed.
- Clicking a card calls `desktopBrowser.openBoothItem(productId)` to open
  `https://booth.pm/ja/items/<digits>` in `SiteBrowser` (`purpose="assets"`). When the
  player clicks BOOTH's download button and later adopts the completed delivery via
  `warehouse.importDownloads`, `DownloadAdopter` resolves `product_id` from
  `initiated_from_page_url` / `source_url` / `url_chain`, records `artifact_mappings`
  (`channel = "download_adoption"`), records library-agnostic `product_downloadables`
  (`library_type = NULL`) and `managed_library_files` when `url_chain[0]` names
  `https://booth.pm/downloadables/<id>` for an observed product, and expands `.zip`
  originals through `zip_intake`.

Schemas and synthetic vectors live in `schemas/booth-free-assets/v0.1`.

## Document changelog

- 0.1 (2026-11-14): manual Avatar-scoped BOOTH free-asset discovery, shared five-second read gate, AMF state file, and browser-download reconciliation.

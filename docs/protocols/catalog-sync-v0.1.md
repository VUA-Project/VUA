# Catalog-sync v0.1 — account-library page ingest

> Document version: 0.1
> Status: **Frozen** (2026-10-02) — schema + positive/negative vectors + consumer test shipped together; machine-readable vocabulary in `schemas/catalog-sync/v0.1/`
> Updated: 2026-10-02
> Maintainer: Data
> Scope: `catalog.ingestLibraryPage` — one archived account-library listing page, Electron reader to provider

## Purpose

N5 S1 ([rework plan](../development/n5-rework-plan.md) D4): the Electron partition-session reader
fetches the signed-in account's library pages and ships each archived page to the provider; the
provider parses it and folds the items into the BDL products table through the existing W17
observation write face (`record_product_observation`). This is the missing catalog producer the
[capability audit](../development/n5-capability-audit.md) row E1 identified.

## Request

Method `catalog.ingestLibraryPage`, params per [`schemas/catalog-sync/v0.1/request.schema.json`](../../schemas/catalog-sync/v0.1/request.schema.json):
`schemaVersion` ("0.1"), `sourceUrl`, `html` (the archived page verbatim), `fetchedAt` (RFC 3339),
optional `pageNumber` / `runId` (correlation metadata only). Requests never carry cookies, session
tokens or credentials; the partition session stays inside Electron.

## Parsing and honesty rules

The listing grammar (`li.item-card[data-product-id]` with name/brand/category/price attributes,
`.item-card__thumbnail` images, `a[rel="next"]` pagination) was verified read-only against the
public site on 2026-10-02; the signed-in library page itself is not reachable without an account
and remains pending real-run verification. A page with no recognizable listing structure is the
contract error `vua.catalog.not_a_library_page`, never an empty success. Per item: currency, the
Adult badge, availability and shop display name are not observable on a listing card, so the price
pair is omitted entirely (amount and currency are admitted together or not at all) and the gaps are
recorded in `missing_fields` — never guessed. Item URLs normalize scheme/relative forms onto
`https://booth.pm`; a card without a link derives the canonical URL from the observed product id.
A full product-page observation (the existing `booth_extraction` grammar) refines these fields
later.

## Result

Success value per [`response.schema.json`](../../schemas/catalog-sync/v0.1/response.schema.json):
`parsedCount`, `upsertedCount`, `rejectedItems` (closed-set violations reported per item, never
silently dropped), `nextPageUrl` (observed continuation or null). Upsert semantics make page
replays safe: same-content overwrite, never a second row; every successful write advances
`catalog_updated_seq` in-transaction (bdl-queries v0.3+ freshness semantics).

## Boundaries

Only the account's own library pagination is read; no whole-site crawl, no purchase or payment
interaction, no entitlement expansion. When `runId` is present, each page folds the run's
nine-state task (first page walks Queued → Preparing → Running, later pages are progress, the
observed last page completes as Succeeded — SucceededWithWarnings when items were rejected); a
mid-run abort leaves the task non-terminal for restart recovery to surface as inspect-required,
and a replayed last page of a finished run is a no-op. Progress payloads carry per-page facts with
the page ordinal. Real logged-in runs are user-run local evidence; until then this face's runtime
coverage is synthetic vectors only.

## Document changelog

- 1.0.0 (2026-10-02): initial freeze with schema, positive/negative vectors, and the wire consumer
  test (`crates/provider-host/tests/catalog_sync_wire_v01.rs`).

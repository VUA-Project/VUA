# Unified library view v0.3

> Document version: 0.4.0
> Status: Candidate
> Updated: 2026-11-14
> Owner: AMF

This `library.list` face adds an order and a filter on VN3 items to the local library projection.
[Library view v0.1](library-view-v0.1.md) and [v0.2](library-view-v0.2.md) stay readable with their
closed shapes. The desktop library sends this face; Recipe import and line terms keep the use presets
of [terms v0.1](terms-v0.1.md).

## Request

The query uses `schemaVersion: "0.3"` with the source, storage, text, availability, category,
reverse-description-link, offset and limit fields of v0.1. The purpose fields of v0.2 are rejected.

| Field | Values | Omitted |
| --- | --- | --- |
| `sort` | `added_desc`, `added_asc`, `title_asc`, `title_desc`, `shop_asc`, `price_asc`, `price_desc`, `published_desc`, `size_desc`, `size_asc` | The order of v0.1 |
| `format` | `vrm_or_glb`, `unitypackage` | Every row, regardless of observed file extensions |
| `vn3` | Object with optional `state`, `items` and `includeContact` | No terms read, no annotation |

`vn3.state` is `readable`, `no_vn3`, `unread` or `unreadable`. `vn3.items` lists distinct letters from
A to W; X is the creator's free text and has no value to compare. An empty `vn3` object annotates and
counts without filtering, for a filter panel that is open.

## Order

Ordering happens after every filter and before pagination.

- **Added:** when the row joined the library, as far as known; `null` when unknown. See below.
- **Title:** the name the card shows, case-insensitive, with digit runs compared by value.
- **Shop and price:** the product's recorded values, or a local row's source hint. A row without the
  value goes last in either direction.
- **Published:** BOOTH's publish date where a product page recorded one; rows without it go last.
- **Size:** bytes of the row's copies present on disk.

Ties go to the higher BOOTH number, then the title.

## Recently added

BOOTH's library pages carry no dates, so `addedAt` is the best time known for each row:

- A product with an order in [catalog orders v0.1](catalog-orders-v0.1.md) has that order's time, also given as
  `purchasedAt`. Other rows have `purchasedAt: null` or omit it.
- Gifts and free downloads have no time of their own. What the first sync found has `addedAt: null`, because it could
  have arrived at any point before that sync. What a later sync finds has its first sighting. Products first seen within
  two minutes of each other count as one sync, and later ones sort at that sync's last moment.
- A local copy older than the product's first sighting keeps its own time, and a local entry has its creation time.

`added_desc` and `added_asc` order by this time, and rows with no time go last in both. Within one time, higher BOOTH
numbers come first in `added_desc` and last in `added_asc`.

## VN3 filter

Each row carries `vn3: {state, match, hasSpecialNote}` while `vn3` is requested:

| State | Terms state of [terms v0.1](terms-v0.1.md) |
| --- | --- |
| `readable` | `parsed`, `partial` |
| `no_vn3` | `no_vn3`, and rows without a confirmed BOOTH identity |
| `unread` | `not_observed`, `pending` |
| `unreadable` | `link_only`, `unrecognized`, `unsupported`, `not_public`, `failed` |

With `items`, a row matches when every listed item is `permitted`, or `contact_licensor` with
`includeContact`. `match` is `allowed`, `conditional` when a matching item has a condition, or
`contact`; it is null for a row that does not match or when no items were requested. Matching needs
complete evidence, as the use checker does: `partial` documents and an unclear special note never match.
A name or filename suggestion gives a local row no terms. Special notes are reported, since they come
before every item; the original text governs.

The filter applies before facets, totals and pagination. The response adds `vn3Counts` with the rows in
each state and, per item, the rows that would match on that item alone. Counts follow the other filters,
including category, and ignore the VN3 filter itself. Reads use stored evidence and start no network
requests; **Read terms** stays an explicit command.

## Row facts

Every row adds `addedAt`, `publishedAt` and `sizeBytes` as described above, so the interface shows the
fact it sorted by. Each row may also carry `formats`, an ordered distinct array of observed package
format tags (`unitypackage`, `vrm`, `glb`, `gltf`) derived strictly from in-memory downloadable and
copy file names without touching disk archives. `format: "vrm_or_glb"` retains rows carrying `vrm`,
`glb`, or `gltf`; `format: "unitypackage"` retains rows carrying `unitypackage`. The
[schemas and vectors](../../schemas/library-view/v0.3) are consumed by the TypeScript guards and the
native library wire test.

## Older providers

An AMF provider without this face rejects it as invalid parameters. The desktop then reads v0.1 in the
provider's order and hides the VN3 filter's counts, so the library stays usable until AMF updates.

## Changelog

- 0.4.0 (2026-11-14): add optional in-memory `formats` (`unitypackage`, `vrm`, `glb`, `gltf`) on rows
  and `format` (`vrm_or_glb`, `unitypackage`) query filtering without disk archive reads.
- 0.3.0 (2026-11-06): add ordering and the VN3 item filter; the desktop library retires the purpose
  filter of v0.2.

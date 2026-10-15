# BDL v1 functional boundary

> Status: Research record — historical boundary study (product-owner ruling recorded 2026-09-04); input to the N5 capability audit, no current normative effect
> Scope: BDL v1 spike schema and pipeline design input (historical)
> Updated: 2026-10-02
> Module ownership: current BDL architecture lives in `docs/architecture/bdl.md`;
> the frozen production schema is `schemas/bdl/v0.2`

## Why this boundary exists

The legacy cloud BDB stalled because its vision outgrew its pipeline: the
schema was revised and bloated repeatedly, the process demanded a two-layer
pipeline covering enormous corner-case space, and data cleaning was still
unfinished when the rest of the product had first drafts. BDL v1 therefore
fixes an explicit boundary first, derives schema fields only from that
boundary plus real corpus formats, and builds SQLite infrastructure last.

## IN — capabilities and their corpus evidence

| # | Capability | Corpus evidence |
| --- | --- | --- |
| 1 | Normalized product / subproduct / shop observation storage | 135,973 record-v2 observations (135,829 complete / 144 tombstones), extraction spec from real HTML (Meiyun/Nemesis anchors) |
| 2 | Terms observations: VN3 and ordinary ToS links in the body, provenance kept, human-extracted, filterable | `active_terms` present on 99% of L2 items |
| 3 | Declared compatibility lines (body / subproduct names), human-confirmed, filterable | present on 40%; coverage "passed" only 7.6% — automatic coverage was the old failure mode |
| 4 | Downloaded artifact → source product mapping | anchors on `material_identity` |
| 5 | Search and filter over the above | a1-smoke normalized shape (100 records, 30 always-present fields) |

## OUT — with an explicit future home

- **Automatic alias/entity resolution** (one avatar, many names) and
  **compatibility matrix construction** (many avatars, same garment
  compatibility) stay part of the overall VUA product but move to two
  periodically-updated online tables. BDL v1 does not derive them
  automatically from irregular page structures.
- **Automatic VN3 extraction from Google Docs/Drive** — pending a review of
  Google's automated-access policy; candidate direction afterwards is batch
  link processing through an LLM. v1 keeps human extraction only, recording
  `source_url` and a nullable content hash.
- **Public API, frontend service, distributed crawling, autonomous
  crawling.** BOOTH fetch pace, inherited from the legacy crawler: 6 seconds
  per request, and only for explicitly approved re-verification tasks.
- **Dead fields**, rejected by the corpus: `etag` and `last_modified`
  (100% null across 135,973 records), `source_updated_at` (no stable BOOTH
  source — standing decision).

## Schema admission rule

A column enters the schema only if it answers "which IN row and which
filter/mapping query needs it?", and its evidence is either the extraction
spec plus real corpus fields or an IN-row query requirement. Proposed schema
(historical spike): `schemas/bdl-spike/v0.1/schema.sql`. The current frozen
production schema is `schemas/bdl/v0.2` (frozen 2026-09-22); its header
records that this admission rule carries over from this boundary study.

## Validation

The schema was exercised against the local corpus: 100 normalized a1-smoke
records (tagged `legacy.a1-smoke-20260831` — shape validation only, not
trusted facts) plus the two golden anchors as trusted record-v2 rows with
clearly synthetic term/compat/artifact rows. All five boundary queries pass:
category+search filter, VN3-term filter, human-confirmed compatibility
filter, artifact→product lookup, and per-product provenance trace.

Identity note discovered by the load: the corpus `product_id` is a
namespaced identity (`booth:<native_product_id>`); child tables must key on
the same namespaced value.

## Open items

- Google Docs/Drive automated-access policy review (feeds IN-2 design).
  Initial review 2026-09-04: no explicit prohibition on programmatically
  downloading publicly shared files — Google publishes official download
  methods (`webContentLink`, Drive API) and public files need no
  authentication; the Drive API ToS restricts specific use cases (e.g.
  backup services) without written consent; general abuse and throttling
  policies still apply. Conclusion: the v1 human-extraction posture is
  unchanged; a low-volume automated fetch of linked license documents looks
  viable pending a full ToS read. Sending fetched license text to an
  external LLM is a separate data-flow decision to make consciously.
- `source_published_at` is admitted by ruling with a confirmed rendered-page
  location; values remain null until a rendered fetch capability exists.
- Extraction spec formalization: completed 2026-09-04 as
  [`booth-product-extraction.md`](booth-product-extraction.md) (spec content
  0.2); a from-zero recognition pipeline was exercised against the two golden
  anchors and synthetic fixtures the same day. Under the N5 audit-first
  ruling, whether that pipeline is retained, completed, or replaced is
  decided by the capability audit, not by this document.

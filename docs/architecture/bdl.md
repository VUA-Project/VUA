# BDL architecture boundary


> Document version: 1.2.5
> Status: Accepted
> Scope: AMF-owned BDL module
> Updated: 2026-10-01
> Last conformance review: 2026-10-01 (source/layout review, not runtime acceptance)
> Normative effect: Yes

## Ownership

BDL (Booth Database Local) is an internal local AMF module. AMF application services are its sole
access path for the Renderer, other Orchestrator use cases, environment deployment, project
management, overlays, and plugins. Its internal model is designed from current AMF needs and real
vertical slices.

## Responsibilities

**Base responsibilities, retained unconditionally (user ruling, 2026-09-22):**

- Local products, subproducts, creators, files, terms, aliases, compatibility relations, and
  provenance records.
- Asset identity, and the local mapping (source correlation) between downloaded files, Warehouse
  assets, and source products.
- Local search, filtering, deduplication, and catalog capabilities for AMF.
- Provenance for VN3 and ordinary terms-of-service observations and filters.
- Storage of source observations and download-result metadata already validated by AMF.

**Experimental automatic compatibility forensics (off by default, user ruling 2026-09-22):**

- Automatic compatibility-evidence collection is experimental and off by default; when enabled it
  tries to collect evidence from the user's actual BOOTH browsing and Unity usage. It does not
  revive the abandoned whole-site cloud-collection direction.
- Turning automatic collection off never disables base storage, ordinary import, or Recipe source
  supplementation.

Electron Main owns browser/session isolation and download transport. AMF acquisition owns intent,
tasks, source correlation, inspection and Warehouse mapping; its UI consumes those services. BDL
stores the normalized metadata AMF decides to persist. N5 audits which paths are actually usable.

## Evidence semantics and human correction (user ruling, 2026-09-22)

- **No evidence means unknown:** when compatibility, dependency, or provenance lacks evidence, the
  state is unknown and must not be treated as resolved, compatible, or verified.
- **Human correction: direction retained, not yet frozen.** The product direction of local evidence
  viewing and correction is retained, but the concrete UI, editable scope, and permissions still
  need definition. This section grants no arbitrary-database-edit authority, and implementations
  must not silently widen the editable surface.
- **Degradation path undecided:** how dependency completion is accomplished when automatic forensics
  is off or resolution fails still needs a concrete flow (see the to-be-verified list in the
  [product boundary](../product-boundary.md)).
- This section does not change the existing persistence format or query contracts — the frozen
  faces of `schemas/bdl/` and `schemas/bdl-queries/` do not automatically move because of it.

## Layering

```text
AMF acquisition / content-management service
  ├─ native browser and authorized downloads
  ├─ BLM / VAE adapters
  └─ source validation and mapping decisions
          ↓ validated observations and result metadata
BDL application service
  ├─ normalization
  ├─ local identity and mapping
  ├─ search and filters
  └─ terms / compatibility evidence
          ↓
BDL-owned local database boundary
```

Remote DOM, page scripts, filenames, and third-party records are observations rather than canonical
entities. Identity, deduplication, and compatibility models follow a real page-and-file vertical
slice.

## Acquisition boundary

- Electron's isolated Session holds login, cookies, orders, and download tokens. AMF receives the
  normalized events, observations, and result metadata needed for the use case; BDL receives the
  approved persistent metadata subset.
- AMF owns task source, destination, progress, recovery, and validation.
- Downloads enter AMF as untrusted `LocalArtifact` values and require inspection before use.
- After inspection, AMF may submit source identity, file identity, check summary, and Warehouse
  mapping to BDL.
- BDL returns catalog, terms, and compatibility results; Electron and AMF retain session and download
  controls.

## Observation write face

The storage-side `record_product_observation` operation in `crates/bdl-store` writes
observed product facts. Its presence does not establish a working account-library acquisition
pipeline; N5 must trace and exercise that caller path. The existing write-face semantics are:

- **Upsert** (2026-10-03 semantics revision, real-machine): one observation merges by
  informativeness (`INSERT … ON CONFLICT DO UPDATE`); replaying the same observation is safe
  (same-content merge, never a second row). Scalar facts overwrite only when the new
  observation carries a value — NULL means "not observed by this source" and never erases a
  known fact (a library-row re-sync no longer wipes product-page enrichment). Serialized
  evidence lists (images/videos/subproducts) keep the longer list — a coarse library
  thumbnail never replaces a full gallery, and an empty list never beats a non-empty one.
  Status, content hash, timestamps, processor version and the gap list always reflect the
  latest observation. The API offers no delete — a row changes only through a newer
  observation; tombstones (`status: missing`, the 404/410 keepsakes) are legal observation
  results, are never physically deleted, and are never served as catalog cards.
- **Bookkeeping counter**: every successful write increments
  `bdl_meta.catalog_updated_seq` in the same transaction (first write initializes it to 1).
  `catalog.status` health turns from `unknown` to `ok` accordingly, and the counter travels
  the wire as `revision.catalogUpdatedSeq` (carried by the frozen bdl-queries faces, currently
  v0.4/v0.5).
- **Write-face closed sets** (violations are rejected with `InvalidObservation`): identity =
  `booth:<native digits>` with both parts agreeing; `content_hash = sha256:<64 hex>`;
  `observed_at` and `processor_version` are required evidence; price amount/currency are
  admitted as a pair (main product and subproducts alike); `adult` is true only with the
  explicit BOOTH Adult badge.
- **Read-face consumption**: the catalog assembly now consumes the observed columns —
  `title`/`price`/`imageUrl` (always `imageUrls[0]`) and the availability dual field
  (`availabilityRaw` rides along verbatim; `availabilityStatus` is derived at read time per
  the versioned rule table — introduced with bdl-queries v0.2 and carried by the current
  v0.4/v0.5 faces — never stored) reach cards and details; the `catalog.list`
  text filter = title + productId substring (the protocol surface unchanged). The honest
  empty-state semantics before any observation lands are unchanged.
- **Scope statement**: this write face serves the products table only.
  `term_observations` and `compatibility_observations` have no catalog consumer yet and
  stay with their own BDL v2 vocabulary slices; entity/relation storage (the
  `entityCount`/`entityTypes` honest empty slots) and freshness (`stale`) remain with BDL v2
  and future observation integration, outside this face.

## External tool data

The native AMF browser and content manager are the complete path. Tools such as BLM and VAE
coexist as optional AMF adapters:

- Prefer public, stable, clearly authorized APIs or import/export formats;
- third-party login sessions and private credentials stay inside their original owner's boundary;
- third-party private database schemas stay inside the adapter;
- the native path completes the core flows on its own;
- each adapter publishes an honest capability snapshot;
- adapter data enters BDL only after AMF validation.

## Implementation status (source check 2026-09-28)

`crates/bdl-store/src/bdl_store.rs` declares persistent format `0.2` and includes the
`v0.1` baseline and `v0.2` migration. Query and command faces are independently versioned;
use the [protocol guide](../protocols/README.md) and actual operation consumers.

Historical M4 closure is withdrawn as evidence of complete material management. Existing store,
observation, catalog and Warehouse code is input to N5's capability audit, not proof of a usable
account library or material-management workflow. Audit both authorized BOOTH account catalog /
selective download and cloud-material import before deciding what to retain, complete or redo.
Base storage and source-correlation responsibilities remain; automatic evidence collection is
experimental and off by default. No runtime acceptance is asserted by this source check.

## Document changelog

- 1.2.5 (2026-10-01): point the wire-semantics citations at the current frozen bdl-queries
  v0.4/v0.5 faces instead of the superseded v0.2/v0.3 and refresh header dates; no behavior change.
- 1.2.4 (2026-09-30): use English for explanatory prose.
- 1.2.3 (2026-09-28): correct storage version and replace old M4 completion claims with N5 audit scope.
- 1.2.2 (2026-09-28): remove obsolete mirror metadata and clarify current ownership where needed during the N documentation audit.
- 1.2.1 (2026-09-23): structure aligned with the authoritative ZH edition — the acquisition/BDL
  ownership paragraph moved back to the end of "Responsibilities"; the layering diagram regained
  its own "Layering" section; the condensed adapter paragraph unfolded into a full "External tool
  data" section mirroring the ZH six-bullet list. The authoritative ZH text is unchanged.
- 1.2.0 (2026-09-22): user ruling of 2026-09-22 landed — "Responsibilities" split into base
  storage/asset identity/source correlation/catalog capabilities retained unconditionally, and
  experimental automatic compatibility forensics off by default; new "Evidence semantics and human
  correction" section (no evidence = unknown, correction direction retained but not frozen,
  degradation path undecided); the merge does not change the frozen faces of `schemas/bdl/` and
  `schemas/bdl-queries/`. Mirrors the ZH edition.
- 1.1.0 (2026-09-08): added the "Observation write face" section (W17: upsert + bookkeeping
  counter + write-face closed sets + read-face consumption of the observed columns + scope
  statement); landing status re-reviewed with the corrected implementation location
  (`crates/bdl-store`).
- 1.0.0 (2026-09-06): entered version management; the "pending" closing section rewritten as the
  landing status (`schemas/bdl/v0.1` and the bdl-queries query contract v0.3 landed with B4); the
  header status updated to accepted to match reality.

- 1.3.0 (2026-10-03): observation write face merges by informativeness — NULL preserves known
  facts, longer evidence lists win; library re-syncs no longer erase product-page enrichment.

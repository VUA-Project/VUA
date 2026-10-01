# N5 capability audit — material management

> Document version: 1.0.0
> Status: Draft
> Scope: Mandatory N5 pre-rework audit of BDL, acquisition, warehouse, and BOOTH-facing code
> Updated: 2026-10-02
> Normative effect: Records observed state and feeds retain/complete/replace decisions; not feature acceptance

## Baseline and limits

Audited revision `09706b0b` (equal to `origin/main` at audit time) in a separate worktree on
`slice/n5-capability-audit`. Method: static trace of UI → Gateway port → Electron Main router →
provider dispatch → use case → store, with file:line citations; absence claims verified by
repository-wide caller search; test baselines rerun locally in the worktree.

**Not exercised by this audit:** no real BOOTH account session, no real download, no real Unity
production run, and no UI human review. Every runtime claim below comes from synthetic tests.
Real-account acceptance rows remain `not_run`. Per the N sequence, unknown means unverified, and
present code is not verified capability.

Test baseline (this worktree, 2026-10-02): `pnpm -r test` — 958/958 passed, 103 files;
`cargo test --workspace` (rustc 1.97.1) — 994 passed / 0 failed across 112 suites (28 ignored), exit 0. No tracked local run
evidence exists for material-management flows; the only prior local baselines are uncommitted
notes outside this audit's scope.

Environment observation (evidence reproducibility): a fresh checkout outside the original
working copy builds with the default `stable` toolchain; the repository pins 1.97.1 only in the
CI workflows and via the original checkout's local rustup override. Building with an older
stable fails inside `rusqlite` 0.40.1 (`cfg_select` is unstable there). Fixing the pin mechanism
(a `rust-toolchain.toml` or equivalent) is a separate small slice, not part of N5 rework.

## A. Local intake and warehouse maintenance

| # | User action | Code entry | Reachable | Verified behavior | Missing behavior | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Import material from local folders | `ImportPage` → `warehouseCommands.importFolders` → `warehouse.import` → `crates/provider-host/src/provider_host.rs:5778` → `crates/acquisition/src/warehouse_import.rs:471` | Yes, UI to store | Batch copy-in import with per-folder progress, size verification, SHA-256 content keys; task-facing. Tests: `crates/acquisition/tests/import_contract_v03.rs`, wire loop in `crates/provider-host/tests/warehouse_commands.rs` | Dispatch always passes `auto_generate: None` (`provider_host.rs:5814`), so import→auto-VPM is unreachable in production; duplicate/unsupported/failed intake distinctions unverified against a real mixed collection | Retain |
| A2 | Adopt completed downloads as warehouse entries | `ImportPage` completed panel (raw `downloads.listCompleted` invoke) → `warehouse.importDownloads` → `provider_host.rs:8391` → `crates/acquisition/src/warehouse_download_adopt.rs:423` | Yes | Resolves staging state from the BDL event fold, copies in as `downloaded_material`, fail-fast. Tests: `import_downloads_contract_v04.rs` | No duplicate-decision surface when the same content was already imported | Retain |
| A3 | Staging-boundary artifact inspection | `crates/acquisition/src/artifact_inspection.rs:195/:296` (`ArtifactInspector`) | No — only its own unit tests call it | Manifest-token identity, root containment, size/extension policy, SHA-256; idempotent per content | No production call site; the adoption path re-implements mechanical checks inline instead of routing through the inspector | Complete: wire one inspection gate or fold explicitly during rework; do not rewrite |
| A4 | Set artifact mode / global default mode | `WarehouseAcquire` / Settings→Experimental → `warehouse.setArtifactMode` / `setGlobalDefaultMode` → `provider_host.rs:2182/:2254` → `crates/bdl-store/src/bdl_store.rs:1406/:1448` | Yes | Synchronous writes with read-back. Tests: `bdl_commands_contract.rs`, `crates/bdl-store/tests/global_default_v02.rs` | — | Retain |
| A5 | Generate VPM from an entry | `WarehouseAcquire` → `warehouse.generateVpm` → `provider_host.rs:2287` → `crates/acquisition/src/warehouse_maintenance.rs:604` | Yes | Guarded staging/publish producing a `generated_vpm` copy. Tests: `bdl_commands_contract.rs` | — | Retain |
| A6 | Delete originals after VPM generation | Auto chain only (`apps/desktop/src/renderer/app/delete-originals-auto.ts`, mounted in `App.tsx`) → `warehouse.deleteOriginals` → `provider_host.rs:2287` → `warehouse_maintenance.rs:324` | Yes (auto chain; manual UI entry deliberately removed by user ruling) | Three-guard destructive deletion. Tests: `bdl_commands_contract.rs` | — | Retain (ruling preserved) |

## B. Catalog and warehouse read faces

| # | User action | Code entry | Reachable | Verified behavior | Missing behavior | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Browse/search the BOOTH catalog | `WarehousePage` → `catalogBrowser.list` → `apps/desktop/src/electron/gateway-router.ts:192` → `provider_host.rs:1270` → `crates/bdl-store/src/bdl_queries.rs` `catalog_list` | Yes, UI to store | Text + availability filtering (title/productId substring), honest empty state. Tests: `crates/bdl-store/tests/catalog_serving.rs` (v0.5 vectors), `crates/provider-host/tests/catalog_queries.rs` | **No production writer for the `products` table** (see E1): in production the catalog stays empty until an acquisition producer exists | Retain read face; producer is E1 |
| B2 | View catalog detail / status | `catalog.detail` / `catalog.status` → same chain | Yes (status only via capability probe, no user surface) | Detail assembly with availability derivation. Tests: `catalog_serving.rs` | `sourceUrl` hard-coded null in the live projection (`catalog-browser-live.ts:231`); entityType/relation filters are retired slots never sent (`catalog-browser-live.ts:182-187`); in-app browse window hard-disabled | Retain; complete source link with the producer slice |
| B3 | List/search warehouse entries | `WarehouseAcquire` via acquire snapshot/subscribe → `warehouse.listEntries` → `provider_host.rs:2065` → `bdl_store.rs:1556` | Yes | Server-side entry cards with mutation-event refresh. Tests: `warehouse_commands.rs` | Entry text search is a client-side substring filter flagged in-code as fixture-scale (`acquire-model.ts:59`); local previews render honest empty thumbnails | Retain; move search into the port query later (non-blocking) |
| B4 | View entry detail (inspection facts, correlation) | `warehouse.entryDetail` → `provider_host.rs:2094` → `bdl_store.rs:1661` | Yes | Artifact facts, quarantine reasons, `mappedProductIds`, `source_correlated` flag | `artifact_mappings` has no production writer (`record_artifact_mapping`, `bdl_store.rs:1213`, test-only callers), so correlation fields are always empty in production | Retain; producer is E2 |
| B5 | Relink missing files | — | None | — | No code, no wire method | Complete (new) |

## C. Downloads and BOOTH session

| # | User action | Code entry | Reachable | Verified behavior | Missing behavior | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Browse BOOTH inside the app | `apps/desktop/src/electron/remote-content.ts` — isolated `persist:vua-remote` partition, origin allowlist `booth.pm`/`accounts.booth.pm`; sign-in hint cookie-existence probe (`remote-content.ts:205`, values never cross IPC) | Yes | Partition isolation, navigation/origin restriction; user logs in inside the view | No automated test of the embedded view itself; UI human review pending | Retain |
| C2 | Download from BOOTH and observe progress | `will-download` interception `apps/desktop/src/electron/download-port.ts:82` → normalized download-events v0.1 → `download.ingest` (`provider_host.rs:8476`) → BDL fold + nine-state task; renderer observes via task face; retry `download.retry` (`provider_host.rs:8698`) restarts through the partition session (`download-port.ts:233`) | Yes | Event vocabulary, task folding, retry policy, intent loop. Tests: `crates/provider-host/tests/download_host.rs`, `download-port.test.ts`, `download-ingest.test.ts` (all synthetic) | No real BOOTH download exercised in this audit; real-run acceptance stays `not_run` | Retain |
| C3 | Start a download as an explicit app command | — | None (by design) | — | Downloads originate only from user action inside the embedded page | Retain the design; no change |

## D. Dependency observations

| # | User action | Code entry | Reachable | Verified behavior | Missing behavior | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Look up dependency relations | `dependencies.lookup` / `listByProduct` → `gateway-router.ts:209-222` → `provider_host.rs:1273` → `crates/orchestrator/src/bdl_dependency_queries.rs:239/:284` → `bdl_store.rs` read faces | Code fully wired, **no UI consumer** (repository-wide search: only the port's own test) | v0.5 matching/advisory rules. Tests: `crates/orchestrator/tests/dependencies_queries_executor.rs`, `crates/provider-host/tests/dependencies_queries_wire_v05.rs` | No consumer page (port docblock: consumer waits for a final user ruling); **no production writer** — `record_dependency_observation` (`bdl_store.rs:1977`), `confirm_dependency_resolution` (`:2027`), and `crates/bdl-store/src/dependency_extract.rs:140/:206` have test-only callers | Retain storage and queries; complete ingestion and a consumer after the pending ruling |

## E. BOOTH account acquisition (N5 required workflows)

| # | User action | Code entry | Reachable | Verified behavior | Missing behavior | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | Account library → local catalog → selective download | Storage write face exists: `record_product_observation` (`crates/bdl-store/src/bdl_store.rs:1851`, upsert + tombstones + catalog counter) and `seed_product` (`:1817`); both test-only | None — **no enumeration code** | Write-face semantics verified by `crates/bdl-store/tests/product_observation.rs` | No `booth.pm` library/orders enumeration, no Rust HTTP client for booth.pm, no multi-page retrieval, no refresh/dedup loop, no partial-retrieval or expired-session reporting. The only authenticated surface is the Electron partition session (C1/C2) | Complete: new acquisition producer over the existing partition session, writing through the existing observation face; respect entitlement, authentication and age controls |
| E2 | Import cloud-available material into the Warehouse | Building blocks exist and are reachable: embedded browse (C1) → download (C2) → adopt (A2) → selection in recipe/compose via `WarehouseEntrySelector` | Partial (manual path only) | Each block individually tested (synthetic) | Systematic cloud-entry import: existing-local-copy recognition or duplicate decision, correlation to catalog records (B4 writer), missing-content acquisition link | Complete on the retained blocks |
| E3 | Warehouse selection reaches production | `WarehouseEntrySelector` over the acquire read face feeds recipe/compose | Yes (into compose; production execution is N3 scope) | Renderer tests over the selector model | Cross-gate production provenance is N3 acceptance, out of this audit's scope | Retain |

## F. Persistence and capability advertisement

| # | Item | Code entry | Reachable | Verified behavior | Missing behavior | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | BDL SQLite persistence | `crates/bdl-store/src/bdl_store.rs` (persistent format 0.2, v0.1→v0.2 migration) | Yes (via every BDL path) | Migration and query/command faces covered by the crate tests cited above | Restart/refresh preservation of an account-built catalog is untestable until E1 exists | Retain |
| F2 | Provider capability advertisement | `served_capabilities` (`provider_host.rs:1416/:1609-1661`) | Partial | — | No rows for `warehouse.*`, `catalog.*`, `downloads.*`, `download.*` (only `dependencies.queries` of this family); unwired faces signal via per-method typed errors instead | Complete (advertise the family) |

## N5 required library behaviors — coverage

| Required behavior | Status from rows above |
| --- | --- |
| Understand intake | Partial: success path verified (A1/A2); duplicate/unsupported/failed distinctions need re-verification with a real mixed collection |
| Find material | Partial: entry search client-side (B3); catalog search exists but catalog has no producer (B1/E1); similarly-named distinction unverified |
| Maintain files (show associated files, missing status, relink) | Partial: files shown in entry detail (B4); relink absent (B5) |
| Maintain provenance | Partial: correlation storage exists but has no producer (B4/E2); correction UI undecided per the BDL boundary |
| Manage versions | Partial: content-keyed artifacts distinguish same-name different-content at intake (A1); production-input version explicitness unverified |
| Manage relationships | Partial: storage and queries verified (D1) with no ingestion and no consumer |
| Remove/clean | Partial: guarded originals deletion (A6); removing a catalog record vs deleting files distinction has no code (rides E1) |
| Produce | Partial into compose (E3); full-chain acceptance is N3 scope |

## Decision summary

- **Retain** (production-wired and synthetically tested): the intake/adopt/maintenance task chain
  (A1, A2, A4-A6), the read faces (B1-B4), the download event pipeline with nine-state tasks and
  retry (C1-C2), dependency storage and queries (D1), and BDL persistence format 0.2 (F1).
- **Retain + complete**: artifact inspection gate (A3), catalog source links (B2), port-level
  entry search (B3), capability advertisement (F2).
- **Complete (new code)**: the BOOTH account-library producer (E1), systematic cloud import with
  duplicate decision (E2), file relink (B5), dependency ingestion + consumer after the pending
  ruling (D1).
- **Replace**: nothing. The audit found substantial working infrastructure; the user's initial
  assessment ("basic loading and SQLite creation only") understates what exists, while the N5
  acceptance gap is real and concentrated in the missing acquisition producers, not in storage,
  tasks, or UI plumbing.

First rework slices suggested by this audit: (1) E1 enumeration producer over the partition
session feeding `record_product_observation`, with multi-page dedup and honest partial/expired
reporting; (2) E2 import correlation and duplicate decision on top of A2; (3) A3 inspection-gate
wiring. Each keeps the existing contracts (bdl-queries v0.5, bdl-commands v0.4,
download-events v0.1) unless a slice's needs say otherwise.

## Document changelog

- 1.0.0 (2026-10-02): initial N5 capability audit at revision 09706b0b; capability table, coverage
  mapping, and retain/complete/replace decisions.

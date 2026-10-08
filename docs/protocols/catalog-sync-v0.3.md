# Catalog sync v0.3 — whole-run lifecycle

> Document version: 0.3
> Status: Implementation baseline — freeze after the accompanying schema and consumer checks pass
> Updated: 2026-10-07
> Maintainer: AMF
> Scope: Account-library sync registration, page receipts, finalization and persisted status

## Ownership and coexistence

Electron reads the user's account libraries inside its isolated session. Acquisition validates
page order, writes normalized observations through BDL and owns the whole-run decision over the
existing task journal. The provider host dispatches and publishes events. Credentials never cross
this face. [v0.1](catalog-sync-v0.1.md) and [v0.2](catalog-sync-v0.2.md) keep their frozen page-finality
behavior; product-page enrichment continues through v0.2. The desktop sync reader uses v0.3.

## Methods

Schemas and synthetic vectors: [schemas/catalog-sync/v0.3](../../schemas/catalog-sync/v0.3).

| Method | Kind | Behavior |
| --- | --- | --- |
| `catalog.beginLibrarySync` | command | Register one durable task before fetching, with a unique run ID and an ordered, nonempty selection of library types |
| `catalog.ingestLibraryPage` (`schemaVersion: "0.3"`) | command | Validate and ingest one page; update the checkpoint without completing the task |
| `catalog.finishLibrarySync` | command | Report the transport outcome; acquisition validates completion and chooses the terminal task state |
| `catalog.librarySyncStatus` | query | Return persisted counts, completed library types, cancellation, recovery and terminal state, including partial failure |

The library-type set is `bought | gifts | free_downloads`. A run starts at page 1 of the first
selected library and follows its observed continuation before advancing to the next type. Page
ordinals span the run and are limited to 50. The reader accepts only HTTPS continuations on
`accounts.booth.pm`, inside the selected library, with a numeric `page` query. Repeated URLs, an
unrecognized page, malformed receipt, HTTP/transport failure and the page limit are incomplete
outcomes. A recognized empty listing is a completed page; an unrecognized document is a failure.

## Checkpoints and results

Each accepted page records its type, ordinal, URL, body hash and normalized receipt in the task
journal. Raw HTML is not stored there. Repeating the same page identity and content returns its
original receipt without incrementing counts; conflicting replay or skipped order is rejected
before catalog writes. A lost response can be redelivered safely. Counts are observation totals,
not a claim that the same product appearing in multiple libraries is several unique products.

`completed` is accepted only after every selected type has a persisted final page. Rejected items
are accumulated across all pages and produce `succeeded_with_warnings`; they are never cleared by
a later clean page. A transport failure or page limit produces `failed` with partial counts;
cancelled work produces `cancelled`. Previously saved catalog entries remain. Successful task
results and the dedicated status query report the same terminal facts. The status query also
serves failed/cancelled counts without widening the frozen task-result reflux rule.

Cancellation stops the reader's current fetch or pacing interval and prevents later pages. A
task cancellation request wins a concurrent completion. Process restart preserves journal
checkpoints, reports `inspect_required` and rejects continuation/finalization of that old run.
It does not silently resume. Transport success without a persisted final receipt is not success;
the desktop presents the unconfirmed result and preserves the task's actual state.

## Evidence

The consuming wire tests are in `crates/provider-host/tests/catalog_sync_wire_v01.rs` (the `v03`
module); TypeScript guards consume the same vectors in `packages/contracts/src/catalog-sync-v03.test.ts`.
The reader tests use injected synthetic transport in `apps/desktop/src/electron/catalog-sync.test.ts`.
Real account, download and UI acceptance remain governed by N5 and are not established by these tests.

## Document changelog

- 0.3 (2026-10-07): add explicit whole-run registration/finalization and durable status; preserve old page faces.

# Library maintenance v0.1

> Document version: 0.2.0
> Status: Implementation baseline (not frozen)
> Owner: AMF
> Updated: 2026-10-09

The user's 2026-10-08 ruling permits removing selected VUA-managed files while retaining
catalog entries, copy evidence and Recipe/draft references. Changed originals retain generated
VPM copies as old versions; they do not qualify as the current generated output. Final Recipe
design remains undecided. This face coexists with the frozen, VPM-only `warehouse.deleteOriginals`.

## Methods

All requests have `schemaVersion: "0.1"`. A target is `{kind: "product" | "entry", id}`.

| Method | Kind | Request | Result |
| --- | --- | --- | --- |
| `library.removalPreview` | query | target, optional nonempty unique copyIds (at most 200) | target, previewHash, files, references, referenceCoverage, unresolvedRecipeAssets |
| `library.removeFiles` | command | removalId, target, copyIds, previewHash | removal snapshot |
| `library.removalStatus` | query | removalId | removal snapshot |
| `library.pendingRemovals` | query | target | schemaVersion, target, interrupted removal snapshots |
| `library.resolveRemoval` | command | removalId, observedRevision | inspected removal snapshot |

The [request/response schemas and synthetic vectors](../../schemas/library-maintenance/v0.1/)
and provider wire tests cover this baseline together with the TypeScript Gateway consumer.

Preview does not modify files. Omitted copyIds selects all target copies (at most 200).
Each file exposes copyId, entryId, fileName (relative), role, artifactSha256, sizeBytes,
presence (`present`, `missing`, `changed`, `unreadable`) and superseded. No absolute path
crosses the Gateway. Hash verification occurs immediately before removal; preview presence
is a metadata observation, not a production qualification.

Product selection follows the current visible library grouping, including managed ZIP members
and verified migrated local copies. Explicitly removed imports do not re-enter this selection.

References expose kind (`draft` or `recipe`), id, title, revision, copyIds and
missingAfterRemoval. Coverage is `drafts_and_recipes` when the production store is wired,
otherwise `drafts_only`; a failed store read rejects preview rather than claiming no references.
Only defined draft selections and Recipe v0.3 asset sourceRefs are examined. Recipe assets
using entity-only or unsupported provider references are counted in unresolvedRecipeAssets
and shown as potentially affected, never as proof that there are no references. Missing status
means no matching present copy would remain; it does not certify production usability.
Existing path aliases, including Windows path casing, are grouped by their canonical file path
when identifying affected references. Removing one copy can make references to an aliased copy
missing; another ledger row for the same physical file is not a remaining local copy.

## Durable operation and safety

Removal IDs start with `library-removal-` followed by 1–100 ASCII letters, digits, `_`, `.`,
`:`, or `-`. The command must match a freshly read preview of its exact selection. AMF
atomically binds the request and trusted private plan to normal durable task acceptance before
starting a worker. An exact replay returns the original task; changed input with the same ID
is a conflict. Downloads and removals touching the same product/copy or aliased file path
cannot run together. Current file bindings are checked as well as the persisted plan, including
plans saved before alias copy IDs were recorded.

The worker rechecks the ledger identity, regular-file shape, canonical containment in the
managed warehouse, expected size and SHA-256 immediately before unlinking. A changed,
unreadable, external or shared-with-different-content file is refused. Missing files are
already_missing. It removes file bytes only; entries, bindings, provenance and saved references
remain. A later managed download restores the same copy identity. Selected files are independent;
partial success is visible, and cancellation stops at the next file boundary.

Snapshots expose removalId, target, taskId, taskState, revision, cancelRequested,
recoveryDisposition, state and files. Per-file phase is `pending`, `removed`, `already_missing`
or `failed`, with nullable errorCode. Overall state is `running`, `succeeded`,
`succeeded_with_warnings`, `failed`, `cancelled` or `unconfirmed`. Runtime finality is authoritative.
Interrupted tasks require inspection and never restart deletion implicitly. A pending file
after a crash is unconfirmed even if bytes are now missing; absence alone does not prove removal.
An interrupted plan retains its conflict fence. Replaying the same request does not clear that
fence or restart its worker. The dialog first discovers interrupted plans for its target.

Explicit resolution requires the observed task revision, copy-write exclusion and a recovered
SQLite runtime with no live worker. It rechecks pending copy bindings and metadata presence.
`kept` means the file remains; this is not hash/production qualification. `missing_after_inspection`
means absence without proof of deletion. Changed/unreadable/rebound copies carry failure reasons.
Existing per-file deletion receipts are retained. No unlink occurs during inspection.
One durable completion stores all inspected outcomes and cancels the old vanished worker, with
`inspectionResolved: true` and `recoveryDisposition: none`. Runtime cache/events and durable finality
advance together, releasing the conflict fence. Retrying a resolved operation returns its receipt.
After inspection, deletion requires a fresh selection/preview and a new removal ID.

Errors use `vua.library.*` and the existing AppError envelope. Invalid parameters, missing target,
preview drift, busy files, command conflict and storage failures remain distinct. Actual user
confirmation is performed in the library dialog after showing the selected files and references.
If a command receipt is lost, the dialog retains the original selection, preview hash and
removalId. Its explicit retry resends that same request, so acceptance is recovered without
starting another deletion. A failed status read does not claim that deletion itself failed.

Synthetic tests do not establish real-material or human UI acceptance under N5.
The [Chromium interaction check](../../apps/desktop/scripts/smoke-library-maintenance.mjs) runs
against a synthetic Gateway in a hidden window with an isolated temporary profile. It exercises
selection and confirmation, reference-read failure, stale preview feedback, same-request receipt
recovery, observed cancellation, interrupted-task inspection and keyboard focus restoration.
The updated interaction check passed 26 synthetic assertions, including discovery after restart,
explicit resolution, retained files, missing-versus-removed wording and fresh selection. Provider
wire tests cover durable inspection, receipt replay and download admission after fence release.

This slice identifies and preserves superseded VPMs. A new regeneration path and package-version
allocation remain follow-up work: the legacy generator refuses any existing generated copy
and currently emits version 0.1.0. It must not be reused to overwrite a retained version.

## Document changelog

- 0.2.0 (2026-10-09): add explicit interrupted-removal discovery/resolution without resumed deletion and align product deletion with ZIP/verified-local card scopes.

- 0.1.0 (2026-10-08): define selected-file removal with retained identities/references and durable finality.

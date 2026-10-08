# Unified library view v0.1

> Document version: 0.4
> Status: Implementation baseline
> Updated: 2026-10-09
> Maintainer: AMF

This acquisition read face joins account products, source memberships, current physical copies
and the latest managed download attempt. BDL provides private evidence; acquisition computes
the view. Renderer code validates the response and renders its facts. It does not infer storage
success from native completion, historical source mappings or a global download list.

Schemas and synthetic vectors: [library-view/v0.1](../../schemas/library-view/v0.1).
It coexists with the frozen catalog and warehouse queries, whose behavior is unchanged.

The baseline includes `supersededGeneratedCopies` (retained old output records) and
`currentGeneratedCopies` (present generated files not marked superseded). These independent
counts do not claim production qualification. Generated copies are grouped with their entry's
originals without inventing product provenance observations. The library shows retained old
output and the need to regenerate when no current generated copy is present.

## Methods and identity

| Method | Kind | Result |
| --- | --- | --- |
| `library.list` | query | Filtered, paginated product and independently retained local-entry rows |
| `library.productFiles` | query | Captured selectable file IDs, current managed binding and eligible legacy replacement candidates |

Both requests require `schemaVersion: "0.1"` and reject unknown fields. A list has optional
`source`, `state`, `text`, `availabilityStatus`, `limit` and `offset`. Defaults are all sources,
all states, empty text, no availability filter, limit 50 and offset zero. Limits are 1–200;
offset is a nonnegative safe integer. Text is at most 1000 Unicode characters. Filtered `total`
counts library rows before pagination: one product or one local warehouse entry. An entry can
contain multiple files. Product file inventory requires a `booth:` numeric product identity.

Source filters are `all`, `local`, `bought`, `gifts` and `free_downloads`. Local means a
registered physical copy, including missing files and copies associated with an account product.
An item can belong to several account libraries. Migration backfills only the last membership
actually known by the earlier catalog; missing historical memberships are not invented.
Text searches product/entry identity and title, shop/variant names, local folder names and
relative filenames. Matching a filename selects its entry, including its unassociated files.
Availability and account-source filters also include local rows with a matching source hint;
the hint remains visibly unconfirmed when based on a name or ID.

Inspected managed deliveries appear under their account product. An imported file's source mapping
alone does not combine its card with that product. Known official original-file fingerprints and
verified equal local bytes allow that grouping; different or unverified content remains independent,
even with the same title/image. A mixed folder retains unmatched files in a local row. Generated
copies can follow originals only when all originals match the same product. No file/copy/entry or
saved reference is deleted to combine presentation. Old source mappings remain historical evidence.

Local rows may carry `sourceMatch` with product metadata, account memberships, `basis` (`mapping`,
`product_id` or `name`) and `content` (`unverified` or `different`). An unambiguous ID/name is only
a source suggestion, never a persisted user confirmation. `different` means at least one retained
original fingerprint differs from the known downloaded references, not that it cannot be another
official file or version. Ambiguous hints are omitted. Without official reference bytes, keep the
account and local cards separate; sync does not download account files to manufacture references.

Rows may include unique `copyIds`, whose length equals `storage.storedCopies`. The current provider
returns these for each displayed subset, and the delete-files UI uses that scope. A product target
must not silently expand its selection to a different local card through a historical mapping.
These optional fields extend this unfrozen baseline; frozen catalog/warehouse behavior is unchanged.

## Independent facts

Optional `storage.unexpandedArchives` counts registered ZIP copies without a confirmed current
expansion. It is independent of physical presence and is included in the attention filter. Local
intake and BOOTH downloads persist expansion results through [library intake v0.1](library-intake-v0.1.md).
Current account archive/member lineage establishes member reference fingerprints for migration
reconciliation; stale parent content cannot supply current references. ZIP expansion grants no
production qualification.

`storage` carries `storedCopies`, `presentCopies`, `missingCopies`, `changedCopies` and
`unreadableCopies`; the four presence counts sum to the registered count. Its state is derived
in this order: zero registered → `cloud_only`; any unreadable → `unreadable`; any changed →
`changed`; all present → `present`; none present → `missing`; otherwise `partial`.

Presence checks regular-file metadata, containment in the managed root and recorded byte length.
They are intentionally inexpensive. `changed` detects a size difference; an edit that keeps
the same size is not detected by metadata alone. Matched candidates additionally use background
verification proofs tied to copy ID, content identity, location and length/write/creation metadata.
Changed metadata invalidates the proof; a fresh failed hash reports `changed`. Presence never claims
valid archive or production admission. `productionQualification` is `not_evaluated`; production
must inspect the selected format/source and verify its content at its own boundary.
An explicitly deleted, previously verified copy retains its content grouping with a missing-file
fact. Reappearing bytes must satisfy the proof/metadata check again; missing bytes never count as present.

Successful or partial-success sync finalization and acquisition completion can submit the acquisition continuation identified
internally as `library.reconcileSources`. It is not a new Gateway method. The existing task channel
publishes accepted/state/progress/completed events and supports cancellation between read chunks.
Progress includes `operation`, `checked`, `matched` and `total`; completed per-copy proofs are
journaled without absolute paths. Listing queries neither hash large files nor start jobs. Restart
reuses still-valid proofs and exposes interrupted tasks for inspection without implicit continuation.
Replayed finalization reuses the same verification task. Account-list completion is distinct from
completion of this content check.

`operation` is a separate managed-download snapshot. The latest active batch takes precedence;
otherwise the latest attempt is shown. A failed re-download can coexist with present old bytes.
Filters `downloaded`, `cloud_only`, `missing`, `in_progress` and `attention` respectively use
present-copy count, registered-copy count, missing-copy count, active operation and storage/error
or inspect-required facts. A cancelled operation alone is not a storage error.

File inventory returns IDs, relative filenames, hashes and presence facts, never absolute paths.
A managed binding identifies the sole replacement target. Several legacy candidates require
explicit selection under the [replacement ruling](../decisions/library-download-replacement.md).
Query failure is distinct from an empty inventory; unavailable services are not reported as
having zero files.

## Storage and evidence

Local rows may carry `metadata` from [entry metadata v0.1](library-entry-metadata-v0.1.md).
Explicit sources constrain content merging but never establish official fingerprints. Product rows
may carry `localEntries` with the IDs/names of merged imported entries, so their individual metadata
remains editable. Public product lookup alone creates no cloud-only account row: membership or
associated physical copies are required.

[BDL v0.5 migration 006](../../schemas/bdl/v0.5/006_managed_library_files.sql) owns normalized
membership/binding evidence. The acquisition service owns the aggregate and filesystem checks.
The TypeScript guards additionally check cross-field counts, state derivation, operation product
identity, unique file/copy IDs and managed-target membership.

Synthetic tests cover historical versus physical counts, failed replacement preserving presence,
missing/size-changed files, several source memberships, filtering/pagination, separate source hints,
verified equal content, differing and partial folder matches, same-size drift, cancellation,
idempotency and restart proof reuse. Real-account, real-material and human UI acceptance
remain `not_run` for this takeover baseline and are owned by N5.

## Document changelog

- 0.4 (2026-10-09): expose optional local metadata and merged local origins, constrain source-corrected grouping and keep public lookup separate from account ownership.

- 0.3 (2026-10-09): include managed ZIP member references and optional unresolved-expansion counts, independently of file presence and production qualification.

- 0.2 (2026-10-08): extend the unfrozen baseline with independent source/content cards, per-card file scopes and background content-verification proofs.
- 0.1 (2026-10-08): define the joined library read face with independent storage, operation and production-qualification facts.

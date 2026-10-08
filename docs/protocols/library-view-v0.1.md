# Unified library view v0.1

> Document version: 0.1
> Status: Implementation baseline
> Updated: 2026-10-08
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
| `library.list` | query | Filtered, paginated product and unassociated local-entry rows |
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
Availability filters apply to products only.

Associated physical copies appear under the product. Unassociated files remain in a local row;
for mixed entries only the unassociated subset is shown there. The same association does not
produce a second independent local card. Source mappings of replaced content remain historical
evidence and do not increase the current physical-copy count.

## Independent facts

`storage` carries `storedCopies`, `presentCopies`, `missingCopies`, `changedCopies` and
`unreadableCopies`; the four presence counts sum to the registered count. Its state is derived
in this order: zero registered → `cloud_only`; any unreadable → `unreadable`; any changed →
`changed`; all present → `present`; none present → `missing`; otherwise `partial`.

Presence checks regular-file metadata, containment in the managed root and recorded byte length.
They are intentionally inexpensive. `changed` detects a size difference; an edit that keeps
the same size is not detected by this list query. Presence never claims a fresh content hash,
valid archive or production admission. `productionQualification` is `not_evaluated`; production
must inspect the selected format/source and verify its content at its own boundary.

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

[BDL v0.5 migration 006](../../schemas/bdl/v0.5/006_managed_library_files.sql) owns normalized
membership/binding evidence. The acquisition service owns the aggregate and filesystem checks.
The TypeScript guards additionally check cross-field counts, state derivation, operation product
identity, unique file/copy IDs and managed-target membership.

Synthetic tests cover historical versus physical counts, failed replacement preserving presence,
missing/size-changed files, several source memberships, filtering/pagination and provenance
association removing duplicate local rows. Real-account, real-material and human UI acceptance
remain `not_run` for this takeover baseline and are owned by N5.

## Document changelog

- 0.1 (2026-10-08): define the joined library read face with independent storage, operation and production-qualification facts.

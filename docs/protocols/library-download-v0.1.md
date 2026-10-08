# Managed library download v0.1

> Document version: 0.1
> Status: Implementation baseline
> Updated: 2026-10-08
> Maintainer: AMF

This face implements the [user's replacement and retention rulings](../decisions/library-download-replacement.md).
It coexists with the frozen `download.ingest` event face and `warehouse.importDownloads` copy-in face.
Electron owns session transport and pacing; acquisition owns selected-file intent, verification,
replacement and batch outcomes. BDL remains a private evidence ledger. Credentials and paths never
appear in requests or the public snapshot.

## Contract

Schemas/vectors: [library-download/v0.1](../../schemas/library-download/v0.1).

| Method | Kind | Meaning |
| --- | --- | --- |
| `library.beginDownload` | command | Register a batch and every selected, captured downloadable before transport starts |
| `library.observeDownload` | command | Report a native kickoff failure/cancellation or identify a persisted delivery; acquisition re-reads its evidence |
| `library.downloadStatus` | query | Read per-file transfer, inspection and storage facts and the parent task state |

Batch IDs are `library-download-` plus 1–100 ASCII identifier characters. A batch selects 1–200
unique positive safe-integer file IDs belonging to its recorded product. Concurrent batches for
the same file are refused. A repeated identity with the same selection reuses its task; conflicts
are refused. Optional replacement targets select an exact legacy copy of a selected file.
Unselected, foreign or duplicate targets are rejected. Multiple legacy candidates require selection.

Started/settled observations carry a download ID, not a caller-declared success. Acquisition verifies
the exact original `https://booth.pm/downloadables/{id}` in persisted source/redirect evidence and
folds the actual lifecycle. Native completion before `download.ingest` acknowledgment cannot trigger
storage. Kickoff failures and unconfirmed receipts are explicit per-file outcomes, not silent hangs.

The native port may admit an HTTPS redirect outside the ordinary browser-download origin list
only when the native chain starts with the exact BOOTH downloadable currently awaiting binding
in an admitted batch. Every hop must be HTTPS without user information or fragments, and the
chain must end at the reported native URL. Binding consumes that pending admission. An explicit
native retry of that owned delivery requests the original BOOTH URL again and preserves the
download identity; it does not request a previously signed final URL directly. Cancelled, expired,
unselected and unrelated browser requests gain no redirect admission. The frozen event vocabulary
and ordinary browser-download policy remain unchanged.

The parent checkpoint is stored on the existing task journal before the first request. Once all
transports have settled, one idempotent worker verifies/stores successful deliveries independently;
one failed file does not skip the others. Worker progress folds back into the parent's checkpoint.
All stored with cleanup confirmed → `succeeded`; partial storage or cleanup warnings → `succeeded_with_warnings`; none stored
→ `failed` (all cancelled → `cancelled`). A requested cancellation wins parent finality, with stored
partial results retained in the dedicated snapshot. No timeout in a UI poll fabricates a task result.

## Storage and replacement

File phases are `queued`, `downloading`, `downloaded`, `inspecting`, `stored`, `failed`, `cancelled`
and `unconfirmed`. They are acquisition facts; they do not widen the nine task states. `stored`
means mechanically checked bytes have a persisted physical copy. Every format is retained within
the existing 8 GiB inspection bound. Format/source qualification for production is separate.

The inspector verifies the injected staging root, regular file, reported size and content digest.
A prepared copy is flushed and hashed before replacing a managed target. Existing file changes or
unsafe paths refuse replacement. Replacement preserves entry/copy identity and filename; a BDL
transaction compares the old fingerprint and updates the binding, fingerprint and source mapping.
Until that transaction succeeds, a flushed backup supports rollback. Commit failure restores the
old file; rollback failure preserves recovery material and reports `inspect_required`.

After commit the owned staging delivery and backup are consumed, so successful replacement leaves
one managed file rather than an accumulating staging copy. Delivery paths include the full native
download identity and are never reused by a later download, even after consumption. Cleanup checks
the staging boundary, regular file, fingerprint and separation from the managed target. It refuses
changed content or unrelated files. Cleanup failure preserves the confirmed `stored` result with
`vua.library.staging_cleanup_failed`, a warning terminal state and `inspect_required`; it cannot
claim a fully cleaned replacement or falsely report that the committed file failed to save.

[BDL v0.5 migration 006](../../schemas/bdl/v0.5/006_managed_library_files.sql) adds normalized
downloadable-to-copy bindings and account-library memberships and uses a guarded format stamp. Earlier rows and frozen
schemas remain. Source mappings of old content remain historical evidence, not proof of presence.

Restarted nonterminal batches require inspection and never silently resume or repeat adoption.
Deterministic recovery filenames and the worker's prepared-replacement checkpoint preserve the
replacement boundary for later inspection. Cancellation stops queued transport, abandons bound
native transfer, and stops the worker at a checked file boundary. Failed/cancelled new deliveries
leave the previous managed file in place.

## Evidence

Synthetic consuming tests cover batch admission, per-file outcomes, retained arbitrary formats,
stable replacement, failure preservation, replay and restart. They do not establish real BOOTH
account, paid-material, Unity or human UI acceptance; that belongs to N5.

## Document changelog

- 0.1 (2026-10-08): define durable selected-file acquisition, checked replacement and explicit partial results.

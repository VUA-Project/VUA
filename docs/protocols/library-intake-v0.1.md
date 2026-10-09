# Library intake v0.1

> Document version: 0.1
> Status: Implementation baseline (2026-10-09)
> Owner: AMF

`library.importFolders` is a command with closed params `{ schemaVersion: "0.1",
sourceFolders: string[], autoGenerate?: boolean }`. The local Kernel picker supplies absolute
folder paths. The list is nonempty, unique and bounded to 200 folders. The response is
`{ schemaVersion: "0.1", operation: "library.importFolders", taskId, correlationId }`.
The standard task channel owns progress, cancellation and restart inspection. Command IDs
are idempotent. The frozen `warehouse.import` remains available with its original format policy.

Each selected folder creates a managed entry. Ordinary files retain their relative paths and
bytes, regardless of extension; links/reparse points and files exceeding the 8 GiB intake bound
are reported as skipped. The source folder is never modified. Cancellation is checked while
copying, hashing and extracting. Completed files remain registered; no background work resumes
after restart. Import reports distinguish retained files, skips and archive expansion outcomes.

For local imports and managed BOOTH downloads, retain the verified original ZIP and expand
its members under the entry's `expanded/<archive-copy-id>/` directory. Preserve member paths
and retain all member formats. UnityPackage filenames are candidates for the later production
boundary, which must validate their contents. ZIP expansion does not grant production admission.
Nested ZIPs remain retained files in this baseline.

Expansion is staged before publication, bounded to 10,000 members and 8 GiB expanded bytes.
Unsafe paths, Windows path aliases, collisions, links, unsupported/encrypted members, CRC failures
and cancellation publish no partial new tree. The original remains available. The task reports
an expansion warning separately from successful storage. Retrying a download replaces the original
and its managed expansion; a failed expansion cannot establish current official member fingerprints.
Existing unregistered or modified expansion content blocks replacement rather than losing edits.

[BDL migration 007](../../schemas/bdl/v0.6/007_archive_members.sql) binds each retained member
copy to its parent copy and parent content identity. A current managed account parent establishes
official reference hashes for its extracted files, enabling source reconciliation against imports
from other managers. Stale member lineage cannot establish an official reference. Replacement
updates surviving member copies and retains absent member records as missing; no saved reference
is silently removed. An interrupted task requires inspection, without implicit extraction.

The direct `zip` crate use belongs to acquisition (ZIP intake); it reuses the workspace's zip
4.6 dependency with deflate only, under MIT. Removal consists of removing this intake adapter and
the direct dependency; no external executable or elevated permission is involved.

## Document changelog

- 0.1 (2026-10-09): define ordinary-file intake and managed ZIP expansion.

# Library re-download replacement

> Document version: ADR
> Status: Accepted — user ruling (2026-10-07)
> Scope: N5 managed account-library downloads

An already-downloaded product presents **Re-download** in place of **Download**. Re-download
fetches the selected file again and replaces its existing managed file; it does not create an
additional physical copy. This current ruling supersedes the multiple-copy behavior of
[warehouse layout](warehouse-layout.md) **for this library re-download operation only**.
Ordinary local folder imports and unrelated existing copies retain their existing semantics.

Replacement is applied to the file bound to that product/downloadable identity. The new delivery
is staged and checked before replacing the target. A failed or cancelled delivery keeps the old
file. Successful replacement preserves the warehouse entry/copy identity while updating the
content fingerprint and observation facts. Recipe references to the entry remain references;
old local resolutions and approved plans cannot claim their prior fingerprint still exists.

Multiple legacy candidates are an ambiguous replacement target and require an explicit selection.
They must not be silently merged, deleted or chosen by filename. Unselected files are preserved.
Newly selected files that have no existing binding are added through the ordinary download path.

The user additionally accepted (2026-10-08) retaining every delivered file format, including
documentation, images, FBX and 7z. Storage verifies the managed staging boundary, transfer size
and content fingerprint. Production qualification remains a separate format/source decision;
storage success does not claim that the file is admitted or usable by a production channel.

The old frozen `warehouse.importDownloads` copy-in face remains compatible. The managed library
path defines replacement in a new versioned operation and records per-file results, including
download, inspection and replacement failure. Product acceptance remains with N5.

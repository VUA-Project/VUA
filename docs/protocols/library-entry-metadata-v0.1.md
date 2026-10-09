# Library entry metadata v0.1

> Document version: 0.1
> Status: Implementation baseline (2026-10-09)
> Owner: AMF

`library.entryMetadata` queries `{ schemaVersion: "0.1", entryId }` for a local imported
entry. `library.updateEntryMetadata` commands carry the closed params `{ schemaVersion: "0.1",
entryId, expectedRevision, displayName, productId, thumbnailRef }`. Name is nonempty and at most
500 Unicode scalars, without control characters. Product is an observed `booth:<digits>` or null;
thumbnail is an opaque `vua-img://local/<SHA-256>` reference or null. No local image path, credential
or arbitrary thumbnail URL crosses this command. Replies contain `{ schemaVersion: "0.1", entryId,
revision, displayName, productId, thumbnailRef }`. Revision zero represents untouched local metadata.

The existing product-page reader resolves an ID/link into official observed metadata before the
association is saved. It does not claim account ownership. Manual editing exposes only name and
thumbnail. Local Kernel image picking copies a bounded PNG thumbnail into the existing local
image cache and returns its opaque reference; selected files remain unchanged. Third-party search
and editing shared official product records are outside this face.

Writes require the current revision and persist command-ID receipts atomically with the update.
An identical replay returns its receipt; changed params under the same command ID conflict.
Editing one entry does not change another entry, account metadata, file bytes or saved references.
An explicit source association overrides automatic source hints and constrains that entry's
content grouping to the chosen product. It never creates an official fingerprint: differing or
unverified bytes remain a local card, with source information and its own thumbnail/name.
An observed product without account membership or managed copies does not produce an extra
cloud-only account card merely because its metadata was read.

## Document changelog

- 0.1 (2026-10-09): define minimal local metadata and explicit official source association.

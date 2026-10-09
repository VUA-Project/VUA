# Local library record removal v0.1

> Document version: 0.1
> Status: Implementation baseline (2026-10-09)
> Owner: AMF

`library.removeLocalEntries` is a command with closed params `{schemaVersion: "0.1", entryIds}`
and an Application command ID. IDs are unique local imported-entry identities, one through 200.
The response contains the same schema version and ordered entry IDs. The BDL transaction validates
every target before marking any entry removed and records the command receipt atomically.
Identical replay returns its receipt; changed arguments under the same command ID conflict.

Removal applies to a complete folder import, including any copies that have merged into account
product rows. It removes that import's contribution to the unified library list and subsequent
content-reconciliation candidate collection. It does not unlink files, erase underlying warehouse/
copy/source records, change account ownership or retarget saved Recipe/draft references. Existing
frozen warehouse/reference read faces retain those identities. The confirmation lists the selected
imports and explains this boundary. There is no automatic restoration during BOOTH sync.

Only `imported_material` targets are permitted. Account hiding, restoration UI and physical cleanup
are deferred. Re-importing a folder explicitly creates a new import with the existing intake rules.

## Document changelog

- 0.1 (2026-10-09): define atomic local-import record removal with retained physical files and references.

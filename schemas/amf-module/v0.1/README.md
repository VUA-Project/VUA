# Optional AMF module lifecycle v0.1

> Status: Candidate
> Updated: 2026-10-09

This host-owned desktop face is separate from frozen Provider frame/application contracts.
`snapshot()` returns `snapshot.schema.json`. `setEnabled(boolean)` returns `change-result.schema.json`, a closed
`{outcome, snapshot}` record, where outcome is `updated`, `busy` or `failed` and snapshot conforms
to the same schema. A successful change is persisted before its result is returned. `subscribe`
reports lifecycle facts and returns an exact unsubscribe function. Only trusted local renderers
can call this IPC face; remote BOOTH content has no access.

`installed` means the first-party AMF module is selected for this profile. Fresh profiles start
with false. The payload is shipped with VUA; activation is not evidence of downloading anything.
`ready` is a serving-process fact, not Unity readiness, material production or task completion.
Installed modules may be starting, stopping or failed. Absent modules are never ready.

Enabling a failed module retries its process. Disabling blocks on active AMF work and never deletes
data or forces jobs. A failed change preserves the last persisted selection/data; its snapshot
reports the actual lifecycle state, rather than inferring success from a click.

Ownership and migration are defined once in [module architecture](../../../docs/architecture/modules.md).

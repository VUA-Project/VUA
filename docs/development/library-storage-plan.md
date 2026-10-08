# Library storage plan — Steam-style movable libraries

> Document version: 0.1.0
> Status: Backlog (deferred; not accepted for implementation)
> Scope: Design direction for multi-library user-data storage, within the product boundary
> Updated: 2026-10-06
> Authority: User direction of 2026-10-06 — boundary ruling accepted, Steam-parity feature set
> named, implementation deferred behind N5 closure ("如果工程量太大就先落文档"). This document
> records the rulings and the engineering breakdown so a later slice can pick it up without
> re-deriving them. Acceptance stays with the [N sequence](../development-outline.md).

## Reading context

The user asked for a "VUA library path" panel in Settings → Environment & Paths, then recognized
the full intent is Steam's library system and ruled the Steam behavior the reference. The Steam
store/library interface remains a **design reference only** (same stance as the N5 rework plan);
VUA builds no store and completes no purchases.

## Ruled boundaries (2026-10-06)

**Only user data lives in movable libraries.** Application state — cookie partition, caches, the
AMF-private SQLite stores (BDL, task store), lock files, and the bootstrap library-registry
setting itself — stays in the OS-managed app-data location (the dev-isolation profile mechanism is
unaffected: the registry is stored per profile). User data = booth material originals, VPM
packages, Unity projects, finished-avatar release outputs, download staging, and (open) user
documents such as recipes.

## Reference semantics (Steam, user-named)

1. A **default library** exists at the install location (for VUA: the current app-data layout —
   it already exists implicitly and needs no first-run migration).
2. **Adding a library** asks only for a **drive**; the library folder is created at the drive root
   by VUA. A drive that already carries a library is refused.
3. **Multiple libraries coexist**; one is the default (new acquisitions land there unless told
   otherwise).
4. **Local content can migrate between libraries** as audited operations.
5. **Adding a library requires no application restart.**
6. The management UI lists libraries with five actions — browse folder, repair library, rename
   library, set as default, remove library — of which the default library lacks *set as default*
   and *remove*.

## VUA adaptation decisions (design-level, to be frozen at implementation time)

- **Library registry**: ordered list of `{ libraryId, name, rootPath, isDefault }` persisted in
  app data (bootstrap). Each library root carries a marker document (`vua-library.json`:
  libraryId, name, format version) enabling duplicate-drive detection, adoption of an existing
  library on a re-added disk, and repair-side identification.
- **Layout under a library root**: VUA creates one folder at the drive root (name from the marker,
  e.g. `VUA-Library`), top-level domains inside are VUA-managed: `warehouse/` (originals + VPM
  copies, internal structure stays provider-autonomous), `projects/`, `avatars/`, `downloads/`,
  and (open) `documents/`.
- **Per-entry library fact**: BDL gains `library_id` on warehouse items and projects (additive
  migration) so multiple roots can serve simultaneously; stored paths stay relative within their
  library.
- **No-restart activation**: the provider currently receives one warehouse root via environment at
  spawn. Two-part change: (a) provider accepts the multi-library table (env or handshake config)
  and routes file operations per entry's library; (b) the desktop supervisor gains a provider
  respawn path (drain in-flight tasks → stop → start with the new table) so library additions take
  effect without restarting the app.
- **Migration**: per-entry (and per-project) moves across libraries run as audited nine-state
  tasks with in-flight guards; because paths are library-relative, a completed move is a folder
  relocation plus a `library_id` write.
- **Repair**: a scan/reconcile pass comparing library contents against BDL facts (missing files,
  orphans, torn moves) reporting honestly and healing what is mechanical.
- **Removal guard**: a library with content refuses removal until emptied (migrate everything
  first); an empty library unregisters cleanly.

## Engineering breakdown (the reason this is deferred)

Estimated at **four focused slices** — comparable in weight to the entire N5 warehouse/import
batch, versus roughly half a slice for the single-path "多合一" v0 that was superseded by this
ruling:

1. **Multi-root warehouse + registry** — BDL `library_id` migration, provider multi-root routing,
   registry storage + marker files, add/browse/rename/set-default/remove IPC face and settings
   panel (removal guard), drive-only picker (new shell-API surface: drive enumeration, not a
   folder picker). Contracts: BDL migration bump, bdl-queries bump (library exposure), a new
   library-registry face.
2. **No-restart provider respawn** — supervisor drain/stop/start semantics, task-face continuity,
   renderer reconnection; failure honesty when a respawn fails mid-add.
3. **Cross-library migration engine** — audited move tasks for warehouse entries and projects,
   in-flight guards, partial-failure recovery (torn moves feed the repair pass).
4. **Repair library** — scan/reconcile subsystem with honest reporting and mechanical healing.

Open questions for the implementation slice: staging per-library vs global; whether user documents
(recipes) move into libraries in v1; whether acquisition can target a non-default library at
download time or only via post-migration; multi-drive games-installed analog does not exist, so
"which library" defaults at each entry point.

## Deferral

Implementation is explicitly behind N5 closure (user direction 2026-10-06). The single-path v0 is
**superseded** by this plan; do not build it as an interim step.

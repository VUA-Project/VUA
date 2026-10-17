# ALCOM/VCC Project Compatibility Matrix

> Scope: read-only compatibility detection and capability matrix for ALCOM/VCC-managed projects
> Updated: 2026-10-01

## Authority and hard boundary

This matrix elaborates the product boundary (the U3/U14 clauses read unchanged since
product-boundary 2.0.0) and introduces no new semantics. VUA is
**read-only** toward projects managed by ALCOM/VCC; the only write path is the
user-chosen "import as a VUA-managed copy" (new project path and identity, disk usage
stated up front, no copying of regenerable directories or old task state, re-Inspect
after import, source link kept). Under the current product boundary, the write capability toward
the original project is always false; any future opening requires a new user ruling.

**Settings-face exception (user ruling U14, 2026-09-19):** the VPM package-management
settings (the repository-subscription and local-package-registry faces of `settings.json`)
are one file shared with VCC/ALCOM; VUA reads and writes that face by ruling, with changes
immediately visible to both sides. All other storage faces such as `vcc.liteDb` stay
denied, and the project-file face stays read-only (authoritative wording in the
product boundary's "Explicit boundaries" section).

**Allowed** (every check in this matrix is inside this list):

- discovering and identifying ALCOM/VCC-managed projects;
- reading versions, packages, SDKs, compatibility, and environment state;
- producing diagnostics, plans, and remediation guidance;
- handing write operations over to the owning manager (presentation-level guidance;
  VUA never writes on the user's behalf).

**Forbidden**: installing/removing packages inside the original project; modifying its
manifest, project configuration, assets, or `.vua` job files; writing ALCOM/VCC
registries, databases, settings, or caches (**exception**: the `settings.json`
package-management face — repository subscriptions and the local package registry — is
shared read/write by user ruling U14, see "Settings-face exception" above); silently
re-labeling the original project as VUA-managed.

## Detection matrix

| Check | ALCOM | VCC | Method (read-only) | Presentation |
| --- | --- | --- | --- | --- |
| Manager presence | Yes | Yes | Read the known settings paths (`%APPDATA%\alcom\setting.json`; `%LOCALAPPDATA%\VRChatCreatorCompanion\settings.json` with the legacy `%APPDATA%` fallback) | found / not_found / read_failed — an absent manager is a normal finding, not an error |
| Project discovery | `userProjects` | `userProjects` (modern) or `localProjectFolders` (legacy) | Read the settings file only; never sweep user folders | Project list = the union of both managers' registered paths |
| Dual-manager association | Yes | Yes | One path registered by both managers → one finding with both associations | Sorted, de-duplicated association list |
| Unity version and classification | Yes | Yes | Read `ProjectSettings/ProjectVersion.txt` | Full version string + classification (production target `2022.3.22f1` / migration sources `2019.4.31f1`, `2022.3.6f1` / other / Tuanjie), same rules as the [Unity editor compatibility policy](unity-editor.md) |
| VPM packages (declared face) | Yes | Yes | Read the `dependencies` and `locked` maps of `Packages/vpm-manifest.json` | Declared/locked versions sorted by packageId; a parse failure is an honest warning + empty list, never an invented entry |
| VRChat SDK | Yes | Yes | Spot `com.vrchat.*`-prefixed packages among those maps | `locked` wins over `dependencies`; report what is seen, no invented product semantics |
| Pending-mutation marker | `.vua/pending-mutation.json` | Same | Read-only observation (report it honestly; never acquire the lock — acquiring is a write) | none / leftover / unreadable |
| VUA-native identity | `.vua/project.json` | same | read-only observation (same discipline, never written) | absent / present (markedAt + note) / unreadable |
| Stale registry entries | Yes | Yes | Registered path no longer exists | The entry stays visible with a warning (`path_present: false`), never silently dropped |

## Honest presentation of capability conclusions

- A failed check produces a warning diagnostic on that project only; other findings are
  unaffected;
- A settings file that exists but has an unrecognized shape (e.g. no `userProjects`) is
  presence-with-warning; fields are never guessed;
- VUA does not claim a compatible transaction/recovery mechanism with ALCOM/VCC —
  understanding the VPM format on both sides does not make writes coordinable
  (1.2.0 rationale);
- Writes are always handed over: the UI offers "operate in ALCOM/VCC" or "import as a
  VUA-managed copy"; VUA never writes the original project.

## Source-finding principles and capability boundary (new in 1.2.0)

This section is the formal answer to walkthrough feedback B5① ("explain how the
project and package origins are currently determined"): it states VUA's source
finding basis honestly and pins down its capability boundary — **VUA cannot assert
where a project or a package really came from**. That boundary is inherent to the
detection face, not a defect awaiting a fix.

### Project origin (manager association)

- The only finding basis is the registry inside each manager's own settings file
  (ALCOM `setting.json` `userProjects`; VCC `settings.json`
  `userProjects`/`localProjectFolders`). "Managed by X" as reported by VUA means
  exactly "X's settings file currently registers that path" — a registration fact,
  not an assertion about who actually manages it.
- Known boundary: the registry can be stale (entries whose path no longer exists
  stay visible with a `path_present: false` warning); paths registered nowhere
  (e.g. a project placed by hand) are invisible to VUA, and VUA never sweeps user
  folders to guess.

### Package origin (declared face)

- VPM package information comes from the `dependencies`/`locked` maps of
  `Packages/vpm-manifest.json`; the compatibility matrix and project inspection
  present "what the project manifest declares".
- Capability boundary: **VPM declarations carry no acquisition channel** — official
  repository, community repository, local file install, and manual copy are
  indistinguishable in the manifest. VUA therefore cannot, and does not claim to,
  assert the real provenance of any package. The user observation "the current
  clues cannot establish the project's origin" matches this: it is the inherent
  boundary of read-only declared-face detection.

### Presentation discipline

- User-visible source wording uses uncertainty semantics ("this project looks like
  it is managed by other software", "taking it over may have unknown consequences"),
  never assertion semantics. The concrete copy belongs to the desktop presentation
  domain (user walkthrough ruling, 2026-09-12); the factual basis is this section;
- The detection face reports only what it sees; missing, failed, and unparseable
  states are presented as typed states, never invented assertions.

## VUA-native project finding (new in 1.1.0)

User rulings (2026-09-09 items 7/9/12): a migrated/imported copy's folder carries
the VUA-unique identity file `.vua/project.json`, and the inspection face reports
the `vuaIdentity` tri-state:

- `absent` — no identity file: not a VUA-native project (a `.vua/` holding only
  lock artifacts does not constitute the native marker);
- `present` — the VUA-native declaration, carrying `markedAt` (RFC 3339) and
  `note` (user note; **project-list display only**);
- `unreadable` — the file exists but cannot be parsed: itself evidence, never
  silently reported as absent.

Notes attach to the VUA-native declaration: setting a note on a project without
an identity file is refused (`SetNoteError::NotVuaNative`). The write face of
the identity file is the project-ops write command (`project.import-copy`
first-marks at the apply completion point) and a future migration command; the
inspection face never writes.

## Machine-readable faces

- Detection snapshot: `EnvironmentManagersSnapshotV01`
  (`schemas/environment-managers/v0.1/snapshot.schema.json`);
- Project inspection: `ProjectInspectionSnapshotV02`
  (`schemas/project-inspection/v0.2/snapshot.schema.json`, this matrix's
  package/SDK/lock rows + the VUA-native identity row; protocol document
  [project-inspection-v0.2](../protocols/project-inspection-v0.2.md));
- Command-face wire vocabularies: project-inspection v0.2 (four read queries) and
  project-ops v0.2 (`project.import-copy`, whose shape is unchanged from the superseded
  v0.1, plus `project.setNote`) are both frozen and wired
  ([project-ops-v0.2](../protocols/project-ops-v0.2.md)).

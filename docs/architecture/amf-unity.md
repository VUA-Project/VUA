# AMF and Unity Bridge architecture


> Document version: 1.3.0
> Status: Accepted
> Scope: AMF application services, Recipe, Build Record, `unity/`
> Updated: 2026-10-09
> Last conformance review: 2026-09-06
> Normative effect: Yes

## AMF production model

AMF is an optional VUA module, including its private BDL. Its production, acquisition and Bridge
services run in the AMF process; host environment/play services remain available without it.
[Module architecture](modules.md) owns activation, retained data and legacy-profile compatibility.

AMF treats Recipe as the source of a stackable set of modifications: a Recipe expresses an asset
combination and explicit, supported options (overlay semantics and conflict handling live in the
[product boundary](../product-boundary.md), "Production scope and product rulings"). The user
first selects lawfully acquired assets and a target combination, then the system resolves the
project, dependencies, and execution steps.

```text
Warehouse → Recipe → Assembly → Release
```

- **Warehouse** discovers, downloads with authorization, previews, identifies, and organizes assets
  through the native browser/content manager and optional adapters.
- **Recipe** describes project-independent asset identities, parameters, and intent; asset files stay
  in the user's local Warehouse.
- **Assembly** resolves local assets and capabilities into ProjectSpec, dependencies, and a reviewable
  plan, then Orchestrator performs project and Unity Bridge work. Prompts, progress, and recovery are
  represented as task states.
- Check evidence belongs to production records and the notification center; a standalone Inspection
  page is no longer required. When the user confirms production and the workshop starts intake,
  Release creates a placeholder record for that run; problems surface through both the notification
  center and the record status, and both open the same explanation, logs, and follow-up actions. A
  placeholder record in flight must never pose as a completed Build Record (user ruling,
  2026-09-22).
- **Release** manages Build Records, snapshots, recovery, and handoff to the official SDK upload flow.

A Recipe is portable, declarative intent. Importing one always requires local resolution before a
plan can be produced. Application semantics are overlay-based: a new Recipe stacks onto the current
Avatar; unmentioned existing assets and settings are preserved by default; deletion must be an
explicit action; conflicts are handled through the four options defined in the product boundary. A
Recipe does not promise full reproduction of arbitrary Unity projects, scenes, or all hand-authored
work.

## Warehouse, acquisition, and BDL

- **Electron desktop adapter** isolates pages, sessions, and download transport; enforces permission,
  navigation, origin, destination, and file restrictions; and returns normalized events. Cookies,
  tokens, and private Electron objects remain inside the desktop adapter.
- **AMF acquisition** owns browsing/download use cases, user intent, source correlation, durable
  tasks, retry/recovery, and file inspection. Desktop ports provide its complete Electron access.
- **Warehouse** owns the user-facing asset, source, preview, import, and correction experience.
- **BDL** stores AMF's normalized product, subproduct, file, terms, alias, compatibility, source,
  search, and mapping metadata.

Every module, plugin, and view reaches BDL-backed information through AMF use cases. AMF performs
authorization, semantic interpretation, and result shaping.

## Project compatibility

AMF uses three explicit project-management paths: VUA's own `vrc-get`-based package manager,
read-only compatibility with ALCOM-managed original projects, and read-only compatibility with
VCC-managed original projects; for the latter two, the only write path is the user-initiated
"import as a VUA-managed copy" (user ruling U3, 2026-09-08). Unknown format, lock, or capability
means read-only inspection, conversion advice, or manual handoff.

## Build Record

Each production run retains an immutable record linking the Recipe version and fingerprint, resolved
local assets and provenance, Unity/VPM package/tool versions, ProjectSpec, approved plan, initial/final project
fingerprints, Bridge requests/results/warnings/inspection summary, and snapshots/recovery points. Its
content is limited to reproducibility metadata and excludes session secrets, upload identity, and
redistribution-restricted asset contents.

## Unity editor compatibility

The production path uses global Unity `2022.3.22f1` exactly. Projects declaring `2019.4.31f1` or
`2022.3.6f1` enter the backup-and-migration path before Bridge work. Other Unity versions report their
exact difference from the production target and receive installation guidance; VUA keeps
`ProjectSettings/ProjectVersion.txt` unchanged. Tuanjie Engine is currently unsupported. The
[Unity editor compatibility policy](../compatibility/unity-editor.md) owns the complete matrix and
promotion rules.

## Unity Bridge boundary

The Unity `2022.3.22f1` Editor package inspects projects and imported assets; uses GUID and
`GlobalObjectId` references; validates and dry-runs supported operations; performs bone, menu,
parameter, animation, material, and Modular Avatar component work through public APIs; and returns
structured changes, diagnostics, fingerprints, and retry information. Object location (same-name
bones, cross-project location, repeated application) has not passed real-machine verification; the
current approach must not be assumed reliable (undecided — see the to-be-verified list in the
[product boundary](../product-boundary.md)).

AMF and Orchestrator retain the user journey, Recipe, downloads, credentials, approvals, and project
history. Final login and upload stay in the official VRChat SDK Panel.

## MA and SDK responsibility boundary (user ruling, 2026-09-22)

- Modular Avatar's declared capability boundary is accepted; VUA no longer exhaustively tests
  everything MA can do.
- VUA validates its own integration, parameters, object selection, call ordering, and
  representative real flows; issues also reproducible through standard upstream use are reported
  upstream.
- Build and target-platform technical limits reuse official SDK checks instead of maintaining
  duplicate rules.
- Missing assets, dependency installation, Bridge execution, and recovery remain VUA's
  responsibility.
- A check that did not run must never display as passed.
- The final upload is performed by the user in the official SDK; technical checks cannot guarantee
  that appearance and behavior match player expectations, and this must be stated clearly.

## Release handoff process face

The execution domain of the official SDK upload handoff (`release.openForHandoff`, release-handoff
protocol v0.1) is **editor process lifecycle management**, not the Bridge command face (production
stance of archived [proposal 023](../archive/2026-09-29/collab/proposals/023-release-sdk-handoff.md),
2026-09-16: both paths are not editor-internal commands; the then-current unity-bridge v3 command
vocabulary took zero new operations — the current frozen face is
[unity-bridge v4](../protocols/unity-bridge-v4.md)):

- **Handshake signal**: when a project finishes loading, the bridge package atomically writes a
  handshake fact to `<project>/.vua/bridge/handshake.json` (`InitializeOnLoadMethod`; closed set of
  four keys `schemaVersion`/`pid`/`editorVersion`/`occurredAt`, schema under
  `schemas/unity-bridge/handshake/v1.0/`). This is the deterministic project-loaded signal — the
  handoff task's completion verdict = this handshake arriving; "process started" is never a
  completion fact, timeouts fail honestly, and panel state is never guessed. The payload never
  carries the project's clear path (the file location binds it to the project) nor any upload state
  (honesty discipline pinned by shape); writing is best-effort — a failure never interrupts the
  editor, and the waiter reports an honest timeout.
- **Open/focus**: the Rust production port (`crates/unity-bridge` `handoff` module) provides the
  mechanism primitives — probing (handshake trail + pid liveness = the open fact; a missing,
  corrupt, unknown-version, or dead-pid trail is honestly reported as not open), detached launch
  (`Unity.exe -projectPath`, same credential-stripping baseline as the batchmode chain), handshake
  wait (budgeted polling with typed timeout), and OS window focus (best-effort, never part of the
  completion verdict nor of receipt facts — focus is not a stable fact).
- **Task orchestration** (buildId → editor identity resolution, open/focus path selection, task
  nine-state mapping) belongs to the core use case slice; this port provides mechanism facts and
  mechanism primitives only.

## Operations and safety

- Requests and results use versioned schemas and are written to the controlled `.vua` job
  directory inside the project;
- the Orchestrator writes requests atomically and Unity writes results atomically;
- repeated execution of the same command ID follows the idempotency rules defined by the protocol;
- a project-fingerprint mismatch rejects the mutation and requires a fresh Inspect;
- a snapshot suited to the operation or a verifiable compensation boundary must exist before any
  mutation;
- deterministic operations use the defined Bridge commands;
- repository and cloud CI use structurally equivalent synthetic projects and assets free of real
  product or user content; developers may use their own lawfully obtained assets for local Unity
  integration and smoke validation, and the assets, projects, configuration, and outputs remain
  local.

## Document changelog

- 1.3.0 (2026-10-09): scope production and private BDL to the optional AMF process; link host lifecycle and migration ownership.
- 1.2.3 (2026-10-01): mark the handoff section's proposal-023 stance as an archived 2026-09-16
  historical reference and note that the current frozen Bridge command face is v4 (v3 was current
  when the section landed); refresh the stale header date; no behavior change.
- 1.2.2 (2026-09-28): remove obsolete mirror metadata and clarify current ownership where needed during the N documentation audit.
- 1.2.1 (2026-09-23): structure aligned with the authoritative ZH edition — "Operations and
  safety" is its own section again, recovering two sub-points lost to the folded wording ("the
  Orchestrator writes requests atomically and Unity writes results atomically" and "a
  project-fingerprint mismatch requires a fresh Inspect"), and the "Unity Bridge boundary"
  section regains "final login and upload stay in the official VRChat SDK Panel"; the
  authoritative ZH text is unchanged.
- 1.2.0 (2026-09-22): user ruling of 2026-09-22 landed — Recipe redefined from "desired state" to
  a stackable set of modifications (overlay semantics, preserve-by-default, explicit deletion,
  four conflict options, bounded reproduction, pointing at product boundary 1.5.0's "Production
  scope and product rulings"); the Inspection stage left the production model, checks fold into
  production records and the notification center, and a Release placeholder record is distinct
  from an immutable Build Record; new "MA and SDK responsibility boundary" section; the "stable
  references" wording now states object location awaits real-machine verification (undecided);
  stale ALCOM/VCC wording corrected to read-only originals plus the copy write path (aligned with
  the accepted U3/U14 rulings, changing no existing boundary). Mirrors the ZH edition.
- 1.1.0 (2026-09-16): added the "Release handoff process face" section — proposal 023 production
  implementation slice (bridge handshake signal `EditorHandshake` + Rust process/window-face port
  `handoff` module + `schemas/unity-bridge/handshake/v1.0/`); the Bridge command face is unchanged.
- 1.0.1 (2026-09-08): mirror fix — "Unity/VPM/tool versions" aligned with the authoritative ZH
  wording ("Unity、VPM 包与工具版本"); per BOARD #9 terminology, VPM 包 = VPM package.
- 1.0.0 (2026-09-06): entered version management; header normalized and conformance-review date
  added. Content reviewed against reality with no change.

# AMF and Unity Bridge architecture

> Scope: AMF application services, Recipe, Build Record, `unity/`
> Updated: 2026-10-13

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

The initial N3 player path also accepts local library materials directly, without requiring a
saved Recipe. The Candidate [material-first face](../protocols/amf-production-v0.1.md) prepares an
independent managed work project, installs real SDK/MA packages in a private package environment,
imports the selected UnityPackages, and obtains actual prefab facts through separate
[Bridge v5](../protocols/unity-bridge-v5.md) operations. A unique Avatar/outfit choice is automatic;
ambiguity and static attachment targets remain explicit. The player edits switches, reviews the
plan and sees actual per-step outcomes. This is not N4's portable Recipe implementation.

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

The accepted development pair is global Unity `2022.3.22f1` and China `2022.3.22f1c1`, retaining
the full executable/running identity. Candidate Bridge v5 explicitly admits that pair; legacy
Bridge v1-v4 retain their frozen global-f1 gate and receipts. Projects declaring `2019.4.31f1` or
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

# VUA workspace instructions

> Updated: 2026-10-16

VUA is a Windows-first, local-first VRChat desktop application. Its goal is defined in the
[north star](docs/north-star.md). Work happens in ordinary single-line development.

## Read the smallest relevant set

1. [README.md](README.md), then the [documentation guide](docs/README.md).
2. The [north star](docs/north-star.md): goal, AI agents, SOPs and the
   [North Star Eval](docs/eval/README.md).
3. The [N sequence](docs/development-outline.md) for the work in progress and its acceptance.
   [Version policy](docs/release/versioning.md) owns release numbering.
4. The [product boundary](docs/product-boundary.md) before changing scope or ownership.
5. [CONTRIBUTING.md](CONTRIBUTING.md) and the [engineering and evidence rules](docs/development/engineering-rules.md).

Authority: current user ruling → product boundary → versioned contracts and tests → accepted
decisions → architecture → design standards → plans. Resolve conflicts before implementing.
README copy describes the intended experience; delivery status lives in the N sequence and
release notes.

## Work safely and incrementally

- Keep Electron + React/TypeScript + Rust + Unity Bridge, following the
  [system map](docs/architecture/system.md) and [incremental direction](docs/architecture/evolution.md).
  The renderer uses the typed Gateway; deterministic Unity changes cross the versioned Bridge.
- Deliver small usable paths and record remaining gaps as follow-up work. Acceptance comes from
  real runs, including real-material cases and human UI review, as defined in the N sequence.
- Keep paid assets, user projects, credentials, raw logs and machine inventories local, following
  the [evidence rules](docs/development/engineering-rules.md) and
  [local evidence policy](docs/meta/documentation-governance.md#7-local-environment-and-evidence).
- Use one writer per checkout and `slice/<slug>` branches. Merge through pull requests under the
  [protected-main policy](docs/meta/protected-main.md); reconcile divergence by merging.
- Before cleaning up, check whether a change is uncommitted, committed on another branch or
  historical, and preserve unrelated work.
- Launch other agents only when the user asks. Escalate unresolved scope or behavior conflicts to
  the user.
- Commits carry no AI co-author trailers.

## Documentation

[Documentation governance](docs/meta/documentation-governance.md) owns languages, writing style,
contract versions and the registry. Each rule has one owning document; other documents link to
it. Frozen contracts change through a new version. Accepted decisions and published release
notes stay as recorded. The retired collaboration process and its prompts live in
[the archive](docs/archive/2026-09-29/README.md) as history.

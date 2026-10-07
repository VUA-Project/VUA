# VUA system architecture

> Document version: 2.1.4
> Status: Accepted
> Scope: Current implementation and incremental code placement
> Last conformance review: 2026-10-01 (source/layout review, not real-machine acceptance)
> Normative effect: Existing ownership and dependency boundaries; incremental design is in evolution.md

## Current shape

VUA is a local desktop application. Electron/React presents user tasks and isolates remote pages.
Electron Main supervises a separate Rust Provider. The Provider composes application use cases,
durable task state, and adapters for local files, package managers, acquisition, and Unity Bridge.
Unity executes supported operations through the versioned Bridge.

```text
Local React UI -> typed Gateway/preload -> Electron Main
                                             |
                                  supervised Rust Provider
                                             |
                             application use cases + tasks
                                             |
                         ports -> concrete local/tool adapters
                                             |
                         SQLite / files / installers / Unity

Remote BOOTH content -> isolated Electron session and download transport
                     -> normalized acquisition events (no privileged remote access)
```

This diagram describes ownership, not a promise that every N-sequence capability is implemented.
There is no general runtime business-module registry or implemented community plugin host in this
baseline. The current Provider is a supervised process; in-process replacement is a future option
constrained by the same application contract, not a second implementation to maintain now.

## Current code layout

Verified against Cargo.toml, crate manifests, provider exports, and relevant sources on 2026-09-28.
There are **six** Cargo workspace members. The old single-crate paragraph was stale and conflicted
with the same document's later layout table; it is preserved only in the archive.

| Location | Current responsibility | Incremental placement rule |
| --- | --- | --- |
| `apps/desktop` | Electron Main/preload, React features, isolated web/session/download transport | UI renders intent/results; no installer or production business decisions in components |
| `packages/contracts` | Typed frontend/Gateway contract surface | Add the smallest contract needed by a real cross-boundary use case |
| `packages/orchestrator-provider` | Desktop-side Provider client/supervision | Keep transport and process lifecycle separate from application policy |
| `crates/orchestrator` | Task runtime, persistence, use cases, domain types/ports; also legacy filesystem/process/registry/environment code | New application decisions and ports belong here; new vendor implementations do not |
| `crates/project-manager` | vrc-get backend, project inspection/locks/copy, editor verification, environment managers and EAC adapters | New environment/install/tool adapters belong here unless a concrete extraction is justified |
| `crates/acquisition` | Warehouse intake/maintenance and artifact inspection | Own acquisition intent and mapping through existing application boundaries |
| `crates/bdl-store` | AMF-private catalog, download metadata, SQLite queries/migrations | Do not turn BDL into the environment install database or a cross-product data service |
| `crates/unity-bridge` | Bridge execution, material intake/execution/staging, production documents and handoff interfaces | Keep deterministic Unity operations behind the Bridge |
| `crates/provider-host` | Provider executable, service construction/dispatch, handoff adapter and Windows Job containment | Explicitly compose services; delegate business behavior to use cases |
| `unity/Packages` | Unity-side packages and Bridge implementation | Vendor/Unity types remain inside the Unity boundary |

Adapter crates consume core-owned domain types/ports; provider-host composes them. The current
acquisition crate also depends on unity-bridge and bdl-store; do not claim all adapters are mutually
independent. Some legacy adapters still live in the core. Document these seams and move touched
implementation with its tests when useful; a mass crate split is not a prerequisite for N1.

## Responsibilities by user task

- Environment deployment converts purpose and observations into actions, then executes and verifies
  them through adapters. Existing environment detection is not proof of complete automatic deployment.
- AMF resolves materials/Recipes into project and Bridge work, owns production records and SDK handoff.
- Acquisition owns authorized material listing/download/import intent; Electron owns session/cookies,
  remote content isolation and download transport; BDL stores the normalized AMF catalog.
- Task infrastructure supplies durable state, progress, cancellation, waiting for user input and
  recovery inspection. Individual use cases decide their valid retry/compensation boundaries.
- Overlays consume application services; they do not own workflows. Community-plugin execution
  remains separately deferred. N2's external-tool connections are not a generic VUA plugin host.

The accepted [evolution direction](evolution.md) defines N1-first deployment and later reuse. It
introduces no frozen wire fields, schema versions, persistence format, or automatic OS rollback.

## Dependency and state boundaries

```text
View -> presentation/feature -> typed Gateway -> use case -> domain port <- adapter
```

Commands carry intent; queries return observed state; task results report committed facts. Keep
framework/vendor objects at their adapter boundary. Do not duplicate package/dependency decisions
between the renderer and Rust. Remote pages receive no local application authority.

Reuse the existing task runtime and SQLite authority. Existing restart behavior surfaces nonterminal
work as inspect_required and needs an explicit choice. Existing per-project mutation exclusion
continues to apply. New machine installation steps need their own actual conflict/retry rules; do
not pretend a Unity-project snapshot restores a Windows installation. Recoverable work means a
recorded next action, not a universal promise of rollback for every third-party installer.

## Provider and data boundaries

The accepted [Provider decision](../decisions/orchestrator-supervised-provider.md),
[process protocol](../protocols/provider-process-v0.1.md), and
[task-store format](../protocols/task-store-v0.1.md) govern current hosting and durability.
The desktop supervises the separate executable; Windows Job containment controls descendant
process lifetime. Crashes/restarts remain observable, and replacing a Provider occurs at an idle
shutdown boundary. Source inspection here does not rerun those behavior tests.

Tasks, Recipes, projects and production records remain owned by their application services.
BDL owns AMF catalog data; Electron session storage owns authentication context. Paid files,
credentials and raw real-run evidence stay local. Diagnostics should preserve useful failure
facts while avoiding disclosure of account/private material data.

## Single-line development

Ordinary single-line development is the only active entry. Collab is retired; its records are in docs/archive/2026-09-29/. Do not bootstrap it or use its BOARD as the active work queue.
[Protected-main policy](../meta/protected-main.md) remains the repository-wide PR policy.
The collab-era registry checker (script and report-only CI) was removed with the mechanism's
full retirement; REGISTRY consistency is maintained by the governance update rules, not by an
automated check. Use the [N sequence](../development-outline.md) and
[contributor workflow](../../CONTRIBUTING.md) for current work.

## Reading routes

- N1/N2: this map, [integration architecture](integrations-and-overlays.md), then the accepted
  [evolution direction](evolution.md) and relevant current contract.
- UI: [desktop architecture](desktop.md) and the [design standard](../design/design-standard.md).
- N3/N4: [AMF/Unity](amf-unity.md), [Orchestrator](orchestrator.md), then selected contracts.
- N5: [BDL](bdl.md), AMF/Unity, then an implementation/UI/evidence capability audit.
- Exact wire/storage behavior: [protocol guide](../protocols/README.md), schemas and consumer tests.

## Initial account and external-tool delivery

N1 account guidance uses the existing renderer features (`features/onboarding` and
`features/guide`), the typed Gateway and the isolated desktop browser. The
Orchestrator owns guide progress/handoff semantics; browser storage owns temporary authentication
state, which does not cross into the application contract. See [desktop browser responsibilities](desktop.md#account-guide-browser)
and [product scope](../product-boundary.md#account-onboarding-user-ruling-2026-09-30).
The local guide stores no account credentials and makes no automatic account-verification claim.

N2 connects to the independently installed applications in the accepted tool inventory. Reuse
local discovery and supported launch paths; the shared Steam adapter, upstream lifecycle ownership
and the external-connection mode are owned by
[integration modes](integrations-and-overlays.md#external-integration-modes).

## Document changelog

- 2.1.4 (2026-10-03): route all selected N2 applications to the shared external-connection architecture.
- 2.1.3 (2026-10-02): record the removal of the collab-era registry checker (script and
  report-only CI); REGISTRY consistency now rests on the governance update rules alone.
- 2.1.2 (2026-10-01): name the real renderer features (`features/onboarding`, `features/guide`)
  instead of a nonexistent Wizard module; link N2 upstream-lifecycle ownership to the integration
  architecture instead of restating it. Code-layout table re-verified against crate sources
  (unchanged, including the project-manager row).
- 2.1.1 (2026-09-30): describe upstream installation and lifecycle directly.
- 2.1.0 (2026-09-30): route account guidance through existing browser and keep N2 tools outside VUA distribution.
- 2.0.0 (2026-09-28): replace contradictory layout/history with the verified six-crate map, single-line entry, and incremental responsibility guidance; preserve prior text in the archive.
- 1.0.3 (2026-09-28): incoming erratum recorded collab freeze; superseded by the corrected current map.
- 1.0.2 (2026-09-28): historical two-entry clarification.

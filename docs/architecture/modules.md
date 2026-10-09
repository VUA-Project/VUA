# VUA host and optional AMF module

> Document version: 1.1.0
> Status: Accepted
> Scope: First-party module composition, lifecycle and data ownership
> Updated: 2026-10-10

The user-defined unit is a **scenario** (the author's term: “情景”): a goal with a SOP list,
prerequisites, preparation, launch and recovery. A module supplies capabilities to scenarios.
VUA hosts these scenarios. AMF supplies the first-party Avatar-editing scenario. Ibis includes
its local payload but requires explicit first activation; external Avatar-editing modules and
their placeholder entries are deferred under the 2026-10-10 user ruling.

## Implemented boundary

- `vua-orchestrator-provider` starts the host's task authority and environment/play services. It
  does not construct AMF services, open BDL, or require an AMF executable to start.
- `crates/amf-provider` builds `vua-amf-provider`, a separate supervised process and Windows Job.
  It composes Warehouse, Recipe, Assembly, inspection/release, acquisition, project/package work
  and private BDL. Existing AMF and Unity Bridge contract bodies remain unchanged.
- Electron's `ModuleProvider` routes AMF methods to this process and host methods to the host.
  Task queries merge the reachable authorities; task lookup/cancellation is routed by owner.
  Capabilities come from the serving owner. AMF failure cannot revoke host capabilities.
- The first-party payload is installed with VUA at `resources/modules/amf/`. Without a saved enable
  choice, AMF remains disabled, including on legacy profiles. “Enable” registers and starts this
  local payload; it does not claim a network install. Explicit choices survive restart.
  No arbitrary module scripts, community plugin SDK or marketplace are introduced.
- The renderer loads AMF pages on demand, inside a local error boundary. Host bootstrap does not
  await AMF domain snapshots. Navigation, search, deep links, wizard material entry and BOOTH
  account controls use installed/readiness facts, independently of onboarding goal preferences.
- BOOTH browser/download transport, material-source references and image caching initialize only
  for a ready AMF. Stopping the module closes its views and retains its local account profile.
  Host task windows read `task.list`; optional AMF cards retain their original read contract.

The native protocol dispatch and task/domain types still share `provider-host` and `orchestrator`
libraries. This extraction creates separate executable composition and runtime authorities; it
does not claim mutually independent Rust libraries or independently updatable AMF releases.

## Data and migration

| Owner | Fresh-profile location below userData | Legacy behavior |
| --- | --- | --- |
| Host module selection | `modules/amf.json` | A pre-existing `bdl/bdl.db` selects the retained data layout only; first activation still requires a click |
| Host tasks | `host/tasks.db` | Transactionally imports legacy environment/demo tasks once |
| AMF tasks | `modules/amf/tasks.db` | Transactionally imports remaining legacy tasks, production bindings and project lease generations once |
| AMF BDL, warehouse, production documents, thumbnails and source references | `modules/amf/data/` | Existing AMF profiles retain the original userData-relative locations |
| Shared prerequisite editor choice | `editor-settings.json` | Original location retained |
| BOOTH session | Electron's existing `persist:vua-remote` partition | Original session retained; never merged with another application's login or library |

The former `orchestrator/provider.db` is attached read-only for task migration and retained as a
backup. Imports copy frozen task rows, events and idempotency receipts without changing identities,
revisions or document bindings. Destination locking and one transaction prevent partial imports;
unsupported formats/collisions are errors. The normal task recovery discipline then applies: an
interrupted mutation is inspected, never automatically resumed. Material files are neither copied
nor deleted by the module migration.

Disabling stops AMF and removes its navigation, while retaining all module data. Admission blocks
new AMF commands during a lifecycle change. Active tasks, in-flight mutations, catalog sync and
pending downloads prevent disabling; the user must finish or cancel them first. Module disable
never forces a job to stop. Application exit continues to use the existing Provider shutdown
protocol. Invalid registration or corrupt BDL is an AMF failure; data is not silently replaced.

Module selection is host-owned and never stored in BDL. [BDL](bdl.md) remains private to AMF;
external integrations keep their upstream data/lifecycle under
[integration modes](integrations-and-overlays.md#external-integration-modes).

## Evidence boundary

Automated tests cover owner routing/capabilities, active-task disable admission, legacy task and
lease/idempotency preservation, rollback and source retention. The native isolation test uses an
isolated profile and both real executables: host-only startup, deliberately corrupt BDL, retry,
AMF queries and data-preserving disable. It launches no vendor application or Unity operation and
is supplemented by a real Main/preload/production-renderer smoke for fresh entry, activation,
asset-library navigation and data-preserving disable/Settings return. These tests are not
real-material, PICO, installer or four-language human acceptance. Those outcomes remain
owned by the [N sequence](../development-outline.md) and [Ibis plan](../development/first-play-delivery-plan.md).

## Document changelog

- 1.1.0 (2026-10-10): distinguish bundled installation from explicit activation, keep legacy data from implicitly enabling AMF, and remove external editing placeholders from Ibis.

- 1.0.0 (2026-10-09): define the scenario/module distinction and implemented optional AMF＋BDL
  process, data, navigation and recovery boundaries; preserve legacy profiles and frozen contracts.

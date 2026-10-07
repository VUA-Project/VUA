# Protocol reading guide

> Document version: 1.4.0
> Status: Accepted
> Updated: 2026-10-02
> Scope: Navigation and retention guidance; no wire-format changes

**For people:** use this index when a contribution affects an API or stored format; read only
the relevant family and its compatibility notes.

**If you are an Agent:** identify the exact operation, schema version, producer and consumer
before coding. Check executable tests and served capabilities; the newest filename alone does
not prove migration. Do not treat historical proposal text as current authorization.

Choose the operations your slice uses, then read their schema and consumer tests. A document's
number is not sufficient to decide whether it can be archived. Some version directories describe
separate concurrently served operations, and some newer documents extend an earlier baseline.

| Area | Entry | Retention rule |
| --- | --- | --- |
| Gateway/tasks | [Application](application-contract-v0.1.md), [task store](task-store-v0.1.md), [Provider](provider-process-v0.1.md) | Current shared boundaries; document version and wire version may differ |
| Environment/projects | [Inspection](project-inspection-v0.2.md), [project operations](project-ops-v0.2.md), [editor verification](editor-verify-v0.1.md) | Preserve current guards and external-project read-only policy |
| Package reads | [listInstalled v0.2](packages-query-v0.2.md), [packageCatalog v0.2](packages-catalog-v0.2.md), [listRepos + packageCatalog v0.1 base spec](packages-repos-catalog-v0.1.md), [repoCatalog per-repository inventory](packages-repo-catalog-v0.1.md), [listRepos v0.2 increment](packages-repos-v0.2.md), [listTemplates](packages-templates-v0.1.md) | Check method consumers before retiring an older face |
| Package writes | [v0.1](packages-ops-v0.1.md), [v0.2](packages-ops-v0.2.md), [v0.3](packages-ops-v0.3.md), [v0.4](packages-ops-v0.4.md), [v0.5](packages-ops-v0.5.md), [v0.6](packages-ops-v0.6.md) | Concurrent faces: provider constants and TS types use all six; v0.6 is not blanket replacement of v0.1-v0.5 |
| Materials/production | [Material v0.2](material-intake-v0.2.md), [production v0.2](production-use-case-v0.2.md), [evidence](production-evidence-v0.1.md), [inspection queries](inspection-queries-v0.1.md), [inspection evidence](inspection-evidence-v0.1.md) | Earlier baselines may be needed for incremental definitions and tests; not archived by date |
| Recipe/SDK | [Recipe export](recipe-export-v0.1.md), [handoff v0.2](release-handoff-v0.2.md) | Check stored-format and consumer compatibility before retiring the earlier handoff face |
| BDL/acquisition | [Queries v0.5](bdl-queries-v0.5.md), [commands v0.4](bdl-commands-v0.4.md), [observations](bdl-dependency-observations-v0.2.md), [downloads](download-events-v0.1.md) | Follow actual schema/route versions; N5 audit is still required |
| Unity | [v4](unity-bridge-v4.md), [v3](unity-bridge-v3.md), [v2](unity-bridge-v2.md), [v1](unity-bridge-v1.md) | Newest frozen operation set does not prove every production path migrated; inspect actual command consumers |
| Previously superseded | [superseded/](superseded/) | Historical version lookup only; retaining these files does not reactivate their implementation |

## Delivery status and implementation entry points

Use three distinct descriptions when planning a slice: **existing implementation** (a route and
consumer can be inspected; availability still depends on runtime capabilities), **contract exists,
integration/acceptance to verify** (a schema is not execution evidence), or **contract to design**
(accepted behavior does not yet supply a wire format). Do not label an entire domain operational
from the existence of one method. This is a navigation aid, not a second completion ledger:
[N acceptance](../development-outline.md) and release evidence own delivery claims.

| Feature | Contract / method starting point | Implementation and test starting point | What this establishes |
| --- | --- | --- | --- |
| Environment presence | [Application contract](application-contract-v0.1.md), `environment.getSnapshot` | [Rust observations](../../crates/orchestrator/src/environment.rs) → [frontend port](../../apps/desktop/src/renderer/gateway/environment-port.ts) → [projection tests](../../apps/desktop/src/renderer/gateway/contract-projection.test.ts) | Existing inspection path; does not establish N1 automated deployment |
| First-play network | [Network v0.1](environment-network-v0.1.md), `environment.checkNetwork` | [Use case](../../crates/orchestrator/src/network.rs) → [HTTPS adapter](../../crates/project-manager/src/network_probe.rs) → [consumer](../../apps/desktop/src/renderer/gateway/live-network-port.ts) | Candidate implementation: explicit per-service HTTPS checks and correctable region; separate from game/PICO LAN acceptance |
| Purpose-driven deployment | [Deployment v0.1](environment-deployment-v0.1.md), `environment.planDeployment` / `environment.executeDeployment` | [Core policy/use case](../../crates/orchestrator/src/deployment.rs) → [Windows adapter](../../crates/project-manager/src/deployment_adapter.rs) → [consumer tests](../../apps/desktop/src/renderer/gateway/electron-gateway.test.ts) | Candidate executable slice with synthetic tests; real installer/project/device and UI acceptance pending |
| Account guide | [Accepted minimal state](../architecture/evolution.md#account-guidance-alongside-deployment) | Reuse the existing isolated desktop browser; define exact guide methods and consumer tests with its implementation | Contract to design; deployment does not imply account registration/verification |
| N2 external tools | [External-connection responsibilities](../architecture/integrations-and-overlays.md#external-integration-modes) | [Adapter ownership](../architecture/system.md#current-code-layout), then tool-specific discovery/launch code and tests in the implementation slice | Accepted scope; runtime support and any new contract remain to be established |
| Material/Recipe production | [Intake](material-intake-v0.2.md), [production](production-use-case-v0.2.md), [Recipe export](recipe-export-v0.1.md), [SDK handoff](release-handoff-v0.2.md) | [Provider routes](../../crates/provider-host/src/provider_host.rs) → [frontend production adapter](../../apps/desktop/src/renderer/gateway/live-production-port.ts) and [tests](../../apps/desktop/src/renderer/gateway/live-production-port.test.ts); [Recipe export consumer](../../apps/desktop/src/renderer/gateway/recipe-export-port.test.ts) | Contracts and implementation entry points exist; inspect the exact operation/capability. N3/N4 real-flow acceptance remains separate |
| BOOTH library/catalog/download | [BDL queries](bdl-queries-v0.5.md), [commands](bdl-commands-v0.4.md), [download events](download-events-v0.1.md) | [Acquisition](../../crates/acquisition/), [BDL store](../../crates/bdl-store/), [desktop session boundary](../architecture/desktop.md#remote-content-isolation) | Existing parts require the N5 capability audit; these contracts alone do not prove complete account-library retrieval |

For any row: find the exact method in the [application registry](application-contract-v0.1.md),
follow its [TypeScript types](../../packages/contracts/src/index.ts) and [Provider dispatch](../../crates/provider-host/src/provider_host.rs),
then inspect the corresponding frontend port and producer/consumer tests. For methods defined by
a linked family, use that family's own operation table and schema links. Verify the served
capability and missing/error behavior before wiring UI. Add links here only when a real slice
establishes the entry point; do not invent implementation files for planned features.

Source review on 2026-09-28 found package-operation version constants v0.1-v0.6 in
crates/provider-host/src/provider_host.rs and matching TS types in packages/contracts. This is
retention evidence, not proof that every path was executed. Body histories such as M/W/proposal
labels are historical provenance, not active work assignments.

Keep contract bodies/schema paths stable during navigation cleanup. Any behavioral change follows
its version/migration rules in the same implementation slice. Inspect direct and inherited
references before moving a baseline. Record replacement, reason and remaining consumers for any
retirement, then update the registry and links.

For upstream-driven changes, follow the [third-party compatibility and licensing policy](../release/versioning.md#third-party-changes-and-compatibility).

## Document changelog

- 1.4.0 (2026-10-03): add the implemented first-play network query and its code routes.

- 1.3.1 (2026-10-02): index inspection-queries/inspection-evidence in the Materials/production row; disambiguate the packages-repos-catalog / packages-repo-catalog / packages-repos labels (v0.1 combined base spec vs per-repository inventory vs v0.2 increment).
- 1.3.0 (2026-09-30): route the executable Candidate N1 deployment family separately from pending account guidance.

- 1.2.0 (2026-09-30): add direct family links, scoped delivery-status guidance and contract-to-code reading routes.

- 1.1.0 (2026-09-29): distinguish human lookup from Agent contract-verification workflow.


- 1.0.0 (2026-09-28): add task-based protocol navigation and explicit coexistence/retention guidance.

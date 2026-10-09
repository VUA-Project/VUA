# Documentation guide

> Document version: 1.3.0
> Status: Accepted
> Updated: 2026-10-09
> Scope: Current documentation routes for ordinary single-line N-sequence development

## Choose your reading context

**For people:** start with the project README and the questions below. For contributions, read
the human introduction in CONTRIBUTING; translation and usability feedback are welcome without
learning the full architecture. Follow only the detail needed for your change.

**If you are an Agent:** read AGENTS.md and the Agent introduction in CONTRIBUTING first, then
identify the owning product/contract document and N acceptance row for the actual user request.
Check branch and working-tree state before edits; old checkouts may still contain active-looking
collab files. Current user rulings retire that mechanism regardless of the checkout's age. Do not
run archived role prompts, ticks or autonomous work queues. Report evidence and unverified gaps
separately. Repository migration is complete; use VUA-Project/VUA and the current PR policy.

Both readers use the same definitions below; these introductions change navigation, not policy.

## Start here

| Question | One owning document |
| --- | --- |
| What is VUA and where do I start? | [Project README](../README.md) |
| How do I develop and submit changes? | [Contributing](../CONTRIBUTING.md) |
| What does the product include? | [Product boundary](product-boundary.md) |
| What comes next and what counts as passing? | [N sequence](development-outline.md) |
| Where does each responsibility live? | [System map](architecture/system.md) |
| How do scenarios and optional AMF＋BDL relate? | [Host and modules](architecture/modules.md) |
| Which exact contract do I need? | [Protocol guide](protocols/README.md) |

Read only the owning documents needed for the task. Collab is [archived and retired](archive/2026-09-29/README.md).
[PR protection](meta/protected-main.md) continues independently as the repository-wide PR policy.

## Choose a reading route

These are task perspectives, not standing Agent roles or separate policies. Agents first read
AGENTS.md and CONTRIBUTING; then follow one route below instead of reading the entire repository.

| Reader | Read in order | Ready to act when |
| --- | --- | --- |
| Player / end user | [Current delivery and limits](../README.md#current-delivery-and-starting-points) → [release evidence](release/v0.6.0.md) (Chinese) → [questions and bugs](../CONTRIBUTING.md#reporting-and-assets) | The available artifact and its limits are clear; planned N features are not assumed usable |
| Human developer | [Contributor workflow](../CONTRIBUTING.md#develop-one-useful-slice) → [local setup and launch](../apps/desktop/README.md#development-commands) → the relevant task below | The app can be started and the checks relevant to the change are identified |
| Frontend UI/UX Agent | [Product scope](product-boundary.md) + [N acceptance](development-outline.md#new-sequence) → [Desktop](architecture/desktop.md) → [interaction rules](design/design-standard.md#6-interaction-and-feedback) and [i18n/accessibility](design/design-standard.md#9-accessibility-internationalization-and-performance) | Required states, real Gateway data and human UI acceptance are identified; new account flows also read [account-guide browser](architecture/desktop.md#account-guide-browser) |
| Environment business-logic Agent | [N1](development-outline.md#n1-purpose-driven-deployment) / [N2](development-outline.md#n2-external-gameplay-tools) → [deployment flow and code placement](architecture/evolution.md#deployment-architecture-first-slice) → [standalone Unity deployment](architecture/unity-deployment.md) → [external integrations](architecture/integrations-and-overlays.md#external-integration-modes) → [contract status](protocols/README.md#delivery-status-and-implementation-entry-points) | Detection, installation handoff, mutation ownership and missing contracts are distinguished |
| AMF business-logic Agent | [N3–N5 outcomes](development-outline.md#n3-complex-real-material-avatar-production) → [AMF/Unity](architecture/amf-unity.md) → [BDL](architecture/bdl.md) when acquisition is involved → [production contracts](protocols/README.md#delivery-status-and-implementation-entry-points) | The material → Recipe → production → SDK path, exact contract versions and real-material evidence are identified |
| Frontend/backend integration Agent | [Dependency direction](architecture/system.md#dependency-and-state-boundaries) → [method registry](protocols/application-contract-v0.1.md#method-surface) → [contract-to-code route](protocols/README.md#delivery-status-and-implementation-entry-points) → relevant producer/consumer tests | The method, types, runtime capability, both ends and absent/error states agree |

## Read by task

| Task | Read next | Add only when needed |
| --- | --- | --- |
| First desktop/PICO play release | [Accepted scope](product-boundary.md#first-play-release-user-ruling-2026-10-03), [release acceptance](development-outline.md#first-play-release-acceptance), [completed slices and remaining work](development/first-play-delivery-plan.md) | Three guidance presentations are implemented; automatic game following, desktop/PICO and eye-tracking completion, recovery and ZIP release remain; N5 is reviewed separately |
| App tour / preparation reader / game guide | [Guidance architecture](architecture/guidance.md), [next implementation slices](development/first-play-delivery-plan.md#2-next-focus-deliver-the-three-guidance-contexts), [Desktop](architecture/desktop.md) | A/B reuse, context routing, independent state, VRChat-window following and transparency; UI rules remain in the design standard |
| N1 deployment / N2 tools | [N1 delivery plan](development/n1-delivery-plan.md), [network checks and regional guidance](architecture/network-onboarding.md), [system map](architecture/system.md), [integration boundaries](architecture/integrations-and-overlays.md), [incremental evolution](architecture/evolution.md) | Device/model routes, installation activity, account/activation/network guide, Editor compatibility and relevant Gateway contract |
| N3 production / N4 Recipe | [AMF and Unity](architecture/amf-unity.md), [Orchestrator](architecture/orchestrator.md) | Production/material/Recipe/SDK handoff contracts and real-run evidence |
| N5 material audit/rework | [N5 capability audit](development/n5-capability-audit.md), [N5 rework plan](development/n5-rework-plan.md), [BDL](architecture/bdl.md), [AMF](architecture/amf-unity.md) | Current UI/Gateway/code/tests; account listing, selective download and import contracts |
| Library storage (backlog) | [Library storage plan](development/library-storage-plan.md) | Steam-style multi-library rulings; deferred behind N5 closure |
| UI changes | [Desktop](architecture/desktop.md), [design standard](design/design-standard.md) | [Guidance contexts](architecture/guidance.md) when changing guides; relevant feature and human UI acceptance |
| Recovery | [Orchestrator](architecture/orchestrator.md) | Task store, operation-specific failure/retry format and tests |
| Versions / N7 distribution | [Version policy](release/versioning.md), [N7 acceptance](development-outline.md#n7-beta-installer-regression-and-illustrated-user-guide) | Installer, actual-build screenshots and user-provided guide reference |
| Contract change | [Protocol guide](protocols/README.md) | Specific schema and consumer tests; do not assume highest version replaces all older faces |
| Document cleanup | [Governance](meta/documentation-governance.md) (standing authority); [2026-09-28 audit/disposition](meta/document-audit-2026-09-28.md) (historical reference) | [Registry](REGISTRY.md) and [archive index](archive/README.md) |

## Directory roles

| Location | Role |
| --- | --- |
| Root: this guide, REGISTRY.md, project-context.md, product-boundary.md, development-outline.md | Documentation map and registry, cold-start primer; what the product does; what is delivered next |
| `architecture/` | Current code/ownership; explicitly marked proposals for incremental evolution |
| `protocols/`, repository `schemas/` | Exact wire/storage behavior, with active/coexisting/historical status |
| `compatibility/` | Supported targets and evidence limits, not universal Windows guarantees |
| `design/` | Current UI acceptance authority; refine relevant sections with actual UI work |
| `development/` | Engineering/evidence rules and scoped implementation checkpoints/plans |
| `decisions/` | Accepted decisions retained with historical rationale; supersede explicitly, never silently rewrite |
| `release/` | Version policy and immutable historical Chinese release notes |
| `tool-catalog/` | Core/plugin/external classification; a catalog entry is not implemented capability |
| `meta/` | Documentation maintenance rules (governance, protected-main policy) and the 2026-09-28 documentation-restructure audit |
| `migration/` | Tracked legacy asset migration ledger; the directory is otherwise gitignored local scratch |
| `research/` | Retained extraction/boundary research pending owning-domain review, not a new feature roadmap |
| `archive/` | Outdated snapshots and completed spike evidence, excluded from the current reading path |

`plans/` is gitignored local scratch: it is never tracked and never registered.

Current authority: user ruling, product boundary, versioned contracts/tests, accepted decisions,
architecture, design, then plans. A Draft proposal does not override an accepted contract.
A source review does not establish runtime acceptance. M history does not close N gates.

Tracked docs are English except Chinese release notes and the four-language root README.
Local Chinese mirrors under docs-zh are optional and non-authoritative. Each fact has one owning
document; navigation links to it instead of copying detailed rules. Raw real-machine artifacts
remain local. Registry and document changes ride with the feature, not a separate paperwork cycle.

## Document changelog

- 1.3.0 (2026-10-09): route scenario/module ownership, optional AMF activation and legacy data preservation.
- 1.2.1 (2026-10-07): route subsequent work from the delivered guidance checkpoint.
- 1.2.0 (2026-10-05): add direct routes to the three-context guidance architecture and first-play delivery checkpoint, with N5 reviewed separately.
- 1.1.2 (2026-10-03): update the N2 inventory route and include first-play PICO eye tracking.
- 1.1.1 (2026-10-03): link the implemented network checks and regional guidance from N1 reading routes.

- 1.1.0 (2026-10-03): add the bounded first-play-release reading route before the wider N1/N2 route.
- 1.0.1 (2026-10-02): drop the retained collab-era checker mention; the script and CI were removed
  with the mechanism's full retirement.
- 1.0.0 (2026-10-01): register the documentation guide as a managed document.

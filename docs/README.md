# Documentation guide

> Updated: 2026-10-16

## Choose your reading context

**People:** start with the project README and the questions below. For contributions, read the
human introduction in CONTRIBUTING; translation and usability feedback are welcome without
learning the full architecture.

**Agents:** read AGENTS.md and the Agent introduction in CONTRIBUTING, then find the owning
document and the N acceptance row or Eval case for the request. Check the branch and working tree
before editing. Report verified results and open gaps separately.

## Start here

| Question | Owning document |
| --- | --- |
| What is VUA and where do I start? | [Project README](../README.md) |
| What is VUA for, and how is progress measured? | [North star](north-star.md), [North Star Eval](eval/README.md) |
| How do I develop and submit changes? | [Contributing](../CONTRIBUTING.md) |
| What does the product include? | [Product boundary](product-boundary.md) |
| What comes next and what counts as passing? | [Current plan](development/current-plan.md), [N sequence](development-outline.md) |
| Where does each responsibility live? | [System map](architecture/system.md) |
| How do scenarios and the optional AMF module relate? | [Host and modules](architecture/modules.md) |
| Which exact contract do I need? | [Protocol guide](protocols/README.md) |
| How are documents written and versioned? | [Documentation governance](meta/documentation-governance.md) |

Pull requests follow the [protected-main policy](meta/protected-main.md).

## Choose a reading route

| Reader | Read in order | Ready to act when |
| --- | --- | --- |
| Player | [Current delivery](../README.md#current-delivery-and-starting-points) → latest release notes in `release/` → [questions and bugs](../CONTRIBUTING.md#reporting-and-assets) | The available build and its known issues are clear |
| Human developer | [Contributor workflow](../CONTRIBUTING.md#develop-one-useful-slice) → [local setup and launch](../apps/desktop/README.md#development-commands) → the relevant task below | The app starts and the checks relevant to the change are known |
| Frontend UI/UX | [Product scope](product-boundary.md) + [N acceptance](development-outline.md#new-sequence) → [Desktop](architecture/desktop.md) → [interaction rules](design/design-standard.md#6-interaction-and-feedback) and [i18n/accessibility](design/design-standard.md#9-accessibility-internationalization-and-performance) | Required states, real Gateway data and human UI acceptance are known; account flows also read the [account-guide browser](architecture/desktop.md#account-guide-browser) |
| Environment logic | [N1](development-outline.md#n1-purpose-driven-deployment) / [N2](development-outline.md#n2-external-gameplay-tools) → [deployment flow](architecture/evolution.md#deployment-architecture-first-slice) → [standalone Unity deployment](architecture/unity-deployment.md) → [external integrations](architecture/integrations-and-overlays.md#external-integration-modes) → [contract status](protocols/README.md#delivery-status-and-implementation-entry-points) | Detection, installation handoff, mutation ownership and needed contracts are known |
| AMF logic | [N3–N5](development-outline.md#n3-complex-real-material-avatar-production) → [AMF/Unity](architecture/amf-unity.md) → [BDL](architecture/bdl.md) for acquisition → [production contracts](protocols/README.md#delivery-status-and-implementation-entry-points) | The material → Recipe → production → SDK path, contract versions and real-material evidence are known |
| Agent tools (MCP) | [North star: AI agents](north-star.md#ai-agents) → [existing Agents as tool consumers](architecture/evolution.md#existing-agents-as-tool-consumers) → [Eval](eval/README.md) | The tool, its permission level, the task authority it reuses and the Eval case it serves are known |
| Frontend/backend integration | [Dependency direction](architecture/system.md#dependency-and-state-boundaries) → [method registry](protocols/application-contract-v0.1.md#method-surface) → [contract-to-code route](protocols/README.md#delivery-status-and-implementation-entry-points) → producer/consumer tests | Method, types, runtime capability, both ends and absent/error states agree |

## Read by task

| Task | Read next | Add when needed |
| --- | --- | --- |
| First desktop/PICO play release | [Accepted scope](product-boundary.md#first-play-release-user-ruling-2026-10-03), [release acceptance](development-outline.md#first-play-release-acceptance), [delivery plan](development/first-play-delivery-plan.md) | NSIS, runtime and AMF update work; desktop/PICO play; recovery; human review |
| App tour, Help reader or game guide | [Guidance architecture](architecture/guidance.md), [delivery plan](development/first-play-delivery-plan.md#2-next-focus-deliver-the-three-guidance-contexts), [Desktop](architecture/desktop.md) | Context routing, independent state, VRChat-window following |
| N1 deployment / N2 tools | [N1 delivery plan](development/n1-delivery-plan.md), [network checks](architecture/network-onboarding.md), [system map](architecture/system.md), [integrations](architecture/integrations-and-overlays.md), [evolution](architecture/evolution.md) | Device routes, installation activity, account and network guide, Editor compatibility, Gateway contract |
| N3 production / N4 Recipe | [AMF and Unity](architecture/amf-unity.md), [Orchestrator](architecture/orchestrator.md), Eval cases `P-` | Production, material, Recipe and SDK handoff contracts; real-run evidence |
| N5 materials | [Capability audit](development/n5-capability-audit.md), [rework plan](development/n5-rework-plan.md), [BDL](architecture/bdl.md), [AMF](architecture/amf-unity.md) | Current UI/Gateway/code/tests; account listing, selective download and import contracts |
| Library storage (backlog) | [Library storage plan](development/library-storage-plan.md) | Multi-library rulings, scheduled after N5 |
| UI changes | [Desktop](architecture/desktop.md), [design standard](design/design-standard.md), [writing style](meta/documentation-governance.md#6-writing-style) | [Guidance contexts](architecture/guidance.md) for guides; human UI acceptance |
| Recovery | [Orchestrator](architecture/orchestrator.md) | Task store, failure/retry format and tests |
| Versions / N7 distribution | [Version policy](release/versioning.md), [N7 acceptance](development-outline.md#n7-beta-installer-regression-and-illustrated-user-guide), [Windows distribution plan](development/windows-distribution-plan.md) | NSIS, mirrored runtime, AMF incremental updates, screenshots |
| Contract change | [Protocol guide](protocols/README.md) | Schema and consumer tests; older numbered faces can still be served |
| Documentation | [Governance](meta/documentation-governance.md) | [Registry](REGISTRY.md), [archive index](archive/README.md) |

## Directory roles

| Location | Role |
| --- | --- |
| Root: this guide, `north-star.md`, `product-boundary.md`, `development-outline.md`, `REGISTRY.md`, `project-context.md` | Goal, scope, delivery sequence, contract registry, cold-start pointer |
| `eval/` | North Star Eval definition and cases |
| `architecture/` | Current code ownership and accepted incremental direction |
| `protocols/`, repository `schemas/` | Exact wire and storage behavior, with coexisting versions |
| `compatibility/` | Supported targets and the evidence behind them |
| `design/` | UI acceptance authority |
| `development/` | Engineering and evidence rules, scoped delivery plans |
| `decisions/` | Accepted decisions with their rationale |
| `release/` | Version policy and release notes |
| `tool-catalog/` | Core, plugin and external tool classification |
| `meta/` | Documentation governance and the protected-main policy |
| `migration/` | Legacy asset migration ledger |
| `research/` | Research records awaiting domain review |
| `archive/` | Historical records |

`plans/` is gitignored local scratch.

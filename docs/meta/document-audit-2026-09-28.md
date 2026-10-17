# Documentation audit and disposition - 2026-09-28

> Scope: Source/document audit for the N-sequence reorganization

## Baseline and limits

The checkout is slice/real-machine-first at 23aba9e6. At audit start it contained 46 modified
tracked files and 90 tracked Markdown files under docs. Incoming changes were preserved locally
before editing, including the collab freeze and minor document errata. This review does not claim
to audit every runtime feature or execute the N5 capability test suite.

Machine-specific observations are retained in the ignored `_local_environment/current.md`
and dated local baseline outputs. User reports, detection and execution evidence are distinct.
No software was installed or uninstalled by this documentation audit.

## Incoming changes reviewed

| Group | Observed edits | Disposition |
| --- | --- | --- |
| Entry/agent/collab files | Freeze notices in AGENTS, contributor guide, collab entries, and agent prompts | Preserve; ordinary single-line entry only; protected-main PR policy remains effective |
| N sequence/primer | Freeze adoption and ownership hats instead of active seats | Preserve |
| Architecture/compatibility/design | Old M citations and stale lane labels corrected | Preserve meaning; correct independently found architecture contradictions; normalize two version-header trailing spaces |
| Protocol headers/provider prose | Baseline naming and N7 references changed | Preserve; this cleanup does not change wire schemas |
| Registry helper | Added Implementation baseline status normalization | Preserve; do not remove collab:brief |
| CI | Existing collab-registry job has continue-on-error: true | Retain byte-for-byte as report-only |
| Security/catalog | Beta and obsolete schedule wording adjustments | Preserve; unrelated bilingual/security text not rewritten in this pass |

## Findings and actions

| Finding | Evidence | Action |
| --- | --- | --- |
| System map claimed one crate and six crates simultaneously | system.md baseline versus Cargo.toml's six members | Archive old snapshot; replace with factual map and legacy-coupling notes |
| Suspended collaboration still appeared as active architecture procedure | system.md bootstrap/BOARD section | Replace with ordinary workflow and protected-main exception |
| High-numbered package protocol is not a complete replacement | provider_host.rs constants and application-contract.ts types use v0.1-v0.6 | Retain all; add protocol coexistence guide |
| BOOTH extraction research is still consumed as a specification | booth_extraction.rs opening comment explicitly cites docs/research/booth-product-extraction | Retain for N5 audit; do not discard because of folder name |
| BDL research mixes historical draft and accepted boundary text | bdl-v1-boundary status/constraints and bdl-v2-capability-list draft | Retain pending domain comparison; no assumption that all research is obsolete |
| Environment/VPM spikes describe completed old feasibility work | Their own non-normative/pre-B3 headers and content | Move to archive, preserving content and current-route pointers |
| BDL wording assigned Electron Session/browser ownership to AMF | bdl.md versus product-boundary and desktop/AMF documents | Correct ownership summary without changing storage semantics |
| Several domain headers still called English a Chinese mirror | desktop/orchestrator/amf-unity/bdl headers | Remove stale language header; keep actual domain rules |
| Docs entry listed nearly every protocol and mixed historical/current context | docs/README.md | Replace with short task routes; detailed protocol navigation has its own index |

## File-family disposition

| Family | Disposition now | Further work only when needed |
| --- | --- | --- |
| Product boundary, N sequence, version policy | Reuse current rulings and stable paths | Do not duplicate scope in architecture |
| System architecture | Rewrite factual map; keep prior snapshot in archive | Review against code as meaningful slices land |
| Orchestrator, desktop, AMF, BDL, integrations | Reuse; correct known ownership/header/current-status issues | Update touched behavior with implementation evidence |
| Evolution direction | User confirmed retaining the stack and N1-first incremental responsibilities | Exact installer/contract details follow executable slices |
| Design standard | Keep current 797-line authority; no wholesale rewrite | Review/split relevant UI sections with human acceptance |
| Compatibility | Preserve incoming fixes and supported Unity/external-project boundaries | Extend claims only with named environment evidence |
| Protocols and schemas | Keep behavioral bodies/paths; add coexistence guide | Retire only after checking actual consumers and migration needs |
| Accepted decisions | Keep immutable historical rationale | Supersede explicitly if a selected design changes a decision |
| Historical release notes | Keep unchanged | No retroactive claims or tag/version edits |
| Research | Archive two completed spikes; retain three BDL/BOOTH documents | N5 audit determines consolidation of retained constraints |
| Tool catalog | Reuse current N2 scope and trust classification | Source/build/license evidence belongs to concrete adapter work |
| Registry/governance | Retain mechanism; add current routes and archive rules | Avoid treating registry consistency as product acceptance |
| Local plans/migration/reference | Remain local scratch/evidence | Do not publish private content or promote it implicitly |
| Collab | Frozen files kept at their paths | No ticks, proposals or plan rewriting; PROTECTED_MAIN and report-only CI remain active |

## Next implementation decision

The user-accepted direction in architecture/evolution.md retains the existing stack and six-crate layout, adding
one N1 deployment use case and its concrete adapters. This audit has not chosen an installer backend,
changed the task-store schema, promised automatic rollback, or restarted collab. The next useful
technical step is to prove one actual install/verify path on this machine.

## Follow-up consistency review

Corrected the product-boundary auto-generation status against acquisition source and the BDL
persistent format against the store constant. Neither is a real-flow pass. Fixed a misplaced
governance section and recorded local-inventory and third-party change policies. The historical
migration ledger's missing screenshot remains explicitly unavailable, not reconstructed evidence.
Protocol behavior, design usability, upstream licensing and N5 capability acceptance still require
their implementation-specific reviews; a link/registry pass does not complete those reviews.

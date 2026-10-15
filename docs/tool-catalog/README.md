# VUA Tool Catalog

> Catalog schema: `vua.tool-entry/v3`
> Updated: 2026-10-02

This community-maintainable catalog classifies entries by contact with VUA data and authority.
Each entry explains its purpose in natural language. The physical structure is one category directory
plus individual entry files.

```text
tool-catalog/
├─ core/       # trusted built-in VUA behavior
├─ plugin/     # capability-bounded VUA plugins
└─ external/   # independent external software
```

| Boundary | Test | VUA authority |
| --- | --- | --- |
| [Core](core/README.md) | Is it repository-owned behavior built directly into VUA? | Trusted built-in behavior, but only through owned use cases and ports |
| [Plugin](plugin/README.md) | Does a separately packaged extension request VUA capabilities? | Explicit, deny-by-default grants |
| [External](external/README.md) | Does independent software own its state and public integration surface? | Independent authority; each VUA-side adapter is separately Core or Plugin |

Kernel and the local UI are stable host surfaces. Core is a trust and catalog classification, not a
runtime module or registration mechanism.

## Entry schema

```yaml
---
catalog_schema: "vua.tool-entry/v3"
id: "stable.unique-id"
boundary: "core | plugin | external"
status: "proposed | planned | experimental | supported | deprecated"
risk: "pending | low | medium | high"
risk_rule: "vua.risk-gate/v1"
delivery: "version or unscheduled"
maintainer: "VUA-Project or community identity"
distribution: "core | plugin-package | managed-optional | external-connection"
platforms: ["windows"]
capabilities: ["declared.capability"]
---
```

`delivery` identifies a selected product release version, or `unscheduled` when no release version
is assigned. It is not an N-stage number or acceptance claim. Unreleased entries use
`unscheduled`; their delivery priority and acceptance belong to the [N sequence](../development-outline.md),
where scheduled. Assign a product version only when its inclusion is selected for publication.

Each entry body explains value, classification, included/excluded behavior, data flow,
permissions, failure/degradation, license/redistribution, warnings, acceptance, and removal. Add or
remove one file plus its category README link through an ordinary reviewed Git change. Keep IDs
stable and reserve removed IDs permanently. Supported entries are deprecated before removal when migration
is required.

Schema v3 is a pre-release normalization: v2 `built-in.*` IDs became `core.*`, and `vua-plugin.*`
became `plugin.*`. No v2 entry reached `supported`; the old prefixes are reserved and cannot be reused.

Entry files are data records versioned by the catalog format (`vua.tool-entry/v3` frontmatter).
The category READMEs are plain index pages of the catalog. Entries are written in English, as set
by [documentation governance](../meta/documentation-governance.md#5-language).

## Release risk gate

The release gate derives `risk`. [`vua.risk-gate/v1`](risk-gate-v1.md) is policy text: it defines
how the highest matching level is derived and what evidence each level requires. No automated
check implements it yet — neither `scripts/` nor the CI workflows enforce the gate — so entries
are currently reviewed against the rules by hand: contributors declare complete capabilities and
behavior, reviewers write or verify the highest matching level, and a mismatch fails review.
`pending`, unknown capabilities, or incomplete data cannot enter a supported release.

A catalog entry records classification and evidence. Product boundary, architecture, security
review, distribution review, and release gates respectively authorize scope, implementation,
execution, bundling, and publication. Built-in Core behavior and the community plugin host retain
separate trust boundaries.

---
catalog_schema: "vua.tool-entry/v3"
id: "external.alcom-vcc"
boundary: "external"
status: "experimental"
risk: "medium"
risk_rule: "vua.risk-gate/v1"
delivery: "unscheduled"
maintainer: "external-upstream"
distribution: "external-connection"
platforms: ["windows"]
capabilities: ["external.project-manager.detect", "external.project-manager.open", "external.vpm-registry.read", "external.vpm-settings.write"]
---

# ALCOM / VCC (VRChat Creator Companion)


ALCOM and VCC are independently installed project managers owned by the user, with their
own settings, registries (VCC's `settings.json` / SQLite, ALCOM's `setting.json`), and
project folders. VUA is read-only toward the projects they manage: discovery,
identification, and reading versions/packages/SDKs/compatibility/environment state, plus
diagnostics and guidance. VUA never writes their registries, databases, settings, or
caches, and never installs or removes packages on their behalf; writes are handed over to
the owning manager, or the user explicitly chooses "import as a VUA-managed copy". When
detected locally, VUA can launch ALCOM, VCC, or Unity Hub detached with zero project arguments
through [manager-apps v0.2](../../protocols/manager-apps-v0.2.md) (`environment.openManagerApp`)
so the user can manage external projects in their owning tool without closing VUA affectively
terminating the launched manager.
**Settings-face exception (user ruling U14, 2026-09-19):** the VPM package-management
settings (the repository-subscription and local-package-registry faces of `settings.json`)
are one file shared with VCC/ALCOM; VUA reads and writes that face by ruling, with changes
immediately visible to both sides. All other storage faces such as `vcc.liteDb`, and the
project files themselves, stay denied (authoritative wording in the
[product boundary](../../product-boundary.md#explicit-boundaries) "Explicit boundaries"
section; the exception landed in product boundary 1.4.0, 2026-09-19). The read face and
the settings face have landed in the repository with the proposal 024–027 chain; landing
is not publication — inclusion in a release is selected separately and evaluated
independently of N-stage acceptance. The detection matrix and the
allow/forbidden lists are in the
[ALCOM/VCC project compatibility matrix](../../compatibility/alcom-vcc.md).

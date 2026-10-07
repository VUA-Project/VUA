---
catalog_schema: "vua.tool-entry/v3"
id: "core.environment-detection-and-deployment"
boundary: "core"
status: "experimental"
risk: "medium"
risk_rule: "vua.risk-gate/v1"
delivery: "unscheduled"
maintainer: "VUA-Project"
distribution: "core"
platforms: ["windows"]
capabilities: ["environment.inspect", "environment.plan", "environment.execute.confirmed", "environment.verify", "download.confirmed", "installer.launch.official"]
---

# Environment Detection and Guided Deployment


Detect hardware, Windows, VR runtime, Steam/SteamVR, VRChat, Unity, and production prerequisites,
then provide explainable readiness and official-source guidance. It plans, confirms, executes, and
verifies system actions through Orchestrator, so it is a core module. Inspect first, confirm the
deployment plan, then execute its supported automated steps with visible activity and explicit
handoffs for required user actions. See the [N1 delivery plan](../../development/n1-delivery-plan.md)
for model-first official routes, silent installation, activation and regional connectivity.

Each check has a stable ID, evidence, severity, automated or manual remediation, and verification.
Unknown versions degrade conservatively; sources, licenses, and signatures are auditable.

Unity checks classify the complete version string and distribution. Global `2022.3.22f1` is the
current production target; `2019.4.31f1` and `2022.3.6f1` enter migration guidance; other Unity
versions uniformly report their difference from the production target while VUA leaves project files
unchanged; Tuanjie Engine is reported as currently unsupported. See the
[Unity editor compatibility policy](../../compatibility/unity-editor.md).

Project-manager detection covers read-only ALCOM/VCC discovery, project identification, and the
VPM package declared-face inspection (including VRChat SDK spotting and the pending-mutation
marker); the matrix and the allow/forbidden lists are in the
[ALCOM/VCC project compatibility matrix](../../compatibility/alcom-vcc.md); the external-tool
boundary is in the [ALCOM / VCC entry](../external/alcom-vcc.md). The write capability toward the
original project is always false under the current product boundary; the only write path is the
user-chosen "import as a VUA-managed copy".

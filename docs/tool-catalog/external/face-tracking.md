---
catalog_schema: "vua.tool-entry/v3"
id: "external.face-tracking"
boundary: "external"
status: "experimental"
risk: "medium"
risk_rule: "vua.risk-gate/v1"
delivery: "unscheduled"
maintainer: "external-upstream"
distribution: "external-connection"
platforms: ["windows"]
capabilities: ["external.runtime.discover", "external.runtime.connect"]
---

# Face Tracking


N2 selects [benaclejames/VRCFaceTracking](https://github.com/benaclejames/VRCFaceTracking)
as an independently installed external application. VUA guides official Steam installation,
discovers and launches it, reports observed process status and explains hardware-module/OSC setup.
VRCFT owns modules and tracking; VUA does not vendor, build or bundle its code or binaries.
Unknown status is not a successful face-tracking result. N2 requires actual tracking/OSC evidence.
The [Candidate connection](../../protocols/external-tool-v0.1.md) adds supported-device/app choices
and matching upstream module instructions. Its observed status describes installation and the
application process only; VUA does not yet expose measured face/eye-tracking status. See the
[source checkpoint](../../development/vrcft-integration-plan.md#source-checkpoint-and-pending-acceptance)
for controlled evidence and remaining vendor/hardware acceptance.
The PICO 4 Pro eye-tracking slice is advanced into the
[first play release](../../development-outline.md#first-play-release-acceptance): USB/Wi-Fi gaze
and blinking, headset calibration, module/OSC guidance, microphone coexistence and reconnect.
Use an existing suitable Avatar; automatic Avatar modification is not part of this slice.
No copied sessions, private-database access or VRChat injection. Later diagnostics/configuration
automation need a scoped adapter; no stable third-party status API is assumed. Upstream distribution
and license terms apply; see [third-party notices](../../../THIRD_PARTY_NOTICES.md).

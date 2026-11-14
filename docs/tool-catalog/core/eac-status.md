---
catalog_schema: "vua.tool-entry/v3"
id: "core.eac-status"
boundary: "core"
status: "experimental"
risk: "low"
risk_rule: "vua.risk-gate/v1"
delivery: "unscheduled"
maintainer: "VUA-Project"
distribution: "core"
platforms: ["windows"]
capabilities: ["process.inspect", "service.inspect", "registry.inspect.scoped", "filesystem.inspect.scoped", "log.inspect.scoped"]
---

# EAC Read-Only Status Detection

Inspect Easy Anti-Cheat (EOS) readiness and occupation state on Windows before VRChat launch, after
start or close timeouts, while the EAC diagnostics dialog is open, and before local SDK testing. It
runs inside VUA's owned Environment boundary with no background daemon, no external network calls,
and zero system, service, driver, or file mutations.

Evidence is strictly read-only and scoped: the local process table and visible top-level window
presence, `QueryServiceStatusEx` and `QueryServiceConfigW` on `EasyAntiCheat_EOS` and
`EasyAntiCheat_EOSSys`, `HKCU\Software\Valve\Steam\Apps\438100\Running`, Authenticode verification
of `EasyAntiCheat_EOS_Setup.exe` and the EAC service binary, and fixed-pattern matching over the
tail 256 KiB of the newest VRChat `output_log_*.txt` (retaining only closed finding codes and
timestamps, never raw log text or user paths).

When any source cannot be read, VUA degrades conservatively to `unknown` and links to official
troubleshooting guidance without guessing. Any mutating recovery step (allowlisted residual-process
termination or UAC official repair launch) is separated into
[`core.eac-process-recovery`](eac-process-recovery.md) under `high` risk controls.

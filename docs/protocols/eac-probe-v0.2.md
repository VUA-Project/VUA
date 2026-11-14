# EAC status detection and occupation recovery v0.2

> Document version: 0.2.0
> Status: Candidate
> Updated: 2026-11-14
> Owner: Environment

An additive Candidate family carried by Application Contract v0.1 and Desktop Gateway v1 for
Windows Steam VRChat (`AppID 438100`). Frozen `schemas/eac-probe/v0.1`,
`schemas/eac-allowlist/v0.1`, `schemas/eac-terminate/v0.1`, and Candidate `schemas/play-session/v0.2`
remain unchanged.

## Boundaries

VUA inspects local OS status, closes only VUA-started VRChat sessions via `environment.stopPlay`,
terminates only allowlisted user-mode residual bootstrapper processes under an explicit experimental
opt-in and per-invocation confirmation, and guides or launches the official handle-locked,
Authenticode-verified `EasyAntiCheat_EOS_Setup.exe` via Windows UAC (`runas`).

VUA never stops, deletes, or reconfigures Windows services or kernel drivers (`ControlService`,
`DeleteService`, `ChangeServiceConfig*`, `StartService*`), never modifies or deletes EAC or VRChat
files, never alters `hosts`, firewall rules, registry permissions, or Windows kernel stack
protection, and never references or invokes anti-cheat bypass tools.

## Operations

| Method | Kind | Params (`params`) | Result |
| --- | --- | --- | --- |
| `environment.inspectEac` | `query` | `{ schemaVersion: "0.2" }` | `{ eacSnapshot }` (`vua.eac-probe/v0.2`) |
| `environment.terminateEacResidual` | `command` + `commandId` | `{ schemaVersion: "0.2", pid, created, path, confirmed: true }` | `{ termination, eacSnapshot }` (`vua.eac-terminate/v0.1` + `vua.eac-probe/v0.2`) |
| `environment.launchEacRepair` | `command` + `commandId` | `{ schemaVersion: "0.2", confirmed: true }` | `{ repair, eacSnapshot }` (`vua.eac-repair/v0.2` + `vua.eac-probe/v0.2`) |

No caller-supplied game directory, repair executable path, or log path is accepted on any method.
Electron Main persists the experimental recovery switch (`eac-experimental.json`, default `false`)
and rejects both `environment.terminateEacResidual` and `environment.launchEacRepair` before
forwarding when disabled; Main synchronizes the persisted boolean to the supervised Provider
(including on Provider reconnect) through the internal host-only command
`environment.configureEacExperimental`, which is never routed from the renderer or AI tool catalog.
Official EAC repair performs path-containment, handle-locking, final-path reparse-point refusal,
and Authenticode verification synchronously, then hands UAC (`runas`) elevation off to a background
worker thread (`outcome: "launched"`) so the core Provider frame loop never blocks on UAC or GUI
setup windows; when the worker finishes, its terminal outcome (`completed` with `exitCode`,
`elevation_declined`, `launch_failed`, or `timed_out`) is recorded in `eacSnapshot.lastRepair` so
dialog polling surfaces UAC declines, launch failures, and non-zero exit codes.

## Snapshot (`vua.eac-probe/v0.2`)

- `processes[]`: `{ name, pid, created, kind, path, hasVisibleWindow }`. `created` encodes Windows
  `FILETIME` 100-ns creation ticks as a base-10 string (`^[0-9]{1,20}$`) or `null` so 64-bit values
  survive JSON parsing without IEEE-754 precision loss. `kind` adds `vrchat_launcher`
  (`start_protected_game.exe`, `launch.exe`); `easyanticheat_eos.exe` is classified as
  `eac_service` (`LocalSystem`) and is never a user-mode termination candidate. Launcher/loader
  findings are scoped inside the detected VRChat directory, while `vrchat_game` (`VRChat.exe`)
  matches unconditionally by process name so R4 active-session protection covers secondary or SDK
  test client copies as well.
- `services[]`: exactly two entries in fixed order `["EasyAntiCheat_EOS", "EasyAntiCheat_EOSSys"]`
  with `{ name, present, state, firstObservedAt }`. `EasyAntiCheat_EOSSys` is dynamically registered
  during play and absent (`present: false, state: "stopped"`) when VRChat is cleanly idle.
- `steam`: `{ runningFlag: 0 | 1 | null }` from `HKCU\Software\Valve\Steam\Apps\438100\Running`.
- `install`: `{ eacFolder, setupSignature, serviceBinary }` derived strictly from VUA's own Steam
  VRChat installation discovery and SCM `QueryServiceConfigW`. Authenticode leaf subject checks
  accept `EasyAntiCheat Oy` and `Epic Games, Inc.`.
- `logFindings[]`: `{ code, observedAt }` matched from the last 256 KiB of the newest
  `%USERPROFILE%\AppData\LocalLow\VRChat\VRChat\output_log_*.txt`. Only closed enum codes
  (`launch_error_30005`, `not_installed`, `start_service_1275`, `untrusted_system_file`,
  `connection_lost`) and timestamps cross the boundary; raw lines and file paths are discarded.
- `conclusion`: `ready`, `session_active`, `unloading`, `residual_process`, `steam_stale`,
  `not_installed`, `install_damaged`, or `unknown`.
- `plan[]`: ordered deduplicated subset of `wait_unload`, `stop_vrchat`, `quit_steam`,
  `terminate_residual`, `official_repair`, `restart_pc`. Always empty when `conclusion` is `ready`,
  `session_active`, or `unknown`. Omits `terminate_residual` whenever the experimental switch is
  disabled or no verified allowlisted user-mode candidate is present.
- `terminationCapability`: `{ state: "unavailable" | "disabled" | "available", reason, candidate }`.
- `lastRepair`: `null` or `{ outcome, exitCode, updatedAt }`, reporting the most recent official
  repair attempt in this Provider session (`launched`, `completed`, `elevation_declined`,
  `reparse_point_refused`, `verification_failed`, `active_session_refused`, `not_found`,
  `launch_failed`, or `timed_out`).

## Sources and implementation

- [Snapshot schema](../../schemas/eac-probe/v0.2/probe.schema.json),
  [repair receipt schema](../../schemas/eac-probe/v0.2/repair.schema.json),
  [fixtures](../../schemas/eac-probe/v0.2/fixtures/),
  [vectors](../../schemas/eac-probe/v0.2/vectors.json)
- [Read-only catalog entry](../tool-catalog/core/eac-status.md),
  [high-risk recovery catalog entry](../tool-catalog/core/eac-process-recovery.md)
- [TypeScript types and guards](../../packages/contracts/src/eac-probe-v02.ts)

## Document changelog

- 0.2.0 (2026-11-14): introduce `eac-probe v0.2` snapshot, residual termination wiring, and
  handle-locked official EAC repair launch receipt as a Candidate family.

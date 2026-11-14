# Pose source and device graph v0.1

> Document version: 0.1.0
> Status: Candidate
> Owner: Environment
> Updated: 2026-11-14
> Schemas: [request](../../schemas/pose-graph/v0.1/request.schema.json), [snapshot](../../schemas/pose-graph/v0.1/snapshot.schema.json), [vectors](../../schemas/pose-graph/v0.1/vectors.json)

This Candidate face aggregates local pose-tracking runtimes, SteamVR external drivers, Safe Mode
driver blocks, and companion pose processes (`Space Calibrator`, `SlimeVR`, `PICO Connect`,
`mocopi`, `HaritoraX`, `Rebocap`, `VRCFaceTracking`) into a single privacy-safe read-only snapshot
(`environment.observePoseGraph`). It belongs to the Host (`Environment`) provider and remains
available whether or not the AMF module is enabled.

## Scope and honesty invariants

1. **Read-only local observation**: inspects the Windows OpenXR active runtime registry value,
   `openvrpaths.vrpath` `external_drivers` registrations plus each driver folder's
   `driver.vrdrivermanifest` `name` (`<= 64 KiB`, non-symlink), `steamvr.vrsettings` `LastKnown`
   headset hints and `driver_*.blocked_by_safe_mode` flags, local tool installations (`libraryfolders.vdf`
   reads bounded to `<= 64 KiB`, non-symlink), and OS process basenames in a single `Toolhelp32`
   snapshot pass without opening foreign process memory.
2. **Privacy-safe projections**:
   - OpenXR runtime names and headset hints are trimmed display labels (`<= 80` UTF-16 code units)
     stripped of filesystem paths; raw manifest paths and user account directories never cross the
     wire.
   - `steamvrDrivers` and `blockedSteamvrDrivers` emit only recognized closed driver IDs
     (`space_calibrator`, `slimevr`, `alvr`, `virtual_desktop`, `lighthouse`, `mocopi`,
     `haritorax`, `rebocap`), never unknown third-party folder names.

## Operation

| Method | Kind | Params | Result |
| --- | --- | --- | --- |
| `environment.observePoseGraph` | query | `{ schemaVersion: "0.1" }` | `{ poseGraph }` |

## Closed vocabularies (`0.1.0`)

- `fbtDriverConflictRisk`:
  - `none` — zero or one unblocked external OpenVR full-body tracking driver registered in `steamvrDrivers`
  - `multiple_openvr_fbt_drivers` — two or more unblocked external OpenVR full-body tracking drivers among `slimevr`, `mocopi`, `haritorax` and `rebocap` are simultaneously registered, risking virtual tracker slot contention
- `poseSources[].sourceId` (emitted in canonical order, 9 items):
  - `headset_6dof` — HMD / OpenXR / SteamVR 6DoF head & hand pose
  - `slimevr` — SlimeVR IMU full-body tracking server / SteamVR driver
  - `pico_motion` — PICO Connect PCVR streaming & PICO Motion Tracker bridge
  - `lighthouse` — SteamVR Lighthouse optical base-station ecosystem
  - `space_calibrator` — OpenVR Space Calibrator multi-tracking-space alignment
  - `mocopi` — Sony mocopi companion / OpenVR receiver
  - `haritorax` — Shiftall HaritoraX configurator / VR bridge
  - `rebocap` — Rebocap full-body tracking companion / driver
  - `eye_face_osc` — VRCFaceTracking eye & expression OSC bridge
- `poseSources[].state`: `active | ready | installed | not_detected` (`detailCode: "blocked_by_safe_mode"` surfaces silent SteamVR Safe Mode blocks)
- `steamvrDrivers[]` / `blockedSteamvrDrivers[]`:
  - `space_calibrator`, `slimevr`, `alvr`, `virtual_desktop`, `lighthouse`, `mocopi`, `haritorax`, `rebocap`

## Document changelog

- 0.1.0 (2026-11-14): introduce Host-owned unified pose source & device graph observation (`openxr`, `steamvrDrivers`, `blockedSteamvrDrivers`, `fbtDriverConflictRisk`, `lastHeadsetHint`, and 9 canonical `poseSources`).

# Local multi-layer diagnostics and guarded client helpers v0.1

> Document version: 0.1.0
> Status: Candidate
> Owner: Environment
> Updated: 2026-11-14
> Schemas: [request](../../schemas/local-diagnostics/v0.1/request.schema.json), [snapshot](../../schemas/local-diagnostics/v0.1/snapshot.schema.json), [symptom-diagnosis](../../schemas/local-diagnostics/v0.1/symptom-diagnosis.schema.json), [osc-cache-clear-receipt](../../schemas/local-diagnostics/v0.1/osc-cache-clear-receipt.schema.json), [client-config-update-receipt](../../schemas/local-diagnostics/v0.1/client-config-update-receipt.schema.json), [vectors](../../schemas/local-diagnostics/v0.1/vectors.json)

This Candidate face observes local desktop VR runtime, OSC + OSCQuery loopback, Windows default
audio endpoint hygiene, PCVR streaming settings, cache, SteamVR configuration and privacy-safe log
failure signatures, joins those live facts into deterministic multi-layer symptom-to-SOP diagnoses,
and offers two guarded offline helpers (`diagnostics.clearOscAvatarCache` and
`diagnostics.updateClientConfig`). It belongs to the Host (`Environment`) provider and remains
available whether or not the AMF module is enabled.

## Safety and privacy invariants

1. **Zero game-process attachment or EAC contact**: process checks use read-only OS process table
   snapshots (`Toolhelp32` on Windows) without opening game memory or handles for injection.
2. **Zero UDP/TCP port seizure**: UDP `9000` (client OSC input) and `9001` (client OSC output) are
   inspected strictly through the OS UDP owner table (`GetExtendedUdpTable` `AF_INET`,
   `UDP_TABLE_OWNER_PID`). OSCQuery loopback discovery inspects read-only TCP `127.0.0.1` listeners
   (`GetExtendedTcpTable` `AF_INET`, `TCP_TABLE_OWNER_PID_LISTENER`) owned by known local VR/OSC
   processes (`vrchat.exe`, `vrcfacetracking.exe`, `slimevr.exe`) with a bounded
   `120 ms`, `<= 64 KiB` `GET /?HOST_INFO` read. VUA never binds a listener on `9000`, `9001` or
   any OSCQuery port.
3. **Privacy-safe projections**:
   - OSC cache inspection emits file count, total byte size and newest modification timestamp only;
     `usr_*` and `avtr_*` identifiers are never exported.
   - UDP port owners emit PID and lowercased executable basename only, never full user paths.
   - Windows audio endpoint inspection (`HKCU\Software\Microsoft\Multimedia\Sound Mapper`) projects
     only boolean flags and a closed `virtualMicFamily` enum (`voicemeeter`, `vb_cable`,
     `virtual_audio_cable`, `steam_streaming_mic`, `oculus_virtual`, `sonobus`) — raw microphone or
     speaker friendly names never cross the contract boundary.
   - PCVR streaming inspection reads numeric `HKCU\Software\Oculus\RemoteHeadset` Quest Link limits
     (`EncodeWidth`, `BitrateMbps`, `DBR`, `LinkSharpening`) and non-symlink PICO Connect settings
     presence only, without exporting account tokens or file paths.
   - Windows GPU & playspace tuning inspection (`systemTuning`) reads `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers\HwSchMode`
     (`hardwareGpuScheduling: boolean | null`), classifies `HKLM\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes\ActivePowerScheme`
     into a closed `powerPlanRole` enum (`power_saver | balanced | high_or_ultimate | custom | unknown` — raw custom power-scheme GUIDs never cross the wire),
     and checks Steam library folders (`appmanifest_1009850.acf` / `OVR_AdvancedSettings/AdvancedSettings.exe`) for `ovrAdvancedSettingsInstalled: boolean`.
   - Client log inspection reads at most the trailing `128 KiB` of the newest `output_log_*.txt`
     and emits only a closed classification enum plus modification timestamp — raw log lines, world
     IDs (`wrld_*`), user IDs (`usr_*`) and local paths never cross the contract boundary.
4. **Fail-closed offline helpers**: `diagnostics.clearOscAvatarCache` and
   `diagnostics.updateClientConfig` refuse with `vua.diagnostics.client_running` whenever
   `VRChat.exe` is running or process liveness cannot be verified.

## Operations

| Method | Kind | Params | Result |
| --- | --- | --- | --- |
| `diagnostics.observeLocal` | query | `{ schemaVersion: "0.1" }` | `{ localDiagnostics }` |
| `diagnostics.diagnoseSymptom` | query | `{ schemaVersion: "0.1", symptom }` | `{ symptomDiagnosis }` |
| `diagnostics.clearOscAvatarCache` | command | `{ schemaVersion: "0.1" }` | `{ oscCacheClearReceipt }` |
| `diagnostics.updateClientConfig` | command | `{ schemaVersion: "0.1", cacheSizeGb?, cacheExpiryDelayDays? }` | `{ clientConfigReceipt }` |

Commands carry a closed `commandId` (`1..=128` ASCII `[A-Za-z0-9_.:-]+`) at the Application Contract
`0.1` envelope level; Desktop Gateway moves `commandId` from IPC params without changing identity.
Replaying an admitted command ID with identical parameters returns the recorded receipt without
repeating filesystem writes; replaying the same command ID with different parameters fails with
`vua.diagnostics.invalid_command`. The process-local admission ledger retains up to 256 commands.

## Closed vocabularies

- `symptom`:
  - `audio_silent_or_wrong_mic`
  - `osc_or_face_tracking_not_responding`
  - `low_fps_or_vram_pressure`
  - `disk_cache_full`
  - `crash_or_eac_block`
  - `avatar_hidden_or_grey_robot`
  - `cannot_upload_avatar`
  - `streaming_blurry_or_compression`
  - `playspace_drag_or_height_offset`
  - `fbt_drift_or_calibration`
- `systemTuning.powerPlanRole`:
  - `power_saver`, `balanced`, `high_or_ultimate`, `custom`, `unknown`
- `recentClientLog.classification`:
  - `no_logs`, `clean_or_inconclusive`, `eac_launch_violation`, `disk_full_write_error`,
    `d3d11_device_lost_or_oom`, `osc_socket_conflict`, `openvr_init_failed`, `read_failed`
- `findings[].code`:
  - `osc_port_9000_unbound_while_client_running`
  - `osc_port_9000_conflict`
  - `osc_port_9001_unbound`
  - `osc_avatar_cache_present`
  - `oscquery_port_mismatch`
  - `audio_virtual_mic_hijack_detected`
  - `audio_communications_default_mismatch`
  - `streaming_high_bitrate_or_encode_width`
  - `streaming_low_bitrate_or_sharpening_off`
  - `windows_hags_enabled_vr_stutter_risk`
  - `windows_power_saver_active`
  - `ovr_advanced_settings_installed_offset_check`
  - `steamvr_driver_blocked_by_safe_mode`
  - `steamvr_high_supersampling`
  - `steamvr_app_overscaled`
  - `client_cache_near_limit`
  - `drive_free_space_low`
  - `client_config_malformed`
  - `log_eac_violation_detected`
  - `log_disk_full_detected`
  - `log_d3d11_crash_detected`
  - `log_osc_conflict_detected`
  - `log_openvr_init_failed`
- `layer`:
  - `hardware_os`, `steamvr_openxr`, `companion_osc`, `client_config_cache`, `avatar_sdk`

## Guarded helper rules

- `diagnostics.clearOscAvatarCache` walks `VRChat/VRChat/OSC/usr_*/Avatars` under `local_low`,
  skips symlinks and reparse points, removes regular `.json` files only, and returns
  `{ removedFileCount, freedBytes, clearedAt }`.
- `diagnostics.updateClientConfig` requires at least one of `cacheSizeGb` (`30..=200` integer) or
  `cacheExpiryDelayDays` (`30..=365` integer). If `VRChat/VRChat/config.json` exists and is not a
  JSON object, it fails with `vua.diagnostics.config_malformed` without modifying the file.
  Otherwise it preserves all existing JSON properties, writes `config.json.vua.bak` when updating
  an existing file, syncs a sibling temporary file to disk, and atomically renames it into place.

## Document changelog

- 0.1.0 (2026-11-14): introduce Host-owned local multi-layer observation (`vrchatRunning`, `osc` + OSCQuery loopback, `audioEndpoints`, `streamingSettings`, `systemTuning`, `cache`, `steamvr`, `recentClientLog`), deterministic symptom-to-SOP diagnosis, and guarded offline OSC/config helpers.

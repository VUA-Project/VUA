# External tool connection v0.2

> Document version: 0.1.2
> Status: Candidate
> Owner: Environment
> Updated: 2026-10-14
> Schemas: [request](../../schemas/external-tool/v0.2/request.schema.json), [result](../../schemas/external-tool/v0.2/result.schema.json), [vectors](../../schemas/external-tool/v0.2/vectors.json)

This N2 face connects six fixed official Steam applications. It supersedes
[external tool connection v0.1](external-tool-v0.1.md): snapshots carrying
`schemaVersion: "vua.external-tool/v0.1"` are no longer accepted; producers and consumers
use `vua.external-tool/v0.2`. It runs on the host with AMF disabled. It does not define a
plugin SDK or accept arbitrary app IDs, executables, arguments, URLs, hardware settings or
module packages from Renderer.

| toolId | Application / official distribution | Steam App ID | installdir | Main executable | N2 table note |
| --- | --- | --- | --- | --- | --- |
| `vrcft` | VRCFaceTracking | 3329480 | VRCFaceTracking | VRCFaceTracking.exe | — |
| `space` | hyblocker OpenVR Space Calibrator | 3368750 | 01spacecalibrator | SpaceCalibrator.exe | — |
| `advanced` | OVR Advanced Settings | 1009850 | OVR_AdvancedSettings | AdvancedSettings.exe | paid Steam distribution |
| `toolkit` | OVR Toolkit | 1068820 | OVR Toolkit | Launcher/OVR Toolkit Launcher.exe | paid Steam application; the current entry point is the Launcher subdirectory (real-machine verified 2026-10-14) |
| `oyasumi` | OyasumiVR | 2538150 | OyasumiVR | OyasumiVR.exe | free Steam application; Steam launch observed only while SteamVR is stopped — with SteamVR running, both `steam://run` and `-applaunch` are silently ignored (real-machine verified 2026-10-14, build v25.6.12-STEAM_CN) |
| `translator` | OVR Overlay Translator | 4304620 | OVR Overlay Translator | OVR-Overlay-Translator.exe | paid Steam application; auto-starts with SteamVR as a registered overlay, so a pre-existing unowned instance is expected while SteamVR runs (real-machine verified 2026-10-14) |

Store-access notes mirror the [N2 tool table](../development-outline.md); show the current
store offer rather than relying on this table for pricing. VRCS and LIV from that table are
not part of this face; requests naming any other identifier are rejected.

| Method | Kind | Params | Result |
| --- | --- | --- | --- |
| `tools.observeConnection` | query | `{ toolId }` | `{ toolConnection }` |
| `tools.actConnection` | command | `{ toolId, action }` | `{ toolConnection }` |

`toolId` is one of the six fixed identifiers above. Requests use Application Contract `0.1`.
Commands additionally carry a closed `commandId` at envelope level; Desktop Gateway moves it
from IPC params without changing the identity. Actions are `install`, `start`, `stop` and
`cancel`. Replaying an admitted command ID with the same action returns current facts without
redispatch; a different action is rejected. The process-local admission ledger is bounded to
256 commands and does not persist across restart.

`toolConnection` contains `schemaVersion: "vua.external-tool/v0.2"`, `toolId`, `capturedAt`,
`presence`, `steamReady`, nullable numeric `buildId`, `running`, `canStop`, `activity` and
nullable `issue`. The schemas own exact fields and enums. `installed` requires a matching
completed Steam manifest and a nonempty Windows executable header in a configured library.
Missing, partial and unreadable findings remain distinct. This is installation evidence, not
publisher signature, module installation, connected hardware, tracking or OSC success.

Install hands off to Steam through `steam.exe -url steam://install/<appid>` and waits for
actual installation. Start hands off through `steam.exe -url steam://run/<appid>` and observes
the tool's matching executable for at most 60 seconds. Duplicate
pending clicks do not dispatch. Stop requests normal window close only for a new matching
process observed after this service's launch, rechecking PID, creation time and path.
Pre-existing instances and Steam are never closed. A normal manual exit clears that lease;
PID reuse cannot transfer authority. Close waits at most eight seconds, then retains the
instance and offers upstream manual exit. No force termination is exposed.

Cancel stops observing an install/start handoff; Steam's own download/startup continues. A
late process is not adopted after cancel/timeout. Restart reports fresh facts without
reclaiming ownership. External Steam/tool handoffs use the host-only explicit breakaway
described in [Provider lifecycle baseline 0.3](provider-process-v0.1.md#boundary-and-artifact);
managed workers and AMF retain containment. A failed breakaway fails the handoff rather than
falling back to an application that would be killed with the provider.

Hardware/connection selection and manually confirmed SOP progress stay in local UI state.
VRCFT owns hardware modules and OSC. Its process is not evidence of a module receiving data;
the [N2 tracking cases](../development-outline.md#tracking-specific-acceptance) require
hardware. The Rust wire test and TypeScript guards consume the same positive and negative
vectors.

## Document changelog

- 0.1.2 (2026-10-14): record real-machine launch facts for oyasumi (Steam handoff accepted only while SteamVR is stopped) and translator (auto-starts with SteamVR) in the tool table; schemas and vectors are unchanged.
- 0.1.1 (2026-10-14): correct the toolkit main executable to `Launcher/OVR Toolkit Launcher.exe` and name the actual handoff verbs (`-url steam://install/<appid>` for install, `-url steam://run/<appid>` for start) after real-machine verification; request/result schemas and vectors are unchanged.
- 0.1.0 (2026-10-14): widen the fixed connection set from VRCFaceTracking to six Steam tools and pin snapshots to `vua.external-tool/v0.2`, superseding v0.1; fixed-directory, closed-envelope and owned-instance semantics are unchanged.

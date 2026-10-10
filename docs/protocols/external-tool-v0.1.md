# External tool connection v0.1

> Document version: 0.1
> Status: Candidate
> Owner: Environment
> Updated: 2026-10-10
> Schemas: [request](../../schemas/external-tool/v0.1/request.schema.json), [result](../../schemas/external-tool/v0.1/result.schema.json), [vectors](../../schemas/external-tool/v0.1/vectors.json)

This first N2 face connects the fixed official Steam application **VRCFaceTracking** (`3329480`).
It runs on the host with AMF disabled. It does not define a plugin SDK or accept arbitrary app IDs,
executables, arguments, URLs, hardware settings or module packages from Renderer.

| Method | Kind | Params | Result |
| --- | --- | --- | --- |
| `tools.observeConnection` | query | `{ toolId: "vrcft" }` | `{ toolConnection }` |
| `tools.actConnection` | command | `{ toolId: "vrcft", action }` | `{ toolConnection }` |

Requests use Application Contract `0.1`. Commands additionally carry a closed `commandId`
at envelope level; Desktop Gateway moves it from IPC params without changing the identity.
Actions are `install`, `start`, `stop` and `cancel`. Replaying an admitted command ID with the
same action returns current facts without redispatch; a different action is rejected. The
process-local admission ledger is bounded to 256 commands and does not persist across restart.

`toolConnection` contains `schemaVersion: "vua.external-tool/v0.1"`, `toolId`, `capturedAt`,
`presence`, `steamReady`, nullable numeric `buildId`, `running`, `canStop`, `activity` and nullable
`issue`. The schemas own exact fields and enums. `installed` requires a matching completed Steam
manifest and a nonempty Windows executable header in a configured library. Missing, partial and
unreadable findings remain distinct. This is installation evidence, not publisher signature,
module installation, connected hardware, tracking or OSC success.

Install hands off to Steam and waits for actual installation. Start hands off through Steam's
app launch and observes the matching executable for at most 60 seconds. Duplicate pending clicks
do not dispatch. Stop requests normal window close only for a new matching process observed after
this service's launch, rechecking PID, creation time and path. Pre-existing instances and Steam
are never closed. A normal manual exit clears that lease; PID reuse cannot transfer authority.
Close waits at most eight seconds, then retains the instance and offers upstream manual exit.
No force termination is exposed.

Cancel stops observing an install/start handoff; Steam's own download/startup continues. A late
process is not adopted after cancel/timeout. Restart reports fresh facts without reclaiming
ownership. External Steam/VRCFT handoffs use the host-only explicit breakaway described in
[Provider lifecycle baseline 0.3](provider-process-v0.1.md#boundary-and-artifact); managed workers
and AMF retain containment. A failed breakaway fails the handoff rather than falling back to an
application that would be killed with the provider.

Hardware/connection selection and manually confirmed SOP progress stay in local UI state.
VRCFT owns hardware modules and OSC. Its process is not evidence of a module receiving data;
the [N2 tracking cases](../development-outline.md#tracking-specific-acceptance) require hardware.
The Rust wire test and TypeScript guards consume the same positive and negative vectors.

## Document changelog

- 0.1 (2026-10-10): add fixed VRCFT inspection, Steam handoff and bounded owned-instance lifecycle, independently of AMF and upstream hardware modules.

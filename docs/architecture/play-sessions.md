# Play environment sessions

> Document version: 1.0.0
> Status: Candidate
> Updated: 2026-10-09
> Scope: Desktop/PICO software launch and card-scoped close; play-session v0.1

The Play page has fixed environment cards. Their left half opens details; their right half
reports observed readiness and the current action. Installation remains the reviewed
[deployment plan](unity-deployment.md), with its existing installer consent and receipts.
Network diagnostics do not grant software readiness. A running process does not prove headset
connection, account login, or entry into a VRChat world.

## Closed software sessions

`environment.observePlay` is a read-only query for `desktop_play` or `pico_pcvr`.
`environment.startPlay` and `environment.stopPlay` are explicit commands with an idempotency
key. The Candidate family lives in `schemas/play-session/v0.1/`; requests never accept a path,
executable, shell command or arbitrary launch argument. The Renderer uses the typed Gateway.
The project-manager adapter resolves executable paths from the existing narrow environment
probe, verifies the required files, and owns OS interactions. Provider-host only maps the wire.

Desktop needs Steam and VRChat. PICO additionally needs PICO Connect and SteamVR. Launch is
sequential: reuse an observed existing application, otherwise open the approved executable or
ask Steam to launch the fixed app ID. Steam owns authentication, game updates, and its launch
handoff. The desktop request uses VRChat's documented `--no-vr`; PICO leaves VR selection to
the official Steam/SteamVR path. Vendor prompts remain visible to the user. Startup stays
pending until the expected processes are observed; failure or timeout is a recoverable result.
The process observation is scoped to the selected route's component names: an unreadable
unrelated VR application cannot block the Desktop route. An unreadable required application
remains an unavailable observation and grants no launch/closing authority.

Only one card may own an active launch session because both routes share the same VRChat
instance. Stop cancels further VUA launch steps, then sends a normal window-close request to
the observed processes that first appeared during this session. Software present before the
click is always retained. Identity combines PID, creation time and the resolved executable
path, and is rechecked immediately before each close request. No force termination, global
vendor shutdown, service/driver stop, window hook, or client modification is used.

A close request is not proof of exit. Surviving applications are reported after the bounded
wait and left running; ownership is released, so another route can reuse them. A Steam launch
already handed to Steam cannot be recalled by VUA; if login or a vendor prompt leaves a queued
launch, the user completes or cancels it there. Provider restart discards ownership and treats
all existing processes as pre-existing. It never reconstructs closing authority from disk.
Idempotency is bounded to the live provider and duplicate command IDs never repeat an action.
Every asynchronous worker is bound to the specific start identity; an older cancelled worker
cannot act on a later session of the same route.
The close window also observes a submitted handoff that appears just after Stop; an outstanding
handoff receives `close_pending` rather than a fabricated successful exit.

## Creator inventory

`environment.inspectManagerApps` is a separate, closed read-only Candidate query with empty
params (`schemas/manager-apps/v0.1/`). It reports one executable finding each for Unity Hub,
VCC and ALCOM. Hub reuses the narrow environment probe. The other managers use their usual
LocalAppData/ProgramFiles product directories and known App Paths/Uninstall registry values;
paths must resolve to a file. Nothing is installed, started, configured or registered by this
query. A missing finding means not found in those locations, not proof of absence everywhere.

The frozen `project.environmentManagers` query separately supplies configuration records and
editor directory candidates. The typed creator port verifies each editor candidate through
`environment.verifyEditor` before rendering an installed version. A failed query remains unknown;
an unsupported but complete editor is displayed without gaining production compatibility.
Unity 6 stays a development peer. This inventory never modifies ALCOM/VCC projects, databases,
settings or package registrations; their existing [compatibility boundary](../compatibility/alcom-vcc.md)
continues to apply.

## Evidence

Synthetic process fixtures exercise reuse, identity replacement, startup/close failures,
pending cancellation, same-route replacement and route contention. Schema vectors pin the closed requests and result
shape. UI fixtures exercise missing, installed, pending, running and unavailable states.
These checks are not vendor or headset acceptance. Real Steam/PICO launch/close, missing
software installation, and PICO USB/Wi-Fi remain author-run hardware checks before ibis.

OS/launch references: [VRChat launch options](https://docs.vrchat.com/docs/launch-options),
[Steam command-line options](https://developer.valvesoftware.com/wiki/Command_line_options),
[WM_CLOSE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-close),
[GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes).

## Document changelog

- 1.0.0 (2026-10-09): define the Candidate play-session scope, observed readiness, session-specific workers, borrowed-process retention, bounded normal close and separate creator executable inventory.

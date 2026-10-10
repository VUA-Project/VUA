# Core, plugin, external integration, and overlay architecture


> Document version: 1.7.0
> Status: Accepted
> Scope: Environment deployment, project management, integrated runtimes, plugin host, desktop/VR overlays
> Updated: 2026-10-10
> Last conformance review: 2026-10-10 (VRCFT connection/source review; physical tracking pending)
> Normative effect: Yes

## Trust classes

Classification follows data contact and authority. Environment, tracking, optimization,
accessibility, and appearance appear as natural-language purpose descriptions in each entry.

| Class | Runs/exists | VUA access | Failure containment |
| --- | --- | --- | --- |
| Core | Trusted product behavior built directly into VUA | Internal application services through owned use cases and ports | The capability rejects or degrades; durable work remains recoverable |
| Plugin | Separate community extension host defined by a public versioned capability protocol | Explicit grants define its complete authority | Failure is contained to the plugin and its granted task |
| External | Independent application, Unity package, runtime, or device service | Retains independent authority; a VUA-side adapter is separately Core or Plugin | External capability degrades and preserves a manual path |

Kernel and local UI are stable host surfaces. Core catalog entries use owned application contracts
for database and private-state access; catalog classification does not create a runtime module system.
The [tool catalog](../tool-catalog/README.md) stores classification
and evidence; the owning reviews authorize scope, protocol, trust, distribution, and execution.

## Unified adapter model

External tools connect through replaceable adapters behind domain ports. Every integration records its
upstream and license, user problem and capabilities, discovery, managed/external modes, supported
versions and data boundary, lifecycle ownership, permissions/credentials/logs, and degradation/manual
path. Prefer official APIs, CLIs, OSC, configuration, and import/export formats. Do not depend on
unauthorized private databases, copied sessions, reflected internals, or UI automation presented as a
stable interface.

## External-integration modes

- **Optional managed:** when licensing permits, VUA uses official distribution, verifies, installs,
  updates, launches, and monitors the component.
- **External connection:** VUA discovers the user's independent installation and connects through a
  public boundary without taking over accounts or private state.

Each mode reports capabilities independently. Recipes, local projects, and recovery retain native
paths across external capability changes. The 2026-09-28 product ruling brings gameplay-tool setup
into the active real-machine progression without changing these adapter or security boundaries.
N2 uses **external connection only** for the
[accepted Steam inventory](../development-outline.md#n2-external-gameplay-tools). Official
Steam/upstream installations own purchases, library addition, downloads, updates, modules,
drivers and removal. VUA supplies native discovery/install/launch entries. The development
sequence owns the list, the first-play PICO eye-tracking slice and each application's acceptance.

Implement a shared Steam adapter with per-app metadata (stable ID, Steam App ID, purpose,
official store entry and observed executable/process identification). Reuse Steam library
discovery and installation evidence; inspect all configured libraries and report incomplete or
unreadable installations distinctly. Account ownership of an uninstalled app remains unknown;
Steam handles that decision when the user follows the purchase/install entry. VUA reads no
account-wide ownership database or credentials for this feature.

An install or launch request enters a pending state until observation confirms its result; an
accepted URI is not proof of a running app. Route fixed, registered App IDs through the trusted
launcher and report unavailable Steam/SteamVR prerequisites. Metadata describes capabilities;
avoid one separate workflow engine per tool. Versions and executable details come from the
installed distribution, not guessed filenames presented as verified support.

The Orchestrator coordinates discovery, installation handoff, launch and reinspection through
small ports; local/Steam adapters return observed install/process facts and unsupported/unknown
outcomes. Do not expose vendor types to React. Unlike supervised VUA Providers, a launched upstream
application is not a VUA-owned process tree to terminate on cancellation or shutdown. Canceling a
guide stops VUA's work; stopping/updating/removing the external tool uses its supported user route.

VRCFT owns device modules, tracking and its OSC output. Space Calibrator owns device selection,
sampling, transforms and calibration UI. First adapters do not consume Space Calibrator's internal
overlay/driver IPC or automatically rewrite either tool's private settings. Documented status/log
diagnostics can be added later when a concrete need exists; unknown never means configured or working.

The first [VRCFT connection](../protocols/external-tool-v0.1.md) is a closed Candidate face for
the official Steam application. Its device picker lists supported choices rather than detected
hardware; the connection/app choice determines the upstream module. Module installation stays
in VRCFT's own registry/package UI. Normal close requests require a newly observed matching
instance's PID, creation time and executable path; pre-existing instances and Steam are retained.
The [host lifecycle exception](../protocols/provider-process-v0.1.md#boundary-and-artifact) explicitly
separates this external launch from managed workers, so provider exit is not an external-app stop.
The [connection checkpoint](../development/vrcft-integration-plan.md#source-checkpoint-and-pending-acceptance)
records tested boundaries and remaining vendor/hardware evidence.

OVR Overlay Translator, OVR Advanced Settings, OVR Toolkit, OyasumiVR and LIV use the shared
connection only. Upstream owns translation, desktop capture, sleep automation, recording and
their configuration; no individual tutorial or internal-feature automation is required. LIV
is a capture/streaming application entry, not an SDK embedded into VRChat. External apps keep
their accounts, API keys and optional VRChat integrations; VUA does not collect or forward them.

Project-management, AMF-source, and overlay adapters
use the same inward dependency direction but retain their own product ownership.

## Environment mutation and EAC recovery

Environment tools start with read-only inspection and return evidence, readiness, and a manual path.
Downloads, installer launches, writes, elevation, and process actions are explicit planned steps with
user confirmation and post-action verification.

EAC conflict detection is read-only by default. Terminating an EAC- or VRChat-related residual
process is a disabled-by-default, experimental, high-risk last resort with an account-anomaly warning
and confirmation on every execution. It is limited to allowlisted user-mode residual processes after
verifying and displaying name, PID, path, signer/publisher, and reason; it refuses while gameplay is
active. It never stops services or kernel drivers, changes EAC/VRChat files or configuration,
injects/hooks/hides processes, bypasses anti-cheat, or exposes termination to web content, overlays,
or plugins. Unknown evidence permits diagnosis only.

## Community plugin host

Community plugins use a versioned protocol. Manifests declare identity, version, entry point, compatibility,
and capabilities. The host owns lifecycle, timeout, cancellation, resource budgets, logs, and
permissions. Plugins never directly access application SQLite, BDL, Electron sessions/cookies,
private types, or Unity objects. Sensitive capability is granted individually and denied by default.
Unknown protocol or insufficient capability rejects loading. There is initially no hosted marketplace
or automatic execution of unknown plugins. Plugins run in the separate community host with the
authority granted by their manifest. Process, Wasm, or trusted-native execution requires a separate security ADR.

Future VUA-hosted extensions for sleep brightness, UI translation, voice changing and skins belong
here only when they can remain capability-bounded and independently removable. The selected N2
applications above remain external connections and do not require this community host. A
catalog entry records its classification and evidence; release review grants distribution and trust.

Catalog authors declare capabilities and behavior, not their own risk conclusion. Before release,
`vua.risk-gate/v1` derives the highest applicable level, rejects unknown or incomplete capabilities,
and applies the corresponding warning, confirmation, refusal tests, and security approval.

## Three project-management paths

| Path | VUA responsibility | Compatibility target |
| --- | --- | --- |
| VUA package manager | Maintain the complete native `vrc-get`-based path | VUA-created and managed projects |
| ALCOM project compatibility | Read and manage where demonstrated safe | ALCOM-managed projects, not the ALCOM app |
| VCC project compatibility | Use public project formats and supported boundaries | VCC-managed projects, not private VCC internals |

All paths detect format, version, locks, and capability before writing. Discovery alone is never
described as complete compatibility; unsafe writes become read-only, conversion advice, or handoff.

## Overlay boundary

Task/runtime status overlays consume versioned display snapshots and return semantic actions.
The application core owns task and business state; local guide progress has its own state.

The first play release uses the three contexts in [guidance architecture](guidance.md): an
in-app VUA tour, a normal preparation reader and a guide associated with the Windows VRChat
window. Reuse A/B content and navigation while separating presentation/lifecycle. Main observes
ordinary Windows window state for game following through the Provider's read-only
`environment.observeGameWindow` query (`vua.game-window-observe/v0.1`); it does not interact
with game internals.
Validate the preparation reader through SteamVR's desktop view on PICO. A native VR overlay
remains subsequent work; the design below constrains that later implementation and adds no N2 tool.

The first native VR overlay path, after the first play release, is a separately built, explicitly started
SteamVR Dashboard helper using public `IVROverlay`. It receives display snapshots and returns actions
such as `next`, `back`, `dismiss`, and `open_on_desktop`; receives no assets, projects, credentials, or
general file capability; and uses bounded messages, version handshake, current-user restriction, and
process supervision. Unsupported runtime falls back to desktop.

Overlays never inject into VRChat, hook graphics/OpenXR, install VRChat-affecting API layers, inspect
VRChat process memory, modify EAC, or confirm account, safety, or upload UI. Public OSC input is
untrusted and cannot authorize local mutation.

## Document changelog

- 1.7.0 (2026-10-10): connect the fixed Candidate VRCFT adapter, supported-device/module selection and scoped normal close; link the versioned host-only external lifetime exception and pending physical acceptance.
- 1.6.0 (2026-10-08): record the implemented read-only game-window observation (game-window-observe v0.1) that backs Main's game-guide following.
- 1.5.0 (2026-10-05): separate local guide progress from task snapshots and route three first-play guidance contexts to their owning architecture.
- 1.4.0 (2026-10-03): define the shared Steam adapter for the expanded N2 inventory, local installation semantics and limited upstream-app lifecycle responsibilities.
- 1.3.0 (2026-10-03): include lightweight desktop guidance and headset desktop-view validation in the first play release; retain native VR overlay as later work.
- 1.2.1 (2026-09-30): state Steam library/install guidance and external invocation directly.

- 1.2.0 (2026-09-30): define thin N2 external connectors and upstream-owned lifecycle.

- 1.1.0 (2026-09-28): align external tool scheduling with the real-machine-first product ruling.

- 1.0.0 (2026-09-06): entered version management; added the scope-ruling note to the overlay
  boundary section (VR overlay removed from `1.0.0`, pointing to product boundary item 7 and the
  development outline v1.1 outlook); header normalized.

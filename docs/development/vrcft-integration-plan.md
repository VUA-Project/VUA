# VRCFaceTracking connection slice

> Document version: 1.1.0
> Status: Accepted
> Scope: Small N2 connection checkpoint; physical tracking acceptance remains pending
> Updated: 2026-10-10

The user outcome is: from **Tools → Face tracking**, prepare and launch VRCFaceTracking,
then follow a short SOP until gaze/blinking actually works in VRChat. This optional play
scenario works independently of AMF/BDL. Ordinary play remains available when skipped.
The [N sequence](../development-outline.md#n2-external-gameplay-tools) owns scope and
hardware acceptance; [integration modes](../architecture/integrations-and-overlays.md#external-integration-modes)
own upstream lifecycle/data boundaries.

## Delivery order

1. **Discover and explain.** Reuse host Steam-library discovery for App ID `3329480`.
   Verify installation files and the observed executable; distinguish absent, incomplete,
   unreadable and installed. The Tools card keeps the existing inline-details interaction.
   Explain that installing VRCFT does not add tracking cameras to an ordinary PICO 4.
2. **Acquire and launch.** Reuse the official Steam install handoff and refresh actual
   completion before enabling Play. Use the verified upstream launch entry and observe
   its process. Pending clicks do not launch duplicates; returning from Steam can resume
   reinspection. Update/removal stay in Steam. Close requests apply only to processes
   launched by this scenario, retaining pre-existing/shared applications.
3. **Select hardware and guide its SOP.** Show an **Available devices** dialog, explicitly a
   supported-choice list rather than detected hardware. Include supported headsets, add-on
   trackers and phone/camera paths. Ask for the app/streamer when it changes the module, such
   as Quest Pro with Steam Link or Virtual Desktop. Selecting a choice immediately opens its
   matching hardware/module instructions. Guide installation in VRCFT's Module Registry, or
   its package installer where upstream requires that exception, then VRChat OSC and a suitable
   Avatar. Preserve manual confirmations; changing device/connection clears obsolete progress.
   Software/process/module readiness and confirmed tracking remain separate facts.
4. **Recover as each path lands.** Handle unavailable Steam, partial downloads, moved
   installations, launch failure, a closed or unresponsive process, disconnected headset,
   app restart and module disable. Retain SOP progress and recheck current facts. Disabling
   this connection neither uninstalls upstream software nor removes its settings; never
   automatically force-terminate a hanging upstream module.
5. **Accept the smallest real path.** First exercise installed reuse and missing-app
   installation on Windows. With PICO 4 Pro/Enterprise, test USB and Wi-Fi gaze/blinking,
   microphone coexistence, disconnect/reconnect and the next session. Record tested
   software/module/firmware versions locally. Missing hardware leaves those cases pending.

## Current upstream constraints

Sources checked on 2026-10-10: [official Steam distribution](https://store.steampowered.com/app/3329480/),
[getting started](https://docs.vrcft.io/docs/intro/getting-started) and
[PICO 4 Pro/Enterprise guidance](https://docs.vrcft.io/docs/hardware/vr/pico/pico4pe).
The PICO guide currently describes a compatibility workaround for PICO Connect tracking
configuration and warns that the hardware module can initialize without working tracking
and can hang during shutdown. Link the current instructions and validate them against the
tested versions; this slice does not silently edit PICO settings or install third-party
hardware modules. Ask the author when physical evidence or a configuration decision is needed.

The [supported hardware list](https://docs.vrcft.io/docs/intro/getting-started#supported-hardware-list)
and its device guides own the available choices. The
[Steam Link](https://docs.vrcft.io/docs/hardware/vr/meta/quest-pro/steamlink) and
[Virtual Desktop](https://docs.vrcft.io/docs/hardware/vr/meta/quest-pro/virtual-desktop) modules differ.
The [Pimax guide](https://docs.vrcft.io/docs/hardware/vr/pimax/pimax-crystal) currently uses package
installation. VUA links these instructions rather than automating a private module database,
downloading DLLs into VRCFT or asserting that a checkbox proves installation.

## Source checkpoint and pending acceptance

The Tools card now supports device/connection selection, the Steam install/start handoff,
observed installation/process status and normal close of this run's instance. It retains inline
details, four-language copy, progress across return/reload, reinspection and stopping wait.
The Candidate [external-tool v0.1 face](../protocols/external-tool-v0.1.md) connects Renderer to
the host through the typed Gateway. Shared Steam discovery and Windows process identities stay
in their existing owners; this path does not initialize AMF/BDL.

Controlled tests cover prerequisites, partial installation, request replay, ownership, manual
exit, PID reuse, bounded close and late launch after cancellation. Native Windows lifetime tests
confirm that ordinary workers are contained while an explicit external handoff survives host
exit. The isolated desktop smoke uses real read-only discovery and labelled synthetic actions
for device picking, connection-dependent module guidance, saved progress and light/small-window
layout. Local installed-file reuse was observed; no module/tracking pass follows from it.

Still pending: actual missing-app Steam installation and vendor launch/exit behavior, installation
of each exercised module in VRCFT, and the PICO USB/Wi-Fi tracking cases above. Other device guides
are available choices, not a claim that each headset has been tested. Leaving Tools or restarting
VUA does not uninstall upstream apps or reclaim their running instances. N2 is not accepted yet.

Do not add automatic Avatar conversion, a general plugin SDK, private database inspection,
VRChat injection, a built-in Agent, or a UDP listener that competes with VRChat's OSC port.
Actual tracking is verified in the upstream UI and VRChat with hardware, rather than inferred
from a successful process launch.

## Document changelog

- 1.1.0 (2026-10-10): replace PICO-only guidance with device/connection selection and matching upstream module instructions; record the Candidate Steam connection and controlled recovery evidence, retaining physical acceptance.
- 1.0.0 (2026-10-10): define the short host-owned discovery, Steam handoff, launch, PICO SOP and recovery sequence, retaining real tracking acceptance and upstream lifecycle boundaries.

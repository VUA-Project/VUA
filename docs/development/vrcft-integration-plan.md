# VRCFaceTracking connection slice

> Document version: 1.0.0
> Status: Accepted
> Scope: Small N2 implementation plan; no claim of delivered tracking support
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
3. **Guide the PICO SOP.** First verify PICO Connect/SteamVR and the actual headset model.
   Guide headset tracking switches and calibration, the upstream hardware-module registry,
   VRChat OSC and a suitable existing Avatar. Each step offers the relevant upstream page,
   return, retry or skip. Software/process/module readiness and user-confirmed tracking
   remain separate facts; checking off instructions is not measured success.
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

Do not add automatic Avatar conversion, a general plugin SDK, private database inspection,
VRChat injection, a built-in Agent, or a UDP listener that competes with VRChat's OSC port.
Actual tracking is verified in the upstream UI and VRChat with hardware, rather than inferred
from a successful process launch.

## Document changelog

- 1.0.0 (2026-10-10): define the short host-owned discovery, Steam handoff, launch, PICO SOP and recovery sequence, retaining real tracking acceptance and upstream lifecycle boundaries.

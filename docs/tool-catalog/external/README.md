# External Integrations

[Catalog](../README.md)

## Boundary

External integrations are independent applications, Unity packages, runtimes, or device services
that interact with Unity, VRChat, SteamVR, hardware, or another public external boundary. They
retain their own accounts, state, lifecycle, license, and public interface. If VUA
discovers, launches, or connects to one, that VUA-side adapter is separately trusted Core behavior
or capability-bounded VUA plugin.

## Entries

- [Face tracking](face-tracking.md)
- [Motion tracking](motion-tracking.md)
- [Avatar optimizer](avatar-optimizer.md)
- [NDMF companion & VRM avatar packages](ndmf-companion-packages.md)
- [ALCOM / VCC (VRChat Creator Companion)](alcom-vcc.md)
- [SlimeVR Server](slimevr-server.md)
- [VRCT](vrct.md)
- [VRCX](vrcx.md)
- [VRCS](vrcs.md)
- [Planned connections](planned-connections.md): tools and headset routes with their interface in place
  and their connection still to build

## Planned Steam inventory

The [N2 acceptance table](../../development-outline.md#n2-external-gameplay-tools) owns the
selected applications and Steam App IDs, including OVR Overlay Translator, OVR Advanced Settings,
OVR Toolkit, OyasumiVR, Desktop+, fpsVR and LIV. Twelve fixed Steam entries share the
[Candidate connection](../../protocols/external-tool-v0.4.md):
installation discovery, official purchase/install handoff and launch/status observation, while
SlimeVR Server, VRCT, VRCX and VRCS share [installer-tool v0.1](../../protocols/installer-tool-v0.1.md)
and [deployment v0.1](../../protocols/environment-deployment-v0.1.md).
Individual usage tutorials are not required. XSOverlay and LIV remain planned entries until their
installed Steam directory and main executable are verified on a real machine. The tracking entries
above retain their additional setup and real-hardware acceptance.

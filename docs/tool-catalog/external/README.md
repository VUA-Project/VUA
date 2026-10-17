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
- [ALCOM / VCC (VRChat Creator Companion)](alcom-vcc.md)

## Planned Steam inventory

The [N2 acceptance table](../../development-outline.md#n2-external-gameplay-tools) owns the
selected applications and Steam App IDs, including OVR Overlay Translator, OVR Advanced Settings,
OVR Toolkit, OyasumiVR and LIV. The six fixed Steam entries — the two tracking tools above plus
the four utility entries — share the [Candidate connection](../../protocols/external-tool-v0.2.md):
installation discovery, official purchase/install handoff and launch/status observation.
Individual usage tutorials are not required. LIV remains a planned entry without a VUA
connection. The tracking entries above retain their additional setup and real-hardware
acceptance.

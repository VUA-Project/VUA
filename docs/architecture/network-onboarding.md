# First-play network observations

> Document version: 2.0.0
> Status: Accepted
> Last conformance review: 2026-10-09 (controlled four-language UI and source checks; regional targets unverified)
> Scope: N1 first desktop/PICO play release

## User outcome and current limit

The author's 2026-10-09 ruling replaces regional advice with a compact network tile on Play.
Its intended destinations are **Europe**, **United States** (East and West within one item),
and **Japan**. The tile sits above the environment grid and matches the cards' height.

Reliable public VRChat instance-region probe destinations have not been established. The tile
therefore reports **regional Ping unavailable**, displays no invented measurements and disables
its measurement action. Its details action remains available. This limit does not block
software preparation or play. Actual room connections can be investigated separately before
a regional adapter is proposed; no account session, client injection or log scraping is added
for this placeholder.

VRChat's [connection troubleshooting](https://help.vrchat.com/hc/en-us/articles/360062658433-Troubleshooting-Connection-Issues-with-VRChat)
publishes website/API checks, not a verified public set of room-region Ping targets.
[Photon's region documentation](https://doc.photonengine.com/realtime/v5/connection-and-authentication/regions)
describes obtaining region destinations from its Name Server for an application's connection.
These sources do not establish endpoints usable by VUA for VRChat regional measurement.
Website timing must not be relabeled as room Ping or headset streaming latency. The game exposes
[Ping/FPS and instance selection](https://help.vrchat.com/hc/en-us/articles/28526267258515-Getting-Started-with-VRChat)
for the player's own observation.

**Connection help, usage-region selection/detection and third-party accelerator recommendations
are removed from the player flow.** This supersedes this document's previous mainland-China/UU
guidance. Language choice does not cause a location lookup. Explicit mainland/global PICO
installer selection and the separate Unity download policy retain their own scope.

## Expanded website tests

Expanded details contain editable website cards. The defaults remain **VRChat, Steam, GitHub**
in that order. Each has a local icon, name and independent test action/result; the header offers
**Test all** and **+**. No test runs merely because Play or its details opens. Tests show busy
state, then time to HTTP response headers, an HTTP status, timeout or failure. Retesting a
single site preserves the others' results. These values never fill the regional tile.

Users can add, edit and remove credential-free HTTPS sites, up to twelve. Only names and URLs
persist locally; observations do not. Software setup remains available with any result.
The tour keeps its existing `.vua-network` anchor.

The interaction reference remains [Clash Verge Rev's website test card](https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/src/components/home/test-card.tsx).
VUA uses its own React/CSS, local vector glyphs and Gateway/Rust implementation; no upstream
source or assets are bundled.

## Implementation responsibilities and IO

- `NetworkPanel` owns the regional placeholder, expanded website preferences and per-card
  state. It uses the typed Gateway, never renderer fetch. `website-model` validates saved
  destinations and edits. The page makes no usage-region query.
- `createLiveNetworkPort` validates observations against the exact requested URL list.
  The additive [website-tests v0.1](../protocols/website-tests-v0.1.md) query accepts explicit
  credential-free HTTPS destinations.
- Project-manager's HTTPS adapter owns request budgets and error classification; provider-host
  composes and advertises the operation. A website result gives no installation/readiness verdict.

Website tests run concurrently with a six-second per-site/eight-second batch budget. Redirects
are limited to three credential-free HTTPS destinations. HEAD 405/501 retries GET to response
headers and immediately drops the response. Other HTTP errors remain visible; no browser
challenge is automated. Requests use the Provider's network route, not a chosen proxy node or
the game's connection. Fresh clients send no account credentials or browser cookies. No page
body, raw transport error, public IP, account data or browsing history is persisted.

Partial results survive another site's failure. No automatic retry loop runs. Tests do not
change DNS, proxy, firewall, certificate verification or network software settings. Internet
service reachability and PICO USB/local Wi-Fi connectivity remain separate observations.

## Retained compatibility

The older Candidate `environment.checkNetwork` query and
[environment-network v0.1](../protocols/environment-network-v0.1.md) implementation remain for
existing consumers, including their explicit intent and bounded country-lookup behavior.
The current player flow has no entry or call to that query; retained compatibility does not
authorize adding region detection or recommendations back to the UI. The frozen
`environment.getSnapshot` TCP observation also remains compatible. Neither operation supplies
VRChat instance-region latency.

## Verification

Shared schema vectors and Gateway tests validate requested destinations and result shapes.
Adapter tests cover HTTP classifications and redirect boundaries. Controlled Chromium checks
exercise four-language independent results, editing/removal, no request on page opening,
no region detection/help/recommendation entry, and the split between expanded website results
and unavailable regional Ping. Actual VRChat room Ping, vendor login/loading and PICO connection
acceptance remain separate physical observations. Raw machine reports stay in
`_local_real_machine/`, outside Git.

## Document changelog

- 2.0.0 (2026-10-09): retire Connection help, usage-region identification and accelerator recommendations; move website tests into details and report regional Ping unavailable pending verified targets.
- 1.1.0 (2026-10-07): replace the large network form with editable VRChat/Steam/GitHub test cards and fold regional advice into help.
- 1.0.0 (2026-10-03): define the implemented first-play network check, UU-only recommendation and its boundaries.

# First-play network checks and guidance

> Document version: 1.1.0
> Status: Accepted
> Last conformance review: 2026-10-07 (source and targeted checks; author UI review follows)
> Scope: N1 first desktop/PICO play release

## User outcome

The play environment page offers a compact **Website tests** card. The default sites, in order,
are **VRChat, Steam, GitHub** (author ruling, 2026-10-07). Each tile has a local icon, name and
test action/result. The header offers **Test all** and **+**. A test shows busy state, then
response time in milliseconds, an HTTP status, timeout or failure. Retesting a single site
preserves the other cards' results. No request runs merely because the page opens.

Users can add, edit and remove HTTPS sites, up to twelve. Only names and URLs persist locally;
responses do not. **Connection help** is collapsed by default and contains region selection,
explicit region detection, mainland-only UU advice and cross-region lag explanations. Software
setup remains available with any result. The tour keeps its existing `.vua-network` anchor.

The interaction reference is [Clash Verge Rev's website test card](https://github.com/clash-verge-rev/clash-verge-rev/blob/dev/src/components/home/test-card.tsx).
VUA uses its own React/CSS, local vector glyphs and Gateway/Rust implementation; no upstream
source or assets are bundled.

The retained regional query checks the Steam registration/store entrance, Steam Community, the Steam Windows
installer download entrance, and the VRChat website. PICO mode adds the PICO Connect download
page. These are concrete checks of those entrances, not an exhaustive inventory of game login,
asset CDNs or Steam content servers. Response time measures time to HTTP headers, not game
ping, download throughput or headset streaming latency. Login and loading are verified in the
actual game later in the first-play flow.

## Mainland China guidance

The first recommendation is **only [NetEase UU](https://uu.163.com/)**. As specified by the author
on 2026-10-03, the guide tells users to select **VRChat** in UU; this also accelerates the
surrounding Steam and Oculus stores, so separate selections are unnecessary. This is the
initial user instruction supplied from practical use; the network probe does not inspect UU
configuration or assert that UU is running. VUA discloses that it has no financial relationship
with NetEase UU and that NetEase owns its service terms and charges. Opening the site requires
a user action. Existing accelerators can stay in use; the user can also continue without one.

After enabling acceleration, recheck these entrances and verify VRChat login/loading in the
game. VUA requests and a game can use different routes, so a web check does not gate play or
prove that game acceleration failed. Internet connectivity and PICO USB/local Wi-Fi connectivity
are separate checks: the latter belongs to the PICO Connect connection guide.

Automatic region detection observes the current connection exit, including a proxy if used.
It is a correctable hint, not physical-location proof. If it returns unknown, the UI invites a
manual choice. A manual region choice takes precedence and skips the country lookup entirely.

Recommendation eligibility depends on this region, never the UI language. Mainland China
shows the UU guidance; outside mainland China or unknown shows no accelerator recommendation.
The mainland panel explicitly states its regional scope, including when a proxy affects the
automatic hint. A Japanese user using Chinese UI therefore gets the same region logic as a
Japanese user using Japanese UI. A mainland user may read that guidance in any supported language.

Users who can already play but report distant-instance lag get a separate, expandable guide:
compare an instance closer to the user/friends and check in-game ping; compare FPS for rendering
stutter, and the PICO USB/Wi-Fi link for streaming stutter. Website probes do not measure these
conditions. VRChat documents [instance regions and their latency effect](https://docs.vrchat.com/docs/vrchat-202124)
and [in-game ping/FPS and instance selection](https://help.vrchat.com/hc/en-us/articles/28526267258515-Getting-Started-with-VRChat).

## Implementation responsibilities

- `NetworkPanel` owns website preferences, per-card state and folded help. It uses the typed
  Gateway, never renderer fetch. `website-model` validates saved destinations and user edits.
- `createLiveNetworkPort` validates website observations against the exact requested URL list.
  The additive [website-tests v0.1](../protocols/website-tests-v0.1.md) query accepts explicit
  credential-free HTTPS destinations. The separate regional query retains its closed intent.
- `NetworkService` in the orchestrator selects the four/five targets, applies the region
  preference and timestamps the observations. There is no installation or readiness verdict.
- `HttpsNetworkProbe` in project-manager owns vendor URLs, HTTPS requests and error
  classification. Provider-host composes it with the service and advertises the operation.

Website tests run concurrently with a six-second per-site/eight-second batch budget. Redirects
are limited to three credential-free HTTPS destinations. HEAD 405/501 retries GET to response
headers and immediately drops the response. Other HTTP errors remain visible; no browser
challenge is automated. This request uses the Provider's network route, not a selected proxy
node and not the game's connection. The result is time to headers, not throughput or game ping.

The [network contract](../protocols/environment-network-v0.1.md) owns fields, statuses and
validation. The frozen `environment.getSnapshot` TCP observation remains compatible for existing
consumers; the live play page uses the dedicated HTTPS panel instead of its legacy TCP card.

## IO and failure behavior

The following rules describe the retained regional query used by explicit region detection;
the website-card operation is specified separately above.

Checks run only when requested. Each service receives an HTTPS HEAD request, which fetches
headers without downloading page or installer bodies. A fresh client sends no account
credentials or browser cookies. Up to three redirects may follow on the same vendor's HTTPS
domains; an off-vendor, non-HTTPS or excessive redirect is displayed for browser confirmation.
No redirect destination or raw transport error is returned to the renderer.

Each request has a six-second timeout and the batch an eight-second budget. Targets run
concurrently. Completed observations survive another target's timeout. A failed probe-client
setup is a local check error; HTTP 403/405/429/5xx means the server responded and should be
checked in the browser, not that the entire Internet is offline. No automatic retry loop runs.

Automatic region lookup uses Cloudflare's HTTPS trace endpoint. Its response is bounded to
8 KiB in memory; only the country category is retained. No public IP, raw trace, cookie,
credential, page body or browsing history is persisted. Region lookup failure does not remove
service results. Probes use the process's network route; they do not change DNS, proxy,
firewall, certificate verification or accelerator settings.

## Verification

Shared schema vectors test both Rust validation and TypeScript guards. Service tests cover
desktop/PICO target selection and manual region precedence; Gateway tests cover request
rejection, unavailable implementations, partial results and replies for another route. Adapter
tests exercise HTTP classifications and redirect boundaries. Real-machine reports belong in
`_local_real_machine/`, outside Git. UI usability still receives human review under N acceptance.

## Document changelog

- 1.1.0 (2026-10-07): replace the large network form with editable VRChat/Steam/GitHub test cards and fold regional advice into help.
- 1.0.0 (2026-10-03): define the implemented first-play network check, UU-only recommendation and its boundaries.

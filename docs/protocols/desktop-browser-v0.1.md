# Desktop-browser v0.1: public entries and shell-sized views

> Document version: 1.0.0
> Status: Candidate
> Updated: 2026-10-11
> Scope: Optional local preload face; no Provider, task, account or catalog wire change

For people: the encyclopedia opens the official VRChat Wiki; AMF offers BOOTH and the requested
public discovery shortcuts. Browsing keeps VUA's header and sidebar available.

For Agents: Main/preload produce `VuaDesktopApiV1.desktopBrowser?`; the main Renderer consumes
it. This independent Candidate face preserves retained `remoteContent` V1 shapes. Types and
fixed destinations live in [desktop-browser.ts](../../packages/contracts/src/desktop-browser.ts).
An older preload without this optional member is presented as unavailable. Remote pages have
no VUA preload capability, Node or local Gateway.

## Operations and guards

| Operation | Input/output | Behavior |
| --- | --- | --- |
| `open(site)` | Closed site ID → `RemoteContentViewStateV1` | Wiki needs only the host; material sites require ready AMF and mounted browser services |
| `navigate(viewId, site)` | View/site IDs → state | Reuses a view; site and view must have the same knowledge/material purpose |
| `goBack` / `goForward` / `reload` | Owned view ID → state | Website history/reload with existing Main navigation security |
| `close(viewId)` | View ID → void | Disposes the view; already-closed IDs are safe during teardown |
| `setViewport(viewId, viewport)` | Four CSS-pixel coordinates or null → void | Main applies page zoom and clamps to its own content bounds; null/zero area hides the view |
| `events.subscribe(listener)` | Listener → unsubscribe | Existing opened/navigated/closed/blocked events plus `loading` and `load-failed` with numeric connection code |

Closed IDs are `vrchat-wiki`, `booth`, `vrcfinder`, `boothplorer`, `yorimichi`, `polyseek`,
`vrc-style`, `avatar-network`, `avatar-catalog`, and `vrc-db`. Only the first is knowledge;
the other nine belong to AMF material browsing. Main derives URLs from the shared table.
A shortcut does not imply an API integration or guarantee third-party availability.

Every operation accepts only Main's own trusted local main frame. View IDs are strings of
at most 128 characters and resolve to a manager-owned view. Viewport objects have exactly
`x`, `y`, `width`, `height`, all finite numbers in 0–32768; other inputs reject. Null layout
for an already-closed view is idempotent, as are late measured receipts after teardown.
Layout never revives a closed view and may hide an existing AMF view during shutdown;
other material operations require AMF readiness. Monitor scaling is already Electron DIP and
must not be applied again.
Candidate state/event URLs are origin/path display metadata with query, fragment and authority
credentials removed. Full navigation targets remain in Main. Retained V1 event shapes are unchanged.

## Isolation, lifetime and compatibility

Wiki uses a nonpersistent knowledge partition, denies downloads and initializes no AMF/BDL
storage. Material browsing reuses the BOOTH partition and strict download port. Browsing
origins do not expand authenticated catalog-fetch or cookie-persistence origins, download
origins, accepted file types or intake authority. Unlisted web/protocol targets retain
per-attempt confirmation. Remote permissions and new native windows remain denied.

Trusted local HTML measures the main content below browser controls and wrapping shortcuts.
This geometry also applies to retained V1 login/import views; V1-only clients have conservative
header/sidebar insets. Native views yield to pending local navigation confirmations. Settings
hides retained encyclopedia/material browsers and restores them on return. Leaving a page
disposes its browser; global login closes on shell navigation, and leaving import also dismisses
its modal. Full Main reload/window shutdown closes native views; AMF shutdown closes only its
own views. Load failures offer retry/alternative shortcuts without claiming installation,
login or imported materials. No page body or credentials are returned through this face.

## Evidence and status

[Contract guards](../../packages/contracts/src/desktop-browser.test.ts) cover closed entries
and malformed geometry. [Geometry tests](../../apps/desktop/src/electron/browser-viewport.test.ts)
cover zoom and stale resize receipts. The [consumer smoke](../../apps/desktop/scripts/smoke-asset-browser.mjs)
uses real Main/preload/Renderer/providers with synthetic HTTPS pages in disposable sessions;
it covers AMF-off Wiki, isolation, confirmation visibility, shortcuts/history, load recovery,
four-language layouts, zoom, Settings return and retained BOOTH login/import. Optional public-site
reads perform no login, purchase or download. Raw output/screenshots stay local and do not
establish account/material/device acceptance.

This face remains Candidate: executable types/guards and consumer checks exist, but no new
schema/vector family or freeze exemption has been accepted.

## Document changelog

- 1.0.0 (2026-10-11): define fixed host Wiki/AMF material entries and bounded browser geometry, preserving retained account/catalog/download faces and independent acceptance.

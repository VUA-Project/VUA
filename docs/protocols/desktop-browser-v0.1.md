# Desktop-browser v0.1: public entries and shell-sized views

> Document version: 1.2.0
> Status: Candidate
> Updated: 2026-11-14
> Scope: Optional local preload face; no Provider, task, account or catalog wire change

For people: the encyclopedia opens the official VRChat Wiki; AMF offers BOOTH and the requested
public discovery shortcuts. Browsing keeps VUA's header and sidebar available, with up to eight
tabs per purpose and the current pages retained when visiting another VUA page.

For Agents: Main/preload produce `VuaDesktopApiV1.desktopBrowser?`; the main Renderer consumes
it. This independent Candidate face preserves retained `remoteContent` V1 shapes. Types and
fixed destinations live in [desktop-browser.ts](../../packages/contracts/src/desktop-browser.ts).
An older preload without this optional member is presented as unavailable. Remote pages have
no VUA preload capability, Node or local Gateway.

## Operations and guards

| Operation | Input/output | Behavior |
| --- | --- | --- |
| `open(site)` | Closed site ID → `RemoteContentViewStateV1` | Wiki needs only the host; material sites require ready AMF and mounted browser services; a new tab starts hidden until its owner supplies geometry |
| `openBoothItem(productId)` | `booth:<digits>` → `RemoteContentViewStateV1` | Requires ready AMF and mounted material browser services; Main derives `https://booth.pm/ja/items/<digits>` from a validated BOOTH product ID without accepting arbitrary URLs |
| `navigate(viewId, site)` | View/site IDs → state | Reuses a view; site and view must have the same knowledge/material purpose |
| `goBack` / `goForward` / `reload` | Owned view ID → state | Website history/reload with existing Main navigation security |
| `close(viewId)` | View ID → void | Disposes the view; already-closed IDs are safe during teardown |
| `setViewport(viewId, viewport)` | Four CSS-pixel coordinates or null → void | Main applies page zoom and clamps to its own content bounds; null/zero area hides the view |
| `events.subscribe(listener)` | Listener → unsubscribe | Existing opened/navigated/closed/blocked events plus `loading`, `load-failed`, `tab-opened`, `title-updated`, `tab-limit`, and `download-completed` |

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
`tab-opened` carries its parent view ID and the new owned view's ID/display URL; `title-updated`
carries an untrusted text title, stripped of control characters and limited to 120 characters.
Titles are displayed as text, not markup. `tab-limit` names the requesting owned view.
`download-completed` carries `{ downloadId, suggestedFileName }` after BDL persists a
completed user-initiated download outside `SilentDownloadQueue`, so `Browse BOOTH` can
offer one-click Warehouse adoption without exposing file paths.

## Isolation, lifetime and compatibility

Wiki uses a nonpersistent knowledge partition, denies downloads and initializes no AMF/BDL
storage. Material browsing reuses the BOOTH partition and strict download port. In addition
to silent-download requests, `DownloadPort` admits user-initiated downloads from an allowed
BOOTH item or library page when the redirect chain starts at
`https://booth.pm/downloadables/<digits>` (with optional `?variation_id=<digits>`) and every
redirect hop is a credential-free `https:` URL. Browsing origins do not expand authenticated
catalog-fetch or cookie-persistence origins, download origins, accepted file types or intake
authority. Unlisted web/protocol targets retain
per-attempt confirmation. Remote permissions and new native windows remain denied.
An allowlisted web popup from the visible, unsuspended site-browser tab opens an owned local tab
instead of replacing the source page; background/pending tabs cannot open more tabs. Main and
Renderer both limit each knowledge/material session to eight site-browser tabs, with pending
Renderer opens counted. Login/import popup handling retains its previous current-view behavior.

Trusted local HTML measures the main content below browser controls and wrapping shortcuts.
This geometry also applies to retained V1 login/import views; V1-only clients have conservative
header/sidebar insets. Native views yield to pending local navigation confirmations. Settings
hides retained encyclopedia/material browsers and restores them on return. Other page changes
also hide site-browser tabs without disposing them. Only the selected tab receives visible
geometry; its native history, scroll and form state survive tab and VUA-page changes. Explicit
tab close disposes that view; late open receipts for already-closed tabs are also disposed.
Global login closes on shell navigation, and leaving import also dismisses its modal. Full Main
reload/window shutdown closes native views; AMF shutdown closes only its own views. The tab list,
titles and navigation metadata are held in memory, not saved as browsing history or restored
after application exit. Existing cookie/profile ownership is unchanged. Load failures offer
retry/alternative shortcuts without claiming installation, login or imported materials.
No page body or credentials are returned through this face.

## Evidence and status

[Contract guards](../../packages/contracts/src/desktop-browser.test.ts) cover closed entries
and malformed geometry. [Geometry tests](../../apps/desktop/src/electron/browser-viewport.test.ts)
cover zoom and stale resize receipts. The [consumer smoke](../../apps/desktop/scripts/smoke-asset-browser.mjs)
uses real Main/preload/Renderer/providers with synthetic HTTPS pages in disposable sessions;
it covers AMF-off Wiki, isolation, confirmation visibility, shortcuts/history, load recovery,
page/tab return with retained scroll/form/history, popup and shortcut tabs, independent close,
eight-tab limits, four-language layouts, zoom and retained BOOTH login/import. Session-controller
tests also cover pending open/close races, event ordering and AMF view disposal. Optional public-site
reads perform no login, purchase or download. Raw output/screenshots stay local and do not
establish account/material/device acceptance.

This face remains Candidate: executable types/guards and consumer checks exist, but no new
schema/vector family or freeze exemption has been accepted.

## Document changelog

- 1.2.0 (2026-11-14): add `openBoothItem(productId)`, admit user-clicked `booth.pm/downloadables/<id>(?variation_id=<digits>)` redirects from BOOTH item/library pages in `DownloadPort`, and emit `download-completed` after BDL persistence.
- 1.1.0 (2026-10-11): retain site-browser pages across shell navigation, add bounded local tabs and title/popup events, and preserve transient login/import lifetimes and remote-content isolation.
- 1.0.0 (2026-10-11): define fixed host Wiki/AMF material entries and bounded browser geometry, preserving retained account/catalog/download faces and independent acceptance.

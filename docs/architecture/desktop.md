# Electron desktop and presentation architecture

> Scope: `apps/desktop`, `packages/design-system`, frontend Gateway
> Updated: 2026-10-14

## Technology decision

The desktop shell uses Electron; presentation uses React, TypeScript, and Vite. Electron Main hosts a
small Node.js Kernel. Kernel owns bootstrap, desktop security, Gateway, and Orchestrator Provider
lifecycle; React UI provides the controlled presentation surface, and Orchestrator, AMF, BDL, and
Unity Bridge retain their defined ownership. Built-in behavior wires directly to its owning
application use cases without a generic module registry or runtime composition framework.

## Process responsibilities

### Renderer

- Renders the local UI and owns temporary page/input state.
- Uses only the injected typed Gateway for commands, queries, and task actions.
- Imports presentation packages and the injected Gateway contract.
- Reads authoritative task, Recipe, and recovery state from Orchestrator snapshots.

### Preload

- Exposes a minimal explicit versioned API through `contextBridge`.
- Validates channel, request size, and caller origin.
- Exposes allowlisted application calls with typed request and response values.
- Gives remote pages an empty VUA capability surface.

### Main

- Owns windows, lifecycle, deep links, and updates.
- Separates local UI from Main-managed remote `WebContentsView` instances.
- Owns purpose-partitioned sessions and desktop enforcement for cookies, permissions, navigation,
  download transport, origins, destinations, types, and external protocols.
- Owns Kernel bootstrap, security policy, Provider hosting/supervision,
  diagnostics, and community-plugin host boundary.
- Supervises the selected Rust Orchestrator Provider as a separate process through the Kernel
  (in-process hosting is a future option, not the current implementation; see
  [orchestrator.md](orchestrator.md)) and maps allowed calls to the versioned
  application contract without exposing its transport to the Renderer.
- Delegates AMF, Recipe, recovery, and compatibility behavior to application use cases.

Core catalog entries represent trusted behavior built directly into VUA and gain no authority through
runtime registration. The future community plugin host provides a separate capability context.

## Startup and first-use language

The author's 2026-10-10 approval replaces the full-window text/grid opening with a centered,
frameless 480 × 320 DIP startup surface. It begins white; five thick black rays travel from the
upper right toward the lower left at 120°, revealing the supplied monochrome white VUA logo.
A loading circle sits below it. There are no visible labels, buttons or version/update badges.
Reduced motion or resource saving shows the static black/white result and shortens its dwell.

Main opens this presentation before provider startup and holds the main window hidden while
the renderer loads. The local `surface=splash` branch never instantiates App or its Gateway.
The main renderer's existing renderer/Gateway/provider/paint milestones report completion
through Candidate [desktop-startup v0.1](../protocols/desktop-startup-v0.1.md); Main then shows
the shell and destroys the small window. A bounded renderer-load fallback prevents a missing
completion signal from trapping the application. Controlled packaged diagnostics keep windows
hidden and use their existing watchdog.

Locale selection already had the saved-choice → supported system language → English order.
Main now supplies Windows' ordered preferred UI languages through local preload arguments,
instead of letting Electron's browser language decide first use. Native input is bounded in
preload; browser previews retain their navigator fallback. The saved manual choice always wins,
and inferred choices do not become a saved override. PICO distribution and network targets
remain independent. The first-use welcome/tour precedes the route wizard as defined by
[guidance architecture](guidance.md#2-vua-app-tour), without enabling AMF or changing Home.

Main returns normalized navigation/download events through narrow ports and retains `Session`,
`WebContents` and `DownloadItem` handles. Browser storage owns cookies/tokens; they are not copied
into Main application state, Gateway, Orchestrator or Agent inputs. AMF owns acquisition intent, task and source
correlation, post-download inspection, and Warehouse/BDL decisions.

## Fixed directory and first-run journey

The main shell has one fixed Home, opened by its left logo, and a fixed
Environment/Avatar directory in the sidebar. The 2026-10-10 user ruling retires big-screen mode:
Theme and tray entries, alternate layouts and directional shell navigation are removed.
Startup removes the old local layout preference without interpreting it. `nav-model.ts` retains internal page ownership for tasks and deep links without
restoring the old two-tab presentation. Wizard choices never hide features or change Home actions.
The [design standard](../design/design-standard.md#3-platform-and-information-architecture)
owns the accepted layout, logo colors, unavailable peers and preserved visual preferences.

Environment contains Play, Tools and Avatar editing. Tools groups the planned tracking,
translation, VR utilities and capture integrations, independently of AMF. The six fixed Steam
entries share the Candidate connection card (discovery/install handoff/launch/status); the
remaining unwired entries offer collapsible descriptions with disabled development actions,
not installed/launchable plugin claims. Help is a global topbar
parallelogram beside Settings, with no sidebar duplicate; its active state covers all Help children.
Home exposes it among global actions, and Search retains its entry. Help contains Getting started, the app tour, Knowledge encyclopedia and
In-game assistant. The encyclopedia is a main-window page with hardware introductions and
the existing shared preparation chapters/bookmark. Its official Wiki entry opens
`wiki.vrchat.com` in an isolated host browser, including when AMF is disabled.
Play links directly to hardware reading.
All four Help cards open main-window child pages; tour and game-assistant pages then offer
their existing explicit start actions. The replay wizard stays inside its Help child page.
Native mouse Back/Forward uses Chromium history, including encyclopedia chapters and wizard
choices; restored preparation still needs fresh inspection. Same-document navigation does not
invalidate Main's subscribed native-command listeners.

`journey-model.ts` stores only a versioned reading/selection bookmark. Desktop/PICO and creator
routes use the existing typed network/deployment ports. A fresh plan or a task completed during
the current visit can establish software readiness; a restored terminal receipt alone cannot.
Reopening a completed preparation step reinspects files, and accepted tasks remain observable
through their receipts. A connection confirmation is explicitly user-declared, not headset evidence.
Opening Steam or a guide does not prove installation, login or successful play.

Play and Tools have equally sized two-half cards: collapsible details on the left and status/action on the
right. Normal game exit retains **Close** only while owned software survives, with no failure
warning. Play/Tools cards are 88 px high, half their previous heights;
the two action/detail halves remain intact. Network's equally tall tile is above the grid; it offers
approximate [regional HTTPS references](network-onboarding.md), while website tests remain in expanded details. The expandable runtime inventory stays
on Play. The retired Software & connections page is absent from Home, sidebar and tour;
old stored page IDs migrate to Play. Wizard choices still do not control these entries.
The typed play port consumes the Candidate [play-session family](play-sessions.md), keeps
unavailable observations distinct from missing software, and disables launch while installation
is active. Scoped deployment bookmarks retain Desktop and PICO work independently while
reading a matching legacy bookmark. Hidden details keep accepted installation receipts alive.
Play, Tools and Avatar-editing cards expand directly beneath their own card, within that grid
column, and collapse on a second click. Hidden preparation panels stay mounted so accepted
work and inspection state survive switching or closing details.
Development entries expose descriptions while installation/launch remain unavailable; tool
grids keep the same column widths even in a group with only one item.

Avatar editing discovers Editor directories through the host's `environment.getSnapshot`
and verifies executable identity through `environment.verifyEditor`. AMF's optional
`project.environmentManagers` supplies manager configuration facts only; its absence does
not block Editor detection. Unity 6 remains a development entry even when files are found.
Fresh entry into Unity 2022 preparation, including the wizard, requests a read-only deployment
plan automatically. The accepted global/China pair is observed before CLI acquisition or any
installation; the plan retains the full observed version. Saved task receipts remain visible
and require explicit reinspection rather than being discarded by this entry inspection.
The read-only `environment.inspectManagerApps` Candidate query reports Hub/VCC/ALCOM
executable findings from known roots and registry paths. Configuration findings keep their
original frozen semantics and do not imply that an executable is installed. Version/path data
remain local; unsupported versions only offer the accepted preparation route.

Settings navigation keeps the underlying route or wizard mounted and returns to its source
step. The sidebar contains only settings categories while Settings is open;
the upper-left Back action and the active Settings button return to the same
source page. Category changes do not replace the return destination. Inspection belongs to the
Avatar directory; Help and Settings have no duplicate bottom-left entry, and the topbar does
not repeat the page name beside the Home logo.
AMF Home cards are Warehouse, Recipe, Workshop, Finished Avatars (成品) and Package Manager.
Remove the Inspection Home card; its existing sidebar/report capability remains available.
The same card set serves Home and the AMF directory.

The compact shell follows the [design standard](../design/design-standard.md#3-platform-and-information-architecture):
the bottom taskbar is no longer mounted, and feature search is a Settings-sidebar footer action
with the existing global shortcut. Appearance changes use joined native buttons backed by the
same three-value preference. A missing/invalid preference resolves to Dark; saved preferences
and cross-window/system subscriptions stay compatible. The app tour's task step navigates to
the fixed Home Tasks tile rather than a retired taskbar anchor. Language selection sits directly
above **Search**, with a translation glyph, a shorter selector and explicit spacing in short windows.
Separate Goal reselection, Language, Version and Donation pages are removed; About retains
version, update, debug and diagnostics controls. Old goal links open Help's getting-started wizard;
other historical Settings page IDs migrate to About or Theme.
Language reloads retain the Settings return page through the current history entry.
The resource panel shows observed CPU/GPU/RAM/VRAM without a sampled-time label. Its compact
**resource headroom** is the remaining mean of available readings, with a separate near-full
dimension indication. It is not a performance forecast. GPU utilization and VRAM refer to the
same selected card; [desktop resource v0.2](../protocols/desktop-resource-v0.2.md) owns sampling,
multi-adapter selection, unavailable readings, expiry and the retained V1 port.
The Home logo replaces jurisdiction colours through a 380 ms 120° upper-right-to-lower-left
wipe. Previous and incoming marks keep their own colours; resource saving and reduced motion
switch directly. The logo remains the Home action, with no page-name text beside it.

Account-help navigation uses that same settings return path.
Settings → Accounts retains the N5 BOOTH sign-in/probe/logout surface; Steam, VRChat and Unity
authentication remain honest placeholders. Registration/linking pages add an official browser
handoff through `RemoteContentApiV1.openAccountGuideInBrowser(AccountGuideIdV1)` and the matching
preload/Main channel. This is an additive native desktop port, not a new Provider method or a
change to the frozen application envelope. Main checks local sender identity and maps the closed
ID to a fixed public URL; arbitrary URLs, page data and credentials do not cross this port.
Warehouse probes account-library access through the existing `authProbe` before offering
sync; stored cookies alone are insufficient. Pending probes show a disabled checking entry;
IPC failures offer a retry. A session that cannot be verified offers the BOOTH login flow.
Closing login/import refreshes this fact, and an explicit sync request reprobes it. Settings →
Accounts also reprobes after its login view closes and discards replies from prior view lifetimes.
A rejected or expired session opens login directly. Main matches stored cookies against the
actual account-library URL, including applicable parent-domain storage, and skips anonymous
probes when there is no matching storage. Authentication still requires a successful account
page read, bounded to eight seconds; cookie presence never proves login. Electron's private HTML
reader uses the same partition with explicit credentials, tracks each actual redirect, bounds
the response size and rejects redirects outside the authenticated-read allowlist. This avoids
the pinned Electron fetch response's empty URL without assuming a redirected request stayed at
its starting URL. Neither credentials nor raw page bodies reach Renderer.

The optional Candidate [desktop-library v0.1](../protocols/desktop-library-v0.1.md) face opens
the active AMF material folder. Main accepts only the local main frame, requires ready AMF and
resolves `warehouse` from the module's data root; Renderer supplies no path. The library's search,
source and download-state controls share one responsive filter row. Retired availability,
entity-type and relation controls are absent from the presentation, while Provider contracts
retain their existing query fields for other consumers.

Main installs the dormant `vua-img` dispatcher before creating any renderer, including the
splash: late installation leaves existing Chromium renderers unable to use the scheme even
when Main can fetch it. Installation creates no AMF storage. Activation supplies the module
data root and enables bounded, allowlisted image caching; inactive AMF denies reads, including
previously cached images. Existing image addresses and disk-cache keys remain valid. Product
detail enrichment attempts its optional page read once per opened product, ignores late replies
after closure and preserves the synchronized image when description enrichment fails.
Missing categories also trigger this read when description/variations are already present;
successful completion refreshes the joined library and category facets, not only the detail.
Account-library HTML does not supply native categories. Unvisited product records may remain
uncategorized; the UI must not infer category from names or report a complete backfill.

The library reads original BOOTH categories through the unfrozen AMF library face, with provider
filtering/facets before pagination. Multiselection captures the displayed product/entry copy scopes
for preview and count-bearing removal confirmation; unknown local source identities do not gain
BOOTH download access. Per-product removal receipts retain their request ID and preview on explicit
retry; closing a dialog does not authorize additional files or restart interrupted operations.

Card media carries a triangular corner with file/source/transfer facts. Menus and details open
canonical BOOTH product pages; menu buttons align to the card bottom. Local intake opens the
folder picker directly, retaining confirmation and cancellation. Card text reads title, shop,
then the purchased variant when present. Native files/folders dropped into the host enter the
AMF [mixed intake command](../protocols/library-intake-v0.2.md); a single file never implies its
parent folder. An inactive module prompts for explicit enablement before importing. Preload
resolves Electron-backed File objects and Main guards the native face; browser-created Files
cannot supply paths. Task completion refreshes library facts even when intake started elsewhere.
Native transfer polling always reconciles temporary card state, including unchanged empty queues;
durable batch terminal/inspection replies clear their temporary transfers without a page remount.
The view toggle sits immediately left of search. Single-card menus open recorded local entry folders
through the [desktop-library face](../protocols/desktop-library-v0.1.md), with provider lookup and
native containment checks. Multiple product folders offer a choice; cloud-only cards disable the
action and multiselection omits it. The whole-library toolbar action is retired.
The bounded public lookup
face is [booth-search v0.1](../protocols/booth-search-v0.1.md): Main owns keyword-only IPC,
partition transport, pacing and size/time bounds; acquisition parses closed candidates.
Renderer saves observed sources through entry-metadata commands. No account membership or
content fingerprint is minted by searching or confirming a product.

Native `silentDownload.control(batchId, paused)` and `transfers()` expose current in-process
batch identities and manual pause facts. Pausing holds queued files and calls DownloadItem.pause
for bound active items; continuing resumes the same attempts/partial files. Failed native
control reports failure instead of fabricated pause. User pause takes priority over automatic
task resume. Frozen download/task vocabularies are unchanged; pause is not cancellation,
restart persistence or authorization for additional files.

The live task adapter caches progress events for display only and re-reads task.list for authoritative
states. Native transfers publish the frozen progress envelope with public filename/byte metadata,
without local paths or URLs. Speed derives from observed byte/time deltas and expires when stale;
unknown totals remain indeterminate. File storage counts come from AMF batch checkpoints, distinct
from transport completion. Raw task diagnostics are reached from Settings → Experimental; Home no
longer advertises the raw queue. Experimental demo and UI-variant controls are retired.
`NotificationList` owns its shared stylesheet import, so the bell never depends on the retired
bottom taskbar to remove native button chrome. All task types/states keep row, main-button and
glyph backgrounds transparent, including hover; normal focus feedback and the panel remain.

The library's displayed cloud and local cards share page-scoped selection and context-menu
shortcuts. A single known product's adaptation menu sends `descriptionLinksTo` through the
unified library read face, replacing the wall with matching source products. The standalone
dependency-name dialog and its settings gate are retired. Cancellation after pagination restores
the pre-filter query, source/category/state, offset, view mode, selection, open detail and scroll;
empty and failed reads retain cancellation. The
[design standard](../design/design-standard.md#8-module-visual-language) owns these interaction and
detail-header rules; source clues do not establish production compatibility.

Main owns a VUA system tray icon throughout normal application execution. Double-click restores
and focuses the existing main window. The localized menu exposes update checking
and application exit. `DesktopWindowApiV1.shellCommandEvents` is an additive, closed native
desktop event face (`check-updates` / `bigscreen`), not a Provider method. Preload subscription
signals readiness; Main accepts that signal only from the local main frame and retains the latest
gesture until it is listening. Update checking opens About and runs a manual
read-only check independent of the automatic-check preference. The retained legacy `bigscreen`
event is inert in the renderer and is no longer emitted by Main's tray. Exit uses normal application shutdown. Closing Main still exits, and the tray is
destroyed at process shutdown. Theme/DPI variants rasterize the accepted VUA mark and design tokens
through `scripts/generate-tray-icons.ps1`; no new runtime image dependency is introduced.

## Account-guide browser

The account guide opens official Steam/VRChat registration pages and optional Unity/BOOTH pages,
plus manufacturer, headset-store or streaming pages required by the selected route.
Use the existing isolated built-in browser, with phone/headset/native-client handoff and saved
guide progress where needed. Reuse security enforcement; do not create an
Auth Broker service. Separate temporary account-guide partitions from AMF's BOOTH acquisition
profile and from one another except for required in-flow identity-provider navigation. Do not
persist these guide partitions; dispose/clear them when the guide session ends. Do not scrape
forms, intercept credentials, copy cookies, or log credential-bearing URLs/page content.

Main owns creating/discarding views and enforcing navigation, not an application credential store.
This responsibility split does not claim Electron Main is technically incapable of session access.
The local UI receives guide progress and user-declared completion only, not authenticated page data.
Official client or external-browser handoffs retain the existing per-action protocol confirmation.
If embedding fails, explain the fallback instead of bypassing platform restrictions. Users perform
registration, CAPTCHA, terms acceptance and account linking themselves. UI human acceptance covers
the flow and the distinction between opened, user-confirmed and actually detected outcomes.

The product boundary records later web-reading and experimental persistence intent; neither is
enabled by this first slice. Any future persisted profile needs explicit consent, local browser
storage and tested clearing/logout semantics, without secrets in application or Agent data paths.
Temporary embedded guide sessions remain intended architecture. The current UI uses the
official system-browser handoff, keeps the selected route available on return and imports no
browser session. This avoids routing registration through the persistent BOOTH acquisition
profile. Temporary embedding and authenticated platform adapters remain unimplemented.

## Deployment presentation

The [N1 delivery plan](../development/n1-delivery-plan.md) starts headset selection with brand and
model. The backend resolves official route requirements. Present cable/wireless questions only
where they affect the selected model, and keep optional alternative streaming choices explicit.

Silent installations retain a visible task. Render component, phase, real progress when exposed,
elapsed time, observed activity and required interaction. A UI timer is not installer evidence.
Extended inactivity exposes details and next actions. Reopening the page reads the existing task;
application restart uses the existing inspect-required recovery behavior. All copy uses i18n.

## Remote content isolation

Remote content uses `nodeIntegration: false`, `contextIsolation: true`, sandboxing, an isolated
session partition, and origin-scoped permission grants. Navigation and new windows follow the U9
four-way rule (user ruling 2026-09-09; browsing and downloads are separate tracks): navigation
inside the browsing allowlist proceeds directly; off-allowlist http/https navigation shows a
blocking confirmation first and then opens in the current embedded view (per-attempt confirmation,
no exempt-from-confirmation memory at any level); new windows are always denied, with http/https
popup targets redirected into the current embedded view (directly when allowlisted, after
confirmation otherwise); pseudo-protocol (`javascript:`, `data:`, `blob:`, `file:`, …) windows are
denied unconditionally; external protocols (initially `mailto:`, `steam:`, `vrchat:`,
`discord:`, and `unityhub:` for the N1 installation handoff — the [product boundary](../product-boundary.md) owns this list rule) go through a per-attempt dedicated confirmation before the system handler opens them —
the window-open details expose no gesture field, so the confirmation click itself is the explicit
user gesture and automatically triggered openings never execute without confirmation (a stricter
equivalent of the literal rule) — and unknown schemes are denied by default. The browsing allowlist and the
download host allowlist are strictly separate: browsing is lenient (off-allowlist content remains
reachable after confirmation; the list width only affects prompt frequency), downloads are strict
(download-host admission follows the "real-machine verification → per-domain proposal → user
approval" procedure; the download port filters by origin, and size, type, and source validation
belong to the AMF material-acquisition boundary). The capability surface contains standard web
APIs. AMF validates observed page data for type, size, and source before persistence.
Main-managed `WebContentsView` is the remote-content surface.

The 2026-10-11 ruling adds AMF **Browse assets**, initially at `booth.pm`, with VRCFinder,
BOOTHPLORER, Yorimichi, PolySeek, VRC STYLE, Avatar Network, Avatar Catalog and VRC DB
shortcuts. This is ordinary discovery; catalog synchronization, acquisition and local intake
keep their existing owners. Wiki has a nonpersistent host session and no AMF/download authority.
AMF browsing reuses its BOOTH profile; broader browsing origins do not broaden authenticated
reads, cookie persistence or strict download admission.

The Candidate [desktop-browser face](../protocols/desktop-browser-v0.1.md) leaves the header and
sidebar exposed for all presentations, including retained login/import. Trusted HTML measures
the main content below controls and wrapping shortcuts; Main converts page zoom to DIP and
clamps bounds. The session controller keeps up to eight site-browser tabs per knowledge/material
purpose in Renderer memory; Main retains their separate native histories and page state. Settings
and other page changes hide these tabs until return, without reopening the initial site. Only
the active tab receives visible geometry. Allowlisted web popups and Ctrl/middle-click shortcuts
can open another local tab; explicit close disposes only that tab. Full Main reload/window exit
disposes native views, and AMF shutdown disposes its material views. Global login closes on shell
navigation; leaving import also dismisses its modal. Native views yield to local navigation
confirmation cards. Failed sites offer retry or another shortcut without claiming installation
or material import. Tab metadata and browsing history are not written to application storage.

## Overlay always-on-top window

The accepted [guidance architecture](guidance.md) separates an in-app tour, the knowledge
encyclopedia in Help and a VRChat-window guide. React owns the tour and encyclopedia;
Main owns native windows and the game-window follow loop: a pure decision module driven by a 250 ms
observation of the Provider's read-only `environment.observeGameWindow` query
(`vua.game-window-observe/v0.1`), showing the guide without stealing focus and hiding it on
game minimize/exit/app-switch, with a Main-enforced follow toggle. User drags persist normalized
relative placement; automatic moves do not overwrite it. Background opacity affects the guide's
matrix/backdrop only, with a transparent outer canvas and opaque text. The renderer drives this
through two `DesktopWindowApiV1` members (`setGameGuideFollowing`,
`getGameGuideFollowStatus`). Guide progress is local presentation state;
business tasks remain authoritative in Orchestrator. The encyclopedia, tour and game guide
reuse A/B content, targets and reading recovery. [Desktop-window v0.2](../protocols/desktop-window-v0.2.md)
adds targeted encyclopedia navigation to Main through a local preload subscription. It queues
the latest target until the main renderer is listening and resets readiness on a full document
navigation, not an in-page route change. Legacy V1 reader calls retain the ordinary separate
window for compatibility; current preparation entries use the new face.

The following describes the retained task-status overlay, not the ordinary reader's window flags.
The desktop Overlay is a separate `BrowserWindow` inside the same Electron process (frameless,
transparent, absent from the taskbar, pinned at the `screen-saver` level; shape parameters come from
the overlay-window spike verification in `apps/desktop/scripts/spike-overlay.mjs`, mirrored by
`preview-overlay.mjs`). It shares the same `VuaDesktopApiV1` preload contract face with
the main window and, via the surface-routing parameter (`?surface=overlay-desktop`), renders only
the Overlay surface at the earliest application-initialization stage, without bootstrapping the main
shell Gateway, DEV scenario, or business stores. Failure isolation is carried by two layers: the
Orchestrator Provider is an independent supervised process, and an Overlay renderer crash is
isolated by the Electron process model — no separate Gateway connection instance is needed
(archived [proposal 017](../archive/2026-09-29/collab/proposals/017-overlay-surface.md) §4
desktop statement, 2026-09-10).

The Tasks entry requests the status view and has no guide/status switch. Production details
remain collapsed until requested. Existing explicit `showGuide` and view/target events remain
compatible; ordinary guidance uses Help, its encyclopedia and the game guide. The task
window applies shared saved appearance before paint, listens for cross-window storage and system
theme changes, and honors saved contrast/resource-saving preferences. Normal `pnpm dev:desktop`
uses the real Gateway task projection; only an explicit DEV `overlayPreview=1` enables demo data
and its badge. `preview-overlay.mjs` opts into that isolated demonstration.

- Business events broadcast to every locally-originated window by local origin checks, and
  Overlay windows are naturally on that list. Business snapshots use the existing query path;
  guide-target requests use their separate validated desktop-window event/acknowledgment path;
- No Overlay session identity: actions submitted from Overlay go through the existing command face
  with the same acceptance path and nine-state discipline; the service side does not distinguish
  whether an action came from the main window or an Overlay window;
- The entry is the fixed Home Tasks tile (outside DevScenario); show/hide toggling is
  arbitrated by Main (the decision face is a pure, testable function in `overlay-window.ts`);
  showing never steals focus; closing the Overlay window itself only clears the reference (the next
  toggle recreates it), and closing the main window destroys the Overlay — main-window close keeps
  its application-exit semantics;
- Overlay only consumes stable snapshots and semantic actions and never becomes a business-logic
  host (AGENTS architecture constraints; the consumption split follows proposal 017; see the
  Overlay boundary section in integrations-and-overlays.md), and Overlay failures never block the
  desktop mainline (standing delivery rule). `overlay.getSnapshot` is wired through Gateway and
  Provider to the production projection. Preserve task-status access while separating guides.
  First-play guidance works independently of that projection. The encyclopedia uses the main
  Help page; the game guide has adjustable transparency and automatic VRChat-window following.
  Headset reading uses SteamVR's desktop view of Main, with its own real-device acceptance.

## Standalone Windows packaging

New users receive enabled AMF alongside the host; existing saved choices are retained. Old
profiles without registration keep the former disabled default. AMF is installed with VUA;
Avatar editing explains it and exposes the enable
switch, while the disabled sidebar entry opens that setup section. Settings → Modules retains
the existing module controls. Explicit enablement starts the local
payload. Selection/readiness facts control its navigation, wizard entry and BOOTH
controls. AMF pages load in a local error boundary, and host bootstrap/task windows do not depend
on its production queries. [Module architecture](modules.md) owns selection, process lifecycle,
task ownership and legacy data retention.

`apps/desktop/electron-builder.yml` owns the Windows x64 ZIP layout. Compiled Main/preload/renderer
and their bundled JavaScript dependencies live in `resources/app.asar`; the native Provider lives
at `resources/provider/vua-orchestrator-provider.exe`; the optional AMF executable lives at
`resources/modules/amf/vua-amf-provider.exe`. Electron and its Chromium assets travel
with the app. Third-party game/streaming/Unity installers are not included in this ZIP.
The packaging build statically links the Provider's C runtime; it does not require a separate
Visual C++ runtime installation just to start VUA. Normal development builds remain unchanged.
Main and preload are built separately so the sandboxed preload needs no shared JavaScript chunk.
The archive excludes workspace sources, tests, development dependencies and the unused Mock Provider.

Packaged startup resolves resources from Electron's `resourcesPath`, independently of the
working directory or source checkout. Development-only Provider/renderer overrides are ignored
in the package. Normal packaged app data lives in `%APPDATA%\VUA`, outside the extracted program;
moving/replacing the program directory preserves it. The source launcher keeps its existing
development profile. A later NSIS package must retain the same data location.

The explicit `--vua-smoke-test=<absolute directory>` diagnostic uses an isolated profile and a
hidden window. It mounts the compiled renderer, sends read-only queries through the real preload
and Gateway to the bundled Provider, checks persistence and writes a local report before exiting.
The packaging harness extracts the actual ZIP outside the checkout, removes developer tools from
PATH, tests a moved directory and tests a missing backend. It does not install or launch games.
Commands and artifact paths are in the [desktop development entry](../../apps/desktop/README.md#windows-zip-preview).

## React and release boundaries

React implements workbenches, guidance, cards, Recipe editing, feedback, and accessibility while
domain models remain in the application core. Typed error codes map to localized messages. The UI
ships four initial locales — English, Simplified Chinese, Japanese, and Korean
(`apps/desktop/src/renderer/i18n/strings.{en,zh-CN,ja,ko}.ts`); the language policy is owned by
[documentation governance](../meta/documentation-governance.md#5-language).
Accepted tasks survive page unload. Drag-and-drop always has keyboard and button alternatives. Tokens and components are
promoted only after real-page validation.

Electron, Chromium, Node.js, packaging, the selected Orchestrator Provider, and native dependencies
are version-locked. The independent supervised Provider executable is packaged and verified for the
supported Windows architecture according to the accepted hosting decision. The
[first-play release](../development-outline.md#first-play-release-acceptance) brings forward the
ZIP, dependency/license review, applicable security checks and illustrated guidance. Local previews
record that they are unsigned; signing preparation runs alongside development. Full installer,
automatic updater and update-rollback validation follow under broader N7 acceptance. The
redistribution review authorizes each bundled binary before a public release.

### Library intake and card scope (2026-10-12)

The source selector **Local imports** sends the additional `imported` value of [library view](../protocols/library-view-v0.1.md). Downloading BOOTH material alone does not make it a local import. Local entry cards represent the user-selected material entry, including empty or missing entries; files remain in entry details. Physical-copy and source facts remain independent. [Card removal](../protocols/library-records-v0.2.md) confirms selected identities and count, persists tombstones and retains files/references. The retained local-record command remains available independently.

Marquee selection anchors its start in wall content coordinates. Pointer movement, wall scrolling and viewport changes recompute intersections; only the visual rectangle is clipped to the wall. Pointer release/cancel, blur, route unmount and wall replacement clean up listeners. Right-button completion uses the current selection.

The import split button opens the native folder picker for a single item. Its arrow opens the migration entry on hover/click; the latter currently supplies only read-only structural review. See the [draft migration design](../development/library-migration-design.md) for boundary decisions and unresolved execution. Candidate desktop-library adds bounded immediate-directory reads without following links or expanding ZIPs; AMF still owns copying.

The migration menu uses a fixed-position body portal, anchors at the import group's left edge
and clamps to the viewport; pointer transitions into the popup retain it. List mode shares title,
shop, variant and plain source columns across account products and imported entries. Draggable
header dividers resize neighboring columns together; narrow walls scroll horizontally. Native
active/paused transfers override durable download status, while presence failures remain errors.
Observed multi-variant choices are supplied separately from the frozen product summary.

The optional native `fs.navigation` face returns Electron's resolved Desktop/Documents/Downloads paths and logical drive names. Main queries drive names only, with a hidden bounded helper process; it does not poll drive readiness or sizes. The picker keeps a visible editable path field, four shortcuts and a virtual This PC list. Up at a drive root enters that list, which is not itself an importable directory.

## Installed Windows distribution

[Windows distribution architecture](windows-distribution.md) owns the signed bootstrap, complete mirrored Electron runtime, independent AMF UI/native entry, native helper, typed Desktop v3 updater and recovery. Development and legacy ZIP keep their existing resource paths. Folder-picker drive discovery uses the fixed host executable’s read-only `--list-drives` mode (`GetLogicalDrives` on Windows), rather than starting PowerShell or probing volumes.

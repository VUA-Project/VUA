# Electron desktop and presentation architecture


> Document version: 1.13.0
> Status: Accepted
> Scope: `apps/desktop`, `packages/design-system`, frontend Gateway
> Updated: 2026-10-09
> Last conformance review: 2026-10-09 (two-half environment cards, creator inventory and preserved shell preferences; physical app/device review pending)
> Normative effect: Yes

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

Main returns normalized navigation/download events through narrow ports and retains `Session`,
`WebContents` and `DownloadItem` handles. Browser storage owns cookies/tokens; they are not copied
into Main application state, Gateway, Orchestrator or Agent inputs. AMF owns acquisition intent, task and source
correlation, post-download inspection, and Warehouse/BDL decisions.

## Fixed directory and first-run journey

The main shell has one fixed Home, opened by its left logo. Desktop mode shows the fixed
Environment/Avatar directory in the sidebar; big-screen mode groups those domains into larger
focusable tiles. `nav-model.ts` retains internal page ownership for tasks and deep links without
restoring the old two-tab presentation. Wizard choices never hide features or change Home actions.
The [design standard](../design/design-standard.md#3-platform-and-information-architecture)
owns the accepted layout, logo colors, unavailable peers and preserved visual preferences.

`journey-model.ts` stores only a versioned reading/selection bookmark. Desktop/PICO and creator
routes use the existing typed network/deployment ports. A fresh plan or a task completed during
the current visit can establish software readiness; a restored terminal receipt alone cannot.
Reopening a completed preparation step reinspects files, and accepted tasks remain observable
through their receipts. A connection confirmation is explicitly user-declared, not headset evidence.
Opening Steam or a guide does not prove installation, login or successful play.

Play now has fixed two-half cards: details on the left and observed status/action on the
right. Normal game exit retains **Close** only while owned software survives, with no failure
warning. Network's equally tall tile is above the grid; its regional Ping is explicitly unavailable
until targets are verified and website tests remain in expanded details. The expandable runtime inventory stays
on Play. The retired Software & connections page is absent from Home, sidebar and tour;
old stored page IDs migrate to Play. Wizard choices still do not control these entries.
The typed play port consumes the Candidate [play-session family](play-sessions.md), keeps
unavailable observations distinct from missing software, and disables launch while installation
is active. Scoped deployment bookmarks retain Desktop and PICO work independently while
reading a matching legacy bookmark. Hidden details keep accepted installation receipts alive.

Avatar editing reuses `project.environmentManagers` and `environment.verifyEditor` to show
complete discovered editors; Unity 6 remains a development entry even when files are found.
The read-only `environment.inspectManagerApps` Candidate query reports Hub/VCC/ALCOM
executable findings from known roots and registry paths. Configuration findings keep their
original frozen semantics and do not imply that an executable is installed. Version/path data
remain local; unsupported versions only offer the accepted preparation route.

Settings navigation keeps the underlying route or wizard mounted and returns to its source
step and focus. The sidebar contains only settings categories while Settings is open, also in
big screen mode; the upper-left Back action and the active Settings button return to the same
source page. Category changes do not replace the return destination. Inspection belongs to the
Avatar directory; Help and Settings have no duplicate bottom-left entry, and the topbar does
not repeat the page name beside the Home logo.

The compact shell follows the [design standard](../design/design-standard.md#3-platform-and-information-architecture):
the bottom taskbar is no longer mounted, and feature search is a Settings-sidebar footer action
with the existing global shortcut. Appearance changes use joined native buttons backed by the
same three-value preference. A missing/invalid preference resolves to Dark; saved preferences
and cross-window/system subscriptions stay compatible. The app tour's task step navigates to
the fixed Home Tasks tile rather than a retired taskbar anchor.

Account-help navigation uses that same settings return path.
Settings → Accounts retains the N5 BOOTH sign-in/probe/logout surface; Steam, VRChat and Unity
authentication remain honest placeholders. Registration/linking pages add an official browser
handoff through `RemoteContentApiV1.openAccountGuideInBrowser(AccountGuideIdV1)` and the matching
preload/Main channel. This is an additive native desktop port, not a new Provider method or a
change to the frozen application envelope. Main checks local sender identity and maps the closed
ID to a fixed public URL; arbitrary URLs, page data and credentials do not cross this port.

Main owns a VUA system tray icon throughout normal application execution. Double-click restores
and focuses the existing main window. The localized menu exposes update checking, big screen
mode and application exit. `DesktopWindowApiV1.shellCommandEvents` is an additive, closed native
desktop event face (`check-updates` / `bigscreen`), not a Provider method. Preload subscription
signals readiness; Main accepts that signal only from the local main frame and retains the latest
gesture until it is listening. Update checking opens the Version settings page and runs a manual
read-only check independent of the automatic-check preference; big screen changes the existing
shell mode. Exit uses normal application shutdown. Closing Main still exits, and the tray is
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

## Overlay always-on-top window

The accepted [guidance architecture](guidance.md) separates an in-app tour, an ordinary
preparation reader and a VRChat-window guide. React owns the in-app tour; Main owns the two
window lifecycles and the game-window follow loop: a pure decision module driven by a 250 ms
observation of the Provider's read-only `environment.observeGameWindow` query
(`vua.game-window-observe/v0.1`), showing the guide without stealing focus and hiding it on
game minimize/exit/app-switch, with a Main-enforced follow toggle. User drags persist normalized
relative placement; automatic moves do not overwrite it. Background opacity affects the guide's
matrix/backdrop only, with a transparent outer canvas and opaque text. The renderer drives this
through two `DesktopWindowApiV1` members (`setGameGuideFollowing`,
`getGameGuideFollowStatus`). Guide progress is local presentation state;
business tasks remain authoritative in Orchestrator. The reader, tour and game guide reuse
A/B content, targets and reading recovery.

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
compatible; ordinary guidance uses Help, the preparation reader and the game guide. The task
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
  First-play guidance works independently of that projection. The preparation reader uses a
  normal window; the game guide has adjustable transparency and automatic VRChat-window following. Headset
  access uses SteamVR's desktop view of the reader, with its own real-device acceptance.

## Standalone Windows packaging

Fresh profiles enable host environment/play services without AMF. Settings → Modules selects the
bundled AMF payload; installed/readiness facts control its navigation, wizard entry and BOOTH
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
[documentation governance §2.3](../meta/documentation-governance.md#23-language-policy-user-ruling-2026-09-25).
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

## Document changelog

- 1.13.0 (2026-10-09): scope optional AMF frontend/BOOTH services to module readiness and document the two-provider payload; retain host task-window independence and legacy data paths.
- 1.12.1 (2026-10-09): align guide transparency/drag memory, normal game-exit cards and the regional-placeholder/expanded-website split with their owning documents.


- 1.12.0 (2026-10-09): implement observed two-half play sessions and scoped close, move network/runtime discovery into Play, and add complete-editor and manager-app inventory to Avatar editing.
- 1.11.0 (2026-10-09): apply the compact-shell ruling, move command search into Settings, replace the appearance select with joined buttons and a Dark default, and retarget the task-tour step to Home.
- 1.10.0 (2026-10-09): implement settings-only sidebar/return, separate real task status and appearance from guides/demo previews, and add the localized VUA tray with typed main-renderer gestures and normal shutdown.
- 1.9.0 (2026-10-08): record fixed navigation, desktop/big-screen focus, independent wizard/task facts and the closed official account-page browser handoff; temporary embedding and device acceptance remain pending.
- 1.8.0 (2026-10-08): record the implemented game-window follow loop in Main (game-window-observe
  v0.1 observation, follow decision module, and the setGameGuideFollowing /
  getGameGuideFollowStatus desktop API faces).
- 1.7.1 (2026-10-07): record separate guidance presentations and retain automatic following as unfinished work.
- 1.7.0 (2026-10-05): route three guidance contexts to their owning design and distinguish the current combined overlay from its planned replacements.
- 1.6.0 (2026-10-03): define standalone ZIP resources/data, the real packaged bootstrap check and the first-play overlay/release subset.

Earlier entries remain in Git history.

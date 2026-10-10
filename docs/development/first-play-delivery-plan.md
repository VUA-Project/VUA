# First play release: implementation checkpoint and remaining work

> Document version: 1.17.0
> Status: Accepted
> Updated: 2026-10-10
> Scope: Desktop play, PICO 4 Pro USB/Wi-Fi, optional eye tracking and three guidance contexts

For people: this release takes a player from missing play software to playing VRChat, with
instructions in the place where each activity happens. VUA's own tour, the knowledge encyclopedia
inside Help and the manual VRChat game guide have distinct presentations and progress.

For Agents: build on the `72a22e15` baseline collected in PR #61 and the subsequent slices
recorded below. This plan records delivery
status and next work; the [product boundary](../product-boundary.md#first-play-release-user-ruling-2026-10-03)
owns scope, the [N sequence](../development-outline.md#first-play-release-acceptance) owns
acceptance, and [guidance architecture](../architecture/guidance.md) owns the new presentation split.
The [broader N1 plan](n1-delivery-plan.md) retains later device and creator routes.

## Release focus after the 2026-10-08 ruling

Apply the [Ibis newcomer-journey criterion](../product-boundary.md#ibis-release-criterion-user-ruling-2026-10-08).
The detailed work below is a delivery backlog, not a list of independent publication gates.
Prioritize these concrete checks on the same candidate build:

1. The download page offers the actual Windows x64 ZIP, with understandable extraction/start
   instructions, version and signature status. Source archives are not a player download.
2. A newcomer can choose desktop or PICO, understand the relevant network/software findings,
   complete acquisition or its official-client handoff, return, log in and start the selected
   route. Verify missing-software installation and actual desktop/PICO USB/Wi-Fi play; installed
   files, the reuse baseline and synthetic UI checks do not establish those outcomes.
3. A failed step or interrupted handoff leaves the current action and guidance available on
   return. After software preparation, the player can find the selected route's launch guide.
   Closing guidance does not stop accepted work or play.

Current source review found and repaired lost official/guide entries on return, obsolete
execution consent after task acceptance, and the lack of a next guide after play prerequisites
were found. Four-language controlled UI checks cover those handoffs; they are not an integrated
game/hardware pass. The revised text distinguishes desktop mode and software detection from
successful play. The previous acquisition preview ZIP did not include these repairs; a new
candidate must use this revised source and be exercised as a single integrated build.
The [public Release](https://github.com/VUA-Project/VUA/releases/tag/v0.5.0)
still has no player asset as checked on 2026-10-08.

Clear Steam handoffs can finish the core journey without adding automatic library installation
or launch. A checked tutorial-world list, VRCFT automation, further guide polish and exhaustive
edge-case coverage remain follow-up unless a concrete problem blocks the advertised journey.
Keep their availability and non-blocking issues honest. No Sandbox is required: the author
deferred that test method on 2026-10-08, and another Windows baseline can supply the missing
installation evidence. Finish exact-build notices and concise release instructions at publication.

The 2026-10-09 environment-card slice adds two-half Play cards, network/runtime facts on the
same page, verified extra editor listings and separate Hub/VCC/ALCOM application/config facts.
Candidate launch/close sessions reuse existing processes, observe all required applications,
close only software started by this card and report survivors or outstanding Steam handoffs.
Software & connections is removed as a separate page. These changes preserve the approved
wizard and compact shell. Controlled UI/process/schema checks cover recovery and scope;
Steam/PICO vendor behavior and headset play remain physical acceptance work on the candidate.
No new ZIP is produced during the author's development-UI review.

The 2026-10-10 interaction correction standardizes collapsible Play/Tools/editor details and
tool card dimensions; four Help cards now enter main-window child pages with native browser
history, including encyclopedia chapters and replay-wizard choices. AMF setup is explained in
Avatar editing with an explicit switch and a sidebar shortcut while disabled. Language selection
moves above Settings search, and About retains the former Version controls; empty Donation is
removed. Controlled UI checks cover these actions, not real mouse/headset/vendor acceptance.

The revised [N sequence](../development-outline.md) puts host isolation before scenario
prerequisite/deployment/SOP work, expands selected module/software sources in N2 and keeps
N3/N4 in AMF and N5 in AMF + BDL. N6 is delivered with each scenario, while N7 records host and
module release scope separately. Existing N1/N5 code and reviews are retained; neither stage
is declared formally complete without its required real-machine/material and human evidence.

## 1. Completed work to build on

| Slice | Delivered and checked | What remains outside that result |
| --- | --- | --- |
| Windows ZIP bootstrap (`b95ac31a`) | Compiled desktop plus real bundled Provider; fresh extracted launch without a checkout/toolchain, Unicode/space path, moved-directory restart, external data profile and missing-backend failure were exercised | Final release artifact, signing/distribution and actual play acceptance |
| Historical regional network checks (`d68490d5`) | The original service/region/advice slice was exercised; the 2026-10-09 ruling retires its region identification and accelerator UI | Retained query compatibility only; current website/region-Ping status is recorded below |
| Guide A (`679db558`, `a3f8feae`, `1fd76422`) | Four-language first-play text, six reusable diagrams, captions, account-route corrections, keyboard navigation and readable panel access | Hardware verification and new room-preparation detail; the new app tour and game guide |
| Guide B (`c3183dc0`) | Deployment-to-section entries, typed/validated targets, window open/hide/return, reading recovery, relative packaged media URLs and four-language previews | Routing those features to the three distinct contexts |
| B review fixes (`a6682196`, `524e03f5`) | Single-use URL/IPC targets, status-view return, bounded layout retry, page-bottom positioning and yielding after programmatic positioning; targeted tests and app/renderer reproductions reviewed | One small pre-first-frame manual-scroll edge case, listed under the reader slice |
| Development profile isolation (PR #63, merged here by `67e3f8c1`) | Per-checkout development profiles and separate stable packaged profile; the N1 app restarts without sharing its development database with other checkouts | Recheck the final integrated build; installed Steam/PICO software and hardware are still shared |

Subsequent implementation: `aa5ada4c` adds the ordinary reader and fixes pre-first-frame user
scroll cancellation; `acef54a0` adds the six-step anchored app tour; `72a22e15` adds the manual
game guide with step confirmation/skip and persistent 50% default opacity. Task status keeps a
separate entry. Automatic VRChat-window following has since landed (§2.C); its real-machine
acceptance and a checked tutorial-world list remain.

`5ff2dfd1` replaces the main network form with VRChat/Steam/GitHub test cards, custom HTTPS
destinations and individual/all tests. Its regional-help UI is superseded by the 2026-10-09
network ruling and removed; website tests now live in expanded details on Play.
`0a00cad0` adds the theme-aware VUA brand mark. The website icons use attributed Simple Icons.

The existing deployment layer inspects software, builds confirmed plans and exposes task progress.
`b49e064f` on `slice/steam-pico-acquisition` adds official Steam/PICO Connect acquisition, signature verification,
native installation and bounded entry-file reinspection. PICO's explicit usage region selects
separately pinned mainland/global 10.6.6 artifacts. The typed consumer and four-language UI
accept vendor activity/errors and restore accepted task monitoring on return. Synthetic tests
and static installer inspection are separate from the pending [real installation checklist](steam-pico-acquisition-checklist.md).
The existing-software baseline and Provider replay after restart passed locally on 2026-10-08;
no installer ran. Separate mainland/global Windows Sandbox inputs were prepared but the author
deferred that method; the missing-software baseline remains unexecuted.
VRChat/SteamVR installation remains a manual Steam handoff. The Play cards now provide the
closed launch/close route described in the checkpoint below; actual play acceptance remains pending.
VRCFT now has the Candidate connection described below; real vendor and tracking acceptance remains.

Dated raw evidence remains local: `_local_real_machine/n1-play-zip-2026-10-03.md`,
`_local_real_machine/n1-network-2026-10-03.md`, and `_local_preview_ibis_a/` review logs/screenshots.
Their bootstrap, controlled UI and physical-hardware results are different evidence categories.
Refresh evidence after changing the affected path rather than rerunning every old check.

## First-run UI checkpoint (2026-10-09)

PRs #64 (dependency patch), #65 (game guide following) and #66 (N5 material management) are
merged and integrated with the Steam/PICO acquisition slice on `slice/first-run-main-ui`.
The accepted wizard and fixed Home now use the existing plans, tasks and guide windows. Logo
Home access, domain/theme colors, concise main tiles, equal disabled Quest/Unity 6 peers,
mouse-oriented desktop mode were implemented; the temporary keyboard big-screen mode was
retired by the 2026-10-10 ruling below. Matrix/grid, sidebar
and small-window glass and resource saving remain. Account help opens Accounts, dedicated guides
and a fixed official system-browser handoff, then returns to the selected preparation step.
The author's 2026-10-09 development-mode corrections are implemented: Settings replaces the
business sidebar and returns to the same workflow, Inspection belongs to Avatar, duplicate
sidebar Help/Settings and the topbar page name are removed, and headset choices use recognizable
brand glyphs. Tasks shows actual Gateway facts without a guide switch and follows saved/system
appearance. A localized VUA tray restores Main and exposes update checking and exit;
its temporary big-screen entry is retired.
The follow-up compact-shell corrections narrow the sidebar, retire the bottom taskbar and
header Tasks/display/theme/search controls, place search at the Settings-sidebar bottom, and
use connected Dark/Light/System appearance buttons with a Dark default. Saved theme choices,
matrix/glass, motion fallbacks and the global search shortcut remain. The task-tour step now
points to Home's Tasks tile with matching four-language instructions.

Controlled Chromium checks cover route choices, disabled peers, unknown/missing software,
manual handoff/reinspection, account return/back and four-language minimum
window layout. These checks use synthetic Gateway facts and establish UI behavior only.
`pnpm --filter @vua/desktop smoke:first-run-ui` reproduces the branching, readiness, account-return
and native Chromium button activation in an isolated Electron session without installing software or signing in.
Its checks also cover settings-only navigation, source preservation, tray-renderer
gestures, live task-port selection in DEV, compact navigation/search, the Home task-tour anchor,
a Dark default on a Light system, connected appearance choices, reduced-motion/resource-saving
fallbacks, separate language/search rows in a small desktop window,
and cross-window/system appearance changes.
`pnpm --filter @vua/desktop smoke:system-tray` adds eight native Electron API checks with
programmatically invoked tray events. Physical Windows tray clicks still require author review.
No new ZIP was made for these changes: the author is reviewing `pnpm dev:desktop` first.
Restart that development command once to load Main/preload changes, including the tray.
The subsequent Play/Avatar-editing correction gives each Play card two independent halves:
left details and right observed status/action. Network tests sit above the same-height cards;
runtime facts live on Play and the separate Software & connections page is retired. Installed
Desktop/PICO cards start the required software chain, reuse existing processes, and offer a
bounded normal close for this card's newly started processes only. Fresh native file/process
observations, rather than saved deployment receipts, choose the action. Provider failures remain
unknown; pending launch, scoped cancellation and close survivors stay recoverable. The
[play-session owner](../architecture/play-sessions.md) defines the Candidate contract and scope.
Avatar editing shows Unity 2022, a disabled Unity 6 peer, other verified complete installations
only when discovered, and distinct Unity Hub/VCC/ALCOM executable findings. Manager configuration
is a separate observation. Unsupported editor versions do not gain production compatibility.
The additional controlled UI cases cover these card states and inventory with synthetic facts.
The 2026-10-09 source checkpoint passed 124 desktop test files / 1121 tests, 14 contract test
files / 211 tests, the Rust workspace and affected native rechecks, Clippy, type checking,
i18n/boundary/contrast checks, renderer build and production leak checks. The 73 controlled
Chromium checks are separate from real installer, game, controller and headset evidence.
Restart development once to load the new native operations; `pnpm dev:desktop` now rebuilds
the native provider before opening Electron. An already running old provider is not replaced
or terminated by a failed build.

### Author-reported guide/game-exit corrections (2026-10-09)

The author reports that the Desktop card starts an actual game window. Manual game exit left
an incorrect warning, and the guide's opacity slider failed to reveal the game background;
focus restoration also discarded dragged placement. These observations identify defects,
not acceptance of the whole Desktop/PICO journey.

The guide now keeps its native/outer canvas transparent and applies the slider only to the
matrix/background. Text remains opaque. Native user drags update a normalized local preference;
automatic moves do not overwrite it. App switching, minimize/restore, manual reopen, new game
sessions and application restart retain relative placement within available game bounds.

Play observation treats process disappearance after a successful start as normal completion.
If owned applications survive, show × **Close** without a false warning; once all owned apps
are gone, release the session and restore Play. Observation never closes a borrowed application.

The network tile has Europe, United States East/West together, and Japan. No reliable public
game-region targets have been verified; regional Ping is explicitly unavailable. Website tests,
including Steam and GitHub, stay in expanded details. Connection help, usage-region identification
and accelerator recommendations are removed. The author will investigate actual room connections;
this placeholder does not block the play path or add a separate publication gate.

The repaired source passed 125 desktop test files / 1126 tests, 14 contract test files / 211 tests,
the ten native play-session tests, two provider wire tests and affected Clippy/type checks.
Play's Candidate v0.2 adds normal completion while retaining v0.1 schemas/vectors unchanged.
The isolated real Chromium guide smoke measured background alpha 51/255 and 204/255 at 20%/80%,
with eight checks. Four-language website UI checks passed ten cases per locale. The 76 main-page
UI checks, build/boundary/i18n/contrast and production leak results are recorded with this source; none of
these tests launches the real game, vendor installers or headset. The author still needs to
recheck the repaired guide and actual exit behavior after fully quitting the old development
instance and restarting `pnpm dev:desktop`. No ZIP is produced during this UI review.
Unit/type/boundary/i18n/contrast/leak checks and the integrated preview build are recorded with
the candidate. The author's acceptance of the design is distinct from review of the running app.
Physical controller input, missing-software installers, actual desktop/PICO play and four-language
human review still need the same candidate at the author's chosen test location. No Sandbox run
was added. Temporary embedded registration sessions remain parked; the official browser handoff
is available without importing credentials or sessions. N5 merge is not an N5 stage-acceptance claim.

## Help and compact Play checkpoint (2026-10-10)

Environment now contains Play, Avatar editing, Tools and Help. The topbar Help button is removed.
Help exposes Getting started, the existing app tour, Knowledge encyclopedia and In-game assistant.
The encyclopedia reuses the preparation content, reading bookmark, targeted sections and media
inside Main. Hardware introductions explain model identification and play/connection choices;
Play links directly to this chapter. All Play cards, including network, are half-height at
88 px, retaining the two halves. Resource details omit sampling time.

Tools reserves grouped entries for the seven N2 Steam integrations and the separately requested
VRCS translation tool. These are honest disabled development entries: this navigation slice
adds no installer, tool adapter or plugin-host authority and does not make all of N2 an Ibis gate.
The later VRCFT connection checkpoint below supersedes that card's development placeholder.
AMF activation stays independent.

## VRCFT connection checkpoint (2026-10-10)

Tools now offers a supported-device picker and asks for the app/streamer where it changes the
hardware module. PICO, Quest Pro, other supported headsets, add-on trackers and phone/camera
choices link to their corresponding upstream instructions. VUA connects the official Steam
install/start handoff, observes installation/process facts, and requests normal close only for
this run's VRCFT instance. Modules stay in VRCFT's registry/package installer; OSC and actual
tracking are verified by the player. Switching choices clears obsolete SOP progress.

The [connection plan](vrcft-integration-plan.md#source-checkpoint-and-pending-acceptance) records
controlled recovery/UI checks and real read-only installed-file reuse. Actual missing-app
installation, vendor launch/exit, module installation and PICO USB/Wi-Fi tracking remain pending.
Other N2 tool cards retain development status. No additional tool, physical-acceptance claim
or test ZIP is introduced by this source checkpoint.

Controlled Main/preload/renderer checks cover navigation, same-window hardware reading,
contextual section requests, reading return, settings/light appearance and compact layout.
Source checks and unit tests remain separate from physical controller input, vendor
installation, actual desktop/PICO play and four-language human review. No new ZIP is produced
during the author's development-UI review.

The subsequent 2026-10-10 correction places each Play/Tools/editor/manager detail directly under
its own card, with second-click collapse and retained preparation state. Settings uses a compact
language selector with a translation glyph above Search, with spacing verified at 960×600.
Goal reselection is removed and old links open Help's getting-started wizard. Big-screen mode
is retired, including Theme/tray controls, alternate layouts and directional shell navigation;
old preferences are cleared and legacy commands are inert. The controlled production consumer
checks these behaviors and the native tray check retains update/exit and double-click restore.
This does not replace pending physical installation, PICO or material acceptance.

## 2. Next focus: deliver the three guidance contexts

### A. Knowledge encyclopedia (formerly the preparation reader)

The ordinary reader landed in `aa5ada4c`. The 2026-10-10 ruling supersedes its separate-window
presentation with a page inside Help; legacy V1 calls retain their original window compatibility.

Reuse A/B text, media, section links, reading recovery and keyboard controls in Main's Help page.
Route preparation help there through desktop-window v0.2, preserve the current reading
bookmark, and keep task-status access working separately. Add practical room/play-area
preparation instructions and retain hardware-specific detail for the real-machine pass.

The pre-first-frame manual-scroll follow-up from B is fixed in the reader commit, with a narrow
regression case alongside the existing positioning tests.

Check the encyclopedia in development and packaged form: explicit section opens once, ordinary
reopen restores reading, a page-bottom target settles, user scroll stays in control, illustrations
load, keyboard reading works, and leaving Help does not stop installation or the game. Review
four locales at the supported window sizes. Headset readability is checked in the PICO run below.

### B. VUA app tour

The original tour landed in `acef54a0`. The 2026-10-10 ruling now starts a new profile with
the author's four-language welcome, then introduces real Home, Play, Tools, Avatar-editing
preparation/AMF enablement, Tasks, Help and Settings controls. Finish/skip enters the independent
branching wizard. Existing onboarded profiles are not welcomed again; active reading bookmarks
resume by feature identity across the local v1 → v2 migration. Help/Search can replay it.

The same slice replaces the full-window opening with the approved 480 × 320 DIP native logo/ray
window and loading circle. System-language ordering was already designed; Main now supplies the
Windows preference list, with supported language-family matching and English fallback, while a
saved manual choice remains authoritative. The new local desktop-startup face is Candidate.

Controlled production-Main/preload/renderer checks cover native presentation/teardown, all four
welcome phrases, short-window layout, actual feature anchors, finish/skip/restart, legacy active
steps, existing profiles and resource-saving startup. Dedicated ordered/unsupported-language
cases cover fallback without treating browser defaults as Windows preferences. The existing Help
and AMF smokes now traverse the first-use tour before the wizard. Source checks are not an
installer/device pass or four-language human review; those remain below. No new local ZIP is
made during the author's UI review. The tour still requires neither a general tutorial service
nor AMF activation.

### C. VRChat game guide

The manual edition is implemented in `72a22e15`: separate transparent window, manual positioning,
hide/reopen, confirmation/skip and independent persisted progress/opacity. The game-window
observer and automatic lifecycle landed on 2026-10-08: a versioned read-only provider query
`environment.observeGameWindow` (`vua.game-window-observe/v0.1`) reports absent/waiting/ready
window state, and Electron Main runs the follow loop (geometry following with DPI conversion,
focus-free `showInactive()` showing, hiding on minimize/exit/app-switch, session-keyed manual
hide, and a Main-enforced follow toggle persisted renderer-side), with the toggle and an honest
status line in all four locales. Tutorial-world guidance currently explains in-game search;
curated world identifiers await the author's verification.

The delivered behavior implements the accepted defaults and lifecycle from
[guidance architecture](../architecture/guidance.md#4-vrchat-game-guide):
following enabled by default, 50% transparency, persisted preferences, game-bound positioning,
background/minimize hiding, restoration without focus stealing, and manual hide taking
precedence. Dragged relative placement is now retained and background-only transparency is
covered by a real Chromium alpha check. Workspace and contract tests plus a local fake-window
smoke cover the loop; the author's reported defects and subsequent repairs are recorded above.

Remaining work: prepare a small checked tutorial-world list by learning language, with a
local-guide route when no suitable world is listed; no game-account session is needed. Remaining
acceptance: exercise the actual VRChat window — absent game, startup, movement/resize,
minimize/restore, Alt-Tab, clicking guide controls, explicit hide/reopen, exit/relaunch and
monitor/DPI changes. Verify readable default transparency and independent progress in all three
contexts, including background adjustment and dragged placement after focus/restore/restart. These
repairs still require the author's current-build check. This desktop-window feature does not
require a native headset overlay.

## 3. Finish the usable play paths

| Work | Concrete implementation still needed | Completion run |
| --- | --- | --- |
| One desktop/PICO route | Implemented in the first-run UI and fixed feature routes: network, selected prerequisites, plan/task return, PICO connection guidance and Steam play handoff. The author reports Desktop launch; integrated Desktop/PICO acceptance remains pending | Start with either choice and reach the next useful action without configuring unrelated creator software |
| Steam and PICO acquisition | Implemented on `slice/steam-pico-acquisition`: official download/trust gates, explicit mainland/global PICO selection, `/S` native elevation, activity/errors, entry-file reinspection and task return. Vendor-specific silent behavior and actual completion still need acceptance | Follow the [slice checklist](steam-pico-acquisition-checklist.md) for missing-software, failure/cancellation and reuse. The integrated UI keeps Steam library installation/launch as explicit user handoffs |
| Steam library and game launch | Hand VRChat/SteamVR installation to Steam, explain the expected Steam action, reinspect after return and launch the selected play mode. Keep the task/guide usable during downloads | Steam registration/login or existing account → install VRChat → start desktop mode → enter a world and use controls/audio/microphone |
| Account handoffs | Connect official registration pages and client/headset handoffs to resumable guide steps; retain external-browser fallback and separate opened/user-confirmed/detected states | Interrupt and return from a page/client without losing the selected route; the player performs login, verification and agreements |
| PICO USB | Finish official PICO Connect/SteamVR setup guidance and launch path, using the test machine's actual software/firmware wording | PICO 4 Pro: image, head/hand tracking, controllers, audio/microphone, then read the preparation window through SteamVR desktop view and return to play |
| PICO Wi-Fi | Add the route-specific local-network checks, connection instructions and reconnect recovery | Repeat headset play over Wi-Fi, disconnect/reconnect, and start a later session without repeating installation |
| Optional eye tracking | Exercise the Candidate VRCFT install/start connection and device-specific upstream module guidance; complete physical calibration/OSC setup | Missing-app Steam installation and vendor launch/exit, then existing compatible Avatar: actual gaze/blinking over USB and Wi-Fi, microphone coexistence, disconnect/reconnect and later-session reuse |

Use the existing planner, task model and typed Gateway rather than creating a second installer
framework. Keep `pico_pcvr` wire compatibility until an explicit contract migration changes it.
Show what an upstream client is doing and what the player must do next; receiving an open-link
receipt is not an installation result.

The first-play eye-tracking option advances only VRCFT/PICO from N2. Space Calibrator and the
other external tools remain in their N2 delivery, with no extra tool tutorials added here.
Unity, Avatar production and Recipe work are outside this release's required path.

## 4. Recovery and release completion

After each usable path lands, exercise its failure/return case rather than saving all recovery
work for the end. Reattach to accepted tasks when returning to a page; after app restart inspect
recorded work and explicitly continue/retry. Preserve satisfied components and user choices.
Cover a failed download, an interrupted user handoff, declined installer interaction and a later
play session. A closed guide must never become a cancelled deployment task.

Finish the release with these bounded tasks:

1. Run the selected-software-absent and reuse paths on the recorded Windows machine. Preserve
   user data during already-authorized uninstall/reinstall; describe the resulting baseline
   accurately. Exercise the core desktop, USB and Wi-Fi journeys. Optional-eye-tracking
   acceptance remains separate and pending until actually run.
2. Review the integrated UI with the author: four locales, narrow/resized windows, supported DPI,
   keyboard/focus, guide transparency and real external handoffs. Replace stale instructions
   found during the headset run. Create the user-facing illustrated guide from the actual build;
   distinguish screenshots from A's diagrams.
3. Build the final standalone ZIP and rerun the relevant packaged smoke, including guide media
   under `file://`, fresh isolated data and retained settings after moving/updating the app.
   Run the affected checks on the integrated revision and the Windows artifact workflow.
4. Prepare exact-build dependency/license notices, version/source identification, ZIP update/
   removal instructions, known issues and Chinese release notes. Choose the product version
   under the [version policy](../release/versioning.md); N stage numbers do not prescribe it.
5. Prepare the signing application/integration alongside development, then record the actual
   signature status of the published ZIP. Preview artifacts remain clearly labeled until that
   path is ready. Publishing and any external identity/legal attestations follow the author's
   release decision; they do not hold up local feature implementation.

The author's direct participation is needed for account verification/agreements, wearing and
operating the headset, eye calibration and human UI review. Agents can prepare the software,
automated checks and exact next instructions before each such step. Existing accounts/devices
can validate reuse; the separate missing-software run supplies installation evidence.

## 5. N5 and scope of this checklist

N5 is an independent development stream. It will be reviewed separately when complete and can
ship in the same release after that review. This checklist does not inspect its implementation,
estimate its remaining work, change its plan, or make material management an extra first-play
prerequisite. There is no dependency on waiting for Recipe/AMF completion.

When reviewed N5 work joins the release branch, preserve both streams' shared exports, locales
and capabilities and rerun the affected integrated build/startup checks. Keep separate development
profiles; do not rename a user's database to make an older checkout start. This is shared-build
integration, not a substitute for N5's own review and acceptance.

## Optional AMF boundary

Ibis installs AMF with VUA and enables it for new users under the latest 2026-10-10 ruling.
Existing choices remain unchanged; older profiles without registration keep the disabled default.
Enabled AMF supplies its navigation and separately supervised services. External Avatar-editing modules and their
placeholder entries are deferred beyond Ibis under the 2026-10-10 user ruling.
AMF failure/disable leaves play, device detection and game guidance available.
The host task window reads core tasks without requiring production documents. Legacy AMF data stays
in place, with owner-specific transactional task imports; [module architecture](../architecture/modules.md)
owns the detailed lifecycle/data rules. Controlled isolation evidence is separate from real software
installation, PICO connection, real-material production and four-language human acceptance above.

## Document changelog

- 1.17.0 (2026-10-10): record the Candidate VRCFT connection and device/module guidance, supersede its earlier placeholder and retain vendor-installation and physical-tracking acceptance without another ZIP.
- 1.16.0 (2026-10-10): align fresh AMF activation with the latest user ruling while retaining old-profile choices and independent real-software, device and production acceptance.
- 1.15.0 (2026-10-10): record the approved small native opening, Windows language handoff and first-use welcome/tour continuity, with controlled UI evidence and unchanged physical/human release acceptance.
- 1.14.0 (2026-10-10): record per-card detail placement, separated compact language/Search controls, goal-link migration and full big-screen retirement while retaining pending device/install/material acceptance and no local ZIP.
- 1.13.0 (2026-10-10): record unified card toggles, Help history, Avatar-editing AMF setup and consolidated Settings; align scenario-stage ownership while retaining pending physical acceptance and no new ZIP.
- 1.12.0 (2026-10-10): record environment Tools/Help, embedded hardware/knowledge reading and compact Play checks without claiming new tool integrations, hardware acceptance or another ZIP.
- 1.11.0 (2026-10-10): keep AMF installed with VUA but require explicit first activation, retain saved choices/data and defer external Avatar-editing module integration from Ibis.
- 1.10.0 (2026-10-09): record optional AMF startup and core task/guidance independence without replacing pending physical release acceptance.
- 1.9.0 (2026-10-09): record author-reported guide/normal-exit defects and source repairs, background-alpha evidence, removed network advice and unavailable regional Ping without another ZIP or physical-acceptance claim.
- 1.8.0 (2026-10-09): record two-half play cards, scoped observed launch/close and creator inventory while retaining real vendor/device checks and the author’s no-package UI review.

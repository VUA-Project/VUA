# First play release: implementation checkpoint and remaining work

> Document version: 1.2.0
> Status: Accepted
> Updated: 2026-10-08
> Scope: Desktop play, PICO 4 Pro USB/Wi-Fi, optional eye tracking and three guidance contexts

For people: this release takes a player from missing play software to playing VRChat, with
instructions in the place where each activity happens. VUA's own tour, a preparation reader
and the manual VRChat game guide now have separate presentations.

For Agents: continue from `72a22e15` on `slice/n1-device-onboarding`, collected in PR #61.
The next PR continues the outstanding play paths below. This plan records delivery
status and next work; the [product boundary](../product-boundary.md#first-play-release-user-ruling-2026-10-03)
owns scope, the [N sequence](../development-outline.md#first-play-release-acceptance) owns
acceptance, and [guidance architecture](../architecture/guidance.md) owns the new presentation split.
The [broader N1 plan](n1-delivery-plan.md) retains later device and creator routes.

## 1. Completed work to build on

| Slice | Delivered and checked | What remains outside that result |
| --- | --- | --- |
| Windows ZIP bootstrap (`b95ac31a`) | Compiled desktop plus real bundled Provider; fresh extracted launch without a checkout/toolchain, Unicode/space path, moved-directory restart, external data profile and missing-backend failure were exercised | Final release artifact, signing/distribution and actual play acceptance |
| Regional network checks (`d68490d5`) | Per-service checks, correctable usage region, mainland-only UU guidance, retry/continue and four-language UI; live Provider and controlled UI cases exercised | Integrated game login/loading and physical local-network checks |
| Guide A (`679db558`, `a3f8feae`, `1fd76422`) | Four-language first-play text, six reusable diagrams, captions, account-route corrections, keyboard navigation and readable panel access | Hardware verification and new room-preparation detail; the new app tour and game guide |
| Guide B (`c3183dc0`) | Deployment-to-section entries, typed/validated targets, window open/hide/return, reading recovery, relative packaged media URLs and four-language previews | Routing those features to the three distinct contexts |
| B review fixes (`a6682196`, `524e03f5`) | Single-use URL/IPC targets, status-view return, bounded layout retry, page-bottom positioning and yielding after programmatic positioning; targeted tests and app/renderer reproductions reviewed | One small pre-first-frame manual-scroll edge case, listed under the reader slice |
| Development profile isolation (PR #63, merged here by `67e3f8c1`) | Per-checkout development profiles and separate stable packaged profile; the N1 app restarts without sharing its development database with other checkouts | Recheck the final integrated build; installed Steam/PICO software and hardware are still shared |

Subsequent implementation: `aa5ada4c` adds the ordinary reader and fixes pre-first-frame user
scroll cancellation; `acef54a0` adds the six-step anchored app tour; `72a22e15` adds the manual
game guide with step confirmation/skip and persistent 50% default opacity. Task status keeps a
separate entry. Automatic VRChat-window following and a checked tutorial-world list remain.

`5ff2dfd1` replaces the main network form with VRChat/Steam/GitHub test cards, custom HTTPS
destinations and individual/all tests. Regional help remains collapsed and region-aware.
`0a00cad0` adds the theme-aware VUA brand mark. The website icons use attributed Simple Icons.

The existing deployment layer inspects software, builds confirmed plans and exposes task progress.
`slice/steam-pico-acquisition` adds official Steam/PICO Connect acquisition, signature verification,
native installation and bounded entry-file reinspection. PICO's explicit usage region selects
separately pinned mainland/global 10.6.6 artifacts. The typed consumer and four-language UI
accept vendor activity/errors and restore accepted task monitoring on return. Synthetic tests
and static installer inspection are separate from the pending [real installation checklist](steam-pico-acquisition-checklist.md).
The existing-software baseline and Provider replay after restart passed locally on 2026-10-08;
no installer ran. Separate mainland/global Windows Sandbox inputs are prepared for the
missing-software baseline, which remains unexecuted.
VRChat/SteamVR remain manual Steam handoffs; acquisition does not complete the play/launch route.
VRCFT has guide content but still needs the first-play detection/install/launch connection.

Dated raw evidence remains local: `_local_real_machine/n1-play-zip-2026-10-03.md`,
`_local_real_machine/n1-network-2026-10-03.md`, and `_local_preview_ibis_a/` review logs/screenshots.
Their bootstrap, controlled UI and physical-hardware results are different evidence categories.
Refresh evidence after changing the affected path rather than rerunning every old check.

## 2. Next focus: deliver the three guidance contexts

### A. Ordinary preparation reader

Implemented in `aa5ada4c`; the following describes its delivered behavior and focused acceptance.

Create a normal, opaque, resizable guide window. Reuse A/B text, media, section links, reading
recovery and keyboard controls. Route preparation help there, preserve the current reading
bookmark, and keep task-status access working separately. Add practical room/play-area
preparation instructions and retain hardware-specific detail for the real-machine pass.

The pre-first-frame manual-scroll follow-up from B is fixed in the reader commit, with a narrow
regression case alongside the existing positioning tests.

Check the new window in development and packaged form: explicit section opens once, ordinary
reopen restores reading, a page-bottom target settles, user scroll stays in control, illustrations
load, keyboard reading works, and closing does not stop installation or the game. Review four
locales at the supported window sizes. Headset readability is checked in the PICO run below.

### B. VUA app tour

Implemented in `acef54a0`; connect later installation and launch actions as they land.

Add a short ordered tour inside the main VUA window using real page/control anchors. Cover
route choice, network results, environment inspection, plan review, task progress and the play/
guide entries. Provide back/next, skip/exit and restart, with clear handling for missing controls
or a task waiting on the user. Keep tour state separate from the reader and installation state.

Build against available controls now and connect later install/launch steps as those actions
land. Check keyboard focus, page transitions, resume/restart and exit during a live task.
The tour must not need a general tutorial service or an AMF workflow to operate.

### C. VRChat game guide

The manual edition is implemented in `72a22e15`: separate transparent window, manual positioning,
hide/reopen, confirmation/skip and independent persisted progress/opacity. It currently stays
globally on top while open. The observer and automatic lifecycle below are next-PR work, not
completed acceptance. Tutorial-world guidance currently explains in-game search; curated world
identifiers await the author's verification.

Add the game-window observer and a dedicated short-step guide. Implement the accepted defaults
and lifecycle from [guidance architecture](../architecture/guidance.md#4-vrchat-game-guide):
following enabled, 50% transparency, persisted preferences, game-bound positioning, background/
minimize hiding, restoration without focus stealing, and manual hide taking precedence.

Reuse suitable instructions for controls, microphone, Personal Space and Allow Untrusted URLs;
let the player confirm or skip. Prepare a small checked tutorial-world list by learning language,
with a local-guide route when no suitable world is listed. No game-account session is needed.

Exercise the actual VRChat window: absent game, startup, movement/resize, minimize/restore,
Alt-Tab, clicking guide controls, explicit hide/reopen, exit/relaunch and monitor/DPI changes.
Verify readable default transparency and independent progress in all three contexts. This
desktop-window feature does not require a native headset overlay.

## 3. Finish the usable play paths

| Work | Concrete implementation still needed | Completion run |
| --- | --- | --- |
| One desktop/PICO route | Connect the selected goal/model to network checks, required software, plan, progress, guidance and play entry. Desktop must not acquire VR/Unity prerequisites; PICO adds only its route's requirements | Start with either choice and reach the next useful action without configuring unrelated creator software |
| Steam and PICO acquisition | Implemented on `slice/steam-pico-acquisition`: official download/trust gates, explicit mainland/global PICO selection, `/S` native elevation, activity/errors, entry-file reinspection and task return. Vendor-specific silent behavior and actual completion still need acceptance | Follow the [slice checklist](steam-pico-acquisition-checklist.md) for missing-software, failure/cancellation and reuse. Then integrate the accepted slice with game installation/launch |
| Steam library and game launch | Hand VRChat/SteamVR installation to Steam, explain the expected Steam action, reinspect after return and launch the selected play mode. Keep the task/guide usable during downloads | Steam registration/login or existing account → install VRChat → start desktop mode → enter a world and use controls/audio/microphone |
| Account handoffs | Connect official registration pages and client/headset handoffs to resumable guide steps; retain external-browser fallback and separate opened/user-confirmed/detected states | Interrupt and return from a page/client without losing the selected route; the player performs login, verification and agreements |
| PICO USB | Finish official PICO Connect/SteamVR setup guidance and launch path, using the test machine's actual software/firmware wording | PICO 4 Pro: image, head/hand tracking, controllers, audio/microphone, then read the preparation window through SteamVR desktop view and return to play |
| PICO Wi-Fi | Add the route-specific local-network checks, connection instructions and reconnect recovery | Repeat headset play over Wi-Fi, disconnect/reconnect, and start a later session without repeating installation |
| Optional eye tracking | Connect VRCFT detection, Steam installation and launch; guide the PICO module, headset calibration and in-game OSC using the appropriate guidance context | Existing compatible Avatar: actual gaze/blinking over USB and Wi-Fi, microphone coexistence, disconnect/reconnect and later-session reuse |

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
   accurately. Complete desktop, USB, Wi-Fi and optional-eye-tracking acceptance separately.
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

## Document changelog

- 1.2.0 (2026-10-08): record the Steam/PICO acquisition implementation and region choice;
  record local reuse/replay verification and prepared isolated inputs; retain missing-software
  installation and play acceptance as pending.
- 1.1.0 (2026-10-07): record the reader, app tour, manual game guide, website cards and brand mark in PR #61; retain automatic following and play/release completion for subsequent work.
- 1.0.0 (2026-10-05): record the completed ZIP/network/A/B/profile slices, prioritize three guidance contexts and enumerate the remaining play/release work separately from N5.

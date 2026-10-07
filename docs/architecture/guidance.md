# Guidance architecture: app tour, preparation reader and game guide

> Document version: 1.2.0
> Status: Accepted
> Updated: 2026-10-08
> Last conformance review: 2026-10-08 (reader, tour and game guide with automatic following; real-machine acceptance pending)
> Scope: First play release guidance in Electron and React

For people: VUA teaches three different activities in three appropriate places: using VUA,
preparing to play, and learning inside VRChat. The same instructions and illustrations can be
reused without giving every activity the same window behavior.

For Agents: this is the accepted design from the author's 2026-10-05 ruling. The reader, app tour
and game guide are implemented separately, with task status retaining its own entry.
The game guide implements the automatic window following specified below through the read-only
game-window observation (`vua.game-window-observe/v0.1`); real-machine acceptance against an
actual VRChat window remains in the delivery plan. Product scope belongs to the
[product boundary](../product-boundary.md#first-play-release-user-ruling-2026-10-03), pass
conditions to the [N sequence](../development-outline.md#first-play-release-acceptance), and
implementation order/status to the [first play delivery plan](../development/first-play-delivery-plan.md).

## 1. Three contexts

| Context | What the player is trying to do | Presentation | Progress means |
| --- | --- | --- | --- |
| VUA app tour | Learn where to choose a play route, inspect the environment, review installation and return to play | A transparent highlight layer inside the main VUA window, with readable instruction cards and ordered navigation | The tour step was completed or explicitly skipped |
| Preparation reader | Read room preparation, equipment connection, installation and troubleshooting instructions | A normal, opaque, resizable window with ordinary minimize/restore behavior | The last chapter/section the player was reading |
| VRChat game guide | Follow game controls/settings and find a suitable tutorial world while playing | A small adjustable-transparency guide associated with the Windows VRChat game window | The player confirmed or skipped a game instruction |

The preparation reader is useful before VRChat exists or starts. The game guide targets the
Windows game window; headset reading uses SteamVR's desktop view of the preparation reader.
A native in-headset VUA overlay remains later work.

## 2. VUA app tour

Render the tour in the main React tree. Highlight real VUA controls over a highly transparent
mask; keep instruction text legible. Broad highlights and arrows may explain a page before
focusing on a specific button. The tour never covers a different application.

The initial tour follows the first-play route: choose desktop or PICO, read network results,
inspect software, review the installation plan, find progress/user handoffs, and locate the
play and guide entries. Page navigation follows those steps. Limit this delivery to available
first-play controls; Avatar production tours follow their own delivery.

Provide back, next, skip/exit and restart. A real action can advance its associated step, but
opening an installer is not installation success. Waiting for a download does not trap the
player in the tour. Leaving the tour preserves the underlying page, accepted tasks and inputs.
If a target control is temporarily absent, explain the prerequisite or offer a skip; never
point at an unrelated position. Restore sensible keyboard focus when a step ends.

Start with a small typed step list and explicit page/control anchors. The existing inactive
tutorial service is not a prerequisite; reusing its visual components does not make that service
available. Application facts still come from the normal Gateway/task state.

## 3. Preparation reader

Move the existing long-form guide into a normal desktop window. It has a taskbar entry, ordinary
window controls and resizing. It does not request global always-on-top or transparent rendering.
User-requested opening can focus this window normally; background task updates do not raise it.

Reuse four-language text, diagrams with captions, section targeting, reading recovery and
keyboard navigation. A deployment help button opens the relevant section; reopening without
an explicit target restores the last reading position. An explicit target is consumed once.
Manual navigation/scrolling takes priority over automatic positioning. Closing the reader only
closes the presentation and leaves installations and the game running.

Contents include room/play-area preparation, Steam/account setup, software installation,
PICO USB/Wi-Fi connection, equipment troubleshooting, and eye-tracking setup. Retain useful
game instructions as readable reference chapters too. A player can prepare or troubleshoot
without launching VRChat or using an overlay.

## 4. VRChat game guide

### Display and window following

The initial controls are **Follow VRChat window**, enabled by default, and a transparency
adjustment starting at **50%**. Persist subsequent user choices. This default belongs to the
game guide only; it does not make the preparation reader translucent or determine the app-tour
mask. Keep text and controls readable at the default setting.

Electron Main owns a Windows window observer behind a narrow desktop interface. Identify the
visible game window belonging to `VRChat.exe`; a running process without a usable game window
is a waiting state. Observe window geometry, foreground state and minimization through Windows
window APIs. There is no client injection, game-memory reading or automated settings editing.

With following enabled:

- Keep the guide associated with the game window as it moves or resizes, including monitor/DPI
  changes. Place instructions inside its usable bounds without covering the whole game.
- Show/restore it when the game becomes the active usable window; hide it when the game is
  minimized, closes, or the player switches to another application. Do not minimize or activate
  VRChat on the player's behalf.
- Treat interaction with the guide itself as part of the game-guide context, so clicking a
  control does not immediately hide the guide. Automatic showing does not take keyboard focus.
- A manual hide/close wins for the current game session. Window changes do not repeatedly bring
  it back; an explicit reopen resumes it. The preparation reader remains available throughout.

Disabling following stops automatic game-driven showing, hiding and repositioning. Preserve
manual show/hide controls without leaving a globally pinned window over unrelated applications.
Keep this behavior distinct from the persisted transparency preference.

### Guided game steps

Present one short instruction at a time: where to open a menu, what to change, what should be
visible, and what to do if it differs. Cover basic controls, audio/microphone, Personal Space
and Allow Untrusted URLs. Explain the effect of a suggested setting and let players keep their
preference. Confirmation/skip records guide progress; it does not claim VUA inspected or changed
the game setting.

Offer tutorial worlds by the player's requested learning language, independently of VUA's UI
language. Begin with a small checked list of world identifiers, names, language and review date.
Open a selected world's official destination through the normal external-link boundary. When no
suitable entry is available, provide the local instructions and normal world-search guidance.
Do not fabricate a world for every locale or require a VRChat account session in VUA.

## 5. Content, routing and state

Keep one content catalog with stable topic/section identifiers and the existing four-language
i18n resources. A short game step can refer to a longer preparation section and share its
illustration. Map sections deliberately: eye-tracking equipment/module setup belongs in the
reader, while its in-game OSC step belongs in the game guide. An entire old topic need not move
to one surface unchanged.

The topbar Guide entry exposes the three clearly named destinations; contextual help goes
directly to the appropriate destination/step. Opening a preparation section must not switch the
player into a tour or enable game following. Keep the ordinary reader reachable when the game
is absent. These are guide destinations, not additional business tabs.

| State | Owner and persistence |
| --- | --- |
| App-tour position, completion and skip | Local UI preferences, separate from installation success |
| Preparation topic/section | Reader state; migrate the existing reading bookmark |
| Game-guide step and confirmation/skip | Separate local game-guide progress |
| Follow preference and transparency | Desktop preferences enforced by Main |
| Transient target and window-follow observations | Consumed request / current observation, not permanent reading progress |
| Installation and other business tasks | Existing Orchestrator authority; guide windows only display or navigate to them |

Preserve the current overlay's task-status access during migration. Task status is a business
view, not a fourth tutorial, and closing any guide does not cancel a task. Avoid making guide
progress part of the production display snapshot.

Renderer code requests typed semantic actions; Main owns windows and native observations.
Reuse the existing targeting validation and single-consumption behavior. Add narrowly scoped
desktop API fields only when needed, with both ends and tests updated together; this design
does not silently change a frozen wire contract.

## 6. Reuse and migration

| Existing entry | Reuse / change |
| --- | --- |
| `features/guide/guide-content.ts` and `i18n/strings.*.ts` | Reuse the content catalog, four locales and media captions; route sections by context |
| `public/guide/*.svg` | Reuse the six diagrams; preserve relative asset URLs for packaged `file://` loading |
| `guide-target.ts` and deployment `GuideEntryButton` | Reuse stable targets and invalid-target fallback; add explicit surface routing |
| `GuideOverlayView.tsx` and `pending-guide-scroll.ts` | Reuse reading, keyboard and positioning behavior in the reader; retain the reviewed scroll fixes |
| `DesktopOverlaySurface.tsx`, Main overlay lifecycle and desktop-window API | Separate reader, game-guide and task-status responsibilities; stop applying the same window flags to all guides |
| Inactive tutorial port and existing tutorial widgets | Reuse suitable UI pieces only; build the small in-app tour against actual page controls |

Deliver the preparation reader first, then the app tour, then the game guide. Keep each new
entry usable as it lands. Do not throw away A/B content or reopen their already-fixed defects
as unfinished work; carry the remaining pre-first-frame scroll edge case into the reader change.
The delivery plan names the outstanding code and real-machine checks.

## Document changelog

- 1.2.0 (2026-10-08): record the delivered game-window observer and automatic guide following (game-window-observe v0.1); real-machine acceptance remains in the delivery plan.
- 1.1.0 (2026-10-07): distinguish the delivered three presentations from the remaining game-window observer and automatic lifecycle.
- 1.0.0 (2026-10-05): accept three guidance contexts, define their window/state responsibilities and map migration from completed A/B slices.

# Guidance architecture: app tour, knowledge encyclopedia and game guide

> Document version: 1.9.0
> Status: Accepted
> Updated: 2026-10-11
> Last conformance review: 2026-10-10 (controlled first-use greeting, real feature anchors, skip/finish/resume, locale and legacy-bookmark checks; author and four-language human review pending)
> Scope: First play release guidance in Electron and React

For people: VUA teaches three different activities in three appropriate places: using VUA,
preparing to play, and learning inside VRChat. The same instructions and illustrations can be
reused without giving every activity the same window behavior.

For Agents: the author's 2026-10-10 ruling embeds preparation reading in Help as the knowledge
encyclopedia, superseding the separate-window presentation from 2026-10-05. The encyclopedia,
app tour and game guide keep separate progress, with task status retaining its own entry.
The later 2026-10-10 startup ruling adds a first-use welcome and automatic app-tour entry
before the independent route wizard, superseding the earlier manual-only initial tour.
The game guide implements the automatic window following specified below through the read-only
game-window observation (`vua.game-window-observe/v0.1`); real-machine acceptance against an
actual VRChat window remains in the delivery plan. Product scope belongs to the
[product boundary](../product-boundary.md#first-play-release-user-ruling-2026-10-03), pass
conditions to the [N sequence](../development-outline.md#first-play-release-acceptance), and
implementation order/status to the [first play delivery plan](../development/first-play-delivery-plan.md).

## 1. Three contexts

| Context | What the player is trying to do | Presentation | Progress means |
| --- | --- | --- | --- |
| VUA app tour | Meet VUA and locate play, tools, editing preparation, progress and help | A centered welcome scene followed by a transparent highlight layer inside the main VUA window, with readable cards and ordered navigation | The tour step was completed or explicitly skipped |
| Knowledge encyclopedia | Read hardware introductions, room preparation, equipment connection, installation and troubleshooting instructions | A page inside Help in the main desktop window, using its appearance | The last chapter/section the player was reading |
| VRChat game guide | Follow game controls/settings and find a suitable tutorial world while playing | A small adjustable-transparency guide associated with the Windows VRChat game window | The player confirmed or skipped a game instruction |

The encyclopedia is useful before VRChat exists or starts. The game guide targets the
Windows game window; headset reading uses SteamVR's desktop view of the main Help page.
A native in-headset VUA overlay remains later work.

Help's four cards open distinct main-window child pages. Getting started replays the branching
wizard inside its child page; the tour and game-assistant children explain their function and
offer an explicit start action for the retained highlight overlay or floating game window.
Encyclopedia chapters and wizard choices are same-document history entries. Native mouse
Back/Forward traverses those entries and the parent/child pages without creating another reader
window or implicitly executing scenario work. Reopened completed preparation still reinspects
instead of trusting an old readiness bookmark. Replay navigation does not reset onboarding goals.

The encyclopedia offers an explicit **Official VRChat Wiki** entry at `wiki.vrchat.com`.
It uses the host browser without requiring AMF, leaving the main header/sidebar available.
Closing the website returns to the same local preparation content and bookmark; a new targeted
chapter request closes the Wiki surface. Website history stays separate from the guide's
reading progress. The [desktop-browser face](../protocols/desktop-browser-v0.1.md) owns native
geometry, loading/return behavior and remote isolation. This entry adds no installed-software
or room/tutorial verification claim.

The Tasks window is a queue/status entry, without an onboarding switch. Preparation and game
guidance stay in their own presentations; retained legacy explicit guide calls do not add a
guide tab to Tasks. Account guidance opens Settings → Accounts with a settings-only sidebar.
The upper-left Back action or clicking Settings again returns to the source workflow; a guide's
content Back returns one level to its account cards. These actions preserve the wizard step and
accepted tasks. The [desktop architecture](desktop.md) owns settings/tray lifecycle and appearance.

## 2. VUA app tour

Render the tour in the main React tree. Highlight real VUA controls over a highly transparent
mask; keep instruction text legible. Broad highlights and arrows may explain a page before
focusing on a specific button. The tour never covers a different application.

On a new profile, startup first shows the welcome scene in the selected UI language, beginning
with “Welcome, traveler from reality.” and the author's supplied Chinese, Japanese and Korean
equivalents. It introduces VUA, then points to Home, network checks, environment cards and their
actions, Tools, Avatar-editing preparation/AMF controls, Tasks, Help and Settings.
Development tool entries remain descriptions, not claims of installation. These are available
host controls; complex AMF workflow teaching follows AMF's own delivery.

The feature tour supports next/back and skip, without timed page advancement or business
actions. Finishing or skipping it enters the independent branching route wizard; it does not
write goals, accept installation plans, launch software or enable AMF. Existing onboarded
profiles do not automatically start the new welcome on upgrade. Help or command search can
replay it. Closing during an active tour resumes its step; completed/skipped state stays terminal
even if the route wizard has not finished. Local progress v2 migrates old active v1 bookmarks
by feature identity so inserted scenes do not change the content being resumed.

Provide back, next, skip/exit and restart. A real action can advance its associated step, but
opening an installer is not installation success. Waiting for a download does not trap the
player in the tour. Leaving the tour preserves the underlying page, accepted tasks and inputs.
If a target control is temporarily absent, explain the prerequisite or offer a skip; never
point at an unrelated position. Restore sensible keyboard focus when a step ends.

Start with a small typed step list and explicit page/control anchors. The existing inactive
tutorial service is not a prerequisite; reusing its visual components does not make that service
available. Application facts still come from the normal Gateway/task state.

## 3. Knowledge encyclopedia

Render the existing long-form guide as a page inside Environment → Help. The Help landing page
and encyclopedia have a one-level return action; Help remains selected in the desktop sidebar.
Use the main desktop window's light/dark appearance rather than creating a
separate reader window. Explicit contextual requests can restore/focus Main, but background
task updates do not raise it. [Desktop-window v0.2](../protocols/desktop-window-v0.2.md) owns this
new navigation face; the retained V1 reader call keeps its original window semantics.

Reuse four-language text, diagrams with captions, section targeting, reading recovery and
keyboard navigation. A deployment help button opens the relevant section; reopening without
an explicit target restores the last reading position. An explicit target is consumed once.
Manual navigation/scrolling takes priority over automatic positioning. Leaving Help preserves
the reading bookmark and leaves installations and the game running.

Contents start with a hardware introduction: finding the model, distinguishing screen,
standalone and PC-streaming play, choosing a supported route, and recognizing optional tracking
accessories. Play's "What device do I have?" entry opens that chapter directly. This is static
reading, not device identification or proof of a working connection.
Other chapters include room/play-area preparation, Steam/account setup, software installation,
PICO USB/Wi-Fi connection, equipment troubleshooting, and eye-tracking setup. Retain useful
game instructions as readable reference chapters too. A player can prepare or troubleshoot
without launching VRChat or using an overlay.

## 4. VRChat game guide

### Display and window following

The initial controls are **Follow VRChat window**, enabled by default, and a transparency
adjustment starting at **50%**. Persist subsequent user choices. This default belongs to the
game guide only; it does not change the encyclopedia's appearance or determine the app-tour
mask. The slider changes only the panel's matrix/background opacity; text and controls remain
fully readable. The outer Chromium canvas and native window are transparent, so reducing the
panel background actually reveals the application underneath.

Electron Main owns a Windows window observer behind a narrow desktop interface. Identify the
visible game window belonging to `VRChat.exe`; a running process without a usable game window
is a waiting state. Observe window geometry, foreground state and minimization through Windows
window APIs. There is no client injection, game-memory reading or automated settings editing.

With following enabled:

- Keep the guide associated with the game window as it moves or resizes, including monitor/DPI
  changes. Place instructions inside its usable bounds without covering the whole game.
- Initially place it toward the right and vertically centered. A player drag replaces that
  default with a remembered relative position within the available travel area. Retain that
  preference across app switches, minimize/restore, manual reopen, new game sessions and VUA
  restart. Clamp to the game bounds and use the guide's actual current size when resizing.
- Show/restore it when the game becomes the active usable window; hide it when the game is
  minimized, closes, or the player switches to another application. Do not minimize or activate
  VRChat on the player's behalf.
- Treat interaction with the guide itself as part of the game-guide context, so clicking a
  control does not immediately hide the guide. Automatic showing does not take keyboard focus.
- A manual hide/close wins for the current game session. Window changes do not repeatedly bring
  it back; an explicit reopen resumes it. The encyclopedia remains available throughout.

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
encyclopedia, while its in-game OSC step belongs in the game guide. An entire old topic need not move
to one surface unchanged.

Environment → Help exposes **Getting started**, the app tour, **Knowledge encyclopedia** and
**In-game assistant**. The topbar Help button is removed. Contextual help goes directly to a
chapter inside the encyclopedia. Opening a chapter must not switch the player into a tour or
enable game following. Keep the encyclopedia reachable when the game is absent. Tools is a
separate environment tab, not part of guidance or AMF activation.

| State | Owner and persistence |
| --- | --- |
| App-tour position, completion and skip | Local UI preferences, separate from installation success |
| Encyclopedia topic/section | Reuse the existing reading bookmark, including saved preparation chapters |
| Game-guide step and confirmation/skip | Separate local game-guide progress |
| Follow preference and background opacity | Separate renderer-local preferences; Main enforces following |
| Dragged relative position | Main's local layout preference, normalized per axis; no game/process/monitor identifiers persisted |
| Transient target and window-follow observations | Consumed request / current observation, not permanent reading progress |
| Installation and other business tasks | Existing Orchestrator authority; guide windows only display or navigate to them |

Preserve the current overlay's task-status access during migration. Task status is a business
view, not a fourth tutorial, and closing any guide does not cancel a task. Avoid making guide
progress part of the production display snapshot.

Renderer code requests typed semantic actions; Main owns windows and native observations.
Only the native user-drag event changes the saved layout; automatic placement never learns
its own move as a new preference. The preference file is `game-guide-placement.json` in the
local application profile. Missing, corrupt or unsupported values restore the default position.
Reuse the existing targeting validation and single-consumption behavior. Add narrowly scoped
desktop API fields only when needed, with both ends and tests updated together; this design
does not silently change a frozen wire contract.

## 6. Reuse and migration

| Existing entry | Reuse / change |
| --- | --- |
| `features/guide/guide-content.ts` and `i18n/strings.*.ts` | Reuse the content catalog, four locales and media captions; route sections by context |
| `public/guide/*.svg` | Reuse the six diagrams; preserve relative asset URLs for packaged `file://` loading |
| `guide-target.ts` and deployment `GuideEntryButton` | Reuse stable targets and invalid-target fallback; add explicit surface routing |
| `GuideOverlayView.tsx` and `pending-guide-scroll.ts` | Embed the shared content in Help with its own scroll container; retain reading, keyboard and reviewed positioning behavior |
| `HelpPage.tsx`, Main navigation and desktop-window v0.2 | Open targeted chapters in Main and acknowledge requests once, preserving the current reading bookmark |
| `DesktopOverlaySurface.tsx` and Main overlay lifecycle | Retain game-guide/task-status responsibilities and V1 window compatibility; current preparation entries use the encyclopedia |
| Inactive tutorial port and existing tutorial widgets | Reuse suitable UI pieces only; build the small in-app tour against actual page controls |

The original reader → tour → game-guide sequence has landed. The 2026-10-10 presentation change
reuses A/B content, media, targeting and scroll repairs inside Help. It does not reopen that
completed work or establish physical-headset acceptance. The delivery plan names the remaining
code and real-machine checks.

## Document changelog

- 1.9.0 (2026-10-11): add an AMF-independent official Wiki entry in the encyclopedia, preserving local reading and targeted-chapter return through the Candidate desktop browser.
- 1.8.1 (2026-10-10): align the tour's Avatar-editing wording with fresh-default AMF activation without giving guidance any module-lifecycle authority.
- 1.8.0 (2026-10-10): add the author's four-language first-use welcome and automatic feature tour before the independent wizard, preserving existing profiles, manual replay and legacy active-step identity.
- 1.7.1 (2026-10-10): align encyclopedia presentation with the retired big-screen mode; desktop architecture and the design standard own layout retirement, and guidance progress/window semantics remain intact.
- 1.7.0 (2026-10-10): make all four Help entries child pages, retain explicit tour/game-window start and add native page/chapter/wizard history while preserving separate progress and fresh preparation checks.
- 1.6.0 (2026-10-10): move Help into the environment directory, embed the knowledge encyclopedia with hardware introductions, and add a versioned Main-navigation face while retaining V1 reader compatibility.
- 1.5.0 (2026-10-09): fix background-only guide opacity and define persisted relative drag placement across focus, window and session changes without retaining machine identifiers.
- 1.4.0 (2026-10-09): separate the daily Tasks entry from guidance and route account-help return through the independent settings area; retain legacy guide-call compatibility.
- 1.3.0 (2026-10-08): keep the independent first-run wizard and manually opened app tour distinct; route Help and tour anchors through the fixed directory.
- 1.2.0 (2026-10-08): record the delivered game-window observer and automatic guide following (game-window-observe v0.1); real-machine acceptance remains in the delivery plan.

Earlier entries remain in Git history.

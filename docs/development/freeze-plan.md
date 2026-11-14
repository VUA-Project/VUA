# Freeze plan

> Updated: 2026-11-14 (author's ruling)

The author lifted the v1.0.0 freeze on 2026-11-14. This document is kept as the historical record
of the freeze period that shipped [v1.0.0 Brave New World](../release/v1.0.0.md) (followed by
[v1.1.0 Getting on Track](../release/v1.1.0.md)). The [current plan](current-plan.md) sets the
slice order again, and the [N sequence](../development-outline.md) keeps its acceptance rows.

During that stage, VUA was the first step of PH-R's serial order, and the freeze served as a
temporary measure to ship v1.0.0 — the first stable release replacing the Beta — with a clear boundary
on what had to be true beforehand, what waited, and what could change while it lasted.

## What the freeze means

While the freeze lasted, VUA received only:

- bug fixes, including fixes found by players;
- security updates;
- compatibility with new VRChat SDK, Unity, Steam, PICO and Electron versions;
- native review of the five UI languages;
- the Pharos settings and controls, when PH-R reaches that stage (planned separately).

Anything else was recorded under "After the freeze" until the author lifted the freeze or admitted
it by a new decision.

## Rule while the freeze is open

During the freeze period (ended on 2026-11-14 by the author's ruling), no new slice started unless
it was a row in this plan, slice prompts named the row they served, and non-fix work found along
the way went to "After the freeze".

## Before the freeze

### 1. Host checks

The author runs the host checks and may skip any of them; the release notes list what was
skipped.

| Slice | Check |
| --- | --- |
| 3 | The SDK starts signed in after the shared product name change |
| 19, 26 | Experimental VRChat sign-in and the Avatar list with a real account |

Slice 11 (Unity sign-in and license) finishes its scenario step (author, 2026-10-29): the
Avatar-editing preparation shows the license state with one next action, and a production
license failure opens that step with the line retained. Testing Hub's Unity CLI waits until
after the freeze.

### 2. Close the open branches

Every branch with work since v0.7.0 is merged or closed before the freeze. Merge the current
state; where a feature is unfinished, hide its entry and record what is missing. Do not finish
an unfinished feature to close its branch.

Merged into `slice/n3-n4-ma-production` on 2026-10-29 (Aran52/VUA#68–#81): the component
updates, the theme styles and Grid audit, terms everywhere, turntable sharing, the share-link
service, local material entry and the first freeze plan.

Merged on 2026-10-30: slice 11's license step in Avatar-editing preparation (Aran52/VUA#84) and
MCP access to all six connected Steam tools, named on the approval card (Aran52/VUA#82).

Delete branches that are fully merged.

### 3. Last changes before the freeze

Author ruling, 2026-10-30. These rows are the only feature work left before v1.0.0, besides
section 6. Each row is one slice and one pull request; the slice prompt names its row.

F1, F2 and F4–F8 merged on 2026-10-30 (Aran52/VUA#85–#90, #94); F3 is approved. Their "Done
when" runs on real machines remain and are listed in the v1.0.0 release notes.

**Remove or hide what players can see but cannot use**

| Row | Change | Done when |
| --- | --- | --- |
| F1 | Replace AMF's base map (code-drawn rooms and factory camera) with a plain station list. Warehouse, Recipe, Workshop and Release stay as the player's stations; the production animation goes with the map | The four stations open from the list in every language and both themes, and no screen loads the base map |
| F2 | Remove the notification panel's "Show completed" setting, which has no effect | The setting is gone and no saved preference refers to it |
| F3 | Ship the Grid, Aero, Tenshi and Jirai presets | Approved by the author, 2026-10-30 |

**Finish what the core path needs**

| Row | Change | Done when |
| --- | --- | --- |
| F4 | Library migration grouping, slice 46 in full: per-directory choices, loose-file grouping, separate display of confirmed, unassigned, excluded and unreadable areas, import of confirmed groups through the existing intake, and the versioned migration manifest | The author migrates a real local collection with wrappers, mixed loose files and nested collections, with every file accounted for |
| F5 | Pre-assembly prediction, slice 35 item 2: before assembly the plan shows each outfit's size, triangles, material slots, texture memory, PhysBones and parameter bits, reusing slice 9's texture memory and slice 33's parameter-bit estimate | A P-02 plan shows all six values per outfit before assembly, and the built result is within the stated tolerance of the prediction |
| F6 | The title bar names the tightest resource instead of the mean of CPU, GPU, RAM and VRAM (slice 39 item 1) | During a P-02 run the title bar names the busiest resource at a fixed width |
| F7 | Recognize outfits that carry VRCFury components and show the VRCFury guide, with VRCFury listed in the known packages as `guide` delivery after its license check (slice 33 item 5) | An outfit with VRCFury components shows the guide at intake |
| F8 | A minimal user guide: installation, first run, and one complete production from materials to the SDK, with screenshots of the v1.0.0 build in the five UI languages. N7's full illustrated guide waits until after the freeze | The author follows the guide on the clean VM from section 5 without other help |

**After the author's local test (author ruling, 2026-10-31)**

| Row | Change | Done when |
| --- | --- | --- |
| F9 | Each tool in the Tools tab shows its own icon, fetched from the publisher's Steam CDN or, for VRCS, its pinned GitHub icon and cached in the profile, with logos and names in left-aligned columns. The VRCS source choice follows the author ruling of 2026-10-31. Tool details reuse Play's full-row sliding drawer; action buttons show symbols, with the actual next operation after 1.2 seconds of pointer hover (author follow-up, 2026-10-31) | Every tool shows its own icon in each theme; without a connection the cached icon or glyph remains. All eight detail panels open below their card's row, and icon actions explain the operation without resizing the cards |
| F10 | Play scans for devices the first time it opens in a session; 刷新设备识别 scans again | Opening Play lists the detected VR software without a click |
| F11 | Play's latency and route details slide open across the full page width. Each route has one button that names the next step: check the environment, confirm the checklist, run, retry after a failure, launch | A desktop route goes from a fresh check to launch through that one button |
| F12 | The encyclopedia and in-game assistant leave the environment cards; AI tools move to a top-bar button beside Help and Settings | No environment card links the encyclopedia or in-game assistant, and the top bar opens AI tools |
| F13 | The concept wizard drops its manual and page-tip replay buttons; sidebar group headings are plain labels with the default cursor | The wizard shows only its concept buttons, and the headings do nothing on click |
| F14 | Creator editor and manager details use the shared opening and closing slide motion | Each available card animates both directions in light and dark appearance; closed details are inert |
| F15 | AMF first reads avoid duplicate environment/catalog scans; interactive repository metadata has a two-second network budget and retains the existing cache fallback | The real isolated renderer finishes the first local read on Materials, Recipes, Workshop, Release and Packages within five seconds; stalled-feed tests retain cached packages |
| F16 | Restore material corner triangles and quiet Grid's inner card HUD marks, following the 2026-10-31 author ruling | Material states use the attached triangle; HUD colour follows the [design standard](../design/controls-and-motion.md#corners) |
| F17 | Align Workshop and Materials content; emphasize the Workshop automation selector with a visible label and current mode; paint material status markers above frames with a diagonal transparent tail (author follow-up, 2026-10-31) | Workshop columns and mode share their header baseline; new lines expose their mode; material filters align in ordinary and expanded states at wide/narrow widths; marker tails blend and pass pointer input through |
| F18 | Tool first reads use loading circles; warnings represent observation failures. Rename the shell entry MCP, use only Aero's command-bar entry in that skin, and add per-request/whole-list clearing. Align Play card contents across all themes and contain Jirai logos inside their hearts (author follow-up, 2026-11-01) | Slow first observations show no warning triangle; each theme has one MCP entry; clearing rejects pending requests and preserves running work and AI receipts under the [Candidate control face](../protocols/ai-tools-v0.1.md#desktop-control-face); Play icons and title columns align at wide/narrow widths without motif overflow |
| F19 | Use the VUA application icon in development, Windows executables and the installer; reuse Creator's verified inventory during a session with explicit refresh; accept Unity's empty fit serializer sentinel at the production receipt boundary; expose recorded-terms reading and refresh use filters afterward (author follow-up, 2026-11-01) | Re-entering Creator starts no scan and explicit refresh starts one; empty fit placeholders do not fail observed selections while real/unknown data remains rejected; the library explains unknown evidence, reads on request and refreshes decisions after task completion; Windows app and launcher resources contain the accepted VUA geometry |

### 4. AMF checks by the community

AMF's real-material checks move to community testers after v1.0.0 is published. They report
results as GitHub issues; fixes ship as independent AMF updates, so they do not need a new host
release. These checks do not block the freeze.

| Slice or case | Check |
| --- | --- |
| 5 | A project held open in Unity: save and close from VUA |
| 6 | The four build-and-upload guide screenshots |
| 7 | P-02 in each permission mode |
| 8 | P-01 with a Poiyomi outfit |
| 9 | Material tuning in a dark world and on a P-02 rank |
| 10 | Face tracking in VRChat |
| 20 | Start production from the materials room with real materials |
| 27 | Two lines running side by side |
| 30 | Removing two outfits |
| 31 | Changing a finished line's base Avatar |
| 41 | VN3 terms with real products |
| 42 | Restoring a revision and applying a saved fit |
| 43 | The transient failure, if it appears again |
| P-03 | The N3 minimum case: one real Avatar, at least two actively used dependencies or plugins and at least six other real materials in one project and one run, handed to the SDK |
| P-04 | The P-03 Recipe rebuilds the same relationships and settings in a second, separate project |

### 5. Fresh installations

| Case | Pass condition |
| --- | --- |
| VUA on a clean Windows VM | Online and offline installers each install, launch and reach the home screen; record the VM image |
| External tools | Each of the six connected Steam tools (VRCFT, Space Calibrator, OVR Advanced Settings, OVR Overlay Translator, OVR Toolkit, OyasumiVR) goes from not installed through VUA's Steam handoff to observed installation and launch at least once |
| Upgrade from v0.7.0 | Installing the freeze release over v0.7.0 keeps material records, Recipes, settings, run history and saved module choices, and VUA reaches the home screen |
| AMF update without GitHub | On a network where GitHub is unreachable, VUA finds, downloads and activates an independent AMF update from the mainland mirror; record how GitHub was blocked |

LIV and VRCS stay as description cards.

### 6. First run and guidance

The author's ruling of 2026-10-28 is part of v1.0.0:

- The first run asks no language question; VUA uses the detected system language.
- The first launch opens a first-use notice with four parts: what VUA is for, the changelog,
  "VUA is open source under Apache 2.0 and free to download on GitHub", and links to the
  third-party licenses. It has two buttons:
  - **知道了** enters VUA with the existing light, skippable feature tour;
  - **我完全不知道要做什么** opens a page-by-page wizard joined with the encyclopedia. It starts
    from "what is VRChat" and introduces one concept per page. Each page has two buttons:
    **我要这个** sets up or deploys that thing, **我知道了** goes to the next page.
- Where a concept matters, VUA explains it in place and links to the matching encyclopedia
  section; for example, the upload step explains the player's trust rank.
- The encyclopedia reads like a manual — neutral, accurate and concise — with a moderate
  summary and commentary from an experienced player.

### 7. Freeze release

- The host becomes a stable release; AMF keeps its Beta label and updates independently, as it
  does today.
- The product name becomes **Virtual Unified Assistant** in the app, READMEs, release notes
  and installer metadata.
- The release notes state that the UI translations have not been reviewed by native speakers.
- The release notes list every row of this plan that was skipped or failed, with its impact,
  and invite players to the community AMF checks.
- The freeze release is **v1.0.0 Brave New World**, selected by the author on 2026-10-29. Brave
  New World is Aldous Huxley's novel and the Stellaris achievement for colonizing the first
  planet. Version 1.0.0 ends the continuing-Beta policy; the
  [versioning policy](../release/versioning.md) is updated with the release.
- Share links use the trial server already deployed in mainland China. It is reachable from
  mainland China and probably not from elsewhere; the release notes say so, and a share link
  that cannot be reached fails with a clear message instead of an empty page.

## After the freeze

These items waited while the freeze lasted. Following the 2026-11-14 unfreeze, they have been
folded back into the order table in [current-plan.md](current-plan.md).

| Slices | Item |
| --- | --- |
| 13, 22, 23 | Styles beyond the four approved presets, motion setting; base map art is moot after F1 |
| 14 | Native review of the five UI languages (allowed after the freeze as a fix) |
| 15, 16 | Versioned SOPs, Eval runs |
| 17 (beyond P-03/P-04) | Further complex-production coverage |
| 18 | Tool and package delivery by license |
| 24 | Finer usual durations |
| 32, 34, 35 (except item 2) | Agent interface refinements, evidence layers, start card, release attribution, local lessons |
| 33 (remaining) | The slider, built-result evidence |
| 36, 38 | Licensed entry guide, latency calibration |
| 37 | Creator credits |
| 39 (except item 1), 40 (except F2) | Resource panel, notification center redesign |
| 45, 47, 48 | Source hints, migration through the player's agent, identical-content choice |
| 49, 51 | Turntable sharing and creator-trusted Recipes beyond the merged state |
| 50 | Optional AI connection changes |
| 52 | Signed Windows releases (on hold since 2026-10-25) |
| 53 | Interface consistency audit beyond its first report |
| 11 (item 3) | Testing the Unity CLI that Hub installs |
| — | N7's full illustrated user guide (F8 ships the minimal guide) |
| — | Encrypting saved sign-in cookies, which needs the installer to verify a fused Electron runtime |
| — | Development dependency upgrades proposed by Dependabot (VUA-Project/VUA#87, #89) |
| — | Social discovery on VRCX-0, remaining N1 physical rows, N5 real-account review |
| — | Platforms beyond Windows x64: Windows on Arm, Linux (Ubuntu, SteamOS), macOS, Android, iOS; planned separately |

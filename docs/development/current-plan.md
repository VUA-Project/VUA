# Current development plan

> Updated: 2026-11-14

This plan orders the next slices toward the [north star](../north-star.md). Each slice names the
[Eval cases](../eval/cases.md) it moves and what counts as done. The
[N sequence](../development-outline.md) keeps the acceptance rows; this plan sets the order.
The freeze was lifted on 2026-11-14; the slice order follows this plan, and the record of the
freeze period lives in [freeze-plan.md](freeze-plan.md).

## Where things stand

- `main` carries v0.7.0 Stone Age, published on 2026-10-22 (VUA-Project/VUA#90): the production
  path from materials to an uploaded Avatar, offered as Beta.
- `slice/north-star` (VUA-Project/VUA#83) adds the north star, the Eval and the documentation rules.
- `slice/n3-n4-ma-production` (VUA-Project/VUA#84) is the production branch of this stage. It
  carries the AMF production work, the MSIX Hub detection (#85), and the slices merged on the
  Aran52 fork:
  - from the first real runs (Aran52/VUA#1–#4): the material-first production path with Recipe
    v0.4, the local MCP adapter, six Steam tool connections, Unity Hub starting before Unity
    work, one shared product name for work projects so the SDK sign-in carries over, lilToon
    from its feed, result and candidate previews, and live Unity progress with Stop and Continue;
  - the AMF interface as an Avatar factory: a base map with animated rooms and a camera, the
    workshop's production lines with stations and permission modes, the control center with the
    Recipe graph and a VCC-style package manager, and the release room's album with the
    60-frame turntable and managed upload; token groundwork for the [skin system](skin-system.md);
  - on 2026-10-17/18 (Aran52/VUA#5–#20): the [experimental VRChat sign-in](vrchat-account.md)
    and the account's Avatar list, the SDK's own checks with its Auto Fix and plain-word
    messages, cached project fingerprints, permission modes and stated recommendations, the
    work queue, workshop stations with in-place material changes and line deletion, production
    started from the materials room, the quit prompt, restore after an interrupted assembly, and
    production records in Settings;
  - on 2026-10-19 (Aran52/VUA#21–#23): the known-packages table, which installs lilToon,
    Poiyomi Toon by version line and UnlitWF from their feeds and names the official page for
    packages players get themselves; a Bridge v5 result schema that covers every field Unity
    writes; and Unity work on different lines side by side, up to a capacity of three. The slice
    rows below link each pull request.
- VUA-Project/VUA#86 keeps notification rows in place while downloads progress.
- Real runs on 2026-10-16/17, with evidence in `_local_eval/`:
  - P-02 (Meiyun with the T-shirt & shorts) assembled with correct shading (lilToon 2.3.4); its
    Recipe "Meiyun T恤短裤" is saved; the result uploaded through the SDK as the private Avatar
    "AMF test1" (`avtr_7ce0e209…`), so the SDK build passed;
  - P-01 passed: VUA installed lilToon for the outfit's lilToon materials and found no material
    without its shader;
  - with Unity Hub quit, VUA started Hub and Unity received its license;
  - the turntable bake, Stop (Unity's whole process tree ended in 12 s) and Continue worked.
- The author's review found texture memory and lilToon brightness limits to tune, the SDK panel
  hard for newcomers, and the SDK sign-in asked again after the move to the shared product name.
- A real-machine round through the MCP adapter on 2026-10-19, with evidence in
  `_local_eval/2026-10-19-mcp-real-run.md`: an external agent drove VUA and the author approved each
  request. P-02 and P-01 on new lines, queueing and cancelling a waiting task, stop and continue, a
  material change, deleting a line and a second managed upload ("AMF test2") passed. Opening the
  project for the SDK timed out waiting for the SDK panel, and a restore after a material change
  and a new assembly returned to the later state. Slices 42–44 and items in 5 and 6 take the
  findings.
- Since the release, on 2026-10-23, the production branch took the follow-up slices
  Aran52/VUA#50–#60: the version list and saved fits in the workshop, the regional tiers, the
  package page by permission mode, the upload guide, the creator-patch follow-ups, save and close
  for Unity, Poiyomi release sets, the synced parameter estimate, texture memory and outfit
  removal (amf-production 0.34.0, unity-bridge-v5 0.19.0).
- The author's order (2026-10-23): settle how AMF is operated first, then hold the appearance
  design session (slice 13); functional fixes go in parallel. Calibration against in-game Ping
  (38) and Eval runs (16) wait for a concrete need.
- **v1.0.0 Brave New World** published on 2026-11-05 (VUA-Project/VUA#94, [release notes](../release/v1.0.0.md)):
  shipped the first stable host release alongside AMF 0.3.0 Beta, including F1–F19 (plain AMF
  station list, Grid/Aero/Tenshi/Jirai styles, library migration grouping, pre-assembly cost
  predictions, VRCFury intake recognition, tightest-resource title bar, five-language minimal
  guide, first-use notice and concept wizard, component updates and recovery, turntable/Recipe
  sharing, and the Unity license scenario step).
- **v1.1.0 Getting on Track** published on 2026-11-13 (VUA-Project/VUA#97, [release notes](../release/v1.1.0.md)):
  merged slice 54 (`slice/ui-structure`), replaced the NSIS wizard with a native Per-Monitor DPI v2
  Windows setup/uninstall card, added `windows-distribution v0.3` zstd component packs, introduced
  scenario-first Launch (`scenario-environment v0.2`) with `external-tool v0.4` and
  `installer-tool v0.1`, added opt-in Avatar Optimizer (`com.anatawa12.avatar-optimizer`), local
  Avatar SDK test builds (`amf-production-flow v0.1`), `amf-recipe v0.6`, BOOTH order purchase
  timestamps, `catalog-enrichment v0.1` and the signed `guide-content v0.1` channel.
- On 2026-11-14, the author lifted the v1.0.0 freeze, folded the deferred post-freeze items back
  into the order table below, and ruled on PR #98 (`slice/v1-2-holistic-evolution`).

## Order

| # | Slice | Eval | State |
| --- | --- | --- | --- |
| 1 | Integrate | — | done: v0.7.0 was integrated upstream (VUA-Project/VUA#90) and published on 2026-10-22 |
| 2 | Finish the first real production runs | P-02, P-01 | done: P-01 passed; P-02 assembled, shaded correctly and built and uploaded through the SDK |
| 3 | Unity Hub and SDK sign-in | P-02 | Hub start verified; with slice 19 the SDK starts signed in from VUA's session; the shared SDK sign-in awaits a check |
| 4 | Result previews | P-02 | done (Aran52/VUA#1) |
| 5 | Unity editor handoff | P-02 | built: item 3 (Aran52/VUA#36), item 1's save and close with its MCP request (Aran52/VUA#53), and item 2's workshop buttons (Aran52/VUA#63); the author's check of a held project remains |
| 6 | SDK step for newcomers | P-02 | built: the sign-in guide, the SDK's own checks (Aran52/VUA#6), one-click fixes and plain-word messages (Aran52/VUA#12), the check read again after an upload (Aran52/VUA#44) and the build and upload guide (Aran52/VUA#59); the guide's four screenshots come from the author |
| 7 | Permission modes and simpler choices | P-02, P-03 | built: permission modes (Aran52/VUA#11), stated recommendations (Aran52/VUA#16) and the plan confirmation with the materials' BOOTH images (Aran52/VUA#63); the author's P-02 runs in each mode remain |
| 8 | Known packages | P-01, P-03 | built: the known-packages table (Aran52/VUA#21), multi-line Poiyomi copies with the preparation test (Aran52/VUA#55) and the package page by permission mode (Aran52/VUA#56); P-01 with a Poiyomi outfit awaits the author |
| 9 | Material tuning | P-02, P-03 | built: item 2 with its entry (Aran52/VUA#29, #34) and item 1, texture memory on the quality-check station (Aran52/VUA#57); the author's checks in a dark world and on a P-02 rank remain |
| 10 | Face tracking add-on | P-03 | built: face tracking evidence and guarded creator-patch sessions (Aran52/VUA#47), the session limit and the pre-patch copy (Aran52/VUA#52), and the workshop station (Aran52/VUA#62); the Meiyun run in VRChat remains |
| 11 | Unity sign-in and license | — | built: the detection and check engine and contracts (Aran52/VUA#28) and the scenario step in Avatar-editing preparation (Aran52/VUA#84); testing Hub's Unity CLI (item 3) and real license-failure recovery remain |
| 12 | Managed upload | P-02 | done: first real upload on 2026-10-17 (Aran52/VUA#4), a second through the MCP round on 2026-10-19 |
| 13 | Appearance and one-click styles | — | built: Grid, Aero, Tenshi and Jirai presets shipped (F3, VUA-Project/VUA#94); styles beyond the four approved presets, extended scene art, custom fonts and package loader remain |
| 14 | Player language and five-language review | P-02 | built: player-facing UI and minimal guides ship in five languages (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`); native-speaker review of all five UI languages remains |
| 15 | Versioned SOPs | A-03, B-02–B-05 | in progress: versioned diagnostic symptom SOPs landed in VUA-Project/VUA#98; remaining scenario SOP versioning continues |
| 16 | Eval runs | all `ready` cases | when a concrete need arises (author, 2026-10-23) |
| 17 | Complex production and Recipe reproduction | P-03, P-04 | in progress: community P-03/P-04 checks and further complex-production coverage beyond P-03/P-04 remain |
| 18 | Tool and package delivery by license | C-01, C-02 | built (VUA-Project/VUA#98): `tool-catalog v0.1`, `external-tool v0.4` and `installer-tool v0.1`, 10 VPM packages in `known-packages`, and tool goal/free filters; fresh-install, mainland-mirror and live VPM checks remain |
| 19 | Experimental VRChat sign-in | P-02 | merged (Aran52/VUA#5); the upload check reads VRChat's real list shape since slice 26; awaits the real-account checks |
| 20 | Start production from the materials room | P-02 | built (Aran52/VUA#19); local entry and saved-source display defects reproduced and corrected on 2026-10-27, with synthetic Chromium regression; the author's real-material run remains |
| 21 | Faster project fingerprints | — | done (Aran52/VUA#7) |
| 22 | Motion setting | — | needs the author's decision |
| 23 | Base map art | — | moot after F1 replaced the base map with the plain station list (Aran52/VUA#85) |
| 24 | Finer usual durations | — | when the estimates prove too rough |
| 25 | Production records in Settings | — | done (Aran52/VUA#13) |
| 26 | VRChat Avatar list in the release room | P-02 | built (Aran52/VUA#17); awaits the author's real-account check |
| 27 | Queue factory work | P-02 | built (Aran52/VUA#18): one job at a time, the rest wait in a visible queue; queueing and cancelling verified in the 2026-10-19 MCP round. Item 2: the engine (Aran52/VUA#23) and the workshop setting are in; a run with two lines side by side remains |
| 28 | Quitting during a task | — | done (Aran52/VUA#14) |
| 29 | Restore after an interrupted assembly | — | done (Aran52/VUA#15) |
| 30 | Workshop stations and line management | P-02 | built (Aran52/VUA#20) with removing an outfit through a reviewed plan (Aran52/VUA#58); the material change and deletion were verified in the 2026-10-19 MCP round; the author's two-outfit removal check remains |
| 31 | Change a finished line's base Avatar | P-02 | built (Aran52/VUA#27); awaits the author's real-run check |
| 32 | Agent interface refinements | P-02, P-03 | planned from the [reference study](../research/reference-projects-2026-10-19.md); item 2 and the Resources of item 3 moved to 44; remaining agent interface refinements follow |
| 33 | Switch options and built-result evidence | P-02, P-03 | in progress: items 1, 4 and 5 are built — switch options (Aran52/VUA#64), synced parameter estimate (Aran52/VUA#60) and VRCFury intake recognition + guide (F7, Aran52/VUA#89); the slider, built-result evidence and real VRCFury outfit check remain |
| 34 | Evidence layers and toolchain profile | P-03, B-02 | planned from the reference study |
| 35 | Start card, preflight and attribution | P-02, P-03 | in progress: item 2 pre-assembly prediction is built (F5, Aran52/VUA#87, extended with Skinned/Basic Mesh rank limits in VUA-Project/VUA#98); start card, release attribution, local lessons and P-02 prediction-tolerance check remain |
| 36 | Licensed entry guide | — | design drafted; awaits the author's network verification |
| 37 | Creator credits | P-02 | built (VUA-Project/VUA#98): creator credits on the release album (`CreatorCredits`); author check on a real P-02 album remains |
| 38 | Steadier regional latency | — | built: three connections per region, the minimum value and the proxy note (Aran52/VUA#46), and the tile's tiers (Aran52/VUA#54); latency calibration against in-game Ping waits for a need (author, 2026-10-23) |
| 39 | Resource panel that guides | P-02 | built (VUA-Project/VUA#98): tightest-resource title bar (F6, Aran52/VUA#88), 1-minute in-memory sparkline trend chart and AMF RAM capacity hint; live P-02 and VRChat sampling-budget check remains |
| 40 | Notification center redesign | P-02 | built (VUA-Project/VUA#98): ineffective "Show completed" setting removed (F2, Aran52/VUA#86), grouped notification center, unseen/failure bell alert and bounded dismissed-ID retention; author UI review remains |
| 41 | VN3 terms and filtering by use | P-02 | built: the backend (Aran52/VUA#31), the library drawer and MCP reads (Aran52/VUA#37), and the release room's check (Aran52/VUA#38); the author's check with real products remains |
| 42 | Line revisions and saved fits | P-02 | built: revisions (Aran52/VUA#40), saved fits (Aran52/VUA#45), the version list on the assembly station (Aran52/VUA#50) and the fit prompt and management (Aran52/VUA#51); the author's restore and fit checks remain |
| 43 | Fixes from the MCP round | P-02 | built (Aran52/VUA#32, #63): items 1, 3, 4 and 5, the banner names the failing field, the workshop follows tasks started elsewhere, and one card per run; a real reproduction of the transient failure remains |
| 44 | MCP result envelope | P-02 | done (Aran52/VUA#43): compact reads with Resources, the build in `vua_status`, and errors that say whether a retry is safe |
| 45 | Source hints from owned file names | — | built (VUA-Project/VUA#98): source hints matched from owned BOOTH archive file names; real-account library check remains |
| 46 | Library migration grouping | — | built (Aran52/VUA#94, F4): per-directory choices, loose-file grouping, confirmed/unassigned/excluded/unreadable areas, intake handoff and versioned migration manifest; author check on a real local collection remains |
| 47 | Library migration through the player's agent | — | built (VUA-Project/VUA#98): MCP migration planning and guarded group-import request sharing 46's manifest; author real-collection agent run remains |
| 48 | Identical content: the player's choice | — | planned; default keeps a separate copy for each item (author, 2026-10-21) |
| 49 | Shareable turntable with a Recipe link | P-02, P-04 | built: "VUA inside" turntable sharing and the mainland China trial share-link service (Aran52/VUA#72, #73), plus OpenGraph metadata on recipe share pages in VUA-Project/VUA#98; refinements beyond the merged state and P-04 cross-machine check remain |
| 50 | Optional AI connection | — | planned: optional AI connection changes (not part of first run, 2026-10-27) |
| 51 | Recipes creators trust | P-04 | in progress: recipe-booth-materials (Aran52/VUA#65), contextual terms, turntable sharing and `amf-recipe v0.6` (VUA-Project/VUA#97) are built; creator-trusted Recipes beyond the merged state and P-04 real-machine proof remain |
| 52 | Signed Windows releases | — | on hold (author, 2026-10-25): SignPath Foundation declined on 2026-10-24 for low public visibility; releases stay unsigned for now |
| 53 | Consistent interface by audit | — | in progress: item 1 (`design-audit`), first token pass (PR #67) and Grid normalization baseline landed; shared catalogue migration and area-by-area audit beyond the first report remain |
| 54 | [Interaction structure](../design/interaction-structure.md) | — | built (VUA-Project/VUA#97): merged into `main` with v1.1.0 Getting on Track; human UI review remains |
| 55 | Local diagnostics and symptom SOPs (`local-diagnostics v0.1`) | A-03 | built (VUA-Project/VUA#98): local config/cache/OSC/audio/SteamVR/log-category observation, 10 symptom SOPs, guarded offline OSC cache cleanup and `config.json` cache helper; author live-machine check (including `config.json` write) remains |
| 56 | Pose and tracking topology (`pose-graph v0.1`) | B-02–B-05 | built (VUA-Project/VUA#98): OpenXR runtime, OpenVR external drivers, Safe Mode block and multi-driver FBT conflict detection; live hardware check remains |
| 57 | VRM / GLB inspection and format filter (`glb-inspection v0.1`) | — | built (VUA-Project/VUA#98): pure-Rust header/JSON streaming inspection for `.glb` / `.vrm` (standalone and `.zip`), VRM bone/license facts and warehouse format filter; author check with real VRM/GLB archives remains |
| 58 | Open external managers (`manager-apps v0.2`) | — | built (VUA-Project/VUA#98): detached launch for Unity Hub (standard and MSIX AUMID), VCC and ALCOM; author MSIX Unity Hub sign-in check remains |
| 59 | Resource-saver mode while SteamVR runs (`desktop-resource v0.2`) | — | built (VUA-Project/VUA#98): automatic background saver mode while SteamVR is active; live VR session check remains |

Suggested next order: the author's real-machine checks listed in the rows above come first, while
functional fixes and remaining slice items proceed alongside. All newly delivered code is recorded
as `built`; acceptance continues to follow the [N sequence](../development-outline.md) and the
author's real-machine verification.

Every slice ships its player-facing text in the five UI languages; slice 14 covers native-speaker
review across all five.

## 1 — Integrate

1. Merge #83, then #84 (which now carries #85 and Aran52/VUA#1–#4), into `main`; merge #86.
2. Keep CI green on each pull request.

**Done when** all of them are on `main`.

## 2 — Finish the first real production runs

1. P-02 with lilToon from VPM: shading confirmed by the author. Save the result as a Recipe.
2. Run the missing-shader case (P-01) on a project whose material needs a shader it lacks.

**Done when** P-02 and P-01 pass as closed-loop runs in the app, with evidence in `_local_eval/`.

## 3 — Unity Hub and SDK sign-in

Both removed friction in the first real run, so they come before the previews (author decision,
2026-10-16).

1. VUA starts Unity Hub before Unity work and waits for its licensing client, so a license held
   by the packaged Hub is available.
2. All VUA work projects share one company and product name, so the SDK sign-in, which Unity
   keeps per product name under `LocalLow`, carries over between them. Existing work projects
   take the shared name at their next Bridge run.
3. VUA reports whether the SDK is signed in as yes or no through the Bridge; the sign-in itself
   stays inside the SDK.

**Done when** a run with Hub closed reaches a licensed Unity, and a second work project opens
signed in to the SDK.

## 4 — Result previews

1. The Bridge renders the finished Avatar from the front, side and back under neutral lighting,
   and one image per Avatar and outfit candidate during inspection, using the existing preview
   renderer. Images stay in the work project.
2. The Avatar page shows them; the agent reads them to check a result before asking the author.
   The MCP adapter returns them as image content, as the author approved on 2026-10-16.

**Done when** a P-02 result can be judged from its previews, and each candidate has an image.

## 5 — Unity editor handoff

1. The Bridge inside an open Editor accepts "save and close": save scenes and assets, quit, and
   send a receipt.
2. When work needs a project an Editor holds, the request card offers "Save and close Unity,
   then continue". After the look check, the page offers "Done checking, close Unity".
3. Opening the project for the SDK succeeds once Unity holds the project with the Avatar
   selected; when the SDK panel does not open by itself, the page says how to open it (VRChat SDK
   → Show Control Panel). In the MCP round the panel stayed closed on this machine, and the open
   task failed with `sdk_handoff_timeout`.

Item 3 is in (Aran52/VUA#36, [amf-production 0.23.0](../protocols/amf-production-v0.1.md)). The MCP
round's Unity spent 82 seconds on the project's first import, and its receipt (Avatar selected, panel
requested) arrived 30 seconds after the 180-second wait ended. The open now waits up to 10 minutes,
as a managed upload does, succeeds once the Avatar is selected, and the workshop names VRChat SDK >
Show Control Panel while Unity opens and after.

**Done when** a held project continues without closing Unity by hand.

## 6 — SDK step for newcomers

1. The Bridge reads the official SDK checks and performance statistics for the result.
2. VUA shows each item in plain words as "must fix before upload", "reminder, upload still
   works" or "affects the performance rank", with a one-click fix where VUA can make it.
3. An illustrated guide to the SDK panel in four languages: sign-in, build, warnings, upload.
4. An Auto Fix the player makes in the SDK panel during an upload reaches the line's facts: VUA
   reads the SDK's check again after the upload, so the release page and `vua_amf_run` stop showing
   the fixed error.

Done so far: the sign-in guide on the release page, and the SDK's own checks. The Bridge runs
the SDK panel's Avatar check without opening the panel; the release page groups its items as
"fix before uploading", reminders and notes, shows the performance rank for the build target
with what it means for other players, and lists the categories rated below Good. The SDK's own
Auto Fix runs from the release page behind a restore point, and the most common SDK messages
read in plain words with the original one click away. Remaining: the build and upload guide.

**Eval:** P-02 outside-help count. **Done when** the author uploads the P-02 result guided by
VUA alone.

## 7 — Permission modes and simpler choices

1. The workshop offers three permission modes, like an AI agent's (author ruling 2026-10-18):
   ask before changes, decide on its own, and full access, which warns first that it
   may mess up the Avatar. New and invalid preferences default to full auto (2026-10-27);
   existing ask/smart choices are preserved. The modes share one layout and differ in where the line stops; they
   describe what the player wants to hand over, not their experience with Unity.
2. VUA recommends the Avatar and outfit prefabs with stated rules (name match with the outfit's
   target, top-level prefab, the creator's base for outfits) and asks only when two candidates
   are equally plausible.
3. The confirmation reads as one sentence with images: BOOTH product images for materials and
   the previews from slice 4 for prefabs; binding details sit under "Adjust".
4. `vua_amf_plan` without a selection returns the recommendation.

**Done when** the author completes P-02 in full access without a confirmation, and in "ask before
changes" confirming each change with every detail adjustable.

## 8 — Known packages

1. A table of known packages: ID, feed, license, delivery policy, detection signals. Shaders
   come first:
   - lilToon (`jp.lilxyzw.liltoon`, MIT), already installed from its feed;
   - Poiyomi Toon, the free version (`https://poiyomi.github.io/vpm/index.json`, MIT per its
     repository); Poiyomi Pro stays with its own EULA;
   - UnlitWF (whiteflare's VPM feed), after its feed URL and redistribution terms are confirmed;
   - VRChat's Toon Standard ships inside the SDK (3.8.1 and later) for PC and mobile Avatars;
   - then VRChat SDK (official source), Modular Avatar with NDMF.
2. Bundled copies are recognized from each package's `legacyFolders` and `legacyFiles`
   (lilToon declares `Assets\lilToon`), generalizing the lilToon rule.
3. The package page follows the permission modes: full access resolves dependencies without
   asking; "decide on its own" shows it with "Next step" and "Handle dependencies for me"; "ask
   before changes" shows every package, version and feed.
4. The package page lists work projects with installed versions, updates and Recipe pins.

Done so far (Aran52/VUA#21): the [known packages](known-packages.md) table, detection by
material marker or shader GUID, installs from the official feed on a line's first preparation
and on a material change, Poiyomi Toon pinned to the material's version line, and the
`amf.package.guide` warning for packages the player gets themselves. Remaining: items 3 and 4,
and two follow-ups from the review:

- A bundled Poiyomi copy leaves for the official package only when it holds a single version
  line. Poiyomi releases also ship their older lines, so real bundled copies mostly import
  unchanged. Recording each release's full set of shader GUIDs would let those copies leave too.
- A preparation-level test that imports or skips a bundled copy's files as decided; the decision
  itself is tested.

**Done when** P-01 resolves its missing shader through a known package.

## 9 — Material tuning

1. Texture memory: measure each texture's memory and the total against VRChat's performance
   thresholds; lower Max Size and switch compression in the work project, reversible by
   snapshot.
2. lilToon brightness limits: align the outfit materials' lower and upper brightness limits with
   the Avatar's, so the outfit and body brighten and darken together across worlds.
3. Both follow the permission modes: applied toward a target (full access), as a reviewed list
   (decide on its own) or per material and texture (ask before changes).
4. Evaluate lilAvatarUtils (MIT) first; integrate it when it covers these steps.

**Done when** the P-02 result reaches a chosen rank, and its outfit and body match in brightness
in bright and dark worlds, without visible loss the author objects to.

## 10 — Face tracking add-on

1. Run the author's Meiyun face tracking add-on with the P-02 result; its patcher runs from an
   Editor menu, which the Bridge calls with the player's confirmation.
2. Record what the add-on needs (packages, menus, parameters) in the known packages and SOPs.
3. Check it with VRCFaceTracking through the tools page.

**Done when** the Meiyun result carries working face tracking, verified in VRChat.

## 11 — Unity sign-in and license

1. Detect the license from the license file (standard and packaged-Hub locations), whether Hub
   and its licensing client run, and a short real check in a VUA-owned project.
2. The scenario step shows the state and the one next action; a production license failure
   opens that step with the run retained.
3. Test the Unity CLI that Hub installs at `%LOCALAPPDATA%\Unity\bin\unity.exe`.

**Done when** a fresh machine reaches a licensed Unity run guided by VUA alone.

## 12 — Managed upload

1. Verify the SDK's build-and-upload interface in SDK 3.10.5, including whether it needs the
   Editor window.
2. The player confirms the content rights statement in VUA for each upload; the VRChat sign-in
   stays in the SDK.

SDK 3.10.5 hands out its builder only while the SDK control panel is open and signed in, and
shows VRChat's ownership agreement in that panel, so the upload runs in the Editor's interface
through the [Bridge v5 handoff](../protocols/unity-bridge-v5.md#managed-upload-in-the-open-editor).
The player's experimental [VRChat sign-in inside VUA](vrchat-account.md) hands its session to
the open Editor before an upload ([vrchat-session v0.1](../protocols/vrchat-session-v0.1.md)),
so the panel starts signed in, and each upload record names where its sign-in came from.

**Done when** the P-02 result uploads from VUA with the player's confirmation.

## 13 — Appearance and one-click styles

1. Design session with the author: which screens, and whether a style may recolor the module
   colors. The first two styles come from the author's briefs; the current purple style stays
   as the default:
   - **天使界隈 (Tenshi)**: sky blue and white, wings and halos, bandages, pills, flat;
   - **地雷系 (Jirai)**: pink and black, lace, bows, energy drinks, leather, dimensional.
2. Move remaining literal values into tokens (colors, radii, shadows, font sizes, timings).
3. A style is token data plus its motifs (patterns, icons, textures), checked against a schema
   and switched with one click in Appearance and the command palette; contrast is checked per
   style in dark and light.
4. Redo the notification panel's size and animation; build the production animation from real
   step events.

**Done when** the author switches styles in one click and approves the redone screens.

## 14 — Player language and four-language review

1. Remove internal references and process vocabulary from UI text; add a four-language
   terminology table and a check for Chinese full-width punctuation.
2. Rewrite the Japanese and Korean strings for the AMF, tour and onboarding pages natively.
3. Review every screen and message added in slices 3–13 in all four languages with the author.

**Done when** the author reviews the AMF journey and the new screens in all four languages.

## 15 — Versioned SOPs

1. Turn the scenario SOPs into versioned SOP documents with the fields in the north star.
2. Write the first symptom-to-solution SOPs and serve them through Help and `vua_sop`.
3. Record each SOP's last verification.

**Eval:** A-03, B-02, B-03, B-04, B-05. **Done when** these cases are `ready` and pass in both
channels.

## 16 — Eval runs

1. Convert the cases into machine-readable files and define the run record.
2. Run every `ready` case in the app and through an MCP agent; publish the two pass rates and
   median times with the next release.

**Done when** a release reports both metrics.

## 17 — Complex production and Recipe reproduction

1. Run the N3 complex case with the author's real materials, then repeat it in a clean project.
2. Reproduce it from a Recipe in a second project, including reapplication and conflicts.
3. Run both through the MCP agent as well.

**Eval:** P-03, P-04. **Done when** the N3 and N4 acceptance rows pass.

## 18 — Tool and package delivery by license

1. Add license, delivery-channel and verified-version fields to the tool catalog and the known
   packages.
2. Mirror license-permitted packages and tools on VUA's mainland China host, unchanged, with
   their license text, verified against the official hashes and labeled as mirrors; packages
   under their own terms (VRChat SDK) come from the official source.
3. Test installation from a mainland China network on the author's remote host.

**Eval:** C-01, C-02. **Done when** both pass, including the mainland China run.

## 19 — Experimental VRChat sign-in

Designed in [VRChat sign-in](vrchat-account.md) (author decision, 2026-10-18).

1. An Experimental setting, off by default, with the risk explained before the first sign-in;
   sign-in in VUA with VRChat's two-factor step; the session kept, the password only with
   "Remember my password", both encrypted per Windows user.
2. Before a managed upload, the SDK in the open Editor receives the session and starts signed in.
3. After an upload, VUA checks the Avatar against the player's Avatar list.

**Done when** the author signs in once in VUA, an upload starts with the SDK already signed in, and
the upload check finds "AMF test1".

## 20 — Start production from the materials room

1. Choosing an Avatar in the library offers "Start production", with the outfits that fit it
   marked, and opens a new production line with them selected.
   Local entries offer "Use as Avatar" without requiring a BOOTH association or catalog
   classification. This selects the exact local entry; the confirmation still requires usable
   material sources and an Editor. Saved source associations guide previews, while local content
   remains unverified until independently checked.

**Done when** P-02 starts from the materials room without visiting the workshop's selection.

## 21 — Faster project fingerprints

After each Unity run VUA fingerprints the whole work project; on the development machine this takes
about 40 seconds for the Meiyun project (about 4,200 files).

1. Cache each file's hash by path, size and modification time, and hash only changed files.
2. Show the check as its own stage in the line view.

**Done when** the check after an unchanged reinspection takes a few seconds.

## 22 — Motion setting

VUA follows Windows' animation setting, which flattens CSS motion on the development machine; the
factory camera, page turns and album tabs are scripted and follow resource-saving mode instead.

1. The author decides whether all VUA motion follows its own resource-saving mode, with Windows'
   setting as the default for new installs.

**Done when** the chosen rule applies to every animated screen.

## 23 — Base map art

The base map's rooms are drawn in code from simple shapes. Art for the default and native skins
(sprites or skeletal animation for workers, props and stages) comes with slice 13's design session,
in the scene-pack format of the [skin system](skin-system.md).

**Done when** the default skin's rooms use their art pack, with the code-drawn scenes as fallback.

## 24 — Finer usual durations

"Usually … on this computer" is the median of earlier steps of the same kind. If the estimates
prove too rough, group them by project or by the number of imported assets.

**Done when** the shown usual time lands within a third of the actual time for most steps.

## 25 — Production records in Settings

The release room's "Production records" tab lists runs and their records for diagnosis.

1. Move it into Settings as debugging information; the release room keeps the album of
   finished Avatars.

**Done when** the release room shows only the album, and Settings shows the production records.

## 26 — VRChat Avatar list in the release room

1. With the [experimental VRChat sign-in](vrchat-account.md), the release room shows the
   account's own Avatars: name, image, release status, platforms and last update.
2. Finished Avatars link to their VRChat entry, and the list marks the Avatars VUA uploaded.

**Done when** the author sees "AMF test1" in the list with its current state on VRChat.

## 27 — Queue factory work

The factory runs one Unity task at a time. Unity itself can open several projects at once;
VUA keeps to one because each Unity run uses most of the machine and an upload uses the
interactive Editor. Work requested while a task runs waits for it (Candidate
[amf-production 0.16.0](../protocols/amf-production-v0.1.md#queue)).

1. Uploads and other Unity work requested while a task runs wait in a visible queue and start
   in order; the player can remove a waiting item.
2. Later, on machines with enough memory, work on different projects may run side by side.

Item 2's engine is in (Aran52/VUA#23, [amf-production 0.19.0](../protocols/amf-production-v0.1.md#queue)):
`amf.production.setCapacity` sets a capacity of 1–3 while no Unity work runs or waits, and
uploads, editor handoffs and deletions run alone. Remaining: the workshop setting, and the rooms
reading several running jobs instead of one.

**Done when** an upload requested during a reinspection starts by itself when the reinspection
ends.

## 28 — Quitting during a task

Quitting VUA from the tray during an AMF task stops the task and Unity without asking. A crash or
a forced end stops Unity too: the AMF provider keeps Unity in a Windows job that ends with it.

1. Quitting while a task runs asks first: stop the task and quit, keep VUA running in the tray,
   or cancel.

**Done when** quitting during a reinspection offers the three choices.

## 29 — Restore after an interrupted assembly

After a forced end, a line whose assembly was running shows "needs a new check", and its work
project may be half assembled. The restore point taken before that assembly is kept; today the
player reinspects first and then restores from the workshop.

1. At the next start, such a line offers "Restore to before this assembly" directly, next to
   "Continue".

**Done when** a line interrupted during assembly returns to its pre-assembly state in one step.

## 30 — Workshop stations and line management

Author request, 2026-10-18.

1. The workshop's separate checks page leaves; the product boundary dropped it on 2026-09-22, and
   the checks live in the intake-check and quality-check stations and the release room.
2. Each station on a line is a place to click: materials, intake check, plan, assembly and
   quality check each open their own panel; without a choice the page follows the line.
3. A line changes its own materials in place ([amf-production 0.17.0](../protocols/amf-production-v0.1.md#changing-a-lines-materials))
   behind a restore point that keeps the earlier materials; a finished line can change its plan
   and assemble only what changed.
4. Each line card closes from its corner: hide, or delete after a confirmation, which removes
   the work project and the line's records.

**Done when** the author swaps the outfit of a finished line on that same line, brings the earlier
outfit back from the restore point, and deletes a test line whose work folder is then gone.

## 31 — Change a finished line's base Avatar

Found in the author's use, 2026-10-19. A line's Avatar prefab comes from the stated
recommendation, which prefers the creator's base for outfits, such as Meiyun's `Meiyu_改変`.
On an assembled line, choosing another Avatar prefab in the plan, such as the standard `Meiyun`
that wears its own outfit, stops with "Choose a new Avatar to change the base prefab"
(`avatar_target_changed`), and the workshop offers no way forward. Keeping the base's own
outfit and adding to it is a common wish.

1. Choosing another Avatar prefab on a finished line rebuilds the line on that base: behind a
   restore point the work scene starts fresh, as for a material change, and the new base and
   every chosen outfit are assembled again.
2. The plan says so before assembly, and the restore point brings back the earlier base.

**Done when** the author moves a finished Meiyun line from `Meiyu_改変` to `Meiyun`, keeps its
outfits and adds one, and returns to the earlier base from the restore point.

## 32 — Agent interface refinements

Lessons 1–8 of the [reference study](../research/reference-projects-2026-10-19.md#vrcforge-the-agent-interface).

1. Small edits (material values, a menu entry, removing one outfit) as preview and apply pairs:
   the preview returns a digest, and the apply refuses a changed scene or hierarchy.
2. Tool results state whether a mutation started, committed, persisted and was read back, and
   whether a retry is safe.
3. Run facts and Build Records as versioned MCP Resources; versioned SOPs as MCP Prompts with a
   content hash.
4. Help writes the connection into the chosen AI tool's configuration file, with STDIO next to
   Streamable HTTP, when the player asks for it.
5. A supervised hand adjustment in the open Editor: the agent prepares a proxy, the player drags
   it, the agent finalizes.
6. Reflection-only checks with Gesture Manager (switch behavior in Play Mode) and NDMF's
   parameter count.

**Done when** an agent completes a P-02 material adjustment through a preview and apply pair,
reads the run as a Resource, and recovers from a dropped connection without a repeated write.

## 33 — Switch options and built-result evidence

Lessons 9–13 of the [reference study](../research/reference-projects-2026-10-19.md#vrcfury-and-modular-avatar-assembly-features).

1. Switch options in the plan: saved state, default on, an exclusive group for main outfits and a
   slider, built with MA's Object Toggle and Menu Item.
2. Previews, the turntable and the menu check run on the NDMF-processed clone.
3. The quality-check station lists mixed Write Defaults, empty layers, uneven anchor override and
   bounds (fixed through MA Mesh Settings), duplicate PhysBones, unused bones and parameter order
   across PC and mobile.
4. The plan shows synced parameter bits against 256 before assembly.
5. The intake check recognizes outfits carrying VRCFury components; the known packages list
   VRCFury with `guide` delivery from its official VCC feed after its license check.

**Done when** a P-02 line with two outfits in one exclusive group passes the quality check on its
built result, and an outfit with VRCFury components shows the guide for VRCFury.

## 34 — Evidence layers and toolchain profile

Lessons 14–19 of the [reference study](../research/reference-projects-2026-10-19.md#vrchateditorskill-inspection-and-evidence).

1. Each fact on the check stations and the release page carries its evidence layer: static
   source, Unity-resolved, NDMF-built, SDK build, client runtime or confirmed upload.
2. The intake check records the providers the Avatar and outfits use as a toolchain profile.
3. The result's Expressions Menu tree, traced to parameters and objects, joins the Build Record and
   the Recipe.
4. Changes to shared assets copy them after listing their users; generated output stays untouched.
5. The first symptom playbooks (menu missing, parameter without effect, merged Animator missing,
   wrong binding, wrong switch default) become SOPs for slice 15.

**Done when** the P-03 result shows its menu map with evidence layers, and an agent diagnoses a
missing menu item from the playbook SOP.

## 35 — Start card, preflight and attribution

Lessons 20–28 of the [reference study](../research/reference-projects-2026-10-19.md#vrchat-avatar-acceptance-workflow-flow-and-acceptance).

1. One start card per line with the recommendations prefilled: delivery layer, size limit,
   quality and performance trade-off, menu structure and language, upload authority.
2. Before assembly the plan predicts each outfit's size, triangles, material slots, texture
   memory, PhysBones and parameter bits.
3. The release page attributes the change from the base Avatar to each outfit and shows the SDK's
   uncompressed size with a warning line at 90 % of its limit.
4. Menus keep the creator's parts menu, with main outfits exclusive and at most 8 controls per
   page.
5. Body-shape variants of the Avatar need matching outfit support before assembly.
6. One targeted repair per defect, then restore or isolate; uploads private by default.
7. Local lessons from the player's corrections, keyed by the materials they concern.
8. A finished state requires the Build Record's evidence to close.

**Done when** a P-03 line runs from one start card to a release page that attributes each
outfit's cost, and a repeated correction is suggested from its lesson on the next line.

## 36 — Licensed entry guide

Designed in the [licensed entry guide](licensed-entry-guide.md) (author ruling, 2026-10-19).

1. The author verifies pixiv sign-up, BOOTH, card payment and PayPal from the remote host on a
   mainland China network.
2. The guide's six parts as versioned SOPs in four languages for every player outside Japan,
   opened from Help and the library; the mainland China payment note is chosen by the player at
   the payment step.
3. Images and animations download as content packs when a part opens.
4. A reachability check for the sites the guide's steps use, built on the website tests.

**Done when** a player in mainland China with no pixiv account completes a first BOOTH purchase
guided by VUA alone, the purchase arrives in the library, and a player who never opens the guide
downloads none of its content packs.

## 37 — Creator credits

1. The release room lists, for each finished Avatar, its materials with their creators and BOOTH
   pages, from the Build Record's provenance.

**Done when** the P-02 result's album entry names Meiyun's and the outfit's creators with links
to their BOOTH pages.

## 38 — Steadier regional latency

The Play network tile compares VRChat's four regions with
[Oracle reference origins](../architecture/network-onboarding.md#user-outcome-and-approximate-regional-references):
one warm-up and the median of three HEAD responses on one connection per region
([website-tests 0.3](../protocols/website-tests-v0.1.md)). The author finds the results unsteady.
A run from this development machine on 2026-10-19 (curl, eight requests per region) showed
steady response times after TLS, Tokyo 11–32 ms and Amsterdam 231–239 ms, and single TCP
connections up to ten times slower than the region's median. Three samples on one connection let
two such outliers decide the value, and international routes can differ per connection.

1. Measure on two or three connections per region: one warm-up each, then nine HEAD responses
   in total spaced about 150 ms apart. Report the minimum as the region's value, with the median
   and the spread from the minimum to the 90th percentile.
2. Sample the four regions in turn (Tokyo, US West, US East, Europe, then again), so all four see
   the same moments of the network; regional tests wait for running website tests.
3. The tile shows the regions in order with a tier; regions within 15 ms or 10 % of each other
   read as close, and a large spread reads as unsteady. Milliseconds stay in the expanded
   details.
4. When a reference resolves into `198.18.0.0/15` or a proxy is set for VUA's process, the result
   says it was measured through a proxy on this computer, whose route can differ from the game's.
5. A new website-tests version records the method; the four origins and the wire shape stay.
6. Calibration: on two or three networks, including the remote host on a mainland China network,
   the author joins an instance in each region and notes VRChat's own Ping; the tile's first
   region is compared with the lowest in-game Ping.

**Done when** repeated tests on one network give the same first region, and the calibration
runs agree with the in-game Ping on the first region. Real UDP measurement through VUA-hosted
echo endpoints is decided after the calibration.

## 39 — Resource panel that guides

The title bar shows 100 % minus the mean of CPU, GPU, RAM and VRAM, with a warning from 90 %.
A native helper samples PDH counters every 2 seconds and re-enumerates adapters every 30 seconds
by creating a D3D12 device on each; the renderer polls every 2 seconds while VUA runs.

1. The title bar names the tightest resource or a state (plenty, getting tight, tight) from the
   highest reading instead of the mean, at a fixed width.
2. The panel ties readings to VUA's work: the largest memory users with VUA's own tasks marked
   (for example a Unity import), a suggested production capacity from total memory, and VRAM next
   to the Avatar's texture memory from slice 9.
3. The title bar shows a reading smoothed over about 10 seconds; the panel shows the last minute
   as a sparkline kept in memory only.
4. Lighter sampling: polling stops while the window is hidden and slows to 5 seconds while the
   panel is closed; each adapter's integrated or discrete kind is cached by LUID, so a D3D12
   device is created only for a new adapter; the cost of the `GPU Engine(*)` counter is measured
   with VRChat running.

**Done when** the title bar names the bottleneck during a P-02 run, and the panel's own sampling
stays under a measured budget with VRChat running on the development machine.

## 40 — Notification center redesign

Author review, 2026-10-19. The bell is a 16 px outline icon in the secondary text color, and its
badge counts only running tasks and waiting AI requests. The panel opens over a full-window blur
and closes on an outside click, an outside scroll, Escape or when the window loses focus, so it
cannot stay open while the player works. Rows use different layouts for downloads, counted
progress, errors with raw codes, AI requests and the AMF failure line, and show no times. "Show
completed" has no effect: the notification hook never passes the set of tasks that finished in
this session, and the setting leaves with this slice.

1. The bell shows what waits: an alert color for a failure, the accent for something the player
   must confirm, a progress ring while work runs, and a dot for results not yet seen.
2. A pin turns the panel into a side drawer without a backdrop that stays open beside the page;
   unpinned, it keeps today's popover behavior.
3. One card layout for every entry: status icon, title and time; one line of state or result (for
   AMF work the step with its elapsed and usual time); an optional progress bar; actions on the
   right; error codes under "Details". AI requests and AMF failures use the same card.
4. Three sections replace "Show completed": needs you (AI requests, failures, waiting for input),
   running, and finished this session with "Clear all". Older history stays in production records
   in Settings. Each kind of work keeps its own latest finished entry, so a turntable bake no longer
   hides the assembly that preceded it.
5. A long task that finishes or fails while VUA is in the background raises a Windows
   notification.
6. The cleared-entry list keeps only entries of tasks that still exist.

**Done when** the author follows a P-02 assembly in the pinned drawer while using the workshop,
sees a failure on the bell without opening it, and gets a Windows notification for a task that
finished in the background.

## 41 — VN3 terms and filtering by use

Many Avatar bases and outfits link their VN3 license from the BOOTH description, mostly as Google
Drive or Docs PDFs. VN3 documents come from its license generator: items A–X with a small closed
set of values, a generator and VN3 version in the footer, and a free-text special note that takes
precedence over the rest. Read on 2026-10-19 from Shinano's English VN3 document (generator 1.11,
VN3 1.10). BDL's `term_observations` table exists without a writer.

1. Recognize license links in product descriptions and fetch public documents one at a time,
   without cookies, from Google's public download endpoints; cache them by content hash on this
   computer.
2. A versioned rule parser turns each document into its A–X values with conditions, such as
   permitted with a content rating; unrecognized wording or versions stay unknown. No AI service
   reads the documents.
3. BDL stores documents, items and their link to products; a terms contract answers a product's
   terms and checks one material or an Avatar's materials against use presets (VRChat personal
   use, individual and corporate VTubers, game development, outfits for sale, merchandise and
   publications, adult content), with the strictest item deciding and unknown never passing.
4. Claude adds the library and release-room views and the MCP tool afterwards.

The backend is in (Aran52/VUA#31, [terms v0.1](../protocols/terms-v0.1.md)). The library's product
drawer shows each use's decision with its conditions, the creator's special note first and every
item, with a read-again action; `vua_terms` and `vua_terms_check` give agents the same evidence
(Aran52/VUA#37, [ai-tools 0.7.0](../protocols/ai-tools-v0.1.md)). The release room checks a finished
line's Avatar and outfits together for one use before the upload; each material source names the
BOOTH products its library entry maps to (Aran52/VUA#38, [amf-production 0.24.0](../protocols/amf-production-v0.1.md)).
Remaining: the author's check with real products, starting with Shinano. A catalog-wide index
built on VUA's servers waits for the author's decision.

**Done when** Shinano's terms read F as permitted with a content rating and R as contact the
licensor, and an Avatar's materials are checked together for a chosen use.

## 42 — Line revisions and saved fits

Found in the MCP round, 2026-10-19: each line keeps one restore point, every protected change
replaces it, and the panel names neither. The author chose state records over project copies on
the same day, and asked that adjustments the player makes in Unity be kept.

1. Before each protected change, the line records a revision of its state: the Recipe state
   (materials by content, Avatar, outfits with their fits, pinned packages) with VUA's adjustments
   (brightness values per material, SDK fixes), what changed, when, and a summary of its facts. A
   revision takes kilobytes; a line keeps its last 50.
2. Restoring a revision replays it through the existing steps: the materials change back, the line
   assembles (or rebuilds on another base) with the recorded choices, and the recorded brightness
   values, SDK fixes and fits apply. The plan names what changes and is digest-bound. Restoring
   records the current state first, so it can be undone. The assembly station lists revisions;
   `vua_amf_run` lists them, and restoring stays the player's action.
3. One project copy per line remains for automatic recovery when a change fails or VUA stops during
   it (slice 29); older copies are removed. When the project changed in Unity outside VUA, the
   revision says so, and the restore plan names the changes it will replace.
4. Recipe v0.4 carries VUA's adjustments and each outfit's fit, so a saved or shared Recipe
   reproduces a tuned line.
5. Saved fits. After an assembly the Bridge records the local position, rotation and scale of each
   outfit's objects; an outfit's own offsets are part of that record. When the player saves the
   work scene in Unity, the Bridge reports the objects that moved since. VUA offers to keep them as
   a fit named "[outfit]For[Avatar]", which the player can rename; a kept fit applies whenever
   that outfit is assembled on that Avatar again, and the plan names it. Textures stay out.

**Done when** the author changes a line's outfit, assembles, and brings the earlier outfit back
from its revision; and a hair clip moved in Unity sits in place on the next line with the same
Avatar.

## 43 — Fixes from the MCP round

Issues 2–5 and 10 of the round's report, and one found while reading its records.

1. An upload an AI requests is confirmed on the release page: the request card takes the player
   there instead of approving in place, and a failed approval names its cause instead of "could
   not connect".
2. The line page clears a load error once the run loads again and keeps the field that failed
   validation; the transient failure seen twice in the round is found and fixed.
3. Reading a run that does not exist reports `run_not_found` instead of `store_failed`.
4. A request for a project that Unity holds is refused when it is made, without a failed task;
   the line page's progress line updates when a task ends.
5. Deleting a line also removes its assembly records.
6. The workshop showed two line cards for one run once; it is reproduced and the list fixed.

**Done when** the round's upload, delete and stop cases repeat without a misleading message, a
stale banner or a stray record.

## 44 — MCP result envelope

Agent-side findings of the MCP round, rated per tool in its report, together with items 2 and 3
of slice 32, so the result shape changes once.

1. `vua_tasks` takes a limit and a state filter, newest first.
2. Reads stay compact: `vua_amf_run` returns a summary with a link to the run's full facts as an
   MCP Resource that carries its revision; `vua_library` returns one image per product unless asked
   for more. The release state is a Resource too.
3. `vua_status` reports the build: product version, commit and build time.
4. Every error states its code, the plain-language message, the next action, whether a change
   started and whether a retry is safe. Task reads add, for production work, whether the change
   started, committed and was checked in Unity, and its recovery.
5. Tasks say who started them: the player, the workshop's automation or an AI request.

**Done when** an agent repeats the round's reads at under 10 KB each, reads a run's full facts as a
Resource, names the build it tests, and after a dropped connection decides from a task read
whether to retry.

## 45 — Source hints from owned file names

Author decision, 2026-10-20. Source hints in `source_hint` (`crates/acquisition/src/library_reconcile.rs`)
compare a local entry's names with product IDs and titles of known products. Account sync already
records each owned file's BOOTH name in `product_downloadables.anchor_text` (BDL v0.4); in the
author's library on 2026-10-19, 84 of 85 owned file names were distinct. Filename cleanup rules of
the kind VRCAL uses stay out: they guess and can remove meaningful words.

1. A local original whose file name equals exactly one owned file name suggests that file's
   product, ranked after an explicit association and existing mapping, before product IDs and
   titles. A name shared by several owned files suggests nothing.
2. The hint stays a read-model suggestion; content equality still comes from the hash
   verification, which reports equal or unverified content as today.

**Done when** a local copy of an owned BOOTH file suggests its product by its file name in the
library, and a file name shared by two products suggests none.

## 46 — Library migration grouping

The library's "Import multiple items" entry previews a chosen directory read-only. The
[migration design](library-migration-design.md) defines the grouping the player confirms: each
directory is one material, a collection to review, or excluded; loose files are grouped,
separated or excluded; every observed file has exactly one disposition, and groups never
overlap. This slice executes it.

1. The preview offers the three choices per directory, the bulk "these selected sibling folders
   are separate materials", and loose-file grouping, with undo before submission.
2. Confirmed materials, unassigned, excluded and unreadable areas show separately; the import
   runs only on confirmed complete groups and names any remainder.
3. Each confirmed group becomes one library entry through the existing copy-in intake, keeping
   its relative paths; originals stay unchanged.
4. The grouping is a versioned migration manifest, the same document slice 47's agent writes.

**Done when** the author migrates a real local collection with wrappers, mixed loose files and
nested collections into the library, with every file accounted for.

## 47 — Library migration through the player's agent

Author idea, 2026-10-20: the player tells a connected agent "organize my library into a format
VUA can use", and the agent handles the corner cases of each personal folder layout. VUA publishes
the format and keeps the validation and the copy.

1. An MCP read returns the migration manifest's schema, its rules and an example: materials as
   groups of files under a chosen root, optional names, BOOTH product IDs as claims, excluded
   paths, and the coverage and no-overlap rules of slice 46.
2. The agent reads the folders itself and requests an import with a manifest. VUA validates it
   (paths inside the root, files present, full coverage, no overlap) and shows it in the migration
   preview as proposed groups; the player confirms like any other AI request, and the permission
   modes decide how much is shown.
3. The agent changes no files; product IDs in a manifest remain claims, checked like the player's
   own association.

**Done when** an agent turns a real messy collection into a manifest that VUA accepts, and the
player imports it after reviewing the proposed groups.

## 48 — Identical content: the player's choice

The [warehouse layout ruling](../decisions/warehouse-layout.md) (2026-09-06, ruling 2) keeps every
copy: importing the same content twice stores it twice. The author decided on 2026-10-21 that the
player chooses instead. Inspection facts are already keyed by content (`local_artifacts`), so
VUA knows which copies are identical.

1. A new decision records the choice and replaces ruling 2; the ruling itself stays as recorded.
2. A library setting, "Identical files": keep a separate copy for each item, or store the content
   once; the default keeps a separate copy, as today (author, 2026-10-21). Storing once keeps every
   library item and its relative paths; identical files share their bytes through NTFS hard links
   inside the warehouse. Where a hard link is unavailable (another volume after a relocation, a
   file system without hard links), VUA copies and says so.
3. For a warehouse that already holds identical copies, the setting offers to share them, after a
   preview of the items and the space they take; no item is removed.
4. Removing an item's files removes only its own links; the content stays while another item uses
   it. Space shown in the library counts shared content once.

**Done when** the author imports the same package twice with each setting, and with "store once"
the warehouse holds its bytes once while both items open, produce and delete independently.

## 49 — Shareable turntable with a Recipe link

Author request, 2026-10-24. A finished line already bakes a 60-frame turntable
([amf-production](../protocols/amf-production-v0.1.md), `bakeTurntable`), and a saved Recipe
already exports a reviewed share declaration, the `vuar0.4.` paste text of
[Recipe v0.4](../protocols/amf-recipe-v0.4.md) with BOOTH references and no machine paths. A
still picture looks like any Unity screenshot; the turning Avatar is what players post.

The author tested X on 2026-10-24: a video cannot be dragged out of a post, and an image dragged
from X into another application arrives recompressed, without EXIF or other metadata. The Recipe
therefore travels in the pixels as a short link, not in the file's metadata.

X also turns an uploaded GIF into a video, which cannot be dragged out, so the image players
drag from X is a still picture; the animated GIF serves chats and Discord.

1. The release room exports the turntable as a still PNG of a chosen angle, for X, and as an
   animated GIF for chats and Discord. Size and frame rate fit the platforms' upload limits.
2. Each image carries a small VUA logo mark. With a Recipe included, the mark becomes a
   "VUA inside" badge with the logo, in the manner of "Intel inside" (author, 2026-10-24).
   Including the Recipe is the player's choice per export and runs the existing reviewed share
   export first.
3. The short code is for VUA only and hides in areas whose colour VUA controls (author,
   2026-10-24): the code's modules are blocks a few luminance levels lighter or darker than their
   surroundings. The main carrier is the plate of the "VUA inside" badge, which VUA draws on any
   picture, so the code reads on any background; on the turntable's plain background further
   copies repeat around the Avatar. People see the badge and the picture; VUA subtracts the known
   plate or background colour and reads the code. The contrast and module size are the smallest
   that pass a round trip through X in testing, including the smaller copies X serves.
4. Publishing stores the shared document on VUA's link service under a content-derived code
   (`https://<host>/r/<code>`): the code is a prefix of the document's SHA-256, so VUA verifies
   whatever the service returns. Publishing is explicit, needs no account, and the player can
   withdraw a link they published.
5. Dropping an image or pasting a link in VUA reads the code, fetches and verifies the document
   and opens its preview, with the image as the preview picture. The link also opens a web page
   listing the materials with their BOOTH pages and creators, and "Open in VUA"; the export offers
   the link for the post text.
6. Besides Recipes, a shared document can be a selection of BOOTH products, reusing the
   [selection drafts](../protocols/recipe-selection-draft-v0.1.md): a receiver sees the products,
   which they own, their terms and the BOOTH pages, and can keep them as a draft.
7. Two more ways to make such pictures (author, 2026-10-24):
   - right-clicking a BOOTH product in the library or the workshop exports its product image
     with the badge and a one-product selection;
   - a standalone badge maker adds the "VUA inside" badge to any picture the player chooses,
     carrying a Recipe, a selection draft or a few products picked on the spot.
8. The paste text stays available for players without a network or who prefer not to publish.

**Done when** the author posts the P-02 turntable PNG and a product picture on a busy background
to X, drags each from X into a second VUA, and VUA opens the Recipe and the product selection,
while the badge and the picture look unchanged to the eye.

## 50 — Optional AI connection

Author decision, 2026-10-24, for players in Japan who avoid AI tools. The local MCP connection
is already off until the player enables it in Help. The choice becomes visible and complete.

1. First run asks only for a language (2026-10-27); AI is not part of that page. When AI tools
   become relevant, Help or Settings offers a neutral opt-in with "No" as the default, and the
   choice can change later.
2. With "No", VUA shows nothing about AI: the Help entry, AI request cards, the agent wording of
   the permission modes and AI mentions in tours stay hidden, and the MCP connection cannot be
   enabled until the choice changes.
3. With "Yes", the Help entry works as today; the connection itself still starts only when the
   player turns it on.

**Done when** first run contains no AI interview, the default opt-out shows no AI wording anywhere
the author looks, and opting in through Settings brings back the Help entry without a restart.

## 51 — Recipes creators trust

Author request, 2026-10-24: Avatar creators who see VUA's promotion should find Recipes
impressive, useful and safe. Budget: 24 hours of work for each of four agents. Today a Recipe
([v0.4](../protocols/amf-recipe-v0.4.md)) saves, shares and reproduces a line, but reproduction
resolves materials by exact SHA-256, so a creator's routine package update breaks every shared
Recipe; the receiver learns what is missing only when preparation fails; and P-04 has not passed.

The promise to a creator: a Recipe is a list, never a copy. It carries BOOTH product references
and settings, no files; each receiver must own and hold the materials; the creators are named;
their terms are checked.

**A — Materials found by BOOTH product** (agent, `recipe-booth-materials`). The author ruled on 2026-10-24 that
a Recipe locates materials by BOOTH product ID instead of exact SHA-256. A new Recipe version
names each material by its BOOTH product, keeps the package file name as a hint and the
original digest as evidence only, and records prefab GUIDs. Reproduction takes the receiver's
files of that product, picks the package by name (or asks among the product's packages, such as
per-Avatar variants), inspects it in Unity and maps the saved prefabs and bindings by GUID, then
path. The plan lists each changed or missing target to review; nothing maps silently.

**B — "Wear this" for the receiver** (Claude). Opening a Recipe by paste text, file or a "VUA
inside" image shows one page: the result previews when the image carried them, each material as
owned and present, owned and not downloaded (download it), or not owned (its BOOTH page), and the
terms check. One action prepares and assembles under the player's permission mode, and the result
shows beside the sender's previews.

**C — Terms everywhere** (agent, `terms-everywhere`). VN3 terms today appear in the library drawer, the
release room's check and the MCP reads. The library gains a filter by use, so a player finds
the materials fit for a VTuber or a game; before a Recipe is imported, the check runs across all
its materials for the receiver's chosen use; the share preview lists exactly what the Recipe
contains, and exported Recipes carry the material creators' names for slice 37's credits.

**D — The shareable turntable** (agent, `turntable-share`). Slice 49 in VUA: GIF and PNG export, the
"VUA inside" badge and the code hidden in the background, publishing and withdrawing a link, and
reading the code from a dropped image or a pasted link.

**E — The share link service** (agent, `share-link-service`). Slice 49's service and its web page: storing
validated Recipes and product selections under content-derived codes, withdrawal, rate limits,
and the material page in five languages, which shows the product list and leaves out the
player's own title. It runs on the author's existing server in mainland China; a Tokyo server
with the same code follows only if tests from abroad show connection problems (author,
2026-10-24).

**Proof.** After A–E, the author and Claude run P-04 with real materials: three base Avatars, each
reproduced on a second computer, one of them after a package update. The runs, with their
turntables, become the material for the first creator contacts.

**Done when** a Recipe shared as a "VUA inside" picture on X reproduces the same Avatar on another
computer after one of its packages updated, the receiver sees what they own, miss and may use before
anything runs, and P-04 passes.

## 52 — Signed Windows releases

Author decision, 2026-10-24: VUA applies to the SignPath Foundation's free code signing for open
source, and signing moves from the publishing computer into GitHub Actions. The
[official hosting](../release/official-hosting.md) rule that signing stays on the publishing
computer changes with this slice.

1. After SignPath approves the project, the release workflow sends VUA's own executables (the
   NSIS installer, its uninstaller, the helper and the bootstrap) for Authenticode signing with a
   timestamp, before the signed release inventory and its Ed25519 envelope are computed, so the
   inventory names the signed bytes.
2. The stock `electron.exe` keeps its upstream bytes; the installer's check of those bytes stays.
3. The download page states that releases are signed through the SignPath Foundation, as the
   program requires.

**Done when** a published installer shows VUA's signer in Windows' file properties and installs
from a fresh download.

On hold since 2026-10-25. The SignPath Foundation declined the application on 2026-10-24: its
program requires public signals such as stars, articles and contributors, and invites a new
application once VUA has them. Options for later: a Certum open-source certificate (the signer
shows the author's name; signing on the publishing computer), an OV certificate in the name of a
company the author can use, or Azure Trusted Signing if that company's country is eligible.
Website (DV) certificates cannot sign programs.

## 53 — Consistent interface by audit

Author request, 2026-10-24: the interface should look more refined without a page-by-page review
by the author. The renderer has 61 stylesheets of about 9,100 lines, the shared `Card` beside 33
hand-made card styles, and literal font sizes, radii and colours in 28, 45 and 17 places. The
inconsistency, more than any single page, is what reads as unrefined.

1. An audit tool renders every preview view and fixture in both themes, checks computed styles
   against the [design standard](../design/design-standard.md) (type scale, colour tokens,
   contrast, spacing grid, radii, shadows, blur, one jurisdiction colour, target size, overflow in
   all five languages) and, as proposals, rules adapted from ZCode's design system (radii that
   step down with nesting, fewer nested bordered surfaces, border density). Findings group by the
   stylesheet rule that causes them, so the report ranks fixes by how much each one repairs. It
   also writes a baseline. The audit process lives in `docs/design/design-audit.md`.
2. Claude tightens the tokens and adds page anatomy and composed components (card variants, list
   row, section header, key-value row, stat tile, toolbar), deciding the proposal rules with the
   author from the first report's data.
   PR #67 delivered the first token pass and approved control direction. The
   [Grid normalization plan](grid-theme-normalization.md) orders audit calibration, the remaining
   shared-control migration and correction of verified findings (author request, 2026-10-25).
   The [calibrated comparison](../research/design-audit-calibration-2026-10-25.md) records complete
   before/after coverage and the verified repair slice. The shared catalogue migration and the
   author's visual/keyboard acceptance remain open.
3. Agents migrate one functional area per pull request onto those components; each pull request
   lowers the area's findings and shows its before-and-after contact sheet, and CI then refuses
   findings beyond the baseline.

**Done when** the audit reports no findings beyond an agreed baseline that only shrinks, and the
author approves the before-and-after sheets of each area.

## Open decisions

- Styles: built-in only first or shareable data from the start; how the two briefs translate
  into tokens, motifs and motion.
- Known packages beyond the shaders, SDK and Modular Avatar (for example Avatar Optimizer,
  VRCFury), each after a license check.
- Network steps for players in mainland China: which sites the licensed entry guide and Quest's
  first activation report, after the author's verification; VUA names no accelerator or proxy.

## Scheduled after these slices

- N7's full illustrated user guide (following F8's minimal guide) and clean-machine installation.
- Encrypting saved sign-in cookies, once the installer verifies a fused Electron runtime.
- Development dependency upgrades proposed by Dependabot (VUA-Project/VUA#87, #89).
- Social discovery built on VRCX-0 (pain d), the remaining N1 physical rows, and N5 real-account
  review.
- Platforms beyond Windows x64: Windows on Arm, Linux (Ubuntu, SteamOS), macOS, Android and iOS,
  planned separately.

## Working arrangement

- Code, targeted Rust builds and real Unity runs happen on the development machine, one heavy
  job at a time. CI runs the full Rust, TypeScript, smoke and installer checks.
- Mainland China network cases run on the author's remote host.
- The author supplies real materials, account sign-ins and human UI review.
- Each slice is built on a `slice/<slug>` branch in its own worktree, branched from the stage's
  production branch named under "Where things stand", and returns to it through a pull request
  on the fork once CI is green. The author merges the production branch into `main` with the
  organization account.
- Claude integrates: it reviews pull requests from other assistants, fixes what blocks a merge on
  their branch, merges, and keeps this plan's status. Other assistants report status in their
  pull request.
- The main checkout runs the author's dev VUA from the production branch and is rebuilt after
  merges while VUA is idle. Electron runs in other worktrees use the main checkout's Electron
  through `ELECTRON_OVERRIDE_DIST_PATH`, because Windows asks about network access once per
  Electron path.
- Task prompts for other assistants and their ledger stay in `_local_real_machine/prompts/`;
  machine runbooks and helper scripts stay in `_local_environment/`.

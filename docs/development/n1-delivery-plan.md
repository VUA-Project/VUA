# N1 delivery plan: from a device choice to a working environment

> Document version: 1.8.0
> Status: Accepted
> Updated: 2026-10-10
> Scope: First play release, followed by the wider N1 device/creator routes

For people: the first release prepares desktop VRChat play or PICO Connect streaming, including
accounts, network checks, basic play guidance and optional PICO eye tracking. Existing installations are reused. Other
headsets and Avatar editing follow in later releases.

For Agents: implement the first unfinished usable path, run it, fix the observed failure and
repeat that same path. Work in one feature checkout. The [product boundary](../product-boundary.md#n1-device-and-network-onboarding)
owns scope; the [N1 acceptance rows](../development-outline.md#n1-purpose-driven-deployment)
own completion. This plan organizes delivery without replacing contracts or the N5 plan.

## Intended experience

The 2026-10-10 N-sequence revision places the host-isolation slice before scenario delivery.
Keep Steam, PICO and Unity inspection/deployment in reusable host capabilities; none requires
active AMF or BDL. AMF's material/production behavior and its independent N3–N5 acceptance stay
behind explicit module activation. Retain working implementation and review evidence.

For each delivered scenario, connect its prerequisite checks and deployment to a SOP list:
the current step, expected result, official-app/user handoff and usable return/recheck/retry.
Implement the applicable N6 cases with that path; do not defer them to a final recovery phase.
N7 records the actual host/module build and advertised scenarios separately. This plan does not
declare N1 or N5 complete; required full real-machine/human acceptance remains pending.

For the first play release, follow the [accepted scope](../product-boundary.md#first-play-release-user-ruling-2026-10-03)
and [observable acceptance](../development-outline.md#first-play-release-acceptance), then use the
[current delivery checkpoint](first-play-delivery-plan.md) for completed slices and remaining work.
The broader experience below remains the expansion direction; it is not a first-release checklist.

1. Choose desktop play, headset play, PC Avatar editing or Quest Avatar editing; allow combinations.
2. For headset play, select **brand, then exact model**. Offer detected devices as suggestions,
   allow correction, and recommend the first supported official route for that model.
3. Inspect installed software, versions, locations, relevant hardware and service connectivity.
   Explain which parts can be reused and which need installation or attention.
4. Review the component, reason, source, destination, disk requirement, optional choices and
   required user actions. Allow supported location/options changes before execution.
5. Download, install and configure with visible progress. Hand over individual user actions,
   then return to the remaining plan.
6. Launch and verify the chosen use: a working play connection, or a real Unity project with
   the required SDK/MA dependencies. Present useful next actions such as opening the project.
7. On later visits, inspect current state and offer missing components, appropriate updates,
   removal, repair or retry while reusing satisfied prerequisites.

Use the existing English, Simplified Chinese, Japanese and Korean i18n system. The main flow
explains the next action; detailed technical diagnostics are expandable.

## Devices and official-first routes

First-release device work is PICO Connect with PICO 4 Pro over USB and Wi-Fi. The subsequent
device pool is Meta Quest, Oculus Rift S, PICO, HTC VIVE, Valve Index and Sony PS VR2.
WMR remains a later investigation candidate. Bigscreen and Varjo follow that pool.

Deliver **one complete recommended route per supported model first**, preferentially the
manufacturer's official route. Reuse adapters across models with matching requirements while
retaining each model's ports, firmware, controllers and runtime requirements.

| Device family | First route to implement and exercise | Relevant model-specific preparation |
| --- | --- | --- |
| Meta Quest (start with 2, 3, 3S) | Official Quest Link or Air Link, then game launch | Meta account, headset/phone activation, USB or wireless setup |
| Oculus Rift S | Exact-model official PC runtime and wired setup | DisplayPort/USB and controller checks; a separate route from Quest streaming |
| PICO (start with PICO 4) | Model-appropriate official PICO connection software | USB/wireless options, supported firmware, consumer/enterprise edition |
| HTC VIVE | Exact-model official setup and SteamVR integration | Separate entries for VIVE, Pro and Focus-family requirements |
| Valve Index | Steam/SteamVR and official connection/room setup | DisplayPort/USB, controllers and base stations |
| Sony PS VR2 | Official PC setup, PlayStation VR2 App and SteamVR | PC adapter, DisplayPort, USB and controller Bluetooth requirements |
| WMR | Investigate legacy Microsoft runtime and the third-party Oasis driver | Windows/GPU compatibility, driver setup and access to test hardware |

Transport is an internal adapter detail: direct video connection, USB streaming or wireless
streaming. Most users need only their model and a plain-language cable/wireless choice. Show
direct-link versus streaming options only for an exact model with both routes. The user's
Focus Vision and PICO Neo3 enterprise examples require checking the precise SKU; do not assign
dual connectivity to an entire brand.

Add manufacturer software, ALVR, Virtual Desktop and Steam Link as model-specific streaming
choices are delivered. Show supported models, PC/headset installations, required accounts/store
entitlements and paid/free status. Preserve a working existing choice. Add devices such as
Steam Frame from their actual upstream setup instructions.

## Silent installation with visible activity

Prefer upstream-supported unattended installation. The task remains understandable while the
installer has no window:

- Show component and stage: source resolution, download, verification, installation, user
  interaction, result inspection and ready.
- Use actual byte counts/total size. Show installation percentages only when provided by the
  installer; otherwise show the current stage, elapsed time and observed activity.
- Distinguish monitoring refresh from installer activity. An elapsed-time display says how
  long the task has run; it does not prove installation progress.
- Follow the actual installer and relevant child processes, including bootstrapper handoffs.
- Explain extended inactivity and provide details, continued waiting and supported cancellation.
- Surface UAC, license and other required interaction. When unattended mode is unavailable,
  retain the VUA task while using the visible upstream installer.
- Reinspect the installed application and perform the use-specific check after completion.

Leaving a page preserves its accepted task. Application exit uses the existing shutdown policy.
Crash/restart recovery inspects recorded work and requires an explicit decision before continuing
side effects. Keep capability-specific cancellation and retry behavior in the owning contract.

## Account, activation and network guidance

### Accounts follow the selected route

Start the play release with Steam registration/login and VRChat's Steam login route; full VRChat
account registration/linking is optional. Add PICO's official account/device handoffs where needed.
The creator/other-manufacturer directions below apply when those later routes are delivered.

Steam and VRChat serve play; Unity and BOOTH/pixiv are optional creator steps. Add manufacturer,
headset-store or streaming account guidance when the selected route needs it.
Reuse the existing isolated temporary browser and official destinations. Keep registration,
login, store entitlement, device pairing and license selection as separate steps.

Support existing accounts, saved progress, interruption and return from a phone/headset/client.
Provide a link/QR or exact instructions for the other device. Save guide progress and whether a
result was observed or user-reported. Passwords and authentication state do not enter task data.
Users complete account submissions, CAPTCHA, purchases, agreements and license selection.

### Quest activation in mainland China

This investigation follows the first play release and does not block its PICO route.

Investigate the official activation/account flow and record the tested headset/firmware,
network method and result. The real trial covers headset update, phone/Meta account access
and device pairing separately. The 2026-10-09 network ruling removes third-party accelerator
recommendations from the player flow; the earlier named-service research is no longer a
current guide instruction. Independent installation work can continue while an account step waits.

### Network observations belong to N1

Follow the [2026-10-09 network ruling](../product-boundary.md#play-network-presentation-user-ruling-2026-10-09)
and [current implementation](../architecture/network-onboarding.md): Play keeps a regional-Ping
tile above its environment cards, while editable VRChat/Steam/GitHub website tests are in
expanded details. Europe, United States East/West and Japan require verified game-region
destinations; until those exist, show unavailable without blocking software setup.

Connection help, usage-region identification and accelerator recommendations are removed.
The old Candidate regional query is retained only for compatibility and is not called by the
player flow. Acceptance covers independent website results, explicit testing, editing/removal
and honest separation from game Ping and local headset connectivity. Verify actual game
login/loading later in the first-play path; a website response time does not establish it.

## Unity: first working creator environment

Continue this retained implementation after the first play release; Unity installation, licensing,
SDK/MA project preparation and Android modules are not play-release prerequisites.

The [Unity deployment architecture](../architecture/unity-deployment.md) owns acquisition and
installation. Use Unity CLI release lookup and the official download route first in every region.
Identify the actual payload as global `2022.3.22f1` or China `2022.3.22f1c1`; the global entry can
return c1 directly. Try China after global installation failure and offer Hub after alternatives fail.
Keep the enabled-by-default mirror switch in Settings. During development the author accepts
this exact f1/c1 pair as equivalent; retain the full observed identity and fix concrete
compatibility issues through real project trials.

Keep NoUnityCN only as an optional backup after official download failure. Report CLI release
lookup, received bytes, file identity, installer exit, Editor inspection and registration
separately. Inspect the actual accepted Editor version and retain a valid cache; CLI registration
can normalize c1 to f1, so it is not the authority for the observed version.

Subsequent creator completion path:

> Select PC Avatar editing -> reuse the existing play environment -> obtain the global
> `2022.3.22f1` installer (China `2022.3.22f1c1` fallback) -> install at the confirmed destination -> inspect/register the Editor ->
> complete official Unity authorization/licensing -> prepare real SDK/MA dependencies ->
> open and compile a disposable project successfully.

Editor installation can proceed without Hub. Quest creation adds the Android components after
the PC path works. Existing external-manager projects retain their read-only/copy boundary.

## Small implementation slices

The [first play delivery plan](first-play-delivery-plan.md) owns the current task list. ZIP
bootstrap, regional network checks, A/B guide content/navigation and development-profile
isolation have landed. The [three guidance contexts](../architecture/guidance.md) now have an
ordinary preparation reader, VUA app tour and manual VRChat game guide. Automatic game following
remains outstanding; reuse the completed A/B behavior and new presentations.

Finish the selected desktop/PICO install-and-play paths, optional PICO eye tracking, targeted
recovery and the reviewed release artifact under that plan. The existing missing-software
manual steps still need their Steam/PICO install and launch connections. Guidance content alone
does not complete the physical USB/Wi-Fi/eye-tracking cases.

Creator installation/project work, other devices, remaining N2 tools and broader N6/N7 continue
after the first play release under their owning acceptance rows. Packaging commands and preview
artifact paths remain in the [desktop entry](../../apps/desktop/README.md#windows-zip-preview).

These are delivery slices, not new release gates. Account/network work moves forward when it
becomes the first blocker in a selected route. Retain the legacy `pico_pcvr` wire value while
introducing a typed brand/model intent with its contract, Rust, TypeScript and consumer checks.
UI wording changes do not silently rename a serialized enum.

The first-play eye-tracking slice advances only VRCFT with PICO 4 Pro from N2. The
[remaining Steam connections](../development-outline.md#n2-external-gameplay-tools) follow the
release. The shared adapter can later add those applications through metadata and per-app smoke
checks; do not add their individual usage tutorials to the first-play guide slice.

## WMR investigation after the first play release

Source review on 2026-10-02 found two routes: Microsoft's legacy stack on older Windows, and
Oasis on newer Windows 11 with its documented GPU requirements. Further investigation must
identify exact setup/unlock steps, existing discovery code to reuse, required privileges and a
repeatable headset/controller check using available hardware.

The first play release supports desktop/PICO; WMR investigation resumes during device expansion.
Estimate adapter and validation work after that review. Prefer the upstream installation and guide
over writing a WMR driver in VUA. The source review identifies a candidate route; its implementation
and hardware acceptance remain later work.

## Integration with N5 development

N5 is reviewed separately on completion and can accompany the first play release afterward.
Its implementation and remaining work are excluded from the current play checklist. Preserve
both streams' additions to exports, capabilities, Gateway interfaces, registry rows and locales
when reviewed changes are integrated. Resolve the combined dependency graph rather than taking
one lockfile side wholesale. Keep per-checkout development profiles and run affected shared-build
checks; the first-play task does not dispatch agents or rewrite N5's plan.

## Sources for adapter research

- [Steam hardware survey](https://store.steampowered.com/hwsurvey/us/?l=english).
- [Steam Link setup](https://help.steampowered.com/en/faqs/view/0E2C-406B-9135-38A4).
- [PICO Connect](https://www.picoxr.com/global/software/pico-connect).
- [Virtual Desktop](https://www.vrdesktop.net/) and [ALVR](https://github.com/alvr-org/ALVR).
- [PS VR2 PC preparation](https://www.playstation.com/en-us/support/hardware/pc-prepare-ps-vr2/).
- [Microsoft WMR](https://learn.microsoft.com/en-us/windows/mixed-reality/enthusiast-guide/mixed-reality-software)
  and [Oasis](https://store.steampowered.com/app/3824490/Oasis_Driver_for_Windows_Mixed_Reality/).

## Document changelog

- 1.8.0 (2026-10-10): place host isolation before scenario prerequisite/deployment/SOP delivery, keep Steam/PICO/Unity reusable independently of AMF/BDL and pair N6/N7 with actual delivered paths without closing N1 or N5.
- 1.7.0 (2026-10-09): replace region-based service advice with the current regional-Ping/expanded-website split and retire accelerator recommendations from N1 player guidance.
- 1.6.1 (2026-10-07): advance the checkpoint to the implemented reader, tour and manual game guide.
- 1.6.0 (2026-10-05): route the updated first-play checkpoint and remaining work to its own plan, prioritize three guidance contexts and separate N5 review.
- 1.5.0 (2026-10-03): add the PICO/VRCFT eye-tracking slice to the first play release and keep the expanded N2 Steam inventory after it.
- 1.4.0 (2026-10-03): specify the implemented network slice, UU-only recommendation and per-service acceptance.
- 1.3.0 (2026-10-03): prioritize standalone ZIP, desktop play, PICO USB/Wi-Fi and release recovery/guidance; retain creator and other-device work after the first play release.
- 1.2.0 (2026-10-02): prioritize CLI-led official acquisition and actual-version inspection; keep the mirror as an optional backup.
- 1.1.0 (2026-10-02): apply the accepted development f1/c1 pair and global → China → Hub installation order.
- 1.0.0 (2026-10-02): record model-first official routes, visible silent installation, account/activation/network guidance, Unity first-run work and N5 integration.

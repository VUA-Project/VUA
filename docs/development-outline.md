# VUA development sequence

> Document version: 3.18.0
> Status: Accepted
> Updated: 2026-10-10
> Authority: User rulings of 2026-09-28 through 2026-10-10, including independent release numbering, scenario-host ownership, AMF/BDL isolation and separate host/module acceptance
> Scope: N1-N7, real-machine deployment and real-material workflows, continuing Beta
> Normative effect: Schedules accepted product work; product scope belongs to product-boundary.md

## Reading context

**For people:** the sequence and acceptance tables describe what each stage should let you do
and what evidence establishes success; detailed implementation choices belong elsewhere.

**If you are an Agent:** use the user's current task and its acceptance row to bound the slice.
Do not mark a gate complete from document edits, simulated results or code presence. Record the
actual environment, outputs, remaining blockers and whether UI human acceptance is still pending.
The role table assigns responsibility, not standing sessions or permission to dispatch agents.

## Direction and historical disposition

Build the shortest usable path, run it, fix its first blocker, then broaden coverage. Prefer
small working slices to complete module designs. Known non-blocking gaps and technical debt may
carry forward with their impact, workaround, and follow-up recorded. Do not require every agent
to clear every issue before another independent path proceeds. Keep necessary cross-module
inputs, outputs, errors, and format changes explicit, without speculative framework work.

The N sequence replaces the M/W development schedule. M0-M3 remain historical records. Old M4's
closure is withdrawn as proof of complete material management; its scope is reopened under N5.
The user's report that M4 only provided basic loading and SQLite creation is an audit trigger,
not an already verified technical finding. Audit existing capabilities before deciding what to
retain, complete, or rewrite. Do not discard working code by assumption. Old tags, artifacts,
and release notes remain immutable; Git history preserves the old M schedule. M5 and later
old schedules, indivisible W25 windows, and global waits for human operation are superseded.

VUA remains Beta until the author explicitly requests a different release stage. There is no
scheduled v1.0.0 or production-safety guarantee. Passing a gate proves its recorded scenarios,
not universal compatibility or defect-free operation. N stages define outcomes and acceptance;
product versions are selected independently from actual release changes. One stage can span
several releases, and a release can include slices from several stages. Publication does not
close a stage. Beta is lifecycle metadata; historical package versions and tags are unchanged.
See [versioning](release/versioning.md).

## New sequence

The host/AMF module boundary precedes new scenario integrations under the 2026-10-09 user ruling.
VUA's host path must work with AMF absent or failed. N1/N2 prepare and connect scenario prerequisites;
N3/N4/N5 retain their real-material, Recipe and acquisition acceptance inside optional AMF. N6 covers
each installed scenario's interruption/removal boundary, and N7 verifies the actual selected release
paths. This changes ownership and implementation order without marking a gate passed or requiring
AMF production acceptance for the independent play release. See [module architecture](architecture/modules.md).

Ibis installs the first-party AMF payload with VUA, while activation is a separate user action.
Saved activation choices and legacy data are retained. External Avatar-editing module integration
and placeholder entries are deferred beyond this release under the 2026-10-10 user ruling.

| Gate | User task | Status |
| --- | --- | --- |
| N1 | Isolate the host, then detect, deploy and guide each scenario's prerequisites and SOP | Desktop/PICO play subset first; complete real-machine acceptance pending |
| N2 | Select optional modules and connect chosen external software from Steam, official installers or GitHub releases | Planned; selected inventory and source-specific acceptance below |
| N3 | Accept AMF's complex real-material Avatar production and SDK handoff | Planned; independent of host-only publication |
| N4 | Accept AMF's Recipe saving, sharing and reproduction | Planned; independent AMF scope |
| N5 | Accept AMF + BDL material management and acquisition | Existing code, audit and review retained; independent acceptance remains open |
| N6 | Complete interruption, return, reinspection and retry with each scenario; handle module disable/removal | Required with each delivered path; consolidated cross-boundary acceptance pending |
| N7 | Record host and module release, compatibility and regression scopes separately | Ibis accepts the scenarios actually delivered; remaining release scope stays open |

Gate order is delivery order, not a prohibition on useful independent work. Minimum material
handling needed by N3 lands there; full material-management rework follows the N5 audit. No gate
below is declared passed by this document. Every mandatory acceptance row must be exercised;
non-blocking defects may remain documented, but an untested required outcome is not a pass.
The 2026-10-10 sequence revision does not record N1 or N5 as complete. Their existing delivery
and review evidence stays valid at its recorded scope; full real-machine/material acceptance
and author UI review remain separate from implementation progress.

## Test environments and evidence

| Environment | Source and use | Evidence limit |
| --- | --- | --- |
| Current workstation | User report as of 2026-09-28: SteamVR, PICO Runtime, and VRChat installed, no Unity; first incremental-deployment target. Deployment work actively mutates this machine; re-observe before relying on this row | This is a different machine from the earlier development host, not a blank system |
| Local uninstall/reinstall | Explicitly authorized by the user for deployment development and testing on this machine | Registry, environment variables, caches, and drivers may remain; never call this a completely clean Windows install |
| Local Windows VM | Create a fresh Windows VM and retain a pre-install snapshot if available; use for repeatable install/configuration tests | Does not replace physical headset, GPU, runtime, or driver validation; VM availability is not assumed |
| Separate local project/root | New Unity projects and isolated data/output roots for production and reproduction | Clean project does not mean clean OS |
| Remote CI | Build, synthetic-data tests, and an explicitly recorded Windows image/version matrix | No paid assets, account sessions, personal orders, or user projects; a build badge is not cross-version runtime acceptance |

Local uninstall/reinstall is permitted; no additional blanket prohibition or reauthorization is
introduced here. Select the software involved in the test, record before/after state, preserve
user data and unrelated projects, and use its supported uninstall/install mechanism. Permission
to reinstall software does not authorize wiping the OS or deleting unrelated data. This policy
change does not itself execute any uninstallation.

Before remote CI coverage, do not claim guaranteed operation on other Windows versions. After
CI exists, report only the exact image/version and operations actually tested; CI alone does not
prove headset behavior, account workflows, or all Windows versions. If a VM is unavailable,
continue on the current workstation and label the baseline accurately.

UI requires human usability acceptance: understandable labels, discoverable actions, and the
ability to complete the task without misleading or stuck screens. Non-UI acceptance may be
performed by agents/scripts against real software, devices, files, and outputs; a human is not
required to click through every operation. Account login, license acceptance, final upload, and
other platform-required user actions remain explicit handoffs. A device prerequisite blocks only
the dependent case, not unrelated development. Synthetic input is valid component evidence but
must not be relabeled as a real-device or real-material success.

Each run records date, source revision/dirty state, actual OS baseline, software versions, input
identities, operation, passed/failed/blocked/not_run outcome, evidence location, and omitted steps.
Raw material, account data, logs, and projects remain local under ignored output roots. An agent
run is acceptable evidence; simulated success or a result inferred solely from source is not.

A read-only starting inventory is available as:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/real-machine-baseline.ps1
```

The policy option affects only that process. Output is local under `_local_real_machine/`.
This inventory does not install, launch, or approve any workflow. The existing material_exec_real
harness is in vua-unity-bridge and can use synthetic inputs or a
[Modular Avatar](product-boundary.md#production-scope-and-product-rulings-user-ruling-2026-09-22)
(MA) stub; inspect each case's actual provenance before using it for N3 acceptance.

## N1: purpose-driven deployment

### Host isolation before scenario delivery

VUA is the scenario installation, management and launch host. Land its isolation slice first,
then deliver each scenario's prerequisite checks, deployment and SOP (an ordered list of steps
with expected results and the next action on failure). Steam, PICO and Unity discovery,
installation and verification are reusable host capabilities; selecting or inspecting Unity
does not require AMF or BDL. AMF owns Avatar/material behavior, not the host's environment facts.

| Slice | Required boundary and acceptance |
| --- | --- |
| Host without active AMF | Fresh and legacy profiles can use host scenarios with AMF disabled or failed; no AMF/BDL queries are needed to inspect or prepare play/Unity prerequisites |
| Explicit module activation | The Ibis AMF payload is bundled but starts only after an explicit enable action. Disabled navigation offers its explanation in Avatar editing; host startup, settings and scenario tasks remain usable |
| One usable scenario | Connect choice → prerequisite check → plan/deployment → SOP → supported launch/handoff. Exercise return, reinspection and retry with that path under N6 before broadening it |

This is an implementation order and ownership change, not a new generic plugin framework or
evidence that a stage passed. Keep the existing physical and human acceptance rows below.

### First play release acceptance

The first release prioritizes the [bounded play scope](product-boundary.md#first-play-release-user-ruling-2026-10-03).
Keep N1-N7 identifiers and select a product version at publication. Release the play subset
with the necessary N6 recovery and N7 distribution work; broader N1 and N7 remain open.
The following rows describe the accepted play work and the evidence needed to claim each
outcome complete. The [2026-10-08 Ibis criterion](product-boundary.md#ibis-release-criterion-user-ruling-2026-10-08)
owns publication: exercise the advertised core journey and fix where a newcomer gets stuck.
Clear manual handoffs may complete that journey; optional work and non-blocking defects may
remain explicit. Unexercised rows remain pending, and publication does not pass N1 or N2.
The [first play delivery plan](development/first-play-delivery-plan.md) tracks completed slices
and remaining work. N5 retains its separate review/acceptance and may join the same release
afterward; it does not add material-management prerequisites to these play cases.

| Case | Natural-language pass condition |
| --- | --- |
| Standalone ZIP | On the recorded Windows x64 test environment, extract the complete ZIP to a path containing spaces and non-ASCII characters and launch VUA without a source checkout, Node, pnpm or Rust. Its real packaged Provider responds, local assets load, and settings/task data remain outside the program directory. Moving/replacing the program directory preserves that data |
| Relevant checks | Desktop play needs Steam and VRChat only; missing SteamVR, PICO or Unity does not block it. PICO streaming adds SteamVR and PICO Connect. Windows, graphics/driver, storage and software findings explain the next action instead of a generic failure |
| Network | Keep website observations in expanded details, separate from local headset discovery and game latency. Regional Ping covers Europe, United States East/West and Japan only when reliable targets exist; otherwise show unavailable without blocking preparation. No usage-region identification, Connection help or accelerator recommendations |
| Account guide | A new player reaches official Steam registration and client login; an existing player skips registration. Continue through VRChat first login with Steam and explain optional full-account/linking steps. PICO account/headset actions use official UI. Closing a page or encountering unsupported embedding leaves a resume or system-browser route |
| Missing software | Starting with the selected software absent, obtain/install it through official sources and return to VUA for inspection. Prefer supported unattended steps; show installation phase/activity and required interaction. Steam-owned downloads are clearly handed to Steam and checked afterward |
| Desktop play | Launch VRChat in desktop mode, enter the game, and follow the guide for movement, menus, sound, microphone and basic safety settings. Installed files alone do not pass this row |
| PICO USB | With PICO 4 Pro, follow cable setup and the official connection flow, enter VRChat in the headset, and verify image, head/hand tracking, controller interaction, sound and microphone |
| PICO Wi-Fi | Repeat the headset play checks over Wi-Fi; explain the local-network prerequisites, and exercise a disconnect/reconnect without repeating the whole installation |
| PICO eye tracking | On PICO 4 Pro, guide VRCFT Steam installation, its PICO module, headset eye-tracking calibration and VRChat OSC. Verify actual gaze and blinking on an existing suitable Avatar over both USB and Wi-Fi, including microphone use, reconnect and a later play session. Players may skip this option; unfinished delivery remains pending under N2 and does not independently block Ibis publication |
| Return/recovery | Repeat deployment without reinstalling satisfied components. Interrupt one download/install or user handoff, restart VUA, inspect the result and explicitly continue/retry. A later play session has a direct start path |
| VUA app tour | Inside VUA, follow ordered highlights on actual controls through route selection, checks, plan/progress and play/guide entries. Page changes, back/next, skip/exit and restart work; absent controls have an understandable next action. The transparent tour stays within VUA, keeps text readable and does not cancel a task when exited |
| Knowledge encyclopedia | Read preparation and hardware instructions inside Help, without requiring VRChat or AMF. Contextual entries locate a chapter/section; reopen restores reading. Mouse Back/Forward traverses Help child pages and chapter choices, manual scrolling wins over positioning, and leaving Help keeps tasks/game running |
| VRChat game guide | With following enabled by default and background opacity initially 50%, use a readable guide over the Windows VRChat game window. Adjust the matrix/background without fading text. It follows movement/resize, remembers a dragged relative position, hides on minimize or switching apps, restores without taking focus, stays usable when clicked and respects manual hide. Persist changed preferences. Follow controls/microphone and suggested Personal Space/Allow Untrusted URLs steps by confirmation or skip; use checked tutorial-world entries by learning language when available and local guidance otherwise |
| Guidance separation | App-tour completion, preparation reading and game-guide progress do not overwrite one another. Shared four-language text/media remain consistent. Exercise absent-game, exit/relaunch, keyboard access and monitor/DPI changes; task-status access remains available during the migration |
| Headset guide access | On the PICO test path, open SteamVR's desktop view, read/operate Help's encyclopedia and return to play. Record this as desktop-view guidance, not a native VUA VR overlay |
| Distribution | Include exact-build license notices, version/source identification, ZIP update/removal instructions, actual screenshots and known issues. Record signature status. Human UI review covers the guide and handoffs; remote build/smoke checks and physical headset tests retain their separate evidence |

Use local uninstall/reinstall for the absent-software cases with the existing authorization and
data-preservation rules. Record the baseline and actual software versions; this is not a factory
reset or proof of all Windows versions. PICO device setup guidance is included; an already
activated headset validates streaming, not a fresh-device activation claim.

### Broader N1 acceptance after the first play release

User task: choose what to do; VUA identifies missing prerequisites and helps install them.
Deliver purpose-driven install/update/uninstall plus validation, repair/retry, component additions,
version records, and limited configuration backup. Full-machine images, universal downgrade, and
a general environment version manager are not prerequisites.

| Function | Required behavior and observable acceptance |
| --- | --- |
| Choose purpose and device | Offer desktop play, headset play, PC Avatar editing and Quest Avatar editing; allow combinations. Headset selection starts with brand and exact model and recommends one official route. The product boundary defines the first pool and WMR investigation exception; ask connection details only where needed |
| Inspect | Report installed, missing, unsuitable-version, and detection-failed separately; correctly identify this machine's existing play stack and absent Unity |
| Plan | Explain each retain/install/update/component/configuration action, location, reason, optional items, and user handoff before execution; do not silently choose latest incompatible versions |
| Execute | Prefer supported silent installation. Show component, phase, elapsed time and observed activity; use real byte counts/percentages when available. Surface user interaction and prolonged inactivity with next actions. Track the actual installer lifetime and verify its result |
| Configure | Record old/new values and scope for necessary changes; installing Unity does not silently change the existing VR runtime |
| Validate | Reinspect after install; actually launch Unity and open a disposable project with real SDK/MA dependencies; test play launch separately from device behavior |
| Repeat | A second run reuses satisfied prerequisites and installs only missing components; failed operations have a usable retry or manual path |
| Device route | For each supported model, complete one official-first installation/connection route, including required PC and headset software, pairing and game launch. Record the exact model and connection used; expand alternative streaming choices afterwards |
| Network and activation | Guide official service access and headset activation without usage-region identification or accelerator recommendations. Check target-service reachability separately from LAN streaming; exercise headset update, phone login and pairing for the selected Quest activation route |

Subsequent creator path: keep existing SteamVR/PICO/VRChat, choose PC Avatar editing, install global
Unity 2022.3.22f1 (China 2022.3.22f1c1 fallback) following the
[standalone deployment route](architecture/unity-deployment.md)
(Hub optional), complete user licensing and necessary components, resolve actual SDK/MA dependencies, and open the test
project. Exercise each declared purpose on an applicable environment; record missing equipment
as blocked rather than inventing results. WMR may be excluded from first delivery after the
installation/validation cost investigation, with a recorded reason. UI gets human review; backend
operations may be automated. The [N1 delivery plan](development/n1-delivery-plan.md) organizes
the implementation slices and device/account/network research.

### Initial account guidance acceptance

The first play release uses the account row above; these rows also cover the subsequent creator
route. [Product scope](product-boundary.md#account-onboarding-user-ruling-2026-09-30)
owns the account and later-experiment boundaries. Use official pages in the isolated built-in
browser, with explicit client/system-browser handoff when needed. Do not add an Auth Broker or
a generic account/token manager before this path works.

| Case | Required behavior and observable acceptance |
| --- | --- |
| New player | Offer Steam and VRChat registration guidance; users submit official forms themselves. Guide adding VRChat to the Steam library and installing/launching through Steam. An opened page is recorded as opened, not as an account or successful installation |
| Existing player | Allow skipping existing accounts; guide the official Steam-platform-account upgrade/link path when needed, without storing credentials or inventing a VUA binding |
| Optional creator | Offer Unity and BOOTH/pixiv registration only for the creator route. Explain purchase, official Unity authorization/licensing and SDK handoffs; Hub is optional. Skipping them leaves the play route usable |
| Device/service accounts | Add only accounts or store authorizations needed by the selected manufacturer or streaming route. Save guide progress; support existing accounts, phone/headset/client handoff and return after interruption |
| Upload eligibility | Explain full VRChat account plus New User or higher; show user-reported or unknown eligibility honestly. Normal-play guidance promises no promotion date. A Visitor can continue local preparation/testing; only upload remains gated |
| Interrupt/decline | Closing a page, refusing consent, failed registration or blocked embedding leaves a resume/manual route. CAPTCHA, terms, account linking and payment stay with the user |
| Privacy | First-slice registration sessions are nonpersistent and isolated; no cookie/password/token values in app state, IPC, Agent context or logs. Ending the guide session clears its temporary state. Saved progress does not imply authenticated verification |

Use synthetic data for automated guide-state tests and real official pages for local flow checks;
account submissions require the user's actions. Record those steps as blocked/not_run until performed.
VRChat web-information reading and experimental persistence follow the first usable delivery;
they are not first-round blockers. N5 BOOTH account-library acceptance remains unchanged.

## N2: external gameplay tools

N2 covers optional modules and external-software connections, extending the original seven
Steam tools with the explicitly selected VRCS entry. Reuse N1's prerequisite capabilities;
support each application's actual Steam, official-installer or GitHub-release source rather
than forcing every entry through Steam. A module supplies a chosen scenario/SOP, not a second
copy of host environment management. The current Tools cards expose descriptions with disabled
development actions; that presentation does not establish installed or launchable integrations.
MioVRC and a public Agent/MCP integration remain outside Ibis.

| Application / official distribution | Steam App ID | Purpose | Additional acceptance / timing |
| --- | --- | --- | --- |
| [VRCFaceTracking](https://store.steampowered.com/app/3329480/) | 3329480 | Eye and face tracking | PICO 4 Pro eye tracking is part of the first play release; hardware-module/OSC setup |
| [hyblocker OpenVR Space Calibrator](https://store.steampowered.com/app/3368750/) | 3368750 | Mixed-tracking space calibration | Device selection and actual calibration; after the first play release |
| [OVR Overlay Translator](https://store.steampowered.com/app/4304620/) | 4304620 | In-VR translation overlay | Shared connection only; paid Steam application; after the first play release |
| [OVR Advanced Settings](https://store.steampowered.com/app/1009850/) | 1009850 | SteamVR settings and utilities | Shared connection only; paid Steam distribution; after the first play release |
| [OVR Toolkit](https://store.steampowered.com/app/1068820/) | 1068820 | Desktop windows inside VR | Shared connection only; paid Steam application; after the first play release |
| [OyasumiVR](https://store.steampowered.com/app/2538150/) | 2538150 | VR sleep utilities | Shared connection only; free Steam application; after the first play release |
| [LIV](https://store.steampowered.com/app/755540/) | 755540 | VR capture and streaming tools | Shared connection only; free Steam base application; after the first play release |
| [VRCS](https://github.com/Dreaminko/VRCS) | — | Speech transcription and translation | Selected addition; verify supported upstream release/acquisition and launch paths before claiming a working connection |

Steam pricing/access descriptions are checked on 2026-10-03; show the current store offer rather
than hardcoding a price. Required hardware modules are not extra top-level tools. Further additions
need an explicit scope decision. Record the actual installed release/source for each run.

### Shared connection acceptance

| Function | Natural-language pass condition for each application |
| --- | --- |
| Select/enable | Show purpose, prerequisites and development status. Enable a selected module explicitly; expose only its available entries, while AMF remains independently selected |
| Discover | Use the supported source-specific evidence: configured Steam libraries, official-installer locations or verified release executables. Distinguish absent, installed, incomplete and detection failure; an empty directory is not installation evidence |
| Purchase/install | Obtain through the correct official Steam, installer or publisher GitHub release on request, retaining source/version and verifying the actual result. Steam/upstream owns purchase, entitlement and required interactions. Returning and refreshing reports observed installation; opening a page is not success |
| Launch/status | Use the supported source-specific launch entry on request, then observe running state or report failure/unknown. Explain missing prerequisites. Repeated clicks do not dispatch repeatedly while pending |
| Update/remove/reuse | Respect the source's actual update/removal support. Reinspect after changes or relocation and reuse satisfied installations. Module disable/removal is separate from uninstalling an upstream app or deleting user data; follow N6 |
| Optional use | Explain the app's purpose and paid/free distribution, allow skipping it, and link to upstream help. Missing optional apps do not block ordinary play |

Inventory means the **local installation inventory**, not a complete account-owned-games list.
An uninstalled paid application has unknown ownership until Steam handles the request; VUA neither
extracts Steam login sessions nor purchases software for the user. A test key is handled in Steam,
not stored in VUA or committed as evidence.

Each selected shared-connection entry requires a real discovery/install-handoff/launch smoke
against its recorded source. The tracking tools retain their additional hardware cases below.
Other entries do not require individual usage tutorials, translation/capture pipelines,
sleep automation, settings editors or exhaustive upstream feature tests. A running process means
the app is running, not that its translation, recording or automation is configured successfully.
LIV is classified under capture/streaming; this connection does not install a LIV SDK into VRChat.

### Tracking-specific acceptance

- **VRCFT:** guide its hardware-module installation in the upstream UI, headset switches/calibration,
  VRChat OSC (Open Sound Control) and a suitable Avatar. Completing the PICO slice exercises the
  eye-tracking row above. Native gaze/blinking can use a suitable existing Avatar; full facial
  expressions require a face-tracking-compatible Avatar. Verify actual tracking/OSC output,
  reconnect and microphone coexistence, not just successful module initialization. Follow the
  [VRCFT PICO guide](https://docs.vrcft.io/docs/hardware/vr/pico/pico4pe) and
  [native eye-tracking guidance](https://docs.vrcft.io/docs/intro/getting-started) against the tested
  PICO Connect/module versions.
- **Space Calibrator:** guide SteamVR prerequisites, reference/target device selection, sampling
  and applying calibration in its own UI; record an actual measured calibration. Use its supported
  external entry, not its internal overlay-to-driver IPC. Preserve upstream functionality.

Missing hardware, unavailable status or unsupported versions leave a specific next step and the
relevant real-hardware case pending. Agents/scripts can collect non-UI evidence; UI receives human
review. Broader diagnostics/configuration automation follow a separately scoped adapter. Source or
binary redistribution requires a separate review under [third-party notices](../THIRD_PARTY_NOTICES.md).

## N3: complex real-material Avatar production

Owner: **AMF**. This gate accepts complex Avatar editing, not host environment preparation;
it is not a prerequisite for publishing a host-only scenario. Bundling or enabling AMF alone
does not close N3 or broaden a release's advertised production scope.

User task: combine owned materials in one project and hand the result to VRC SDK.
Minimum successful case: **one real Avatar + at least two actively used dependencies/plugins +
at least six other real materials, together in one project and one production run**. Do not count
individual files from one package as separate materials or install unused plugins to meet the count.

| Function | Required behavior and observable acceptance |
| --- | --- |
| Intake | Admit the actual materials as usable production inputs, not merely copied files; retain original sources |
| Relationships | Resolve or ask the user to confirm dependencies and targets; reuse shared dependencies; identify conflicting versions or relationships by material |
| Target selection | Clearly select which Avatar/object receives each outfit, accessory, or operation; ambiguity is resolved explicitly |
| Assembly | Execute imports, bindings, and supported settings through the Bridge; verify actual object relationships, not only a success receipt |
| Records | Record material/dependency inputs and each operation/result, with a locatable failed step |
| SDK handoff | The real SDK recognizes the resulting Avatar and reaches its build/upload-check flow; merely opening Unity does not pass |
| Existing projects | ALCOM/VCC originals stay read-only; create an independent VUA-managed copy and reinspect it before changes |

Run the full complex case, repeat it in a separate clean project, and exercise a missing-dependency
or relationship-conflict variant with a concrete resolution path. Agents may drive real Unity,
Bridge, and SDK and inspect bindings/build outputs/logs. Actual account upload is not mandatory
for this gate and remains a user action. N5's complete library work does not block minimum intake.

## N4: Recipe and multi-flow reproduction

Owner: **AMF**. Save, share and reproduce Recipe declarations through AMF's production boundary;
the host manages selection, prerequisites and lifecycle without taking over Recipe semantics.

| User task | Required behavior and observable acceptance |
| --- | --- |
| Save/reopen | Preserve material references, dependencies, and supported modifications across restart |
| Reproduce | Build the declared relationships/settings in a second project using actual owned inputs |
| Reapply | Avoid unintended duplicate objects, menus, parameters, and bindings |
| Resolve conflicts | Explain conflicting inputs and the effect of the four choices in the product boundary; apply the chosen behavior |
| Share | Export declarations without paid material bodies; supplement missing sources only for referenced materials and remember confirmed correlations |
| Retry after completion | Identify missing material/dependencies and execute after they are supplied |

Use N3's complex case for new-project reproduction, repeated application, changed Recipe
application, missing-then-supplied inputs, and conflict cases. Validate relationships/settings,
not byte equality of all Unity-generated metadata. Exercise original-package intake and the
experimental local VPM (VRChat Package Manager) route separately; neither proves the other.

## N5: audit and redo material management

Owners: **AMF + BDL**. AMF owns intake, acquisition and material-management use cases; BDL retains
local catalog/provenance/file persistence. Host/module separation preserves the current code,
[capability audit](development/n5-capability-audit.md), [rework plan](development/n5-rework-plan.md)
and subsequent review evidence. Do not restart that audit or rewrite working capabilities merely
because ownership moved. N5 keeps its independent real-account/material and human acceptance;
neither host publication nor this sequence revision declares it complete.

### Mandatory first step: capability audit

Before rework, inspect existing implementation, reachable UI/Gateway paths, tests, and local run
evidence. Produce a capability table with: user action, code entry, reachable/not reachable,
verified behavior, evidence, missing behavior, and retain/complete/replace decision. Unknown
means unverified, not absent. Audit local intake, warehouse queries/maintenance, BDL (Booth
Database Local) persistence, BOOTH account/library enumeration, downloads, and cloud-to-local
import end to end; record any step that cannot be exercised as blocked with its reason.

The prior M4 closure no longer establishes completion, but the user's initial assessment is not
proof that all code is missing. Basic loading and SQLite creation alone do not close N5. Preserve
working capabilities and fix measured gaps rather than automatically rewriting the subsystem.

### Required acquisition acceptance: two distinct BOOTH workflows

1. **Account library to local catalog, then selective download.** The user signs into their own
   BOOTH account through the local session. VUA automatically retrieves the account's available
   material list and builds/refreshes its local catalog without downloading every file. It handles
   multiple pages and repeated refresh without duplicate records, reports partial retrieval and
   expired sessions, and distinguishes cloud-listed from locally downloaded material. The user
   chooses materials/files to download; only that selection is downloaded, inspected, and linked
   to local records. Restart and refresh preserve the catalog and downloaded-file associations.
2. **Import material already available in the cloud account.** From the signed-in BOOTH cloud
   material/page entry, the user chooses an already accessible item and imports it into the local
   Warehouse and material-selection flow. Missing local content is acquired through the authorized
   download path; an existing local copy is recognized or a duplicate decision is shown. Verify
   source/file association and that the imported item is present in local material selection. Browsing a
   page or finishing a download alone is not successful import.

Here cloud means BOOTH content available to that account, not a VUA-operated asset server. These
are separate acceptance rows, not a purchase flow. Respect entitlement, authentication, age and
access controls; no whole-site crawl or purchase bypass. Account/session/order data, catalog and
paid files stay local. Unit/CI tests use representative synthetic data; account runs remain local.
Do not assume an upstream API or scraping approach before capability investigation.

### Required library behavior

| User task | Required behavior and observable acceptance |
| --- | --- |
| Understand intake | Retain ordinary local files and their relative layout, including original ZIPs and companion files; automatically extract ZIPs from local imports and BOOTH downloads with member directories preserved. Distinguish archive storage from expansion success, duplicate, unsupported production input and failed items; partial success is visible. First production intake accepts UnityPackage only; companion-file editing is outside N5 |
| Find material | Search by name and supported filters; sync attempts to reconcile migrated local entries with account products, merges only verified equal content, and keeps different or unverified content in separate cards even with identical names/images |
| Maintain files | Show associated local files and missing status; restore missing BOOTH-managed files through explicit re-download and report unavailable upstream content; a dedicated relink feature is not required under the 2026-10-08 ruling |
| Maintain provenance | Local use need not start with a BOOTH ID; reuse official metadata retrieval from a user-supplied ID/page, expose only name and thumbnail for manual supplementation, and retain source associations under the product boundary. Third-party search is deferred |
| Distinguish content | Same-name different-content material is distinguishable and never silently overwritten; Recipe/VPM revision selection and regeneration are deferred |
| Manage relationships | Persist author-description link clues with their source evidence; gate dependency display/reverse lookup in settings and explain accuracy limits when enabled. Distinguish unconfirmed clues from confirmations and empty evidence from an absence of dependencies; exhaustive inference and missing-link corner cases are later work |
| Remove/clean | Allow local-import record removal separately from file deletion, with reference effects explained; account-product hiding is later work |

The missing-file and provenance refinements are owned by the
[product boundary](product-boundary.md#production-scope-and-product-rulings-user-ruling-2026-09-22).
A product-page link alone establishes neither Avatar compatibility nor a required dependency;
an empty extraction does not establish the absence of dependencies. Under the later 2026-10-08
ruling, final Recipe design, concrete VPM revision/regeneration and library-to-production
integration move after N5, to be designed and exercised with N3/N4. N5 closes on its acquisition
and material-management outcomes and real-account/material/human-UI evidence, without claiming
that a library selection or saved draft proves a successful production run.

Use a real local collection containing duplicates, same-name versions, missing files, multi-file
packages, and dependencies. Define supported directory/archive behavior during the audit; an issue
merely being recorded is not acceptance. Close the gate only with both acquisition paths
and library outcomes exercised; remaining non-blocking limitations are named.

## N6: recovery and environment maintenance

Implement N6 cases when each N1/N2 host scenario or N3–N5 AMF path lands. Interruption, returning
from an official-app handoff, reinspection and retry belong to that path's usable delivery,
not a final cleanup stage. Consolidation later checks interactions across installed scenarios.

| User task | Required behavior and observable acceptance |
| --- | --- |
| Cancel | Explain whether cancellation took effect or is waiting on a non-interruptible operation |
| Restart | Surface unfinished tasks for inspection and explicit choice, never silent continuation |
| Retry | Use actual completed state rather than blindly repeat everything or reuse stale approval |
| Return from a handoff | Preserve the selected scenario and current step; recheck observed facts after returning from account, installer, client or headset actions |
| Handle drift | Reinspect relevant externally changed software, configuration, or projects before executing |
| Restore settings | Restore supported VUA-owned changes; show conflicts with subsequent external edits |
| Update/remove | Support each adapter's actual update, component-addition, and uninstall abilities, not universal downgrades |
| Disable/remove a module | Explain active-task blockers and preserve local data. Disable/remove its navigation and executable capabilities without breaking host scenarios or removing shared software; explicitly handle retained records and any later re-enable |
| Export inventory | Record versions/components/configuration for redeployment; do not describe it as a machine image |

Inject interruption, cancellation, missing inputs, and external changes into both deployment and
complex production. Show a workable next action even if it requires reinstall or manual repair.
N6 consolidates recovery; every delivered path carries its own applicable failure/return cases.

## N7: Beta installer, regression, and illustrated user guide

Record host and module publication, compatibility and regression separately. Ibis accepts the
scenarios actually advertised and delivered in its exact build, under the newcomer-journey
criterion; it does not require unrelated AMF complex-production or Recipe acceptance. A bundled
module still needs regression for the behavior the release exposes. NSIS and full later scenario
coverage remain separate from the first ZIP release.

| Deliverable | Required behavior and observable acceptance |
| --- | --- |
| Installer | Launch without a development checkout, developer commands, or hidden development-machine files |
| Release/compatibility scope | Name the host build, bundled/optional module versions, supported scenario/software combinations and known incompatibilities; payload presence is not a passed workflow |
| Regression | Use the packaged build for advertised host scenarios and each enabled module's delivered behavior. Record host, external-software, AMF material/production and Recipe results separately; later N3–N5 coverage does not become an unrelated host publication prerequisite |
| Upgrade | Preserve or explicitly migrate material records, Recipes, settings and run history from a named earlier Beta |
| UI review | A human can find the main entry points, understand states and complete tasks; fix misleading or stuck screens |
| Known issues | List tested scope, remaining problems, workarounds, and next work; remain Beta with no production-safety promise |
| Illustrated user guide | Deliver an end-user guide with screenshots of the actual tested release, using references the user will supply at N7 |

The Ibis guide covers install/first launch and its actual delivered scenario SOPs, including
explicit module activation, official-app handoffs and common failure/return/retry paths. Add
BOOTH/material, complex production, Recipe and SDK procedures with the corresponding module
release scope, preserving their independent N3–N5 acceptance. Each procedure gives its starting state,
numbered actions with readable screenshots, expected result, and what to do when it differs.
Screenshots match the named build and actual labels, with credentials, account/order information,
and private material removed or safely substituted. Do not use invented UI as acceptance evidence.
Observe repository asset/privacy rules for published illustrations. Human UI/guide review confirms
the instructions can be followed. Missing user references block only final reference-dependent
presentation, not other N7 work; do not invent what the references contain.

## Execution roles (six roles)

Roles express ownership, not mandatory standing sessions or separate branches. An ordinary session
may wear several hats. Collab is retired and preserved under docs/archive/2026-09-29/. A future
collaboration mechanism needs a new design and acceptance; these hats do not dispatch agents.

| Role | Ownership |
| --- | --- |
| Integration | N-gate evidence, versions, docs/registry, cross-module integration evidence, CI, plan review |
| Desktop | Electron/Main/preload, React UI, typed TS Gateway, actual UI acceptance and guide capture |
| Core | Application use cases, durable tasks/recovery, domain ports, Provider, application contracts |
| Production | Unity Bridge, production execution, Unity packages, SDK handoff and real production evidence |
| Data | BDL, acquisition, Warehouse/material inspection, catalog and download contracts |
| Environment | Project/package managers, environment/install adapters, external-tool deployment |

Domain owners own schema changes; Desktop registers the TS/Gateway face. Keep input/output/error
contracts sufficient for cross-module work. Use existing core-owned ports for adapter placement;
do not move vendor behavior into views or the application core merely to deliver faster.

## Agent-plan handoff and subsequent review

The user will notify agents to revise their own plans. This document does not dispatch messages,
create roles, or replace their plans on their behalf. Once revised plans are available, review:

- Every task maps to an N gate/version and a concrete user action/result, with prerequisites,
  evidence method, current code to reuse, and deferred gaps.
- Neither old M closure nor old post-v1 scheduling overrides the new sequence. Preserve the existing N5 audit, implementation and review before further changes.
- N1 host isolation precedes scenario prerequisites/deployment/SOP; Steam/PICO/Unity are reusable host capabilities. N2 covers selected modules and source-specific external connections; individual setup/hardware guides remain focused on tracking tools.
- N3 has the full 1 + 2 + 6 simultaneous case, not a single outfit or simulated substitute.
- N3/N4 belong to AMF and N5 to AMF + BDL, with both BOOTH acquisition workflows retained. N6 accompanies each scenario; N7 records host/module compatibility and the actual release's screenshot guide separately.
- Local reinstall permission, OS claim limits, human UI review and automated non-UI acceptance
  are preserved. Partial work is not presented as completed acceptance.

Prioritize the first real blocker, repair and rerun it, then expand. Record bounded compromises;
do not turn documentation completeness, speculative coverage, or idle agent activity into goals.

## Document changelog

- 3.18.0 (2026-10-10): apply the seven-stage scenario-host/AMF/BDL sequence, expand N2 sources and selected tools, place N6 with each path and split N7 release scope; preserve N1/N5 evidence and pending formal acceptance.
- 3.17.0 (2026-10-10): retain bundled AMF with explicit activation and defer external Avatar-editing modules beyond Ibis without changing existing gate outcomes.
- 3.16.0 (2026-10-09): place host/AMF separation before scenario integrations, preserving N3–N5 as AMF acceptance and all existing gate outcomes.
- 3.15.0 (2026-10-09): integrate Ibis publication and current network/guide acceptance with the reduced N5 scope, retaining real-run evidence and pending optional outcomes, background-only guide opacity and remembered relative placement.
- 3.14.0 (2026-10-09): include managed ZIP extraction in first N5 intake acceptance, preserving original bytes and truthful extraction outcomes.
- 3.13.0 (2026-10-09): narrow N5 closure to intact local-file retention, official/minimal manual provenance and optional bounded dependency presentation; defer third-party search.
- 3.12.0 (2026-10-08): accept migration reconciliation, limit record removal to local imports and dependency discovery to persisted link clues, and move Recipe/VPM and production-loop acceptance after N5.
- 3.11.0 (2026-10-08): apply the user's N5 missing-file/source refinements, clarify dependency evidence limits and retain production integration as linked pending acceptance.
- 3.10.0 (2026-10-05): define observable acceptance for three guidance contexts, their independent state and the separate N5 co-release review.
- 3.9.0 (2026-10-03): advance PICO eye tracking into first-play acceptance and define seven N2 Steam connections with shared inventory/install/launch acceptance and focused tracking guides.

Earlier entries remain in Git history.

# VUA product boundary


> Updated: 2026-10-16

## Product definition

VUA is a Windows-first, local-first VRChat **scenario** host (the author's term: “情景”). A
scenario is a player goal with its SOP for preparation, use and recovery. VUA observes the local
environment; installs, manages and launches what each scenario needs; and gives players, and the
AI agents they direct, the same facts, SOPs and permissioned operations. The
[north star](north-star.md) states the goal and how progress is measured. The core audience
includes players new to Unity and to the software VRChat relies on.

Desktop play and PICO streaming are play scenarios. The first-party AMF module supplies the
Avatar-production scenario. VUA installs AMF and enables it by default, and keeps a player's
saved enable/disable choice (user correction, 2026-10-14). External Avatar-editing modules are
scheduled after Ibis. BDL is private to AMF.

AMF owns Recipe-first production and reproducible production records. The VUA host works with or
without AMF and BDL. The Wizard chooses a path by goal, device and current facts, and installed
modules decide what appears in the main directory.
[Host/module architecture](architecture/modules.md) owns activation, migration and lifecycle.

**Material-first production (user ruling, 2026-10-13).** The player starts by selecting
materials. VUA prepares an independent managed project and chooses the Avatar, materials and
assembly relationships automatically when the observed facts determine them; the player chooses
where a target is ambiguous or unsupported. Existing projects stay as they are. The player reviews
menu options and changes, then VUA executes, reports the result and hands off to the SDK.
Portable Recipes belong to N4, and N3 closes with its real-material acceptance rows.

## Accepted product areas

1. **Electron desktop application:** React, TypeScript, and Vite renderer; isolated remote pages and
   sessions; download interaction; desktop windows; narrow Gateway.
2. **Orchestrator:** durable tasks, plans, approval, cancellation, recovery, Build Records, and
   adapter coordination behind a replaceable, versioned Provider boundary.
3. **Avatar MegaFactory:** owns the Warehouse, Recipe, Assembly, and Release user flows — check
   evidence is folded into production records and the notification center, and a standalone
   Inspection page is no longer required (user ruling, 2026-09-22; see "Production scope and
   product rulings"); native browsing, authorized downloads, content management, and
   external-source adapters;
   - **Material-entry semantics (user ruling, 2026-09-07; trigger-timing clarification with the
     W15 re-review, 2026-09-08):** the default path is direct use of the original
     `.unitypackage` (beginner-oriented positioning); the **target trigger timing** of "generate
     a VPM package as a replacement" is **at material import** (automatic generation, replacing
     the original UnityPackage); both it and "delete original material after generation" are
     **experimental** capabilities presented under the Settings-Experimental location; the
     implementation contains an import-time auto-generation hook in the acquisition crate;
     UI wiring and real usability must be established by the N5 capability audit rather than
     inferred from that hook or historical completion claims. VPM package
     generation results are always clearly distinguished from direct-import results
     (`unityValidated` vs experimental offline output);
   - and **BDL**, its private
   local catalog, terms, compatibility, source, search, and mapping module.
4. **Environment deployment:** prerequisite detection, guided deployment, and bounded recovery for
   hardware, VR, Unity, VRChat, and related tools without which play or Avatar production is blocked.
5. **Project management:** the most frequently used "project management" in VUA is actually the
   Recipe and Release modules; VUA's `vrc-get`-based package manager takes **Recipe-driven
   automatic resolution and import** as its primary form — it finds and imports the matching
   packages from a Recipe's inputs, rather than being a module where the user manually imports a
   series of plugins on first entry; manual per-package management is the secondary form (user
   reaffirmation and ruling U14, 2026-09-19). **Read-only compatibility** applies to
   ALCOM/VCC-managed projects, whose only write path is the user-initiated "import as a
   VUA-managed copy" (user ruling U3, 2026-09-08; allow/deny lists, copy spec, and tightening
   clause under Explicit boundaries; write capability against original projects is uniformly
   false under the current boundary). **Settings-face exception (user ruling U14,
   2026-09-19):** the VPM package-manager settings (the repository-subscription and
   local-package-registry faces of `settings.json`) are the same file shared with VCC/ALCOM;
   VUA may read and write it, and changes are visible to both sides immediately — this exception
   covers the settings face only; the project-file face keeps U3 unchanged.
6. **Unity Bridge:** a versioned deterministic protocol using the
   [Editor compatibility policy](compatibility/unity-editor.md). During development, global
   `2022.3.22f1` and China `2022.3.22f1c1` form the accepted pair; historical projects enter
   through the documented migration boundary. Existing frozen protocol migrations remain explicit.
7. **Guidance and desktop presentation:** an in-app VUA tour, a knowledge encyclopedia inside Help,
   and a guide associated with the VRChat game window; task/runtime status retains its own
   application authority. **VR overlay:** remains unscheduled outside the active
   [N acceptance sequence](development-outline.md).
8. **Integrated runtimes:** major optional native-feeling capabilities, including face tracking,
   motion tracking, and Avatar optimization, through managed or external-connection adapters.
   The tools named in the active delivery policy enter N2; other integrations remain unscheduled.
9. **Community plugin interface:** a versioned protocol for optional enhancements and customization,
   with declared capabilities, lifecycle, tasks, permissions, and compatibility rules.
10. **SOPs and agent access (user ruling, 2026-10-16):** versioned SOPs that take a goal or a
    symptom to verified steps, covering settings, diagnosis, tools and Avatar production; an MCP
    server that gives the player's own AI agent observation, planning and permissioned execution
    through VUA's existing task authority; and external-tool delivery chosen by each tool's
    license. The [north star](north-star.md) defines the permission levels, SOP fields and license
    policy.

## Production scope and product rulings (user ruling, 2026-09-22)

> **This section is accepted product direction. It does not mean the related UI, protocols, or
> execution chain are implemented, and it is not a real-machine acceptance claim.** It supersedes
> conflicting older statements in this file and related documents (a fixed five-stage flow, the
> standalone Inspection page requirement, any implication that a Recipe fully reproduces arbitrary
> projects, and VUA exhaustively testing upstream capabilities). **Frozen protocols and existing
> data formats do not automatically change because of this documentation merge**; where change is
> needed, it lands through later versioned migrations. This section authorizes neither deleting
> existing data nor silently overwriting user projects.

### Confirmed scope

**Product positioning and beginner guidance.** The core audience is VRChat players unfamiliar with
Unity — including players who do not yet know what they need. End-to-end flow coverage remains
valuable, but a Wizard selects a path for the user by goal, device, and current state; no player is
required to walk one big flow. Device preparation adds Quest first-time-activation guidance and
distinguishes standalone use from PC-connected use. Guidance and tutorials never complete account
authentication or platform authorization on the user's behalf.

**Recipe = a stackable set of modifications.** A Recipe expresses an asset combination and explicit,
supported options, with semantics similar to a mod manager. A new Recipe stacks onto the current
Avatar; existing assets and settings it does not mention are preserved by default and must not be
deleted merely because they are absent from the new Recipe. Deletion must be an explicit action;
conflicts require explicit handling. A Recipe does not undertake full reproduction of arbitrary
Unity projects, scenes, or all hand-authored work.

Applying a Recipe to an existing Avatar offers four options: (1) Recipe settings win (supported
fields in conflict take the Recipe value); (2) Avatar settings win (conflicting fields keep the
current Avatar value); (3) create a new Avatar to carry the Recipe (recommended); (4) cancel. These
options cover only the fields the Recipe touches and do not authorize overwriting unrelated
content. Creating a new Avatar does not require creating a new Unity project, and adding, removing,
or changing assets on the same Avatar must not by itself demand a new project either. The ownership
limits of existing external projects (see the ALCOM/VCC clauses under "Explicit boundaries") apply
separately.

An object that cannot be identified is a different situation from a value conflict: "Recipe wins"
must not be used to paper over object-location ambiguity. And without a reliable baseline, not
every diff may be dismissed as a player's manual edit.

**Recipe sharing and reproduction boundary.** Shareable content = BOOTH asset references + clearly
supported boolean, enum, integer, and float options (for example color, brightness, hue, local
position, rotation, and scale). Not included: custom texture files, custom FBX, paid asset bodies,
and smuggling arbitrary content such as meshes or pixels into sharing by encoding it as numbers.
An SNS paste text and a file may carry the same declaration; the file itself may be nothing more
than long text and does not need to become a Unity scene package for that reason.

**Asset provenance (fill in at sharing time; as little as possible).** Import and local use do not
require entering a BOOTH ID immediately. Only when actually sharing, provenance is required only
for the assets this Recipe touches that lack it. The preferred flows are picking from the purchased
library or the product page, choosing from keyword-search candidate lists, and batch correlation —
typing in numbers one by one is not the default experience. Confirmed correlations are remembered
to avoid repeated work: human supplementation is as little as possible, as late as possible, and
never repeated once done. A BOOTH ID is the author's or user's provenance statement, not VUA's
certification of authenticity, unmodified state, or reproducibility. A wrong correlation is a
UGC-content responsibility; VUA still reports parse failures honestly and owns its own execution
and application errors. A reproducer re-acquires assets through their own BOOTH entitlement. A
provenance statement grants no purchase rights, and VUA is not required to prove the local package
is identical to the store original.

**Local material and acquisition sources (user ruling, 2026-10-10).** Ordinary user-provided local
material workflows do not classify licensed versus pirated files or impose additional intake
requirements on that distinction. VUA does not actively support piracy: do not add integrations,
acquisition paths or guidance specifically for pirated-material platforms, or bypass purchase,
authentication or access controls. This does not add a material-rights certification, source
blacklist or scanning requirement. The provenance and sharing rules above remain authoritative.

**Managed library re-download (user ruling, 2026-10-07).** An already-downloaded product shows
Re-download; the action replaces its managed file rather than storing another copy. The exact
replacement and reference effects are owned by the [replacement ruling](decisions/library-download-replacement.md).
This does not change unrelated local-import copies or silently rewrite frozen copy-in contracts.

**Retained files and selection drafts (user ruling, 2026-10-08).** Library downloads retain all
file formats, with production qualification evaluated separately under the replacement ruling.
Library selections may be collected in [Recipe selection drafts](protocols/recipe-selection-draft-v0.1.md)
while the intended Recipe design is unsettled. Drafts store references and remain separate from
production Recipes; saving a selection does not establish production eligibility.

**Local-file maintenance (user rulings, 2026-10-08).** Deleting selected managed files keeps
catalog/copy records and saved Recipe/draft references, shows missing files and permits restore
through re-download. Changed originals retain old generated VPM copies as superseded versions;
the current original needs regeneration. Saved references are not rewritten automatically.
The [maintenance ruling](decisions/library-file-maintenance.md) owns these behaviors.

**Missing files and source supplementation (user ruling, 2026-10-08).** A dedicated missing-file
relink feature is no longer required. Missing BOOTH-managed files are restored through explicit
library re-download. A missing upstream download remains unavailable rather than a successful
restore. This does not alter the retained-record/reference maintenance ruling.
For files needing provenance, the user may provide a BOOTH ID or product URL and VUA retrieves
the available official metadata through the existing product-page reader. For the first N5 closure,
manual supplementation exposes only a display name and thumbnail. Keep the origin of supplemented
information and remember the user's association; supplementation establishes neither account
entitlement nor production compatibility. Local import still does not require an ID. Third-party
metadata search is deferred by the 2026-10-09 ruling.

**Public BOOTH source lookup (user ruling, 2026-10-12).** A local entry may request a bounded
keyword search of BOOTH's public products, independently of account membership. Send only the
visible leaf name or a user-edited keyword; never upload files or local paths. A unique exact
title on a complete result page may be associated automatically; ambiguous/incomplete results
require candidate confirmation. Reuse the official product-page reader and local metadata write.
This records a source statement, not ownership, equal content or production qualification, and
does not create an account-library product. No site crawl or third-party search integration is
added. The previous deferral remains for those other sources.

**Migration reconciliation and N5 scope (user ruling, 2026-10-08).** Synchronizing the BOOTH
library also attempts to match already imported local material, including a batch migrated from
another manager. Product identity, name and image are not content identity: verified equal
fingerprints combine duplicate presentation, while different content keeps independent cards
even with identical product metadata. Without official reference bytes, keep the account and
local cards separate until verification. Names/IDs can suggest a source but never establish byte
equality or a user-confirmed association. Sync does not download the whole account for comparison.
Physical copies and saved references are retained when presentation is combined.

The initial 2026-10-09 record-removal face covers local imports; the later card-removal ruling below extends the visible scope. Dependency
discovery may initially use author-description links, with persistence and honest unconfirmed
evidence required; exhaustive classification and absent-link corner cases are not this pass.
Final Recipe design, VPM revision/regeneration mechanisms and actual library-to-production
acceptance move after N5 and are designed with the N3/N4 production loop. Their necessity remains
subject to that design. Existing file-retention and reference-preservation rulings still apply;
this deferral neither erases old generated output nor retargets existing references.

**First N5 closure limits (user ruling, 2026-10-09).** Local batch intake retains all ordinary
files in their relative layout without interpreting their purpose. Keep original ZIP archives and
automatically extract them into managed storage, preserving member directories and companion files.
ZIP storage and extraction outcomes remain distinct. PSD, FBX, PNG, JPG, instructions and other companion
files stay in the library. The first production intake accepts UnityPackage only; classification,
image editing and direct FBX/PSD integration are outside this N5 pass. Retention does not establish
production qualification, and existing format/content checks still apply at production intake.

**Description-link filtering (user ruling, 2026-10-12).** The standalone dependency reverse-lookup
button is retired. A single known product's menu offers "此商品的适配" and filters the material
wall to other library products whose captured author-description HTML contains its BOOTH product
link. No dependency-name matching, account ownership inference or whole-site crawl is involved.
"Cancel filter" sits immediately after pagination and restores the prior filters, page, display
mode, selection and scroll. This explicit read is available without an experimental enable prompt;
the old dependency-display setting is retired. Recorded links may describe demonstrations or
unrelated products, and unobserved/omitted links cannot match. A link or empty result is not a
compatibility or dependency verdict. Full dependency inference remains outside N5 closure.

Library list mode separates title, shop, variant and source into columns with draggable width
dividers. Multiple recorded variant choices use a count; source is plain cloud/downloading/paused/
downloaded/local-import/error text. Local imports use the same columns. The migration popup stays
outside clipping ancestors and opens from the import group's left edge.

**BDL.** The existing base storage, asset identity, source correlation, and catalog capabilities
are retained. Automatic compatibility-evidence collection is an experimental feature, off by
default; when enabled it tries to collect evidence from the user's actual BOOTH browsing and Unity
usage, without reviving the whole-site cloud-collection direction. Turning automatic collection off
never disables base storage, ordinary import, or Recipe provenance supplementation. The direction
of local evidence viewing and correction is retained; the concrete UI and editable scope still need
definition and must not be derived into arbitrary database-edit rights. No evidence means unknown;
it must not be treated as compatibility or dependency being resolved.

**Inspection folded into production records.** A standalone Inspection page is no longer required.
When the user confirms production and the workshop starts intake, Release creates a placeholder
record for that run. Production problems surface through both the notification center and the record
status; both open the same explanation, logs, and follow-up actions. Closing a notification does
not make the problem go away. A placeholder record of a run in flight must never pose as a completed
Build Record. The page change removes none of the inspection services, recovery guards, or evidence
records.

**MA and SDK responsibilities.** Modular Avatar's declared capability boundary is accepted; VUA no
longer exhaustively tests everything MA can do. VUA validates its own integration, parameters,
object selection, call ordering, and representative real flows; issues also reproducible through
standard upstream use are reported upstream. Build and target-platform technical limits reuse the
official SDK checks instead of maintaining duplicate rules. Missing assets, dependency
installation, Bridge execution, and recovery remain VUA's responsibility. A check that did not run
must never display as passed. The final upload is performed by the user in the official SDK;
technical checks cannot guarantee that appearance and behavior match player expectations, and this
must be stated clearly.

### Explicitly deferred

An independent lightweight UI based on egui, Slint, or similar frameworks is deferred indefinitely
until core functionality is stable; no start date is promised. This deferral does not cancel the
existing Electron resource-saving mode.

### To be verified / undecided

The following items are **undecided**; nothing in this section's wording implies any of them is
resolved:

- **Object location (undecided):** same-name bones, cross-project location, and repeated
  application require real-machine verification; the current approach must not be assumed reliable.
- **Recipe fields and encoding (undecided):** the product capability is decided; the field
  whitelist, location identifiers, and versioned format are not.
- **Conflict-handling implementation (undecided):** the four options are decided; diff detection,
  preview, and protection need implementation verification.
- **Dependency degradation path (undecided):** how dependency completion is accomplished when
  automatic forensics is off or resolution fails still needs a concrete flow.
- **BDL human correction (undecided):** the source-supplementation routes above are decided;
  third-party providers, concrete correction fields, permissions and interaction are not frozen.

## Extension and integration trust boundary

VUA classifies extensibility by data access and trust:

| Boundary | Product meaning | Access rule |
| --- | --- | --- |
| Kernel and local UI | Stable application bootstrap, security authority, Gateway enforcement, and controlled presentation surface | Extensions consume their published surfaces |
| Core | Repository-owned, reviewed product behavior built directly into the trusted application and release | Uses owned Orchestrator application use cases and ports |
| Plugin | Separately packaged enhancement using the public, versioned capability boundary | Explicit grants define its complete authority |
| External | Independent software interacting with Unity, VRChat, SteamVR, devices, or another public external boundary | Maintains independent state; each VUA-side adapter is classified as Core or Plugin |

Environment deployment, tracking, optimization, accessibility, and appearance are described as
natural-language purposes inside each entry. The community-maintainable
[tool catalog](tool-catalog/README.md) records classification and evidence for individual entries.
The product boundary approves scope, architecture approves implementation ownership, and the release
gate derives risk from declared capabilities and behavior.

## Stable product principles

- **Recipe-first:** select assets and intent before creating or modifying a Unity project.
- **Local-first:** purchase sessions, orders, downloads, paid assets, and production state remain on
  the user's device.
- **Deterministic production:** normalizable Unity work is reproduced through Unity Bridge and Build
  Records.
- **Capability-aware:** official, open-source, and community tools coexist through adapters; the UI
  reports the actual available capability.
- **Recoverable:** long-running tasks define state, cancellation, retry, recovery, and manual handoff.
- **Least privilege:** remote content, plugins, and third-party components receive only required
  capabilities.

## N1 device and network onboarding

### First play release (user ruling, 2026-10-03)

#### Ibis release criterion (user ruling, 2026-10-08)

Before Ibis publication, ask one question: can a VRChat player who has never used VUA get
from its download page through the advertised core play workflow without getting stuck?
Fix blockers found on that journey; publish once it works. A clear official-client handoff,
with a useful next action and a way to return, can satisfy the journey without extra automation.
Do not add another feature or require zero bugs as an independent release condition.

Desktop and PICO USB/Wi-Fi remain the core play routes. Optional eye tracking, a curated
tutorial-world list and further automation do not independently delay this release. Keep
unfinished optional work visibly skippable and describe its actual availability. This ruling
supersedes the earlier requirement to finish optional eye tracking before Ibis publication;
it retains that accepted N2 work and its evidence requirements. Publication does not close
untested N-stage outcomes. The [version policy](release/versioning.md) continues to govern
numbering, Beta status and disclosure of non-blocking defects.

#### Bounded play scope

The first play release takes a Windows user from missing play software to desktop VRChat play
or PICO Connect streaming. It delivers the following bounded scope:

- Inspect the relevant Internet services and download sources; distinguish these failures from
  local PC/headset connectivity. Explain useful remedies and recheck after the user's action.
  The 2026-10-09 network ruling below supersedes usage-region detection and accelerator advice.
- Guide Steam registration, verification and client login. Existing accounts skip registration.
  Explain VRChat's first login with Steam; a full VRChat account and account linking remain
  optional guidance. Hand off PICO account/device confirmations when its official flow needs them.
- Detect and install Steam and VRChat for desktop play. Only the VR route additionally requires
  SteamVR, PICO Connect and the necessary components supplied by their official installers.
  Inspect Windows, disk space and graphics/driver readiness, with specific remediation guidance.
- Guide launch, connection, basic controls, audio/microphone setup and the next play session.
  Prefer supported silent installation with visible progress and explicit user handoffs.
  Reuse installed software and recover interrupted work through inspection and explicit retry.
- Provide three guidance contexts (user ruling, 2026-10-05): a transparent, ordered tour over
  VUA's own controls; readable room/equipment preparation; and a transparent
  guide over the Windows VRChat game window for controls/settings and available tutorial worlds.
  The game guide defaults to following VRChat and 50% transparency. Reuse shared instructions
  and illustrations, with independent progress for each context. Guidance works without AMF.
  The [guidance architecture](architecture/guidance.md) owns presentation and window behavior.
  The 2026-10-10 presentation ruling places preparation and hardware reading in the main Help
  encyclopedia. Test it through SteamVR's desktop view on the headset; a native VUA
  VR overlay remains later work.
- Include optional PICO 4 Pro eye tracking through independently installed VRCFaceTracking.
  Guide Steam installation, the PICO hardware module, headset calibration and VRChat OSC;
  verify gaze and blinking over USB and Wi-Fi, including reconnect and simultaneous microphone
  use. Use an existing suitable Avatar; Avatar modification is not a prerequisite. This N2
  slice retains its own acceptance; the Ibis release criterion above permits it to remain pending.

PICO 4 Pro with both USB and Wi-Fi is the first hardware acceptance target. Record actual
PICO OS, PICO Connect, SteamVR and game versions at test time. PICO precedes Quest so this
release does not depend on resolving Quest's initial activation path. Other brands, alternative
streaming tools, creator accounts, Unity/AMF and the remaining N2 tools follow in later deliveries.
Existing code and the wider N-stage scope are retained; this release does not close all of N1.

Windows distribution follows the [2026-10-11 delivery ruling](#windows-delivery-and-amf-updates-user-ruling-2026-10-11),
which defines the subsequent NSIS/runtime and AMF-update work. Under the author's later
2026-10-11 ruling, publish the current implementation first as **v0.6.6 Ibis**, using the existing
standalone Windows x64 ZIP. This publication does not wait for NSIS or independent AMF updates,
does not declare pending physical/material/human acceptance complete, and does not rewrite
earlier preview evidence. Advance the subsequent N7 work and guide separately.
Prepare exact-build third-party notices and SignPath Foundation application/integration alongside
development. Local unsigned previews are explicitly labeled; public signing status and remaining
limitations are recorded at publication. No certificate application blocks implementation.
Acceptance belongs to [the first play release rows](development-outline.md#first-play-release-acceptance).
The [delivery plan](development/first-play-delivery-plan.md) records completed slices and the
remaining work. N5 is reviewed separately when complete and can accompany this release after
that review; its work is not part of the current first-play checklist or a play prerequisite.

### Windows delivery and AMF updates (user ruling, 2026-10-11)

Use NSIS for the Windows VUA installer. Automatically detect usable mirrors and acquire the
exact compatible Electron runtime, including Chromium and its supporting files. Reuse a complete
verified VUA-owned runtime when its version is unchanged; ordinary host/module updates must not
download it again. Provide an offline installation/recovery path for unavailable download sources.

AMF installs with VUA and retains the accepted fresh-enabled default and existing saved choices.
It supports independent incremental updates inside VUA within explicit host/protocol/data
compatibility. Keep its full UI/backend payload boundary separate from user data and private BDL;
an update failure must leave host/play usable. Preserve active-work admission, interruption,
explicit retry and supported migration/recovery rather than replacing running work or data.

Download sources distribute verified release content; they do not choose compatibility or
collect user credentials/materials. Exact-build notices, version/source and signing disclosures
remain required. The [Windows distribution plan](development/windows-distribution-plan.md)
proposes the sequential slices; [N7](development-outline.md#n7-beta-installer-regression-and-illustrated-user-guide)
owns acceptance. This is a delivery decision, not installer/update evidence or N-stage completion.

On 2026-10-13 the author required multiple built-in usable runtime mirrors, selected by actual
reachability, primarily for mainland China. The author then authorized PH-R.COM deployment on
2026-10-13: serve the published installers from the official website and support official-site
version information alongside GitHub. Hosting distributes public immutable artifacts and signed
inventories only; the release key, user accounts/materials and machine evidence remain local.
The existing v0.6.7 bytes are mirrored unchanged; dual-source checking enters a subsequent client
build rather than rewriting that published release. The official project page distinguishes
current capabilities from AMF automatic editing and Recipe work that remains in development.
The [implemented distribution boundary](architecture/windows-distribution.md)
records the exact runtime, first-party module and controlled evidence separately from N7 acceptance.

### Play network presentation (user ruling, 2026-10-09)

Play shows Europe, the United States (East and West together), and Japan as the intended VRChat
instance-latency destinations. Only a verified game-region target can produce a regional Ping;
website response time is not a substitute. Until targets are established, report that regional
latency is unavailable and keep the play journey accessible. Editable website tests, including
Steam and GitHub, belong in expanded details.

Remove Connection help, usage-region identification and third-party accelerator recommendations
from the player flow. This supersedes the 2026-10-03 UU recommendation and the earlier N1
region-based advice. It does not change the explicit mainland/global PICO installer choice or
the independently owned Unity download policy. The [network architecture](architecture/network-onboarding.md)
owns observation limits and current implementation status.

### Subsequent device expansion

The device pool from the 2026-10-02 ruling remains the subsequent expansion direction after
the first play release. It covers Meta Quest, Oculus Rift S, PICO, HTC VIVE, Valve Index
and Sony PS VR2. Investigate Windows Mixed Reality's installation and validation cost before
committing it to a delivery; substantial work may be deferred under the user's permission.
Bigscreen and Varjo follow the initial pool. Deliver one complete route per supported model
first, preferentially the official manufacturer route, then add alternative streaming choices.

Players select brand and model. Derive direct video connection, USB streaming or wireless
streaming internally; ask a plain-language connection question only where that model has multiple
relevant choices. Match consumer/enterprise editions explicitly. Streaming choices include the
manufacturer's software, ALVR, Virtual Desktop and Steam Link as model-specific routes land.

Prefer supported silent installation with a visible task: actual phase, elapsed time, available
progress/activity, interaction requests and next actions during prolonged inactivity. Verify
installed results and keep user actions attached to that task. Route-specific account guidance,
headset activation and service connectivity are N1 prerequisites. Use official device/account
handoffs and concrete service observations under the network ruling above, without usage-region
identification or accelerator recommendations. Existing privacy boundaries apply.
See the [N1 delivery plan](development/n1-delivery-plan.md).

## Unity deployment

For N1, use the official Unity CLI to look up the target release and prefer Unity's official
download route in every region. Identify the actual downloaded f1/c1 artifact before installation.
NoUnityCN is an optional backup source, never the first source. Settings includes an
enabled-by-default mirror switch; when off, use only Unity's official download sources.

Prefer an existing usable global `2022.3.22f1`, then an existing China `2022.3.22f1c1`.
When installation is needed, request the global official entry first. If it returns the accepted
China artifact, install that actual edition directly. If global installation fails, try China;
hand off to Unity Hub when the accepted alternatives fail.
The author accepts this exact f1/c1 pair as equivalent for current development (2026-10-02),
informed by community reports and their own inquiries. Preserve the observed full version in
plans, installation records and later Build Records; do not rename c1 as f1. Use small real
project trials to fix actual compatibility issues as they arise.

Install the original Unity installer on the user's machine and register the Editor with the
official standalone CLI. VUA does not bundle Unity CLI/Editor or operate its own Unity mirror. Users choose
licenses and accept agreements themselves, and Unity's tooling keeps its own credentials. The
[deployment direction](architecture/unity-deployment.md) owns the installation and evidence path;
this does not widen first-delivery account storage or authentication automation.

## Account onboarding (user ruling, 2026-09-30)

The first play release uses the subset defined above; creator account guidance follows with
creator delivery. N1 account guidance uses official pages in the built-in browser, with
client, phone-app or headset handoffs where required. The base scope is Steam and VRChat for play,
with optional Unity and BOOTH/pixiv registration guidance for the creator route. Add manufacturer,
headset-store and streaming account guidance when the selected device route requires
it (user ruling 2026-10-02). Existing users
can skip registration. VUA explains each step; users enter account information, solve challenges,
accept terms, add VRChat to their Steam library, and perform account upgrade/linking themselves.
Account linking means the official Steam-platform-account to full VRChat-account flow, not a
VUA identity binding or a VUA account database. Steam client, game and Unity CLI authorization/licensing steps are explicit
handoffs; Unity Hub is optional. An official page that refuses embedding has a system-browser fallback.

Only guide progress and user-declared completion are saved by this first slice. A page opening
does not prove registration, ownership or account linking. Authenticated API automation, page
data extraction, a cloud account service, a password vault, cookie import and persistent sign-in
are not part of first delivery. Isolated temporary browser sessions handle interactive pages; secret
values never enter VUA application state, Gateway, Orchestrator, Agent context or diagnostic logs.
This does not claim that embedded authentication is automatically permitted by every platform.

Creator guidance explains that SDK upload requires a full VRChat account and New User or higher.
VUA can explain normal play and the official eligibility checks; it cannot grant a trust rank,
promise a time to promotion or automate rank farming. Rank is user-reported until a later supported
read path exists. A missing upload prerequisite does not block local Avatar preparation or testing.
Unity/BOOTH registration is optional for players; purchases and SDK upload remain user-operated.
BOOTH library acquisition remains the separate N5 requirement, not an N1 account-system expansion.

After the first usable delivery, attempt VRChat web-information reading as a separate slice.
Experimental VRChat sign-in in VUA (user ruling, 2026-10-18): an Experimental setting, off by
default. Before the first sign-in VUA explains the conflict with VRChat's written credential and
session policy and possible account action up to a ban, and the player accepts or leaves it off.
The player signs in in VUA with username, password and the two-factor code VRChat asks for; VUA
keeps the session and, only when the player also chooses "Remember my password", the password, both
encrypted per Windows user, outside application state, the Gateway, task records, logs and the MCP
adapter. Sign-out and forgetting clear them. VUA uses the session to sign the official SDK in before
a managed upload and to read the player's own Avatar list to check uploads; requests identify VUA,
stay few and back off. Consent does not change platform terms. The design lives in
[VRChat sign-in](development/vrchat-account.md).

Sources checked 2026-09-30: [SDK upload prerequisites](https://creators.vrchat.com/avatars/creating-your-first-avatar/)
and [VRChat Creator Guidelines](https://hello.vrchat.com/creator-guidelines).

## VRChat interaction and privacy

User-adopted implementation boundary (2026-09-29), informed by the
[Creator Guidelines](https://hello.vrchat.com/creator-guidelines) and
[documented configuration](https://docs.vrchat.com/docs/configuration-file), checked on that date:

- Use supported external surfaces, OSC, launch options, necessary local logs and documented
  configuration fields. Never inject, hook or patch the VRChat client or bypass EAC. Hidden
  configuration and undocumented client behavior are not authorized by an existing third-party tool.
- Outside the experimental VRChat sign-in above, VUA does not collect or extract VRChat login
  credentials, including passwords, tokens, cookies and session data; temporary browser state is
  confined to the isolated browser. Do not import another application's session. BOOTH's N5
  acquisition session remains a distinct, authorized local boundary.
- User initiation is necessary for account changes, but is not sufficient authorization for an
  undocumented operation or credential access. Unsupported operations stay unavailable; direct
  the user to the official flow. No cloud account control. Avatar uploads run through the official
  SDK builder on the player's device after the player's own confirmation of the content rights for
  each upload (managed upload, user ruling 2026-10-17).
- Store only necessary data locally by default; no unnecessary friend-activity tracking, profiling
  or cross-user database. Sanitize logs and retain purchased files locally.
- Any future allowed API adapter needs bounded request rates, backoff and accurate identification,
  and a concrete policy review. This section grants no new API feature or execution permission.
- State clearly that VUA has no VRChat Inc. affiliation or endorsement. Do not infer approval from
  the continued existence of VRCX or other tools, or promise blanket policy compliance.

## Explicit boundaries

- BDL is AMF's private local data module in this repository; AMF provides its application services.
- Electron Main owns remote-page, Session, Cookie, permission, and download transport mechanisms and
  their desktop security enforcement. AMF owns acquisition intent, durable tasks, source validation,
  file inspection, and Warehouse mapping. Their boundary exchanges normalized application values.
- BOOTH sessions, orders, purchased files, and credentials stay on the user's device; platform
  purchase, payment, identity, age, and access controls remain authoritative.
- Repository and cloud-CI tests use synthetic fixtures that match production input structures without
  containing real product or user content.
- Local read-only compatibility tests may access public BOOTH pages through the platform's normal
  public entry points while respecting authentication, payment, age, and access controls. Page
  responses, screenshots, and product metadata are not committed as test fixtures.
- Developers may run local integration and smoke validation with Unity assets they lawfully obtained
  or purchased. Those assets, user projects, test configuration, and outputs stay local and do not
  enter the repository or cloud-CI artifacts.
- [Unity editor compatibility](compatibility/unity-editor.md) defines the development pair
  `2022.3.22f1` / `2022.3.22f1c1`. `2019.4.31f1` and `2022.3.6f1` are migration sources. Other Unity versions
  report their exact difference from the production target while project files remain unchanged;
  Tuanjie Engine is currently unsupported.
- **ALCOM/VCC project compatibility (user ruling U3, 2026-09-08, after third-party arbitration
  review):** read-only against ALCOM/VCC-managed original projects. **Allowed:** discovery and
  identification; reading version/package/SDK/compatibility/environment state; generating
  diagnostics, plans, and handling suggestions; handing write operations off to the owning
  manager; "import as a VUA-managed copy" after explicit user choice. **Denied:** installing or
  removing packages inside the original project; modifying its manifest, project configuration,
  assets, or `.vua` job files; writing ALCOM/VCC registries, databases, settings, or caches;
  silently relabeling the original project as VUA-managed. **"Import as a VUA-managed copy"
  spec:** new project path + new project identity; estimated disk usage shown up front; no
  copying of regenerable directories or legacy task state; re-Inspect after import (the original
  project's confirmations/snapshots are not inherited); the source relationship is kept so the
  user can go back. **Rationale:** VUA's project lock coordinates VUA instances only — ALCOM/VCC
  do not honor it, so "allow writes + warn about conflicts" would promise a safety that does not
  exist; both sides understanding the VPM format does not mean they share compatible transaction
  and recovery mechanics. **Tightening clause:** under the current product boundary, write capability
  against ALCOM/VCC-managed projects is uniformly false; it may only be opened later through a
  **new user ruling** once the upstream offers verifiable transactions/locks/a supported write
  interface — warnings alone are not sufficient. **Settings-face exception (user ruling U14,
  2026-09-19):** the deny-list item "writing ALCOM/VCC registries, databases, settings, or
  caches" is waived for the VPM package-manager settings file (the repository-subscription and
  local-package-registry faces of `settings.json`) — that location is the shared settings
  convention of VCC/ALCOM/vrc-get, and VUA is opened for read/write with changes visible to both
  sides immediately; all other storage faces such as `vcc.liteDb` stay denied, and the
  project-file face keeps U3 read-only with clone-then-modify-the-copy as the default external
  import path.
- **Remote web browsing and window/protocol boundary (user rulings U7② + U9, 2026-09-09):**
  Web browsing follows an **allowlist-first** policy — allowlisted domains browse directly;
  non-allowlisted domains are **prompted but never blocked** (content stays reachable after
  confirmation). **The purchase flow is out of scope for now** (not permanently; depends on
  future contact with BOOTH officially); download host domains are **proposed and approved
  domain by domain** after real-machine verification. New windows and external protocols
  follow a **four-way split**: (1) web-class new windows (http/https) never open a separate
  window — allowlisted targets open in the current embedded view, non-allowlisted targets
  open in the current view after a confirm prompt; (2) pseudo-protocol windows
  (`javascript:`/`data:`/`blob:`/`file:`) are rejected unconditionally with no override path;
  (3) external protocols pass through a **dedicated confirmation layer**: non-allowlisted
  http/https prompts first and then hands off to the system browser; explicit protocol lists
  such as `mailto:`/`steam:`/`vrchat:`/`discord:` show a per-invocation confirmation dialog
  with the full target and never offer a permanent skip; unknown protocols are denied by
  default; (4) **gesture requirement:** protocol launches must originate from a user click;
  page-triggered launches (script/meta refresh) never execute; native new-window creation is
  denied unconditionally. **Rationale:** content reachability (prompt, don't block) and local
  privilege isolation (no separate windows, no unconfirmed protocol launches) hold together;
  remote content never gains local privilege (see "Extension and integration trust boundary").
- Every optionally bundled component requires an individual license, redistribution, update, and
  signature review.
- EAC process termination is an experimental high-risk recovery action, disabled by default and
  confirmed on every execution. It may cause game interruption, abnormal EAC state, or in extreme
  cases platform/account safety checks and account anomalies. It is limited to verified allowlisted
  user-mode residual processes and never disables services/drivers, modifies EAC/VRChat files, or
  bypasses anti-cheat.
- The first delivery phase supplies the capability protocol and security model; marketplace
  governance follows a later release decision.
- VRChat Avatar uploads run through the official SDK, started by the player and confirmed per upload
  (managed upload, user ruling 2026-10-17); VUA prepares, validates and reports the SDK's result. A technical check passing does not guarantee appearance and behavior match player
  expectations (this must be stated clearly to the user), and a check that did not run must never
  display as passed (user ruling, 2026-09-22).

## Active delivery policy (user rulings, 2026-09-28)

The [N1-N7 sequence](development-outline.md) replaces M/W scheduling and owns stage outcomes,
acceptance rows, and evidence requirements (including human UI acceptance, blocked-step recording,
and environment labeling). Develop usable vertical paths quickly, record bounded gaps, and fill
them as real runs expose needs. Do not require exhaustive module completeness or universal human
acceptance. Existing access, privacy, ownership, and explicit recovery requirements remain
implementation constraints; results must still be factual.

The project remains **Beta until the author explicitly requests otherwise**, with no planned
v1.0.0 milestone and no production-safety guarantee. Historical release labels/tags are unchanged.
N stages define delivery outcomes independently of product release numbers; the
[versioning policy](release/versioning.md) selects versions from actual release changes and owns
the numerical Beta mapping. N-gate completion applies only to its recorded scenarios and disclosed
limitations.

Scope rulings attached to the active sequence:

- N1 isolates the scenario host before prerequisite checks, deployment and SOP delivery; Steam,
  PICO and Unity detection/preparation are reusable host capabilities. N3/N4 belong to AMF and
  N5 to AMF + BDL, retaining existing code, review and independent acceptance. N6 accompanies
  each scenario's interruption/return/reinspection/retry; N7 records host/module release and
  compatibility separately. This ownership change does not declare N1 or N5 complete.
- N2 covers selected optional modules and external-software connections, including the original
  seven Steam tools and VRCS in the [outline](development-outline.md#n2-external-gameplay-tools).
  Use each upstream's supported Steam, official-installer or GitHub-release source for discovery,
  acquisition/handoff, launch and observed status. VRCFT and Space Calibrator retain their setup
  and hardware acceptance; other entries need no individual usage tutorial or automation of
  their internal features.
  PICO eye tracking is advanced into the first play release; the remaining N2 work follows it.
  Official applications retain their upstream features, licenses and lifecycle. A native VUA
  connector does not imply a bundled upstream binary. Explicit optional-module selection is
  separate from upstream application installation; it grants no arbitrary plugin-script authority.
  Internal Space Calibrator driver IPC is not a VUA integration contract. This grants no VRChat
  injection or generic plugin-host authority.
- [N5](development-outline.md#n5-audit-and-redo-material-management) BOOTH acquisition does not
  authorize purchasing, access bypass, or a project-operated asset server. Source sessions,
  orders, files and account catalogs remain local.

Local uninstall/reinstall on this machine is authorized for deployment testing, with unrelated
user data/projects preserved. Residual registry/configuration/environment state means such a run
is not a completely clean OS. Separate VM and CI results are labeled by their actual environment.
Before remote CI coverage there is no claim of guaranteed operation on other Windows versions;
afterward, only the versions and operations actually exercised may be reported as tested.

## Current stage

Current development is continuing Beta under the N sequence. The historical v0.6.0 artifact remains
unchanged; this ruling is not a new product release. Runtime-tool deployment is active. Community
plugin execution and a marketplace still require their separately accepted security decisions.

**External Agent access (user ruling, 2026-10-13).** VUA runs a local MCP server for the
player's own AI tool through the [Candidate adapter](protocols/ai-tools-v0.1.md). The player turns
the connection on and gives the pairing prompt, with its local token, to their AI tool; VUA stores
the token encrypted and keeps it out of snapshots and logs. The tools reuse the typed Gateway,
module readiness, the versioned Bridge and the existing task and recovery authorities, and reach
only VUA's own facts and operations. Every change an agent requests waits for the player's
confirmation in VUA. [SOP, checks and installation](protocols/scenario-environment-v0.1.md) are
separate calls, and VUA shows [registration and activation guidance](compatibility/unity-editor.md)
before the Unity Editor runs.

**Library presentation and intake (user ruling, 2026-10-12).** The visible local source means user-imported material, rather than every downloaded local file. The separate [card-removal face](protocols/library-records-v0.2.md) extends the initial local-record removal to complete entry and account-product card presentations, with files/references retained and no automatic restoration by sync. **Import a local item** keeps explicit per-path copy-in; its adjacent arrow opens **Import multiple items (library migration)**. Material boundaries must not be silently guessed. The current migration preview is read-only; its [grouping design](development/library-migration-design.md) is a draft and does not grant a new writer or declare N5 accepted.

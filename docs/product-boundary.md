# VUA product boundary


> Document version: 2.15.0
> Status: Accepted
> Scope: Entire VUA product
> Updated: 2026-10-08
> Normative effect: Yes

## Product definition

VUA is a Windows-first, local VRChat desktop production environment for players who want to move
from asset discovery and environment preparation through Avatar production and runtime-tool setup.
The core audience is VRChat players who are unfamiliar with Unity and may not even know what they
need (user ruling, 2026-09-22). It is Recipe-first, local-first, capability-aware, and designed
for recoverable execution: new users get a Wizard that selects a path by goal, device, and current
state instead of everyone being marched through one fixed master flow (end-to-end flow coverage
remains a valuable capability), while experienced users keep inspectable, reproducible production
records.

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
7. **Guidance and desktop presentation:** an in-app VUA tour, an ordinary preparation reader,
   and a guide associated with the VRChat game window; task/runtime status retains its own
   application authority. **VR overlay:** remains unscheduled outside the active
   [N acceptance sequence](development-outline.md).
8. **Integrated runtimes:** major optional native-feeling capabilities, including face tracking,
   motion tracking, and Avatar optimization, through managed or external-connection adapters.
   The tools named in the active delivery policy enter N2; other integrations remain unscheduled.
9. **Community plugin interface:** a versioned protocol for optional enhancements and customization,
   with declared capabilities, lifecycle, tasks, permissions, and compatibility rules.

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
the available official metadata. When the official product metadata is unavailable, support
third-party metadata search and minimal manual supplementation as alternative routes. Keep the
origin of supplemented information and remember the user's association; neither route establishes
account entitlement or production compatibility. Local import still does not require an ID.
Third-party providers and the exact correction fields/interaction remain to be designed.

**Migration reconciliation and N5 scope (user ruling, 2026-10-08).** Synchronizing the BOOTH
library also attempts to match already imported local material, including a batch migrated from
another manager. Product identity, name and image are not content identity: verified equal
fingerprints combine duplicate presentation, while different content keeps independent cards
even with identical product metadata. Without official reference bytes, keep the account and
local cards separate until verification. Names/IDs can suggest a source but never establish byte
equality or a user-confirmed association. Sync does not download the whole account for comparison.
Physical copies and saved references are retained when presentation is combined.

N5 record removal first covers local imports; hiding account products is later work. Dependency
discovery may initially use author-description links, with persistence and honest unconfirmed
evidence required; exhaustive classification and absent-link corner cases are not this pass.
Final Recipe design, VPM revision/regeneration mechanisms and actual library-to-production
acceptance move after N5 and are designed with the N3/N4 production loop. Their necessity remains
subject to that design. Existing file-retention and reference-preservation rulings still apply;
this deferral neither erases old generated output nor retargets existing references.

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

The first play release takes a Windows user from missing play software to desktop VRChat play
or PICO Connect streaming. It delivers the following bounded scope:

- Inspect the relevant Internet services and download sources; distinguish these failures from
  local PC/headset connectivity. Explain useful remedies and recheck after the user's action.
  The first mainland-China accelerator recommendation is only NetEase UU, with the existing
  no-financial-relationship disclosure. Region is a correctable hint, not a connectivity verdict.
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
  VUA's own controls; a normal readable window for room/equipment preparation; and a transparent
  guide over the Windows VRChat game window for controls/settings and available tutorial worlds.
  The game guide defaults to following VRChat and 50% transparency. Reuse shared instructions
  and illustrations, with independent progress for each context. Guidance works without AMF.
  The [guidance architecture](architecture/guidance.md) owns presentation and window behavior.
  Test the preparation reader through SteamVR's desktop view on the headset; a native VUA
  VR overlay remains later work.
- Include optional PICO 4 Pro eye tracking through independently installed VRCFaceTracking.
  Guide Steam installation, the PICO hardware module, headset calibration and VRChat OSC;
  verify gaze and blinking over USB and Wi-Fi, including reconnect and simultaneous microphone
  use. Use an existing suitable Avatar; Avatar modification is not a prerequisite. This N2
  slice is required release acceptance even though players can skip enabling eye tracking.

PICO 4 Pro with both USB and Wi-Fi is the first hardware acceptance target. Record actual
PICO OS, PICO Connect, SteamVR and game versions at test time. PICO precedes Quest so this
release does not depend on resolving Quest's initial activation path. Other brands, alternative
streaming tools, creator accounts, Unity/AMF and the remaining N2 tools follow in later deliveries.
Existing code and the wider N-stage scope are retained; this release does not close all of N1.

Distribute a self-contained Windows x64 ZIP first. Advance the shared N7 packaging work and
the relevant illustrated guide; NSIS, automatic updating and the rest of N7 follow separately.
Prepare exact-build third-party notices and SignPath Foundation application/integration alongside
development. Local unsigned previews are explicitly labeled; public signing status and remaining
limitations are recorded at publication. No certificate application blocks implementation.
Acceptance belongs to [the first play release rows](development-outline.md#first-play-release-acceptance).
The [delivery plan](development/first-play-delivery-plan.md) records completed slices and the
remaining work. N5 is reviewed separately when complete and can accompany this release after
that review; its work is not part of the current first-play checklist or a play prerequisite.

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
headset activation and regional connectivity are N1 prerequisites. For mainland-China users,
evaluate dedicated activation/acceleration services; the first accelerator recommendation is NetEase UU with
an explicit no-financial-relationship disclosure. Region informs suggestions; target-service
reachability and user correction refine the plan. Existing privacy boundaries apply.
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
headset-store, streaming and accelerator account guidance when the selected device route requires
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
The author's intended local sign-in persistence is a deferred experimental option, off by default:
before the first experimental login, explain conflict with the written platform credential/session
policy and possible account sanctions up to a ban, and let the user decline persistence. Put the
switch in Experimental settings. This is recorded product intent, not an implemented feature or
platform permission. Its implementation must define browser-owned local storage, expiry/clearing,
logout and consent behavior without exposing secrets to application or Agent data paths. Consent
does not change platform terms. It is not an N1 prerequisite or permission for cloud account control.

Sources checked 2026-09-30: [SDK upload prerequisites](https://creators.vrchat.com/avatars/creating-your-first-avatar/)
and [VRChat Creator Guidelines](https://hello.vrchat.com/creator-guidelines).

## VRChat interaction and privacy

User-adopted implementation boundary (2026-09-29), informed by the
[Creator Guidelines](https://hello.vrchat.com/creator-guidelines) and
[documented configuration](https://docs.vrchat.com/docs/configuration-file), checked on that date:

- Use supported external surfaces, OSC, launch options, necessary local logs and documented
  configuration fields. Never inject, hook or patch the VRChat client or bypass EAC. Hidden
  configuration and undocumented client behavior are not authorized by an existing third-party tool.
- VUA application features do not collect or extract VRChat login credentials, including passwords,
  tokens, cookies and session data. Users type into official pages, not VUA-owned credential forms;
  temporary browser state is confined to the isolated browser. Do not import another application's
  session. The account-onboarding section supersedes the previous blanket ban only for this guided
  browser flow and records the separate, deferred experimental persistence direction. BOOTH's N5
  acquisition session remains a distinct, authorized local boundary.
- User initiation is necessary for account changes, but is not sufficient authorization for an
  undocumented operation or credential access. Unsupported operations stay unavailable; direct
  the user to the official flow. No cloud account control and no automatic upload on a user's
  behalf, including from their device; final Avatar login/upload stays in the official SDK.
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
- Final VRChat Avatar login and upload remain a user action in the official SDK flow; VUA prepares
  and validates. A technical check passing does not guarantee appearance and behavior match player
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

- N2's external-tool scope is the seven applications listed in the
  [outline](development-outline.md#n2-external-gameplay-tools). A common Steam connection provides
  local installation inventory, official purchase/install handoff, launch and observed status.
  VRCFT and Space Calibrator retain their specific setup and hardware acceptance; the five other
  applications need no individual usage tutorial or automation of their internal features.
  PICO eye tracking is advanced into the first play release; the remaining N2 work follows it.
  Official applications retain their upstream features, licenses and lifecycle. A native VUA
  entry means a built-in connector to the external app, not a bundled copy or a VUA plugin.
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

## Document changelog

- 2.15.0 (2026-10-08): add content-based migration reconciliation and narrow N5 to local record removal and persisted link clues; defer final Recipe/VPM and production-loop work.
- 2.14.0 (2026-10-08): replace the missing-file relink requirement with explicit BOOTH re-download and record official-ID, third-party and manual source-supplementation routes.
- 2.13.0 (2026-10-08): preserve records/references after local-file removal and retain superseded VPM output after changed managed originals; link the maintenance ruling.
- 2.12.0 (2026-10-08): retain all downloaded formats with separate production qualification and allow provisional Recipe selection drafts without deciding the production format.
- 2.11.0 (2026-10-07): record the user ruling that managed library re-downloads replace the existing selected file while preserving entry identity; link the owning replacement decision.
- 2.10.0 (2026-10-05): separate app, preparation and game guidance in the first play scope and retain N5 as an independently reviewed co-release.
- 2.9.0 (2026-10-03): add PICO eye tracking to the first play release and expand N2 to seven external tools with shared Steam inventory/install/launch acceptance.

- 2.8.1 (2026-10-03): limit the initial accelerator recommendation to NetEase UU per the author's ruling.

- 2.8.0 (2026-10-03): bound the first play release to desktop/PICO onboarding, a desktop guide overlay and ZIP distribution; retain wider N1 work for later deliveries.
- 2.7.0 (2026-10-02): make CLI-led official acquisition first in every region and identify the actual downloaded edition; mirrors are optional backups.


Earlier entries remain in Git history.

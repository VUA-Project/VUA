# Windows distribution and independent AMF updates

> Status: Draft
> Updated: 2026-10-13
> Scope: NSIS installation, mirrored Electron runtime acquisition and bundled AMF incremental updates

The author approved the delivery direction on 2026-10-11: use NSIS for VUA, automatically
select an available mirror for the runtime during installation, install AMF with VUA, and
support independent incremental AMF updates inside VUA. The [product boundary](../product-boundary.md#windows-delivery-and-amf-updates-user-ruling-2026-10-11)
owns that accepted scope. This document proposes implementation slices; it does not claim that
an installer, updater or release has been accepted. The current controlled implementation is
recorded in [Windows distribution architecture](../architecture/windows-distribution.md). Acceptance belongs to [N7](../development-outline.md#n7-beta-installer-regression-and-illustrated-user-guide),
with interruption and retry exercised under N6. Existing N1/N5 and physical play evidence remain separate.

## 1. Outcome and limits

A player downloads one Windows x64 NSIS installer. It includes VUA and a compatible AMF baseline,
obtains the required runtime automatically, and starts VUA without a development checkout,
Node.js, pnpm or manual assembly. Fresh AMF remains enabled; existing enable/disable choices
and user data survive installation and updates.

The separately acquired runtime is the complete, exact-version **Electron** distribution,
including Chromium, Node.js, supporting files and notices. An installed Chrome/Edge browser or
another application's private Electron directory is not a reusable VUA runtime. Reuse only a
complete, verified runtime in VUA's own installation/cache.

When the runtime version is unchanged, a VUA or AMF update downloads no runtime bytes. AMF
updates independently of VUA within declared compatibility. The first incremental delivery is
file-based: reuse verified unchanged module files and download changed or missing files.
A full AMF package is a recovery option, not the only implementation of incremental updating.
Binary/chunk patches within a changed executable and host-wide differential updates are later
optimizations. Runtime security/compatibility updates still acquire the required new version.

Retain an offline installation path containing the same compatible baseline. Existing ZIP
previews and their evidence stay intact; they do not establish NSIS acceptance. A public plugin
marketplace, third-party code execution, MCP integration and external software updates are outside
this work. Steam/PICO/Unity/VRCFT keep their existing source-specific installation boundaries.

## 2. Three delivery units

| Unit | Contents and owner | Delivery |
| --- | --- | --- |
| Runtime | Exact Electron release for Windows x64, its dependencies and upstream notices | Obtain official bytes through validated mirrors; cache/reuse by version, platform, architecture and digest |
| VUA host | Main/preload, host UI, shared services, host Provider, native installer/launcher helper and notices | Embed in NSIS; host upgrades retain a compatible verified runtime |
| AMF | Module UI/assets, AMF Provider and module-owned runtime resources, Bridge payloads where distributed, module notices | Embed a full baseline in NSIS; subsequently apply an independent file-based incremental update |

BDL databases, material files, Recipes, projects, task history and browser/account profiles are
user data, never release-package members or mirror content. Their current locations and ownership
remain defined by [module architecture](../architecture/modules.md#data-and-migration).

The existing AMF executable/process extraction is a starting point. Its UI still belongs to
the host renderer build, and BOOTH/native-browser transport has host-owned interfaces. Complete
the distribution boundary for both UI and backend; replacing only the executable does not
deliver independently updatable AMF behavior.

Use a narrow first-party module entry and versioned host services through the typed Gateway.
Shared React/UI dependencies need an explicit compatible binding so a module does not load a
second incompatible React runtime. The host retains navigation, account/browser transport and
update authority. BDL stays private to AMF. Shared Rust source libraries may remain build-time
dependencies; extracting every library is not a prerequisite for independent payload releases.

## 3. Installation and mirror selection

1. NSIS checks Windows/architecture, target directory, required staging space and running VUA
   processes. Default to a per-user installation; explain any actual elevation requirement.
2. Inspect VUA's runtime inventory. Reuse only the required version after completeness/integrity
   checks; directory presence or an executable name alone is insufficient.
3. If acquisition is needed, probe a small allowlist of HTTPS mirrors for the **exact archive**.
   Use bounded connection/sample-download observations rather than ICMP Ping or a mirror homepage.
   Bound concurrency, time and probe bytes, then choose a usable source by the observed response.
   No usage-region identification, third-party accelerator advice or account is required.
4. Download with visible byte progress, cancellation and supported resumption. A source failure
   tries the next validated source. Resume across mirrors only when object identity and offsets
   can be established; otherwise restart that download safely. Cache the verified result.
5. Validate the archive against trusted installer/release metadata sourced from the official
   Electron artifact. Do not obtain both an untrusted payload and its sole expected checksum
   from the same mirror. Reject incomplete content, invalid digests, unsafe archive paths and
   unexpected runtime layouts. Preserve upstream notices.
6. Stage runtime, host and bundled AMF, bind the compatible versions and activate only after all
   required files are verified. Start the installed build and report a failed first start honestly.
   Cancelling or failed acquisition leaves an existing installation usable.

Mirror addresses and redirects belong to a controlled release inventory. Official GitHub may
be one source, but installation must work when GitHub is unavailable. The official Electron
documentation lists npmmirror as a possible China mirror; availability of each selected release
still needs verification. A mirror is a transport for official bytes, not the authority to
choose a newer runtime version.

Build NSIS with the maintained electron-builder/NSIS tooling plus a scoped include and a native
Rust acquisition/activation helper as needed. The helper must run before Electron is present.
Stock `nsis-web` downloads an architecture-specific application package; it does not by itself
fetch a separate mirrored Electron runtime or provide independent AMF updates.

The first technical slice must verify the installed layout and launch strategy, including
`app.isPackaged`, resource lookup, icons, application identity, fuses/integrity requirements and
signing. Preserve production-only startup guards; a separately acquired runtime must not enable
development URL or executable overrides. Keep upstream runtime bytes verifiable. Any VUA branding
or signing changes to an executable need their own generated artifact identity.

If all mirrors fail, offer an understandable retry/source or offline-package path. The offline
NSIS/package uses the same versions and verification rules, without requiring an online update
feed to complete first installation. No machine reboot is performed automatically.

## 4. AMF version, incremental update and activation

AMF has an independent release version/build identity, with explicit host, protocol, Bridge and
stored-format compatibility. The [version policy](../release/versioning.md#what-is-independently-versioned)
owns version semantics. Installation embeds one known compatible host/AMF pair; updating one
does not silently imply that the other must change.

Define new versioned release-manifest, installed-payload and update-operation contracts before
implementation. Include component/version/build, source identity, platform/architecture,
compatibility, complete target file set, lengths/digests, download locations and signature
verification. Add schemas, positive/negative vectors and producer/consumer tests. Existing frozen
Gateway/storage faces remain unchanged; the existing AMF enable/data-layout registration is
not silently repurposed as an update manifest.

The in-app flow is:

1. **Check:** read a trusted release manifest through a usable feed, without a mandatory GitHub
   API call. Report VUA and AMF versions separately. Reject an incompatible AMF and explain the
   required host update. Failure to check does not block startup or play.
2. **Plan:** compare the complete target file manifest with the active installed version. Reuse
   only files with matching verified digests; show the actual bytes needed and any data migration.
   An AMF-only update must not select a host or runtime download implicitly.
3. **Download:** acquire changed/missing files into staging with progress/cancel/retry. Identify
   released file objects by content digest, keeping full-package fallback available. Verify
   complete target contents before activation; removed release files disappear from the new
   payload only, never from user data.
4. **Wait:** download may finish while AMF is in use, but activation respects the existing
   active-task, in-flight mutation, catalog-sync and pending-download admission gates. Do not
   force-close work. The user can finish/cancel it or apply at a later restart.
5. **Activate:** retain the previous immutable payload, atomically select the new verified version
   at a safe startup boundary, then run provider/UI compatibility and readiness checks. The first
   implementation applies at the next VUA start; hot replacement is unnecessary.
6. **Recover:** interrupted staging does not replace the active version. After a restart, inspect
   the recorded operation and require an explicit retry/continue decision. An incompatible or
   failed module leaves the host and play usable with an actionable AMF state.

Back up/migrate only the affected records when a supported stored-format change requires it.
Code rollback is available while the retained payload remains compatible with the data. After an
incompatible data migration, use the recorded backup/repair procedure rather than blindly opening
the migrated BDL with old code. Do not copy or upload a paid material library for update recovery.

Install payloads in versioned VUA-owned locations separate from data; adapt runtime/resource
resolution accordingly. Installing an update never changes the saved enabled flag, including
when AMF is currently disabled. Uninstall removes owned program files and runtime/cache as
appropriate while retaining user data by default. Retain the active and one recoverable payload
until activation is confirmed; clean only unreferenced owned versions, never a running payload.

## 5. Release sources and bandwidth

Build each payload once. Mirrors serve the same immutable bytes and signed release identity.
Use PH-R.COM as the authorized download/feed entrance; large objects can live on validated mirrors
or object storage/CDN. GitHub retains the official build/release record and an alternative source.
Gitee or another host is optional after attachment limits, anonymous download, redirects and
range/resumption behavior are checked. The [official hosting procedure](../release/official-hosting.md)
records the static HTTPS paths, publication allowlist, range/caching requirements and current
v0.6.7 mirror. Further object storage/CDN or hosting-budget changes remain undecided.

Upload immutable payloads and notices first, verify accessible sources, and publish the release
manifest last. Installation and AMF checking must not depend solely on GitHub reachability.
Keep published artifacts immutable and do not place publishing keys in a client or repository.
Actual public publishing and signing/identity attestations follow the author's release decision.

Record separate measurements for installer bytes, first-install bytes per source, reused-runtime
bytes, AMF full/delta bytes and retained staging/cache disk use. A small installer transfers the
runtime download to its source; it does not remove those bytes from the user's first installation.
Do not advertise a saving percentage before measuring the actual artifacts and changes.

## 6. Sequential implementation slices

Code now covers D1–D5; controlled local Windows checks cover online/offline installation,
real-provider/AMF-page startup, verified runtime reuse, unchanged-host AMF payload activation
and compatible rollback, plus uninstall/profile retention. Synthetic file-range, fallback,
cancellation and trust/compatibility checks supplement these. GitHub v0.6.7 publication and its
byte-identical PH-R.COM mirror are available. The new helper's authenticated check passed with
GitHub denied only to the test process; published v0.6.7 clients still require a subsequent host
installer to acquire that helper. Future component metadata includes official/GitHub sources.
Clean-machine installation, a newer publicly delivered AMF object update with GitHub unavailable,
physical scenarios and four-language human rows remain distinct and pending.

Use ordinary `slice/*` branches/PRs in sequence; no parallel writers or
collaboration bootstrap is authorized by this plan. Existing accepted checks remain in force.

| Order | Deliverable | Completion evidence |
| --- | --- | --- |
| D1 — release and launch boundary | Define versioned metadata, compatible unit layout, mirror inventory/trust and native launch strategy; prototype NSIS acquisition with a labelled local server | Complete Electron plus a host payload starts with correct identity/resource paths and production guards; metadata producers/consumers reject bad digest/layout/compatibility |
| D2 — complete AMF payload | Separate AMF UI/assets and native payload; define narrow host entry/services and release its own inventory | Updating AMF UI and backend changes behavior on an unchanged host build; host startup/play and disabled/failed AMF remain usable; shared dependency/contract bindings are checked |
| D3 — online/offline NSIS | Embed host and AMF; acquire/reuse exact Electron from bounded automatic mirror selection; implement retry/cancel, staging and offline input | Fresh Windows without Node/developer files installs/starts; blocked GitHub, failed/slow sources, incomplete cache and cancellation have usable outcomes; notices match the actual payload |
| D4 — in-app AMF incremental update | Separate version/check UI, target-file comparison, changed-file download, lifecycle gating, staged activation and retained previous version | Two named compatible AMF builds update on one unchanged host; observed downloads exclude unchanged files and all Electron bytes; busy/restart/failure/data cases below pass |
| D5 — host upgrade, repair and removal | Run component-aware NSIS host upgrades; retain verified compatible runtime and settings; implement owned-file repair/removal | Host-only upgrade downloads zero runtime bytes; missing/corrupt runtime is repaired; explicit AMF choices and data survive; uninstall leaves data and independently installed software intact |
| D6 — publication and exact-build regression | CI builds NSIS/offline/module artifacts, manifests and notices; exercise source publication and the integrated user journey | Record exact builds, sources, bytes, signatures and known issues; human installation/update review and actual Windows installation evidence supplement controlled checks |

D1 settles packaging/launch feasibility before committing to a stable layout. D2 is required for
the full AMF independent-update claim. D3 and D4 are the usable paths; D5 covers the same paths'
upgrade/removal behavior. D6 does not declare pending physical play or AMF material outcomes passed.

## 7. Acceptance matrix

| Case | Required result |
| --- | --- |
| Fresh online install | One NSIS entry obtains runtime and installs both host/AMF; fresh AMF is enabled; no developer command or manual component assembly |
| GitHub unavailable | A validated alternative supplies the exact runtime; installation and AMF update checking still work |
| All mirrors fail/offline | Clear retry/offline-package path; no partial active install or damaged existing version |
| Runtime reuse | Named verified version is reused; network observations show zero runtime payload bytes on unchanged-runtime upgrades |
| Wrong/missing/partial runtime | Version and content checks detect it; repair/reacquisition is explicit and complete |
| AMF UI-only and backend changes | Independently built compatible payloads load on the same host; only changed/missing file objects are downloaded |
| AMF incompatible with host | No activation; explain the compatible host requirement; current host/play remain usable |
| Bad feed, payload or path | Reject invalid signature/digest, unexpected file or unsafe extraction/activation destination; retain the active version |
| Cancel/network drop/low disk | Retain the active host/module and verified reusable cache; show actual recovery options and required space |
| Exit/restart during staging or activation | Inspect operation state and active pointer before explicit continuation; never automatically replay a mutation |
| Busy AMF | Download can stage; activation waits for existing lifecycle admission, without killing tasks or downloads |
| Data migration/rollback | Preserve identifiers and retained records; verify supported migration and compatible rollback or an explicit repair path |
| Disabled/legacy AMF and uninstall | Preserve enabled choices, legacy data layout, BOOTH profile and user-owned material/project files |
| End-user UI | Four-language installer/update guidance is readable; actual progress, source fallback and next action are understandable under the Ibis newcomer criterion |

Use synthetic feeds/material records and isolated profiles in repository/CI checks. Keep actual
machine inventories, credentials, logs and private evidence local. Run first-install/reuse on
a suitable clean Windows environment when available; lack of a clean test machine remains an
evidence gap rather than a passed baseline. No BIOS/Sandbox change or workstation uninstall is
authorized by this planning request. The author can supply the later test environment.

## 8. Implementation questions and follow-up

- D1 chooses the exact native-launch/NSIS layout and signing strategy from an executable spike;
  stock tooling alone has not demonstrated this component split.
- Final hosting endpoints, mirror terms/availability, budget and signing-key custody need concrete
  release configuration. Prepare artifacts and tests before requesting publication-specific input.
- Initially use file-level AMF incremental delivery. Consider chunk/binary delta only if measured
  changed-file sizes justify it; always retain a verified full-file/package fallback.
- Host-wide differential download, cross-application runtime sharing, automatic module hot swap
  and a generic plugin update platform are outside the first delivery.

## Technical references

- [Electron binary mirrors and caches](https://www.electronjs.org/docs/latest/tutorial/installation#custom-mirrors-and-caches)
- [Electron application packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution#manual-packaging)
- [electron-builder v26 NSIS and web installer](https://www.electron.build/v26/docs/nsis/)
- [electron-builder v26 automatic updates and generic HTTPS](https://www.electron.build/v26/docs/features/auto-update/)

These describe available mechanisms, not a working VUA installer or updater. Validate behavior
against the dependency version selected by the implementation slice.

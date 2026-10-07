# Third-party notices

VUA includes or depends on third-party software. Those components remain subject to their own
licenses; the repository's Apache-2.0 license does not replace them.

## Current source dependencies

The desktop runtime uses Electron (MIT, with separate Chromium/Node notices), React/React DOM
(MIT) and Three.js (MIT). Windows previews retain the runtime's shipped license files and VUA's
license/notice summary. The lockfile pins their exact versions; a public build needs the complete
transitive inventory under the distribution rule below.

`electron-builder` 26.15.3 (MIT) is a build-only dependency owned by the desktop packaging scripts.
It packages the compiled app and Provider into a Windows ZIP and does not run on user machines.
It can be removed by replacing those scripts while preserving the standalone bootstrap checks.
Its Squirrel.Windows helper build script is disabled because this project targets ZIP first.

The deployer's website-test cards inline brand glyph paths from
[Simple Icons](https://github.com/simple-icons/simple-icons) (CC0; paths extracted 2026-10-07)
for VRChat, Steam and GitHub. The VRChat, Steam and GitHub names and logos are trademarks of
their respective owners; the glyphs identify the services being tested and imply no affiliation
with or endorsement by them.

The current Rust workspace directly declares the following third-party crates:

| Dependency | Declared license family | Role |
| --- | --- | --- |
| `vrc-get-vpm` | MIT | VRChat package and project operations |
| `tokio` | MIT | asynchronous runtime |
| `reqwest` | MIT OR Apache-2.0 | HTTP client |
| `rusqlite` | MIT | Orchestrator authoritative-task SQLite adapter |
| `serde`, `serde_json` | MIT OR Apache-2.0 | serialization |
| `sha2` | MIT OR Apache-2.0 | content hashing |
| `scraper` | ISC | HTML parsing for BOOTH page extraction |
| `url` | MIT OR Apache-2.0 | VPM repository URL parsing |
| `flate2`, `tar` | MIT OR Apache-2.0 | gzip/tar archive handling for `.unitypackage` materials |
| `zip` | MIT | zip archive writing for local VPM artifacts |
| `md-5` | MIT OR Apache-2.0 | official Unity Editor manifest checksum comparison |
| `windows-sys` | MIT OR Apache-2.0 | Windows Job Object process-tree supervision, Win32 window enumeration and focus for editor handoff, and native installer elevation |
| `jsonschema` | MIT | schema validation in tests |

`rusqlite` enables its `bundled` feature and statically builds SQLite, which is in the public domain.
The Orchestrator persistence adapter owns this dependency. It may be removed only by a replacement
that passes the same database-format, transaction, durability, and recovery characterization tests.

The Unity Bridge package declares VRChat Avatars SDK and Modular Avatar as Unity package
dependencies. They are resolved from their own package sources and are not relicensed by VUA.

This is a human-readable summary, not a complete generated bill of materials. `Cargo.lock`, Unity
package manifests, and `pnpm-lock.yaml` are the authoritative dependency snapshots.
Transitive dependencies currently include multiple permissive licenses and components under
licenses such as MPL-2.0, Unicode-3.0, Zlib, and CDLA-Permissive-2.0.

## Official Unity tools (N1)

Unity CLI is acquired from Unity and looks up the target release. Unity's official Editor
download route is tried first in every region; the actual downloaded f1/c1 edition is inspected.
[NoUnityCN](https://www.nounitycn.top/) is an optional backup index used after official download
failure. Disabled mirrors leave only official sources; failed installation alternatives offer
a Unity Hub handoff.
NoUnityCN's website source is [MIT-licensed](https://github.com/DanKE123abc/NoUnityCN/blob/main/LICENSE);
VUA's adapter uses its download page and does not bundle its website code. Unity CLI and Editor
are proprietary Unity offerings governed by [Unity terms](https://unity.com/legal/terms-of-service)
and [Editor software terms](https://unity.com/legal/editor-terms-of-service/software), not VUA’s
Apache-2.0 license. VUA does not bundle or mirror these tools or grant a Unity license. Users
complete authorization, license selection and agreement acceptance through Unity’s own tooling.
The [deployment direction](docs/architecture/unity-deployment.md) specifies acquisition, native
installation and official CLI registration. Unity Hub is optional.

## Optional external integrations (N2)

The planned N2 adapters discover and launch independently installed applications through a shared
Steam connection; the two tracking tools also receive hardware/setup guidance.
These applications and their dependencies are not bundled with VUA under this delivery model. Users
obtain official distributions from Steam or upstream; those distributions retain their own terms.
This describes the selected integration model, not completed runtime acceptance. The tracking
license references below were checked on 2026-09-30; the additional official distribution entries
were checked on 2026-10-03. They are moving references, not release pins.

| Application | Upstream license / attribution | Planned VUA connection |
| --- | --- | --- |
| [VRCFaceTracking](https://github.com/benaclejames/VRCFaceTracking) | [Apache-2.0](https://github.com/benaclejames/VRCFaceTracking/blob/master/LICENSE); copyright 2024 benaclejames | Discover, guide official installation, launch, and explain hardware-module/OSC setup; no source or binary redistribution |
| [hyblocker/OpenVR-SpaceCalibrator](https://github.com/hyblocker/OpenVR-SpaceCalibrator) | [MIT core with separately licensed third-party components](https://github.com/hyblocker/OpenVR-SpaceCalibrator/blob/develop/LICENSE); copyright 2023–2026 Hyblocker and contributors, 2020–2022 Justin Li and contributors | Discover, guide official installation, launch, and explain device selection/calibration in the upstream UI; no modified build or bundled driver |

The following connections use the same official Steam purchase/install and external-launch path.
Their distributions retain their own upstream terms, license notices and dependency inventories;
VUA does not copy their source or binaries. Paid/free availability is separate from source licensing.

| Application / official distribution | VUA connection |
| --- | --- |
| [OVR Overlay Translator](https://store.steampowered.com/app/4304620/) | Discover and launch the paid VR translation application; configuration and translation remain upstream |
| [OVR Advanced Settings](https://store.steampowered.com/app/1009850/) | Discover and launch the paid Steam distribution of the VR settings utility |
| [OVR Toolkit](https://store.steampowered.com/app/1068820/) | Discover and launch the paid desktop-overlay application |
| [OyasumiVR](https://store.steampowered.com/app/2538150/) | Discover and launch the free VR sleep utility; its account/automation settings remain upstream |
| [LIV](https://store.steampowered.com/app/755540/) | Discover and launch the free Steam base application for capture/streaming; no LIV SDK integration into VRChat |

VUA guides users to add these applications to their Steam library, install them through Steam,
and launch their independent installations through supported external entry points. Upstream
applications retain their own features, dependencies and license inventories; Space Calibrator's
full distribution has terms beyond its MIT core. Those terms are distinct from VUA's Apache-2.0.

If a later VUA release incorporates, modifies or redistributes source/binaries from either tool,
review the exact version and all included dependencies before release; preserve applicable license,
copyright, attribution/NOTICE and modification notices. External connection alone is not permission
to redistribute.

## Distribution rule

Before a binary release, the project must generate and review a complete dependency and license
inventory for that exact build, preserve all required license and attribution texts, and separately
approve every bundled third-party binary. Support for connecting to externally installed software
does not imply permission to redistribute it.

If this summary conflicts with a dependency's license text, the dependency's license text controls.

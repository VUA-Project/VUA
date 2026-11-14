# Third-party notices

VUA includes or depends on third-party software. Those components remain subject to their own
licenses; the repository's Apache-2.0 license does not replace them.

## Current source dependencies

Tool icons are fetched at runtime and cached locally, rather than bundled. VRCS uses
the unmodified [Dreaminko/VRCS GitHub icon](https://github.com/Dreaminko/VRCS/blob/a7fa889dfa94c11398850eeb42765ca82b8cea82/apps/desktop/src-tauri/icons/128x128.png)
from its AGPL-3.0 repository. Names and marks identify the external tools and remain
with their respective owners.

The desktop runtime uses Electron (MIT, with separate Chromium/Node notices), React/React DOM
(MIT), Three.js (MIT) and the official MCP TypeScript SDK packages `@modelcontextprotocol/server`
and `@modelcontextprotocol/node` (Apache-2.0) for the local agent adapter;
`@modelcontextprotocol/client` (Apache-2.0) is used only by tests. Windows previews retain the runtime's shipped license files and VUA's
license/notice summary. The lockfile pins their exact versions; a public build needs the complete
transitive inventory under the distribution rule below.

The v0.6.6 Ibis ZIP includes `resources/notices/build/dependency-inventory.json`, generated
from its lockfiles, Windows provider graph and runtime dependencies. It records source/build
identity and executable hashes, and includes original dependency notices, the matching Rust
standard-library notices and unmodified MPL source packages. Build-only Cargo dependencies
are identified in the inventory's scope rather than presented as separate runtime programs.
Electron's shipped Chromium/Node notices remain alongside the runtime. Supplemental texts and
their exact source treatment are documented in [packaging license provenance](apps/desktop/packaging/licenses/README.md).

`electron-builder` 26.15.3 (MIT) is a build-only dependency owned by the desktop packaging scripts.
It packages the compiled app and Provider into a Windows ZIP and does not run on user machines.
It can be removed by replacing those scripts while preserving the standalone bootstrap checks.
Its Squirrel.Windows helper build script is disabled because this project targets ZIP first.

The deployer's website-test cards inline brand glyph paths from
[Simple Icons](https://github.com/simple-icons/simple-icons) (CC0; paths extracted 2026-10-07)
for VRChat, Steam and GitHub. The VRChat, Steam and GitHub names and logos are trademarks of
their respective owners; the glyphs identify the services being tested and imply no affiliation
with or endorsement by them.

The VR headset choices also inline the Meta, HTC Vive and Valve glyph paths from
[Simple Icons at revision 98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d](https://github.com/simple-icons/simple-icons/tree/98820a4dc8c363ca72fa2c0d294ea4a0a9bba75d)
(CC0; extracted 2026-10-09). The PICO wordmark was supplied by the project author
on 2026-10-09 and is separate from the CC0 glyph collection. All of these names and
logos remain trademarks of their respective owners and identify device choices.

The current Rust workspace directly declares the following third-party crates:

| Dependency | Declared license family | Role |
| --- | --- | --- |
| `image` 0.25.10 | MIT OR Apache-2.0 | bounded PNG/JPEG/GIF/WebP image decoding and PNG/JPEG encoding |
| `datamatrix` 0.3.3 | Apache-2.0 OR MIT | ECC200 rectangular Data Matrix encoder |
| `rxing` 0.9.3 | Apache-2.0 | Data Matrix detection and error-correcting decoding (image feature disabled) |
| `gif` 0.14.2 | MIT OR Apache-2.0 | bounded palette-preserving animated GIF encoding |
| `color_quant` 1.1.0 | MIT | adaptive GIF foreground palette; reserved carrier colors remain exact |
| `vrc-get-vpm` | MIT | VRChat package and project operations |
| `tokio` | MIT | asynchronous runtime |
| `reqwest` | MIT OR Apache-2.0 | HTTP client |
| `rusqlite` | MIT | Orchestrator authoritative-task SQLite adapter |
| `serde`, `serde_json` | MIT OR Apache-2.0 | serialization |
| `sha2` | MIT OR Apache-2.0 | content hashing |
| `scraper` | ISC | HTML parsing for BOOTH page extraction |
| `url` | MIT OR Apache-2.0 | VPM repository and public terms URL parsing |
| `pdf-extract` 0.12.1 | MIT | Pure Rust text extraction from locally cached VN3 PDFs; uses the bounded parser in `lopdf` 0.42.0 |
| `regex` | MIT OR Apache-2.0 | Versioned VN3 document structure recognition |
| `unicode-normalization` | MIT OR Apache-2.0 | VN3 typography normalization with preserved source fragments |
| `flate2`, `tar` | MIT OR Apache-2.0 | gzip/tar archive handling for `.unitypackage` materials |
| `zip` 9.0.5 | MIT | ZIP inspection and bounded extraction, runtime acquisition and local VPM artifact writing |
| `md-5` | MIT OR Apache-2.0 | official Unity Editor manifest checksum comparison |
| `windows-sys` | MIT OR Apache-2.0 | Windows Job Object process-tree supervision, Win32 window enumeration and focus for editor handoff, and native installer elevation |
| `windows` | MIT OR Apache-2.0 | Read-only desktop resource adapter: language-neutral PDH utilization, DXGI hardware identity/capacity and D3D12 UMA classification |
| `jsonschema` | MIT | schema validation in tests |

`rusqlite` enables its `bundled` feature and statically builds SQLite, which is in the public domain.
The Orchestrator persistence adapter owns this dependency. It may be removed only by a replacement
that passes the same database-format, transaction, durability, and recovery characterization tests.

AMF acquisition owns `pdf-extract`, `regex` and `unicode-normalization` for its versioned VN3
parser. `pdf-extract` reexports the MIT-licensed `lopdf` document model and reads PDF text
without an external executable. These dependencies can be removed by replacing the local
extraction/parser implementation while preserving its synthetic PDF, wording and unknown-evidence
tests. Their exact transitive versions and license notices are captured by the distribution inventory.
The PDF dependency graph includes manifest-only license declarations for `adobe-cmap-parser`,
`enum-map`, `enum-map-derive`, `pdf-extract` and `type1-encoding-parser`. Their pinned supplemental
MIT texts, original declarations and unmodified published sources follow the
[supplemental provenance](apps/desktop/packaging/licenses/README.md) records.

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

## Optional external integrations (N2 and creator tools)

The N2 and creator-tool adapters discover and launch independently installed applications through
Steam, verified official installers, or local creator-manager locations. None of these applications
or their Unity VPM packages are bundled inside VUA's installer or repository; users obtain official
distributions from Steam, GitHub releases, or upstream VPM feeds, and those distributions retain
their own terms. License references below were checked through 2026-11-14 as moving upstream
references rather than vendored release pins.

| Application | Upstream license / attribution | VUA connection |
| --- | --- | --- |
| [VRCFaceTracking](https://github.com/benaclejames/VRCFaceTracking) | [Apache-2.0](https://github.com/benaclejames/VRCFaceTracking/blob/master/LICENSE); copyright 2024 benaclejames | Discover, guide official Steam installation, launch, and explain hardware-module/OSC setup; no source or binary redistribution |
| [hyblocker/OpenVR-SpaceCalibrator](https://github.com/hyblocker/OpenVR-SpaceCalibrator) | [MIT core with separately licensed third-party components](https://github.com/hyblocker/OpenVR-SpaceCalibrator/blob/develop/LICENSE); copyright 2023–2026 Hyblocker and contributors, 2020–2022 Justin Li and contributors | Discover, guide official Steam installation, launch, and explain device selection/calibration in the upstream UI; no modified build or bundled driver |
| [Desktop+](https://github.com/elvissteinjr/DesktopPlus) | [GPL-3.0](https://github.com/elvissteinjr/DesktopPlus/blob/master/LICENSE); copyright elvissteinjr | Out-of-process Steam discovery and launch (`external-tool v0.4`); no linked code or binary redistribution |
| [SlimeVR Server](https://github.com/SlimeVR/SlimeVR-Server) | [MIT OR Apache-2.0](https://github.com/SlimeVR/SlimeVR-Server/blob/main/LICENSE-MIT); installer [MIT](https://github.com/SlimeVR/SlimeVR-Installer/blob/main/LICENSE) | Official-installer download/verification (`environment-deployment v0.1`) and out-of-process launch/stop (`installer-tool v0.1`) |
| [VRCT](https://github.com/misyaguziya/VRCT) | [MIT](https://github.com/misyaguziya/VRCT/blob/main/LICENSE) (excluding upstream's proprietary 3D chat-bubble model asset) | Official GitHub release installer download/verification and out-of-process launch/stop; no asset extraction or bundling |
| [VRCX](https://github.com/vrcx-team/VRCX) | [MIT](https://github.com/vrcx-team/VRCX/blob/master/LICENSE); copyright VRCX contributors | Official GitHub release installer download/verification and out-of-process launch/stop; VRCX retains its own sign-in |
| [VRCS](https://github.com/Dreaminko/VRCS) | [AGPL-3.0](https://github.com/Dreaminko/VRCS/blob/main/LICENSE) | Out-of-process official release installer download/verification and detached launch/stop (`installer-tool v0.1`); no code linking, modification, or network-service hosting |
| [ALCOM (`vrc-get`)](https://github.com/vrc-get/vrc-get) | [MIT](https://github.com/vrc-get/vrc-get/blob/master/LICENSE); copyright anatawa12 and contributors | Local presence detection and zero-argument breakaway launch (`manager-apps v0.2`); external projects remain read-only |

The following connections use official Steam store/launch handoffs or official creator distributions.
Their distributions retain their own upstream terms, license notices and dependency inventories;
VUA does not copy their source or binaries. Paid/free availability is separate from source licensing.

| Application / official distribution | VUA connection |
| --- | --- |
| [OVR Overlay Translator](https://store.steampowered.com/app/4304620/) | Discover and launch the paid VR translation application; configuration and translation remain upstream |
| [OVR Advanced Settings](https://store.steampowered.com/app/1009850/) | Discover and launch the paid Steam distribution of the VR settings utility |
| [OVR Toolkit](https://store.steampowered.com/app/1068820/) | Discover and launch the paid desktop-overlay application |
| [OyasumiVR](https://store.steampowered.com/app/2538150/) | Discover and launch the free VR sleep utility; its account/automation settings remain upstream |
| [fpsVR](https://store.steampowered.com/app/908520/) | Discover and launch the paid Steam VR performance monitor (`external-tool v0.4`) |
| [ChilloutVR](https://store.steampowered.com/app/661130/) / [Reborn](https://store.steampowered.com/app/2522420/) | Optional social VR platform entries via official Steam install/launch handoffs |
| [LIV](https://store.steampowered.com/app/755540/) | Planned free Steam base application card for capture/streaming; no LIV SDK integration into VRChat |
| [VRChat Creator Companion (VCC)](https://vrchat.com/home/download) | Local presence detection and zero-argument breakaway launch (`manager-apps v0.2`); external projects remain read-only |

AMF package management and isolated work-project preparation also resolve unbundled upstream Unity
VPM packages directly from their official feeds when requested by materials, explicit player opt-in,
or saved Recipes (full table and license URLs in [docs/development/known-packages.md](docs/development/known-packages.md)):
`Modular Avatar` (MIT), `NDMF` (MIT), `AAO: Avatar Optimizer` (MIT), `lilycalInventory` (MIT),
`lilAvatarUtils` (MIT), `lilNDMFMeshSimplifier` (MIT), `TexTransTool` (MIT), `FaceEmo` (MIT),
`ComboGestureExpressions` (MIT), `FloorAdjuster` (Zlib), `VRCQuestTools` (MIT), `lilToon` (MIT),
`Poiyomi Toon Shader` (MIT), `UnlitWF Shader` (Zlib), `VRM Converter for VRChat` (MPL-2.0, guide-only),
and `UniVRM` (MIT, guide-only). VUA redistributes none of these VPM archives.

If a later VUA release incorporates, modifies or redistributes source/binaries from any external tool,
review the exact version and all included dependencies before release; preserve applicable license,
copyright, attribution/NOTICE and modification notices. External connection alone is not permission
to redistribute.

## Bundled theme fonts

The Tenshi Kaiwai and Jirai Kei themes bundle subsets of two title fonts under the SIL Open Font
License, Version 1.1. Each subset keeps the font's copyright and license records in its name table,
and the license file sits beside it under `packages/design-system/skins/<theme>/fonts/`.
`packages/design-system/skins/make-fonts.mjs` makes the subsets from the recorded sources with
`subset-font` (BSD-3-Clause, build only). The subsets are Modified Versions under the license and
do not use any Reserved Font Name.

- **Resource Han Rounded CN Medium**, v0.990, from
  [CyanoHao/Resource-Han-Rounded](https://github.com/CyanoHao/Resource-Han-Rounded/releases/tag/v0.990).
  Copyright 2018–2019 Cyano Hao. Copyright 2014, 2015, 2018 Adobe (http://www.adobe.com/), with
  Reserved Font Name 'Source'. Source is a trademark of Adobe in the United States and/or other
  countries.
- **ZCOOL KuaiLe** Regular, from
  [google/fonts](https://github.com/google/fonts/tree/main/ofl/zcoolkuaile). Copyright 2018 The ZCOOL
  KuaiLe Project Authors (https://github.com/googlefonts/zcool-kuaile).

The Frutiger Aero theme names Windows' own Segoe UI, Microsoft YaHei UI, Meiryo UI and Malgun
Gothic; VUA uses them as installed and does not ship them.

<details>
<summary>SIL Open Font License, Version 1.1</summary>

```text
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

</details>

## Distribution rule

Before a binary release, the project must generate and review a complete dependency and license
inventory for that exact build, preserve all required license and attribution texts, and separately
approve every bundled third-party binary. Support for connecting to externally installed software
does not imply permission to redistribute it.

If this summary conflicts with a dependency's license text, the dependency's license text controls.

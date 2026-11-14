# Known packages

> Updated: 2026-11-14

AMF production resolves the shaders its selected materials need through one known-package
table. The table lives in `crates/provider-host/src/known_packages.rs`; this document records
the evidence behind each entry. The wire behavior and the `amf.package.guide` diagnostic are
owned by the [AMF production protocol](../protocols/amf-production-v0.1.md).

## Table

| Package | ID | Official VPM feed | License (source) | Checked | Delivery | Detection signals |
| --- | --- | --- | --- | --- | --- | --- |
| lilToon | `jp.lilxyzw.liltoon` | https://lilxyzw.github.io/vpm-repos/vpm.json | [MIT](https://github.com/lilxyzw/lilToon/blob/master/LICENSE) | 2026-10-18 | `auto` | `_lilToonVersion` material property |
| Poiyomi Toon Shader | `com.poiyomi.toon` | https://poiyomi.github.io/vpm/index.json | [MIT](https://github.com/poiyomi/PoiyomiToonShader/blob/master/LICENSE.txt) | 2026-10-18 | `auto` | 35 shader GUIDs grouped by version line (table below), plus the complete `.shader` sets of the two recorded releases 9.3.64 and 10.0.27 (42 and 20 GUIDs; read 2026-10-23) |
| Poiyomi Pro | `com.poiyomi.pro` | https://poiyomi.github.io/vpm/index.json | Proprietary/EULA ([official site](https://www.poiyomi.com/)) | 2026-10-18 | `guide` | No material signal yet; reading the Pro shader GUIDs needs a licensed copy |
| UnlitWF Shader | `jp.whiteflare.unlitwf` | https://whiteflare.github.io/vpm-repos/vpm.json | [Zlib](https://github.com/whiteflare/Unlit_WF_ShaderSuite/blob/master/LICENSE) | 2026-10-18 | `auto` | 84 shader GUIDs read from `Runtime/Shaders/**.shader.meta` in 2.9.0; the newest 2.14.0 release carries exactly the same 84 GUIDs (checked 2026-10-19) |
| VRChat Toon Standard | `com.vrchat.base` | https://vrchat.github.io/packages/index.json | [VRChat SDK license](https://hello.vrchat.com/legal/sdk) | 2026-10-18 | `bundled` | `ToonStandard.shader` and `ToonStandardOutline.shader` GUIDs read from the official `com.vrchat.base` 3.10.5 package; the shader ships with SDK 3.8.1 and later |
| VRChat SDK - Avatars | `com.vrchat.avatars` | https://vrchat.github.io/packages/index.json | [VRChat SDK license](https://hello.vrchat.com/legal/sdk) | 2026-10-18 | `auto` | Installed during project creation, before any material signal is needed |
| Modular Avatar | `nadena.dev.modular-avatar` | https://vpm.nadena.dev/vpm.json | [MIT](https://github.com/bdunderscore/modular-avatar/blob/main/COPYING.md) | 2026-10-18 | `auto` | Installed during project creation, before any material signal is needed |
| Non-Destructive Modular Framework | `nadena.dev.ndmf` | https://vpm.nadena.dev/vpm.json | [MIT](https://github.com/bdunderscore/ndmf/blob/main/COPYING.md) | 2026-10-18 | `auto` | Arrives as Modular Avatar's dependency, before any material signal is needed |
| AAO: Avatar Optimizer | `com.anatawa12.avatar-optimizer` | https://vpm.anatawa12.com/vpm.json | [MIT](https://github.com/anatawa12/AvatarOptimizer/blob/v1.9.21/LICENSE) | 2026-11-11 | `auto` | Explicit player opt-in (`amf.production.setOptimizer`) or Recipe `0.6` reproduction; pinned to `1.9.21`, never installed from material signals |
| LilyCalInventory | `jp.lilxyzw.lilycalinventory` | https://lilxyzw.github.io/vpm-repos/vpm.json | [MIT](https://github.com/lilxyzw/LilyCalInventory/blob/main/LICENSE) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; never installed heuristically from material names |
| lilAvatarUtils | `jp.lilxyzw.avatar-utils` | https://lilxyzw.github.io/vpm-repos/vpm.json | [MIT](https://github.com/lilxyzw/lilAvatarUtils/blob/master/LICENSE) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; Unity Editor inspection/lighting/texture utility |
| TexTransTool | `net.rs64.tex-trans-tool` | https://vpm.rs64.net/vpm.json | [MIT](https://github.com/ReinaS-64892/TexTransTool/blob/main/LICENSE) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; runs non-destructively on NDMF at build time |
| FaceEmo | `jp.suzuryg.face-emo` | https://suzuryg.github.io/vpm-repos/vpm.json | [MIT](https://github.com/suzuryg/face-emo/blob/main/LICENSE) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; non-destructive facial expression editor |
| FloorAdjuster | `net.narazaka.vrchat.floor-adjuster` | https://vpm.narazaka.net/index.json | [Zlib](https://github.com/Narazaka/FloorAdjuster/blob/master/LICENSE.txt) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; NDMF build-time avatar floor/viewpoint height alignment |
| VRCQuestTools | `com.github.kurotu.vrc-quest-tools` | https://kurotu.github.io/vpm-repos/vpm.json | [MIT](https://github.com/kurotu/VRCQuestTools/blob/master/LICENSE) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; NDMF PC-to-Android/Quest/PICO conversion toolkit |
| NDMF Mesh Simplifier | `jp.lilxyzw.ndmf-mesh-simplifier` | https://lilxyzw.github.io/vpm-repos/vpm.json | [MIT](https://github.com/lilxyzw/NDMFMeshSimplifier/blob/main/LICENSE) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; NDMF build-time polygon reduction |
| ComboGestureExpressions | `dev.hai-vr.cge` | https://hai-vr.github.io/vpm-listing/index.json | [MIT](https://github.com/hai-vr/combo-gesture-expressions-av3/blob/main/LICENSE) | 2026-11-14 | `auto` | Explicit VPM package addition or Recipe package pin; NDMF-compatible hand gesture expression editor |
| VRM Converter for VRChat | `jp.pokemori.vrm-converter-for-vrchat` | https://esperecyan.github.io/VRMConverterForVRChat/registry.json | [MIT](https://github.com/esperecyan/VRMConverterForVRChat/blob/master/LICENSE.txt) | 2026-11-14 | `guide` | Exact VPM package ID; guides players importing `.vrm` avatars toward the official converter workflow |
| UniVRM | `com.vrmc.vrm` | https://esperecyan.github.io/VRMConverterForVRChat/registry.json | [MIT](https://github.com/vrm-c/UniVRM/blob/master/LICENSE.txt) | 2026-11-14 | `guide` | Exact VPM package ID; guides creators working with VRM 1.0 / 0.x Unity packages alongside VRM Converter for VRChat |
| Jerry's VRCFT Templates | `adjerry91.vrcft.templates` | https://adjerry91.github.io/VRCFaceTracking-Templates/index.json | [MIT](https://github.com/Adjerry91/VRCFaceTracking-Templates/blob/main/LICENSE.md) | 2026-10-20 | `guide` | Exact VPM package ID; creator-bundled copies are preserved, with no shader or name heuristic installing anything |
| Pawlygon Face Tracking | `net.pawlygon.vrc-facetracking` | https://vcc.pawlygon.net/index.json | [MIT](https://github.com/PawlygonStudio/VRC-Facetracking/blob/main/LICENSE.md) | 2026-10-20 | `guide` | Exact VPM package ID; select a release compatible with the intended OSC/native-SDK route |
| VRCFury | `com.vrcfury.vrcfury` | https://vcc.vrcfury.com | [Source-available terms](https://github.com/VRCFury/VRCFury/blob/main/LICENSE.md), including direct end-user download restrictions | 2026-10-20 | `guide` | Exact VPM package ID; intake reports `hasVrcFury` per prefab from observed `VF.*`/VRCFury component names — an integration hint shown with the official-page guide, never proof of FT or of a working setup |

The existing `auto` spelling means installation from the official source. The first FT slice
keeps even MIT templates on `guide`: licensing permits a future pinned adapter, but template
version, renderer mapping and SDK compatibility still need review. These entries are identity
and delivery metadata, not shader detection rules; no template is installed or removed because
an Avatar happens to have a matching shape name. Follow the official pages above to obtain them.
MA and NDMF retain their existing installation path. VRCFT itself retains its separate
Steam/tool-page lifecycle; it is not an Avatar-side Unity dependency.

Marker properties win over the GUID table when a material is classified, so lilToon keeps its
historical rule. GUIDs are compared in lower case.

## Poiyomi version lines

Poiyomi keeps its shaders under `_PoiyomiShaders/Shaders/<line>/`, and every line uses
different GUIDs. Each line's GUIDs were read from that line's newest release package, only
from its own `_PoiyomiShaders/Shaders/<line>/**.shader.meta`. No GUID is shared between two
lines. A GUID shared by lines in a future table belongs to the newest line that carries it.

| Version line | Newest release read | Shader GUIDs |
| --- | --- | --- |
| 8.1 | 8.1.167 | 6 |
| 9.0 | 9.0.61 | 5 |
| 9.1 | 9.1.30 | 5 |
| 9.2 | 9.2.79 | 5 |
| 9.3 | 9.3.64 | 7 |
| 10.0 | 10.0.27 | 7 |

The line directories' GUID sets are stable: across every release on the feed that carries a
line, the line's own GUIDs are identical (all 55 releases read 2026-10-23).

## Recorded release sets

A Poiyomi release does not ship one line: every release up to 9.3.64 still carries all older
lines back to 7.3, and the 10.0 releases carry only the 9.3 and 10.0 lines. Each release also
ships shaders outside the line folders (`Shaders/Extras/…` and `Scripts/poi-tools/Resources/…`),
whose set differs between releases. A bundled copy inside a material package therefore holds
several version lines plus those utility shaders, and the line table alone cannot prove an
official release covers it.

The table records the complete `.shader` set of each release that preparation may pin when it
replaces a copy. Two releases cover every release the official feed has offered (all 55
packages downloaded from `https://poiyomi.github.io/vpm/index.json`, each `zipSHA256` verified,
every `.shader.meta` read; checked 2026-10-23):

| Recorded release | Complete shader set | Covers the sets of |
| --- | --- | --- |
| 9.3.64 | 42 GUIDs (7.3, 8.0, 8.1, 9.0, 9.1, 9.2, 9.3 lines, Extras, poi-tools) | every release 8.1.166 – 9.3.64 (47 packages) |
| 10.0.27 | 20 GUIDs (9.3, 10.0 lines, Extras, poi-tools) | every release 10.0.20 – 10.0.27 (8 packages) |

To refresh the data: download the newest release of every version line from the official VPM
feed into a separate temporary directory, verify each `zipSHA256` against the feed, read every
`_PoiyomiShaders/**.shader.meta`, and record each line's newest release's set. Keep a recorded
release while any newer release's set does not cover it; drop it once one does. Update the line
table, this section's evidence date and the counts in the same change. Keep package bodies out
of the repository.

When every material that needs Poiyomi points at one line and neither the selected sources
nor the project provides it, preparation reads the feed cache and installs that line's newest
stable release with an exact `PackageRequestV1.version` pin. A recorded set is only consulted
for bundled copies. Materials spanning several lines, or a project already carrying the
package, get no install; the `amf.package.guide` warning names the required lines. lilToon and
UnlitWF need no lines: lilToon's GUIDs are version-stable, and UnlitWF 2.14.0 covers every GUID
registered from 2.9.0.

## Delivery policies

- `auto`: both preparation (`import_sources`) and a line's material change (`replace_sources`)
  install from the official feed when a selected material needs the package, none of the
  selected sources provides that shader, the project's recorded `packageVersions` does not
  carry the package and no Recipe pin fixes it. Version-lined packages install their line's
  pinned release — or, when a recorded set replaces a bundled copy, that release's exact
  version; the others install the newest resolving release. Installation uses the
  existing digest-bound preview/apply path and reports progress under the package's display
  name; conflicts still need explicit handling, and a failed installation fails the step as
  before. Recipe-pinned known packages have their feeds registered during project creation.
- `guide`: preparation installs nothing. After Unity reports `facts.missingShaderMaterials`,
  each recognized `guide` package — and each recognized `auto` package whose needed version
  lines the project does not carry — adds one `amf.package.guide` warning with the package
  name, the number of affected materials, the needed version lines and the official page.
- `bundled`: the material is classified and nothing is installed; the SDK provides the shader.

## Legacy copies shipped inside materials

A material package often carries an older copy of the shader itself. The candidate locations
come from the feed cache's `legacyFolders`/`legacyFiles`, joined across the cached versions
and read without network access; when the cache has no declaration, the table's fallback
applies (`Assets\lilToon`, `Assets\_PoiyomiShaders`, `Assets\Unlit_WF_ShaderSuite`). Files of
`guide`, `bundled` and signal-less entries import unchanged.

lilToon keeps its historical rule: a bundled copy always leaves for the official package. For
the other `auto` packages, preparation reads every `.shader` GUID in the copy from the staged
`asset.meta` files and replaces the copy only when one recorded release set covers them all —
together with the shaders the selected materials reference and the package's shaders other
selected sources provide, so one verified official release serves the whole project. The
install pins that exact release version; the earliest covering release wins, the one closest
to the era the copy came from. In every other
case — an unknown GUID, a copy mixing lines no single release carries, a Poiyomi Pro copy, an
unreadable shader, or a project that already carries the package — the copy imports unchanged
and nothing is installed, exactly as before this table existed. Poiyomi's recorded sets let a
copy spanning several version lines leave too, because the release it came from shipped those
lines together.

## Adding an entry

1. Read the upstream license text and record its SPDX identifier (or `Proprietary/EULA`), the
   source URL and the check date. Choose `auto` only when the license permits delivery from the
   official feed; otherwise choose `guide`, or `bundled` for content the VRChat SDK provides.
2. Add detection signals from official files: a material property only this package writes, or
   the lower-case GUIDs of its shader `.meta` files. For a package whose shaders differ by
   release line, read each line's newest release package and record the line with its GUIDs;
   then record each covering release's complete `.shader` set as described in
   [Recorded release sets](#recorded-release-sets), because bundled copies hold several lines
   and the utility shaders. Download free official packages only into a separate temporary
   directory to read `package.json` and `.meta` files, and keep package bodies out of the
   repository. Note the package versions and paths the signals came from.
3. Copy the feed's `legacyFolders`/`legacyFiles` paths into the fallback fields so the skip
   rule also works before the first feed refresh.
4. Extend the table in `known_packages.rs` and cover the entry with synthetic fixture
   materials and fixture feed manifests; tests never access the network.
5. Update this table and the [AMF production protocol](../protocols/amf-production-v0.1.md).

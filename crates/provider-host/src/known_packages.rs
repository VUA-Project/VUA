//! The third-party packages AMF recognizes in selected materials, and how each
//! one is delivered. `docs/development/known-packages.md` records the license
//! evidence and shows how to add an entry.
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::Path,
};
use vua_orchestrator::{Diagnostic, DiagnosticSeverity};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Delivery {
    /// Preparation installs the package from its official feed when materials need it.
    Auto,
    /// Preparation never installs it; a diagnostic points at the official page.
    Guide,
    /// Ships with the VRChat SDK; materials are detected but nothing is installed.
    Bundled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LegacyPolicy {
    /// lilToon's historical rule: a bundled copy always leaves for the official package.
    ReplaceAlways,
    /// A bundled copy leaves only when the exact official release covers every shader GUID in it.
    ReplaceWhenCovered,
}

/// One upstream release line whose shader GUIDs differ from every other line.
pub(crate) struct VersionLine {
    /// The `major.minor` prefix shared by every release of this line.
    pub line: &'static str,
    /// Lower-case shader GUIDs read from this line's newest release package.
    pub shader_guids: &'static [&'static str],
}

/// One release whose complete `.shader` set the table records. A bundled copy
/// leaves for exactly this release — pinned through `PackageRequestV1.version`
/// — when the set covers every shader in it, so a copy never meets an official
/// release whose contents were not verified.
pub(crate) struct ReleaseSet {
    pub version: &'static str,
    /// Every `.shader` GUID the release carries: its own version lines, the
    /// older lines it still ships, and the utility shaders outside the line
    /// folders.
    pub shader_guids: &'static [&'static str],
}

pub(crate) struct KnownPackage {
    pub id: &'static str,
    pub display_name: &'static str,
    pub feed_url: &'static str,
    /// Where the player obtains the package; used by the `amf.package.guide` diagnostic.
    pub official_url: &'static str,
    /// License evidence is review data recorded alongside the table, not runtime input.
    #[allow(dead_code)]
    pub license: &'static str,
    #[allow(dead_code)]
    pub license_url: &'static str,
    /// Day the license text was read, as YYYY-MM-DD.
    #[allow(dead_code)]
    pub license_checked: &'static str,
    pub delivery: Delivery,
    /// Serialized material properties only this package writes.
    pub material_markers: &'static [&'static str],
    /// Lower-case shader GUIDs read from the official package's `.meta` files.
    pub shader_guids: &'static [&'static str],
    /// Release lines, oldest first; a GUID belongs to the newest line that carries it.
    pub version_lines: &'static [VersionLine],
    /// Recorded releases, oldest first; the earliest one covering a bundled copy
    /// replaces it, the release closest to the copy's own era. Empty for packages without version lines or without a
    /// recorded set, whose copies then always import unchanged.
    pub releases: &'static [ReleaseSet],
    pub legacy_policy: LegacyPolicy,
    /// Legacy install locations used when the cached feed declares none.
    pub legacy_folders: &'static [&'static str],
    pub legacy_files: &'static [&'static str],
}

impl KnownPackage {
    fn detects_materials(&self) -> bool {
        !self.material_markers.is_empty()
            || !self.shader_guids.is_empty()
            || !self.version_lines.is_empty()
    }

    fn contains_shader(&self, guid: &str) -> bool {
        self.shader_guids.contains(&guid)
            || self
                .version_lines
                .iter()
                .any(|line| line.shader_guids.contains(&guid))
    }

    /// The newest line carrying this GUID, so a GUID shared by several lines resolves
    /// to the release that still ships it.
    fn line_for_guid(&self, guid: &str) -> Option<&VersionLine> {
        self.version_lines
            .iter()
            .rev()
            .find(|line| line.shader_guids.contains(&guid))
    }

    fn line_for_version(&self, version: &str) -> Option<&'static str> {
        let line = version_line(version)?;
        self.version_lines
            .iter()
            .find(|candidate| candidate.line == line)
            .map(|candidate| candidate.line)
    }
}

pub(crate) const MODULAR_AVATAR_FEED: &str = "https://vpm.nadena.dev/vpm.json";
pub(crate) const AVATAR_OPTIMIZER_ID: &str = "com.anatawa12.avatar-optimizer";
pub(crate) const AVATAR_OPTIMIZER_PINNED_VERSION: &str = "1.9.21";
pub(crate) const AVATAR_OPTIMIZER_FEED: &str = "https://vpm.anatawa12.com/vpm.json";
const LILTOON_FEED: &str = "https://lilxyzw.github.io/vpm-repos/vpm.json";
const POIYOMI_FEED: &str = "https://poiyomi.github.io/vpm/index.json";
const UNLITWF_FEED: &str = "https://whiteflare.github.io/vpm-repos/vpm.json";
const VRCHAT_FEED: &str = "https://vrchat.github.io/packages/index.json";
const VRCHAT_SDK_LICENSE: &str = "https://hello.vrchat.com/legal/sdk";
const CHECKED: &str = "2026-10-18";

pub(crate) static KNOWN_PACKAGES: &[KnownPackage] = &[
    // FT assets are not shaders. Preserve imported creator copies and guide installation
    // until an adapter pins a compatible template/SDK/renderer mapping.
    KnownPackage {
        id: "adjerry91.vrcft.templates",
        display_name: "Jerry's VRCFT Templates",
        feed_url: "https://adjerry91.github.io/VRCFaceTracking-Templates/index.json",
        official_url: "https://github.com/Adjerry91/VRCFaceTracking-Templates",
        license: "MIT",
        license_url: "https://github.com/Adjerry91/VRCFaceTracking-Templates/blob/main/LICENSE.md",
        license_checked: "2026-10-20",
        delivery: Delivery::Guide,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "net.pawlygon.vrc-facetracking",
        display_name: "Pawlygon Face Tracking",
        feed_url: "https://vcc.pawlygon.net/index.json",
        official_url: "https://github.com/PawlygonStudio/VRC-Facetracking",
        license: "MIT",
        license_url: "https://github.com/PawlygonStudio/VRC-Facetracking/blob/main/LICENSE.md",
        license_checked: "2026-10-20",
        delivery: Delivery::Guide,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "com.vrcfury.vrcfury",
        display_name: "VRCFury",
        feed_url: "https://vcc.vrcfury.com",
        official_url: "https://vrcfury.com/download/",
        license: "Source-available; direct end-user download required for commercial use",
        license_url: "https://github.com/VRCFury/VRCFury/blob/main/LICENSE.md",
        license_checked: "2026-10-20",
        delivery: Delivery::Guide,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "jp.lilxyzw.liltoon",
        display_name: "lilToon",
        feed_url: LILTOON_FEED,
        official_url: "https://lilxyzw.github.io/lilToon/",
        license: "MIT",
        license_url: "https://github.com/lilxyzw/lilToon/blob/master/LICENSE",
        license_checked: CHECKED,
        delivery: Delivery::Auto,
        material_markers: &["_lilToonVersion"],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceAlways,
        legacy_folders: &["Assets\\lilToon"],
        legacy_files: &[],
    },
    KnownPackage {
        id: "com.poiyomi.toon",
        display_name: "Poiyomi Toon Shader",
        feed_url: POIYOMI_FEED,
        official_url: "https://www.poiyomi.com/",
        license: "MIT",
        license_url: "https://github.com/poiyomi/PoiyomiToonShader/blob/master/LICENSE.txt",
        license_checked: CHECKED,
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: POIYOMI_TOON_LINES,
        releases: POIYOMI_TOON_RELEASES,
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &["Assets\\_PoiyomiShaders"],
        legacy_files: &[],
    },
    KnownPackage {
        id: "com.poiyomi.pro",
        display_name: "Poiyomi Pro",
        feed_url: POIYOMI_FEED,
        official_url: "https://www.poiyomi.com/",
        license: "Proprietary/EULA",
        license_url: "https://www.poiyomi.com/",
        license_checked: CHECKED,
        delivery: Delivery::Guide,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "jp.whiteflare.unlitwf",
        display_name: "UnlitWF Shader",
        feed_url: UNLITWF_FEED,
        official_url: "https://github.com/whiteflare/Unlit_WF_ShaderSuite",
        license: "Zlib",
        license_url: "https://github.com/whiteflare/Unlit_WF_ShaderSuite/blob/master/LICENSE",
        license_checked: CHECKED,
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: UNLITWF_GUIDS,
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &["Assets\\Unlit_WF_ShaderSuite"],
        legacy_files: &[],
    },
    KnownPackage {
        id: "com.vrchat.base",
        display_name: "VRChat Toon Standard",
        feed_url: VRCHAT_FEED,
        official_url: "https://creators.vrchat.com/avatars/shaders/",
        license: "Proprietary/EULA",
        license_url: VRCHAT_SDK_LICENSE,
        license_checked: CHECKED,
        delivery: Delivery::Bundled,
        material_markers: &[],
        shader_guids: TOON_STANDARD_GUIDS,
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "com.vrchat.avatars",
        display_name: "VRChat SDK - Avatars",
        feed_url: VRCHAT_FEED,
        official_url: "https://creators.vrchat.com/sdk/",
        license: "Proprietary/EULA",
        license_url: VRCHAT_SDK_LICENSE,
        license_checked: CHECKED,
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "nadena.dev.modular-avatar",
        display_name: "Modular Avatar",
        feed_url: MODULAR_AVATAR_FEED,
        official_url: "https://modular-avatar.nadena.dev/",
        license: "MIT",
        license_url: "https://github.com/bdunderscore/modular-avatar/blob/main/COPYING.md",
        license_checked: CHECKED,
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "nadena.dev.ndmf",
        display_name: "Non-Destructive Modular Framework",
        feed_url: MODULAR_AVATAR_FEED,
        official_url: "https://ndmf.nadena.dev/",
        license: "MIT",
        license_url: "https://github.com/bdunderscore/ndmf/blob/main/COPYING.md",
        license_checked: CHECKED,
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: AVATAR_OPTIMIZER_ID,
        display_name: "AAO: Avatar Optimizer",
        feed_url: AVATAR_OPTIMIZER_FEED,
        official_url: "https://vpm.anatawa12.com/avatar-optimizer/",
        license: "MIT",
        license_url: "https://github.com/anatawa12/AvatarOptimizer/blob/v1.9.21/LICENSE",
        license_checked: "2026-11-11",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "jp.lilxyzw.lilycalinventory",
        display_name: "lilycalInventory",
        feed_url: LILTOON_FEED,
        official_url: "https://lilxyzw.github.io/lilycalInventory/",
        license: "MIT",
        license_url: "https://github.com/lilxyzw/lilycalInventory/blob/main/LICENSE",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "net.rs64.tex-trans-tool",
        display_name: "TexTransTool",
        feed_url: "https://vpm.rs64.net/vpm.json",
        official_url: "https://ttt.rs64.net/",
        license: "MIT",
        license_url: "https://github.com/ReinaS-64892/TexTransTool/blob/master/LICENSE.md",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "jp.suzuryg.face-emo",
        display_name: "FaceEmo",
        feed_url: "https://suzuryg.github.io/vpm-repos/vpm.json",
        official_url: "https://suzuryg.github.io/face-emo/",
        license: "MIT",
        license_url: "https://github.com/suzuryg/face-emo/blob/main/LICENSE.md",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "jp.pokemori.vrm-converter-for-vrchat",
        display_name: "VRM Converter for VRChat",
        feed_url: "https://esperecyan.github.io/VRMConverterForVRChat/registry.json",
        official_url: "https://docs.esperecyan.net/vrm-converter-for-vrchat/",
        license: "MPL-2.0",
        license_url: "https://github.com/esperecyan/VRMConverterForVRChat/blob/master/LICENSE.md",
        license_checked: "2026-11-14",
        delivery: Delivery::Guide,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "jp.lilxyzw.avatar-utils",
        display_name: "lilAvatarUtils",
        feed_url: LILTOON_FEED,
        official_url: "https://lilxyzw.github.io/lilAvatarUtils/",
        license: "MIT",
        license_url: "https://github.com/lilxyzw/lilAvatarUtils/blob/main/LICENSE",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "net.narazaka.vrchat.floor-adjuster",
        display_name: "FloorAdjuster",
        feed_url: "https://vpm.narazaka.net/index.json",
        official_url: "https://github.com/Narazaka/FloorAdjuster",
        license: "Zlib",
        license_url: "https://github.com/Narazaka/FloorAdjuster/blob/master/LICENSE.txt",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "com.github.kurotu.vrc-quest-tools",
        display_name: "VRCQuestTools",
        feed_url: "https://kurotu.github.io/vpm-repos/vpm.json",
        official_url: "https://kurotu.github.io/VRCQuestTools/",
        license: "MIT",
        license_url: "https://github.com/kurotu/VRCQuestTools/blob/master/LICENSE.txt",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "com.vrmc.univrm",
        display_name: "UniVRM",
        feed_url: "https://esperecyan.github.io/VRMConverterForVRChat/registry.json",
        official_url: "https://vrm-c.github.io/UniVRM/en/",
        license: "MIT",
        license_url: "https://github.com/vrm-c/UniVRM/blob/master/LICENSE.txt",
        license_checked: "2026-11-14",
        delivery: Delivery::Guide,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "jp.lilxyzw.ndmfmeshsimplifier",
        display_name: "lilNDMFMeshSimplifier",
        feed_url: LILTOON_FEED,
        official_url: "https://github.com/lilxyzw/lilNDMFMeshSimplifier",
        license: "MIT",
        license_url: "https://github.com/lilxyzw/lilNDMFMeshSimplifier/blob/main/LICENSE",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
    KnownPackage {
        id: "dev.hai-vr.cge",
        display_name: "ComboGestureExpressions",
        feed_url: "https://hai-vr.github.io/vpm-listing/index.json",
        official_url: "https://docs.hai-vr.dev/docs/products/combo-gesture-expressions",
        license: "MIT",
        license_url: "https://github.com/hai-vr/combo-gesture-expressions-av3/blob/main/LICENSE",
        license_checked: "2026-11-14",
        delivery: Delivery::Auto,
        material_markers: &[],
        shader_guids: &[],
        version_lines: &[],
        releases: &[],
        legacy_policy: LegacyPolicy::ReplaceWhenCovered,
        legacy_folders: &[],
        legacy_files: &[],
    },
];

pub(crate) fn find_known_package(id: &str) -> Option<&'static KnownPackage> {
    KNOWN_PACKAGES.iter().find(|package| package.id == id)
}

/// Verifies that the project's installed VRChat Avatars SDK and NDMF versions satisfy
/// `com.anatawa12.avatar-optimizer` 1.9.21's upstream `vpmDependencies` (`>= 3.7.0 < 3.11.0`
/// and `>= 1.8.0 < 2.0.0`).
pub(crate) fn avatar_optimizer_compatible(
    sdk_version: Option<&str>,
    ndmf_version: Option<&str>,
) -> bool {
    let Some(sdk) = sdk_version.and_then(parse_stable_semver) else {
        return false;
    };
    let Some(ndmf) = ndmf_version.and_then(parse_stable_semver) else {
        return false;
    };
    ((3, 7, 0)..(3, 11, 0)).contains(&sdk) && ((1, 8, 0)..(2, 0, 0)).contains(&ndmf)
}

fn parse_stable_semver(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.split('+').next()?;
    if core.contains('-') {
        return None;
    }
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// The package a serialized `.mat` needs, and the shader GUID the material references.
pub(crate) struct MaterialMatch {
    pub package: usize,
    pub shader_guid: Option<String>,
}

/// Marker properties win over the GUID table, keeping lilToon's historical
/// `_lilToonVersion` rule; other packages match their shader GUIDs.
pub(crate) fn detect_material(table: &[KnownPackage], material: &[u8]) -> Option<MaterialMatch> {
    let text = String::from_utf8_lossy(material);
    let guid = shader_guid(&text);
    for (index, package) in table.iter().enumerate() {
        if package
            .material_markers
            .iter()
            .any(|marker| text.contains(marker))
        {
            return Some(MaterialMatch {
                package: index,
                shader_guid: guid,
            });
        }
    }
    let guid = guid?;
    table
        .iter()
        .enumerate()
        .find(|(_, package)| package.contains_shader(&guid))
        .map(|(index, _)| MaterialMatch {
            package: index,
            shader_guid: Some(guid),
        })
}

/// The referenced shader GUID in lower case, parsed like the historical lilToon rule.
fn shader_guid(text: &str) -> Option<String> {
    let reference = text
        .lines()
        .find_map(|line| line.trim_start().strip_prefix("m_Shader:"))?;
    let guid = reference
        .split("guid:")
        .nth(1)?
        .split([',', '}'])
        .next()?
        .trim()
        .to_ascii_lowercase();
    (guid.len() == 32 && guid.bytes().all(|c| c.is_ascii_hexdigit())).then_some(guid)
}

/// The shader GUIDs the selected materials of one package reference.
#[derive(Default)]
pub(crate) struct PackageNeed {
    pub shaders: BTreeSet<String>,
}
pub(crate) type PackageNeeds = BTreeMap<usize, PackageNeed>;

/// A legacy copy found inside the selected sources: every shader GUID it carries,
/// read from the staged `.shader` metadata.
#[derive(Default)]
pub(crate) struct LegacyCopy {
    pub present: bool,
    pub shaders: BTreeSet<String>,
    /// A `.shader` whose metadata could not be read, so coverage cannot be proven.
    pub unreadable_shader: bool,
}
pub(crate) type LegacyCopies = BTreeMap<usize, LegacyCopy>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Install {
    /// The newest resolving release (lilToon and UnlitWF, whose GUIDs are version-stable).
    Latest,
    /// The newest cached stable release of one version line, pinned through
    /// `PackageRequestV1.version`.
    Line(&'static str),
    /// One exact recorded release whose complete shader set covers the bundled
    /// copy it replaces.
    Release(&'static str),
}

#[derive(Debug)]
pub(crate) struct PackageAction {
    pub install: Option<Install>,
    /// `false` imports the legacy copy exactly as before, `true` leaves it to the official package.
    pub replace_legacy: bool,
}

/// What preparation does with one package. Installation and legacy replacement are
/// linked: a copy that cannot be replaced completely imports unchanged and nothing is
/// installed, so an old copy never meets a different official release.
pub(crate) fn package_action(
    table: &[KnownPackage],
    index: usize,
    need: &PackageNeed,
    legacy: &LegacyCopy,
    provided_guids: &HashMap<String, String>,
    installed_version: Option<&str>,
    pinned: bool,
) -> PackageAction {
    let package = &table[index];
    if !matches!(package.delivery, Delivery::Auto) {
        // Guide and SDK-bundled packages are never installed or replaced by this path.
        return PackageAction {
            install: None,
            replace_legacy: false,
        };
    }
    let needed: BTreeSet<&String> = need
        .shaders
        .iter()
        .filter(|guid| !provided_guids.contains_key(guid.as_str()))
        .collect();
    if matches!(package.legacy_policy, LegacyPolicy::ReplaceAlways) {
        // lilToon: bundled copies always leave, even with a Recipe pin or an installed package.
        return PackageAction {
            install: (!pinned
                && installed_version.is_none()
                && (legacy.present || !needed.is_empty()))
            .then_some(Install::Latest),
            replace_legacy: legacy.present,
        };
    }
    let keep = PackageAction {
        install: None,
        replace_legacy: false,
    };
    if pinned || installed_version.is_some() {
        return keep;
    }
    if package.version_lines.is_empty() {
        if legacy.present {
            let covered = !legacy.unreadable_shader
                && !legacy.shaders.is_empty()
                && legacy
                    .shaders
                    .iter()
                    .chain(need.shaders.iter())
                    .all(|guid| package.contains_shader(guid));
            return if covered {
                PackageAction {
                    install: Some(Install::Latest),
                    replace_legacy: true,
                }
            } else {
                keep
            };
        }
        return PackageAction {
            install: (!needed.is_empty()).then_some(Install::Latest),
            replace_legacy: false,
        };
    }
    let line_of = |guid: &String| package.line_for_guid(guid).map(|line| line.line);
    let provided_lines: BTreeSet<&str> = provided_guids.keys().filter_map(&line_of).collect();
    if legacy.present {
        // The whole copy — several version lines and the utility shaders shipped
        // with them — leaves for the earliest recorded release whose complete set
        // also covers the shaders the materials reference and the ones selected
        // sources provide, so one verified official release serves the project.
        // The earliest covering release stays closest to the era the copy came from,
        // as the materials-only path pins a line's own release.
        if legacy.unreadable_shader || legacy.shaders.is_empty() || package.releases.is_empty() {
            return keep;
        }
        let known: BTreeSet<&str> = package
            .releases
            .iter()
            .flat_map(|release| release.shader_guids.iter().copied())
            .collect();
        let covers = |set: &[&str]| {
            legacy
                .shaders
                .iter()
                .chain(need.shaders.iter())
                .all(|guid| set.contains(&guid.as_str()))
                && provided_guids
                    .keys()
                    .filter(|guid| known.contains(guid.as_str()))
                    .all(|guid| set.contains(&guid.as_str()))
        };
        return match package
            .releases
            .iter()
            .find(|release| covers(release.shader_guids))
        {
            Some(release) => PackageAction {
                install: Some(Install::Release(release.version)),
                replace_legacy: true,
            },
            None => keep,
        };
    }
    let needed_lines: BTreeSet<&str> = needed.iter().filter_map(|guid| line_of(guid)).collect();
    if needed_lines.len() != 1
        || provided_lines
            .iter()
            .any(|line| !needed_lines.contains(line))
    {
        return keep;
    }
    PackageAction {
        install: Some(Install::Line(needed_lines.iter().next().expect("one line"))),
        replace_legacy: false,
    }
}

/// The Recipe-pinned packages whose feeds project creation registers. Packages project
/// creation already installs through its own path (the VRChat SDK, Modular Avatar and
/// NDMF) keep that path; material-driven `auto` packages and opt-in NDMF companion
/// packages register their feed when a Recipe pins them.
pub(crate) fn pinned_auto_packages<'a>(
    table: &'a [KnownPackage],
    package_pins: &'a BTreeMap<String, String>,
) -> impl Iterator<Item = &'a KnownPackage> {
    table.iter().filter(move |package| {
        matches!(package.delivery, Delivery::Auto)
            && !matches!(
                package.id,
                "com.vrchat.avatars" | "nadena.dev.modular-avatar" | "nadena.dev.ndmf"
            )
            && package_pins.contains_key(package.id)
    })
}

/// One package's legacy install locations, lower case with `/` separators.
pub(crate) struct LegacyEntry {
    package: usize,
    folders: Vec<String>,
    files: Vec<String>,
}

/// Legacy declarations of the packages whose bundled copies preparation replaces with
/// the official package. Files of every other package import unchanged, so entries
/// limited to detection, guidance or the SDK's own installation keep their old behavior.
pub(crate) fn legacy_entries(
    table: &[KnownPackage],
    environment_root: Option<&Path>,
) -> Vec<LegacyEntry> {
    table
        .iter()
        .enumerate()
        .filter(|(_, package)| {
            matches!(package.delivery, Delivery::Auto) && package.detects_materials()
        })
        .map(|(index, package)| {
            let cached = environment_root
                .and_then(|root| cached_legacy_declaration(root, package.feed_url, package.id));
            let (folders, files) = effective_legacy_paths(package, cached);
            LegacyEntry {
                package: index,
                folders,
                files,
            }
        })
        .filter(|entry| !entry.folders.is_empty() || !entry.files.is_empty())
        .collect()
}

/// The package whose legacy install location holds this folded asset path.
pub(crate) fn legacy_owner(entries: &[LegacyEntry], folded_path: &str) -> Option<usize> {
    entries
        .iter()
        .find(|entry| {
            entry.files.iter().any(|file| folded_path == file)
                || entry.folders.iter().any(|folder| {
                    folded_path == folder
                        || (folded_path.len() > folder.len()
                            && folded_path.starts_with(folder)
                            && folded_path.as_bytes()[folder.len()] == b'/')
                })
        })
        .map(|entry| entry.package)
}

/// A feed declaration wins when it names paths; an empty or absent declaration falls
/// back to the table so a feed without legacy metadata keeps the default rule.
fn effective_legacy_paths(
    package: &KnownPackage,
    cached: Option<(Vec<String>, Vec<String>)>,
) -> (Vec<String>, Vec<String>) {
    let normalize = |paths: Vec<String>| -> Vec<String> {
        paths
            .into_iter()
            .map(|path| {
                path.replace('\\', "/")
                    .trim_end_matches('/')
                    .to_ascii_lowercase()
            })
            .filter(|path| !path.is_empty())
            .collect()
    };
    let (folders, files) = cached.unwrap_or_default();
    let folders = if folders.is_empty() {
        package
            .legacy_folders
            .iter()
            .map(|path| (*path).to_owned())
            .collect()
    } else {
        folders
    };
    let files = if files.is_empty() {
        package
            .legacy_files
            .iter()
            .map(|path| (*path).to_owned())
            .collect()
    } else {
        files
    };
    (normalize(folders), normalize(files))
}

/// The `legacyFolders`/`legacyFiles` paths a feed manifest declares for one package,
/// joined across its cached versions. `None` means the manifest does not carry the package.
pub(crate) fn legacy_declaration(
    feed: &serde_json::Value,
    package_id: &str,
) -> Option<(Vec<String>, Vec<String>)> {
    let versions = feed
        .get("packages")?
        .get(package_id)?
        .get("versions")?
        .as_object()?;
    let mut folders = BTreeSet::new();
    let mut files = BTreeSet::new();
    for version in versions.values() {
        collect_legacy_paths(version.get("legacyFolders"), &mut folders);
        collect_legacy_paths(version.get("legacyFiles"), &mut files);
    }
    Some((folders.into_iter().collect(), files.into_iter().collect()))
}

fn collect_legacy_paths(value: Option<&serde_json::Value>, into: &mut BTreeSet<String>) {
    match value {
        Some(serde_json::Value::Object(map)) => into.extend(map.keys().cloned()),
        Some(serde_json::Value::Array(list)) => into.extend(
            list.iter()
                .filter_map(|item| item.as_str().map(str::to_owned)),
        ),
        _ => {}
    }
}

/// Reads a subscribed feed's local cache without network access. The cache file name
/// matches `VrcGetLibBackend::add_remote_repo`; vrc-get's cache documents nest the
/// repository under `repo`, so that inner object is the feed here. A missing or
/// unreadable cache simply leaves the table's fallback declarations in charge.
fn cached_feed(environment_root: &Path, feed_url: &str) -> Option<serde_json::Value> {
    let path = environment_root.join("Repos").join(format!(
        "{}.json",
        vua_orchestrator::fnv1a_hex(feed_url.as_bytes())
    ));
    let feed = serde_json::from_slice::<serde_json::Value>(&fs::read(path).ok()?).ok()?;
    Some(feed.get("repo").cloned().unwrap_or(feed))
}

fn cached_legacy_declaration(
    environment_root: &Path,
    feed_url: &str,
    package_id: &str,
) -> Option<(Vec<String>, Vec<String>)> {
    legacy_declaration(&cached_feed(environment_root, feed_url)?, package_id)
}

/// The newest cached release of one version line, used to pin the installation.
/// `None` means the cache holds no stable release of that line.
pub(crate) fn latest_cached_line_version(
    environment_root: &Path,
    feed_url: &str,
    package_id: &str,
    line: &str,
) -> Option<String> {
    let feed = cached_feed(environment_root, feed_url)?;
    let versions = feed
        .get("packages")?
        .get(package_id)?
        .get("versions")?
        .as_object()?;
    versions
        .keys()
        .filter(|version| !version.contains('-') && version_line(version).as_deref() == Some(line))
        .max_by(|a, b| version_key(a).cmp(&version_key(b)))
        .cloned()
}

fn version_line(version: &str) -> Option<String> {
    let mut parts = version.split('.');
    Some(format!("{}.{}", parts.next()?, parts.next()?))
}

fn version_key(version: &str) -> Vec<u64> {
    version
        .split('.')
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

#[derive(Default)]
struct GuideNeed {
    count: usize,
    lines: BTreeSet<&'static str>,
}

/// One `amf.package.guide` warning per package the missing materials point at: every
/// recognized `guide` package, and every recognized `auto` package whose needed version
/// lines the project does not carry. The message names the affected version lines.
pub(crate) fn guide_diagnostics<'a>(
    table: &[KnownPackage],
    materials: impl IntoIterator<Item = &'a [u8]>,
    installed_versions: &BTreeMap<String, String>,
) -> Vec<Diagnostic> {
    let mut counts = BTreeMap::<usize, GuideNeed>::new();
    for material in materials {
        if let Some(found) = detect_material(table, material) {
            let package = &table[found.package];
            let need = counts.entry(found.package).or_default();
            need.count += 1;
            if let Some(line) = found
                .shader_guid
                .as_deref()
                .and_then(|guid| package.line_for_guid(guid))
            {
                need.lines.insert(line.line);
            }
        }
    }
    counts
        .into_iter()
        .filter_map(|(index, need)| {
            let package = &table[index];
            let guided = match package.delivery {
                Delivery::Guide => true,
                Delivery::Bundled => false,
                Delivery::Auto => match installed_versions.get(package.id) {
                    None => true,
                    Some(_) if package.version_lines.is_empty() => false,
                    Some(version) => {
                        let installed_line = package.line_for_version(version);
                        !(need.lines.len() == 1
                            && need.lines.iter().next().copied() == installed_line)
                    }
                },
            };
            guided.then(|| Diagnostic {
                code: "amf.package.guide".into(),
                severity: DiagnosticSeverity::Warning,
                message: format!(
                    "{} material{} need{} {}{}; get it from {}.",
                    need.count,
                    if need.count == 1 { "" } else { "s" },
                    if need.count == 1 { "s" } else { "" },
                    package.display_name,
                    version_line_suffix(&need.lines),
                    package.official_url
                ),
            })
        })
        .collect()
}

fn version_line_suffix(lines: &BTreeSet<&str>) -> String {
    let lines: Vec<_> = lines.iter().copied().collect();
    match lines.len() {
        0 => String::new(),
        1 => format!(" {}", lines[0]),
        2 => format!(" {} and {}", lines[0], lines[1]),
        _ => format!(
            " {} and {}",
            lines[..lines.len() - 1].join(", "),
            lines[lines.len() - 1]
        ),
    }
}

// Each line was read from that line's newest release package, only from its own
// `_PoiyomiShaders/Shaders/<line>/**.shader.meta`: 8.1.167, 9.0.61, 9.1.30, 9.2.79,
// 9.3.64 and 10.0.27 (identical per line across every release on the feed; see
// POIYOMI_TOON_RELEASES for the evidence date). No GUID is shared between two lines.
static POIYOMI_TOON_LINES: &[VersionLine] = &[
    VersionLine {
        line: "8.1",
        shader_guids: &[
            "034460dc851505a42baca2ba6514f9f0",
            "24edb77705ad65a49afb831f72747592",
            "5ca92f1e9fc35504aba297fd1acd62df",
            "784867d15973a4847b1a6048d42c1565",
            "c0aca4001823bf74e8a9538b3075bf56",
            "d0091594032d90d46b8d5eaeaf065a17",
        ],
    },
    VersionLine {
        line: "9.0",
        shader_guids: &[
            "23f6705aff8bf964c87bfb3dd66ab345",
            "68d4032c05798c44eafe02f272e6895c",
            "aa7e588ee69e46f429e3daa4b3068311",
            "bdbac715113578048ab7114aa3379a1d",
            "fc2c2d7b9ec11d34785997ccbb86f496",
        ],
    },
    VersionLine {
        line: "9.1",
        shader_guids: &[
            "18de0e547c911de4e804ceaaa97a0b26",
            "3eefd743f727e99419fa501e889c4998",
            "7845a1ca48a75804c8925b2bd5680f7f",
            "7bca35b6e5a09ee4cbdff5cc54a9bd49",
            "cef5dc16b30fdbb46b08ab424d41d1c0",
        ],
    },
    VersionLine {
        line: "9.2",
        shader_guids: &[
            "00a679886ff24e74585a2a9d37b3c8d7",
            "104003ab15a9f7a47b6ef0597225e771",
            "1b58d372fe360874a8fb767d53f955b0",
            "3210d19aa4851e148b6848177a017f02",
            "73da03e2cd0afa940968d9c487e2474d",
        ],
    },
    VersionLine {
        line: "9.3",
        shader_guids: &[
            "21e56665a7e45184b9013fb9e4f7bc96",
            "47c3851517c96c84aae06d328a2581f6",
            "9444ce77bf4418748b1e8591b9d97f85",
            "a6839ad792f95aa41a941c7317aa1fe1",
            "d141019541e4e44479fbd71ad42a2cf6",
            "e99d2df55dac44a4c921122fe7cf6ba7",
            "eda2412ac7ab2db45a47a521f6d7d8a6",
        ],
    },
    VersionLine {
        line: "10.0",
        shader_guids: &[
            "997f84ffc30f9ca439a796739ced421c",
            "9ea5d2df175e6f84785d5fffd69809a5",
            "a19e06d869c537d4391955e43f631173",
            "aaeaef15081a5154eac3e71b584c5472",
            "b357c1b1407f3ad4eba47df501cc613c",
            "e9f30272e2d12c945851329f504df73d",
            "fa7f9dc5d41366249bd0098f22c3c1cd",
        ],
    },
];

// The complete `.shader` sets of the two releases that still cover every release
// the official VPM feed offers (all 55 packages read and hash-verified against
// the feed on 2026-10-23): 9.3.64 is the last release carrying the 7.3 through
// 9.3 lines, and every later release dropped them; 10.0.27 (the feed's newest)
// carries only the 9.3 and 10.0 lines plus the utility shaders. Each set also
// includes the shaders outside the line folders (`Shaders/Extras` and
// `Scripts/poi-tools`), which no single line's table covers.
static POIYOMI_TOON_RELEASES: &[ReleaseSet] = &[
    ReleaseSet {
        version: "9.3.64",
        shader_guids: &[
            "00a679886ff24e74585a2a9d37b3c8d7",
            "034460dc851505a42baca2ba6514f9f0",
            "0b436e0db169bde429124bf491f28cef",
            "104003ab15a9f7a47b6ef0597225e771",
            "1513582543e8f6c44b1981e8689f7a52",
            "18de0e547c911de4e804ceaaa97a0b26",
            "1b58d372fe360874a8fb767d53f955b0",
            "2038a9b2a9e7ca94298fee3c196b252b",
            "21e56665a7e45184b9013fb9e4f7bc96",
            "231d95ff7213dd74f82af136b256fb32",
            "23f6705aff8bf964c87bfb3dd66ab345",
            "245e67c21ccaa9a43ad7e84d1c7bb5fc",
            "24edb77705ad65a49afb831f72747592",
            "3210d19aa4851e148b6848177a017f02",
            "3eefd743f727e99419fa501e889c4998",
            "47c3851517c96c84aae06d328a2581f6",
            "5ab467a3a3d657b40836c4493ff3e51d",
            "5ca92f1e9fc35504aba297fd1acd62df",
            "68d4032c05798c44eafe02f272e6895c",
            "71129bd3774e04d48827a25fc98d45a7",
            "73da03e2cd0afa940968d9c487e2474d",
            "7845a1ca48a75804c8925b2bd5680f7f",
            "784867d15973a4847b1a6048d42c1565",
            "7bca35b6e5a09ee4cbdff5cc54a9bd49",
            "8a38f752c293b5548b674637c2a6f99a",
            "917b37092bae034459c28c00a3a19b54",
            "9444ce77bf4418748b1e8591b9d97f85",
            "94a63a84353e517488db284dc8fab0ca",
            "9cdbe9241ea4aaa48944028272700834",
            "a49dd2fba12886c499261512c6eaaa80",
            "a6839ad792f95aa41a941c7317aa1fe1",
            "aa7e588ee69e46f429e3daa4b3068311",
            "add1d40d10695a24b9e91e172ccb9525",
            "bdbac715113578048ab7114aa3379a1d",
            "c0aca4001823bf74e8a9538b3075bf56",
            "c933bce24d9d90747a5def016febd042",
            "cef5dc16b30fdbb46b08ab424d41d1c0",
            "d0091594032d90d46b8d5eaeaf065a17",
            "d141019541e4e44479fbd71ad42a2cf6",
            "e99d2df55dac44a4c921122fe7cf6ba7",
            "eda2412ac7ab2db45a47a521f6d7d8a6",
            "fc2c2d7b9ec11d34785997ccbb86f496",
        ],
    },
    ReleaseSet {
        version: "10.0.27",
        shader_guids: &[
            "21e56665a7e45184b9013fb9e4f7bc96",
            "245e67c21ccaa9a43ad7e84d1c7bb5fc",
            "47c3851517c96c84aae06d328a2581f6",
            "5ab467a3a3d657b40836c4493ff3e51d",
            "71129bd3774e04d48827a25fc98d45a7",
            "7345a7d6c2580fc45b5bef355eeea70a",
            "9444ce77bf4418748b1e8591b9d97f85",
            "997f84ffc30f9ca439a796739ced421c",
            "9ea5d2df175e6f84785d5fffd69809a5",
            "a19e06d869c537d4391955e43f631173",
            "a49dd2fba12886c499261512c6eaaa80",
            "a6839ad792f95aa41a941c7317aa1fe1",
            "aaeaef15081a5154eac3e71b584c5472",
            "add1d40d10695a24b9e91e172ccb9525",
            "b357c1b1407f3ad4eba47df501cc613c",
            "d141019541e4e44479fbd71ad42a2cf6",
            "e99d2df55dac44a4c921122fe7cf6ba7",
            "e9f30272e2d12c945851329f504df73d",
            "eda2412ac7ab2db45a47a521f6d7d8a6",
            "fa7f9dc5d41366249bd0098f22c3c1cd",
        ],
    },
];

// Read from jp.whiteflare.unlitwf 2.9.0: every `Runtime/Shaders/**.shader.meta`.
// The 2.14.0 release carries exactly the same 84 GUIDs (checked 2026-10-19).
const UNLITWF_GUIDS: &[&str] = &[
    "0299954f2a9b0994f8c9587945948766",
    "06e9294a93df4474cac2f4157b5e1d1d",
    "0733cfc88032e8d4eafce250263c497c",
    "0a7a6cdca16a38548a5d81aca8d4e3ba",
    "0b53cf0bcd0f9db4fa9d1297d255d06d",
    "0c20402a658b66444a95461b76f367b2",
    "1332d868874e61e44b48c1f59bf4bd11",
    "1435581bcf13e7a47b5bf5636f8d8252",
    "15212414cba0c7a4aac92d94a4ae8750",
    "152ebc8c9a60c0e43820c71a0f0dfbb6",
    "17124f35e2c0c5244a712e8654a994f9",
    "188bb4cd384ba624892e50b5b35f7297",
    "21f6eaa1dd1f25c4cb29a42c4ff5d98f",
    "2210f95a2274e9d4faf8a14dac933fdb",
    "28e73745c5d1e464a876038f875501b4",
    "2cf66b0706c40744baab089297afa895",
    "2d294f328149d944eb0899b452ff879c",
    "2dafe14658b486b4bb44869606d30d67",
    "2efe527cfcbf0e1408b67463225f552f",
    "3276a740671679f44b1141523bf73e33",
    "3bde56820d1aece41bd22966876a061c",
    "3c07b964e541eef45bc195a029b878b3",
    "45e1aee78764bec499e99106c330f95a",
    "46e58649f5c3de74a9f578af4e6d30b5",
    "4ba701b07ccc81e4aae7f053bf332eab",
    "4bd76f6599a5b8e4d88d81300fb74c37",
    "4e4be4aab63a2bd4fbcea2390ae92fdf",
    "4eef00f52cc21b04e9e34e4caefa6bbf",
    "5498b01615002d948bea7542f55e0c07",
    "5523e041d29d259439fa14bd131f5c82",
    "58bb80b63bec29d4384e105c53ca6970",
    "58ccf9c912b226146a25726b8a1f04db",
    "5c1fc3340b9976949b12562190be5db0",
    "5c54a3a3c81772549819db795008c986",
    "64bf3ca653a7b274fab3e8a87016bfb0",
    "660abd485057f4740ac9050f7ab3237d",
    "6bf04fb5e50a2de4dbf06063f8592ab0",
    "7240817400475dd41b084e32b1264d6f",
    "747bf283d686334469fb662b2fc4a5c2",
    "78d2e3fa0b8eb674aa9cf9e048f79c93",
    "7be712530731fbd44ae755f12dbc6d07",
    "871fd7a51a8ea3e4980c3fe7b8347619",
    "8bc13844fa3debd40aa4cd72fdc3900b",
    "8c7888a4ac175584f81e0b6e7d4af5a7",
    "90cac9ec3b2a7524eb99b36ab87f25f1",
    "92675e22926880147a67c25086c3bb70",
    "9350854c6e88f3f4eb873d2f94ff3328",
    "94ee7f8988740fd4887f8b1ce41f0c1c",
    "98bb3de5d5444094aa041a65f8a85708",
    "9d5847e3fa0700f4dab38227bf565df2",
    "a220e3e0675cc3f4f817a485688788d6",
    "a3641cf3b665bec468ac868660864d64",
    "a3678756e883b9349ac22fce33313139",
    "a3777cac8e82d944bba542a87aa5368c",
    "a5ae7f40ac53e274ea0bc1262e1f6895",
    "aab16a18215b5e2488031de410fda510",
    "ab4eb87c406a22f46887cf72178e2685",
    "ad88000744b4fb241835ba6ec106caf4",
    "af3422dc9372a89449a9f44d409d9714",
    "af51615040dcdad4cb01c29ea34dbb03",
    "bd20e788383cdb943b829f230eb1c5ec",
    "c0f75d3ed420fd144a74722588d3bc21",
    "c6e2e8e77eaf9bb4b82f757fe9b823f0",
    "c7e5995223250464cac205689e058693",
    "ccf60bd2b8af3e94ebc1a310962dac61",
    "cda050f4096b1df478fdc6fcc89586c7",
    "d01a5c313ada49e488b2ef8c6b00f56d",
    "d1e7b0a18e221a1409ad59065ec157e4",
    "d242cb83664caae4f957030870dd801d",
    "d279a88eda1ae0e4c89e92539639eb16",
    "d52eb08feafe8de4386757d285f9c26a",
    "dd3a683002b3a6f43bdb6c97bd0985c1",
    "dfb821bc7afadc14591e4338a8ec865f",
    "e0b93fdad2eeedf42baccbc0975cdd1d",
    "e4b04fed7c539d84887123c0beeffaca",
    "e7263331a8ee0a04aa4a271fc1fef104",
    "ec023985bf0f3f44bb6fe6bf962c2c69",
    "f19f31eb9bfd5154ba2c1a41c54a908b",
    "f3f80636c64e389498b3b19e2ee218da",
    "f5d5b7934ab1854418baf5042b0f7453",
    "fb639668f92376a4786d635258ae96da",
    "fc2c3716646379d47809d35f53238f82",
    "fcbd21eca211262498a416d29e6b050e",
    "ffa6a9ecd57d50a4db625f7ed4fabeeb",
];

// Read from com.vrchat.base 3.10.5: `Runtime/VRCSDK/Sample Assets/Shaders/Mobile/
// ToonStandard/ToonStandard.shader.meta` and `ToonStandardOutline.shader.meta`.
const TOON_STANDARD_GUIDS: &[&str] = &[
    "051a0ed2f2aedd741aa8186ae92f97e0",
    "e765db0afa7ecfc44ade2e4e2491f65a",
];

#[cfg(test)]
mod tests {
    #[test]
    fn face_tracking_packages_do_not_install_or_strip_creator_content() {
        for id in [
            "adjerry91.vrcft.templates",
            "net.pawlygon.vrc-facetracking",
            "com.vrcfury.vrcfury",
        ] {
            let index = super::KNOWN_PACKAGES
                .iter()
                .position(|p| p.id == id)
                .unwrap();
            let package = &super::KNOWN_PACKAGES[index];
            assert_eq!(package.delivery, super::Delivery::Guide);
            let action = super::package_action(
                super::KNOWN_PACKAGES,
                index,
                &super::PackageNeed::default(),
                &super::LegacyCopy {
                    present: true,
                    ..Default::default()
                },
                &std::collections::HashMap::new(),
                None,
                false,
            );
            assert!(action.install.is_none() && !action.replace_legacy);
        }
        assert!(super::detect_material(
            super::KNOWN_PACKAGES,
            b"JawOpen FT/VRCFT/v2/EyeClosedLeft"
        )
        .is_none());
    }
    use super::*;

    const POIYOMI_92: &str = "104003ab15a9f7a47b6ef0597225e771";
    const POIYOMI_93: &str = "9444ce77bf4418748b1e8591b9d97f85";
    const POIYOMI_100: &str = "997f84ffc30f9ca439a796739ced421c";
    const UNKNOWN_GUID: &str = "0123456789abcdef0123456789abcdef";

    fn index(table: &[KnownPackage], id: &str) -> usize {
        table.iter().position(|package| package.id == id).unwrap()
    }

    fn material(guid: &str, extra: &str) -> Vec<u8> {
        format!("Material:\n  m_Shader: {{fileID: 4800000, guid: {guid}, type: 3}}\n{extra}")
            .into_bytes()
    }

    fn need(shaders: &[&str]) -> PackageNeed {
        PackageNeed {
            shaders: shaders.iter().map(|shader| (*shader).to_owned()).collect(),
        }
    }

    fn copy(shaders: &[&str]) -> LegacyCopy {
        LegacyCopy {
            present: true,
            shaders: shaders.iter().map(|shader| (*shader).to_owned()).collect(),
            unreadable_shader: false,
        }
    }

    fn action(
        index: usize,
        need: PackageNeed,
        legacy: LegacyCopy,
        installed: Option<&str>,
    ) -> PackageAction {
        package_action(
            KNOWN_PACKAGES,
            index,
            &need,
            &legacy,
            &HashMap::new(),
            installed,
            false,
        )
    }

    fn poiyomi() -> usize {
        index(KNOWN_PACKAGES, "com.poiyomi.toon")
    }

    #[test]
    fn shader_guid_signals_name_the_package_and_version_line() {
        for (guid, id, line) in [
            (POIYOMI_93, "com.poiyomi.toon", Some("9.3")),
            (
                "104003AB15A9F7A47B6EF0597225E771",
                "com.poiyomi.toon",
                Some("9.2"),
            ),
            (POIYOMI_100, "com.poiyomi.toon", Some("10.0")),
            (
                "a3678756e883b9349ac22fce33313139",
                "jp.whiteflare.unlitwf",
                None,
            ),
            ("e765db0afa7ecfc44ade2e4e2491f65a", "com.vrchat.base", None),
        ] {
            let found = detect_material(KNOWN_PACKAGES, &material(guid, "")).unwrap();
            let package = &KNOWN_PACKAGES[found.package];
            assert_eq!(package.id, id);
            assert_eq!(
                found.shader_guid.as_deref(),
                Some(guid.to_ascii_lowercase().as_str())
            );
            assert_eq!(
                package
                    .line_for_guid(found.shader_guid.as_deref().unwrap())
                    .map(|line| line.line),
                line
            );
        }
        // The retired 8.0 line has no release on the feed, so it stays undetected.
        assert!(detect_material(
            KNOWN_PACKAGES,
            &material("231d95ff7213dd74f82af136b256fb32", "")
        )
        .is_none());
        assert!(detect_material(KNOWN_PACKAGES, &material(UNKNOWN_GUID, "")).is_none());
    }

    #[test]
    fn poiyomi_materials_install_only_their_single_missing_version_line() {
        let installed_none = None;
        let first = action(
            poiyomi(),
            need(&[POIYOMI_93]),
            LegacyCopy::default(),
            installed_none,
        );
        assert_eq!(first.install, Some(Install::Line("9.3")));
        assert!(!first.replace_legacy);

        let ten = action(poiyomi(), need(&[POIYOMI_100]), LegacyCopy::default(), None);
        assert_eq!(ten.install, Some(Install::Line("10.0")));

        // Two version lines cannot be resolved by one install.
        let mixed = action(
            poiyomi(),
            need(&[POIYOMI_92, POIYOMI_93]),
            LegacyCopy::default(),
            None,
        );
        assert_eq!(mixed.install, None);

        // An installed different line stays untouched; an installed same line is not reinstalled.
        assert_eq!(
            action(
                poiyomi(),
                need(&[POIYOMI_93]),
                LegacyCopy::default(),
                Some("10.0.25")
            )
            .install,
            None
        );
        assert_eq!(
            action(
                poiyomi(),
                need(&[POIYOMI_93]),
                LegacyCopy::default(),
                Some("9.3.64")
            )
            .install,
            None
        );

        // A selected source providing the shader already satisfies the material.
        let provided = HashMap::from([(POIYOMI_93.to_owned(), "Assets/x.shader".to_owned())]);
        let action = package_action(
            KNOWN_PACKAGES,
            poiyomi(),
            &need(&[POIYOMI_93]),
            &LegacyCopy::default(),
            &provided,
            None,
            false,
        );
        assert_eq!(action.install, None);
    }

    #[test]
    fn a_poiyomi_copy_leaves_for_the_earliest_release_covering_it() {
        // A real bundled copy spans several version lines and the utility shaders;
        // 9.3.64 is the only recorded release that still carries the 9.2 line.
        let multi_line = action(
            poiyomi(),
            PackageNeed::default(),
            copy(&[POIYOMI_92, POIYOMI_93, "245e67c21ccaa9a43ad7e84d1c7bb5fc"]),
            None,
        );
        assert_eq!(multi_line.install, Some(Install::Release("9.3.64")));
        assert!(multi_line.replace_legacy);

        // The 10.0 releases dropped every older line, so a 10.0-era copy only
        // leaves for 10.0.27; its new utility shader proves the set, not the
        // line table, decides.
        let ten = action(
            poiyomi(),
            PackageNeed::default(),
            copy(&[POIYOMI_100, "7345a7d6c2580fc45b5bef355eeea70a"]),
            None,
        );
        assert_eq!(ten.install, Some(Install::Release("10.0.27")));
        assert!(ten.replace_legacy);

        // A copy holding only 9.3 shaders is covered by 9.3.64 and by 10.0.27,
        // which still ships the 9.3 line; the earlier release, its own era, wins.
        let single_line = action(poiyomi(), PackageNeed::default(), copy(&[POIYOMI_93]), None);
        assert_eq!(single_line.install, Some(Install::Release("9.3.64")));

        // Materials may ask for another line as long as the same release covers it.
        let with_material = action(poiyomi(), need(&[POIYOMI_93]), copy(&[POIYOMI_92]), None);
        assert_eq!(with_material.install, Some(Install::Release("9.3.64")));
        assert!(with_material.replace_legacy);

        for legacy in [
            copy(&[POIYOMI_93, UNKNOWN_GUID]),
            copy(&[POIYOMI_92, POIYOMI_100]),
            copy(&[]),
        ] {
            let action = action(poiyomi(), PackageNeed::default(), legacy, None);
            assert_eq!(action.install, None, "the copy imports unchanged");
            assert!(!action.replace_legacy);
        }

        // A material asking for a line the covering releases dropped keeps the copy.
        assert_eq!(
            action(poiyomi(), need(&[POIYOMI_100]), copy(&[POIYOMI_92]), None).install,
            None
        );
        // A selected source providing a dropped line keeps the copy too.
        let provided = HashMap::from([(POIYOMI_92.to_owned(), "Assets/x.shader".to_owned())]);
        let decided = package_action(
            KNOWN_PACKAGES,
            poiyomi(),
            &need(&[POIYOMI_100]),
            &copy(&[POIYOMI_93]),
            &provided,
            None,
            false,
        );
        assert_eq!(decided.install, None);
        assert!(!decided.replace_legacy);
        // A source providing a covered shader still lets the copy leave.
        let provided = HashMap::from([(POIYOMI_93.to_owned(), "Assets/x.shader".to_owned())]);
        let decided = package_action(
            KNOWN_PACKAGES,
            poiyomi(),
            &need(&[POIYOMI_93]),
            &copy(&[POIYOMI_92]),
            &provided,
            None,
            false,
        );
        assert_eq!(decided.install, Some(Install::Release("9.3.64")));

        // The project already carries the package.
        let installed = action(
            poiyomi(),
            PackageNeed::default(),
            copy(&[POIYOMI_93]),
            Some("9.3.64"),
        );
        assert_eq!(installed.install, None);
        assert!(!installed.replace_legacy);
    }

    #[test]
    fn liltoon_keeps_its_historical_install_and_copy_behavior() {
        let liltoon = index(KNOWN_PACKAGES, "jp.lilxyzw.liltoon");
        let shader = "df12117ecd77c31469c224178886498e";
        let bundled = action(liltoon, PackageNeed::default(), copy(&[]), None);
        assert_eq!(bundled.install, Some(Install::Latest));
        assert!(
            bundled.replace_legacy,
            "the TshirtShorts bundled copy still leaves for the official package"
        );

        assert_eq!(
            action(liltoon, need(&[shader]), LegacyCopy::default(), None).install,
            Some(Install::Latest)
        );
        assert_eq!(
            action(
                liltoon,
                need(&[shader]),
                LegacyCopy::default(),
                Some("1.10.0")
            )
            .install,
            None
        );
        assert_eq!(
            action(liltoon, PackageNeed::default(), LegacyCopy::default(), None).install,
            None
        );

        let pinned = package_action(
            KNOWN_PACKAGES,
            liltoon,
            &PackageNeed::default(),
            &copy(&[]),
            &HashMap::new(),
            None,
            true,
        );
        assert_eq!(pinned.install, None);
        assert!(
            pinned.replace_legacy,
            "a Recipe pin still skips the bundled copy"
        );

        let installed = action(liltoon, PackageNeed::default(), copy(&[]), Some("1.10.0"));
        assert_eq!(installed.install, None);
        assert!(installed.replace_legacy);
    }

    #[test]
    fn unlitwf_installs_latest_and_replaces_only_covered_copies() {
        let unlitwf = index(KNOWN_PACKAGES, "jp.whiteflare.unlitwf");
        let shader = "a3678756e883b9349ac22fce33313139";
        assert_eq!(
            action(unlitwf, need(&[shader]), LegacyCopy::default(), None).install,
            Some(Install::Latest)
        );
        assert_eq!(
            action(
                unlitwf,
                need(&[shader]),
                LegacyCopy::default(),
                Some("2.14.0")
            )
            .install,
            None
        );

        let covered = action(unlitwf, PackageNeed::default(), copy(&[shader]), None);
        assert_eq!(covered.install, Some(Install::Latest));
        assert!(covered.replace_legacy);
        let unknown = action(
            unlitwf,
            PackageNeed::default(),
            copy(&[shader, UNKNOWN_GUID]),
            None,
        );
        assert_eq!(unknown.install, None);
        assert!(!unknown.replace_legacy);
        let installed = action(
            unlitwf,
            PackageNeed::default(),
            copy(&[shader]),
            Some("2.9.0"),
        );
        assert_eq!(installed.install, None);
        assert!(!installed.replace_legacy);
    }

    #[test]
    fn guide_and_sdk_bundled_packages_never_install_or_replace() {
        let bundled = action(
            index(KNOWN_PACKAGES, "com.vrchat.base"),
            need(&["e765db0afa7ecfc44ade2e4e2491f65a"]),
            LegacyCopy::default(),
            None,
        );
        assert_eq!(bundled.install, None);
        assert!(!bundled.replace_legacy);

        let pro = action(
            index(KNOWN_PACKAGES, "com.poiyomi.pro"),
            need(&[POIYOMI_93]),
            copy(&[POIYOMI_93]),
            None,
        );
        assert_eq!(pro.install, None);
        assert!(!pro.replace_legacy);
    }

    #[test]
    fn legacy_copies_match_feed_declarations_then_table_fallbacks() {
        let entries = legacy_entries(KNOWN_PACKAGES, None);
        let owners: Vec<_> = entries
            .iter()
            .map(|entry| KNOWN_PACKAGES[entry.package].id)
            .collect();
        assert_eq!(
            owners,
            [
                "jp.lilxyzw.liltoon",
                "com.poiyomi.toon",
                "jp.whiteflare.unlitwf"
            ]
        );
        for (path, id) in [
            ("assets/liltoon", "jp.lilxyzw.liltoon"),
            ("assets/liltoon/shader/lts.shader", "jp.lilxyzw.liltoon"),
            (
                "assets/_poiyomishaders/shaders/9.3/toon/poiyomi toon.shader",
                "com.poiyomi.toon",
            ),
            (
                "assets/unlit_wf_shadersuite/runtime/shaders/unlit_wf_gem_opaque.shader",
                "jp.whiteflare.unlitwf",
            ),
        ] {
            let owner = legacy_owner(&entries, path).unwrap();
            assert_eq!(KNOWN_PACKAGES[owner].id, id, "{path}");
        }
        for path in [
            "assets/liltoonextras/readme.txt",
            "assets/amenbo/tshirt&shorts/material/liltoon.mat",
            "assets/_poiyomishaders.txt",
        ] {
            assert_eq!(legacy_owner(&entries, path), None, "{path}");
        }
    }

    #[test]
    fn cached_feeds_supply_legacy_paths_and_exact_line_versions() {
        let root = std::env::temp_dir().join(format!("vua-known-packages-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let liltoon = index(KNOWN_PACKAGES, "jp.lilxyzw.liltoon");
        let feed_url = KNOWN_PACKAGES[liltoon].feed_url;
        let cache = root.join("Repos").join(format!(
            "{}.json",
            vua_orchestrator::fnv1a_hex(feed_url.as_bytes())
        ));
        std::fs::create_dir_all(cache.parent().unwrap()).unwrap();
        std::fs::write(
            &cache,
            serde_json::to_vec(&serde_json::json!({
                "packages": {"jp.lilxyzw.liltoon": {"versions": {
                    "1.0.0": {"legacyFolders": {"Assets\\CustomLil": ""}},
                    "2.0.0": {"legacyFiles": {"Assets\\Lil\\Old.shader": ""}}
                }}}
            }))
            .unwrap(),
        )
        .unwrap();
        let entries = legacy_entries(KNOWN_PACKAGES, Some(&root));
        let entry = entries
            .iter()
            .find(|entry| entry.package == liltoon)
            .unwrap();
        assert_eq!(entry.folders, ["assets/customlil"]);
        assert_eq!(entry.files, ["assets/lil/old.shader"]);
        assert_eq!(
            legacy_owner(&entries, "assets/customlil/one.shader"),
            Some(liltoon)
        );
        assert_eq!(
            legacy_owner(&entries, "assets/liltoon/one.shader"),
            None,
            "the feed declaration replaces the default folder"
        );

        std::fs::write(
            &cache,
            b"{\"packages\":{\"jp.lilxyzw.liltoon\":{\"versions\":{\"1.0.0\":{}}}}}",
        )
        .unwrap();
        let entries = legacy_entries(KNOWN_PACKAGES, Some(&root));
        assert_eq!(
            legacy_owner(&entries, "assets/liltoon"),
            Some(liltoon),
            "an empty declaration falls back to the table"
        );
        std::fs::write(&cache, b"not json").unwrap();
        assert_eq!(
            legacy_owner(
                &legacy_entries(KNOWN_PACKAGES, Some(&root)),
                "assets/liltoon"
            ),
            Some(liltoon)
        );

        let poiyomi_feed = KNOWN_PACKAGES[poiyomi()].feed_url;
        let poiyomi_cache = root.join("Repos").join(format!(
            "{}.json",
            vua_orchestrator::fnv1a_hex(poiyomi_feed.as_bytes())
        ));
        // vrc-get nests the repository under "repo" in its cache documents.
        std::fs::write(
            &poiyomi_cache,
            serde_json::to_vec(&serde_json::json!({
                "repo": {"packages": {"com.poiyomi.toon": {"versions": {
                    "9.2.79": {}, "9.3.63": {}, "9.3.64": {}, "10.0.25": {}, "10.0.26-beta.1": {}
                }}}},
                "vrc-get": {"etag": "\"x\""}
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            latest_cached_line_version(&root, poiyomi_feed, "com.poiyomi.toon", "9.3").as_deref(),
            Some("9.3.64")
        );
        assert_eq!(
            latest_cached_line_version(&root, poiyomi_feed, "com.poiyomi.toon", "9.2").as_deref(),
            Some("9.2.79")
        );
        assert_eq!(
            latest_cached_line_version(&root, poiyomi_feed, "com.poiyomi.toon", "10.0").as_deref(),
            Some("10.0.25")
        );
        assert_eq!(
            latest_cached_line_version(&root, poiyomi_feed, "com.poiyomi.toon", "8.1"),
            None
        );
        let entries = legacy_entries(KNOWN_PACKAGES, Some(&root));
        assert_eq!(
            legacy_owner(&entries, "assets/_poiyomishaders/one.shader"),
            Some(poiyomi()),
            "the nested cache declares no legacy paths, so the table fallback applies"
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn table_entries_carry_evidence_and_pin_only_material_driven_feeds() {
        for package in KNOWN_PACKAGES {
            assert!(package.id.contains('.'), "{}", package.id);
            assert!(package.feed_url.starts_with("https://"), "{}", package.id);
            assert!(
                package.official_url.starts_with("https://"),
                "{}",
                package.id
            );
            assert!(!package.license.is_empty(), "{}", package.id);
            assert!(
                package.license_url.starts_with("https://"),
                "{}",
                package.id
            );
            assert_eq!(package.license_checked.len(), 10, "{}", package.id);
            let valid = |guid: &&str| {
                guid.len() == 32
                    && guid
                        .bytes()
                        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            };
            assert!(package.shader_guids.iter().all(valid), "{}", package.id);
            assert!(
                package
                    .version_lines
                    .iter()
                    .flat_map(|line| line.shader_guids)
                    .all(valid),
                "{}",
                package.id
            );
            assert!(
                package
                    .releases
                    .iter()
                    .flat_map(|release| release.shader_guids)
                    .all(valid),
                "{}",
                package.id
            );
        }
        // No Poiyomi GUID is shared between two version lines.
        let poiyomi_lines = KNOWN_PACKAGES[poiyomi()].version_lines;
        let all: BTreeSet<_> = poiyomi_lines
            .iter()
            .flat_map(|line| line.shader_guids)
            .collect();
        assert_eq!(
            all.len(),
            poiyomi_lines
                .iter()
                .map(|line| line.shader_guids.len())
                .sum::<usize>()
        );
        assert_eq!(
            poiyomi_lines
                .iter()
                .map(|line| line.line)
                .collect::<Vec<_>>(),
            ["8.1", "9.0", "9.1", "9.2", "9.3", "10.0"]
        );

        // Recorded releases are unique, ordered oldest first, each carries its
        // line's own shaders, and every version line is inside at least one
        // recorded set, so every detected material shader can be replaced.
        let package = &KNOWN_PACKAGES[poiyomi()];
        let versions: Vec<_> = package
            .releases
            .iter()
            .map(|release| release.version)
            .collect();
        let unique: BTreeSet<_> = versions.iter().copied().collect();
        assert_eq!(unique.len(), versions.len());
        let sorted = versions.iter().map(|v| version_key(v)).collect::<Vec<_>>();
        assert!(
            sorted.windows(2).all(|pair| pair[0] < pair[1]),
            "releases are ordered oldest first"
        );
        for release in package.releases {
            let line = package
                .line_for_version(release.version)
                .unwrap_or_else(|| panic!("{} belongs to no recorded line", release.version));
            let own = package
                .version_lines
                .iter()
                .find(|l| l.line == line)
                .unwrap();
            assert!(
                own.shader_guids
                    .iter()
                    .all(|guid| release.shader_guids.contains(guid)),
                "{} must carry its own line's shaders",
                release.version
            );
        }
        for line in package.version_lines {
            assert!(
                package.releases.iter().any(|release| line
                    .shader_guids
                    .iter()
                    .all(|guid| release.shader_guids.contains(guid))),
                "no recorded release covers line {}",
                line.line
            );
        }

        // SDK and Modular Avatar pins keep their existing registration path during
        // project creation; material-driven auto packages and pinned Avatar Optimizer
        // register their feed.
        let pins = BTreeMap::from([
            ("com.vrchat.avatars".to_owned(), "3.10.5".to_owned()),
            ("nadena.dev.modular-avatar".to_owned(), "1.18.7".to_owned()),
            ("jp.lilxyzw.liltoon".to_owned(), "1.10.0".to_owned()),
            ("com.poiyomi.toon".to_owned(), "9.3.64".to_owned()),
            (
                AVATAR_OPTIMIZER_ID.to_owned(),
                AVATAR_OPTIMIZER_PINNED_VERSION.to_owned(),
            ),
            ("jp.lilxyzw.lilycalinventory".to_owned(), "1.5.2".to_owned()),
            ("net.rs64.tex-trans-tool".to_owned(), "1.0.2".to_owned()),
            ("jp.suzuryg.face-emo".to_owned(), "1.7.0".to_owned()),
            (
                "jp.pokemori.vrm-converter-for-vrchat".to_owned(),
                "41.5.2".to_owned(),
            ),
            ("jp.lilxyzw.avatar-utils".to_owned(), "2.1.2".to_owned()),
            (
                "net.narazaka.vrchat.floor-adjuster".to_owned(),
                "1.1.2".to_owned(),
            ),
            (
                "com.github.kurotu.vrc-quest-tools".to_owned(),
                "3.0.3".to_owned(),
            ),
            ("com.vrmc.univrm".to_owned(), "0.128.1".to_owned()),
            (
                "jp.lilxyzw.ndmfmeshsimplifier".to_owned(),
                "0.3.0".to_owned(),
            ),
            ("dev.hai-vr.cge".to_owned(), "3.3.1".to_owned()),
        ]);
        let ids: Vec<_> = pinned_auto_packages(KNOWN_PACKAGES, &pins)
            .map(|package| package.id)
            .collect();
        assert_eq!(
            ids,
            [
                "jp.lilxyzw.liltoon",
                "com.poiyomi.toon",
                AVATAR_OPTIMIZER_ID,
                "jp.lilxyzw.lilycalinventory",
                "net.rs64.tex-trans-tool",
                "jp.suzuryg.face-emo",
                "jp.lilxyzw.avatar-utils",
                "net.narazaka.vrchat.floor-adjuster",
                "com.github.kurotu.vrc-quest-tools",
                "jp.lilxyzw.ndmfmeshsimplifier",
                "dev.hai-vr.cge",
            ]
        );
        assert!(avatar_optimizer_compatible(Some("3.10.5"), Some("1.14.8")));
        assert!(!avatar_optimizer_compatible(Some("3.6.9"), Some("1.14.8")));
        assert!(!avatar_optimizer_compatible(Some("3.11.0"), Some("1.14.8")));
        assert!(!avatar_optimizer_compatible(Some("3.10.5"), Some("1.7.9")));
        assert!(!avatar_optimizer_compatible(Some("3.10.5"), Some("2.0.0")));
        assert!(!avatar_optimizer_compatible(
            Some("3.10.5-beta.1"),
            Some("1.14.8")
        ));
    }

    #[test]
    fn guide_diagnostics_name_version_lines_and_material_counts() {
        let nine_two = material(POIYOMI_92, "");
        let nine_three = material(POIYOMI_93, "");
        let unknown = material(UNKNOWN_GUID, "");
        let materials = [
            nine_two.as_slice(),
            nine_three.as_slice(),
            unknown.as_slice(),
        ];

        let diagnostics = guide_diagnostics(KNOWN_PACKAGES, materials, &BTreeMap::new());
        assert_eq!(
            diagnostics.len(),
            1,
            "one warning per package, not per line"
        );
        assert_eq!(diagnostics[0].code, "amf.package.guide");
        assert_eq!(diagnostics[0].severity, DiagnosticSeverity::Warning);
        assert_eq!(diagnostics[0].message, "2 materials need Poiyomi Toon Shader 9.2 and 9.3; get it from https://www.poiyomi.com/.");

        let single = [nine_three.as_slice()];
        let diagnostics = guide_diagnostics(KNOWN_PACKAGES, single, &BTreeMap::new());
        assert_eq!(
            diagnostics[0].message,
            "1 material needs Poiyomi Toon Shader 9.3; get it from https://www.poiyomi.com/."
        );

        // The project carries 10.0 while the material needs 9.3: the guide names 9.3.
        let installed = BTreeMap::from([("com.poiyomi.toon".to_owned(), "10.0.25".to_owned())]);
        let diagnostics = guide_diagnostics(KNOWN_PACKAGES, materials, &installed);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message, "2 materials need Poiyomi Toon Shader 9.2 and 9.3; get it from https://www.poiyomi.com/.");

        // A project on the needed line needs no guide; another line still gets one.
        let installed = BTreeMap::from([("com.poiyomi.toon".to_owned(), "9.3.64".to_owned())]);
        assert!(guide_diagnostics(KNOWN_PACKAGES, [nine_three.as_slice()], &installed).is_empty());
        assert_eq!(
            guide_diagnostics(KNOWN_PACKAGES, materials, &installed).len(),
            1
        );
    }

    #[test]
    fn guide_diagnostics_without_version_lines_keep_their_wording() {
        const AUTO_GUID: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const BUNDLED_GUID: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let entry = |id: &'static str,
                     display_name: &'static str,
                     delivery: Delivery,
                     markers: &'static [&'static str],
                     guids: &'static [&'static str]| KnownPackage {
            id,
            display_name,
            feed_url: "",
            official_url: "https://example.com/get",
            license: "MIT",
            license_url: "",
            license_checked: "",
            delivery,
            material_markers: markers,
            shader_guids: guids,
            version_lines: &[],
            releases: &[],
            legacy_policy: LegacyPolicy::ReplaceWhenCovered,
            legacy_folders: &[],
            legacy_files: &[],
        };
        let table = [
            entry(
                "example.auto",
                "Example Auto",
                Delivery::Auto,
                &[],
                &[AUTO_GUID],
            ),
            entry(
                "example.guide",
                "Example Guide",
                Delivery::Guide,
                &["_ExampleGuideVersion"],
                &[],
            ),
            entry(
                "example.bundled",
                "Example Bundled",
                Delivery::Bundled,
                &[],
                &[BUNDLED_GUID],
            ),
        ];
        let auto = material(AUTO_GUID, "");
        let guide_one = material(UNKNOWN_GUID, "  m_Floats:\n    - _ExampleGuideVersion: 3\n");
        let guide_two = material(UNKNOWN_GUID, "    - _ExampleGuideVersion: 4\n");
        let bundled = material(BUNDLED_GUID, "");
        let unknown = material("cccccccccccccccccccccccccccccccc", "");
        let materials = [
            auto.as_slice(),
            guide_one.as_slice(),
            guide_two.as_slice(),
            bundled.as_slice(),
            unknown.as_slice(),
        ];

        let diagnostics = guide_diagnostics(&table, materials, &BTreeMap::new());
        assert_eq!(
            diagnostics.len(),
            2,
            "the bundled and unknown materials produce no guide"
        );
        assert_eq!(
            diagnostics[0].message,
            "1 material needs Example Auto; get it from https://example.com/get."
        );
        assert_eq!(
            diagnostics[1].message,
            "2 materials need Example Guide; get it from https://example.com/get."
        );

        let installed = BTreeMap::from([("example.auto".to_owned(), "1.0.0".to_owned())]);
        let diagnostics = guide_diagnostics(&table, materials, &installed);
        assert_eq!(
            diagnostics.len(),
            1,
            "an installed auto package needs no guide"
        );
        assert_eq!(
            diagnostics[0].message,
            "2 materials need Example Guide; get it from https://example.com/get."
        );
    }
}

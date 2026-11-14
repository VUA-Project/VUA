//! Editor version classification against the accepted support matrix
//! (`docs/compatibility/unity-editor`): production target `2022.3.22f1`
//! exactly; migration sources `2019.4.31f1` / `2022.3.6f1`; every other
//! complete version string reports its exact difference and installation
//! guidance; Tuanjie is identified for diagnostics and the Unity path
//! stops there.
//!
//! The version string is a capability identifier, not a SemVer range:
//! `2022.3.22f1` and `2022.3.22f1c1` are different editors and only the
//! former is the production target. A `c<n>` suffix marks a Unity China
//! distribution build — the policy creates no separate product class for
//! a distribution suffix, so it stays `other_unity_version` but earns the
//! specific unsupported-environment diagnosis. A `t` release letter marks
//! a Tuanjie-family editor; that letter mapping is an assumption recorded
//! in the environment detection spike findings and must be re-verified
//! against a real Tuanjie install before it gates anything.

use serde::{Deserialize, Serialize};

/// The only editor eligible for full AMF and Unity Bridge work.
pub const PRODUCTION_TARGET: &str = "2022.3.22f1";

/// Versions accepted only as project-migration inputs.
pub const MIGRATION_SOURCES: [&str; 2] = ["2019.4.31f1", "2022.3.6f1"];

/// Stable spike guidance codes; findings and fix plans key on them.
pub mod codes {
    pub const EDITOR_PRODUCTION_TARGET: &str = "vua.env_managers.editor_production_target";
    pub const EDITOR_MIGRATION_SOURCE: &str = "vua.env_managers.editor_migration_source";
    pub const EDITOR_OFF_TARGET: &str = "vua.env_managers.editor_off_target";
    pub const EDITOR_CHINA_DISTRIBUTION: &str = "vua.env_managers.editor_china_distribution";
    pub const EDITOR_TUANJIE_UNSUPPORTED: &str = "vua.env_managers.editor_tuanjie_unsupported";
}

/// Support-matrix class of one editor version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorClass {
    ProductionTarget,
    MigrationSource,
    OtherUnityVersion,
    TuanjieFamily,
}

/// One parsed complete editor version string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedEditorVersion {
    pub display: String,
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    /// Release kind letter: `f`inal, `p`atch, `b`eta, `a`lpha, `t`uanjie.
    pub release_kind: char,
    pub release_number: u64,
    /// Unity China distribution suffix (`2022.3.22f1c1` → `Some(1)`).
    pub china_suffix: Option<u64>,
}

/// Parses a complete version string such as `2022.3.22f1` or
/// `2022.3.22f1c1`. Names that are not complete version strings return
/// `None`; the caller skips them, matching Hub's own directory behavior.
pub fn parse_editor_version(raw: &str) -> Option<ParsedEditorVersion> {
    let raw = raw.trim();
    let mut parts = raw.splitn(3, '.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next()?.parse::<u64>().ok()?;
    let rest = parts.next()?;

    let digits_end = rest
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(rest.len());
    let patch = rest[..digits_end].parse::<u64>().ok()?;
    let remainder = &rest[digits_end..];
    let mut letters = remainder.chars();
    let release_kind = letters.next()?;
    if !matches!(release_kind, 'f' | 'p' | 'b' | 'a' | 't') {
        return None;
    }
    let tail = letters.as_str();
    let (release_part, china_suffix) = match tail.split_once('c') {
        Some((release, china)) => {
            let suffix = china.parse::<u64>().ok()?;
            (release, Some(suffix))
        }
        None => (tail, None),
    };
    let release_number = release_part.parse::<u64>().ok()?;

    Some(ParsedEditorVersion {
        display: raw.to_owned(),
        major,
        minor,
        patch,
        release_kind,
        release_number,
        china_suffix,
    })
}

/// Classifies one parsed version per the support matrix and returns the
/// stable guidance code the environment page renders.
pub fn classify_editor(version: &ParsedEditorVersion) -> (EditorClass, &'static str) {
    if version.release_kind == 't' {
        return (
            EditorClass::TuanjieFamily,
            codes::EDITOR_TUANJIE_UNSUPPORTED,
        );
    }
    if version.display == PRODUCTION_TARGET {
        return (
            EditorClass::ProductionTarget,
            codes::EDITOR_PRODUCTION_TARGET,
        );
    }
    if MIGRATION_SOURCES.contains(&version.display.as_str()) {
        return (EditorClass::MigrationSource, codes::EDITOR_MIGRATION_SOURCE);
    }
    if version.china_suffix.is_some() {
        let base = format!(
            "{}.{}.{}{}{}",
            version.major,
            version.minor,
            version.patch,
            version.release_kind,
            version.release_number
        );
        if base == PRODUCTION_TARGET {
            return (
                EditorClass::OtherUnityVersion,
                codes::EDITOR_CHINA_DISTRIBUTION,
            );
        }
    }
    (EditorClass::OtherUnityVersion, codes::EDITOR_OFF_TARGET)
}

/// Convenience for callers that start from a raw version string.
pub fn classify_version_string(raw: &str) -> Option<(EditorClass, &'static str)> {
    parse_editor_version(raw).map(|parsed| classify_editor(&parsed))
}

/// Extracts the editor version an editor executable path declares, by
/// walking its ancestor directory names for one that parses as a complete
/// Unity version (Hub layout: `.../2022.3.22f1/Editor/Unity.exe`). This is
/// an observation of the configured path, never a guess: no parseable
/// ancestor → `None`, and the caller states the version as unknown instead
/// of inventing one. Deepest match wins (a nested version directory is more
/// specific than an outer one).
pub fn editor_version_from_path(path: &std::path::Path) -> Option<String> {
    path.ancestors()
        .filter_map(|ancestor| ancestor.file_name())
        .filter_map(|name| name.to_str())
        .find_map(|name| parse_editor_version(name).map(|parsed| parsed.display))
}

#[cfg(test)]
mod editor_version_path_tests {
    use super::*;

    #[test]
    fn hub_layout_yields_the_version_directory() {
        let path =
            std::path::Path::new("C:/Program Files/Unity/Hub/Editor/2022.3.22f1/Editor/Unity.exe");
        assert_eq!(
            editor_version_from_path(path).as_deref(),
            Some("2022.3.22f1")
        );
    }

    #[test]
    fn unparseable_paths_state_no_version_instead_of_guessing() {
        assert_eq!(
            editor_version_from_path(std::path::Path::new("D:/tools/unity-editor.exe")),
            None
        );
        assert_eq!(editor_version_from_path(std::path::Path::new("")), None);
    }
}

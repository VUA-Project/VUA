//! Verified ZIP storage expansion. Original bytes and later production admission
//! are independent of this bounded, cancellable filesystem operation.
use crate::artifact_inspection::hex_lower;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use vua_bdl_store::{ArchiveMember, BdlStore, StoredArtifactCopy};

const MAX_MEMBERS: usize = 10_000;
const MAX_EXPANDED: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionReport {
    pub archive_copy_id: String,
    pub state: &'static str,
    pub files: usize,
    pub unitypackage_candidates: usize,
    pub error_code: Option<String>,
}

pub(crate) fn is_zip(path: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
}

pub(crate) fn expand(
    store: &BdlStore,
    root: &Path,
    parent: &StoredArtifactCopy,
    now: &str,
    cancelled: &dyn Fn() -> bool,
    progress: &dyn Fn(usize, u64),
) -> ExpansionReport {
    let outcome = expand_inner(store, root, parent, now, cancelled, progress, MAX_EXPANDED);
    let mut report = match outcome {
        Ok((files, candidates)) => ExpansionReport {
            archive_copy_id: parent.copy_id.clone(),
            state: "expanded",
            files,
            unitypackage_candidates: candidates,
            error_code: None,
        },
        Err(code) => ExpansionReport {
            archive_copy_id: parent.copy_id.clone(),
            state: if code == "cancelled" {
                "cancelled"
            } else {
                "failed"
            },
            files: 0,
            unitypackage_candidates: 0,
            error_code: Some(format!("vua.library.{code}")),
        },
    };
    if let Some(error) = &report.error_code {
        if store
            .record_archive_failure(parent, report.state, error, now)
            .is_err()
        {
            report.error_code = Some("vua.library.expansion_state_unconfirmed".into());
        }
    }
    report
}

fn regular(meta: &fs::Metadata) -> bool {
    meta.is_file() && !reparse(meta)
}
fn reparse(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

pub(crate) fn is_reparse(meta: &fs::Metadata) -> bool {
    reparse(meta)
}

fn digest(path: &Path, cancelled: &dyn Fn() -> bool) -> Result<String, &'static str> {
    let mut input = File::open(path).map_err(|_| "expansion_io_failed")?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        if cancelled() {
            return Err("cancelled");
        }
        let read = input.read(&mut buffer).map_err(|_| "expansion_io_failed")?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(format!("sha256:{}", hex_lower(&hash.finalize())))
}

/// A portable Windows filename check, including ADS, drive roots, device names,
/// trailing dots/spaces and separators used by legacy ZIP writers.
fn member_path(raw: &str) -> Result<String, &'static str> {
    let normalized = raw.replace('\\', "/");
    let normalized = normalized.strip_suffix('/').unwrap_or(&normalized);
    if normalized.is_empty() || normalized.len() > 2048 {
        return Err("zip_unsafe_path");
    }
    for part in normalized.split('/') {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with(['.', ' '])
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*".contains(c))
        {
            return Err("zip_unsafe_path");
        }
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        }) {
            return Err("zip_unsafe_path");
        }
    }
    Ok(normalized.to_owned())
}

struct OwnedTree {
    path: PathBuf,
    root: PathBuf,
}
impl Drop for OwnedTree {
    fn drop(&mut self) {
        // Only directories created/renamed by this operation, under the checked
        // warehouse, are eligible for recursive cleanup.
        if fs::symlink_metadata(&self.path).is_ok_and(|meta| meta.is_dir() && !reparse(&meta))
            && fs::canonicalize(&self.path).is_ok_and(|path| path.starts_with(&self.root))
        {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

fn tree_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), &'static str> {
    for item in fs::read_dir(dir).map_err(|_| "expansion_io_failed")? {
        let item = item.map_err(|_| "expansion_io_failed")?;
        let meta = fs::symlink_metadata(item.path()).map_err(|_| "expansion_io_failed")?;
        if reparse(&meta) {
            return Err("expansion_content_changed");
        }
        if meta.is_dir() {
            tree_files(&item.path(), files)?;
        } else if regular(&meta) {
            files.push(item.path());
        } else {
            return Err("expansion_content_changed");
        }
    }
    Ok(())
}

fn expand_inner(
    store: &BdlStore,
    root: &Path,
    parent: &StoredArtifactCopy,
    now: &str,
    cancelled: &dyn Fn() -> bool,
    progress: &dyn Fn(usize, u64),
    limit: u64,
) -> Result<(usize, usize), &'static str> {
    if parent.copy_id.is_empty()
        || parent.copy_id.len() > 128
        || !parent
            .copy_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
    {
        return Err("zip_unsafe_path");
    }
    let root = fs::canonicalize(root).map_err(|_| "expansion_io_failed")?;
    let parent_path = Path::new(&parent.stored_path);
    let meta = fs::symlink_metadata(parent_path).map_err(|_| "expansion_io_failed")?;
    if !regular(&meta)
        || !fs::canonicalize(parent_path)
            .map_err(|_| "expansion_io_failed")?
            .starts_with(&root)
    {
        return Err("zip_unsafe_path");
    }
    if digest(parent_path, cancelled)? != parent.artifact_sha256 {
        return Err("expansion_content_changed");
    }
    // The entry root, rather than the archive's nesting folder, owns expansions.
    let relative = Path::new(&parent.relative_path);
    let mut entry = parent_path.to_owned();
    for _ in relative.components() {
        entry.pop();
    }
    let entry = fs::canonicalize(entry).map_err(|_| "expansion_io_failed")?;
    if !entry.starts_with(&root) || entry == root {
        return Err("zip_unsafe_path");
    }
    let expanded = entry.join("expanded");
    if !expanded.exists() {
        fs::create_dir(&expanded).map_err(|_| "expansion_io_failed")?;
    }
    let meta = fs::symlink_metadata(&expanded).map_err(|_| "expansion_io_failed")?;
    if !meta.is_dir() || reparse(&meta) {
        return Err("zip_unsafe_path");
    }
    let target = expanded.join(&parent.copy_id);
    if target.exists() {
        let meta = fs::symlink_metadata(&target).map_err(|_| "expansion_io_failed")?;
        if !meta.is_dir() || reparse(&meta) {
            return Err("expansion_content_changed");
        }
        let known = store
            .archive_members(&parent.copy_id)
            .map_err(|_| "expansion_store_failed")?;
        let known: HashMap<_, _> = known
            .iter()
            .map(|member| (PathBuf::from(&member.stored_path), &member.sha256))
            .collect();
        let mut actual = Vec::new();
        tree_files(&target, &mut actual)?;
        for file in actual {
            if known
                .get(&file)
                .is_none_or(|sha| digest(&file, cancelled).as_ref() != Ok(*sha))
            {
                if cancelled() {
                    return Err("cancelled");
                }
                return Err("expansion_content_changed");
            }
        }
    }
    let mut zip = zip::ZipArchive::new(File::open(parent_path).map_err(|_| "expansion_io_failed")?)
        .map_err(|_| "zip_invalid")?;
    if zip.len() > MAX_MEMBERS {
        return Err("zip_limit_exceeded");
    }
    let mut names = HashMap::new();
    let mut declared = 0u64;
    let mut members = Vec::new();
    for index in 0..zip.len() {
        if cancelled() {
            return Err("cancelled");
        }
        let file = zip.by_index_raw(index).map_err(|_| "zip_invalid")?;
        if file.encrypted() {
            return Err("zip_encrypted");
        }
        if file.is_symlink()
            || file
                .unix_mode()
                .is_some_and(|mode| !matches!(mode & 0xf000, 0 | 0x8000 | 0x4000))
        {
            return Err("zip_unsafe_path");
        }
        let name = member_path(file.name())?;
        let key = name.to_lowercase();
        if names.insert(key, file.is_dir()).is_some() {
            return Err("zip_path_collision");
        }
        declared = declared
            .checked_add(file.size())
            .filter(|total| *total <= limit)
            .ok_or("zip_limit_exceeded")?;
        members.push((index, name, file.is_dir(), file.size()));
    }
    // A file cannot also be another member's parent directory on Windows.
    for (_, name, _, _) in &members {
        let mut prefix = String::new();
        let parts: Vec<_> = name.split('/').collect();
        for part in &parts[..parts.len() - 1] {
            if !prefix.is_empty() {
                prefix.push('/');
            }
            prefix.push_str(part);
            if names.get(&prefix.to_lowercase()) == Some(&false) {
                return Err("zip_path_collision");
            }
        }
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let stage = OwnedTree {
        path: expanded.join(format!(".vua-expand-{stamp:x}")),
        root: root.clone(),
    };
    fs::create_dir(&stage.path).map_err(|_| "expansion_io_failed")?;
    let mut retained = Vec::new();
    let mut bytes = 0u64;
    let mut candidates = 0;
    let mut buffer = vec![0u8; 1024 * 1024];
    for (index, name, directory, expected_size) in members {
        if cancelled() {
            return Err("cancelled");
        }
        let destination = stage.path.join(&name);
        if directory {
            fs::create_dir_all(destination).map_err(|_| "expansion_io_failed")?;
            continue;
        }
        fs::create_dir_all(destination.parent().ok_or("zip_unsafe_path")?)
            .map_err(|_| "expansion_io_failed")?;
        let mut file = zip.by_index(index).map_err(|_| "zip_unsupported")?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| "expansion_io_failed")?;
        let mut hash = Sha256::new();
        let mut size = 0u64;
        loop {
            if cancelled() {
                return Err("cancelled");
            }
            let read = file.read(&mut buffer).map_err(|_| "zip_invalid")?;
            if read == 0 {
                break;
            }
            bytes = bytes
                .checked_add(read as u64)
                .filter(|total| *total <= limit)
                .ok_or("zip_limit_exceeded")?;
            size += read as u64;
            if size > expected_size {
                return Err("zip_invalid");
            }
            hash.update(&buffer[..read]);
            output
                .write_all(&buffer[..read])
                .map_err(|_| "expansion_io_failed")?;
            if bytes / (16 * 1024 * 1024) != (bytes - read as u64) / (16 * 1024 * 1024) {
                progress(retained.len(), bytes);
            }
        }
        if size != expected_size {
            return Err("zip_invalid");
        }
        output.sync_all().map_err(|_| "expansion_io_failed")?;
        if Path::new(&name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("unitypackage"))
        {
            candidates += 1;
        }
        retained.push(ArchiveMember {
            relative_path: format!("expanded/{}/{}", parent.copy_id, name),
            stored_path: target.join(&name).to_string_lossy().into_owned(),
            member_path: name,
            sha256: format!("sha256:{}", hex_lower(&hash.finalize())),
            size_bytes: size,
        });
        progress(retained.len(), bytes);
    }
    if cancelled() {
        return Err("cancelled");
    }
    let backup = expanded.join(format!(".vua-expand-old-{stamp:x}"));
    let old = if target.exists() {
        fs::rename(&target, &backup).map_err(|_| "expansion_io_failed")?;
        Some(OwnedTree {
            path: backup.clone(),
            root,
        })
    } else {
        None
    };
    if fs::rename(&stage.path, &target).is_err() {
        if old.is_some() && fs::rename(&backup, &target).is_err() {
            std::mem::forget(old);
            return Err("expansion_recovery_required");
        }
        return Err("expansion_io_failed");
    }
    if store
        .record_archive_members(parent, &retained, now)
        .is_err()
    {
        if fs::rename(&target, &stage.path).is_err() {
            std::mem::forget(old);
            return Err("expansion_recovery_required");
        }
        if old.is_some() && fs::rename(&backup, &target).is_err() {
            std::mem::forget(old);
            return Err("expansion_recovery_required");
        }
        return Err("expansion_store_failed");
    }
    drop(old);
    Ok((retained.len(), candidates))
}

#[cfg(test)]
#[path = "zip_intake_tests.rs"]
mod tests;

use crate::{ProjectRef, SnapshotRef, SnapshotStore};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const SNAPSHOT_SCOPES: [&str; 3] = ["Assets", "Packages", "ProjectSettings"];

// --- 验证过的范围快照（E-PKG 审阅）---
//
// 原型快照（下方 SnapshotStore impl）只会整目录复制 Assets/Packages/
// ProjectSettings 三件套，没有清单也不验证。引擎切片需要的是"小范围 +
// 有清单 + 验证过才可用"的版本，于是有了这一组 API：
//
// - `create_verified(project, id, scopes)`：按作用域复制（可以是目录也
//   可以是单个文件，如 `vpm-manifest.json`），边复制边收集
//   {相对路径, 字节数} 清单 → **回读验证**（每个记录的文件真的存在、
//   大小真的相符）→ 通过才把 `verified: true` 的清单写进快照目录。
//   任何一步失败：整个快照目录被删除——**半成品快照不允许存在**，
//   否则总有一天有人会把没验过的快照恢复回去。
// - `restore_verified(project, snapshot)`：恢复前先重读清单并再次核对
//   （快照目录可能被人动过手脚——有测试专门篡改快照后断言恢复拒绝），
//   通过后把当前状态**改名隔离**进 `.vua/recovery/<id>/`（不是删除！
//   恢复错了还能翻回来），再从快照复制回去。
// - 清单里只有大小没有内容哈希：E 冒烟够用；抗碰撞性要求出现在
//   H-RECOVERY 的清单里。
//
// `SnapshotManifestV1` 就是写进每个快照目录的 manifest.json 的形状。

/// Manifest recorded inside every verified snapshot (ORC-STO-006 minimal:
/// scope, file list with sizes, verification result). Content hashes arrive
/// with the H-RECOVERY hardening slice.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifestV1 {
    pub schema_version: u8,
    pub snapshot_id: String,
    /// Normalized digest of the owning project root: the three-way
    /// recovery check (request root ↔ record ↔ manifest) anchors here.
    pub project_identity: String,
    pub scopes: Vec<String>,
    pub entries: Vec<SnapshotManifestEntry>,
    pub verified: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifestEntry {
    /// Snapshot-relative path with `/` separators.
    pub path: String,
    pub size: u64,
}

/// A scope-limited snapshot with a verified manifest. Restoration refuses
/// unverified or tampered snapshots instead of guessing (ORC-WF-005).
pub struct VerifiedSnapshot {
    pub reference: SnapshotRef,
    pub scopes: Vec<String>,
    pub entries: Vec<SnapshotManifestEntry>,
}

impl std::fmt::Debug for VerifiedSnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("VerifiedSnapshot")
            .field("reference", &self.reference)
            .field("scopes", &self.scopes)
            .field("entry_count", &self.entries.len())
            .finish()
    }
}

const SNAPSHOT_MANIFEST_SCHEMA_VERSION: u8 = 2;
const SNAPSHOT_MANIFEST_FILE: &str = "manifest.json";

pub struct FileSystemProjectStore;

/// Content fingerprint for the project scopes that a workflow owns. Symlinks
/// are rejected so a project cannot smuggle external files into plan binding.
pub fn project_tree_fingerprint(
    project_root: &Path,
    scopes: &[&str],
) -> io::Result<Option<String>> {
    use sha2::{Digest, Sha256};
    if !project_root.exists() {
        return Ok(None);
    }
    let mut files = Vec::new();
    for scope in scopes {
        validate_scope(scope)?;
        let path = project_root.join(scope);
        if path.exists() {
            collect_fingerprint_files(project_root, &path, &mut files)?;
        }
    }
    files.sort();
    let mut digest = Sha256::new();
    digest.update(b"vua-project-tree-v1\0");
    for relative in files {
        let normalized = relative.to_string_lossy().replace('\\', "/");
        let mut file = fs::File::open(project_root.join(&relative))?;
        let length = file.metadata()?.len();
        digest.update((normalized.len() as u64).to_le_bytes());
        digest.update(normalized.as_bytes());
        digest.update(length.to_le_bytes());
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
    }
    let mut encoded = String::with_capacity(64);
    for byte in digest.finalize() {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to String");
    }
    Ok(Some(format!("sha256:{encoded}")))
}

/// The cached fingerprint algorithm (AMF work projects). Each file's content hash is
/// remembered by path, size and nanosecond modification time, so an unchanged tree is
/// fingerprinted from metadata alone. The cache lives in `.vua/fingerprint-cache.json`,
/// outside the fingerprinted scopes.
const FINGERPRINT_CACHE_VERSION: u8 = 2;
const FINGERPRINT_CACHE_FILE: &str = "fingerprint-cache.json";
/// A cache larger than this is treated as absent and not rewritten: the file grows with
/// the project, and a corrupt or foreign file must not be read into memory unbounded.
const FINGERPRINT_CACHE_MAX_BYTES: usize = 16 * 1024 * 1024;
/// Values produced before this algorithm carry the plain `sha256:` prefix.
pub const FINGERPRINT_V1_PREFIX: &str = "sha256:";
/// The prefix every value of this algorithm carries, so records name their algorithm.
pub const FINGERPRINT_V2_PREFIX: &str = "vua-project-tree-v2:";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FingerprintCacheEntry {
    size: u64,
    /// Modification time split into seconds and nanoseconds since the UNIX epoch;
    /// JSON numbers cannot carry the combined nanosecond count.
    modified_secs: u64,
    modified_nanos: u32,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FingerprintCacheDocument {
    version: u8,
    files: std::collections::BTreeMap<String, FingerprintCacheEntry>,
}

/// One file the fingerprint walks: its normalized project-relative path and the
/// metadata the cache is keyed by.
struct FingerprintFile {
    normalized: String,
    size: u64,
    modified: SystemTime,
}

/// Content fingerprint for the project scopes with a per-file hash cache. Symlinks are
/// rejected like `project_tree_fingerprint`; the total combines each file's sorted path,
/// length and content hash under the `vua-project-tree-v2` domain, so values name their
/// algorithm and never collide with the uncached v1 value.
pub fn project_tree_fingerprint_cached(
    project_root: &Path,
    scopes: &[&str],
) -> io::Result<Option<String>> {
    use sha2::{Digest, Sha256};
    if !project_root.exists() {
        return Ok(None);
    }
    let mut relatives = Vec::new();
    for scope in scopes {
        validate_scope(scope)?;
        let path = project_root.join(scope);
        if path.exists() {
            collect_fingerprint_files(project_root, &path, &mut relatives)?;
        }
    }
    let mut files: Vec<FingerprintFile> = relatives
        .into_iter()
        .map(|relative| {
            let metadata = fs::symlink_metadata(project_root.join(&relative))?;
            Ok(FingerprintFile {
                normalized: relative.to_string_lossy().replace('\\', "/"),
                size: metadata.len(),
                modified: metadata.modified()?,
            })
        })
        .collect::<io::Result<Vec<_>>>()?;
    // Sort by the normalized path so the digest does not depend on directory order.
    files.sort_by(|a, b| a.normalized.cmp(&b.normalized));

    let cache_path = project_root.join(".vua").join(FINGERPRINT_CACHE_FILE);
    let cache = read_fingerprint_cache(&cache_path);
    let mut updated = std::collections::BTreeMap::new();
    let mut digest = Sha256::new();
    digest.update(b"vua-project-tree-v2\0");
    for file in &files {
        let walk_time = modified_secs(file.modified);
        let entry = match cache.files.get(&file.normalized).filter(|cached| {
            cacheable(cached)
                && cached.size == file.size
                && (cached.modified_secs, cached.modified_nanos) == walk_time
        }) {
            Some(cached) => cached.clone(),
            None => {
                // Hash the file as it is now and record the metadata read from the open
                // file: a file that changes between walk and hash rehashes next run.
                let mut open = fs::File::open(project_root.join(&file.normalized))?;
                let metadata = open.metadata()?;
                let mut hasher = Sha256::new();
                let mut buffer = [0_u8; 64 * 1024];
                loop {
                    let read = open.read(&mut buffer)?;
                    if read == 0 {
                        break;
                    }
                    hasher.update(&buffer[..read]);
                }
                let content: [u8; 32] = hasher.finalize().into();
                let (secs, nanos) = modified_secs(metadata.modified()?);
                FingerprintCacheEntry {
                    size: metadata.len(),
                    modified_secs: secs,
                    modified_nanos: nanos,
                    sha256: content.iter().map(|b| format!("{b:02x}")).collect(),
                }
            }
        };
        let hash = hash_bytes(&entry.sha256)?;
        digest.update((file.normalized.len() as u64).to_le_bytes());
        digest.update(file.normalized.as_bytes());
        digest.update(entry.size.to_le_bytes());
        digest.update(hash);
        updated.insert(file.normalized.clone(), entry);
    }
    // The cache only speeds the fingerprint up, so a project that cannot be written to
    // still fingerprints.
    let _ = write_fingerprint_cache(&cache_path, &updated);
    let mut encoded = String::with_capacity(80);
    for byte in digest.finalize() {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to String");
    }
    Ok(Some(format!("{FINGERPRINT_V2_PREFIX}{encoded}")))
}

/// Seconds and nanoseconds since the UNIX epoch; a time before it stores as the epoch.
fn modified_secs(modified: SystemTime) -> (u64, u32) {
    modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|since| (since.as_secs(), since.subsec_nanos()))
        .unwrap_or((0, 0))
}

/// A cached hash is reusable only when its stored form is a plain lowercase digest;
/// anything else in the file's slot counts as no cache for that file.
fn cacheable(entry: &FingerprintCacheEntry) -> bool {
    entry.sha256.len() == 64
        && entry
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn hash_bytes(hex: &str) -> io::Result<[u8; 32]> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidData, "fingerprint cache hash is not hex");
    let mut bytes = [0_u8; 32];
    for (index, pair) in hex.as_bytes().chunks(2).enumerate() {
        if pair.len() != 2 {
            return Err(invalid());
        }
        let mut value = 0_u8;
        for character in pair {
            let digit = (*character as char).to_digit(16).ok_or_else(invalid)? as u8;
            value = value * 16 + digit;
        }
        bytes[index] = value;
    }
    Ok(bytes)
}

/// A cache that is missing, damaged, a future version or oversized counts as absent.
fn read_fingerprint_cache(path: &Path) -> FingerprintCacheDocument {
    let empty = || FingerprintCacheDocument {
        version: FINGERPRINT_CACHE_VERSION,
        files: std::collections::BTreeMap::new(),
    };
    let Ok(metadata) = fs::metadata(path) else {
        return empty();
    };
    if !metadata.is_file() || metadata.len() as usize > FINGERPRINT_CACHE_MAX_BYTES {
        return empty();
    }
    match serde_json::from_slice::<FingerprintCacheDocument>(&fs::read(path).unwrap_or_default()) {
        Ok(cache) if cache.version == FINGERPRINT_CACHE_VERSION => cache,
        _ => empty(),
    }
}

/// Writes the cache atomically (`.pending`, then rename) and bounded in size.
fn write_fingerprint_cache(
    path: &Path,
    files: &std::collections::BTreeMap<String, FingerprintCacheEntry>,
) -> io::Result<()> {
    let document = FingerprintCacheDocument {
        version: FINGERPRINT_CACHE_VERSION,
        files: files.clone(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(io::Error::other)?;
    if encoded.len() > FINGERPRINT_CACHE_MAX_BYTES {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let pending = path.with_extension("pending");
    fs::write(&pending, &encoded)?;
    fs::rename(&pending, path)?;
    Ok(())
}

fn collect_fingerprint_files(
    root: &Path,
    path: &Path,
    output: &mut Vec<PathBuf>,
) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "project fingerprint refuses symbolic links",
        ));
    }
    if metadata.is_file() {
        output.push(
            path.strip_prefix(root)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "file outside project"))?
                .to_owned(),
        );
    } else if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            collect_fingerprint_files(root, &entry?.path(), output)?;
        }
    }
    Ok(())
}

impl FileSystemProjectStore {
    pub fn initialize(project: &ProjectRef) -> io::Result<()> {
        if !project
            .root
            .join("ProjectSettings/ProjectVersion.txt")
            .is_file()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "not a Unity project",
            ));
        }
        for directory in [".vua/bridge", ".vua/snapshots"] {
            fs::create_dir_all(project.root.join(directory))?;
        }
        write_json(project.root.join(".vua/project.json"), project)
    }

    pub fn write_bridge_command<T: Serialize>(
        project: &ProjectRef,
        command_id: &str,
        value: &T,
    ) -> io::Result<PathBuf> {
        // command_id crosses the IPC/Unity boundary and becomes a filename.
        // Reuse the same strict identifier grammar as snapshots so neither
        // path separators nor traversal segments can escape `.vua/bridge`.
        validate_identifier(command_id)?;
        let directory = project.root.join(".vua/bridge");
        fs::create_dir_all(&directory)?;
        let target = directory.join(format!("{command_id}.request.json"));
        write_json(&target, value)?;
        Ok(target)
    }
}

pub struct FileSystemSnapshotStore;

impl FileSystemSnapshotStore {
    /// The snapshot identifier grammar, as a single public source: non-empty
    /// ASCII alphanumeric plus `-` and `_`. Snapshot ids become path segments
    /// under `.vua/snapshots` and `.vua/recovery`, so any other character —
    /// separators, dots, drive letters, whitespace — is rejected before it
    /// can traverse. Callers that receive an id from a persisted payload
    /// (a build record, a task result) must re-validate before the id joins
    /// a path; creation-time validation does not follow the data.
    pub fn validate_snapshot_id(value: &str) -> io::Result<()> {
        validate_identifier(value)
    }

    /// Creates a scope-limited snapshot (files or directories, project-root
    /// relative), builds an integrity manifest and verifies it by read-back.
    /// A failed verification leaves no snapshot behind, so callers can never
    /// restore an unverified state (ORC-WF-005, ORC-STO-006).
    pub fn create_verified(
        &self,
        project: &ProjectRef,
        snapshot_id: &str,
        scopes: &[&str],
    ) -> io::Result<VerifiedSnapshot> {
        validate_identifier(snapshot_id)?;
        if scopes.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "snapshot needs at least one scope",
            ));
        }
        for scope in scopes {
            validate_scope(scope)?;
        }
        let snapshots_dir = project.root.join(".vua/snapshots");
        let path = snapshots_dir.join(snapshot_id);
        if path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "snapshot already exists",
            ));
        }

        let result = (|| -> io::Result<VerifiedSnapshot> {
            fs::create_dir_all(&path)?;
            let mut scope_list: Vec<String> = Vec::new();
            for scope in scopes {
                // Record requested scopes even when they do not exist yet.
                // Rollback must remove a scope created by the failed
                // operation instead of preserving data absent beforehand.
                scope_list.push((*scope).to_owned());
                let source = project.root.join(scope);
                if !source.exists() {
                    continue;
                }
                let target = path.join(scope);
                if source.is_dir() {
                    copy_tree(&source, &target)?;
                } else if source.is_file() {
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::copy(&source, &target)?;
                }
            }
            let mut entries: Vec<SnapshotManifestEntry> = Vec::new();
            collect_entries(&path, &path, &mut entries)?;
            // Read-back verification: every recorded file must still exist
            // with the recorded size.
            for entry in &entries {
                let file = path.join(&entry.path);
                let metadata = fs::metadata(&file).map_err(|error| {
                    io::Error::new(error.kind(), "snapshot verification failed")
                })?;
                if !metadata.is_file() || metadata.len() != entry.size {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "snapshot verification failed",
                    ));
                }
            }
            let manifest = SnapshotManifestV1 {
                schema_version: SNAPSHOT_MANIFEST_SCHEMA_VERSION,
                snapshot_id: snapshot_id.to_owned(),
                project_identity: crate::ProjectIdentity::from_existing_path(&project.root)
                    .map_err(|error| {
                        io::Error::new(io::ErrorKind::InvalidInput, error.to_string())
                    })?
                    .as_str()
                    .to_owned(),
                scopes: scope_list.clone(),
                entries: entries.clone(),
                verified: true,
            };
            write_json(path.join(SNAPSHOT_MANIFEST_FILE), &manifest)?;
            Ok(VerifiedSnapshot {
                reference: SnapshotRef {
                    id: snapshot_id.to_owned(),
                    path: path.clone(),
                },
                scopes: scope_list,
                entries,
            })
        })();

        match result {
            Ok(verified) => Ok(verified),
            Err(error) => {
                // Leave no partial snapshot behind.
                let _ = fs::remove_dir_all(&path);
                Err(error)
            }
        }
    }

    /// Restores a verified scope-limited snapshot. The manifest must be
    /// present, verified and internally consistent; the current state is
    /// quarantined under `.vua/recovery/<id>/` before any overwrite.
    pub fn restore_verified(&self, project: &ProjectRef, snapshot: &SnapshotRef) -> io::Result<()> {
        let expected_parent = project.root.join(".vua/snapshots");
        if snapshot.path.parent() != Some(expected_parent.as_path()) || !snapshot.path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "snapshot is outside this project",
            ));
        }
        // 快照目录名必须与快照 id 一致：目录是可编辑的，id 与目录名脱钩
        // 意味着 recovery 隔离区可能被导向任意名字。
        if snapshot.id.is_empty()
            || !snapshot
                .path
                .file_name()
                .is_some_and(|name| name == snapshot.id.as_str())
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "snapshot id does not match its directory",
            ));
        }
        let manifest_path = snapshot.path.join(SNAPSHOT_MANIFEST_FILE);
        let bytes = fs::read(&manifest_path)
            .map_err(|error| io::Error::new(error.kind(), "snapshot manifest is missing"))?;
        let manifest: SnapshotManifestV1 = serde_json::from_slice(&bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if manifest.schema_version != SNAPSHOT_MANIFEST_SCHEMA_VERSION {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unknown snapshot manifest version",
            ));
        }
        if !manifest.verified {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot was never verified",
            ));
        }
        // manifest.json 位于项目目录内，是**不可信数据**：恢复前把清单里的
        // 每个路径重新过一遍与创建时相同的校验，伪造 `../../` 的作用域或
        // 条目在此被拒——这是访问控制，不是可选的完整性强化。
        // The manifest must name THIS project: a copied or misplaced
        // snapshot directory can never be restored into another project.
        let project_identity = crate::ProjectIdentity::from_existing_path(&project.root)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error.to_string()))?;
        if manifest.project_identity != project_identity.as_str() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot belongs to another project",
            ));
        }
        if manifest.snapshot_id != snapshot.id {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot manifest belongs to another snapshot",
            ));
        }
        if manifest.scopes.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "snapshot manifest has no scopes",
            ));
        }
        for scope in &manifest.scopes {
            validate_scope(scope)?;
        }
        for entry in &manifest.entries {
            // 条目路径必须落在快照目录内（同样拒绝 `..`、反斜杠、绝对路径），
            // 否则大小核对本身就可以被用来探测项目外文件。
            validate_scope(&entry.path)?;
        }
        for entry in &manifest.entries {
            let file = snapshot.path.join(&entry.path);
            match fs::metadata(&file) {
                Ok(metadata) if metadata.is_file() && metadata.len() == entry.size => {}
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "snapshot does not match its manifest",
                    ))
                }
            }
        }

        let recovery = project.root.join(".vua/recovery").join(&snapshot.id);
        for scope in &manifest.scopes {
            let current = project.root.join(scope);
            if current.exists() {
                let quarantine = recovery.join(scope);
                if quarantine.exists() {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "recovery quarantine exists",
                    ));
                }
                if let Some(parent) = quarantine.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::rename(&current, quarantine)?;
            }
            let saved = snapshot.path.join(scope);
            if saved.is_dir() {
                copy_tree(&saved, &current)?;
            } else if saved.is_file() {
                if let Some(parent) = current.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&saved, &current)?;
            }
        }
        Ok(())
    }
}

impl SnapshotStore for FileSystemSnapshotStore {
    type Error = io::Error;

    fn create(&self, project: &ProjectRef, snapshot_id: &str) -> Result<SnapshotRef, Self::Error> {
        validate_identifier(snapshot_id)?;
        let path = project.root.join(".vua/snapshots").join(snapshot_id);
        if path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "snapshot already exists",
            ));
        }
        fs::create_dir_all(&path)?;
        for scope in SNAPSHOT_SCOPES {
            let source = project.root.join(scope);
            if source.exists() {
                copy_tree(&source, &path.join(scope))?;
            }
        }
        Ok(SnapshotRef {
            id: snapshot_id.into(),
            path,
        })
    }

    fn restore(&self, project: &ProjectRef, snapshot: &SnapshotRef) -> Result<(), Self::Error> {
        let expected_parent = project.root.join(".vua/snapshots");
        if snapshot.path.parent() != Some(expected_parent.as_path()) || !snapshot.path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "snapshot is outside this project",
            ));
        }

        let recovery = project.root.join(".vua/recovery").join(&snapshot.id);
        fs::create_dir_all(&recovery)?;
        for scope in SNAPSHOT_SCOPES {
            let current = project.root.join(scope);
            if current.exists() {
                let quarantine = recovery.join(scope);
                if quarantine.exists() {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "recovery quarantine exists",
                    ));
                }
                fs::rename(&current, quarantine)?;
            }
            let saved = snapshot.path.join(scope);
            if saved.exists() {
                copy_tree(&saved, &current)?;
            }
        }
        Ok(())
    }
}

fn validate_identifier(value: &str) -> io::Result<()> {
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid identifier",
        ));
    }
    Ok(())
}

/// Scope paths are project-root relative, plain and forward-slashed; any
/// traversal, drive letter or backslash form is rejected (ORC-STO-009).
fn validate_scope(value: &str) -> io::Result<()> {
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.contains('\\')
        || value.contains("..")
        || value.contains(':')
        || value.ends_with('/')
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid snapshot scope",
        ));
    }
    Ok(())
}

/// Walks a snapshot directory collecting snapshot-relative paths and sizes;
/// the manifest file itself is excluded.
fn collect_entries(
    root: &Path,
    directory: &Path,
    entries: &mut Vec<SnapshotManifestEntry>,
) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            collect_entries(root, &path, entries)?;
        } else if entry.file_type()?.is_file() {
            let name = entry.file_name();
            if name == SNAPSHOT_MANIFEST_FILE {
                continue;
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path outside snapshot"))?
                .to_string_lossy()
                .replace('\\', "/");
            entries.push(SnapshotManifestEntry {
                path: relative,
                size: fs::metadata(&path)?.len(),
            });
        }
    }
    Ok(())
}

fn copy_tree(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let destination = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else if entry.file_type()?.is_file() {
            fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

fn write_json(path: impl AsRef<Path>, value: &impl Serialize) -> io::Result<()> {
    let encoded = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    fs::write(path, encoded)
}

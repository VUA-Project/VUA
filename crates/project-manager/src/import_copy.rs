//! M6 T-A (proposal 014, arbitrated 2026-09-09): "import as a VUA-managed
//! copy" — the ONLY write path VUA has toward ALCOM/VCC-managed original
//! projects (product-boundary 1.2.0, user ruling U3).
//!
//! Two phases behind one closed command (`project.import-copy`, word list
//! frozen in `schemas/project-ops/v0.2/`; the v0.2 elevation (the setNote
//! family, core 0889a1b) kept every import-copy shape byte-identical to
//! v0.1 — this module's payloads validate under the current frozen version
//! unchanged):
//!
//! - [`plan_import_copy`] — the confirmation face: the five guards run here
//!   first (target exists / target inside source / source not a registered
//!   project / source invalid / insufficient disk space), the copy scope is
//!   measured per-entry (bytes actually walked, never guessed), the excluded
//!   entries are listed, and a plan digest binds the confirmation to the
//!   measured state.
//! - [`apply_import_copy`] — the execution face: the plan is re-computed and
//!   the digest re-checked (double-summary discipline, same as the VPM
//!   preview/apply pair — any drift refuses instead of executing a stale
//!   confirmation), then the copy runs with the exclusions, the new project
//!   takes its own Unity-facing identity (`productName`), a fresh `.vua/`
//!   records the source link, the new project's mutation lock guards the
//!   copy against concurrent writers, and the copy is re-inspected. The
//!   ORIGINAL project is never written and never locked (1.2.0 read-only
//!   ruling); guards run inside the task, provider-side — the desktop may
//!   pre-hint but the authoritative verdict is here.
//!
//! Task semantics (nine-state, commandId idempotency, cancellable, NO
//! implicit resume — a crashed half-copy surfaces `inspect_required` and a
//! retry means the user-triggered clean-then-redo) ride the application-
//! contract task surface owned by core/provider-host; this module provides
//! the library face those routes call. The original project is never
//! modified, external manager registries are never written, and there is no
//! batch mode (R5).

use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};

use crate::environment_managers::{
    read_alcom_settings, read_vcc_settings, ManagerRoots, ProjectAssociation,
};

/// The project-ops wire version this library face targets. v0.2 is the
/// current frozen word list; the import-copy shapes it froze are identical
/// to v0.1 (the elevation only added the setNote family), so no payload
/// change accompanies this bump. The envelope `schemaVersion` itself is
/// assembled by the provider route (core/provider-host), not here.
pub const IMPORT_OPS_SCHEMA_VERSION: &str = "0.2";

/// Regenerable Unity directories and the original project's VUA task state
/// — the 1.2.0 exclusion semantics, listed verbatim in every plan and
/// receipt so the user confirms against the actual exclusion list.
pub const EXCLUDED_ENTRIES: [&str; 6] = ["Library", "Temp", "Logs", "obj", "Builds", ".vua"];

/// Safety headroom added on top of the measured copy size for the disk
/// space guard (allocation overhead, metadata, and the fact that the
/// estimate cannot see inside compressed archives).
const DISK_HEADROOM_BYTES: u64 = 64 * 1024 * 1024;

/// Which guard refused the import. The closed set is frozen in
/// `schemas/project-ops/v0.2/result.schema.json`; codes follow the
/// `vua.project.*` convention. These seven are the import-copy subset of
/// the v0.2 ten-guard closed set (the three additions —
/// `project_not_found` / `not_vua_native` / `identity_unreadable` —
/// belong to the setNote route, which maps this crate's `SetNoteError`
/// three-state onto them).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectionGuard {
    TargetExists,
    TargetInsideSource,
    SourceNotRegistered,
    SourceInvalid,
    InsufficientDiskSpace,
    PlanDrift,
    ExecutionFailed,
}

impl RejectionGuard {
    fn code(&self) -> &'static str {
        match self {
            RejectionGuard::TargetExists => "vua.project.target_exists",
            RejectionGuard::TargetInsideSource => "vua.project.target_inside_source",
            RejectionGuard::SourceNotRegistered => "vua.project.source_not_registered",
            RejectionGuard::SourceInvalid => "vua.project.source_invalid",
            RejectionGuard::InsufficientDiskSpace => "vua.project.insufficient_disk_space",
            RejectionGuard::PlanDrift => "vua.project.plan_drift",
            RejectionGuard::ExecutionFailed => "vua.project.execution_failed",
        }
    }
}

/// A typed guard refusal — the `rejected` result document. Not an
/// `AppErrorV1`: the import path has its own frozen wire face.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRejected {
    pub kind: &'static str,
    pub guard: RejectionGuard,
    pub code: &'static str,
    pub detail: String,
}

impl ImportRejected {
    fn new(guard: RejectionGuard, detail: impl Into<String>) -> Self {
        Self {
            kind: "rejected",
            guard,
            code: guard.code(),
            detail: detail.into(),
        }
    }
}

/// One declared/locked package line of the re-inspected copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopiedProjectInspection {
    pub unity_version: Option<String>,
    pub unity_classification: Option<vua_orchestrator::EditorClass>,
    pub manifest_present: bool,
    pub manifest_schema_ok: bool,
}

/// The source link written into the new project's `.vua/source.json` and
/// echoed in the receipt — same-shape reference as the W23 evidence
/// `sourceRef.taskCorrelation`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub source_path: String,
    pub source_associations: Vec<ProjectAssociation>,
    pub imported_at: String,
    pub task_correlation: String,
}

/// The confirmation-face plan: measured copy scope + exclusions + target +
/// the digest that binds the user's confirmation to this exact state. The
/// `schemaVersion` travels on the command envelope, not in this document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlanV01 {
    pub kind: &'static str,
    pub source_path: String,
    pub target_path: String,
    pub target_project_name: String,
    pub estimated_bytes: u64,
    pub excluded_entries: Vec<String>,
    pub source_top_levels: Vec<String>,
    pub plan_digest: String,
}

/// The completion-face receipt: what was actually copied, the recorded
/// source link, and the re-inspection of the new project (the original's
/// confirmations and snapshots are never inherited). The `schemaVersion`
/// travels on the command envelope, not in this document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReceiptV01 {
    pub kind: &'static str,
    pub source_path: String,
    pub target_path: String,
    pub target_project_name: String,
    pub copied_top_levels: Vec<String>,
    pub excluded_entries: Vec<String>,
    pub bytes_copied: u64,
    pub source_link: SourceLink,
    pub re_inspection: CopiedProjectInspection,
}

fn excluded_list() -> Vec<String> {
    let mut entries: Vec<String> = EXCLUDED_ENTRIES
        .iter()
        .map(|entry| (*entry).to_owned())
        .collect();
    entries.sort();
    entries
}

fn validated_project_name(name: &str) -> Result<(), ImportRejected> {
    let valid = !name.trim().is_empty()
        && name == name.trim()
        && name != "."
        && name != ".."
        && !name.starts_with('-')
        && !name.chars().any(|character| {
            matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        });
    if valid {
        Ok(())
    } else {
        Err(ImportRejected::new(
            RejectionGuard::SourceInvalid,
            format!("target project name is not a valid project name: {name:?}"),
        ))
    }
}

/// Canonicalizes when possible; when the path does not exist yet (the
/// usual case for a fresh copy target, where canonicalize fails), the
/// deepest existing ancestor is canonicalized and the missing tail is
/// re-appended, so the existing prefix normalizes to the same face as a
/// canonicalized twin — 8.3 short names (`RUNNER~1`), drive-letter case,
/// and verbatim `\\?\` prefixes all collapse (BG-18). On Windows the
/// drive letter is finally upper-cased to match the canonical face.
fn normalize(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return strip_verbatim(canonical);
    }
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut prefix = path.to_path_buf();
    while !prefix.exists() {
        match (prefix.file_name(), prefix.parent()) {
            (Some(name), Some(parent)) => {
                tail.insert(0, name.to_os_string());
                prefix = parent.to_path_buf();
            }
            _ => break,
        }
    }
    let mut normalized = prefix.canonicalize().unwrap_or(prefix);
    for name in tail {
        normalized.push(name);
    }
    uppercase_drive_letter(strip_verbatim(normalized))
}

/// Windows canonical paths always carry an upper-case drive letter
/// (`\\?\C:\...`); a literal fallback keeps the caller's spelling, so the
/// drive letter is upper-cased to keep both faces identical for prefix
/// comparison.
#[cfg(windows)]
fn uppercase_drive_letter(path: PathBuf) -> PathBuf {
    let text = path.as_os_str().to_string_lossy().into_owned();
    let bytes = text.as_bytes();
    let drive = if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        Some(bytes[0].to_ascii_uppercase())
    } else {
        None
    };
    match drive {
        Some(drive) if drive != bytes[0] => {
            let mut normalized = text;
            normalized.replace_range(0..1, &(drive as char).to_string());
            PathBuf::from(normalized)
        }
        _ => PathBuf::from(text),
    }
}

#[cfg(not(windows))]
fn uppercase_drive_letter(path: PathBuf) -> PathBuf {
    path
}

#[cfg(windows)]
fn strip_verbatim(path: PathBuf) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    if let Some(unc) = text
        .get(..8)
        .filter(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
        .and_then(|_| text.get(8..))
    {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(stripped) => PathBuf::from(stripped.to_owned()),
        None => path,
    }
}

#[cfg(not(windows))]
fn strip_verbatim(path: PathBuf) -> PathBuf {
    path
}

/// Checks the source against the managers' registered projects (the same
/// discovery face as the read side). A source that no manager registered —
/// or whose registration is stale — is refused: imports start from what
/// the detection face actually sees, never from an arbitrary typed path.
fn registered_associations(
    source: &Path,
    vcc_settings_candidates: &[PathBuf],
    roots: &ManagerRoots,
) -> Option<Vec<ProjectAssociation>> {
    let mut diagnostics = Vec::new();
    let vcc = read_vcc_settings(vcc_settings_candidates, &mut diagnostics);
    let alcom = read_alcom_settings(&roots.alcom_settings_candidates, &mut diagnostics);

    let source_normalized = normalize(source);
    let mut associations: Vec<ProjectAssociation> = Vec::new();
    let mut add = |association: ProjectAssociation| {
        if !associations.contains(&association) {
            associations.push(association);
        }
    };

    // Both registration forms count (new-style userProjects and legacy
    // localProjectFolders — the latter registers the folder's immediate
    // subdirectories, matching the read side's discovery).
    if vcc.projects_source == Some("userProjects") {
        for path in &vcc.user_projects {
            if normalize(Path::new(path)) == source_normalized {
                add(ProjectAssociation::VccRegistered);
            }
        }
    } else if vcc.projects_source == Some("localProjectFolders") {
        'vcc_folders: for folder in &vcc.local_project_folders {
            if let Ok(read_dir) = std::fs::read_dir(folder) {
                for entry in read_dir.flatten() {
                    if entry.path().is_dir() && normalize(&entry.path()) == source_normalized {
                        add(ProjectAssociation::VccRegistered);
                        break 'vcc_folders;
                    }
                }
            }
        }
    }
    for path in &alcom.user_projects {
        if normalize(Path::new(path)) == source_normalized {
            add(ProjectAssociation::AlcomRegistered);
        }
    }
    (!associations.is_empty()).then_some(associations)
}

/// Walks `dir` skipping the excluded entry names, accumulating the total
/// size and the source top-level entries in scope. Returns
/// (bytes, top_levels).
fn measure_copy_scope(dir: &Path, top_levels: &mut Vec<String>) -> std::io::Result<u64> {
    let mut total = 0u64;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if EXCLUDED_ENTRIES.iter().any(|excluded| *excluded == name) {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("links/junctions inside source project are refused: {name}"),
            ));
        }
        if metadata.is_dir() {
            total += measure_copy_scope(&entry.path(), &mut Vec::new())?;
            top_levels.push(name);
        } else if metadata.is_file() {
            total += metadata.len();
            top_levels.push(name);
        }
    }
    Ok(total)
}

fn compute_plan(
    source: &Path,
    target_parent: &Path,
    name: &str,
) -> Result<ImportPlanV01, ImportRejected> {
    if !source.join("Packages").join("vpm-manifest.json").is_file()
        || !source
            .join("ProjectSettings")
            .join("ProjectVersion.txt")
            .is_file()
    {
        return Err(ImportRejected::new(
            RejectionGuard::SourceInvalid,
            "source is missing vpm-manifest.json or ProjectVersion.txt — not a VPM project",
        ));
    }

    let target_path = target_parent.join(name);
    if target_path.exists() {
        return Err(ImportRejected::new(
            RejectionGuard::TargetExists,
            format!("{}: target already exists", target_path.display()),
        ));
    }

    // The target must not live inside the source tree (copying a project
    // into itself would walk an infinitely growing scope).
    let source_normalized = normalize(source);
    let target_normalized = normalize(&target_path);
    if target_normalized.starts_with(&source_normalized) {
        return Err(ImportRejected::new(
            RejectionGuard::TargetInsideSource,
            format!(
                "{}: target is inside the source project {}",
                target_path.display(),
                source.display()
            ),
        ));
    }

    let mut top_levels = Vec::new();
    let estimated_bytes = measure_copy_scope(source, &mut top_levels).map_err(|error| {
        ImportRejected::new(
            RejectionGuard::SourceInvalid,
            format!(
                "{}: measuring the copy scope failed: {error}",
                source.display()
            ),
        )
    })?;
    top_levels.sort();

    // Disk space guard: free space on the target volume must exceed the
    // measured size plus the safety headroom (Windows-only check; this is
    // the Windows-first product).
    #[cfg(windows)]
    check_disk_free(target_parent, estimated_bytes)?;

    Ok(ImportPlanV01 {
        kind: "plan",
        source_path: source.to_string_lossy().into_owned(),
        target_path: target_path.to_string_lossy().into_owned(),
        target_project_name: name.to_owned(),
        estimated_bytes,
        excluded_entries: excluded_list(),
        source_top_levels: top_levels,
        plan_digest: plan_digest(
            &source.to_string_lossy(),
            &target_path.to_string_lossy(),
            name,
            estimated_bytes,
        ),
    })
}

fn plan_digest(source: &str, target: &str, name: &str, estimated_bytes: u64) -> String {
    let canonical = json!({
        "sourcePath": source,
        "targetPath": target,
        "targetProjectName": name,
        "estimatedBytes": estimated_bytes,
        "excludedEntries": EXCLUDED_ENTRIES,
    });
    vua_orchestrator::fnv1a_hex(canonical.to_string().as_bytes())
}

#[cfg(windows)]
fn check_disk_free(target_parent: &Path, needed: u64) -> Result<(), ImportRejected> {
    let wide: Vec<u16> = target_parent
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut free_to_caller: u64 = 0;
    let mut total: u64 = 0;
    let mut free_total: u64 = 0;
    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free_to_caller as *mut u64 as *mut _,
            &mut total as *mut u64 as *mut _,
            &mut free_total as *mut u64 as *mut _,
        )
    };
    if ok == 0 {
        return Err(ImportRejected::new(
            RejectionGuard::InsufficientDiskSpace,
            format!(
                "{}: querying free disk space failed",
                target_parent.display()
            ),
        ));
    }
    if free_to_caller < needed + DISK_HEADROOM_BYTES {
        return Err(ImportRejected::new(
            RejectionGuard::InsufficientDiskSpace,
            format!(
                "{}: free space {} bytes is below the measured copy size {} plus the safety headroom",
                target_parent.display(),
                free_to_caller,
                needed
            ),
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn check_disk_free(_target_parent: &Path, _needed: u64) -> Result<(), ImportRejected> {
    // The Windows-first product checks this guard on Windows; other
    // targets skip the check rather than fake a pass or a refusal.
    Ok(())
}

/// Copies `source` into `target` skipping the excluded entry names,
/// accumulating (bytes, top-level entries actually copied). The caller has
/// already refused an existing target.
fn copy_with_exclusions(
    source: &Path,
    target: &Path,
    top_levels: &mut Vec<String>,
) -> std::io::Result<u64> {
    std::fs::create_dir_all(target)?;
    let mut total = 0u64;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if EXCLUDED_ENTRIES.iter().any(|excluded| *excluded == name) {
            continue;
        }
        let destination = target.join(&name);
        let metadata = std::fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("links/junctions inside source project are refused: {name}"),
            ));
        }
        if metadata.is_dir() {
            total += copy_with_exclusions(&entry.path(), &destination, &mut Vec::new())?;
        } else if metadata.is_file() {
            total += std::fs::copy(entry.path(), &destination)?;
        }
        top_levels.push(name);
    }
    Ok(total)
}

/// The caller-supplied coordinates of one import-copy operation.
#[derive(Debug, Clone)]
pub struct ImportCopyRequest<'a> {
    pub source: &'a Path,
    pub target_parent: &'a Path,
    pub name: &'a str,
    pub vcc_settings_candidates: &'a [PathBuf],
    pub roots: &'a ManagerRoots,
}

/// The confirmation face of `project.import-copy`: run the guards, measure
/// the copy scope, and bind the state with a digest. No filesystem writes
/// happen here.
pub fn plan_import_copy(request: &ImportCopyRequest<'_>) -> Result<ImportPlanV01, ImportRejected> {
    validated_project_name(request.name)?;
    if registered_associations(
        request.source,
        request.vcc_settings_candidates,
        request.roots,
    )
    .is_none()
    {
        return Err(ImportRejected::new(
            RejectionGuard::SourceNotRegistered,
            format!(
                "{}: no manager registers this project — imports start from what the detection face sees",
                request.source.display()
            ),
        ));
    }
    compute_plan(request.source, request.target_parent, request.name)
}

/// The execution face of `project.import-copy`: re-compute the plan,
/// refuse on digest drift, copy with the exclusions under the NEW
/// project's mutation lock, give the copy its own identity, record the
/// source link into its `.vua/`, and re-inspect it. The original project
/// is never written and never locked.
pub fn apply_import_copy(
    request: &ImportCopyRequest<'_>,
    confirmed_plan_digest: &str,
    task_correlation: &str,
    clock: &dyn vua_orchestrator::Clock,
) -> Result<ImportReceiptV01, ImportRejected> {
    let name = request.name;
    validated_project_name(name)?;

    // Double-summary discipline: re-compute and refuse on drift (the
    // source may have changed since the user confirmed the plan).
    let plan = plan_import_copy(request)?;
    if plan.plan_digest != confirmed_plan_digest {
        return Err(ImportRejected::new(
            RejectionGuard::PlanDrift,
            "the source changed after the plan was confirmed — review and re-plan instead of executing a stale confirmation",
        ));
    }

    let source = request.source;
    let target_path = request.target_parent.join(name);
    let associations =
        registered_associations(source, request.vcc_settings_candidates, request.roots)
            .unwrap_or_default();

    // Guard the copy against concurrent writers on the NEW project; the
    // original stays read-only and unlocked (1.2.0).
    let holder = crate::project_lock::LockHolder {
        channel: "project-ops".to_owned(),
        profile: "default".to_owned(),
        pid: std::process::id(),
        instance_id: format!("import-copy-{task_correlation}"),
        acquired_at: clock.now_rfc3339(),
    };
    let lock =
        crate::project_lock::acquire_project_lock(&target_path, holder).map_err(|error| {
            ImportRejected::new(
                RejectionGuard::ExecutionFailed,
                format!("acquiring the new project mutation lock failed: {error}"),
            )
        })?;

    let mut copied_top_levels = Vec::new();
    let copy_result = copy_with_exclusions(source, &target_path, &mut copied_top_levels);
    let bytes_copied = match copy_result {
        Ok(bytes) => bytes,
        Err(error) => {
            // No implicit cleanup: the half-copy stays on disk as evidence
            // and the task face surfaces inspect_required; retry means the
            // user-triggered clean-then-redo (provider never auto-deletes).
            drop(lock);
            return Err(ImportRejected::new(
                RejectionGuard::ExecutionFailed,
                format!("{}: copying failed: {error}", target_path.display()),
            ));
        }
    };
    drop(lock); // the copy is complete; the new project is owned by the user

    // The copy takes its own Unity-facing identity (new project identity,
    // 1.2.0 spec item 1). A failed identity write is a typed refusal, never
    // a swallowed side effect: the receipt must not claim a complete copy
    // while the new project silently kept the ORIGINAL product name
    // (BG-12 family: no Err-same-flow on a spec-carrying step). The
    // set_product_name internal best-effort no-op legs (file absent / no
    // productName line) stay as pinned — this call site no longer discards
    // the errors the primitive does report.
    crate::vpm_backend::set_product_name(
        &target_path
            .join("ProjectSettings")
            .join("ProjectSettings.asset"),
        name,
    )
    .map_err(|error| {
        ImportRejected::new(
            RejectionGuard::ExecutionFailed,
            format!(
                "{}: writing the copied project's own productName failed: {error:?}",
                target_path.display()
            ),
        )
    })?;

    // Fresh VUA store + the source link (spec item 5: keep the source
    // relationship so the user can go back).
    let project_ref = vua_orchestrator::ProjectRef {
        id: format!("proj-import-{name}"),
        root: target_path.clone(),
    };
    vua_orchestrator::FileSystemProjectStore::initialize(&project_ref).map_err(|error| {
        ImportRejected::new(
            RejectionGuard::ExecutionFailed,
            format!(
                "{}: initializing the VUA project store failed: {error}",
                target_path.display()
            ),
        )
    })?;
    let source_link = SourceLink {
        source_path: source.to_string_lossy().into_owned(),
        source_associations: associations,
        imported_at: clock.now_rfc3339(),
        task_correlation: task_correlation.to_owned(),
    };
    let vua_dir = target_path.join(".vua");
    std::fs::create_dir_all(&vua_dir).map_err(|error| {
        ImportRejected::new(
            RejectionGuard::ExecutionFailed,
            format!("{}: creating .vua failed: {error}", vua_dir.display()),
        )
    })?;
    let source_doc = serde_json::to_string_pretty(&serde_json::json!({
        "sourceLink": source_link,
    }))
    .map_err(|error| {
        ImportRejected::new(
            RejectionGuard::ExecutionFailed,
            format!("serializing the source link failed: {error}"),
        )
    })?;
    std::fs::write(vua_dir.join("source.json"), source_doc).map_err(|error| {
        ImportRejected::new(
            RejectionGuard::ExecutionFailed,
            format!(
                "{}: writing the source link failed: {error}",
                vua_dir.display()
            ),
        )
    })?;

    // VUA-native identity (rulings 2026-09-09 items 7/9/12): the copy is
    // "migrated to VUA" in the user's terms, so it is first-marked
    // VUA-native here; the note stays empty — marking never invents one.
    crate::vua_identity::mark_vua_native(&target_path, &clock.now_rfc3339()).map_err(|error| {
        ImportRejected::new(
            RejectionGuard::ExecutionFailed,
            format!(
                "{}: writing the VUA identity failed: {error}",
                target_path.display()
            ),
        )
    })?;

    // Re-inspect the copy (spec item 4: never inherit the original's
    // confirmations or snapshots — the receipt carries the copy's own
    // freshly read state).
    let inspected =
        crate::project_inspection::inspect_project_deep(&target_path.to_string_lossy(), vec![]);

    Ok(ImportReceiptV01 {
        kind: "receipt",
        source_path: source.to_string_lossy().into_owned(),
        target_path: target_path.to_string_lossy().into_owned(),
        target_project_name: name.to_owned(),
        copied_top_levels,
        excluded_entries: excluded_list(),
        bytes_copied,
        source_link,
        re_inspection: CopiedProjectInspection {
            unity_version: inspected.unity_version,
            unity_classification: inspected.unity_classification,
            manifest_present: inspected.manifest_present,
            manifest_schema_ok: inspected.manifest_schema_ok,
        },
    })
}

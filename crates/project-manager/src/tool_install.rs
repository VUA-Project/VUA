//! Official-installer tool acquisition, discovery and direct breakaway launch (`slimevr`,
//! `vrct`, `vrcx`, `vrcs`).
//!
//! Acquisition downloads the pinned GitHub release installer over HTTPS (redirecting only within
//! `github.com`, `objects.githubusercontent.com` and `release-assets.githubusercontent.com`),
//! verifies exact byte size, SHA-256 and Windows PE (`MZ`) header, refuses to overwrite a running
//! tool process, and executes NSIS `/S` without shell invocation.

use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use vua_orchestrator::{
    deployment::{
        DeploymentActivity, DeploymentObservation, DeploymentPhase, DeploymentPresence,
        DeploymentReporter, EditorDownloadSource,
    },
    external_tools::{
        installer_tool_spec, InstallerToolInstallation, InstallerToolPlatform, InstallerToolSpec,
        ToolProcess,
    },
    ProcessError, ProcessRunner, ProcessSpec, RegistryHive, RegistrySource,
};

const MAX_SETUP_BYTES: u64 = 512 * 1024 * 1024;
const DOWNLOAD_ERROR: &str = "vua.deployment.installer_download_failed";
const INTEGRITY_ERROR: &str = "vua.deployment.installer_integrity_failed";

pub fn system_candidate_roots(tool_id: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let pf = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let pfx86 = std::env::var_os("ProgramFiles(x86)").map(PathBuf::from);
    match tool_id {
        "slimevr" => {
            if let Some(dir) = pfx86 {
                roots.push(dir.join("SlimeVR Server"));
            }
            if let Some(dir) = pf {
                roots.push(dir.join("SlimeVR Server"));
            }
        }
        "vrct" => {
            if let Some(dir) = local {
                roots.push(dir.join("VRCT"));
                roots.push(dir.join("Programs").join("VRCT"));
            }
        }
        "vrcx" => {
            if let Some(dir) = local {
                roots.push(dir.join("Programs").join("VRCX"));
            }
            if let Some(dir) = pf {
                roots.push(dir.join("VRCX"));
            }
        }
        "vrcs" => {
            if let Some(dir) = local {
                roots.push(dir.join("VRCS"));
                roots.push(dir.join("Programs").join("VRCS"));
            }
        }
        _ => {}
    }
    roots
}

fn registry_uninstall_keys(tool_id: &str) -> &'static [(RegistryHive, &'static str)] {
    match tool_id {
        "slimevr" => &[
            (
                RegistryHive::LocalMachine,
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SlimeVR",
            ),
            (
                RegistryHive::LocalMachine,
                "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SlimeVR",
            ),
        ],
        "vrct" => &[(
            RegistryHive::CurrentUser,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VRCT",
        )],
        "vrcx" => &[
            (
                RegistryHive::CurrentUser,
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\b0206718-fd05-55bc-8102-799c03909b38",
            ),
            (RegistryHive::LocalMachine, "SOFTWARE\\VRCX"),
        ],
        "vrcs" => &[(
            RegistryHive::CurrentUser,
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VRCS",
        )],
        _ => &[],
    }
}

fn strip_trailing_icon_index(value: &str) -> &str {
    let Some((head, tail)) = value.rsplit_once(',') else {
        return value;
    };
    let tail = tail.trim();
    let digits = tail.strip_prefix('-').unwrap_or(tail);
    if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        head.trim()
    } else {
        value
    }
}

fn strip_unquoted_exe_arguments(value: &str) -> &str {
    let lower = value.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find(".exe") {
        let end = search_from + rel + 4;
        if end == value.len() {
            return value;
        }
        if matches!(value.as_bytes()[end], b' ' | b'\t' | b'/') {
            return value[..end].trim_end();
        }
        search_from = end;
    }
    value
}

fn strip_icon_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let candidate = if let Some(rest) = trimmed.strip_prefix('"') {
        let quoted = rest.split('"').next().unwrap_or(rest).trim();
        strip_trailing_icon_index(quoted)
    } else {
        let without_index = strip_trailing_icon_index(trimmed);
        strip_unquoted_exe_arguments(without_index)
    };
    if candidate.is_empty()
        || candidate
            .chars()
            .any(|ch| matches!(ch, '"' | '<' | '>' | '|' | '?' | '*' | '\0'))
    {
        return None;
    }
    let path = PathBuf::from(candidate);
    let resolved = if path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        path.parent().map(Path::to_path_buf)
    } else {
        Some(path)
    };
    resolved.filter(|dir| !dir.as_os_str().is_empty())
}

fn valid_pe_executable(path: &Path) -> std::io::Result<bool> {
    let mut file = std::fs::File::open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() || meta.len() < 64 {
        return Ok(false);
    }
    let mut header = [0u8; 2];
    file.read_exact(&mut header)?;
    Ok(header == *b"MZ")
}

pub fn inspect_installer_tool(
    registry: &dyn RegistrySource,
    candidate_roots: &[PathBuf],
    spec: &'static InstallerToolSpec,
) -> InstallerToolInstallation {
    let mut dirs: Vec<(PathBuf, Option<String>)> = Vec::new();
    for (hive, subkey) in registry_uninstall_keys(spec.tool_id) {
        let version = registry
            .get_string(*hive, subkey, "DisplayVersion")
            .filter(|v| !v.trim().is_empty());
        for value_name in [
            "InstallLocation",
            "InstallDir",
            "DisplayIcon",
            "UninstallString",
        ] {
            if let Some(raw) = registry.get_string(*hive, subkey, value_name) {
                if let Some(dir) = strip_icon_path(&raw) {
                    if !dirs.iter().any(|(d, _)| d == &dir) {
                        dirs.push((dir, version.clone()));
                    }
                }
            }
        }
    }
    for root in candidate_roots {
        if !dirs.iter().any(|(d, _)| d == root) {
            dirs.push((root.clone(), None));
        }
    }

    let mut incomplete_location: Option<String> = None;
    let mut unreadable = false;
    for (dir, reg_version) in dirs {
        let exe = dir.join(spec.exe_name);
        match valid_pe_executable(&exe) {
            Ok(true) => {
                let location = exe.to_string_lossy().into_owned();
                return InstallerToolInstallation {
                    presence: "installed",
                    location: Some(location),
                    executable: Some(exe),
                    version: reg_version,
                };
            }
            Ok(false) => {
                if incomplete_location.is_none() {
                    incomplete_location = Some(dir.to_string_lossy().into_owned());
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                if dir.is_dir() && incomplete_location.is_none() {
                    incomplete_location = Some(dir.to_string_lossy().into_owned());
                }
            }
            Err(err)
                if matches!(
                    err.kind(),
                    std::io::ErrorKind::InvalidInput
                        | std::io::ErrorKind::InvalidFilename
                        | std::io::ErrorKind::NotADirectory
                ) || matches!(err.raw_os_error(), Some(123 | 267)) => {}
            Err(_) => {
                unreadable = true;
            }
        }
    }

    if unreadable {
        InstallerToolInstallation {
            presence: "unknown",
            location: None,
            executable: None,
            version: None,
        }
    } else if let Some(location) = incomplete_location {
        InstallerToolInstallation {
            presence: "incomplete",
            location: Some(location),
            executable: None,
            version: None,
        }
    } else {
        InstallerToolInstallation {
            presence: "missing",
            location: None,
            executable: None,
            version: None,
        }
    }
}

pub fn deployment_observation(
    registry: &dyn RegistrySource,
    candidate_roots: &[PathBuf],
    spec: &'static InstallerToolSpec,
) -> DeploymentObservation {
    let inspected = inspect_installer_tool(registry, candidate_roots, spec);
    let presence = match inspected.presence {
        "installed" => DeploymentPresence::Verified,
        "missing" => DeploymentPresence::Missing,
        "incomplete" => DeploymentPresence::Unsuitable,
        _ => DeploymentPresence::DetectionFailed,
    };
    DeploymentObservation {
        component: spec.tool_id.into(),
        presence,
        location: inspected.location,
        version: inspected.version,
    }
}

pub struct WindowsInstallerToolPlatform {
    registry: Arc<dyn RegistrySource>,
    candidate_roots: Vec<PathBuf>,
    spec: &'static InstallerToolSpec,
}

impl WindowsInstallerToolPlatform {
    pub fn new(registry: Arc<dyn RegistrySource>, spec: &'static InstallerToolSpec) -> Self {
        Self {
            registry,
            candidate_roots: system_candidate_roots(spec.tool_id),
            spec,
        }
    }

    #[cfg(test)]
    pub fn with_roots(
        registry: Arc<dyn RegistrySource>,
        candidate_roots: Vec<PathBuf>,
        spec: &'static InstallerToolSpec,
    ) -> Self {
        Self {
            registry,
            candidate_roots,
            spec,
        }
    }
}

impl InstallerToolPlatform for WindowsInstallerToolPlatform {
    fn inspect(&self) -> Result<InstallerToolInstallation, &'static str> {
        let inspected =
            inspect_installer_tool(self.registry.as_ref(), &self.candidate_roots, self.spec);
        if inspected.presence == "unknown" {
            return Err("unavailable");
        }
        Ok(inspected)
    }

    fn processes(&self) -> Result<Vec<ToolProcess>, &'static str> {
        crate::play_session::os::processes_matching(|name| name == self.spec.process_name)
            .map(|processes| {
                processes
                    .into_iter()
                    .map(|p| ToolProcess {
                        pid: p.pid,
                        created: p.created,
                        path: p.path,
                    })
                    .collect()
            })
            .map_err(|_| "unavailable")
    }

    fn launch(&self, executable: &Path) -> Result<(), &'static str> {
        if !valid_pe_executable(executable).unwrap_or(false) {
            return Err("not_installed");
        }
        let parent = executable.parent().ok_or("unavailable")?;
        let mut command = std::process::Command::new(executable);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::System::Threading::CREATE_BREAKAWAY_FROM_JOB;
            command.creation_flags(CREATE_BREAKAWAY_FROM_JOB);
        }
        command
            .current_dir(parent)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let mut child = command.spawn().map_err(|_| "handoff_failed")?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }

    fn close(&self, process: &ToolProcess) -> Result<(), &'static str> {
        crate::play_session::os::close(&crate::play_session::ProcessIdentity {
            pid: process.pid,
            created: process.created,
            path: process.path.clone(),
        })
        .map_err(|_| "close_failed")
    }
}

fn cached_installer(data_root: &Path, spec: &InstallerToolSpec) -> PathBuf {
    data_root
        .join("environment/official-tools")
        .join(spec.tool_id)
        .join(format!("v{}", spec.version))
        .join(spec.file_name)
}

pub(crate) fn tool_is_running(spec: &InstallerToolSpec) -> bool {
    crate::play_session::os::processes_matching(|name| name == spec.process_name)
        .is_ok_and(|list| !list.is_empty())
}

pub(crate) fn install_official_tool(
    data_root: &Path,
    tool_id: &str,
    runner: &dyn ProcessRunner,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    let spec = installer_tool_spec(tool_id).ok_or("vua.deployment.invalid_intent")?;
    if tool_is_running(spec) {
        return Err("vua.deployment.tool_running");
    }
    let mut official_report = |mut activity: DeploymentActivity| {
        activity.source = Some(EditorDownloadSource::Official);
        report(activity)
    };
    let report: &mut DeploymentReporter<'_> = &mut official_report;
    let locked = match acquire_installer(data_root, spec, report).and_then(|installer| {
        // Hold a read-only share lock on the verified installer handle across launch so
        // no concurrent writer or rename can swap bytes before execution.
        let (locked, _) = verify_locked_installer(&installer.path, spec, report)?;
        Ok(locked)
    }) {
        Ok(locked) => locked,
        Err(error @ ("vua.deployment.cancelled" | "vua.deployment.invalid_location")) => {
            return Err(error)
        }
        Err(cause) => {
            report(DeploymentActivity {
                cause: Some(cause),
                ..DeploymentActivity::new(DeploymentPhase::SourceFailed)
            })?;
            return Err(cause);
        }
    };
    if tool_is_running(spec) {
        return Err("vua.deployment.tool_running");
    }
    let result = install_verified(runner, locked.path(), spec, report);
    drop(locked);
    match result {
        Ok(()) => Ok(()),
        Err(
            error @ ("vua.deployment.cancelled"
            | "vua.deployment.elevation_required"
            | "vua.deployment.elevation_declined"),
        ) => Err(error),
        Err(cause) => {
            report(DeploymentActivity {
                cause: Some(cause),
                ..DeploymentActivity::new(DeploymentPhase::InstallationFailed)
            })?;
            Err(cause)
        }
    }
}

struct VerifiedInstaller {
    path: PathBuf,
}

fn acquire_installer(
    data_root: &Path,
    spec: &InstallerToolSpec,
    report: &mut DeploymentReporter<'_>,
) -> Result<VerifiedInstaller, &'static str> {
    let target = cached_installer(data_root, spec);
    let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
    if !crate::unity_install::safe_install_root(parent) {
        return Err("vua.deployment.invalid_location");
    }
    std::fs::create_dir_all(parent).map_err(|_| DOWNLOAD_ERROR)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DOWNLOAD_ERROR)?
        .as_nanos();
    if let Some(cached) = inspect_cache(&target, nonce, spec, report)? {
        return Ok(cached);
    }
    let runtime = tokio::runtime::Runtime::new().map_err(|_| DOWNLOAD_ERROR)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .user_agent("VUA-N2")
        .redirect(redirect_policy())
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|_| DOWNLOAD_ERROR)?;
    let stage = parent.join(format!("{}-{nonce}.partial.exe", spec.tool_id));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)
        .map_err(|_| DOWNLOAD_ERROR)?;
    let owned = OwnedDownload(stage.clone());
    let downloaded = runtime.block_on(download(
        &client,
        spec.download_url,
        &mut file,
        spec,
        report,
    ));
    drop(file);
    let sha256 = downloaded.and_then(|()| verify_installer(&stage, spec, report))?;
    let path = publish_verified(&stage, &target, nonce, spec, report)?;
    drop(owned);
    let record = serde_json::json!({
        "source": "official",
        "sourcePage": spec.official_url,
        "downloadRoute": spec.download_url,
        "toolId": spec.tool_id,
        "version": spec.version,
        "mirrorEligible": spec.mirror_eligible,
        "expectedSize": spec.size,
        "expectedSha256": spec.sha256,
        "fileSha256": sha256,
    });
    std::fs::write(
        parent.join("acquisition.json"),
        serde_json::to_vec_pretty(&record).map_err(|_| DOWNLOAD_ERROR)?,
    )
    .map_err(|_| DOWNLOAD_ERROR)?;
    Ok(VerifiedInstaller { path })
}

fn inspect_cache(
    target: &Path,
    nonce: u128,
    spec: &InstallerToolSpec,
    report: &mut DeploymentReporter<'_>,
) -> Result<Option<VerifiedInstaller>, &'static str> {
    if !target.exists() {
        return Ok(None);
    }
    match verify_installer(target, spec, report) {
        Ok(_) => Ok(Some(VerifiedInstaller {
            path: target.to_path_buf(),
        })),
        Err(INTEGRITY_ERROR) => {
            report(DeploymentActivity {
                cause: Some(INTEGRITY_ERROR),
                ..DeploymentActivity::new(DeploymentPhase::CacheRejected)
            })?;
            let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
            std::fs::rename(
                target,
                parent.join(format!("{}-{nonce}.rejected.exe", spec.tool_id)),
            )
            .map_err(|_| DOWNLOAD_ERROR)?;
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

fn publish_verified(
    stage: &Path,
    target: &Path,
    nonce: u128,
    spec: &InstallerToolSpec,
    report: &mut DeploymentReporter<'_>,
) -> Result<PathBuf, &'static str> {
    if target.exists() {
        match verify_installer(target, spec, report) {
            Ok(_) => return Ok(target.to_path_buf()),
            Err(INTEGRITY_ERROR) => {
                let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
                std::fs::rename(
                    target,
                    parent.join(format!("{}-{nonce}.rejected.exe", spec.tool_id)),
                )
                .map_err(|_| DOWNLOAD_ERROR)?;
            }
            Err(error) => return Err(error),
        }
    }
    std::fs::hard_link(stage, target).map_err(|_| DOWNLOAD_ERROR)?;
    Ok(target.to_path_buf())
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    file: &mut std::fs::File,
    spec: &InstallerToolSpec,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    report(DeploymentActivity::new(DeploymentPhase::Downloading))?;
    let mut response = client.get(url).send().await.map_err(|_| DOWNLOAD_ERROR)?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(DOWNLOAD_ERROR);
    }
    if response
        .content_length()
        .is_some_and(|n| n != spec.size || n > MAX_SETUP_BYTES)
    {
        return Err(DOWNLOAD_ERROR);
    }
    let expected = response.content_length();
    let mut total = 0u64;
    let mut last_report = Instant::now();
    report(byte_progress(DeploymentPhase::Downloading, 0, expected))?;
    while let Some(chunk) = response.chunk().await.map_err(|_| DOWNLOAD_ERROR)? {
        total += chunk.len() as u64;
        if total > spec.size {
            return Err(INTEGRITY_ERROR);
        }
        file.write_all(&chunk).map_err(|_| DOWNLOAD_ERROR)?;
        if last_report.elapsed() >= Duration::from_secs(1) {
            report(byte_progress(DeploymentPhase::Downloading, total, expected))?;
            last_report = Instant::now();
        }
    }
    if expected.is_some_and(|n| n != total) || total == 0 {
        return Err(INTEGRITY_ERROR);
    }
    report(byte_progress(DeploymentPhase::Downloading, total, expected))?;
    file.sync_all().map_err(|_| DOWNLOAD_ERROR)
}

fn verify_locked_installer(
    path: &Path,
    spec: &InstallerToolSpec,
    report: &mut DeploymentReporter<'_>,
) -> Result<(crate::verified_launch::LockedExecutable, String), &'static str> {
    let mut locked =
        crate::verified_launch::LockedExecutable::open_read_locked(path).map_err(|err| {
            if err.is_invalid_location() {
                "vua.deployment.invalid_location"
            } else {
                INTEGRITY_ERROR
            }
        })?;
    let digest = locked.verify_sha256_and_size(
        MAX_SETUP_BYTES,
        Some(spec.size),
        Some(spec.sha256),
        |completed, size| {
            report(byte_progress(
                DeploymentPhase::Verifying,
                completed,
                Some(size),
            ))
        },
    )?;
    Ok((locked, digest))
}

fn verify_installer(
    path: &Path,
    spec: &InstallerToolSpec,
    report: &mut DeploymentReporter<'_>,
) -> Result<String, &'static str> {
    verify_locked_installer(path, spec, report).map(|(_, digest)| digest)
}

pub(crate) fn install_verified(
    runner: &dyn ProcessRunner,
    installer: &Path,
    spec: &InstallerToolSpec,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    let proc_spec = ProcessSpec {
        executable: installer.to_path_buf(),
        args: vec!["/S".into()],
        windows_elevated_nsis: spec.elevated_nsis,
        timeout: Duration::from_secs(1800),
        output_limit: 64 * 1024,
        ..ProcessSpec::default()
    };
    report(DeploymentActivity::from_source(
        DeploymentPhase::Installing,
        EditorDownloadSource::Official,
    ))?;
    let outcome = runner.run(&proc_spec).map_err(|error| match error {
        ProcessError::Io(error) if error.raw_os_error() == Some(740) => {
            "vua.deployment.elevation_required"
        }
        ProcessError::Io(error) if error.raw_os_error() == Some(1223) => {
            "vua.deployment.elevation_declined"
        }
        _ => "vua.deployment.process_failed",
    })?;
    if outcome.timed_out {
        return Err("vua.deployment.installer_timed_out");
    }
    if outcome.cancelled {
        return Err("vua.deployment.cancelled");
    }
    if !outcome.success() {
        return Err("vua.deployment.install_failed");
    }
    report(DeploymentActivity::from_source(
        DeploymentPhase::Inspecting,
        EditorDownloadSource::Official,
    ))?;
    Ok(())
}

fn byte_progress(phase: DeploymentPhase, completed: u64, total: Option<u64>) -> DeploymentActivity {
    DeploymentActivity {
        completed_bytes: Some(completed),
        total_bytes: total,
        ..DeploymentActivity::new(phase)
    }
}

fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() <= 3 && permitted_redirect(attempt.url()) {
            attempt.follow()
        } else {
            attempt.error("unreviewed official-tool installer redirect")
        }
    })
}

fn permitted_redirect(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some("github.com")
                | Some("objects.githubusercontent.com")
                | Some("release-assets.githubusercontent.com")
        )
}

struct OwnedDownload(PathBuf);
impl Drop for OwnedDownload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vua_orchestrator::{
        external_tools::INSTALLER_TOOLS, outcome_with_exit, FakeProcessRunner, FakeRegistrySource,
    };

    #[test]
    fn redirects_allow_only_github_release_hosts_over_https() {
        for spec in INSTALLER_TOOLS {
            assert!(permitted_redirect(
                &reqwest::Url::parse(spec.download_url).unwrap()
            ));
        }
        assert!(permitted_redirect(
            &reqwest::Url::parse(
                "https://objects.githubusercontent.com/github-production-release-asset/asset.exe"
            )
            .unwrap()
        ));
        assert!(permitted_redirect(
            &reqwest::Url::parse("https://release-assets.githubusercontent.com/asset.exe").unwrap()
        ));
        for rejected in [
            "http://github.com/SlimeVR/SlimeVR-Installer/releases/download/v5.0.0/slimevr_web_installer.exe",
            "https://github.com.evil.example/asset.exe",
            "https://example.org/asset.exe",
        ] {
            assert!(
                !permitted_redirect(&reqwest::Url::parse(rejected).unwrap()),
                "{rejected}"
            );
        }
    }

    #[test]
    fn discovery_distinguishes_verified_pe_incomplete_dir_and_missing() {
        let root = std::env::temp_dir().join(format!("vua-installer-tool-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let vrct_dir = root.join("VRCT");
        let spec = installer_tool_spec("vrct").unwrap();
        let empty_reg = FakeRegistrySource::new();
        assert_eq!(
            inspect_installer_tool(&empty_reg, std::slice::from_ref(&vrct_dir), spec).presence,
            "missing"
        );

        std::fs::create_dir_all(&vrct_dir).unwrap();
        assert_eq!(
            inspect_installer_tool(&empty_reg, std::slice::from_ref(&vrct_dir), spec).presence,
            "incomplete"
        );

        let mut pe = vec![b'M', b'Z'];
        pe.resize(128, 0);
        std::fs::write(vrct_dir.join("VRCT.exe"), &pe).unwrap();
        let reg = FakeRegistrySource::new()
            .with(
                RegistryHive::CurrentUser,
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VRCT",
                "DisplayVersion",
                "3.6.1",
            )
            .with(
                RegistryHive::CurrentUser,
                "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\VRCT",
                "InstallLocation",
                &vrct_dir.to_string_lossy(),
            );
        let found = inspect_installer_tool(&reg, &[], spec);
        assert_eq!(found.presence, "installed");
        assert_eq!(found.version.as_deref(), Some("3.6.1"));
        assert_eq!(
            deployment_observation(&reg, &[], spec).presence,
            DeploymentPresence::Verified
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn install_verified_preserves_per_tool_elevation_and_closed_nsis_args() {
        let runner = FakeProcessRunner::new();
        let slimevr = installer_tool_spec("slimevr").unwrap();
        let vrct = installer_tool_spec("vrct").unwrap();
        install_verified(
            &runner,
            Path::new(r"C:\VUA\slimevr_web_installer.exe"),
            slimevr,
            &mut |_| Ok(()),
        )
        .unwrap();
        install_verified(
            &runner,
            Path::new(r"C:\VUA\VRCT_3.6.1_x64-setup.exe"),
            vrct,
            &mut |_| Ok(()),
        )
        .unwrap();
        let calls = runner.calls();
        assert!(calls[0].windows_elevated_nsis);
        assert_eq!(calls[0].args, ["/S"]);
        assert!(!calls[1].windows_elevated_nsis);
        assert_eq!(calls[1].args, ["/S"]);
        drop(calls);

        runner.push(Ok(outcome_with_exit(2, "nsis error")));
        assert_eq!(
            install_verified(
                &runner,
                Path::new(r"C:\VUA\VRCT_3.6.1_x64-setup.exe"),
                vrct,
                &mut |_| Ok(())
            ),
            Err("vua.deployment.install_failed")
        );
    }

    #[test]
    fn strip_icon_path_handles_quoted_and_unquoted_uninstall_arguments() {
        assert_eq!(
            super::strip_icon_path(
                r#""C:\Users\AR\AppData\Local\Programs\VRCX\Uninstall VRCX.exe" /currentuser"#
            ),
            Some(PathBuf::from(r"C:\Users\AR\AppData\Local\Programs\VRCX"))
        );
        assert_eq!(
            super::strip_icon_path(r#"C:\Program Files\SlimeVR\uninstall.exe /S"#),
            Some(PathBuf::from(r"C:\Program Files\SlimeVR"))
        );
        assert_eq!(
            super::strip_icon_path(r#""C:\Program Files\VRCT\VRCT.exe",0"#),
            Some(PathBuf::from(r"C:\Program Files\VRCT"))
        );
        assert_eq!(
            super::strip_icon_path(r#"MsiExec.exe /X{00000000-0000-0000-0000-000000000000}"#),
            None
        );
    }
}

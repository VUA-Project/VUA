//! Installation authority for N1. Probe the standalone Unity CLI before legacy Hub CLI,
//! without PATH lookup, global configuration edits, authentication or automatic upgrades.
//! Each command has fixed semantics; help output is capability evidence, never completion.

use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use vua_orchestrator::deployment::{
    DeploymentAction, DeploymentActivity, DeploymentInstaller, DeploymentInstallerKind,
    DeploymentObservation, DeploymentPhase, DeploymentPresence, DeploymentReporter,
    EditorDownloadPolicy,
};
use vua_orchestrator::{ProcessOutcome, ProcessRunner, ProcessSpec};

pub(super) const UNITY_VERSION: &str = vua_orchestrator::PRODUCTION_TARGET;
const UNITY_CHANGESET: &str = "887be4894c44";
const MAX_BINARY_BYTES: u64 = 256 * 1024 * 1024;

/// Official self-installer locations. UNITY_CLI_HOME is a process-local, user-configured
/// official override; neither this value nor executable paths are accepted from the UI.
pub(super) fn cli_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = std::env::var_os("UNITY_CLI_HOME") {
        candidates.push(PathBuf::from(root).join("bin/unity.exe"));
    }
    if let Some(root) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(root).join("Unity/bin/unity.exe"));
    }
    candidates
}

pub(super) struct UnityInstallProbe {
    pub runner: Arc<dyn ProcessRunner>,
    pub cli_candidates: Vec<PathBuf>,
}

impl UnityInstallProbe {
    pub fn cli_observation(&self, root: &str) -> DeploymentObservation {
        let supported = self
            .cli_candidates
            .iter()
            .find_map(|exe| self.probe(exe, DeploymentInstallerKind::UnityCli, root));
        let candidate = self.cli_candidates.iter().find(|exe| exe.exists());
        DeploymentObservation {
            component: "unity_cli".into(),
            presence: if supported.is_some() {
                DeploymentPresence::Verified
            } else if candidate.is_some() {
                DeploymentPresence::Unsuitable
            } else {
                DeploymentPresence::Missing
            },
            location: supported
                .as_ref()
                .map(|i| i.location.clone())
                .or_else(|| candidate.map(|p| p.to_string_lossy().into())),
            version: supported.map(|i| i.version),
        }
    }
    /// Signed executable discovery is independent of Hub presence. Licensing remains a
    /// separate user handoff; an installed CLI cannot fabricate an active license.
    pub fn discover(&self, hub: Option<&Path>, root: &str) -> Option<DeploymentInstaller> {
        if !safe_install_root(Path::new(root)) {
            return None;
        }
        self.cli_candidates
            .iter()
            .find_map(|exe| self.probe(exe, DeploymentInstallerKind::UnityCli, root))
            .or_else(|| hub.and_then(|exe| self.probe(exe, DeploymentInstallerKind::HubCli, root)))
    }

    fn probe(
        &self,
        exe: &Path,
        kind: DeploymentInstallerKind,
        root: &str,
    ) -> Option<DeploymentInstaller> {
        if !safe_install_root(exe.parent()?)
            || !crate::deployment_trust::trusted_unity_executable(exe)
        {
            return None;
        }
        let version = match kind {
            DeploymentInstallerKind::UnityCli => {
                let result = self.run(exe, &["--version"], 30).ok()?;
                let value = result.stdout.trim();
                if !result.success()
                    || result.truncated
                    || !plain_version(value)
                    || value != crate::unity_cli_bootstrap::CLI_VERSION
                {
                    return None;
                }
                value.to_owned()
            }
            // Hub's PE identity is display evidence; capability is checked below.
            DeploymentInstallerKind::HubCli => "legacy-hub-cli".to_owned(),
            DeploymentInstallerKind::UnityCliBootstrap => return None,
        };
        let help_args: &[&str] = match kind {
            DeploymentInstallerKind::UnityCli => &["install", "--help"],
            DeploymentInstallerKind::HubCli => &["--", "--headless", "help"],
            DeploymentInstallerKind::UnityCliBootstrap => return None,
        };
        let help = self.run(exe, help_args, 30).ok()?;
        let modules = if kind == DeploymentInstallerKind::UnityCli {
            Some(self.run(exe, &["install-modules", "--help"], 30).ok()?)
        } else {
            None
        };
        if !supported_help(kind, &help, modules.as_ref()) {
            return None;
        }
        let path_args: &[&str] = match kind {
            DeploymentInstallerKind::UnityCli => &["install-path", "--get"],
            DeploymentInstallerKind::HubCli => &["--", "--headless", "install-path", "--get"],
            DeploymentInstallerKind::UnityCliBootstrap => return None,
        };
        let path = self.run(exe, path_args, 30).ok()?;
        if !path.success() || path.truncated || !same_windows_path(path.stdout.trim(), root) {
            return None;
        }
        Some(DeploymentInstaller {
            kind,
            location: exe.to_str()?.to_owned(),
            version,
            file_sha256: binary_digest(exe)?,
            editor_root: root.to_owned(),
        })
    }

    /// Mutation uses the same binary and command family as the reviewed plan. Changed
    /// bytes, trust, capabilities or destination require fresh consent, even between steps.
    pub fn install(
        &self,
        action: DeploymentAction,
        confirmed: &DeploymentInstaller,
        data_root: &Path,
        download_policy: &EditorDownloadPolicy,
        report: &mut DeploymentReporter<'_>,
    ) -> Result<(), &'static str> {
        let exe = Path::new(&confirmed.location);
        if self
            .probe(exe, confirmed.kind, &confirmed.editor_root)
            .as_ref()
            != Some(confirmed)
        {
            return Err("vua.deployment.plan_changed");
        }
        if action == DeploymentAction::InstallEditor
            && confirmed.kind == DeploymentInstallerKind::UnityCli
        {
            // Ask the official CLI for the fixed release before fetching its original
            // installer. --force only refreshes this dry-run plan; it never reinstalls.
            // CLI beta.11 omits a URL and can label a registered c1 as f1, so the adapter
            // uses the pinned official entry and inspects the actual downloaded bytes.
            report(DeploymentActivity::from_source(
                DeploymentPhase::ResolvingSource,
                vua_orchestrator::deployment::EditorDownloadSource::Official,
            ))?;
            let release = self.run(exe, &official_plan_args(), 120)?;
            if let Err(cause) = official_editor_plan(&release) {
                report(DeploymentActivity {
                    cause: Some(cause),
                    ..DeploymentActivity::from_source(
                        DeploymentPhase::SourceFailed,
                        vua_orchestrator::deployment::EditorDownloadSource::Official,
                    )
                })?;
                return Err("vua.deployment.hub_fallback_required");
            }
            let destination = crate::unity_editor_install::install_editor(
                data_root,
                &confirmed.editor_root,
                self.runner.as_ref(),
                download_policy,
                report,
            )?;
            // CLI "editors add" takes the Editor application, not the container
            // directory chosen by the NSIS installer.
            let application = destination.join("Editor/Unity.exe");
            let path = application
                .to_str()
                .ok_or("vua.deployment.invalid_location")?;
            report(DeploymentActivity {
                editor_version: if destination
                    .ends_with(vua_orchestrator::deployment::CHINA_EDITOR_TARGET)
                {
                    Some(vua_orchestrator::deployment::CHINA_EDITOR_TARGET)
                } else {
                    Some(vua_orchestrator::PRODUCTION_TARGET)
                },
                ..DeploymentActivity::new(DeploymentPhase::Registering)
            })?;
            let outcome = self.run(
                exe,
                &["--no-log-proxy", "--format", "json", "editors", "add", path],
                120,
            )?;
            registration_result(&outcome)?;
            return Ok(());
        }
        let args = install_args(confirmed.kind, action)?;
        report(DeploymentActivity::new(DeploymentPhase::Installing))?;
        let outcome = self.run(exe, &args, 7200)?;
        if confirmed.kind == DeploymentInstallerKind::UnityCli {
            cli_install_result(&outcome, action)?;
        }
        if !outcome.success() {
            return Err("vua.deployment.install_failed");
        }
        // The caller must verify Editor identity/module files after success; an exit code
        // is not readiness. Timeout may leave partial files; no implicit OS rollback.
        Ok(())
    }

    fn run(&self, exe: &Path, args: &[&str], seconds: u64) -> Result<ProcessOutcome, &'static str> {
        let mut spec = ProcessSpec {
            executable: exe.into(),
            args: args.iter().map(|s| (*s).into()).collect(),
            timeout: Duration::from_secs(seconds),
            output_limit: 64 * 1024,
            ..ProcessSpec::default()
        };
        // No application-service credentials or output-format overrides flow to the CLI.
        // User-owned Hub/CLI browser sessions stay inside Unity's own storage.
        spec.removals.extend(
            [
                "UNITY_SERVICE_ACCOUNT_ID",
                "UNITY_SERVICE_ACCOUNT_SECRET",
                "UNITY_AUTH_TOKEN",
                "UNITY_FORMAT",
            ]
            .map(str::to_owned),
        );
        spec.sets.insert("UNITY_NO_CLOUD".into(), "1".into());
        spec.sets.insert("UNITY_NO_PAGER".into(), "1".into());
        spec.sets.insert("UNITY_NO_UPDATE_CHECK".into(), "1".into());
        // Prompts/EULAs are not auto-accepted. Modules requiring consent fail with a
        // manual official-CLI path; captured vendor output never enters task/user logs.
        spec.sets.insert("UNITY_NON_INTERACTIVE".into(), "1".into());
        self.runner
            .run(&spec)
            .map_err(|_| "vua.deployment.process_failed")
    }
}

fn plain_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.starts_with(|c: char| c.is_ascii_digit())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'+'))
}

fn official_plan_args() -> [&'static str; 11] {
    [
        "--no-log-proxy",
        "--format",
        "json",
        "install",
        UNITY_VERSION,
        "--changeset",
        UNITY_CHANGESET,
        "--architecture",
        "x86_64",
        "--force",
        "--dry-run",
    ]
}

/// This is release metadata, not installed-Editor identity. A c1 artifact is admitted
/// separately by its own pinned digest, signer and post-install executable version.
fn official_editor_plan(outcome: &ProcessOutcome) -> Result<(), &'static str> {
    cli_install_result(outcome, DeploymentAction::InstallEditor)?;
    let value: serde_json::Value = serde_json::from_str(&outcome.stdout)
        .map_err(|_| "vua.deployment.vendor_result_unreadable")?;
    let editor = &value["data"]["editor"];
    if editor["version"] != UNITY_VERSION
        || editor["architecture"] != "x86_64"
        || editor["checksum"] != "md5-NGI1YmNlYTYzZjNkZTgzNzdlNjlkMTI3ZDNjZTRjMWQ="
    {
        return Err("vua.deployment.editor_source_changed");
    }
    Ok(())
}

/// Registration is a separate step after the native installer has produced a verified
/// Editor. A failed registration retains that usable installation for reinspection.
fn registration_result(outcome: &ProcessOutcome) -> Result<(), &'static str> {
    let result: serde_json::Value = serde_json::from_str(&outcome.stdout)
        .map_err(|_| "vua.deployment.editor_registration_failed")?;
    if !outcome.success()
        || outcome.truncated
        || !outcome.process_tree_clean
        || result.get("success").and_then(serde_json::Value::as_bool) != Some(true)
        || result.get("command").and_then(serde_json::Value::as_str) != Some("editors")
        || !result
            .get("errors")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|errors| errors.is_empty())
    {
        return Err("vua.deployment.editor_registration_failed");
    }
    Ok(())
}

/// Consume only the official CLI's structured result, never its free-text diagnostics or
/// shared log history. Exit zero alone is insufficient, and INSTALL_FAILED does not identify
/// a root cause: it can include a regional replacement, bad checksum or installer failure.
/// Keep those possibilities as guidance rather than fabricating a more specific diagnosis.
fn cli_install_result(
    outcome: &ProcessOutcome,
    action: DeploymentAction,
) -> Result<(), &'static str> {
    #[derive(serde::Deserialize)]
    struct CliError {
        code: String,
    }
    #[derive(serde::Deserialize)]
    struct CliResult {
        success: bool,
        command: String,
        errors: Vec<CliError>,
    }
    if outcome.timed_out || outcome.cancelled || !outcome.process_tree_clean {
        return Err("vua.deployment.process_failed");
    }
    if outcome.truncated {
        return Err("vua.deployment.vendor_result_unreadable");
    }
    let result: CliResult = serde_json::from_str(&outcome.stdout)
        .map_err(|_| "vua.deployment.vendor_result_unreadable")?;
    let command = match action {
        DeploymentAction::InstallEditor => "install",
        DeploymentAction::AddAndroidModules => "install-modules",
        _ => return Err("vua.deployment.action_refused"),
    };
    if result.command != command {
        return Err("vua.deployment.vendor_result_unreadable");
    }
    if outcome.exit_code == Some(6)
        && !result.success
        && result
            .errors
            .iter()
            .any(|error| error.code == "INSTALL_FAILED")
    {
        return Err("vua.deployment.vendor_install_failed");
    }
    if !outcome.success() || !result.success || !result.errors.is_empty() {
        return Err("vua.deployment.install_failed");
    }
    Ok(())
}

fn supported_help(
    kind: DeploymentInstallerKind,
    help: &ProcessOutcome,
    modules: Option<&ProcessOutcome>,
) -> bool {
    if !help.success() || help.truncated {
        return false;
    }
    match kind {
        DeploymentInstallerKind::HubCli => {
            help.stdout.contains("install-modules") && help.stdout.contains("install-path")
        }
        DeploymentInstallerKind::UnityCli => {
            help.stdout.contains("Usage: unity install")
                && help.stdout.contains("--changeset")
                && help.stdout.contains("--dry-run")
                && help.stdout.contains("--force")
                && help.stdout.contains("--architecture")
                && modules.is_some_and(|m| {
                    m.success()
                        && !m.truncated
                        && m.stdout.contains("Usage: unity install-modules")
                        && m.stdout.contains("--editor-version")
                        && m.stdout.contains("--module")
                })
        }
        DeploymentInstallerKind::UnityCliBootstrap => false,
    }
}

fn binary_digest(exe: &Path) -> Option<String> {
    let mut file = std::fs::File::open(exe).ok()?;
    let size = file.metadata().ok()?.len();
    if size == 0 || size > MAX_BINARY_BYTES {
        return None;
    }
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut total = 0u64;
    loop {
        let count = file.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_BINARY_BYTES {
            return None;
        }
        digest.update(&buffer[..count]);
    }
    if total != size {
        return None;
    }
    Some(
        digest
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect(),
    )
}

/// Closed vendor commands. Never use latest/LTS aliases, service auth, --force, global
/// install-path writes or project/cloud commands. Components are added explicitly.
fn install_args(
    kind: DeploymentInstallerKind,
    action: DeploymentAction,
) -> Result<Vec<&'static str>, &'static str> {
    if kind == DeploymentInstallerKind::UnityCliBootstrap {
        return Err("vua.deployment.action_refused");
    }
    let prefix = if kind == DeploymentInstallerKind::HubCli {
        vec!["--", "--headless"]
    } else {
        // Piped CLI output defaults to TSV and can be empty on failure. JSON is an
        // explicit machine contract; disable proxy request logging even if configured.
        vec!["--no-log-proxy", "--format", "json"]
    };
    let mut args = prefix;
    match action {
        DeploymentAction::InstallEditor => {
            args.push("install");
            if kind == DeploymentInstallerKind::HubCli {
                args.push("--version");
            }
            args.extend([UNITY_VERSION, "--changeset", UNITY_CHANGESET]);
        }
        DeploymentAction::AddAndroidModules => {
            args.extend([
                "install-modules",
                if kind == DeploymentInstallerKind::HubCli {
                    "--version"
                } else {
                    "--editor-version"
                },
                UNITY_VERSION,
                "--module",
                "android",
                "android-sdk-ndk-tools",
                "android-open-jdk",
            ]);
        }
        _ => return Err("vua.deployment.action_refused"),
    }
    if kind == DeploymentInstallerKind::HubCli {
        args.push("--errors");
    }
    Ok(args)
}

pub(super) fn same_windows_path(a: &str, b: &str) -> bool {
    a.replace('/', "\\")
        .trim_end_matches('\\')
        .eq_ignore_ascii_case(b.replace('/', "\\").trim_end_matches('\\'))
}

/// Refuse redirected/unreadable ancestors before both probes and installation. This is
/// accidental-redirection protection, not an OS transaction against hostile file replacement.
pub(super) fn safe_install_root(root: &Path) -> bool {
    if !cfg!(windows) || !root.is_absolute() {
        return false;
    }
    for ancestor in root.ancestors() {
        match std::fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {
                        return false;
                    }
                }
                if !meta.is_dir() || meta.file_type().is_symlink() {
                    return false;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    fn result(stdout: &str) -> ProcessOutcome {
        ProcessOutcome {
            exit_code: Some(0),
            timed_out: false,
            cancelled: false,
            process_tree_clean: true,
            stdout: stdout.into(),
            stderr: String::new(),
            truncated: false,
        }
    }
    #[test]
    fn release_plan_is_read_only_and_cannot_authorize_a_different_editor() {
        let args = official_plan_args();
        assert!(args.contains(&"--dry-run") && args.contains(&"--force"));
        assert!(!args.contains(&"--accept-eula"));
        let valid = serde_json::json!({"success":true,"command":"install","errors":[],
            "data":{"alreadyInstalled":true,"editor":{"version":UNITY_VERSION,
                "architecture":"x86_64","downloadSize":0,
                "checksum":"md5-NGI1YmNlYTYzZjNkZTgzNzdlNjlkMTI3ZDNjZTRjMWQ="}}});
        assert!(official_editor_plan(&result(&valid.to_string())).is_ok());
        for (field, value) in [
            ("version", "6000.0.1f1"),
            ("architecture", "arm64"),
            ("checksum", "different"),
        ] {
            let mut changed = valid.clone();
            changed["data"]["editor"][field] = value.into();
            assert_eq!(
                official_editor_plan(&result(&changed.to_string())),
                Err("vua.deployment.editor_source_changed")
            );
        }
        let mut failed = result(&valid.to_string());
        failed.exit_code = Some(6);
        assert!(official_editor_plan(&failed).is_err());
    }
    #[test]
    fn help_must_describe_the_requested_command_not_a_successful_unknown_command() {
        let install =
            result("Usage: unity install [version] --changeset --dry-run --force --architecture");
        let modules = result("Usage: unity install-modules --editor-version --module");
        assert!(supported_help(
            DeploymentInstallerKind::UnityCli,
            &install,
            Some(&modules)
        ));
        assert!(!supported_help(
            DeploymentInstallerKind::UnityCli,
            &result("Usage: unity install [version] --changeset"),
            Some(&modules)
        ));
        assert!(!supported_help(
            DeploymentInstallerKind::UnityCli,
            &result("Usage: unity [command] install-modules"),
            Some(&modules)
        ));
        assert!(!supported_help(
            DeploymentInstallerKind::UnityCli,
            &install,
            Some(&result("Usage: unity [command]"))
        ));
        let mut truncated = modules.clone();
        truncated.truncated = true;
        assert!(!supported_help(
            DeploymentInstallerKind::UnityCli,
            &install,
            Some(&truncated)
        ));
    }
    #[test]
    fn command_families_cannot_mix_or_select_a_floating_editor() {
        for kind in [
            DeploymentInstallerKind::UnityCli,
            DeploymentInstallerKind::HubCli,
        ] {
            let install = install_args(kind, DeploymentAction::InstallEditor).unwrap();
            assert!(install.contains(&UNITY_VERSION) && install.contains(&UNITY_CHANGESET));
            assert_eq!(
                install.contains(&"--headless"),
                kind == DeploymentInstallerKind::HubCli
            );
            assert_eq!(
                install.contains(&"--version"),
                kind == DeploymentInstallerKind::HubCli
            );
            let modules = install_args(kind, DeploymentAction::AddAndroidModules).unwrap();
            assert!(
                modules.contains(&"android-sdk-ndk-tools") && modules.contains(&"android-open-jdk")
            );
            for action in [
                DeploymentAction::Retain,
                DeploymentAction::Inspect,
                DeploymentAction::ManualInstall,
            ] {
                assert!(install_args(kind, action).is_err());
            }
            assert!(!install.contains(&"--force") && !install.contains(&"lts"));
        }
    }
    #[test]
    fn path_output_and_version_do_not_accept_extra_diagnostic_lines() {
        assert!(same_windows_path(r"c:/Editors", r"C:\Editors"));
        assert!(!same_windows_path("notice\nC:\\Editors", r"C:\Editors"));
        assert!(plain_version("0.1.0-beta.3"));
        assert!(!plain_version("0.1.0\nlogged in as someone"));
    }

    #[test]
    fn structured_install_failure_exposes_only_a_closed_code() {
        let mut failed = result(
            r#"{"success":false,"command":"install","data":null,"errors":[{"code":"INSTALL_FAILED","message":"private vendor details"}],"warnings":[]}"#,
        );
        failed.exit_code = Some(6);
        assert_eq!(
            cli_install_result(&failed, DeploymentAction::InstallEditor),
            Err("vua.deployment.vendor_install_failed")
        );
        // Never classify a cancelled or still-running process by stale stdout.
        failed.process_tree_clean = false;
        assert_eq!(
            cli_install_result(&failed, DeploymentAction::InstallEditor),
            Err("vua.deployment.process_failed")
        );
    }

    #[test]
    fn cli_completion_requires_matching_complete_json_and_exit_status() {
        let valid = result(r#"{"success":true,"command":"install","errors":[]}"#);
        assert!(cli_install_result(&valid, DeploymentAction::InstallEditor).is_ok());
        assert_eq!(
            cli_install_result(&valid, DeploymentAction::AddAndroidModules),
            Err("vua.deployment.vendor_result_unreadable")
        );
        for stdout in ["", "installed", r#"{"success":true}"#] {
            assert_eq!(
                cli_install_result(&result(stdout), DeploymentAction::InstallEditor),
                Err("vua.deployment.vendor_result_unreadable")
            );
        }
        let mut truncated = valid.clone();
        truncated.truncated = true;
        assert!(cli_install_result(&truncated, DeploymentAction::InstallEditor).is_err());
        let mut nonzero = valid;
        nonzero.exit_code = Some(6);
        assert!(cli_install_result(&nonzero, DeploymentAction::InstallEditor).is_err());
        let contradictory =
            result(r#"{"success":true,"command":"install","errors":[{"code":"INSTALL_FAILED"}]}"#);
        assert!(cli_install_result(&contradictory, DeploymentAction::InstallEditor).is_err());
    }

    #[test]
    fn editor_registration_requires_its_own_complete_result() {
        // beta.11 returns the command family "editors", including for add.
        let valid = result(r#"{"success":true,"command":"editors","errors":[]}"#);
        assert!(registration_result(&valid).is_ok());
        for stdout in [
            "",
            r#"{"success":true,"command":"install","errors":[]}"#,
            r#"{"success":true,"command":"editors"}"#,
            r#"{"success":true,"command":"editors","errors":[{"code":"EDITOR_NOT_FOUND"}]}"#,
        ] {
            assert!(registration_result(&result(stdout)).is_err());
        }
        for failed in [
            ProcessOutcome {
                truncated: true,
                ..valid.clone()
            },
            ProcessOutcome {
                exit_code: Some(6),
                ..valid.clone()
            },
            ProcessOutcome {
                process_tree_clean: false,
                ..valid
            },
        ] {
            assert!(registration_result(&failed).is_err());
        }
    }
}

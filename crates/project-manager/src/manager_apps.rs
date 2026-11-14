//! Manager application executable discovery (`v0.1`) and detached breakaway launch (`v0.2`).
//! Config files are deliberately not installation evidence, and external projects are never
//! passed as CLI write targets (Ruling U3).

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use vua_orchestrator::{
    Clock, EnvironmentEngine, EnvironmentPresence, EnvironmentRoots, RegistryHive, SystemClock,
};

const MAX_COMMAND_LEDGER: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManagerAppId {
    UnityHub,
    Vcc,
    Alcom,
}

impl ManagerAppId {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "unity_hub" => Some(Self::UnityHub),
            "vcc" => Some(Self::Vcc),
            "alcom" => Some(Self::Alcom),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnityHub => "unity_hub",
            Self::Vcc => "vcc",
            Self::Alcom => "alcom",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerApps {
    pub schema_version: &'static str,
    pub captured_at: String,
    pub apps: Vec<ManagerApp>,
}

#[derive(Serialize)]
pub struct ManagerApp {
    pub component: &'static str,
    pub presence: &'static str,
    pub path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerAppLaunch {
    pub schema_version: &'static str,
    pub manager_id: &'static str,
    pub launched_at: String,
}

/// How to start a detected manager application.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HubLaunch {
    /// A packaged (MSIX) Hub starts through its application identity (`shell:AppsFolder\<AUMID>`),
    /// so it runs inside its package and reaches its packaged login and license state.
    Package {
        app_user_model_id: String,
    },
    Executable(PathBuf),
}

/// Reads the launch target from the environment's `unity_hub` facts (`exe`, `via`, `package`).
pub fn hub_launch(facts: &serde_json::Value) -> Option<HubLaunch> {
    let exe = PathBuf::from(facts["exe"].as_str()?);
    if facts["via"] != "package" {
        return Some(HubLaunch::Executable(exe));
    }
    // Full name `Name_Version_Arch__PublisherId`; the family name is `Name_PublisherId`.
    let full = facts["package"].as_str()?;
    let (name, _) = full.split_once('_')?;
    let (_, publisher) = full.rsplit_once("__")?;
    if !valid_aumid_segment(name) || !valid_aumid_segment(publisher) {
        return None;
    }
    let root = exe.parent()?.parent()?;
    let app = application_id(root).unwrap_or_else(|| "UnityHub".into());
    Some(HubLaunch::Package {
        app_user_model_id: format!("{name}_{publisher}!{app}"),
    })
}

fn valid_aumid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

fn application_id(package_root: &Path) -> Option<String> {
    let manifest = std::fs::read_to_string(package_root.join("AppxManifest.xml")).ok()?;
    let start = manifest.find("<Application ")?;
    let rest = &manifest[start..];
    let id = rest[rest.find("Id=\"")? + 4..].split('"').next()?;
    valid_aumid_segment(id).then(|| id.to_owned())
}

#[cfg(windows)]
pub fn spawn_hub_launch(launch: &HubLaunch) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::{
        CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP,
    };

    let build_command = |breakaway: bool| {
        let mut command = match launch {
            HubLaunch::Package { app_user_model_id } => {
                let mut command = std::process::Command::new("explorer.exe");
                command.arg(format!("shell:AppsFolder\\{app_user_model_id}"));
                command
            }
            HubLaunch::Executable(exe) => {
                let mut command = std::process::Command::new(exe);
                if let Some(parent) = exe.parent() {
                    command.current_dir(parent);
                }
                command
            }
        };
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        vua_orchestrator::strip_sensitive_env(&mut command);
        let flags = if breakaway {
            CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP
        } else {
            CREATE_NEW_PROCESS_GROUP
        };
        command.creation_flags(flags);
        command
    };

    let mut child = match build_command(true).spawn() {
        Ok(child) => child,
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            build_command(false).spawn()?
        }
        Err(err) => return Err(err),
    };
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(not(windows))]
pub fn spawn_hub_launch(_launch: &HubLaunch) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

pub trait ManagerProcessSpawner: Send + Sync {
    fn spawn_detached(&self, target: &HubLaunch) -> Result<(), &'static str>;
}

pub struct WindowsManagerProcessSpawner;

impl ManagerProcessSpawner for WindowsManagerProcessSpawner {
    fn spawn_detached(&self, target: &HubLaunch) -> Result<(), &'static str> {
        if let HubLaunch::Executable(executable) = target {
            if !valid_pe_executable(executable).unwrap_or(false) {
                return Err("not_found");
            }
        }
        spawn_hub_launch(target).map_err(|_| "launch_failed")
    }
}

type LaunchTargetResolver =
    dyn Fn(&EnvironmentRoots, ManagerAppId) -> Option<HubLaunch> + Send + Sync;

pub struct ManagerAppLauncher {
    roots: EnvironmentRoots,
    resolver: Arc<LaunchTargetResolver>,
    spawner: Arc<dyn ManagerProcessSpawner>,
    clock: Arc<dyn Clock>,
    launch_gate: Mutex<()>,
    ledger: Mutex<BTreeMap<String, ManagerAppLaunch>>,
}

impl ManagerAppLauncher {
    pub fn windows(roots: EnvironmentRoots) -> Self {
        Self {
            roots,
            resolver: Arc::new(resolve_launch_target),
            spawner: Arc::new(WindowsManagerProcessSpawner),
            clock: Arc::new(SystemClock),
            launch_gate: Mutex::new(()),
            ledger: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn with_dependencies(
        roots: EnvironmentRoots,
        resolver: Arc<LaunchTargetResolver>,
        spawner: Arc<dyn ManagerProcessSpawner>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            roots,
            resolver,
            spawner,
            clock,
            launch_gate: Mutex::new(()),
            ledger: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn open(
        &self,
        manager_id: ManagerAppId,
        command_id: &str,
    ) -> Result<ManagerAppLaunch, &'static str> {
        if !valid_command_id(command_id) {
            return Err("invalid_command");
        }
        let _gate = self.launch_gate.lock().map_err(|_| "unavailable")?;
        {
            let ledger = self.ledger.lock().map_err(|_| "unavailable")?;
            if let Some(existing) = ledger.get(command_id) {
                if existing.manager_id == manager_id.as_str() {
                    return Ok(existing.clone());
                }
                return Err("command_conflict");
            }
            if ledger.len() >= MAX_COMMAND_LEDGER {
                return Err("command_conflict");
            }
        }

        let target = (self.resolver)(&self.roots, manager_id).ok_or("not_found")?;
        if let HubLaunch::Executable(executable) = &target {
            if !valid_pe_executable(executable).unwrap_or(false) {
                return Err("not_found");
            }
        }
        self.spawner.spawn_detached(&target)?;

        let receipt = ManagerAppLaunch {
            schema_version: "vua.manager-apps/v0.2",
            manager_id: manager_id.as_str(),
            launched_at: self.clock.now_rfc3339(),
        };
        let mut ledger = self.ledger.lock().map_err(|_| "unavailable")?;
        if let Some(existing) = ledger.get(command_id) {
            if existing.manager_id == manager_id.as_str() {
                return Ok(existing.clone());
            }
            return Err("command_conflict");
        }
        if ledger.len() < MAX_COMMAND_LEDGER {
            ledger.insert(command_id.to_owned(), receipt.clone());
        }
        Ok(receipt)
    }
}

pub fn valid_command_id(command_id: &str) -> bool {
    !command_id.is_empty()
        && command_id.len() <= 128
        && command_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
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

pub fn resolve_launch_target(
    roots: &EnvironmentRoots,
    manager_id: ManagerAppId,
) -> Option<HubLaunch> {
    match manager_id {
        ManagerAppId::UnityHub => {
            let engine = EnvironmentEngine::new(
                std::sync::Arc::new(vua_orchestrator::StdProcessRunner),
                std::sync::Arc::new(SystemClock),
                roots.clone(),
                std::sync::Arc::new(crate::VccSettingsFileReader),
            );
            let hub = engine.inspect_unity_hub();
            if hub.presence != EnvironmentPresence::Detected {
                return None;
            }
            match hub_launch(&hub.facts)? {
                launch @ HubLaunch::Package { .. } => Some(launch),
                HubLaunch::Executable(exe) => exe.is_file().then_some(HubLaunch::Executable(exe)),
            }
        }
        ManagerAppId::Vcc | ManagerAppId::Alcom => {
            resolve_executable_path(roots, manager_id).map(HubLaunch::Executable)
        }
    }
}

pub fn resolve_executable_path(
    roots: &EnvironmentRoots,
    manager_id: ManagerAppId,
) -> Option<PathBuf> {
    let app = inspect_one(roots, manager_id);
    (app.presence == "found")
        .then_some(app.path)
        .flatten()
        .map(PathBuf::from)
}

fn inspect_one(roots: &EnvironmentRoots, manager_id: ManagerAppId) -> ManagerApp {
    match manager_id {
        ManagerAppId::UnityHub => {
            let engine = EnvironmentEngine::new(
                std::sync::Arc::new(vua_orchestrator::StdProcessRunner),
                std::sync::Arc::new(SystemClock),
                roots.clone(),
                std::sync::Arc::new(crate::VccSettingsFileReader),
            );
            let hub = engine.inspect_unity_hub();
            let hub_path = hub.facts["exe"].as_str().map(PathBuf::from);
            let packaged = hub.facts["via"] == "package" && hub_launch(&hub.facts).is_some();
            let hub_presence = match hub.presence {
                EnvironmentPresence::Detected
                    if packaged || hub_path.as_ref().is_some_and(|p| p.is_file()) =>
                {
                    "found"
                }
                EnvironmentPresence::NotDetected => "not_found",
                _ => "unknown",
            };
            ManagerApp {
                component: "unity_hub",
                presence: hub_presence,
                path: hub_path.map(|p| p.to_string_lossy().into_owned()),
            }
        }
        ManagerAppId::Vcc => inspect_companion_manager(
            roots,
            "vcc",
            "VRChat Creator Companion",
            &["CreatorCompanion.exe"],
            &roots.vcc_exe_candidates,
        ),
        ManagerAppId::Alcom => inspect_companion_manager(
            roots,
            "alcom",
            "ALCOM",
            &["ALCOM.exe", "vrc-get-gui.exe"],
            &roots.alcom_exe_candidates,
        ),
    }
}

fn inspect_companion_manager(
    roots: &EnvironmentRoots,
    component: &'static str,
    product: &str,
    binaries: &[&str],
    root_candidates: &[PathBuf],
) -> ManagerApp {
    let mut candidates = root_candidates.to_vec();
    for binary in binaries {
        for hive in [RegistryHive::CurrentUser, RegistryHive::LocalMachine] {
            let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{binary}");
            if let Some(path) = roots.registry.get_string(hive, &key, "") {
                candidates.push(PathBuf::from(path.trim_matches('"')));
            }
            for product_key in [product.to_owned(), format!("{product}_is1")] {
                for prefix in [
                    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
                ] {
                    let key = format!(r"{prefix}\{product_key}");
                    if let Some(root) = roots.registry.get_string(hive, &key, "InstallLocation") {
                        candidates.push(PathBuf::from(root.trim_matches('"')).join(binary));
                    }
                }
            }
        }
    }
    discover(component, &candidates)
}

pub fn inspect(roots: &EnvironmentRoots) -> ManagerApps {
    let apps = vec![
        inspect_one(roots, ManagerAppId::UnityHub),
        inspect_one(roots, ManagerAppId::Vcc),
        inspect_one(roots, ManagerAppId::Alcom),
    ];
    ManagerApps {
        schema_version: "vua.manager-apps/v0.1",
        captured_at: SystemClock.now_rfc3339(),
        apps,
    }
}

fn discover(component: &'static str, candidates: &[PathBuf]) -> ManagerApp {
    let mut unreadable = false;
    let path = candidates.iter().find_map(|p| match std::fs::metadata(p) {
        Ok(metadata) if metadata.is_file() => Some(p.to_string_lossy().into_owned()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            unreadable = true;
            None
        }
        _ => None,
    });
    ManagerApp {
        component,
        presence: if path.is_some() {
            "found"
        } else if unreadable {
            "unknown"
        } else {
            "not_found"
        },
        path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vua_orchestrator::FakeRegistrySource;

    struct RecordingSpawner {
        calls: Mutex<Vec<HubLaunch>>,
    }

    impl ManagerProcessSpawner for RecordingSpawner {
        fn spawn_detached(&self, target: &HubLaunch) -> Result<(), &'static str> {
            self.calls.lock().unwrap().push(target.clone());
            Ok(())
        }
    }

    struct FixedClock;
    impl Clock for FixedClock {
        fn now_rfc3339(&self) -> String {
            "2026-11-14T03:00:00Z".to_owned()
        }
    }

    fn fake_roots(root: &Path) -> EnvironmentRoots {
        EnvironmentRoots {
            local_low: root.to_path_buf(),
            unity_hub_exe_candidates: Vec::new(),
            unity_hub_registry_display_icon_keys: Vec::new(),
            vcc_exe_candidates: Vec::new(),
            alcom_exe_candidates: Vec::new(),
            registry: Arc::new(FakeRegistrySource::new()),
            ..EnvironmentRoots::default()
        }
    }

    #[test]
    fn synthetic_roots_never_leak_host_machine_manager_installs() {
        let root = std::env::temp_dir().join(format!("vua-manager-iso-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let snapshot = inspect(&fake_roots(&root));
        assert_eq!(snapshot.apps.len(), 3);
        for app in &snapshot.apps {
            assert_eq!(app.presence, "not_found", "leaked {}", app.component);
            assert!(app.path.is_none());
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn configuration_and_empty_folders_do_not_count_as_apps() {
        let root = std::env::temp_dir().join(format!("vua-manager-app-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let exe = root.join("ALCOM.exe");
        std::fs::write(root.join("settings.json"), "{}").unwrap();
        assert_eq!(
            discover("alcom", std::slice::from_ref(&exe)).presence,
            "not_found"
        );
        std::fs::write(&exe, "fixture").unwrap();
        assert_eq!(discover("alcom", &[exe]).presence, "found");
        std::fs::remove_file(root.join("ALCOM.exe")).unwrap();
        std::fs::remove_file(root.join("settings.json")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn open_validates_pe_header_and_enforces_command_idempotency() {
        let root = std::env::temp_dir().join(format!("vua-manager-launch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let bad_exe = root.join("not-pe.exe");
        std::fs::write(&bad_exe, b"not an executable").unwrap();

        let good_exe = root.join("ALCOM.exe");
        let mut pe_bytes = vec![0u8; 128];
        pe_bytes[0] = b'M';
        pe_bytes[1] = b'Z';
        std::fs::write(&good_exe, &pe_bytes).unwrap();

        let spawner = Arc::new(RecordingSpawner {
            calls: Mutex::new(Vec::new()),
        });
        let bad_clone = bad_exe.clone();
        let good_clone = good_exe.clone();
        let launcher = ManagerAppLauncher::with_dependencies(
            fake_roots(&root),
            Arc::new(move |_, id| match id {
                ManagerAppId::Alcom => Some(HubLaunch::Executable(good_clone.clone())),
                ManagerAppId::Vcc => Some(HubLaunch::Executable(bad_clone.clone())),
                ManagerAppId::UnityHub => None,
            }),
            spawner.clone(),
            Arc::new(FixedClock),
        );

        // Missing or non-PE executables are rejected before spawning.
        assert_eq!(
            launcher.open(ManagerAppId::UnityHub, "cmd-missing"),
            Err("not_found")
        );
        assert_eq!(
            launcher.open(ManagerAppId::Vcc, "cmd-bad-pe"),
            Err("not_found")
        );
        assert!(spawner.calls.lock().unwrap().is_empty());

        // Valid PE spawns once and replays idempotently on duplicate commandId.
        let receipt = launcher.open(ManagerAppId::Alcom, "cmd-alcom-1").unwrap();
        assert_eq!(receipt.schema_version, "vua.manager-apps/v0.2");
        assert_eq!(receipt.manager_id, "alcom");
        assert_eq!(spawner.calls.lock().unwrap().len(), 1);

        let replay = launcher.open(ManagerAppId::Alcom, "cmd-alcom-1").unwrap();
        assert_eq!(replay, receipt);
        assert_eq!(spawner.calls.lock().unwrap().len(), 1);

        // Reusing commandId for another manager fails with command_conflict.
        assert_eq!(
            launcher.open(ManagerAppId::Vcc, "cmd-alcom-1"),
            Err("command_conflict")
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn packaged_msix_unity_hub_launches_via_aumid_without_pe_header_check() {
        let root = std::env::temp_dir().join(format!("vua-manager-msix-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let pkg_root = root
            .join("WindowsApps")
            .join("UnityTechnologies.UnityHub_3.22.3.65535_x64__2vrhnee42bhxm");
        std::fs::create_dir_all(pkg_root.join("app")).unwrap();
        // Write a tiny non-PE stub (not starting with "MZ" and < 64 bytes) so any accidental PE validation fails.
        std::fs::write(pkg_root.join("app").join("Unity Hub.exe"), b"msix-stub").unwrap();
        std::fs::write(
            pkg_root.join("AppxManifest.xml"),
            "<Applications><Application Id=\"UnityHub\" Executable=\"app\\Unity Hub.exe\">",
        )
        .unwrap();

        let repo_parent = r"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages";
        let pkg_full = "UnityTechnologies.UnityHub_3.22.3.65535_x64__2vrhnee42bhxm";
        let pkg_subkey = format!(r"{repo_parent}\{pkg_full}");

        let mut roots = fake_roots(&root);
        roots.registry = Arc::new(
            FakeRegistrySource::new()
                .with_subkey(RegistryHive::CurrentUser, repo_parent, pkg_full)
                .with(
                    RegistryHive::CurrentUser,
                    &pkg_subkey,
                    "PackageRootFolder",
                    &pkg_root.to_string_lossy(),
                ),
        );

        let snapshot = inspect(&roots);
        let hub_entry = snapshot
            .apps
            .iter()
            .find(|a| a.component == "unity_hub")
            .unwrap();
        assert_eq!(hub_entry.presence, "found");

        let spawner = Arc::new(RecordingSpawner {
            calls: Mutex::new(Vec::new()),
        });
        let launcher = ManagerAppLauncher::with_dependencies(
            roots,
            Arc::new(resolve_launch_target),
            spawner.clone(),
            Arc::new(FixedClock),
        );
        let receipt = launcher
            .open(ManagerAppId::UnityHub, "cmd-msix-hub-1")
            .unwrap();
        assert_eq!(receipt.manager_id, "unity_hub");
        assert_eq!(
            *spawner.calls.lock().unwrap(),
            vec![HubLaunch::Package {
                app_user_model_id: "UnityTechnologies.UnityHub_2vrhnee42bhxm!UnityHub".to_owned(),
            }]
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}

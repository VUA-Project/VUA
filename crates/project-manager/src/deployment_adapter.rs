//! N1 Windows installation adapter. Vendor executable discovery and command syntax live here.
//!
//! Region and the mirror preference choose Unity/NoUnityCN priority; the original installer and CLI perform
//! installation, registration and licensing. VUA never edits its global install path,
//! changes the VR runtime, invokes a shell, or accepts renderer-supplied commands. An automatic
//! action requires a trusted Unity-signed CLI, checked capabilities, and the exact confirmed
//! installation root. Unsupported/deprecated CLI behavior degrades to official UI guidance.

use crate::{verify_editor_path_system, EditorPathVerdict, VccSettingsFileReader};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vua_orchestrator::deployment::{
    accepted_development_editor, DeploymentAction, DeploymentAdapter, DeploymentInstaller,
    DeploymentIntent, DeploymentObservation, DeploymentPresence, DeploymentPurpose,
    DeploymentReporter, DownloadRegion, EditorDownloadPolicy, CHINA_EDITOR_TARGET,
};
use vua_orchestrator::{
    EnvironmentEngine, EnvironmentPresence, EnvironmentRoots, ProcessRunner, StdProcessRunner,
    SystemClock,
};

const UNITY_VERSION: &str = vua_orchestrator::PRODUCTION_TARGET;
use crate::unity_install::UnityInstallProbe;

pub struct WindowsDeploymentAdapter {
    engine: EnvironmentEngine,
    install_probe: UnityInstallProbe,
    data_root: PathBuf,
    region: crate::unity_download_region::RegionProbe,
}

impl WindowsDeploymentAdapter {
    pub fn new(roots: EnvironmentRoots) -> Self {
        let runner: Arc<dyn ProcessRunner> = Arc::new(StdProcessRunner);
        let data_root = std::env::var_os("VUA_PROVIDER_DATA")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("VUA")))
            .unwrap_or_default();
        let mut cli_candidates = vec![crate::unity_cli_bootstrap::managed_cli_path(&data_root)];
        cli_candidates.extend(crate::unity_install::cli_candidates());
        Self {
            engine: EnvironmentEngine::new(
                runner.clone(),
                Arc::new(SystemClock),
                roots,
                Arc::new(VccSettingsFileReader),
            ),
            install_probe: UnityInstallProbe {
                runner,
                cli_candidates,
            },
            data_root,
            region: crate::unity_download_region::RegionProbe::default(),
        }
    }

    /// Return only the actually observed executable. The renderer cannot nominate a program.
    fn hub(&self) -> Option<PathBuf> {
        self.engine
            .inspect_deployment_components()
            .iter()
            .find(|f| f.id == "unity_hub" && f.presence == EnvironmentPresence::Detected)
            .and_then(|f| f.facts.get("exe").and_then(|s| s.as_str()))
            .map(PathBuf::from)
    }
}

fn editor_observation(intent: &DeploymentIntent) -> DeploymentObservation {
    // Prefer actual global identity, including a user installation whose directory
    // name differs. Keep c1 as a usable fallback without hiding its version suffix.
    let observations: Vec<_> = [UNITY_VERSION, CHINA_EDITOR_TARGET]
        .iter()
        .map(|version| {
            let root = Path::new(&intent.editor_root).join(version);
            let (presence, observed_version) = if !root.exists() {
                (DeploymentPresence::Missing, Some((*version).to_owned()))
            } else {
                match verify_editor_path_system(&root) {
                    EditorPathVerdict::Verified(v) => (
                        if accepted_development_editor(&v.version) {
                            DeploymentPresence::Verified
                        } else {
                            DeploymentPresence::Unsuitable
                        },
                        Some(v.version),
                    ),
                    EditorPathVerdict::Refused(_) => (DeploymentPresence::DetectionFailed, None),
                }
            };
            DeploymentObservation {
                component: "unity_editor".into(),
                presence,
                location: Some(root.to_string_lossy().into()),
                version: observed_version,
            }
        })
        .collect();
    for version in [UNITY_VERSION, CHINA_EDITOR_TARGET] {
        if let Some(found) = observations.iter().find(|o| {
            o.presence == DeploymentPresence::Verified && o.version.as_deref() == Some(version)
        }) {
            return found.clone();
        }
    }
    observations
        .into_iter()
        .next()
        .expect("global observation exists")
}

fn android_observation(
    intent: &DeploymentIntent,
    editor: &DeploymentObservation,
) -> DeploymentObservation {
    let root = Path::new(&intent.editor_root).join(UNITY_VERSION);
    let root = editor
        .location
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or(root)
        .join("Editor/Data/PlaybackEngines/AndroidPlayer");
    let found = [
        "SDK/platform-tools/adb.exe",
        "NDK/source.properties",
        "OpenJDK/bin/java.exe",
        "UnityEditor.Android.Extensions.dll",
    ]
    .iter()
    .all(|p| root.join(p).is_file());
    DeploymentObservation {
        component: "android_modules".into(),
        presence: if found && editor.presence == DeploymentPresence::Verified {
            DeploymentPresence::Verified
        } else {
            DeploymentPresence::Missing
        },
        location: Some(root.to_string_lossy().into()),
        version: editor.version.clone(),
    }
}

impl DeploymentAdapter for WindowsDeploymentAdapter {
    fn download_region(&self) -> DownloadRegion {
        self.region.detect()
    }
    fn observe(&self, intent: &DeploymentIntent) -> Vec<DeploymentObservation> {
        let mut facts: Vec<_> = self
            .engine
            .inspect_deployment_components()
            .into_iter()
            .map(|f| {
                let location = f
                    .facts
                    .get("exe")
                    .or_else(|| f.facts.get("path"))
                    .or_else(|| f.facts.get("root"))
                    .and_then(|p| p.as_str())
                    .map(str::to_owned);
                let complete = location
                    .as_ref()
                    .is_some_and(|p| component_files_present(&f.id, Path::new(p)));
                DeploymentObservation {
                    component: f.id,
                    presence: match f.presence {
                        EnvironmentPresence::Detected if complete => DeploymentPresence::Verified,
                        EnvironmentPresence::Detected => DeploymentPresence::Unsuitable,
                        EnvironmentPresence::NotDetected => DeploymentPresence::Missing,
                        EnvironmentPresence::DetectionFailed => DeploymentPresence::DetectionFailed,
                    },
                    location,
                    version: None,
                }
            })
            .collect();
        let editor = editor_observation(intent);
        facts.push(android_observation(intent, &editor));
        facts.push(editor);
        if intent.purposes.iter().any(|p| {
            matches!(
                p,
                DeploymentPurpose::PcAvatar | DeploymentPurpose::QuestAvatar
            )
        }) {
            facts.push(self.install_probe.cli_observation(&intent.editor_root));
        }
        facts
    }

    fn installer(&self, intent: &DeploymentIntent) -> Option<DeploymentInstaller> {
        if !intent.purposes.iter().any(|p| {
            matches!(
                p,
                DeploymentPurpose::PcAvatar | DeploymentPurpose::QuestAvatar
            )
        }) {
            return None;
        }
        self.install_probe
            .discover(None, &intent.editor_root)
            .or_else(|| {
                crate::unity_cli_bootstrap::planned_cli(&self.data_root, &intent.editor_root)
            })
            .or_else(|| {
                self.install_probe
                    .discover(self.hub().as_deref(), &intent.editor_root)
            })
    }

    fn install(
        &self,
        intent: &DeploymentIntent,
        action: DeploymentAction,
        confirmed: &DeploymentInstaller,
        report: &mut DeploymentReporter<'_>,
    ) -> Result<(), &'static str> {
        intent.validate()?;
        let _machine_lease = InstallLease::acquire()?;
        if !crate::unity_install::same_windows_path(&intent.editor_root, &confirmed.editor_root) {
            return Err("vua.deployment.plan_changed");
        }
        if action == DeploymentAction::InstallUnityCli {
            crate::unity_cli_bootstrap::acquire_cli(&self.data_root, confirmed)?;
            if self
                .install_probe
                .cli_observation(&intent.editor_root)
                .presence
                != DeploymentPresence::Verified
            {
                return Err("vua.deployment.verification_failed");
            }
            return Ok(());
        }
        // Installer identity is rechecked while the machine installation lease is held.
        self.install_probe.install(
            action,
            confirmed,
            &self.data_root,
            &EditorDownloadPolicy::new(self.region.detect(), intent.use_mirrors),
            report,
        )?;
        let after = self.observe(intent);
        let component = if action == DeploymentAction::InstallEditor {
            "unity_editor"
        } else {
            "android_modules"
        };
        if !after
            .iter()
            .any(|f| f.component == component && f.presence == DeploymentPresence::Verified)
        {
            return Err("vua.deployment.verification_failed");
        }
        Ok(())
    }
}

/// All VUA instances in this Windows session share one installer lock. The OS releases the
/// handle on crash; an abandoned live lock is a refusal, never implicit installer recovery.
#[cfg(windows)]
struct InstallLease(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl InstallLease {
    fn acquire() -> Result<Self, &'static str> {
        Self::acquire_named("Local\\VUA.EnvironmentDeployment.v01")
    }

    fn acquire_named(mutex_name: &str) -> Result<Self, &'static str> {
        use windows_sys::Win32::{
            Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0},
            System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject},
        };
        let name: Vec<u16> = mutex_name.encode_utf16().chain(Some(0)).collect();
        // SAFETY: null default security; name is NUL-terminated and lives through creation.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return Err("vua.deployment.lock_unavailable");
        }
        // SAFETY: the handle is valid; zero wait never blocks the Provider request loop.
        let waited = unsafe { WaitForSingleObject(handle, 0) };
        if waited == WAIT_OBJECT_0 {
            return Ok(Self(handle));
        }
        // An abandoned acquisition grants ownership; release it while refusing this action.
        unsafe {
            if waited == WAIT_ABANDONED {
                ReleaseMutex(handle);
            }
            windows_sys::Win32::Foundation::CloseHandle(handle);
        }
        Err("vua.deployment.busy")
    }
}
#[cfg(windows)]
impl Drop for InstallLease {
    fn drop(&mut self) {
        // SAFETY: only a successful owner constructs this guard; it drops on that thread.
        unsafe {
            windows_sys::Win32::System::Threading::ReleaseMutex(self.0);
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(not(windows))]
struct InstallLease;
#[cfg(not(windows))]
impl InstallLease {
    fn acquire() -> Result<Self, &'static str> {
        Err("vua.deployment.unsupported_platform")
    }
}

/// Presence means the selected application's entry point was observed, not that it was
/// launched or its hardware worked. Incomplete installations require inspection, not overwrite.
fn component_files_present(component: &str, location: &Path) -> bool {
    match component {
        "steam" => location.join("steam.exe").is_file(),
        "steamvr" => location.join("bin/win64/vrmonitor.exe").is_file(),
        "pico_runtime" => location.join("PICO Connect.exe").is_file(),
        "unity_hub" | "vrchat" => location.is_file(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::unity_install::safe_install_root;
    #[test]
    fn empty_directory_does_not_verify_a_runtime() {
        let root = std::env::temp_dir().join(format!("vua-empty-runtime-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        for component in ["steam", "steamvr", "pico_runtime", "unity_hub", "vrchat"] {
            assert!(!component_files_present(component, &root));
        }
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn redirected_or_file_install_roots_are_refused() {
        assert!(!safe_install_root(Path::new("relative")));
        let root = std::env::temp_dir().join(format!("vua-file-root-{}", std::process::id()));
        std::fs::write(&root, b"synthetic").unwrap();
        assert!(!safe_install_root(&root.join("Editors")));
        std::fs::remove_file(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn install_lock_refuses_another_thread_until_the_first_owner_releases() {
        // Exercise the same OS lock without competing with an actual local installation.
        let name = format!("Local\\VUA.DeploymentTest.{}", std::process::id());
        let held = InstallLease::acquire_named(&name).unwrap();
        let other_name = name.clone();
        assert!(
            std::thread::spawn(move || InstallLease::acquire_named(&other_name).is_err())
                .join()
                .unwrap()
        );
        drop(held);
        assert!(InstallLease::acquire_named(&name).is_ok());
    }
}

//! N1 Windows installation adapter. Vendor executable discovery and command syntax live here.
//!
//! Region and the mirror preference choose Unity/NoUnityCN priority; the original installer and CLI perform
//! installation, registration and licensing. Steam and PICO Connect are acquired from their
//! pinned official sources (steam_install/pico_install), verified by exact leaf signer and,
//! for the versioned PICO artifact, pinned size + SHA-256. VUA never edits its global install
//! path, flips the active VR runtime setting, invokes a shell, or accepts renderer-supplied
//! commands. An automatic Unity action requires a trusted Unity-signed CLI, checked
//! capabilities, and the exact confirmed installation root. Unsupported/deprecated CLI
//! behavior degrades to official UI guidance.

use crate::{verify_editor_path_system, EditorPathVerdict, VccSettingsFileReader};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vua_orchestrator::deployment::{
    accepted_development_editor, DeploymentAction, DeploymentActivity, DeploymentAdapter,
    DeploymentInstaller, DeploymentIntent, DeploymentObservation, DeploymentPhase,
    DeploymentPresence, DeploymentPurpose, DeploymentReporter, DownloadRegion,
    EditorDownloadPolicy, EditorDownloadSource, PicoInstallRegion, CHINA_EDITOR_TARGET,
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
    /// Test-only acquisition seam: inline tests substitute the download/verify half and
    /// keep the real runner-facing half, because no synthetic bytes can pass WinVerifyTrust.
    #[cfg(test)]
    steam_install: Option<Arc<VendorInstallOverride>>,
    #[cfg(test)]
    pico_install: Option<Arc<VendorInstallOverride>>,
}

#[cfg(test)]
type VendorInstallOverride = dyn for<'a, 'b, 'c, 'd> Fn(
        &'a Path,
        &'b dyn ProcessRunner,
        &'c mut DeploymentReporter<'d>,
    ) -> Result<(), &'static str>
    + Send
    + Sync;

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
            #[cfg(test)]
            steam_install: None,
            #[cfg(test)]
            pico_install: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        roots: EnvironmentRoots,
        data_root: PathBuf,
        runner: Arc<dyn ProcessRunner>,
    ) -> Self {
        Self {
            engine: EnvironmentEngine::new(
                runner.clone(),
                Arc::new(SystemClock),
                roots,
                Arc::new(VccSettingsFileReader),
            ),
            install_probe: UnityInstallProbe {
                runner,
                cli_candidates: Vec::new(),
            },
            data_root,
            region: crate::unity_download_region::RegionProbe::default(),
            steam_install: None,
            pico_install: None,
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

    fn run_steam_install(&self, report: &mut DeploymentReporter<'_>) -> Result<(), &'static str> {
        let runner = self.install_probe.runner.as_ref();
        #[cfg(test)]
        if let Some(seam) = &self.steam_install {
            return seam(&self.data_root, runner, report);
        }
        crate::steam_install::install_steam(&self.data_root, runner, report)
    }

    fn run_pico_install(
        &self,
        region: PicoInstallRegion,
        report: &mut DeploymentReporter<'_>,
    ) -> Result<(), &'static str> {
        let runner = self.install_probe.runner.as_ref();
        #[cfg(test)]
        if let Some(seam) = &self.pico_install {
            return seam(&self.data_root, runner, report);
        }
        crate::pico_install::install_pico(&self.data_root, region, runner, report)
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
        confirmed: Option<&DeploymentInstaller>,
        report: &mut DeploymentReporter<'_>,
    ) -> Result<(), &'static str> {
        intent.validate()?;
        let _machine_lease = InstallLease::acquire()?;
        let component = match action {
            // Vendor-installer actions acquire and run the pinned official artifact; the
            // vendor chooses the destination, so the Unity installer identity and the
            // confirmed editor root do not bind them.
            DeploymentAction::InstallSteam => {
                self.run_steam_install(report)?;
                "steam"
            }
            DeploymentAction::InstallPicoRuntime => {
                self.run_pico_install(
                    intent.pico_region.ok_or("vua.deployment.invalid_intent")?,
                    report,
                )?;
                "pico_runtime"
            }
            DeploymentAction::InstallUnityCli => {
                let confirmed = confirmed.ok_or("vua.deployment.installer_unavailable")?;
                if !crate::unity_install::same_windows_path(
                    &intent.editor_root,
                    &confirmed.editor_root,
                ) {
                    return Err("vua.deployment.plan_changed");
                }
                crate::unity_cli_bootstrap::acquire_cli(&self.data_root, confirmed)?;
                "unity_cli"
            }
            DeploymentAction::InstallEditor | DeploymentAction::AddAndroidModules => {
                let confirmed = confirmed.ok_or("vua.deployment.installer_unavailable")?;
                if !crate::unity_install::same_windows_path(
                    &intent.editor_root,
                    &confirmed.editor_root,
                ) {
                    return Err("vua.deployment.plan_changed");
                }
                // Installer identity is rechecked while the machine installation lease is held.
                self.install_probe.install(
                    action,
                    confirmed,
                    &self.data_root,
                    &EditorDownloadPolicy::new(self.region.detect(), intent.use_mirrors),
                    report,
                )?;
                if action == DeploymentAction::InstallEditor {
                    "unity_editor"
                } else {
                    "android_modules"
                }
            }
            _ => return Err("vua.deployment.action_refused"),
        };
        if matches!(
            action,
            DeploymentAction::InstallSteam | DeploymentAction::InstallPicoRuntime
        ) {
            return wait_for_vendor_files(
                component,
                report,
                || self.observe(intent),
                || {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                },
            );
        }
        let after = self.observe(intent);
        if !after
            .iter()
            .any(|f| f.component == component && f.presence == DeploymentPresence::Verified)
        {
            return Err("vua.deployment.verification_failed");
        }
        Ok(())
    }
}

/// A bootstrapper may leave its payload finishing after its direct process exits. Keep
/// the installation lease while re-inspecting for at most 15 seconds. Only observed
/// entry files satisfy this prerequisite; elapsed time and exit code never do.
fn wait_for_vendor_files(
    component: &str,
    report: &mut DeploymentReporter<'_>,
    mut observe: impl FnMut() -> Vec<DeploymentObservation>,
    mut pause: impl FnMut(),
) -> Result<(), &'static str> {
    for attempt in 0..16 {
        report(DeploymentActivity::from_source(
            DeploymentPhase::Inspecting,
            EditorDownloadSource::Official,
        ))?;
        if observe()
            .iter()
            .any(|f| f.component == component && f.presence == DeploymentPresence::Verified)
        {
            return Ok(());
        }
        if attempt < 15 {
            pause();
        }
    }
    Err("vua.deployment.verification_failed")
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
    #[cfg(windows)]
    use vua_orchestrator::{
        outcome_with_exit, FakeProcessRunner, FakeRegistrySource, RegistryHive,
    };
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
    fn vendor_reinspection_waits_for_its_own_files_and_remains_cancellable() {
        let mut pauses = 0;
        let mut probes = 0;
        wait_for_vendor_files(
            "steam",
            &mut |_| Ok(()),
            || {
                probes += 1;
                vec![DeploymentObservation {
                    component: "steam".into(),
                    presence: if probes == 3 {
                        DeploymentPresence::Verified
                    } else {
                        DeploymentPresence::Missing
                    },
                    location: None,
                    version: None,
                }]
            },
            || pauses += 1,
        )
        .unwrap();
        assert_eq!((probes, pauses), (3, 2));

        let mut probes = 0;
        assert_eq!(
            wait_for_vendor_files(
                "pico_runtime",
                &mut |_| Ok(()),
                || {
                    probes += 1;
                    vec![DeploymentObservation {
                        component: "steam".into(),
                        presence: DeploymentPresence::Verified,
                        location: None,
                        version: None,
                    }]
                },
                || {}
            ),
            Err("vua.deployment.verification_failed")
        );
        assert_eq!(probes, 16);

        let mut reports = 0;
        assert_eq!(
            wait_for_vendor_files(
                "steam",
                &mut |_| {
                    reports += 1;
                    if reports == 2 {
                        Err("vua.deployment.cancelled")
                    } else {
                        Ok(())
                    }
                },
                Vec::new,
                || {}
            ),
            Err("vua.deployment.cancelled")
        );
        assert_eq!(reports, 2);
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

    /// Synthetic roots for the vendor-install arms: the registry answer and runtime
    /// candidates point into one temporary tree; every other probe input is empty so
    /// no real machine state participates.
    #[cfg(windows)]
    fn vendor_test_roots(base: &Path, steam_dir: &Path, pico_dir: &Path) -> EnvironmentRoots {
        EnvironmentRoots {
            steam_common: Vec::new(),
            local_low: base.join("LocalLow"),
            unity_hub_exe_candidates: Vec::new(),
            unity_hub_registry_display_icon_keys: Vec::new(),
            unity_editors_root: base.join("editors"),
            vrc_get_executable: "vrc-get".into(),
            disk_target: base.to_path_buf(),
            network_probes: Vec::new(),
            registry: Arc::new(FakeRegistrySource::new().with(
                RegistryHive::LocalMachine,
                "SOFTWARE\\WOW6432Node\\Valve\\Steam",
                "InstallPath",
                &steam_dir.to_string_lossy(),
            )),
            steam_install_candidates: vec![base.join("steam-default")],
            vr_runtime_roots: vua_orchestrator::VrRuntimeRoots {
                oculus: Vec::new(),
                pico: vec![pico_dir.to_path_buf()],
                vive: Vec::new(),
                virtual_desktop: Vec::new(),
                alvr: Vec::new(),
                pimax: Vec::new(),
                varjo: Vec::new(),
                hp_omnicept: Vec::new(),
            },
            openvrpaths: Vec::new(),
            vcc_settings_candidates: Vec::new(),
        }
    }

    /// One test owns the machine-wide install lease: the scenarios below run
    /// sequentially. The acquisition half is seamed (no synthetic bytes can pass
    /// WinVerifyTrust); the runner-facing half and re-observation are the real code.
    #[cfg(windows)]
    #[test]
    fn vendor_install_arms_run_the_verified_installer_and_require_reobserved_readiness() {
        let base = std::env::temp_dir().join(format!("vua-vendor-arms-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let steam_dir = base.join("steam-install");
        let pico_dir = base.join("vr").join("PICO Connect");
        let intent = DeploymentIntent {
            purposes: vec![DeploymentPurpose::PicoPcvr],
            editor_root: r"C:\VUA Test\Editors".into(),
            use_mirrors: true,
            pico_region: Some(PicoInstallRegion::ChinaMainland),
        };
        let runner = Arc::new(FakeProcessRunner::new());
        let mut adapter = WindowsDeploymentAdapter::for_test(
            vendor_test_roots(&base, &steam_dir, &pico_dir),
            base.join("data"),
            runner.clone(),
        );
        adapter.steam_install = Some(Arc::new(
            |_data_root: &Path, runner: &dyn ProcessRunner, report: &mut DeploymentReporter<'_>| {
                crate::steam_install::install_verified(
                    runner,
                    Path::new(r"C:\VUA\cache\SteamSetup.exe"),
                    report,
                )
            },
        ));
        adapter.pico_install = Some(Arc::new(
            |_data_root: &Path, runner: &dyn ProcessRunner, report: &mut DeploymentReporter<'_>| {
                crate::pico_install::install_verified(
                    runner,
                    Path::new(r"C:\VUA\cache\PICOConnect.exe"),
                    report,
                )
            },
        ));

        // Cancellation at reinspection stops a successful installer without waiting
        // for nonexistent synthetic payload files (the bounded wait is tested below).
        assert_eq!(
            adapter.install(&intent, DeploymentAction::InstallSteam, None, &mut |a| {
                if matches!(a.phase, DeploymentPhase::Inspecting) {
                    return Err("vua.deployment.cancelled");
                }
                Ok(())
            }),
            Err("vua.deployment.cancelled")
        );
        let steam_spec = runner.calls()[0].clone();
        assert_eq!(steam_spec.args, ["/S"]);
        assert_eq!(steam_spec.timeout, std::time::Duration::from_secs(1800));
        assert!(steam_spec.windows_elevated_nsis);

        // Vendor exit codes and the elevation boundary map to the closed taxonomy.
        runner.push(Ok(outcome_with_exit(5, "vendor failed")));
        assert_eq!(
            adapter.install(&intent, DeploymentAction::InstallSteam, None, &mut |a| {
                let _ = a;
                Ok(())
            }),
            Err("vua.deployment.install_failed")
        );
        runner.push_raw_os_error(740);
        assert_eq!(
            adapter.install(&intent, DeploymentAction::InstallSteam, None, &mut |a| {
                let _ = a;
                Ok(())
            }),
            Err("vua.deployment.elevation_required")
        );
        runner.push_raw_os_error(1223);
        assert_eq!(
            adapter.install(&intent, DeploymentAction::InstallSteam, None, &mut |a| {
                let _ = a;
                Ok(())
            }),
            Err("vua.deployment.elevation_declined")
        );

        // Once the vendor installer actually lands its payload, re-observation verifies.
        let created = steam_dir.clone();
        runner.on_run(move |_spec| {
            std::fs::create_dir_all(&created).unwrap();
            std::fs::write(created.join("steam.exe"), b"synthetic steam").unwrap();
        });
        adapter
            .install(&intent, DeploymentAction::InstallSteam, None, &mut |a| {
                let _ = a;
                Ok(())
            })
            .unwrap();

        // PICO Connect: same arm shape against its own candidate root.
        let created = pico_dir.clone();
        runner.on_run(move |_spec| {
            std::fs::create_dir_all(&created).unwrap();
            std::fs::write(created.join("PICO Connect.exe"), b"synthetic pico").unwrap();
        });
        adapter
            .install(
                &intent,
                DeploymentAction::InstallPicoRuntime,
                None,
                &mut |a| {
                    let _ = a;
                    Ok(())
                },
            )
            .unwrap();
        runner.push(Ok(outcome_with_exit(1, "vendor failed")));
        assert_eq!(
            adapter.install(
                &intent,
                DeploymentAction::InstallPicoRuntime,
                None,
                &mut |a| {
                    let _ = a;
                    Ok(())
                },
            ),
            Err("vua.deployment.install_failed")
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}

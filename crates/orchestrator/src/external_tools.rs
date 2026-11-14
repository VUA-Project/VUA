//! First N2 connection: source facts and explicit upstream handoffs, independent of AMF.
use crate::Clock;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolProcess {
    pub pid: u32,
    pub created: u64,
    pub path: PathBuf,
}
#[derive(Clone, Debug)]
pub struct ToolInstallation {
    pub presence: &'static str,
    pub steam_ready: bool,
    pub executable: Option<PathBuf>,
    pub build_id: Option<String>,
}
/// One fixed Steam connection: contract identity plus the Steam/on-disk facts
/// the platform adapter checks. `exe_name` is relative to the installdir and
/// may carry a fixed subdirectory. `process_name` is lowercase because the OS
/// process matcher lowercases image names before comparing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteamToolSpec {
    pub tool_id: &'static str,
    pub app_id: &'static str,
    pub install_dir: &'static str,
    pub exe_name: &'static str,
    pub process_name: &'static str,
}
pub const STEAM_TOOLS: &[SteamToolSpec] = &[
    SteamToolSpec {
        tool_id: "vrcft",
        app_id: "3329480",
        install_dir: "VRCFaceTracking",
        exe_name: "VRCFaceTracking.exe",
        process_name: "vrcfacetracking.exe",
    },
    SteamToolSpec {
        tool_id: "space",
        app_id: "3368750",
        install_dir: "01spacecalibrator",
        exe_name: "SpaceCalibrator.exe",
        process_name: "spacecalibrator.exe",
    },
    SteamToolSpec {
        tool_id: "advanced",
        app_id: "1009850",
        install_dir: "OVR_AdvancedSettings",
        exe_name: "AdvancedSettings.exe",
        process_name: "advancedsettings.exe",
    },
    SteamToolSpec {
        tool_id: "toolkit",
        app_id: "1068820",
        install_dir: "OVR Toolkit",
        exe_name: "Launcher/OVR Toolkit Launcher.exe",
        process_name: "ovr toolkit launcher.exe",
    },
    SteamToolSpec {
        tool_id: "oyasumi",
        app_id: "2538150",
        install_dir: "OyasumiVR",
        exe_name: "OyasumiVR.exe",
        process_name: "oyasumivr.exe",
    },
    SteamToolSpec {
        tool_id: "translator",
        app_id: "4304620",
        install_dir: "OVR Overlay Translator",
        exe_name: "OVR-Overlay-Translator.exe",
        process_name: "ovr-overlay-translator.exe",
    },
    SteamToolSpec {
        tool_id: "chilloutvr",
        app_id: "661130",
        install_dir: "ChilloutVR",
        exe_name: "ChilloutVR.exe",
        process_name: "chilloutvr.exe",
    },
    SteamToolSpec {
        tool_id: "reborn",
        app_id: "2089520",
        install_dir: "Reborn",
        exe_name: "Reborn.exe",
        process_name: "reborn.exe",
    },
    SteamToolSpec {
        tool_id: "vrchat",
        app_id: "438100",
        install_dir: "VRChat",
        exe_name: "VRChat.exe",
        process_name: "vrchat.exe",
    },
    SteamToolSpec {
        tool_id: "steamvr",
        app_id: "250820",
        install_dir: "SteamVR",
        exe_name: "bin/win64/vrstartup.exe",
        process_name: "vrstartup.exe",
    },
    SteamToolSpec {
        tool_id: "desktopplus",
        app_id: "1494460",
        install_dir: "DesktopPlus",
        exe_name: "DesktopPlus.exe",
        process_name: "desktopplus.exe",
    },
    SteamToolSpec {
        tool_id: "fpsvr",
        app_id: "908520",
        install_dir: "fpsVR",
        exe_name: "fpsVR.exe",
        process_name: "fpsvr.exe",
    },
];
pub fn steam_tool_spec(tool_id: &str) -> Option<&'static SteamToolSpec> {
    STEAM_TOOLS.iter().find(|spec| spec.tool_id == tool_id)
}

/// Pinned official-installer release metadata shared by deployment planning,
/// installer acquisition and direct breakaway launch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InstallerToolSpec {
    pub tool_id: &'static str,
    pub official_url: &'static str,
    pub download_url: &'static str,
    pub file_name: &'static str,
    pub version: &'static str,
    pub size: u64,
    pub sha256: &'static str,
    pub exe_name: &'static str,
    pub process_name: &'static str,
    pub elevated_nsis: bool,
    pub mirror_eligible: bool,
}

pub const INSTALLER_TOOLS: &[InstallerToolSpec] = &[
    InstallerToolSpec {
        tool_id: "slimevr",
        official_url: "https://github.com/SlimeVR/SlimeVR-Installer",
        download_url: "https://github.com/SlimeVR/SlimeVR-Installer/releases/download/v5.0.0/slimevr_web_installer.exe",
        file_name: "slimevr_web_installer.exe",
        version: "5.0.0",
        size: 1_933_736,
        sha256: "58dc7f50638f96922bf312baf7e0ba326ced88ba64647163e2cf1cf5bcf614ef",
        exe_name: "SlimeVR.exe",
        process_name: "slimevr.exe",
        elevated_nsis: true,
        mirror_eligible: true,
    },
    InstallerToolSpec {
        tool_id: "vrct",
        official_url: "https://github.com/misyaguziya/VRCT",
        download_url: "https://github.com/misyaguziya/VRCT/releases/download/v3.6.1/VRCT_3.6.1_x64-setup.exe",
        file_name: "VRCT_3.6.1_x64-setup.exe",
        version: "3.6.1",
        size: 3_108_231,
        sha256: "1ca0dd0931896fff9058096335cf2630e53e1af75ebe8f1aa774cbdc7e96c1bd",
        exe_name: "VRCT.exe",
        process_name: "vrct.exe",
        elevated_nsis: false,
        // Bundled chat-bubble model is exclusive to VRCT; official GitHub release only.
        mirror_eligible: false,
    },
    InstallerToolSpec {
        tool_id: "vrcx",
        official_url: "https://github.com/vrcx-team/VRCX",
        download_url: "https://github.com/vrcx-team/VRCX/releases/download/v2026.09.16/VRCX_2026.09.16_Setup.exe",
        file_name: "VRCX_2026.09.16_Setup.exe",
        version: "2026.09.16",
        size: 205_989_312,
        sha256: "f0c23d6d115eb748c6a870ce8cca6db4d7b1a1879e008ed991eb75b43b607ca3",
        exe_name: "VRCX.exe",
        process_name: "vrcx.exe",
        elevated_nsis: false,
        mirror_eligible: true,
    },
    InstallerToolSpec {
        tool_id: "vrcs",
        official_url: "https://github.com/Dreaminko/VRCS",
        download_url: "https://github.com/Dreaminko/VRCS/releases/download/0.3.7/VRCS-0.3.7-windows-x64.exe",
        file_name: "VRCS-0.3.7-windows-x64.exe",
        version: "0.3.7",
        size: 17_383_034,
        sha256: "03c8959bc3e94936502d746b16ee59acaacc855b809166fe965cc6950d372808",
        exe_name: "VRCS.exe",
        process_name: "vrcs.exe",
        elevated_nsis: false,
        // AGPL-3.0 requires corresponding source distribution alongside any mirror.
        mirror_eligible: false,
    },
];

pub fn installer_tool_spec(tool_id: &str) -> Option<&'static InstallerToolSpec> {
    INSTALLER_TOOLS.iter().find(|spec| spec.tool_id == tool_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct FakeState {
        missing: bool,
        steam_missing: bool,
        unreadable: bool,
        fail_handoff: bool,
        fail_close: bool,
        processes: Vec<ToolProcess>,
        handoffs: Vec<ToolAction>,
        closes: Vec<ToolProcess>,
    }
    #[derive(Default)]
    struct Fake(Mutex<FakeState>);
    fn process(created: u64) -> ToolProcess {
        ToolProcess {
            pid: 42,
            created,
            path: "C:/fixture/VRCFaceTracking.exe".into(),
        }
    }
    impl ToolPlatform for Fake {
        fn inspect(&self) -> Result<ToolInstallation, &'static str> {
            let s = self.0.lock().unwrap();
            if s.unreadable {
                return Err("unavailable");
            }
            Ok(ToolInstallation {
                presence: if s.missing { "missing" } else { "installed" },
                steam_ready: !s.steam_missing,
                executable: (!s.missing).then(|| process(1).path),
                build_id: (!s.missing).then(|| "123".into()),
            })
        }
        fn processes(&self) -> Result<Vec<ToolProcess>, &'static str> {
            Ok(self.0.lock().unwrap().processes.clone())
        }
        fn handoff(&self, action: ToolAction) -> Result<(), &'static str> {
            let mut s = self.0.lock().unwrap();
            s.handoffs.push(action);
            if s.fail_handoff {
                Err("failure")
            } else {
                Ok(())
            }
        }
        fn close(&self, p: &ToolProcess) -> Result<(), &'static str> {
            let mut s = self.0.lock().unwrap();
            s.closes.push(p.clone());
            if s.fail_close {
                Err("failure")
            } else {
                Ok(())
            }
        }
    }
    fn fixture() -> (Arc<Fake>, ToolService) {
        let fake = Arc::new(Fake::default());
        let service = ToolService::new(
            fake.clone(),
            Arc::new(crate::FixedClock::new(&["2026-10-10T00:00:00Z"])),
            "vrcft",
        );
        (fake, service)
    }
    fn expire(service: &ToolService) {
        service
            .state
            .lock()
            .unwrap()
            .pending
            .as_mut()
            .unwrap()
            .since = Instant::now() - Duration::from_secs(61);
    }
    #[test]
    fn installation_handoff_is_not_installation_success_and_can_be_cancelled() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().missing = true;
        let started = service.act(ToolAction::Install, "install-1").unwrap();
        assert_eq!(
            (started.presence, started.activity),
            ("missing", "install_requested")
        );
        service.act(ToolAction::Install, "install-1").unwrap();
        service.act(ToolAction::Install, "install-2").unwrap();
        assert_eq!(fake.0.lock().unwrap().handoffs.len(), 1);
        assert!(service.act(ToolAction::Start, "install-1").is_err());
        assert_eq!(
            service.act(ToolAction::Cancel, "cancel").unwrap().activity,
            "idle"
        );
        assert_eq!(service.observe().unwrap().presence, "missing");
        service.act(ToolAction::Install, "retry").unwrap();
        fake.0.lock().unwrap().missing = false;
        assert_eq!(service.observe().unwrap().activity, "idle");
    }
    #[test]
    fn reinstall_uninstalls_through_steam_and_then_installs() {
        let (fake, service) = fixture();
        let waiting = service.act(ToolAction::Reinstall, "again").unwrap();
        assert_eq!(waiting.activity, "reinstall_requested");
        assert_eq!(fake.0.lock().unwrap().handoffs, vec![ToolAction::Reinstall]);
        // Steam still has it: the player has not confirmed yet.
        assert_eq!(service.observe().unwrap().activity, "reinstall_requested");
        fake.0.lock().unwrap().missing = true;
        assert_eq!(service.observe().unwrap().activity, "install_requested");
        assert_eq!(
            fake.0.lock().unwrap().handoffs,
            vec![ToolAction::Reinstall, ToolAction::Install]
        );
        fake.0.lock().unwrap().missing = false;
        assert_eq!(service.observe().unwrap().activity, "idle");
    }
    #[test]
    fn reinstall_asks_to_close_a_running_tool_and_can_be_cancelled() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().processes = vec![process(9)];
        let refused = service.act(ToolAction::Reinstall, "running").unwrap();
        assert_eq!(refused.issue, Some("close_first"));
        assert!(fake.0.lock().unwrap().handoffs.is_empty());
        fake.0.lock().unwrap().processes.clear();
        service.act(ToolAction::Reinstall, "again").unwrap();
        assert_eq!(
            service.act(ToolAction::Cancel, "cancel").unwrap().activity,
            "idle"
        );
    }
    #[test]
    fn reinstall_of_a_missing_tool_is_an_install_and_gives_up_waiting_for_steam() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().missing = true;
        assert_eq!(
            service.act(ToolAction::Reinstall, "1").unwrap().activity,
            "install_requested"
        );
        assert_eq!(fake.0.lock().unwrap().handoffs, vec![ToolAction::Install]);
        service.act(ToolAction::Cancel, "2").unwrap();
        fake.0.lock().unwrap().missing = false;
        service.act(ToolAction::Reinstall, "3").unwrap();
        service
            .state
            .lock()
            .unwrap()
            .pending
            .as_mut()
            .unwrap()
            .since = Instant::now() - Duration::from_secs(301);
        let timed_out = service.observe().unwrap();
        assert_eq!(
            (timed_out.activity, timed_out.issue),
            ("idle", Some("reinstall_timeout"))
        );
    }
    #[test]
    fn prerequisites_and_failed_handoffs_do_not_fake_a_running_tool() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().steam_missing = true;
        assert_eq!(
            service.act(ToolAction::Install, "1").unwrap().issue,
            Some("steam_missing")
        );
        assert!(fake.0.lock().unwrap().handoffs.is_empty());
        {
            let mut s = fake.0.lock().unwrap();
            s.steam_missing = false;
            s.missing = true;
        }
        assert_eq!(
            service.act(ToolAction::Start, "2").unwrap().issue,
            Some("not_installed")
        );
        {
            let mut s = fake.0.lock().unwrap();
            s.missing = false;
            s.fail_handoff = true;
        }
        let failed = service.act(ToolAction::Start, "3").unwrap();
        assert_eq!(failed.issue, Some("handoff_failed"));
        assert!(!failed.running);
        assert!(!failed.can_stop);
        fake.0.lock().unwrap().unreadable = true;
        assert!(service.observe().is_err());
    }
    #[test]
    fn only_a_new_matching_instance_is_owned_and_manual_exit_resets_close() {
        let (fake, service) = fixture();
        assert_eq!(
            service.act(ToolAction::Start, "1").unwrap().activity,
            "starting"
        );
        fake.0.lock().unwrap().processes.push(ToolProcess {
            path: "C:/other/VRCFaceTracking.exe".into(),
            ..process(1)
        });
        assert!(!service.observe().unwrap().can_stop);
        fake.0.lock().unwrap().processes.push(process(2));
        let running = service.observe().unwrap();
        assert!(running.running && running.can_stop);
        assert_eq!(running.activity, "idle");
        fake.0.lock().unwrap().processes.retain(|p| p.created != 2);
        let exited = service.observe().unwrap();
        assert!(!exited.running && !exited.can_stop);
        assert_eq!(exited.issue, None);
        service.act(ToolAction::Stop, "2").unwrap();
        assert!(fake.0.lock().unwrap().closes.is_empty());
    }
    #[test]
    fn preexisting_instance_and_restarted_host_never_gain_close_authority() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().processes.push(process(1));
        let existing = service.act(ToolAction::Start, "start").unwrap();
        assert!(existing.running);
        assert!(!existing.can_stop);
        service.act(ToolAction::Stop, "close").unwrap();
        assert!(fake.0.lock().unwrap().closes.is_empty());
        let restarted = ToolService::new(fake.clone(), Arc::new(crate::SystemClock), "vrcft");
        assert!(!restarted.observe().unwrap().can_stop);
    }
    #[test]
    fn cancellation_or_timeout_does_not_adopt_a_late_launch() {
        for cancel in [true, false] {
            let (fake, service) = fixture();
            service.act(ToolAction::Start, "1").unwrap();
            if cancel {
                assert_eq!(
                    service.act(ToolAction::Cancel, "2").unwrap().activity,
                    "idle"
                );
            } else {
                expire(&service);
                assert_eq!(service.observe().unwrap().issue, Some("start_timeout"));
            }
            fake.0.lock().unwrap().processes.push(process(3));
            let late = service.observe().unwrap();
            assert!(late.running && !late.can_stop);
            service.act(ToolAction::Stop, "3").unwrap();
            assert!(fake.0.lock().unwrap().closes.is_empty());
        }
    }
    #[test]
    fn close_is_bounded_and_pid_reuse_does_not_close_someone_elses_instance() {
        let (fake, service) = fixture();
        service.act(ToolAction::Start, "1").unwrap();
        fake.0.lock().unwrap().processes.push(process(1));
        service.observe().unwrap();
        service.act(ToolAction::Stop, "2").unwrap();
        service.act(ToolAction::Stop, "3").unwrap();
        assert_eq!(fake.0.lock().unwrap().closes.len(), 1);
        expire(&service);
        let refused = service.observe().unwrap();
        assert_eq!(refused.issue, Some("close_timeout"));
        assert!(refused.can_stop);
        fake.0.lock().unwrap().processes = vec![process(2)];
        let replacement = service.observe().unwrap();
        assert!(replacement.running && !replacement.can_stop);
        assert_eq!(replacement.issue, None);
        service.act(ToolAction::Stop, "4").unwrap();
        assert_eq!(fake.0.lock().unwrap().closes.len(), 1);
    }
    #[test]
    fn failed_normal_close_preserves_ownership_for_manual_exit_or_retry() {
        let (fake, service) = fixture();
        service.act(ToolAction::Start, "1").unwrap();
        {
            let mut s = fake.0.lock().unwrap();
            s.processes.push(process(1));
            s.fail_close = true;
        }
        service.observe().unwrap();
        let failed = service.act(ToolAction::Stop, "2").unwrap();
        assert_eq!(failed.issue, Some("close_failed"));
        assert!(failed.can_stop);
        fake.0.lock().unwrap().processes.clear();
        assert_eq!(service.observe().unwrap().issue, None);
    }
    #[test]
    fn steam_tool_specs_pin_the_fixed_connections() {
        let expected = [
            SteamToolSpec {
                tool_id: "vrcft",
                app_id: "3329480",
                install_dir: "VRCFaceTracking",
                exe_name: "VRCFaceTracking.exe",
                process_name: "vrcfacetracking.exe",
            },
            SteamToolSpec {
                tool_id: "space",
                app_id: "3368750",
                install_dir: "01spacecalibrator",
                exe_name: "SpaceCalibrator.exe",
                process_name: "spacecalibrator.exe",
            },
            SteamToolSpec {
                tool_id: "advanced",
                app_id: "1009850",
                install_dir: "OVR_AdvancedSettings",
                exe_name: "AdvancedSettings.exe",
                process_name: "advancedsettings.exe",
            },
            SteamToolSpec {
                tool_id: "toolkit",
                app_id: "1068820",
                install_dir: "OVR Toolkit",
                exe_name: "Launcher/OVR Toolkit Launcher.exe",
                process_name: "ovr toolkit launcher.exe",
            },
            SteamToolSpec {
                tool_id: "oyasumi",
                app_id: "2538150",
                install_dir: "OyasumiVR",
                exe_name: "OyasumiVR.exe",
                process_name: "oyasumivr.exe",
            },
            SteamToolSpec {
                tool_id: "translator",
                app_id: "4304620",
                install_dir: "OVR Overlay Translator",
                exe_name: "OVR-Overlay-Translator.exe",
                process_name: "ovr-overlay-translator.exe",
            },
            SteamToolSpec {
                tool_id: "chilloutvr",
                app_id: "661130",
                install_dir: "ChilloutVR",
                exe_name: "ChilloutVR.exe",
                process_name: "chilloutvr.exe",
            },
            SteamToolSpec {
                tool_id: "reborn",
                app_id: "2089520",
                install_dir: "Reborn",
                exe_name: "Reborn.exe",
                process_name: "reborn.exe",
            },
            SteamToolSpec {
                tool_id: "vrchat",
                app_id: "438100",
                install_dir: "VRChat",
                exe_name: "VRChat.exe",
                process_name: "vrchat.exe",
            },
            SteamToolSpec {
                tool_id: "steamvr",
                app_id: "250820",
                install_dir: "SteamVR",
                exe_name: "bin/win64/vrstartup.exe",
                process_name: "vrstartup.exe",
            },
            SteamToolSpec {
                tool_id: "desktopplus",
                app_id: "1494460",
                install_dir: "DesktopPlus",
                exe_name: "DesktopPlus.exe",
                process_name: "desktopplus.exe",
            },
            SteamToolSpec {
                tool_id: "fpsvr",
                app_id: "908520",
                install_dir: "fpsVR",
                exe_name: "fpsVR.exe",
                process_name: "fpsvr.exe",
            },
        ];
        assert_eq!(STEAM_TOOLS, expected.as_slice());
        for spec in expected {
            assert_eq!(steam_tool_spec(spec.tool_id), Some(&spec));
        }
        assert!(steam_tool_spec("custom").is_none());
        assert!(steam_tool_spec("liv").is_none());
        assert!(steam_tool_spec("xsoverlay").is_none());
    }
    #[test]
    fn snapshot_carries_v04_schema_version_and_the_service_tool_id() {
        let (fake, service) = fixture();
        let snapshot = service.observe().unwrap();
        assert_eq!(snapshot.schema_version, "vua.external-tool/v0.4");
        assert_eq!(snapshot.tool_id, "vrcft");
        let other = ToolService::new(fake, Arc::new(crate::SystemClock), "space");
        assert_eq!(other.observe().unwrap().tool_id, "space");
    }
    #[test]
    fn installer_tool_specs_pin_the_four_reviewed_releases_and_launch_lifecycle() {
        assert_eq!(INSTALLER_TOOLS.len(), 4);
        for spec in INSTALLER_TOOLS {
            assert_eq!(installer_tool_spec(spec.tool_id), Some(spec));
            assert_eq!(spec.sha256.len(), 64);
            assert!(spec.size > 0);
            assert!(spec.download_url.starts_with("https://github.com/"));
        }
        assert!(installer_tool_spec("vrcft").is_none());
        #[derive(Default)]
        struct FakeInstallerState {
            missing: bool,
            processes: Vec<ToolProcess>,
            launches: usize,
            closes: Vec<ToolProcess>,
        }
        #[derive(Default)]
        struct FakeInstaller(Mutex<FakeInstallerState>);
        impl InstallerToolPlatform for FakeInstaller {
            fn inspect(&self) -> Result<InstallerToolInstallation, &'static str> {
                let s = self.0.lock().unwrap();
                Ok(InstallerToolInstallation {
                    presence: if s.missing { "missing" } else { "installed" },
                    location: (!s.missing).then(|| "C:/fixture/VRCT.exe".into()),
                    executable: (!s.missing).then(|| PathBuf::from("C:/fixture/VRCT.exe")),
                    version: (!s.missing).then(|| "3.6.1".into()),
                })
            }
            fn processes(&self) -> Result<Vec<ToolProcess>, &'static str> {
                Ok(self.0.lock().unwrap().processes.clone())
            }
            fn launch(&self, _exe: &std::path::Path) -> Result<(), &'static str> {
                self.0.lock().unwrap().launches += 1;
                Ok(())
            }
            fn close(&self, p: &ToolProcess) -> Result<(), &'static str> {
                self.0.lock().unwrap().closes.push(p.clone());
                Ok(())
            }
        }
        let fake = Arc::new(FakeInstaller::default());
        let service = InstallerToolService::new(
            fake.clone(),
            Arc::new(crate::FixedClock::new(&["2026-11-11T00:00:00Z"])),
            "vrct",
        );
        fake.0.lock().unwrap().missing = true;
        assert_eq!(
            service.act(InstallerToolAction::Start, "c1").unwrap().issue,
            Some("not_installed")
        );
        fake.0.lock().unwrap().missing = false;
        assert_eq!(
            service
                .act(InstallerToolAction::Start, "c2")
                .unwrap()
                .activity,
            "starting"
        );
        fake.0.lock().unwrap().processes.push(ToolProcess {
            pid: 99,
            created: 10,
            path: PathBuf::from("C:/fixture/VRCT.exe"),
        });
        let running = service.observe().unwrap();
        assert_eq!(running.schema_version, "vua.installer-tool/v0.1");
        assert!(running.running && running.can_stop);
        assert_eq!(
            service
                .act(InstallerToolAction::Stop, "c3")
                .unwrap()
                .activity,
            "stopping"
        );
        assert_eq!(fake.0.lock().unwrap().closes.len(), 1);
    }
    #[test]
    fn services_for_different_tools_keep_independent_state() {
        let fake = Arc::new(Fake::default());
        let clock: Arc<dyn Clock> = Arc::new(crate::SystemClock);
        let first = ToolService::new(fake.clone(), clock.clone(), "vrcft");
        let second = ToolService::new(fake.clone(), clock, "space");
        first.act(ToolAction::Start, "1").unwrap();
        assert_eq!(first.observe().unwrap().activity, "starting");
        assert_eq!(second.observe().unwrap().activity, "idle");
        // The command ledger is per service: the same id is not a replay there.
        second.act(ToolAction::Start, "1").unwrap();
        assert_eq!(fake.0.lock().unwrap().handoffs.len(), 2);
        assert_eq!(second.observe().unwrap().activity, "starting");
        assert_eq!(second.observe().unwrap().tool_id, "space");
    }

    #[test]
    fn mixed_separator_windows_paths_match_nested_tool_executables() {
        assert!(super::same_path(
            std::path::Path::new(r"C:\Steam\steamapps\common\SteamVR/bin/win64/vrstartup.exe"),
            std::path::Path::new(r"C:\Steam\steamapps\common\SteamVR\bin\win64\vrstartup.exe"),
        ));
        assert!(super::same_path(
            std::path::Path::new(
                r"\\?\C:\Steam\steamapps\common\OVR Toolkit\Launcher/OVR Toolkit Launcher.exe"
            ),
            std::path::Path::new(
                r"c:\steam\steamapps\common\ovr toolkit\launcher\ovr toolkit launcher.exe"
            ),
        ));
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolAction {
    Install,
    Start,
    Stop,
    Cancel,
    /// Steam uninstalls after its own confirmation; the install follows once the app is gone.
    Reinstall,
}
impl ToolAction {
    pub fn parse(action: &str) -> Option<Self> {
        match action {
            "install" => Some(Self::Install),
            "start" => Some(Self::Start),
            "stop" => Some(Self::Stop),
            "cancel" => Some(Self::Cancel),
            "reinstall" => Some(Self::Reinstall),
            _ => None,
        }
    }
}
pub trait ToolPlatform: Send + Sync {
    fn inspect(&self) -> Result<ToolInstallation, &'static str>;
    fn processes(&self) -> Result<Vec<ToolProcess>, &'static str>;
    fn handoff(&self, action: ToolAction) -> Result<(), &'static str>;
    /// A normal close, only after rechecking PID, creation time and path.
    fn close(&self, process: &ToolProcess) -> Result<(), &'static str>;
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSnapshot {
    pub schema_version: &'static str,
    pub tool_id: &'static str,
    pub captured_at: String,
    pub presence: &'static str,
    pub steam_ready: bool,
    pub build_id: Option<String>,
    pub running: bool,
    pub can_stop: bool,
    pub activity: &'static str,
    pub issue: Option<&'static str>,
}
struct Pending {
    action: ToolAction,
    since: Instant,
    baseline: Vec<ToolProcess>,
    target: Option<PathBuf>,
}
#[derive(Default)]
struct State {
    pending: Option<Pending>,
    owned: Option<ToolProcess>,
    issue: Option<&'static str>,
    commands: HashMap<String, ToolAction>,
}
pub struct ToolService {
    platform: Arc<dyn ToolPlatform>,
    clock: Arc<dyn Clock>,
    tool_id: &'static str,
    state: Mutex<State>,
    start_wait: Duration,
    close_wait: Duration,
    reinstall_wait: Duration,
}
fn normalize_compare_path(path: &std::path::Path) -> String {
    let raw = path.to_string_lossy();
    let stripped = if let Some(unc) = raw
        .get(..8)
        .filter(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
        .and_then(|_| raw.get(8..))
    {
        std::borrow::Cow::Owned(format!(r"\\{unc}"))
    } else {
        std::borrow::Cow::Borrowed(raw.strip_prefix(r"\\?\").unwrap_or(&raw))
    };
    let mut normalized = stripped.replace('/', "\\");
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }
    normalized
}

fn same_path(a: &std::path::Path, b: &std::path::Path) -> bool {
    normalize_compare_path(a).eq_ignore_ascii_case(&normalize_compare_path(b))
}
impl ToolService {
    pub fn new(
        platform: Arc<dyn ToolPlatform>,
        clock: Arc<dyn Clock>,
        tool_id: &'static str,
    ) -> Self {
        Self {
            platform,
            clock,
            tool_id,
            state: Mutex::new(State::default()),
            start_wait: Duration::from_secs(60),
            close_wait: Duration::from_secs(8),
            reinstall_wait: Duration::from_secs(300),
        }
    }
    fn snapshot(
        &self,
        state: &mut State,
        install: ToolInstallation,
        processes: &[ToolProcess],
    ) -> ToolSnapshot {
        if state.owned.as_ref().is_some_and(|p| !processes.contains(p)) {
            state.owned = None;
            state.issue = None;
        }
        // The player confirms the uninstall in Steam; once the app is gone the install follows.
        if let Some(since) = state
            .pending
            .as_ref()
            .filter(|p| p.action == ToolAction::Reinstall)
            .map(|p| p.since)
        {
            if matches!(install.presence, "missing" | "incomplete") {
                match self.platform.handoff(ToolAction::Install) {
                    Ok(()) => {
                        state.pending = Some(Pending {
                            action: ToolAction::Install,
                            since: Instant::now(),
                            baseline: processes.to_vec(),
                            target: None,
                        })
                    }
                    Err(_) => {
                        state.pending = None;
                        state.issue = Some("handoff_failed");
                    }
                }
            } else if since.elapsed() >= self.reinstall_wait {
                state.pending = None;
                state.issue = Some("reinstall_timeout");
            }
        }
        if let Some(pending) = &state.pending {
            let running_target = processes.iter().find(|p| {
                pending
                    .target
                    .as_ref()
                    .is_some_and(|target| same_path(target, &p.path))
            });
            let completed = match pending.action {
                ToolAction::Install => install.presence == "installed",
                ToolAction::Start => running_target.is_some(),
                ToolAction::Stop => state.owned.is_none(),
                ToolAction::Cancel => true,
                ToolAction::Reinstall => false,
            };
            if completed {
                if pending.action == ToolAction::Start {
                    state.owned = running_target
                        .filter(|p| !pending.baseline.contains(p))
                        .cloned();
                }
                state.pending = None;
                state.issue = None;
            } else if pending.action == ToolAction::Start
                && pending.since.elapsed() >= self.start_wait
            {
                // A late launch is never adopted after the bounded observation window.
                state.pending = None;
                state.issue = Some("start_timeout");
            } else if pending.action == ToolAction::Stop
                && pending.since.elapsed() >= self.close_wait
            {
                state.pending = None;
                state.issue = Some("close_timeout");
            }
        }
        let running = processes.iter().any(|p| {
            install
                .executable
                .as_ref()
                .is_some_and(|exe| same_path(exe, &p.path))
        }) || state.owned.is_some();
        ToolSnapshot {
            schema_version: "vua.external-tool/v0.4",
            tool_id: self.tool_id,
            captured_at: self.clock.now_rfc3339(),
            presence: install.presence,
            steam_ready: install.steam_ready,
            build_id: install.build_id,
            running,
            can_stop: state.owned.is_some(),
            issue: state.issue,
            activity: state.pending.as_ref().map_or("idle", |p| match p.action {
                ToolAction::Install => "install_requested",
                ToolAction::Reinstall => "reinstall_requested",
                ToolAction::Start => "starting",
                ToolAction::Stop => "stopping",
                ToolAction::Cancel => "idle",
            }),
        }
    }
    pub fn observe(&self) -> Result<ToolSnapshot, &'static str> {
        let install = self.platform.inspect()?;
        let processes = self.platform.processes()?;
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        Ok(self.snapshot(&mut state, install, &processes))
    }
    pub fn act(&self, action: ToolAction, command: &str) -> Result<ToolSnapshot, &'static str> {
        let install = self.platform.inspect()?;
        let processes = self.platform.processes()?;
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        let snapshot = self.snapshot(&mut state, install.clone(), &processes);
        if let Some(previous) = state.commands.get(command) {
            return if *previous == action {
                Ok(snapshot)
            } else {
                Err("invalid_command")
            };
        }
        if state.commands.len() >= 256 {
            return Err("command_limit");
        }
        state.commands.insert(command.to_owned(), action);
        // A repeated click cannot dispatch while an upstream request is pending.
        if state.pending.is_some() && !matches!(action, ToolAction::Cancel | ToolAction::Stop) {
            return Ok(snapshot);
        }
        if action == ToolAction::Stop
            && state
                .pending
                .as_ref()
                .is_some_and(|p| p.action == ToolAction::Stop)
        {
            return Ok(snapshot);
        }
        state.issue = None;
        match action {
            ToolAction::Cancel => {
                if state.pending.as_ref().is_some_and(|p| {
                    matches!(
                        p.action,
                        ToolAction::Install | ToolAction::Reinstall | ToolAction::Start
                    )
                }) {
                    state.pending = None;
                }
                // Stop observing the handoff; Steam's download/launch continues. Never adopt a late process.
            }
            ToolAction::Reinstall => {
                if !install.steam_ready {
                    state.issue = Some("steam_missing");
                } else if snapshot.running {
                    state.issue = Some("close_first");
                } else {
                    // Without a complete installation there is nothing to remove first.
                    let first = if install.presence == "installed" {
                        ToolAction::Reinstall
                    } else {
                        ToolAction::Install
                    };
                    match self.platform.handoff(first) {
                        Err(_) => state.issue = Some("handoff_failed"),
                        Ok(()) => {
                            state.pending = Some(Pending {
                                action: first,
                                since: Instant::now(),
                                baseline: processes.clone(),
                                target: None,
                            })
                        }
                    }
                }
            }
            ToolAction::Install | ToolAction::Start => {
                if !install.steam_ready {
                    state.issue = Some("steam_missing");
                } else if action == ToolAction::Start && install.presence != "installed" {
                    state.issue = Some("not_installed");
                } else if action == ToolAction::Install && install.presence == "installed" { /* reuse */
                } else {
                    match self.platform.handoff(action) {
                        Err(_) => state.issue = Some("handoff_failed"),
                        Ok(()) if action == ToolAction::Start && snapshot.running => { /* hand off to Steam without claiming the existing instance */
                        }
                        Ok(()) => {
                            state.pending = Some(Pending {
                                action,
                                since: Instant::now(),
                                baseline: processes.clone(),
                                target: install.executable.clone(),
                            })
                        }
                    }
                }
            }
            ToolAction::Stop => {
                if let Some(owned) = state.owned.clone() {
                    match self.platform.close(&owned) {
                        Ok(()) => {
                            state.pending = Some(Pending {
                                action,
                                since: Instant::now(),
                                baseline: vec![],
                                target: None,
                            })
                        }
                        Err(_) => state.issue = Some("close_failed"),
                    }
                }
            }
        }
        Ok(self.snapshot(&mut state, install, &processes))
    }
}

#[derive(Clone, Debug)]
pub struct InstallerToolInstallation {
    pub presence: &'static str,
    pub location: Option<String>,
    pub executable: Option<PathBuf>,
    pub version: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallerToolAction {
    Start,
    Stop,
    Cancel,
}

impl InstallerToolAction {
    pub fn parse(action: &str) -> Option<Self> {
        match action {
            "start" => Some(Self::Start),
            "stop" => Some(Self::Stop),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
}

pub trait InstallerToolPlatform: Send + Sync {
    fn inspect(&self) -> Result<InstallerToolInstallation, &'static str>;
    fn processes(&self) -> Result<Vec<ToolProcess>, &'static str>;
    fn launch(&self, executable: &std::path::Path) -> Result<(), &'static str>;
    fn close(&self, process: &ToolProcess) -> Result<(), &'static str>;
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerToolSnapshot {
    pub schema_version: &'static str,
    pub tool_id: &'static str,
    pub captured_at: String,
    pub presence: &'static str,
    pub location: Option<String>,
    pub version: Option<String>,
    pub running: bool,
    pub can_stop: bool,
    pub activity: &'static str,
    pub issue: Option<&'static str>,
}

struct InstallerPending {
    action: InstallerToolAction,
    since: Instant,
    baseline: Vec<ToolProcess>,
    target: Option<PathBuf>,
}

#[derive(Default)]
struct InstallerState {
    pending: Option<InstallerPending>,
    owned: Option<ToolProcess>,
    issue: Option<&'static str>,
    commands: HashMap<String, InstallerToolAction>,
}

pub struct InstallerToolService {
    platform: Arc<dyn InstallerToolPlatform>,
    clock: Arc<dyn Clock>,
    tool_id: &'static str,
    state: Mutex<InstallerState>,
    start_wait: Duration,
    close_wait: Duration,
}

impl InstallerToolService {
    pub fn new(
        platform: Arc<dyn InstallerToolPlatform>,
        clock: Arc<dyn Clock>,
        tool_id: &'static str,
    ) -> Self {
        Self {
            platform,
            clock,
            tool_id,
            state: Mutex::new(InstallerState::default()),
            start_wait: Duration::from_secs(60),
            close_wait: Duration::from_secs(8),
        }
    }

    fn snapshot(
        &self,
        state: &mut InstallerState,
        install: InstallerToolInstallation,
        processes: &[ToolProcess],
    ) -> InstallerToolSnapshot {
        if state.owned.as_ref().is_some_and(|p| !processes.contains(p)) {
            state.owned = None;
            state.issue = None;
        }
        if let Some(pending) = &state.pending {
            let running_target = processes.iter().find(|p| {
                pending
                    .target
                    .as_ref()
                    .is_some_and(|target| same_path(target, &p.path))
            });
            let completed = match pending.action {
                InstallerToolAction::Start => running_target.is_some(),
                InstallerToolAction::Stop => state.owned.is_none(),
                InstallerToolAction::Cancel => true,
            };
            if completed {
                if pending.action == InstallerToolAction::Start {
                    state.owned = running_target
                        .filter(|p| !pending.baseline.contains(p))
                        .cloned();
                }
                state.pending = None;
                state.issue = None;
            } else if pending.action == InstallerToolAction::Start
                && pending.since.elapsed() >= self.start_wait
            {
                state.pending = None;
                state.issue = Some("start_timeout");
            } else if pending.action == InstallerToolAction::Stop
                && pending.since.elapsed() >= self.close_wait
            {
                state.pending = None;
                state.issue = Some("close_timeout");
            }
        }
        let running = processes.iter().any(|p| {
            install
                .executable
                .as_ref()
                .is_some_and(|exe| same_path(exe, &p.path))
        }) || state.owned.is_some();
        InstallerToolSnapshot {
            schema_version: "vua.installer-tool/v0.1",
            tool_id: self.tool_id,
            captured_at: self.clock.now_rfc3339(),
            presence: install.presence,
            location: install.location,
            version: install.version,
            running,
            can_stop: state.owned.is_some(),
            issue: state.issue,
            activity: state.pending.as_ref().map_or("idle", |p| match p.action {
                InstallerToolAction::Start => "starting",
                InstallerToolAction::Stop => "stopping",
                InstallerToolAction::Cancel => "idle",
            }),
        }
    }

    pub fn observe(&self) -> Result<InstallerToolSnapshot, &'static str> {
        let install = self.platform.inspect()?;
        let processes = self.platform.processes()?;
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        Ok(self.snapshot(&mut state, install, &processes))
    }

    pub fn act(
        &self,
        action: InstallerToolAction,
        command: &str,
    ) -> Result<InstallerToolSnapshot, &'static str> {
        let install = self.platform.inspect()?;
        let processes = self.platform.processes()?;
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        let snapshot = self.snapshot(&mut state, install.clone(), &processes);
        if let Some(previous) = state.commands.get(command) {
            return if *previous == action {
                Ok(snapshot)
            } else {
                Err("invalid_command")
            };
        }
        if state.commands.len() >= 256 {
            return Err("command_limit");
        }
        state.commands.insert(command.to_owned(), action);
        if state.pending.is_some()
            && !matches!(
                action,
                InstallerToolAction::Cancel | InstallerToolAction::Stop
            )
        {
            return Ok(snapshot);
        }
        if action == InstallerToolAction::Stop
            && state
                .pending
                .as_ref()
                .is_some_and(|p| p.action == InstallerToolAction::Stop)
        {
            return Ok(snapshot);
        }
        state.issue = None;
        match action {
            InstallerToolAction::Cancel => {
                if state
                    .pending
                    .as_ref()
                    .is_some_and(|p| p.action == InstallerToolAction::Start)
                {
                    state.pending = None;
                }
            }
            InstallerToolAction::Start => {
                let Some(exe) = install
                    .executable
                    .as_ref()
                    .filter(|_| install.presence == "installed")
                else {
                    state.issue = Some("not_installed");
                    return Ok(self.snapshot(&mut state, install, &processes));
                };
                match self.platform.launch(exe) {
                    Err(_) => state.issue = Some("handoff_failed"),
                    Ok(()) if snapshot.running => {}
                    Ok(()) => {
                        state.pending = Some(InstallerPending {
                            action,
                            since: Instant::now(),
                            baseline: processes.clone(),
                            target: Some(exe.clone()),
                        })
                    }
                }
            }
            InstallerToolAction::Stop => {
                if let Some(owned) = state.owned.clone() {
                    match self.platform.close(&owned) {
                        Ok(()) => {
                            state.pending = Some(InstallerPending {
                                action,
                                since: Instant::now(),
                                baseline: vec![],
                                target: None,
                            })
                        }
                        Err(_) => state.issue = Some("close_failed"),
                    }
                }
            }
        }
        Ok(self.snapshot(&mut state, install, &processes))
    }
}

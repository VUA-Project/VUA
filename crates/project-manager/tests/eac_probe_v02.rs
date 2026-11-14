//! Synthetic and ignored real-machine tests for `eac-probe v0.2` (`probe_eac_v02`).
//!
//! CI runs strictly on synthetic injected sources (006 R8 — zero real EAC interaction).

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use vua_orchestrator::{EnvironmentRoots, FixedClock};
use vua_project_manager::eac_allowlist::{
    AllowlistEntryV01, AllowlistV01, EAC_ALLOWLIST_SCHEMA_VERSION,
};
use vua_project_manager::eac_install::{
    EacBinaryState, EacFolderState, EacInstallObservation, EacInstallStateV02, InstallSource,
};
use vua_project_manager::eac_logs::{EacLogFinding, LogFindingCode, LogSource};
use vua_project_manager::eac_probe::v02::{
    probe_eac_v02, CandidateSignatureVerifier, EacProbeService, EacSources, ProcessEntryV02,
    ProcessSnapshotSourceV02, ServiceObservationTracker, SteamRunningSource,
    WindowVisibilitySource,
};
use vua_project_manager::eac_recovery::{EacConclusionV02, EacRecoveryStepId};
use vua_project_manager::eac_service::{
    EacServiceName, EacServiceState, RawServiceObservation, ServiceStatusSource,
};

struct FakeProcesses(Result<Vec<ProcessEntryV02>, String>);
impl ProcessSnapshotSourceV02 for FakeProcesses {
    fn snapshot_v02(&self) -> Result<Vec<ProcessEntryV02>, String> {
        self.0.clone()
    }
}

struct FakeWindows(Result<HashSet<u32>, String>);
impl WindowVisibilitySource for FakeWindows {
    fn visible_window_pids(&self) -> Result<HashSet<u32>, String> {
        self.0.clone()
    }
}

struct FakeServices(Result<[RawServiceObservation; 2], String>);
impl ServiceStatusSource for FakeServices {
    fn query_services(&self) -> Result<[RawServiceObservation; 2], String> {
        self.0.clone()
    }
}

struct FakeSteam(Result<Option<u8>, String>);
impl SteamRunningSource for FakeSteam {
    fn running_flag(&self) -> Result<Option<u8>, String> {
        self.0.clone()
    }
}

struct FakeInstall(Result<EacInstallObservation, String>);
impl InstallSource for FakeInstall {
    fn inspect_install(
        &self,
        _eos_service_present: bool,
        _eos_service_binary: Option<&Path>,
    ) -> Result<EacInstallObservation, String> {
        self.0.clone()
    }
}

struct FakeLogs(Result<Vec<EacLogFinding>, String>);
impl LogSource for FakeLogs {
    fn read_recent_findings(&self) -> Result<Vec<EacLogFinding>, String> {
        self.0.clone()
    }
}

struct FakeVerifier(bool);
impl CandidateSignatureVerifier for FakeVerifier {
    fn is_trusted_eac_binary(&self, _path: &Path) -> bool {
        self.0
    }
}

fn clean_services() -> [RawServiceObservation; 2] {
    [
        RawServiceObservation {
            name: EacServiceName::EasyAntiCheatEos,
            present: true,
            state: EacServiceState::Stopped,
            binary_path: Some(PathBuf::from(
                r"C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe",
            )),
        },
        RawServiceObservation {
            name: EacServiceName::EasyAntiCheatEosSys,
            present: false,
            state: EacServiceState::Stopped,
            binary_path: None,
        },
    ]
}

fn clean_install() -> EacInstallObservation {
    EacInstallObservation {
        vrchat_dir: Some(PathBuf::from(r"D:\SteamLibrary\steamapps\common\VRChat")),
        install: EacInstallStateV02 {
            eac_folder: EacFolderState::Present,
            setup_signature: EacBinaryState::Verified,
            service_binary: EacBinaryState::Verified,
        },
    }
}

fn empty_allowlist() -> AllowlistV01 {
    AllowlistV01 {
        schema_version: EAC_ALLOWLIST_SCHEMA_VERSION.to_owned(),
        entries: Vec::new(),
    }
}

fn probe_v02_validator() -> jsonschema::Validator {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = Path::new(manifest_dir).join("../../schemas/eac-probe/v0.2/probe.schema.json");
    let schema: Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

fn assert_schema_valid(snapshot: &impl serde::Serialize) {
    let validator = probe_v02_validator();
    let value = serde_json::to_value(snapshot).unwrap();
    let errors: Vec<String> = validator
        .iter_errors(&value)
        .map(|err| format!("{}: {err}", err.instance_path()))
        .collect();
    assert!(errors.is_empty(), "schema violations: {errors:#?}");
}

#[test]
fn covers_all_eight_conclusions_and_validates_against_v02_schema() {
    let clock = FixedClock::new(&["2026-11-14T08:00:00Z"]);
    let allowlist = empty_allowlist();
    let verifier = FakeVerifier(true);

    // 1. ready (note: EasyAntiCheat_EOSSys absent while EasyAntiCheat_EOS stopped is ready!)
    {
        let tracker = ServiceObservationTracker::default();
        let snap = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(vec![])),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(clean_services())),
                steam: &FakeSteam(Ok(Some(0))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &clock,
        );
        assert_eq!(snap.conclusion, EacConclusionV02::Ready);
        assert!(snap.plan.is_empty());
        assert_schema_valid(&snap);
    }

    // 2. session_active
    {
        let tracker = ServiceObservationTracker::default();
        let mut wins = HashSet::new();
        wins.insert(8844);
        let snap = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(vec![
                    ProcessEntryV02 {
                        image_name: "VRChat.exe".to_owned(),
                        pid: 8844,
                        created: Some(134392000050000000),
                        path: Some(
                            r"D:\SteamLibrary\steamapps\common\VRChat\VRChat.exe".to_owned(),
                        ),
                    },
                    ProcessEntryV02 {
                        image_name: "EasyAntiCheat_EOS.exe".to_owned(),
                        pid: 4120,
                        created: Some(134392000000000000),
                        path: Some(
                            r"C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe"
                                .to_owned(),
                        ),
                    },
                ])),
                windows: &FakeWindows(Ok(wins)),
                services: &FakeServices(Ok([
                    RawServiceObservation {
                        name: EacServiceName::EasyAntiCheatEos,
                        present: true,
                        state: EacServiceState::Running,
                        binary_path: Some(PathBuf::from(
                            r"C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe",
                        )),
                    },
                    RawServiceObservation {
                        name: EacServiceName::EasyAntiCheatEosSys,
                        present: true,
                        state: EacServiceState::Running,
                        binary_path: None,
                    },
                ])),
                steam: &FakeSteam(Ok(Some(1))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: true,
            },
            &clock,
        );
        assert_eq!(snap.conclusion, EacConclusionV02::SessionActive);
        assert!(snap.plan.is_empty());
        assert_schema_valid(&snap);
    }

    // 3. unloading (with firstObservedAt persisted across reads)
    {
        let tracker = ServiceObservationTracker::default();
        let unloading_services = [
            clean_services()[0].clone(),
            RawServiceObservation {
                name: EacServiceName::EasyAntiCheatEosSys,
                present: true,
                state: EacServiceState::StopPending,
                binary_path: None,
            },
        ];
        let first = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(vec![])),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(unloading_services.clone())),
                steam: &FakeSteam(Ok(Some(1))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![EacLogFinding {
                    code: LogFindingCode::LaunchError30005,
                    observed_at: Some("2026-11-14T07:59:50".to_owned()),
                }])),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &FixedClock::new(&["2026-11-14T08:00:00Z"]),
        );
        assert_eq!(first.conclusion, EacConclusionV02::Unloading);
        assert_eq!(
            first.services[1].first_observed_at.as_deref(),
            Some("2026-11-14T08:00:00Z")
        );
        assert_eq!(
            first.plan,
            vec![EacRecoveryStepId::WaitUnload, EacRecoveryStepId::RestartPc]
        );
        assert_schema_valid(&first);

        let second = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(vec![])),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(unloading_services)),
                steam: &FakeSteam(Ok(Some(1))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &FixedClock::new(&["2026-11-14T08:03:00Z"]),
        );
        assert_eq!(
            second.services[1].first_observed_at.as_deref(),
            Some("2026-11-14T08:00:00Z"),
            "firstObservedAt must stick across ongoing unloading reads"
        );
    }

    // 4. residual_process (launcher with verified allowlist candidate & switch on vs off)
    {
        let tracker = ServiceObservationTracker::default();
        let populated = AllowlistV01 {
            schema_version: EAC_ALLOWLIST_SCHEMA_VERSION.to_owned(),
            entries: vec![AllowlistEntryV01 {
                process_name: "start_protected_game.exe".to_owned(),
                expected_path_pattern:
                    r"D:\SteamLibrary\steamapps\common\VRChat\start_protected_game.exe".to_owned(),
                publisher_evidence: "CN=EasyAntiCheat Oy".to_owned(),
                reason: "User-mode VRChat EAC bootstrapper".to_owned(),
                evidence_ref: "S0 2026-11-14".to_owned(),
                added_at: "2026-11-14T00:00:00Z".to_owned(),
                release_notes: "unreleased".to_owned(),
            }],
        };
        let proc = vec![ProcessEntryV02 {
            image_name: "start_protected_game.exe".to_owned(),
            pid: 9012,
            created: Some(134392000100000000),
            path: Some(
                r"D:\SteamLibrary\steamapps\common\VRChat\start_protected_game.exe".to_owned(),
            ),
        }];
        let off = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(proc.clone())),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(clean_services())),
                steam: &FakeSteam(Ok(Some(1))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &populated,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &clock,
        );
        assert_eq!(off.conclusion, EacConclusionV02::ResidualProcess);
        assert_eq!(off.termination_capability.state, "disabled");
        assert!(!off.plan.contains(&EacRecoveryStepId::TerminateResidual));
        assert_schema_valid(&off);

        let on = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(proc)),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(clean_services())),
                steam: &FakeSteam(Ok(Some(1))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &populated,
                signature_verifier: &verifier,
                experimental_termination_enabled: true,
            },
            &clock,
        );
        assert_eq!(on.conclusion, EacConclusionV02::ResidualProcess);
        assert_eq!(on.termination_capability.state, "available");
        assert!(on.plan.contains(&EacRecoveryStepId::TerminateResidual));
        assert_schema_valid(&on);
    }

    // 5. steam_stale
    {
        let tracker = ServiceObservationTracker::default();
        let snap = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(vec![])),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(clean_services())),
                steam: &FakeSteam(Ok(Some(1))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &clock,
        );
        assert_eq!(snap.conclusion, EacConclusionV02::SteamStale);
        assert_eq!(
            snap.plan,
            vec![EacRecoveryStepId::QuitSteam, EacRecoveryStepId::RestartPc]
        );
        assert_schema_valid(&snap);
    }

    // 6. not_installed
    {
        let tracker = ServiceObservationTracker::default();
        let missing_services = [
            RawServiceObservation {
                name: EacServiceName::EasyAntiCheatEos,
                present: false,
                state: EacServiceState::Stopped,
                binary_path: None,
            },
            clean_services()[1].clone(),
        ];
        let snap = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(vec![])),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(missing_services)),
                steam: &FakeSteam(Ok(Some(0))),
                install: &FakeInstall(Ok(clean_install())),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &clock,
        );
        assert_eq!(snap.conclusion, EacConclusionV02::NotInstalled);
        assert_eq!(snap.plan, vec![EacRecoveryStepId::OfficialRepair]);
        assert_schema_valid(&snap);
    }

    // 7. install_damaged
    {
        let tracker = ServiceObservationTracker::default();
        let mut damaged = clean_install();
        damaged.install.setup_signature = EacBinaryState::Unverified;
        let snap = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(Ok(vec![])),
                windows: &FakeWindows(Ok(HashSet::new())),
                services: &FakeServices(Ok(clean_services())),
                steam: &FakeSteam(Ok(Some(0))),
                install: &FakeInstall(Ok(damaged)),
                logs: &FakeLogs(Ok(vec![])),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &clock,
        );
        assert_eq!(snap.conclusion, EacConclusionV02::InstallDamaged);
        assert_eq!(snap.plan, vec![EacRecoveryStepId::OfficialRepair]);
        assert_schema_valid(&snap);
    }

    // 8. unknown when any source fails
    for case in 0..6 {
        let tracker = ServiceObservationTracker::default();
        let snap = probe_eac_v02(
            &EacSources {
                processes: &FakeProcesses(if case == 0 {
                    Err("proc failed".to_owned())
                } else {
                    Ok(vec![])
                }),
                windows: &FakeWindows(if case == 1 {
                    Err("win failed".to_owned())
                } else {
                    Ok(HashSet::new())
                }),
                services: &FakeServices(if case == 2 {
                    Err("scm failed".to_owned())
                } else {
                    Ok(clean_services())
                }),
                steam: &FakeSteam(if case == 3 {
                    Err("reg failed".to_owned())
                } else {
                    Ok(Some(0))
                }),
                install: &FakeInstall(if case == 4 {
                    Err("install failed".to_owned())
                } else {
                    Ok(clean_install())
                }),
                logs: &FakeLogs(if case == 5 {
                    Err("log failed".to_owned())
                } else {
                    Ok(vec![])
                }),
                tracker: &tracker,
                allowlist: &allowlist,
                signature_verifier: &verifier,
                experimental_termination_enabled: false,
            },
            &clock,
        );
        assert_eq!(snap.conclusion, EacConclusionV02::Unknown, "case {case}");
        assert!(snap.plan.is_empty(), "case {case}");
        assert!(!snap.diagnostics.is_empty(), "case {case}");
        assert_schema_valid(&snap);
    }
}

#[test]
fn sorts_processes_deterministically_by_kind_and_pid() {
    let clock = FixedClock::new(&["2026-11-14T08:00:00Z"]);
    let tracker = ServiceObservationTracker::default();
    let allowlist = empty_allowlist();
    let verifier = FakeVerifier(false);
    let procs = vec![
        ProcessEntryV02 {
            image_name: "start_protected_game.exe".to_owned(),
            pid: 500,
            created: None,
            path: Some(
                r"D:\SteamLibrary\steamapps\common\VRChat\start_protected_game.exe".to_owned(),
            ),
        },
        ProcessEntryV02 {
            image_name: "VRChat.exe".to_owned(),
            pid: 300,
            created: None,
            path: Some(r"D:\SteamLibrary\steamapps\common\VRChat\VRChat.exe".to_owned()),
        },
        ProcessEntryV02 {
            image_name: "EasyAntiCheat_EOS.exe".to_owned(),
            pid: 900,
            created: None,
            path: None,
        },
        ProcessEntryV02 {
            image_name: "EasyAntiCheat_EOS.exe".to_owned(),
            pid: 100,
            created: None,
            path: None,
        },
    ];
    let one = probe_eac_v02(
        &EacSources {
            processes: &FakeProcesses(Ok(procs.clone())),
            windows: &FakeWindows(Ok(HashSet::new())),
            services: &FakeServices(Ok(clean_services())),
            steam: &FakeSteam(Ok(Some(0))),
            install: &FakeInstall(Ok(clean_install())),
            logs: &FakeLogs(Ok(vec![])),
            tracker: &tracker,
            allowlist: &allowlist,
            signature_verifier: &verifier,
            experimental_termination_enabled: false,
        },
        &clock,
    );
    let two = probe_eac_v02(
        &EacSources {
            processes: &FakeProcesses(Ok(procs.into_iter().rev().collect())),
            windows: &FakeWindows(Ok(HashSet::new())),
            services: &FakeServices(Ok(clean_services())),
            steam: &FakeSteam(Ok(Some(0))),
            install: &FakeInstall(Ok(clean_install())),
            logs: &FakeLogs(Ok(vec![])),
            tracker: &tracker,
            allowlist: &allowlist,
            signature_verifier: &verifier,
            experimental_termination_enabled: false,
        },
        &clock,
    );
    let mut left = serde_json::to_value(&one).unwrap();
    let mut right = serde_json::to_value(&two).unwrap();
    left["capturedAt"] = json!("");
    right["capturedAt"] = json!("");
    assert_eq!(left, right);
    assert_eq!(
        one.processes.iter().map(|p| p.pid).collect::<Vec<_>>(),
        vec![100, 900, 300, 500]
    );
}

#[test]
fn windows_repair_launcher_refuses_missing_and_unsigned_setup_without_executing() {
    use std::sync::{Arc, Mutex};
    use vua_orchestrator::Clock;
    use vua_project_manager::eac_probe::v02::{
        resolve_verified_repair_setup_path, EacLastRepairV02, EacRepairOutcome, RepairLauncher,
        WindowsRepairLauncher,
    };

    let repair_schema_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/eac-probe/v0.2/repair.schema.json");
    let repair_schema: Value =
        serde_json::from_str(&std::fs::read_to_string(repair_schema_path).unwrap()).unwrap();
    let validator = jsonschema::validator_for(&repair_schema).unwrap();

    let temp_root = std::env::temp_dir().join(format!(
        "vua-eac-repair-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let launcher = WindowsRepairLauncher::new();
    let clock: Arc<dyn Clock> = Arc::new(FixedClock::new(&["2026-11-14T08:10:00Z"]));
    let last_repair: Arc<Mutex<Option<EacLastRepairV02>>> = Arc::new(Mutex::new(None));

    // 1. Non-existent VRChat root -> not_found
    let missing_root =
        launcher.launch_official_repair(&temp_root, clock.clone(), last_repair.clone());
    assert_eq!(missing_root.outcome, EacRepairOutcome::NotFound);
    assert_eq!(missing_root.exit_code, None);
    assert_eq!(
        last_repair.lock().unwrap().as_ref().map(|r| r.outcome),
        Some(EacRepairOutcome::NotFound)
    );
    assert!(validator
        .validate(&serde_json::to_value(&missing_root).unwrap())
        .is_ok());

    // 2. VRChat root without EasyAntiCheat_EOS_Setup.exe -> not_found
    let eac_dir = temp_root.join("EasyAntiCheat");
    std::fs::create_dir_all(&eac_dir).unwrap();
    let missing_exe =
        launcher.launch_official_repair(&temp_root, clock.clone(), last_repair.clone());
    assert_eq!(missing_exe.outcome, EacRepairOutcome::NotFound);
    assert!(validator
        .validate(&serde_json::to_value(&missing_exe).unwrap())
        .is_ok());

    // 3. Unsigned synthetic PE -> verification_failed (never spawns UAC)
    let setup_exe = eac_dir.join("EasyAntiCheat_EOS_Setup.exe");
    let mut synthetic_pe = vec![0u8; 128];
    synthetic_pe[0] = b'M';
    synthetic_pe[1] = b'Z';
    std::fs::write(&setup_exe, synthetic_pe).unwrap();
    let resolved = resolve_verified_repair_setup_path(&temp_root).unwrap();
    assert!(
        !resolved.to_string_lossy().starts_with(r"\\?\"),
        "repair path must not carry verbatim prefix: {}",
        resolved.display()
    );

    let unsigned_receipt = launcher.launch_official_repair(&temp_root, clock, last_repair.clone());
    assert_eq!(
        unsigned_receipt.outcome,
        EacRepairOutcome::VerificationFailed
    );
    assert_eq!(unsigned_receipt.exit_code, None);
    assert_eq!(
        last_repair.lock().unwrap().as_ref().map(|r| r.outcome),
        Some(EacRepairOutcome::VerificationFailed)
    );
    assert!(validator
        .validate(&serde_json::to_value(&unsigned_receipt).unwrap())
        .is_ok());

    std::fs::remove_dir_all(temp_root).unwrap();
}

#[test]
fn ignores_foreign_launchers_and_other_games_eac_processes_outside_vrchat_dir() {
    let clock = FixedClock::new(&["2026-11-14T08:00:00Z"]);
    let tracker = ServiceObservationTracker::default();
    let allowlist = empty_allowlist();
    let verifier = FakeVerifier(true);

    let foreign_processes = vec![
        ProcessEntryV02 {
            image_name: "launch.exe".to_owned(),
            pid: 1111,
            created: Some(134392000000000001),
            path: Some(r"C:\Program Files\OtherVendor\launch.exe".to_owned()),
        },
        ProcessEntryV02 {
            image_name: "EasyAntiCheat.exe".to_owned(),
            pid: 2222,
            created: Some(134392000000000002),
            path: Some(r"C:\Program Files (x86)\EasyAntiCheat\EasyAntiCheat.exe".to_owned()),
        },
        ProcessEntryV02 {
            image_name: "start_protected_game.exe".to_owned(),
            pid: 3333,
            created: Some(134392000000000003),
            path: Some(
                r"D:\SteamLibrary\steamapps\common\ELDEN RING\Game\start_protected_game.exe"
                    .to_owned(),
            ),
        },
        ProcessEntryV02 {
            image_name: "launch.exe".to_owned(),
            pid: 4444,
            created: None,
            path: None,
        },
    ];

    let snap = probe_eac_v02(
        &EacSources {
            processes: &FakeProcesses(Ok(foreign_processes)),
            windows: &FakeWindows(Ok(HashSet::new())),
            services: &FakeServices(Ok(clean_services())),
            steam: &FakeSteam(Ok(Some(0))),
            install: &FakeInstall(Ok(clean_install())),
            logs: &FakeLogs(Ok(vec![])),
            tracker: &tracker,
            allowlist: &allowlist,
            signature_verifier: &verifier,
            experimental_termination_enabled: false,
        },
        &clock,
    );
    assert_eq!(snap.conclusion, EacConclusionV02::Ready);
    assert!(snap.processes.is_empty());
    assert_schema_valid(&snap);
}

#[test]
fn unload_timer_resets_while_vrchat_runs_and_starts_at_post_exit_unloading() {
    let tracker = ServiceObservationTracker::default();
    let allowlist = empty_allowlist();
    let verifier = FakeVerifier(true);
    let active_services = [
        RawServiceObservation {
            name: EacServiceName::EasyAntiCheatEos,
            present: true,
            state: EacServiceState::Running,
            binary_path: Some(PathBuf::from(
                r"C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe",
            )),
        },
        RawServiceObservation {
            name: EacServiceName::EasyAntiCheatEosSys,
            present: true,
            state: EacServiceState::Running,
            binary_path: None,
        },
    ];

    let mut visible = HashSet::new();
    visible.insert(7000);

    // T = 08:00:00Z — VRChat has been running for 2 hours; inspect happens mid-session.
    let during_play = probe_eac_v02(
        &EacSources {
            processes: &FakeProcesses(Ok(vec![ProcessEntryV02 {
                image_name: "VRChat.exe".to_owned(),
                pid: 7000,
                created: Some(134392000000000000),
                path: Some(r"D:\SteamLibrary\steamapps\common\VRChat\VRChat.exe".to_owned()),
            }])),
            windows: &FakeWindows(Ok(visible)),
            services: &FakeServices(Ok(active_services.clone())),
            steam: &FakeSteam(Ok(Some(1))),
            install: &FakeInstall(Ok(clean_install())),
            logs: &FakeLogs(Ok(vec![])),
            tracker: &tracker,
            allowlist: &allowlist,
            signature_verifier: &verifier,
            experimental_termination_enabled: false,
        },
        &FixedClock::new(&["2026-11-14T08:00:00Z"]),
    );
    assert_eq!(during_play.conclusion, EacConclusionV02::SessionActive);
    assert_eq!(during_play.services[0].first_observed_at, None);
    assert_eq!(during_play.services[1].first_observed_at, None);

    // T = 10:00:02Z — Player exits VRChat cleanly; driver is still unloading 2 seconds later.
    let just_exited = probe_eac_v02(
        &EacSources {
            processes: &FakeProcesses(Ok(vec![])),
            windows: &FakeWindows(Ok(HashSet::new())),
            services: &FakeServices(Ok(active_services)),
            steam: &FakeSteam(Ok(Some(1))),
            install: &FakeInstall(Ok(clean_install())),
            logs: &FakeLogs(Ok(vec![])),
            tracker: &tracker,
            allowlist: &allowlist,
            signature_verifier: &verifier,
            experimental_termination_enabled: false,
        },
        &FixedClock::new(&["2026-11-14T10:00:02Z"]),
    );
    assert_eq!(just_exited.conclusion, EacConclusionV02::Unloading);
    assert_eq!(
        just_exited.services[1].first_observed_at.as_deref(),
        Some("2026-11-14T10:00:02Z"),
        "unload timer must start at game exit, never during active gameplay"
    );
    assert_schema_valid(&just_exited);
}

#[test]
fn unreadable_service_binary_path_maps_to_unknown_not_install_damaged() {
    let clock = FixedClock::new(&["2026-11-14T08:00:00Z"]);
    let tracker = ServiceObservationTracker::default();
    let allowlist = empty_allowlist();
    let verifier = FakeVerifier(true);

    let mut unknown_service_bin = clean_install();
    unknown_service_bin.install.service_binary = EacBinaryState::Unknown;

    let snap = probe_eac_v02(
        &EacSources {
            processes: &FakeProcesses(Ok(vec![])),
            windows: &FakeWindows(Ok(HashSet::new())),
            services: &FakeServices(Ok([
                RawServiceObservation {
                    name: EacServiceName::EasyAntiCheatEos,
                    present: true,
                    state: EacServiceState::Stopped,
                    binary_path: None,
                },
                clean_services()[1].clone(),
            ])),
            steam: &FakeSteam(Ok(Some(0))),
            install: &FakeInstall(Ok(unknown_service_bin)),
            logs: &FakeLogs(Ok(vec![])),
            tracker: &tracker,
            allowlist: &allowlist,
            signature_verifier: &verifier,
            experimental_termination_enabled: false,
        },
        &clock,
    );
    assert_eq!(snap.conclusion, EacConclusionV02::Unknown);
    assert!(snap.plan.is_empty());
    assert!(snap
        .diagnostics
        .iter()
        .any(|d| d.code == "vua.eac_probe.install_unreadable"));
    assert_schema_valid(&snap);
}

#[test]
fn eac_probe_service_inspect_queries_install_source_strictly_once() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use vua_orchestrator::Clock;
    use vua_project_manager::eac_probe::v02::{
        EacLastRepairV02, EacRepairOutcome, EacRepairReceiptV02, EacServiceDeps, RepairLauncher,
        WindowsProcessTerminator,
    };

    struct CountingInstall(Arc<AtomicUsize>);
    impl InstallSource for CountingInstall {
        fn inspect_install(
            &self,
            _eos_service_present: bool,
            _eos_service_binary: Option<&Path>,
        ) -> Result<EacInstallObservation, String> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(clean_install())
        }
    }

    struct NoopRepair;
    impl RepairLauncher for NoopRepair {
        fn launch_official_repair(
            &self,
            _vrchat_dir: &Path,
            _clock: Arc<dyn Clock>,
            _last_repair: Arc<Mutex<Option<EacLastRepairV02>>>,
        ) -> EacRepairReceiptV02 {
            EacRepairReceiptV02::new(EacRepairOutcome::Launched, None)
        }
    }

    let counter = Arc::new(AtomicUsize::new(0));
    let service = EacProbeService::with_deps(EacServiceDeps {
        processes: Arc::new(FakeProcesses(Ok(vec![]))),
        windows: Arc::new(FakeWindows(Ok(HashSet::new()))),
        services: Arc::new(FakeServices(Ok(clean_services()))),
        steam: Arc::new(FakeSteam(Ok(Some(0)))),
        install: Arc::new(CountingInstall(counter.clone())),
        logs: Arc::new(FakeLogs(Ok(vec![]))),
        signature_verifier: Arc::new(FakeVerifier(true)),
        terminator: Arc::new(WindowsProcessTerminator),
        repair_launcher: Arc::new(NoopRepair),
        clock: Arc::new(FixedClock::new(&["2026-11-14T08:00:00Z"])),
    });

    let snap = service.inspect();
    assert_eq!(snap.conclusion, EacConclusionV02::Ready);
    assert_eq!(snap.last_repair, None);
    assert_eq!(
        counter.load(Ordering::SeqCst),
        1,
        "inspect must query InstallSource only once per poll"
    );
}

#[test]
fn r4_matches_vrchat_exe_outside_detected_vrchat_dir_for_inspect_terminate_and_repair() {
    use std::sync::{Arc, Mutex};
    use vua_orchestrator::Clock;
    use vua_project_manager::eac_probe::v02::{
        EacLastRepairV02, EacRepairOutcome, EacRepairReceiptV02, EacServiceDeps, RepairLauncher,
        WindowsProcessTerminator,
    };
    use vua_project_manager::TerminationGuard;

    struct NeverCalledRepair;
    impl RepairLauncher for NeverCalledRepair {
        fn launch_official_repair(
            &self,
            _vrchat_dir: &Path,
            _clock: Arc<dyn Clock>,
            _last_repair: Arc<Mutex<Option<EacLastRepairV02>>>,
        ) -> EacRepairReceiptV02 {
            panic!("official repair must never run when any VRChat.exe is active");
        }
    }

    let launcher_path = r"D:\SteamLibrary\steamapps\common\VRChat\start_protected_game.exe";
    let custom_sdk_vrchat = r"E:\CustomSdkClients\VRChat_TestCopy\VRChat.exe";
    let mut visible = HashSet::new();
    visible.insert(9500);

    let service = EacProbeService::with_deps(EacServiceDeps {
        processes: Arc::new(FakeProcesses(Ok(vec![
            ProcessEntryV02 {
                image_name: "VRChat.exe".to_owned(),
                pid: 9500,
                created: Some(134392000100000950),
                path: Some(custom_sdk_vrchat.to_owned()),
            },
            ProcessEntryV02 {
                image_name: "start_protected_game.exe".to_owned(),
                pid: 9012,
                created: Some(134392000100000000),
                path: Some(launcher_path.to_owned()),
            },
        ]))),
        windows: Arc::new(FakeWindows(Ok(visible))),
        services: Arc::new(FakeServices(Ok(clean_services()))),
        steam: Arc::new(FakeSteam(Ok(Some(1)))),
        install: Arc::new(FakeInstall(Ok(clean_install()))),
        logs: Arc::new(FakeLogs(Ok(vec![]))),
        signature_verifier: Arc::new(FakeVerifier(true)),
        terminator: Arc::new(WindowsProcessTerminator),
        repair_launcher: Arc::new(NeverCalledRepair),
        clock: Arc::new(FixedClock::new(&["2026-11-14T08:20:00Z"])),
    });
    service.set_experimental_termination(true);

    let snap = service.inspect();
    assert_eq!(snap.conclusion, EacConclusionV02::SessionActive);
    assert_eq!(snap.termination_capability.state, "unavailable");
    assert_eq!(snap.termination_capability.reason, "active_vrchat_session");
    assert!(snap.processes.iter().any(|p| p.pid == 9500));
    assert_schema_valid(&snap);

    let term = service
        .terminate_residual(9012, "134392000100000000", launcher_path, "corr-r4-custom")
        .unwrap();
    assert_eq!(term.termination.kind, "refused");
    assert_eq!(
        term.termination.guard,
        Some(TerminationGuard::ActiveVrchatSession)
    );

    let repair = service.launch_repair().unwrap();
    assert_eq!(
        repair.repair.outcome,
        EacRepairOutcome::ActiveSessionRefused
    );
    assert_eq!(
        repair.eac_snapshot.last_repair.as_ref().map(|r| r.outcome),
        Some(EacRepairOutcome::ActiveSessionRefused)
    );
    assert_schema_valid(&repair.eac_snapshot);
}

#[test]
fn eac_probe_service_tracks_background_repair_outcomes_in_snapshot_last_repair() {
    use std::sync::{mpsc, Arc, Mutex};
    use vua_orchestrator::Clock;
    use vua_project_manager::eac_probe::v02::{
        record_last_repair, EacLastRepairV02, EacRepairOutcome, EacRepairReceiptV02,
        EacServiceDeps, RepairLauncher, WindowsProcessTerminator,
    };

    struct ControlledAsyncRepair {
        next_terminal: Mutex<(EacRepairOutcome, Option<i32>)>,
        release_rx: Mutex<Option<mpsc::Receiver<()>>>,
        done_tx: Mutex<Option<mpsc::Sender<()>>>,
    }

    impl RepairLauncher for ControlledAsyncRepair {
        fn launch_official_repair(
            &self,
            _vrchat_dir: &Path,
            clock: Arc<dyn Clock>,
            last_repair: Arc<Mutex<Option<EacLastRepairV02>>>,
        ) -> EacRepairReceiptV02 {
            record_last_repair(
                &last_repair,
                EacRepairOutcome::Launched,
                None,
                clock.as_ref(),
            );
            let (outcome, exit_code) = *self.next_terminal.lock().unwrap();
            let rx = self.release_rx.lock().unwrap().take().unwrap();
            let tx = self.done_tx.lock().unwrap().take().unwrap();
            std::thread::spawn(move || {
                rx.recv().unwrap();
                record_last_repair(&last_repair, outcome, exit_code, clock.as_ref());
                tx.send(()).unwrap();
            });
            EacRepairReceiptV02::new(EacRepairOutcome::Launched, None)
        }
    }

    let (rel_tx1, rel_rx1) = mpsc::channel();
    let (done_tx1, done_rx1) = mpsc::channel();
    let launcher = Arc::new(ControlledAsyncRepair {
        next_terminal: Mutex::new((EacRepairOutcome::ElevationDeclined, None)),
        release_rx: Mutex::new(Some(rel_rx1)),
        done_tx: Mutex::new(Some(done_tx1)),
    });

    let service = EacProbeService::with_deps(EacServiceDeps {
        processes: Arc::new(FakeProcesses(Ok(vec![]))),
        windows: Arc::new(FakeWindows(Ok(HashSet::new()))),
        services: Arc::new(FakeServices(Ok(clean_services()))),
        steam: Arc::new(FakeSteam(Ok(Some(0)))),
        install: Arc::new(FakeInstall(Ok(clean_install()))),
        logs: Arc::new(FakeLogs(Ok(vec![]))),
        signature_verifier: Arc::new(FakeVerifier(true)),
        terminator: Arc::new(WindowsProcessTerminator),
        repair_launcher: launcher.clone(),
        clock: Arc::new(FixedClock::new(&[
            "2026-11-14T08:30:00Z",
            "2026-11-14T08:30:01Z",
            "2026-11-14T08:30:05Z",
            "2026-11-14T08:30:06Z",
            "2026-11-14T08:30:10Z",
            "2026-11-14T08:30:11Z",
            "2026-11-14T08:30:15Z",
            "2026-11-14T08:30:16Z",
        ])),
    });
    service.set_experimental_termination(true);

    // 1. Launch returns immediately with Launched while UAC prompt is still open
    let launched = service.launch_repair().unwrap();
    assert_eq!(launched.repair.outcome, EacRepairOutcome::Launched);
    assert_eq!(
        launched
            .eac_snapshot
            .last_repair
            .as_ref()
            .map(|r| r.outcome),
        Some(EacRepairOutcome::Launched)
    );
    assert_schema_valid(&launched.eac_snapshot);

    // 2. Worker finishes with ElevationDeclined -> subsequent inspect poll surfaces it
    rel_tx1.send(()).unwrap();
    done_rx1.recv().unwrap();
    let declined_snap = service.inspect();
    assert_eq!(
        declined_snap.last_repair,
        Some(EacLastRepairV02 {
            outcome: EacRepairOutcome::ElevationDeclined,
            exit_code: None,
            updated_at: "2026-11-14T08:30:05Z".to_owned(),
        })
    );
    assert_schema_valid(&declined_snap);

    // 3. Second run finishes with non-zero exit code -> surfaced in lastRepair
    let (rel_tx2, rel_rx2) = mpsc::channel();
    let (done_tx2, done_rx2) = mpsc::channel();
    *launcher.next_terminal.lock().unwrap() = (EacRepairOutcome::Completed, Some(1));
    *launcher.release_rx.lock().unwrap() = Some(rel_rx2);
    *launcher.done_tx.lock().unwrap() = Some(done_tx2);

    let _ = service.launch_repair().unwrap();
    rel_tx2.send(()).unwrap();
    done_rx2.recv().unwrap();
    let nonzero_snap = service.inspect();
    assert_eq!(
        nonzero_snap
            .last_repair
            .as_ref()
            .map(|r| (r.outcome, r.exit_code)),
        Some((EacRepairOutcome::Completed, Some(1)))
    );
    assert_schema_valid(&nonzero_snap);
}

#[test]
#[ignore = "real-machine read-only probe: inspects local Windows SCM, registry, VRChat EAC files, and logs"]
fn real_machine_eac_probe_v02() {
    let service = EacProbeService::windows(EnvironmentRoots::default());
    let snapshot = service.inspect();
    assert_schema_valid(&snapshot);
    println!(
        "real-machine eac-probe v0.2: conclusion={:?}, services={:?}, steam={:?}, install={:?}, log_findings={:?}",
        snapshot.conclusion,
        snapshot.services,
        snapshot.steam,
        snapshot.install,
        snapshot.log_findings
    );
}

//! E-ENV integration tests: read-only environment detection against
//! synthetic roots and a synthetic registry, so no test depends on this
//! machine's real installs. Each test cites its ORC requirement
//! (ORC-TST-006). The detector reports presence plus raw facts only;
//! severity is a frontend decision and is deliberately not asserted here.

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use vua_orchestrator::{
    env_error_codes, env_managers_codes, installed_unity_editors, outcome_with_exit,
    EditorInstallObservation, EnvironmentEngine, EnvironmentPresence, EnvironmentRoots,
    FakeProcessRunner, FakeRegistrySource, FindingSeverity, FixedClock, ManagerDiagnostic,
    ManagerPresence, ProcessOutcome, RegistryHive, VccCapability, VccSettingsReader, Zone,
};

fn unique_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("vua-env-{label}-{nanos}"))
}

fn synthetic_roots(base: &Path) -> EnvironmentRoots {
    EnvironmentRoots {
        steam_common: vec![base.join("steam/steamapps/common")],
        local_low: base.join("LocalLow"),
        unity_hub_exe_candidates: vec![base.join("hub/Unity Hub.exe")],
        unity_hub_registry_display_icon_keys: Vec::new(),
        unity_editors_root: base.join("editors"),
        vrc_get_executable: "vrc-get".into(),
        disk_target: base.to_path_buf(),
        network_probes: vec!["127.0.0.1:1".into()],
        registry: Arc::new(FakeRegistrySource::new()),
        steam_install_candidates: vec![base.join("steam")],
        vr_runtime_roots: vua_orchestrator::VrRuntimeRoots {
            oculus: vec![base.join("vr/Oculus")],
            pico: vec![base.join("vr/PICO Connect")],
            vive: vec![base.join("vr/VIVE")],
            virtual_desktop: vec![base.join("vr/VirtualDesktop")],
            alvr: vec![base.join("vr/alvr")],
            pimax: vec![base.join("vr/Pimax")],
            varjo: vec![base.join("vr/Varjo")],
            hp_omnicept: vec![base.join("vr/HP Omnicept Runtime")],
        },
        openvrpaths: vec![base.join("openvr/openvrpaths.vrpath")],
        vcc_settings_candidates: vec![base.join("vcc/settings.json")],
    }
}

/// Fake VCC port: the engine-side mapping tests never touch the file
/// system; the real reader runs against synthetic trees in the
/// project-manager suite (proposal 004 split).
struct FixedVccReader {
    capability: VccCapability,
    diagnostics: Vec<ManagerDiagnostic>,
}

impl VccSettingsReader for FixedVccReader {
    fn read_vcc_settings(
        &self,
        _candidates: &[PathBuf],
        diagnostics: &mut Vec<ManagerDiagnostic>,
    ) -> VccCapability {
        diagnostics.extend(self.diagnostics.iter().cloned());
        self.capability.clone()
    }
}

fn vcc_reader(
    presence: ManagerPresence,
    error_code: Option<&'static str>,
    diagnostics: Vec<ManagerDiagnostic>,
) -> Arc<FixedVccReader> {
    Arc::new(FixedVccReader {
        capability: VccCapability {
            presence,
            settings_path: None,
            projects_source: if presence == ManagerPresence::Found {
                Some("userProjects")
            } else {
                None
            },
            user_projects: if presence == ManagerPresence::Found {
                vec!["synthetic-project".into()]
            } else {
                Vec::new()
            },
            local_project_folders: Vec::new(),
            error_code,
        },
        diagnostics,
    })
}

fn engine_with(roots: EnvironmentRoots, runner: Arc<FakeProcessRunner>) -> EnvironmentEngine {
    engine_with_vcc(roots, runner, vcc_reader(ManagerPresence::NotFound, None, Vec::new()))
}

fn engine_with_vcc(
    roots: EnvironmentRoots,
    runner: Arc<FakeProcessRunner>,
    vcc: Arc<FixedVccReader>,
) -> EnvironmentEngine {
    EnvironmentEngine::new(
        runner,
        Arc::new(FixedClock::new(&["2026-08-30T09:00:00.000Z"])),
        roots,
        vcc,
    )
}

fn default_runner() -> Arc<FakeProcessRunner> {
    Arc::new(FakeProcessRunner::new())
}

fn find<'a>(
    items: &'a [vua_orchestrator::EnvironmentCheckItemV1],
    id: &str,
) -> &'a vua_orchestrator::EnvironmentCheckItemV1 {
    items
        .iter()
        .find(|item| item.id == id)
        .expect("check must exist")
}

#[test]
fn orc_wf_001_vrchat_detection_is_deterministic_for_present_and_missing() {
    let base = unique_dir("vrchat");
    let engine = engine_with(synthetic_roots(&base), default_runner());

    // Missing: a deterministic finding, not a detection failure (验收 2).
    let items = engine.inspect_zone(Zone::Play);
    let vrchat = find(&items, "vrchat");
    assert_eq!(vrchat.presence, EnvironmentPresence::NotDetected);
    assert_eq!(vrchat.error_code, None, "missing is a finding, not a failure");
    assert!(
        !vrchat.facts["searchedRoots"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    // Present: targeted path observation. Steam itself is discoverable
    // here, so the game check walks the *discovered* library root.
    let common = base.join("steam").join("steamapps").join("common");
    let exe = common.join("VRChat").join("VRChat.exe");
    fs::create_dir_all(exe.parent().unwrap()).unwrap();
    fs::write(&exe, "binary").unwrap();
    let items = engine.inspect_zone(Zone::Play);
    let vrchat = find(&items, "vrchat");
    assert_eq!(vrchat.presence, EnvironmentPresence::Detected);
    assert_eq!(vrchat.facts["exe"], exe.to_string_lossy().to_string());
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_wf_001_steam_missing_is_its_own_finding_before_vrchat() {
    // Without Steam the game checks report not_detected against the
    // configured fallback roots, and `steam` itself says not_detected:
    // the frontend turns that into "install Steam first".
    let base = unique_dir("steam-missing");
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let steam = find(&items, "steam");
    assert_eq!(steam.presence, EnvironmentPresence::NotDetected);
    assert_eq!(steam.error_code, None);
    assert!(steam.facts["registryKey"].as_str().unwrap().contains("Valve"));
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_wf_001_steam_library_vdf_discovers_secondary_drive_installs() {
    // The install sits at base/steam; VRChat lives in a *second* library
    // (base/library-two) referenced by libraryfolders.vdf. The pre-VDF
    // check only looked at one hardcoded root and missed exactly this.
    let base = unique_dir("steam-vdf");
    let steam_root = base.join("steam");
    let second_library = base.join("library-two");
    fs::create_dir_all(steam_root.join("steamapps")).unwrap();
    fs::create_dir_all(second_library.join("steamapps/common/VRChat")).unwrap();
    fs::write(second_library.join("steamapps/common/VRChat/VRChat.exe"), "binary").unwrap();
    // VDF escapes backslashes: `C:\\Dir` in the file means `C:\Dir`.
    let vdf_value = format!(
        "\"path\"\t\t\"{}\"",
        second_library.to_string_lossy().replace('\\', "\\\\")
    );
    fs::write(
        steam_root.join("steamapps/libraryfolders.vdf"),
        format!("\"libraryfolders\"\n{{\n\t\"1\"\n\t{{\n\t\t{vdf_value}\n\t}}\n}}"),
    )
    .unwrap();

    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);

    let steam = find(&items, "steam");
    assert_eq!(steam.presence, EnvironmentPresence::Detected);
    assert_eq!(steam.facts["path"], steam_root.to_string_lossy().to_string());
    let roots: Vec<&str> = steam.facts["libraryRoots"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap())
        .collect();
    assert_eq!(roots.len(), 2, "install root + vdf library");
    let vrchat = find(&items, "vrchat");
    assert_eq!(vrchat.presence, EnvironmentPresence::Detected,
        "the secondary-drive install must be observed, not missed");
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_wf_001_steam_install_path_resolves_through_the_registry() {
    let base = unique_dir("steam-registry");
    let registry_root = base.join("custom-steam");
    fs::create_dir_all(&registry_root).unwrap();
    let roots = EnvironmentRoots {
        registry: Arc::new(FakeRegistrySource::new().with(
            RegistryHive::LocalMachine,
            "SOFTWARE\\WOW6432Node\\Valve\\Steam",
            "InstallPath",
            &registry_root.to_string_lossy(),
        )),
        ..synthetic_roots(&base)
    };
    let engine = engine_with(roots, default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let steam = find(&items, "steam");
    assert_eq!(steam.presence, EnvironmentPresence::Detected);
    assert_eq!(steam.facts["path"], registry_root.to_string_lossy().to_string());
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_wf_001_steamvr_missing_is_not_detected_severity_belongs_to_the_frontend() {
    let base = unique_dir("steamvr");
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let steamvr = find(&items, "steamvr");
    assert_eq!(steamvr.presence, EnvironmentPresence::NotDetected);
    assert_eq!(steamvr.error_code, None, "the detector carries no severity");

    fs::create_dir_all(base.join("steam/steamapps/common/SteamVR")).unwrap();
    let items = engine.inspect_zone(Zone::Play);
    assert_eq!(find(&items, "steamvr").presence, EnvironmentPresence::Detected);
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_adp_006_network_probe_reports_deterministic_unreachability() {
    // 127.0.0.1:1 refuses connections quickly: the result is "not
    // detected" with a stable shape. No test asserts that the real
    // internet is up.
    let base = unique_dir("network");
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let network = find(&items, "network");
    assert_eq!(network.presence, EnvironmentPresence::NotDetected);
    assert_eq!(network.error_code, None, "unreachable is a finding");
    assert_eq!(
        network.facts["unreachable"],
        serde_json::json!(["127.0.0.1:1"])
    );
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_env_openxr_runtime_reads_the_active_runtime_name() {
    let base = unique_dir("openxr");
    let runtime_json = base.join("openxr/openvr_xrapi.json");
    fs::create_dir_all(runtime_json.parent().unwrap()).unwrap();
    fs::write(
        &runtime_json,
        serde_json::json!({ "runtime": { "name": "SteamVR OpenXR Runtime" } }).to_string(),
    )
    .unwrap();
    let roots = EnvironmentRoots {
        registry: Arc::new(FakeRegistrySource::new().with(
            RegistryHive::LocalMachine,
            "SOFTWARE\\Khronos\\OpenXR\\1",
            "ActiveRuntime",
            &runtime_json.to_string_lossy(),
        )),
        ..synthetic_roots(&base)
    };
    let engine = engine_with(roots, default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let openxr = find(&items, "openxr_runtime");
    assert_eq!(openxr.presence, EnvironmentPresence::Detected);
    assert_eq!(openxr.facts["runtimeName"], "SteamVR OpenXR Runtime");

    // No registry value anywhere → deterministic not_detected.
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let openxr = find(&items, "openxr_runtime");
    assert_eq!(openxr.presence, EnvironmentPresence::NotDetected);

    // A dangling ActiveRuntime pointer is a detection failure, not a
    // missing runtime: the value exists but cannot be observed.
    let roots = EnvironmentRoots {
        registry: Arc::new(FakeRegistrySource::new().with(
            RegistryHive::LocalMachine,
            "SOFTWARE\\Khronos\\OpenXR\\1",
            "ActiveRuntime",
            &base.join("openxr/missing.json").to_string_lossy(),
        )),
        ..synthetic_roots(&base)
    };
    let engine = engine_with(roots, default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let openxr = find(&items, "openxr_runtime");
    assert_eq!(openxr.presence, EnvironmentPresence::DetectionFailed);
    assert_eq!(
        openxr.error_code.as_deref(),
        Some(env_error_codes::READ_FAILED)
    );
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_env_headset_runtime_presence_checks_are_independent_findings() {
    let base = unique_dir("vr-runtimes");
    fs::create_dir_all(base.join("vr/Oculus")).unwrap();
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    assert_eq!(find(&items, "oculus_runtime").presence, EnvironmentPresence::Detected);
    assert_eq!(
        find(&items, "oculus_runtime").facts["root"],
        base.join("vr/Oculus").to_string_lossy().to_string()
    );
    for id in [
        "pico_runtime",
        "vive_runtime",
        "virtual_desktop",
        "alvr",
        "psvr2",
        "bigscreen_beyond",
        "pimax_runtime",
        "varjo_runtime",
        "hp_omnicept",
    ] {
        let item = find(&items, id);
        assert_eq!(item.presence, EnvironmentPresence::NotDetected, "{id}");
        assert_eq!(item.error_code, None, "{id}: missing is a finding");
    }
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_env_new_brand_runtimes_detect_via_candidate_roots() {
    // Pimax / Varjo / HP Omnicept are plain candidate-root presence
    // checks (VRCFT module-library hardware coverage, 2026-09-18).
    let base = unique_dir("vr-brands");
    for dir in ["vr/Pimax", "vr/Varjo", "vr/HP Omnicept Runtime"] {
        fs::create_dir_all(base.join(dir)).unwrap();
    }
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    for (id, dir) in [
        ("pimax_runtime", "vr/Pimax"),
        ("varjo_runtime", "vr/Varjo"),
        ("hp_omnicept", "vr/HP Omnicept Runtime"),
    ] {
        let item = find(&items, id);
        assert_eq!(item.presence, EnvironmentPresence::Detected, "{id}");
        assert_eq!(
            item.facts["root"],
            base.join(dir).to_string_lossy().to_string(),
            "{id}"
        );
    }
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_env_psvr2_and_bigscreen_detect_via_steam_library_dirs() {
    // Both ship as Steam apps (PSVR2 app 2580190, Bigscreen Beyond driver
    // tool 2467050): presence = the install directory under a discovered
    // Steam library root.
    let base = unique_dir("vr-steam-lib");
    fs::create_dir_all(base.join("steam/steamapps/common/PlayStation VR2 App")).unwrap();
    fs::create_dir_all(base.join("steam/steamapps/common/Bigscreen Beyond Driver")).unwrap();
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let psvr2 = find(&items, "psvr2");
    assert_eq!(psvr2.presence, EnvironmentPresence::Detected);
    assert_eq!(
        psvr2.facts["root"],
        base.join("steam")
            .join("steamapps")
            .join("common")
            .join("PlayStation VR2 App")
            .to_string_lossy()
            .to_string()
    );
    assert_eq!(
        find(&items, "bigscreen_beyond").presence,
        EnvironmentPresence::Detected
    );
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_env_alvr_detects_via_openvrpaths_external_driver_registration() {
    // ALVR has no fixed install root: the documented presence signal is
    // its vrpathreg external-driver registration in openvrpaths.vrpath
    // (matching is case-insensitive).
    let base = unique_dir("alvr-openvr");
    let openvrpaths = base.join("openvr/openvrpaths.vrpath");
    fs::create_dir_all(openvrpaths.parent().unwrap()).unwrap();
    fs::write(
        &openvrpaths,
        serde_json::json!({ "external_drivers": ["E:\\Tools\\ALVR-Streamer"] }).to_string(),
    )
    .unwrap();
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let alvr = find(&items, "alvr");
    assert_eq!(alvr.presence, EnvironmentPresence::Detected);
    assert_eq!(alvr.facts["registeredDriver"], "E:\\Tools\\ALVR-Streamer");

    // An absent openvrpaths file is a normal not-detected finding, never
    // an error.
    let base2 = unique_dir("alvr-absent");
    let engine = engine_with(synthetic_roots(&base2), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let alvr = find(&items, "alvr");
    assert_eq!(alvr.presence, EnvironmentPresence::NotDetected);
    assert_eq!(alvr.error_code, None, "absent file is a finding");

    // A present-but-unobservable openvrpaths file is a detection failure
    // with a stable code.
    let base3 = unique_dir("alvr-garbled");
    let openvrpaths3 = base3.join("openvr/openvrpaths.vrpath");
    fs::create_dir_all(openvrpaths3.parent().unwrap()).unwrap();
    fs::write(&openvrpaths3, "not json at all").unwrap();
    let engine = engine_with(synthetic_roots(&base3), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let alvr = find(&items, "alvr");
    assert_eq!(alvr.presence, EnvironmentPresence::DetectionFailed);
    assert_eq!(
        alvr.error_code.as_deref(),
        Some(env_error_codes::READ_FAILED)
    );
    for b in [&base, &base2, &base3] {
        if b.exists() {
            fs::remove_dir_all(b).unwrap();
        }
    }
}

#[test]
fn orc_env_windows_and_gpu_report_registry_identity_facts() {
    let base = unique_dir("machine");
    let registry = FakeRegistrySource::new()
        .with(
            RegistryHive::LocalMachine,
            "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
            "ProductName",
            "Windows 11 Pro",
        )
        .with(
            RegistryHive::LocalMachine,
            "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
            "DisplayVersion",
            "24H2",
        )
        .with(
            RegistryHive::LocalMachine,
            "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000",
            "DriverDesc",
            "Synthetic GPU 9000",
        );
    let roots = EnvironmentRoots {
        registry: Arc::new(registry),
        ..synthetic_roots(&base)
    };
    let engine = engine_with(roots, default_runner());
    let items = engine.inspect_zone(Zone::Play);
    let windows = find(&items, "windows");
    assert_eq!(windows.presence, EnvironmentPresence::Detected);
    assert_eq!(windows.facts["productName"], "Windows 11 Pro");
    assert_eq!(windows.facts["displayVersion"], "24H2");
    let gpu = find(&items, "gpu");
    assert_eq!(gpu.presence, EnvironmentPresence::Detected);
    assert_eq!(gpu.facts["gpus"][0], "Synthetic GPU 9000");

    // Empty registry → deterministic not_detected on both.
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Play);
    assert_eq!(find(&items, "windows").presence, EnvironmentPresence::NotDetected);
    assert_eq!(find(&items, "gpu").presence, EnvironmentPresence::NotDetected);
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_wf_001_unity_editors_enumerate_classify_and_ignore_junk() {
    let base = unique_dir("editors");
    let editors_root = base.join("editors");
    for version in ["2022.3.22f1", "2019.4.31f1", "not-a-version", "999.9"] {
        fs::create_dir_all(editors_root.join(version).join("Editor")).unwrap();
    }
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let editors = find(&items, "unity_editors");
    assert_eq!(editors.presence, EnvironmentPresence::Detected);
    assert_eq!(editors.facts["editors"].as_array().unwrap().len(), 2);
    assert_eq!(
        editors.facts["editors"][0]["version"], "2022.3.22f1",
        "sorted newest first"
    );
    assert_eq!(
        editors.facts["editors"][0]["classification"], "production_target",
        "the support matrix classification rides in facts"
    );
    assert_eq!(
        editors.facts["editors"][1]["classification"], "migration_source"
    );
    assert_eq!(
        editors.facts["productionTarget"], vua_orchestrator::PRODUCTION_TARGET
    );

    // "999.9" has an Editor dir but no patch component → ignored.
    // Detection failure path: editors root is a file, not a directory.
    let base2 = unique_dir("editors-file");
    fs::create_dir_all(&base2).unwrap();
    fs::write(base2.join("editors"), "not a dir").unwrap();
    let engine = engine_with(synthetic_roots(&base2), default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let editors = find(&items, "unity_editors");
    assert_eq!(editors.presence, EnvironmentPresence::DetectionFailed);
    assert_eq!(
        editors.error_code.as_deref(),
        Some(env_error_codes::READ_FAILED),
        "a detection failure carries a stable code"
    );
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
    if base2.exists() {
        fs::remove_dir_all(&base2).unwrap();
    }
}

/// Synthetic stand-in for the well-known Unity Hub Uninstall key.
const SYNTHETIC_HUB_UNINSTALL_SUBKEY: &str =
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Synthetic Hub";

#[test]
fn orc_env_unity_hub_candidates_cover_machine_wide_installs() {
    let base = unique_dir("hub-candidates");
    let per_user = base.join("local/Programs/Unity Hub/Unity Hub.exe");
    let machine_wide = base.join("Program Files/Unity Hub/Unity Hub.exe");
    fs::create_dir_all(per_user.parent().unwrap()).unwrap();
    fs::create_dir_all(machine_wide.parent().unwrap()).unwrap();

    // First (per-user) candidate hit → detected with the hit path.
    fs::write(&per_user, "hub").unwrap();
    let roots = EnvironmentRoots {
        unity_hub_exe_candidates: vec![per_user.clone(), machine_wide.clone()],
        ..synthetic_roots(&base)
    };
    let engine = engine_with(roots, default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let hub = find(&items, "unity_hub");
    assert_eq!(hub.presence, EnvironmentPresence::Detected);
    assert_eq!(hub.facts["exe"].as_str(), Some(per_user.to_string_lossy().as_ref()));
    assert_eq!(hub.facts["via"], "path");
    fs::remove_file(&per_user).unwrap();

    // Per-user absent, machine-wide present → the W25 live miss
    // (machine-level `C:\Program Files\Unity Hub` install) is covered.
    fs::write(&machine_wide, "hub").unwrap();
    let roots = EnvironmentRoots {
        unity_hub_exe_candidates: vec![per_user, machine_wide.clone()],
        ..synthetic_roots(&base)
    };
    let engine = engine_with(roots, default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let hub = find(&items, "unity_hub");
    assert_eq!(hub.presence, EnvironmentPresence::Detected);
    assert_eq!(
        hub.facts["exe"].as_str(),
        Some(machine_wide.to_string_lossy().as_ref())
    );
    assert_eq!(hub.facts["via"], "path");
    fs::remove_file(&machine_wide).unwrap();

    // Nothing hit → deterministic not_detected with the probed lists in
    // facts (the empty state is the final state).
    let registry = FakeRegistrySource::new().with(
        RegistryHive::LocalMachine,
        SYNTHETIC_HUB_UNINSTALL_SUBKEY,
        "DisplayName",
        "Unity Hub 3.15.2",
    );
    let roots = EnvironmentRoots {
        unity_hub_exe_candidates: vec![base.join("local/Programs/Unity Hub/Unity Hub.exe")],
        unity_hub_registry_display_icon_keys: vec![(
            RegistryHive::LocalMachine,
            SYNTHETIC_HUB_UNINSTALL_SUBKEY.to_owned(),
        )],
        registry: Arc::new(registry),
        ..synthetic_roots(&base)
    };
    let engine = engine_with(roots, default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let hub = find(&items, "unity_hub");
    assert_eq!(hub.presence, EnvironmentPresence::NotDetected);
    assert_eq!(hub.error_code, None);
    assert_eq!(
        hub.facts["candidates"][0].as_str(),
        Some(
            base.join("local/Programs/Unity Hub/Unity Hub.exe")
                .to_string_lossy()
                .as_ref()
        )
    );
    assert_eq!(
        hub.facts["registryKeys"][0],
        serde_json::json!(format!("HKLM\\{SYNTHETIC_HUB_UNINSTALL_SUBKEY}"))
    );

    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_env_unity_hub_packaged_install_is_detected() {
    const REPOSITORY: &str = "Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";
    let base = unique_dir("hub-package");
    let current = "UnityTechnologies.UnityHub_3.22.3.65535_x64__2vrhnee42bhxm";
    let stale = "UnityTechnologies.UnityHub_3.20.0.0_x64__2vrhnee42bhxm";
    let package_root = base.join("WindowsApps").join(current);
    let exe = package_root.join("app").join("Unity Hub.exe");
    fs::create_dir_all(exe.parent().unwrap()).unwrap();
    fs::write(&exe, "hub").unwrap();
    let registry = FakeRegistrySource::new()
        .with_subkey(RegistryHive::CurrentUser, REPOSITORY, "Microsoft.WindowsCalculator_11.0.0.0_x64__8wekyb3d8bbwe")
        .with_subkey(RegistryHive::CurrentUser, REPOSITORY, stale)
        .with_subkey(RegistryHive::CurrentUser, REPOSITORY, current)
        .with(RegistryHive::CurrentUser, &format!("{REPOSITORY}\\{stale}"), "PackageRootFolder", &base.join("absent").to_string_lossy())
        .with(RegistryHive::CurrentUser, &format!("{REPOSITORY}\\{current}"), "PackageRootFolder", &package_root.to_string_lossy());
    let roots = EnvironmentRoots {
        unity_hub_exe_candidates: vec![base.join("absent/Unity Hub.exe")],
        unity_hub_registry_display_icon_keys: vec![],
        registry: Arc::new(registry),
        ..synthetic_roots(&base)
    };
    let hub = find(&engine_with(roots, default_runner()).inspect_zone(Zone::Create), "unity_hub").clone();
    assert_eq!(hub.presence, EnvironmentPresence::Detected);
    assert_eq!(hub.facts["exe"].as_str(), Some(exe.to_string_lossy().as_ref()));
    assert_eq!(hub.facts["via"], "package");
    assert_eq!(hub.facts["package"], current);
    fs::remove_dir_all(&base).unwrap();
}

#[test]
fn orc_env_unity_hub_registry_display_icon_fallback() {
    let base = unique_dir("hub-registry");
    let exe = base.join("Hub Elsewhere/Unity Hub.exe");
    fs::create_dir_all(exe.parent().unwrap()).unwrap();
    fs::write(&exe, "hub").unwrap();

    let icon = |value: String| {
        let registry = FakeRegistrySource::new().with(
            RegistryHive::LocalMachine,
            SYNTHETIC_HUB_UNINSTALL_SUBKEY,
            "DisplayIcon",
            &value,
        );
        let roots = EnvironmentRoots {
            unity_hub_exe_candidates: vec![base.join("absent/Unity Hub.exe")],
            unity_hub_registry_display_icon_keys: vec![(
                RegistryHive::LocalMachine,
                SYNTHETIC_HUB_UNINSTALL_SUBKEY.to_owned(),
            )],
            registry: Arc::new(registry),
            ..synthetic_roots(&base)
        };
        engine_with(roots, default_runner())
    };

    // Unquoted value with icon-index suffix — the shape observed on the
    // W25 real machine (`C:\Program Files\Unity Hub\Unity Hub.exe,0`).
    let engine = icon(format!("{},0", exe.display()));
    let items = engine.inspect_zone(Zone::Create);
    let hub = find(&items, "unity_hub");
    assert_eq!(hub.presence, EnvironmentPresence::Detected);
    assert_eq!(hub.facts["via"], "registry");
    assert_eq!(hub.facts["exe"].as_str(), Some(exe.to_string_lossy().as_ref()));
    assert_eq!(
        hub.facts["registryKey"],
        serde_json::json!(format!("HKLM\\{SYNTHETIC_HUB_UNINSTALL_SUBKEY}"))
    );

    // Quoted value with icon-index suffix parses too.
    let engine = icon(format!("\"{}\",0", exe.display()));
    let items = engine.inspect_zone(Zone::Create);
    let hub = find(&items, "unity_hub");
    assert_eq!(hub.presence, EnvironmentPresence::Detected);
    assert_eq!(hub.facts["via"], "registry");

    // Plain quoted value (no index) parses.
    let engine = icon(format!("\"{}\"", exe.display()));
    let items = engine.inspect_zone(Zone::Create);
    let hub = find(&items, "unity_hub");
    assert_eq!(hub.presence, EnvironmentPresence::Detected);
    assert_eq!(hub.facts["via"], "registry");

    // A DisplayIcon naming a non-existent file is no hit: the probe
    // falls through to the honest not_detected, never a guessed path.
    let engine = icon("C:\\synthetic-absent\\Unity Hub.exe,0".to_owned());
    let items = engine.inspect_zone(Zone::Create);
    let hub = find(&items, "unity_hub");
    assert_eq!(hub.presence, EnvironmentPresence::NotDetected);
    assert_eq!(hub.error_code, None);

    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_adp_003_vpm_capability_embedded_library_is_always_detected() {
    let base = unique_dir("vpm");

    // The embedded vrc-get-vpm library is a compile-time fact: detected
    // with the pinned version even when the standalone CLI probe fails
    // outright (独立 CLI 从非前置 — user ruling 2026-09-20).
    let runner = Arc::new(FakeProcessRunner::new());
    runner.push(Err("binary absent".into()));
    let engine = engine_with(synthetic_roots(&base), runner);
    let items = engine.inspect_zone(Zone::Create);
    let vpm = find(&items, "vpm");
    assert_eq!(vpm.presence, EnvironmentPresence::Detected);
    assert_eq!(vpm.error_code, None);
    assert_eq!(vpm.facts["embedded"]["library"], "vrc-get-vpm");
    assert_eq!(
        vpm.facts["embedded"]["version"],
        vua_orchestrator::EMBEDDED_VRC_GET_VPM_VERSION
    );
    assert_eq!(vpm.facts["standaloneCli"]["state"], "not_detected");

    // A working standalone CLI rides in facts only.
    let runner = Arc::new(FakeProcessRunner::new());
    runner.push(Ok(ProcessOutcome {
        exit_code: Some(0),
        timed_out: false,
        cancelled: false,
        process_tree_clean: true,
        stdout: "vrc-get 1.9.2\n".into(),
        stderr: String::new(),
        truncated: false,
    }));
    let engine = engine_with(synthetic_roots(&base), runner);
    let items = engine.inspect_zone(Zone::Create);
    let vpm = find(&items, "vpm");
    assert_eq!(vpm.presence, EnvironmentPresence::Detected);
    assert_eq!(vpm.facts["standaloneCli"]["state"], "detected");
    assert_eq!(vpm.facts["standaloneCli"]["version"], "vrc-get 1.9.2");

    // Timed-out CLI probe: the capability stays detected and the probe
    // failure is recorded informationally, without an item error code.
    let runner = Arc::new(FakeProcessRunner::new());
    runner.push(Ok(ProcessOutcome {
        exit_code: None,
        timed_out: true,
        cancelled: false,
        process_tree_clean: true,
        stdout: String::new(),
        stderr: String::new(),
        truncated: false,
    }));
    let engine = engine_with(synthetic_roots(&base), runner);
    let items = engine.inspect_zone(Zone::Create);
    let vpm = find(&items, "vpm");
    assert_eq!(vpm.presence, EnvironmentPresence::Detected);
    assert_eq!(vpm.error_code, None);
    assert_eq!(vpm.facts["standaloneCli"]["state"], "detection_failed");

    // Non-zero exit: the optional CLI is simply absent, the capability
    // is not downgraded.
    let runner = Arc::new(FakeProcessRunner::new());
    runner.push(Ok(outcome_with_exit(1, "")));
    let engine = engine_with(synthetic_roots(&base), runner);
    let items = engine.inspect_zone(Zone::Create);
    let vpm = find(&items, "vpm");
    assert_eq!(vpm.presence, EnvironmentPresence::Detected);
    assert_eq!(vpm.facts["standaloneCli"]["state"], "not_detected");
    assert_eq!(vpm.facts["standaloneCli"]["exitCode"], 1);

    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

/// The embedded version fact is only honest if it cannot drift from the
/// real dependency: parse the workspace `Cargo.lock` and compare.
#[test]
fn orc_adp_003_embedded_vrc_get_vpm_version_matches_the_cargo_lock_pin() {
    let lock = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("Cargo.lock");
    let text = fs::read_to_string(lock).unwrap();
    let marker = "name = \"vrc-get-vpm\"";
    let position = text.find(marker).expect("vrc-get-vpm pinned in Cargo.lock");
    let version_line = text[position..]
        .lines()
        .nth(1)
        .expect("version line follows the name line");
    let pinned = version_line
        .trim()
        .strip_prefix("version = \"")
        .and_then(|rest| rest.strip_suffix('"'))
        .expect("Cargo.lock version line parses");
    assert_eq!(pinned, vua_orchestrator::EMBEDDED_VRC_GET_VPM_VERSION);
}

#[test]
fn orc_env_vcc_capability_is_a_create_zone_item() {
    // Found capability → Detected; the reader's values render into facts
    // (the real reader runs in the project-manager integration suite).
    let base = unique_dir("vcc-item");
    let engine = engine_with_vcc(
        synthetic_roots(&base),
        default_runner(),
        vcc_reader(ManagerPresence::Found, None, Vec::new()),
    );
    let items = engine.inspect_zone(Zone::Create);
    let vcc = find(&items, "vcc");
    assert_eq!(vcc.presence, EnvironmentPresence::Detected);
    assert_eq!(vcc.facts["projectsSource"], "userProjects");
    assert_eq!(vcc.facts["registeredProjects"], 1);
    assert_eq!(vcc.error_code, None);

    // Missing settings → deterministic not_detected, no error code.
    let base2 = unique_dir("vcc-item-missing");
    let engine = engine_with(synthetic_roots(&base2), default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let vcc = find(&items, "vcc");
    assert_eq!(vcc.presence, EnvironmentPresence::NotDetected);
    assert_eq!(vcc.error_code, None);

    // ReadFailed → detection failure with the stable code, and the
    // adapter diagnostics render into the facts.
    let engine = engine_with_vcc(
        synthetic_roots(&base),
        default_runner(),
        vcc_reader(
            ManagerPresence::ReadFailed,
            Some(env_managers_codes::VCC_SETTINGS_READ_FAILED),
            vec![ManagerDiagnostic {
                code: env_managers_codes::VCC_SETTINGS_READ_FAILED,
                severity: FindingSeverity::Error,
                detail: "synthetic read failure".into(),
            }],
        ),
    );
    let items = engine.inspect_zone(Zone::Create);
    let vcc = find(&items, "vcc");
    assert_eq!(vcc.presence, EnvironmentPresence::DetectionFailed);
    assert_eq!(
        vcc.error_code.as_deref(),
        Some(env_managers_codes::VCC_SETTINGS_READ_FAILED)
    );
    assert_eq!(
        vcc.facts["diagnostics"][0]["code"],
        env_managers_codes::VCC_SETTINGS_READ_FAILED
    );
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
    if base2.exists() {
        fs::remove_dir_all(&base2).unwrap();
    }
}

#[cfg(windows)]
#[test]
fn orc_env_disk_space_reads_real_free_bytes_via_kernel32() {
    let base = unique_dir("disk");
    fs::create_dir_all(&base).unwrap();
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let disk = find(&items, "disk_space");
    assert_eq!(disk.presence, EnvironmentPresence::Detected);
    // Per-zone reporting: the play zone carries the same stable id too
    // (assignment 2026-09-11 lists disk under play AND create).
    let play_items = engine.inspect_zone(Zone::Play);
    let play_disk = find(&play_items, "disk_space");
    assert_eq!(play_disk.presence, EnvironmentPresence::Detected);
    let free = disk.facts["freeBytes"].as_u64().expect("freeBytes fact");
    assert!(free > 0, "a normal machine has free space: {free}");
    assert!(disk.facts["totalBytes"].as_u64().unwrap() >= free);
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[cfg(not(windows))]
#[test]
fn orc_env_disk_space_reports_unsupported_platform_honestly() {
    let base = unique_dir("disk");
    fs::create_dir_all(&base).unwrap();
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let disk = find(&items, "disk_space");
    assert_eq!(disk.presence, EnvironmentPresence::DetectionFailed);
    let play_items = engine.inspect_zone(Zone::Play);
    let play_disk = find(&play_items, "disk_space");
    assert_eq!(play_disk.presence, EnvironmentPresence::DetectionFailed);
    assert_eq!(
        disk.error_code.as_deref(),
        Some(env_error_codes::UNSUPPORTED_PLATFORM)
    );
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_ipc_002_full_snapshot_has_all_checks_with_stable_ids_and_zones() {
    let base = unique_dir("all");
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let snapshot = engine.inspect_all();
    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.captured_at, "2026-08-30T09:00:00.000Z");

    // Single expectation table (push-review r3b N-3): id order AND zone
    // pairing live in this one list, so adding or removing a check edits
    // exactly one place — the previous ids-assertion + index-range pairing
    // (`expected_play = index <= 12`) silently desynced whenever the check
    // set changed. disk_space reports per zone (assignment 2026-09-11
    // lists disk under play AND create; same stable id at both tails).
    let expected: [(&str, Zone); 23] = [
        ("steam", Zone::Play),
        ("vrchat", Zone::Play),
        ("steamvr", Zone::Play),
        ("openxr_runtime", Zone::Play),
        ("oculus_runtime", Zone::Play),
        ("pico_runtime", Zone::Play),
        ("vive_runtime", Zone::Play),
        ("virtual_desktop", Zone::Play),
        ("alvr", Zone::Play),
        ("psvr2", Zone::Play),
        ("bigscreen_beyond", Zone::Play),
        ("pimax_runtime", Zone::Play),
        ("varjo_runtime", Zone::Play),
        ("hp_omnicept", Zone::Play),
        ("network", Zone::Play),
        ("windows", Zone::Play),
        ("gpu", Zone::Play),
        ("disk_space", Zone::Play),
        ("unity_hub", Zone::Create),
        ("unity_editors", Zone::Create),
        ("vpm", Zone::Create),
        ("vcc", Zone::Create),
        ("disk_space", Zone::Create),
    ];
    assert_eq!(
        snapshot.items.len(),
        expected.len(),
        "snapshot must contain exactly the checks in the expectation table"
    );
    for (item, (id, zone)) in snapshot.items.iter().zip(expected) {
        assert_eq!(item.schema_version, 1);
        assert_eq!(item.id, id, "check ids/order must match the table");
        assert_eq!(item.zone, zone, "{id} must sit in the right zone");
        // The detector carries no severity: every error_code rides on an
        // explicit detection failure only.
        assert_eq!(
            item.error_code.is_some(),
            item.presence == EnvironmentPresence::DetectionFailed,
            "{id}: codes belong to failed observations only"
        );
    }
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

#[test]
fn orc_wf_001_inspection_writes_nothing_to_the_observed_roots() {
    let base = unique_dir("readonly");
    let exe = base.join("steam/steamapps/common/VRChat/VRChat.exe");
    fs::create_dir_all(exe.parent().unwrap()).unwrap();
    fs::write(&exe, "binary").unwrap();
    fs::create_dir_all(base.join("steam/steamapps/common/SteamVR")).unwrap();
    fs::create_dir_all(base.join("editors/2022.3.22f1/Editor")).unwrap();
    fs::create_dir_all(base.join("hub")).unwrap();
    fs::write(base.join("hub/Unity Hub.exe"), "hub").unwrap();
    let settings_path = base.join("vcc/settings.json");
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    fs::write(&settings_path, "{}").unwrap();

    let fingerprint_before = tree_fingerprint(&base);
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let _ = engine.inspect_all();
    let fingerprint_after = tree_fingerprint(&base);
    assert_eq!(
        fingerprint_before, fingerprint_after,
        "inspect must be strictly read-only (ORC-WF-001)"
    );
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
}

fn tree_fingerprint(root: &Path) -> Vec<(String, u64)> {
    let mut entries: Vec<(String, u64)> = Vec::new();
    fn walk(root: &Path, prefix: &Path, entries: &mut Vec<(String, u64)>) {
        for entry in fs::read_dir(root.join(prefix)).unwrap().flatten() {
            let relative = prefix.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                walk(root, &relative, entries);
            } else {
                let size = entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
                entries.push((relative.to_string_lossy().into_owned(), size));
            }
        }
    }
    walk(root, Path::new(""), &mut entries);
    entries.sort();
    entries
}

// --- manual smoke against this machine (E-ENV acceptance) ---

// Moved to the project-manager suite with the VCC settings reader
// (proposal 004):
//   cargo test -p vua-project-manager --test environment_engine manual_real -- --ignored --nocapture

#[test]
fn installed_unity_editors_fact_source_mirrors_the_check_tri_state() {
    // Detected: complete-version editor dirs, newest first, junk ignored.
    let base = unique_dir("fact-source");
    let editors_root = base.join("editors");
    for version in ["2019.4.31f1", "2022.3.22f1", "not-a-version", "999.9"] {
        fs::create_dir_all(editors_root.join(version).join("Editor")).unwrap();
    }
    match installed_unity_editors(&editors_root) {
        EditorInstallObservation::Detected(editors) => {
            assert_eq!(editors.len(), 2, "junk names are ignored");
            assert_eq!(editors[0].parsed.display, "2022.3.22f1", "newest first");
            assert_eq!(editors[1].parsed.display, "2019.4.31f1");
            assert!(editors[0].path.join("Editor").is_dir());
        }
        other => panic!("expected Detected, got {other:?}"),
    }

    // NotDetected: a missing root and an empty root are both findings.
    assert_eq!(
        installed_unity_editors(&base.join("missing")),
        EditorInstallObservation::NotDetected
    );
    let empty_root = base.join("empty-editors");
    fs::create_dir_all(&empty_root).unwrap();
    assert_eq!(
        installed_unity_editors(&empty_root),
        EditorInstallObservation::NotDetected
    );

    // DetectionFailed: the root is a file — the observation itself failed.
    let base2 = unique_dir("fact-source-file");
    fs::create_dir_all(&base2).unwrap();
    fs::write(base2.join("editors"), "not a dir").unwrap();
    match installed_unity_editors(&base2.join("editors")) {
        EditorInstallObservation::DetectionFailed { .. } => {}
        other => panic!("expected DetectionFailed, got {other:?}"),
    }

    // Agreement with the check face: the check's tri-state and editor list
    // ride on the same observation (one fact source, two consumers).
    let engine = engine_with(synthetic_roots(&base), default_runner());
    let items = engine.inspect_zone(Zone::Create);
    let check = find(&items, "unity_editors");
    assert_eq!(check.presence, EnvironmentPresence::Detected);
    assert_eq!(check.facts["editors"].as_array().unwrap().len(), 2);

    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
    if base2.exists() {
        fs::remove_dir_all(&base2).unwrap();
    }
}

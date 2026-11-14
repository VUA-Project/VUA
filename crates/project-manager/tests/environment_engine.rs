//! Proposal 004 split integration: the core `EnvironmentEngine` consumes
//! this crate's `VccSettingsFileReader` through the `VccSettingsReader`
//! port. These tests keep the original synthetic-tree `check_vcc`
//! assertions (engine + real reader together); the core suite covers the
//! engine-side presence mapping against a fake port.

#![allow(clippy::result_large_err)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use vua_orchestrator::{
    EnvironmentEngine, EnvironmentPresence, EnvironmentRoots, FakeProcessRunner,
    FakeRegistrySource, FixedClock, StdProcessRunner, SystemClock, VrRuntimeRoots, Zone,
};
use vua_project_manager::VccSettingsFileReader;

fn unique_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("vua-pm-env-engine-{label}-{nanos}"))
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
        network_probes: vec![],
        registry: Arc::new(FakeRegistrySource::new()),
        steam_install_candidates: vec![base.join("steam")],
        vr_runtime_roots: VrRuntimeRoots {
            oculus: vec![],
            pico: vec![],
            vive: vec![],
            virtual_desktop: vec![],
            alvr: vec![],
            pimax: vec![],
            varjo: vec![],
            hp_omnicept: vec![],
        },
        openvrpaths: vec![],
        vcc_settings_candidates: vec![base.join("vcc/settings.json")],
        pico_connect_settings_candidates: vec![],
        vcc_exe_candidates: vec![],
        alcom_exe_candidates: vec![],
    }
}

fn engine_with(roots: EnvironmentRoots) -> EnvironmentEngine {
    EnvironmentEngine::new(
        Arc::new(FakeProcessRunner::new()),
        Arc::new(FixedClock::new(&["2026-09-07T02:00:00.000Z"])),
        roots,
        Arc::new(VccSettingsFileReader),
    )
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

fn install_vpm_project(base: &Path, name: &str, editor_version: &str) -> String {
    let project = base.join("projects").join(name);
    fs::create_dir_all(project.join("Packages")).unwrap();
    fs::create_dir_all(project.join("ProjectSettings")).unwrap();
    fs::write(project.join("Packages").join("vpm-manifest.json"), "{}").unwrap();
    fs::write(
        project.join("ProjectSettings").join("ProjectVersion.txt"),
        format!("m_EditorVersion: {editor_version}\n"),
    )
    .unwrap();
    project.to_string_lossy().into_owned()
}

#[test]
fn engine_and_vcc_settings_reader_produce_the_vcc_create_zone_item() {
    let base = unique_dir("vcc-item");
    let production = install_vpm_project(&base, "prod-av", "2022.3.22f1");
    let settings_path = base.join("vcc/settings.json");
    fs::create_dir_all(settings_path.parent().unwrap()).unwrap();
    fs::write(
        &settings_path,
        serde_json::json!({ "userProjects": [production] }).to_string(),
    )
    .unwrap();
    let engine = engine_with(synthetic_roots(&base));
    let items = engine.inspect_zone(Zone::Create);
    let vcc = find(&items, "vcc");
    assert_eq!(vcc.presence, EnvironmentPresence::Detected);
    assert_eq!(vcc.facts["projectsSource"], "userProjects");
    assert_eq!(vcc.facts["registeredProjects"], 1);
    assert_eq!(vcc.error_code, None);

    // Missing settings → deterministic not_detected.
    let base2 = unique_dir("vcc-item-missing");
    let engine = engine_with(synthetic_roots(&base2));
    let items = engine.inspect_zone(Zone::Create);
    assert_eq!(
        find(&items, "vcc").presence,
        EnvironmentPresence::NotDetected
    );

    // Unparseable settings → detection failure with the stable code.
    fs::write(&settings_path, "{ not json").unwrap();
    let engine = engine_with(synthetic_roots(&base));
    let items = engine.inspect_zone(Zone::Create);
    let vcc = find(&items, "vcc");
    assert_eq!(vcc.presence, EnvironmentPresence::DetectionFailed);
    assert!(vcc.error_code.is_some());
    if base.exists() {
        fs::remove_dir_all(&base).unwrap();
    }
    if base2.exists() {
        fs::remove_dir_all(&base2).unwrap();
    }
}

/// Manual real-machine smoke moved from the core suite with the reader
/// (proposal 004): prints the default-root snapshot of THIS machine so a
/// human can compare each finding against reality. Never runs in CI:
///
///   cargo test -p vua-project-manager --test environment_engine manual_real -- --ignored --nocapture
#[test]
#[ignore = "manual acceptance only: compares findings against this real machine"]
fn manual_real_machine_environment_snapshot() {
    let engine = EnvironmentEngine::new(
        Arc::new(StdProcessRunner),
        Arc::new(SystemClock),
        EnvironmentRoots::default(),
        Arc::new(VccSettingsFileReader),
    );
    let snapshot = engine.inspect_all();
    for item in &snapshot.items {
        println!(
            "[{:>14}] {} — {}{}",
            format!("{:?}", item.presence).to_uppercase(),
            item.id,
            item.facts,
            item.error_code
                .as_ref()
                .map(|code| format!(" (code: {code})"))
                .unwrap_or_default(),
        );
    }
}

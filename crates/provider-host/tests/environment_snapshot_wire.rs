//! Environment snapshot wire tests (BG-16 wiring): the
//! `environment.getSnapshot` handler consumes the real detection engine
//! (`EnvironmentEngine::inspect_all()`) over synthetic roots — the items
//! ARE the frozen check vocabulary (checkId/zone/presence/errorCode/facts),
//! and without the environment configuration the snapshot answers the
//! honest empty items list (never a fabricated probe result).

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{json, Value};
use vua_orchestrator::{EnvironmentRoots, FakeRegistrySource};
use vua_provider_host::{run_provider_host_full, EnvironmentConfig};

fn unique_root(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vua-env-snapshot-{label}-{}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("root creates");
    dir
}

/// Synthetic probe targets (mirrors the orchestrator environment-suite
/// synthetic tree): nothing real is probed, every absence is a normal
/// finding, and the fake editors root carries one complete install.
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

fn run_snapshot(database: &Path, environment: Option<EnvironmentConfig>) -> Value {
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-env",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-env",
            "correlationId": "corr-env",
            "kind": "query",
            "method": "environment.getSnapshot",
            "params": {},
        },
    });
    let mut output = Vec::new();
    run_provider_host_full(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        database,
        None,
        None,
        None,
        None,
        None,
        environment,
        None,
        None,
    )
    .expect("frame loop runs");
    let frames: Vec<Value> = String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect();
    // The frozen snapshot document travels inside the response value.
    frames[0]["payload"]["value"].clone()
}

fn deployment_frame(base: &Path, enabled: bool, payload: Value) -> Value {
    let mut output = Vec::new();
    let frame =
        json!({"frameVersion":"0.1","frameId":"deployment","kind":"request","payload":payload});
    run_provider_host_full(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        base.join("deploy.sqlite"),
        None,
        None,
        None,
        None,
        None,
        enabled.then(|| EnvironmentConfig {
            roots: synthetic_roots(base),
            vcc_settings_candidates: Vec::new(),
        }),
        None,
        None,
    )
    .unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str::<Value>(l).unwrap())
        .find(|f| f["kind"] == "response")
        .unwrap()["payload"]
        .clone()
}

#[test]
fn deployment_plan_is_an_actual_missing_prerequisite_plan_or_explicitly_unavailable() {
    let request = json!({"contractVersion":"0.1","requestId":"plan","correlationId":"corr-test","kind":"query","method":"environment.planDeployment",
        "params":{"intent":{"purposes":["desktop_play"],"editorRoot":"C:\\VUA Test\\Editors"}}});
    let base = unique_root("deployment-disabled");
    let disabled = deployment_frame(&base, false, request.clone());
    assert_eq!(disabled["error"]["code"], "vua.deployment.unavailable");
    std::fs::remove_dir_all(base).unwrap();
    let base = unique_root("deployment-plan");
    let response = deployment_frame(&base, true, request);
    assert_eq!(response["ok"], true);
    let plan = &response["value"]["deploymentPlan"];
    assert_eq!(plan["schemaVersion"], "vua.environment-deployment/v0.1");
    assert_eq!(plan["steps"].as_array().unwrap().len(), 2);
    assert_eq!(plan["steps"][0]["component"], "steam");
    assert_eq!(plan["steps"][0]["action"], "install_steam");
    assert_eq!(plan["steps"][1]["component"], "vrchat");
    assert_eq!(plan["steps"][1]["action"], "manual_install");
    assert_eq!(plan["prerequisitesReady"], false);
    std::fs::remove_dir_all(base).unwrap();
}

#[test]
fn deployment_provider_refuses_wrong_kind_unknown_fields_and_malformed_consent() {
    for (index, params) in [
        json!({"intent":{"purposes":["pc_avatar"],"editorRoot":"C:\\Editors"},"confirmedDigest":"x"}),
        json!({"intent":{"purposes":["pc_avatar"],"editorRoot":"C:\\Editors"},"confirmedDigest":"a".repeat(64),"executable":"cmd.exe"}),
    ].into_iter().enumerate() {
        let base = unique_root(&format!("deployment-refused-{index}"));
        let response = deployment_frame(&base, true, json!({"contractVersion":"0.1","requestId":"execute","correlationId":"corr-test", "kind":"query",
            "method":"environment.executeDeployment","commandId":"command-1","params":params}));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["category"], "validation");
        let store = vua_orchestrator::SqliteTaskStore::open(base.join("deploy.sqlite")).unwrap();
        assert!(store.tasks().unwrap().is_empty()); drop(store);
        std::fs::remove_dir_all(base).unwrap();
    }
}

#[test]
fn environment_snapshot_consumes_the_real_detection_engine() {
    let base = unique_root("synthetic");
    let roots = synthetic_roots(&base);
    // One complete editor install under the synthetic editors root.
    std::fs::create_dir_all(roots.unity_editors_root.join("2022.3.22f1").join("Editor"))
        .expect("fake editor layout");

    let database = base.join("tasks.sqlite");
    let payload = run_snapshot(
        &database,
        Some(EnvironmentConfig {
            roots,
            vcc_settings_candidates: vec![base.join("vcc/settings.json")],
        }),
    );

    // The envelope keeps the application-contract face the desktop
    // consumes (contractVersion/revision/capturedAt/items).
    assert_eq!(payload["contractVersion"], "0.1");
    assert!(payload["revision"].is_u64());
    assert!(payload["capturedAt"].is_string());

    // The items ARE the engine output: both zones ran, every item carries
    // the frozen check vocabulary, and the synthetic editor install is
    // honestly detected.
    let items = payload["items"].as_array().expect("items array");
    assert!(!items.is_empty(), "synthetic roots must produce findings");
    for item in items {
        // The engine's own serde shape (EnvironmentCheckItemV1): each
        // item carries its schemaVersion, the stable check id under the
        // frozen wire name `checkId` (application-contract v0.1 protocol
        // §环境快照语义 + TS face; BOARD #36 defect ③ authority ruling),
        // the zone, the presence enum, and the engineering facts object.
        assert!(item["checkId"].is_string(), "checkId: {item}");
        assert!(item["zone"].is_string(), "zone: {item}");
        assert!(item["presence"].is_string(), "presence: {item}");
        assert!(item["facts"].is_object(), "facts: {item}");
    }
    let ids: Vec<&str> = items
        .iter()
        .map(|item| item["checkId"].as_str().expect("checkId"))
        .collect();
    assert!(ids.contains(&"unity_editors"), "editors check ran: {ids:?}");
    assert!(ids.contains(&"steam"), "steam check ran: {ids:?}");
    assert!(ids.contains(&"network"), "network check ran: {ids:?}");
    assert!(ids.contains(&"disk_space"), "disk check ran: {ids:?}");
    let editors = items
        .iter()
        .find(|item| item["checkId"] == "unity_editors")
        .expect("unity_editors item");
    assert_eq!(editors["presence"], "detected");
}

#[test]
fn environment_snapshot_without_wiring_is_the_honest_empty() {
    let root = unique_root("unwired");
    let database = root.join("tasks.sqlite");

    // Without the environment configuration the detection face is not
    // wired: the empty items list is the honest empty (frozen by the B6
    // spike — an empty list is never a ready verdict), never a fabricated
    // probe result.
    let payload = run_snapshot(&database, None);
    assert_eq!(payload["contractVersion"], "0.1");
    assert_eq!(payload["items"], json!([]));
    assert!(payload["capturedAt"].is_string());
}

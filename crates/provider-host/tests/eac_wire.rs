//! Wire validation tests for `environment.inspectEac`,
//! `environment.configureEacExperimental`, `environment.terminateEacResidual`, and
//! `environment.launchEacRepair`.

use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::{fs, io::Cursor};
use vua_orchestrator::Clock;
use vua_project_manager::eac_allowlist::AllowlistEntryV01;
use vua_project_manager::eac_install::{
    EacBinaryState, EacFolderState, EacInstallObservation, EacInstallStateV02, InstallSource,
};
use vua_project_manager::eac_logs::{EacLogFinding, LogSource};
use vua_project_manager::eac_probe::v02::{
    CandidateSignatureVerifier, EacLastRepairV02, EacProbeService, EacRepairOutcome,
    EacRepairReceiptV02, EacServiceDeps, ProcessEntryV02, ProcessSnapshotSourceV02,
    ProcessTerminator, RepairLauncher, SteamRunningSource, WindowVisibilitySource,
};
use vua_project_manager::eac_service::{
    EacServiceName, EacServiceState, RawServiceObservation, ServiceStatusSource,
};
use vua_project_manager::eac_terminate::{PreCheck, TerminationReceiptV01};
use vua_project_manager::ProcessSnapshotSource;
use vua_provider_host::eac_routes::invoke_wire;

static ROOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn invoke_stdio(request: Value) -> Value {
    let root = std::env::temp_dir().join(format!(
        "vua-eac-wire-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed),
    ));
    fs::create_dir_all(&root).unwrap();
    let frame =
        json!({"frameVersion":"0.1", "frameId":"frame", "kind":"request", "payload":request});
    let mut output = Vec::new();
    vua_provider_host::run_provider_host_full(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        root.join("tasks.sqlite"),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .unwrap();
    let _ = fs::remove_dir_all(&root);
    let response: Value =
        serde_json::from_str(String::from_utf8(output).unwrap().lines().next().unwrap()).unwrap();
    response["payload"].clone()
}

struct SharedProcesses(Arc<Mutex<Vec<ProcessEntryV02>>>);
impl ProcessSnapshotSourceV02 for SharedProcesses {
    fn snapshot_v02(&self) -> Result<Vec<ProcessEntryV02>, String> {
        Ok(self.0.lock().unwrap().clone())
    }
}

struct EmptyWindows;
impl WindowVisibilitySource for EmptyWindows {
    fn visible_window_pids(&self) -> Result<HashSet<u32>, String> {
        Ok(HashSet::new())
    }
}

struct CleanServices;
impl ServiceStatusSource for CleanServices {
    fn query_services(&self) -> Result<[RawServiceObservation; 2], String> {
        Ok([
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
        ])
    }
}

struct IdleSteam;
impl SteamRunningSource for IdleSteam {
    fn running_flag(&self) -> Result<Option<u8>, String> {
        Ok(Some(0))
    }
}

struct SyntheticInstall;
impl InstallSource for SyntheticInstall {
    fn inspect_install(
        &self,
        _eos_service_present: bool,
        _eos_service_binary: Option<&Path>,
    ) -> Result<EacInstallObservation, String> {
        Ok(EacInstallObservation {
            vrchat_dir: Some(PathBuf::from(r"D:\SteamLibrary\steamapps\common\VRChat")),
            install: EacInstallStateV02 {
                eac_folder: EacFolderState::Present,
                setup_signature: EacBinaryState::Verified,
                service_binary: EacBinaryState::Verified,
            },
        })
    }
}

struct EmptyLogs;
impl LogSource for EmptyLogs {
    fn read_recent_findings(&self) -> Result<Vec<EacLogFinding>, String> {
        Ok(Vec::new())
    }
}

struct SyntheticVerifier(bool);
impl CandidateSignatureVerifier for SyntheticVerifier {
    fn is_trusted_eac_binary(&self, _path: &Path) -> bool {
        self.0
    }
}

struct SyntheticClock;
impl Clock for SyntheticClock {
    fn now_rfc3339(&self) -> String {
        "2026-11-14T10:30:00.000Z".to_owned()
    }
}

struct SyntheticTerminator(Arc<Mutex<Vec<ProcessEntryV02>>>);
impl ProcessTerminator for SyntheticTerminator {
    fn terminate(
        &self,
        pid: u32,
        entry: &AllowlistEntryV01,
        _source: &dyn ProcessSnapshotSource,
        task_correlation: &str,
        clock: &dyn Clock,
    ) -> TerminationReceiptV01 {
        self.0.lock().unwrap().retain(|p| p.pid != pid);
        TerminationReceiptV01::terminated_step(
            pid,
            &entry.process_name,
            task_correlation,
            PreCheck {
                vrchat_session_active: false,
                eac_present: true,
            },
            clock.now_rfc3339(),
        )
    }
}

struct SyntheticRepairLauncher(Arc<AtomicUsize>);
impl RepairLauncher for SyntheticRepairLauncher {
    fn launch_official_repair(
        &self,
        _vrchat_dir: &Path,
        _clock: Arc<dyn Clock>,
        _last_repair: Arc<Mutex<Option<EacLastRepairV02>>>,
    ) -> EacRepairReceiptV02 {
        self.0.fetch_add(1, Ordering::SeqCst);
        EacRepairReceiptV02::new(EacRepairOutcome::Completed, Some(0))
    }
}

fn build_synthetic_service(
    initial_processes: Vec<ProcessEntryV02>,
    trusted_sig: bool,
) -> (
    EacProbeService,
    Arc<Mutex<Vec<ProcessEntryV02>>>,
    Arc<AtomicUsize>,
) {
    let table = Arc::new(Mutex::new(initial_processes));
    let repair_calls = Arc::new(AtomicUsize::new(0));
    let service = EacProbeService::with_deps(EacServiceDeps {
        processes: Arc::new(SharedProcesses(table.clone())),
        windows: Arc::new(EmptyWindows),
        services: Arc::new(CleanServices),
        steam: Arc::new(IdleSteam),
        install: Arc::new(SyntheticInstall),
        logs: Arc::new(EmptyLogs),
        signature_verifier: Arc::new(SyntheticVerifier(trusted_sig)),
        terminator: Arc::new(SyntheticTerminator(table.clone())),
        repair_launcher: Arc::new(SyntheticRepairLauncher(repair_calls.clone())),
        clock: Arc::new(SyntheticClock),
    });
    (service, table, repair_calls)
}

#[test]
fn inspect_eac_validates_envelope_and_reports_unavailable_without_environment() {
    let valid = json!({
        "contractVersion": "0.1",
        "requestId": "req-1",
        "correlationId": "corr-1",
        "kind": "query",
        "method": "environment.inspectEac",
        "params": { "schemaVersion": "0.2" }
    });
    let res = invoke_stdio(valid.clone());
    assert_eq!(res["ok"], false);
    assert_eq!(res["error"]["code"], "vua.eac_probe.unavailable");

    for invalid_override in [
        json!({ "params": { "schemaVersion": "0.1" } }),
        json!({ "params": { "schemaVersion": "0.2", "path": "C:/VRChat" } }),
        json!({ "kind": "command" }),
        json!({ "commandId": "unexpected" }),
    ] {
        let mut req = valid.clone();
        for (k, v) in invalid_override.as_object().unwrap() {
            req[k] = v.clone();
        }
        let err = invoke_stdio(req);
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"]["code"], "vua.eac_probe.invalid_params");
    }
}

#[test]
fn terminate_residual_enforces_experimental_gate_r4_active_session_and_r3_reverification() {
    let launcher_path = r"D:\SteamLibrary\steamapps\common\VRChat\start_protected_game.exe";
    let (service, table, _) = build_synthetic_service(
        vec![ProcessEntryV02 {
            image_name: "start_protected_game.exe".to_owned(),
            pid: 5120,
            created: Some(134392000090000000),
            path: Some(launcher_path.to_owned()),
        }],
        true,
    );

    let inspect_req = json!({
        "contractVersion": "0.1",
        "requestId": "req-i1",
        "correlationId": "corr-i1",
        "kind": "query",
        "method": "environment.inspectEac",
        "params": { "schemaVersion": "0.2" }
    });
    let initial = invoke_wire(Some(&service), &inspect_req);
    assert_eq!(initial["ok"], true);
    assert_eq!(
        initial["value"]["eacSnapshot"]["conclusion"],
        "residual_process"
    );
    assert_eq!(
        initial["value"]["eacSnapshot"]["terminationCapability"]["state"],
        "disabled"
    );
    assert_eq!(
        initial["value"]["eacSnapshot"]["terminationCapability"]["reason"],
        "experimental_switch_disabled"
    );

    let terminate_req = json!({
        "contractVersion": "0.1",
        "requestId": "req-t1",
        "correlationId": "corr-t1",
        "kind": "command",
        "method": "environment.terminateEacResidual",
        "commandId": "cmd-eac-t1",
        "params": {
            "schemaVersion": "0.2",
            "pid": 5120,
            "created": "134392000090000000",
            "path": launcher_path,
            "confirmed": true
        }
    });

    // 1. Rejected when experimental switch is off.
    let disabled_res = invoke_wire(Some(&service), &terminate_req);
    assert_eq!(disabled_res["ok"], false);
    assert_eq!(
        disabled_res["error"]["code"],
        "vua.eac_terminate.experimental_disabled"
    );

    // 2. Invalid param envelopes rejected before reaching the terminator.
    let mut unconfirmed = terminate_req.clone();
    unconfirmed["params"]["confirmed"] = json!(false);
    assert_eq!(
        invoke_wire(Some(&service), &unconfirmed)["error"]["code"],
        "vua.eac_terminate.invalid_params"
    );

    // 3. Enable experimental switch via configureEacExperimental.
    let enable_res = invoke_wire(
        Some(&service),
        &json!({
            "contractVersion": "0.1",
            "requestId": "req-cfg",
            "correlationId": "corr-cfg",
            "kind": "command",
            "method": "environment.configureEacExperimental",
            "commandId": "cmd-cfg-1",
            "params": { "enabled": true }
        }),
    );
    assert_eq!(enable_res["ok"], true);
    assert_eq!(enable_res["value"]["enabled"], true);

    // 4. R4: adding a windowless VRChat.exe causes active_vrchat_session refusal.
    table.lock().unwrap().push(ProcessEntryV02 {
        image_name: "VRChat.exe".to_owned(),
        pid: 9001,
        created: Some(134392000090000111),
        path: Some(r"D:\SteamLibrary\steamapps\common\VRChat\VRChat.exe".to_owned()),
    });
    let r4_res = invoke_wire(Some(&service), &terminate_req);
    assert_eq!(r4_res["ok"], true);
    assert_eq!(r4_res["value"]["termination"]["kind"], "refused");
    assert_eq!(
        r4_res["value"]["termination"]["guard"],
        "active_vrchat_session"
    );

    // Remove VRChat.exe; test PID-reuse / created-ticks mismatch refusal.
    table.lock().unwrap().retain(|p| p.pid != 9001);
    let mut wrong_ticks = terminate_req.clone();
    wrong_ticks["params"]["created"] = json!("999999999");
    let ticks_res = invoke_wire(Some(&service), &wrong_ticks);
    assert_eq!(ticks_res["ok"], true);
    assert_eq!(ticks_res["value"]["termination"]["kind"], "refused");
    assert_eq!(
        ticks_res["value"]["termination"]["guard"],
        "verification_not_verified"
    );

    // 5. Verified candidate terminates and post-snapshot transitions to ready.
    let ok_res = invoke_wire(Some(&service), &terminate_req);
    assert_eq!(ok_res["ok"], true);
    assert_eq!(ok_res["value"]["termination"]["kind"], "terminated");
    assert_eq!(ok_res["value"]["termination"]["postCheck"]["pidGone"], true);
    assert!(ok_res["value"]["termination"].get("guard").is_none());
    assert_eq!(ok_res["value"]["eacSnapshot"]["conclusion"], "ready");
}

#[test]
fn launch_eac_repair_validates_closed_params_refuses_active_session_and_validates_schema() {
    let repair_schema_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/eac-probe/v0.2/repair.schema.json");
    let repair_schema: Value =
        serde_json::from_str(&fs::read_to_string(repair_schema_path).unwrap()).unwrap();
    let repair_validator = jsonschema::validator_for(&repair_schema).unwrap();

    let probe_schema_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/eac-probe/v0.2/probe.schema.json");
    let probe_schema: Value =
        serde_json::from_str(&fs::read_to_string(probe_schema_path).unwrap()).unwrap();
    let probe_validator = jsonschema::validator_for(&probe_schema).unwrap();

    let valid_req = json!({
        "contractVersion": "0.1",
        "requestId": "req-r1",
        "correlationId": "corr-r1",
        "kind": "command",
        "method": "environment.launchEacRepair",
        "commandId": "cmd-eac-r1",
        "params": {
            "schemaVersion": "0.2",
            "confirmed": true
        }
    });

    // Without environment in stdio host -> unavailable
    let unavail = invoke_stdio(valid_req.clone());
    assert_eq!(unavail["ok"], false);
    assert_eq!(unavail["error"]["code"], "vua.eac_repair.unavailable");

    // Reject caller-supplied path/args or unconfirmed envelopes
    for invalid_params in [
        json!({ "schemaVersion": "0.2", "confirmed": false }),
        json!({ "schemaVersion": "0.1", "confirmed": true }),
        json!({ "schemaVersion": "0.2", "confirmed": true, "path": r"C:\evil.exe" }),
        json!({ "schemaVersion": "0.2", "confirmed": true, "args": ["--install"] }),
    ] {
        let mut bad = valid_req.clone();
        bad["params"] = invalid_params;
        let err = invoke_stdio(bad);
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"]["code"], "vua.eac_repair.invalid_params");
    }

    // Active VRChat session or disabled switch: first verify experimental gate rejects when disabled
    let (service, table, calls) = build_synthetic_service(
        vec![ProcessEntryV02 {
            image_name: "VRChat.exe".to_owned(),
            pid: 7777,
            created: Some(134392000090000777),
            path: Some(r"D:\SteamLibrary\steamapps\common\VRChat\VRChat.exe".to_owned()),
        }],
        true,
    );
    let disabled = invoke_wire(Some(&service), &valid_req);
    assert_eq!(disabled["ok"], false);
    assert_eq!(
        disabled["error"]["code"],
        "vua.eac_repair.experimental_disabled"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    // Enable experimental switch, then verify active VRChat session refuses official repair
    let enable_res = invoke_wire(
        Some(&service),
        &json!({
            "contractVersion": "0.1",
            "requestId": "req-cfg-r",
            "correlationId": "corr-cfg-r",
            "kind": "command",
            "method": "environment.configureEacExperimental",
            "commandId": "cmd-cfg-r1",
            "params": { "enabled": true }
        }),
    );
    assert_eq!(enable_res["ok"], true);

    let refused = invoke_wire(Some(&service), &valid_req);
    assert_eq!(refused["ok"], true);
    assert_eq!(
        refused["value"]["repair"]["outcome"],
        "active_session_refused"
    );
    assert_eq!(refused["value"]["repair"]["exitCode"], Value::Null);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(repair_validator
        .validate(&refused["value"]["repair"])
        .is_ok());
    assert!(probe_validator
        .validate(&refused["value"]["eacSnapshot"])
        .is_ok());

    // Once VRChat exits, repair runs and returns schema-valid completed receipt + refreshed snapshot
    table.lock().unwrap().clear();
    let completed = invoke_wire(Some(&service), &valid_req);
    assert_eq!(completed["ok"], true);
    assert_eq!(completed["value"]["repair"]["outcome"], "completed");
    assert_eq!(completed["value"]["repair"]["exitCode"], 0);
    assert_eq!(
        completed["value"]["eacSnapshot"]["lastRepair"]["outcome"],
        "completed"
    );
    assert_eq!(
        completed["value"]["eacSnapshot"]["lastRepair"]["exitCode"],
        0
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(repair_validator
        .validate(&completed["value"]["repair"])
        .is_ok());
    assert!(probe_validator
        .validate(&completed["value"]["eacSnapshot"])
        .is_ok());
}

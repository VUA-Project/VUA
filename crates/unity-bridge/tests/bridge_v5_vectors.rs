//! v5 is separate from frozen v1-v4. These vectors do not claim a Unity run.
use serde_json::Value;
use std::{fs, path::PathBuf};
use vua_orchestrator::{UnityCommand, UnityOperation, UnityResult};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/unity-bridge/v5")
}
fn read(file: &str) -> Value {
    serde_json::from_slice(&fs::read(root().join(file)).unwrap()).unwrap()
}

#[test]
fn candidate_bridge_schemas_refuse_legacy_ops_drift_and_false_sdk_claims() {
    for entry in fs::read_dir(root().join("examples")).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy();
        let kind = if name.ends_with(".command.json") {
            "command"
        } else if name.ends_with(".plan.json") {
            "plan"
        } else {
            "result"
        };
        let validator = jsonschema::validator_for(&read(&format!("{kind}.schema.json"))).unwrap();
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            validator.is_valid(&value),
            name.contains(".valid."),
            "{name}"
        );
    }
}

#[test]
fn native_consumer_retains_exact_c1_facts_and_never_upgrades_sdk_checks() {
    let command: UnityCommand =
        serde_json::from_value(read("examples/assembly.valid.command.json")).unwrap();
    assert_eq!(command.operation, UnityOperation::AmfAssemble);
    assert_eq!(command.schema_version, 5);
    assert!(command.operation.is_mutating());
    let result: UnityResult =
        serde_json::from_value(read("examples/assembly.valid.result.json")).unwrap();
    assert_eq!(result.command_id, command.command_id);
    assert_eq!(result.data["editorVersion"], "2022.3.22f1c1");
    assert_eq!(result.data["officialSdkChecks"], "not_run");
    assert_eq!(result.data["instances"][0]["menuModified"], true);
}

#[test]
fn turntable_command_writes_into_the_project_and_reports_its_fixed_frame_set() {
    let command: UnityCommand =
        serde_json::from_value(read("examples/turntable.valid.command.json")).unwrap();
    assert_eq!(command.operation, UnityOperation::AmfTurntable);
    assert!(!command.dry_run);
    assert!(command.operation.is_mutating());
    let result: UnityResult =
        serde_json::from_value(read("examples/turntable.valid.result.json")).unwrap();
    assert_eq!(result.command_id, command.command_id);
    assert_eq!(result.data["turntable"]["frames"], 60);
    assert_eq!(result.data["turntable"]["size"], 512);
}

use serde_json::{json, Value};
use std::{fs, io::Cursor, path::PathBuf};
use vua_provider_host::run_provider_host;
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/scenario-environment/v0.1")
}
fn read(path: &str) -> Value {
    serde_json::from_slice(&fs::read(root().join(path)).unwrap()).unwrap()
}
#[test]
fn shared_request_and_result_schema_vectors() {
    for (schema, directory) in [
        ("request.schema.json", "examples"),
        ("result.schema.json", "results"),
    ] {
        let validator = jsonschema::validator_for(&read(schema)).unwrap();
        for file in fs::read_dir(root().join(directory)).unwrap() {
            let path = file.unwrap().path();
            let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            assert_eq!(
                validator.is_valid(&value),
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains(".valid."),
                "{}",
                path.display()
            );
        }
    }
}
#[test]
fn pure_sop_is_served_without_environment_services_and_rejections_stay_honest() {
    let cases = [
        "sop-desktop.valid.json",
        "sop-wifi.valid.json",
        "sop-invalid-connection.invalid.json",
        "sop-injection.invalid.json",
        "check-c1.valid.json",
        "check-path.invalid.json",
        "check-schema.invalid.json",
        "check-command.invalid.json",
    ];
    let mut input = String::new();
    for (index, name) in cases.iter().enumerate() {
        input.push_str(&format!("{}\n",json!({"frameVersion":"0.1","frameId":format!("scenario-{index}"),"kind":"request","payload":read(&format!("examples/{name}"))})));
    }
    let temporary = std::env::temp_dir().join(format!(
        "vua-scenario-wire-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&temporary).unwrap();
    let mut output = Vec::new();
    run_provider_host(Cursor::new(input), &mut output, temporary.join("tasks.db")).unwrap();
    let frames: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let reply = |index| {
        frames
            .iter()
            .find(|v| v["frameId"] == format!("scenario-{index}"))
            .unwrap()["payload"]
            .clone()
    };
    let validator = jsonschema::validator_for(&read("result.schema.json")).unwrap();
    for index in [0, 1] {
        assert_eq!(reply(index)["ok"], true);
        assert!(validator.is_valid(&reply(index)["value"]));
        assert_eq!(reply(index)["value"]["performed"], "sop_only");
    }
    assert_eq!(reply(4)["error"]["code"], "vua.scenario.unavailable");
    for index in [2, 3, 5, 6, 7] {
        assert_eq!(reply(index)["ok"], false);
        assert_ne!(reply(index)["error"]["code"], "vua.scenario.unavailable");
    }
    assert!(!temporary.join("amf-production").exists());
    assert!(
        temporary.starts_with(std::env::temp_dir())
            && temporary
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("vua-scenario-wire-")
    );
    fs::remove_dir_all(temporary).unwrap();
}

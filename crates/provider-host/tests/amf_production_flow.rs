//! Candidate source-first vectors consumed by the real AMF host frame loop.
use serde_json::{json, Value};
use std::{fs, io::Cursor, path::PathBuf, sync::Arc};
use vua_bdl_store::{ArtifactMode, BdlStore};
use vua_provider_host::{run_provider_host_with_services, WarehouseConfig};

fn schema_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/amf-production-flow/v0.1")
}
fn read(path: &str) -> Value {
    serde_json::from_slice(&fs::read(schema_root().join(path)).unwrap()).unwrap()
}

#[test]
fn positive_and_negative_candidate_request_vectors() {
    let validator = jsonschema::validator_for(&read("request.schema.json")).unwrap();
    for entry in fs::read_dir(schema_root().join("examples")).unwrap() {
        let path = entry.unwrap().path();
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

#[test]
fn real_wire_lists_facts_and_rejects_mutations_sent_as_queries() {
    let root = std::env::temp_dir().join(format!(
        "vua-n3-wire-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let bdl = Arc::new(BdlStore::open(root.join("bdl.db")).unwrap());
    let cases = [
        read("examples/list.valid.json"),
        read("examples/list-recipes.valid.json"),
        read("examples/invalid-kind.json"),
        read("examples/invalid-project-path.json"),
        read("examples/invalid-run-id.json"),
        read("examples/invalid-rollback-kind.json"),
        read("examples/invalid-rollback-target.json"),
        read("examples/invalid-rollback-digest.json"),
        read("examples/invalid-recipe-kind.json"),
        read("examples/invalid-recipe-path.json"),
        read("examples/invalid-recipe-body.json"),
        read("examples/invalid-share-import-kind.json"),
        read("examples/invalid-share-source-path.json"),
        read("examples/invalid-share-asset-body.json"),
        read("examples/invalid-apply-plan-kind.json"),
        read("examples/invalid-apply-digest.json"),
        read("examples/invalid-apply-cancel-command.json"),
        read("examples/invalid-apply-empty-avatar.json"),
        read("examples/invalid-preview-path.json"),
        read("examples/invalid-upload-unconfirmed.json"),
        read("examples/invalid-upload-as-query.json"),
        read("examples/invalid-upload-name.json"),
        read("examples/invalid-turntable-frame-index.json"),
        read("examples/invalid-bake-turntable-query.json"),
    ];
    let mut lines = String::new();
    for (index, case) in cases.iter().enumerate() {
        let mut payload = case.clone();
        payload["contractVersion"] = json!("0.1");
        payload["requestId"] = json!(format!("request-{index}"));
        payload["correlationId"] = json!(format!("corr-{index}"));
        if case["kind"] == "command" {
            payload["commandId"] = json!(format!("command-{index}"));
        }
        lines.push_str(&format!("{}\n", json!({"frameVersion":"0.1","frameId":format!("frame-{index}"),"kind":"request","payload":payload})));
    }
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(lines),
        &mut output,
        root.join("tasks.db"),
        None,
        None,
        Some(WarehouseConfig {
            bdl: bdl.clone(),
            warehouse_root: root.join("warehouse"),
            global_default: ArtifactMode::UseOriginalUnitypackage,
            executor: None,
            dependencies_queries: None,
        }),
        None,
    )
    .unwrap();
    let frames: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let reply = |index| {
        frames
            .iter()
            .find(|frame| frame["frameId"] == format!("frame-{index}"))
            .unwrap()["payload"]
            .clone()
    };
    assert_eq!(reply(0)["ok"], true);
    assert_eq!(reply(0)["value"]["sources"], json!([]));
    assert_eq!(reply(0)["value"]["runs"], json!([]));
    assert_eq!(reply(1)["ok"], true);
    assert_eq!(reply(1)["value"]["recipes"], json!([]));
    for index in 2..cases.len() {
        assert_eq!(reply(index)["ok"], false);
    }
    assert!(
        !root.join("amf-production/projects").exists(),
        "Rejected requests must not prepare a project"
    );
    drop(bdl);
    assert!(
        root.starts_with(std::env::temp_dir())
            && root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("vua-n3-wire-")
    );
    fs::remove_dir_all(root).unwrap();
}

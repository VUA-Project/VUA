//! Real wire route with no environment service: valid actions cannot launch anything.
use serde_json::{json, Value};
use std::{
    fs,
    io::Cursor,
    path::Path,
    sync::atomic::{AtomicU64, Ordering},
};
static SEQ: AtomicU64 = AtomicU64::new(0);
fn invoke(request: Value) -> Value {
    let root = std::env::temp_dir().join(format!(
        "vua-tool-wire-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
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
    let response: Value =
        serde_json::from_str(String::from_utf8(output).unwrap().lines().next().unwrap()).unwrap();
    assert!(root.starts_with(std::env::temp_dir()));
    fs::remove_dir_all(root).unwrap();
    response["payload"].clone()
}
#[test]
fn both_schema_faces_pin_the_shared_vectors_and_the_actual_request_gate() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/external-tool/v0.1");
    let vectors: Value =
        serde_json::from_slice(&fs::read(root.join("vectors.json")).unwrap()).unwrap();
    for (face, file) in [
        ("requests", "request.schema.json"),
        ("results", "result.schema.json"),
    ] {
        let schema: Value = serde_json::from_slice(&fs::read(root.join(file)).unwrap()).unwrap();
        let validator = jsonschema::validator_for(&schema).unwrap();
        for v in vectors[face].as_array().unwrap() {
            assert_eq!(
                validator.is_valid(&v["value"]),
                v["valid"] == true,
                "{}",
                v["name"]
            );
            if face == "requests" {
                let response = invoke(v["value"].clone());
                assert_eq!(response["ok"], false);
                assert_eq!(
                    response["error"]["code"],
                    if v["valid"] == true {
                        "vua.external_tool.unavailable"
                    } else {
                        "vua.external_tool.invalid_params"
                    },
                    "{}: {response}",
                    v["name"]
                );
            }
        }
    }
}

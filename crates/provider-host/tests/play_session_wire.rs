//! No environment service is configured, so even valid commands cannot launch software.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{fs, io::Cursor, path::Path};

// Windows wall-clock reads can repeat across parallel tests. Keep each host's
// task database independent instead of relying on timestamp resolution alone.
static ROOT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn invoke(request: Value) -> Value {
    let root = std::env::temp_dir().join(format!(
        "vua-play-wire-{}-{}-{}",
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
    let response: Value =
        serde_json::from_str(String::from_utf8(output).unwrap().lines().next().unwrap()).unwrap();
    response["payload"].clone()
}
#[test]
fn schema_vectors_are_rejected_or_honestly_unavailable_at_the_real_route() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/play-session/v0.2");
    let vectors: Value =
        serde_json::from_slice(&fs::read(root.join("vectors.json")).unwrap()).unwrap();
    for vector in vectors["requests"].as_array().unwrap() {
        let response = invoke(vector["value"].clone());
        assert_eq!(response["ok"], false, "{response}");
        assert_eq!(
            response["error"]["code"],
            if vector["valid"] == true {
                "vua.play_session.unavailable"
            } else {
                "vua.play_session.invalid_params"
            },
            "{response}"
        );
    }
}
#[test]
fn manager_app_query_is_read_only_and_rejects_paths_and_commands() {
    let base = json!({"contractVersion":"0.1", "requestId":"manager", "correlationId":"manager", "kind":"query", "method":"environment.inspectManagerApps", "params":{}});
    assert_eq!(
        invoke(base.clone())["error"]["code"],
        "vua.manager_apps.unavailable"
    );
    for extra in [
        json!({"params":{"path":"C:/private"}}),
        json!({"kind":"command"}),
        json!({"commandId":"unexpected"}),
    ] {
        let mut request = base.clone();
        for (key, value) in extra.as_object().unwrap() {
            request[key] = value.clone();
        }
        assert_eq!(
            invoke(request)["error"]["code"],
            "vua.manager_apps.invalid_params"
        );
    }
}

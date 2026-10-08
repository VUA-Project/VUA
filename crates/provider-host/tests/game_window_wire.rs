//! environment.observeGameWindow wire tests: the provider-host route maps
//! the read-only project-manager observation primitive onto the frozen
//! `schemas/game-window-observe/v0.1` face and nothing else — request-shape
//! violations are typed validation errors, an OS enumeration failure (or a
//! non-Windows host) is the typed unavailable, and a successful observation
//! validates against the schema, state <=> window consistency included.
//!
//! The route is stateless and always wired (same discipline as
//! environment.verifyEditor): the capability row is unconditionally
//! available. CI runs on Windows without a vrchat.exe, so the well-formed
//! query answers `absent`; any of the three states would be honest on a
//! machine with the game present, and only the consistency law is asserted.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use jsonschema::Validator;
use serde_json::{json, Value};
use vua_provider_host::run_provider_host_full;

fn schemas_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/game-window-observe/v0.1")
}

fn read_json_at(dir: &Path, relative: &str) -> Value {
    let bytes = fs::read(dir.join(relative)).expect("schema file must exist");
    serde_json::from_slice(&bytes).expect("schema file must be valid JSON")
}

/// Compiles one $defs entry of the schema with the full $defs re-attached,
/// so nested $ref targets resolve (same compilation shape as the
/// editor-verify wire test).
fn sub_schema_validator(def_suffix: &str) -> Validator {
    let schema = read_json_at(&schemas_dir(), "observation.schema.json");
    let defs = schema.get("$defs").expect("schema has $defs").clone();
    let sub = defs.get(def_suffix).expect("sub schema exists").clone();
    let combined = json!({ "allOf": [sub], "$defs": defs });
    jsonschema::validator_for(&combined).expect("sub schema compiles")
}

fn result_validator() -> Validator {
    sub_schema_validator("result")
}

fn unique_root(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vua-game-window-wire-{label}-{}-{nanos}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).expect("root creates");
    dir
}

/// Sends one `environment.observeGameWindow` query frame through the real
/// host loop and returns the response payload.
fn run_observe_frame(database: &Path, params: Value) -> Value {
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-game-window",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-game-window",
            "correlationId": "corr-game-window",
            "kind": "query",
            "method": "environment.observeGameWindow",
            "params": params,
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
        None,
        None,
        None,
    )
    .expect("frame loop runs");
    let frames: Vec<Value> = String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect();
    frames[0]["payload"].clone()
}

#[cfg(windows)]
#[test]
fn a_well_formed_query_returns_a_schema_valid_observation() {
    let root = unique_root("observe");
    let database = root.join("tasks.sqlite");
    let payload = run_observe_frame(&database, json!({}));

    assert_eq!(payload["ok"], true, "payload: {payload}");
    let result = &payload["value"];
    let errors: Vec<String> = result_validator()
        .iter_errors(result)
        .map(|error| format!("{}: {error}", error.instance_path()))
        .collect();
    assert!(
        errors.is_empty(),
        "result violates the frozen schema: {errors:?}"
    );

    let observation = &result["gameWindow"];
    assert_eq!(observation["schemaVersion"], "vua.game-window-observe/v0.1");
    let state = observation["state"].as_str().expect("state is a string");
    assert!(
        matches!(state, "absent" | "waiting" | "ready"),
        "state is the closed set: {state}"
    );
    // The consistency law the desktop validator pins: ready <=> non-null.
    assert_eq!(state == "ready", !observation["window"].is_null());
    if state == "ready" {
        // sessionId is decimal pid + ':' + decimal hwnd.
        let session_id = observation["window"]["sessionId"]
            .as_str()
            .expect("sessionId is a string");
        let (pid, hwnd) = session_id.split_once(':').expect("sessionId shape");
        assert!(pid.parse::<u32>().is_ok() && hwnd.parse::<u64>().is_ok());
    }
    let _ = fs::remove_dir_all(&root);
}

#[cfg(not(windows))]
#[test]
fn a_non_windows_host_answers_the_typed_unavailable() {
    let root = unique_root("observe");
    let database = root.join("tasks.sqlite");
    let payload = run_observe_frame(&database, json!({}));

    assert_eq!(payload["ok"], false, "payload: {payload}");
    assert_eq!(payload["error"]["code"], "vua.game_window.unavailable");
    assert_eq!(payload["error"]["category"], "unavailable");
    assert_eq!(
        payload["error"]["messageKey"],
        "errors.gameWindow.unavailable"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn params_shape_violations_answer_invalid_params() {
    let root = unique_root("params");
    let database = root.join("tasks.sqlite");
    for params in [
        json!({"follow": true}), // any key breaks the empty closed set
        json!([]),               // params not an object
        Value::Null,             // params missing as an object
    ] {
        let payload = run_observe_frame(&database, params.clone());
        assert_eq!(
            payload["ok"], false,
            "params {params} must be a validation error"
        );
        assert_eq!(
            payload["error"]["code"], "vua.game_window.invalid_params",
            "params: {params}"
        );
        assert_eq!(
            payload["error"]["category"], "validation",
            "params: {params}"
        );
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn capability_row_declares_the_route_available() {
    // The route is always wired (stateless direct primitive, no service
    // composition), so the capability row is unconditionally available.
    let root = unique_root("caps");
    let database = root.join("tasks.sqlite");
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-caps",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-caps",
            "correlationId": "corr-caps",
            "kind": "query",
            "method": "application.getSnapshot",
            "params": {},
        },
    });
    let mut output = Vec::new();
    run_provider_host_full(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        &database,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("frame loop runs");
    let frames: Vec<Value> = String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect();
    let operations = frames[0]["payload"]["value"]["capabilities"]["operations"]
        .as_array()
        .expect("operations array");
    assert!(
        operations.contains(&json!({
            "operationId": "environment.observeGameWindow",
            "availability": "available"
        })),
        "capability row missing: {operations:?}"
    );
    let _ = fs::remove_dir_all(&root);
}

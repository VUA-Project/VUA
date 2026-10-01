//! Catalog-sync v0.1 wire tests: the account-library page ingest through the
//! real frame loop, against a real BDL store.
//!
//! The frozen vectors in `schemas/catalog-sync/v0.1/examples` drive the wire
//! (positive request, negative request); the fold is pinned end to end: a
//! parsed page lands as catalog cards through `catalog.list` (bdl-queries
//! v0.5), a replay of the same page never creates a second row (W17 upsert),
//! a foreign page is the contract error `vua.catalog.not_a_library_page`
//! (never an empty success), and the wrong schema version is rejected.

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use vua_bdl_store::{ArtifactMode, BdlStore};
use vua_provider_host::{run_provider_host_with_services, WarehouseConfig};

fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/catalog-sync/v0.1")
}

fn read_schema(relative: &str) -> Value {
    let bytes = fs::read(schema_dir().join(relative)).expect("schema must exist");
    serde_json::from_slice(&bytes).expect("schema must be valid JSON")
}

fn read_example(relative: &str) -> Value {
    let bytes = fs::read(schema_dir().join("examples").join(relative)).expect("vector must exist");
    serde_json::from_slice(&bytes).expect("vector must be valid JSON")
}

static SEQUENCE: AtomicU32 = AtomicU32::new(0);

struct World {
    base: PathBuf,
    database_path: PathBuf,
    bdl: Arc<BdlStore>,
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn make_world(label: &str) -> World {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let serial = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let base = std::env::temp_dir().join(format!(
        "vua-provider-catalog-sync-{label}-{}-{nanos}-{serial}",
        std::process::id()
    ));
    fs::create_dir_all(base.join("bdl")).expect("temp layout");
    let bdl = Arc::new(BdlStore::open(base.join("bdl").join("bdl.db")).expect("BDL opens"));
    World { database_path: base.join("tasks.db"), bdl, base }
}

fn run_frames(world: &World, requests: &[Value]) -> Vec<Value> {
    let frames: Vec<String> = requests
        .iter()
        .enumerate()
        .map(|(index, request)| {
            json!({
                "frameVersion": "0.1",
                "frameId": format!("frame-{index}"),
                "kind": "request",
                "payload": {
                    "contractVersion": "0.1",
                    "requestId": format!("req-{index}"),
                    "correlationId": format!("corr-{index}"),
                    "kind": "query",
                    "method": request["method"],
                    "params": request["params"],
                },
            })
            .to_string()
        })
        .collect();
    let warehouse = WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    };
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(frames.join("\n") + "\n"),
        &mut output,
        &world.database_path,
        None,
        None,
        Some(warehouse),
        None,
    )
    .expect("the frame loop must stay alive for catalog-sync vectors");
    String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect()
}

fn ingest_request(params: Value) -> Value {
    json!({ "method": "catalog.ingestLibraryPage", "params": params })
}

fn catalog_list_request() -> Value {
    json!({ "method": "catalog.list", "params": {} })
}

#[test]
fn frozen_vectors_validate_against_the_schemas() {
    let request_validator =
        jsonschema::validator_for(&read_schema("request.schema.json")).expect("request schema");
    let response_validator =
        jsonschema::validator_for(&read_schema("response.schema.json")).expect("response schema");

    let positive = read_example("library-page.request.json");
    assert!(request_validator.is_valid(&positive), "positive vector must validate");

    // Negative vector: wrong schemaVersion AND an outlawed extra key (a
    // stand-in for anything session-shaped that must never ride this face).
    let negative = read_example("library-page.invalid-request.json");
    assert!(!request_validator.is_valid(&negative), "negative vector must fail");

    let response = read_example("library-page.response.json");
    assert!(response_validator.is_valid(&response), "response vector must validate");
}

#[test]
fn library_page_folds_into_catalog_cards_and_replays_safely() {
    let world = make_world("fold");
    let response_validator =
        jsonschema::validator_for(&read_schema("response.schema.json")).expect("response schema");

    let vector = read_example("library-page.request.json");
    let frames = run_frames(
        &world,
        &[
            ingest_request(vector.clone()),
            catalog_list_request(),
            // W17 replay: same page again — upsert, never a second row.
            ingest_request(vector.clone()),
            catalog_list_request(),
        ],
    );
    let ingest_one = &frames[0]["payload"];
    let list_one = &frames[1]["payload"]["value"];
    let ingest_two = &frames[2]["payload"];
    let list_two = &frames[3]["payload"]["value"];

    // Ingest folds the vector's two cards and reports the observed next page.
    assert_eq!(ingest_one["ok"], json!(true));
    let value = &ingest_one["value"];
    assert_eq!(value["parsedCount"], json!(2));
    assert_eq!(value["upsertedCount"], json!(2));
    assert_eq!(value["rejectedItems"], json!([]));
    assert_eq!(
        value["nextPageUrl"],
        json!("https://booth.pm/en/library?page=2")
    );
    assert!(
        response_validator.is_valid(value),
        "wire value must satisfy the frozen response schema"
    );

    // The cards are servable by the catalog read face immediately.
    assert_eq!(list_one["result"]["total"], json!(2));
    let entries = list_one["result"]["entries"].as_array().expect("entries");
    assert_eq!(entries.len(), 2);

    // Replay: honest counts, still exactly two rows.
    assert_eq!(ingest_two["value"]["upsertedCount"], json!(2));
    assert_eq!(list_two["result"]["total"], json!(2));
}

#[test]
fn foreign_page_is_a_contract_error_never_an_empty_success() {
    let world = make_world("foreign");
    let frames = run_frames(
        &world,
        &[ingest_request(json!({
            "schemaVersion": "0.1",
            "sourceUrl": "https://booth.pm/en/sign_in",
            "html": "<html><body><h1>Sign in</h1></body></html>",
            "fetchedAt": "2026-10-02T00:00:00.000Z",
        }))],
    );
    let frame = &frames[0]["payload"];
    assert_eq!(frame["ok"], json!(false));
    let code = frame["error"]["code"].as_str().unwrap_or_default();
    assert_eq!(code, "vua.catalog.not_a_library_page");
}

#[test]
fn wrong_schema_version_is_rejected() {
    let world = make_world("version");
    let frames = run_frames(
        &world,
        &[ingest_request(json!({
            "schemaVersion": "0.2",
            "sourceUrl": "https://booth.pm/en/library?page=1",
            "html": "<html><body><ul class=\"market-items\"></ul></body></html>",
            "fetchedAt": "2026-10-02T00:00:00.000Z",
        }))],
    );
    let frame = &frames[0]["payload"];
    assert_eq!(frame["ok"], json!(false));
    let code = frame["error"]["code"].as_str().unwrap_or_default();
    assert_eq!(code, "vua.catalog.unsupported_schema");
}

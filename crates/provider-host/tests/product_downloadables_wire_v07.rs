//! bdl-queries v0.7 `catalog.productDownloadables` wire tests (N5
//! silent-download slice, 2026-10-05).
//!
//! The route reads the BDL v0.4 product_downloadables capture through the
//! REAL frame loop with the warehouse (BDL) wired. Pinned:
//! - the seeded capture comes back verbatim in (first_seen, id) order,
//!   wrapped in the v0.7 family envelope, and validates against the frozen
//!   v0.7 result schema;
//! - a known product with zero capture = an honest empty items set (the
//!   download flow re-captures; never a not-found guess);
//! - an unknown product rides the family's `vua.catalog.product_not_found`
//!   fact, never a fabricated empty list;
//! - a params escape (extra key) is `vua.catalog.invalid_params`.

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use vua_bdl_store::{ArtifactMode, BdlStore};
use vua_provider_host::{run_provider_host_with_services, WarehouseConfig};

fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/bdl-queries/v0.7")
}

fn result_validator() -> jsonschema::Validator {
    let bytes = fs::read(schema_dir().join("result.schema.json")).expect("frozen v0.7 result schema");
    let schema: Value = serde_json::from_slice(&bytes).expect("schema is valid JSON");
    jsonschema::validator_for(&schema).expect("validator builds")
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
        "vua-provider-dlv07-{label}-{}-{nanos}-{serial}",
        std::process::id()
    ));
    fs::create_dir_all(base.join("bdl")).expect("temp layout");
    let bdl = Arc::new(BdlStore::open(base.join("bdl").join("bdl.db")).expect("BDL opens"));
    World { database_path: base.join("tasks.db"), bdl, base }
}

fn run_query(world: &World, request_id: &str, params: Value) -> Vec<Value> {
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": format!("frame-{request_id}"),
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": request_id,
            "correlationId": format!("corr-{request_id}"),
            "kind": "query",
            "method": "catalog.productDownloadables",
            "params": params,
        },
    });
    let warehouse = WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    };
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        &world.database_path,
        None,
        None,
        Some(warehouse),
        None,
    )
    .expect("the frame loop must stay alive for the v0.7 vector");
    String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect()
}

fn success_payload(frames: &[Value]) -> Value {
    let response = frames
        .iter()
        .find(|frame| frame["kind"] == "response")
        .expect("a response frame");
    assert_eq!(response["payload"]["ok"], json!(true), "expected success");
    response["payload"]["value"].clone()
}

#[test]
fn seeded_capture_travels_verbatim_in_the_v07_envelope() {
    let world = make_world("seeded");
    world.bdl.seed_product("booth:6190761", "6190761").expect("seed product");
    world
        .bdl
        .upsert_product_downloadables(
            "booth:6190761",
            &[(533_0963, "_JerseyTenshi_Materials_v1.0.0.zip".to_owned())],
            "2026-10-05T00:00:00.000Z",
            Some("run-1"),
            Some("bought"),
        )
        .expect("seed capture");

    let frames = run_query(&world, "r1", json!({ "productId": "booth:6190761" }));
    let value = success_payload(&frames);
    assert_eq!(value["schemaVersion"], json!("0.7"));
    assert_eq!(value["operation"], json!("catalog.productDownloadables"));
    assert_eq!(value["result"]["productId"], json!("booth:6190761"));
    assert_eq!(
        value["result"]["items"],
        json!([{ "downloadableId": 5330963, "fileName": "_JerseyTenshi_Materials_v1.0.0.zip" }]),
    );
    result_validator().validate(&value).expect("validates against the frozen v0.7 schema");
}

#[test]
fn known_product_with_zero_capture_is_an_honest_empty_set() {
    let world = make_world("empty");
    world.bdl.seed_product("booth:42", "42").expect("seed product");
    let frames = run_query(&world, "r2", json!({ "productId": "booth:42" }));
    let value = success_payload(&frames);
    assert_eq!(value["result"]["items"], json!([]));
}

#[test]
fn unknown_product_is_not_found_never_a_fabricated_empty_list() {
    let world = make_world("unknown");
    let frames = run_query(&world, "r3", json!({ "productId": "booth:999999" }));
    let response = frames
        .iter()
        .find(|frame| frame["kind"] == "response")
        .expect("a response frame");
    assert_eq!(response["payload"]["ok"], json!(false));
    assert_eq!(response["payload"]["error"]["code"], json!("vua.catalog.product_not_found"));
}

#[test]
fn params_escape_is_invalid_params() {
    let world = make_world("escape");
    let frames = run_query(&world, "r4", json!({ "productId": "booth:42", "extra": 1 }));
    let response = frames
        .iter()
        .find(|frame| frame["kind"] == "response")
        .expect("a response frame");
    assert_eq!(response["payload"]["ok"], json!(false));
    assert_eq!(response["payload"]["error"]["code"], json!("vua.catalog.invalid_params"));
}

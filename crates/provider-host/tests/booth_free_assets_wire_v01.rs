//! Wire tests for `booth-free-assets v0.1` through the `provider-host` frame loop.

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use vua_bdl_store::{ArtifactMode, BdlStore};
use vua_provider_host::{run_provider_host_with_services, WarehouseConfig};

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

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
    let seq = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let base = std::env::temp_dir().join(format!(
        "vua-free-assets-wire-{label}-{}-{seq}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(base.join("bdl")).unwrap();
    fs::create_dir_all(base.join("warehouse")).unwrap();
    let bdl = Arc::new(BdlStore::open(base.join("bdl/bdl.db")).unwrap());
    World {
        database_path: base.join("provider.db"),
        base,
        bdl,
    }
}

fn schema_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/booth-free-assets/v0.1")
}

fn run_payloads(world: &World, with_warehouse: bool, payloads: &[Value]) -> Vec<Value> {
    let warehouse = with_warehouse.then(|| WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    });
    let input = payloads
        .iter()
        .enumerate()
        .map(|(i, payload)| {
            json!({
                "frameVersion": "0.1",
                "frameId": format!("frame-{i}"),
                "kind": "request",
                "payload": payload,
            })
            .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(input),
        &mut output,
        &world.database_path,
        None,
        None,
        warehouse,
        None,
    )
    .unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|frame| frame["kind"] == "response")
        .collect()
}

#[test]
fn free_assets_reports_honest_unavailable_without_warehouse() {
    let world = make_world("unavailable");
    let frames = run_payloads(
        &world,
        false,
        &[
            json!({
                "contractVersion": "0.1",
                "requestId": "req-snap",
                "correlationId": "corr-snap",
                "kind": "query",
                "method": "application.getSnapshot",
                "params": {}
            }),
            json!({
                "contractVersion": "0.1",
                "requestId": "req-state",
                "correlationId": "corr-state",
                "kind": "query",
                "method": "freeAssets.state",
                "params": { "schemaVersion": "0.1" }
            }),
        ],
    );
    let caps = frames[0]["payload"]["value"]["capabilities"]["operations"]
        .as_array()
        .unwrap();
    for op in [
        "freeAssets.state",
        "freeAssets.updatePreferences",
        "freeAssets.ingestSearchPage",
    ] {
        let row = caps.iter().find(|c| c["operationId"] == op).expect(op);
        assert_eq!(row["availability"], "unavailable");
    }
    assert_eq!(frames[1]["payload"]["ok"], false);
    assert_eq!(
        frames[1]["payload"]["error"]["code"],
        "vua.free_assets.unavailable"
    );
}

#[test]
fn free_assets_wire_roundtrip_persists_state_and_validates_envelopes() {
    let world = make_world("roundtrip");
    let response_schema: Value =
        serde_json::from_slice(&fs::read(schema_root().join("response.schema.json")).unwrap())
            .unwrap();
    let validator = jsonschema::validator_for(&response_schema).unwrap();
    let ingest_vector: Value = serde_json::from_slice(
        &fs::read(schema_root().join("examples/ingest-search-page.request.json")).unwrap(),
    )
    .unwrap();

    let frames = run_payloads(
        &world,
        true,
        &[
            json!({
                "contractVersion": "0.1",
                "requestId": "req-snap",
                "correlationId": "corr-snap",
                "kind": "query",
                "method": "application.getSnapshot",
                "params": {}
            }),
            json!({
                "contractVersion": "0.1",
                "requestId": "req-update",
                "correlationId": "corr-update",
                "kind": "command",
                "commandId": "cmd-update-1",
                "method": "freeAssets.updatePreferences",
                "params": {
                    "schemaVersion": "0.1",
                    "watchedKeywords": [{ "keyword": "SyntheticBaseA", "enabled": true }]
                }
            }),
            ingest_vector,
            json!({
                "contractVersion": "0.1",
                "requestId": "req-bad-kind",
                "correlationId": "corr-bad-kind",
                "kind": "command",
                "commandId": "cmd-wrong",
                "method": "freeAssets.state",
                "params": { "schemaVersion": "0.1" }
            }),
            json!({
                "contractVersion": "0.1",
                "requestId": "req-bad-page",
                "correlationId": "corr-bad-page",
                "kind": "command",
                "commandId": "cmd-bad-page",
                "method": "freeAssets.ingestSearchPage",
                "params": {
                    "schemaVersion": "0.1",
                    "keyword": "SyntheticBaseA",
                    "sourceUrl": "https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?q=SyntheticBaseA&max_price=0&sort=new&in_stock=true",
                    "html": "<html><body><h1>Sign in</h1></body></html>",
                    "fetchedAt": "2026-11-14T08:00:00.000Z",
                    "resetCache": false
                }
            }),
        ],
    );

    let caps = frames[0]["payload"]["value"]["capabilities"]["operations"]
        .as_array()
        .unwrap();
    for op in [
        "freeAssets.state",
        "freeAssets.updatePreferences",
        "freeAssets.ingestSearchPage",
    ] {
        let row = caps.iter().find(|c| c["operationId"] == op).expect(op);
        assert_eq!(row["availability"], "available");
    }

    assert_eq!(frames[1]["payload"]["ok"], true, "{}", frames[1]);
    assert!(validator.is_valid(&frames[1]["payload"]["value"]));

    assert_eq!(frames[2]["payload"]["ok"], true, "{}", frames[2]);
    assert!(validator.is_valid(&frames[2]["payload"]["value"]));
    assert_eq!(
        frames[2]["payload"]["value"]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    assert_eq!(
        frames[3]["payload"]["error"]["code"],
        "vua.free_assets.invalid_params"
    );
    assert_eq!(
        frames[4]["payload"]["error"]["code"],
        "vua.free_assets.invalid_page"
    );

    assert!(
        world.base.join("free-assets-state.json").exists(),
        "state file must live alongside warehouse root"
    );

    // Restarting provider-host reloads the persisted state and cached items.
    let restarted = run_payloads(
        &world,
        true,
        &[json!({
            "contractVersion": "0.1",
            "requestId": "req-reloaded",
            "correlationId": "corr-reloaded",
            "kind": "query",
            "method": "freeAssets.state",
            "params": { "schemaVersion": "0.1" }
        })],
    );
    assert_eq!(restarted[0]["payload"]["ok"], true);
    assert_eq!(
        restarted[0]["payload"]["value"]["watchedKeywords"][0]["keyword"],
        "SyntheticBaseA"
    );
    assert_eq!(
        restarted[0]["payload"]["value"]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

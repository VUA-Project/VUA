//! Catalog read-face wire tests (W12 closeout; bdl-queries v0.3 -> v0.4 ->
//! v0.5 ride-along: the additive six->eight operation rise leaves the six
//! v0.4 methods' params/fields/results identical — only the shared family
//! envelope const rises with the vocabulary, so these pins follow the
//! frozen face to the v0.5 directory).
//!
//! The host consumes the data-side frozen vectors from
//! `schemas/bdl-queries/v0.6/examples` through the real frame loop. The
//! assembly (bdl-store) produces the result payload; the wire face wraps it
//! into the frozen `{ schemaVersion, operation, result }` document — so the
//! wire answer must equal the direct store assembly for the same params
//! (the face adds nothing, hides nothing) and must validate against the
//! frozen result schema. Honest empty states are pinned over the wire
//! (no observation rows: list = empty set, status.health = unknown);
//! tombstones are never cards; closed-set violations are contract errors,
//! never silently empty answers.

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use vua_bdl_store::{
    ArtifactMode, BdlStore, BDL_FORMAT_VERSION, BDL_QUERIES_SCHEMA_VERSION, CatalogListParams,
};
use vua_provider_host::{run_provider_host_with_services, WarehouseConfig};

/// The frozen v0.5 schemas (the CURRENT generation: the validators key on
/// the word face the wire now serves).
fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/bdl-queries/v0.6")
}

/// The frozen vector generation for the six v0.4 methods' examples: the
/// v0.5 freeze added only the dependencies vectors (the additive rise
/// keeps the six v0.4 word faces identical, so their vectors stay in the
/// v0.4 generation dir verbatim — schemaVersion "0.4" and all). The route
/// parses params only, so a vector drives the wire with its params alone.
fn vector_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/bdl-queries/v0.4")
}

fn read_schema(relative: &str) -> Value {
    let bytes = fs::read(schema_dir().join(relative)).expect("schema must exist");
    serde_json::from_slice(&bytes).expect("schema must be valid JSON")
}

fn read_vector(relative: &str) -> Value {
    let bytes = fs::read(vector_dir().join(relative)).expect("vector must exist");
    serde_json::from_slice(&bytes).expect("vector must be valid JSON")
}

/// The frozen request vector with its envelope schemaVersion bumped to the
/// CURRENT family const — the additive-rise proof that the params face is
/// identical (the vector body is otherwise untouched).
fn current_request_vector(relative: &str) -> Value {
    let mut request = read_vector(relative);
    request["schemaVersion"] = json!(BDL_QUERIES_SCHEMA_VERSION);
    request
}

fn query_validator() -> jsonschema::Validator {
    jsonschema::validator_for(&read_schema("query.schema.json")).expect("frozen query schema")
}

fn result_validator() -> jsonschema::Validator {
    jsonschema::validator_for(&read_schema("result.schema.json")).expect("frozen result schema")
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
        "vua-provider-catalog-{label}-{}-{nanos}-{serial}",
        std::process::id()
    ));
    fs::create_dir_all(base.join("bdl")).expect("temp layout");
    let bdl = Arc::new(BdlStore::open(base.join("bdl").join("bdl.db")).expect("BDL opens"));
    World { database_path: base.join("tasks.db"), bdl, base }
}

fn seed(world: &World, product_id: &str) {
    world
        .bdl
        .seed_product(product_id, product_id.trim_start_matches("booth:"))
        .expect("seed product");
}

/// A tombstone (`status = 'missing'`) is observation-side bookkeeping — the
/// production surface has no write path for it, so the test writes it
/// through a second connection (mirroring the bdl-store consumer tests).
fn insert_tombstone(world: &World, product_id: &str) {
    rusqlite::Connection::open(world.bdl.path().unwrap())
        .expect("aux connection opens")
        .execute(
            "INSERT INTO products(
                product_id, native_product_id, source_url, status,
                content_hash, observed_at, processor_version
             ) VALUES (?1, ?2, ?3, 'missing', ?4, ?5, 'fixture')",
            rusqlite::params![
                product_id,
                product_id.trim_start_matches("booth:"),
                format!("https://booth.example.com/items/{product_id}"),
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                "2026-09-08T00:00:00.000Z",
            ],
        )
        .expect("tombstone row inserted");
}

/// Runs one bdl-queries request vector through the real frame loop with the
/// warehouse (BDL) wired.
fn run_query(world: &World, request_id: &str, operation: &str, params: Value) -> Vec<Value> {
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": format!("frame-{request_id}"),
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": request_id,
            "correlationId": format!("corr-{request_id}"),
            "kind": "query",
            "method": operation,
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
    .expect("the frame loop must stay alive for catalog vectors");
    String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect()
}

#[test]
fn catalog_request_vectors_are_consumable_query_documents() {
    let validator = query_validator();
    for name in [
        "examples/catalog-list.request.json",
        "examples/catalog-detail.request.json",
        "examples/catalog-status.request.json",
    ] {
        let vector = current_request_vector(name);
        assert!(validator.is_valid(&vector), "{name} must validate");
    }
}

#[test]
fn empty_table_answers_the_honest_empty_state_over_the_wire() {
    let world = make_world("empty");
    let validator = result_validator();

    // 空态即终态: until the observation pipeline lands rows, list is the
    // empty set and status.health is unknown — over the wire, not just in
    // the assembly.
    let frames = run_query(&world, "req-list", "catalog.list", json!({}));
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    assert_eq!(value["schemaVersion"], "0.6");
    assert_eq!(value["operation"], "catalog.list");
    assert_eq!(value["result"]["total"], 0);
    assert_eq!(value["result"]["entries"], json!([]));

    let frames = run_query(&world, "req-status", "catalog.status", json!({}));
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    assert_eq!(value["operation"], "catalog.status");
    assert_eq!(value["result"]["health"], "unknown");
    assert_eq!(value["result"]["revision"]["catalogUpdatedSeq"], Value::Null);
    assert_eq!(
        value["result"]["revision"]["datasetRevision"],
        BDL_FORMAT_VERSION,
    );
}

#[test]
fn catalog_list_wire_equals_the_store_assembly_and_never_serves_tombstones() {
    let world = make_world("list");
    let validator = result_validator();
    seed(&world, "booth:1000001");
    seed(&world, "booth:1000002");
    insert_tombstone(&world, "booth:1000004");

    // The positive vector, reworded to the seeded ids (no text filter — the
    // seeded rows carry no presentation fields yet).
    let request = current_request_vector("examples/catalog-list.request.json");
    let mut params = request["params"].clone();
    params["text"] = Value::Null;
    let frames = run_query(&world, "req-list", "catalog.list", params);
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    assert_eq!(value["operation"], "catalog.list");
    // The face wraps the store assembly unchanged: total excludes the
    // tombstone and the entries are exactly the store's answer.
    let assembled = world
        .bdl
        .catalog_list(&CatalogListParams::default())
        .expect("store assembly");
    assert_eq!(value["result"], serde_json::to_value(&assembled).unwrap());
    assert_eq!(assembled.total, 2, "tombstones are never cards");
    let ids: Vec<&str> = assembled.entries.iter().map(|e| e.product_id.as_str()).collect();
    assert_eq!(ids, ["booth:1000001", "booth:1000002"], "productId ascending");

    // The text filter matches the productId substring and only that entry.
    let mut filtered = request["params"].clone();
    filtered["text"] = json!("1000002");
    let frames = run_query(&world, "req-filter", "catalog.list", filtered);
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    assert_eq!(value["result"]["total"], 1);
    assert_eq!(value["result"]["entries"][0]["productId"], "booth:1000002");
}

#[test]
fn catalog_detail_serves_cards_and_answers_not_found_for_misses() {
    let world = make_world("detail");
    let validator = result_validator();
    seed(&world, "booth:1000001");
    insert_tombstone(&world, "booth:1000004");

    // The positive vector, reworded to the seeded id: the assembled detail
    // equals the store assembly and validates against the frozen schema.
    let request = current_request_vector("examples/catalog-detail.request.json");
    let frames = run_query(&world, "req-detail", "catalog.detail", request["params"].clone());
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    assert_eq!(value["operation"], "catalog.detail");
    let assembled = world
        .bdl
        .catalog_detail("booth:1000001")
        .expect("store assembly")
        .expect("seeded card exists");
    assert_eq!(value["result"], serde_json::to_value(&assembled).unwrap());
    assert_eq!(value["result"]["product"]["productId"], "booth:1000001");

    // A miss is the application-face not-found — never a fabricated product.
    let frames = run_query(
        &world,
        "req-miss",
        "catalog.detail",
        json!({ "productId": "booth:9999999" }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.catalog.product_not_found");

    // A tombstone is observation-side data: the catalog face does not serve
    // it as a card either.
    let frames = run_query(
        &world,
        "req-tomb",
        "catalog.detail",
        json!({ "productId": "booth:1000004" }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.catalog.product_not_found");
    assert!(!result_validator().is_valid(&frames[0]["payload"]["error"]));
}

#[test]
fn catalog_status_health_follows_the_pipeline_bookkeeping_counter() {
    let world = make_world("status");
    seed(&world, "booth:1000001");

    // Seeded product rows alone do not make the catalog "ok": health tracks
    // the observation pipeline's bookkeeping counter, not row presence.
    let frames = run_query(&world, "req-status-before", "catalog.status", json!({}));
    let value = &frames[0]["payload"]["value"];
    assert!(result_validator().is_valid(value), "{value}");
    assert_eq!(value["result"]["health"], "unknown");
    assert_eq!(value["result"]["revision"]["catalogUpdatedSeq"], Value::Null);

    // The pipeline bookkeeping counter (an auxiliary row here — the
    // production write path belongs to the pipeline) turns the health ok,
    // and the counter value travels the revision.
    rusqlite::Connection::open(world.bdl.path().unwrap())
        .expect("aux connection opens")
        .execute(
            "INSERT INTO bdl_meta(key, value) VALUES ('catalog_updated_seq', '7')",
            [],
        )
        .expect("bookkeeping counter written");
    let frames = run_query(&world, "req-status-after", "catalog.status", json!({}));
    let value = &frames[0]["payload"]["value"];
    assert!(result_validator().is_valid(value), "{value}");
    assert_eq!(value["result"]["health"], "ok");
    assert_eq!(value["result"]["revision"]["catalogUpdatedSeq"], 7);
}

#[test]
fn closed_set_violations_are_contract_errors_not_empty_answers() {
    let world = make_world("params");
    seed(&world, "booth:1000001");
    let validator = result_validator();

    // The frozen negative vectors drive the wire: entityType is outside the
    // v0.3 closed set and "in stock" is outside the stable enum.
    for name in [
        "examples/invalid-entity-filter.json",
        "examples/invalid-availability-filter.json",
    ] {
        let request = current_request_vector(name);
        let frames = run_query(&world, "req-invalid", "catalog.list", request["params"].clone());
        assert_eq!(
            frames[0]["payload"]["error"]["code"],
            "vua.catalog.invalid_params",
            "{name}"
        );
    }

    // detail: an unknown key, an explicit null, and an empty string are all
    // contract errors.
    for params in [
        json!({ "productId": "booth:1000001", "extra": 1 }),
        json!({ "productId": null }),
        json!({ "productId": "" }),
        json!({}),
    ] {
        let frames = run_query(&world, "req-detail-invalid", "catalog.detail", params);
        assert_eq!(frames[0]["payload"]["error"]["code"], "vua.catalog.invalid_params");
    }

    // status: the closed set is {} — any key at all is a contract error.
    let frames = run_query(&world, "req-status-invalid", "catalog.status", json!({ "x": 1 }));
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.catalog.invalid_params");

    // Every error path stays an application error: it never validates as a
    // frozen result.
    assert!(!validator.is_valid(&frames[0]["payload"]["error"]));
}

#[test]
fn warehouse_read_face_vectors_drive_cards_and_detail_over_the_wire() {
    let world = make_world("wh-read");
    let validator = result_validator();
    let item = world
        .bdl
        .create_warehouse_item("Fixture Material Pack", "imported_material", "2026-09-08T00:00:00.000Z")
        .expect("seed entry");

    // listEntries: the frozen closed set {} drives the whole card list; the
    // wire result equals the store assembly (face adds nothing, hides
    // nothing) and resolves effective modes against the composed global.
    let request = current_request_vector("examples/warehouse-list-entries.request.json");
    let frames = run_query(&world, "req-wh-list", "warehouse.listEntries", request["params"].clone());
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    assert_eq!(value["operation"], "warehouse.listEntries");
    let assembled = world
        .bdl
        .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
        .expect("store assembly");
    assert_eq!(
        value["result"]["entries"],
        serde_json::to_value(&assembled).unwrap()
    );
    assert_eq!(value["result"]["entries"][0]["warehouseItemId"], item.warehouse_item_id);
    assert_eq!(
        value["result"]["entries"][0]["effectiveArtifactMode"],
        "use_original_unitypackage",
        "no persisted global and no override: the env initial rules"
    );

    // entryDetail: the seeded id round-trips with the full fact payload.
    let request = current_request_vector("examples/warehouse-entry-detail.request.json");
    let mut params = request["params"].clone();
    params["warehouseItemId"] = json!(item.warehouse_item_id);
    let frames = run_query(&world, "req-wh-detail", "warehouse.entryDetail", params);
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    assert_eq!(value["operation"], "warehouse.entryDetail");
    let assembled = world
        .bdl
        .warehouse_entry_detail(&item.warehouse_item_id, ArtifactMode::UseOriginalUnitypackage)
        .expect("store assembly")
        .expect("seeded entry exists");
    assert_eq!(
        value["result"]["entry"],
        serde_json::to_value(&assembled).unwrap()
    );

    // A miss is the frozen application-face entry_not_found — never a
    // fabricated entry.
    let frames = run_query(
        &world,
        "req-wh-miss",
        "warehouse.entryDetail",
        json!({ "warehouseItemId": "whi-does-not-exist" }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.entry_not_found");
}

#[test]
fn warehouse_read_face_closed_set_violations_are_contract_errors() {
    let world = make_world("wh-params");

    // listEntries takes no filter: any key at all is a contract error.
    let frames = run_query(
        &world,
        "req-wh-list-invalid",
        "warehouse.listEntries",
        json!({ "kind": "imported_material" }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.invalid_params");

    // entryDetail's closed set is { warehouseItemId }: unknown keys, an
    // explicit null, and an empty string are contract errors.
    for params in [
        json!({ "warehouseItemId": "whi-x", "extra": 1 }),
        json!({ "warehouseItemId": null }),
        json!({ "warehouseItemId": "" }),
        json!({}),
    ] {
        let frames = run_query(&world, "req-wh-detail-invalid", "warehouse.entryDetail", params);
        assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.invalid_params");
    }
}

#[test]
fn unknown_catalog_methods_and_unwired_bdl_answer_typed_errors() {
    let world = make_world("unwired");

    // An unknown catalog.* method is the shared unknown-method validation.
    let frames = run_query(&world, "req-unknown", "catalog.snapshot", json!({}));
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.provider.unknown_method");

    // Without the warehouse wiring there is no BDL read face: an honest
    // typed unavailable, never a fabricated empty answer.
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-unwired",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-unwired",
            "correlationId": "corr-unwired",
            "kind": "query",
            "method": "catalog.list",
            "params": {},
        },
    });
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        &world.database_path,
        None,
        None,
        None,
        None,
    )
    .expect("frame loop runs");
    let frames: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.catalog.unavailable");
}

// --- bdl-queries v0.4 -> v0.5 ride-along: the download-adoption source listing face ---

#[test]
fn downloads_list_completed_is_the_adoption_guards_mirror() {
    use vua_bdl_store::download_events::{DownloadEventConsumer, DownloadEventKind, DownloadEventV01};

    let world = make_world("downloads-list");
    let validator = result_validator();

    // Two completed deliveries in BDL's own event log, backed by real
    // staging files at the reported size.
    let staging_dir = world.base.join("staging");
    fs::create_dir_all(&staging_dir).expect("staging dir");
    let consumer = DownloadEventConsumer::new(&world.bdl);
    let mut ids = Vec::new();
    for index in 0..2 {
        let download_id = format!("dl-01htest{index:020}");
        let staging_path = staging_dir.join(format!("{download_id}-material-pack.zip"));
        fs::write(&staging_path, b"downloaded package bytes").expect("staging file");
        let stored = staging_path.to_string_lossy().into_owned();
        let received = b"downloaded package bytes".len() as u64;
        for kind in [DownloadEventKind::Started, DownloadEventKind::Completed] {
            consumer
                .ingest(&DownloadEventV01 {
                    schema_version: "0.1".into(),
                    kind,
                    download_id: download_id.clone(),
                    attempt: 1,
                    source_url: "https://booth.example.com/download/1000001/fixture".into(),
                    initiated_from_page_url: None,
                    url_chain: None,
                    suggested_file_name: Some("material-pack.zip".into()),
                    stored_path: Some(stored.clone()),
                    expected_bytes: Some(received),
                    received_bytes: Some(received),
                    resumable: false,
                    failure_kind: None,
                    occurred_at: "2026-09-10T00:00:00.000Z".into(),
                })
                .expect("event ingests");
        }
        ids.push(download_id);
    }

    // Adopt the second download through the real write face, so the row
    // carries its adoption link (the guard-mirror property).
    let warehouse = WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    };
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-adopt",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-adopt",
            "correlationId": "corr-adopt",
            "kind": "command",
            "method": "warehouse.importDownloads",
            "params": {"downloadIds": [ids[1]]},
        },
    });
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        &world.database_path,
        None,
        None,
        Some(warehouse.clone()),
        None,
    )
    .expect("adopt frame runs");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).expect("store");
        let running = store.tasks().expect("tasks").into_iter().any(|task| !task.state.is_terminal());
        if !running {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "the adoption did not finish");
        drop(store);
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    // The read face: both deliveries list (staging present, size exact);
    // the adopted one carries its warehouse entry link, the other empty.
    let frames = run_query(&world, "req-downloads", "downloads.listCompleted", json!({}));
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "the listing must match the frozen v0.5 schema: {value}");
    assert_eq!(value["schemaVersion"], "0.6");
    assert_eq!(value["operation"], "downloads.listCompleted");
    let rows = value["result"]["downloads"].as_array().expect("downloads rows");
    assert_eq!(rows.len(), 2, "both adoptable deliveries list: {value}");
    let by_id: std::collections::HashMap<&str, &Value> =
        rows.iter().map(|row| (row["downloadId"].as_str().expect("id"), row)).collect();
    let adopted = by_id.get(ids[1].as_str()).expect("adopted row");
    assert_eq!(
        adopted["adoptedWarehouseItemIds"].as_array().expect("links").len(),
        1,
        "the adopted download carries its entry link: {adopted}"
    );
    let unadopted = by_id.get(ids[0].as_str()).expect("unadopted row");
    assert_eq!(unadopted["adoptedWarehouseItemIds"], json!([]));
    for row in rows {
        assert!(
            row.get("storedPath").is_none(),
            "paths never appear in the listing rows: {row}"
        );
    }
}

#[test]
fn downloads_list_completed_rejects_params_and_answers_absence_honestly() {
    let world = make_world("downloads-guards");

    // The word-list entry is param-free: any params content is a contract
    // error (the frozen negative vector pins the same).
    let frames = run_query(&world, "req-downloads-params", "downloads.listCompleted", json!({"unexpected": true}));
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.downloads.invalid_params");

    // An unknown downloads.* method is a contract error.
    let frames = run_query(&world, "req-downloads-unknown", "downloads.adopt", json!({}));
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.provider.unknown_method");
}

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

mod v03 {
    use super::*;

    fn root() -> PathBuf { schema_dir().parent().unwrap().join("v0.3") }
    fn vector(name: &str) -> Value {
        serde_json::from_slice(&fs::read(root().join("examples").join(name)).unwrap()).unwrap()
    }
    fn page(kind: &str, ordinal: u64, product: &str) -> Value {
        let mut request = vector("page.request.json");
        request["params"]["libraryType"] = json!(kind);
        request["params"]["pageNumber"] = json!(ordinal);
        request["params"]["sourceUrl"] = json!(format!("https://accounts.booth.pm/library{}?page=1", if kind == "bought" { String::new() } else { format!("/{kind}") }));
        request["params"]["html"] = json!(request["params"]["html"].as_str().unwrap().replace("901", product));
        request
    }

    #[test]
    fn schemas_and_positive_negative_vectors_agree() {
        let request = jsonschema::validator_for(&serde_json::from_slice::<Value>(&fs::read(root().join("request.schema.json")).unwrap()).unwrap()).unwrap();
        let response = jsonschema::validator_for(&serde_json::from_slice::<Value>(&fs::read(root().join("response.schema.json")).unwrap()).unwrap()).unwrap();
        for name in ["begin.request.json", "page.request.json", "finish.request.json", "failed.request.json", "status.request.json"] { assert!(request.is_valid(&vector(name)), "{name}"); }
        for name in ["invalid-session.request.json", "invalid-page.request.json", "invalid-finish.request.json"] { assert!(!request.is_valid(&vector(name)), "{name}"); }
        for name in ["page.response.json", "snapshot.response.json"] { assert!(response.is_valid(&vector(name)), "{name}"); }
        assert!(!response.is_valid(&vector("invalid-page.response.json")));
    }

    #[test]
    fn all_libraries_finish_only_after_explicit_validated_end() {
        let world = make_world("v03-all");
        let first = page("bought", 1, "901");
        let frames = run_frames(&world, &[
            vector("begin.request.json"), first.clone(), vector("status.request.json"),
            vector("finish.request.json"), page("gifts", 2, "902"), page("free_downloads", 3, "903"),
            vector("finish.request.json"), vector("finish.request.json"), first, vector("status.request.json"),
        ]);
        assert_eq!(frames[0]["payload"]["value"]["state"], "running");
        assert_eq!(frames[2]["payload"]["value"]["state"], "running");
        assert_eq!(frames[2]["payload"]["value"]["completedLibraryTypes"], json!(["bought"]));
        assert_eq!(frames[3]["payload"]["error"]["code"], "vua.catalog.run_incomplete");
        assert_eq!(frames[6]["payload"]["value"]["state"], "succeeded");
        assert_eq!(frames[6]["payload"]["value"]["pages"], 3);
        assert_eq!(frames[6]["payload"]["value"]["upsertedCount"], 3);
        assert_eq!(frames[6]["payload"]["value"], frames[7]["payload"]["value"]);
        assert_eq!(frames[9]["payload"]["value"]["pages"], 3);
        let response = jsonschema::validator_for(&serde_json::from_slice::<Value>(&fs::read(root().join("response.schema.json")).unwrap()).unwrap()).unwrap();
        for index in [0, 1, 2, 4, 5, 6, 7, 8, 9] { assert!(response.is_valid(&frames[index]["payload"]["value"]), "response {index}: {}", frames[index]); }
    }

    #[test]
    fn first_fetch_failure_is_a_durable_zero_page_failure() {
        let world = make_world("v03-first-fail");
        let frames = run_frames(&world, &[vector("begin.request.json"), vector("failed.request.json"), vector("status.request.json")]);
        assert_eq!(frames[1]["payload"]["value"]["state"], "failed");
        assert_eq!(frames[2]["payload"]["value"]["pages"], 0);
        assert_eq!(task_state(&world, "catalog-sync-synthetic").as_deref(), Some("failed"));
    }

    #[test]
    fn partial_failure_keeps_catalog_and_counts_queryable() {
        let world = make_world("v03-partial");
        let frames = run_frames(&world, &[vector("begin.request.json"), page("bought", 1, "901"), vector("failed.request.json"), vector("status.request.json"), catalog_list_request()]);
        assert_eq!(frames[3]["payload"]["value"]["state"], "failed");
        assert_eq!(frames[3]["payload"]["value"]["pages"], 1);
        assert_eq!(frames[3]["payload"]["value"]["upsertedCount"], 1);
        assert_eq!(frames[4]["payload"]["value"]["result"]["total"], 1);
    }

    #[test]
    fn an_early_rejection_survives_later_successful_pages() {
        let world = make_world("v03-warning");
        rusqlite::Connection::open(world.base.join("bdl/bdl.db")).unwrap().execute_batch(
            "CREATE TRIGGER synthetic_rejection BEFORE INSERT ON products WHEN NEW.product_id = 'booth:901' BEGIN SELECT RAISE(FAIL, 'synthetic rejection'); END;"
        ).unwrap();
        let frames = run_frames(&world, &[vector("begin.request.json"), page("bought", 1, "901"), page("gifts", 2, "902"), page("free_downloads", 3, "903"), vector("finish.request.json")]);
        assert_eq!(frames[4]["payload"]["value"]["state"], "succeeded_with_warnings");
        assert_eq!(frames[4]["payload"]["value"]["rejectedCount"], 1);
        assert_eq!(frames[4]["payload"]["value"]["upsertedCount"], 2);
    }

    #[test]
    fn replayed_pages_do_not_double_count_and_conflicting_replays_fail() {
        let world = make_world("v03-replay");
        let first = page("bought", 1, "901");
        let frames = run_frames(&world, &[vector("begin.request.json"), first.clone(), first, page("bought", 1, "904"), vector("status.request.json")]);
        assert_eq!(frames[1]["payload"]["value"], frames[2]["payload"]["value"]);
        assert_eq!(frames[3]["payload"]["error"]["code"], "vua.catalog.page_conflict");
        assert_eq!(frames[4]["payload"]["value"]["pages"], 1);
        assert_eq!(frames[4]["payload"]["value"]["upsertedCount"], 1);
    }

    #[test]
    fn unselected_or_out_of_order_pages_are_rejected_before_catalog_writes() {
        let world = make_world("v03-order");
        let mut foreign = page("bought", 1, "901");
        foreign["params"]["sourceUrl"] = json!("https://example.invalid/library?page=1");
        let frames = run_frames(&world, &[vector("begin.request.json"), page("gifts", 1, "902"), page("bought", 2, "901"), foreign, catalog_list_request()]);
        for index in [1, 2, 3] { assert_eq!(frames[index]["payload"]["error"]["code"], "vua.catalog.page_out_of_order"); }
        assert_eq!(frames[4]["payload"]["value"]["result"]["total"], 0);
    }

    #[test]
    fn cancellation_keeps_finished_pages_and_a_cancelled_task() {
        let world = make_world("v03-cancel");
        let mut finish = vector("finish.request.json");
        finish["params"]["outcome"] = json!("cancelled");
        let frames = run_frames(&world, &[vector("begin.request.json"), page("bought", 1, "901"), finish, vector("status.request.json")]);
        assert_eq!(frames[3]["payload"]["value"]["state"], "cancelled");
        assert_eq!(frames[3]["payload"]["value"]["pages"], 1);
    }

    #[test]
    fn restart_preserves_progress_and_refuses_implicit_continuation() {
        let world = make_world("v03-recovery");
        run_frames(&world, &[vector("begin.request.json"), page("bought", 1, "901")]);
        let frames = run_frames(&world, &[vector("status.request.json"), page("gifts", 2, "902"), vector("finish.request.json")]);
        assert_eq!(frames[0]["payload"]["value"]["recoveryDisposition"], "inspect_required");
        assert_eq!(frames[0]["payload"]["value"]["pages"], 1);
        assert_eq!(frames[1]["payload"]["error"]["code"], "vua.catalog.inspect_required");
        assert_eq!(frames[2]["payload"]["error"]["code"], "vua.catalog.inspect_required");
    }

    #[test]
    fn invalid_fields_do_not_create_tasks() {
        let world = make_world("v03-fields");
        let frames = run_frames(&world, &[vector("invalid-session.request.json"), vector("invalid-page.request.json"), vector("invalid-finish.request.json")]);
        for frame in frames { assert_eq!(frame["payload"]["error"]["code"], "vua.catalog.invalid_params"); }
        assert!(task_state(&world, "catalog-sync-synthetic").is_none());
    }
}

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
            let is_query = matches!(request["method"].as_str(), Some("catalog.librarySyncStatus" | "catalog.list" | "catalog.status" | "catalog.detail" | "dependencies.listByProduct"));
            let mut payload = json!({
                "contractVersion": "0.1", "requestId": format!("req-{index}"), "correlationId": format!("corr-{index}"),
                "kind": if is_query { "query" } else { "command" }, "method": request["method"], "params": request["params"],
            });
            if !is_query { payload["commandId"] = json!(format!("command-{index}")); }
            json!({
                "frameVersion": "0.1",
                "frameId": format!("frame-{index}"),
                "kind": "request",
                "payload": payload,
            })
            .to_string()
        })
        .collect();
    let warehouse = WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: Some(Arc::new(vua_orchestrator::BdlDependencyQueries::new(world.bdl.clone()))),
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
    let frames: Vec<Value> = String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect();
    // 事件帧(任务事件)与响应帧同线输出;断言索引只对响应帧,
    // 事件帧由专用断言检查
    frames
        .into_iter()
        .filter(|frame| frame["kind"] == "response")
        .collect()
}

/// 输出中的事件帧(kind == "event"):任务事件发布链路的在场证明
fn event_frames(requests: &[Value], world: &World) -> Vec<Value> {
    let warehouse = WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    };
    let frames_json = requests
        .iter()
        .enumerate()
        .map(|(index, request)| {
            json!({
                "frameVersion": "0.1",
                "frameId": format!("ev-frame-{index}"),
                "kind": "request",
                "payload": {
                    "contractVersion": "0.1",
                    "requestId": format!("ev-req-{index}"),
                    "correlationId": format!("ev-corr-{index}"),
                    "kind": "command",
                    "commandId": format!("ev-command-{index}"),
                    "method": request["method"],
                    "params": request["params"],
                },
            })
            .to_string()
        })
        .collect::<Vec<String>>()
        .join("
");
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(frames_json + "
"),
        &mut output,
        &world.database_path,
        None,
        None,
        Some(warehouse),
        None,
    )
    .expect("frame loop stays alive");
    String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("frames"))
        .filter(|frame| frame["kind"] == "event")
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
            "schemaVersion": "9.9",
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

/// The tasks table row for one run, read through an auxiliary connection
/// (the production surface has no direct task introspection here).
fn task_state(world: &World, task_id: &str) -> Option<String> {
    rusqlite::Connection::open(&world.database_path)
        .expect("aux connection opens")
        .query_row("SELECT state FROM tasks WHERE task_id = ?1", [task_id], |row| {
            row.get::<_, String>(0)
        })
        .ok()
}

#[test]
fn sync_run_folds_into_a_nine_state_task() {
    let world = make_world("task");
    let vector = read_example("library-page.request.json");
    let mut page_one = vector.clone();
    page_one["runId"] = json!("catalog-sync-task-1");
    page_one["pageNumber"] = json!(1);
    // Page two: same grammar, observed last page (no rel="next").
    let mut page_two = vector.clone();
    page_two["runId"] = json!("catalog-sync-task-1");
    page_two["pageNumber"] = json!(2);
    page_two["sourceUrl"] = json!("https://booth.pm/en/library?page=2");
    page_two["html"] = json!(
        "<html><body><ul class=\"market-items\">\
         <li class=\"item-card l-card\" data-product-id=\"777001\" data-product-name=\"Last page item\">\
         <div class=\"item-card__wrap\"></div></li></ul>\
         <div class=\"pager\"><span>2</span></div></body></html>"
    );

    // First page only: the run task is running (non-terminal).
    let mid = run_frames(&world, &[ingest_request(page_one.clone())]);
    assert_eq!(mid[0]["payload"]["ok"], json!(true));
    assert_eq!(
        task_state(&world, "catalog-sync-task-1").as_deref(),
        Some("running")
    );

    // Second (last) page completes the run.
    let frames = run_frames(&world, &[ingest_request(page_two.clone())]);
    assert_eq!(frames[0]["payload"]["ok"], json!(true));
    assert_eq!(frames[0]["payload"]["value"]["nextPageUrl"], json!(null));
    assert_eq!(
        task_state(&world, "catalog-sync-task-1").as_deref(),
        Some("succeeded")
    );

    // A replayed last page of the finished run folds to a no-op.
    let replay = run_frames(&world, &[ingest_request(page_two.clone())]);
    assert_eq!(replay[0]["payload"]["ok"], json!(true));
    assert_eq!(
        task_state(&world, "catalog-sync-task-1").as_deref(),
        Some("succeeded")
    );
}

#[test]
fn ingest_without_run_id_creates_no_task() {
    let world = make_world("no-task");
    let mut vector = read_example("library-page.request.json");
    vector.as_object_mut().expect("vector").remove("runId");
    let frames = run_frames(&world, &[ingest_request(vector)]);
    assert_eq!(frames[0]["payload"]["ok"], json!(true));
    let count: i64 = rusqlite::Connection::open(&world.database_path)
        .expect("aux connection opens")
        .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
        .expect("count");
    assert_eq!(count, 0);
}

#[test]
fn a_new_run_supersedes_orphaned_interrupted_sync_tasks() {
    let world = make_world("supersede");
    let vector = read_example("library-page.request.json");

    // 运行 A:首页折叠后中断(非终态,模拟真机相对 URL 缺陷时代的孤儿)
    let mut page_a = vector.clone();
    page_a["runId"] = json!("catalog-sync-orphan-a");
    page_a["pageNumber"] = json!(1);
    let frames = run_frames(&world, &[ingest_request(page_a)]);
    assert_eq!(frames[0]["payload"]["ok"], json!(true));
    assert_eq!(task_state(&world, "catalog-sync-orphan-a").as_deref(), Some("running"));

    // 运行 B:新同步首页 → A 被如实终结为 cancelled(被取代),B 正常运行
    let mut page_b = vector.clone();
    page_b["runId"] = json!("catalog-sync-fresh-b");
    page_b["pageNumber"] = json!(1);
    page_b["sourceUrl"] = json!("https://accounts.booth.pm/library?page=1");
    page_b["html"] = json!(
        "<html><body><ul class=\"market-items\">\
         <li class=\"item-card l-card\" data-product-id=\"990001\" data-product-name=\"Fresh run item\">\
         <div class=\"item-card__wrap\"></div></li></ul>\
         <div class=\"pager\"><span>1</span></div></body></html>"
    );
    let frames = run_frames(&world, &[ingest_request(page_b)]);
    assert_eq!(frames[0]["payload"]["ok"], json!(true));
    // B 的夹具是末页(无 rel=next)→ 直接 succeeded;A 被如实终结为 cancelled
    assert_eq!(task_state(&world, "catalog-sync-fresh-b").as_deref(), Some("succeeded"));
    assert_eq!(task_state(&world, "catalog-sync-orphan-a").as_deref(), Some("cancelled"));
}

#[test]
fn fold_events_are_published_as_event_frames() {
    let world = make_world("events");
    let vector = read_example("library-page.request.json");
    let mut last_page = vector.clone();
    last_page["runId"] = json!("catalog-sync-events-1");
    // 末页夹具(无 rel=next)→ 一次投递即完成任务
    last_page["html"] = json!(
        "<html><body><ul class=\"market-items\">\
         <li class=\"item-card l-card\" data-product-id=\"880001\" data-product-name=\"Eventful item\">\
         <div class=\"item-card__wrap\"></div></li></ul>\
         <div class=\"pager\"><span>1</span></div></body></html>"
    );

    let events = event_frames(&[ingest_request(last_page)], &world);
    // 事件链:accepted → preparing → running → succeeded(终态)
    let mut kinds: Vec<&str> = events
        .iter()
        .filter_map(|e| e["payload"]["kind"].as_str())
        .collect();
    kinds.dedup();
    assert!(
        events.iter().any(|e| e["payload"]["taskId"] == *"catalog-sync-events-1"),
        "events must reference the run's task: {}",
        serde_json::to_string(&events).unwrap_or_default()
    );
    assert!(
        kinds.contains(&"task.succeeded") || events.len() >= 3,
        "expected a full lifecycle of task events, got {:?}",
        kinds
    );
}


#[test]
fn v02_requests_carry_library_type_into_observations() {
    let world = make_world("v02");
    let mut vector = read_example("library-page.request.json");
    vector.as_object_mut().unwrap().insert("libraryType".into(), serde_json::json!("bought"));
    let frames = run_frames(&world, &[ingest_request(vector), catalog_list_request()]);
    assert_eq!(frames[0]["payload"]["ok"], json!(true));
    // 全部条目按 bought 类型入库并可按该类型筛出
    let filtered = run_frames(
        &world,
        &[json!({ "method": "catalog.list", "params": { "libraryType": "bought" } })],
    );
    let value = &filtered[0]["payload"]["value"];
    assert_eq!(value["result"]["total"], json!(2));
    let entries = value["result"]["entries"].as_array().unwrap();
    assert!(entries.iter().all(|e| e["libraryType"] == json!("bought")));
}

fn product_page_request(id: &str, description: &str) -> Value {
    ingest_request(json!({
        "schemaVersion": "0.2",
        "sourceUrl": format!("https://booth.pm/items/{id}"),
        "fetchedAt": "2026-10-08T10:00:00Z",
        "html": format!(r#"<div id="items" data-product-id="{id}"><article>
            <div class="summary"><h2>Synthetic item {id}</h2></div>
            <div class="js-market-item-detail-description description">{description}</div>
            </article><aside><a href="https://booth.pm/items/903">Related item</a></aside></div>"#),
    }))
}

#[test]
fn official_product_reader_does_not_invent_account_memberships() {
    let world = make_world("source-ownership");
    let frames = run_frames(&world, &[product_page_request("901", "")]);
    assert_eq!(frames[0]["payload"]["ok"], true, "{}", frames[0]);
    assert!(world.bdl.product_library_memberships("booth:901").unwrap().is_empty());
    let mut purchased = read_example("library-page.request.json");
    purchased["schemaVersion"] = json!("0.2");
    purchased["libraryType"] = json!("bought");
    let frames = run_frames(&world, &[ingest_request(purchased), product_page_request("1693144", "")]);
    assert!(frames.iter().all(|frame| frame["payload"]["ok"] == true), "{frames:?}");
    assert_eq!(world.bdl.product_library_memberships("booth:1693144").unwrap(), vec!["bought"]);
    assert!(world.bdl.product_library_memberships("booth:901").unwrap().is_empty());
}

#[test]
fn product_description_links_persist_for_a_new_source_and_survive_restart() {
    let world = make_world("description-new-source");
    let frames = run_frames(&world, &[product_page_request("901", r#"
        <a href='https://sample.booth.pm/en/items/902'><span>lilToon</span></a>
        <a href="https://booth.pm/items/902">Same target again</a>
        <a href="https://booth.pm/items/901">Self link</a>
        <a href="https://booth.pm.invalid/items/904">Unrelated host</a>
    "#)]);
    assert_eq!(frames[0]["payload"]["ok"], true, "{}", frames[0]);
    assert_eq!(frames[0]["payload"]["value"]["upsertedCount"], 1);

    let reopened = BdlStore::open(world.base.join("bdl/bdl.db")).unwrap();
    let observations = reopened.dependency_observations("booth:901").unwrap();
    assert_eq!(observations.len(), 1, "only the unique description target belongs here");
    let observation = &observations[0];
    assert_eq!(observation.dep_name, "lilToon");
    assert_eq!(observation.dep_kind, "shader");
    assert_eq!(observation.extraction_method, "link");
    assert_eq!(observation.source_span, "description_link");
    assert_eq!(observation.raw_quote, "https://sample.booth.pm/en/items/902");
    assert_eq!(observation.observed_at, "2026-10-08T10:00:00Z");
    assert!(observation.content_hash.as_ref().unwrap().starts_with("sha256:"));
    assert!(observation.resolved_ref_product_id.is_none());
    assert!(!observation.confirmed_by_human);
}

#[test]
fn known_description_targets_reach_the_dependency_query_as_unconfirmed_clues() {
    let world = make_world("description-known-target");
    let frames = run_frames(&world, &[
        product_page_request("902", ""),
        product_page_request("901", r#"<a href="https://booth.pm/ja/items/902">Sample base</a>"#),
        json!({"method":"dependencies.listByProduct", "params":{"productId":"booth:901"}}),
    ]);
    assert_eq!(frames[1]["payload"]["ok"], true, "{}", frames[1]);
    assert_eq!(frames[2]["payload"]["ok"], true, "{}", frames[2]);
    let observations = world.bdl.dependency_observations("booth:901").unwrap();
    assert_eq!(observations.len(), 1);
    assert_eq!(observations[0].dep_kind, "other");
    assert_eq!(observations[0].resolved_ref_product_id.as_deref(), Some("booth:902"));
    assert_eq!(observations[0].resolution_evidence.as_ref().unwrap().len(), 1);
    assert!(!observations[0].confirmed_by_human);
    let served = frames[2]["payload"]["value"]["result"]["observations"].as_array().unwrap();
    assert_eq!(served.len(), 1);
    assert_eq!(served[0]["depName"], "Sample base");
}

#[test]
fn dependency_storage_failure_is_returned_instead_of_an_empty_success() {
    let world = make_world("description-store-failure");
    rusqlite::Connection::open(world.base.join("bdl/bdl.db")).unwrap().execute_batch(
        "CREATE TRIGGER synthetic_dependency_rejection BEFORE INSERT ON dependency_observations BEGIN SELECT RAISE(FAIL, 'synthetic dependency rejection'); END;"
    ).unwrap();
    let frames = run_frames(&world, &[product_page_request("901",
        r#"<a href="https://booth.pm/items/902">Sample base</a>"#,
    )]);
    assert_eq!(frames[0]["payload"]["ok"], false);
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.catalog.store_failed");
    assert!(world.bdl.catalog_detail("booth:901").unwrap().is_some());
    assert!(world.bdl.dependency_observations("booth:901").unwrap().is_empty());
}

#[test]
fn rejected_source_products_do_not_attempt_dependency_writes() {
    let world = make_world("description-source-failure");
    rusqlite::Connection::open(world.base.join("bdl/bdl.db")).unwrap().execute_batch(
        "CREATE TRIGGER synthetic_source_rejection BEFORE INSERT ON products BEGIN SELECT RAISE(FAIL, 'synthetic source rejection'); END;"
    ).unwrap();
    let frames = run_frames(&world, &[product_page_request("901",
        r#"<a href="https://booth.pm/items/902">Sample base</a>"#,
    )]);
    assert_eq!(frames[0]["payload"]["ok"], false);
    assert!(world.bdl.dependency_observations_all().unwrap().is_empty());
}

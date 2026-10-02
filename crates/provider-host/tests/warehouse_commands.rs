//! Warehouse command face wire tests (proposal 005 + 010; bdl-commands
//! v0.3 — the trio, the global default, the M5 batch import, and the
//! recipe/plan document face).
//!
//! The host consumes the data-side frozen vectors from
//! `schemas/bdl-commands/v0.2/examples` through the real frame loop:
//! `warehouse.setArtifactMode` applies synchronously and reports the
//! entry's effective mode read back from the store (override ?? composed
//! global default); `warehouse.setGlobalDefaultMode` persists the global
//! level and reports the stored fact read back; the tasked commands
//! return a task acceptance that validates against the frozen result
//! schema and persists on the SQLite task authority. Guards fire inside
//! the tasks, never at admission; generation without a Unity executor is
//! an honest typed unavailable. Changing the wire vocabulary without
//! updating schema, vectors and this consumer fails here first.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use vua_bdl_store::{ArtifactMode, BdlStore};
use vua_orchestrator::{
    ResultStatus, UnityBridge, UnityCommand, UnityOperation, UnityResult,
};
use vua_provider_host::{run_provider_host_with_services, WarehouseConfig};

fn command_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/bdl-commands/v0.5")
}

fn read_json(relative: &str) -> Value {
    let bytes = fs::read(command_dir().join(relative)).expect("schema/vector must exist");
    serde_json::from_slice(&bytes).expect("schema/vector must be valid JSON")
}

fn result_validator() -> jsonschema::Validator {
    let schema = read_json("result.schema.json");
    jsonschema::validator_for(&schema).expect("frozen result schema must compile")
}

static SEQUENCE: AtomicU32 = AtomicU32::new(0);

struct World {
    base: PathBuf,
    database_path: PathBuf,
    bdl: Arc<BdlStore>,
    warehouse_item_id: String,
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
        "vua-provider-warehouse-{label}-{}-{nanos}-{serial}",
        std::process::id()
    ));
    fs::create_dir_all(base.join("bdl")).expect("temp layout");
    let bdl = Arc::new(BdlStore::open(base.join("bdl").join("bdl.db")).expect("BDL opens"));
    let item = bdl
        .create_warehouse_item("vector entry", "imported_material", "2026-09-07T00:00:00.000Z")
        .expect("seed entry");
    World {
        database_path: base.join("tasks.db"),
        warehouse_item_id: item.warehouse_item_id,
        bdl,
        base,
    }
}

/// Wraps a frozen command payload into a v0.1 request envelope and runs it
/// through the real frame loop with the warehouse wired.
fn run_frames(world: &World, correlation_id: &str, commands: &[Value]) -> Vec<Value> {
    let mut input = String::new();
    for command in commands {
        let frame = json!({
            "frameVersion": "0.1",
            "frameId": format!("frame-{}", commands.iter().position(|c| c == command).unwrap_or_default()),
            "kind": "request",
            "payload": {
                "contractVersion": "0.1",
                "requestId": "req-1",
                "correlationId": correlation_id,
                "kind": "command",
                "method": command["operation"],
                "params": command["params"],
            },
        });
        input.push_str(&frame.to_string());
        input.push('\n');
    }
    let warehouse = WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    };
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(input),
        &mut output,
        &world.database_path,
        None,
        None,
        Some(warehouse),
        None,
    )
    .expect("the frame loop must stay alive for warehouse vectors");
    // Only the request/response face is asserted here: the frame loop now also
    // emits runtime-notification event frames (task lifecycle + persistence
    // failures) for tasked warehouse commands — dropping them keeps every
    // vector pinned to its response shape.
    String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).expect("output lines are frames"))
        .filter(|frame| frame["kind"] == "response")
        .collect()
}

/// Rewrites a request vector's params onto the seeded entry id.
fn reworded(request: &Value, warehouse_item_id: &str) -> Value {
    let mut command = request.clone();
    command["params"]["warehouseItemId"] = json!(warehouse_item_id);
    command
}

/// Rewrites a result vector's entry id (result vectors carry no params).
fn reworded_result(result: &Value, warehouse_item_id: &str) -> Value {
    let mut command = result.clone();
    command["warehouseItemId"] = json!(warehouse_item_id);
    command
}

#[test]
fn warehouse_commands_match_the_frozen_operation_vocabulary() {
    let schema = read_json("command.schema.json");
    let operations = schema["properties"]["operation"]["enum"].as_array().unwrap();
    // These are exactly the methods the host routes (warehouse_request).
    let routed = [
        json!("warehouse.setArtifactMode"),
        json!("warehouse.generateVpm"),
        json!("warehouse.deleteOriginals"),
        json!("warehouse.setGlobalDefaultMode"),
        json!("warehouse.import"),
        json!("warehouse.importDownloads"),
    ];
    assert_eq!(operations, &routed);
}

#[test]
fn set_artifact_mode_vectors_drive_the_host_and_read_back_the_effective_mode() {
    let world = make_world("mode");
    let validator = result_validator();

    // The positive vector (override -> generate_vpm) must round-trip and
    // match the frozen result shape.
    let request = reworded(&read_json("examples/warehouse-set-artifact-mode.request.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-mode-1", &[request]);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["kind"], "response");
    let value = &frames[0]["payload"]["value"];
    assert!(
        validator.is_valid(value),
        "the host answer must match the frozen result schema: {value}"
    );
    let expected = reworded_result(&read_json("examples/warehouse-set-artifact-mode.result.json"), &world.warehouse_item_id);
    assert_eq!(value, &expected);

    // The clear vector drops the override: the effective mode falls back to
    // the shell default and is read back from the store, never echoed.
    let clear = reworded(&read_json("examples/warehouse-set-artifact-mode-clear.request.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-mode-2", &[clear]);
    let value = &frames[0]["payload"]["value"];
    assert!(validator.is_valid(value), "{value}");
    let expected = reworded_result(&read_json("examples/warehouse-set-artifact-mode-clear.result.json"), &world.warehouse_item_id);
    assert_eq!(value, &expected);
}

#[test]
fn set_artifact_mode_rejects_invalid_vocabulary_and_unknown_entries() {
    let world = make_world("mode-guards");
    let validator = result_validator();

    // A mode outside the frozen closed set is a params violation, never a
    // silent store write (invalid-mode vector, reworded entry id included).
    let invalid = reworded(&read_json("examples/invalid-mode.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-mode-invalid", &[invalid]);
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.invalid_params");

    // An unknown entry is the frozen validation code.
    let request = read_json("examples/warehouse-set-artifact-mode.request.json");
    let frames = run_frames(&world, "corr-mode-unknown", &[request]);
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.entry_not_found");

    // Every error path stays an application error: it never validates as a
    // frozen result.
    assert!(!validator.is_valid(&frames[0]["payload"]["error"]));
}

#[test]
fn tasked_commands_submit_audited_tasks_on_the_sqlite_authority() {
    let world = make_world("tasked");
    let validator = result_validator();

    // The tasked pair shares one handler and one persistence path; the
    // delete vector needs no Unity executor, so it pins the whole acceptance
    // flow end to end. Guards fire inside the task, never at admission.
    let request = reworded(&read_json("examples/warehouse-delete-originals.request.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-delete-vector", &[request]);
    assert_eq!(frames.len(), 1);
    let value = &frames[0]["payload"]["value"];
    assert!(
        validator.is_valid(value),
        "the acceptance must match the frozen result schema: {value}"
    );
    assert_eq!(value["operation"], "warehouse.deleteOriginals");
    assert_eq!(value["correlationId"], "corr-delete-vector");
    let task_id = value["taskId"].as_str().expect("taskId is a string").to_owned();
    assert!(!task_id.is_empty());

    // The acceptance is durable on the SQLite task authority (task.list can
    // see it), and the in-task guard drives the task to a truthful terminal
    // state — the seeded entry has no verified generated artifact.
    let deadline = Instant::now() + Duration::from_secs(30);
    let state = loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).expect("store opens");
        let task = store.task(&task_id).expect("store readable").expect("accepted task is durable");
        if task.state.is_terminal() {
            break task.state;
        }
        assert!(Instant::now() < deadline, "the task did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(serde_json::to_value(state).unwrap(), "failed");
}

#[test]
fn generate_without_a_unity_executor_is_honestly_unavailable() {
    let world = make_world("no-executor");
    let request = reworded(&read_json("examples/warehouse-generate-vpm.request.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-generate-unavailable", &[request]);
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.unavailable");
    // The rest of the trio keeps working without the executor.
    let mode = reworded(&read_json("examples/warehouse-set-artifact-mode-clear.request.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-mode-still-works", &[mode]);
    assert_eq!(frames[0]["payload"]["ok"], true);
}

#[test]
fn warehouse_commands_are_unavailable_without_wiring() {
    let world = make_world("unwired");
    let request = reworded(&read_json("examples/warehouse-set-artifact-mode.request.json"), &world.warehouse_item_id);
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-unwired",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-unwired",
            "correlationId": "corr-unwired",
            "kind": "command",
            "method": request["operation"],
            "params": request["params"],
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
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.unavailable");
}

#[test]
fn set_global_default_mode_vector_drives_the_persisted_global_level() {
    let world = make_world("global-default");
    let validator = result_validator();

    // Before any write the global level is not persisted: the environment
    // initial default rules, and the clear vector's read-back reports it.
    let clear = reworded(&read_json("examples/warehouse-set-artifact-mode-clear.request.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-global-before", &[clear]);
    assert_eq!(frames[0]["payload"]["value"]["effectiveMode"], "use_original_unitypackage");
    assert_eq!(world.bdl.global_default_mode().unwrap(), None);

    // The frozen positive vector drives the wire write; the acceptance is
    // the frozen result document with the stored fact read back.
    let request = read_json("examples/warehouse-set-global-default.request.json");
    let frames = run_frames(&world, "corr-global-write", &[request]);
    assert_eq!(frames[0]["kind"], "response");
    let value = &frames[0]["payload"]["value"];
    assert!(
        validator.is_valid(value),
        "the acceptance must match the frozen result schema: {value}"
    );
    let expected = read_json("examples/warehouse-set-global-default.result.json");
    assert_eq!(value, &expected);
    // The persisted fact (not an echo path) now rules the global level.
    assert_eq!(world.bdl.global_default_mode().unwrap(), Some(ArtifactMode::GenerateVpm));

    // Two-level resolution follows the persisted global: the same clear
    // vector now reports generate_vpm for the override-less entry.
    let clear = reworded(&read_json("examples/warehouse-set-artifact-mode-clear.request.json"), &world.warehouse_item_id);
    let frames = run_frames(&world, "corr-global-after", &[clear]);
    assert_eq!(frames[0]["payload"]["value"]["effectiveMode"], "generate_vpm");

    // The entry level still wins over the persisted global default.
    let mut override_request = reworded(&read_json("examples/warehouse-set-artifact-mode.request.json"), &world.warehouse_item_id);
    override_request["params"]["mode"] = json!("use_original_unitypackage");
    let frames = run_frames(&world, "corr-global-entry-wins", &[override_request]);
    assert_eq!(frames[0]["payload"]["value"]["effectiveMode"], "use_original_unitypackage");
}

#[test]
fn set_global_default_mode_rejects_null_missing_and_unknown_modes() {
    let world = make_world("global-default-guards");
    let validator = result_validator();

    // The frozen negative vector: the global level has no null — the default
    // always has a value, so an explicit null is a params violation.
    let null_mode = read_json("examples/invalid-global-default-mode.json");
    let frames = run_frames(&world, "corr-global-null", &[null_mode]);
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.invalid_params");

    // A missing mode is likewise a params violation, not a no-op.
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-global-missing",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-global-missing",
            "correlationId": "corr-global-missing",
            "kind": "command",
            "method": "warehouse.setGlobalDefaultMode",
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
        Some(WarehouseConfig {
            bdl: world.bdl.clone(),
            warehouse_root: world.base.join("warehouse"),
            global_default: ArtifactMode::UseOriginalUnitypackage,
            executor: None,
            dependencies_queries: None,
        }),
        None,
    )
    .expect("frame loop runs");
    let frames: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.invalid_params");

    // Nothing was persisted along the failure paths.
    assert_eq!(world.bdl.global_default_mode().unwrap(), None);
    // Every error path stays an application error: it never validates as a
    // frozen result.
    assert!(!validator.is_valid(&frames[0]["payload"]["error"]));
}

#[test]
fn import_vector_drives_the_batch_import_task_and_lands_entries() {
    let world = make_world("import");
    let validator = result_validator();

    // Two real source folders (one folder = one material package), standing
    // in for the vector's kernel-resolved absolute paths.
    let folder_a = world.base.join("imports").join("pack-a");
    let folder_b = world.base.join("imports").join("pack-b");
    for folder in [&folder_a, &folder_b] {
        fs::create_dir_all(folder).expect("source folder");
        fs::write(folder.join("material-pack.unitypackage"), b"PK fixture").expect("package file");
    }

    // The frozen request vector, reworded onto the temp folders.
    let request = read_json("examples/warehouse-import.request.json");
    let mut params = request["params"].clone();
    params["sourceFolders"] = json!([
        folder_a.to_string_lossy(),
        folder_b.to_string_lossy()
    ]);
    let command = json!({ "operation": "warehouse.import", "params": params });
    let frames = run_frames(&world, "corr-import-vector", &[command]);
    assert_eq!(frames.len(), 1);
    let value = &frames[0]["payload"]["value"];
    assert!(
        validator.is_valid(value),
        "the acceptance must match the frozen result schema: {value}"
    );
    assert_eq!(value["operation"], "warehouse.import");
    assert_eq!(value["correlationId"], "corr-import-vector");
    let task_id = value["taskId"].as_str().expect("taskId is a string").to_owned();

    // The batch-import task runs to Done on the SQLite task authority, and
    // both folders land as warehouse entries (the wire face really imports).
    let deadline = Instant::now() + Duration::from_secs(30);
    let state = loop {
        let store =
            vua_orchestrator::SqliteTaskStore::open(&world.database_path).expect("store opens");
        let task = store
            .task(&task_id)
            .expect("store readable")
            .expect("accepted task is durable");
        if task.state.is_terminal() {
            break task.state;
        }
        assert!(Instant::now() < deadline, "the import task did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(serde_json::to_value(state).unwrap(), "succeeded");
    let cards = world.bdl.warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage).unwrap();
    let mut names: Vec<&str> = cards.iter().map(|card| card.display_name.as_str()).collect();
    names.sort_unstable();
    // make_world seeds one fixture entry besides the two imported folders.
    assert_eq!(
        names,
        ["pack-a", "pack-b", "vector entry"],
        "both folders must land as entries"
    );
}

#[test]
fn import_negative_vectors_are_params_violations() {
    let world = make_world("import-guards");

    // The frozen negative vectors: an empty folder list and a non-string
    // element are params violations, never a silently empty import.
    for name in [
        "examples/invalid-import-empty-folders.json",
        "examples/invalid-import-folders-type.json",
    ] {
        let request = read_json(name);
        let command = json!({ "operation": "warehouse.import", "params": request["params"].clone() });
        let frames = run_frames(&world, "req-import-invalid", &[command]);
        assert_eq!(
            frames[0]["payload"]["error"]["code"],
            "vua.warehouse.invalid_params",
            "{name}"
        );
    }

    // An unknown params key is a contract error too (closed set).
    let command = json!({
        "operation": "warehouse.import",
        "params": { "sourceFolders": ["C:/tmp/imports/pack-x"], "recursive": true }
    });
    let frames = run_frames(&world, "req-import-unknown", &[command]);
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.warehouse.invalid_params");
}

// --- W20 production-use-case v0.2 first cut: the recipe document face ---

/// A Bridge stub whose v2 receipt carries one executed step (the honest
/// shape the Build Record v0.3 transposition consumes).
struct NoBridge;

impl UnityBridge for NoBridge {
    fn execute(
        &self,
        _project: &vua_orchestrator::ProjectRef,
        command: &UnityCommand,
    ) -> Result<UnityResult, vua_orchestrator::BridgeError> {
        Ok(UnityResult {
            schema_version: 2,
            command_id: command.command_id.clone(),
            status: ResultStatus::Succeeded,
            changed_paths: vec![],
            diagnostics: vec![],
            data: serde_json::json!({
                "projectFingerprint": "fp-plan",
                "planHash": command.payload.plan_hash,
                "dryRun": command.dry_run,
                "steps": [{
                    "kind": command
                        .payload
                        .plan_ref
                        .clone()
                        .unwrap_or_default(),
                    "status": "executed"
                }]
            }),
            steps: Vec::new(),
            replayed: None,
            snapshot_id: None,
            restored_from: None,
            project_fingerprint_before: None,
        })
    }
}


fn run_recipe_frames(world: &World, request_id: &str, method: &str, params: Value) -> Vec<Value> {
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": format!("frame-{request_id}"),
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": request_id,
            "correlationId": format!("corr-{request_id}"),
            "kind": "command",
            "method": method,
            "params": params,
        },
    });
    let use_cases = {
        let production_root = world.base.join("production");
        let bridge: std::sync::Arc<dyn vua_orchestrator::UnityBridge> =
            std::sync::Arc::new(NoBridge);
        vua_provider_host::ProductionUseCaseConfig {
            recipes: std::sync::Arc::new(vua_orchestrator::RecipeDocumentStore
                ::new_with_system_clock(production_root.join("recipes"))),
            plans: std::sync::Arc::new(vua_orchestrator::PlanDocumentStore
                ::new(production_root.join("plans"))),
            evidence: std::sync::Arc::new(vua_orchestrator::EvidenceStore
                ::new(production_root.join("evidence"))),
            records: std::sync::Arc::new(vua_orchestrator::RecipeRecordStore
                ::new(production_root.join("records"))),
        inspections: std::sync::Arc::new(vua_orchestrator::InspectionEvidenceStore
            ::new(production_root.join("inspections"))),
        editor_version: "2022.3.22f1".to_owned(),
            bridge,
            editor_selection: vua_orchestrator::EditorSelection::Unavailable {
                reason: vua_orchestrator::EditorSelectionGap::NotDetected,
            },
            project_root: world.base.join("project"),
            handoff: None,
            draft_exporter: None,
        }
    };
    let mut output = Vec::new();
    vua_provider_host::run_provider_host_with_services(
        Cursor::new(format!("{frame}
")),
        &mut output,
        &world.database_path,
        None,
        None,
        None,
        Some(use_cases),
    )
    .expect("frame loop runs");
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn recipe_save_get_list_drive_the_document_store_over_the_wire() {
    let world = make_world("recipes");
    let recipe_id = "019e0000-0000-7000-8000-000000000301";

    // Create: base_revision 0 -> revision 1.
    let save = json!({
        "recipeDocument": {
            "formatVersion": "0.3",
            "recipeId": recipe_id,
            "revision": 1,
            "title": "Sailor Set"
        },
        "baseRevision": 0
    });
    let frames = run_recipe_frames(&world, "req-save", "recipe.save", save);
    assert_eq!(frames[0]["payload"]["ok"], true);
    assert_eq!(frames[0]["payload"]["value"]["revision"], 1);
    assert_eq!(frames[0]["payload"]["value"]["recipeId"], recipe_id);

    // get reads back the stored document.
    let frames = run_recipe_frames(
        &world,
        "req-get",
        "recipe.get",
        json!({ "recipeId": recipe_id }),
    );
    let value = &frames[0]["payload"]["value"];
    assert_eq!(value["recipeDocument"]["title"], "Sailor Set");
    assert_eq!(value["revision"], 1);

    // A stale base (the store is at revision 1; the request assumes 5) is a
    // typed conflict that names the current revision.
    let stale = json!({
        "recipeDocument": {
            "formatVersion": "0.3", "recipeId": recipe_id,
            "revision": 6, "title": "Sailor Set v2"
        },
        "baseRevision": 5
    });
    let frames = run_recipe_frames(&world, "req-save2", "recipe.save", stale);
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.recipe.revision_conflict");
    assert_eq!(frames[0]["payload"]["error"]["currentRevision"], 1);

    // Matching base bumps the revision.
    let newer = json!({
        "recipeDocument": {
            "formatVersion": "0.3", "recipeId": recipe_id,
            "revision": 2, "title": "Sailor Set v2"
        },
        "baseRevision": 1
    });
    let frames = run_recipe_frames(&world, "req-save3", "recipe.save", newer);
    assert_eq!(frames[0]["payload"]["value"]["revision"], 2);

    // list: identity entries with pagination, newest update first.
    let frames = run_recipe_frames(&world, "req-list", "recipe.list", json!({}));
    let entries = &frames[0]["payload"]["value"]["entries"];
    assert!(
        entries.as_array().unwrap().iter().any(|e| e["recipeId"] == *recipe_id),
        "{entries}"
    );
    assert_eq!(frames[0]["payload"]["value"]["total"], 1);
}

#[test]
fn recipe_face_closed_set_and_absence_are_typed() {
    let world = make_world("recipes-guards");

    // Unknown params key is a contract error (closed set).
    let frames = run_recipe_frames(
        &world,
        "req-save-unknown",
        "recipe.save",
        json!({
            "recipeDocument": {"formatVersion": "0.3", "recipeId": "r1", "revision": 1, "title": "x"},
            "baseRevision": 0,
            "force": true
        }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.recipe.invalid_params");

    // Missing baseRevision is a params violation, not an implicit create.
    let frames = run_recipe_frames(
        &world,
        "req-save-nobase",
        "recipe.save",
        json!({
            "recipeDocument": {"formatVersion": "0.3", "recipeId": "r1", "revision": 1, "title": "x"}
        }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.recipe.invalid_params");

    // get of an absent recipe is the frozen not-found.
    let frames = run_recipe_frames(
        &world,
        "req-get-miss",
        "recipe.get",
        json!({ "recipeId": "019e0000-0000-7000-8000-000000000fff" }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.recipe.not_found");

    // Without the use-case wiring the face is honestly unavailable.
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-unwired",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-unwired",
            "correlationId": "corr-unwired",
            "kind": "command",
            "method": "recipe.save",
            "params": {}
        }
    });
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(format!("{frame}
")),
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
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.recipe.unavailable");
}

fn run_plan_frames(
    world: &World,
    use_cases: vua_provider_host::ProductionUseCaseConfig,
    request_id: &str,
    method: &str,
    params: Value,
) -> Vec<Value> {
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": format!("frame-{request_id}"),
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": request_id,
            "correlationId": format!("corr-{request_id}"),
            "kind": "command",
            "method": method,
            "params": params,
        },
    });
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(format!("{frame}
")),
        &mut output,
        &world.database_path,
        None,
        None,
        None,
        Some(use_cases),
    )
    .expect("frame loop runs");
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn use_case_config(world: &World) -> vua_provider_host::ProductionUseCaseConfig {
    let production_root = world.base.join("production");
    vua_provider_host::ProductionUseCaseConfig {
        recipes: std::sync::Arc::new(vua_orchestrator::RecipeDocumentStore
            ::new_with_system_clock(production_root.join("recipes"))),
        plans: std::sync::Arc::new(vua_orchestrator::PlanDocumentStore
            ::new(production_root.join("plans"))),
        evidence: std::sync::Arc::new(vua_orchestrator::EvidenceStore
            ::new(production_root.join("evidence"))),
        records: std::sync::Arc::new(vua_orchestrator::RecipeRecordStore
            ::new(production_root.join("records"))),
        inspections: std::sync::Arc::new(vua_orchestrator::InspectionEvidenceStore
            ::new(production_root.join("inspections"))),
        editor_version: "2022.3.22f1".to_owned(),
        bridge: std::sync::Arc::new(NoBridge),
        editor_selection: vua_orchestrator::EditorSelection::Unavailable {
            reason: vua_orchestrator::EditorSelectionGap::NotDetected,
        },
            project_root: world.base.join("project"),
            handoff: None,
            draft_exporter: None,
    }
}

#[test]
fn plan_approve_flow_is_idempotent_and_read_face_carries_the_status() {
    let world = make_world("plan");
    let config = use_case_config(&world);
    let plan_id = "019e0000-0000-7000-8000-000000000301";

    // Seed a draft plan directly into the plan store (the resolve executor
    // arrives in the next cut; the approval face is independent of it).
    config
        .plans
        .publish_draft(
            plan_id,
            &json!({
                "schemaVersion": "0.3",
                "planId": plan_id,
                "recipeId": "019e0000-0000-7000-8000-000000000001",
                "recipeRevision": 1,
                "localResolutionId": "019e0000-0000-7000-8000-000000000202",
                "environmentId": "019e0000-0000-7000-8000-000000000100",
                "createdAt": "2026-09-09T00:30:00.000Z",
                "approvedAt": "2026-09-09T00:30:00.000Z",
                "planHash": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
                "fingerprint": {"expectedProjectFingerprint": "projfp-1"},
                "target": {"avatarInstanceId": "avatar_root"},
                "jobs": [{"jobId": "019e0000-0000-7000-8000-000000000210",
                          "kind": "install_modular_asset", "inputs": {}}],
                "status": "draft"
            }),
        )
        .expect("draft published");

    // plan.get carries the draft status.
    let frames = run_plan_frames(
        &world, config.clone(), "req-plan-get", "plan.get",
        json!({ "planId": plan_id }),
    );
    assert_eq!(frames[0]["payload"]["value"]["planStatus"], "draft");

    // approve flips draft -> approved (the explicit user authorization act).
    let frames = run_plan_frames(
        &world, config.clone(), "req-approve", "plan.approve",
        json!({ "planId": plan_id }),
    );
    assert_eq!(frames[0]["payload"]["value"]["planStatus"], "approved");

    // Approving again is an idempotent success.
    let frames = run_plan_frames(
        &world, config.clone(), "req-approve-2", "plan.approve",
        json!({ "planId": plan_id }),
    );
    assert_eq!(frames[0]["payload"]["value"]["planStatus"], "approved");

    // plan.get now carries the approved status.
    let frames = run_plan_frames(
        &world, config.clone(), "req-plan-get-2", "plan.get",
        json!({ "planId": plan_id }),
    );
    assert_eq!(frames[0]["payload"]["value"]["planStatus"], "approved");

    // Unknown plan is the frozen not-found.
    let frames = run_plan_frames(
        &world, config.clone(), "req-plan-miss", "plan.get",
        json!({ "planId": "019e0000-0000-7000-8000-000000000fff" }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.plan.not_found");

    // Superseded plans refuse approval with a typed conflict.
    config.plans.supersede(plan_id).unwrap();
    let frames = run_plan_frames(
        &world, config, "req-approve-super", "plan.approve",
        json!({ "planId": plan_id }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.plan.not_approvable");
}

#[test]
fn plan_face_without_wiring_and_unknown_methods_are_typed() {
    let world = make_world("plan-guards");
    let use_cases = use_case_config(&world);

    // Missing planId is a params violation.
    let frames = run_plan_frames(
        &world, use_cases.clone(), "req-plan-noid", "plan.approve", json!({}),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.plan.invalid_params");

    // plan.list is served (the identity listing over stored plans); the
    // Local Resolution executor arrives in the next cut and stays a typed
    // unavailable via recipe.resolve.
    let frames = run_plan_frames(
        &world, use_cases, "req-plan-unwired", "plan.list", json!({}),
    );
    assert_eq!(frames[0]["payload"]["value"]["total"], 0);
    assert_eq!(frames[0]["payload"]["value"]["entries"], json!([]));
}

#[test]
fn record_get_reads_the_frozen_record_shape_over_the_wire() {
    let world = make_world("record-get");
    let build_id = "019e0000-0000-7000-8000-000000000401";
    let document = json!({
        "schemaVersion": "0.3",
        "buildId": build_id,
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "recipeRevision": 1,
        "planId": "019e0000-0000-7000-8000-000000000201",
        "planHash": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "planSchemaVersion": "0.3",
        "environmentId": "019e0000-0000-7000-8000-000000000100",
        "startedAt": "2026-09-09T00:30:00.000Z",
        "finishedAt": "2026-09-09T00:31:00.000Z",
        "status": "succeeded",
        "inputs": {
            "recipeDigest": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
            "localResolutionDigest": "sha256:3333333333333333333333333333333333333333333333333333333333333333",
            "planHash": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
        },
        "jobs": [],
        "recoveryPoints": [],
        "evidenceSummary": {"evidenceIds": []}
    });
    let config = use_case_config(&world);
    config.records.publish(build_id, &document).expect("record published");

    // Positive: the stored record reads back under its identity.
    let frames = run_plan_frames(
        &world, config.clone(), "req-record-get", "record.get",
        json!({ "buildId": build_id }),
    );
    assert_eq!(frames[0]["payload"]["value"]["buildId"], build_id);
    assert_eq!(
        frames[0]["payload"]["value"]["recordDocument"]["status"],
        "succeeded"
    );

    // Absent records are the frozen not-found.
    let frames = run_plan_frames(
        &world, config.clone(), "req-record-miss", "record.get",
        json!({ "buildId": "019e0000-0000-7000-8000-000000000fff" }),
    );
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.record.not_found");

    // Missing buildId is a params violation.
    let frames = run_plan_frames(&world, config, "req-record-noid", "record.get", json!({}));
    assert_eq!(frames[0]["payload"]["error"]["code"], "vua.record.invalid_params");
}

fn run_frames_with_use_cases(
    world: &World,
    use_cases: &vua_provider_host::ProductionUseCaseConfig,
    warehouse: Option<&vua_provider_host::WarehouseConfig>,
    correlation_id: &str,
    commands: &[Value],
) -> Vec<Value> {
    let mut input = String::new();
    for (index, command) in commands.iter().enumerate() {
        let frame = json!({
            "frameVersion": "0.1",
            "frameId": format!("frame-{correlation_id}-{index}"),
            "kind": "request",
            "payload": {
                "contractVersion": "0.1",
                "requestId": format!("req-{correlation_id}-{index}"),
                "correlationId": format!("corr-{correlation_id}-{index}"),
                "kind": "command",
                "method": command["operation"],
                "params": command["params"],
            },
        });
        input.push_str(&frame.to_string());
        input.push('\n');
    }
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(input),
        &mut output,
        &world.database_path,
        None,
        None,
        warehouse.cloned(),
        Some(use_cases.clone()),
    )
    .expect("the frame loop must stay alive");
    String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect()
}

#[test]
fn resolve_flow_generates_a_draft_plan_from_imported_entries() {
    let world = make_world("resolve");
    let production_root = world.base.join("production");
    let use_cases = vua_provider_host::ProductionUseCaseConfig {
        recipes: std::sync::Arc::new(vua_orchestrator::RecipeDocumentStore
            ::new_with_system_clock(production_root.join("recipes"))),
        plans: std::sync::Arc::new(vua_orchestrator::PlanDocumentStore
            ::new(production_root.join("plans"))),
        evidence: std::sync::Arc::new(vua_orchestrator::EvidenceStore
            ::new(production_root.join("evidence"))),
        records: std::sync::Arc::new(vua_orchestrator::RecipeRecordStore
            ::new(production_root.join("records"))),
        inspections: std::sync::Arc::new(vua_orchestrator::InspectionEvidenceStore
            ::new(production_root.join("inspections"))),
        editor_version: "2022.3.22f1".to_owned(),
        bridge: std::sync::Arc::new(NoBridge),
        editor_selection: vua_orchestrator::EditorSelection::Unavailable {
            reason: vua_orchestrator::EditorSelectionGap::NotDetected,
        },
            project_root: world.base.join("project"),
            handoff: None,
            draft_exporter: None,
    };
    // The use-case face rides the warehouse wiring (shared task authority
    // and BDL - Local Resolution reads warehouse facts).
    let warehouse = vua_provider_host::WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    };

    // Seed: two imported folders as warehouse entries (the assets' source),
    // through the acquisition import job (the real production path).
    let folder_a = world.base.join("imports").join("pack-a");
    let folder_b = world.base.join("imports").join("pack-b");
    for folder in [&folder_a, &folder_b] {
        fs::create_dir_all(folder).expect("source folder");
        fs::write(folder.join("material-pack.unitypackage"), b"PK fixture").expect("package file");
    }
    let import_spec = vua_acquisition::WarehouseImportTaskSpec {
        correlation_id: "corr-seed-import".into(),
        source_folders: vec![folder_a.clone(), folder_b.clone()],
        warehouse_root: world.base.join("warehouse"),
        auto_generate: None,
    };
    let import_runtime = vua_orchestrator::TaskRuntime::with_sqlite(
        std::sync::Arc::new(
            vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap(),
        ),
        std::sync::Arc::new(vua_orchestrator::SystemClock),
        std::sync::Arc::new(vua_orchestrator::NanosTaskIdGenerator::default()),
    )
    .expect("import runtime opens");
    let import_accepted = vua_acquisition::submit_warehouse_import(
        &import_runtime,
        world.bdl.clone(),
        std::sync::Arc::new(vua_orchestrator::SystemClock),
        import_spec,
        None,
    )
    .expect("seed import accepted");
    let deadline = Instant::now() + Duration::from_secs(30);
    let import_done = loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap();
        let task = store.task(&import_accepted.task_id).unwrap().unwrap();
        if task.state.is_terminal() {
            break task;
        }
        assert!(Instant::now() < deadline, "seed import did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    };
    let entry_ids: Vec<String> = import_done
        .result
        .as_ref()
        .map(|payload| {
            payload["reports"]
                .as_array()
                .expect("reports")
                .iter()
                .map(|report| {
                    report["entry"]["warehouseItemId"]
                        .as_str()
                        .expect("entry warehouseItemId")
                        .to_owned()
                })
                .collect()
        })
        .unwrap_or_default();
    assert_eq!(entry_ids.len(), 2);

    // The recipe references the imported entries (warehouse source form).
    let recipe_id = "019e0000-0000-7000-8000-000000000001";
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": recipe_id,
        "revision": 1,
        "title": "Resolve Fixture",
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "avatar_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}},
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[1], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "avatar_asset"},
            {"id": "outfit_blue", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "outfit_blue"}
        ]
    });
    let save_command = json!({
        "operation": "recipe.save",
        "params": {"recipeDocument": recipe_document, "baseRevision": 0}
    });
    let frames = run_frames_with_use_cases(
        &world,
        &use_cases,
        Some(&warehouse),
        "corr-recipe-save",
        &[save_command],
    );
    assert_eq!(frames[0]["payload"]["ok"], true);

    // recipe.resolve: the tasked Local Resolution over the saved recipe.
    let resolve_command = json!({
        "operation": "recipe.resolve",
        "params": {"recipeId": recipe_id}
    });
    let frames = run_frames_with_use_cases(
        &world,
        &use_cases,
        Some(&warehouse),
        "corr-resolve",
        &[resolve_command],
    );
    assert_eq!(frames[0]["payload"]["value"]["operation"], "recipe.resolve");
    let task_id = frames[0]["payload"]["value"]["taskId"]
        .as_str()
        .expect("taskId")
        .to_owned();

    // The resolve task runs to Done; its payload carries the draft plan.
    let deadline = Instant::now() + Duration::from_secs(30);
    let done_payload = loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap();
        let task = store.task(&task_id).unwrap().unwrap();
        if task.state.is_terminal() {
            assert_eq!(
                serde_json::to_value(task.state).unwrap(),
                "succeeded",
                "resolve payload: {:?}",
                task.result
            );
            break task.result.expect("done payload");
        }
        assert!(Instant::now() < deadline, "resolve did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    };
    let plan_id = done_payload["planId"].as_str().expect("planId").to_owned();
    assert_eq!(done_payload["missingCount"], 0);

    // The draft plan reads back through plan.get and approves cleanly.
    let approve_command = json!({
        "operation": "plan.approve",
        "params": {"planId": plan_id}
    });
    let frames = run_frames_with_use_cases(
        &world,
        &use_cases,
        Some(&warehouse),
        "corr-approve",
        &[approve_command],
    );
    assert_eq!(frames[0]["payload"]["value"]["planStatus"], "approved");
}


// --- wt-2 batch 178 reverse-audit (BG-12 family): a FAILED BDL store read
// is a typed store failure — never a silently substituted default (the U8
// law: a persisted global default rules every later resolution) and never
// missing-asset evidence (a broken store is not an absent entry; the
// missing arm is honest only for a true Ok(None) absence).

fn resolve_audit_warehouse(world: &World) -> vua_provider_host::WarehouseConfig {
    vua_provider_host::WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    }
}

fn drop_bdl_table(world: &World, table: &str) {
    let connection = rusqlite::Connection::open(world.base.join("bdl").join("bdl.db"))
        .expect("second connection");
    connection
        .execute(&format!("DROP TABLE {table}"), [])
        .expect("table dropped through the second connection");
}

/// Shared body: one warehouse-sourced asset resolves over a BDL store whose
/// read has been sabotaged at the table level; the resolve task must land
/// Failed with the typed store failure, never Succeed on a silent fallback.
fn resolve_fails_with_typed_store_failure(
    label: &str,
    world: &World,
    use_cases: &vua_provider_host::ProductionUseCaseConfig,
    warehouse: &vua_provider_host::WarehouseConfig,
) {
    let recipe_id = "019e0000-0000-7000-8000-000000000431";
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": recipe_id,
        "revision": 1,
        "title": "Reverse Audit Fixture",
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": "synthetic-warehouse-item", "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let save_command = json!({
        "operation": "recipe.save",
        "params": {"recipeDocument": recipe_document, "baseRevision": 0}
    });
    let frames = run_frames_with_use_cases(world, use_cases, Some(warehouse), label, &[save_command]);
    assert_eq!(frames[0]["payload"]["ok"], true, "fixture recipe saves");

    let resolve_command = json!({
        "operation": "recipe.resolve",
        "params": {"recipeId": recipe_id}
    });
    let frames = run_frames_with_use_cases(
        world,
        use_cases,
        Some(warehouse),
        &format!("{label}-resolve"),
        &[resolve_command],
    );
    let task_id = frames[0]["payload"]["value"]["taskId"]
        .as_str()
        .expect("taskId")
        .to_owned();
    let deadline = Instant::now() + Duration::from_secs(30);
    let task = loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap();
        let task = store.task(&task_id).unwrap().unwrap();
        if task.state.is_terminal() {
            break task;
        }
        assert!(Instant::now() < deadline, "resolve did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(
        serde_json::to_value(task.state).unwrap(),
        "failed",
        "a broken store must fail the resolution, not fall back: {:?}",
        task.result
    );
    let error = task.error.expect("the store failure is a typed error");
    assert_eq!(error.code, "vua.warehouse.store_failed");
}

#[test]
fn resolve_global_default_read_failure_is_typed_not_silently_defaulted() {
    let world = make_world("resolve-bdl-meta-failure");
    let use_cases = use_case_config(&world);
    let warehouse = resolve_audit_warehouse(&world);
    // A persisted global default EXISTS and differs from the environment
    // initial — its silent loss to the initial is exactly the swallow this
    // test pins (the old code resolved on `env_initial` instead of failing,
    // breaking the U8 read-time law without a trace).
    world
        .bdl
        .set_global_default_mode(ArtifactMode::GenerateVpm)
        .expect("persisted default");
    drop_bdl_table(&world, "bdl_meta");
    resolve_fails_with_typed_store_failure("resolve-meta", &world, &use_cases, &warehouse);
}

#[test]
fn resolve_entry_detail_read_failure_is_typed_not_missing_evidence() {
    let world = make_world("resolve-entry-failure");
    let use_cases = use_case_config(&world);
    let warehouse = resolve_audit_warehouse(&world);
    // bdl_meta stays intact (the composed default read succeeds); the
    // entry-detail read is the broken leg. The old code treated Err like
    // Ok(None) and published missing-asset evidence — a false statement
    // about world state — and silently skipped the relation's jobs.
    drop_bdl_table(&world, "warehouse_items");
    resolve_fails_with_typed_store_failure("resolve-entry", &world, &use_cases, &warehouse);
}


// --- W22 record-face closeout: job.execute writes the full Build Record ---

/// A scripted Bridge whose v2 receipt steps, status, diagnostics and
/// snapshot identity are fixed by the test (the honest shape the record
/// transposition consumes). Commands seen on the wire are captured so a
/// test can pin exactly what provider-host emitted.
struct ScriptedBridge {
    status: ResultStatus,
    steps: Vec<Value>,
    diagnostics: Vec<vua_orchestrator::Diagnostic>,
    snapshot_id: Option<String>,
    commands: Mutex<Vec<UnityCommand>>,
}

impl UnityBridge for ScriptedBridge {
    fn execute(
        &self,
        _project: &vua_orchestrator::ProjectRef,
        command: &UnityCommand,
    ) -> Result<UnityResult, vua_orchestrator::BridgeError> {
        self.commands.lock().unwrap().push(command.clone());
        Ok(UnityResult {
            schema_version: 2,
            command_id: command.command_id.clone(),
            status: self.status,
            changed_paths: vec![],
            diagnostics: self.diagnostics.clone(),
            data: json!({
                "planHash": command.payload.plan_hash,
                "dryRun": command.dry_run,
                "steps": self.steps,
            }),
            steps: Vec::new(),
            replayed: None,
            snapshot_id: self.snapshot_id.clone(),
            restored_from: None,
            project_fingerprint_before: None,
        })
    }
}

const UUID_V7_VERSION_NIBBLE: usize = 14;

fn assert_uuid_v7(id: &str, label: &str) {
    assert_eq!(id.len(), 36, "{label} must be a uuid: {id}");
    assert_eq!(
        &id[UUID_V7_VERSION_NIBBLE..UUID_V7_VERSION_NIBBLE + 1],
        "7",
        "{label} must carry the v7 version nibble: {id}"
    );
}

/// Imports two real source folders through the acquisition import job and
/// returns the landed warehouse entry ids (the production import path).
fn seed_imported_entries(world: &World) -> Vec<String> {
    let folder_a = world.base.join("imports").join("pack-a");
    let folder_b = world.base.join("imports").join("pack-b");
    for folder in [&folder_a, &folder_b] {
        fs::create_dir_all(folder).expect("source folder");
        fs::write(folder.join("material-pack.unitypackage"), b"PK fixture").expect("package file");
    }
    let import_spec = vua_acquisition::WarehouseImportTaskSpec {
        correlation_id: "corr-seed-import".into(),
        source_folders: vec![folder_a.clone(), folder_b.clone()],
        warehouse_root: world.base.join("warehouse"),
        auto_generate: None,
    };
    let import_runtime = vua_orchestrator::TaskRuntime::with_sqlite(
        Arc::new(vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap()),
        Arc::new(vua_orchestrator::SystemClock),
        Arc::new(vua_orchestrator::NanosTaskIdGenerator::default()),
    )
    .expect("import runtime opens");
    let import_accepted = vua_acquisition::submit_warehouse_import(
        &import_runtime,
        world.bdl.clone(),
        Arc::new(vua_orchestrator::SystemClock),
        import_spec,
        None,
    )
    .expect("seed import accepted");
    let deadline = Instant::now() + Duration::from_secs(30);
    let import_done = loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap();
        let task = store.task(&import_accepted.task_id).unwrap().unwrap();
        if task.state.is_terminal() {
            break task;
        }
        assert!(Instant::now() < deadline, "seed import did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    };
    import_done
        .result
        .as_ref()
        .map(|payload| {
            payload["reports"]
                .as_array()
                .expect("reports")
                .iter()
                .map(|report| {
                    report["entry"]["warehouseItemId"]
                        .as_str()
                        .expect("entry warehouseItemId")
                        .to_owned()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Saves the recipe and runs the tasked resolution; returns the resolve Done
/// payload (planId / missingCount / evidenceIds / skippedJobIds).
/// Creates a fake Unity Hub editor install (`<root>/<version>/Editor`) so
/// the environment precheck observes a Detected install.
fn install_fake_editor(editors_root: &Path, version: &str) {
    fs::create_dir_all(editors_root.join(version).join("Editor"))
        .expect("fake editor layout");
}

#[test]
fn job_execute_environment_precheck_blocks_without_a_matching_editor() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-env-unmet");
    let entry_ids = seed_imported_entries(&world);
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Env Fixture",
        "environment": {"unityVersionConstraint": "2022.3.22f1"},
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    // The selection resolved nothing (no injection, nothing detected): the
    // honest absence the precheck observes.
    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "failed");
    let error = task.error.expect("the environment refusal is a typed error");
    assert_eq!(error.code, "vua.job.environment_unmet");
    // No record exists for the refused execution (nothing executed).
    let records = vua_orchestrator::RecipeRecordStore::new(
        world.base.join("production").join("records"),
    );
    assert_eq!(records.list_documents().expect("records readable").len(), 0);
}

#[test]
fn job_execute_environment_precheck_passes_on_a_confirmed_matching_editor() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-env-met");
    install_fake_editor(&world.base.join("unity-editors"), "2022.3.22f1");
    // U10: the precheck observes the editor this job will ACTUALLY use —
    // the confirmed explicit injection, laid out so the version is
    // observable (Hub layout: <root>/<version>/Editor/Unity.exe).
    let use_cases = vua_provider_host::ProductionUseCaseConfig {
        editor_selection: vua_orchestrator::EditorSelection::Explicit {
            path: world
                .base
                .join("unity-editors")
                .join("2022.3.22f1")
                .join("Editor")
                .join("Unity.exe"),
        },
        ..use_cases.clone()
    };
    let entry_ids = seed_imported_entries(&world);
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Env Match Fixture",
        "environment": {"unityVersionConstraint": "2022.3.22f1"},
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "succeeded",
        "a matching install satisfies the constraint: {:?}", task.error);
}

#[test]
fn job_execute_pins_the_production_command_wire_schema_version_v3() {
    // Core-domain nail (core ruling on the wt-4 v3 seam message): the
    // unity-bridge production face moved to v3 (merge 916c5e0), so the
    // execute_production_job command provider-host emits must carry
    // schemaVersion 3 on the wire. Pinned as a literal on purpose: a
    // future version move in either domain must consciously update this
    // consumer-side test, not silently ride a shared constant.
    let (world, mut use_cases, warehouse) = seeded_production_world("job-execute-wire-v3");
    let entry_ids = seed_imported_entries(&world);
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Wire V3 Fixture",
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "avatar_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}},
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[1], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "avatar_asset"},
            {"id": "outfit_blue", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "outfit_blue"},
            {"id": "exclude_item", "kind": "exclude_object", "assetInstanceId": "avatar_root",
             "selector": {"selectorId": "main_root"}}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    // The scripted receipt mirrors the record-face fixture: first job
    // guard-skipped, second executed against a generated_vpm copy, one
    // pre-job snapshot; two planned jobs, one receipt.
    let fallback_sha = format!("sha256:{}", "b".repeat(64));
    let bridge = Arc::new(ScriptedBridge {
        status: ResultStatus::Succeeded,
        steps: vec![
            json!({"kind": "install_modular_asset", "status": "skipped",
                   "warning": "guard declined the install"}),
            json!({"kind": "exclude_object", "status": "executed",
                   "resolvedSource": {"sourceKind": "generated_vpm", "artifactSha256": fallback_sha}}),
        ],
        diagnostics: vec![],
        snapshot_id: Some("01990000-0000-7000-8000-00000000abcd".to_owned()),
        commands: Mutex::new(Vec::new()),
    });
    use_cases.bridge = bridge.clone();

    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "succeeded",
        "the scripted receipt completes: {:?}", task.error);

    let commands = bridge.commands.lock().unwrap();
    let job = commands
        .iter()
        .find(|command| command.operation == UnityOperation::ExecuteProductionJob)
        .expect("the execute_production_job command reaches the bridge");
    assert_eq!(job.schema_version, 3, "production job wire schemaVersion");
}

#[test]
fn job_execute_environment_precheck_surfaces_observation_failure_honestly() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-env-failed");
    // The assembly-face observation of the Hub root failed (the root is a
    // FILE): the selection carries the failure as an external fact, and the
    // precheck must keep it a retryable failure — never an "unmet" verdict.
    fs::write(world.base.join("unity-editors"), b"not a directory").expect("root as file");
    let use_cases = vua_provider_host::ProductionUseCaseConfig {
        editor_selection: vua_orchestrator::EditorSelection::Unavailable {
            reason: vua_orchestrator::EditorSelectionGap::DetectionFailed {
                reason: "not a directory".into(),
            },
        },
        ..use_cases.clone()
    };
    let entry_ids = seed_imported_entries(&world);
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Env Broken Fixture",
        "environment": {"unityVersionConstraint": "2022.3.22f1"},
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "failed");
    let error = task.error.expect("the observation failure is a typed error");
    assert_eq!(error.code, "vua.job.environment_check_failed");
    assert!(error.recoverable, "an observation failure is retryable, not a config verdict");
}

#[test]
fn job_execute_precheck_holds_the_gate3_line_on_an_auto_selected_candidate() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-env-gate3");
    let entry_ids = seed_imported_entries(&world);
    // A production-target editor was DETECTED and the recipe constraint
    // matches it exactly — still no execution: the selection layer only
    // resolves + presents; the first-use confirmation (desktop settings
    // face) releases execution, and auto-selection never crosses it.
    let use_cases = vua_provider_host::ProductionUseCaseConfig {
        editor_selection: vua_orchestrator::EditorSelection::AutoSelected {
            editor: vua_orchestrator::InstalledUnityEditor {
                parsed: vua_orchestrator::parse_editor_version("2022.3.22f1")
                    .expect("fixture version parses"),
                path: world
                    .base
                    .join("unity-editors")
                    .join("2022.3.22f1")
                    .join("Editor")
                    .join("Unity.exe"),
            },
        },
        ..use_cases.clone()
    };
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Gate3 Fixture",
        "environment": {"unityVersionConstraint": "2022.3.22f1"},
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "failed",
        "a detected candidate without the first-use confirmation never executes");
    let error = task.error.expect("the gate-3 refusal is a typed error");
    assert_eq!(error.code, "vua.job.environment_unmet");
}

#[test]
fn job_execute_precheck_refuses_a_confirmed_editor_that_misses_the_constraint() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-env-offtarget");
    let entry_ids = seed_imported_entries(&world);
    // Sources weigh the same: a confirmed manual pick must satisfy the
    // constraint exactly — an off-target confirmed editor refuses with the
    // observed fact, never a silent use (compatibility policy).
    let use_cases = vua_provider_host::ProductionUseCaseConfig {
        editor_selection: vua_orchestrator::EditorSelection::Explicit {
            path: world
                .base
                .join("unity-editors")
                .join("2019.4.31f1")
                .join("Editor")
                .join("Unity.exe"),
        },
        ..use_cases.clone()
    };
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Off-target Fixture",
        "environment": {"unityVersionConstraint": "2022.3.22f1"},
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "failed",
        "a confirmed off-target editor never silently executes");
    let error = task.error.expect("the refusal is a typed error");
    assert_eq!(error.code, "vua.job.environment_unmet");
}

fn save_and_resolve(
    world: &World,
    use_cases: &vua_provider_host::ProductionUseCaseConfig,
    warehouse: &WarehouseConfig,
    recipe_document: Value,
) -> Value {
    let frames = run_frames_with_use_cases(
        world,
        use_cases,
        Some(warehouse),
        "corr-seed-save",
        &[json!({
            "operation": "recipe.save",
            "params": {"recipeDocument": recipe_document, "baseRevision": 0}
        })],
    );
    assert_eq!(frames[0]["payload"]["ok"], true, "recipe save: {:?}", frames[0]);

    let frames = run_frames_with_use_cases(
        world,
        use_cases,
        Some(warehouse),
        "corr-seed-resolve",
        &[json!({
            "operation": "recipe.resolve",
            "params": {"recipeId": "019e0000-0000-7000-8000-000000000001"}
        })],
    );
    assert_eq!(frames[0]["payload"]["value"]["operation"], "recipe.resolve");
    let task_id = frames[0]["payload"]["value"]["taskId"].as_str().expect("taskId").to_owned();
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap();
        let task = store.task(&task_id).unwrap().unwrap();
        if task.state.is_terminal() {
            assert_eq!(
                serde_json::to_value(task.state).unwrap(),
                "succeeded",
                "resolve payload: {:?}",
                task.result
            );
            return task.result.expect("resolve done payload");
        }
        assert!(Instant::now() < deadline, "resolve did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Approves the plan and submits job.execute; returns the accepted taskId.
fn approve_and_execute(
    world: &World,
    use_cases: &vua_provider_host::ProductionUseCaseConfig,
    warehouse: &WarehouseConfig,
    plan_id: &str,
) -> String {
    let frames = run_frames_with_use_cases(
        world,
        use_cases,
        Some(warehouse),
        "corr-seed-approve",
        &[json!({"operation": "plan.approve", "params": {"planId": plan_id}})],
    );
    assert_eq!(frames[0]["payload"]["value"]["planStatus"], "approved");

    let frames = run_frames_with_use_cases(
        world,
        use_cases,
        Some(warehouse),
        "corr-seed-execute",
        &[json!({"operation": "job.execute", "params": {"planId": plan_id}})],
    );
    frames[0]["payload"]["value"]["taskId"]
        .as_str()
        .expect("execute accepts into a task")
        .to_owned()
}

fn wait_terminal(world: &World, task_id: &str) -> vua_orchestrator::StoredTask {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).unwrap();
        let task = store.task(task_id).unwrap().unwrap();
        if task.state.is_terminal() {
            return task;
        }
        assert!(Instant::now() < deadline, "the execute task did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn seeded_production_world(
    label: &str,
) -> (World, vua_provider_host::ProductionUseCaseConfig, WarehouseConfig) {
    let world = make_world(label);
    let production_root = world.base.join("production");
    let use_cases = vua_provider_host::ProductionUseCaseConfig {
        recipes: Arc::new(vua_orchestrator::RecipeDocumentStore
            ::new_with_system_clock(production_root.join("recipes"))),
        plans: Arc::new(vua_orchestrator::PlanDocumentStore::new(production_root.join("plans"))),
        evidence: Arc::new(vua_orchestrator::EvidenceStore::new(production_root.join("evidence"))),
        records: Arc::new(vua_orchestrator::RecipeRecordStore::new(production_root.join("records"))),
        inspections: Arc::new(vua_orchestrator::InspectionEvidenceStore::new(
            production_root.join("inspections"),
        )),
        editor_version: "2022.3.22f1".to_owned(),
        bridge: Arc::new(NoBridge),
        editor_selection: vua_orchestrator::EditorSelection::Unavailable {
            reason: vua_orchestrator::EditorSelectionGap::NotDetected,
        },
            project_root: world.base.join("project"),
            handoff: None,
            draft_exporter: None,
    };
    let warehouse = WarehouseConfig {
        bdl: world.bdl.clone(),
        warehouse_root: world.base.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: None,
    };
    (world, use_cases, warehouse)
}

#[test]
fn job_execute_writes_the_full_schema_shaped_record() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-full");
    let entry_ids = seed_imported_entries(&world);
    assert_eq!(entry_ids.len(), 2);
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Record Fixture",
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "avatar_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}},
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[1], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "avatar_asset"},
            {"id": "outfit_blue", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "outfit_blue"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();
    assert_uuid_v7(&plan_id, "the resolve planId");
    assert_eq!(done["missingCount"], 0);

    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "succeeded");
    let payload = task.result.expect("execute done payload");
    assert_eq!(payload["status"], "succeeded");
    assert_eq!(payload["jobsRecorded"], 1);
    assert_eq!(payload["deviationsRecorded"], 0);
    let build_id = payload["buildId"].as_str().expect("buildId").to_owned();

    // The record reads back through the wire face with the full anchor
    // chain: digests are real sha256 values, ids are v7-shaped, the
    // receipt transposition carries the plan identity, and no deviation
    // exists on a clean run.
    let frames = run_frames_with_use_cases(
        &world,
        &use_cases,
        Some(&warehouse),
        "corr-seed-record",
        &[json!({"operation": "record.get", "params": {"buildId": build_id}})],
    );
    let record = &frames[0]["payload"]["value"]["recordDocument"];
    assert_eq!(record["schemaVersion"], "0.3");
    assert_eq!(record["status"], "succeeded");
    assert_eq!(record["planId"], json!(plan_id));
    for digest_field in ["recipeDigest", "localResolutionDigest", "planHash"] {
        let digest = record["inputs"][digest_field].as_str().unwrap_or_else(|| {
            panic!("inputs.{digest_field} must be a real digest: {:?}", record["inputs"])
        });
        assert!(
            digest.starts_with("sha256:") && digest.len() == "sha256:".len() + 64,
            "inputs.{digest_field} must be a sha256 anchor: {digest}"
        );
    }
    let jobs = record["jobs"].as_array().expect("record jobs");
    assert_eq!(jobs.len(), 1);
    let job_id = jobs[0]["jobId"].as_str().expect("jobId");
    assert_uuid_v7(job_id, "the recorded jobId");
    assert_eq!(jobs[0]["kind"], "install_modular_asset");
    assert_eq!(jobs[0]["status"], "succeeded");
    assert!(jobs[0]["commandId"].as_str().expect("commandId").starts_with("job-"));
    assert_eq!(jobs[0]["resolvedSourceUsed"]["sourceKind"], "original");
    assert_eq!(record["planDeviations"], json!([]));
    assert_eq!(record["recoveryPoints"], json!([]));
    assert_eq!(record["evidenceSummary"]["evidenceIds"], json!([]));
}

#[test]
fn job_execute_records_typed_deviations_and_the_receipt_snapshot() {
    let (world, mut use_cases, warehouse) = seeded_production_world("job-execute-deviations");
    let entry_ids = seed_imported_entries(&world);
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Deviation Fixture",
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "avatar_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}},
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[1], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "avatar_asset"},
            {"id": "outfit_blue", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "outfit_blue"},
            {"id": "exclude_item", "kind": "exclude_object", "assetInstanceId": "avatar_root",
             "selector": {"selectorId": "main_root"}}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    // The receipt: the first job was guard-skipped, the second executed
    // against a generated_vpm copy instead of the planned original, and a
    // pre-job snapshot was taken. Two planned jobs, one receipt.
    let fallback_sha = format!("sha256:{}", "b".repeat(64));
    use_cases.bridge = Arc::new(ScriptedBridge {
        status: ResultStatus::Succeeded,
        steps: vec![
            json!({"kind": "install_modular_asset", "status": "skipped",
                   "warning": "guard declined the install"}),
            json!({"kind": "exclude_object", "status": "executed",
                   "resolvedSource": {"sourceKind": "generated_vpm", "artifactSha256": fallback_sha}}),
        ],
        diagnostics: vec![],
        snapshot_id: Some("01990000-0000-7000-8000-00000000abcd".to_owned()),
        commands: Mutex::new(Vec::new()),
    });

    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "succeeded");
    let build_id = task.result.expect("payload")["buildId"]
        .as_str()
        .expect("buildId")
        .to_owned();

    let frames = run_frames_with_use_cases(
        &world,
        &use_cases,
        Some(&warehouse),
        "corr-seed-record",
        &[json!({"operation": "record.get", "params": {"buildId": build_id}})],
    );
    let record = &frames[0]["payload"]["value"]["recordDocument"];
    // jobs[] is the receipt-bearing ordered prefix: only the executed step.
    let jobs = record["jobs"].as_array().expect("record jobs");
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0]["status"], "succeeded");
    assert_eq!(jobs[0]["kind"], "exclude_object");
    // The receipt is the authoritative consumed source.
    assert_eq!(jobs[0]["resolvedSourceUsed"]["sourceKind"], "generated_vpm");

    let deviations = record["planDeviations"].as_array().expect("deviations");
    let kinds: Vec<&str> = deviations
        .iter()
        .map(|deviation| deviation["deviationKind"].as_str().expect("deviationKind"))
        .collect();
    assert!(kinds.contains(&"guard_skip"), "guard skip must be typed: {deviations:?}");
    assert!(kinds.contains(&"source_fallback"), "source fallback must be typed: {deviations:?}");
    assert!(kinds.contains(&"partial_completion"), "the truncation must be typed: {deviations:?}");

    let recovery_points = record["recoveryPoints"].as_array().expect("recovery points");
    assert_eq!(recovery_points.len(), 1);
    assert_eq!(recovery_points[0]["phase"], "pre_job");
    assert_eq!(recovery_points[0]["snapshotId"], "01990000-0000-7000-8000-00000000abcd");
}

#[test]
fn job_execute_enforces_the_version_lock_before_execution() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-lock");
    let entry_ids = seed_imported_entries(&world);
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Lock Fixture",
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "outfit_asset", "sourceRef": {"warehouseItemId": entry_ids[0], "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "outfit_asset"}
        ],
        "relations": [
            {"id": "install_outfit", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document.clone());
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    // The recipe is saved again after the plan was resolved: the store
    // revision moves past the plan's lock value.
    let frames = run_frames_with_use_cases(
        &world,
        &use_cases,
        Some(&warehouse),
        "corr-seed-resave",
        &[json!({
            "operation": "recipe.save",
            "params": {"recipeDocument": recipe_document, "baseRevision": 1}
        })],
    );
    assert_eq!(frames[0]["payload"]["ok"], true, "re-save: {:?}", frames[0]);

    // The Bridge must never be reached: the version lock refuses first.
    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "failed");
    let error = task.error.expect("the lock refusal is a typed error");
    assert_eq!(error.code, "vua.recipe.revision_conflict");
    // No record exists for the refused execution (nothing executed).
    let records = vua_orchestrator::RecipeRecordStore::new(
        world.base.join("production").join("records"),
    );
    assert_eq!(records.list_documents().expect("records readable").len(), 0);
}

#[test]
fn job_execute_carries_the_resolution_evidence_chain() {
    let (world, use_cases, warehouse) = seeded_production_world("job-execute-evidence");
    // The recipe references an entry that was never imported: the
    // resolution honestly misses it and publishes evidence.
    let recipe_document = json!({
        "formatVersion": "0.3",
        "recipeId": "019e0000-0000-7000-8000-000000000001",
        "revision": 1,
        "title": "Evidence Fixture",
        "target": {"avatarInstanceId": "avatar_root"},
        "assets": [
            {"id": "ghost_asset",
             "sourceRef": {"warehouseItemId": "019e0000-0000-7000-8000-00000000ffff",
                           "role": "original"}}
        ],
        "instances": [
            {"id": "avatar_root", "assetId": "ghost_asset"}
        ],
        "relations": [
            {"id": "install_ghost", "kind": "install_modular_asset", "assetInstanceId": "avatar_root"}
        ]
    });
    let done = save_and_resolve(&world, &use_cases, &warehouse, recipe_document);
    assert_eq!(done["missingCount"], 1);
    assert_eq!(done["evidenceIds"].as_array().expect("evidence ids").len(), 1);
    assert_eq!(done["skippedJobIds"].as_array().expect("skipped").len(), 1);
    let plan_id = done["planId"].as_str().expect("planId").to_owned();

    // With every job skipped at resolution there is nothing to execute; the
    // empty execution still records the resolution's evidence chain through
    // the localResolutionId back-reference.
    let task_id = approve_and_execute(&world, &use_cases, &warehouse, &plan_id);
    let task = wait_terminal(&world, &task_id);
    assert_eq!(serde_json::to_value(task.state).unwrap(), "succeeded");
    let build_id = task.result.expect("payload")["buildId"]
        .as_str()
        .expect("buildId")
        .to_owned();

    let frames = run_frames_with_use_cases(
        &world,
        &use_cases,
        Some(&warehouse),
        "corr-seed-record",
        &[json!({"operation": "record.get", "params": {"buildId": build_id}})],
    );
    let record = &frames[0]["payload"]["value"]["recordDocument"];
    assert_eq!(record["jobs"], json!([]));
    assert_eq!(
        record["evidenceSummary"]["evidenceIds"]
            .as_array()
            .expect("evidence summary")
            .len(),
        1,
        "the resolution's missing-asset evidence must ride the record: {record}"
    );
}

// --- bdl-commands v0.4: the download-adoption face (warehouse.importDownloads) ---

/// Records one completed delivery in BDL's own event log, backed by a real
/// staging file of exactly `body.len()` bytes (the production ingest path).
fn stage_completed_download(
    consumer: &vua_bdl_store::download_events::DownloadEventConsumer<'_>,
    staging_dir: &Path,
    download_id: &str,
    body: &[u8],
) -> PathBuf {
    use vua_bdl_store::download_events::{DownloadEventKind, DownloadEventV01};
    let staging_path = staging_dir.join(format!("{download_id}-material-pack.zip"));
    fs::write(&staging_path, body).expect("staging file");
    let stored = staging_path.to_string_lossy().into_owned();
    let received = body.len() as u64;
    for kind in [DownloadEventKind::Started, DownloadEventKind::Completed] {
        consumer
            .ingest(&DownloadEventV01 {
                schema_version: "0.1".into(),
                kind,
                download_id: download_id.into(),
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
    staging_path
}

#[test]
fn import_downloads_vector_drives_the_adoption_task_over_the_wire() {
    let validator = result_validator();
    let world = make_world("import-downloads");

    // The frozen request vector: two port-assigned download identities.
    let request = read_json("examples/warehouse-import-downloads.request.json");
    let download_ids: Vec<String> = request["params"]["downloadIds"]
        .as_array()
        .expect("vector ids")
        .iter()
        .map(|value| value.as_str().expect("id string").to_owned())
        .collect();
    assert_eq!(download_ids.len(), 2, "the vector promises a two-download batch");

    // Both deliveries exist in BDL's event log with real staging files.
    let staging_dir = world.base.join("staging");
    fs::create_dir_all(&staging_dir).expect("staging dir");
    let consumer = vua_bdl_store::download_events::DownloadEventConsumer::new(&world.bdl);
    for download_id in &download_ids {
        stage_completed_download(&consumer, &staging_dir, download_id, b"downloaded package bytes");
    }

    let frames = run_frames(&world, "corr-import-downloads", &[json!({
        "operation": "warehouse.importDownloads",
        "params": request["params"].clone(),
    })]);
    let value = &frames[0]["payload"]["value"];
    assert!(
        validator.is_valid(value),
        "the acceptance must match the frozen v0.4 result schema: {value}"
    );
    assert_eq!(value["operation"], "warehouse.importDownloads");
    assert_eq!(value["schemaVersion"], "0.5");
    assert_eq!(value["correlationId"], "corr-import-downloads");
    let task_id = value["taskId"].as_str().expect("taskId").to_owned();

    // The adoption task runs to Done; both downloads land as
    // downloaded_material entries backed by real copied files.
    let deadline = Instant::now() + Duration::from_secs(30);
    let done = loop {
        let store = vua_orchestrator::SqliteTaskStore::open(&world.database_path).expect("store");
        let task = store.task(&task_id).expect("readable").expect("durable");
        if task.state.is_terminal() {
            assert_eq!(
                serde_json::to_value(task.state).unwrap(),
                "succeeded",
                "adoption payload: {:?}",
                task.result
            );
            break task.result.expect("done payload");
        }
        assert!(Instant::now() < deadline, "the adoption task did not finish");
        drop(store);
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(done["downloadsRequested"], 2);
    assert_eq!(done["downloadsAdopted"], 2);

    let cards = world
        .bdl
        .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
        .expect("cards read");
    let mut names: Vec<&str> = cards.iter().map(|card| card.display_name.as_str()).collect();
    names.sort_unstable();
    // make_world seeds one fixture entry besides the two adopted downloads.
    // The adopter names entries after the suggested file name with the
    // archive extension stripped.
    assert_eq!(
        names,
        ["material-pack", "material-pack", "vector entry"],
        "both downloads land as adopted entries"
    );
}

#[test]
fn import_downloads_negative_vectors_are_params_violations() {
    let world = make_world("import-downloads-guards");

    // The frozen negative vectors: empty ids, wrong id type, missing ids,
    // and a client-asserted staging path (the path is a server-side fact).
    for name in [
        "examples/invalid-import-downloads-empty-ids.json",
        "examples/invalid-import-downloads-ids-type.json",
        "examples/invalid-import-downloads-missing-ids.json",
        "examples/invalid-import-downloads-client-path.json",
    ] {
        let request = read_json(name);
        let command = json!({
            "operation": "warehouse.importDownloads",
            "params": request["params"].clone(),
        });
        let frames = run_frames(&world, "req-import-downloads-invalid", &[command]);
        assert_eq!(
            frames[0]["payload"]["error"]["code"],
            "vua.warehouse.invalid_params",
            "{name}"
        );
    }
}

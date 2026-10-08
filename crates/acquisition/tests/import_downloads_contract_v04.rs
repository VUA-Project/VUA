//! Contract anchor for `schemas/bdl-commands/v0.5` (M6 download adoption —
//! user ruling U7-③ / IMP-3 contract-first slice): the
//! `warehouse.importDownloads` vector drives the real adoption task, the
//! acceptance payload validates back against the frozen result schema, the
//! negative vectors stay rejected, and the v0.4 closed set is exactly the
//! six commands.
//!
//! The five v0.3 commands travel into v0.4 unchanged (their semantics stay
//! anchored by `import_contract_v03.rs` / `bdl_commands_contract.rs`); this
//! file anchors the new adoption face. The transport envelope (requestId,
//! commandId) belongs to the application contract.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use vua_acquisition::warehouse_download_adopt::{
    submit_warehouse_import_downloads, WarehouseDownloadAdoptTaskSpec,
};
use vua_bdl_store::bdl_store::BdlStore;
use vua_bdl_store::download_events::{
    DownloadEventConsumer, DownloadEventKind, DownloadEventV01,
};
use vua_orchestrator::{FixedIdGenerator, MemoryJournal, SystemClock, TaskRuntime};

fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/bdl-commands/v0.5")
}

fn read_json(relative: &str) -> Value {
    let bytes = std::fs::read(schema_dir().join(relative)).expect("schema/vector must exist");
    serde_json::from_slice(&bytes).expect("schema/vector must be valid JSON")
}

fn command_validator() -> jsonschema::Validator {
    jsonschema::validator_for(&read_json("command.schema.json")).unwrap()
}

fn result_validator() -> jsonschema::Validator {
    jsonschema::validator_for(&read_json("result.schema.json")).unwrap()
}

const IMPORT_DOWNLOADS_REQUEST: &str = "examples/warehouse-import-downloads.request.json";
const IMPORT_DOWNLOADS_RESULT: &str = "examples/warehouse-import-downloads.result.json";
const IMPORT_DOWNLOADS_NEGATIVES: &[&str] = &[
    "examples/invalid-import-downloads-empty-ids.json",
    "examples/invalid-import-downloads-ids-type.json",
    "examples/invalid-import-downloads-missing-ids.json",
    // A request can never assert the staging path: the path is a server-side
    // fact read from BDL's download-event log.
    "examples/invalid-import-downloads-client-path.json",
    "examples/invalid-operation.json",
    // The v0.3 face is a different version: replaying a v0.3-typed request
    // onto v0.4 is a contract error, not a compatibility target.
    "examples/invalid-schema-version.json",
];

fn unique_dir(tag: &str) -> PathBuf {
    // Board #7 hardening: a process-unique serial (plus pid) keeps parallel
    // tests from sharing a same-tick timestamp directory whose teardown
    // would delete another test's files.
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vua-import-downloads-v04-{tag}-pid{}-t{nanos:016x}-{serial}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// One completed delivery recorded in BDL's own event log, back by a real
/// staging file of exactly `received` bytes.
fn stage_completed_download(
    consumer: &DownloadEventConsumer,
    staging_dir: &Path,
    download_id: &str,
    body: &[u8],
) -> PathBuf {
    let staging_path = staging_dir.join(format!("{download_id}-material-pack.zip"));
    std::fs::write(&staging_path, body).unwrap();
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
                occurred_at: "2026-09-09T12:00:00.000Z".into(),
            })
            .unwrap();
    }
    staging_path
}

#[test]
fn import_downloads_vector_validates_against_the_command_schema() {
    let vector = read_json(IMPORT_DOWNLOADS_REQUEST);
    let errors: Vec<String> = command_validator()
        .iter_errors(&vector)
        .map(|error| format!("{}: {error}", error.instance_path()))
        .collect();
    assert!(errors.is_empty(), "the import-downloads vector must validate: {errors:?}");
}

#[test]
fn import_downloads_result_vector_validates_against_the_result_schema() {
    let vector = read_json(IMPORT_DOWNLOADS_RESULT);
    let errors: Vec<String> = result_validator()
        .iter_errors(&vector)
        .map(|error| format!("{}: {error}", error.instance_path()))
        .collect();
    assert!(errors.is_empty(), "the import-downloads result must validate: {errors:?}");
}

#[test]
fn import_downloads_negative_vectors_are_rejected_by_the_command_schema() {
    let validator = command_validator();
    for name in IMPORT_DOWNLOADS_NEGATIVES {
        let vector = read_json(name);
        assert!(
            !validator.is_valid(&vector),
            "{name} is a negative vector and must not validate"
        );
    }
}

#[test]
fn operation_closed_set_is_exactly_the_six_commands() {
    let command_schema = read_json("command.schema.json");
    let operations: Vec<String> = command_schema["properties"]["operation"]["enum"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        operations,
        vec![
            "warehouse.setArtifactMode",
            "warehouse.generateVpm",
            "warehouse.deleteOriginals",
            "warehouse.setGlobalDefaultMode",
            "warehouse.import",
            "warehouse.importDownloads",
        ]
    );
}

/// The importDownloads vector drives the real adoption task: the staging
/// deliveries behind the vector's two download ids are recorded in BDL, the
/// task adopts both, the acceptance validates against the frozen result
/// schema, and the durable effect is asserted through the store — two
/// `downloaded_material` entries whose content rows carry the download
/// correlation.
#[test]
fn import_downloads_vector_drives_the_real_adoption_task_and_validates() {
    let request = read_json(IMPORT_DOWNLOADS_REQUEST);
    let download_ids: Vec<String> = request["params"]["downloadIds"]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_owned())
        .collect();
    assert_eq!(download_ids.len(), 2, "the vector promises a two-download batch");

    let store = Arc::new(BdlStore::open_in_memory().unwrap());
    let staging_dir = unique_dir("staging");
    let consumer = DownloadEventConsumer::new(&store);
    let staged: Vec<(String, PathBuf)> = download_ids
        .iter()
        .map(|download_id| {
            (
                download_id.clone(),
                stage_completed_download(&consumer, &staging_dir, download_id, b"PK download fixture"),
            )
        })
        .collect();

    let runtime = TaskRuntime::new(
        Arc::new(MemoryJournal::default()),
        Arc::new(SystemClock),
        Arc::new(FixedIdGenerator::default()),
    );
    let correlation_id = "corr-import-downloads-1";
    let warehouse_root = unique_dir("wh");
    let accepted = submit_warehouse_import_downloads(
        &runtime,
        store.clone(),
        Arc::new(vua_orchestrator::SystemClock),
        WarehouseDownloadAdoptTaskSpec {
            correlation_id: correlation_id.to_owned(),
            download_ids: download_ids.clone(),
            warehouse_root: warehouse_root.clone(),
        },
        None,
    )
    .expect("submission is accepted");

    // The acceptance assembles into the frozen v0.4 importDownloads result shape.
    let acceptance = json!({
        "schemaVersion": "0.5",
        "operation": "warehouse.importDownloads",
        "taskId": accepted.task_id,
        "correlationId": correlation_id,
    });
    let errors: Vec<String> = result_validator()
        .iter_errors(&acceptance)
        .map(|error| format!("{}: {error}", error.instance_path()))
        .collect();
    assert!(errors.is_empty(), "the real acceptance must validate: {errors:?}");
    let expected = read_json(IMPORT_DOWNLOADS_RESULT);
    assert_eq!(acceptance["operation"], expected["operation"]);

    // The task finishes terminal with both downloads adopted; the durable
    // effect is asserted through the store (stronger than the payload): one
    // downloaded_material entry per download, with the transport correlation
    // closed onto the content row.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let snapshot = loop {
        let snapshot = runtime.snapshot(&accepted.task_id).expect("task must exist");
        if snapshot.state.is_terminal() {
            break snapshot;
        }
        assert!(std::time::Instant::now() < deadline, "task did not finish");
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    assert_eq!(snapshot.correlation_id, correlation_id);
    let cards = store.warehouse_entry_cards(vua_bdl_store::bdl_store::ArtifactMode::GenerateVpm).unwrap();
    assert_eq!(cards.len(), 2, "the task created one entry per download");
    for card in &cards {
        assert_eq!(card.kind, "downloaded_material");
    }
    for (download_id, staging_path) in &staged {
        // Copy-in: staging survives untouched.
        assert!(staging_path.exists(), "staging for {download_id} must survive adoption");
    }
}

/// Fail-fast per task: a batch where the second download was never completed
/// fails the task, and the first download's already-landed entry stays
/// durable — honest failure, no silent skip.
#[test]
fn import_downloads_task_fails_fast_and_keeps_the_landed_entry() {
    let store = Arc::new(BdlStore::open_in_memory().unwrap());
    let staging_dir = unique_dir("staging-fast");
    let consumer = DownloadEventConsumer::new(&store);
    let good_id = "dl-fix-good";
    stage_completed_download(&consumer, &staging_dir, good_id, b"PK good fixture");

    let runtime = TaskRuntime::new(
        Arc::new(MemoryJournal::default()),
        Arc::new(SystemClock),
        Arc::new(FixedIdGenerator::default()),
    );
    let warehouse_root = unique_dir("wh-fast");
    let accepted = submit_warehouse_import_downloads(
        &runtime,
        store.clone(),
        Arc::new(vua_orchestrator::SystemClock),
        WarehouseDownloadAdoptTaskSpec {
            correlation_id: "corr-fast-1".to_owned(),
            download_ids: vec![good_id.to_owned(), "dl-fix-never-started".to_owned()],
            warehouse_root: warehouse_root.clone(),
        },
        None,
    )
    .expect("submission is accepted");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let snapshot = loop {
        let snapshot = runtime.snapshot(&accepted.task_id).expect("task must exist");
        if snapshot.state.is_terminal() {
            break snapshot;
        }
        assert!(std::time::Instant::now() < deadline, "task did not finish");
        std::thread::sleep(std::time::Duration::from_millis(10));
    };
    assert!(
        matches!(snapshot.state, vua_orchestrator::TaskState::Failed),
        "an uncompleted download must fail the task, got {:?}",
        snapshot.state
    );
    let cards = store.warehouse_entry_cards(vua_bdl_store::bdl_store::ArtifactMode::GenerateVpm).unwrap();
    assert_eq!(cards.len(), 1, "the first download's entry stays durable");
    assert_eq!(cards[0].kind, "downloaded_material");
}

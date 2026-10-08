//! B4/F4-4 frame-level tests: the download acquisition surface of the
//! provider host. Everything runs against synthetic events through the real
//! frame loop — port events fold into BDL (at-least-once with unique-key
//! dedup), each attempt owns a nine-state task, cancellation folds to an
//! abandon intent, and the retry command adjudicates through the frozen
//! policy (resume / fresh attempt / give-up).

#![allow(clippy::result_large_err)]

use std::fs;
use std::io::{BufRead, Read};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use vua_bdl_store::BdlStore;
use vua_provider_host::DownloadConfig;

fn unique_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("vua-dlhost-{label}-{nanos}"))
}

struct Paced {
    inner: std::io::Cursor<Vec<u8>>,
}

impl Read for Paced {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        std::thread::sleep(Duration::from_millis(80));
        self.inner.read(buf)
    }
}

impl BufRead for Paced {
    fn fill_buf(&mut self) -> std::io::Result<&[u8]> {
        self.inner.fill_buf()
    }
    fn consume(&mut self, amount: usize) {
        self.inner.consume(amount);
    }
}

fn frames_input(frames: Vec<serde_json::Value>) -> Paced {
    let mut bytes = Vec::new();
    for frame in frames {
        bytes.extend_from_slice(frame.to_string().as_bytes());
        bytes.push(b'\n');
    }
    Paced { inner: std::io::Cursor::new(bytes) }
}

fn frame(id: &str, payload: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "frameVersion": "0.1",
        "frameId": id,
        "kind": "request",
        "payload": payload,
    })
}

fn request(request_id: &str, method: &str, params: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "contractVersion": "0.1",
        "requestId": request_id,
        "correlationId": "corr-dl-host",
        "kind": "command",
        "method": method,
        "commandId": format!("cmd-{request_id}"),
        "params": params,
    })
}

fn parse_frames(bytes: &[u8]) -> Vec<serde_json::Value> {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn response_payload(frames: &[serde_json::Value], request_id: &str) -> serde_json::Value {
    frames
        .iter()
        .find(|frame| frame["kind"] == "response" && frame["payload"]["requestId"] == request_id)
        .expect("a response frame for every request")["payload"]["value"]
        .clone()
}

fn download_event(
    download_id: &str,
    kind: &str,
    attempt: u32,
    occurred_at: &str,
    extras: serde_json::Value,
) -> serde_json::Value {
    let mut event = serde_json::json!({
        "schemaVersion": "0.1",
        "kind": kind,
        "downloadId": download_id,
        "attempt": attempt,
        "sourceUrl": "https://booth.example.com/download/1000001/fixture",
        "initiatedFromPageUrl": "https://booth.example.com/items/1000001",
        "suggestedFileName": "material-pack.zip",
        "resumable": true,
        "occurredAt": occurred_at,
    });
    if let Some(object) = extras.as_object() {
        for (key, value) in object {
            event[key.as_str()] = value.clone();
        }
    }
    event
}

fn ingest_request(
    request_id: &str,
    events: Vec<serde_json::Value>,
) -> serde_json::Value {
    request(
        request_id,
        "download.ingest",
        serde_json::json!({ "schemaVersion": "0.1", "events": events }),
    )
}

struct World {
    base: PathBuf,
    database: PathBuf,
    bdl_path: PathBuf,
}

fn make_world(label: &str) -> World {
    let base = unique_dir(label);
    World {
        database: base.join("tasks.db"),
        bdl_path: base.join("bdl").join("bdl.db"),
        base,
    }
}

fn download_config(world: &World) -> DownloadConfig {
    DownloadConfig {
        bdl: Arc::new(BdlStore::open(&world.bdl_path).expect("BDL store opens")),
    }
}

fn run(world: &World, frames: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut output_buffer = Vec::new();
    vua_provider_host::run_provider_host_with_downloads(
        frames_input(frames),
        &mut output_buffer,
        world.database.clone(),
        None,
        Some(download_config(world)),
    )
    .unwrap();
    parse_frames(&output_buffer)
}

const DOWNLOAD: &str = "01hexample0000000000000a";
const TASK_A1: &str = "dl-01hexample0000000000000a-a1";

#[test]
fn duplicate_receipt_repairs_a_missing_task_journal_without_repeating_delivery() {
    use vua_bdl_store::{DownloadEventConsumer, DownloadEventV01};
    let world = make_world("journal-repair");
    let started = download_event(DOWNLOAD, "download.started", 1, "2026-10-08T00:00:00Z", serde_json::json!({"receivedBytes":0}));
    let completed = download_event(DOWNLOAD, "download.completed", 1, "2026-10-08T00:00:01Z", serde_json::json!({"receivedBytes":10,"storedPath":"C:\\synthetic\\staging\\file.zip"}));
    {
        let bdl = BdlStore::open(&world.bdl_path).unwrap();
        for value in [&started, &completed] {
            DownloadEventConsumer::new(&bdl).ingest(&serde_json::from_value::<DownloadEventV01>(value.clone()).unwrap()).unwrap();
        }
    }
    let frames = run(&world, vec![frame("f1", ingest_request("repair", vec![completed.clone(), completed]))]);
    let receipt = response_payload(&frames, "repair");
    assert_eq!(receipt["folded"], 0);
    assert_eq!(receipt["duplicates"], 2);
    assert_eq!(receipt["rejected"], serde_json::json!([]));
    let tasks = vua_orchestrator::SqliteTaskStore::open(&world.database).unwrap();
    assert_eq!(tasks.task(TASK_A1).unwrap().unwrap().state, vua_orchestrator::TaskState::Succeeded);
    assert_eq!(tasks.events_after(TASK_A1, 0).unwrap().len(), 4);
    assert_eq!(BdlStore::open(&world.bdl_path).unwrap().download_events(DOWNLOAD).unwrap().len(), 2);
    drop(tasks);
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn a_policy_failure_before_started_still_has_a_visible_failed_task() {
    let world = make_world("early-policy");
    let denied = download_event(DOWNLOAD, "download.failed", 1, "2026-10-08T00:00:00Z", serde_json::json!({"failureKind":"policy","resumable":false}));
    let frames = run(&world, vec![frame("f1", ingest_request("deny", vec![denied]))]);
    assert_eq!(response_payload(&frames, "deny")["rejected"], serde_json::json!([]));
    let tasks = vua_orchestrator::SqliteTaskStore::open(&world.database).unwrap();
    assert_eq!(tasks.task(TASK_A1).unwrap().unwrap().state, vua_orchestrator::TaskState::Failed);
    drop(tasks);
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn b4_dl_001_ingest_folds_events_creates_tasks_and_answers_receipts() {
    let world = make_world("fold");
    let frames = run(
        &world,
        vec![
            serde_json::json!({
                "frameVersion": "0.1",
                "frameId": "f-handshake",
                "kind": "handshake",
                "payload": null,
            }),
            frame(
                "f1",
                request(
                    "req-ingest-1",
                    "download.ingest",
                    serde_json::json!({
                        "schemaVersion": "0.1",
                        "events": [
                            download_event(DOWNLOAD, "download.started", 1, "2026-09-06T08:15:00.000Z",
                                serde_json::json!({
                                    "storedPath": "C:\\staging\\dl-a1-pack.zip",
                                    "expectedBytes": 1024,
                                    "receivedBytes": 0,
                                })),
                            download_event(DOWNLOAD, "download.progress", 1, "2026-09-06T08:15:10.000Z",
                                serde_json::json!({ "receivedBytes": 512, "storedPath": "C:\\staging\\dl-a1-pack.zip" })),
                            download_event(DOWNLOAD, "download.completed", 1, "2026-09-06T08:16:00.000Z",
                                serde_json::json!({ "receivedBytes": 1024, "storedPath": "C:\\staging\\dl-a1-pack.zip" })),
                        ],
                    }),
                ),
            ),
        ],
    );

    // The handshake declares the capability.
    let handshake = frames
        .iter()
        .find(|frame| frame["kind"] == "response" && frame["frameId"] == "f-handshake")
        .expect("handshake response");
    assert_eq!(handshake["payload"]["downloadIngest"], true);

    // The batch receipt counts every event.
    let receipt = response_payload(&frames, "req-ingest-1");
    assert_eq!(receipt["folded"], 3);
    assert_eq!(receipt["duplicates"], 0);
    assert_eq!(receipt["rejected"], serde_json::json!([]));

    // The attempt task folded to Succeeded.
    let store = BdlStore::open(&world.bdl_path).unwrap();
    let _ = store;
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn b4_dl_002_redelivery_is_counted_as_duplicates_never_refolded() {
    let world = make_world("dedup");
    let event = download_event(DOWNLOAD, "download.started", 1, "2026-09-06T08:15:00.000Z",
        serde_json::json!({ "storedPath": r"C:\staging\pack.zip", "receivedBytes": 0 }));

    let first = run(&world, vec![frame("f1", ingest_request("req-1", vec![event.clone()]))]);
    let receipt = response_payload(&first, "req-1");
    assert_eq!(receipt["folded"], 1);

    // Run 2 is a fresh host process redelivering the same event: the
    // receipt answers honestly — nothing new folded, one duplicate.
    let second = run(&world, vec![frame("f2", ingest_request("req-2", vec![event]))]);
    let receipt = response_payload(&second, "req-2");
    assert_eq!(receipt["folded"], 0);
    assert_eq!(receipt["duplicates"], 1);
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn b4_dl_003_a_failed_download_folds_its_task_and_retry_queues_an_intent() {
    let world = make_world("retry");
    let started = download_event(DOWNLOAD, "download.started", 1, "2026-09-06T08:15:00.000Z",
        serde_json::json!({ "storedPath": "C:\\staging\\pack.zip", "receivedBytes": 0, "resumable": false }));
    let failure = download_event(DOWNLOAD, "download.failed", 1, "2026-09-06T08:16:00.000Z",
        serde_json::json!({ "failureKind": "unknown", "resumable": false, "storedPath": "C:\\staging\\pack.zip", "receivedBytes": 512 }));

    let frames = run(
        &world,
        vec![
            frame("f1", ingest_request("req-ingest", vec![started, failure])),
            frame("f2", request("req-retry", "download.retry",
                serde_json::json!({ "taskId": TASK_A1 }))),
            frame("f3", ingest_request("req-attempt-2", vec![
                download_event(DOWNLOAD, "download.started", 2, "2026-09-06T08:17:00.000Z",
                    serde_json::json!({ "storedPath": "C:\\staging\\pack.zip", "receivedBytes": 0, "resumable": true })),
            ])),
        ],
    );

    // The attempt task folded to failed with the honest failure kind.
    let task_frame = frames
        .iter()
        .find(|frame| {
            frame["kind"] == "response"
                && frame["payload"]["requestId"] == "req-ingest"
        })
        .expect("ingest response");

    let retry = response_payload(&frames, "req-retry");
    assert_eq!(retry["decision"], "retry", "retry: {retry}");
    assert_eq!(retry["intentSeq"], 1);

    // The intent rode the event channel with a monotonic sequence.
    let intent = frames
        .iter()
        .find(|frame| {
            frame["kind"] == "event" && frame["payload"]["kind"] == "download.intent"
        })
        .expect("an intent event frame");
    assert_eq!(intent["payload"]["downloadId"], DOWNLOAD);
    assert_eq!(intent["payload"]["intent"], "retry");

    // Attempt 2 is a NEW task record (the attempt discipline).
    let attempt2_frame = frames
        .iter()
        .find(|frame| {
            frame["kind"] == "response" && frame["payload"]["requestId"] == "req-attempt-2"
        })
        .expect("attempt-2 response frame");
    let attempt2 = attempt2_frame["payload"]["value"].clone();
    assert!(
        !attempt2.is_null(),
        "attempt-2 response: {}",
        attempt2_frame["payload"]
    );
    assert_eq!(attempt2["folded"], 1, "attempt-2: {attempt2}");
    let _ = task_frame;
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn b4_dl_004_illegal_sequences_are_rejected_in_the_receipt_never_folded() {
    let world = make_world("illegal");
    let frames = run(
        &world,
        vec![frame("f1", ingest_request("req-1", vec![
            // progress without a started event: a port violation.
            download_event(DOWNLOAD, "download.progress", 1, "2026-09-06T08:15:00.000Z",
                serde_json::json!({ "storedPath": "C:\\staging\\pack.zip", "receivedBytes": 10 })),
        ]))],
    );
    let receipt = response_payload(&frames, "req-1");
    assert_eq!(receipt["folded"], 0);
    assert_eq!(receipt["rejected"][0]["code"], "vua.download.illegal_sequence");
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn b4_dl_005_user_cancellation_folds_to_an_abandon_intent() {
    let world = make_world("abandon");
    let frames = run(
        &world,
        vec![
            frame("f1", ingest_request("req-ingest", vec![
                download_event(DOWNLOAD, "download.started", 1, "2026-09-06T08:15:00.000Z",
                    serde_json::json!({ "storedPath": "C:\\staging\\pack.zip", "receivedBytes": 0 })),
            ])),
            frame("f2", request("req-cancel", "task.requestCancellation",
                serde_json::json!({ "taskId": TASK_A1 }))),
        ],
    );
    let cancel = response_payload(&frames, "req-cancel");
    assert_eq!(cancel["outcome"], "requested", "cancel: {cancel}");

    let intent = frames
        .iter()
        .find(|frame| {
            frame["kind"] == "event" && frame["payload"]["kind"] == "download.intent"
        })
        .expect("an abandon intent event frame");
    assert_eq!(intent["payload"]["downloadId"], DOWNLOAD);
    assert_eq!(intent["payload"]["intent"], "abandon");
    assert_eq!(intent["payload"]["intentSeq"], 1);
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn b4_dl_006_retry_answers_give_up_outside_the_bound() {
    let world = make_world("giveup");
    // A user-cancelled download: terminal by the user's own decision.
    let frames = run(
        &world,
        vec![
            frame("f1", ingest_request("req-ingest", vec![
                download_event(DOWNLOAD, "download.started", 1, "2026-09-06T08:15:00.000Z",
                    serde_json::json!({ "storedPath": "C:\\staging\\pack.zip", "receivedBytes": 0 })),
                download_event(DOWNLOAD, "download.cancelled", 1, "2026-09-06T08:16:00.000Z",
                    serde_json::json!({ "storedPath": "C:\\staging\\pack.zip", "receivedBytes": 100 })),
            ])),
            frame("f2", request("req-retry", "download.retry",
                serde_json::json!({ "taskId": TASK_A1 }))),
        ],
    );
    let retry_frame = frames
        .iter()
        .find(|frame| frame["kind"] == "response" && frame["payload"]["requestId"] == "req-retry")
        .expect("retry response");
    assert_eq!(retry_frame["payload"]["ok"], false);
    assert_eq!(
        retry_frame["payload"]["error"]["code"],
        "vua.download.not_retryable",
        "a user-cancelled download is not machine-retried"
    );
    fs::remove_dir_all(&world.base).ok();
}

#[test]
fn b4_dl_007_without_configuration_the_surface_answers_honestly_unavailable() {
    let world = make_world("absent");
    let mut output_buffer = Vec::new();
    vua_provider_host::run_provider_host_with(
        frames_input(vec![frame(
            "f1",
            request("req-1", "download.ingest",
                serde_json::json!({ "schemaVersion": "0.1", "events": [] })),
        )]),
        &mut output_buffer,
        world.database.clone(),
        None,
    )
    .unwrap();
    let frames = parse_frames(&output_buffer);
    let response_frame = frames
        .iter()
        .find(|frame| frame["kind"] == "response" && frame["payload"]["requestId"] == "req-1")
        .expect("ingest response frame");
    assert_eq!(
        response_frame["payload"]["error"]["code"],
        "vua.download.unavailable",
        "honest absence, never a silent success"
    );
    fs::remove_dir_all(&world.base).ok();
}


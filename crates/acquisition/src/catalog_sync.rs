//! Whole-run account-library synchronization (catalog-sync v0.3).
//! The task journal owns checkpoints; BDL remains an observation ledger.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vua_bdl_store::BdlStore;
use vua_orchestrator::{
    AppErrorV1, ErrorCategory, NewTask, ParamValue, SqliteStoreError, SqliteTaskStore,
    StoredTaskEvent, TaskMutation, TaskState,
};

#[derive(Debug)]
pub struct SyncError(pub &'static str);

impl From<SqliteStoreError> for SyncError {
    fn from(_: SqliteStoreError) -> Self {
        Self("store_failed")
    }
}
impl From<serde_json::Error> for SyncError {
    fn from(_: serde_json::Error) -> Self {
        Self("invalid_params")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LibraryType {
    Bought,
    Gifts,
    FreeDownloads,
}

impl LibraryType {
    fn path(&self) -> &'static str {
        match self {
            Self::Bought => "https://accounts.booth.pm/library",
            Self::Gifts => "https://accounts.booth.pm/library/gifts",
            Self::FreeDownloads => "https://accounts.booth.pm/library/free_downloads",
        }
    }
    fn name(&self) -> &'static str {
        match self {
            Self::Bought => "bought",
            Self::Gifts => "gifts",
            Self::FreeDownloads => "free_downloads",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Begin {
    schema_version: String,
    run_id: String,
    library_types: Vec<LibraryType>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Page {
    schema_version: String,
    run_id: String,
    library_type: LibraryType,
    page_number: usize,
    source_url: String,
    html: String,
    fetched_at: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Finish {
    schema_version: String,
    run_id: String,
    outcome: Outcome,
    error_code: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Outcome {
    Completed,
    Failed,
    Cancelled,
    PageLimitReached,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Status {
    schema_version: String,
    run_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RejectedItem {
    index: usize,
    code: String,
    reason: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PageResult {
    schema_version: String,
    source_url: String,
    parsed_count: usize,
    upserted_count: usize,
    rejected_items: Vec<RejectedItem>,
    next_page_url: Option<String>,
    cancellation_requested: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Receipt {
    library_type: LibraryType,
    source_url: String,
    page_hash: String,
    result: PageResult,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Checkpoint {
    schema_version: String,
    operation: String,
    run_id: String,
    library_types: Vec<LibraryType>,
    receipts: Vec<Receipt>,
}

impl Checkpoint {
    fn completed_types(&self) -> Vec<LibraryType> {
        self.receipts
            .iter()
            .filter(|page| page.result.next_page_url.is_none())
            .map(|page| page.library_type.clone())
            .collect()
    }
    fn counts(&self) -> (u64, u64, u64) {
        self.receipts
            .iter()
            .fold((0, 0, 0), |(parsed, upserted, rejected), page| {
                (
                    parsed + page.result.parsed_count as u64,
                    upserted + page.result.upserted_count as u64,
                    rejected + page.result.rejected_items.len() as u64,
                )
            })
    }
}

fn validate_identity(version: &str, run_id: &str) -> Result<(), SyncError> {
    let suffix = run_id
        .strip_prefix("catalog-sync-")
        .ok_or(SyncError("invalid_params"))?;
    if version != "0.3"
        || suffix.is_empty()
        || suffix.len() > 115
        || !suffix
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
    {
        return Err(SyncError("invalid_params"));
    }
    Ok(())
}

fn checkpoint(store: &SqliteTaskStore, run_id: &str) -> Result<Checkpoint, SyncError> {
    let events = store.events_after(run_id, 0)?;
    let value = events
        .iter()
        .rev()
        .find(|event| event.payload["operation"] == "catalog.sync")
        .ok_or(SyncError("run_not_found"))?
        .payload
        .clone();
    serde_json::from_value(value).map_err(|_| SyncError("store_failed"))
}

fn snapshot(
    store: &SqliteTaskStore,
    checkpoint: &Checkpoint,
    recovered: bool,
) -> Result<Value, SyncError> {
    let task = store
        .task(&checkpoint.run_id)?
        .ok_or(SyncError("run_not_found"))?;
    let (parsed, upserted, rejected) = checkpoint.counts();
    Ok(json!({
        "schemaVersion": "0.3", "runId": checkpoint.run_id, "taskId": checkpoint.run_id,
        "revision": task.revision, "state": task.state, "cancellationRequested": task.cancel_requested,
        "recoveryDisposition": if recovered { "inspect_required" } else { "none" },
        "libraryTypes": checkpoint.library_types, "completedLibraryTypes": checkpoint.completed_types(),
        "pages": checkpoint.receipts.len(), "parsedCount": parsed, "upsertedCount": upserted, "rejectedCount": rejected,
        "nextPageUrl": checkpoint.receipts.last().and_then(|page| page.result.next_page_url.as_deref()),
        "errorCode": task.error.as_ref().map(|error| &error.code),
    }))
}

fn mutate(
    store: &SqliteTaskStore,
    run_id: &str,
    now: &str,
    mutation: TaskMutation,
    emit: &mut impl FnMut(StoredTaskEvent),
) -> Result<(), SyncError> {
    let task = store.task(run_id)?.ok_or(SyncError("run_not_found"))?;
    if let Some(event) = store.mutate_task(run_id, task.revision, now, mutation)? {
        emit(event);
    }
    Ok(())
}

/// Requests are normalized observations and transport outcomes, never sessions.
pub fn apply_catalog_sync(
    store: &SqliteTaskStore,
    bdl: &BdlStore,
    method: &str,
    params: Value,
    now: &str,
    recovered: bool,
    mut emit: impl FnMut(StoredTaskEvent),
) -> Result<Value, SyncError> {
    match method {
        "catalog.beginLibrarySync" => {
            let request: Begin = serde_json::from_value(params)?;
            validate_identity(&request.schema_version, &request.run_id)?;
            if request.library_types.is_empty()
                || request.library_types.len() > 3
                || request
                    .library_types
                    .iter()
                    .enumerate()
                    .any(|(i, item)| request.library_types[..i].contains(item))
            {
                return Err(SyncError("invalid_params"));
            }
            if store.task(&request.run_id)?.is_some() {
                let current = checkpoint(store, &request.run_id)?;
                if current.library_types != request.library_types {
                    return Err(SyncError("run_conflict"));
                }
                return snapshot(store, &current, recovered);
            }
            let (_, event) = store.accept_task(&NewTask {
                task_id: request.run_id.clone(),
                correlation_id: request.run_id.clone(),
                occurred_at: now.to_owned(),
            })?;
            emit(event);
            let current = Checkpoint {
                schema_version: "0.3".into(),
                operation: "catalog.sync".into(),
                run_id: request.run_id,
                library_types: request.library_types,
                receipts: Vec::new(),
            };
            for state in [TaskState::Preparing, TaskState::Running] {
                mutate(
                    store,
                    &current.run_id,
                    now,
                    TaskMutation::Transition {
                        state,
                        payload: serde_json::to_value(&current)?,
                    },
                    &mut emit,
                )?;
            }
            snapshot(store, &current, false)
        }
        "catalog.librarySyncStatus" => {
            let request: Status = serde_json::from_value(params)?;
            validate_identity(&request.schema_version, &request.run_id)?;
            snapshot(store, &checkpoint(store, &request.run_id)?, recovered)
        }
        "catalog.ingestLibraryPage" => {
            let request: Page = serde_json::from_value(params)?;
            validate_identity(&request.schema_version, &request.run_id)?;
            if request.html.is_empty()
                || request.fetched_at.is_empty()
                || !(1..=50).contains(&request.page_number)
            {
                return Err(SyncError("invalid_params"));
            }
            let mut current = checkpoint(store, &request.run_id)?;
            let task = store
                .task(&request.run_id)?
                .ok_or(SyncError("run_not_found"))?;
            if recovered {
                return Err(SyncError("inspect_required"));
            }
            let hash = crate::library_page::page_content_hash(&request.html);
            if let Some(previous) = current.receipts.get(request.page_number - 1) {
                if previous.page_hash != hash
                    || previous.library_type != request.library_type
                    || previous.source_url != request.source_url
                {
                    return Err(SyncError("page_conflict"));
                }
                let mut response = previous.result.clone();
                response.cancellation_requested = task.cancel_requested;
                return Ok(serde_json::to_value(response)?);
            }
            if task.state.is_terminal() {
                return Err(SyncError("run_terminal"));
            }
            if task.cancel_requested {
                return Err(SyncError("cancelled"));
            }
            let completed = current.completed_types();
            let expected_type = current
                .library_types
                .get(completed.len())
                .ok_or(SyncError("run_complete"))?;
            if request.page_number != current.receipts.len() + 1
                || &request.library_type != expected_type
            {
                return Err(SyncError("page_out_of_order"));
            }
            let expected_url = match current
                .receipts
                .last()
                .filter(|page| &page.library_type == expected_type)
            {
                Some(previous) => library_next_url(
                    expected_type,
                    &previous.source_url,
                    previous
                        .result
                        .next_page_url
                        .as_deref()
                        .ok_or(SyncError("page_out_of_order"))?,
                )?,
                None => format!("{}?page=1", expected_type.path()),
            };
            if request.source_url != expected_url {
                return Err(SyncError("page_out_of_order"));
            }
            if crate::library_page::is_product_page(&request.html) {
                return Err(SyncError("not_a_library_page"));
            }
            let page = crate::library_page::extract_library_page(&request.html)
                .map_err(|_| SyncError("not_a_library_page"))?;
            let mut upserted = 0;
            let mut rejected = Vec::new();
            for (index, item) in page.items.iter().enumerate() {
                let observation = crate::library_page::library_item_to_observation(
                    item,
                    &hash,
                    &request.fetched_at,
                    Some(&request.run_id),
                    Some(request.library_type.name()),
                );
                match bdl.record_product_observation(&observation) {
                    Ok(_) => {
                        upserted += 1;
                        let rows = item
                            .downloadables
                            .iter()
                            .filter_map(|(id, label)| {
                                id.parse::<i64>().ok().map(|id| (id, label.clone()))
                            })
                            .collect::<Vec<_>>();
                        if !rows.is_empty()
                            && bdl
                                .upsert_product_downloadables(
                                    &observation.product_id,
                                    &rows,
                                    &request.fetched_at,
                                    Some(&request.run_id),
                                    Some(request.library_type.name()),
                                )
                                .is_err()
                        {
                            rejected.push(RejectedItem {
                                index,
                                code: "vua.catalog.downloadables_capture_failed".into(),
                                reason: "Downloadable observation could not be persisted".into(),
                            });
                        }
                    }
                    Err(_) => rejected.push(RejectedItem {
                        index,
                        code: "vua.catalog.invalid_observation".into(),
                        reason: "Product observation was rejected".into(),
                    }),
                }
            }
            let result = PageResult {
                schema_version: "0.3".into(),
                source_url: request.source_url.clone(),
                parsed_count: page.items.len(),
                upserted_count: upserted,
                rejected_items: rejected,
                next_page_url: page.next_page_url,
                cancellation_requested: task.cancel_requested,
            };
            current.receipts.push(Receipt {
                library_type: request.library_type,
                source_url: request.source_url,
                page_hash: hash,
                result: result.clone(),
            });
            mutate(
                store,
                &current.run_id,
                now,
                TaskMutation::Progress {
                    payload: serde_json::to_value(&current)?,
                },
                &mut emit,
            )?;
            Ok(serde_json::to_value(result)?)
        }
        "catalog.finishLibrarySync" => {
            if params.get("errorCode").is_some_and(Value::is_null) {
                return Err(SyncError("invalid_params"));
            }
            let request: Finish = serde_json::from_value(params)?;
            validate_identity(&request.schema_version, &request.run_id)?;
            if request.error_code.as_ref().is_some_and(|code| {
                code.is_empty()
                    || code.len() > 128
                    || !code
                        .bytes()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"_.".contains(&c))
            }) || matches!(request.outcome, Outcome::Completed) && request.error_code.is_some()
                || matches!(request.outcome, Outcome::Failed) && request.error_code.is_none()
            {
                return Err(SyncError("invalid_params"));
            }
            let current = checkpoint(store, &request.run_id)?;
            let task = store
                .task(&request.run_id)?
                .ok_or(SyncError("run_not_found"))?;
            if task.state.is_terminal() {
                return snapshot(store, &current, recovered);
            }
            if recovered {
                return Err(SyncError("inspect_required"));
            }
            let (_, _, rejected) = current.counts();
            let (terminal, error) =
                if task.cancel_requested || matches!(request.outcome, Outcome::Cancelled) {
                    (TaskState::Cancelled, None)
                } else if matches!(request.outcome, Outcome::Completed) {
                    if current.completed_types() != current.library_types {
                        return Err(SyncError("run_incomplete"));
                    }
                    (
                        if rejected > 0 {
                            TaskState::SucceededWithWarnings
                        } else {
                            TaskState::Succeeded
                        },
                        None,
                    )
                } else {
                    let (parsed, upserted, rejected) = current.counts();
                    let cause = request
                        .error_code
                        .as_deref()
                        .unwrap_or("page_limit_reached");
                    let code = if cause == "sign_in_redirect" {
                        "vua.catalog.sign_in_required"
                    } else {
                        "vua.catalog.sync_failed"
                    };
                    let error = AppErrorV1::new(
                        code,
                        ErrorCategory::Validation,
                        "errors.catalog.syncFailed",
                        &request.run_id,
                    )
                    .with_param("cause", ParamValue::Text(cause.into()))
                    .with_param("pages", ParamValue::Number(current.receipts.len() as f64))
                    .with_param("parsedCount", ParamValue::Number(parsed as f64))
                    .with_param("upsertedCount", ParamValue::Number(upserted as f64))
                    .with_param("rejectedCount", ParamValue::Number(rejected as f64));
                    (TaskState::Failed, Some(error))
                };
            let mut summary = snapshot(store, &current, false)?;
            summary["state"] = json!(terminal);
            summary["revision"] = json!(task.revision + 1);
            summary["errorCode"] = json!(error.as_ref().map(|error| &error.code));
            mutate(
                store,
                &request.run_id,
                now,
                TaskMutation::Complete {
                    state: terminal,
                    error,
                    result: Some(summary),
                },
                &mut emit,
            )?;
            snapshot(store, &current, false)
        }
        _ => Err(SyncError("invalid_params")),
    }
}

/// Only continuations inside the selected account library are accepted.
fn library_next_url(kind: &LibraryType, current: &str, next: &str) -> Result<String, SyncError> {
    let url = if next.starts_with("https://") {
        next.to_owned()
    } else if next.starts_with('/') && !next.starts_with("//") {
        format!("https://accounts.booth.pm{next}")
    } else if next.starts_with('?') {
        format!("{}{next}", current.split('?').next().unwrap_or(current))
    } else {
        return Err(SyncError("next_page_url_not_allowed"));
    };
    let Some(query) = url.strip_prefix(&format!("{}?page=", kind.path())) else {
        return Err(SyncError("next_page_url_not_allowed"));
    };
    if query.parse::<u32>().ok().filter(|page| *page > 0).is_none() {
        return Err(SyncError("next_page_url_not_allowed"));
    }
    Ok(url)
}

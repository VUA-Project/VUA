//! Selected-file removal. AMF owns intent/tasks; BDL retains copy and source evidence.
use crate::artifact_inspection::{hex_lower, sha256_file};
use crate::library_download::{LibraryDownloadError, LibraryDownloadService};
use crate::library_view::presence;
use crate::recipe_selection_drafts::RecipeSelectionDrafts;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vua_bdl_store::{BdlStore, LibraryCopyEvidence};
use vua_orchestrator::{
    AppErrorV1, ErrorCategory, RecipeDocumentStore, SqliteTaskStore, SubmitRequest, TaskContext,
    TaskExit, TaskRecoveryDisposition, TaskRuntime, TaskState,
};

const COMMAND: &str = "library.removeFiles";

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Target {
    pub kind: String,
    pub id: String,
}
impl Target {
    fn valid(&self) -> bool {
        if self.kind == "product" {
            self.id
                .strip_prefix("booth:")
                .is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()))
        } else {
            self.kind == "entry" && safe_id(&self.id, 128)
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PreviewRequest {
    schema_version: String,
    target: Target,
    copy_ids: Option<Vec<String>>,
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RemoveRequest {
    schema_version: String,
    removal_id: String,
    target: Target,
    copy_ids: Vec<String>,
    preview_hash: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PlannedFile {
    copy_id: String,
    entry_id: String,
    file_name: String,
    role: String,
    artifact_sha256: String,
    size_bytes: u64,
    presence: String,
    superseded: bool,
    stored_path: String,
    product_ids: Vec<String>,
    #[serde(default)]
    affected_copy_ids: Vec<String>,
}
impl PlannedFile {
    fn public(&self) -> Value {
        json!({"copyId":self.copy_id,"entryId":self.entry_id,"fileName":self.file_name,"role":self.role,
            "artifactSha256":self.artifact_sha256,"sizeBytes":self.size_bytes,"presence":self.presence,"superseded":self.superseded})
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Plan {
    request: RemoveRequest,
    files: Vec<PlannedFile>,
}

// Resolve existing aliases through the filesystem, preserving case-sensitive
// directories. Missing files use their resolved parent; their identity is only
// a conservative conflict fence, never evidence of a completed deletion.
fn physical_path_key(stored_path: &str) -> PathBuf {
    let path = Path::new(stored_path);
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical;
    }
    if let Some((parent, name)) = path.parent().zip(path.file_name()) {
        if let Ok(parent) = std::fs::canonicalize(parent) {
            #[cfg(windows)]
            let name = name.to_string_lossy().to_ascii_uppercase();
            return parent.join(name);
        }
    }
    path.to_path_buf()
}

pub(crate) fn removal_conflicts_with_download(
    fingerprint: &str,
    copy_ids: &[String],
    product_id: &str,
    bdl: &BdlStore,
) -> Result<bool, LibraryDownloadError> {
    let plan: Plan =
        serde_json::from_str(fingerprint).map_err(|_| LibraryDownloadError("store_failed"))?;
    let current_paths: HashSet<_> = bdl
        .library_copy_evidence()?
        .iter()
        .filter(|copy| copy_ids.contains(&copy.copy.copy_id))
        .map(|copy| physical_path_key(&copy.copy.stored_path))
        .collect();
    Ok(plan.files.iter().any(|file| {
        file.product_ids.iter().any(|id| id == product_id)
            || copy_ids.contains(&file.copy_id)
            || file
                .affected_copy_ids
                .iter()
                .any(|id| copy_ids.contains(id))
            || current_paths.contains(&physical_path_key(&file.stored_path))
    }))
}

fn safe_id(id: &str, max: usize) -> bool {
    !id.is_empty()
        && id.len() <= max
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
}
fn validate_ids(ids: &[String]) -> bool {
    !ids.is_empty()
        && ids.len() <= 200
        && ids.iter().all(|id| safe_id(id, 128))
        && ids.iter().collect::<HashSet<_>>().len() == ids.len()
}
fn identity(version: &str, removal_id: &str) -> Result<(), LibraryDownloadError> {
    if version == "0.1"
        && removal_id
            .strip_prefix("library-removal-")
            .is_some_and(|id| safe_id(id, 100))
    {
        Ok(())
    } else {
        Err(LibraryDownloadError("invalid_params"))
    }
}

fn matching_selection<'a>(
    selection: &Value,
    copies: &'a [LibraryCopyEvidence],
) -> Vec<&'a LibraryCopyEvidence> {
    copies
        .iter()
        .filter(|copy| {
            if selection["source"] == "cloud" {
                selection["identity"]
                    .as_str()
                    .is_some_and(|id| copy.product_ids.iter().any(|p| p == id))
            } else {
                selection["identity"] == copy.copy.artifact_sha256
                    && selection["warehouseItemId"]
                        .as_str()
                        .is_none_or(|id| id == copy.copy.warehouse_item_id)
            }
        })
        .collect()
}

fn reference_rows(
    root: &Path,
    copies: &[LibraryCopyEvidence],
    selected: &[PlannedFile],
    drafts: &RecipeSelectionDrafts,
    recipes: Option<&RecipeDocumentStore>,
) -> Result<(Vec<Value>, usize), LibraryDownloadError> {
    // All known aliases lose presence, including Windows casing and junctions.
    let affected: HashSet<_> = selected
        .iter()
        .flat_map(|file| std::iter::once(&file.copy_id).chain(file.affected_copy_ids.iter()))
        .collect();
    let is_selected = |copy: &LibraryCopyEvidence| affected.contains(&copy.copy.copy_id);
    let mut rows = Vec::new();
    let mut unresolved = 0;
    let listing = drafts
        .apply("recipeDraft.list", json!({"schemaVersion":"0.1"}))
        .map_err(|_| LibraryDownloadError("reference_read_failed"))?;
    for entry in listing["entries"]
        .as_array()
        .ok_or(LibraryDownloadError("reference_read_failed"))?
    {
        let id = entry["draftId"]
            .as_str()
            .ok_or(LibraryDownloadError("reference_read_failed"))?;
        let draft = drafts
            .apply(
                "recipeDraft.get",
                json!({"schemaVersion":"0.1","draftId":id}),
            )
            .map_err(|_| LibraryDownloadError("reference_read_failed"))?;
        let mut affected = HashSet::new();
        let mut missing = false;
        for selection in draft["document"]["selections"]
            .as_array()
            .ok_or(LibraryDownloadError("reference_read_failed"))?
        {
            let matching = matching_selection(selection, copies);
            if matching.iter().any(|copy| is_selected(copy)) {
                for copy in &matching {
                    if is_selected(copy) {
                        affected.insert(copy.copy.copy_id.clone());
                    }
                }
                missing |= !matching
                    .iter()
                    .any(|copy| !is_selected(copy) && presence(root, copy) == "present");
            }
        }
        if !affected.is_empty() {
            let mut ids: Vec<_> = affected.into_iter().collect();
            ids.sort();
            rows.push(json!({"kind":"draft","id":id,"title":draft["document"]["title"],"revision":draft["revision"],"copyIds":ids,"missingAfterRemoval":missing}));
        }
    }
    if let Some(recipes) = recipes {
        for entry in recipes
            .list()
            .map_err(|_| LibraryDownloadError("reference_read_failed"))?
        {
            let stored = recipes
                .get(&entry.recipe_id)
                .map_err(|_| LibraryDownloadError("reference_read_failed"))?
                .ok_or(LibraryDownloadError("reference_read_failed"))?;
            // Only the defined v0.3 assets/sourceRef surface; no heuristic traversal of arbitrary JSON.
            if stored.recipe["formatVersion"] != "0.3" {
                return Err(LibraryDownloadError("reference_read_failed"));
            }
            let mut affected = HashSet::new();
            let mut missing = false;
            for asset in stored.recipe["assets"]
                .as_array()
                .ok_or(LibraryDownloadError("reference_read_failed"))?
            {
                let source = &asset["sourceRef"];
                if source["warehouseItemId"].as_str().is_none() && source["provider"] != "booth" {
                    unresolved += 1;
                }
                let matching: Vec<_> = copies
                    .iter()
                    .filter(|copy| {
                        if let Some(id) = source["warehouseItemId"].as_str() {
                            id == copy.copy.warehouse_item_id
                        } else if source["provider"] == "booth" {
                            source["productId"].as_str().is_some_and(|id| {
                                copy.product_ids
                                    .iter()
                                    .any(|p| p == id || p.strip_prefix("booth:") == Some(id))
                            })
                        } else {
                            false
                        }
                    })
                    .collect();
                if matching.iter().any(|copy| is_selected(copy)) {
                    for copy in &matching {
                        if is_selected(copy) {
                            affected.insert(copy.copy.copy_id.clone());
                        }
                    }
                    missing |= !matching
                        .iter()
                        .any(|copy| !is_selected(copy) && presence(root, copy) == "present");
                }
            }
            if !affected.is_empty() {
                let mut ids: Vec<_> = affected.into_iter().collect();
                ids.sort();
                rows.push(json!({"kind":"recipe","id":entry.recipe_id,"title":entry.title,"revision":stored.revision,"copyIds":ids,"missingAfterRemoval":missing}));
            }
        }
    }
    rows.sort_by(|a, b| {
        a["kind"]
            .as_str()
            .cmp(&b["kind"].as_str())
            .then(a["id"].as_str().cmp(&b["id"].as_str()))
    });
    Ok((rows, unresolved))
}

pub fn draft_selection_status(
    bdl: &BdlStore,
    root: &Path,
    drafts: &RecipeSelectionDrafts,
    params: Value,
) -> Result<Value, LibraryDownloadError> {
    let draft = drafts
        .apply("recipeDraft.get", params)
        .map_err(|error| LibraryDownloadError(error.0))?;
    let copies = bdl.library_copy_evidence()?;
    let items: Vec<_> = draft["document"]["selections"].as_array().ok_or(LibraryDownloadError("store_failed"))?.iter().enumerate().map(|(index,selection)| {
        let matching = matching_selection(selection,&copies);
        let present = matching.iter().filter(|copy| presence(root,copy) == "present").count();
        json!({"index":index,"storedCopies":matching.len(),"presentCopies":present,"state":if present > 0 {"present"} else if matching.is_empty() {"not_stored"} else {"missing"}})
    }).collect();
    Ok(
        json!({"schemaVersion":"0.1","draftId":draft["document"]["draftId"],"revision":draft["revision"],"items":items}),
    )
}

pub struct LibraryMaintenance {
    store: Arc<SqliteTaskStore>,
    bdl: Arc<BdlStore>,
    runtime: TaskRuntime,
    root: PathBuf,
    downloads: Arc<LibraryDownloadService>,
}
impl LibraryMaintenance {
    pub fn new(
        store: Arc<SqliteTaskStore>,
        bdl: Arc<BdlStore>,
        runtime: TaskRuntime,
        root: PathBuf,
        downloads: Arc<LibraryDownloadService>,
    ) -> Self {
        Self {
            store,
            bdl,
            runtime,
            root,
            downloads,
        }
    }
    fn preview(
        &self,
        target: &Target,
        ids: Option<&[String]>,
        drafts: &RecipeSelectionDrafts,
        recipes: Option<&RecipeDocumentStore>,
    ) -> Result<(Value, Vec<PlannedFile>), LibraryDownloadError> {
        if !target.valid() || ids.is_some_and(|ids| !validate_ids(ids)) {
            return Err(LibraryDownloadError("invalid_params"));
        }
        if target.kind == "product" && self.bdl.catalog_detail(&target.id)?.is_none()
            || target.kind == "entry"
                && self
                    .bdl
                    .warehouse_entry_detail(
                        &target.id,
                        vua_bdl_store::ArtifactMode::UseOriginalUnitypackage,
                    )?
                    .is_none()
        {
            return Err(LibraryDownloadError("target_not_found"));
        }
        let copies = self.bdl.library_copy_evidence()?;
        let product_scope = if target.kind == "product" { Some(crate::library_view::product_copy_ids(&self.bdl, &self.root, &self.downloads, &target.id)?) } else { None };
        let mut path_keys = HashMap::new();
        let mut aliases: HashMap<PathBuf, (Vec<String>, Vec<String>)> = HashMap::new();
        for copy in &copies {
            let key = physical_path_key(&copy.copy.stored_path);
            path_keys.insert(copy.copy.copy_id.clone(), key.clone());
            let (ids, products) = aliases.entry(key).or_default();
            ids.push(copy.copy.copy_id.clone());
            products.extend(copy.product_ids.clone());
        }
        for (ids, products) in aliases.values_mut() {
            ids.sort();
            products.sort();
            products.dedup();
        }
        let mut files: Vec<_> = copies
            .iter()
            .filter(|copy| {
                product_scope.as_ref().map_or_else(|| copy.copy.warehouse_item_id == target.id, |scope| scope.contains(&copy.copy.copy_id))
                    && ids.is_none_or(|ids| ids.contains(&copy.copy.copy_id))
            })
            .map(|copy| PlannedFile {
                copy_id: copy.copy.copy_id.clone(),
                entry_id: copy.copy.warehouse_item_id.clone(),
                file_name: copy.copy.relative_path.clone(),
                role: copy.copy.role.name().into(),
                artifact_sha256: copy.copy.artifact_sha256.clone(),
                size_bytes: copy.size_bytes,
                presence: presence(&self.root, copy).into(),
                superseded: copy.superseded,
                stored_path: copy.copy.stored_path.clone(),
                product_ids: {
                    let mut products = aliases[&path_keys[&copy.copy.copy_id]].1.clone();
                    if target.kind == "product" && !products.contains(&target.id) { products.push(target.id.clone()); products.sort(); }
                    products
                },
                affected_copy_ids: aliases[&path_keys[&copy.copy.copy_id]].0.clone(),
            })
            .collect();
        files.sort_by(|a, b| a.copy_id.cmp(&b.copy_id));
        if files.len() > 200 {
            return Err(LibraryDownloadError("too_many_files"));
        }
        if ids.is_some_and(|ids| ids.len() != files.len()) {
            return Err(LibraryDownloadError("copy_not_found"));
        }
        let (refs, unresolved) = reference_rows(&self.root, &copies, &files, drafts, recipes)?;
        let coverage = if recipes.is_some() {
            "drafts_and_recipes"
        } else {
            "drafts_only"
        };
        let fingerprint = serde_json::to_vec(
            &json!({"target":target,"files":files,"references":refs,"coverage":coverage,"unresolvedRecipeAssets":unresolved}),
        )?;
        let hash = format!("sha256:{}", hex_lower(&Sha256::digest(fingerprint)));
        Ok((
            json!({"schemaVersion":"0.1","target":target,"previewHash":hash,"files":files.iter().map(PlannedFile::public).collect::<Vec<_>>(),"references":refs,"referenceCoverage":coverage,"unresolvedRecipeAssets":unresolved}),
            files,
        ))
    }
    fn prior(&self, id: &str) -> Result<Option<(String, Plan)>, LibraryDownloadError> {
        self.store
            .idempotent_tasks(COMMAND)?
            .into_iter()
            .find(|row| row.idempotency_key == id)
            .map(|row| {
                let plan = serde_json::from_str(&row.request_fingerprint)
                    .map_err(|_| LibraryDownloadError("store_failed"))?;
                Ok((row.task_id, plan))
            })
            .transpose()
    }
    fn snapshot(&self, task_id: &str, plan: &Plan) -> Result<Value, LibraryDownloadError> {
        let task = self
            .store
            .task(task_id)?
            .ok_or(LibraryDownloadError("store_failed"))?;
        // Read task before events, then consume only its revision to avoid mixing finality.
        let events = self.store.events_after(task_id, 0)?;
        let resolution = task.result.as_ref().filter(|result| result["operation"] == COMMAND && result["inspectionResolved"] == true);
        let files: Vec<_> = plan
            .files
            .iter()
            .map(|file| {
                if let Some(receipt) = resolution.and_then(|result| result["files"].as_array()).and_then(|files| files.iter().find(|receipt| receipt["copyId"] == file.copy_id)) {
                    return receipt.clone();
                }
                let receipt = events.iter().rev().find(|event| {
                    event.revision <= task.revision
                        && event.payload["operation"] == COMMAND
                        && event.payload["copyId"] == file.copy_id
                });
                json!({"copyId":file.copy_id,"entryId":file.entry_id,"fileName":file.file_name,
                "phase":receipt.map(|r|r.payload["phase"].clone()).unwrap_or(json!("pending")),
                "errorCode":receipt.map(|r|r.payload["errorCode"].clone()).unwrap_or(Value::Null)})
            })
            .collect();
        let inspect = resolution.is_none() && self.runtime.snapshot(task_id).is_none_or(|s| {
            s.poisoned || s.recovery_disposition == TaskRecoveryDisposition::InspectRequired
        });
        let state = if inspect && !task.state.is_terminal() {
            "unconfirmed"
        } else {
            match task.state {
                TaskState::Succeeded => "succeeded",
                TaskState::SucceededWithWarnings => "succeeded_with_warnings",
                TaskState::Failed => "failed",
                TaskState::Cancelled => "cancelled",
                _ => "running",
            }
        };
        let mut value = json!({"schemaVersion":"0.1","removalId":plan.request.removal_id,"target":plan.request.target,"taskId":task_id,
            "taskState":task.state,"revision":task.revision,"cancelRequested":task.cancel_requested,
            "recoveryDisposition":if inspect {"inspect_required"} else {"none"},"state":state,"files":files});
        if resolution.is_some() { value["inspectionResolved"] = json!(true); }
        Ok(value)
    }
    fn resolve(&self, removal_id: &str, observed_revision: u64) -> Result<Value, LibraryDownloadError> {
        let gate = self.downloads.copy_write_lock();
        let _guard = gate.lock().expect("copy writes poisoned");
        let (id, plan) = self.prior(removal_id)?.ok_or(LibraryDownloadError("removal_not_found"))?;
        let before = self.snapshot(&id, &plan)?;
        if before["inspectionResolved"] == true { return Ok(before); }
        if before["state"] != "unconfirmed" { return Err(LibraryDownloadError("inspection_not_required")); }
        if before["revision"].as_u64() != Some(observed_revision) { return Err(LibraryDownloadError("removal_conflict")); }
        let evidence = self.bdl.library_copy_evidence()?;
        let mut files = before["files"].as_array().ok_or(LibraryDownloadError("store_failed"))?.clone();
        for receipt in &mut files {
            if receipt["phase"] != "pending" { continue; }
            let file = plan.files.iter().find(|file| receipt["copyId"] == file.copy_id).ok_or(LibraryDownloadError("store_failed"))?;
            let current = evidence.iter().find(|copy| copy.copy.copy_id == file.copy_id);
            let result = match current {
                Some(copy) if copy.copy.stored_path == file.stored_path && copy.copy.warehouse_item_id == file.entry_id
                    && copy.copy.artifact_sha256 == file.artifact_sha256 && copy.size_bytes == file.size_bytes => match presence(&self.root, copy) {
                        "present" => Ok("kept"),
                        "missing" => Ok("missing_after_inspection"),
                        "changed" => Err("file_changed"),
                        _ => Err("file_unreadable"),
                    },
                _ => Err("copy_changed"),
            };
            match result {
                Ok(phase) => { receipt["phase"] = json!(phase); receipt["errorCode"] = Value::Null; }
                Err(code) => { receipt["phase"] = json!("failed"); receipt["errorCode"] = json!(code); }
            }
        }
        let result = json!({"operation":COMMAND,"inspectionResolved":true,"files":files});
        self.runtime.cancel_after_inspection(&id, observed_revision, result).map_err(|error| {
            LibraryDownloadError(if error.category == ErrorCategory::Conflict { "removal_conflict" } else { "store_failed" })
        })?;
        self.snapshot(&id, &plan)
    }
    pub fn apply(
        &self,
        method: &str,
        params: Value,
        drafts: &RecipeSelectionDrafts,
        recipes: Option<&RecipeDocumentStore>,
    ) -> Result<Value, LibraryDownloadError> {
        match method {
            "library.pendingRemovals" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields, rename_all = "camelCase")]
                struct Pending { schema_version: String, target: Target }
                let request: Pending = serde_json::from_value(params)?;
                if request.schema_version != "0.1" || !request.target.valid() { return Err(LibraryDownloadError("invalid_params")); }
                let mut items = Vec::new();
                for row in self.store.idempotent_tasks(COMMAND)? {
                    let plan: Plan = serde_json::from_str(&row.request_fingerprint).map_err(|_| LibraryDownloadError("store_failed"))?;
                    if plan.request.target == request.target || plan.files.iter().any(|file| if request.target.kind == "entry" { file.entry_id == request.target.id } else { file.product_ids.contains(&request.target.id) }) {
                        let snapshot = self.snapshot(&row.task_id, &plan)?;
                        if snapshot["state"] == "unconfirmed" { items.push(snapshot); }
                    }
                }
                Ok(json!({"schemaVersion":"0.1","target":request.target,"items":items}))
            }
            "library.resolveRemoval" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields, rename_all = "camelCase")]
                struct Resolve { schema_version: String, removal_id: String, observed_revision: u64 }
                let request: Resolve = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.removal_id)?;
                if request.observed_revision == 0 || request.observed_revision > 9_007_199_254_740_991 { return Err(LibraryDownloadError("invalid_params")); }
                self.resolve(&request.removal_id, request.observed_revision)
            }
            "library.removalPreview" => {
                if params.get("copyIds").is_some_and(Value::is_null) {
                    return Err(LibraryDownloadError("invalid_params"));
                }
                let request: PreviewRequest = serde_json::from_value(params)?;
                if request.schema_version != "0.1" {
                    return Err(LibraryDownloadError("invalid_params"));
                }
                self.preview(
                    &request.target,
                    request.copy_ids.as_deref(),
                    drafts,
                    recipes,
                )
                .map(|(v, _)| v)
            }
            "library.removalStatus" => {
                #[derive(Deserialize)]
                #[serde(deny_unknown_fields, rename_all = "camelCase")]
                struct Status {
                    schema_version: String,
                    removal_id: String,
                }
                let request: Status = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.removal_id)?;
                let (id, plan) = self
                    .prior(&request.removal_id)?
                    .ok_or(LibraryDownloadError("removal_not_found"))?;
                self.snapshot(&id, &plan)
            }
            COMMAND => {
                let request: RemoveRequest = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.removal_id)?;
                if !request.target.valid() || !validate_ids(&request.copy_ids) {
                    return Err(LibraryDownloadError("invalid_params"));
                }
                let gate = self.downloads.copy_write_lock();
                let _guard = gate.lock().expect("copy writes poisoned");
                if let Some((id, plan)) = self.prior(&request.removal_id)? {
                    if plan.request != request {
                        return Err(LibraryDownloadError("removal_conflict"));
                    }
                    return self.snapshot(&id, &plan);
                }
                let (preview, files) =
                    self.preview(&request.target, Some(&request.copy_ids), drafts, recipes)?;
                if preview["previewHash"] != request.preview_hash {
                    return Err(LibraryDownloadError("preview_changed"));
                }
                let products: Vec<_> = files
                    .iter()
                    .flat_map(|file| file.product_ids.clone())
                    .collect();
                let affected: Vec<_> = files
                    .iter()
                    .flat_map(|file| file.affected_copy_ids.clone())
                    .collect();
                if self.downloads.has_active_download(&affected, &products)? {
                    return Err(LibraryDownloadError("file_busy"));
                }
                let paths: HashSet<_> = files
                    .iter()
                    .map(|file| physical_path_key(&file.stored_path))
                    .collect();
                for row in self.store.idempotent_tasks(COMMAND)? {
                    if self
                        .store
                        .task(&row.task_id)?
                        .is_some_and(|task| !task.state.is_terminal())
                    {
                        let other: Plan = serde_json::from_str(&row.request_fingerprint)
                            .map_err(|_| LibraryDownloadError("store_failed"))?;
                        if other
                            .files
                            .iter()
                            .any(|other| paths.contains(&physical_path_key(&other.stored_path)))
                        {
                            return Err(LibraryDownloadError("file_busy"));
                        }
                    }
                }
                let plan = Plan { request, files };
                let fingerprint = serde_json::to_string(&plan)?;
                let bdl = self.bdl.clone();
                let root = self.root.clone();
                let worker_gate = gate.clone();
                let worker_files = plan.files.clone();
                let accepted = self
                    .runtime
                    .submit_idempotent(
                        SubmitRequest {
                            correlation_id: Some(plan.request.removal_id.clone()),
                            timeout: None,
                            job: Box::new(move |ctx| {
                                run(ctx, &bdl, &root, &worker_gate, &worker_files)
                            }),
                        },
                        COMMAND,
                        &plan.request.removal_id,
                        &fingerprint,
                    )
                    .map_err(|_| LibraryDownloadError("store_failed"))?;
                self.snapshot(&accepted.task_id, &plan)
            }
            _ => Err(LibraryDownloadError("invalid_params")),
        }
    }
}

fn remove_file(
    bdl: &BdlStore,
    root: &Path,
    file: &PlannedFile,
) -> Result<&'static str, LibraryDownloadError> {
    let copies = bdl.library_copy_evidence()?;
    let current = copies
        .iter()
        .find(|copy| copy.copy.copy_id == file.copy_id)
        .ok_or(LibraryDownloadError("copy_changed"))?;
    if current.copy.stored_path != file.stored_path
        || current.copy.warehouse_item_id != file.entry_id
        || current.copy.artifact_sha256 != file.artifact_sha256
        || current.size_bytes != file.size_bytes
    {
        return Err(LibraryDownloadError("copy_changed"));
    }
    let selected_path = physical_path_key(&file.stored_path);
    if copies.iter().any(|copy| {
        physical_path_key(&copy.copy.stored_path) == selected_path
            && copy.copy.artifact_sha256 != file.artifact_sha256
    }) {
        return Err(LibraryDownloadError("copy_changed"));
    }
    let path = Path::new(&file.stored_path);
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok("already_missing"),
        Err(_) => return Err(LibraryDownloadError("file_unreadable")),
        Ok(meta) if !meta.file_type().is_file() || meta.len() != file.size_bytes => {
            return Err(LibraryDownloadError("file_changed"))
        }
        Ok(_) => {}
    }
    let canonical_root =
        std::fs::canonicalize(root).map_err(|_| LibraryDownloadError("file_unreadable"))?;
    let canonical_path =
        std::fs::canonicalize(path).map_err(|_| LibraryDownloadError("file_unreadable"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(LibraryDownloadError("outside_managed_root"));
    }
    let hash = format!(
        "sha256:{}",
        hex_lower(&sha256_file(path).map_err(|_| LibraryDownloadError("file_unreadable"))?)
    );
    if hash != file.artifact_sha256 {
        return Err(LibraryDownloadError("file_changed"));
    }
    std::fs::remove_file(path).map_err(|_| LibraryDownloadError("file_remove_failed"))?;
    Ok("removed")
}

fn run(
    ctx: &TaskContext,
    bdl: &BdlStore,
    root: &Path,
    gate: &std::sync::Mutex<()>,
    files: &[PlannedFile],
) -> Result<TaskExit, AppErrorV1> {
    if ctx.check_cancel() {
        return Ok(TaskExit::Cancelled);
    }
    let mut effective = 0;
    let mut failed = 0;
    for file in files {
        let _guard = gate.lock().expect("copy writes poisoned");
        if ctx.check_cancel() {
            return Ok(TaskExit::Cancelled);
        }
        let result = remove_file(bdl, root, file);
        let (phase, error) = match result {
            Ok(phase) => {
                effective += 1;
                (phase, Value::Null)
            }
            Err(error) => {
                failed += 1;
                ("failed", json!(error.0))
            }
        };
        ctx.emit_progress(
            json!({"operation":COMMAND,"copyId":file.copy_id,"phase":phase,"errorCode":error}),
        );
    }
    if failed > 0 {
        ctx.warn();
    }
    if effective == 0 && failed > 0 {
        return Err(AppErrorV1::new(
            "vua.library.removal_failed",
            ErrorCategory::Validation,
            "errors.library.removalFailed",
            ctx.task_id(),
        )
        .with_recoverable(true));
    }
    Ok(TaskExit::Done(
        json!({"operation":COMMAND,"effectiveCount":effective,"failedCount":failed}),
    ))
}

#[cfg(test)]
mod safety_tests {
    use super::*;
    use vua_orchestrator::{MemoryJournal, NanosTaskIdGenerator, SystemClock};
    #[test]
    fn cancellation_before_the_file_boundary_keeps_the_file_and_finishes_cancelled() {
        let root = crate::test_support::unique_dir("vua-removal", "cancel");
        let file = root.join("synthetic.pdf");
        std::fs::write(&file, b"owned bytes").unwrap();
        let runtime = TaskRuntime::new(
            Arc::new(MemoryJournal::default()),
            Arc::new(SystemClock),
            Arc::new(NanosTaskIdGenerator::default()),
        );
        let bdl = BdlStore::open_in_memory().unwrap();
        let worker_root = root.clone();
        let worker_file = file.clone();
        let (ready_send, ready_recv) = std::sync::mpsc::channel();
        let (continue_send, continue_recv) = std::sync::mpsc::channel();
        let receipt = runtime
            .submit(SubmitRequest {
                correlation_id: None,
                timeout: None,
                job: Box::new(move |ctx| {
                    ready_send.send(()).unwrap();
                    continue_recv.recv().unwrap();
                    run(
                        ctx,
                        &bdl,
                        &worker_root,
                        &std::sync::Mutex::new(()),
                        &[PlannedFile {
                            copy_id: "cpy-cancel".into(),
                            entry_id: "entry-cancel".into(),
                            file_name: "synthetic.pdf".into(),
                            role: "original".into(),
                            artifact_sha256: format!("sha256:{}", "0".repeat(64)),
                            size_bytes: 11,
                            presence: "present".into(),
                            superseded: false,
                            stored_path: worker_file.to_string_lossy().into(),
                            product_ids: vec![],
                            affected_copy_ids: vec![],
                        }],
                    )
                }),
            })
            .unwrap();
        ready_recv
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        runtime.cancel(&receipt.task_id).unwrap();
        continue_send.send(()).unwrap();
        let started = std::time::Instant::now();
        loop {
            let snapshot = runtime.snapshot(&receipt.task_id).unwrap();
            if snapshot.state.is_terminal() {
                assert_eq!(snapshot.state, TaskState::Cancelled);
                break;
            }
            assert!(started.elapsed() < std::time::Duration::from_secs(5));
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert_eq!(std::fs::read(&file).unwrap(), b"owned bytes");
        std::fs::remove_dir_all(root).unwrap();
    }
}

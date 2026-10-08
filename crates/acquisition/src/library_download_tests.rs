use super::*;
use crate::test_support::unique_dir;
use vua_bdl_store::{ArtifactMode, DownloadEventKind, DownloadEventV01};
use vua_orchestrator::NanosTaskIdGenerator;

struct Cleanup(PathBuf);
impl Drop for Cleanup {
    fn drop(&mut self) {
        if self.0.starts_with(std::env::temp_dir()) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
struct World {
    base: PathBuf,
    bdl: Arc<BdlStore>,
    store: Arc<SqliteTaskStore>,
    runtime: TaskRuntime,
    service: Arc<LibraryDownloadService>,
    _cleanup: Cleanup,
}

fn library_view(w: &World, query: Value) -> Value {
    crate::library_view::list(
        &w.bdl,
        &w.base.join("warehouse"),
        ArtifactMode::UseOriginalUnitypackage,
        &w.service,
        query,
    )
    .unwrap()
}

fn zip_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in files {
        archive.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        archive.write_all(bytes).unwrap();
    }
    archive.finish().unwrap().into_inner()
}

#[test]
fn downloaded_zip_members_reconcile_with_migrated_files_and_refresh_on_redownload() {
    let w = World::new();
    let imported = w.import_local("Migrated folder", &[("Avatar.unitypackage", b"old avatar")]);
    let old_zip = zip_bytes(&[("Avatar.unitypackage", b"old avatar"), ("texture.psd", b"psd"), ("old-guide.txt", b"guide")]);
    w.begin("zip-first", &[902]);
    w.delivery(902, "dl-zip-first", &old_zip, "bundle.ZIP");
    w.observe("zip-first", 902, "settled", Some("dl-zip-first")).unwrap();
    assert_eq!(w.wait("zip-first")["state"], "succeeded");
    let parent = w.bdl.managed_library_file(902).unwrap().unwrap();
    let prior = w.bdl.archive_members(&parent.copy_id).unwrap();
    assert_eq!(prior.len(), 3);
    assert!(w.bdl.library_copy_evidence().unwrap().iter().filter(|c| c.archive_downloadable_id == Some(902)).all(|c| c.archive_current));
    w.verify_sources("zip-members");
    let merged = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(merged["total"], 1, "{merged}");
    assert_eq!(merged["items"][0]["storage"]["presentCopies"], 5);
    let new_zip = zip_bytes(&[("Avatar.unitypackage", b"new avatar"), ("texture.psd", b"psd"), ("new-guide.txt", b"new guide")]);
    w.begin("zip-refresh", &[902]);
    w.delivery(902, "dl-zip-refresh", &new_zip, "bundle.ZIP");
    w.observe("zip-refresh", 902, "settled", Some("dl-zip-refresh")).unwrap();
    assert_eq!(w.wait("zip-refresh")["state"], "succeeded");
    assert_eq!(w.bdl.managed_library_file(902).unwrap().unwrap().copy_id, parent.copy_id);
    assert_eq!(std::fs::read(&parent.stored_path).unwrap(), new_zip);
    let current = w.bdl.archive_members(&parent.copy_id).unwrap();
    let old_avatar = prior.iter().find(|m| m.member_path == "Avatar.unitypackage").unwrap();
    let avatar = current.iter().find(|m| m.member_path == "Avatar.unitypackage").unwrap();
    assert_eq!(avatar.copy_id, old_avatar.copy_id);
    assert_eq!(std::fs::read(&avatar.stored_path).unwrap(), b"new avatar");
    let old_guide = current.iter().find(|m| m.member_path == "old-guide.txt").unwrap();
    assert!(!PathBuf::from(&old_guide.stored_path).exists());
    let evidence = w.bdl.library_copy_evidence().unwrap();
    assert!(!evidence.iter().find(|c| c.copy.copy_id == old_guide.copy_id).unwrap().archive_current);
    if let Some(task) = w.service.reconcile_library_sources("zip-updated-members").unwrap() { w.wait_task(&task); }
    let separate = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(separate["total"], 2, "old local bytes must remain independent: {separate}");
    assert!(separate["items"].as_array().unwrap().iter().any(|r| r["entry"]["warehouseItemId"] == imported.warehouse_item_id));
}

#[test]
fn invalid_downloaded_zip_retains_original_and_exposes_expansion_issue_after_restart() {
    let w = World::new();
    w.begin("zip-invalid", &[902]);
    w.delivery(902, "dl-invalid-zip", b"not a zip", "bundle.zip");
    w.observe("zip-invalid", 902, "settled", Some("dl-invalid-zip")).unwrap();
    let result = w.wait("zip-invalid");
    assert_eq!(result["state"], "succeeded_with_warnings");
    assert_eq!(result["files"][0]["phase"], "stored");
    assert_eq!(result["files"][0]["errorCode"], "vua.library.zip_invalid");
    let parent = w.bdl.managed_library_file(902).unwrap().unwrap();
    assert_eq!(std::fs::read(parent.stored_path).unwrap(), b"not a zip");
    assert_eq!(library_view(&w, json!({"schemaVersion":"0.1","state":"attention"}))["items"][0]["storage"]["unexpandedArchives"], 1);
    let reopened = BdlStore::open(w.base.join("bdl.db")).unwrap();
    assert_eq!(reopened.library_copy_evidence().unwrap()[0].archive_expansion_state.as_deref(), Some("failed"));
}

#[test]
fn library_presence_counts_current_copies_and_keeps_failed_redownload_separate() {
    let w = World::new();
    w.begin("first", &[901]);
    w.delivery(901, "dl-old", b"old", "file.zip");
    w.observe("first", 901, "settled", Some("dl-old")).unwrap();
    w.wait("first");
    w.begin("again", &[901]);
    w.delivery(901, "dl-new", b"new", "file.zip");
    w.observe("again", 901, "settled", Some("dl-new")).unwrap();
    w.wait("again");
    assert_eq!(
        w.bdl.catalog_list(&Default::default()).unwrap().entries[0].imported_artifacts,
        2
    );
    let query = json!({"schemaVersion":"0.1"});
    let present = library_view(&w, query.clone());
    assert_eq!(present["items"].as_array().unwrap().len(), 1);
    assert_eq!(present["items"][0]["product"]["importedArtifacts"], 1);
    assert_eq!(
        present["items"][0]["storage"]["productionQualification"],
        "not_evaluated"
    );
    w.begin("failure", &[901]);
    w.observe("failure", 901, "initiation_failed", None)
        .unwrap();
    let failed = library_view(&w, query.clone());
    assert_eq!(failed["items"][0]["storage"]["state"], "present");
    assert_eq!(failed["items"][0]["operation"]["state"], "failed");
    let bound = w.bdl.managed_library_file(901).unwrap().unwrap();
    std::fs::remove_file(&bound.stored_path).unwrap();
    let missing = library_view(&w, query.clone());
    assert_eq!(missing["items"][0]["storage"]["state"], "missing");
    assert_eq!(missing["items"][0]["product"]["importedArtifacts"], 0);
    let files = crate::library_view::product_files(
        &w.bdl,
        &w.base.join("warehouse"),
        json!({"schemaVersion":"0.1","productId":"booth:90"}),
    )
    .unwrap();
    assert_eq!(files["items"][0]["copies"][0]["presence"], "missing");
    assert!(!files.to_string().contains("storedPath"));
    std::fs::write(&bound.stored_path, b"externally changed size").unwrap();
    assert_eq!(
        library_view(&w, query)["items"][0]["storage"]["state"],
        "changed"
    );
}

#[test]
fn library_keeps_multiple_memberships_and_paginates_after_all_filters() {
    let w = World::new();
    let fixture: Value = serde_json::from_slice(
        &std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../schemas/catalog-sync/v0.3/examples/page.request.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let page = crate::library_page::extract_library_page(
        &fixture["params"]["html"]
            .as_str()
            .unwrap()
            .replace("901", "90"),
    )
    .unwrap();
    let observation = crate::library_page::library_item_to_observation(
        &page.items[0],
        &format!("sha256:{}", "0".repeat(64)),
        "2026-10-08T00:00:01Z",
        None,
        Some("gifts"),
    );
    w.bdl.record_product_observation(&observation).unwrap();
    assert_eq!(
        library_view(&w, json!({"schemaVersion":"0.1","source":"bought"}))["total"],
        1
    );
    assert_eq!(
        library_view(&w, json!({"schemaVersion":"0.1","source":"gifts"}))["total"],
        1
    );
    assert_eq!(
        library_view(&w, json!({"schemaVersion":"0.1"}))["items"][0]["sources"],
        json!(["bought", "gifts"])
    );
    let after = library_view(&w, json!({"schemaVersion":"0.1","limit":1,"offset":1}));
    assert_eq!(after["total"], 1);
    assert!(after["items"].as_array().unwrap().is_empty());
    let unmatched = library_view(&w, json!({"schemaVersion":"0.1","source":"free_downloads"}));
    assert_eq!(unmatched["total"], 0);
}

#[test]
fn library_source_mapping_without_reference_bytes_keeps_local_card_unverified() {
    let w = World::new();
    let staged = w.delivery(901, "dl-local", b"manual local file", "notes.pdf");
    let completion = DownloadEventConsumer::new(&w.bdl)
        .staging_completion("dl-local")
        .unwrap()
        .unwrap();
    let inspected = ArtifactInspector::new(&w.bdl, &SystemClock)
        .inspect_download_for_storage(&DownloadInspectionRequest {
            staging_token: &completion.staging_token,
            download_id: "dl-local",
            expected_staging_root: &w.base.join("downloads-staging"),
        })
        .unwrap();
    let DownloadInspectionOutcome::Inspected(artifact) = inspected else {
        panic!("inspection")
    };
    let entry = w
        .bdl
        .create_warehouse_item("Local notes", "imported_material", "2026-10-08T00:00:00Z")
        .unwrap();
    let folder = w.base.join("warehouse").join(&entry.folder_name);
    std::fs::create_dir_all(&folder).unwrap();
    let local = folder.join("notes.pdf");
    std::fs::copy(staged, &local).unwrap();
    w.bdl
        .record_artifact_copy(
            &entry.warehouse_item_id,
            &artifact.artifact_sha256,
            "notes.pdf",
            &local.to_string_lossy(),
            CopyRole::Original,
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
    let first = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(first["total"], 2);
    assert_eq!(first["items"][1]["kind"], "local");
    assert_eq!(
        library_view(&w, json!({"schemaVersion":"0.1","source":"local"}))["total"],
        1
    );
    assert_eq!(
        library_view(&w, json!({"schemaVersion":"0.1","text":"notes.pdf"}))["total"],
        1
    );
    assert_eq!(
        library_view(
            &w,
            json!({"schemaVersion":"0.1","text":entry.warehouse_item_id})
        )["total"],
        1
    );
    w.bdl
        .record_artifact_mapping(
            &artifact.artifact_sha256,
            "booth:90",
            None,
            Some("user"),
            "2026-10-08T00:00:01Z",
        )
        .unwrap();
    let associated = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(associated["total"], 2);
    assert_eq!(associated["items"][0]["storage"]["presentCopies"], 0);
    assert_eq!(associated["items"][1]["sourceMatch"]["basis"], "mapping");
    assert_eq!(
        associated["items"][1]["sourceMatch"]["content"],
        "unverified"
    );
}

#[test]
fn library_migration_suggests_source_then_merges_only_verified_equal_bytes() {
    let w = World::new();
    let title = w.bdl.library_product_summaries().unwrap()[0]
        .title
        .clone()
        .unwrap();
    let imported = w.import_local(&title, &[("local-name.zip", b"same content")]);
    let pending = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(pending["total"], 2);
    assert_eq!(pending["items"][1]["sourceMatch"]["basis"], "name");
    assert_eq!(pending["items"][1]["sourceMatch"]["content"], "unverified");
    assert_eq!(
        library_view(&w, json!({"schemaVersion":"0.1","source":"bought"}))["total"],
        2
    );
    assert!(w
        .bdl
        .warehouse_entry_detail(
            &imported.warehouse_item_id,
            ArtifactMode::UseOriginalUnitypackage
        )
        .unwrap()
        .unwrap()
        .artifacts[0]
        .mapped_product_ids
        .is_empty());
    w.download_reference(b"same content");
    assert_eq!(library_view(&w, json!({"schemaVersion":"0.1"}))["total"], 2);
    let task_id = w.verify_sources("migration");
    let merged = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(merged["total"], 1);
    assert_eq!(merged["items"][0]["storage"]["presentCopies"], 2);
    assert_eq!(merged["items"][0]["copyIds"].as_array().unwrap().len(), 2);
    assert_eq!(
        w.bdl
            .entry_copies(&imported.warehouse_item_id)
            .unwrap()
            .len(),
        1
    );
    assert!(
        Path::new(&w.bdl.entry_copies(&imported.warehouse_item_id).unwrap()[0].stored_path)
            .exists()
    );
    assert_eq!(
        w.service.reconcile_library_sources("migration").unwrap(),
        Some(task_id.clone())
    );
    assert!(!w
        .store
        .events_after(&task_id, 0)
        .unwrap()
        .iter()
        .any(|e| e.payload.to_string().contains("storedPath")));
    let restarted = LibraryDownloadService::new(
        w.store.clone(),
        w.bdl.clone(),
        w.runtime.clone(),
        w.base.join("warehouse"),
        w.base.join("downloads-staging"),
    )
    .unwrap();
    let after_restart = crate::library_view::list(
        &w.bdl,
        &w.base.join("warehouse"),
        ArtifactMode::UseOriginalUnitypackage,
        &restarted,
        json!({"schemaVersion":"0.1"}),
    )
    .unwrap();
    assert_eq!(after_restart["total"], 1);
    std::fs::remove_file(&w.bdl.entry_copies(&imported.warehouse_item_id).unwrap()[0].stored_path)
        .unwrap();
    let removed = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(removed["total"], 1);
    assert_eq!(removed["items"][0]["storage"]["missingCopies"], 1);
    assert_eq!(removed["items"][0]["storage"]["state"], "partial");
}

#[test]
fn source_correction_constrains_merge_without_claiming_public_lookup_ownership() {
    let w = World::new();
    let local = w.import_local("Local source", &[("bundle.zip", b"same bytes")]);
    let fixture: Value = serde_json::from_slice(&std::fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/catalog-sync/v0.3/examples/page.request.json")).unwrap()).unwrap();
    let page = crate::extract_library_page(fixture["params"]["html"].as_str().unwrap()).unwrap();
    let mut observation = crate::library_item_to_observation(&page.items[0], &format!("sha256:{}", "1".repeat(64)), "t", None, None);
    observation.product_id = "booth:91".into(); observation.native_product_id = "91".into();
    w.bdl.record_product_observation(&observation).unwrap();
    let edit = |revision, product: &str| vua_bdl_store::LibraryEntryMetadataUpdate {
        schema_version: "0.1".into(), entry_id: local.warehouse_item_id.clone(), expected_revision: revision,
        display_name: "My texture".into(), product_id: Some(product.into()), thumbnail_ref: None
    };
    w.bdl.update_library_entry_metadata(&edit(0, "booth:91"), "source-first", "t").unwrap();
    assert_eq!(library_view(&w, json!({"schemaVersion":"0.1"}))["total"], 2);
    w.download_reference(b"same bytes"); w.verify_sources("source-correction");
    let separate = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(separate["total"], 2);
    assert_eq!(separate["items"][1]["metadata"]["displayName"], "My texture");
    assert_eq!(separate["items"][1]["sourceMatch"]["product"]["productId"], "booth:91");
    assert!(w.bdl.product_library_memberships("booth:91").unwrap().is_empty());
    w.bdl.update_library_entry_metadata(&edit(1, "booth:90"), "source-corrected", "t").unwrap();
    let merged = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(merged["total"], 1);
    assert_eq!(merged["items"][0]["localEntries"][0]["entryId"], local.warehouse_item_id);
    assert_eq!(std::fs::read(&w.bdl.entry_copies(&local.warehouse_item_id).unwrap()[0].stored_path).unwrap(), b"same bytes");
}

#[test]
fn library_different_content_and_partial_folder_matches_keep_independent_files() {
    let w = World::new();
    let imported = w.import_local(
        "Mixed migration",
        &[("same.zip", b"same"), ("other.zip", b"different")],
    );
    for artifact in &imported.artifacts {
        w.bdl
            .record_artifact_mapping(
                &artifact.artifact_sha256,
                "booth:90",
                None,
                Some("user"),
                "2026-10-08T00:00:00Z",
            )
            .unwrap();
    }
    w.download_reference(b"same");
    w.verify_sources("partial-folder");
    let list = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(list["total"], 2);
    assert_eq!(list["items"][0]["storage"]["presentCopies"], 2);
    assert_eq!(list["items"][1]["storage"]["presentCopies"], 1);
    assert_eq!(list["items"][1]["sourceMatch"]["content"], "different");
    assert_eq!(
        list["items"][1]["sourceMatch"]["product"]["title"],
        list["items"][0]["product"]["title"]
    );
    assert_eq!(
        list["items"][1]["entry"]["artifacts"][0]["relativePath"],
        "other.zip"
    );
    let local_ids = list["items"][1]["copyIds"].as_array().unwrap();
    assert_eq!(local_ids.len(), 1);
    assert!(!list["items"][0]["copyIds"]
        .as_array()
        .unwrap()
        .contains(&local_ids[0]));
    assert_eq!(
        w.bdl
            .entry_copies(&imported.warehouse_item_id)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn library_same_size_edit_invalidates_proof_and_never_merges_changed_bytes() {
    let w = World::new();
    let imported = w.import_local("Imported copy", &[("copy.zip", b"original")]);
    w.download_reference(b"original");
    w.verify_sources("before-edit");
    assert_eq!(library_view(&w, json!({"schemaVersion":"0.1"}))["total"], 1);
    let copy = w
        .bdl
        .entry_copies(&imported.warehouse_item_id)
        .unwrap()
        .remove(0);
    let previous = std::fs::metadata(&copy.stored_path)
        .unwrap()
        .modified()
        .unwrap();
    std::fs::write(&copy.stored_path, b"modified").unwrap();
    std::fs::File::options()
        .write(true)
        .open(&copy.stored_path)
        .unwrap()
        .set_modified(previous + std::time::Duration::from_secs(1))
        .unwrap();
    assert_eq!(library_view(&w, json!({"schemaVersion":"0.1"}))["total"], 2);
    w.verify_sources("after-edit");
    let list = library_view(&w, json!({"schemaVersion":"0.1"}));
    assert_eq!(list["total"], 2);
    assert_eq!(list["items"][1]["storage"]["state"], "changed");
}

#[test]
fn library_reconciliation_can_cancel_without_hiding_unverified_local_files() {
    let w = World::new();
    w.import_local("Cancel migration", &[("copy.zip", b"same")]);
    w.download_reference(b"same");
    let gate = w.service.copy_write_lock();
    let guard = gate.lock().unwrap();
    let id = w
        .service
        .reconcile_library_sources("cancelled-check")
        .unwrap()
        .unwrap();
    w.runtime.cancel(&id).unwrap();
    drop(guard);
    w.wait_task(&id);
    assert_eq!(
        w.store.task(&id).unwrap().unwrap().state,
        TaskState::Cancelled
    );
    assert_eq!(library_view(&w, json!({"schemaVersion":"0.1"}))["total"], 2);
}
impl World {
    fn import_local(
        &self,
        name: &str,
        files: &[(&str, &[u8])],
    ) -> vua_bdl_store::WarehouseEntryDetail {
        let source = self.base.join("local-sources").join(name);
        std::fs::create_dir_all(&source).unwrap();
        for (name, bytes) in files {
            std::fs::write(source.join(name), bytes).unwrap();
        }
        crate::WarehouseImporter::new(&self.bdl, &SystemClock, self.base.join("warehouse"))
            .import_folder(&source)
            .unwrap()
            .entry
    }
    fn download_reference(&self, bytes: &[u8]) {
        self.begin("reference", &[901]);
        self.delivery(901, "dl-reference", bytes, "official.zip");
        self.observe("reference", 901, "settled", Some("dl-reference"))
            .unwrap();
        self.wait("reference");
    }
    fn verify_sources(&self, trigger: &str) -> String {
        let id = self
            .service
            .reconcile_library_sources(trigger)
            .unwrap()
            .unwrap();
        self.wait_task(&id);
        id
    }
    fn wait_task(&self, id: &str) {
        let started = std::time::Instant::now();
        while !self.store.task(id).unwrap().unwrap().state.is_terminal() {
            assert!(started.elapsed() < std::time::Duration::from_secs(5));
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    fn new() -> Self {
        let base = unique_dir("vua-library", "synthetic");
        let bdl = Arc::new(BdlStore::open(base.join("bdl.db")).unwrap());
        let fixture: Value = serde_json::from_slice(
            &std::fs::read(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../../schemas/catalog-sync/v0.3/examples/page.request.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let page = crate::library_page::extract_library_page(
            &fixture["params"]["html"]
                .as_str()
                .unwrap()
                .replace("901", "90"),
        )
        .unwrap();
        let observation = crate::library_page::library_item_to_observation(
            &page.items[0],
            &format!("sha256:{}", "0".repeat(64)),
            "2026-10-08T00:00:00Z",
            None,
            Some("bought"),
        );
        bdl.record_product_observation(&observation).unwrap();
        bdl.upsert_product_downloadables(
            "booth:90",
            &[(901, "synthetic.pdf".into()), (902, "synthetic.zip".into())],
            "2026-10-08T00:00:00Z",
            None,
            Some("bought"),
        )
        .unwrap();
        let store = Arc::new(SqliteTaskStore::open(base.join("tasks.db")).unwrap());
        let runtime = TaskRuntime::with_sqlite(
            store.clone(),
            Arc::new(SystemClock),
            Arc::new(NanosTaskIdGenerator::default()),
        )
        .unwrap();
        let service = LibraryDownloadService::new(
            store.clone(),
            bdl.clone(),
            runtime.clone(),
            base.join("warehouse"),
            base.join("downloads-staging"),
        )
        .unwrap();
        Self {
            base: base.clone(),
            bdl,
            store,
            runtime,
            service: Arc::new(service),
            _cleanup: Cleanup(base),
        }
    }
    fn begin(&self, name: &str, ids: &[i64]) -> Value {
        self.service.apply("library.beginDownload", json!({ "schemaVersion":"0.1", "batchId":format!("library-download-{name}"), "productId":"booth:90", "downloadableIds":ids }), |_| {}).unwrap()
    }
    fn observe(
        &self,
        name: &str,
        id: i64,
        outcome: &str,
        download_id: Option<&str>,
    ) -> Result<Value, LibraryDownloadError> {
        let mut p = json!({"schemaVersion":"0.1", "batchId":format!("library-download-{name}"), "downloadableId":id, "outcome":outcome});
        if let Some(download_id) = download_id {
            p["downloadId"] = json!(download_id);
        }
        self.service.apply("library.observeDownload", p, |_| {})
    }
    fn status(&self, name: &str) -> Value {
        self.service
            .apply(
                "library.downloadStatus",
                json!({"schemaVersion":"0.1", "batchId":format!("library-download-{name}")}),
                |_| {},
            )
            .unwrap()
    }
    fn wait(&self, name: &str) -> Value {
        let start = std::time::Instant::now();
        loop {
            let value = self.status(name);
            if value["state"] != "running" {
                return value;
            }
            assert!(
                start.elapsed() < std::time::Duration::from_secs(5),
                "batch stuck: {value}"
            );
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }
    fn delivery(&self, id: i64, download_id: &str, bytes: &[u8], name: &str) -> PathBuf {
        let root = self.base.join("downloads-staging");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join(format!("{download_id}.stage"));
        std::fs::write(&file, bytes).unwrap();
        for kind in [DownloadEventKind::Started, DownloadEventKind::Completed] {
            let event = DownloadEventV01 {
                schema_version: "0.1".into(),
                kind,
                download_id: download_id.into(),
                attempt: 1,
                source_url: "https://synthetic.booth.pm/delivery".into(),
                initiated_from_page_url: None,
                url_chain: Some(vec![
                    format!("https://booth.pm/downloadables/{id}"),
                    "https://synthetic.booth.pm/delivery".into(),
                ]),
                suggested_file_name: Some(name.into()),
                stored_path: if kind == DownloadEventKind::Completed {
                    Some(file.to_string_lossy().into())
                } else {
                    None
                },
                expected_bytes: Some(bytes.len() as u64),
                received_bytes: if kind == DownloadEventKind::Completed {
                    Some(bytes.len() as u64)
                } else {
                    None
                },
                resumable: false,
                failure_kind: None,
                occurred_at: if kind == DownloadEventKind::Completed {
                    "2026-10-08T00:00:01Z".into()
                } else {
                    "2026-10-08T00:00:00Z".into()
                },
            };
            DownloadEventConsumer::new(&self.bdl)
                .ingest(&event)
                .unwrap();
        }
        file
    }
}

#[path = "library_maintenance_tests.rs"]
mod maintenance;

#[test]
fn registers_all_files_and_preserves_partial_transfer_results() {
    let w = World::new();
    let initial = w.begin("partial", &[901, 902]);
    assert_eq!(initial["files"].as_array().unwrap().len(), 2);
    w.delivery(901, "dl-901", b"synthetic pdf", "instructions.pdf");
    let completion = DownloadEventConsumer::new(&w.bdl)
        .staging_completion("dl-901")
        .unwrap()
        .unwrap();
    assert!(matches!(
        ArtifactInspector::new(&w.bdl, &SystemClock)
            .inspect_download(&DownloadInspectionRequest {
                staging_token: &completion.staging_token,
                download_id: "dl-901",
                expected_staging_root: &w.base.join("downloads-staging")
            })
            .unwrap(),
        DownloadInspectionOutcome::Rejected(_)
    ));
    let first = w
        .observe("partial", 901, "settled", Some("dl-901"))
        .unwrap();
    assert_eq!(first["state"], "running");
    assert!(w.bdl.managed_library_file(901).unwrap().is_none());
    w.observe("partial", 902, "initiation_failed", None)
        .unwrap();
    let final_state = w.wait("partial");
    assert_eq!(final_state["state"], "succeeded_with_warnings");
    assert_eq!(final_state["files"][0]["phase"], "stored");
    assert_eq!(final_state["files"][1]["phase"], "failed");
    let managed = w.bdl.managed_library_file(901).unwrap().unwrap();
    assert_eq!(
        std::fs::read(managed.stored_path).unwrap(),
        b"synthetic pdf"
    );
    assert_eq!(
        w.bdl
            .artifact(&managed.artifact_sha256)
            .unwrap()
            .unwrap()
            .inspection_state,
        ArtifactInspectionState::Inspected
    );
}

#[test]
fn redownload_replaces_without_new_entry_copy_or_identity() {
    let w = World::new();
    w.begin("first", &[901]);
    w.delivery(901, "dl-old", b"old pdf", "instructions.pdf");
    w.observe("first", 901, "settled", Some("dl-old")).unwrap();
    w.wait("first");
    let old = w.bdl.managed_library_file(901).unwrap().unwrap();
    w.begin("second", &[901]);
    w.delivery(901, "dl-new", b"new pdf", "different-server-name.pdf");
    w.observe("second", 901, "settled", Some("dl-new")).unwrap();
    let result = w.wait("second");
    let new = w.bdl.managed_library_file(901).unwrap().unwrap();
    assert_eq!(result["state"], "succeeded", "{result}");
    assert_eq!(result["files"][0]["replaced"], true);
    assert_eq!(old.copy_id, new.copy_id);
    assert_eq!(old.warehouse_item_id, new.warehouse_item_id);
    assert_eq!(old.stored_path, new.stored_path);
    assert_ne!(old.artifact_sha256, new.artifact_sha256);
    assert_eq!(std::fs::read(&new.stored_path).unwrap(), b"new pdf");
    assert_eq!(
        w.bdl
            .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(w.bdl.entry_copies(&new.warehouse_item_id).unwrap().len(), 1);
    assert_eq!(
        std::fs::read_dir(w.base.join("downloads-staging"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        std::fs::read_dir(Path::new(&new.stored_path).parent().unwrap())
            .unwrap()
            .count(),
        1
    );
    assert_eq!(result, w.status("second"));
    assert_eq!(
        w.store
            .task("library-download-second")
            .unwrap()
            .unwrap()
            .result
            .unwrap(),
        result
    );
    w.observe("second", 901, "settled", Some("dl-new")).unwrap();
    assert_eq!(w.status("second"), result);
}

#[cfg(windows)]
#[test]
fn library_staging_cleanup_failure_keeps_confirmed_copy_and_reports_inspection() {
    use std::os::windows::fs::OpenOptionsExt;
    let w = World::new();
    w.begin("cleanup", &[901]);
    let staged = w.delivery(901, "dl-readonly", b"synthetic", "notes.pdf");
    // Allow the worker to read/copy bytes while a real Windows handle blocks deletion.
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0x00000001 | 0x00000002)
        .open(&staged)
        .unwrap();
    w.observe("cleanup", 901, "settled", Some("dl-readonly"))
        .unwrap();
    let result = w.wait("cleanup");
    drop(lock);
    assert_eq!(result["state"], "succeeded_with_warnings");
    assert_eq!(result["files"][0]["phase"], "stored");
    assert_eq!(
        result["files"][0]["errorCode"],
        "vua.library.staging_cleanup_failed"
    );
    assert_eq!(result["recoveryDisposition"], "inspect_required");
    let managed = w.bdl.managed_library_file(901).unwrap().unwrap();
    assert_eq!(std::fs::read(managed.stored_path).unwrap(), b"synthetic");
    assert!(staged.exists());
}

#[test]
fn library_staging_cleanup_refuses_the_owned_copy_and_changed_content() {
    let w = World::new();
    let root = w.base.join("downloads-staging");
    let staged = w.delivery(901, "dl-cleanup", b"original", "notes.pdf");
    let expected = format!("sha256:{}", hex_lower(&sha256_file(&staged).unwrap()));
    assert!(!consume_staging(&root, &staged, &staged, &expected));
    assert!(staged.exists());
    let owned = w.base.join("owned.pdf");
    std::fs::write(&owned, b"original").unwrap();
    std::fs::write(&staged, b"external edit").unwrap();
    assert!(!consume_staging(&root, &staged, &owned, &expected));
    assert!(staged.exists());
    assert!(!consume_staging(&root, &owned, &staged, &expected));
    assert!(owned.exists());
}

#[test]
fn inspection_failure_and_transfer_failure_keep_the_previous_file() {
    let w = World::new();
    w.begin("first", &[901]);
    w.delivery(901, "dl-old", b"original", "file.fbx");
    w.observe("first", 901, "settled", Some("dl-old")).unwrap();
    w.wait("first");
    let old = w.bdl.managed_library_file(901).unwrap().unwrap();
    w.begin("bad", &[901]);
    let staged = w.delivery(901, "dl-bad", b"bad", "file.fbx");
    std::fs::write(staged, b"size changed").unwrap();
    w.observe("bad", 901, "settled", Some("dl-bad")).unwrap();
    assert_eq!(w.wait("bad")["state"], "failed");
    assert_eq!(std::fs::read(&old.stored_path).unwrap(), b"original");
    assert_eq!(
        w.bdl
            .managed_library_file(901)
            .unwrap()
            .unwrap()
            .download_id,
        "dl-old"
    );
    w.begin("failed", &[901]);
    w.observe("failed", 901, "initiation_failed", None).unwrap();
    assert_eq!(w.status("failed")["state"], "failed");
    assert_eq!(std::fs::read(old.stored_path).unwrap(), b"original");
}

#[test]
fn external_change_refuses_replacement() {
    let w = World::new();
    w.begin("first", &[901]);
    w.delivery(901, "dl-old", b"old", "file.zip");
    w.observe("first", 901, "settled", Some("dl-old")).unwrap();
    w.wait("first");
    let old = w.bdl.managed_library_file(901).unwrap().unwrap();
    std::fs::write(&old.stored_path, b"user edit").unwrap();
    w.begin("changed", &[901]);
    w.delivery(901, "dl-new", b"new", "file.zip");
    w.observe("changed", 901, "settled", Some("dl-new"))
        .unwrap();
    assert_eq!(
        w.wait("changed")["files"][0]["errorCode"],
        "vua.library.replacement_file_changed"
    );
    assert_eq!(std::fs::read(old.stored_path).unwrap(), b"user edit");
}

#[test]
fn missing_bound_file_is_restored_without_adding_a_copy() {
    let w = World::new();
    w.begin("first", &[901]);
    w.delivery(901, "dl-old", b"old", "file.psd");
    w.observe("first", 901, "settled", Some("dl-old")).unwrap();
    w.wait("first");
    let old = w.bdl.managed_library_file(901).unwrap().unwrap();
    std::fs::remove_file(&old.stored_path).unwrap();
    w.begin("missing", &[901]);
    w.delivery(901, "dl-new", b"replacement", "file.psd");
    w.observe("missing", 901, "settled", Some("dl-new"))
        .unwrap();
    assert_eq!(w.wait("missing")["state"], "succeeded");
    assert_eq!(
        w.bdl.managed_library_file(901).unwrap().unwrap().copy_id,
        old.copy_id
    );
}

#[test]
fn an_unpersisted_or_foreign_delivery_cannot_trigger_adoption() {
    let w = World::new();
    w.begin("bound", &[901]);
    assert_eq!(
        w.observe("bound", 901, "settled", Some("dl-nothing"))
            .unwrap_err()
            .0,
        "delivery_not_persisted"
    );
    w.delivery(902, "dl-other", b"other", "file.zip");
    assert_eq!(
        w.observe("bound", 901, "settled", Some("dl-other"))
            .unwrap_err()
            .0,
        "delivery_not_persisted"
    );
    assert_eq!(w.status("bound")["files"][0]["phase"], "queued");
}

#[test]
fn admission_is_idempotent_and_busy_or_uncaptured_selections_are_refused() {
    let w = World::new();
    let first = w.begin("one", &[901]);
    assert_eq!(w.begin("one", &[901]), first);
    for (batch, ids, code) in [
        ("two", vec![901], "file_busy"),
        ("three", vec![999], "file_not_captured"),
        ("dup", vec![902, 902], "invalid_params"),
    ] {
        let result = w.service.apply("library.beginDownload", json!({"schemaVersion":"0.1","batchId":format!("library-download-{batch}"),"productId":"booth:90","downloadableIds":ids}), |_| {});
        assert_eq!(result.unwrap_err().0, code);
        assert!(w
            .store
            .task(&format!("library-download-{batch}"))
            .unwrap()
            .is_none());
    }
}

#[test]
fn restart_preserves_checkpoint_and_never_resumes_the_old_batch() {
    let w = World::new();
    w.begin("crash", &[901, 902]);
    w.delivery(901, "dl-one", b"one", "file.zip");
    w.observe("crash", 901, "settled", Some("dl-one")).unwrap();
    let recovered = LibraryDownloadService::new(
        w.store.clone(),
        w.bdl.clone(),
        w.runtime.clone(),
        w.base.join("warehouse"),
        w.base.join("downloads-staging"),
    )
    .unwrap();
    let p = json!({"schemaVersion":"0.1","batchId":"library-download-crash"});
    let snapshot = recovered
        .apply("library.downloadStatus", p.clone(), |_| {})
        .unwrap();
    assert_eq!(snapshot["recoveryDisposition"], "inspect_required");
    assert_eq!(snapshot["files"][0]["phase"], "downloaded");
    assert!(w.bdl.managed_library_file(901).unwrap().is_none());
    assert_eq!(recovered.apply("library.observeDownload", json!({"schemaVersion":"0.1","batchId":"library-download-crash","downloadableId":902,"outcome":"initiation_failed"}), |_| {}).unwrap_err().0, "inspect_required");
    let task = w.store.task("library-download-crash").unwrap().unwrap();
    w.store
        .mutate_task(
            &task.task_id,
            task.revision,
            &SystemClock.now_rfc3339(),
            TaskMutation::RequestCancellation { payload: json!({}) },
        )
        .unwrap();
    recovered
        .cancel_child("library-download-crash", |_| {})
        .unwrap();
    let closed = recovered
        .apply("library.downloadStatus", p, |_| {})
        .unwrap();
    assert_eq!(closed["state"], "cancelled");
    assert_eq!(closed["files"][0]["phase"], "cancelled");
    assert!(w.bdl.managed_library_file(901).unwrap().is_none());
}

#[test]
fn recovery_material_is_never_overwritten_and_owned_temporary_files_are_cleaned() {
    let w = World::new();
    w.begin("first", &[901]);
    w.delivery(901, "dl-old", b"old", "file.zip");
    w.observe("first", 901, "settled", Some("dl-old")).unwrap();
    w.wait("first");
    let old = w.bdl.managed_library_file(901).unwrap().unwrap();
    let folder = Path::new(&old.stored_path).parent().unwrap();
    let backup = folder.join(".vua-old-library-download-again-901");
    std::fs::write(&backup, b"previous recovery evidence").unwrap();
    w.begin("again", &[901]);
    w.delivery(901, "dl-new", b"new", "file.zip");
    w.observe("again", 901, "settled", Some("dl-new")).unwrap();
    assert_eq!(w.wait("again")["state"], "failed");
    assert_eq!(
        std::fs::read(&backup).unwrap(),
        b"previous recovery evidence"
    );
    assert_eq!(std::fs::read(&old.stored_path).unwrap(), b"old");
    assert!(!folder.join(".vua-new-library-download-again-901").exists());
}

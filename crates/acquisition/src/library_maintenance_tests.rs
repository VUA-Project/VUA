//! Real synthetic filesystem + durable task authority; shared selected-download fixture.
use super::*;
use crate::library_maintenance::{draft_selection_status, LibraryMaintenance};
use crate::recipe_selection_drafts::RecipeSelectionDrafts;
use vua_bdl_store::CopyRole;
use vua_orchestrator::RecipeDocumentStore;

fn stored(w: &World, id: i64, name: &str) -> vua_bdl_store::ManagedLibraryFile {
    w.begin(name, &[id]);
    w.delivery(id, &format!("dl-{name}"), b"original bytes", "notes.pdf");
    w.observe(name, id, "settled", Some(&format!("dl-{name}")))
        .unwrap();
    w.wait(name);
    w.bdl.managed_library_file(id).unwrap().unwrap()
}
fn service(w: &World) -> LibraryMaintenance {
    LibraryMaintenance::new(
        w.store.clone(),
        w.bdl.clone(),
        w.runtime.clone(),
        w.base.join("warehouse"),
        w.service.clone(),
    )
}
fn preview(
    s: &LibraryMaintenance,
    drafts: &RecipeSelectionDrafts,
    recipes: Option<&RecipeDocumentStore>,
    ids: Option<Vec<String>>,
) -> Value {
    let mut p = json!({"schemaVersion":"0.1","target":{"kind":"product","id":"booth:90"}});
    if let Some(ids) = ids {
        p["copyIds"] = json!(ids);
    }
    s.apply("library.removalPreview", p, drafts, recipes)
        .unwrap()
}
fn command(preview: &Value, name: &str) -> Value {
    json!({"schemaVersion":"0.1","removalId":format!("library-removal-{name}"),"target":preview["target"],
        "copyIds":preview["files"].as_array().unwrap().iter().map(|file|file["copyId"].clone()).collect::<Vec<_>>(),"previewHash":preview["previewHash"]})
}
fn wait(s: &LibraryMaintenance, drafts: &RecipeSelectionDrafts, name: &str) -> Value {
    let start = std::time::Instant::now();
    loop {
        let value = s
            .apply(
                "library.removalStatus",
                json!({"schemaVersion":"0.1","removalId":format!("library-removal-{name}")}),
                drafts,
                None,
            )
            .unwrap();
        if value["state"] != "running" {
            return value;
        }
        assert!(
            start.elapsed() < std::time::Duration::from_secs(5),
            "removal stuck: {value}"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}
fn draft(d: &RecipeSelectionDrafts, copy: &vua_bdl_store::ManagedLibraryFile) -> Value {
    d.apply("recipeDraft.save",json!({"schemaVersion":"0.1","draftId":"recipe-draft-local","title":"Synthetic selection","baseRevision":0,
        "selections":[{"identity":copy.artifact_sha256,"displayName":"Local PDF","source":"local","warehouseItemId":copy.warehouse_item_id}]})).unwrap()
}

#[test]
fn removal_keeps_catalog_bindings_and_references_then_download_restores_same_copy() {
    let w = World::new();
    let copy = stored(&w, 901, "initial");
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    let original_draft = draft(&drafts, &copy);
    let recipes = RecipeDocumentStore::new_with_system_clock(w.base.join("recipes"));
    let mut recipe: Value = serde_json::from_slice(
        &std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../schemas/recipe/v0.3/example.recipe.json"),
        )
        .unwrap(),
    )
    .unwrap();
    recipe["assets"][0]["sourceRef"] = json!({"provider":"booth","productId":"90"});
    recipes.save("synthetic-recipe", &recipe, 0).unwrap();
    let p = preview(&s, &drafts, Some(&recipes), None);
    assert_eq!(p["referenceCoverage"], "drafts_and_recipes");
    assert_eq!(p["references"].as_array().unwrap().len(), 2);
    assert_eq!(p["unresolvedRecipeAssets"], 1);
    assert!(p["references"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["missingAfterRemoval"] == true));
    assert!(!p
        .to_string()
        .contains(&w.base.to_string_lossy().to_string()));
    let request = command(&p, "accepted");
    let accepted = s
        .apply(
            "library.removeFiles",
            request.clone(),
            &drafts,
            Some(&recipes),
        )
        .unwrap();
    let result = wait(&s, &drafts, "accepted");
    assert_eq!(
        result["state"],
        "succeeded",
        "{result}; {:?}",
        w.store.task(result["taskId"].as_str().unwrap()).unwrap()
    );
    assert_eq!(result["files"][0]["phase"], "removed");
    assert!(!Path::new(&copy.stored_path).exists());
    assert!(w.bdl.catalog_detail("booth:90").unwrap().is_some());
    assert_eq!(
        w.bdl.managed_library_file(901).unwrap().unwrap().copy_id,
        copy.copy_id
    );
    assert_eq!(
        drafts
            .apply(
                "recipeDraft.get",
                json!({"schemaVersion":"0.1","draftId":"recipe-draft-local"})
            )
            .unwrap(),
        original_draft
    );
    assert_eq!(
        recipes.get("synthetic-recipe").unwrap().unwrap().recipe,
        recipe
    );
    let status = draft_selection_status(
        &w.bdl,
        &w.base.join("warehouse"),
        &drafts,
        json!({"schemaVersion":"0.1","draftId":"recipe-draft-local"}),
    )
    .unwrap();
    assert_eq!(status["items"][0]["state"], "missing");
    assert_eq!(status["revision"], original_draft["revision"]);
    let replay = s
        .apply(
            "library.removeFiles",
            request.clone(),
            &drafts,
            Some(&recipes),
        )
        .unwrap();
    assert_eq!(replay["taskId"], accepted["taskId"]);
    let mut conflict = request;
    conflict["previewHash"] = json!(format!("sha256:{}", "f".repeat(64)));
    assert_eq!(
        s.apply("library.removeFiles", conflict, &drafts, Some(&recipes))
            .unwrap_err()
            .0,
        "removal_conflict"
    );
    stored(&w, 901, "restored");
    let restored = w.bdl.managed_library_file(901).unwrap().unwrap();
    assert_eq!(restored.copy_id, copy.copy_id);
    assert_eq!(restored.warehouse_item_id, copy.warehouse_item_id);
    assert_eq!(
        std::fs::read(restored.stored_path).unwrap(),
        b"original bytes"
    );
    let restarted = TaskRuntime::with_sqlite(
        w.store.clone(),
        Arc::new(SystemClock),
        Arc::new(NanosTaskIdGenerator::default()),
    )
    .unwrap();
    let s2 = LibraryMaintenance::new(
        w.store.clone(),
        w.bdl.clone(),
        restarted,
        w.base.join("warehouse"),
        w.service.clone(),
    );
    assert_eq!(
        s2.apply(
            "library.removalStatus",
            json!({"schemaVersion":"0.1","removalId":"library-removal-accepted"}),
            &drafts,
            None
        )
        .unwrap()["state"],
        "succeeded"
    );
    assert!(Path::new(&copy.stored_path).exists());
}

#[test]
fn preview_drift_is_refused_and_same_size_content_drift_is_not_deleted() {
    let w = World::new();
    let copy = stored(&w, 901, "original");
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    let p = preview(&s, &drafts, None, None);
    std::fs::remove_file(&copy.stored_path).unwrap();
    assert_eq!(
        s.apply("library.removeFiles", command(&p, "drift"), &drafts, None)
            .unwrap_err()
            .0,
        "preview_changed"
    );
    std::fs::write(&copy.stored_path, b"modified bytes").unwrap();
    assert_eq!(std::fs::metadata(&copy.stored_path).unwrap().len(), 14);
    let p = preview(&s, &drafts, None, None);
    assert_eq!(p["files"][0]["presence"], "present");
    s.apply("library.removeFiles", command(&p, "content"), &drafts, None)
        .unwrap();
    let result = wait(&s, &drafts, "content");
    assert_eq!(result["state"], "failed");
    assert_eq!(result["files"][0]["errorCode"], "file_changed");
    assert_eq!(std::fs::read(&copy.stored_path).unwrap(), b"modified bytes");
}

#[test]
fn selected_files_report_partial_success_and_already_missing_independently() {
    let w = World::new();
    let first = stored(&w, 901, "one");
    let second = stored(&w, 902, "two");
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    std::fs::write(&second.stored_path, b"modified bytes").unwrap();
    let p = preview(&s, &drafts, None, None);
    s.apply("library.removeFiles", command(&p, "partial"), &drafts, None)
        .unwrap();
    let result = wait(&s, &drafts, "partial");
    assert_eq!(result["state"], "succeeded_with_warnings");
    assert!(!Path::new(&first.stored_path).exists());
    assert!(Path::new(&second.stored_path).exists());
    let p = preview(&s, &drafts, None, Some(vec![first.copy_id.clone()]));
    s.apply("library.removeFiles", command(&p, "missing"), &drafts, None)
        .unwrap();
    assert_eq!(
        wait(&s, &drafts, "missing")["files"][0]["phase"],
        "already_missing"
    );
}

#[test]
fn reference_read_failure_is_not_an_empty_preview() {
    let w = World::new();
    stored(&w, 901, "one");
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    std::fs::create_dir_all(w.base.join("drafts")).unwrap();
    std::fs::write(w.base.join("drafts/recipe-draft-bad.json"), b"corrupt").unwrap();
    assert_eq!(
        s.apply(
            "library.removalPreview",
            json!({"schemaVersion":"0.1","target":{"kind":"product","id":"booth:90"}}),
            &drafts,
            None
        )
        .unwrap_err()
        .0,
        "reference_read_failed"
    );
}

#[cfg(any(windows, unix))]
fn alias_path(w: &World, copy: &vua_bdl_store::ManagedLibraryFile) -> PathBuf {
    #[cfg(windows)]
    let path = PathBuf::from(copy.stored_path.to_ascii_uppercase());
    #[cfg(unix)]
    let path = {
        let directory = w.base.join("warehouse/path-alias");
        std::os::unix::fs::symlink(Path::new(&copy.stored_path).parent().unwrap(), &directory)
            .unwrap();
        directory.join(Path::new(&copy.stored_path).file_name().unwrap())
    };
    let _ = w;
    assert!(
        path.is_file(),
        "the synthetic alias must resolve to the actual file"
    );
    path
}

#[cfg(any(windows, unix))]
#[test]
fn a_path_alias_reference_is_affected_even_when_only_one_copy_id_is_selected() {
    let w = World::new();
    let copy = stored(&w, 901, "original");
    let aliased = alias_path(&w, &copy);
    let entry = w
        .bdl
        .create_warehouse_item(
            "Synthetic alias",
            "imported_material",
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
    let alias = w
        .bdl
        .record_artifact_copy(
            &entry.warehouse_item_id,
            &copy.artifact_sha256,
            "notes.pdf",
            aliased.to_str().unwrap(),
            CopyRole::Original,
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    let document = drafts.apply("recipeDraft.save", json!({"schemaVersion":"0.1","draftId":"recipe-draft-alias","title":"Synthetic alias reference","baseRevision":0,
        "selections":[{"source":"local","identity":alias.artifact_sha256,"warehouseItemId":alias.warehouse_item_id,"displayName":"Aliased file"}]})).unwrap();
    let s = service(&w);
    let p = preview(&s, &drafts, None, Some(vec![copy.copy_id.clone()]));
    assert_eq!(p["files"].as_array().unwrap().len(), 1);
    assert_eq!(p["references"].as_array().unwrap().len(), 1);
    assert_eq!(p["references"][0]["copyIds"], json!([alias.copy_id]));
    assert_eq!(p["references"][0]["missingAfterRemoval"], true);
    s.apply("library.removeFiles", command(&p, "alias"), &drafts, None)
        .unwrap();
    assert_eq!(wait(&s, &drafts, "alias")["state"], "succeeded");
    assert!(!aliased.exists());
    assert_eq!(
        drafts
            .apply(
                "recipeDraft.get",
                json!({"schemaVersion":"0.1","draftId":"recipe-draft-alias"})
            )
            .unwrap(),
        document
    );
    assert_eq!(
        w.bdl.entry_copies(&entry.warehouse_item_id).unwrap().len(),
        1
    );
}

#[cfg(any(windows, unix))]
#[test]
fn conflicting_hash_at_a_path_alias_refuses_deletion() {
    let w = World::new();
    let copy = stored(&w, 901, "original");
    let aliased = alias_path(&w, &copy);
    let conflicting_sha = format!("sha256:{}", "f".repeat(64));
    w.bdl
        .record_untrusted_artifact(&vua_bdl_store::NewLocalArtifact {
            artifact_sha256: conflicting_sha.clone(),
            size_bytes: 14,
            suggested_file_name: Some("notes.pdf".into()),
            download_id: None,
            first_seen_at: "2026-10-08T00:00:00Z".into(),
        })
        .unwrap();
    let entry = w
        .bdl
        .create_warehouse_item(
            "Conflicting synthetic alias",
            "imported_material",
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
    w.bdl
        .record_artifact_copy(
            &entry.warehouse_item_id,
            &conflicting_sha,
            "notes.pdf",
            aliased.to_str().unwrap(),
            CopyRole::Original,
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    let s = service(&w);
    let p = preview(&s, &drafts, None, Some(vec![copy.copy_id]));
    s.apply(
        "library.removeFiles",
        command(&p, "alias-conflict"),
        &drafts,
        None,
    )
    .unwrap();
    let result = wait(&s, &drafts, "alias-conflict");
    assert_eq!(result["state"], "failed");
    assert_eq!(result["files"][0]["errorCode"], "copy_changed");
    assert_eq!(std::fs::read(aliased).unwrap(), b"original bytes");
}

#[test]
fn a_ledger_copy_outside_the_managed_root_is_never_deleted() {
    let w = World::new();
    let copy = stored(&w, 901, "one");
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    let outside = w.base.join("outside-warehouse.pdf");
    std::fs::write(&outside, b"original bytes").unwrap();
    let foreign = w
        .bdl
        .record_artifact_copy(
            &copy.warehouse_item_id,
            &copy.artifact_sha256,
            "outside.pdf",
            outside.to_str().unwrap(),
            CopyRole::Original,
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
    let p = preview(&s, &drafts, None, Some(vec![foreign.copy_id]));
    assert_eq!(p["files"][0]["presence"], "unreadable");
    s.apply("library.removeFiles", command(&p, "foreign"), &drafts, None)
        .unwrap();
    let result = wait(&s, &drafts, "foreign");
    assert_eq!(result["state"], "failed");
    assert_eq!(result["files"][0]["errorCode"], "outside_managed_root");
    assert_eq!(std::fs::read(&outside).unwrap(), b"original bytes");
    assert!(Path::new(&copy.stored_path).exists());
}

#[test]
fn removal_waits_for_active_download() {
    let w = World::new();
    let copy = stored(&w, 901, "one");
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    let p = preview(&s, &drafts, None, None);
    w.begin("active", &[901]);
    assert_eq!(
        s.apply("library.removeFiles", command(&p, "busy"), &drafts, None)
            .unwrap_err()
            .0,
        "file_busy"
    );
    w.observe("active", 901, "initiation_failed", None).unwrap();
    assert!(Path::new(&copy.stored_path).exists());
}

#[test]
fn durable_interrupted_intent_replays_without_restarting_deletion() {
    let w = World::new();
    let copy = stored(&w, 901, "one");
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    let p = preview(&s, &drafts, None, None);
    let request = command(&p, "restart");
    let mut files = p["files"].clone();
    files[0]["storedPath"] = json!(copy.stored_path);
    files[0]["productIds"] = json!(["booth:90"]);
    let plan = json!({"request":request,"files":files});
    w.store.accept_idempotent_task("library.removeFiles","library-removal-restart",&plan.to_string(),&vua_orchestrator::NewTask {
        task_id:"task-interrupted-removal".into(),correlation_id:"library-removal-restart".into(),occurred_at:"2026-10-08T00:00:00Z".into(),
    },&json!({"schemaVersion":"0.1","taskId":"task-interrupted-removal","acceptedRevision":1,"initialState":"queued"})).unwrap();
    let runtime = TaskRuntime::with_sqlite(
        w.store.clone(),
        Arc::new(SystemClock),
        Arc::new(NanosTaskIdGenerator::default()),
    )
    .unwrap();
    let resumed = LibraryMaintenance::new(
        w.store.clone(),
        w.bdl.clone(),
        runtime,
        w.base.join("warehouse"),
        w.service.clone(),
    );
    let replay = resumed
        .apply("library.removeFiles", request, &drafts, None)
        .unwrap();
    assert_eq!(replay["state"], "unconfirmed");
    assert_eq!(replay["recoveryDisposition"], "inspect_required");
    assert_eq!(replay["files"][0]["phase"], "pending");
    assert!(Path::new(&copy.stored_path).exists());
    assert_eq!(
        w.store
            .task("task-interrupted-removal")
            .unwrap()
            .unwrap()
            .revision,
        1
    );
    assert_eq!(w.service.apply("library.beginDownload",json!({"schemaVersion":"0.1","batchId":"library-download-busy","productId":"booth:90","downloadableIds":[901]}),|_|{}).unwrap_err().0,"file_busy");

    // A later catalog binding may point at the same file under another path and
    // product. Plans persisted before alias IDs were recorded still fence it.
    #[cfg(any(windows, unix))]
    {
        let aliased = alias_path(&w, &copy);
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
                .replace("901", "91"),
        )
        .unwrap();
        let observation = crate::library_page::library_item_to_observation(
            &page.items[0],
            &format!("sha256:{}", "0".repeat(64)),
            "2026-10-08T00:00:01Z",
            None,
            Some("bought"),
        );
        w.bdl.record_product_observation(&observation).unwrap();
        w.bdl
            .upsert_product_downloadables(
                "booth:91",
                &[(903, "aliased-notes.pdf".into())],
                "2026-10-08T00:00:01Z",
                None,
                Some("bought"),
            )
            .unwrap();
        w.bdl
            .record_managed_library_delivery(&vua_bdl_store::ManagedLibraryDelivery {
                downloadable_id: 903,
                item_id: "entry-later-alias",
                display_name: "Synthetic alias binding",
                file_name: "aliased-notes.pdf",
                stored_path: aliased.to_str().unwrap(),
                sha: &copy.artifact_sha256,
                download_id: &copy.download_id,
                now: "2026-10-08T00:00:01Z",
            })
            .unwrap();
        assert_eq!(
            w.service
                .apply(
                    "library.beginDownload",
                    json!({"schemaVersion":"0.1","batchId":"library-download-alias-busy","productId":"booth:91","downloadableIds":[903]}),
                    |_| {},
                )
                .unwrap_err()
                .0,
            "file_busy"
        );
        assert!(Path::new(&copy.stored_path).exists());
    }
}

#[test]
fn changed_redownload_preserves_and_marks_old_vpm_but_equal_bytes_do_not() {
    let w = World::new();
    let copy = stored(&w, 901, "one");
    let path = w
        .base
        .join("warehouse")
        .join(&copy.warehouse_item_id)
        .join("old-vpm.zip");
    std::fs::write(&path, b"generated synthetic").unwrap();
    let sha = format!("sha256:{}", hex_lower(&sha256_file(&path).unwrap()));
    w.bdl
        .record_untrusted_artifact(&vua_bdl_store::NewLocalArtifact {
            artifact_sha256: sha.clone(),
            size_bytes: 19,
            suggested_file_name: Some("old-vpm.zip".into()),
            download_id: None,
            first_seen_at: "2026-10-08T00:00:00Z".into(),
        })
        .unwrap();
    let generated = w
        .bdl
        .record_artifact_copy(
            &copy.warehouse_item_id,
            &sha,
            "old-vpm.zip",
            path.to_str().unwrap(),
            CopyRole::GeneratedVpm,
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
    stored(&w, 901, "same");
    assert!(!w
        .bdl
        .generated_copy_is_superseded(&copy.warehouse_item_id, &sha)
        .unwrap());
    w.begin("changed", &[901]);
    w.delivery(901, "dl-changed", b"new original bytes", "notes.pdf");
    w.observe("changed", 901, "settled", Some("dl-changed"))
        .unwrap();
    w.wait("changed");
    assert!(w
        .bdl
        .generated_copy_is_superseded(&copy.warehouse_item_id, &sha)
        .unwrap());
    assert_eq!(std::fs::read(&path).unwrap(), b"generated synthetic");
    let copies = w.bdl.library_copy_evidence().unwrap();
    let old = copies
        .iter()
        .find(|c| c.copy.copy_id == generated.copy_id)
        .unwrap();
    assert!(old.superseded);
    assert!(old.product_ids.contains(&"booth:90".into()));
    let s = service(&w);
    let drafts = RecipeSelectionDrafts::new(w.base.join("drafts"));
    assert!(preview(&s, &drafts, None, None)["files"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["superseded"] == true));
}

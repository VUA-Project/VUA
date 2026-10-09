use super::*;
fn edit(id: &str, revision: u64, name: &str) -> LibraryEntryMetadataUpdate {
    LibraryEntryMetadataUpdate {
        schema_version: "0.1".into(),
        entry_id: id.into(),
        expected_revision: revision,
        display_name: name.into(),
        product_id: None,
        thumbnail_ref: None,
    }
}
#[test]
fn revisions_and_atomic_receipts_preserve_independent_local_identity() {
    let store = BdlStore::open_in_memory().unwrap();
    let first = store
        .create_warehouse_item("Same name", "imported_material", "t")
        .unwrap();
    let second = store
        .create_warehouse_item("Same name", "imported_material", "t")
        .unwrap();
    assert_eq!(
        store
            .library_entry_metadata(&first.warehouse_item_id)
            .unwrap()
            .revision,
        0
    );
    let update = edit(&first.warehouse_item_id, 0, "Edited name");
    let receipt = store
        .update_library_entry_metadata(&update, "edit-1", "t")
        .unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(
        store
            .update_library_entry_metadata(&update, "edit-1", "later")
            .unwrap()
            .revision,
        1
    );
    assert!(matches!(
        store.update_library_entry_metadata(&update, "edit-2", "t"),
        Err(BdlStoreError::InvalidEvent("metadata_conflict"))
    ));
    assert!(matches!(
        store.update_library_entry_metadata(
            &edit(&first.warehouse_item_id, 1, "Other"),
            "edit-1",
            "t"
        ),
        Err(BdlStoreError::InvalidEvent("metadata_conflict"))
    ));
    assert_eq!(
        store
            .library_entry_metadata(&second.warehouse_item_id)
            .unwrap()
            .display_name,
        "Same name"
    );
    let renamed = store
        .warehouse_entry_detail(
            &first.warehouse_item_id,
            ArtifactMode::UseOriginalUnitypackage,
        )
        .unwrap()
        .unwrap();
    assert_eq!(renamed.folder_name, first.folder_name);
    let mut unknown = edit(&first.warehouse_item_id, 1, "No partial update");
    unknown.product_id = Some("booth:999".into());
    assert!(matches!(
        store.update_library_entry_metadata(&unknown, "bad-source", "t"),
        Err(BdlStoreError::UnknownProduct(_))
    ));
    assert_eq!(
        store
            .library_entry_metadata(&first.warehouse_item_id)
            .unwrap()
            .display_name,
        "Edited name"
    );
}
#[test]
fn rejected_metadata_never_renames_entries_or_edits_account_downloads() {
    let store = BdlStore::open_in_memory().unwrap();
    let local = store
        .create_warehouse_item("Local", "imported_material", "t")
        .unwrap();
    let account = store
        .create_warehouse_item("Official", "downloaded_material", "t")
        .unwrap();
    assert!(matches!(
        store.update_library_entry_metadata(
            &edit(&account.warehouse_item_id, 0, "Fake"),
            "account",
            "t"
        ),
        Err(BdlStoreError::InvalidEvent("entry_not_local"))
    ));
    for (index, name) in ["", " ", "line\nfeed", "tab\there"].iter().enumerate() {
        assert!(store
            .update_library_entry_metadata(
                &edit(&local.warehouse_item_id, 0, name),
                &format!("bad-{index}"),
                "t"
            )
            .is_err());
    }
    let mut bad = edit(&local.warehouse_item_id, 0, "Local");
    bad.thumbnail_ref = Some("file:///C:/private.png".into());
    assert!(store
        .update_library_entry_metadata(&bad, "bad-thumb", "t")
        .is_err());
    store.connection.lock().unwrap().execute_batch("CREATE TRIGGER reject_metadata BEFORE INSERT ON library_entry_metadata BEGIN SELECT RAISE(FAIL, 'synthetic rejection'); END;").unwrap();
    assert!(store
        .update_library_entry_metadata(
            &edit(&local.warehouse_item_id, 0, "Rollback"),
            "rollback",
            "t"
        )
        .is_err());
    assert_eq!(
        store
            .library_entry_metadata(&local.warehouse_item_id)
            .unwrap()
            .display_name,
        "Local"
    );
    assert_eq!(
        store
            .library_entry_metadata(&local.warehouse_item_id)
            .unwrap()
            .revision,
        0
    );
}

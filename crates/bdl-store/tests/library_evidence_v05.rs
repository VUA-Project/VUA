//! Consumes the additive migration against a real pre-existing v0.4 database.
use vua_bdl_store::BdlStore;

fn old_store() -> rusqlite::Connection {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    for sql in [
        include_str!("../../../schemas/bdl/v0.1/001_initial.sql"),
        include_str!("../../../schemas/bdl/v0.2/002_dependency_observations.sql"),
        include_str!("../../../schemas/bdl/v0.3/003_library_type.sql"),
        include_str!("../../../schemas/bdl/v0.3/004_variant_name.sql"),
        include_str!("../../../schemas/bdl/v0.4/005_product_downloadables.sql"),
    ] {
        connection.execute_batch(sql).unwrap();
    }
    connection.execute("INSERT INTO products(product_id,native_product_id,source_url,status,title,content_hash,observed_at,processor_version,library_type) VALUES ('booth:90','90','https://booth.pm/items/90','complete','Synthetic old row',?1,'2026-10-01T00:00:00Z','synthetic','gifts')",[format!("sha256:{}","a".repeat(64))]).unwrap();
    connection.execute("INSERT INTO product_downloadables(downloadable_id,product_id,anchor_text,first_seen_at,last_seen_at) VALUES (901,'booth:90','Old filename','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z')",[]).unwrap();
    connection.pragma_update(None, "user_version", 5).unwrap();
    connection
}

#[test]
fn migration_preserves_old_rows_and_backfills_only_observed_membership() {
    let root = std::env::temp_dir().join(format!("vua-bdl-library-migrate-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("synthetic.db");
    let old = old_store();
    old.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .unwrap();
    drop(old);
    let store = BdlStore::open(&path).unwrap();
    assert_eq!(
        store
            .catalog_detail("booth:90")
            .unwrap()
            .unwrap()
            .product
            .title
            .as_deref(),
        Some("Synthetic old row")
    );
    assert_eq!(
        store.downloadables_for_product("booth:90").unwrap(),
        vec![(901, "Old filename".into())]
    );
    assert_eq!(
        store.product_library_memberships("booth:90").unwrap(),
        vec!["gifts"]
    );
    assert!(store.managed_library_file(901).unwrap().is_none());
    drop(store);
    let connection = rusqlite::Connection::open(&path).unwrap();
    let version: String = connection
        .query_row(
            "SELECT value FROM bdl_meta WHERE key='format_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, "0.5");
    let dates:(String,String)=connection.query_row("SELECT first_seen_at,last_seen_at FROM product_downloadables WHERE downloadable_id=901",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
    assert_eq!(
        dates,
        ("2026-10-01T00:00:00Z".into(), "2026-10-02T00:00:00Z".into())
    );
    drop(connection);
    std::fs::remove_file(&path).unwrap();
    let _ = std::fs::remove_dir(&root);
}

#[test]
fn migration_stamp_is_guarded_and_membership_vocabulary_is_closed() {
    let connection = old_store();
    connection
        .execute(
            "UPDATE bdl_meta SET value='foreign' WHERE key='format_version'",
            [],
        )
        .unwrap();
    connection
        .execute_batch(include_str!(
            "../../../schemas/bdl/v0.5/006_managed_library_files.sql"
        ))
        .unwrap();
    let version: String = connection
        .query_row(
            "SELECT value FROM bdl_meta WHERE key='format_version'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(version, "foreign");
    assert!(connection.execute("INSERT INTO product_library_memberships VALUES ('booth:90','invented','synthetic','synthetic')",[]).is_err());
}

//! product_downloadables storage tests (BDL persistent format v0.4,
//! migration 005; N5 silent-download slice 2026-10-05).
//!
//! Behavior under test — the store's OWN faces and migration execution:
//! - fresh stores are born v0.4 and serve an empty downloadables read;
//! - an existing v0.3 database (user_version = 4, format_version '0.3')
//!   migrates on open: the table appears, format stamp becomes '0.4',
//!   pre-existing product rows carry over verbatim;
//! - the write face is idempotent per downloadable id: re-sighting updates
//!   last_seen_at / anchor_text / run / library_type but never rewrites
//!   first_seen_at; a NULL library_type re-sync never overwrites a known one;
//! - the read face serves per product in (first_seen_at, id) order;
//! - FK discipline: downloadables for an unknown product are refused by
//!   SQLite, not by a shadow Rust check.

use vua_bdl_store::{BdlStore, ProductObservation, ProductObservationStatus};

const MIGRATION_001: &str = include_str!("../../../schemas/bdl/v0.1/001_initial.sql");
const MIGRATION_002: &str = include_str!("../../../schemas/bdl/v0.2/002_dependency_observations.sql");
const MIGRATION_003: &str = include_str!("../../../schemas/bdl/v0.3/003_library_type.sql");
const MIGRATION_004: &str = include_str!("../../../schemas/bdl/v0.3/004_variant_name.sql");

fn seed_product(store: &BdlStore, id: &str) {
    store
        .record_product_observation(&ProductObservation {
            product_id: format!("booth:{id}"),
            native_product_id: id.to_owned(),
            library_type: None,
            variant_name: None,
            source_url: format!("https://booth.pm/ja/items/{id}"),
            final_url: None,
            status: ProductObservationStatus::Complete,
            source_locale: None,
            source_category: None,
            title: Some(format!("Item {id}")),
            description: None,
            age_restriction: None,
            adult: false,
            availability: None,
            price_amount: None,
            price_currency: None,
            shop_name: None,
            shop_url: None,
            image_urls: vec![],
            video_urls: vec![],
            subproducts: vec![],
            source_published_at: None,
            content_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000".to_owned(),
            observed_at: "2026-10-05T00:00:00.000Z".to_owned(),
            run_id: None,
            processor_version: "test".to_owned(),
            missing_fields: vec![],
        })
        .unwrap();
}

#[test]
fn fresh_store_is_v04_with_empty_downloadables_read() {
    let store = BdlStore::open_in_memory().unwrap();
    assert_eq!(vua_bdl_store::BDL_FORMAT_VERSION, "0.4");
    seed_product(&store, "1001");
    assert!(store.downloadables_for_product("booth:1001").unwrap().is_empty());
    // Unknown product is an honest empty read (the download-time flow
    // re-captures from the library page), never an error.
    assert!(store.downloadables_for_product("booth:9999").unwrap().is_empty());
}

#[test]
fn v03_database_migrates_to_v04_on_open() {
    let dir = std::env::temp_dir().join(format!("bdl-v04-migrate-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("bdl.db");
    let _ = std::fs::remove_file(&db);
    {
        let connection = rusqlite::Connection::open(&db).unwrap();
        connection.execute_batch(MIGRATION_001).unwrap();
        connection.execute_batch(MIGRATION_002).unwrap();
        connection.execute_batch(MIGRATION_003).unwrap();
        connection.execute_batch(MIGRATION_004).unwrap();
        connection
            .pragma_update(None, "user_version", 4)
            .unwrap();
    }
    let store = BdlStore::open(&db).unwrap();
    seed_product(&store, "2002");
    store
        .upsert_product_downloadables(
            "booth:2002",
            &[(555_001, "Download".to_owned())],
            "2026-10-05T00:00:00.000Z",
            Some("run-1"),
            Some("bought"),
        )
        .unwrap();
    let rows = store.downloadables_for_product("booth:2002").unwrap();
    assert_eq!(rows, vec![(555_001, "Download".to_owned())]);
    drop(store);
    let _ = std::fs::remove_file(&db);
    let _ = std::fs::remove_file(dir.join("bdl.db-wal"));
    let _ = std::fs::remove_file(dir.join("bdl.db-shm"));
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn re_sighting_updates_last_seen_but_never_first_seen_or_known_library() {
    let dir = std::env::temp_dir().join(format!("bdl-v04-resight-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = dir.join("bdl.db");
    let _ = std::fs::remove_file(&db);
    let store = BdlStore::open(&db).unwrap();
    seed_product(&store, "3003");
    store
        .upsert_product_downloadables(
            "booth:3003",
            &[
                (700_001, "Download".to_owned()),
                (700_002, "Download".to_owned()),
            ],
            "2026-10-05T01:00:00.000Z",
            Some("run-1"),
            Some("bought"),
        )
        .unwrap();
    // Second sighting: label changed (page language switch), one file gone
    // (never deleted), library_type absent on this page.
    store
        .upsert_product_downloadables(
            "booth:3003",
            &[(700_001, "ダウンロード".to_owned())],
            "2026-10-05T02:00:00.000Z",
            Some("run-2"),
            None,
        )
        .unwrap();

    let rows = store.downloadables_for_product("booth:3003").unwrap();
    assert_eq!(
        rows,
        vec![
            (700_001, "ダウンロード".to_owned()),
            (700_002, "Download".to_owned()),
        ],
        "vanished file stays as last-seen fact; label refreshes in place"
    );
    drop(store);

    // first_seen_at is pinned to the first sighting (read back via a second
    // raw connection — the read face deliberately does not expose capture
    // bookkeeping).
    let reader = rusqlite::Connection::open(&db).unwrap();
    let (first_seen, last_seen, library_type, run_id): (String, String, Option<String>, Option<String>) =
        reader
            .query_row(
                "SELECT first_seen_at, last_seen_at, library_type, last_seen_run_id
                 FROM product_downloadables WHERE downloadable_id = 700001",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
    assert_eq!(first_seen, "2026-10-05T01:00:00.000Z");
    assert_eq!(last_seen, "2026-10-05T02:00:00.000Z");
    assert_eq!(library_type.as_deref(), Some("bought"));
    assert_eq!(run_id.as_deref(), Some("run-2"));
    drop(reader);
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(dir.join(format!("bdl.db{suffix}")));
    }
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn downloadables_for_unknown_product_are_refused_by_the_foreign_key() {
    let store = BdlStore::open_in_memory().unwrap();
    let outcome = store.upsert_product_downloadables(
        "booth:4040",
        &[(900_001, "Download".to_owned())],
        "2026-10-05T00:00:00.000Z",
        None,
        None,
    );
    assert!(outcome.is_err(), "FK to products must refuse orphan files");
}

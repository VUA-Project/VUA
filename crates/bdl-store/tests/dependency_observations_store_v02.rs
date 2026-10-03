//! Storage-layer behavior tests for the bdl-store v0.2 landing (BDL
//! persistent format v0.2, collab/proposals/030; frozen wt-4 batch 166,
//! store landed wt-4 batch 168).
//!
//! The FROZEN vector files (schemas/bdl/v0.2/vectors/, 9 accept P1–P9 +
//! 8 reject N1–N8) are the data source; the store's OWN faces and the
//! store's OWN migration execution are the behavior under test:
//!
//! - every accept vector lands (P1–P8 through `record_dependency_observation`;
//!   P4 additionally through the explicit human confirmation write action
//!   `confirm_dependency_resolution` — the only writer of
//!   `confirmed_by_human = 1`) and reads back verbatim through the store read
//!   face; P9 (compatibility_observations) has no store write face — its v0.1
//!   surface reality — so its cases are driven over the store's own migrated
//!   database and read back from it;
//! - every reject vector is refused by the REAL SQLite constraints behind the
//!   store: cases expressible in the typed write face surface
//!   `BdlStoreError::Database` over a ConstraintViolation (CHECK/NOT NULL/FK
//!   — the frozen schema is the single law authority, the store keeps no
//!   duplicate Rust closed set); cases whose lawless values are
//!   unrepresentable in the typed face (SQL NULL against NOT NULL columns,
//!   `confirmed_by_human = 2`) are driven against the store's own migrated
//!   database and refused by the same constraints;
//! - the migration discipline: fresh stores are born v0.2 (001 + 002 in one
//!   transaction), existing v0.1 databases migrate on open with verbatim row
//!   carry-over, and the established `UnsupportedFormat` discipline refuses
//!   future `user_version` fences and foreign `format_version` values.
//!
//! Honesty boundary: code-face evidence only — this proves the store persists,
//! migrates and enforces the frozen v0.2 word face on real SQLite. It proves
//! NO extraction capability, NO consumption face, and nothing on a real
//! machine; tests green != real-machine green.

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

use vua_bdl_store::{
    BdlStore, BdlStoreError, DependencyResolutionEvidence, NewDependencyObservation,
    StoredDependencyObservation,
};

const MIGRATION_001: &str = include_str!("../../../schemas/bdl/v0.1/001_initial.sql");
const MIGRATION_002: &str = include_str!("../../../schemas/bdl/v0.2/002_dependency_observations.sql");

// ---------------------------------------------------------------------------
// The frozen vector files: the machine-readable data source.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct VectorFile {
    vector: String,
    name: String,
    expect: String, // "accept" | "reject"
    cases: Vec<VectorCase>,
}

#[derive(Deserialize)]
struct VectorCase {
    table: String,
    values: Map<String, Value>,
}

fn vectors_dir() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../schemas/bdl/v0.2/vectors")
        .leak()
}

fn load_vectors() -> Vec<(String, VectorFile)> {
    let dir = vectors_dir();
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();
    names
        .into_iter()
        .map(|name| {
            let bytes = fs::read(dir.join(&name)).unwrap();
            let parsed: VectorFile = serde_json::from_slice(&bytes).unwrap();
            // The frozen naming convention: the file name is the vector name.
            assert_eq!(
                name,
                format!("{}.json", parsed.name),
                "file name matches the frozen vector name"
            );
            (name, parsed)
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Store plumbing: per-test databases, seeded products, raw re-entry.
// ---------------------------------------------------------------------------

fn store_path(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "vua-bdl-store-v02-{tag}-{}.db",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

/// Opens a store on its own file and seeds the two observed products the
/// vectors reference (FK targets; identity resolution points at OBSERVED
/// products).
fn open_seeded_store(path: &Path) -> BdlStore {
    let store = BdlStore::open(path).unwrap();
    store.seed_product("booth:6584744", "6584744").unwrap();
    store.seed_product("booth:3087170", "3087170").unwrap();
    store
}

/// A second raw connection over the store's own database file (the store
/// closed): the entry point for cases whose values the typed write face
/// cannot honestly express.
fn reopen_raw(path: &Path) -> Connection {
    let conn = Connection::open(path).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn
}

fn insert_raw(conn: &Connection, case: &VectorCase) -> rusqlite::Result<usize> {
    let mut columns: Vec<String> = case.values.keys().cloned().collect();
    columns.sort();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        case.table,
        columns.join(", "),
        vec!["?"; columns.len()].join(", ")
    );
    let bound: Vec<Box<dyn rusqlite::ToSql>> = columns
        .iter()
        .map(|c| match &case.values[c] {
            Value::String(s) => Box::new(s.clone()) as Box<dyn rusqlite::ToSql>,
            Value::Number(n) => Box::new(n.as_i64().expect("vector integers are i64"))
                as Box<dyn rusqlite::ToSql>,
            Value::Null => Box::new(rusqlite::types::Null) as Box<dyn rusqlite::ToSql>,
            other => panic!("vector values are string/int/null only, got: {other}"),
        })
        .collect();
    let refs: Vec<&dyn rusqlite::ToSql> = bound.iter().map(|b| b.as_ref()).collect();
    conn.execute(&sql, refs.as_slice())
}

// ---------------------------------------------------------------------------
// Typed-face routing: what the write face can honestly express.
// ---------------------------------------------------------------------------

/// Columns whose lawless values are unrepresentable in the typed write face
/// (the face carries them as non-optional Rust strings).
const TYPED_REQUIRED: [&str; 9] = [
    "product_id",
    "dep_kind",
    "dep_name",
    "raw_quote",
    "source_span",
    "extraction_method",
    "extracted_by",
    "observed_at",
    "processor_version",
];

fn typed_face_case(table: &str, values: &Map<String, Value>) -> bool {
    table == "dependency_observations"
        && TYPED_REQUIRED.iter().all(|key| !values[*key].is_null())
        // confirmed is not a write-face field at all: rows land unconfirmed,
        // so a vector carrying the flag cannot ride the typed face.
        && !values.contains_key("confirmed_by_human")
}

fn as_str_value(key: &str, values: &Map<String, Value>) -> String {
    values[key].as_str().expect(key).to_string()
}

fn opt_str_value(key: &str, values: &Map<String, Value>) -> Option<String> {
    values
        .get(key)
        .and_then(|v| if v.is_null() { None } else { Some(v.as_str().expect(key).to_string()) })
}

fn typed_observation(values: &Map<String, Value>) -> NewDependencyObservation {
    let resolution_evidence = match values.get("resolution_evidence") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::String(text)) => serde_json::from_str(text)
            .expect("vector evidence parses into the frozen shape"),
        other => panic!("vector evidence is a JSON string, got {other:?}"),
    };
    NewDependencyObservation {
        product_id: as_str_value("product_id", values),
        dep_kind: as_str_value("dep_kind", values),
        dep_name: as_str_value("dep_name", values),
        raw_quote: as_str_value("raw_quote", values),
        source_span: as_str_value("source_span", values),
        version_hint: opt_str_value("version_hint", values),
        resolved_ref_product_id: opt_str_value("resolved_ref_product_id", values),
        resolution_evidence,
        extraction_method: as_str_value("extraction_method", values),
        extracted_by: as_str_value("extracted_by", values),
        observed_at: as_str_value("observed_at", values),
        processor_version: as_str_value("processor_version", values),
        content_hash: opt_str_value("content_hash", values),
        run_id: opt_str_value("run_id", values),
    }
}

fn evidence_of(values: &Map<String, Value>) -> Vec<DependencyResolutionEvidence> {
    match values.get("resolution_evidence") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::String(text)) => {
            serde_json::from_str(text).expect("vector evidence parses into the frozen shape")
        }
        other => panic!("vector evidence is a JSON string, got {other:?}"),
    }
}

/// The stored row must carry every vector fact verbatim — the round trip
/// through real SQLite loses nothing and invents nothing.
fn assert_row_matches_vector(name: &str, stored: &StoredDependencyObservation, values: &Map<String, Value>) {
    assert!(stored.observation_id > 0, "{name}: row identity assigned");
    assert_eq!(stored.product_id, as_str_value("product_id", values), "{name}");
    assert_eq!(stored.dep_kind, as_str_value("dep_kind", values), "{name}");
    assert_eq!(stored.dep_name, as_str_value("dep_name", values), "{name}");
    assert_eq!(stored.raw_quote, as_str_value("raw_quote", values), "{name}");
    assert_eq!(stored.source_span, as_str_value("source_span", values), "{name}");
    assert_eq!(
        stored.version_hint.as_deref(),
        opt_str_value("version_hint", values).as_deref(),
        "{name}: version_hint verbatim or honestly absent"
    );
    assert_eq!(
        stored.resolved_ref_product_id.as_deref(),
        opt_str_value("resolved_ref_product_id", values).as_deref(),
        "{name}"
    );
    let expected_evidence = match values.get("resolution_evidence") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => Some(
            serde_json::from_str::<Vec<Value>>(text)
                .expect("vector evidence parses into the frozen shape"),
        ),
        other => panic!("vector evidence is a JSON string, got {other:?}"),
    };
    match (expected_evidence, &stored.resolution_evidence) {
        (None, None) => {}
        (Some(expected), Some(stored_evidence)) => {
            assert_eq!(
                serde_json::to_value(stored_evidence).unwrap(),
                Value::Array(expected),
                "{name}: resolution evidence round-trips the frozen shape"
            );
        }
        (expected, stored) => panic!("{name}: evidence presence mismatch {expected:?} vs {stored:?}"),
    }
    assert_eq!(
        stored.confirmed_by_human,
        values.get("confirmed_by_human").and_then(Value::as_i64).unwrap_or(0) == 1,
        "{name}: confirmed only where the vector (the confirmation) says 1"
    );
    assert_eq!(stored.extraction_method, as_str_value("extraction_method", values), "{name}");
    assert_eq!(stored.extracted_by, as_str_value("extracted_by", values), "{name}");
    assert_eq!(stored.observed_at, as_str_value("observed_at", values), "{name}");
    assert_eq!(stored.processor_version, as_str_value("processor_version", values), "{name}");
    assert_eq!(
        stored.content_hash.as_deref(),
        opt_str_value("content_hash", values).as_deref(),
        "{name}"
    );
    assert_eq!(stored.run_id.as_deref(), opt_str_value("run_id", values).as_deref(), "{name}");
}

fn constraint_violation(error: &BdlStoreError) -> bool {
    matches!(
        error,
        BdlStoreError::Database(rusqlite::Error::SqliteFailure(failure, _))
            if failure.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

// ---------------------------------------------------------------------------
// Accept vectors: land through the store faces, read back verbatim.
// ---------------------------------------------------------------------------

#[test]
fn accept_vectors_land_through_the_store_faces_and_read_back() {
    for (name, vector) in load_vectors().into_iter().filter(|(_, v)| v.expect == "accept") {
        let path = store_path("accept");
        let store = open_seeded_store(&path);
        let mut landed: Vec<(i64, &VectorCase)> = Vec::new();
        let mut compat_cases: Vec<&VectorCase> = Vec::new();

        for case in &vector.cases {
            if case.table == "dependency_observations" {
                // The typed face never carries the flag: P4's confirmed = 1
                // rides the confirmation write action below.
                let stored = store
                    .record_dependency_observation(&typed_observation(&case.values))
                    .unwrap_or_else(|e| panic!("{name} must land through the store: {e}"));
                landed.push((stored.observation_id, case));
            } else {
                assert_eq!(case.table, "compatibility_observations", "{name}: routed table");
                compat_cases.push(case);
            }
        }

        // P4's flag is NOT a write-face field: the explicit, recorded human
        // confirmation write action is the only writer of confirmed = 1.
        if vector.vector == "P4" {
            let case = &vector.cases[0];
            let confirmed = store
                .confirm_dependency_resolution(
                    landed[0].0,
                    case.values["resolved_ref_product_id"].as_str().unwrap(),
                    &evidence_of(&case.values),
                )
                .unwrap_or_else(|e| panic!("{name} must confirm through the action face: {e}"));
            assert!(confirmed.confirmed_by_human, "{name}: the confirmation flips the flag");
        }

        drop(store);
        if !compat_cases.is_empty() {
            // compatibility_observations has no store write face (its v0.1
            // surface reality): P9 lands over the store's own migrated
            // database.
            let raw = reopen_raw(&path);
            for case in &compat_cases {
                insert_raw(&raw, case)
                    .unwrap_or_else(|e| panic!("{name} compat case must land: {e}"));
            }
        }

        // Read back: the store reopens its own database and serves every
        // landed row verbatim.
        let store = BdlStore::open(&path).unwrap();
        let rows = store.dependency_observations("booth:6584744").unwrap();
        assert_eq!(
            rows.len(),
            landed.len(),
            "{name}: every landed observation reads back"
        );
        for (observation_id, case) in &landed {
            let stored = rows
                .iter()
                .find(|row| row.observation_id == *observation_id)
                .unwrap_or_else(|| panic!("{name}: row {observation_id} reads back"));
            assert_row_matches_vector(&name, stored, &case.values);
        }
        if !compat_cases.is_empty() {
            let raw = reopen_raw(&path);
            let mut statement = raw
                .prepare(
                    "SELECT raw_quote, source_span, observed_at
                     FROM compatibility_observations ORDER BY observation_id",
                )
                .unwrap();
            let served: Vec<(String, String, String)> = statement
                .query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            assert_eq!(
                served.len(),
                compat_cases.len(),
                "{name}: every compat case reads back"
            );
            for ((quote, span, observed_at), case) in served.iter().zip(&compat_cases) {
                assert_eq!(quote, case.values["raw_quote"].as_str().unwrap(), "{name}");
                assert_eq!(span, case.values["source_span"].as_str().unwrap(), "{name}");
                assert_eq!(observed_at, case.values["observed_at"].as_str().unwrap(), "{name}");
            }
        }
        drop(store);
        fs::remove_file(&path).ok();
    }
}

// ---------------------------------------------------------------------------
// Reject vectors: refused by the REAL constraints behind the store.
// ---------------------------------------------------------------------------

#[test]
fn reject_vectors_are_refused_by_the_real_constraints() {
    for (name, vector) in load_vectors().into_iter().filter(|(_, v)| v.expect == "reject") {
        let path = store_path("reject");
        let store = open_seeded_store(&path);
        let mut raw_cases: Vec<&VectorCase> = Vec::new();

        for case in &vector.cases {
            if typed_face_case(&case.table, &case.values) {
                let error = store
                    .record_dependency_observation(&typed_observation(&case.values))
                    .expect_err(&format!("{name} must be refused by the store"));
                assert!(
                    constraint_violation(&error),
                    "{name}: expected a real constraint violation, got: {error}"
                );
            } else {
                raw_cases.push(case);
            }
        }
        drop(store);
        if !raw_cases.is_empty() {
            // The unrepresentable lawless values (SQL NULL against NOT NULL
            // columns, confirmed = 2) hit the store's own migrated database.
            let raw = reopen_raw(&path);
            for case in raw_cases {
                let error = insert_raw(&raw, case)
                    .expect_err(&format!("{name} must be refused by the store's database"));
                assert!(
                    matches!(error, rusqlite::Error::SqliteFailure(failure, _)
                        if failure.code == rusqlite::ErrorCode::ConstraintViolation),
                    "{name}: expected a real constraint violation, got: {error}"
                );
            }
        }
        fs::remove_file(&path).ok();
    }

    // The freeze ruling's contested member rides the store face too: the
    // five-value draft's 'unity_or_sdk_version' is refused (N1).
    let n1 = load_vectors()
        .into_iter()
        .find(|(_, v)| v.vector == "N1")
        .expect("N1 present");
    let path = store_path("reject-n1");
    let store = open_seeded_store(&path);
    for case in &n1.1.cases {
        let error = store
            .record_dependency_observation(&typed_observation(&case.values))
            .expect_err("the frozen dep_kind ruling refuses the draft member");
        assert!(constraint_violation(&error), "N1: CHECK refusal, got: {error}");
    }
}

// ---------------------------------------------------------------------------
// Migration discipline: born v0.2; v0.1 migrates on open; the fence holds.
// ---------------------------------------------------------------------------

#[test]
fn fresh_stores_are_born_v02_and_v01_databases_migrate_on_open() {
    // Fresh: born v0.2 through the full executable chain in one transaction.
    let born_path = store_path("born");
    {
        let store = BdlStore::open(&born_path).unwrap();
        let status = store.catalog_status().unwrap();
        assert_eq!(status.revision.dataset_revision, "0.3");
    }
    {
        let raw = reopen_raw(&born_path);
        let user_version: i64 = raw
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(user_version, 4, "the host-owned fence was set to 4 (001-004)");
    }

    // Existing v0.1 database: opens, migrates, keeps every row verbatim.
    let migrate_path = store_path("migrate");
    {
        let raw = Connection::open(&migrate_path).unwrap();
        raw.pragma_update(None, "foreign_keys", "ON").unwrap();
        raw.execute_batch(MIGRATION_001).unwrap();
        raw.pragma_update(None, "user_version", 1).unwrap();
        raw.execute(
            "INSERT INTO products (product_id, native_product_id, source_url, status,
                 content_hash, observed_at, processor_version)
             VALUES ('booth:6584744', '6584744', 'https://booth.pm/ja/items/6584744',
                 'complete', 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                 '2026-09-21T00:00:00.000Z', 'obs-0.1')",
            [],
        )
        .unwrap();
        raw.execute(
            "INSERT INTO compatibility_observations
                 (product_id, raw_quote, source_span, confirmed_by_human, observed_at)
             VALUES ('booth:6584744', '・liltoon 2.3.2~', 'body', 1, '2026-09-21T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }
    let store = BdlStore::open(&migrate_path).unwrap();
    assert_eq!(
        store.catalog_status().unwrap().revision.dataset_revision,
        "0.3",
        "the migrated database serves the v0.3 format"
    );
    {
        let raw = reopen_raw(&migrate_path);
        let user_version: i64 = raw
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(user_version, 4);
        let (quote, span, confirmed): (String, String, i64) = raw
            .query_row(
                "SELECT raw_quote, source_span, confirmed_by_human
                 FROM compatibility_observations",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!((quote.as_str(), span.as_str(), confirmed), ("・liltoon 2.3.2~", "body", 1));
        // The rebuilt table admits the old AND the new word face (P9's law).
        raw.execute(
            "INSERT INTO compatibility_observations
                 (product_id, raw_quote, source_span, observed_at)
             VALUES ('booth:6584744', '17アバター対応', 'title', '2026-09-22T00:00:00.000Z')",
            [],
        )
        .unwrap();
    }
    // And the new table is writable through the store face immediately.
    let stored = store
        .record_dependency_observation(&NewDependencyObservation {
            product_id: "booth:6584744".into(),
            dep_kind: "shader".into(),
            dep_name: "liltoon".into(),
            raw_quote: "・liltoon 2.3.2~".into(),
            source_span: "body".into(),
            version_hint: Some("2.3.2~".into()),
            resolved_ref_product_id: None,
            resolution_evidence: Vec::new(),
            extraction_method: "explicit_heading".into(),
            extracted_by: "human".into(),
            observed_at: "2026-09-22T00:00:00.000Z".into(),
            processor_version: "dep-0.1".into(),
            content_hash: None,
            run_id: None,
        })
        .unwrap();
    assert!(stored.observation_id > 0, "the migrated store serves the v0.2 write face");
    drop(store);
    fs::remove_file(&born_path).ok();
    fs::remove_file(&migrate_path).ok();
}

#[test]
fn unsupported_format_discipline_refuses_future_and_foreign_databases() {
    // A future user_version fence: refused, never silently downgraded.
    let future_path = store_path("future");
    {
        let raw = Connection::open(&future_path).unwrap();
        raw.execute_batch(MIGRATION_001).unwrap();
        raw.pragma_update(None, "user_version", 5).unwrap();
    }
    let error = match BdlStore::open(&future_path) {
        Err(error) => error,
        Ok(_) => panic!("a future user_version fence must be refused"),
    };
    assert!(
        matches!(error, BdlStoreError::UnsupportedFormat(ref version) if version == "migration-5"),
        "future fence refused: {error}"
    );

    // A foreign format_version at the current fence: refused.
    let foreign_path = store_path("foreign");
    {
        let raw = Connection::open(&foreign_path).unwrap();
        raw.execute_batch(MIGRATION_001).unwrap();
        raw.execute_batch(MIGRATION_002).unwrap();
        raw.execute_batch(
            "ALTER TABLE products ADD COLUMN library_type TEXT; UPDATE bdl_meta SET value = '0.3' WHERE key = 'format_version';",
        )
        .unwrap();
        raw.pragma_update(None, "user_version", 3).unwrap();
        raw.execute(
            "UPDATE bdl_meta SET value = '9.9' WHERE key = 'format_version'",
            [],
        )
        .unwrap();
    }
    let error = match BdlStore::open(&foreign_path) {
        Err(error) => error,
        Ok(_) => panic!("a foreign format_version must be refused"),
    };
    assert!(
        matches!(error, BdlStoreError::UnsupportedFormat(ref version) if version == "9.9"),
        "foreign format refused: {error}"
    );
    fs::remove_file(&future_path).ok();
    fs::remove_file(&foreign_path).ok();
}

// ---------------------------------------------------------------------------
// The confirmation write action: the only writer of confirmed = 1.
// ---------------------------------------------------------------------------

fn clue_observation() -> NewDependencyObservation {
    NewDependencyObservation {
        product_id: "booth:6584744".into(),
        dep_kind: "shader".into(),
        dep_name: "lilToon".into(),
        raw_quote: "lilToon 本体".into(),
        source_span: "description_link".into(),
        version_hint: None,
        resolved_ref_product_id: Some("booth:3087170".into()),
        resolution_evidence: vec![DependencyResolutionEvidence {
            link_text: "lilToon".into(),
            link_url: "https://lilxyzw.booth.pm/items/3087170".into(),
            span: "description_link".into(),
            note: None,
        }],
        extraction_method: "link".into(),
        extracted_by: "human".into(),
        observed_at: "2026-09-22T00:00:00.000Z".into(),
        processor_version: "dep-0.1".into(),
        content_hash: None,
        run_id: None,
    }
}

fn evidence_element() -> DependencyResolutionEvidence {
    DependencyResolutionEvidence {
        link_text: "lilToon".into(),
        link_url: "https://lilxyzw.booth.pm/items/3087170".into(),
        span: "description_link".into(),
        note: Some("title/shop reconciliation".into()),
    }
}

#[test]
fn the_confirmation_write_action_is_the_only_confirmed_writer() {
    let store = BdlStore::open_in_memory().unwrap();
    store.seed_product("booth:6584744", "6584744").unwrap();
    store.seed_product("booth:3087170", "3087170").unwrap();

    // A resolution lands as a CLUE — even with evidence, the flag is 0.
    let stored = store.record_dependency_observation(&clue_observation()).unwrap();
    assert!(!stored.confirmed_by_human, "rows land unconfirmed (DEFAULT 0)");
    let rows = store.dependency_observations("booth:6584744").unwrap();
    assert_eq!(rows.len(), 1);
    assert!(!rows[0].confirmed_by_human, "the read face serves the clue as a clue");

    // Unknown observation: refused with its identity.
    assert!(matches!(
        store.confirm_dependency_resolution(999, "booth:3087170", &[evidence_element()]),
        Err(BdlStoreError::UnknownDependencyObservation(999))
    ));
    // Unknown target product: identity resolution points at OBSERVED products.
    assert!(matches!(
        store.confirm_dependency_resolution(stored.observation_id, "booth:9999999", &[evidence_element()]),
        Err(BdlStoreError::UnknownProduct(product)) if product == "booth:9999999"
    ));
    // Empty evidence is no evidence: not an honest confirmation.
    assert!(matches!(
        store.confirm_dependency_resolution(stored.observation_id, "booth:3087170", &[]),
        Err(BdlStoreError::InvalidResolution(_))
    ));

    // The explicit confirm flips exactly this row and pins the resolution.
    let confirmed = store
        .confirm_dependency_resolution(stored.observation_id, "booth:3087170", &[evidence_element()])
        .unwrap();
    assert!(confirmed.confirmed_by_human);
    assert_eq!(confirmed.resolved_ref_product_id.as_deref(), Some("booth:3087170"));
    assert_eq!(
        confirmed.resolution_evidence.as_deref(),
        Some(&[evidence_element()][..]),
        "the recorded evidence round-trips the frozen shape"
    );
    let rows = store.dependency_observations("booth:6584744").unwrap();
    assert!(rows[0].confirmed_by_human, "the confirmation persists");

    // Re-confirmation (batch-192 reverse review pin): the same single writer
    // acting again MAY re-pin — even to a different observed product — and
    // every guard still holds on the repeat path (no second write face, no
    // guard bypass once a row is already confirmed).
    let reconfirmed = store
        .confirm_dependency_resolution(stored.observation_id, "booth:6584744", &[evidence_element()])
        .unwrap();
    assert!(reconfirmed.confirmed_by_human);
    assert_eq!(
        reconfirmed.resolved_ref_product_id.as_deref(),
        Some("booth:6584744"),
        "a repeat confirm re-pins the resolution it carries"
    );
    assert_eq!(
        reconfirmed.resolution_evidence.as_deref(),
        Some(&[evidence_element()][..])
    );
    assert!(matches!(
        store.confirm_dependency_resolution(stored.observation_id, "booth:9999999", &[evidence_element()]),
        Err(BdlStoreError::UnknownProduct(_))
    ), "the unknown-target guard holds on the repeat path too");
    assert!(matches!(
        store.confirm_dependency_resolution(stored.observation_id, "booth:3087170", &[]),
        Err(BdlStoreError::InvalidResolution(_))
    ), "the empty-evidence guard holds on the repeat path too");
}

// ---------------------------------------------------------------------------
// A stored evidence value that does not parse into the frozen shape is a
// corrupt value, never silently reshaped.
// ---------------------------------------------------------------------------

#[test]
fn corrupt_stored_evidence_surfaces_as_corruption() {
    let path = store_path("corrupt");
    {
        let store = open_seeded_store(&path);
        store.record_dependency_observation(&clue_observation()).unwrap();
    }
    {
        let raw = reopen_raw(&path);
        raw.execute(
            "UPDATE dependency_observations SET resolution_evidence = '{\"bogus\": 1}'",
            [],
        )
        .unwrap();
    }
    let store = BdlStore::open(&path).unwrap();
    assert!(matches!(
        store.dependency_observations("booth:6584744"),
        Err(BdlStoreError::CorruptValue { field: "resolution_evidence", .. })
    ));
    fs::remove_file(&path).ok();
}

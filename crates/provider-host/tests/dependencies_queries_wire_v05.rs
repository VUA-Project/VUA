//! bdl-queries v0.5 dependencies read-face wire tests (the core wiring
//! batch, proposal 030 §5.7 case A).
//!
//! The host consumes the data-side frozen vectors from
//! `schemas/bdl-queries/v0.6/examples` through the REAL frame loop. The
//! REAL query executor (reading the BDL library) is a later
//! data/production-domain implementation ring, so this batch rides a FAKE
//! port implementing the core `DependenciesQueriesPort` — the wire
//! contract under test is the ROUTE, not the executor: (1) the frozen
//! positive request vectors drive the route and the frozen positive result
//! vectors are replayed through the typed port facts, so the wire answer
//! must equal the frozen vector verbatim (the face adds nothing, hides
//! nothing — the envelope const stamp aside) and must validate against the
//! frozen result schema; (2) the frozen negative vectors are contract
//! errors at the route layer (`vua.catalog.invalid_params` — the family's
//! registered code, zero new codes), never silently filtered answers; (3)
//! the honest absence ladder is pinned: absent warehouse wiring, absent
//! port slot, and the declared-none capability gate all answer the family
//! typed absence BEFORE the port is ever called (the gate-before-port law,
//! asserted by the fake's call recorder); (4) an unknown productId rides
//! the catalog.detail absence semantics (`vua.catalog.product_not_found`),
//! never a fabricated empty answer; (5) a typed refusal travels VERBATIM.

use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use vua_orchestrator::{
    AppErrorV1, DependenciesListByProductResultV05, DependenciesLookupResultV05, DependenciesQueriesCapabilities,
    DependenciesQueriesPort, ErrorCategory,
};
use vua_bdl_store::{
    ArtifactMode, BdlStore, DependencyResolutionEvidence, NewDependencyObservation,
    ProductObservation, ProductObservationStatus, BDL_QUERIES_SCHEMA_VERSION,
};
use vua_provider_host::{run_provider_host_full, WarehouseConfig};

fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/bdl-queries/v0.6")
}

fn read_json(relative: &str) -> Value {
    let bytes = fs::read(schema_dir().join(relative)).expect("schema/vector must exist");
    serde_json::from_slice(&bytes).expect("schema/vector must be valid JSON")
}

fn query_validator() -> jsonschema::Validator {
    jsonschema::validator_for(&read_json("query.schema.json")).expect("frozen query schema")
}

fn result_validator() -> jsonschema::Validator {
    jsonschema::validator_for(&read_json("result.schema.json")).expect("frozen result schema")
}

/// The deterministic fake port: programmed results, a declared/undeclared
/// capability bit, an optional typed refusal, and a call recorder so the
/// tests can prove the route gate answers BEFORE the port (the
/// recipe-export FakeExporter law).
struct FakeQueries {
    cap: bool,
    lookup: Option<DependenciesLookupResultV05>,
    list_by_product: Option<Option<DependenciesListByProductResultV05>>,
    failure: Option<AppErrorV1>,
    calls: Arc<Mutex<Vec<String>>>,
}

impl FakeQueries {
    fn declaring() -> Self {
        Self {
            cap: true,
            lookup: None,
            list_by_product: None,
            failure: None,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn undeclaring() -> Self {
        let mut fake = Self::declaring();
        fake.cap = false;
        fake
    }
}

impl DependenciesQueriesPort for FakeQueries {
    fn dependencies_capabilities(&self) -> DependenciesQueriesCapabilities {
        DependenciesQueriesCapabilities { dependencies_queries: self.cap }
    }

    fn dependencies_lookup(
        &self,
        _params: &vua_orchestrator::DependenciesLookupParams,
    ) -> Result<DependenciesLookupResultV05, AppErrorV1> {
        assert!(
            self.cap,
            "the route gate must answer the honest absence BEFORE the port"
        );
        self.calls.lock().expect("calls poisoned").push("dependencies.lookup".into());
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        Ok(self.lookup.clone().expect("lookup result programmed"))
    }

    fn dependencies_list_by_product(
        &self,
        _product_id: &str,
    ) -> Result<Option<DependenciesListByProductResultV05>, AppErrorV1> {
        assert!(
            self.cap,
            "the route gate must answer the honest absence BEFORE the port"
        );
        self.calls
            .lock()
            .expect("calls poisoned")
            .push("dependencies.listByProduct".into());
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        Ok(self.list_by_product.clone().expect("listing programmed"))
    }
}

/// Process-unique serial for the temp paths below. The nanosecond clock
/// alone has collided under CI load — parallel tests in this same process
/// sampled the same coarse clock tick and shared one SQLite file, so two
/// `BdlStore::open` calls raced one database's migration and WAL-switch
/// locks and lost the 5 s busy window ("BDL opens: DatabaseBusy",
/// dependencies_queries_wire_v05.rs:195, CI runs 35931927077 and the PR
/// #31/#33 attempts). The serial removes the collision class entirely (the
/// acquisition `unique_dir` law, BOARD #7 precedent); the pid term stays
/// for cross-binary isolation, the nanos term stays for crash-run reuse.
static TEMP_SERIAL: AtomicU64 = AtomicU64::new(0);

fn next_temp_serial() -> u64 {
    TEMP_SERIAL.fetch_add(1, Ordering::Relaxed)
}

fn temp_database(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let base = std::env::temp_dir().join(format!(
        "vua-provider-dependencies-{label}-{}-{nanos}-{}",
        std::process::id(),
        next_temp_serial()
    ));
    fs::create_dir_all(&base).expect("temp layout");
    base.join("tasks.db")
}

/// Runs one query frame through the real frame loop. `warehouse` carries
/// the optional fake port; `None` runs the host with no warehouse wiring
/// at all (the honest-absence rung below the port).
fn run_query(
    database: &PathBuf,
    warehouse: Option<WarehouseConfig>,
    method: &str,
    params: Value,
) -> Value {
    let frame = json!({
        "frameVersion": "0.1",
        "frameId": "frame-dependencies-v05",
        "kind": "request",
        "payload": {
            "contractVersion": "0.1",
            "requestId": "req-dependencies-v05",
            "correlationId": "corr-dependencies-v05",
            "kind": "query",
            "method": method,
            "params": params,
        },
    });
    let mut output = Vec::new();
    run_provider_host_full(
        Cursor::new(format!("{frame}\n")),
        &mut output,
        database,
        None,
        None,
        warehouse,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("frame loop runs");
    let frames: Vec<Value> = String::from_utf8(output)
        .expect("output is UTF-8")
        .lines()
        .map(|line| serde_json::from_str(line).expect("output lines are frames"))
        .collect();
    frames[0]["payload"].clone()
}

fn warehouse_with(queries: Option<Arc<dyn DependenciesQueriesPort>>) -> WarehouseConfig {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let bdl_root = std::env::temp_dir().join(format!(
        "vua-provider-dependencies-bdl-{}-{nanos}-{}",
        std::process::id(),
        next_temp_serial()
    ));
    fs::create_dir_all(&bdl_root).expect("temp layout");
    WarehouseConfig {
        bdl: Arc::new(BdlStore::open(bdl_root.join("bdl.db")).expect("BDL opens")),
        warehouse_root: bdl_root.join("warehouse"),
        global_default: ArtifactMode::UseOriginalUnitypackage,
        executor: None,
        dependencies_queries: queries,
    }
}

fn expect_error(payload: &Value, code: &str, message_key: &str, category: &str) {
    assert_eq!(payload["ok"], false, "payload: {payload}");
    assert_eq!(payload["error"]["code"], code, "payload: {payload}");
    assert_eq!(payload["error"]["messageKey"], message_key, "payload: {payload}");
    assert_eq!(payload["error"]["category"], category, "payload: {payload}");
}

/// Loads the frozen positive result vector's `result` body into the typed
/// port facts — proving the typed face deserializes exactly from the
/// frozen word face (a field mismatch here breaks the vector replay).
fn frozen_lookup_result() -> DependenciesLookupResultV05 {
    serde_json::from_value(read_json("examples/dependencies-lookup.result.json")["result"].clone())
        .expect("the frozen lookup result vector deserializes into the typed facts")
}

fn frozen_list_result() -> DependenciesListByProductResultV05 {
    serde_json::from_value(
        read_json("examples/dependencies-listbyproduct.result.json")["result"].clone(),
    )
    .expect("the frozen listing result vector deserializes into the typed facts")
}

#[test]
fn frozen_lookup_vector_rides_the_real_frame_loop_verbatim() {
    let database = temp_database("lookup");
    let mut fake = FakeQueries::declaring();
    fake.lookup = Some(frozen_lookup_result());
    let calls = fake.calls.clone();
    let warehouse = warehouse_with(Some(Arc::new(fake)));

    // The frozen REQUEST vector drives the route (its params are exactly
    // what the frozen query schema admits).
    let request = read_json("examples/dependencies-lookup.request.json");
    assert!(query_validator().is_valid(&request), "the frozen request vector must match the frozen query schema");
    let params = request["params"].clone();

    let payload = run_query(&database, Some(warehouse), "dependencies.lookup", params);
    assert_eq!(payload["ok"], true, "payload: {payload}");
    // The wire answer equals the frozen RESULT vector verbatim — the route
    // stamps the shared family envelope const, the port facts stay
    // verbatim (the P1 discipline).
    let frozen = read_json("examples/dependencies-lookup.result.json");
    let envelope = &payload["value"];
    assert_eq!(envelope["schemaVersion"], BDL_QUERIES_SCHEMA_VERSION);
    assert_eq!(envelope["schemaVersion"], "0.6");
    assert_eq!(envelope["operation"], "dependencies.lookup");
    assert_eq!(envelope["result"], frozen["result"], "the wire facts must equal the frozen vector");
    assert!(
        result_validator().is_valid(envelope),
        "the wire envelope must match the frozen result schema: {envelope}"
    );
    assert_eq!(*calls.lock().expect("calls"), vec!["dependencies.lookup"]);
    let _ = fs::remove_file(&database);
}

#[test]
fn frozen_list_by_product_vector_rides_the_real_frame_loop_verbatim() {
    let database = temp_database("list");
    let mut fake = FakeQueries::declaring();
    fake.list_by_product = Some(Some(frozen_list_result()));
    let warehouse = warehouse_with(Some(Arc::new(fake)));

    let request = read_json("examples/dependencies-listbyproduct.request.json");
    assert!(query_validator().is_valid(&request), "the frozen request vector must match the frozen query schema");
    let params = request["params"].clone();

    let payload = run_query(&database, Some(warehouse), "dependencies.listByProduct", params);
    assert_eq!(payload["ok"], true, "payload: {payload}");
    let frozen = read_json("examples/dependencies-listbyproduct.result.json");
    let envelope = &payload["value"];
    assert_eq!(envelope["schemaVersion"], "0.6");
    assert_eq!(envelope["operation"], "dependencies.listByProduct");
    assert_eq!(envelope["result"], frozen["result"], "the wire facts must equal the frozen vector");
    assert!(
        result_validator().is_valid(envelope),
        "the wire envelope must match the frozen result schema: {envelope}"
    );
}

#[test]
fn absent_port_answers_the_family_honest_absence() {
    let database = temp_database("absent-port");
    let payload = run_query(
        &database,
        Some(warehouse_with(None)),
        "dependencies.lookup",
        json!({"name": "lilToon"}),
    );
    // The family's registered absence code — zero new codes.
    expect_error(&payload, "vua.catalog.unavailable", "errors.catalog.unavailable", "unavailable");
    let _ = fs::remove_file(&database);
}

#[test]
fn absent_warehouse_wiring_answers_the_family_honest_absence() {
    let database = temp_database("absent-warehouse");
    let payload = run_query(
        &database,
        None,
        "dependencies.listByProduct",
        json!({"productId": "booth:6584744"}),
    );
    expect_error(&payload, "vua.catalog.unavailable", "errors.catalog.unavailable", "unavailable");
    let _ = fs::remove_file(&database);
}

#[test]
fn declared_none_capability_answers_the_gate_before_the_port() {
    let database = temp_database("declared-none");
    let fake = FakeQueries::undeclaring();
    let calls = fake.calls.clone();
    let warehouse = warehouse_with(Some(Arc::new(fake)));

    let payload = run_query(
        &database,
        Some(warehouse),
        "dependencies.lookup",
        json!({"name": "lilToon"}),
    );
    expect_error(&payload, "vua.catalog.unavailable", "errors.catalog.unavailable", "unavailable");
    assert!(
        calls.lock().expect("calls").is_empty(),
        "the gate must answer BEFORE the port is ever called"
    );
    let _ = fs::remove_file(&database);
}

#[test]
fn unknown_product_rides_the_catalog_not_found_semantics() {
    let database = temp_database("not-found");
    let mut fake = FakeQueries::declaring();
    fake.list_by_product = Some(None);
    let warehouse = warehouse_with(Some(Arc::new(fake)));

    let payload = run_query(
        &database,
        Some(warehouse),
        "dependencies.listByProduct",
        json!({"productId": "booth:9999999"}),
    );
    // The catalog.detail absence semantics the protocol text aligns with —
    // never a fabricated empty answer.
    expect_error(
        &payload,
        "vua.catalog.product_not_found",
        "errors.catalog.productNotFound",
        "validation",
    );
    let _ = fs::remove_file(&database);
}

#[test]
fn typed_refusal_rides_verbatim() {
    let database = temp_database("refusal");
    let mut fake = FakeQueries::declaring();
    fake.lookup = Some(DependenciesLookupResultV05 { total: 0, matches: Vec::new() });
    fake.failure = Some(AppErrorV1::new(
        "vua.warehouse.store_failed",
        ErrorCategory::Internal,
        "errors.warehouse.storeFailed",
        "corr-fake-dependencies",
    ));
    let warehouse = warehouse_with(Some(Arc::new(fake)));

    let payload = run_query(
        &database,
        Some(warehouse),
        "dependencies.lookup",
        json!({"name": "lilToon"}),
    );
    // The read-face pass-through discipline: the port's typed refusal
    // travels verbatim, no route rewrite.
    expect_error(
        &payload,
        "vua.warehouse.store_failed",
        "errors.warehouse.storeFailed",
        "internal",
    );
    let _ = fs::remove_file(&database);
}

#[test]
fn frozen_negative_vectors_are_contract_errors_never_filtered_answers() {
    let negatives = [
        ("examples/invalid-dependencies-lookup-empty-name.json", "dependencies.lookup"),
        (
            "examples/invalid-dependencies-lookup-foreign-dep-kind.json",
            "dependencies.lookup",
        ),
        ("examples/invalid-dependencies-lookup-fuzzy-param.json", "dependencies.lookup"),
        (
            "examples/invalid-dependencies-listbyproduct-params.json",
            "dependencies.listByProduct",
        ),
    ];
    for (vector, method) in negatives {
        let database = temp_database("negative");
        let fake = FakeQueries::declaring();
        let calls = fake.calls.clone();
        let warehouse = warehouse_with(Some(Arc::new(fake)));

        let request = read_json(vector);
        assert!(
            !query_validator().is_valid(&request),
            "the frozen negative vector must stay rejected by the frozen query schema: {vector}"
        );
        let payload = run_query(&database, Some(warehouse), method, request["params"].clone());
        expect_error(
            &payload,
            "vua.catalog.invalid_params",
            "errors.catalog.invalidParams",
            "validation",
        );
        assert!(
            calls.lock().expect("calls").is_empty(),
            "the closed-set parse must refuse BEFORE the port: {vector}"
        );
        let _ = fs::remove_file(&database);
    }
}

#[test]
fn out_of_range_pagination_is_a_contract_error() {
    let database = temp_database("pagination");
    for params in [
        json!({"name": "lilToon", "limit": 0}),
        json!({"name": "lilToon", "limit": 201}),
        json!({"name": "lilToon", "offset": -1}),
    ] {
        let fake = FakeQueries::declaring();
        let calls = fake.calls.clone();
        let warehouse = warehouse_with(Some(Arc::new(fake)));
        let payload = run_query(&database, Some(warehouse), "dependencies.lookup", params);
        expect_error(
            &payload,
            "vua.catalog.invalid_params",
            "errors.catalog.invalidParams",
            "validation",
        );
        assert!(calls.lock().expect("calls").is_empty());
    }
    let _ = fs::remove_file(&database);
}

#[test]
fn unknown_method_under_the_prefix_answers_unknown_method() {
    let database = temp_database("unknown-method");
    let warehouse = warehouse_with(Some(Arc::new(FakeQueries::declaring())));
    let payload = run_query(
        &database,
        Some(warehouse),
        "dependencies.fuzzySearch",
        json!({}),
    );
    expect_error(
        &payload,
        "vua.provider.unknown_method",
        "errors.provider.unknownMethod",
        "validation",
    );
    let _ = fs::remove_file(&database);
}

#[test]
fn capability_row_follows_the_declared_none_default_and_the_override_flip() {
    let database = temp_database("capabilities");
    // Declared-none (the port-less assembly): the row stays honestly
    // unavailable.
    let payload = run_query(
        &database,
        Some(warehouse_with(None)),
        "application.getSnapshot",
        json!({}),
    );
    let rows = payload["value"]["capabilities"]["operations"]
        .as_array()
        .expect("capability rows")
        .clone();
    let row = rows
        .iter()
        .find(|row| row["operationId"] == "dependencies.queries")
        .expect("the dependencies row is served");
    assert_eq!(row["availability"], "unavailable");

    // The implementing adapter's override flips the row (the loop-3 flip
    // precedent).
    let payload = run_query(
        &database,
        Some(warehouse_with(Some(Arc::new(FakeQueries::declaring())))),
        "application.getSnapshot",
        json!({}),
    );
    let rows = payload["value"]["capabilities"]["operations"]
        .as_array()
        .expect("capability rows")
        .clone();
    let row = rows
        .iter()
        .find(|row| row["operationId"] == "dependencies.queries")
        .expect("the dependencies row is served");
    assert_eq!(row["availability"], "available");
    let _ = fs::remove_file(&database);
}

/// The REAL executor over a SYNTHETIC seeded library, through the real
/// frame loop — the assembly-shape proof of the implementation ring (the
/// bin wiring passes `Some(BdlDependencyQueries::new(store))`; this test
/// pins the same composition one layer below the bin). The answer is the
/// executor's own derivation over the seeded rows, schema-validated.
#[test]
fn real_executor_answers_lookup_through_the_real_frame_loop() {
    use vua_orchestrator::BdlDependencyQueries;

    let database = temp_database("real-executor");
    let warehouse = warehouse_with(None);
    // Seed the synthetic library through the store's own v0.2 write faces:
    // one declaring product, one resolution target, one CONFIRMED
    // deliberate-declaration observation.
    let declaring = product_observation("booth:777", ProductObservationStatus::Complete);
    let target = product_observation("booth:888", ProductObservationStatus::Complete);
    warehouse
        .bdl
        .record_product_observation(&declaring)
        .expect("seed declaring product");
    warehouse
        .bdl
        .record_product_observation(&target)
        .expect("seed target product");
    let evidence = DependencyResolutionEvidence {
        link_text: "GateWire".to_owned(),
        link_url: "https://booth.pm/ja/items/888".to_owned(),
        span: "body".to_owned(),
        note: None,
    };
    let row = warehouse
        .bdl
        .record_dependency_observation(&NewDependencyObservation {
            product_id: "booth:777".to_owned(),
            dep_kind: "shader".to_owned(),
            dep_name: "GateWire".to_owned(),
            raw_quote: "requires GateWire".to_owned(),
            source_span: "body".to_owned(),
            version_hint: None,
            resolved_ref_product_id: Some("booth:888".to_owned()),
            resolution_evidence: vec![evidence.clone()],
            extraction_method: "explicit_heading".to_owned(),
            extracted_by: "synthetic-extractor".to_owned(),
            observed_at: "2026-09-22T00:00:00.000Z".to_owned(),
            processor_version: "synthetic-test".to_owned(),
            content_hash: None,
            run_id: None,
        })
        .expect("seed observation");
    warehouse
        .bdl
        .confirm_dependency_resolution(row.observation_id, "booth:888", &[evidence])
        .expect("the explicit human confirmation");

    // The REAL executor (the flip the bin passes) serves the route.
    let queries: Arc<dyn DependenciesQueriesPort> =
        Arc::new(BdlDependencyQueries::new(warehouse.bdl.clone()));
    let payload = run_query(
        &database,
        Some(warehouse_with(Some(queries.clone()))),
        "dependencies.lookup",
        json!({"name": "gatewire"}),
    );
    assert_eq!(payload["ok"], true);
    let envelope = &payload["value"];
    assert_eq!(envelope["schemaVersion"], BDL_QUERIES_SCHEMA_VERSION);
    assert_eq!(envelope["schemaVersion"], "0.6");
    assert_eq!(envelope["operation"], "dependencies.lookup");
    result_validator().validate(envelope).expect("validates the frozen result schema");
    let result = &envelope["result"];
    assert_eq!(result["total"], 1);
    let match_row = &result["matches"][0];
    assert_eq!(match_row["productId"], "booth:777");
    assert_eq!(match_row["resolvedProductId"], "booth:888");
    assert_eq!(match_row["advisory"]["installSource"], "booth_page");
    assert_eq!(match_row["advisory"]["confidence"], "strong");
    assert_eq!(match_row["availabilityStatus"], "available");

    // The unknown productId rides the catalog.detail absence semantics —
    // through the REAL executor's Ok(None).
    let payload = run_query(
        &database,
        Some(warehouse_with(Some(queries.clone()))),
        "dependencies.listByProduct",
        json!({"productId": "booth:404"}),
    );
    assert_eq!(payload["ok"], false);
    assert_eq!(payload["error"]["code"], "vua.catalog.product_not_found");
    let _ = fs::remove_file(&database);
}

fn product_observation(
    product_id: &str,
    status: ProductObservationStatus,
) -> ProductObservation {
    ProductObservation {
        product_id: product_id.to_owned(),
        native_product_id: product_id
            .strip_prefix("booth:")
            .expect("booth:<digits>")
            .to_owned(),
        library_type: None,
        variant_name: None,
        source_url: format!("https://booth.pm/ja/items/{}", &product_id["booth:".len()..]),
        final_url: None,
        status,
        source_locale: None,
        source_category: None,
        title: Some(format!("product {product_id}")),
        description: None,
        age_restriction: None,
        adult: false,
        availability: Some("https://schema.org/InStock".to_owned()),
        price_amount: None,
        price_currency: None,
        shop_name: None,
        shop_url: None,
        image_urls: Vec::new(),
        video_urls: Vec::new(),
        subproducts: Vec::new(),
        source_published_at: None,
        content_hash: format!("sha256:{}", "0".repeat(64)),
        observed_at: "2026-09-22T00:00:00.000Z".to_owned(),
        run_id: None,
        processor_version: "synthetic-test".to_owned(),
        missing_fields: Vec::new(),
    }
}

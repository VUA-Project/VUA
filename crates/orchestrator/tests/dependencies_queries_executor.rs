//! The real `BdlDependencyQueries` executor's behavior matrix over a
//! SYNTHETIC in-memory BDL library (the operator batch-174 dispatch:
//! matching rule v1 / honest empty set / confirmed-vs-unconfirmed gates /
//! advisory double gate / installSource derivation / the clues-not-
//! conclusions two-face contrast). Code-face evidence only — zero
//! end-to-end claims; every row is seeded through the store's own v0.2
//! write face (the same laws the production extractor and the explicit
//! human-confirmation write action go through).

use std::sync::Arc;

use vua_bdl_store::{
    BdlStore, DependencyResolutionEvidence, NewDependencyObservation, ProductObservation,
    ProductObservationStatus,
};
use vua_orchestrator::{
    BdlDependencyQueries, DependenciesLookupParams, DependenciesQueriesPort, AdvisoryConfidence,
    DependencyKind, DependencyProductStatus, InstallSource,
};

// --- synthetic library seeding (the store's own write faces) ---

fn product(
    product_id: &str,
    status: ProductObservationStatus,
    title: Option<&str>,
    availability: Option<&str>,
    source_url: &str,
) -> ProductObservation {
    ProductObservation {
        product_id: product_id.to_owned(),
        native_product_id: product_id
            .strip_prefix("booth:")
            .expect("booth:<digits> identity")
            .to_owned(),
        library_type: None,
        variant_name: None,
        source_url: source_url.to_owned(),
        final_url: None,
        status,
        source_locale: None,
        source_category: None,
        title: title.map(str::to_owned),
        description: None,
        age_restriction: None,
        adult: false,
        availability: availability.map(str::to_owned),
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

fn evidence(link_text: &str, link_url: &str) -> DependencyResolutionEvidence {
    DependencyResolutionEvidence {
        link_text: link_text.to_owned(),
        link_url: link_url.to_owned(),
        span: "body".to_owned(),
        note: None,
    }
}

#[allow(clippy::too_many_arguments)]
fn observation(
    product_id: &str,
    dep_kind: &str,
    dep_name: &str,
    extraction_method: &str,
    source_span: &str,
    resolved: Option<&str>,
    evidence: Vec<DependencyResolutionEvidence>,
) -> NewDependencyObservation {
    NewDependencyObservation {
        product_id: product_id.to_owned(),
        dep_kind: dep_kind.to_owned(),
        dep_name: dep_name.to_owned(),
        raw_quote: format!("This avatar requires {dep_name}."),
        source_span: source_span.to_owned(),
        version_hint: None,
        resolved_ref_product_id: resolved.map(str::to_owned),
        resolution_evidence: evidence,
        extraction_method: extraction_method.to_owned(),
        extracted_by: "synthetic-extractor".to_owned(),
        observed_at: "2026-09-22T00:00:00.000Z".to_owned(),
        processor_version: "synthetic-test".to_owned(),
        content_hash: None,
        run_id: None,
    }
}

fn executor(store: &Arc<BdlStore>) -> BdlDependencyQueries {
    BdlDependencyQueries::new(store.clone())
}

fn lookup_params(name: &str) -> DependenciesLookupParams {
    DependenciesLookupParams {
        name: name.to_owned(),
        dep_kind: None,
        limit: 50,
        offset: 0,
    }
}

// --- the matrix ---

#[test]
fn capability_accessor_flips_with_the_implementation() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    let queries = executor(&store);
    let capabilities = queries.dependencies_capabilities();
    assert!(capabilities.dependencies_queries);
}

#[test]
fn empty_library_is_the_honest_empty_set() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    let queries = executor(&store);
    let result = queries
        .dependencies_lookup(&lookup_params("lilToon"))
        .expect("the empty set is a success fact");
    assert_eq!(result.total, 0);
    assert!(result.matches.is_empty());
}

#[test]
fn matching_rule_v1_casefold_exact_no_fuzzy_honest_empty() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    store
        .record_product_observation(&product(
            "booth:111",
            ProductObservationStatus::Complete,
            Some("Lil Texture"),
            Some("https://schema.org/InStock"),
            "https://booth.pm/ja/items/111",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:222",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/222",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:333",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/333",
        ))
        .expect("seed product");
    store
        .record_dependency_observation(&observation(
            "booth:111", "shader", "lilToon", "explicit_heading", "body", None, vec![],
        ))
        .expect("seed observation");
    store
        .record_dependency_observation(&observation(
            "booth:222", "shader", "LILTOON", "prose", "body", None, vec![],
        ))
        .expect("seed observation");
    store
        .record_dependency_observation(&observation(
            "booth:333", "shader", "lilToonShader", "prose", "body", None, vec![],
        ))
        .expect("seed observation — a DIFFERENT nominal, never a substring hit");

    let queries = executor(&store);
    let result = queries
        .dependencies_lookup(&lookup_params("liltoon"))
        .expect("lookup succeeds");
    assert_eq!(result.total, 2, "ASCII case-fold exact over dep_name");
    assert_eq!(result.matches[0].product_id, "booth:111", "productId ascending");
    assert_eq!(result.matches[1].product_id, "booth:222");
    // The stored nominal is never rewritten (matching is not normalization).
    assert_eq!(result.matches[0].dep_name, "lilToon");
    assert_eq!(result.matches[1].dep_name, "LILTOON");

    // The reverse fold matches identically.
    let upper = queries
        .dependencies_lookup(&lookup_params("LILTOON"))
        .expect("lookup succeeds");
    assert_eq!(upper.total, 2);

    // No substring: the different nominal never matches.
    let substring = queries
        .dependencies_lookup(&lookup_params("iltoon"))
        .expect("lookup succeeds");
    assert_eq!(substring.total, 0);
    assert!(substring.matches.is_empty());

    // The package-form input is not literally present: the HONEST EMPTY
    // SET, never a guessed equivalence.
    let package_form = queries
        .dependencies_lookup(&lookup_params("com.lilxyzw.liltoon"))
        .expect("lookup succeeds");
    assert_eq!(package_form.total, 0);
    assert!(package_form.matches.is_empty());

    // The dual-field law rides the declaring product's row whole.
    assert_eq!(
        result.matches[0].availability_raw.as_deref(),
        Some("https://schema.org/InStock")
    );
    assert_eq!(
        result.matches[1].availability_raw.as_deref(),
        None,
        "absent raw = honest absence"
    );

    // Deterministic pagination: total computed BEFORE the window.
    let window = queries
        .dependencies_lookup(&DependenciesLookupParams {
            name: "liltoon".to_owned(),
            dep_kind: None,
            limit: 1,
            offset: 1,
        })
        .expect("lookup succeeds");
    assert_eq!(window.total, 2);
    assert_eq!(window.matches.len(), 1);
    assert_eq!(window.matches[0].product_id, "booth:222");
}

#[test]
fn dep_kind_filter_rides_the_frozen_closed_set() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    store
        .record_product_observation(&product(
            "booth:111",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/111",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:222",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/222",
        ))
        .expect("seed product");
    store
        .record_dependency_observation(&observation(
            "booth:111", "shader", "lilToon", "explicit_heading", "body", None, vec![],
        ))
        .expect("seed observation");
    store
        .record_dependency_observation(&observation(
            "booth:222", "tool_package", "lilToon", "explicit_heading", "body", None, vec![],
        ))
        .expect("seed observation");
    let queries = executor(&store);
    let unfiltered = queries
        .dependencies_lookup(&lookup_params("liltoon"))
        .expect("lookup succeeds");
    assert_eq!(unfiltered.total, 2);
    let filtered = queries
        .dependencies_lookup(&DependenciesLookupParams {
            name: "liltoon".to_owned(),
            dep_kind: Some(DependencyKind::ToolPackage),
            limit: 50,
            offset: 0,
        })
        .expect("lookup succeeds");
    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.matches[0].product_id, "booth:222");
}

#[test]
fn resolved_product_id_surfaces_only_for_confirmed_resolutions() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    for id in ["111", "222", "333", "999"] {
        store
            .record_product_observation(&product(
                &format!("booth:{id}"),
                ProductObservationStatus::Complete,
                None,
                None,
                &format!("https://booth.pm/ja/items/{id}"),
            ))
            .expect("seed product");
    }
    // Confirmed resolution.
    let confirmed = store
        .record_dependency_observation(&observation(
            "booth:111",
            "shader",
            "UnivSF",
            "explicit_heading",
            "body",
            Some("booth:999"),
            vec![evidence("UnivSF", "https://booth.pm/ja/items/999")],
        ))
        .expect("seed observation");
    store
        .confirm_dependency_resolution(
            confirmed.observation_id,
            "booth:999",
            &[evidence("UnivSF", "https://booth.pm/ja/items/999")],
        )
        .expect("the explicit human confirmation");
    // An UNCONFIRMED resolution (the clue form).
    store
        .record_dependency_observation(&observation(
            "booth:222",
            "shader",
            "univsf",
            "explicit_heading",
            "body",
            Some("booth:999"),
            vec![evidence("UnivSF", "https://booth.pm/ja/items/999")],
        ))
        .expect("seed observation — lands unconfirmed by design");
    // No resolution at all.
    store
        .record_dependency_observation(&observation(
            "booth:333",
            "shader",
            "UNIVSF",
            "explicit_heading",
            "body",
            None,
            vec![],
        ))
        .expect("seed observation");

    let queries = executor(&store);
    let result = queries
        .dependencies_lookup(&lookup_params("univsf"))
        .expect("lookup succeeds");
    assert_eq!(result.total, 3);
    let by_product: Vec<(&str, Option<&str>, bool)> = result
        .matches
        .iter()
        .map(|match_row| {
            (
                match_row.product_id.as_str(),
                match_row.resolved_product_id.as_deref(),
                match_row.advisory.is_some(),
            )
        })
        .collect();
    assert_eq!(
        by_product,
        vec![
            ("booth:111", Some("booth:999"), true),
            ("booth:222", None, false),
            ("booth:333", None, false),
        ],
        "null = no resolution OR an unconfirmed one — no distinction revealed; \
         only the confirmed row turns into a suggestion"
    );
    let confirmed_match = &result.matches[0];
    let advisory = confirmed_match.advisory.as_ref().expect("confirmed + deliberate");
    assert_eq!(advisory.install_source, InstallSource::BoothPage);
    assert_eq!(advisory.confidence, AdvisoryConfidence::Strong);
}

#[test]
fn advisory_double_gate_layout_dimension() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    store
        .record_product_observation(&product(
            "booth:111",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/111",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:999",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/999",
        ))
        .expect("seed product");
    // All six layouts land CONFIRMED — the layout gate alone decides.
    for extraction in [
        "explicit_heading",
        "one_line",
        "bullet",
        "prose",
        "title",
        "link",
    ] {
        let row = store
            .record_dependency_observation(&observation(
                "booth:111",
                "shader",
                "GateDep",
                extraction,
                "body",
                Some("booth:999"),
                vec![evidence("GateDep", "https://booth.pm/ja/items/999")],
            ))
            .expect("seed observation");
        store
            .confirm_dependency_resolution(
                row.observation_id,
                "booth:999",
                &[evidence("GateDep", "https://booth.pm/ja/items/999")],
            )
            .expect("confirmation");
    }
    let queries = executor(&store);
    let result = queries
        .dependencies_lookup(&lookup_params("gatedep"))
        .expect("lookup succeeds");
    assert_eq!(result.total, 6, "all six rows match; the ADVISORY gate filters");
    let expected: [Option<(&str, AdvisoryConfidence)>; 6] = [
        Some(("booth_page", AdvisoryConfidence::Strong)),   // explicit_heading
        Some(("booth_page", AdvisoryConfidence::Strong)),   // one_line
        Some(("booth_page", AdvisoryConfidence::Weak)),     // bullet
        None,                                               // prose
        None,                                               // title
        None,                                               // link
    ];
    for (match_row, expected) in result.matches.iter().zip(expected.iter()) {
        let actual = match_row.advisory.as_ref().map(|advisory| {
            let word = match advisory.install_source {
                InstallSource::BoothPage => "booth_page",
                InstallSource::ExternalPage => "external_page",
                _ => "<forbidden>",
            };
            (word, advisory.confidence)
        });
        assert_eq!(actual.as_ref(), expected.as_ref(), "layout {:?}", match_row.extraction_method);
    }
}

#[test]
fn install_source_derives_from_the_resolution_targets_host() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    store
        .record_product_observation(&product(
            "booth:111",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/111",
        ))
        .expect("seed product");
    // Resolution targets with three different hosts.
    store
        .record_product_observation(&product(
            "booth:801",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/801",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:802",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://gumroad.example.com/l/802",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:803",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://shop.booth.pm/items/803",
        ))
        .expect("seed product");
    for (target, _) in [("booth:801", InstallSource::BoothPage), ("booth:802", InstallSource::ExternalPage), ("booth:803", InstallSource::BoothPage)] {
        let row = store
            .record_dependency_observation(&observation(
                "booth:111",
                "shader",
                "HostDep",
                "explicit_heading",
                "body",
                Some(target),
                vec![evidence("HostDep", "https://booth.pm/ja/items/x")],
            ))
            .expect("seed observation");
        store
            .confirm_dependency_resolution(
                row.observation_id,
                target,
                &[evidence("HostDep", "https://booth.pm/ja/items/x")],
            )
            .expect("confirmation");
    }
    let queries = executor(&store);
    let result = queries
        .dependencies_lookup(&lookup_params("hostdep"))
        .expect("lookup succeeds");
    assert_eq!(result.total, 3);
    let sources: Vec<InstallSource> = result
        .matches
        .iter()
        .map(|match_row| {
            match_row
                .advisory
                .as_ref()
                .expect("confirmed + deliberate")
                .install_source
        })
        .collect();
    assert_eq!(
        sources,
        vec![
            InstallSource::BoothPage,     // booth.pm
            InstallSource::ExternalPage,  // any other host
            InstallSource::BoothPage,     // a booth.pm subdomain
        ]
    );
    // v1 never emits vpm/unknown — the closed set's other members stay
    // unspoken (asserted by construction: every emitted source is one of
    // the two legal words).
}

#[test]
fn list_by_product_is_the_unfiltered_clue_face() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    store
        .record_product_observation(&product(
            "booth:555",
            ProductObservationStatus::Complete,
            Some("Clue Source"),
            None,
            "https://booth.pm/ja/items/555",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:999",
            ProductObservationStatus::Complete,
            None,
            None,
            "https://booth.pm/ja/items/999",
        ))
        .expect("seed product");
    // Insertion order 1: unresolved.
    store
        .record_dependency_observation(&observation(
            "booth:555", "shader", "DepA", "bullet", "body", None, vec![],
        ))
        .expect("seed observation");
    // Insertion order 2: resolved UNCONFIRMED — the labeled clue.
    store
        .record_dependency_observation(&observation(
            "booth:555",
            "shader",
            "DepB",
            "explicit_heading",
            "body",
            Some("booth:999"),
            vec![evidence("Dependency B", "https://booth.pm/ja/items/999")],
        ))
        .expect("seed observation");
    // Insertion order 3: resolved CONFIRMED.
    let confirmed = store
        .record_dependency_observation(&observation(
            "booth:555",
            "shader",
            "DepC",
            "one_line",
            "body",
            Some("booth:999"),
            vec![evidence("Dependency C", "https://booth.pm/ja/items/999")],
        ))
        .expect("seed observation");
    store
        .confirm_dependency_resolution(
            confirmed.observation_id,
            "booth:999",
            &[evidence("Dependency C", "https://booth.pm/ja/items/999")],
        )
        .expect("confirmation");

    let queries = executor(&store);
    let unknown = queries
        .dependencies_list_by_product("booth:404")
        .expect("read succeeds");
    assert!(unknown.is_none(), "unknown productId = the not-found fact");

    let result = queries
        .dependencies_list_by_product("booth:555")
        .expect("read succeeds")
        .expect("the product is known");
    assert_eq!(result.product_id, "booth:555");
    assert_eq!(result.observations.len(), 3, "every clue is listed");
    let confirmed_flags: Vec<Option<bool>> = result
        .observations
        .iter()
        .map(|row| row.resolution.as_ref().map(|resolution| resolution.confirmed))
        .collect();
    assert_eq!(
        confirmed_flags,
        vec![None, Some(false), Some(true)],
        "insertion order; unconfirmed clues labeled as-is, never flipped"
    );
    let clue = &result.observations[1];
    let resolution = clue.resolution.as_ref().expect("the clue carries its resolution");
    assert_eq!(resolution.product_id, "booth:999");
    assert_eq!(resolution.evidence.len(), 1);
    assert_eq!(resolution.evidence[0].link_text, "Dependency B");
    assert_eq!(resolution.evidence[0].link_url, "https://booth.pm/ja/items/999");
    assert_eq!(clue.extracted_by, "synthetic-extractor");
    assert_eq!(clue.observed_at, "2026-09-22T00:00:00.000Z");
}

#[test]
fn tombstoned_declaring_products_stay_readable_on_both_faces() {
    let store = Arc::new(BdlStore::open_in_memory().expect("in-memory library"));
    store
        .record_product_observation(&product(
            "booth:666",
            ProductObservationStatus::Missing,
            Some("Dead Page"),
            None,
            "https://booth.pm/ja/items/666",
        ))
        .expect("seed tombstone");
    store
        .record_dependency_observation(&observation(
            "booth:666", "shader", "GhostDep", "explicit_heading", "body", None, vec![],
        ))
        .expect("seed observation");
    let queries = executor(&store);
    // Lookup does NOT filter on the declaring product's tombstone state.
    let lookup = queries
        .dependencies_lookup(&lookup_params("ghostdep"))
        .expect("lookup succeeds");
    assert_eq!(lookup.total, 1, "a declaration's evidentiary force does not die with its page");
    assert_eq!(lookup.matches[0].product_id, "booth:666");
    // listByProduct answers the tombstone honesty face.
    let result = queries
        .dependencies_list_by_product("booth:666")
        .expect("read succeeds")
        .expect("a tombstoned product is NOT refused");
    assert_eq!(result.product_status, DependencyProductStatus::Missing);
    assert_eq!(result.observations.len(), 1, "the dead page's declarations stay readable");
}

/// The status residual arm's premise, pinned: `productStatus` folds the
/// residual case into `complete` BECAUSE the stored closed set is
/// database-enforced — the EXECUTABLE migration chain carries
/// `CHECK (status IN ('complete','missing'))` on the products DDL
/// (schemas/bdl/v0.1/001_initial.sql; fresh databases are born from
/// 001+002). The v0.2 restatement (schemas/bdl/v0.2/schema.sql) shows the
/// closed set as a comment only, so this pin holds the executable CHECK
/// against silent loss in a future table rebuild (the 002
/// compatibility_observations CHECK rebuild is the precedent that rebuilds
/// can drop constraints) and pins both legal words mapping verbatim
/// through the executor.
#[test]
fn product_status_maps_both_legal_words_and_the_closed_set_is_database_enforced() {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let db_path = std::env::temp_dir().join(format!(
        "vua-deps-queries-status-law-{}-{nanos}.bdl",
        std::process::id()
    ));
    // A FILE-backed library: the enforcement check below needs a second
    // raw SQLite connection attempting the corruption shape the store's
    // own enum-gated write face can never produce.
    let store = Arc::new(BdlStore::open(&db_path).expect("file-backed library"));
    store
        .record_product_observation(&product(
            "booth:424242",
            ProductObservationStatus::Complete,
            Some("Alive Page"),
            None,
            "https://booth.pm/items/424242",
        ))
        .expect("seed product");
    store
        .record_product_observation(&product(
            "booth:424243",
            ProductObservationStatus::Missing,
            None,
            None,
            "https://booth.pm/items/424243",
        ))
        .expect("seed tombstone");
    let queries = executor(&store);
    let complete = queries
        .dependencies_list_by_product("booth:424242")
        .expect("read succeeds")
        .expect("the product exists");
    assert_eq!(complete.product_status, DependencyProductStatus::Complete);
    let missing = queries
        .dependencies_list_by_product("booth:424243")
        .expect("read succeeds")
        .expect("the tombstoned product exists");
    assert_eq!(missing.product_status, DependencyProductStatus::Missing);

    // The stored closed set is database-enforced: a foreign status word is
    // REFUSED at rest (a corrupting second connection cannot plant it), so
    // the executor's residual arm stays unreachable for foreign words and
    // the folded `complete` can never fire on a non-`complete` row.
    let tamper = rusqlite::Connection::open(&db_path).expect("second connection opens");
    let refused = tamper.execute(
        "UPDATE products SET status = 'archived' WHERE product_id = 'booth:424242'",
        [],
    );
    match refused {
        Err(error) => assert!(
            error.to_string().contains("CHECK constraint failed"),
            "the refusal must be the status CHECK itself, got: {error}"
        ),
        Ok(updated) => panic!(
            "a foreign status word must be refused by the executable CHECK, \
             not applied ({updated} rows) — the residual arm's premise is gone"
        ),
    }
}

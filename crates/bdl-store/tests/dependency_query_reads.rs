//! The v0.5 dependencies.* read-face support reads over the store:
//! `dependency_observations_all` (the whole-library reverse-lookup scan
//! face) and `dependency_product_row` (the declaring/resolution product
//! facts, any status — the observation read face, not the catalog card
//! face). Synthetic rows only; seeded through the store's own v0.2 write
//! faces.

use vua_bdl_store::{
    BdlStore, DependencyResolutionEvidence, NewDependencyObservation, ProductObservation,
    ProductObservationStatus,
};

fn product(product_id: &str, status: ProductObservationStatus) -> ProductObservation {
    ProductObservation {
        product_id: product_id.to_owned(),
        native_product_id: product_id
            .strip_prefix("booth:")
            .expect("booth:<digits> identity")
            .to_owned(),
        library_type: None,
        variant_name: None,
        source_url: format!("https://booth.pm/ja/items/{}", product_id.trim_start_matches("booth:")),
        final_url: None,
        status,
        source_locale: None,
        source_category: None,
        title: Some(format!("title of {product_id}")),
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

fn observation(product_id: &str, dep_name: &str) -> NewDependencyObservation {
    NewDependencyObservation {
        product_id: product_id.to_owned(),
        dep_kind: "shader".to_owned(),
        dep_name: dep_name.to_owned(),
        raw_quote: format!("requires {dep_name}"),
        source_span: "body".to_owned(),
        version_hint: None,
        resolved_ref_product_id: None,
        resolution_evidence: Vec::<DependencyResolutionEvidence>::new(),
        extraction_method: "explicit_heading".to_owned(),
        extracted_by: "synthetic-extractor".to_owned(),
        observed_at: "2026-09-22T00:00:00.000Z".to_owned(),
        processor_version: "synthetic-test".to_owned(),
        content_hash: None,
        run_id: None,
    }
}

#[test]
fn whole_library_scan_returns_insertion_order_across_products() {
    let store = BdlStore::open_in_memory().expect("in-memory library");
    store
        .record_product_observation(&product("booth:222", ProductObservationStatus::Complete))
        .expect("seed");
    store
        .record_product_observation(&product("booth:111", ProductObservationStatus::Complete))
        .expect("seed");
    store
        .record_dependency_observation(&observation("booth:222", "First"))
        .expect("seed");
    store
        .record_dependency_observation(&observation("booth:111", "Second"))
        .expect("seed");
    store
        .record_dependency_observation(&observation("booth:222", "Third"))
        .expect("seed");
    let rows = store.dependency_observations_all().expect("read");
    let names: Vec<&str> = rows.iter().map(|row| row.dep_name.as_str()).collect();
    assert_eq!(
        names,
        vec!["First", "Second", "Third"],
        "observation-identity order across products, NOT product order"
    );
    let empty = BdlStore::open_in_memory().expect("in-memory library");
    assert!(empty
        .dependency_observations_all()
        .expect("read")
        .is_empty(), "empty library = the honest empty set");
}

#[test]
fn product_row_serves_any_status_and_none_for_unknown() {
    let store = BdlStore::open_in_memory().expect("in-memory library");
    store
        .record_product_observation(&product("booth:111", ProductObservationStatus::Complete))
        .expect("seed");
    store
        .record_product_observation(&product("booth:666", ProductObservationStatus::Missing))
        .expect("seed tombstone");
    let complete = store
        .dependency_product_row("booth:111")
        .expect("read")
        .expect("known");
    assert_eq!(complete.status, "complete");
    assert_eq!(complete.title.as_deref(), Some("title of booth:111"));
    assert_eq!(complete.availability.as_deref(), Some("https://schema.org/InStock"));
    assert_eq!(complete.source_url.as_deref(), Some("https://booth.pm/ja/items/111"));
    let tombstone = store
        .dependency_product_row("booth:666")
        .expect("read")
        .expect("a tombstoned product is a row, never a deletion");
    assert_eq!(tombstone.status, "missing");
    assert!(store.dependency_product_row("booth:404").expect("read").is_none());
}

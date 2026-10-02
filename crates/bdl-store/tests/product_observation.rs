//! W17 observation write side — consumer tests for the products-table write
//! face (`record_product_observation`) and the catalog assembly that now
//! consumes the observed columns.
//!
//! Semantics under test (docs/architecture/bdl.md, write-face section):
//! - upsert of the latest observed facts + the `catalog_updated_seq`
//!   bookkeeping counter in the same transaction (status turns `ok` with
//!   the first write);
//! - tombstones (`missing`) are kept rows that the catalog never serves as
//!   cards, and only a newer observation can change a row (no delete);
//! - the availability filter matches the derived stable enum (v0.2 rule
//!   table), never the raw word;
//! - write-face closed sets: corpus identity, the price-pair rule, required
//!   evidence fields.

use vua_bdl_store::{
    BdlStore, CatalogHealth, CatalogListParams, ProductObservation, ProductObservationStatus,
    SubproductObservation,
};

const HASH_A: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const HASH_B: &str = "sha256:2222222222222222222222222222222222222222222222222222222222222222";

fn observation(native_id: &str) -> ProductObservation {
    ProductObservation {
        product_id: format!("booth:{native_id}"),
        native_product_id: native_id.to_owned(),
        library_type: None,
        source_url: format!("https://booth.pm/ja/items/{native_id}"),
        final_url: None,
        status: ProductObservationStatus::Complete,
        source_locale: Some("ja".into()),
        source_category: Some("コスプレ".into()),
        title: Some(format!("Uniform {native_id}")),
        description: Some("A test outfit.".into()),
        age_restriction: None,
        adult: false,
        availability: Some("https://schema.org/InStock".into()),
        price_amount: Some("1500".into()),
        price_currency: Some("JPY".into()),
        shop_name: Some("TestShop".into()),
        shop_url: Some("https://testshop.booth.pm/".into()),
        image_urls: vec!["https://example.com/a.png".into(), "https://example.com/b.png".into()],
        video_urls: Vec::new(),
        subproducts: Vec::new(),
        source_published_at: None,
        content_hash: HASH_A.into(),
        observed_at: "2026-09-08T00:00:00.000Z".into(),
        run_id: Some("run-1".into()),
        processor_version: "obs-0.1".into(),
        missing_fields: Vec::new(),
    }
}

#[test]
fn observed_presentation_flows_to_the_card_and_detail() {
    let store = BdlStore::open_in_memory().unwrap();
    let mut observed = observation("101");
    observed.adult = true;
    observed.age_restriction = Some("R-18".into());
    observed.final_url = Some("https://testshop.booth.pm/items/101".into());
    observed.missing_fields = vec!["description_section".into()];
    observed.subproducts.push(SubproductObservation {
        variation_id: Some("v1".into()),
        name: Some("Black".into()),
        price_amount: Some("1800".into()),
        price_currency: Some("JPY".into()),
        availability: Some("SoldOut".into()),
    });
    store.record_product_observation(&observed).unwrap();

    let list = store
        .catalog_list(&CatalogListParams::default())
        .unwrap();
    assert_eq!(list.total, 1);
    let card = &list.entries[0];
    assert_eq!(card.product_id, "booth:101");
    assert_eq!(card.title.as_deref(), Some("Uniform 101"));
    let price = card.price.as_ref().unwrap();
    assert_eq!((price.amount.as_str(), price.currency.as_str()), ("1500", "JPY"));
    // imageUrl is exactly imageUrls[0], and the raw word rides along.
    assert_eq!(card.image_url.as_deref(), Some("https://example.com/a.png"));
    assert_eq!(card.image_urls.len(), 2);
    assert_eq!(
        card.availability_raw.as_deref(),
        Some("https://schema.org/InStock")
    );
    assert_eq!(card.availability_status, vua_bdl_store::AvailabilityStatus::Available);

    let detail = store.catalog_detail("booth:101").unwrap().unwrap().product;
    assert!(detail.adult);
    assert_eq!(detail.age_restriction.as_deref(), Some("R-18"));
    assert_eq!(detail.description.as_deref(), Some("A test outfit."));
    assert_eq!(detail.shop_name.as_deref(), Some("TestShop"));
    assert_eq!(detail.source_category.as_deref(), Some("コスプレ"));
    assert_eq!(detail.subproducts.len(), 1);
    let subproduct = &detail.subproducts[0];
    assert_eq!(subproduct.name.as_deref(), Some("Black"));
    assert_eq!(
        subproduct.availability_status,
        vua_bdl_store::AvailabilityStatus::Unavailable
    );
}

#[test]
fn status_turns_ok_with_the_first_write_and_the_revision_travels() {
    let store = BdlStore::open_in_memory().unwrap();
    let before = store.catalog_status().unwrap();
    assert_eq!(before.health, CatalogHealth::Unknown);
    assert_eq!(before.revision.catalog_updated_seq, None);

    assert_eq!(store.record_product_observation(&observation("201")).unwrap(), 1);
    assert_eq!(store.record_product_observation(&observation("202")).unwrap(), 2);

    let after = store.catalog_status().unwrap();
    assert_eq!(after.health, CatalogHealth::Ok);
    assert_eq!(after.revision.catalog_updated_seq, Some(2));
}

#[test]
fn tombstones_are_kept_never_cards_and_can_recover() {
    let store = BdlStore::open_in_memory().unwrap();
    let mut gone = observation("301");
    gone.status = ProductObservationStatus::Missing;
    gone.title = None;
    gone.price_amount = None;
    gone.price_currency = None;
    store.record_product_observation(&gone).unwrap();

    let list = store.catalog_list(&CatalogListParams::default()).unwrap();
    assert_eq!(list.total, 0);
    assert!(store.catalog_detail("booth:301").unwrap().is_none());

    // A later observation finds the page back up: the same row turns into a
    // card again (upsert is the only way a row changes; nothing deletes).
    let mut back = observation("301");
    back.content_hash = HASH_B.into();
    store.record_product_observation(&back).unwrap();
    let recovered = store.catalog_list(&CatalogListParams::default()).unwrap();
    assert_eq!(recovered.total, 1);
    assert_eq!(recovered.entries[0].product_id, "booth:301");
}

#[test]
fn availability_filter_matches_the_derived_enum_not_the_raw_word() {
    let store = BdlStore::open_in_memory().unwrap();
    let mut in_stock = observation("401");
    in_stock.availability = Some("https://schema.org/InStock".into());
    let mut sold_out = observation("402");
    sold_out.availability = Some("https://schema.org/SoldOut".into());
    let mut mystery = observation("403");
    mystery.availability = Some("PreOrder".into());
    let mut unworded = observation("404");
    unworded.availability = None;
    for observed in [&in_stock, &sold_out, &mystery, &unworded] {
        store.record_product_observation(observed).unwrap();
    }

    let derived = |expected: Option<vua_bdl_store::AvailabilityStatus>| {
        let params = CatalogListParams {
            availability_status: expected,
            ..CatalogListParams::default()
        };
        let result = store.catalog_list(&params).unwrap();
        (result.total, result.entries.len())
    };
    use vua_bdl_store::AvailabilityStatus::*;
    assert_eq!(derived(Some(Available)), (1, 1));
    assert_eq!(derived(Some(Unavailable)), (1, 1));
    // The unrecognized word and the absence both derive to unknown.
    assert_eq!(derived(Some(Unknown)), (2, 2));
    assert_eq!(derived(None), (4, 4));
}

#[test]
fn text_filter_matches_title_and_product_id_case_insensitively() {
    let store = BdlStore::open_in_memory().unwrap();
    let mut uniform = observation("501");
    uniform.title = Some("Sailor Uniform Set".into());
    let mut other = observation("502");
    other.title = Some("Plain Dress".into());
    store.record_product_observation(&uniform).unwrap();
    store.record_product_observation(&other).unwrap();

    let by_title = store
        .catalog_list(&CatalogListParams { text: Some("UNIFORM".into()), ..Default::default() })
        .unwrap();
    assert_eq!(by_title.total, 1);
    assert_eq!(by_title.entries[0].product_id, "booth:501");

    let by_id = store
        .catalog_list(&CatalogListParams { text: Some("booth:502".into()), ..Default::default() })
        .unwrap();
    assert_eq!(by_id.total, 1);
    assert_eq!(by_id.entries[0].product_id, "booth:502");

    let nothing = store
        .catalog_list(&CatalogListParams { text: Some("wig".into()), ..Default::default() })
        .unwrap();
    assert_eq!(nothing.total, 0);
}

#[test]
fn pagination_slices_after_filtering_with_the_honest_total() {
    let store = BdlStore::open_in_memory().unwrap();
    for id in ["601", "602", "603"] {
        store.record_product_observation(&observation(id)).unwrap();
    }
    let params = CatalogListParams { limit: 2, offset: 1, ..Default::default() };
    let page = store.catalog_list(&params).unwrap();
    assert_eq!(page.total, 3);
    assert_eq!(page.entries.len(), 2);
    assert_eq!(page.entries[0].product_id, "booth:602");
    assert_eq!(page.entries[1].product_id, "booth:603");
}

#[test]
fn reobservation_overwrites_the_facts_and_bumps_the_counter() {
    let store = BdlStore::open_in_memory().unwrap();
    store.record_product_observation(&observation("701")).unwrap();
    let mut fresh = observation("701");
    fresh.content_hash = HASH_B.into();
    fresh.title = Some("Renamed 701".into());
    fresh.availability = Some("https://schema.org/OutOfStock".into());
    fresh.price_amount = None;
    fresh.price_currency = None;
    let seq = store.record_product_observation(&fresh).unwrap();
    assert_eq!(seq, 2);

    let card = &store
        .catalog_list(&CatalogListParams::default())
        .unwrap()
        .entries[0];
    assert_eq!(card.title.as_deref(), Some("Renamed 701"));
    assert!(card.price.is_none());
    assert_eq!(
        card.availability_status,
        vua_bdl_store::AvailabilityStatus::Unavailable
    );
    // Only one row exists — the upsert never duplicates.
    assert_eq!(
        store.catalog_list(&CatalogListParams::default()).unwrap().total,
        1
    );
}

#[test]
fn seed_rows_still_answer_the_honest_empty_shapes() {
    let store = BdlStore::open_in_memory().unwrap();
    store.seed_product("booth:801", "801").unwrap();
    let card = &store
        .catalog_list(&CatalogListParams::default())
        .unwrap()
        .entries[0];
    // Pre-write-face rows (NULL presentation columns) assemble the honest
    // empty shapes — no guessing, no fabrication.
    assert!(card.title.is_none());
    assert!(card.price.is_none());
    assert!(card.image_url.is_none());
    assert_eq!(card.availability_status, vua_bdl_store::AvailabilityStatus::Unknown);
}

#[test]
fn the_write_face_rejects_out_of_closed_set_observations() {
    let store = BdlStore::open_in_memory().unwrap();

    // Identity: the corpus id must be booth:<native digits> and agree.
    let mut mismatched = observation("901");
    mismatched.product_id = "booth:902".into();
    assert!(matches!(
        store.record_product_observation(&mismatched),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));
    let mut non_numeric = observation("abc");
    non_numeric.product_id = "booth:abc".into();
    assert!(matches!(
        store.record_product_observation(&non_numeric),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));

    // Content hash must be content-addressed evidence (sha256:<64 hex>).
    let mut hashless = observation("903");
    hashless.content_hash = "deadbeef".into();
    assert!(matches!(
        store.record_product_observation(&hashless),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));

    // Required evidence fields.
    let mut timeless = observation("904");
    timeless.observed_at = "  ".into();
    assert!(matches!(
        store.record_product_observation(&timeless),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));
    let mut unversioned = observation("905");
    unversioned.processor_version = String::new();
    assert!(matches!(
        store.record_product_observation(&unversioned),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));
    let mut unsource = observation("906");
    unsource.source_url = String::new();
    assert!(matches!(
        store.record_product_observation(&unsource),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));

    // The price-pair rule: amount and currency together or not at all.
    let mut half_priced = observation("907");
    half_priced.price_currency = None;
    assert!(matches!(
        store.record_product_observation(&half_priced),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));
    let mut half_sub = observation("908");
    half_sub.subproducts.push(SubproductObservation {
        variation_id: None,
        name: None,
        price_amount: Some("100".into()),
        price_currency: None,
        availability: None,
    });
    assert!(matches!(
        store.record_product_observation(&half_sub),
        Err(vua_bdl_store::BdlStoreError::InvalidObservation(_))
    ));

    // Nothing was written, and the catalog stays the honest empty state.
    assert_eq!(
        store.catalog_list(&CatalogListParams::default()).unwrap().total,
        0
    );
    assert_eq!(store.catalog_status().unwrap().health, CatalogHealth::Unknown);
}

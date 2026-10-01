//! Account-library listing-page extraction (catalog-sync v0.1 producer).
//!
//! A pure, read-only function of one archived BOOTH listing page. The card
//! grammar was verified read-only against the public site (2026-10-02):
//! cards are `li.item-card` carrying `data-product-id` / `data-product-name`
//! / `data-product-brand` / `data-product-category` / `data-product-price`,
//! thumbnails sit under `.item-card__thumbnail`, and pagination exposes
//! `a[rel="next"]` inside `.pager`. The signed-in library page is not
//! reachable without an account and remains pending real-run verification;
//! the in-repo fixtures model the verified public grammar.
//!
//! Honesty rules carried from the observation write face: a listing carries
//! no price *currency* (so the price pair is omitted entirely — amount and
//! currency are admitted together or not at all), no Adult badge, no
//! JSON-LD availability, and a brand slug is a shop id, not a display
//! name. All of these land as `missing_fields`, never guesses; the full
//! product-page observation refines them when a detail page is synced.

use std::fmt;

use scraper::{Html, Selector};
use vua_bdl_store::bdl_store::{ProductObservation, ProductObservationStatus};

/// Stamped into every observation this producer writes; the write face
/// requires a processor version as evidence.
pub const LIBRARY_PAGE_PROCESSOR_VERSION: &str = "catalog-sync/0.1";

/// Structural failures only: the page is not a listing page at all.
/// Missing per-item fields are findings, not errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LibraryPageError {
    NotALibraryPage,
}

impl fmt::Display for LibraryPageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotALibraryPage => {
                write!(f, "no item-card entries, pager, or market-items container found")
            }
        }
    }
}

impl std::error::Error for LibraryPageError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryPageItem {
    pub native_product_id: String,
    pub name: Option<String>,
    /// Shop slug from `data-product-brand` (an id, not a display name —
    /// never mapped into `shop_name`).
    pub brand: Option<String>,
    pub category: Option<String>,
    /// Raw amount string from `data-product-price`; no currency is observed
    /// on listings, so observations omit the price pair entirely.
    pub price_amount: Option<String>,
    pub item_url: Option<String>,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryPage {
    pub items: Vec<LibraryPageItem>,
    pub next_page_url: Option<String>,
}

/// Extracts one listing page. An empty-but-real library page (container or
/// pager present, zero cards) extracts as an empty page; a page with no
/// recognizable listing structure at all is `NotALibraryPage`.
pub fn extract_library_page(html: &str) -> Result<LibraryPage, LibraryPageError> {
    let document = Html::parse_document(html);
    let card = Selector::parse("li.item-card[data-product-id]").expect("static selector");
    let card_link = Selector::parse("a[href*='/items/']").expect("static selector");
    let thumbnail = Selector::parse(".item-card__thumbnail img").expect("static selector");

    let mut items = Vec::new();
    let mut seen = Vec::new();
    for element in document.select(&card) {
        let value = element.value();
        let native_product_id = match value.attr("data-product-id") {
            Some(id) if !id.is_empty() => id.to_owned(),
            _ => continue,
        };
        if seen.iter().any(|existing| existing == &native_product_id) {
            continue;
        }
        seen.push(native_product_id.clone());

        let item_url = element
            .select(&card_link)
            .next()
            .and_then(|link| link.value().attr("href"))
            .map(str::to_owned)
            .filter(|href| !href.is_empty());
        let thumbnail_url = element
            .select(&thumbnail)
            .next()
            .and_then(|image| {
                image
                    .value()
                    .attr("data-origin")
                    .or_else(|| image.value().attr("src"))
                    .or_else(|| image.value().attr("data-lazy"))
            })
            .map(str::to_owned)
            .filter(|url| !url.is_empty());

        items.push(LibraryPageItem {
            native_product_id,
            name: non_empty(value.attr("data-product-name")),
            brand: non_empty(value.attr("data-product-brand")),
            category: non_empty(value.attr("data-product-category")),
            price_amount: non_empty(value.attr("data-product-price")),
            item_url,
            thumbnail_url,
        });
    }

    let next_page_url = document
        .select(&Selector::parse("a[rel='next']").expect("static selector"))
        .next()
        .and_then(|link| link.value().attr("href"))
        .map(str::to_owned)
        .filter(|href| !href.is_empty());

    if items.is_empty() && next_page_url.is_none() {
        let shell =
            Selector::parse(".market-items, .pager").expect("static selector");
        if document.select(&shell).next().is_none() {
            return Err(LibraryPageError::NotALibraryPage);
        }
    }

    Ok(LibraryPage { items, next_page_url })
}

/// `sha256:<64 hex>` of the page HTML — the write face's content-addressed
/// evidence, computed once per page and attached to every item observation.
pub fn page_content_hash(html: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(html.as_bytes());
    format!("sha256:{}", crate::artifact_inspection::hex_lower(&digest))
}

/// Maps one listing item onto the observation write face. `page_hash` is
/// [`page_content_hash`] of the whole page; `observed_at` is the fetch time
/// (RFC 3339), never a BOOTH publish time.
pub fn library_item_to_observation(
    item: &LibraryPageItem,
    page_hash: &str,
    observed_at: &str,
    run_id: Option<&str>,
) -> ProductObservation {
    // Currency, the Adult badge, availability and shop display name are not
    // observable on a listing card; the price pair rule then forces the
    // amount out too. These are standing gaps of this producer, recorded
    // honestly and refined by product-page observations.
    let mut missing_fields = vec![
        "price".to_owned(),
        "availability".to_owned(),
        "adult_badge".to_owned(),
        "shop_name".to_owned(),
    ];
    if item.name.is_none() {
        missing_fields.push("title".to_owned());
    }
    if item.thumbnail_url.is_none() {
        missing_fields.push("images".to_owned());
    }

    let source_url = normalize_item_url(item.item_url.as_deref(), &item.native_product_id);

    ProductObservation {
        product_id: format!("booth:{}", item.native_product_id),
        native_product_id: item.native_product_id.clone(),
        source_locale: locale_of(&source_url),
        source_category: item.category.clone(),
        title: item.name.clone(),
        status: ProductObservationStatus::Complete,
        source_url,
        final_url: None,
        description: None,
        age_restriction: None,
        adult: false,
        availability: None,
        price_amount: None,
        price_currency: None,
        shop_name: None,
        shop_url: None,
        image_urls: item.thumbnail_url.iter().cloned().collect(),
        video_urls: Vec::new(),
        subproducts: Vec::new(),
        source_published_at: None,
        content_hash: page_hash.to_owned(),
        observed_at: observed_at.to_owned(),
        run_id: run_id.map(str::to_owned),
        processor_version: LIBRARY_PAGE_PROCESSOR_VERSION.to_owned(),
        missing_fields,
    }
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|text| !text.is_empty()).map(str::to_owned)
}

/// Observed item URLs may be relative (`/en/items/…`); scheme-relative or
/// relative paths normalize onto `https://booth.pm`, and a card without any
/// link derives the canonical URL from the observed product id. All three
/// are deterministic normalizations of observed identity, never guesses
/// about page content.
fn normalize_item_url(observed: Option<&str>, native_product_id: &str) -> String {
    match observed {
        Some(url) if url.starts_with("https://") || url.starts_with("http://") => {
            url.to_owned()
        }
        Some(path) => {
            let path = path.trim_start_matches('/');
            format!("https://booth.pm/{path}")
        }
        None => format!("https://booth.pm/en/items/{native_product_id}"),
    }
}

/// `en` / `ja` from the item URL path; `None` when not discernible.
fn locale_of(source_url: &str) -> Option<String> {
    for locale in ["en", "ja", "ko", "zh-cn", "zh-tw"] {
        if source_url.contains(&format!("/{locale}/")) {
            return Some(locale.to_owned());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Modeled on the public-site grammar verified read-only 2026-10-02
    /// (`li.item-card` data attributes, `.item-card__thumbnail`, pager with
    /// `rel="next"`). Three cards: one fully attributed, one without a
    /// name, one without a price.
    const FIXTURE: &str = r#"<!DOCTYPE html>
<html><body>
<ul class="l-col market-items !pt-0 !pl-0">
  <li class="item-card l-card " data-product-brand="sanadajp" data-product-category="56"
      data-product-id="1693144" data-product-name="First item"
      data-product-price="300" data-tracking="impression_item">
    <div class="item-card__wrap" id="item_1693144">
      <a href="https://booth.pm/en/items/1693144">
        <div class="item-card__thumbnail js-thumbnail">
          <img src="https://booth.pximg.net/thumb.jpg" data-origin="https://booth.pximg.net/original.jpg">
        </div>
      </a>
    </div>
  </li>
  <li class="item-card l-card " data-product-brand="9remori" data-product-id="8711621" data-product-price="3300">
    <div class="item-card__wrap" id="item_8711621">
      <a href="/en/items/8711621">
        <div class="item-card__thumbnail js-thumbnail"><img src="https://booth.pximg.net/second.jpg"></div>
      </a>
    </div>
  </li>
  <li class="item-card l-card " data-product-brand="bayachao" data-product-id="100200300" data-product-name="Third item">
    <div class="item-card__wrap" id="item_100200300"></div>
  </li>
</ul>
<div class="pager"><a rel="next" href="https://booth.pm/en/library?page=2">Next</a></div>
</body></html>"#;

    #[test]
    fn extracts_cards_pagination_and_honest_gaps() {
        let page = extract_library_page(FIXTURE).expect("fixture parses");
        assert_eq!(page.items.len(), 3);
        assert_eq!(
            page.next_page_url.as_deref(),
            Some("https://booth.pm/en/library?page=2")
        );

        let first = &page.items[0];
        assert_eq!(first.native_product_id, "1693144");
        assert_eq!(first.name.as_deref(), Some("First item"));
        assert_eq!(first.brand.as_deref(), Some("sanadajp"));
        assert_eq!(first.price_amount.as_deref(), Some("300"));
        assert_eq!(
            first.item_url.as_deref(),
            Some("https://booth.pm/en/items/1693144")
        );
        // data-origin wins over src when present.
        assert_eq!(
            first.thumbnail_url.as_deref(),
            Some("https://booth.pximg.net/original.jpg")
        );

        // Missing name and price are findings, not errors.
        assert_eq!(page.items[1].name, None);
        assert_eq!(page.items[1].price_amount.as_deref(), Some("3300"));
        assert_eq!(page.items[1].thumbnail_url.as_deref(), Some("https://booth.pximg.net/second.jpg"));
        assert_eq!(page.items[2].price_amount, None);
        assert_eq!(page.items[2].thumbnail_url, None);
    }

    #[test]
    fn last_page_has_no_next() {
        let html = FIXTURE.replace(
            r#"<div class="pager"><a rel="next" href="https://booth.pm/en/library?page=2">Next</a></div>"#,
            r#"<div class="pager"><span>1</span></div>"#,
        );
        let page = extract_library_page(&html).expect("fixture parses");
        assert_eq!(page.next_page_url, None);
        assert_eq!(page.items.len(), 3);
    }

    #[test]
    fn empty_library_page_is_an_empty_page_not_an_error() {
        let html = r#"<html><body><ul class="l-col market-items"></ul><div class="pager"></div></body></html>"#;
        let page = extract_library_page(html).expect("empty page parses");
        assert!(page.items.is_empty());
        assert_eq!(page.next_page_url, None);
    }

    #[test]
    fn foreign_page_is_not_a_library_page() {
        let error = extract_library_page("<html><body><h1>Sign in</h1></body></html>")
            .expect_err("no listing structure");
        assert_eq!(error, LibraryPageError::NotALibraryPage);
    }

    #[test]
    fn duplicate_card_ids_collapse_within_a_page() {
        let html = FIXTURE.replace(
            r#"<li class="item-card l-card " data-product-brand="bayachao""#,
            r#"<li class="item-card l-card " data-product-brand="sanadajp""#,
        )
        .replace(
            r#"data-product-id="100200300" data-product-name="Third item">"#,
            r#"data-product-id="1693144" data-product-name="Third item">"#,
        );
        let page = extract_library_page(&html).expect("fixture parses");
        assert_eq!(page.items.len(), 2);
    }

    #[test]
    fn page_content_hash_is_stable_sha256() {
        let hash = page_content_hash("abc");
        assert!(hash.starts_with("sha256:"));
        assert_eq!(hash.len(), "sha256:".len() + 64);
        assert_eq!(page_content_hash("abc"), hash);
        assert_ne!(page_content_hash("abd"), hash);
    }

    #[test]
    fn observation_mapping_respects_the_write_face_closed_sets() {
        let page = extract_library_page(FIXTURE).expect("fixture parses");
        let hash = page_content_hash(FIXTURE);
        let observation =
            library_item_to_observation(&page.items[0], &hash, "2026-10-02T00:00:00.000Z", Some("sync-1"));

        // Identity pair agrees; evidence fields are caller-attached.
        assert_eq!(observation.product_id, "booth:1693144");
        assert_eq!(observation.native_product_id, "1693144");
        assert_eq!(observation.content_hash, hash);
        assert_eq!(observation.observed_at, "2026-10-02T00:00:00.000Z");
        assert_eq!(observation.processor_version, LIBRARY_PAGE_PROCESSOR_VERSION);
        assert_eq!(observation.run_id.as_deref(), Some("sync-1"));

        // Price pair omitted together; unobserved evidence is a gap, never
        // a guess.
        assert_eq!(observation.price_amount, None);
        assert_eq!(observation.price_currency, None);
        assert!(!observation.adult);
        assert_eq!(observation.availability, None);
        assert_eq!(observation.shop_name, None);
        for gap in ["price", "availability", "adult_badge", "shop_name"] {
            assert!(
                observation.missing_fields.iter().any(|field| field == gap),
                "missing_fields must name {gap}"
            );
        }

        // Read-face inputs flow verbatim.
        assert_eq!(observation.title.as_deref(), Some("First item"));
        assert_eq!(
            observation.image_urls,
            vec!["https://booth.pximg.net/original.jpg".to_owned()]
        );
        assert_eq!(observation.source_locale.as_deref(), Some("en"));
        assert_eq!(
            observation.status,
            ProductObservationStatus::Complete
        );
    }

    #[test]
    fn nameless_item_derives_its_source_url_and_reports_the_title_gap() {
        let page = extract_library_page(FIXTURE).expect("fixture parses");
        let observation = library_item_to_observation(
            &page.items[1],
            "sha256:fixed",
            "2026-10-02T00:00:00.000Z",
            None,
        );
        assert_eq!(
            observation.source_url,
            "https://booth.pm/en/items/8711621"
        );
        assert_eq!(observation.title, None);
        assert!(observation.missing_fields.iter().any(|field| field == "title"));
        assert_eq!(observation.run_id, None);
    }
}

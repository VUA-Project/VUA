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
    /// Library rows carry the shop's display name (e.g. "#あいかわらぼ
    /// /AikawaLabo") next to its subdomain link — real `shop_name`
    /// evidence, unlike the browse-card brand slug.
    pub shop_name: Option<String>,
    /// Shop subdomain URL (e.g. https://aikawa2.booth.pm/).
    pub shop_url: Option<String>,
    /// Trailing parenthetical variant marker from the library row title
    /// (e.g. "(めいゆん)" — which variant was purchased). The canonical
    /// title has it stripped; the variant rides separately.
    pub variant_name: Option<String>,
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

/// Extracts one listing page. Two grammars, tried in order:
///
/// - **Library rows** (verified on the real signed-in account library,
///   2026-10-02): cards are anchors to `/items/{id}` — a thumbnail anchor
///   (`img.l-library-item-thumbnail`) plus a title anchor whose text is the
///   display title. No data attributes, no price. The three library types
///   (`/library`, `/library/gifts`, `/library/free_downloads`) share this
///   grammar.
/// - **Browse cards** (verified read-only on the public site): the
///   `li.item-card[data-product-id]` grammar from the original
///   investigation.
///
/// Pagination is `a[rel="next"]` in both. An empty-but-real library page
/// (list header, nav items, or pager present, zero rows) extracts as an
/// empty page; a page with no recognizable listing structure at all is
/// `NotALibraryPage`.
pub fn extract_library_page(html: &str) -> Result<LibraryPage, LibraryPageError> {
    let document = Html::parse_document(html);
    // 判别按结构存在性,不按提取结果:浏览卡内部也含 /items/ 锚点,结果判别
    // 会让行语法抢先命中浏览页并丢失 data 属性事实
    let has_browse_cards = document
        .select(
            &Selector::parse("li.item-card[data-product-id]").expect("static selector"),
        )
        .next()
        .is_some();
    let items = if has_browse_cards {
        extract_browse_cards(&document)
    } else {
        extract_library_rows(&document)
    };

    let next_page_url = document
        .select(&Selector::parse("a[rel='next']").expect("static selector"))
        .next()
        .and_then(|link| link.value().attr("href"))
        .map(str::to_owned)
        .filter(|href| !href.is_empty());

    if items.is_empty() && next_page_url.is_none() {
        let shell = Selector::parse(
            ".market-items, .pager, #js-library-search-header, a.nav-item",
        )
        .expect("static selector");
        if document.select(&shell).next().is_none() {
            return Err(LibraryPageError::NotALibraryPage);
        }
    }

    Ok(LibraryPage { items, next_page_url })
}

/// Grammar A: account-library rows. One entry per unique product id; the
/// title comes from the anchor that carries text, the thumbnail from the
/// first anchor's image.
fn extract_library_rows(document: &Html) -> Vec<LibraryPageItem> {
    let anchor = Selector::parse("a[href*='/items/']").expect("static selector");
    let image = Selector::parse("img").expect("static selector");
    // 店铺锚:booth 子域外链(如 aikawa2.booth.pm),不在 /items/ 路径上;
    // 行内位于标题链接之后。向上找行容器再向内搜,避免误取相邻行。
    let shop_anchor =
        Selector::parse("a[href*='.booth.pm/']:not([href*='/items/'])").expect("static selector");
    let mut items: Vec<LibraryPageItem> = Vec::new();
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for element in document.select(&anchor) {
        let href = element.value().attr("href").unwrap_or_default();
        let Some(native_product_id) = product_id_from_href(href) else {
            continue;
        };
        let text = element_text(element);
        // 行容器:border-b 行 div(flex gap-8);店铺锚在其中,标题锚之外
        let row = element
            .ancestors()
            .find(|node| {
                node.value()
                    .as_element()
                    .is_some_and(|el| el.has_class("border-b", scraper::CaseSensitivity::CaseSensitive))
            })
            .and_then(scraper::ElementRef::wrap);
        let (shop_name, shop_url) = row
            .map(|row| {
                let shop = row.select(&shop_anchor).next();
                (
                    shop.and_then(|s| s.text().next().map(str::trim).filter(|t| !t.is_empty()).map(str::to_owned)),
                    shop.and_then(|s| s.value().attr("href")).filter(|h| !h.is_empty()).map(str::to_owned),
                )
            })
            .unwrap_or((None, None));
        // 标题拆尾缀:最后一个 "(xxx)" 段视为变体标记,前面的是规范标题。
        // 仅当括号在末尾且内有非空内容时拆;开头括号(如 "(無料)タイトル")不动
        let (canonical_name, variant_name) = match &text {
            t if !t.is_empty() => split_trailing_variant(t),
            _ => (None, None),
        };
        match index.get(&native_product_id) {
            Some(&position) => {
                let item = &mut items[position];
                if item.item_url.is_none() {
                    item.item_url = non_empty(Some(href));
                }
                if item.name.is_none() && canonical_name.is_some() {
                    item.name = canonical_name;
                }
                if item.variant_name.is_none() && variant_name.is_some() {
                    item.variant_name = variant_name;
                }
                if item.thumbnail_url.is_none() {
                    item.thumbnail_url = element
                        .select(&image)
                        .next()
                        .and_then(|img| img.value().attr("src"))
                        .and_then(|src| non_empty(Some(src)));
                }
            }
            None => {
                let thumbnail_url = element
                    .select(&image)
                    .next()
                    .and_then(|img| img.value().attr("src"))
                    .and_then(|src| non_empty(Some(src)));
                index.insert(native_product_id.clone(), items.len());
                items.push(LibraryPageItem {
                    native_product_id,
                    name: canonical_name,
                    variant_name,
                    brand: None,
                    shop_name,
                    shop_url,
                    category: None,
                    price_amount: None,
                    item_url: non_empty(Some(href)),
                    thumbnail_url,
                });
            }
        }
    }
    items
}

/// Grammar B: public browse cards (`li.item-card[data-product-id]`).
fn extract_browse_cards(document: &Html) -> Vec<LibraryPageItem> {
    let card = Selector::parse("li.item-card[data-product-id]").expect("static selector");
    let card_link = Selector::parse("a[href*='/items/']").expect("static selector");
    let thumbnail = Selector::parse(".item-card__thumbnail img").expect("static selector");

    let mut items = Vec::new();
    for element in document.select(&card) {
        let value = element.value();
        let native_product_id = match value.attr("data-product-id") {
            Some(id) if !id.is_empty() => id.to_owned(),
            _ => continue,
        };
        if items
            .iter()
            .any(|item: &LibraryPageItem| item.native_product_id == native_product_id)
        {
            continue;
        }
        let item_url = element
            .select(&card_link)
            .next()
            .and_then(|link| link.value().attr("href"))
            .map(str::to_owned)
            .filter(|href| !href.is_empty());
        let thumbnail_url = element
            .select(&thumbnail)
            .next()
            .and_then(|img| {
                img.value()
                    .attr("data-origin")
                    .or_else(|| img.value().attr("src"))
                    .or_else(|| img.value().attr("data-lazy"))
            })
            .map(str::to_owned)
            .filter(|url| !url.is_empty());
        items.push(LibraryPageItem {
            native_product_id,
            name: non_empty(value.attr("data-product-name")),
            variant_name: None,
            brand: non_empty(value.attr("data-product-brand")),
            shop_name: None,
            shop_url: None,
            category: non_empty(value.attr("data-product-category")),
            price_amount: non_empty(value.attr("data-product-price")),
            item_url,
            thumbnail_url,
        });
    }
    items
}

/// `/items/{digits}` → the digits; works for absolute and relative hrefs.
fn product_id_from_href(href: &str) -> Option<String> {
    let start = href.find("/items/")? + "/items/".len();
    let tail = &href[start..];
    let end = tail
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(tail.len());
    if end == 0 {
        None
    } else {
        Some(tail[..end].to_owned())
    }
}

fn element_text(element: scraper::ElementRef<'_>) -> String {
    element
        .text()
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// `sha256:<64 hex>` of the page HTML — the write face's content-addressed
/// evidence, computed once per page and attached to every item observation.
pub fn page_content_hash(html: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(html.as_bytes());
    format!("sha256:{}", crate::artifact_inspection::hex_lower(&digest))
}

/// Maps one listing item onto the observation write face. `library_type` records
/// which account library listed the item (BDL v0.3; None for library-agnostic
/// observations). `page_hash` is
/// [`page_content_hash`] of the whole page; `observed_at` is the fetch time
/// (RFC 3339), never a BOOTH publish time.
pub fn library_item_to_observation(
    item: &LibraryPageItem,
    page_hash: &str,
    observed_at: &str,
    run_id: Option<&str>,
    library_type: Option<&str>,
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
        library_type: library_type.map(str::to_owned),
        variant_name: item.variant_name.clone(),
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
        shop_name: item.shop_name.clone(),
        shop_url: item.shop_url.clone(),
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
            library_item_to_observation(&page.items[0], &hash, "2026-10-02T00:00:00.000Z", Some("sync-1"), Some("bought"));

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

#[cfg(test)]
mod library_rows_tests {
    use super::*;

    /// Real account-library row grammar (verified signed-in 2026-10-02;
    /// ids/titles anonymized): thumbnail anchor + title anchor per item,
    /// shop links are not item links, `a[rel="next"]` pagination.
    const ROWS: &str = r#"<!DOCTYPE html><html><body>
<div id="js-library-search-header"></div>
<div class="bg-white">
  <div class="flex gap-8 border-b">
    <a href="https://booth.pm/zh-cn/items/7463144"><img class="l-library-item-thumbnail" src="https://booth.pximg.net/first.jpg"></a>
    <div>
      <a class="no-underline" href="https://booth.pm/zh-cn/items/7463144"><div class="font-bold">Sample outfit A (shop-one)</div></a>
      <a href="https://shop-one.booth.pm/">shop-one</a>
    </div>
  </div>
  <div class="flex gap-8 border-b">
    <a href="/zh-cn/items/5511003"><img src="https://booth.pximg.net/second.jpg"></a>
    <a class="no-underline" href="/zh-cn/items/5511003"><div class="font-bold">Sample gift B (shop-two)</div></a>
  </div>
</div>
<nav><ul>
  <li class="current"><a class="nav-item" href="/library">1</a></li>
  <li><a rel="next" class="nav-item" href="/library?page=2">2</a></li>
</ul></nav>
</body></html>"#;

    #[test]
    fn library_rows_extract_with_titles_thumbnails_and_next() {
        let page = extract_library_page(ROWS).expect("rows parse");
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.next_page_url.as_deref(), Some("/library?page=2"));
        let first = &page.items[0];
        assert_eq!(first.native_product_id, "7463144");
        assert_eq!(first.name.as_deref(), Some("Sample outfit A"));
        assert_eq!(first.variant_name.as_deref(), Some("shop-one"));
        assert_eq!(first.thumbnail_url.as_deref(), Some("https://booth.pximg.net/first.jpg"));
        // 库行无品牌/价格事实:留空而不是猜
        assert_eq!(first.brand, None);
        assert_eq!(first.price_amount, None);
        let second = &page.items[1];
        assert_eq!(second.native_product_id, "5511003");
        assert_eq!(second.thumbnail_url.as_deref(), Some("https://booth.pximg.net/second.jpg"));
    }

    #[test]
    fn library_rows_last_page_has_no_next() {
        let html = ROWS.replace(r#"<li><a rel="next" class="nav-item" href="/library?page=2">2</a></li>"#, "");
        let page = extract_library_page(&html).expect("rows parse");
        assert_eq!(page.next_page_url, None);
        assert_eq!(page.items.len(), 2);
    }

    #[test]
    fn duplicate_item_anchors_collapse_to_one_row() {
        let html = ROWS.replace("</div>
</div>
<nav>", "</div>
</div>
<a href=\"/zh-cn/items/5511003\">dup</a>
<nav>");
        let page = extract_library_page(&html).expect("rows parse");
        assert_eq!(page.items.len(), 2);
        // 标题来自首个非空锚点,重复锚点不覆盖
        assert_eq!(page.items[1].name.as_deref(), Some("Sample gift B"));
        assert_eq!(page.items[1].variant_name.as_deref(), Some("shop-two"));
    }

    #[test]
    fn empty_library_page_with_header_is_not_an_error() {
        let html = r#"<html><body><div id="js-library-search-header"></div><div class="bg-white"></div></body></html>"#;
        let page = extract_library_page(html).expect("empty library parses");
        assert!(page.items.is_empty());
        assert_eq!(page.next_page_url, None);
    }

    #[test]
    fn product_id_from_href_shapes() {
        assert_eq!(product_id_from_href("https://booth.pm/zh-cn/items/7463144").as_deref(), Some("7463144"));
        assert_eq!(product_id_from_href("/ja/items/42?x=1").as_deref(), Some("42"));
        assert_eq!(product_id_from_href("/items/123/foo").as_deref(), Some("123"));
        assert_eq!(product_id_from_href("/items/abc"), None);
        assert_eq!(product_id_from_href("https://booth.pm/library"), None);
    }
}

/// 商品详情页检测:#items[data-product-id] 是商品页独有根(库页/浏览页无此结构)。
/// provider 用它选择富化语法;本身不解析内容。
pub fn is_product_page(html: &str) -> bool {
    let document = Html::parse_document(html);
    document
        .select(
            &Selector::parse("#items[data-product-id]").expect("static selector"),
        )
        .next()
        .is_some()
}


/// Trailing "(xxx)" variant marker split: "Title (めいゆん)" → ("Title",
/// "めいゆん"). Only strips the LAST parenthetical group at the very end
/// of the string; leading/embedded parens stay. Non-ASCII-aware.
fn split_trailing_variant(title: &str) -> (Option<String>, Option<String>) {
    let trimmed = title.trim_end();
    if !trimmed.ends_with(')') {
        return (Some(title.to_owned()), None);
    }
    // 从末尾找配对的 '('
    let bytes = trimmed.as_bytes();
    let mut depth = 0i32;
    let mut open = None;
    for (i, &b) in bytes.iter().enumerate().rev() {
        match b {
            b')' => depth += 1,
            b'(' => {
                depth -= 1;
                if depth == 0 {
                    open = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let Some(open) = open else {
        return (Some(title.to_owned()), None);
    };
    let inner = &trimmed[open + 1..trimmed.len() - 1];
    let head = &trimmed[..open];
    if inner.trim().is_empty() || head.trim().is_empty() {
        return (Some(title.to_owned()), None);
    }
    (Some(head.trim_end().to_owned()), Some(inner.trim().to_owned()))
}

#[cfg(test)]
mod variant_split_tests {
    use super::split_trailing_variant;

    #[test]
    fn splits_trailing_variant_marker() {
        let (title, variant) =
            split_trailing_variant("【40複数アバター対応】ComfyHabit-コンフィハビット-【 #VRChat】 (めいゆん)");
        assert_eq!(variant.as_deref(), Some("めいゆん"));
        let t = title.unwrap();
        assert!(t.starts_with("【40"));
        assert!(!t.contains("めいゆん"));
    }

    #[test]
    fn no_marker_returns_untouched() {
        let (title, variant) = split_trailing_variant("Plain product title");
        assert_eq!(variant, None);
        assert_eq!(title.as_deref(), Some("Plain product title"));
    }

    #[test]
    fn leading_parens_not_stripped() {
        let (title, variant) = split_trailing_variant("(無料)配布タイトル");
        assert_eq!(variant, None);
        assert_eq!(title.as_deref(), Some("(無料)配布タイトル"));
    }

    #[test]
    fn empty_or_whitespace_inner_not_split() {
        let (title, variant) = split_trailing_variant("Title ()");
        assert_eq!(variant, None);
        assert!(title.is_some());
    }
}

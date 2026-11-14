//! Manual Avatar-scoped BOOTH free-asset discovery (`booth-free-assets v0.1`).
//!
//! AMF parses browse HTML supplied by Electron Main, computes live ownership
//! status against BDL's four-way union (`product_library_memberships`,
//! `library_entry_metadata`, `artifact_mappings`, and `removed_library_cards`),
//! extracts literal Avatar Base suggestions from observed `3Dキャラクター` titles,
//! and persists preferences plus the latest result cache in an AMF-private JSON
//! state file (`free-assets-state.json`). Discovery never writes BDL tables.

use regex::Regex;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use vua_bdl_store::BdlStore;

pub const FREE_ASSETS_SCHEMA_VERSION: &str = "0.1";
pub const MAX_STORED_KEYWORDS: usize = 20;
pub const MAX_ENABLED_KEYWORDS: usize = 5;
pub const MAX_DISMISSED_IDS: usize = 2000;
pub const MAX_ITEMS_PER_PAGE: usize = 60;
pub const MAX_CACHED_ITEMS: usize = 300;
pub const MAX_HTML_BYTES: usize = 5_000_000;

pub const DEFAULT_CATEGORIES: [&str; 5] = ["209", "230", "231", "217", "214"];

const ALLOWED_CATEGORIES: [(&str, &str); 8] = [
    ("209", "3D衣装"),
    ("230", "3D髪型"),
    ("231", "3D靴"),
    ("217", "3D装飾品"),
    ("214", "3Dテクスチャ"),
    ("215", "3Dツール・システム"),
    ("216", "3Dモーション・アニメーション"),
    ("127", "3Dモデル（その他）"),
];

static SAMPLE_ASCII_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:demo|sample)\b").expect("static regex"));
static DATE_CUE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\d{1,2}/\d{1,2}|\d{1,2}月\d{1,2}日)\s*まで").expect("static regex")
});
static BRACKET_SPAN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"「([^「」]{1,80})」|『([^『』]{1,80})』|【([^【】]{1,80})】").expect("static regex")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FreeAssetsError {
    InvalidParams,
    InvalidPage,
    StoreFailed,
}

impl FreeAssetsError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidParams => "vua.free_assets.invalid_params",
            Self::InvalidPage => "vua.free_assets.invalid_page",
            Self::StoreFailed => "vua.free_assets.store_failed",
        }
    }

    pub fn message_key(self) -> &'static str {
        match self {
            Self::InvalidParams => "errors.freeAssets.invalidParams",
            Self::InvalidPage => "errors.freeAssets.invalidPage",
            Self::StoreFailed => "errors.freeAssets.storeFailed",
        }
    }

    pub fn category(self) -> &'static str {
        match self {
            Self::InvalidParams | Self::InvalidPage => "validation",
            Self::StoreFailed => "internal",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WatchedKeyword {
    pub keyword: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CachedFreeAssetItem {
    pub product_id: String,
    pub title: String,
    pub shop_name: Option<String>,
    pub category_id: Option<String>,
    pub category_label: Option<String>,
    pub thumbnail_url: Option<String>,
    pub matched_keywords: Vec<String>,
    pub is_sample: bool,
    pub has_date_cue: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedFreeAssetsState {
    schema_version: String,
    watched_keywords: Vec<WatchedKeyword>,
    enabled_categories: Vec<String>,
    hide_owned: bool,
    show_samples: bool,
    dismissed_product_ids: Vec<String>,
    last_queried_at: Option<String>,
    items: Vec<CachedFreeAssetItem>,
}

impl Default for PersistedFreeAssetsState {
    fn default() -> Self {
        Self {
            schema_version: FREE_ASSETS_SCHEMA_VERSION.to_owned(),
            watched_keywords: Vec::new(),
            enabled_categories: DEFAULT_CATEGORIES.iter().map(|s| (*s).to_owned()).collect(),
            hide_owned: true,
            show_samples: false,
            dismissed_product_ids: Vec::new(),
            last_queried_at: None,
            items: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StateParams {
    schema_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdatePreferencesParams {
    schema_version: String,
    watched_keywords: Option<Vec<WatchedKeyword>>,
    enabled_categories: Option<Vec<String>>,
    hide_owned: Option<bool>,
    show_samples: Option<bool>,
    dismiss_product_id: Option<String>,
    clear_dismissed: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IngestSearchPageParams {
    schema_version: String,
    keyword: String,
    source_url: String,
    html: String,
    fetched_at: String,
    reset_cache: bool,
}

/// Mirrors JavaScript `encodeURIComponent` byte-for-byte.
pub fn browse_url_for_keyword(keyword: &str) -> String {
    let mut url =
        "https://booth.pm/ja/browse/3D%E3%83%A2%E3%83%87%E3%83%AB?q=".to_owned();
    for byte in keyword.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            url.push(byte as char);
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url.push_str("&max_price=0&sort=new&in_stock=true");
    url
}

pub fn valid_keyword(keyword: &str) -> bool {
    keyword.trim() == keyword
        && !keyword.is_empty()
        && keyword.chars().count() <= 80
        && !keyword.chars().any(char::is_control)
}

pub fn valid_booth_product_id(id: &str) -> bool {
    id.strip_prefix("booth:").is_some_and(|digits| {
        !digits.is_empty()
            && digits.len() <= 20
            && !digits.starts_with('0')
            && digits.bytes().all(|b| b.is_ascii_digit())
    })
}

fn valid_category_id(id: &str) -> bool {
    ALLOWED_CATEGORIES.iter().any(|(code, _)| *code == id)
}

fn valid_utc_rfc3339(ts: &str) -> bool {
    ts.ends_with('Z')
        && vua_orchestrator::rfc3339_millis(ts).is_some()
        && ts.get(17..19) != Some("60")
}

fn valid_pximg_thumbnail(raw: &str) -> bool {
    if raw.is_empty()
        || raw
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '#'))
    {
        return false;
    }
    let Ok(parsed) = url::Url::parse(raw) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.host_str() == Some("booth.pximg.net")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.fragment().is_none()
}

pub fn is_sample_title(title: &str) -> bool {
    title.contains("お試し")
        || title.contains("サンプル")
        || title.contains("体験版")
        || SAMPLE_ASCII_RE.is_match(title)
}

pub fn has_date_cue_title(title: &str) -> bool {
    title.contains("期間限定")
        || title.contains("無料期間")
        || title.contains("本日まで")
        || title.contains("今週末まで")
        || DATE_CUE_RE.is_match(title)
}

fn is_generic_modifier_span(span: &str) -> bool {
    const JP_GENERIC: &[&str] = &[
        "オリジナル",
        "3Dモデル",
        "3Dキャラクター",
        "対応",
        "専用",
        "衣装",
        "アバター",
        "改変",
        "無料",
        "配布",
        "セール",
        "期間限定",
        "更新",
    ];
    if JP_GENERIC.iter().any(|term| span.contains(term)) {
        return true;
    }
    let lower = span.to_ascii_lowercase();
    for bad in ["vrchat", "vrc", "avatar", "ver", "ver.", "sample", "demo"] {
        if lower == bad
            || lower.starts_with("ver.")
            || lower.starts_with("ver ")
            || lower.contains("vrchat")
            || lower.contains("avatar")
        {
            return true;
        }
    }
    // Reject pure numbers or punctuation-only spans.
    !span.chars().any(|c| c.is_alphabetic())
}

pub fn extract_suggested_keywords(
    titles: &[String],
    watched: &[WatchedKeyword],
) -> Vec<String> {
    let watched_lower: HashSet<String> = watched
        .iter()
        .map(|w| w.keyword.to_lowercase())
        .collect();
    let mut seen_lower = HashSet::new();
    let mut out = Vec::new();
    for title in titles {
        for caps in BRACKET_SPAN_RE.captures_iter(title) {
            let Some(raw) = caps
                .get(1)
                .or_else(|| caps.get(2))
                .or_else(|| caps.get(3))
                .map(|m| m.as_str().trim())
            else {
                continue;
            };
            if !valid_keyword(raw) || is_generic_modifier_span(raw) {
                continue;
            }
            let key = raw.to_lowercase();
            if watched_lower.contains(&key) || !seen_lower.insert(key) {
                continue;
            }
            out.push(raw.to_owned());
            if out.len() == MAX_STORED_KEYWORDS {
                return out;
            }
        }
    }
    out
}

fn resolve_category(
    attr_raw: Option<&str>,
    anchor_raw: Option<&str>,
) -> (Option<String>, Option<String>) {
    let attr = attr_raw.map(str::trim).filter(|s| !s.is_empty());
    let anchor = anchor_raw
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.chars().count() <= 120);

    let category_id = attr
        .and_then(|val| {
            ALLOWED_CATEGORIES
                .iter()
                .find(|(code, label)| *code == val || *label == val)
                .map(|(code, _)| (*code).to_owned())
        })
        .or_else(|| {
            anchor.and_then(|val| {
                ALLOWED_CATEGORIES
                    .iter()
                    .find(|(_, label)| *label == val)
                    .map(|(code, _)| (*code).to_owned())
            })
        });

    let category_label = anchor.map(str::to_owned).or_else(|| {
        category_id.as_deref().and_then(|code| {
            ALLOWED_CATEGORIES
                .iter()
                .find(|(c, _)| *c == code)
                .map(|(_, label)| (*label).to_owned())
        })
    });

    (category_id, category_label)
}

pub fn parse_browse_page(
    keyword: &str,
    source_url: &str,
    html: &str,
) -> Result<Vec<CachedFreeAssetItem>, FreeAssetsError> {
    if !valid_keyword(keyword)
        || html.is_empty()
        || html.len() > MAX_HTML_BYTES
        || source_url != browse_url_for_keyword(keyword)
    {
        return Err(FreeAssetsError::InvalidParams);
    }

    let doc = Html::parse_document(html);
    let shell_sel = Selector::parse(".market-items").expect("static selector");
    let card_sel = Selector::parse("li.item-card[data-product-id]").expect("static selector");
    if doc.select(&shell_sel).next().is_none() && doc.select(&card_sel).next().is_none() {
        return Err(FreeAssetsError::InvalidPage);
    }

    let title_sel = Selector::parse(".item-card__title, .item-card__name").expect("static selector");
    let shop_sel =
        Selector::parse(".item-card__shop-name, .item-card__shop").expect("static selector");
    let cat_anchor_sel =
        Selector::parse(".item-card__category-anchor").expect("static selector");
    let thumb_anchor_sel =
        Selector::parse(".item-card__thumbnail-image").expect("static selector");
    let thumb_img_sel =
        Selector::parse(".item-card__thumbnail-image img, .item-card__thumbnail img")
            .expect("static selector");

    let collapse_ws = |el: scraper::ElementRef<'_>| {
        el.text()
            .collect::<Vec<_>>()
            .join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };

    let mut seen_ids = HashSet::new();
    let mut out = Vec::new();
    for card in doc.select(&card_sel) {
        let Some(raw_id) = card.value().attr("data-product-id").map(str::trim) else {
            continue;
        };
        if raw_id.is_empty()
            || raw_id.len() > 20
            || raw_id.starts_with('0')
            || !raw_id.bytes().all(|b| b.is_ascii_digit())
        {
            continue;
        }
        // Strict ¥0 admission: any non-zero or missing price is discarded.
        if card.value().attr("data-product-price").map(str::trim) != Some("0") {
            continue;
        }
        let product_id = format!("booth:{raw_id}");
        if !seen_ids.insert(product_id.clone()) {
            continue;
        }

        let title = card
            .select(&title_sel)
            .next()
            .map(collapse_ws)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                card.value()
                    .attr("data-product-name")
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
            });
        let Some(title) = title.filter(|s| s.chars().count() <= 1000) else {
            continue;
        };

        let shop_name = card
            .select(&shop_sel)
            .next()
            .map(collapse_ws)
            .filter(|s| !s.is_empty() && s.chars().count() <= 500);

        let anchor_label = card.select(&cat_anchor_sel).next().map(collapse_ws);
        let (category_id, category_label) = resolve_category(
            card.value().attr("data-product-category"),
            anchor_label.as_deref(),
        );

        let thumbnail_url = card
            .select(&thumb_anchor_sel)
            .find_map(|el| el.value().attr("data-original").map(str::trim))
            .or_else(|| {
                card.select(&thumb_img_sel)
                    .find_map(|el| el.value().attr("src").map(str::trim))
            })
            .filter(|url| valid_pximg_thumbnail(url))
            .map(str::to_owned);

        let is_sample = is_sample_title(&title);
        let has_date_cue = has_date_cue_title(&title);

        out.push(CachedFreeAssetItem {
            product_id,
            title,
            shop_name,
            category_id,
            category_label,
            thumbnail_url,
            matched_keywords: vec![keyword.to_owned()],
            is_sample,
            has_date_cue,
        });

        if out.len() == MAX_ITEMS_PER_PAGE {
            break;
        }
    }

    Ok(out)
}

fn validate_watched_keywords(list: &[WatchedKeyword]) -> bool {
    if list.len() > MAX_STORED_KEYWORDS {
        return false;
    }
    let mut seen = HashSet::new();
    let mut enabled_count = 0usize;
    for row in list {
        if !valid_keyword(&row.keyword) || !seen.insert(row.keyword.as_str()) {
            return false;
        }
        if row.enabled {
            enabled_count += 1;
        }
    }
    enabled_count <= MAX_ENABLED_KEYWORDS
}

fn validate_enabled_categories(list: &[String]) -> bool {
    if list.len() > ALLOWED_CATEGORIES.len() {
        return false;
    }
    let mut seen = HashSet::new();
    list.iter()
        .all(|c| valid_category_id(c) && seen.insert(c.as_str()))
}

fn validate_persisted_state(state: &PersistedFreeAssetsState) -> bool {
    if state.schema_version != FREE_ASSETS_SCHEMA_VERSION
        || !validate_watched_keywords(&state.watched_keywords)
        || !validate_enabled_categories(&state.enabled_categories)
        || state.dismissed_product_ids.len() > MAX_DISMISSED_IDS
        || state.items.len() > MAX_CACHED_ITEMS
    {
        return false;
    }
    let mut seen_dismissed = HashSet::new();
    if !state
        .dismissed_product_ids
        .iter()
        .all(|id| valid_booth_product_id(id) && seen_dismissed.insert(id.as_str()))
    {
        return false;
    }
    if let Some(ts) = state.last_queried_at.as_deref() {
        if !valid_utc_rfc3339(ts) {
            return false;
        }
    }
    let mut seen_items = HashSet::new();
    for item in &state.items {
        if !valid_booth_product_id(&item.product_id)
            || !seen_items.insert(item.product_id.as_str())
            || item.title.is_empty()
            || item.title.chars().count() > 1000
            || item
                .shop_name
                .as_deref()
                .is_some_and(|s| s.is_empty() || s.chars().count() > 500)
            || item
                .category_id
                .as_deref()
                .is_some_and(|c| !valid_category_id(c))
            || item
                .category_label
                .as_deref()
                .is_some_and(|l| l.is_empty() || l.chars().count() > 120)
            || item
                .thumbnail_url
                .as_deref()
                .is_some_and(|u| !valid_pximg_thumbnail(u))
            || item.matched_keywords.is_empty()
            || item.matched_keywords.len() > MAX_ENABLED_KEYWORDS
            || !item.matched_keywords.iter().all(|k| valid_keyword(k))
        {
            return false;
        }
    }
    true
}

pub struct FreeAssetsService {
    bdl: Arc<BdlStore>,
    state_path: PathBuf,
    guard: Mutex<()>,
}

impl FreeAssetsService {
    pub fn new(bdl: Arc<BdlStore>, state_path: impl Into<PathBuf>) -> Self {
        Self {
            bdl,
            state_path: state_path.into(),
            guard: Mutex::new(()),
        }
    }

    pub fn apply(&self, method: &str, params: Value) -> Result<Value, FreeAssetsError> {
        let _lock = self.guard.lock().expect("free assets mutex poisoned");
        match method {
            "freeAssets.state" => {
                let parsed: StateParams =
                    serde_json::from_value(params).map_err(|_| FreeAssetsError::InvalidParams)?;
                if parsed.schema_version != FREE_ASSETS_SCHEMA_VERSION {
                    return Err(FreeAssetsError::InvalidParams);
                }
                let persisted = self.load_or_quarantine()?;
                self.render_state(&persisted)
            }
            "freeAssets.updatePreferences" => {
                let parsed: UpdatePreferencesParams =
                    serde_json::from_value(params).map_err(|_| FreeAssetsError::InvalidParams)?;
                if parsed.schema_version != FREE_ASSETS_SCHEMA_VERSION {
                    return Err(FreeAssetsError::InvalidParams);
                }
                let has_mutation = parsed.watched_keywords.is_some()
                    || parsed.enabled_categories.is_some()
                    || parsed.hide_owned.is_some()
                    || parsed.show_samples.is_some()
                    || parsed.dismiss_product_id.is_some()
                    || parsed.clear_dismissed.is_some();
                if !has_mutation {
                    return Err(FreeAssetsError::InvalidParams);
                }
                if let Some(ref keywords) = parsed.watched_keywords {
                    if !validate_watched_keywords(keywords) {
                        return Err(FreeAssetsError::InvalidParams);
                    }
                }
                if let Some(ref categories) = parsed.enabled_categories {
                    if !validate_enabled_categories(categories) {
                        return Err(FreeAssetsError::InvalidParams);
                    }
                }
                if let Some(ref dismiss_id) = parsed.dismiss_product_id {
                    if !valid_booth_product_id(dismiss_id) {
                        return Err(FreeAssetsError::InvalidParams);
                    }
                }

                let mut state = self.load_or_quarantine()?;
                if let Some(keywords) = parsed.watched_keywords {
                    state.watched_keywords = keywords;
                }
                if let Some(categories) = parsed.enabled_categories {
                    state.enabled_categories = categories;
                }
                if let Some(hide_owned) = parsed.hide_owned {
                    state.hide_owned = hide_owned;
                }
                if let Some(show_samples) = parsed.show_samples {
                    state.show_samples = show_samples;
                }
                if parsed.clear_dismissed == Some(true) {
                    state.dismissed_product_ids.clear();
                }
                if let Some(dismiss_id) = parsed.dismiss_product_id {
                    if !state.dismissed_product_ids.contains(&dismiss_id) {
                        if state.dismissed_product_ids.len() >= MAX_DISMISSED_IDS {
                            state.dismissed_product_ids.remove(0);
                        }
                        state.dismissed_product_ids.push(dismiss_id);
                    }
                }

                self.save_atomic(&state)?;
                self.render_state(&state)
            }
            "freeAssets.ingestSearchPage" => {
                let parsed: IngestSearchPageParams =
                    serde_json::from_value(params).map_err(|_| FreeAssetsError::InvalidParams)?;
                if parsed.schema_version != FREE_ASSETS_SCHEMA_VERSION
                    || !valid_utc_rfc3339(&parsed.fetched_at)
                {
                    return Err(FreeAssetsError::InvalidParams);
                }
                let page_items =
                    parse_browse_page(&parsed.keyword, &parsed.source_url, &parsed.html)?;

                let mut state = self.load_or_quarantine()?;
                if parsed.reset_cache {
                    state.items.clear();
                }
                for incoming in page_items {
                    if let Some(existing) = state
                        .items
                        .iter_mut()
                        .find(|row| row.product_id == incoming.product_id)
                    {
                        existing.title = incoming.title;
                        existing.shop_name = incoming.shop_name;
                        existing.category_id = incoming.category_id;
                        existing.category_label = incoming.category_label;
                        existing.thumbnail_url = incoming.thumbnail_url;
                        existing.is_sample = incoming.is_sample;
                        existing.has_date_cue = incoming.has_date_cue;
                        if !existing.matched_keywords.contains(&parsed.keyword)
                            && existing.matched_keywords.len() < MAX_ENABLED_KEYWORDS
                        {
                            existing.matched_keywords.push(parsed.keyword.clone());
                        }
                    } else if state.items.len() < MAX_CACHED_ITEMS {
                        state.items.push(incoming);
                    }
                }
                state.last_queried_at = Some(parsed.fetched_at);

                self.save_atomic(&state)?;
                self.render_state(&state)
            }
            _ => Err(FreeAssetsError::InvalidParams),
        }
    }

    fn load_or_quarantine(&self) -> Result<PersistedFreeAssetsState, FreeAssetsError> {
        if !self.state_path.exists() {
            return Ok(PersistedFreeAssetsState::default());
        }
        let bytes = fs::read(&self.state_path).map_err(|_| FreeAssetsError::StoreFailed)?;
        match serde_json::from_slice::<PersistedFreeAssetsState>(&bytes) {
            Ok(state) if validate_persisted_state(&state) => Ok(state),
            _ => {
                quarantine_corrupt_file(&self.state_path);
                Ok(PersistedFreeAssetsState::default())
            }
        }
    }

    fn save_atomic(&self, state: &PersistedFreeAssetsState) -> Result<(), FreeAssetsError> {
        let Some(parent) = self.state_path.parent() else {
            return Err(FreeAssetsError::StoreFailed);
        };
        fs::create_dir_all(parent).map_err(|_| FreeAssetsError::StoreFailed)?;
        let encoded =
            serde_json::to_vec_pretty(state).map_err(|_| FreeAssetsError::StoreFailed)?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let tmp_path = parent.join(format!("free-assets-state.tmp-{stamp:x}.json"));
        let write_result = (|| -> std::io::Result<()> {
            let mut file = File::create(&tmp_path)?;
            file.write_all(&encoded)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&tmp_path, &self.state_path)
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&tmp_path);
            return Err(FreeAssetsError::StoreFailed);
        }
        Ok(())
    }

    fn render_state(&self, state: &PersistedFreeAssetsState) -> Result<Value, FreeAssetsError> {
        let owned_ids = self
            .bdl
            .free_assets_owned_product_ids()
            .map_err(|_| FreeAssetsError::StoreFailed)?;
        let character_titles = self
            .bdl
            .character_product_titles()
            .map_err(|_| FreeAssetsError::StoreFailed)?;
        let suggested = extract_suggested_keywords(&character_titles, &state.watched_keywords);
        let items: Vec<Value> = state
            .items
            .iter()
            .map(|item| {
                json!({
                    "productId": item.product_id,
                    "title": item.title,
                    "shopName": item.shop_name,
                    "categoryId": item.category_id,
                    "categoryLabel": item.category_label,
                    "thumbnailUrl": item.thumbnail_url,
                    "matchedKeywords": item.matched_keywords,
                    "isSample": item.is_sample,
                    "hasDateCue": item.has_date_cue,
                    "owned": owned_ids.contains(&item.product_id),
                })
            })
            .collect();

        Ok(json!({
            "schemaVersion": FREE_ASSETS_SCHEMA_VERSION,
            "watchedKeywords": state.watched_keywords,
            "suggestedKeywords": suggested,
            "enabledCategories": state.enabled_categories,
            "hideOwned": state.hide_owned,
            "showSamples": state.show_samples,
            "dismissedProductIds": state.dismissed_product_ids,
            "lastQueriedAt": state.last_queried_at,
            "items": items,
        }))
    }
}

fn quarantine_corrupt_file(path: &Path) {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    if let Some(parent) = path.parent() {
        let target = parent.join(format!("free-assets-state.corrupt-{millis}.json"));
        let _ = fs::rename(path, target);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::unique_dir;
    use vua_bdl_store::{ProductObservation, ProductObservationStatus};

    fn schema_vector(rel: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../schemas/booth-free-assets/v0.1")
            .join(rel);
        serde_json::from_slice(&fs::read(path).expect("schema file must exist")).unwrap()
    }

    #[test]
    fn validates_all_contract_vectors_and_live_responses_against_json_schemas() {
        let req_validator =
            jsonschema::validator_for(&schema_vector("request.schema.json")).unwrap();
        let res_validator =
            jsonschema::validator_for(&schema_vector("response.schema.json")).unwrap();

        for valid_req in [
            "examples/state.request.json",
            "examples/update-preferences.request.json",
            "examples/ingest-search-page.request.json",
        ] {
            let instance = schema_vector(valid_req);
            assert!(req_validator.is_valid(&instance), "expected valid: {valid_req}");
        }
        for invalid_req in [
            "examples/invalid-source-url.request.json",
            "examples/invalid-empty-prefs.request.json",
        ] {
            let instance = schema_vector(invalid_req);
            assert!(
                !req_validator.is_valid(&instance),
                "expected invalid: {invalid_req}"
            );
        }

        assert!(res_validator.is_valid(&schema_vector("examples/state.response.json")));
        assert!(!res_validator.is_valid(&schema_vector(
            "examples/invalid-foreign-thumbnail.response.json"
        )));

        let dir = unique_dir("vua-free-assets", "state");
        let bdl = Arc::new(BdlStore::open_in_memory().unwrap());
        bdl.record_product_observation(&ProductObservation {
            product_id: "booth:100100".into(),
            source_url: "https://booth.pm/ja/items/100100".into(),
            native_product_id: "100100".into(),
            library_type: Some("bought".into()),
            variant_name: None,
            final_url: None,
            status: ProductObservationStatus::Complete,
            source_locale: Some("ja".into()),
            source_category: Some("3Dキャラクター".into()),
            title: Some("【オリジナル3Dモデル】「SyntheticSuggestedBase」".into()),
            description: None,
            age_restriction: None,
            adult: false,
            availability: Some("available".into()),
            price_amount: Some("5000".into()),
            price_currency: Some("JPY".into()),
            shop_name: Some("Synthetic Studio".into()),
            shop_url: None,
            image_urls: vec![],
            video_urls: vec![],
            subproducts: vec![],
            source_published_at: None,
            content_hash: format!("sha256:{}", "1".repeat(64)),
            observed_at: "2026-11-14T07:00:00Z".into(),
            run_id: None,
            processor_version: "catalog-sync/0.3".into(),
            missing_fields: vec![],
        })
        .unwrap();

        let svc = FreeAssetsService::new(bdl.clone(), dir.join("free-assets-state.json"));
        let initial = svc
            .apply("freeAssets.state", json!({ "schemaVersion": "0.1" }))
            .unwrap();
        assert!(res_validator.is_valid(&initial), "{initial}");
        assert_eq!(initial["suggestedKeywords"], json!(["SyntheticSuggestedBase"]));

        let updated = svc
            .apply(
                "freeAssets.updatePreferences",
                schema_vector("examples/update-preferences.request.json")["params"].clone(),
            )
            .unwrap();
        assert!(res_validator.is_valid(&updated), "{updated}");

        let ingested = svc
            .apply(
                "freeAssets.ingestSearchPage",
                schema_vector("examples/ingest-search-page.request.json")["params"].clone(),
            )
            .unwrap();
        assert!(res_validator.is_valid(&ingested), "{ingested}");
        assert_eq!(ingested["items"].as_array().unwrap().len(), 1);
        assert_eq!(ingested["items"][0]["productId"], "booth:900001");
        assert_eq!(ingested["items"][0]["hasDateCue"], true);
        assert_eq!(ingested["items"][0]["owned"], false);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn filters_paid_items_foreign_thumbnails_and_sale_false_positives_and_quarantines_corrupt_state() {
        let dir = unique_dir("vua-free-assets", "quarantine");
        let state_file = dir.join("free-assets-state.json");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&state_file, b"{broken json").unwrap();

        let bdl = Arc::new(BdlStore::open_in_memory().unwrap());
        let svc = FreeAssetsService::new(bdl, &state_file);

        // Corrupt state is quarantined and cleanly reset without failing.
        let reset = svc
            .apply("freeAssets.state", json!({ "schemaVersion": "0.1" }))
            .unwrap();
        assert_eq!(reset["items"], json!([]));
        let entries: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            entries
                .iter()
                .any(|name| name.starts_with("free-assets-state.corrupt-")),
            "expected quarantined file in {entries:?}"
        );

        let kw = "SyntheticBaseA";
        let html = concat!(
            "<ul class='market-items'>",
            // Paid card must be ignored even if present in HTML:
            "<li class='item-card' data-product-id='900010' data-product-price='500' data-product-category='209'>",
            "<div class='item-card__title'>Paid Coat</div></li>",
            // Free sample card with foreign thumbnail and セール (must NOT set hasDateCue):
            "<li class='item-card' data-product-id='900011' data-product-price='0' data-product-category='230'>",
            "<a class='item-card__thumbnail-image' data-original='https://evil.example.com/x.png'></a>",
            "<div class='item-card__title'>セール記念 お試し Hair</div></li>",
            "</ul>"
        );
        let state = svc
            .apply(
                "freeAssets.ingestSearchPage",
                json!({
                    "schemaVersion": "0.1",
                    "keyword": kw,
                    "sourceUrl": browse_url_for_keyword(kw),
                    "html": html,
                    "fetchedAt": "2026-11-14T08:30:00Z",
                    "resetCache": true
                }),
            )
            .unwrap();
        let items = state["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["productId"], "booth:900011");
        assert_eq!(items[0]["isSample"], true);
        assert_eq!(items[0]["hasDateCue"], false);
        assert_eq!(items[0]["thumbnailUrl"], Value::Null);
        assert_eq!(items[0]["categoryId"], "230");
        assert_eq!(items[0]["categoryLabel"], "3D髪型");

        // Login/error page without .market-items fails with InvalidPage.
        let err = svc
            .apply(
                "freeAssets.ingestSearchPage",
                json!({
                    "schemaVersion": "0.1",
                    "keyword": kw,
                    "sourceUrl": browse_url_for_keyword(kw),
                    "html": "<html><body>Please sign in</body></html>",
                    "fetchedAt": "2026-11-14T08:31:00Z",
                    "resetCache": false
                }),
            )
            .unwrap_err();
        assert_eq!(err, FreeAssetsError::InvalidPage);

        fs::remove_dir_all(&dir).ok();
    }
}

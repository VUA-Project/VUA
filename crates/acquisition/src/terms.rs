//! AMF terms refresh tasks and stored-evidence use checks.
#[path = "terms_download.rs"]
pub mod download;
use crate::{terms_links, vn3};
use download::{FetchOutcome, TermsTransport};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};
use vua_bdl_store::{
    terms::{ProductTerms, TermItem, TermWarning, TermsDocument},
    BdlStore, BdlStoreError,
};
use vua_orchestrator::{
    AppErrorV1, Clock, ErrorCategory, SubmitRequest, TaskExit, TaskLane, TaskLanePolicy,
    TaskRuntime,
};

fn error(code: &str) -> AppErrorV1 {
    AppErrorV1::new(
        format!("vua.terms.{code}"),
        ErrorCategory::Unavailable,
        "errors.terms.failed",
        "terms",
    )
    .with_recoverable(true)
}
fn store_error(_: BdlStoreError) -> AppErrorV1 {
    error("store_failed")
}

pub struct TermsService {
    pub store: Arc<BdlStore>,
    runtime: TaskRuntime,
    lane: TaskLane,
    root: PathBuf,
    transport: Arc<dyn TermsTransport>,
    clock: Arc<dyn Clock>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshReport {
    schema_version: String,
    processed_products: usize,
    parsed_documents: usize,
    problem_documents: usize,
    cached_documents: usize,
}

impl TermsService {
    pub fn new(
        store: Arc<BdlStore>,
        runtime: TaskRuntime,
        root: PathBuf,
        transport: Arc<dyn TermsTransport>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            store,
            runtime,
            lane: TaskLane::new(),
            root,
            transport,
            clock,
        }
    }
    pub fn submit(
        self: &Arc<Self>,
        product: Option<&str>,
        correlation: &str,
        command_id: &str,
    ) -> Result<Value, AppErrorV1> {
        let products = if let Some(product) = product {
            vec![self
                .store
                .terms_product(product)
                .map_err(store_error)?
                .ok_or_else(|| error("product_not_found"))?]
        } else {
            self.store.terms_library_products().map_err(store_error)?
        };
        let operation = if product.is_some() {
            "terms.refreshProduct"
        } else {
            "terms.refreshLibrary"
        };
        let worker = self.clone();
        let fingerprint = terms_links::sha256(
            serde_json::to_string(&json!({"method":operation,"productId":product}))
                .expect("closed fingerprint")
                .as_bytes(),
        );
        let accepted=self.runtime.submit_idempotent_in_lane(SubmitRequest {correlation_id:Some(correlation.into()),timeout:None,job:Box::new(move |ctx|{
            let mut report=RefreshReport {schema_version:"0.1".into(),..Default::default()};
            let mut visited=BTreeSet::new();
            for product in products {
                if ctx.check_cancel() {return Ok(TaskExit::Cancelled);}
                ctx.emit_progress(json!({"operation":operation,"processedProducts":report.processed_products}));
                if self::capture_description(&worker.store,&product.product_id,product.description.as_deref(),&worker.clock.now_rfc3339()).is_err() {return Err(error("store_failed"));}
                let snapshot=worker.store.product_terms(&product.product_id).map_err(store_error)?;
                if snapshot.capture_problem.is_some() {report.processed_products+=1;ctx.warn();continue;}
                let sources=snapshot.sources;
                for source in sources.into_iter().filter(|s|s.link.google_file_id.is_some()) {
                    if !visited.insert(source.link.source_id.clone()) {continue;}
                    match worker.transport.fetch(&source.link,&||ctx.check_cancel()) {
                        FetchOutcome::Cancelled=>return Ok(TaskExit::Cancelled),
                        FetchOutcome::Observed {status,problem}=>{
                            worker.store.record_terms_result(&source.link.source_id,status,&worker.clock.now_rfc3339(),Some(problem),None).map_err(store_error)?;
                            report.problem_documents+=1;ctx.warn();
                        }
                        FetchOutcome::Pdf(bytes)=>{
                            if ctx.check_cancel() {return Ok(TaskExit::Cancelled);}
                            let hash=terms_links::sha256(&bytes);
                            worker.cache(&source.link.source_kind,source.link.google_file_id.as_deref().expect("candidate ID"),&hash,&bytes)?;
                            let document=if let Some(cached)=worker.store.cached_terms_document(&source.link.source_id,&hash,vn3::PARSER_VERSION).map_err(store_error)? {
                                report.cached_documents+=1;cached
                            } else {
                                match vn3::extract_pdf_cancellable(&bytes,&||ctx.check_cancel()) {
                                    Ok(text)=>vn3::parse_text(&text,&hash),
                                    Err(reason)=>TermsDocument::empty("unsupported",&hash,vn3::PARSER_VERSION,reason),
                                }
                            };
                            if ctx.check_cancel() {return Ok(TaskExit::Cancelled);}
                            worker.store.record_terms_result(&source.link.source_id,&document.status,&worker.clock.now_rfc3339(),None,Some(&document)).map_err(store_error)?;
                            if document.status=="parsed" {report.parsed_documents+=1;if !document.warnings.is_empty(){ctx.warn();}}
                            else {report.problem_documents+=1;ctx.warn();}
                        }
                    }
                }
                report.processed_products+=1;
            }
            Ok(TaskExit::Done(serde_json::to_value(report).expect("refresh report")))
        })},&self.lane,TaskLanePolicy {key:product.map(str::to_owned),exclusive:product.is_none()},operation,command_id,&fingerprint)?;
        Ok(json!({"schemaVersion":"0.1","taskId":accepted.task_id}))
    }
    fn cache(&self, kind: &str, id: &str, hash: &str, bytes: &[u8]) -> Result<(), AppErrorV1> {
        if !matches!(kind, "drive" | "docs" | "vn3")
            || id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
            || hash.len() != 64
            || !hash
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
        {
            return Err(error("cache_failed"));
        }
        let mut directory = self.root.clone();
        for component in [None, Some(kind), Some(id)] {
            if let Some(component) = component {
                directory.push(component);
            }
            if fs::symlink_metadata(&directory).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err(error("cache_failed"));
            }
            fs::create_dir_all(&directory).map_err(|_| error("cache_failed"))?;
        }
        let path = directory.join(format!("{hash}.pdf"));
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() != bytes.len() as u64
                || terms_links::sha256(&fs::read(&path).map_err(|_| error("cache_failed"))?) != hash
            {
                return Err(error("cache_failed"));
            }
            return Ok(());
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| error("cache_failed"))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| error("cache_failed"))
    }
    pub fn product(&self, id: &str) -> Result<TermsDetail, AppErrorV1> {
        product_detail(&self.store, id).map_err(store_error)
    }
    pub fn check_use(&self, preset: &str, ids: &[String]) -> Result<UseCheck, AppErrorV1> {
        check_use(&self.store, preset, ids).map_err(store_error)
    }
}

/// Legacy visible descriptions supply candidates when no captured HTML link snapshot exists.
pub fn capture_description(
    store: &BdlStore,
    product: &str,
    text: Option<&str>,
    at: &str,
) -> Result<(), BdlStoreError> {
    if let Some(text) = text {
        store.record_terms_links_if_missing(
            product,
            &terms_links::description_text_links(text),
            at,
        )?;
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpecialNote {
    pub product_id: String,
    pub source_id: String,
    pub language: Option<String>,
    pub text: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermsDetail {
    #[serde(flatten)]
    pub product: ProductTerms,
    pub effective_language: Option<String>,
    pub effective_items: Vec<TermItem>,
    pub warnings: Vec<TermWarning>,
    pub has_special_note: bool,
    pub special_notes: Vec<SpecialNote>,
}

pub fn product_detail(store: &BdlStore, id: &str) -> Result<TermsDetail, BdlStoreError> {
    Ok(detail_from_product_terms(store.product_terms(id)?))
}

pub fn all_product_details(
    store: &BdlStore,
) -> Result<std::collections::HashMap<String, TermsDetail>, BdlStoreError> {
    Ok(store
        .all_product_terms()?
        .into_iter()
        .map(|(id, terms)| (id, detail_from_product_terms(terms)))
        .collect())
}

pub fn product_details_for_ids(
    store: &BdlStore,
    ids: &[String],
) -> Result<std::collections::HashMap<String, TermsDetail>, BdlStoreError> {
    Ok(store
        .product_terms_for_ids(ids)?
        .into_iter()
        .map(|(id, terms)| (id, detail_from_product_terms(terms)))
        .collect())
}

pub fn detail_from_product_terms(product: ProductTerms) -> TermsDetail {
    let id = product.product_id.clone();
    let documents: Vec<_> = product
        .sources
        .iter()
        .filter_map(|s| {
            s.document
                .as_ref()
                .filter(|d| s.status == "parsed" && d.status == "parsed")
                .map(|d| (&s.link.source_id, d))
        })
        .collect();
    let selected = documents
        .iter()
        .find(|(_, d)| d.language.as_deref() == Some("ja"))
        .or_else(|| documents.first());
    let mut effective_items = selected.map(|(_, d)| d.items.clone()).unwrap_or_default();
    let baseline = effective_items.clone();
    let effective_language = selected.and_then(|(_, d)| d.language.clone());
    let mut warnings = Vec::new();
    let mut special_notes = Vec::new();
    for (source, document) in &documents {
        warnings.extend(document.warnings.clone());
        if let Some(note) = document.special_note.as_ref().filter(|n| !n.is_empty()) {
            special_notes.push(SpecialNote {
                product_id: id.clone(),
                source_id: (*source).clone(),
                language: document.language.clone(),
                text: note.clone(),
            });
        }
        if document
            .warnings
            .iter()
            .any(|w| w.code == "summary_conflict" && w.item.as_deref() == Some("X"))
        {
            if let Some(note) = document
                .items
                .iter()
                .find(|i| i.item == "X")
                .and_then(|i| i.summary_raw_text.as_ref())
                .filter(|n| {
                    !vn3::empty_special_note(n) && document.special_note.as_ref() != Some(n)
                })
            {
                special_notes.push(SpecialNote {
                    product_id: id.clone(),
                    source_id: (*source).clone(),
                    language: document.language.clone(),
                    text: note.clone(),
                });
            }
        }
        for item in &mut effective_items {
            if item.item == "X" {
                continue;
            }
            let comparison = document.items.iter().find(|i| i.item == item.item);
            let original = baseline
                .iter()
                .find(|i| i.item == item.item)
                .expect("selected baseline");
            if comparison
                .is_none_or(|i| i.value != original.value || i.condition != original.condition)
            {
                warnings.push(TermWarning {
                    code: if document.language != effective_language {
                        "language_conflict"
                    } else {
                        "multiple_document_conflict"
                    }
                    .into(),
                    item: Some(item.item.clone()),
                });
                item.value = "unknown".into();
                item.condition = None;
            }
        }
    }
    if !documents.is_empty() && effective_language.as_deref() != Some("ja") {
        warnings.push(TermWarning {
            code: "english_reference_only".into(),
            item: None,
        });
    }
    TermsDetail {
        product,
        effective_language,
        effective_items,
        warnings,
        has_special_note: !special_notes.is_empty(),
        special_notes,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preset {
    id: String,
    items: Vec<String>,
    #[serde(default)]
    advisory_items: Vec<String>,
    commercial: bool,
    explicit_commercial: Vec<String>,
}
#[derive(Deserialize)]
struct Presets {
    presets: Vec<Preset>,
}
fn presets() -> &'static Presets {
    static DATA: OnceLock<Presets> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../data/vn3-presets-v1.json"))
            .expect("versioned presets")
    })
}
pub fn preset_ids() -> Vec<&'static str> {
    presets().presets.iter().map(|p| p.id.as_str()).collect()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockingItem {
    pub product_id: String,
    pub item: Option<String>,
    pub term_key: Option<String>,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequiredCondition {
    pub product_id: String,
    pub item: String,
    pub condition: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UseDecision {
    pub decision: String,
    pub blocking_items: Vec<BlockingItem>,
    pub conditions: Vec<RequiredCondition>,
    pub advisories: Vec<BlockingItem>,
    pub has_special_note: bool,
    pub special_notes: Vec<SpecialNote>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductUseDecision {
    pub product_id: String,
    pub source_state: String,
    #[serde(flatten)]
    pub result: UseDecision,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UseCheck {
    pub schema_version: String,
    pub preset_id: String,
    pub products: Vec<ProductUseDecision>,
    pub matching_product_ids: Vec<String>,
    pub combination: UseDecision,
}
fn rank(value: &str) -> usize {
    match value {
        "nonconforming" => 3,
        "unknown" => 2,
        "contact_licensor" => 1,
        _ => 0,
    }
}
fn decision(notes: Vec<SpecialNote>) -> UseDecision {
    UseDecision {
        decision: "conforms".into(),
        blocking_items: Vec::new(),
        conditions: Vec::new(),
        advisories: Vec::new(),
        has_special_note: !notes.is_empty(),
        special_notes: notes,
    }
}
fn block(
    result: &mut UseDecision,
    product: &str,
    item: Option<&TermItem>,
    value: &str,
    reason: &str,
) {
    if rank(value) > rank(&result.decision) {
        result.decision = value.into();
    }
    result.blocking_items.push(BlockingItem {
        product_id: product.into(),
        item: item.map(|i| i.item.clone()),
        term_key: item.map(|i| i.term_key.clone()),
        reason: reason.into(),
    });
}
pub fn check_use(
    store: &BdlStore,
    preset: &str,
    ids: &[String],
) -> Result<UseCheck, BdlStoreError> {
    let preset = presets()
        .presets
        .iter()
        .find(|p| p.id == preset)
        .ok_or(BdlStoreError::InvalidObservation("preset"))?;
    let bulk = (ids.len() > 1)
        .then(|| product_details_for_ids(store, ids))
        .transpose()?;
    let mut products = Vec::new();
    let mut matching_product_ids = Vec::new();
    let mut combination = decision(Vec::new());
    for id in ids {
        let detail = match &bulk {
            Some(map) => map
                .get(id)
                .cloned()
                .unwrap_or_else(|| detail_from_product_terms(ProductTerms::not_observed(id))),
            None => product_detail(store, id)?,
        };
        let mut result = decision(detail.special_notes);
        if detail.product.state != "parsed" {
            block(&mut result, id, None, "unknown", &detail.product.state);
        }
        if detail.warnings.iter().any(|w| {
            w.item.as_deref() == Some("X")
                && [
                    "missing_item",
                    "unknown_heading",
                    "duplicate_item",
                    "summary_conflict",
                ]
                .contains(&w.code.as_str())
        }) {
            block(&mut result, id, None, "unknown", "special_note_unknown");
        }
        for required in &preset.items {
            let Some(item) = detail.effective_items.iter().find(|i| i.item == *required) else {
                block(&mut result, id, None, "unknown", "missing_item");
                continue;
            };
            match item.value.as_str() {
                "prohibited" => block(&mut result, id, Some(item), "nonconforming", "prohibited"),
                "unknown" => block(&mut result, id, Some(item), "unknown", "unknown_item"),
                "contact_licensor" => block(
                    &mut result,
                    id,
                    Some(item),
                    "contact_licensor",
                    "contact_licensor",
                ),
                "permitted" => {
                    if let Some(condition) = &item.condition {
                        result.conditions.push(RequiredCondition {
                            product_id: id.clone(),
                            item: item.item.clone(),
                            condition: condition.clone(),
                        });
                        if preset.commercial
                            && ["non_profit_only", "private_use_only"].contains(&condition.as_str())
                        {
                            block(
                                &mut result,
                                id,
                                Some(item),
                                "nonconforming",
                                "commercial_use_not_permitted",
                            );
                        }
                    }
                    if preset.explicit_commercial.contains(required)
                        && item.condition.as_deref() != Some("commercial_and_non_profit")
                    {
                        block(
                            &mut result,
                            id,
                            Some(item),
                            "unknown",
                            "commercial_permission_unknown",
                        );
                    }
                }
                _ => block(&mut result, id, Some(item), "unknown", "unknown_item"),
            }
        }
        for required in &preset.advisory_items {
            let item = detail.effective_items.iter().find(|i| i.item == *required);
            result.advisories.push(BlockingItem {
                product_id: id.clone(),
                item: Some(required.clone()),
                term_key: item.map(|i| i.term_key.clone()),
                reason: match item.map(|i| i.value.as_str()) {
                    Some("prohibited") => "modified_asset_distribution_prohibited",
                    Some("contact_licensor") => "modified_asset_distribution_contact_required",
                    Some("permitted") => "modified_asset_distribution_separate",
                    _ => "modified_asset_distribution_unknown",
                }
                .into(),
            });
        }
        if result.decision == "conforms" {
            matching_product_ids.push(id.clone());
        }
        if rank(&result.decision) > rank(&combination.decision) {
            combination.decision = result.decision.clone();
        }
        combination
            .blocking_items
            .extend(result.blocking_items.clone());
        combination.conditions.extend(result.conditions.clone());
        combination
            .special_notes
            .extend(result.special_notes.clone());
        combination.advisories.extend(result.advisories.clone());
        products.push(ProductUseDecision {
            product_id: id.clone(),
            source_state: detail.product.state,
            result,
        });
    }
    combination.has_special_note = !combination.special_notes.is_empty();
    Ok(UseCheck {
        schema_version: "0.1".into(),
        preset_id: preset.id.clone(),
        products,
        matching_product_ids,
        combination,
    })
}

pub fn valid_product_id(value: &str) -> bool {
    value.strip_prefix("booth:").is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 20
            && !s.starts_with('0')
            && s.bytes().all(|b| b.is_ascii_digit())
    })
}

pub fn owned_cache_root(root: &Path) -> PathBuf {
    root.join("terms")
}

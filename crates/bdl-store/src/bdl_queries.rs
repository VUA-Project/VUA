//! BDL read-model query vocabulary (frozen 2026-09-06 at v0.3; serving face
//! landed with W12, 2026-09-07; v0.4 additive downloads.listCompleted;
//! v0.5 additive dependencies.lookup/listByProduct, 2026-09-22).
//!
//! Rust anchor for `schemas/bdl-queries` (docs/protocols/bdl-queries-v0.5
//! current): the read-only operations, the wire three-state
//! LocalArtifact verdict, the catalog health vocabulary, the availability
//! derivation function and the catalog serving-face result types — the
//! executable form of the protocol's versioned rule table. The catalog face
//! assembles from the observation products table: until the observation
//! pipeline writes, the table is empty and the face answers the honest
//! empty state (list = empty set, status.health = unknown — 空态即终态).
//! Any vocabulary change must bump the schema version, never rewrite
//! in place.

use crate::bdl_store::ArtifactInspectionState;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The bdl-queries family ENVELOPE version constant. v0.5 (2026-09-22, the
/// core wiring batch riding the wt-5 freeze cb40bf1d): the additive
/// six→eight operation rise (`dependencies.lookup` /
/// `dependencies.listByProduct`); the six v0.4 methods keep their
/// params/fields/results identical — only the envelope schemaVersion rises
/// with the vocabulary. Both frozen schema files (query side and result
/// side) lock this ONE shared value — the family carries no per-result
/// version, so the dual-const law (envelope const + result family const)
/// collapses onto this single const stamped at the single envelope
/// assembly point. Consumers key on this core-owned constant, never a
/// private literal.
pub const BDL_QUERIES_SCHEMA_VERSION: &str = "0.6";

/// The five read-only operations. Transport envelopes belong to the
/// application contract; this enum pins the operation vocabulary only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BdlQueryOperation {
    #[serde(rename = "catalog.list")]
    CatalogList,
    #[serde(rename = "catalog.detail")]
    CatalogDetail,
    #[serde(rename = "catalog.status")]
    CatalogStatus,
    #[serde(rename = "warehouse.listEntries")]
    WarehouseListEntries,
    #[serde(rename = "warehouse.entryDetail")]
    WarehouseEntryDetail,
}

/// UI-facing LocalArtifact verdict (the wire three-state). The storage
/// lifecycle keeps its own four states; this mapping is the protocol's
/// presentation contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactInspectionVerdict {
    /// Storage `untrusted` (transfer done, not inspected) or `inspected`
    /// (mechanical checks passed, admission decision pending).
    Pending,
    /// Storage `admitted`.
    Clean,
    /// Storage `rejected` — always carries an honest rejection reason on
    /// the wire.
    Quarantined,
}

impl ArtifactInspectionVerdict {
    pub fn from_storage_state(state: ArtifactInspectionState) -> Self {
        match state {
            ArtifactInspectionState::Untrusted | ArtifactInspectionState::Inspected => {
                Self::Pending
            }
            ArtifactInspectionState::Admitted => Self::Clean,
            ArtifactInspectionState::Rejected => Self::Quarantined,
        }
    }
}

/// Catalog health, v0.2. `incompatible` is the BDL version fence rejecting
/// the store; `corrupted` and `stale` are renderer-reserved display states
/// that v0.2 never sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogHealth {
    Unknown,
    Ok,
    Incompatible,
}

/// The stable availability enum (v0.2 dual field): UI badges and filters
/// consume only this; the raw observed word rides along as
/// `availabilityRaw` evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AvailabilityStatus {
    Available,
    Unavailable,
    Unknown,
}

/// Derives `availabilityStatus` from the verbatim observed word, per the
/// v0.2 rule table in the protocol (last path segment, lowercased;
/// `https://schema.org/InStock` and `InStock` judge identically; everything
/// unrecognized or missing is unknown with the raw preserved by the caller).
pub fn availability_status(raw: Option<&str>) -> AvailabilityStatus {
    let Some(raw) = raw else {
        return AvailabilityStatus::Unknown;
    };
    let word = raw
        .rsplit('/')
        .next()
        .unwrap_or(raw)
        .trim()
        .to_ascii_lowercase();
    match word.as_str() {
        "instock" | "limitedavailability" | "instoreonly" => AvailabilityStatus::Available,
        "outofstock" | "soldout" | "discontinued" => AvailabilityStatus::Unavailable,
        _ => AvailabilityStatus::Unknown,
    }
}

// --- downloads serving-face types (v0.4; shape mirrors result.schema.json
//     $defs/downloadsListCompletedResult exactly — a field here that the
//     schema does not know is a contract break caught by the consumer
//     tests) ---

/// `downloads.listCompleted` row: one adoptable completed delivery. The
/// membership predicate is the SAME server-side fact the v0.4 adoption
/// guard consumes — event fold at a completed delivery with the staging
/// file physically present at the reported size — so the list is the
/// guard's mirror: what the UI shows is adoptable. Paths never appear in
/// the row (storedPath semantics stop at AMF/BDL).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedDownloadRow {
    pub download_id: String,
    pub source_url: String,
    pub suggested_file_name: Option<String>,
    pub received_bytes: u64,
    pub completed_at: String,
    /// Warehouse entries whose content rows carry this download
    /// correlation (`local_artifacts.download_id`); empty = not yet
    /// adopted. The write face does not prevent repeat adoption; the UI
    /// marks adopted downloads from this field.
    pub adopted_warehouse_item_ids: Vec<String>,
}

// --- catalog serving-face types (W12; shapes mirror result.schema.json
//     $defs exactly — a field here that the schema does not know is a
//     contract break caught by the consumer tests) ---

/// `price`: single-price products only; null = no price information (never
/// guessed, never converted). Variant prices live in subproducts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPrice {
    pub amount: String,
    pub currency: String,
    /// 多变体价区间上限;None = 单值商品。来自子品价格的最大值。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub high: Option<String>,
}

/// `catalog.list` entry (`productSummary`): `entityCount` is the honest
/// empty slot (constant 0) and `entityTypes` the constant empty list —
/// entity storage belongs to BDL v2.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProductSummary {
    pub product_id: String,
    pub title: Option<String>,
    /// BDL v0.3: which account library listed the product (null = unknown).
    pub library_type: Option<String>,
    /// N5 D2: local artifacts correlated to this product via
    /// artifact_mappings (download adoption writes them opportunistically);
    /// 0 = cloud-only, >0 = imported.
    pub imported_artifacts: u32,
    /// Library-row observed shop display name (null = unknown).
    pub shop_name: Option<String>,
    pub price: Option<CatalogPrice>,
    pub image_url: Option<String>,
    pub image_urls: Vec<String>,
    pub availability_raw: Option<String>,
    pub availability_status: AvailabilityStatus,
    pub entity_count: u32,
    pub entity_types: Vec<String>,
}

/// `catalog.detail` subproduct.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSubproduct {
    pub variation_id: Option<String>,
    pub name: Option<String>,
    pub price: Option<CatalogPrice>,
    pub availability_raw: Option<String>,
    pub availability_status: AvailabilityStatus,
}

/// `catalog.detail` entry (`productDetail`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProductDetail {
    pub product_id: String,
    pub title: Option<String>,
    pub price: Option<CatalogPrice>,
    pub image_url: Option<String>,
    pub image_urls: Vec<String>,
    pub availability_raw: Option<String>,
    pub availability_status: AvailabilityStatus,
    pub entity_count: u32,
    pub entity_types: Vec<String>,
    pub description: Option<String>,
    pub shop_name: Option<String>,
    pub shop_url: Option<String>,
    pub age_restriction: Option<String>,
    /// True only with the explicit BOOTH Adult badge.
    pub adult: bool,
    pub video_urls: Vec<String>,
    pub source_category: Option<String>,
    pub subproducts: Vec<CatalogSubproduct>,
    /// BDL v0.3: which account library listed the product (null = unknown).
    pub library_type: Option<String>,
    /// 商品页观察到的上架日期原文(null = 未观察)。
    pub source_published_at: Option<String>,
}

/// `catalog.list` result: `total` is computed after filtering, before
/// limit/offset.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogListResult {
    pub total: i64,
    pub entries: Vec<CatalogProductSummary>,
}

/// `catalog.detail` result.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDetailResult {
    pub product: CatalogProductDetail,
}

/// `catalog.status` revision block: `catalogUpdatedSeq` stays null until the
/// observation-pipeline bookkeeping counter exists; `datasetRevision` is the
/// BDL format_version.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRevision {
    pub catalog_updated_seq: Option<i64>,
    pub dataset_revision: String,
}

/// `catalog.status` result.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatusResult {
    pub health: CatalogHealth,
    pub revision: CatalogRevision,
}

/// Params violation for the catalog query closed set. The application face
/// maps these to its own validation codes; the assembly never answers a
/// request that violates the frozen closed set (never a silent empty answer).
#[derive(Debug, Clone, PartialEq)]
pub enum CatalogParamsError {
    /// A key outside `{ text, availabilityStatus, limit, offset }` — for
    /// example `entityType`/`relationKind`, whose presence is a contract
    /// error (entity storage belongs to BDL v2), never a silently empty
    /// answer.
    UnknownKey(String),
    /// A known key carrying an out-of-vocabulary or out-of-range value.
    InvalidValue { key: &'static str, reason: String },
}

impl std::fmt::Display for CatalogParamsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownKey(key) => write!(formatter, "unknown query key {key}"),
            Self::InvalidValue { key, reason } => {
                write!(formatter, "invalid {key}: {reason}")
            }
        }
    }
}

/// `catalog.list` closed set `{ text, availabilityStatus, limit, offset }`,
/// all optional. Defaults: limit 50 (1–200), offset 0. Explicit nulls mean
/// "no filtering". Unknown keys and out-of-vocabulary values are contract
/// errors, mirroring the schema's `additionalProperties: false` and enums.
#[derive(Debug, Clone, PartialEq)]
pub struct CatalogListParams {
    pub text: Option<String>,
    pub availability_status: Option<AvailabilityStatus>,
    /// BDL v0.3: bought | gifts | free_downloads; None = no filter.
    pub library_type: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

impl Default for CatalogListParams {
    fn default() -> Self {
        Self { text: None, availability_status: None, library_type: None, limit: 50, offset: 0 }
    }
}

impl CatalogListParams {
    pub fn from_value(value: &Value) -> Result<Self, CatalogParamsError> {
        const KEYS: [&str; 5] = ["text", "availabilityStatus", "libraryType", "limit", "offset"];
        let object = value
            .as_object()
            .ok_or(CatalogParamsError::InvalidValue {
                key: "params",
                reason: "expected an object".into(),
            })?;
        for key in object.keys() {
            if !KEYS.contains(&key.as_str()) {
                return Err(CatalogParamsError::UnknownKey(key.clone()));
            }
        }
        let text = match object.get("text") {
            None | Some(Value::Null) => None,
            Some(Value::String(raw)) if raw.is_empty() => {
                return Err(CatalogParamsError::InvalidValue {
                    key: "text",
                    reason: "minLength 1".into(),
                });
            }
            Some(Value::String(raw)) => Some(raw.clone()),
            Some(_) => {
                return Err(CatalogParamsError::InvalidValue {
                    key: "text",
                    reason: "expected a string or null".into(),
                });
            }
        };
        let availability_status = match object.get("availabilityStatus") {
            None | Some(Value::Null) => None,
            Some(Value::String(raw)) => {
                let parsed = serde_json::from_value::<AvailabilityStatus>(
                    Value::String(raw.clone()),
                )
                .map_err(|_| CatalogParamsError::InvalidValue {
                    key: "availabilityStatus",
                    reason: format!("{raw} is outside the stable enum"),
                })?;
                Some(parsed)
            }
            Some(_) => {
                return Err(CatalogParamsError::InvalidValue {
                    key: "availabilityStatus",
                    reason: "expected a string or null".into(),
                });
            }
        };
        let limit = match object.get("limit") {
            None => 50,
            Some(Value::Number(raw)) => {
                let raw = raw.as_i64().ok_or(CatalogParamsError::InvalidValue {
                    key: "limit",
                    reason: "expected an integer".into(),
                })?;
                if !(1..=200).contains(&raw) {
                    return Err(CatalogParamsError::InvalidValue {
                        key: "limit",
                        reason: "out of range 1–200".into(),
                    });
                }
                raw
            }
            Some(_) => {
                return Err(CatalogParamsError::InvalidValue {
                    key: "limit",
                    reason: "expected an integer".into(),
                });
            }
        };
        let offset = match object.get("offset") {
            None => 0,
            Some(Value::Number(raw)) => {
                let raw = raw.as_i64().ok_or(CatalogParamsError::InvalidValue {
                    key: "offset",
                    reason: "expected an integer".into(),
                })?;
                if raw < 0 {
                    return Err(CatalogParamsError::InvalidValue {
                        key: "offset",
                        reason: "must not be negative".into(),
                    });
                }
                raw
            }
            Some(_) => {
                return Err(CatalogParamsError::InvalidValue {
                    key: "offset",
                    reason: "expected an integer".into(),
                });
            }
        };
        // BDL v0.3: libraryType 闭集(bought|gifts|free_downloads);空串/null 无筛选
        let library_type = match object.get("libraryType") {
            None | Some(Value::Null) => None,
            Some(Value::String(raw)) if raw.is_empty() => None,
            Some(Value::String(raw))
                if matches!(raw.as_str(), "bought" | "gifts" | "free_downloads") =>
            {
                Some(raw.clone())
            }
            Some(_) => {
                return Err(CatalogParamsError::InvalidValue {
                    key: "libraryType",
                    reason: "must be bought|gifts|free_downloads".into(),
                });
            }
        };
        Ok(Self { text, availability_status, library_type, limit, offset })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../schemas/bdl-queries/v0.3")
    }

    #[test]
    fn operation_enum_matches_the_frozen_schema_vocabulary() {
        let bytes = std::fs::read(schema_dir().join("query.schema.json")).unwrap();
        let schema: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let schema_operations = schema["properties"]["operation"]["enum"].as_array().unwrap();
        let rust_operations = [
            BdlQueryOperation::CatalogList,
            BdlQueryOperation::CatalogDetail,
            BdlQueryOperation::CatalogStatus,
            BdlQueryOperation::WarehouseListEntries,
            BdlQueryOperation::WarehouseEntryDetail,
        ]
        .map(|operation| serde_json::to_value(operation).unwrap());
        assert_eq!(schema_operations, &rust_operations);
    }

    #[test]
    fn catalog_list_params_reject_out_of_closed_set_keys_and_values() {
        // entityType is deliberately absent from the v0.3 closed set — its
        // presence is a contract error, never a silently empty answer.
        let entity = serde_json::json!({ "text": null, "entityType": "avatar" });
        assert!(matches!(
            CatalogListParams::from_value(&entity),
            Err(CatalogParamsError::UnknownKey(key)) if key == "entityType"
        ));
        // A mode word outside the stable availability enum is a value error.
        let availability = serde_json::json!({ "text": null, "availabilityStatus": "in stock" });
        assert!(matches!(
            CatalogListParams::from_value(&availability),
            Err(CatalogParamsError::InvalidValue { key: "availabilityStatus", .. })
        ));
        // Range violations.
        let limit = serde_json::json!({ "limit": 201 });
        assert!(matches!(
            CatalogListParams::from_value(&limit),
            Err(CatalogParamsError::InvalidValue { key: "limit", .. })
        ));
        let offset = serde_json::json!({ "offset": -1 });
        assert!(matches!(
            CatalogListParams::from_value(&offset),
            Err(CatalogParamsError::InvalidValue { key: "offset", .. })
        ));
        let empty_text = serde_json::json!({ "text": "" });
        assert!(matches!(
            CatalogListParams::from_value(&empty_text),
            Err(CatalogParamsError::InvalidValue { key: "text", .. })
        ));
    }

    #[test]
    fn catalog_list_params_parse_the_positive_vector_shape() {
        // The frozen positive vector's explicit nulls mean "no filtering".
        let vector = serde_json::json!({
            "text": "uniform", "limit": 50, "offset": 0, "availabilityStatus": null
        });
        let params = CatalogListParams::from_value(&vector).unwrap();
        assert_eq!(params.text.as_deref(), Some("uniform"));
        assert_eq!(params.availability_status, None);
        assert_eq!(params.limit, 50);
        assert_eq!(params.offset, 0);
        // Defaults fill the omitted keys.
        let defaults = CatalogListParams::from_value(&serde_json::json!({})).unwrap();
        assert_eq!(defaults, CatalogListParams::default());
    }

    #[test]
    fn wire_verdict_and_health_serialize_to_the_stable_names() {
        assert_eq!(
            serde_json::to_value(ArtifactInspectionVerdict::from_storage_state(
                ArtifactInspectionState::Inspected
            ))
            .unwrap(),
            "pending"
        );
        assert_eq!(
            serde_json::to_value(ArtifactInspectionVerdict::from_storage_state(
                ArtifactInspectionState::Rejected
            ))
            .unwrap(),
            "quarantined"
        );
        assert_eq!(
            serde_json::to_value(CatalogHealth::Incompatible).unwrap(),
            "incompatible"
        );
    }

    #[test]
    fn availability_derivation_matches_the_v0_2_rule_table() {
        use AvailabilityStatus::*;
        // The whole rule table, including the URL-normalized forms.
        assert_eq!(availability_status(Some("InStock")), Available);
        assert_eq!(
            availability_status(Some("https://schema.org/InStock")),
            Available
        );
        assert_eq!(
            availability_status(Some("https://schema.org/LimitedAvailability")),
            Available
        );
        assert_eq!(availability_status(Some("SoldOut")), Unavailable);
        assert_eq!(
            availability_status(Some("https://schema.org/OutOfStock")),
            Unavailable
        );
        assert_eq!(availability_status(Some("Discontinued")), Unavailable);
        // Unrecognized words and absence stay honest unknowns.
        assert_eq!(availability_status(Some("PreOrder")), Unknown);
        assert_eq!(
            availability_status(Some("https://example.com/whatever")),
            Unknown
        );
        assert_eq!(availability_status(None), Unknown);
    }
}

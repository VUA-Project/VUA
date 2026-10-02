//! BDL local database (v0.2) — the acquisition-pipeline persistence surface.
//!
//! BDL is an AMF-private local module (docs/architecture/bdl.md): AMF
//! decides what is persisted, BDL stores it. This store owns the B4
//! acquisition tables (download_events / local_artifacts / artifact_mappings)
//! with the durability discipline of the task store (WAL, synchronous FULL,
//! versioned migration). The observation products table is served by the
//! W17 write side (`record_product_observation`): the observation pipeline
//! (G13, a future slice) is the intended caller — until it exists the
//! catalog face keeps answering the honest empty state. The store only
//! enforces that artifact mappings reference OBSERVED products — the foreign
//! key rejects every unobserved target, which is the boundary itself.
//!
//! BDL persistent format v0.2 (collab/proposals/030; frozen wt-4 batch 166,
//! landed by this store in batch 168): the store executes the migration chain
//! (v0.1 `001_initial.sql` + `002_dependency_observations.sql`), so fresh
//! databases are born v0.2 and existing v0.1 databases migrate on open with
//! verbatim row carry-over; `dependency_observations` (the product-dependency
//! observation face) is served by `record_dependency_observation` /
//! `dependency_observations` plus the one explicit human confirmation write
//! action `confirm_dependency_resolution` — the only writer of
//! `confirmed_by_human = 1`. The frozen schema files are the single law
//! authority for the new table's closed sets and hard laws: the store carries
//! their members verbatim and lets the REAL SQLite CHECK/NOT NULL/FK
//! constraints reject every foreign or lawless value.
//!
//! Inspection facts are idempotent per content (`artifact_sha256`);
//! re-downloading the same content never duplicates a row (warehouse-layout
//! ruling 2). Event ingestion is deduped on
//! (download_id, attempt, kind, occurred_at) because the port delivers
//! at-least-once.

use crate::bdl_queries::{
    availability_status, CatalogDetailResult, CatalogHealth, CatalogListParams, CatalogListResult,
    CatalogPrice, CatalogProductDetail, CatalogProductSummary, CatalogRevision,
    CatalogStatusResult, CatalogSubproduct, CompletedDownloadRow,
};
use crate::bdl_queries::ArtifactInspectionVerdict;
use crate::download_events::{DownloadEventKind, DownloadEventV01, DownloadFailureKind};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const BDL_FORMAT_VERSION: &str = "0.3";
const BDL_MIGRATION_VERSION: i64 = 3;
const MIGRATION_001: &str = include_str!("../../../schemas/bdl/v0.1/001_initial.sql");
const MIGRATION_002: &str = include_str!("../../../schemas/bdl/v0.2/002_dependency_observations.sql");
const MIGRATION_003: &str = include_str!("../../../schemas/bdl/v0.3/003_library_type.sql");

#[derive(Debug)]
pub enum BdlStoreError {
    Database(rusqlite::Error),
    Json(serde_json::Error),
    UnsupportedFormat(String),
    InvalidEvent(&'static str),
    InvalidObservation(&'static str),
    UnknownArtifact(String),
    UnknownProduct(String),
    UnknownWarehouseItem(String),
    UnknownDependencyObservation(i64),
    InvalidResolution(&'static str),
    InvalidTransition {
        artifact_sha256: String,
        from: ArtifactInspectionState,
        to: ArtifactInspectionState,
    },
    CorruptValue {
        field: &'static str,
        value: String,
    },
}

impl std::fmt::Display for BdlStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Database(error) => write!(formatter, "BDL store failed: {error}"),
            Self::Json(error) => write!(formatter, "BDL store JSON failed: {error}"),
            Self::UnsupportedFormat(version) => {
                write!(formatter, "unsupported BDL format {version}")
            }
            Self::InvalidEvent(reason) => write!(formatter, "invalid download event: {reason}"),
            Self::InvalidObservation(reason) => {
                write!(formatter, "invalid product observation: {reason}")
            }
            Self::UnknownArtifact(artifact) => {
                write!(formatter, "unknown local artifact {artifact}")
            }
            Self::UnknownProduct(product) => write!(
                formatter,
                "artifact mapping target {product} was never observed by the pipeline"
            ),
            Self::UnknownWarehouseItem(item) => {
                write!(formatter, "unknown warehouse item {item}")
            }
            Self::UnknownDependencyObservation(observation_id) => {
                write!(formatter, "unknown dependency observation {observation_id}")
            }
            Self::InvalidResolution(reason) => {
                write!(formatter, "invalid dependency resolution: {reason}")
            }
            Self::InvalidTransition {
                artifact_sha256,
                from,
                to,
            } => write!(
                formatter,
                "artifact {artifact_sha256} cannot transition from {from} to {to}"
            ),
            Self::CorruptValue { field, value } => {
                write!(formatter, "invalid persisted {field}: {value}")
            }
        }
    }
}

impl std::error::Error for BdlStoreError {}

impl From<rusqlite::Error> for BdlStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Database(error)
    }
}

impl From<serde_json::Error> for BdlStoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

/// LocalArtifact inspection lifecycle. Mechanical checks (size/type/digest)
/// move untrusted → inspected; AMF's source/context decision moves
/// inspected → admitted. Any check failure rejects; rejected is terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactInspectionState {
    Untrusted,
    Inspected,
    Admitted,
    Rejected,
}

impl ArtifactInspectionState {
    fn name(self) -> &'static str {
        match self {
            Self::Untrusted => "untrusted",
            Self::Inspected => "inspected",
            Self::Admitted => "admitted",
            Self::Rejected => "rejected",
        }
    }

    fn parse(value: &str) -> Result<Self, BdlStoreError> {
        match value {
            "untrusted" => Ok(Self::Untrusted),
            "inspected" => Ok(Self::Inspected),
            "admitted" => Ok(Self::Admitted),
            "rejected" => Ok(Self::Rejected),
            _ => Err(BdlStoreError::CorruptValue {
                field: "artifact inspection state",
                value: value.into(),
            }),
        }
    }

    fn can_transition(self, to: Self) -> bool {
        matches!(
            (self, to),
            (Self::Untrusted, Self::Inspected)
                | (Self::Untrusted, Self::Rejected)
                | (Self::Inspected, Self::Admitted)
                | (Self::Inspected, Self::Rejected)
        )
    }
}

impl std::fmt::Display for ArtifactInspectionState {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.name())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredDownloadEvent {
    pub event_id: i64,
    pub download_id: String,
    pub attempt: u32,
    pub kind: DownloadEventKind,
    pub source_url: String,
    pub initiated_from_page_url: Option<String>,
    pub url_chain: Option<Vec<String>>,
    pub suggested_file_name: Option<String>,
    pub stored_path: Option<String>,
    pub expected_bytes: Option<u64>,
    pub received_bytes: Option<u64>,
    pub resumable: bool,
    pub failure_kind: Option<DownloadFailureKind>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StoredArtifact {
    pub artifact_sha256: String,
    pub size_bytes: u64,
    pub suggested_file_name: Option<String>,
    pub inspection_state: ArtifactInspectionState,
    pub rejection_reason: Option<String>,
    pub inspected_at: Option<String>,
    pub download_id: Option<String>,
    pub first_seen_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewLocalArtifact {
    pub artifact_sha256: String,
    pub size_bytes: u64,
    pub suggested_file_name: Option<String>,
    pub download_id: Option<String>,
    pub first_seen_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventAppendence {
    Inserted,
    Duplicate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactRecordingOutcome {
    Created,
    Existing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactMappingOutcome {
    Created,
    Existing,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArtifactRecording {
    pub outcome: ArtifactRecordingOutcome,
    pub artifact: StoredArtifact,
}

/// The per-entry artifact-mode override (bdl-queries v0.3). Absent = the
/// entry follows the shell-level global default, resolved dynamically at
/// read time. A consumption preference — never a generation trigger, never
/// a statement that a VPM exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactMode {
    UseOriginalUnitypackage,
    GenerateVpm,
}

impl ArtifactMode {
    pub fn name(self) -> &'static str {
        match self {
            Self::UseOriginalUnitypackage => "use_original_unitypackage",
            Self::GenerateVpm => "generate_vpm",
        }
    }

    pub fn parse(value: &str) -> Result<Self, BdlStoreError> {
        match value {
            "use_original_unitypackage" => Ok(Self::UseOriginalUnitypackage),
            "generate_vpm" => Ok(Self::GenerateVpm),
            _ => Err(BdlStoreError::CorruptValue {
                field: "artifact mode",
                value: value.into(),
            }),
        }
    }
}

/// Role of a physical copy inside an entry: the material original, or a
/// generated VPM package (siblings per warehouse-layout ruling 5). The
/// delete-originals flow removes original rows and keeps generated_vpm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CopyRole {
    Original,
    GeneratedVpm,
}

impl CopyRole {
    pub fn name(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::GeneratedVpm => "generated_vpm",
        }
    }

    pub fn parse(value: &str) -> Result<Self, BdlStoreError> {
        match value {
            "original" => Ok(Self::Original),
            "generated_vpm" => Ok(Self::GeneratedVpm),
            _ => Err(BdlStoreError::CorruptValue {
                field: "artifact copy role",
                value: value.into(),
            }),
        }
    }
}

/// The two legal entry kinds (bdl-queries v0.3 closed vocabulary).
pub const WAREHOUSE_ITEM_KINDS: [&str; 2] = ["imported_material", "downloaded_material"];

/// One observed subproduct inside a `ProductObservation`: the BOOTH
/// variation facts as observed (availability is the verbatim word, the
/// stable enum is derived by the read face per the versioned rule table —
/// never stored).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubproductObservation {
    pub variation_id: Option<String>,
    pub name: Option<String>,
    pub price_amount: Option<String>,
    pub price_currency: Option<String>,
    pub availability: Option<String>,
}

/// The page-observation status closed set. `missing` is the tombstone
/// (404/410 keepsake): the row stays, the catalog never serves it as a
/// card, and nothing ever deletes it physically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductObservationStatus {
    Complete,
    Missing,
}

impl ProductObservationStatus {
    pub fn name(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Missing => "missing",
        }
    }
}

/// One observation-pipeline row for the products table (boundary IN-1).
/// Field semantics are the v0.1 schema's: availability/age/price carry
/// observed facts only; `adult` is true only with the explicit BOOTH Adult
/// badge; `missing_fields` is the honest extraction-gap list;
/// `content_hash` is content-addressed observation evidence and
/// `observed_at` the pipeline observation time (never a BOOTH publish
/// time). Presentation fields flow to the catalog face verbatim — the
/// derivations (availabilityStatus, imageUrl = imageUrls[0]) happen at
/// read time, per the versioned rule tables.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductObservation {
    /// Corpus identity `booth:<native_product_id>` — both parts must agree
    /// (the store rejects a mismatched pair).
    pub product_id: String,
    pub native_product_id: String,
    /// Which account library listed the product (BDL v0.3):
    /// bought | gifts | free_downloads; None = not library-derived.
    pub library_type: Option<String>,
    pub source_url: String,
    pub final_url: Option<String>,
    pub status: ProductObservationStatus,
    pub source_locale: Option<String>,
    pub source_category: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub age_restriction: Option<String>,
    pub adult: bool,
    /// Verbatim observed word (JSON-LD offers.availability); the stable
    /// enum is derived per the v0.2 rule table, never stored.
    pub availability: Option<String>,
    /// Single-price products only; amount and currency are admitted or
    /// rejected as a pair (one without the other is a violation).
    pub price_amount: Option<String>,
    pub price_currency: Option<String>,
    pub shop_name: Option<String>,
    pub shop_url: Option<String>,
    pub image_urls: Vec<String>,
    pub video_urls: Vec<String>,
    pub subproducts: Vec<SubproductObservation>,
    pub source_published_at: Option<String>,
    /// `sha256:<hex>` of the observed HTML.
    pub content_hash: String,
    /// Pipeline observation time (RFC 3339 string), never a BOOTH publish
    /// time.
    pub observed_at: String,
    pub run_id: Option<String>,
    pub processor_version: String,
    /// Honest extraction gaps, carried verbatim.
    pub missing_fields: Vec<String>,
}

/// Validates one observation against the write-face closed sets: corpus
/// identity (`booth:<digits>` with both parts agreeing), the status
/// vocabulary, the content-hash shape, required evidence fields, and the
/// price-pair rule (amount and currency admitted or rejected together).
fn validate_product_observation(
    observation: &ProductObservation,
) -> Result<(), BdlStoreError> {
    if let Some(library_type) = &observation.library_type {
        if !matches!(
            library_type.as_str(),
            "bought" | "gifts" | "free_downloads"
        ) {
            return Err(BdlStoreError::InvalidObservation(
                "library_type must be bought|gifts|free_downloads or null",
            ));
        }
    }
    let expected_product_id = format!("booth:{}", observation.native_product_id);
    if observation.product_id != expected_product_id
        || !observation
            .native_product_id
            .chars()
            .all(|character| character.is_ascii_digit())
        || observation.native_product_id.is_empty()
    {
        return Err(BdlStoreError::InvalidObservation(
            "product identity must be booth:<native digits> with both parts agreeing",
        ));
    }
    if observation.source_url.trim().is_empty() {
        return Err(BdlStoreError::InvalidObservation("source url"));
    }
    let hash_ok = observation.content_hash.split_once(':').is_some_and(
        |(algorithm, digest)| {
            algorithm == "sha256"
                && digest.len() == 64
                && digest.chars().all(|character| character.is_ascii_hexdigit())
        },
    );
    if !hash_ok {
        return Err(BdlStoreError::InvalidObservation(
            "content hash must be sha256:<64 hex>",
        ));
    }
    if observation.observed_at.trim().is_empty()
        || observation.processor_version.trim().is_empty()
    {
        return Err(BdlStoreError::InvalidObservation(
            "observed_at and processor_version are required evidence",
        ));
    }
    if observation.price_amount.is_some() != observation.price_currency.is_some() {
        return Err(BdlStoreError::InvalidObservation(
            "price amount and currency are admitted or rejected as a pair",
        ));
    }
    for subproduct in &observation.subproducts {
        if subproduct.price_amount.is_some() != subproduct.price_currency.is_some() {
            return Err(BdlStoreError::InvalidObservation(
                "subproduct price amount and currency are admitted or rejected as a pair",
            ));
        }
    }
    Ok(())
}

/// The v0.1 search projection: body + title + shop + subproduct names,
/// lowercased (IN-5 query support column; the v0.3 catalog text filter
/// itself stays title+productId per the protocol).
fn normalized_search_text(observation: &ProductObservation) -> String {
    let mut parts = Vec::new();
    if let Some(title) = &observation.title {
        parts.push(title.as_str());
    }
    if let Some(description) = &observation.description {
        parts.push(description.as_str());
    }
    if let Some(shop_name) = &observation.shop_name {
        parts.push(shop_name.as_str());
    }
    for subproduct in &observation.subproducts {
        if let Some(name) = &subproduct.name {
            parts.push(name.as_str());
        }
    }
    parts.join(" ").to_lowercase()
}

/// Parses a JSON-array text column. The write face always persists a JSON
/// array; `NULL` (pre-write-face rows, e.g. seeds) is the honest empty
/// list. Anything else non-null that does not parse is a corrupt value.
fn parse_json_array_text(
    field: &'static str,
    raw: Option<String>,
) -> Result<serde_json::Value, BdlStoreError> {
    match raw {
        None => Ok(serde_json::Value::Array(Vec::new())),
        Some(text) => serde_json::from_str(&text).map_err(|_| BdlStoreError::CorruptValue {
            field,
            value: text,
        }),
    }
}

/// One element of the FROZEN resolution-evidence shape
/// (docs/protocols/bdl-dependency-observations-v0.2:
/// `{"linkText","linkUrl","span","note"}`). The shape is carried by this
/// type: the store persists exactly these four keys and reads evidence back
/// through it, so a stored value that does not parse into it is a corrupt
/// value, never silently reshaped. Members are carried verbatim (the
/// observing paradigm — no rewriting); the `span` word face is the schema's
/// source_span set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DependencyResolutionEvidence {
    pub link_text: String,
    pub link_url: String,
    pub span: String,
    pub note: Option<String>,
}

/// One declared-dependency observation to land (a dependency_observations
/// row, BDL persistent format v0.2). Observation paradigm: the row is
/// EVIDENCE, never a fact claim. `dep_kind`/`source_span`/`extraction_method`
/// carry their FROZEN closed-set members verbatim and the schema's CHECK
/// constraints are the single law that refuses foreign members (the store
/// keeps no duplicate Rust closed set; a violation surfaces as
/// `BdlStoreError::Database`). `confirmed_by_human` is deliberately NOT a
/// field: rows land unconfirmed (DEFAULT 0 — a clue, never a suggestion),
/// and only the explicit confirmation write action
/// (`confirm_dependency_resolution`) ever sets 1.
#[derive(Debug, Clone, PartialEq)]
pub struct NewDependencyObservation {
    pub product_id: String,
    pub dep_kind: String,
    /// The dependency's name AS WRITTEN ('lilToon') — no normalization, no
    /// equivalence guessing.
    pub dep_name: String,
    /// Verbatim quote — no semantic rewriting.
    pub raw_quote: String,
    pub source_span: String,
    /// The version string AS WRITTEN ('2.3.2~'); carries ALL version
    /// constraints (engine/SDK pins included, per the frozen dep_kind
    /// ruling).
    pub version_hint: Option<String>,
    /// A resolution CLUE: the store persists it only as the schema admits
    /// it (an FK into observed products; the CHECK demands evidence) — it
    /// stays unconfirmed until the confirmation action.
    pub resolved_ref_product_id: Option<String>,
    /// Serialized to the frozen JSON shape. An empty slice persists NULL —
    /// no evidence is no evidence — so a resolved reference without
    /// evidence is refused by the schema's CHECK hard law itself, not by a
    /// Rust copy of it.
    pub resolution_evidence: Vec<DependencyResolutionEvidence>,
    pub extraction_method: String,
    pub extracted_by: String,
    /// Pipeline observation time (RFC 3339 string), never a BOOTH publish
    /// time.
    pub observed_at: String,
    pub processor_version: String,
    /// sha256 of the observed page the quote came from; nullable when the
    /// quote is carried across observations.
    pub content_hash: Option<String>,
    pub run_id: Option<String>,
}

/// One stored dependency_observations row as the read face returns it.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredDependencyObservation {
    pub observation_id: i64,
    pub product_id: String,
    pub dep_kind: String,
    pub dep_name: String,
    pub raw_quote: String,
    pub source_span: String,
    pub version_hint: Option<String>,
    pub resolved_ref_product_id: Option<String>,
    /// Parsed from the stored JSON text; `None` = no evidence stored.
    pub resolution_evidence: Option<Vec<DependencyResolutionEvidence>>,
    /// Strictly the stored 0/1 flag (CHECK-enforced); `true` only through
    /// the explicit confirmation write action.
    pub confirmed_by_human: bool,
    pub extraction_method: String,
    pub extracted_by: String,
    pub observed_at: String,
    pub processor_version: String,
    pub content_hash: Option<String>,
    pub run_id: Option<String>,
}

/// One products row as the dependencies read face consumes it (the
/// v0.5 dependencies.* implementing executor; see
/// `BdlStore::dependency_product_row`). Fields are the verbatim observed
/// columns — the store derives nothing here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DependencyProductRow {
    pub product_id: String,
    /// The CHECK closed set `complete|missing`, verbatim.
    pub status: String,
    pub title: Option<String>,
    /// The verbatim observed availability word (the dual-field law's raw).
    pub availability: Option<String>,
    /// The observed page URL — the advisory rule v1 installSource
    /// derivation reads the RESOLUTION TARGET's host from it.
    pub source_url: Option<String>,
}

/// Serializes the frozen evidence shape to its JSON text form; an empty
/// slice is no evidence and persists NULL, so the schema's CHECK hard law
/// (resolved implies evidence) stays the single authority that refuses a
/// bare resolution.
fn serialize_resolution_evidence(
    evidence: &[DependencyResolutionEvidence],
) -> Result<Option<String>, BdlStoreError> {
    if evidence.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(evidence)
        .map(Some)
        .map_err(BdlStoreError::Json)
}

/// Parses the stored evidence JSON text back into the frozen shape;
/// anything that does not parse is a corrupt value.
fn parse_resolution_evidence(
    raw: Option<String>,
) -> Result<Option<Vec<DependencyResolutionEvidence>>, BdlStoreError> {
    match raw {
        None => Ok(None),
        Some(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|_| BdlStoreError::CorruptValue {
                field: "resolution_evidence",
                value: text,
            }),
    }
}

/// One observed products row as read for `catalog.list` — the minimal
/// projection of the card face.
struct ObservedCard {
    product_id: String,
    title: Option<String>,
    price_amount: Option<String>,
    price_currency: Option<String>,
    image_urls: Option<String>,
    availability: Option<String>,
    library_type: Option<String>,
    imported_artifacts: i64,
    shop_name: Option<String>,
}

impl ObservedCard {
    /// The price is admitted only as a pair; a stored row with exactly one
    /// half is a corrupt value (the write face rejects it upstream).
    fn as_price(&self) -> Result<Option<CatalogPrice>, BdlStoreError> {
        match (&self.price_amount, &self.price_currency) {
            (Some(amount), Some(currency)) => {
                Ok(Some(CatalogPrice { amount: amount.clone(), currency: currency.clone() }))
            }
            (None, None) => Ok(None),
            _ => Err(BdlStoreError::CorruptValue {
                field: "price pair",
                value: self.product_id.clone(),
            }),
        }
    }

    fn as_summary(&self) -> Result<CatalogProductSummary, BdlStoreError> {
        let image_urls_value = parse_json_array_text("image_urls", self.image_urls.clone())?;
        let image_urls: Vec<String> = serde_json::from_value(image_urls_value)
            .map_err(|_| BdlStoreError::CorruptValue {
                field: "image_urls",
                value: self.product_id.clone(),
            })?;
        Ok(CatalogProductSummary {
            product_id: self.product_id.clone(),
            title: self.title.clone(),
            library_type: self.library_type.clone(),
            imported_artifacts: self.imported_artifacts.max(0) as u32,
            shop_name: self.shop_name.clone(),
            price: self.as_price()?,
            image_url: image_urls.first().cloned(),
            availability_raw: self.availability.clone(),
            availability_status: availability_status(self.availability.as_deref()),
            image_urls,
            entity_count: 0,
            entity_types: Vec::new(),
        })
    }
}

/// One observed products row as read for `catalog.detail` — the full
/// presentation projection.
struct ObservedDetail {
    title: Option<String>,
    price_amount: Option<String>,
    price_currency: Option<String>,
    image_urls: Option<String>,
    availability: Option<String>,
    description: Option<String>,
    shop_name: Option<String>,
    shop_url: Option<String>,
    library_type: Option<String>,
    source_published_at: Option<String>,
    age_restriction: Option<String>,
    adult: bool,
    video_urls: Option<String>,
    source_category: Option<String>,
    subproducts: Option<String>,
}

impl ObservedDetail {
    fn as_detail(&self, product_id: &str) -> Result<CatalogDetailResult, BdlStoreError> {
        let image_urls_value = parse_json_array_text("image_urls", self.image_urls.clone())?;
        let image_urls: Vec<String> = serde_json::from_value(image_urls_value)
            .map_err(|_| BdlStoreError::CorruptValue {
                field: "image_urls",
                value: product_id.to_owned(),
            })?;
        let video_urls_value = parse_json_array_text("video_urls", self.video_urls.clone())?;
        let video_urls: Vec<String> = serde_json::from_value(video_urls_value)
            .map_err(|_| BdlStoreError::CorruptValue {
                field: "video_urls",
                value: product_id.to_owned(),
            })?;
        let subproducts_value =
            parse_json_array_text("subproducts", self.subproducts.clone())?;
        let subproducts = subproducts_value
            .as_array()
            .ok_or(BdlStoreError::CorruptValue {
                field: "subproducts",
                value: product_id.to_owned(),
            })?
            .iter()
            .map(|subproduct| {
                let price = match (
                    subproduct.get("price_amount").and_then(Value::as_str),
                    subproduct.get("price_currency").and_then(Value::as_str),
                ) {
                    (Some(amount), Some(currency)) => Some(CatalogPrice {
                        amount: amount.to_owned(),
                        currency: currency.to_owned(),
                    }),
                    (None, None) => None,
                    _ => {
                        return Err(BdlStoreError::CorruptValue {
                            field: "subproduct price pair",
                            value: product_id.to_owned(),
                        })
                    }
                };
                let availability =
                    subproduct.get("availability").and_then(Value::as_str);
                Ok(CatalogSubproduct {
                    variation_id: subproduct
                        .get("variation_id")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    name: subproduct.get("name").and_then(Value::as_str).map(str::to_owned),
                    price,
                    availability_raw: availability.map(str::to_owned),
                    availability_status: availability_status(availability),
                })
            })
            .collect::<Result<Vec<_>, BdlStoreError>>()?;
        let price = match (&self.price_amount, &self.price_currency) {
            (Some(amount), Some(currency)) => Some(CatalogPrice {
                amount: amount.clone(),
                currency: currency.clone(),
            }),
            (None, None) => None,
            _ => {
                return Err(BdlStoreError::CorruptValue {
                    field: "price pair",
                    value: product_id.to_owned(),
                })
            }
        };
        Ok(CatalogDetailResult {
            product: CatalogProductDetail {
                product_id: product_id.to_owned(),
                library_type: self.library_type.clone(),
                source_published_at: self.source_published_at.clone(),
                title: self.title.clone(),
                price,
                image_url: image_urls.first().cloned(),
                availability_raw: self.availability.clone(),
                availability_status: availability_status(self.availability.as_deref()),
                image_urls,
                entity_count: 0,
                entity_types: Vec::new(),
                description: self.description.clone(),
                shop_name: self.shop_name.clone(),
                shop_url: self.shop_url.clone(),
                age_restriction: self.age_restriction.clone(),
                adult: self.adult,
                video_urls,
                source_category: self.source_category.clone(),
                subproducts,
            },
        })
    }
}

/// One material-package entry (warehouse_items row). The folder name is the
/// entry's VUA-generated local identity.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWarehouseItem {
    pub warehouse_item_id: String,
    pub display_name: String,
    pub folder_name: String,
    pub kind: String,
    pub artifact_mode: Option<String>,
    pub created_at: String,
}

/// One physical copy of an artifact inside an entry (artifact_copies row).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredArtifactCopy {
    pub copy_id: String,
    pub warehouse_item_id: String,
    pub artifact_sha256: String,
    pub relative_path: String,
    pub stored_path: String,
    pub role: CopyRole,
    pub created_at: String,
}

/// `warehouse.listEntries` card (bdl-queries v0.3 wire shape).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseEntryCard {
    pub warehouse_item_id: String,
    pub folder_name: String,
    pub display_name: String,
    pub kind: String,
    /// Per-entry override; null = follows the global default.
    pub artifact_mode: Option<ArtifactMode>,
    /// Dynamically resolved: override ?? the injected global default.
    pub effective_artifact_mode: ArtifactMode,
    pub created_at: String,
    pub artifacts: Vec<WarehouseArtifactRef>,
}

/// Light artifact reference on an entry card.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseArtifactRef {
    pub relative_path: String,
    pub artifact_sha256: String,
    pub state: ArtifactInspectionVerdict,
    pub size_bytes: u64,
    pub role: CopyRole,
}

/// `warehouse.entryDetail` payload (bdl-queries v0.3 wire shape).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseEntryDetail {
    pub warehouse_item_id: String,
    pub folder_name: String,
    pub display_name: String,
    pub kind: String,
    pub artifact_mode: Option<ArtifactMode>,
    pub effective_artifact_mode: ArtifactMode,
    pub created_at: String,
    pub artifacts: Vec<WarehouseArtifactFact>,
}

/// Per-artifact inspection facts with source-correlation existence.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarehouseArtifactFact {
    pub relative_path: String,
    pub artifact_sha256: String,
    pub state: ArtifactInspectionVerdict,
    pub size_bytes: u64,
    pub suggested_file_name: Option<String>,
    pub inspected_at: Option<String>,
    pub rejection_reason: Option<String>,
    pub source_correlated: bool,
    pub mapped_product_ids: Vec<String>,
    pub role: CopyRole,
}

/// Resolves the effective mode: the per-entry override, else the injected
/// global default. The stored column carries a schema-level CHECK closed
/// set, so through SQL the value is always a frozen member; if the storage
/// invariant is ever broken by non-SQL means, the parse failure propagates
/// as a corrupt value — never silently "no override" (a corrupt fact must
/// not rewrite the entry's resolution decision) and never a panic.
fn effective_mode(
    artifact_mode: Option<&str>,
    global_default: ArtifactMode,
) -> Result<ArtifactMode, BdlStoreError> {
    match artifact_mode {
        None => Ok(global_default),
        Some(mode) => ArtifactMode::parse(mode),
    }
}

fn warehouse_card(
    item: StoredWarehouseItem,
    global_default: ArtifactMode,
    artifacts: Vec<WarehouseArtifactRef>,
) -> Result<WarehouseEntryCard, BdlStoreError> {
    Ok(WarehouseEntryCard {
        effective_artifact_mode: effective_mode(item.artifact_mode.as_deref(), global_default)?,
        artifact_mode: item
            .artifact_mode
            .as_deref()
            .map(ArtifactMode::parse)
            .transpose()?,
        warehouse_item_id: item.warehouse_item_id,
        folder_name: item.folder_name,
        display_name: item.display_name,
        kind: item.kind,
        created_at: item.created_at,
        artifacts,
    })
}

pub struct BdlStore {
    path: Option<PathBuf>,
    connection: Mutex<Connection>,
}

impl BdlStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, BdlStoreError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                BdlStoreError::Database(rusqlite::Error::ToSqlConversionFailure(Box::new(error)))
            })?;
        }
        let connection = Connection::open(&path)?;
        let store = Self {
            path: Some(path),
            connection: Mutex::new(connection),
        };
        store.configure_and_migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self, BdlStoreError> {
        let store = Self {
            path: None,
            connection: Mutex::new(Connection::open_in_memory()?),
        };
        store.configure_and_migrate()?;
        Ok(store)
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    fn configure_and_migrate(&self) -> Result<(), BdlStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        if self.path.is_some() {
            let mode: String =
                connection.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
            if !mode.eq_ignore_ascii_case("wal") {
                connection.pragma_update(None, "journal_mode", "WAL")?;
            }
        }
        connection.pragma_update(None, "synchronous", "FULL")?;

        let migration: i64 =
            connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if migration > BDL_MIGRATION_VERSION {
            return Err(BdlStoreError::UnsupportedFormat(format!(
                "migration-{migration}"
            )));
        }
        if migration == 0 {
            // Fresh database: born v0.2 — the full executable chain (001
            // then 002) runs in one transaction, so a half-migrated fresh
            // database cannot exist.
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(MIGRATION_001)?;
            transaction.execute_batch(MIGRATION_002)?;
            transaction.execute_batch(MIGRATION_003)?;
            transaction.pragma_update(None, "user_version", BDL_MIGRATION_VERSION)?;
            transaction.commit()?;
        }
        if migration == 2 {
            // Existing v0.2 database: 003 adds products.library_type
            // (additive ALTER, no rebuild) and bumps the format stamp.
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(MIGRATION_003)?;
            transaction.pragma_update(None, "user_version", BDL_MIGRATION_VERSION)?;
            transaction.commit()?;
        }
        if migration == 1 {
            // Existing v0.1 database: 002 is the persistent-format migration
            // (compatibility_observations CHECK rebuild with verbatim row
            // carry-over + the dependency_observations table). Any data loss
            // aborts it; the user_version fencing stays host-owned, exactly
            // as the v0.1 host set it after MIGRATION_001.
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            transaction.execute_batch(MIGRATION_002)?;
            transaction.execute_batch(MIGRATION_003)?;
            transaction.pragma_update(None, "user_version", BDL_MIGRATION_VERSION)?;
            transaction.commit()?;
        }
        let format: String = connection
            .query_row(
                "SELECT value FROM bdl_meta WHERE key = 'format_version'",
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| BdlStoreError::UnsupportedFormat("missing".into()))?;
        if format != BDL_FORMAT_VERSION {
            return Err(BdlStoreError::UnsupportedFormat(format));
        }
        Ok(())
    }

    /// Append one normalized port event. Deduped on the persisted unique key
    /// — a redelivered event returns `Duplicate` with the original row id
    /// instead of inserting a second fact.
    pub fn append_download_event(
        &self,
        event: &DownloadEventV01,
    ) -> Result<(EventAppendence, StoredDownloadEvent), BdlStoreError> {
        if !event.schema_version_valid() {
            return Err(BdlStoreError::InvalidEvent("schema version"));
        }
        if event.download_id.trim().is_empty() {
            return Err(BdlStoreError::InvalidEvent("download id"));
        }
        if event.attempt == 0 {
            return Err(BdlStoreError::InvalidEvent("attempt"));
        }
        if event.source_url.trim().is_empty() || event.occurred_at.trim().is_empty() {
            return Err(BdlStoreError::InvalidEvent("source url or timestamp"));
        }
        let url_chain = match &event.url_chain {
            Some(chain) => Some(serde_json::to_string(chain)?),
            None => None,
        };
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let inserted = connection.execute(
            "INSERT INTO download_events(
                download_id, attempt, kind, source_url,
                initiated_from_page_url, url_chain, suggested_file_name,
                stored_path, expected_bytes, received_bytes, resumable,
                failure_kind, occurred_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                event.download_id,
                to_i64(u64::from(event.attempt), "attempt")?,
                download_event_kind_name(event.kind),
                event.source_url,
                event.initiated_from_page_url,
                url_chain,
                event.suggested_file_name,
                event.stored_path,
                event.expected_bytes.map(|v| to_i64(v, "expected bytes")).transpose()?,
                event.received_bytes.map(|v| to_i64(v, "received bytes")).transpose()?,
                i64::from(event.resumable),
                event.failure_kind.map(failure_kind_name),
                event.occurred_at,
            ],
        );
        match inserted {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(failure, _))
                if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                let stored = select_download_events(&connection, &event.download_id)?
                    .into_iter()
                    .find(|stored| {
                        stored.attempt == event.attempt
                            && stored.kind == event.kind
                            && stored.occurred_at == event.occurred_at
                    })
                    .ok_or(BdlStoreError::InvalidEvent(
                        "duplicate event not found under its own identity",
                    ))?;
                return Ok((EventAppendence::Duplicate, stored));
            }
            Err(error) => return Err(error.into()),
        }
        let event_id = connection.last_insert_rowid();
        Ok((
            EventAppendence::Inserted,
            StoredDownloadEvent {
                event_id,
                download_id: event.download_id.clone(),
                attempt: event.attempt,
                kind: event.kind,
                source_url: event.source_url.clone(),
                initiated_from_page_url: event.initiated_from_page_url.clone(),
                url_chain: event.url_chain.clone(),
                suggested_file_name: event.suggested_file_name.clone(),
                stored_path: event.stored_path.clone(),
                expected_bytes: event.expected_bytes,
                received_bytes: event.received_bytes,
                resumable: event.resumable,
                failure_kind: event.failure_kind,
                occurred_at: event.occurred_at.clone(),
            },
        ))
    }

    /// All persisted events of one download in delivery order — the input the
    /// consumer folds into lifecycle state after a restart.
    pub fn download_events(
        &self,
        download_id: &str,
    ) -> Result<Vec<StoredDownloadEvent>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        select_download_events(&connection, download_id)
    }

    /// Distinct download identities with persisted events — the enumeration
    /// the crash-recovery path folds to find non-terminal (orphaned) work.
    pub fn download_ids(&self) -> Result<Vec<String>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement =
            connection.prepare("SELECT DISTINCT download_id FROM download_events ORDER BY download_id")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(BdlStoreError::from)
    }

    /// First sight of a content: the untrusted row. Idempotent per content —
    /// re-downloads and batch-import sightings return `Existing`; a size
    /// disagreement under the same sha256 is corruption, never a silent keep.
    pub fn record_untrusted_artifact(
        &self,
        artifact: &NewLocalArtifact,
    ) -> Result<ArtifactRecording, BdlStoreError> {
        if !is_sha256_identity(&artifact.artifact_sha256) {
            return Err(BdlStoreError::CorruptValue {
                field: "artifact identity",
                value: artifact.artifact_sha256.clone(),
            });
        }
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = select_artifact(&transaction, &artifact.artifact_sha256)?;
        if let Some(existing) = existing {
            if existing.size_bytes != artifact.size_bytes {
                return Err(BdlStoreError::CorruptValue {
                    field: "artifact size",
                    value: format!(
                        "sha256 {} recorded {} bytes, sighting reports {}",
                        artifact.artifact_sha256, existing.size_bytes, artifact.size_bytes
                    ),
                });
            }
            return Ok(ArtifactRecording {
                outcome: ArtifactRecordingOutcome::Existing,
                artifact: existing,
            });
        }
        transaction.execute(
            "INSERT INTO local_artifacts(
                artifact_sha256, size_bytes, suggested_file_name,
                inspection_state, download_id, first_seen_at
             ) VALUES (?1, ?2, ?3, 'untrusted', ?4, ?5)",
            params![
                artifact.artifact_sha256,
                to_i64(artifact.size_bytes, "artifact size")?,
                artifact.suggested_file_name,
                artifact.download_id,
                artifact.first_seen_at,
            ],
        )?;
        let stored = select_artifact(&transaction, &artifact.artifact_sha256)?
            .expect("artifact row was inserted in this transaction");
        transaction.commit()?;
        Ok(ArtifactRecording {
            outcome: ArtifactRecordingOutcome::Created,
            artifact: stored,
        })
    }

    /// Move one artifact along the inspection lifecycle, enforcing the legal
    /// transitions. `rejection_reason` is only legal on rejection and is the
    /// honest user-facing verdict. `inspected_at` records when the verdict
    /// concluded (inspected/rejected); admission keeps the original value.
    pub fn transition_artifact(
        &self,
        artifact_sha256: &str,
        to: ArtifactInspectionState,
        inspected_at: &str,
        rejection_reason: Option<&str>,
    ) -> Result<StoredArtifact, BdlStoreError> {
        if to == ArtifactInspectionState::Rejected && rejection_reason.is_none() {
            return Err(BdlStoreError::InvalidEvent(
                "rejection without a reason is not an honest verdict",
            ));
        }
        if to != ArtifactInspectionState::Rejected && rejection_reason.is_some() {
            return Err(BdlStoreError::InvalidEvent(
                "rejection reason only applies to rejections",
            ));
        }
        let verdict_at = match to {
            ArtifactInspectionState::Inspected | ArtifactInspectionState::Rejected => {
                Some(inspected_at)
            }
            ArtifactInspectionState::Untrusted | ArtifactInspectionState::Admitted => None,
        };
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = select_artifact(&transaction, artifact_sha256)?
            .ok_or_else(|| BdlStoreError::UnknownArtifact(artifact_sha256.to_string()))?;
        if !current.inspection_state.can_transition(to) {
            return Err(BdlStoreError::InvalidTransition {
                artifact_sha256: artifact_sha256.to_string(),
                from: current.inspection_state,
                to,
            });
        }
        transaction.execute(
            "UPDATE local_artifacts SET
                inspection_state = ?1,
                rejection_reason = ?2,
                inspected_at = COALESCE(?3, inspected_at)
             WHERE artifact_sha256 = ?4",
            params![
                to.name(),
                rejection_reason,
                verdict_at,
                artifact_sha256,
            ],
        )?;
        let stored = select_artifact(&transaction, artifact_sha256)?
            .expect("artifact row remains present after transition");
        transaction.commit()?;
        Ok(stored)
    }

    pub fn artifact(&self, artifact_sha256: &str) -> Result<Option<StoredArtifact>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        select_artifact(&connection, artifact_sha256)
    }

    /// Submit the source-correlation fact (artifact content → observed
    /// product). Idempotent by primary key; the target product must have been
    /// observed by the pipeline — the FK is the boundary, surfaced here as
    /// `UnknownProduct`.
    pub fn record_artifact_mapping(
        &self,
        artifact_sha256: &str,
        product_id: &str,
        native_subproduct_id: Option<&str>,
        channel: Option<&str>,
        mapped_at: &str,
    ) -> Result<ArtifactMappingOutcome, BdlStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let artifact_known: bool = transaction
            .query_row(
                "SELECT 1 FROM local_artifacts WHERE artifact_sha256 = ?1",
                [artifact_sha256],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !artifact_known {
            return Err(BdlStoreError::UnknownArtifact(artifact_sha256.to_string()));
        }
        let product_known: bool = transaction
            .query_row(
                "SELECT 1 FROM products WHERE product_id = ?1",
                [product_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !product_known {
            return Err(BdlStoreError::UnknownProduct(product_id.to_string()));
        }
        let inserted = transaction.execute(
            "INSERT INTO artifact_mappings(
                artifact_sha256, product_id, native_subproduct_id, channel, mapped_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(artifact_sha256, product_id) DO NOTHING",
            params![
                artifact_sha256,
                product_id,
                native_subproduct_id,
                channel,
                mapped_at,
            ],
        )?;
        transaction.commit()?;
        Ok(if inserted == 1 {
            ArtifactMappingOutcome::Created
        } else {
            ArtifactMappingOutcome::Existing
        })
    }

    pub fn checkpoint(&self) -> Result<(), BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }

    /// Create one material-package entry. The VUA-generated identity is the
    /// entry's folder name under the warehouse root — stable, never derived
    /// from display names (warehouse-layout ruling 2).
    pub fn create_warehouse_item(
        &self,
        display_name: &str,
        kind: &str,
        created_at: &str,
    ) -> Result<StoredWarehouseItem, BdlStoreError> {
        if display_name.trim().is_empty() {
            return Err(BdlStoreError::InvalidEvent("warehouse display name"));
        }
        if !WAREHOUSE_ITEM_KINDS.contains(&kind) {
            return Err(BdlStoreError::InvalidEvent("warehouse item kind"));
        }
        let warehouse_item_id = format!(
            "whi-{:016x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| {
                    BdlStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                        Box::new(error),
                    ))
                })?
                .as_nanos()
        );
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.execute(
            "INSERT INTO warehouse_items(
                warehouse_item_id, display_name, folder_name, kind, created_at
             ) VALUES (?1, ?2, ?1, ?3, ?4)",
            params![warehouse_item_id, display_name, kind, created_at],
        )?;
        Ok(StoredWarehouseItem {
            warehouse_item_id: warehouse_item_id.clone(),
            display_name: display_name.to_string(),
            folder_name: warehouse_item_id,
            kind: kind.to_string(),
            artifact_mode: None,
            created_at: created_at.to_string(),
        })
    }

    /// Record one physical copy inside an entry. The referenced artifact must
    /// exist in any inspection state — a copy is physical reality, and a
    /// later admission rejection legitimately turns an already-copied
    /// artifact quarantined (that is the quarantine card's origin).
    pub fn record_artifact_copy(
        &self,
        warehouse_item_id: &str,
        artifact_sha256: &str,
        relative_path: &str,
        stored_path: &str,
        role: CopyRole,
        created_at: &str,
    ) -> Result<StoredArtifactCopy, BdlStoreError> {
        if relative_path.trim().is_empty() || stored_path.trim().is_empty() {
            return Err(BdlStoreError::InvalidEvent("artifact copy path"));
        }
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let item_known: bool = transaction
            .query_row(
                "SELECT 1 FROM warehouse_items WHERE warehouse_item_id = ?1",
                [warehouse_item_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !item_known {
            return Err(BdlStoreError::UnknownWarehouseItem(
                warehouse_item_id.to_string(),
            ));
        }
        let artifact_known: bool = transaction
            .query_row(
                "SELECT 1 FROM local_artifacts WHERE artifact_sha256 = ?1",
                [artifact_sha256],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !artifact_known {
            return Err(BdlStoreError::UnknownArtifact(artifact_sha256.to_string()));
        }
        let copy_id = format!(
            "cpy-{:016x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| {
                    BdlStoreError::Database(rusqlite::Error::ToSqlConversionFailure(
                        Box::new(error),
                    ))
                })?
                .as_nanos()
        );
        let inserted = transaction.execute(
            "INSERT INTO artifact_copies(
                copy_id, artifact_sha256, warehouse_item_id,
                relative_path, stored_path, role, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                copy_id,
                artifact_sha256,
                warehouse_item_id,
                relative_path,
                stored_path,
                role.name(),
                created_at,
            ],
        );
        if let Err(rusqlite::Error::SqliteFailure(failure, _)) = &inserted {
            if failure.code == rusqlite::ErrorCode::ConstraintViolation {
                return Err(BdlStoreError::CorruptValue {
                    field: "artifact copy",
                    value: format!("{warehouse_item_id}:{relative_path}"),
                });
            }
        }
        inserted?;
        transaction.commit()?;
        Ok(StoredArtifactCopy {
            copy_id,
            warehouse_item_id: warehouse_item_id.to_string(),
            artifact_sha256: artifact_sha256.to_string(),
            relative_path: relative_path.to_string(),
            stored_path: stored_path.to_string(),
            role,
            created_at: created_at.to_string(),
        })
    }

    /// Set (or clear) the per-entry artifact-mode override. `None` = follow
    /// the global default again; resolution stays dynamic at read time.
    pub fn set_artifact_mode(
        &self,
        warehouse_item_id: &str,
        mode: Option<ArtifactMode>,
    ) -> Result<(), BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let changed = connection.execute(
            "UPDATE warehouse_items SET artifact_mode = ?1 WHERE warehouse_item_id = ?2",
            params![mode.map(ArtifactMode::name), warehouse_item_id],
        )?;
        if changed != 1 {
            return Err(BdlStoreError::UnknownWarehouseItem(
                warehouse_item_id.to_string(),
            ));
        }
        Ok(())
    }

    /// The persisted global default mode (U8 two-level options, global
    /// level): `None` = not persisted yet — the provider's
    /// environment-injected initial default rules until the first write.
    /// The entry level lives in `warehouse_items.artifact_mode`; resolution
    /// stays `override ?? global default`, read-time, never a snapshot.
    pub fn global_default_mode(&self) -> Result<Option<ArtifactMode>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let persisted: Option<String> = connection
            .query_row(
                "SELECT value FROM bdl_meta WHERE key = 'warehouse_global_default_mode'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        drop(connection);
        persisted
            .map(|value| ArtifactMode::parse(&value))
            .transpose()
    }

    /// Persists the global default mode (bdl_meta) and reads it back — the
    /// write never echoes the request; the stored fact is the answer. The
    /// environment-injected initial default remains the provider's fallback
    /// only until the first write replaces it here.
    pub fn set_global_default_mode(
        &self,
        mode: ArtifactMode,
    ) -> Result<ArtifactMode, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.execute(
            "INSERT INTO bdl_meta(key, value) VALUES ('warehouse_global_default_mode', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![mode.name()],
        )?;
        drop(connection);
        Ok(mode)
    }

    /// Raw copy rows of one entry, all roles, including `storedPath` — the
    /// AMF-side view for maintenance flows (the wire read face never carries
    /// paths).
    pub fn entry_copies(
        &self,
        warehouse_item_id: &str,
    ) -> Result<Vec<StoredArtifactCopy>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare(
            "SELECT copy_id, warehouse_item_id, artifact_sha256,
                    relative_path, stored_path, role, created_at
             FROM artifact_copies
             WHERE warehouse_item_id = ?1
             ORDER BY relative_path",
        )?;
        let rows = statement
            .query_map([warehouse_item_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(
                |(
                    copy_id,
                    warehouse_item_id,
                    artifact_sha256,
                    relative_path,
                    stored_path,
                    role,
                    created_at,
                )| {
                    Ok(StoredArtifactCopy {
                        copy_id,
                        warehouse_item_id,
                        artifact_sha256,
                        relative_path,
                        stored_path,
                        role: CopyRole::parse(&role)?,
                        created_at,
                    })
                },
            )
            .collect()
    }

    /// Delete one copy row (the maintenance flow removes the physical file
    /// first, then the row — per-copy consistency, resumable on retry).
    /// Returns false when the row was already gone.
    pub fn delete_artifact_copy(&self, copy_id: &str) -> Result<bool, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let deleted = connection.execute("DELETE FROM artifact_copies WHERE copy_id = ?1", [
            copy_id,
        ])?;
        Ok(deleted == 1)
    }

    /// Delete the ORIGINAL copy rows of one entry (the delete-originals
    /// task removes the physical files around this call). Generated VPM
    /// rows and every inspection fact are kept.
    pub fn delete_entry_originals(&self, warehouse_item_id: &str) -> Result<u64, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let item_known: bool = connection
            .query_row(
                "SELECT 1 FROM warehouse_items WHERE warehouse_item_id = ?1",
                [warehouse_item_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !item_known {
            return Err(BdlStoreError::UnknownWarehouseItem(
                warehouse_item_id.to_string(),
            ));
        }
        let deleted = connection.execute(
            "DELETE FROM artifact_copies
             WHERE warehouse_item_id = ?1 AND role = 'original'",
            [warehouse_item_id],
        )?;
        Ok(deleted as u64)
    }

    /// The `warehouse.listEntries` read face: every entry card with its
    /// light artifact references, wire shapes per bdl-queries v0.3. The
    /// shell-level global mode default is injected per query — resolution
    /// stays dynamic (override ?? default), never an import-time snapshot.
    pub fn warehouse_entry_cards(
        &self,
        global_default: ArtifactMode,
    ) -> Result<Vec<WarehouseEntryCard>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare(
            "SELECT warehouse_item_id, display_name, folder_name, kind,
                    artifact_mode, created_at
             FROM warehouse_items ORDER BY warehouse_item_id",
        )?;
        let items = statement
            .query_map([], |row| {
                Ok(StoredWarehouseItem {
                    warehouse_item_id: row.get(0)?,
                    display_name: row.get(1)?,
                    folder_name: row.get(2)?,
                    kind: row.get(3)?,
                    artifact_mode: row.get::<_, Option<String>>(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut cards = Vec::with_capacity(items.len());
        for item in items {
            let artifacts =
                self.warehouse_artifact_refs(&connection, &item.warehouse_item_id)?;
            cards.push(warehouse_card(item, global_default, artifacts)?);
        }
        Ok(cards)
    }

    /// The `downloads.listCompleted` read face (bdl-queries v0.4): the
    /// adoptable completed deliveries. The membership predicate is the
    /// SAME server-side fact the v0.4 adoption guard consumes —
    /// `DownloadEventConsumer::staging_completion` (fold at a completed
    /// delivery) plus the staging file being physically present at the
    /// reported size — so the list is the guard's mirror: what the UI
    /// shows is adoptable. Deliveries whose staging file is gone or
    /// size-drifted are honestly absent, not listed. Each row carries the
    /// warehouse entries adopted from that download's content (empty =
    /// not yet adopted). Rows sort by completion time, oldest first.
    /// Paths never appear in the rows.
    pub fn list_adoptable_downloads(&self) -> Result<Vec<CompletedDownloadRow>, BdlStoreError> {
        let consumer = crate::download_events::DownloadEventConsumer::new(self);
        let mut rows = Vec::new();
        for download_id in self.download_ids()? {
            let completion = consumer
                .staging_completion(&download_id)
                .map_err(|error| match error {
                    crate::download_events::ConsumerError::Store(store) => store,
                    // Histories are ingest-gated: a fold failure here is
                    // stored corruption, surfaced as such — never a silent
                    // skip dressed as an empty list.
                    other => BdlStoreError::CorruptValue {
                        field: "download_events",
                        value: other.to_string(),
                    },
                })?;
            let Some(completion) = completion else {
                continue;
            };
            let staging_metadata = std::fs::metadata(std::path::Path::new(&completion.stored_path));
            match staging_metadata {
                Ok(metadata) if metadata.len() == completion.reported_size_bytes => {}
                // Absent or size-drifted staging: not adoptable, honestly
                // absent from the adoptable list.
                _ => continue,
            }
            let history = self.download_events(&download_id)?;
            let Some(completed) = history
                .iter()
                .rev()
                .find(|event| event.kind == DownloadEventKind::Completed)
            else {
                continue;
            };
            let connection = self.connection.lock().expect("SQLite connection poisoned");
            let mut statement = connection.prepare(
                "SELECT DISTINCT wi.warehouse_item_id
                 FROM local_artifacts la
                 JOIN artifact_copies ac ON ac.artifact_sha256 = la.artifact_sha256
                 JOIN warehouse_items wi ON wi.warehouse_item_id = ac.warehouse_item_id
                 WHERE la.download_id = ?1
                 ORDER BY wi.warehouse_item_id",
            )?;
            let adopted = statement
                .query_map(params![download_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            drop(statement);
            drop(connection);
            rows.push(CompletedDownloadRow {
                download_id,
                source_url: completed.source_url.clone(),
                suggested_file_name: completion.suggested_file_name,
                received_bytes: completion.reported_size_bytes,
                completed_at: completed.occurred_at.clone(),
                adopted_warehouse_item_ids: adopted,
            });
        }
        rows.sort_by(|a, b| a.completed_at.cmp(&b.completed_at));
        Ok(rows)
    }

    /// The `warehouse.entryDetail` read face: per-artifact inspection facts
    /// plus source-correlation existence.
    pub fn warehouse_entry_detail(
        &self,
        warehouse_item_id: &str,
        global_default: ArtifactMode,
    ) -> Result<Option<WarehouseEntryDetail>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let item = connection
            .query_row(
                "SELECT warehouse_item_id, display_name, folder_name, kind,
                        artifact_mode, created_at
                 FROM warehouse_items WHERE warehouse_item_id = ?1",
                [warehouse_item_id],
                |row| {
                    Ok(StoredWarehouseItem {
                        warehouse_item_id: row.get(0)?,
                        display_name: row.get(1)?,
                        folder_name: row.get(2)?,
                        kind: row.get(3)?,
                        artifact_mode: row.get::<_, Option<String>>(4)?,
                        created_at: row.get(5)?,
                    })
                },
            )
            .optional()?;
        let Some(item) = item else {
            return Ok(None);
        };
        let mut statement = connection.prepare(
            "SELECT c.relative_path, a.artifact_sha256, a.inspection_state, a.size_bytes,
                    a.suggested_file_name, a.inspected_at, a.rejection_reason, c.role
             FROM artifact_copies c
             JOIN local_artifacts a ON a.artifact_sha256 = c.artifact_sha256
             WHERE c.warehouse_item_id = ?1
             ORDER BY c.relative_path",
        )?;
        let rows = statement
            .query_map([warehouse_item_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut artifacts = Vec::with_capacity(rows.len());
        for (
            relative_path,
            artifact_sha256,
            inspection_state,
            size_bytes,
            suggested_file_name,
            inspected_at,
            rejection_reason,
            role,
        ) in rows
        {
            let mapped_product_ids = self.mapped_product_ids(&connection, &artifact_sha256)?;
            artifacts.push(WarehouseArtifactFact {
                relative_path,
                artifact_sha256,
                state: ArtifactInspectionVerdict::from_storage_state(
                    ArtifactInspectionState::parse(&inspection_state)?,
                ),
                size_bytes: to_u64(size_bytes, "artifact size")?,
                suggested_file_name,
                inspected_at,
                rejection_reason,
                source_correlated: !mapped_product_ids.is_empty(),
                mapped_product_ids,
                role: CopyRole::parse(&role)?,
            });
        }
        Ok(Some(WarehouseEntryDetail {
            warehouse_item_id: item.warehouse_item_id,
            folder_name: item.folder_name,
            display_name: item.display_name,
            kind: item.kind,
            artifact_mode: item
                .artifact_mode
                .as_deref()
                .map(ArtifactMode::parse)
                .transpose()?,
            effective_artifact_mode: effective_mode(item.artifact_mode.as_deref(), global_default)?,
            created_at: item.created_at,
            artifacts,
        }))
    }

    fn warehouse_artifact_refs(
        &self,
        connection: &Connection,
        warehouse_item_id: &str,
    ) -> Result<Vec<WarehouseArtifactRef>, BdlStoreError> {
        let mut statement = connection.prepare(
            "SELECT c.relative_path, a.artifact_sha256, a.inspection_state, a.size_bytes, c.role
             FROM artifact_copies c
             JOIN local_artifacts a ON a.artifact_sha256 = c.artifact_sha256
             WHERE c.warehouse_item_id = ?1
             ORDER BY c.relative_path",
        )?;
        let rows = statement
            .query_map([warehouse_item_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(
                |(relative_path, artifact_sha256, inspection_state, size_bytes, role)| {
                    Ok(WarehouseArtifactRef {
                        relative_path,
                        artifact_sha256,
                        state: ArtifactInspectionVerdict::from_storage_state(
                            ArtifactInspectionState::parse(&inspection_state)?,
                        ),
                        size_bytes: to_u64(size_bytes, "artifact size")?,
                        role: CopyRole::parse(&role)?,
                    })
                },
            )
            .collect()
    }

    fn mapped_product_ids(
        &self,
        connection: &Connection,
        artifact_sha256: &str,
    ) -> Result<Vec<String>, BdlStoreError> {
        let mut statement = connection.prepare(
            "SELECT product_id FROM artifact_mappings
             WHERE artifact_sha256 = ?1 ORDER BY product_id",
        )?;
        let rows = statement.query_map([artifact_sha256], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(BdlStoreError::from)
    }

    #[cfg(test)]
    fn pragma_i64(&self, name: &str) -> Result<i64, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection.pragma_query_value(None, name, |row| row.get(0))?)
    }

    /// Seed one minimal synthetic observed-product row (boundary IN-1). The
    /// real row belongs to the observation pipeline; tests need it only so
    /// artifact mappings can reference a product that was "observed".
    pub fn seed_product(
        &self,
        product_id: &str,
        native_product_id: &str,
    ) -> Result<(), BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection.execute(
            "INSERT INTO products(
                product_id, native_product_id, source_url, status,
                content_hash, observed_at, processor_version
             ) VALUES (?1, ?2, ?3, 'complete', ?4, ?5, 'synthetic-test')",
            params![
                product_id,
                native_product_id,
                format!("https://booth.example.com/items/{native_product_id}"),
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                "2026-09-06T00:00:00.000Z",
            ],
        )?;
        Ok(())
    }

    // --- observation write face (W17; docs/architecture/bdl.md) ---

    /// Record one product observation: an upsert of the latest observed
    /// facts (a re-observation overwrites the row in the same transaction
    /// that bumps the `catalog_updated_seq` bookkeeping counter, so the
    /// catalog status turns `ok` with the first write and the revision
    /// travels every write). Tombstones are kept, never deleted; the API
    /// offers no delete — only a newer observation can change a row.
    ///
    /// Scope note: only the products table is served here. The term and
    /// compatibility observation tables have no catalog consumer yet and
    /// stay with their own (BDL v2 vocabulary) slices.
    pub fn record_product_observation(
        &self,
        observation: &ProductObservation,
    ) -> Result<i64, BdlStoreError> {
        validate_product_observation(observation)?;
        let image_urls = serde_json::to_string(&observation.image_urls)?;
        let video_urls = serde_json::to_string(&observation.video_urls)?;
        let subproducts = serde_json::to_string(
            &observation
                .subproducts
                .iter()
                .map(|subproduct| {
                    serde_json::json!({
                        "variation_id": subproduct.variation_id,
                        "name": subproduct.name,
                        "price_amount": subproduct.price_amount,
                        "price_currency": subproduct.price_currency,
                        "availability": subproduct.availability,
                    })
                })
                .collect::<Vec<_>>(),
        )?;
        let missing_fields = serde_json::to_string(&observation.missing_fields)?;
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO products(
                product_id, native_product_id, library_type, source_url, final_url, status,
                source_locale, source_category, title, description,
                age_restriction, adult, availability, price_amount,
                price_currency, shop_name, shop_url, image_urls, video_urls,
                subproducts, search_text_normalized, source_published_at,
                content_hash, observed_at, run_id, processor_version,
                missing_fields
             ) VALUES (
                ?1, ?2, ?27, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26
             )
             ON CONFLICT(product_id) DO UPDATE SET
                native_product_id = excluded.native_product_id,
                library_type = excluded.library_type,
                source_url = excluded.source_url,
                final_url = excluded.final_url,
                status = excluded.status,
                source_locale = excluded.source_locale,
                source_category = excluded.source_category,
                title = excluded.title,
                description = excluded.description,
                age_restriction = excluded.age_restriction,
                adult = excluded.adult,
                availability = excluded.availability,
                price_amount = excluded.price_amount,
                price_currency = excluded.price_currency,
                shop_name = excluded.shop_name,
                shop_url = excluded.shop_url,
                image_urls = excluded.image_urls,
                video_urls = excluded.video_urls,
                subproducts = excluded.subproducts,
                search_text_normalized = excluded.search_text_normalized,
                source_published_at = excluded.source_published_at,
                content_hash = excluded.content_hash,
                observed_at = excluded.observed_at,
                run_id = excluded.run_id,
                processor_version = excluded.processor_version,
                missing_fields = excluded.missing_fields",
            params![
                observation.product_id,
                observation.native_product_id,
                observation.source_url,
                observation.final_url,
                observation.status.name(),
                observation.source_locale,
                observation.source_category,
                observation.title,
                observation.description,
                observation.age_restriction,
                i64::from(observation.adult),
                observation.availability,
                observation.price_amount,
                observation.price_currency,
                observation.shop_name,
                observation.shop_url,
                image_urls,
                video_urls,
                subproducts,
                normalized_search_text(observation),
                observation.source_published_at,
                observation.content_hash,
                observation.observed_at,
                observation.run_id,
                observation.processor_version,
                missing_fields,
                observation.library_type,
            ],
        )?;
        transaction.execute(
            "INSERT INTO bdl_meta(key, value) VALUES ('catalog_updated_seq', '1')
             ON CONFLICT(key) DO UPDATE SET
                value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
            [],
        )?;
        let updated: i64 = transaction
            .query_row(
                "SELECT value FROM bdl_meta WHERE key = 'catalog_updated_seq'",
                [],
                |row| row.get::<_, String>(0),
            )?
            .parse()
            .map_err(|_| BdlStoreError::CorruptValue {
                field: "catalog_updated_seq",
                value: "non-integer".into(),
            })?;
        transaction.commit()?;
        Ok(updated)
    }

    // --- dependency observation face (BDL v0.2; docs/protocols/
    //     bdl-dependency-observations-v0.2) ---

    /// Land one declared-dependency observation. Rows are APPENDED as
    /// evidence — no upsert: a re-observation is a new observation row (the
    /// schema defines no identity to dedupe on). The FROZEN schema is the
    /// single law authority: closed-set members are persisted verbatim and
    /// the real SQLite CHECK/NOT NULL/FK constraints reject every foreign
    /// or lawless value as `BdlStoreError::Database` — the store keeps no
    /// duplicate Rust copy of the frozen word face. Confirmed is not
    /// writable here: the row lands unconfirmed (DEFAULT 0).
    pub fn record_dependency_observation(
        &self,
        observation: &NewDependencyObservation,
    ) -> Result<StoredDependencyObservation, BdlStoreError> {
        let resolution_evidence =
            serialize_resolution_evidence(&observation.resolution_evidence)?;
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO dependency_observations(
                product_id, dep_kind, dep_name, raw_quote, source_span,
                version_hint, resolved_ref_product_id, resolution_evidence,
                extraction_method, extracted_by, observed_at,
                processor_version, content_hash, run_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                observation.product_id,
                observation.dep_kind,
                observation.dep_name,
                observation.raw_quote,
                observation.source_span,
                observation.version_hint,
                observation.resolved_ref_product_id,
                resolution_evidence,
                observation.extraction_method,
                observation.extracted_by,
                observation.observed_at,
                observation.processor_version,
                observation.content_hash,
                observation.run_id,
            ],
        )?;
        let observation_id = transaction.last_insert_rowid();
        let stored = select_dependency_observation(&transaction, observation_id)?
            .expect("observation row was inserted in this transaction");
        transaction.commit()?;
        Ok(stored)
    }

    /// The explicit, recorded human confirmation write action — the ONLY
    /// writer of `confirmed_by_human = 1` (a resolution is by default a
    /// clue; confirmation never happens automatically). One write pins the
    /// resolved product identity, its reconciliation evidence and the
    /// confirmation flag together. The evidence must be non-empty (an empty
    /// "evidence" is no evidence — not an honest verdict), the observation
    /// must exist, and the target must be an OBSERVED product: identity
    /// resolution points at products the library holds, never at guessed
    /// ones. The schema's CHECK hard law (evidence must accompany
    /// resolution) holds underneath.
    pub fn confirm_dependency_resolution(
        &self,
        observation_id: i64,
        resolved_ref_product_id: &str,
        resolution_evidence: &[DependencyResolutionEvidence],
    ) -> Result<StoredDependencyObservation, BdlStoreError> {
        if resolution_evidence.is_empty() {
            return Err(BdlStoreError::InvalidResolution(
                "a confirmation without resolution evidence is not an honest verdict",
            ));
        }
        let evidence = serialize_resolution_evidence(resolution_evidence)?;
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let transaction =
            connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let known: bool = transaction
            .query_row(
                "SELECT 1 FROM dependency_observations WHERE observation_id = ?1",
                [observation_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !known {
            return Err(BdlStoreError::UnknownDependencyObservation(observation_id));
        }
        let product_known: bool = transaction
            .query_row(
                "SELECT 1 FROM products WHERE product_id = ?1",
                [resolved_ref_product_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !product_known {
            return Err(BdlStoreError::UnknownProduct(
                resolved_ref_product_id.to_string(),
            ));
        }
        transaction.execute(
            "UPDATE dependency_observations SET
                resolved_ref_product_id = ?1,
                resolution_evidence = ?2,
                confirmed_by_human = 1
             WHERE observation_id = ?3",
            params![resolved_ref_product_id, evidence, observation_id],
        )?;
        let stored = select_dependency_observation(&transaction, observation_id)?
            .expect("observation row remains present after confirmation");
        transaction.commit()?;
        Ok(stored)
    }

    /// All stored dependency observations of one product in observation
    /// order — the honest row set (unconfirmed clues and confirmed
    /// resolutions alike; what leaves the library as a suggestion is the
    /// read-side rule table's business, never the store's). Empty = the
    /// honest empty set — 空态即终态.
    pub fn dependency_observations(
        &self,
        product_id: &str,
    ) -> Result<Vec<StoredDependencyObservation>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        select_product_dependency_observations(&connection, product_id)
    }

    /// The WHOLE-library dependency observation set in observation-identity
    /// order — the reverse-lookup scan face (the v0.5 `dependencies.lookup`
    /// implementing executor needs every declaring product's rows, and the
    /// read-time rule tables — matching/advisory v1 — are the EXECUTOR's
    /// law, never the store's). Rows are the same honest evidence rows the
    /// per-product face returns; empty library = the honest empty set.
    pub fn dependency_observations_all(
        &self,
    ) -> Result<Vec<StoredDependencyObservation>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        select_all_dependency_observations(&connection)
    }

    /// One products row as the dependencies read face consumes it (the v0.5
    /// dependencies.* implementing executor): the declaring/resolution
    /// product facts the read-time rule tables derive from — `status`
    /// verbatim (the CHECK closed set `complete|missing`; the executor's
    /// tombstone honesty face reads it), `title`/`availability`/`source_url`
    /// verbatim (the dual-field law and the installSource host derivation
    /// consume them). ANY status is served here — tombstones included —
    /// because this is the observation read face's fact source, not the
    /// catalog card face ("tombstones are never cards" stays catalog's law).
    /// Unknown id = `None` (the executor maps it onto not-found / absence).
    pub fn dependency_product_row(
        &self,
        product_id: &str,
    ) -> Result<Option<DependencyProductRow>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection
            .query_row(
                "SELECT product_id, status, title, availability, source_url
                 FROM products
                 WHERE product_id = ?1",
                [product_id],
                |row| {
                    Ok(DependencyProductRow {
                        product_id: row.get(0)?,
                        status: row.get(1)?,
                        title: row.get(2)?,
                        availability: row.get(3)?,
                        source_url: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(BdlStoreError::from)
    }

    // --- catalog serving face (W12; docs/protocols/bdl-queries-v0.3) ---

    /// `catalog.list`: assembles the v0.3 card list from the observation
    /// products table. Tombstones (`status = 'missing'`, 404/410 keepsakes)
    /// are never cards. Presentation fields assemble from the observed
    /// columns verbatim (W17 write side); the availability filter matches
    /// the derived stable enum (v0.2 rule table), rows without a
    /// recognizable word stay honest `unknown`. Empty table = the honest
    /// empty set — 空态即终态.
    /// 只读辅助:单行的库类型(N5 商品页富化透传保留用)。
    pub fn library_type_of(&self, native_product_id: &str) -> Option<String> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        connection
            .query_row(
                "SELECT library_type FROM products WHERE native_product_id = ?1",
                [native_product_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
    }

    pub fn catalog_list(
        &self,
        params: &CatalogListParams,
    ) -> Result<CatalogListResult, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare(
            "SELECT p.product_id, p.title, p.price_amount, p.price_currency,
                    p.image_urls, p.availability, p.library_type,
                    (SELECT COUNT(*) FROM artifact_mappings m
                     WHERE m.product_id = p.product_id) AS imported_artifacts,
                    p.shop_name
             FROM products p
             WHERE p.status = 'complete'
             ORDER BY p.product_id",
        )?;
        let observed: Vec<ObservedCard> = statement
            .query_map([], |row| {
                Ok(ObservedCard {
                    product_id: row.get(0)?,
                    title: row.get(1)?,
                    price_amount: row.get(2)?,
                    price_currency: row.get(3)?,
                    image_urls: row.get(4)?,
                    availability: row.get(5)?,
                    library_type: row.get(6)?,
                    imported_artifacts: row.get(7)?,
                    shop_name: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);

        let needle = params.text.as_ref().map(|text| text.to_ascii_lowercase());
        let matched: Vec<&ObservedCard> = observed
            .iter()
            .filter(|card| match &needle {
                // text is a case-insensitive substring over title and
                // productId (the v0.3 protocol surface).
                Some(needle) => {
                    card.product_id.to_ascii_lowercase().contains(needle)
                        || card
                            .title
                            .as_deref()
                            .is_some_and(|title| title.to_ascii_lowercase().contains(needle))
                }
                None => true,
            })
            .filter(|card| {
                // The availability filter matches the derived enum; rows
                // with no recognizable word derive to unknown.
                match params.availability_status {
                    Some(expected) => {
                        availability_status(card.availability.as_deref()) == expected
                    }
                    None => true,
                }
            })
            // BDL v0.3: the library-type filter matches the stored column
            // verbatim; NULL rows only match when no filter is asked.
            .filter(|card| match &params.library_type {
                Some(expected) => card.library_type.as_deref() == Some(expected.as_str()),
                None => true,
            })
            .collect();

        let total = matched.len() as i64;
        let entries = matched
            .iter()
            .skip(params.offset as usize)
            .take(params.limit as usize)
            .map(|card| card.as_summary())
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CatalogListResult { total, entries })
    }

    /// `catalog.detail`: assembles one v0.3 product detail from the
    /// observed columns (W17 write side). Unknown ids and tombstones answer
    /// `None` (the application face owns the miss code); absent presentation
    /// fields assemble as the honest empty shapes.
    pub fn catalog_detail(
        &self,
        product_id: &str,
    ) -> Result<Option<CatalogDetailResult>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let observed = connection
            .query_row(
                "SELECT title, price_amount, price_currency, image_urls,
                        availability, description, shop_name, shop_url,
                        library_type, source_published_at,
                        age_restriction, adult, video_urls, source_category,
                        subproducts
                 FROM products
                 WHERE product_id = ?1 AND status = 'complete'",
                [product_id],
                |row| {
                    Ok(ObservedDetail {
                        title: row.get(0)?,
                        price_amount: row.get(1)?,
                        price_currency: row.get(2)?,
                        image_urls: row.get(3)?,
                        availability: row.get(4)?,
                        description: row.get(5)?,
                        shop_name: row.get(6)?,
                        shop_url: row.get(7)?,
                        library_type: row.get(8)?,
                        source_published_at: row.get(9)?,
                        age_restriction: row.get(10)?,
                        adult: row.get::<_, i64>(11)? != 0,
                        video_urls: row.get(12)?,
                        source_category: row.get(13)?,
                        subproducts: row.get(14)?,
                    })
                },
            )
            .optional()?;
        drop(connection);
        observed
            .map(|observed| observed.as_detail(product_id))
            .transpose()
    }

    /// `catalog.status`: health and revision snapshot. The health is
    /// `unknown` until the observation-pipeline bookkeeping counter exists
    /// in `bdl_meta` (protocol v0.3: 观察管线未落数据前 health = unknown —
    /// 空态即终态); `datasetRevision` is the BDL format_version.
    pub fn catalog_status(&self) -> Result<CatalogStatusResult, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        // A persisted counter that is not an integer is stored corruption,
        // surfaced as such — the sibling write face maps the same parse
        // failure to CorruptValue, and silently answering health=unknown
        // would dress corruption up as the honest empty state.
        let catalog_updated_seq: Option<i64> = match connection
            .query_row(
                "SELECT value FROM bdl_meta WHERE key = 'catalog_updated_seq'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            None => None,
            Some(value) => Some(value.parse().map_err(|_| BdlStoreError::CorruptValue {
                field: "catalog_updated_seq",
                value,
            })?),
        };
        let dataset_revision: String = connection
            .query_row(
                "SELECT value FROM bdl_meta WHERE key = 'format_version'",
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| BdlStoreError::UnsupportedFormat("missing".into()))?;
        drop(connection);
        Ok(CatalogStatusResult {
            health: if catalog_updated_seq.is_some() {
                CatalogHealth::Ok
            } else {
                CatalogHealth::Unknown
            },
            revision: CatalogRevision { catalog_updated_seq, dataset_revision },
        })
    }
}

fn select_download_events(
    connection: &Connection,
    download_id: &str,
) -> Result<Vec<StoredDownloadEvent>, BdlStoreError> {
    let mut statement = connection.prepare(
        "SELECT event_id, download_id, attempt, kind, source_url,
                initiated_from_page_url, url_chain, suggested_file_name,
                stored_path, expected_bytes, received_bytes, resumable,
                failure_kind, occurred_at
         FROM download_events
         WHERE download_id = ?1
         ORDER BY attempt, event_id",
    )?;
    let rows = statement.query_map([download_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<i64>>(9)?,
            row.get::<_, Option<i64>>(10)?,
            row.get::<_, i64>(11)?,
            row.get::<_, Option<String>>(12)?,
            row.get::<_, String>(13)?,
        ))
    })?;
    let mut events = Vec::new();
    for row in rows {
        let (
            event_id,
            download_id,
            attempt,
            kind,
            source_url,
            initiated_from_page_url,
            url_chain,
            suggested_file_name,
            stored_path,
            expected_bytes,
            received_bytes,
            resumable,
            failure_kind,
            occurred_at,
        ) = row?;
        events.push(StoredDownloadEvent {
            event_id,
            download_id,
            attempt: to_u64(attempt, "attempt")? as u32,
            kind: parse_download_event_kind(&kind)?,
            source_url,
            initiated_from_page_url,
            url_chain: url_chain
                .map(|json| serde_json::from_str(&json))
                .transpose()?,
            suggested_file_name,
            stored_path,
            expected_bytes: expected_bytes
                .map(|v| to_u64(v, "expected bytes"))
                .transpose()?,
            received_bytes: received_bytes
                .map(|v| to_u64(v, "received bytes"))
                .transpose()?,
            resumable: resumable != 0,
            failure_kind: failure_kind.as_deref().map(parse_failure_kind).transpose()?,
            occurred_at,
        });
    }
    Ok(events)
}

fn select_artifact(
    connection: &Connection,
    artifact_sha256: &str,
) -> Result<Option<StoredArtifact>, BdlStoreError> {
    let row = connection
        .query_row(
            "SELECT artifact_sha256, size_bytes, suggested_file_name,
                    inspection_state, rejection_reason, inspected_at,
                    download_id, first_seen_at
             FROM local_artifacts WHERE artifact_sha256 = ?1",
            [artifact_sha256],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(
            artifact_sha256,
            size_bytes,
            suggested_file_name,
            inspection_state,
            rejection_reason,
            inspected_at,
            download_id,
            first_seen_at,
        )| {
            Ok(StoredArtifact {
                artifact_sha256,
                size_bytes: to_u64(size_bytes, "artifact size")?,
                suggested_file_name,
                inspection_state: ArtifactInspectionState::parse(&inspection_state)?,
                rejection_reason,
                inspected_at,
                download_id,
                first_seen_at,
            })
        },
    )
    .transpose()
}

fn is_sha256_identity(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256:") else {
        return false;
    };
    hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn select_dependency_observation(
    connection: &Connection,
    observation_id: i64,
) -> Result<Option<StoredDependencyObservation>, BdlStoreError> {
    let row = connection
        .query_row(
            "SELECT observation_id, product_id, dep_kind, dep_name, raw_quote,
                    source_span, version_hint, resolved_ref_product_id,
                    resolution_evidence, confirmed_by_human, extraction_method,
                    extracted_by, observed_at, processor_version, content_hash,
                    run_id
             FROM dependency_observations
             WHERE observation_id = ?1",
            [observation_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, Option<String>>(15)?,
                ))
            },
        )
        .optional()?;
    row.map(stored_dependency_observation).transpose()
}

/// The whole-library scan (observation-identity order) for the v0.5
/// reverse-lookup executor — the same honest row mapper as the per-product
/// face, without the WHERE.
fn select_all_dependency_observations(
    connection: &Connection,
) -> Result<Vec<StoredDependencyObservation>, BdlStoreError> {
    let mut statement = connection.prepare(
        "SELECT observation_id, product_id, dep_kind, dep_name, raw_quote,
                source_span, version_hint, resolved_ref_product_id,
                resolution_evidence, confirmed_by_human, extraction_method,
                extracted_by, observed_at, processor_version, content_hash,
                run_id
         FROM dependency_observations
         ORDER BY observation_id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(stored_dependency_observation)
        .collect()
}

fn select_product_dependency_observations(
    connection: &Connection,
    product_id: &str,
) -> Result<Vec<StoredDependencyObservation>, BdlStoreError> {
    let mut statement = connection.prepare(
        "SELECT observation_id, product_id, dep_kind, dep_name, raw_quote,
                source_span, version_hint, resolved_ref_product_id,
                resolution_evidence, confirmed_by_human, extraction_method,
                extracted_by, observed_at, processor_version, content_hash,
                run_id
         FROM dependency_observations
         WHERE product_id = ?1
         ORDER BY observation_id",
    )?;
    let rows = statement
        .query_map([product_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
                row.get::<_, String>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, Option<String>>(14)?,
                row.get::<_, Option<String>>(15)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(stored_dependency_observation)
        .collect()
}

/// Assembles the stored observation from its row tuple, parsing the
/// evidence text into the frozen shape.
#[allow(clippy::type_complexity)]
fn stored_dependency_observation(
    row: (
        i64,
        String,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
    ),
) -> Result<StoredDependencyObservation, BdlStoreError> {
    let (
        observation_id,
        product_id,
        dep_kind,
        dep_name,
        raw_quote,
        source_span,
        version_hint,
        resolved_ref_product_id,
        resolution_evidence,
        confirmed_by_human,
        extraction_method,
        extracted_by,
        observed_at,
        processor_version,
        content_hash,
        run_id,
    ) = row;
    Ok(StoredDependencyObservation {
        observation_id,
        product_id,
        dep_kind,
        dep_name,
        raw_quote,
        source_span,
        version_hint,
        resolved_ref_product_id,
        resolution_evidence: parse_resolution_evidence(resolution_evidence)?,
        confirmed_by_human: confirmed_by_human != 0,
        extraction_method,
        extracted_by,
        observed_at,
        processor_version,
        content_hash,
        run_id,
    })
}

fn download_event_kind_name(kind: DownloadEventKind) -> &'static str {
    match kind {
        DownloadEventKind::Started => "started",
        DownloadEventKind::Progress => "progress",
        DownloadEventKind::Interrupted => "interrupted",
        DownloadEventKind::Completed => "completed",
        DownloadEventKind::Cancelled => "cancelled",
        DownloadEventKind::Failed => "failed",
    }
}

fn parse_download_event_kind(value: &str) -> Result<DownloadEventKind, BdlStoreError> {
    match value {
        "started" => Ok(DownloadEventKind::Started),
        "progress" => Ok(DownloadEventKind::Progress),
        "interrupted" => Ok(DownloadEventKind::Interrupted),
        "completed" => Ok(DownloadEventKind::Completed),
        "cancelled" => Ok(DownloadEventKind::Cancelled),
        "failed" => Ok(DownloadEventKind::Failed),
        _ => Err(BdlStoreError::CorruptValue {
            field: "download event kind",
            value: value.into(),
        }),
    }
}

fn failure_kind_name(kind: DownloadFailureKind) -> &'static str {
    match kind {
        DownloadFailureKind::Policy => "policy",
        DownloadFailureKind::Unknown => "unknown",
    }
}

fn parse_failure_kind(value: &str) -> Result<DownloadFailureKind, BdlStoreError> {
    match value {
        "policy" => Ok(DownloadFailureKind::Policy),
        "unknown" => Ok(DownloadFailureKind::Unknown),
        _ => Err(BdlStoreError::CorruptValue {
            field: "download failure kind",
            value: value.into(),
        }),
    }
}

fn to_i64(value: u64, field: &'static str) -> Result<i64, BdlStoreError> {
    i64::try_from(value).map_err(|_| BdlStoreError::CorruptValue {
        field,
        value: value.to_string(),
    })
}

fn to_u64(value: i64, field: &'static str) -> Result<u64, BdlStoreError> {
    u64::try_from(value).map_err(|_| BdlStoreError::CorruptValue {
        field,
        value: value.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::download_events::DOWNLOAD_EVENT_SCHEMA_VERSION;

    const SHA_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SHA_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn started_event(download_id: &str, occurred_at: &str) -> DownloadEventV01 {
        DownloadEventV01 {
            schema_version: DOWNLOAD_EVENT_SCHEMA_VERSION.into(),
            kind: DownloadEventKind::Started,
            download_id: download_id.into(),
            attempt: 1,
            source_url: "https://booth.example.com/download/1000001/fixture".into(),
            initiated_from_page_url: Some("https://booth.example.com/items/1000001".into()),
            url_chain: Some(vec![
                "https://booth.example.com/download/1000001/fixture".into(),
                "https://cdn.example.com/materials/pack.zip".into(),
            ]),
            suggested_file_name: Some("pack.zip".into()),
            stored_path: Some("C:\\staging\\dl-1-pack.zip".into()),
            expected_bytes: Some(1024),
            received_bytes: Some(0),
            resumable: true,
            failure_kind: None,
            occurred_at: occurred_at.into(),
        }
    }

    #[test]
    fn migration_creates_explicit_format_and_full_durability() {
        let store = BdlStore::open_in_memory().unwrap();
        assert_eq!(store.pragma_i64("synchronous").unwrap(), 2);
        let connection = store.connection.lock().unwrap();
        let format: String = connection
            .query_row(
                "SELECT value FROM bdl_meta WHERE key = 'format_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(format, BDL_FORMAT_VERSION, "the store's own format is served");
        let migration: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(migration, 3, "fresh databases are born v0.3 (001 + 002 + 003)");
        let dep_table: i64 = connection
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'dependency_observations'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(dep_table, 1, "the v0.2 table exists on a fresh store");
    }

    #[test]
    fn download_events_are_deduped_on_the_unique_delivery_key() {
        let store = BdlStore::open_in_memory().unwrap();
        let event = started_event("dl-1", "2026-09-06T08:15:00.000Z");
        let (first_outcome, first) = store.append_download_event(&event).unwrap();
        assert_eq!(first_outcome, EventAppendence::Inserted);
        assert_eq!(first.event_id, 1);

        let redelivered = started_event("dl-1", "2026-09-06T08:15:00.000Z");
        let (second_outcome, second) = store.append_download_event(&redelivered).unwrap();
        assert_eq!(second_outcome, EventAppendence::Duplicate);
        assert_eq!(second.event_id, first.event_id);
        assert_eq!(store.download_events("dl-1").unwrap().len(), 1);

        let next_attempt =
            started_event("dl-1", "2026-09-06T08:16:00.000Z");
        let (third_outcome, _) = store.append_download_event(&next_attempt).unwrap();
        assert_eq!(third_outcome, EventAppendence::Inserted);
        assert_eq!(store.download_events("dl-1").unwrap().len(), 2);
    }

    #[test]
    fn download_events_roundtrip_every_transport_fact() {
        let store = BdlStore::open_in_memory().unwrap();
        store.append_download_event(&started_event("dl-1", "2026-09-06T08:15:00.000Z")).unwrap();
        let stored = &store.download_events("dl-1").unwrap()[0];
        assert_eq!(stored.kind, DownloadEventKind::Started);
        assert_eq!(stored.attempt, 1);
        assert_eq!(
            stored.url_chain.as_deref(),
            Some(&[
                "https://booth.example.com/download/1000001/fixture".to_string(),
                "https://cdn.example.com/materials/pack.zip".to_string(),
            ][..])
        );
        assert_eq!(stored.expected_bytes, Some(1024));
        assert!(stored.resumable);

        let failure = DownloadEventV01 {
            kind: DownloadEventKind::Failed,
            attempt: 3,
            stored_path: None,
            received_bytes: None,
            resumable: false,
            failure_kind: Some(DownloadFailureKind::Unknown),
            initiated_from_page_url: None,
            url_chain: None,
            suggested_file_name: None,
            expected_bytes: None,
            ..started_event("dl-2", "2026-09-06T08:20:00.000Z")
        };
        store.append_download_event(&failure).unwrap();
        let stored = &store.download_events("dl-2").unwrap()[0];
        assert_eq!(stored.failure_kind, Some(DownloadFailureKind::Unknown));
        assert_eq!(stored.stored_path, None);
        assert!(!stored.resumable);
    }

    #[test]
    fn mechanically_invalid_events_never_reach_the_database() {
        let store = BdlStore::open_in_memory().unwrap();
        let mut event = started_event("dl-1", "2026-09-06T08:15:00.000Z");
        event.schema_version = "9.9".into();
        assert!(matches!(
            store.append_download_event(&event),
            Err(BdlStoreError::InvalidEvent("schema version"))
        ));
        let mut event = started_event("dl-1", "2026-09-06T08:15:00.000Z");
        event.attempt = 0;
        assert!(matches!(
            store.append_download_event(&event),
            Err(BdlStoreError::InvalidEvent("attempt"))
        ));
    }

    #[test]
    fn artifact_lifecycle_enforces_the_legal_transitions() {
        let store = BdlStore::open_in_memory().unwrap();
        let recording = store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: SHA_A.into(),
                size_bytes: 4096,
                suggested_file_name: Some("pack.zip".into()),
                download_id: Some("dl-1".into()),
                first_seen_at: "2026-09-06T08:15:00.000Z".into(),
            })
            .unwrap();
        assert_eq!(recording.outcome, ArtifactRecordingOutcome::Created);
        assert_eq!(recording.artifact.inspection_state, ArtifactInspectionState::Untrusted);

        // The same content sighted again (re-download) never duplicates a row.
        let again = store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: SHA_A.into(),
                size_bytes: 4096,
                suggested_file_name: None,
                download_id: Some("dl-2".into()),
                first_seen_at: "2026-09-06T09:00:00.000Z".into(),
            })
            .unwrap();
        assert_eq!(again.outcome, ArtifactRecordingOutcome::Existing);
        assert_eq!(
            again.artifact.download_id.as_deref(),
            Some("dl-1"),
            "the original sighting row stays"
        );

        // A size disagreement under one content identity is corruption.
        let conflicting = store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: SHA_A.into(),
                size_bytes: 8192,
                suggested_file_name: None,
                download_id: None,
                first_seen_at: "2026-09-06T09:00:01.000Z".into(),
            })
            .unwrap_err();
        assert!(matches!(conflicting, BdlStoreError::CorruptValue { field: "artifact size", .. }));

        store
            .transition_artifact(SHA_A, ArtifactInspectionState::Inspected, "2026-09-06T08:16:00.000Z", None)
            .unwrap();
        store
            .transition_artifact(SHA_A, ArtifactInspectionState::Admitted, "2026-09-06T08:17:00.000Z", None)
            .unwrap();
        let admitted = store.artifact(SHA_A).unwrap().unwrap();
        assert_eq!(admitted.inspection_state, ArtifactInspectionState::Admitted);
        assert_eq!(admitted.inspected_at.as_deref(), Some("2026-09-06T08:16:00.000Z"));
        assert!(matches!(
            store.transition_artifact(SHA_A, ArtifactInspectionState::Rejected, "2026-09-06T08:18:00.000Z", Some("late")),
            Err(BdlStoreError::InvalidTransition { to: ArtifactInspectionState::Rejected, .. })
        ));
    }

    #[test]
    fn rejection_is_terminal_and_always_carries_a_reason() {
        let store = BdlStore::open_in_memory().unwrap();
        store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: SHA_B.into(),
                size_bytes: 1,
                suggested_file_name: Some("setup.exe".into()),
                download_id: Some("dl-3".into()),
                first_seen_at: "2026-09-06T08:15:00.000Z".into(),
            })
            .unwrap();
        assert!(matches!(
            store.transition_artifact(SHA_B, ArtifactInspectionState::Rejected, "2026-09-06T08:15:01.000Z", None),
            Err(BdlStoreError::InvalidEvent(_))
        ));
        store
            .transition_artifact(
                SHA_B,
                ArtifactInspectionState::Rejected,
                "2026-09-06T08:15:01.000Z",
                Some("extension not in the allowed list"),
            )
            .unwrap();
        let rejected = store.artifact(SHA_B).unwrap().unwrap();
        assert_eq!(rejected.inspection_state, ArtifactInspectionState::Rejected);
        assert_eq!(
            rejected.rejection_reason.as_deref(),
            Some("extension not in the allowed list")
        );
        assert!(matches!(
            store.transition_artifact(SHA_B, ArtifactInspectionState::Inspected, "2026-09-06T08:16:00.000Z", None),
            Err(BdlStoreError::InvalidTransition { .. })
        ));
    }

    #[test]
    fn mapping_requires_an_observed_product_and_is_idempotent() {
        let store = BdlStore::open_in_memory().unwrap();
        store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: SHA_A.into(),
                size_bytes: 4096,
                suggested_file_name: None,
                download_id: None,
                first_seen_at: "2026-09-06T08:15:00.000Z".into(),
            })
            .unwrap();
        assert!(
            matches!(
                store.record_artifact_mapping(SHA_A, "booth:9999999", None, None, "2026-09-06T08:20:00.000Z"),
                Err(BdlStoreError::UnknownProduct(product)) if product == "booth:9999999"
            ),
            "the mapping target must have been observed by the pipeline"
        );
        store.seed_product("booth:1000001", "1000001").unwrap();
        assert_eq!(
            store
                .record_artifact_mapping(SHA_A, "booth:1000001", Some("2000001"), Some("download"), "2026-09-06T08:20:00.000Z")
                .unwrap(),
            ArtifactMappingOutcome::Created
        );
        assert_eq!(
            store
                .record_artifact_mapping(SHA_A, "booth:1000001", None, None, "2026-09-06T08:21:00.000Z")
                .unwrap(),
            ArtifactMappingOutcome::Existing
        );
        assert!(matches!(
            store.record_artifact_mapping(SHA_B, "booth:1000001", None, None, "2026-09-06T08:22:00.000Z"),
            Err(BdlStoreError::UnknownArtifact(_))
        ));
    }

    #[test]
    fn warehouse_items_and_copies_support_the_v0_3_read_face() {
        let store = BdlStore::open_in_memory().unwrap();
        let item = store
            .create_warehouse_item("Fixture Material Pack", "imported_material", "2026-09-06T08:20:00.000Z")
            .unwrap();
        assert!(item.warehouse_item_id.starts_with("whi-"));
        assert_eq!(
            item.folder_name, item.warehouse_item_id,
            "the generated identity is the entry's folder name"
        );
        assert!(matches!(
            store.record_artifact_copy(&item.warehouse_item_id, SHA_A, "original/pack.zip", "C:\\wh\\pack.zip", CopyRole::Original, "t"),
            Err(BdlStoreError::UnknownArtifact(_))
        ));
        assert!(matches!(
            store.record_artifact_copy("whi-nope", SHA_A, "original/pack.zip", "C:\\wh\\pack.zip", CopyRole::Original, "t"),
            Err(BdlStoreError::UnknownWarehouseItem(_))
        ));

        store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: SHA_A.into(),
                size_bytes: 4096,
                suggested_file_name: Some("pack.zip".into()),
                download_id: None,
                first_seen_at: "2026-09-06T08:20:00.000Z".into(),
            })
            .unwrap();
        store
            .transition_artifact(SHA_A, ArtifactInspectionState::Inspected, "2026-09-06T08:21:00.000Z", None)
            .unwrap();
        store
            .record_artifact_copy(
                &item.warehouse_item_id,
                SHA_A,
                "original/pack.zip",
                "C:\\warehouse\\original\\pack.zip",
                CopyRole::Original,
                "2026-09-06T08:22:00.000Z",
            )
            .unwrap();
        assert!(matches!(
            store.record_artifact_copy(&item.warehouse_item_id, SHA_A, "original/pack.zip", "again", CopyRole::Original, "t"),
            Err(BdlStoreError::CorruptValue { field: "artifact copy", .. })
        ));

        let cards = store.warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].artifacts.len(), 1);
        assert_eq!(cards[0].artifacts[0].state, ArtifactInspectionVerdict::Pending);
        assert_eq!(cards[0].artifacts[0].role, CopyRole::Original);
        assert_eq!(cards[0].artifact_mode, None, "no override = follows global");
        assert_eq!(
            cards[0].effective_artifact_mode,
            ArtifactMode::UseOriginalUnitypackage
        );
        let wire = serde_json::to_value(&cards[0]).unwrap();
        assert_eq!(wire["warehouseItemId"], item.warehouse_item_id);
        assert_eq!(wire["artifacts"][0]["sizeBytes"], 4096);
        assert_eq!(wire["artifacts"][0]["role"], "original");

        // The override is a preference: set it and dynamic resolution follows;
        // clear it and the entry follows the global default again.
        store
            .set_artifact_mode(&item.warehouse_item_id, Some(ArtifactMode::GenerateVpm))
            .unwrap();
        let cards = store.warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage).unwrap();
        assert_eq!(cards[0].artifact_mode, Some(ArtifactMode::GenerateVpm));
        assert_eq!(cards[0].effective_artifact_mode, ArtifactMode::GenerateVpm);
        store.set_artifact_mode(&item.warehouse_item_id, None).unwrap();
        let cards = store.warehouse_entry_cards(ArtifactMode::GenerateVpm).unwrap();
        assert_eq!(cards[0].artifact_mode, None);
        assert_eq!(cards[0].effective_artifact_mode, ArtifactMode::GenerateVpm);
        assert!(matches!(
            store.set_artifact_mode("whi-nope", Some(ArtifactMode::GenerateVpm)),
            Err(BdlStoreError::UnknownWarehouseItem(_))
        ));

        // delete-originals removes only original rows — exercised after the
        // mapping assertions below, since it empties the entry's artifacts.
        assert!(matches!(
            store.delete_entry_originals("whi-nope"),
            Err(BdlStoreError::UnknownWarehouseItem(_))
        ));

        let detail = store.warehouse_entry_detail(&item.warehouse_item_id, ArtifactMode::UseOriginalUnitypackage).unwrap().unwrap();
        assert!(!detail.artifacts[0].source_correlated);
        store.seed_product("booth:1000001", "1000001").unwrap();
        store
            .record_artifact_mapping(SHA_A, "booth:1000001", None, None, "2026-09-06T08:23:00.000Z")
            .unwrap();
        let detail = store.warehouse_entry_detail(&item.warehouse_item_id, ArtifactMode::UseOriginalUnitypackage).unwrap().unwrap();
        assert!(detail.artifacts[0].source_correlated);
        assert_eq!(detail.artifacts[0].mapped_product_ids, vec!["booth:1000001"]);
        assert_eq!(store.warehouse_entry_detail("whi-nope", ArtifactMode::UseOriginalUnitypackage).unwrap(), None);

        let deleted = store.delete_entry_originals(&item.warehouse_item_id).unwrap();
        assert_eq!(deleted, 1);
        let cards = store.warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage).unwrap();
        assert_eq!(cards[0].artifacts.len(), 0, "generated_vpm copies would survive");
    }

    #[test]
    fn corrupt_stored_artifact_mode_surfaces_as_a_typed_error() {
        let store = BdlStore::open_in_memory().unwrap();
        let item = store
            .create_warehouse_item("Fixture", "imported_material", "2026-09-06T08:20:00.000Z")
            .unwrap();
        {
            let connection = store.connection.lock().unwrap();
            // The column carries a schema-level CHECK closed set, so SQL
            // cannot write a foreign member; the pragma simulates storage
            // drift arriving by non-SQL means — exactly the state the
            // read-face defensive layer exists for.
            connection
                .execute_batch("PRAGMA ignore_check_constraints = ON")
                .unwrap();
            connection
                .execute(
                    "UPDATE warehouse_items SET artifact_mode = 'generate_vpm-tampered'
                     WHERE warehouse_item_id = ?1",
                    params![item.warehouse_item_id],
                )
                .unwrap();
            connection
                .execute_batch("PRAGMA ignore_check_constraints = OFF")
                .unwrap();
        }
        // The read faces report the corrupt override instead of silently
        // resolving the entry to the global default (a false statement
        // about the entry) or panicking on a data-dependent expect.
        assert!(matches!(
            store.warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage),
            Err(BdlStoreError::CorruptValue { field: "artifact mode", .. })
        ));
        assert!(matches!(
            store.warehouse_entry_detail(
                &item.warehouse_item_id,
                ArtifactMode::UseOriginalUnitypackage,
            ),
            Err(BdlStoreError::CorruptValue { field: "artifact mode", .. })
        ));
    }

    #[test]
    fn corrupt_catalog_seq_surfaces_as_corruption_not_unknown_health() {
        let store = BdlStore::open_in_memory().unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO bdl_meta(key, value) VALUES ('catalog_updated_seq', 'not-a-number')",
                    [],
                )
                .unwrap();
        }
        assert!(matches!(
            store.catalog_status(),
            Err(BdlStoreError::CorruptValue { field: "catalog_updated_seq", .. })
        ));
    }

    #[test]
    fn corrupt_completed_event_poisons_the_adoptable_list_as_an_error_not_a_panic() {
        let store = BdlStore::open_in_memory().unwrap();
        let started = DownloadEventV01 {
            schema_version: crate::download_events::DOWNLOAD_EVENT_SCHEMA_VERSION.into(),
            kind: DownloadEventKind::Started,
            download_id: "dl-corrupt".into(),
            attempt: 1,
            source_url: "https://booth.example.com/download/1000001/fixture".into(),
            initiated_from_page_url: None,
            url_chain: None,
            suggested_file_name: Some("pack.zip".into()),
            stored_path: Some("C:\\staging\\dl-corrupt-pack.zip".into()),
            expected_bytes: Some(1024),
            received_bytes: Some(0),
            resumable: true,
            failure_kind: None,
            occurred_at: "2026-09-06T08:15:00.000Z".into(),
        };
        store.append_download_event(&started).unwrap();
        let mut completed = started.clone();
        completed.kind = DownloadEventKind::Completed;
        completed.received_bytes = None;
        completed.occurred_at = "2026-09-06T08:16:00.000Z".into();
        store.append_download_event(&completed).unwrap();
        // The serving face folds every history: the corrupt completed row
        // surfaces as stored corruption — never the old panic inside the
        // completion manifest, and never a silent skip dressed as an empty
        // list.
        let error = store.list_adoptable_downloads().unwrap_err();
        assert!(matches!(
            error,
            BdlStoreError::CorruptValue { field: "download_events", .. }
        ));
    }

    #[test]
    fn persisted_facts_survive_a_restart() {
        let path = std::env::temp_dir().join(format!(
            "vua-bdl-restart-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let store = BdlStore::open(&path).unwrap();
            store
                .append_download_event(&started_event("dl-1", "2026-09-06T08:15:00.000Z"))
                .unwrap();
            store
                .record_untrusted_artifact(&NewLocalArtifact {
                    artifact_sha256: SHA_A.into(),
                    size_bytes: 4096,
                    suggested_file_name: None,
                    download_id: Some("dl-1".into()),
                    first_seen_at: "2026-09-06T08:15:00.000Z".into(),
                })
                .unwrap();
            store.checkpoint().unwrap();
        }
        let reopened = BdlStore::open(&path).unwrap();
        assert_eq!(reopened.download_events("dl-1").unwrap().len(), 1);
        assert_eq!(
            reopened.artifact(SHA_A).unwrap().unwrap().inspection_state,
            ArtifactInspectionState::Untrusted
        );
        drop(reopened);
        std::fs::remove_file(&path).ok();
    }
}

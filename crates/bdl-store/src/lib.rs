//! BDL store: the AMF-private local persistence module (warehouse, download
//! event log and read-only query model over its own SQLite schema).

pub mod bdl_queries;
pub mod bdl_store;
pub mod dependency_extract;
pub mod download_events;

pub use bdl_queries::{
    availability_status, ArtifactInspectionVerdict, AvailabilityStatus, BdlQueryOperation,
    CatalogDetailResult, CatalogHealth, CatalogListParams, CatalogListResult, CatalogParamsError,
    CatalogPrice, CatalogProductDetail, CatalogProductSummary, CatalogRevision,
    CatalogStatusResult, CatalogSubproduct, CompletedDownloadRow, BDL_QUERIES_SCHEMA_VERSION,
};
pub use bdl_store::{
    ArtifactInspectionState, ArtifactMappingOutcome, ArtifactMode, ArtifactRecording,
    ArtifactRecordingOutcome, BdlStore, BdlStoreError, CopyRole, DependencyProductRow,
    DependencyResolutionEvidence, EventAppendence, NewDependencyObservation,
    NewLocalArtifact, ManagedLibraryFile, ManagedLibraryDelivery, LibraryCopyEvidence, ProductObservation, ProductObservationStatus, StoredArtifact,
    StoredArtifactCopy, StoredDependencyObservation, StoredDownloadEvent,
    ArchiveMember, StoredArchiveMember,
    StoredWarehouseItem, SubproductObservation, WarehouseArtifactFact,
    WarehouseArtifactRef, WarehouseEntryCard, WarehouseEntryDetail, WAREHOUSE_ITEM_KINDS,
    BDL_FORMAT_VERSION,
};
pub use dependency_extract::{
    extract_dependency_leads, lead_to_new_observation, DependencyLead, EXTRACTOR_ID,
    METHOD_BULLET, METHOD_EXPLICIT_HEADING, METHOD_ONE_LINE, SPAN_BODY,
};
pub use download_events::{
    backoff_for_attempt, fold_lifecycle, retry_decision, ConsumerError, DownloadEventConsumer,
    DownloadEventKind, DownloadEventV01, DownloadFailureKind, DownloadLifecycle, DownloadPhase,
    IngestOutcome, RetryDecision, StagingCompletion, DOWNLOAD_EVENT_SCHEMA_VERSION,
    MAX_DOWNLOAD_ATTEMPTS,
};

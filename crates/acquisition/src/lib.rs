//! Acquisition domain: artifact inspection, warehouse import and warehouse
//! maintenance over the BDL store.

// AppErrorV1 is a deliberately fat value type: it carries the localization
// key, params and redacted context through IPC, events and the journal. Boxed
// errors would leak through serde shapes for no wire benefit.
#![allow(clippy::result_large_err)]

pub mod artifact_inspection;
pub mod catalog_sync;
pub mod library_page;
pub mod library_download;
pub mod library_view;
pub mod library_maintenance;
pub mod recipe_selection_drafts;
pub mod warehouse_download_adopt;
pub mod warehouse_import;
pub mod warehouse_maintenance;

#[cfg(test)]
mod test_support;

pub use artifact_inspection::{
    ArtifactInspector, DownloadInspectionOutcome, DownloadInspectionRequest, InspectionError,
    InspectionPolicy, StagingRejection,
};
pub use library_page::{
    extract_library_page, is_product_page, library_item_to_observation, page_content_hash,
    LibraryPage, LibraryPageError, LibraryPageItem, LIBRARY_PAGE_PROCESSOR_VERSION,
};
pub use warehouse_download_adopt::{
    submit_warehouse_import_downloads, AdoptedDownload, DownloadAdoptError,
    WarehouseDownloadAdoptTaskResult, WarehouseDownloadAdoptTaskSpec, DownloadAdopter,
    DOWNLOADED_ENTRY_KIND,
};
pub use warehouse_import::{
    submit_warehouse_import, AutoGenerateSpec, ImportedArtifact,
    ImportError as WarehouseImportError, SkippedSourceFile, WarehouseImportReport,
    WarehouseImportTaskResult, WarehouseImporter, WarehouseImportTaskSpec,
    submit_warehouse_import_auto, IMPORT_ENTRY_KIND,
};
pub use warehouse_maintenance::{
    generate_vpm_job, submit_delete_originals, submit_generate_vpm, DeleteOriginalsResult,
    DeleteOriginalsTaskSpec, GenerateVpmResult, GenerateVpmTaskSpec, MaintenanceError,
};

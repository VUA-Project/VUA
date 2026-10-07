//! Supervised provider process host: the composition root that serves the
//! versioned application contract over stdio frames.

// AppErrorV1 is a deliberately fat value type: it carries the localization
// key, params and redacted context through IPC, events and the journal. Boxed
// errors would leak through serde shapes for no wire benefit.
#![allow(clippy::result_large_err)]

pub mod handoff_adapter;
pub mod provider_host;
#[cfg(windows)]
pub mod provider_job;

pub use handoff_adapter::EditorHandoffAdapter;
pub use provider_host::{
    production_config_from_env, run_provider_host, run_provider_host_full,
    run_provider_host_with, run_provider_host_with_downloads, run_provider_host_with_services,
    DownloadConfig, EditorPathVerifier, EnvironmentConfig, EDITOR_VERIFY_SCHEMA_VERSION,
    ENVIRONMENT_VERIFY_UNAVAILABLE, ProductionConfig, ProductionUseCaseConfig, ProjectOpsConfig,
    ProviderHostError, WarehouseConfig, PROVIDER_FRAME_VERSION,
};
#[cfg(windows)]
pub use provider_job::ProviderJobGuard;

mod deployment_routes;
mod network_routes;

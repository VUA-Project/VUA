#![recursion_limit = "512"]
//! Supervised provider process host: the composition root that serves the
//! versioned application contract over stdio frames.

// AppErrorV1 is a deliberately fat value type: it carries the localization
// key, params and redacted context through IPC, events and the journal. Boxed
// errors would leak through serde shapes for no wire benefit.
#![allow(clippy::result_large_err)]

pub mod fs_navigation;
pub mod handoff_adapter;
pub mod provider_host;
#[cfg(windows)]
pub mod provider_job;
pub mod runtime;
pub mod share_image;

pub use handoff_adapter::EditorHandoffAdapter;
pub use provider_host::{
    production_config_from_env, run_provider_host, run_provider_host_full, run_provider_host_with,
    run_provider_host_with_downloads, run_provider_host_with_legacy,
    run_provider_host_with_services, DownloadConfig, EditorPathVerifier, EnvironmentConfig,
    ProductionConfig, ProductionUseCaseConfig, ProjectOpsConfig, ProviderHostError,
    WarehouseConfig, EDITOR_VERIFY_SCHEMA_VERSION, ENVIRONMENT_VERIFY_UNAVAILABLE,
    PROVIDER_FRAME_VERSION,
};
#[cfg(windows)]
pub use provider_job::ProviderJobGuard;

mod amf_production_adapter;
mod amf_production_routes;
mod amf_release_routes;
mod amf_share_routes;
mod deployment_routes;
mod external_tool_routes;
mod game_window_routes;
mod known_packages;
mod local_diagnostics_routes;
mod network_routes;
mod play_session_routes;
mod pose_graph_routes;
mod scenario_routes;
mod terms_routes;
mod unity_hub;
pub mod unity_license;
mod unity_license_routes;

//! VUA host composition. AMF/BDL are never initialized by this executable.
fn main() {
    if let Err(error) = run() {
        eprintln!("VUA host provider failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let database = vua_provider_host::runtime::database_path()?;
    #[cfg(windows)]
    let _job = vua_provider_host::ProviderJobGuard::contain_current_process_tree()?;
    let mut roots = vua_orchestrator::EnvironmentRoots::default();
    if let Some(root) = std::env::var_os("VUA_UNITY_EDITORS_ROOT") {
        roots.unity_editors_root = root.into();
    }
    let environment = vua_provider_host::EnvironmentConfig {
        vcc_settings_candidates: roots.vcc_settings_candidates.clone(),
        roots,
    };
    let legacy = vua_provider_host::runtime::legacy_database();
    vua_provider_host::run_provider_host_with_legacy(
        vua_provider_host::runtime::stdin_reader(), std::io::stdout().lock(), database,
        None, None, None, None, None, Some(environment), None, None,
        legacy.as_deref().map(|path| (path, vua_orchestrator::LegacyTaskOwner::Host)),
    )?;
    Ok(())
}

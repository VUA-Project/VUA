//! VUA host composition. AMF/BDL are never initialized by this executable.
fn main() {
    if let Err(error) = run() {
        eprintln!("VUA host provider failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().nth(1).as_deref() == Some("--observe-system-resources") {
        return observe_resources();
    }
    let database = vua_provider_host::runtime::database_path()?;
    #[cfg(windows)]
    let _job = vua_provider_host::ProviderJobGuard::contain_host_process_tree()?;
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
        vua_provider_host::runtime::stdin_reader(),
        std::io::stdout().lock(),
        database,
        None,
        None,
        None,
        None,
        None,
        Some(environment),
        None,
        None,
        legacy
            .as_deref()
            .map(|path| (path, vua_orchestrator::LegacyTaskOwner::Host)),
    )?;
    Ok(())
}

/// Internal read-only helper mode. Exit on stdin closure or broken output;
/// no Provider handshake, migration, database or application services start.
fn observe_resources() -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{Read, Write};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let closed = Arc::new(AtomicBool::new(false));
    let input_closed = Arc::clone(&closed);
    std::thread::spawn(move || {
        let _ = std::io::stdin().read(&mut [0]);
        input_closed.store(true, Ordering::Relaxed);
    });
    let mut sampler = vua_project_manager::system_resources::Sampler::default();
    let mut output = std::io::stdout().lock();
    while !closed.load(Ordering::Relaxed) {
        serde_json::to_writer(&mut output, &sampler.sample())?;
        writeln!(output)?;
        output.flush()?;
        std::thread::sleep(std::time::Duration::from_secs(2));
    }
    Ok(())
}

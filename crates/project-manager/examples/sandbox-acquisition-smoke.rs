//! Explicit acceptance tool, never bundled with VUA. Run installs only in a fresh
//! Windows Sandbox; ordinary builds/tests and `--inspect` do not launch installers.
use serde_json::{json, Value};
use std::{
    error::Error,
    sync::Arc,
    time::{Duration, Instant},
};
use vua_orchestrator::deployment::{
    plan_deployment, DeploymentAction, DeploymentAdapter, DeploymentIntent, DeploymentPresence,
    DeploymentPurpose, DeploymentService, PicoInstallRegion,
};
use vua_orchestrator::{
    EnvironmentRoots, NanosTaskIdGenerator, SqliteTaskStore, SystemClock, TaskRuntime, TaskState,
};
use vua_project_manager::deployment_adapter::WindowsDeploymentAdapter;

const GUEST_DATA: &str = r"C:\VUA-Acquisition-Test\data";
const CONSENT: &str = "install-official-clients-in-disposable-sandbox";

fn install_context_allowed(user: &str, profile: &str, data: &str, consent: &str) -> bool {
    cfg!(windows)
        && user.eq_ignore_ascii_case("WDAGUtilityAccount")
        && profile.eq_ignore_ascii_case(r"C:\Users\WDAGUtilityAccount")
        && data.eq_ignore_ascii_case(GUEST_DATA)
        && consent == CONSENT
}

fn emit(value: Value) {
    println!("{value}");
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let (install, region) = match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["--inspect"] => (false, PicoInstallRegion::ChinaMainland),
        ["--install-vendors", "china_mainland"] => (true, PicoInstallRegion::ChinaMainland),
        ["--install-vendors", "other"] => (true, PicoInstallRegion::Other),
        _ => {
            return Err(
                "Use --inspect, or --install-vendors china_mainland|other in Windows Sandbox"
                    .into(),
            )
        }
    };
    if install
        && !install_context_allowed(
            &std::env::var("USERNAME").unwrap_or_default(),
            &std::env::var("USERPROFILE").unwrap_or_default(),
            &std::env::var("VUA_PROVIDER_DATA").unwrap_or_default(),
            &std::env::var("VUA_SANDBOX_INSTALL_CONSENT").unwrap_or_default(),
        )
    {
        return Err(
            "Installation refused: use the prepared disposable Windows Sandbox configuration"
                .into(),
        );
    }
    let intent = DeploymentIntent {
        purposes: vec![DeploymentPurpose::DesktopPlay, DeploymentPurpose::PicoPcvr],
        editor_root: r"C:\Program Files\Unity\Hub\Editor".into(),
        use_mirrors: false,
        pico_region: Some(region),
    };
    let adapter = Arc::new(WindowsDeploymentAdapter::new(EnvironmentRoots::default()));
    let before = adapter.observe(&intent);
    emit(json!({"kind":"before", "region":region, "observations":before}));
    if !install {
        return Ok(());
    }
    // Existing/partial clients make this an invalid clean baseline. Never reinstall them.
    for component in ["steam", "pico_runtime", "vrchat", "steamvr"] {
        if !before
            .iter()
            .any(|f| f.component == component && f.presence == DeploymentPresence::Missing)
        {
            return Err(format!("Clean baseline refused: {component} is not absent").into());
        }
    }
    std::fs::create_dir_all(GUEST_DATA)?;
    let store = Arc::new(SqliteTaskStore::open(
        std::path::Path::new(GUEST_DATA).join("tasks.db"),
    )?);
    if !store.tasks()?.is_empty() {
        return Err("Use a fresh Sandbox session, not an existing acceptance database".into());
    }
    let runtime = TaskRuntime::with_sqlite(
        store.clone(),
        Arc::new(SystemClock),
        Arc::new(NanosTaskIdGenerator::default()),
    )?;
    let service = DeploymentService::new(adapter.clone(), runtime);
    let desktop = DeploymentIntent {
        purposes: vec![DeploymentPurpose::DesktopPlay],
        pico_region: None,
        ..intent.clone()
    };
    let plan = service.plan(&desktop)?;
    emit(json!({"kind":"desktop_plan", "plan":plan}));
    if plan.steps.iter().any(|s| {
        !matches!(
            s.action,
            DeploymentAction::InstallSteam | DeploymentAction::ManualInstall
        )
    }) {
        return Err("Unexpected action in the clean desktop plan".into());
    }
    let accepted = service
        .execute(
            plan.intent,
            &plan.digest,
            "sandbox-desktop-install",
            "sandbox-acceptance",
        )
        .map_err(|error| error.code)?;
    emit(json!({"kind":"accepted", "receipt":accepted}));
    let deadline = Instant::now() + Duration::from_secs(70 * 60);
    let mut revision = 0;
    loop {
        for event in store.events_after(&accepted.task_id, revision)? {
            revision = event.revision;
            emit(
                json!({"kind":"desktop_event", "revision":revision, "state":event.state, "payload":event.payload}),
            );
        }
        let snapshot = service
            .runtime
            .snapshot(&accepted.task_id)
            .ok_or("Missing accepted task")?;
        if snapshot.poisoned {
            return Err("Accepted task lost persistence; inspect guest output".into());
        }
        if snapshot.state.is_terminal() {
            break;
        }
        if Instant::now() >= deadline {
            return Err("Acceptance wait timed out; inspect guest, do not auto-retry".into());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    let task = store
        .task(&accepted.task_id)?
        .ok_or("Missing stored task")?;
    emit(
        json!({"kind":"desktop_result", "state":task.state, "result":task.result, "error":task.error}),
    );
    let steam_passed = task.state == TaskState::SucceededWithWarnings
        && task.result.as_ref().is_some_and(|r| {
            r["outcome"] == "manual_required"
                && r["nextStep"]["component"] == "vrchat"
                && r["prerequisitesReady"] == false
        })
        && adapter
            .observe(&intent)
            .iter()
            .any(|f| f.component == "steam" && f.presence == DeploymentPresence::Verified);
    // The adapter is exercised directly for PICO: a clean guest has no Steam library games.
    // This proves acquisition/native execution/reinspection, not the complete PICO play route.
    let started = Instant::now();
    let pico_result = adapter.install(&intent, DeploymentAction::InstallPicoRuntime, None, &mut |activity| {
        emit(json!({"kind":"pico_activity", "elapsedMs":started.elapsed().as_millis(), "activity":activity}));
        Ok(())
    });
    let after = adapter.observe(&intent);
    let pico_passed = pico_result.is_ok()
        && after
            .iter()
            .any(|f| f.component == "pico_runtime" && f.presence == DeploymentPresence::Verified);
    let fresh = plan_deployment(&intent, &after, None)?;
    emit(
        json!({"kind":"after", "observations":after, "plan":fresh, "picoError":pico_result.err()}),
    );
    emit(
        json!({"kind":"summary", "steamDesktopInstallAndHandoff":steam_passed, "picoAdapterInstallAndReinspect":pico_passed,
        "region":region, "functionalVerification":"not_run", "hostUacVerification":"not_run"}),
    );
    if !steam_passed || !pico_passed {
        return Err("At least one real installation check failed; retain guest evidence".into());
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        emit(json!({"kind":"acceptance_error", "message":error.to_string()}));
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_profile_cannot_launch_native_installation() {
        assert!(!install_context_allowed(
            "developer",
            r"C:\Users\developer",
            GUEST_DATA,
            CONSENT
        ));
        assert!(!install_context_allowed(
            "WDAGUtilityAccount",
            r"C:\Users\developer",
            GUEST_DATA,
            CONSENT
        ));
    }
    #[test]
    fn guest_needs_exact_data_scope_and_explicit_consent() {
        assert!(!install_context_allowed(
            "WDAGUtilityAccount",
            r"C:\Users\WDAGUtilityAccount",
            r"C:\Program Files",
            CONSENT
        ));
        assert!(!install_context_allowed(
            "WDAGUtilityAccount",
            r"C:\Users\WDAGUtilityAccount",
            GUEST_DATA,
            ""
        ));
        assert_eq!(
            install_context_allowed(
                "WDAGUtilityAccount",
                r"C:\Users\WDAGUtilityAccount",
                GUEST_DATA,
                CONSENT
            ),
            cfg!(windows)
        );
    }
}

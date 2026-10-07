//! Safety/acceptance tests use synthetic facts, never installed software or user projects.
#![allow(clippy::result_large_err)]
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};
use vua_orchestrator::deployment::*;
use vua_orchestrator::{
    NanosTaskIdGenerator, SqliteTaskStore, SystemClock, TaskEventKind, TaskRecoveryDisposition,
    TaskRuntime, TaskState,
};

fn intent(purposes: Vec<DeploymentPurpose>) -> DeploymentIntent {
    DeploymentIntent {
        purposes,
        editor_root: r"C:\VUA Test\Editors".into(),
        use_mirrors: true,
    }
}

#[test]
fn development_admission_accepts_only_the_declared_pair_and_keeps_global_first() {
    for version in ["2022.3.22f1", "2022.3.22f1c1"] {
        assert!(accepted_development_editor(version));
    }
    for version in [
        "2022.3.22f1c2",
        "2022.3.23f1",
        "2022.3.22f1c1-extra",
        "2022.3.22f1 ",
    ] {
        assert!(!accepted_development_editor(version));
    }
    let policy = EditorDownloadPolicy::new(DownloadRegion::ChinaMainland, true);
    assert_eq!(
        policy.editor_editions,
        [EditorEdition::Global, EditorEdition::China]
    );
}
fn fact(component: &str, presence: DeploymentPresence) -> DeploymentObservation {
    DeploymentObservation {
        component: component.into(),
        presence,
        location: None,
        version: None,
    }
}
fn ready_play() -> Vec<DeploymentObservation> {
    vec![
        fact("steam", DeploymentPresence::Verified),
        fact("vrchat", DeploymentPresence::Verified),
    ]
}
fn store_runtime() -> (Arc<SqliteTaskStore>, TaskRuntime) {
    let store = Arc::new(SqliteTaskStore::open_in_memory().unwrap());
    let runtime = TaskRuntime::with_sqlite(
        store.clone(),
        Arc::new(SystemClock),
        Arc::new(NanosTaskIdGenerator::default()),
    )
    .unwrap();
    (store, runtime)
}
fn wait(runtime: &TaskRuntime, id: &str) -> TaskState {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let task = runtime.snapshot(id).unwrap();
        assert!(!task.poisoned, "task unexpectedly lost persistence");
        if task.state.is_terminal() {
            return task.state;
        }
        assert!(Instant::now() < deadline, "task did not finish");
        std::thread::sleep(Duration::from_millis(2));
    }
}
struct FakeAdapter {
    facts: Mutex<Vec<DeploymentObservation>>,
    installs: AtomicUsize,
    installer: Mutex<Option<DeploymentInstaller>>,
    fail: bool,
    hub_fallback: bool,
    boundary: Option<(mpsc::Sender<()>, Mutex<mpsc::Receiver<()>>)>,
}
impl FakeAdapter {
    fn new(facts: Vec<DeploymentObservation>) -> Self {
        Self {
            installer: Mutex::new(
                facts
                    .iter()
                    .any(|f| {
                        f.component == "unity_cli" && f.presence == DeploymentPresence::Verified
                    })
                    .then(test_installer),
            ),
            facts: Mutex::new(facts),
            installs: AtomicUsize::new(0),
            fail: false,
            hub_fallback: false,
            boundary: None,
        }
    }
}
impl DeploymentAdapter for FakeAdapter {
    fn observe(&self, _intent: &DeploymentIntent) -> Vec<DeploymentObservation> {
        self.facts.lock().unwrap().clone()
    }
    fn installer(&self, _intent: &DeploymentIntent) -> Option<DeploymentInstaller> {
        self.installer.lock().unwrap().clone()
    }
    fn install(
        &self,
        _intent: &DeploymentIntent,
        action: DeploymentAction,
        confirmed: &DeploymentInstaller,
        report: &mut DeploymentReporter<'_>,
    ) -> Result<(), &'static str> {
        assert_eq!(self.installer.lock().unwrap().as_ref(), Some(confirmed));
        self.installs.fetch_add(1, Ordering::SeqCst);
        report(DeploymentActivity {
            completed_bytes: Some(1024),
            total_bytes: Some(2048),
            ..DeploymentActivity::from_source(
                DeploymentPhase::Downloading,
                EditorDownloadSource::Nounitycn,
            )
        })?;
        if let Some((entered, release)) = &self.boundary {
            entered.send(()).unwrap();
            release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
        if self.fail {
            return Err("vua.deployment.install_failed");
        }
        if self.hub_fallback && action == DeploymentAction::InstallEditor {
            report(DeploymentActivity {
                editor_version: Some(vua_orchestrator::PRODUCTION_TARGET),
                cause: Some("vua.deployment.editor_regional_redirect"),
                ..DeploymentActivity::from_source(
                    DeploymentPhase::SourceFailed,
                    EditorDownloadSource::Nounitycn,
                )
            })?;
            report(DeploymentActivity {
                editor_version: Some(CHINA_EDITOR_TARGET),
                cause: Some("vua.deployment.install_failed"),
                ..DeploymentActivity::new(DeploymentPhase::InstallationFailed)
            })?;
            return Err("vua.deployment.hub_fallback_required");
        }
        let component = match action {
            DeploymentAction::InstallUnityCli => {
                self.installer.lock().unwrap().as_mut().unwrap().kind =
                    DeploymentInstallerKind::UnityCli;
                "unity_cli"
            }
            DeploymentAction::InstallEditor => "unity_editor",
            DeploymentAction::AddAndroidModules => "android_modules",
            _ => panic!("unsupported action"),
        };
        self.facts
            .lock()
            .unwrap()
            .iter_mut()
            .find(|f| f.component == component)
            .unwrap()
            .presence = DeploymentPresence::Verified;
        Ok(())
    }
}
fn test_installer() -> DeploymentInstaller {
    DeploymentInstaller {
        kind: DeploymentInstallerKind::UnityCli,
        location: r"C:\Unity Tools\unity.exe".into(),
        version: "1.0.0-beta.11".into(),
        file_sha256: "a".repeat(64),
        editor_root: r"C:\VUA Test\Editors".into(),
    }
}
fn creator_facts() -> Vec<DeploymentObservation> {
    vec![
        fact("unity_cli", DeploymentPresence::Verified),
        fact("unity_editor", DeploymentPresence::Missing),
        fact("android_modules", DeploymentPresence::Missing),
    ]
}

#[test]
fn play_never_requires_unity_or_steamvr_and_pico_requires_both_runtimes() {
    let plan = plan_deployment(
        &intent(vec![DeploymentPurpose::DesktopPlay]),
        &ready_play(),
        None,
    )
    .unwrap();
    assert_eq!(
        plan.steps
            .iter()
            .map(|s| s.component.as_str())
            .collect::<Vec<_>>(),
        ["steam", "vrchat"]
    );
    assert!(plan.prerequisites_ready);
    let pico = plan_deployment(
        &intent(vec![DeploymentPurpose::PicoPcvr]),
        &ready_play(),
        None,
    )
    .unwrap();
    assert_eq!(pico.steps.len(), 4);
    assert!(pico.steps[2..]
        .iter()
        .all(|s| s.action == DeploymentAction::Inspect));
    assert!(!pico.prerequisites_ready);
}

#[test]
fn canonical_consent_binds_observations_and_refuses_ambiguity() {
    let a = intent(vec![
        DeploymentPurpose::PcAvatar,
        DeploymentPurpose::DesktopPlay,
    ]);
    let b = intent(vec![
        DeploymentPurpose::DesktopPlay,
        DeploymentPurpose::PcAvatar,
    ]);
    let mut facts = ready_play();
    facts.extend(creator_facts());
    let original = plan_deployment(&a, &facts, Some(test_installer())).unwrap();
    assert_eq!(
        original.digest,
        plan_deployment(&b, &facts, Some(test_installer()))
            .unwrap()
            .digest
    );
    facts[0].location = Some(r"D:\Steam".into());
    let changed = plan_deployment(&b, &facts, Some(test_installer())).unwrap();
    assert_eq!(
        confirm_deployment(&changed, &original.digest),
        Err("vua.deployment.plan_changed")
    );
    facts.push(fact("steam", DeploymentPresence::Verified));
    assert_eq!(
        plan_deployment(&a, &facts, Some(test_installer())).unwrap_err(),
        "vua.deployment.ambiguous_observation"
    );
}

#[test]
fn source_priority_and_mirror_preference_are_visible_and_bound_to_consent() {
    let mut request = intent(vec![DeploymentPurpose::PcAvatar]);
    let mainland = plan_deployment_with_region(
        &request,
        &creator_facts(),
        Some(test_installer()),
        DownloadRegion::ChinaMainland,
    )
    .unwrap();
    assert_eq!(
        mainland.download_policy.as_ref().unwrap().sources,
        [
            EditorDownloadSource::Official,
            EditorDownloadSource::Nounitycn
        ]
    );
    assert_eq!(
        mainland.steps[1].official_url.as_deref(),
        Some(UNITY_OFFICIAL_EDITOR_SOURCE)
    );
    for region in [DownloadRegion::Other, DownloadRegion::Unknown] {
        let plan =
            plan_deployment_with_region(&request, &creator_facts(), Some(test_installer()), region)
                .unwrap();
        assert_eq!(
            plan.download_policy.as_ref().unwrap().sources,
            [
                EditorDownloadSource::Official,
                EditorDownloadSource::Nounitycn
            ]
        );
        assert_eq!(
            plan.steps[1].official_url.as_deref(),
            Some(UNITY_OFFICIAL_EDITOR_SOURCE)
        );
        assert_eq!(
            confirm_deployment(&plan, &mainland.digest),
            Err("vua.deployment.plan_changed")
        );
    }
    request.use_mirrors = false;
    let official_only = plan_deployment_with_region(
        &request,
        &creator_facts(),
        Some(test_installer()),
        DownloadRegion::ChinaMainland,
    )
    .unwrap();
    let policy = official_only.download_policy.as_ref().unwrap();
    assert_eq!(policy.sources, [EditorDownloadSource::Official]);
    assert!(!policy.mirrors_enabled);
    assert_eq!(policy.hub_fallback_url, UNITY_HUB_INSTALL_LINK);
    assert_eq!(
        confirm_deployment(&official_only, &mainland.digest),
        Err("vua.deployment.plan_changed")
    );
}

#[test]
fn shared_intent_vectors_reject_windows_aliases_and_unbounded_input() {
    let vectors: serde_json::Value = serde_json::from_str(include_str!(
        "../../../schemas/environment-deployment/v0.1/intent-vectors.json"
    ))
    .unwrap();
    for case in vectors.as_array().unwrap() {
        let accepted = serde_json::from_value::<DeploymentIntent>(case["intent"].clone())
            .is_ok_and(|v| v.validate().is_ok());
        assert_eq!(
            accepted,
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn parameter_schema_rejects_extra_commands_and_missing_confirmation() {
    let schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../schemas/environment-deployment/v0.1/request.schema.json"
    ))
    .unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let request_intent = intent(vec![DeploymentPurpose::PcAvatar]);
    assert!(validator.is_valid(&serde_json::json!({"intent":request_intent})));
    assert!(validator
        .is_valid(&serde_json::json!({"intent":request_intent,"confirmedDigest":"a".repeat(64)})));
    assert!(!validator
        .is_valid(&serde_json::json!({"intent":request_intent,"confirmedDigest":"short"})));
    assert!(
        !validator.is_valid(&serde_json::json!({"intent":request_intent,"executable":"cmd.exe"}))
    );
}

#[test]
fn a_manual_handoff_is_not_a_ready_environment() {
    let (store, runtime) = store_runtime();
    let adapter = Arc::new(FakeAdapter::new(vec![
        fact("unity_cli", DeploymentPresence::Missing),
        fact("unity_editor", DeploymentPresence::Missing),
    ]));
    let service = DeploymentService::new(adapter.clone(), runtime);
    let plan = service
        .plan(&intent(vec![DeploymentPurpose::PcAvatar]))
        .unwrap();
    let accepted = service
        .execute(plan.intent, &plan.digest, "manual-1", "corr-test")
        .unwrap();
    assert_eq!(
        wait(&service.runtime, &accepted.task_id),
        TaskState::SucceededWithWarnings
    );
    let result = store
        .task(&accepted.task_id)
        .unwrap()
        .unwrap()
        .result
        .unwrap();
    assert_eq!(result["outcome"], "manual_required");
    assert_eq!(result["prerequisitesReady"], false);
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 0);
}

#[test]
fn exhausted_download_sources_handoff_to_hub_and_replay_does_not_retry() {
    let (store, runtime) = store_runtime();
    let mut fake = FakeAdapter::new(creator_facts());
    fake.hub_fallback = true;
    let adapter = Arc::new(fake);
    let service = DeploymentService::new(adapter.clone(), runtime);
    let plan = service
        .plan(&intent(vec![DeploymentPurpose::QuestAvatar]))
        .unwrap();
    let receipt = service
        .execute(plan.intent.clone(), &plan.digest, "hub-fallback", "corr")
        .unwrap();
    assert_eq!(
        wait(&service.runtime, &receipt.task_id),
        TaskState::SucceededWithWarnings
    );
    let result = store
        .task(&receipt.task_id)
        .unwrap()
        .unwrap()
        .result
        .unwrap();
    assert_eq!(result["outcome"], "manual_required");
    assert_eq!(result["handoff"], "unity_hub");
    assert_eq!(result["sourceFailures"][0]["source"], "nounitycn");
    assert_eq!(result["sourceFailures"][0]["editorVersion"], "2022.3.22f1");
    assert_eq!(
        result["installationFailures"][0]["editorVersion"],
        CHINA_EDITOR_TARGET
    );
    assert_eq!(
        result["installationFailures"][0]["cause"],
        "vua.deployment.install_failed"
    );
    assert_eq!(
        result["sourceFailures"][0]["cause"],
        "vua.deployment.editor_regional_redirect"
    );
    assert_eq!(result["handoffUrl"], UNITY_HUB_INSTALL_LINK);
    assert_eq!(result["prerequisitesReady"], false);
    assert_eq!(result["functionalVerification"], "not_run");
    let events = store.events_after(&receipt.task_id, 0).unwrap();
    let download = events
        .iter()
        .find(|e| e.payload["params"]["phase"] == "downloading")
        .unwrap();
    assert_eq!(download.payload["completed"], 1);
    assert_eq!(download.payload["total"], 3);
    assert_eq!(download.payload["params"]["completedBytes"], 1024);
    assert_eq!(download.payload["params"]["totalBytes"], 2048);
    assert_eq!(result["nextStep"]["component"], "unity_hub");
    // Android installation is not attempted after an Editor download handoff.
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 1);
    let replay = service
        .execute(plan.intent, &plan.digest, "hub-fallback", "corr-replay")
        .unwrap();
    assert_eq!(replay.task_id, receipt.task_id);
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 1);
}

#[test]
fn installation_reinspection_is_durable_and_replay_does_not_install_again() {
    let (store, runtime) = store_runtime();
    let adapter = Arc::new(FakeAdapter::new(creator_facts()));
    let service = DeploymentService::new(adapter.clone(), runtime);
    let plan = service
        .plan(&intent(vec![DeploymentPurpose::QuestAvatar]))
        .unwrap();
    let first = service
        .execute(plan.intent.clone(), &plan.digest, "install-1", "corr-test")
        .unwrap();
    assert_eq!(wait(&service.runtime, &first.task_id), TaskState::Succeeded);
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 2);
    let result = store.task(&first.task_id).unwrap().unwrap().result.unwrap();
    assert_eq!(result["prerequisitesReady"], true);
    assert_eq!(result["functionalVerification"], "not_run");
    assert!(store
        .events_after(&first.task_id, 0)
        .unwrap()
        .iter()
        .any(|e| e.kind == TaskEventKind::Progress && e.payload["params"]["phase"] == "verified"));
    // The old plan is now stale. Idempotent acceptance must run before reinspection.
    assert_eq!(
        service
            .execute(
                plan.intent.clone(),
                &plan.digest,
                "install-1",
                "corr-replay"
            )
            .unwrap()
            .task_id,
        first.task_id
    );
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 2);
    let new_plan = service.plan(&plan.intent).unwrap();
    assert!(new_plan.prerequisites_ready);
    assert_eq!(
        service
            .execute(new_plan.intent, &new_plan.digest, "install-1", "corr-test")
            .unwrap_err()
            .code,
        "vua.task.idempotency_conflict"
    );
    let recovered = TaskRuntime::with_sqlite(
        store,
        Arc::new(SystemClock),
        Arc::new(NanosTaskIdGenerator::default()),
    )
    .unwrap();
    let restarted = DeploymentService::new(adapter.clone(), recovered);
    assert_eq!(
        restarted
            .execute(plan.intent, &plan.digest, "install-1", "corr-restart")
            .unwrap()
            .task_id,
        first.task_id
    );
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 2);
}

#[test]
fn stale_consent_and_install_failures_never_report_success() {
    for stale in [true, false] {
        let (store, runtime) = store_runtime();
        let mut fake = FakeAdapter::new(creator_facts());
        fake.fail = true;
        let adapter = Arc::new(fake);
        let service = DeploymentService::new(adapter.clone(), runtime);
        let plan = service
            .plan(&intent(vec![DeploymentPurpose::PcAvatar]))
            .unwrap();
        if stale {
            adapter.facts.lock().unwrap()[0].location = Some(r"D:\Other Hub".into());
        }
        let accepted = service
            .execute(plan.intent, &plan.digest, "failure-1", "corr-test")
            .unwrap();
        assert_eq!(wait(&service.runtime, &accepted.task_id), TaskState::Failed);
        let task = store.task(&accepted.task_id).unwrap().unwrap();
        assert_eq!(
            task.error.unwrap().code,
            if stale {
                "vua.deployment.plan_changed"
            } else {
                "vua.deployment.install_failed"
            }
        );
        assert!(task.result.is_none());
        assert_eq!(adapter.installs.load(Ordering::SeqCst), usize::from(!stale));
    }
}

#[test]
fn external_cancel_waits_for_safe_boundary_and_second_install_is_refused() {
    let (store, runtime) = store_runtime();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let mut fake = FakeAdapter::new(creator_facts());
    fake.boundary = Some((entered_tx, Mutex::new(release_rx)));
    let adapter = Arc::new(fake);
    let service = DeploymentService::new(adapter.clone(), runtime);
    let plan = service
        .plan(&intent(vec![DeploymentPurpose::QuestAvatar]))
        .unwrap();
    let accepted = service
        .execute(plan.intent.clone(), &plan.digest, "cancel-1", "corr-test")
        .unwrap();
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let other = service
        .execute(plan.intent, &plan.digest, "cancel-2", "corr-test")
        .unwrap();
    assert_eq!(wait(&service.runtime, &other.task_id), TaskState::Failed);
    assert_eq!(
        store
            .task(&other.task_id)
            .unwrap()
            .unwrap()
            .error
            .unwrap()
            .code,
        "vua.deployment.busy"
    );
    store
        .request_cancellation_idempotent(
            "cancel-request",
            "test",
            &accepted.task_id,
            None,
            "2026-09-30T00:00:00Z",
        )
        .unwrap();
    assert_eq!(
        service.runtime.snapshot(&accepted.task_id).unwrap().state,
        TaskState::Running
    );
    release_tx.send(()).unwrap();
    assert_eq!(
        wait(&service.runtime, &accepted.task_id),
        TaskState::Cancelled
    );
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 1);
    let events = store.events_after(&accepted.task_id, 0).unwrap();
    assert!(events
        .windows(2)
        .all(|p| p[1].revision == p[0].revision + 1));
}

#[test]
fn recovered_work_is_inspect_required_and_never_resubmitted() {
    let (store, _) = store_runtime();
    store
        .accept_task(&vua_orchestrator::NewTask {
            task_id: "interrupted".into(),
            correlation_id: "corr-old".into(),
            occurred_at: "2026-09-30T00:00:00Z".into(),
        })
        .unwrap();
    let recovered = TaskRuntime::with_sqlite(
        store,
        Arc::new(SystemClock),
        Arc::new(NanosTaskIdGenerator::default()),
    )
    .unwrap();
    assert_eq!(
        recovered
            .snapshot("interrupted")
            .unwrap()
            .recovery_disposition,
        TaskRecoveryDisposition::InspectRequired
    );
}

#[test]
fn cli_deployment_does_not_require_hub_and_bootstrap_does_not_expand_consent() {
    let (_, runtime) = store_runtime();
    let mut facts = creator_facts();
    facts.push(fact("unity_hub", DeploymentPresence::Missing));
    let adapter = Arc::new(FakeAdapter::new(facts));
    let service = DeploymentService::new(adapter.clone(), runtime);
    let plan = service
        .plan(&intent(vec![DeploymentPurpose::PcAvatar]))
        .unwrap();
    assert!(plan.steps.iter().all(|s| s.component != "unity_hub"));
    let receipt = service
        .execute(plan.intent, &plan.digest, "without-hub", "corr")
        .unwrap();
    assert_eq!(
        wait(&service.runtime, &receipt.task_id),
        TaskState::Succeeded
    );

    let (_, runtime) = store_runtime();
    let mut facts = creator_facts();
    facts[0].presence = DeploymentPresence::Missing;
    let fake = FakeAdapter::new(facts);
    let mut reviewed = test_installer();
    reviewed.kind = DeploymentInstallerKind::UnityCliBootstrap;
    *fake.installer.lock().unwrap() = Some(reviewed);
    let adapter = Arc::new(fake);
    let service = DeploymentService::new(adapter.clone(), runtime);
    let plan = service
        .plan(&intent(vec![DeploymentPurpose::PcAvatar]))
        .unwrap();
    assert_eq!(plan.steps[0].action, DeploymentAction::InstallUnityCli);
    assert_eq!(plan.steps[1].action, DeploymentAction::ManualInstall);
    let receipt = service
        .execute(plan.intent.clone(), &plan.digest, "bootstrap", "corr")
        .unwrap();
    assert_eq!(
        wait(&service.runtime, &receipt.task_id),
        TaskState::SucceededWithWarnings
    );
    assert_eq!(adapter.installs.load(Ordering::SeqCst), 1);
    let next = service.plan(&plan.intent).unwrap();
    assert_ne!(plan.digest, next.digest);
    assert_eq!(next.steps[1].action, DeploymentAction::InstallEditor);
}

#[test]
fn installer_changes_invalidate_consent_without_starting_an_install() {
    for changed in ["hash", "kind", "location"] {
        let (_, runtime) = store_runtime();
        let adapter = Arc::new(FakeAdapter::new(creator_facts()));
        let service = DeploymentService::new(adapter.clone(), runtime);
        let plan = service
            .plan(&intent(vec![DeploymentPurpose::PcAvatar]))
            .unwrap();
        {
            let mut identity = adapter.installer.lock().unwrap();
            let i = identity.as_mut().unwrap();
            match changed {
                "hash" => i.file_sha256 = "b".repeat(64),
                "kind" => i.kind = DeploymentInstallerKind::HubCli,
                _ => i.location = r"D:\Other Tools\unity.exe".into(),
            }
        }
        let receipt = service
            .execute(plan.intent, &plan.digest, changed, "corr-drift")
            .unwrap();
        assert_eq!(wait(&service.runtime, &receipt.task_id), TaskState::Failed);
        assert_eq!(adapter.installs.load(Ordering::SeqCst), 0);
    }
}

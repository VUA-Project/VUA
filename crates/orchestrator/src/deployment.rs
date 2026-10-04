//! Purpose-driven deployment policy. This module owns decisions, never vendor commands.
//!
//! Observations come from an adapter; neither a directory name nor a successful installer
//! exit establishes readiness. Plans are deterministic and confirmed by digest. Reinspection
//! before execution refuses changed prerequisites instead of silently expanding consent.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DEPLOYMENT_SCHEMA: &str = "vua.environment-deployment/v0.1";
/// Optional backup index; the official Unity route always comes first.
pub const UNITY_EDITOR_SOURCE: &str =
    "https://www.nounitycn.top/download?v=unityhub%3A%2F%2F2022.3.22f1%2F887be4894c44";
pub const UNITY_OFFICIAL_EDITOR_SOURCE: &str =
    "https://unity.com/releases/editor/whats-new/2022.3.22f1";
pub const UNITY_HUB_INSTALL_LINK: &str = "unityhub://2022.3.22f1/887be4894c44";

/// Author-approved N1 development compatibility pair. Keep the observed identity;
/// this admission rule does not rewrite the frozen Editor-inspection classification.
pub const CHINA_EDITOR_TARGET: &str = "2022.3.22f1c1";
pub fn accepted_development_editor(version: &str) -> bool {
    matches!(version, crate::PRODUCTION_TARGET | CHINA_EDITOR_TARGET)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorEdition {
    Global,
    China,
}

impl EditorEdition {
    pub fn version(self) -> &'static str {
        match self {
            Self::Global => crate::PRODUCTION_TARGET,
            Self::China => CHINA_EDITOR_TARGET,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum DownloadRegion {
    ChinaMainland,
    Other,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EditorDownloadSource {
    Official,
    Nounitycn,
}

/// Official-first in every region. Region remains an observation for guidance;
/// the user's setting controls whether the backup mirror may be contacted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorDownloadPolicy {
    pub region: DownloadRegion,
    pub mirrors_enabled: bool,
    pub sources: Vec<EditorDownloadSource>,
    pub editor_editions: Vec<EditorEdition>,
    pub hub_fallback_url: String,
}

impl EditorDownloadPolicy {
    pub fn new(region: DownloadRegion, mirrors_enabled: bool) -> Self {
        let sources = match mirrors_enabled {
            false => vec![EditorDownloadSource::Official],
            true => vec![
                EditorDownloadSource::Official,
                EditorDownloadSource::Nounitycn,
            ],
        };
        Self {
            region,
            mirrors_enabled,
            sources,
            editor_editions: vec![EditorEdition::Global, EditorEdition::China],
            hub_fallback_url: UNITY_HUB_INSTALL_LINK.into(),
        }
    }
}

fn default_mirrors() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentPurpose {
    DesktopPlay,
    PicoPcvr,
    PcAvatar,
    QuestAvatar,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentIntent {
    pub purposes: Vec<DeploymentPurpose>,
    /// An absolute Editor installation root, not a command or executable supplied by UI.
    pub editor_root: String,
    /// Desktop preference; omission from an older request keeps mirrors enabled.
    #[serde(default = "default_mirrors")]
    pub use_mirrors: bool,
}

impl DeploymentIntent {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.purposes.is_empty() || self.purposes.len() > 4 {
            return Err("vua.deployment.invalid_intent");
        }
        let mut unique = self.purposes.clone();
        unique.sort();
        unique.dedup();
        let path = &self.editor_root;
        // Reject device/UNC/relative paths and control characters before any adapter IO.
        let bytes = path.as_bytes();
        if unique.len() != self.purposes.len()
            || bytes.len() < 4
            || bytes.len() > 240
            || !bytes[0].is_ascii_alphabetic()
            || bytes[1] != b':'
            || !matches!(bytes[2], b'\\' | b'/')
            || path
                .chars()
                .any(|c| c.is_control() || matches!(c, '"' | '*' | '?' | '<' | '>' | '|'))
            || path[2..].contains(':')
            || path[3..].split(['\\', '/']).any(|part| {
                let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
                part.is_empty()
                    || part.ends_with(['.', ' '])
                    || matches!(
                        base.as_str(),
                        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                    )
                    || base
                        .strip_prefix("COM")
                        .or_else(|| base.strip_prefix("LPT"))
                        .is_some_and(|n| {
                            matches!(
                                n,
                                "1" | "2"
                                    | "3"
                                    | "4"
                                    | "5"
                                    | "6"
                                    | "7"
                                    | "8"
                                    | "9"
                                    | "¹"
                                    | "²"
                                    | "³"
                            )
                        })
            })
        {
            return Err("vua.deployment.invalid_location");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentPresence {
    Verified,
    Missing,
    Unsuitable,
    DetectionFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentObservation {
    pub component: String,
    pub presence: DeploymentPresence,
    pub location: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentAction {
    Retain,
    ManualInstall,
    Inspect,
    InstallEditor,
    AddAndroidModules,
    InstallUnityCli,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentStep {
    pub component: String,
    pub action: DeploymentAction,
    pub reason: DeploymentPresence,
    pub location: Option<String>,
    pub version: Option<String>,
    /// Backend-owned documentation/download destinations; opening one is not installation.
    pub official_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentPlan {
    pub schema_version: String,
    pub intent: DeploymentIntent,
    pub steps: Vec<DeploymentStep>,
    pub digest: String,
    /// Prerequisites observed, not a real project/device/SDK functional acceptance.
    pub prerequisites_ready: bool,
    /// Identity of the installation authority observed with this plan. Binds consent to
    /// the exact binary, command family and destination, including between component steps.
    pub installer: Option<DeploymentInstaller>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_policy: Option<EditorDownloadPolicy>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentInstaller {
    pub kind: DeploymentInstallerKind,
    pub location: String,
    pub version: String,
    pub file_sha256: String,
    pub editor_root: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentInstallerKind {
    UnityCli,
    HubCli,
    /// Reviewed official artifact to acquire, not a claim that it is already installed.
    UnityCliBootstrap,
}

/// Adapter facts within a prerequisite step. Byte counts describe downloaded/checked
/// data, never fabricated installer percentages. Failure codes exclude raw vendor text.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentActivity {
    pub phase: DeploymentPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editor_version: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<EditorDownloadSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cause: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DeploymentPhase {
    ResolvingSource,
    Downloading,
    Verifying,
    Installing,
    Inspecting,
    Registering,
    SourceFailed,
    InstallationFailed,
    CacheRejected,
}

impl DeploymentActivity {
    pub fn new(phase: DeploymentPhase) -> Self {
        Self {
            phase,
            editor_version: None,
            source: None,
            completed_bytes: None,
            total_bytes: None,
            cause: None,
        }
    }
    pub fn from_source(phase: DeploymentPhase, source: EditorDownloadSource) -> Self {
        Self {
            source: Some(source),
            ..Self::new(phase)
        }
    }
}

/// A failed report stops acquisition before its next write or installer launch. While
/// a native installer is running, cancellation still waits for that process boundary.
pub type DeploymentReporter<'a> = dyn FnMut(DeploymentActivity) -> Result<(), &'static str> + 'a;

/// Infrastructure implements these facts/actions in project-manager. New installers must
/// not bypass this boundary or change the plan's meanings in React/Electron handlers.
pub trait DeploymentAdapter: Send + Sync {
    fn download_region(&self) -> DownloadRegion {
        DownloadRegion::Unknown
    }
    fn observe(&self, intent: &DeploymentIntent) -> Vec<DeploymentObservation>;
    fn installer(&self, intent: &DeploymentIntent) -> Option<DeploymentInstaller>;
    fn install(
        &self,
        intent: &DeploymentIntent,
        action: DeploymentAction,
        confirmed: &DeploymentInstaller,
        report: &mut DeploymentReporter<'_>,
    ) -> Result<(), &'static str>;
}

pub fn plan_deployment(
    intent: &DeploymentIntent,
    facts: &[DeploymentObservation],
    installer: Option<DeploymentInstaller>,
) -> Result<DeploymentPlan, &'static str> {
    plan_deployment_with_region(intent, facts, installer, DownloadRegion::Unknown)
}

pub fn plan_deployment_with_region(
    intent: &DeploymentIntent,
    facts: &[DeploymentObservation],
    installer: Option<DeploymentInstaller>,
    region: DownloadRegion,
) -> Result<DeploymentPlan, &'static str> {
    intent.validate()?;
    let play = intent.purposes.iter().any(|p| {
        matches!(
            p,
            DeploymentPurpose::DesktopPlay | DeploymentPurpose::PicoPcvr
        )
    });
    let pico = intent.purposes.contains(&DeploymentPurpose::PicoPcvr);
    let create = intent.purposes.iter().any(|p| {
        matches!(
            p,
            DeploymentPurpose::PcAvatar | DeploymentPurpose::QuestAvatar
        )
    });
    let quest = intent.purposes.contains(&DeploymentPurpose::QuestAvatar);
    let download_policy = create.then(|| EditorDownloadPolicy::new(region, intent.use_mirrors));
    let installer = if create { installer } else { None };
    if installer.as_ref().is_some_and(|i| {
        i.location.is_empty()
            || i.version.is_empty()
            || i.editor_root != intent.editor_root
            || i.file_sha256.len() != 64
            || !i
                .file_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
    }) {
        return Err("vua.deployment.invalid_installer");
    }
    let mut required = Vec::new();
    if play {
        required.extend([
            ("steam", "https://store.steampowered.com/about/"),
            ("vrchat", "https://store.steampowered.com/app/438100/"),
        ]);
    }
    if pico {
        required.extend([
            ("steamvr", "https://store.steampowered.com/app/250820/"),
            (
                "pico_runtime",
                "https://www.picoxr.com/software/pico-connect",
            ),
        ]);
    }
    if create {
        let installer_component = if installer
            .as_ref()
            .is_some_and(|i| i.kind == DeploymentInstallerKind::HubCli)
        {
            ("unity_hub", "https://unity.com/download")
        } else {
            (
                "unity_cli",
                "https://docs.unity.com/en-us/unity-cli/use-unity-cli",
            )
        };
        required.extend([
            installer_component,
            ("unity_editor", UNITY_OFFICIAL_EDITOR_SOURCE),
        ]);
    }
    if quest {
        required.push((
            "android_modules",
            "https://docs.unity.com/en-us/unity-cli/use-unity-cli",
        ));
    }
    let mut steps = Vec::new();
    for (component, url) in required {
        if facts.iter().filter(|f| f.component == component).count() > 1 {
            return Err("vua.deployment.ambiguous_observation");
        }
        let fact = facts.iter().find(|f| f.component == component);
        let reason = fact.map_or(DeploymentPresence::DetectionFailed, |f| f.presence);
        let installer_ready = installer
            .as_ref()
            .is_some_and(|i| i.kind != DeploymentInstallerKind::UnityCliBootstrap);
        let action = match reason {
            DeploymentPresence::Verified => DeploymentAction::Retain,
            DeploymentPresence::DetectionFailed | DeploymentPresence::Unsuitable => {
                DeploymentAction::Inspect
            }
            DeploymentPresence::Missing if component == "unity_editor" && installer_ready => {
                DeploymentAction::InstallEditor
            }
            DeploymentPresence::Missing if component == "android_modules" && installer_ready => {
                DeploymentAction::AddAndroidModules
            }
            DeploymentPresence::Missing
                if component == "unity_cli"
                    && installer
                        .as_ref()
                        .is_some_and(|i| i.kind == DeploymentInstallerKind::UnityCliBootstrap) =>
            {
                DeploymentAction::InstallUnityCli
            }
            DeploymentPresence::Missing => DeploymentAction::ManualInstall,
        };
        steps.push(DeploymentStep {
            component: component.into(),
            action,
            reason,
            location: fact.and_then(|f| f.location.clone()).or_else(|| {
                (action == DeploymentAction::InstallUnityCli)
                    .then(|| installer.as_ref().unwrap().location.clone())
            }),
            version: fact.and_then(|f| f.version.clone()).or_else(|| {
                (action == DeploymentAction::InstallUnityCli)
                    .then(|| installer.as_ref().unwrap().version.clone())
            }),
            official_url: Some(url.into()),
        });
    }
    // Bind consent to exact intent, observations, destinations and actions; timestamps do
    // not make an unchanged plan stale. Canonical purpose ordering avoids incidental drift.
    let mut normalized = intent.clone();
    normalized.purposes.sort();
    let bytes = serde_json::to_vec(&(&normalized, &steps, &installer, &download_policy))
        .expect("plain deployment values serialize");
    let digest = Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(DeploymentPlan {
        schema_version: DEPLOYMENT_SCHEMA.into(),
        intent: normalized,
        prerequisites_ready: steps.iter().all(|s| s.action == DeploymentAction::Retain),
        steps,
        digest,
        installer,
        download_policy,
    })
}

/// Verify confirmation at the last safe boundary. The caller must serialize machine
/// mutations and inspect again after every automatic action; there is no OS rollback.
pub fn confirm_deployment(plan: &DeploymentPlan, digest: &str) -> Result<(), &'static str> {
    if plan.digest != digest {
        return Err("vua.deployment.plan_changed");
    }
    if plan
        .steps
        .iter()
        .any(|s| s.action == DeploymentAction::Inspect)
    {
        return Err("vua.deployment.inspect_required");
    }
    Ok(())
}

use crate::{AppErrorV1, ErrorCategory, SubmitRequest, TaskExit, TaskRuntime};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

/// Application use case: serialize deployment tasks, persist progress through TaskRuntime,
/// and stop at an explicit manual handoff. Domain policy remains independent of the Provider.
pub struct DeploymentService {
    adapter: Arc<dyn DeploymentAdapter>,
    pub runtime: TaskRuntime,
    active: Arc<AtomicBool>,
}

struct DeploymentLease(Arc<AtomicBool>);

fn observed_plan(
    adapter: &dyn DeploymentAdapter,
    intent: &DeploymentIntent,
) -> Result<DeploymentPlan, &'static str> {
    let region = if intent.purposes.iter().any(|p| {
        matches!(
            p,
            DeploymentPurpose::PcAvatar | DeploymentPurpose::QuestAvatar
        )
    }) {
        adapter.download_region()
    } else {
        DownloadRegion::Unknown
    };
    plan_deployment_with_region(
        intent,
        &adapter.observe(intent),
        adapter.installer(intent),
        region,
    )
}
impl Drop for DeploymentLease {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl DeploymentService {
    pub fn new(adapter: Arc<dyn DeploymentAdapter>, runtime: TaskRuntime) -> Self {
        Self {
            adapter,
            runtime,
            active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn plan(&self, intent: &DeploymentIntent) -> Result<DeploymentPlan, &'static str> {
        intent.validate()?;
        observed_plan(self.adapter.as_ref(), intent)
    }

    pub fn execute(
        &self,
        intent: DeploymentIntent,
        digest: &str,
        command_id: &str,
        correlation: &str,
    ) -> Result<crate::CommandAcceptedV1, AppErrorV1> {
        let error = |code| deployment_error(code, correlation);
        intent.validate().map_err(error)?;
        if command_id.is_empty()
            || command_id.len() > 128
            || command_id.chars().any(char::is_control)
            || digest.len() != 64
            || !digest
                .bytes()
                .all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'))
        {
            return Err(error("vua.deployment.invalid_confirmation"));
        }
        let mut intent = intent;
        intent.purposes.sort();
        let adapter = self.adapter.clone();
        let active = self.active.clone();
        let confirmed = digest.to_owned();
        let correlation = correlation.to_owned();
        let fingerprint =
            serde_json::to_string(&(&intent, digest)).expect("plain intent serializes");
        self.runtime.submit_idempotent(SubmitRequest { correlation_id: Some(correlation.clone()), timeout: None,
            job: Box::new(move |ctx| {
                if active.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
                    return Err(deployment_error("vua.deployment.busy", &correlation));
                }
                let _lease = DeploymentLease(active);
                let fresh = observed_plan(adapter.as_ref(), &intent).map_err(|e| deployment_error(e, &correlation))?;
                confirm_deployment(&fresh, &confirmed).map_err(|e| deployment_error(e, &correlation))?;
                for (index, step) in fresh.steps.iter().enumerate() {
                    if ctx.check_cancel() { return Ok(TaskExit::Cancelled); }
                    ctx.emit_progress(progress(step, index, fresh.steps.len(), "started"));
                    // A lost progress write freezes execution just like a cancel request.
                    if ctx.check_cancel() { return Ok(TaskExit::Cancelled); }
                    match step.action {
                        DeploymentAction::Retain => {},
                        DeploymentAction::ManualInstall | DeploymentAction::Inspect => {
                            ctx.warn();
                            return Ok(TaskExit::Done(serde_json::json!({"schemaVersion": DEPLOYMENT_SCHEMA,
                                "operation": "environment.executeDeployment", "outcome": "manual_required",
                                "nextStep": step, "prerequisitesReady": false, "functionalVerification": "not_run"})));
                        },
                        action => {
                            let mut source_failures = Vec::new();
                            let mut installation_failures = Vec::new();
                            let result = adapter.install(&intent, action, fresh.installer.as_ref().ok_or_else(|| deployment_error("vua.deployment.installer_unavailable", &correlation))?, &mut |activity| {
                                if ctx.check_cancel() { return Err("vua.deployment.cancelled"); }
                                if matches!(activity.phase, DeploymentPhase::SourceFailed) {
                                    source_failures.push(serde_json::to_value(&activity).expect("activity serializes"));
                                }
                                if matches!(activity.phase, DeploymentPhase::InstallationFailed) {
                                    installation_failures.push(serde_json::to_value(&activity).expect("activity serializes"));
                                }
                                let mut payload = progress(step, index, fresh.steps.len(), "started");
                                let facts = serde_json::to_value(activity).expect("activity serializes");
                                payload["params"].as_object_mut().unwrap().extend(facts.as_object().unwrap().clone());
                                ctx.emit_progress(payload);
                                if ctx.check_cancel() { Err("vua.deployment.cancelled") } else { Ok(()) }
                            });
                            if ctx.check_cancel() { return Ok(TaskExit::Cancelled); }
                            if result == Err("vua.deployment.hub_fallback_required") && action == DeploymentAction::InstallEditor {
                                if ctx.check_cancel() { return Ok(TaskExit::Cancelled); }
                                ctx.warn();
                                return Ok(TaskExit::Done(serde_json::json!({"schemaVersion": DEPLOYMENT_SCHEMA,
                                    "operation":"environment.executeDeployment", "outcome":"manual_required",
                                    "sourceFailures":source_failures,
                                    "installationFailures":installation_failures,
                                    "handoff":"unity_hub", "handoffUrl":UNITY_HUB_INSTALL_LINK,
                                    "nextStep": {"component":"unity_hub", "action":"manual_install", "reason":"missing",
                                        "location":null, "version":null, "officialUrl":"https://unity.com/download"},
                                    "prerequisitesReady":false, "functionalVerification":"not_run"})));
                            }
                            result.map_err(|e| deployment_error(e, &correlation)
                                .with_param("component", crate::ParamValue::Text(step.component.clone())))?;
                        },
                    }
                    // Cancellation arriving during an installer takes effect only after the
                    // adapter returns and has reobserved its output. No implicit rollback.
                    if ctx.check_cancel() { return Ok(TaskExit::Cancelled); }
                    ctx.emit_progress(progress(step, index + 1, fresh.steps.len(), "verified"));
                }
                let after = observed_plan(adapter.as_ref(), &intent).map_err(|e| deployment_error(e, &correlation))?;
                if !after.prerequisites_ready { return Err(deployment_error("vua.deployment.verification_failed", &correlation)); }
                Ok(TaskExit::Done(serde_json::json!({"schemaVersion": DEPLOYMENT_SCHEMA,
                    "operation": "environment.executeDeployment", "outcome": "prerequisites_verified",
                    "editor": after.steps.iter().find(|s| s.component == "unity_editor"),
                    "prerequisitesReady": true, "functionalVerification": "not_run"})))
            }) }, "environment.executeDeployment", command_id, &fingerprint)
    }
}

/// Reuse the frozen task-progress envelope. Counts are completed prerequisite steps, not
/// invented download percentages. Only closed component/action facts enter localized params.
fn progress(
    step: &DeploymentStep,
    completed: usize,
    total: usize,
    phase: &str,
) -> serde_json::Value {
    let action = serde_json::to_value(step.action).expect("action serializes");
    serde_json::json!({"completed": completed, "total": total,
        "messageKey": format!("deployment.actions.{}", action.as_str().unwrap_or("inspect")),
        "params": {"operation": "environment.executeDeployment", "component": step.component,
            "action": action, "phase": phase}})
}

fn deployment_error(code: &str, correlation: &str) -> AppErrorV1 {
    let category = if code.contains("invalid_") {
        ErrorCategory::Validation
    } else if matches!(
        code,
        "vua.deployment.process_failed"
            | "vua.deployment.install_failed"
            | "vua.deployment.vendor_install_failed"
            | "vua.deployment.vendor_result_unreadable"
            | "vua.deployment.verification_failed"
            | "vua.deployment.cli_acquisition_failed"
            | "vua.deployment.cli_integrity_failed"
            | "vua.deployment.editor_download_failed"
            | "vua.deployment.editor_integrity_failed"
            | "vua.deployment.editor_source_changed"
            | "vua.deployment.editor_registration_failed"
            | "vua.deployment.elevation_required"
            | "vua.deployment.elevation_declined"
    ) {
        ErrorCategory::ExternalFailure
    } else if matches!(
        code,
        "vua.deployment.installer_unavailable" | "vua.deployment.unsupported_platform"
    ) {
        ErrorCategory::Dependency
    } else {
        ErrorCategory::Conflict
    };
    AppErrorV1::new(
        code,
        category,
        "errors.deployment.failed",
        correlation.to_owned(),
    )
    .with_recoverable(true)
}

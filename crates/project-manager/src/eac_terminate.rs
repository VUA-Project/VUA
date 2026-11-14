//! M6 EAC package (proposal 006 R1b): the termination step — the LAST
//! element of the EAC face, behind the full safety chain.
//!
//! One call, [`terminate_candidate`], runs the whole R6 plan step:
//!
//! 1. **Re-verify** (R3): the four elements — name, path, signature, pid
//!    liveness — are re-checked against the allowlist entry. Only a
//!    Verified verdict may proceed; anything else is a typed refusal and
//!    nothing is opened with termination rights.
//! 2. **R4 guard**: a running VRChat process is an active session —
//!    refused (from-wide), independent of the allowlist.
//! 3. **Pre-state evidence** (R6): the full eac-probe snapshot is taken
//!    before the step and travels beside the receipt.
//! 4. **Terminate + await**: OpenProcess with PROCESS_TERMINATE |
//!    PROCESS_QUERY_LIMITED_INFORMATION, TerminateProcess, then
//!    WaitForSingleObject with a bounded timeout.
//! 5. **Post-check** (R6): the snapshot source is re-read to confirm the
//!    pid is gone.
//!
//! Failure semantics (R6): a failed termination is never retried
//! implicitly — the `failed` receipt carries `inspectRequired: true` and
//! the half-state waits for an explicit decision (retry = the
//! user-triggered clean-then-redo). The ORIGINAL 006 hard boundaries hold
//! (R7): no services, no drivers, no EAC/game files, no batch, no
//! automation without confirmation — this primitive is one individually
//! confirmed plan step invoked through the versioned application
//! contract.

use serde::Serialize;

use crate::eac_allowlist::AllowlistEntryV01;
use crate::eac_probe::probe_eac;
use crate::eac_verify::{verify_candidate, Verdict};
use crate::environment_managers::ManagerRoots;

pub const EAC_TERMINATE_SCHEMA_VERSION: &str = "vua.eac-terminate/v0.1";

/// How long the step waits for the process to exit after TerminateProcess.
pub const EXIT_WAIT_TIMEOUT_MS: u32 = 5_000;

/// Guard/failure codes (vua.eac_terminate.*).
pub mod codes {
    pub const VERIFICATION_NOT_VERIFIED: &str = "vua.eac_terminate.verification_not_verified";
    pub const ACTIVE_VRCHAT_SESSION: &str = "vua.eac_terminate.active_vrchat_session";
    pub const PROCESS_UNOPENABLE: &str = "vua.eac_terminate.process_unopenable";
    pub const OPEN_FAILED: &str = "vua.eac_terminate.open_failed";
    pub const TERMINATE_FAILED: &str = "vua.eac_terminate.terminate_failed";
    pub const EXIT_TIMEOUT: &str = "vua.eac_terminate.exit_timeout";
    pub const POSTCHECK_FAILED: &str = "vua.eac_terminate.postcheck_failed";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminationGuard {
    VerificationNotVerified,
    ActiveVrchatSession,
    ProcessUnopenable,
    OpenFailed,
    TerminateFailed,
    ExitTimeout,
    PostcheckFailed,
}

/// The versioned receipt. `kind`/guards follow
/// `schemas/eac-terminate/v0.1/termination.schema.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminationReceiptV01 {
    pub schema_version: &'static str,
    pub kind: &'static str,
    pub pid: u32,
    pub process_name: String,
    pub task_correlation: String,
    pub verified: bool,
    pub pre_check: PreCheck,
    // terminated
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_confirmed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_check: Option<PostCheck>,
    // refused / failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guard: Option<TerminationGuard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inspect_required: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreCheck {
    pub vrchat_session_active: bool,
    pub eac_present: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostCheck {
    pub pid_gone: bool,
}

fn refused(
    pid: u32,
    name: &str,
    correlation: &str,
    pre: PreCheck,
    guard: TerminationGuard,
    detail: impl Into<String>,
) -> TerminationReceiptV01 {
    TerminationReceiptV01 {
        schema_version: EAC_TERMINATE_SCHEMA_VERSION,
        kind: "refused",
        pid,
        process_name: name.to_owned(),
        task_correlation: correlation.to_owned(),
        verified: false,
        pre_check: pre,
        terminated_at: None,
        exit_confirmed: None,
        post_check: None,
        guard: Some(guard),
        detail: Some(detail.into()),
        inspect_required: None,
    }
}

fn failed(
    pid: u32,
    name: &str,
    correlation: &str,
    pre: PreCheck,
    guard: TerminationGuard,
    detail: impl Into<String>,
) -> TerminationReceiptV01 {
    TerminationReceiptV01 {
        schema_version: EAC_TERMINATE_SCHEMA_VERSION,
        kind: "failed",
        pid,
        process_name: name.to_owned(),
        task_correlation: correlation.to_owned(),
        verified: true,
        pre_check: pre,
        terminated_at: None,
        exit_confirmed: None,
        post_check: None,
        guard: Some(guard),
        detail: Some(detail.into()),
        inspect_required: Some(true),
    }
}

/// The caller-supplied coordinates of one termination step. `source` is
/// injectable so tests run on synthetic fixtures (R8) while the real
/// window uses the Toolhelp source.
pub struct TerminationRequest<'a> {
    pub pid: u32,
    pub entry: &'a AllowlistEntryV01,
    pub vcc_settings_candidates: &'a [std::path::PathBuf],
    pub roots: &'a ManagerRoots,
    pub source: &'a dyn crate::eac_probe::ProcessSnapshotSource,
}

/// The full termination plan step. Only a Verified four-element
/// re-verification may reach the termination call; an active VRChat
/// session refuses independently of the allowlist (R4).
pub fn terminate_candidate(
    request: &TerminationRequest<'_>,
    task_correlation: &str,
    clock: &dyn vua_orchestrator::Clock,
) -> TerminationReceiptV01 {
    let name = request.entry.process_name.clone();
    let pid = request.pid;

    // R6 evidence-before-step: the full read-only probe snapshot.
    let pre_snapshot = probe_eac(request.source, clock);
    let pre = PreCheck {
        vrchat_session_active: pre_snapshot.vrchat_session_active,
        eac_present: pre_snapshot.eac_present,
    };

    // R4 guard: an active VRChat session refuses regardless of the
    // allowlist (from-wide).
    if pre.vrchat_session_active {
        return refused(
            pid,
            &name,
            task_correlation,
            pre,
            TerminationGuard::ActiveVrchatSession,
            "a running VRChat process is an active session — termination is refused (R4)",
        );
    }

    // R3 four-element re-verification. Only Verified proceeds.
    let verification = verify_candidate(pid, request.entry, request.source);
    if verification.verdict != Verdict::Verified {
        return refused(
            pid,
            &name,
            task_correlation,
            pre,
            TerminationGuard::VerificationNotVerified,
            format!(
                "the four-element re-verification did not pass — refusing (R3): {:?}",
                verification.checks
            ),
        );
    }

    terminate_open_and_wait(pid, &name, task_correlation, pre, request.source, clock)
}

/// The platform half: open with termination rights, terminate, await
/// exit, and re-check the table. Windows-only (the product platform).
/// Test hook: the open→terminate→await→post-check primitive without the
/// R3 gate (used to verify the primitive itself on a controlled process).
/// Gated behind `test-hooks` (or `cfg(test)`): a termination primitive is
/// a bypass face and must not sit on the default public surface.
#[cfg(all(windows, any(test, feature = "test-hooks")))]
pub fn terminate_open_and_wait_for_test(
    pid: u32,
    name: &str,
    task_correlation: &str,
    pre: PreCheck,
    post_source: &dyn crate::eac_probe::ProcessSnapshotSource,
    clock: &dyn vua_orchestrator::Clock,
) -> TerminationReceiptV01 {
    terminate_open_and_wait(pid, name, task_correlation, pre, post_source, clock)
}

#[cfg(windows)]
fn terminate_open_and_wait(
    pid: u32,
    name: &str,
    task_correlation: &str,
    pre: PreCheck,
    post_source: &dyn crate::eac_probe::ProcessSnapshotSource,
    clock: &dyn vua_orchestrator::Clock,
) -> TerminationReceiptV01 {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };

    // PROCESS_SYNCHRONIZE is required for the exit wait; QUERY for any
    // later re-reads through the same handle.
    let rights = PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE;
    let handle = unsafe { OpenProcess(rights, 0, pid) };
    if handle.is_null() {
        return failed(
            pid,
            name,
            task_correlation,
            pre,
            TerminationGuard::OpenFailed,
            format!(
                "OpenProcess(PROCESS_TERMINATE) failed: {}",
                std::io::Error::last_os_error()
            ),
        );
    }

    let terminate_ok = unsafe { TerminateProcess(handle, 1) };
    if terminate_ok == 0 {
        // A "already exited" race surfaces here; it is still a failed step
        // (no implicit success) — the task face re-inspects.
        unsafe { CloseHandle(handle) };
        return failed(
            pid,
            name,
            task_correlation,
            pre,
            TerminationGuard::TerminateFailed,
            format!(
                "TerminateProcess failed: {}",
                std::io::Error::last_os_error()
            ),
        );
    }

    let wait = unsafe { WaitForSingleObject(handle, EXIT_WAIT_TIMEOUT_MS) };
    unsafe { CloseHandle(handle) };
    if wait != WAIT_OBJECT_0 {
        return failed(
            pid,
            name,
            task_correlation,
            pre,
            TerminationGuard::ExitTimeout,
            format!(
                "the process did not exit within {EXIT_WAIT_TIMEOUT_MS} ms — inspect_required (no retry)"
            ),
        );
    }

    // Post-check (R6): re-read the table to confirm the pid is gone.
    let pid_gone = match post_source.snapshot() {
        Ok(table) => !table.iter().any(|candidate| candidate.pid == pid),
        Err(error) => {
            return failed(
                pid,
                name,
                task_correlation,
                pre,
                TerminationGuard::PostcheckFailed,
                format!("the post-check enumeration failed: {error}"),
            )
        }
    };
    if !pid_gone {
        return failed(
            pid,
            name,
            task_correlation,
            pre,
            TerminationGuard::PostcheckFailed,
            "the post-check still sees the pid — inspect_required (no retry)",
        );
    }

    TerminationReceiptV01 {
        schema_version: EAC_TERMINATE_SCHEMA_VERSION,
        kind: "terminated",
        pid,
        process_name: name.to_owned(),
        task_correlation: task_correlation.to_owned(),
        verified: true,
        pre_check: pre,
        terminated_at: Some(clock.now_rfc3339()),
        exit_confirmed: Some(true),
        post_check: Some(PostCheck { pid_gone: true }),
        guard: None,
        detail: None,
        inspect_required: None,
    }
}

#[cfg(not(windows))]
fn terminate_open_and_wait(
    pid: u32,
    name: &str,
    task_correlation: &str,
    pre: PreCheck,
    _post_source: &dyn crate::eac_probe::ProcessSnapshotSource,
    _clock: &dyn vua_orchestrator::Clock,
) -> TerminationReceiptV01 {
    failed(
        pid,
        name,
        task_correlation,
        pre,
        TerminationGuard::OpenFailed,
        "the termination step requires Windows",
    )
}

impl TerminationReceiptV01 {
    pub fn refused_step(
        pid: u32,
        name: &str,
        correlation: &str,
        pre: PreCheck,
        guard: TerminationGuard,
        detail: impl Into<String>,
    ) -> Self {
        refused(pid, name, correlation, pre, guard, detail)
    }

    pub fn terminated_step(
        pid: u32,
        name: &str,
        correlation: &str,
        pre: PreCheck,
        terminated_at: String,
    ) -> Self {
        Self {
            schema_version: EAC_TERMINATE_SCHEMA_VERSION,
            kind: "terminated",
            pid,
            process_name: name.to_owned(),
            task_correlation: correlation.to_owned(),
            verified: true,
            pre_check: pre,
            terminated_at: Some(terminated_at),
            exit_confirmed: Some(true),
            post_check: Some(PostCheck { pid_gone: true }),
            guard: None,
            detail: None,
            inspect_required: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::fs;
    use std::path::Path;

    #[test]
    fn serializes_terminated_refused_and_failed_receipts_without_null_optional_fields() {
        let pre_clean = PreCheck {
            vrchat_session_active: false,
            eac_present: true,
        };
        let terminated = TerminationReceiptV01::terminated_step(
            39012,
            "easyanticheat.exe",
            "cmd-w25-eac-terminate-01",
            pre_clean.clone(),
            "2026-09-09T07:30:00.000Z".to_owned(),
        );
        let terminated_json = serde_json::to_value(&terminated).unwrap();

        let fixture_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../schemas/eac-terminate/v0.1/fixtures/termination.terminated.json");
        let fixture_value: Value =
            serde_json::from_str(&fs::read_to_string(fixture_path).unwrap()).unwrap();
        assert_eq!(terminated_json, fixture_value);

        let refused_receipt = TerminationReceiptV01::refused_step(
            41224,
            "vrchat.exe",
            "cmd-w25-eac-terminate-02",
            PreCheck {
                vrchat_session_active: true,
                eac_present: true,
            },
            TerminationGuard::ActiveVrchatSession,
            "active session",
        );
        let refused_json = serde_json::to_value(&refused_receipt).unwrap();
        assert!(refused_json.get("terminatedAt").is_none());
        assert!(refused_json.get("exitConfirmed").is_none());
        assert!(refused_json.get("postCheck").is_none());
        assert!(refused_json.get("inspectRequired").is_none());
        assert_eq!(refused_json["guard"], json!("active_vrchat_session"));

        let failed_receipt = failed(
            39012,
            "start_protected_game.exe",
            "cmd-fail",
            pre_clean,
            TerminationGuard::OpenFailed,
            "open failed",
        );
        let failed_json = serde_json::to_value(&failed_receipt).unwrap();
        assert!(failed_json.get("terminatedAt").is_none());
        assert_eq!(failed_json["inspectRequired"], json!(true));
        assert_eq!(failed_json["guard"], json!("open_failed"));
    }
}

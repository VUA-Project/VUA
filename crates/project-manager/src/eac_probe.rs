//! M6 EAC package (proposal 006 R1a, accepted by user ruling U1 with the
//! eight-point approval semantics): read-only EAC conflict detection — the
//! DEFAULT and, in this slice, the ONLY capability of the EAC face.
//!
//! Discipline (006 R1–R8 + approval points):
//! - one targeted pass over the process table, never a scan of user data,
//!   never a write (R1a "read-only detection: evidence + readiness +
//!   human path");
//! - an active VRChat process IS an active session — the conservative R4
//!   rule (from-wide refusal) is a *finding* here; the refusal itself
//!   belongs to the termination face, which does not exist in v0.1;
//! - approval point 2: with the allowlist empty and no real-machine
//!   evidence, the termination capability reports **unavailable** — the
//!   frozen open set has no other state in v0.1;
//! - R8: CI runs on synthetic process fixtures (structurally
//!   representative, zero real EAC interaction); the real-machine probe is
//!   the explicitly ignored manual test.
//!
//! Process enumeration is injectable ([`ProcessSnapshotSource`]) so every
//! unit test runs on synthetic fixtures; the OS-backed source lives in
//! [`os_source`] and is exercised only by the ignored manual test. Shapes
//! are pinned by `schemas/eac-probe/v0.1/probe.schema.json`.

use serde::Serialize;

use vua_orchestrator::{Clock, FindingSeverity, ManagerDiagnostic, PRODUCTION_TARGET};

pub const EAC_PROBE_SCHEMA_VERSION: &str = "vua.eac-probe/v0.1";

/// Read-face diagnostics (vua.eac_probe.*).
pub mod codes {
    pub const GUIDANCE_CLOSE_GAME_FIRST: &str = "vua.eac_probe.guidance_close_game_first";
    pub const GUIDANCE_ALLOWLIST_UNAVAILABLE: &str = "vua.eac_probe.guidance_allowlist_unavailable";
    pub const GUIDANCE_NO_EAC_FOUND: &str = "vua.eac_probe.guidance_no_eac_found";
    pub const ENUMERATION_FAILED: &str = "vua.eac_probe.enumeration_failed";
}

/// The process classes the probe distinguishes. Classification is by
/// lower-cased executable name; anything not in the table is simply not a
/// finding (the probe never speculates about unrelated processes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProcessKind {
    EacLoader,
    EacService,
    VrchatGame,
    VrchatOverlay,
}

impl ProcessKind {
    fn classify(image_name: &str) -> Option<Self> {
        let name = image_name.to_ascii_lowercase();
        match name.as_str() {
            "easyanticheat.exe" | "easyanticheat_eos.exe" => Some(ProcessKind::EacLoader),
            "easyanticheatservice.exe" => Some(ProcessKind::EacService),
            "vrchat.exe" => Some(ProcessKind::VrchatGame),
            _ => None,
        }
    }
}

/// One EAC/VRChat-relevant process finding. `path` is null when the probe
/// could not read it — an unreadable path is never guessed (006 R3 keeps
/// name/pid/path/identity verification for the termination face; the read
/// face reports exactly what it saw).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessFinding {
    pub name: String,
    pub pid: u32,
    pub kind: ProcessKind,
    pub path: Option<String>,
}

/// What the probe saw, with the R4 session rule applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    pub conclusion: ReadinessConclusion,
    pub guidance_code: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessConclusion {
    NoEacFound,
    EacActiveWithVrchatSession,
    EacResidualNoSession,
}

/// The honest termination-capability face. v0.1 freezes exactly one state:
/// unavailable while the allowlist is empty and no real-machine evidence
/// exists (approval point 2 — stronger than a closed switch; the interface
/// must present it as 不可用). The state open set grows only through R2
/// (real-machine evidence produces the first allowlist entry) and the R1b
/// termination face with its own confirmation chain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminationCapability {
    pub state: &'static str,
    pub reason: &'static str,
}

/// Versioned probe snapshot pinned by
/// `schemas/eac-probe/v0.1/probe.schema.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EacProbeSnapshotV01 {
    pub schema_version: &'static str,
    pub captured_at: String,
    pub production_target: &'static str,
    pub processes: Vec<ProcessFinding>,
    pub vrchat_session_active: bool,
    pub eac_present: bool,
    pub readiness: Readiness,
    pub termination_capability: TerminationCapability,
    pub diagnostics: Vec<ManagerDiagnostic>,
}

/// One process-table entry as the snapshot source reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessEntry {
    pub image_name: String,
    pub pid: u32,
    pub path: Option<String>,
}

/// The injectable process-table source. Implementations MUST be read-only
/// and MUST NOT terminate, suspend, or inject into anything (R1a/R7).
pub trait ProcessSnapshotSource {
    /// The full process table snapshot. Names are image file names
    /// (e.g. "vrchat.exe").
    fn snapshot(&self) -> std::io::Result<Vec<ProcessEntry>>;
}

/// Assembles the read-only EAC conflict snapshot from a process snapshot.
/// Deterministic for a given snapshot: findings are sorted by (kind, pid).
pub fn probe_eac(source: &dyn ProcessSnapshotSource, clock: &dyn Clock) -> EacProbeSnapshotV01 {
    let mut diagnostics = Vec::new();
    let entries = match source.snapshot() {
        Ok(entries) => entries,
        Err(error) => {
            diagnostics.push(ManagerDiagnostic {
                code: codes::ENUMERATION_FAILED,
                severity: FindingSeverity::Error,
                detail: format!("process enumeration failed: {error}"),
            });
            return empty_snapshot(clock, diagnostics);
        }
    };

    let mut processes: Vec<ProcessFinding> = entries
        .into_iter()
        .filter_map(|entry| {
            ProcessKind::classify(&entry.image_name).map(|kind| ProcessFinding {
                name: entry.image_name,
                pid: entry.pid,
                kind,
                path: entry.path,
            })
        })
        .collect();
    // OS order is arbitrary; a snapshot must be deterministic.
    processes.sort_by_key(|finding| (finding.kind, finding.pid));

    let vrchat_session_active = processes
        .iter()
        .any(|finding| finding.kind == ProcessKind::VrchatGame);
    let eac_present = processes.iter().any(|finding| {
        matches!(
            finding.kind,
            ProcessKind::EacLoader | ProcessKind::EacService
        )
    });

    let readiness = if !eac_present {
        Readiness {
            conclusion: ReadinessConclusion::NoEacFound,
            guidance_code: codes::GUIDANCE_NO_EAC_FOUND,
        }
    } else if vrchat_session_active {
        Readiness {
            conclusion: ReadinessConclusion::EacActiveWithVrchatSession,
            guidance_code: codes::GUIDANCE_CLOSE_GAME_FIRST,
        }
    } else {
        Readiness {
            conclusion: ReadinessConclusion::EacResidualNoSession,
            guidance_code: codes::GUIDANCE_ALLOWLIST_UNAVAILABLE,
        }
    };

    EacProbeSnapshotV01 {
        schema_version: EAC_PROBE_SCHEMA_VERSION,
        captured_at: clock.now_rfc3339(),
        production_target: PRODUCTION_TARGET,
        processes,
        vrchat_session_active,
        eac_present,
        readiness,
        // v0.1 freezes the single honest state: the allowlist is empty and
        // no real-machine evidence exists, so termination is unavailable
        // (approval point 2). This is a fact about the capability, not a
        // toggle this crate could flip.
        termination_capability: TerminationCapability {
            state: "unavailable",
            reason: "allowlist_empty_no_machine_evidence",
        },
        diagnostics,
    }
}

fn empty_snapshot(clock: &dyn Clock, diagnostics: Vec<ManagerDiagnostic>) -> EacProbeSnapshotV01 {
    EacProbeSnapshotV01 {
        schema_version: EAC_PROBE_SCHEMA_VERSION,
        captured_at: clock.now_rfc3339(),
        production_target: PRODUCTION_TARGET,
        processes: Vec::new(),
        vrchat_session_active: false,
        eac_present: false,
        readiness: Readiness {
            conclusion: ReadinessConclusion::NoEacFound,
            guidance_code: codes::GUIDANCE_NO_EAC_FOUND,
        },
        termination_capability: TerminationCapability {
            state: "unavailable",
            reason: "allowlist_empty_no_machine_evidence",
        },
        diagnostics,
    }
}

// --- OS-backed source (Windows; exercised by the ignored manual test) ---

pub mod os_source {
    //! The real process table via the Windows Toolhelp snapshot. Read-only:
    //! creating a snapshot and reading entries touches nothing.

    use super::{ProcessEntry, ProcessSnapshotSource};

    /// Windows Toolhelp32-backed snapshot source.
    #[derive(Debug, Default, Clone, Copy)]
    pub struct ToolhelpProcessSource;

    impl ProcessSnapshotSource for ToolhelpProcessSource {
        fn snapshot(&self) -> std::io::Result<Vec<ProcessEntry>> {
            snapshot_toolhelp()
        }
    }

    #[cfg(windows)]
    fn snapshot_toolhelp() -> std::io::Result<Vec<ProcessEntry>> {
        use std::mem::zeroed;
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
        }

        let mut entries = Vec::new();
        let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        unsafe {
            if Process32FirstW(handle, &mut entry) != 0 {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|character| *character == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                    if !name.is_empty() {
                        entries.push(ProcessEntry {
                            image_name: name,
                            pid: entry.th32ProcessID,
                            // Path is intentionally not probed here: reading
                            // another process's image path requires opening
                            // its handle (QueryFullProcessImageNameW), which
                            // is the termination face's verification duty
                            // (006 R3), not the read face's. The read face
                            // reports null and stays minimal.
                            path: None,
                        });
                    }
                    if Process32NextW(handle, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(handle);
        }
        Ok(entries)
    }

    #[cfg(not(windows))]
    fn snapshot_toolhelp() -> std::io::Result<Vec<ProcessEntry>> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "the EAC probe requires Windows",
        ))
    }
}

// ============================================================================
// EAC Probe v0.2 (Candidate additive family — v0.1 above remains untouched)
// ============================================================================

pub mod v02 {
    use serde::Serialize;
    use std::collections::{HashMap, HashSet};
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use vua_orchestrator::{
        Clock, EnvironmentRoots, FindingSeverity, ManagerDiagnostic, RegistryHive, RegistrySource,
        SystemClock,
    };

    use crate::deployment_trust::{
        trusted_eac_binary, trusted_eac_binary_cached, EAC_TRUSTED_LEAF_SIGNERS,
    };
    use crate::eac_allowlist::{
        find_entry, load_allowlist, path_pattern_matches, AllowlistEntryV01, AllowlistV01,
        EAC_ALLOWLIST_SCHEMA_VERSION,
    };
    use crate::eac_install::{
        EacBinaryState, EacFolderState, EacInstallStateV02, InstallSource, WindowsInstallSource,
    };
    use crate::eac_logs::{EacLogFinding, LogSource, WindowsVrchatLogSource};
    use crate::eac_recovery::{
        plan_recovery, EacConclusionV02, EacRecoverySettings, EacRecoveryStepId,
    };
    use crate::eac_service::{
        EacServiceName, EacServiceState, ServiceStatusSource, WindowsServiceStatusSource,
    };
    use crate::eac_terminate::{
        terminate_candidate, PreCheck, TerminationGuard, TerminationReceiptV01, TerminationRequest,
    };
    use crate::environment_managers::ManagerRoots;
    use crate::verified_launch::{
        strip_windows_verbatim_prefix, ElevatedLaunchOutcome, LockedExecutable,
    };
    use crate::{ProcessEntry, ProcessSnapshotSource};

    pub const EAC_PROBE_SCHEMA_VERSION_V02: &str = "vua.eac-probe/v0.2";
    pub const EAC_REPAIR_SCHEMA_VERSION_V02: &str = "vua.eac-repair/v0.2";

    pub mod codes_v02 {
        pub const PROCESS_UNREADABLE: &str = "vua.eac_probe.process_unreadable";
        pub const WINDOW_UNREADABLE: &str = "vua.eac_probe.window_unreadable";
        pub const SERVICE_UNREADABLE: &str = "vua.eac_probe.service_unreadable";
        pub const STEAM_UNREADABLE: &str = "vua.eac_probe.steam_unreadable";
        pub const INSTALL_UNREADABLE: &str = "vua.eac_probe.install_unreadable";
        pub const LOG_UNREADABLE: &str = "vua.eac_probe.log_unreadable";
        pub const INSTALL_PATH_UNKNOWN: &str = "vua.eac_probe.install_path_unknown";
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
    #[serde(rename_all = "snake_case")]
    pub enum ProcessKindV02 {
        EacLoader,
        EacService,
        VrchatGame,
        VrchatLauncher,
        VrchatOverlay,
    }

    impl ProcessKindV02 {
        pub fn classify(image_name: &str) -> Option<Self> {
            match image_name.to_ascii_lowercase().as_str() {
                "easyanticheat.exe" => Some(Self::EacLoader),
                "easyanticheat_eos.exe" => Some(Self::EacService),
                "vrchat.exe" => Some(Self::VrchatGame),
                "start_protected_game.exe" | "launch.exe" => Some(Self::VrchatLauncher),
                _ => None,
            }
        }
    }

    fn normalized_path_segments(path: &Path) -> Vec<String> {
        let stripped = strip_windows_verbatim_prefix(path).unwrap_or_else(|| path.to_path_buf());
        stripped
            .to_string_lossy()
            .split(['\\', '/'])
            .filter(|seg| !seg.is_empty())
            .map(|seg| seg.to_ascii_lowercase())
            .collect()
    }

    fn is_inside_directory_ci(root_dir: &Path, candidate_file: &Path) -> bool {
        let root_segs = normalized_path_segments(root_dir);
        let cand_segs = normalized_path_segments(candidate_file);
        !root_segs.is_empty()
            && cand_segs.len() > root_segs.len()
            && cand_segs[..root_segs.len()] == root_segs[..]
    }

    /// Scopes process findings to the detected VRChat installation directory (and EOS service
    /// folder) so unrelated `launch.exe`, `start_protected_game.exe`, or legacy `EasyAntiCheat.exe`
    /// binaries belonging to other applications/games do not cause false `residual_process` reports.
    fn process_belongs_to_vrchat_or_eos(
        kind: ProcessKindV02,
        proc_path: Option<&str>,
        vrchat_dir: Option<&Path>,
        eos_binary_path: Option<&Path>,
    ) -> bool {
        match kind {
            ProcessKindV02::VrchatLauncher
            | ProcessKindV02::EacLoader
            | ProcessKindV02::VrchatOverlay => {
                let (Some(root), Some(raw_path)) = (vrchat_dir, proc_path) else {
                    return false;
                };
                is_inside_directory_ci(root, Path::new(raw_path))
            }
            // R4 (ADR 006): ANY running `VRChat.exe` process counts as an active session by image
            // name alone (including secondary installs or SDK custom client copies), never narrowed
            // by Steam directory containment.
            ProcessKindV02::VrchatGame => true,
            ProcessKindV02::EacService => match proc_path {
                None => true,
                Some(raw_path) => {
                    let candidate = Path::new(raw_path);
                    let in_eos_dir = eos_binary_path
                        .and_then(Path::parent)
                        .is_some_and(|dir| is_inside_directory_ci(dir, candidate));
                    let in_vrchat_dir =
                        vrchat_dir.is_some_and(|root| is_inside_directory_ci(root, candidate));
                    let standard_eos_suffix = raw_path
                        .replace('/', "\\")
                        .to_ascii_lowercase()
                        .ends_with(r"\easyanticheat_eos\easyanticheat_eos.exe");
                    in_eos_dir || in_vrchat_dir || standard_eos_suffix
                }
            },
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct ProcessEntryV02 {
        pub image_name: String,
        pub pid: u32,
        pub created: Option<u64>,
        pub path: Option<String>,
    }

    pub trait ProcessSnapshotSourceV02: Send + Sync {
        fn snapshot_v02(&self) -> Result<Vec<ProcessEntryV02>, String>;
    }

    pub trait WindowVisibilitySource: Send + Sync {
        fn visible_window_pids(&self) -> Result<HashSet<u32>, String>;
    }

    pub trait SteamRunningSource: Send + Sync {
        fn running_flag(&self) -> Result<Option<u8>, String>;
    }

    pub trait CandidateSignatureVerifier: Send + Sync {
        fn is_trusted_eac_binary(&self, path: &Path) -> bool;

        fn is_trusted_eac_binary_for_inspect(&self, path: &Path) -> bool {
            self.is_trusted_eac_binary(path)
        }
    }

    #[derive(Debug, Default, Clone, Copy)]
    pub struct WindowsCandidateSignatureVerifier;

    impl CandidateSignatureVerifier for WindowsCandidateSignatureVerifier {
        fn is_trusted_eac_binary(&self, path: &Path) -> bool {
            trusted_eac_binary(path)
        }

        fn is_trusted_eac_binary_for_inspect(&self, path: &Path) -> bool {
            trusted_eac_binary_cached(path)
        }
    }

    #[derive(Debug, Clone)]
    pub struct RegistrySteamRunningSource {
        registry: Arc<dyn RegistrySource>,
    }

    impl RegistrySteamRunningSource {
        pub fn new(registry: Arc<dyn RegistrySource>) -> Self {
            Self { registry }
        }
    }

    impl SteamRunningSource for RegistrySteamRunningSource {
        fn running_flag(&self) -> Result<Option<u8>, String> {
            Ok(self
                .registry
                .get_dword(
                    RegistryHive::CurrentUser,
                    r"Software\Valve\Steam\Apps\438100",
                    "Running",
                )
                .map(|val| if val == 0 { 0 } else { 1 }))
        }
    }

    #[derive(Debug, Default, Clone, Copy)]
    pub struct WindowsWindowVisibilitySource;

    impl WindowVisibilitySource for WindowsWindowVisibilitySource {
        fn visible_window_pids(&self) -> Result<HashSet<u32>, String> {
            use crate::game_window::{os_source::WindowsGameWindowSource, GameWindowSource};
            let windows = WindowsGameWindowSource
                .top_level_windows()
                .map_err(|err| format!("window enumeration failed: {err}"))?;
            Ok(windows
                .into_iter()
                .filter(|w| w.visible && !w.tool && w.rect.width > 0 && w.rect.height > 0)
                .map(|w| w.pid)
                .collect())
        }
    }

    #[derive(Debug, Default, Clone, Copy)]
    pub struct WindowsProcessSnapshotSourceV02;

    impl ProcessSnapshotSourceV02 for WindowsProcessSnapshotSourceV02 {
        fn snapshot_v02(&self) -> Result<Vec<ProcessEntryV02>, String> {
            snapshot_windows_v02()
        }
    }

    #[cfg(windows)]
    fn query_process_created_and_path(pid: u32) -> (Option<u64>, Option<String>) {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, FILETIME},
            System::Threading::{
                GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        };
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return (None, None);
        }
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let times_ok = unsafe {
            GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0
        };
        let created = times_ok.then(|| {
            (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime)
        });

        let mut buf = [0u16; 4096];
        let mut len = buf.len() as u32;
        let path_ok =
            unsafe { QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len) != 0 };
        let path = (path_ok && len > 0).then(|| String::from_utf16_lossy(&buf[..len as usize]));
        unsafe { CloseHandle(handle) };
        (created, path)
    }

    #[cfg(windows)]
    fn snapshot_windows_v02() -> Result<Vec<ProcessEntryV02>, String> {
        use std::mem::zeroed;
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };

        let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if handle == INVALID_HANDLE_VALUE {
            return Err(format!(
                "CreateToolhelp32Snapshot failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut entries = Vec::new();
        let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        unsafe {
            if Process32FirstW(handle, &mut entry) != 0 {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|c| *c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                    if !name.is_empty() && ProcessKindV02::classify(&name).is_some() {
                        let pid = entry.th32ProcessID;
                        let (created, path) = query_process_created_and_path(pid);
                        entries.push(ProcessEntryV02 {
                            image_name: name,
                            pid,
                            created,
                            path,
                        });
                    }
                    if Process32NextW(handle, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(handle);
        }
        Ok(entries)
    }

    #[cfg(not(windows))]
    fn snapshot_windows_v02() -> Result<Vec<ProcessEntryV02>, String> {
        Err("EAC probe v0.2 requires Windows".to_owned())
    }

    #[derive(Debug, Default)]
    pub struct ServiceObservationTracker {
        first_seen: Mutex<HashMap<EacServiceName, String>>,
    }

    impl ServiceObservationTracker {
        /// Records or retains `firstObservedAt` strictly while EAC services remain active AFTER
        /// VRChat and its bootstrapper have exited (`!session_or_residual_active`). Whenever a
        /// game or residual launcher process is active, any prior timestamp is cleared so gameplay
        /// duration is never mistaken for post-exit driver unload time.
        pub fn observe(
            &self,
            name: EacServiceName,
            present: bool,
            state: EacServiceState,
            session_or_residual_active: bool,
            now_rfc3339: &str,
        ) -> Option<String> {
            let Ok(mut map) = self.first_seen.lock() else {
                return None;
            };
            if !session_or_residual_active && present && state.is_active_or_transitioning() {
                Some(
                    map.entry(name)
                        .or_insert_with(|| now_rfc3339.to_owned())
                        .clone(),
                )
            } else {
                map.remove(&name);
                None
            }
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacProcessFindingV02 {
        pub name: String,
        pub pid: u32,
        pub created: Option<String>,
        pub kind: ProcessKindV02,
        pub path: Option<String>,
        pub has_visible_window: bool,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacServiceFindingV02 {
        pub name: EacServiceName,
        pub present: bool,
        pub state: EacServiceState,
        pub first_observed_at: Option<String>,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacSteamStateV02 {
        pub running_flag: Option<u8>,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacTerminationCandidateV02 {
        pub name: String,
        pub pid: u32,
        pub created: String,
        pub path: String,
        pub publisher_evidence: String,
        pub allowlist_reason: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacTerminationCapabilityV02 {
        pub state: &'static str,
        pub reason: &'static str,
        pub candidate: Option<EacTerminationCandidateV02>,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacLastRepairV02 {
        pub outcome: EacRepairOutcome,
        pub exit_code: Option<i32>,
        pub updated_at: String,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacProbeSnapshotV02 {
        pub schema_version: &'static str,
        pub captured_at: String,
        pub processes: Vec<EacProcessFindingV02>,
        pub services: [EacServiceFindingV02; 2],
        pub steam: EacSteamStateV02,
        pub install: EacInstallStateV02,
        pub log_findings: Vec<EacLogFinding>,
        pub conclusion: EacConclusionV02,
        pub guidance_code: &'static str,
        pub plan: Vec<EacRecoveryStepId>,
        pub termination_capability: EacTerminationCapabilityV02,
        pub last_repair: Option<EacLastRepairV02>,
        pub diagnostics: Vec<ManagerDiagnostic>,
    }

    pub struct EacSources<'a> {
        pub processes: &'a dyn ProcessSnapshotSourceV02,
        pub windows: &'a dyn WindowVisibilitySource,
        pub services: &'a dyn ServiceStatusSource,
        pub steam: &'a dyn SteamRunningSource,
        pub install: &'a dyn InstallSource,
        pub logs: &'a dyn LogSource,
        pub tracker: &'a ServiceObservationTracker,
        pub allowlist: &'a AllowlistV01,
        pub signature_verifier: &'a dyn CandidateSignatureVerifier,
        pub experimental_termination_enabled: bool,
    }

    pub fn probe_eac_v02(sources: &EacSources<'_>, clock: &dyn Clock) -> EacProbeSnapshotV02 {
        probe_eac_v02_internal(sources, Some(sources.allowlist), None, clock)
    }

    fn probe_eac_v02_internal(
        sources: &EacSources<'_>,
        explicit_allowlist: Option<&AllowlistV01>,
        last_repair: Option<EacLastRepairV02>,
        clock: &dyn Clock,
    ) -> EacProbeSnapshotV02 {
        let captured_at = clock.now_rfc3339();
        let mut diagnostics = Vec::new();
        let mut read_failed = false;

        let (raw_services, eos_present, eos_binary_path) = match sources.services.query_services() {
            Ok([eos, eos_sys]) => {
                if eos.state == EacServiceState::Unreadable
                    || eos_sys.state == EacServiceState::Unreadable
                {
                    read_failed = true;
                }
                let binary_path = eos.binary_path.clone();
                let present = eos.present;
                (Some([eos, eos_sys]), present, binary_path)
            }
            Err(err) => {
                read_failed = true;
                diagnostics.push(ManagerDiagnostic {
                    code: codes_v02::SERVICE_UNREADABLE,
                    severity: FindingSeverity::Warning,
                    detail: err,
                });
                (None, false, None)
            }
        };

        let (vrchat_dir, install) = match sources
            .install
            .inspect_install(eos_present, eos_binary_path.as_deref())
        {
            Ok(obs) => {
                if obs.install.eac_folder == EacFolderState::Unknown {
                    read_failed = true;
                    diagnostics.push(ManagerDiagnostic {
                        code: codes_v02::INSTALL_PATH_UNKNOWN,
                        severity: FindingSeverity::Warning,
                        detail: "VRChat installation directory was not detected.".to_owned(),
                    });
                } else if (obs.install.eac_folder == EacFolderState::Present
                    && obs.install.setup_signature == EacBinaryState::Unknown)
                    || (eos_present && obs.install.service_binary == EacBinaryState::Unknown)
                {
                    read_failed = true;
                    diagnostics.push(ManagerDiagnostic {
                        code: codes_v02::INSTALL_UNREADABLE,
                        severity: FindingSeverity::Warning,
                        detail: "EAC binary path or signature status could not be read.".to_owned(),
                    });
                }
                (obs.vrchat_dir, obs.install)
            }
            Err(err) => {
                read_failed = true;
                diagnostics.push(ManagerDiagnostic {
                    code: codes_v02::INSTALL_UNREADABLE,
                    severity: FindingSeverity::Warning,
                    detail: err,
                });
                (
                    None,
                    EacInstallStateV02 {
                        eac_folder: EacFolderState::Unknown,
                        setup_signature: EacBinaryState::Unknown,
                        service_binary: EacBinaryState::Unknown,
                    },
                )
            }
        };

        let raw_processes = match sources.processes.snapshot_v02() {
            Ok(list) => list,
            Err(err) => {
                read_failed = true;
                diagnostics.push(ManagerDiagnostic {
                    code: codes_v02::PROCESS_UNREADABLE,
                    severity: FindingSeverity::Error,
                    detail: err,
                });
                Vec::new()
            }
        };

        let visible_pids = match sources.windows.visible_window_pids() {
            Ok(pids) => pids,
            Err(err) => {
                read_failed = true;
                diagnostics.push(ManagerDiagnostic {
                    code: codes_v02::WINDOW_UNREADABLE,
                    severity: FindingSeverity::Warning,
                    detail: err,
                });
                HashSet::new()
            }
        };

        let mut processes: Vec<EacProcessFindingV02> = raw_processes
            .into_iter()
            .filter_map(|entry| {
                let kind = ProcessKindV02::classify(&entry.image_name)?;
                if !process_belongs_to_vrchat_or_eos(
                    kind,
                    entry.path.as_deref(),
                    vrchat_dir.as_deref(),
                    eos_binary_path.as_deref(),
                ) {
                    return None;
                }
                Some(EacProcessFindingV02 {
                    name: entry.image_name,
                    pid: entry.pid,
                    created: entry.created.map(|ticks| ticks.to_string()),
                    kind,
                    path: entry.path,
                    has_visible_window: visible_pids.contains(&entry.pid),
                })
            })
            .collect();
        processes.sort_by_key(|p| (p.kind, p.pid));

        let running_flag = match sources.steam.running_flag() {
            Ok(flag) => flag,
            Err(err) => {
                read_failed = true;
                diagnostics.push(ManagerDiagnostic {
                    code: codes_v02::STEAM_UNREADABLE,
                    severity: FindingSeverity::Warning,
                    detail: err,
                });
                None
            }
        };

        let log_findings = match sources.logs.read_recent_findings() {
            Ok(findings) => findings,
            Err(err) => {
                read_failed = true;
                diagnostics.push(ManagerDiagnostic {
                    code: codes_v02::LOG_UNREADABLE,
                    severity: FindingSeverity::Warning,
                    detail: err,
                });
                Vec::new()
            }
        };

        // R4: ANY running VRChat.exe process counts as an active session for termination refusal.
        let any_vrchat_game = processes
            .iter()
            .any(|p| p.kind == ProcessKindV02::VrchatGame);
        let visible_vrchat_game = processes
            .iter()
            .any(|p| p.kind == ProcessKindV02::VrchatGame && p.has_visible_window);
        let windowless_vrchat_game = processes
            .iter()
            .any(|p| p.kind == ProcessKindV02::VrchatGame && !p.has_visible_window);
        let any_launcher_or_loader = processes.iter().any(|p| {
            matches!(
                p.kind,
                ProcessKindV02::VrchatLauncher | ProcessKindV02::EacLoader
            )
        });

        let session_or_residual_active = any_vrchat_game || any_launcher_or_loader;
        let services = match raw_services {
            Some([eos, eos_sys]) => {
                let eos_obs = sources.tracker.observe(
                    eos.name,
                    eos.present,
                    eos.state,
                    session_or_residual_active,
                    &captured_at,
                );
                let eos_sys_obs = sources.tracker.observe(
                    eos_sys.name,
                    eos_sys.present,
                    eos_sys.state,
                    session_or_residual_active,
                    &captured_at,
                );
                [
                    EacServiceFindingV02 {
                        name: EacServiceName::EasyAntiCheatEos,
                        present: eos.present,
                        state: eos.state,
                        first_observed_at: eos_obs,
                    },
                    EacServiceFindingV02 {
                        name: EacServiceName::EasyAntiCheatEosSys,
                        present: eos_sys.present,
                        state: eos_sys.state,
                        first_observed_at: eos_sys_obs,
                    },
                ]
            }
            None => [
                EacServiceFindingV02 {
                    name: EacServiceName::EasyAntiCheatEos,
                    present: false,
                    state: EacServiceState::Unreadable,
                    first_observed_at: None,
                },
                EacServiceFindingV02 {
                    name: EacServiceName::EasyAntiCheatEosSys,
                    present: false,
                    state: EacServiceState::Unreadable,
                    first_observed_at: None,
                },
            ],
        };

        let derived_allowlist;
        let effective_allowlist = match explicit_allowlist {
            Some(list) => list,
            None => {
                derived_allowlist = s0_allowlist_for_vrchat_dir(vrchat_dir.as_deref());
                &derived_allowlist
            }
        };

        let termination_capability = evaluate_termination_capability(
            &processes,
            any_vrchat_game,
            effective_allowlist,
            sources.signature_verifier,
            sources.experimental_termination_enabled,
        );

        let eos_service = &services[0];
        let eos_sys_service = &services[1];
        let service_still_unloading = (eos_sys_service.present
            && eos_sys_service.state.is_active_or_transitioning())
            || (eos_service.present && eos_service.state.is_active_or_transitioning());

        let conclusion = if read_failed {
            EacConclusionV02::Unknown
        } else if visible_vrchat_game {
            EacConclusionV02::SessionActive
        } else if windowless_vrchat_game || any_launcher_or_loader {
            EacConclusionV02::ResidualProcess
        } else if service_still_unloading {
            EacConclusionV02::Unloading
        } else if !eos_service.present || install.eac_folder == EacFolderState::Missing {
            EacConclusionV02::NotInstalled
        } else if matches!(
            install.setup_signature,
            EacBinaryState::Missing | EacBinaryState::Unverified
        ) || matches!(
            install.service_binary,
            EacBinaryState::Missing | EacBinaryState::Unverified
        ) {
            EacConclusionV02::InstallDamaged
        } else if install.setup_signature == EacBinaryState::Unknown
            || install.service_binary == EacBinaryState::Unknown
        {
            EacConclusionV02::Unknown
        } else if running_flag == Some(1) {
            EacConclusionV02::SteamStale
        } else {
            EacConclusionV02::Ready
        };

        let plan = plan_recovery(
            conclusion,
            EacRecoverySettings {
                experimental_termination_enabled: sources.experimental_termination_enabled,
                has_verified_termination_candidate: termination_capability.state == "available",
            },
        );

        EacProbeSnapshotV02 {
            schema_version: EAC_PROBE_SCHEMA_VERSION_V02,
            captured_at,
            processes,
            services,
            steam: EacSteamStateV02 { running_flag },
            install,
            log_findings,
            conclusion,
            guidance_code: conclusion.guidance_code(),
            plan,
            termination_capability,
            last_repair,
            diagnostics,
        }
    }

    fn evaluate_termination_capability(
        processes: &[EacProcessFindingV02],
        any_vrchat_game: bool,
        allowlist: &AllowlistV01,
        verifier: &dyn CandidateSignatureVerifier,
        experimental_enabled: bool,
    ) -> EacTerminationCapabilityV02 {
        if allowlist.entries.is_empty() {
            return EacTerminationCapabilityV02 {
                state: "unavailable",
                reason: "allowlist_empty_no_machine_evidence",
                candidate: None,
            };
        }
        if any_vrchat_game {
            return EacTerminationCapabilityV02 {
                state: "unavailable",
                reason: "active_vrchat_session",
                candidate: None,
            };
        }
        for proc in processes {
            if !matches!(
                proc.kind,
                ProcessKindV02::VrchatLauncher | ProcessKindV02::EacLoader
            ) {
                continue;
            }
            let (Some(created), Some(path)) = (&proc.created, &proc.path) else {
                continue;
            };
            let Some(entry) = find_entry(allowlist, &proc.name) else {
                continue;
            };
            if path_pattern_matches(&entry.expected_path_pattern, path).is_none() {
                continue;
            }
            if !verifier.is_trusted_eac_binary_for_inspect(Path::new(path)) {
                continue;
            }
            let candidate = EacTerminationCandidateV02 {
                name: proc.name.clone(),
                pid: proc.pid,
                created: created.clone(),
                path: path.clone(),
                publisher_evidence: entry.publisher_evidence.clone(),
                allowlist_reason: entry.reason.clone(),
            };
            return if experimental_enabled {
                EacTerminationCapabilityV02 {
                    state: "available",
                    reason: "candidate_verified",
                    candidate: Some(candidate),
                }
            } else {
                EacTerminationCapabilityV02 {
                    state: "disabled",
                    reason: "experimental_switch_disabled",
                    candidate: Some(candidate),
                }
            };
        }
        EacTerminationCapabilityV02 {
            state: "unavailable",
            reason: "no_allowlisted_candidate",
            candidate: None,
        }
    }

    /// Builds the S0 real-machine verified user-mode launcher allowlist for a detected VRChat
    /// installation directory. When no VRChat directory is detected, returns an empty allowlist.
    pub fn s0_allowlist_for_vrchat_dir(vrchat_dir: Option<&Path>) -> AllowlistV01 {
        let Some(dir) = vrchat_dir else {
            return AllowlistV01 {
                schema_version: EAC_ALLOWLIST_SCHEMA_VERSION.to_owned(),
                entries: Vec::new(),
            };
        };
        let normalized = dir
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .replace('/', "\\");
        if normalized.is_empty() {
            return AllowlistV01 {
                schema_version: EAC_ALLOWLIST_SCHEMA_VERSION.to_owned(),
                entries: Vec::new(),
            };
        }
        let doc = serde_json::json!({
            "schemaVersion": EAC_ALLOWLIST_SCHEMA_VERSION,
            "entries": [
                {
                    "processName": "start_protected_game.exe",
                    "expectedPathPattern": format!("{normalized}\\start_protected_game.exe"),
                    "publisherEvidence": "CN=EasyAntiCheat Oy (Authenticode WinVerifyTrust)",
                    "reason": "User-mode VRChat EAC bootstrapper lingering after game exit",
                    "evidenceRef": "S0 real-machine verification 2026-11-14",
                    "addedAt": "2026-11-14T00:00:00Z",
                    "releaseNotes": "v1.2.0 EAC occupation recovery (experimental)"
                }
            ]
        });
        load_allowlist(&doc.to_string()).unwrap_or(AllowlistV01 {
            schema_version: EAC_ALLOWLIST_SCHEMA_VERSION.to_owned(),
            entries: Vec::new(),
        })
    }

    pub trait ProcessTerminator: Send + Sync {
        fn terminate(
            &self,
            pid: u32,
            entry: &AllowlistEntryV01,
            source: &dyn ProcessSnapshotSource,
            task_correlation: &str,
            clock: &dyn Clock,
        ) -> TerminationReceiptV01;
    }

    #[derive(Debug, Default, Clone, Copy)]
    pub struct WindowsProcessTerminator;

    impl ProcessTerminator for WindowsProcessTerminator {
        fn terminate(
            &self,
            pid: u32,
            entry: &AllowlistEntryV01,
            source: &dyn ProcessSnapshotSource,
            task_correlation: &str,
            clock: &dyn Clock,
        ) -> TerminationReceiptV01 {
            let roots = ManagerRoots {
                alcom_settings_candidates: Vec::new(),
            };
            let request = TerminationRequest {
                pid,
                entry,
                vcc_settings_candidates: &[],
                roots: &roots,
                source,
            };
            terminate_candidate(&request, task_correlation, clock)
        }
    }

    struct V02AsV01ProcessSource<'a>(&'a dyn ProcessSnapshotSourceV02);

    impl ProcessSnapshotSource for V02AsV01ProcessSource<'_> {
        fn snapshot(&self) -> std::io::Result<Vec<ProcessEntry>> {
            self.0
                .snapshot_v02()
                .map(|entries| {
                    entries
                        .into_iter()
                        .map(|e| ProcessEntry {
                            image_name: e.image_name,
                            pid: e.pid,
                            path: e.path,
                        })
                        .collect()
                })
                .map_err(std::io::Error::other)
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacTerminateOutcomeV02 {
        pub termination: TerminationReceiptV01,
        pub eac_snapshot: EacProbeSnapshotV02,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum EacTerminateError {
        ExperimentalDisabled,
        InvalidParams(&'static str),
        ProcessUnreadable(String),
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "snake_case")]
    pub enum EacRepairOutcome {
        Launched,
        AlreadyRunning,
        Completed,
        ElevationDeclined,
        ReparsePointRefused,
        VerificationFailed,
        ActiveSessionRefused,
        NotFound,
        LaunchFailed,
        TimedOut,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacRepairReceiptV02 {
        pub schema_version: &'static str,
        pub outcome: EacRepairOutcome,
        pub exit_code: Option<i32>,
    }

    impl EacRepairReceiptV02 {
        pub fn new(outcome: EacRepairOutcome, exit_code: Option<i32>) -> Self {
            Self {
                schema_version: EAC_REPAIR_SCHEMA_VERSION_V02,
                outcome,
                exit_code,
            }
        }
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct EacRepairResultV02 {
        pub repair: EacRepairReceiptV02,
        pub eac_snapshot: EacProbeSnapshotV02,
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum EacRepairError {
        ExperimentalDisabled,
        ProcessUnreadable(String),
    }

    fn is_strictly_inside_root(real_root: &Path, real_target: &Path) -> bool {
        let mut root_components = real_root.components();
        let mut target_components = real_target.components();
        for root_comp in &mut root_components {
            let Some(target_comp) = target_components.next() else {
                return false;
            };
            let equal = if cfg!(windows) {
                root_comp
                    .as_os_str()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&target_comp.as_os_str().to_string_lossy())
            } else {
                root_comp == target_comp
            };
            if !equal {
                return false;
            }
        }
        target_components.next().is_some()
    }

    /// Resolves `<vrchat_dir>\EasyAntiCheat\EasyAntiCheat_EOS_Setup.exe` after canonicalizing both
    /// root and target, enforcing strict containment inside `vrchat_dir`, and stripping Windows
    /// `\\?\` verbatim prefixes so Win32 `ShellExecuteExW` receives a standard DOS path.
    pub fn resolve_verified_repair_setup_path(
        vrchat_dir: &Path,
    ) -> Result<std::path::PathBuf, EacRepairOutcome> {
        if vrchat_dir.as_os_str().is_empty() || !vrchat_dir.is_absolute() {
            return Err(EacRepairOutcome::NotFound);
        }
        let Ok(real_root) = std::fs::canonicalize(vrchat_dir) else {
            return Err(EacRepairOutcome::NotFound);
        };
        if !real_root.is_dir() {
            return Err(EacRepairOutcome::NotFound);
        }
        let candidate = real_root
            .join("EasyAntiCheat")
            .join("EasyAntiCheat_EOS_Setup.exe");
        if !candidate.exists() {
            return Err(EacRepairOutcome::NotFound);
        }
        let Ok(real_target) = std::fs::canonicalize(&candidate) else {
            return Err(EacRepairOutcome::NotFound);
        };
        if !is_strictly_inside_root(&real_root, &real_target) {
            return Err(EacRepairOutcome::VerificationFailed);
        }
        strip_windows_verbatim_prefix(&real_target).ok_or(EacRepairOutcome::ReparsePointRefused)
    }

    pub fn record_last_repair(
        slot: &Mutex<Option<EacLastRepairV02>>,
        outcome: EacRepairOutcome,
        exit_code: Option<i32>,
        clock: &dyn Clock,
    ) {
        if let Ok(mut guard) = slot.lock() {
            *guard = Some(EacLastRepairV02 {
                outcome,
                exit_code,
                updated_at: clock.now_rfc3339(),
            });
        }
    }

    fn map_elevated_repair_outcome(
        outcome: ElevatedLaunchOutcome,
    ) -> (EacRepairOutcome, Option<i32>) {
        match outcome {
            ElevatedLaunchOutcome::Completed { exit_code } => {
                (EacRepairOutcome::Completed, Some(exit_code))
            }
            ElevatedLaunchOutcome::ElevationDeclined => (EacRepairOutcome::ElevationDeclined, None),
            ElevatedLaunchOutcome::LaunchFailed => (EacRepairOutcome::LaunchFailed, None),
            ElevatedLaunchOutcome::TimedOut => (EacRepairOutcome::TimedOut, None),
        }
    }

    pub trait RepairLauncher: Send + Sync {
        fn launch_official_repair(
            &self,
            vrchat_dir: &Path,
            clock: Arc<dyn Clock>,
            last_repair: Arc<Mutex<Option<EacLastRepairV02>>>,
        ) -> EacRepairReceiptV02;
    }

    struct InFlightRepairGuard(Arc<AtomicBool>);
    impl Drop for InFlightRepairGuard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }

    /// Launches `EasyAntiCheat_EOS_Setup.exe` without blocking the single-threaded core provider
    /// frame loop: path containment, handle lock (`FILE_SHARE_READ`), resolved-final-path
    /// reparse-point check, PE check, and WinVerifyTrust leaf-CN check run synchronously (<50 ms);
    /// the blocking UAC prompt (`ShellExecuteExW` `runas`) and child wait run on a dedicated
    /// worker thread holding the locked file handle open until exit or 300-second timeout and
    /// writing the terminal outcome into `last_repair`.
    #[derive(Debug, Default, Clone)]
    pub struct WindowsRepairLauncher {
        in_flight: Arc<AtomicBool>,
    }

    impl WindowsRepairLauncher {
        pub fn new() -> Self {
            Self::default()
        }
    }

    impl RepairLauncher for WindowsRepairLauncher {
        fn launch_official_repair(
            &self,
            vrchat_dir: &Path,
            clock: Arc<dyn Clock>,
            last_repair: Arc<Mutex<Option<EacLastRepairV02>>>,
        ) -> EacRepairReceiptV02 {
            let sync_failure = |outcome: EacRepairOutcome| {
                record_last_repair(&last_repair, outcome, None, clock.as_ref());
                EacRepairReceiptV02::new(outcome, None)
            };

            let real_target = match resolve_verified_repair_setup_path(vrchat_dir) {
                Ok(target) => target,
                Err(outcome) => return sync_failure(outcome),
            };
            let mut locked = match LockedExecutable::open_read_locked(&real_target) {
                Ok(locked) => locked,
                Err(err) if err.is_not_found() => {
                    return sync_failure(EacRepairOutcome::NotFound);
                }
                Err(err) if err.is_invalid_location() => {
                    return sync_failure(EacRepairOutcome::ReparsePointRefused);
                }
                Err(_) => {
                    return sync_failure(EacRepairOutcome::VerificationFailed);
                }
            };
            if !locked.has_pe_header()
                || !locked.verify_authenticode_leaf_cn(EAC_TRUSTED_LEAF_SIGNERS)
            {
                return sync_failure(EacRepairOutcome::VerificationFailed);
            }
            if self
                .in_flight
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                return EacRepairReceiptV02::new(EacRepairOutcome::AlreadyRunning, None);
            }
            record_last_repair(
                &last_repair,
                EacRepairOutcome::Launched,
                None,
                clock.as_ref(),
            );
            let guard = InFlightRepairGuard(self.in_flight.clone());
            let worker_clock = clock.clone();
            let worker_last_repair = last_repair.clone();
            let spawned = std::thread::Builder::new()
                .name("vua-eac-repair".to_owned())
                .spawn(move || {
                    let _guard = guard;
                    let exec = locked.run_elevated_no_args(std::time::Duration::from_secs(300));
                    let (outcome, exit_code) = map_elevated_repair_outcome(exec);
                    record_last_repair(
                        &worker_last_repair,
                        outcome,
                        exit_code,
                        worker_clock.as_ref(),
                    );
                });
            match spawned {
                Ok(_) => EacRepairReceiptV02::new(EacRepairOutcome::Launched, None),
                Err(_) => sync_failure(EacRepairOutcome::LaunchFailed),
            }
        }
    }

    pub struct EacServiceDeps {
        pub processes: Arc<dyn ProcessSnapshotSourceV02>,
        pub windows: Arc<dyn WindowVisibilitySource>,
        pub services: Arc<dyn ServiceStatusSource>,
        pub steam: Arc<dyn SteamRunningSource>,
        pub install: Arc<dyn InstallSource>,
        pub logs: Arc<dyn LogSource>,
        pub signature_verifier: Arc<dyn CandidateSignatureVerifier>,
        pub terminator: Arc<dyn ProcessTerminator>,
        pub repair_launcher: Arc<dyn RepairLauncher>,
        pub clock: Arc<dyn Clock>,
    }

    /// Stateful host service owning the in-memory `firstObservedAt` service streak tracker,
    /// latest official repair outcome (`lastRepair`), and experimental switch state synchronized
    /// from Electron Main.
    pub struct EacProbeService {
        processes: Arc<dyn ProcessSnapshotSourceV02>,
        windows: Arc<dyn WindowVisibilitySource>,
        services: Arc<dyn ServiceStatusSource>,
        steam: Arc<dyn SteamRunningSource>,
        install: Arc<dyn InstallSource>,
        logs: Arc<dyn LogSource>,
        tracker: ServiceObservationTracker,
        signature_verifier: Arc<dyn CandidateSignatureVerifier>,
        terminator: Arc<dyn ProcessTerminator>,
        repair_launcher: Arc<dyn RepairLauncher>,
        clock: Arc<dyn Clock>,
        experimental_enabled: Mutex<bool>,
        last_repair: Arc<Mutex<Option<EacLastRepairV02>>>,
    }

    impl EacProbeService {
        pub fn windows(roots: EnvironmentRoots) -> Self {
            let registry = roots.registry.clone();
            Self {
                processes: Arc::new(WindowsProcessSnapshotSourceV02),
                windows: Arc::new(WindowsWindowVisibilitySource),
                services: Arc::new(WindowsServiceStatusSource),
                steam: Arc::new(RegistrySteamRunningSource::new(registry)),
                install: Arc::new(WindowsInstallSource::new(roots)),
                logs: Arc::new(WindowsVrchatLogSource::default()),
                tracker: ServiceObservationTracker::default(),
                signature_verifier: Arc::new(WindowsCandidateSignatureVerifier),
                terminator: Arc::new(WindowsProcessTerminator),
                repair_launcher: Arc::new(WindowsRepairLauncher::new()),
                clock: Arc::new(SystemClock),
                experimental_enabled: Mutex::new(false),
                last_repair: Arc::new(Mutex::new(None)),
            }
        }

        pub fn with_deps(deps: EacServiceDeps) -> Self {
            Self {
                processes: deps.processes,
                windows: deps.windows,
                services: deps.services,
                steam: deps.steam,
                install: deps.install,
                logs: deps.logs,
                tracker: ServiceObservationTracker::default(),
                signature_verifier: deps.signature_verifier,
                terminator: deps.terminator,
                repair_launcher: deps.repair_launcher,
                clock: deps.clock,
                experimental_enabled: Mutex::new(false),
                last_repair: Arc::new(Mutex::new(None)),
            }
        }

        pub fn set_experimental_termination(&self, enabled: bool) {
            if let Ok(mut guard) = self.experimental_enabled.lock() {
                *guard = enabled;
            }
        }

        pub fn experimental_termination(&self) -> bool {
            self.experimental_enabled
                .lock()
                .map(|g| *g)
                .unwrap_or(false)
        }

        pub fn inspect(&self) -> EacProbeSnapshotV02 {
            let placeholder_allowlist = AllowlistV01 {
                schema_version: EAC_ALLOWLIST_SCHEMA_VERSION.to_owned(),
                entries: Vec::new(),
            };
            let sources = EacSources {
                processes: self.processes.as_ref(),
                windows: self.windows.as_ref(),
                services: self.services.as_ref(),
                steam: self.steam.as_ref(),
                install: self.install.as_ref(),
                logs: self.logs.as_ref(),
                tracker: &self.tracker,
                allowlist: &placeholder_allowlist,
                signature_verifier: self.signature_verifier.as_ref(),
                experimental_termination_enabled: self.experimental_termination(),
            };
            let current_last_repair = self.last_repair.lock().ok().and_then(|g| g.clone());
            probe_eac_v02_internal(&sources, None, current_last_repair, self.clock.as_ref())
        }

        pub fn terminate_residual(
            &self,
            pid: u32,
            created: &str,
            expected_path: &str,
            correlation_id: &str,
        ) -> Result<EacTerminateOutcomeV02, EacTerminateError> {
            if !self.experimental_termination() {
                return Err(EacTerminateError::ExperimentalDisabled);
            }
            let expected_created: u64 = created
                .parse()
                .map_err(|_| EacTerminateError::InvalidParams("created must be u64 ticks"))?;
            if expected_path.trim().is_empty() {
                return Err(EacTerminateError::InvalidParams("path must not be empty"));
            }

            let raw_processes = self
                .processes
                .snapshot_v02()
                .map_err(EacTerminateError::ProcessUnreadable)?;
            let vrchat_dir = self.install.detect_vrchat_root();

            // R4: ANY running VRChat.exe process counts as an active session by image name alone.
            let any_vrchat_game = raw_processes.iter().any(|entry| {
                ProcessKindV02::classify(&entry.image_name) == Some(ProcessKindV02::VrchatGame)
            });
            let any_eac_present = raw_processes.iter().any(|entry| {
                let Some(kind) = ProcessKindV02::classify(&entry.image_name) else {
                    return false;
                };
                matches!(
                    kind,
                    ProcessKindV02::EacLoader
                        | ProcessKindV02::EacService
                        | ProcessKindV02::VrchatLauncher
                ) && process_belongs_to_vrchat_or_eos(
                    kind,
                    entry.path.as_deref(),
                    vrchat_dir.as_deref(),
                    None,
                )
            });
            let pre = PreCheck {
                vrchat_session_active: any_vrchat_game,
                eac_present: any_eac_present,
            };

            let target = raw_processes.iter().find(|entry| entry.pid == pid);
            let fallback_name = target
                .map(|entry| entry.image_name.as_str())
                .unwrap_or("start_protected_game.exe");

            // R4: ANY running VRChat.exe process refuses termination unconditionally.
            if any_vrchat_game {
                let termination = TerminationReceiptV01::refused_step(
                    pid,
                    fallback_name,
                    correlation_id,
                    pre,
                    TerminationGuard::ActiveVrchatSession,
                    "a running VRChat process is an active session — termination is refused (R4)",
                );
                return Ok(EacTerminateOutcomeV02 {
                    termination,
                    eac_snapshot: self.inspect(),
                });
            }

            let allowlist = s0_allowlist_for_vrchat_dir(vrchat_dir.as_deref());
            let verified_entry = target.and_then(|proc| {
                let entry = find_entry(&allowlist, &proc.image_name)?;
                if proc.created != Some(expected_created) {
                    return None;
                }
                let actual_path = proc.path.as_deref()?;
                if !actual_path.eq_ignore_ascii_case(expected_path) {
                    return None;
                }
                path_pattern_matches(&entry.expected_path_pattern, actual_path)?;
                if !self
                    .signature_verifier
                    .is_trusted_eac_binary(Path::new(actual_path))
                {
                    return None;
                }
                Some(entry)
            });

            let Some(entry) = verified_entry else {
                let termination = TerminationReceiptV01::refused_step(
                    pid,
                    fallback_name,
                    correlation_id,
                    pre,
                    TerminationGuard::VerificationNotVerified,
                    "candidate process failed PID/creation-time/allowlist-path/publisher re-verification (R3)",
                );
                return Ok(EacTerminateOutcomeV02 {
                    termination,
                    eac_snapshot: self.inspect(),
                });
            };

            let bridged_source = V02AsV01ProcessSource(self.processes.as_ref());
            let termination = self.terminator.terminate(
                pid,
                entry,
                &bridged_source,
                correlation_id,
                self.clock.as_ref(),
            );
            let eac_snapshot = self.inspect();
            Ok(EacTerminateOutcomeV02 {
                termination,
                eac_snapshot,
            })
        }

        pub fn launch_repair(&self) -> Result<EacRepairResultV02, EacRepairError> {
            if !self.experimental_termination() {
                return Err(EacRepairError::ExperimentalDisabled);
            }
            let raw_processes = self
                .processes
                .snapshot_v02()
                .map_err(EacRepairError::ProcessUnreadable)?;
            let vrchat_dir = self.install.detect_vrchat_root();

            // R4: ANY running VRChat.exe process counts as an active session by image name alone.
            let any_vrchat_game = raw_processes.iter().any(|entry| {
                ProcessKindV02::classify(&entry.image_name) == Some(ProcessKindV02::VrchatGame)
            });
            if any_vrchat_game {
                record_last_repair(
                    &self.last_repair,
                    EacRepairOutcome::ActiveSessionRefused,
                    None,
                    self.clock.as_ref(),
                );
                return Ok(EacRepairResultV02 {
                    repair: EacRepairReceiptV02::new(EacRepairOutcome::ActiveSessionRefused, None),
                    eac_snapshot: self.inspect(),
                });
            }

            let Some(vrchat_dir) = vrchat_dir else {
                record_last_repair(
                    &self.last_repair,
                    EacRepairOutcome::NotFound,
                    None,
                    self.clock.as_ref(),
                );
                return Ok(EacRepairResultV02 {
                    repair: EacRepairReceiptV02::new(EacRepairOutcome::NotFound, None),
                    eac_snapshot: self.inspect(),
                });
            };

            let repair = self.repair_launcher.launch_official_repair(
                &vrchat_dir,
                self.clock.clone(),
                self.last_repair.clone(),
            );
            if repair.outcome != EacRepairOutcome::AlreadyRunning {
                if repair.outcome == EacRepairOutcome::Launched {
                    if self.last_repair.lock().ok().is_some_and(|g| g.is_none()) {
                        record_last_repair(
                            &self.last_repair,
                            EacRepairOutcome::Launched,
                            None,
                            self.clock.as_ref(),
                        );
                    }
                } else {
                    record_last_repair(
                        &self.last_repair,
                        repair.outcome,
                        repair.exit_code,
                        self.clock.as_ref(),
                    );
                }
            }
            let eac_snapshot = self.inspect();
            Ok(EacRepairResultV02 {
                repair,
                eac_snapshot,
            })
        }
    }
}

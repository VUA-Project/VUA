//! Candidate `local-diagnostics v0.1`: Host-owned multi-layer local observation,
//! deterministic symptom-to-SOP diagnosis, and guarded offline OSC/config helpers.
//!
//! Safety invariants:
//! - Never attaches to or opens game process memory; liveness and UDP owners are
//!   injected via [`LocalDiagnosticsProbe`].
//! - Never binds UDP sockets on OSC ports `9000` or `9001`.
//! - Never exports `usr_*`, `wrld_*`, `avtr_*` IDs, raw log text, or full process paths.
//! - Offline helpers (`clear_osc_avatar_cache`, `update_client_config`) fail-closed
//!   whenever `VRChat.exe` is running or process liveness cannot be verified.

use crate::environment::{free_disk_bytes, EnvironmentRoots};
use crate::time::{rfc3339, Clock};
use crate::win_registry::RegistryHive;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

pub const LOCAL_DIAGNOSTICS_SCHEMA: &str = "vua.local-diagnostics/v0.1";

const MAX_CACHE_WALK_ENTRIES: usize = 50_000;
const LOG_TAIL_MAX_BYTES: u64 = 128 * 1024;
const MAX_CONFIG_JSON_BYTES: u64 = 1024 * 1024;
const MAX_STEAMVR_SETTINGS_BYTES: u64 = 2 * 1024 * 1024;
const MAX_SAFE_JS_INT: u64 = 9_007_199_254_740_991;
const COMMAND_LEDGER_CAPACITY: usize = 256;
const GIB: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymptomId {
    AudioSilentOrWrongMic,
    OscOrFaceTrackingNotResponding,
    LowFpsOrVramPressure,
    DiskCacheFull,
    CrashOrEacBlock,
    AvatarHiddenOrGreyRobot,
    CannotUploadAvatar,
    StreamingBlurryOrCompression,
    PlayspaceDragOrHeightOffset,
    FbtDriftOrCalibration,
}

impl SymptomId {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "audio_silent_or_wrong_mic" => Some(Self::AudioSilentOrWrongMic),
            "osc_or_face_tracking_not_responding" => Some(Self::OscOrFaceTrackingNotResponding),
            "low_fps_or_vram_pressure" => Some(Self::LowFpsOrVramPressure),
            "disk_cache_full" => Some(Self::DiskCacheFull),
            "crash_or_eac_block" => Some(Self::CrashOrEacBlock),
            "avatar_hidden_or_grey_robot" => Some(Self::AvatarHiddenOrGreyRobot),
            "cannot_upload_avatar" => Some(Self::CannotUploadAvatar),
            "streaming_blurry_or_compression" => Some(Self::StreamingBlurryOrCompression),
            "playspace_drag_or_height_offset" => Some(Self::PlayspaceDragOrHeightOffset),
            "fbt_drift_or_calibration" => Some(Self::FbtDriftOrCalibration),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdpPortObservation {
    pub state: &'static str,
    pub owner_pid: Option<u32>,
    pub owner_process: Option<String>,
}

fn sanitize_process_basename(name: String) -> Option<String> {
    let base = name.rsplit(['\\', '/']).next().unwrap_or("").trim();
    if base.is_empty() || base.contains(':') || base.len() > 128 {
        None
    } else {
        Some(base.to_ascii_lowercase())
    }
}

impl UdpPortObservation {
    pub fn unbound() -> Self {
        Self {
            state: "unbound",
            owner_pid: None,
            owner_process: None,
        }
    }

    pub fn probe_unavailable() -> Self {
        Self {
            state: "probe_unavailable",
            owner_pid: None,
            owner_process: None,
        }
    }

    pub fn bound(owner_pid: u32, owner_process: Option<String>) -> Self {
        Self {
            state: "bound",
            owner_pid: Some(owner_pid),
            owner_process: owner_process.and_then(sanitize_process_basename),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OscQueryLoopbackObservation {
    pub state: &'static str,
    pub http_port: Option<u16>,
    pub advertised_osc_port: Option<u16>,
    pub owner_process: Option<String>,
}

impl OscQueryLoopbackObservation {
    pub fn not_detected() -> Self {
        Self {
            state: "not_detected",
            http_port: None,
            advertised_osc_port: None,
            owner_process: None,
        }
    }

    pub fn probe_unavailable() -> Self {
        Self {
            state: "probe_unavailable",
            http_port: None,
            advertised_osc_port: None,
            owner_process: None,
        }
    }

    pub fn found(
        http_port: u16,
        advertised_osc_port: Option<u16>,
        owner_process: Option<String>,
    ) -> Self {
        Self {
            state: "found",
            http_port: Some(http_port),
            advertised_osc_port,
            owner_process: owner_process.and_then(sanitize_process_basename),
        }
    }
}

fn decode_http_chunked_body(raw: &[u8]) -> Option<String> {
    let mut rest = raw;
    let mut out = Vec::new();
    loop {
        let nl = rest.iter().position(|&b| b == b'\n')?;
        let size_line_bytes = if nl > 0 && rest[nl - 1] == b'\r' {
            &rest[..nl - 1]
        } else {
            &rest[..nl]
        };
        let after_line = &rest[nl + 1..];
        let size_line = std::str::from_utf8(size_line_bytes).ok()?;
        let hex_part = size_line.split(';').next()?.trim();
        let chunk_len = usize::from_str_radix(hex_part, 16).ok()?;
        if chunk_len == 0 {
            return String::from_utf8(out).ok();
        }
        if after_line.len() < chunk_len {
            return None;
        }
        out.extend_from_slice(&after_line[..chunk_len]);
        rest = after_line[chunk_len..]
            .strip_prefix(b"\r\n")
            .or_else(|| after_line[chunk_len..].strip_prefix(b"\n"))?;
    }
}

fn split_http_head_and_body(raw_http: &[u8]) -> Option<(&[u8], &[u8])> {
    let crlf = raw_http.windows(4).position(|w| w == b"\r\n\r\n");
    let lf = raw_http.windows(2).position(|w| w == b"\n\n");
    match (crlf, lf) {
        (Some(c), Some(l)) if l < c => Some((&raw_http[..l], &raw_http[l + 2..])),
        (Some(c), _) => Some((&raw_http[..c], &raw_http[c + 4..])),
        (None, Some(l)) => Some((&raw_http[..l], &raw_http[l + 2..])),
        (None, None) => None,
    }
}

/// Parses an HTTP `GET /?HOST_INFO` response from a loopback OSCQuery server.
/// Returns `Some(advertised_osc_port)` when valid OSCQuery `HOST_INFO` JSON is returned.
pub fn parse_oscquery_host_info(raw_http: &[u8]) -> Option<Option<u16>> {
    if raw_http.len() > 64 * 1024 {
        return None;
    }
    let (head_bytes, body_bytes) = split_http_head_and_body(raw_http)?;
    let head = std::str::from_utf8(head_bytes).ok()?;
    let status_line = head.lines().next()?.trim();
    if !status_line.starts_with("HTTP/1.1 200") && !status_line.starts_with("HTTP/1.0 200") {
        return None;
    }
    let is_chunked = head.lines().skip(1).any(|line| {
        line.split_once(':').is_some_and(|(k, v)| {
            k.trim().eq_ignore_ascii_case("transfer-encoding")
                && v.to_ascii_lowercase().contains("chunked")
        })
    });
    let decoded_chunked;
    let json_payload = if is_chunked {
        decoded_chunked = decode_http_chunked_body(body_bytes)?;
        decoded_chunked.trim()
    } else {
        std::str::from_utf8(body_bytes).ok()?.trim()
    };
    let Value::Object(obj) = serde_json::from_str::<Value>(json_payload).ok()? else {
        return None;
    };
    let has_marker = obj.get("EXTENSIONS").is_some_and(Value::is_object)
        || obj.contains_key("OSC_PORT")
        || obj.contains_key("OSC_IP");
    if !has_marker {
        return None;
    }
    let osc_port = obj
        .get("OSC_PORT")
        .and_then(Value::as_u64)
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p > 0);
    Some(osc_port)
}

/// Returned when OS process liveness enumeration is unavailable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessProbeUnavailable;

impl std::fmt::Display for ProcessProbeUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("process probe unavailable")
    }
}

impl std::error::Error for ProcessProbeUnavailable {}

/// OS process & UDP/TCP owner table probe port so tests run deterministically without
/// touching live machine processes or binding game ports.
pub trait LocalDiagnosticsProbe: Send + Sync {
    /// Returns `Ok(true)` if `VRChat.exe` is running, `Ok(false)` if confirmed absent,
    /// or `Err(ProcessProbeUnavailable)` if process enumeration is unavailable.
    fn is_client_running(&self) -> Result<bool, ProcessProbeUnavailable>;

    /// Inspects the OS IPv4 UDP owner table for `port` without binding a socket.
    fn probe_udp_port(&self, port: u16) -> UdpPortObservation;

    /// Passively probes loopback TCP listeners owned by VRChat / OSC companions for `/?HOST_INFO`.
    fn probe_oscquery_loopback(&self) -> OscQueryLoopbackObservation {
        OscQueryLoopbackObservation::probe_unavailable()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfigObservation {
    pub presence: &'static str,
    pub cache_directory_custom: bool,
    pub cache_size_gb: Option<u64>,
    pub cache_expiry_delay_days: Option<u64>,
    pub camera_res_width: Option<u64>,
    pub camera_res_height: Option<u64>,
    pub screenshot_res_width: Option<u64>,
    pub screenshot_res_height: Option<u64>,
    pub fpv_steadycam_fov: Option<f64>,
}

impl ClientConfigObservation {
    fn empty(presence: &'static str) -> Self {
        Self {
            presence,
            cache_directory_custom: false,
            cache_size_gb: None,
            cache_expiry_delay_days: None,
            camera_res_width: None,
            camera_res_height: None,
            screenshot_res_width: None,
            screenshot_res_height: None,
            fpv_steadycam_fov: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCacheObservation {
    pub presence: &'static str,
    pub total_bytes: Option<u64>,
    pub truncated: bool,
    pub drive_free_bytes: Option<u64>,
    pub drive_total_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OscLocalObservation {
    pub avatar_cache_presence: &'static str,
    pub avatar_config_count: u64,
    pub avatar_cache_bytes: u64,
    pub newest_modified_at: Option<String>,
    pub udp9000: UdpPortObservation,
    pub udp9001: UdpPortObservation,
    pub osc_query: OscQueryLoopbackObservation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioEndpointObservation {
    pub state: &'static str,
    pub default_capture_role: &'static str,
    pub virtual_mic_hijack: &'static str,
    pub communications_mismatch: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestLinkSettingsObservation {
    pub presence: &'static str,
    pub encode_resolution_width: Option<u32>,
    pub encode_bitrate_mbps: Option<u32>,
    pub dynamic_bitrate: Option<bool>,
    pub link_sharpening: Option<u32>,
}

impl QuestLinkSettingsObservation {
    fn missing() -> Self {
        Self {
            presence: "missing",
            encode_resolution_width: None,
            encode_bitrate_mbps: None,
            dynamic_bitrate: None,
            link_sharpening: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PicoConnectSettingsObservation {
    pub presence: &'static str,
    pub preset: Option<String>,
    pub bitrate_mbps: Option<u32>,
}

impl PicoConnectSettingsObservation {
    fn empty(presence: &'static str) -> Self {
        Self {
            presence,
            preset: None,
            bitrate_mbps: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", bound(deserialize = "'de: 'static"))]
pub struct StreamingSettingsObservation {
    pub quest_link: QuestLinkSettingsObservation,
    pub pico_connect: PicoConnectSettingsObservation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamVrSettingsObservation {
    pub presence: &'static str,
    pub render_target_multiplier: Option<f64>,
    pub motion_smoothing: Option<bool>,
    pub vrchat_resolution_scale: Option<f64>,
    pub safe_mode_enabled: Option<bool>,
    pub blocked_drivers: Vec<String>,
}

impl SteamVrSettingsObservation {
    fn empty(presence: &'static str) -> Self {
        Self {
            presence,
            render_target_multiplier: None,
            motion_smoothing: None,
            vrchat_resolution_scale: None,
            safe_mode_enabled: None,
            blocked_drivers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTuningObservation {
    pub hardware_gpu_scheduling: Option<bool>,
    pub power_plan_role: &'static str,
    pub ovr_advanced_settings_installed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentClientLogObservation {
    pub classification: &'static str,
    pub newest_modified_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDiagnosticsSnapshot {
    pub schema_version: &'static str,
    pub captured_at: String,
    pub client_running: Option<bool>,
    pub client_config: ClientConfigObservation,
    pub client_cache: ClientCacheObservation,
    pub osc: OscLocalObservation,
    pub steamvr_settings: SteamVrSettingsObservation,
    pub audio_endpoints: AudioEndpointObservation,
    pub streaming_settings: StreamingSettingsObservation,
    pub system_tuning: SystemTuningObservation,
    pub recent_client_log: RecentClientLogObservation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymptomFinding {
    pub code: &'static str,
    pub severity: &'static str,
    pub layer: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSopStep {
    pub step_id: &'static str,
    pub layer: &'static str,
    pub title: &'static str,
    pub instruction: &'static str,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymptomDiagnosis {
    pub schema_version: &'static str,
    pub symptom: SymptomId,
    pub captured_at: String,
    pub snapshot: LocalDiagnosticsSnapshot,
    pub findings: Vec<SymptomFinding>,
    pub sop_steps: Vec<DiagnosticSopStep>,
    pub suggested_helper: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OscCacheClearReceipt {
    pub schema_version: &'static str,
    pub cleared_at: String,
    pub removed_file_count: u64,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientConfigUpdateInput {
    pub cache_size_gb: Option<u64>,
    pub cache_expiry_delay_days: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfigUpdateReceipt {
    pub schema_version: &'static str,
    pub updated_at: String,
    pub backup_written: bool,
    pub cache_size_gb: Option<u64>,
    pub cache_expiry_delay_days: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalDiagnosticsError {
    InvalidParams,
    InvalidCommand,
    ClientRunning,
    ConfigMalformed,
    IoFailed,
}

impl LocalDiagnosticsError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidParams => "vua.diagnostics.invalid_params",
            Self::InvalidCommand => "vua.diagnostics.invalid_command",
            Self::ClientRunning => "vua.diagnostics.client_running",
            Self::ConfigMalformed => "vua.diagnostics.config_malformed",
            Self::IoFailed => "vua.diagnostics.io_failed",
        }
    }

    pub fn category(&self) -> &'static str {
        match self {
            Self::InvalidParams | Self::InvalidCommand => "validation",
            Self::ClientRunning | Self::ConfigMalformed => "conflict",
            Self::IoFailed => "external_failure",
        }
    }

    pub fn detail(&self) -> &'static str {
        match self {
            Self::InvalidParams => "Invalid diagnostics parameters.",
            Self::InvalidCommand => "Command ID was already used with different parameters.",
            Self::ClientRunning => {
                "Close VRChat completely before modifying local OSC cache or client configuration."
            }
            Self::ConfigMalformed => {
                "Existing config.json is not a valid JSON object; VUA left the file untouched."
            }
            Self::IoFailed => "Local filesystem operation could not be completed.",
        }
    }
}

#[derive(Debug, Clone)]
enum RecordedOutcome {
    ClearOsc(OscCacheClearReceipt),
    UpdateConfig(ClientConfigUpdateInput, ClientConfigUpdateReceipt),
}

pub struct LocalDiagnosticsService {
    roots: EnvironmentRoots,
    probe: Arc<dyn LocalDiagnosticsProbe>,
    clock: Arc<dyn Clock>,
    ledger: Mutex<VecDeque<(String, RecordedOutcome)>>,
}

impl LocalDiagnosticsService {
    pub fn new(
        roots: EnvironmentRoots,
        probe: Arc<dyn LocalDiagnosticsProbe>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            roots,
            probe,
            clock,
            ledger: Mutex::new(VecDeque::new()),
        }
    }

    fn vrchat_root(&self) -> PathBuf {
        self.roots.local_low.join("VRChat").join("VRChat")
    }

    pub fn observe_local(&self) -> LocalDiagnosticsSnapshot {
        let captured_at = self.clock.now_rfc3339();
        let client_running = self.probe.is_client_running().ok();
        let vrchat_root = self.vrchat_root();
        let (client_config, custom_cache_base) =
            inspect_client_config(&vrchat_root.join("config.json"));
        let cache_dir = resolve_cache_dir(&vrchat_root, custom_cache_base.as_deref());
        let client_cache = inspect_client_cache(&cache_dir, &self.roots.local_low);
        let osc = inspect_osc_local(&vrchat_root.join("OSC"), self.probe.as_ref());
        let steamvr_settings = inspect_steamvr_settings(&self.roots);
        let audio_endpoints = inspect_audio_endpoints(&self.roots);
        let streaming_settings = inspect_streaming_settings(&self.roots);
        let system_tuning = inspect_system_tuning(&self.roots);
        let recent_client_log = inspect_recent_client_log(&vrchat_root);

        LocalDiagnosticsSnapshot {
            schema_version: LOCAL_DIAGNOSTICS_SCHEMA,
            captured_at,
            client_running,
            client_config,
            client_cache,
            osc,
            steamvr_settings,
            audio_endpoints,
            streaming_settings,
            system_tuning,
            recent_client_log,
        }
    }

    pub fn diagnose_symptom(&self, symptom: SymptomId) -> SymptomDiagnosis {
        let snapshot = self.observe_local();
        let captured_at = snapshot.captured_at.clone();
        let findings = collect_findings_for_symptom(symptom, &snapshot);
        let sop_steps = build_sop_steps(symptom, &snapshot, &findings);
        let suggested_helper = match symptom {
            SymptomId::OscOrFaceTrackingNotResponding if snapshot.osc.avatar_config_count > 0 => {
                "clear_osc_avatar_cache"
            }
            SymptomId::DiskCacheFull
                if snapshot.client_config.presence != "malformed"
                    && (!findings.iter().any(|f| {
                        matches!(f.code, "drive_free_space_low" | "log_disk_full_detected")
                    }) || snapshot
                        .client_config
                        .cache_size_gb
                        .is_some_and(|gb| gb > 30)) =>
            {
                "update_client_config"
            }
            _ => "none",
        };
        SymptomDiagnosis {
            schema_version: LOCAL_DIAGNOSTICS_SCHEMA,
            symptom,
            captured_at,
            snapshot,
            findings,
            sop_steps,
            suggested_helper,
        }
    }

    pub fn clear_osc_avatar_cache(
        &self,
        command_id: &str,
    ) -> Result<OscCacheClearReceipt, LocalDiagnosticsError> {
        validate_command_id(command_id)?;
        let mut ledger = self
            .ledger
            .lock()
            .map_err(|_| LocalDiagnosticsError::IoFailed)?;
        if let Some((_, existing)) = ledger.iter().find(|(id, _)| id == command_id) {
            return match existing {
                RecordedOutcome::ClearOsc(receipt) => Ok(receipt.clone()),
                RecordedOutcome::UpdateConfig(_, _) => Err(LocalDiagnosticsError::InvalidCommand),
            };
        }

        // Fail-closed: only clear when VRChat is confirmed NOT running.
        if self.probe.is_client_running() != Ok(false) {
            return Err(LocalDiagnosticsError::ClientRunning);
        }

        let vrchat_root = self.vrchat_root();
        if fs::symlink_metadata(&vrchat_root)
            .is_ok_and(|m| is_reparse_or_symlink(&m) || !m.is_dir())
        {
            return Err(LocalDiagnosticsError::IoFailed);
        }
        let osc_dir = vrchat_root.join("OSC");
        let (removed_file_count, freed_bytes) = clear_osc_json_files(&osc_dir)?;
        let receipt = OscCacheClearReceipt {
            schema_version: LOCAL_DIAGNOSTICS_SCHEMA,
            cleared_at: self.clock.now_rfc3339(),
            removed_file_count,
            freed_bytes,
        };
        remember_command(
            &mut ledger,
            command_id,
            RecordedOutcome::ClearOsc(receipt.clone()),
        );
        Ok(receipt)
    }

    pub fn update_client_config(
        &self,
        command_id: &str,
        input: ClientConfigUpdateInput,
    ) -> Result<ClientConfigUpdateReceipt, LocalDiagnosticsError> {
        validate_command_id(command_id)?;
        if input.cache_size_gb.is_none() && input.cache_expiry_delay_days.is_none() {
            return Err(LocalDiagnosticsError::InvalidParams);
        }
        if let Some(size) = input.cache_size_gb {
            if !(30..=200).contains(&size) {
                return Err(LocalDiagnosticsError::InvalidParams);
            }
        }
        if let Some(days) = input.cache_expiry_delay_days {
            if !(30..=365).contains(&days) {
                return Err(LocalDiagnosticsError::InvalidParams);
            }
        }

        let mut ledger = self
            .ledger
            .lock()
            .map_err(|_| LocalDiagnosticsError::IoFailed)?;
        if let Some((_, existing)) = ledger.iter().find(|(id, _)| id == command_id) {
            return match existing {
                RecordedOutcome::UpdateConfig(prev_input, receipt) if *prev_input == input => {
                    Ok(receipt.clone())
                }
                _ => Err(LocalDiagnosticsError::InvalidCommand),
            };
        }

        // Fail-closed: only write config.json when VRChat is confirmed NOT running.
        if self.probe.is_client_running() != Ok(false) {
            return Err(LocalDiagnosticsError::ClientRunning);
        }

        let vrchat_root = self.vrchat_root();
        if fs::symlink_metadata(&vrchat_root).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(LocalDiagnosticsError::IoFailed);
        }
        let config_path = vrchat_root.join("config.json");
        if fs::symlink_metadata(&config_path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(LocalDiagnosticsError::IoFailed);
        }
        let (mut map, existed) =
            match read_bounded_regular_utf8(&config_path, MAX_CONFIG_JSON_BYTES) {
                Ok(raw) => match serde_json::from_str::<Value>(&raw) {
                    Ok(Value::Object(obj)) => (obj, true),
                    _ => return Err(LocalDiagnosticsError::ConfigMalformed),
                },
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => (Map::new(), false),
                Err(_) => return Err(LocalDiagnosticsError::IoFailed),
            };

        if let Some(size) = input.cache_size_gb {
            map.insert("cache_size".to_owned(), Value::Number(size.into()));
        }
        if let Some(days) = input.cache_expiry_delay_days {
            map.insert("cache_expiry_delay".to_owned(), Value::Number(days.into()));
        }

        fs::create_dir_all(&vrchat_root).map_err(|_| LocalDiagnosticsError::IoFailed)?;
        let mut backup_written = false;
        if existed {
            let backup_path = vrchat_root.join("config.json.vua.bak");
            if fs::symlink_metadata(&backup_path).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err(LocalDiagnosticsError::IoFailed);
            }
            fs::copy(&config_path, &backup_path).map_err(|_| LocalDiagnosticsError::IoFailed)?;
            backup_written = true;
        }

        let serialized = serde_json::to_vec_pretty(&Value::Object(map))
            .map_err(|_| LocalDiagnosticsError::IoFailed)?;
        static CONFIG_TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = CONFIG_TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let temp_path = vrchat_root.join(format!("config.json.{}.{seq:x}.tmp", std::process::id()));
        let write_result = (|| -> std::io::Result<()> {
            let mut file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&temp_path)?;
            file.write_all(&serialized)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temp_path, &config_path)
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temp_path);
            return Err(LocalDiagnosticsError::IoFailed);
        }

        let receipt = ClientConfigUpdateReceipt {
            schema_version: LOCAL_DIAGNOSTICS_SCHEMA,
            updated_at: self.clock.now_rfc3339(),
            backup_written,
            cache_size_gb: input.cache_size_gb,
            cache_expiry_delay_days: input.cache_expiry_delay_days,
        };
        remember_command(
            &mut ledger,
            command_id,
            RecordedOutcome::UpdateConfig(input, receipt.clone()),
        );
        Ok(receipt)
    }
}

fn validate_command_id(command_id: &str) -> Result<(), LocalDiagnosticsError> {
    if command_id.is_empty()
        || command_id.len() > 128
        || !command_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
    {
        return Err(LocalDiagnosticsError::InvalidParams);
    }
    Ok(())
}

fn remember_command(
    ledger: &mut VecDeque<(String, RecordedOutcome)>,
    command_id: &str,
    outcome: RecordedOutcome,
) {
    if ledger.len() >= COMMAND_LEDGER_CAPACITY {
        ledger.pop_front();
    }
    ledger.push_back((command_id.to_owned(), outcome));
}

fn is_reparse_or_symlink(meta: &fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

fn read_bounded_regular_utf8(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    let meta = fs::symlink_metadata(path)?;
    if is_reparse_or_symlink(&meta) || !meta.is_file() || meta.len() > max_bytes {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "irregular or oversized file",
        ));
    }
    let file = File::open(path)?;
    let mut buf = Vec::with_capacity((meta.len() as usize).min(65_536));
    file.take(max_bytes + 1).read_to_end(&mut buf)?;
    if (buf.len() as u64) > max_bytes {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file exceeded byte cap",
        ));
    }
    String::from_utf8(buf).map_err(|err| std::io::Error::new(std::io::ErrorKind::InvalidData, err))
}

fn inspect_client_config(path: &Path) -> (ClientConfigObservation, Option<PathBuf>) {
    let raw = match read_bounded_regular_utf8(path, MAX_CONFIG_JSON_BYTES) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return (ClientConfigObservation::empty("missing"), None);
        }
        Err(_) => return (ClientConfigObservation::empty("read_failed"), None),
    };
    let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) else {
        return (ClientConfigObservation::empty("malformed"), None);
    };
    let custom_dir = obj
        .get("cache_directory")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from);
    let u64_field = |key: &str| {
        obj.get(key)
            .and_then(Value::as_u64)
            .map(|v| v.min(MAX_SAFE_JS_INT))
    };
    let f64_field = |key: &str| {
        obj.get(key)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
    };
    (
        ClientConfigObservation {
            presence: "found",
            cache_directory_custom: custom_dir.is_some(),
            cache_size_gb: u64_field("cache_size"),
            cache_expiry_delay_days: u64_field("cache_expiry_delay"),
            camera_res_width: u64_field("camera_res_width"),
            camera_res_height: u64_field("camera_res_height"),
            screenshot_res_width: u64_field("screenshot_res_width"),
            screenshot_res_height: u64_field("screenshot_res_height"),
            fpv_steadycam_fov: f64_field("fpv_steadycam_fov"),
        },
        custom_dir,
    )
}

fn resolve_cache_dir(vrchat_root: &Path, custom_base: Option<&Path>) -> PathBuf {
    if let Some(custom) = custom_base {
        let nested = custom.join("Cache-WindowsPlayer");
        if nested.exists() || !custom.ends_with("Cache-WindowsPlayer") {
            return nested;
        }
        return custom.to_path_buf();
    }
    vrchat_root.join("Cache-WindowsPlayer")
}

fn existing_ancestor<'a>(start: &'a Path, fallback: &'a Path) -> Option<&'a Path> {
    let mut current = Some(start);
    while let Some(dir) = current {
        if dir.exists() {
            return Some(dir);
        }
        current = dir.parent();
    }
    let mut fb = Some(fallback);
    while let Some(dir) = fb {
        if dir.exists() {
            return Some(dir);
        }
        fb = dir.parent();
    }
    None
}

fn inspect_client_cache(cache_dir: &Path, fallback_root: &Path) -> ClientCacheObservation {
    let (drive_free_bytes, drive_total_bytes) = existing_ancestor(cache_dir, fallback_root)
        .and_then(|target| free_disk_bytes(target).ok())
        .map(|(free, total)| (Some(free), Some(total)))
        .unwrap_or((None, None));

    let meta = match fs::symlink_metadata(cache_dir) {
        Ok(meta) => meta,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return ClientCacheObservation {
                presence: "missing",
                total_bytes: None,
                truncated: false,
                drive_free_bytes,
                drive_total_bytes,
            };
        }
        Err(_) => {
            return ClientCacheObservation {
                presence: "read_failed",
                total_bytes: None,
                truncated: false,
                drive_free_bytes,
                drive_total_bytes,
            };
        }
    };
    if is_reparse_or_symlink(&meta) || !meta.is_dir() {
        return ClientCacheObservation {
            presence: "read_failed",
            total_bytes: None,
            truncated: false,
            drive_free_bytes,
            drive_total_bytes,
        };
    }

    let mut stack = vec![cache_dir.to_path_buf()];
    let mut visited = 0usize;
    let mut total_bytes = 0u64;
    let mut truncated = false;

    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_CACHE_WALK_ENTRIES {
                truncated = true;
                stack.clear();
                break;
            }
            let path = entry.path();
            let Ok(entry_meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if is_reparse_or_symlink(&entry_meta) {
                continue;
            }
            if entry_meta.is_dir() {
                stack.push(path);
            } else if entry_meta.is_file() {
                total_bytes = total_bytes.saturating_add(entry_meta.len());
            }
        }
    }

    ClientCacheObservation {
        presence: "found",
        total_bytes: Some(total_bytes),
        truncated,
        drive_free_bytes,
        drive_total_bytes,
    }
}

fn inspect_osc_local(osc_dir: &Path, probe: &dyn LocalDiagnosticsProbe) -> OscLocalObservation {
    let udp9000 = probe.probe_udp_port(9000);
    let udp9001 = probe.probe_udp_port(9001);
    let osc_query = probe.probe_oscquery_loopback();

    match fs::symlink_metadata(osc_dir) {
        Ok(meta) if is_reparse_or_symlink(&meta) || !meta.is_dir() => {
            return OscLocalObservation {
                avatar_cache_presence: "read_failed",
                avatar_config_count: 0,
                avatar_cache_bytes: 0,
                newest_modified_at: None,
                udp9000,
                udp9001,
                osc_query,
            };
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return OscLocalObservation {
                avatar_cache_presence: "missing",
                avatar_config_count: 0,
                avatar_cache_bytes: 0,
                newest_modified_at: None,
                udp9000,
                udp9001,
                osc_query,
            };
        }
        Err(_) => {
            return OscLocalObservation {
                avatar_cache_presence: "read_failed",
                avatar_config_count: 0,
                avatar_cache_bytes: 0,
                newest_modified_at: None,
                udp9000,
                udp9001,
                osc_query,
            };
        }
    }

    let entries = match fs::read_dir(osc_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return OscLocalObservation {
                avatar_cache_presence: "missing",
                avatar_config_count: 0,
                avatar_cache_bytes: 0,
                newest_modified_at: None,
                udp9000,
                udp9001,
                osc_query,
            };
        }
        Err(_) => {
            return OscLocalObservation {
                avatar_cache_presence: "read_failed",
                avatar_config_count: 0,
                avatar_cache_bytes: 0,
                newest_modified_at: None,
                udp9000,
                udp9001,
                osc_query,
            };
        }
    };

    let mut count = 0u64;
    let mut bytes = 0u64;
    let mut newest: Option<SystemTime> = None;

    for user_entry in entries.flatten() {
        let user_name = user_entry.file_name();
        if !user_name.to_string_lossy().starts_with("usr_") {
            continue;
        }
        let user_path = user_entry.path();
        let Ok(user_meta) = fs::symlink_metadata(&user_path) else {
            continue;
        };
        if is_reparse_or_symlink(&user_meta) || !user_meta.is_dir() {
            continue;
        }
        let avatars_dir = user_path.join("Avatars");
        let Ok(avatars_meta) = fs::symlink_metadata(&avatars_dir) else {
            continue;
        };
        if is_reparse_or_symlink(&avatars_meta) || !avatars_meta.is_dir() {
            continue;
        }
        let Ok(avatar_files) = fs::read_dir(&avatars_dir) else {
            continue;
        };
        for file_entry in avatar_files.flatten() {
            let file_path = file_entry.path();
            if file_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_none_or(|ext| !ext.eq_ignore_ascii_case("json"))
            {
                continue;
            }
            let Ok(file_meta) = fs::symlink_metadata(&file_path) else {
                continue;
            };
            if is_reparse_or_symlink(&file_meta) || !file_meta.is_file() {
                continue;
            }
            count += 1;
            bytes = bytes.saturating_add(file_meta.len());
            if let Ok(mtime) = file_meta.modified() {
                newest = Some(match newest {
                    Some(prev) if prev >= mtime => prev,
                    _ => mtime,
                });
            }
        }
    }

    OscLocalObservation {
        avatar_cache_presence: "found",
        avatar_config_count: count,
        avatar_cache_bytes: bytes,
        newest_modified_at: newest.map(rfc3339),
        udp9000,
        udp9001,
        osc_query,
    }
}

const SOUND_MAPPER_SUBKEY: &str = "Software\\Microsoft\\Multimedia\\Sound Mapper";
const QUEST_LINK_SUBKEY: &str = "Software\\Oculus\\RemoteHeadset";
const GRAPHICS_DRIVERS_SUBKEY: &str = "SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers";
const POWER_SCHEMES_SUBKEY: &str = "SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes";
const PICO_SETTINGS_MAX_BYTES: u64 = 512 * 1024;
const LIBRARY_VDF_MAX_BYTES: u64 = 512 * 1024;

fn inspect_system_tuning(roots: &EnvironmentRoots) -> SystemTuningObservation {
    let hardware_gpu_scheduling = match roots.registry.get_u32(
        RegistryHive::LocalMachine,
        GRAPHICS_DRIVERS_SUBKEY,
        "HwSchMode",
    ) {
        Some(2) => Some(true),
        Some(1) => Some(false),
        _ => None,
    };

    let active_scheme = roots
        .registry
        .get_string(
            RegistryHive::LocalMachine,
            POWER_SCHEMES_SUBKEY,
            "ActivePowerScheme",
        )
        .or_else(|| {
            roots.registry.get_string(
                RegistryHive::CurrentUser,
                POWER_SCHEMES_SUBKEY,
                "ActivePowerScheme",
            )
        });
    let power_plan_role = match active_scheme.as_deref() {
        None => "unknown",
        Some(raw) => {
            let guid = raw
                .trim()
                .trim_matches('{')
                .trim_matches('}')
                .to_ascii_lowercase();
            match guid.as_str() {
                "" => "unknown",
                "a1841308-3541-4fab-bc81-f71556f20b4a" => "power_saver",
                "381b4222-f694-41f0-9685-ff5bb260df2e" => "balanced",
                "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" | "e9a42b02-d5df-448d-aa00-03f14749eb61" => {
                    "high_or_ultimate"
                }
                _ => "custom",
            }
        }
    };

    let ovr_advanced_settings_installed = detect_ovr_advanced_settings(roots);

    SystemTuningObservation {
        hardware_gpu_scheduling,
        power_plan_role,
        ovr_advanced_settings_installed,
    }
}

fn is_regular_non_symlink_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| !is_reparse_or_symlink(&m) && m.is_file())
}

fn detect_ovr_advanced_settings(roots: &EnvironmentRoots) -> bool {
    let mut steam_roots = Vec::new();
    for (hive, subkey, value_name) in [
        (
            RegistryHive::CurrentUser,
            "Software\\Valve\\Steam",
            "SteamPath",
        ),
        (
            RegistryHive::LocalMachine,
            "SOFTWARE\\WOW6432Node\\Valve\\Steam",
            "InstallPath",
        ),
        (
            RegistryHive::LocalMachine,
            "SOFTWARE\\Valve\\Steam",
            "InstallPath",
        ),
    ] {
        if let Some(dir) = roots.registry.get_string(hive, subkey, value_name) {
            let trimmed = dir.trim();
            if !trimmed.is_empty() {
                let path = PathBuf::from(trimmed);
                if !steam_roots.contains(&path) {
                    steam_roots.push(path);
                }
            }
        }
    }
    for candidate in &roots.steam_install_candidates {
        if !steam_roots.contains(candidate) {
            steam_roots.push(candidate.clone());
        }
    }

    let mut steamapps_dirs = Vec::new();
    for steam_root in &steam_roots {
        let primary = steam_root.join("steamapps");
        if !steamapps_dirs.contains(&primary) {
            steamapps_dirs.push(primary.clone());
        }
        let vdf = primary.join("libraryfolders.vdf");
        if let Ok(text) = read_bounded_regular_utf8(&vdf, LIBRARY_VDF_MAX_BYTES) {
            for line in text.lines().take(512) {
                if let Some(rest) = line.trim().strip_prefix("\"path\"") {
                    let quoted = rest.trim().trim_matches('"').replace("\\\\", "\\");
                    if !quoted.is_empty() {
                        let lib = PathBuf::from(quoted).join("steamapps");
                        if !steamapps_dirs.contains(&lib) && steamapps_dirs.len() < 32 {
                            steamapps_dirs.push(lib);
                        }
                    }
                }
            }
        }
    }

    for steamapps in &steamapps_dirs {
        if is_regular_non_symlink_file(&steamapps.join("appmanifest_1009850.acf")) {
            return true;
        }
        let common = steamapps.join("common");
        if is_regular_non_symlink_file(
            &common
                .join("OVR_AdvancedSettings")
                .join("AdvancedSettings.exe"),
        ) || is_regular_non_symlink_file(
            &common
                .join("OVR Advanced Settings")
                .join("AdvancedSettings.exe"),
        ) {
            return true;
        }
    }

    for common in &roots.steam_common {
        if is_regular_non_symlink_file(
            &common
                .join("OVR_AdvancedSettings")
                .join("AdvancedSettings.exe"),
        ) || is_regular_non_symlink_file(
            &common
                .join("OVR Advanced Settings")
                .join("AdvancedSettings.exe"),
        ) {
            return true;
        }
    }
    false
}

fn inspect_audio_endpoints(roots: &EnvironmentRoots) -> AudioEndpointObservation {
    let record =
        roots
            .registry
            .get_string(RegistryHive::CurrentUser, SOUND_MAPPER_SUBKEY, "Record");
    let comm_record = roots.registry.get_string(
        RegistryHive::CurrentUser,
        SOUND_MAPPER_SUBKEY,
        "ConsoleVoiceComRecord",
    );

    let (default_capture_role, virtual_mic_hijack) = match record.as_deref() {
        None => ("unknown", "none"),
        Some(raw) => {
            let lower = raw.trim().to_ascii_lowercase();
            if lower.is_empty() {
                ("none", "none")
            } else if lower.contains("oculus virtual audio")
                || lower.contains("headset microphone (oculus")
            {
                ("vr_virtual", "oculus_virtual")
            } else if lower.contains("steam streaming microphone") {
                ("vr_virtual", "steam_streaming")
            } else if lower.contains("pico streaming")
                || lower.contains("pico virtual")
                || lower.contains("pico connect")
            {
                ("vr_virtual", "pico_streaming")
            } else if lower.contains("virtual desktop audio") {
                ("vr_virtual", "virtual_desktop")
            } else if lower.contains("vb-audio")
                || lower.contains("voicemeeter")
                || lower.contains("cable output")
                || lower.contains("virtual audio cable")
            {
                ("virtual_cable", "none")
            } else {
                ("physical_or_usb", "none")
            }
        }
    };

    let communications_mismatch = match (record.as_deref(), comm_record.as_deref()) {
        (Some(def), Some(comm)) => {
            let def_t = def.trim();
            let comm_t = comm.trim();
            !def_t.is_empty() && !comm_t.is_empty() && !def_t.eq_ignore_ascii_case(comm_t)
        }
        _ => false,
    };

    AudioEndpointObservation {
        state: "observed",
        default_capture_role,
        virtual_mic_hijack,
        communications_mismatch,
    }
}

fn inspect_streaming_settings(roots: &EnvironmentRoots) -> StreamingSettingsObservation {
    let encode_resolution_width = roots
        .registry
        .get_u32(RegistryHive::CurrentUser, QUEST_LINK_SUBKEY, "EncodeWidth")
        .filter(|w| (1..=16_384).contains(w));
    let encode_bitrate_mbps = roots
        .registry
        .get_u32(RegistryHive::CurrentUser, QUEST_LINK_SUBKEY, "BitrateMbps")
        .filter(|b| (1..=2_000).contains(b));
    let dynamic_bitrate = roots
        .registry
        .get_u32(RegistryHive::CurrentUser, QUEST_LINK_SUBKEY, "DBR")
        .map(|v| v != 0);
    let link_sharpening = roots
        .registry
        .get_u32(
            RegistryHive::CurrentUser,
            QUEST_LINK_SUBKEY,
            "LinkSharpening",
        )
        .filter(|v| *v <= 10);

    let quest_link = if encode_resolution_width.is_some()
        || encode_bitrate_mbps.is_some()
        || dynamic_bitrate.is_some()
        || link_sharpening.is_some()
    {
        QuestLinkSettingsObservation {
            presence: "found",
            encode_resolution_width,
            encode_bitrate_mbps,
            dynamic_bitrate,
            link_sharpening,
        }
    } else {
        QuestLinkSettingsObservation::missing()
    };

    let pico_connect = inspect_pico_connect_settings(&roots.pico_connect_settings_candidates);

    StreamingSettingsObservation {
        quest_link,
        pico_connect,
    }
}

fn inspect_pico_connect_settings(candidates: &[PathBuf]) -> PicoConnectSettingsObservation {
    for path in candidates {
        let raw = match read_bounded_regular_utf8(path, PICO_SETTINGS_MAX_BYTES) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return PicoConnectSettingsObservation::empty("read_failed"),
        };
        let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) else {
            return PicoConnectSettingsObservation::empty("malformed");
        };
        let preset = ["preset", "quality", "videoQuality"]
            .iter()
            .find_map(|k| obj.get(*k).and_then(Value::as_str))
            .map(str::trim)
            .filter(|s| {
                !s.is_empty()
                    && s.len() <= 32
                    && s.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_- .".contains(&b))
            })
            .map(str::to_owned);
        let bitrate_mbps = ["bitrateMbps", "bitrate", "videoBitrate"]
            .iter()
            .find_map(|k| obj.get(*k).and_then(Value::as_u64))
            .and_then(|v| {
                if (1..=2_000).contains(&v) {
                    u32::try_from(v).ok()
                } else if (2_001..=2_000_000).contains(&v) {
                    u32::try_from(v / 1000).ok().filter(|m| *m >= 1)
                } else {
                    None
                }
            });
        return PicoConnectSettingsObservation {
            presence: "found",
            preset,
            bitrate_mbps,
        };
    }
    PicoConnectSettingsObservation::empty("missing")
}

fn clear_osc_json_files(osc_dir: &Path) -> Result<(u64, u64), LocalDiagnosticsError> {
    match fs::symlink_metadata(osc_dir) {
        Ok(meta) if is_reparse_or_symlink(&meta) || !meta.is_dir() => {
            return Err(LocalDiagnosticsError::IoFailed);
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(_) => return Err(LocalDiagnosticsError::IoFailed),
    }
    let entries = match fs::read_dir(osc_dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(_) => return Err(LocalDiagnosticsError::IoFailed),
    };
    let mut removed = 0u64;
    let mut freed = 0u64;

    for user_entry in entries.flatten() {
        if !user_entry.file_name().to_string_lossy().starts_with("usr_") {
            continue;
        }
        let user_path = user_entry.path();
        let Ok(user_meta) = fs::symlink_metadata(&user_path) else {
            continue;
        };
        if is_reparse_or_symlink(&user_meta) || !user_meta.is_dir() {
            continue;
        }
        let avatars_dir = user_path.join("Avatars");
        let Ok(avatars_meta) = fs::symlink_metadata(&avatars_dir) else {
            continue;
        };
        if is_reparse_or_symlink(&avatars_meta) || !avatars_meta.is_dir() {
            continue;
        }
        let avatar_files =
            fs::read_dir(&avatars_dir).map_err(|_| LocalDiagnosticsError::IoFailed)?;
        for file_entry in avatar_files.flatten() {
            let file_path = file_entry.path();
            if file_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_none_or(|ext| !ext.eq_ignore_ascii_case("json"))
            {
                continue;
            }
            let Ok(file_meta) = fs::symlink_metadata(&file_path) else {
                continue;
            };
            if is_reparse_or_symlink(&file_meta) || !file_meta.is_file() {
                continue;
            }
            let size = file_meta.len();
            fs::remove_file(&file_path).map_err(|_| LocalDiagnosticsError::IoFailed)?;
            removed += 1;
            freed = freed.saturating_add(size);
        }
    }
    Ok((removed, freed))
}

fn steamvr_settings_candidates(roots: &EnvironmentRoots) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for vrpath in &roots.openvrpaths {
        if let Ok(raw) = read_bounded_regular_utf8(vrpath, MAX_CONFIG_JSON_BYTES) {
            if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) {
                if let Some(configs) = obj.get("config").and_then(Value::as_array) {
                    for entry in configs.iter().filter_map(Value::as_str) {
                        let candidate = PathBuf::from(entry).join("steamvr.vrsettings");
                        if !out.contains(&candidate) {
                            out.push(candidate);
                        }
                    }
                }
            }
        }
    }
    for (hive, subkey, value_name) in [
        (
            RegistryHive::CurrentUser,
            "Software\\Valve\\Steam",
            "SteamPath",
        ),
        (
            RegistryHive::LocalMachine,
            "SOFTWARE\\WOW6432Node\\Valve\\Steam",
            "InstallPath",
        ),
        (
            RegistryHive::LocalMachine,
            "SOFTWARE\\Valve\\Steam",
            "InstallPath",
        ),
    ] {
        if let Some(steam_dir) = roots.registry.get_string(hive, subkey, value_name) {
            let trimmed = steam_dir.trim();
            if !trimmed.is_empty() {
                let candidate = PathBuf::from(trimmed)
                    .join("config")
                    .join("steamvr.vrsettings");
                if !out.contains(&candidate) {
                    out.push(candidate);
                }
            }
        }
    }
    for steam_root in &roots.steam_install_candidates {
        let candidate = steam_root.join("config").join("steamvr.vrsettings");
        if !out.contains(&candidate) {
            out.push(candidate);
        }
    }
    out
}

fn inspect_steamvr_settings(roots: &EnvironmentRoots) -> SteamVrSettingsObservation {
    let candidates = steamvr_settings_candidates(roots);
    let mut saw_read_error = false;
    for path in candidates {
        match read_bounded_regular_utf8(&path, MAX_STEAMVR_SETTINGS_BYTES) {
            Ok(raw) => {
                let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&raw) else {
                    return SteamVrSettingsObservation::empty("malformed");
                };
                let steamvr = obj.get("steamvr").and_then(Value::as_object);
                let render_target_multiplier = steamvr
                    .and_then(|s| s.get("renderTargetMultiplier"))
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite());
                let motion_smoothing = steamvr
                    .and_then(|s| s.get("motionSmoothing"))
                    .and_then(Value::as_bool);
                let safe_mode_enabled = steamvr
                    .and_then(|s| s.get("enableSafeMode"))
                    .and_then(Value::as_bool);
                let vrchat_resolution_scale = obj
                    .get("steam.app.438100")
                    .and_then(Value::as_object)
                    .and_then(|s| s.get("resolutionScale"))
                    .and_then(Value::as_f64)
                    .filter(|v| v.is_finite());

                let mut blocked_drivers: Vec<String> = obj
                    .iter()
                    .filter_map(|(key, value)| {
                        let driver_id = key.strip_prefix("driver_")?;
                        let blocked = value
                            .as_object()?
                            .get("blocked_by_safe_mode")
                            .and_then(Value::as_bool)?;
                        if blocked
                            && !driver_id.is_empty()
                            && driver_id.len() <= 80
                            && !driver_id.contains(['\\', '/', ':'])
                        {
                            Some(driver_id.to_owned())
                        } else {
                            None
                        }
                    })
                    .collect();
                blocked_drivers.sort();
                blocked_drivers.dedup();
                blocked_drivers.truncate(32);

                return SteamVrSettingsObservation {
                    presence: "found",
                    render_target_multiplier,
                    motion_smoothing,
                    vrchat_resolution_scale,
                    safe_mode_enabled,
                    blocked_drivers,
                };
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => saw_read_error = true,
        }
    }
    SteamVrSettingsObservation::empty(if saw_read_error {
        "read_failed"
    } else {
        "missing"
    })
}

fn inspect_recent_client_log(vrchat_root: &Path) -> RecentClientLogObservation {
    match fs::symlink_metadata(vrchat_root) {
        Ok(meta) if is_reparse_or_symlink(&meta) || !meta.is_dir() => {
            return RecentClientLogObservation {
                classification: "read_failed",
                newest_modified_at: None,
            };
        }
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return RecentClientLogObservation {
                classification: "no_logs",
                newest_modified_at: None,
            };
        }
        Err(_) => {
            return RecentClientLogObservation {
                classification: "read_failed",
                newest_modified_at: None,
            };
        }
    }
    let entries = match fs::read_dir(vrchat_root) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return RecentClientLogObservation {
                classification: "no_logs",
                newest_modified_at: None,
            };
        }
        Err(_) => {
            return RecentClientLogObservation {
                classification: "read_failed",
                newest_modified_at: None,
            };
        }
    };

    let mut newest: Option<(SystemTime, String, PathBuf)> = None;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("output_log_") || !name.ends_with(".txt") {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if is_reparse_or_symlink(&meta) || !meta.is_file() {
            continue;
        }
        let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let replace = match &newest {
            None => true,
            Some((prev_time, prev_name, _)) => (mtime, &name) > (*prev_time, prev_name),
        };
        if replace {
            newest = Some((mtime, name, path));
        }
    }

    let Some((mtime, _, log_path)) = newest else {
        return RecentClientLogObservation {
            classification: "no_logs",
            newest_modified_at: None,
        };
    };

    let newest_modified_at = Some(rfc3339(mtime));
    let mut file = match File::open(&log_path) {
        Ok(file) => file,
        Err(_) => {
            return RecentClientLogObservation {
                classification: "read_failed",
                newest_modified_at,
            };
        }
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let offset = len.saturating_sub(LOG_TAIL_MAX_BYTES);
    if file.seek(SeekFrom::Start(offset)).is_err() {
        return RecentClientLogObservation {
            classification: "read_failed",
            newest_modified_at,
        };
    }
    let mut buf = Vec::with_capacity(LOG_TAIL_MAX_BYTES as usize);
    if file.take(LOG_TAIL_MAX_BYTES).read_to_end(&mut buf).is_err() {
        return RecentClientLogObservation {
            classification: "read_failed",
            newest_modified_at,
        };
    }
    let tail_lower = String::from_utf8_lossy(&buf).to_ascii_lowercase();
    drop(buf);
    let classification = classify_log_tail(&tail_lower);
    RecentClientLogObservation {
        classification,
        newest_modified_at,
    }
}

pub fn classify_log_tail(lower: &str) -> &'static str {
    if lower.contains("easyanticheat")
        && (lower.contains("violation")
            || lower.contains("untrusted")
            || lower.contains("failed to initialize")
            || lower.contains("hash catalogue")
            || lower.contains("launch error"))
    {
        return "eac_launch_violation";
    }
    if lower.contains("there is not enough space on the disk")
        || lower.contains("no space left on device")
        || lower.contains("ioexception: disk full")
        || lower.contains("disk full")
    {
        return "disk_full_write_error";
    }
    if lower.contains("d3d11: failed to create")
        || lower.contains("dxgi_error_device_removed")
        || lower.contains("dxgi_error_device_hung")
        || lower.contains("dxgi_error_device_reset")
        || lower.contains("could not allocate memory: system out of memory")
        || lower.contains("out of video memory")
    {
        return "d3d11_device_lost_or_oom";
    }
    if lower.contains("osc")
        && (lower.contains("only one usage of each socket address")
            || lower.contains("address already in use")
            || lower.contains("socketexception"))
    {
        return "osc_socket_conflict";
    }
    if lower.contains("openvr initialize failed")
        || lower.contains("vriniterror_")
        || lower.contains("xr_error_runtime_failure")
        || lower.contains("failed to initialize openxr")
    {
        return "openvr_init_failed";
    }
    "clean_or_inconclusive"
}

fn collect_findings_for_symptom(
    symptom: SymptomId,
    snapshot: &LocalDiagnosticsSnapshot,
) -> Vec<SymptomFinding> {
    let mut out = Vec::new();
    let push = |out: &mut Vec<SymptomFinding>, code, severity, layer| {
        if !out.iter().any(|f| f.code == code) {
            out.push(SymptomFinding {
                code,
                severity,
                layer,
            });
        }
    };

    let audio_relevant = matches!(symptom, SymptomId::AudioSilentOrWrongMic);
    let osc_relevant = matches!(
        symptom,
        SymptomId::OscOrFaceTrackingNotResponding | SymptomId::FbtDriftOrCalibration
    );
    let perf_relevant = matches!(
        symptom,
        SymptomId::LowFpsOrVramPressure
            | SymptomId::CrashOrEacBlock
            | SymptomId::StreamingBlurryOrCompression
    );
    let disk_relevant = matches!(
        symptom,
        SymptomId::DiskCacheFull
            | SymptomId::AvatarHiddenOrGreyRobot
            | SymptomId::CannotUploadAvatar
            | SymptomId::CrashOrEacBlock
    );

    if audio_relevant {
        if snapshot.audio_endpoints.virtual_mic_hijack != "none" {
            push(
                &mut out,
                "audio_virtual_mic_hijack_detected",
                "attention",
                "hardware_os",
            );
        }
        if snapshot.audio_endpoints.communications_mismatch {
            push(
                &mut out,
                "audio_communications_default_mismatch",
                "warning",
                "hardware_os",
            );
        }
    }

    if osc_relevant {
        if snapshot.client_running == Some(true) && snapshot.osc.udp9000.state == "unbound" {
            push(
                &mut out,
                "osc_port_9000_unbound_while_client_running",
                "attention",
                "companion_osc",
            );
        }
        if snapshot.osc.udp9000.state == "bound"
            && snapshot
                .osc
                .udp9000
                .owner_process
                .as_deref()
                .is_some_and(|p| p != "vrchat.exe")
        {
            push(
                &mut out,
                "osc_port_9000_conflict",
                "attention",
                "companion_osc",
            );
        }
        if snapshot.osc.osc_query.state == "found"
            && snapshot
                .osc
                .osc_query
                .advertised_osc_port
                .is_some_and(|p| p != 9000)
        {
            push(
                &mut out,
                "oscquery_port_mismatch",
                "attention",
                "companion_osc",
            );
        }
        if snapshot.osc.udp9001.state == "unbound" {
            push(&mut out, "osc_port_9001_unbound", "info", "companion_osc");
        }
        if snapshot.osc.avatar_config_count > 0 {
            push(
                &mut out,
                "osc_avatar_cache_present",
                "info",
                "companion_osc",
            );
        }
    }

    if !snapshot.steamvr_settings.blocked_drivers.is_empty() {
        push(
            &mut out,
            "steamvr_driver_blocked_by_safe_mode",
            "attention",
            "steamvr_openxr",
        );
    }

    if perf_relevant {
        if snapshot
            .steamvr_settings
            .render_target_multiplier
            .is_some_and(|m| m > 1.5)
        {
            push(
                &mut out,
                "steamvr_high_supersampling",
                "warning",
                "steamvr_openxr",
            );
        }
        if snapshot
            .steamvr_settings
            .vrchat_resolution_scale
            .is_some_and(|s| s > 1.3)
        {
            push(
                &mut out,
                "steamvr_app_overscaled",
                "warning",
                "steamvr_openxr",
            );
        }
        let high_streaming = snapshot
            .streaming_settings
            .quest_link
            .encode_bitrate_mbps
            .is_some_and(|b| b > 500)
            || snapshot
                .streaming_settings
                .quest_link
                .encode_resolution_width
                .is_some_and(|w| w > 4128)
            || snapshot
                .streaming_settings
                .pico_connect
                .bitrate_mbps
                .is_some_and(|b| b > 150);
        if high_streaming {
            push(
                &mut out,
                "streaming_high_bitrate_or_encode_width",
                "warning",
                "steamvr_openxr",
            );
        }
        if snapshot.system_tuning.hardware_gpu_scheduling == Some(true) {
            push(
                &mut out,
                "windows_hags_enabled_vr_stutter_risk",
                "info",
                "hardware_os",
            );
        }
    }

    if matches!(
        symptom,
        SymptomId::LowFpsOrVramPressure
            | SymptomId::StreamingBlurryOrCompression
            | SymptomId::FbtDriftOrCalibration
    ) && snapshot.system_tuning.power_plan_role == "power_saver"
    {
        push(
            &mut out,
            "windows_power_saver_active",
            "warning",
            "hardware_os",
        );
    }

    if matches!(symptom, SymptomId::StreamingBlurryOrCompression) {
        let low_streaming = snapshot
            .streaming_settings
            .quest_link
            .encode_bitrate_mbps
            .is_some_and(|b| b < 100)
            || snapshot
                .streaming_settings
                .quest_link
                .encode_resolution_width
                .is_some_and(|w| w < 2800)
            || snapshot.streaming_settings.quest_link.link_sharpening == Some(0)
            || snapshot
                .streaming_settings
                .pico_connect
                .bitrate_mbps
                .is_some_and(|b| b < 50)
            || snapshot
                .streaming_settings
                .pico_connect
                .preset
                .as_deref()
                .is_some_and(|p| {
                    matches!(p.to_ascii_lowercase().as_str(), "smooth" | "low" | "sd")
                });
        if low_streaming {
            push(
                &mut out,
                "streaming_low_bitrate_or_sharpening_off",
                "warning",
                "steamvr_openxr",
            );
        }
    }

    if matches!(
        symptom,
        SymptomId::PlayspaceDragOrHeightOffset | SymptomId::FbtDriftOrCalibration
    ) && snapshot.system_tuning.ovr_advanced_settings_installed
    {
        push(
            &mut out,
            "ovr_advanced_settings_installed_offset_check",
            "info",
            "companion_osc",
        );
    }

    if snapshot.client_config.presence == "malformed" {
        push(
            &mut out,
            "client_config_malformed",
            "warning",
            "client_config_cache",
        );
    }

    if let Some(free) = snapshot.client_cache.drive_free_bytes {
        if free < 10 * GIB {
            push(
                &mut out,
                "drive_free_space_low",
                if disk_relevant {
                    "attention"
                } else {
                    "warning"
                },
                "hardware_os",
            );
        }
    }

    if disk_relevant {
        let cap_bytes = snapshot
            .client_config
            .cache_size_gb
            .unwrap_or(30)
            .saturating_mul(GIB);
        if let Some(total) = snapshot.client_cache.total_bytes {
            if cap_bytes > 0 && total >= cap_bytes.saturating_mul(9) / 10 {
                push(
                    &mut out,
                    "client_cache_near_limit",
                    "warning",
                    "client_config_cache",
                );
            }
        }
    }

    match snapshot.recent_client_log.classification {
        "eac_launch_violation" => push(
            &mut out,
            "log_eac_violation_detected",
            "attention",
            "client_config_cache",
        ),
        "disk_full_write_error" => push(
            &mut out,
            "log_disk_full_detected",
            "attention",
            "client_config_cache",
        ),
        "d3d11_device_lost_or_oom" if perf_relevant => push(
            &mut out,
            "log_d3d11_crash_detected",
            "attention",
            "hardware_os",
        ),
        "osc_socket_conflict" if osc_relevant || matches!(symptom, SymptomId::CrashOrEacBlock) => {
            push(
                &mut out,
                "log_osc_conflict_detected",
                "attention",
                "companion_osc",
            )
        }
        "openvr_init_failed" => push(
            &mut out,
            "log_openvr_init_failed",
            "attention",
            "steamvr_openxr",
        ),
        _ => {}
    }

    out.truncate(16);
    out
}

fn build_sop_steps(
    symptom: SymptomId,
    snapshot: &LocalDiagnosticsSnapshot,
    findings: &[SymptomFinding],
) -> Vec<DiagnosticSopStep> {
    let has = |code: &str| findings.iter().any(|f| f.code == code);
    let mut steps = Vec::new();

    match symptom {
        SymptomId::AudioSilentOrWrongMic => {
            if has("audio_virtual_mic_hijack_detected") {
                steps.push(DiagnosticSopStep {
                    step_id: "audio_restore_hijacked_default_mic",
                    layer: "hardware_os",
                    title: "Switch Windows Default Input off inactive VR virtual microphone",
                    instruction: "Windows Default Recording device is set to a VR streaming virtual microphone (Oculus / Steam Streaming / PICO / Virtual Desktop). When that streamer is inactive or unrouted, VRChat receives silence — select your active physical or headset microphone in Windows Sound and VRChat.",
                });
            }
            steps.push(DiagnosticSopStep {
                step_id: "audio_windows_input_output",
                layer: "hardware_os",
                title: "Verify Windows default input/output and per-app volume",
                instruction: "Open Windows Sound -> Volume Mixer, confirm your headset microphone is not muted, and check Windows Privacy -> Microphone permissions for desktop apps.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "audio_steamvr_device_override",
                layer: "steamvr_openxr",
                title: "Check SteamVR and streaming runtime audio routing",
                instruction: "In SteamVR Settings -> Audio (and Virtual Desktop / PICO Connect / Quest Link if streaming), ensure Audio Output and Microphone point to the active headset virtual audio device instead of a disconnected monitor.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "audio_in_game_mic_settings",
                layer: "client_config_cache",
                title: "Confirm in-game Microphone selection and activation threshold",
                instruction: "Open VRChat Main Menu -> Audio -> Microphone, select the exact headset mic device explicitly (avoid Default when virtual cables exist), and lower the mic activation threshold if quiet speech is clipped.",
            });
        }
        SymptomId::OscOrFaceTrackingNotResponding => {
            if has("osc_port_9000_conflict") || has("log_osc_conflict_detected") {
                steps.push(DiagnosticSopStep {
                    step_id: "osc_resolve_port_9000_conflict",
                    layer: "companion_osc",
                    title: "Release conflicting app bound to UDP port 9000",
                    instruction: "Another local process is holding UDP port 9000 before VRChat can bind its OSC receiver. Close the conflicting app, start VRChat first so it binds UDP 9000, and then launch VRCFaceTracking / SlimeVR / VRCT.",
                });
            }
            if has("oscquery_port_mismatch") {
                steps.push(DiagnosticSopStep {
                    step_id: "osc_align_oscquery_port",
                    layer: "companion_osc",
                    title: "Align static OSC sender port with OSCQuery negotiated port",
                    instruction: "Loopback OSCQuery advertised a non-9000 UDP OSC receiver port. Enable OSCQuery auto-discovery in your companion app, or restart VRChat before launching static port-9000 tools.",
                });
            }
            if has("osc_port_9000_unbound_while_client_running") {
                steps.push(DiagnosticSopStep {
                    step_id: "osc_enable_radial_menu",
                    layer: "companion_osc",
                    title: "Enable OSC in VRChat's Radial Action Menu",
                    instruction: "VRChat is running, but UDP port 9000 is unbound. Open the Radial Menu (R on desktop / hold menu button in VR) -> Options -> OSC -> Enabled.",
                });
            } else {
                steps.push(DiagnosticSopStep {
                    step_id: "osc_verify_radial_menu_and_companion",
                    layer: "companion_osc",
                    title: "Verify OSC toggle and companion sender on UDP 9000/9001",
                    instruction: "Confirm Options -> OSC -> Enabled in VRChat's Radial Menu, and check that your companion app (VRCFaceTracking, SlimeVR, or VRCT) targets 127.0.0.1:9000 and listens on 9001.",
                });
            }
            if has("steamvr_driver_blocked_by_safe_mode") {
                steps.push(DiagnosticSopStep {
                    step_id: "steamvr_unblock_safe_mode_drivers",
                    layer: "steamvr_openxr",
                    title: "Unblock SteamVR add-on drivers disabled by Safe Mode",
                    instruction: "SteamVR Safe Mode has blocked one or more external drivers (such as Space Calibrator or SlimeVR). Open SteamVR Settings -> Startup / Shutdown -> Manage Add-ons and re-enable blocked drivers.",
                });
            }
            if snapshot.osc.avatar_config_count > 0 {
                steps.push(DiagnosticSopStep {
                    step_id: "osc_refresh_avatar_json_cache",
                    layer: "client_config_cache",
                    title: "Clear stale OSC Avatar parameter cache while VRChat is closed",
                    instruction: "When an Avatar's Expression Parameters change after re-upload, VRChat keeps old parameter mappings in LocalLow/VRChat/VRChat/OSC/usr_*/Avatars/*.json. Close VRChat and run Clear OSC Avatar Cache, or click Reset Config in the OSC Radial Menu.",
                });
            }
            steps.push(DiagnosticSopStep {
                step_id: "osc_check_avatar_parameters",
                layer: "avatar_sdk",
                title: "Confirm the worn Avatar includes VRCFT / OSC parameters",
                instruction: "Ensure the worn Avatar was built with face-tracking or OSC Expression Parameters (e.g. Unified Expressions / Jerry's Face Tracking template) and stays within VRChat's 256-bit synced parameter budget.",
            });
        }
        SymptomId::LowFpsOrVramPressure => {
            if has("steamvr_high_supersampling") || has("steamvr_app_overscaled") {
                steps.push(DiagnosticSopStep {
                    step_id: "perf_reduce_steamvr_supersampling",
                    layer: "steamvr_openxr",
                    title: "Lower compounded SteamVR render resolution scaling",
                    instruction: "SteamVR global or per-app VRChat resolution scale is above 130%-150%, which multiplies pixel load on top of your streaming Codec resolution. Reset SteamVR VRChat per-app resolution toward 100%.",
                });
            }
            if has("streaming_high_bitrate_or_encode_width") {
                steps.push(DiagnosticSopStep {
                    step_id: "perf_tune_streaming_bitrate_and_resolution",
                    layer: "steamvr_openxr",
                    title: "Lower Quest Link / PICO Connect encode width or bitrate",
                    instruction: "High streaming encode resolution (>4128 px) or bitrate (>500 Mbps Quest Link / >150 Mbps PICO Connect) saturates GPU video encoders and VRAM buffers. Step down to Balanced/HD preset or enable dynamic bitrate.",
                });
            }
            if has("windows_hags_enabled_vr_stutter_risk") || has("windows_power_saver_active") {
                steps.push(DiagnosticSopStep {
                    step_id: "perf_windows_hags_and_power_plan",
                    layer: "hardware_os",
                    title: "Check Windows GPU Scheduling (HAGS) and active power plan",
                    instruction: "Windows Hardware-Accelerated GPU Scheduling or Power Saver mode can starve SteamVR compositor and wireless video encoders under high VRAM load. Switch Windows Power Mode to Balanced/High Performance, and test disabling Hardware-Accelerated GPU Scheduling if frame-time spikes persist.",
                });
            }
            if has("log_d3d11_crash_detected") {
                steps.push(DiagnosticSopStep {
                    step_id: "perf_d3d11_vram_exhaustion",
                    layer: "hardware_os",
                    title: "Recover from GPU / VRAM exhaustion signature in recent log",
                    instruction: "The newest client log recorded a D3D11 device reset or out-of-video-memory error. Lower Maximum Shown Avatars and Avatar Max Uncompressed Size in VRChat Graphics/Avatar Culling settings.",
                });
            }
            steps.push(DiagnosticSopStep {
                step_id: "perf_in_game_shield_and_culling",
                layer: "client_config_cache",
                title: "Enable Distance & Size Avatar Culling and Shield limits",
                instruction: "In VRChat Performance Options, cap Nearby Shown Avatars (e.g. 10-15), block Very Poor shaders/particles on strangers via Safety Shield, and lower Anti-Aliasing from 4x/8x to 2x or Off.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "perf_avatar_texture_memory_optimization",
                layer: "avatar_sdk",
                title: "Downscale 4K/8K outfit textures in VUA Workshop",
                instruction: "For your own Avatar, open VUA Workshop -> Texture Memory / Avatar Optimizer to cap oversized textures and strip unused meshes before uploading.",
            });
        }
        SymptomId::DiskCacheFull => {
            let clear_step = DiagnosticSopStep {
                step_id: "disk_tune_client_cache_limits",
                layer: "client_config_cache",
                title: "Clear downloaded content cache inside VRChat",
                instruction: "Open VRChat Settings -> Debug -> Clear Content Cache to reclaim space immediately (VRChat's minimum cache_size is 30 GB; if you previously raised cache_size above 30 GB, you can step it back toward 30 GB while VRChat is closed).",
            };
            let move_step = DiagnosticSopStep {
                step_id: "disk_free_system_drive_space",
                layer: "hardware_os",
                title: "Move cache_directory in config.json to a drive with more space",
                instruction: "With VRChat closed, set cache_directory in LocalLow/VRChat/VRChat/config.json to a folder on a larger SSD so Cache-WindowsPlayer stops filling your system drive.",
            };
            if has("drive_free_space_low") || has("log_disk_full_detected") {
                steps.push(move_step);
                steps.push(clear_step);
            } else {
                steps.push(clear_step);
                steps.push(move_step);
            }
        }
        SymptomId::CrashOrEacBlock => {
            if has("log_eac_violation_detected") {
                steps.push(DiagnosticSopStep {
                    step_id: "crash_eac_verify_files",
                    layer: "client_config_cache",
                    title: "Verify game files and avoid third-party DLL/overlay hooks",
                    instruction: "Recent client log shows an EasyAntiCheat launch/integrity failure. In Steam -> VRChat -> Properties -> Installed Files, run Verify integrity of game files, and close unsigned FPS/shader hooks.",
                });
            }
            if has("steamvr_driver_blocked_by_safe_mode") || has("log_openvr_init_failed") {
                steps.push(DiagnosticSopStep {
                    step_id: "crash_steamvr_openxr_runtime",
                    layer: "steamvr_openxr",
                    title: "Check OpenXR active runtime and SteamVR Safe Mode add-ons",
                    instruction: "SteamVR Safe Mode blocked external drivers or OpenVR/OpenXR failed to initialize. Start your headset streaming app first, check SteamVR Manage Add-ons, and verify OpenXR Runtime settings.",
                });
            }
            if has("client_config_malformed") {
                steps.push(DiagnosticSopStep {
                    step_id: "crash_repair_malformed_config_json",
                    layer: "client_config_cache",
                    title: "Repair malformed LocalLow/VRChat/VRChat/config.json",
                    instruction: "config.json contains invalid JSON syntax, which can break startup overrides. Close VRChat and fix or rename config.json so VRChat regenerates clean defaults.",
                });
            }
            steps.push(DiagnosticSopStep {
                step_id: "crash_gpu_driver_and_avatar_reset",
                layer: "hardware_os",
                title: "Rule out corrupted crash Avatar and unstable GPU overclocks",
                instruction: "If crashing immediately upon loading into home world, reset to a default Avatar on vrchat.com/home/avatars and check Windows Event Viewer for nvlddmkm / amdwddmg driver resets.",
            });
        }
        SymptomId::AvatarHiddenOrGreyRobot => {
            steps.push(DiagnosticSopStep {
                step_id: "visibility_safety_shield_and_show_avatar",
                layer: "client_config_cache",
                title: "Check Safety Shield rank and per-user Show Avatar override",
                instruction: "Grey robots or fallback impostors usually come from Safety Shield blocking Avatars/Custom Animations or Performance Rank filtering (Minimum Displayed Performance Rank set above Very Poor).",
            });
            if has("drive_free_space_low") || has("client_cache_near_limit") {
                steps.push(DiagnosticSopStep {
                    step_id: "visibility_cache_download_space",
                    layer: "client_config_cache",
                    title: "Ensure cache drive has room to download remote Avatar bundles",
                    instruction: "Your local VRChat cache or drive free space is near capacity, which prevents new Avatar bundles from unpacking. Clear old cache entries or raise cache_size while VRChat is closed.",
                });
            }
            steps.push(DiagnosticSopStep {
                step_id: "visibility_pc_vs_android_platform_build",
                layer: "avatar_sdk",
                title: "Confirm PC vs Quest/PICO standalone platform build availability",
                instruction: "PCVR players need a Windows PC asset bundle; standalone Quest/PICO players need an Android build uploaded to the same Blueprint ID.",
            });
        }
        SymptomId::CannotUploadAvatar => {
            steps.push(DiagnosticSopStep {
                step_id: "upload_trust_rank_and_2fa",
                layer: "avatar_sdk",
                title: "Verify New User+ trust rank and VRChat SDK sign-in",
                instruction: "Uploading custom Avatars requires at least 'New User' trust rank on a VRChat account (not an unmerged Steam/Quest stub account) plus completed 2FA verification in the SDK panel.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "upload_blueprint_id_ownership",
                layer: "avatar_sdk",
                title: "Detach foreign Pipeline Manager Blueprint IDs",
                instruction: "If Pipeline Manager carries an avtr_* Blueprint ID belonging to another account or deleted Avatar, click Detach inside Pipeline Manager (or use VUA Managed Upload) so a fresh ID is assigned.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "upload_unity_2022_3_22f1_and_sdk_checks",
                layer: "avatar_sdk",
                title: "Confirm Unity 2022.3.22f1, missing scripts, and network proxy",
                instruction: "Use VRChat's supported Unity 2022.3.22f1 editor, resolve Missing Scripts / Android shader errors in VUA Workshop's SDK Fixer, and run VUA Environment -> Network Check if upload stalls at 0%.",
            });
        }
        SymptomId::StreamingBlurryOrCompression => {
            steps.push(DiagnosticSopStep {
                step_id: "streaming_check_wifi_band_and_router",
                layer: "hardware_os",
                title: "Verify dedicated 5 GHz / 6 GHz Wi-Fi or USB 3.0+ link bandwidth",
                instruction: "For wireless PCVR (Virtual Desktop / PICO Connect / Air Link), wire the PC via Gigabit Ethernet and connect the headset to an uncongested 5 GHz (80 MHz) or 6 GHz channel; for wired Link, confirm USB 3.0 SuperSpeed negotiation instead of USB 2.0 fallback.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "streaming_raise_codec_bitrate_and_sharpening",
                layer: "steamvr_openxr",
                title: "Tune streaming codec, bitrate floor, and link sharpening",
                instruction: "Prefer HEVC 10-bit or AV1 (Quest 3 / PICO 4 Ultra) at 120-200 Mbps (or H.264+ at 300-400 Mbps), enable Link Sharpening / Snapdragon Game Super Resolution, and avoid Ultra encode presets when GPU encoder utilization nears 100%.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "streaming_align_steamvr_and_streamer_scale",
                layer: "steamvr_openxr",
                title: "Keep SteamVR resolution near 100% and scale once in your streamer",
                instruction: "Set quality in Virtual Desktop / PICO Connect / Quest Link first and keep SteamVR per-app resolution near 100% so double supersampling does not trigger dynamic bitrate drops and blocky compression.",
            });
        }
        SymptomId::PlayspaceDragOrHeightOffset => {
            steps.push(DiagnosticSopStep {
                step_id: "playspace_reset_ovras_offsets",
                layer: "companion_osc",
                title: "Reset OVR Advanced Settings playspace and gravity offsets",
                instruction: "Open OVR Advanced Settings -> Offsets and Motion tabs in your SteamVR dashboard, click Reset on X/Y/Z offsets, Space Drag, and Gravity, and disable Seated playspace overrides if your floor height stays shifted.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "playspace_redraw_guardian_boundary",
                layer: "steamvr_openxr",
                title: "Re-center headset floor level in Guardian / PICO Boundary / SteamVR",
                instruction: "Clear old room history in Quest Guardian or PICO Boundary, touch a controller to the physical floor to set floor level, and run SteamVR Room Setup -> Quick Calibrate if SteamVR floor height still disagrees.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "playspace_vrchat_height_and_ik_mode",
                layer: "client_config_cache",
                title: "Check VRChat User Real Height and Seated / Standing toggle",
                instruction: "Open VRChat Quick Menu -> Settings -> Tracking & IK, match User Real Height to your physical height, switch Measurement between Arm Span and Height if proportions feel stretched, and ensure Seated Mode is toggled as intended.",
            });
        }
        SymptomId::FbtDriftOrCalibration => {
            if has("steamvr_driver_blocked_by_safe_mode") {
                steps.push(DiagnosticSopStep {
                    step_id: "steamvr_unblock_safe_mode_drivers",
                    layer: "steamvr_openxr",
                    title: "Unblock SteamVR add-on drivers disabled by Safe Mode",
                    instruction: "SteamVR Safe Mode has blocked one or more external tracking drivers (SlimeVR, mocopi, or Space Calibrator). Open SteamVR Settings -> Startup / Shutdown -> Manage Add-ons and re-enable them.",
                });
            }
            steps.push(DiagnosticSopStep {
                step_id: "fbt_check_multi_driver_and_safe_mode",
                layer: "steamvr_openxr",
                title: "Avoid running multiple OpenVR FBT drivers simultaneously",
                instruction: "Inspect VUA Tools -> Pose & Tracking Topology to ensure two OpenVR FBT drivers (such as SlimeVR and mocopi) are not spawning duplicate waist/foot trackers at the same time.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "fbt_space_calibrator",
                layer: "companion_osc",
                title: "Verify OpenVR Space Calibrator reference device",
                instruction: "For mixed Lighthouse + standalone headsets, confirm OpenVR Space Calibrator continuous calibration targets the active HMD rather than a sleeping controller.",
            });
            steps.push(DiagnosticSopStep {
                step_id: "fbt_reset_ovras_offset_and_tpose",
                layer: "client_config_cache",
                title: "Zero playspace offsets before running VRChat FBT calibration",
                instruction: "Reset OVR Advanced Settings playspace offsets to 0.0 before entering VRChat FBT T-pose calibration — calibrating while playspace-shifted bakes a tilted hip/foot offset into IK.",
            });
        }
    }

    steps
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::FixedClock;
    use crate::win_registry::FakeRegistrySource;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(1);

    struct TestTempDir(PathBuf);

    impl TestTempDir {
        fn new() -> Self {
            let n = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "vua-local-diag-test-{}-{}",
                std::process::id(),
                n
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("create test tempdir");
            Self(dir)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct FakeProbe {
        running: Result<bool, ProcessProbeUnavailable>,
        udp9000: UdpPortObservation,
        udp9001: UdpPortObservation,
        osc_query: OscQueryLoopbackObservation,
    }

    impl LocalDiagnosticsProbe for FakeProbe {
        fn is_client_running(&self) -> Result<bool, ProcessProbeUnavailable> {
            self.running
        }
        fn probe_udp_port(&self, port: u16) -> UdpPortObservation {
            match port {
                9000 => self.udp9000.clone(),
                9001 => self.udp9001.clone(),
                _ => UdpPortObservation::unbound(),
            }
        }
        fn probe_oscquery_loopback(&self) -> OscQueryLoopbackObservation {
            self.osc_query.clone()
        }
    }

    fn test_roots(base: &Path) -> EnvironmentRoots {
        EnvironmentRoots {
            local_low: base.join("LocalLow"),
            steam_install_candidates: vec![base.join("Steam")],
            openvrpaths: vec![base.join("openvrpaths.vrpath")],
            pico_connect_settings_candidates: vec![base.join("PICO Connect").join("settings.json")],
            registry: Arc::new(FakeRegistrySource::new()),
            ..EnvironmentRoots::default()
        }
    }

    #[test]
    fn observes_privacy_safe_osc_steamvr_config_and_log_signatures() {
        let temp = TestTempDir::new();
        let roots = test_roots(temp.path());
        let vrc = roots.local_low.join("VRChat").join("VRChat");
        let osc_avatars = vrc.join("OSC").join("usr_secret_12345").join("Avatars");
        fs::create_dir_all(&osc_avatars).unwrap();
        fs::write(
            osc_avatars.join("avtr_secret_999.json"),
            b"{\"id\":\"avtr_secret_999\"}",
        )
        .unwrap();
        fs::create_dir_all(vrc.join("Cache-WindowsPlayer").join("sub")).unwrap();
        fs::write(
            vrc.join("Cache-WindowsPlayer")
                .join("sub")
                .join("bundle.dat"),
            vec![0u8; 4096],
        )
        .unwrap();
        fs::write(
            vrc.join("config.json"),
            r#"{"cache_size": 40, "cache_expiry_delay": 45, "fpv_steadycam_fov": 65.0}"#,
        )
        .unwrap();
        fs::write(
            vrc.join("output_log_2026-11-14_01-00-00.txt"),
            "Joining wrld_private_room\nEasyAntiCheat Launch Error: Untrusted system file C:\\Users\\Secret\\hook.dll\n",
        )
        .unwrap();

        let steam_cfg = temp.path().join("Steam").join("config");
        fs::create_dir_all(&steam_cfg).unwrap();
        fs::write(
            steam_cfg.join("steamvr.vrsettings"),
            r#"{
              "steamvr": { "renderTargetMultiplier": 1.8, "motionSmoothing": false, "enableSafeMode": true },
              "steam.app.438100": { "resolutionScale": 1.5 },
              "driver_01spacecalibrator": { "blocked_by_safe_mode": true },
              "driver_lighthouse": { "blocked_by_safe_mode": false }
            }"#,
        )
        .unwrap();

        let probe = Arc::new(FakeProbe {
            running: Ok(true),
            udp9000: UdpPortObservation::bound(
                4242,
                Some("C:\\Apps\\CustomOscRouter.exe".to_owned()),
            ),
            udp9001: UdpPortObservation::unbound(),
            osc_query: OscQueryLoopbackObservation::found(
                54321,
                Some(9005),
                Some("C:\\Games\\VRChat\\VRChat.exe".to_owned()),
            ),
        });
        let svc = LocalDiagnosticsService::new(
            roots,
            probe,
            Arc::new(FixedClock::new(&["2026-11-14T02:00:00.000Z"])),
        );

        let snap = svc.observe_local();
        let serialized = serde_json::to_string(&snap).unwrap();
        assert!(!serialized.contains("usr_secret_12345"));
        assert!(!serialized.contains("avtr_secret_999"));
        assert!(!serialized.contains("wrld_private_room"));
        assert!(!serialized.contains("C:\\Users\\Secret"));
        assert!(!serialized.contains("C:\\Apps\\"));

        assert_eq!(snap.osc.avatar_config_count, 1);
        assert_eq!(
            snap.osc.udp9000.owner_process.as_deref(),
            Some("customoscrouter.exe")
        );
        assert_eq!(snap.client_config.cache_size_gb, Some(40));
        assert_eq!(snap.client_cache.total_bytes, Some(4096));
        assert_eq!(
            snap.steamvr_settings.blocked_drivers,
            vec!["01spacecalibrator".to_owned()]
        );
        assert_eq!(
            snap.recent_client_log.classification,
            "eac_launch_violation"
        );

        let osc_diag = svc.diagnose_symptom(SymptomId::OscOrFaceTrackingNotResponding);
        assert_eq!(osc_diag.suggested_helper, "clear_osc_avatar_cache");
        assert!(osc_diag
            .findings
            .iter()
            .any(|f| f.code == "osc_port_9000_conflict"));
        assert!(osc_diag
            .findings
            .iter()
            .any(|f| f.code == "steamvr_driver_blocked_by_safe_mode"));

        for sym in [
            SymptomId::AudioSilentOrWrongMic,
            SymptomId::OscOrFaceTrackingNotResponding,
            SymptomId::LowFpsOrVramPressure,
            SymptomId::DiskCacheFull,
            SymptomId::CrashOrEacBlock,
            SymptomId::AvatarHiddenOrGreyRobot,
            SymptomId::CannotUploadAvatar,
        ] {
            let diag = svc.diagnose_symptom(sym);
            assert!(!diag.sop_steps.is_empty());
        }
    }

    #[test]
    fn offline_helpers_refuse_when_running_and_preserve_unknown_config_keys_when_stopped() {
        let temp = TestTempDir::new();
        let roots = test_roots(temp.path());
        let vrc = roots.local_low.join("VRChat").join("VRChat");
        let osc_avatars = vrc.join("OSC").join("usr_1").join("Avatars");
        fs::create_dir_all(&osc_avatars).unwrap();
        fs::write(osc_avatars.join("avtr_1.json"), b"12345").unwrap();
        fs::write(osc_avatars.join("keep.txt"), b"keep").unwrap();
        fs::write(
            vrc.join("config.json"),
            r#"{"custom_beta_flag": "preserve_me", "cache_size": 20}"#,
        )
        .unwrap();

        let running_svc = LocalDiagnosticsService::new(
            roots.clone(),
            Arc::new(FakeProbe {
                running: Ok(true),
                udp9000: UdpPortObservation::unbound(),
                udp9001: UdpPortObservation::unbound(),
                osc_query: OscQueryLoopbackObservation::not_detected(),
            }),
            Arc::new(FixedClock::new(&["2026-11-14T02:00:00.000Z"])),
        );
        assert_eq!(
            running_svc.clear_osc_avatar_cache("cmd-1"),
            Err(LocalDiagnosticsError::ClientRunning)
        );
        assert_eq!(
            running_svc.update_client_config(
                "cmd-2",
                ClientConfigUpdateInput {
                    cache_size_gb: Some(50),
                    cache_expiry_delay_days: None,
                }
            ),
            Err(LocalDiagnosticsError::ClientRunning)
        );
        assert!(osc_avatars.join("avtr_1.json").exists());

        let stopped_svc = LocalDiagnosticsService::new(
            roots,
            Arc::new(FakeProbe {
                running: Ok(false),
                udp9000: UdpPortObservation::unbound(),
                udp9001: UdpPortObservation::unbound(),
                osc_query: OscQueryLoopbackObservation::not_detected(),
            }),
            Arc::new(FixedClock::new(&["2026-11-14T02:05:00.000Z"])),
        );
        let clear_receipt = stopped_svc.clear_osc_avatar_cache("clear-1").unwrap();
        assert_eq!(clear_receipt.removed_file_count, 1);
        assert_eq!(clear_receipt.freed_bytes, 5);
        assert!(!osc_avatars.join("avtr_1.json").exists());
        assert!(osc_avatars.join("keep.txt").exists());
        // Idempotent replay with same command_id returns identical receipt.
        assert_eq!(
            stopped_svc.clear_osc_avatar_cache("clear-1").unwrap(),
            clear_receipt
        );

        let cfg_receipt = stopped_svc
            .update_client_config(
                "cfg-1",
                ClientConfigUpdateInput {
                    cache_size_gb: Some(60),
                    cache_expiry_delay_days: Some(90),
                },
            )
            .unwrap();
        assert!(cfg_receipt.backup_written);
        assert!(vrc.join("config.json.vua.bak").exists());
        let updated: Value =
            serde_json::from_str(&fs::read_to_string(vrc.join("config.json")).unwrap()).unwrap();
        assert_eq!(updated["custom_beta_flag"], "preserve_me");
        assert_eq!(updated["cache_size"], 60);
        assert_eq!(updated["cache_expiry_delay"], 90);
    }

    #[test]
    fn diagnoses_virtual_mic_hijack_streaming_bitrate_and_oscquery_mismatch_without_leaking_device_names(
    ) {
        let temp = TestTempDir::new();
        let mut roots = test_roots(temp.path());
        roots.registry = Arc::new(
            FakeRegistrySource::new()
                .with(
                    RegistryHive::CurrentUser,
                    SOUND_MAPPER_SUBKEY,
                    "Record",
                    "Headset Microphone (Oculus Virtual Audio Device - AlicePrivate)",
                )
                .with(
                    RegistryHive::CurrentUser,
                    SOUND_MAPPER_SUBKEY,
                    "ConsoleVoiceComRecord",
                    "Microphone (HyperX QuadCast - AlicePrivate)",
                )
                .with_u32(
                    RegistryHive::CurrentUser,
                    QUEST_LINK_SUBKEY,
                    "EncodeWidth",
                    4608,
                )
                .with_u32(
                    RegistryHive::CurrentUser,
                    QUEST_LINK_SUBKEY,
                    "BitrateMbps",
                    650,
                )
                .with_u32(RegistryHive::CurrentUser, QUEST_LINK_SUBKEY, "DBR", 0)
                .with_u32(
                    RegistryHive::CurrentUser,
                    QUEST_LINK_SUBKEY,
                    "LinkSharpening",
                    2,
                ),
        );
        let pico_dir = temp.path().join("PICO Connect");
        fs::create_dir_all(&pico_dir).unwrap();
        fs::write(
            pico_dir.join("settings.json"),
            r#"{"preset": "Ultra", "bitrateMbps": 180}"#,
        )
        .unwrap();

        let svc = LocalDiagnosticsService::new(
            roots,
            Arc::new(FakeProbe {
                running: Ok(true),
                udp9000: UdpPortObservation::bound(99, Some("VRChat.exe".to_owned())),
                udp9001: UdpPortObservation::unbound(),
                osc_query: OscQueryLoopbackObservation::found(
                    51234,
                    Some(9002),
                    Some("C:\\Games\\VRChat.exe".to_owned()),
                ),
            }),
            Arc::new(FixedClock::new(&["2026-11-14T03:00:00.000Z"])),
        );

        let snap = svc.observe_local();
        let raw_json = serde_json::to_string(&snap).unwrap();
        assert!(!raw_json.contains("AlicePrivate"));
        assert!(!raw_json.contains("HyperX"));
        assert_eq!(snap.audio_endpoints.default_capture_role, "vr_virtual");
        assert_eq!(snap.audio_endpoints.virtual_mic_hijack, "oculus_virtual");
        assert!(snap.audio_endpoints.communications_mismatch);
        assert_eq!(snap.streaming_settings.quest_link.presence, "found");
        assert_eq!(
            snap.streaming_settings.quest_link.encode_resolution_width,
            Some(4608)
        );
        assert_eq!(
            snap.streaming_settings.quest_link.encode_bitrate_mbps,
            Some(650)
        );
        assert_eq!(snap.streaming_settings.pico_connect.presence, "found");
        assert_eq!(
            snap.streaming_settings.pico_connect.preset.as_deref(),
            Some("Ultra")
        );
        assert_eq!(snap.streaming_settings.pico_connect.bitrate_mbps, Some(180));

        let audio_diag = svc.diagnose_symptom(SymptomId::AudioSilentOrWrongMic);
        assert!(audio_diag
            .findings
            .iter()
            .any(|f| f.code == "audio_virtual_mic_hijack_detected"));
        assert!(audio_diag
            .findings
            .iter()
            .any(|f| f.code == "audio_communications_default_mismatch"));
        assert_eq!(
            audio_diag.sop_steps[0].step_id,
            "audio_restore_hijacked_default_mic"
        );

        let osc_diag = svc.diagnose_symptom(SymptomId::OscOrFaceTrackingNotResponding);
        assert!(osc_diag
            .findings
            .iter()
            .any(|f| f.code == "oscquery_port_mismatch"));
        assert!(osc_diag
            .sop_steps
            .iter()
            .any(|s| s.step_id == "osc_align_oscquery_port"));

        let perf_diag = svc.diagnose_symptom(SymptomId::LowFpsOrVramPressure);
        assert!(perf_diag
            .findings
            .iter()
            .any(|f| f.code == "streaming_high_bitrate_or_encode_width"));
        assert!(perf_diag
            .sop_steps
            .iter()
            .any(|s| s.step_id == "perf_tune_streaming_bitrate_and_resolution"));

        assert_eq!(
            parse_oscquery_host_info(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"NAME\":\"VRChat-Client\",\"OSC_PORT\":9000,\"EXTENSIONS\":{\"ACCESS\":true}}"
            ),
            Some(Some(9000))
        );
        assert_eq!(
            parse_oscquery_host_info(b"HTTP/1.1 200 OK\r\n\r\n{\"unrelated\":1}"),
            None
        );
    }

    #[test]
    fn diagnoses_system_tuning_hags_power_plan_ovras_and_north_star_eval_symptoms() {
        let temp = TestTempDir::new();
        let mut roots = test_roots(temp.path());
        let ovras_dir = temp
            .path()
            .join("Steam")
            .join("steamapps")
            .join("common")
            .join("OVR_AdvancedSettings");
        fs::create_dir_all(&ovras_dir).unwrap();
        fs::write(ovras_dir.join("AdvancedSettings.exe"), b"MZ").unwrap();

        roots.registry = Arc::new(
            FakeRegistrySource::new()
                .with_u32(
                    RegistryHive::LocalMachine,
                    GRAPHICS_DRIVERS_SUBKEY,
                    "HwSchMode",
                    2,
                )
                .with(
                    RegistryHive::LocalMachine,
                    POWER_SCHEMES_SUBKEY,
                    "ActivePowerScheme",
                    "{a1841308-3541-4fab-bc81-f71556f20b4a}",
                )
                .with_u32(
                    RegistryHive::CurrentUser,
                    QUEST_LINK_SUBKEY,
                    "BitrateMbps",
                    60,
                )
                .with_u32(
                    RegistryHive::CurrentUser,
                    QUEST_LINK_SUBKEY,
                    "LinkSharpening",
                    0,
                ),
        );

        let svc = LocalDiagnosticsService::new(
            roots,
            Arc::new(FakeProbe {
                running: Ok(false),
                udp9000: UdpPortObservation::unbound(),
                udp9001: UdpPortObservation::unbound(),
                osc_query: OscQueryLoopbackObservation::not_detected(),
            }),
            Arc::new(FixedClock::new(&["2026-11-14T04:00:00.000Z"])),
        );

        let snap = svc.observe_local();
        let raw_json = serde_json::to_string(&snap).unwrap();
        // Raw Windows power-plan GUIDs must never leak across the wire.
        assert!(!raw_json.contains("a1841308-3541-4fab-bc81-f71556f20b4a"));
        assert_eq!(snap.system_tuning.hardware_gpu_scheduling, Some(true));
        assert_eq!(snap.system_tuning.power_plan_role, "power_saver");
        assert!(snap.system_tuning.ovr_advanced_settings_installed);

        let blurry = svc.diagnose_symptom(SymptomId::StreamingBlurryOrCompression);
        assert!(blurry
            .findings
            .iter()
            .any(|f| f.code == "streaming_low_bitrate_or_sharpening_off"));
        assert!(blurry
            .findings
            .iter()
            .any(|f| f.code == "windows_hags_enabled_vr_stutter_risk"));
        assert!(blurry
            .findings
            .iter()
            .any(|f| f.code == "windows_power_saver_active"));
        assert!(!blurry.sop_steps.is_empty());

        let playspace = svc.diagnose_symptom(SymptomId::PlayspaceDragOrHeightOffset);
        assert!(playspace
            .findings
            .iter()
            .any(|f| f.code == "ovr_advanced_settings_installed_offset_check"));
        assert!(!playspace.sop_steps.is_empty());

        let fbt = svc.diagnose_symptom(SymptomId::FbtDriftOrCalibration);
        assert!(fbt
            .findings
            .iter()
            .any(|f| f.code == "ovr_advanced_settings_installed_offset_check"));
        assert!(fbt
            .findings
            .iter()
            .any(|f| f.code == "windows_power_saver_active"));
        assert!(!fbt.sop_steps.is_empty());
    }

    #[test]
    fn update_client_config_enforces_vrchat_minimum_30_and_default_threshold_uses_30_gib() {
        let temp = TestTempDir::new();
        let roots = test_roots(temp.path());
        let svc = LocalDiagnosticsService::new(
            roots,
            Arc::new(FakeProbe {
                running: Ok(false),
                udp9000: UdpPortObservation::unbound(),
                udp9001: UdpPortObservation::unbound(),
                osc_query: OscQueryLoopbackObservation::not_detected(),
            }),
            Arc::new(FixedClock::new(&["2026-11-14T05:00:00.000Z"])),
        );

        assert_eq!(
            svc.update_client_config(
                "cfg-too-small-size",
                ClientConfigUpdateInput {
                    cache_size_gb: Some(10),
                    cache_expiry_delay_days: None,
                },
            ),
            Err(LocalDiagnosticsError::InvalidParams)
        );
        assert_eq!(
            svc.update_client_config(
                "cfg-too-small-days",
                ClientConfigUpdateInput {
                    cache_size_gb: None,
                    cache_expiry_delay_days: Some(7),
                },
            ),
            Err(LocalDiagnosticsError::InvalidParams)
        );
        let ok = svc
            .update_client_config(
                "cfg-min-valid",
                ClientConfigUpdateInput {
                    cache_size_gb: Some(30),
                    cache_expiry_delay_days: Some(30),
                },
            )
            .unwrap();
        assert_eq!(ok.cache_size_gb, Some(30));
        assert_eq!(ok.cache_expiry_delay_days, Some(30));

        let mut base_snap = svc.observe_local();
        base_snap.client_config.cache_size_gb = None;
        base_snap.client_cache.presence = "found";
        base_snap.client_cache.total_bytes = Some(18 * GIB);
        let findings_18 = collect_findings_for_symptom(SymptomId::DiskCacheFull, &base_snap);
        assert!(
            !findings_18
                .iter()
                .any(|f| f.code == "client_cache_near_limit"),
            "18 GiB must not trigger near-limit against VRChat's 30 GiB default"
        );

        base_snap.client_cache.total_bytes = Some(27 * GIB);
        let findings_27 = collect_findings_for_symptom(SymptomId::DiskCacheFull, &base_snap);
        assert!(findings_27
            .iter()
            .any(|f| f.code == "client_cache_near_limit"));
    }

    #[test]
    fn chunked_oscquery_host_info_handles_multibyte_japanese_split_and_invalid_bounds() {
        let full_json = "{\"NAME\":\"\u{3042}\u{3044}\",\"OSC_PORT\":9000}";
        let bytes = full_json.as_bytes();
        // Split right inside the 3-byte UTF-8 sequence of 'あ' (0xE3 0x81 | 0x82 ...).
        let a_pos = full_json.find('\u{3042}').unwrap();
        let split_at = a_pos + 2;
        let part1 = &bytes[..split_at];
        let part2 = &bytes[split_at..];

        let mut raw_http = Vec::new();
        raw_http.extend_from_slice(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n",
        );
        raw_http.extend_from_slice(format!("{:x}\r\n", part1.len()).as_bytes());
        raw_http.extend_from_slice(part1);
        raw_http.extend_from_slice(b"\r\n");
        raw_http.extend_from_slice(format!("{:x}\r\n", part2.len()).as_bytes());
        raw_http.extend_from_slice(part2);
        raw_http.extend_from_slice(b"\r\n0\r\n\r\n");

        assert_eq!(parse_oscquery_host_info(&raw_http), Some(Some(9000)));

        // Miscounted chunk length landing inside a multi-byte UTF-8 character in a valid UTF-8 buffer must return None without panicking.
        let malformed_mid_char = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
            split_at, full_json
        );
        assert_eq!(
            parse_oscquery_host_info(malformed_mid_char.as_bytes()),
            None
        );

        // Declared chunk length beyond buffer bounds returns None cleanly.
        let out_of_bounds =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nff\r\n{\"OSC_PORT\":9000}\r\n0\r\n\r\n";
        assert_eq!(parse_oscquery_host_info(out_of_bounds), None);
    }
}

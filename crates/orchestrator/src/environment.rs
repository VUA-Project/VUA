//! Read-only environment detection (E-ENV smoke, O4 `inspect_environment`).
//!
//! Every check is a targeted observation of a configured, well-known root —
//! never a scan, never a write (ORC-WF-001: Inspect is read-only by type and
//! by test). A machine without a component yields a deterministic
//! "not detected" result, never a bubbled-up error (ORC-ERR-005: every
//! failure names the next step).
//!
//! # 检测器契约（presence 模型）
//!
//! 检测器只汇报事实：`presence`（detected / not_detected /
//! detection_failed 三值）+ 裸 `facts`（路径、版本串、字节数、探测记录）+
//! 稳定 ID。引擎不做策略决策——"缺失算 warning 还是 error"、磁盘阈值、
//! 修复文案全部属于前端与修复计划的消费者侧。`detection_failed` 只在
//! **观测本身失败**（目录不可读、探测超时、平台不支持）时出现，并且必须
//! 携带稳定错误码；"没装"是正常结论不带码（验收：无 vrc-get 机器返回
//! 确定"未安装"而非错误）。
//!
//! # 中文逐项说明
//!
//! Play 辖区 —— `steam`（注册表 InstallPath → 默认路径，再解析
//! `libraryfolders.vdf` 枚举全部游戏库根，多盘安装不再误报）、
//! `vrchat` / `steamvr`（在发现的库根下定点观测；Steam 缺失时退回配置
//! 根）、`openxr_runtime`（Khronos 注册表 ActiveRuntime → 运行时 JSON 的
//! 名称：当前串流会走谁）、头显/串流运行时存在性检查（品牌面对齐
//! VRCFT 官方模块库的 PCVR 硬件面）：`oculus_runtime` / `pico_runtime` /
//! `vive_runtime` / `virtual_desktop` / `pimax_runtime` /
//! `varjo_runtime` / `hp_omnicept`（候选根存在性，候选根可注入）、
//! `alvr`（候选根 + openvrpaths 外部驱动注册双信号——ALVR 无固定安装
//! 目录，注册表驱动痕迹才是可靠观测）、`psvr2` / `bigscreen_beyond`
//! （两者都是 Steam 分发，走游戏库目录探测）。ALXR（绿色 zip 无固定
//! 痕迹）与 Steam Link（PC 侧即 Steam/SteamVR 本体）无诚实可探测信号，
//! 刻意不设检查项。`network`（对 `vrchat.com:443`
//! 做 TCP 探测，不发请求不登录）、`windows`（OS 版本注册表）、`gpu`
//! （显示适配器类注册表 DriverDesc）。
//!
//! Play 辖区另含 `disk_space`（同一次磁盘观测在两辖区各报告一条——分配
//! 2026-09-11 把 disk 列入 play 与 create 两清单；同一稳定 id，逐区条目）。
//!
//! Create 辖区 —— `unity_hub`（候选路径列表定点探测：用户级
//! `%LOCALAPPDATA%\Programs` 与机器级 `C:\Program Files` 双安装位，再以
//! HKCU/HKLM Uninstall 键 `DisplayIcon` 值兜底——任一命中即 Detected，
//! facts 记录命中路径与来源）、
//! `unity_editors`（枚举 Unity Hub 编辑器目录并按支持矩阵分类
//! production_target / migration_source / other_unity_version /
//! tuanjie_family，分类事实进 facts）、`vpm`（VPM 能力：VUA 内嵌
//! `vrc-get-vpm` 库（Cargo.lock 钉版）恒在＝Detected 恒真，版本照钉版
//! 如实呈现；独立 `vrc-get` CLI 经 ProcessRunner 跑 `--version`
//! 探测，命中与否只作附加信息事实，从非前置——用户裁决
//! 2026-09-20）、`vcc`（VCC settings.json 能力：存在性、格式、注册项目
//! 数——与包后端 vrc-get-vpm 同源）、`disk_space`（kernel32 的
//! `GetDiskFreeSpaceExW` 直接 FFI，只报字节数；阈值判断属于消费者）。
//!
//! 结构级要点：`EnvironmentRoots` 把所有探测路径与注册表访问做成可注入
//! ——测试全跑在合成目录树与合成注册表上，不依赖测试机的真实安装；只读
//! 性有测试证明（检测前后对观察目标做全树指纹比对，一个字节都不许变）。

use crate::editor_targets;
use crate::process::{ProcessRunner, ProcessSpec};
use crate::time::Clock;
use crate::win_registry::{RegistryHive, RegistrySource};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Stable environment error codes (ORC-ERR-001). These mark *detection*
/// failures, not environment findings.
pub mod error_codes {
    pub const READ_FAILED: &str = "vua.env.read_failed";
    pub const PROBE_FAILED: &str = "vua.env.probe_failed";
    pub const UNSUPPORTED_PLATFORM: &str = "vua.env.unsupported_platform";
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const NETWORK_TIMEOUT: Duration = Duration::from_secs(3);
const OUTPUT_LIMIT: usize = 64 * 1024;

// --- Installed-editor fact source (job.execute admission prechecks) ---

/// One installed Unity editor discovered under the Hub editors root
/// ([`installed_unity_editors`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledUnityEditor {
    pub parsed: editor_targets::ParsedEditorVersion,
    /// Editor directory path (the executable lives under `Editor/`).
    pub path: PathBuf,
}

/// The editors-root observation, mirroring the presence model: "not
/// installed" is a normal finding without a code; only a failed *observation*
/// (root unreadable) is an error. This is the fact source for the
/// `job.execute` admission prechecks (proposal 009 stance 4 ①②: the recipe
/// version-lock check and the environment compatibility check are
/// validation-class config errors consuming this source; the Bridge keeps
/// the fingerprint lock as the final line).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditorInstallObservation {
    /// Root missing, or no complete-version editor directories under it.
    NotDetected,
    /// The root exists but cannot be read — the observation itself failed.
    DetectionFailed { reason: String },
    /// Installed editors, sorted newest first (major/minor/patch/release).
    Detected(Vec<InstalledUnityEditor>),
}

/// Enumerates the Unity Hub editors under `unity_editors_root` — the same
/// observation the `unity_editors` environment check reports, as a strongly
/// typed fact source. Directories without a complete version name are
/// ignored (matching Hub's own directory behavior); an entry counts only
/// when it has an `Editor` subdirectory.
pub fn installed_unity_editors(unity_editors_root: &Path) -> EditorInstallObservation {
    let read_dir = match std::fs::read_dir(unity_editors_root) {
        Ok(read_dir) => read_dir,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return EditorInstallObservation::NotDetected;
        }
        Err(error) => {
            return EditorInstallObservation::DetectionFailed { reason: error.to_string() };
        }
    };
    let mut editors: Vec<InstalledUnityEditor> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("Editor").is_dir() {
            continue;
        }
        if let Some(parsed) =
            editor_targets::parse_editor_version(&entry.file_name().to_string_lossy())
        {
            editors.push(InstalledUnityEditor { parsed, path });
        }
    }
    if editors.is_empty() {
        return EditorInstallObservation::NotDetected;
    }
    editors.sort_by(|left, right| {
        let left = (
            left.parsed.major,
            left.parsed.minor,
            left.parsed.patch,
            left.parsed.release_number,
        );
        let right = (
            right.parsed.major,
            right.parsed.minor,
            right.parsed.patch,
            right.parsed.release_number,
        );
        right.cmp(&left)
    });
    EditorInstallObservation::Detected(editors)
}

const STEAM_REGISTRY_SUBKEY: &str = "SOFTWARE\\WOW6432Node\\Valve\\Steam";
const OPENXR_REGISTRY_SUBKEY: &str = "SOFTWARE\\Khronos\\OpenXR\\1";
const WINDOWS_CURRENT_VERSION_SUBKEY: &str = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
const GPU_CLASS_SUBKEY: &str =
    "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";

/// The `vrc-get-vpm` library version embedded in this binary — the
/// workspace `Cargo.lock` pin. The `vpm` check presents it verbatim; a
/// regression test asserts lockstep with `Cargo.lock`, so the fact cannot
/// drift from the real dependency.
pub const EMBEDDED_VRC_GET_VPM_VERSION: &str = "0.0.16";

/// Well-known Uninstall-registry subkey carrying the Unity Hub entry
/// (machine-wide installs: `HKLM\...\Uninstall\Unity Technologies - Hub`;
/// per-user installs mirror it under HKCU). Its `DisplayIcon` value names
/// the Hub executable even when the install directory is non-default.
const UNITY_HUB_UNINSTALL_SUBKEY: &str =
    "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Unity Technologies - Hub";
/// 32-bit-view variant of [`UNITY_HUB_UNINSTALL_SUBKEY`], probed as a
/// cheap extra candidate.
const UNITY_HUB_UNINSTALL_WOW64_SUBKEY: &str =
    "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Unity Technologies - Hub";

/// Parses an Uninstall-registry `DisplayIcon` value into an executable
/// path candidate. Handles the documented shapes — quoted
/// (`"C:\path\app.exe"`), plain, each with an optional `,<icon-index>`
/// suffix (`C:\Program Files\Unity Hub\Unity Hub.exe,0` → the exe path).
/// Existence of the file is the caller's check, so a malformed value
/// yields `None` rather than a fabricated path.
fn display_icon_executable(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    let unquoted = match trimmed.strip_prefix('"') {
        Some(rest) => match rest.split_once('"') {
            Some((path, _)) => path,
            None => rest,
        },
        None => trimmed,
    };
    let without_index = match unquoted.rfind(',') {
        Some(index) if unquoted[index + 1..].bytes().all(|byte| byte.is_ascii_digit()) => {
            &unquoted[..index]
        }
        _ => unquoted,
    };
    let candidate = PathBuf::from(without_index.trim());
    if candidate.as_os_str().is_empty() {
        None
    } else {
        Some(candidate)
    }
}

/// Short hive label used in probe-record facts (`HKCU` / `HKLM`).
fn registry_hive_label(hive: RegistryHive) -> &'static str {
    match hive {
        RegistryHive::CurrentUser => "HKCU",
        RegistryHive::LocalMachine => "HKLM",
    }
}

/// Deployer zones, mirroring the frontend navigation (v0.4.0 §2.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Zone {
    Play,
    Create,
}

/// What the detector observed: the thing, its absence, or a failed
/// observation. Severity ("is a missing SteamVR an error or a warning?")
/// is a consumer-side decision and deliberately not expressed here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EnvironmentPresence {
    Detected,
    NotDetected,
    DetectionFailed,
}

/// One check result: presence plus the raw facts consumers render or plan
/// from. `error_code` is set only when `presence` is `DetectionFailed`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentCheckItemV1 {
    pub schema_version: u8,
    /// Stable check id, e.g. `steam`, `unity_editors` (fix plans and the
    /// frontend severity table key on it). The wire name is the frozen
    /// application-contract v0.1 face: `checkId` (protocol §环境快照语义
    /// and the TS contract face agree). This struct was born pre-freeze
    /// with `id` and the BG-16 verbatim passthrough leaked that spelling
    /// to the wire; the serde rename restores conformance with the frozen
    /// contract (core authority ruling for BOARD #36 defect ③, 2026-09-18).
    #[serde(rename = "checkId")]
    pub id: String,
    pub zone: Zone,
    pub presence: EnvironmentPresence,
    /// Set only when the *observation itself* failed; a missing component
    /// is a normal finding without a code.
    pub error_code: Option<String>,
    /// Engineering view: paths, versions, byte counts, probe results.
    pub facts: Value,
}

/// Full read-only snapshot across both zones.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSnapshotV1 {
    pub schema_version: u8,
    pub items: Vec<EnvironmentCheckItemV1>,
    pub captured_at: String,
}

/// Stable spike codes; findings and fix plans key on them. These are the
/// Rust face of the frozen `environment-managers` schema v0.1 — the codes
/// appear inside the `vcc` check item facts and must stay stable; the
/// reading implementation lives in the project-manager adapter, which
/// depends on this core (proposal 004 split).
pub mod codes {
    pub const VCC_SETTINGS_READ_FAILED: &str = "vua.env_managers.vcc_settings_read_failed";
    pub const VCC_SETTINGS_SCHEMA_UNEXPECTED: &str = "vua.env_managers.vcc_settings_schema_unexpected";
    pub const MANAGER_SETTINGS_READ_FAILED: &str = "vua.env_managers.manager_settings_read_failed";
    pub const ALCOM_PROJECTS_NOT_RECOGNIZED: &str =
        "vua.env_managers.alcom_projects_not_recognized";
    pub const PROJECT_PATH_MISSING: &str = "vua.env_managers.project_path_missing";
    pub const PROJECT_MARKERS_INCOMPLETE: &str = "vua.env_managers.project_markers_incomplete";
    pub const PROJECT_VERSION_UNPARSEABLE: &str = "vua.env_managers.project_version_unparseable";
    pub const EDITOR_ENTRY_UNPARSEABLE: &str = "vua.env_managers.editor_entry_unparseable";
    pub const EDITOR_ROOT_READ_FAILED: &str = "vua.env_managers.editor_root_read_failed";
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagerPresence {
    Found,
    NotFound,
    ReadFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerDiagnostic {
    pub code: &'static str,
    pub severity: FindingSeverity,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VccCapability {
    pub presence: ManagerPresence,
    /// Which settings file answered (current LOCALAPPDATA location vs
    /// legacy Roaming location).
    pub settings_path: Option<String>,
    /// `userProjects` is the current explicit per-project list;
    /// `localProjectFolders` is the legacy folder-list form.
    pub projects_source: Option<&'static str>,
    pub user_projects: Vec<String>,
    pub local_project_folders: Vec<String>,
    pub error_code: Option<&'static str>,
}

/// Port: read VCC capability the way the package backend resolves it.
/// Implemented by the project-manager adapter (`VccSettingsFileReader`);
/// the engine owns the check item, the presence mapping and the fact
/// rendering. Candidates stay an engine-side injection point
/// (`EnvironmentRoots::vcc_settings_candidates`) so the resolution-order
/// invariant is single-sourced here and tests keep the synthetic-tree
/// pattern.
pub trait VccSettingsReader: Send + Sync {
    fn read_vcc_settings(
        &self,
        candidates: &[PathBuf],
        diagnostics: &mut Vec<ManagerDiagnostic>,
    ) -> VccCapability;
}

/// Candidate roots for headset runtime detection. Every list is ordered
/// and every path is a targeted observation, not a scan; exact locations
/// for vendors that ship no stable documented path stay injectable so a
/// real machine can confirm them without a code change.
///
/// Brand coverage follows VRCFT's official module list (PCVR side), with
/// documented install evidence:
/// - `virtual_desktop`: default install is `Program Files\Virtual Desktop
///   Streamer` (uninstaller manifest + multiple vendor runbooks);
///   `%LOCALAPPDATA%\VirtualDesktop` kept as a secondary trace.
/// - `pimax`: `Program Files\Pimax` covers both generations — Pimax Play's
///   `PimaxClient` and legacy PiTool's `Runtime` live under the same root.
/// - `varjo`: `Program Files\Varjo` per Varjo's official support docs;
///   `C:\Varjo` is a lower-confidence legacy/portable fallback.
/// - `hp_omnicept`: HP documents the SDK root (`Program Files\HP\HP
///   Omnicept SDK`); the Runtime root has no public record, so it stays a
///   first-class injectable candidate.
/// - ALVR ships as an unpack-anywhere zip with no fixed root: the
///   `alvr` list keeps a best-effort config trace, and the reliable signal
///   (vrpathreg external-driver registration) is checked separately via
///   `openvrpaths` — see `check_alvr`.
/// - ALXR (portable client zip, no installer/registry/OpenXR trace) and
///   Steam Link (PC side *is* Steam/SteamVR) have no honest PC-side
///   presence signal and are deliberately not checks.
/// - PSVR2 and Bigscreen Beyond ship as Steam apps and are observed in the
///   Steam library (`check_steam_library_component`), not here.
#[derive(Debug, Clone)]
pub struct VrRuntimeRoots {
    pub oculus: Vec<PathBuf>,
    pub pico: Vec<PathBuf>,
    pub vive: Vec<PathBuf>,
    pub virtual_desktop: Vec<PathBuf>,
    pub alvr: Vec<PathBuf>,
    pub pimax: Vec<PathBuf>,
    pub varjo: Vec<PathBuf>,
    pub hp_omnicept: Vec<PathBuf>,
}

impl Default for VrRuntimeRoots {
    fn default() -> Self {
        let local_app_data = std::env::var("LOCALAPPDATA")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        let program_files =
            std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_owned());
        Self {
            oculus: vec![
                PathBuf::from(&local_app_data).join("Oculus"),
                PathBuf::from(&program_files).join("Oculus"),
            ],
            pico: vec![
                PathBuf::from(&program_files).join("PICO Connect"),
                PathBuf::from(&local_app_data).join("Programs").join("PICO Connect"),
            ],
            vive: vec![PathBuf::from(&program_files).join("VIVE")],
            virtual_desktop: vec![
                PathBuf::from(&program_files).join("Virtual Desktop Streamer"),
                PathBuf::from(&local_app_data).join("VirtualDesktop"),
            ],
            alvr: vec![PathBuf::from(&local_app_data).join("alvr")],
            pimax: vec![PathBuf::from(&program_files).join("Pimax")],
            varjo: vec![PathBuf::from(&program_files).join("Varjo"), PathBuf::from("C:\\Varjo")],
            hp_omnicept: vec![
                PathBuf::from(&program_files)
                    .join("HP")
                    .join("HP Omnicept Runtime"),
                PathBuf::from(&program_files)
                    .join("HP")
                    .join("HP Omnicept SDK"),
            ],
        }
    }
}

/// Injectable well-known roots. Defaults target a standard Windows install;
/// tests substitute synthetic trees and a synthetic registry, so no test
/// depends on this machine.
#[derive(Debug, Clone)]
pub struct EnvironmentRoots {
    /// Fallback Steam library roots used only when Steam itself is not
    /// found; the `steam` check derives real roots from the install and
    /// its `libraryfolders.vdf`.
    pub steam_common: Vec<PathBuf>,
    /// `%USERPROFILE%\AppData\LocalLow` on Windows.
    pub local_low: PathBuf,
    /// Unity Hub executable candidates, probed in order: the per-user
    /// install location first, then machine-wide installs (W25 live
    /// finding: `%LOCALAPPDATA%\Programs` alone misses machine-level
    /// setups). Any hit means detected; the hit path is the fact.
    pub unity_hub_exe_candidates: Vec<PathBuf>,
    /// Uninstall-registry `(hive, subkey)` entries whose `DisplayIcon`
    /// value is parsed as additional Hub executable candidates.
    pub unity_hub_registry_display_icon_keys: Vec<(RegistryHive, String)>,
    /// Unity Hub's per-version editor folders.
    pub unity_editors_root: PathBuf,
    /// Fixed vrc-get identity probed through the process runner.
    pub vrc_get_executable: String,
    /// Drive whose free space is reported (VUA data root); consumers own
    /// the thresholds.
    pub disk_target: PathBuf,
    /// `host:port` TCP probes for plain reachability.
    pub network_probes: Vec<String>,
    /// Registry view (production: real registry; tests: synthetic).
    pub registry: Arc<dyn RegistrySource>,
    /// Steam install candidates probed when the registry has no answer.
    pub steam_install_candidates: Vec<PathBuf>,
    /// Headset runtime candidate roots.
    pub vr_runtime_roots: VrRuntimeRoots,
    /// OpenVR `openvrpaths.vrpath` candidates (external driver
    /// registrations — the documented trace for unpack-anywhere runtimes
    /// like ALVR).
    pub openvrpaths: Vec<PathBuf>,
    /// VCC settings candidates, same resolution order the package backend
    /// uses (LOCALAPPDATA first, legacy Roaming fallback).
    pub vcc_settings_candidates: Vec<PathBuf>,
}

impl Default for EnvironmentRoots {
    fn default() -> Self {
        let user_profile = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        let local_app_data = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| format!("{user_profile}\\AppData\\Local"));
        let roaming_app_data = std::env::var("APPDATA")
            .unwrap_or_else(|_| format!("{user_profile}\\AppData\\Roaming"));
        Self {
            steam_common: vec![PathBuf::from(
                "C:\\Program Files (x86)\\Steam\\steamapps\\common",
            )],
            local_low: PathBuf::from(format!("{user_profile}\\AppData\\LocalLow")),
            unity_hub_exe_candidates: vec![
                PathBuf::from(format!(
                    "{local_app_data}\\Programs\\Unity Hub\\Unity Hub.exe"
                )),
                PathBuf::from("C:\\Program Files\\Unity Hub\\Unity Hub.exe"),
            ],
            unity_hub_registry_display_icon_keys: vec![
                (RegistryHive::CurrentUser, UNITY_HUB_UNINSTALL_SUBKEY.to_owned()),
                (
                    RegistryHive::LocalMachine,
                    UNITY_HUB_UNINSTALL_SUBKEY.to_owned(),
                ),
                (
                    RegistryHive::LocalMachine,
                    UNITY_HUB_UNINSTALL_WOW64_SUBKEY.to_owned(),
                ),
            ],
            unity_editors_root: PathBuf::from("C:\\Program Files\\Unity\\Hub\\Editor"),
            vrc_get_executable: "vrc-get".to_owned(),
            disk_target: PathBuf::from(&user_profile),
            network_probes: vec!["vrchat.com:443".to_owned()],
            registry: Arc::new(crate::win_registry::WindowsRegistrySource),
            steam_install_candidates: vec![PathBuf::from(
                "C:\\Program Files (x86)\\Steam",
            )],
            vr_runtime_roots: VrRuntimeRoots::default(),
            openvrpaths: vec![PathBuf::from(&local_app_data)
                .join("openvr")
                .join("openvrpaths.vrpath")],
            vcc_settings_candidates: vec![
                PathBuf::from(&local_app_data)
                    .join("VRChatCreatorCompanion")
                    .join("settings.json"),
                PathBuf::from(&roaming_app_data)
                    .join("VRChatCreatorCompanion")
                    .join("settings.json"),
            ],
        }
    }
}

pub struct EnvironmentEngine {
    runner: Arc<dyn ProcessRunner>,
    clock: Arc<dyn Clock>,
    roots: EnvironmentRoots,
    vcc_reader: Arc<dyn VccSettingsReader>,
}

impl EnvironmentEngine {
    pub fn new(
        runner: Arc<dyn ProcessRunner>,
        clock: Arc<dyn Clock>,
        roots: EnvironmentRoots,
        vcc_reader: Arc<dyn VccSettingsReader>,
    ) -> Self {
        Self {
            runner,
            clock,
            roots,
            vcc_reader,
        }
    }

    /// Read-only snapshot of one zone.
    pub fn inspect_zone(&self, zone: Zone) -> Vec<EnvironmentCheckItemV1> {
        match zone {
            Zone::Play => vec![
                self.check_steam(),
                self.check_vrchat(),
                self.check_steamvr(),
                self.check_openxr_runtime(),
                self.check_brand_runtime("oculus_runtime", &self.roots.vr_runtime_roots.oculus),
                self.check_brand_runtime("pico_runtime", &self.roots.vr_runtime_roots.pico),
                self.check_brand_runtime("vive_runtime", &self.roots.vr_runtime_roots.vive),
                self.check_brand_runtime(
                    "virtual_desktop",
                    &self.roots.vr_runtime_roots.virtual_desktop,
                ),
                self.check_alvr(),
                self.check_steam_library_component("psvr2", "PlayStation VR2 App"),
                self.check_steam_library_component("bigscreen_beyond", "Bigscreen Beyond Driver"),
                self.check_brand_runtime("pimax_runtime", &self.roots.vr_runtime_roots.pimax),
                self.check_brand_runtime("varjo_runtime", &self.roots.vr_runtime_roots.varjo),
                self.check_brand_runtime("hp_omnicept", &self.roots.vr_runtime_roots.hp_omnicept),
                self.check_network(),
                self.check_windows(),
                self.check_gpu(),
                // Disk space serves both zones (assignment 2026-09-11 lists
                // "disk" under play AND create): one observation, reported
                // per zone — same stable id, per-zone entry.
                self.check_disk_space(Zone::Play),
            ],
            Zone::Create => vec![
                self.check_unity_hub(),
                self.check_unity_editors(),
                self.check_vpm(),
                self.check_vcc(),
                self.check_disk_space(Zone::Create),
            ],
        }
    }

    /// Read-only snapshot of everything (O4 use case).
    pub fn inspect_all(&self) -> EnvironmentSnapshotV1 {
        let mut items = self.inspect_zone(Zone::Play);
        items.extend(self.inspect_zone(Zone::Create));
        EnvironmentSnapshotV1 {
            schema_version: crate::ENVELOPE_SCHEMA_VERSION,
            items,
            captured_at: self.clock.now_rfc3339(),
        }
    }

    /// Narrow, read-only prerequisite discovery for deployment. Reuse known roots and Steam
    /// libraries without running unrelated package tools, network probes or hardware checks.
    /// The deployment adapter strengthens these presence hints before claiming readiness.
    pub fn inspect_deployment_components(&self) -> Vec<EnvironmentCheckItemV1> {
        vec![self.check_steam(), self.check_vrchat(), self.check_steamvr(),
            self.check_brand_runtime("pico_runtime", &self.roots.vr_runtime_roots.pico),
            self.check_unity_hub()]
    }

    // --- play zone: Steam chain ---

    /// Locates the Steam install (registry first, then candidate roots)
    /// and derives every library's `steamapps/common` from
    /// `libraryfolders.vdf`, so multi-drive installs are observed instead
    /// of assumed.
    pub fn discover_steam(&self) -> Option<(PathBuf, Vec<PathBuf>)> {
        let mut install: Option<PathBuf> = self
            .roots
            .registry
            .get_string(RegistryHive::LocalMachine, STEAM_REGISTRY_SUBKEY, "InstallPath")
            .map(PathBuf::from)
            .filter(|path| path.is_dir());
        if install.is_none() {
            install = self
                .roots
                .steam_install_candidates
                .iter()
                .find(|candidate| candidate.is_dir())
                .cloned();
        }
        let install = install?;
        let mut library_roots = vec![install.join("steamapps").join("common")];
        for library in parse_vdf_library_roots(&install.join("steamapps").join("libraryfolders.vdf"))
        {
            let common = library.join("steamapps").join("common");
            if !library_roots.contains(&common) {
                library_roots.push(common);
            }
        }
        Some((install, library_roots))
    }

    fn check_steam(&self) -> EnvironmentCheckItemV1 {
        match self.discover_steam() {
            Some((install, library_roots)) => item(
                "steam",
                Zone::Play,
                EnvironmentPresence::Detected,
                None,
                json!({
                    "path": install.to_string_lossy(),
                    "libraryRoots": library_roots
                        .iter()
                        .map(|root| root.to_string_lossy())
                        .collect::<Vec<_>>(),
                }),
            ),
            None => item(
                "steam",
                Zone::Play,
                EnvironmentPresence::NotDetected,
                None,
                json!({
                    "registryKey": format!("HKLM\\{STEAM_REGISTRY_SUBKEY}:InstallPath"),
                    "searchedCandidates": roots_display(&self.roots.steam_install_candidates),
                }),
            ),
        }
    }

    fn check_vrchat(&self) -> EnvironmentCheckItemV1 {
        let library_roots = self.effective_library_roots();
        for root in &library_roots {
            let exe = root.join("VRChat").join("VRChat.exe");
            if exe.is_file() {
                return item(
                    "vrchat",
                    Zone::Play,
                    EnvironmentPresence::Detected,
                    None,
                    json!({ "exe": exe.to_string_lossy() }),
                );
            }
        }
        item(
            "vrchat",
            Zone::Play,
            EnvironmentPresence::NotDetected,
            None,
            json!({ "searchedRoots": roots_display(&library_roots) }),
        )
    }

    fn check_steamvr(&self) -> EnvironmentCheckItemV1 {
        self.check_steam_library_component("steamvr", "SteamVR")
    }

    /// Presence of a Steam-library component (SteamVR itself, the PSVR2
    /// driver app, the Bigscreen Beyond driver): the install directory
    /// under each discovered library root.
    fn check_steam_library_component(&self, id: &str, dir_name: &str) -> EnvironmentCheckItemV1 {
        let library_roots = self.effective_library_roots();
        for root in &library_roots {
            let install = root.join(dir_name);
            if install.is_dir() {
                return item(
                    id,
                    Zone::Play,
                    EnvironmentPresence::Detected,
                    None,
                    json!({ "root": install.to_string_lossy() }),
                );
            }
        }
        item(
            id,
            Zone::Play,
            EnvironmentPresence::NotDetected,
            None,
            json!({ "searchedRoots": roots_display(&library_roots) }),
        )
    }

    /// Library roots for game checks: the discovered Steam libraries when
    /// Steam is present, the configured fallback roots otherwise.
    fn effective_library_roots(&self) -> Vec<PathBuf> {
        self.discover_steam()
            .map(|(_, roots)| roots)
            .unwrap_or_else(|| self.roots.steam_common.clone())
    }

    // --- play zone: VR runtimes ---

    /// The active OpenXR runtime: which vendor's bridge a PCVR session
    /// would actually use. Read from the Khronos registry key, then the
    /// referenced runtime JSON's display name.
    fn check_openxr_runtime(&self) -> EnvironmentCheckItemV1 {
        let active = self
            .roots
            .registry
            .get_string(RegistryHive::LocalMachine, OPENXR_REGISTRY_SUBKEY, "ActiveRuntime")
            .or_else(|| {
                self.roots
                    .registry
                    .get_string(RegistryHive::CurrentUser, OPENXR_REGISTRY_SUBKEY, "ActiveRuntime")
            });
        let Some(runtime_json) = active else {
            return item(
                "openxr_runtime",
                Zone::Play,
                EnvironmentPresence::NotDetected,
                None,
                json!({ "registryKeys": [
                    format!("HKLM\\{OPENXR_REGISTRY_SUBKEY}:ActiveRuntime"),
                    format!("HKCU\\{OPENXR_REGISTRY_SUBKEY}:ActiveRuntime"),
                ] }),
            );
        };
        let runtime_json_path = PathBuf::from(&runtime_json);
        let runtime_name = std::fs::read_to_string(&runtime_json_path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|value| {
                value
                    .pointer("/runtime/name")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
        match runtime_name {
            Some(name) => item(
                "openxr_runtime",
                Zone::Play,
                EnvironmentPresence::Detected,
                None,
                json!({ "activeRuntimePath": runtime_json, "runtimeName": name }),
            ),
            None => item(
                "openxr_runtime",
                Zone::Play,
                EnvironmentPresence::DetectionFailed,
                Some(error_codes::READ_FAILED.to_owned()),
                json!({ "activeRuntimePath": runtime_json }),
            ),
        }
    }

    /// Presence check for one headset runtime family: ordered candidate
    /// roots, first hit wins. A vendor without a stable documented path
    /// keeps its candidates injectable (see the environment spike
    /// findings' open questions).
    fn check_brand_runtime(&self, id: &str, candidates: &[PathBuf]) -> EnvironmentCheckItemV1 {
        for candidate in candidates {
            if candidate.exists() {
                return item(
                    id,
                    Zone::Play,
                    EnvironmentPresence::Detected,
                    None,
                    json!({
                        "root": candidate.to_string_lossy(),
                        "searchedCandidates": roots_display(candidates),
                    }),
                );
            }
        }
        item(
            id,
            Zone::Play,
            EnvironmentPresence::NotDetected,
            None,
            json!({ "searchedCandidates": roots_display(candidates) }),
        )
    }

    /// ALVR ships as an unpack-anywhere zip with no fixed install root:
    /// presence = a configured candidate root hit, OR the documented
    /// `vrpathreg adddriver` trace visible in OpenVR's `openvrpaths.vrpath`
    /// external driver list. An absent openvrpaths file is a normal
    /// "not detected" finding; a present-but-unreadable one is an
    /// observation failure.
    fn check_alvr(&self) -> EnvironmentCheckItemV1 {
        let candidates = &self.roots.vr_runtime_roots.alvr;
        for candidate in candidates {
            if candidate.exists() {
                return item(
                    "alvr",
                    Zone::Play,
                    EnvironmentPresence::Detected,
                    None,
                    json!({
                        "root": candidate.to_string_lossy(),
                        "searchedCandidates": roots_display(candidates),
                    }),
                );
            }
        }
        match self.openvr_external_driver_hit("alvr") {
            Ok(Some(driver)) => item(
                "alvr",
                Zone::Play,
                EnvironmentPresence::Detected,
                None,
                json!({ "registeredDriver": driver }),
            ),
            Ok(None) => item(
                "alvr",
                Zone::Play,
                EnvironmentPresence::NotDetected,
                None,
                json!({ "searchedCandidates": roots_display(candidates) }),
            ),
            Err(code) => item(
                "alvr",
                Zone::Play,
                EnvironmentPresence::DetectionFailed,
                Some(code),
                json!({ "searchedCandidates": roots_display(candidates) }),
            ),
        }
    }

    /// Reads the first configured OpenVR `openvrpaths.vrpath` and reports
    /// the external driver entry containing `needle` (case-insensitive).
    /// `Ok(None)` covers "file absent" and "no matching driver" — both
    /// normal findings; only a present-but-unobservable file is an error.
    fn openvr_external_driver_hit(&self, needle: &str) -> Result<Option<String>, String> {
        for path in &self.roots.openvrpaths {
            if !path.is_file() {
                continue;
            }
            let text =
                std::fs::read_to_string(path).map_err(|_| error_codes::READ_FAILED.to_owned())?;
            let value: Value = serde_json::from_str(&text)
                .map_err(|_| error_codes::READ_FAILED.to_owned())?;
            let hit = value
                .get("external_drivers")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .find(|entry| entry.to_lowercase().contains(needle))
                .map(str::to_owned);
            return Ok(hit);
        }
        Ok(None)
    }

    // --- play zone: machine identity ---

    fn check_network(&self) -> EnvironmentCheckItemV1 {
        let mut reachable: Vec<String> = Vec::new();
        let mut unreachable: Vec<String> = Vec::new();
        for probe in &self.roots.network_probes {
            if tcp_reachable(probe) {
                reachable.push(probe.clone());
            } else {
                unreachable.push(probe.clone());
            }
        }
        let presence = if reachable.is_empty() {
            EnvironmentPresence::NotDetected
        } else {
            EnvironmentPresence::Detected
        };
        item(
            "network",
            Zone::Play,
            presence,
            None,
            json!({ "reachable": reachable, "unreachable": unreachable }),
        )
    }

    /// Windows identity: product name, display version, build. Facts only;
    /// minimum-spec conclusions belong to consumers.
    fn check_windows(&self) -> EnvironmentCheckItemV1 {
        let product = self
            .roots
            .registry
            .get_string(RegistryHive::LocalMachine, WINDOWS_CURRENT_VERSION_SUBKEY, "ProductName");
        let display_version = self
            .roots
            .registry
            .get_string(RegistryHive::LocalMachine, WINDOWS_CURRENT_VERSION_SUBKEY, "DisplayVersion");
        let build = self
            .roots
            .registry
            .get_string(RegistryHive::LocalMachine, WINDOWS_CURRENT_VERSION_SUBKEY, "CurrentBuildNumber");
        if product.is_none() && display_version.is_none() && build.is_none() {
            return item(
                "windows",
                Zone::Play,
                EnvironmentPresence::NotDetected,
                None,
                json!({ "registryKey": format!("HKLM\\{WINDOWS_CURRENT_VERSION_SUBKEY}") }),
            );
        }
        item(
            "windows",
            Zone::Play,
            EnvironmentPresence::Detected,
            None,
            json!({
                "productName": product,
                "displayVersion": display_version,
                "build": build,
            }),
        )
    }

    /// Display adapters by class-guid `DriverDesc` across the first ten
    /// class slots — slot 0000/0001 are frequently virtual display drivers
    /// (IddCx, remote-desktop mirrors) while the physical GPU sits later.
    /// Facts only — performance conclusions belong to analysis.
    fn check_gpu(&self) -> EnvironmentCheckItemV1 {
        let gpu_slots: [&str; 10] =
            ["0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009"];
        let gpus: Vec<String> = gpu_slots
            .iter()
            .filter_map(|slot| {
                self.roots
                    .registry
                    .get_string(RegistryHive::LocalMachine, &format!("{GPU_CLASS_SUBKEY}\\{slot}"), "DriverDesc")
            })
            .collect();
        let presence = if gpus.is_empty() {
            EnvironmentPresence::NotDetected
        } else {
            EnvironmentPresence::Detected
        };
        item("gpu", Zone::Play, presence, None, json!({ "gpus": gpus }))
    }

    // --- create zone ---

    fn check_unity_hub(&self) -> EnvironmentCheckItemV1 {
        // 1. File candidates in order; the first existing executable wins.
        for exe in &self.roots.unity_hub_exe_candidates {
            if exe.is_file() {
                return item(
                    "unity_hub",
                    Zone::Create,
                    EnvironmentPresence::Detected,
                    None,
                    json!({ "exe": exe.to_string_lossy(), "via": "path" }),
                );
            }
        }
        // 2. Uninstall-registry DisplayIcon values as fallback candidates.
        let mut probed_keys = Vec::new();
        for (hive, subkey) in &self.roots.unity_hub_registry_display_icon_keys {
            let key_display = format!("{}\\{}", registry_hive_label(*hive), subkey);
            probed_keys.push(key_display.clone());
            let raw = match self.roots.registry.get_string(*hive, subkey, "DisplayIcon") {
                Some(raw) => raw,
                None => continue,
            };
            let exe = match display_icon_executable(&raw) {
                Some(exe) => exe,
                None => continue,
            };
            if exe.is_file() {
                return item(
                    "unity_hub",
                    Zone::Create,
                    EnvironmentPresence::Detected,
                    None,
                    json!({
                        "exe": exe.to_string_lossy(),
                        "via": "registry",
                        "registryKey": key_display,
                    }),
                );
            }
        }
        // 3. Nothing hit: record what was probed, deterministically.
        item(
            "unity_hub",
            Zone::Create,
            EnvironmentPresence::NotDetected,
            None,
            json!({
                "candidates": self
                    .roots
                    .unity_hub_exe_candidates
                    .iter()
                    .map(|path| path.to_string_lossy())
                    .collect::<Vec<_>>(),
                "registryKeys": probed_keys,
            }),
        )
    }

    fn check_unity_editors(&self) -> EnvironmentCheckItemV1 {
        let root_display = self.roots.unity_editors_root.to_string_lossy().into_owned();
        match installed_unity_editors(&self.roots.unity_editors_root) {
            EditorInstallObservation::NotDetected => item(
                "unity_editors",
                Zone::Create,
                EnvironmentPresence::NotDetected,
                None,
                json!({ "root": root_display }),
            ),
            EditorInstallObservation::DetectionFailed { reason } => item(
                "unity_editors",
                Zone::Create,
                EnvironmentPresence::DetectionFailed,
                Some(error_codes::READ_FAILED.to_owned()),
                json!({ "root": root_display, "reason": reason }),
            ),
            EditorInstallObservation::Detected(editors) => {
                let listed: Vec<Value> = editors
                    .iter()
                    .map(|editor| {
                        let (classification, guidance_code) =
                            editor_targets::classify_editor(&editor.parsed);
                        json!({
                            "version": editor.parsed.display,
                            "path": editor.path.to_string_lossy(),
                            "classification": classification,
                            "guidanceCode": guidance_code,
                        })
                    })
                    .collect();
                item(
                    "unity_editors",
                    Zone::Create,
                    EnvironmentPresence::Detected,
                    None,
                    json!({
                        "root": root_display,
                        "productionTarget": editor_targets::PRODUCTION_TARGET,
                        "editors": listed,
                    }),
                )
            }
        }
    }

    /// VPM capability. VUA embeds the `vrc-get-vpm` library (the
    /// Cargo.lock pin), so the capability is always present — detected
    /// unconditionally, with the pinned version presented verbatim. A
    /// standalone `vrc-get` CLI is probed and recorded informationally
    /// when found; its absence is a normal fact, never a downgrade — the
    /// CLI was never a prerequisite (user ruling 2026-09-20).
    fn check_vpm(&self) -> EnvironmentCheckItemV1 {
        let exe = &self.roots.vrc_get_executable;
        let spec = ProcessSpec {
            executable: PathBuf::from(exe),
            args: vec!["--version".to_owned()],
            working_dir: None,
            timeout: PROBE_TIMEOUT,
            output_limit: OUTPUT_LIMIT,
            ..Default::default()
        };
        let standalone_cli = match self.runner.run(&spec) {
            Ok(outcome) if outcome.success() => {
                let version = outcome
                    .stdout
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_owned();
                json!({
                    "state": "detected",
                    "exe": exe,
                    "version": version,
                })
            }
            Ok(outcome) if outcome.timed_out => json!({
                "state": "detection_failed",
                "exe": exe,
            }),
            // A missing binary or a failing probe is a normal missing
            // fact about the optional CLI, not a detection failure of
            // the capability itself.
            Ok(outcome) => json!({
                "state": "not_detected",
                "exe": exe,
                "exitCode": outcome.exit_code,
            }),
            Err(_) => json!({ "state": "not_detected", "exe": exe }),
        };
        item(
            "vpm",
            Zone::Create,
            EnvironmentPresence::Detected,
            None,
            json!({
                "embedded": {
                    "library": "vrc-get-vpm",
                    "version": EMBEDDED_VRC_GET_VPM_VERSION,
                },
                "standaloneCli": standalone_cli,
            }),
        )
    }

    /// VCC capability, read through the `VccSettingsReader` port
    /// (project-manager adapter) with the engine's configured candidate
    /// roots. Counts only: project paths stay in the spike snapshot, not
    /// in the deployer card facts.
    fn check_vcc(&self) -> EnvironmentCheckItemV1 {
        let mut diagnostics = Vec::new();
        let capability = self
            .vcc_reader
            .read_vcc_settings(&self.roots.vcc_settings_candidates, &mut diagnostics);
        let presence = match capability.presence {
            ManagerPresence::Found => EnvironmentPresence::Detected,
            ManagerPresence::NotFound => EnvironmentPresence::NotDetected,
            ManagerPresence::ReadFailed => {
                EnvironmentPresence::DetectionFailed
            }
        };
        let error_code = capability.error_code.map(str::to_owned);
        let diagnostic_details: Vec<Value> = diagnostics
            .iter()
            .map(|diagnostic| {
                json!({ "code": diagnostic.code, "severity": diagnostic.severity, "detail": diagnostic.detail })
            })
            .collect();
        item(
            "vcc",
            Zone::Create,
            presence,
            error_code,
            json!({
                "settingsPath": capability.settings_path,
                "projectsSource": capability.projects_source,
                "registeredProjects": capability.user_projects.len(),
                "registeredFolders": capability.local_project_folders.len(),
                "diagnostics": diagnostic_details,
            }),
        )
    }

    fn check_disk_space(&self, zone: Zone) -> EnvironmentCheckItemV1 {
        let target = self.roots.disk_target.to_string_lossy().into_owned();
        match free_disk_bytes(&self.roots.disk_target) {
            Ok((free, total)) => item(
                "disk_space",
                zone,
                EnvironmentPresence::Detected,
                None,
                json!({
                    "target": target,
                    "freeBytes": free,
                    "totalBytes": total,
                }),
            ),
            Err(code) => item(
                "disk_space",
                zone,
                EnvironmentPresence::DetectionFailed,
                Some(code.unwrap_or_else(|| error_codes::UNSUPPORTED_PLATFORM.to_owned())),
                json!({ "target": target }),
            ),
        }
    }
}

// --- helpers ---

#[allow(clippy::too_many_arguments)]
fn item(
    id: &str,
    zone: Zone,
    presence: EnvironmentPresence,
    error_code: Option<String>,
    facts: Value,
) -> EnvironmentCheckItemV1 {
    EnvironmentCheckItemV1 {
        schema_version: crate::ENVELOPE_SCHEMA_VERSION,
        id: id.to_owned(),
        zone,
        presence,
        error_code,
        facts,
    }
}

fn roots_display(roots: &[PathBuf]) -> Vec<String> {
    roots
        .iter()
        .map(|root| root.to_string_lossy().into_owned())
        .collect()
}

/// Extracts library install paths from Steam's `libraryfolders.vdf` —
/// the `"path"` entries, with VDF's escaped backslashes unescaped. An
/// unreadable or unexpected file yields no extra roots (the Steam install
/// root itself remains a library).
fn parse_vdf_library_roots(vdf_path: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(vdf_path) else {
        return Vec::new();
    };
    let mut roots = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix("\"path\"") else {
            continue;
        };
        let value = rest.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|rest| rest.strip_suffix('"'))
            .unwrap_or(value);
        if value.is_empty() {
            continue;
        }
        roots.push(PathBuf::from(value.replace("\\\\", "\\")));
    }
    roots
}

fn tcp_reachable(probe: &str) -> bool {
    let Ok(addrs) = probe.to_socket_addrs() else {
        return false;
    };
    for address in addrs {
        if TcpStream::connect_timeout(&address, NETWORK_TIMEOUT).is_ok() {
            return true;
        }
    }
    false
}

/// `(free_bytes, total_bytes)` for the drive holding `path`. Windows uses the
/// kernel32 `GetDiskFreeSpaceExW` export directly — one well-understood call
/// instead of a new dependency (ORC-DEV-005).
#[cfg(windows)]
fn free_disk_bytes(path: &Path) -> Result<(u64, u64), Option<String>> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            lpDirectoryName: *const u16,
            lpFreeBytesAvailableToCaller: *mut u64,
            lpTotalNumberOfBytes: *mut u64,
            lpTotalNumberOfFreeBytes: *mut u64,
        ) -> i32;
    }

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free: u64 = 0;
    let mut total: u64 = 0;
    let mut reserved: u64 = 0;
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut reserved) };
    if ok == 0 {
        return Err(Some(error_codes::READ_FAILED.to_owned()));
    }
    Ok((free, total))
}

#[cfg(not(windows))]
fn free_disk_bytes(_path: &Path) -> Result<(u64, u64), Option<String>> {
    Err(Some(error_codes::UNSUPPORTED_PLATFORM.to_owned()))
}

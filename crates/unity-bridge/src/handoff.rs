//! Release-handoff editor-lifecycle port (process/window face, proposal 023).
//!
//! 语态事实（产线表态，023 内联节，已经第 52/53 波入库）：`release.
//! openForHandoff` 的执行面是编辑器进程生命周期管理——目标工程未打开时
//! 由外部 `Unity.exe -projectPath <path>` 启动（此刻编辑器内尚无 VUA 代
//! 码，Bridge 命令面无从执行），已打开时「聚焦」是 OS 窗口面操作。因此
//! 本模块全部逻辑都在编辑器进程之外运行，**unity-bridge v3 命令词表零增
//! 操作**（演进条款不触发）。
//!
//! 完成判定语义（统一 task 九态、handshake 到达＝完成、超时如实失败、
//! 聚焦不进契约事实）归核心 use case 切片编排；本模块只提供机制原语与
//! 机制事实：
//!
//! - [`EditorHandoffPort::probe`]：工程是否已在编辑器中打开——权威信号
//!   是 com.ph-r.vua 桥包在工程加载完成时写入的握手踪迹
//!   （`.vua/bridge/handshake.json`，schema `schemas/unity-bridge/handshake/
//!   v1/`）加 pid 活性；踪迹缺失、损坏、版本不认识或进程已死都如实视作
//!   「未打开」（启动路径安全：Unity 自身的重复打开保护兜底）。
//! - [`EditorHandoffPort::launch`]：分离式启动编辑器（不等待退出——编辑
//!   器常驻；凭据剥离基线与 batchmode 链同一来源）。
//! - [`EditorHandoffPort::await_handshake`]：轮询等待握手到达并校验；
//!   「进程已启动」绝不作为完成事实（诚实纪律 2/3——超时如实报
//!   [`HandoffError::HandshakeTimeout`]，不猜面板状态）。
//! - [`EditorHandoffPort::focus`]：尽力而为的 OS 窗口聚焦，结果独立返回
//!   （[`FocusOutcome`]），绝不传染完成判定、绝不进入交接事实。

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use vua_orchestrator::strip_sensitive_env;

/// Handshake payload schema version (`schemas/unity-bridge/handshake/v1.0/`).
/// The bridge package writes the same constant (`EditorHandshake`).
pub const HANDSHAKE_SCHEMA_VERSION: &str = "1.0";

/// Default wait budget for the handshake: Unity 2022.3 cold start plus asset
/// import is a minutes-scale long operation (proposal 023 production stance);
/// fifteen minutes is the conservative honest ceiling. Exceeding it lands as
/// [`HandoffError::HandshakeTimeout`] — the core use case maps that to the
/// task nine-state failure/inspect semantics, never to a guessed success.
pub const DEFAULT_HANDSHAKE_BUDGET: Duration = Duration::from_secs(900);

/// Poll cadence while waiting for the editor handshake file.
pub const HANDSHAKE_POLL_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub enum HandoffError {
    Io(std::io::Error),
    LaunchFailed {
        exe: PathBuf,
        source: std::io::Error,
    },
    HandshakeTimeout {
        budget: Duration,
    },
}

impl std::fmt::Display for HandoffError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "handoff io error: {error}"),
            Self::LaunchFailed { exe, source } => {
                write!(formatter, "editor launch failed for {}: {source}", exe.display())
            }
            Self::HandshakeTimeout { budget } => write!(
                formatter,
                "editor handshake did not arrive within {budget:?}; process state is unknown and never guessed"
            ),
        }
    }
}

impl std::error::Error for HandoffError {}

/// The handshake trail written by the bridge package on project load.
/// Field names follow `schemas/unity-bridge/handshake/v1.0/` (camelCase on the
/// wire); the file location (`<project>/.vua/bridge/handshake.json`) binds
/// the trail to the project, so no path or project-identity field is carried.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorHandshake {
    pub schema_version: String,
    pub pid: u32,
    pub editor_version: String,
    pub occurred_at: String,
}

/// Mechanism fact returned by [`EditorHandoffPort::probe`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditorOpenState {
    /// No valid, live handshake trail exists for this project.
    Closed,
    /// The bridge handshake trail exists and its process is still alive.
    Open(EditorHandshake),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditorLaunched {
    pub pid: u32,
}

/// Best-effort window focus result. Focus is a convenience side action:
/// per the proposal 023 stance it never enters the completion verdict and
/// never enters handoff receipt facts (window focus is not a stable fact).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FocusOutcome {
    Focused,
    Unavailable { reason: &'static str },
}

/// Spawns a detached editor process. Implementations MUST NOT wait for
/// exit: the editor is a long-lived user-facing process.
pub trait EditorSpawner: Send + Sync {
    fn spawn(&self, executable: &Path, args: &[String]) -> std::io::Result<u32>;
}

/// Budget clock plus sleep for the handshake wait loop, abstracted so tests
/// can advance time deterministically without real sleeping.
pub trait HandoffWait: Send + Sync {
    /// Monotonic-ish millisecond reading for budget accounting only.
    fn now_millis(&self) -> u64;
    fn sleep(&self, duration: Duration);
}

/// OS-level liveness probe for a process id.
pub trait ProcessLiveness: Send + Sync {
    fn is_alive(&self, pid: u32) -> bool;
}

/// Best-effort OS window focus for a process id.
pub trait WindowFocus: Send + Sync {
    fn focus(&self, pid: u32) -> FocusOutcome;
}

/// Production-domain port for the `release.openForHandoff` implementation
/// domain. Mechanism primitives only; task orchestration stays in the core
/// use case (dependency direction: core use case -> domain port -> adapter).
pub trait EditorHandoffPort: Send + Sync {
    fn probe(&self, project_root: &Path) -> Result<EditorOpenState, HandoffError>;
    fn launch(
        &self,
        editor_exe: &Path,
        project_root: &Path,
    ) -> Result<EditorLaunched, HandoffError>;
    fn await_handshake(
        &self,
        project_root: &Path,
        budget: Duration,
    ) -> Result<EditorHandshake, HandoffError>;
    fn focus(&self, pid: u32) -> FocusOutcome;
}

/// Handshake file location: `.vua/bridge/handshake.json` under the project
/// root — the same bridge directory family as the batchmode request/result
/// files, and the location itself binds the trail to this project.
pub fn handshake_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".vua")
        .join("bridge")
        .join("handshake.json")
}

pub struct DefaultEditorHandoff {
    spawner: Arc<dyn EditorSpawner>,
    wait: Arc<dyn HandoffWait>,
    liveness: Arc<dyn ProcessLiveness>,
    focus: Arc<dyn WindowFocus>,
}

impl DefaultEditorHandoff {
    pub fn new() -> Self {
        Self {
            spawner: Arc::new(DetachedEditorSpawner),
            wait: Arc::new(SystemWait),
            liveness: Arc::new(DefaultProcessLiveness),
            focus: Arc::new(OsWindowFocus),
        }
    }

    pub fn with_parts(
        spawner: Arc<dyn EditorSpawner>,
        wait: Arc<dyn HandoffWait>,
        liveness: Arc<dyn ProcessLiveness>,
        focus: Arc<dyn WindowFocus>,
    ) -> Self {
        Self {
            spawner,
            wait,
            liveness,
            focus,
        }
    }

    /// Reads and validates the handshake trail. Missing file, malformed
    /// payload, unknown schema version or a dead pid are all reported as
    /// "no valid trail" (`None`) — the launch path is safe to take in all
    /// those cases, and the honest absence beats a guessed state.
    fn read_valid_trail(
        &self,
        project_root: &Path,
    ) -> Result<Option<EditorHandshake>, HandoffError> {
        let bytes = match std::fs::read(handshake_path(project_root)) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(HandoffError::Io(error)),
        };
        let handshake: EditorHandshake = match serde_json::from_slice(&bytes) {
            Ok(handshake) => handshake,
            Err(_) => return Ok(None),
        };
        if handshake.schema_version != HANDSHAKE_SCHEMA_VERSION {
            return Ok(None);
        }
        if !self.liveness.is_alive(handshake.pid) {
            return Ok(None);
        }
        Ok(Some(handshake))
    }
}

impl Default for DefaultEditorHandoff {
    fn default() -> Self {
        Self::new()
    }
}

impl EditorHandoffPort for DefaultEditorHandoff {
    fn probe(&self, project_root: &Path) -> Result<EditorOpenState, HandoffError> {
        Ok(match self.read_valid_trail(project_root)? {
            Some(handshake) => EditorOpenState::Open(handshake),
            None => EditorOpenState::Closed,
        })
    }

    fn launch(
        &self,
        editor_exe: &Path,
        project_root: &Path,
    ) -> Result<EditorLaunched, HandoffError> {
        // Windowed launch (no -batchmode/-quit): the handoff delivers the
        // user to the official SDK flow inside a real editor session.
        let args = vec![
            "-projectPath".to_string(),
            project_root.to_string_lossy().into_owned(),
        ];
        let pid =
            self.spawner
                .spawn(editor_exe, &args)
                .map_err(|source| HandoffError::LaunchFailed {
                    exe: editor_exe.to_path_buf(),
                    source,
                })?;
        Ok(EditorLaunched { pid })
    }

    fn await_handshake(
        &self,
        project_root: &Path,
        budget: Duration,
    ) -> Result<EditorHandshake, HandoffError> {
        let start = self.wait.now_millis();
        let budget_millis = budget.as_millis() as u64;
        loop {
            if let Some(handshake) = self.read_valid_trail(project_root)? {
                return Ok(handshake);
            }
            if self.wait.now_millis().saturating_sub(start) >= budget_millis {
                return Err(HandoffError::HandshakeTimeout { budget });
            }
            self.wait.sleep(HANDSHAKE_POLL_INTERVAL);
        }
    }

    fn focus(&self, pid: u32) -> FocusOutcome {
        self.focus.focus(pid)
    }
}

/// Spawns the editor detached and returns its process id. Credential-bearing
/// environment variables are stripped with the same baseline as the batchmode
/// bridge chain (R2-2: Unity child processes never inherit credentials).
pub struct DetachedEditorSpawner;

impl EditorSpawner for DetachedEditorSpawner {
    fn spawn(&self, executable: &Path, args: &[String]) -> std::io::Result<u32> {
        use std::process::{Command, Stdio};
        let build = |_breakaway: bool| {
            let mut command = Command::new(executable);
            command
                .args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            strip_sensitive_env(&mut command);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                use windows_sys::Win32::System::Threading::{
                    CREATE_BREAKAWAY_FROM_JOB, CREATE_NEW_PROCESS_GROUP,
                };
                let flags = if _breakaway {
                    CREATE_BREAKAWAY_FROM_JOB | CREATE_NEW_PROCESS_GROUP
                } else {
                    CREATE_NEW_PROCESS_GROUP
                };
                command.creation_flags(flags);
            }
            command
        };
        // Break away from the provider job on Windows so closing VUA never kills an
        // interactive Unity SDK upload session; fall back if an outer OS job denies breakaway.
        let child = match build(true).spawn() {
            Ok(child) => child,
            Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
                build(false).spawn()?
            }
            Err(err) => return Err(err),
        };
        Ok(child.id())
    }
}

#[derive(Debug, Default)]
pub struct SystemWait;

impl HandoffWait for SystemWait {
    fn now_millis(&self) -> u64 {
        static MONOTONIC_ORIGIN: std::sync::OnceLock<std::time::Instant> =
            std::sync::OnceLock::new();
        MONOTONIC_ORIGIN
            .get_or_init(std::time::Instant::now)
            .elapsed()
            .as_millis() as u64
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

pub struct DefaultProcessLiveness;

#[cfg(windows)]
impl ProcessLiveness for DefaultProcessLiveness {
    fn is_alive(&self, pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut exit_code: u32 = 0;
            let queried = GetExitCodeProcess(handle, &mut exit_code);
            CloseHandle(handle);
            queried != 0 && exit_code == STILL_ACTIVE as u32
        }
    }
}

#[cfg(not(windows))]
impl ProcessLiveness for DefaultProcessLiveness {
    fn is_alive(&self, _pid: u32) -> bool {
        // Non-Windows hosts are the development/CI face; without an OS probe
        // the trail is reported as not-live, which honestly routes to the
        // launch path (Unity's own duplicate-open guard keeps that safe).
        false
    }
}

pub struct OsWindowFocus;

#[cfg(windows)]
impl WindowFocus for OsWindowFocus {
    fn focus(&self, pid: u32) -> FocusOutcome {
        use windows_sys::core::BOOL;
        use windows_sys::Win32::Foundation::{HWND, LPARAM};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
            ShowWindow, SW_RESTORE,
        };

        struct Context {
            pid: u32,
            window: Option<HWND>,
        }

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let context = unsafe { &mut *(lparam as *mut Context) };
            let mut window_pid: u32 = 0;
            unsafe { GetWindowThreadProcessId(hwnd, &mut window_pid) };
            if window_pid == context.pid && unsafe { IsWindowVisible(hwnd) } != 0 {
                context.window = Some(hwnd);
                return 0;
            }
            1
        }

        let mut context = Context { pid, window: None };
        unsafe {
            EnumWindows(Some(enum_proc), &mut context as *mut Context as LPARAM);
        }
        let Some(window) = context.window else {
            return FocusOutcome::Unavailable {
                reason: "editor_window_not_found",
            };
        };
        unsafe {
            if IsIconic(window) != 0 {
                ShowWindow(window, SW_RESTORE);
            }
            if SetForegroundWindow(window) == 0 {
                return FocusOutcome::Unavailable {
                    reason: "os_denied_foreground",
                };
            }
        }
        FocusOutcome::Focused
    }
}

#[cfg(not(windows))]
impl WindowFocus for OsWindowFocus {
    fn focus(&self, _pid: u32) -> FocusOutcome {
        FocusOutcome::Unavailable {
            reason: "os_window_focus_unavailable_on_this_platform",
        }
    }
}

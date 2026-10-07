//! Read-only VRChat game-window observation: the fact source for the
//! desktop guide-window follow loop that pins a small guide window to the
//! VRChat game window.
//!
//! Discipline: ordinary Win32 window APIs only — process enumeration
//! (Toolhelp32), top-level window enumeration (EnumWindows), window state
//! getters (IsWindowVisible/IsIconic/GetWindowRect/GetWindowLongPtrW), and
//! the foreground owner (GetForegroundWindow). There is NO client
//! injection, NO game-memory read, NO settings edit, and never a write to
//! the game, its windows, or any other window: every API this module
//! touches enumerates or reads state.
//!
//! Observation is injectable ([`GameWindowSource`]) so every unit test runs
//! on synthetic fixtures; the OS-backed source lives in [`os_source`] and
//! is exercised only by the ignored manual test. Shapes are pinned by
//! `schemas/game-window-observe/v0.1/observation.schema.json`.

use serde::Serialize;

use vua_orchestrator::Clock;

pub const GAME_WINDOW_OBSERVE_SCHEMA_VERSION: &str = "vua.game-window-observe/v0.1";

/// The three-state observation face. `Absent`: no vrchat.exe process.
/// `Waiting`: a vrchat.exe process exists but no usable visible top-level
/// window (startup, loading, or only tool/zero-area windows). `Ready`:
/// exactly one selected window fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GameWindowState {
    Absent,
    Waiting,
    Ready,
}

/// A window rectangle in physical screen pixels (the provider opts into
/// per-monitor DPI awareness v2 before the first enumeration so
/// GetWindowRect is not virtualized).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RectPhysical {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

/// The selected window fact (state `ready` only). `session_id` is
/// `"{pid}:{hwnd}"` in decimal — it changes when the game relaunches or
/// its window is recreated. `foreground` means the current foreground
/// window belongs to ANY vrchat.exe pid (game context active, not
/// necessarily the selected window itself); `minimized` is IsIconic of the
/// selected window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameWindowFacts {
    pub session_id: String,
    pub rect_physical: RectPhysical,
    pub minimized: bool,
    pub foreground: bool,
}

/// Versioned observation pinned by
/// `schemas/game-window-observe/v0.1/observation.schema.json`. `state` and
/// `window` are consistent by construction: `ready` carries exactly one
/// window fact, `absent`/`waiting` carry none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameWindowObservationV01 {
    pub schema_version: &'static str,
    pub captured_at: String,
    pub state: GameWindowState,
    pub window: Option<GameWindowFacts>,
}

/// One top-level window as the OS enumeration reports it. `hwnd` is the
/// raw window handle value as an unsigned integer (decimal inside the
/// session id); `tool` is the WS_EX_TOOLWINDOW extended style bit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TopLevelWindowFact {
    pub hwnd: u64,
    pub pid: u32,
    pub visible: bool,
    pub iconic: bool,
    pub tool: bool,
    pub rect: RectPhysical,
}

/// The injectable observation source. Implementations MUST be read-only:
/// enumerate processes and windows and read their state — never write to,
/// focus, move, resize, or inject into a window or a process.
pub trait GameWindowSource {
    /// Pids of every running vrchat.exe process (image-name match).
    fn vrchat_pids(&self) -> std::io::Result<Vec<u32>>;
    /// Every top-level window with its owning pid, visible or not.
    fn top_level_windows(&self) -> std::io::Result<Vec<TopLevelWindowFact>>;
    /// The pid owning the current foreground window, if any.
    fn foreground_pid(&self) -> Option<u32>;
}

/// Assembles the read-only observation from one source pass. Deterministic
/// for a given source answer: among the usable windows (owned by a
/// vrchat.exe pid, visible, not a tool window, positive area) the largest
/// area wins, with the lowest hwnd breaking ties.
pub fn observe_game_window(
    source: &dyn GameWindowSource,
    clock: &dyn Clock,
) -> std::io::Result<GameWindowObservationV01> {
    let pids = source.vrchat_pids()?;
    let observation = |state, window| GameWindowObservationV01 {
        schema_version: GAME_WINDOW_OBSERVE_SCHEMA_VERSION,
        captured_at: clock.now_rfc3339(),
        state,
        window,
    };
    if pids.is_empty() {
        return Ok(observation(GameWindowState::Absent, None));
    }
    let windows = source.top_level_windows()?;
    let usable = |window: &&TopLevelWindowFact| {
        pids.contains(&window.pid)
            && window.visible
            && !window.tool
            && window.rect.width > 0
            && window.rect.height > 0
    };
    let Some(selected) = windows.iter().filter(usable).max_by_key(|window| {
        (
            window.rect.width as i64 * window.rect.height as i64,
            std::cmp::Reverse(window.hwnd),
        )
    }) else {
        return Ok(observation(GameWindowState::Waiting, None));
    };
    let foreground = source
        .foreground_pid()
        .is_some_and(|pid| pids.contains(&pid));
    Ok(observation(
        GameWindowState::Ready,
        Some(GameWindowFacts {
            session_id: format!("{}:{}", selected.pid, selected.hwnd),
            rect_physical: selected.rect,
            minimized: selected.iconic,
            foreground,
        }),
    ))
}

// --- OS-backed source (Windows; exercised by the ignored manual test) ---

pub mod os_source {
    //! The real OS view: Toolhelp32 for the vrchat.exe process list (the
    //! EAC probe's snapshot source, filtered to the game image name),
    //! EnumWindows plus window state getters for the top-level windows, and
    //! GetForegroundWindow for the foreground owner. Read-only: every call
    //! enumerates or reads state; nothing focuses, moves, writes to, or
    //! injects into a window or a process. Before the first enumeration the
    //! process opts into per-monitor DPI awareness v2 (best effort, exactly
    //! once) so GetWindowRect reports physical pixels; on Windows versions
    //! too old for the call the failure is ignored and coordinates stay in
    //! the process's default awareness.

    use super::{GameWindowSource, RectPhysical, TopLevelWindowFact};

    /// Win32-backed observation source.
    #[derive(Debug, Default, Clone, Copy)]
    pub struct WindowsGameWindowSource;

    impl GameWindowSource for WindowsGameWindowSource {
        fn vrchat_pids(&self) -> std::io::Result<Vec<u32>> {
            vrchat_pids()
        }

        fn top_level_windows(&self) -> std::io::Result<Vec<TopLevelWindowFact>> {
            top_level_windows()
        }

        fn foreground_pid(&self) -> Option<u32> {
            foreground_pid()
        }
    }

    #[cfg(windows)]
    fn vrchat_pids() -> std::io::Result<Vec<u32>> {
        use crate::eac_probe::{os_source::ToolhelpProcessSource, ProcessSnapshotSource};
        let entries = ToolhelpProcessSource.snapshot()?;
        Ok(entries
            .into_iter()
            .filter(|entry| entry.image_name.eq_ignore_ascii_case("vrchat.exe"))
            .map(|entry| entry.pid)
            .collect())
    }

    #[cfg(not(windows))]
    fn vrchat_pids() -> std::io::Result<Vec<u32>> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "game-window observation requires Windows",
        ))
    }

    #[cfg(windows)]
    fn top_level_windows() -> std::io::Result<Vec<TopLevelWindowFact>> {
        use windows_sys::core::BOOL;
        use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
        use windows_sys::Win32::UI::HiDpi::{
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
            IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
        };

        // Best effort, exactly once: with per-monitor-v2 awareness
        // GetWindowRect reports physical pixels. A failure (Windows too old
        // for the call) leaves the process at its default awareness — the
        // coordinates stay correct within that awareness, just virtualized.
        static DPI_AWARENESS: std::sync::Once = std::sync::Once::new();
        DPI_AWARENESS.call_once(|| unsafe {
            SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        });

        struct Context {
            windows: Vec<TopLevelWindowFact>,
        }

        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let context = unsafe { &mut *(lparam as *mut Context) };
            let mut pid: u32 = 0;
            unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
            let mut rect = RECT::default();
            let rect_read = unsafe { GetWindowRect(hwnd, &mut rect) } != 0;
            if pid != 0 && rect_read {
                let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
                context.windows.push(TopLevelWindowFact {
                    hwnd: hwnd as u64,
                    pid,
                    visible: unsafe { IsWindowVisible(hwnd) } != 0,
                    iconic: unsafe { IsIconic(hwnd) } != 0,
                    tool: ex_style & WS_EX_TOOLWINDOW != 0,
                    rect: RectPhysical {
                        x: rect.left,
                        y: rect.top,
                        width: rect.right - rect.left,
                        height: rect.bottom - rect.top,
                    },
                });
            }
            1
        }

        let mut context = Context {
            windows: Vec::new(),
        };
        let enumerated =
            unsafe { EnumWindows(Some(enum_proc), &mut context as *mut Context as LPARAM) };
        if enumerated == 0 {
            // The callback never stops the enumeration, so a zero return is
            // an OS failure — except ERROR_SUCCESS, which is a genuinely
            // windowless desktop and reads as an empty enumeration, not an
            // error.
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(0) {
                return Err(error);
            }
        }
        Ok(context.windows)
    }

    #[cfg(not(windows))]
    fn top_level_windows() -> std::io::Result<Vec<TopLevelWindowFact>> {
        Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "game-window observation requires Windows",
        ))
    }

    #[cfg(windows)]
    fn foreground_pid() -> Option<u32> {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
        (pid != 0).then_some(pid)
    }

    #[cfg(not(windows))]
    fn foreground_pid() -> Option<u32> {
        None
    }
}

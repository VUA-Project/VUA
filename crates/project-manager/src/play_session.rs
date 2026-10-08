//! Closed Desktop/PICO sessions. Files and OS processes are facts; launch handoff is not readiness.
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use vua_orchestrator::{
    Clock, EnvironmentEngine, EnvironmentPresence, EnvironmentRoots, SystemClock,
};

pub const SCHEMA_VERSION: &str = "vua.play-session/v0.1";
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayRoute {
    DesktopPlay,
    PicoPcvr,
}
impl PlayRoute {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "desktop_play" => Some(Self::DesktopPlay),
            "pico_pcvr" => Some(Self::PicoPcvr),
            _ => None,
        }
    }
    fn components(self) -> &'static [&'static str] {
        match self {
            Self::DesktopPlay => &["steam", "vrchat"],
            Self::PicoPcvr => &["steam", "pico_runtime", "steamvr", "vrchat"],
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub created: u64,
    pub path: PathBuf,
}
#[derive(Debug, Clone)]
pub struct Software {
    pub component: &'static str,
    pub presence: &'static str,
    pub exe: Option<PathBuf>,
}
#[derive(Debug, Clone)]
pub struct Launch {
    pub exe: PathBuf,
    pub args: Vec<&'static str>,
}
/// Only project-manager supplies this seam. Requests never supply a native command or path.
pub trait PlayPlatform: Send + Sync {
    fn inspect(&self, route: PlayRoute) -> Result<Vec<Software>, &'static str>;
    fn processes(&self) -> Result<Vec<ProcessIdentity>, &'static str>;
    fn launch(&self, launch: &Launch) -> Result<(), &'static str>;
    /// Must recheck the complete identity before attempting normal window close.
    fn close(&self, identity: &ProcessIdentity) -> Result<(), &'static str>;
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoftwareFact {
    component: &'static str,
    presence: &'static str,
    running: bool,
    owned: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaySnapshot {
    schema_version: &'static str,
    captured_at: String,
    route: PlayRoute,
    state: &'static str,
    can_stop: bool,
    issue: Option<&'static str>,
    software: Vec<SoftwareFact>,
}
struct Session {
    id: String,
    route: PlayRoute,
    state: &'static str,
    issue: Option<&'static str>,
    baseline: Vec<ProcessIdentity>,
    owned: Vec<ProcessIdentity>,
    software: Vec<Software>,
    requested: HashSet<&'static str>,
    claimed: HashSet<&'static str>,
}
#[derive(Default)]
struct State {
    session: Option<Session>,
    issues: HashMap<PlayRoute, &'static str>,
    commands: HashMap<String, (PlayRoute, bool)>,
}
pub struct PlayService {
    platform: Arc<dyn PlayPlatform>,
    state: Arc<Mutex<State>>,
    clock: Arc<dyn Clock>,
    start_wait: Duration,
    close_wait: Duration,
}
impl PlayService {
    pub fn windows(roots: EnvironmentRoots) -> Self {
        Self::new(
            Arc::new(WindowsPlayPlatform::new(roots)),
            Arc::new(SystemClock),
        )
    }
    pub fn new(platform: Arc<dyn PlayPlatform>, clock: Arc<dyn Clock>) -> Self {
        Self {
            platform,
            state: Arc::new(Mutex::new(State::default())),
            clock,
            start_wait: Duration::from_secs(60),
            close_wait: Duration::from_secs(8),
        }
    }
    pub fn observe(&self, route: PlayRoute) -> Result<PlaySnapshot, &'static str> {
        let software = self.platform.inspect(route)?;
        let processes = self.platform.processes()?;
        let state = self.state.lock().map_err(|_| "unavailable")?;
        let session = state.session.as_ref().filter(|s| s.route == route);
        let facts: Vec<_> = software
            .iter()
            .map(|s| {
                let running = processes
                    .iter()
                    .any(|p| s.exe.as_ref().is_some_and(|exe| same_path(exe, &p.path)));
                let owned = session.is_some_and(|session| {
                    session.owned.iter().any(|p| {
                        processes.contains(p)
                            && s.exe.as_ref().is_some_and(|exe| same_path(exe, &p.path))
                    })
                });
                SoftwareFact {
                    component: s.component,
                    presence: s.presence,
                    running,
                    owned,
                }
            })
            .collect();
        let (phase, issue) = match session {
            Some(s)
                if s.state == "running"
                    && !facts.iter().all(|f| f.running && f.presence == "verified") =>
            {
                ("attention", Some("start_failed"))
            }
            Some(s) => (s.state, s.issue),
            None => state.issues.get(&route).map_or(("idle", None), |issue| {
                if (*issue == "other_route_active" && state.session.is_none())
                    || (*issue == "not_installed" && facts.iter().all(|f| f.presence == "verified"))
                {
                    ("idle", None)
                } else {
                    ("attention", Some(*issue))
                }
            }),
        };
        Ok(PlaySnapshot {
            schema_version: SCHEMA_VERSION,
            captured_at: self.clock.now_rfc3339(),
            route,
            state: phase,
            can_stop: session.is_some(),
            issue,
            software: facts,
        })
    }
    pub fn start(&self, route: PlayRoute, command: &str) -> Result<PlaySnapshot, &'static str> {
        let software = self.platform.inspect(route)?;
        let baseline = self.platform.processes()?;
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        if remember(&mut state, command, route, true)? && state.session.is_none() {
            if software.len() != route.components().len()
                || !route.components().iter().all(|id| {
                    software
                        .iter()
                        .any(|s| s.component == *id && s.presence == "verified" && s.exe.is_some())
                })
            {
                state.issues.insert(route, "not_installed");
            } else {
                state.issues.remove(&route);
                let session_id = command.to_owned();
                state.session = Some(Session {
                    id: session_id.clone(),
                    route,
                    state: "starting",
                    issue: None,
                    baseline,
                    owned: Vec::new(),
                    software,
                    requested: HashSet::new(),
                    claimed: HashSet::new(),
                });
                let platform = self.platform.clone();
                let shared = self.state.clone();
                let wait = self.start_wait;
                std::thread::spawn(move || {
                    start_worker(platform, shared, route, &session_id, wait)
                });
            }
        } else if state.session.as_ref().is_some_and(|s| s.route != route) {
            state.issues.insert(route, "other_route_active");
        }
        drop(state);
        self.observe(route)
    }
    pub fn stop(&self, route: PlayRoute, command: &str) -> Result<PlaySnapshot, &'static str> {
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        let fresh = remember(&mut state, command, route, false)?;
        if fresh {
            if let Some(session) = state
                .session
                .as_mut()
                .filter(|s| s.route == route && s.state != "stopping")
            {
                // Launch and cancellation share this lock. Once stopping is visible, no
                // subsequent VUA launch can occur, even if a vendor handoff is pending.
                session.state = "stopping";
                session.issue = None;
                let session_id = session.id.clone();
                let platform = self.platform.clone();
                let shared = self.state.clone();
                let wait = self.close_wait;
                std::thread::spawn(move || {
                    close_worker(platform, shared, route, &session_id, wait)
                });
            }
        }
        drop(state);
        self.observe(route)
    }
}
fn remember(
    state: &mut State,
    command: &str,
    route: PlayRoute,
    start: bool,
) -> Result<bool, &'static str> {
    if let Some(previous) = state.commands.get(command) {
        return if previous == &(route, start) {
            Ok(false)
        } else {
            Err("invalid_command")
        };
    }
    // Never evict an accepted ID and accidentally replay a side effect. Restart
    // releases the bounded in-memory history and all process-closing authority.
    if command.is_empty()
        || command.len() > 128
        || !command
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
        || state.commands.len() >= 4096
    {
        return Err("invalid_command");
    }
    state.commands.insert(command.to_owned(), (route, start));
    Ok(true)
}
fn same_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    fn normalize(path: &std::path::Path) -> String {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_lowercase()
    }
    normalize(left) == normalize(right)
}
fn claim(session: &mut Session, processes: &[ProcessIdentity]) {
    for s in &session.software {
        if session.requested.contains(s.component) && !session.claimed.contains(s.component) {
            if let Some(p) = processes.iter().find(|p| {
                !session.baseline.contains(p)
                    && s.exe.as_ref().is_some_and(|exe| same_path(exe, &p.path))
            }) {
                session.owned.push(p.clone());
                session.claimed.insert(s.component);
            }
        }
    }
}
fn launch_for(session: &Session, component: &str) -> Launch {
    let steam = session
        .software
        .iter()
        .find(|s| s.component == "steam")
        .unwrap()
        .exe
        .clone()
        .unwrap();
    match component {
        "vrchat" => Launch {
            exe: steam,
            args: if session.route == PlayRoute::DesktopPlay {
                vec!["-applaunch", "438100", "--no-vr"]
            } else {
                vec!["-applaunch", "438100"]
            },
        },
        "steamvr" => Launch {
            exe: steam,
            args: vec!["-applaunch", "250820"],
        },
        _ => Launch {
            exe: session
                .software
                .iter()
                .find(|s| s.component == component)
                .unwrap()
                .exe
                .clone()
                .unwrap(),
            args: vec![],
        },
    }
}
fn start_worker(
    platform: Arc<dyn PlayPlatform>,
    state: Arc<Mutex<State>>,
    route: PlayRoute,
    session_id: &str,
    wait: Duration,
) {
    for component in route.components() {
        let deadline = Instant::now() + wait;
        let mut sent = false;
        loop {
            let Ok(mut guard) = state.lock() else {
                return;
            };
            let Some(session) = guard
                .session
                .as_mut()
                .filter(|s| s.id == session_id && s.route == route && s.state == "starting")
            else {
                return;
            };
            let Ok(processes) = platform.processes() else {
                session.state = "attention";
                session.issue = Some("start_failed");
                return;
            };
            claim(session, &processes);
            let exe = session
                .software
                .iter()
                .find(|s| s.component == *component)
                .unwrap()
                .exe
                .as_ref()
                .unwrap();
            if processes.iter().any(|p| same_path(&p.path, exe)) {
                break;
            }
            if !sent {
                // File readiness is rechecked at dispatch, not inherited from a stale UI.
                let present = platform.inspect(route).is_ok_and(|facts| {
                    facts.iter().any(|f| {
                        f.component == *component
                            && f.presence == "verified"
                            && f.exe.as_ref().is_some_and(|p| same_path(p, exe))
                    })
                });
                if !present {
                    session.state = "attention";
                    session.issue = Some("start_failed");
                    return;
                }
                session.requested.insert(component);
                if platform.launch(&launch_for(session, component)).is_err() {
                    session.state = "attention";
                    session.issue = Some("start_failed");
                    return;
                }
                sent = true;
            }
            if Instant::now() >= deadline {
                session.state = "attention";
                session.issue = Some("start_timeout");
                return;
            }
            drop(guard);
            std::thread::sleep(Duration::from_millis(200));
        }
    }
    if let Ok(mut guard) = state.lock() {
        if let Some(s) = guard
            .session
            .as_mut()
            .filter(|s| s.id == session_id && s.route == route && s.state == "starting")
        {
            s.state = "running";
        }
    }
}
fn close_worker(
    platform: Arc<dyn PlayPlatform>,
    state: Arc<Mutex<State>>,
    route: PlayRoute,
    session_id: &str,
    wait: Duration,
) {
    let deadline = Instant::now() + wait;
    let mut dispatched = Vec::new();
    let mut failed = false;
    let issue = loop {
        let processes = match platform.processes() {
            Ok(p) => p,
            Err(_) => break Some("close_failed"),
        };
        let Ok(mut guard) = state.lock() else {
            return;
        };
        let Some(session) = guard
            .session
            .as_mut()
            .filter(|s| s.id == session_id && s.route == route && s.state == "stopping")
        else {
            return;
        };
        // A previously submitted Steam handoff may appear shortly after stop.
        // Observe it within the close window; never launch any new step here.
        claim(session, &processes);
        for process in session.owned.iter().rev().filter(|p| processes.contains(p)) {
            if !dispatched.contains(process) {
                if platform.close(process).is_err() {
                    failed = true;
                }
                dispatched.push(process.clone());
            }
        }
        let pending = session
            .requested
            .iter()
            .any(|c| !session.claimed.contains(c));
        let alive = session.owned.iter().any(|o| processes.contains(o));
        if !alive && !pending {
            break None;
        }
        if Instant::now() >= deadline {
            break Some(if pending && !alive {
                "close_pending"
            } else if failed {
                "close_failed"
            } else {
                "close_timeout"
            });
        }
        drop(guard);
        std::thread::sleep(Duration::from_millis(200));
    };
    if let Ok(mut guard) = state.lock() {
        if guard
            .session
            .as_ref()
            .is_some_and(|s| s.id == session_id && s.route == route && s.state == "stopping")
        {
            guard.session = None;
            if let Some(issue) = issue {
                guard.issues.insert(route, issue);
            } else {
                guard.issues.remove(&route);
            }
        }
    }
}

pub struct WindowsPlayPlatform {
    engine: EnvironmentEngine,
}
impl WindowsPlayPlatform {
    pub fn new(roots: EnvironmentRoots) -> Self {
        Self {
            engine: EnvironmentEngine::new(
                Arc::new(vua_orchestrator::StdProcessRunner),
                Arc::new(SystemClock),
                roots,
                Arc::new(crate::VccSettingsFileReader),
            ),
        }
    }
}
impl PlayPlatform for WindowsPlayPlatform {
    fn inspect(&self, route: PlayRoute) -> Result<Vec<Software>, &'static str> {
        let items = self.engine.inspect_deployment_components();
        Ok(route
            .components()
            .iter()
            .map(|id| {
                let fact = items.iter().find(|f| f.id == *id);
                let location = fact
                    .and_then(|f| {
                        f.facts
                            .get("exe")
                            .or_else(|| f.facts.get("path"))
                            .or_else(|| f.facts.get("root"))
                    })
                    .and_then(|p| p.as_str())
                    .map(PathBuf::from);
                let complete = location
                    .as_ref()
                    .is_some_and(|p| crate::deployment_adapter::component_files_present(id, p));
                let presence = match fact.map(|f| f.presence) {
                    Some(EnvironmentPresence::Detected) if complete => "verified",
                    Some(EnvironmentPresence::Detected) => "unusable",
                    Some(EnvironmentPresence::NotDetected) => "missing",
                    _ => "unknown",
                };
                let exe = location.and_then(|p| match *id {
                    "steam" => Some(p.join("steam.exe")),
                    "steamvr" => Some(p.join("bin/win64/vrmonitor.exe")),
                    "pico_runtime" => Some(p.join("PICO Connect.exe")),
                    "vrchat" => Some(p),
                    _ => None,
                });
                Software {
                    component: id,
                    presence,
                    exe,
                }
            })
            .collect())
    }
    fn processes(&self) -> Result<Vec<ProcessIdentity>, &'static str> {
        os::processes().map_err(|_| "unavailable")
    }
    fn launch(&self, launch: &Launch) -> Result<(), &'static str> {
        let mut command = std::process::Command::new(&launch.exe);
        command.args(&launch.args);
        command
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        if let Some(parent) = launch.exe.parent() {
            command.current_dir(parent);
        }
        // Reap only the short vendor invocation; never wait/terminate a running game.
        let mut child = command.spawn().map_err(|_| "start_failed")?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
    fn close(&self, identity: &ProcessIdentity) -> Result<(), &'static str> {
        os::close(identity).map_err(|_| "close_failed")
    }
}

mod os {
    use super::ProcessIdentity;
    #[cfg(windows)]
    fn identity(pid: u32) -> std::io::Result<ProcessIdentity> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, FILETIME},
            System::Threading::{
                GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        };
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let mut path = [0u16; 32768];
        let mut size = path.len() as u32;
        let ok = unsafe {
            GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) != 0
                && QueryFullProcessImageNameW(handle, 0, path.as_mut_ptr(), &mut size) != 0
        };
        let error = std::io::Error::last_os_error();
        unsafe {
            CloseHandle(handle);
        }
        if !ok {
            return Err(error);
        }
        Ok(ProcessIdentity {
            pid,
            created: (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime),
            path: std::path::PathBuf::from(String::from_utf16_lossy(&path[..size as usize])),
        })
    }
    #[cfg(windows)]
    pub(super) fn processes() -> std::io::Result<Vec<ProcessIdentity>> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
            System::Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
        };
        let handle = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error());
        }
        let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut more = unsafe { Process32FirstW(handle, &mut entry) };
        let mut out = Vec::new();
        let mut failure = None;
        while more != 0 {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]).to_lowercase();
            if [
                "steam.exe",
                "vrchat.exe",
                "vrmonitor.exe",
                "pico connect.exe",
            ]
            .contains(&name.as_str())
            {
                match identity(entry.th32ProcessID) {
                    Ok(p) => out.push(p),
                    Err(e) => {
                        // A vanished process is normal; an unreadable live process is unknown.
                        if e.raw_os_error() != Some(87) {
                            failure = Some(e);
                            break;
                        }
                    }
                }
            }
            more = unsafe { Process32NextW(handle, &mut entry) };
        }
        let error = std::io::Error::last_os_error();
        unsafe {
            CloseHandle(handle);
        }
        if let Some(error) = failure {
            return Err(error);
        }
        if error.raw_os_error() != Some(ERROR_NO_MORE_FILES as i32) {
            return Err(error);
        }
        Ok(out)
    }
    #[cfg(windows)]
    pub(super) fn close(expected: &ProcessIdentity) -> std::io::Result<()> {
        use windows_sys::Win32::{
            Foundation::{HWND, LPARAM},
            UI::WindowsAndMessaging::{
                EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE,
            },
        };
        // PID reuse cannot turn an old card lease into closing authority.
        if identity(expected.pid)? != *expected {
            return Err(std::io::Error::other("process identity changed"));
        }
        struct Context<'a> {
            expected: &'a ProcessIdentity,
            count: usize,
            failed: bool,
        }
        unsafe extern "system" fn callback(hwnd: HWND, param: LPARAM) -> i32 {
            let ctx = unsafe { &mut *(param as *mut Context<'_>) };
            let mut pid = 0;
            unsafe {
                GetWindowThreadProcessId(hwnd, &mut pid);
            }
            if pid == ctx.expected.pid {
                // Recheck at the individual window dispatch, not just before enumeration.
                if identity(pid).is_ok_and(|p| p == *ctx.expected)
                    && unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) } != 0
                {
                    ctx.count += 1;
                } else {
                    ctx.failed = true;
                }
            }
            1
        }
        let mut ctx = Context {
            expected,
            count: 0,
            failed: false,
        };
        let ok = unsafe { EnumWindows(Some(callback), &mut ctx as *mut Context<'_> as LPARAM) };
        if ok == 0 || ctx.failed || ctx.count == 0 {
            return Err(std::io::Error::other("no closeable window"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    pub(super) fn processes() -> std::io::Result<Vec<ProcessIdentity>> {
        Err(std::io::Error::other("Windows required"))
    }
    #[cfg(not(windows))]
    pub(super) fn close(_: &ProcessIdentity) -> std::io::Result<()> {
        Err(std::io::Error::other("Windows required"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Refusing {
        live: Vec<ProcessIdentity>,
        closed: Mutex<Vec<ProcessIdentity>>,
        reject: bool,
    }
    impl PlayPlatform for Refusing {
        fn inspect(&self, _: PlayRoute) -> Result<Vec<Software>, &'static str> {
            Ok(PlayRoute::PicoPcvr
                .components()
                .iter()
                .zip(&self.live)
                .map(|(component, p)| Software {
                    component,
                    presence: "verified",
                    exe: Some(p.path.clone()),
                })
                .collect())
        }
        fn processes(&self) -> Result<Vec<ProcessIdentity>, &'static str> {
            Ok(self.live.clone())
        }
        fn launch(&self, _: &Launch) -> Result<(), &'static str> {
            panic!("stop must never launch")
        }
        fn close(&self, p: &ProcessIdentity) -> Result<(), &'static str> {
            self.closed.lock().unwrap().push(p.clone());
            if self.reject {
                Err("refused")
            } else {
                Ok(())
            }
        }
    }
    #[test]
    fn workers_from_a_previous_session_cannot_change_its_replacement() {
        let platform = Arc::new(Refusing {
            live: Vec::new(),
            closed: Mutex::new(Vec::new()),
            reject: false,
        });
        let service = PlayService::new(platform.clone(), Arc::new(SystemClock));
        for phase in ["starting", "stopping"] {
            service.state.lock().unwrap().session = Some(Session {
                id: "replacement".to_owned(),
                route: PlayRoute::PicoPcvr,
                state: phase,
                issue: None,
                baseline: Vec::new(),
                owned: Vec::new(),
                software: Vec::new(),
                requested: HashSet::new(),
                claimed: HashSet::new(),
            });
            start_worker(
                platform.clone(),
                service.state.clone(),
                PlayRoute::PicoPcvr,
                "previous",
                Duration::ZERO,
            );
            close_worker(
                platform.clone(),
                service.state.clone(),
                PlayRoute::PicoPcvr,
                "previous",
                Duration::ZERO,
            );
            let guard = service.state.lock().unwrap();
            let session = guard
                .session
                .as_ref()
                .expect("replacement must be retained");
            assert_eq!(session.id, "replacement");
            assert_eq!(session.state, phase);
            assert!(platform.closed.lock().unwrap().is_empty());
        }
    }
    #[test]
    fn surviving_apps_are_reported_and_every_owned_close_is_attempted() {
        for reject in [true, false] {
            let platform = Arc::new(Refusing {
                live: PlayRoute::PicoPcvr
                    .components()
                    .iter()
                    .enumerate()
                    .map(|(n, c)| ProcessIdentity {
                        pid: n as u32 + 1,
                        created: n as u64 + 100,
                        path: PathBuf::from(format!("fixture/{c}.exe")),
                    })
                    .collect(),
                closed: Mutex::new(Vec::new()),
                reject,
            });
            let mut service = PlayService::new(platform.clone(), Arc::new(SystemClock));
            service.close_wait = Duration::ZERO;
            service.state.lock().unwrap().session = Some(Session {
                id: "survivor-test".to_owned(),
                route: PlayRoute::PicoPcvr,
                state: "running",
                issue: None,
                baseline: vec![platform.live[0].clone()],
                owned: platform.live[1..].to_vec(),
                software: platform.inspect(PlayRoute::PicoPcvr).unwrap(),
                requested: ["pico_runtime", "steamvr", "vrchat"].into_iter().collect(),
                claimed: ["pico_runtime", "steamvr", "vrchat"].into_iter().collect(),
            });
            service.stop(PlayRoute::PicoPcvr, "close").unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let s = service.observe(PlayRoute::PicoPcvr).unwrap();
                if !s.can_stop {
                    assert_eq!(
                        s.issue,
                        Some(if reject {
                            "close_failed"
                        } else {
                            "close_timeout"
                        })
                    );
                    assert!(s.software.iter().all(|f| f.running && !f.owned));
                    break;
                }
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(10));
            }
            let closed = platform.closed.lock().unwrap();
            assert_eq!(closed.len(), 3);
            assert!(!closed.contains(&platform.live[0]));
        }
    }
}

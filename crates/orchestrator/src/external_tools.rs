//! First N2 connection: source facts and explicit upstream handoffs, independent of AMF.
use crate::Clock;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolProcess {
    pub pid: u32,
    pub created: u64,
    pub path: PathBuf,
}
#[derive(Clone, Debug)]
pub struct ToolInstallation {
    pub presence: &'static str,
    pub steam_ready: bool,
    pub executable: Option<PathBuf>,
    pub build_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct FakeState {
        missing: bool,
        steam_missing: bool,
        unreadable: bool,
        fail_handoff: bool,
        fail_close: bool,
        processes: Vec<ToolProcess>,
        handoffs: Vec<ToolAction>,
        closes: Vec<ToolProcess>,
    }
    #[derive(Default)]
    struct Fake(Mutex<FakeState>);
    fn process(created: u64) -> ToolProcess {
        ToolProcess {
            pid: 42,
            created,
            path: "C:/fixture/VRCFaceTracking.exe".into(),
        }
    }
    impl ToolPlatform for Fake {
        fn inspect(&self) -> Result<ToolInstallation, &'static str> {
            let s = self.0.lock().unwrap();
            if s.unreadable {
                return Err("unavailable");
            }
            Ok(ToolInstallation {
                presence: if s.missing { "missing" } else { "installed" },
                steam_ready: !s.steam_missing,
                executable: (!s.missing).then(|| process(1).path),
                build_id: (!s.missing).then(|| "123".into()),
            })
        }
        fn processes(&self) -> Result<Vec<ToolProcess>, &'static str> {
            Ok(self.0.lock().unwrap().processes.clone())
        }
        fn handoff(&self, action: ToolAction) -> Result<(), &'static str> {
            let mut s = self.0.lock().unwrap();
            s.handoffs.push(action);
            if s.fail_handoff {
                Err("failure")
            } else {
                Ok(())
            }
        }
        fn close(&self, p: &ToolProcess) -> Result<(), &'static str> {
            let mut s = self.0.lock().unwrap();
            s.closes.push(p.clone());
            if s.fail_close {
                Err("failure")
            } else {
                Ok(())
            }
        }
    }
    fn fixture() -> (Arc<Fake>, ToolService) {
        let fake = Arc::new(Fake::default());
        let service = ToolService::new(
            fake.clone(),
            Arc::new(crate::FixedClock::new(&["2026-10-10T00:00:00Z"])),
        );
        (fake, service)
    }
    fn expire(service: &ToolService) {
        service
            .state
            .lock()
            .unwrap()
            .pending
            .as_mut()
            .unwrap()
            .since = Instant::now() - Duration::from_secs(61);
    }
    #[test]
    fn installation_handoff_is_not_installation_success_and_can_be_cancelled() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().missing = true;
        let started = service.act(ToolAction::Install, "install-1").unwrap();
        assert_eq!(
            (started.presence, started.activity),
            ("missing", "install_requested")
        );
        service.act(ToolAction::Install, "install-1").unwrap();
        service.act(ToolAction::Install, "install-2").unwrap();
        assert_eq!(fake.0.lock().unwrap().handoffs.len(), 1);
        assert!(service.act(ToolAction::Start, "install-1").is_err());
        assert_eq!(
            service.act(ToolAction::Cancel, "cancel").unwrap().activity,
            "idle"
        );
        assert_eq!(service.observe().unwrap().presence, "missing");
        service.act(ToolAction::Install, "retry").unwrap();
        fake.0.lock().unwrap().missing = false;
        assert_eq!(service.observe().unwrap().activity, "idle");
    }
    #[test]
    fn prerequisites_and_failed_handoffs_do_not_fake_a_running_tool() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().steam_missing = true;
        assert_eq!(
            service.act(ToolAction::Install, "1").unwrap().issue,
            Some("steam_missing")
        );
        assert!(fake.0.lock().unwrap().handoffs.is_empty());
        {
            let mut s = fake.0.lock().unwrap();
            s.steam_missing = false;
            s.missing = true;
        }
        assert_eq!(
            service.act(ToolAction::Start, "2").unwrap().issue,
            Some("not_installed")
        );
        {
            let mut s = fake.0.lock().unwrap();
            s.missing = false;
            s.fail_handoff = true;
        }
        let failed = service.act(ToolAction::Start, "3").unwrap();
        assert_eq!(failed.issue, Some("handoff_failed"));
        assert!(!failed.running);
        assert!(!failed.can_stop);
        fake.0.lock().unwrap().unreadable = true;
        assert!(service.observe().is_err());
    }
    #[test]
    fn only_a_new_matching_instance_is_owned_and_manual_exit_resets_close() {
        let (fake, service) = fixture();
        assert_eq!(
            service.act(ToolAction::Start, "1").unwrap().activity,
            "starting"
        );
        fake.0.lock().unwrap().processes.push(ToolProcess {
            path: "C:/other/VRCFaceTracking.exe".into(),
            ..process(1)
        });
        assert!(!service.observe().unwrap().can_stop);
        fake.0.lock().unwrap().processes.push(process(2));
        let running = service.observe().unwrap();
        assert!(running.running && running.can_stop);
        assert_eq!(running.activity, "idle");
        fake.0.lock().unwrap().processes.retain(|p| p.created != 2);
        let exited = service.observe().unwrap();
        assert!(!exited.running && !exited.can_stop);
        assert_eq!(exited.issue, None);
        service.act(ToolAction::Stop, "2").unwrap();
        assert!(fake.0.lock().unwrap().closes.is_empty());
    }
    #[test]
    fn preexisting_instance_and_restarted_host_never_gain_close_authority() {
        let (fake, service) = fixture();
        fake.0.lock().unwrap().processes.push(process(1));
        let existing = service.act(ToolAction::Start, "start").unwrap();
        assert!(existing.running);
        assert!(!existing.can_stop);
        service.act(ToolAction::Stop, "close").unwrap();
        assert!(fake.0.lock().unwrap().closes.is_empty());
        let restarted = ToolService::new(fake.clone(), Arc::new(crate::SystemClock));
        assert!(!restarted.observe().unwrap().can_stop);
    }
    #[test]
    fn cancellation_or_timeout_does_not_adopt_a_late_launch() {
        for cancel in [true, false] {
            let (fake, service) = fixture();
            service.act(ToolAction::Start, "1").unwrap();
            if cancel {
                assert_eq!(
                    service.act(ToolAction::Cancel, "2").unwrap().activity,
                    "idle"
                );
            } else {
                expire(&service);
                assert_eq!(service.observe().unwrap().issue, Some("start_timeout"));
            }
            fake.0.lock().unwrap().processes.push(process(3));
            let late = service.observe().unwrap();
            assert!(late.running && !late.can_stop);
            service.act(ToolAction::Stop, "3").unwrap();
            assert!(fake.0.lock().unwrap().closes.is_empty());
        }
    }
    #[test]
    fn close_is_bounded_and_pid_reuse_does_not_close_someone_elses_instance() {
        let (fake, service) = fixture();
        service.act(ToolAction::Start, "1").unwrap();
        fake.0.lock().unwrap().processes.push(process(1));
        service.observe().unwrap();
        service.act(ToolAction::Stop, "2").unwrap();
        service.act(ToolAction::Stop, "3").unwrap();
        assert_eq!(fake.0.lock().unwrap().closes.len(), 1);
        expire(&service);
        let refused = service.observe().unwrap();
        assert_eq!(refused.issue, Some("close_timeout"));
        assert!(refused.can_stop);
        fake.0.lock().unwrap().processes = vec![process(2)];
        let replacement = service.observe().unwrap();
        assert!(replacement.running && !replacement.can_stop);
        assert_eq!(replacement.issue, None);
        service.act(ToolAction::Stop, "4").unwrap();
        assert_eq!(fake.0.lock().unwrap().closes.len(), 1);
    }
    #[test]
    fn failed_normal_close_preserves_ownership_for_manual_exit_or_retry() {
        let (fake, service) = fixture();
        service.act(ToolAction::Start, "1").unwrap();
        {
            let mut s = fake.0.lock().unwrap();
            s.processes.push(process(1));
            s.fail_close = true;
        }
        service.observe().unwrap();
        let failed = service.act(ToolAction::Stop, "2").unwrap();
        assert_eq!(failed.issue, Some("close_failed"));
        assert!(failed.can_stop);
        fake.0.lock().unwrap().processes.clear();
        assert_eq!(service.observe().unwrap().issue, None);
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolAction {
    Install,
    Start,
    Stop,
    Cancel,
}
impl ToolAction {
    pub fn parse(action: &str) -> Option<Self> {
        match action {
            "install" => Some(Self::Install),
            "start" => Some(Self::Start),
            "stop" => Some(Self::Stop),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
}
pub trait ToolPlatform: Send + Sync {
    fn inspect(&self) -> Result<ToolInstallation, &'static str>;
    fn processes(&self) -> Result<Vec<ToolProcess>, &'static str>;
    fn handoff(&self, action: ToolAction) -> Result<(), &'static str>;
    /// A normal close, only after rechecking PID, creation time and path.
    fn close(&self, process: &ToolProcess) -> Result<(), &'static str>;
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSnapshot {
    pub schema_version: &'static str,
    pub tool_id: &'static str,
    pub captured_at: String,
    pub presence: &'static str,
    pub steam_ready: bool,
    pub build_id: Option<String>,
    pub running: bool,
    pub can_stop: bool,
    pub activity: &'static str,
    pub issue: Option<&'static str>,
}
struct Pending {
    action: ToolAction,
    since: Instant,
    baseline: Vec<ToolProcess>,
    target: Option<PathBuf>,
}
#[derive(Default)]
struct State {
    pending: Option<Pending>,
    owned: Option<ToolProcess>,
    issue: Option<&'static str>,
    commands: HashMap<String, ToolAction>,
}
pub struct ToolService {
    platform: Arc<dyn ToolPlatform>,
    clock: Arc<dyn Clock>,
    state: Mutex<State>,
    start_wait: Duration,
    close_wait: Duration,
}
fn same_path(a: &std::path::Path, b: &std::path::Path) -> bool {
    a.to_string_lossy()
        .eq_ignore_ascii_case(&b.to_string_lossy())
}
impl ToolService {
    pub fn new(platform: Arc<dyn ToolPlatform>, clock: Arc<dyn Clock>) -> Self {
        Self {
            platform,
            clock,
            state: Mutex::new(State::default()),
            start_wait: Duration::from_secs(60),
            close_wait: Duration::from_secs(8),
        }
    }
    fn snapshot(
        &self,
        state: &mut State,
        install: ToolInstallation,
        processes: &[ToolProcess],
    ) -> ToolSnapshot {
        if state.owned.as_ref().is_some_and(|p| !processes.contains(p)) {
            state.owned = None;
            state.issue = None;
        }
        if let Some(pending) = &state.pending {
            let running_target = processes.iter().find(|p| {
                pending
                    .target
                    .as_ref()
                    .is_some_and(|target| same_path(target, &p.path))
            });
            let completed = match pending.action {
                ToolAction::Install => install.presence == "installed",
                ToolAction::Start => running_target.is_some(),
                ToolAction::Stop => state.owned.is_none(),
                ToolAction::Cancel => true,
            };
            if completed {
                if pending.action == ToolAction::Start {
                    state.owned = running_target
                        .filter(|p| !pending.baseline.contains(p))
                        .cloned();
                }
                state.pending = None;
                state.issue = None;
            } else if pending.action == ToolAction::Start
                && pending.since.elapsed() >= self.start_wait
            {
                // A late launch is never adopted after the bounded observation window.
                state.pending = None;
                state.issue = Some("start_timeout");
            } else if pending.action == ToolAction::Stop
                && pending.since.elapsed() >= self.close_wait
            {
                state.pending = None;
                state.issue = Some("close_timeout");
            }
        }
        let running = processes.iter().any(|p| {
            install
                .executable
                .as_ref()
                .is_some_and(|exe| same_path(exe, &p.path))
        }) || state.owned.is_some();
        ToolSnapshot {
            schema_version: "vua.external-tool/v0.1",
            tool_id: "vrcft",
            captured_at: self.clock.now_rfc3339(),
            presence: install.presence,
            steam_ready: install.steam_ready,
            build_id: install.build_id,
            running,
            can_stop: state.owned.is_some(),
            issue: state.issue,
            activity: state.pending.as_ref().map_or("idle", |p| match p.action {
                ToolAction::Install => "install_requested",
                ToolAction::Start => "starting",
                ToolAction::Stop => "stopping",
                ToolAction::Cancel => "idle",
            }),
        }
    }
    pub fn observe(&self) -> Result<ToolSnapshot, &'static str> {
        let install = self.platform.inspect()?;
        let processes = self.platform.processes()?;
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        Ok(self.snapshot(&mut state, install, &processes))
    }
    pub fn act(&self, action: ToolAction, command: &str) -> Result<ToolSnapshot, &'static str> {
        let install = self.platform.inspect()?;
        let processes = self.platform.processes()?;
        let mut state = self.state.lock().map_err(|_| "unavailable")?;
        let snapshot = self.snapshot(&mut state, install.clone(), &processes);
        if let Some(previous) = state.commands.get(command) {
            return if *previous == action {
                Ok(snapshot)
            } else {
                Err("invalid_command")
            };
        }
        if state.commands.len() >= 256 {
            return Err("command_limit");
        }
        state.commands.insert(command.to_owned(), action);
        // A repeated click cannot dispatch while an upstream request is pending.
        if state.pending.is_some() && !matches!(action, ToolAction::Cancel | ToolAction::Stop) {
            return Ok(snapshot);
        }
        if action == ToolAction::Stop
            && state
                .pending
                .as_ref()
                .is_some_and(|p| p.action == ToolAction::Stop)
        {
            return Ok(snapshot);
        }
        state.issue = None;
        match action {
            ToolAction::Cancel => {
                if state
                    .pending
                    .as_ref()
                    .is_some_and(|p| matches!(p.action, ToolAction::Install | ToolAction::Start))
                {
                    state.pending = None;
                }
                // Stop observing the handoff; Steam's download/launch continues. Never adopt a late process.
            }
            ToolAction::Install | ToolAction::Start => {
                if !install.steam_ready {
                    state.issue = Some("steam_missing");
                } else if action == ToolAction::Start && install.presence != "installed" {
                    state.issue = Some("not_installed");
                } else if action == ToolAction::Install && install.presence == "installed" { /* reuse */
                } else {
                    match self.platform.handoff(action) {
                        Err(_) => state.issue = Some("handoff_failed"),
                        Ok(()) if action == ToolAction::Start && snapshot.running => { /* hand off to Steam without claiming the existing instance */
                        }
                        Ok(()) => {
                            state.pending = Some(Pending {
                                action,
                                since: Instant::now(),
                                baseline: processes.clone(),
                                target: install.executable.clone(),
                            })
                        }
                    }
                }
            }
            ToolAction::Stop => {
                if let Some(owned) = state.owned.clone() {
                    match self.platform.close(&owned) {
                        Ok(()) => {
                            state.pending = Some(Pending {
                                action,
                                since: Instant::now(),
                                baseline: vec![],
                                target: None,
                            })
                        }
                        Err(_) => state.issue = Some("close_failed"),
                    }
                }
            }
        }
        Ok(self.snapshot(&mut state, install, &processes))
    }
}

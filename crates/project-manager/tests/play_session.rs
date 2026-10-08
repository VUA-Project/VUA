//! All process actions below use an in-memory OS seam, never this machine's software.
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use vua_project_manager::play_session::{
    Launch, PlayPlatform, PlayRoute, PlayService, ProcessIdentity, Software,
};
#[derive(Default)]
struct Host {
    processes: Vec<ProcessIdentity>,
    launches: Vec<Launch>,
    closes: Vec<ProcessIdentity>,
    fail_launch: bool,
    refuse_close: bool,
    hold_start: bool,
    missing: bool,
    unknown: bool,
}
#[derive(Default)]
struct Fake(Mutex<Host>);
fn path(component: &str) -> PathBuf {
    PathBuf::from(format!(
        "C:/fixture/{component}/{}",
        match component {
            "steam" => "steam.exe",
            "pico_runtime" => "PICO Connect.exe",
            "steamvr" => "vrmonitor.exe",
            _ => "VRChat.exe",
        }
    ))
}
fn process(component: &str, pid: u32) -> ProcessIdentity {
    ProcessIdentity {
        pid,
        created: u64::from(pid),
        path: path(component),
    }
}
impl PlayPlatform for Fake {
    fn inspect(&self, route: PlayRoute) -> Result<Vec<Software>, &'static str> {
        let host = self.0.lock().unwrap();
        Ok((if route == PlayRoute::DesktopPlay {
            vec!["steam", "vrchat"]
        } else {
            vec!["steam", "pico_runtime", "steamvr", "vrchat"]
        })
        .iter()
        .map(|id| Software {
            component: id,
            presence: if host.missing && *id == "vrchat" {
                "missing"
            } else {
                "verified"
            },
            exe: Some(path(id)),
        })
        .collect())
    }
    fn processes(&self) -> Result<Vec<ProcessIdentity>, &'static str> {
        let h = self.0.lock().unwrap();
        if h.unknown {
            Err("unavailable")
        } else {
            Ok(h.processes.clone())
        }
    }
    fn launch(&self, launch: &Launch) -> Result<(), &'static str> {
        let mut h = self.0.lock().unwrap();
        h.launches.push(launch.clone());
        if h.fail_launch {
            return Err("failure");
        }
        if h.hold_start {
            return Ok(());
        }
        let id = if launch.args.contains(&"438100") {
            "vrchat"
        } else if launch.args.contains(&"250820") {
            "steamvr"
        } else if launch.exe == path("pico_runtime") {
            "pico_runtime"
        } else {
            "steam"
        };
        let pid = h.processes.iter().map(|p| p.pid).max().unwrap_or(100) + 1;
        h.processes.push(process(id, pid));
        Ok(())
    }
    fn close(&self, p: &ProcessIdentity) -> Result<(), &'static str> {
        let mut h = self.0.lock().unwrap();
        h.closes.push(p.clone());
        if h.refuse_close {
            return Err("refused");
        }
        h.processes.retain(|current| current != p);
        Ok(())
    }
}
fn service(fake: &Arc<Fake>) -> PlayService {
    PlayService::new(fake.clone(), Arc::new(vua_orchestrator::SystemClock))
}
fn wait(service: &PlayService, route: PlayRoute, state: &str) -> Value {
    let schema: Value = serde_json::from_slice(
        &std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../schemas/play-session/v0.1/result.schema.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let end = Instant::now() + Duration::from_secs(4);
    loop {
        let s = serde_json::to_value(service.observe(route).unwrap()).unwrap();
        assert!(
            validator.is_valid(&serde_json::json!({ "playSession": s })),
            "native observation must match the contract: {s}"
        );
        if s["state"] == state {
            return s;
        }
        assert!(Instant::now() < end, "waiting for {state}: {s}");
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn missing_files_prevent_launch_even_if_a_renderer_claims_readiness() {
    let f = Arc::new(Fake::default());
    f.0.lock().unwrap().missing = true;
    let s = service(&f);
    let snapshot =
        serde_json::to_value(s.start(PlayRoute::DesktopPlay, "missing").unwrap()).unwrap();
    assert_eq!(snapshot["issue"], "not_installed");
    assert_eq!(snapshot["canStop"], false);
    assert!(f.0.lock().unwrap().launches.is_empty());
    f.0.lock().unwrap().missing = false;
    let repaired = serde_json::to_value(s.observe(PlayRoute::DesktopPlay).unwrap()).unwrap();
    assert_eq!(repaired["issue"], Value::Null);
    assert_eq!(repaired["state"], "idle");
}
#[test]
fn desktop_reuses_steam_and_only_closes_the_new_game() {
    let f = Arc::new(Fake::default());
    f.0.lock().unwrap().processes.push(process("steam", 10));
    let s = service(&f);
    let r = PlayRoute::DesktopPlay;
    s.start(r, "start").unwrap();
    let running = wait(&s, r, "running");
    assert!(!running["software"][0]["owned"].as_bool().unwrap());
    assert!(running["software"][1]["owned"].as_bool().unwrap());
    let h = f.0.lock().unwrap();
    assert_eq!(h.launches.len(), 1);
    assert_eq!(h.launches[0].args, ["-applaunch", "438100", "--no-vr"]);
    drop(h);
    s.stop(r, "stop").unwrap();
    wait(&s, r, "idle");
    let h = f.0.lock().unwrap();
    assert_eq!(h.processes, vec![process("steam", 10)]);
    assert_eq!(h.closes.len(), 1);
    assert_eq!(h.closes[0].path, path("vrchat"));
}
#[test]
fn wholly_preexisting_software_is_retained_and_restart_has_no_ownership() {
    let f = Arc::new(Fake::default());
    f.0.lock().unwrap().processes = vec![process("steam", 10), process("vrchat", 20)];
    let s = service(&f);
    let r = PlayRoute::DesktopPlay;
    s.start(r, "start").unwrap();
    wait(&s, r, "running");
    s.stop(r, "stop").unwrap();
    wait(&s, r, "idle");
    assert!(f.0.lock().unwrap().closes.is_empty());
    let restarted = serde_json::to_value(service(&f).observe(r).unwrap()).unwrap();
    assert_eq!(restarted["canStop"], false);
    assert!(restarted["software"]
        .as_array()
        .unwrap()
        .iter()
        .all(|x| x["owned"] == false));
}
#[test]
fn pico_starts_the_complete_chain_and_does_not_repeat_command_ids() {
    let f = Arc::new(Fake::default());
    let s = service(&f);
    let r = PlayRoute::PicoPcvr;
    s.start(r, "start").unwrap();
    s.start(r, "start").unwrap();
    let running = wait(&s, r, "running");
    assert_eq!(running["software"].as_array().unwrap().len(), 4);
    let h = f.0.lock().unwrap();
    assert_eq!(h.launches.len(), 4);
    assert!(h.launches[1].args.is_empty());
    assert_eq!(h.launches[1].exe, path("pico_runtime"));
    assert_eq!(h.launches[2].args, ["-applaunch", "250820"]);
    assert_eq!(h.launches[3].args, ["-applaunch", "438100"]);
    drop(h);
    assert!(s.stop(r, "start").is_err());
    s.stop(r, "stop").unwrap();
    wait(&s, r, "idle");
    s.start(r, "start").unwrap();
    assert_eq!(f.0.lock().unwrap().launches.len(), 4);
}
#[test]
fn route_contention_does_not_start_another_vrchat() {
    let f = Arc::new(Fake::default());
    let s = service(&f);
    s.start(PlayRoute::DesktopPlay, "first").unwrap();
    wait(&s, PlayRoute::DesktopPlay, "running");
    let blocked = serde_json::to_value(s.start(PlayRoute::PicoPcvr, "second").unwrap()).unwrap();
    assert_eq!(blocked["issue"], "other_route_active");
    assert_eq!(f.0.lock().unwrap().launches.len(), 2);
    s.stop(PlayRoute::DesktopPlay, "release").unwrap();
    wait(&s, PlayRoute::DesktopPlay, "idle");
    let unblocked = serde_json::to_value(s.observe(PlayRoute::PicoPcvr).unwrap()).unwrap();
    assert_eq!(unblocked["issue"], Value::Null);
}
#[test]
fn pid_reuse_and_replacement_are_never_closed_under_an_old_lease() {
    let f = Arc::new(Fake::default());
    f.0.lock().unwrap().processes.push(process("steam", 10));
    let s = service(&f);
    let r = PlayRoute::DesktopPlay;
    s.start(r, "start").unwrap();
    wait(&s, r, "running");
    let mut h = f.0.lock().unwrap();
    let game = h
        .processes
        .iter_mut()
        .find(|p| p.path == path("vrchat"))
        .unwrap();
    game.created += 1;
    drop(h);
    s.stop(r, "stop").unwrap();
    wait(&s, r, "idle");
    let h = f.0.lock().unwrap();
    assert!(h.closes.is_empty());
    assert_eq!(h.processes.len(), 2);
}
#[test]
fn stop_prevents_unsent_followup_launches() {
    let f = Arc::new(Fake::default());
    f.0.lock().unwrap().hold_start = true;
    let s = service(&f);
    let r = PlayRoute::PicoPcvr;
    s.start(r, "start").unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while f.0.lock().unwrap().launches.is_empty() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    s.stop(r, "stop").unwrap();
    f.0.lock().unwrap().processes.push(process("steam", 200));
    wait(&s, r, "idle");
    assert_eq!(f.0.lock().unwrap().closes, vec![process("steam", 200)]);
    std::thread::sleep(Duration::from_millis(250));
    assert_eq!(f.0.lock().unwrap().launches.len(), 1);
}
#[test]
fn launch_failure_and_unknown_observation_are_honest() {
    let f = Arc::new(Fake::default());
    f.0.lock().unwrap().fail_launch = true;
    let s = service(&f);
    let r = PlayRoute::DesktopPlay;
    s.start(r, "start").unwrap();
    let failed = wait(&s, r, "attention");
    assert_eq!(failed["issue"], "start_failed");
    assert_eq!(failed["canStop"], true);
    f.0.lock().unwrap().unknown = true;
    assert!(s.observe(r).is_err());
}
#[test]
fn closed_vectors_pin_queries_commands_and_observation_consistency() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../schemas/play-session/v0.1");
    let read =
        |file| serde_json::from_slice::<Value>(&std::fs::read(root.join(file)).unwrap()).unwrap();
    let vectors = read("vectors.json");
    for (key, file) in [
        ("requests", "request.schema.json"),
        ("results", "result.schema.json"),
    ] {
        let validator = jsonschema::validator_for(&read(file)).unwrap();
        for vector in vectors[key].as_array().unwrap() {
            assert_eq!(
                validator.is_valid(&vector["value"]),
                vector["valid"].as_bool().unwrap(),
                "{vector}"
            );
        }
    }
}

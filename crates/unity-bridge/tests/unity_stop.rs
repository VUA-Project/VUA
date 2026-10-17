//! Stopping a watched Unity batch run ends its whole process tree and keeps the work project.
//!
//! This test binary is its own fake Unity: run by the Bridge, it starts a helper process the way
//! Unity starts its import workers and package server, writes a Unity-like log and keeps
//! importing until it is ended.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use vua_orchestrator::amf_production::UnityStage;
use vua_orchestrator::{BridgeError, ProjectRef, UnityCommand, UnityOperation, UnityPayload};
use vua_unity_bridge::{UnityBatchBridge, UnityLogTail};

const ROLE: &str = "VUA_FAKE_UNITY_ROLE";

fn main() {
    match std::env::var(ROLE).as_deref() {
        Ok("editor") => fake_editor(),
        Ok("helper") => std::thread::sleep(Duration::from_secs(120)),
        _ => {
            stopping_ends_the_unity_process_tree_and_keeps_the_project();
            println!("test stopping_ends_the_unity_process_tree_and_keeps_the_project ... ok");
        }
    }
}

fn argument(name: &str) -> PathBuf {
    let args = std::env::args().collect::<Vec<_>>();
    let index = args.iter().position(|arg| arg == name).expect("Bridge argument");
    PathBuf::from(&args[index + 1])
}

// The helper runs until the Bridge ends the whole process tree, as Unity's own helpers do.
#[allow(clippy::zombie_processes)]
fn fake_editor() {
    let log = argument("-logFile");
    let helper = std::process::Command::new(std::env::current_exe().unwrap())
        .env(ROLE, "helper")
        .spawn()
        .unwrap();
    std::fs::write(log.with_extension("helper"), helper.id().to_string()).unwrap();
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&log).unwrap();
    for line in [
        "[Licensing::Client] Successfully resolved entitlement details",
        "[Package Manager] Done resolving packages in 3.53 seconds",
        "Start importing Assets/Meiyun/Meiyun.prefab using Guid(22222222222222222222222222222222) Importer(-1,0)",
        "Start importing Assets/Amenbo/Tshirt.mat using Guid(33333333333333333333333333333333) Importer(-1,0)",
    ] {
        writeln!(file, "{line}").unwrap();
        file.flush().unwrap();
        std::thread::sleep(Duration::from_millis(100));
    }
    loop {
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[cfg(windows)]
fn running(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: the handle is checked and closed; the exit code points at writable storage.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code = 0;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == 259 // STILL_ACTIVE
    }
}

fn stopping_ends_the_unity_process_tree_and_keeps_the_project() {
    let root = std::env::temp_dir().join(format!("vua-unity-stop-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("Assets")).unwrap();
    std::fs::write(root.join("Assets/imported.prefab"), "kept").unwrap();
    // The fake Unity inherits its role; the Bridge strips only credentials from the environment.
    std::env::set_var(ROLE, "editor");
    let project = ProjectRef { id: "n3-stop".into(), root: root.clone() };
    let command = UnityCommand {
        schema_version: 5,
        command_id: "n3-stop-cmd".into(),
        operation: UnityOperation::AmfInspect,
        project_id: "n3-stop".into(),
        dry_run: true,
        expected_project_fingerprint: None,
        payload: UnityPayload::default(),
    };
    let tail = Mutex::new(UnityLogTail::new(&root, &command.command_id, Some(2)));
    let stages = Mutex::new(Vec::new());
    let started = Instant::now();
    let poll = || {
        let progress = tail.lock().unwrap().poll();
        let mut seen = stages.lock().unwrap();
        if seen.last() != Some(&progress.stage) {
            seen.push(progress.stage);
        }
        assert!(started.elapsed() < Duration::from_secs(60), "the fake Unity never reached its imports");
        // The player stops once Unity has imported both assets.
        let stop = progress.stage == UnityStage::Importing && progress.current == Some(2);
        #[cfg(windows)]
        if stop {
            let helper = std::fs::read_to_string(root.join(".vua/logs/n3-stop-cmd.helper")).unwrap();
            assert!(running(helper.parse().unwrap()), "the helper runs until the stop");
        }
        stop
    };
    let result = UnityBatchBridge::for_amf_production(std::env::current_exe().unwrap())
        .execute_watched(&project, &command, &poll);
    std::env::remove_var(ROLE);

    assert!(matches!(result, Err(BridgeError::Cancelled)), "{result:?}");
    let stages = stages.into_inner().unwrap();
    assert!(stages.windows(2).all(|pair| pair[0] < pair[1]), "stages only move forward: {stages:?}");
    assert_eq!(stages.last(), Some(&UnityStage::Importing), "{stages:?}");
    let log = root.join(".vua/logs/n3-stop-cmd.log");
    let helper: u32 = std::fs::read_to_string(log.with_extension("helper")).unwrap().parse().unwrap();
    #[cfg(windows)]
    assert!(!running(helper), "the helper Unity started was ended with it");
    #[cfg(not(windows))]
    let _ = helper;
    assert!(log.is_file(), "the log stays for diagnosis");
    assert_eq!(std::fs::read_to_string(root.join("Assets/imported.prefab")).unwrap(), "kept", "imported materials stay");
    assert!(Path::new(&root).join(".vua/bridge/n3-stop-cmd.request.json").is_file());
    std::fs::remove_dir_all(&root).unwrap();
}

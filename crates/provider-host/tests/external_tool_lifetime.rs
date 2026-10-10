//! Native Windows lifecycle only; synthetic child processes, no vendor applications.
#![cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, STILL_ACTIVE},
    System::Threading::{
        GetExitCodeProcess, OpenProcess, CREATE_BREAKAWAY_FROM_JOB, CREATE_NO_WINDOW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    },
};

fn child_command(root: &Path, helper: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", helper, "--nocapture"])
        .env("VUA_TOOL_LIFETIME_FIXTURE", root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    command
}
fn alive(pid: u32) -> bool {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code = 0;
        let read = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        read != 0 && code == STILL_ACTIVE as u32
    }
}
fn fixture_root() -> Option<PathBuf> {
    std::env::var_os("VUA_TOOL_LIFETIME_FIXTURE").map(PathBuf::from)
}
#[test]
fn worker_helper() {
    let Some(root) = fixture_root() else {
        return;
    };
    let kind = std::env::var("VUA_TOOL_LIFETIME_KIND").unwrap();
    fs::write(
        root.join(format!("{kind}.pid")),
        std::process::id().to_string(),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline && !root.join("cleanup").exists() {
        thread::sleep(Duration::from_millis(20));
    }
}
#[test]
fn owner_helper() {
    let Some(root) = fixture_root() else {
        return;
    };
    let _job = vua_provider_host::ProviderJobGuard::contain_host_process_tree().unwrap();
    child_command(&root, "worker_helper")
        .env("VUA_TOOL_LIFETIME_KIND", "worker")
        .spawn()
        .unwrap();
    child_command(&root, "worker_helper")
        .env("VUA_TOOL_LIFETIME_KIND", "external")
        .creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && !root.join("exit-owner").exists() {
        thread::sleep(Duration::from_millis(20));
    }
    // Process exit closes its last job handle. The fixture tests abnormal lifetime,
    // without dropping the self-containing guard in the test runner's own process.
    std::process::exit(0);
}
#[test]
fn provider_exit_collects_workers_but_preserves_explicit_external_handoffs() {
    let root = std::env::temp_dir().join(format!(
        "vua-external-lifetime-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let mut owner = child_command(&root, "owner_helper").spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline
        && !(root.join("worker.pid").exists() && root.join("external.pid").exists())
    {
        thread::sleep(Duration::from_millis(20));
    }
    let read_pid = |name: &str| {
        fs::read_to_string(root.join(format!("{name}.pid")))
            .unwrap()
            .parse::<u32>()
            .unwrap()
    };
    let worker = read_pid("worker");
    let external = read_pid("external");
    assert!(alive(worker) && alive(external));
    fs::write(root.join("exit-owner"), []).unwrap();
    owner.wait().unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while alive(worker) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    let contained = !alive(worker);
    let retained = alive(external);
    fs::write(root.join("cleanup"), []).unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while alive(external) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    assert!(root.starts_with(std::env::temp_dir()));
    fs::remove_dir_all(root).unwrap();
    assert!(contained, "ordinary workers must remain contained");
    assert!(retained, "external software must survive Provider exit");
    assert!(
        !alive(external),
        "fixture worker exits normally after cleanup"
    );
}

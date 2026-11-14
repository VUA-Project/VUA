//! Starts Unity Hub before Unity work. Batch-mode Unity reads the Editor license through Hub's
//! licensing client; the packaged (MSIX) Hub keeps the license in its own package folder, which
//! only that client reaches.
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub(crate) use vua_project_manager::manager_apps::{hub_launch, spawn_hub_launch, HubLaunch};

const LICENSING_CLIENT: &str = "Unity.Licensing.Client.exe";
const START_TIMEOUT: Duration = Duration::from_secs(90);
/// The client accepts license requests a moment after its process appears.
const SETTLE: Duration = Duration::from_secs(5);
// Serialize the client check, Hub launch and readiness wait across AMF projects.
static HUB_START: Mutex<()> = Mutex::new(());

/// Starts Hub when its licensing client is not running and waits for the client. Returns whether
/// the client runs; without it Unity still tries its own licensing.
pub(crate) fn ensure_licensing_client(
    launch: Option<HubLaunch>,
    cancelled: impl Fn() -> bool,
) -> bool {
    let _start = HUB_START.lock().expect("Unity Hub startup poisoned");
    if licensing_client_running() {
        return true;
    }
    let Some(launch) = launch else { return false };
    if spawn_hub_launch(&launch).is_err() {
        return false;
    }
    let started = Instant::now();
    while started.elapsed() < START_TIMEOUT && !cancelled() {
        if licensing_client_running() {
            std::thread::sleep(SETTLE);
            return true;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    false
}

fn licensing_client_running() -> bool {
    running_processes().is_some_and(|names| {
        names
            .iter()
            .any(|name| name.eq_ignore_ascii_case(LICENSING_CLIENT))
    })
}

#[cfg(not(windows))]
pub(crate) fn running_processes() -> Option<Vec<String>> {
    None
}

/// Native process names only: no shell, tasklist, executable paths or command lines.
#[cfg(windows)]
pub(crate) fn running_processes() -> Option<Vec<String>> {
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };
    // SAFETY: this scope owns the snapshot handle; all process-entry buffers have the required
    // size and live through each synchronous Win32 call. Every path closes the owned handle.
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = zeroed();
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(handle, &mut entry) == 0 {
            CloseHandle(handle);
            return None;
        }
        let mut names = Vec::new();
        loop {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            names.push(String::from_utf16_lossy(&entry.szExeFile[..end]));
            if Process32NextW(handle, &mut entry) == 0 {
                let complete = GetLastError() == ERROR_NO_MORE_FILES;
                CloseHandle(handle);
                return complete.then_some(names);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn packaged_hub_starts_through_its_application_identity() {
        let root = std::env::temp_dir().join(format!("vua-hub-{}", std::process::id()));
        std::fs::create_dir_all(root.join("app")).unwrap();
        std::fs::write(
            root.join("AppxManifest.xml"),
            "<Applications><Application Id=\"UnityHub\" Executable=\"app\\Unity Hub.exe\">",
        )
        .unwrap();
        let facts = serde_json::json!({
            "exe": root.join("app").join("Unity Hub.exe").to_string_lossy(),
            "via": "package",
            "package": "UnityTechnologies.UnityHub_3.22.3.65535_x64__2vrhnee42bhxm",
        });
        assert_eq!(
            hub_launch(&facts),
            Some(HubLaunch::Package {
                app_user_model_id: "UnityTechnologies.UnityHub_2vrhnee42bhxm!UnityHub".into()
            })
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_hub_starts_its_executable() {
        let facts = serde_json::json!({"exe": "C:/Program Files/Unity Hub/Unity Hub.exe", "via": "registry"});
        assert_eq!(
            hub_launch(&facts),
            Some(HubLaunch::Executable(PathBuf::from(
                "C:/Program Files/Unity Hub/Unity Hub.exe"
            )))
        );
        assert_eq!(hub_launch(&serde_json::json!({"candidates": []})), None);
    }
}

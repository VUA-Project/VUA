//! Starts Unity Hub before Unity work. Batch-mode Unity reads the Editor license through Hub's
//! licensing client; the packaged (MSIX) Hub keeps the license in its own package folder, which
//! only that client reaches.
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const LICENSING_CLIENT: &str = "Unity.Licensing.Client.exe";
const START_TIMEOUT: Duration = Duration::from_secs(90);
/// The client accepts license requests a moment after its process appears.
const SETTLE: Duration = Duration::from_secs(5);

/// How to start the detected Hub.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HubLaunch {
    /// A packaged Hub starts through its application identity, so it runs inside its package.
    Package { app_user_model_id: String },
    Executable(PathBuf),
}

/// Reads the launch from the environment's `unity_hub` facts (`exe`, `via`, `package`).
pub(crate) fn hub_launch(facts: &serde_json::Value) -> Option<HubLaunch> {
    let exe = PathBuf::from(facts["exe"].as_str()?);
    if facts["via"] != "package" {
        return Some(HubLaunch::Executable(exe));
    }
    // Full name `Name_Version_Arch__PublisherId`; the family name is `Name_PublisherId`.
    let full = facts["package"].as_str()?;
    let (name, _) = full.split_once('_')?;
    let (_, publisher) = full.rsplit_once("__")?;
    let root = exe.parent()?.parent()?;
    let app = application_id(root).unwrap_or_else(|| "UnityHub".into());
    Some(HubLaunch::Package { app_user_model_id: format!("{name}_{publisher}!{app}") })
}

fn application_id(package_root: &Path) -> Option<String> {
    let manifest = std::fs::read_to_string(package_root.join("AppxManifest.xml")).ok()?;
    let start = manifest.find("<Application ")?;
    let rest = &manifest[start..];
    let id = rest[rest.find("Id=\"")? + 4..].split('"').next()?;
    (!id.is_empty()).then(|| id.to_owned())
}

/// Starts Hub when its licensing client is not running and waits for the client. Returns whether
/// the client runs; without it Unity still tries its own licensing.
pub(crate) fn ensure_licensing_client(launch: Option<HubLaunch>, cancelled: impl Fn() -> bool) -> bool {
    if licensing_client_running() {
        return true;
    }
    let Some(launch) = launch else { return false };
    if start(&launch).is_err() {
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

#[cfg(windows)]
fn hidden(command: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000)
}

#[cfg(windows)]
fn licensing_client_running() -> bool {
    hidden(std::process::Command::new("tasklist").args([
        "/FI",
        &format!("IMAGENAME eq {LICENSING_CLIENT}"),
        "/FO",
        "CSV",
        "/NH",
    ]))
    .output()
    .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains(LICENSING_CLIENT))
}

#[cfg(not(windows))]
fn licensing_client_running() -> bool {
    false
}

#[cfg(windows)]
fn start(launch: &HubLaunch) -> std::io::Result<()> {
    let mut command = match launch {
        HubLaunch::Package { app_user_model_id } => {
            let mut command = std::process::Command::new("explorer.exe");
            command.arg(format!("shell:AppsFolder\\{app_user_model_id}"));
            command
        }
        HubLaunch::Executable(exe) => std::process::Command::new(exe),
    };
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for variable in vua_orchestrator::CREDENTIAL_ENV_REMOVALS {
        command.env_remove(variable);
    }
    command.spawn().map(drop)
}

#[cfg(not(windows))]
fn start(_launch: &HubLaunch) -> std::io::Result<()> {
    Err(std::io::ErrorKind::Unsupported.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_hub_starts_through_its_application_identity() {
        let root = std::env::temp_dir().join(format!("vua-hub-{}", std::process::id()));
        std::fs::create_dir_all(root.join("app")).unwrap();
        std::fs::write(root.join("AppxManifest.xml"), "<Applications><Application Id=\"UnityHub\" Executable=\"app\\Unity Hub.exe\">").unwrap();
        let facts = serde_json::json!({
            "exe": root.join("app").join("Unity Hub.exe").to_string_lossy(),
            "via": "package",
            "package": "UnityTechnologies.UnityHub_3.22.3.65535_x64__2vrhnee42bhxm",
        });
        assert_eq!(
            hub_launch(&facts),
            Some(HubLaunch::Package { app_user_model_id: "UnityTechnologies.UnityHub_2vrhnee42bhxm!UnityHub".into() })
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn installed_hub_starts_its_executable() {
        let facts = serde_json::json!({"exe": "C:/Program Files/Unity Hub/Unity Hub.exe", "via": "registry"});
        assert_eq!(hub_launch(&facts), Some(HubLaunch::Executable(PathBuf::from("C:/Program Files/Unity Hub/Unity Hub.exe"))));
        assert_eq!(hub_launch(&serde_json::json!({"candidates": []})), None);
    }
}

//! N2's first fixed Steam app adapter. No account/library ownership DB or module settings.
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use vua_orchestrator::{
    external_tools::{ToolAction, ToolInstallation, ToolPlatform, ToolProcess},
    EnvironmentEngine, EnvironmentRoots, SystemClock,
};

pub struct SteamToolPlatform {
    engine: EnvironmentEngine,
    fallback: Vec<PathBuf>,
}
impl SteamToolPlatform {
    pub fn new(roots: EnvironmentRoots) -> Self {
        let fallback = roots.steam_common.clone();
        Self {
            engine: EnvironmentEngine::new(
                Arc::new(vua_orchestrator::StdProcessRunner),
                Arc::new(SystemClock),
                roots,
                Arc::new(crate::VccSettingsFileReader),
            ),
            fallback,
        }
    }
}
fn small_text(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err(std::io::Error::other("oversized Steam metadata"));
    }
    String::from_utf8(bytes).map_err(|_| std::io::Error::other("invalid Steam metadata"))
}
// Valve's text app manifest: bounded quoted fields, rejecting duplicates and unsafe paths.
fn field(text: &str, key: &str) -> Option<String> {
    let tokens: Vec<_> = text.split('"').collect();
    let mut found = None;
    for (index, token) in tokens.iter().enumerate().filter(|(i, _)| i % 2 == 1) {
        if token.eq_ignore_ascii_case(key) {
            if found.is_some() {
                return None;
            }
            found = tokens.get(index + 2).map(|value| value.to_string());
        }
    }
    found
}
fn executable_present(path: &Path) -> std::io::Result<bool> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    if !file.metadata()?.is_file() || file.metadata()?.len() < 64 {
        return Ok(false);
    }
    let mut header = [0; 2];
    file.read_exact(&mut header)?;
    Ok(header == *b"MZ")
}
pub fn inspect_libraries(
    common: &[PathBuf],
    steam_ready: bool,
    metadata_unreadable: bool,
) -> ToolInstallation {
    let mut presence = if metadata_unreadable {
        "unknown"
    } else {
        "missing"
    };
    for root in common {
        let Some(apps) = root.parent() else {
            continue;
        };
        let manifest = apps.join("appmanifest_3329480.acf");
        let text = match small_text(&manifest) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // A leftover directory is not a completed Steam installation.
                if root.join("VRCFaceTracking").exists() && presence != "unknown" {
                    presence = "incomplete";
                }
                continue;
            }
            Err(_) => {
                presence = "unknown";
                continue;
            }
        };
        let Some(directory) = field(&text, "installdir").filter(|value| {
            !value.is_empty() && !value.contains(['/', '\\', ':']) && value != "." && value != ".."
        }) else {
            presence = "unknown";
            continue;
        };
        if field(&text, "appid").as_deref() != Some("3329480") {
            presence = "unknown";
            continue;
        }
        let exe = root.join(directory).join("VRCFaceTracking.exe");
        let present = match executable_present(&exe) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => {
                presence = "unknown";
                continue;
            }
        };
        if field(&text, "StateFlags").as_deref() == Some("4") && present {
            return ToolInstallation {
                presence: "installed",
                steam_ready,
                executable: Some(exe),
                build_id: field(&text, "buildid").filter(|id| {
                    !id.is_empty() && id.len() <= 32 && id.bytes().all(|c| c.is_ascii_digit())
                }),
            };
        }
        if presence != "unknown" {
            presence = "incomplete";
        }
    }
    ToolInstallation {
        presence,
        steam_ready,
        executable: None,
        build_id: None,
    }
}
impl ToolPlatform for SteamToolPlatform {
    fn inspect(&self) -> Result<ToolInstallation, &'static str> {
        let discovery = self.engine.discover_steam();
        let steam_ready = discovery
            .as_ref()
            .is_some_and(|(root, _)| root.join("steam.exe").is_file());
        let unreadable = discovery.as_ref().is_some_and(|(root, _)| {
            let libraries = root.join("steamapps/libraryfolders.vdf");
            libraries.exists() && small_text(&libraries).is_err()
        });
        let common = discovery
            .map(|(_, roots)| roots)
            .unwrap_or_else(|| self.fallback.clone());
        Ok(inspect_libraries(&common, steam_ready, unreadable))
    }
    fn processes(&self) -> Result<Vec<ToolProcess>, &'static str> {
        crate::play_session::os::processes_matching(|name| name == "vrcfacetracking.exe")
            .map(|processes| {
                processes
                    .into_iter()
                    .map(|p| ToolProcess {
                        pid: p.pid,
                        created: p.created,
                        path: p.path,
                    })
                    .collect()
            })
            .map_err(|_| "unavailable")
    }
    fn handoff(&self, action: ToolAction) -> Result<(), &'static str> {
        let steam = self
            .engine
            .discover_steam()
            .map(|(root, _)| root.join("steam.exe"))
            .filter(|exe| exe.is_file())
            .ok_or("steam_missing")?;
        let mut command = std::process::Command::new(&steam);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::System::Threading::CREATE_BREAKAWAY_FROM_JOB;
            // Steam and the app it starts belong to the user's upstream session.
            // Fail rather than fall back to a launch tied to Provider shutdown.
            command.creation_flags(CREATE_BREAKAWAY_FROM_JOB);
        }
        match action {
            ToolAction::Install => {
                command.args(["-url", "steam://install/3329480"]);
            }
            ToolAction::Start => {
                command.args(["-applaunch", "3329480"]);
            }
            _ => return Err("unavailable"),
        }
        command
            .current_dir(steam.parent().ok_or("unavailable")?)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let mut child = command.spawn().map_err(|_| "handoff_failed")?;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
    fn close(&self, process: &ToolProcess) -> Result<(), &'static str> {
        crate::play_session::os::close(&crate::play_session::ProcessIdentity {
            pid: process.pid,
            created: process.created,
            path: process.path.clone(),
        })
        .map_err(|_| "close_failed")
    }
}

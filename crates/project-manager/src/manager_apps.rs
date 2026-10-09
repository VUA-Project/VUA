//! Read-only executable discovery. Config files are deliberately not installation evidence.
use serde::Serialize;
use std::path::PathBuf;
use vua_orchestrator::{
    Clock, EnvironmentEngine, EnvironmentPresence, EnvironmentRoots, RegistryHive, SystemClock,
};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagerApps {
    pub schema_version: &'static str,
    pub captured_at: String,
    pub apps: Vec<ManagerApp>,
}
#[derive(Serialize)]
pub struct ManagerApp {
    pub component: &'static str,
    pub presence: &'static str,
    pub path: Option<String>,
}
pub fn inspect(roots: &EnvironmentRoots) -> ManagerApps {
    let engine = EnvironmentEngine::new(
        std::sync::Arc::new(vua_orchestrator::StdProcessRunner),
        std::sync::Arc::new(SystemClock),
        roots.clone(),
        std::sync::Arc::new(crate::VccSettingsFileReader),
    );
    let hub = engine
        .inspect_deployment_components()
        .into_iter()
        .find(|f| f.id == "unity_hub");
    let hub_path = hub
        .as_ref()
        .and_then(|f| f.facts["exe"].as_str())
        .map(PathBuf::from);
    let hub_presence = match hub.as_ref().map(|f| f.presence) {
        Some(EnvironmentPresence::Detected) if hub_path.as_ref().is_some_and(|p| p.is_file()) => {
            "found"
        }
        Some(EnvironmentPresence::NotDetected) => "not_found",
        _ => "unknown",
    };
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let programs = std::env::var_os("ProgramFiles").map(PathBuf::from);
    let mut apps = vec![ManagerApp {
        component: "unity_hub",
        presence: hub_presence,
        path: hub_path.map(|p| p.to_string_lossy().into_owned()),
    }];
    for (component, product, binaries) in [
        (
            "vcc",
            "VRChat Creator Companion",
            &["CreatorCompanion.exe"][..],
        ),
        ("alcom", "ALCOM", &["ALCOM.exe", "vrc-get-gui.exe"][..]),
    ] {
        let mut candidates = Vec::new();
        for root in local
            .iter()
            .map(|p| p.join("Programs"))
            .chain(programs.iter().cloned())
        {
            for binary in binaries {
                candidates.push(root.join(product).join(binary));
            }
        }
        for binary in binaries {
            for hive in [RegistryHive::CurrentUser, RegistryHive::LocalMachine] {
                let key = format!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{binary}");
                if let Some(path) = roots.registry.get_string(hive, &key, "") {
                    candidates.push(PathBuf::from(path.trim_matches('"')));
                }
                for product_key in [product.to_owned(), format!("{product}_is1")] {
                    let key = format!(
                        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{product_key}"
                    );
                    if let Some(root) = roots.registry.get_string(hive, &key, "InstallLocation") {
                        candidates.push(PathBuf::from(root.trim_matches('"')).join(binary));
                    }
                }
            }
        }
        apps.push(discover(component, &candidates));
    }
    ManagerApps {
        schema_version: "vua.manager-apps/v0.1",
        captured_at: SystemClock.now_rfc3339(),
        apps,
    }
}
fn discover(component: &'static str, candidates: &[PathBuf]) -> ManagerApp {
    let mut unreadable = false;
    let path = candidates.iter().find_map(|p| match std::fs::metadata(p) {
        Ok(metadata) if metadata.is_file() => Some(p.to_string_lossy().into_owned()),
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            unreadable = true;
            None
        }
        _ => None,
    });
    ManagerApp {
        component,
        presence: if path.is_some() {
            "found"
        } else if unreadable {
            "unknown"
        } else {
            "not_found"
        },
        path,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_and_empty_folders_do_not_count_as_apps() {
        let root = std::env::temp_dir().join(format!("vua-manager-app-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let exe = root.join("ALCOM.exe");
        std::fs::write(root.join("settings.json"), "{}").unwrap();
        assert_eq!(
            discover("alcom", std::slice::from_ref(&exe)).presence,
            "not_found"
        );
        std::fs::write(&exe, "fixture").unwrap();
        assert_eq!(discover("alcom", &[exe]).presence, "found");
        std::fs::remove_file(root.join("ALCOM.exe")).unwrap();
        std::fs::remove_file(root.join("settings.json")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}

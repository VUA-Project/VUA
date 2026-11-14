//! Read-only Easy Anti-Cheat (EOS) installation and Authenticode signature inspection.
//!
//! The VRChat directory is derived strictly from VUA's own Steam installation discovery
//! (`EnvironmentEngine`); callers never supply paths.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vua_orchestrator::{
    EnvironmentEngine, EnvironmentPresence, EnvironmentRoots, StdProcessRunner, SystemClock,
};

use crate::deployment_trust::trusted_eac_binary_cached;
use crate::VccSettingsFileReader;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EacFolderState {
    Present,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EacBinaryState {
    Verified,
    Unverified,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EacInstallStateV02 {
    pub eac_folder: EacFolderState,
    pub setup_signature: EacBinaryState,
    pub service_binary: EacBinaryState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EacInstallObservation {
    pub vrchat_dir: Option<PathBuf>,
    pub install: EacInstallStateV02,
}

/// Injectable installation and signature inspection seam.
pub trait InstallSource: Send + Sync {
    fn inspect_install(
        &self,
        eos_service_present: bool,
        eos_service_binary: Option<&Path>,
    ) -> Result<EacInstallObservation, String>;

    /// Resolves the detected VRChat installation directory without running signature checks when
    /// supported by the implementation.
    fn detect_vrchat_root(&self) -> Option<PathBuf> {
        self.inspect_install(false, None)
            .ok()
            .and_then(|obs| obs.vrchat_dir)
    }
}

pub struct WindowsInstallSource {
    engine: EnvironmentEngine,
}

impl WindowsInstallSource {
    pub fn new(roots: EnvironmentRoots) -> Self {
        Self {
            engine: EnvironmentEngine::new(
                Arc::new(StdProcessRunner),
                Arc::new(SystemClock),
                roots,
                Arc::new(VccSettingsFileReader),
            ),
        }
    }

    pub fn detect_vrchat_dir(&self) -> Option<PathBuf> {
        let vrchat = self.engine.inspect_vrchat();
        if vrchat.presence != EnvironmentPresence::Detected {
            return None;
        }
        if let Some(exe) = vrchat.facts.get("exe").and_then(|v| v.as_str()) {
            return Path::new(exe).parent().map(Path::to_path_buf);
        }
        vrchat
            .facts
            .get("root")
            .or_else(|| vrchat.facts.get("path"))
            .and_then(|v| v.as_str())
            .map(PathBuf::from)
    }
}

fn check_signed_file(path: &Path) -> EacBinaryState {
    if !path.is_file() {
        EacBinaryState::Missing
    } else if trusted_eac_binary_cached(path) {
        EacBinaryState::Verified
    } else {
        EacBinaryState::Unverified
    }
}

impl InstallSource for WindowsInstallSource {
    fn detect_vrchat_root(&self) -> Option<PathBuf> {
        self.detect_vrchat_dir()
    }

    fn inspect_install(
        &self,
        eos_service_present: bool,
        eos_service_binary: Option<&Path>,
    ) -> Result<EacInstallObservation, String> {
        let vrchat_dir = self.detect_vrchat_dir();
        let (eac_folder, setup_signature) = match vrchat_dir.as_deref() {
            None => (EacFolderState::Unknown, EacBinaryState::Unknown),
            Some(dir) => {
                let eac_dir = dir.join("EasyAntiCheat");
                if !eac_dir.is_dir() {
                    (EacFolderState::Missing, EacBinaryState::Missing)
                } else {
                    let setup_exe = eac_dir.join("EasyAntiCheat_EOS_Setup.exe");
                    (EacFolderState::Present, check_signed_file(&setup_exe))
                }
            }
        };

        let service_binary = if !eos_service_present {
            EacBinaryState::Missing
        } else {
            match eos_service_binary {
                Some(path) => check_signed_file(path),
                None => EacBinaryState::Unknown,
            }
        };

        Ok(EacInstallObservation {
            vrchat_dir,
            install: EacInstallStateV02 {
                eac_folder,
                setup_signature,
                service_binary,
            },
        })
    }
}

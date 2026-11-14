//! Read-only Windows Service Control Manager (SCM) status and binary path inspection for Easy
//! Anti-Cheat (EOS).
//!
//! Boundary invariant: VUA only connects to SCM (`SC_MANAGER_CONNECT`) and opens the two named
//! EAC services with `SERVICE_QUERY_STATUS | SERVICE_QUERY_CONFIG`. Service stop, start, delete,
//! creation, or configuration mutation APIs are forbidden by product boundary and verified absent
//! from this module's source text by unit test.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum EacServiceName {
    #[serde(rename = "EasyAntiCheat_EOS")]
    EasyAntiCheatEos,
    #[serde(rename = "EasyAntiCheat_EOSSys")]
    EasyAntiCheatEosSys,
}

impl EacServiceName {
    pub const ALL: [Self; 2] = [Self::EasyAntiCheatEos, Self::EasyAntiCheatEosSys];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::EasyAntiCheatEos => "EasyAntiCheat_EOS",
            Self::EasyAntiCheatEosSys => "EasyAntiCheat_EOSSys",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EacServiceState {
    Stopped,
    StartPending,
    StopPending,
    Running,
    Other,
    Unreadable,
}

impl EacServiceState {
    pub const fn is_active_or_transitioning(self) -> bool {
        matches!(
            self,
            Self::StartPending | Self::StopPending | Self::Running | Self::Other
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawServiceObservation {
    pub name: EacServiceName,
    pub present: bool,
    pub state: EacServiceState,
    pub binary_path: Option<PathBuf>,
}

/// Injectable read-only service status seam. CI runs synthetic implementations only.
pub trait ServiceStatusSource: Send + Sync {
    fn query_services(&self) -> Result<[RawServiceObservation; 2], String>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsServiceStatusSource;

impl ServiceStatusSource for WindowsServiceStatusSource {
    fn query_services(&self) -> Result<[RawServiceObservation; 2], String> {
        query_windows_services()
    }
}

/// Extracts the executable file path from a Windows SCM `lpBinaryPathName` string (which may be
/// quoted or carry trailing command-line switches).
pub fn unquote_service_binary_path(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim().trim_matches('\0').trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('"') {
        let end = rest.find('"')?;
        let candidate = rest[..end].trim();
        return (!candidate.is_empty()).then(|| PathBuf::from(candidate));
    }
    let lower = trimmed.to_ascii_lowercase();
    for suffix in [".exe", ".sys"] {
        if let Some(idx) = lower.find(suffix) {
            let end = idx + suffix.len();
            if end == trimmed.len() || trimmed.as_bytes().get(end) == Some(&b' ') {
                let candidate = trimmed[..end].trim();
                let normalized = candidate.strip_prefix(r"\??\").unwrap_or(candidate);
                return (!normalized.is_empty()).then(|| PathBuf::from(normalized));
            }
        }
    }
    Some(PathBuf::from(
        trimmed.strip_prefix(r"\??\").unwrap_or(trimmed),
    ))
}

#[cfg(windows)]
fn query_windows_services() -> Result<[RawServiceObservation; 2], String> {
    use windows_sys::Win32::{
        Foundation::ERROR_SERVICE_DOES_NOT_EXIST,
        System::Services::{
            CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceConfigW,
            QueryServiceStatusEx, QUERY_SERVICE_CONFIGW, SC_MANAGER_CONNECT,
            SC_STATUS_PROCESS_INFO, SERVICE_QUERY_CONFIG, SERVICE_QUERY_STATUS, SERVICE_RUNNING,
            SERVICE_START_PENDING, SERVICE_STATUS_PROCESS, SERVICE_STOPPED, SERVICE_STOP_PENDING,
        },
    };

    let scm = unsafe { OpenSCManagerW(std::ptr::null(), std::ptr::null(), SC_MANAGER_CONNECT) };
    if scm.is_null() {
        return Err(format!(
            "OpenSCManagerW(SC_MANAGER_CONNECT) failed: {}",
            std::io::Error::last_os_error()
        ));
    }

    let query_one = |service_name: EacServiceName| -> Result<RawServiceObservation, String> {
        let wide_name: Vec<u16> = service_name
            .as_str()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let handle = unsafe {
            OpenServiceW(
                scm,
                wide_name.as_ptr(),
                SERVICE_QUERY_STATUS | SERVICE_QUERY_CONFIG,
            )
        };
        if handle.is_null() {
            let err = std::io::Error::last_os_error();
            if err.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST as i32) {
                return Ok(RawServiceObservation {
                    name: service_name,
                    present: false,
                    state: EacServiceState::Stopped,
                    binary_path: None,
                });
            }
            // Fall back to status-only query if QUERY_CONFIG was denied.
            let status_only =
                unsafe { OpenServiceW(scm, wide_name.as_ptr(), SERVICE_QUERY_STATUS) };
            if status_only.is_null() {
                let fallback_err = std::io::Error::last_os_error();
                if fallback_err.raw_os_error() == Some(ERROR_SERVICE_DOES_NOT_EXIST as i32) {
                    return Ok(RawServiceObservation {
                        name: service_name,
                        present: false,
                        state: EacServiceState::Stopped,
                        binary_path: None,
                    });
                }
                return Err(format!(
                    "OpenServiceW({}) failed: {fallback_err}",
                    service_name.as_str()
                ));
            }
            let obs = read_status_and_optional_config(status_only, service_name, false);
            unsafe { CloseServiceHandle(status_only) };
            return obs;
        }

        let obs = read_status_and_optional_config(handle, service_name, true);
        unsafe { CloseServiceHandle(handle) };
        obs
    };

    fn read_status_and_optional_config(
        handle: windows_sys::Win32::System::Services::SC_HANDLE,
        service_name: EacServiceName,
        can_query_config: bool,
    ) -> Result<RawServiceObservation, String> {
        let mut status: SERVICE_STATUS_PROCESS = unsafe { std::mem::zeroed() };
        let mut bytes_needed: u32 = 0;
        let ok = unsafe {
            QueryServiceStatusEx(
                handle,
                SC_STATUS_PROCESS_INFO,
                (&mut status as *mut SERVICE_STATUS_PROCESS).cast(),
                std::mem::size_of::<SERVICE_STATUS_PROCESS>() as u32,
                &mut bytes_needed,
            )
        };
        if ok == 0 {
            return Err(format!(
                "QueryServiceStatusEx({}) failed: {}",
                service_name.as_str(),
                std::io::Error::last_os_error()
            ));
        }
        let state = match status.dwCurrentState {
            SERVICE_STOPPED => EacServiceState::Stopped,
            SERVICE_START_PENDING => EacServiceState::StartPending,
            SERVICE_STOP_PENDING => EacServiceState::StopPending,
            SERVICE_RUNNING => EacServiceState::Running,
            _ => EacServiceState::Other,
        };

        let binary_path = if can_query_config {
            let mut needed: u32 = 0;
            unsafe { QueryServiceConfigW(handle, std::ptr::null_mut(), 0, &mut needed) };
            if needed > 0 && needed <= 64 * 1024 {
                let mut buffer = vec![0u8; needed as usize];
                let cfg_ptr = buffer.as_mut_ptr().cast::<QUERY_SERVICE_CONFIGW>();
                let cfg_ok =
                    unsafe { QueryServiceConfigW(handle, cfg_ptr, needed, &mut needed) } != 0;
                if cfg_ok {
                    let raw_ptr = unsafe { (*cfg_ptr).lpBinaryPathName };
                    if !raw_ptr.is_null() {
                        let mut len = 0usize;
                        while len < 32768 && unsafe { *raw_ptr.add(len) } != 0 {
                            len += 1;
                        }
                        let raw = String::from_utf16_lossy(unsafe {
                            std::slice::from_raw_parts(raw_ptr, len)
                        });
                        unquote_service_binary_path(&raw)
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        Ok(RawServiceObservation {
            name: service_name,
            present: true,
            state,
            binary_path,
        })
    }

    let eos = query_one(EacServiceName::EasyAntiCheatEos);
    let eos_sys = query_one(EacServiceName::EasyAntiCheatEosSys);
    unsafe { CloseServiceHandle(scm) };

    Ok([eos?, eos_sys?])
}

#[cfg(not(windows))]
fn query_windows_services() -> Result<[RawServiceObservation; 2], String> {
    Err("Windows SCM status inspection requires Windows".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_source_contains_no_service_control_or_mutation_apis() {
        let source = include_str!("eac_service.rs");
        let production_code = source
            .split("#[cfg(test)]")
            .next()
            .expect("production section exists");
        for forbidden in [
            "ControlService",
            "DeleteService",
            "ChangeServiceConfig",
            "StartService",
            "CreateService",
        ] {
            assert!(
                !production_code.contains(forbidden),
                "forbidden service mutation/control API `{forbidden}` found in eac_service.rs"
            );
        }
    }

    #[test]
    fn unquotes_service_binary_paths_cleanly() {
        assert_eq!(
            unquote_service_binary_path(
                r#""C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe""#
            ),
            Some(PathBuf::from(
                r"C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe"
            ))
        );
        assert_eq!(
            unquote_service_binary_path(
                r#""C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe" -service"#
            ),
            Some(PathBuf::from(
                r"C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.exe"
            ))
        );
        assert_eq!(
            unquote_service_binary_path(
                r"\??\C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.sys"
            ),
            Some(PathBuf::from(
                r"C:\Program Files (x86)\EasyAntiCheat_EOS\EasyAntiCheat_EOS.sys"
            ))
        );
        assert_eq!(unquote_service_binary_path("   "), None);
    }
}

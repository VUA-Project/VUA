//! Windows process-tree containment for the supervised Provider.

use std::mem::{size_of, zeroed};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

pub struct ProviderJobGuard {
    handle: HANDLE,
}

impl ProviderJobGuard {
    /// Places the Provider in a job whose descendants are terminated when the
    /// Provider exits or crashes and its last job handle closes.
    pub fn contain_current_process_tree() -> Result<Self, std::io::Error> {
        Self::contain(false)
    }

    /// Host-only external apps may explicitly break away. Ordinary workers still
    /// inherit containment; AMF keeps the stricter default above.
    pub fn contain_host_process_tree() -> Result<Self, std::io::Error> {
        Self::contain(true)
    }

    fn contain(external_handoffs: bool) -> Result<Self, std::io::Error> {
        // SAFETY: all pointers reference initialized values of the exact Win32
        // structures for the duration of each call; ownership of the returned
        // handle transfers to this guard.
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(std::io::Error::last_os_error());
            }
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if external_handoffs {
                limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_BREAKAWAY_OK;
            }
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(error);
            }
            if AssignProcessToJobObject(handle, GetCurrentProcess()) == 0 {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(error);
            }
            Ok(Self { handle })
        }
    }
}

impl Drop for ProviderJobGuard {
    fn drop(&mut self) {
        // SAFETY: the guard uniquely owns this valid job handle.
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

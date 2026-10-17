//! Read-only Windows registry string lookups behind an injectable seam.
//!
//! Environment checks observe well-known registry values (Steam install
//! path, the active OpenXR runtime, OS and GPU identity) the same way they
//! observe file roots: through a source that production points at the real
//! registry and tests point at synthetic entries, so no test depends on
//! this machine (ORC-TST-006). Lookups are string values only, read-only,
//! and a missing value is `None` — a normal finding, never an error.

use std::collections::HashMap;

/// The registry hives environment checks read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RegistryHive {
    LocalMachine,
    CurrentUser,
}

/// Injectable registry view. `None` means "value absent", which the caller
/// treats as a deterministic missing finding.
pub trait RegistrySource: Send + Sync + std::fmt::Debug {
    fn get_string(&self, hive: RegistryHive, subkey: &str, value: &str) -> Option<String>;

    /// Names of the direct child keys of `subkey`; an absent key has none.
    fn subkeys(&self, _hive: RegistryHive, _subkey: &str) -> Vec<String> {
        Vec::new()
    }
}

/// Production source backed by the real Windows registry.
#[derive(Debug, Clone, Copy, Default)]
pub struct WindowsRegistrySource;

impl RegistrySource for WindowsRegistrySource {
    fn get_string(&self, hive: RegistryHive, subkey: &str, value: &str) -> Option<String> {
        windows_get_string(hive, subkey, value)
    }

    fn subkeys(&self, hive: RegistryHive, subkey: &str) -> Vec<String> {
        windows_subkeys(hive, subkey)
    }
}

/// Synthetic source for tests: exact `(hive, subkey, value)` entries.
#[derive(Debug, Clone, Default)]
pub struct FakeRegistrySource {
    entries: HashMap<(RegistryHive, String, String), String>,
    children: HashMap<(RegistryHive, String), Vec<String>>,
}

impl FakeRegistrySource {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with(mut self, hive: RegistryHive, subkey: &str, value: &str, data: &str) -> Self {
        self.entries.insert(
            (hive, subkey.to_owned(), value.to_owned()),
            data.to_owned(),
        );
        self
    }

    pub fn with_subkey(mut self, hive: RegistryHive, parent: &str, child: &str) -> Self {
        self.children
            .entry((hive, parent.to_owned()))
            .or_default()
            .push(child.to_owned());
        self
    }
}

impl RegistrySource for FakeRegistrySource {
    fn get_string(&self, hive: RegistryHive, subkey: &str, value: &str) -> Option<String> {
        self.entries
            .get(&(hive, subkey.to_owned(), value.to_owned()))
            .cloned()
    }

    fn subkeys(&self, hive: RegistryHive, subkey: &str) -> Vec<String> {
        self.children
            .get(&(hive, subkey.to_owned()))
            .cloned()
            .unwrap_or_default()
    }
}

#[cfg(windows)]
fn windows_subkeys(hive: RegistryHive, subkey: &str) -> Vec<String> {
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
        KEY_READ,
    };

    const ERROR_SUCCESS: u32 = 0;
    const MAX_KEYS: u32 = 4096;
    let root = match hive {
        RegistryHive::LocalMachine => HKEY_LOCAL_MACHINE,
        RegistryHive::CurrentUser => HKEY_CURRENT_USER,
    };
    let subkey_wide: Vec<u16> = {
        use std::os::windows::ffi::OsStrExt as _;
        std::ffi::OsStr::new(subkey)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let mut key: HKEY = std::ptr::null_mut();
    if unsafe { RegOpenKeyExW(root, subkey_wide.as_ptr(), 0, KEY_READ, &mut key) } != ERROR_SUCCESS
    {
        return Vec::new();
    }
    let mut names = Vec::new();
    for index in 0..MAX_KEYS {
        // Registry key names are at most 255 characters.
        let mut name = [0u16; 256];
        let mut length = name.len() as u32;
        let status = unsafe {
            RegEnumKeyExW(
                key,
                index,
                name.as_mut_ptr(),
                &mut length,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            break;
        }
        names.push(String::from_utf16_lossy(&name[..length as usize]));
    }
    unsafe { RegCloseKey(key) };
    names
}

#[cfg(not(windows))]
fn windows_subkeys(_hive: RegistryHive, _subkey: &str) -> Vec<String> {
    Vec::new()
}

#[cfg(windows)]
fn windows_get_string(hive: RegistryHive, subkey: &str, value: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };

    const ERROR_SUCCESS: u32 = 0;
    const BUFFER_U16: usize = 16 * 1024;

    let hkey = match hive {
        RegistryHive::LocalMachine => HKEY_LOCAL_MACHINE,
        RegistryHive::CurrentUser => HKEY_CURRENT_USER,
    };
    let wide = |text: &str| -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt as _;
        std::ffi::OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    };
    let subkey_wide = wide(subkey);
    let value_wide = wide(value);
    let mut buffer = [0u16; BUFFER_U16];
    let mut byte_length = (buffer.len() * std::mem::size_of::<u16>()) as u32;
    let status = unsafe {
        RegGetValueW(
            hkey,
            subkey_wide.as_ptr(),
            value_wide.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut byte_length,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let len = byte_length as usize / std::mem::size_of::<u16>();
    let len = len.min(BUFFER_U16);
    let mut end = len;
    while end > 0 && buffer[end - 1] == 0 {
        end -= 1;
    }
    Some(String::from_utf16_lossy(&buffer[..end]))
}

#[cfg(not(windows))]
fn windows_get_string(_hive: RegistryHive, _subkey: &str, _value: &str) -> Option<String> {
    None
}

//! Windows trust boundary for N1. Verify Authenticode and the leaf signer's common name
//! without launching PowerShell or trusting a file's name/version metadata as a signature.
//! Unknown publishers, unavailable trust providers and non-Windows hosts fail closed.
use std::path::Path;

pub(super) fn trusted_unity_executable(path: &Path) -> bool {
    path.is_absolute() && path.is_file() && unity_signature(path, false)
}

/// China publisher admission is specific to the pinned Editor installer. It does
/// not grant that publisher authority over the standalone CLI or Hub bootstrap.
pub(super) fn trusted_editor_installer(path: &Path, china: bool) -> bool {
    path.is_absolute() && path.is_file() && unity_signature(path, china)
}

/// The Steam bootstrapper is unversioned: the pinned host plus this exact leaf
/// signer are the whole trust decision (no content digest can be pinned).
pub(super) fn trusted_steam_installer(path: &Path) -> bool {
    path.is_absolute() && path.is_file() && signature_leaf_cn_matches(path, &["Valve Corp."])
}

/// PICO Connect's publisher of record is ByteDance's Douyin Vision; admission is
/// this exact leaf signer on top of the pinned version, size and SHA-256.
pub(super) fn trusted_pico_installer(path: &Path) -> bool {
    path.is_absolute()
        && path.is_file()
        && signature_leaf_cn_matches(path, &["Douyin Vision Co., Ltd."])
}

fn unity_signature(path: &Path, china: bool) -> bool {
    signature_leaf_cn_matches(
        path,
        if china {
            &["优三缔科技（上海）有限公司"][..]
        } else {
            &["Unity Technologies ApS", "Unity Technologies SF"][..]
        },
    )
}

#[cfg(not(windows))]
fn signature_leaf_cn_matches(_path: &Path, _accepted: &[&str]) -> bool {
    false
}

#[cfg(windows)]
fn signature_leaf_cn_matches(path: &Path, accepted: &[&str]) -> bool {
    use std::{mem::size_of, os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Security::{
        Cryptography::{szOID_COMMON_NAME, CertGetNameStringW, CERT_NAME_ATTR_TYPE},
        WinTrust::{
            WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain,
            WTHelperProvDataFromStateData, WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2,
            WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL,
            WTD_CHOICE_FILE, WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT, WTD_STATEACTION_CLOSE,
            WTD_STATEACTION_VERIFY, WTD_UI_NONE,
        },
    };
    let wide: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut info = WINTRUST_FILE_INFO {
        cbStruct: size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: wide.as_ptr(),
        ..Default::default()
    };
    let mut data = WINTRUST_DATA {
        cbStruct: size_of::<WINTRUST_DATA>() as u32,
        dwUIChoice: WTD_UI_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 { pFile: &mut info },
        dwStateAction: WTD_STATEACTION_VERIFY,
        // Planning must not block on certificate-network access. Missing cached trust data
        // refuses automatic installation and preserves the official manual route.
        dwProvFlags: WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT | WTD_CACHE_ONLY_URL_RETRIEVAL,
        ..Default::default()
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    // SAFETY: file path and all WinTrust structs outlive VERIFY and CLOSE. The provider
    // owns certificate pointers; they are used only before CLOSE and checked for null.
    let status = unsafe {
        WinVerifyTrust(
            ptr::null_mut(),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        )
    };
    let verified = status == 0
        && unsafe {
            let provider = WTHelperProvDataFromStateData(data.hWVTStateData);
            if provider.is_null() {
                false
            } else {
                let signer = WTHelperGetProvSignerFromChain(provider, 0, 0, 0);
                if signer.is_null() {
                    false
                } else {
                    let cert = WTHelperGetProvCertFromChain(signer, 0);
                    if cert.is_null() || (*cert).pCert.is_null() {
                        false
                    } else {
                        let mut name = [0u16; 256];
                        let size = CertGetNameStringW(
                            (*cert).pCert,
                            CERT_NAME_ATTR_TYPE,
                            0,
                            szOID_COMMON_NAME.cast(),
                            name.as_mut_ptr(),
                            name.len() as u32,
                        );
                        // A bounded complete CN, never a substring match or issuer identity.
                        size > 1
                            && size < name.len() as u32
                            && String::from_utf16(&name[..size as usize - 1])
                                .is_ok_and(|cn| accepted.iter().any(|expected| cn == *expected))
                    }
                }
            }
        };
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    // SAFETY: CLOSE releases provider state even when verification failed.
    unsafe {
        WinVerifyTrust(
            ptr::null_mut(),
            &mut action,
            (&mut data as *mut WINTRUST_DATA).cast(),
        );
    }
    verified
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_missing_or_relative_executable_is_trusted() {
        assert!(!trusted_unity_executable(Path::new("Unity Hub.exe")));
        assert!(!trusted_unity_executable(
            &std::env::temp_dir().join("vua-no-such-hub.exe")
        ));
    }
    #[test]
    fn synthetic_unsigned_executable_is_refused_without_running_it() {
        let path =
            std::env::temp_dir().join(format!("vua-unsigned-hub-{}.exe", std::process::id()));
        std::fs::write(&path, b"synthetic unsigned data").unwrap();
        assert!(!trusted_unity_executable(&path));
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn vendor_installers_refuse_missing_relative_and_unsigned_bytes() {
        assert!(!trusted_steam_installer(Path::new("SteamSetup.exe")));
        assert!(!trusted_pico_installer(Path::new("PICOConnect.exe")));
        let path =
            std::env::temp_dir().join(format!("vua-unsigned-vendor-{}.exe", std::process::id()));
        std::fs::write(&path, b"synthetic unsigned installer").unwrap();
        let absolute = std::fs::canonicalize(&path).unwrap();
        assert!(!trusted_steam_installer(&absolute));
        assert!(!trusted_pico_installer(&absolute));
        std::fs::remove_file(path).unwrap();
    }
    /// Real-machine check against an officially obtained installer, e.g.
    /// `VUA_TEST_STEAM_INSTALLER=C:\...\SteamSetup.exe cargo test -p vua-project-manager
    /// real_vendor_signatures -- --ignored`. CI runs the refusal cases only.
    #[test]
    #[ignore = "real-machine acceptance: needs the official installer bytes via env var"]
    fn real_vendor_signatures_match_only_their_own_publisher() {
        let steam = std::env::var_os("VUA_TEST_STEAM_INSTALLER");
        let pico = std::env::var_os("VUA_TEST_PICO_INSTALLER");
        assert!(
            steam.is_some() || pico.is_some(),
            "provide at least one official installer path"
        );
        if let Some(path) = steam {
            let path = Path::new(&path);
            assert!(trusted_steam_installer(path));
            assert!(!trusted_pico_installer(path));
        }
        if let Some(path) = pico {
            let path = Path::new(&path);
            assert!(trusted_pico_installer(path));
            assert!(!trusted_steam_installer(path));
        }
    }
}

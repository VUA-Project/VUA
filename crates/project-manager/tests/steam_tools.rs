//! Synthetic libraries only; no Steam invocation or modification of user files.
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use vua_project_manager::steam_tools::inspect_libraries;
static SEQ: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "vua-tool-library-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("steamapps/common/VRCFaceTracking")).unwrap();
        Self(root)
    }
    fn common(&self) -> PathBuf {
        self.0.join("steamapps/common")
    }
    fn manifest(&self, flags: &str) {
        fs::write(self.0.join("steamapps/appmanifest_3329480.acf"), format!("\"AppState\" {{ \"appid\" \"3329480\" \"StateFlags\" \"{flags}\" \"installdir\" \"VRCFaceTracking\" \"buildid\" \"123\" }}")).unwrap();
    }
    fn exe(&self) {
        let mut bytes = vec![0; 64];
        bytes[..2].copy_from_slice(b"MZ");
        fs::write(
            self.common().join("VRCFaceTracking/VRCFaceTracking.exe"),
            bytes,
        )
        .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.0.starts_with(std::env::temp_dir()));
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn completed_manifest_and_executable_are_both_required_in_any_library() {
    let first = Fixture::new();
    let second = Fixture::new();
    second.manifest("4");
    second.exe();
    let complete = inspect_libraries(&[first.common(), second.common()], true, false);
    assert_eq!(complete.presence, "installed");
    assert_eq!(complete.build_id.as_deref(), Some("123"));
    assert_eq!(
        complete.executable,
        Some(second.common().join("VRCFaceTracking/VRCFaceTracking.exe"))
    );
    assert_eq!(
        inspect_libraries(&[first.common()], true, false).presence,
        "incomplete"
    );
    first.manifest("4");
    assert_eq!(
        inspect_libraries(&[first.common()], true, false).presence,
        "incomplete"
    );
    first.exe();
    first.manifest("1026");
    assert_eq!(
        inspect_libraries(&[first.common()], true, false).presence,
        "incomplete"
    );
    first.manifest("4");
    fs::write(
        first.common().join("VRCFaceTracking/VRCFaceTracking.exe"),
        [],
    )
    .unwrap();
    assert_eq!(
        inspect_libraries(&[first.common()], true, false).presence,
        "incomplete"
    );
}
#[test]
fn absent_unreadable_and_untrusted_metadata_do_not_become_installed() {
    let fixture = Fixture::new();
    fixture.exe();
    assert_eq!(inspect_libraries(&[], false, false).presence, "missing");
    assert_eq!(inspect_libraries(&[], true, true).presence, "unknown");
    for text in [
        "\"appid\" \"123\" \"StateFlags\" \"4\" \"installdir\" \"VRCFaceTracking\"",
        "\"appid\" \"3329480\" \"StateFlags\" \"4\" \"installdir\" \"../outside\"",
        "\"appid\" \"3329480\" \"StateFlags\" \"4\" \"installdir\" \"C:\\private\"",
        "\"appid\" \"3329480\" \"appid\" \"3329480\" \"StateFlags\" \"4\" \"installdir\" \"VRCFaceTracking\"",
    ] { fs::write(fixture.0.join("steamapps/appmanifest_3329480.acf"), text).unwrap(); assert_eq!(inspect_libraries(&[fixture.common()], true, false).presence, "unknown"); }
    fs::write(
        fixture.0.join("steamapps/appmanifest_3329480.acf"),
        [255, 254],
    )
    .unwrap();
    assert_eq!(
        inspect_libraries(&[fixture.common()], true, false).presence,
        "unknown"
    );
}

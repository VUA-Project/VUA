//! Synthetic libraries only; no Steam invocation or modification of user files.
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use vua_orchestrator::external_tools::{steam_tool_spec, SteamToolSpec};
use vua_project_manager::steam_tools::inspect_libraries;
static SEQ: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    root: PathBuf,
    spec: &'static SteamToolSpec,
}
impl Fixture {
    fn new(spec: &'static SteamToolSpec) -> Self {
        let root = std::env::temp_dir().join(format!(
            "vua-tool-library-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("steamapps/common").join(spec.install_dir)).unwrap();
        Self { root, spec }
    }
    fn common(&self) -> PathBuf {
        self.root.join("steamapps/common")
    }
    fn manifest_path(&self) -> PathBuf {
        self.root
            .join(format!("steamapps/appmanifest_{}.acf", self.spec.app_id))
    }
    fn manifest(&self, flags: &str) {
        fs::write(self.manifest_path(), format!("\"AppState\" {{ \"appid\" \"{}\" \"StateFlags\" \"{flags}\" \"installdir\" \"{}\" \"buildid\" \"123\" }}", self.spec.app_id, self.spec.install_dir)).unwrap();
    }
    fn exe(&self) {
        let path = self
            .common()
            .join(self.spec.install_dir)
            .join(self.spec.exe_name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut bytes = vec![0; 64];
        bytes[..2].copy_from_slice(b"MZ");
        fs::write(path, bytes).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self.root.starts_with(std::env::temp_dir()));
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn vrcft() -> &'static SteamToolSpec {
    steam_tool_spec("vrcft").unwrap()
}
fn space() -> &'static SteamToolSpec {
    steam_tool_spec("space").unwrap()
}
fn toolkit() -> &'static SteamToolSpec {
    steam_tool_spec("toolkit").unwrap()
}
#[test]
fn the_toolkit_launcher_executable_lives_under_a_subdirectory() {
    let fixture = Fixture::new(toolkit());
    fixture.manifest("4");
    fixture.exe();
    let installed = inspect_libraries(&[fixture.common()], true, false, toolkit());
    assert_eq!(installed.presence, "installed");
    assert_eq!(installed.build_id.as_deref(), Some("123"));
    assert_eq!(
        installed.executable,
        Some(
            fixture
                .common()
                .join("OVR Toolkit/Launcher/OVR Toolkit Launcher.exe")
        )
    );
}
#[test]
fn completed_manifest_and_executable_are_both_required_in_any_library() {
    let first = Fixture::new(vrcft());
    let second = Fixture::new(vrcft());
    second.manifest("4");
    second.exe();
    let complete = inspect_libraries(&[first.common(), second.common()], true, false, vrcft());
    assert_eq!(complete.presence, "installed");
    assert_eq!(complete.build_id.as_deref(), Some("123"));
    assert_eq!(
        complete.executable,
        Some(second.common().join("VRCFaceTracking/VRCFaceTracking.exe"))
    );
    assert_eq!(
        inspect_libraries(&[first.common()], true, false, vrcft()).presence,
        "incomplete"
    );
    first.manifest("4");
    assert_eq!(
        inspect_libraries(&[first.common()], true, false, vrcft()).presence,
        "incomplete"
    );
    first.exe();
    first.manifest("1026");
    assert_eq!(
        inspect_libraries(&[first.common()], true, false, vrcft()).presence,
        "incomplete"
    );
    first.manifest("4");
    fs::write(
        first.common().join("VRCFaceTracking/VRCFaceTracking.exe"),
        [],
    )
    .unwrap();
    assert_eq!(
        inspect_libraries(&[first.common()], true, false, vrcft()).presence,
        "incomplete"
    );
}
#[test]
fn absent_unreadable_and_untrusted_metadata_do_not_become_installed() {
    for spec in [vrcft(), space()] {
        let fixture = Fixture::new(spec);
        fixture.exe();
        assert_eq!(
            inspect_libraries(&[], false, false, spec).presence,
            "missing"
        );
        assert_eq!(
            inspect_libraries(&[], true, true, spec).presence,
            "unknown"
        );
        for text in [
            format!("\"appid\" \"123\" \"StateFlags\" \"4\" \"installdir\" \"{}\"", spec.install_dir),
            format!("\"appid\" \"{}\" \"StateFlags\" \"4\" \"installdir\" \"../outside\"", spec.app_id),
            format!("\"appid\" \"{}\" \"StateFlags\" \"4\" \"installdir\" \"C:\\private\"", spec.app_id),
            format!("\"appid\" \"{0}\" \"appid\" \"{0}\" \"StateFlags\" \"4\" \"installdir\" \"{1}\"", spec.app_id, spec.install_dir),
        ] { fs::write(fixture.manifest_path(), text).unwrap(); assert_eq!(inspect_libraries(&[fixture.common()], true, false, spec).presence, "unknown"); }
        fs::write(fixture.manifest_path(), [255, 254]).unwrap();
        assert_eq!(
            inspect_libraries(&[fixture.common()], true, false, spec).presence,
            "unknown"
        );
    }
}
#[test]
fn a_second_fixed_tool_uses_only_its_own_manifest_directory_and_executable() {
    let fixture = Fixture::new(space());
    // A leftover directory without a manifest is never a completed install.
    assert_eq!(
        inspect_libraries(&[fixture.common()], true, false, space()).presence,
        "incomplete"
    );
    fixture.manifest("1026");
    fixture.exe();
    assert_eq!(
        inspect_libraries(&[fixture.common()], true, false, space()).presence,
        "incomplete"
    );
    fixture.manifest("4");
    let installed = inspect_libraries(&[fixture.common()], true, false, space());
    assert_eq!(installed.presence, "installed");
    assert_eq!(installed.build_id.as_deref(), Some("123"));
    assert_eq!(
        installed.executable,
        Some(fixture.common().join("01spacecalibrator/SpaceCalibrator.exe"))
    );
    // A complete space installation answers nothing about another tool.
    assert_eq!(
        inspect_libraries(&[fixture.common()], true, false, vrcft()).presence,
        "missing"
    );
}

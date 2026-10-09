use super::*;
use crate::test_support::unique_dir;
use vua_bdl_store::{ArtifactInspectionState, CopyRole, NewLocalArtifact};

fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
    fs::write(path, zip_bytes(files)).unwrap();
}
fn zip_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in files {
        zip.start_file(
            *name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}
struct Fixture {
    root: PathBuf,
    store: BdlStore,
    parent: StoredArtifactCopy,
}
impl Fixture {
    fn new(files: &[(&str, &[u8])]) -> Self {
        Self::from_bytes(&zip_bytes(files))
    }
    fn from_bytes(bytes: &[u8]) -> Self {
        let root = unique_dir("vua-zip", "root");
        let store = BdlStore::open(root.join("library.db")).unwrap();
        let item = store
            .create_warehouse_item("synthetic", "imported_material", "now")
            .unwrap();
        let folder = root.join(&item.folder_name);
        fs::create_dir(&folder).unwrap();
        let path = folder.join("bundle.zip");
        fs::write(&path, bytes).unwrap();
        let sha = digest(&path, &|| false).unwrap();
        store
            .record_untrusted_artifact(&NewLocalArtifact {
                artifact_sha256: sha.clone(),
                size_bytes: fs::metadata(&path).unwrap().len(),
                suggested_file_name: Some("bundle.zip".into()),
                download_id: None,
                first_seen_at: "now".into(),
            })
            .unwrap();
        store
            .transition_artifact(&sha, ArtifactInspectionState::Inspected, "now", None)
            .unwrap();
        let parent = store
            .record_artifact_copy(
                &item.warehouse_item_id,
                &sha,
                "bundle.zip",
                &path.to_string_lossy(),
                CopyRole::Original,
                "now",
            )
            .unwrap();
        Self {
            root,
            store,
            parent,
        }
    }
    fn expand(&self) -> ExpansionReport {
        expand(
            &self.store,
            &self.root,
            &self.parent,
            "now",
            &|| false,
            &|_, _| {},
        )
    }
    fn target(&self) -> PathBuf {
        Path::new(&self.parent.stored_path)
            .parent()
            .unwrap()
            .join("expanded")
            .join(&self.parent.copy_id)
    }
}

#[test]
fn expansion_retains_archive_and_all_member_formats_with_directory_structure() {
    let f = Fixture::new(&[
        ("日本語/Avatar.unitypackage", b"synthetic package"),
        ("日本語/texture.psd", b"synthetic psd"),
        ("README", b"instructions"),
        ("shots/screen.jpg", b"image"),
    ]);
    let original = fs::read(&f.parent.stored_path).unwrap();
    let result = f.expand();
    assert_eq!(result.state, "expanded");
    assert_eq!(result.files, 4);
    assert_eq!(result.unitypackage_candidates, 1);
    assert_eq!(fs::read(&f.parent.stored_path).unwrap(), original);
    assert_eq!(
        fs::read(f.target().join("日本語/texture.psd")).unwrap(),
        b"synthetic psd"
    );
    let members = f.store.archive_members(&f.parent.copy_id).unwrap();
    assert_eq!(members.len(), 4);
    assert!(members
        .iter()
        .all(|m| m.parent_sha256 == f.parent.artifact_sha256));
    assert!(f
        .store
        .library_copy_evidence()
        .unwrap()
        .iter()
        .all(|c| c.copy.role == CopyRole::Original));
    // Idempotent retry does not create extra physical copies or ledger rows.
    let ids: Vec<_> = members.iter().map(|m| &m.copy_id).collect();
    assert_eq!(f.expand().state, "expanded");
    let retried = f.store.archive_members(&f.parent.copy_id).unwrap();
    assert_eq!(ids, retried.iter().map(|m| &m.copy_id).collect::<Vec<_>>());
}

#[test]
fn unsafe_paths_and_case_aliases_never_publish_a_partial_tree() {
    for name in [
        "../escape.txt",
        "C:/escape.txt",
        "/escape.txt",
        "dir\\..\\escape.txt",
        "dir/a:stream",
        "NUL.txt",
        "dir/file.",
        "dir/file ",
    ] {
        let f = Fixture::new(&[("valid.txt", b"retained only if all safe"), (name, b"bad")]);
        assert_eq!(
            f.expand().error_code.as_deref(),
            Some("vua.library.zip_unsafe_path"),
            "{name}"
        );
        assert!(!f.target().exists());
        assert!(Path::new(&f.parent.stored_path).is_file());
        assert!(f
            .store
            .archive_members(&f.parent.copy_id)
            .unwrap()
            .is_empty());
    }
    for files in [
        vec![("A.txt", b"a".as_slice()), ("a.txt", b"b".as_slice())],
        vec![("dir", b"a".as_slice()), ("dir/file", b"b".as_slice())],
    ] {
        let f = Fixture::new(&files);
        assert_eq!(
            f.expand().error_code.as_deref(),
            Some("vua.library.zip_path_collision")
        );
        assert!(!f.target().exists());
    }
}

#[test]
fn expansion_limit_and_midstream_cancellation_keep_only_the_original() {
    let f = Fixture::new(&[("large.bin", &[42; 4096])]);
    assert_eq!(
        expand_inner(
            &f.store,
            &f.root,
            &f.parent,
            "now",
            &|| false,
            &|_, _| {},
            100
        ),
        Err("zip_limit_exceeded")
    );
    let calls = std::cell::Cell::new(0);
    let cancelled = || {
        calls.set(calls.get() + 1);
        calls.get() > 6
    };
    assert_eq!(
        expand(&f.store, &f.root, &f.parent, "now", &cancelled, &|_, _| {}).state,
        "cancelled"
    );
    assert!(!f.target().exists());
    assert!(f
        .store
        .archive_members(&f.parent.copy_id)
        .unwrap()
        .is_empty());
}

#[test]
fn changed_or_unregistered_expansion_files_are_preserved() {
    let f = Fixture::new(&[("texture.psd", b"original")]);
    assert_eq!(f.expand().state, "expanded");
    let path = f.target().join("texture.psd");
    fs::write(&path, b"useredit").unwrap();
    assert_eq!(
        f.expand().error_code.as_deref(),
        Some("vua.library.expansion_content_changed")
    );
    assert_eq!(fs::read(path).unwrap(), b"useredit");
}

#[test]
fn corrupt_crc_is_an_expansion_failure_while_the_archive_remains_stored() {
    let mut bytes = zip_bytes(&[("file.txt", b"unique-payload")]);
    let index = bytes
        .windows(14)
        .position(|w| w == b"unique-payload")
        .unwrap();
    bytes[index] ^= 1;
    let f = Fixture::from_bytes(&bytes);
    assert_eq!(
        f.expand().error_code.as_deref(),
        Some("vua.library.zip_invalid")
    );
    assert!(!f.target().exists());
    assert!(Path::new(&f.parent.stored_path).is_file());
}

#[test]
fn ledger_conflict_rolls_back_the_published_tree_and_keeps_prior_member_rows() {
    let mut f = Fixture::new(&[
        ("file.txt", b"old"),
        ("removed.txt", b"retain until commit"),
    ]);
    assert_eq!(f.expand().state, "expanded");
    let ids: Vec<_> = f
        .store
        .archive_members(&f.parent.copy_id)
        .unwrap()
        .into_iter()
        .map(|m| m.copy_id)
        .collect();
    write_zip(
        Path::new(&f.parent.stored_path),
        &[("file.txt", b"new"), ("new.txt", b"new member")],
    );
    // Simulate a parent binding changed between planning and publication.
    f.parent.artifact_sha256 = digest(Path::new(&f.parent.stored_path), &|| false).unwrap();
    assert_eq!(
        f.expand().error_code.as_deref(),
        Some("vua.library.expansion_state_unconfirmed")
    );
    assert_eq!(fs::read(f.target().join("file.txt")).unwrap(), b"old");
    assert!(f.target().join("removed.txt").is_file());
    assert!(!f.target().join("new.txt").exists());
    assert_eq!(
        ids,
        f.store
            .archive_members(&f.parent.copy_id)
            .unwrap()
            .into_iter()
            .map(|m| m.copy_id)
            .collect::<Vec<_>>()
    );
    // A restart reads the prior committed lineage without resuming extraction.
    let reopened = BdlStore::open(f.root.join("library.db")).unwrap();
    assert_eq!(
        reopened.archive_members(&f.parent.copy_id).unwrap().len(),
        2
    );
}

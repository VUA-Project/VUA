//! Project tree fingerprints: the uncached v1 value is locked byte for byte, and the
//! cached v2 algorithm reuses per-file hashes without missing a change.
#![allow(clippy::result_large_err)]
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use vua_orchestrator::{project_tree_fingerprint, project_tree_fingerprint_cached, FINGERPRINT_V2_PREFIX};

const SCOPES: [&str; 3] = ["Assets", "Packages", "ProjectSettings"];
/// The locked value of `locked_tree()` under the v1 algorithm and under v2, computed
/// from the same files; any change to either algorithm changes its value.
const LOCKED_V1: &str = "sha256:4b9cd1c6a41e6bfdaca0ac888e64b10706ceeff5831a3ceb5413a19e8b94dd71";
const LOCKED_V2: &str = "vua-project-tree-v2:b51ec491ecf43bdccf41f768498d560d4bc1cbbb46648d15dcf08db2a1bac7b9";

fn temp_project(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "vua-fingerprint-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    root
}

/// A small fixed project; both algorithms cover the same three scopes.
fn locked_tree(root: &Path) {
    fs::create_dir_all(root.join("Assets")).unwrap();
    fs::create_dir_all(root.join("Packages")).unwrap();
    fs::create_dir_all(root.join("ProjectSettings")).unwrap();
    fs::write(root.join("Assets/Meiyun.prefab"), "avatar\n").unwrap();
    fs::write(root.join("Assets/Tshirt.mat"), "material\n").unwrap();
    fs::write(root.join("Packages/vpm-manifest.json"), "{}\n").unwrap();
    fs::write(root.join("ProjectSettings/ProjectVersion.txt"), "m_EditorVersion: 2022.3.22f1\n").unwrap();
}

/// Two writes must land on different modification times, or the cache could rightly
/// reuse the first hash.
fn settle() {
    std::thread::sleep(Duration::from_millis(50));
}

fn v1(root: &Path) -> String {
    project_tree_fingerprint(root, &SCOPES).unwrap().expect("project exists")
}

fn v2(root: &Path) -> String {
    project_tree_fingerprint_cached(root, &SCOPES).unwrap().expect("project exists")
}

#[test]
fn the_v1_value_is_locked_and_v2_names_its_own_algorithm() {
    let root = temp_project("locked");
    locked_tree(&root);
    assert_eq!(v1(&root), LOCKED_V1, "the v1 value that assembly and older records rely on must not change");
    assert_eq!(v2(&root), LOCKED_V2, "the v2 value over the same files is part of this algorithm's record");
    assert!(v2(&root).starts_with(FINGERPRINT_V2_PREFIX));
    assert_ne!(v1(&root), v2(&root));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn an_unchanged_project_fingerprints_identically_from_the_cache() {
    let root = temp_project("stable");
    locked_tree(&root);
    assert_eq!(v2(&root), v2(&root));
    // The cache lives outside the fingerprinted scopes, so it cannot change the value.
    let cache = root.join(".vua/fingerprint-cache.json");
    assert!(cache.is_file(), "a successful run writes the cache");
    fs::remove_file(&cache).unwrap();
    assert_eq!(v2(&root), LOCKED_V2);
    let document: serde_json::Value = serde_json::from_slice(&fs::read(&cache).unwrap()).unwrap();
    assert_eq!(document["version"], 2);
    assert_eq!(document["files"].as_object().unwrap().len(), 4);
    assert!(!root.join(".vua/fingerprint-cache.json.pending").exists(), "the cache write is atomic");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn changed_contents_sizes_new_deleted_and_renamed_files_change_the_v2_value() {
    let root = temp_project("changes");
    locked_tree(&root);
    let first = v2(&root);

    // Same size, different bytes: only the modification time moves.
    settle();
    fs::write(root.join("Assets/Meiyun.prefab"), "ovatar\n").unwrap();
    let second = v2(&root);
    assert_ne!(first, second, "a same-size content change is a different file");

    settle();
    fs::write(root.join("Assets/Meiyun.prefab"), "ovatar\nx").unwrap();
    let third = v2(&root);
    assert_ne!(second, third, "a size change is a different file");

    settle();
    fs::write(root.join("Assets/New.meta"), "new\n").unwrap();
    let fourth = v2(&root);
    assert_ne!(third, fourth, "a new file changes the project");

    settle();
    fs::remove_file(root.join("Assets/New.meta")).unwrap();
    let fifth = v2(&root);
    assert_ne!(fourth, fifth, "a deleted file changes the project");
    assert_eq!(fifth, third, "the same content has the same value, whatever its times");

    settle();
    fs::rename(root.join("Assets/Tshirt.mat"), root.join("Assets/Shirt.mat")).unwrap();
    let sixth = v2(&root);
    assert_ne!(fifth, sixth, "a renamed file changes the project");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_cache_entry_is_reused_until_its_file_moves_then_recomputed() {
    let root = temp_project("reuse");
    locked_tree(&root);
    let real = v2(&root);
    let cache = root.join(".vua/fingerprint-cache.json");

    // A stored hash the file still matches by size and time is trusted as-is.
    let mut document: serde_json::Value = serde_json::from_slice(&fs::read(&cache).unwrap()).unwrap();
    document["files"]["Assets/Meiyun.prefab"]["sha256"] = "0".repeat(64).into();
    fs::write(&cache, serde_json::to_vec_pretty(&document).unwrap()).unwrap();
    let tampered = v2(&root);
    assert_ne!(tampered, real, "an unchanged file's hash comes from the cache");

    // Once the file is written again, its fresh hash replaces the tampered entry.
    settle();
    fs::write(root.join("Assets/Meiyun.prefab"), "avatar\n").unwrap();
    assert_eq!(v2(&root), real);
    let document: serde_json::Value = serde_json::from_slice(&fs::read(&cache).unwrap()).unwrap();
    let stored = document["files"]["Assets/Meiyun.prefab"]["sha256"].as_str().expect("stored hash");
    assert_ne!(stored, "0".repeat(64));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_damaged_future_or_oversized_cache_counts_as_absent() {
    let root = temp_project("damaged");
    locked_tree(&root);
    assert_eq!(v2(&root), LOCKED_V2);
    let cache = root.join(".vua/fingerprint-cache.json");

    for damaged in [
        b"not json at all".to_vec(),
        br#"{"version":99,"files":{}}"#.to_vec(),
        br#"{"files":{}}"#.to_vec(),
        vec![0_u8; 16 * 1024 * 1024 + 1],
    ] {
        fs::write(&cache, &damaged).unwrap();
        assert_eq!(v2(&root), LOCKED_V2, "the value never depends on the cache");
    }
    // A cache naming a file that no longer exists is skipped without failing.
    fs::write(
        &cache,
        br#"{"version":2,"files":{"Assets/Gone.prefab":{"size":1,"modifiedSecs":1,"modifiedNanos":1,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}}}"#,
    )
    .unwrap();
    assert_eq!(v2(&root), LOCKED_V2);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn the_v2_walk_refuses_symbolic_links_like_v1() {
    let root = temp_project("symlink");
    locked_tree(&root);
    let outside = temp_project("outside");
    fs::write(outside.join("secret"), "outside\n").unwrap();
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file(outside.join("secret"), root.join("Assets/link.prefab"));
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(outside.join("secret"), root.join("Assets/link.prefab"));
    // Creating the link needs a privilege this run may not have; both algorithms share
    // the refusing walk either way.
    if linked.is_ok() {
        assert!(project_tree_fingerprint_cached(&root, &SCOPES).is_err());
        assert!(project_tree_fingerprint(&root, &SCOPES).is_err());
    }
    fs::remove_dir_all(&root).unwrap();
    fs::remove_dir_all(&outside).unwrap();
}

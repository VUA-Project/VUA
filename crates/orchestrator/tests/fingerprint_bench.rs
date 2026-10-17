//! Timing of the fingerprint algorithms against a real AMF work project. Ignored by
//! default: the run writes `<project>/.vua/fingerprint-cache.json` and changes one
//! file, so point `VUA_FINGERPRINT_PROJECT` at a writable copy of a project and run
//! `cargo test -p vua-orchestrator --test fingerprint_bench -- --ignored --nocapture`.
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use vua_orchestrator::{project_tree_fingerprint, project_tree_fingerprint_cached};

const SCOPES: [&str; 3] = ["Assets", "Packages", "ProjectSettings"];

fn count_files(root: &Path) -> usize {
    let mut count = 0;
    let mut stack: Vec<PathBuf> = SCOPES.iter().map(|scope| root.join(scope)).collect();
    while let Some(path) = stack.pop() {
        if let Ok(entries) = fs::read_dir(&path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                } else {
                    count += 1;
                }
            }
        }
    }
    count
}

fn first_asset(root: &Path) -> PathBuf {
    let mut stack: Vec<PathBuf> = vec![root.join("Assets")];
    while let Some(directory) = stack.pop() {
        let mut entries: Vec<_> = fs::read_dir(&directory).unwrap().flatten().map(|e| e.path()).collect();
        entries.sort();
        for path in entries {
            if path.is_file() {
                return path;
            }
            stack.push(path);
        }
    }
    panic!("the project has no file under Assets");
}

#[test]
#[ignore = "needs VUA_FINGERPRINT_PROJECT pointing at a writable project copy"]
fn times_the_legacy_and_cached_fingerprints_on_a_real_project() {
    let project = PathBuf::from(std::env::var("VUA_FINGERPRINT_PROJECT").expect(
        "Set VUA_FINGERPRINT_PROJECT to a writable copy of a work project; the real project stays untouched.",
    ));
    assert!(project.is_dir(), "{} is not a directory", project.display());
    let cache = project.join(".vua/fingerprint-cache.json");
    let _ = fs::remove_file(&cache);

    let files = count_files(&project);
    let started = Instant::now();
    let legacy = project_tree_fingerprint(&project, &SCOPES).unwrap().expect("project");
    let legacy_seconds = started.elapsed().as_secs_f64();

    let started = Instant::now();
    let cold = project_tree_fingerprint_cached(&project, &SCOPES).unwrap().expect("project");
    let cold_seconds = started.elapsed().as_secs_f64();

    let started = Instant::now();
    let warm = project_tree_fingerprint_cached(&project, &SCOPES).unwrap().expect("project");
    let warm_seconds = started.elapsed().as_secs_f64();
    assert_eq!(cold, warm, "an unchanged project keeps its cached value");

    let changed = first_asset(&project);
    let original = fs::read(&changed).unwrap();
    fs::write(&changed, concatenate(&original, b"\n")).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));
    let started = Instant::now();
    let after_change = project_tree_fingerprint_cached(&project, &SCOPES).unwrap().expect("project");
    let changed_seconds = started.elapsed().as_secs_f64();
    assert_ne!(warm, after_change, "the changed file moves the value");
    fs::write(&changed, &original).unwrap();

    println!("fingerprint benchmark on {} files ({})", files, project.display());
    println!("  v1 legacy full read : {legacy_seconds:.2} s -> {legacy}");
    println!("  v2 first run        : {cold_seconds:.2} s -> {cold}");
    println!("  v2 unchanged        : {warm_seconds:.2} s");
    println!("  v2 one file changed : {changed_seconds:.2} s");
}

fn concatenate(original: &[u8], extra: &[u8]) -> Vec<u8> {
    let mut combined = original.to_vec();
    combined.extend_from_slice(extra);
    combined
}

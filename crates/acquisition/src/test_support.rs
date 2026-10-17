//! Shared test-only helpers for acquisition unit-test modules.
//!
//! Board #7 (2026-09-12, r3d evidence): the per-module helpers named temp
//! directories with a nanosecond timestamp plus a tag shared across tests.
//! Two tests hitting the same tick silently shared one directory
//! (`create_dir_all` succeeds on an existing path) and the earlier
//! teardown's `remove_dir_all` deleted the other test's files — observed as
//! `import_copies_a_folder_into_an_entry_without_touching_originals`
//! failing on a missing copied file while the import itself reported
//! success.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

/// Upper bound for a background batch or task to settle. CI runners execute these tests in
/// parallel with compilation, so a settle that takes milliseconds locally can take seconds there.
pub(crate) const SETTLE_LIMIT: std::time::Duration = std::time::Duration::from_secs(60);

/// Creates a uniquely named directory under the OS temp dir.
///
/// Invariant: two calls in the same process never return the same path,
/// regardless of timing — a process-unique serial anchors uniqueness while
/// the timestamp keeps names human-orderable; the pid component makes
/// cross-process collisions practically unreachable.
pub(crate) fn unique_dir(prefix: &str, tag: &str) -> PathBuf {
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let dir = std::env::temp_dir().join(format!(
        "{prefix}-{tag}-pid{}-t{nanos:016x}-{serial}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).expect("create unique test temp dir");
    dir
}

#[cfg(test)]
mod tests {
    use super::unique_dir;
    use std::collections::HashSet;
    use std::sync::{Arc, Barrier};

    /// Regression pin for Board #7: parallel stress must yield pairwise
    /// distinct temp paths. Under the pre-fix nanosecond-only naming, the
    /// barrier start plus tight per-thread loops reliably produced
    /// identical timestamps across tests sharing a tag.
    #[test]
    fn unique_dir_paths_are_pairwise_distinct_under_parallel_stress() {
        const THREADS: usize = 8;
        const PER_THREAD: usize = 64;
        let barrier = Arc::new(Barrier::new(THREADS));
        let handles: Vec<_> = (0..THREADS)
            .map(|_| {
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    (0..PER_THREAD)
                        .map(|_| unique_dir("vua-unique", "probe"))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        let mut seen = HashSet::new();
        for handle in handles {
            for dir in handle.join().expect("stress worker should not panic") {
                assert!(
                    seen.insert(dir.clone()),
                    "colliding temp dir: {}",
                    dir.display()
                );
            }
        }
        for dir in &seen {
            std::fs::remove_dir_all(dir).ok();
        }
    }
}

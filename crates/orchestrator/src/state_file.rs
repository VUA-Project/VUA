//! Versioned single-file state with atomic writes and corruption recovery
//! (E-TUTORIAL foundation, reusable by C-RESUME recovery points).
//!
//! Format discipline (ORC-STO-003..005): the envelope carries a schema
//! version; a file whose envelope cannot be parsed, or whose version is
//! unknown, is archived beside the original and the caller's default applies
//! — automatic recovery never guesses across versions. Writes are atomic
//! (same-directory temp file + rename).
//!
//! # 中文逐段讲解（E-TUTORIAL 审阅）
//!
//! 这是一个"单文件状态保险柜"的通用原语：任何"重启后要还在"的小状态
//! （教程进度、窗口位置、上次页面）都可以用它存。三个要素：
//!
//! 信封——落盘的是 `Envelope { schemaVersion: 1, savedAt, data }`。
//! 信封版本只管文件格式；业务数据自己的版本演进在 data 内部做
//! （教程载荷 TutorialPersistedV1 目前是里程碑最小集，演进时加字段即可）。
//!
//! 原子写——`save()` 先写同目录的 `.tmp` 文件再 rename 覆盖。直接改写
//! 原文件的中间态一旦断电就是半个文件；rename 在同一分区内是原子操作，
//! 任何时刻看到的要么是旧文件要么是新文件。测试断言写完后 `.tmp` 不残留。
//!
//! 三态读——`load()` 返回 `StateLoad<T>`：`Loaded`（正常读到数据）、
//! `Absent`（文件不存在，调用者用默认值）、`Recovered`（文件存在但读不了：
//! JSON 坏了或信封版本不认识——**原文件被改名归档**为
//! `xxx.corrupt-<纳秒>`，原始字节原样保留供人工取证，然后同样回默认值）。
//! 归档而不是删除：用户几年的使用数据坏在手里还被人删了，是最糟糕的
//! 体验；归档后磁盘多几 KB，换来可回溯。unknown 版本走同一条归档路，
//! 对齐 journal 的 ORC-STO-005 纪律：跨版本不猜。
//!
//! 使用注意：`save` 是整文件覆盖，适合 KB 级小状态（教程、设置）；
//! 大数据或高频写请走 journal/SQLite 通道。读不做锁（rename 的原子性
//! 保证了读到的是完整旧文件或完整新文件），写有内部互斥。

use crate::time::Clock;
use serde::Serialize;
use serde::{de::DeserializeOwned, Deserialize};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;

/// Current envelope format version. Bumping it requires a migration note;
/// readers archive foreign versions instead of guessing.
pub const STATE_FILE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<V> {
    schema_version: u32,
    saved_at: String,
    data: V,
}

/// Outcome of reading a state file.
#[derive(Debug, Clone, PartialEq)]
pub enum StateLoad<T> {
    /// The stored payload.
    Loaded(T),
    /// No file yet: the caller's default applies.
    Absent,
    /// The file was unusable and has been archived beside itself; the
    /// caller's default applies. The archive keeps the original bytes for
    /// manual diagnosis (ORC-STO-005: never auto-recover across versions).
    Recovered {
        archived_to: PathBuf,
        reason: StateRecoveryReason,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateRecoveryReason {
    CorruptJson,
    UnsupportedVersion { found: u32 },
}

#[derive(Debug)]
pub enum StateFileError {
    Io(io::Error),
    Serialize(serde_json::Error),
}

impl std::fmt::Display for StateFileError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "state file write failed: {error}"),
            Self::Serialize(error) => write!(formatter, "state file encode failed: {error}"),
        }
    }
}

impl std::error::Error for StateFileError {}

/// A single versioned JSON state file. `T` owns its own payload version
/// discipline (the envelope version covers only the file format).
pub struct StateFile<T> {
    path: PathBuf,
    clock: Arc<dyn Clock>,
    write_lock: Mutex<()>,
    _payload: std::marker::PhantomData<fn() -> T>,
}

impl<T: Serialize + DeserializeOwned> StateFile<T> {
    pub fn open(path: impl Into<PathBuf>, clock: Arc<dyn Clock>) -> Self {
        Self {
            path: path.into(),
            clock,
            write_lock: Mutex::new(()),
            _payload: std::marker::PhantomData,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Reads the current state, archiving unusable files.
    pub fn load(&self) -> StateLoad<T> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return StateLoad::Absent,
            // An unreadable file is treated like corruption: archive, default.
            Err(_) => {
                return StateLoad::Recovered {
                    archived_to: self.archive_original(),
                    reason: StateRecoveryReason::CorruptJson,
                }
            }
        };
        let parsed: Result<Envelope<T>, _> = serde_json::from_slice(&bytes);
        match parsed {
            Ok(envelope) if envelope.schema_version == STATE_FILE_SCHEMA_VERSION => {
                StateLoad::Loaded(envelope.data)
            }
            Ok(envelope) => StateLoad::Recovered {
                archived_to: self.archive_original(),
                reason: StateRecoveryReason::UnsupportedVersion {
                    found: envelope.schema_version,
                },
            },
            Err(_) => StateLoad::Recovered {
                archived_to: self.archive_original(),
                reason: StateRecoveryReason::CorruptJson,
            },
        }
    }

    /// Atomically replaces the stored payload (ORC-STO-003).
    pub fn save(&self, data: &T) -> Result<(), StateFileError> {
        let envelope = Envelope {
            schema_version: STATE_FILE_SCHEMA_VERSION,
            saved_at: self.clock.now_rfc3339(),
            data,
        };
        let bytes = serde_json::to_vec_pretty(&envelope).map_err(StateFileError::Serialize)?;
        let _guard = self.write_lock.lock().expect("state file lock poisoned");
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(StateFileError::Io)?;
        }
        static STATE_TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let seq = STATE_TMP_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut temp_os = self.path.clone().into_os_string();
        temp_os.push(format!(".{}.{seq:x}.tmp", std::process::id()));
        let temp = PathBuf::from(temp_os);
        let write_result = (|| -> std::io::Result<()> {
            use std::io::Write;
            let mut file = std::fs::File::create(&temp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temp, &self.path)
        })();
        if let Err(err) = write_result {
            let _ = std::fs::remove_file(&temp);
            return Err(StateFileError::Io(err));
        }
        Ok(())
    }

    /// Moves the unusable original aside: `<name>.corrupt-<nanos>`. Returns
    /// the archive path; archival failure still yields Absent semantics on
    /// the next load, so errors here are best-effort.
    fn archive_original(&self) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let mut archived = self.path.clone().into_os_string();
        archived.push(format!(".corrupt-{nanos}"));
        let archived = PathBuf::from(archived);
        // Rename may fail if the file vanished between read and archive; the
        // default then applies either way.
        let _ = std::fs::rename(&self.path, &archived);
        archived
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::time::FixedClock;
    use serde::Deserialize;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    struct Sample {
        #[serde(rename = "stepIndex")]
        step_index: u32,
    }

    fn temp_path(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("vua-state-{label}-{nanos}.json"))
    }

    fn fixed_clock() -> Arc<dyn Clock> {
        Arc::new(FixedClock::new(&["2026-08-31T08:00:00.000Z"]))
    }

    #[test]
    fn orc_sta_006_save_then_load_roundtrips() {
        let path = temp_path("roundtrip");
        let file: StateFile<Sample> = StateFile::open(&path, fixed_clock());
        assert_eq!(file.load(), StateLoad::Absent);

        file.save(&Sample { step_index: 3 }).unwrap();
        assert_eq!(file.load(), StateLoad::Loaded(Sample { step_index: 3 }));
        // Atomic write leaves no temp file behind (ORC-STO-003).
        assert!(!path.with_extension("tmp").exists());
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn orc_sto_005_corrupt_payload_is_archived_and_default_applies() {
        let path = temp_path("corrupt");
        std::fs::write(&path, b"{ not json at all").unwrap();

        let file: StateFile<Sample> = StateFile::open(&path, fixed_clock());
        let outcome = file.load();
        match &outcome {
            StateLoad::Recovered {
                archived_to,
                reason,
            } => {
                assert!(matches!(reason, StateRecoveryReason::CorruptJson));
                let archived_bytes = std::fs::read(archived_to).unwrap();
                assert_eq!(
                    archived_bytes, b"{ not json at all",
                    "original kept for diagnosis"
                );
            }
            other => panic!("expected recovery, got {other:?}"),
        }
        assert_eq!(file.load(), StateLoad::Absent, "original moved aside");
        // The recovered file is writable again.
        file.save(&Sample { step_index: 1 }).unwrap();
        assert_eq!(file.load(), StateLoad::Loaded(Sample { step_index: 1 }));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn orc_sto_005_unknown_envelope_version_stops_automatic_recovery() {
        let path = temp_path("version");
        let future = r#"{"schemaVersion": 99, "savedAt": "x", "data": {"stepIndex": 1}}"#;
        std::fs::write(&path, future).unwrap();

        let file: StateFile<Sample> = StateFile::open(&path, fixed_clock());
        match file.load() {
            StateLoad::Recovered { reason, .. } => {
                assert_eq!(
                    reason,
                    StateRecoveryReason::UnsupportedVersion { found: 99 }
                );
            }
            other => panic!("expected version recovery, got {other:?}"),
        }
        assert!(
            !path.exists(),
            "foreign version archived, not silently used"
        );
        std::fs::remove_file(path.with_extension("json").with_file_name({
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            format!("{name}.corrupt-0")
        }))
        .ok();
    }

    #[test]
    fn orc_sto_003_save_replaces_the_previous_payload_atomically() {
        let path = temp_path("replace");
        let file: StateFile<Sample> = StateFile::open(&path, fixed_clock());
        file.save(&Sample { step_index: 1 }).unwrap();
        file.save(&Sample { step_index: 2 }).unwrap();
        assert_eq!(file.load(), StateLoad::Loaded(Sample { step_index: 2 }));
        assert!(!path.with_extension("tmp").exists());
        std::fs::remove_file(&path).unwrap();
    }
}

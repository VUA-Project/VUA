//! Scoped read-only VRChat local log matcher for Easy Anti-Cheat (EOS) error codes.
//!
//! Reads at most the final 256 KiB of the newest `output_log_*.txt` inside
//! `%USERPROFILE%\AppData\LocalLow\VRChat\VRChat`, matches fixed error patterns, and retains only
//! closed [`LogFindingCode`] values and normalized timestamps — never raw log lines or user paths.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const MAX_LOG_TAIL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub enum LogFindingCode {
    #[serde(rename = "launch_error_30005")]
    LaunchError30005,
    #[serde(rename = "not_installed")]
    NotInstalled,
    #[serde(rename = "start_service_1275")]
    StartService1275,
    #[serde(rename = "untrusted_system_file")]
    UntrustedSystemFile,
    #[serde(rename = "connection_lost")]
    ConnectionLost,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EacLogFinding {
    pub code: LogFindingCode,
    pub observed_at: Option<String>,
}

/// Injectable VRChat log finding seam.
pub trait LogSource: Send + Sync {
    fn read_recent_findings(&self) -> Result<Vec<EacLogFinding>, String>;
}

#[derive(Debug, Clone)]
pub struct WindowsVrchatLogSource {
    log_dir: Option<PathBuf>,
}

impl Default for WindowsVrchatLogSource {
    fn default() -> Self {
        let log_dir = std::env::var_os("USERPROFILE").map(|profile| {
            PathBuf::from(profile)
                .join("AppData")
                .join("LocalLow")
                .join("VRChat")
                .join("VRChat")
        });
        Self { log_dir }
    }
}

impl WindowsVrchatLogSource {
    pub fn with_dir(log_dir: PathBuf) -> Self {
        Self {
            log_dir: Some(log_dir),
        }
    }
}

impl LogSource for WindowsVrchatLogSource {
    fn read_recent_findings(&self) -> Result<Vec<EacLogFinding>, String> {
        let Some(dir) = self.log_dir.as_deref() else {
            return Ok(Vec::new());
        };
        if !dir.exists() {
            return Ok(Vec::new());
        }
        read_findings_from_dir(dir)
    }
}

fn read_findings_from_dir(dir: &Path) -> Result<Vec<EacLogFinding>, String> {
    let entries =
        fs::read_dir(dir).map_err(|err| format!("failed to list VRChat log directory: {err}"))?;
    let mut newest: Option<(std::time::SystemTime, String, PathBuf)> = None;
    for entry in entries {
        let entry = entry.map_err(|err| format!("failed to read VRChat log entry: {err}"))?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_name.starts_with("output_log_") || !file_name.ends_with(".txt") {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|err| format!("failed to stat VRChat log entry: {err}"))?;
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata
            .modified()
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let replace = match &newest {
            None => true,
            Some((best_time, best_name, _)) => (modified, &file_name) > (*best_time, best_name),
        };
        if replace {
            newest = Some((modified, file_name, entry.path()));
        }
    }

    let Some((_, _, log_path)) = newest else {
        return Ok(Vec::new());
    };
    read_tail_findings(&log_path)
}

fn read_tail_findings(log_path: &Path) -> Result<Vec<EacLogFinding>, String> {
    let mut file =
        File::open(log_path).map_err(|err| format!("failed to open newest VRChat log: {err}"))?;
    let length = file
        .metadata()
        .map_err(|err| format!("failed to stat newest VRChat log: {err}"))?
        .len();
    let offset = length.saturating_sub(MAX_LOG_TAIL_BYTES);
    if offset > 0 {
        file.seek(SeekFrom::Start(offset))
            .map_err(|err| format!("failed to seek newest VRChat log: {err}"))?;
    }
    let mut bytes = Vec::with_capacity(length.min(MAX_LOG_TAIL_BYTES) as usize);
    file.take(MAX_LOG_TAIL_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("failed to read newest VRChat log tail: {err}"))?;

    let text = String::from_utf8_lossy(&bytes);
    let slice = if offset > 0 {
        // Drop a potentially mid-line partial first line after seeking.
        match text.find('\n') {
            Some(pos) => &text[pos + 1..],
            None => "",
        }
    } else {
        text.as_ref()
    };

    Ok(extract_findings_from_text(slice))
}

/// Parses VRChat's leading `YYYY.MM.DD HH:MM:SS` timestamp into `YYYY-MM-DDTHH:MM:SS` without
/// retaining any surrounding log text.
fn parse_vrchat_line_timestamp(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let is_digit = |idx: usize| bytes[idx].is_ascii_digit();
    if !(is_digit(0)
        && is_digit(1)
        && is_digit(2)
        && is_digit(3)
        && (bytes[4] == b'.' || bytes[4] == b'-')
        && is_digit(5)
        && is_digit(6)
        && (bytes[7] == b'.' || bytes[7] == b'-')
        && is_digit(8)
        && is_digit(9)
        && (bytes[10] == b' ' || bytes[10] == b'T')
        && is_digit(11)
        && is_digit(12)
        && bytes[13] == b':'
        && is_digit(14)
        && is_digit(15)
        && bytes[16] == b':'
        && is_digit(17)
        && is_digit(18))
    {
        return None;
    }
    let year = &line[0..4];
    let month = &line[5..7];
    let day = &line[8..10];
    let time = &line[11..19];
    Some(format!("{year}-{month}-{day}T{time}"))
}

fn classify_line(line: &str) -> Option<LogFindingCode> {
    let lower = line.to_ascii_lowercase();
    if lower.contains("30005")
        && (lower.contains("createfile")
            || lower.contains("launch error")
            || lower.contains("easyanticheat")
            || lower.contains("anti-cheat")
            || lower.contains("[eosmanager]"))
    {
        return Some(LogFindingCode::LaunchError30005);
    }
    if lower.contains("easy anti-cheat is not installed")
        || lower.contains("easyanticheat is not installed")
        || (lower.contains("[eosmanager]") && lower.contains("not installed"))
    {
        return Some(LogFindingCode::NotInstalled);
    }
    if lower.contains("1275")
        && (lower.contains("startservice")
            || lower.contains("eossys")
            || lower.contains("easyanticheat"))
    {
        return Some(LogFindingCode::StartService1275);
    }
    if lower.contains("untrusted system file")
        || (lower.contains("30004")
            && (lower.contains("waitforsingleobject")
                || lower.contains("error code")
                || lower.contains("easyanticheat")
                || lower.contains("anti-cheat")))
    {
        return Some(LogFindingCode::UntrustedSystemFile);
    }
    if lower.contains("could not maintain a verified connection")
        || (lower.contains("anti-cheat") && lower.contains("verified connection"))
    {
        return Some(LogFindingCode::ConnectionLost);
    }
    None
}

pub fn extract_findings_from_text(text: &str) -> Vec<EacLogFinding> {
    let mut by_code = std::collections::BTreeMap::<LogFindingCode, Option<String>>::new();
    for line in text.lines() {
        if let Some(code) = classify_line(line) {
            let timestamp = parse_vrchat_line_timestamp(line);
            by_code.insert(code, timestamp);
        }
    }
    by_code
        .into_iter()
        .map(|(code, observed_at)| EacLogFinding { code, observed_at })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_codes_and_timestamps_never_raw_lines() {
        let log = "\
2026.11.14 15:01:02 Debug      -  [EOSManager] Initializing EOS
2026.11.14 15:02:10 Error      -  Launch Error (30005) CreateFile failed with 32 for C:\\Users\\Secret\\file
2026.11.14 15:03:45 Error      -  The VRChat Anti-Cheat system could not maintain a verified connection.
2026.11.14 15:04:12 Error      -  StartService EasyAntiCheat_EOSSys failed with 1275
2026.11.14 15:05:00 Error      -  Easy Anti-Cheat is not installed
2026.11.14 15:06:33 Error      -  Untrusted system file (C:\\Windows\\System32\\foo.dll)
";
        let findings = extract_findings_from_text(log);
        assert_eq!(
            findings,
            vec![
                EacLogFinding {
                    code: LogFindingCode::LaunchError30005,
                    observed_at: Some("2026-11-14T15:02:10".to_owned()),
                },
                EacLogFinding {
                    code: LogFindingCode::NotInstalled,
                    observed_at: Some("2026-11-14T15:05:00".to_owned()),
                },
                EacLogFinding {
                    code: LogFindingCode::StartService1275,
                    observed_at: Some("2026-11-14T15:04:12".to_owned()),
                },
                EacLogFinding {
                    code: LogFindingCode::UntrustedSystemFile,
                    observed_at: Some("2026-11-14T15:06:33".to_owned()),
                },
                EacLogFinding {
                    code: LogFindingCode::ConnectionLost,
                    observed_at: Some("2026-11-14T15:03:45".to_owned()),
                },
            ]
        );
        let serialized = serde_json::to_string(&findings).unwrap();
        assert!(!serialized.contains("Secret"));
        assert!(!serialized.contains("foo.dll"));
    }

    #[test]
    fn reads_only_tail_256_kib_of_newest_output_log() {
        let dir = std::env::temp_dir().join(format!("vua-eac-logs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let older = dir.join("output_log_2026-11-13_10-00-00.txt");
        fs::write(
            &older,
            "2026.11.13 10:00:01 Error - Easy Anti-Cheat is not installed\n",
        )
        .unwrap();

        let newer = dir.join("output_log_2026-11-14_10-00-00.txt");
        let mut big =
            String::from("2026.11.14 09:00:00 Error - Easy Anti-Cheat is not installed\n");
        big.push_str(&"x".repeat((MAX_LOG_TAIL_BYTES as usize) + 4096));
        big.push_str(
            "\n2026.11.14 10:05:09 Error - Launch Error (30005) CreateFile failed with 32\n",
        );
        fs::write(&newer, big).unwrap();

        let source = WindowsVrchatLogSource::with_dir(dir.clone());
        let findings = source.read_recent_findings().unwrap();
        assert_eq!(
            findings,
            vec![EacLogFinding {
                code: LogFindingCode::LaunchError30005,
                observed_at: Some("2026-11-14T10:05:09".to_owned()),
            }]
        );

        fs::remove_dir_all(dir).unwrap();
    }
}

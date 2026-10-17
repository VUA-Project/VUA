//! Reads a Unity batch run's progress from the Editor log it writes with `-logFile`.
//!
//! The reader keeps only a stage from a closed set, a count of imported work-project assets
//! and the time Unity last wrote. Log text and paths stay in the log file.
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use vua_orchestrator::amf_production::{UnityProgress, UnityStage};
use vua_orchestrator::{Clock, SystemClock};

/// Bridge v5 writes this marker with the stage it enters, for example `[VUA] stage=previews`.
pub const BRIDGE_STAGE_MARKER: &str = "[VUA] stage=";
/// New log text read in one poll; the rest is read on the next poll.
const READ_LIMIT: u64 = 4 * 1024 * 1024;
/// Longest line kept while waiting for its end.
const LINE_LIMIT: usize = 64 * 1024;

/// Follows the stages of one Unity batch run, line by line.
///
/// Unity resolves its license and packages first, then alternates between importing assets and
/// compiling scripts, then runs the Bridge, which renders previews and finishes. A line from an
/// earlier part of that order leaves the stage where it is, so late license or package messages
/// do not move the stage back. Importing and compiling alternate freely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnityLogReader {
    stage: UnityStage,
    imported: u32,
}

impl Default for UnityLogReader {
    fn default() -> Self {
        Self { stage: UnityStage::Starting, imported: 0 }
    }
}

fn order(stage: UnityStage) -> u8 {
    match stage {
        UnityStage::Starting => 0,
        UnityStage::License => 1,
        UnityStage::Packages => 2,
        UnityStage::Importing | UnityStage::Compiling => 3,
        UnityStage::Bridge => 4,
        UnityStage::Previews => 5,
        UnityStage::Finishing => 6,
        // The log reader never reports this stage; it orders VUA's own after-Unity check.
        UnityStage::Fingerprint => 7,
    }
}

/// The stage a single log line names, if any.
fn stage_of(line: &str) -> Option<UnityStage> {
    if let Some(rest) = line.split(BRIDGE_STAGE_MARKER).nth(1) {
        return match rest.split_whitespace().next()? {
            "bridge" => Some(UnityStage::Bridge),
            "previews" => Some(UnityStage::Previews),
            "finishing" => Some(UnityStage::Finishing),
            _ => None,
        };
    }
    let any = |needles: &[&str]| needles.iter().any(|needle| line.contains(needle));
    if any(&["Batchmode quit successfully invoked", "Exiting batchmode", "Application will terminate with return code"]) {
        Some(UnityStage::Finishing)
    } else if line.contains("Loaded scene 'Assets/VUA/Production.unity'") {
        Some(UnityStage::Bridge)
    } else if any(&["Start importing ", "Rebuilding Library because the asset database could not be found"]) {
        Some(UnityStage::Importing)
    } else if any(&["[ScriptCompilation]", "Requested script compilation", "Begin MonoManager ReloadAssembly", "Reloading assemblies"]) {
        Some(UnityStage::Compiling)
    } else if any(&["[Package Manager]", "Resolving packages", "Packages were changed"]) {
        Some(UnityStage::Packages)
    } else if any(&["[Licensing::", "LICENSE SYSTEM"]) {
        Some(UnityStage::License)
    } else {
        None
    }
}

impl UnityLogReader {
    pub fn read_line(&mut self, line: &str) {
        let Some(stage) = stage_of(line) else { return; };
        if order(stage) < order(self.stage) {
            return;
        }
        // Only work-project assets count; packages import their own files before them.
        if stage == UnityStage::Importing
            && line.split("Start importing ").nth(1).is_some_and(|path| path.starts_with("Assets/"))
        {
            self.imported = self.imported.saturating_add(1);
        }
        self.stage = stage;
    }
    pub fn read_text(&mut self, text: &str) {
        text.lines().for_each(|line| self.read_line(line));
    }
    /// Moves the stage forward to `stage` when the run shows it some other way.
    pub fn reach(&mut self, stage: UnityStage) {
        if order(stage) > order(self.stage) {
            self.stage = stage;
        }
    }
    pub fn stage(&self) -> UnityStage {
        self.stage
    }
    /// Work-project assets Unity started importing.
    pub fn imported(&self) -> u32 {
        self.imported
    }
}

/// Reads the new part of a Unity batch run's log on each poll and reports the run's progress.
///
/// The Bridge's preview folder and result file also mark the previews and finishing stages,
/// for runs whose log does not show them.
pub struct UnityLogTail {
    log: PathBuf,
    previews: PathBuf,
    result: PathBuf,
    offset: u64,
    partial: Vec<u8>,
    reader: UnityLogReader,
    total: Option<u32>,
    last_activity_at: String,
}

impl UnityLogTail {
    /// `total` is the number of work-project assets this run imports, when known.
    pub fn new(project: &Path, command_id: &str, total: Option<u32>) -> Self {
        Self {
            log: project.join(".vua/logs").join(format!("{command_id}.log")),
            previews: project.join(".vua/previews").join(command_id),
            result: project.join(".vua/bridge").join(format!("{command_id}.result.json")),
            offset: 0,
            partial: Vec::new(),
            reader: UnityLogReader::default(),
            total,
            last_activity_at: SystemClock.now_rfc3339(),
        }
    }

    pub fn poll(&mut self) -> UnityProgress {
        let mut text = Vec::new();
        if let Ok(mut file) = fs::File::open(&self.log) {
            let length = file.metadata().map(|m| m.len()).unwrap_or(0);
            if length < self.offset {
                // Another run wrote the file from the start.
                self.offset = 0;
                self.partial.clear();
            }
            if length > self.offset && file.seek(SeekFrom::Start(self.offset)).is_ok() {
                let _ = file.take(READ_LIMIT).read_to_end(&mut text);
            }
        }
        if !text.is_empty() {
            self.offset += text.len() as u64;
            self.last_activity_at = SystemClock.now_rfc3339();
            self.read(&text);
        }
        if self.previews.is_dir() {
            self.reader.reach(UnityStage::Previews);
        }
        if self.result.is_file() {
            self.reader.reach(UnityStage::Finishing);
        }
        self.progress()
    }

    fn read(&mut self, bytes: &[u8]) {
        let mut rest = bytes;
        while let Some(end) = rest.iter().position(|b| *b == b'\n') {
            self.partial.extend_from_slice(&rest[..end]);
            let line = String::from_utf8_lossy(&self.partial).into_owned();
            self.reader.read_line(line.trim_end_matches('\r'));
            self.partial.clear();
            rest = &rest[end + 1..];
        }
        let room = LINE_LIMIT.saturating_sub(self.partial.len());
        self.partial.extend_from_slice(&rest[..rest.len().min(room)]);
    }

    pub fn progress(&self) -> UnityProgress {
        let importing = self.reader.stage() == UnityStage::Importing;
        UnityProgress {
            stage: self.reader.stage(),
            current: importing.then_some(self.reader.imported()),
            total: if importing { self.total } else { None },
            last_activity_at: self.last_activity_at.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOG: &str = "\
[Licensing::Module] Trying to connect to existing licensing client channel...
[Licensing::Client] Successfully resolved entitlement details
Built from '2022.3/staging' branch; Version is '2022.3.22f1 (887be4894c44) revision 8944612'
Successfully changed project path to: C:/Users/player/AppData/Roaming/VUA/amf-production/projects/n3-1
[Package Manager] Server::Start -- Port 62049 was selected
[Package Manager] Done resolving packages in 3.53 seconds
Rebuilding Library because the asset database could not be found!
Start importing Packages/com.vrchat.base/Runtime/VRCSDKBase.dll using Guid(0123456789abcdef0123456789abcdef) Importer(-1,00000000000000000000000000000000)
[ScriptCompilation] Requested script compilation because: Assetdatabase observed changes in script compilation related files
Begin MonoManager ReloadAssembly
[Licensing::Client] Successfully updated license
Start importing Assets/Meiyun using Guid(11111111111111111111111111111111) Importer(-1,00000000000000000000000000000000)
Start importing Assets/Meiyun/Meiyun.prefab using Guid(22222222222222222222222222222222) Importer(-1,00000000000000000000000000000000)  -> (artifact id: 'aa') in 0.0123 seconds
Start importing Assets/Amenbo/Tshirt.mat using Guid(33333333333333333333333333333333) Importer(-1,00000000000000000000000000000000)
";

    #[test]
    fn stages_follow_unity_and_late_messages_do_not_move_them_back() {
        let mut reader = UnityLogReader::default();
        let mut seen = vec![reader.stage()];
        for line in LOG.lines() {
            reader.read_line(line);
            if seen.last() != Some(&reader.stage()) {
                seen.push(reader.stage());
            }
        }
        use UnityStage::*;
        assert_eq!(seen, [Starting, License, Packages, Importing, Compiling, Importing]);
        assert_eq!(reader.imported(), 3, "package files are not work-project assets");

        reader.read_text("Loaded scene 'Assets/VUA/Production.unity'\n\tDeserialize:            12.000 ms\n[Package Manager] late message\nStart importing Assets/VUA/Production.unity using Guid(4) Importer(1)\n");
        assert_eq!(reader.stage(), Bridge, "the Bridge's own saves and late package messages keep the Bridge stage");
        reader.read_text("[VUA] stage=previews\nUnityEngine.Debug:Log (object)\n");
        assert_eq!(reader.stage(), Previews);
        reader.read_text("[VUA] stage=bridge\n[VUA] stage=unknown\n");
        assert_eq!(reader.stage(), Previews);
        reader.read_text("Batchmode quit successfully invoked - shutting down!\n");
        assert_eq!(reader.stage(), Finishing);
    }

    #[test]
    fn bridge_markers_name_their_stage() {
        let mut reader = UnityLogReader::default();
        reader.read_line("[VUA] stage=bridge");
        assert_eq!(reader.stage(), UnityStage::Bridge);
        reader.read_line("[VUA] stage=finishing");
        assert_eq!(reader.stage(), UnityStage::Finishing);
    }

    fn project(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("vua-unity-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".vua/logs")).unwrap();
        root
    }

    #[test]
    fn the_tail_reads_appended_text_and_reports_counts_without_log_text() {
        let root = project("tail");
        let log = root.join(".vua/logs/cmd-1.log");
        let mut tail = UnityLogTail::new(&root, "cmd-1", Some(379));
        let before = tail.poll();
        assert_eq!(before.stage, UnityStage::Starting, "no log yet");
        assert_eq!((before.current, before.total), (None, None));

        let (head, rest) = LOG.split_at(LOG.find("Start importing Assets/Meiyun/").unwrap() + 20);
        fs::write(&log, head).unwrap();
        let progress = tail.poll();
        assert_eq!((progress.stage, progress.current, progress.total), (UnityStage::Importing, Some(1), Some(379)));
        assert!(vua_orchestrator::rfc3339_millis(&progress.last_activity_at).is_some());

        // The rest of a half-written line arrives with the next write.
        use std::io::Write;
        fs::OpenOptions::new().append(true).open(&log).unwrap().write_all(rest.replace('\n', "\r\n").as_bytes()).unwrap();
        let progress = tail.poll();
        assert_eq!((progress.stage, progress.current), (UnityStage::Importing, Some(3)));
        let quiet = tail.poll();
        assert_eq!(quiet.last_activity_at, progress.last_activity_at, "no new text, no new activity");

        let wire = serde_json::to_string(&quiet).unwrap();
        assert!(!wire.contains("Assets") && !wire.contains("Users") && !wire.contains("Licensing"), "{wire}");

        fs::create_dir_all(root.join(".vua/previews/cmd-1")).unwrap();
        let previews = tail.poll();
        assert_eq!((previews.stage, previews.current, previews.total), (UnityStage::Previews, None, None));
        fs::create_dir_all(root.join(".vua/bridge")).unwrap();
        fs::write(root.join(".vua/bridge/cmd-1.result.json"), "{}").unwrap();
        assert_eq!(tail.poll().stage, UnityStage::Finishing);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_overlong_line_is_bounded() {
        let root = project("long");
        let mut tail = UnityLogTail::new(&root, "cmd-2", None);
        fs::write(root.join(".vua/logs/cmd-2.log"), "x".repeat(LINE_LIMIT * 3)).unwrap();
        tail.poll();
        assert_eq!(tail.partial.len(), LINE_LIMIT);
        fs::remove_dir_all(&root).unwrap();
    }
}

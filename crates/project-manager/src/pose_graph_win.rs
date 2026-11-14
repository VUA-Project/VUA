//! Windows adapter for `pose-graph v0.1` (`0.2.0`): single-pass read-only Toolhelp32
//! process-basename snapshot without opening foreign process memory.

use std::collections::BTreeSet;
use vua_orchestrator::pose_graph::{PoseProbeUnavailable, PoseProcessProbe};

#[derive(Debug, Default, Clone, Copy)]
pub struct WindowsPoseProcessProbe;

impl PoseProcessProbe for WindowsPoseProcessProbe {
    fn is_process_running(&self, exe_name: &str) -> Result<bool, PoseProbeUnavailable> {
        #[cfg(windows)]
        {
            crate::play_session::os::has_process_named(exe_name).map_err(|_| PoseProbeUnavailable)
        }
        #[cfg(not(windows))]
        {
            let _ = exe_name;
            Err(PoseProbeUnavailable)
        }
    }

    fn running_from_candidates(
        &self,
        candidates: &[&str],
    ) -> Result<BTreeSet<String>, PoseProbeUnavailable> {
        #[cfg(windows)]
        {
            let lowered: Vec<String> = candidates.iter().map(|c| c.to_ascii_lowercase()).collect();
            let refs: Vec<&str> = lowered.iter().map(String::as_str).collect();
            crate::play_session::os::running_from_candidates(&refs)
                .map_err(|_| PoseProbeUnavailable)
        }
        #[cfg(not(windows))]
        {
            let _ = candidates;
            Err(PoseProbeUnavailable)
        }
    }
}

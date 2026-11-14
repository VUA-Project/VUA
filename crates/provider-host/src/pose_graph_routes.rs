//! Thin Host wire adapter for Candidate `pose-graph v0.1`.
use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde_json::{json, Value};
use vua_orchestrator::pose_graph::PoseGraphService;

const EXPECTED_KEYS: &[&str] = &[
    "contractVersion",
    "requestId",
    "correlationId",
    "kind",
    "method",
    "params",
];

pub(crate) fn request(
    service: Option<&PoseGraphService>,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let reply_error = |code: &str, category: &str| {
        FrameOutcome::Response(application_error(
            id,
            correlation,
            code,
            "errors.poseGraph.failed",
            category,
        ))
    };

    let envelope_ok = request.as_object().is_some_and(|o| {
        o.len() == EXPECTED_KEYS.len() && EXPECTED_KEYS.iter().all(|k| o.contains_key(*k))
    }) && request["contractVersion"] == "0.1"
        && request["kind"] == "query"
        && request["method"] == "environment.observePoseGraph"
        && ["requestId", "correlationId"]
            .iter()
            .all(|k| request[*k].as_str().is_some_and(|v| !v.is_empty()));
    if !envelope_ok {
        return reply_error("vua.pose_graph.invalid_params", "validation");
    }

    let Some(params) = request["params"].as_object() else {
        return reply_error("vua.pose_graph.invalid_params", "validation");
    };
    if params.len() != 1 || params.get("schemaVersion").and_then(Value::as_str) != Some("0.1") {
        return reply_error("vua.pose_graph.invalid_params", "validation");
    }

    let Some(service) = service else {
        return reply_error("vua.pose_graph.unavailable", "unavailable");
    };

    let snapshot = service.observe();
    FrameOutcome::Response(application_success(id, json!({ "poseGraph": snapshot })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use vua_orchestrator::pose_graph::{PoseProbeUnavailable, PoseProcessProbe};
    use vua_orchestrator::{EnvironmentRoots, FakeRegistrySource, FixedClock};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(1);

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let n = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "vua-pose-route-test-{}-{}",
                std::process::id(),
                n
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct StubProbe;
    impl PoseProcessProbe for StubProbe {
        fn is_process_running(&self, _exe_name: &str) -> Result<bool, PoseProbeUnavailable> {
            Ok(false)
        }
    }

    fn test_service(root: &Path) -> PoseGraphService {
        let mut roots = EnvironmentRoots {
            local_low: root.join("LocalLow"),
            steam_common: vec![root.join("steam_common")],
            steam_install_candidates: Vec::new(),
            openvrpaths: Vec::new(),
            registry: Arc::new(FakeRegistrySource::new()),
            ..EnvironmentRoots::default()
        };
        roots.vr_runtime_roots.pico = Vec::new();
        PoseGraphService::new(
            roots,
            Arc::new(StubProbe),
            Arc::new(FixedClock::new(&["2026-11-14T00:00:00Z"])),
        )
    }

    #[test]
    fn validates_envelopes_and_serves_pose_graph_query() {
        let valid_req = json!({
            "contractVersion": "0.1",
            "requestId": "r1",
            "correlationId": "c1",
            "kind": "query",
            "method": "environment.observePoseGraph",
            "params": { "schemaVersion": "0.1" }
        });

        match request(None, &valid_req, "r1", "c1") {
            FrameOutcome::Response(v) => {
                assert_eq!(v["error"]["code"], "vua.pose_graph.unavailable");
            }
            _ => panic!("expected response"),
        }

        let dir = TestDir::new();
        let svc = test_service(dir.path());
        match request(Some(&svc), &valid_req, "r1", "c1") {
            FrameOutcome::Response(v) => {
                assert_eq!(v["ok"], true);
                assert_eq!(
                    v["value"]["poseGraph"]["schemaVersion"],
                    "vua.pose-graph/v0.1"
                );
                assert_eq!(
                    v["value"]["poseGraph"]["poseSources"]
                        .as_array()
                        .unwrap()
                        .len(),
                    9
                );
            }
            _ => panic!("expected response"),
        }

        let bad_kind = json!({
            "contractVersion": "0.1",
            "requestId": "r2",
            "correlationId": "c2",
            "kind": "command",
            "method": "environment.observePoseGraph",
            "params": { "schemaVersion": "0.1" }
        });
        match request(Some(&svc), &bad_kind, "r2", "c2") {
            FrameOutcome::Response(v) => {
                assert_eq!(v["error"]["code"], "vua.pose_graph.invalid_params");
            }
            _ => panic!("expected response"),
        }
    }
}

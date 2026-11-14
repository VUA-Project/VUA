//! Thin Host wire adapter for Candidate `local-diagnostics v0.1`.
use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde_json::{json, Value};
use vua_orchestrator::local_diagnostics::{
    ClientConfigUpdateInput, LocalDiagnosticsError, LocalDiagnosticsService, SymptomId,
};

pub(crate) fn request(
    service: Option<&LocalDiagnosticsService>,
    method: &str,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let command = matches!(
        method,
        "diagnostics.clearOscAvatarCache" | "diagnostics.updateClientConfig"
    );
    let expected_keys: &[&str] = if command {
        &[
            "contractVersion",
            "requestId",
            "correlationId",
            "kind",
            "method",
            "params",
            "commandId",
        ]
    } else {
        &[
            "contractVersion",
            "requestId",
            "correlationId",
            "kind",
            "method",
            "params",
        ]
    };

    let reply_error = |code: &str, category: &str| {
        FrameOutcome::Response(application_error(
            id,
            correlation,
            code,
            "errors.diagnostics.failed",
            category,
        ))
    };

    let envelope_ok = request.as_object().is_some_and(|o| {
        o.len() == expected_keys.len() && expected_keys.iter().all(|k| o.contains_key(*k))
    }) && request["contractVersion"] == "0.1"
        && request["kind"] == if command { "command" } else { "query" }
        && ["requestId", "correlationId"]
            .iter()
            .all(|k| request[*k].as_str().is_some_and(|v| !v.is_empty()));
    if !envelope_ok {
        return reply_error("vua.diagnostics.invalid_params", "validation");
    }

    let Some(params) = request["params"].as_object() else {
        return reply_error("vua.diagnostics.invalid_params", "validation");
    };
    if params.get("schemaVersion").and_then(Value::as_str) != Some("0.1") {
        return reply_error("vua.diagnostics.invalid_params", "validation");
    }

    let command_id = request["commandId"].as_str().unwrap_or("");
    if command
        && (command_id.is_empty()
            || command_id.len() > 128
            || !command_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c)))
    {
        return reply_error("vua.diagnostics.invalid_params", "validation");
    }

    let Some(service) = service else {
        return reply_error("vua.diagnostics.unavailable", "unavailable");
    };

    let map_err = |err: LocalDiagnosticsError| reply_error(err.code(), err.category());

    match method {
        "diagnostics.observeLocal" => {
            if params.len() != 1 {
                return map_err(LocalDiagnosticsError::InvalidParams);
            }
            let snapshot = service.observe_local();
            FrameOutcome::Response(application_success(
                id,
                json!({ "localDiagnostics": snapshot }),
            ))
        }
        "diagnostics.diagnoseSymptom" => {
            if params.len() != 2 {
                return map_err(LocalDiagnosticsError::InvalidParams);
            }
            let Some(symptom) = params
                .get("symptom")
                .and_then(Value::as_str)
                .and_then(SymptomId::parse)
            else {
                return map_err(LocalDiagnosticsError::InvalidParams);
            };
            let diagnosis = service.diagnose_symptom(symptom);
            FrameOutcome::Response(application_success(
                id,
                json!({ "symptomDiagnosis": diagnosis }),
            ))
        }
        "diagnostics.clearOscAvatarCache" => {
            if params.len() != 1 {
                return map_err(LocalDiagnosticsError::InvalidParams);
            }
            match service.clear_osc_avatar_cache(command_id) {
                Ok(receipt) => FrameOutcome::Response(application_success(
                    id,
                    json!({ "oscCacheClearReceipt": receipt }),
                )),
                Err(err) => map_err(err),
            }
        }
        "diagnostics.updateClientConfig" => {
            if params.keys().any(|k| {
                !matches!(
                    k.as_str(),
                    "schemaVersion" | "cacheSizeGb" | "cacheExpiryDelayDays"
                )
            }) {
                return map_err(LocalDiagnosticsError::InvalidParams);
            }
            let cache_size_gb = match params.get("cacheSizeGb") {
                None => None,
                Some(v) => match v.as_u64() {
                    Some(n) if (1..=200).contains(&n) => Some(n),
                    _ => return map_err(LocalDiagnosticsError::InvalidParams),
                },
            };
            let cache_expiry_delay_days = match params.get("cacheExpiryDelayDays") {
                None => None,
                Some(v) => match v.as_u64() {
                    Some(n) if (1..=365).contains(&n) => Some(n),
                    _ => return map_err(LocalDiagnosticsError::InvalidParams),
                },
            };
            match service.update_client_config(
                command_id,
                ClientConfigUpdateInput {
                    cache_size_gb,
                    cache_expiry_delay_days,
                },
            ) {
                Ok(receipt) => FrameOutcome::Response(application_success(
                    id,
                    json!({ "clientConfigReceipt": receipt }),
                )),
                Err(err) => map_err(err),
            }
        }
        _ => map_err(LocalDiagnosticsError::InvalidParams),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use vua_orchestrator::local_diagnostics::{LocalDiagnosticsProbe, UdpPortObservation};
    use vua_orchestrator::{EnvironmentRoots, FakeRegistrySource, SystemClock};

    static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(1);

    struct TestTempDir(PathBuf);
    impl TestTempDir {
        fn new() -> Self {
            let n = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "vua-diag-route-test-{}-{}",
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
    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct StubProbe {
        running: Result<bool, vua_orchestrator::local_diagnostics::ProcessProbeUnavailable>,
    }

    impl LocalDiagnosticsProbe for StubProbe {
        fn is_client_running(
            &self,
        ) -> Result<bool, vua_orchestrator::local_diagnostics::ProcessProbeUnavailable> {
            self.running
        }
        fn probe_udp_port(&self, _port: u16) -> UdpPortObservation {
            UdpPortObservation::unbound()
        }
    }

    fn test_service(
        root: &Path,
        running: Result<bool, vua_orchestrator::local_diagnostics::ProcessProbeUnavailable>,
    ) -> LocalDiagnosticsService {
        let roots = EnvironmentRoots {
            local_low: root.join("LocalLow"),
            steam_install_candidates: Vec::new(),
            openvrpaths: Vec::new(),
            pico_connect_settings_candidates: Vec::new(),
            registry: Arc::new(FakeRegistrySource::new()),
            ..EnvironmentRoots::default()
        };
        LocalDiagnosticsService::new(
            roots,
            Arc::new(StubProbe { running }),
            Arc::new(SystemClock),
        )
    }

    #[test]
    fn validates_envelopes_and_serves_queries_and_commands() {
        let temp = TestTempDir::new();
        let vrc_dir = temp.path().join("LocalLow").join("VRChat").join("VRChat");
        std::fs::create_dir_all(vrc_dir.join("OSC").join("usr_abc").join("Avatars")).unwrap();
        std::fs::write(
            vrc_dir
                .join("OSC")
                .join("usr_abc")
                .join("Avatars")
                .join("avtr_1.json"),
            b"{}",
        )
        .unwrap();

        let observe = json!({
            "contractVersion": "0.1",
            "requestId": "r1",
            "correlationId": "c1",
            "kind": "query",
            "method": "diagnostics.observeLocal",
            "params": { "schemaVersion": "0.1" }
        });
        match request(None, "diagnostics.observeLocal", &observe, "r1", "c1") {
            FrameOutcome::Response(v) => {
                assert_eq!(v["error"]["code"], "vua.diagnostics.unavailable");
            }
            _ => panic!("expected response"),
        }

        let svc = test_service(temp.path(), Ok(false));
        match request(Some(&svc), "diagnostics.observeLocal", &observe, "r1", "c1") {
            FrameOutcome::Response(v) => {
                assert_eq!(v["ok"], true);
                assert_eq!(
                    v["value"]["localDiagnostics"]["osc"]["avatarConfigCount"],
                    1
                );
            }
            _ => panic!("expected response"),
        }

        let diagnose = json!({
            "contractVersion": "0.1",
            "requestId": "r2",
            "correlationId": "c2",
            "kind": "query",
            "method": "diagnostics.diagnoseSymptom",
            "params": { "schemaVersion": "0.1", "symptom": "osc_or_face_tracking_not_responding" }
        });
        match request(
            Some(&svc),
            "diagnostics.diagnoseSymptom",
            &diagnose,
            "r2",
            "c2",
        ) {
            FrameOutcome::Response(v) => {
                assert_eq!(v["ok"], true);
                assert!(v["value"]["symptomDiagnosis"]["sopSteps"]
                    .as_array()
                    .is_some_and(|s| !s.is_empty()));
            }
            _ => panic!("expected response"),
        }

        let update = json!({
            "contractVersion": "0.1",
            "requestId": "r3",
            "correlationId": "c3",
            "kind": "command",
            "method": "diagnostics.updateClientConfig",
            "commandId": "cmd-update-1",
            "params": { "schemaVersion": "0.1", "cacheSizeGb": 40 }
        });
        match request(
            Some(&svc),
            "diagnostics.updateClientConfig",
            &update,
            "r3",
            "c3",
        ) {
            FrameOutcome::Response(v) => {
                assert_eq!(v["ok"], true);
                assert_eq!(v["value"]["clientConfigReceipt"]["cacheSizeGb"], 40);
            }
            _ => panic!("expected response"),
        }

        let running_svc = test_service(temp.path(), Ok(true));
        let clear = json!({
            "contractVersion": "0.1",
            "requestId": "r4",
            "correlationId": "c4",
            "kind": "command",
            "method": "diagnostics.clearOscAvatarCache",
            "commandId": "cmd-clear-1",
            "params": { "schemaVersion": "0.1" }
        });
        match request(
            Some(&running_svc),
            "diagnostics.clearOscAvatarCache",
            &clear,
            "r4",
            "c4",
        ) {
            FrameOutcome::Response(v) => {
                assert_eq!(v["error"]["code"], "vua.diagnostics.client_running");
            }
            _ => panic!("expected response"),
        }
    }
}

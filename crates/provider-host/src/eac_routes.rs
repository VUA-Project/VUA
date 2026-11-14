//! Wire adapter for `eac-probe v0.2` (`environment.inspectEac`,
//! `environment.configureEacExperimental`, `environment.terminateEacResidual`, and
//! `environment.launchEacRepair`).

use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde_json::{json, Value};
use vua_project_manager::eac_probe::v02::{EacProbeService, EacRepairError, EacTerminateError};

fn valid_identifier(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
    })
}

fn valid_command_envelope<'a>(
    request: &'a Value,
    id: &str,
    correlation: &str,
) -> Option<&'a serde_json::Map<String, Value>> {
    let keys = [
        "contractVersion",
        "requestId",
        "correlationId",
        "kind",
        "method",
        "commandId",
        "params",
    ];
    let obj = request.as_object()?;
    if obj.len() != keys.len() || !keys.iter().all(|k| obj.contains_key(*k)) {
        return None;
    }
    if obj.get("contractVersion") != Some(&json!("0.1"))
        || obj.get("kind") != Some(&json!("command"))
        || id.is_empty()
        || correlation.is_empty()
        || !valid_identifier(obj.get("commandId"))
    {
        return None;
    }
    obj.get("params")?.as_object()
}

pub fn invoke_wire(service: Option<&EacProbeService>, request: &Value) -> Value {
    let id = request["requestId"].as_str().unwrap_or("");
    let correlation = request["correlationId"].as_str().unwrap_or("");
    match self::request(service, request, id, correlation) {
        FrameOutcome::Response(value)
        | FrameOutcome::ProtocolError(value)
        | FrameOutcome::Exit(value) => value,
        FrameOutcome::ResponseAndEvent { response, .. } => response,
    }
}

pub(crate) fn request(
    service: Option<&EacProbeService>,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let method = request["method"].as_str().unwrap_or("");
    let error = |code, category| {
        FrameOutcome::Response(application_error(
            id,
            correlation,
            code,
            "errors.eac.unavailable",
            category,
        ))
    };

    match method {
        "environment.inspectEac" => {
            let keys = [
                "contractVersion",
                "requestId",
                "correlationId",
                "kind",
                "method",
                "params",
            ];
            let valid = request
                .as_object()
                .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
                && request["contractVersion"] == "0.1"
                && request["kind"] == "query"
                && !id.is_empty()
                && !correlation.is_empty()
                && request["params"]
                    .as_object()
                    .is_some_and(|p| p.len() == 1 && p.get("schemaVersion") == Some(&json!("0.2")));
            if !valid {
                return error("vua.eac_probe.invalid_params", "validation");
            }
            let Some(service) = service else {
                return error("vua.eac_probe.unavailable", "unavailable");
            };
            let snapshot = service.inspect();
            FrameOutcome::Response(application_success(id, json!({ "eacSnapshot": snapshot })))
        }
        "environment.configureEacExperimental" => {
            let Some(params) = valid_command_envelope(request, id, correlation) else {
                return error("vua.eac_probe.invalid_params", "validation");
            };
            let Some(enabled) = (params.len() == 1)
                .then(|| params.get("enabled").and_then(Value::as_bool))
                .flatten()
            else {
                return error("vua.eac_probe.invalid_params", "validation");
            };
            let Some(service) = service else {
                return error("vua.eac_probe.unavailable", "unavailable");
            };
            service.set_experimental_termination(enabled);
            FrameOutcome::Response(application_success(
                id,
                json!({ "enabled": service.experimental_termination() }),
            ))
        }
        "environment.terminateEacResidual" => {
            let Some(params) = valid_command_envelope(request, id, correlation) else {
                return error("vua.eac_terminate.invalid_params", "validation");
            };
            let param_keys = ["schemaVersion", "pid", "created", "path", "confirmed"];
            if params.len() != param_keys.len()
                || !param_keys.iter().all(|k| params.contains_key(*k))
                || params.get("schemaVersion") != Some(&json!("0.2"))
                || params.get("confirmed") != Some(&json!(true))
            {
                return error("vua.eac_terminate.invalid_params", "validation");
            }
            let Some(pid_u64) = params.get("pid").and_then(Value::as_u64) else {
                return error("vua.eac_terminate.invalid_params", "validation");
            };
            let Ok(pid) = u32::try_from(pid_u64) else {
                return error("vua.eac_terminate.invalid_params", "validation");
            };
            let Some(created) = params.get("created").and_then(Value::as_str).filter(|s| {
                !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
            }) else {
                return error("vua.eac_terminate.invalid_params", "validation");
            };
            let Some(path) = params
                .get("path")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            else {
                return error("vua.eac_terminate.invalid_params", "validation");
            };
            let Some(service) = service else {
                return error("vua.eac_terminate.unavailable", "unavailable");
            };
            match service.terminate_residual(pid, created, path, correlation) {
                Ok(outcome) => FrameOutcome::Response(application_success(
                    id,
                    serde_json::to_value(outcome).unwrap_or_else(|_| json!({})),
                )),
                Err(EacTerminateError::ExperimentalDisabled) => {
                    error("vua.eac_terminate.experimental_disabled", "permission")
                }
                Err(EacTerminateError::InvalidParams(_)) => {
                    error("vua.eac_terminate.invalid_params", "validation")
                }
                Err(EacTerminateError::ProcessUnreadable(_)) => {
                    error("vua.eac_terminate.process_unreadable", "external_failure")
                }
            }
        }
        "environment.launchEacRepair" => {
            let Some(params) = valid_command_envelope(request, id, correlation) else {
                return error("vua.eac_repair.invalid_params", "validation");
            };
            let param_keys = ["schemaVersion", "confirmed"];
            if params.len() != param_keys.len()
                || !param_keys.iter().all(|k| params.contains_key(*k))
                || params.get("schemaVersion") != Some(&json!("0.2"))
                || params.get("confirmed") != Some(&json!(true))
            {
                return error("vua.eac_repair.invalid_params", "validation");
            }
            let Some(service) = service else {
                return error("vua.eac_repair.unavailable", "unavailable");
            };
            match service.launch_repair() {
                Ok(outcome) => FrameOutcome::Response(application_success(
                    id,
                    serde_json::to_value(outcome).unwrap_or_else(|_| json!({})),
                )),
                Err(EacRepairError::ExperimentalDisabled) => {
                    error("vua.eac_repair.experimental_disabled", "permission")
                }
                Err(EacRepairError::ProcessUnreadable(_)) => {
                    error("vua.eac_repair.process_unreadable", "external_failure")
                }
            }
        }
        _ => error("vua.eac_probe.invalid_params", "validation"),
    }
}

//! Thin N2 wire adapter. Installation/module choices are not execution authority.
use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde_json::{json, Value};
use vua_orchestrator::external_tools::{ToolAction, ToolService};
pub(crate) fn request(
    service: Option<&ToolService>,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let command = request["method"] == "tools.actConnection";
    let keys = if command {
        vec![
            "contractVersion",
            "requestId",
            "correlationId",
            "kind",
            "method",
            "params",
            "commandId",
        ]
    } else {
        vec![
            "contractVersion",
            "requestId",
            "correlationId",
            "kind",
            "method",
            "params",
        ]
    };
    let action = request["params"]["action"]
        .as_str()
        .and_then(ToolAction::parse);
    let command_id = request["commandId"].as_str().unwrap_or("");
    let valid = request
        .as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
        && request["contractVersion"] == "0.1"
        && request["kind"] == if command { "command" } else { "query" }
        && ["requestId", "correlationId"]
            .iter()
            .all(|k| request[*k].as_str().is_some_and(|v| !v.is_empty()))
        && request["params"]
            .as_object()
            .is_some_and(|p| p.len() == if command { 2 } else { 1 })
        && request["params"]["toolId"] == "vrcft"
        && (!command
            || (action.is_some()
                && !command_id.is_empty()
                && command_id.len() <= 128
                && command_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))));
    let error = |code, category| {
        FrameOutcome::Response(application_error(
            id,
            correlation,
            code,
            "errors.externalTool.unavailable",
            category,
        ))
    };
    if !valid {
        return error("vua.external_tool.invalid_params", "validation");
    }
    let Some(service) = service else {
        return error("vua.external_tool.unavailable", "unavailable");
    };
    let result = if command {
        service.act(action.unwrap(), command_id)
    } else {
        service.observe()
    };
    match result {
        Ok(snapshot) => {
            FrameOutcome::Response(application_success(id, json!({"toolConnection":snapshot})))
        }
        Err("invalid_command") => error("vua.external_tool.invalid_command", "validation"),
        Err(_) => error("vua.external_tool.unavailable", "unavailable"),
    }
}

//! Wire-only adapter for the closed play-session Candidate family.
use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde_json::{json, Value};
use vua_project_manager::play_session::{PlayRoute, PlayService};
pub(crate) fn manager_apps(
    roots: Option<&vua_orchestrator::EnvironmentRoots>,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let keys = [
        "contractVersion",
        "requestId",
        "correlationId",
        "kind",
        "method",
        "params",
    ];
    if request["kind"] != "query"
        || request["contractVersion"] != "0.1"
        || !["requestId", "correlationId"]
            .iter()
            .all(|key| request[*key].as_str().is_some_and(|v| !v.is_empty()))
        || !request
            .as_object()
            .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
        || !request["params"].as_object().is_some_and(|p| p.is_empty())
    {
        return FrameOutcome::Response(application_error(
            id,
            correlation,
            "vua.manager_apps.invalid_params",
            "errors.playSession.unavailable",
            "validation",
        ));
    }
    match roots {
        Some(roots) => FrameOutcome::Response(application_success(
            id,
            json!({"managerApps": vua_project_manager::manager_apps::inspect(roots)}),
        )),
        None => FrameOutcome::Response(application_error(
            id,
            correlation,
            "vua.manager_apps.unavailable",
            "errors.playSession.unavailable",
            "unavailable",
        )),
    }
}
pub(crate) fn request(
    service: Option<&PlayService>,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let method = request["method"].as_str().unwrap_or("");
    let command = method != "environment.observePlay";
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
    let command_id = request["commandId"].as_str().unwrap_or("");
    let route = request["params"]["route"]
        .as_str()
        .and_then(PlayRoute::parse);
    let valid = request
        .as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
        && request["contractVersion"] == "0.1"
        && request["kind"] == if command { "command" } else { "query" }
        && ["requestId", "correlationId"]
            .iter()
            .all(|key| request[*key].as_str().is_some_and(|v| !v.is_empty()))
        && request["params"]
            .as_object()
            .is_some_and(|p| p.len() == 1 && p.contains_key("route"))
        && route.is_some()
        && (!command
            || (!command_id.is_empty()
                && command_id.len() <= 128
                && command_id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))));
    let error = |code, category| {
        FrameOutcome::Response(application_error(
            id,
            correlation,
            code,
            "errors.playSession.unavailable",
            category,
        ))
    };
    if !valid {
        return error("vua.play_session.invalid_params", "validation");
    }
    let Some(service) = service else {
        return error("vua.play_session.unavailable", "unavailable");
    };
    let route = route.unwrap();
    let result = match method {
        "environment.observePlay" => service.observe(route),
        "environment.startPlay" => service.start(route, command_id),
        "environment.stopPlay" => service.stop(route, command_id),
        _ => return error("vua.play_session.invalid_params", "validation"),
    };
    match result {
        Ok(snapshot) => {
            FrameOutcome::Response(application_success(id, json!({"playSession": snapshot})))
        }
        Err("invalid_command") => error("vua.play_session.invalid_command", "validation"),
        Err(_) => error("vua.play_session.unavailable", "unavailable"),
    }
}

//! Closed, read-only VRChat game-window observation query
//! (`environment.observeGameWindow`, schemas/game-window-observe/v0.1).
//! Params are an empty closed set; the observation itself is a stateless
//! direct call into the project-manager primitive — the route adds the wire
//! mapping only, never observation logic of its own.
use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde_json::{json, Value};

pub(crate) fn request(request: &Value, id: &str, correlation: &str) -> FrameOutcome {
    let expected = [
        "contractVersion",
        "requestId",
        "correlationId",
        "kind",
        "method",
        "params",
    ];
    let shape_valid = request.as_object().is_some_and(|envelope| {
        envelope.len() == expected.len() && expected.iter().all(|key| envelope.contains_key(*key))
    }) && request["kind"] == "query"
        && request
            .get("requestId")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
        && request
            .get("correlationId")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
        && request["params"]
            .as_object()
            .is_some_and(|params| params.is_empty());
    if !shape_valid {
        return FrameOutcome::Response(application_error(
            id,
            correlation,
            "vua.game_window.invalid_params",
            "errors.gameWindow.invalidParams",
            "validation",
        ));
    }
    match vua_project_manager::game_window::observe_game_window(
        &vua_project_manager::game_window::os_source::WindowsGameWindowSource,
        &vua_orchestrator::SystemClock,
    ) {
        Ok(observation) => {
            FrameOutcome::Response(application_success(id, json!({"gameWindow": observation})))
        }
        // OS enumeration failure (or a non-Windows host) is the typed
        // unavailable — never a fabricated empty observation.
        Err(_) => FrameOutcome::Response(application_error(
            id,
            correlation,
            "vua.game_window.unavailable",
            "errors.gameWindow.unavailable",
            "unavailable",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Value {
        json!({"contractVersion":"0.1", "requestId":"g", "correlationId":"g", "kind":"query", "method":"environment.observeGameWindow", "params":{}})
    }

    fn code(query: &Value) -> String {
        match request(query, "g", "g") {
            FrameOutcome::Response(value) => value["error"]["code"].as_str().unwrap().to_owned(),
            _ => panic!("expected response"),
        }
    }

    #[test]
    fn shape_violations_answer_invalid_params_before_any_observation() {
        for mutation in [
            json!({"params": {"follow": true}}),
            json!({"kind": "command"}),
            json!({"requestId": ""}),
            json!({"correlationId": ""}),
        ] {
            let mut query = base();
            let object = query.as_object_mut().unwrap();
            for (key, value) in mutation.as_object().unwrap() {
                object.insert(key.clone(), value.clone());
            }
            assert_eq!(code(&query), "vua.game_window.invalid_params", "{query}");
        }
        let mut missing = base();
        missing.as_object_mut().unwrap().remove("params");
        assert_eq!(code(&missing), "vua.game_window.invalid_params");
        let mut extra = base();
        extra
            .as_object_mut()
            .unwrap()
            .insert("extra".to_owned(), json!(true));
        assert_eq!(code(&extra), "vua.game_window.invalid_params");
    }
}

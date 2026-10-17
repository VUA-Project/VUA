use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde_json::{json, Value};
use vua_orchestrator::{
    deployment::{DeploymentIntent, DeploymentService},
    scenario_environment::{check_scenario, scenario_sop, ScenarioSopParams},
};
pub(crate) fn request(
    service: Option<&DeploymentService>,
    method: &str,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let reject = |code: &str| {
        FrameOutcome::Response(application_error(
            id,
            correlation,
            code,
            "errors.scenario.failed",
            "validation",
        ))
    };
    if request["kind"] != "query" {
        return reject("vua.scenario.invalid_params");
    }
    let Some(params) = request["params"].as_object() else {
        return reject("vua.scenario.invalid_params");
    };
    let field = if method == "environment.getScenarioSop" {
        "scenario"
    } else {
        "intent"
    };
    if params.len() != 2
        || params.get("schemaVersion") != Some(&json!("0.1"))
        || !params.contains_key(field)
    {
        return reject("vua.scenario.invalid_params");
    }
    let result = if method == "environment.getScenarioSop" {
        serde_json::from_value::<ScenarioSopParams>(params[field].clone())
            .map_err(|_| "vua.scenario.invalid_params")
            .and_then(|p| scenario_sop(&p))
    } else {
        let intent = match serde_json::from_value::<DeploymentIntent>(params[field].clone()) {
            Ok(value) => value,
            Err(_) => return reject("vua.scenario.invalid_params"),
        };
        if let Err(code) = intent.validate() {
            return reject(code);
        }
        let Some(service) = service else {
            return FrameOutcome::Response(application_error(
                id,
                correlation,
                "vua.scenario.unavailable",
                "errors.scenario.failed",
                "unavailable",
            ));
        };
        check_scenario(service, &intent)
    };
    match result {
        Ok(value) => FrameOutcome::Response(application_success(id, value)),
        Err(code) => reject(code),
    }
}

//! Closed, read-only network query. The service owns route selection; the adapter owns IO.
use crate::provider_host::{application_error, application_success, FrameOutcome};
use serde::Deserialize;
use serde_json::{json, Value};
use vua_orchestrator::network::{NetworkIntent, NetworkService};

pub(crate) fn request(
    service: Option<&NetworkService>,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let reject = |code, category| {
        FrameOutcome::Response(application_error(
            id,
            correlation,
            code,
            "errors.network.failed",
            category,
        ))
    };
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Params {
        intent: NetworkIntent,
    }
    let expected = [
        "contractVersion",
        "requestId",
        "correlationId",
        "kind",
        "method",
        "params",
    ];
    if request
        .as_object()
        .is_none_or(|v| v.len() != expected.len() || expected.iter().any(|k| !v.contains_key(*k)))
        || request["kind"] != "query"
        || request
            .get("requestId")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        || request
            .get("correlationId")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        return reject("vua.network.invalid_intent", "validation");
    }
    if request["method"] == "environment.testWebsites" {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Websites {
            urls: Vec<String>,
        }
        let Ok(params) = serde_json::from_value::<Websites>(request["params"].clone()) else {
            return reject("vua.network.invalid_intent", "validation");
        };
        if params.urls.is_empty()
            || params.urls.len() > 12
            || params
                .urls
                .iter()
                .any(|u| !vua_project_manager::network_probe::valid_website_url(u))
            || params
                .urls
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != params.urls.len()
        {
            return reject("vua.network.invalid_intent", "validation");
        }
        let Some(service) = service else {
            return reject("vua.network.unavailable", "unavailable");
        };
        return FrameOutcome::Response(application_success(
            id,
            json!({"websiteTests": service.test_websites(&params.urls)}),
        ));
    }
    let Ok(params) = serde_json::from_value::<Params>(request["params"].clone()) else {
        return reject("vua.network.invalid_intent", "validation");
    };
    let Some(service) = service else {
        return reject("vua.network.unavailable", "unavailable");
    };
    FrameOutcome::Response(application_success(
        id,
        json!({"networkReport": service.check(params.intent)}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn website_query_validates_custom_destinations_before_service_access() {
        let base = json!({"contractVersion":"0.1", "requestId":"w", "correlationId":"w", "kind":"query", "method":"environment.testWebsites", "params":{"urls":["https://github.com/"]}});
        let code = |query: &Value| match request(None, query, "w", "w") {
            FrameOutcome::Response(value) => value["error"]["code"].as_str().unwrap().to_owned(),
            _ => panic!("expected response"),
        };
        assert_eq!(code(&base), "vua.network.unavailable");
        for params in [
            json!({"urls":[]}),
            json!({"urls":["http://example.com"]}),
            json!({"urls":["https://u:p@example.com"]}),
            json!({"urls":["https://github.com/", "https://github.com/"]}),
            json!({"urls":["https://github.com/"],"cookie":"private"}),
        ] {
            let mut query = base.clone();
            query["params"] = params;
            assert_eq!(code(&query), "vua.network.invalid_intent");
        }
    }
    #[test]
    fn validates_before_absence_and_never_accepts_a_url_or_cookie() {
        let query = json!({"contractVersion":"0.1", "requestId":"n", "correlationId":"n", "kind":"query", "method":"environment.checkNetwork", "params":{"intent":{"route":"desktop_play", "region":"auto"}}});
        let code = |q: &Value| match request(None, q, "n", "n") {
            FrameOutcome::Response(v) => v["error"]["code"].as_str().unwrap().to_owned(),
            _ => panic!("query must return a response"),
        };
        assert_eq!(code(&query), "vua.network.unavailable");
        for (key, value) in [
            ("url", json!("http://localhost")),
            ("cookie", json!("private")),
        ] {
            let mut invalid = query.clone();
            invalid["params"][key] = value;
            assert_eq!(code(&invalid), "vua.network.invalid_intent");
        }
        let mut invalid = query.clone();
        invalid["kind"] = json!("command");
        assert_eq!(code(&invalid), "vua.network.invalid_intent");
    }
}

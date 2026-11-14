use crate::provider_host::{
    app_error_category, application_error, application_success, FrameOutcome,
};
use serde_json::Value;
use std::sync::Arc;
use vua_acquisition::terms::{preset_ids, valid_product_id, TermsService};

fn valid_params(method: &str, params: &Value) -> bool {
    let Some(p) = params.as_object() else {
        return false;
    };
    if p.get("schemaVersion").and_then(Value::as_str) != Some("0.1") {
        return false;
    }
    match method {
        "terms.refreshLibrary" => p.len() == 1,
        "terms.refreshProduct" | "terms.getProduct" => {
            p.len() == 2
                && p.get("productId")
                    .and_then(Value::as_str)
                    .is_some_and(valid_product_id)
        }
        "terms.checkUse" => {
            p.len() == 3
                && p.get("presetId")
                    .and_then(Value::as_str)
                    .is_some_and(|id| preset_ids().contains(&id))
                && p.get("productIds")
                    .and_then(Value::as_array)
                    .is_some_and(|ids| {
                        !ids.is_empty()
                            && ids.len() <= 500
                            && ids.iter().all(|v| v.as_str().is_some_and(valid_product_id))
                            && ids.iter().collect::<std::collections::HashSet<_>>().len()
                                == ids.len()
                    })
        }
        _ => false,
    }
}

pub(crate) fn request(
    service: Option<&Arc<TermsService>>,
    method: &str,
    request: &Value,
    id: &str,
    correlation: &str,
) -> FrameOutcome {
    let command = ["terms.refreshProduct", "terms.refreshLibrary"].contains(&method);
    let command_id = request
        .get("commandId")
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 256
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
        });
    let response = if request["kind"] != if command { "command" } else { "query" }
        || !valid_params(method, &request["params"])
        || command && command_id.is_none()
    {
        application_error(
            id,
            correlation,
            "vua.terms.invalid_params",
            "errors.terms.failed",
            "validation",
        )
    } else if let Some(service) = service {
        let result = match method {
            "terms.refreshProduct" => service.submit(
                request["params"]["productId"].as_str(),
                correlation,
                command_id.expect("validated command"),
            ),
            "terms.refreshLibrary" => {
                service.submit(None, correlation, command_id.expect("validated command"))
            }
            "terms.getProduct" => service
                .product(
                    request["params"]["productId"]
                        .as_str()
                        .expect("validated product"),
                )
                .map(|v| serde_json::to_value(v).expect("terms detail")),
            "terms.checkUse" => {
                let ids: Vec<String> = request["params"]["productIds"]
                    .as_array()
                    .expect("validated IDs")
                    .iter()
                    .map(|v| v.as_str().expect("validated ID").into())
                    .collect();
                service
                    .check_use(
                        request["params"]["presetId"]
                            .as_str()
                            .expect("validated preset"),
                        &ids,
                    )
                    .map(|v| serde_json::to_value(v).expect("use check"))
            }
            _ => unreachable!("validated method"),
        };
        match result {
            Ok(value) => application_success(id, value),
            Err(error) => application_error(
                id,
                correlation,
                &error.code,
                &error.message_key,
                app_error_category(error.category),
            ),
        }
    } else {
        application_error(
            id,
            correlation,
            "vua.terms.unavailable",
            "errors.terms.failed",
            "unavailable",
        )
    };
    FrameOutcome::Response(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn closed_params_and_kind_are_checked_before_service_absence() {
        for (method, kind, params, expected) in [
            (
                "terms.refreshLibrary",
                "command",
                json!({"schemaVersion":"0.1"}),
                "vua.terms.unavailable",
            ),
            (
                "terms.getProduct",
                "query",
                json!({"schemaVersion":"0.1","productId":"booth:1"}),
                "vua.terms.unavailable",
            ),
            (
                "terms.getProduct",
                "command",
                json!({"schemaVersion":"0.1","productId":"booth:1"}),
                "vua.terms.invalid_params",
            ),
            (
                "terms.refreshLibrary",
                "command",
                json!({"schemaVersion":"0.1","url":"https://example.com"}),
                "vua.terms.invalid_params",
            ),
            (
                "terms.checkUse",
                "query",
                json!({"schemaVersion":"0.1","presetId":"vrchat_personal","productIds":["booth:1","booth:1"]}),
                "vua.terms.invalid_params",
            ),
            (
                "terms.checkUse",
                "query",
                json!({"schemaVersion":"0.2","presetId":"vrchat_personal","productIds":["booth:1"]}),
                "vua.terms.invalid_params",
            ),
            (
                "terms.getProduct",
                "query",
                json!({"schemaVersion":"0.2","productId":"booth:1"}),
                "vua.terms.invalid_params",
            ),
        ] {
            let FrameOutcome::Response(reply) = request(
                None,
                method,
                &json!({"kind":kind,"commandId":"test","params":params}),
                "id",
                "id",
            ) else {
                panic!("response")
            };
            assert_eq!(reply["error"]["code"], expected);
        }
    }
}

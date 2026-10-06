//! Shared wire vectors are checked by Rust JSON Schema and the TypeScript consumer.
use serde_json::Value;
use std::sync::Arc;
use vua_orchestrator::{network::*, SystemClock};

#[test]
fn network_vectors_and_service_output_conform() {
    let schema: Value = serde_json::from_str(include_str!(
        "../../../schemas/environment-network/v0.1/network.schema.json"
    ))
    .unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    let vectors: Vec<Value> = serde_json::from_str(include_str!(
        "../../../schemas/environment-network/v0.1/vectors.json"
    ))
    .unwrap();
    for vector in vectors {
        assert_eq!(
            validator.is_valid(&vector["value"]),
            vector["valid"].as_bool().unwrap(),
            "{}",
            vector["name"]
        );
        if vector["kind"] == "intent" {
            assert_eq!(
                serde_json::from_value::<NetworkIntent>(vector["value"].clone()).is_ok(),
                vector["valid"].as_bool().unwrap()
            );
        }
    }
    struct Probe;
    impl NetworkProbe for Probe {
        fn test_websites(&self, _: &[String]) -> Vec<WebsiteObservation> {
            Vec::new()
        }
        fn probe(
            &self,
            targets: &[NetworkTarget],
            _: bool,
        ) -> (NetworkRegion, Vec<NetworkObservation>) {
            (
                NetworkRegion::Unknown,
                targets
                    .iter()
                    .map(|&target| NetworkObservation {
                        target,
                        status: NetworkStatus::HttpError,
                        elapsed_ms: 100,
                        http_status: Some(403),
                    })
                    .collect(),
            )
        }
    }
    let service = NetworkService::new(Arc::new(Probe), Arc::new(SystemClock));
    for route in [NetworkRoute::DesktopPlay, NetworkRoute::PicoPcvr] {
        let report = serde_json::to_value(service.check(NetworkIntent {
            route,
            region: RegionPreference::Auto,
        }))
        .unwrap();
        assert!(
            validator.is_valid(&report),
            "{:?}",
            validator.iter_errors(&report).collect::<Vec<_>>()
        );
    }
}

//! First-play network checks. These observations guide the user; they never gate
//! installation or declare that a game session or headset connection is ready.
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const NETWORK_SCHEMA: &str = "0.1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkRoute {
    DesktopPlay,
    PicoPcvr,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegionPreference {
    Auto,
    ChinaMainland,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkRegion {
    ChinaMainland,
    Other,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkIntent {
    pub route: NetworkRoute,
    pub region: RegionPreference,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkTarget {
    SteamStore,
    SteamCommunity,
    SteamDownload,
    VrchatWeb,
    PicoConnect,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkStatus {
    Reachable,
    HttpError,
    Redirected,
    Timeout,
    ConnectionFailed,
    ProbeError,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkObservation {
    pub target: NetworkTarget,
    pub status: NetworkStatus,
    /// Time to HTTP response headers (including redirects), not game ping or bandwidth.
    pub elapsed_ms: u64,
    pub http_status: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkReport {
    pub schema_version: String,
    pub intent: NetworkIntent,
    pub detected_region: NetworkRegion,
    pub effective_region: NetworkRegion,
    pub captured_at: String,
    pub duration_ms: u64,
    pub results: Vec<NetworkObservation>,
}

/// One website card's observation, without browser cookies or response bodies.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebsiteObservation {
    pub url: String,
    pub status: NetworkStatus,
    pub elapsed_ms: u64,
    pub http_status: Option<u16>,
}

/// Adapter owns bounded HTTPS IO. Website URLs are explicit user choices; the
/// legacy region probe owns its fixed targets. Neither accepts commands or credentials.
pub trait NetworkProbe: Send + Sync {
    fn test_websites(&self, urls: &[String]) -> Vec<WebsiteObservation>;
    fn probe(
        &self,
        targets: &[NetworkTarget],
        detect_region: bool,
    ) -> (NetworkRegion, Vec<NetworkObservation>);
}

pub struct NetworkService {
    probe: Arc<dyn NetworkProbe>,
    clock: Arc<dyn crate::Clock>,
}

impl NetworkService {
    /// Caller selects the cards; the adapter bounds concurrent, read-only IO.
    pub fn test_websites(&self, urls: &[String]) -> Vec<WebsiteObservation> {
        self.probe.test_websites(urls)
    }
    pub fn new(probe: Arc<dyn NetworkProbe>, clock: Arc<dyn crate::Clock>) -> Self {
        Self { probe, clock }
    }

    pub fn check(&self, intent: NetworkIntent) -> NetworkReport {
        let started = std::time::Instant::now();
        let mut targets = vec![
            NetworkTarget::SteamStore,
            NetworkTarget::SteamCommunity,
            NetworkTarget::SteamDownload,
            NetworkTarget::VrchatWeb,
        ];
        if intent.route == NetworkRoute::PicoPcvr {
            targets.push(NetworkTarget::PicoConnect);
        }
        let (detected_region, results) = self
            .probe
            .probe(&targets, intent.region == RegionPreference::Auto);
        let effective_region = match intent.region {
            RegionPreference::Auto => detected_region,
            RegionPreference::ChinaMainland => NetworkRegion::ChinaMainland,
            RegionPreference::Other => NetworkRegion::Other,
        };
        NetworkReport {
            schema_version: NETWORK_SCHEMA.to_owned(),
            intent,
            detected_region,
            effective_region,
            captured_at: self.clock.now_rfc3339(),
            duration_ms: started.elapsed().as_millis() as u64,
            results,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Probe;
    impl NetworkProbe for Probe {
        fn test_websites(&self, _: &[String]) -> Vec<WebsiteObservation> {
            Vec::new()
        }
        fn probe(
            &self,
            targets: &[NetworkTarget],
            detect_region: bool,
        ) -> (NetworkRegion, Vec<NetworkObservation>) {
            (
                if detect_region {
                    NetworkRegion::ChinaMainland
                } else {
                    NetworkRegion::Unknown
                },
                targets
                    .iter()
                    .map(|&target| NetworkObservation {
                        target,
                        status: NetworkStatus::Timeout,
                        elapsed_ms: 6000,
                        http_status: None,
                    })
                    .collect(),
            )
        }
    }
    #[test]
    fn scope_region_override_and_partial_failure_are_observations() {
        let service = NetworkService::new(Arc::new(Probe), Arc::new(crate::SystemClock));
        let desktop = service.check(NetworkIntent {
            route: NetworkRoute::DesktopPlay,
            region: RegionPreference::Auto,
        });
        assert_eq!(desktop.results.len(), 4);
        assert_eq!(desktop.effective_region, NetworkRegion::ChinaMainland);
        let pico = service.check(NetworkIntent {
            route: NetworkRoute::PicoPcvr,
            region: RegionPreference::Other,
        });
        assert_eq!(pico.results.len(), 5);
        assert_eq!(pico.results[4].target, NetworkTarget::PicoConnect);
        assert_eq!(pico.detected_region, NetworkRegion::Unknown);
        assert_eq!(pico.effective_region, NetworkRegion::Other);
        assert!(pico
            .results
            .iter()
            .all(|r| r.status == NetworkStatus::Timeout));
    }
}

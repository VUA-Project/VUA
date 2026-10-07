//! Download-network region detection. Keep only the country category; no IP address,
//! location history or account data is stored or exposed to the application contract.
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use vua_orchestrator::deployment::DownloadRegion;

#[derive(Default)]
pub(super) struct RegionProbe(Mutex<Option<(Instant, DownloadRegion)>>);

impl RegionProbe {
    pub fn detect(&self) -> DownloadRegion {
        let Ok(mut cache) = self.0.lock() else {
            return DownloadRegion::Unknown;
        };
        if let Some((at, region)) = *cache {
            if at.elapsed() < Duration::from_secs(600) {
                return region;
            }
        }
        let region = detect_network_region().unwrap_or_default();
        *cache = Some((Instant::now(), region));
        region
    }
}

/// The public HTTPS trace reports the current request's exit country. This describes
/// the download network (including a user's proxy), not their physical home address.
fn detect_network_region() -> Option<DownloadRegion> {
    let runtime = tokio::runtime::Runtime::new().ok()?;
    runtime.block_on(async {
        let client = reqwest::Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(4))
            .build()
            .ok()?;
        let response = client
            .get("https://www.cloudflare.com/cdn-cgi/trace")
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let bytes = response.bytes().await.ok()?;
        if bytes.len() > 8192 {
            return None;
        }
        parse_region(std::str::from_utf8(&bytes).ok()?)
    })
}

pub(super) fn parse_region(trace: &str) -> Option<DownloadRegion> {
    let country = trace.lines().find_map(|line| line.strip_prefix("loc="))?;
    if country.len() != 2 || !country.bytes().all(|c| c.is_ascii_uppercase()) {
        return None;
    }
    Some(if country == "CN" {
        DownloadRegion::ChinaMainland
    } else {
        DownloadRegion::Other
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn country_category_excludes_addresses_and_distinguishes_mainland() {
        assert_eq!(
            parse_region("ip=private\nloc=CN\n"),
            Some(DownloadRegion::ChinaMainland)
        );
        for country in ["US", "JP", "HK", "TW"] {
            assert_eq!(
                parse_region(&format!("loc={country}\n")),
                Some(DownloadRegion::Other)
            );
        }
        for text in ["", "loc=unknown", "loc=", "loc=cn", "ip=private"] {
            assert_eq!(parse_region(text), None);
        }
    }
}

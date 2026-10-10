//! Read-only, bounded first-play HTTPS probes. A fresh client never borrows browser
//! cookies. Regional targets are adapter-owned; website cards supply validated
//! HTTPS destinations. Responses return classifications, never page bodies or logs.
use reqwest::{redirect::Policy, Client};
use std::time::{Duration, Instant};
use vua_orchestrator::network::{
    NetworkObservation, NetworkProbe, NetworkRegion, NetworkStatus, NetworkTarget,
    WebsiteObservation,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(6);
const BATCH_TIMEOUT: Duration = Duration::from_secs(8);
pub struct HttpsNetworkProbe;

/// Same boundary as the desktop contract: explicit HTTPS URLs, no embedded login.
pub fn valid_website_url(value: &str) -> bool {
    value.len() <= 2048
        && value.trim() == value
        && url::Url::parse(value).is_ok_and(|u| {
            u.scheme() == "https"
                && u.host_str().is_some()
                && u.username().is_empty()
                && u.password().is_none()
                && u.fragment().is_none()
                && u.port_or_known_default() == Some(443)
        })
}

fn website_failure(url: &str, status: NetworkStatus, elapsed_ms: u64) -> WebsiteObservation {
    WebsiteObservation {
        url: url.to_owned(),
        status,
        elapsed_ms,
        http_status: None,
    }
}

/// Fetch headers only, with the OS/process network route. No cookies or credentials
/// are installed on this fresh client. A HEAD-only denial retries GET to headers,
/// then drops the response without consuming the page body.
async fn test_website(value: String) -> WebsiteObservation {
    let started = Instant::now();
    let source = value.clone();
    let client = Client::builder()
        .https_only(true)
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(Duration::from_secs(4))
        .user_agent("VUA-Website-Test/0.1")
        .redirect(Policy::custom(move |a| {
            if follow_website_redirect(&source, a.url().as_str(), a.previous().len()) {
                a.follow()
            } else {
                a.stop()
            }
        }))
        .build();
    let Ok(client) = client else {
        return website_failure(&value, NetworkStatus::ProbeError, 0);
    };
    let result = tokio::time::timeout(REQUEST_TIMEOUT, async {
        let response = client.head(&value).send().await?;
        if matches!(response.status().as_u16(), 405 | 501) {
            drop(response);
            client.get(&value).send().await
        } else {
            Ok(response)
        }
    })
    .await;
    let elapsed_ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(Ok(response)) => WebsiteObservation {
            url: value,
            status: classify_http(response.status().as_u16()),
            elapsed_ms,
            http_status: Some(response.status().as_u16()),
        },
        Ok(Err(error)) => website_failure(
            &value,
            if error.is_timeout() {
                NetworkStatus::Timeout
            } else {
                NetworkStatus::ConnectionFailed
            },
            elapsed_ms,
        ),
        Err(_) => website_failure(&value, NetworkStatus::Timeout, elapsed_ms),
    }
}

/// Approximate regional timing stays at the documented regional service origin.
/// Ordinary user-selected website tests retain the existing HTTPS redirect limit.
fn follow_website_redirect(source: &str, destination: &str, hops: usize) -> bool {
    !matches!(
        source,
        "https://objectstorage.us-sanjose-1.oraclecloud.com/"
            | "https://objectstorage.us-ashburn-1.oraclecloud.com/"
            | "https://objectstorage.ap-tokyo-1.oraclecloud.com/"
            | "https://objectstorage.eu-amsterdam-1.oraclecloud.com/"
    ) && hops <= 3
        && valid_website_url(destination)
}

fn endpoint(target: NetworkTarget) -> &'static str {
    match target {
        NetworkTarget::SteamStore => "https://store.steampowered.com/join/",
        NetworkTarget::SteamCommunity => "https://steamcommunity.com/",
        NetworkTarget::SteamDownload => {
            "https://cdn.fastly.steamstatic.com/client/installer/SteamSetup.exe"
        }
        NetworkTarget::VrchatWeb => "https://vrchat.com/home",
        NetworkTarget::PicoConnect => "https://www.picoxr.com/global/software/pico-connect",
    }
}

fn vendor_host(target: NetworkTarget, host: &str) -> bool {
    let domains: &[&str] = match target {
        NetworkTarget::SteamStore => &["steampowered.com"],
        NetworkTarget::SteamCommunity => &["steamcommunity.com"],
        NetworkTarget::SteamDownload => &["steamstatic.com", "steamcontent.com"],
        NetworkTarget::VrchatWeb => &["vrchat.com"],
        NetworkTarget::PicoConnect => &["picoxr.com"],
    };
    domains
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

fn client(target: Option<NetworkTarget>) -> Result<Client, reqwest::Error> {
    Client::builder()
        .https_only(true)
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(Duration::from_secs(4))
        .user_agent("VUA-Network-Check/0.1")
        .redirect(Policy::custom(move |attempt| {
            // Stop, rather than fetch an untrusted redirect or convert it into success.
            if attempt.previous().len() <= 3
                && attempt.url().scheme() == "https"
                && attempt.url().username().is_empty()
                && attempt.url().password().is_none()
                && attempt.url().port_or_known_default() == Some(443)
                && target
                    .is_some_and(|t| attempt.url().host_str().is_some_and(|h| vendor_host(t, h)))
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
}

fn observation(
    target: NetworkTarget,
    status: NetworkStatus,
    started: Instant,
    http_status: Option<u16>,
) -> NetworkObservation {
    NetworkObservation {
        target,
        status,
        elapsed_ms: started.elapsed().as_millis() as u64,
        http_status,
    }
}

async fn probe(target: NetworkTarget) -> NetworkObservation {
    let started = Instant::now();
    let Ok(client) = client(Some(target)) else {
        return observation(target, NetworkStatus::ProbeError, started, None);
    };
    probe_url(&client, target, endpoint(target), started).await
}

// Kept private: production callers can only select the fixed target catalog.
// Tests use a loopback server to exercise transport behavior without live Internet.
async fn probe_url(
    client: &Client,
    target: NetworkTarget,
    url: &str,
    started: Instant,
) -> NetworkObservation {
    let result = client.head(url).send().await;
    match result {
        Ok(response) => {
            let code = response.status();
            let status = classify_http(code.as_u16());
            // HEAD reads no installer or page body. Even an HTTP denial is useful:
            // it means the server replied, not that the user's Internet is offline.
            observation(target, status, started, Some(code.as_u16()))
        }
        Err(error) => observation(
            target,
            if error.is_timeout() {
                NetworkStatus::Timeout
            } else {
                NetworkStatus::ConnectionFailed
            },
            started,
            None,
        ),
    }
}

fn classify_http(code: u16) -> NetworkStatus {
    match code {
        200..=299 => NetworkStatus::Reachable,
        300..=399 => NetworkStatus::Redirected,
        _ => NetworkStatus::HttpError,
    }
}

async fn region() -> NetworkRegion {
    let Ok(client) = client(None) else {
        return NetworkRegion::Unknown;
    };
    let Ok(mut response) = client
        .get("https://www.cloudflare.com/cdn-cgi/trace")
        .send()
        .await
    else {
        return NetworkRegion::Unknown;
    };
    if !response.status().is_success() {
        return NetworkRegion::Unknown;
    }
    // This endpoint includes an IP. Consume a maximum of 8 KiB in memory, extract
    // only loc, then discard the body. Never serialize, cache or log its contents.
    let mut bytes = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 8192 => bytes.extend_from_slice(&chunk),
            Ok(None) => break,
            _ => return NetworkRegion::Unknown,
        }
    }
    match crate::unity_download_region::parse_region(&String::from_utf8_lossy(&bytes)) {
        Some(vua_orchestrator::deployment::DownloadRegion::ChinaMainland) => {
            NetworkRegion::ChinaMainland
        }
        Some(vua_orchestrator::deployment::DownloadRegion::Other) => NetworkRegion::Other,
        _ => NetworkRegion::Unknown,
    }
}

impl NetworkProbe for HttpsNetworkProbe {
    fn test_websites(&self, urls: &[String]) -> Vec<WebsiteObservation> {
        // Validate again at the IO boundary, even when called outside Provider.
        if urls.is_empty() || urls.len() > 12 || urls.iter().any(|u| !valid_website_url(u)) {
            return urls
                .iter()
                .map(|u| website_failure(u, NetworkStatus::ProbeError, 0))
                .collect();
        }
        let started = Instant::now();
        let Ok(runtime) = tokio::runtime::Runtime::new() else {
            return urls
                .iter()
                .map(|u| website_failure(u, NetworkStatus::ProbeError, 0))
                .collect();
        };
        let observations = runtime.block_on(async {
            let mut pending = tokio::task::JoinSet::new();
            for value in urls {
                pending.spawn(test_website(value.clone()));
            }
            let mut results = Vec::new();
            let _ = tokio::time::timeout(BATCH_TIMEOUT, async {
                while let Some(result) = pending.join_next().await {
                    if let Ok(value) = result {
                        results.push(value);
                    }
                }
            })
            .await;
            pending.abort_all();
            urls.iter()
                .map(|value| {
                    results
                        .iter()
                        .find(|r| &r.url == value)
                        .cloned()
                        .unwrap_or_else(|| {
                            website_failure(
                                value,
                                NetworkStatus::Timeout,
                                started.elapsed().as_millis() as u64,
                            )
                        })
                })
                .collect()
        });
        runtime.shutdown_background();
        observations
    }
    fn probe(
        &self,
        targets: &[NetworkTarget],
        detect_region: bool,
    ) -> (NetworkRegion, Vec<NetworkObservation>) {
        let started = Instant::now();
        let failures = |status| {
            targets
                .iter()
                .map(|&t| observation(t, status, started, None))
                .collect()
        };
        let Ok(runtime) = tokio::runtime::Runtime::new() else {
            return (NetworkRegion::Unknown, failures(NetworkStatus::ProbeError));
        };
        let result = runtime.block_on(async {
            let mut pending = tokio::task::JoinSet::new();
            for &target in targets {
                pending.spawn(probe(target));
            }
            let region_task = tokio::spawn(async move {
                if detect_region {
                    region().await
                } else {
                    NetworkRegion::Unknown
                }
            });
            let mut results = Vec::new();
            let _ = tokio::time::timeout(BATCH_TIMEOUT, async {
                while let Some(result) = pending.join_next().await {
                    if let Ok(value) = result {
                        results.push(value);
                    }
                }
            })
            .await;
            pending.abort_all();
            let detected =
                tokio::time::timeout(BATCH_TIMEOUT.saturating_sub(started.elapsed()), region_task)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or(NetworkRegion::Unknown);
            // Stable order and one result per target, including a batch deadline.
            let ordered = targets
                .iter()
                .map(|&target| {
                    results
                        .iter()
                        .find(|r| r.target == target)
                        .cloned()
                        .unwrap_or_else(|| {
                            observation(target, NetworkStatus::Timeout, started, None)
                        })
                })
                .collect();
            (detected, ordered)
        });
        // OS DNS resolution may outlive the cancelled request on a blocking
        // worker. Do not let runtime teardown turn the UI deadline into a hang.
        runtime.shutdown_background();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn website_destinations_exclude_credentials_and_non_https() {
        assert!(valid_website_url("https://github.com/"));
        for value in [
            "http://github.com",
            "https://user:secret@example.com",
            "file:///tmp/test",
            "https://example.com:8443",
            "https://example.com/#secret",
        ] {
            assert!(!valid_website_url(value), "{value}");
        }
    }

    fn serve_once(status: u16, delay: Duration) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/probe", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = [0; 4096];
            let count = socket.read(&mut bytes).unwrap();
            std::thread::sleep(delay);
            let _ = write!(
                socket,
                "HTTP/1.1 {status} Test\r\nContent-Length: 99999999\r\nConnection: close\r\n\r\n"
            );
            String::from_utf8_lossy(&bytes[..count]).into_owned()
        });
        (url, handle)
    }

    #[test]
    fn network_transport_reads_headers_only_and_returns_partial_errors() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .timeout(Duration::from_millis(300))
            .build()
            .unwrap();
        for (code, expected) in [
            (200, NetworkStatus::Reachable),
            (403, NetworkStatus::HttpError),
            (302, NetworkStatus::Redirected),
        ] {
            let (url, server) = serve_once(code, Duration::ZERO);
            let result = runtime.block_on(probe_url(
                &client,
                NetworkTarget::SteamStore,
                &url,
                Instant::now(),
            ));
            assert_eq!(result.status, expected);
            assert_eq!(result.http_status, Some(code));
            let request = server.join().unwrap();
            assert!(request.starts_with("HEAD /probe "));
            assert!(!request.to_ascii_lowercase().contains("cookie:"));
        }
        let (url, server) = serve_once(200, Duration::from_millis(700));
        let result = runtime.block_on(probe_url(
            &client,
            NetworkTarget::VrchatWeb,
            &url,
            Instant::now(),
        ));
        assert_eq!(result.status, NetworkStatus::Timeout);
        assert_eq!(result.http_status, None);
        server.join().unwrap();
    }
    #[test]
    fn http_errors_and_redirects_are_not_success() {
        assert_eq!(classify_http(200), NetworkStatus::Reachable);
        assert_eq!(classify_http(302), NetworkStatus::Redirected);
        for code in [403, 404, 405, 429, 503] {
            assert_eq!(classify_http(code), NetworkStatus::HttpError);
        }
    }
    #[test]
    fn regional_references_never_follow_a_redirect_out_of_their_region() {
        for source in [
            "https://objectstorage.us-sanjose-1.oraclecloud.com/",
            "https://objectstorage.us-ashburn-1.oraclecloud.com/",
            "https://objectstorage.ap-tokyo-1.oraclecloud.com/",
            "https://objectstorage.eu-amsterdam-1.oraclecloud.com/",
        ] {
            assert!(!follow_website_redirect(
                source,
                "https://www.oracle.com/",
                1
            ));
        }
        assert!(follow_website_redirect(
            "https://github.com/",
            "https://github.com/login",
            1
        ));
        assert!(!follow_website_redirect(
            "https://github.com/",
            "https://github.com/login",
            4
        ));
        assert!(!follow_website_redirect(
            "https://github.com/",
            "http://github.com/",
            1
        ));
    }
    #[test]
    fn vendor_redirects_require_a_domain_boundary() {
        assert!(vendor_host(
            NetworkTarget::SteamStore,
            "store.steampowered.com"
        ));
        for host in [
            "steampowered.com.evil.test",
            "notsteampowered.com",
            "127.0.0.1",
            "unity.com",
        ] {
            assert!(!vendor_host(NetworkTarget::SteamStore, host));
        }
    }
}

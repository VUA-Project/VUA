//! N1 Steam client acquisition: the official unversioned bootstrapper, a staged download,
//! Authenticode verification, then the vendor's own NSIS silent install. Keep acquisition
//! and installation here rather than in the renderer or application core.
//!
//! The bootstrapper URL never changes while Valve refreshes its bytes, so no content
//! digest is pinned: trust is the closed HTTPS host below plus the exact `Valve Corp.`
//! leaf signer (deployment_trust). A vendor refresh passes the same gate; anything else
//! fails closed and keeps the official manual route.

use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use vua_orchestrator::deployment::{
    DeploymentActivity, DeploymentPhase, DeploymentReporter, EditorDownloadSource,
};
use vua_orchestrator::{ProcessError, ProcessRunner, ProcessSpec};

/// Linked from the official page <https://store.steampowered.com/about/> (observed
/// 2026-10-08: 2,380,800 bytes, Authenticode leaf `Valve Corp.`).
pub(super) const STEAM_SETUP_URL: &str =
    "https://cdn.fastly.steamstatic.com/client/installer/SteamSetup.exe";
const STEAM_SETUP_HOST: &str = "cdn.fastly.steamstatic.com";
const STEAM_SETUP_REFERER: &str = "https://store.steampowered.com/about/";
/// Sanity bound far above the observed 2.3 MB bootstrapper; never a content identity.
const MAX_SETUP_BYTES: u64 = 32 * 1024 * 1024;
const DOWNLOAD_ERROR: &str = "vua.deployment.installer_download_failed";
const INTEGRITY_ERROR: &str = "vua.deployment.installer_integrity_failed";

fn cached_installer(data_root: &Path) -> PathBuf {
    data_root.join("environment/steam/SteamSetup.exe")
}

pub(super) fn install_steam(
    data_root: &Path,
    runner: &dyn ProcessRunner,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    let mut official_report = |mut activity: DeploymentActivity| {
        activity.source = Some(EditorDownloadSource::Official);
        report(activity)
    };
    let report: &mut DeploymentReporter<'_> = &mut official_report;
    let installer = match acquire_installer(data_root, report).and_then(|installer| {
        // Recheck the published/cache path immediately before the executable boundary.
        verify_installer(&installer.path, report)?;
        Ok(installer)
    }) {
        Ok(installer) => installer,
        Err(error @ ("vua.deployment.cancelled" | "vua.deployment.invalid_location")) => {
            return Err(error)
        }
        Err(cause) => {
            report(DeploymentActivity {
                cause: Some(cause),
                ..DeploymentActivity::new(DeploymentPhase::SourceFailed)
            })?;
            return Err(cause);
        }
    };
    match install_verified(runner, &installer.path, report) {
        Ok(()) => Ok(()),
        Err(
            error @ ("vua.deployment.cancelled"
            | "vua.deployment.elevation_required"
            | "vua.deployment.elevation_declined"),
        ) => Err(error),
        Err(cause) => {
            report(DeploymentActivity {
                cause: Some(cause),
                ..DeploymentActivity::new(DeploymentPhase::InstallationFailed)
            })?;
            Err(cause)
        }
    }
}

struct VerifiedInstaller {
    path: PathBuf,
}

fn acquire_installer(
    data_root: &Path,
    report: &mut DeploymentReporter<'_>,
) -> Result<VerifiedInstaller, &'static str> {
    let target = cached_installer(data_root);
    let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
    if !crate::unity_install::safe_install_root(parent) {
        return Err("vua.deployment.invalid_location");
    }
    std::fs::create_dir_all(parent).map_err(|_| DOWNLOAD_ERROR)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DOWNLOAD_ERROR)?
        .as_nanos();
    if let Some(cached) = inspect_cache(&target, nonce, report)? {
        return Ok(cached);
    }
    let runtime = tokio::runtime::Runtime::new().map_err(|_| DOWNLOAD_ERROR)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .user_agent("VUA-N1")
        .redirect(redirect_policy())
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|_| DOWNLOAD_ERROR)?;
    let stage = parent.join(format!("SteamSetup-{nonce}.partial.exe"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)
        .map_err(|_| DOWNLOAD_ERROR)?;
    let owned = OwnedDownload(stage.clone());
    let downloaded = runtime.block_on(download(&client, STEAM_SETUP_URL, &mut file, report));
    drop(file);
    let sha256 = downloaded.and_then(|()| verify_installer(&stage, report))?;
    let path = publish_verified(&stage, &target, nonce, report)?;
    drop(owned);
    let record = serde_json::json!({"source":"official", "sourcePage":STEAM_SETUP_REFERER,
        "downloadRoute":STEAM_SETUP_URL,
        // Recorded bytes of this acquisition. The unversioned URL intentionally has no
        // pinned digest; trust came from the closed host and the exact leaf signer.
        "fileSha256":sha256, "leafSigner":"Valve Corp."});
    std::fs::write(
        parent.join("acquisition.json"),
        serde_json::to_vec_pretty(&record).map_err(|_| DOWNLOAD_ERROR)?,
    )
    .map_err(|_| DOWNLOAD_ERROR)?;
    Ok(VerifiedInstaller { path })
}

/// Reuse a verified cache entry. A failed entry moves aside (never deleted, never
/// overwritten in place) so the download slot frees up while the bytes stay diagnosable.
fn inspect_cache(
    target: &Path,
    nonce: u128,
    report: &mut DeploymentReporter<'_>,
) -> Result<Option<VerifiedInstaller>, &'static str> {
    if !target.exists() {
        return Ok(None);
    }
    match verify_installer(target, report) {
        Ok(_) => Ok(Some(VerifiedInstaller {
            path: target.to_path_buf(),
        })),
        Err(INTEGRITY_ERROR) => {
            report(DeploymentActivity {
                cause: Some(INTEGRITY_ERROR),
                ..DeploymentActivity::new(DeploymentPhase::CacheRejected)
            })?;
            let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
            std::fs::rename(
                target,
                parent.join(format!("SteamSetup-{nonce}.rejected.exe")),
            )
            .map_err(|_| DOWNLOAD_ERROR)?;
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

/// Publish without replacing another file: the hard link is create-only, and an entry
/// that appeared meanwhile is reused only after independently verifying its bytes.
fn publish_verified(
    stage: &Path,
    target: &Path,
    nonce: u128,
    report: &mut DeploymentReporter<'_>,
) -> Result<PathBuf, &'static str> {
    if target.exists() {
        match verify_installer(target, report) {
            Ok(_) => return Ok(target.to_path_buf()),
            Err(INTEGRITY_ERROR) => {
                let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
                std::fs::rename(
                    target,
                    parent.join(format!("SteamSetup-{nonce}.rejected.exe")),
                )
                .map_err(|_| DOWNLOAD_ERROR)?;
            }
            Err(error) => return Err(error),
        }
    }
    std::fs::hard_link(stage, target).map_err(|_| DOWNLOAD_ERROR)?;
    Ok(target.to_path_buf())
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    file: &mut std::fs::File,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    report(DeploymentActivity::new(DeploymentPhase::Downloading))?;
    let mut response = client
        .get(url)
        .header(reqwest::header::REFERER, STEAM_SETUP_REFERER)
        .send()
        .await
        .map_err(|_| DOWNLOAD_ERROR)?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(DOWNLOAD_ERROR);
    }
    if response
        .content_length()
        .is_some_and(|n| n == 0 || n > MAX_SETUP_BYTES)
    {
        return Err(DOWNLOAD_ERROR);
    }
    let expected = response.content_length();
    let mut total = 0u64;
    let mut last_report = Instant::now();
    report(byte_progress(DeploymentPhase::Downloading, 0, expected))?;
    while let Some(chunk) = response.chunk().await.map_err(|_| DOWNLOAD_ERROR)? {
        total += chunk.len() as u64;
        if total > MAX_SETUP_BYTES {
            return Err(INTEGRITY_ERROR);
        }
        file.write_all(&chunk).map_err(|_| DOWNLOAD_ERROR)?;
        if last_report.elapsed() >= Duration::from_secs(1) {
            report(byte_progress(DeploymentPhase::Downloading, total, expected))?;
            last_report = Instant::now();
        }
    }
    if expected.is_some_and(|n| n != total) || total == 0 {
        return Err(INTEGRITY_ERROR);
    }
    report(byte_progress(DeploymentPhase::Downloading, total, expected))?;
    file.sync_all().map_err(|_| DOWNLOAD_ERROR)
}

/// Size sanity plus the exact Valve leaf signer; deliberately no pinned digest — the
/// unversioned vendor URL would make one stale. Reported byte counts stay honest facts.
fn verify_installer(
    path: &Path,
    report: &mut DeploymentReporter<'_>,
) -> Result<String, &'static str> {
    let mut file = std::fs::File::open(path).map_err(|_| INTEGRITY_ERROR)?;
    let size = file.metadata().map_err(|_| INTEGRITY_ERROR)?.len();
    if size == 0 || size > MAX_SETUP_BYTES {
        return Err(INTEGRITY_ERROR);
    }
    let mut sha256 = Sha256::new();
    let mut buffer = [0u8; 256 * 1024];
    let mut total = 0u64;
    let mut last_report = Instant::now();
    report(byte_progress(DeploymentPhase::Verifying, 0, Some(size)))?;
    loop {
        let n = file.read(&mut buffer).map_err(|_| INTEGRITY_ERROR)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_SETUP_BYTES {
            return Err(INTEGRITY_ERROR);
        }
        sha256.update(&buffer[..n]);
        if last_report.elapsed() >= Duration::from_secs(1) {
            report(byte_progress(DeploymentPhase::Verifying, total, Some(size)))?;
            last_report = Instant::now();
        }
    }
    if total != size || !crate::deployment_trust::trusted_steam_installer(path) {
        return Err(INTEGRITY_ERROR);
    }
    report(byte_progress(DeploymentPhase::Verifying, total, Some(size)))?;
    Ok(sha256
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// Run the verified NSIS installer silently. The vendor chooses the destination (no /D);
/// elevation goes through the ProcessRunner's OS-owned path. A zero exit is not
/// readiness: the caller re-observes the component before claiming it.
pub(super) fn install_verified(
    runner: &dyn ProcessRunner,
    installer: &Path,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    let spec = ProcessSpec {
        executable: installer.to_path_buf(),
        args: vec!["/S".into()],
        windows_elevated_nsis: true,
        timeout: Duration::from_secs(1800),
        output_limit: 64 * 1024,
        ..ProcessSpec::default()
    };
    report(DeploymentActivity::from_source(
        DeploymentPhase::Installing,
        EditorDownloadSource::Official,
    ))?;
    let outcome = runner.run(&spec).map_err(|error| match error {
        ProcessError::Io(error) if error.raw_os_error() == Some(740) => {
            "vua.deployment.elevation_required"
        }
        ProcessError::Io(error) if error.raw_os_error() == Some(1223) => {
            "vua.deployment.elevation_declined"
        }
        _ => "vua.deployment.process_failed",
    })?;
    if outcome.timed_out {
        return Err("vua.deployment.installer_timed_out");
    }
    if outcome.cancelled {
        return Err("vua.deployment.cancelled");
    }
    if !outcome.success() {
        return Err("vua.deployment.install_failed");
    }
    report(DeploymentActivity::from_source(
        DeploymentPhase::Inspecting,
        EditorDownloadSource::Official,
    ))?;
    Ok(())
}

fn byte_progress(phase: DeploymentPhase, completed: u64, total: Option<u64>) -> DeploymentActivity {
    DeploymentActivity {
        completed_bytes: Some(completed),
        total_bytes: total,
        ..DeploymentActivity::new(phase)
    }
}

fn redirect_policy() -> reqwest::redirect::Policy {
    // The closed set is the pinned host alone; an unreviewed destination fails the request.
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() <= 2 && permitted_redirect(attempt.url()) {
            attempt.follow()
        } else {
            attempt.error("unreviewed Steam installer redirect")
        }
    })
}

fn permitted_redirect(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some(STEAM_SETUP_HOST)
}

struct OwnedDownload(PathBuf);
impl Drop for OwnedDownload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vua_orchestrator::{outcome_with_exit, FakeProcessRunner};

    fn loopback_server(response: &'static str) -> (String, std::thread::JoinHandle<Vec<u8>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/installer", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 512];
            while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                request.extend_from_slice(&buffer[..n]);
            }
            socket.write_all(response.as_bytes()).unwrap();
            request
        });
        (url, server)
    }

    fn temp_file(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!("vua-steam-{label}-{}.exe", std::process::id()))
    }

    #[test]
    fn redirects_cannot_leave_the_pinned_host() {
        let pinned = reqwest::Url::parse(STEAM_SETUP_URL).unwrap();
        assert!(permitted_redirect(&pinned));
        assert!(permitted_redirect(
            &pinned.join("/client/installer/other.exe").unwrap()
        ));
        for url in [
            "http://cdn.fastly.steamstatic.com/client/installer/SteamSetup.exe",
            "https://cdn.fastly.steamstatic.com.example.org/SteamSetup.exe",
            "https://steamstatic.com/client/installer/SteamSetup.exe",
            "https://example.org/client/installer/SteamSetup.exe",
        ] {
            assert!(
                !permitted_redirect(&reqwest::Url::parse(url).unwrap()),
                "{url}"
            );
        }
    }

    #[test]
    fn download_reports_bytes_and_keeps_the_official_referer() {
        let (url, server) = loopback_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest",
        );
        let path = temp_file("progress");
        let mut file = std::fs::File::create(&path).unwrap();
        let cleanup = OwnedDownload(path.clone());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let mut events = Vec::new();
        runtime
            .block_on(download(&client, &url, &mut file, &mut |event| {
                events.push(event);
                Ok(())
            }))
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"test");
        let last = events.last().unwrap();
        assert_eq!(last.completed_bytes, Some(4));
        assert_eq!(last.total_bytes, Some(4));
        assert!(String::from_utf8(server.join().unwrap())
            .unwrap()
            .contains(&format!("referer: {STEAM_SETUP_REFERER}")));
        drop(file);
        drop(cleanup);
    }

    #[test]
    fn download_refuses_failed_or_oversized_responses() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        for (label, response) in [
            (
                "missing",
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ),
            (
                "oversized",
                "HTTP/1.1 200 OK\r\nContent-Length: 33554433\r\nConnection: close\r\n\r\n",
            ),
            (
                "empty",
                "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            ),
        ] {
            let (url, server) = loopback_server(response);
            let path = temp_file(label);
            let mut file = std::fs::File::create(&path).unwrap();
            let cleanup = OwnedDownload(path.clone());
            assert_eq!(
                runtime.block_on(download(&client, &url, &mut file, &mut |_| Ok(()))),
                Err(DOWNLOAD_ERROR),
                "{label}"
            );
            server.join().unwrap();
            drop(file);
            drop(cleanup);
        }
    }

    #[test]
    fn cancellation_during_download_reaches_the_caller() {
        let (url, server) = loopback_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest",
        );
        let path = temp_file("cancel");
        let mut file = std::fs::File::create(&path).unwrap();
        let cleanup = OwnedDownload(path.clone());
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        // Fail once the transfer is underway, so the server side completes its request.
        let mut calls = 0;
        assert_eq!(
            runtime.block_on(download(&client, &url, &mut file, &mut |_| {
                calls += 1;
                if calls >= 2 {
                    Err("vua.deployment.cancelled")
                } else {
                    Ok(())
                }
            })),
            Err("vua.deployment.cancelled")
        );
        server.join().unwrap();
        drop(file);
        drop(cleanup);
    }

    #[test]
    fn unsigned_or_empty_bytes_fail_verification_and_stay_in_place() {
        for (label, bytes) in [
            ("unsigned", &b"synthetic unsigned installer"[..]),
            ("empty", &b""[..]),
        ] {
            let path = temp_file(label);
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(
                verify_installer(&path, &mut |_| Ok(())),
                Err(INTEGRITY_ERROR),
                "{label}"
            );
            assert_eq!(std::fs::read(&path).unwrap(), bytes, "{label}");
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn cancellation_during_verification_reaches_the_caller() {
        let path = temp_file("verify-cancel");
        std::fs::write(&path, b"test").unwrap();
        let _cleanup = OwnedDownload(path.clone());
        assert_eq!(
            verify_installer(&path, &mut |_| Err("vua.deployment.cancelled")),
            Err("vua.deployment.cancelled")
        );
    }

    #[test]
    fn a_rejected_cache_moves_aside_and_preserves_its_bytes() {
        let root = std::env::temp_dir().join(format!("vua-steam-cache-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("SteamSetup.exe");
        std::fs::write(&target, b"synthetic foreign bytes").unwrap();
        let mut events = Vec::new();
        assert!(matches!(
            inspect_cache(&target, 7, &mut |event| {
                events.push(event);
                Ok(())
            }),
            Ok(None)
        ));
        assert!(!target.exists());
        assert_eq!(
            std::fs::read(root.join("SteamSetup-7.rejected.exe")).unwrap(),
            b"synthetic foreign bytes"
        );
        assert!(matches!(
            events.last().unwrap().phase,
            DeploymentPhase::CacheRejected
        ));
        assert_eq!(events.last().unwrap().cause, Some(INTEGRITY_ERROR));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn publish_never_overwrites_an_existing_entry() {
        let root = std::env::temp_dir().join(format!("vua-steam-publish-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let stage = root.join("SteamSetup-7.partial.exe");
        let target = root.join("SteamSetup.exe");
        std::fs::write(&stage, b"fresh verified bytes").unwrap();
        std::fs::write(&target, b"foreign unsigned bytes").unwrap();
        // The unsigned entry fails independent verification, moves aside and survives;
        // only then does the create-only hard link take the slot.
        let published = publish_verified(&stage, &target, 7, &mut |_| Ok(())).unwrap();
        assert_eq!(published, target);
        assert_eq!(std::fs::read(&target).unwrap(), b"fresh verified bytes");
        assert_eq!(
            std::fs::read(root.join("SteamSetup-7.rejected.exe")).unwrap(),
            b"foreign unsigned bytes"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn install_verified_runs_the_closed_nsis_command_and_maps_process_failures() {
        let runner = FakeProcessRunner::new();
        let installer = Path::new(r"C:\VUA\environment\steam\SteamSetup.exe");
        let mut phases = Vec::new();
        let mut report = |activity: DeploymentActivity| {
            phases.push(activity.phase);
            Ok(())
        };
        install_verified(&runner, installer, &mut report).unwrap();
        assert!(matches!(
            phases.as_slice(),
            [DeploymentPhase::Installing, DeploymentPhase::Inspecting]
        ));
        let calls = runner.calls();
        let spec = &calls[0];
        assert_eq!(spec.executable, installer);
        assert_eq!(spec.args, ["/S"]);
        assert_eq!(spec.windows_nsis_install_dir, None);
        assert!(spec.windows_elevated_nsis);
        assert_eq!(spec.timeout, Duration::from_secs(1800));

        runner.push(Ok(outcome_with_exit(1, "vendor failed")));
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.install_failed")
        );
        runner.push(Ok(vua_orchestrator::ProcessOutcome {
            exit_code: None,
            timed_out: true,
            cancelled: false,
            process_tree_clean: false,
            stdout: String::new(),
            stderr: String::new(),
            truncated: false,
        }));
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.installer_timed_out")
        );
        runner.push_raw_os_error(740);
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.elevation_required")
        );
        runner.push_raw_os_error(1223);
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.elevation_declined")
        );
        runner.push(Err("spawn failed".to_owned()));
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.process_failed")
        );
    }
}

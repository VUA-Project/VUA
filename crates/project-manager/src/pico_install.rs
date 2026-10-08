//! N1 PICO Connect acquisition: the official versioned installer, staged download,
//! pinned size + SHA-256 + Authenticode verification, then the vendor's NSIS silent
//! install. Keep acquisition and installation here rather than in the renderer or
//! application core. No redistribution: bytes come only from the official route below.

use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use vua_orchestrator::deployment::{
    DeploymentActivity, DeploymentPhase, DeploymentReporter, EditorDownloadSource,
    PicoInstallRegion,
};
use vua_orchestrator::{ProcessError, ProcessRunner, ProcessSpec};

/// Versioned artifact linked from the official CN page
/// <https://www.picoxr.com/cn/software/pico-link> (observed 2026-10-08: 225,922,864
/// bytes, Authenticode leaf `Douyin Vision Co., Ltd.`). Versioned, so the identity is
/// pinned like the Unity CLI: exact version + size + SHA-256 plus the leaf signer.
pub(super) const PICO_CONNECT_VERSION: &str = "10.6.6";
pub(super) const PICO_CONNECT_URL: &str = "https://lf3-cdn-tos.bytegoofy.com/obj/tron-demo/7276443370203912508/204284404/10.6.6/win32-x64/PICOConnect-v10.6.6-win32-x64.exe";
const PICO_CONNECT_HOST: &str = "lf3-cdn-tos.bytegoofy.com";
const PICO_CONNECT_REFERER: &str = "https://www.picoxr.com/cn/software/pico-link";
const PICO_CONNECT_SIZE: u64 = 225_922_864;
const PICO_CONNECT_SHA256: &str =
    "058ff86d776e214c44f8c87ca92d7f5e5cd99189a601f475eee07bc810c0a3c3";
const PICO_GLOBAL_URL: &str = "https://lf3-cdn-tos.bytegoofy.com/obj/tron-demo/7322368297905690907/204284616/10.6.6/win32-x64/PICOConnect-v10.6.6-win32-x64.exe";
const PICO_GLOBAL_REFERER: &str = "https://www.picoxr.com/global/software/pico-link";
const PICO_GLOBAL_SIZE: u64 = 226_021_824;
const PICO_GLOBAL_SHA256: &str = "4be12464d73f48fad0b7cfbed6b9400710f18ad85b50271bb3e8e58c8ffb6fba";

#[derive(Clone, Copy)]
struct PicoArtifact {
    region: &'static str,
    url: &'static str,
    referer: &'static str,
    size: u64,
    sha256: &'static str,
}

const CHINA: PicoArtifact = PicoArtifact {
    region: "china_mainland",
    url: PICO_CONNECT_URL,
    referer: PICO_CONNECT_REFERER,
    size: PICO_CONNECT_SIZE,
    sha256: PICO_CONNECT_SHA256,
};
const GLOBAL: PicoArtifact = PicoArtifact {
    region: "other",
    url: PICO_GLOBAL_URL,
    referer: PICO_GLOBAL_REFERER,
    size: PICO_GLOBAL_SIZE,
    sha256: PICO_GLOBAL_SHA256,
};

fn artifact(region: PicoInstallRegion) -> &'static PicoArtifact {
    match region {
        PicoInstallRegion::ChinaMainland => &CHINA,
        PicoInstallRegion::Other => &GLOBAL,
    }
}
/// Sanity bound above the pinned artifact; the exact size below is the real gate.
const MAX_SETUP_BYTES: u64 = 512 * 1024 * 1024;
const DOWNLOAD_ERROR: &str = "vua.deployment.installer_download_failed";
const INTEGRITY_ERROR: &str = "vua.deployment.installer_integrity_failed";

fn cached_installer(data_root: &Path, artifact: &PicoArtifact) -> PathBuf {
    data_root
        .join("environment/pico-connect")
        .join(artifact.region)
        .join(format!("v{PICO_CONNECT_VERSION}"))
        .join("PICOConnect-v10.6.6-win32-x64.exe")
}

pub(super) fn install_pico(
    data_root: &Path,
    region: PicoInstallRegion,
    runner: &dyn ProcessRunner,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    let artifact = artifact(region);
    let mut official_report = |mut activity: DeploymentActivity| {
        activity.source = Some(EditorDownloadSource::Official);
        report(activity)
    };
    let report: &mut DeploymentReporter<'_> = &mut official_report;
    let installer = match acquire_installer(data_root, artifact, report).and_then(|installer| {
        // Recheck the published/cache path immediately before the executable boundary.
        verify_installer(&installer.path, artifact, report)?;
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
    artifact: &PicoArtifact,
    report: &mut DeploymentReporter<'_>,
) -> Result<VerifiedInstaller, &'static str> {
    let target = cached_installer(data_root, artifact);
    let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
    if !crate::unity_install::safe_install_root(parent) {
        return Err("vua.deployment.invalid_location");
    }
    std::fs::create_dir_all(parent).map_err(|_| DOWNLOAD_ERROR)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DOWNLOAD_ERROR)?
        .as_nanos();
    if let Some(cached) = inspect_cache(&target, nonce, artifact, report)? {
        return Ok(cached);
    }
    let runtime = tokio::runtime::Runtime::new().map_err(|_| DOWNLOAD_ERROR)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .user_agent("VUA-N1")
        .redirect(redirect_policy())
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|_| DOWNLOAD_ERROR)?;
    let stage = parent.join(format!("PICOConnect-{nonce}.partial.exe"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&stage)
        .map_err(|_| DOWNLOAD_ERROR)?;
    let owned = OwnedDownload(stage.clone());
    let downloaded = runtime.block_on(download(&client, artifact.url, &mut file, artifact, report));
    drop(file);
    let sha256 = downloaded.and_then(|()| verify_installer(&stage, artifact, report))?;
    let path = publish_verified(&stage, &target, nonce, artifact, report)?;
    drop(owned);
    let record = serde_json::json!({"source":"official", "sourcePage":artifact.referer, "region":artifact.region,
        "downloadRoute":artifact.url, "version":PICO_CONNECT_VERSION,
        "expectedSize":artifact.size, "expectedSha256":artifact.sha256,
        "fileSha256":sha256, "leafSigner":"Douyin Vision Co., Ltd."});
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
    artifact: &PicoArtifact,
    report: &mut DeploymentReporter<'_>,
) -> Result<Option<VerifiedInstaller>, &'static str> {
    if !target.exists() {
        return Ok(None);
    }
    match verify_installer(target, artifact, report) {
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
                parent.join(format!("PICOConnect-{nonce}.rejected.exe")),
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
    artifact: &PicoArtifact,
    report: &mut DeploymentReporter<'_>,
) -> Result<PathBuf, &'static str> {
    if target.exists() {
        match verify_installer(target, artifact, report) {
            Ok(_) => return Ok(target.to_path_buf()),
            Err(INTEGRITY_ERROR) => {
                let parent = target.parent().ok_or(DOWNLOAD_ERROR)?;
                std::fs::rename(
                    target,
                    parent.join(format!("PICOConnect-{nonce}.rejected.exe")),
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
    artifact: &PicoArtifact,
    report: &mut DeploymentReporter<'_>,
) -> Result<(), &'static str> {
    report(DeploymentActivity::new(DeploymentPhase::Downloading))?;
    let mut response = client
        .get(url)
        .header(reqwest::header::REFERER, artifact.referer)
        .send()
        .await
        .map_err(|_| DOWNLOAD_ERROR)?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(DOWNLOAD_ERROR);
    }
    // The artifact is versioned: a different announced length already fails the pin.
    if response
        .content_length()
        .is_some_and(|n| n != artifact.size || n > MAX_SETUP_BYTES)
    {
        return Err(DOWNLOAD_ERROR);
    }
    let expected = response.content_length();
    let mut total = 0u64;
    let mut last_report = Instant::now();
    report(byte_progress(DeploymentPhase::Downloading, 0, expected))?;
    while let Some(chunk) = response.chunk().await.map_err(|_| DOWNLOAD_ERROR)? {
        total += chunk.len() as u64;
        if total > artifact.size {
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

/// Exact size and SHA-256 pin plus the Douyin Vision leaf signer; reported byte counts
/// stay honest facts, never fabricated percentages.
fn verify_installer(
    path: &Path,
    artifact: &PicoArtifact,
    report: &mut DeploymentReporter<'_>,
) -> Result<String, &'static str> {
    let mut file = std::fs::File::open(path).map_err(|_| INTEGRITY_ERROR)?;
    let size = file.metadata().map_err(|_| INTEGRITY_ERROR)?.len();
    if size != artifact.size {
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
        if total > artifact.size {
            return Err(INTEGRITY_ERROR);
        }
        sha256.update(&buffer[..n]);
        if last_report.elapsed() >= Duration::from_secs(1) {
            report(byte_progress(DeploymentPhase::Verifying, total, Some(size)))?;
            last_report = Instant::now();
        }
    }
    let digest: String = sha256
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if total != size
        || digest != artifact.sha256
        || !crate::deployment_trust::trusted_pico_installer(path)
    {
        return Err(INTEGRITY_ERROR);
    }
    report(byte_progress(DeploymentPhase::Verifying, total, Some(size)))?;
    Ok(digest)
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
            attempt.error("unreviewed PICO Connect installer redirect")
        }
    })
}

fn permitted_redirect(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some(PICO_CONNECT_HOST)
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
        std::env::temp_dir().join(format!("vua-pico-{label}-{}.exe", std::process::id()))
    }

    #[test]
    fn the_pin_matches_the_reviewed_artifact_identity() {
        assert_eq!(PICO_CONNECT_VERSION, "10.6.6");
        assert_eq!(PICO_CONNECT_SIZE, 225_922_864);
        assert_eq!(PICO_CONNECT_SHA256.len(), 64);
        assert!(PICO_CONNECT_URL.contains("/10.6.6/"));
        assert!(PICO_CONNECT_URL.ends_with("PICOConnect-v10.6.6-win32-x64.exe"));
        assert!(
            cached_installer(Path::new(r"C:\VUAData"), &CHINA).ends_with(
                r"environment\pico-connect\china_mainland\v10.6.6\PICOConnect-v10.6.6-win32-x64.exe"
            )
        );
    }

    #[test]
    fn selected_regions_have_distinct_artifacts_and_cache_slots() {
        let china = artifact(PicoInstallRegion::ChinaMainland);
        let global = artifact(PicoInstallRegion::Other);
        assert_ne!(china.url, global.url);
        assert_ne!(china.size, global.size);
        assert_ne!(china.sha256, global.sha256);
        let data = Path::new(r"C:\VUAData");
        assert_ne!(
            cached_installer(data, china),
            cached_installer(data, global)
        );
        for selected in [china, global] {
            assert!(permitted_redirect(
                &reqwest::Url::parse(selected.url).unwrap()
            ));
            assert_eq!(selected.sha256.len(), 64);
        }
    }

    /// Read-only artifact inspection, distinct from running an installer or a headset.
    #[test]
    #[ignore = "requires both official PICO installer paths; executes no software"]
    fn official_artifacts_pass_only_the_selected_region_pin() {
        let cn = PathBuf::from(
            std::env::var_os("VUA_TEST_PICO_INSTALLER").expect("mainland installer path"),
        );
        let global = PathBuf::from(
            std::env::var_os("VUA_TEST_PICO_GLOBAL_INSTALLER").expect("global installer path"),
        );
        for (path, selected, other) in [(&cn, &CHINA, &GLOBAL), (&global, &GLOBAL, &CHINA)] {
            assert_eq!(
                verify_installer(path, selected, &mut |_| Ok(())).unwrap(),
                selected.sha256
            );
            assert_eq!(
                verify_installer(path, other, &mut |_| Ok(())),
                Err(INTEGRITY_ERROR)
            );
        }
    }

    #[test]
    fn redirects_cannot_leave_the_pinned_host() {
        let pinned = reqwest::Url::parse(PICO_CONNECT_URL).unwrap();
        assert!(permitted_redirect(&pinned));
        for url in [
            "http://lf3-cdn-tos.bytegoofy.com/obj/tron-demo/x.exe",
            "https://lf3-cdn-tos.bytegoofy.com.example.org/x.exe",
            "https://bytegoofy.com/obj/tron-demo/x.exe",
            "https://example.org/obj/tron-demo/x.exe",
        ] {
            assert!(
                !permitted_redirect(&reqwest::Url::parse(url).unwrap()),
                "{url}"
            );
        }
    }

    #[test]
    fn download_reports_bytes_and_refuses_a_length_that_breaks_the_pin() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        // A wrong announced length fails before any byte is written.
        let (url, server) = loopback_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 225922865\r\nConnection: close\r\n\r\n",
        );
        let path = temp_file("wrong-length");
        let mut file = std::fs::File::create(&path).unwrap();
        let cleanup = OwnedDownload(path.clone());
        assert_eq!(
            runtime.block_on(download(&client, &url, &mut file, &CHINA, &mut |_| Ok(()))),
            Err(DOWNLOAD_ERROR)
        );
        server.join().unwrap();
        drop(file);
        drop(cleanup);

        let (url, server) = loopback_server(
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let path = temp_file("missing");
        let mut file = std::fs::File::create(&path).unwrap();
        let cleanup = OwnedDownload(path.clone());
        assert_eq!(
            runtime.block_on(download(&client, &url, &mut file, &CHINA, &mut |_| Ok(()))),
            Err(DOWNLOAD_ERROR)
        );
        server.join().unwrap();
        drop(file);
        drop(cleanup);
    }

    #[test]
    fn cancellation_during_download_reaches_the_caller() {
        // A chunked response has no announced length, so progress still reports.
        let (url, server) = loopback_server(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4\r\ntest\r\n0\r\n\r\n",
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
        let mut calls = 0;
        assert_eq!(
            runtime.block_on(download(&client, &url, &mut file, &CHINA, &mut |_| {
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
    fn wrong_size_or_hash_fails_verification_and_stays_in_place() {
        for (label, bytes) in [
            ("small", &b"synthetic installer bytes"[..]),
            ("empty", &b""[..]),
        ] {
            let path = temp_file(label);
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(
                verify_installer(&path, &CHINA, &mut |_| Ok(())),
                Err(INTEGRITY_ERROR),
                "{label}"
            );
            assert_eq!(std::fs::read(&path).unwrap(), bytes, "{label}");
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn a_rejected_cache_moves_aside_and_preserves_its_bytes() {
        let root = std::env::temp_dir().join(format!("vua-pico-cache-{}", std::process::id()));
        let target = cached_installer(&root, &CHINA);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"synthetic foreign bytes").unwrap();
        let mut events = Vec::new();
        assert!(matches!(
            inspect_cache(&target, 7, &CHINA, &mut |event| {
                events.push(event);
                Ok(())
            }),
            Ok(None)
        ));
        assert!(!target.exists());
        assert_eq!(
            std::fs::read(target.with_file_name("PICOConnect-7.rejected.exe")).unwrap(),
            b"synthetic foreign bytes"
        );
        assert!(matches!(
            events.last().unwrap().phase,
            DeploymentPhase::CacheRejected
        ));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn publish_never_overwrites_an_existing_entry() {
        let root = std::env::temp_dir().join(format!("vua-pico-publish-{}", std::process::id()));
        let target = cached_installer(&root, &CHINA);
        let parent = target.parent().unwrap();
        std::fs::create_dir_all(parent).unwrap();
        let stage = parent.join("PICOConnect-7.partial.exe");
        std::fs::write(&stage, b"fresh verified bytes").unwrap();
        std::fs::write(&target, b"foreign unsigned bytes").unwrap();
        let published = publish_verified(&stage, &target, 7, &CHINA, &mut |_| Ok(())).unwrap();
        assert_eq!(published, target);
        assert_eq!(std::fs::read(&target).unwrap(), b"fresh verified bytes");
        assert_eq!(
            std::fs::read(parent.join("PICOConnect-7.rejected.exe")).unwrap(),
            b"foreign unsigned bytes"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn install_verified_runs_the_closed_nsis_command_and_maps_process_failures() {
        let runner = FakeProcessRunner::new();
        let installer =
            Path::new(r"C:\VUA\environment\pico-connect\china_mainland\v10.6.6\PICOConnect.exe");
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
        drop(calls);

        runner.push(Ok(outcome_with_exit(1, "vendor failed")));
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.install_failed")
        );
        let mut timeout = outcome_with_exit(0, "");
        timeout.timed_out = true;
        runner.push(Ok(timeout));
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.installer_timed_out")
        );
        let mut cancelled = outcome_with_exit(0, "");
        cancelled.cancelled = true;
        runner.push(Ok(cancelled));
        assert_eq!(
            install_verified(&runner, installer, &mut |_| Ok(())),
            Err("vua.deployment.cancelled")
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

use crate::{
    component_feed::{CompressedFileObject, CompressedTransfer, CompressionEncoding},
    manifest::{FileObject, Pack},
    paths::{digest, file_digest, hex, owned_path},
    Error, Result,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub completed: u64,
    pub total: u64,
    pub bytes_per_second: u64,
    pub reused_bytes: u64,
    pub full_pack: bool,
}
pub struct Transfer {
    pub cancel: Arc<AtomicBool>,
    pub report: Box<dyn Fn(Progress) + Send + Sync>,
    client: reqwest::Client,
    started: Instant,
    received: u64,
    reused: u64,
    full_pack: bool,
}
impl Transfer {
    pub fn new(
        cancel: Arc<AtomicBool>,
        report: impl Fn(Progress) + Send + Sync + 'static,
    ) -> Result<Self> {
        Self::with_versions(cancel, report, None)
    }
    pub fn with_versions(
        cancel: Arc<AtomicBool>,
        report: impl Fn(Progress) + Send + Sync + 'static,
        versions: Option<(&str, &str)>,
    ) -> Result<Self> {
        let agent = distribution_user_agent(versions);
        let client = reqwest::Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(8))
            .read_timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() >= 6 || attempt.url().scheme() != "https" {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .user_agent(agent)
            .build()?;
        Ok(Self {
            cancel,
            report: Box::new(report),
            client,
            started: Instant::now(),
            received: 0,
            reused: 0,
            full_pack: false,
        })
    }
    pub fn checkpoint(&self) -> Result<()> {
        if self.cancel.load(Ordering::Relaxed) {
            Err(Error("cancelled".into()))
        } else {
            Ok(())
        }
    }
    pub fn progress(&self, phase: &str, completed: u64, total: u64) {
        (self.report)(Progress {
            phase: phase.into(),
            completed,
            total,
            bytes_per_second: (self.received as f64
                / self.started.elapsed().as_secs_f64().max(0.001))
                as u64,
            reused_bytes: self.reused,
            full_pack: self.full_pack,
        });
    }
    async fn interruptible<T>(
        &self,
        future: impl std::future::Future<Output = reqwest::Result<T>>,
    ) -> Result<T> {
        tokio::pin!(future);
        loop {
            tokio::select! { value = &mut future => return Ok(value?), _ = tokio::time::sleep(Duration::from_millis(100)) => self.checkpoint()? }
        }
    }
    pub async fn manifest(&self, url: &str) -> Result<Vec<u8>> {
        let mut response = self.interruptible(self.client.get(url).send()).await?;
        if !response.status().is_success() {
            return Err(Error("feed_unavailable".into()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = self.interruptible(response.chunk()).await? {
            if bytes.len() + chunk.len() > crate::manifest::MAX_MANIFEST_BYTES {
                return Err(Error("manifest_too_large".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
    /// Bounded sample probes test the exact object, never an ICMP or mirror homepage.
    async fn ranked_sources(&self, pack: &Pack) -> Vec<String> {
        if pack.bytes == 0 {
            return pack.sources.clone();
        }
        let mut sources = Vec::new();
        let mut probes = tokio::task::JoinSet::new();
        for source in &pack.sources {
            let client = self.client.clone();
            let source = source.clone();
            let total = pack.bytes;
            probes.spawn(async move {
                let start = Instant::now();
                let probe = async {
                    let end = (total - 1).min(65535);
                    let mut response = client
                        .get(&source)
                        .header("Range", format!("bytes=0-{end}"))
                        .header("Accept-Encoding", "identity")
                        .send()
                        .await?;
                    if !range_matches(&response, 0, end, total) {
                        return Ok::<bool, reqwest::Error>(false);
                    }
                    let sample = response.chunk().await?;
                    Ok(sample.is_some_and(|chunk| !chunk.is_empty() && chunk.len() <= 65536))
                };
                let elapsed = tokio::time::timeout(Duration::from_secs(5), probe)
                    .await
                    .is_ok_and(|r| r.unwrap_or(false))
                    .then(|| start.elapsed());
                (elapsed, source)
            });
        }
        while !probes.is_empty() {
            tokio::select! {
                result = probes.join_next() => { if let Some(Ok((Some(elapsed), source))) = result { sources.push((elapsed, source)); } }
                _ = tokio::time::sleep(Duration::from_millis(100)) => { if self.checkpoint().is_err() { probes.abort_all(); break; } }
            }
        }
        sources.sort_by_key(|source| source.0);
        // A source that timed out during a short probe may still be usable for the download.
        for source in &pack.sources {
            if !sources.iter().any(|(_, url)| url == source) {
                sources.push((Duration::MAX, source.clone()));
            }
        }
        sources.into_iter().map(|(_, source)| source).collect()
    }
    #[cfg(test)]
    pub(crate) fn loopback(
        cancel: Arc<AtomicBool>,
        report: impl Fn(Progress) + Send + Sync + 'static,
    ) -> Self {
        let mut transfer = Self::new(cancel, report).unwrap();
        transfer.client = reqwest::Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(2))
            .read_timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        transfer
    }
    pub async fn archive(&mut self, pack: &Pack, cache: &Path) -> Result<()> {
        if verified_file(cache, pack.bytes, &pack.sha256) {
            self.reused += pack.bytes;
            return Ok(());
        }
        let pending = cache.with_extension("partial");
        for source in self.ranked_sources(pack).await {
            self.checkpoint()?;
            let result = self.download_whole(&source, pack, &pending).await;
            if result.is_ok() {
                fs::rename(&pending, cache)?;
                return Ok(());
            }
            if result.as_ref().err().is_some_and(|e| e.0 == "cancelled") {
                return result;
            }
        }
        Err(Error("sources_failed_retry_or_offline".into()))
    }
    async fn download_whole(&mut self, source: &str, pack: &Pack, target: &Path) -> Result<()> {
        // Append only when the server proves the same signed object's total and offset.
        let mut offset = fs::metadata(target).map_or(0, |m| m.len());
        if offset >= pack.bytes {
            if verified_file(target, pack.bytes, &pack.sha256) {
                return Ok(());
            }
            fs::remove_file(target)?;
            offset = 0;
        }
        let request = self
            .client
            .get(source)
            .header("Accept-Encoding", "identity");
        let mut response = self
            .interruptible(
                if offset > 0 {
                    request.header("Range", format!("bytes={offset}-"))
                } else {
                    request
                }
                .send(),
            )
            .await?;
        let resume = offset > 0 && range_matches(&response, offset, pack.bytes - 1, pack.bytes);
        if !response.status().is_success() {
            return Err(Error("source_unavailable".into()));
        }
        // An unproved partial response cannot safely be written as a complete object.
        if response.status() == reqwest::StatusCode::PARTIAL_CONTENT && !resume {
            return Err(Error("invalid_content_range".into()));
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(!resume)
            .append(resume)
            .open(target)?;
        let mut count = if resume { offset } else { 0 };
        while let Some(chunk) = self.interruptible(response.chunk()).await? {
            self.checkpoint()?;
            count += chunk.len() as u64;
            if count > pack.bytes {
                return Err(Error("unexpected_download_length".into()));
            }
            file.write_all(&chunk)?;
            self.received += chunk.len() as u64;
            self.progress("downloading", count, pack.bytes);
        }
        file.sync_all()?;
        drop(file);
        self.progress("verifying", count, pack.bytes);
        if !verified_file(target, pack.bytes, &pack.sha256) {
            fs::remove_file(target)?;
            return Err(Error("download_integrity_failed".into()));
        }
        Ok(())
    }
    /// Reuse verified unchanged files. Range objects contain only changed file bytes.
    /// If a server cannot supply ranges, explicitly report one verified full-pack fallback.
    pub async fn component(
        &mut self,
        files: &[FileObject],
        pack: &Pack,
        previous: Option<&Path>,
        output: &Path,
        local_pack: Option<&Path>,
        cache: &Path,
    ) -> Result<()> {
        fs::create_dir_all(output)?;
        let total: u64 = files.iter().map(|file| file.bytes).sum();
        let mut completed = 0;
        let mut full = local_pack
            .filter(|file| verified_file(file, pack.bytes, &pack.sha256))
            .map(Path::to_path_buf);
        for file in files {
            self.checkpoint()?;
            let target = owned_path(output, &file.path)?;
            if !verified_file(&target, file.bytes, &file.sha256) {
                let reusable = previous
                    .and_then(|root| owned_path(root, &file.path).ok())
                    .filter(|path| verified_file(path, file.bytes, &file.sha256));
                fs::create_dir_all(
                    target
                        .parent()
                        .ok_or_else(|| Error("invalid_release_path".into()))?,
                )?;
                if let Some(path) = reusable {
                    fs::copy(path, &target)?;
                    self.reused += file.bytes;
                } else if file.bytes == 0 {
                    fs::write(&target, [])?;
                } else {
                    let mut range_written = false;
                    if full.is_none() {
                        for source in &pack.sources {
                            self.checkpoint()?;
                            if let Ok(bytes) = self.file_object(source, file, pack.bytes).await {
                                fs::write(&target, bytes)?;
                                range_written = true;
                                break;
                            }
                        }
                    }
                    if !range_written {
                        if full.is_none() {
                            self.full_pack = true;
                            self.progress("full-pack", completed, total);
                            self.archive(pack, cache).await?;
                            full = Some(cache.to_path_buf());
                        }
                        let mut source = fs::File::open(
                            full.as_ref().ok_or_else(|| Error("missing_pack".into()))?,
                        )?;
                        source.seek(SeekFrom::Start(file.offset))?;
                        let mut dest = fs::File::create(&target)?;
                        let written = std::io::copy(&mut source.take(file.bytes), &mut dest)?;
                        dest.sync_all()?;
                        if written != file.bytes {
                            return Err(Error("incomplete_release_pack".into()));
                        }
                    }
                }
            } else {
                self.reused += file.bytes;
            }
            if !verified_file(&target, file.bytes, &file.sha256) {
                return Err(Error("component_integrity_failed".into()));
            }
            completed += file.bytes;
            self.progress("staging", completed, total);
        }
        if cache.exists() {
            let _ = fs::remove_file(cache);
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn component_compressed(
        &mut self,
        files: &[FileObject],
        uncompressed_pack: &Pack,
        compressed: &CompressedTransfer,
        previous: Option<&Path>,
        output: &Path,
        compressed_cache: &Path,
        uncompressed_cache: &Path,
    ) -> Result<()> {
        if files.len() != compressed.files.len() {
            return Err(Error("component_transfer_files_mismatch".into()));
        }
        fs::create_dir_all(output)?;
        let total: u64 = files.iter().map(|file| file.bytes).sum();
        let mut completed = 0;
        let mut full_compressed: Option<std::path::PathBuf> = None;
        let mut full_uncompressed: Option<std::path::PathBuf> = None;
        for (file, compressed_file) in files.iter().zip(&compressed.files) {
            self.checkpoint()?;
            if file.path != compressed_file.path
                || file.bytes != compressed_file.bytes
                || file.sha256 != compressed_file.sha256
            {
                return Err(Error("component_transfer_files_mismatch".into()));
            }
            let target = owned_path(output, &file.path)?;
            if !verified_file(&target, file.bytes, &file.sha256) {
                let reusable = previous
                    .and_then(|root| owned_path(root, &file.path).ok())
                    .filter(|path| verified_file(path, file.bytes, &file.sha256));
                fs::create_dir_all(
                    target
                        .parent()
                        .ok_or_else(|| Error("invalid_release_path".into()))?,
                )?;
                if let Some(path) = reusable {
                    fs::copy(path, &target)?;
                    self.reused += file.bytes;
                } else if file.bytes == 0 {
                    fs::write(&target, [])?;
                } else {
                    let mut written = false;
                    if full_compressed.is_none() && full_uncompressed.is_none() {
                        for source in &compressed.pack.sources {
                            self.checkpoint()?;
                            if let Ok(frame) = self
                                .compressed_file_object(
                                    source,
                                    compressed_file,
                                    compressed.pack.bytes,
                                )
                                .await
                            {
                                decompress_bounded(
                                    &frame,
                                    compressed.encoding,
                                    file.bytes,
                                    &file.sha256,
                                    &target,
                                )?;
                                written = true;
                                break;
                            }
                        }
                    }
                    if !written && full_uncompressed.is_none() {
                        if full_compressed.is_none() {
                            self.full_pack = true;
                            self.progress("full-pack", completed, total);
                            if self
                                .archive(&compressed.pack, compressed_cache)
                                .await
                                .is_ok()
                            {
                                full_compressed = Some(compressed_cache.to_path_buf());
                            }
                        }
                        if let Some(pack_path) = &full_compressed {
                            let mut source = fs::File::open(pack_path)?;
                            source.seek(SeekFrom::Start(compressed_file.compressed_offset))?;
                            let mut frame = Vec::with_capacity(
                                usize::try_from(compressed_file.compressed_bytes)
                                    .map_err(|_| Error("invalid_component_transfer_file".into()))?,
                            );
                            source
                                .take(compressed_file.compressed_bytes)
                                .read_to_end(&mut frame)?;
                            if frame.len() as u64 != compressed_file.compressed_bytes
                                || digest(&frame) != compressed_file.compressed_sha256
                            {
                                return Err(Error("download_integrity_failed".into()));
                            }
                            decompress_bounded(
                                &frame,
                                compressed.encoding,
                                file.bytes,
                                &file.sha256,
                                &target,
                            )?;
                            written = true;
                        }
                    }
                    if !written {
                        if full_uncompressed.is_none() {
                            self.full_pack = true;
                            self.progress("full-pack", completed, total);
                            self.archive(uncompressed_pack, uncompressed_cache).await?;
                            full_uncompressed = Some(uncompressed_cache.to_path_buf());
                        }
                        let mut source = fs::File::open(
                            full_uncompressed
                                .as_ref()
                                .ok_or_else(|| Error("missing_pack".into()))?,
                        )?;
                        source.seek(SeekFrom::Start(file.offset))?;
                        let mut dest = fs::File::create(&target)?;
                        let copied = std::io::copy(&mut source.take(file.bytes), &mut dest)?;
                        dest.sync_all()?;
                        if copied != file.bytes {
                            return Err(Error("incomplete_release_pack".into()));
                        }
                    }
                }
            } else {
                self.reused += file.bytes;
            }
            if !verified_file(&target, file.bytes, &file.sha256) {
                return Err(Error("component_integrity_failed".into()));
            }
            completed += file.bytes;
            self.progress("staging", completed, total);
        }
        if compressed_cache.exists() {
            let _ = fs::remove_file(compressed_cache);
        }
        if uncompressed_cache.exists() {
            let _ = fs::remove_file(uncompressed_cache);
        }
        Ok(())
    }

    async fn compressed_file_object(
        &mut self,
        source: &str,
        file: &CompressedFileObject,
        total: u64,
    ) -> Result<Vec<u8>> {
        let end = file.compressed_offset + file.compressed_bytes - 1;
        let mut response = self
            .interruptible(
                self.client
                    .get(source)
                    .header("Accept-Encoding", "identity")
                    .header("Range", format!("bytes={}-{}", file.compressed_offset, end))
                    .send(),
            )
            .await?;
        if !range_matches(&response, file.compressed_offset, end, total) {
            return Err(Error("range_unavailable".into()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = self.interruptible(response.chunk()).await? {
            if bytes.len() as u64 + chunk.len() as u64 > file.compressed_bytes {
                return Err(Error("unexpected_download_length".into()));
            }
            self.received += chunk.len() as u64;
            bytes.extend_from_slice(&chunk);
            self.progress("downloading", bytes.len() as u64, file.compressed_bytes);
        }
        if bytes.len() as u64 != file.compressed_bytes || digest(&bytes) != file.compressed_sha256 {
            return Err(Error("download_integrity_failed".into()));
        }
        Ok(bytes)
    }
    async fn file_object(
        &mut self,
        source: &str,
        file: &FileObject,
        total: u64,
    ) -> Result<Vec<u8>> {
        let end = file.offset + file.bytes - 1;
        let mut response = self
            .interruptible(
                self.client
                    .get(source)
                    .header("Accept-Encoding", "identity")
                    .header("Range", format!("bytes={}-{}", file.offset, end))
                    .send(),
            )
            .await?;
        if !range_matches(&response, file.offset, end, total) {
            return Err(Error("range_unavailable".into()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = self.interruptible(response.chunk()).await? {
            if bytes.len() as u64 + chunk.len() as u64 > file.bytes {
                return Err(Error("unexpected_download_length".into()));
            }
            self.received += chunk.len() as u64;
            bytes.extend_from_slice(&chunk);
            self.progress("downloading", bytes.len() as u64, file.bytes);
        }
        if bytes.len() as u64 != file.bytes || digest(&bytes) != file.sha256 {
            return Err(Error("download_integrity_failed".into()));
        }
        Ok(bytes)
    }
}

pub(crate) fn decompress_bounded(
    compressed: &[u8],
    encoding: CompressionEncoding,
    expected_bytes: u64,
    expected_sha256: &str,
    target: &Path,
) -> Result<()> {
    let result = (|| -> Result<()> {
        let mut reader: Box<dyn Read> = match encoding {
            CompressionEncoding::Zstd => Box::new(
                ruzstd::decoding::StreamingDecoder::new(compressed)
                    .map_err(|_| Error("invalid_compressed_object".into()))?,
            ),
            CompressionEncoding::Gzip => Box::new(flate2::read::GzDecoder::new(compressed)),
        };
        let mut limited = (&mut reader).take(expected_bytes.saturating_add(1));
        let mut dest = fs::File::create(target)?;
        let mut hasher = Sha256::new();
        let mut written = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = limited
                .read(&mut buffer)
                .map_err(|_| Error("invalid_compressed_object".into()))?;
            if count == 0 {
                break;
            }
            written += count as u64;
            if written > expected_bytes {
                return Err(Error("unexpected_decompressed_length".into()));
            }
            hasher.update(&buffer[..count]);
            dest.write_all(&buffer[..count])?;
        }
        dest.sync_all()?;
        if written != expected_bytes || hex(&hasher.finalize()) != expected_sha256 {
            return Err(Error("download_integrity_failed".into()));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(target);
    }
    result
}

pub(crate) fn distribution_user_agent(versions: Option<(&str, &str)>) -> String {
    let Some((host, amf)) = versions else {
        return "VUA-distribution/0.3".into();
    };
    if [host, amf]
        .iter()
        .any(|value| value.len() > 96 || semver::Version::parse(value).is_err())
    {
        return "VUA-distribution/0.3".into();
    }
    format!("VUA-distribution/0.3 (host={host}; amf={amf})")
}

fn range_matches(response: &reqwest::Response, start: u64, end: u64, total: u64) -> bool {
    response.status() == reqwest::StatusCode::PARTIAL_CONTENT
        && response
            .headers()
            .get("Content-Range")
            .and_then(|value| value.to_str().ok())
            == Some(format!("bytes {start}-{end}/{total}").as_str())
}
pub fn verified_file(path: &Path, bytes: u64, sha256: &str) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|meta| meta.is_file() && !meta.file_type().is_symlink() && meta.len() == bytes)
        && file_digest(path).is_ok_and(|value| value == sha256)
}

#[cfg(test)]
mod user_agent_tests {
    use super::distribution_user_agent;
    #[test]
    fn reports_only_verified_component_versions_without_a_client_identifier() {
        assert_eq!(
            distribution_user_agent(Some(("1.0.1", "0.3.0"))),
            "VUA-distribution/0.3 (host=1.0.1; amf=0.3.0)"
        );
        assert_eq!(distribution_user_agent(None), "VUA-distribution/0.3");
        assert_eq!(
            distribution_user_agent(Some(("1.0.1-rc.2+build.4", "0.3.0+local"))),
            "VUA-distribution/0.3 (host=1.0.1-rc.2+build.4; amf=0.3.0+local)"
        );
        for invalid in [
            "",
            "1.0",
            "v1.0.1",
            "1.0.1\r\nX-Fake: value",
            "1.0.1; id=x",
            "1.0.1\0",
            "版本1.0.1",
            &format!("1.0.1+{}", "x".repeat(96)),
        ] {
            assert_eq!(
                distribution_user_agent(Some((invalid, "0.3.0"))),
                "VUA-distribution/0.3"
            );
            assert_eq!(
                distribution_user_agent(Some(("1.0.1", invalid))),
                "VUA-distribution/0.3"
            );
        }
    }
}

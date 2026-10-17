//! Concrete VPM backends (E-VPM-DUAL, ADR-0006): the vrc-get library
//! in-process (community, full capability) and the
//! official VCC CLI (`vpm`, .NET) for project creation and registry.
//!
//! Why the library: the vrc-get CLI has no project-creation command and its
//! install confirmation is an interactive prompt that deadlocks on closed
//! stdin (source-verified 2026-08-31). The library exposes the same logic as
//! structured data: `add_package_request` produces a `PendingProjectChanges`
//! (the preview we put into VUA plans) and `apply_pending_changes` applies
//! the exact confirmed set. The crate explicitly does NOT promise stable
//! APIs, so every call is confined to this one adapter and the version is
//! pinned exactly (`=0.0.16`).

use vua_orchestrator::vpm_backend_error_codes as error_codes;
use vua_orchestrator::{
    AppErrorV1, CatalogCapabilities, CatalogVersionV01, ChangeItemV1, ChangeKindV1,
    ChangePreviewV1, ErrorCategory, FileSystemProjectStore, InstalledListingV02,
    InstalledPackageV1, InstalledPackageV02, PackageCatalogV01, PackageCatalogV02,
    PackageRequestV1, PackageSourceV01, ParamValue, ProjectRef, RegisterCapabilities,
    RegisteredProjectV1, RepoCatalogCapabilities, RepoCatalogPackageV01, RepoCatalogRepoV01,
    RepoCatalogV01, RepoInfoV01, RepoInfoV02, RepoLifecycleCapabilities, RepoRefreshOutcomeV01,
    RepoWriteCapabilities, ResolveFailureV01, ResolveReceiptV01, ResolvedPackageV01,
    TemplateCapabilities, TemplateEntryV01, VpmBackend, VpmCapabilities,
};
use vua_orchestrator::{Clock, ProcessRunner, ProcessSpec};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn unsupported(capability: &str) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::CAPABILITY_MISSING,
        ErrorCategory::Unavailable,
        "errors.vpm.capabilityMissing",
        "corr-vpm-backend",
    )
    .with_param("capability", ParamValue::Text(capability.to_owned()))
}

// --- backend 1: vrc-get library (in-process) ---

/// The vrc-get library backend. Owns a dedicated tokio runtime (the library
/// is async; our engine is sync -- blocking calls happen on our worker
/// threads, never inside an async context).
pub struct VrcGetLibBackend {
    runtime: tokio::runtime::Runtime,
    http: reqwest::Client,
    environment_root: PathBuf,
    /// When true, repository listings are read from the local cache only
    /// (no network refresh) -- offline degradation path (ORC-ADP-006).
    offline: bool,
    cached_metadata: bool,
}

impl VrcGetLibBackend {
    /// VCC-compatible environment root by default (ALCOM/vrc-get/VCC all
    /// read the same settings location).
    pub fn new(offline: bool) -> Result<Self, AppErrorV1> {
        let runtime = tokio::runtime::Runtime::new().map_err(|error| {
            AppErrorV1::new(
                error_codes::BACKEND_UNAVAILABLE,
                ErrorCategory::Unavailable,
                "errors.vpm.backendUnavailable",
                "corr-vpm-lib-init",
            )
            .with_param("reason", ParamValue::Text(error.to_string()))
        })?;
        Ok(Self {
            runtime,
            http: reqwest::Client::new(),
            environment_root: default_environment_root(),
            offline,
            cached_metadata: false,
        })
    }

    pub fn with_environment_root(
        environment_root: PathBuf,
        offline: bool,
    ) -> Result<Self, AppErrorV1> {
        let backend = Self::new(offline)?;
        Ok(Self {
            environment_root,
            ..backend
        })
    }

    /// N3 private cache bootstrap using VRChat's alternate official feed.
    /// Publisher identity, package URLs and checksums are kept intact.
    /// Frozen public repository operations retain their existing guards.
    pub fn ensure_official_sdk_cache(&self) -> Result<(), AppErrorV1> {
        let target = self.environment_root.join("Repos/vrc-official.json");
        if let Ok(bytes) = fs::read(&target) {
            if let Ok(cached) = serde_json::from_slice::<vrc_get_vpm::repository::LocalCachedRepository>(&bytes) {
                if cached.id() == Some("com.vrchat.repos.official") && cached.get_versions_of("com.vrchat.avatars").next().is_some() { return Ok(()); }
            }
        }
        const SOURCE: &str = "https://vrchat.github.io/packages/index.json";
        let bytes = self.download_repository_metadata(SOURCE)?;
        let repo: vrc_get_vpm::repository::RemoteRepository = serde_json::from_slice(&bytes).map_err(|e| repo_fetch_failed(e.to_string()))?;
        if repo.id() != Some("com.vrchat.repos.official") || repo.get_versions_of("com.vrchat.avatars").next().is_none() {
            return Err(repo_fetch_failed("official SDK feed identity/package set does not match".into()));
        }
        let cached = vrc_get_vpm::repository::LocalCachedRepository::new(repo, Default::default());
        fs::create_dir_all(target.parent().expect("repository cache parent")).map_err(|e| repo_fetch_failed(e.to_string()))?;
        let pending = target.with_extension("pending");
        fs::write(&pending, serde_json::to_vec_pretty(&cached).map_err(|e| repo_fetch_failed(e.to_string()))?).map_err(|e| repo_fetch_failed(e.to_string()))?;
        fs::rename(pending, target).map_err(|e| repo_fetch_failed(e.to_string()))?;
        fs::write(self.environment_root.join("vua-sdk-source.json"), serde_json::to_vec(&json!({"schemaVersion":"0.1","fetchedFrom":SOURCE,"repositoryId":"com.vrchat.repos.official"})).expect("SDK source serialization"))
            .map_err(|e| repo_fetch_failed(e.to_string()))?;
        Ok(())
    }

    fn download_repository_metadata(&self, url: &str) -> Result<Vec<u8>, AppErrorV1> {
        // reqwest constructs Tokio timers during send(), so construct the
        // request inside the runtime too. Calling block_on(send()) evaluates
        // send outside that runtime and panics on a synchronous worker.
        self.runtime.block_on(async {
            let mut response = self.http.get(url)
                .timeout(std::time::Duration::from_secs(30)).send().await
                .map_err(|e| repo_fetch_failed(format!("loading SDK metadata: {e}")))?
                .error_for_status().map_err(|e| repo_fetch_failed(e.to_string()))?;
            const LIMIT: usize = 2 * 1024 * 1024;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|e| repo_fetch_failed(e.to_string()))? {
                if bytes.len() + chunk.len() > LIMIT {
                    return Err(repo_fetch_failed("official SDK feed exceeds the metadata budget".into()));
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(bytes)
        })
    }

    /// N3 explicitly refreshes its SDK/MA feeds, then resolves their cached
    /// metadata. Package bodies still download online; offline mode is separate.
    pub fn with_cached_metadata(mut self) -> Result<Self, AppErrorV1> {
        self.cached_metadata = true;
        self.http = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(20))
            .timeout(std::time::Duration::from_secs(600)).build().map_err(|e| repo_fetch_failed(e.to_string()))?;
        Ok(self)
    }

    /// Registers one generated local package in this backend's environment.
    ///
    /// Spike/B3 callers provide a dedicated environment root so this never
    /// mutates the user's VCC or ALCOM settings. Registration is deliberately
    /// separate from preview/apply: the normal digest-bound install path still
    /// owns every project mutation.
    pub fn register_local_package(&self, package_root: &Path) -> Result<(), AppErrorV1> {
        let package_root = std::fs::canonicalize(package_root).map_err(|error| {
            AppErrorV1::new(
                error_codes::LOCAL_PACKAGE_INVALID,
                ErrorCategory::Validation,
                "errors.vpm.localPackageInvalid",
                "corr-vpm-local-package",
            )
            .with_param("reason", ParamValue::Text(error.to_string()))
        })?;
        if !package_root.join("package.json").is_file() {
            return Err(AppErrorV1::new(
                error_codes::LOCAL_PACKAGE_INVALID,
                ErrorCategory::Validation,
                "errors.vpm.localPackageInvalid",
                "corr-vpm-local-package",
            )
            .with_param(
                "reason",
                ParamValue::Text("package.json is missing".to_owned()),
            ));
        }

        let environment_root = self.environment_root.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(environment_root.into_boxed_path());
            let mut settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_local_package_io("loading isolated VPM settings"))?;
            match settings.add_user_package(&package_root, &io).await {
                vrc_get_vpm::environment::AddUserPackageResult::Success
                | vrc_get_vpm::environment::AddUserPackageResult::AlreadyAdded => {}
                vrc_get_vpm::environment::AddUserPackageResult::NonAbsolute => {
                    return Err(local_package_invalid("package path is not absolute"));
                }
                vrc_get_vpm::environment::AddUserPackageResult::BadPackage => {
                    return Err(local_package_invalid(
                        "package.json is not a valid local VPM package",
                    ));
                }
            }
            settings
                .save(&io)
                .await
                .map_err(map_local_package_io("saving isolated VPM settings"))?;
            Ok(())
        })
    }

    /// A4 (proposal 026 freeze batch): subscribes one REMOTE repository in
    /// this backend's isolated environment. The manifest fetch (the network
    /// segment inherent to the face) runs through the library's own
    /// downloader; the guard (duplicate url, official/curated/id refusals)
    /// is the library's `Settings::add_remote_repo` bool, answered honestly
    /// as `repo_invalid`. No credentials or HTTP headers are accepted — the
    /// frozen word face transports none, so the header map stays empty.
    pub fn add_remote_repo(&self, url: &str, name: &str) -> Result<(), AppErrorV1> {
        let parsed = url::Url::parse(url)
            .map_err(|error| repo_invalid(format!("url does not parse: {error}")))?;
        let environment_root = self.environment_root.clone();
        let http = self.http.clone();
        let name = name.to_owned();
        self.runtime.block_on(async move {
            // The cache path is this row's own local cache slot under the
            // isolated environment's Repos/ directory (the library's own
            // convention: the subscription's local_path IS the cache path,
            // repo_source.rs); a stable url-name hash keeps rows collision-
            // free per url. The library fills it on the next catalog refresh.
            let cache_path = environment_root
                .join("Repos")
                .join(format!("{}.json", vua_orchestrator::fnv1a_hex(parsed.as_str().as_bytes())));
            let state_root = environment_root.clone();
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            let mut settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_repo_write("loading isolated VPM settings"))?;
            if settings
                .get_user_repos()
                .iter()
                .any(|repo| repo.url() == Some(&parsed))
            {
                return Err(repo_invalid(
                    "a repository with this url is already subscribed",
                ));
            }
            // Brand-new subscription: no cached copy, so no etag is sent.
            // Ok(None) ("not modified") is unreachable without an etag per
            // the library's own contract, but it is answered honestly as a
            // fetch failure, never a success.
            let downloaded =
                vrc_get_vpm::repository::RemoteRepository::download_with_etag(
                    &http,
                    &parsed,
                    &default_of(),
                    None,
                )
                .await
                .map_err(|error| {
                    repo_fetch_failed(format!("fetching the remote repository manifest: {error}"))
                })?;
            let (remote_repo, _etag) = match downloaded {
                Some(pair) => pair,
                None => {
                    return Err(repo_fetch_failed(
                        "the remote manifest fetch returned no content".to_owned(),
                    ));
                }
            };
            if !settings.add_remote_repo(
                &parsed,
                Some(&name),
                Default::default(),
                &remote_repo,
                &cache_path,
            ) {
                return Err(repo_invalid(
                    "the library guard refused this subscription (official/curated or duplicate id)",
                ));
            }
            settings
                .save(&io)
                .await
                .map_err(map_repo_write("saving isolated VPM settings"))?;
            // F4 冻结职责（实现核对切片兑现）：新订阅恒启用——添加成功后以行
            // 生效 id 清扫 VUA 自有状态文件中的禁用残留（清单 id；无 id 清单按
            // 库 UserRepoSetting::new 回填惯例以 url 串为行 id）。共享
            // settings.json 的写入已在上行由库 save 完成，本步绝不二次触碰它。
            let effective_id = remote_repo
                .id()
                .map(str::to_owned)
                .unwrap_or_else(|| parsed.as_str().to_owned());
            prune_disabled_entry(&state_root, &effective_id)?;
            Ok(())
        })
    }

    /// A4 (proposal 026 freeze batch): subscribes one LOCAL directory
    /// repository in this backend's isolated environment. The frozen word
    /// face says "the local repository directory"; the library persists the
    /// subscription row's local_path and later READS that path AS the
    /// manifest json (`load_repo_from_cache` parse_json_file on url-less
    /// rows), so the directory maps onto its `repo.json` (the VCC-ecosystem
    /// standard manifest name inside the directory) — declared here, and a
    /// directory without one is the honest malformed-shape refusal.
    pub fn add_local_repo(&self, path: &Path, name: &str) -> Result<(), AppErrorV1> {
        let dir = std::fs::canonicalize(path)
            .map_err(|error| repo_invalid(format!("local repository path does not resolve: {error}")))?;
        if !dir.is_dir() {
            return Err(repo_invalid("local repository path is not a directory"));
        }
        let manifest = dir.join("repo.json");
        if !manifest.is_file() {
            return Err(repo_invalid(
                "repo.json is missing in the local repository directory",
            ));
        }
        let environment_root = self.environment_root.clone();
        let name = name.to_owned();
        self.runtime.block_on(async move {
            let state_root = environment_root.clone();
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            let mut settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_repo_write("loading isolated VPM settings"))?;
            if !settings.add_local_repo(&manifest, Some(&name)) {
                return Err(repo_invalid(
                    "a repository with this path is already subscribed",
                ));
            }
            settings
                .save(&io)
                .await
                .map_err(map_repo_write("saving isolated VPM settings"))?;
            // F4 冻结职责（实现核对切片兑现）：新订阅恒启用。本地行在添加时
            // 无 id（库 add_local_repo 恒建 id=None 行），但清单自带 id 会在
            // 其后集合装载时被库回填为行 id（vpm_settings.rs update_id）——
            // 残留清扫因此按清单自身 id 键执行：同 id 的陈旧禁用残留若在，
            // 添加成功即清除，新订阅从启用态开始。id 缺席清单无可清扫键——
            // id 缺席行本就在启停面可达范围之外（恒 true），无需清扫。
            let manifest_id: Option<String> = std::fs::read(&manifest)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
                .and_then(|value| {
                    value
                        .get("id")
                        .and_then(|id| id.as_str())
                        .map(str::to_owned)
                });
            if let Some(id) = manifest_id {
                prune_disabled_entry(&state_root, &id)?;
            }
            Ok(())
        })
    }

    /// A4 (proposal 026 freeze batch): removes ONE subscription row by its
    /// repository id. Rows without an id are outside the word face's remove
    /// reach (frozen protocol boundary); the removed-row list being empty is
    /// the honest `repo_not_found` — never a silent success.
    pub fn remove_repo(&self, repo_id: &str) -> Result<(), AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let repo_id = repo_id.to_owned();
        self.runtime.block_on(async move {
            let state_root = environment_root.clone();
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            let mut settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_repo_write("loading isolated VPM settings"))?;
            let removed =
                settings.remove_repo(|repo| repo.id() == Some(repo_id.as_str()));
            if removed.is_empty() {
                return Err(repo_not_found(&repo_id));
            }
            settings
                .save(&io)
                .await
                .map_err(map_repo_write("saving isolated VPM settings"))?;
            // F4 冻结职责（实现核对切片兑现）：移除不留状态残留——被移除行
            // 携带的每个 id 自 VUA 自有禁用集中清扫（共享 settings.json 的写
            // 入已由库 save 完成，本步绝不二次触碰它）。
            for row in &removed {
                if let Some(id) = row.id() {
                    prune_disabled_entry(&state_root, id)?;
                }
            }
            Ok(())
        })
    }

    /// F4 (proposal 027 freeze batch, implementation-verification slice): the
    /// enable/disable write pair over the VUA-OWNED state file
    /// (`<environment_root>/.vua/vpm-repo-state.json`, the storage ruling).
    /// The shared settings.json is only ever READ here — to verify the
    /// repoId exists in the subscription world (the not-found fact); the
    /// toggle itself never writes it, never touches userRepos[i], never adds
    /// a settings.json top-level key. Unknown repoId answers the REUSED
    /// `vua.vpm.repo_not_found`; state-file read/write failures answer the
    /// REUSED `vua.vpm.repo_write_failed` (zero new codes — the freeze
    /// transports honest faces, it mints no code).
    pub fn enable_repo(&self, repo_id: &str) -> Result<(), AppErrorV1> {
        self.set_repo_enabled(repo_id, true)
    }

    /// F4: see [`VrcGetLibBackend::enable_repo`]. The disabled row STAYS
    /// subscribed and listed (the packages-repos v0.2 `enabled` bit projects
    /// the state); its packages leave the package-collection world AT THE
    /// COLLECTION LOAD LAYER (the F4 patch slice: every collection-loading
    /// face — repo-catalog listing, latest judgment, install resolution —
    /// builds its collection from the disable-filtered settings clone via
    /// `collection_world`, so enumeration and resolution never see the
    /// disabled row's packages).
    pub fn disable_repo(&self, repo_id: &str) -> Result<(), AppErrorV1> {
        self.set_repo_enabled(repo_id, false)
    }

    fn set_repo_enabled(&self, repo_id: &str, enabled: bool) -> Result<(), AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let repo_id = repo_id.to_owned();
        self.runtime.block_on(async move {
            let state_path = repo_state_path(&environment_root);
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            // settings.json read-only: the id-existence check rides the
            // library's own settings load (the shared file carries shared
            // facts; the toggle state stays in VUA's own file below).
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_repo_write("loading isolated VPM settings"))?;
            if !settings
                .get_user_repos()
                .iter()
                .any(|repo| repo.id() == Some(repo_id.as_str()))
            {
                return Err(repo_not_found(&repo_id));
            }
            let mut disabled = load_disabled_set(&state_path)
                .map_err(|reason| repo_write_failed_text("reading the VUA repository state file", reason))?;
            let changed = if enabled {
                disabled.remove(&repo_id)
            } else {
                disabled.insert(repo_id)
            };
            if changed {
                write_disabled_set(&state_path, &disabled).map_err(|error| {
                    repo_write_failed_text("writing the VUA repository state file", error)
                })?;
            }
            Ok(())
        })
    }

    /// F4: the etag-conditional cache refresh of ONE subscription row's OWN
    /// cache file (`userRepos[i].localPath` — the exact write vrc-get itself
    /// performs, same-origin with VCC/vrc-get; the official/curated
    /// predefined caches have no repoId and are unreachable). The
    /// implementation mirrors the library's own per-row update arm
    /// (repo_holder.rs `update_cache`) verbatim:
    /// - cache doc present → download from the SUBSCRIPTION url (the
    ///   library's load-time `set_url` law) with the doc's own headers and
    ///   its `vrc-get.etag`;
    /// - cache doc absent/unparseable → full download (no etag) with the
    ///   subscription row's headers;
    /// - no effective url (a local-directory row) → the library's own arm is
    ///   a no-op (`Ok(false)`, repo_holder.rs: the row has no remote to
    ///   fetch) — answered as `cache_updated = false` ("no new data"), never
    ///   an error, never a write;
    /// - HTTP 304 with etag → `cache_updated = false`, zero writes;
    /// - new content → the refreshed document is written to the row's own
    ///   localPath with the new etag → `cache_updated = true`.
    ///
    /// BOTH success arms are the frozen outcome pair; "no new data" is an
    /// outcome never an error. Refresh never touches the enable/disable
    /// state file and never writes settings.json. Unknown repoId answers the
    /// REUSED `vua.vpm.repo_not_found`; the network segment failing answers
    /// the REUSED `vua.vpm.repo_fetch_failed`; cache write-back failures
    /// answer the REUSED `vua.vpm.repo_write_failed` (zero new codes).
    pub fn refresh_repo(&self, repo_id: &str) -> Result<RepoRefreshOutcomeV01, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let repo_id = repo_id.to_owned();
        let http = self.http.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_repo_write("loading isolated VPM settings"))?;
            let row = settings
                .get_user_repos()
                .iter()
                .find(|repo| repo.id() == Some(repo_id.as_str()))
                .ok_or_else(|| repo_not_found(&repo_id))?;
            let cache_path: PathBuf = row.local_path().to_owned();
            let subscription_url = row.url().cloned();
            let subscription_headers = row.headers().clone();

            // load_repo_from_cache 镜像：缓存文档存在且可解析 → Loaded 臂
            // （url 行的下载 url＝订阅 url——库装载 set_url 律；headers 取
            // 文档自身）；文档缺席/不可解析 → NotDownloaded 臂（订阅 url＋订
            // 阅 headers、无 etag）。etag 载体＝缓存文档自身 `vrc-get.etag`
            // （LocalCachedRepository 的 vrc_get 字段 pub(crate) 无访问器，
            // 从原始 JSON 同源读取；空串按库 serde skip 语义视同无 etag）。
            let bytes = std::fs::read(&cache_path).ok();
            let loaded = bytes.as_deref().and_then(|doc_bytes| {
                serde_json::from_slice::<vrc_get_vpm::repository::LocalCachedRepository>(
                    doc_bytes,
                )
                .ok()
            });
            let current_etag: Option<String> = bytes
                .as_deref()
                .and_then(|doc_bytes| serde_json::from_slice::<serde_json::Value>(doc_bytes).ok())
                .and_then(|value| {
                    value
                        .get("vrc-get")
                        .and_then(|meta| meta.get("etag"))
                        .and_then(|etag| etag.as_str())
                        .map(str::to_owned)
                })
                .filter(|etag| !etag.is_empty());
            let (url, headers, current_etag) = match &loaded {
                Some(doc) => (
                    subscription_url.clone().or_else(|| doc.url().cloned()),
                    doc.headers().clone(),
                    current_etag,
                ),
                None => (subscription_url, subscription_headers, None),
            };
            let Some(url) = url else {
                // 无有效 url（本地目录行）：库自身 update 臂对该行零动作
                // （无远端可取）——诚实两臂结果的「无新数据」臂，零写零错。
                return Ok(RepoRefreshOutcomeV01 {
                    cache_updated: false,
                });
            };
            match vrc_get_vpm::repository::RemoteRepository::download_with_etag(
                &http,
                &url,
                &headers,
                current_etag.as_deref(),
            )
            .await
            {
                // etag 未变（304）：已是最新是刷新结果，不是错误；零写入。
                Ok(None) => Ok(RepoRefreshOutcomeV01 {
                    cache_updated: false,
                }),
                Ok(Some((remote_repo, new_etag))) => {
                    // set_repo/set_etag 为 pub(crate)：以库公共 Serialize 形态
                    // 重建同一文档（下载文档恒带 id/url，set_repo 的继承臂无
                    // 效果差），再于序列化产物上注入 vrc-get.etag——写回字节
                    // 与库自身 save 同形（缓存文档自嵌 repo 对象＋vrc-get 元
                    // 数据，实机缓存文件形态逐字段同构）。
                    let new_doc = vrc_get_vpm::repository::LocalCachedRepository::new(
                        remote_repo,
                        headers,
                    );
                    let mut value = serde_json::to_value(&new_doc).map_err(|error| {
                        repo_write_failed_text("serializing the refreshed cache", error)
                    })?;
                    if let Some(etag) = new_etag.as_ref() {
                        value["vrc-get"] = serde_json::json!({ "etag": etag });
                    }
                    let mut doc_bytes = serde_json::to_vec_pretty(&value).map_err(|error| {
                        repo_write_failed_text("serializing the refreshed cache", error)
                    })?;
                    doc_bytes.push(b'\n');
                    // The library pre-creates the Repos/ cache folder at
                    // collection-load time (repo_holder.rs load_cache); the
                    // per-row mirror creates the cache path's own parent so a
                    // never-loaded environment still receives its first cache.
                    if let Some(parent) = cache_path.parent() {
                        std::fs::create_dir_all(parent).map_err(|error| {
                            repo_write_failed_text(
                                "creating the repository cache directory",
                                error,
                            )
                        })?;
                    }
                    std::fs::write(&cache_path, doc_bytes).map_err(|error| {
                        repo_write_failed_text("writing the refreshed repository cache", error)
                    })?;
                    Ok(RepoRefreshOutcomeV01 {
                        cache_updated: true,
                    })
                }
                Err(error) => Err(repo_fetch_failed(format!(
                    "refreshing the repository cache: {error}"
                ))),
            }
        })
    }

    fn digest_of(
        items: &[ChangeItemV1],
        conflicts: &[String],
        legacy_files: &[String],
        legacy_folders: &[String],
    ) -> String {
        let canonical = json!({
            "items": items,
            "conflicts": conflicts,
            "legacyFiles": legacy_files,
            "legacyFolders": legacy_folders,
        });
        vua_orchestrator::fnv1a_hex(canonical.to_string().as_bytes())
    }
}

fn local_package_invalid(reason: &str) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::LOCAL_PACKAGE_INVALID,
        ErrorCategory::Validation,
        "errors.vpm.localPackageInvalid",
        "corr-vpm-local-package",
    )
    .with_param("reason", ParamValue::Text(reason.to_owned()))
}

fn map_local_package_io(context: &'static str) -> impl Fn(std::io::Error) -> AppErrorV1 {
    move |error| {
        AppErrorV1::new(
            error_codes::LOCAL_PACKAGE_REGISTER_FAILED,
            ErrorCategory::ExternalFailure,
            "errors.vpm.localPackageRegisterFailed",
            "corr-vpm-local-package",
        )
        .with_param("reason", ParamValue::Text(format!("{context}: {error}")))
    }
}

/// Infers `T: Default` from the call site (the library's `IndexMap`
/// headers type is not nameable without adding a direct indexmap
/// dependency; the empty map is the only value this face ever needs).
fn default_of<T: Default>() -> T {
    T::default()
}

/// A4 (proposal 026 freeze batch): one malformed-subscription refusal —
/// unparseable url, unresolvable path, missing repo.json, duplicate
/// url/path, official/curated guard. The port's single Validation code.
fn repo_invalid(reason: impl std::fmt::Display) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::REPO_INVALID,
        ErrorCategory::Validation,
        "errors.vpm.repoInvalid",
        "corr-vpm-repo-write",
    )
    .with_param("reason", ParamValue::Text(reason.to_string()))
}

/// A4: the manifest-fetch network segment failed (add_remote_repo only).
fn repo_fetch_failed(reason: String) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::REPO_FETCH_FAILED,
        ErrorCategory::ExternalFailure,
        "errors.vpm.repoFetchFailed",
        "corr-vpm-repo-write",
    )
    .with_param("reason", ParamValue::Text(reason))
}

/// A4: isolated-environment settings read/write-back failure — the same
/// io-leg discipline as `map_local_package_io` (ExternalFailure, context
/// prefix), mapped onto the face's own write-failed code.
fn map_repo_write(context: &'static str) -> impl Fn(std::io::Error) -> AppErrorV1 {
    move |error| {
        AppErrorV1::new(
            error_codes::REPO_WRITE_FAILED,
            ErrorCategory::ExternalFailure,
            "errors.vpm.repoWriteFailed",
            "corr-vpm-repo-write",
        )
        .with_param("reason", ParamValue::Text(format!("{context}: {error}")))
    }
}

/// P2 读面的环境/缓存 io 失败映射：复用 `backend_unavailable`（025 冻结批
/// 裁决 5 复用清单），不发明新码。
fn map_environment_io(context: &'static str) -> impl Fn(std::io::Error) -> AppErrorV1 {
    move |error| {
        AppErrorV1::new(
            error_codes::BACKEND_UNAVAILABLE,
            ErrorCategory::Unavailable,
            "errors.vpm.backendUnavailable",
            "corr-vpm-catalog",
        )
        .with_param("reason", ParamValue::Text(format!("{context}: {error}")))
    }
}

/// 027 F4 补切片：集合装载腿的 VUA 启停状态文件读取失败＝包集合世界无法
/// 如实枚举/判定/解析（enabled 位是每行必带事实，无状态即无法投影——
/// 与 v0.2 投影面同事实同律），复用 `backend_unavailable`（025 冻结批复用
/// 清单；v0.2 投影面 `list_repos_v02` 同码同词位同 reason 文本——一事实一
/// 码），绝不以「全启用」猜测。共享构造器替代 v0.2 面的内联闭包（零字节
/// 差异）并服务全部装载点。
fn backend_unavailable_state(reason: impl std::fmt::Display) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::BACKEND_UNAVAILABLE,
        ErrorCategory::Unavailable,
        "errors.vpm.backendUnavailable",
        "corr-vpm-catalog",
    )
    .with_param(
        "reason",
        ParamValue::Text(format!("reading the VUA repository state file: {reason}")),
    )
}

/// One subscription row projected verbatim (025 freeze batch `RepoInfoV01`):
/// the four identifier/location facts are the library Options projected as
/// null (a local-directory repo has no url); `cached` is the REQUIRED
/// per-repo cache-hit fact, derived exactly where the library derives its
/// own Loaded/NotDownloaded state (repo_holder.rs `load_repo_from_cache`:
/// the subscription's `local_path` IS the cache path — repo_source.rs — so
/// cached = that file exists and parses as a JSON object). false = subscribed
/// but never refreshed: its own honest listed state, never an empty catalog.
fn repo_info_row(repo: &vrc_get_vpm::UserRepoSetting) -> RepoInfoV01 {
    let cached = repo_cached_fact(repo.local_path());
    RepoInfoV01 {
        repo_id: repo.id().map(str::to_owned),
        name: repo.name().map(str::to_owned),
        url: repo.url().map(|url| url.to_string()),
        local_path: Some(repo.local_path().to_string_lossy().into_owned()),
        cached,
    }
}

/// The per-repo cache-hit fact (025 冻结批 `cached` 键)：缓存文件存在且可解析
/// 为 JSON 对象即命中。库自身的 Loaded/NotDownloaded 判定同源（local_path 即
/// 缓存路径），订阅面与 v0.2 状态面共用同一事实源。
fn repo_cached_fact(cache_path: &Path) -> bool {
    fs::read(cache_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .is_some_and(|value| value.is_object())
}

// --- 027 F4: VUA-owned repository enable/disable state storage ---
//
// 存储裁决（027 F4 冻结批词面权威，packages-ops v0.6 协议本「存储裁决」节）：
// 禁用集住 VUA 自有存储 `<environment_root>/.vua/vpm-repo-state.json`——
// 绝不入 userRepos[i] 元素（vrc-get 五键闭集，元素内未知键被库自身 save 剥
// 除）、绝不立 settings.json 顶层新键（VCC/ALCOM 写方对未知顶层键容忍未经
// 真机核实；共享文件只载共享事实）。文件缺席＝全部启用（诚实空态，非错误）。
// 持久化格式按文档纪律携显式机器可读版本（schemaVersion=1；未知键容忍、
// 缺版本键即拒——版本增量机器可检测）。

/// VUA 状态目录（`.vua` 惯例——真机家族清单 027 s6(a) 证实现根无该条目，
/// 与 Logs/、Updater/ 等工具自有目录同存的共存模式）。
const VUA_STATE_DIR: &str = ".vua";
const VUA_REPO_STATE_FILE: &str = "vpm-repo-state.json";
const VUA_REPO_STATE_SCHEMA_VERSION: i64 = 1;

/// 启停状态文件路径：`<environment_root>/.vua/vpm-repo-state.json`（冻结
/// 词面钉死的唯一存储位）。
fn repo_state_path(environment_root: &Path) -> PathBuf {
    environment_root
        .join(VUA_STATE_DIR)
        .join(VUA_REPO_STATE_FILE)
}

/// The persisted VUA-owned state document (schemaVersion 1): the disable set
/// keyed by repoId. Absent file = the all-enabled honest empty state.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoStateFileV1 {
    schema_version: i64,
    disabled_repo_ids: Vec<String>,
}

/// Reads the disable set. Absent file = the honest empty set (all enabled);
/// a present-but-unreadable or version-mismatched file is a refusal (the
/// enabled bit is REQUIRED per row — without the state it cannot be
/// projected truthfully, and guessing is never an option). The reason string
/// carries the failure fact; the caller maps it onto its own face's reused
/// code (write faces: `repo_write_failed`; the v0.2 read face:
/// `backend_unavailable`).
fn load_disabled_set(state_path: &Path) -> Result<BTreeSet<String>, String> {
    let bytes = match fs::read(state_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeSet::new()),
        Err(error) => return Err(format!("reading the state file failed: {error}")),
    };
    let document: RepoStateFileV1 = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parsing the state file failed: {error}"))?;
    if document.schema_version != VUA_REPO_STATE_SCHEMA_VERSION {
        return Err(format!(
            "unsupported state schema version {} (expected {VUA_REPO_STATE_SCHEMA_VERSION})",
            document.schema_version
        ));
    }
    Ok(document.disabled_repo_ids.into_iter().collect())
}

/// Writes the disable set (the ONLY writer of the VUA-owned file; settings.json
/// is never touched on this path — the storage ruling's whole point). The
/// `.vua` directory is created on demand.
///
/// 第 160 批（自我反向审查·半写面）：落盘走家法原子替换（ORC-STO-003
/// state_file.rs `save` 同律；material_identity.rs 同加 sync_all）——先写
/// 同目录 `.tmp` 伴兄弟、sync_all 落盘、再 `fs::rename` 原位替换（std 在
/// Windows 走 MOVEFILE_REPLACE_EXISTING，同卷同目录确定性生效）。直接
/// `fs::write` 的断电窗口会把文件截成半份 JSON：读侧虽有诚实拒绝钉
/// （f4/f6 两钉、绝不猜「全启用」），但此后全部集合装载面将拒绝服务直至
/// 手工修复；原子替换把坏状态档从根上排除。刻意不走 material_identity 的
/// 先 remove-后-rename 变体——两步之间的崩溃会制造「文件缺席」，而本文件
/// 词面「缺席＝全部启用」会把禁用集静默丢失；直接 rename 下崩溃只落在
/// 旧完整档或新完整档，永不缺席、永不半份。成功后无 `.tmp` 残留。
fn write_disabled_set(state_path: &Path, disabled: &BTreeSet<String>) -> std::io::Result<()> {
    if let Some(parent) = state_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let document = RepoStateFileV1 {
        schema_version: VUA_REPO_STATE_SCHEMA_VERSION,
        disabled_repo_ids: disabled.iter().cloned().collect(),
    };
    let mut bytes = serde_json::to_vec_pretty(&document)?;
    bytes.push(b'\n');
    use std::io::Write as _;
    let temporary = state_path.with_extension("tmp");
    {
        let mut output = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)?;
        output.write_all(&bytes)?;
        output.sync_all()?;
    }
    fs::rename(&temporary, state_path)
}

/// Drops one repoId from the disable set, writing only when something was
/// actually removed (the add/remove faces' F4 frozen duty: a newly added
/// subscription row is always enabled — adds reset stale state — and a
/// removed row leaves no state residue). State-write failures answer the
/// faces' own reused `repo_write_failed` (zero new codes).
fn prune_disabled_entry(environment_root: &Path, repo_id: &str) -> Result<(), AppErrorV1> {
    let state_path = repo_state_path(environment_root);
    let mut disabled = load_disabled_set(&state_path).map_err(|reason| {
        repo_write_failed_text("reading the VUA repository state file", &reason)
    })?;
    if disabled.remove(repo_id) {
        write_disabled_set(&state_path, &disabled)
            .map_err(|error| repo_write_failed_text("writing the VUA repository state file", error))?;
    }
    Ok(())
}

/// 027 F4 补切片（装载层一次过滤——冻结词面「启停语义」效果面的唯一兑现
/// 点）：包集合世界的装载输入构造。禁用＝该行**离开包集合世界**
/// （packages-ops v0.6 协议本「启停语义（冻结词面事实）」节）：枚举与解析
/// 面（repo-catalog 列表、latest 判定、A2 安装解析器）不再见其包——过滤
/// 在集合装载之前、settings 的内存克隆上一次完成；全部装载点
/// （`repo_catalog`／`package_catalog_impl`／`list_packages_v02` latest 判
/// 定／`preview_install`+`apply_install` 安装解析／`resolve_project`
/// 依赖解析——第 160 批枚举校准：该面第 146 批起同律接入）共用本函数，
/// 绝不在消费点重复判断。
///
/// - 状态事实源＝VUA 自有状态文件（`repo_state_path`；文件缺席＝全启用的
///   诚实空态）。读取失败＝`Err(String)`，调用面经 `backend_unavailable_state`
///   映射复用码——无状态即无法如实枚举，绝不以「全启用」猜测。
/// - 过滤载体＝库公开 API `Settings::remove_repo`（retain 语义）按 repoId
///   精确移除，作用在克隆上：共享 settings.json 零触碰（装载路径本就不
///   save）、禁用行的缓存文件零触碰（离开集合世界≠删除缓存——重新启用
///   即原样恢复）。id 缺席行不在禁用集可达范围（行柄边界，v0.2 投影同律）。
///   预定义两仓不在 userRepos、无 repoId 可达臂（启停写面 repo_not_found
///   同边界），天然不受过滤——与存储裁决一致。
/// - 返回禁用集本体：repo-catalog 第 2 层（订阅行未装载余部）投影需要该
///   事实——禁用行必须按「未装载」呈行（订阅面继续列出行，配置视图零隐
///   藏）。这是行投影事实，不是对集合的二次过滤。
fn collection_world(
    environment_root: &Path,
    settings: &vrc_get_vpm::environment::Settings,
) -> Result<(vrc_get_vpm::environment::Settings, BTreeSet<String>), String> {
    let disabled = load_disabled_set(&repo_state_path(environment_root))?;
    let mut world = settings.clone();
    if !disabled.is_empty() {
        world
            .remove_repo(|repo| repo.id().is_some_and(|id| disabled.contains(id)));
    }
    Ok((world, disabled))
}

/// A4：仓库写面族共用错误构造（读/写原因以文本携带——serde_json 错误等非
/// io 错误与 io 错误同形映射，复用码零新立）。
fn repo_write_failed_text(context: &str, reason: impl std::fmt::Display) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::REPO_WRITE_FAILED,
        ErrorCategory::ExternalFailure,
        "errors.vpm.repoWriteFailed",
        "corr-vpm-repo-write",
    )
    .with_param("reason", ParamValue::Text(format!("{context}: {reason}")))
}

/// A4/F4 共用：词表外 repoId 的诚实拒绝（复用码，零新立）。行存在性以订阅
/// 世界（settings userRepos 的 id）为准。
fn repo_not_found(repo_id: &str) -> AppErrorV1 {
    AppErrorV1::new(
        error_codes::REPO_NOT_FOUND,
        ErrorCategory::Validation,
        "errors.vpm.repoNotFound",
        "corr-vpm-repo-write",
    )
    .with_param("repoId", ParamValue::Text(repo_id.to_owned()))
}

/// 027 F2（实现核对切片）：预定义两仓的订阅 url（库私有常量逐字镜像——
/// vrc-get-vpm 0.0.16 environment.rs:45/:47，依赖锁定 =0.0.16）。仅用于
/// 「该预定义仓是否已被集合装载」的 url 命中判定（装载时库把缓存文档 url
/// 覆写为订阅 url，repo_holder.rs load_repo_from_cache），缓存文件的路径
/// 面照协议本根事实专节由库自身解析（Repos/vrc-official.json、
/// Repos/vrc-curated.json，相对环境根），本适配层不拼装、不读写。
const OFFICIAL_REPO_URL: &str = "https://packages.vrchat.com/official?download";
const CURATED_REPO_URL: &str = "https://packages.vrchat.com/curated?download";

/// 027 F2（实现核对切片）：单仓库缓存清单的包行投影。包事实唯一解析源＝
/// 库集合：`get_latest(latest_for(None, show_prerelease))`（remote.rs:212–223
/// ——satisfies 链＝非 yanked＋prerelease 开关，project_unity=None 时 unity
/// 过滤全通＝冻结词面「无工程 Unity 约束」）；`latestVersion: null`＝当前
/// 设置下无合资格版本——行仍在、缺席不是「无包」。`versionCount`＝缓存清
/// 单自身条目计数（all_versions，yanked 计入）——按缓存事实计数，不是可用
/// 性承诺。`packageIds` 过滤是透镜：不匹配＝诚实空数组，绝不是错误
/// （`no_matching_package` 在本面无适用范围）。行序＝文档自身 packages 枚
/// 举序（IndexMap 插入序），不发明排序键。
fn repo_catalog_packages(
    repo: &vrc_get_vpm::repository::LocalCachedRepository,
    show_prerelease: bool,
    filter: &HashSet<&str>,
) -> Vec<RepoCatalogPackageV01> {
    let selector = vrc_get_vpm::VersionSelector::latest_for(None, show_prerelease);
    repo.get_packages()
        .filter_map(|packages| {
            // 身份事实载体：合资格最新版优先；无合资格版本（全 yanked／被
            // prerelease 开关排除）时取版本最高的条目承载身份——行仍在，
            // latestVersion 如实 null。
            let latest = packages.get_latest(selector);
            let identity =
                latest.or_else(|| packages.all_versions().max_by_key(|m| m.version()))?;
            if !filter.is_empty() && !filter.contains(identity.name()) {
                return None;
            }
            Some(RepoCatalogPackageV01 {
                package_id: identity.name().to_owned(),
                display_name: identity.display_name().map(str::to_owned),
                description: identity.description().map(str::to_owned),
                latest_version: latest.map(|manifest| manifest.version().to_string()),
                version_count: packages.all_versions().count() as u64,
            })
        })
        .collect()
}

/// The `compatible` judgment (025 freeze batch: evaluated against the
/// selected project's Unity version). This re-creates vrc-get's
/// `unity_compatible` (lib.rs:208, private fn, dependency locked =0.0.16)
/// in FULL — all four arms, including the VRCSDK-for-2019, the
/// resolver-for-2019, and the VRCSDK exact-major.minor special cases.
/// Core stance on proposal 025 (inline thread) adopted the duplicate with
/// the general-branch-only landing rejected: `update_available` in the
/// same response already walks `VersionSelector::latest_for` whose
/// `satisfies` chain (version_selector.rs:83) runs the full
/// `unity_compatible` semantics, so one catalog response must carry one
/// compatibility definition, and the wire fact must mean what the
/// behavioral authority (vrc-get) will actually do — e.g. VRCSDK 3.5+
/// against a Unity 6000 project is library-incompatible while the general
/// branch alone would call it compatible.
fn catalog_compatible(
    package: &vrc_get_vpm::PackageManifest,
    unity: vrc_get_vpm::version::UnityVersion,
) -> bool {
    // Verbatim from vrc-get-vpm 0.0.16 lib.rs:210–218.
    fn is_vrcsdk_for_2019(version: &vrc_get_vpm::version::Version) -> bool {
        version.major == 3 && version.minor <= 4
    }

    fn is_resolver_for_2019(version: &vrc_get_vpm::version::Version) -> bool {
        version.major == 0 && version.minor == 1 && version.patch <= 26
    }

    match package.name() {
        "com.vrchat.avatars" | "com.vrchat.worlds" | "com.vrchat.base"
            if is_vrcsdk_for_2019(package.version()) =>
        {
            // This VRCSDK generation is Unity-2019-only; every other Unity
            // major is unsatisfied (library lib.rs:220–224).
            unity.major() == 2019
        }
        "com.vrchat.core.vpm-resolver" if is_resolver_for_2019(package.version()) => {
            // Resolver ≤0.1.26 is Unity-2019-only (library lib.rs:225–228).
            unity.major() == 2019
        }
        "com.vrchat.avatars" | "com.vrchat.worlds" | "com.vrchat.base"
            if let Some(target_unity) = package.unity() =>
        {
            // VRCSDK enforces exact major.minor matching. NOT part of the
            // VPM specification; prevents incorrectly treating VRCSDK for
            // 2022 as compatible with Unity 6000 series (library
            // lib.rs:229–236).
            target_unity.major() == unity.major() && target_unity.minor() == unity.minor()
        }
        _ => {
            // Otherwise the package's `unity` field is the VPM spec's
            // MINIMUM Unity constraint: compatible = the project version is
            // at least that major.minor; no `unity` field satisfies every
            // version (library lib.rs:237–255).
            match package.unity() {
                Some(min_unity) => {
                    unity
                        >= vrc_get_vpm::version::UnityVersion::new(
                            min_unity.major(),
                            min_unity.minor(),
                            0,
                            vrc_get_vpm::version::ReleaseType::Alpha,
                            0,
                        )
                }
                None => true,
            }
        }
    }
}

fn default_environment_root() -> PathBuf {
    // Mirrors DefaultEnvironmentIo::new_default: the VRChat CreatorCompanion
    // directory is the shared, VCC-compatible configuration home.
    let local = std::env::var("LOCALAPPDATA")
        .or_else(|_| {
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .map(|profile| format!("{profile}\\AppData\\Local"))
        })
        .unwrap_or_default();
    PathBuf::from(local).join("VRChatCreatorCompanion")
}

impl VpmBackend for VrcGetLibBackend {
    fn name(&self) -> &'static str {
        "vrc-get-lib"
    }

    fn capabilities(&self) -> VpmCapabilities {
        VpmCapabilities {
            create_project: true,
            preview_install: true,
            list_packages: true,
            remove_packages: true,
            project_registry: true,
            // 第 146 批（用户裁决 2026-09-21：先做好 SDK 导入再真机验收）：
            // 库后端具备工程依赖解析能力（vrc-get-vpm 0.0.16 should_resolve /
            // resolve_request / apply_pending_changes），能力如实随实现翻转。
            // `VccCliBackend` 不覆写——CLI 无 resolve 命令，如实维持缺位。
            resolve_project: true,
        }
    }

    fn catalog_capabilities(&self) -> CatalogCapabilities {
        // 025 冻结批裁决 4：恰在实现 `list_repos`/`package_catalog` 时覆写
        // 默认 declared-none（ORC-DEV-004 无实现不预留）。`VccCliBackend`
        // 不覆写——不声明，五位 `VpmCapabilities` 闭集与其默认缺席臂零改动。
        CatalogCapabilities { catalog: true }
    }

    fn register_capabilities(&self) -> RegisterCapabilities {
        // 026 A3 冻结批：恰在实现 `register_local_package` 时覆写默认
        // declared-none（025 catalog 同律，ORC-DEV-004）。注册是库内实现
        // （vrc-get 0.0.16 `Settings::add_user_package`），无外部进程依赖，
        // 能力如实随实现翻转；覆写前 served 行 `packages.registerOps`
        // 如实 unavailable。`VccCliBackend` 不覆写——不声明，缺席臂零改动。
        RegisterCapabilities {
            register_local_package: true,
        }
    }

    fn register_local_package(&self, package_root: &Path) -> Result<(), AppErrorV1> {
        VrcGetLibBackend::register_local_package(self, package_root)
    }

    fn repo_write_capabilities(&self) -> RepoWriteCapabilities {
        // 026 A4 冻结批：恰在实现三仓库写方法时覆写默认 declared-none
        // （025/026 catalog 与 register 同律，ORC-DEV-004）。三独立位如实
        // 声明——后端可只服务子集，门按方法绝不按面；覆写前 served 行
        // `packages.repoOps` 如实 unavailable。`VccCliBackend` 不覆写——
        // 不声明，缺席臂零改动。
        RepoWriteCapabilities {
            add_remote_repo: true,
            add_local_repo: true,
            remove_repo: true,
        }
    }

    fn repo_catalog_capabilities(&self) -> RepoCatalogCapabilities {
        // 027 F2 冻结批（实现核对切片）：恰在实现 `repo_catalog` 时覆写默认
        // declared-none（025/026 catalog/register/repo-write 同律，
        // ORC-DEV-004）。库后端具备仓库级列表能力（PackageCollection::
        // get_remote，环境考证 3bd4f12 §1(a)），能力如实随实现翻转——覆写即
        // served 行 `packages.repoCatalogOps` 翻转 available（此前按默认
        // declared-none 如实维持不可用）。`VccCliBackend` 不覆写——CLI 无仓
        // 库级包列表能力（考证 §1 CLI 臂），如实维持 declared-none，缺席臂
        // 零改动。
        RepoCatalogCapabilities {
            repo_catalog: true,
        }
    }

    fn repo_lifecycle_capabilities(&self) -> RepoLifecycleCapabilities {
        // 027 F4 冻结批（实现核对切片）：恰在实现 enable_repo/disable_repo/
        // refresh_repo 三方法时覆写默认 declared-none（025/026/027 catalog/
        // register/repo-write/repo-catalog 同律，ORC-DEV-004 无实现不预留）。
        // 三独立位如实声明（A4 三位律：门按方法绝不按面）——覆写即 served 行
        // `packages.repoLifecycleOps` 翻转 available（此前按默认 declared-none
        // 如实维持不可用）。`VccCliBackend` 不覆写——CLI 无生命周期面如实假，
        // 缺席臂零改动。
        RepoLifecycleCapabilities {
            enable_repo: true,
            disable_repo: true,
            refresh_repo: true,
        }
    }

    fn template_capabilities(&self) -> TemplateCapabilities {
        // 027 F5 冻结批（实现核对切片）：恰在实现 `list_templates` 时覆写
        // 默认 declared-none（025/026/027 catalog/register/repo-write/
        // repo-catalog 同律，ORC-DEV-004 无实现不预留）。枚举＝两已钉目录
        // 根的本地目录扫描（vrc-get-vpm 0.0.16 无模板枚举 API，环境考证
        // 027 §4），能力如实随实现翻转——覆写即 served 行
        // `packages.templatesOps` 翻转 available（此前按默认 declared-none
        // 如实维持不可用）。`VccCliBackend` 不覆写——CLI 后端如实假，缺席
        // 臂零改动。
        TemplateCapabilities {
            list_templates: true,
        }
    }

    fn list_templates(&self) -> Result<Vec<TemplateEntryV01>, AppErrorV1> {
        list_template_dirs(&self.environment_root)
    }

    fn add_remote_repo(&self, url: &str, name: &str) -> Result<(), AppErrorV1> {
        VrcGetLibBackend::add_remote_repo(self, url, name)
    }

    fn add_local_repo(&self, path: &Path, name: &str) -> Result<(), AppErrorV1> {
        VrcGetLibBackend::add_local_repo(self, path, name)
    }

    fn remove_repo(&self, repo_id: &str) -> Result<(), AppErrorV1> {
        VrcGetLibBackend::remove_repo(self, repo_id)
    }

    fn enable_repo(&self, repo_id: &str) -> Result<(), AppErrorV1> {
        VrcGetLibBackend::enable_repo(self, repo_id)
    }

    fn disable_repo(&self, repo_id: &str) -> Result<(), AppErrorV1> {
        VrcGetLibBackend::disable_repo(self, repo_id)
    }

    fn refresh_repo(&self, repo_id: &str) -> Result<RepoRefreshOutcomeV01, AppErrorV1> {
        VrcGetLibBackend::refresh_repo(self, repo_id)
    }

    fn list_packages(&self, project: &ProjectRef) -> Result<Vec<InstalledPackageV1>, AppErrorV1> {
        let project_root = project.root.clone();
        self.runtime.block_on(async move {
            let project_io = vrc_get_vpm::io::DefaultProjectIo::new(
                project_root.into_boxed_path(),
            );
            let unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(map_project_load("loading project"))?;
            let mut packages: Vec<InstalledPackageV1> = unity_project
                .all_installed_packages()
                .map(|manifest| {
                    let mut dependencies: Vec<String> = manifest
                        .vpm_dependencies()
                        .keys()
                        .map(|key| key.to_string())
                        .collect();
                    dependencies.sort();
                    InstalledPackageV1 {
                        package_id: manifest.name().to_string(),
                        version: manifest.version().to_string(),
                        dependencies,
                    }
                })
                .collect();
            packages.sort_by(|left, right| left.package_id.cmp(&right.package_id));
            Ok(packages)
        })
    }

    fn query_v02(&self) -> bool {
        // 027 F3 冻结批（实现核对切片）：恰在实现 `list_packages_v02` 时覆写
        // 默认 false（catalog_v02 同律，ORC-DEV-004：无实现不预留）——覆写
        // 即 wire 路由对本后端以 `vua.packages-installed/v0.2` 族应答（族常
        // 量盖戳属路由事实，P1 纪律）。`VccCliBackend` 不覆写——CLI 后端
        // 维持冻结 v0.1 族应答，协商缺席臂零改动。
        true
    }

    fn list_packages_v02(
        &self,
        project: &ProjectRef,
    ) -> Result<InstalledListingV02, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let offline = self.offline;
        let project_root = project.root.clone();
        let http = self.http.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.clone().into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_environment_io("loading VPM settings"))?;
            // F4 补切片：装载层一次过滤（禁用行离开包集合世界——latest 判
            // 定的数据源根即本集合，禁用行的包不入判定链）。失败＝状态文件
            // 不可读，复用码如实拒绝（绝不以全启用猜测）。
            let (world, _disabled) =
                collection_world(&environment_root, &settings).map_err(backend_unavailable_state)?;
            // 三臂降级与 F2 repo_catalog / package_catalog_impl 同构
            // （ORC-ADP-006）：offline → load_cache（cacheSourced=true）；
            // 在线 load 失败降级 load_cache（true）；在线成功 load（含 etag
            // 条件刷新共享缓存文件——与 VCC/vrc-get 自身刷新行为同源）→
            // false。cacheSourced 是信息性披露，非失败态。
            let (collection, cache_sourced) = if offline {
                (
                    vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                        .await
                        .map_err(map_environment_io("loading package cache"))?,
                    true,
                )
            } else {
                match vrc_get_vpm::environment::PackageCollection::load(
                    &world,
                    &io,
                    Some(&http),
                )
                .await
                {
                    Ok(collection) => (collection, false),
                    Err(_) => (
                        vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                            .await
                            .map_err(map_environment_io("loading package cache"))?,
                        true,
                    ),
                }
            };
            // 已装集事实源根（v0.1 冻结事实源零变动）：项目
            // Packages/vpm-manifest.json＋lock；同一次工程加载携带 Unity 版
            // 本（m_EditorVersion 解析失败＝load Err→project_load_failed，
            // 判定绑定有据）。latest 判定数据源根＝同一环境根的仓库缓存集
            // 合面（上列一次集合加载；prerelease 开关读同一 settings.json，
            // 冻结词面零 wire 开关）。
            let show_prerelease = settings.show_prerelease_packages();
            let project_io =
                vrc_get_vpm::io::DefaultProjectIo::new(project_root.into_boxed_path());
            let unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(map_project_load("loading project"))?;
            let unity = unity_project.unity_version();
            // 选择器逐字复用 packages-catalog 族冻结语义：latest_for(工程
            // Unity 版本, 用户 prerelease 设置)，零第二判定语义。Copy 选择
            // 器循环外构造一次，整表判定骑上列**一次**集合加载（批量可行
            // 纪律——逐行独立加载集合不构成本面合法实现形态；逐行
            // find_package_by_name 是该已装载集合上的内存判定）。
            let selector = vrc_get_vpm::VersionSelector::latest_for(Some(unity), show_prerelease);
            use vrc_get_vpm::PackageCollection as _;
            let mut packages: Vec<InstalledPackageV02> = unity_project
                .all_installed_packages()
                .map(|manifest| {
                    let package_id = manifest.name().to_string();
                    let installed_version = manifest.version().clone();
                    let mut dependencies: Vec<String> = manifest
                        .vpm_dependencies()
                        .keys()
                        .map(|key| key.to_string())
                        .collect();
                    dependencies.sort();
                    // 判定＝库 find_package_by_name 语义逐字（0.0.16
                    // package_collection.rs：remote 各仓 get_latest(选择器)
                    // 后 chain(local).max_by_key(version)）＝跨集合全仓库合
                    // 并取最高合资格版本（跨仓 max，刻意非 F2 分仓视图；本
                    // 地集合候选入链——项目内已装、环境无仓库缓存位且自身
                    // 不满足选择器时恰为 None）。latestVersion 与
                    // updateAvailable 成对携带：无合资格最新版＝双双 null
                    // （判定未执行，绝不以默认 false 填充——024 表态②防线
                    // ，缺席不是「无更新」）；有＝「存在严格更新的、符合当
                    // 前过滤条件的版本」精确结论（已装 prerelease＋开关关时
                    // false＝稳定集内无严格更新，非泛化「无更新」）。
                    let latest = collection.find_package_by_name(&package_id, selector);
                    let latest_version = latest.as_ref().map(|info| info.version().to_string());
                    let update_available = latest
                        .as_ref()
                        .map(|info| info.version() > &installed_version);
                    InstalledPackageV02 {
                        package_id,
                        version: installed_version.to_string(),
                        dependencies,
                        latest_version,
                        update_available,
                    }
                })
                .collect();
            // 行序＝v0.1 冻结投影同款 packageId 升序。
            packages.sort_by(|left, right| left.package_id.cmp(&right.package_id));
            Ok(InstalledListingV02 {
                packages,
                cache_sourced,
            })
        })
    }

    fn preview_remove(
        &self,
        project: &ProjectRef,
        package_ids: &[String],
    ) -> Result<ChangePreviewV1, AppErrorV1> {
        let project_root = project.root.clone();
        let package_ids = package_ids.to_vec();
        self.runtime.block_on(async move {
            let project_io = vrc_get_vpm::io::DefaultProjectIo::new(
                project_root.into_boxed_path(),
            );
            let unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(map_project_load("loading project"))?;
            let names: Vec<&str> = package_ids.iter().map(String::as_str).collect();
            let changes = unity_project
                .remove_request(&names)
                .await
                .map_err(map_remove_request("calculating removal preview"))?;
            let (items, conflicts, legacy_files, legacy_folders) = summarize_changes(&changes);
            let destructive =
                !conflicts.is_empty() || !legacy_files.is_empty() || !legacy_folders.is_empty();
            let digest = VrcGetLibBackend::digest_of(
                &items,
                &conflicts,
                &legacy_files,
                &legacy_folders,
            );
            Ok(ChangePreviewV1 {
                items,
                conflicts,
                remove_legacy_files: legacy_files,
                remove_legacy_folders: legacy_folders,
                destructive,
                digest,
            })
        })
    }

    fn apply_remove(
        &self,
        project: &ProjectRef,
        package_ids: &[String],
        confirmed_digest: &str,
    ) -> Result<serde_json::Value, AppErrorV1> {
        // 同安装的双摘要纪律：预览重算 + 应用重算，任一漂移即拒绝。
        let preview = self.preview_remove(project, package_ids)?;
        if preview.digest != confirmed_digest {
            return Err(AppErrorV1::new(
                error_codes::PREVIEW_DRIFT,
                ErrorCategory::Conflict,
                "errors.vpm.previewDrift",
                "corr-vpm-remove",
            )
            .with_recoverable(true));
        }
        let environment_root = self.environment_root.clone();
        let project_root = project.root.clone();
        let package_ids = package_ids.to_vec();
        let http = self.http.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.clone().into_boxed_path(),
            );
            let project_io = vrc_get_vpm::io::DefaultProjectIo::new(
                project_root.clone().into_boxed_path(),
            );
            let mut unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(map_project_load("loading project"))?;
            let names: Vec<&str> = package_ids.iter().map(String::as_str).collect();
            let changes = unity_project
                .remove_request(&names)
                .await
                .map_err(map_remove_request("re-checking removal"))?;
            let (items, conflicts, legacy_files, legacy_folders) = summarize_changes(&changes);
            let digest = VrcGetLibBackend::digest_of(
                &items,
                &conflicts,
                &legacy_files,
                &legacy_folders,
            );
            if digest != confirmed_digest {
                return Err(AppErrorV1::new(
                    error_codes::PREVIEW_DRIFT,
                    ErrorCategory::Conflict,
                    "errors.vpm.previewDrift",
                    "corr-vpm-remove",
                )
                .with_recoverable(true));
            }
            let installer = vrc_get_vpm::environment::PackageInstaller::new(&io, Some(&http));
            unity_project
                .apply_pending_changes(&installer, changes)
                .await
                .map_err(|error| {
                    AppErrorV1::new(
                        error_codes::APPLY_FAILED,
                        ErrorCategory::ExternalFailure,
                        "errors.vpm.applyFailed",
                        "corr-vpm-remove",
                    )
                    .with_param("reason", ParamValue::Text(error.to_string()))
                })?;
            Ok(json!({
                "removed": items,
            }))
        })
    }

    fn project_registry(&self) -> Result<Vec<RegisteredProjectV1>, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            let connection = vrc_get_vpm::environment::VccDatabaseConnection::connect(&io)
                .await
                .map_err(map_project_load("opening the manager project registry"))?;
            Ok(connection
                .get_projects()
                .into_iter()
                .filter_map(|project| {
                    let path = project.path()?.to_owned();
                    let name = project.name().unwrap_or_default().to_owned();
                    Some(RegisteredProjectV1 { path, name })
                })
                .collect())
        })
    }

    fn list_repos(&self) -> Result<Vec<RepoInfoV01>, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_environment_io("loading VPM settings"))?;
            // 订阅面为世界（025 冻结批裁决 1）：settings userRepos 数组逐行
            // 逐字投影，行序＝配置顺序（不发明排序键）；逐行携带 cached 缓存
            // 命中事实。本面只读缓存、零网络（缓存命中判定），无在线刷新分支。
            Ok(settings.get_user_repos().iter().map(repo_info_row).collect())
        })
    }

    fn repos_v02(&self) -> bool {
        // 027 F4 冻结批（实现核对切片）：恰在实现 `list_repos_v02` 时覆写默认
        // false（catalog_v02/query_v02 加法双版本协商同律，ORC-DEV-004：无实
        // 现不预留）——覆写即 wire 路由对本后端以 `vua.packages-repos/v0.2` 族
        // 应答（族常量盖戳属路由事实，P1 纪律）。`VccCliBackend` 不覆写——
        // CLI 后端维持冻结 v0.1 族应答，协商缺席臂零改动。
        true
    }

    fn list_repos_v02(&self) -> Result<Vec<RepoInfoV02>, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        self.runtime.block_on(async move {
            let state_path = repo_state_path(&environment_root);
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_environment_io("loading VPM settings"))?;
            // 状态位事实源＝VUA 自有状态文件（v0.2 根事实节：本面只读——
            // 绝不写状态文件、绝不写 settings.json、绝不写共享缓存）。文件缺
            // 席＝全启用（诚实空态）；文件不可读/版本不符＝拒绝整表（enabled
            // 是每行必带事实，无状态即无法如实投影——绝不猜测），错误面照
            // list_repos 既有 io-leg 纪律（backend_unavailable 复用码，共享
            // 构造器 backend_unavailable_state——与集合装载腿同事实同码）。
            let disabled = load_disabled_set(&state_path).map_err(backend_unavailable_state)?;
            // 行闭集＝v0.1 五键逐字投影（repo_info_row 同源事实）＋恰一个新
            // REQUIRED 事实 enabled：id 缺席行恒 true（id 即行柄，启停面可达
            // 范围之外——A4 removeRepo 同边界）；其余行 enabled＝不在禁用集。
            // 行序＝订阅面自身顺序（配置事实 verbatim），不发明排序键。
            Ok(settings
                .get_user_repos()
                .iter()
                .map(|repo| {
                    let repo_id = repo.id().map(str::to_owned);
                    let enabled = match &repo_id {
                        Some(id) => !disabled.contains(id),
                        None => true,
                    };
                    RepoInfoV02 {
                        repo_id,
                        name: repo.name().map(str::to_owned),
                        url: repo.url().map(|url| url.to_string()),
                        local_path: Some(repo.local_path().to_string_lossy().into_owned()),
                        cached: repo_cached_fact(repo.local_path()),
                        enabled,
                    }
                })
                .collect())
        })
    }

    fn package_catalog(
        &self,
        project: &ProjectRef,
        package_id: &str,
    ) -> Result<PackageCatalogV01, AppErrorV1> {
        Ok(self.package_catalog_impl(project, package_id)?.0)
    }

    fn catalog_v02(&self) -> bool {
        true
    }

    fn package_catalog_v02(
        &self,
        project: &ProjectRef,
        package_id: &str,
    ) -> Result<PackageCatalogV02, AppErrorV1> {
        let (catalog, cache_sourced) = self.package_catalog_impl(project, package_id)?;
        Ok(PackageCatalogV02 {
            project_path: catalog.project_path,
            package_id: catalog.package_id,
            display_name: catalog.display_name,
            source: catalog.source,
            installed: catalog.installed,
            update_available: catalog.update_available,
            versions: catalog.versions,
            cache_sourced,
        })
    }

    fn repo_catalog(
        &self,
        repo_id: Option<&str>,
        package_ids: &[String],
    ) -> Result<RepoCatalogV01, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let offline = self.offline;
        let repo_scope = repo_id.map(str::to_owned);
        let package_filter: Vec<String> = package_ids.to_vec();
        let http = self.http.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.clone().into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_environment_io("loading VPM settings"))?;
            // F4 补切片：装载层一次过滤（禁用行离开包集合世界——repo-catalog
            // 列表只见启用行的包）。disabled 集返回给第 2 层投影：禁用行必须
            // 按「未装载」呈行（订阅面继续列出行，零隐藏）——行投影事实，
            // 非二次过滤。
            let (world, disabled) =
                collection_world(&environment_root, &settings).map_err(backend_unavailable_state)?;
            // 与 package_catalog_impl 同构的降级路径（ORC-ADP-006）：offline →
            // load_cache（cacheSourced=true）；在线 load 失败降级 load_cache
            // （true）；在线成功 load（含 etag 条件刷新共享缓存文件——027 协议
            // 本「生产接线面」事实：与 VCC/vrc-get 自身刷新行为相同）→ false。
            // cacheSourced 是信息性披露，非失败态。
            let (collection, cache_sourced) = if offline {
                (
                    vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                        .await
                        .map_err(map_environment_io("loading package cache"))?,
                    true,
                )
            } else {
                match vrc_get_vpm::environment::PackageCollection::load(
                    &world,
                    &io,
                    Some(&http),
                )
                .await
                {
                    Ok(collection) => (collection, false),
                    Err(_) => (
                        vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                            .await
                            .map_err(map_environment_io("loading package cache"))?,
                        true,
                    ),
                }
            };
            // 判定输入一次读定：prerelease 开关读同一 settings.json（027 冻结
            // 词面：零 wire 开关）。
            let show_prerelease = settings.show_prerelease_packages();
            let filter: HashSet<&str> = package_filter.iter().map(String::as_str).collect();

            // 第 1 层＝集合已装载仓库行：`get_remote()` 自身枚举顺序逐字投影
            // （冻结词面：不发明排序键）。已装载＝缓存命中（cached=true），包
            // 事实唯一解析源＝库集合（单事实源纪律，repo_catalog_packages）。
            // 身份取缓存文档自身的 id/name（集合世界的事实源）。
            let loaded: Vec<&vrc_get_vpm::repository::LocalCachedRepository> =
                collection.get_remote().collect();
            let loaded_urls: HashSet<String> = loaded
                .iter()
                .filter_map(|repo| repo.url())
                .map(|url| url.as_str().to_owned())
                .collect();
            let mut repos: Vec<RepoCatalogRepoV01> = loaded
                .iter()
                .map(|repo| RepoCatalogRepoV01 {
                    repo_id: repo.id().map(str::to_owned),
                    name: repo.name().map(str::to_owned),
                    cached: true,
                    packages: repo_catalog_packages(repo, show_prerelease, &filter),
                })
                .collect();

            // 第 2 层＝世界中未被集合装载的仓库行（已订阅未刷新＝其自身诚实
            // 状态：cached=false、空 packages 数组，不隐藏——冻结词面）。行序
            // ＝库装载链自身顺序（预定义两仓先、用户仓库按订阅序——
            // load_cache 的 predefined.chain(user) 源序），非发明排序。已装载
            // 行不重复出现。装载判定：url 行＝订阅 url 命中已装载集合（库装
            // 载时把缓存文档 url 覆写为订阅 url，精确匹配）；无 url 行（本地
            // 目录仓）＝库自身反序列化器接受该缓存文件（与库 load_repo_from_cache
            // 无 url 臂同构的布尔判定——只判定、绝不二次投影其内容，包事实
            // 仍唯一出自第 1 层库集合）。
            if !settings.ignore_official_repository()
                && !loaded_urls.contains(OFFICIAL_REPO_URL)
            {
                repos.push(RepoCatalogRepoV01 {
                    // 预定义仓无订阅行身份：未装载时无任何身份事实，如实双双
                    // null（诚实缺席）。
                    repo_id: None,
                    name: None,
                    cached: false,
                    packages: Vec::new(),
                });
            }
            if !settings.ignore_curated_repository() && !loaded_urls.contains(CURATED_REPO_URL) {
                repos.push(RepoCatalogRepoV01 {
                    repo_id: None,
                    name: None,
                    cached: false,
                    packages: Vec::new(),
                });
            }
            for repo in settings.get_user_repos() {
                // F4 补切片：禁用行已被装载层过滤（不在集合世界），无论其缓
                // 存文件是否在场都必须走第 2 层——「已装载」判定若仍按缓存
                // 命中把禁用行判回集合世界，该行会从本应答中整行消失＝对配
                // 置视图隐藏（违冻结词面「订阅面继续列出行」）。
                let disabled_row = repo.id().is_some_and(|id| disabled.contains(id));
                let loaded = !disabled_row
                    && match repo.url() {
                        Some(url) => loaded_urls.contains(url.as_str()),
                        None => std::fs::read(repo.local_path())
                            .ok()
                            .and_then(|bytes| {
                                serde_json::from_slice::<vrc_get_vpm::repository::LocalCachedRepository>(
                                    &bytes,
                                )
                                .ok()
                            })
                            .is_some(),
                    };
                if loaded {
                    continue;
                }
                repos.push(RepoCatalogRepoV01 {
                    // 未装载行唯一存在的身份事实＝订阅行自身的 id/name
                    // （025 订阅面同源），Option 如实投影。
                    repo_id: repo.id().map(str::to_owned),
                    name: repo.name().map(str::to_owned),
                    // cached＝逐仓库缓存命中事实（packages-repos-catalog v0.1
                    // 字段语义「025 repos 面法则承袭」，与订阅面同一事实源
                    // repo_cached_fact）：启用行的第 2 层＝缓存缺席/不可解析
                    // ＝false（与旧硬编码逐案相等——可解析缓存必被装载）；
                    // 禁用行缓存可能在场（离开集合世界≠缓存消失）＝如实
                    // true——绝不把「被启停过滤」谎报成「未刷新」。
                    cached: repo_cached_fact(repo.local_path()),
                    packages: Vec::new(),
                });
            }

            // repoId 透镜：null＝全部仓库行；非空 id＝只答投影 repo_id 恰等
            // 的行（本面自己投影过的 id——已装载行取缓存文档 id、未装载行取
            // 订阅行 id，都是该 id 的诚实事实源）。词表外 id＝**复用**
            // vua.vpm.repo_not_found（A4 removeRepo 同事实、零新码），绝不虚
            // 构空形状成功。id 缺席（null）的行在 scope 臂不可达（与 A4
            // removeRepo 的无 id 行不可寻址同款纪律）。
            if let Some(scope) = repo_scope.as_deref() {
                repos.retain(|repo| repo.repo_id.as_deref() == Some(scope));
                if repos.is_empty() {
                    return Err(AppErrorV1::new(
                        error_codes::REPO_NOT_FOUND,
                        ErrorCategory::Validation,
                        "errors.vpm.repoNotFound",
                        "corr-vpm-catalog",
                    )
                    .with_param("repoId", ParamValue::Text(scope.to_owned())));
                }
            }
            Ok(RepoCatalogV01 {
                repos,
                cache_sourced,
            })
        })
    }

    fn preview_install(
        &self,
        project: &ProjectRef,
        packages: &[PackageRequestV1],
    ) -> Result<ChangePreviewV1, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let offline = self.offline;
        let cached_metadata = self.cached_metadata;
        let project_root = project.root.clone();
        let packages = packages.to_vec();
        let http = self.http.clone();

        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.clone().into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_io("loading VPM settings"))?;
            // F4 补切片：装载层一次过滤（禁用行离开包集合世界——A2 解析器
            // 不再从禁用行解析包）。状态文件不可读＝复用码如实拒绝（与投影
            // 面同事实同码，绝不以全启用猜测）。
            let (world, _disabled) =
                collection_world(&environment_root, &settings).map_err(backend_unavailable_state)?;
            // 在线刷新仓库清单失败时降级到缓存（ORC-ADP-006）。
            let collection = if offline || cached_metadata {
                vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                    .await
                    .map_err(map_io("loading package cache"))?
            } else {
                match vrc_get_vpm::environment::PackageCollection::load(&world, &io, Some(&http))
                    .await
                {
                    Ok(collection) => collection,
                    Err(_) => {
                        vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                            .await
                            .map_err(map_io("loading package cache"))?
                    }
                }
            };
            let project_io =
                vrc_get_vpm::io::DefaultProjectIo::new(project_root.clone().into_boxed_path());
            let unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(map_io("loading project"))?;

            use vrc_get_vpm::PackageCollection as _;
            let parsed_versions: Vec<Option<vrc_get_vpm::version::Version>> = packages
                .iter()
                .map(|request| {
                    request
                        .version
                        .as_ref()
                        .map(|version| version.parse())
                        .transpose()
                        .map_err(|_| {
                            AppErrorV1::new(
                                error_codes::NO_MATCHING_PACKAGE,
                                ErrorCategory::Validation,
                                "errors.vpm.versionInvalid",
                                "corr-vpm-preview",
                            )
                            .with_param(
                                "version",
                                ParamValue::Text(request.version.clone().unwrap_or_default()),
                            )
                        })
                })
                .collect::<Result<_, _>>()?;
            let mut selected = Vec::with_capacity(packages.len());
            for (request, parsed_version) in packages.iter().zip(parsed_versions.iter()) {
                let selector = match parsed_version.as_ref() {
                    Some(parsed) => vrc_get_vpm::VersionSelector::specific_version(parsed),
                    None => vrc_get_vpm::VersionSelector::latest_for(None, false),
                };
                let package = collection
                    .find_package_by_name(&request.package_id, selector)
                    .ok_or_else(|| {
                        AppErrorV1::new(
                            error_codes::NO_MATCHING_PACKAGE,
                            ErrorCategory::Dependency,
                            "errors.vpm.noMatchingPackage",
                            "corr-vpm-preview",
                        )
                        .with_param("package", ParamValue::Text(request.package_id.clone()))
                    })?;
                selected.push(package);
            }

            let changes = unity_project
                .add_package_request(
                    &collection,
                    &selected,
                    vrc_get_vpm::unity_project::AddPackageOperation::InstallToDependencies,
                    false,
                )
                .await
                .map_err(|error| {
                    AppErrorV1::new(
                        error_codes::PREVIEW_FAILED,
                        ErrorCategory::ExternalFailure,
                        "errors.vpm.previewFailed",
                        "corr-vpm-preview",
                    )
                    .with_param("reason", ParamValue::Text(error.to_string()))
                })?;

            let mut items: Vec<ChangeItemV1> = Vec::new();
            for (name, change) in changes.package_changes() {
                match change {
                    vrc_get_vpm::unity_project::pending_project_changes::PackageChange::Install(
                        install,
                    ) => {
                        let version = install
                            .install_package()
                            .map(|package| package.version().to_string());
                        items.push(ChangeItemV1 {
                            kind: ChangeKindV1::Install,
                            package_id: name.to_string(),
                            version,
                            reason: None,
                        });
                    }
                    vrc_get_vpm::unity_project::pending_project_changes::PackageChange::Remove(
                        remove,
                    ) => {
                        items.push(ChangeItemV1 {
                            kind: ChangeKindV1::Remove,
                            package_id: name.to_string(),
                            version: None,
                            reason: Some(format!("{:?}", remove.reason())),
                        });
                    }
                }
            }
            items.sort_by(|left, right| left.package_id.cmp(&right.package_id));
            let mut conflicts: Vec<String> = changes
                .conflicts()
                .keys()
                .map(|key| key.to_string())
                .collect();
            conflicts.sort();
            let mut remove_legacy_files: Vec<String> = changes
                .remove_legacy_files()
                .iter()
                .map(|(path, _)| path.to_string_lossy().into_owned())
                .collect();
            remove_legacy_files.sort();
            let mut remove_legacy_folders: Vec<String> = changes
                .remove_legacy_folders()
                .iter()
                .map(|(path, _)| path.to_string_lossy().into_owned())
                .collect();
            remove_legacy_folders.sort();
            let destructive = !conflicts.is_empty()
                || !remove_legacy_files.is_empty()
                || !remove_legacy_folders.is_empty();

            let digest = VrcGetLibBackend::digest_of(
                &items,
                &conflicts,
                &remove_legacy_files,
                &remove_legacy_folders,
            );
            Ok(ChangePreviewV1 {
                items,
                conflicts,
                remove_legacy_files,
                remove_legacy_folders,
                destructive,
                digest,
            })
        })
    }

    fn preview_install_for_plan(
        &self,
        project: &ProjectRef,
        packages: &[PackageRequestV1],
        template: Option<&str>,
    ) -> Result<ChangePreviewV1, AppErrorV1> {
        if project
            .root
            .join("ProjectSettings/ProjectVersion.txt")
            .is_file()
        {
            return self.preview_install(project, packages);
        }

        // A fresh-project plan must include the dependencies already present
        // in the selected VCC/ALCOM template. Preview in an isolated copy of
        // that exact template; never calculate against an empty directory.
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or(0);
        let parent =
            std::env::temp_dir().join(format!("vua-vpm-preview-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&parent).map_err(|error| {
            AppErrorV1::new(
                error_codes::PREVIEW_FAILED,
                ErrorCategory::ExternalFailure,
                "errors.vpm.previewFailed",
                "corr-vpm-preview",
            )
            .with_param("reason", ParamValue::Text(error.to_string()))
        })?;
        let staged = match create_from_template(
            &self.environment_root,
            &parent,
            "preview-project",
            template,
        ) {
            Ok(project) => project,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&parent);
                return Err(error);
            }
        };
        let result = self.preview_install(&staged, packages);
        let cleanup = std::fs::remove_dir_all(&parent);
        match (result, cleanup) {
            (Ok(preview), Ok(())) => Ok(preview),
            (Err(error), _) => Err(error),
            (Ok(_), Err(error)) => Err(AppErrorV1::new(
                error_codes::PREVIEW_FAILED,
                ErrorCategory::ExternalFailure,
                "errors.vpm.previewFailed",
                "corr-vpm-preview",
            )
            .with_param("reason", ParamValue::Text(error.to_string()))),
        }
    }

    fn apply_install(
        &self,
        project: &ProjectRef,
        packages: &[PackageRequestV1],
        confirmed_digest: &str,
    ) -> Result<serde_json::Value, AppErrorV1> {
        // 重算预览并比对摘要（ORC-WF-003/004）：预览之后项目或仓库变了，
        // 拒绝应用而不是盲目执行旧确认。
        let preview = self.preview_install(project, packages)?;
        if preview.digest != confirmed_digest {
            return Err(AppErrorV1::new(
                error_codes::PREVIEW_DRIFT,
                ErrorCategory::Conflict,
                "errors.vpm.previewDrift",
                "corr-vpm-apply",
            )
            .with_recoverable(true));
        }
        let environment_root = self.environment_root.clone();
        let project_root = project.root.clone();
        let packages = packages.to_vec();
        let http = self.http.clone();

        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.clone().into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_io("loading VPM settings"))?;
            // F4 补切片：装载层一次过滤（禁用行离开包集合世界——apply 解析
            // 与 preview 同一装载入口，双摘要重算见不得未过滤世界）。
            let (world, _disabled) =
                collection_world(&environment_root, &settings).map_err(backend_unavailable_state)?;
            let collection = if self.offline || self.cached_metadata {
                vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                    .await
                    .map_err(map_io("loading package cache"))?
            } else {
                vrc_get_vpm::environment::PackageCollection::load(&world, &io, Some(&http))
                    .await
                    .map_err(map_io("loading package collection"))?
            };
            let project_io =
                vrc_get_vpm::io::DefaultProjectIo::new(project_root.clone().into_boxed_path());
            // apply 会更新锁定状态（apply_pending_changes 需要可变借用）
            let mut unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(map_io("loading project"))?;

            use vrc_get_vpm::PackageCollection as _;
            let parsed_versions: Vec<Option<vrc_get_vpm::version::Version>> = packages
                .iter()
                .map(|request| {
                    request
                        .version
                        .as_ref()
                        .map(|version| version.parse())
                        .transpose()
                        .map_err(|_| {
                            AppErrorV1::new(
                                error_codes::NO_MATCHING_PACKAGE,
                                ErrorCategory::Validation,
                                "errors.vpm.versionInvalid",
                                "corr-vpm-apply",
                            )
                            .with_param(
                                "version",
                                ParamValue::Text(request.version.clone().unwrap_or_default()),
                            )
                        })
                })
                .collect::<Result<_, _>>()?;
            let mut selected = Vec::with_capacity(packages.len());
            for (request, parsed_version) in packages.iter().zip(parsed_versions.iter()) {
                let selector = match parsed_version.as_ref() {
                    Some(parsed) => vrc_get_vpm::VersionSelector::specific_version(parsed),
                    None => vrc_get_vpm::VersionSelector::latest_for(None, false),
                };
                let package = collection
                    .find_package_by_name(&request.package_id, selector)
                    .ok_or_else(|| {
                        AppErrorV1::new(
                            error_codes::NO_MATCHING_PACKAGE,
                            ErrorCategory::Dependency,
                            "errors.vpm.noMatchingPackage",
                            "corr-vpm-apply",
                        )
                        .with_param("package", ParamValue::Text(request.package_id.clone()))
                    })?;
                selected.push(package);
            }
            let changes = unity_project
                .add_package_request(
                    &collection,
                    &selected,
                    vrc_get_vpm::unity_project::AddPackageOperation::InstallToDependencies,
                    false,
                )
                .await
                .map_err(|error| {
                    AppErrorV1::new(
                        error_codes::APPLY_FAILED,
                        ErrorCategory::ExternalFailure,
                        "errors.vpm.applyFailed",
                        "corr-vpm-apply",
                    )
                    .with_param("reason", ParamValue::Text(error.to_string()))
                })?;
            // 第二道摘要核对（Fix R2-7：legacy folders 也计入摘要）：以
            // 重算的 changes 为准，第一道是调用方传入的确认摘要，双保险
            // 防任何窗口期的竞态变更。
            let (items, conflicts, legacy_files, legacy_folders) = summarize_changes(&changes);
            let digest =
                VrcGetLibBackend::digest_of(&items, &conflicts, &legacy_files, &legacy_folders);
            if digest != confirmed_digest {
                return Err(AppErrorV1::new(
                    error_codes::PREVIEW_DRIFT,
                    ErrorCategory::Conflict,
                    "errors.vpm.previewDrift",
                    "corr-vpm-apply",
                )
                .with_recoverable(true));
            }

            let installer = vrc_get_vpm::environment::PackageInstaller::new(&io, Some(&http));
            unity_project
                .apply_pending_changes(&installer, changes)
                .await
                .map_err(|error| {
                    AppErrorV1::new(
                        error_codes::APPLY_FAILED,
                        ErrorCategory::ExternalFailure,
                        "errors.vpm.applyFailed",
                        "corr-vpm-apply",
                    )
                    .with_param("reason", ParamValue::Text(error.to_string()))
                })?;

            Ok(json!({
                "applied": items,
            }))
        })
    }

    fn create_project(
        &self,
        parent: &Path,
        name: &str,
        template: Option<&str>,
    ) -> Result<ProjectRef, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let template = template.map(str::to_owned);
        create_from_template(&environment_root, parent, name, template.as_deref())
    }

    fn resolve_project(&self, project_root: &Path) -> Result<ResolveReceiptV01, AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let offline = self.offline;
        let project_root = project_root.to_path_buf();
        let http = self.http.clone();

        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.clone().into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(|error| {
                    // 环境设置不可读＝解析世界不可知：如实拒绝（复用码），
                    // 绝不以空世界猜测。
                    AppErrorV1::new(
                        error_codes::BACKEND_UNAVAILABLE,
                        ErrorCategory::Unavailable,
                        "errors.vpm.backendUnavailable",
                        "corr-vpm-resolve",
                    )
                    .with_param("reason", ParamValue::Text(error.to_string()))
                })?;
            // 第 146 批：禁用集语义与 F4 collection_world 同律——禁用订阅行
            // 离开包集合世界，解析绝不从禁用行取包。状态文件不可读＝复用
            // 共享构造器如实拒绝（与 preview/apply 同一装载入口纪律）。
            let (world, _disabled) =
                collection_world(&environment_root, &settings).map_err(backend_unavailable_state)?;
            let project_io =
                vrc_get_vpm::io::DefaultProjectIo::new(project_root.into_boxed_path());
            let mut unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(|error| {
                    AppErrorV1::new(
                        error_codes::PROJECT_LOAD_FAILED,
                        ErrorCategory::ExternalFailure,
                        "errors.vpm.projectLoadFailed",
                        "corr-vpm-resolve",
                    )
                    .with_param("reason", ParamValue::Text(error.to_string()))
                })?;

            // 幂等臂（环境实现批对齐钉）：locked 与 dependencies 全部已在盘
            // 上满足→如实列报，且**必须在集合装载之前短路**——端口面文档
            // 「answers them via already_satisfied and touches nothing」的
            // 「零触碰」律：在线 load 臂会刷新仓库缓存（网络＋缓存写），快
            // 路径绝不装载集合（零网络零写入，环回连接计数＋工程树逐字节
            // 双钉）。第二次 resolve 对未变化工程回答 already_satisfied。
            if !unity_project.should_resolve() {
                let already_satisfied = unity_project
                    .dependencies()
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                return Ok(ResolveReceiptV01 {
                    resolved: Vec::new(),
                    already_satisfied,
                    failed: Vec::new(),
                });
            }

            // 在线刷新仓库清单失败时降级到缓存（ORC-ADP-006 同律）。
            let collection = if offline {
                vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                    .await
                    .map_err(|error| {
                        AppErrorV1::new(
                            error_codes::BACKEND_UNAVAILABLE,
                            ErrorCategory::Unavailable,
                            "errors.vpm.backendUnavailable",
                            "corr-vpm-resolve",
                        )
                        .with_param("reason", ParamValue::Text(error.to_string()))
                    })?
            } else {
                match vrc_get_vpm::environment::PackageCollection::load(&world, &io, Some(&http))
                    .await
                {
                    Ok(collection) => collection,
                    Err(_) => {
                        vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                            .await
                            .map_err(|error| {
                                AppErrorV1::new(
                                    error_codes::BACKEND_UNAVAILABLE,
                                    ErrorCategory::Unavailable,
                                    "errors.vpm.backendUnavailable",
                                    "corr-vpm-resolve",
                                )
                                .with_param("reason", ParamValue::Text(error.to_string()))
                            })?
                    }
                }
            };
            // 缺失依赖臂：依赖无法从启用仓库解析（DependenciesNotFound 是
            // 库错误唯一变体）→ 逐依赖进 failed（reason_code 复用
            // no_matching_package，零新码），receipt 如实呈不完整面；调用方
            // （素材链供给臂）把非空 failed 聚合为供给失败携原码上浮。
            let changes = match unity_project.resolve_request(&collection).await {
                Ok(changes) => changes,
                Err(error) => {
                    return match error {
                        vrc_get_vpm::unity_project::ResolvePackageErr::DependenciesNotFound {
                            dependencies,
                        } => {
                            // failed 收集后按 id 排序（与下方 resolved 同律同
                            // 位）：库内载体 MissingDependencies 是 HashMap
                            // （每进程随机盐），未排序时同一工程＋同一环境两
                            // 次运行的 failed 序逐字漂移——失败证据不可复现；
                            // 排序后素材链 receipt.failed.first() 点名随之确
                            // 定。收据词面零变化，仅序确定（批 195，操作者裁
                            // 决采纳兑现；测试钉钉可复现性而非具体序）。
                            let mut failed = dependencies
                                .into_iter()
                                .map(|(id, _range)| ResolveFailureV01 {
                                    id: id.to_string(),
                                    reason_code: error_codes::NO_MATCHING_PACKAGE.to_owned(),
                                })
                                .collect::<Vec<_>>();
                            failed.sort_by(|left, right| left.id.cmp(&right.id));
                            Ok(ResolveReceiptV01 {
                                resolved: Vec::new(),
                                already_satisfied: Vec::new(),
                                failed,
                            })
                        }
                        // 库错误当前唯一变体如上；non_exhaustive 面前不猜测，
                        // 其余形态按环境不可用如实拒绝。
                        #[allow(unreachable_patterns)]
                        _ => Err(AppErrorV1::new(
                            error_codes::BACKEND_UNAVAILABLE,
                            ErrorCategory::Unavailable,
                            "errors.vpm.backendUnavailable",
                            "corr-vpm-resolve",
                        )
                        .with_param("reason", ParamValue::Text(error.to_string()))),
                    };
                }
            };

            // 安装事实先于 apply 提取（apply 消耗 changes）：包体落
            // Packages/、locked 段由 apply_pending_changes 内部写回
            // vpm-manifest.json（库内含 save）。
            let mut resolved = Vec::new();
            for (name, change) in changes.package_changes() {
                if let Some(install) = change.as_install() {
                    if let Some(package) = install.install_package() {
                        let source_repo = package
                            .repo()
                            .and_then(|repo| {
                                repo.id()
                                    .or(repo.name())
                                    .map(|value| value.to_owned())
                            })
                            .unwrap_or_else(|| "local".to_owned());
                        resolved.push(ResolvedPackageV01 {
                            id: name.to_string(),
                            version: package.version().to_string(),
                            source_repo,
                        });
                    }
                }
            }
            resolved.sort_by(|left, right| left.id.cmp(&right.id));

            // 安装腿（环境实现批对齐钉两处，端口面文档自有词句为准）：
            // ① offline＝下载臂无 http——离线后端绝不为包体下载出网，库自
            // 身 "Offline mode" 错误如实上浮（绝不静默半成功）；
            // ② 失败承载体按网络段二分——端口面文档「repo_fetch_failed for
            // the network segment」：offline 臂的下载失败确定性落在网络段
            // （repo_fetch_failed）；在线臂的安装/清单写回腿照落地映射
            // （apply_failed——文档「install/manifest-write leg」）。
            let http_install = if offline { None } else { Some(&http) };
            let installer = vrc_get_vpm::environment::PackageInstaller::new(&io, http_install);
            unity_project
                .apply_pending_changes(&installer, changes)
                .await
                .map_err(|error| {
                    if offline {
                        repo_fetch_failed(format!(
                            "resolving the declared dependencies (offline): {error}"
                        ))
                    } else {
                        AppErrorV1::new(
                            error_codes::APPLY_FAILED,
                            ErrorCategory::ExternalFailure,
                            "errors.vpm.applyFailed",
                            "corr-vpm-resolve",
                        )
                        .with_param("reason", ParamValue::Text(error.to_string()))
                    }
                })?;
            Ok(ResolveReceiptV01 {
                resolved,
                already_satisfied: Vec::new(),
                failed: Vec::new(),
            })
        })
    }
}

// --- backend 2: official VCC CLI (`vpm`) ---

/// The official VCC CLI backend (`.NET` global tool `vrchat.vpm.cli`).
/// Strengths: template-based project creation and the project registry.
/// It has no change preview, so it must not be used for plan-confirmed
/// destructive installs (ADR-0006).
pub struct VccCliBackend {
    runner: Arc<dyn ProcessRunner>,
    clock: Arc<dyn Clock>,
    executable: String,
}

impl VccCliBackend {
    pub fn new(
        runner: Arc<dyn ProcessRunner>,
        clock: Arc<dyn Clock>,
        executable: impl Into<String>,
    ) -> Self {
        Self {
            runner,
            clock,
            executable: executable.into(),
        }
    }

    fn spec(&self, args: Vec<String>) -> ProcessSpec {
        ProcessSpec {
            executable: PathBuf::from(&self.executable),
            args,
            working_dir: None,
            timeout: std::time::Duration::from_secs(1200),
            output_limit: 256 * 1024,
            // R2-2: 凭据剥离基线；代理变量保留（vpm 下载可能需要）。
            removals: vua_orchestrator::CREDENTIAL_ENV_REMOVALS
                .iter()
                .map(|key| key.to_string())
                .collect(),
            ..Default::default()
        }
    }
}

impl VrcGetLibBackend {
    /// Shared body of the package-catalog read face, returning the frozen
    /// v0.1 facts plus the cacheSourced disclosure fact (025 inline ruling
    /// 6 / packages-catalog v0.2 freeze batch): true = THIS result was
    /// served through the cache-degradation path (offline → load_cache, or
    /// an online load failed and degraded — ORC-ADP-006 isomorphic); false
    /// = served from an online-refreshed load. Cache sourcing is not an
    /// error. The v0.1 word face projects the facts without the disclosure
    /// (frozen v0.1 stays field-less); the v0.2 face carries it.
    fn package_catalog_impl(
        &self,
        project: &ProjectRef,
        package_id: &str,
    ) -> Result<(PackageCatalogV01, bool), AppErrorV1> {
        let environment_root = self.environment_root.clone();
        let offline = self.offline;
        let project_root = project.root.clone();
        let package_id = package_id.to_owned();
        let http = self.http.clone();
        self.runtime.block_on(async move {
            let io = vrc_get_vpm::io::DefaultEnvironmentIo::new(
                environment_root.clone().into_boxed_path(),
            );
            let settings = vrc_get_vpm::environment::Settings::load(&io)
                .await
                .map_err(map_environment_io("loading VPM settings"))?;
            // F4 补切片：装载层一次过滤（禁用行离开包集合世界——单包目录的
            // 版本枚举与 updateAvailable 判定只见启用行的包）。状态文件不可
            // 读＝复用码如实拒绝（绝不以全启用猜测）。
            let (world, _disabled) =
                collection_world(&environment_root, &settings).map_err(backend_unavailable_state)?;
            // 在线刷新仓库清单失败时降级到缓存（ORC-ADP-006；preview_install
            // 同构先例）。降级事实如实上贡 v0.2 cacheSourced（信息性标注、非
            // 失败态）；v0.1 冻结词面无此字段、不发明。
            let (collection, cache_sourced) = if offline {
                (
                    vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                        .await
                        .map_err(map_environment_io("loading package cache"))?,
                    true,
                )
            } else {
                match vrc_get_vpm::environment::PackageCollection::load(
                    &world,
                    &io,
                    Some(&http),
                )
                .await
                {
                    Ok(collection) => (collection, false),
                    Err(_) => (
                        vrc_get_vpm::environment::PackageCollection::load_cache(&world, &io)
                            .await
                            .map_err(map_environment_io("loading package cache"))?,
                        true,
                    ),
                }
            };
            let project_path = project_root.to_string_lossy().into_owned();
            let project_io =
                vrc_get_vpm::io::DefaultProjectIo::new(project_root.into_boxed_path());
            let unity_project = vrc_get_vpm::UnityProject::load(project_io)
                .await
                .map_err(map_project_load("loading project"))?;
            // 工程加载成功即携带 Unity 版本（m_EditorVersion 解析失败＝load
            // Err→project_load_failed），compatible/updateAvailable 判定有据。
            let unity = unity_project.unity_version();
            let installed_manifest = unity_project.get_installed_package(&package_id);
            let installed = installed_manifest.is_some();
            let installed_version = installed_manifest.map(|manifest| manifest.version().clone());

            use vrc_get_vpm::PackageCollection as _;
            let mut repo_versions: Vec<vrc_get_vpm::PackageInfo> = Vec::new();
            let mut local_info: Option<vrc_get_vpm::PackageInfo> = None;
            for info in collection.find_packages(&package_id) {
                if info.repo().is_some() {
                    repo_versions.push(info);
                } else {
                    local_info = Some(info);
                }
            }
            if repo_versions.is_empty() && local_info.is_none() {
                // 词表外包（025 冻结批裁决 2）：仓库缓存与本地集合均无此包，
                // 复用码、独立空态（消费端呈现为空态非错误页）。
                return Err(AppErrorV1::new(
                    error_codes::NO_MATCHING_PACKAGE,
                    ErrorCategory::Dependency,
                    "errors.vpm.noMatchingPackage",
                    "corr-vpm-catalog",
                )
                .with_param("package", ParamValue::Text(package_id)));
            }
            repo_versions.sort_by(|left, right| left.version().cmp(right.version()));
            let versions: Vec<CatalogVersionV01> = repo_versions
                .iter()
                .map(|info| CatalogVersionV01 {
                    version: info.version().to_string(),
                    yanked: info.package_json().is_yanked(),
                    compatible: Some(catalog_compatible(info.package_json(), unity)),
                })
                .collect();
            // updateAvailable 判定（025 冻结批裁决 3 冻结口径）：已装版本 vs
            // latest_for(工程 Unity 版本, 用户 prerelease 设置) 的比较结论
            // 「存在严格更新的兼容版本」，本域内完成、wire 只出结论；未安装
            // ＝判定未执行（None→null，缺席不是「无更新」）。prerelease 读
            // 用户 show_prerelease_packages 设置，零 wire 开关。
            let update_available = if installed {
                let selector = vrc_get_vpm::VersionSelector::latest_for(
                    Some(unity),
                    settings.show_prerelease_packages(),
                );
                let has_newer = collection
                    .find_package_by_name(&package_id, selector)
                    .and_then(|latest| {
                        installed_version
                            .as_ref()
                            .map(|installed| latest.version() > installed)
                    })
                    .unwrap_or(false);
                Some(has_newer)
            } else {
                None
            };
            // displayName：repo 来源取缓存最高版本的 manifest；local 来源取
            // 本地包 manifest；None 如实投影（消费端以 packageId 兼任显示名，
            // P1 裁决 3 延续）。
            let display_name = repo_versions
                .last()
                .map(|info| info.package_json())
                .or(local_info.map(|info| info.package_json()))
                .and_then(|manifest| manifest.display_name().map(str::to_owned));
            Ok((
                PackageCatalogV01 {
                    project_path,
                    package_id,
                    display_name,
                    source: if repo_versions.is_empty() {
                        PackageSourceV01::Local
                    } else {
                        PackageSourceV01::Repo
                    },
                    installed,
                    update_available,
                    versions,
                },
                cache_sourced,
            ))
        })
    }
}

impl VpmBackend for VccCliBackend {
    fn name(&self) -> &'static str {
        "vcc-cli"
    }

    fn capabilities(&self) -> VpmCapabilities {
        VpmCapabilities {
            create_project: true,
            preview_install: false,
            list_packages: false,
            remove_packages: false,
            project_registry: false,
            // 第 146 批：CLI 无 resolve 命令（`vpm` CLI 无工程依赖解析面），
            // 如实维持 declared-none 缺位——trait 默认缺席臂回答
            // capability_missing，能力位不撒谎。
            resolve_project: false,
        }
    }

    fn preview_install(
        &self,
        _project: &ProjectRef,
        _packages: &[PackageRequestV1],
    ) -> Result<ChangePreviewV1, AppErrorV1> {
        Err(unsupported("preview_install"))
    }

    fn apply_install(
        &self,
        project: &ProjectRef,
        packages: &[PackageRequestV1],
        _confirmed_digest: &str,
    ) -> Result<serde_json::Value, AppErrorV1> {
        // 无预览能力的后端不承担计划确认过的安装（ADR-0006）。
        let _ = (project, packages);
        Err(unsupported("preview_install"))
    }

    fn create_project(
        &self,
        parent: &Path,
        name: &str,
        template: Option<&str>,
    ) -> Result<ProjectRef, AppErrorV1> {
        validate_vpm_project_name(name)?;
        // vpm new <projectName> [template] -p <path>（官方文档 vpm/cli.md）
        let mut args = vec!["new".to_owned(), name.to_owned()];
        if let Some(template) = template {
            args.push(template.to_owned());
        }
        args.push("-p".to_owned());
        args.push(parent.to_string_lossy().into_owned());
        let outcome = self.runner.run(&self.spec(args)).map_err(|error| {
            AppErrorV1::new(
                error_codes::BACKEND_UNAVAILABLE,
                ErrorCategory::Unavailable,
                "errors.vpm.backendUnavailable",
                "corr-vcc-cli",
            )
            .with_param("reason", ParamValue::Text(error.to_string()))
        })?;
        if outcome.timed_out || !outcome.success() {
            return Err(AppErrorV1::new(
                error_codes::APPLY_FAILED,
                ErrorCategory::ExternalFailure,
                "errors.vpm.applyFailed",
                "corr-vcc-cli",
            )
            .with_param(
                "exitCode",
                ParamValue::Number(outcome.exit_code.unwrap_or(-1) as f64),
            ));
        }
        let target = parent.join(name);
        let project = ProjectRef {
            id: format!("vcc-{}", name),
            root: target,
        };
        FileSystemProjectStore::initialize(&project).map_err(|error| {
            AppErrorV1::new(
                error_codes::APPLY_FAILED,
                ErrorCategory::ExternalFailure,
                "errors.vpm.applyFailed",
                "corr-vcc-cli",
            )
            .with_param("reason", ParamValue::Text(error.to_string()))
        })?;
        let _ = self.clock.now_rfc3339();
        Ok(project)
    }
}

// --- shared: template-based project creation (ADR-0006 §4) ---

/// Creates a project by copying a template directory (the documented VCC
/// behavior: create dir -> copy template -> set productName -> validate).
/// Template resolution order: explicit path -> VCC installed templates
/// (`VRCTemplates`) -> user templates (`Templates`).
pub fn create_from_template(
    environment_root: &Path,
    parent: &Path,
    name: &str,
    template: Option<&str>,
) -> Result<ProjectRef, AppErrorV1> {
    validate_vpm_project_name(name)?;
    let target = parent.join(name);
    if target.exists() {
        return Err(AppErrorV1::new(
            error_codes::TEMPLATE_MISSING,
            ErrorCategory::Validation,
            "errors.vpm.projectExists",
            "corr-vpm-create",
        )
        .with_param("name", ParamValue::Text(name.to_owned())));
    }

    let template_name = template.unwrap_or("Avatar");
    let candidates = [
        environment_root.join("VRCTemplates").join(template_name),
        environment_root.join("Templates").join(template_name),
        PathBuf::from(template_name),
    ];
    let template_dir = candidates
        .iter()
        .find(|candidate| candidate.is_dir())
        .ok_or_else(|| {
            AppErrorV1::new(
                error_codes::TEMPLATE_MISSING,
                ErrorCategory::Dependency,
                "errors.vpm.templateMissing",
                "corr-vpm-create",
            )
            .with_param("template", ParamValue::Text(template_name.to_owned()))
        })?;

    copy_tree(template_dir, &target).map_err(|error| {
        AppErrorV1::new(
            error_codes::TEMPLATE_MISSING,
            ErrorCategory::ExternalFailure,
            "errors.vpm.templateCopyFailed",
            "corr-vpm-create",
        )
        .with_param("reason", ParamValue::Text(error.to_string()))
    })?;

    // productName 更新（ProjectSettings.asset 是带缩进的 YAML 文本）。
    // JSON 字符串也是合法 YAML 标量，借此保留 Unicode 并避免 `#` 等
    // 字符把项目名解释成注释或结构语法。
    let settings_path = target.join("ProjectSettings").join("ProjectSettings.asset");
    set_product_name(&settings_path, name)?;

    if !target.join("ProjectSettings/ProjectVersion.txt").is_file() {
        return Err(AppErrorV1::new(
            error_codes::TEMPLATE_MISSING,
            ErrorCategory::ExternalFailure,
            "errors.vpm.templateCopyFailed",
            "corr-vpm-create",
        )
        .with_param(
            "reason",
            ParamValue::Text("template is not a Unity project".to_owned()),
        ));
    }

    let project = ProjectRef {
        id: format!("proj-{name}"),
        root: target,
    };
    FileSystemProjectStore::initialize(&project).map_err(|error| {
        AppErrorV1::new(
            error_codes::TEMPLATE_MISSING,
            ErrorCategory::ExternalFailure,
            "errors.vpm.templateCopyFailed",
            "corr-vpm-create",
        )
        .with_param("reason", ParamValue::Text(error.to_string()))
    })?;
    Ok(project)
}

/// F5 (proposal 027 freeze batch, packages-templates v0.1): enumerates the
/// available templates as a LOCAL DIRECTORY SCAN over the same pair of
/// pinned roots the `create_from_template` library leg reads —
/// `<environment_root>/VRCTemplates` first in full, then
/// `<environment_root>/Templates` filling only the missing set (a name
/// under both roots enumerates ONCE, resolved to VRCTemplates — the
/// projection of the creation resolution order: enumeration never diverges
/// from what create would copy). vrc-get-vpm 0.0.16 ships no template
/// enumeration API (environment verification 027 §4), so the scan IS the
/// implementation. Directory entries only — plain files under a template
/// root (metadata files, forms unknown pending W25) are not templates.
/// Rows are id-ascending (the frozen presentation fact — raw scan order is
/// not stable across platforms, the F3 packageId precedent) and `name` is
/// the frozen same-value display projection of `id`. An empty vec is the
/// honest zero-templates answer: a missing or unreadable root is a FACT,
/// never an error (the R4 precedent; zero new error codes on this face).
/// Read-only over the environment root: the two template roots are never
/// written, moved, renamed, or deleted (protocol root-facts section).
pub fn list_template_dirs(environment_root: &Path) -> Result<Vec<TemplateEntryV01>, AppErrorV1> {
    let mut ids: Vec<String> = Vec::new();
    for root_name in ["VRCTemplates", "Templates"] {
        let entries = match fs::read_dir(environment_root.join(root_name)) {
            Ok(entries) => entries,
            // Root missing or unreachable = contributes nothing (honest
            // empty state, never an error — the frozen root-facts section).
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    ids.sort();
    Ok(ids
        .into_iter()
        .map(|id| {
            let name = id.clone();
            TemplateEntryV01 { id, name }
        })
        .collect())
}

fn validate_vpm_project_name(name: &str) -> Result<(), AppErrorV1> {
    if name.trim().is_empty()
        || name != name.trim()
        || name == "."
        || name == ".."
        || name.starts_with('-')
        || name.chars().any(|character| {
            matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        })
    {
        return Err(AppErrorV1::new(
            error_codes::TEMPLATE_MISSING,
            ErrorCategory::Validation,
            "errors.vpm.projectNameInvalid",
            "corr-vpm-create",
        )
        .with_param("name", ParamValue::Text(name.to_owned())));
    }
    Ok(())
}

/// Rewrites `productName` in an existing ProjectSettings.asset (YAML text
/// with indentation). Shared by template-based creation and the import-copy
/// write path (proposal 014): the copy takes the new project name as its
/// Unity-facing identity. Best-effort by design — a missing or unreadable
/// file, or a file without the field, is a silent no-op (identical to the
/// original template-creation behavior); callers own the validation that
/// the project is real.
pub fn set_product_name(settings_path: &Path, name: &str) -> Result<(), AppErrorV1> {
    let content = match std::fs::read_to_string(settings_path) {
        Ok(content) => content,
        Err(_) => return Ok(()),
    };
    let mut updated = String::with_capacity(content.len());
    let mut replaced = false;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("productName:") {
            let indentation = &line[..line.len() - trimmed.len()];
            let escaped_name = serde_json::to_string(name).map_err(|error| {
                AppErrorV1::new(
                    error_codes::TEMPLATE_MISSING,
                    ErrorCategory::Internal,
                    "errors.vpm.templateCopyFailed",
                    "corr-vpm-create",
                )
                .with_param("reason", ParamValue::Text(error.to_string()))
            })?;
            updated.push_str(indentation);
            updated.push_str("productName: ");
            updated.push_str(&escaped_name);
            replaced = true;
        } else {
            updated.push_str(line);
        }
        updated.push('\n');
    }
    if replaced {
        std::fs::write(settings_path, updated).map_err(|error| {
            AppErrorV1::new(
                error_codes::TEMPLATE_MISSING,
                ErrorCategory::ExternalFailure,
                "errors.vpm.templateCopyFailed",
                "corr-vpm-create",
            )
            .with_param("reason", ParamValue::Text(error.to_string()))
        })?;
    }
    Ok(())
}

fn copy_tree(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let destination = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else if entry.file_type()?.is_file() {
            std::fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

/// 把库的 PendingProjectChanges 折算成 (items, conflicts, legacyFiles,
/// legacyFolders) 四元组，全部排序保证摘要稳定。
fn summarize_changes(
    changes: &vrc_get_vpm::unity_project::PendingProjectChanges<'_>,
) -> (Vec<ChangeItemV1>, Vec<String>, Vec<String>, Vec<String>) {
    let mut items: Vec<ChangeItemV1> = Vec::new();
    for (name, change) in changes.package_changes() {
        match change {
            vrc_get_vpm::unity_project::pending_project_changes::PackageChange::Install(
                install,
            ) => {
                items.push(ChangeItemV1 {
                    kind: ChangeKindV1::Install,
                    package_id: name.to_string(),
                    version: install
                        .install_package()
                        .map(|package| package.version().to_string()),
                    reason: None,
                });
            }
            vrc_get_vpm::unity_project::pending_project_changes::PackageChange::Remove(remove) => {
                items.push(ChangeItemV1 {
                    kind: ChangeKindV1::Remove,
                    package_id: name.to_string(),
                    version: None,
                    reason: Some(format!("{:?}", remove.reason())),
                });
            }
        }
    }
    items.sort_by(|left, right| left.package_id.cmp(&right.package_id));
    let mut conflicts: Vec<String> = changes
        .conflicts()
        .keys()
        .map(|key| key.to_string())
        .collect();
    conflicts.sort();
    let mut legacy_files: Vec<String> = changes
        .remove_legacy_files()
        .iter()
        .map(|(path, _)| path.to_string_lossy().into_owned())
        .collect();
    legacy_files.sort();
    let mut legacy_folders: Vec<String> = changes
        .remove_legacy_folders()
        .iter()
        .map(|(path, _)| path.to_string_lossy().into_owned())
        .collect();
    legacy_folders.sort();
    (items, conflicts, legacy_files, legacy_folders)
}

fn map_project_load(context: &'static str) -> impl Fn(std::io::Error) -> AppErrorV1 {
    move |error: std::io::Error| {
        AppErrorV1::new(
            error_codes::PROJECT_LOAD_FAILED,
            ErrorCategory::ExternalFailure,
            "errors.vpm.projectLoadFailed",
            "corr-vpm-lib",
        )
        .with_param("reason", ParamValue::Text(format!("{context}: {error}")))
    }
}

fn map_remove_request(
    context: &'static str,
) -> impl Fn(vrc_get_vpm::unity_project::RemovePackageErr) -> AppErrorV1 {
    move |error: vrc_get_vpm::unity_project::RemovePackageErr| {
        let (code, category) = match &error {
            vrc_get_vpm::unity_project::RemovePackageErr::NotInstalled(_) => {
                (error_codes::PACKAGE_NOT_INSTALLED, ErrorCategory::Validation)
            }
            _ => (error_codes::PREVIEW_FAILED, ErrorCategory::ExternalFailure),
        };
        let mut app = AppErrorV1::new(
            code,
            category,
            "errors.vpm.removeFailed",
            "corr-vpm-remove",
        )
        .with_param("reason", ParamValue::Text(format!("{context}: {error}")));
        if let vrc_get_vpm::unity_project::RemovePackageErr::NotInstalled(names) = &error {
            app = app.with_param(
                "packages",
                ParamValue::Text(
                    names
                        .iter()
                        .map(|name| name.to_string())
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
            );
        }
        app
    }
}

fn map_io(context: &'static str) -> impl Fn(std::io::Error) -> AppErrorV1 {
    move |error: std::io::Error| {
        AppErrorV1::new(
            error_codes::PREVIEW_FAILED,
            ErrorCategory::ExternalFailure,
            "errors.vpm.previewFailed",
            "corr-vpm-lib",
        )
        .with_param("reason", ParamValue::Text(format!("{context}: {error}")))
    }
}

/// Registry of the two backends for capability aggregation.
pub fn backends_summary(backends: &[&dyn VpmBackend]) -> BTreeMap<String, VpmCapabilities> {
    backends
        .iter()
        .map(|backend| (backend.name().to_owned(), backend.capabilities()))
        .collect()
}

#[cfg(test)]
mod sdk_bootstrap_tests {
    use super::*;
    use std::io::{Read, Write};

    fn serve(body: Vec<u8>) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/sdk.json", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut request = [0u8; 4096];
            let mut received = 0;
            while received < request.len() {
                let read = stream.read(&mut request[received..]).unwrap();
                if read == 0 { break; }
                received += read;
                if request[..received].windows(4).any(|part| part == b"\r\n\r\n") { break; }
            }
            assert!(received > 0);
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            let _ = stream.write_all(&body); // Bounded consumer may close early.
        });
        (url, thread)
    }

    #[test]
    fn sdk_request_can_start_on_a_synchronous_worker_with_timeouts() {
        let backend = VrcGetLibBackend::new(false).unwrap();
        let (url, server) = serve(b"{\"repository\":\"test\"}".to_vec());
        assert_eq!(backend.download_repository_metadata(&url).unwrap(), b"{\"repository\":\"test\"}");
        server.join().unwrap();
    }

    #[test]
    fn sdk_metadata_is_bounded_while_streaming() {
        let backend = VrcGetLibBackend::new(false).unwrap();
        let (url, server) = serve(vec![b'x'; 2 * 1024 * 1024 + 1]);
        let error = backend.download_repository_metadata(&url).unwrap_err();
        assert!(format!("{:?}", error.params).contains("metadata budget"));
        server.join().unwrap();
    }
}

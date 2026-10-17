//! Thin native adapter for the AMF-owned material-first use case.
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use vua_bdl_store::{ArtifactMode, BdlStore};
use vua_orchestrator::{
    amf_production::*, AppErrorV1, FileSystemProjectStore, FileSystemSnapshotStore,
    PackageRequestV1, ProjectRef, ResultStatus, SnapshotRef, TaskContext, UnityCommand,
    UnityOperation, UnityPayload, VpmBackend,
};
use vua_unity_bridge::UnityBatchBridge;

mod release_handoff;

pub struct NativeAmfProduction {
    pub bdl: Arc<BdlStore>,
    pub root: PathBuf,
    pub editor_roots: Vec<PathBuf>,
    pub explicit_editor: Option<PathBuf>,
    /// The environment's current `unity_hub` finding, read before each Unity run.
    pub unity_hub: Option<Arc<dyn Fn() -> vua_orchestrator::EnvironmentCheckItemV1 + Send + Sync>>,
}

fn err(code: &str, error: impl std::fmt::Display) -> AppErrorV1 {
    production_error(code, error.to_string())
}
fn project(run: &ProductionRun) -> ProjectRef {
    ProjectRef {
        id: run.run_id.clone(),
        root: PathBuf::from(&run.project_root),
    }
}

// Only the private AMF package environment is updated, never VCC/ALCOM subscriptions.
const MA_REPO: &str = "https://vpm.nadena.dev/vpm.json";
/// How often a running Unity step reads its log and checks for a stop.
const UNITY_POLL: Duration = Duration::from_millis(500);
const LILTOON_REPO: &str = "https://lilxyzw.github.io/vpm-repos/vpm.json";
const LILTOON_PACKAGE: &str = "jp.lilxyzw.liltoon";

/// lilToon's unitypackage installs into Assets/lilToon; material packages often ship a copy there.
fn is_bundled_liltoon(folded_path: &str) -> bool {
    folded_path == "assets/liltoon" || folded_path.starts_with("assets/liltoon/")
}

/// Subscribes the private environment to a feed and makes sure its manifest is cached.
fn ensure_repo(
    backend: &vua_project_manager::VrcGetLibBackend,
    url: &str,
    name: &str,
) -> Result<(), AppErrorV1> {
    if !backend.list_repos()?.iter().any(|r| r.url.as_deref() == Some(url)) {
        backend.add_remote_repo(url, name)?;
    }
    // Registering a feed does not populate its package cache. Resolve only
    // after the private environment has a readable first manifest; warmed
    // developer caches must not hide a first-launch preparation failure.
    let repo = backend
        .list_repos()?
        .into_iter()
        .find(|repo| repo.url.as_deref() == Some(url))
        .ok_or_else(|| err("dependencies_unavailable", format!("The {name} repository is not registered.")))?;
    if !repo.cached {
        let id = repo.repo_id.as_deref().ok_or_else(|| {
            err("dependencies_unavailable", format!("The {name} repository has no verified identity."))
        })?;
        backend.refresh_repo(id)?;
    }
    Ok(())
}

impl NativeAmfProduction {
    fn start_unity_hub(&self) {
        let launch = self.unity_hub.as_ref().and_then(|finding| crate::unity_hub::hub_launch(&finding().facts));
        crate::unity_hub::ensure_licensing_client(launch, || false);
    }
    fn package_backend(&self) -> Result<vua_project_manager::VrcGetLibBackend, AppErrorV1> {
        vua_project_manager::VrcGetLibBackend::with_environment_root(
            self.root.join("vpm-environment"),
            false,
        )?
        .with_cached_metadata()
    }
    /// Installs the newest lilToon from its official feed that resolves for this project.
    fn install_liltoon(&self, run: &ProductionRun) -> Result<(), AppErrorV1> {
        let backend = self.package_backend()?;
        ensure_repo(&backend, LILTOON_REPO, "lilToon")?;
        let p = project(run);
        let request = [PackageRequestV1 { package_id: LILTOON_PACKAGE.into(), version: None }];
        let preview = backend.preview_install(&p, &request)?;
        if preview.destructive || !preview.conflicts.is_empty() {
            return Err(err(
                "dependencies_conflict",
                format!("lilToon installation needs explicit conflict handling: {:?}", preview.conflicts),
            ));
        }
        backend.apply_install(&p, &request, &preview.digest)?;
        Ok(())
    }
    fn package_path(&self, source: &ProductionSource) -> Result<PathBuf, AppErrorV1> {
        let Some(member) = &source.archive_member else {
            return Ok(source.path.clone());
        };
        let archive_hash = vua_unity_bridge::material_exec::sha256_file(&source.path)
            .map_err(|e| err("source_unreadable", format!("Read selected ZIP: {e}")))?;
        let root = self.root.join("package-cache");
        fs::create_dir_all(&root).map_err(|e| {
            err(
                "source_unreadable",
                format!("Create private package cache: {e}"),
            )
        })?;
        // The shared checksum format is `sha256:<hex>`. Hash it into a safe
        // cache key; a colon would create a Windows alternate data stream.
        let target = root.join(format!(
            "{}-{}.unitypackage",
            hash_text(&source.source_id),
            &hash_text(&archive_hash)[..24]
        ));
        let pending = target.with_extension("pending");
        let result = (|| {
            let mut archive = zip::ZipArchive::new(
                fs::File::open(&source.path).map_err(|e| err("source_unreadable", e))?,
            )
            .map_err(|e| err("source_invalid", e))?;
            let entry = archive
                .by_name(member)
                .map_err(|e| err("source_invalid", e))?;
            const LIMIT: u64 = 8 * 1024 * 1024 * 1024;
            if entry.size() > LIMIT {
                return Err(err("source_too_large", "One embedded UnityPackage exceeds the 8 GiB intake limit. Extract it and import it separately."));
            }
            let mut bounded = std::io::Read::take(entry, LIMIT + 1);
            let mut output = fs::File::create(&pending).map_err(|e| {
                err(
                    "source_unreadable",
                    format!("Create extracted package: {e}"),
                )
            })?;
            let bytes =
                std::io::copy(&mut bounded, &mut output).map_err(|e| err("source_invalid", e))?;
            if bytes > LIMIT {
                return Err(err(
                    "source_too_large",
                    "Embedded package exceeds the intake limit.",
                ));
            }
            output
                .sync_all()
                .map_err(|e| err("source_unreadable", format!("Flush extracted package: {e}")))?;
            drop(output);
            fs::rename(&pending, &target).map_err(|e| {
                err(
                    "source_unreadable",
                    format!("Publish extracted package: {e}"),
                )
            })?;
            Ok(target)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&pending);
        }
        result
    }
    fn verify_assembly_sources(&self, run: &ProductionRun) -> Result<(), AppErrorV1> {
        let available = self
            .sources()?
            .into_iter()
            .map(|s| (s.source_id.clone(), s))
            .collect::<HashMap<_, _>>();
        for source in &run.sources {
            let actual = available.get(&source.source_id).ok_or_else(|| {
                err(
                    "source_missing",
                    "Selected local input is no longer present.",
                )
            })?;
            if vua_unity_bridge::material_exec::sha256_file(&self.package_path(actual)?)
                .map_err(|e| err("source_unreadable", e))?
                != source.sha256
            {
                return Err(err(
                    "source_drift",
                    format!(
                        "{} changed after preparation. Prepare the inputs again.",
                        source.item_name
                    ),
                ));
            }
        }
        Ok(())
    }
    fn bridge(
        &self,
        run: &ProductionRun,
        operation: UnityOperation,
        selection: Option<&AssemblySelection>,
        watch: &UnityWatch,
    ) -> Result<ObservedProject, AppErrorV1> {
        self.bridge_with_target(run, operation, selection, None, watch)
    }
    fn bridge_with_target(
        &self,
        run: &ProductionRun,
        operation: UnityOperation,
        selection: Option<&AssemblySelection>,
        apply_target: Option<&vua_orchestrator::amf_recipe_apply::RecipeApplyTarget>,
        watch: &UnityWatch,
    ) -> Result<ObservedProject, AppErrorV1> {
        self.verify_editor(&run.editor.path)?;
        reject_editor_lock(Path::new(&run.project_root))?;
        clear_stale_lock(Path::new(&run.project_root));
        refresh_bridge_package(Path::new(&run.project_root))?;
        prune_previews(Path::new(&run.project_root), &preview_paths(run));
        self.start_unity_hub();
        let id = format!(
            "{}-{}",
            run.run_id,
            super::provider_host::uuid_v7_identity()
        );
        let mut request = serde_json::json!({"schemaVersion":"0.1","runId":run.run_id,
            "sources":run.sources.iter().map(|s| serde_json::json!({"sourceId":s.source_id,"role":s.role,"assetPaths":s.asset_paths})).collect::<Vec<_>>(),
            "selection":selection});
        if let Some(target) = apply_target {
            request["applyTarget"] = serde_json::to_value(target).map_err(|e| err("request_invalid", e))?;
        }
        let serialized =
            serde_json::to_vec_pretty(&request).map_err(|e| err("request_invalid", e))?;
        // v5 carries a separate request format, not a frozen v2/v3 Recipe plan.
        let plan_ref = format!(".vua/bridge/{id}.amf-plan.json");
        let target = Path::new(&run.project_root).join(&plan_ref);
        fs::create_dir_all(target.parent().expect("AMF Bridge directory"))
            .map_err(|e| err("request_failed", e))?;
        let pending = target.with_extension("pending");
        fs::write(&pending, &serialized).map_err(|e| err("request_failed", e))?;
        fs::rename(pending, target).map_err(|e| err("request_failed", e))?;
        let plan_hash = Sha256::digest(&serialized)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let command = UnityCommand {
            schema_version: 5,
            command_id: id.clone(),
            operation,
            project_id: run.run_id.clone(),
            dry_run: operation == UnityOperation::AmfInspect,
            expected_project_fingerprint: (operation == UnityOperation::AmfAssemble)
                .then(|| run.unity_fingerprint.clone()),
            payload: UnityPayload {
                plan_ref: Some(plan_ref),
                plan_hash: Some(plan_hash),
                ..Default::default()
            },
        };
        // The first preparation imports every work-project asset, so its count has a total.
        let total = (operation == UnityOperation::AmfPrepare && watch.step_key() == "inspect").then(|| imported_asset_count(run));
        let tail = Mutex::new(vua_unity_bridge::UnityLogTail::new(Path::new(&run.project_root), &id, total));
        let next_poll = Mutex::new(Instant::now());
        let poll = || {
            let mut next = next_poll.lock().expect("Unity poll poisoned");
            if Instant::now() < *next {
                return false;
            }
            *next = Instant::now() + UNITY_POLL;
            watch.report(tail.lock().expect("Unity log poisoned").poll());
            watch.stop_requested()
        };
        let outcome = UnityBatchBridge::for_amf_production(&run.editor.path).execute_watched(&project(run), &command, &poll);
        // A stopped or crashed Unity leaves its lock file behind.
        clear_stale_lock(Path::new(&run.project_root));
        let result = outcome.map_err(|e| match e {
            vua_orchestrator::BridgeError::Cancelled => watch.stopped(),
            e => {
                let log = Path::new(&run.project_root).join(".vua/logs").join(format!("{id}.log"));
                bridge_log_failure(&log).unwrap_or_else(|| err("bridge_failed", e))
            }
        })?;
        if result.schema_version != 5 || result.command_id != id {
            return Err(err(
                "receipt_invalid",
                "Bridge returned another command/version.",
            ));
        }
        if result.status != ResultStatus::Succeeded {
            return Err(err(
                "bridge_failed",
                result
                    .diagnostics
                    .iter()
                    .map(|d| d.message.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
            ));
        }
        let actual_operation = fs::read(
            Path::new(&run.project_root)
                .join(".vua/bridge")
                .join(format!("{id}.result.json")),
        )
        .map_err(|e| err("receipt_invalid", e))?;
        let envelope: serde_json::Value =
            serde_json::from_slice(&actual_operation).map_err(|e| err("receipt_invalid", e))?;
        if envelope["operation"]
            != serde_json::to_value(operation).map_err(|e| err("receipt_invalid", e))?
        {
            return Err(err("receipt_invalid", "Bridge returned another operation."));
        }
        let mut facts = result.data;
        let omitted = normalize_previews(&mut facts, Path::new(&run.project_root), &id)?;
        let mut diagnostics = result.diagnostics;
        if !omitted.is_empty() {
            diagnostics.push(vua_orchestrator::Diagnostic { code: "amf.preview.failed".into(), severity: vua_orchestrator::DiagnosticSeverity::Warning,
                message: format!("{} preview images were left out because their files are missing or too large.", omitted.len()) });
        }
        let prefabs = serde_json::from_value(facts["prefabs"].clone())
            .map_err(|e| err("receipt_invalid", e))?;
        let unity_fingerprint = facts["projectFingerprint"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| err("receipt_invalid", "Missing project fingerprint."))?
            .into();
        let editor_version = facts["editorVersion"]
            .as_str()
            .ok_or_else(|| err("receipt_invalid", "Missing actual Editor version."))?
            .into();
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(Path::new(&run.project_root).join("Packages/vpm-manifest.json"))
                .map_err(|e| err("receipt_invalid", e))?,
        )
        .map_err(|e| err("receipt_invalid", e))?;
        let package_versions = manifest["locked"]
            .as_object()
            .ok_or_else(|| err("receipt_invalid", "Installed VPM lock is missing."))?
            .iter()
            .filter_map(|(id, item)| {
                item["version"]
                    .as_str()
                    .map(|version| (id.clone(), version.to_owned()))
            })
            .collect::<BTreeMap<_, _>>();
        normalize_observed_selection(&mut facts)?;
        let data = serde_json::json!({"facts":facts,"packageVersions":package_versions,"diagnostics":diagnostics,"officialSdkChecks":"not_run","visualReview":"pending"});
        Ok(ObservedProject {
            prefabs,
            unity_fingerprint,
            editor_version,
            result: data,
        })
    }
}

/// Accepts the Bridge's preview paths when each names a PNG that this command wrote inside the
/// work project; a path that leaves it invalidates the receipt. A missing or oversized image is
/// left out and named in the returned list. Unity writes an empty string for a candidate without
/// an image.
fn normalize_previews(facts: &mut serde_json::Value, project: &Path, command_id: &str) -> Result<Vec<String>, AppErrorV1> {
    let folder = format!("{PREVIEW_ROOT}/{command_id}/");
    let mut omitted = Vec::new();
    let mut usable = |path: &str| -> Result<bool, AppErrorV1> {
        if !path.starts_with(&folder) {
            return Err(err("receipt_invalid", format!("A preview belongs to another Bridge command: {path}")));
        }
        match preview_file(project, path) {
            Ok(_) => Ok(true),
            Err(error) if error.code == "vua.amf_production.preview_invalid" => Err(err("receipt_invalid", format!("{path}: {}", error.code))),
            Err(_) => { omitted.push(path.to_owned()); Ok(false) }
        }
    };
    let views = match facts.get("previews") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::Array(views)) => views.clone(),
        Some(_) => return Err(err("receipt_invalid", "Previews are not a list.")),
    };
    let mut seen = BTreeSet::new();
    let mut kept = Vec::new();
    for view in views {
        let (Some(name), Some(path)) = (view["view"].as_str(), view["path"].as_str()) else {
            return Err(err("receipt_invalid", "A preview has no view or path."));
        };
        if view.as_object().map_or(0, |v| v.len()) != 2 || !PREVIEW_VIEWS.contains(&name) || !seen.insert(name.to_owned()) {
            return Err(err("receipt_invalid", "Previews name each of front, side and back at most once."));
        }
        if usable(path)? { kept.push(view); }
    }
    facts["previews"] = serde_json::Value::Array(kept);
    if let Some(prefabs) = facts.get_mut("prefabs").and_then(serde_json::Value::as_array_mut) {
        for prefab in prefabs.iter_mut().filter_map(serde_json::Value::as_object_mut) {
            let rendered = match prefab.get("preview") {
                Some(serde_json::Value::String(path)) if !path.is_empty() => usable(path)?,
                None | Some(serde_json::Value::Null) | Some(serde_json::Value::String(_)) => false,
                Some(_) => return Err(err("receipt_invalid", "A candidate preview is not a path.")),
            };
            if !rendered { prefab.remove("preview"); }
        }
    }
    Ok(omitted)
}

/// Removes preview folders of earlier Bridge commands that the run no longer reports.
fn prune_previews(project: &Path, kept: &[String]) {
    let Ok(entries) = fs::read_dir(project.join(PREVIEW_ROOT)) else { return; };
    let kept = kept.iter().filter_map(|path| path.split('/').nth(2)).collect::<BTreeSet<_>>();
    for entry in entries.flatten() {
        let name = entry.file_name();
        // A link or junction is left as it is; only plain folders VUA wrote are removed.
        if entry.file_type().is_ok_and(|kind| kind.is_dir() && !kind.is_symlink()) && !kept.contains(name.to_string_lossy().as_ref()) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn normalize_observed_selection(facts: &mut serde_json::Value) -> Result<(), AppErrorV1> {
    let Some(selection) = facts.get_mut("observedSelection") else { return Ok(()); };
    // Unity's inline-class serializer writes a null Selection as its empty
    // default object. Keep that sentinel out of the typed desktop contract.
    if *selection == serde_json::json!({"avatarPrefab":"", "outfits":[]}) {
        *selection = serde_json::Value::Null;
    } else if !selection.is_null() {
        let observed: AssemblySelection = serde_json::from_value(selection.clone())
            .map_err(|e| err("receipt_invalid", e))?;
        if observed.avatar_prefab.is_empty() || observed.outfits.is_empty() || observed.outfits.len() > 64 {
            return Err(err("receipt_invalid", "Invalid observed scene selection."));
        }
    }
    Ok(())
}

impl AmfProductionPlatform for NativeAmfProduction {
    fn recipe_source_candidates(&self, materials: &[vua_orchestrator::amf_recipe::RecipeMaterial], origins: &BTreeMap<String, Vec<String>>) -> Result<BTreeMap<String, Vec<String>>, AppErrorV1> {
        let mut matches: BTreeMap<String, Vec<String>> = BTreeMap::new();
        // Read retained BDL facts even if a local file is currently absent. Sharing does not
        // require possession or re-download; reproduction separately verifies actual bytes.
        for entry in self.bdl.warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage).map_err(|e| err("library_failed", e))? {
            let copies = self.bdl.entry_copies(&entry.warehouse_item_id).map_err(|e| err("library_failed", e))?;
            let detail = self.bdl.warehouse_entry_detail(&entry.warehouse_item_id, ArtifactMode::UseOriginalUnitypackage).map_err(|e| err("library_failed", e))?;
            let Some(detail) = detail else { continue; };
            let metadata = if entry.kind == "imported_material" { self.bdl.library_entry_metadata(&entry.warehouse_item_id).map_err(|e| err("library_failed", e))?.product_id } else { None };
            for material in materials {
                for copy in copies.iter().filter(|copy| copy.role.name() == "original") {
                    let from_origin = origins.get(&material.id).is_some_and(|ids| ids.iter().any(|id| id == &copy.copy_id || id.strip_prefix(&copy.copy_id).is_some_and(|tail| tail.starts_with('-') && tail.len() == 25)));
                    if !from_origin && copy.artifact_sha256.trim_start_matches("sha256:") != material.sha256 { continue; }
                    let products = matches.entry(material.id.clone()).or_default();
                    for id in detail.artifacts.iter().filter(|artifact| artifact.artifact_sha256 == copy.artifact_sha256)
                        .flat_map(|artifact| &artifact.mapped_product_ids).chain(metadata.iter()) {
                        if let Some(id) = id.strip_prefix("booth:").filter(|id| vua_orchestrator::amf_recipe_share::valid_booth_id(id)) { products.push(id.into()); }
                    }
                }
            }
        }
        Ok(matches)
    }

    fn resolve_recipe_materials(&self, materials: &[vua_orchestrator::amf_recipe::RecipeMaterial]) -> Result<BTreeMap<String, String>, AppErrorV1> {
        let available = self.sources()?;
        let mut known = HashMap::new();
        for item_id in available.iter().map(|source| &source.item_id).collect::<std::collections::BTreeSet<_>>() {
            for copy in self.bdl.entry_copies(item_id).map_err(|e| err("library_failed", e))? {
                known.insert(copy.copy_id, copy.artifact_sha256.trim_start_matches("sha256:").to_owned());
            }
        }
        let mut resolved = BTreeMap::new();
        let mut missing = Vec::new();
        for material in materials {
            for source in &available {
                let known_match = known.get(&source.source_id) == Some(&material.sha256);
                let named_member = source.archive_member.is_some() && source.name.rsplit('/').next() == Some(material.package_name.as_str());
                if !known_match && !named_member { continue; }
                let actual = vua_unity_bridge::material_exec::sha256_file(&self.package_path(source)?)
                    .map_err(|e| err("source_unreadable", e))?;
                if actual.strip_prefix("sha256:").unwrap_or(&actual) == material.sha256 { resolved.insert(material.id.clone(), source.source_id.clone()); break; }
            }
            if !resolved.contains_key(&material.id) { missing.push(material.package_name.clone()); }
        }
        if !missing.is_empty() {
            return Err(err("recipe_material_missing", format!("Supply these exact original packages in the library, then retry: {}", missing.join(", "))));
        }
        Ok(resolved)
    }
    fn sources(&self) -> Result<Vec<ProductionSource>, AppErrorV1> {
        let entries = self
            .bdl
            .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
            .map_err(|e| err("library_failed", e))?;
        let removed = self
            .bdl
            .removed_local_entries()
            .map_err(|e| err("library_failed", e))?;
        let mut result = Vec::new();
        for entry in entries {
            if removed.contains(&entry.warehouse_item_id) {
                continue;
            }
            let copies = self
                .bdl
                .entry_copies(&entry.warehouse_item_id)
                .map_err(|e| err("library_failed", e))?;
            for copy in copies {
                let path = PathBuf::from(&copy.stored_path);
                if copy.role.name() != "original" || !path.is_file() {
                    continue;
                }
                if fs::symlink_metadata(&path)
                    .map_err(|e| err("source_unreadable", e))?
                    .file_type()
                    .is_symlink()
                {
                    continue;
                }
                if path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("unitypackage"))
                {
                    result.push(ProductionSource {
                        source_id: copy.copy_id,
                        item_id: entry.warehouse_item_id.clone(),
                        item_name: entry.display_name.clone(),
                        name: copy.relative_path,
                        path,
                        archive_member: None,
                    });
                } else if path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
                {
                    let Ok(mut archive) = zip::ZipArchive::new(
                        fs::File::open(&path).map_err(|e| err("source_unreadable", e))?,
                    ) else {
                        continue;
                    };
                    if archive.len() > 100_000 {
                        return Err(err(
                            "archive_too_large",
                            "Archive has too many entries to inspect.",
                        ));
                    }
                    for index in 0..archive.len() {
                        let inner = archive
                            .by_index_raw(index)
                            .map_err(|e| err("source_invalid", e))?;
                        let member = inner.name();
                        if inner.is_dir()
                            || !member.to_ascii_lowercase().ends_with(".unitypackage")
                            || !safe_zip_member(member)
                        {
                            continue;
                        }
                        result.push(ProductionSource {
                            source_id: format!("{}-{}", copy.copy_id, &hash_text(member)[..24]),
                            item_id: entry.warehouse_item_id.clone(),
                            item_name: entry.display_name.clone(),
                            name: member.replace('\\', "/"),
                            path: path.clone(),
                            archive_member: Some(member.into()),
                        });
                    }
                }
            }
        }
        let mut result = drop_expanded_duplicates(result);
        result.sort_by(|a, b| {
            (&a.item_name, &a.name, &a.source_id).cmp(&(&b.item_name, &b.name, &b.source_id))
        });
        if result.len() > 4096 {
            return Err(err(
                "library_too_large",
                "Too many local package inputs; narrow the library before selecting.",
            ));
        }
        Ok(result)
    }
    fn editors(&self) -> Result<Vec<ProductionEditor>, AppErrorV1> {
        let mut candidates = Vec::new();
        if let Some(path) = &self.explicit_editor {
            candidates.push(path.clone());
        }
        for root in &self.editor_roots {
            if let vua_orchestrator::EditorInstallObservation::Detected(editors) =
                vua_orchestrator::installed_unity_editors(root)
            {
                for editor in editors {
                    candidates.push(editor.path);
                }
            }
        }
        let mut results = Vec::new();
        for path in candidates {
            if let Ok(editor) = self.verify_editor(&path.to_string_lossy()) {
                if !results
                    .iter()
                    .any(|previous: &ProductionEditor| previous.path == editor.path)
                {
                    results.push(editor);
                }
            }
        }
        results.sort_by(|a, b| {
            (a.version.ends_with("c1"), &a.path).cmp(&(b.version.ends_with("c1"), &b.path))
        });
        Ok(results)
    }
    fn verify_editor(&self, path: &str) -> Result<ProductionEditor, AppErrorV1> {
        match vua_project_manager::verify_editor_path_system(Path::new(path)) {
            vua_project_manager::EditorPathVerdict::Verified(identity) if identity.version == "2022.3.22f1" || identity.version == "2022.3.22f1c1" =>
                Ok(ProductionEditor { path: identity.exe_path, version: identity.version }),
            _ => Err(err("editor_unavailable", "No verified 2022.3.22f1 / 2022.3.22f1c1 Editor. Prepare it in Avatar environment settings.")),
        }
    }
    fn create_project(&self, run: &ProductionRun, ctx: &TaskContext) -> Result<(), AppErrorV1> {
        self.verify_editor(&run.editor.path)?;
        let p = project(run);
        if p.root.exists() {
            return Err(err(
                "project_exists",
                "Preparation will not overwrite an existing project.",
            ));
        }
        fs::create_dir_all(p.root.join("Assets")).map_err(|e| err("project_failed", e))?;
        fs::create_dir_all(p.root.join("Packages")).map_err(|e| err("project_failed", e))?;
        fs::create_dir_all(p.root.join("ProjectSettings")).map_err(|e| err("project_failed", e))?;
        fs::write(
            p.root.join("ProjectSettings/ProjectVersion.txt"),
            format!("m_EditorVersion: {}\n", run.editor.version),
        )
        .map_err(|e| err("project_failed", e))?;
        // Seed the non-IDE baseline from the official Avatar template. SDK dependencies
        // alone omit built-in APIs and the NUnit dependency used by their Editor tests.
        fs::write(
            p.root.join("Packages/manifest.json"),
            include_str!("amf_project_manifest.json"),
        )
        .map_err(|e| err("project_failed", e))?;
        fs::write(
            p.root.join("Packages/vpm-manifest.json"),
            "{\"dependencies\":{},\"locked\":{}}\n",
        )
        .map_err(|e| err("project_failed", e))?;
        FileSystemProjectStore::initialize(&p).map_err(|e| err("project_failed", e))?;
        fs::write(p.root.join(".vua/amf-run.txt"), &run.run_id)
            .map_err(|e| err("project_failed", e))?;
        let backend = self.package_backend()?;
        backend.ensure_official_sdk_cache()?;
        ensure_repo(&backend, MA_REPO, "Modular Avatar")?;
        // A reproduced Recipe pins lilToon up front; its feed is needed only then.
        if run.package_pins.contains_key(LILTOON_PACKAGE) {
            ensure_repo(&backend, LILTOON_REPO, "lilToon")?;
        }
        if let Some(error) = ctx.cancellation_error("amf-production") {
            return Err(error);
        }
        let packages = if run.package_pins.is_empty() { vec![
            PackageRequestV1 {
                package_id: "com.vrchat.avatars".into(),
                version: None,
            },
            PackageRequestV1 {
                package_id: "nadena.dev.modular-avatar".into(),
                version: None,
            },
        ] } else { run.package_pins.iter().map(|(id, version)| PackageRequestV1 { package_id: id.clone(), version: Some(version.clone()) }).collect() };
        let preview = backend.preview_install(&p, &packages)?;
        if preview.destructive || !preview.conflicts.is_empty() {
            return Err(err(
                "dependencies_conflict",
                format!(
                    "Package preparation needs explicit conflict handling: {:?}",
                    preview.conflicts
                ),
            ));
        }
        backend.apply_install(&p, &packages, &preview.digest)?;
        // Real upstream SDK + MA are required. No staging-scaffold stubs are installed here.
        refresh_bridge_package(&p.root)?;
        Ok(())
    }
    fn import_sources(
        &self,
        run: &ProductionRun,
        ctx: &TaskContext,
    ) -> Result<Vec<PreparedSource>, AppErrorV1> {
        let mut sources = Vec::new();
        let mut files: BTreeMap<String, PathBuf> = BTreeMap::new();
        let mut guids = HashMap::<String, String>::new();
        let mut needs_liltoon = false;
        let mut liltoon_shaders = BTreeSet::new();
        let available = self
            .sources()?
            .into_iter()
            .map(|s| (s.source_id.clone(), s))
            .collect::<HashMap<_, _>>();
        for choice in &run.choices {
            if let Some(error) = ctx.cancellation_error("amf-production") {
                return Err(error);
            }
            let source = available.get(&choice.source_id).cloned().ok_or_else(|| {
                err(
                    "source_missing",
                    "Selected local input is no longer present.",
                )
            })?;
            ctx.emit_progress(material_progress(run, &source.item_name));
            let package_path = self.package_path(&source)?;
            let sha256 = vua_unity_bridge::material_exec::sha256_file(&package_path)
                .map_err(|e| err("source_unreadable", e))?;
            if run.recipe_source_hashes.get(&source.source_id).is_some_and(|expected| sha256.strip_prefix("sha256:").unwrap_or(&sha256) != expected) {
                return Err(err("recipe_material_changed", format!("{} changed after Recipe resolution. Restore the required original before retrying.", source.name)));
            }
            let staged = vua_unity_bridge::production_job::stage_original_source(
                &package_path,
                Path::new(&run.project_root),
                &format!("{}-{}", run.run_id, sources.len()),
                &sha256,
            )
            .map_err(|e| err("source_invalid", e))?;
            let mut asset_paths = Vec::new();
            let mut bundled_liltoon = false;
            for folder in
                fs::read_dir(&staged.source_package_path).map_err(|e| err("source_invalid", e))?
            {
                let folder = folder.map_err(|e| err("source_invalid", e))?.path();
                if !folder.is_dir() {
                    continue;
                }
                let pathname = folder.join("pathname");
                if !pathname.is_file() {
                    continue;
                }
                let logical = fs::read_to_string(pathname)
                    .map_err(|e| err("source_invalid", e))?
                    .trim()
                    .replace('\\', "/");
                if !safe_asset_path(&logical) {
                    return Err(err(
                        "source_invalid",
                        format!("Only Assets/ package paths are supported: {logical}"),
                    ));
                }
                let folded = logical.to_ascii_lowercase();
                if folded == "assets/vua" || folded.starts_with("assets/vua/") {
                    return Err(err(
                        "asset_conflict",
                        "Selected source uses the reserved AMF work-scene directory Assets/VUA.",
                    ));
                }
                // A copy of lilToon shipped inside a material package: the current official VPM
                // package takes its place, so materials render with the maintained shaders.
                if is_bundled_liltoon(&folded) {
                    bundled_liltoon = true;
                    continue;
                }
                let guid = folder
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                if guid.len() != 32 || !guid.bytes().all(|c| c.is_ascii_hexdigit()) {
                    return Err(err("source_invalid", "Invalid Unity asset GUID."));
                }
                let metadata = fs::read_to_string(folder.join("asset.meta")).map_err(|e| {
                    err(
                        "source_invalid",
                        format!("Read metadata for {logical}: {e}"),
                    )
                })?;
                validate_metadata_guid(&metadata, &guid, &logical)?;
                if let Some(previous) = guids.insert(guid.clone(), logical.clone()) {
                    if previous != logical {
                        return Err(err(
                            "asset_conflict",
                            format!("GUID {guid} maps to both {previous} and {logical}."),
                        ));
                    }
                }
                for (input, target) in [
                    (folder.join("asset"), logical.clone()),
                    (folder.join("asset.meta"), format!("{logical}.meta")),
                ] {
                    if !input.is_file() {
                        continue;
                    }
                    if let Some(previous) = files.get(&target) {
                        if vua_unity_bridge::material_exec::sha256_file(previous)
                            .map_err(|e| err("source_invalid", e))?
                            != vua_unity_bridge::material_exec::sha256_file(&input)
                                .map_err(|e| err("source_invalid", e))?
                        {
                            return Err(err("asset_conflict", format!("Selected packages contain different files at {target}. Choose compatible package versions.")));
                        }
                    } else {
                        files.insert(target, input);
                    }
                }
                if !folder.join("asset.meta").is_file() {
                    return Err(err(
                        "source_invalid",
                        format!("Asset has no Unity metadata: {logical}"),
                    ));
                }
                if folder.join("asset").is_file() {
                    if folded.ends_with(".mat") {
                        let material = fs::read(folder.join("asset")).map_err(|e| err("source_invalid", e))?;
                        liltoon_shaders.extend(liltoon_material_shader(&material));
                    }
                    asset_paths.push(logical);
                }
            }
            needs_liltoon |= bundled_liltoon;
            if asset_paths.is_empty() && !bundled_liltoon {
                return Err(err(
                    "source_invalid",
                    format!("{} contains no supported Assets/ inputs.", source.name),
                ));
            }
            asset_paths.sort();
            sources.push(PreparedSource {
                source_id: choice.source_id.clone(),
                role: choice.role,
                name: source.name,
                item_name: source.item_name,
                sha256,
                asset_paths,
            });
        }
        // Validate the entire batch before the first asset copy; shared identical files are reused.
        validate_asset_layout(files.keys().map(String::as_str))?;
        // lilToon materials whose shader none of the selected packages carries render pink
        // until the lilToon package is in the project.
        needs_liltoon |= liltoon_shaders.iter().any(|shader| !guids.contains_key(shader));
        if needs_liltoon && !run.package_pins.contains_key(LILTOON_PACKAGE) {
            ctx.emit_progress(material_progress(run, "lilToon"));
            self.install_liltoon(run)?;
        }
        for (relative, original) in files {
            let destination = Path::new(&run.project_root).join(&relative);
            if destination.exists() {
                return Err(err(
                    "asset_conflict",
                    format!("Work project already contains {relative}."),
                ));
            }
            fs::create_dir_all(destination.parent().expect("asset parent"))
                .map_err(|e| err("import_failed", e))?;
            fs::copy(original, destination).map_err(|e| err("import_failed", e))?;
        }
        Ok(sources)
    }
    fn inspect(&self, run: &ProductionRun, watch: &UnityWatch) -> Result<ObservedProject, AppErrorV1> {
        let operation = if Path::new(&run.project_root)
            .join("Assets/VUA/Production.unity")
            .is_file()
        {
            UnityOperation::AmfInspect
        } else {
            UnityOperation::AmfPrepare
        };
        self.bridge(run, operation, None, watch)
    }
    fn assemble(
        &self,
        run: &ProductionRun,
        selection: &AssemblySelection,
        watch: &UnityWatch,
    ) -> Result<ObservedProject, AppErrorV1> {
        self.verify_assembly_sources(run)?;
        self.bridge(run, UnityOperation::AmfAssemble, Some(selection), watch)
    }
    fn apply_recipe(&self, run: &ProductionRun, selection: &AssemblySelection, target: &vua_orchestrator::amf_recipe_apply::RecipeApplyTarget, watch: &UnityWatch) -> Result<ObservedProject, AppErrorV1> {
        self.verify_assembly_sources(run)?;
        self.bridge_with_target(run, UnityOperation::AmfAssemble, Some(selection), Some(target), watch)
    }
    fn fingerprint(&self, project: &Path) -> Result<String, AppErrorV1> {
        reject_editor_lock(project)?;
        vua_orchestrator::project_tree_fingerprint_cached(
            project,
            &["Assets", "Packages", "ProjectSettings"],
        )
        .map_err(|e| err("project_unreadable", e))?
        .ok_or_else(|| err("project_missing", "Work project is missing."))
    }
    fn fingerprint_legacy(&self, project: &Path) -> Result<String, AppErrorV1> {
        reject_editor_lock(project)?;
        vua_orchestrator::project_tree_fingerprint(
            project,
            &["Assets", "Packages", "ProjectSettings"],
        )
        .map_err(|e| err("project_unreadable", e))?
        .ok_or_else(|| err("project_missing", "Work project is missing."))
    }
    fn snapshot(&self, run: &ProductionRun) -> Result<String, AppErrorV1> {
        reject_editor_lock(Path::new(&run.project_root))?;
        let id = format!("n3-{}", super::provider_host::uuid_v7_identity());
        FileSystemSnapshotStore
            .create_verified(
                &project(run),
                &id,
                &["Assets", "Packages", "ProjectSettings"],
            )
            .map_err(|e| err("snapshot_failed", e))?;
        Ok(id)
    }
    fn restore(&self, run: &ProductionRun, snapshot: &str) -> Result<(), AppErrorV1> {
        reject_editor_lock(Path::new(&run.project_root))?;
        FileSystemSnapshotStore::validate_snapshot_id(snapshot)
            .map_err(|e| err("restore_failed", e))?;
        FileSystemSnapshotStore
            .restore_verified(
                &project(run),
                &SnapshotRef {
                    id: snapshot.into(),
                    path: Path::new(&run.project_root)
                        .join(".vua/snapshots")
                        .join(snapshot),
                },
            )
            .map_err(|e| err("restore_failed", e))
    }
    fn open(
        &self,
        run: &ProductionRun,
        ctx: &TaskContext,
    ) -> Result<serde_json::Value, AppErrorV1> {
        self.verify_editor(&run.editor.path)?;
        let avatar = run.result["facts"]["avatarGlobalObjectId"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| err("result_invalid", "Result has no Avatar identity."))?;
        if !editor_holds_project(Path::new(&run.project_root)) {
            refresh_bridge_package(Path::new(&run.project_root))?;
        }
        let folder = Path::new(&run.project_root).join(".vua/bridge");
        let receipt = folder.join("amf-open.result.json");
        if receipt.exists() {
            fs::remove_file(&receipt).map_err(|e| err("open_failed", e))?;
        }
        fs::write(folder.join("amf-open.json"), serde_json::to_vec(&serde_json::json!({"schemaVersion":"0.1","runId":run.run_id,"avatarGlobalObjectId":avatar})).map_err(|e| err("open_failed", e))?)
            .map_err(|e| err("open_failed", e))?;
        if !editor_holds_project(Path::new(&run.project_root)) {
            self.start_unity_hub();
        }
        // The Editor shows its own progress window; the task names its start.
        let now = vua_orchestrator::rfc3339(std::time::SystemTime::now());
        ctx.emit_progress(serde_json::json!({"operation":"amf.production","runId":run.run_id,"step":"open",
            "name":"Open the work project in Unity","startedAt":now,"unity":{"stage":"starting","lastActivityAt":now}}));
        if std::env::var("VUA_AMF_HANDOFF_FROM_DESKTOP").as_deref() != Ok("1") {
            open_editor(run)?;
        }
        let start = std::time::Instant::now();
        while start.elapsed() < std::time::Duration::from_secs(180) {
            if let Some(error) = ctx.cancellation_error("amf-production") {
                let _ = fs::remove_file(folder.join("amf-open.json"));
                return Err(error);
            }
            if let Ok(bytes) = fs::read(&receipt) {
                let value: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|e| err("open_failed", e))?;
                if value["runId"] != run.run_id
                    || value["avatarSelected"] != true
                    || value["sdkPanelRequested"] != true
                {
                    return Err(err(
                        "sdk_handoff_incomplete",
                        "Unity opened, but the Avatar or official SDK panel was not selected.",
                    ));
                }
                return Ok(value);
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        Err(err(
            "sdk_handoff_timeout",
            "Unity has not confirmed Avatar selection and SDK panel opening.",
        ))
    }
    fn turntable(&self, run: &ProductionRun, watch: &UnityWatch) -> Result<ObservedProject, AppErrorV1> {
        self.bridge(run, UnityOperation::AmfTurntable, None, watch)
    }
    fn upload(&self, run: &ProductionRun, request: &UploadRequest, ctx: &TaskContext, progress: &mut dyn FnMut(UploadProgress)) -> Result<UploadReceipt, AppErrorV1> {
        release_handoff::upload(self, run, request, ctx, progress)
    }
    fn editor_open(&self, project: &Path) -> bool {
        editor_holds_project(project)
    }
}

fn bridge_log_failure(path: &Path) -> Option<AppErrorV1> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let mut head = Vec::new();
    (&mut file).take(64 * 1024).read_to_end(&mut head).ok()?;
    file.seek(SeekFrom::Start(length.saturating_sub(512 * 1024))).ok()?;
    let mut tail = Vec::new();
    file.take(512 * 1024).read_to_end(&mut tail).ok()?;
    classify_bridge_log(&String::from_utf8_lossy(&head), &String::from_utf8_lossy(&tail))
}

/// Library intake keeps an original ZIP and also extracts it to `expanded/<zip copy>/<member>`.
/// When the ZIP's member is already offered, the extracted copy is the same package and is omitted.
fn drop_expanded_duplicates(sources: Vec<ProductionSource>) -> Vec<ProductionSource> {
    let members: BTreeSet<(String, String)> = sources
        .iter()
        .filter_map(|s| s.archive_member.as_ref().map(|m| (s.item_id.clone(), format!("{}/{}", s.source_id.rsplit_once('-').map_or("", |(zip, _)| zip), m.replace('\\', "/")))))
        .collect();
    sources
        .into_iter()
        .filter(|s| {
            s.archive_member.is_some()
                || !s.name.strip_prefix("expanded/").is_some_and(|rest| members.contains(&(s.item_id.clone(), rest.to_owned())))
        })
        .collect()
}

fn classify_bridge_log(head: &str, tail: &str) -> Option<AppErrorV1> {
    if ["No ULF license found", "License is not active", "No valid Unity Editor license found"]
        .iter().any(|message| head.contains(message) || tail.contains(message))
    {
        return Some(err("unity_license_unavailable", "Activate this Editor's license in Unity Hub, then retry preparation. Selected materials are retained."));
    }
    if ["Failed to start the Unity Package Manager local server", "UpmClient::Connect -- Could not connect to IPC stream"]
        .iter().any(|message| tail.contains(message))
    {
        return Some(err("unity_package_manager_unavailable", "Unity's Package Manager service did not start. Allow UnityPackageManager.exe in antivirus software if it is blocked, then reinspect the retained project. Selected materials are retained."));
    }
    let mut errors = Vec::new();
    for line in tail.lines().filter(|line| line.contains(": error CS")) {
        let line = line.trim().chars().take(1200).collect::<String>();
        if !errors.contains(&line) { errors.push(line); }
        if errors.len() == 8 { break; }
    }
    if errors.is_empty() { return None; }
    Some(err("unity_compile_failed", format!(
        "Unity could not compile the prepared project. Resolve the reported package or script dependency, then reinspect the retained project.\n{}", errors.join("\n")
    )))
}

pub(crate) fn safe_asset_path(path: &str) -> bool {
    path.starts_with("Assets/")
        && !path.contains(['\\', ':', '<', '>', '"', '|', '?', '*'])
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != ".." && !p.ends_with(['.', ' ']))
}
fn hash_text(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The shader GUID of a lilToon material (it records `_lilToonVersion`), in lower case.
fn liltoon_material_shader(material: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(material);
    if !text.contains("_lilToonVersion") {
        return None;
    }
    let reference = text.lines().find_map(|line| line.trim_start().strip_prefix("m_Shader:"))?;
    let guid = reference.split("guid:").nth(1)?.split([',', '}']).next()?.trim().to_ascii_lowercase();
    (guid.len() == 32 && guid.bytes().all(|c| c.is_ascii_hexdigit())).then_some(guid)
}

fn validate_metadata_guid(meta: &str, guid: &str, path: &str) -> Result<(), AppErrorV1> {
    let mut actual = meta
        .lines()
        .filter_map(|line| line.strip_prefix("guid:").map(str::trim));
    if !actual
        .next()
        .is_some_and(|value| value.eq_ignore_ascii_case(guid))
        || actual.next().is_some()
    {
        return Err(err(
            "asset_conflict",
            format!("Unity metadata identity differs from its package GUID: {path}"),
        ));
    }
    Ok(())
}

fn validate_asset_layout<'a>(paths: impl Iterator<Item = &'a str>) -> Result<(), AppErrorV1> {
    let paths = paths.collect::<std::collections::BTreeSet<_>>();
    let mut windows_keys = std::collections::HashSet::new();
    for path in &paths {
        if !windows_keys.insert(path.to_ascii_lowercase()) {
            return Err(err(
                "asset_conflict",
                format!("Package paths collide on Windows: {path}"),
            ));
        }
    }
    for path in &windows_keys {
        let mut ancestor = path.rsplit_once('/').map(|(parent, _)| parent);
        while let Some(parent) = ancestor {
            if windows_keys.contains(parent) {
                return Err(err(
                    "asset_conflict",
                    format!("An asset file conflicts with a directory: {parent}"),
                ));
            }
            ancestor = parent.rsplit_once('/').map(|(next, _)| next);
        }
    }
    Ok(())
}
fn safe_zip_member(value: &str) -> bool {
    let path = value.replace('\\', "/");
    !path.starts_with('/')
        && !path.contains([':', '\0'])
        && path
            .split('/')
            .all(|p| !p.is_empty() && p != "." && p != "..")
}
/// The progress payload of the materials step while it works on one material.
fn material_progress(run: &ProductionRun, name: &str) -> serde_json::Value {
    let mut step = run.steps.last().cloned().expect("materials are imported inside their step");
    step.name = name.into();
    step_progress(&run.run_id, &step)
}

/// The work-project assets the first preparation imports: each material file and each folder
/// that holds them, as Unity imports folders too.
fn imported_asset_count(run: &ProductionRun) -> u32 {
    let mut assets = BTreeSet::new();
    for path in run.sources.iter().flat_map(|source| &source.asset_paths) {
        let mut current = path.as_str();
        assets.insert(current);
        while let Some((parent, _)) = current.rsplit_once('/') {
            if parent == "Assets" || !assets.insert(parent) {
                break;
            }
            current = parent;
        }
    }
    u32::try_from(assets.len()).unwrap_or(u32::MAX)
}

/// Removes `Temp/UnityLockfile` when no Editor holds it. A stopped or crashed batch run leaves
/// the file behind; Unity and the desktop handoff then find the project closed again.
fn clear_stale_lock(project: &Path) {
    if !editor_holds_project(project) {
        let _ = fs::remove_file(project.join("Temp/UnityLockfile"));
    }
}

/// An Editor keeps `Temp/UnityLockfile` open while it has the project. A crashed batch run leaves
/// the file behind with no handle, so the project counts as open only while the file is held.
fn editor_holds_project(project: &Path) -> bool {
    let lock = project.join("Temp/UnityLockfile");
    if !lock.exists() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&lock)
            .is_err()
    }
    #[cfg(not(windows))]
    true
}
/// Brings the work project's VUA Bridge package to this build's copy. Retained projects keep
/// working after a VUA update; files that already match stay untouched. Returns the files written.
fn refresh_bridge_package(project: &Path) -> Result<usize, AppErrorV1> {
    let mut written = 0;
    for (relative, contents) in vua_unity_bridge::staging_scaffold::BRIDGE_PACKAGE_FILES
        .iter()
        .chain(vua_unity_bridge::staging_scaffold::AMF_PRODUCTION_BRIDGE_FILES)
    {
        let target = project.join("Packages/com.ph-r.vua").join(relative);
        if fs::read(&target).is_ok_and(|current| current == contents.as_bytes()) {
            continue;
        }
        fs::create_dir_all(target.parent().expect("Bridge parent"))
            .map_err(|e| err("project_failed", e))?;
        fs::write(target, contents).map_err(|e| err("project_failed", e))?;
        written += 1;
    }
    Ok(written)
}
fn reject_editor_lock(project: &Path) -> Result<(), AppErrorV1> {
    if editor_holds_project(project) {
        return Err(err(
            "project_open",
            "Close this project's Unity Editor, then reinspect before production.",
        ));
    }
    Ok(())
}
fn open_editor(run: &ProductionRun) -> Result<(), AppErrorV1> {
    if editor_holds_project(Path::new(&run.project_root)) {
        return Ok(());
    }
    let mut command = std::process::Command::new(&run.editor.path);
    command
        .args(["-projectPath", &run.project_root])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for variable in vua_orchestrator::CREDENTIAL_ENV_REMOVALS {
        command.env_remove(variable);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000 | 0x0000_0008);
    }
    command.spawn().map_err(|e| err("open_failed", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn unity_null_selection_is_not_a_desktop_editing_selection() {
        let mut facts = serde_json::json!({"observedSelection":{"avatarPrefab":"","outfits":[]}});
        normalize_observed_selection(&mut facts).unwrap();
        assert!(facts["observedSelection"].is_null());
        let mut malformed = serde_json::json!({"observedSelection":{"avatarPrefab":"Assets/A.prefab","outfits":[]}});
        assert!(normalize_observed_selection(&mut malformed).is_err());
    }

    fn preview_project(name: &str) -> PathBuf {
        let project = std::env::temp_dir().join(format!("vua-amf-preview-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&project);
        std::fs::create_dir_all(project.join(".vua/previews/cmd-1")).unwrap();
        for file in ["front.png", "side.png", "back.png", "candidate-000.png"] {
            std::fs::write(project.join(".vua/previews/cmd-1").join(file), b"\x89PNG\r\n\x1a\nimage").unwrap();
        }
        project
    }

    #[test]
    fn previews_stay_inside_the_work_project_preview_folder() {
        let project = preview_project("paths");
        assert!(preview_file(&project, ".vua/previews/cmd-1/front.png").unwrap().ends_with("front.png"));
        for outside in [
            "../front.png", ".vua/previews/../cmd-1/front.png", ".vua/previews/cmd-1/../../x.png",
            ".vua\\previews\\cmd-1\\front.png", "C:/Windows/front.png", "/.vua/previews/cmd-1/front.png",
            ".vua/previews/cmd-1/front.jpg", ".vua/previews/front.png", ".vua/previews/cmd-1/a/front.png",
            ".vua/bridge/cmd-1/front.png", ".vua/previews/cmd-1/front.png:stream", ".vua/previews/./front.png",
        ] {
            assert_eq!(preview_file(&project, outside).unwrap_err().code, "vua.amf_production.preview_invalid", "{outside}");
        }
        assert_eq!(preview_file(&project, ".vua/previews/cmd-1/absent.png").unwrap_err().code, "vua.amf_production.preview_missing");
        std::fs::write(project.join(".vua/previews/cmd-1/large.png"), vec![0u8; MAX_PREVIEW_BYTES as usize + 1]).unwrap();
        assert_eq!(preview_file(&project, ".vua/previews/cmd-1/large.png").unwrap_err().code, "vua.amf_production.preview_unusable");
        std::fs::remove_dir_all(&project).unwrap();
    }

    #[test]
    fn receipts_keep_previews_this_command_wrote() {
        let project = preview_project("receipt");
        let mut facts = serde_json::json!({
            "previews": [{"view":"front","path":".vua/previews/cmd-1/front.png"},{"view":"side","path":".vua/previews/cmd-1/side.png"},{"view":"back","path":".vua/previews/cmd-1/back.png"}],
            "prefabs": [{"path":"Assets/A.prefab","preview":".vua/previews/cmd-1/candidate-000.png"},{"path":"Assets/B.prefab","preview":""},
                {"path":"Assets/C.prefab","preview":".vua/previews/cmd-1/candidate-002.png"}]});
        assert_eq!(normalize_previews(&mut facts, &project, "cmd-1").unwrap(), vec![".vua/previews/cmd-1/candidate-002.png".to_owned()]);
        assert_eq!(facts["previews"].as_array().unwrap().len(), 3);
        assert_eq!(facts["prefabs"][0]["preview"], ".vua/previews/cmd-1/candidate-000.png");
        assert!(facts["prefabs"][1].get("preview").is_none(), "an empty Unity string means no image");
        assert!(facts["prefabs"][2].get("preview").is_none(), "a missing image is left out");

        std::fs::write(project.join(".vua/previews/cmd-1/side.png"), vec![0u8; MAX_PREVIEW_BYTES as usize + 1]).unwrap();
        let mut large = serde_json::json!({"previews":[{"view":"front","path":".vua/previews/cmd-1/front.png"},{"view":"side","path":".vua/previews/cmd-1/side.png"}]});
        assert_eq!(normalize_previews(&mut large, &project, "cmd-1").unwrap().len(), 1);
        assert_eq!(large["previews"], serde_json::json!([{"view":"front","path":".vua/previews/cmd-1/front.png"}]));

        let mut absent = serde_json::json!({"prefabs":[]});
        normalize_previews(&mut absent, &project, "cmd-1").unwrap();
        assert_eq!(absent["previews"], serde_json::json!([]));

        let mut other_command = serde_json::json!({"previews":[{"view":"front","path":".vua/previews/cmd-1/front.png"}]});
        assert_eq!(normalize_previews(&mut other_command, &project, "cmd-2").unwrap_err().code, "vua.amf_production.receipt_invalid");
        for invalid in [
            serde_json::json!({"previews":[{"view":"top","path":".vua/previews/cmd-1/front.png"}]}),
            serde_json::json!({"previews":[{"view":"front","path":".vua/previews/cmd-1/front.png"},{"view":"front","path":".vua/previews/cmd-1/side.png"}]}),
            serde_json::json!({"previews":[{"view":"front","path":".vua/previews/cmd-1/front.png","extra":1}]}),
            serde_json::json!({"previews":[{"view":"front","path":"../outside.png"}]}),
            serde_json::json!({"previews":"front.png"}),
            serde_json::json!({"prefabs":[{"preview":".vua/previews/cmd-1/../../../secret.png"}]}),
            serde_json::json!({"prefabs":[{"preview":7}]}),
        ] {
            let mut facts = invalid.clone();
            assert_eq!(normalize_previews(&mut facts, &project, "cmd-1").unwrap_err().code, "vua.amf_production.receipt_invalid", "{invalid}");
        }
        std::fs::remove_dir_all(&project).unwrap();
    }

    #[test]
    fn earlier_preview_folders_are_removed_unless_the_run_reports_them() {
        let project = preview_project("prune");
        std::fs::create_dir_all(project.join(".vua/previews/cmd-0")).unwrap();
        std::fs::write(project.join(".vua/previews/notes.txt"), b"kept").unwrap();
        prune_previews(&project, &[".vua/previews/cmd-1/front.png".into()]);
        assert!(project.join(".vua/previews/cmd-1/front.png").is_file());
        assert!(!project.join(".vua/previews/cmd-0").exists());
        assert!(project.join(".vua/previews/notes.txt").is_file(), "only folders are pruned");
        prune_previews(&project.join("absent"), &[]);
        std::fs::remove_dir_all(&project).unwrap();
    }

    #[test]
    fn liltoon_materials_name_their_shader() {
        let material = b"Material:\n  m_Name: Tshirt\n  m_Shader: {fileID: 4800000, guid: DF12117ECD77C31469C224178886498E, type: 3}\n  m_Floats:\n    - _lilToonVersion: 44\n";
        assert_eq!(liltoon_material_shader(material).as_deref(), Some("df12117ecd77c31469c224178886498e"));
        assert_eq!(liltoon_material_shader(b"Material:\n  m_Shader: {fileID: 46, guid: 0000000000000000f000000000000000, type: 0}\n"), None);
    }

    #[test]
    fn compiler_failure_reports_deduplicated_diagnostics_without_license_metadata() {
        let diagnostic = "Library/PackageCache/com.unity.xr.oculus@4.2.0/Runtime/FFR.cs(22,20): error CS0103: The name 'Permission' does not exist in the current context";
        let error = classify_bridge_log("Serial number assigned to: private\nSuccessfully resolved entitlements", &format!("{diagnostic}\n{diagnostic}\nScripts have compiler errors.")).unwrap();
        assert_eq!(error.code, "vua.amf_production.unity_compile_failed");
        let text = serde_json::to_string(&error).unwrap();
        assert_eq!(text.matches("error CS0103").count(), 1);
        assert!(!text.contains("private"));
        assert!(classify_bridge_log("Access token is unavailable; failed to update\nSuccessfully resolved entitlements", "Compilation succeeded").is_none());
        assert_eq!(classify_bridge_log("No valid Unity Editor license found", "").unwrap().code, "vua.amf_production.unity_license_unavailable");
    }

    #[cfg(windows)]
    #[test]
    fn only_a_held_unity_lockfile_means_the_project_is_open() {
        let project = std::env::temp_dir().join(format!("vua-amf-lock-{}", std::process::id()));
        std::fs::create_dir_all(project.join("Temp")).unwrap();
        assert!(reject_editor_lock(&project).is_ok());
        let lock = project.join("Temp/UnityLockfile");
        std::fs::write(&lock, b"").unwrap();
        assert!(reject_editor_lock(&project).is_ok(), "a crashed run's leftover lock file");
        let held = std::fs::File::open(&lock).unwrap();
        assert_eq!(reject_editor_lock(&project).unwrap_err().code, "vua.amf_production.project_open");
        clear_stale_lock(&project);
        assert!(lock.is_file(), "a held lock belongs to a running Editor");
        drop(held);
        assert!(reject_editor_lock(&project).is_ok());
        clear_stale_lock(&project);
        assert!(!lock.exists(), "a stopped run's lock file is removed");
        clear_stale_lock(&project);
        std::fs::remove_dir_all(&project).unwrap();
    }

    #[test]
    fn the_first_import_counts_material_files_and_their_folders() {
        let source = |paths: &[&str]| PreparedSource {
            source_id: "s".into(), role: SourceRole::Auto, name: "s.unitypackage".into(), item_name: "s".into(),
            sha256: String::new(), asset_paths: paths.iter().map(|p| (*p).into()).collect(),
        };
        let run: ProductionRun = serde_json::from_value(serde_json::json!({
            "schemaVersion":"0.1","runId":"n3-count","phase":"preparing","taskId":"t","editor":{"path":"Unity.exe","version":"2022.3.22f1"},
            "projectRoot":"x","choices":[],"sources":[],"prefabs":[],"projectFingerprint":"","unityFingerprint":"","steps":[],
            "selection":null,"confirmedDigest":null,"result":null,"error":null,"recovery":null})).unwrap();
        let run = ProductionRun { sources: vec![
            source(&["Assets/Meiyun/Meiyun.prefab", "Assets/Meiyun/Textures/Body.png"]),
            source(&["Assets/Meiyun/Textures/Face.png", "Assets/Tshirt.mat"]),
        ], ..run };
        // Four files, plus Assets/Meiyun and Assets/Meiyun/Textures.
        assert_eq!(imported_asset_count(&run), 6);
    }

    #[test]
    fn bundled_liltoon_copies_are_recognized_by_their_install_folder() {
        assert!(is_bundled_liltoon("assets/liltoon"));
        assert!(is_bundled_liltoon("assets/liltoon/shader/lts.shader"));
        assert!(!is_bundled_liltoon("assets/liltoonextras/readme.txt"));
        assert!(!is_bundled_liltoon("assets/amenbo/tshirt&shorts/material/liltoon.mat"));
    }

    #[test]
    fn retained_projects_receive_this_builds_bridge_and_matching_files_stay() {
        let project = std::env::temp_dir().join(format!("vua-amf-bridge-{}", std::process::id()));
        let total = vua_unity_bridge::staging_scaffold::BRIDGE_PACKAGE_FILES.len()
            + vua_unity_bridge::staging_scaffold::AMF_PRODUCTION_BRIDGE_FILES.len();
        assert_eq!(refresh_bridge_package(&project).unwrap(), total);
        let entry = project.join("Packages/com.ph-r.vua/Editor/Amf/AmfProductionEntryPoint.cs");
        std::fs::write(&entry, "// an older Bridge").unwrap();
        assert_eq!(refresh_bridge_package(&project).unwrap(), 1);
        assert!(std::fs::read_to_string(&entry).unwrap().contains("class AmfProductionEntryPoint"));
        assert_eq!(refresh_bridge_package(&project).unwrap(), 0);
        std::fs::remove_dir_all(&project).unwrap();
    }

    #[test]
    fn package_manager_startup_failure_has_its_own_next_step() {
        let tail = "[Package Manager] UpmClient::Connect -- Could not connect to IPC stream \"Upm-17136\" after 30.0 seconds.\n[Package Manager] Failed to start the Unity Package Manager local server process.";
        let error = classify_bridge_log("Serial number assigned to: private", tail).unwrap();
        assert_eq!(error.code, "vua.amf_production.unity_package_manager_unavailable");
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
    }

    #[test]
    fn extracted_copies_of_offered_zip_members_are_listed_once() {
        let source = |id: &str, item: &str, name: &str, member: Option<&str>| ProductionSource {
            source_id: id.into(), item_id: item.into(), item_name: "Meiyun.zip".into(), name: name.into(),
            path: PathBuf::from("x"), archive_member: member.map(Into::into),
        };
        let kept = drop_expanded_duplicates(vec![
            source("cpy-whi-1-aaaaaaaaaaaaaaaaaaaaaaaa", "whi-1", "Meiyun/Meiyun.unitypackage", Some("Meiyun/Meiyun.unitypackage")),
            source("cpy-zip-1-0", "whi-1", "expanded/cpy-whi-1/Meiyun/Meiyun.unitypackage", None),
            source("cpy-zip-2-0", "whi-2", "expanded/cpy-whi-9/Other.unitypackage", None),
            source("cpy-whi-3", "whi-3", "Direct.unitypackage", None),
        ]);
        let ids: Vec<_> = kept.iter().map(|s| s.source_id.as_str()).collect();
        assert_eq!(ids, ["cpy-whi-1-aaaaaaaaaaaaaaaaaaaaaaaa", "cpy-zip-2-0", "cpy-whi-3"]);
    }

    #[test]
    fn embedded_package_is_a_normal_file_and_is_refreshed_on_windows() {
        let root = std::env::temp_dir().join(format!(
            "vua-n3-zip-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let zip_path = root.join("source.zip");
        let mut writer = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
        writer
            .start_file(
                "PC/衣装.unitypackage",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        writer.write_all(b"original source bytes").unwrap();
        writer.finish().unwrap();
        let adapter = NativeAmfProduction {
            bdl: Arc::new(BdlStore::open(root.join("bdl.db")).unwrap()),
            root: root.join("amf"),
            editor_roots: vec![],
            explicit_editor: None,
            unity_hub: None,
        };
        let source = ProductionSource {
            source_id: "source-1".into(),
            item_id: "item-1".into(),
            item_name: "衣装".into(),
            name: "PC/衣装.unitypackage".into(),
            path: zip_path.clone(),
            archive_member: Some("PC/衣装.unitypackage".into()),
        };
        let extracted = adapter.package_path(&source).unwrap();
        assert!(!extracted
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains(':'));
        assert_eq!(fs::metadata(&extracted).unwrap().len(), 21);
        assert_eq!(fs::read(&extracted).unwrap(), b"original source bytes");
        fs::write(&extracted, b"tampered private cache").unwrap();
        assert_eq!(adapter.package_path(&source).unwrap(), extracted);
        assert_eq!(fs::read(extracted).unwrap(), b"original source bytes");
        assert!(zip_path.is_file());
        drop(adapter);
        assert!(
            root.starts_with(std::env::temp_dir())
                && root
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("vua-n3-zip-")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn batch_rejects_directory_file_and_windows_case_collisions() {
        assert!(
            validate_asset_layout(["Assets/Outfit", "Assets/outfit/Coat.prefab"].into_iter())
                .is_err()
        );
        assert!(!safe_asset_path("Assets/VUA./Overwrite.prefab"));
        assert!(!safe_asset_path("Assets/Coat.prefab "));
        assert!(
            validate_asset_layout(["Assets/Outfit", "Assets/Outfit/Coat.prefab"].into_iter())
                .is_err()
        );
        assert!(
            validate_asset_layout(["Assets/Coat.prefab", "Assets/coat.prefab"].into_iter())
                .is_err()
        );
        assert!(validate_asset_layout(
            ["Assets/Outfit.meta", "Assets/Outfit/Coat.prefab"].into_iter()
        )
        .is_ok());
    }

    #[test]
    fn metadata_guid_must_match_the_archive_identity() {
        let guid = "aabbccddeeff00112233445566778899";
        assert!(validate_metadata_guid(
            &format!("fileFormatVersion: 2\nguid: {guid}\n"),
            guid,
            "Assets/Coat.prefab"
        )
        .is_ok());
        assert!(validate_metadata_guid(
            "guid: ffffffffffffffffffffffffffffffff",
            guid,
            "Assets/Coat.prefab"
        )
        .is_err());
        assert!(validate_metadata_guid(
            &format!("guid: {guid}\nguid: {guid}"),
            guid,
            "Assets/Coat.prefab"
        )
        .is_err());
    }

    #[test]
    fn the_cached_fingerprint_and_its_legacy_value_name_their_algorithms() {
        let root = std::env::temp_dir().join(format!("vua-amf-fingerprint-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let project = root.join("work");
        for scope in ["Assets", "Packages", "ProjectSettings"] {
            std::fs::create_dir_all(project.join(scope)).unwrap();
        }
        std::fs::write(project.join("Assets/Meiyun.prefab"), "avatar\n").unwrap();
        std::fs::write(project.join("Packages/vpm-manifest.json"), "{}\n").unwrap();
        std::fs::write(project.join("ProjectSettings/ProjectVersion.txt"), "2022.3.22f1\n").unwrap();
        let adapter = NativeAmfProduction {
            bdl: Arc::new(BdlStore::open(root.join("bdl.db")).unwrap()),
            root: root.join("amf"),
            editor_roots: vec![],
            explicit_editor: None,
            unity_hub: None,
        };
        let cached = AmfProductionPlatform::fingerprint(&adapter, &project).unwrap();
        assert!(cached.starts_with("vua-project-tree-v2:"), "{cached}");
        assert_eq!(cached, AmfProductionPlatform::fingerprint(&adapter, &project).unwrap());
        assert!(project.join(".vua/fingerprint-cache.json").is_file(), "the run leaves a cache behind");
        let legacy = AmfProductionPlatform::fingerprint_legacy(&adapter, &project).unwrap();
        assert_eq!(
            legacy,
            vua_orchestrator::project_tree_fingerprint(
                &project,
                &["Assets", "Packages", "ProjectSettings"]
            )
            .unwrap()
            .unwrap(),
            "the legacy value is exactly what older records carry"
        );
        drop(adapter);
        std::fs::remove_dir_all(&root).unwrap();
    }
}

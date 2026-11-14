//! Verified material source resolution and non-destructive legacy Recipe v0.3 migration for selection drafts.
use crate::artifact_inspection::{hex_lower, sha256_file};
use crate::library_view::{presence, PresenceCheck};
use crate::recipe_selection_drafts::{DraftError, RecipeSelectionDrafts};
use crate::zip_intake::is_reparse;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use vua_bdl_store::{ArtifactMode, BdlStore, LibraryCopyEvidence};
use vua_orchestrator::RecipeDocumentStore;

const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_MEMBER_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_SOURCES: usize = 4096;

fn hash_text(value: &str) -> String {
    hex_lower(&Sha256::digest(value.as_bytes()))
}

fn safe_zip_member(value: &str) -> bool {
    let path = value.replace('\\', "/");
    !path.starts_with('/')
        && !path.contains([':', '\0'])
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn sha256_reader(reader: impl Read, cumulative_bytes: &mut u64) -> Result<String, &'static str> {
    let mut bounded = reader.take(MAX_MEMBER_BYTES + 1);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut member_bytes = 0u64;
    loop {
        let count = bounded.read(&mut buf).map_err(|_| "unreadable")?;
        if count == 0 {
            break;
        }
        member_bytes = member_bytes.saturating_add(count as u64);
        if member_bytes > MAX_MEMBER_BYTES {
            return Err("member_too_large");
        }
        *cumulative_bytes = cumulative_bytes.saturating_add(count as u64);
        if *cumulative_bytes > MAX_TOTAL_BYTES {
            return Err("archive_too_large");
        }
        hasher.update(&buf[..count]);
    }
    Ok(format!("sha256:{}", hex_lower(&hasher.finalize())))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum VerifiedCopy {
    Missing,
    ContentChanged,
    Verified,
}

struct CopyVerifier<'a> {
    presence: PresenceCheck,
    cache: HashMap<String, VerifiedCopy>,
    copies_by_id: HashMap<&'a str, &'a LibraryCopyEvidence>,
}

impl<'a> CopyVerifier<'a> {
    fn new(root: &Path, copies: &'a [&'a LibraryCopyEvidence]) -> Self {
        let copies_by_id = copies
            .iter()
            .map(|copy| (copy.copy.copy_id.as_str(), *copy))
            .collect();
        Self {
            presence: PresenceCheck::new(root),
            cache: HashMap::new(),
            copies_by_id,
        }
    }

    fn check(&mut self, copy: &LibraryCopyEvidence) -> VerifiedCopy {
        if let Some(cached) = self.cache.get(&copy.copy.copy_id) {
            return *cached;
        }
        let path = Path::new(&copy.copy.stored_path);
        let outcome = match fs::symlink_metadata(path) {
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => VerifiedCopy::Missing,
            Err(_) => VerifiedCopy::Missing,
            Ok(meta) if !meta.file_type().is_file() || is_reparse(&meta) => VerifiedCopy::Missing,
            Ok(_) => match self.presence.presence(copy) {
                "present" => match sha256_file(path) {
                    Ok(digest)
                        if format!("sha256:{}", hex_lower(&digest))
                            == copy.copy.artifact_sha256 =>
                    {
                        VerifiedCopy::Verified
                    }
                    Ok(_) => VerifiedCopy::ContentChanged,
                    Err(_) => VerifiedCopy::Missing,
                },
                "changed" => VerifiedCopy::ContentChanged,
                _ => VerifiedCopy::Missing,
            },
        };
        self.cache.insert(copy.copy.copy_id.clone(), outcome);
        outcome
    }

    fn parent_zip_copy(
        &self,
        copy: &LibraryCopyEvidence,
    ) -> Option<(&'a LibraryCopyEvidence, String)> {
        let rest = copy.copy.relative_path.strip_prefix("expanded/")?;
        let (zip_copy_id, member_norm) = rest.split_once('/')?;
        let parent = self.copies_by_id.get(zip_copy_id).copied()?;
        if parent.copy.warehouse_item_id != copy.copy.warehouse_item_id
            || parent.copy.role.name() != "original"
            || !Path::new(&parent.copy.stored_path)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
        {
            return None;
        }
        Some((parent, member_norm.to_owned()))
    }
}

#[derive(Clone)]
struct ResolvedSource {
    source_id: String,
    item_id: String,
    item_name: String,
    name: String,
    product_ids: Vec<String>,
    selection_indices: BTreeSet<usize>,
}

fn upsert_source(
    sources: &mut BTreeMap<String, ResolvedSource>,
    source_id: String,
    item_id: &str,
    item_name: &str,
    name: String,
    product_ids: &[String],
    selection_index: usize,
) {
    let entry = sources
        .entry(source_id.clone())
        .or_insert_with(|| ResolvedSource {
            source_id,
            item_id: item_id.to_owned(),
            item_name: item_name.to_owned(),
            name,
            product_ids: product_ids.to_vec(),
            selection_indices: BTreeSet::new(),
        });
    entry.selection_indices.insert(selection_index);
}

/// Resolves every copy row in `copies` that supplies a production Recipe v0.4/v0.5 material.
pub(crate) fn production_material_matching_copies<'a>(
    root: &Path,
    copies: &'a [LibraryCopyEvidence],
    material: &vua_orchestrator::amf_recipe::RecipeMaterial,
) -> Vec<&'a LibraryCopyEvidence> {
    let expected = format!("sha256:{}", material.sha256);
    let mut matched_ids = HashSet::<String>::new();
    for copy in copies {
        if copy.copy.artifact_sha256 == expected {
            matched_ids.insert(copy.copy.copy_id.clone());
            if let Some(rest) = copy.copy.relative_path.strip_prefix("expanded/") {
                if let Some((zip_copy_id, _)) = rest.split_once('/') {
                    for candidate in copies {
                        if candidate.copy.copy_id == zip_copy_id
                            && candidate.copy.warehouse_item_id == copy.copy.warehouse_item_id
                        {
                            matched_ids.insert(candidate.copy.copy_id.clone());
                        }
                    }
                }
            }
        }
    }
    for copy in copies {
        if matched_ids.contains(&copy.copy.copy_id) || copy.copy.role.name() != "original" {
            continue;
        }
        let path = Path::new(&copy.copy.stored_path);
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
            || presence(root, copy) != "present"
        {
            continue;
        }
        let Ok(file) = File::open(path) else {
            continue;
        };
        let Ok(mut archive) = zip::ZipArchive::new(file) else {
            continue;
        };
        if archive.len() > MAX_ARCHIVE_ENTRIES {
            continue;
        }
        let mut archive_bytes = 0u64;
        for idx in 0..archive.len() {
            let Ok(inner) = archive.by_index(idx) else {
                continue;
            };
            let Ok(member) = inner.name().map(|name| name.into_owned()) else {
                continue;
            };
            if inner.is_dir()
                || !safe_zip_member(&member)
                || member.replace('\\', "/").rsplit('/').next()
                    != Some(material.package_name.as_str())
            {
                continue;
            }
            if sha256_reader(inner, &mut archive_bytes).ok().as_deref() == Some(expected.as_str()) {
                matched_ids.insert(copy.copy.copy_id.clone());
                break;
            }
            if archive_bytes > MAX_TOTAL_BYTES {
                break;
            }
        }
    }
    if matched_ids.is_empty() {
        if let Some(product_id) = &material.booth_product_id {
            for copy in copies {
                if copy.copy.role.name() == "original"
                    && copy.product_ids.iter().any(|p| {
                        p == product_id || p.strip_prefix("booth:") == Some(product_id.as_str())
                    })
                {
                    matched_ids.insert(copy.copy.copy_id.clone());
                }
            }
        }
    }
    copies
        .iter()
        .filter(|copy| matched_ids.contains(&copy.copy.copy_id))
        .collect()
}

/// Resolves verified on-disk package sources for a saved selection draft without inferring roles.
pub fn draft_materials_for_line(
    bdl: &BdlStore,
    root: &Path,
    drafts: &RecipeSelectionDrafts,
    params: Value,
) -> Result<Value, DraftError> {
    let draft = drafts.apply("recipeDraft.get", params)?;
    let selections = draft["document"]["selections"]
        .as_array()
        .ok_or(DraftError("store_failed"))?;
    let entries = bdl
        .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
        .map_err(|_| DraftError("store_failed"))?;
    let removed = bdl
        .removed_local_entries()
        .map_err(|_| DraftError("store_failed"))?;
    let entry_names: HashMap<String, String> = entries
        .into_iter()
        .filter(|entry| !removed.contains(&entry.warehouse_item_id))
        .map(|entry| (entry.warehouse_item_id, entry.display_name))
        .collect();
    let all_copies = bdl
        .library_copy_evidence()
        .map_err(|_| DraftError("store_failed"))?;
    let active_copies: Vec<&LibraryCopyEvidence> = all_copies
        .iter()
        .filter(|copy| {
            copy.copy.role.name() == "original"
                && entry_names.contains_key(&copy.copy.warehouse_item_id)
        })
        .collect();

    let mut verifier = CopyVerifier::new(root, &active_copies);
    let mut sources: BTreeMap<String, ResolvedSource> = BTreeMap::new();
    let mut missing = Vec::new();

    for (sel_idx, selection) in selections.iter().enumerate() {
        let is_cloud = selection["source"] == "cloud";
        let identity = selection["identity"]
            .as_str()
            .ok_or(DraftError("store_failed"))?;
        let filter_item_id = selection["warehouseItemId"].as_str();

        let mut matching: Vec<&LibraryCopyEvidence> = active_copies
            .iter()
            .copied()
            .filter(|copy| {
                if is_cloud {
                    copy.product_ids.iter().any(|product| product == identity)
                } else {
                    copy.copy.artifact_sha256 == identity
                        && filter_item_id.is_none_or(|id| id == copy.copy.warehouse_item_id)
                }
            })
            .collect();

        // If a local selection names a package hash inside an unexpanded ZIP entry, inspect that entry's ZIP copies.
        let mut unexpanded_zip_candidates: Vec<&LibraryCopyEvidence> = Vec::new();
        if !is_cloud && matching.is_empty() {
            unexpanded_zip_candidates = active_copies
                .iter()
                .copied()
                .filter(|copy| {
                    filter_item_id.is_none_or(|id| id == copy.copy.warehouse_item_id)
                        && Path::new(&copy.copy.stored_path)
                            .extension()
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
                })
                .collect();
        }

        if matching.is_empty() && unexpanded_zip_candidates.is_empty() {
            missing.push(json!({"index": sel_idx, "reason": "not_stored"}));
            continue;
        }

        let mut matched_any_source = false;
        let mut saw_changed = false;
        let mut saw_verified_non_package = false;

        if is_cloud {
            // Skip expanded/<zip_copy>/<member> duplicates when <zip_copy> exists on disk as a regular file,
            // matching NativeAmfProduction::sources() drop_expanded_duplicates behavior.
            matching.retain(|copy| {
                verifier.parent_zip_copy(copy).is_none_or(|(parent, _)| {
                    !fs::symlink_metadata(&parent.copy.stored_path)
                        .is_ok_and(|meta| meta.file_type().is_file() && !is_reparse(&meta))
                })
            });
        }

        for copy in matching {
            let item_name = &entry_names[&copy.copy.warehouse_item_id];
            if !is_cloud {
                if let Some((parent_zip, member_norm)) = verifier.parent_zip_copy(copy) {
                    let parent_meta = fs::symlink_metadata(&parent_zip.copy.stored_path);
                    let parent_on_disk = parent_meta
                        .as_ref()
                        .is_ok_and(|meta| meta.file_type().is_file() && !is_reparse(meta));
                    if parent_on_disk {
                        match verifier.check(parent_zip) {
                            VerifiedCopy::ContentChanged => {
                                saw_changed = true;
                                continue;
                            }
                            VerifiedCopy::Missing => continue,
                            VerifiedCopy::Verified => {
                                let Ok(file) = File::open(&parent_zip.copy.stored_path) else {
                                    continue;
                                };
                                let Ok(mut archive) = zip::ZipArchive::new(file) else {
                                    saw_changed = true;
                                    continue;
                                };
                                if archive.len() > MAX_ARCHIVE_ENTRIES {
                                    return Err(DraftError("archive_too_large"));
                                }
                                let mut archive_bytes = 0u64;
                                let mut member_found = false;
                                for idx in 0..archive.len() {
                                    let inner = archive
                                        .by_index(idx)
                                        .map_err(|_| DraftError("store_failed"))?;
                                    let Ok(raw_member) = inner.name().map(|name| name.into_owned())
                                    else {
                                        saw_changed = true;
                                        continue;
                                    };
                                    if inner.is_dir()
                                        || !safe_zip_member(&raw_member)
                                        || raw_member.replace('\\', "/") != member_norm
                                    {
                                        continue;
                                    }
                                    member_found = true;
                                    if !member_norm.to_ascii_lowercase().ends_with(".unitypackage")
                                    {
                                        if sha256_reader(inner, &mut archive_bytes).ok().as_deref()
                                            == Some(identity)
                                        {
                                            saw_verified_non_package = true;
                                        } else {
                                            saw_changed = true;
                                        }
                                        break;
                                    }
                                    match sha256_reader(inner, &mut archive_bytes) {
                                        Ok(digest) if digest == identity => {
                                            let source_id = format!(
                                                "{}-{}",
                                                parent_zip.copy.copy_id,
                                                &hash_text(&raw_member)[..24]
                                            );
                                            upsert_source(
                                                &mut sources,
                                                source_id,
                                                &parent_zip.copy.warehouse_item_id,
                                                item_name,
                                                member_norm.clone(),
                                                &parent_zip.product_ids,
                                                sel_idx,
                                            );
                                            matched_any_source = true;
                                        }
                                        Ok(_) => saw_changed = true,
                                        Err("member_too_large" | "archive_too_large") => {
                                            return Err(DraftError("archive_too_large"));
                                        }
                                        Err(_) => {}
                                    }
                                    break;
                                }
                                if !member_found {
                                    saw_changed = true;
                                }
                                continue;
                            }
                        }
                    }
                }
            }

            match verifier.check(copy) {
                VerifiedCopy::Missing => continue,
                VerifiedCopy::ContentChanged => {
                    saw_changed = true;
                    continue;
                }
                VerifiedCopy::Verified => {}
            }

            let path = Path::new(&copy.copy.stored_path);
            if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("unitypackage"))
            {
                upsert_source(
                    &mut sources,
                    copy.copy.copy_id.clone(),
                    &copy.copy.warehouse_item_id,
                    item_name,
                    copy.copy.relative_path.clone(),
                    &copy.product_ids,
                    sel_idx,
                );
                matched_any_source = true;
            } else if path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
            {
                let Ok(file) = File::open(path) else {
                    continue;
                };
                let Ok(mut archive) = zip::ZipArchive::new(file) else {
                    saw_changed = true;
                    continue;
                };
                if archive.len() > MAX_ARCHIVE_ENTRIES {
                    return Err(DraftError("archive_too_large"));
                }
                let mut archive_bytes = 0u64;
                let mut archive_had_package = false;
                for idx in 0..archive.len() {
                    let inner = archive
                        .by_index(idx)
                        .map_err(|_| DraftError("store_failed"))?;
                    let Ok(raw_member) = inner.name().map(|name| name.into_owned()) else {
                        saw_changed = true;
                        continue;
                    };
                    if inner.is_dir()
                        || !raw_member.to_ascii_lowercase().ends_with(".unitypackage")
                        || !safe_zip_member(&raw_member)
                    {
                        continue;
                    }
                    match sha256_reader(inner, &mut archive_bytes) {
                        Ok(_) => {}
                        Err("member_too_large" | "archive_too_large") => {
                            return Err(DraftError("archive_too_large"));
                        }
                        Err(_) => {
                            saw_changed = true;
                            continue;
                        }
                    }
                    archive_had_package = true;
                    let source_id =
                        format!("{}-{}", copy.copy.copy_id, &hash_text(&raw_member)[..24]);
                    upsert_source(
                        &mut sources,
                        source_id,
                        &copy.copy.warehouse_item_id,
                        item_name,
                        raw_member.replace('\\', "/"),
                        &copy.product_ids,
                        sel_idx,
                    );
                    matched_any_source = true;
                }
                if !archive_had_package {
                    saw_verified_non_package = true;
                }
            } else {
                saw_verified_non_package = true;
            }
        }

        if !matched_any_source && !unexpanded_zip_candidates.is_empty() {
            let mut found_in_unexpanded = false;
            for zip_copy in unexpanded_zip_candidates {
                if verifier.check(zip_copy) != VerifiedCopy::Verified {
                    continue;
                }
                let Ok(file) = File::open(&zip_copy.copy.stored_path) else {
                    continue;
                };
                let Ok(mut archive) = zip::ZipArchive::new(file) else {
                    continue;
                };
                if archive.len() > MAX_ARCHIVE_ENTRIES {
                    return Err(DraftError("archive_too_large"));
                }
                let mut archive_bytes = 0u64;
                let item_name = &entry_names[&zip_copy.copy.warehouse_item_id];
                for idx in 0..archive.len() {
                    let Ok(inner) = archive.by_index(idx) else {
                        continue;
                    };
                    let Ok(raw_member) = inner.name().map(|name| name.into_owned()) else {
                        continue;
                    };
                    if inner.is_dir()
                        || !raw_member.to_ascii_lowercase().ends_with(".unitypackage")
                        || !safe_zip_member(&raw_member)
                    {
                        continue;
                    }
                    match sha256_reader(inner, &mut archive_bytes) {
                        Ok(digest) if digest == identity => {
                            let source_id = format!(
                                "{}-{}",
                                zip_copy.copy.copy_id,
                                &hash_text(&raw_member)[..24]
                            );
                            upsert_source(
                                &mut sources,
                                source_id,
                                &zip_copy.copy.warehouse_item_id,
                                item_name,
                                raw_member.replace('\\', "/"),
                                &zip_copy.product_ids,
                                sel_idx,
                            );
                            matched_any_source = true;
                            found_in_unexpanded = true;
                        }
                        Err("member_too_large" | "archive_too_large") => {
                            return Err(DraftError("archive_too_large"));
                        }
                        _ => {}
                    }
                }
            }
            if !found_in_unexpanded {
                missing.push(json!({"index": sel_idx, "reason": "not_stored"}));
                continue;
            }
        }

        if !matched_any_source {
            let reason = if saw_changed {
                "content_changed"
            } else if saw_verified_non_package {
                "no_package"
            } else {
                "missing"
            };
            missing.push(json!({"index": sel_idx, "reason": reason}));
        }
    }

    let mut ordered_sources: Vec<ResolvedSource> = sources.into_values().collect();
    ordered_sources.sort_by(|a, b| {
        (&a.item_name, &a.name, &a.source_id).cmp(&(&b.item_name, &b.name, &b.source_id))
    });
    if ordered_sources.len() > MAX_SOURCES {
        return Err(DraftError("library_too_large"));
    }

    let sources_json: Vec<Value> = ordered_sources
        .into_iter()
        .map(|source| {
            json!({
                "sourceId": source.source_id,
                "itemId": source.item_id,
                "itemName": source.item_name,
                "name": source.name,
                "productIds": source.product_ids,
                "selectionIndices": source.selection_indices.into_iter().collect::<Vec<_>>(),
            })
        })
        .collect();

    Ok(json!({
        "schemaVersion": "0.1",
        "draftId": draft["document"]["draftId"],
        "revision": draft["revision"],
        "sources": sources_json,
        "missing": missing,
    }))
}

fn target_draft_id_for_legacy(recipe_id: &str) -> String {
    if recipe_id.len() <= 93
        && recipe_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        format!("recipe-draft-legacy-{recipe_id}")
    } else {
        format!("recipe-draft-legacy-{}", &hash_text(recipe_id)[..32])
    }
}

fn bounded_text(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    trimmed.chars().take(max_chars).collect()
}

fn non_empty_array_or_object(value: &Value) -> bool {
    value.as_array().is_some_and(|arr| !arr.is_empty())
        || value.as_object().is_some_and(|obj| !obj.is_empty())
}

struct LegacyInspection {
    recipe_id: String,
    target_draft_id: String,
    parseable: bool,
    revision: Option<u64>,
    format_version: Option<String>,
    title: String,
    selections: Vec<Value>,
    unresolved_assets: Vec<Value>,
    has_graph_settings: bool,
}

fn inspect_legacy_store(
    bdl: &BdlStore,
    warehouse_root: &Path,
    legacy_recipes: &RecipeDocumentStore,
) -> Result<Vec<LegacyInspection>, DraftError> {
    let mut raw_files = Vec::new();
    match fs::read_dir(legacy_recipes.root()) {
        Ok(dir) => {
            for entry in dir {
                let entry = entry.map_err(|_| DraftError("store_failed"))?;
                let file_name = entry.file_name().to_string_lossy().into_owned();
                let Some(stem) = file_name.strip_suffix(".json") else {
                    continue;
                };
                if stem.starts_with('.') {
                    continue;
                }
                if stem.is_empty()
                    || stem.len() > 128
                    || !stem
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                {
                    return Err(DraftError("store_failed"));
                }
                raw_files.push((stem.to_owned(), entry.path()));
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(DraftError("store_failed")),
    }
    raw_files.sort_by(|a, b| a.0.cmp(&b.0));

    let entries = bdl
        .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)
        .map_err(|_| DraftError("store_failed"))?;
    let removed = bdl
        .removed_local_entries()
        .map_err(|_| DraftError("store_failed"))?;
    let entry_names: HashMap<String, String> = entries
        .into_iter()
        .filter(|entry| !removed.contains(&entry.warehouse_item_id))
        .map(|entry| (entry.warehouse_item_id, entry.display_name))
        .collect();
    let all_copies = bdl
        .library_copy_evidence()
        .map_err(|_| DraftError("store_failed"))?;
    let active_copies: Vec<&LibraryCopyEvidence> = all_copies
        .iter()
        .filter(|copy| entry_names.contains_key(&copy.copy.warehouse_item_id))
        .collect();
    let mut verifier = CopyVerifier::new(warehouse_root, &active_copies);

    let mut results = Vec::with_capacity(raw_files.len());
    for (recipe_id, file_path) in raw_files {
        let target_draft_id = target_draft_id_for_legacy(&recipe_id);
        let Ok(bytes) = fs::read(&file_path) else {
            return Err(DraftError("store_failed"));
        };
        let Ok(stored) = serde_json::from_slice::<vua_orchestrator::StoredRecipeDocument>(&bytes)
        else {
            results.push(LegacyInspection {
                title: bounded_text(&recipe_id, 120),
                recipe_id,
                target_draft_id,
                parseable: false,
                revision: None,
                format_version: None,
                selections: Vec::new(),
                unresolved_assets: vec![
                    json!({"assetId": "document", "reason": "unparseable_document"}),
                ],
                has_graph_settings: false,
            });
            continue;
        };

        let format_version = stored
            .recipe
            .get("formatVersion")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let revision = (stored.revision > 0 && stored.revision <= 9_007_199_254_740_991)
            .then_some(stored.revision);
        let raw_title = stored
            .recipe
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(&recipe_id);
        let title = {
            let clean = bounded_text(raw_title, 120);
            if clean.is_empty() {
                bounded_text(&recipe_id, 120)
            } else {
                clean
            }
        };
        let has_graph_settings = [
            "instances",
            "relations",
            "wardrobeGroups",
            "dependencies",
            "locked",
            "extensions",
        ]
        .iter()
        .any(|key| {
            stored
                .recipe
                .get(*key)
                .is_some_and(non_empty_array_or_object)
        });

        if format_version.as_deref() != Some("0.3") || revision.is_none() {
            results.push(LegacyInspection {
                recipe_id,
                target_draft_id,
                parseable: false,
                revision,
                format_version,
                title,
                selections: Vec::new(),
                unresolved_assets: vec![
                    json!({"assetId": "document", "reason": "unsupported_version"}),
                ],
                has_graph_settings,
            });
            continue;
        }

        let Some(assets) = stored.recipe.get("assets").and_then(Value::as_array) else {
            results.push(LegacyInspection {
                recipe_id,
                target_draft_id,
                parseable: false,
                revision,
                format_version,
                title,
                selections: Vec::new(),
                unresolved_assets: vec![
                    json!({"assetId": "document", "reason": "unparseable_document"}),
                ],
                has_graph_settings,
            });
            continue;
        };

        let mut selections = Vec::new();
        let mut seen_keys = HashSet::<(String, String, Option<String>, Option<String>)>::new();
        let mut unresolved_assets = Vec::new();

        for (asset_idx, asset) in assets.iter().enumerate() {
            let asset_id = asset
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty())
                .map(|id| bounded_text(id, 64))
                .unwrap_or_else(|| format!("asset-{}", asset_idx + 1));
            let explicit_label = asset
                .get("label")
                .and_then(Value::as_str)
                .map(|s| bounded_text(s, 512))
                .filter(|s| !s.is_empty());
            let variant_name = asset
                .get("selection")
                .and_then(|sel| {
                    sel.get("distributionLabel")
                        .and_then(Value::as_str)
                        .or_else(|| sel.get("releaseLabel").and_then(Value::as_str))
                })
                .map(|s| bounded_text(s, 512))
                .filter(|s| !s.is_empty());

            let Some(source_ref) = asset.get("sourceRef").and_then(Value::as_object) else {
                unresolved_assets.push(json!({"assetId": asset_id, "reason": "entity_only"}));
                continue;
            };

            if let Some(provider) = source_ref.get("provider").and_then(Value::as_str) {
                if provider != "booth" {
                    unresolved_assets
                        .push(json!({"assetId": asset_id, "reason": "unsupported_provider"}));
                    continue;
                }
                let raw_product = source_ref
                    .get("productId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let digits = raw_product.strip_prefix("booth:").unwrap_or(raw_product);
                if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                    unresolved_assets
                        .push(json!({"assetId": asset_id, "reason": "invalid_product_id"}));
                    continue;
                }
                let booth_id = format!("booth:{digits}");
                let catalog_detail = bdl.catalog_detail(&booth_id).ok().flatten();
                let display_name = explicit_label
                    .or_else(|| {
                        catalog_detail
                            .as_ref()
                            .and_then(|d| d.product.title.as_deref())
                            .map(|title| bounded_text(title, 512))
                            .filter(|s| !s.is_empty())
                    })
                    .unwrap_or_else(|| booth_id.clone());
                let shop_name = catalog_detail
                    .as_ref()
                    .and_then(|d| d.product.shop_name.as_deref())
                    .map(|s| bounded_text(s, 512))
                    .filter(|s| !s.is_empty());
                let key = (
                    "cloud".to_owned(),
                    booth_id.clone(),
                    variant_name.clone(),
                    None,
                );
                if seen_keys.insert(key) && selections.len() < 512 {
                    selections.push(json!({
                        "identity": booth_id,
                        "displayName": display_name,
                        "source": "cloud",
                        "variantName": variant_name,
                        "shopName": shop_name,
                        "warehouseItemId": Value::Null,
                    }));
                }
            } else if let Some(item_id) = source_ref.get("warehouseItemId").and_then(Value::as_str)
            {
                let valid_item = !item_id.is_empty()
                    && item_id.len() <= 128
                    && item_id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c));
                if !valid_item || !entry_names.contains_key(item_id) {
                    unresolved_assets
                        .push(json!({"assetId": asset_id, "reason": "entry_not_found"}));
                    continue;
                }
                let requested_role = source_ref
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("original");
                let mut item_copies: Vec<&LibraryCopyEvidence> = active_copies
                    .iter()
                    .copied()
                    .filter(|copy| {
                        copy.copy.warehouse_item_id == item_id
                            && copy.copy.role.name() == requested_role
                    })
                    .collect();
                // Omit expanded/<zip_copy>/... rows when parent <zip_copy> is present in the same entry.
                item_copies.retain(|copy| {
                    verifier.parent_zip_copy(copy).is_none_or(|(parent, _)| {
                        !fs::symlink_metadata(&parent.copy.stored_path)
                            .is_ok_and(|meta| meta.file_type().is_file() && !is_reparse(&meta))
                    })
                });
                if item_copies.is_empty() {
                    unresolved_assets
                        .push(json!({"assetId": asset_id, "reason": "missing_local_copy"}));
                    continue;
                }
                let display_name =
                    explicit_label.unwrap_or_else(|| bounded_text(&entry_names[item_id], 512));
                let mut verified_any = false;
                let mut saw_changed = false;
                for copy in item_copies {
                    match verifier.check(copy) {
                        VerifiedCopy::Verified => {
                            verified_any = true;
                            let key = (
                                "local".to_owned(),
                                copy.copy.artifact_sha256.clone(),
                                variant_name.clone(),
                                Some(item_id.to_owned()),
                            );
                            if seen_keys.insert(key) && selections.len() < 512 {
                                selections.push(json!({
                                    "identity": copy.copy.artifact_sha256,
                                    "displayName": display_name,
                                    "source": "local",
                                    "variantName": variant_name,
                                    "shopName": Value::Null,
                                    "warehouseItemId": item_id,
                                }));
                            }
                        }
                        VerifiedCopy::ContentChanged => saw_changed = true,
                        VerifiedCopy::Missing => {}
                    }
                }
                if !verified_any {
                    unresolved_assets.push(json!({
                        "assetId": asset_id,
                        "reason": if saw_changed { "content_changed" } else { "missing_local_copy" }
                    }));
                }
            } else {
                unresolved_assets.push(json!({"assetId": asset_id, "reason": "entity_only"}));
            }
        }

        results.push(LegacyInspection {
            recipe_id,
            target_draft_id,
            parseable: true,
            revision,
            format_version,
            title,
            selections,
            unresolved_assets,
            has_graph_settings,
        });
    }
    Ok(results)
}

type SelectionKey = (String, String, Option<String>, Option<String>);

fn existing_draft_state(
    drafts: &RecipeSelectionDrafts,
    draft_id: &str,
) -> Result<Option<(u64, HashSet<SelectionKey>)>, DraftError> {
    match drafts.apply(
        "recipeDraft.get",
        json!({"schemaVersion": "0.1", "draftId": draft_id}),
    ) {
        Ok(read) => {
            let revision = read["revision"]
                .as_u64()
                .ok_or(DraftError("store_failed"))?;
            let keys = read["document"]["selections"]
                .as_array()
                .ok_or(DraftError("store_failed"))?
                .iter()
                .map(|sel| {
                    (
                        sel["source"].as_str().unwrap_or("").to_owned(),
                        sel["identity"].as_str().unwrap_or("").to_owned(),
                        sel["variantName"].as_str().map(str::to_owned),
                        sel["warehouseItemId"].as_str().map(str::to_owned),
                    )
                })
                .collect();
            Ok(Some((revision, keys)))
        }
        Err(DraftError("draft_not_found")) => Ok(None),
        Err(other) => Err(other),
    }
}

/// Read-only census of legacy Recipe v0.3 documents and their non-destructive draft migration status.
pub fn legacy_recipe_census(
    bdl: &BdlStore,
    warehouse_root: &Path,
    drafts: &RecipeSelectionDrafts,
    legacy_recipes: Option<&RecipeDocumentStore>,
    params: Value,
) -> Result<Value, DraftError> {
    if params != json!({"schemaVersion": "0.1"}) {
        return Err(DraftError("invalid_params"));
    }
    let Some(legacy_recipes) = legacy_recipes else {
        return Err(DraftError("unavailable"));
    };
    let inspections = inspect_legacy_store(bdl, warehouse_root, legacy_recipes)?;
    let mut parseable_documents = 0usize;
    let mut migrated_drafts = 0usize;
    let mut documents = Vec::with_capacity(inspections.len());
    for item in inspections {
        if item.parseable {
            parseable_documents += 1;
        }
        let existing_revision =
            existing_draft_state(drafts, &item.target_draft_id)?.map(|(rev, _)| rev);
        if existing_revision.is_some() {
            migrated_drafts += 1;
        }
        documents.push(json!({
            "recipeId": item.recipe_id,
            "revision": item.revision,
            "formatVersion": item.format_version,
            "parseable": item.parseable,
            "targetDraftId": item.target_draft_id,
            "existingDraftRevision": existing_revision,
            "verifiableSelections": item.selections.len(),
            "unresolvedAssets": item.unresolved_assets,
            "hasGraphSettings": item.has_graph_settings,
        }));
    }
    Ok(json!({
        "schemaVersion": "0.1",
        "totalDocuments": documents.len(),
        "parseableDocuments": parseable_documents,
        "migratedDrafts": migrated_drafts,
        "documents": documents,
    }))
}

/// Idempotent non-destructive migration of verifiable material references from legacy Recipe v0.3 documents into selection drafts.
pub fn migrate_legacy_recipes(
    bdl: &BdlStore,
    warehouse_root: &Path,
    drafts: &RecipeSelectionDrafts,
    legacy_recipes: Option<&RecipeDocumentStore>,
    params: Value,
) -> Result<Value, DraftError> {
    if params != json!({"schemaVersion": "0.1"}) {
        return Err(DraftError("invalid_params"));
    }
    let Some(legacy_recipes) = legacy_recipes else {
        return Err(DraftError("unavailable"));
    };
    let inspections = inspect_legacy_store(bdl, warehouse_root, legacy_recipes)?;
    let mut migrated_count = 0usize;
    let mut unchanged_count = 0usize;
    let mut unresolved_only_count = 0usize;
    let mut failed_count = 0usize;
    let mut items = Vec::with_capacity(inspections.len());

    for item in inspections {
        if !item.parseable {
            failed_count += 1;
            items.push(json!({
                "recipeId": item.recipe_id,
                "targetDraftId": item.target_draft_id,
                "status": "failed",
                "draftRevision": Value::Null,
                "migratedSelections": 0,
                "unresolvedAssets": item.unresolved_assets,
                "hasGraphSettings": item.has_graph_settings,
            }));
            continue;
        }

        let existing = existing_draft_state(drafts, &item.target_draft_id)?;
        if item.selections.is_empty() {
            if let Some((rev, _)) = existing {
                unchanged_count += 1;
                items.push(json!({
                    "recipeId": item.recipe_id,
                    "targetDraftId": item.target_draft_id,
                    "status": "unchanged",
                    "draftRevision": rev,
                    "migratedSelections": 0,
                    "unresolvedAssets": item.unresolved_assets,
                    "hasGraphSettings": item.has_graph_settings,
                }));
            } else {
                unresolved_only_count += 1;
                items.push(json!({
                    "recipeId": item.recipe_id,
                    "targetDraftId": item.target_draft_id,
                    "status": "unresolved_only",
                    "draftRevision": Value::Null,
                    "migratedSelections": 0,
                    "unresolvedAssets": item.unresolved_assets,
                    "hasGraphSettings": item.has_graph_settings,
                }));
            }
            continue;
        }

        match existing {
            None => {
                let saved = drafts.apply(
                    "recipeDraft.save",
                    json!({
                        "schemaVersion": "0.1",
                        "draftId": item.target_draft_id,
                        "title": item.title,
                        "baseRevision": 0,
                        "selections": item.selections,
                    }),
                )?;
                migrated_count += 1;
                items.push(json!({
                    "recipeId": item.recipe_id,
                    "targetDraftId": item.target_draft_id,
                    "status": "created",
                    "draftRevision": saved["revision"],
                    "migratedSelections": item.selections.len(),
                    "unresolvedAssets": item.unresolved_assets,
                    "hasGraphSettings": item.has_graph_settings,
                }));
            }
            Some((current_rev, existing_keys)) => {
                let new_selections: Vec<Value> = item
                    .selections
                    .iter()
                    .filter(|sel| {
                        let key = (
                            sel["source"].as_str().unwrap_or("").to_owned(),
                            sel["identity"].as_str().unwrap_or("").to_owned(),
                            sel["variantName"].as_str().map(str::to_owned),
                            sel["warehouseItemId"].as_str().map(str::to_owned),
                        );
                        !existing_keys.contains(&key)
                    })
                    .cloned()
                    .collect();
                if new_selections.is_empty() {
                    unchanged_count += 1;
                    items.push(json!({
                        "recipeId": item.recipe_id,
                        "targetDraftId": item.target_draft_id,
                        "status": "unchanged",
                        "draftRevision": current_rev,
                        "migratedSelections": item.selections.len(),
                        "unresolvedAssets": item.unresolved_assets,
                        "hasGraphSettings": item.has_graph_settings,
                    }));
                } else {
                    let updated = drafts.apply(
                        "recipeDraft.addSelection",
                        json!({
                            "schemaVersion": "0.1",
                            "draftId": item.target_draft_id,
                            "baseRevision": current_rev,
                            "selections": new_selections,
                        }),
                    )?;
                    migrated_count += 1;
                    items.push(json!({
                        "recipeId": item.recipe_id,
                        "targetDraftId": item.target_draft_id,
                        "status": "updated",
                        "draftRevision": updated["revision"],
                        "migratedSelections": item.selections.len(),
                        "unresolvedAssets": item.unresolved_assets,
                        "hasGraphSettings": item.has_graph_settings,
                    }));
                }
            }
        }
    }

    Ok(json!({
        "schemaVersion": "0.1",
        "totalDocuments": items.len(),
        "migratedCount": migrated_count,
        "unchangedCount": unchanged_count,
        "unresolvedOnlyCount": unresolved_only_count,
        "failedCount": failed_count,
        "items": items,
    }))
}

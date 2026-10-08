//! AMF's library read model. Historical mappings never prove current file presence.
use crate::library_download::{LibraryDownloadError, LibraryDownloadService};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use vua_bdl_store::{ArtifactMode, BdlStore, CopyRole, LibraryCopyEvidence};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Query {
    schema_version: String,
    #[serde(default = "all")]
    source: String,
    #[serde(default = "all")]
    state: String,
    #[serde(default)]
    text: String,
    availability_status: Option<String>,
    #[serde(default = "limit")]
    limit: usize,
    #[serde(default)]
    offset: usize,
}
fn all() -> String {
    "all".into()
}
fn limit() -> usize {
    50
}

pub(crate) fn presence(root: &Path, evidence: &LibraryCopyEvidence) -> &'static str {
    let path = Path::new(&evidence.copy.stored_path);
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return "missing",
        Err(_) => return "unreadable",
    };
    if !meta.file_type().is_file() {
        return "unreadable";
    }
    let inside = std::fs::canonicalize(root)
        .ok()
        .zip(std::fs::canonicalize(path).ok())
        .is_some_and(|(root, path)| path.starts_with(root));
    if !inside {
        return "unreadable";
    }
    if meta.len() != evidence.size_bytes {
        return "changed";
    }
    // Presence is a metadata check. Production must recheck the selected hash.
    "present"
}

fn storage(copies: &[&LibraryCopyEvidence], presences: &HashMap<String, &'static str>) -> Value {
    let count = |word| {
        copies
            .iter()
            .filter(|copy| presences[&copy.copy.copy_id] == word)
            .count()
    };
    let present = count("present");
    let missing = count("missing");
    let changed = count("changed");
    let unreadable = count("unreadable");
    let state = if copies.is_empty() {
        "cloud_only"
    } else if unreadable > 0 {
        "unreadable"
    } else if changed > 0 {
        "changed"
    } else if present == copies.len() {
        "present"
    } else if present == 0 {
        "missing"
    } else {
        "partial"
    };
    let superseded = copies.iter().filter(|copy| copy.superseded).count();
    let current_generated = copies
        .iter()
        .filter(|copy| {
            copy.copy.role == CopyRole::GeneratedVpm
                && !copy.superseded
                && presences[&copy.copy.copy_id] == "present"
        })
        .count();
    let mut facts = json!({"state":state,"storedCopies":copies.len(),"presentCopies":present,"missingCopies":missing,
        "changedCopies":changed,"unreadableCopies":unreadable,"supersededGeneratedCopies":superseded,
        "currentGeneratedCopies":current_generated,"productionQualification":"not_evaluated"});
    let unexpanded = copies.iter().filter(|copy| crate::zip_intake::is_zip(&copy.copy.relative_path)
        && copy.archive_expansion_state.as_deref() != Some("expanded")).count();
    if unexpanded > 0 { facts["unexpandedArchives"] = json!(unexpanded); }
    facts
}

pub fn list(
    bdl: &BdlStore,
    root: &Path,
    global_default: ArtifactMode,
    downloads: &LibraryDownloadService,
    params: Value,
) -> Result<Value, LibraryDownloadError> {
    if params.get("availabilityStatus").is_some_and(Value::is_null) {
        return Err(LibraryDownloadError("invalid_params"));
    }
    let query: Query = serde_json::from_value(params)?;
    if query.schema_version != "0.1"
        || !["all", "local", "bought", "gifts", "free_downloads"].contains(&query.source.as_str())
        || ![
            "all",
            "downloaded",
            "cloud_only",
            "missing",
            "in_progress",
            "attention",
        ]
        .contains(&query.state.as_str())
        || query.limit == 0
        || query.limit > 200
        || query.offset > 9_007_199_254_740_991usize
        || query.text.chars().count() > 1000
        || query
            .availability_status
            .as_ref()
            .is_some_and(|word| !["available", "unavailable", "unknown"].contains(&word.as_str()))
    {
        return Err(LibraryDownloadError("invalid_params"));
    }
    let mut products = bdl.library_product_summaries()?;
    let entries = bdl.warehouse_entry_cards(global_default)?;
    let copies = bdl.library_copy_evidence()?;
    let metadata: HashMap<_, _> = bdl.library_entry_metadata_all()?.into_iter().map(|m| (m.entry_id.clone(), m)).collect();
    let explicit_sources: HashMap<_, _> = metadata.values().filter_map(|m| m.product_id.as_ref().map(|id| (m.entry_id.clone(), id.clone()))).collect();
    let mut presences = copies
        .iter()
        .map(|copy| (copy.copy.copy_id.clone(), presence(root, copy)))
        .collect();
    let mut managed_products = HashMap::new();
    for id in copies.iter().filter_map(|copy| copy.downloadable_id) {
        if let Some(product) = bdl.product_of_downloadable(id)? {
            managed_products.insert(id, product);
        }
    }
    let grouping = crate::library_reconcile::group(
        &entries,
        &products,
        &copies,
        &managed_products,
        &mut presences,
        &downloads
            .library_content_checks
            .lock()
            .expect("library checks poisoned"),
        &explicit_sources,
    );
    let memberships: HashMap<_, _> = products
        .iter()
        .map(|p| {
            Ok((
                p.product_id.clone(),
                bdl.product_library_memberships(&p.product_id)?,
            ))
        })
        .collect::<Result<_, vua_bdl_store::BdlStoreError>>()?;
    let snapshots = downloads.library_snapshots()?;
    let mut operations = HashMap::new();
    // An active attempt takes precedence over an older terminal attempt.
    for snapshot in snapshots
        .iter()
        .filter(|s| s["state"] == "running")
        .chain(snapshots.iter().filter(|s| s["state"] != "running"))
    {
        operations
            .entry(snapshot["productId"].as_str().unwrap_or("").to_owned())
            .or_insert(snapshot.clone());
    }
    let mut rows = Vec::new();
    for product in &mut products {
        let attached: Vec<_> = copies
            .iter()
            .filter(|copy| {
                grouping
                    .assignments
                    .get(&copy.copy.copy_id)
                    .is_some_and(|ids| ids.contains(&product.product_id))
            })
            .collect();
        let facts = storage(&attached, &presences);
        if attached.is_empty() && memberships[&product.product_id].is_empty() { continue; }
        // Compatibility projection: this new face counts present physical copies,
        // while the frozen catalog face retains its historical mapping count.
        product.imported_artifacts = facts["presentCopies"].as_u64().unwrap_or(0) as u32;
        rows.push(json!({"kind":"product","product":product,"sources":memberships[&product.product_id],
            "storage":facts,"copyIds":attached.iter().map(|c|&c.copy.copy_id).collect::<Vec<_>>(),"operation":operations.remove(&product.product_id)}));
        let local_entries: Vec<_> = entries.iter().filter(|entry| entry.kind == "imported_material" && attached.iter().any(|copy| copy.copy.warehouse_item_id == entry.warehouse_item_id))
            .map(|entry| json!({"entryId":entry.warehouse_item_id,"displayName":entry.display_name})).collect();
        if !local_entries.is_empty() { rows.last_mut().expect("product row")["localEntries"] = json!(local_entries); }
    }
    for mut entry in entries {
        let unassociated: Vec<_> = copies
            .iter()
            .filter(|copy| {
                copy.copy.warehouse_item_id == entry.warehouse_item_id
                    && !grouping.assignments.contains_key(&copy.copy.copy_id)
            })
            .collect();
        if unassociated.is_empty() && !entry.artifacts.is_empty() {
            continue;
        }
        entry.artifacts.retain(|artifact| {
            unassociated.iter().any(|copy| {
                copy.copy.artifact_sha256 == artifact.artifact_sha256
                    && copy.copy.relative_path == artifact.relative_path
                    && copy.copy.role == artifact.role
            })
        });
        let hint =
            crate::library_reconcile::source_hint(&entry, &unassociated, &products, &grouping, explicit_sources.get(&entry.warehouse_item_id).map(String::as_str));
        let mut row = json!({"kind":"local","entry":entry,"storage":storage(&unassociated,&presences),
            "copyIds":unassociated.iter().map(|c|&c.copy.copy_id).collect::<Vec<_>>()});
        if let Some(metadata) = metadata.get(&entry.warehouse_item_id) { row["metadata"] = json!(metadata); }
        if let Some((basis, id, content)) = hint {
            if let Some(product) = products.iter().find(|p| p.product_id == id) {
                row["sourceMatch"] = crate::library_reconcile::hint_value(
                    product,
                    &memberships[&id],
                    basis,
                    content,
                );
            }
        }
        rows.push(row);
    }
    let needle = query.text.to_lowercase();
    rows.retain(|row| {
        let product = row["kind"] == "product";
        let sources = if product {
            row["sources"].as_array()
        } else {
            row["sourceMatch"]["sources"].as_array()
        };
        let source_match = match query.source.as_str() {
            "all" => true,
            "local" => row["storage"]["storedCopies"].as_u64().unwrap_or(0) > 0,
            kind => sources.is_some_and(|sources| sources.iter().any(|source| source == kind)),
        };
        let present = row["storage"]["presentCopies"].as_u64().unwrap_or(0);
        let state_match = match query.state.as_str() {
            "all" => true,
            "downloaded" => present > 0,
            "cloud_only" => row["storage"]["storedCopies"] == 0,
            "missing" => row["storage"]["missingCopies"].as_u64().unwrap_or(0) > 0,
            "in_progress" => row["operation"]["state"] == "running",
            _ => {
                ["partial", "missing", "changed", "unreadable"]
                    .contains(&row["storage"]["state"].as_str().unwrap_or(""))
                    || !row["operation"].is_null()
                        && ["failed", "succeeded_with_warnings"]
                            .contains(&row["operation"]["state"].as_str().unwrap_or(""))
                    || row["operation"]["recoveryDisposition"] == "inspect_required"
                    || row["storage"]["unexpandedArchives"].as_u64().unwrap_or(0) > 0
            }
        };
        let id = if product {
            &row["product"]["productId"]
        } else {
            &row["entry"]["warehouseItemId"]
        };
        let title = if product {
            &row["product"]["title"]
        } else {
            &row["entry"]["displayName"]
        };
        let matches_text = [
            id,
            title,
            &row["product"]["shopName"],
            &row["product"]["variantName"],
            &row["entry"]["folderName"],
            &row["sourceMatch"]["product"]["title"],
            &row["sourceMatch"]["product"]["productId"],
            &row["sourceMatch"]["product"]["shopName"],
        ]
        .iter()
        .any(|v| {
            v.as_str()
                .is_some_and(|v| v.to_lowercase().contains(&needle))
        }) || row["entry"]["artifacts"]
            .as_array()
            .is_some_and(|artifacts| {
                artifacts.iter().any(|artifact| {
                    artifact["relativePath"]
                        .as_str()
                        .is_some_and(|name| name.to_lowercase().contains(&needle))
                })
            });
        source_match
            && state_match
            && matches_text
            && query.availability_status.as_ref().is_none_or(|word| {
                if product {
                    row["product"]["availabilityStatus"] == *word
                } else {
                    row["sourceMatch"]["product"]["availabilityStatus"] == *word
                }
            })
    });
    let total = rows.len();
    Ok(
        json!({"schemaVersion":"0.1","total":total,"offset":query.offset,"limit":query.limit,"items":rows.into_iter().skip(query.offset).take(query.limit).collect::<Vec<_>>()}),
    )
}

pub fn product_files(
    bdl: &BdlStore,
    root: &Path,
    params: Value,
) -> Result<Value, LibraryDownloadError> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct Request {
        schema_version: String,
        product_id: String,
    }
    let request: Request = serde_json::from_value(params)?;
    if request.schema_version != "0.1"
        || !request
            .product_id
            .strip_prefix("booth:")
            .is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err(LibraryDownloadError("invalid_params"));
    }
    if bdl.catalog_detail(&request.product_id)?.is_none() {
        return Err(LibraryDownloadError("product_not_found"));
    }
    let evidence = bdl.library_copy_evidence()?;
    let mut files = Vec::new();
    for (id, name) in bdl.downloadables_for_product(&request.product_id)? {
        let bound = bdl.managed_library_file(id)?;
        let candidates = if let Some(bound) = &bound {
            evidence
                .iter()
                .filter(|copy| copy.copy.copy_id == bound.copy_id)
                .map(|copy| copy.copy.clone())
                .collect()
        } else {
            bdl.legacy_download_copies(id)?
        };
        let copies: Vec<_> = candidates.into_iter().filter(|copy| copy.role == CopyRole::Original).map(|copy| {
            let presence = evidence.iter().find(|item| item.copy.copy_id == copy.copy_id).map(|item| presence(root,item)).unwrap_or("unreadable");
            json!({"copyId":copy.copy_id,"entryId":copy.warehouse_item_id,"fileName":copy.relative_path,"artifactSha256":copy.artifact_sha256,"presence":presence})
        }).collect();
        files.push(json!({"downloadableId":id,"fileName":name,"managedCopyId":bound.map(|bound|bound.copy_id),"copies":copies}));
    }
    Ok(json!({"schemaVersion":"0.1","productId":request.product_id,"items":files}))
}

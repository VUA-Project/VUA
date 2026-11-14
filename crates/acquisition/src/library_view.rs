//! AMF's library read model. Historical mappings never prove current file presence.
use crate::library_download::{LibraryDownloadError, LibraryDownloadService};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use vua_bdl_store::{ArtifactMode, BdlStore, CopyRole, LibraryCopyEvidence, LibraryProductDates};

const SORTS: [&str; 10] = [
    "added_desc",
    "added_asc",
    "title_asc",
    "title_desc",
    "shop_asc",
    "price_asc",
    "price_desc",
    "published_desc",
    "size_desc",
    "size_asc",
];
const FORMAT_FILTERS: [&str; 2] = ["vrm_or_glb", "unitypackage"];
const VN3_STATES: [&str; 4] = ["readable", "no_vn3", "unread", "unreadable"];
/// X is the creator's free text, so it has no value to filter on.
const VN3_ITEMS: &str = "ABCDEFGHIJKLMNOPQRSTUVW";

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Vn3Filter {
    state: Option<String>,
    #[serde(default)]
    items: Vec<String>,
    #[serde(default)]
    include_contact: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Query {
    schema_version: String,
    sort: Option<String>,
    format: Option<String>,
    vn3: Option<Vn3Filter>,
    #[serde(rename = "use")]
    use_preset: Option<String>,
    use_mode: Option<String>,
    #[serde(default = "all")]
    source: String,
    #[serde(default = "all")]
    state: String,
    #[serde(default)]
    text: String,
    availability_status: Option<String>,
    source_category: Option<String>,
    description_links_to: Option<String>,
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

/// Reads the presence of many files, most under the same folders, so each folder resolves once.
pub(crate) struct PresenceCheck {
    root: Option<PathBuf>,
    folders: HashMap<PathBuf, Option<PathBuf>>,
}

impl PresenceCheck {
    pub(crate) fn new(root: &Path) -> Self {
        Self {
            root: std::fs::canonicalize(root).ok(),
            folders: HashMap::new(),
        }
    }

    pub(crate) fn presence(&mut self, evidence: &LibraryCopyEvidence) -> &'static str {
        let path = Path::new(&evidence.copy.stored_path);
        let meta = match std::fs::symlink_metadata(path) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return "missing",
            Err(_) => return "unreadable",
        };
        if !meta.file_type().is_file() || !self.inside(path) {
            return "unreadable";
        }
        if meta.len() != evidence.size_bytes {
            return "changed";
        }
        // Presence is a metadata check. Production must recheck the selected hash.
        "present"
    }

    /// A regular file is no link, so only its folder can lead outside the warehouse.
    fn inside(&mut self, path: &Path) -> bool {
        let (Some(root), Some(folder)) = (&self.root, path.parent()) else {
            return false;
        };
        self.folders
            .entry(folder.to_owned())
            .or_insert_with(|| std::fs::canonicalize(folder).ok())
            .as_ref()
            .is_some_and(|folder| folder.starts_with(root))
    }
}

pub(crate) fn presence(root: &Path, evidence: &LibraryCopyEvidence) -> &'static str {
    PresenceCheck::new(root).presence(evidence)
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
    let unexpanded = copies
        .iter()
        .filter(|copy| {
            crate::zip_intake::is_zip(&copy.copy.relative_path)
                && copy.archive_expansion_state.as_deref() != Some("expanded")
        })
        .count();
    if unexpanded > 0 {
        facts["unexpandedArchives"] = json!(unexpanded);
    }
    facts
}

pub fn list(
    bdl: &BdlStore,
    root: &Path,
    global_default: ArtifactMode,
    downloads: &LibraryDownloadService,
    params: Value,
) -> Result<Value, LibraryDownloadError> {
    if ["use", "useMode", "sort", "format", "vn3"]
        .iter()
        .any(|key| params.get(*key).is_some_and(Value::is_null))
        || params.get("availabilityStatus").is_some_and(Value::is_null)
        || params.get("descriptionLinksTo").is_some_and(Value::is_null)
    {
        return Err(LibraryDownloadError("invalid_params"));
    }
    // Omitted = all categories; null = no recorded native category.
    let category_filter = params.get("sourceCategory").cloned();
    let query: Query = serde_json::from_value(params)?;
    if !["0.1", "0.2", "0.3"].contains(&query.schema_version.as_str())
        || (query.schema_version != "0.2"
            && (query.use_preset.is_some() || query.use_mode.is_some()))
        || (query.schema_version != "0.3"
            && (query.sort.is_some() || query.format.is_some() || query.vn3.is_some()))
        || query
            .sort
            .as_ref()
            .is_some_and(|sort| !SORTS.contains(&sort.as_str()))
        || query
            .format
            .as_ref()
            .is_some_and(|format| !FORMAT_FILTERS.contains(&format.as_str()))
        || query.vn3.as_ref().is_some_and(vn3_filter_invalid)
        || query
            .use_preset
            .as_ref()
            .is_some_and(|preset| !crate::terms::preset_ids().contains(&preset.as_str()))
        || query.use_mode.as_ref().is_some_and(|mode| {
            query.use_preset.is_none() || !["available", "all"].contains(&mode.as_str())
        })
        || ![
            "all",
            "local",
            "imported",
            "bought",
            "gifts",
            "free_downloads",
        ]
        .contains(&query.source.as_str())
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
            .source_category
            .as_ref()
            .is_some_and(|v| v.is_empty() || v.chars().count() > 200)
        || params_product_invalid(&query.description_links_to)
        || query
            .availability_status
            .as_ref()
            .is_some_and(|word| !["available", "unavailable", "unknown"].contains(&word.as_str()))
    {
        return Err(LibraryDownloadError("invalid_params"));
    }
    let mut products = bdl.library_product_summaries()?;
    let categories = bdl.library_product_categories()?;
    let variant_counts = bdl.library_variant_counts()?;
    let current = query.schema_version == "0.3";
    let dates = if current {
        bdl.library_product_dates()?
    } else {
        HashMap::new()
    };
    let linked_products = query
        .description_links_to
        .as_ref()
        .map(|id| crate::description_dependencies::products_linking_to(bdl, id))
        .transpose()?;
    let removed = bdl.removed_local_entries()?;
    let entries: Vec<_> = bdl
        .warehouse_entry_cards(global_default)?
        .into_iter()
        .filter(|entry| !removed.contains(&entry.warehouse_item_id))
        .collect();
    let copies: Vec<_> = bdl
        .library_copy_evidence()?
        .into_iter()
        .filter(|copy| !removed.contains(&copy.copy.warehouse_item_id))
        .collect();
    let metadata: HashMap<_, _> = bdl
        .library_entry_metadata_all()?
        .into_iter()
        .map(|m| (m.entry_id.clone(), m))
        .collect();
    let explicit_sources: HashMap<_, _> = metadata
        .values()
        .filter_map(|m| {
            m.product_id
                .as_ref()
                .map(|id| (m.entry_id.clone(), id.clone()))
        })
        .collect();
    let mut check = PresenceCheck::new(root);
    let mut presences = copies
        .iter()
        .map(|copy| (copy.copy.copy_id.clone(), check.presence(copy)))
        .collect();
    let owners = bdl.downloadable_owners()?;
    let managed_products: HashMap<_, _> = copies
        .iter()
        .filter_map(|copy| copy.downloadable_id)
        .filter_map(|id| owners.get(&id).map(|product| (id, product.clone())))
        .collect();
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
    let mut memberships = bdl.library_memberships_all()?;
    for product in &products {
        memberships.entry(product.product_id.clone()).or_default();
    }
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
    let mut copies_of_product: HashMap<&str, Vec<&LibraryCopyEvidence>> = HashMap::new();
    let mut copies_of_entry: HashMap<&str, Vec<&LibraryCopyEvidence>> = HashMap::new();
    for copy in &copies {
        copies_of_entry
            .entry(copy.copy.warehouse_item_id.as_str())
            .or_default()
            .push(copy);
        for id in grouping
            .assignments
            .get(&copy.copy.copy_id)
            .into_iter()
            .flatten()
        {
            copies_of_product.entry(id.as_str()).or_default().push(copy);
        }
    }
    let imported_places: HashMap<&str, usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, entry)| entry.kind == "imported_material")
        .map(|(place, entry)| (entry.warehouse_item_id.as_str(), place))
        .collect();
    let mut rows = Vec::new();
    let removed_products = bdl.removed_library_products()?;
    let downloadable_names = bdl.library_downloadable_names()?;
    let mut downloadables_by_product: HashMap<&str, Vec<&str>> = HashMap::new();
    for (product_id, anchor_text) in &downloadable_names {
        downloadables_by_product
            .entry(product_id.as_str())
            .or_default()
            .push(anchor_text.as_str());
    }
    for product in &mut products {
        if removed_products.contains(&product.product_id) {
            continue;
        }
        let attached = copies_of_product
            .get(product.product_id.as_str())
            .map_or(&[][..], Vec::as_slice);
        let facts = storage(attached, &presences);
        if attached.is_empty() && memberships[&product.product_id].is_empty() {
            continue;
        }
        // Compatibility projection: this new face counts present physical copies,
        // while the frozen catalog face retains its historical mapping count.
        product.imported_artifacts = facts["presentCopies"].as_u64().unwrap_or(0) as u32;
        rows.push(json!({"kind":"product","product":product,"variantCount":variant_counts.get(&product.product_id).copied().unwrap_or(0),"sources":memberships[&product.product_id],"sourceCategory":categories.get(&product.product_id).and_then(|v| v.as_ref()),
            "storage":facts,"copyIds":attached.iter().map(|c|&c.copy.copy_id).collect::<Vec<_>>(),"operation":operations.remove(&product.product_id)}));
        let mut places: Vec<_> = attached
            .iter()
            .filter_map(|copy| {
                imported_places
                    .get(copy.copy.warehouse_item_id.as_str())
                    .copied()
            })
            .collect();
        places.sort_unstable();
        places.dedup();
        let local_entries: Vec<_> = places
            .into_iter()
            .map(|place| &entries[place])
            .map(
                |entry| json!({"entryId":entry.warehouse_item_id,"displayName":entry.display_name}),
            )
            .collect();
        if !local_entries.is_empty() {
            rows.last_mut().expect("product row")["localEntries"] = json!(local_entries);
        }
        if current {
            let product_dates = dates.get(&product.product_id).cloned().unwrap_or_default();
            let earliest_copy = attached
                .iter()
                .map(|copy| copy.copy.created_at.clone())
                .min();
            let added = [product_dates.first_seen_at, earliest_copy]
                .into_iter()
                .flatten()
                .min();
            let formats = collect_formats(
                attached
                    .iter()
                    .map(|copy| copy.copy.relative_path.as_str())
                    .chain(
                        downloadables_by_product
                            .get(product.product_id.as_str())
                            .into_iter()
                            .flatten()
                            .copied(),
                    ),
            );
            let row = rows.last_mut().expect("product row");
            row["addedAt"] = json!(added);
            row["publishedAt"] = json!(product_dates.published_at);
            row["sizeBytes"] = json!(present_size(attached, &presences));
            if !formats.is_empty() {
                row["formats"] = json!(formats);
            }
        }
    }
    let sources = crate::library_reconcile::SourceIndex::with_downloadable_names(
        &products,
        &downloadable_names,
    );
    for mut entry in entries {
        let unassociated: Vec<_> = copies_of_entry
            .get(entry.warehouse_item_id.as_str())
            .into_iter()
            .flatten()
            .copied()
            .filter(|copy| !grouping.assignments.contains_key(&copy.copy.copy_id))
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
        let hint = crate::library_reconcile::source_hint(
            &entry,
            &unassociated,
            &sources,
            &grouping,
            explicit_sources
                .get(&entry.warehouse_item_id)
                .map(String::as_str),
        );
        let mut row = json!({"kind":"local","entry":entry,"storage":storage(&unassociated,&presences),
            "copyIds":unassociated.iter().map(|c|&c.copy.copy_id).collect::<Vec<_>>(),"sourceCategory":null});
        if let Some(metadata) = metadata.get(&entry.warehouse_item_id) {
            row["metadata"] = json!(metadata);
        }
        if let Some((basis, id, content)) = hint {
            if let Some(product) = sources.product(&id) {
                row["sourceMatch"] = crate::library_reconcile::hint_value(
                    product,
                    &memberships[&id],
                    basis,
                    content,
                );
                // A title/name clue is not evidence of the local item's category.
                if basis != "name" {
                    row["sourceCategory"] = json!(categories.get(&id).and_then(|v| v.as_ref()));
                    row["variantCount"] = json!(variant_counts.get(&id).copied().unwrap_or(0));
                }
            }
        }
        if current {
            let formats = collect_formats(
                unassociated
                    .iter()
                    .map(|copy| copy.copy.relative_path.as_str())
                    .chain(
                        row["entry"]["artifacts"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(|artifact| artifact["relativePath"].as_str()),
                    ),
            );
            row["addedAt"] = json!(entry.created_at);
            row["publishedAt"] = Value::Null;
            row["sizeBytes"] = json!(present_size(&unassociated, &presences));
            if !formats.is_empty() {
                row["formats"] = json!(formats);
            }
        }
        rows.push(row);
    }
    let moments = if current {
        settle_added(&mut rows, &dates, &bdl.library_order_times()?)
    } else {
        HashMap::new()
    };
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
            "imported" => {
                if product {
                    row["localEntries"]
                        .as_array()
                        .is_some_and(|entries| !entries.is_empty())
                } else {
                    row["entry"]["kind"] == "imported_material"
                }
            }
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
        // Only other product cards whose recorded body has the exact target link.
        let link_match = linked_products.as_ref().is_none_or(|ids| {
            product
                && row["product"]["productId"]
                    .as_str()
                    .is_some_and(|id| ids.contains(id))
        });
        link_match
            && source_match
            && state_match
            && matches_text
            && query
                .format
                .as_deref()
                .is_none_or(|wanted| row_matches_format(row, wanted))
            && query.availability_status.as_ref().is_none_or(|word| {
                if product {
                    row["product"]["availabilityStatus"] == *word
                } else {
                    row["sourceMatch"]["product"]["availabilityStatus"] == *word
                }
            })
    });
    if let Some(preset) = &query.use_preset {
        annotate_use(bdl, &mut rows, preset)?;
        if query.use_mode.as_deref().unwrap_or("available") == "available" {
            rows.retain(|row| {
                matches!(
                    row["use"]["status"].as_str(),
                    Some("allowed" | "conditional")
                )
            });
        }
    }
    let vn3_counts = match &query.vn3 {
        Some(filter) => {
            let counts = annotate_vn3(bdl, &mut rows, filter, category_filter.as_ref())?;
            rows.retain(|row| vn3_row_matches(row, filter));
            Some(counts)
        }
        None => None,
    };
    // Facets cover the full filtered library, before category and pagination.
    let source_categories: std::collections::BTreeSet<_> = rows
        .iter()
        .filter_map(|row| row["sourceCategory"].as_str().map(str::to_owned))
        .collect();
    if let Some(category) = category_filter {
        rows.retain(|row| row["sourceCategory"] == category);
    }
    if let Some(sort) = &query.sort {
        sort_rows(&mut rows, sort, &moments);
    }
    let total = rows.len();
    let mut result = json!({"schemaVersion":query.schema_version,"total":total,"offset":query.offset,"limit":query.limit,"sourceCategories":source_categories,"items":rows.into_iter().skip(query.offset).take(query.limit).collect::<Vec<_>>()});
    if let Some(counts) = vn3_counts {
        result["vn3Counts"] = counts;
    }
    Ok(result)
}

fn present_size(copies: &[&LibraryCopyEvidence], presences: &HashMap<String, &'static str>) -> u64 {
    copies
        .iter()
        .filter(|copy| presences[&copy.copy.copy_id] == "present")
        .map(|copy| copy.size_bytes)
        .sum()
}

fn classify_format_from_name(name: &str) -> Option<&'static str> {
    let trimmed = name.trim();
    let ext = Path::new(trimmed).extension()?.to_str()?;
    if ext.eq_ignore_ascii_case("unitypackage") {
        Some("unitypackage")
    } else if ext.eq_ignore_ascii_case("vrm") {
        Some("vrm")
    } else if ext.eq_ignore_ascii_case("glb") {
        Some("glb")
    } else if ext.eq_ignore_ascii_case("gltf") {
        Some("gltf")
    } else {
        None
    }
}

fn collect_formats<'a>(names: impl IntoIterator<Item = &'a str>) -> Vec<&'static str> {
    let mut found = [false; 4];
    for name in names {
        match classify_format_from_name(name) {
            Some("unitypackage") => found[0] = true,
            Some("vrm") => found[1] = true,
            Some("glb") => found[2] = true,
            Some("gltf") => found[3] = true,
            _ => {}
        }
    }
    ["unitypackage", "vrm", "glb", "gltf"]
        .into_iter()
        .enumerate()
        .filter_map(|(index, label)| found[index].then_some(label))
        .collect()
}

fn row_matches_format(row: &Value, wanted: &str) -> bool {
    row["formats"]
        .as_array()
        .is_some_and(|formats| match wanted {
            "vrm_or_glb" => formats
                .iter()
                .any(|format| matches!(format.as_str(), Some("vrm" | "glb" | "gltf"))),
            "unitypackage" => formats
                .iter()
                .any(|format| format.as_str() == Some("unitypackage")),
            _ => false,
        })
}

fn vn3_filter_invalid(filter: &Vn3Filter) -> bool {
    let mut seen = std::collections::HashSet::new();
    filter
        .state
        .as_ref()
        .is_some_and(|state| !VN3_STATES.contains(&state.as_str()))
        || filter.items.iter().any(|item| {
            item.len() != 1 || !VN3_ITEMS.contains(item.as_str()) || !seen.insert(item.as_str())
        })
}

/// The name a card shows, so the order matches what the player reads.
fn row_title(row: &Value) -> String {
    let title = if row["kind"] == "product" {
        row["product"]["title"].as_str()
    } else {
        row["metadata"]["displayName"]
            .as_str()
            .or(row["sourceMatch"]["product"]["title"].as_str())
            .or(row["entry"]["displayName"].as_str())
    };
    title.unwrap_or("").to_lowercase()
}
fn row_shop(row: &Value) -> Option<String> {
    row["product"]["shopName"]
        .as_str()
        .or(row["sourceMatch"]["product"]["shopName"].as_str())
        .map(str::to_lowercase)
}
fn row_price(row: &Value) -> Option<f64> {
    row["product"]["price"]["amount"]
        .as_str()
        .or(row["sourceMatch"]["product"]["price"]["amount"].as_str())
        .and_then(|amount| amount.parse().ok())
}
/// BOOTH numbers grow over time, so newer items come first among equal dates.
fn row_number(row: &Value) -> u64 {
    row["product"]["productId"]
        .as_str()
        .and_then(|id| id.strip_prefix("booth:"))
        .and_then(|id| id.parse().ok())
        .unwrap_or(0)
}
fn row_text<'a>(row: &'a Value, key: &str) -> Option<&'a str> {
    row[key].as_str()
}

/// Digit runs compare by value, so "Costume 4" comes before "Costume 10".
fn natural(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut left, mut right) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (left.peek().copied(), right.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |chars: &mut std::iter::Peekable<std::str::Chars<'_>>| {
                    let mut digits = String::new();
                    while let Some(digit) = chars.peek().copied().filter(char::is_ascii_digit) {
                        digits.push(digit);
                        chars.next();
                    }
                    digits
                };
                let (one, two) = (take(&mut left), take(&mut right));
                let (one, two) = (one.trim_start_matches('0'), two.trim_start_matches('0'));
                let order = one.len().cmp(&two.len()).then_with(|| one.cmp(two));
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                left.next();
                right.next();
            }
        }
    }
}

/// Rows without the sorted fact go last in either direction.
fn missing_last<T>(
    a: Option<T>,
    b: Option<T>,
    order: impl FnOnce(T, T) -> std::cmp::Ordering,
) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => order(a, b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

/// A sync reads its pages seconds apart; anything further apart is a later sync.
const ONE_SYNC_MS: i64 = 120_000;

/// When each account product joined the library, as far as known. A purchase has its order's time. Gifts and
/// free downloads have none: what the first sync found could have arrived at any point before it, so its time
/// is unknown, and what a later sync finds arrived around that sync. A local copy older than the first sighting
/// keeps its own time. Sets `addedAt` and `purchasedAt` on product rows and returns the moment each sorts by.
fn settle_added(
    rows: &mut [Value],
    dates: &HashMap<String, LibraryProductDates>,
    ordered: &HashMap<String, String>,
) -> HashMap<String, i64> {
    let millis = vua_orchestrator::rfc3339_millis;
    let first_seen = |id: &str| {
        dates
            .get(id)
            .and_then(|date| date.first_seen_at.as_deref())
            .and_then(millis)
    };
    let mut seen: Vec<(i64, String)> = rows
        .iter()
        .filter_map(|row| {
            let id = row.get("product")?.get("productId")?.as_str()?;
            Some((first_seen(id)?, id.to_owned()))
        })
        .collect();
    seen.sort_unstable();
    let mut arrivals: HashMap<String, Option<i64>> = HashMap::with_capacity(seen.len());
    let (mut start, mut sync) = (0, 0);
    for next in 1..=seen.len() {
        if next == seen.len() || seen[next].0 - seen[next - 1].0 > ONE_SYNC_MS {
            for (_, id) in &seen[start..next] {
                arrivals.insert(id.clone(), (sync > 0).then_some(seen[next - 1].0));
            }
            start = next;
            sync += 1;
        }
    }
    let mut moments = HashMap::with_capacity(rows.len());
    for row in rows.iter_mut() {
        let Some(id) = row
            .get("product")
            .and_then(|product| product.get("productId"))
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            continue;
        };
        let moment = if let Some(time) = ordered.get(&id) {
            row["purchasedAt"] = json!(time);
            row["addedAt"] = json!(time);
            millis(time)
        } else {
            row["purchasedAt"] = Value::Null;
            let own = row_text(row, "addedAt").and_then(millis);
            let copy_came_first = own.is_some()
                && first_seen(&id).is_none_or(|seen| own.is_some_and(|own| own < seen));
            let arrival = arrivals.get(&id).copied().flatten();
            if copy_came_first {
                own
            } else {
                if arrival.is_none() {
                    row["addedAt"] = Value::Null;
                }
                arrival
            }
        };
        if let Some(moment) = moment {
            moments.insert(id, moment);
        }
    }
    moments
}

fn sort_rows(rows: &mut [Value], sort: &str, moments: &HashMap<String, i64>) {
    let added = |row: &Value| match row["product"]["productId"].as_str() {
        Some(id) => moments.get(id).copied(),
        None => row_text(row, "addedAt").and_then(vua_orchestrator::rfc3339_millis),
    };
    let by_title = |a: &Value, b: &Value| natural(&row_title(a), &row_title(b));
    let price = |a: f64, b: f64| a.partial_cmp(&b).unwrap_or(std::cmp::Ordering::Equal);
    let published = |row: &Value| {
        row_text(row, "publishedAt").and_then(vua_orchestrator::rfc3339_offset_millis)
    };
    rows.sort_by(|a, b| {
        let order = match sort {
            "added_asc" => missing_last(added(a), added(b), |a, b| a.cmp(&b))
                .then_with(|| row_number(a).cmp(&row_number(b))),
            "title_asc" => by_title(a, b),
            "title_desc" => by_title(b, a),
            "shop_asc" => missing_last(row_shop(a), row_shop(b), |a, b| natural(&a, &b)),
            "price_asc" => missing_last(row_price(a), row_price(b), price),
            "price_desc" => missing_last(row_price(a), row_price(b), |a, b| price(b, a)),
            "published_desc" => missing_last(published(a), published(b), |a, b| b.cmp(&a)),
            "size_desc" => b["sizeBytes"].as_u64().cmp(&a["sizeBytes"].as_u64()),
            "size_asc" => a["sizeBytes"].as_u64().cmp(&b["sizeBytes"].as_u64()),
            _ => missing_last(added(a), added(b), |a, b| b.cmp(&a)),
        };
        order
            .then_with(|| row_number(b).cmp(&row_number(a)))
            .then_with(|| by_title(a, b))
    });
}

/// The terms a filter reads: a closed group for the whole product, and each item's value.
fn vn3_group(state: &str) -> &'static str {
    match state {
        "parsed" | "partial" => "readable",
        "no_vn3" => "no_vn3",
        "not_observed" | "pending" => "unread",
        _ => "unreadable",
    }
}

/// A match needs complete evidence, as a use check does: partial documents and an unreadable special note never pass.
fn vn3_match(
    detail: &crate::terms::TermsDetail,
    items: &[String],
    include_contact: bool,
) -> Option<&'static str> {
    let special_unclear = detail.warnings.iter().any(|w| {
        w.item.as_deref() == Some("X")
            && [
                "missing_item",
                "unknown_heading",
                "duplicate_item",
                "summary_conflict",
            ]
            .contains(&w.code.as_str())
    });
    if detail.product.state != "parsed" || special_unclear {
        return None;
    }
    let mut result = "allowed";
    for letter in items {
        let item = detail
            .effective_items
            .iter()
            .find(|item| item.item == *letter)?;
        match item.value.as_str() {
            "permitted" => {
                if item.condition.is_some() && result == "allowed" {
                    result = "conditional";
                }
            }
            "contact_licensor" if include_contact => result = "contact",
            _ => return None,
        }
    }
    Some(result)
}

fn annotate_vn3(
    bdl: &BdlStore,
    rows: &mut [Value],
    filter: &Vn3Filter,
    category: Option<&Value>,
) -> Result<Value, LibraryDownloadError> {
    let (mut readable, mut no_vn3, mut unread, mut unreadable) = (0u64, 0u64, 0u64, 0u64);
    let mut items: std::collections::BTreeMap<String, u64> = VN3_ITEMS
        .chars()
        .map(|letter| (letter.to_string(), 0))
        .collect();
    let mut details = crate::terms::all_product_details(bdl)?;
    for row in rows.iter_mut() {
        let counted = category.is_none_or(|category| row["sourceCategory"] == *category);
        let Some(id) = terms_product_id(row).map(str::to_owned) else {
            row["vn3"] = json!({"state":"no_vn3","match":null,"hasSpecialNote":false});
            if counted {
                no_vn3 += 1;
            }
            continue;
        };
        let detail = details.entry(id).or_insert_with_key(|missing_id| {
            crate::terms::detail_from_product_terms(
                vua_bdl_store::terms::ProductTerms::not_observed(missing_id.clone()),
            )
        });
        let group = vn3_group(&detail.product.state);
        let matched = (!filter.items.is_empty())
            .then(|| vn3_match(detail, &filter.items, filter.include_contact))
            .flatten();
        row["vn3"] =
            json!({"state":group,"match":matched,"hasSpecialNote":detail.has_special_note});
        if !counted {
            continue;
        }
        match group {
            "readable" => readable += 1,
            "no_vn3" => no_vn3 += 1,
            "unread" => unread += 1,
            _ => unreadable += 1,
        }
        for (letter, count) in items.iter_mut() {
            let one = [letter.clone()];
            if vn3_match(detail, &one, filter.include_contact).is_some() {
                *count += 1;
            }
        }
    }
    Ok(
        json!({"readable":readable,"noVn3":no_vn3,"unread":unread,"unreadable":unreadable,"items":items}),
    )
}

fn vn3_row_matches(row: &Value, filter: &Vn3Filter) -> bool {
    filter
        .state
        .as_ref()
        .is_none_or(|state| row["vn3"]["state"] == *state.as_str())
        && (filter.items.is_empty() || !row["vn3"]["match"].is_null())
}

/// Match the renderer's confirmed identity rule: name/filename suggestions cannot
/// grant use permission to an unrelated local item.
fn terms_product_id(row: &Value) -> Option<&str> {
    if row["kind"] == "product" {
        return row["product"]["productId"].as_str();
    }
    row["metadata"]["productId"].as_str().or_else(|| {
        (row["sourceMatch"]["basis"] == "mapping")
            .then(|| row["sourceMatch"]["product"]["productId"].as_str())
            .flatten()
    })
}
fn annotate_use(
    bdl: &BdlStore,
    rows: &mut [Value],
    preset: &str,
) -> Result<(), LibraryDownloadError> {
    let ids = rows
        .iter()
        .filter_map(terms_product_id)
        .map(str::to_owned)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let check = crate::terms::check_use(bdl, preset, &ids)?;
    let decisions = check
        .products
        .iter()
        .map(|product| {
            let status = match product.result.decision.as_str() {
                "conforms" if !product.result.conditions.is_empty() => "conditional",
                "conforms" => "allowed",
                "contact_licensor" => "contact",
                "nonconforming" => "forbidden",
                _ if product.source_state == "no_vn3" => "no_terms",
                _ => "unknown",
            };
            (product.product_id.as_str(), status)
        })
        .collect::<HashMap<_, _>>();
    for row in rows {
        let status = terms_product_id(row)
            .map(|id| decisions.get(id).copied().unwrap_or("unknown"))
            .unwrap_or("no_terms");
        row["use"] = json!({"presetId":preset,"status":status});
    }
    Ok(())
}

fn params_product_invalid(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|id| {
        id.strip_prefix("booth:")
            .is_none_or(|native| native.is_empty() || !native.bytes().all(|b| b.is_ascii_digit()))
    })
}

/// Current visible product scope, including verified local copies and ZIP members.
/// This is a read projection; it does not manufacture persisted source mappings.
pub(crate) fn product_copy_ids(
    bdl: &BdlStore,
    root: &Path,
    downloads: &LibraryDownloadService,
    product_id: &str,
) -> Result<std::collections::HashSet<String>, LibraryDownloadError> {
    let removed = bdl.removed_local_entries()?;
    let entries: Vec<_> = bdl
        .warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)?
        .into_iter()
        .filter(|entry| !removed.contains(&entry.warehouse_item_id))
        .collect();
    let copies: Vec<_> = bdl
        .library_copy_evidence()?
        .into_iter()
        .filter(|copy| !removed.contains(&copy.copy.warehouse_item_id))
        .collect();
    let products = bdl.library_product_summaries()?;
    let explicit: HashMap<_, _> = bdl
        .library_entry_metadata_all()?
        .into_iter()
        .filter_map(|m| m.product_id.map(|id| (m.entry_id, id)))
        .collect();
    let owners = bdl.downloadable_owners()?;
    let managed: HashMap<_, _> = copies
        .iter()
        .filter_map(|copy| copy.downloadable_id.or(copy.archive_downloadable_id))
        .filter_map(|id| owners.get(&id).map(|product| (id, product.clone())))
        .collect();
    let mut check = PresenceCheck::new(root);
    let mut presences = copies
        .iter()
        .map(|copy| (copy.copy.copy_id.clone(), check.presence(copy)))
        .collect();
    let checks = downloads
        .library_content_checks
        .lock()
        .expect("library checks poisoned");
    let grouping = crate::library_reconcile::group(
        &entries,
        &products,
        &copies,
        &managed,
        &mut presences,
        &checks,
        &explicit,
    );
    Ok(grouping
        .assignments
        .into_iter()
        .filter_map(|(copy, products)| products.contains(product_id).then_some(copy))
        .collect())
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

#[cfg(test)]
mod added_tests {
    use super::*;

    const FIRST_SYNC: &str = "2026-10-11T00:00:00.000Z";

    fn product(id: &str, seen: &str) -> Value {
        json!({"kind":"product","product":{"productId":id,"title":id},"addedAt":seen})
    }

    fn entry(title: &str, added: &str) -> Value {
        json!({"kind":"local","entry":{"displayName":title},"addedAt":added})
    }

    fn settled(rows: &mut [Value], ordered: &[(&str, &str)]) -> HashMap<String, i64> {
        let dates = rows
            .iter()
            .filter_map(|row| {
                Some((
                    row["product"]["productId"].as_str()?.to_owned(),
                    LibraryProductDates {
                        first_seen_at: row_text(row, "addedAt").map(str::to_owned),
                        published_at: None,
                    },
                ))
            })
            .collect();
        let ordered = ordered
            .iter()
            .map(|(id, time)| ((*id).to_owned(), (*time).to_owned()))
            .collect();
        settle_added(rows, &dates, &ordered)
    }

    fn sorted(mut rows: Vec<Value>, ordered: &[(&str, &str)], sort: &str) -> Vec<String> {
        let moments = settled(&mut rows, ordered);
        sort_rows(&mut rows, sort, &moments);
        rows.iter()
            .map(|row| {
                row["product"]["productId"]
                    .as_str()
                    .or(row["entry"]["displayName"].as_str())
                    .unwrap()
                    .to_owned()
            })
            .collect()
    }

    #[test]
    fn publications_sort_by_instant_with_unknown_dates_last() {
        let published = |id: &str, date: Option<&str>| {
            let mut row = product(id, FIRST_SYNC);
            row["publishedAt"] = json!(date);
            row
        };
        let mut rows = vec![
            published("booth:1", Some("2026-11-10T00:00:00Z")),
            published("booth:2", Some("2026-11-10T08:00:00+09:00")),
            published("booth:3", Some("2026-11-09T22:00:00-05:00")),
            published("booth:4", Some("2026-11-10T09:00:00.125+09:00")),
            published("booth:5", None),
            published("booth:6", Some("2026-02-30T00:00:00Z")),
        ];
        sort_rows(&mut rows, "published_desc", &HashMap::new());
        let ids: Vec<_> = rows
            .iter()
            .map(|row| row["product"]["productId"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            ["booth:3", "booth:4", "booth:1", "booth:2", "booth:6", "booth:5"]
        );
        assert_eq!(
            rows[0]["publishedAt"], "2026-11-09T22:00:00-05:00",
            "source spelling stays intact"
        );
    }

    #[test]
    fn purchases_follow_their_order_times_and_what_has_no_time_comes_after_them() {
        let rows = vec![
            product("booth:1", FIRST_SYNC),
            product("booth:2", FIRST_SYNC),
            product("booth:7", FIRST_SYNC),
            product("booth:8", FIRST_SYNC),
        ];
        let ordered = [
            ("booth:1", "2026-05-01T00:00:00.000Z"),
            ("booth:2", "2024-01-01T00:00:00.000Z"),
        ];
        assert_eq!(
            sorted(rows.clone(), &ordered, "added_desc"),
            ["booth:1", "booth:2", "booth:8", "booth:7"]
        );
        assert_eq!(
            sorted(rows, &ordered, "added_asc"),
            ["booth:2", "booth:1", "booth:7", "booth:8"]
        );
    }

    #[test]
    fn a_row_says_what_is_known_about_it() {
        let mut rows = vec![
            product("booth:1", FIRST_SYNC),
            product("booth:2", FIRST_SYNC),
            product("booth:3", "2026-11-01T00:00:00.000Z"),
        ];
        settled(&mut rows, &[("booth:1", "2026-05-01T00:00:00.000Z")]);
        assert_eq!(
            (&rows[0]["purchasedAt"], &rows[0]["addedAt"]),
            (
                &json!("2026-05-01T00:00:00.000Z"),
                &json!("2026-05-01T00:00:00.000Z")
            )
        );
        assert_eq!(
            (&rows[1]["purchasedAt"], &rows[1]["addedAt"]),
            (&Value::Null, &Value::Null),
            "the first sync says nothing about when"
        );
        assert_eq!(
            (&rows[2]["purchasedAt"], &rows[2]["addedAt"]),
            (&Value::Null, &json!("2026-11-01T00:00:00.000Z"))
        );
    }

    #[test]
    fn a_free_item_a_later_sync_finds_takes_that_syncs_place_among_purchases() {
        let rows = vec![
            product("booth:1", FIRST_SYNC),
            product("booth:2", FIRST_SYNC),
            product("booth:3", "2026-11-01T00:00:00.000Z"),
            product("booth:4", "2026-11-01T00:00:05.000Z"),
        ];
        let ordered = [
            ("booth:1", "2026-12-01T00:00:00.000Z"),
            ("booth:2", "2024-01-01T00:00:00.000Z"),
        ];
        assert_eq!(
            sorted(rows, &ordered, "added_desc"),
            ["booth:1", "booth:4", "booth:3", "booth:2"]
        );
    }

    #[test]
    fn the_first_sync_is_every_page_it_read_and_a_pause_ends_it() {
        let rows = vec![
            product("booth:1", "2026-10-11T00:00:00.000Z"),
            product("booth:2", "2026-10-11T00:01:30.000Z"),
            product("booth:3", "2026-10-11T00:03:00.000Z"),
            product("booth:4", "2026-10-11T00:06:00.000Z"),
        ];
        assert_eq!(
            sorted(rows, &[], "added_desc"),
            ["booth:4", "booth:3", "booth:2", "booth:1"]
        );
        let mut rows = vec![
            product("booth:1", "2026-10-11T00:00:00.000Z"),
            product("booth:2", "2026-10-11T00:01:30.000Z"),
            product("booth:3", "2026-10-11T00:06:00.000Z"),
        ];
        settled(&mut rows, &[]);
        assert_eq!(
            (&rows[0]["addedAt"], &rows[1]["addedAt"]),
            (&Value::Null, &Value::Null)
        );
        assert_eq!(rows[2]["addedAt"], "2026-10-11T00:06:00.000Z");
    }

    #[test]
    fn a_local_import_falls_where_its_own_time_puts_it() {
        let rows = vec![
            product("booth:1", FIRST_SYNC),
            product("booth:2", FIRST_SYNC),
            product("booth:3", FIRST_SYNC),
            entry("hair", "2026-10-20T00:00:00.000Z"),
        ];
        let ordered = [
            ("booth:1", "2026-05-01T00:00:00.000Z"),
            ("booth:2", "2026-11-01T00:00:00.000Z"),
        ];
        assert_eq!(
            sorted(rows, &ordered, "added_desc"),
            ["booth:2", "hair", "booth:1", "booth:3"]
        );
    }

    #[test]
    fn a_local_copy_older_than_the_first_sighting_keeps_its_time() {
        let mut rows = vec![
            product("booth:1", FIRST_SYNC),
            product("booth:2", "2026-09-01T00:00:00.000Z"),
        ];
        let dates: HashMap<_, _> = [("booth:1", FIRST_SYNC), ("booth:2", FIRST_SYNC)]
            .into_iter()
            .map(|(id, seen)| {
                (
                    id.to_owned(),
                    LibraryProductDates {
                        first_seen_at: Some(seen.to_owned()),
                        published_at: None,
                    },
                )
            })
            .collect();
        settle_added(&mut rows, &dates, &HashMap::new());
        assert_eq!(
            (&rows[0]["addedAt"], &rows[1]["addedAt"]),
            (&Value::Null, &json!("2026-09-01T00:00:00.000Z"))
        );
    }

    #[test]
    fn size_asc_is_accepted_by_sorts_and_orders_smallest_first() {
        assert!(SORTS.contains(&"size_asc"));
        let mut a = product("booth:1", FIRST_SYNC);
        a["sizeBytes"] = json!(5_000_000u64);
        let mut b = product("booth:2", FIRST_SYNC);
        b["sizeBytes"] = json!(120_000u64);
        let mut c = product("booth:3", FIRST_SYNC);
        c["sizeBytes"] = json!(900_000u64);
        let mut rows = vec![a, b, c];
        sort_rows(&mut rows, "size_asc", &HashMap::new());
        let ids: Vec<_> = rows
            .iter()
            .filter_map(|r| r["product"]["productId"].as_str())
            .collect();
        assert_eq!(ids, ["booth:2", "booth:3", "booth:1"]);
    }

    #[test]
    fn collect_formats_and_format_filter_classify_observed_extensions_only() {
        assert_eq!(
            collect_formats(["Avatar_VRM_v1.zip", "readme.txt"]),
            Vec::<&str>::new()
        );
        assert_eq!(
            collect_formats([
                "nested/HeadProp.GLB",
                "Avatar.vrm",
                "Package.UnityPackage",
                "Avatar2.vrm",
                "Scene.gltf",
            ]),
            vec!["unitypackage", "vrm", "glb", "gltf"]
        );

        let vrm_row = json!({"formats": ["vrm"]});
        let glb_row = json!({"formats": ["glb"]});
        let unity_row = json!({"formats": ["unitypackage"]});
        let dual_row = json!({"formats": ["unitypackage", "vrm"]});
        let zip_only = json!({});

        assert!(row_matches_format(&vrm_row, "vrm_or_glb"));
        assert!(row_matches_format(&glb_row, "vrm_or_glb"));
        assert!(!row_matches_format(&unity_row, "vrm_or_glb"));
        assert!(row_matches_format(&dual_row, "vrm_or_glb"));
        assert!(row_matches_format(&dual_row, "unitypackage"));
        assert!(!row_matches_format(&zip_only, "vrm_or_glb"));
        assert!(!row_matches_format(&zip_only, "unitypackage"));
    }
}

//! Candidate `glb-inspection v0.1` (`0.2.0`): AMF-owned pure-Rust streaming inspection of
//! warehouse `.glb` and `.vrm` binary glTF 2.0 artifacts (both standalone files and unexpanded
//! `.zip` archive members), `VRMC_vrm` 1.0 humanoid & bone structure facts, legacy VRM 0.x
//! detection, and world-space scene bounding boxes.
//!
//! Safety & streaming invariants:
//! - Opens only warehouse-contained regular files verified `"present"` by [`PresenceCheck`].
//! - Streams only the 12-byte GLB header + 8-byte Chunk 0 header + JSON chunk (`<= 16 MiB`),
//!   including inside `.zip` entries (zero temporary disk writes; never decompresses Chunk 1
//!   `BIN` geometry/texture buffers into memory).
//! - Redacts host filesystem paths, emitting only normalized warehouse-relative file names.

use crate::library_download::{LibraryDownloadError, LibraryDownloadService};
use crate::library_view::{product_copy_ids, PresenceCheck};
use crate::terms::valid_product_id;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use vua_bdl_store::BdlStore;

pub const GLB_INSPECTION_SCHEMA: &str = "vua.glb-inspection/v0.1";

const GLB_MAGIC: u32 = 0x4654_6C67; // "glTF"
const GLB_VERSION_2: u32 = 2;
const GLB_CHUNK_JSON: u32 = 0x4E4F_534A; // "JSON"
const MAX_JSON_CHUNK_BYTES: usize = 16 * 1024 * 1024;
const MAX_INSPECTED_ITEMS: usize = 64;
const MAX_ZIP_ENTRIES_SCANNED: usize = 4_096;
const MAX_SCENE_DEPTH: usize = 128;
const MAX_SCENE_VISITS: usize = 16_384;

const FULL_BODY_HUMANOID_BONES: [&str; 15] = [
    "hips",
    "spine",
    "head",
    "leftUpperLeg",
    "leftLowerLeg",
    "leftFoot",
    "rightUpperLeg",
    "rightLowerLeg",
    "rightFoot",
    "leftUpperArm",
    "leftLowerArm",
    "leftHand",
    "rightUpperArm",
    "rightLowerArm",
    "rightHand",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbContentSummaryV01 {
    pub mesh_count: usize,
    pub primitive_count: usize,
    pub triangle_estimate: u64,
    pub skin_count: usize,
    pub node_count: usize,
    pub animation_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbMaterialSummaryV01 {
    pub material_count: usize,
    pub unlit_material_count: usize,
    pub mtoon_material_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbTextureSummaryV01 {
    pub texture_count: usize,
    pub embedded_image_count: usize,
    pub external_uri_texture_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbSecondaryMotionSummaryV01 {
    pub spring_bone_joint_count: usize,
    pub node_constraint_count: usize,
    pub expression_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbVrmSummaryV01 {
    pub spec_version: Option<String>,
    pub has_humanoid_head_bone: bool,
    pub has_full_body_bones: bool,
    pub has_toe_bones: bool,
    pub head_bone_height_meters: Option<f64>,
    pub bone_count: usize,
    pub model_name: Option<String>,
    pub authors: Vec<String>,
    pub avatar_permission: Option<String>,
    pub commercial_usage: Option<String>,
    pub modification: Option<String>,
    pub license_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbBoundsMetersV01 {
    pub size: [f64; 3],
    pub min: [f64; 3],
    pub max: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbInspectedFileV01 {
    pub copy_id: String,
    pub file_name: String,
    pub source_kind: &'static str,
    pub container_file_name: Option<String>,
    pub size_bytes: u64,
    pub format: &'static str,
    pub extensions_used: Vec<String>,
    pub content_summary: Option<GlbContentSummaryV01>,
    pub material_summary: Option<GlbMaterialSummaryV01>,
    pub texture_summary: Option<GlbTextureSummaryV01>,
    pub secondary_motion: Option<GlbSecondaryMotionSummaryV01>,
    pub vrm: Option<GlbVrmSummaryV01>,
    pub bounds_meters: Option<GlbBoundsMetersV01>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlbInspectionResultV01 {
    pub schema_version: &'static str,
    pub items: Vec<GlbInspectedFileV01>,
    pub truncated: bool,
}

enum TargetScope {
    Product(String),
    Entry(String),
}

fn parse_params(params: &Value) -> Result<TargetScope, LibraryDownloadError> {
    let Some(obj) = params.as_object() else {
        return Err(LibraryDownloadError("invalid_params"));
    };
    if obj.len() != 2 || obj.get("schemaVersion").and_then(Value::as_str) != Some("0.1") {
        return Err(LibraryDownloadError("invalid_params"));
    }
    if let Some(pid) = obj.get("productId") {
        let Some(s) = pid.as_str().filter(|s| valid_product_id(s)) else {
            return Err(LibraryDownloadError("invalid_params"));
        };
        return Ok(TargetScope::Product(s.to_owned()));
    }
    if let Some(eid) = obj.get("entryId") {
        let Some(s) = eid
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 128 && !s.contains(['\\', '/']))
        else {
            return Err(LibraryDownloadError("invalid_params"));
        };
        return Ok(TargetScope::Entry(s.to_owned()));
    }
    Err(LibraryDownloadError("invalid_params"))
}

fn parse_expanded_copy_relative(raw: &str) -> Option<(&str, &str)> {
    let normalized = raw.strip_prefix("expanded/")?;
    let (parent_copy_id, member_rel) = normalized.split_once('/')?;
    if parent_copy_id.is_empty() || member_rel.is_empty() {
        return None;
    }
    Some((parent_copy_id, member_rel))
}

pub fn inspect_glb(
    bdl: &BdlStore,
    root: &Path,
    downloads: &LibraryDownloadService,
    params: Value,
) -> Result<Value, LibraryDownloadError> {
    let scope = parse_params(&params)?;
    let removed = bdl.removed_local_entries()?;
    let all_copies = bdl
        .library_copy_evidence()?
        .into_iter()
        .filter(|copy| !removed.contains(&copy.copy.warehouse_item_id))
        .collect::<Vec<_>>();

    let zip_name_by_copy_id: HashMap<String, String> = all_copies
        .iter()
        .filter(|c| crate::zip_intake::is_zip(&c.copy.relative_path))
        .map(|c| {
            (
                c.copy.copy_id.clone(),
                sanitize_relative_file_name(&c.copy.relative_path),
            )
        })
        .collect();

    let scoped = match scope {
        TargetScope::Product(product_id) => {
            let ids = product_copy_ids(bdl, root, downloads, &product_id)?;
            all_copies
                .into_iter()
                .filter(|c| ids.contains(&c.copy.copy_id))
                .collect::<Vec<_>>()
        }
        TargetScope::Entry(entry_id) => all_copies
            .into_iter()
            .filter(|c| c.copy.warehouse_item_id == entry_id)
            .collect::<Vec<_>>(),
    };

    let mut presence_check = PresenceCheck::new(root);
    let mut expanded_zip_ids = HashSet::new();
    let mut standalone_candidates = Vec::new();
    let mut zip_candidates = Vec::new();

    for copy in scoped {
        if presence_check.presence(&copy) != "present" {
            continue;
        }
        let normalized_rel = copy.copy.relative_path.replace('\\', "/");
        if is_glb_or_vrm(&normalized_rel) {
            let (display_name, container_name) = if let Some((parent_id, member_rel)) =
                parse_expanded_copy_relative(&normalized_rel)
            {
                expanded_zip_ids.insert(parent_id.to_owned());
                (
                    sanitize_relative_file_name(member_rel),
                    zip_name_by_copy_id.get(parent_id).cloned(),
                )
            } else {
                (sanitize_relative_file_name(&normalized_rel), None)
            };
            standalone_candidates.push((display_name, container_name, copy));
        } else if crate::zip_intake::is_zip(&normalized_rel) {
            let zip_name = sanitize_relative_file_name(&normalized_rel);
            zip_candidates.push((zip_name, copy));
        }
    }

    standalone_candidates.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.2.copy.copy_id.cmp(&b.2.copy.copy_id))
    });
    zip_candidates.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.copy.copy_id.cmp(&b.1.copy.copy_id))
    });

    let mut items = Vec::new();
    let mut truncated = false;

    for (file_name, container_file_name, copy) in standalone_candidates {
        if items.len() >= MAX_INSPECTED_ITEMS {
            truncated = true;
            break;
        }
        let parsed = match File::open(Path::new(&copy.copy.stored_path)) {
            Ok(mut file) => inspect_glb_reader(&mut file),
            Err(_) => ParsedGlb::invalid(),
        };
        items.push(build_inspected_item(
            copy.copy.copy_id,
            file_name,
            "standalone_file",
            container_file_name,
            copy.size_bytes,
            parsed,
        ));
    }

    for (zip_name, zip_copy) in zip_candidates {
        if expanded_zip_ids.contains(&zip_copy.copy.copy_id) {
            continue;
        }
        if items.len() >= MAX_INSPECTED_ITEMS {
            truncated = true;
            break;
        }
        inspect_unexpanded_zip_members(
            Path::new(&zip_copy.copy.stored_path),
            &zip_copy.copy.copy_id,
            &zip_name,
            &mut items,
            &mut truncated,
        );
    }

    let result = GlbInspectionResultV01 {
        schema_version: GLB_INSPECTION_SCHEMA,
        items,
        truncated,
    };
    Ok(serde_json::to_value(result).unwrap_or_else(|_| {
        json!({
            "schemaVersion": GLB_INSPECTION_SCHEMA,
            "items": [],
            "truncated": false
        })
    }))
}

fn inspect_unexpanded_zip_members(
    zip_path: &Path,
    zip_copy_id: &str,
    zip_display_name: &str,
    items: &mut Vec<GlbInspectedFileV01>,
    truncated: &mut bool,
) {
    let Ok(file) = File::open(zip_path) else {
        return;
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return;
    };
    let total_entries = archive.len();
    if total_entries > MAX_ZIP_ENTRIES_SCANNED {
        *truncated = true;
    }
    let scan_limit = total_entries.min(MAX_ZIP_ENTRIES_SCANNED);
    let mut matching_indices = Vec::new();

    for index in 0..scan_limit {
        let Ok(raw_entry) = archive.by_index_raw(index) else {
            continue;
        };
        if raw_entry.is_dir() || raw_entry.is_symlink() || raw_entry.encrypted() {
            continue;
        }
        let Ok(raw_name) = raw_entry.name() else {
            continue;
        };
        if !is_glb_or_vrm(&raw_name) {
            continue;
        }
        let clean_name = sanitize_relative_file_name(&raw_name);
        matching_indices.push((clean_name, index, raw_entry.size()));
    }

    matching_indices.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    for (member_name, index, uncompressed_size) in matching_indices {
        if items.len() >= MAX_INSPECTED_ITEMS {
            *truncated = true;
            break;
        }
        let parsed = match archive.by_index(index) {
            Ok(entry_reader) => {
                let mut bounded = entry_reader.take((20 + MAX_JSON_CHUNK_BYTES) as u64);
                inspect_glb_reader(&mut bounded)
            }
            Err(_) => ParsedGlb::invalid(),
        };
        items.push(build_inspected_item(
            zip_copy_id.to_owned(),
            member_name,
            "zip_member",
            Some(zip_display_name.to_owned()),
            uncompressed_size,
            parsed,
        ));
    }
}

const MAX_SAFE_JS_INT: u64 = 9_007_199_254_740_991;
const MAX_COORD_METERS: f64 = 1.0e9;

fn build_inspected_item(
    copy_id: String,
    file_name: String,
    source_kind: &'static str,
    container_file_name: Option<String>,
    size_bytes: u64,
    parsed: ParsedGlb,
) -> GlbInspectedFileV01 {
    GlbInspectedFileV01 {
        copy_id,
        file_name,
        source_kind,
        container_file_name,
        size_bytes: size_bytes.min(MAX_SAFE_JS_INT),
        format: parsed.format,
        extensions_used: parsed.extensions_used,
        content_summary: parsed.content_summary,
        material_summary: parsed.material_summary,
        texture_summary: parsed.texture_summary,
        secondary_motion: parsed.secondary_motion,
        vrm: parsed.vrm,
        bounds_meters: parsed.bounds_meters,
    }
}

fn is_glb_or_vrm(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".glb") || lower.ends_with(".vrm")
}

pub fn sanitize_relative_file_name(raw: &str) -> String {
    let normalized = raw.replace('\\', "/");
    let segments = normalized
        .split('/')
        .filter(|seg| !seg.is_empty() && *seg != "." && !seg.contains("..") && !seg.contains(':'))
        .collect::<Vec<_>>();
    let joined = if segments.is_empty() {
        "artifact.glb".to_owned()
    } else {
        segments.join("/")
    };
    let mut out = String::new();
    let mut utf16 = 0usize;
    for ch in joined.chars() {
        let len = ch.len_utf16();
        if utf16 + len > 512 {
            break;
        }
        out.push(ch);
        utf16 += len;
    }
    let trimmed = out.trim_end_matches(['/', '.']);
    if trimmed.is_empty() {
        "artifact.glb".to_owned()
    } else {
        trimmed.to_owned()
    }
}

struct ParsedGlb {
    format: &'static str,
    extensions_used: Vec<String>,
    content_summary: Option<GlbContentSummaryV01>,
    material_summary: Option<GlbMaterialSummaryV01>,
    texture_summary: Option<GlbTextureSummaryV01>,
    secondary_motion: Option<GlbSecondaryMotionSummaryV01>,
    vrm: Option<GlbVrmSummaryV01>,
    bounds_meters: Option<GlbBoundsMetersV01>,
}

impl ParsedGlb {
    fn invalid() -> Self {
        Self {
            format: "invalid_glb",
            extensions_used: Vec::new(),
            content_summary: None,
            material_summary: None,
            texture_summary: None,
            secondary_motion: None,
            vrm: None,
            bounds_meters: None,
        }
    }
}

pub fn inspect_glb_bytes(bytes: &[u8]) -> GlbInspectedFileV01 {
    let mut cursor = std::io::Cursor::new(bytes);
    let parsed = inspect_glb_reader(&mut cursor);
    build_inspected_item(
        "mem-copy".to_owned(),
        "model.glb".to_owned(),
        "standalone_file",
        None,
        bytes.len() as u64,
        parsed,
    )
}

fn inspect_glb_reader<R: Read>(reader: &mut R) -> ParsedGlb {
    let mut header = [0u8; 20];
    if reader.read_exact(&mut header).is_err() {
        return ParsedGlb::invalid();
    }
    let magic = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let version = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    let total_length = u32::from_le_bytes([header[8], header[9], header[10], header[11]]) as u64;
    let chunk0_len = u32::from_le_bytes([header[12], header[13], header[14], header[15]]) as usize;
    let chunk0_type = u32::from_le_bytes([header[16], header[17], header[18], header[19]]);

    if magic != GLB_MAGIC
        || version != GLB_VERSION_2
        || chunk0_type != GLB_CHUNK_JSON
        || chunk0_len == 0
        || chunk0_len > MAX_JSON_CHUNK_BYTES
        || (20 + chunk0_len as u64) > total_length
    {
        return ParsedGlb::invalid();
    }

    let mut json_bytes = vec![0u8; chunk0_len];
    if reader.read_exact(&mut json_bytes).is_err() {
        return ParsedGlb::invalid();
    }
    while json_bytes.last() == Some(&0) {
        json_bytes.pop();
    }

    let Ok(gltf) = serde_json::from_slice::<Value>(&json_bytes) else {
        return ParsedGlb::invalid();
    };
    let is_gltf_2 = gltf
        .get("asset")
        .and_then(|a| a.get("version"))
        .and_then(Value::as_str)
        .is_some_and(|v| v.starts_with("2."));
    if !is_gltf_2 {
        return ParsedGlb::invalid();
    }

    let extensions_used = extract_extensions_used(&gltf);
    let nodes_len = gltf
        .get("nodes")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);

    let (bounds_meters, node_world_y) = compute_scene_bounds_and_node_heights(&gltf);

    let (format, vrm) = if let Some(vrmc) = gltf
        .pointer("/extensions/VRMC_vrm")
        .and_then(Value::as_object)
    {
        (
            "vrm_1_0",
            Some(parse_vrm_1_0(vrmc, nodes_len, &node_world_y)),
        )
    } else if let Some(vrm0) = gltf.pointer("/extensions/VRM").and_then(Value::as_object) {
        (
            "vrm_0_x",
            Some(parse_vrm_0_x(vrm0, nodes_len, &node_world_y)),
        )
    } else {
        ("glb_2_0", None)
    };

    let content_summary = Some(extract_content_summary(&gltf));
    let material_summary = Some(extract_material_summary(&gltf));
    let texture_summary = Some(extract_texture_summary(&gltf));
    let secondary_motion = Some(extract_secondary_motion_summary(&gltf));

    ParsedGlb {
        format,
        extensions_used,
        content_summary,
        material_summary,
        texture_summary,
        secondary_motion,
        vrm,
        bounds_meters,
    }
}

fn extract_content_summary(gltf: &Value) -> GlbContentSummaryV01 {
    let meshes = gltf.get("meshes").and_then(Value::as_array);
    let accessors = gltf.get("accessors").and_then(Value::as_array);
    let mesh_count = meshes.map_or(0, |m| m.len().min(65_536));
    let mut primitive_count = 0usize;
    let mut triangle_estimate = 0u64;

    if let Some(meshes) = meshes {
        for mesh in meshes.iter().take(65_536) {
            let Some(prims) = mesh.get("primitives").and_then(Value::as_array) else {
                continue;
            };
            for prim in prims.iter().take(4_096) {
                primitive_count = primitive_count.saturating_add(1).min(1_000_000);
                let mode = prim.get("mode").and_then(Value::as_u64).unwrap_or(4);
                let tris = if let Some(idx_acc) = prim
                    .get("indices")
                    .and_then(Value::as_u64)
                    .and_then(|i| accessors?.get(i as usize))
                    .and_then(|a| a.get("count"))
                    .and_then(Value::as_u64)
                {
                    match mode {
                        4 => idx_acc / 3,
                        5 | 6 => idx_acc.saturating_sub(2),
                        _ => 0,
                    }
                } else if let Some(pos_acc) = prim
                    .get("attributes")
                    .and_then(|a| a.get("POSITION"))
                    .and_then(Value::as_u64)
                    .and_then(|i| accessors?.get(i as usize))
                    .and_then(|a| a.get("count"))
                    .and_then(Value::as_u64)
                {
                    match mode {
                        4 => pos_acc / 3,
                        5 | 6 => pos_acc.saturating_sub(2),
                        _ => 0,
                    }
                } else {
                    0
                };
                triangle_estimate = triangle_estimate.saturating_add(tris).min(1_000_000_000);
            }
        }
    }

    let skin_count = gltf
        .get("skins")
        .and_then(Value::as_array)
        .map_or(0, |a| a.len().min(4_096));
    let node_count = gltf
        .get("nodes")
        .and_then(Value::as_array)
        .map_or(0, |a| a.len().min(65_536));
    let animation_count = gltf
        .get("animations")
        .and_then(Value::as_array)
        .map_or(0, |a| a.len().min(4_096));

    GlbContentSummaryV01 {
        mesh_count,
        primitive_count,
        triangle_estimate,
        skin_count,
        node_count,
        animation_count,
    }
}

fn extract_material_summary(gltf: &Value) -> GlbMaterialSummaryV01 {
    let materials = gltf.get("materials").and_then(Value::as_array);
    let material_count = materials.map_or(0, |a| a.len().min(16_384));
    let mut unlit_material_count = 0usize;
    let mut mtoon_material_count = 0usize;

    if let Some(materials) = materials {
        for mat in materials.iter().take(16_384) {
            let exts = mat.get("extensions").and_then(Value::as_object);
            if exts.is_some_and(|e| e.contains_key("KHR_materials_unlit")) {
                unlit_material_count += 1;
            }
            if exts.is_some_and(|e| e.contains_key("VRMC_materials_mtoon")) {
                mtoon_material_count += 1;
            }
        }
    }

    if mtoon_material_count == 0 {
        if let Some(vrm0_mats) = gltf
            .pointer("/extensions/VRM/materialProperties")
            .and_then(Value::as_array)
        {
            mtoon_material_count = vrm0_mats
                .iter()
                .take(16_384)
                .filter(|m| {
                    m.get("shader")
                        .and_then(Value::as_str)
                        .is_some_and(|s| s.to_ascii_lowercase().contains("mtoon"))
                })
                .count();
        }
    }

    GlbMaterialSummaryV01 {
        material_count,
        unlit_material_count: unlit_material_count.min(material_count),
        mtoon_material_count: mtoon_material_count.min(16_384),
    }
}

fn extract_texture_summary(gltf: &Value) -> GlbTextureSummaryV01 {
    let texture_count = gltf
        .get("textures")
        .and_then(Value::as_array)
        .map_or(0, |a| a.len().min(16_384));
    let mut embedded_image_count = 0usize;
    let mut external_uri_texture_count = 0usize;

    if let Some(images) = gltf.get("images").and_then(Value::as_array) {
        for img in images.iter().take(16_384) {
            let has_buffer_view = img.get("bufferView").and_then(Value::as_u64).is_some();
            let uri = img.get("uri").and_then(Value::as_str).map(str::trim);
            match uri {
                Some(u) if !u.is_empty() => {
                    if u.to_ascii_lowercase().starts_with("data:") {
                        embedded_image_count += 1;
                    } else {
                        external_uri_texture_count += 1;
                    }
                }
                _ if has_buffer_view => {
                    embedded_image_count += 1;
                }
                _ => {}
            }
        }
    }

    GlbTextureSummaryV01 {
        texture_count,
        embedded_image_count,
        external_uri_texture_count,
    }
}

fn extract_secondary_motion_summary(gltf: &Value) -> GlbSecondaryMotionSummaryV01 {
    let mut spring_bone_joint_count = 0usize;
    if let Some(springs) = gltf
        .pointer("/extensions/VRMC_springBone/springs")
        .and_then(Value::as_array)
    {
        for sp in springs.iter().take(4_096) {
            if let Some(joints) = sp.get("joints").and_then(Value::as_array) {
                spring_bone_joint_count = spring_bone_joint_count
                    .saturating_add(joints.len())
                    .min(65_536);
            }
        }
    } else if let Some(groups) = gltf
        .pointer("/extensions/VRM/secondaryAnimation/boneGroups")
        .and_then(Value::as_array)
    {
        for grp in groups.iter().take(4_096) {
            if let Some(bones) = grp.get("bones").and_then(Value::as_array) {
                spring_bone_joint_count = spring_bone_joint_count
                    .saturating_add(bones.len())
                    .min(65_536);
            }
        }
    }

    let node_constraint_count = gltf
        .get("nodes")
        .and_then(Value::as_array)
        .map_or(0, |nodes| {
            nodes
                .iter()
                .take(65_536)
                .filter(|n| {
                    n.pointer("/extensions/VRMC_node_constraint")
                        .and_then(Value::as_object)
                        .is_some()
                })
                .count()
        });

    let mut expression_count = 0usize;
    if let Some(exprs) = gltf
        .pointer("/extensions/VRMC_vrm/expressions")
        .and_then(Value::as_object)
    {
        let preset_len = exprs
            .get("preset")
            .and_then(Value::as_object)
            .map_or(0, serde_json::Map::len);
        let custom_len = exprs
            .get("custom")
            .and_then(Value::as_object)
            .map_or(0, serde_json::Map::len);
        expression_count = preset_len.saturating_add(custom_len).min(4_096);
    } else if let Some(groups) = gltf
        .pointer("/extensions/VRM/blendShapeMaster/blendShapeGroups")
        .and_then(Value::as_array)
    {
        expression_count = groups.len().min(4_096);
    }

    GlbSecondaryMotionSummaryV01 {
        spring_bone_joint_count,
        node_constraint_count,
        expression_count,
    }
}

fn trunc_utf16(raw: &str, max_utf16: usize) -> String {
    let mut out = String::new();
    let mut used = 0usize;
    for ch in raw.chars() {
        let len = ch.len_utf16();
        if used + len > max_utf16 {
            break;
        }
        out.push(ch);
        used += len;
    }
    out
}

fn opt_str(v: Option<&Value>, max_utf16: usize) -> Option<String> {
    v.and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| trunc_utf16(s, max_utf16))
}

fn extract_extensions_used(gltf: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(arr) = gltf.get("extensionsUsed").and_then(Value::as_array) {
        for entry in arr.iter().filter_map(Value::as_str) {
            let trimmed = entry.trim();
            if trimmed.is_empty() {
                continue;
            }
            let bounded = trunc_utf16(trimmed, 128);
            if !out.contains(&bounded) {
                out.push(bounded);
                if out.len() >= 64 {
                    break;
                }
            }
        }
    }
    out
}

fn bounded_bone_height(node_idx: Option<usize>, node_world_y: &HashMap<usize, f64>) -> Option<f64> {
    let idx = node_idx?;
    let y = *node_world_y.get(&idx)?;
    if y.is_finite() && (0.0..=10.0).contains(&y) {
        Some(round6(y))
    } else {
        None
    }
}

fn parse_vrm_1_0(
    vrmc: &serde_json::Map<String, Value>,
    nodes_len: usize,
    node_world_y: &HashMap<usize, f64>,
) -> GlbVrmSummaryV01 {
    let human_bones = vrmc
        .get("humanoid")
        .and_then(|h| h.get("humanBones"))
        .and_then(Value::as_object);
    let bone_count = human_bones.map_or(0, |m| m.len().min(512));

    let bone_node_idx = |name: &str| -> Option<usize> {
        human_bones
            .and_then(|m| m.get(name))
            .and_then(|b| b.get("node"))
            .and_then(Value::as_u64)
            .map(|idx| idx as usize)
            .filter(|idx| *idx < nodes_len)
    };

    let head_node = bone_node_idx("head");
    let has_humanoid_head_bone = head_node.is_some();
    let has_full_body_bones = FULL_BODY_HUMANOID_BONES
        .iter()
        .all(|bone| bone_node_idx(bone).is_some());
    let has_toe_bones = bone_node_idx("leftToes").is_some() && bone_node_idx("rightToes").is_some();
    let head_bone_height_meters = bounded_bone_height(head_node, node_world_y);

    let meta = vrmc.get("meta").and_then(Value::as_object);
    let authors = meta
        .and_then(|m| m.get("authors"))
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .take(32)
                .map(|s| trunc_utf16(s, 256))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    GlbVrmSummaryV01 {
        spec_version: opt_str(vrmc.get("specVersion"), 32),
        has_humanoid_head_bone,
        has_full_body_bones,
        has_toe_bones,
        head_bone_height_meters,
        bone_count,
        model_name: opt_str(meta.and_then(|m| m.get("name")), 256),
        authors,
        avatar_permission: opt_str(meta.and_then(|m| m.get("avatarPermission")), 64),
        commercial_usage: opt_str(meta.and_then(|m| m.get("commercialUsage")), 64),
        modification: opt_str(meta.and_then(|m| m.get("modification")), 64),
        license_url: opt_str(
            meta.and_then(|m| m.get("otherLicenseUrl").or_else(|| m.get("licenseUrl"))),
            2048,
        ),
    }
}

fn parse_vrm_0_x(
    vrm0: &serde_json::Map<String, Value>,
    nodes_len: usize,
    node_world_y: &HashMap<usize, f64>,
) -> GlbVrmSummaryV01 {
    let bones_arr = vrm0
        .get("humanoid")
        .and_then(|h| h.get("humanBones"))
        .and_then(Value::as_array);
    let bone_count = bones_arr.map_or(0, |a| a.len().min(512));

    let bone_node_idx = |target: &str| -> Option<usize> {
        let arr = bones_arr?;
        arr.iter().find_map(|entry| {
            let matches_name = entry
                .get("bone")
                .and_then(Value::as_str)
                .is_some_and(|b| b.eq_ignore_ascii_case(target));
            if !matches_name {
                return None;
            }
            entry
                .get("node")
                .and_then(Value::as_u64)
                .map(|idx| idx as usize)
                .filter(|idx| *idx < nodes_len)
        })
    };

    let head_node = bone_node_idx("head");
    let has_humanoid_head_bone = head_node.is_some();
    let has_full_body_bones = FULL_BODY_HUMANOID_BONES
        .iter()
        .all(|bone| bone_node_idx(bone).is_some());
    let has_toe_bones = bone_node_idx("leftToes").is_some() && bone_node_idx("rightToes").is_some();
    let head_bone_height_meters = bounded_bone_height(head_node, node_world_y);

    let meta = vrm0.get("meta").and_then(Value::as_object);
    let authors = opt_str(meta.and_then(|m| m.get("author")), 256)
        .into_iter()
        .collect::<Vec<_>>();

    GlbVrmSummaryV01 {
        spec_version: opt_str(
            vrm0.get("specVersion")
                .or_else(|| vrm0.get("exporterVersion")),
            32,
        ),
        has_humanoid_head_bone,
        has_full_body_bones,
        has_toe_bones,
        head_bone_height_meters,
        bone_count,
        model_name: opt_str(meta.and_then(|m| m.get("title")), 256),
        authors,
        avatar_permission: opt_str(meta.and_then(|m| m.get("allowedUserName")), 64),
        commercial_usage: opt_str(
            meta.and_then(|m| {
                m.get("commercialUssageName")
                    .or_else(|| m.get("commercialUsageName"))
            }),
            64,
        ),
        modification: opt_str(meta.and_then(|m| m.get("licenseName")), 64),
        license_url: opt_str(
            meta.and_then(|m| {
                m.get("otherLicenseUrl")
                    .or_else(|| m.get("otherPermissionUrl"))
            }),
            2048,
        ),
    }
}

fn round6(v: f64) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    let r = (v * 1_000_000.0).round() / 1_000_000.0;
    if !r.is_finite() || r == 0.0 {
        0.0
    } else {
        r
    }
}

type Mat4 = [f64; 16]; // column-major 4x4

const IDENTITY_MAT4: Mat4 = [
    1.0, 0.0, 0.0, 0.0, // col 0
    0.0, 1.0, 0.0, 0.0, // col 1
    0.0, 0.0, 1.0, 0.0, // col 2
    0.0, 0.0, 0.0, 1.0, // col 3
];

fn mul_mat4(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [0.0f64; 16];
    for col in 0..4 {
        for row in 0..4 {
            let mut sum = 0.0;
            for k in 0..4 {
                sum += a[k * 4 + row] * b[col * 4 + k];
            }
            out[col * 4 + row] = sum;
        }
    }
    out
}

fn transform_point(m: &Mat4, p: [f64; 3]) -> Option<[f64; 3]> {
    let x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    let y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    let z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    if x.is_finite()
        && y.is_finite()
        && z.is_finite()
        && x.abs() <= MAX_COORD_METERS
        && y.abs() <= MAX_COORD_METERS
        && z.abs() <= MAX_COORD_METERS
    {
        Some([x, y, z])
    } else {
        None
    }
}

fn parse_f64_slice<const N: usize>(val: Option<&Value>) -> Option<[f64; N]> {
    let arr = val?.as_array()?;
    if arr.len() != N {
        return None;
    }
    let mut out = [0.0f64; N];
    for (i, item) in arr.iter().enumerate() {
        let num = item.as_f64()?;
        if !num.is_finite() {
            return None;
        }
        out[i] = num;
    }
    Some(out)
}

fn node_local_matrix(node: &Value) -> Mat4 {
    if let Some(mat) = parse_f64_slice::<16>(node.get("matrix")) {
        return mat;
    }
    let t = parse_f64_slice::<3>(node.get("translation")).unwrap_or([0.0, 0.0, 0.0]);
    let r = parse_f64_slice::<4>(node.get("rotation")).unwrap_or([0.0, 0.0, 0.0, 1.0]);
    let s = parse_f64_slice::<3>(node.get("scale")).unwrap_or([1.0, 1.0, 1.0]);

    let norm_sq = r[0] * r[0] + r[1] * r[1] + r[2] * r[2] + r[3] * r[3];
    let (qx, qy, qz, qw) = if norm_sq > 1e-12 {
        let inv = 1.0 / norm_sq.sqrt();
        (r[0] * inv, r[1] * inv, r[2] * inv, r[3] * inv)
    } else {
        (0.0, 0.0, 0.0, 1.0)
    };

    let xx = qx * qx;
    let yy = qy * qy;
    let zz = qz * qz;
    let xy = qx * qy;
    let xz = qx * qz;
    let yz = qy * qz;
    let wx = qw * qx;
    let wy = qw * qy;
    let wz = qw * qz;

    let r00 = (1.0 - 2.0 * (yy + zz)) * s[0];
    let r10 = (2.0 * (xy + wz)) * s[0];
    let r20 = (2.0 * (xz - wy)) * s[0];

    let r01 = (2.0 * (xy - wz)) * s[1];
    let r11 = (1.0 - 2.0 * (xx + zz)) * s[1];
    let r21 = (2.0 * (yz + wx)) * s[1];

    let r02 = (2.0 * (xz + wy)) * s[2];
    let r12 = (2.0 * (yz - wx)) * s[2];
    let r22 = (1.0 - 2.0 * (xx + yy)) * s[2];

    [
        r00, r10, r20, 0.0, // col 0
        r01, r11, r21, 0.0, // col 1
        r02, r12, r22, 0.0, // col 2
        t[0], t[1], t[2], 1.0, // col 3
    ]
}

fn compute_scene_bounds_and_node_heights(
    gltf: &Value,
) -> (Option<GlbBoundsMetersV01>, HashMap<usize, f64>) {
    let mut node_world_y = HashMap::new();
    let Some(nodes) = gltf.get("nodes").and_then(Value::as_array) else {
        return (None, node_world_y);
    };
    if nodes.is_empty() {
        return (None, node_world_y);
    }
    let meshes = gltf
        .get("meshes")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let accessors = gltf
        .get("accessors")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let root_indices: Vec<usize> = if let Some(scenes) = gltf
        .get("scenes")
        .and_then(Value::as_array)
        .filter(|s| !s.is_empty())
    {
        let active = gltf
            .get("scene")
            .and_then(Value::as_u64)
            .map(|i| i as usize)
            .filter(|i| *i < scenes.len())
            .unwrap_or(0);
        scenes[active]
            .get("nodes")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_u64)
                    .map(|i| i as usize)
                    .filter(|i| *i < nodes.len())
                    .collect()
            })
            .unwrap_or_default()
    } else {
        let mut referenced = HashSet::new();
        for node in nodes {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                for child in children.iter().filter_map(Value::as_u64) {
                    referenced.insert(child as usize);
                }
            }
        }
        (0..nodes.len())
            .filter(|i| !referenced.contains(i))
            .collect()
    };

    let mut global_min = [f64::INFINITY; 3];
    let mut global_max = [f64::NEG_INFINITY; 3];
    let mut found_any = false;
    let mut active_path = HashSet::new();
    let mut visits = 0usize;

    #[allow(clippy::too_many_arguments)]
    fn visit_node(
        node_idx: usize,
        parent_world: &Mat4,
        depth: usize,
        nodes: &[Value],
        meshes: &[Value],
        accessors: &[Value],
        active_path: &mut HashSet<usize>,
        visits: &mut usize,
        node_world_y: &mut HashMap<usize, f64>,
        global_min: &mut [f64; 3],
        global_max: &mut [f64; 3],
        found_any: &mut bool,
    ) {
        if *visits >= MAX_SCENE_VISITS
            || depth > MAX_SCENE_DEPTH
            || node_idx >= nodes.len()
            || !active_path.insert(node_idx)
        {
            return;
        }
        *visits += 1;
        let node = &nodes[node_idx];
        let local = node_local_matrix(node);
        let world = mul_mat4(parent_world, &local);
        if world[13].is_finite() {
            node_world_y.entry(node_idx).or_insert(world[13]);
        }

        if let Some(mesh_idx) = node
            .get("mesh")
            .and_then(Value::as_u64)
            .map(|i| i as usize)
            .filter(|i| *i < meshes.len())
        {
            if let Some(primitives) = meshes[mesh_idx].get("primitives").and_then(Value::as_array) {
                for prim in primitives {
                    let Some(pos_idx) = prim
                        .get("attributes")
                        .and_then(|a| a.get("POSITION"))
                        .and_then(Value::as_u64)
                        .map(|i| i as usize)
                        .filter(|i| *i < accessors.len())
                    else {
                        continue;
                    };
                    let acc = &accessors[pos_idx];
                    if acc.get("type").and_then(Value::as_str) != Some("VEC3") {
                        continue;
                    }
                    let (Some(mn), Some(mx)) = (
                        parse_f64_slice::<3>(acc.get("min")),
                        parse_f64_slice::<3>(acc.get("max")),
                    ) else {
                        continue;
                    };
                    if mn[0] > mx[0] || mn[1] > mx[1] || mn[2] > mx[2] {
                        continue;
                    }
                    for &cx in &[mn[0], mx[0]] {
                        for &cy in &[mn[1], mx[1]] {
                            for &cz in &[mn[2], mx[2]] {
                                if let Some(tp) = transform_point(&world, [cx, cy, cz]) {
                                    for axis in 0..3 {
                                        global_min[axis] = global_min[axis].min(tp[axis]);
                                        global_max[axis] = global_max[axis].max(tp[axis]);
                                    }
                                    *found_any = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        if let Some(children) = node.get("children").and_then(Value::as_array) {
            for child in children.iter().filter_map(Value::as_u64) {
                visit_node(
                    child as usize,
                    &world,
                    depth + 1,
                    nodes,
                    meshes,
                    accessors,
                    active_path,
                    visits,
                    node_world_y,
                    global_min,
                    global_max,
                    found_any,
                );
            }
        }
        active_path.remove(&node_idx);
    }

    for root in root_indices {
        visit_node(
            root,
            &IDENTITY_MAT4,
            0,
            nodes,
            meshes,
            accessors,
            &mut active_path,
            &mut visits,
            &mut node_world_y,
            &mut global_min,
            &mut global_max,
            &mut found_any,
        );
    }

    if !found_any {
        return (None, node_world_y);
    }

    let min = [
        round6(global_min[0]),
        round6(global_min[1]),
        round6(global_min[2]),
    ];
    let max = [
        round6(global_max[0]),
        round6(global_max[1]),
        round6(global_max[2]),
    ];
    let size = [
        round6((global_max[0] - global_min[0]).max(0.0)),
        round6((global_max[1] - global_min[1]).max(0.0)),
        round6((global_max[2] - global_min[2]).max(0.0)),
    ];
    (Some(GlbBoundsMetersV01 { size, min, max }), node_world_y)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn pack_synthetic_glb(json_doc: &Value, bin_tail_len: usize) -> Vec<u8> {
        let mut json_bytes = serde_json::to_vec(json_doc).unwrap();
        while !json_bytes.len().is_multiple_of(4) {
            json_bytes.push(b' ');
        }
        let bin_padded = (bin_tail_len + 3) & !3;
        let total_len = 12 + 8 + json_bytes.len() + if bin_padded > 0 { 8 + bin_padded } else { 0 };

        let mut out = Vec::with_capacity(total_len);
        out.extend_from_slice(&GLB_MAGIC.to_le_bytes());
        out.extend_from_slice(&GLB_VERSION_2.to_le_bytes());
        out.extend_from_slice(&(total_len as u32).to_le_bytes());
        out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&GLB_CHUNK_JSON.to_le_bytes());
        out.extend_from_slice(&json_bytes);
        if bin_padded > 0 {
            out.extend_from_slice(&(bin_padded as u32).to_le_bytes());
            out.extend_from_slice(&0x004E_4942u32.to_le_bytes()); // "BIN\0"
            out.resize(total_len, 0xAA);
        }
        out
    }

    #[test]
    fn inspects_vrm_1_0_humanoid_head_full_body_toes_and_summaries_without_reading_bin() {
        let mut nodes = Vec::new();
        // Node 0: root hips with mesh; nodes 1..17: humanoid bones including head at y=1.34m and toes.
        nodes.push(json!({
            "name": "Hips",
            "mesh": 0,
            "translation": [0.0, 0.82, 0.0],
            "children": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            "extensions": { "VRMC_node_constraint": { "specVersion": "1.0" } }
        }));
        nodes.push(json!({ "name": "HeadBone", "translation": [0.0, 0.52, 0.0] }));
        for idx in 2..=16 {
            nodes.push(json!({ "name": format!("Bone{idx}") }));
        }

        let doc = json!({
            "asset": { "version": "2.0" },
            "extensionsUsed": ["VRMC_vrm", "VRMC_springBone", "VRMC_materials_mtoon", "VRMC_node_constraint"],
            "scene": 0,
            "scenes": [{ "nodes": [0] }],
            "nodes": nodes,
            "skins": [{ "joints": [0, 1] }],
            "meshes": [{
                "primitives": [{ "attributes": { "POSITION": 0 }, "indices": 1, "material": 0 }]
            }],
            "materials": [{
                "name": "BodyMToon",
                "extensions": { "VRMC_materials_mtoon": { "specVersion": "1.0" } }
            }],
            "textures": [{ "source": 0 }, { "source": 1 }],
            "images": [
                { "bufferView": 0, "mimeType": "image/png" },
                { "uri": "textures/external_albedo.png" }
            ],
            "accessors": [
                {
                    "type": "VEC3",
                    "componentType": 5126,
                    "count": 24,
                    "min": [-0.23, -0.82, -0.15],
                    "max": [0.23, 0.66, 0.16]
                },
                {
                    "type": "SCALAR",
                    "componentType": 5123,
                    "count": 36
                }
            ],
            "extensions": {
                "VRMC_springBone": {
                    "specVersion": "1.0",
                    "springs": [{ "joints": [{ "node": 2 }, { "node": 3 }] }]
                },
                "VRMC_vrm": {
                    "specVersion": "1.0",
                    "meta": {
                        "name": "Kipfel VRM1",
                        "authors": ["Studio Example"],
                        "avatarPermission": "onlyAuthor",
                        "commercialUsage": "personalNonProfit",
                        "modification": "allowModification",
                        "otherLicenseUrl": "https://vrm.dev/licenses/1.0/"
                    },
                    "expressions": {
                        "preset": { "happy": {}, "blink": {} },
                        "custom": { "wink_star": {} }
                    },
                    "humanoid": {
                        "humanBones": {
                            "hips": { "node": 0 },
                            "head": { "node": 1 },
                            "spine": { "node": 2 },
                            "leftUpperLeg": { "node": 3 },
                            "leftLowerLeg": { "node": 4 },
                            "leftFoot": { "node": 5 },
                            "rightUpperLeg": { "node": 6 },
                            "rightLowerLeg": { "node": 7 },
                            "rightFoot": { "node": 8 },
                            "leftUpperArm": { "node": 9 },
                            "leftLowerArm": { "node": 10 },
                            "leftHand": { "node": 11 },
                            "rightUpperArm": { "node": 12 },
                            "rightLowerArm": { "node": 13 },
                            "rightHand": { "node": 14 },
                            "leftToes": { "node": 15 },
                            "rightToes": { "node": 16 }
                        }
                    }
                }
            }
        });
        let glb = pack_synthetic_glb(&doc, 4096);
        let res = inspect_glb_bytes(&glb);
        assert_eq!(res.format, "vrm_1_0");
        assert_eq!(res.source_kind, "standalone_file");
        assert_eq!(res.container_file_name, None);
        let vrm = res.vrm.expect("vrm summary");
        assert!(vrm.has_humanoid_head_bone);
        assert!(vrm.has_full_body_bones);
        assert!(vrm.has_toe_bones);
        assert_eq!(vrm.head_bone_height_meters, Some(1.34));
        assert_eq!(vrm.bone_count, 17);
        assert_eq!(vrm.model_name.as_deref(), Some("Kipfel VRM1"));
        assert_eq!(vrm.authors, vec!["Studio Example"]);
        let content = res.content_summary.expect("content");
        assert_eq!(content.mesh_count, 1);
        assert_eq!(content.triangle_estimate, 12);
        assert_eq!(content.skin_count, 1);
        let mats = res.material_summary.expect("materials");
        assert_eq!(mats.mtoon_material_count, 1);
        let tex = res.texture_summary.expect("textures");
        assert_eq!(tex.embedded_image_count, 1);
        assert_eq!(tex.external_uri_texture_count, 1);
        let sec = res.secondary_motion.expect("secondary");
        assert_eq!(sec.spring_bone_joint_count, 2);
        assert_eq!(sec.node_constraint_count, 1);
        assert_eq!(sec.expression_count, 3);
        let bounds = res.bounds_meters.expect("bounds");
        assert_eq!(bounds.size, [0.46, 1.48, 0.31]);
    }

    #[test]
    fn streams_glb_and_vrm_headers_directly_from_unexpanded_zip_without_disk_extraction() {
        let dir = std::env::temp_dir().join(format!("vua-glb-zip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("BoothPack.zip");

        let glb_bytes = pack_synthetic_glb(
            &json!({
                "asset": { "version": "2.0" },
                "scene": 0,
                "scenes": [{ "nodes": [0] }],
                "nodes": [{ "mesh": 0, "translation": [0.0, 0.05, 0.0] }],
                "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
                "accessors": [{
                    "type": "VEC3",
                    "count": 24,
                    "min": [-0.20, -0.20, -0.20],
                    "max": [0.20, 0.20, 0.20]
                }]
            }),
            8192,
        );

        {
            let f = File::create(&zip_path).unwrap();
            let mut writer = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer.start_file("Props/TVHead.glb", opts).unwrap();
            writer.write_all(&glb_bytes).unwrap();
            writer.start_file("Readme.txt", opts).unwrap();
            writer.write_all(b"hello").unwrap();
            writer.finish().unwrap();
        }

        let mut items = Vec::new();
        let mut truncated = false;
        inspect_unexpanded_zip_members(
            &zip_path,
            "copy-zip-1",
            "BoothPack.zip",
            &mut items,
            &mut truncated,
        );
        let _ = std::fs::remove_dir_all(&dir);

        assert!(!truncated);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.copy_id, "copy-zip-1");
        assert_eq!(item.file_name, "Props/TVHead.glb");
        assert_eq!(item.source_kind, "zip_member");
        assert_eq!(item.container_file_name.as_deref(), Some("BoothPack.zip"));
        assert_eq!(item.bounds_meters.as_ref().unwrap().size, [0.4, 0.4, 0.4]);
    }

    #[test]
    fn detects_vrm1_missing_head_and_vrm0_upgrade_candidates() {
        let vrm1_no_head = pack_synthetic_glb(
            &json!({
                "asset": { "version": "2.0" },
                "nodes": [{ "name": "Hips" }],
                "extensions": {
                    "VRMC_vrm": {
                        "specVersion": "1.0",
                        "humanoid": { "humanBones": { "hips": { "node": 0 } } }
                    }
                }
            }),
            0,
        );
        let r1 = inspect_glb_bytes(&vrm1_no_head);
        assert_eq!(r1.format, "vrm_1_0");
        assert!(!r1.vrm.unwrap().has_humanoid_head_bone);

        let vrm0 = pack_synthetic_glb(
            &json!({
                "asset": { "version": "2.0" },
                "nodes": [{ "name": "Head", "translation": [0.0, 1.41, 0.0] }],
                "extensions": {
                    "VRM": {
                        "exporterVersion": "UniVRM-0.115.0",
                        "meta": { "title": "LegacyAvatar", "author": "CreatorA" },
                        "humanoid": { "humanBones": [{ "bone": "head", "node": 0 }] }
                    }
                }
            }),
            0,
        );
        let r0 = inspect_glb_bytes(&vrm0);
        assert_eq!(r0.format, "vrm_0_x");
        let vrm0_summary = r0.vrm.unwrap();
        assert!(vrm0_summary.has_humanoid_head_bone);
        assert!(!vrm0_summary.has_full_body_bones);
        assert_eq!(vrm0_summary.head_bone_height_meters, Some(1.41));
    }

    #[test]
    fn computes_trs_scaled_bounds_and_rejects_invalid_glb_headers() {
        let scaled_pass = pack_synthetic_glb(
            &json!({
                "asset": { "version": "2.0" },
                "scene": 0,
                "scenes": [{ "nodes": [0] }],
                "nodes": [{ "mesh": 0, "scale": [0.01, 0.01, 0.01] }],
                "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
                "accessors": [{
                    "type": "VEC3",
                    "min": [-20.0, -21.0, -22.0],
                    "max": [20.0, 21.0, 22.0]
                }]
            }),
            0,
        );
        let pass_res = inspect_glb_bytes(&scaled_pass);
        assert_eq!(pass_res.format, "glb_2_0");
        assert_eq!(
            pass_res.bounds_meters.as_ref().unwrap().size,
            [0.4, 0.42, 0.44]
        );

        let bad = inspect_glb_bytes(b"NOT_A_GLB_FILE_AT_ALL_12345");
        assert_eq!(bad.format, "invalid_glb");
        assert!(bad.content_summary.is_none());
    }

    #[test]
    fn sanitizes_relative_filenames_against_drive_and_traversal_prefixes() {
        assert_eq!(
            sanitize_relative_file_name("C:\\Users\\Alice\\Models\\Head.glb"),
            "Users/Alice/Models/Head.glb"
        );
        assert_eq!(
            sanitize_relative_file_name("..\\..\\Sub\\Avatar.vrm"),
            "Sub/Avatar.vrm"
        );
        assert_eq!(sanitize_relative_file_name("v1../Avatar.vrm"), "Avatar.vrm");
        let long_prefix = format!("{}/..tail.glb", "a".repeat(510));
        let sanitized = sanitize_relative_file_name(&long_prefix);
        assert!(!sanitized.contains(".."));
        assert!(!sanitized.ends_with('/'));
    }

    #[test]
    fn guards_against_extreme_accessor_floats_and_clamps_zip64_size_bytes() {
        let extreme = pack_synthetic_glb(
            &json!({
                "asset": { "version": "2.0" },
                "scene": 0,
                "scenes": [{ "nodes": [0] }],
                "nodes": [{ "mesh": 0, "scale": [1e200, 1e200, 1e200] }],
                "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 } }] }],
                "accessors": [{
                    "type": "VEC3",
                    "min": [-1e200, -1e200, -1e200],
                    "max": [1e200, 1e200, 1e200]
                }]
            }),
            0,
        );
        let parsed = inspect_glb_bytes(&extreme);
        assert!(parsed.bounds_meters.is_none());

        let mut cursor = std::io::Cursor::new(&extreme);
        let item = build_inspected_item(
            "copy-1".to_owned(),
            "Avatar.vrm".to_owned(),
            "zip_member",
            Some("bundle.zip".to_owned()),
            u64::MAX,
            inspect_glb_reader(&mut cursor),
        );
        assert_eq!(item.size_bytes, MAX_SAFE_JS_INT);
        let serialized = serde_json::to_string(&item).unwrap();
        assert!(!serialized.contains(":null,") || serialized.contains("\"vrm\":null"));
    }
}

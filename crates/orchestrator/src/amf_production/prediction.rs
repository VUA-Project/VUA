//! Pre-assembly cost prediction (freeze row F5, slice 35 item 2). The plan lists, for the
//! Avatar and every selected outfit, the size, triangles, material slots, texture memory,
//! PhysBones and synced parameter bits the assembled Avatar is expected to carry. Every
//! count is read from the imported prefab before assembly; texture memory reuses the
//! texture-memory report's decoded-size rules (slice 9) and parameter bits reuse the
//! parameter-budget estimate (slice 33). The SDK's own measurement after the build remains
//! the authoritative number — see the tolerance table in docs/protocols/amf-production-v0.1.md.
use super::parameter_budget::estimate_parameters;
use super::*;

/// The platform whose imported texture settings the prediction decodes.
pub const PREDICTION_PLATFORM: &str = "pc";

/// Plausible bounds for one observation; a receipt beyond them is a contract violation, not
/// a number to display.
const MAX_TRIANGLES: u64 = 500_000_000;
const MAX_RENDERERS: u32 = 4096;
const MAX_MATERIAL_SLOTS: u32 = 8192;
const MAX_BYTES: u64 = 1 << 40;
const MAX_PHYS_BONES: u32 = 65536;

pub fn footprint_valid(footprint: &CandidateFootprint) -> bool {
    footprint.triangles <= MAX_TRIANGLES
        && footprint.meshes <= MAX_RENDERERS
        && footprint.skinned_meshes <= footprint.meshes
        && footprint.material_slots <= MAX_MATERIAL_SLOTS
        && footprint.texture_bytes <= MAX_BYTES
        && footprint.mesh_bytes <= MAX_BYTES
        && footprint.phys_bones <= MAX_PHYS_BONES
}

/// Every candidate's footprint must stay inside its contract before it is stored.
pub fn validate_prefab_footprints(prefabs: &[PrefabCandidate]) -> Result<(), AppErrorV1> {
    if prefabs.iter().any(|prefab| {
        prefab
            .footprint
            .as_ref()
            .is_some_and(|footprint| !footprint_valid(footprint))
    }) {
        return Err(production_error(
            "receipt_invalid",
            "Footprint evidence exceeds its contract.",
        ));
    }
    Ok(())
}

/// What one candidate contributes: the six table values, mesh breakdown for rank prediction,
/// plus whether every table value was decided.
struct PredictedRow {
    source_id: String,
    name: String,
    role: &'static str,
    triangles: u64,
    skinned_meshes: u32,
    basic_meshes: u32,
    material_slots: u32,
    texture_bytes: u64,
    phys_bones: u32,
    parameter_bits: Option<u32>,
    uncompressed_bytes: u64,
    complete: bool,
}

impl PredictedRow {
    fn json(&self) -> serde_json::Value {
        serde_json::json!({"sourceId":self.source_id,"name":self.name,"role":self.role,
            "triangles":self.triangles,"materialSlots":self.material_slots,
            "textureBytes":self.texture_bytes,"physBones":self.phys_bones,
            "parameterBits":self.parameter_bits,"uncompressedBytes":self.uncompressed_bytes,
            "complete":self.complete})
    }
}

/// Official VRChat SDK PC performance thresholds across observed footprint metrics
/// (`triangles`, `skinnedMeshes`, `basicMeshes`, `materialSlots`, `textureBytes`, `physBones`).
fn predict_pc_rank(
    triangles: u64,
    skinned_meshes: u32,
    basic_meshes: u32,
    material_slots: u32,
    texture_bytes: u64,
    phys_bones: u32,
) -> serde_json::Value {
    let rank = if triangles <= 32_000
        && skinned_meshes <= 1
        && basic_meshes <= 4
        && material_slots <= 4
        && texture_bytes <= (40 << 20)
        && phys_bones <= 4
    {
        "excellent"
    } else if triangles <= 70_000
        && skinned_meshes <= 2
        && basic_meshes <= 8
        && material_slots <= 8
        && texture_bytes <= (75 << 20)
        && phys_bones <= 8
    {
        "good"
    } else if triangles <= 70_000
        && skinned_meshes <= 8
        && basic_meshes <= 16
        && material_slots <= 16
        && texture_bytes <= (110 << 20)
        && phys_bones <= 16
    {
        "medium"
    } else if triangles <= 70_000
        && skinned_meshes <= 16
        && basic_meshes <= 24
        && material_slots <= 32
        && texture_bytes <= (150 << 20)
        && phys_bones <= 32
    {
        "poor"
    } else {
        "very_poor"
    };
    let mut limiting = Vec::new();
    if triangles > 70_000 {
        limiting.push("triangles");
    }
    if skinned_meshes > 2 {
        limiting.push("skinnedMeshes");
    }
    if basic_meshes > 8 {
        limiting.push("basicMeshes");
    }
    if material_slots > 8 {
        limiting.push("materialSlots");
    }
    if texture_bytes > (75 << 20) {
        limiting.push("textureBytes");
    }
    if phys_bones > 8 {
        limiting.push("physBones");
    }
    serde_json::json!({
        "rank": rank,
        "limitingMetrics": limiting,
    })
}

/// Official VRChat SDK Android / Quest / PICO performance thresholds across observed footprint
/// metrics (`triangles`, `skinnedMeshes`, `basicMeshes`, `materialSlots`, `textureBytes`, `physBones`).
fn predict_android_rank(
    triangles: u64,
    skinned_meshes: u32,
    basic_meshes: u32,
    material_slots: u32,
    texture_bytes: u64,
    phys_bones: u32,
) -> serde_json::Value {
    let rank = if triangles <= 7_500
        && skinned_meshes <= 1
        && basic_meshes <= 1
        && material_slots <= 1
        && texture_bytes <= (10 << 20)
        && phys_bones == 0
    {
        "excellent"
    } else if triangles <= 10_000
        && skinned_meshes <= 1
        && basic_meshes <= 1
        && material_slots <= 1
        && texture_bytes <= (18 << 20)
        && phys_bones <= 4
    {
        "good"
    } else if triangles <= 15_000
        && skinned_meshes <= 2
        && basic_meshes <= 2
        && material_slots <= 2
        && texture_bytes <= (25 << 20)
        && phys_bones <= 6
    {
        "medium"
    } else if triangles <= 20_000
        && skinned_meshes <= 2
        && basic_meshes <= 2
        && material_slots <= 4
        && texture_bytes <= (40 << 20)
        && phys_bones <= 8
    {
        "poor"
    } else {
        "very_poor"
    };
    let mut limiting = Vec::new();
    if triangles > 10_000 {
        limiting.push("triangles");
    }
    if skinned_meshes > 1 {
        limiting.push("skinnedMeshes");
    }
    if basic_meshes > 1 {
        limiting.push("basicMeshes");
    }
    if material_slots > 1 {
        limiting.push("materialSlots");
    }
    if texture_bytes > (18 << 20) {
        limiting.push("textureBytes");
    }
    if phys_bones > 4 {
        limiting.push("physBones");
    }
    serde_json::json!({
        "rank": rank,
        "limitingMetrics": limiting,
    })
}

/// The plan's pre-assembly prediction. The document is `available: false` with no rows when
/// a selected candidate carries no footprint (an AMF build that predates the observation),
/// so the page can stay honest instead of showing zeros.
pub fn plan_prediction(run: &ProductionRun, selection: &AssemblySelection) -> serde_json::Value {
    let parameters = estimate_parameters(run, selection);
    let avatar = run
        .prefabs
        .iter()
        .find(|prefab| prefab.is_avatar && prefab.path == selection.avatar_prefab);
    let outfits: Vec<(&OutfitSelection, &PrefabCandidate)> = selection
        .outfits
        .iter()
        .filter_map(|outfit| {
            run.prefabs
                .iter()
                .find(|prefab| {
                    !prefab.is_avatar
                        && prefab.source_id == outfit.source_id
                        && prefab.path == outfit.prefab_path
                })
                .map(|prefab| (outfit, prefab))
        })
        .collect();
    let selected: Vec<(&'static str, &PrefabCandidate)> = avatar
        .map(|prefab| ("avatar", prefab))
        .into_iter()
        .chain(outfits.iter().map(|(_, prefab)| ("outfit", *prefab)))
        .collect();
    let tolerance = serde_json::json!({"counts":"exact","textureBytes":"decoded_estimate",
        "uncompressedBytes":"within_25_percent"});
    let document = |available: bool,
                    rows: Vec<serde_json::Value>,
                    total: Option<serde_json::Value>| {
        let mut document = serde_json::json!({"schemaVersion":"0.1","evidence":"unity_source_estimate",
            "platform":PREDICTION_PLATFORM,"available":available,"tolerance":tolerance,"rows":rows});
        if let Some(total) = total {
            document["total"] = total;
        }
        document
    };
    if selected.is_empty()
        || selected
            .iter()
            .any(|(_, prefab)| prefab.footprint.is_none())
    {
        return document(false, vec![], None);
    }
    // The Avatar's own parameter row is its Expression Parameters plus its MA Parameters;
    // every outfit's row is the bits that outfit adds, including VUA's own switch.
    let avatar_bits = parameters.known.then_some(
        parameters
            .expression_bits
            .saturating_add(parameters.avatar_ma_bits),
    );
    let mut outfit_bits = parameters.outfits.iter().map(|(.., bits, _)| *bits);
    let mut rows = Vec::with_capacity(selected.len());
    for (role, prefab) in &selected {
        let footprint = prefab.footprint.expect("checked above");
        let parameter_bits = if !parameters.known {
            None
        } else if *role == "avatar" {
            avatar_bits
        } else {
            outfit_bits.next()
        };
        // Unity Bridge's `ObserveFootprint` increments `meshes` for every renderer with a mesh
        // (`SkinnedMeshRenderer` + non-skinned `MeshRenderer`) and `skinnedMeshes` only for
        // `SkinnedMeshRenderer`, so basic meshes are `meshes - skinnedMeshes`.
        let basic_meshes = footprint.meshes.saturating_sub(footprint.skinned_meshes);
        rows.push(PredictedRow {
            source_id: prefab.source_id.clone(),
            name: prefab.name.clone(),
            role,
            triangles: footprint.triangles,
            skinned_meshes: footprint.skinned_meshes,
            basic_meshes,
            material_slots: footprint.material_slots,
            texture_bytes: footprint.texture_bytes,
            phys_bones: footprint.phys_bones,
            parameter_bits,
            // Everything the built Avatar is charged for that the import can state before
            // assembly: decoded textures plus mesh buffers.
            uncompressed_bytes: footprint.texture_bytes.saturating_add(footprint.mesh_bytes),
            complete: footprint.texture_complete
                && footprint.mesh_complete
                && footprint.phys_bones_known
                && parameter_bits.is_some(),
        });
    }
    let sum = |value: fn(&PredictedRow) -> u64| rows.iter().map(value).sum::<u64>();
    let parameter_total = rows
        .iter()
        .map(|row| row.parameter_bits)
        .try_fold(0u32, |total, bits| {
            bits.map(|bits| total.saturating_add(bits))
        });
    let total_triangles = sum(|row| row.triangles);
    let total_skinned_meshes = rows.iter().map(|row| row.skinned_meshes).sum::<u32>();
    let total_basic_meshes = rows.iter().map(|row| row.basic_meshes).sum::<u32>();
    let total_material_slots = rows.iter().map(|row| row.material_slots).sum::<u32>();
    let total_texture_bytes = sum(|row| row.texture_bytes);
    let total_phys_bones = rows.iter().map(|row| row.phys_bones).sum::<u32>();
    let total = serde_json::json!({
        "triangles": total_triangles,
        "materialSlots": total_material_slots,
        "textureBytes": total_texture_bytes,
        "physBones": total_phys_bones,
        "parameterBits": parameter_total,
        "uncompressedBytes": sum(|row| row.uncompressed_bytes),
        "complete": rows.iter().all(|row| row.complete),
        "performanceRanks": {
            "pc": predict_pc_rank(
                total_triangles,
                total_skinned_meshes,
                total_basic_meshes,
                total_material_slots,
                total_texture_bytes,
                total_phys_bones,
            ),
            "android": predict_android_rank(
                total_triangles,
                total_skinned_meshes,
                total_basic_meshes,
                total_material_slots,
                total_texture_bytes,
                total_phys_bones,
            ),
        },
    });
    document(
        true,
        rows.iter().map(PredictedRow::json).collect(),
        Some(total),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn footprint(triangles: u64, texture: u64, mesh: u64) -> CandidateFootprint {
        CandidateFootprint {
            triangles,
            material_slots: 2,
            meshes: 2,
            skinned_meshes: 1,
            texture_bytes: texture,
            texture_complete: true,
            mesh_bytes: mesh,
            mesh_complete: true,
            phys_bones: 3,
            phys_bones_known: true,
        }
    }
    fn budget(names: &[(&str, u8)]) -> ParameterBudget {
        ParameterBudget {
            expression_parameters_observed: true,
            expression_parameters: vec![],
            ma_components: vec![ParameterComponent {
                path: String::new(),
                parameters: names
                    .iter()
                    .map(|(name, bits)| ParameterEntry {
                        name: (*name).into(),
                        bits: *bits,
                        unique: false,
                    })
                    .collect(),
            }],
            unresolved_prefix_configs: 0,
            truncated: false,
        }
    }
    fn candidate(
        source: &str,
        name: &str,
        avatar: bool,
        made: Option<CandidateFootprint>,
        parameters: Option<ParameterBudget>,
    ) -> PrefabCandidate {
        PrefabCandidate {
            source_id: source.into(),
            path: format!("Assets/{source}.prefab"),
            name: name.into(),
            is_avatar: avatar,
            has_skinned_mesh: true,
            has_merge_armature: !avatar,
            has_missing_scripts: false,
            humanoid_bones: vec![],
            preview: None,
            parameter_budget: parameters,
            prefab_guid: None,
            object_paths: None,
            footprint: made,
        }
    }
    fn run_of(prefabs: Vec<PrefabCandidate>) -> ProductionRun {
        ProductionRun { run_id: "n3-prediction".into(), prefabs, ..serde_json::from_value(serde_json::json!({
            "schemaVersion":"0.1","runId":"n3-prediction","phase":"succeeded","taskId":"t",
            "editor":{"path":"e","version":"2022.3.22f1c1"},
            "projectRoot":"projects/n3-prediction","choices":[],"sources":[],"prefabs":[],"steps":[],
            "selection":null,"projectFingerprint":"p","unityFingerprint":"u","confirmedDigest":null,
            "error":null,"recovery":null,"result":null})).expect("synthetic run") }
    }
    fn selection(pairs: &[(&str, &str)]) -> AssemblySelection {
        AssemblySelection {
            avatar_prefab: "Assets/avatar.prefab".into(),
            outfits: pairs
                .iter()
                .map(|(source, toggle)| OutfitSelection {
                    source_id: (*source).into(),
                    prefab_path: format!("Assets/{source}.prefab"),
                    mode: BindingMode::MergeArmature,
                    bone: String::new(),
                    toggle_name: (*toggle).into(),
                    active: true,
                    saved: true,
                    group: String::new(),
                })
                .collect(),
        }
    }
    fn p02() -> ProductionRun {
        run_of(vec![
            candidate(
                "avatar",
                "Meiyun",
                true,
                Some(footprint(70_000, 120 << 20, 20 << 20)),
                Some(budget(&[("VRCEmote", 8)])),
            ),
            candidate(
                "outfit",
                "TshirtShorts",
                false,
                Some(footprint(30_000, 60 << 20, 8 << 20)),
                Some(budget(&[("Shirt", 1)])),
            ),
            candidate(
                "costume",
                "Costume4",
                false,
                Some(footprint(25_000, 40 << 20, 6 << 20)),
                Some(budget(&[("Dress", 1)])),
            ),
        ])
    }

    #[test]
    fn rows_cover_the_avatar_and_every_selected_outfit_with_all_six_values() {
        let run = p02();
        let plan = plan_prediction(
            &run,
            &selection(&[("outfit", "Tshirt"), ("costume", "Costume")]),
        );
        assert_eq!(plan["available"], true);
        let rows = plan["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["role"], "avatar");
        assert_eq!(rows[1]["name"], "TshirtShorts");
        // Size is decoded textures plus mesh buffers, stated in bytes.
        assert_eq!(rows[1]["triangles"], 30_000u64);
        assert_eq!(rows[1]["materialSlots"], 2u32);
        assert_eq!(rows[1]["textureBytes"], 60u64 << 20);
        assert_eq!(rows[1]["uncompressedBytes"], (60u64 << 20) + (8u64 << 20));
        assert_eq!(rows[1]["physBones"], 3u32);
        // The Avatar's row carries its own Expression plus MA bits; an outfit's row carries
        // the bits it adds, including VUA's switch.
        assert_eq!(rows[0]["parameterBits"], 8u32);
        assert_eq!(rows[1]["parameterBits"], 2u32);
        assert!(rows.iter().all(|row| row["complete"] == true));
        let total = &plan["total"];
        assert_eq!(total["triangles"], 125_000u64);
        assert_eq!(total["materialSlots"], 6u32);
        assert_eq!(total["textureBytes"], (120u64 + 60 + 40) << 20);
        assert_eq!(
            total["uncompressedBytes"],
            (120u64 + 60 + 40 + 20 + 8 + 6) << 20
        );
        assert_eq!(total["parameterBits"], 12u32);
        assert_eq!(total["complete"], true);
    }

    #[test]
    fn the_prediction_reuses_the_parameter_estimate_rather_than_counting_again() {
        let run = p02();
        let selection = selection(&[("outfit", "Tshirt"), ("costume", "Costume")]);
        let plan = plan_prediction(&run, &selection);
        let budget = plan_parameter_budget(&run, &selection);
        assert_eq!(plan["total"]["parameterBits"], budget["estimateBits"]);
        let row_sum: u32 = plan["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["parameterBits"].as_u64().unwrap() as u32)
            .sum();
        assert_eq!(row_sum, budget["estimateBits"].as_u64().unwrap() as u32);
    }

    #[test]
    fn a_candidate_without_a_footprint_reports_the_prediction_as_unavailable() {
        let mut run = p02();
        run.prefabs[1].footprint = None;
        let plan = plan_prediction(&run, &selection(&[("outfit", "Tshirt")]));
        assert_eq!(plan["available"], false);
        assert_eq!(plan["rows"].as_array().unwrap().len(), 0);
        assert!(plan.get("total").is_none());
    }

    #[test]
    fn partial_evidence_keeps_the_numbers_and_marks_the_row_incomplete() {
        let mut run = p02();
        let mut footprint = run.prefabs[1].footprint.unwrap();
        footprint.texture_complete = false;
        run.prefabs[1].footprint = Some(footprint);
        let plan = plan_prediction(&run, &selection(&[("outfit", "Tshirt")]));
        let row = &plan["rows"][1];
        assert_eq!(row["textureBytes"], 60u64 << 20);
        assert_eq!(row["complete"], false);
        assert_eq!(plan["total"]["complete"], false);
    }

    #[test]
    fn an_unknown_parameter_estimate_leaves_the_bits_null() {
        let mut run = p02();
        run.prefabs[0].parameter_budget = None;
        let plan = plan_prediction(&run, &selection(&[("outfit", "Tshirt")]));
        assert_eq!(plan["available"], true);
        assert!(plan["rows"][0]["parameterBits"].is_null());
        assert!(plan["total"]["parameterBits"].is_null());
        assert_eq!(plan["rows"][0]["complete"], false);
    }

    #[test]
    fn impossible_observations_are_contract_violations() {
        let mut run = p02();
        let mut impossible = run.prefabs[1].footprint.unwrap();
        impossible.skinned_meshes = impossible.meshes + 1;
        run.prefabs[1].footprint = Some(impossible);
        assert_eq!(
            validate_prefab_footprints(&run.prefabs).unwrap_err().code,
            "vua.amf_production.receipt_invalid"
        );
        run.prefabs[1].footprint = Some(CandidateFootprint {
            triangles: MAX_TRIANGLES + 1,
            ..impossible
        });
        assert!(validate_prefab_footprints(&run.prefabs).is_err());
        run.prefabs[1].footprint = Some(footprint(1, 1, 1));
        assert!(validate_prefab_footprints(&run.prefabs).is_ok());
    }

    #[test]
    fn predicts_pc_and_android_performance_ranks_and_limiting_metrics() {
        let run = p02();
        let plan = plan_prediction(
            &run,
            &selection(&[("outfit", "Tshirt"), ("costume", "Costume")]),
        );
        let ranks = &plan["total"]["performanceRanks"];
        assert_eq!(ranks["pc"]["rank"], "very_poor");
        assert_eq!(
            ranks["pc"]["limitingMetrics"],
            serde_json::json!(["triangles", "skinnedMeshes", "textureBytes", "physBones"])
        );
        assert_eq!(ranks["android"]["rank"], "very_poor");
        assert_eq!(
            ranks["android"]["limitingMetrics"],
            serde_json::json!([
                "triangles",
                "skinnedMeshes",
                "basicMeshes",
                "materialSlots",
                "textureBytes",
                "physBones"
            ])
        );

        let light_run = run_of(vec![
            candidate(
                "avatar",
                "QuestAvatar",
                true,
                Some(CandidateFootprint {
                    triangles: 5_000,
                    material_slots: 1,
                    meshes: 1,
                    skinned_meshes: 1,
                    texture_bytes: 6 << 20,
                    texture_complete: true,
                    mesh_bytes: 1 << 20,
                    mesh_complete: true,
                    phys_bones: 0,
                    phys_bones_known: true,
                }),
                Some(budget(&[("VRCEmote", 8)])),
            ),
            candidate(
                "outfit",
                "Cap",
                false,
                Some(CandidateFootprint {
                    triangles: 2_000,
                    material_slots: 0,
                    meshes: 1,
                    skinned_meshes: 0,
                    texture_bytes: 2 << 20,
                    texture_complete: true,
                    mesh_bytes: 512 << 10,
                    mesh_complete: true,
                    phys_bones: 0,
                    phys_bones_known: true,
                }),
                Some(budget(&[])),
            ),
        ]);
        let light_plan = plan_prediction(&light_run, &selection(&[("outfit", "Cap")]));
        assert_eq!(
            light_plan["total"]["performanceRanks"]["pc"]["rank"],
            "excellent"
        );
        assert_eq!(
            light_plan["total"]["performanceRanks"]["pc"]["limitingMetrics"],
            serde_json::json!([])
        );
        assert_eq!(
            light_plan["total"]["performanceRanks"]["android"]["rank"],
            "excellent"
        );
        assert_eq!(
            light_plan["total"]["performanceRanks"]["android"]["limitingMetrics"],
            serde_json::json!([])
        );

        // Avatar (1 SkinnedMesh) + 1 outfit (1 SkinnedMesh) with very low triangles/textures:
        // SDK gives PC Good (2 SkinnedMeshes <= 2) and Android Medium (2 SkinnedMeshes > 1, <= 2).
        let two_skinned_run = run_of(vec![
            candidate(
                "avatar",
                "LightAvatar",
                true,
                Some(CandidateFootprint {
                    triangles: 4_000,
                    material_slots: 1,
                    meshes: 1,
                    skinned_meshes: 1,
                    texture_bytes: 4 << 20,
                    texture_complete: true,
                    mesh_bytes: 1 << 20,
                    mesh_complete: true,
                    phys_bones: 0,
                    phys_bones_known: true,
                }),
                Some(budget(&[])),
            ),
            candidate(
                "outfit",
                "LightJacket",
                false,
                Some(CandidateFootprint {
                    triangles: 2_000,
                    material_slots: 0,
                    meshes: 1,
                    skinned_meshes: 1,
                    texture_bytes: 2 << 20,
                    texture_complete: true,
                    mesh_bytes: 512 << 10,
                    mesh_complete: true,
                    phys_bones: 0,
                    phys_bones_known: true,
                }),
                Some(budget(&[])),
            ),
        ]);
        let two_skinned_plan =
            plan_prediction(&two_skinned_run, &selection(&[("outfit", "LightJacket")]));
        assert_eq!(
            two_skinned_plan["total"]["performanceRanks"]["pc"]["rank"],
            "good"
        );
        assert_eq!(
            two_skinned_plan["total"]["performanceRanks"]["pc"]["limitingMetrics"],
            serde_json::json!([])
        );
        assert_eq!(
            two_skinned_plan["total"]["performanceRanks"]["android"]["rank"],
            "medium"
        );
        assert_eq!(
            two_skinned_plan["total"]["performanceRanks"]["android"]["limitingMetrics"],
            serde_json::json!(["skinnedMeshes"])
        );

        // PC exceeding 70k triangles immediately falls to VeryPoor even if other metrics are Good.
        assert_eq!(
            predict_pc_rank(70_001, 1, 0, 4, 20 << 20, 2)["rank"],
            "very_poor"
        );
        assert_eq!(
            predict_pc_rank(70_000, 2, 9, 8, 40 << 20, 4),
            serde_json::json!({"rank": "medium", "limitingMetrics": ["basicMeshes"]})
        );
        assert_eq!(
            predict_pc_rank(70_000, 17, 4, 8, 40 << 20, 4)["rank"],
            "very_poor"
        );
        assert_eq!(
            predict_pc_rank(70_000, 2, 8, 24, 120 << 20, 20)["rank"],
            "poor"
        );
        assert_eq!(
            predict_android_rank(10_000, 1, 1, 1, 18 << 20, 4)["rank"],
            "good"
        );
        assert_eq!(
            predict_android_rank(7_000, 1, 2, 1, 8 << 20, 0),
            serde_json::json!({"rank": "medium", "limitingMetrics": ["basicMeshes"]})
        );
        assert_eq!(
            predict_android_rank(15_000, 2, 2, 2, 25 << 20, 6)["rank"],
            "medium"
        );
        assert_eq!(
            predict_android_rank(20_000, 2, 2, 4, 40 << 20, 8)["rank"],
            "poor"
        );
        assert_eq!(
            predict_android_rank(7_000, 3, 0, 1, 8 << 20, 0)["rank"],
            "very_poor"
        );
    }

    #[test]
    fn multi_prefab_single_source_preserves_exact_per_prefab_parameter_bits() {
        use crate::amf_production::parameter_budget::estimate_parameters;

        let mut coat = candidate(
            "pack",
            "Coat",
            false,
            Some(footprint(8_000, 10 << 20, 2 << 20)),
            Some(budget(&[("CoatColor", 8)])),
        );
        coat.path = "Assets/pack/Coat.prefab".into();
        let mut hat = candidate(
            "pack",
            "Hat",
            false,
            Some(footprint(2_000, 4 << 20, 1 << 20)),
            Some(budget(&[])),
        );
        hat.path = "Assets/pack/Hat.prefab".into();

        let run = run_of(vec![
            candidate(
                "avatar",
                "Base",
                true,
                Some(footprint(12_000, 16 << 20, 4 << 20)),
                Some(budget(&[("VRCEmote", 8)])),
            ),
            coat,
            hat,
        ]);
        let sel = AssemblySelection {
            avatar_prefab: "Assets/avatar.prefab".into(),
            outfits: vec![
                OutfitSelection {
                    source_id: "pack".into(),
                    prefab_path: "Assets/pack/Coat.prefab".into(),
                    mode: BindingMode::MergeArmature,
                    bone: String::new(),
                    toggle_name: "Coat".into(),
                    active: true,
                    saved: true,
                    group: "Top".into(),
                },
                OutfitSelection {
                    source_id: "pack".into(),
                    prefab_path: "Assets/pack/Hat.prefab".into(),
                    mode: BindingMode::MergeArmature,
                    bone: String::new(),
                    toggle_name: "Hat".into(),
                    active: true,
                    saved: true,
                    group: "Top".into(),
                },
            ],
        };

        let expected_budget = estimate_parameters(&run, &sel);
        let plan = plan_prediction(&run, &sel);
        let rows = plan["rows"].as_array().expect("prediction rows");
        assert_eq!(rows.len(), 3);
        // Coat introduces the 8-bit group + its own 8-bit CoatColor = 16 bits;
        // Hat shares the "Top" group and adds 0 extra bits (not 16 again!).
        assert_eq!(rows[1]["parameterBits"], 16);
        assert_eq!(rows[2]["parameterBits"], 0);
        assert_eq!(
            plan["total"]["parameterBits"].as_u64(),
            Some(u64::from(expected_budget.total))
        );
    }
}

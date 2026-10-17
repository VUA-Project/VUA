//! Reviewed Recipe overlays onto a retained, actually observed Avatar.
use crate::amf_production::{production_error, validate_selection_subset, AmfProductionEngine, AssemblySelection, ProductionRun};
use crate::amf_recipe::ProductionRecipe;
use crate::{AppErrorV1, TaskContext};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecipeApplyChoice { RecipeWins, AvatarWins, NewAvatar }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeApplyTarget {
    pub avatar_global_object_id: String,
    pub new_avatar_key: Option<String>,
    pub write_source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeApplyConflict {
    pub source_id: String,
    pub package_name: String,
    pub field: String,
    pub current: Value,
    pub incoming: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeAvatarTarget {
    pub global_object_id: String,
    pub name: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecipeApplyPlan {
    pub run_id: String,
    pub recipe_id: String,
    pub title: String,
    pub avatar_name: String,
    pub avatar_global_object_id: String,
    pub plan_digest: String,
    pub conflicts: Vec<RecipeApplyConflict>,
    pub retained_outfits: usize,
    /// An identity mismatch is not a field-value conflict. New Avatar stays possible.
    pub overlay_blocker: Option<String>,
    pub recipe_selection: AssemblySelection,
    pub current_selection: AssemblySelection,
    pub targets: Vec<RecipeAvatarTarget>,
}

impl RecipeApplyPlan {
    pub fn selection(&self, choice: RecipeApplyChoice) -> Result<AssemblySelection, AppErrorV1> {
        if choice == RecipeApplyChoice::NewAvatar { return Ok(self.recipe_selection.clone()); }
        if let Some(reason) = &self.overlay_blocker {
            return Err(production_error("recipe_target_ambiguous", reason));
        }
        let mut selection = self.current_selection.clone();
        for incoming in &self.recipe_selection.outfits {
            if let Some(current) = selection.outfits.iter_mut().find(|o| o.source_id == incoming.source_id) {
                if choice == RecipeApplyChoice::RecipeWins {
                    // Empty means "do not create a switch", never an implicit deletion.
                    let old_switch = current.toggle_name.clone();
                    *current = incoming.clone();
                    if incoming.toggle_name.trim().is_empty() { current.toggle_name = old_switch; }
                }
            } else { selection.outfits.push(incoming.clone()); }
        }
        Ok(selection)
    }
    pub fn target(&self, choice: RecipeApplyChoice, selection: &AssemblySelection) -> RecipeApplyTarget {
        RecipeApplyTarget {
            avatar_global_object_id: self.avatar_global_object_id.clone(),
            new_avatar_key: (choice == RecipeApplyChoice::NewAvatar).then(|| format!("recipe-{}", &self.plan_digest[..24])),
            write_source_ids: selection.outfits.iter().filter(|outfit| choice == RecipeApplyChoice::NewAvatar
                || !self.current_selection.outfits.iter().any(|current| current == *outfit))
                .map(|outfit| outfit.source_id.clone()).collect(),
        }
    }
}

fn invalid(detail: impl Into<String>) -> AppErrorV1 { production_error("recipe_scene_unverified", detail) }

impl AmfProductionEngine {
    pub fn recipe_apply_plan(&self, run_id: &str, recipe_id: &str) -> Result<RecipeApplyPlan, AppErrorV1> {
        self.recipe_apply_plan_for(run_id, recipe_id, None)
    }
    pub fn recipe_apply_plan_for(&self, run_id: &str, recipe_id: &str, avatar_id: Option<&str>) -> Result<RecipeApplyPlan, AppErrorV1> {
        let run = self.get(run_id)?;
        if !matches!(run.phase.as_str(), "ready" | "succeeded") {
            return Err(production_error("inspect_required", "Reinspect the retained Avatar before applying a Recipe."));
        }
        if !self.project_state(&run)?.0 {
            return Err(production_error("project_drift", "The project changed. Reinspect it before comparing the Recipe."));
        }
        let stored = self.get_recipe(recipe_id)?;
        let recipe: ProductionRecipe = serde_json::from_value(stored.recipe.clone()).map_err(|_| invalid("Invalid stored Recipe."))?;
        let mut plan = compare_recipe(&run, &recipe, avatar_id)?;
        plan.plan_digest = Sha256::digest(serde_json::to_vec(&json!({
            "operation":"apply_recipe", "run":run, "recipe":stored, "comparison":plan,
        })).map_err(|_| invalid("Could not bind the Recipe comparison."))?).iter().map(|byte| format!("{byte:02x}")).collect();
        Ok(plan)
    }

    pub fn apply_recipe(&self, run_id: &str, recipe_id: &str, choice: RecipeApplyChoice, digest: &str, ctx: &TaskContext) -> Result<(), AppErrorV1> {
        self.apply_recipe_to(run_id, recipe_id, None, choice, digest, ctx)
    }
    pub fn apply_recipe_to(&self, run_id: &str, recipe_id: &str, avatar_id: Option<&str>, choice: RecipeApplyChoice, digest: &str, ctx: &TaskContext) -> Result<(), AppErrorV1> {
        let plan = self.recipe_apply_plan_for(run_id, recipe_id, avatar_id)?;
        if plan.plan_digest != digest {
            return Err(production_error("plan_drift", "The Recipe or Avatar changed. Review their differences again."));
        }
        let selection = plan.selection(choice)?;
        let run = self.get(run_id)?;
        validate_selection_subset(&run, &selection)?;
        let target = plan.target(choice, &selection);
        self.execute_assembly(run, selection, digest, Some(target), ctx)
    }
}

fn compare_recipe(run: &ProductionRun, recipe: &ProductionRecipe, avatar_id: Option<&str>) -> Result<RecipeApplyPlan, AppErrorV1> {
    recipe.validate()?;
    if recipe.editor_version != run.editor.version {
        return Err(production_error("recipe_editor_mismatch", "The Recipe requires a different Unity Editor. Prepare an independent project with that Editor."));
    }
    let packages: BTreeMap<String, String> = serde_json::from_value(run.result["packageVersions"].clone())
        .map_err(|_| invalid("Reinspect the installed package versions."))?;
    for (package, version) in &recipe.packages {
        if packages.get(package) != Some(version) {
            return Err(production_error("recipe_dependency_conflict", format!("{package} requires {version}; this project has {}. Resolve this dependency before applying the Recipe.", packages.get(package).map(String::as_str).unwrap_or("no observed version"))));
        }
    }
    let facts = &run.result["facts"];
    let active_id = facts["avatarGlobalObjectId"].as_str().filter(|id| !id.is_empty());
    let mut targets = Vec::new();
    let mut identities = std::collections::BTreeSet::new();
    if let Some(avatars) = facts["avatars"].as_array() {
        if avatars.len() > 64 { return Err(invalid("Too many owned Avatars to select safely.")); }
        for avatar in avatars {
            let id = avatar["globalObjectId"].as_str().filter(|id| !id.is_empty() && id.len() <= 256)
                .ok_or_else(|| invalid("An owned Avatar has no usable identity."))?;
            if !identities.insert(id) { return Err(invalid("Multiple Avatar observations have the same identity.")); }
            targets.push(RecipeAvatarTarget { global_object_id:id.into(), name:avatar["name"].as_str().unwrap_or("Avatar").into(),
                verified:serde_json::from_value::<AssemblySelection>(avatar["observedSelection"].clone()).is_ok() });
        }
    }
    if targets.is_empty() {
        if let Some(id) = active_id { targets.push(RecipeAvatarTarget { global_object_id:id.into(), name:facts["avatarName"].as_str().unwrap_or("Avatar").into(), verified:true }); }
    }
    let selected_id = avatar_id.or(active_id).ok_or_else(|| invalid("The actual Avatar object has not been identified."))?;
    if !targets.iter().any(|target| target.global_object_id == selected_id) {
        return Err(production_error("recipe_target_missing", "The selected Avatar is not an observed owned object. Reinspect before selecting it."));
    }
    let selected = if Some(selected_id) == active_id { facts } else {
        facts["avatars"].as_array().and_then(|avatars| avatars.iter().find(|a| a["globalObjectId"] == selected_id))
            .ok_or_else(|| invalid("The selected Avatar observation is missing."))?
    };
    let current: AssemblySelection = serde_json::from_value(selected["observedSelection"].clone())
        .map_err(|_| invalid("Current object identities and relationships are not verified. Reinspect and resolve the named scene diagnostics first."))?;
    validate_selection_subset(run, &current)?;
    let mut resolved = BTreeMap::new();
    for material in &recipe.materials {
        let matches = run.sources.iter().filter(|s| s.sha256.strip_prefix("sha256:").unwrap_or(&s.sha256) == material.sha256).collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(production_error(if matches.is_empty() { "recipe_material_missing" } else { "recipe_material_ambiguous" },
                format!("{} needs one matching original input in this project. Supply and inspect it before applying the Recipe.", material.package_name)));
        }
        resolved.insert(material.id.clone(), matches[0].source_id.clone());
    }
    let incoming = recipe.selection(&resolved)?;
    validate_selection_subset(run, &incoming)?;
    let mut blocker = (current.avatar_prefab != incoming.avatar_prefab)
        .then(|| "The Recipe uses a different Avatar prefab. Choose a new Avatar; field priority cannot identify an equivalent target.".to_string());
    let mut conflicts = Vec::new();
    for outfit in &incoming.outfits {
        if let Some(old) = current.outfits.iter().find(|o| o.source_id == outfit.source_id) {
            if old.prefab_path != outfit.prefab_path {
                blocker = Some("One material points to a different prefab. Resolve the object target or use a new Avatar; value priority cannot substitute an object.".into());
                continue;
            }
            let name = run.sources.iter().find(|s| s.source_id == outfit.source_id).map(|s| s.name.clone()).unwrap_or_default();
            for (field, before, after) in [
                ("mode", json!(old.mode), json!(outfit.mode)), ("bone", json!(old.bone), json!(outfit.bone)),
                ("toggleName", json!(old.toggle_name), json!(outfit.toggle_name)), ("active", json!(old.active), json!(outfit.active)),
            ] {
                if before != after && !(field == "toggleName" && outfit.toggle_name.trim().is_empty()) {
                    conflicts.push(RecipeApplyConflict { source_id: outfit.source_id.clone(), package_name: name.clone(), field: field.into(), current: before, incoming: after });
                }
            }
        }
    }
    Ok(RecipeApplyPlan {
        run_id: run.run_id.clone(), recipe_id: recipe.recipe_id.clone(), title: recipe.title.clone(),
        avatar_name: targets.iter().find(|target|target.global_object_id == selected_id).expect("verified target").name.clone(),
        avatar_global_object_id: selected_id.into(), plan_digest: String::new(), conflicts,
        retained_outfits: current.outfits.iter().filter(|o| !incoming.outfits.iter().any(|n| n.source_id == o.source_id)).count(),
        overlay_blocker: blocker, recipe_selection: incoming, current_selection: current, targets,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::amf_production::{BindingMode, OutfitSelection, PrefabCandidate, PreparedSource, SourceRole};

    fn case() -> (ProductionRun, ProductionRecipe) {
        let mut run: ProductionRun = serde_json::from_value(json!({
            "schemaVersion":"0.1", "runId":"n3-apply", "phase":"ready", "taskId":"task",
            "editor":{"path":"synthetic", "version":"2022.3.22f1c1"}, "projectRoot":"synthetic",
            "choices":[],"sources":[],"prefabs":[],"projectFingerprint":"observed","unityFingerprint":"observed",
            "steps":[],"selection":null,"confirmedDigest":null,"result":{},"error":null,"recovery":null,
        })).unwrap();
        for (id, hash, avatar) in [("avatar", "a", true), ("coat", "b", false), ("hat", "c", false)] {
            let path = format!("Assets/{id}.prefab");
            run.sources.push(PreparedSource { source_id:id.into(), role:SourceRole::Auto, name:format!("{id}.unitypackage"),
                item_name:id.into(), sha256:format!("sha256:{}",hash.repeat(64)), asset_paths:vec![path.clone()] });
            run.prefabs.push(PrefabCandidate { source_id:id.into(),path,name:id.into(),is_avatar:avatar,has_skinned_mesh:true,
                has_merge_armature:!avatar,has_missing_scripts:false,humanoid_bones:vec![],preview:None });
        }
        let selection = AssemblySelection { avatar_prefab:"Assets/avatar.prefab".into(),outfits:["coat","hat"].into_iter().map(|id| OutfitSelection {
            source_id:id.into(),prefab_path:format!("Assets/{id}.prefab"),mode:BindingMode::MergeArmature,bone:String::new(),toggle_name:id.into(),active:true,
        }).collect() };
        run.result=json!({"facts":{"avatarGlobalObjectId":"GlobalObjectId_V1-test-avatar", "avatarName":"My Avatar", "observedSelection":selection,"usedSourceIds":["avatar","coat","hat"]},
            "packageVersions":{"com.vrchat.avatars":"3.10.5","nadena.dev.modular-avatar":"1.18.7"}});
        let mut recipe=ProductionRecipe::from_run(&run,"recipe-overlay","A new coat switch").unwrap();
        recipe.outfits.truncate(1);
        recipe.materials.retain(|m| m.sha256!="c".repeat(64));
        recipe.outfits[0].toggle_name="New coat".into(); recipe.outfits[0].active=false;
        (run,recipe)
    }

    #[test]
    fn priority_changes_only_touched_fields_and_preserves_unmentioned_materials() {
        let (run,recipe)=case(); let plan=compare_recipe(&run,&recipe,None).unwrap();
        assert_eq!(plan.conflicts.len(),2); assert_eq!(plan.retained_outfits,1);
        let recipe_wins=plan.selection(RecipeApplyChoice::RecipeWins).unwrap();
        assert_eq!(recipe_wins.outfits.len(),2); assert_eq!(recipe_wins.outfits[0].toggle_name,"New coat");
        assert!(!recipe_wins.outfits[0].active); assert_eq!(recipe_wins.outfits[1],plan.current_selection.outfits[1]);
        assert_eq!(plan.selection(RecipeApplyChoice::AvatarWins).unwrap(),plan.current_selection);
        let new_avatar=plan.selection(RecipeApplyChoice::NewAvatar).unwrap();
        assert_eq!(new_avatar.outfits.len(),1); assert_eq!(new_avatar,plan.recipe_selection);
        let mut plan = plan; plan.plan_digest = "a".repeat(64);
        assert_eq!(plan.target(RecipeApplyChoice::RecipeWins, &recipe_wins).write_source_ids, vec!["coat"]);
        assert!(plan.target(RecipeApplyChoice::AvatarWins, &plan.current_selection).write_source_ids.is_empty());
        assert_eq!(plan.target(RecipeApplyChoice::NewAvatar, &new_avatar).write_source_ids, vec!["coat"]);
        plan.current_selection = recipe_wins.clone();
        assert!(plan.target(RecipeApplyChoice::RecipeWins, &recipe_wins).write_source_ids.is_empty());
    }

    #[test]
    fn absence_of_a_switch_is_not_an_implicit_delete() {
        let (run,mut recipe)=case(); recipe.outfits[0].toggle_name.clear();
        let plan=compare_recipe(&run,&recipe,None).unwrap();
        assert!(plan.conflicts.iter().all(|c| c.field!="toggleName"));
        assert_eq!(plan.selection(RecipeApplyChoice::RecipeWins).unwrap().outfits[0].toggle_name,"coat");
        assert!(plan.selection(RecipeApplyChoice::NewAvatar).unwrap().outfits[0].toggle_name.is_empty());
    }

    #[test]
    fn identity_ambiguity_cannot_be_solved_by_field_priority() {
        let (mut run,mut recipe)=case();
        let mut variant=run.prefabs[1].clone(); variant.path="Assets/OtherCoat.prefab".into(); run.prefabs.push(variant);
        recipe.outfits[0].prefab_path="Assets/OtherCoat.prefab".into();
        let plan=compare_recipe(&run,&recipe,None).unwrap();
        assert!(plan.overlay_blocker.is_some());
        assert!(plan.selection(RecipeApplyChoice::RecipeWins).is_err());
        assert!(plan.selection(RecipeApplyChoice::AvatarWins).is_err());
        assert!(plan.selection(RecipeApplyChoice::NewAvatar).is_ok());
    }

    #[test]
    fn missing_inputs_drift_and_unobserved_scene_stay_distinct() {
        let (run,recipe)=case();
        let mut changed=run.clone(); changed.result["packageVersions"]["nadena.dev.modular-avatar"]=json!("1.0.0");
        assert!(compare_recipe(&changed,&recipe,None).unwrap_err().code.ends_with("recipe_dependency_conflict"));
        let mut changed=run.clone(); changed.sources[1].sha256="d".repeat(64);
        assert!(compare_recipe(&changed,&recipe,None).unwrap_err().code.ends_with("recipe_material_missing"));
        let mut changed=run.clone(); changed.result["facts"]["observedSelection"]=Value::Null;
        assert!(compare_recipe(&changed,&recipe,None).unwrap_err().code.ends_with("recipe_scene_unverified"));
    }

    #[test]
    fn capture_excludes_dependencies_used_only_by_another_avatar() {
        let (mut run,_)=case();
        run.sources[2].role=SourceRole::Dependency;
        run.result["facts"]["observedSelection"]["outfits"].as_array_mut().unwrap().truncate(1);
        run.result["facts"]["usedSourceIds"]=json!(["avatar","coat"]);
        let recipe=ProductionRecipe::from_run(&run,"recipe-current-avatar","Only this Avatar").unwrap();
        assert_eq!(recipe.materials.len(),2);
        assert!(!recipe.materials.iter().any(|m|m.sha256=="c".repeat(64)));
    }

    #[test]
    fn selecting_a_retained_avatar_uses_its_own_observed_relationships() {
        let (mut run,recipe)=case();
        let active=run.result["facts"]["observedSelection"].clone();
        let mut other=active.clone(); other["outfits"][0]["toggleName"]=json!("Other coat");
        run.result["facts"]["avatars"]=json!([
            {"globalObjectId":"GlobalObjectId_V1-test-avatar","name":"Same name","observedSelection":active},
            {"globalObjectId":"GlobalObjectId_V1-other-avatar","name":"Same name","observedSelection":other}
        ]);
        let plan=compare_recipe(&run,&recipe,Some("GlobalObjectId_V1-other-avatar")).unwrap();
        assert_eq!(plan.avatar_global_object_id,"GlobalObjectId_V1-other-avatar");
        assert_eq!(plan.current_selection.outfits[0].toggle_name,"Other coat");
        assert_eq!(plan.targets.len(),2);
        assert!(compare_recipe(&run,&recipe,Some("Same name")).unwrap_err().code.ends_with("recipe_target_missing"));
        run.result["facts"]["avatars"][1]["observedSelection"]=Value::Null;
        assert!(compare_recipe(&run,&recipe,Some("GlobalObjectId_V1-other-avatar")).unwrap_err().code.ends_with("recipe_scene_unverified"));
        run.result["facts"]["avatars"][1]["globalObjectId"]=json!("GlobalObjectId_V1-test-avatar");
        assert!(compare_recipe(&run,&recipe,None).is_err());
    }

    #[test]
    fn continuing_a_smaller_avatar_does_not_require_another_avatars_outfits() {
        let (mut run,_)=case();
        run.sources[1].role=SourceRole::Outfit; run.sources[2].role=SourceRole::Outfit;
        run.result["facts"]["observedSelection"]["outfits"].as_array_mut().unwrap().truncate(1);
        let mut current: AssemblySelection=serde_json::from_value(run.result["facts"]["observedSelection"].clone()).unwrap();
        current.outfits[0].toggle_name="Edited again".into();
        assert!(crate::amf_production::validate_selection(&run,&current).is_ok());
        current.outfits[0].toggle_name.clear();
        assert!(crate::amf_production::validate_selection(&run,&current).unwrap_err().code.ends_with("explicit_removal_required"));
        current.outfits[0].source_id="hat".into(); current.outfits[0].prefab_path="Assets/hat.prefab".into();
        assert!(crate::amf_production::validate_selection(&run,&current).unwrap_err().code.ends_with("explicit_removal_required"));
    }
}

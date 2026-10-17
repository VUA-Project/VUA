//! Bounded Recipe sharing; source statements are not entitlement or authenticity checks.
use crate::{amf_production::{production_error, AmfProductionEngine, ProductionRun}, amf_recipe::ProductionRecipe, recipe::{base64_url_decode, base64_url_encode, canonical_json, document_digest}, AppErrorV1, StoredRecipeDocument};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs};

pub const SHARE_PREFIX: &str = "vuar0.4.";
pub const MAX_SHARE_BYTES: usize = 256 * 1024;
fn error(code: &str, detail: impl Into<String>) -> AppErrorV1 { production_error(code, detail) }
fn io(error: impl std::fmt::Display) -> AppErrorV1 { production_error("recipe_store_failed", error.to_string()) }
pub fn valid_booth_id(id: &str) -> bool { !id.is_empty() && id.len() <= 20 && !id.starts_with('0') && id.bytes().all(|b| b.is_ascii_digit()) }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SharedRecipe {
    pub format_version: String,
    pub recipe: ProductionRecipe,
    /// Material identity -> native BOOTH item ID. No URL, local path or asset body.
    pub sources: BTreeMap<String, String>,
}
impl SharedRecipe {
    pub fn validate(&self) -> Result<(), AppErrorV1> {
        self.recipe.validate()?;
        if self.format_version != "0.4" || self.sources.len() != self.recipe.materials.len()
            || self.recipe.materials.iter().any(|m| self.sources.get(&m.id).is_none_or(|id| !valid_booth_id(id))) {
            return Err(error("recipe_share_invalid", "Every referenced material needs one BOOTH source statement."));
        }
        Ok(())
    }
    pub fn encode(&self) -> Result<String, AppErrorV1> {
        self.validate()?;
        let json = canonical_json(self)?;
        if json.len() > MAX_SHARE_BYTES { return Err(error("recipe_share_too_large", "Recipe exceeds the sharing size limit.")); }
        Ok(format!("{SHARE_PREFIX}{}", base64_url_encode(json.as_bytes())))
    }
    pub fn decode(text: &str) -> Result<Self, AppErrorV1> {
        if text.len() > MAX_SHARE_BYTES * 4 / 3 + 32 { return Err(error("recipe_share_too_large", "Recipe exceeds the sharing size limit.")); }
        let text = text.trim();
        let bytes = if let Some(payload) = text.strip_prefix(SHARE_PREFIX) {
            base64_url_decode(payload).ok_or_else(|| error("recipe_share_invalid", "The Recipe text is damaged or unsupported."))?
        } else { text.as_bytes().to_vec() };
        if bytes.len() > MAX_SHARE_BYTES { return Err(error("recipe_share_too_large", "Recipe exceeds the sharing size limit.")); }
        let shared: Self = serde_json::from_slice(&bytes).map_err(|_| error("recipe_share_invalid", "The Recipe contains unsupported content or has an invalid format."))?;
        shared.validate()?;
        Ok(shared)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecipeOrigin {
    recipe_digest: String,
    /// Empty only for received declarations. Source IDs remain machine-local.
    inputs: BTreeMap<String, Vec<String>>,
    references_observed: bool,
    received_sources: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeShareMaterial {
    pub material_id: String,
    pub package_name: String,
    pub candidates: Vec<String>,
    pub selected_product_id: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeSharePlan {
    pub recipe_id: String,
    pub revision: u64,
    pub title: String,
    pub materials: Vec<RecipeShareMaterial>,
    pub plan_digest: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeShareExport { pub share_code: String, pub file_text: String, pub document: SharedRecipe }

impl AmfProductionEngine {
    fn origin_path(&self, recipe_id: &str) -> std::path::PathBuf { self.root.join("recipe-origins").join(format!("{recipe_id}.json")) }
    fn save_origin(&self, recipe_id: &str, origin: &RecipeOrigin) -> Result<(), AppErrorV1> {
        // The caller has already validated the Recipe identity.
        let path = self.origin_path(recipe_id); fs::create_dir_all(path.parent().unwrap()).map_err(io)?;
        let pending = path.with_extension("pending");
        fs::write(&pending, serde_json::to_vec_pretty(origin).map_err(io)?).map_err(io)?;
        fs::rename(pending, path).map_err(io)
    }
    pub(crate) fn retain_recipe_origin(&self, run: &ProductionRun, recipe: &ProductionRecipe) -> Result<(), AppErrorV1> {
        let observed = run.result["facts"]["usedSourceIds"].as_array();
        let inputs = recipe.materials.iter().map(|material| (material.id.clone(), run.sources.iter()
            .filter(|source| source.sha256.strip_prefix("sha256:").unwrap_or(&source.sha256) == material.sha256)
            .map(|source| source.source_id.clone()).collect())).collect();
        self.save_origin(&recipe.recipe_id, &RecipeOrigin { recipe_digest: document_digest(recipe)?, inputs,
            references_observed: observed.is_some(), received_sources: BTreeMap::new() })
    }
    fn share_origin(&self, recipe: &ProductionRecipe) -> Result<RecipeOrigin, AppErrorV1> {
        let path = self.origin_path(&recipe.recipe_id);
        if !path.is_file() { return Err(error("recipe_reinspect_for_share", "Reinspect the source project and save this Recipe again to establish its referenced materials.")); }
        let origin: RecipeOrigin = serde_json::from_slice(&fs::read(path).map_err(io)?).map_err(io)?;
        if origin.recipe_digest != document_digest(recipe)? || (!origin.references_observed && origin.received_sources.is_empty()) {
            return Err(error("recipe_reinspect_for_share", "Reinspect the source project and save this Recipe again before sharing."));
        }
        Ok(origin)
    }
    fn confirmed_sources(&self) -> Result<BTreeMap<String, String>, AppErrorV1> {
        let path = self.root.join("recipe-source-choices.json");
        if !path.exists() { return Ok(BTreeMap::new()); }
        let choices: BTreeMap<String, String> = serde_json::from_slice(&fs::read(path).map_err(io)?).map_err(io)?;
        if choices.iter().any(|(hash,id)| hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) || !valid_booth_id(id)) {
            return Err(error("recipe_source_choices_invalid", "Saved source choices need repair."));
        }
        Ok(choices)
    }
    pub fn recipe_share_plan(&self, recipe_id: &str) -> Result<RecipeSharePlan, AppErrorV1> {
        let stored = self.get_recipe(recipe_id)?;
        let recipe: ProductionRecipe = serde_json::from_value(stored.recipe).map_err(io)?;
        let origin = self.share_origin(&recipe)?;
        let candidates = self.platform.recipe_source_candidates(&recipe.materials, &origin.inputs)?;
        let remembered = self.confirmed_sources()?;
        let materials = recipe.materials.iter().map(|material| {
            let mut available = candidates.get(&material.id).cloned().unwrap_or_default();
            available.retain(|id| valid_booth_id(id)); available.sort(); available.dedup();
            let selected = remembered.get(&material.sha256).or_else(|| origin.received_sources.get(&material.id)).cloned()
                .or_else(|| (available.len() == 1).then(|| available[0].clone()));
            RecipeShareMaterial { material_id: material.id.clone(), package_name: material.package_name.clone(), candidates: available, selected_product_id: selected }
        }).collect();
        let mut plan = RecipeSharePlan { recipe_id: recipe_id.into(), revision: stored.revision, title: recipe.title, materials, plan_digest: String::new() };
        plan.plan_digest = document_digest(&serde_json::json!({"recipe":origin.recipe_digest,"plan":plan}))?.trim_start_matches("sha256:").into();
        Ok(plan)
    }
    pub fn export_recipe(&self, recipe_id: &str, digest: &str, supplements: &BTreeMap<String, String>) -> Result<RecipeShareExport, AppErrorV1> {
        let plan = self.recipe_share_plan(recipe_id)?;
        if digest != plan.plan_digest { return Err(error("recipe_share_stale", "The Recipe or its sources changed. Review the source list again.")); }
        if supplements.len() > 64 || supplements.iter().any(|(material,id)| !valid_booth_id(id) || !plan.materials.iter().any(|m| &m.material_id == material)) {
            return Err(error("recipe_sources_invalid", "Source choices must name only this Recipe's materials and valid BOOTH items."));
        }
        let sources = plan.materials.iter().map(|material| {
            let source = supplements.get(&material.material_id).or(material.selected_product_id.as_ref())
                .ok_or_else(|| error("recipe_source_missing", format!("Choose a BOOTH source for {} before sharing.", material.package_name)))?;
            Ok((material.material_id.clone(), source.clone()))
        }).collect::<Result<BTreeMap<_,_>,AppErrorV1>>()?;
        let recipe: ProductionRecipe = serde_json::from_value(self.get_recipe(recipe_id)?.recipe).map_err(io)?;
        let shared = SharedRecipe { format_version: "0.4".into(), recipe, sources };
        let share_code = shared.encode()?;
        let file_text = serde_json::to_string_pretty(&shared).map_err(io)?;
        if file_text.len() > MAX_SHARE_BYTES { return Err(error("recipe_share_too_large", "Recipe file exceeds the sharing size limit.")); }
        if !supplements.is_empty() {
            let mut confirmed = self.confirmed_sources()?;
            for material in &shared.recipe.materials { if let Some(id) = supplements.get(&material.id) { confirmed.insert(material.sha256.clone(), id.clone()); } }
            let path = self.root.join("recipe-source-choices.json"); let pending = path.with_extension("pending");
            fs::write(&pending, serde_json::to_vec_pretty(&confirmed).map_err(io)?).map_err(io)?;
            fs::rename(pending,path).map_err(io)?;
        }
        Ok(RecipeShareExport { share_code, file_text, document: shared })
    }
    pub fn import_recipe(&self, text: &str) -> Result<StoredRecipeDocument, AppErrorV1> {
        let shared = SharedRecipe::decode(text)?;
        let digest = document_digest(&shared)?;
        let recipe_id = format!("shared-{}", digest.trim_start_matches("sha256:"));
        let mut recipe = shared.recipe; recipe.recipe_id = recipe_id.clone(); recipe.validate()?;
        let value = serde_json::to_value(&recipe).map_err(io)?;
        if let Some(existing) = self.recipe_store().get(&recipe_id).map_err(io)? {
            if existing.recipe != value { return Err(error("recipe_import_conflict", "An existing imported Recipe has changed. Keep it and import a revised declaration.")); }
            self.share_origin(&recipe)?;
            return Ok(existing);
        }
        self.save_origin(&recipe_id, &RecipeOrigin { recipe_digest: document_digest(&recipe)?, inputs: BTreeMap::new(), references_observed: false, received_sources: shared.sources })?;
        self.recipe_store().save(&recipe_id, &value, 0).map_err(io)
    }
}

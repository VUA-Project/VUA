use std::{fs, path::PathBuf};
use vua_orchestrator::amf_recipe::ProductionRecipe;

#[test]
fn candidate_recipe_vectors_are_closed_portable_declarations() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/amf-recipe/v0.4");
    let schema = serde_json::from_slice(&fs::read(root.join("recipe.schema.json")).unwrap()).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    for entry in fs::read_dir(root.join("examples")).unwrap() {
        let path = entry.unwrap().path();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let expected = path.file_name().unwrap().to_string_lossy().contains(".valid.");
        assert_eq!(validator.is_valid(&value), expected, "{}", path.display());
        let valid = serde_json::from_value::<ProductionRecipe>(value).is_ok_and(|recipe| recipe.validate().is_ok());
        assert_eq!(valid, expected, "{}", path.display());
    }
}

#[test]
fn recipe_cannot_redirect_a_relationship_or_hide_a_duplicate_input() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/amf-recipe/v0.4/examples/recipe.valid.json");
    let mut recipe: ProductionRecipe = serde_json::from_slice(&fs::read(root).unwrap()).unwrap();
    recipe.outfits[0].material_id = format!("m-{}", "c".repeat(64));
    assert!(recipe.validate().is_err());
    recipe.outfits[0].material_id = recipe.materials[1].id.clone();
    recipe.materials.push(recipe.materials[0].clone());
    assert!(recipe.validate().is_err());
}

#[test]
fn share_schema_codec_and_rust_agree_on_closed_payloads() {
    use vua_orchestrator::amf_recipe_share::SharedRecipe;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../schemas/amf-recipe/v0.4");
    let schema = serde_json::from_slice(&fs::read(root.join("share.schema.json")).unwrap()).unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    for entry in fs::read_dir(root.join("share-examples")).unwrap() {
        let path = entry.unwrap().path(); let text = fs::read_to_string(&path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let expected = path.file_name().unwrap().to_string_lossy().contains(".valid.");
        assert_eq!(validator.is_valid(&value), expected, "{}", path.display());
        let decoded = SharedRecipe::decode(&text); assert_eq!(decoded.is_ok(), expected, "{}", path.display());
        if let Ok(shared) = decoded { assert_eq!(SharedRecipe::decode(&shared.encode().unwrap()).unwrap(), shared); }
    }
    let mut shared = SharedRecipe::decode(&fs::read_to_string(root.join("share-examples/share.valid.json")).unwrap()).unwrap();
    shared.sources.remove(&shared.recipe.materials[0].id); assert!(shared.validate().is_err());
    assert!(SharedRecipe::decode(&"x".repeat(350000)).is_err());
    assert!(SharedRecipe::decode("vuar0.2.aaaa").is_err());
}

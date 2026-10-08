use serde_json::{json, Value};
use std::path::PathBuf;
use vua_acquisition::recipe_selection_drafts::RecipeSelectionDrafts;
use vua_orchestrator::RecipeDocumentStore;

struct Root(PathBuf);
impl Root {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "vua-selection-draft-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Root {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn vector(name: &str) -> Value {
    serde_json::from_slice(
        &std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../schemas/recipe-selection-draft/v0.1")
                .join(name),
        )
        .unwrap(),
    )
    .unwrap()
}
fn apply(store: &RecipeSelectionDrafts, name: &str) -> Value {
    let request = vector(&format!("examples/{name}.request.json"));
    store
        .apply(
            request["method"].as_str().unwrap(),
            request["params"].clone(),
        )
        .unwrap()
}

#[test]
fn recipe_draft_schemas_live_results_restart_and_production_separation() {
    let request = jsonschema::validator_for(&vector("request.schema.json")).unwrap();
    let response = jsonschema::validator_for(&vector("response.schema.json")).unwrap();
    for name in ["list", "get", "save", "add"] {
        assert!(request.is_valid(&vector(&format!("examples/{name}.request.json"))));
    }
    for name in ["invalid-formal", "invalid-path", "invalid-revision"] {
        assert!(!request.is_valid(&vector(&format!("examples/{name}.request.json"))));
    }
    for name in ["read", "add", "list"] {
        assert!(response.is_valid(&vector(&format!("examples/{name}.response.json"))));
    }
    assert!(!response.is_valid(&vector("examples/invalid-kind.response.json")));
    let root = Root::new();
    let drafts_root = root.0.join("recipe-selection-drafts");
    let store = RecipeSelectionDrafts::new(drafts_root.clone());
    assert_eq!(apply(&store, "list")["entries"], json!([]));
    assert!(!drafts_root.exists());
    let saved = apply(&store, "save");
    assert!(response.is_valid(&saved), "{saved}");
    assert_eq!(saved["document"]["selections"].as_array().unwrap().len(), 2);
    let duplicate = apply(&store, "add");
    assert!(response.is_valid(&duplicate));
    assert_eq!(duplicate["addedCount"], 0);
    assert_eq!(duplicate["existingCount"], 2);
    let reopened = RecipeSelectionDrafts::new(drafts_root);
    let read = apply(&reopened, "get");
    assert_eq!(read["revision"], 2);
    assert_eq!(read["document"], saved["document"]);
    assert!(response.is_valid(&apply(&reopened, "list")));
    let production_root = root.0.join("recipes");
    let production = RecipeDocumentStore::new_with_system_clock(production_root);
    production
        .save(
            "production-synthetic",
            &json!({"title":"Existing production document"}),
            0,
        )
        .unwrap();
    assert_eq!(production.list().unwrap().len(), 1);
    assert!(production.get("recipe-draft-synthetic").unwrap().is_none());
    assert_eq!(
        apply(&reopened, "list")["entries"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn recipe_draft_append_counts_distinct_variants_and_stable_local_entries() {
    let root = Root::new();
    let store = RecipeSelectionDrafts::new(root.0.join("drafts"));
    apply(&store, "save");
    let mut request = vector("examples/add.request.json")["params"].clone();
    let mut variant = request["selections"][0].clone();
    variant["variantName"] = json!("Synthetic variant");
    let mut local = request["selections"][2].clone();
    local["warehouseItemId"] = json!("warehouse-other");
    request["selections"] = json!([variant.clone(), variant, local]);
    let added = store
        .apply("recipeDraft.addSelection", request.clone())
        .unwrap();
    assert_eq!(added["addedCount"], 2);
    assert_eq!(added["existingCount"], 0);
    assert_eq!(added["document"]["selections"].as_array().unwrap().len(), 4);
    assert_eq!(
        store
            .apply("recipeDraft.addSelection", request.clone())
            .unwrap_err()
            .0,
        "revision_conflict"
    );
    request["baseRevision"] = json!(2);
    let again = store.apply("recipeDraft.addSelection", request).unwrap();
    assert_eq!(again["addedCount"], 0);
    assert_eq!(again["existingCount"], 2);
}

#[test]
fn recipe_draft_refuses_unknown_fields_conflicts_and_corrupt_documents() {
    let root = Root::new();
    let draft_root = root.0.join("drafts");
    let store = RecipeSelectionDrafts::new(draft_root.clone());
    for name in ["invalid-formal", "invalid-path", "invalid-revision"] {
        let request = vector(&format!("examples/{name}.request.json"));
        assert_eq!(
            store
                .apply(
                    request["method"].as_str().unwrap(),
                    request["params"].clone()
                )
                .unwrap_err()
                .0,
            "invalid_params"
        );
    }
    assert!(!draft_root.exists());
    apply(&store, "save");
    let mut save = vector("examples/save.request.json")["params"].clone();
    save["title"] = json!("Stale edit");
    assert_eq!(
        store.apply("recipeDraft.save", save).unwrap_err().0,
        "revision_conflict"
    );
    assert_eq!(
        apply(&store, "get")["document"]["title"],
        "Synthetic selection"
    );
    let file = draft_root.join("recipe-draft-synthetic.json");
    let mut stored: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    stored["recipe"]["kind"] = json!("production_recipe");
    std::fs::write(file, serde_json::to_vec(&stored).unwrap()).unwrap();
    assert_eq!(
        store
            .apply("recipeDraft.list", json!({"schemaVersion":"0.1"}))
            .unwrap_err()
            .0,
        "store_failed"
    );
}

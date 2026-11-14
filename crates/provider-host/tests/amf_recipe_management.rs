//! Synthetic local Recipe files through the actual Provider frame loop; no Unity/network.
use serde_json::{json, Value};
use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};
use vua_bdl_store::{ArtifactMode, BdlStore};
use vua_provider_host::{run_provider_host_with_services, WarehouseConfig};

fn invoke(root: &Path, method: &str, kind: &str, params: Value) -> Value {
    let bdl = Arc::new(BdlStore::open(root.join("bdl.db")).unwrap());
    let mut payload = json!({"contractVersion":"0.1", "requestId":"manage", "correlationId":"manage", "kind":kind, "method":method, "params":params});
    if kind == "command" {
        payload["commandId"] = "manage-command".into();
    }
    let request =
        json!({"frameVersion":"0.1", "frameId":"manage", "kind":"request", "payload":payload});
    let mut output = Vec::new();
    run_provider_host_with_services(
        Cursor::new(format!("{request}\n")),
        &mut output,
        root.join("tasks.db"),
        None,
        None,
        Some(WarehouseConfig {
            bdl,
            warehouse_root: root.join("warehouse"),
            global_default: ArtifactMode::UseOriginalUnitypackage,
            executor: None,
            dependencies_queries: None,
        }),
        None,
    )
    .unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|frame| frame["frameId"] == "manage")
        .unwrap()["payload"]
        .clone()
}
fn fixture() -> PathBuf {
    static NEXT_FIXTURE_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let seq = NEXT_FIXTURE_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "vua-recipe-manage-wire-{}-{}-{seq}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    let mut recipe: Value = serde_json::from_str(include_str!(
        "../../../schemas/amf-recipe/v0.5/examples/recipe.valid.json"
    ))
    .unwrap();
    recipe["recipeId"] = "recipe-wire".into();
    vua_orchestrator::RecipeDocumentStore::new_with_system_clock(
        root.join("amf-production/recipes-v04"),
    )
    .save("recipe-wire", &recipe, 0)
    .unwrap();
    root
}
fn cleanup(root: PathBuf) {
    assert!(
        root.starts_with(std::env::temp_dir())
            && root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("vua-recipe-manage-wire-")
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn management_queries_and_commands_reach_the_native_store() {
    let root = fixture();
    let base = json!({"schemaVersion":"0.1", "recipeId":"recipe-wire"});
    let listed = invoke(
        &root,
        "amf.production.listRecipes",
        "query",
        json!({"schemaVersion":"0.1"}),
    );
    assert_eq!(listed["ok"], true, "{listed}");
    assert_eq!(
        listed["value"]["recipes"][0]["boothProductIds"],
        json!(["1000001"])
    );
    let picture = invoke(&root, "amf.production.recipeImage", "query", base.clone());
    assert_eq!(picture["ok"], true, "{picture}");
    assert!(picture["value"]["image"].is_null());
    fs::create_dir_all(root.join("amf-production/recipe-stills")).unwrap();
    fs::write(
        root.join("amf-production/recipe-stills/recipe-wire.png"),
        b"\x89PNG\r\n\x1a\n",
    )
    .unwrap();
    assert_eq!(
        invoke(&root, "amf.production.recipeImage", "query", base.clone())["value"]["image"]
            ["data"],
        "iVBORw0KGgo="
    );
    let mut rename = base.clone();
    rename["expectedRevision"] = json!(1.0);
    rename["title"] = "Renamed".into();
    let saved = invoke(
        &root,
        "amf.production.renameRecipe",
        "command",
        rename.clone(),
    );
    assert_eq!(saved["ok"], true, "{saved}");
    assert_eq!(saved["value"]["document"]["revision"], 2);
    assert_eq!(saved["value"]["document"]["recipe"]["title"], "Renamed");
    let conflict = invoke(&root, "amf.production.renameRecipe", "command", rename);
    assert_eq!(conflict["ok"], false);
    assert_eq!(
        conflict["error"]["code"],
        "vua.amf_production.recipe_revision_conflict"
    );
    let mut delete = base;
    delete["expectedRevision"] = 2.into();
    let deleted = invoke(&root, "amf.production.deleteRecipe", "command", delete);
    assert_eq!(deleted["ok"], true, "{deleted}");
    assert_eq!(deleted["value"]["deleted"], true);
    assert!(!root
        .join("amf-production/recipe-stills/recipe-wire.png")
        .exists());
    cleanup(root);
}

#[test]
fn native_methods_reject_wrong_kind_unknown_fields_and_unsafe_revisions() {
    let root = fixture();
    for revision in [
        json!(0),
        json!(-1),
        json!(1.5),
        json!(null),
        json!(9_007_199_254_740_992_u64),
    ] {
        let response = invoke(
            &root,
            "amf.production.deleteRecipe",
            "command",
            json!({"schemaVersion":"0.1", "recipeId":"recipe-wire", "expectedRevision":revision}),
        );
        assert_eq!(response["ok"], false, "{response}");
    }
    for (method, kind, params) in [
        (
            "amf.production.deleteRecipe",
            "query",
            json!({"schemaVersion":"0.1", "recipeId":"recipe-wire", "expectedRevision":1}),
        ),
        (
            "amf.production.recipeImage",
            "query",
            json!({"schemaVersion":"0.1", "recipeId":"recipe-wire", "path":"outside.png"}),
        ),
        (
            "amf.production.renameRecipe",
            "command",
            json!({"schemaVersion":"0.1", "recipeId":"../escape", "expectedRevision":1, "title":"Name"}),
        ),
    ] {
        assert_eq!(invoke(&root, method, kind, params)["ok"], false);
    }
    assert!(root
        .join("amf-production/recipes-v04/recipe-wire.json")
        .exists());
    cleanup(root);
}

//! Material selections awaiting Recipe design. A separate store, never a production Recipe.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use vua_orchestrator::{Clock, RecipeDocumentStore, RecipeSaveError, SystemClock};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Selection {
    identity: String,
    display_name: String,
    source: String,
    #[serde(default)]
    variant_name: Option<String>,
    #[serde(default)]
    shop_name: Option<String>,
    #[serde(default)]
    warehouse_item_id: Option<String>,
}
impl Selection {
    fn valid(&self) -> bool {
        let identity = if self.source == "cloud" {
            self.identity
                .strip_prefix("booth:")
                .is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()))
                && self.warehouse_item_id.is_none()
        } else if self.source == "local" {
            self.identity.strip_prefix("sha256:").is_some_and(|sha| {
                sha.len() == 64
                    && sha
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            })
        } else {
            false
        };
        identity
            && !self.display_name.trim().is_empty()
            && self.display_name.chars().count() <= 512
            && [&self.variant_name, &self.shop_name]
                .iter()
                .all(|s| s.as_ref().is_none_or(|s| s.chars().count() <= 512))
            && self.warehouse_item_id.as_ref().is_none_or(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
            })
    }
    fn key(&self) -> (String, String, Option<String>, Option<String>) {
        (
            self.source.clone(),
            self.identity.clone(),
            self.variant_name.clone(),
            self.warehouse_item_id.clone(),
        )
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Draft {
    schema_version: String,
    kind: String,
    draft_id: String,
    title: String,
    created_at: String,
    selections: Vec<Selection>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Save {
    schema_version: String,
    draft_id: String,
    title: String,
    base_revision: u64,
    selections: Vec<Selection>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Add {
    schema_version: String,
    draft_id: String,
    base_revision: u64,
    selections: Vec<Selection>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Get {
    schema_version: String,
    draft_id: String,
}

#[derive(Debug)]
pub struct DraftError(pub &'static str);
impl From<RecipeSaveError> for DraftError {
    fn from(error: RecipeSaveError) -> Self {
        Self(match error {
            RecipeSaveError::RevisionConflict { .. } => "revision_conflict",
            _ => "store_failed",
        })
    }
}
impl From<serde_json::Error> for DraftError {
    fn from(_: serde_json::Error) -> Self {
        Self("invalid_params")
    }
}
fn identity(version: &str, id: &str) -> Result<(), DraftError> {
    if version != "0.1"
        || !id.strip_prefix("recipe-draft-").is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix.len() <= 100
                && suffix
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
        })
    {
        return Err(DraftError("invalid_params"));
    }
    Ok(())
}
fn validate(selections: &[Selection]) -> Result<(), DraftError> {
    if selections.len() > 512 || selections.iter().any(|s| !s.valid()) {
        return Err(DraftError("invalid_params"));
    }
    Ok(())
}
fn unique(selections: Vec<Selection>) -> Vec<Selection> {
    let mut keys = HashSet::new();
    selections
        .into_iter()
        .filter(|s| keys.insert(s.key()))
        .collect()
}

pub struct RecipeSelectionDrafts {
    store: RecipeDocumentStore,
    root: PathBuf,
    mutations: Mutex<()>,
}
impl RecipeSelectionDrafts {
    pub fn new(root: PathBuf) -> Self {
        Self {
            store: RecipeDocumentStore::new_with_system_clock(&root),
            root,
            mutations: Mutex::new(()),
        }
    }
    fn read(&self, id: &str) -> Result<Option<(Draft, u64, String)>, DraftError> {
        let Some(stored) = self.store.get(id)? else {
            return Ok(None);
        };
        let draft: Draft =
            serde_json::from_value(stored.recipe).map_err(|_| DraftError("store_failed"))?;
        if draft.kind != "selection_draft"
            || draft.draft_id != id
            || identity(&draft.schema_version, id).is_err()
            || validate(&draft.selections).is_err()
            || draft.title.trim().is_empty()
            || draft.title.chars().count() > 120
            || stored.revision == 0
            || stored.revision > 9_007_199_254_740_991
        {
            return Err(DraftError("store_failed"));
        }
        Ok(Some((draft, stored.revision, stored.updated_at)))
    }
    fn save(
        &self,
        id: String,
        title: String,
        selections: Vec<Selection>,
        base_revision: u64,
    ) -> Result<Value, DraftError> {
        if title.trim().is_empty()
            || title.chars().count() > 120
            || base_revision >= 9_007_199_254_740_991
        {
            return Err(DraftError("invalid_params"));
        }
        validate(&selections)?;
        let prior = self.read(&id)?;
        let created_at = prior
            .as_ref()
            .map(|(draft, _, _)| draft.created_at.clone())
            .unwrap_or_else(|| SystemClock.now_rfc3339());
        let draft = Draft {
            schema_version: "0.1".into(),
            kind: "selection_draft".into(),
            draft_id: id.clone(),
            title: title.trim().into(),
            created_at,
            selections: unique(selections),
        };
        let stored = self
            .store
            .save(&id, &serde_json::to_value(draft)?, base_revision)?;
        Ok(
            json!({"schemaVersion":"0.1","document":stored.recipe,"revision":stored.revision,"updatedAt":stored.updated_at}),
        )
    }
    pub fn apply(&self, method: &str, params: Value) -> Result<Value, DraftError> {
        let _guard = self.mutations.lock().expect("draft store poisoned");
        match method {
            "recipeDraft.list" => {
                if params != json!({"schemaVersion":"0.1"}) {
                    return Err(DraftError("invalid_params"));
                }
                let mut entries = Vec::new();
                match std::fs::metadata(&self.root) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        return Ok(json!({"schemaVersion":"0.1","entries":[]}))
                    }
                    Err(_) => return Err(DraftError("store_failed")),
                    Ok(_) => {}
                }
                for entry in self.store.list()? {
                    let (draft, revision, updated) = self
                        .read(&entry.recipe_id)?
                        .ok_or(DraftError("store_failed"))?;
                    entries.push(json!({"draftId":draft.draft_id,"title":draft.title,"revision":revision,"updatedAt":updated,"selectionCount":draft.selections.len()}));
                }
                Ok(json!({"schemaVersion":"0.1","entries":entries}))
            }
            "recipeDraft.get" => {
                let request: Get = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.draft_id)?;
                let (draft, revision, updated) = self
                    .read(&request.draft_id)?
                    .ok_or(DraftError("draft_not_found"))?;
                Ok(
                    json!({"schemaVersion":"0.1","document":draft,"revision":revision,"updatedAt":updated}),
                )
            }
            "recipeDraft.save" => {
                let request: Save = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.draft_id)?;
                self.save(
                    request.draft_id,
                    request.title,
                    request.selections,
                    request.base_revision,
                )
            }
            "recipeDraft.addSelection" => {
                let request: Add = serde_json::from_value(params)?;
                identity(&request.schema_version, &request.draft_id)?;
                if request.base_revision >= 9_007_199_254_740_991 {
                    return Err(DraftError("invalid_params"));
                }
                validate(&request.selections)?;
                let (mut draft, revision, _) = self
                    .read(&request.draft_id)?
                    .ok_or(DraftError("draft_not_found"))?;
                if revision != request.base_revision {
                    return Err(DraftError("revision_conflict"));
                }
                let before = draft.selections.len();
                let additions = unique(request.selections);
                let submitted = additions.len();
                draft.selections.extend(additions);
                draft.selections = unique(draft.selections);
                let added = draft.selections.len() - before;
                let mut saved =
                    self.save(draft.draft_id, draft.title, draft.selections, revision)?;
                saved["addedCount"] = json!(added);
                saved["existingCount"] = json!(submitted - added);
                Ok(saved)
            }
            _ => Err(DraftError("invalid_params")),
        }
    }
}

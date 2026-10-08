use super::*;
use std::collections::HashSet;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_removal_refuses_account_targets_and_retains_local_identity() {
        let store = BdlStore::open_in_memory().unwrap();
        let local = store
            .create_warehouse_item("Local", "imported_material", "t")
            .unwrap();
        let account = store
            .create_warehouse_item("Account", "downloaded_material", "t")
            .unwrap();
        let invalid = RemoveLocalEntries {
            schema_version: "0.1".into(),
            entry_ids: vec![local.warehouse_item_id.clone(), account.warehouse_item_id],
        };
        assert!(matches!(
            store.remove_local_entries(&invalid, "invalid", "t"),
            Err(BdlStoreError::InvalidEvent("entry_not_local"))
        ));
        assert!(store.removed_local_entries().unwrap().is_empty());
        let request = RemoveLocalEntries {
            schema_version: "0.1".into(),
            entry_ids: vec![local.warehouse_item_id.clone()],
        };
        assert_eq!(
            store
                .remove_local_entries(&request, "remove", "t")
                .unwrap()
                .entry_ids,
            request.entry_ids
        );
        assert_eq!(
            store
                .remove_local_entries(&request, "remove", "t")
                .unwrap()
                .entry_ids,
            request.entry_ids
        );
        assert_eq!(
            store.removed_local_entries().unwrap(),
            HashSet::from([local.warehouse_item_id.clone()])
        );
        assert!(store
            .warehouse_entry_detail(
                &local.warehouse_item_id,
                ArtifactMode::UseOriginalUnitypackage
            )
            .unwrap()
            .is_some());
        assert!(matches!(
            store.remove_local_entries(&invalid, "remove", "t"),
            Err(BdlStoreError::InvalidEvent("record_conflict"))
        ));
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemoveLocalEntries {
    pub schema_version: String,
    pub entry_ids: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedLocalEntries {
    pub schema_version: String,
    pub entry_ids: Vec<String>,
}
impl BdlStore {
    pub fn removed_local_entries(&self) -> Result<HashSet<String>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut query =
            connection.prepare("SELECT warehouse_item_id FROM removed_local_entries")?;
        let rows = query
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    }
    pub fn remove_local_entries(
        &self,
        request: &RemoveLocalEntries,
        command_id: &str,
        now: &str,
    ) -> Result<RemovedLocalEntries, BdlStoreError> {
        if request.schema_version != "0.1"
            || command_id.is_empty()
            || request.entry_ids.is_empty()
            || request.entry_ids.len() > 200
            || request.entry_ids.iter().collect::<HashSet<_>>().len() != request.entry_ids.len()
            || request.entry_ids.iter().any(|id| {
                id.is_empty()
                    || id.len() > 128
                    || !id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
            })
        {
            return Err(BdlStoreError::InvalidEvent("invalid_params"));
        }
        let fingerprint = serde_json::to_string(request)?;
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<(String, String)> = tx.query_row("SELECT fingerprint,result_json FROM removed_local_entry_commands WHERE command_id=?1", [command_id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
        if let Some((expected, result)) = prior {
            if expected != fingerprint {
                return Err(BdlStoreError::InvalidEvent("record_conflict"));
            }
            return Ok(serde_json::from_str(&result)?);
        }
        for id in &request.entry_ids {
            let kind: Option<String> = tx
                .query_row(
                    "SELECT kind FROM warehouse_items WHERE warehouse_item_id=?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?;
            match kind.as_deref() {
                None => return Err(BdlStoreError::UnknownWarehouseItem(id.clone())),
                Some("imported_material") => {}
                _ => return Err(BdlStoreError::InvalidEvent("entry_not_local")),
            }
        }
        for id in &request.entry_ids {
            tx.execute("INSERT INTO removed_local_entries(warehouse_item_id,removed_at) VALUES (?1,?2) ON CONFLICT(warehouse_item_id) DO NOTHING", params![id,now])?;
        }
        let result = RemovedLocalEntries {
            schema_version: "0.1".into(),
            entry_ids: request.entry_ids.clone(),
        };
        tx.execute("INSERT INTO removed_local_entry_commands(command_id,fingerprint,result_json) VALUES (?1,?2,?3)", params![command_id,fingerprint,serde_json::to_string(&result)?])?;
        tx.commit()?;
        Ok(result)
    }
}

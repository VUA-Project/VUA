use super::*;

#[cfg(test)]
#[path = "library_entry_metadata_tests.rs"]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntryMetadata {
    pub schema_version: String,
    pub entry_id: String,
    pub revision: u64,
    pub display_name: String,
    pub product_id: Option<String>,
    pub thumbnail_ref: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LibraryEntryMetadataUpdate {
    pub schema_version: String,
    pub entry_id: String,
    pub expected_revision: u64,
    pub display_name: String,
    pub product_id: Option<String>,
    pub thumbnail_ref: Option<String>,
}

impl BdlStore {
    pub fn library_entry_metadata(
        &self,
        entry_id: &str,
    ) -> Result<LibraryEntryMetadata, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        read_metadata(&connection, entry_id)
    }

    pub fn library_entry_metadata_all(&self) -> Result<Vec<LibraryEntryMetadata>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut query =
            connection.prepare("SELECT warehouse_item_id FROM library_entry_metadata")?;
        let ids = query
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|id| read_metadata(&connection, &id))
            .collect()
    }

    pub fn update_library_entry_metadata(
        &self,
        update: &LibraryEntryMetadataUpdate,
        command_id: &str,
        now: &str,
    ) -> Result<LibraryEntryMetadata, BdlStoreError> {
        if update.schema_version != "0.1"
            || command_id.is_empty()
            || !valid_entry_id(&update.entry_id)
            || update.display_name.trim().is_empty()
            || update.display_name.chars().count() > 500
            || update.display_name.chars().any(char::is_control)
            || update.expected_revision >= 9_007_199_254_740_991
            || update.product_id.as_ref().is_some_and(|id| {
                !id.strip_prefix("booth:")
                    .is_some_and(|id| !id.is_empty() && id.bytes().all(|c| c.is_ascii_digit()))
            })
            || update.thumbnail_ref.as_ref().is_some_and(|image| {
                !image.strip_prefix("vua-img://local/").is_some_and(|hash| {
                    hash.len() == 64
                        && hash
                            .bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                })
            })
        {
            return Err(BdlStoreError::InvalidEvent("invalid_params"));
        }
        let fingerprint = serde_json::to_string(update)?;
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let prior: Option<(String, String)> = tx.query_row("SELECT fingerprint,result_json FROM library_entry_metadata_commands WHERE command_id=?1", [command_id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
        if let Some((expected, result)) = prior {
            if fingerprint != expected {
                return Err(BdlStoreError::InvalidEvent("metadata_conflict"));
            }
            return Ok(serde_json::from_str(&result)?);
        }
        let current = read_metadata(&tx, &update.entry_id)?;
        if current.revision != update.expected_revision {
            return Err(BdlStoreError::InvalidEvent("metadata_conflict"));
        }
        if let Some(id) = &update.product_id {
            let known: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM products WHERE product_id=?1)",
                [id],
                |row| row.get(0),
            )?;
            if !known {
                return Err(BdlStoreError::UnknownProduct(id.clone()));
            }
        }
        tx.execute(
            "UPDATE warehouse_items SET display_name=?1 WHERE warehouse_item_id=?2",
            params![update.display_name, update.entry_id],
        )?;
        let next_revision = i64::try_from(current.revision + 1)
            .map_err(|_| BdlStoreError::InvalidEvent("metadata_conflict"))?;
        tx.execute("INSERT INTO library_entry_metadata(warehouse_item_id,revision,product_id,thumbnail_ref,updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(warehouse_item_id) DO UPDATE SET revision=excluded.revision,product_id=excluded.product_id,thumbnail_ref=excluded.thumbnail_ref,updated_at=excluded.updated_at", params![update.entry_id,next_revision,update.product_id,update.thumbnail_ref,now])?;
        let result = read_metadata(&tx, &update.entry_id)?;
        tx.execute("INSERT INTO library_entry_metadata_commands(command_id,fingerprint,result_json) VALUES (?1,?2,?3)", params![command_id,fingerprint,serde_json::to_string(&result)?])?;
        tx.commit()?;
        Ok(result)
    }
}

fn read_metadata(
    connection: &Connection,
    entry_id: &str,
) -> Result<LibraryEntryMetadata, BdlStoreError> {
    if !valid_entry_id(entry_id) {
        return Err(BdlStoreError::InvalidEvent("invalid_params"));
    }
    let result = connection.query_row("SELECT w.kind,w.display_name,COALESCE(m.revision,0),m.product_id,m.thumbnail_ref FROM warehouse_items w LEFT JOIN library_entry_metadata m ON m.warehouse_item_id=w.warehouse_item_id WHERE w.warehouse_item_id=?1", [entry_id], |row| {
        let revision: i64 = row.get(2)?;
        let revision = u64::try_from(revision).map_err(|error| rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Integer, Box::new(error)))?;
        Ok((row.get::<_, String>(0)?, LibraryEntryMetadata { schema_version: "0.1".into(), entry_id: entry_id.into(), display_name: row.get(1)?, revision, product_id: row.get(3)?, thumbnail_ref: row.get(4)? }))
    }).optional()?;
    let Some((kind, metadata)) = result else {
        return Err(BdlStoreError::UnknownWarehouseItem(entry_id.into()));
    };
    if kind != "imported_material" {
        return Err(BdlStoreError::InvalidEvent("entry_not_local"));
    }
    Ok(metadata)
}

fn valid_entry_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.:-".contains(&c))
}

//! Local evidence read faces. Current presence and task interpretation belong to AMF.
use super::*;

pub struct LibraryCopyEvidence {
    pub copy: StoredArtifactCopy,
    pub size_bytes: u64,
    pub product_ids: Vec<String>,
    pub downloadable_id: Option<i64>,
    pub archive_downloadable_id: Option<i64>,
    pub archive_current: bool,
    pub archive_expansion_state: Option<String>,
    pub superseded: bool,
}

impl BdlStore {
    pub fn library_product_summaries(
        &self,
    ) -> Result<Vec<crate::bdl_queries::CatalogProductSummary>, BdlStoreError> {
        // This private domain read has no transport page limit; library.list owns
        // filtering/pagination after combining products and physical entries.
        Ok(self
            .catalog_list(&crate::bdl_queries::CatalogListParams {
                limit: i64::MAX,
                ..Default::default()
            })?
            .entries)
    }

    pub fn product_library_memberships(
        &self,
        product_id: &str,
    ) -> Result<Vec<String>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare("SELECT library_type FROM product_library_memberships WHERE product_id=?1 ORDER BY library_type")?;
        let rows = statement
            .query_map([product_id], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn library_copy_evidence(&self) -> Result<Vec<LibraryCopyEvidence>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut statement = connection.prepare(
            "SELECT c.copy_id,c.warehouse_item_id,c.artifact_sha256,c.relative_path,c.stored_path,c.role,c.created_at,a.size_bytes,
                    (SELECT json_group_array(m.product_id) FROM artifact_mappings m WHERE m.artifact_sha256=c.artifact_sha256),
                    (SELECT downloadable_id FROM managed_library_files f WHERE f.copy_id=c.copy_id),
                    EXISTS(SELECT 1 FROM superseded_generated_copies s WHERE s.copy_id=c.copy_id),
                    (SELECT f.downloadable_id FROM archive_members m JOIN managed_library_files f ON f.copy_id=m.parent_copy_id WHERE m.copy_id=c.copy_id),
                    EXISTS(SELECT 1 FROM archive_members m JOIN artifact_copies p ON p.copy_id=m.parent_copy_id WHERE m.copy_id=c.copy_id AND m.parent_sha256=p.artifact_sha256),
                    (SELECT state FROM archive_expansions e WHERE e.parent_copy_id=c.copy_id AND e.parent_sha256=c.artifact_sha256)
             FROM artifact_copies c JOIN local_artifacts a ON a.artifact_sha256=c.artifact_sha256 ORDER BY c.created_at,c.copy_id")?;
        let mut copies = Vec::new();
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let role: String = row.get(5)?;
            let size: i64 = row.get(7)?;
            let product_ids: String = row.get(8)?;
            copies.push(LibraryCopyEvidence {
                copy: StoredArtifactCopy {
                    copy_id: row.get(0)?,
                    warehouse_item_id: row.get(1)?,
                    artifact_sha256: row.get(2)?,
                    relative_path: row.get(3)?,
                    stored_path: row.get(4)?,
                    role: match role.as_str() {
                        "original" => CopyRole::Original,
                        "generated_vpm" => CopyRole::GeneratedVpm,
                        _ => {
                            return Err(BdlStoreError::CorruptValue {
                                field: "copy_role",
                                value: role,
                            })
                        }
                    },
                    created_at: row.get(6)?,
                },
                size_bytes: u64::try_from(size).map_err(|_| BdlStoreError::CorruptValue {
                    field: "size_bytes",
                    value: size.to_string(),
                })?,
                product_ids: serde_json::from_str(&product_ids)?,
                downloadable_id: row.get(9)?,
                superseded: row.get(10)?,
                archive_downloadable_id: row.get(11)?,
                archive_current: row.get(12)?,
                archive_expansion_state: row.get(13)?,
            });
        }
        // Generated packages belong to the same managed entry as its originals.
        // Derive their catalog grouping without creating provenance observations.
        let mut entry_products: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for copy in &copies {
            if copy.copy.role == CopyRole::Original {
                entry_products
                    .entry(copy.copy.warehouse_item_id.clone())
                    .or_default()
                    .extend(copy.product_ids.clone());
            }
        }
        for copy in &mut copies {
            if copy.copy.role == CopyRole::GeneratedVpm {
                if let Some(products) = entry_products.get(&copy.copy.warehouse_item_id) {
                    copy.product_ids.extend(products.clone());
                }
                copy.product_ids.sort();
                copy.product_ids.dedup();
            }
        }
        Ok(copies)
    }
}

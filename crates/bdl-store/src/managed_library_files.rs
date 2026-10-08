//! Normalized local evidence for managed library files. No acquisition policy.
use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedLibraryFile {
    pub downloadable_id: i64,
    pub copy_id: String,
    pub warehouse_item_id: String,
    pub artifact_sha256: String,
    pub stored_path: String,
    pub relative_path: String,
    pub download_id: String,
}

#[derive(Clone, Copy)]
pub struct ManagedLibraryDelivery<'a> {
    pub downloadable_id: i64,
    pub item_id: &'a str,
    pub display_name: &'a str,
    pub file_name: &'a str,
    pub stored_path: &'a str,
    pub sha: &'a str,
    pub download_id: &'a str,
    pub now: &'a str,
}

impl BdlStore {
    /// The binding is local evidence. It never initiates work or chooses a target.
    pub fn record_managed_library_delivery(
        &self,
        delivery: &ManagedLibraryDelivery<'_>,
    ) -> Result<StoredArtifactCopy, BdlStoreError> {
        let ManagedLibraryDelivery {
            downloadable_id,
            item_id,
            display_name,
            file_name,
            stored_path,
            sha,
            download_id,
            now,
        } = *delivery;
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let product_id: String = tx.query_row(
            "SELECT product_id FROM product_downloadables WHERE downloadable_id=?1",
            [downloadable_id],
            |row| row.get(0),
        )?;
        let copy_id = format!("cpy-{item_id}");
        tx.execute("INSERT INTO warehouse_items(warehouse_item_id,display_name,folder_name,kind,created_at) VALUES (?1,?2,?1,'downloaded_material',?3)", params![item_id, display_name, now])?;
        tx.execute("INSERT INTO artifact_copies(copy_id,artifact_sha256,warehouse_item_id,relative_path,stored_path,role,created_at) VALUES (?1,?2,?3,?4,?5,'original',?6)", params![copy_id, sha, item_id, file_name, stored_path, now])?;
        tx.execute("INSERT INTO managed_library_files(downloadable_id,copy_id,download_id,bound_at) VALUES (?1,?2,?3,?4)", params![downloadable_id, copy_id, download_id, now])?;
        tx.execute("INSERT INTO artifact_mappings(artifact_sha256,product_id,channel,mapped_at) VALUES (?1,?2,'download',?3) ON CONFLICT(artifact_sha256,product_id) DO NOTHING", params![sha, product_id, now])?;
        tx.commit()?;
        Ok(StoredArtifactCopy {
            copy_id,
            warehouse_item_id: item_id.into(),
            artifact_sha256: sha.into(),
            relative_path: file_name.into(),
            stored_path: stored_path.into(),
            role: CopyRole::Original,
            created_at: now.into(),
        })
    }

    /// The binding is local evidence. It never initiates work or chooses a target.
    pub fn managed_library_file(
        &self,
        downloadable_id: i64,
    ) -> Result<Option<ManagedLibraryFile>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection
            .query_row(
                "SELECT m.downloadable_id, c.copy_id, c.warehouse_item_id, c.artifact_sha256,
                    c.stored_path, c.relative_path, m.download_id
             FROM managed_library_files m JOIN artifact_copies c ON c.copy_id=m.copy_id
             WHERE m.downloadable_id=?1",
                [downloadable_id],
                |row| {
                    Ok(ManagedLibraryFile {
                        downloadable_id: row.get(0)?,
                        copy_id: row.get(1)?,
                        warehouse_item_id: row.get(2)?,
                        artifact_sha256: row.get(3)?,
                        stored_path: row.get(4)?,
                        relative_path: row.get(5)?,
                        download_id: row.get(6)?,
                    })
                },
            )
            .optional()?)
    }

    /// Commit a checked replacement with a compare-and-swap on the prior fingerprint.
    /// The copy ID, entry ID and path remain unchanged; the source mapping is evidence.
    pub fn bind_managed_library_file(
        &self,
        downloadable_id: i64,
        expected: &StoredArtifactCopy,
        new_sha: &str,
        download_id: &str,
        now: &str,
    ) -> Result<(), BdlStoreError> {
        let copy_id = &expected.copy_id;
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let product_id: String = tx.query_row(
            "SELECT product_id FROM product_downloadables WHERE downloadable_id=?1",
            [downloadable_id],
            |row| row.get(0),
        )?;
        let previous: Option<String> = tx
            .query_row(
                "SELECT copy_id FROM managed_library_files WHERE downloadable_id=?1",
                [downloadable_id],
                |row| row.get(0),
            )
            .optional()?;
        if previous.as_deref().is_some_and(|bound| bound != copy_id) {
            return Err(BdlStoreError::InvalidEvent("managed file binding conflict"));
        }
        let changed = tx.execute("UPDATE artifact_copies SET artifact_sha256=?1 WHERE copy_id=?2 AND artifact_sha256=?3 AND stored_path=?4 AND warehouse_item_id=?5 AND relative_path=?6 AND role='original'", params![new_sha, copy_id, expected.artifact_sha256, expected.stored_path, expected.warehouse_item_id, expected.relative_path])?;
        if changed != 1 {
            return Err(BdlStoreError::InvalidEvent(
                "managed file fingerprint conflict",
            ));
        }
        if new_sha != expected.artifact_sha256 {
            tx.execute("INSERT INTO superseded_generated_copies(copy_id,replaced_original_sha256,superseded_at)
                        SELECT copy_id,?1,?2 FROM artifact_copies WHERE warehouse_item_id=?3 AND role='generated_vpm'
                        ON CONFLICT(copy_id) DO NOTHING", params![expected.artifact_sha256, now, expected.warehouse_item_id])?;
        }
        tx.execute("INSERT INTO managed_library_files(downloadable_id,copy_id,download_id,bound_at) VALUES (?1,?2,?3,?4)
                    ON CONFLICT(downloadable_id) DO UPDATE SET download_id=excluded.download_id,bound_at=excluded.bound_at", params![downloadable_id, copy_id, download_id, now])?;
        tx.execute("INSERT INTO artifact_mappings(artifact_sha256,product_id,channel,mapped_at) VALUES (?1,?2,'download',?3)
                    ON CONFLICT(artifact_sha256,product_id) DO NOTHING", params![new_sha, product_id, now])?;
        tx.commit()?;
        Ok(())
    }

    /// Legacy candidates retain separate physical identities. Acquisition requires
    /// selection when more than one matches the same observed downloadable.
    pub fn legacy_download_copies(
        &self,
        downloadable_id: i64,
    ) -> Result<Vec<StoredArtifactCopy>, BdlStoreError> {
        let mut copies = Vec::new();
        for item in self.warehouse_entry_cards(ArtifactMode::UseOriginalUnitypackage)? {
            for copy in self.entry_copies(&item.warehouse_item_id)? {
                if copy.role != CopyRole::Original {
                    continue;
                }
                let Some(artifact) = self.artifact(&copy.artifact_sha256)? else {
                    continue;
                };
                let Some(download_id) = artifact.download_id else {
                    continue;
                };
                let exact = format!("https://booth.pm/downloadables/{downloadable_id}");
                if self.download_events(&download_id)?.iter().any(|event| {
                    event.source_url == exact
                        || event
                            .url_chain
                            .as_ref()
                            .is_some_and(|urls| urls.contains(&exact))
                }) {
                    copies.push(copy);
                }
            }
        }
        Ok(copies)
    }

    pub fn generated_copy_is_superseded(
        &self,
        entry_id: &str,
        sha: &str,
    ) -> Result<bool, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        Ok(connection.query_row("SELECT EXISTS(SELECT 1 FROM artifact_copies c JOIN superseded_generated_copies s ON s.copy_id=c.copy_id WHERE c.warehouse_item_id=?1 AND c.artifact_sha256=?2)", params![entry_id, sha], |row| row.get(0))?)
    }
}

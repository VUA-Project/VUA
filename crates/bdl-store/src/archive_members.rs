//! Physical member lineage; filesystem publication belongs to acquisition.
use super::*;

pub struct ArchiveMember {
    pub member_path: String,
    pub relative_path: String,
    pub stored_path: String,
    pub sha256: String,
    pub size_bytes: u64,
}

pub struct StoredArchiveMember {
    pub copy_id: String,
    pub member_path: String,
    pub stored_path: String,
    pub sha256: String,
    pub parent_sha256: String,
}

impl BdlStore {
    pub fn archive_members(
        &self,
        parent_copy_id: &str,
    ) -> Result<Vec<StoredArchiveMember>, BdlStoreError> {
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let mut query = connection.prepare("SELECT c.copy_id,m.member_path,c.stored_path,c.artifact_sha256,m.parent_sha256 FROM archive_members m JOIN artifact_copies c ON c.copy_id=m.copy_id WHERE m.parent_copy_id=?1 ORDER BY m.member_path")?;
        let rows = query
            .query_map([parent_copy_id], |row| {
                Ok(StoredArchiveMember {
                    copy_id: row.get(0)?,
                    member_path: row.get(1)?,
                    stored_path: row.get(2)?,
                    sha256: row.get(3)?,
                    parent_sha256: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Atomically register a complete published tree. Absent historical members
    /// retain their old rows/lineage so saved references can report missing files.
    pub fn record_archive_members(
        &self,
        parent: &StoredArtifactCopy,
        members: &[ArchiveMember],
        now: &str,
    ) -> Result<(), BdlStoreError> {
        let mut connection = self.connection.lock().expect("SQLite connection poisoned");
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let valid: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM artifact_copies WHERE copy_id=?1 AND artifact_sha256=?2 AND stored_path=?3 AND warehouse_item_id=?4 AND role='original')", params![parent.copy_id,parent.artifact_sha256,parent.stored_path,parent.warehouse_item_id], |row| row.get(0))?;
        if !valid {
            return Err(BdlStoreError::InvalidEvent("archive parent changed"));
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for (index, member) in members.iter().enumerate() {
            let size = i64::try_from(member.size_bytes)
                .map_err(|_| BdlStoreError::InvalidEvent("archive member size"))?;
            tx.execute("INSERT INTO local_artifacts(artifact_sha256,size_bytes,suggested_file_name,inspection_state,first_seen_at,inspected_at) VALUES (?1,?2,?3,'inspected',?4,?4) ON CONFLICT(artifact_sha256) DO NOTHING", params![member.sha256,size,member.member_path,now])?;
            let existing: Option<String> = tx.query_row("SELECT copy_id FROM archive_members WHERE parent_copy_id=?1 AND member_path=?2", params![parent.copy_id,member.member_path], |row| row.get(0)).optional()?;
            let copy_id = existing
                .clone()
                .unwrap_or_else(|| format!("cpy-zip-{stamp:x}-{index:x}"));
            if existing.is_some() {
                tx.execute("UPDATE artifact_copies SET artifact_sha256=?1,relative_path=?2,stored_path=?3 WHERE copy_id=?4", params![member.sha256,member.relative_path,member.stored_path,copy_id])?;
            } else {
                tx.execute("INSERT INTO artifact_copies(copy_id,artifact_sha256,warehouse_item_id,relative_path,stored_path,role,created_at) VALUES (?1,?2,?3,?4,?5,'original',?6)", params![copy_id,member.sha256,parent.warehouse_item_id,member.relative_path,member.stored_path,now])?;
            }
            tx.execute("INSERT INTO archive_members(copy_id,parent_copy_id,parent_sha256,member_path) VALUES (?1,?2,?3,?4) ON CONFLICT(copy_id) DO UPDATE SET parent_sha256=excluded.parent_sha256", params![copy_id,parent.copy_id,parent.artifact_sha256,member.member_path])?;
        }
        tx.execute("INSERT INTO archive_expansions(parent_copy_id,parent_sha256,state,error_code,updated_at) VALUES (?1,?2,'expanded',NULL,?3) ON CONFLICT(parent_copy_id) DO UPDATE SET parent_sha256=excluded.parent_sha256,state=excluded.state,error_code=NULL,updated_at=excluded.updated_at", params![parent.copy_id,parent.artifact_sha256,now])?;
        tx.commit()?;
        Ok(())
    }

    pub fn record_archive_failure(
        &self,
        parent: &StoredArtifactCopy,
        state: &str,
        error_code: &str,
        now: &str,
    ) -> Result<(), BdlStoreError> {
        if !matches!(state, "failed" | "cancelled") {
            return Err(BdlStoreError::InvalidEvent("archive state"));
        }
        let connection = self.connection.lock().expect("SQLite connection poisoned");
        let changed = connection.execute("INSERT INTO archive_expansions(parent_copy_id,parent_sha256,state,error_code,updated_at) SELECT copy_id,artifact_sha256,?3,?4,?5 FROM artifact_copies WHERE copy_id=?1 AND artifact_sha256=?2 ON CONFLICT(parent_copy_id) DO UPDATE SET parent_sha256=excluded.parent_sha256,state=excluded.state,error_code=excluded.error_code,updated_at=excluded.updated_at", params![parent.copy_id,parent.artifact_sha256,state,error_code,now])?;
        if changed != 1 {
            return Err(BdlStoreError::InvalidEvent("archive parent changed"));
        }
        Ok(())
    }
}

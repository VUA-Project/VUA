-- Additive physical lineage for verified ZIP expansion. Historical members are retained.
CREATE TABLE archive_members (
  copy_id TEXT PRIMARY KEY REFERENCES artifact_copies(copy_id) ON DELETE CASCADE,
  parent_copy_id TEXT NOT NULL REFERENCES artifact_copies(copy_id),
  parent_sha256 TEXT NOT NULL REFERENCES local_artifacts(artifact_sha256),
  member_path TEXT NOT NULL,
  UNIQUE(parent_copy_id, member_path),
  CHECK(copy_id <> parent_copy_id)
) STRICT;
CREATE TABLE archive_expansions (
  parent_copy_id TEXT PRIMARY KEY REFERENCES artifact_copies(copy_id) ON DELETE CASCADE,
  parent_sha256 TEXT NOT NULL REFERENCES local_artifacts(artifact_sha256),
  state TEXT NOT NULL CHECK(state IN ('expanded','failed','cancelled')),
  error_code TEXT,
  updated_at TEXT NOT NULL
) STRICT;
UPDATE bdl_meta SET value = '0.6' WHERE key = 'format_version' AND value = '0.5';

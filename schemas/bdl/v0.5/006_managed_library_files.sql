-- Additive local evidence for managed re-download replacement (2026-10-08).
-- BDL records bindings; acquisition decides whether and how to replace a file.
CREATE TABLE managed_library_files (
  downloadable_id INTEGER PRIMARY KEY REFERENCES product_downloadables(downloadable_id),
  copy_id TEXT NOT NULL UNIQUE REFERENCES artifact_copies(copy_id) ON DELETE CASCADE,
  download_id TEXT NOT NULL,
  bound_at TEXT NOT NULL
) STRICT;

CREATE TABLE product_library_memberships (
  product_id TEXT NOT NULL REFERENCES products(product_id),
  library_type TEXT NOT NULL CHECK(library_type IN ('bought','gifts','free_downloads')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY(product_id,library_type)
) STRICT;
-- Preserve the one membership known to old stores; do not invent prior sightings.
INSERT INTO product_library_memberships(product_id,library_type,first_seen_at,last_seen_at)
SELECT product_id,library_type,COALESCE(observed_at,''),COALESCE(observed_at,'') FROM products
WHERE library_type IN ('bought','gifts','free_downloads');

-- Retained generation output is not evidence of generation from a replaced original.
CREATE TABLE superseded_generated_copies (
  copy_id TEXT PRIMARY KEY REFERENCES artifact_copies(copy_id) ON DELETE CASCADE,
  replaced_original_sha256 TEXT NOT NULL REFERENCES local_artifacts(artifact_sha256),
  superseded_at TEXT NOT NULL
) STRICT;

UPDATE bdl_meta SET value = '0.5'
 WHERE key = 'format_version' AND value = '0.4';

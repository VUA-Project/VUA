-- BDL v0.4 migration 005: product_downloadables (2026-10-05, N5
-- silent-download slice — sync-time capture of per-file download links
-- from the account library pages; see docs/REGISTRY.md freeze triad).
--
-- The library listing pages (bought / gifts / free_downloads) carry one
-- stable `https://booth.pm/downloadables/{id}` anchor per owned file
-- (verified against the account-library grammar; the signed CDN target
-- behind it is short-lived and never stored). One row per downloadable
-- id, owned by the product it was observed under:
--
--   downloadable_id  BOOTH's stable per-file id (URL digits)
--   product_id       owning product ("booth:<id>"), FK to products
--   anchor_text      verbatim anchor label at capture time (honest raw;
--                    e.g. the localized button word — not a file name)
--   first_seen_at    first capture (preserved across re-syncs)
--   last_seen_at     latest library page that still listed the file
--   last_seen_run_id the catalog-sync run of that latest sighting
--   library_type     which account library listed it (bought | gifts |
--                    free_downloads); NULL = library-agnostic capture
--
-- Additive table, no rebuild, no data loss. Rows are never deleted by
-- re-sync (a file vanishing from a later page is a last_seen fact, not
-- a deletion); the read face serves what was last observed.

CREATE TABLE product_downloadables (
  downloadable_id   INTEGER PRIMARY KEY,      -- BOOTH per-file id (downloadables/{id} digits)
  product_id        TEXT NOT NULL REFERENCES products(product_id),
  anchor_text       TEXT NOT NULL,
  first_seen_at     TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL,
  last_seen_run_id  TEXT,
  library_type      TEXT
);

CREATE INDEX idx_product_downloadables_product ON product_downloadables(product_id);

-- Guarded stamp (deliberate divergence from the blind v0.2/v0.3 stamps):
-- the format_version is only advanced from the exact predecessor '0.3'. A
-- foreign value (tampering / mismatched host) survives the migration and is
-- refused by the post-migration format check instead of being silently
-- rewritten into apparent health.
UPDATE bdl_meta SET value = '0.4'
 WHERE key = 'format_version' AND value = '0.3';
